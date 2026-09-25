/**
 * Validate the release request (pure local validation — deterministic input).
 */
export declare const validateReleaseActivity: (releaseRequest: {
    version: string;
    changelog: string;
    requestedBy: string;
}) => Promise<{
    valid: true;
    validatedAt: string;
} | {
    valid: false;
    reason: string;
}>;
/**
 * Read the latest Railway deployment for the ReleaseS service.
 * Real CI/CD read: returns the actual deployment id + commit metadata.
 */
export declare const buildAppActivity: (params: {
    version: string;
    sourceCommit: string;
}) => Promise<{
    buildId: string;
    artifacts: string[];
    builtAt: string;
    commit: {
        hash: string;
        message: string;
        branch: string;
        repo: string;
    };
}>;
/**
 * Real test gate: TypeScript compile check of this repo + live HTTP health
 * check against the deployed tekno app.
 */
export declare const runTestsActivity: (buildId: string) => Promise<{
    passed: boolean;
    testResults: {
        total: number;
        passed: number;
        failed: number;
    };
    suites: {
        name: string;
        passed: boolean;
        detail: string;
    }[];
    completedAt: string;
}>;
/**
 * REAL deploy: trigger `railway redeploy` for the ReleaseS service and poll
 * until the new deployment reaches a terminal healthy state.
 */
export declare const deployToStagingActivity: (params: {
    buildId: string;
    version: string;
}) => Promise<{
    deploymentId: string;
    url: string;
    deployedAt: string;
}>;
/**
 * REAL promote/verify: confirm the staging deployment is healthy and the
 * production URL answers. No second redeploy — promotion is verification.
 */
export declare const deployToProductionActivity: (params: {
    buildId: string;
    version: string;
    stagingDeploymentId: string;
}) => Promise<{
    deploymentId: string;
    url: string;
    deployedAt: string;
    verifiedDeployment: {
        id: string;
        status: string;
    };
}>;
/**
 * REAL post-deployment checks: HTTP status + latency on prod (and staging).
 */
export declare const postDeploymentChecksActivity: (params: {
    version: string;
    productionDeploymentId: string;
}) => Promise<{
    passed: boolean;
    checks: {
        name: string;
        passed: boolean;
        detail?: string;
    }[];
    completedAt: string;
}>;
/**
 * REAL notifications: POST to Discord webhook when configured.
 * Never throws for missing webhook — records `skipped` instead so a
 * notification gap can't fail an otherwise good release.
 */
export declare const notifyStakeholdersActivity: (params: {
    version: string;
    status: 'success' | 'failed';
    deploymentId?: string;
    notifiedBy: string;
}) => Promise<{
    notificationsSent: {
        type: string;
        recipient: string;
        ok: boolean;
        detail?: string;
    }[];
    skipped?: string;
    completedAt: string;
}>;
//# sourceMappingURL=activities.d.ts.map