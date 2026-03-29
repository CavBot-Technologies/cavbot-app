import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { uploadFolderUploadSessionFile } from "@/lib/cavcloud/storage.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { sessionId?: string; fileId?: string } }) {
  let accountId = "";
  let userId = "";
  let fileIdForError = "";
  let sessionIdForError = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();
    const settings = await getCavCloudSettings({
      accountId,
      userId,
    });

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    const fileId = String(ctx?.params?.fileId || "").trim();
    sessionIdForError = sessionId;
    fileIdForError = fileId;

    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "UPLOAD_SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }
    if (!fileId) {
      return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "fileId is required." }, 400);
    }

    const uploadSession = await prisma.cavCloudFolderUploadSession.findFirst({
      where: {
        id: sessionId,
        accountId: sess.accountId,
      },
      select: {
        rootFolderId: true,
      },
    });
    if (!uploadSession?.rootFolderId) {
      return jsonNoStore({ ok: false, error: "NOT_FOUND", message: "Upload session not found." }, 404);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      resourceType: "FOLDER",
      resourceId: uploadSession.rootFolderId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    if (!req.body) {
      return jsonNoStore({ ok: false, error: "BODY_REQUIRED", message: "Upload body is required." }, 400);
    }

    const url = new URL(req.url);
    const mimeType = String(url.searchParams.get("mimeType") || req.headers.get("content-type") || "")
      .split(";")[0]
      ?.trim() || null;

    const contentLengthRaw = String(req.headers.get("content-length") || "").trim();
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null;

    const result = await uploadFolderUploadSessionFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      sessionId,
      fileId,
      body: req.body,
      mimeType,
      contentLength,
      generateTextSnippets: settings.generateTextSnippets !== false,
    });

    return jsonNoStore({
      ok: true,
      file: result.file,
      alreadyReady: result.alreadyReady,
      discoveredFilesCount: result.discoveredFilesCount,
      createdFilesCount: result.createdFilesCount,
      finalizedFilesCount: result.finalizedFilesCount,
      failedFilesCount: result.failedFilesCount,
      status: result.status,
    }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: fileIdForError || null,
          context: `Folder upload (${sessionIdForError || "session"})`,
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to upload folder session file bytes.");
  }
}
