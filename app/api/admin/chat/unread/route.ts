import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { adminJson } from "@/lib/admin/api";
import { getAdminChatUnreadCount } from "@/lib/admin/chat.server";
import { requireActiveStaffSession } from "@/lib/admin/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toViewer(staff: { id: string; userId: string; systemRole: string; scopes: string[] | null }) {
  return {
    id: staff.id,
    userId: staff.userId,
    systemRole: staff.systemRole,
    scopes: staff.scopes,
  };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    const url = new URL(req.url);
    const unread = await getAdminChatUnreadCount({
      viewer: toViewer(ctx.staff),
      mailboxUserId: url.searchParams.get("mailboxUserId"),
      includeOrgBoxes: url.searchParams.get("includeOrgBoxes") === "1",
    });
    return adminJson({ ok: true, ...unread });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_UNREAD_FAILED",
    }, 500);
  }
}
