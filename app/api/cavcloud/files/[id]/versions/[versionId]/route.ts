import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { preferredMimeType } from "@/lib/fileMime";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function toSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function safeDownloadFilename(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[\\/\u0000\r\n"]/g, "_")
    .slice(0, 180);
  return cleaned || "download";
}

function preferredContentType(mimeType: string | null | undefined, fileName: string): string {
  return preferredMimeType({
    providedMimeType: mimeType,
    fileName,
  }) || "application/octet-stream";
}

export async function GET(req: Request, ctx: { params: { id?: string; versionId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    const versionId = String(ctx?.params?.versionId || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);
    if (!versionId) {
      return jsonNoStore({ ok: false, error: "VERSION_ID_REQUIRED", message: "version id is required." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "EDIT_FILE_CONTENT",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const row = await prisma.cavCloudFileVersion.findFirst({
      where: {
        accountId: sess.accountId,
        fileId,
        id: versionId,
      },
      select: {
        id: true,
        fileId: true,
        versionNumber: true,
        sha256: true,
        r2Key: true,
        bytes: true,
        createdByUserId: true,
        restoredFromVersionId: true,
        createdAt: true,
        file: {
          select: {
            id: true,
            name: true,
            path: true,
            mimeType: true,
            sha256: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!row) {
      return jsonNoStore({ ok: false, error: "VERSION_NOT_FOUND", message: "Version not found." }, 404);
    }

    const url = new URL(req.url);
    const raw = url.searchParams.get("raw") === "1";
    const download = url.searchParams.get("download") === "1";

    if (raw) {
      const range = String(req.headers.get("range") || "").trim() || undefined;
      const direct = await getCavcloudObjectStream({
        objectKey: row.r2Key,
        range,
      });
      if (!direct) {
        return jsonNoStore({ ok: false, error: "OBJECT_NOT_FOUND", message: "Version content unavailable." }, 404);
      }

      const headers = new Headers();
      headers.set("Cache-Control", "private, no-store");
      headers.set("Accept-Ranges", direct.acceptRanges || "bytes");
      headers.set("X-Content-Type-Options", "nosniff");
      if (direct.etag) headers.set("ETag", direct.etag);
      if (direct.lastModified) headers.set("Last-Modified", direct.lastModified);
      if (direct.contentEncoding) headers.set("Content-Encoding", direct.contentEncoding);
      if (direct.contentLanguage) headers.set("Content-Language", direct.contentLanguage);
      if (direct.contentRange) headers.set("Content-Range", direct.contentRange);
      if (direct.contentLength != null && Number.isFinite(direct.contentLength)) {
        headers.set("Content-Length", String(Math.max(0, Math.trunc(direct.contentLength))));
      }

      const contentType = preferredContentType(row.file?.mimeType || null, row.file?.name || "file");
      headers.set("Content-Type", contentType);
      if (download) {
        const filename = safeDownloadFilename(row.file?.name || `version-${row.versionNumber}`);
        headers.set("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      } else {
        headers.set("Content-Disposition", "inline");
      }

      return new Response(direct.body, {
        status: direct.status,
        headers,
      });
    }

    return jsonNoStore({
      ok: true,
      version: {
        id: row.id,
        fileId: row.fileId,
        versionNumber: Number(row.versionNumber),
        sha256: row.sha256,
        bytes: toSafeNumber(row.bytes),
        bytesExact: row.bytes.toString(),
        createdByUserId: row.createdByUserId || null,
        restoredFromVersionId: row.restoredFromVersionId || null,
        createdAtISO: row.createdAt.toISOString(),
      },
      file: row.file
        ? {
            id: row.file.id,
            name: row.file.name,
            path: row.file.path,
            mimeType: row.file.mimeType,
            sha256: row.file.sha256,
            updatedAtISO: row.file.updatedAt.toISOString(),
            createdAtISO: row.file.createdAt.toISOString(),
          }
        : null,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load file version.");
  }
}
