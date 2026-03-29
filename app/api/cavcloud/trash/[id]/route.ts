import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudBulkDeletePurge } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavcloudObjectStream, headCavcloudObject } from "@/lib/cavcloud/r2.server";
import { getTrashFileForPreview, permanentlyDeleteTrashEntry } from "@/lib/cavcloud/storage.server";
import { preferredMimeType } from "@/lib/fileMime";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";

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

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const trashId = String(ctx?.params?.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trash id is required." }, 400);

    const url = new URL(req.url);
    const raw = url.searchParams.get("raw") === "1";

    const file = await getTrashFileForPreview({
      accountId: sess.accountId,
      trashId,
    });
    let resolvedBytes = Number.isFinite(Number(file.bytes)) ? Math.max(0, Math.trunc(Number(file.bytes))) : null;
    if ((resolvedBytes == null || resolvedBytes <= 0) && String(file.r2Key || "").trim()) {
      try {
        const head = await headCavcloudObject(file.r2Key);
        const headBytes = Number(head?.bytes);
        if (Number.isFinite(headBytes) && headBytes >= 0) {
          resolvedBytes = Math.max(0, Math.trunc(headBytes));
        }
      } catch {
        // Best effort metadata fallback.
      }
    }

    if (!raw) {
      return jsonNoStore({
        ok: true,
        file: {
          id: file.fileId,
          name: file.name,
          path: file.path,
          mimeType: file.mimeType,
          bytes: resolvedBytes,
        },
      }, 200);
    }

    const range = String(req.headers.get("range") || "").trim() || undefined;

    try {
      const direct = await getCavcloudObjectStream({
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
      headers.set("Content-Disposition", "inline");

      return new Response(direct.body, {
        status: direct.status,
        headers,
      });
    } catch (err) {
      if (isInvalidRangeError(err)) {
        const headers = new Headers();
        headers.set("Cache-Control", "private, no-store");
        headers.set("Content-Range", `bytes */${Number.isFinite(Number(resolvedBytes)) ? Number(resolvedBytes) : "*"}`);
        return new Response(null, { status: 416, headers });
      }
      throw err;
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to stream trash file preview.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const trashId = String(ctx?.params?.id || "").trim();
    if (!trashId) return jsonNoStore({ ok: false, error: "TRASH_ID_REQUIRED", message: "trash id is required." }, 400);

    const url = new URL(req.url);
    const permanent = url.searchParams.get("permanent") === "1";
    if (!permanent) {
      return jsonNoStore({ ok: false, error: "PERMANENT_FLAG_REQUIRED", message: "Pass permanent=1 to permanently delete." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "PERMANENT_DELETE",
      errorCode: "UNAUTHORIZED",
    });

    const result = await permanentlyDeleteTrashEntry({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      trashId,
      reason: "manual",
    });

    if (accountId && userId) {
      try {
        await notifyCavCloudBulkDeletePurge({
          accountId,
          userId,
          removedFiles: result.removedFiles,
          removedFolders: result.removedFolders,
          reason: result.reason,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to permanently delete trash item.");
  }
}
