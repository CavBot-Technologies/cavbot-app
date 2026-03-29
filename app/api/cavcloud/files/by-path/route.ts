import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavcloudObjectStream, headCavcloudObject } from "@/lib/cavcloud/r2.server";
import { preferredMimeType } from "@/lib/fileMime";
import { prisma } from "@/lib/prisma";
import { writeCavCloudFileAccessEvent } from "@/lib/cavcloud/accessAudit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function preferredPreviewContentType(
  mimeType: string | null | undefined,
  fileName: string,
  fallbackPath?: string | null,
): string | null {
  return preferredMimeType({
    providedMimeType: mimeType,
    fileName,
    fallbackPath,
  });
}

function isInvalidRangeError(err: unknown): boolean {
  const code = String((err as { name?: unknown; Code?: unknown })?.name || (err as { Code?: unknown })?.Code || "");
  return code === "InvalidRange";
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const url = new URL(req.url);
    const rawPath = String(url.searchParams.get("path") || "").trim();
    if (!rawPath) {
      return jsonNoStore({ ok: false, error: "PATH_REQUIRED", message: "path is required." }, 400);
    }
    const raw = url.searchParams.get("raw") === "1";

    const normalizedPath = (() => {
      const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
      return withSlash.replace(/\/+/g, "/");
    })();

    const file = await prisma.cavCloudFile.findFirst({
      where: {
        accountId: String(sess.accountId || ""),
        path: normalizedPath,
        deletedAt: null,
        status: "READY",
      },
      select: {
        id: true,
        name: true,
        path: true,
        r2Key: true,
        mimeType: true,
        bytes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!file) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    let bytes = (() => {
      const bytesRaw = Number(file.bytes);
      return Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.trunc(bytesRaw) : null;
    })();
    if ((bytes == null || bytes <= 0) && String(file.r2Key || "").trim()) {
      try {
        const head = await headCavcloudObject(file.r2Key);
        const headBytes = Number(head?.bytes);
        if (Number.isFinite(headBytes) && headBytes >= 0) {
          bytes = Math.max(0, Math.trunc(headBytes));
        }
      } catch {
        // Best effort metadata fallback.
      }
    }

    if (!raw) {
      return jsonNoStore({
        ok: true,
        file: {
          id: String(file.id),
          name: String(file.name || ""),
          path: String(file.path || normalizedPath),
          mimeType: String(file.mimeType || ""),
          bytes,
          createdAtISO: new Date(file.createdAt).toISOString(),
          updatedAtISO: new Date(file.updatedAt).toISOString(),
        },
      }, 200);
    }

    const accessRequested = url.searchParams.get("access") === "1";
    const accessIntent = String(req.headers.get("x-cavcloud-access-intent") || "").trim().toLowerCase();
    if (accessRequested || accessIntent === "open") {
      void writeCavCloudFileAccessEvent({
        accountId: String(sess.accountId || ""),
        operatorUserId: String(sess.sub || ""),
        fileId: String(file.id || ""),
        filePath: String(file.path || normalizedPath),
        kind: "FILE_OPENED",
        source: "by_path",
        dedupeWithinMinutes: 10,
        meta: {
          raw: true,
        },
      });
    }

    const range = String(req.headers.get("range") || "").trim() || undefined;

    try {
      const direct = await getCavcloudObjectStream({
        objectKey: file.r2Key,
        range,
      });
      if (!direct) {
        return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "Preview file not found." }, 404);
      }

      const headers = new Headers();
      headers.set("Cache-Control", "private, no-store");
      headers.set("Accept-Ranges", direct.acceptRanges || "bytes");
      headers.set("X-Content-Type-Options", "nosniff");

      if (direct.etag) headers.set("ETag", direct.etag);
      if (direct.lastModified) headers.set("Last-Modified", direct.lastModified);
      if (direct.contentEncoding) headers.set("Content-Encoding", direct.contentEncoding);
      if (direct.contentLanguage) headers.set("Content-Language", direct.contentLanguage);

      const contentType =
        preferredPreviewContentType(file.mimeType || null, file.name, normalizedPath) || direct.contentType || "application/octet-stream";
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
        headers.set("Content-Range", `bytes */${Number.isFinite(Number(bytes)) ? Number(bytes) : "*"}`);
        return new Response(null, { status: 416, headers });
      }
      throw err;
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to stream file preview by path.");
  }
}
