import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { adminJson } from "@/lib/admin/api";
import { requireActiveStaffSession } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    return adminJson({
      ok: false,
      error: "CHAT_SOCKET_NOT_ENABLED",
      message: "Realtime websocket handoff is not enabled for this HQ deployment.",
    }, 501);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({ ok: false, error: "CHAT_SOCKET_FAILED" }, 500);
  }
}
