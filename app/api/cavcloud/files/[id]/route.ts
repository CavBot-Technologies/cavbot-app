import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudStorageThresholds, notifyCavCloudUploadFailure } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getFileById, softDeleteFile, updateFile } from "@/lib/cavcloud/storage.server";
import { buildCavcloudGatewayUrl } from "@/lib/cavcloud/gateway.server";
import { getCavcloudObjectStream, headCavcloudObject } from "@/lib/cavcloud/r2.server";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { preferredMimeType } from "@/lib/fileMime";
import { saveCavCloudFileContent } from "@/lib/cavcloud/fileEdits.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { writeCavCloudFileAccessEvent } from "@/lib/cavcloud/accessAudit.server";
import { getAppOrigin } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpdateFileBody = {
  name?: unknown;
  folderId?: unknown;
  mimeType?: unknown;
};

function preferredPreviewContentType(mimeType: string | null | undefined, fileName: string): string | null {
  return preferredMimeType({
    providedMimeType: mimeType,
    fileName,
  });
}

function safeDownloadFilename(name: string): string {
  const cleaned = String(name || "")
    .trim()
    .replace(/[\\/\u0000\r\n"]/g, "_")
    .slice(0, 180);
  return cleaned || "download";
}

function isInvalidRangeError(err: unknown): boolean {
  const code = String((err as { name?: unknown; Code?: unknown })?.name || (err as { Code?: unknown })?.Code || "");
  return code === "InvalidRange";
}

function normalizeOriginOrNull(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function refererOrigin(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function appOrigin(req: Request): string {
  const byOriginHeader = normalizeOriginOrNull(req.headers.get("origin"));
  if (byOriginHeader) return byOriginHeader;

  const byReferer = refererOrigin(req.headers.get("referer"));
  if (byReferer) return byReferer;

  const byRequestUrl = normalizeOriginOrNull(req.url);
  if (byRequestUrl) return byRequestUrl;

  return getAppOrigin();
}

function parseIfMatchSha(raw: string | null): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const cleaned = value
    .replace(/^W\//i, "")
    .replace(/^\"+/, "")
    .replace(/\"+$/, "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return null;
  return cleaned;
}

const PROXY_HEADER_ALLOWLIST = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "vary",
  "x-cavcloud-request-id",
] as const;

function copyProxyHeaders(from: Headers, to: Headers) {
  for (const name of PROXY_HEADER_ALLOWLIST) {
    const value = from.get(name);
    if (value) to.set(name, value);
  }
}

async function proxyGatewayObject(
  req: Request,
  gatewayUrl: string,
  fallbackContentType: string | null,
  forceInline: boolean
) {
  const origin = appOrigin(req);
  const forward = new Headers();
  forward.set("Origin", origin);
  const cookie = req.headers.get("cookie");
  if (cookie) forward.set("Cookie", cookie);

  const range = req.headers.get("range");
  if (range) forward.set("Range", range);

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch) forward.set("If-None-Match", ifNoneMatch);

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (ifModifiedSince) forward.set("If-Modified-Since", ifModifiedSince);

  const upstream = await fetch(gatewayUrl, {
    method: "GET",
    headers: forward,
    redirect: "follow",
    cache: "no-store",
  });

  const headers = new Headers();
  copyProxyHeaders(upstream.headers, headers);
  const upstreamType = String(headers.get("Content-Type") || "").trim().toLowerCase();
  if ((!upstreamType || upstreamType === "application/octet-stream") && fallbackContentType) {
    headers.set("Content-Type", fallbackContentType);
  }
  if (forceInline) {
    headers.set("Content-Disposition", "inline");
  }
  headers.set("Cache-Control", "private, no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

async function streamObjectFromR2(req: Request, args: {
  objectKey: string;
  mimeType: string | null;
  fileName: string;
  download: boolean;
}): Promise<Response | null> {
  const range = String(req.headers.get("range") || "").trim() || undefined;
  const direct = await getCavcloudObjectStream({
    objectKey: args.objectKey,
    range,
  });
  if (!direct) return null;

  const headers = new Headers();
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", direct.acceptRanges || "bytes");
  headers.set("X-Content-Type-Options", "nosniff");

  if (direct.etag) headers.set("ETag", direct.etag);
  if (direct.lastModified) headers.set("Last-Modified", direct.lastModified);
  if (direct.contentEncoding) headers.set("Content-Encoding", direct.contentEncoding);
  if (direct.contentLanguage) headers.set("Content-Language", direct.contentLanguage);

  const contentType = preferredPreviewContentType(args.mimeType, args.fileName) || direct.contentType || "application/octet-stream";
  headers.set("Content-Type", contentType);

  if (direct.contentRange) headers.set("Content-Range", direct.contentRange);
  if (direct.contentLength != null && Number.isFinite(direct.contentLength)) {
    headers.set("Content-Length", String(Math.max(0, Math.trunc(direct.contentLength))));
  }

  if (args.download) {
    const filename = safeDownloadFilename(args.fileName);
    headers.set("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  } else {
    headers.set("Content-Disposition", "inline");
  }

  return new Response(direct.body, {
    status: direct.status,
    headers,
  });
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);

    const file = await getFileById({
      accountId: sess.accountId,
      fileId,
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
    const fileWithResolvedBytes = resolvedBytes == null
      ? file
      : {
          ...file,
          bytes: resolvedBytes,
          bytesExact: String(resolvedBytes),
        };

    const origin = appOrigin(req);
    const token = mintCavCloudObjectToken({
      origin,
      objectKey: file.r2Key,
      ttlSeconds: 600,
    });

    const urlObj = new URL(req.url);
    const download = urlObj.searchParams.get("download") === "1";
    const raw = urlObj.searchParams.get("raw") === "1";
    const accessRequested = urlObj.searchParams.get("access") === "1";
    const accessIntent = String(req.headers.get("x-cavcloud-access-intent") || "").trim().toLowerCase();
    const shouldWriteAccessEvent = raw && (download || accessRequested || accessIntent === "open");

    if (shouldWriteAccessEvent) {
      void writeCavCloudFileAccessEvent({
        accountId: String(sess.accountId || ""),
        operatorUserId: String(sess.sub || ""),
        fileId,
        filePath: String(file.path || "").trim() || null,
        kind: download ? "FILE_DOWNLOADED" : "FILE_OPENED",
        source: "file",
        dedupeWithinMinutes: download ? 0 : 10,
        meta: {
          raw: true,
          download,
        },
      });
    }

    const gatewayUrl = buildCavcloudGatewayUrl({
      objectKey: file.r2Key,
      token,
      download,
    });

    if (raw) {
      try {
        const direct = await streamObjectFromR2(req, {
          objectKey: file.r2Key,
          mimeType: file.mimeType || null,
          fileName: file.name,
          download,
        });
        if (direct) return direct;
      } catch (err) {
        if (isInvalidRangeError(err)) {
          const headers = new Headers();
          headers.set("Cache-Control", "private, no-store");
          headers.set("Content-Range", `bytes */${Number.isFinite(Number(resolvedBytes)) ? Number(resolvedBytes) : "*"}`);
          return new Response(null, { status: 416, headers });
        }
      }

      return await proxyGatewayObject(
        req,
        gatewayUrl,
        preferredPreviewContentType(file.mimeType || null, file.name),
        !download
      );
    }

    return jsonNoStore({
      ok: true,
      file: fileWithResolvedBytes,
      gatewayUrl,
    }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load file.");
  }
}

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as UpdateFileBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "RENAME_MOVE_FILE",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const file = await updateFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
      name: body.name == null ? undefined : String(body.name || "").trim(),
      folderId: body.folderId === undefined ? undefined : body.folderId == null ? null : String(body.folderId || "").trim(),
      mimeType: body.mimeType == null ? null : String(body.mimeType || "").trim() || null,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update file.");
  }
}

export async function PUT(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  let fileIdForError = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const fileId = String(ctx?.params?.id || "").trim();
    fileIdForError = fileId;
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);

    const mimeType = String(req.headers.get("content-type") || "").split(";")[0]?.trim() || "application/octet-stream";
    const body = new Uint8Array(await req.arrayBuffer());
    const ifMatchSha = parseIfMatchSha(req.headers.get("if-match"));
    const baseShaHeader = parseIfMatchSha(req.headers.get("x-cavcloud-base-sha256"));
    const baseSha256 = ifMatchSha || baseShaHeader || null;

    const file = await saveCavCloudFileContent({
      accountId: sess.accountId,
      userId: sess.sub,
      fileId,
      mimeType,
      body,
      baseSha256,
    });

    if (accountId && userId) {
      try {
        await notifyCavCloudStorageThresholds({ accountId, userId });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    if ((err as { code?: unknown })?.code === "FILE_EDIT_CONFLICT") {
      const conflict = err as { latestSha256?: unknown; latestVersionNumber?: unknown; message?: unknown };
      return jsonNoStore({
        ok: false,
        error: "FILE_EDIT_CONFLICT",
        message: String(conflict.message || "File changed since your last read."),
        latest: {
          sha256: String(conflict.latestSha256 || "") || null,
          versionNumber: Number(conflict.latestVersionNumber || 0) || null,
        },
      }, 409);
    }
    if (accountId && userId) {
      try {
        await notifyCavCloudUploadFailure({
          accountId,
          userId,
          fileName: fileIdForError || null,
          context: "File save",
          errorMessage: (err as { message?: unknown })?.message ? String((err as { message?: unknown }).message) : null,
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking.
      }
    }
    return cavcloudErrorResponse(err, "Failed to save file edits.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "DELETE_TO_TRASH",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    await softDeleteFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to delete file.");
  }
}
