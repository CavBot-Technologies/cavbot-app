import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { createMultipartSession } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateUploadBody = {
  folderId?: unknown;
  folderPath?: unknown;
  name?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  expectedBytes?: unknown;
  partSizeBytes?: unknown;
};

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

    const body = (await readSanitizedJson(req, null)) as CreateUploadBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const fileName = String(body.fileName || body.name || "").trim();
    fileNameForError = fileName;
    if (!fileName) return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "name is required." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "UPLOAD_FILE",
      errorCode: "UNAUTHORIZED",
    });

    const upload = await createMultipartSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: body.folderId == null ? null : String(body.folderId || "").trim() || null,
      folderPath: body.folderPath == null ? null : String(body.folderPath || "").trim() || null,
      fileName,
      mimeType: body.mimeType == null ? null : String(body.mimeType || "").trim() || null,
      expectedBytes: body.expectedBytes == null ? null : Number(body.expectedBytes),
      partSizeBytes: body.partSizeBytes == null ? null : Number(body.partSizeBytes),
    });

    return jsonNoStore({ ok: true, upload }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: fileNameForError || null,
          context: "Multipart upload start",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to create multipart upload session.");
  }
}
