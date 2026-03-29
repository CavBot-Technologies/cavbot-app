import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { verifyArcadeAssetToken } from "@/lib/arcade/tokens";

const DEFAULT_ARCADE_CDN_BASE = "https://cdn.cavbot.io";

function resolveArcadeCdnBase() {
  const candidate = String(
    process.env.CAVBOT_ARCADE_CDN_BASE_URL ||
      process.env.CAVBOT_CDN_BASE_URL ||
      process.env.NEXT_PUBLIC_CAVBOT_CDN_BASE_URL ||
      DEFAULT_ARCADE_CDN_BASE
  )
    .trim()
    .replace(/\/+$/, "");
  return candidate || DEFAULT_ARCADE_CDN_BASE;
}

function corsHeaders(origin: string | null) {
  return {
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin || "*",
  };
}

function contentType(headers: Headers) {
  const value = String(headers.get("content-type") || "").trim();
  return value || "application/octet-stream";
}

function cacheControl(headers: Headers) {
  const value = String(headers.get("cache-control") || "").trim();
  return value || "public, max-age=60";
}

function statusFromUpstream(status: number) {
  if (status === 401 || status === 403) return 403;
  if (status === 404) return 404;
  if (status >= 500) return 502;
  if (status >= 400) return 400;
  return status;
}

export async function OPTIONS(req: NextRequest) {
  return NextResponse.json(null, {
    status: 204,
    headers: {
      ...corsHeaders(req.headers.get("origin")),
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: { token?: string; path?: string[] } }) {
  const origin = req.headers.get("origin");
  const responseCors = corsHeaders(origin);

  const token = params?.token;
  const segments = params?.path ?? [];
  if (!token || !segments.length) {
    return NextResponse.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400, headers: responseCors });
  }

  const verification = verifyArcadeAssetToken(token);
  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, error: verification.reason || "TOKEN_INVALID" },
      { status: 403, headers: responseCors }
    );
  }

  const requestedPath = `/${segments.join("/")}`;
  if (!requestedPath.startsWith(verification.payload.basePath)) {
    return NextResponse.json({ ok: false, error: "TOKEN_MISMATCH" }, { status: 403, headers: responseCors });
  }

  const upstreamUrl = `${resolveArcadeCdnBase()}/arcade${requestedPath}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: verification.payload.origin,
        Accept: String(req.headers.get("accept") || "*/*"),
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: "UPSTREAM_REJECTED", status: upstream.status },
        {
          status: statusFromUpstream(upstream.status),
          headers: responseCors,
        }
      );
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        ...responseCors,
        "Content-Type": contentType(upstream.headers),
        "Cache-Control": cacheControl(upstream.headers),
      },
    });
  } catch (error) {
    console.error("[arcade/assets] upstream delivery failed", error);
    return NextResponse.json({ ok: false, error: "DELIVERY_FAILED" }, { status: 502, headers: responseCors });
  }
}
