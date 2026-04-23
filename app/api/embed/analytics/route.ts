import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/cavbotApi.server";
import { verifyEmbedRequest, type EmbedVerifierResult } from "@/lib/security/embedVerifier";
import { verifyEmbedToken } from "@/lib/security/embedToken";
import { recordAnalyticsEmbedActivityBestEffort } from "@/lib/security/embedAnalyticsTracker.server";
import { RateLimitEnv } from "@/rateLimit";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  canonicalizeWebsiteContextHost,
  canonicalizeWebsiteContextOrigin,
  canonicalizeWebsiteContextUrl,
  originsShareWebsiteContext,
} from "@/originMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function corsHeaders(req: NextRequest, origin: string | null) {
  const requestedHeaders = String(req.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const allowHeaders = Array.from(
    new Set([
      "authorization",
      "content-type",
      "x-cavbot-env",
      "x-cavbot-project-key",
      "x-cavbot-sdk-version",
      "x-cavbot-site",
      "x-cavbot-site-host",
      "x-cavbot-site-origin",
      "x-cavbot-site-public-id",
      ...requestedHeaders,
    ]),
  ).join(",");

  const headers: Record<string, string> = {
    ...NO_STORE_HEADERS,
    Vary: "Origin, Access-Control-Request-Headers",
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400",
  };
  if (!origin) {
    delete headers["Access-Control-Allow-Origin"];
  }
  return headers;
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(req, origin),
  });
}

function buildRemoteHeaders(
  req: NextRequest,
  projectKey: string,
  serverKey: string | null | undefined,
  siteOrigin: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const authKey = typeof serverKey === "string" && serverKey ? serverKey : projectKey;
  if (authKey) {
    headers["X-Project-Key"] = authKey;
  }
  const sdkVersion = req.headers.get("x-cavbot-sdk-version");
  if (sdkVersion) {
    headers["X-Cavbot-Sdk-Version"] = sdkVersion;
  }
  const env = req.headers.get("x-cavbot-env");
  if (env) {
    headers["X-Cavbot-Env"] = env;
  }

  headers["X-Cavbot-Site-Host"] = new URL(siteOrigin).host;
  headers["X-Cavbot-Site-Origin"] = siteOrigin;

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

function rewriteCanonicalSiteContext(
  value: unknown,
  canonicalSiteOrigin: string,
  canonicalSiteId: string
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteCanonicalSiteContext(item, canonicalSiteOrigin, canonicalSiteId));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (raw == null) {
      output[key] = raw;
      continue;
    }

    if (key === "siteId" || key === "site_id" || key === "site_public_id") {
      output[key] = canonicalSiteId;
      continue;
    }

    if (key === "origin" || key === "siteOrigin" || key === "site_origin") {
      if (typeof raw === "string") {
        try {
          output[key] = canonicalizeWebsiteContextOrigin(raw, canonicalSiteOrigin);
        } catch {
          output[key] = raw;
        }
      } else {
        output[key] = raw;
      }
      continue;
    }

    if (key === "host" || key === "siteHost" || key === "site_host" || key === "referrerHost" || key === "referrer_host") {
      if (typeof raw === "string") {
        output[key] = canonicalizeWebsiteContextHost(raw, canonicalSiteOrigin);
      } else {
        output[key] = raw;
      }
      continue;
    }

    if (
      key === "url" ||
      key === "href" ||
      key === "location" ||
      key === "pageUrl" ||
      key === "page_url" ||
      key === "pageHref" ||
      key === "page_href" ||
      key === "canonicalUrl" ||
      key === "canonical_url" ||
      key === "currentUrl" ||
      key === "current_url" ||
      key === "baseUrl" ||
      key === "base_url" ||
      key === "siteUrl" ||
      key === "site_url"
    ) {
      if (typeof raw === "string") {
        output[key] = canonicalizeWebsiteContextUrl(raw, canonicalSiteOrigin);
      } else {
        output[key] = raw;
      }
      continue;
    }

    if (key === "referrer" || key === "referrerUrl" || key === "referrer_url") {
      if (typeof raw === "string") {
        output[key] = canonicalizeWebsiteContextUrl(raw, canonicalSiteOrigin);
      } else {
        output[key] = raw;
      }
      continue;
    }

    if (key === "site" && raw && typeof raw === "object") {
      const nextSite = rewriteCanonicalSiteContext(raw, canonicalSiteOrigin, canonicalSiteId);
      if (nextSite && typeof nextSite === "object" && !Array.isArray(nextSite)) {
        const siteRecord = nextSite as Record<string, unknown>;
        siteRecord.site_public_id = canonicalSiteId;
        if (typeof siteRecord.origin === "string" || !("origin" in siteRecord)) {
          siteRecord.origin = canonicalSiteOrigin;
        }
      }
      output[key] = nextSite;
      continue;
    }

    output[key] = rewriteCanonicalSiteContext(raw, canonicalSiteOrigin, canonicalSiteId);
  }

  return output;
}

function stripUpstreamSitePublicIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripUpstreamSitePublicIds(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (key === "site_public_id" || key === "sitePublicId") {
      continue;
    }

    if (key === "site" && raw && typeof raw === "object" && !Array.isArray(raw)) {
      const nested = stripUpstreamSitePublicIds(raw);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const siteRecord = { ...(nested as Record<string, unknown>) };
        delete siteRecord.public_id;
        delete siteRecord.site_public_id;
        delete siteRecord.sitePublicId;
        output[key] = siteRecord;
        continue;
      }
    }

    output[key] = stripUpstreamSitePublicIds(raw);
  }

  return output;
}

export async function POST(req: NextRequest, ctx: { env?: RateLimitEnv }) {
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
    const headers = corsHeaders(req, origin);
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

  const { baseUrl, secretKey } = getEnv();
  const remoteUrl = `${baseUrl}/v1/events`;
  const responseOrigin = verification.origin ?? req.headers.get("origin");
  const canonicalSiteOrigin = verification.siteOrigin;
  const canonicalPayload = rewriteCanonicalSiteContext(payload, canonicalSiteOrigin, verification.siteId) as
    | Record<string, unknown>
    | null;
  const upstreamPayload = stripUpstreamSitePublicIds(canonicalPayload) as Record<string, unknown> | null;

  try {
    const response = await fetch(remoteUrl, {
      method: "POST",
      headers: buildRemoteHeaders(
        req,
        verification.projectKey,
        secretKey,
        canonicalSiteOrigin
      ),
      body: upstreamPayload ? JSON.stringify(upstreamPayload) : undefined,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      mode: "cors",
      referrerPolicy: "no-referrer",
    });

    const text = await response.text().catch(() => "");
    const responseHeaders: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") || "application/json",
      ...corsHeaders(req, responseOrigin),
    };
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      responseHeaders["Retry-After"] = retryAfter;
    }

    const responseBody =
      response.status === 403 && responseHeaders["Content-Type"].includes("application/json") && text
        ? (() => {
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              if (
                typeof parsed.origin === "string" &&
                originsShareWebsiteContext(parsed.origin, canonicalSiteOrigin)
              ) {
                parsed.origin = canonicalSiteOrigin;
              }
              return JSON.stringify(parsed);
            } catch {
              return text;
            }
          })()
        : text;

      if (response.ok) {
        await recordAnalyticsEmbedActivityBestEffort({
          req,
          accountId: verification.accountId,
          projectId: verification.projectId,
          siteId: verification.siteId,
          origin: canonicalSiteOrigin,
          siteOrigin: verification.siteOrigin,
          payload: canonicalPayload,
          keyLast4: verification.keyLast4,
        });
      }

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "UPSTREAM_ERROR" },
      {
        status: 502,
        headers: corsHeaders(req, responseOrigin),
      }
    );
  }
}
