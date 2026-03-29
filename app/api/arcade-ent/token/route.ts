import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getAllowedOrigins, isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { mintEntertainmentAssetToken } from "@/lib/arcade/entTokens";
import { normalizeOriginStrict } from "@/originMatch";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function normalizeBasePath(value: string) {
  let v = String(value || "").trim();
  if (!v.startsWith("/")) v = `/${v}`;
  v = v.replace(/\/+$/, "");
  return v || "/";
}

function validateEntBasePath(basePath: string) {
  const normalized = normalizeBasePath(basePath);
  // Strict contract: /entertainment/<slug>/v1
  const m = normalized.match(/^\/entertainment\/([a-z0-9-]+)\/(v\d+)$/i);
  if (!m) throw new Error("Invalid basePath.");
  const version = m[2].toLowerCase();
  if (version !== "v1") throw new Error("Invalid version.");
  return normalized;
}

function allowedOriginsSet(): Set<string> {
  return new Set(getAllowedOrigins());
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const originHeader = req.headers.get("origin");
    if (!originHeader) return json({ ok: false, error: "ORIGIN_MISSING" }, 400);
    let origin: string;
    try {
      origin = normalizeOriginStrict(originHeader);
    } catch {
      return json({ ok: false, error: "ORIGIN_INVALID" }, 400);
    }
    if (!allowedOriginsSet().has(origin)) {
      return json({ ok: false, error: "ORIGIN_FORBIDDEN" }, 403);
    }

    const body = (await readSanitizedJson(req, null)) as { basePath?: string } | null;
    const basePath = validateEntBasePath(String(body?.basePath || ""));

    const token = mintEntertainmentAssetToken({ origin, basePath, ttlSeconds: 240 });
    return json({ ok: true, token });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, error: error.code || "UNAUTHORIZED" }, error.status || 401);
    }
    console.error("[api/arcade-ent/token] mint failed", error);
    return json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  }
}
