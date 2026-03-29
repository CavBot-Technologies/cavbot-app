import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import { IntegrationProvider } from "@prisma/client";

import { getAppOrigin } from "@/lib/apiAuth";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { decryptIntegrationToken, encryptIntegrationToken } from "@/lib/integrations/tokenCrypto.server";
import { prisma } from "@/lib/prisma";

export const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const GOOGLE_DRIVE_PROVIDER = IntegrationProvider.GOOGLE_DRIVE;

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";

const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type GoogleNativeExportHint = "PDF" | "XLSX";

type GoogleNativeExportMapValue = {
  exportMimeType: string;
  extension: string;
  hint: GoogleNativeExportHint;
};

const GOOGLE_NATIVE_EXPORT_MAP: Record<string, GoogleNativeExportMapValue> = {
  "application/vnd.google-apps.document": {
    exportMimeType: "application/pdf",
    extension: "pdf",
    hint: "PDF",
  },
  "application/vnd.google-apps.presentation": {
    exportMimeType: "application/pdf",
    extension: "pdf",
    hint: "PDF",
  },
  "application/vnd.google-apps.spreadsheet": {
    exportMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    hint: "XLSX",
  },
};

export type GoogleDriveListItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  isGoogleNativeDoc: boolean;
  exportHint?: GoogleNativeExportHint;
};

export type GoogleDriveListResponse = {
  items: GoogleDriveListItem[];
  nextPageToken: string | null;
};

export type GoogleDriveRawFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  isGoogleNativeDoc: boolean;
  exportHint?: GoogleNativeExportHint;
};

type GoogleDriveFilesListResponse = {
  files?: Array<{
    id?: unknown;
    name?: unknown;
    mimeType?: unknown;
    size?: unknown;
    modifiedTime?: unknown;
  }>;
  nextPageToken?: unknown;
};

type GoogleDriveFileMetadataResponse = {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  modifiedTime?: unknown;
};

type GoogleTokenExchangeResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type GoogleOAuthStatePayload = {
  accountId: string;
  userId: string;
  nonce: string;
  ts: number;
};

export class GoogleDriveError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function asTrimmedString(value: unknown): string {
  return String(value || "").trim();
}

function asSafeStatusCode(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 599) return 500;
  return Math.trunc(parsed);
}

function parseBigIntLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  }
  return null;
}

function oauthStateSecretOrThrow(): string {
  const secret = asTrimmedString(process.env.CAVBOT_SESSION_SECRET || process.env.CAVBOT_INTEGRATIONS_TOKEN_ENC_SECRET);
  if (!secret) {
    throw new GoogleDriveError("OAUTH_STATE_SECRET_MISSING", 500, "Google Drive OAuth state secret is not configured.");
  }
  return secret;
}

function integrationClientIdOrThrow(): string {
  const value = asTrimmedString(process.env.GOOGLE_DRIVE_CLIENT_ID);
  if (!value) {
    throw new GoogleDriveError("GOOGLE_DRIVE_CLIENT_ID_MISSING", 500, "Google Drive client id is not configured.");
  }
  return value;
}

function integrationClientSecretOrThrow(): string {
  const value = asTrimmedString(process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  if (!value) {
    throw new GoogleDriveError("GOOGLE_DRIVE_CLIENT_SECRET_MISSING", 500, "Google Drive client secret is not configured.");
  }
  return value;
}

function resolveRequestOrigin(request: Request): string {
  try {
    const fromUrl = new URL(request.url).origin;
    if (fromUrl && fromUrl !== "null") return fromUrl;
  } catch {
    // no-op
  }

  const forwardedProto = asTrimmedString(request.headers.get("x-forwarded-proto"));
  const forwardedHost = asTrimmedString(request.headers.get("x-forwarded-host") || request.headers.get("host"));
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return getAppOrigin();
}

function resolveGoogleDriveRedirectUri(request: Request): string {
  const configured = asTrimmedString(process.env.GOOGLE_DRIVE_REDIRECT_URI);
  if (configured) return configured;
  return `${resolveRequestOrigin(request).replace(/\/+$/, "")}/api/integrations/google-drive/callback`;
}

function createStateSignature(payloadB64: string): string {
  const secret = oauthStateSecretOrThrow();
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function constantTimeEq(left: string, right: string): boolean {
  const l = Buffer.from(left, "utf8");
  const r = Buffer.from(right, "utf8");
  if (l.length !== r.length) return false;
  return timingSafeEqual(l, r);
}

function normalizeFileName(raw: unknown): string {
  const value = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\//g, " ")
    .replace(/\\/g, " ")
    .trim();
  if (!value) return "Untitled";
  return value.slice(0, 220);
}

function isGoogleNativeMimeType(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps.");
}

function exportMapForMimeType(mimeType: string): GoogleNativeExportMapValue | null {
  const mapped = GOOGLE_NATIVE_EXPORT_MAP[mimeType];
  return mapped || null;
}

function parseDriveRawFile(raw: {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  modifiedTime?: unknown;
}): GoogleDriveRawFile | null {
  const id = asTrimmedString(raw.id);
  if (!id) return null;

  const name = normalizeFileName(raw.name);
  const mimeType = asTrimmedString(raw.mimeType) || "application/octet-stream";
  const sizeBytes = parseBigIntLike(raw.size);
  const modifiedTime = asTrimmedString(raw.modifiedTime) || null;
  const isFolder = mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE;
  const isNative = isGoogleNativeMimeType(mimeType);
  const exportMap = exportMapForMimeType(mimeType);

  return {
    id,
    name,
    mimeType,
    sizeBytes,
    modifiedTime,
    isFolder,
    isGoogleNativeDoc: isNative,
    exportHint: exportMap?.hint,
  };
}

async function parseJsonOrEmpty(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function parseGoogleErrorResponse(payload: Record<string, unknown>): { code: string; message: string } {
  const topError = asTrimmedString(payload.error);
  const topDescription = asTrimmedString(payload.error_description);

  const nestedError = payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)
    ? (payload.error as Record<string, unknown>)
    : null;

  const nestedStatus = asTrimmedString(nestedError?.status);
  const nestedMessage = asTrimmedString(nestedError?.message);

  const code = nestedStatus || topError || "GOOGLE_DRIVE_REQUEST_FAILED";
  const message = nestedMessage || topDescription || "Google Drive request failed.";

  return {
    code,
    message,
  };
}

async function fetchGoogleJson(url: URL, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = await parseJsonOrEmpty(response);
  if (!response.ok) {
    const parsed = parseGoogleErrorResponse(payload);
    throw new GoogleDriveError(parsed.code, asSafeStatusCode(response.status), parsed.message);
  }

  return payload;
}

export function createGoogleDriveOauthState(args: { accountId: string; userId: string }): string {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  if (!accountId || !userId) {
    throw new GoogleDriveError("STATE_PAYLOAD_INVALID", 400, "Invalid Google Drive OAuth state payload.");
  }

  const payload: GoogleOAuthStatePayload = {
    accountId,
    userId,
    nonce: randomBytes(16).toString("hex"),
    ts: Date.now(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createStateSignature(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyGoogleDriveOauthState(
  state: string,
  expected: { accountId: string; userId: string },
  maxAgeMs = 10 * 60 * 1000,
): GoogleOAuthStatePayload {
  const raw = asTrimmedString(state);
  if (!raw) {
    throw new GoogleDriveError("OAUTH_STATE_REQUIRED", 400, "Missing Google Drive OAuth state.");
  }

  const [payloadB64, signature] = raw.split(".");
  if (!payloadB64 || !signature) {
    throw new GoogleDriveError("OAUTH_STATE_INVALID", 400, "Invalid Google Drive OAuth state.");
  }

  const expectedSignature = createStateSignature(payloadB64);
  if (!constantTimeEq(signature, expectedSignature)) {
    throw new GoogleDriveError("OAUTH_STATE_INVALID", 400, "Invalid Google Drive OAuth state.");
  }

  let payload: GoogleOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as GoogleOAuthStatePayload;
  } catch {
    throw new GoogleDriveError("OAUTH_STATE_INVALID", 400, "Invalid Google Drive OAuth state.");
  }

  const accountId = asTrimmedString(payload?.accountId);
  const userId = asTrimmedString(payload?.userId);
  const nonce = asTrimmedString(payload?.nonce);
  const ts = Number(payload?.ts || 0);

  if (!accountId || !userId || !nonce || !Number.isFinite(ts) || ts <= 0) {
    throw new GoogleDriveError("OAUTH_STATE_INVALID", 400, "Invalid Google Drive OAuth state.");
  }

  if (accountId !== asTrimmedString(expected.accountId) || userId !== asTrimmedString(expected.userId)) {
    throw new GoogleDriveError("OAUTH_STATE_ACCOUNT_MISMATCH", 403, "Google Drive OAuth state does not match the active account.");
  }

  if (Date.now() - ts > Math.max(1000, Math.trunc(maxAgeMs))) {
    throw new GoogleDriveError("OAUTH_STATE_EXPIRED", 400, "Google Drive OAuth state expired.");
  }

  return { accountId, userId, nonce, ts };
}

export function buildGoogleDriveAuthorizeUrl(request: Request, state: string): string {
  const clientId = integrationClientIdOrThrow();
  const redirectUri = resolveGoogleDriveRedirectUri(request);

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function exchangeGoogleDriveCodeForTokens(args: {
  request: Request;
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  providerUserId: string | null;
}> {
  const code = asTrimmedString(args.code);
  if (!code) {
    throw new GoogleDriveError("GOOGLE_DRIVE_AUTH_CODE_REQUIRED", 400, "Google Drive authorization code is required.");
  }

  const clientId = integrationClientIdOrThrow();
  const clientSecret = integrationClientSecretOrThrow();
  const redirectUri = resolveGoogleDriveRedirectUri(args.request);

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString(),
    cache: "no-store",
  });

  const payload = (await parseJsonOrEmpty(response)) as GoogleTokenExchangeResponse;
  if (!response.ok) {
    const parsed = parseGoogleErrorResponse(payload as Record<string, unknown>);
    throw new GoogleDriveError("GOOGLE_DRIVE_TOKEN_EXCHANGE_FAILED", response.status, parsed.message);
  }

  const accessToken = asTrimmedString(payload.access_token);
  const refreshToken = asTrimmedString(payload.refresh_token) || null;
  const scope = asTrimmedString(payload.scope) || GOOGLE_DRIVE_READONLY_SCOPE;

  if (!accessToken) {
    throw new GoogleDriveError("GOOGLE_DRIVE_TOKEN_EXCHANGE_FAILED", 502, "Google Drive token exchange did not return an access token.");
  }

  return {
    accessToken,
    refreshToken,
    scope,
    providerUserId: null,
  };
}

export async function refreshGoogleDriveAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  scope: string;
}> {
  const token = asTrimmedString(refreshToken);
  if (!token) {
    throw new GoogleDriveError("GOOGLE_DRIVE_REFRESH_TOKEN_REQUIRED", 401, "Google Drive refresh token is missing.");
  }

  const clientId = integrationClientIdOrThrow();
  const clientSecret = integrationClientSecretOrThrow();

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: token,
    }).toString(),
    cache: "no-store",
  });

  const payload = (await parseJsonOrEmpty(response)) as GoogleTokenExchangeResponse;
  if (!response.ok) {
    const parsed = parseGoogleErrorResponse(payload as Record<string, unknown>);
    const code = asTrimmedString((payload as Record<string, unknown>).error);
    if (code === "invalid_grant") {
      throw new GoogleDriveError("GOOGLE_DRIVE_REAUTH_REQUIRED", 401, "Google Drive authorization expired. Reconnect and try again.");
    }
    throw new GoogleDriveError("GOOGLE_DRIVE_REFRESH_FAILED", response.status, parsed.message);
  }

  const accessToken = asTrimmedString(payload.access_token);
  if (!accessToken) {
    throw new GoogleDriveError("GOOGLE_DRIVE_REFRESH_FAILED", 502, "Google Drive refresh did not return an access token.");
  }

  const scope = asTrimmedString(payload.scope) || GOOGLE_DRIVE_READONLY_SCOPE;
  return { accessToken, scope };
}

export async function revokeGoogleDriveTokenBestEffort(refreshToken: string): Promise<void> {
  const token = asTrimmedString(refreshToken);
  if (!token) return;

  try {
    await fetch(GOOGLE_OAUTH_REVOKE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
    });
  } catch {
    // best-effort revoke
  }
}

export async function upsertGoogleDriveCredential(args: {
  accountId: string;
  userId: string;
  refreshToken: string;
  scope: string;
  providerUserId?: string | null;
}): Promise<void> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  const refreshToken = asTrimmedString(args.refreshToken);
  if (!accountId || !userId || !refreshToken) {
    throw new GoogleDriveError("GOOGLE_DRIVE_CREDENTIAL_INVALID", 400, "Google Drive credential payload is invalid.");
  }

  const refreshTokenEnc = encryptIntegrationToken(refreshToken);

  await prisma.integrationCredential.upsert({
    where: {
      accountId_userId_provider: {
        accountId,
        userId,
        provider: GOOGLE_DRIVE_PROVIDER,
      },
    },
    create: {
      accountId,
      userId,
      provider: GOOGLE_DRIVE_PROVIDER,
      refreshTokenEnc,
      scopes: asTrimmedString(args.scope) || GOOGLE_DRIVE_READONLY_SCOPE,
      providerUserId: asTrimmedString(args.providerUserId) || null,
      revokedAt: null,
    },
    update: {
      refreshTokenEnc,
      scopes: asTrimmedString(args.scope) || GOOGLE_DRIVE_READONLY_SCOPE,
      providerUserId: asTrimmedString(args.providerUserId) || null,
      revokedAt: null,
    },
  });
}

export async function getGoogleDriveConnectionStatus(args: {
  accountId: string;
  userId: string;
}): Promise<{ connected: boolean }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  if (!accountId || !userId) return { connected: false };

  const row = await prisma.integrationCredential.findUnique({
    where: {
      accountId_userId_provider: {
        accountId,
        userId,
        provider: GOOGLE_DRIVE_PROVIDER,
      },
    },
    select: {
      id: true,
      revokedAt: true,
    },
  });

  return {
    connected: Boolean(row?.id) && !row?.revokedAt,
  };
}

async function readGoogleDriveRefreshTokenOrThrow(args: {
  accountId: string;
  userId: string;
}): Promise<{ refreshToken: string; scopes: string }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  if (!accountId || !userId) {
    throw new GoogleDriveError("GOOGLE_DRIVE_ACCOUNT_REQUIRED", 401, "Google Drive account context is required.");
  }

  const row = await prisma.integrationCredential.findUnique({
    where: {
      accountId_userId_provider: {
        accountId,
        userId,
        provider: GOOGLE_DRIVE_PROVIDER,
      },
    },
    select: {
      refreshTokenEnc: true,
      scopes: true,
      revokedAt: true,
    },
  });

  if (!row || row.revokedAt) {
    throw new GoogleDriveError("GOOGLE_DRIVE_NOT_CONNECTED", 409, "Google Drive is not connected.");
  }

  const refreshToken = decryptIntegrationToken(row.refreshTokenEnc);
  if (!refreshToken) {
    throw new GoogleDriveError("GOOGLE_DRIVE_NOT_CONNECTED", 409, "Google Drive is not connected.");
  }

  return {
    refreshToken,
    scopes: asTrimmedString(row.scopes) || GOOGLE_DRIVE_READONLY_SCOPE,
  };
}

export async function getGoogleDriveAccessTokenForUser(args: {
  accountId: string;
  userId: string;
}): Promise<{ accessToken: string; scopes: string }> {
  const credential = await readGoogleDriveRefreshTokenOrThrow(args);
  const refreshed = await refreshGoogleDriveAccessToken(credential.refreshToken);

  return {
    accessToken: refreshed.accessToken,
    scopes: refreshed.scope || credential.scopes,
  };
}

export async function disconnectGoogleDrive(args: {
  accountId: string;
  userId: string;
}): Promise<{ disconnected: boolean }> {
  const accountId = asTrimmedString(args.accountId);
  const userId = asTrimmedString(args.userId);
  if (!accountId || !userId) {
    throw new GoogleDriveError("GOOGLE_DRIVE_ACCOUNT_REQUIRED", 401, "Google Drive account context is required.");
  }

  const row = await prisma.integrationCredential.findUnique({
    where: {
      accountId_userId_provider: {
        accountId,
        userId,
        provider: GOOGLE_DRIVE_PROVIDER,
      },
    },
    select: {
      id: true,
      refreshTokenEnc: true,
      revokedAt: true,
    },
  });

  if (!row?.id || row.revokedAt) {
    return { disconnected: false };
  }

  const refreshToken = decryptIntegrationToken(row.refreshTokenEnc);
  await revokeGoogleDriveTokenBestEffort(refreshToken);

  await prisma.integrationCredential.update({
    where: { id: row.id },
    data: {
      revokedAt: new Date(),
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId: userId,
    kind: "GOOGLE_DRIVE_DISCONNECTED",
    subjectType: "integration",
    subjectId: row.id,
    label: "Google Drive disconnected",
  });

  return { disconnected: true };
}

export async function listGoogleDriveChildren(args: {
  accessToken: string;
  folderId?: string | null;
  pageToken?: string | null;
  pageSize?: number;
}): Promise<GoogleDriveListResponse> {
  const folderId = asTrimmedString(args.folderId) || "root";
  const pageToken = asTrimmedString(args.pageToken) || null;
  const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(args.pageSize || 100)) || 100));

  const q = `'${folderId.replace(/'/g, "")}' in parents and trashed = false`;
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files`);
  url.searchParams.set("q", q);
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime)");
  url.searchParams.set("orderBy", "folder,name_natural");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("pageSize", String(pageSize));
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const payload = (await fetchGoogleJson(url, args.accessToken)) as GoogleDriveFilesListResponse;
  const files = Array.isArray(payload.files) ? payload.files : [];

  const items: GoogleDriveListItem[] = files
    .map(parseDriveRawFile)
    .filter((row): row is GoogleDriveRawFile => !!row)
    .map((row) => ({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      modifiedTime: row.modifiedTime,
      isFolder: row.isFolder,
      isGoogleNativeDoc: row.isGoogleNativeDoc,
      ...(row.exportHint ? { exportHint: row.exportHint } : {}),
    }));

  return {
    items,
    nextPageToken: asTrimmedString(payload.nextPageToken) || null,
  };
}

export async function getGoogleDriveFileMetadata(args: {
  accessToken: string;
  fileId: string;
}): Promise<GoogleDriveRawFile> {
  const fileId = asTrimmedString(args.fileId);
  if (!fileId) {
    throw new GoogleDriveError("GOOGLE_DRIVE_FILE_ID_REQUIRED", 400, "Google Drive file id is required.");
  }

  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime");
  url.searchParams.set("supportsAllDrives", "true");

  const payload = (await fetchGoogleJson(url, args.accessToken)) as GoogleDriveFileMetadataResponse;
  const parsed = parseDriveRawFile(payload);
  if (!parsed) {
    throw new GoogleDriveError("GOOGLE_DRIVE_FILE_NOT_FOUND", 404, "Google Drive file was not found.");
  }
  return parsed;
}

export async function listGoogleDriveFolderChildrenRaw(args: {
  accessToken: string;
  folderId: string;
  pageToken?: string | null;
  pageSize?: number;
}): Promise<{ items: GoogleDriveRawFile[]; nextPageToken: string | null }> {
  const listed = await listGoogleDriveChildren({
    accessToken: args.accessToken,
    folderId: args.folderId,
    pageToken: args.pageToken,
    pageSize: args.pageSize,
  });

  return {
    items: listed.items.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      modifiedTime: item.modifiedTime,
      isFolder: item.isFolder,
      isGoogleNativeDoc: item.isGoogleNativeDoc,
      ...(item.exportHint ? { exportHint: item.exportHint } : {}),
    })),
    nextPageToken: listed.nextPageToken,
  };
}

export function appendGoogleNativeExportExtension(name: string, mimeType: string): string {
  const normalized = normalizeFileName(name);
  const exportMap = exportMapForMimeType(mimeType);
  if (!exportMap) return normalized;

  const lower = normalized.toLowerCase();
  const suffix = `.${exportMap.extension.toLowerCase()}`;
  if (lower.endsWith(suffix)) return normalized;

  return `${normalized}.${exportMap.extension}`;
}

export async function downloadGoogleDriveFileStream(args: {
  accessToken: string;
  fileId: string;
  mimeType: string;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  exported: boolean;
}> {
  const fileId = asTrimmedString(args.fileId);
  if (!fileId) {
    throw new GoogleDriveError("GOOGLE_DRIVE_FILE_ID_REQUIRED", 400, "Google Drive file id is required.");
  }

  const exportMap = exportMapForMimeType(asTrimmedString(args.mimeType));
  const url = exportMap
    ? new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}/export`)
    : new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}`);

  if (exportMap) {
    url.searchParams.set("mimeType", exportMap.exportMimeType);
  } else {
    url.searchParams.set("alt", "media");
  }
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${args.accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await parseJsonOrEmpty(response);
    const parsed = parseGoogleErrorResponse(payload);
    throw new GoogleDriveError("GOOGLE_DRIVE_DOWNLOAD_FAILED", response.status, parsed.message);
  }

  if (!response.body) {
    throw new GoogleDriveError("GOOGLE_DRIVE_DOWNLOAD_FAILED", 502, "Google Drive response did not include a stream body.");
  }

  const contentLength = parseBigIntLike(response.headers.get("content-length"));
  const contentType = asTrimmedString(response.headers.get("content-type"))
    || exportMap?.exportMimeType
    || "application/octet-stream";

  return {
    stream: response.body,
    contentType,
    contentLength,
    exported: Boolean(exportMap),
  };
}

export async function logGoogleDriveConnectedEvent(args: {
  accountId: string;
  userId: string;
  providerSubjectId: string;
}): Promise<void> {
  await writeCavCloudOperationLog({
    accountId: asTrimmedString(args.accountId),
    operatorUserId: asTrimmedString(args.userId) || null,
    kind: "GOOGLE_DRIVE_CONNECTED",
    subjectType: "integration",
    subjectId: asTrimmedString(args.providerSubjectId) || "google_drive",
    label: "Google Drive connected",
  });
}

export function googleDriveSupportsExport(mimeType: string): boolean {
  return Boolean(exportMapForMimeType(asTrimmedString(mimeType)));
}
