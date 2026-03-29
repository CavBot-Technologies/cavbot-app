import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { finalizeFolderUploadSession } from "@/lib/cavcloud/storage.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { sessionId?: string } }) {
  let accountId = "";
  let userId = "";
  let sessionIdForError = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    sessionIdForError = sessionId;
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "UPLOAD_SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
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

    const result = await finalizeFolderUploadSession({
      accountId: sess.accountId,
      sessionId,
    });

    const statusCode = result.ok ? 200 : 409;

    if (!result.ok && result.failedFilesCount > 0 && accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          context: "Folder upload finalize",
          errorMessage: `${result.failedFilesCount} file upload${result.failedFilesCount === 1 ? "" : "s"} failed in session ${sessionId}.`,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }

    if (result.ok && accountId && userId) {
      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({
      ok: result.ok,
      sessionId: result.sessionId,
      status: result.status,
      discoveredFilesCount: result.discoveredFilesCount,
      createdFilesCount: result.createdFilesCount,
      finalizedFilesCount: result.finalizedFilesCount,
      failedFilesCount: result.failedFilesCount,
      missingCount: result.missingCount,
      manifestGapCount: result.manifestGapCount,
      failed: result.failed,
      missing: result.missing,
      updatedAtISO: result.updatedAtISO,
    }, statusCode);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          context: "Folder upload finalize",
          errorMessage: `Upload finalize failed for session ${sessionIdForError || "unknown"}.`,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to finalize folder upload session.");
  }
}
