import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeStorageThresholds, notifyCavSafeUploadFailure } from "@/lib/cavsafe/notifications.server";
import { getCavSafeSettings } from "@/lib/cavsafe/settings.server";
import { uploadSimpleFile } from "@/lib/cavsafe/storage.server";
import { prisma } from "@/lib/prisma";

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
  let uploadFileName = "";
  try {
    const sess = await requireCavsafeOwnerSession(req);
    accountId = String(sess.accountId || "");
    userId = String(sess.sub || "");

    const url = new URL(req.url);
    const fileName = String(
      url.searchParams.get("name") ||
      req.headers.get("x-cavcloud-filename") ||
      req.headers.get("x-file-name") ||
      ""
    ).trim();
    uploadFileName = fileName;

    if (!fileName) {
      return jsonNoStore({ ok: false, error: "NAME_REQUIRED", message: "Pass ?name=<filename> or x-cavcloud-filename header." }, 400);
    }

    const folderId = String(url.searchParams.get("folderId") || "").trim() || null;
    const folderPath = String(url.searchParams.get("folderPath") || "").trim() || null;

    const contentType = String(req.headers.get("content-type") || url.searchParams.get("mimeType") || "").trim();
    const contentLengthHeader = String(req.headers.get("content-length") || "").trim();
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;

    const body = req.body || emptyBodyStream();

    const file = await uploadSimpleFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
      folderPath,
      fileName,
      mimeType: contentType || null,
      body,
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
          context: "Upload",
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
