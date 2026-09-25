import {
  defineSignal,
  defineQuery,
  setHandler,
  condition,
  proxyActivities,
} from '@temporalio/workflow';
import type * as activities from './activities.js';

// Activities must be proxied so Temporal can apply timeouts/retries/heartbeats.
const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '30 seconds',
  retry: { maximumAttempts: 2 },
});

// Separate short-timeout proxy for post-deploy health checks.
const healthActs = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '30 seconds',
});

// External approval signal (mirrors the n8n webhook approval step).
export const approvalSignal = defineSignal<
  [
    {
      approved: boolean;
      approvedBy: string;
      comments?: string;
    },
  ]
>('release-list-approval');

// Live status query.
export const releaseStatusQuery = defineQuery<string>('release-list-status');

export interface ReleaseListRequest {
  version: string;
  changelog: string;
  requestedBy: string;
  metadata?: {
    commitHash?: string;
    branch?: string;
    pullRequestId?: number;
  };
}

export interface ReleaseListResult {
  status: 'success' | 'failed' | 'cancelled';
  version: string;
  steps: { name: string; status: string; details?: unknown }[];
  error?: string;
}

/**
 * Release List Workflow.
 * Deterministic: no Date/setTimeout/Math/random in workflow code.
 * Timestamps come from activity results; approval waits on a signal.
 */
export const releaseListWorkflow = async (
  releaseRequest: ReleaseListRequest,
): Promise<ReleaseListResult> => {
  const steps: ReleaseListResult['steps'] = [];
  setHandler(releaseStatusQuery, () => 'validating');

  // Step 1: validate
  const validation = await acts.validateReleaseActivity(releaseRequest);
  if (!validation.valid) {
    steps.push({
      name: 'Validate Release',
      status: 'failed',
      details: { reason: (validation as { reason?: string }).reason },
    });
    setHandler(releaseStatusQuery, () => 'failed');
    return {
      status: 'failed',
      version: releaseRequest.version,
      steps,
      error: `Validation failed: ${(validation as { reason?: string }).reason}`,
    };
  }
  steps.push({
    name: 'Validate Release',
    status: 'success',
    details: { validatedAt: (validation as { validatedAt?: string }).validatedAt },
  });

  // Step 2: read latest Railway deployment (maps to n8n "check release" node)
  setHandler(releaseStatusQuery, () => 'building');
  const build = await acts.buildAppActivity({
    version: releaseRequest.version,
    sourceCommit: releaseRequest.metadata?.commitHash ?? 'unknown',
  });
  steps.push({
    name: 'Read Railway deployment',
    status: 'success',
    details: { buildId: build.buildId, commit: build.commit },
  });

  // Step 3: real test gate (tsc + live health check)
  setHandler(releaseStatusQuery, () => 'testing');
  const tests = await acts.runTestsActivity(build.buildId);
  steps.push({
    name: 'Run Tests',
    status: tests.passed ? 'success' : 'failed',
    details: tests,
  });
  if (!tests.passed) {
    setHandler(releaseStatusQuery, () => 'failed');
    await acts.notifyStakeholdersActivity({
      version: releaseRequest.version,
      status: 'failed',
      deploymentId: build.buildId,
      notifiedBy: 'release-list-workflow',
    });
    return {
      status: 'failed',
      version: releaseRequest.version,
      steps,
      error: `Tests failed: ${tests.testResults.failed} of ${tests.testResults.total}`,
    };
  }

  // Step 4: redeploy staging
  setHandler(releaseStatusQuery, () => 'deploying-staging');
  const staging = await acts.deployToStagingActivity({
    version: releaseRequest.version,
    buildId: build.buildId,
  });
  steps.push({ name: 'Deploy to Staging', status: 'success', details: staging });

  // Step 5: approval signal with deterministic timeout (no setTimeout!).
  setHandler(releaseStatusQuery, () => 'waiting-approval');
  await acts.notifyStakeholdersActivity({
    version: releaseRequest.version,
    status: 'success',
    deploymentId: staging.deploymentId,
      notifiedBy: 'release-list-workflow:approval-request',
  });
  let approval: { approved: boolean; approvedBy: string; comments?: string } | undefined;
  setHandler(approvalSignal, (payload: { approved: boolean; approvedBy: string; comments?: string }) => {
    approval = payload;
  });
  const gotApproval = await condition(() => approval !== undefined, '5 minutes');
  if (!gotApproval || !approval) {
    steps.push({ name: 'Wait for Approval', status: 'failed', details: { error: 'Approval timeout (5m)' } });
    setHandler(releaseStatusQuery, () => 'failed');
    return {
      status: 'failed',
      version: releaseRequest.version,
      steps,
      error: 'Approval timeout exceeded (5 minutes)',
    };
  }
  steps.push({ name: 'Wait for Approval', status: 'success', details: approval });
  if (!approval.approved) {
    setHandler(releaseStatusQuery, () => 'rejected');
    return {
      status: 'cancelled',
      version: releaseRequest.version,
      steps,
      error: `Release rejected by ${approval.approvedBy}`,
    };
  }

  // Step 6: promote/verify production
  setHandler(releaseStatusQuery, () => 'deploying-production');
  const prod = await acts.deployToProductionActivity({
    version: releaseRequest.version,
    buildId: build.buildId,
    stagingDeploymentId: staging.deploymentId,
  });
  steps.push({ name: 'Deploy to Production', status: 'success', details: prod });

  // Step 7: post-deploy health checks
  setHandler(releaseStatusQuery, () => 'post-deployment-checks');
  const postChecks = await healthActs.postDeploymentChecksActivity({
    version: releaseRequest.version,
    productionDeploymentId: prod.deploymentId,
  });
  steps.push({
    name: 'Post-deployment Checks',
    status: postChecks.passed ? 'success' : 'failed',
    details: postChecks,
  });

  // Step 8: notify
  setHandler(releaseStatusQuery, () => 'notifying');
  const notified = await acts.notifyStakeholdersActivity({
    version: releaseRequest.version,
    status: postChecks.passed ? 'success' : 'failed',
    deploymentId: prod.deploymentId,
    notifiedBy: 'tekno-release-workflow',
  });
  steps.push({ name: 'Notify Stakeholders', status: 'success', details: notified });

  if (!postChecks.passed) {
    setHandler(releaseStatusQuery, () => 'failed');
    return {
      status: 'failed',
      version: releaseRequest.version,
      steps,
      error: 'Post-deployment checks failed',
    };
  }

  setHandler(releaseStatusQuery, () => 'completed');
  return { status: 'success', version: releaseRequest.version, steps };
};
