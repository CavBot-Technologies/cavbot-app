import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { hashApiKey } from "@/lib/apiKeys.server";
import { AllowedOriginRow, originAllowed, normalizeOriginStrict } from "@/originMatch";
import { enforceRateLimit, type RateLimitEnv } from "@/rateLimit";
import { recordEmbedMetric, trackDeniedOrigin } from "@/lib/security/embedMetrics.server";
import { getCavbotAppOrigins } from "@/lib/security/embedAppOrigins";
import { EMBED_RATE_LIMIT_SPEC } from "@/lib/security/embedRateLimit";
import {
  findActiveEmbedSite,
  findEmbedKeyByHash,
  listEmbedAllowedOrigins,
} from "@/lib/security/embedKeyRuntime.server";

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

function hashRateLimitActor(raw: string) {
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function extractEmbedRateLimitActor(
  body: Record<string, unknown> | null | undefined,
  req: NextRequest,
  canonicalOrigin: string
) {
  const records = Array.isArray(body?.records) ? body.records : [];
  const firstRecord =
    records.length > 0 && records[0] && typeof records[0] === "object"
      ? (records[0] as Record<string, unknown>)
      : null;

  const actor = pickFirstValue(
    firstRecord?.visitor_id as string | undefined,
    firstRecord?.visitorId as string | undefined,
    firstRecord?.anonymous_id as string | undefined,
    firstRecord?.anonymousId as string | undefined,
    firstRecord?.session_key as string | undefined,
    firstRecord?.sessionKey as string | undefined,
    firstRecord?.session_id as string | undefined,
    firstRecord?.sessionId as string | undefined,
    body?.visitor_id as string | undefined,
    body?.visitorId as string | undefined,
    body?.anonymous_id as string | undefined,
    body?.anonymousId as string | undefined,
    body?.session_key as string | undefined,
    body?.sessionKey as string | undefined,
    body?.session_id as string | undefined,
    body?.sessionId as string | undefined,
  );

  if (actor) return hashRateLimitActor(actor);

  const pathHint = pickFirstValue(
    firstRecord?.route as string | undefined,
    firstRecord?.pathname as string | undefined,
    firstRecord?.path as string | undefined,
    firstRecord?.page_url as string | undefined,
    firstRecord?.pageUrl as string | undefined,
    firstRecord?.url as string | undefined,
    body?.route as string | undefined,
    body?.pathname as string | undefined,
    body?.path as string | undefined,
    body?.page_url as string | undefined,
    body?.pageUrl as string | undefined,
    body?.url as string | undefined,
  );

  const userAgent = pickFirstValue(
    req.headers.get("user-agent"),
    req.headers.get("sec-ch-ua"),
    "unknown-agent",
  );

  return hashRateLimitActor(`${canonicalOrigin}:${userAgent}:${pathHint || "unknown-route"}`);
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
  await recordEmbedMetric({
    accountId: keyRecord.accountId,
    projectId: keyRecord.projectId,
    siteId,
    keyId: keyRecord.id,
    allowed,
  });
  if (!allowed && origin) {
    await trackDeniedOrigin({
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
};

export async function verifyEmbedRequest(options: EmbedVerifierOptions): Promise<EmbedVerifierResult> {
  const { req, env, body, recordMetrics = true } = options;
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
  if (!siteId) return failure("SITE_REQUIRED", 400, "Site identifier required for embed verification.");

  const keyHash = hashApiKey(projectKey.trim());
  const record = await findEmbedKeyByHash(keyHash);
  if (!record) return failure("INVALID_KEY", 401, "Key not found.");
  if (record.status !== "ACTIVE") return failure("KEY_INACTIVE", 403, "Key is not active.");
  if (record.type !== "PUBLISHABLE") return failure("INVALID_KEY_TYPE", 403, "Publishable key required.");
  if (!record.projectId) return failure("INVALID_KEY", 401, "Key missing project binding.");

  const projectId = record.projectId!;
  const site = await findActiveEmbedSite(siteId, record.projectId);
  if (!site) {
    await slowFailMetric(record, siteId, null, false, false, req, "SITE_NOT_FOUND");
    return failure("SITE_NOT_FOUND", 404, "Requested site missing or inactive.");
  }

  if (record.siteId && record.siteId !== site.id) {
    await slowFailMetric(record, site.id, null, false, false, req, "SITE_MISMATCH");
    return failure("SITE_MISMATCH", 403, "Key not bound to this site.");
  }

  if (options.requiredScopes?.length) {
    const allowedScopes = record.scopes ?? [];
    const missing = options.requiredScopes.filter((scope) => !allowedScopes.includes(scope));
    if (missing.length) {
      await slowFailMetric(record, site.id, null, false, false, req, "SCOPE_MISSING");
      return failure("SCOPE_MISSING", 403, "Required scope missing.");
    }
  }

  const originHeader = inferRequestOrigin(req);
  if (!originHeader) {
    await slowFailMetric(record, site.id, null, false, false, req, "ORIGIN_MISSING");
    return failure("ORIGIN_MISSING", 400, "Origin header missing.");
  }

  let canonicalOrigin: string;
  try {
    canonicalOrigin = normalizeOriginStrict(originHeader);
  } catch {
    await slowFailMetric(record, site.id, originHeader, false, false, req, "ORIGIN_INVALID");
    return failure("DENIED_ORIGIN", 403, "Origin parsing failed.", originHeader);
  }

  const allowedRows = buildAllowedOrigins(site.origin, await listEmbedAllowedOrigins(site.id));
  if (!originAllowed(canonicalOrigin, allowedRows)) {
    await slowFailMetric(record, site.id, canonicalOrigin, false, false, req, "DENIED_ORIGIN");
    return failure("DENIED_ORIGIN", 403, "Origin not allowed.", canonicalOrigin);
  }

  const rateLimitActor = extractEmbedRateLimitActor(body, req, canonicalOrigin);

  try {
    await enforceRateLimit(
      req,
      env,
      String(record.projectId),
      canonicalOrigin,
      EMBED_RATE_LIMIT_SPEC,
      `origin:${canonicalOrigin}:actor:${rateLimitActor}`
    );
    await enforceRateLimit(
      req,
      env,
      String(record.projectId),
      canonicalOrigin,
      EMBED_RATE_LIMIT_SPEC,
      `site:${site.id}:actor:${rateLimitActor}`
    );
    await enforceRateLimit(
      req,
      env,
      String(record.projectId),
      canonicalOrigin,
      EMBED_RATE_LIMIT_SPEC,
      `key:${record.id}:actor:${rateLimitActor}`
    );
  } catch (error) {
    if (!(error instanceof Response)) {
      console.error("[embedVerifier] rate limiter unavailable; allowing verified request", error);
    } else {
      const retryAfterRaw = error.headers.get("Retry-After");
      const parsedRetryAfter = Number.parseInt(String(retryAfterRaw || ""), 10);
      const retryAfterSec =
        Number.isFinite(parsedRetryAfter) && parsedRetryAfter > 0 ? parsedRetryAfter : 1;
      await slowFailMetric(record, site.id, canonicalOrigin, false, true, req, "RATE_LIMIT");
      return failure("RATE_LIMIT", 429, "Rate limit exceeded.", canonicalOrigin, retryAfterSec);
    }
  }

  if (recordMetrics) {
    await recordEmbedMetric({
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
    keyVersion: record.updatedAt?.toISOString() ?? "",
  };
}
