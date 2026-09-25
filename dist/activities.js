import { execFile } from 'node:child_process';
import { loadTeknoConfig } from './config.js';
// ---------------------------------------------------------------------------
// Configuration: loaded per activity via loadTeknoConfig() so .env changes
// and Railway dashboard overrides are always respected at runtime.
// ---------------------------------------------------------------------------
const HEALTH_TIMEOUT_MS = 15_000;
const DEPLOY_POLL_INTERVAL_MS = 15_000;
const DEPLOY_TIMEOUT_MS = 10 * 60_000;
// ---------------------------------------------------------------------------
// Helpers (activities may do I/O: child processes, network, Date — all fine)
// ---------------------------------------------------------------------------
function runCmd(cmd, args, extraEnv = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...extraEnv } }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
            }
            else {
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            }
        });
    });
}
async function railwayDeployments(limit, serviceId) {
    const cfg = loadTeknoConfig();
    if (!cfg.railwayToken) {
        throw new Error('Missing RAILWAY_TOKEN: set it as a Railway service variable for deployment activities');
    }
    const { stdout } = await runCmd(cfg.railwayBin, [
        'deployment',
        'list',
        '--project',
        cfg.releasesProjectId,
        '--environment',
        cfg.releasesEnv,
        '--service',
        serviceId ?? cfg.stagingServiceId,
        '--limit',
        String(limit),
        '--json',
    ], { RAILWAY_TOKEN: cfg.railwayToken });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed))
        throw new Error('Unexpected railway deployment list output');
    return parsed;
}
async function httpGet(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = Date.now();
    try {
        const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
        const ms = Date.now() - start;
        const text = await res.text();
        return { ok: res.ok, status: res.status, ms, bodySnippet: text.slice(0, 200) };
    }
    finally {
        clearTimeout(timer);
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---------------------------------------------------------------------------
// Activities — every one below performs a REAL side effect or check
// ---------------------------------------------------------------------------
/**
 * Validate the release request (pure local validation — deterministic input).
 */
export const validateReleaseActivity = async (releaseRequest) => {
    if (!releaseRequest.version || !/^\d+\.\d+\.\d+$/.test(releaseRequest.version)) {
        return { valid: false, reason: 'Invalid version format. Must be semver (e.g., 1.2.3)' };
    }
    if (!releaseRequest.changelog || releaseRequest.changelog.length < 10) {
        return { valid: false, reason: 'Changelog is required and must be meaningful' };
    }
    return { valid: true, validatedAt: new Date().toISOString() };
};
/**
 * Read the latest Railway deployment for the ReleaseS service.
 * Real CI/CD read: returns the actual deployment id + commit metadata.
 */
export const buildAppActivity = async (params) => {
    const [latest] = await railwayDeployments(1);
    if (!latest)
        throw new Error('No Railway deployments found for ReleaseS service');
    return {
        buildId: latest.id,
        artifacts: [
            `railway-deployment:${latest.id}`,
            `commit:${latest.meta?.commitHash ?? 'unknown'}`,
            `tekno-app-v${params.version}.zip`,
        ],
        builtAt: latest.createdAt,
        commit: {
            hash: latest.meta?.commitHash ?? 'unknown',
            message: latest.meta?.commitMessage ?? '',
            branch: latest.meta?.branch ?? '',
            repo: latest.meta?.repo ?? '',
        },
    };
};
/**
 * Real test gate: TypeScript compile check of this repo + live HTTP health
 * check against the deployed tekno app.
 */
export const runTestsActivity = async (buildId) => {
    const suites = [];
    let typecheckPassed = false;
    let typecheckDetail = '';
    try {
        await runCmd('npx', ['tsc', '--noEmit']);
        typecheckPassed = true;
        typecheckDetail = 'tsc --noEmit clean';
    }
    catch (err) {
        typecheckDetail = err instanceof Error ? err.message.slice(-2000) : String(err);
    }
    suites.push({ name: `typecheck (build ${buildId})`, passed: typecheckPassed, detail: typecheckDetail });
    let healthPassed = false;
    let healthDetail = '';
    try {
        const cfg = loadTeknoConfig();
        const res = await httpGet(cfg.prodUrl, HEALTH_TIMEOUT_MS);
        healthPassed = res.ok;
        healthDetail = `GET ${cfg.prodUrl} -> ${res.status} in ${res.ms}ms`;
    }
    catch (err) {
        healthDetail = err instanceof Error ? err.message : String(err);
    }
    suites.push({ name: 'health: tekno prod URL', passed: healthPassed, detail: healthDetail });
    const passedCount = suites.filter((s) => s.passed).length;
    return {
        passed: passedCount === suites.length,
        testResults: { total: suites.length, passed: passedCount, failed: suites.length - passedCount },
        suites,
        completedAt: new Date().toISOString(),
    };
};
/**
 * REAL deploy: trigger `railway redeploy` for the ReleaseS service and poll
 * until the new deployment reaches a terminal healthy state.
 */
export const deployToStagingActivity = async (params) => {
    const cfg = loadTeknoConfig();
    if (!cfg.railwayToken) {
        throw new Error('Missing RAILWAY_TOKEN: set it as a Railway service variable for deployment activities');
    }
    const triggeredAt = Date.now();
    await runCmd(cfg.railwayBin, [
        'redeploy',
        '--service',
        cfg.stagingServiceId,
        '--project',
        cfg.releasesProjectId,
        '--environment',
        cfg.releasesEnv,
        '--yes',
        '--json',
    ], { RAILWAY_TOKEN: cfg.railwayToken });
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    for (;;) {
        const deployments = await railwayDeployments(3, cfg.stagingServiceId);
        const candidate = deployments.find((d) => Date.parse(d.createdAt) >= triggeredAt - 60_000);
        if (candidate && ['SUCCESS', 'SLEEPING'].includes(candidate.status)) {
            return { deploymentId: candidate.id, url: cfg.stagingUrl, deployedAt: candidate.createdAt };
        }
        if (candidate && ['FAILED', 'CRASHED'].includes(candidate.status)) {
            throw new Error(`Staging redeploy ${candidate.id} ended with status ${candidate.status}`);
        }
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for staging redeploy to become healthy');
        }
        await sleep(DEPLOY_POLL_INTERVAL_MS);
    }
};
/**
 * REAL promote/verify: confirm the staging deployment is healthy and the
 * production URL answers. No second redeploy — promotion is verification.
 */
export const deployToProductionActivity = async (params) => {
    const cfg = loadTeknoConfig();
    const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
    for (;;) {
        const deployments = await railwayDeployments(10, cfg.prodServiceId);
        const target = deployments.find((d) => d.id === params.stagingDeploymentId);
        if (target && ['SUCCESS', 'SLEEPING'].includes(target.status)) {
            const health = await httpGet(cfg.prodUrl, HEALTH_TIMEOUT_MS);
            if (!health.ok)
                throw new Error(`Prod URL unhealthy: HTTP ${health.status}`);
            return {
                deploymentId: target.id,
                url: cfg.prodUrl,
                deployedAt: new Date().toISOString(),
                verifiedDeployment: { id: target.id, status: target.status },
            };
        }
        if (target && ['FAILED', 'CRASHED'].includes(target.status)) {
            throw new Error(`Deployment ${target.id} ended with status ${target.status}; refusing to promote`);
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for deployment ${params.stagingDeploymentId} to become healthy`);
        }
        await sleep(DEPLOY_POLL_INTERVAL_MS);
    }
};
/**
 * REAL post-deployment checks: HTTP status + latency on prod (and staging).
 */
export const postDeploymentChecksActivity = async (params) => {
    const cfg = loadTeknoConfig();
    const checks = [];
    const targets = [
        { name: 'Prod HTTP 200', url: cfg.prodUrl },
        { name: 'Staging HTTP 200', url: cfg.stagingUrl },
    ];
    for (const t of targets) {
        try {
            const res = await httpGet(t.url, HEALTH_TIMEOUT_MS);
            const latencyOk = res.ms < 8000;
            checks.push({
                name: t.name,
                passed: res.ok && latencyOk,
                detail: `HTTP ${res.status} in ${res.ms}ms (deployment ${params.productionDeploymentId})`,
            });
        }
        catch (err) {
            checks.push({
                name: t.name,
                passed: false,
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return {
        passed: checks.every((c) => c.passed),
        checks,
        completedAt: new Date().toISOString(),
    };
};
/**
 * REAL notifications: POST to Discord webhook when configured.
 * Never throws for missing webhook — records `skipped` instead so a
 * notification gap can't fail an otherwise good release.
 */
export const notifyStakeholdersActivity = async (params) => {
    const sent = [];
    const summary = params.status === 'success'
        ? `Tekno v${params.version} released (${params.deploymentId ?? 'n/a'})`
        : `Tekno v${params.version} release ${params.status}`;
    const cfg = loadTeknoConfig();
    if (!cfg.discordWebhookUrl) {
        console.log(`[notify] ${summary} — no DISCORD_WEBHOOK_URL configured, skipping Discord`);
        return { notificationsSent: sent, skipped: 'DISCORD_WEBHOOK_URL not configured', completedAt: new Date().toISOString() };
    }
    try {
        const color = params.status === 'success' ? 0x2ecc71 : 0xe74c3c;
        const res = await fetch(cfg.discordWebhookUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                content: summary,
                embeds: [
                    {
                        title: `Tekno release v${params.version} — ${params.status}`,
                        color,
                        fields: [
                            { name: 'Deployment', value: params.deploymentId ?? 'n/a', inline: true },
                            { name: 'Notified by', value: params.notifiedBy, inline: true },
                            { name: 'Prod URL', value: cfg.prodUrl },
                        ],
                    },
                ],
            }),
        });
        sent.push({
            type: 'discord',
            recipient: 'incidents webhook',
            ok: res.ok,
            detail: `HTTP ${res.status}`,
        });
    }
    catch (err) {
        sent.push({
            type: 'discord',
            recipient: 'incidents webhook',
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
        });
    }
    console.log(`[notify] ${summary}`);
    return { notificationsSent: sent, completedAt: new Date().toISOString() };
};
//# sourceMappingURL=activities.js.map