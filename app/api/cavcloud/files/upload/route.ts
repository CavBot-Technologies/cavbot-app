import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { replaceFileContent, uploadSimpleFile } from "@/lib/cavcloud/storage.server";
import { readSanitizedFormData } from "@/lib/security/userInput";

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
  let uploadContext = "File upload";
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
    const contentType = String(req.headers.get("content-type") || "").toLowerCase();

    let fileName = String(
      url.searchParams.get("name")
      || req.headers.get("x-cavcloud-filename")
      || req.headers.get("x-file-name")
      || ""
    ).trim();
    fileNameForError = fileName;
    let fileId = String(
      url.searchParams.get("fileId")
      || req.headers.get("x-cavcloud-file-id")
      || ""
    ).trim() || null;
    let folderId = String(url.searchParams.get("folderId") || "").trim() || null;
    let folderPath = String(url.searchParams.get("folderPath") || "").trim() || null;
    let streamBody: ReadableStream<Uint8Array> = req.body || emptyBodyStream();
    let multipartFile: File | null = null;
    let mimeType = String(req.headers.get("content-type") || url.searchParams.get("mimeType") || "").trim();
    let contentLength = (() => {
      const raw = String(req.headers.get("content-length") || "").trim();
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    })();

    if (contentType.includes("multipart/form-data")) {
      const form = await readSanitizedFormData(req, null);
      if (!form) {
        return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid multipart body." }, 400);
      }

      const fileField = form.get("file");
      const file = fileField instanceof File ? fileField : null;
      if (!file) {
        return jsonNoStore({ ok: false, error: "FILE_REQUIRED", message: "file is required." }, 400);
      }

      multipartFile = file;
      fileName = String(form.get("name") || file.name || fileName || "").trim();
      fileNameForError = fileName;
      fileId = String(form.get("fileId") || fileId || "").trim() || null;
      folderId = String(form.get("folderId") || folderId || "").trim() || null;
      folderPath = String(form.get("folderPath") || folderPath || "").trim() || null;
      mimeType = String(form.get("mimeType") || file.type || mimeType || "").trim();
      streamBody = file.stream();
      contentLength = Number.isFinite(file.size) ? file.size : contentLength;
    }

    if (fileId) {
      uploadContext = "File replace";
      await assertCavCloudActionAllowed({
        accountId: sess.accountId,
        userId: sess.sub,
        action: "EDIT_FILE_CONTENT",
        resourceType: "FILE",
        resourceId: fileId,
        neededPermission: "EDIT",
        errorCode: "UNAUTHORIZED",
      });
      const body = multipartFile
        ? new Uint8Array(await multipartFile.arrayBuffer())
        : new Uint8Array(await req.arrayBuffer());

      if (!body.byteLength) {
        return jsonNoStore({ ok: false, error: "BODY_REQUIRED", message: "Upload body is required." }, 400);
      }

      const file = await replaceFileContent({
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        fileId,
        mimeType: mimeType || null,
        body,
        generateTextSnippets: settings.generateTextSnippets !== false,
      });

      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }

      return jsonNoStore({ ok: true, file }, 200);
    }

    if (!fileName) {
      return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "Pass name or x-cavcloud-filename." }, 400);
    }

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
      mimeType: mimeType || null,
      body: streamBody,
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
          context: uploadContext,
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
