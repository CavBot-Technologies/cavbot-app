import "server-only";

import { getAuthPool } from "@/lib/authDb";

export type ApiKeyWorkspaceSite = {
  id: string;
  origin: string;
};

export type ResolvedApiKeyWorkspace = {
  projectId: number;
  sites: ApiKeyWorkspaceSite[];
  activeSite: ApiKeyWorkspaceSite | null;
  allowedOrigins: string[];
};

type RawProjectRow = {
  id: number | string;
};

type RawSiteRow = {
  id: string;
  origin: string;
};

type RawAllowedOriginRow = {
  origin: string | null;
};

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return 0;
}

export async function resolveApiKeyWorkspace(args: {
  accountId: string;
  requestedSiteId?: string | null;
}): Promise<ResolvedApiKeyWorkspace | null> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) return null;

  const pool = getAuthPool();

  const projectResult = await pool.query<RawProjectRow>(
    `SELECT "id"
     FROM "Project"
     WHERE "accountId" = $1
       AND "isActive" = TRUE
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [accountId],
  );

  const projectId = asNumber(projectResult.rows[0]?.id);
  if (!projectId) return null;

  const sitesResult = await pool.query<RawSiteRow>(
    `SELECT "id", "origin"
     FROM "Site"
     WHERE "projectId" = $1
       AND "isActive" = TRUE
     ORDER BY "createdAt" ASC`,
    [projectId],
  );

  const sites = sitesResult.rows.map((row) => ({
    id: String(row.id || "").trim(),
    origin: String(row.origin || "").trim(),
  }));

  const requestedSiteId = String(args.requestedSiteId || "").trim();
  const requestedSite = requestedSiteId
    ? sites.find((site) => site.id === requestedSiteId) ?? null
    : null;
  const activeSite = requestedSite || sites[0] || null;

  const originSet = new Set<string>();
  if (activeSite?.origin) originSet.add(activeSite.origin);

  if (activeSite) {
    try {
      const allowedRows = await pool.query<RawAllowedOriginRow>(
        `SELECT "origin"
         FROM "SiteAllowedOrigin"
         WHERE "siteId" = $1
         ORDER BY "createdAt" ASC`,
        [activeSite.id],
      );
      for (const row of allowedRows.rows) {
        const origin = String(row.origin || "").trim();
        if (origin) originSet.add(origin);
      }
    } catch (error) {
      console.error("[settings/api-keys] allowed origins lookup failed", error);
    }
  }

  return {
    projectId,
    sites,
    activeSite,
    allowedOrigins: Array.from(originSet),
  };
}
