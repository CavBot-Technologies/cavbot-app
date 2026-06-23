import type { NextRequest } from "next/server";
import { hashApiKey } from "@/lib/apiKeys.server";
import { getAuthPool } from "@/lib/authDb";
import { AllowedOriginRow, originAllowed, normalizeOriginStrict } from "@/originMatch";
import { enforceRateLimit, type RateLimitEnv } from "@/rateLimit";
import { recordEmbedMetric, trackDeniedOrigin } from "@/lib/security/embedMetrics.server";
import { getCavbotAppOrigins } from "@/lib/security/embedAppOrigins";

const RATE_LIMIT_SPEC = { capacity: 120, refillPerSec: 2 };

type EmbedVerifierResultOk = {
  ok: true;
  accountId: string;
  projectId: number;
  siteId: string;
  siteOrigin: string;
  origin: string;
  keyId: string;
  projectKey: string;
  scopes: string[];
  keyLast4: string | null;
  keyVersion: string;
};

type EmbedVerifierResultError = {
  ok: false;
  status: number;
  code: string;
  message?: string;
  origin?: string;
  retryAfterSec?: number;
};

export type EmbedVerifierResult = EmbedVerifierResultOk | EmbedVerifierResultError;

function pickFirstValue(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function inferRequestOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const parsed = new URL(referer);
      return parsed.origin;
    } catch {
      return null;
    }
  }
  return null;
}

async function slowFailMetric(
  keyRecord: { accountId?: string | null; projectId?: number | null; id: string },
  siteId: string | null,
  origin: string | null,
  allowed: boolean,
  rateLimited?: boolean,
  req?: Request,
  denyCode?: string
) {
  if (!keyRecord.accountId) return;
  if (keyRecord.projectId == null) return;
  await recordEmbedMetricSafe({
    accountId: keyRecord.accountId,
    projectId: keyRecord.projectId,
    siteId,
    keyId: keyRecord.id,
    allowed,
  });
  if (!allowed && origin) {
    await trackDeniedOriginSafe({
      accountId: keyRecord.accountId,
      projectId: keyRecord.projectId,
      siteId,
      keyId: keyRecord.id,
      origin,
      request: req ?? null,
      denyCode,
      rateLimited,
    });
  }
}

async function recordEmbedMetricSafe(params: Parameters<typeof recordEmbedMetric>[0]) {
  try {
    await recordEmbedMetric(params);
  } catch (error) {
    console.error("[embedVerifier] embed metric write failed; continuing request", error);
  }
}

async function trackDeniedOriginSafe(params: Parameters<typeof trackDeniedOrigin>[0]) {
  try {
    await trackDeniedOrigin(params);
  } catch (error) {
    console.error("[embedVerifier] denied-origin metric write failed; continuing request", error);
  }
}

function buildAllowedOrigins(siteOrigin: string, rows: AllowedOriginRow[]) {
  const extras = getCavbotAppOrigins();
  const canonicalRows: AllowedOriginRow[] = [];
  const seen = new Set<string>();

  const addRow = (row: AllowedOriginRow) => {
    const key = `${row.matchType}:${row.origin}`;
    if (seen.has(key)) return;
    seen.add(key);
    canonicalRows.push(row);
  };

  addRow({ origin: siteOrigin, matchType: "EXACT" });
  for (const row of rows) {
    addRow(row);
  }
  for (const origin of extras) {
    addRow({ origin, matchType: "EXACT" });
  }

  return canonicalRows;
}

type EmbedSiteCandidate = {
  id: string;
  origin: string;
  allowedOrigins: AllowedOriginRow[];
};

type EmbedApiKeyRecord = {
  id: string;
  accountId: string | null;
  projectId: number | null;
  siteId: string | null;
  status: string;
  type: string;
  scopes: string[];
  last4: string | null;
  updatedAt?: Date | string | null;
  site: {
    id: string;
    origin: string;
    projectId: number;
    isActive: boolean;
    allowedOrigins: AllowedOriginRow[];
  } | null;
};

const KEY_LOOKUP_DB_DEADLINE_MS = 10_000;

function originExactMatch(candidateOrigin: string, canonicalOrigin: string) {
  try {
    return normalizeOriginStrict(candidateOrigin) === canonicalOrigin;
  } catch {
    return false;
  }
}

function scopeAllows(requiredScope: string, allowedScopes: string[]) {
  if (allowedScopes.includes(requiredScope)) return true;
  if (
    requiredScope === "analytics:events" &&
    (allowedScopes.includes("events:write") || allowedScopes.includes("analytics:write"))
  ) {
    return true;
  }
  return false;
}

async function resolveSiteForEmbed(args: {
  projectId: number;
  explicitSiteId: string | null;
  boundSiteId: string | null;
  canonicalOrigin: string;
}): Promise<
  | { ok: true; site: EmbedSiteCandidate }
  | { ok: false; code: "SITE_NOT_FOUND" | "SITE_AMBIGUOUS"; status: number; siteId: string | null }
> {
  const directSiteId = args.explicitSiteId || args.boundSiteId || null;
  if (directSiteId) {
    const site = await findActiveSiteById(args.projectId, directSiteId);
    if (!site) {
      return { ok: false, code: "SITE_NOT_FOUND", status: 404, siteId: directSiteId };
    }
    return { ok: true, site };
  }

  const candidates = await listActiveSitesForProject(args.projectId);

  const exact = candidates.filter((site) => originExactMatch(site.origin, args.canonicalOrigin));
  if (exact.length === 1) return { ok: true, site: exact[0] };
  if (exact.length > 1) {
    return { ok: false, code: "SITE_AMBIGUOUS", status: 409, siteId: null };
  }

  const allowed = candidates.filter((site) =>
    originAllowed(args.canonicalOrigin, buildAllowedOrigins(site.origin, site.allowedOrigins ?? []))
  );
  if (allowed.length === 1) return { ok: true, site: allowed[0] };
  if (allowed.length > 1) {
    return { ok: false, code: "SITE_AMBIGUOUS", status: 409, siteId: null };
  }

  return { ok: false, code: "SITE_NOT_FOUND", status: 404, siteId: null };
}

async function findApiKeyForEmbed(keyHash: string): Promise<EmbedApiKeyRecord | null> {
  try {
    const record = await Promise.race([
      findApiKeyForEmbedDb(keyHash),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), KEY_LOOKUP_DB_DEADLINE_MS);
      }),
    ]);
    if (record) return record;
    console.warn("[embedVerifier] key lookup timed out or returned empty");
  } catch (error) {
    console.error("[embedVerifier] key lookup failed", error);
  }
  return null;
}

type RawApiKeyEmbedRow = {
  id: string;
  accountId: string | null;
  projectId: number | string | null;
  siteId: string | null;
  status: string;
  type: string;
  scopes: string[] | null;
  last4: string | null;
  updatedAt: Date | string | null;
  siteOrigin: string | null;
  siteProjectId: number | string | null;
  siteIsActive: boolean | null;
};

type RawSiteEmbedRow = {
  id: string;
  origin: string;
  projectId: number | string;
  isActive: boolean;
};

type RawAllowedOriginEmbedRow = {
  siteId: string;
  origin: string | null;
  matchType: string | null;
};

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return 0;
}

function normalizeAllowedOriginRow(row: RawAllowedOriginEmbedRow): AllowedOriginRow | null {
  const origin = String(row.origin || "").trim();
  if (!origin) return null;
  const rawMatchType = String(row.matchType || "EXACT").trim().toUpperCase();
  const matchType = rawMatchType === "WILDCARD_SUBDOMAIN" || rawMatchType === "WILDCARD"
    ? "WILDCARD_SUBDOMAIN"
    : "EXACT";
  return { origin, matchType };
}

async function listAllowedOriginsForSites(siteIds: string[]) {
  const ids = siteIds.map((id) => String(id || "").trim()).filter(Boolean);
  const bySite = new Map<string, AllowedOriginRow[]>();
  if (!ids.length) return bySite;

  const result = await getAuthPool().query<RawAllowedOriginEmbedRow>(
    `SELECT "siteId", "origin", "matchType"
     FROM "SiteAllowedOrigin"
     WHERE "siteId" = ANY($1::text[])
     ORDER BY "createdAt" ASC`,
    [ids],
  );

  for (const row of result.rows) {
    const siteId = String(row.siteId || "").trim();
    const allowedRow = normalizeAllowedOriginRow(row);
    if (!siteId || !allowedRow) continue;
    const current = bySite.get(siteId) || [];
    current.push(allowedRow);
    bySite.set(siteId, current);
  }

  return bySite;
}

async function findActiveSiteById(projectId: number, siteId: string): Promise<EmbedSiteCandidate | null> {
  const result = await getAuthPool().query<RawSiteEmbedRow>(
    `SELECT "id", "origin", "projectId", "isActive"
     FROM "Site"
     WHERE "id" = $1
       AND "projectId" = $2
       AND "isActive" = TRUE
     LIMIT 1`,
    [siteId, projectId],
  );

  const row = result.rows[0];
  if (!row) return null;
  const allowedOrigins = await listAllowedOriginsForSites([row.id]);
  return {
    id: String(row.id || "").trim(),
    origin: String(row.origin || "").trim(),
    allowedOrigins: allowedOrigins.get(String(row.id || "").trim()) || [],
  };
}

async function listActiveSitesForProject(projectId: number): Promise<EmbedSiteCandidate[]> {
  const result = await getAuthPool().query<RawSiteEmbedRow>(
    `SELECT "id", "origin", "projectId", "isActive"
     FROM "Site"
     WHERE "projectId" = $1
       AND "isActive" = TRUE
     ORDER BY "createdAt" ASC
     LIMIT 200`,
    [projectId],
  );

  const allowedOrigins = await listAllowedOriginsForSites(result.rows.map((row) => String(row.id || "").trim()));
  return result.rows
    .map((row) => {
      const id = String(row.id || "").trim();
      return {
        id,
        origin: String(row.origin || "").trim(),
        allowedOrigins: allowedOrigins.get(id) || [],
      };
    })
    .filter((site) => Boolean(site.id && site.origin));
}

async function findApiKeyForEmbedDb(keyHash: string): Promise<EmbedApiKeyRecord | null> {
  const result = await getAuthPool().query<RawApiKeyEmbedRow>(
    `SELECT
       k."id",
       k."accountId",
       k."projectId",
       k."siteId",
       k."status",
       k."type",
       k."scopes",
       k."last4",
       k."updatedAt",
       s."origin" AS "siteOrigin",
       s."projectId" AS "siteProjectId",
       s."isActive" AS "siteIsActive"
     FROM "ApiKey" k
     LEFT JOIN "Site" s
       ON s."id" = k."siteId"
     WHERE k."keyHash" = $1
       AND k."projectId" IS NOT NULL
     ORDER BY k."createdAt" DESC
     LIMIT 1`,
    [keyHash],
  );

  const row = result.rows[0];
  if (!row) return null;

  const siteId = String(row.siteId || "").trim();
  const allowedOrigins = siteId ? await listAllowedOriginsForSites([siteId]) : new Map<string, AllowedOriginRow[]>();
  const site =
    siteId && row.siteOrigin
      ? {
          id: siteId,
          origin: String(row.siteOrigin || "").trim(),
          projectId: toNumber(row.siteProjectId),
          isActive: Boolean(row.siteIsActive),
          allowedOrigins: allowedOrigins.get(siteId) || [],
        }
      : null;

  return {
    id: String(row.id || "").trim(),
    accountId: row.accountId ? String(row.accountId).trim() : null,
    projectId: toNumber(row.projectId),
    siteId: siteId || null,
    status: String(row.status || "").trim().toUpperCase(),
    type: String(row.type || "").trim().toUpperCase(),
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    last4: row.last4 ? String(row.last4).trim() : null,
    updatedAt: row.updatedAt ?? null,
    site,
  };
}

function failure(
  code: string,
  status: number,
  message?: string,
  origin?: string,
  retryAfterSec?: number
): EmbedVerifierResultError {
  return { ok: false, code, status, message, origin, retryAfterSec };
}

type EmbedVerifierOptions = {
  req: NextRequest;
  env?: RateLimitEnv;
  body?: Record<string, unknown> | null;
  requiredScopes?: string[];
  recordMetrics?: boolean;
  rateLimit?: boolean;
};

export async function verifyEmbedRequest(options: EmbedVerifierOptions): Promise<EmbedVerifierResult> {
  const { req, env, body, recordMetrics = true, rateLimit = true } = options;
  const url = new URL(req.url);
  const projectKey = pickFirstValue(
    req.headers.get("x-cavbot-project-key"),
    req.headers.get("X-Project-Key"),
    url.searchParams.get("projectKey"),
    body?.projectKey as string | undefined,
    body?.project_key as string | undefined
  );
  if (!projectKey) return failure("MISSING_PROJECT_KEY", 401, "Missing CavBot project key.");

  const siteCandidate =
    (body?.site && typeof body.site === "object"
      ? String((body.site as Record<string, unknown>).site_public_id ?? "")
      : undefined) ?? (body?.site_public_id as string | undefined);

  const siteId = pickFirstValue(
    req.headers.get("x-cavbot-site"),
    req.headers.get("X-Cavbot-Site"),
    req.headers.get("X-Cavbot-Site-Public-Id"),
    url.searchParams.get("site"),
    body?.site as string | undefined,
    body?.siteId as string | undefined,
    body?.site_id as string | undefined,
    siteCandidate
  );

  const keyHash = hashApiKey(projectKey.trim());
  const record = await findApiKeyForEmbed(keyHash);
  if (!record) return failure("INVALID_KEY", 401, "Key not found.");
  if (record.status !== "ACTIVE") return failure("KEY_INACTIVE", 403, "Key is not active.");
  if (record.type !== "PUBLISHABLE") return failure("INVALID_KEY_TYPE", 403, "Publishable key required.");
  if (!record.projectId) return failure("INVALID_KEY", 401, "Key missing project binding.");

  const projectId = record.projectId!;
  const originHeader = inferRequestOrigin(req);
  if (!originHeader) {
    await slowFailMetric(record, siteId, null, false, false, req, "ORIGIN_MISSING");
    return failure("ORIGIN_MISSING", 400, "Origin header missing.");
  }

  let canonicalOrigin: string;
  try {
    canonicalOrigin = normalizeOriginStrict(originHeader);
  } catch {
    await slowFailMetric(record, siteId, originHeader, false, false, req, "ORIGIN_INVALID");
    return failure("DENIED_ORIGIN", 403, "Origin parsing failed.", originHeader);
  }

  const siteResult = await resolveSiteForEmbed({
    projectId,
    explicitSiteId: siteId,
    boundSiteId: record.siteId ?? null,
    canonicalOrigin,
  });
  if (!siteResult.ok) {
    await slowFailMetric(record, siteResult.siteId ?? siteId, canonicalOrigin, false, false, req, siteResult.code);
    return failure(siteResult.code, siteResult.status, "Requested site missing, inactive, or ambiguous.", canonicalOrigin);
  }

  const site = siteResult.site;

  if (record.siteId && record.siteId !== site.id) {
    await slowFailMetric(record, site.id, canonicalOrigin, false, false, req, "SITE_MISMATCH");
    return failure("SITE_MISMATCH", 403, "Key not bound to this site.", canonicalOrigin);
  }

  if (options.requiredScopes?.length) {
    const allowedScopes = record.scopes ?? [];
    const missing = options.requiredScopes.filter((scope) => !scopeAllows(scope, allowedScopes));
    if (missing.length) {
      await slowFailMetric(record, site.id, canonicalOrigin, false, false, req, "SCOPE_MISSING");
      return failure("SCOPE_MISSING", 403, "Required scope missing.", canonicalOrigin);
    }
  }

  const allowedRows = buildAllowedOrigins(site.origin, site.allowedOrigins ?? []);
  if (!originAllowed(canonicalOrigin, allowedRows)) {
    await slowFailMetric(record, site.id, canonicalOrigin, false, false, req, "DENIED_ORIGIN");
    return failure("DENIED_ORIGIN", 403, "Origin not allowed.", canonicalOrigin);
  }

  if (rateLimit) {
    try {
      await enforceRateLimit(req, env, String(record.projectId), canonicalOrigin, RATE_LIMIT_SPEC, `origin:${canonicalOrigin}`);
      await enforceRateLimit(req, env, String(record.projectId), canonicalOrigin, RATE_LIMIT_SPEC, `site:${site.id}`);
      await enforceRateLimit(req, env, String(record.projectId), canonicalOrigin, RATE_LIMIT_SPEC, `key:${record.id}`);
    } catch (error) {
      const retryAfterRaw =
        error instanceof Response ? error.headers.get("Retry-After") : null;
      const parsedRetryAfter = Number.parseInt(String(retryAfterRaw || ""), 10);
      const retryAfterSec =
        Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : 1;
      await slowFailMetric(record, site.id, canonicalOrigin, false, true, req, "RATE_LIMIT");
      return failure("RATE_LIMIT", 429, "Rate limit exceeded.", canonicalOrigin, retryAfterSec);
    }
  }

  if (recordMetrics) {
    await recordEmbedMetricSafe({
      accountId: record.accountId ?? "",
      projectId,
      siteId: site.id,
      keyId: record.id,
      allowed: true,
    });
  }

  return {
    ok: true,
    accountId: record.accountId ?? "",
    projectId,
    siteId: site.id,
    siteOrigin: site.origin,
    origin: canonicalOrigin,
    keyId: record.id,
    projectKey: projectKey.trim(),
    scopes: record.scopes ?? [],
    keyLast4: record.last4 ?? null,
    keyVersion: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : String(record.updatedAt || ""),
  };
}
