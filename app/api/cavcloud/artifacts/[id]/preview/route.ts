import { requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavcloudObjectStream, headCavcloudObject } from "@/lib/cavcloud/r2.server";
import { preferredMimeType } from "@/lib/fileMime";
import { prisma } from "@/lib/prisma";

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

function safeDownloadFilename(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[\\/\u0000\r\n"]/g, "_")
    .slice(0, 180);
  return cleaned || "download";
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);

    const artifactId = String(ctx?.params?.id || "").trim();
    if (!artifactId) return jsonNoStore({ ok: false, error: "ARTIFACT_ID_REQUIRED", message: "artifact id is required." }, 400);

    const url = new URL(req.url);
    const raw = url.searchParams.get("raw") === "1";
    const download = url.searchParams.get("download") === "1";

    const artifact = await prisma.publicArtifact.findFirst({
      where: {
        id: artifactId,
        userId: String(sess.sub || ""),
      },
      select: {
        storageKey: true,
        mimeType: true,
        displayTitle: true,
        sourcePath: true,
        sizeBytes: true,
        type: true,
      },
    });
    if (!artifact) {
      return jsonNoStore({ ok: false, error: "ARTIFACT_NOT_FOUND", message: "Artifact not found." }, 404);
    }
    if (String(artifact.type || "").toUpperCase() === "FOLDER") {
      return jsonNoStore({ ok: false, error: "ARTIFACT_NOT_PREVIEWABLE", message: "Folder artifacts are not previewable." }, 400);
    }

    const objectKey = String(artifact.storageKey || "").trim();
    if (!objectKey) {
      return jsonNoStore({ ok: false, error: "ARTIFACT_STORAGE_KEY_MISSING", message: "Artifact is missing storage key." }, 404);
    }
    let resolvedBytes = Number.isFinite(Number(artifact.sizeBytes)) ? Math.max(0, Math.trunc(Number(artifact.sizeBytes))) : null;
    if ((resolvedBytes == null || resolvedBytes <= 0) && objectKey) {
      try {
        const head = await headCavcloudObject(objectKey);
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
        artifact: {
          id: artifactId,
          displayTitle: artifact.displayTitle,
          sourcePath: artifact.sourcePath,
          mimeType: artifact.mimeType,
          type: artifact.type,
          sizeBytes: resolvedBytes,
        },
      }, 200);
    }

    const range = String(req.headers.get("range") || "").trim() || undefined;

    try {
      const direct = await getCavcloudObjectStream({
        objectKey,
        range,
      });
      if (!direct) {
        return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "Artifact preview file not found." }, 404);
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
        preferredPreviewContentType(artifact.mimeType || null, artifact.displayTitle, artifact.sourcePath) || direct.contentType || "application/octet-stream";
      headers.set("Content-Type", contentType);

      if (direct.contentRange) headers.set("Content-Range", direct.contentRange);
      if (direct.contentLength != null && Number.isFinite(direct.contentLength)) {
        headers.set("Content-Length", String(Math.max(0, Math.trunc(direct.contentLength))));
      }
      if (download) {
        const fallbackName = artifact.sourcePath || artifact.displayTitle || "download";
        const filename = safeDownloadFilename(fallbackName);
        headers.set("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
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
        headers.set("Content-Range", `bytes */${Number.isFinite(Number(resolvedBytes)) ? Number(resolvedBytes) : "*"}`);
        return new Response(null, { status: 416, headers });
      }
      throw err;
    }
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to stream artifact preview.");
  }
}
