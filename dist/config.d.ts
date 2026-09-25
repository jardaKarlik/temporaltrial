/**
 * Central environment configuration for the release list worker.
 * Fails fast on missing required vars instead of silently falling back.
 */
export interface TeknoEnvConfig {
    temporalAddress: string;
    railwayBin: string;
    railwayToken: string;
    releasesProjectId: string;
    releasesEnv: string;
    stagingServiceId: string;
    prodServiceId: string;
    stagingUrl: string;
    prodUrl: string;
    discordWebhookUrl: string;
}
/** Load and validate env config. Call once at worker/client startup. */
export declare function loadTeknoConfig(): TeknoEnvConfig;
/** Hard requirement used only in Railway-deployed code paths. */
export declare function requireDiscordWebhook(): string;
//# sourceMappingURL=config.d.ts.map