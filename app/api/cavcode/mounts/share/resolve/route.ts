import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { CavCodeMountError, resolveMountedFileForShare } from "@/lib/cavcode/mounts.server";

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

function safeNumberFromBigInt(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function parseBoolFlag(raw: unknown): boolean {
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function handleRouteError(err: unknown, fallbackMessage: string) {
  if (err instanceof CavCodeMountError) {
    return jsonNoStore({ ok: false, code: err.code, message: err.message }, err.status);
  }
  return jsonNoStore({ ok: false, code: "INTERNAL", message: fallbackMessage }, 500);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const shareId = String(url.searchParams.get("shareId") || "").trim();
    const path = String(url.searchParams.get("path") || "").trim();
    const htmlFallback = parseBoolFlag(url.searchParams.get("htmlFallback"));
    if (!shareId) {
      return jsonNoStore({ ok: false, code: "SHARE_ID_REQUIRED", message: "shareId is required." }, 400);
    }
    if (!path) {
      return jsonNoStore({ ok: false, code: "PATH_REQUIRED", message: "path is required." }, 400);
    }

    const resolved = await resolveMountedFileForShare({
      shareId,
      requestPath: path,
      htmlFallback,
    });

    if (!resolved) {
      return jsonNoStore({ ok: false, code: "NOT_FOUND" }, 404);
    }

    return jsonNoStore({
      ok: true,
      sourceType: "CAVCLOUD",
      fileId: resolved.fileId,
      r2Key: resolved.r2Key,
      mimeType: resolved.mimeType,
      bytes: safeNumberFromBigInt(resolved.bytes),
      bytesExact: resolved.bytes.toString(),
      sha256: resolved.sha256,
      cacheHintSeconds: resolved.cacheHintSeconds,
    }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to resolve shared mounted path.");
  }
}
