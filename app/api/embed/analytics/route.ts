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

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-cavbot-project-key,x-cavbot-site",
  };
  if (!origin) {
    delete headers["Access-Control-Allow-Origin"];
  }
  return headers;
}

function handleOptions(req: NextRequest) {
  const origin = req.headers.get("origin");
  return NextResponse.json(
    { ok: true },
    {
      status: 204,
      headers: corsHeaders(origin),
    }
  );
}

function buildRemoteHeaders(
  req: NextRequest,
  payload: Record<string, unknown> | null,
  projectKey: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
  if (sitePublicId) {
    headers["X-Cavbot-Site-Public-Id"] = sitePublicId;
  }

  return headers;
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

export async function POST(req: NextRequest, ctx: { env?: RateLimitEnv }) {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }

  const payload = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;

  const tokenVerification = await verifyEmbedToken({
    req,
    requiredScopes: ["analytics:events"],
    expectedSiteId: getSiteIdFromPayload(payload, req),
  });

  let verification: EmbedVerifierResult;
  if (tokenVerification.ok) {
    verification = tokenVerification;
  } else {
    verification = await verifyEmbedRequest({ req, env: ctx.env, body: payload });
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

  const { baseUrl } = getEnv();
  const remoteUrl = `${baseUrl}/v1/events`;

  try {
    const response = await fetch(remoteUrl, {
      method: "POST",
      headers: buildRemoteHeaders(req, payload, verification.projectKey),
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      mode: "cors",
      referrerPolicy: "no-referrer",
    });

    const text = await response.text().catch(() => "");
    const origin = verification.origin ?? req.headers.get("origin");
    const responseHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") || "application/json",
      ...corsHeaders(origin),
    };
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      responseHeaders["Retry-After"] = retryAfter;
    }

    return new NextResponse(text, {
      status: response.status,
      headers: responseHeaders,
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
