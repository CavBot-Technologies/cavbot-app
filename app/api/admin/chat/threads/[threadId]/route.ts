import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson, safeId } from "@/lib/admin/api";
import { archiveAdminChatThread, getAdminChatThread, markAdminChatThreadRead, setAdminChatThreadStarred } from "@/lib/admin/chat.server";
import { requireActiveStaffSession } from "@/lib/admin/staff";
import { readSanitizedJson } from "@/lib/security/userInput";

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

export async function GET(req: NextRequest, { params }: { params: { threadId: string } }) {
  try {
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    const url = new URL(req.url);
    const thread = await getAdminChatThread({
      viewer: toViewer(ctx.staff),
      threadId: params.threadId,
      mailboxUserId: url.searchParams.get("mailboxUserId"),
    });
    return adminJson({ ok: true, thread });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_THREAD_READ_FAILED",
    }, 500);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { threadId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.write"] });
    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const action = safeId(body.action).toLowerCase();
    const mailboxUserId = safeId(body.mailboxUserId) || null;

    if (action === "mark_read") {
      await markAdminChatThreadRead({
        viewer: toViewer(ctx.staff),
        threadId: params.threadId,
        mailboxUserId,
      });
    } else if (action === "star" || action === "unstar") {
      await setAdminChatThreadStarred({
        viewer: toViewer(ctx.staff),
        threadId: params.threadId,
        mailboxUserId,
        starred: action === "star" ? true : Boolean(body.starred),
      });
    } else {
      await archiveAdminChatThread({
        viewer: toViewer(ctx.staff),
        threadId: params.threadId,
        mailboxUserId,
        archived: action === "archive" ? true : Boolean(body.archived),
      });
    }

    const thread = await getAdminChatThread({
      viewer: toViewer(ctx.staff),
      threadId: params.threadId,
      mailboxUserId,
    });
    return adminJson({ ok: true, thread });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_THREAD_UPDATE_FAILED",
    }, 500);
  }
}
