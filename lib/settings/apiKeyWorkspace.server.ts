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

export type ApiKeyWorkspaceCookieHints = {
  preferredProjectId: number | null;
  activeSiteIdHint: string | null;
  activeSiteOriginHint: string | null;
};

type ResolveApiKeyWorkspaceArgs = {
  accountId: string;
  requestedSiteId?: string | null;
  preferredProjectId?: number | null;
  activeSiteIdHint?: string | null;
  activeSiteOriginHint?: string | null;
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

function asText(value: string | null | undefined) {
  return String(value || "").trim();
}

function safeDecode(value: string | null | undefined) {
  const raw = asText(value);
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

function parseProjectId(value: string | null | undefined) {
  const raw = asText(value);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function readApiKeyWorkspaceCookieHints(req: {
  cookies: { get: (name: string) => { value?: string | null } | undefined };
}): ApiKeyWorkspaceCookieHints {
  const preferredProjectId =
    parseProjectId(req.cookies.get("cb_active_project_id")?.value) ??
    parseProjectId(req.cookies.get("cb_pid")?.value);

  const projectKey = preferredProjectId ? String(preferredProjectId) : "";
  return {
    preferredProjectId,
    activeSiteIdHint: projectKey ? safeDecode(req.cookies.get(`cb_active_site_id__${projectKey}`)?.value) || null : null,
    activeSiteOriginHint: projectKey
      ? safeDecode(req.cookies.get(`cb_active_site_origin__${projectKey}`)?.value) || null
      : null,
  };
}

export async function resolveApiKeyWorkspace(args: ResolveApiKeyWorkspaceArgs): Promise<ResolvedApiKeyWorkspace | null> {
  const accountId = String(args.accountId || "").trim();
  if (!accountId) return null;

  const pool = getAuthPool();

  const preferredProjectId =
    typeof args.preferredProjectId === "number" && Number.isInteger(args.preferredProjectId) && args.preferredProjectId > 0
      ? args.preferredProjectId
      : null;

  let projectId = 0;
  if (preferredProjectId) {
    const preferredProject = await pool.query<RawProjectRow>(
      `SELECT "id"
       FROM "Project"
       WHERE "accountId" = $1
         AND "id" = $2
         AND "isActive" = TRUE
       LIMIT 1`,
      [accountId, preferredProjectId],
    );
    projectId = asNumber(preferredProject.rows[0]?.id);
  }

  if (!projectId) {
    const projectResult = await pool.query<RawProjectRow>(
      `SELECT "id"
       FROM "Project"
       WHERE "accountId" = $1
         AND "isActive" = TRUE
       ORDER BY "createdAt" ASC
       LIMIT 1`,
      [accountId],
    );
    projectId = asNumber(projectResult.rows[0]?.id);
  }

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

  const requestedSiteId = asText(args.requestedSiteId);
  const activeSiteIdHint = asText(args.activeSiteIdHint);
  const activeSiteOriginHint = asText(args.activeSiteOriginHint);
  const requestedSite = requestedSiteId
    ? sites.find((site) => site.id === requestedSiteId) ?? null
    : null;
  const hintedSite = !requestedSite && activeSiteIdHint
    ? sites.find((site) => site.id === activeSiteIdHint) ?? null
    : null;
  const hintedOriginSite = !requestedSite && !hintedSite && activeSiteOriginHint
    ? sites.find((site) => site.origin === activeSiteOriginHint) ?? null
    : null;
  const activeSite = requestedSiteId
    ? requestedSite
    : requestedSite || hintedSite || hintedOriginSite || sites[0] || null;

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
