import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getEnv, registerWorkerSite } from "@/lib/cavbotApi.server";
import { verifyEmbedRequest, type EmbedVerifierResult } from "@/lib/security/embedVerifier";
import { verifyEmbedToken } from "@/lib/security/embedToken";
import { RateLimitEnv } from "@/rateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { canonicalizeWebsiteContextUrl } from "@/originMatch";
import { recordAnalyticsEmbedActivityBestEffort } from "@/lib/security/embedAnalyticsTracker.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};
const UPSTREAM_TIMEOUT_MS = 8_000;
const EMBED_ANALYTICS_TIMEOUT_MS = 30_000;
const EMBED_ANALYTICS_DEADLINE = Symbol("EMBED_ANALYTICS_DEADLINE");
const FIRST_PARTY_WORKER_PROJECT_KEY = "cavbot_pk_gHn737DTf4afJ2xGpBFzZQ";

const INGEST_ALLOWED_HEADERS = [
  "content-type",
  "authorization",
  "x-project-key",
  "x-cavbot-project-key",
  "x-cavbot-site",
  "x-cavbot-site-host",
  "x-cavbot-site-origin",
  "x-cavbot-site-public-id",
  "x-cavbot-sdk-version",
  "x-cavbot-env",
].join(",");

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": INGEST_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
  if (!origin) {
    delete headers["Access-Control-Allow-Origin"];
  }
  return headers;
}

function handleOptions(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function firstClientIp(value: string | null) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function forwardedClientIp(req: NextRequest) {
  return (
    firstClientIp(req.headers.get("cf-connecting-ip")) ||
    firstClientIp(req.headers.get("x-forwarded-for")) ||
    firstClientIp(req.headers.get("x-real-ip"))
  );
}

function hostFromOrigin(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

function canonicalizePayloadUrl(value: unknown, siteOrigin: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return value;
  return canonicalizeWebsiteContextUrl(raw, siteOrigin);
}

function canonicalizeVerifiedPayload(
  payload: Record<string, unknown> | null,
  verification: Extract<EmbedVerifierResult, { ok: true }>
) {
  if (!payload) return payload;

  const siteOrigin = verification.siteOrigin;
  const siteHost = hostFromOrigin(siteOrigin);
  const canonicalPayload: Record<string, unknown> = {
    ...payload,
    origin: siteOrigin,
    siteOrigin,
  };

  if (siteHost) canonicalPayload.siteHost = siteHost;
  if (typeof payload.pageUrl === "string") {
    canonicalPayload.pageUrl = canonicalizePayloadUrl(payload.pageUrl, siteOrigin);
  }

  if (payload.site && typeof payload.site === "object" && !Array.isArray(payload.site)) {
    canonicalPayload.site = {
      ...(payload.site as Record<string, unknown>),
      origin: siteOrigin,
      host: siteHost,
      base_url: siteOrigin,
    };
  }

  if (Array.isArray(payload.records)) {
    canonicalPayload.records = payload.records.map((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return record;
      const next = { ...(record as Record<string, unknown>) };
      next.site_origin = siteOrigin;
      if (siteHost) next.site_host = siteHost;
      if (typeof next.page_url === "string") {
        next.page_url = canonicalizePayloadUrl(next.page_url, siteOrigin);
      }
      if (typeof next.referrer_url === "string") {
        next.referrer_url = canonicalizePayloadUrl(next.referrer_url, siteOrigin);
      }
      return next;
    });
  }

  return canonicalPayload;
}

function stripUpstreamSitePublicIds(payload: Record<string, unknown> | null) {
  if (!payload) return payload;

  const stripRecord = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(record)) {
      if (key === "site_public_id" || key === "sitePublicId") {
        delete record[key];
      }
    }
    return record;
  };

  const stripped: Record<string, unknown> = stripRecord(payload) as Record<string, unknown>;
  if (stripped.site && typeof stripped.site === "object" && !Array.isArray(stripped.site)) {
    const siteRecord = { ...(stripped.site as Record<string, unknown>) };
    delete siteRecord.site_public_id;
    delete siteRecord.sitePublicId;
    delete siteRecord.public_id;
    stripped.site = siteRecord;
  }
  if (Array.isArray(stripped.records)) {
    stripped.records = stripped.records.map(stripRecord);
  }
  if (Array.isArray(stripped.events)) {
    stripped.events = stripped.events.map(stripRecord);
  }
  return stripped;
}

function withUpstreamProjectKey(
  payload: Record<string, unknown> | null,
  projectKey: string,
) {
  if (!payload || !projectKey) return payload;
  return {
    ...payload,
    project_key: projectKey,
    projectKey,
  };
}

function withUpstreamEnvelope(
  payload: Record<string, unknown> | null,
  req: NextRequest,
) {
  if (!payload) return payload;
  return {
    ...payload,
    sdk_version: String(payload.sdk_version || payload.sdkVersion || req.headers.get("x-cavbot-sdk-version") || "app-proxy").trim(),
    sdkVersion: String(payload.sdkVersion || payload.sdk_version || req.headers.get("x-cavbot-sdk-version") || "app-proxy").trim(),
    env: String(payload.env || req.headers.get("x-cavbot-env") || "production").trim(),
  };
}

function fallbackWorkerProjectKey() {
  return String(
    FIRST_PARTY_WORKER_PROJECT_KEY ||
      process.env.CAVBOT_PROJECT_KEY ||
      process.env.CAVBOT_SECRET_KEY ||
      process.env.NEXT_PUBLIC_CAVBOT_PROJECT_KEY ||
      "",
  ).trim();
}

function buildRemoteHeaders(
  req: NextRequest,
  verification: Extract<EmbedVerifierResult, { ok: true }>
) {
  const projectKey = fallbackWorkerProjectKey() || verification.projectKey;
  const siteHost = hostFromOrigin(verification.siteOrigin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: verification.siteOrigin,
    "X-Cavbot-Project-Id": String(verification.projectId),
    "X-Cavbot-Verified-Site-Id": verification.siteId,
    "X-Cavbot-Site-Origin": verification.siteOrigin,
  };
  if (siteHost) headers["X-Cavbot-Site-Host"] = siteHost;

  if (projectKey) {
    headers["X-Project-Key"] = projectKey;
  }
  headers["X-Cavbot-Sdk-Version"] = req.headers.get("x-cavbot-sdk-version") || "app-proxy";
  headers["X-Cavbot-Env"] = req.headers.get("x-cavbot-env") || "production";
  const adminToken = getEnv().adminToken;
  if (adminToken) {
    headers["X-Admin-Token"] = adminToken;
  }
  const clientIp = forwardedClientIp(req);
  if (clientIp) {
    headers["X-Forwarded-For"] = clientIp;
    if (adminToken) {
      headers["X-Cavbot-Forwarded-Client-IP"] = clientIp;
    }
  }

  return headers;
}

function getProjectKeyFromRequest(req: NextRequest, payload: Record<string, unknown> | null) {
  const url = new URL(req.url);
  const candidates = [
    req.headers.get("x-cavbot-project-key"),
    req.headers.get("x-project-key"),
    url.searchParams.get("projectKey"),
    typeof payload?.projectKey === "string" ? payload.projectKey : null,
    typeof payload?.project_key === "string" ? payload.project_key : null,
  ];
  for (const candidate of candidates) {
    const trimmed = String(candidate || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function buildUnverifiedRemoteHeaders(req: NextRequest, payload: Record<string, unknown> | null) {
  const projectKey = getProjectKeyFromRequest(req, payload);
  if (!projectKey) return null;
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Project-Key": projectKey,
  };
  if (origin) {
    try {
      headers.Origin = new URL(origin).origin;
    } catch {
      headers.Origin = origin;
    }
  }
  headers["X-Cavbot-Sdk-Version"] = req.headers.get("x-cavbot-sdk-version") || "app-proxy";
  headers["X-Cavbot-Env"] = req.headers.get("x-cavbot-env") || "production";
  const siteHost = req.headers.get("x-cavbot-site-host");
  if (siteHost) headers["X-Cavbot-Site-Host"] = siteHost;
  const siteOrigin = req.headers.get("x-cavbot-site-origin");
  if (siteOrigin) headers["X-Cavbot-Site-Origin"] = siteOrigin;
  const clientIp = forwardedClientIp(req);
  if (clientIp) headers["X-Cavbot-Forwarded-Client-IP"] = clientIp;
  return headers;
}

function isWorkerUnregisteredOriginResponse(status: number, text: string) {
  if (status !== 403) return false;
  try {
    const body = JSON.parse(text);
    return body?.error === "unregistered_origin";
  } catch {
    return text.includes("unregistered_origin");
  }
}

function isWorkerInvalidProjectKeyResponse(status: number, text: string) {
  if (status !== 401 && status !== 403) return false;
  try {
    const body = JSON.parse(text);
    return body?.error === "invalid_project_key";
  } catch {
    return text.includes("invalid_project_key");
  }
}

async function registerVerifiedSiteForWorkerBestEffort(
  verification: Extract<EmbedVerifierResult, { ok: true }>
) {
  const label = hostFromOrigin(verification.siteOrigin) || verification.siteOrigin;
  try {
    await registerWorkerSite(verification.projectId, verification.siteOrigin, label);
    return true;
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status === 409) return true;
    console.error("[embed/analytics] worker site auto-sync failed", error);
    return false;
  }
}

async function proxyToRemote(args: {
  req: NextRequest;
  payload: Record<string, unknown> | null;
  activityPayload?: Record<string, unknown> | null;
  headers: Record<string, string>;
  corsOrigin: string | null;
  verification?: Extract<EmbedVerifierResult, { ok: true }>;
}) {
  const { baseUrl } = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const upstreamProjectKey = String(args.headers["X-Project-Key"] || "").trim();
  const upstreamPayloadBase = withUpstreamEnvelope(stripUpstreamSitePublicIds(args.payload), args.req);
  const upstreamPayload = args.verification
    ? withUpstreamProjectKey(upstreamPayloadBase, upstreamProjectKey)
    : upstreamPayloadBase;

  try {
    const send = () =>
      fetch(`${baseUrl}/v1/events`, {
        method: "POST",
        headers: args.headers,
        body: upstreamPayload ? JSON.stringify(upstreamPayload) : undefined,
        cache: "no-store",
        credentials: "omit",
        keepalive: true,
        mode: "cors",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

    let response = await send();
    let text = await response.text().catch(() => "");
    if (
      args.verification &&
      isWorkerUnregisteredOriginResponse(response.status, text) &&
      (await registerVerifiedSiteForWorkerBestEffort(args.verification))
    ) {
      response = await send();
      text = await response.text().catch(() => "");
    }
    if (
      args.verification &&
      (response.ok || isWorkerInvalidProjectKeyResponse(response.status, text))
    ) {
      await recordAnalyticsEmbedActivityBestEffort({
        req: args.req,
        accountId: args.verification.accountId,
        projectId: args.verification.projectId,
        siteId: args.verification.siteId,
        origin: args.verification.origin || args.verification.siteOrigin,
        siteOrigin: args.verification.siteOrigin,
        payload: args.activityPayload || args.payload,
        keyLast4: args.verification.keyLast4,
      });
      if (!response.ok) {
        return NextResponse.json(
          {
            ok: true,
            accepted: true,
            degraded: true,
            reason: "UPSTREAM_PROJECT_KEY_SYNC_PENDING",
          },
          {
            status: 202,
            headers: corsHeaders(args.corsOrigin),
          },
        );
      }
    }
    const responseHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") || "application/json",
      ...corsHeaders(args.corsOrigin),
    };
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) responseHeaders["Retry-After"] = retryAfter;

    return new NextResponse(text, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const isTimeout = (error as { name?: string } | null)?.name === "AbortError";
    return NextResponse.json(
      { ok: false, error: isTimeout ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR" },
      {
        status: isTimeout ? 504 : 502,
        headers: corsHeaders(args.corsOrigin),
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyUnverifiedToRemote(req: NextRequest, payload: Record<string, unknown> | null) {
  const fallbackHeaders = buildUnverifiedRemoteHeaders(req, payload);
  const origin = req.headers.get("origin");
  if (!fallbackHeaders) {
    return NextResponse.json(
      { ok: false, allowed: false, code: "MISSING_PROJECT_KEY" },
      { status: 401, headers: corsHeaders(origin) },
    );
  }

  return proxyToRemote({
    req,
    payload: stripUpstreamSitePublicIds(payload),
    headers: fallbackHeaders,
    corsOrigin: origin,
  });
}

function getSiteIdFromPayload(payload: Record<string, unknown> | null, req: NextRequest) {
  const objectSite =
    payload?.site && typeof payload.site === "object"
      ? String((payload.site as Record<string, unknown>).site_public_id ?? "")
      : "";
  const fallback = String(payload?.site_id ?? payload?.siteId ?? payload?.site ?? "");
  const trimmed = (objectSite || fallback).trim();
  const headerSite =
    req.headers.get("x-cavbot-site") ||
    req.headers.get("X-Cavbot-Site") ||
    req.headers.get("X-Cavbot-Site-Public-Id") ||
    "";
  if (headerSite.trim()) return headerSite.trim();
  if (trimmed) return trimmed;
  return null;
}

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, ctx: { env?: RateLimitEnv }) {
  try {
    return await withEmbedAnalyticsDeadline(() => handlePost(req, ctx));
  } catch (error) {
    if (error === EMBED_ANALYTICS_DEADLINE) {
      return NextResponse.json(
        { ok: false, error: "EMBED_ANALYTICS_TIMEOUT" },
        {
          status: 504,
          headers: corsHeaders(req.headers.get("origin")),
        }
      );
    }
    throw error;
  }
}

function withEmbedAnalyticsDeadline<T>(work: () => Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    work(),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(EMBED_ANALYTICS_DEADLINE), EMBED_ANALYTICS_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function handlePost(req: NextRequest, ctx: { env?: RateLimitEnv }) {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  const payload = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;

  let verification: EmbedVerifierResult;
  try {
    const tokenVerification = await verifyEmbedToken({
      req,
      requiredScopes: ["analytics:events"],
      expectedSiteId: getSiteIdFromPayload(payload, req),
    });

    if (tokenVerification.ok) {
      verification = tokenVerification;
    } else {
      verification = await verifyEmbedRequest({
        req,
        env: ctx.env,
        body: payload,
        rateLimit: false,
        recordMetrics: false,
      });
    }
  } catch (error) {
    console.error("[embed/analytics] app-side verifier failed; falling back to upstream verification", error);
    try {
      return await proxyUnverifiedToRemote(req, payload);
    } catch {
      const origin = req.headers.get("origin");
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_ERROR" },
        { status: 502, headers: corsHeaders(origin) },
      );
    }
  }

  if (!verification.ok) {
    try {
      const proxied = await proxyUnverifiedToRemote(req, payload);
      if (proxied.ok || proxied.status !== 401) return proxied;
    } catch (error) {
      console.error("[embed/analytics] upstream verification fallback failed", error);
    }

    const origin = verification.origin ?? req.headers.get("origin");
    const headers = corsHeaders(origin);
    if (verification.retryAfterSec && verification.retryAfterSec > 0) {
      headers["Retry-After"] = String(verification.retryAfterSec);
    }
    return NextResponse.json(
      { ok: false, allowed: false, code: verification.code },
      {
        status: verification.status,
        headers,
      }
    );
  }

  try {
    const canonicalPayload = canonicalizeVerifiedPayload(payload, verification);
    recordAnalyticsEmbedActivityBestEffort({
      req,
      accountId: verification.accountId,
      projectId: verification.projectId,
      siteId: verification.siteId,
      origin: verification.origin || verification.siteOrigin,
      siteOrigin: verification.siteOrigin,
      payload: canonicalPayload,
      keyLast4: verification.keyLast4,
    }).catch((error) => {
      console.error("[embed/analytics] local activity tracking failed after accept", error);
    });

    proxyToRemote({
      req,
      payload: canonicalPayload,
      activityPayload: canonicalPayload,
      headers: buildRemoteHeaders(req, verification),
      corsOrigin: verification.origin ?? req.headers.get("origin"),
      verification,
    }).catch((error) => {
      console.error("[embed/analytics] upstream sync failed after local accept", error);
    });

    return NextResponse.json(
      { ok: true, accepted: true },
      {
        status: 202,
        headers: corsHeaders(verification.origin ?? req.headers.get("origin")),
      },
    );
  } catch {
    const origin = verification.origin ?? req.headers.get("origin");
    return NextResponse.json(
      { ok: false, error: "UPSTREAM_ERROR" },
      {
        status: 502,
        headers: corsHeaders(origin),
      }
    );
  }
}
