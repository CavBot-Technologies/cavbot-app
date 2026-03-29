import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { uploadSimpleFile } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function emptyBodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

export async function POST(req: Request) {
  let accountId = "";
  let userId = "";
  let fileNameForError = "";
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

    const url = new URL(req.url);
    const fileName = String(
      url.searchParams.get("name") ||
      req.headers.get("x-cavcloud-filename") ||
      req.headers.get("x-file-name") ||
      ""
    ).trim();
    fileNameForError = fileName;

    if (!fileName) {
      return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "Pass ?name=<filename> or x-cavcloud-filename header." }, 400);
    }

    const folderId = String(url.searchParams.get("folderId") || "").trim() || null;
    const folderPath = String(url.searchParams.get("folderPath") || "").trim() || null;

    const contentType = String(req.headers.get("content-type") || url.searchParams.get("mimeType") || "").trim();
    const contentLengthHeader = String(req.headers.get("content-length") || "").trim();
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;

    const body = req.body || emptyBodyStream();

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const file = await uploadSimpleFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
      folderPath,
      fileName,
      mimeType: contentType || null,
      body,
      contentLength,
      generateTextSnippets: settings.generateTextSnippets !== false,
    });

    try {
      await notifyCavCloudStorageThresholds({ accountId, userId });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: fileNameForError || null,
          context: "Direct upload",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to upload file.");
  }
}
