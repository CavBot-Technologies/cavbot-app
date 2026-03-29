import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeStorageThresholds } from "@/lib/cavsafe/notifications.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { resolveCavSafeDownloadPreference } from "@/lib/cavsafe/settings.server";
import { getTrashFileForPreview, permanentlyDeleteTrashEntry } from "@/lib/cavsafe/storage.server";
import { preferredMimeType } from "@/lib/fileMime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function preferredPreviewContentType(mimeType: string | null | undefined, fileName: string): string | null {
  return preferredMimeType({
    providedMimeType: mimeType,
    fileName,
  });
}

function isInvalidRangeError(err: unknown): boolean {
  const code = String((err as { name?: unknown; Code?: unknown })?.name || (err as { Code?: unknown })?.Code || "");
  return code === "InvalidRange";
}

function safeDownloadFilename(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[\\/\u0000\r\n\"]/g, "_")
    .slice(0, 180);
  return cleaned || "download";
}

function shouldDefaultDownloadForUnknown(
  preferDownloadUnknownBinary: boolean,
  mimeType: string | null | undefined,
  fileName: string,
): boolean {
  if (!preferDownloadUnknownBinary) return false;
  const preferred = preferredPreviewContentType(mimeType, fileName);
  if (!preferred) return true;
  return String(preferred || "").trim().toLowerCase() === "application/octet-stream";
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const trashId = String(ctx?.params?.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trash id is required." }, 400);

    const url = new URL(req.url);
    const raw = url.searchParams.get("raw") === "1";
    if (!raw) {
      return jsonNoStore({ ok: false, error: "RAW_FLAG_REQUIRED", message: "Pass raw=1 to stream trash file preview." }, 400);
    }

    const file = await getTrashFileForPreview({
      accountId: sess.accountId,
      trashId,
    });
    const preferDownloadUnknownBinary = await resolveCavSafeDownloadPreference({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });
    const shouldDownload = shouldDefaultDownloadForUnknown(
      preferDownloadUnknownBinary,
      file.mimeType || null,
      file.name,
    );

    const range = String(req.headers.get("range") || "").trim() || undefined;

    try {
      const direct = await getCavsafeObjectStream({
        objectKey: file.r2Key,
        range,
      });
      if (!direct) {
        return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "Trash preview file not found." }, 404);
      }

      const headers = new Headers();
      headers.set("Cache-Control", "private, no-store");
      headers.set("Accept-Ranges", direct.acceptRanges || "bytes");
      headers.set("X-Content-Type-Options", "nosniff");

      if (direct.etag) headers.set("ETag", direct.etag);
      if (direct.lastModified) headers.set("Last-Modified", direct.lastModified);
      if (direct.contentEncoding) headers.set("Content-Encoding", direct.contentEncoding);
      if (direct.contentLanguage) headers.set("Content-Language", direct.contentLanguage);

      const contentType = preferredPreviewContentType(file.mimeType || null, file.name) || direct.contentType || "application/octet-stream";
      headers.set("Content-Type", contentType);

      if (direct.contentRange) headers.set("Content-Range", direct.contentRange);
      if (direct.contentLength != null && Number.isFinite(direct.contentLength)) {
        headers.set("Content-Length", String(Math.max(0, Math.trunc(direct.contentLength))));
      }
      if (shouldDownload) {
        const filename = safeDownloadFilename(file.name);
        headers.set(
          "Content-Disposition",
          `attachment; filename=\"${filename}\"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        );
      } else {
        headers.set("Content-Disposition", "inline");
      }

      return new Response(direct.body, {
        status: direct.status,
        headers,
      });
    } catch (err) {
      if (isInvalidRangeError(err)) {
        const headers = new Headers();
        headers.set("Cache-Control", "private, no-store");
        headers.set("Content-Range", `bytes */${Number.isFinite(file.bytes) ? file.bytes : "*"}`);
        return new Response(null, { status: 416, headers });
      }
      throw err;
    }
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to stream trash file preview.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const trashId = String(ctx?.params?.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trash id is required." }, 400);

    const url = new URL(req.url);
    const permanent = url.searchParams.get("permanent") === "1";
    if (!permanent) {
      return jsonNoStore({ ok: false, error: "PERMANENT_FLAG_REQUIRED", message: "Pass permanent=1 to permanently delete." }, 400);
    }

    await permanentlyDeleteTrashEntry({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      trashId,
      reason: "manual",
    });

    try {
      await notifyCavSafeStorageThresholds({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      });
    } catch {
      // Non-blocking notification write.
    }

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to permanently delete trash item.");
  }
}
