import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { runSitePurgeJob } from "@/lib/siteDeletion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function getAdminToken() {
  return String(process.env.CAVBOT_ADMIN_TOKEN || "").trim();
}

function verifyToken(req: NextRequest) {
  const raw = req.headers.get("x-admin-token") || req.headers.get("authorization") || "";
  if (!raw) return null;
  if (/^Bearer /i.test(raw)) return raw.replace(/^Bearer\s+/i, "").trim();
  return raw.trim();
}

export async function POST(req: NextRequest) {
  const token = verifyToken(req);
  const admin = getAdminToken();
  if (!admin) {
    return json({ error: "ADMIN_TOKEN_NOT_CONFIGURED" }, 500);
  }
  if (!token || token !== admin) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const purged = await runSitePurgeJob();
    return json({ ok: true, purged: purged.length, siteIds: purged }, 200);
  } catch (error: unknown) {
    console.error("[site-purge-job] failure", error);
    return json(
      { ok: false, error: "PURGE_JOB_FAILED", message: String((error as { message?: unknown })?.message || error) },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
