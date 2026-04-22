import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { syncAdminRollups } from "@/lib/admin/rollups";
import { requireAdminAccess } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function hasRollupSecret(req: Request) {
  const secret = String(process.env.ADMIN_ROLLUP_CRON_SECRET || "").trim();
  if (!secret) return false;
  const header = String(req.headers.get("x-admin-rollup-secret") || "").trim();
  return header === secret;
}

export async function POST(req: NextRequest) {
  try {
    if (!hasRollupSecret(req)) {
      await requireAdminAccess(req, { scopes: ["settings.write"] });
    }

    const result = await syncAdminRollups();
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiAuthError) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "ROLLUP_SYNC_FAILED" }, 500);
  }
}
