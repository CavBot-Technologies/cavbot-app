import { fetchEmbedUsage, DEFAULT_EMBED_RATE_LIMIT_LABEL, type EmbedUsagePayload } from "@/lib/security/embedMetrics.server";

export type KeyUsagePayload = EmbedUsagePayload;

export const DEFAULT_RATE_LIMIT_LABEL = DEFAULT_EMBED_RATE_LIMIT_LABEL;

export async function fetchUsageForWorkspace(options: {
  projectId: number;
  accountId: string;
  siteId: string | null;
  siteOrigin: string | null;
}): Promise<KeyUsagePayload | null> {
  try {
    return await fetchEmbedUsage({
      accountId: options.accountId,
      projectId: options.projectId,
      siteId: options.siteId,
      rateLimitLabel: DEFAULT_RATE_LIMIT_LABEL,
    });
  } catch (error) {
    console.error("Unable to resolve API key usage summary", error);
    return null;
  }
}
