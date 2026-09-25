export declare const approvalSignal: import("@temporalio/common").SignalDefinition<[{
    approved: boolean;
    approvedBy: string;
    comments?: string;
}], string>;
export declare const releaseStatusQuery: import("@temporalio/common").QueryDefinition<string, [], string>;
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
    steps: {
        name: string;
        status: string;
        details?: unknown;
    }[];
    error?: string;
}
/**
 * Release List Workflow.
 * Deterministic: no Date/setTimeout/Math/random in workflow code.
 * Timestamps come from activity results; approval waits on a signal.
 */
export declare const releaseListWorkflow: (releaseRequest: ReleaseListRequest) => Promise<ReleaseListResult>;
//# sourceMappingURL=workflows.d.ts.map