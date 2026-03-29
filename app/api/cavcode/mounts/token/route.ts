import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { ApiAuthError, getAppOrigin, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import {
  CavCodeMountError,
  ensureMountedObjectAccessible,
  normalizeMountSourceType,
} from "@/lib/cavcode/mounts.server";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { mintCavSafeObjectToken } from "@/lib/cavsafe/tokens.server";
import { assertCavCloudActionAllowed, assertCavCodeProjectAccess } from "@/lib/cavcloud/permissions.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type TokenBody = {
  projectId?: unknown;
  r2Key?: unknown;
  mimeType?: unknown;
  sourceType?: unknown;
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

function parseProjectId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
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
  if (err instanceof ApiAuthError) {
    return jsonNoStore({ ok: false, code: err.code, message: err.code }, err.status);
  }

  const status = Number((err as { status?: unknown })?.status || 500);
  if (status === 401 || status === 403) {
    return jsonNoStore({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" }, status);
  }
  return jsonNoStore({ ok: false, code: "INTERNAL", message: fallbackMessage }, 500);
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as TokenBody | null;
    if (!body) return jsonNoStore({ ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const projectId = parseProjectId(body.projectId);
    const r2Key = String(body.r2Key || "").trim();
    if (!projectId) {
      return jsonNoStore({ ok: false, code: "PROJECT_ID_REQUIRED", message: "projectId is required." }, 400);
    }
    if (!r2Key) {
      return jsonNoStore({ ok: false, code: "R2_KEY_REQUIRED", message: "r2Key is required." }, 400);
    }
    const requestedSourceType = normalizeMountSourceType(body.sourceType);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "MOUNT_CAVCODE",
      errorCode: "UNAUTHORIZED",
    });
    await assertCavCodeProjectAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      projectId,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    let includeCavsafe = false;
    if (sess.memberRole === "OWNER") {
      try {
        const plusSess = await requireCavsafePremiumPlusSession(req);
        includeCavsafe = plusSess.accountId === sess.accountId;
      } catch {
        includeCavsafe = false;
      }
    }

    const reqOrigin = normalizeOriginOrNull(req.headers.get("origin")) || refererOrigin(req.headers.get("referer"));
    if (reqOrigin && !isAllowedMountOrigin(reqOrigin)) {
      return jsonNoStore({ ok: false, code: "ORIGIN_FORBIDDEN", message: "Origin is not allowed." }, 403);
    }

    await ensureMountedObjectAccessible({
      accountId: sess.accountId,
      projectId,
      objectKey: r2Key,
      sourceType: requestedSourceType,
      includeCavsafe,
    });

    const ttlSeconds = 60;
    const origin = reqOrigin && isAllowedMountOrigin(reqOrigin) ? reqOrigin : configuredAppOrigin();
    const token =
      requestedSourceType === "CAVSAFE"
        ? mintCavSafeObjectToken({
            origin,
            objectKey: r2Key,
            ttlSeconds,
          })
        : mintCavCloudObjectToken({
            origin,
            objectKey: r2Key,
            ttlSeconds,
          });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    return jsonNoStore({
      ok: true,
      sourceType: requestedSourceType,
      token,
      expiresAt,
      mimeType: String(body.mimeType || "").trim() || null,
    }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to mint mount token.");
  }
}
