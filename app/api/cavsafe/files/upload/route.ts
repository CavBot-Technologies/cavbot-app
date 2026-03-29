import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeStorageThresholds, notifyCavSafeUploadFailure } from "@/lib/cavsafe/notifications.server";
import { getCavSafeSettings } from "@/lib/cavsafe/settings.server";
import { replaceFileContent, uploadSimpleFile } from "@/lib/cavsafe/storage.server";
import { prisma } from "@/lib/prisma";
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
  const uploadLabel = "Upload";
  let uploadFileName = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");

    const url = new URL(req.url);
    const contentType = String(req.headers.get("content-type") || "").toLowerCase();

    let fileName = String(
      url.searchParams.get("name")
      || req.headers.get("x-cavcloud-filename")
      || req.headers.get("x-file-name")
      || ""
    ).trim();
    uploadFileName = fileName;
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
      uploadFileName = fileName;
      fileId = String(form.get("fileId") || fileId || "").trim() || null;
      folderId = String(form.get("folderId") || folderId || "").trim() || null;
      folderPath = String(form.get("folderPath") || folderPath || "").trim() || null;
      mimeType = String(form.get("mimeType") || file.type || mimeType || "").trim();
      streamBody = file.stream();
      contentLength = Number.isFinite(file.size) ? file.size : contentLength;
    }

    if (fileId) {
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
      });

      try {
        await notifyCavSafeStorageThresholds({
          accountId: String(sess.accountId || ""),
          userId: String(sess.sub || ""),
        });
      } catch {
        // Non-blocking notification write.
      }

      return jsonNoStore({ ok: true, file }, 200);
    }

    if (!fileName) {
      return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "Pass name or x-cavcloud-filename." }, 400);
    }

    const file = await uploadSimpleFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
      folderPath,
      fileName,
      mimeType: mimeType || null,
      body: streamBody,
      contentLength,
    });

    const cavsafeSettings = await getCavSafeSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      premiumPlus: sess.cavsafePremiumPlus,
    });
    const shouldDefaultLock = sess.cavsafePremiumPlus && cavsafeSettings.defaultIntegrityLockOnUpload;

    let filePayload = file;
    if (shouldDefaultLock) {
      const lockAt = new Date();
      try {
        const lockResult = await prisma.cavSafeFile.updateMany({
          where: {
            id: String(file.id || ""),
            accountId: String(sess.accountId || ""),
            deletedAt: null,
            immutableAt: null,
          },
          data: {
            immutableAt: lockAt,
          },
        });
        if (lockResult.count > 0) {
          filePayload = {
            ...file,
            immutableAtISO: lockAt.toISOString(),
          };
        }
      } catch {
        // Best-effort default lock application.
      }
    }

    try {
      await notifyCavSafeStorageThresholds({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true, file: filePayload }, 200);
  } catch (err) {
    if (accountId && userId) {
      try {
        await notifyCavSafeUploadFailure({
          accountId,
          userId,
          fileName: uploadFileName || undefined,
          context: uploadLabel,
          errorMessage: (err as Error)?.message || "Upload failed.",
          href: "/cavsafe",
        });
      } catch {
        // Non-blocking notification write.
      }
    }
    return cavsafeErrorResponse(err, "Failed to upload file.");
  }
}
