import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from "crypto";

import { ApiAuthError } from "@/lib/apiAuth";
import { saveCavCloudFileContent } from "@/lib/cavcloud/fileEdits.server";
import {
  CavCloudError,
  createFolder,
  permanentlyDeleteTrashEntry,
  softDeleteFolder,
  updateFile,
  upsertTextFile,
} from "@/lib/cavcloud/storage.server";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { upsertTextFile as upsertCavsafeTextFile } from "@/lib/cavsafe/storage.server";
import { notifyCavCloudCollabSignal } from "@/lib/cavcloud/notifications.server";
import { createDirectUserShares, parseExpiresInDays } from "@/lib/cavcloud/userShares.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { CAVCLOUD_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { prisma } from "@/lib/prisma";

const CAVPAD_TRASH_RETENTION_DAYS = 30;
const CAVPAD_SCOPE_WORKSPACE = "workspace";
const CAVPAD_SCOPE_SITE = "site";
const CAVPAD_FILE_EXT = ".txt";
const CAVPAD_BASE_PATH = "/Synced/CavPad";
type CavPadSyncTarget = "cavcloud" | "cavsafe";

const prismaAny = prisma as any;

export type CavPadPermission = "NONE" | "VIEW" | "EDIT" | "OWNER";

type CavPadDirectoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  pinnedAtISO: string | null;
  createdAtISO: string;
  updatedAtISO: string;
  noteCount: number;
  childCount: number;
};

type CavPadShareAccess = {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarTone: string | null;
  email: string | null;
  permission: "VIEW" | "EDIT";
  expiresAtISO: string | null;
};

export type CavPadNoteRow = {
  id: string;
  title: string;
  scope: "workspace" | "site";
  siteId: string | null;
  directoryId: string | null;
  pinnedAtISO: string | null;
  cavcloudFileId: string;
  cavcloudPath: string;
  mimeType: string;
  sha256: string;
  ownerUserId: string;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
  ownerAvatarTone: string | null;
  ownerEmail: string | null;
  createdAtISO: string;
  updatedAtISO: string;
  trashedAtISO: string | null;
  permission: CavPadPermission;
  status: "normal" | "shared" | "collab";
  shared: boolean;
  collab: boolean;
  collaboratorCount: number;
  editorsCount: number;
  lastChangeAtISO: string | null;
  lastChangeUserId: string | null;
  lastChangeUsername: string | null;
  lastChangeDisplayName: string | null;
  lastChangeEmail: string | null;
  textContent: string;
  accessList: CavPadShareAccess[];
};

export type CavPadSettingsRow = {
  syncToCavcloud: boolean;
  syncToCavsafe: boolean;
  allowSharing: boolean;
  defaultSharePermission: "VIEW" | "EDIT";
  defaultShareExpiryDays: 0 | 7 | 30;
  noteExpiryDays: 0 | 7 | 30;
  trashRetentionDays: 30;
};

export type CavPadBootstrap = {
  notes: CavPadNoteRow[];
  trash: CavPadNoteRow[];
  directories: CavPadDirectoryRow[];
  settings: CavPadSettingsRow;
};

function toISO(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function s(value: unknown): string {
  return String(value || "").trim();
}

function newCavPadNoteId(): string {
  return `note_${Math.random().toString(36).slice(2, 14)}_${Date.now().toString(36)}`;
}

function newCavPadNoteVersionId(): string {
  return `nver_${Math.random().toString(36).slice(2, 14)}_${Date.now().toString(36)}`;
}

function cavPadNoteVersionSha(args: {
  title: string;
  textContent: string;
  directoryId: string | null;
}) {
  const hash = createHash("sha256");
  hash.update(args.title);
  hash.update("\n");
  hash.update(args.directoryId || "");
  hash.update("\n");
  hash.update(args.textContent);
  return hash.digest("hex");
}

async function appendCavPadNoteVersion(args: {
  accountId: string;
  noteId: string;
  createdByUserId: string;
  title: string;
  textContent: string;
  directoryId: string | null;
  force?: boolean;
}) {
  const accountId = s(args.accountId);
  const noteId = s(args.noteId);
  const createdByUserId = s(args.createdByUserId) || null;
  if (!accountId || !noteId) return null;

  const title = s(args.title).slice(0, 160) || "Untitled";
  const textContent = String(args.textContent || "");
  const directoryId = s(args.directoryId) || null;
  const sha256 = cavPadNoteVersionSha({
    title,
    textContent,
    directoryId,
  });

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const latest = await prismaAny.cavPadNoteVersion.findFirst({
      where: {
        accountId,
        noteId,
      },
      orderBy: {
        versionNumber: "desc",
      },
      select: {
        versionNumber: true,
        sha256: true,
        title: true,
        textContent: true,
        directoryId: true,
      },
    });

    const latestVersionNumber = Number(latest?.versionNumber || 0);
    if (!args.force && latestVersionNumber > 0) {
      const sameSnapshot =
        s(latest?.sha256) === sha256 &&
        s(latest?.title) === title &&
        String(latest?.textContent || "") === textContent &&
        s(latest?.directoryId) === s(directoryId);
      if (sameSnapshot) return null;
    }

    try {
      return await prismaAny.cavPadNoteVersion.create({
        data: {
          id: newCavPadNoteVersionId(),
          accountId,
          noteId,
          versionNumber: latestVersionNumber + 1,
          sha256,
          title,
          textContent,
          directoryId,
          createdByUserId,
        },
        select: {
          id: true,
          versionNumber: true,
        },
      });
    } catch (err) {
      const code = s((err as { code?: unknown })?.code).toUpperCase();
      if ((code === "P2002" || isRetryableWriteConflictError(err)) && attempt < maxAttempts) {
        await sleep(20 * attempt + Math.floor(Math.random() * 25));
        continue;
      }
      throw err;
    }
  }

  return null;
}

function normalizeClientNoteId(value: unknown): string | null {
  const raw = s(value);
  if (!raw) return null;
  if (!/^[a-zA-Z0-9:_-]{8,180}$/.test(raw)) return null;
  return raw;
}

function requireCavPadFileId(value: unknown): string {
  const fileId = s(value);
  if (!fileId) throw new ApiAuthError("NOT_FOUND", 404);
  return fileId;
}

function normalizeScope(value: unknown): "workspace" | "site" {
  return s(value).toLowerCase() === CAVPAD_SCOPE_SITE ? CAVPAD_SCOPE_SITE : CAVPAD_SCOPE_WORKSPACE;
}

function normalizeSiteId(value: unknown): string | null {
  const raw = s(value);
  return raw ? raw.slice(0, 120) : null;
}

function parsePinnedAtISO(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const raw = s(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw new ApiAuthError("BAD_REQUEST", 400);
  return parsed;
}

function normalizeSegment(value: string, fallback: string): string {
  const cleaned = s(value)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function safeFileNameFromTitle(title: string): string {
  const base = normalizeSegment(title.toLowerCase().replace(/\s+/g, "-"), "note");
  return `${base}${CAVPAD_FILE_EXT}`;
}

function fileNameWithOrdinal(baseFileName: string, ordinal: number): string {
  if (ordinal <= 1) return baseFileName;
  const trimmed = String(baseFileName || "").trim();
  if (!trimmed) return `note-${ordinal}${CAVPAD_FILE_EXT}`;
  if (!trimmed.toLowerCase().endsWith(CAVPAD_FILE_EXT)) return `${trimmed}-${ordinal}`;
  const stem = trimmed.slice(0, Math.max(0, trimmed.length - CAVPAD_FILE_EXT.length));
  return `${stem}-${ordinal}${CAVPAD_FILE_EXT}`;
}

async function resolveUniqueCavPadFileName(args: {
  accountId: string;
  folderPath: string;
  title: string;
  excludeNoteId?: string | null;
}) {
  const accountId = s(args.accountId);
  const folderPath = s(args.folderPath) || "/";
  const excludeNoteId = s(args.excludeNoteId);
  const baseFileName = safeFileNameFromTitle(args.title);

  for (let ordinal = 1; ordinal <= 240; ordinal += 1) {
    const candidate = fileNameWithOrdinal(baseFileName, ordinal);
    const path = folderPath === "/" ? `/${candidate}` : `${folderPath}/${candidate}`;
    const existing = await prismaAny.cavCloudFile.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        cavpadNotes: {
          select: {
            id: true,
          },
          take: 4,
        },
      },
    });
    if (!existing?.id) return candidate;
    const linkedNoteIds: string[] = Array.isArray(existing.cavpadNotes)
      ? existing.cavpadNotes.map((row: any) => s(row.id)).filter((id: string) => Boolean(id))
      : [];
    if (!linkedNoteIds.length) continue;
    if (excludeNoteId && linkedNoteIds.every((id) => id === excludeNoteId)) {
      return candidate;
    }
  }

  return fileNameWithOrdinal(baseFileName, Date.now() % 10000 || 2);
}

function normalizeSiteFolderName(value: string, fallback = "Site"): string {
  const cleaned = s(value)
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

async function cavpadFolderPath(args: {
  accountId: string;
  scope: "workspace" | "site";
  siteId: string | null;
}) {
  if (args.scope !== CAVPAD_SCOPE_SITE || !args.siteId) return CAVPAD_BASE_PATH;
  const site = await prisma.site.findFirst({
    where: {
      id: args.siteId,
      project: {
        accountId: args.accountId,
      },
    },
    select: {
      label: true,
    },
  });
  const folderName = normalizeSiteFolderName(site?.label || args.siteId, "Site");
  return `${CAVPAD_BASE_PATH}/${folderName}`;
}

function splitPath(path: string): string[] {
  return s(path)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function ensureFolderPath(accountId: string, operatorUserId: string, path: string) {
  const parts = splitPath(path);
  let current = "/";
  for (const part of parts) {
    await createFolder({
      accountId,
      operatorUserId,
      parentPath: current,
      name: part,
    });
    current = current === "/" ? `/${part}` : `${current}/${part}`;
  }
  return current;
}

async function readStreamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);

  if (typeof (body as { getReader?: unknown }).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const row = await reader.read();
      if (row.done) break;
      const chunk = row.value instanceof Uint8Array ? row.value : new Uint8Array(row.value || []);
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return Buffer.from(out);
  }

  if (typeof (body as { on?: unknown }).on === "function") {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (body as NodeJS.ReadableStream)
        .on("data", (chunk: Buffer | Uint8Array | string) => {
          if (Buffer.isBuffer(chunk)) {
            chunks.push(chunk);
            return;
          }
          if (chunk instanceof Uint8Array) {
            chunks.push(Buffer.from(chunk));
            return;
          }
          chunks.push(Buffer.from(String(chunk), "utf8"));
        })
        .once("error", reject)
        .once("end", () => resolve());
    });
    return Buffer.concat(chunks);
  }

  return Buffer.alloc(0);
}

async function readCavCloudFileText(r2Key: string): Promise<string> {
  const direct = await getCavcloudObjectStream({ objectKey: r2Key });
  if (!direct?.body) return "";
  const body = await readStreamToBuffer(direct.body);
  return body.toString("utf8");
}

function normalizeExpiryDays(value: unknown, fallback: 0 | 7 | 30 = 0): 0 | 7 | 30 {
  const parsed = Number(value == null || value === "" ? fallback : value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  if (rounded === 7 || rounded === 30) return rounded;
  return 0;
}

function parseSharePermission(value: unknown, fallback: "VIEW" | "EDIT" = "VIEW"): "VIEW" | "EDIT" {
  const normalized = s(value).toUpperCase();
  if (normalized === "EDIT") return "EDIT";
  if (normalized === "VIEW") return "VIEW";
  return fallback;
}

function mergeGrantPermission(
  left: "VIEW" | "EDIT" | "NONE",
  right: "VIEW" | "EDIT" | "NONE",
): "VIEW" | "EDIT" | "NONE" {
  if (left === "EDIT" || right === "EDIT") return "EDIT";
  if (left === "VIEW" || right === "VIEW") return "VIEW";
  return "NONE";
}

function grantPermissionFromRow(row: { permission?: unknown } | null | undefined): "VIEW" | "EDIT" | "NONE" {
  if (!row) return "NONE";
  const permission = s(row.permission).toUpperCase();
  if (permission === "EDIT") return "EDIT";
  if (permission === "VIEW") return "VIEW";
  return "NONE";
}

function mergeGrantExpiresAtISO(existingISO: string | null, nextISO: string | null): string | null {
  if (!existingISO || !nextISO) return null;
  const existingTime = new Date(existingISO).getTime();
  const nextTime = new Date(nextISO).getTime();
  if (!Number.isFinite(existingTime)) return nextISO;
  if (!Number.isFinite(nextTime)) return existingISO;
  return new Date(Math.max(existingTime, nextTime)).toISOString();
}

type CavPadGrantPermission = "NONE" | "VIEW" | "EDIT";

async function listDirectoryAncestorIds(args: {
  accountId: string;
  directoryId: string;
}): Promise<string[]> {
  const accountId = s(args.accountId);
  let cursor = s(args.directoryId);
  if (!accountId || !cursor) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  let guard = 0;

  while (cursor && guard < 180 && !seen.has(cursor)) {
    seen.add(cursor);
    ids.push(cursor);
    const row = await prismaAny.cavPadDirectory.findFirst({
      where: {
        accountId,
        id: cursor,
      },
      select: {
        id: true,
        parentId: true,
      },
    });
    cursor = s(row?.parentId) || "";
    guard += 1;
  }

  return ids;
}

async function resolveDirectoryGrantPermission(args: {
  accountId: string;
  userId: string;
  directoryId: string | null;
}): Promise<CavPadGrantPermission> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) return "NONE";

  const ancestorIds = await listDirectoryAncestorIds({
    accountId,
    directoryId,
  });
  if (!ancestorIds.length) return "NONE";

  const now = new Date();
  const grants = await prismaAny.cavPadDirectoryAccess.findMany({
    where: {
      accountId,
      userId,
      directoryId: {
        in: ancestorIds,
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      permission: true,
    },
  });

  let merged: CavPadGrantPermission = "NONE";
  for (const row of grants) {
    merged = mergeGrantPermission(merged, grantPermissionFromRow(row));
    if (merged === "EDIT") return "EDIT";
  }
  return merged;
}

async function assertDirectoryWritableByGrant(args: {
  accountId: string;
  userId: string;
  directoryId: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) return;

  const permission = await resolveDirectoryGrantPermission({
    accountId,
    userId,
    directoryId,
  });
  if (permission === "VIEW") {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }
}

function buildInheritedDirectoryPermissionMap(args: {
  directories: Array<{ id: string; parentId: string | null }>;
  grants: Array<{ directoryId: string; permission: CavPadGrantPermission }>;
}): Map<string, CavPadGrantPermission> {
  const byId = new Map<string, { id: string; parentId: string | null }>();
  for (const row of args.directories) {
    const id = s(row.id);
    if (!id) continue;
    byId.set(id, {
      id,
      parentId: s(row.parentId) || null,
    });
  }

  const directPermissionById = new Map<string, CavPadGrantPermission>();
  for (const row of args.grants) {
    const directoryId = s(row.directoryId);
    if (!directoryId) continue;
    const existing = directPermissionById.get(directoryId) || "NONE";
    const merged = mergeGrantPermission(existing, row.permission);
    directPermissionById.set(directoryId, merged);
  }

  const resolved = new Map<string, CavPadGrantPermission>();
  const stack = new Set<string>();

  const visit = (directoryId: string): CavPadGrantPermission => {
    const id = s(directoryId);
    if (!id) return "NONE";
    const cached = resolved.get(id);
    if (cached) return cached;
    if (stack.has(id)) return directPermissionById.get(id) || "NONE";

    stack.add(id);
    const row = byId.get(id);
    const inherited = row?.parentId ? visit(row.parentId) : "NONE";
    const direct = directPermissionById.get(id) || "NONE";
    const merged = mergeGrantPermission(inherited, direct);
    stack.delete(id);
    resolved.set(id, merged);
    return merged;
  };

  for (const row of byId.values()) {
    visit(row.id);
  }

  return resolved;
}

async function resolveRecipientUserIdFromIdentity(args: {
  accountId: string;
  identity: string;
}): Promise<string> {
  const accountId = s(args.accountId);
  const normalizedIdentity = s(args.identity);
  if (!accountId || !normalizedIdentity) throw new ApiAuthError("BAD_REQUEST", 400);

  const usernameFromIdentity = (() => {
    let raw = normalizedIdentity;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length) {
          if (String(parts[0] || "").toLowerCase() === "u" && parts[1]) {
            raw = parts[1];
          } else {
            raw = parts[parts.length - 1] || raw;
          }
        }
      } catch {
        // fall through
      }
    }
    return raw.replace(/^@+/, "").trim().toLowerCase();
  })();

  if (normalizedIdentity.includes("@") && /@/.test(normalizedIdentity) && !normalizedIdentity.trim().startsWith("@")) {
    const email = normalizedIdentity.toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
      },
    });
    const userId = s(user?.id);
    if (!userId) throw new ApiAuthError("RECIPIENT_NOT_FOUND", 404);
    return userId;
  }

  const member = await prisma.membership.findFirst({
    where: {
      accountId,
      user: {
        username: {
          equals: usernameFromIdentity,
          mode: "insensitive",
        },
      },
    },
    select: {
      userId: true,
    },
  });
  const userId = s(member?.userId);
  if (!userId) throw new ApiAuthError("RECIPIENT_NOT_FOUND", 404);
  return userId;
}

function expiresInDaysFromDate(value: Date | string | null | undefined): 0 | 1 | 7 | 30 {
  const iso = toISO(value);
  if (!iso) return 0;
  const expiresAtMs = new Date(iso).getTime();
  if (!Number.isFinite(expiresAtMs)) return 0;
  const diffMs = expiresAtMs - Date.now();
  if (diffMs <= 0) return 1;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  return 30;
}

function cavPadMirrorErrorMessage(err: unknown, fallback: string): string {
  const message = s((err as { message?: unknown })?.message);
  return message || fallback;
}

function parseNoteExpiryDays(value: unknown, fallback: 0 | 7 | 30 = 0): 0 | 7 | 30 {
  return normalizeExpiryDays(value, fallback);
}

const CAVPAD_LEGACY_SYNC_DEFAULT = false;
let cavPadSettingsSupportsSyncFields: boolean | null = null;

type RawCavPadSettings = {
  syncToCavcloud?: unknown;
  syncToCavsafe?: unknown;
  allowSharing?: unknown;
  defaultSharePermission?: unknown;
  defaultShareExpiryDays?: unknown;
  noteExpiryDays?: unknown;
};

function isUnknownCavPadSettingsSyncFieldError(err: unknown): boolean {
  const message = String((err as { message?: unknown })?.message || "");
  return (
    message.includes("Unknown argument `syncToCavcloud`") ||
    message.includes("Unknown argument `syncToCavsafe`")
  );
}

function mapCavPadSettingsRow(
  settings: RawCavPadSettings,
  defaults?: {
    syncToCavcloud?: boolean;
    syncToCavsafe?: boolean;
  },
): CavPadSettingsRow {
  return {
    syncToCavcloud:
      settings.syncToCavcloud == null
        ? Boolean(defaults?.syncToCavcloud ?? CAVPAD_LEGACY_SYNC_DEFAULT)
        : Boolean(settings.syncToCavcloud),
    syncToCavsafe:
      settings.syncToCavsafe == null
        ? Boolean(defaults?.syncToCavsafe ?? CAVPAD_LEGACY_SYNC_DEFAULT)
        : Boolean(settings.syncToCavsafe),
    allowSharing: settings.allowSharing == null ? true : Boolean(settings.allowSharing),
    defaultSharePermission:
      parseSharePermission(settings.defaultSharePermission, "VIEW") === "EDIT" ? "EDIT" : "VIEW",
    defaultShareExpiryDays: normalizeExpiryDays(settings.defaultShareExpiryDays, 0),
    noteExpiryDays: parseNoteExpiryDays(settings.noteExpiryDays, 0),
    trashRetentionDays: CAVPAD_TRASH_RETENTION_DAYS,
  };
}

function defaultCavPadSettingsRow(
  overrides?: Partial<Pick<CavPadSettingsRow, "syncToCavcloud" | "syncToCavsafe" | "allowSharing" | "defaultSharePermission" | "defaultShareExpiryDays" | "noteExpiryDays">>
): CavPadSettingsRow {
  return {
    syncToCavcloud: Boolean(overrides?.syncToCavcloud ?? CAVPAD_LEGACY_SYNC_DEFAULT),
    syncToCavsafe: Boolean(overrides?.syncToCavsafe ?? CAVPAD_LEGACY_SYNC_DEFAULT),
    allowSharing: overrides?.allowSharing == null ? true : Boolean(overrides.allowSharing),
    defaultSharePermission: overrides?.defaultSharePermission === "EDIT" ? "EDIT" : "VIEW",
    defaultShareExpiryDays: normalizeExpiryDays(overrides?.defaultShareExpiryDays, 0),
    noteExpiryDays: parseNoteExpiryDays(overrides?.noteExpiryDays, 0),
    trashRetentionDays: CAVPAD_TRASH_RETENTION_DAYS,
  };
}

function isCavPadSettingsSchemaMismatchError(err: unknown): boolean {
  return (
    isUnknownCavPadSettingsSyncFieldError(err) ||
    isSchemaMismatchError(err, {
      tables: ["CavPadSettings"],
      columns: [
        "syncToCavcloud",
        "syncToCavsafe",
        "allowSharing",
        "defaultSharePermission",
        "defaultShareExpiryDays",
        "noteExpiryDays",
      ],
    })
  );
}

function isRetryableWriteConflictError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  if (code === "P2034") return true;
  const message = String((err as { message?: unknown })?.message || "").toLowerCase();
  return message.includes("write conflict") || message.includes("deadlock");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function resolveNoteWithPermission(args: {
  accountId: string;
  userId: string;
  noteId: string;
  needed?: "VIEW" | "EDIT";
}) {
  const now = new Date();
  const note = await prismaAny.cavPadNote.findFirst({
    where: {
      id: args.noteId,
      accountId: args.accountId,
    },
    include: {
      ownerUser: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
          email: true,
        },
      },
      directory: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
      accessGrants: {
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true,
          userId: true,
          permission: true,
          expiresAt: true,
          user: {
            select: {
              username: true,
              displayName: true,
              avatarImage: true,
              avatarTone: true,
              email: true,
            },
          },
        },
      },
      localVersions: {
        orderBy: {
          versionNumber: "desc",
        },
        take: 1,
        select: {
          createdByUserId: true,
          createdAt: true,
          createdByUser: {
            select: {
              username: true,
              displayName: true,
              email: true,
            },
          },
        },
      },
      cavcloudFile: {
        select: {
          id: true,
          path: true,
          r2Key: true,
          mimeType: true,
          sha256: true,
          createdAt: true,
          updatedAt: true,
          accessGrants: {
            where: {
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            select: {
              id: true,
              userId: true,
              permission: true,
              expiresAt: true,
              user: {
                select: {
                  username: true,
                  displayName: true,
                  avatarImage: true,
                  avatarTone: true,
                  email: true,
                },
              },
            },
          },
          versions: {
            orderBy: {
              versionNumber: "desc",
            },
            take: 1,
            select: {
              createdByUserId: true,
              createdAt: true,
              createdByUser: {
                select: {
                  username: true,
                  displayName: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!note) throw new ApiAuthError("NOT_FOUND", 404);

  const isOwner = s(note.ownerUserId) === args.userId;
  const localGrants = Array.isArray(note.accessGrants) ? note.accessGrants : [];
  const cloudGrants = Array.isArray(note.cavcloudFile?.accessGrants) ? note.cavcloudFile.accessGrants : [];
  const selfLocalGrant = localGrants.find((row: any) => s(row.userId) === args.userId);
  const selfCloudGrant = cloudGrants.find((row: any) => s(row.userId) === args.userId);
  const directoryGrantPermission = await resolveDirectoryGrantPermission({
    accountId: args.accountId,
    userId: args.userId,
    directoryId: s(note.directoryId) || null,
  });

  const mergedSelfGrantPermission = mergeGrantPermission(
    mergeGrantPermission(
      grantPermissionFromRow(selfLocalGrant),
      grantPermissionFromRow(selfCloudGrant),
    ),
    directoryGrantPermission,
  );
  const permission: CavPadPermission = isOwner
    ? "OWNER"
    : mergedSelfGrantPermission === "EDIT"
      ? "EDIT"
      : mergedSelfGrantPermission === "VIEW"
        ? "VIEW"
        : "NONE";

  if (permission === "NONE") throw new ApiAuthError("UNAUTHORIZED", 403);
  if (args.needed === "EDIT" && permission !== "OWNER" && permission !== "EDIT") {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }

  return {
    note,
    permission,
  };
}

async function mapNoteRow(args: {
  accountId: string;
  userId: string;
  note: any;
  includeContent: boolean;
  directoryPermissionById?: Map<string, CavPadGrantPermission>;
  resolvedPermission?: CavPadPermission;
}): Promise<CavPadNoteRow> {
  const { note, includeContent } = args;
  const now = new Date();
  const nowTime = now.getTime();
  const cloudGrants = (Array.isArray(note.cavcloudFile?.accessGrants) ? note.cavcloudFile.accessGrants : [])
    .filter((row: any) => !row.expiresAt || new Date(row.expiresAt).getTime() > nowTime);
  const localGrants = (Array.isArray(note.accessGrants) ? note.accessGrants : [])
    .filter((row: any) => !row.expiresAt || new Date(row.expiresAt).getTime() > nowTime);

  const selfLocalGrant = localGrants.find((row: any) => s(row.userId) === args.userId);
  const selfCloudGrant = cloudGrants.find((row: any) => s(row.userId) === args.userId);
  const directoryId = s(note.directoryId) || null;
  const inheritedDirectoryPermission =
    directoryId && args.directoryPermissionById
      ? (args.directoryPermissionById.get(directoryId) || "NONE")
      : "NONE";
  const mergedSelfGrantPermission = mergeGrantPermission(
    mergeGrantPermission(
      grantPermissionFromRow(selfLocalGrant),
      grantPermissionFromRow(selfCloudGrant),
    ),
    inheritedDirectoryPermission,
  );
  const computedPermission: CavPadPermission = s(note.ownerUserId) === args.userId
    ? "OWNER"
    : mergedSelfGrantPermission === "EDIT"
      ? "EDIT"
      : mergedSelfGrantPermission === "VIEW"
        ? "VIEW"
        : "NONE";
  const permission: CavPadPermission = args.resolvedPermission || computedPermission;

  const ownerUserId = s(note.ownerUserId);
  const mergedGrants = new Map<string, {
    id: string;
    userId: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    avatarTone: string | null;
    email: string | null;
    permission: "VIEW" | "EDIT";
    expiresAtISO: string | null;
  }>();
  const mergeIntoGrantMap = (row: any) => {
    const userId = s(row.userId);
    if (!userId || userId === ownerUserId) return;
    const permission = grantPermissionFromRow(row) === "EDIT" ? "EDIT" : "VIEW";
    const expiresAtISO = toISO(row.expiresAt);
    const existing = mergedGrants.get(userId);
    if (!existing) {
      mergedGrants.set(userId, {
        id: s(row.id) || `${userId}:${permission}`,
        userId,
        username: s(row.user?.username) || null,
        displayName: s(row.user?.displayName) || null,
        avatarUrl: s(row.user?.avatarImage) || null,
        avatarTone: s(row.user?.avatarTone) || null,
        email: s(row.user?.email) || null,
        permission,
        expiresAtISO,
      });
      return;
    }
    mergedGrants.set(userId, {
      ...existing,
      username: existing.username || s(row.user?.username) || null,
      displayName: existing.displayName || s(row.user?.displayName) || null,
      avatarUrl: existing.avatarUrl || s(row.user?.avatarImage) || null,
      avatarTone: existing.avatarTone || s(row.user?.avatarTone) || null,
      email: existing.email || s(row.user?.email) || null,
      permission: mergeGrantPermission(existing.permission, permission) === "EDIT" ? "EDIT" : "VIEW",
      expiresAtISO: mergeGrantExpiresAtISO(existing.expiresAtISO, expiresAtISO),
    });
  };
  localGrants.forEach(mergeIntoGrantMap);
  cloudGrants.forEach(mergeIntoGrantMap);

  const sharedUsers = Array.from(mergedGrants.values());
  const editorsCount = 1 + sharedUsers.filter((row) => row.permission === "EDIT").length;
  const collaboratorCount = 1 + sharedUsers.length;

  const latestLocalVersion = Array.isArray(note.localVersions) ? note.localVersions[0] : null;
  const lastChangeAtISO = toISO(latestLocalVersion?.createdAt);

  const status: "normal" | "shared" | "collab" = editorsCount > 1
    ? "collab"
    : sharedUsers.length > 0 || s(note.ownerUserId) !== args.userId
      ? "shared"
      : "normal";

  let textContent = s(note.textContent);
  if (includeContent && s(note.cavcloudFile?.r2Key)) {
    try {
      textContent = await readCavCloudFileText(String(note.cavcloudFile.r2Key));
      if (textContent !== s(note.textContent)) {
        const syncedAt = new Date(note.cavcloudFile?.updatedAt || Date.now());
        try {
          await prismaAny.cavPadNote.update({
            where: {
              id: s(note.id),
            },
            data: {
              textContent,
              updatedAt: syncedAt,
            },
          });
          await appendCavPadNoteVersion({
            accountId: args.accountId,
            noteId: s(note.id),
            createdByUserId: s(note.cavcloudFile?.versions?.[0]?.createdByUserId || note.ownerUserId),
            title: s(note.title) || "Untitled",
            textContent,
            directoryId: s(note.directoryId) || null,
          });
        } catch {
          // Keep read path fail-open; sync retries on future reads.
        }
      }
    } catch {
      textContent = s(note.textContent);
    }
  }

  return {
    id: String(note.id),
    title: String(note.title || "Untitled"),
    scope: normalizeScope(note.scope),
    siteId: normalizeSiteId(note.siteId),
    directoryId,
    pinnedAtISO: toISO(note.pinnedAt),
    cavcloudFileId: s(note.cavcloudFileId),
    cavcloudPath: s(note.cavcloudFile?.path),
    mimeType: s(note.cavcloudFile?.mimeType) || "text/plain; charset=utf-8",
    sha256: s(note.cavcloudFile?.sha256),
    ownerUserId: s(note.ownerUserId),
    ownerUsername: s(note.ownerUser?.username) || null,
    ownerDisplayName: s(note.ownerUser?.displayName) || null,
    ownerAvatarUrl: s(note.ownerUser?.avatarImage) || null,
    ownerAvatarTone: s(note.ownerUser?.avatarTone) || null,
    ownerEmail: s(note.ownerUser?.email) || null,
    createdAtISO: toISO(note.createdAt) || new Date().toISOString(),
    updatedAtISO: toISO(note.updatedAt || note.cavcloudFile?.updatedAt) || new Date().toISOString(),
    trashedAtISO: toISO(note.trashedAt),
    permission,
    status,
    shared: status === "shared" || status === "collab",
    collab: status === "collab",
    collaboratorCount,
    editorsCount,
    lastChangeAtISO,
    lastChangeUserId: s(latestLocalVersion?.createdByUserId) || null,
    lastChangeUsername: s(latestLocalVersion?.createdByUser?.username) || null,
    lastChangeDisplayName: s(latestLocalVersion?.createdByUser?.displayName) || null,
    lastChangeEmail: s(latestLocalVersion?.createdByUser?.email) || null,
    textContent,
    accessList: sharedUsers,
  };
}

async function purgeExpiredCavPadTrash(accountId: string, operatorUserId: string) {
  const cutoff = new Date(Date.now() - CAVPAD_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prismaAny.cavPadNote.findMany({
    where: {
      accountId,
      trashedAt: {
        lte: cutoff,
      },
    },
    select: {
      id: true,
      cavcloudFileId: true,
    },
    take: 80,
  });

  for (const row of expired) {
    try {
      await permanentlyDeleteCavPadNote({
        accountId,
        userId: operatorUserId,
        noteId: String(row.id),
      });
    } catch {
      // Fail-open. A later list/read cycle will try again.
    }
  }
}

async function getOrCreateCavPadSettings(accountId: string, userId: string): Promise<CavPadSettingsRow> {
  try {
    if (cavPadSettingsSupportsSyncFields !== false) {
      try {
        const settings = await prismaAny.cavPadSettings.upsert({
          where: {
            accountId_userId: {
              accountId,
              userId,
            },
          },
          create: {
            accountId,
            userId,
            syncToCavcloud: false,
            syncToCavsafe: false,
            allowSharing: true,
            defaultSharePermission: "VIEW",
            defaultShareExpiryDays: 0,
            noteExpiryDays: 0,
          },
          update: {},
          select: {
            syncToCavcloud: true,
            syncToCavsafe: true,
            allowSharing: true,
            defaultSharePermission: true,
            defaultShareExpiryDays: true,
            noteExpiryDays: true,
          },
        });
        cavPadSettingsSupportsSyncFields = true;
        return mapCavPadSettingsRow(settings);
      } catch (err) {
        if (!isUnknownCavPadSettingsSyncFieldError(err)) throw err;
        cavPadSettingsSupportsSyncFields = false;
      }
    }

    const settings = await prismaAny.cavPadSettings.upsert({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      create: {
        accountId,
        userId,
        allowSharing: true,
        defaultSharePermission: "VIEW",
        defaultShareExpiryDays: 0,
        noteExpiryDays: 0,
      },
      update: {},
      select: {
        allowSharing: true,
        defaultSharePermission: true,
        defaultShareExpiryDays: true,
        noteExpiryDays: true,
      },
    });

    return mapCavPadSettingsRow(settings, {
      syncToCavcloud: CAVPAD_LEGACY_SYNC_DEFAULT,
      syncToCavsafe: CAVPAD_LEGACY_SYNC_DEFAULT,
    });
  } catch (err) {
    if (!isCavPadSettingsSchemaMismatchError(err)) throw err;
    cavPadSettingsSupportsSyncFields = false;
    return defaultCavPadSettingsRow();
  }
}

export async function assertCavPadSyncTargetEnabled(args: {
  accountId: string;
  userId: string;
  target: CavPadSyncTarget;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  const enabled = args.target === "cavsafe" ? settings.syncToCavsafe : settings.syncToCavcloud;
  if (enabled) return;

  throw new ApiAuthError(
    args.target === "cavsafe" ? "CAVPAD_SYNC_TO_CAVSAFE_DISABLED" : "CAVPAD_SYNC_TO_CAVCLOUD_DISABLED",
    403,
  );
}

export async function getCavPadBootstrap(args: {
  accountId: string;
  userId: string;
  includeContent?: boolean;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const includeContent = args.includeContent !== false;
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);

  await purgeExpiredCavPadTrash(accountId, userId);

  const now = new Date();
  const noteInclude = {
    ownerUser: {
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarImage: true,
        avatarTone: true,
        email: true,
      },
    },
    accessGrants: {
      where: {
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        userId: true,
        permission: true,
        expiresAt: true,
        user: {
          select: {
            username: true,
            displayName: true,
            avatarImage: true,
            avatarTone: true,
            email: true,
          },
        },
      },
    },
    localVersions: {
      orderBy: {
        versionNumber: "desc",
      },
      take: 1,
      select: {
        createdByUserId: true,
        createdAt: true,
        createdByUser: {
          select: {
            username: true,
            displayName: true,
            email: true,
          },
        },
      },
    },
    cavcloudFile: {
      select: {
        id: true,
        path: true,
        r2Key: true,
        mimeType: true,
        sha256: true,
        createdAt: true,
        updatedAt: true,
        accessGrants: {
          where: {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: {
            id: true,
            userId: true,
            permission: true,
            expiresAt: true,
            user: {
              select: {
                username: true,
                displayName: true,
                avatarImage: true,
                avatarTone: true,
                email: true,
              },
            },
          },
        },
        versions: {
          orderBy: {
            versionNumber: "desc",
          },
          take: 1,
          select: {
            createdByUserId: true,
            createdAt: true,
            createdByUser: {
              select: {
                username: true,
                displayName: true,
                email: true,
              },
            },
          },
        },
      },
    },
  } as const;

  const [directoriesRaw, directoryAccessRaw, settings] = await Promise.all([
    prismaAny.cavPadDirectory.findMany({
      where: { accountId },
      orderBy: [{ pinnedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        parentId: true,
        pinnedAt: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            children: true,
            notes: true,
          },
        },
      },
    }),
    prismaAny.cavPadDirectoryAccess.findMany({
      where: {
        accountId,
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        directoryId: true,
        permission: true,
      },
    }),
    getOrCreateCavPadSettings(accountId, userId),
  ]);

  const directoryPermissionById = buildInheritedDirectoryPermissionMap({
    directories: directoriesRaw.map((row: any) => ({
      id: s(row.id),
      parentId: s(row.parentId) || null,
    })),
    grants: directoryAccessRaw.map((row: any) => ({
      directoryId: s(row.directoryId),
      permission: grantPermissionFromRow(row),
    })),
  });
  const sharedDirectoryIds = Array.from(directoryPermissionById.entries())
    .filter(([, permission]) => permission === "VIEW" || permission === "EDIT")
    .map(([directoryId]) => directoryId);

  const noteAccessWhere: Array<Record<string, unknown>> = [
    { ownerUserId: userId },
    {
      accessGrants: {
        some: {
          userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    },
    {
      cavcloudFile: {
        accessGrants: {
          some: {
            userId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    },
  ];
  if (sharedDirectoryIds.length) {
    noteAccessWhere.push({
      directoryId: {
        in: sharedDirectoryIds,
      },
    });
  }

  const [notesRaw, trashRaw] = await Promise.all([
    prismaAny.cavPadNote.findMany({
      where: {
        accountId,
        trashedAt: null,
        OR: noteAccessWhere,
      },
      orderBy: [{ pinnedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      include: noteInclude,
      take: 200,
    }),
    prismaAny.cavPadNote.findMany({
      where: {
        accountId,
        ownerUserId: userId,
        trashedAt: {
          not: null,
        },
      },
      orderBy: [{ trashedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      include: noteInclude,
      take: 400,
    }),
  ]);

  const directories: CavPadDirectoryRow[] = directoriesRaw.map((row: any) => ({
    id: s(row.id),
    name: s(row.name),
    parentId: s(row.parentId) || null,
    pinnedAtISO: toISO(row.pinnedAt),
    createdAtISO: toISO(row.createdAt) || new Date().toISOString(),
    updatedAtISO: toISO(row.updatedAt) || new Date().toISOString(),
    noteCount: Number(row?._count?.notes || 0),
    childCount: Number(row?._count?.children || 0),
  }));

  const mappedNotes = await Promise.all(notesRaw.map((note: any) => mapNoteRow({
    accountId,
    userId,
    note,
    includeContent,
    directoryPermissionById,
  })));
  const mappedTrash = await Promise.all(trashRaw.map((note: any) => mapNoteRow({
    accountId,
    userId,
    note,
    includeContent,
    directoryPermissionById,
  })));

  const notes = mappedNotes.filter((row) => !row.trashedAtISO);
  const trash = mappedTrash.filter((row) => Boolean(row.trashedAtISO));

  return {
    notes,
    trash,
    directories,
    settings,
  } satisfies CavPadBootstrap;
}

export async function createCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId?: string;
  title?: string;
  textContent?: string;
  scope?: "workspace" | "site";
  siteId?: string | null;
  directoryId?: string | null;
  pinnedAtISO?: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);
  const settings = await getOrCreateCavPadSettings(accountId, userId);

  const scope: "workspace" | "site" = CAVPAD_SCOPE_WORKSPACE;
  let siteId: string | null = normalizeSiteId(args.siteId);
  if (siteId) {
    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        project: {
          accountId,
        },
      },
      select: {
        id: true,
      },
    });
    if (!site?.id) siteId = null;
  }
  const title = s(args.title).slice(0, 160) || "Untitled";
  const textContent = String(args.textContent || "");
  const pinnedAt = parsePinnedAtISO(args.pinnedAtISO);

  const directoryId = s(args.directoryId) || null;
  if (directoryId) {
    await assertDirectoryWritableByGrant({
      accountId,
      userId,
      directoryId,
    });
    const directory = await prismaAny.cavPadDirectory.findFirst({
      where: {
        id: directoryId,
        accountId,
      },
      select: {
        id: true,
      },
    });
    if (!directory?.id) throw new ApiAuthError("NOT_FOUND", 404);
  }

  let cavcloudFileId: string | null = null;
  if (settings.syncToCavcloud) {
    const folderPath = await cavpadFolderPath({
      accountId,
      scope,
      siteId,
    });
    await ensureFolderPath(accountId, userId, folderPath);
    const fileName = await resolveUniqueCavPadFileName({
      accountId,
      folderPath,
      title,
    });
    const file = await upsertTextFile({
      accountId,
      operatorUserId: userId,
      folderPath,
      name: fileName,
      mimeType: "text/plain; charset=utf-8",
      content: textContent,
      source: "cavpad",
    });
    cavcloudFileId = s(file.id) || null;
  }

  const requestedNoteId = normalizeClientNoteId(args.noteId);
  let noteId = requestedNoteId || newCavPadNoteId();

  const baseCreateData = {
    accountId,
    ownerUserId: userId,
    cavcloudFileId,
    textContent,
    title,
    directoryId,
    ...(pinnedAt === undefined ? {} : { pinnedAt }),
    scope,
    siteId,
  };

  let created: { id: string };
  try {
    created = await prismaAny.cavPadNote.create({
      data: {
        id: noteId,
        ...baseCreateData,
      },
      select: {
        id: true,
      },
    });
  } catch (err) {
    if (requestedNoteId && String((err as { code?: unknown })?.code || "") === "P2002") {
      noteId = newCavPadNoteId();
      created = await prismaAny.cavPadNote.create({
        data: {
          id: noteId,
          ...baseCreateData,
        },
        select: {
          id: true,
        },
      });
    } else {
      throw err;
    }
  }

  await appendCavPadNoteVersion({
    accountId,
    noteId: s(created.id),
    createdByUserId: userId,
    title,
    textContent,
    directoryId,
    force: true,
  });

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId: s(created.id),
    needed: "VIEW",
  });

  return mapNoteRow({
    accountId,
    userId,
    note: resolved.note,
    includeContent: true,
    resolvedPermission: resolved.permission,
  });
}

export async function getCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId: string;
  includeContent?: boolean;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });

  return mapNoteRow({
    accountId,
    userId,
    note: resolved.note,
    includeContent: args.includeContent !== false,
    resolvedPermission: resolved.permission,
  });
}

export async function updateCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId: string;
  title?: string;
  textContent?: string;
  baseSha256?: string | null;
  directoryId?: string | null;
  pinnedAtISO?: string | null;
  scope?: "workspace" | "site";
  siteId?: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });
  const settings = await getOrCreateCavPadSettings(accountId, userId);

  const note = resolved.note;
  let noteFileId = s(note.cavcloudFileId);
  let provisionedCloudFileThisUpdate = false;
  const updates: Record<string, unknown> = {};
  const requestedTitle = args.title == null ? null : s(args.title).slice(0, 160);
  if (requestedTitle != null && requestedTitle) updates.title = requestedTitle;
  const nextTitleForVersion = requestedTitle && requestedTitle.length ? requestedTitle : s(note.title) || "Untitled";
  let nextDirectoryIdForVersion = s(note.directoryId) || null;

  if (args.directoryId !== undefined) {
    const directoryId = s(args.directoryId) || null;
    if (directoryId) {
      await assertDirectoryWritableByGrant({
        accountId,
        userId,
        directoryId,
      });
      const directory = await prismaAny.cavPadDirectory.findFirst({
        where: {
          id: directoryId,
          accountId,
        },
        select: {
          id: true,
        },
      });
      if (!directory?.id) throw new ApiAuthError("NOT_FOUND", 404);
      updates.directoryId = directoryId;
      nextDirectoryIdForVersion = directoryId;
    } else {
      updates.directoryId = null;
      nextDirectoryIdForVersion = null;
    }
  }

  if (args.pinnedAtISO !== undefined) {
    updates.pinnedAt = parsePinnedAtISO(args.pinnedAtISO);
  }

  const nextScope: "workspace" | "site" = CAVPAD_SCOPE_WORKSPACE;
  const nextSiteId: string | null = normalizeSiteId(note.siteId);
  const hasScopeChange = normalizeScope(note.scope) !== nextScope;
  if (hasScopeChange) {
    updates.scope = nextScope;
  }

  if (settings.syncToCavcloud && !noteFileId) {
    const folderPath = await cavpadFolderPath({
      accountId,
      scope: nextScope,
      siteId: nextSiteId,
    });
    await ensureFolderPath(accountId, userId, folderPath);
    const fileName = await resolveUniqueCavPadFileName({
      accountId,
      folderPath,
      title: requestedTitle || s(note.title) || "Untitled",
      excludeNoteId: note.id,
    });
    const provisioned = await upsertTextFile({
      accountId,
      operatorUserId: userId,
      folderPath,
      name: fileName,
      mimeType: "text/plain; charset=utf-8",
      content: args.textContent == null ? s(note.textContent) : String(args.textContent || ""),
      source: "cavpad",
    });
    noteFileId = s(provisioned.id);
    if (noteFileId) {
      updates.cavcloudFileId = noteFileId;
      provisionedCloudFileThisUpdate = true;
    }
  }

  const shouldRenameFile = requestedTitle != null && requestedTitle && requestedTitle !== s(note.title);
  if (settings.syncToCavcloud && noteFileId && (shouldRenameFile || hasScopeChange)) {
    const fileId = requireCavPadFileId(noteFileId);
    const folderPath = await cavpadFolderPath({
      accountId,
      scope: nextScope,
      siteId: nextSiteId,
    });
    await ensureFolderPath(accountId, userId, folderPath);
    const nextFileName = shouldRenameFile
      ? await resolveUniqueCavPadFileName({
          accountId,
          folderPath,
          title: requestedTitle || s(note.title),
          excludeNoteId: note.id,
        })
      : null;

    if (hasScopeChange) {
      const folder = await prismaAny.cavCloudFolder.findFirst({
        where: {
          accountId,
          path: folderPath,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });
      if (!folder?.id) throw new CavCloudError("FOLDER_NOT_FOUND", 404);
      await updateFile({
        accountId,
        operatorUserId: userId,
        fileId,
        folderId: s(folder.id),
        ...(shouldRenameFile && nextFileName ? { name: nextFileName } : {}),
      });
    } else if (shouldRenameFile) {
      await updateFile({
        accountId,
        operatorUserId: userId,
        fileId,
        ...(nextFileName ? { name: nextFileName } : {}),
      });
    }
  }

  if (args.textContent != null) {
    updates.textContent = String(args.textContent || "");
  }
  const nextTextForVersion = args.textContent != null ? String(args.textContent || "") : String(note.textContent || "");
  const shouldCaptureVersion =
    args.textContent != null ||
    (requestedTitle != null && requestedTitle.length > 0) ||
    args.directoryId !== undefined;

  if (settings.syncToCavcloud && noteFileId && args.textContent != null) {
    const fileId = requireCavPadFileId(noteFileId);
    const rawBaseSha = s(args.baseSha256).toLowerCase();
    const baseSha256 = /^[a-f0-9]{64}$/.test(rawBaseSha) ? rawBaseSha : null;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await saveCavCloudFileContent({
          accountId,
          userId,
          fileId,
          mimeType: "text/plain; charset=utf-8",
          body: new TextEncoder().encode(String(args.textContent || "")),
          baseSha256,
        });
        break;
      } catch (err) {
        if (!isRetryableWriteConflictError(err) || attempt >= maxAttempts) {
          throw err;
        }
        await sleep(40 * attempt + Math.floor(Math.random() * 45));
      }
    }
  }

  if (Object.keys(updates).length) {
    updates.updatedAt = new Date();
    await prismaAny.cavPadNote.update({
      where: {
        id: note.id,
      },
      data: updates,
    });
  }

  if (settings.syncToCavcloud && provisionedCloudFileThisUpdate && noteFileId) {
    await mirrorAllLocalCavPadNoteGrantsToCloud({
      accountId,
      operatorUserId: userId,
      noteId,
      cloudFileId: noteFileId,
    });
  }

  if (shouldCaptureVersion) {
    await appendCavPadNoteVersion({
      accountId,
      noteId,
      createdByUserId: userId,
      title: nextTitleForVersion,
      textContent: nextTextForVersion,
      directoryId: nextDirectoryIdForVersion,
    });
  }

  return getCavPadNote({
    accountId,
    userId,
    noteId,
    includeContent: true,
  });
}

export async function moveCavPadNoteToTrash(args: {
  accountId: string;
  userId: string;
  noteId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);
  // Trash lifecycle is CavPad-owned state and must not depend on sync toggles.

  await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  const trashed = await prismaAny.cavPadNote.update({
    where: {
      id: noteId,
    },
    data: {
      trashedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return {
    ok: true,
    noteId: s(trashed.id),
    trashedAtISO: toISO(trashed.trashedAt),
  };
}

export async function trashCavPadNotesForSite(args: {
  accountId: string;
  operatorUserId: string;
  siteId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const siteId = normalizeSiteId(args.siteId);
  if (!accountId || !operatorUserId || !siteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const trashedAt = new Date();
  let scanned = 0;
  let trashedCount = 0;
  let failedCount = 0;

  while (true) {
    const rows = await prismaAny.cavPadNote.findMany({
      where: {
        accountId,
        siteId,
        trashedAt: null,
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 80,
      select: {
        id: true,
      },
    });

    if (!rows.length) break;
    scanned += rows.length;

    for (const row of rows) {
      try {
        await prismaAny.cavPadNote.update({
          where: {
            id: s(row.id),
          },
          data: {
            trashedAt,
            updatedAt: trashedAt,
          },
          select: {
            id: true,
          },
        });
        trashedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    if (rows.length < 80) break;
  }

  return {
    ok: true,
    scanned,
    trashedCount,
    failedCount,
    trashedAtISO: trashedAt.toISOString(),
  } as const;
}

async function permanentlyDeleteSiteFolderTree(args: {
  accountId: string;
  operatorUserId: string;
  siteId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const siteId = normalizeSiteId(args.siteId);
  if (!accountId || !operatorUserId || !siteId) return { deleted: false as const, path: null as string | null };

  const folderPath = await cavpadFolderPath({
    accountId,
    scope: CAVPAD_SCOPE_SITE,
    siteId,
  });
  const normalizedPath = s(folderPath);
  if (!normalizedPath || normalizedPath === CAVPAD_BASE_PATH) {
    return { deleted: false as const, path: null as string | null };
  }

  const folder = await prismaAny.cavCloudFolder.findFirst({
    where: {
      accountId,
      path: normalizedPath,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!folder?.id) return { deleted: false as const, path: normalizedPath };

  try {
    await softDeleteFolder({
      accountId,
      operatorUserId,
      folderId: s(folder.id),
    });
  } catch (err) {
    const code = String((err as { code?: unknown })?.code || "");
    if (code === "FOLDER_NOT_FOUND") {
      return { deleted: false as const, path: normalizedPath };
    }
    throw err;
  }

  const folderTrash = await prismaAny.cavCloudTrash.findFirst({
    where: {
      accountId,
      folderId: s(folder.id),
    },
    orderBy: {
      deletedAt: "desc",
    },
    select: {
      id: true,
    },
  });

  if (folderTrash?.id) {
    await permanentlyDeleteTrashEntry({
      accountId,
      trashId: s(folderTrash.id),
      operatorUserId,
      reason: "site_delete",
    });
  }

  return { deleted: true as const, path: normalizedPath };
}

export async function purgeCavPadNotesForSite(args: {
  accountId: string;
  operatorUserId: string;
  siteId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const siteId = normalizeSiteId(args.siteId);
  if (!accountId || !operatorUserId || !siteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const purgedAt = new Date();
  let scanned = 0;
  let purgedCount = 0;
  let failedCount = 0;

  while (true) {
    const rows = await prismaAny.cavPadNote.findMany({
      where: {
        accountId,
        siteId,
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 80,
      select: {
        id: true,
        cavcloudFileId: true,
      },
    });

    if (!rows.length) break;
    scanned += rows.length;

    for (const row of rows) {
      const noteId = s(row.id);
      const cavcloudFileId = s(row.cavcloudFileId);
      try {
        if (cavcloudFileId) {
          await prismaAny.cavCloudFileAccess.deleteMany({
            where: {
              accountId,
              fileId: cavcloudFileId,
            },
          });
        }

        await prismaAny.cavPadNote.deleteMany({
          where: {
            accountId,
            id: noteId,
          },
        });

        purgedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    if (rows.length < 80) break;
  }

  const folderCleanup = await permanentlyDeleteSiteFolderTree({
    accountId,
    operatorUserId,
    siteId,
  }).catch(() => ({ deleted: false as const, path: null as string | null }));

  return {
    ok: true,
    scanned,
    purgedCount,
    failedCount,
    folderDeleted: Boolean(folderCleanup.deleted),
    folderPath: folderCleanup.path,
    purgedAtISO: purgedAt.toISOString(),
  } as const;
}

export async function restoreCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);
  // Trash lifecycle is CavPad-owned state and must not depend on sync toggles.

  await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  await prismaAny.cavPadNote.update({
    where: {
      id: noteId,
    },
    data: {
      trashedAt: null,
      updatedAt: new Date(),
    },
  });

  return getCavPadNote({
    accountId,
    userId,
    noteId,
    includeContent: true,
  });
}

export async function permanentlyDeleteCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);
  // Trash lifecycle is CavPad-owned state and must not depend on sync toggles.

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  const cavcloudFileId = s(resolved.note.cavcloudFileId);

  if (cavcloudFileId) {
    await prismaAny.cavCloudFileAccess.deleteMany({
      where: {
        accountId,
        fileId: cavcloudFileId,
      },
    });
  }

  await prismaAny.cavPadNote.delete({
    where: {
      id: noteId,
    },
  });

  return {
    ok: true,
    noteId,
  };
}

export async function listCavPadDirectories(args: {
  accountId: string;
  userId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);

  const rows = await prismaAny.cavPadDirectory.findMany({
    where: {
      accountId,
    },
    orderBy: [{ pinnedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      parentId: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          notes: true,
          children: true,
        },
      },
    },
  });

  return rows.map((row: any) => ({
    id: s(row.id),
    name: s(row.name),
    parentId: s(row.parentId) || null,
    pinnedAtISO: toISO(row.pinnedAt),
    createdAtISO: toISO(row.createdAt) || new Date().toISOString(),
    updatedAtISO: toISO(row.updatedAt) || new Date().toISOString(),
    noteCount: Number(row?._count?.notes || 0),
    childCount: Number(row?._count?.children || 0),
  })) satisfies CavPadDirectoryRow[];
}

async function assertDirectoryParentIsValid(args: {
  accountId: string;
  directoryId: string;
  parentId: string | null;
}) {
  if (!args.parentId) return;
  if (args.parentId === args.directoryId) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  const found = await prismaAny.cavPadDirectory.findFirst({
    where: {
      id: args.parentId,
      accountId: args.accountId,
    },
    select: {
      id: true,
      parentId: true,
    },
  });
  if (!found?.id) throw new ApiAuthError("NOT_FOUND", 404);

  let cursor: string | null = s(found.parentId) || null;
  let guard = 0;
  while (cursor && guard < 120) {
    if (cursor === args.directoryId) throw new ApiAuthError("BAD_REQUEST", 400);
    const row = await prismaAny.cavPadDirectory.findFirst({
      where: {
        id: cursor,
        accountId: args.accountId,
      },
      select: {
        id: true,
        parentId: true,
      },
    });
    cursor = row?.parentId ? s(row.parentId) : null;
    guard += 1;
  }
}

export async function createCavPadDirectory(args: {
  accountId: string;
  userId: string;
  name: string;
  parentId?: string | null;
  pinnedAtISO?: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const name = s(args.name).slice(0, 80);
  const parentId = s(args.parentId) || null;
  const pinnedAt = parsePinnedAtISO(args.pinnedAtISO);

  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);
  if (!name) throw new ApiAuthError("BAD_REQUEST", 400);

  if (parentId) {
    await assertDirectoryWritableByGrant({
      accountId,
      userId,
      directoryId: parentId,
    });
    const parent = await prismaAny.cavPadDirectory.findFirst({
      where: {
        id: parentId,
        accountId,
      },
      select: {
        id: true,
      },
    });
    if (!parent?.id) throw new ApiAuthError("NOT_FOUND", 404);
  }

  const created = await prismaAny.cavPadDirectory.create({
    data: {
      accountId,
      name,
      parentId,
      ...(pinnedAt === undefined ? {} : { pinnedAt }),
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          notes: true,
          children: true,
        },
      },
    },
  });

  return {
    id: s(created.id),
    name: s(created.name),
    parentId: s(created.parentId) || null,
    pinnedAtISO: toISO(created.pinnedAt),
    createdAtISO: toISO(created.createdAt) || new Date().toISOString(),
    updatedAtISO: toISO(created.updatedAt) || new Date().toISOString(),
    noteCount: Number(created?._count?.notes || 0),
    childCount: Number(created?._count?.children || 0),
  } satisfies CavPadDirectoryRow;
}

export async function updateCavPadDirectory(args: {
  accountId: string;
  userId: string;
  directoryId: string;
  name?: string;
  parentId?: string | null;
  pinnedAtISO?: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) throw new ApiAuthError("BAD_REQUEST", 400);

  const existing = await prismaAny.cavPadDirectory.findFirst({
    where: {
      id: directoryId,
      accountId,
    },
    select: {
      id: true,
      parentId: true,
    },
  });
  if (!existing?.id) throw new ApiAuthError("NOT_FOUND", 404);
  await assertDirectoryWritableByGrant({
    accountId,
    userId,
    directoryId,
  });

  const updates: Record<string, unknown> = {};

  if (args.name !== undefined) {
    const name = s(args.name).slice(0, 80);
    if (!name) throw new ApiAuthError("BAD_REQUEST", 400);
    updates.name = name;
  }

  if (args.parentId !== undefined) {
    const parentId = s(args.parentId) || null;
    await assertDirectoryWritableByGrant({
      accountId,
      userId,
      directoryId: parentId,
    });
    await assertDirectoryParentIsValid({
      accountId,
      directoryId,
      parentId,
    });
    updates.parentId = parentId;
  }

  if (args.pinnedAtISO !== undefined) {
    updates.pinnedAt = parsePinnedAtISO(args.pinnedAtISO);
  }

  if (!Object.keys(updates).length) {
    return listCavPadDirectories({ accountId, userId });
  }

  updates.updatedAt = new Date();

  await prismaAny.cavPadDirectory.update({
    where: {
      id: directoryId,
    },
    data: updates,
  });

  return listCavPadDirectories({ accountId, userId });
}

export async function deleteCavPadDirectory(args: {
  accountId: string;
  userId: string;
  directoryId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) throw new ApiAuthError("BAD_REQUEST", 400);

  const existing = await prismaAny.cavPadDirectory.findFirst({
    where: {
      id: directoryId,
      accountId,
    },
    select: {
      id: true,
      parentId: true,
    },
  });
  if (!existing?.id) throw new ApiAuthError("NOT_FOUND", 404);
  await assertDirectoryWritableByGrant({
    accountId,
    userId,
    directoryId,
  });

  const fallbackParentId = s(existing.parentId) || null;

  await prismaAny.$transaction([
    prismaAny.cavPadDirectory.updateMany({
      where: {
        accountId,
        parentId: directoryId,
      },
      data: {
        parentId: fallbackParentId,
      },
    }),
    prismaAny.cavPadNote.updateMany({
      where: {
        accountId,
        directoryId,
      },
      data: {
        directoryId: fallbackParentId,
      },
    }),
    prismaAny.cavPadDirectory.delete({
      where: {
        id: directoryId,
      },
    }),
  ]);

  return {
    ok: true,
  };
}

export async function getCavPadSettings(args: {
  accountId: string;
  userId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);
  return getOrCreateCavPadSettings(accountId, userId);
}

export async function updateCavPadSettings(args: {
  accountId: string;
  userId: string;
  syncToCavcloud?: boolean;
  syncToCavsafe?: boolean;
  allowSharing?: boolean;
  defaultSharePermission?: "VIEW" | "EDIT";
  defaultShareExpiryDays?: 0 | 7 | 30;
  noteExpiryDays?: 0 | 7 | 30;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 401);

  const normalizedSharePermission =
    args.defaultSharePermission === undefined ? undefined : parseSharePermission(args.defaultSharePermission, "VIEW");
  const normalizedShareExpiryDays =
    args.defaultShareExpiryDays === undefined ? undefined : normalizeExpiryDays(args.defaultShareExpiryDays, 0);
  const normalizedNoteExpiryDays =
    args.noteExpiryDays === undefined ? undefined : parseNoteExpiryDays(args.noteExpiryDays, 0);

  try {
    if (cavPadSettingsSupportsSyncFields !== false) {
      try {
        const next = await prismaAny.cavPadSettings.upsert({
          where: {
            accountId_userId: {
              accountId,
              userId,
            },
          },
          create: {
            accountId,
            userId,
            syncToCavcloud: Boolean(args.syncToCavcloud),
            syncToCavsafe: Boolean(args.syncToCavsafe),
            allowSharing: args.allowSharing !== false,
            defaultSharePermission: normalizedSharePermission ?? "VIEW",
            defaultShareExpiryDays: normalizedShareExpiryDays ?? 0,
            noteExpiryDays: normalizedNoteExpiryDays ?? 0,
          },
          update: {
            ...(args.syncToCavcloud === undefined ? {} : { syncToCavcloud: Boolean(args.syncToCavcloud) }),
            ...(args.syncToCavsafe === undefined ? {} : { syncToCavsafe: Boolean(args.syncToCavsafe) }),
            ...(args.allowSharing === undefined ? {} : { allowSharing: Boolean(args.allowSharing) }),
            ...(normalizedSharePermission === undefined ? {} : { defaultSharePermission: normalizedSharePermission }),
            ...(normalizedShareExpiryDays === undefined ? {} : { defaultShareExpiryDays: normalizedShareExpiryDays }),
            ...(normalizedNoteExpiryDays === undefined ? {} : { noteExpiryDays: normalizedNoteExpiryDays }),
          },
          select: {
            syncToCavcloud: true,
            syncToCavsafe: true,
            allowSharing: true,
            defaultSharePermission: true,
            defaultShareExpiryDays: true,
            noteExpiryDays: true,
          },
        });
        cavPadSettingsSupportsSyncFields = true;
        return mapCavPadSettingsRow(next);
      } catch (err) {
        if (!isUnknownCavPadSettingsSyncFieldError(err)) throw err;
        cavPadSettingsSupportsSyncFields = false;
      }
    }

    const next = await prismaAny.cavPadSettings.upsert({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      create: {
        accountId,
        userId,
        allowSharing: args.allowSharing !== false,
        defaultSharePermission: normalizedSharePermission ?? "VIEW",
        defaultShareExpiryDays: normalizedShareExpiryDays ?? 0,
        noteExpiryDays: normalizedNoteExpiryDays ?? 0,
      },
      update: {
        ...(args.allowSharing === undefined ? {} : { allowSharing: Boolean(args.allowSharing) }),
        ...(normalizedSharePermission === undefined ? {} : { defaultSharePermission: normalizedSharePermission }),
        ...(normalizedShareExpiryDays === undefined ? {} : { defaultShareExpiryDays: normalizedShareExpiryDays }),
        ...(normalizedNoteExpiryDays === undefined ? {} : { noteExpiryDays: normalizedNoteExpiryDays }),
      },
      select: {
        allowSharing: true,
        defaultSharePermission: true,
        defaultShareExpiryDays: true,
        noteExpiryDays: true,
      },
    });

    return mapCavPadSettingsRow(next, {
      syncToCavcloud:
        args.syncToCavcloud === undefined ? CAVPAD_LEGACY_SYNC_DEFAULT : Boolean(args.syncToCavcloud),
      syncToCavsafe:
        args.syncToCavsafe === undefined ? CAVPAD_LEGACY_SYNC_DEFAULT : Boolean(args.syncToCavsafe),
    });
  } catch (err) {
    if (!isCavPadSettingsSchemaMismatchError(err)) throw err;
    cavPadSettingsSupportsSyncFields = false;
    return defaultCavPadSettingsRow({
      syncToCavcloud: args.syncToCavcloud,
      syncToCavsafe: args.syncToCavsafe,
      allowSharing: args.allowSharing,
      defaultSharePermission: normalizedSharePermission,
      defaultShareExpiryDays: normalizedShareExpiryDays,
      noteExpiryDays: normalizedNoteExpiryDays,
    });
  }
}

export async function exportCavPadNote(args: {
  accountId: string;
  userId: string;
  noteId: string;
  target: "cavcloud" | "cavsafe";
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);
  await assertCavPadSyncTargetEnabled({
    accountId,
    userId,
    target: args.target === "cavsafe" ? "cavsafe" : "cavcloud",
  });

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });

  const note = await mapNoteRow({
    accountId,
    userId,
    note: resolved.note,
    includeContent: true,
    resolvedPermission: resolved.permission,
  });
  const targetFolderPath = await cavpadFolderPath({
    accountId,
    scope: normalizeScope(note.scope),
    siteId: normalizeSiteId(note.siteId),
  });

  if (args.target === "cavsafe") {
    const exportName = safeFileNameFromTitle(note.title);
    await upsertCavsafeTextFile({
      accountId,
      operatorUserId: userId,
      folderPath: targetFolderPath,
      name: exportName,
      mimeType: "text/plain; charset=utf-8",
      content: note.textContent,
      source: "cavpad",
    });
    return {
      ok: true,
      target: "cavsafe" as const,
    };
  }

  const exportName = safeFileNameFromTitle(note.title);
  await upsertTextFile({
    accountId,
    operatorUserId: userId,
    folderPath: targetFolderPath,
    name: exportName,
    mimeType: "text/plain; charset=utf-8",
    content: note.textContent,
    source: "cavpad",
  });

  return {
    ok: true,
    target: "cavcloud" as const,
  };
}

export async function listCavPadNoteVersions(args: {
  accountId: string;
  userId: string;
  noteId: string;
  limit?: number;
  page?: number;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });
  if (!resolved.note?.id) throw new ApiAuthError("NOT_FOUND", 404);

  const page = Math.max(1, Math.trunc(Number(args.page || 1)));
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit || 50))));
  const versions = await prismaAny.cavPadNoteVersion.findMany({
    where: {
      accountId,
      noteId,
    },
    orderBy: [{ versionNumber: "desc" }, { createdAt: "desc" }],
    skip: (page - 1) * limit,
    take: limit,
    select: {
      id: true,
      versionNumber: true,
      sha256: true,
      createdAt: true,
      createdByUserId: true,
    },
  });

  const userIds: string[] = Array.from(
    new Set(versions.map((row: any) => s(row.createdByUserId)).filter((id: string) => Boolean(id))),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        email: true,
      },
    })
    : [];
  const userMap = new Map(users.map((row) => [s(row.id), row]));

  return versions.map((row: any) => {
    const byUserId = s(row.createdByUserId);
    const operator = userMap.get(byUserId);
    return {
      id: s(row.id),
      versionNumber: Number(row.versionNumber || 0),
      sha256: s(row.sha256),
      createdAtISO: toISO(row.createdAt) || new Date().toISOString(),
      createdByUserId: byUserId || null,
      createdByUsername: s(operator?.username) || null,
      createdByDisplayName: s(operator?.displayName) || null,
      createdByEmail: s(operator?.email) || null,
    };
  });
}

export async function restoreCavPadNoteVersion(args: {
  accountId: string;
  userId: string;
  noteId: string;
  versionId: string;
  baseSha256?: string | null;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  const versionId = s(args.versionId);
  if (!accountId || !userId || !noteId || !versionId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });
  if (!resolved.note?.id) throw new ApiAuthError("NOT_FOUND", 404);

  const version = await prismaAny.cavPadNoteVersion.findFirst({
    where: {
      accountId,
      noteId,
      id: versionId,
    },
    select: {
      title: true,
      textContent: true,
      directoryId: true,
    },
  });
  if (!version) throw new ApiAuthError("NOT_FOUND", 404);

  let directoryId = s(version.directoryId) || null;
  if (directoryId) {
    const exists = await prismaAny.cavPadDirectory.findFirst({
      where: {
        accountId,
        id: directoryId,
      },
      select: {
        id: true,
      },
    });
    if (!exists?.id) directoryId = null;
  }

  return updateCavPadNote({
    accountId,
    userId,
    noteId,
    title: s(version.title) || "Untitled",
    textContent: String(version.textContent || ""),
    directoryId,
    baseSha256: args.baseSha256,
  });
}

async function resolveDirectoryWithPermission(args: {
  accountId: string;
  userId: string;
  directoryId: string;
  needed?: "VIEW" | "EDIT";
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) throw new ApiAuthError("BAD_REQUEST", 400);

  const now = new Date();
  const directory = await prismaAny.cavPadDirectory.findFirst({
    where: {
      accountId,
      id: directoryId,
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      accessGrants: {
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true,
          userId: true,
          permission: true,
          expiresAt: true,
          user: {
            select: {
              username: true,
              displayName: true,
              avatarImage: true,
              avatarTone: true,
              email: true,
            },
          },
        },
      },
    },
  });
  if (!directory?.id) throw new ApiAuthError("NOT_FOUND", 404);

  const grantPermission = await resolveDirectoryGrantPermission({
    accountId,
    userId,
    directoryId,
  });

  // Directory ownership is currently workspace-wide; grant ACL only restricts explicit VIEW shares.
  const permission: CavPadPermission = grantPermission === "EDIT"
    ? "EDIT"
    : grantPermission === "VIEW"
      ? "VIEW"
      : "OWNER";

  if (args.needed === "EDIT" && permission !== "OWNER" && permission !== "EDIT") {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }

  return {
    directory,
    permission,
  };
}

async function listCavPadDirectoryAccessForResolved(args: {
  directory: any;
}) {
  const grantMap = new Map<string, CavPadShareAccess>();
  const rows = Array.isArray(args.directory?.accessGrants) ? args.directory.accessGrants : [];
  for (const row of rows) {
    const userId = s(row.userId);
    if (!userId) continue;
    const permission = grantPermissionFromRow(row) === "EDIT" ? "EDIT" : "VIEW";
    const expiresAtISO = toISO(row.expiresAt);
    const existing = grantMap.get(userId);
    if (!existing) {
      grantMap.set(userId, {
        id: s(row.id) || userId,
        userId,
        username: s(row.user?.username) || null,
        displayName: s(row.user?.displayName) || null,
        avatarUrl: s(row.user?.avatarImage) || null,
        avatarTone: s(row.user?.avatarTone) || null,
        email: s(row.user?.email) || null,
        permission,
        expiresAtISO,
      });
      continue;
    }
    grantMap.set(userId, {
      ...existing,
      username: existing.username || s(row.user?.username) || null,
      displayName: existing.displayName || s(row.user?.displayName) || null,
      avatarUrl: existing.avatarUrl || s(row.user?.avatarImage) || null,
      avatarTone: existing.avatarTone || s(row.user?.avatarTone) || null,
      email: existing.email || s(row.user?.email) || null,
      permission: mergeGrantPermission(existing.permission, permission) === "EDIT" ? "EDIT" : "VIEW",
      expiresAtISO: mergeGrantExpiresAtISO(existing.expiresAtISO, expiresAtISO),
    });
  }

  return Array.from(grantMap.values()).sort((a, b) => {
    const left = s(a.displayName || a.username || a.email || a.userId).toLowerCase();
    const right = s(b.displayName || b.username || b.email || b.userId).toLowerCase();
    return left.localeCompare(right);
  });
}

async function resolveRecipientUserIdForDirectoryShareMutation(args: {
  accountId: string;
  directoryId: string;
  shareIdOrUserId: string;
}) {
  const accountId = s(args.accountId);
  const directoryId = s(args.directoryId);
  const shareIdOrUserId = s(args.shareIdOrUserId);
  if (!accountId || !directoryId || !shareIdOrUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  const byId = await prismaAny.cavPadDirectoryAccess.findFirst({
    where: {
      accountId,
      directoryId,
      id: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(byId?.userId)) return s(byId.userId);

  const byUserId = await prismaAny.cavPadDirectoryAccess.findFirst({
    where: {
      accountId,
      directoryId,
      userId: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(byUserId?.userId)) return s(byUserId.userId);

  throw new ApiAuthError("NOT_FOUND", 404);
}

async function listCavPadNoteAccessForResolved(args: {
  accountId: string;
  userId: string;
  note: any;
}) {
  const mapped = await mapNoteRow({
    accountId: args.accountId,
    userId: args.userId,
    note: args.note,
    includeContent: false,
  });
  return [...mapped.accessList].sort((a, b) => {
    const left = s(a.displayName || a.username || a.email || a.userId).toLowerCase();
    const right = s(b.displayName || b.username || b.email || b.userId).toLowerCase();
    return left.localeCompare(right);
  });
}

async function mirrorCavPadNoteGrantToCloud(args: {
  accountId: string;
  operatorUserId: string;
  cloudFileId: string | null;
  recipientUserId: string;
  permission: "VIEW" | "EDIT";
  expiresInDays: 0 | 1 | 7 | 30;
}) {
  const cloudFileId = s(args.cloudFileId);
  if (!cloudFileId) return { mirrored: false, error: null as string | null };

  try {
    const cloudShare = await createDirectUserShares({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      targetType: "file",
      targetId: requireCavPadFileId(cloudFileId),
      recipients: [{
        userId: args.recipientUserId,
        permission: args.permission,
      }],
      expiresInDays: args.expiresInDays,
    });
    return {
      mirrored: true,
      error: null as string | null,
      cloudShare,
    };
  } catch (err) {
    return {
      mirrored: false,
      error: cavPadMirrorErrorMessage(err, "Failed to mirror share to CavCloud."),
      cloudShare: null as unknown,
    };
  }
}

async function mirrorCavPadNoteGrantRemovalFromCloud(args: {
  accountId: string;
  cloudFileId: string | null;
  recipientUserId: string;
}) {
  const cloudFileId = s(args.cloudFileId);
  if (!cloudFileId) return { mirrored: false, error: null as string | null };

  try {
    await prismaAny.cavCloudFileAccess.deleteMany({
      where: {
        accountId: args.accountId,
        fileId: cloudFileId,
        userId: args.recipientUserId,
      },
    });
    return {
      mirrored: true,
      error: null as string | null,
    };
  } catch (err) {
    return {
      mirrored: false,
      error: cavPadMirrorErrorMessage(err, "Failed to mirror revoke to CavCloud."),
    };
  }
}

async function mirrorAllLocalCavPadNoteGrantsToCloud(args: {
  accountId: string;
  operatorUserId: string;
  noteId: string;
  cloudFileId: string | null;
}) {
  const cloudFileId = s(args.cloudFileId);
  if (!cloudFileId) return;

  const now = new Date();
  const rows = await prismaAny.cavPadNoteAccess.findMany({
    where: {
      accountId: args.accountId,
      noteId: args.noteId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      userId: true,
      permission: true,
      expiresAt: true,
    },
  });

  for (const row of rows) {
    const recipientUserId = s(row.userId);
    if (!recipientUserId) continue;
    const permission = grantPermissionFromRow(row) === "EDIT" ? "EDIT" : "VIEW";
    const expiresInDays = expiresInDaysFromDate(row.expiresAt);
    await mirrorCavPadNoteGrantToCloud({
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      cloudFileId,
      recipientUserId,
      permission,
      expiresInDays,
    });
  }
}

async function resolveRecipientUserIdForShareMutation(args: {
  accountId: string;
  noteId: string;
  cloudFileId: string | null;
  shareIdOrUserId: string;
}) {
  const accountId = s(args.accountId);
  const noteId = s(args.noteId);
  const shareIdOrUserId = s(args.shareIdOrUserId);
  const cloudFileId = s(args.cloudFileId) || null;
  if (!accountId || !noteId || !shareIdOrUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  const localById = await prismaAny.cavPadNoteAccess.findFirst({
    where: {
      accountId,
      noteId,
      id: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(localById?.userId)) return s(localById.userId);

  const localByUser = await prismaAny.cavPadNoteAccess.findFirst({
    where: {
      accountId,
      noteId,
      userId: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(localByUser?.userId)) return s(localByUser.userId);

  if (!cloudFileId) throw new ApiAuthError("NOT_FOUND", 404);

  const cloudById = await prismaAny.cavCloudFileAccess.findFirst({
    where: {
      accountId,
      fileId: cloudFileId,
      id: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(cloudById?.userId)) return s(cloudById.userId);

  const cloudByUser = await prismaAny.cavCloudFileAccess.findFirst({
    where: {
      accountId,
      fileId: cloudFileId,
      userId: shareIdOrUserId,
    },
    select: {
      userId: true,
    },
  });
  if (s(cloudByUser?.userId)) return s(cloudByUser.userId);

  throw new ApiAuthError("NOT_FOUND", 404);
}

export async function listCavPadNoteShares(args: {
  accountId: string;
  userId: string;
  noteId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });

  return listCavPadNoteAccessForResolved({
    accountId,
    userId,
    note: resolved.note,
  });
}

export async function listCavPadDirectoryShares(args: {
  accountId: string;
  userId: string;
  directoryId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) throw new ApiAuthError("BAD_REQUEST", 400);

  const resolved = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "VIEW",
  });

  return listCavPadDirectoryAccessForResolved({
    directory: resolved.directory,
  });
}

export async function shareCavPadDirectoryByIdentity(args: {
  accountId: string;
  userId: string;
  directoryId: string;
  identity: string;
  permission: "VIEW" | "EDIT";
  expiresInDays?: unknown;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  if (!accountId || !userId || !directoryId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  if (!settings.allowSharing) throw new ApiAuthError("UNAUTHORIZED", 403);

  const resolved = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "EDIT",
  });

  const recipientUserId = await resolveRecipientUserIdFromIdentity({
    accountId,
    identity: args.identity,
  });
  if (!recipientUserId || recipientUserId === userId) throw new ApiAuthError("BAD_REQUEST", 400);

  const expiresInDays = parseExpiresInDays(
    args.expiresInDays,
    normalizeExpiryDays(settings.defaultShareExpiryDays, 0) as 0 | 1 | 7 | 30,
  );
  const normalizedPermission = parseSharePermission(args.permission, settings.defaultSharePermission);
  const expiresAt = expiresInDays === 0 ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const share = await prismaAny.cavPadDirectoryAccess.upsert({
    where: {
      cavpad_directory_access_unique: {
        accountId,
        directoryId,
        userId: recipientUserId,
      },
    },
    create: {
      accountId,
      directoryId,
      userId: recipientUserId,
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    update: {
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
          email: true,
        },
      },
    },
  });

  const operator = await prisma.user.findFirst({
    where: { id: userId },
    select: {
      username: true,
      displayName: true,
    },
  });
  const sender = s(operator?.displayName) || (s(operator?.username) ? `@${s(operator?.username)}` : "A CavBot user");
  const folderName = s(resolved.directory.name) || "Folder";
  const expiresText = expiresAt ? ` Expires ${expiresAt.toLocaleDateString()}.` : "";
  await notifyCavCloudCollabSignal({
    accountId,
    userId: recipientUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.FOLDER_SHARED_TO_YOU,
    title: "Folder shared to you",
    body: `${sender} shared ${folderName} with you. ${normalizedPermission === "EDIT" ? "Edit" : "View"} access.${expiresText}`.trim(),
    href: "/",
    tone: normalizedPermission === "EDIT" ? "GOOD" : "WATCH",
    dedupeHours: 1,
  }).catch(() => false);

  const refreshed = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "VIEW",
  });
  const accessList = await listCavPadDirectoryAccessForResolved({
    directory: refreshed.directory,
  });

  return {
    ok: true,
    share: {
      id: s(share.id),
      userId: s(share.userId),
      username: s(share.user?.username) || null,
      displayName: s(share.user?.displayName) || null,
      avatarUrl: s(share.user?.avatarImage) || null,
      avatarTone: s(share.user?.avatarTone) || null,
      email: s(share.user?.email) || null,
      permission: share.permission === "EDIT" ? "EDIT" : "VIEW",
      expiresAtISO: toISO(share.expiresAt),
      createdAtISO: toISO(share.createdAt),
      updatedAtISO: toISO(share.updatedAt),
    },
    accessList,
  } as const;
}

export async function updateCavPadDirectoryShare(args: {
  accountId: string;
  userId: string;
  directoryId: string;
  shareId: string;
  permission?: "VIEW" | "EDIT";
  expiresInDays?: unknown;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  const shareId = s(args.shareId);
  if (!accountId || !userId || !directoryId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  const resolved = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "EDIT",
  });

  const recipientUserId = await resolveRecipientUserIdForDirectoryShareMutation({
    accountId,
    directoryId,
    shareIdOrUserId: shareId,
  });
  if (!recipientUserId || recipientUserId === userId) throw new ApiAuthError("BAD_REQUEST", 400);

  const current = await prismaAny.cavPadDirectoryAccess.findFirst({
    where: {
      accountId,
      directoryId,
      userId: recipientUserId,
    },
    select: {
      permission: true,
      expiresAt: true,
    },
  });

  const existingPermission = grantPermissionFromRow(current);
  const existingExpiresAtISO = toISO(current?.expiresAt);
  const normalizedPermission = args.permission
    ? parseSharePermission(args.permission, settings.defaultSharePermission)
    : existingPermission === "EDIT"
      ? "EDIT"
      : existingPermission === "VIEW"
        ? "VIEW"
        : settings.defaultSharePermission;
  const expiresInDays = args.expiresInDays == null
    ? expiresInDaysFromDate(existingExpiresAtISO)
    : parseExpiresInDays(args.expiresInDays, expiresInDaysFromDate(existingExpiresAtISO));
  const expiresAt = expiresInDays === 0 ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const share = await prismaAny.cavPadDirectoryAccess.upsert({
    where: {
      cavpad_directory_access_unique: {
        accountId,
        directoryId,
        userId: recipientUserId,
      },
    },
    create: {
      accountId,
      directoryId,
      userId: recipientUserId,
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    update: {
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
          email: true,
        },
      },
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: recipientUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.FOLDER_SHARED_TO_YOU,
    title: "Shared access updated",
    body: `${s(resolved.directory.name) || "Folder"} permission changed to ${normalizedPermission === "EDIT" ? "edit" : "view"}.`,
    href: "/",
    tone: normalizedPermission === "EDIT" ? "GOOD" : "WATCH",
    dedupeHours: 1,
  }).catch(() => false);

  const refreshed = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "VIEW",
  });
  const accessList = await listCavPadDirectoryAccessForResolved({
    directory: refreshed.directory,
  });

  return {
    ok: true,
    share: {
      id: s(share.id),
      userId: s(share.userId),
      username: s(share.user?.username) || null,
      displayName: s(share.user?.displayName) || null,
      avatarUrl: s(share.user?.avatarImage) || null,
      avatarTone: s(share.user?.avatarTone) || null,
      email: s(share.user?.email) || null,
      permission: share.permission === "EDIT" ? "EDIT" : "VIEW",
      expiresAtISO: toISO(share.expiresAt),
      createdAtISO: toISO(share.createdAt),
      updatedAtISO: toISO(share.updatedAt),
    },
    accessList,
  } as const;
}

export async function revokeCavPadDirectoryShare(args: {
  accountId: string;
  userId: string;
  directoryId: string;
  shareId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const directoryId = s(args.directoryId);
  const shareId = s(args.shareId);
  if (!accountId || !userId || !directoryId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  if (!settings.allowSharing) throw new ApiAuthError("UNAUTHORIZED", 403);

  const resolved = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "EDIT",
  });

  const recipientUserId = await resolveRecipientUserIdForDirectoryShareMutation({
    accountId,
    directoryId,
    shareIdOrUserId: shareId,
  });
  if (!recipientUserId || recipientUserId === userId) throw new ApiAuthError("BAD_REQUEST", 400);

  const deleted = await prismaAny.cavPadDirectoryAccess.deleteMany({
    where: {
      accountId,
      directoryId,
      userId: recipientUserId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: recipientUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_REVOKED,
    title: "Shared access revoked",
    body: `${s(resolved.directory.name) || "Folder"} access was revoked.`,
    href: "/",
    tone: "WATCH",
    dedupeHours: 1,
  }).catch(() => false);

  const refreshed = await resolveDirectoryWithPermission({
    accountId,
    userId,
    directoryId,
    needed: "VIEW",
  });
  const accessList = await listCavPadDirectoryAccessForResolved({
    directory: refreshed.directory,
  });

  return {
    ok: true,
    removed: {
      userId: recipientUserId,
      localDeletedCount: Number(deleted.count || 0),
    },
    accessList,
  } as const;
}

export async function shareCavPadNoteByIdentity(args: {
  accountId: string;
  userId: string;
  noteId: string;
  identity: string;
  permission: "VIEW" | "EDIT";
  expiresInDays?: unknown;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  if (!accountId || !userId || !noteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  if (!settings.allowSharing) throw new ApiAuthError("UNAUTHORIZED", 403);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  const normalizedIdentity = s(args.identity);
  if (!normalizedIdentity) throw new ApiAuthError("BAD_REQUEST", 400);

  const usernameFromIdentity = (() => {
    let raw = normalizedIdentity;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length) {
          if (String(parts[0] || "").toLowerCase() === "u" && parts[1]) {
            raw = parts[1];
          } else {
            raw = parts[parts.length - 1] || raw;
          }
        }
      } catch {
        // fall through
      }
    }
    return raw.replace(/^@+/, "").trim().toLowerCase();
  })();

  let recipientUserId = "";

  if (normalizedIdentity.includes("@") && /@/.test(normalizedIdentity) && !normalizedIdentity.trim().startsWith("@")) {
    const email = normalizedIdentity.toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
      },
    });

    if (!user?.id) {
      return {
        ok: false,
        error: "EMAIL_ACCOUNT_NOT_FOUND",
        message: "Email sharing fallback requires an existing CavBot account today.",
      } as const;
    }

    recipientUserId = s(user.id);
  } else {
    const member = await prisma.membership.findFirst({
      where: {
        accountId,
        user: {
          username: {
            equals: usernameFromIdentity,
            mode: "insensitive",
          },
        },
      },
      select: {
        userId: true,
      },
    });
    recipientUserId = s(member?.userId);
  }

  if (!recipientUserId) {
    throw new ApiAuthError("RECIPIENT_NOT_FOUND", 404);
  }
  if (recipientUserId === s(resolved.note.ownerUserId)) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  const expiresInDays = parseExpiresInDays(
    args.expiresInDays,
    normalizeExpiryDays(settings.defaultShareExpiryDays, 0) as 0 | 1 | 7 | 30,
  );
  const normalizedPermission = parseSharePermission(args.permission, settings.defaultSharePermission);
  const expiresAt = expiresInDays === 0 ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const localShare = await prismaAny.cavPadNoteAccess.upsert({
    where: {
      cavpad_note_access_unique: {
        accountId,
        noteId,
        userId: recipientUserId,
      },
    },
    create: {
      accountId,
      noteId,
      userId: recipientUserId,
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    update: {
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
          email: true,
        },
      },
    },
  });

  const cloudFileId = s(resolved.note.cavcloudFileId);
  const cloudMirror = settings.syncToCavcloud
    ? await mirrorCavPadNoteGrantToCloud({
      accountId,
      operatorUserId: userId,
      cloudFileId,
      recipientUserId,
      permission: normalizedPermission,
      expiresInDays,
    })
    : { mirrored: false, error: null as string | null, cloudShare: null as unknown };

  const refreshedResolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });
  const accessList = await listCavPadNoteAccessForResolved({
    accountId,
    userId,
    note: refreshedResolved.note,
  });

  return {
    ok: true,
    share: {
      local: {
        id: s(localShare.id),
        userId: s(localShare.userId),
        username: s(localShare.user?.username) || null,
        displayName: s(localShare.user?.displayName) || null,
        avatarUrl: s(localShare.user?.avatarImage) || null,
        avatarTone: s(localShare.user?.avatarTone) || null,
        email: s(localShare.user?.email) || null,
        permission: localShare.permission === "EDIT" ? "EDIT" : "VIEW",
        expiresAtISO: toISO(localShare.expiresAt),
        createdAtISO: toISO(localShare.createdAt),
        updatedAtISO: toISO(localShare.updatedAt),
      },
      cloud: cloudMirror.cloudShare,
    },
    accessList,
    mirror: {
      cloud: {
        mirrored: cloudMirror.mirrored,
        error: cloudMirror.error,
      },
    },
  } as const;
}

export async function updateCavPadNoteShare(args: {
  accountId: string;
  userId: string;
  noteId: string;
  shareId: string;
  permission?: "VIEW" | "EDIT";
  expiresInDays?: unknown;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  const shareId = s(args.shareId);
  if (!accountId || !userId || !noteId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  const recipientUserId = await resolveRecipientUserIdForShareMutation({
    accountId,
    noteId,
    cloudFileId: s(resolved.note.cavcloudFileId) || null,
    shareIdOrUserId: shareId,
  });
  if (!recipientUserId || recipientUserId === s(resolved.note.ownerUserId)) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  const cloudFileId = s(resolved.note.cavcloudFileId) || null;
  const [localCurrent, cloudCurrent] = await Promise.all([
    prismaAny.cavPadNoteAccess.findFirst({
      where: {
        accountId,
        noteId,
        userId: recipientUserId,
      },
      select: {
        permission: true,
        expiresAt: true,
      },
    }),
    cloudFileId
      ? prismaAny.cavCloudFileAccess.findFirst({
        where: {
          accountId,
          fileId: cloudFileId,
          userId: recipientUserId,
        },
        select: {
          permission: true,
          expiresAt: true,
        },
      })
      : null,
  ]);

  const existingPermission = mergeGrantPermission(
    grantPermissionFromRow(localCurrent),
    grantPermissionFromRow(cloudCurrent),
  );
  const existingExpiresAtISO = mergeGrantExpiresAtISO(
    toISO(localCurrent?.expiresAt),
    toISO(cloudCurrent?.expiresAt),
  );
  const normalizedPermission = args.permission
    ? parseSharePermission(args.permission, settings.defaultSharePermission)
    : existingPermission === "EDIT"
      ? "EDIT"
      : existingPermission === "VIEW"
        ? "VIEW"
        : settings.defaultSharePermission;
  const expiresInDays = args.expiresInDays == null
    ? expiresInDaysFromDate(existingExpiresAtISO)
    : parseExpiresInDays(
      args.expiresInDays,
      expiresInDaysFromDate(existingExpiresAtISO),
    );
  const expiresAt = expiresInDays === 0 ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const localShare = await prismaAny.cavPadNoteAccess.upsert({
    where: {
      cavpad_note_access_unique: {
        accountId,
        noteId,
        userId: recipientUserId,
      },
    },
    create: {
      accountId,
      noteId,
      userId: recipientUserId,
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    update: {
      permission: normalizedPermission,
      expiresAt,
      grantedByUserId: userId,
    },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
          email: true,
        },
      },
    },
  });

  const cloudMirror = settings.syncToCavcloud
    ? await mirrorCavPadNoteGrantToCloud({
      accountId,
      operatorUserId: userId,
      cloudFileId,
      recipientUserId,
      permission: normalizedPermission,
      expiresInDays,
    })
    : { mirrored: false, error: null as string | null, cloudShare: null as unknown };

  const refreshedResolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });
  const accessList = await listCavPadNoteAccessForResolved({
    accountId,
    userId,
    note: refreshedResolved.note,
  });

  return {
    ok: true,
    share: {
      id: s(localShare.id),
      userId: s(localShare.userId),
      username: s(localShare.user?.username) || null,
      displayName: s(localShare.user?.displayName) || null,
      avatarUrl: s(localShare.user?.avatarImage) || null,
      avatarTone: s(localShare.user?.avatarTone) || null,
      email: s(localShare.user?.email) || null,
      permission: localShare.permission === "EDIT" ? "EDIT" : "VIEW",
      expiresAtISO: toISO(localShare.expiresAt),
      createdAtISO: toISO(localShare.createdAt),
      updatedAtISO: toISO(localShare.updatedAt),
    },
    accessList,
    mirror: {
      cloud: {
        mirrored: cloudMirror.mirrored,
        error: cloudMirror.error,
      },
    },
  } as const;
}

export async function revokeCavPadNoteShare(args: {
  accountId: string;
  userId: string;
  noteId: string;
  shareId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const noteId = s(args.noteId);
  const shareId = s(args.shareId);
  if (!accountId || !userId || !noteId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  const settings = await getOrCreateCavPadSettings(accountId, userId);
  if (!settings.allowSharing) throw new ApiAuthError("UNAUTHORIZED", 403);

  const resolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "EDIT",
  });

  const recipientUserId = await resolveRecipientUserIdForShareMutation({
    accountId,
    noteId,
    cloudFileId: s(resolved.note.cavcloudFileId) || null,
    shareIdOrUserId: shareId,
  });
  if (!recipientUserId || recipientUserId === s(resolved.note.ownerUserId)) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  const localDeleted = await prismaAny.cavPadNoteAccess.deleteMany({
    where: {
      accountId,
      noteId,
      userId: recipientUserId,
    },
  });

  const cloudMirror = settings.syncToCavcloud
    ? await mirrorCavPadNoteGrantRemovalFromCloud({
      accountId,
      cloudFileId: s(resolved.note.cavcloudFileId) || null,
      recipientUserId,
    })
    : { mirrored: false, error: null as string | null };

  const refreshedResolved = await resolveNoteWithPermission({
    accountId,
    userId,
    noteId,
    needed: "VIEW",
  });
  const accessList = await listCavPadNoteAccessForResolved({
    accountId,
    userId,
    note: refreshedResolved.note,
  });

  return {
    ok: true,
    removed: {
      userId: recipientUserId,
      localDeletedCount: Number(localDeleted.count || 0),
    },
    accessList,
    mirror: {
      cloud: {
        mirrored: cloudMirror.mirrored,
        error: cloudMirror.error,
      },
    },
  } as const;
}
