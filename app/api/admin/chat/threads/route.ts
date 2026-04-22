import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson, safeId } from "@/lib/admin/api";
import { ensureDirectAdminChatThread, getAdminChatThread, listAdminChatThreads, postAdminChatMessage } from "@/lib/admin/chat.server";
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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    const url = new URL(req.url);
    const search = url.searchParams.get("search");
    const mailboxUserId = url.searchParams.get("mailboxUserId");
    const includeOrgBoxes = url.searchParams.get("includeOrgBoxes") === "1";
    const threads = await listAdminChatThreads({
      viewer: toViewer(ctx.staff),
      mailboxUserId,
      search,
      includeOrgBoxes,
    });
    return adminJson({ ok: true, threads });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_THREADS_READ_FAILED",
    }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.write"] });
    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const participantUserIds = Array.isArray(body.participantUserIds)
      ? body.participantUserIds.map((value) => safeId(value)).filter(Boolean)
      : [];

    const thread = await ensureDirectAdminChatThread({
      viewer: toViewer(ctx.staff),
      participantUserIds,
      subject: safeId(body.subject) || null,
    });

    const initialMessage = String(body.initialMessage || "").trim();
    if (initialMessage) {
      await postAdminChatMessage({
        viewer: toViewer(ctx.staff),
        threadId: thread.id,
        body: initialMessage,
      });
    }

    const detail = await getAdminChatThread({
      viewer: toViewer(ctx.staff),
      threadId: thread.id,
    });

    return adminJson({ ok: true, thread: detail });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_THREAD_CREATE_FAILED",
    }, 500);
  }
}
