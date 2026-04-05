import "server-only";

import type { PublicArtifactVisibility } from "@prisma/client";

import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { prisma } from "@/lib/prisma";

const THEME_ACCENTS = ["lime", "violet", "blue", "white", "clear"] as const;
const START_LOCATIONS = ["root", "lastFolder", "pinnedFolder"] as const;
const DEFAULT_VIEWS = ["grid", "list"] as const;
const DEFAULT_SORTS = ["name", "modified", "size"] as const;
const FOLDER_UPLOAD_MODES = ["preserveRoot", "flatten"] as const;
const NAME_COLLISION_RULES = ["autoRename", "failAsk"] as const;
const UPLOAD_CONCURRENCY = ["auto", "low", "high"] as const;
const SHARE_ACCESS_POLICIES = ["anyone", "cavbotUsers", "workspaceMembers"] as const;
const TITLE_MODES = ["filename", "custom"] as const;
const EXPIRY_DAYS = [0, 1, 7, 30] as const;
const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;
const TRASH_RETENTION_DAYS = [7, 14, 30] as const;
const SHA256_ENFORCED = true;

export type CavCloudThemeAccent = (typeof THEME_ACCENTS)[number];
export type CavCloudStartLocation = (typeof START_LOCATIONS)[number];
export type CavCloudDefaultView = (typeof DEFAULT_VIEWS)[number];
export type CavCloudDefaultSort = (typeof DEFAULT_SORTS)[number];
export type CavCloudFolderUploadMode = (typeof FOLDER_UPLOAD_MODES)[number];
export type CavCloudNameCollisionRule = (typeof NAME_COLLISION_RULES)[number];
export type CavCloudUploadConcurrency = (typeof UPLOAD_CONCURRENCY)[number];
export type CavCloudShareAccessPolicy = (typeof SHARE_ACCESS_POLICIES)[number];
export type CavCloudPublishTitleMode = (typeof TITLE_MODES)[number];

export type CavCloudSettings = {
  themeAccent: CavCloudThemeAccent;
  startLocation: CavCloudStartLocation;
  lastFolderId: string | null;
  lastFolderPath: string | null;
  pinnedFolderId: string | null;
  pinnedFolderPath: string | null;
  defaultView: CavCloudDefaultView;
  defaultSort: CavCloudDefaultSort;
  foldersFirst: boolean;
  showExtensions: boolean;
  showDotfiles: boolean;
  confirmTrashDelete: boolean;
  confirmPermanentDelete: boolean;
  folderUploadMode: CavCloudFolderUploadMode;
  nameCollisionRule: CavCloudNameCollisionRule;
  uploadAutoRetry: boolean;
  uploadConcurrency: CavCloudUploadConcurrency;
  generateTextSnippets: boolean;
  computeSha256: boolean;
  showUploadQueue: boolean;
  shareDefaultExpiryDays: 1 | 7 | 30;
  shareAccessPolicy: CavCloudShareAccessPolicy;
  publishDefaultVisibility: PublicArtifactVisibility;
  publishRequireConfirm: boolean;
  publishDefaultTitleMode: CavCloudPublishTitleMode;
  publishDefaultExpiryDays: 0 | 1 | 7 | 30;
  trashRetentionDays: 7 | 14 | 30;
  autoPurgeTrash: boolean;
  preferDownloadUnknownBinary: boolean;
  notifyStorage80: boolean;
  notifyStorage95: boolean;
  notifyUploadFailures: boolean;
  notifyShareExpiringSoon: boolean;
  notifyArtifactPublished: boolean;
  notifyBulkDeletePurge: boolean;
};

export type CavCloudListingPreferences = {
  defaultView: CavCloudDefaultView;
  defaultSort: CavCloudDefaultSort;
  foldersFirst: boolean;
  showDotfiles: boolean;
  showExtensions: boolean;
};

export const DEFAULT_CAVCLOUD_SETTINGS: CavCloudSettings = {
  themeAccent: "lime",
  startLocation: "root",
  lastFolderId: null,
  lastFolderPath: null,
  pinnedFolderId: null,
  pinnedFolderPath: null,
  defaultView: "grid",
  defaultSort: "name",
  foldersFirst: true,
  showExtensions: true,
  showDotfiles: false,
  confirmTrashDelete: true,
  confirmPermanentDelete: true,
  folderUploadMode: "preserveRoot",
  nameCollisionRule: "autoRename",
  uploadAutoRetry: true,
  uploadConcurrency: "auto",
  generateTextSnippets: true,
  computeSha256: SHA256_ENFORCED,
  showUploadQueue: true,
  shareDefaultExpiryDays: 7,
  shareAccessPolicy: "anyone",
  publishDefaultVisibility: "LINK_ONLY",
  publishRequireConfirm: true,
  publishDefaultTitleMode: "filename",
  publishDefaultExpiryDays: 0,
  trashRetentionDays: 30,
  autoPurgeTrash: true,
  preferDownloadUnknownBinary: true,
  notifyStorage80: true,
  notifyStorage95: true,
  notifyUploadFailures: true,
  notifyShareExpiringSoon: true,
  notifyArtifactPublished: true,
  notifyBulkDeletePurge: true,
};

type PatchInput = Partial<Omit<CavCloudSettings, "lastFolderPath" | "pinnedFolderPath">>;

function pickEnum<T extends readonly string[]>(
  raw: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = String(raw ?? "").trim();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T[number]) : fallback;
}

function pickBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function pickInt<T extends readonly number[]>(
  raw: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  return (allowed as readonly number[]).includes(int) ? (int as T[number]) : fallback;
}

function normalizeId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value || null;
}

function normalizeSettingsRow(row: Partial<Record<string, unknown>> | null | undefined): CavCloudSettings {
  const safe = row || {};
  return {
    themeAccent: pickEnum(safe.themeAccent, THEME_ACCENTS, DEFAULT_CAVCLOUD_SETTINGS.themeAccent),
    startLocation: pickEnum(safe.startLocation, START_LOCATIONS, DEFAULT_CAVCLOUD_SETTINGS.startLocation),
    lastFolderId: normalizeId(safe.lastFolderId),
    lastFolderPath: null,
    pinnedFolderId: normalizeId(safe.pinnedFolderId),
    pinnedFolderPath: null,
    defaultView: pickEnum(safe.defaultView, DEFAULT_VIEWS, DEFAULT_CAVCLOUD_SETTINGS.defaultView),
    defaultSort: pickEnum(safe.defaultSort, DEFAULT_SORTS, DEFAULT_CAVCLOUD_SETTINGS.defaultSort),
    foldersFirst: pickBoolean(safe.foldersFirst, DEFAULT_CAVCLOUD_SETTINGS.foldersFirst),
    showExtensions: pickBoolean(safe.showExtensions, DEFAULT_CAVCLOUD_SETTINGS.showExtensions),
    showDotfiles: pickBoolean(safe.showDotfiles, DEFAULT_CAVCLOUD_SETTINGS.showDotfiles),
    confirmTrashDelete: pickBoolean(safe.confirmTrashDelete, DEFAULT_CAVCLOUD_SETTINGS.confirmTrashDelete),
    confirmPermanentDelete: pickBoolean(
      safe.confirmPermanentDelete,
      DEFAULT_CAVCLOUD_SETTINGS.confirmPermanentDelete,
    ),
    folderUploadMode: pickEnum(
      safe.folderUploadMode,
      FOLDER_UPLOAD_MODES,
      DEFAULT_CAVCLOUD_SETTINGS.folderUploadMode,
    ),
    nameCollisionRule: pickEnum(
      safe.nameCollisionRule,
      NAME_COLLISION_RULES,
      DEFAULT_CAVCLOUD_SETTINGS.nameCollisionRule,
    ),
    uploadAutoRetry: pickBoolean(safe.uploadAutoRetry, DEFAULT_CAVCLOUD_SETTINGS.uploadAutoRetry),
    uploadConcurrency: pickEnum(
      safe.uploadConcurrency,
      UPLOAD_CONCURRENCY,
      DEFAULT_CAVCLOUD_SETTINGS.uploadConcurrency,
    ),
    generateTextSnippets: pickBoolean(
      safe.generateTextSnippets,
      DEFAULT_CAVCLOUD_SETTINGS.generateTextSnippets,
    ),
    computeSha256: SHA256_ENFORCED,
    showUploadQueue: pickBoolean(safe.showUploadQueue, DEFAULT_CAVCLOUD_SETTINGS.showUploadQueue),
    shareDefaultExpiryDays: pickInt(
      safe.shareDefaultExpiryDays,
      SHARE_EXPIRY_DAYS,
      DEFAULT_CAVCLOUD_SETTINGS.shareDefaultExpiryDays,
    ),
    shareAccessPolicy: pickEnum(
      safe.shareAccessPolicy,
      SHARE_ACCESS_POLICIES,
      DEFAULT_CAVCLOUD_SETTINGS.shareAccessPolicy,
    ),
    publishDefaultVisibility: pickEnum(
      safe.publishDefaultVisibility,
      ["LINK_ONLY", "PUBLIC_PROFILE", "PRIVATE"] as const,
      DEFAULT_CAVCLOUD_SETTINGS.publishDefaultVisibility,
    ),
    publishRequireConfirm: pickBoolean(
      safe.publishRequireConfirm,
      DEFAULT_CAVCLOUD_SETTINGS.publishRequireConfirm,
    ),
    publishDefaultTitleMode: pickEnum(
      safe.publishDefaultTitleMode,
      TITLE_MODES,
      DEFAULT_CAVCLOUD_SETTINGS.publishDefaultTitleMode,
    ),
    publishDefaultExpiryDays: pickInt(
      safe.publishDefaultExpiryDays,
      EXPIRY_DAYS,
      DEFAULT_CAVCLOUD_SETTINGS.publishDefaultExpiryDays,
    ),
    trashRetentionDays: pickInt(
      safe.trashRetentionDays,
      TRASH_RETENTION_DAYS,
      DEFAULT_CAVCLOUD_SETTINGS.trashRetentionDays,
    ),
    autoPurgeTrash: pickBoolean(safe.autoPurgeTrash, DEFAULT_CAVCLOUD_SETTINGS.autoPurgeTrash),
    preferDownloadUnknownBinary: pickBoolean(
      safe.preferDownloadUnknownBinary,
      DEFAULT_CAVCLOUD_SETTINGS.preferDownloadUnknownBinary,
    ),
    notifyStorage80: pickBoolean(safe.notifyStorage80, DEFAULT_CAVCLOUD_SETTINGS.notifyStorage80),
    notifyStorage95: pickBoolean(safe.notifyStorage95, DEFAULT_CAVCLOUD_SETTINGS.notifyStorage95),
    notifyUploadFailures: pickBoolean(
      safe.notifyUploadFailures,
      DEFAULT_CAVCLOUD_SETTINGS.notifyUploadFailures,
    ),
    notifyShareExpiringSoon: pickBoolean(
      safe.notifyShareExpiringSoon,
      DEFAULT_CAVCLOUD_SETTINGS.notifyShareExpiringSoon,
    ),
    notifyArtifactPublished: pickBoolean(
      safe.notifyArtifactPublished,
      DEFAULT_CAVCLOUD_SETTINGS.notifyArtifactPublished,
    ),
    notifyBulkDeletePurge: pickBoolean(
      safe.notifyBulkDeletePurge,
      DEFAULT_CAVCLOUD_SETTINGS.notifyBulkDeletePurge,
    ),
  };
}

function isMissingSettingsTableError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
      || (err as { message?: unknown })?.message
      || "",
  ).toLowerCase();
  return code === "P2021" || (message.includes("cavcloudsettings") && message.includes("does not exist"));
}

function isSettingsForeignKeyViolationError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "");
  if (code !== "P2003") return false;
  const message = String(
    (err as { meta?: { field_name?: unknown; message?: unknown }; message?: unknown })?.meta?.field_name
      || (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
      || (err as { message?: unknown })?.message
      || "",
  ).toLowerCase();
  return message.includes("cavcloudsettings_accountid_fkey")
    || message.includes("cavcloudsettings_userid_fkey");
}

async function hasSettingsMembership(accountId: string, userId: string): Promise<boolean> {
  if (!accountId || !userId) return false;
  try {
    const membership = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      select: { id: true },
    });
    return Boolean(membership?.id);
  } catch (err) {
    if (
      isSchemaMismatchError(err, {
        tables: ["Membership"],
        columns: ["accountId", "userId"],
      })
    ) {
      return false;
    }
    throw err;
  }
}

async function resolveFolderPathById(accountId: string, folderId: string | null): Promise<string | null> {
  if (!folderId) return null;
  try {
    const folder = await prisma.cavCloudFolder.findFirst({
      where: {
        id: folderId,
        accountId,
        deletedAt: null,
      },
      select: {
        path: true,
      },
    });
    return folder?.path ? String(folder.path) : null;
  } catch (err) {
    if (
      isSchemaMismatchError(err, {
        tables: ["CavCloudFolder"],
        columns: ["path", "accountId", "deletedAt"],
      })
    ) {
      return null;
    }
    throw err;
  }
}

async function ensureSettingsRow(accountId: string, userId: string) {
  const canPersist = await hasSettingsMembership(accountId, userId);
  if (!canPersist) return null;
  try {
    return await prisma.cavCloudSettings.upsert({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      create: {
        accountId,
        userId,
      },
      update: {},
    });
  } catch (err) {
    if (isMissingSettingsTableError(err)) return null;
    if (isSettingsForeignKeyViolationError(err)) return null;
    throw err;
  }
}

export function parseCavCloudSettingsPatch(input: unknown): {
  ok: true;
  patch: PatchInput;
} | {
  ok: false;
  error: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON payload." };
  }
  const body = input as Record<string, unknown>;
  const patch: PatchInput = {};

  const setEnum = <T extends readonly string[]>(
    key: keyof PatchInput,
    allowed: T,
    label: string,
  ) => {
    if (!(key in body)) return;
    const value = String(body[key as string] ?? "").trim();
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`${label} is invalid.`);
    }
    (patch as Record<string, unknown>)[key as string] = value;
  };

  const setBool = (key: keyof PatchInput, label: string) => {
    if (!(key in body)) return;
    if (typeof body[key as string] !== "boolean") {
      throw new Error(`${label} must be boolean.`);
    }
    (patch as Record<string, unknown>)[key as string] = body[key as string];
  };

  const setInt = <T extends readonly number[]>(
    key: keyof PatchInput,
    allowed: T,
    label: string,
  ) => {
    if (!(key in body)) return;
    const n = Number(body[key as string]);
    const value = Number.isFinite(n) ? Math.trunc(n) : NaN;
    if (!(allowed as readonly number[]).includes(value)) {
      throw new Error(`${label} is invalid.`);
    }
    (patch as Record<string, unknown>)[key as string] = value;
  };

  const setId = (key: keyof PatchInput, label: string) => {
    if (!(key in body)) return;
    const raw = body[key as string];
    if (raw == null || raw === "") {
      (patch as Record<string, unknown>)[key as string] = null;
      return;
    }
    const value = String(raw).trim();
    if (!value) {
      throw new Error(`${label} is invalid.`);
    }
    (patch as Record<string, unknown>)[key as string] = value;
  };

  try {
    setEnum("themeAccent", THEME_ACCENTS, "themeAccent");
    setEnum("startLocation", START_LOCATIONS, "startLocation");
    setId("lastFolderId", "lastFolderId");
    setId("pinnedFolderId", "pinnedFolderId");
    setEnum("defaultView", DEFAULT_VIEWS, "defaultView");
    setEnum("defaultSort", DEFAULT_SORTS, "defaultSort");
    setBool("foldersFirst", "foldersFirst");
    setBool("showExtensions", "showExtensions");
    setBool("showDotfiles", "showDotfiles");
    setBool("confirmTrashDelete", "confirmTrashDelete");
    setBool("confirmPermanentDelete", "confirmPermanentDelete");
    setEnum("folderUploadMode", FOLDER_UPLOAD_MODES, "folderUploadMode");
    setEnum("nameCollisionRule", NAME_COLLISION_RULES, "nameCollisionRule");
    setBool("uploadAutoRetry", "uploadAutoRetry");
    setEnum("uploadConcurrency", UPLOAD_CONCURRENCY, "uploadConcurrency");
    setBool("generateTextSnippets", "generateTextSnippets");
    if ("computeSha256" in body) {
      if (body.computeSha256 !== true) {
        throw new Error("computeSha256 is enforced and must be true.");
      }
      patch.computeSha256 = true;
    }
    setBool("showUploadQueue", "showUploadQueue");
    setInt("shareDefaultExpiryDays", SHARE_EXPIRY_DAYS, "shareDefaultExpiryDays");
    setEnum("shareAccessPolicy", SHARE_ACCESS_POLICIES, "shareAccessPolicy");
    setEnum(
      "publishDefaultVisibility",
      ["LINK_ONLY", "PUBLIC_PROFILE", "PRIVATE"] as const,
      "publishDefaultVisibility",
    );
    setBool("publishRequireConfirm", "publishRequireConfirm");
    setEnum("publishDefaultTitleMode", TITLE_MODES, "publishDefaultTitleMode");
    setInt("publishDefaultExpiryDays", EXPIRY_DAYS, "publishDefaultExpiryDays");
    setInt("trashRetentionDays", TRASH_RETENTION_DAYS, "trashRetentionDays");
    setBool("autoPurgeTrash", "autoPurgeTrash");
    setBool("preferDownloadUnknownBinary", "preferDownloadUnknownBinary");
    setBool("notifyStorage80", "notifyStorage80");
    setBool("notifyStorage95", "notifyStorage95");
    setBool("notifyUploadFailures", "notifyUploadFailures");
    setBool("notifyShareExpiringSoon", "notifyShareExpiringSoon");
    setBool("notifyArtifactPublished", "notifyArtifactPublished");
    setBool("notifyBulkDeletePurge", "notifyBulkDeletePurge");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid settings payload." };
  }

  return { ok: true, patch };
}

export async function getCavCloudSettings(args: {
  accountId: string;
  userId: string;
}): Promise<CavCloudSettings> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!accountId || !userId) return { ...DEFAULT_CAVCLOUD_SETTINGS };

  const row = await ensureSettingsRow(accountId, userId);
  const settings = normalizeSettingsRow(row as Partial<Record<string, unknown>> | null);

  const [lastFolderPath, pinnedFolderPath] = await Promise.all([
    resolveFolderPathById(accountId, settings.lastFolderId),
    resolveFolderPathById(accountId, settings.pinnedFolderId),
  ]);

  settings.lastFolderPath = lastFolderPath;
  settings.pinnedFolderPath = pinnedFolderPath;
  if (!lastFolderPath) settings.lastFolderId = null;
  if (!pinnedFolderPath) settings.pinnedFolderId = null;
  return settings;
}

export async function updateCavCloudSettings(args: {
  accountId: string;
  userId: string;
  patch: PatchInput;
}): Promise<CavCloudSettings> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!accountId || !userId) return { ...DEFAULT_CAVCLOUD_SETTINGS };

  const patch = args.patch || {};
  const row = await ensureSettingsRow(accountId, userId);
  if (!row) {
    const normalized = normalizeSettingsRow(patch as Record<string, unknown>);
    return {
      ...DEFAULT_CAVCLOUD_SETTINGS,
      ...normalized,
    };
  }

  const next = await prisma.cavCloudSettings.update({
    where: { id: row.id },
    data: patch,
  });
  return getCavCloudSettings({ accountId, userId: String(next.userId || userId) });
}

export async function rememberCavCloudLastFolder(args: {
  accountId: string;
  userId: string | null | undefined;
  folderId: string | null | undefined;
}) {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const folderId = String(args.folderId || "").trim();
  if (!accountId || !userId || !folderId) return;
  const canPersist = await hasSettingsMembership(accountId, userId);
  if (!canPersist) return;
  try {
    await prisma.cavCloudSettings.upsert({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      create: {
        accountId,
        userId,
        lastFolderId: folderId,
      },
      update: {
        lastFolderId: folderId,
      },
    });
  } catch (err) {
    if (isMissingSettingsTableError(err)) return;
    if (isSettingsForeignKeyViolationError(err)) return;
    throw err;
  }
}

export function toCavCloudListingPreferences(settings: CavCloudSettings): CavCloudListingPreferences {
  return {
    defaultView: settings.defaultView,
    defaultSort: settings.defaultSort,
    foldersFirst: settings.foldersFirst,
    showDotfiles: settings.showDotfiles,
    showExtensions: settings.showExtensions,
  };
}
