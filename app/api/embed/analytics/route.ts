import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/cavbotApi.server";
import { verifyEmbedRequest, type EmbedVerifierResult } from "@/lib/security/embedVerifier";
import { verifyEmbedToken } from "@/lib/security/embedToken";
import { RateLimitEnv } from "@/rateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

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

function buildRemoteHeaders(
  req: NextRequest,
  payload: Record<string, unknown> | null,
  verification: Extract<EmbedVerifierResult, { ok: true }>
) {
  const projectKey = verification.projectKey;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: verification.origin,
    "X-Cavbot-Project-Id": String(verification.projectId),
    "X-Cavbot-Verified-Site-Id": verification.siteId,
  };

  if (projectKey) {
    headers["X-Project-Key"] = projectKey;
  }
  const sdkVersion = req.headers.get("x-cavbot-sdk-version");
  if (sdkVersion) {
    headers["X-Cavbot-Sdk-Version"] = sdkVersion;
  }
  const env = req.headers.get("x-cavbot-env");
  if (env) {
    headers["X-Cavbot-Env"] = env;
  }
  const siteHost = req.headers.get("x-cavbot-site-host");
  if (siteHost) {
    headers["X-Cavbot-Site-Host"] = siteHost;
  }
  const siteOrigin = req.headers.get("x-cavbot-site-origin");
  if (siteOrigin) {
    headers["X-Cavbot-Site-Origin"] = siteOrigin;
  }
  const sitePublicId =
    (payload?.site && typeof payload.site === "object" && "site_public_id" in payload.site
      ? String((payload.site as Record<string, unknown>).site_public_id ?? "")
      : "") || "";
  const sitePublicIdHeader =
    sitePublicId ||
    req.headers.get("x-cavbot-site-public-id") ||
    req.headers.get("x-cavbot-site") ||
    "";
  if (sitePublicIdHeader) {
    headers["X-Cavbot-Site-Public-Id"] = sitePublicIdHeader;
  }
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
  const sdkVersion = req.headers.get("x-cavbot-sdk-version");
  if (sdkVersion) headers["X-Cavbot-Sdk-Version"] = sdkVersion;
  const env = req.headers.get("x-cavbot-env");
  if (env) headers["X-Cavbot-Env"] = env;
  const siteHost = req.headers.get("x-cavbot-site-host");
  if (siteHost) headers["X-Cavbot-Site-Host"] = siteHost;
  const siteOrigin = req.headers.get("x-cavbot-site-origin");
  if (siteOrigin) headers["X-Cavbot-Site-Origin"] = siteOrigin;
  const sitePublicId =
    (payload?.site && typeof payload.site === "object" && "site_public_id" in payload.site
      ? String((payload.site as Record<string, unknown>).site_public_id ?? "")
      : "") ||
    req.headers.get("x-cavbot-site-public-id") ||
    req.headers.get("x-cavbot-site") ||
    "";
  if (sitePublicId) headers["X-Cavbot-Site-Public-Id"] = sitePublicId;
  const clientIp = forwardedClientIp(req);
  if (clientIp) headers["X-Cavbot-Forwarded-Client-IP"] = clientIp;
  return headers;
}

async function proxyToRemote(args: {
  req: NextRequest;
  payload: Record<string, unknown> | null;
  headers: Record<string, string>;
  corsOrigin: string | null;
}) {
  const { baseUrl } = getEnv();
  const response = await fetch(`${baseUrl}/v1/events`, {
    method: "POST",
    headers: args.headers,
    body: args.payload ? JSON.stringify(args.payload) : undefined,
    cache: "no-store",
    credentials: "omit",
    keepalive: true,
    mode: "cors",
    referrerPolicy: "no-referrer",
  });

  const text = await response.text().catch(() => "");
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
      verification = await verifyEmbedRequest({ req, env: ctx.env, body: payload, rateLimit: false });
    }
  } catch (error) {
    console.error("[embed/analytics] app-side verifier failed; falling back to upstream verification", error);
    const fallbackHeaders = buildUnverifiedRemoteHeaders(req, payload);
    const origin = req.headers.get("origin");
    if (!fallbackHeaders) {
      return NextResponse.json(
        { ok: false, allowed: false, code: "MISSING_PROJECT_KEY" },
        { status: 401, headers: corsHeaders(origin) },
      );
    }
    try {
      return await proxyToRemote({
        req,
        payload,
        headers: fallbackHeaders,
        corsOrigin: origin,
      });
    } catch {
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_ERROR" },
        { status: 502, headers: corsHeaders(origin) },
      );
    }
  }

  if (!verification.ok) {
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
    return await proxyToRemote({
      req,
      payload,
      headers: buildRemoteHeaders(req, payload, verification),
      corsOrigin: verification.origin ?? req.headers.get("origin"),
    });
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
