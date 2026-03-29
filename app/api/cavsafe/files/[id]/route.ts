import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeTimeLockEvent } from "@/lib/cavsafe/notifications.server";
import { getFileById, replaceFileContent, softDeleteFile, updateFile } from "@/lib/cavsafe/storage.server";
import { buildCavsafeGatewayUrl } from "@/lib/cavsafe/gateway.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { resolveCavSafeDownloadPreference } from "@/lib/cavsafe/settings.server";
import { mintCavSafeObjectToken } from "@/lib/cavsafe/tokens.server";
import { preferredMimeType } from "@/lib/fileMime";
import { getAppOrigin } from "@/lib/apiAuth";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";
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
  const direct = await getCavsafeObjectStream({
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
  const fileId = String(ctx?.params?.id || "").trim();
  try {
    const sess = await requireUserSession(req);

    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: fileId,
      minRole: "VIEWER",
      onDenied: 404,
    });
    if (access.item.kind !== "file" || !access.item.fileId) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    const file = await getFileById({
      accountId: sess.accountId,
      fileId: access.item.fileId,
      enforceReadTimelock: true,
    });

    const urlObj = new URL(req.url);
    const download = urlObj.searchParams.get("download") === "1";
    const raw = urlObj.searchParams.get("raw") === "1";
    const preferDownloadUnknownBinary = await resolveCavSafeDownloadPreference({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });
    const policyDownload = shouldDefaultDownloadForUnknown(
      preferDownloadUnknownBinary,
      file.mimeType || null,
      file.name,
    );
    const effectiveDownload = download || (raw && policyDownload);
    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: "ACCESS_ATTEMPT",
      subjectType: "file",
      subjectId: file.id,
      label: "CavSafe file access attempt",
      meta: {
        path: file.path,
        raw,
        download: effectiveDownload,
      },
    });

    const origin = appOrigin(req);
    const token = mintCavSafeObjectToken({
      origin,
      objectKey: file.r2Key,
      ttlSeconds: 60,
    });

    const gatewayUrl = buildCavsafeGatewayUrl({
      objectKey: file.r2Key,
      token,
      download: effectiveDownload,
    });

    if (raw) {
      try {
        const direct = await streamObjectFromR2(req, {
          objectKey: file.r2Key,
          mimeType: file.mimeType || null,
          fileName: file.name,
          download: effectiveDownload,
        });
        if (direct) return direct;
      } catch (err) {
        if (isInvalidRangeError(err)) {
          const headers = new Headers();
          headers.set("Cache-Control", "private, no-store");
          headers.set("Content-Range", `bytes */${Number.isFinite(file.bytes) ? file.bytes : "*"}`);
          return new Response(null, { status: 416, headers });
        }
      }

      return await proxyGatewayObject(
        req,
        gatewayUrl,
        preferredPreviewContentType(file.mimeType || null, file.name),
        !effectiveDownload
      );
    }

    return jsonNoStore({
      ok: true,
      file,
      gatewayUrl,
    }, 200);
  } catch (err) {
    const code = String((err as { code?: unknown })?.code || "").toUpperCase();
    if (fileId && (code === "TIMELOCK_NOT_UNLOCKED" || code === "TIMELOCK_EXPIRED")) {
      try {
        const sess = await requireUserSession(req);
        await writeCavSafeOperationLog({
          accountId: sess.accountId,
          operatorUserId: sess.sub,
          kind: "OPEN_DENIED",
          subjectType: "file",
          subjectId: fileId,
          label: "CavSafe file open denied",
          meta: {
            code,
          },
        });
        await notifyCavSafeTimeLockEvent({
          accountId: String(sess.accountId || ""),
          userId: String(sess.sub || ""),
          title: code === "TIMELOCK_EXPIRED" ? "CavSafe file expired" : "CavSafe file still locked",
          body: code === "TIMELOCK_EXPIRED"
            ? "A CavSafe file was blocked because its time lock expired."
            : "A CavSafe file was blocked because its unlock time has not been reached.",
          href: "/cavsafe",
          tone: code === "TIMELOCK_EXPIRED" ? "WATCH" : "BAD",
          dedupeHours: 4,
          meta: {
            code,
            fileId,
          },
        });
      } catch {
        // best effort audit
      }
    }
    return cavsafeErrorResponse(err, "Failed to load file.");
  }
}

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: fileId,
      minRole: "EDITOR",
      onDenied: 403,
    });
    if (access.item.kind !== "file" || !access.item.fileId) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    const body = (await readSanitizedJson(req, null)) as UpdateFileBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const file = await updateFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId: access.item.fileId,
      name: body.name == null ? undefined : String(body.name || "").trim(),
      folderId: body.folderId === undefined ? undefined : body.folderId == null ? null : String(body.folderId || "").trim(),
      mimeType: body.mimeType == null ? null : String(body.mimeType || "").trim() || null,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update file.");
  }
}

export async function PUT(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: fileId,
      minRole: "EDITOR",
      onDenied: 403,
    });
    if (access.item.kind !== "file" || !access.item.fileId) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    const mimeType = String(req.headers.get("content-type") || "").split(";")[0]?.trim() || "application/octet-stream";
    const body = new Uint8Array(await req.arrayBuffer());

    const file = await replaceFileContent({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId: access.item.fileId,
      mimeType,
      body,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to save file edits.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: fileId,
      minRole: "OWNER",
      onDenied: 403,
    });
    if (access.item.kind !== "file" || !access.item.fileId) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    await softDeleteFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId: access.item.fileId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to delete file.");
  }
}
