import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { CavCodeMountError, resolveMountedFile } from "@/lib/cavcode/mounts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function parseBoolFlag(raw: unknown): boolean {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function safeNumberFromBigInt(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
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

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const url = new URL(req.url);
    const projectId = parseProjectId(url.searchParams.get("projectId"));
    const path = String(url.searchParams.get("path") || "").trim();
    const htmlFallback = parseBoolFlag(url.searchParams.get("htmlFallback"));
    if (!projectId) {
      return jsonNoStore({ ok: false, code: "PROJECT_ID_REQUIRED", message: "projectId is required." }, 400);
    }
    if (!path) {
      return jsonNoStore({ ok: false, code: "PATH_REQUIRED", message: "path is required." }, 400);
    }

    let includeCavsafe = false;
    if (sess.memberRole === "OWNER") {
      try {
        const plusSess = await requireCavsafePremiumPlusSession(req);
        includeCavsafe = plusSess.accountId === sess.accountId;
      } catch {
        includeCavsafe = false;
      }
    }

    const resolved = await resolveMountedFile({
      accountId: sess.accountId,
      projectId,
      requestPath: path,
      includeCavsafe,
      htmlFallback,
    });

    if (!resolved) {
      // Generic miss response to avoid leaking mount/folder existence.
      return jsonNoStore({ ok: false, code: "NOT_FOUND" }, 404);
    }

    return jsonNoStore({
      ok: true,
      sourceType: resolved.sourceType,
      fileId: resolved.fileId,
      r2Key: resolved.r2Key,
      mimeType: resolved.mimeType,
      bytes: safeNumberFromBigInt(resolved.bytes),
      bytesExact: resolved.bytes.toString(),
      sha256: resolved.sha256,
      cacheHintSeconds: resolved.cacheHintSeconds,
    }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to resolve mounted path.");
  }
}
