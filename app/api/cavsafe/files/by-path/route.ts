import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeTimeLockEvent } from "@/lib/cavsafe/notifications.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { resolveCavSafeDownloadPreference } from "@/lib/cavsafe/settings.server";
import { preferredMimeType } from "@/lib/fileMime";
import { prisma } from "@/lib/prisma";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";

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
    .replace(/[\\/\u0000\r\n\"]/g, "_")
    .slice(0, 180);
  return cleaned || "download";
}

function shouldDefaultDownloadForUnknown(
  preferDownloadUnknownBinary: boolean,
  mimeType: string | null | undefined,
  fileName: string,
  fallbackPath?: string | null,
): boolean {
  if (!preferDownloadUnknownBinary) return false;
  const preferred = preferredPreviewContentType(mimeType, fileName, fallbackPath);
  if (!preferred) return true;
  return String(preferred || "").trim().toLowerCase() === "application/octet-stream";
}

function timeLockCode(file: { unlockAt: Date | null; expireAt: Date | null }): "TIMELOCK_NOT_UNLOCKED" | "TIMELOCK_EXPIRED" | null {
  const now = Date.now();
  const unlockAt = file.unlockAt ? new Date(file.unlockAt).getTime() : 0;
  if (unlockAt && Number.isFinite(unlockAt) && now < unlockAt) return "TIMELOCK_NOT_UNLOCKED";
  const expireAt = file.expireAt ? new Date(file.expireAt).getTime() : 0;
  if (expireAt && Number.isFinite(expireAt) && now >= expireAt) return "TIMELOCK_EXPIRED";
  return null;
}

export async function GET(req: Request) {
  try {
    const sess = await requireUserSession(req);

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

    const file = await prisma.cavSafeFile.findFirst({
      where: {
        accountId: String(sess.accountId || ""),
        path: normalizedPath,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        r2Key: true,
        mimeType: true,
        bytes: true,
        unlockAt: true,
        expireAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!file) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: file.id,
      minRole: "VIEWER",
      onDenied: 404,
    });

    if (!raw) {
      const bytesRaw = Number(file.bytes);
      const bytes = Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.trunc(bytesRaw) : null;
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

    const preferDownloadUnknownBinary = await resolveCavSafeDownloadPreference({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });
    const shouldDownload = shouldDefaultDownloadForUnknown(
      preferDownloadUnknownBinary,
      file.mimeType || null,
      file.name,
      normalizedPath,
    );

    const denyCode = timeLockCode({
      unlockAt: file.unlockAt,
      expireAt: file.expireAt,
    });
    if (denyCode) {
      await writeCavSafeOperationLog({
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        kind: "OPEN_DENIED",
        subjectType: "file",
        subjectId: file.id,
        label: "CavSafe file open denied",
        meta: {
          code: denyCode,
          path: file.path,
        },
      });
      try {
        await notifyCavSafeTimeLockEvent({
          accountId: String(sess.accountId || ""),
          userId: String(sess.sub || ""),
          title: denyCode === "TIMELOCK_EXPIRED" ? "CavSafe file expired" : "CavSafe file still locked",
          body: denyCode === "TIMELOCK_EXPIRED"
            ? `${file.name} is no longer accessible because its time lock expired.`
            : `${file.name} cannot be opened until its unlock time is reached.`,
          href: "/cavsafe",
          tone: denyCode === "TIMELOCK_EXPIRED" ? "WATCH" : "BAD",
          dedupeHours: 4,
          meta: {
            code: denyCode,
            path: file.path,
            fileId: file.id,
          },
        });
      } catch {
        // Non-blocking notification write.
      }
      return jsonNoStore({ ok: false, error: denyCode, message: "This file is currently unavailable." }, 403);
    }
    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: "ACCESS_ATTEMPT",
      subjectType: "file",
      subjectId: file.id,
      label: "CavSafe file access attempt",
      meta: {
        path: file.path,
        byPath: true,
      },
    });

    const range = String(req.headers.get("range") || "").trim() || undefined;

    try {
      const direct = await getCavsafeObjectStream({
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
    return cavsafeErrorResponse(err, "Failed to stream file preview by path.");
  }
}
