import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson, safeId } from "@/lib/admin/api";
import { saveAdminChatDraft } from "@/lib/admin/chat.server";
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

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.write"] });
    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const draft = await saveAdminChatDraft({
      viewer: toViewer(ctx.staff),
      threadId: safeId(body.threadId),
      mailboxUserId: safeId(body.mailboxUserId) || null,
      body: String(body.body || ""),
      attachmentIds: Array.isArray(body.attachmentIds) ? body.attachmentIds.map((value) => safeId(value)).filter(Boolean) : [],
    });
    return adminJson({ ok: true, draft });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_DRAFT_SAVE_FAILED",
    }, 500);
  }
}
