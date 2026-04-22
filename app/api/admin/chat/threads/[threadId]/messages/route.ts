import "server-only";

import { Buffer } from "buffer";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson } from "@/lib/admin/api";
import { getAdminChatThread, postAdminChatMessage } from "@/lib/admin/chat.server";
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

export async function POST(req: NextRequest, { params }: { params: { threadId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.write"] });
    const contentType = req.headers.get("content-type") || "";
    let body = "";
    let bodyHtml = "";
    let fontFamily = "";
    const attachments: Array<{ fileName: string; contentType: string; body: Buffer }> = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      body = String(formData.get("body") || "");
      bodyHtml = String(formData.get("bodyHtml") || "");
      fontFamily = String(formData.get("fontFamily") || "");
      for (const entry of formData.getAll("attachments")) {
        if (!(entry instanceof File)) continue;
        const buffer = Buffer.from(await entry.arrayBuffer());
        attachments.push({
          fileName: entry.name,
          contentType: entry.type || "application/octet-stream",
          body: buffer,
        });
      }
    } else {
      const payload = (await readSanitizedJson(req, {})) as Record<string, unknown>;
      body = String(payload.body || "");
      bodyHtml = String(payload.bodyHtml || "");
      fontFamily = String(payload.fontFamily || "");
    }

    const message = await postAdminChatMessage({
      viewer: toViewer(ctx.staff),
      threadId: params.threadId,
      body,
      bodyHtml,
      fontFamily,
      attachments,
    });

    const thread = await getAdminChatThread({
      viewer: toViewer(ctx.staff),
      threadId: params.threadId,
    });

    return adminJson({ ok: true, message, thread });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_MESSAGE_POST_FAILED",
    }, 500);
  }
}
