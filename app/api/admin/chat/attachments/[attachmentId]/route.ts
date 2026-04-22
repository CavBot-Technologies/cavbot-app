import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { adminJson } from "@/lib/admin/api";
import { getAdminR2Object } from "@/lib/admin/r2.server";
import { requireActiveStaffSession } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { attachmentId: string } }) {
  try {
    const ctx = await requireActiveStaffSession(req, { scopes: ["messaging.read"] });
    const attachment = await prisma.adminChatAttachment.findUnique({
      where: { id: params.attachmentId },
      include: {
        message: {
          select: {
            threadId: true,
          },
        },
      },
    });

    if (!attachment?.message?.threadId) {
      return adminJson({ ok: false, error: "CHAT_ATTACHMENT_NOT_FOUND" }, 404);
    }

    const participant = await prisma.adminChatParticipant.findUnique({
      where: {
        threadId_userId: {
          threadId: attachment.message.threadId,
          userId: ctx.userSession.sub,
        },
      },
      select: { id: true },
    });
    if (!participant?.id) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }

    const object = await getAdminR2Object({
      objectKey: attachment.objectKey,
      range: req.headers.get("range"),
    });
    if (!object) {
      return adminJson({ ok: false, error: "CHAT_ATTACHMENT_MISSING" }, 404);
    }

    return new Response(object.body, {
      status: object.status,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": object.contentType,
        ...(object.contentLength ? { "Content-Length": String(object.contentLength) } : {}),
        ...(object.contentRange ? { "Content-Range": object.contentRange, "Accept-Ranges": "bytes" } : {}),
        ...(object.etag ? { ETag: object.etag } : {}),
        ...(object.lastModified ? { "Last-Modified": object.lastModified } : {}),
        "Content-Disposition": `inline; filename="${attachment.fileName.replace(/"/g, "")}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "CHAT_ATTACHMENT_READ_FAILED",
    }, 500);
  }
}
