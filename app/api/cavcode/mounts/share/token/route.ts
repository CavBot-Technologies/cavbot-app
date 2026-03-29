import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { getAppOrigin } from "@/lib/apiAuth";
import { CavCodeMountError, ensureSharedObjectAccessible } from "@/lib/cavcode/mounts.server";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type TokenBody = {
  shareId?: unknown;
  r2Key?: unknown;
  mimeType?: unknown;
};

function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function normalizeOriginOrNull(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function refererOrigin(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function configuredAppOrigin(): string {
  const env = normalizeOriginOrNull(process.env.CAVBOT_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "");
  if (env) return env;
  return getAppOrigin();
}

function allowedMountOrigins(): string[] {
  const out = new Set<string>();
  out.add(configuredAppOrigin());
  if (process.env.NODE_ENV !== "production") {
    const dev = normalizeOriginOrNull(process.env.CAVBOT_DEV_ORIGIN || "");
    if (dev) out.add(dev);
  }
  return Array.from(out);
}

function isAllowedMountOrigin(origin: string): boolean {
  const normalized = normalizeOriginOrNull(origin);
  if (!normalized) return false;
  return allowedMountOrigins().includes(normalized);
}

function handleRouteError(err: unknown, fallbackMessage: string) {
  if (err instanceof CavCodeMountError) {
    return jsonNoStore({ ok: false, code: err.code, message: err.message }, err.status);
  }
  return jsonNoStore({ ok: false, code: "INTERNAL", message: fallbackMessage }, 500);
}

export async function POST(req: Request) {
  try {
    const body = (await readSanitizedJson(req, null)) as TokenBody | null;
    if (!body) return jsonNoStore({ ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const shareId = String(body.shareId || "").trim();
    const r2Key = String(body.r2Key || "").trim();
    if (!shareId) {
      return jsonNoStore({ ok: false, code: "SHARE_ID_REQUIRED", message: "shareId is required." }, 400);
    }
    if (!r2Key) {
      return jsonNoStore({ ok: false, code: "R2_KEY_REQUIRED", message: "r2Key is required." }, 400);
    }

    const reqOrigin = normalizeOriginOrNull(req.headers.get("origin")) || refererOrigin(req.headers.get("referer"));
    if (reqOrigin && !isAllowedMountOrigin(reqOrigin)) {
      return jsonNoStore({ ok: false, code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed." }, 403);
    }

    await ensureSharedObjectAccessible({
      shareId,
      objectKey: r2Key,
    });

    const ttlSeconds = 60;
    const origin = reqOrigin && isAllowedMountOrigin(reqOrigin) ? reqOrigin : configuredAppOrigin();
    const token = mintCavCloudObjectToken({
      origin,
      objectKey: r2Key,
      ttlSeconds,
    });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    return jsonNoStore({
      ok: true,
      token,
      expiresAt,
      mimeType: String(body.mimeType || "").trim() || null,
    }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to mint shared mount token.");
  }
}
