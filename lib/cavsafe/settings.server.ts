import "server-only";

import type { PublicArtifactVisibility } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const THEME_ACCENTS = ["lime", "violet", "blue", "white", "clear"] as const;
const TRASH_RETENTION_DAYS = [7, 14, 30] as const;
const EVIDENCE_VISIBILITY = ["LINK_ONLY", "PRIVATE"] as const;
const EVIDENCE_EXPIRY_DAYS = [0, 1, 7, 30] as const;
const AUDIT_RETENTION_DAYS = [7, 14, 30, 90] as const;
const TIMELOCK_PRESETS = ["none", "24h", "7d", "30d"] as const;

export type CavSafeThemeAccent = (typeof THEME_ACCENTS)[number];
export type CavSafeEvidenceVisibility = (typeof EVIDENCE_VISIBILITY)[number];
export type CavSafeTimeLockPreset = (typeof TIMELOCK_PRESETS)[number];

export type CavSafeSettings = {
  themeAccent: CavSafeThemeAccent;

  trashRetentionDays: 7 | 14 | 30;
  autoPurgeTrash: boolean;
  preferDownloadUnknownBinary: boolean;

  defaultIntegrityLockOnUpload: boolean;
  defaultEvidenceVisibility: CavSafeEvidenceVisibility;
  defaultEvidenceExpiryDays: 0 | 1 | 7 | 30;
  auditRetentionDays: 7 | 14 | 30 | 90;
  enableAuditExport: boolean;
  timelockDefaultPreset: CavSafeTimeLockPreset;

  notifySafeStorage80: boolean;
  notifySafeStorage95: boolean;
  notifySafeUploadFailures: boolean;
  notifySafeMoveFailures: boolean;
  notifySafeEvidencePublished: boolean;
  notifySafeSnapshotCreated: boolean;
  notifySafeTimeLockEvents: boolean;
};

export type CavSafeEnforcedPolicySummary = {
  ownerOnlyAccess: {
    title: string;
    body: string;
  };
  sharingDisabled: {
    title: string;
    body: string;
  };
  publishInsteadOfShare: {
    title: string;
    body: string;
  };
};

export const CAVSAFE_ENFORCED_POLICY_SUMMARY: CavSafeEnforcedPolicySummary = {
  ownerOnlyAccess: {
    title: "Owner-only access (enforced)",
    body: "Access is restricted to the CavBot Account Owner.",
  },
  sharingDisabled: {
    title: "Sharing disabled in CavSafe (enforced)",
    body: "Share links are disabled in CavSafe.",
  },
  publishInsteadOfShare: {
    title: "Publish instead of share",
    body: "Use Publish to generate controlled evidence artifacts.",
  },
};

export const DEFAULT_CAVSAFE_SETTINGS: CavSafeSettings = {
  themeAccent: "lime",

  trashRetentionDays: 30,
  autoPurgeTrash: true,
  preferDownloadUnknownBinary: true,

  defaultIntegrityLockOnUpload: false,
  defaultEvidenceVisibility: "LINK_ONLY",
  defaultEvidenceExpiryDays: 0,
  auditRetentionDays: 30,
  enableAuditExport: true,
  timelockDefaultPreset: "none",

  notifySafeStorage80: true,
  notifySafeStorage95: true,
  notifySafeUploadFailures: true,
  notifySafeMoveFailures: true,
  notifySafeEvidencePublished: false,
  notifySafeSnapshotCreated: false,
  notifySafeTimeLockEvents: false,
};

export const PREMIUM_PLUS_CAVSAFE_SETTINGS_KEYS: ReadonlySet<keyof CavSafeSettings> = new Set([
  "defaultIntegrityLockOnUpload",
  "defaultEvidenceVisibility",
  "defaultEvidenceExpiryDays",
  "auditRetentionDays",
  "enableAuditExport",
  "timelockDefaultPreset",
  "notifySafeSnapshotCreated",
  "notifySafeTimeLockEvents",
]);

type PatchInput = Partial<CavSafeSettings>;

function pickEnum<T extends readonly string[]>(raw: unknown, allowed: T, fallback: T[number]): T[number] {
  const value = String(raw ?? "").trim();
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

function pickInt<T extends readonly number[]>(raw: unknown, allowed: T, fallback: T[number]): T[number] {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.trunc(n);
  return (allowed as readonly number[]).includes(int) ? (int as T[number]) : fallback;
}

function pickBool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function normalizeSettingsRow(row: Partial<Record<string, unknown>> | null | undefined): CavSafeSettings {
  const safe = row || {};
  return {
    themeAccent: pickEnum(safe.themeAccent, THEME_ACCENTS, DEFAULT_CAVSAFE_SETTINGS.themeAccent),

    trashRetentionDays: pickInt(
      safe.trashRetentionDays,
      TRASH_RETENTION_DAYS,
      DEFAULT_CAVSAFE_SETTINGS.trashRetentionDays,
    ),
    autoPurgeTrash: pickBool(safe.autoPurgeTrash, DEFAULT_CAVSAFE_SETTINGS.autoPurgeTrash),
    preferDownloadUnknownBinary: pickBool(
      safe.preferDownloadUnknownBinary,
      DEFAULT_CAVSAFE_SETTINGS.preferDownloadUnknownBinary,
    ),

    defaultIntegrityLockOnUpload: pickBool(
      safe.defaultIntegrityLockOnUpload,
      DEFAULT_CAVSAFE_SETTINGS.defaultIntegrityLockOnUpload,
    ),
    defaultEvidenceVisibility: pickEnum(
      safe.defaultEvidenceVisibility,
      EVIDENCE_VISIBILITY,
      DEFAULT_CAVSAFE_SETTINGS.defaultEvidenceVisibility,
    ),
    defaultEvidenceExpiryDays: pickInt(
      safe.defaultEvidenceExpiryDays,
      EVIDENCE_EXPIRY_DAYS,
      DEFAULT_CAVSAFE_SETTINGS.defaultEvidenceExpiryDays,
    ),
    auditRetentionDays: pickInt(
      safe.auditRetentionDays,
      AUDIT_RETENTION_DAYS,
      DEFAULT_CAVSAFE_SETTINGS.auditRetentionDays,
    ),
    enableAuditExport: pickBool(safe.enableAuditExport, DEFAULT_CAVSAFE_SETTINGS.enableAuditExport),
    timelockDefaultPreset: pickEnum(
      safe.timelockDefaultPreset,
      TIMELOCK_PRESETS,
      DEFAULT_CAVSAFE_SETTINGS.timelockDefaultPreset,
    ),

    notifySafeStorage80: pickBool(safe.notifySafeStorage80, DEFAULT_CAVSAFE_SETTINGS.notifySafeStorage80),
    notifySafeStorage95: pickBool(safe.notifySafeStorage95, DEFAULT_CAVSAFE_SETTINGS.notifySafeStorage95),
    notifySafeUploadFailures: pickBool(
      safe.notifySafeUploadFailures,
      DEFAULT_CAVSAFE_SETTINGS.notifySafeUploadFailures,
    ),
    notifySafeMoveFailures: pickBool(
      safe.notifySafeMoveFailures,
      DEFAULT_CAVSAFE_SETTINGS.notifySafeMoveFailures,
    ),
    notifySafeEvidencePublished: pickBool(
      safe.notifySafeEvidencePublished,
      DEFAULT_CAVSAFE_SETTINGS.notifySafeEvidencePublished,
    ),
    notifySafeSnapshotCreated: pickBool(
      safe.notifySafeSnapshotCreated,
      DEFAULT_CAVSAFE_SETTINGS.notifySafeSnapshotCreated,
    ),
    notifySafeTimeLockEvents: pickBool(
      safe.notifySafeTimeLockEvents,
      DEFAULT_CAVSAFE_SETTINGS.notifySafeTimeLockEvents,
    ),
  };
}

function isMissingSettingsTableError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  const message = String(
    (err as { meta?: { message?: unknown }; message?: unknown })?.meta?.message
      || (err as { message?: unknown })?.message
      || "",
  ).toLowerCase();
  return code === "P2021" || (message.includes("cavsafesettings") && message.includes("does not exist"));
}

async function ensureSettingsRow(accountId: string, userId: string) {
  const where = {
    accountId_userId: {
      accountId,
      userId,
    },
  } as const;

  try {
    const existing = await prisma.cavSafeSettings.findUnique({ where });
    if (existing) return existing;

    await prisma.cavSafeSettings.createMany({
      data: [{ accountId, userId }],
      skipDuplicates: true,
    });

    return await prisma.cavSafeSettings.findUnique({ where });
  } catch (err) {
    if (isMissingSettingsTableError(err)) return null;
    throw err;
  }
}

export function parseCavSafeSettingsPatch(
  input: unknown,
): { ok: true; patch: PatchInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid JSON payload." };
  }

  const body = input as Record<string, unknown>;
  const patch: PatchInput = {};

  const setEnum = <T extends readonly string[]>(key: keyof PatchInput, allowed: T, label: string) => {
    if (!(key in body)) return;
    const value = String(body[key as string] ?? "").trim();
    if (!(allowed as readonly string[]).includes(value)) throw new Error(`${label} is invalid.`);
    (patch as Record<string, unknown>)[key as string] = value;
  };

  const setBool = (key: keyof PatchInput, label: string) => {
    if (!(key in body)) return;
    if (typeof body[key as string] !== "boolean") throw new Error(`${label} must be boolean.`);
    (patch as Record<string, unknown>)[key as string] = body[key as string];
  };

  const setInt = <T extends readonly number[]>(key: keyof PatchInput, allowed: T, label: string) => {
    if (!(key in body)) return;
    const raw = Number(body[key as string]);
    const value = Number.isFinite(raw) ? Math.trunc(raw) : NaN;
    if (!(allowed as readonly number[]).includes(value)) throw new Error(`${label} is invalid.`);
    (patch as Record<string, unknown>)[key as string] = value;
  };

  try {
    setEnum("themeAccent", THEME_ACCENTS, "themeAccent");

    setInt("trashRetentionDays", TRASH_RETENTION_DAYS, "trashRetentionDays");
    setBool("autoPurgeTrash", "autoPurgeTrash");
    setBool("preferDownloadUnknownBinary", "preferDownloadUnknownBinary");

    setBool("defaultIntegrityLockOnUpload", "defaultIntegrityLockOnUpload");
    setEnum("defaultEvidenceVisibility", EVIDENCE_VISIBILITY, "defaultEvidenceVisibility");
    setInt("defaultEvidenceExpiryDays", EVIDENCE_EXPIRY_DAYS, "defaultEvidenceExpiryDays");
    setInt("auditRetentionDays", AUDIT_RETENTION_DAYS, "auditRetentionDays");
    setBool("enableAuditExport", "enableAuditExport");
    setEnum("timelockDefaultPreset", TIMELOCK_PRESETS, "timelockDefaultPreset");

    setBool("notifySafeStorage80", "notifySafeStorage80");
    setBool("notifySafeStorage95", "notifySafeStorage95");
    setBool("notifySafeUploadFailures", "notifySafeUploadFailures");
    setBool("notifySafeMoveFailures", "notifySafeMoveFailures");
    setBool("notifySafeEvidencePublished", "notifySafeEvidencePublished");
    setBool("notifySafeSnapshotCreated", "notifySafeSnapshotCreated");
    setBool("notifySafeTimeLockEvents", "notifySafeTimeLockEvents");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid settings payload." };
  }

  return { ok: true, patch };
}

export function patchContainsPremiumPlusOnlyField(patch: PatchInput): boolean {
  return Object.keys(patch).some((key) => PREMIUM_PLUS_CAVSAFE_SETTINGS_KEYS.has(key as keyof CavSafeSettings));
}

export function sanitizeForTier(settings: CavSafeSettings, premiumPlus: boolean): CavSafeSettings {
  if (premiumPlus) return settings;
  return {
    ...settings,
    defaultIntegrityLockOnUpload: DEFAULT_CAVSAFE_SETTINGS.defaultIntegrityLockOnUpload,
    defaultEvidenceVisibility: DEFAULT_CAVSAFE_SETTINGS.defaultEvidenceVisibility,
    defaultEvidenceExpiryDays: DEFAULT_CAVSAFE_SETTINGS.defaultEvidenceExpiryDays,
    auditRetentionDays: DEFAULT_CAVSAFE_SETTINGS.auditRetentionDays,
    enableAuditExport: DEFAULT_CAVSAFE_SETTINGS.enableAuditExport,
    timelockDefaultPreset: DEFAULT_CAVSAFE_SETTINGS.timelockDefaultPreset,
    notifySafeSnapshotCreated: DEFAULT_CAVSAFE_SETTINGS.notifySafeSnapshotCreated,
    notifySafeTimeLockEvents: DEFAULT_CAVSAFE_SETTINGS.notifySafeTimeLockEvents,
  };
}

export async function getCavSafeSettings(args: {
  accountId: string;
  userId: string;
  premiumPlus?: boolean;
}): Promise<CavSafeSettings> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const premiumPlus = args.premiumPlus === true;
  if (!accountId || !userId) return sanitizeForTier({ ...DEFAULT_CAVSAFE_SETTINGS }, premiumPlus);

  const row = await ensureSettingsRow(accountId, userId);
  const settings = normalizeSettingsRow(row as Partial<Record<string, unknown>> | null);
  return sanitizeForTier(settings, premiumPlus);
}

export async function updateCavSafeSettings(args: {
  accountId: string;
  userId: string;
  patch: PatchInput;
  premiumPlus?: boolean;
}): Promise<CavSafeSettings> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const premiumPlus = args.premiumPlus === true;
  if (!accountId || !userId) return sanitizeForTier({ ...DEFAULT_CAVSAFE_SETTINGS }, premiumPlus);

  const patch = args.patch || {};
  const row = await ensureSettingsRow(accountId, userId);
  if (!row) {
    const normalized = normalizeSettingsRow(patch as Record<string, unknown>);
    return sanitizeForTier(
      {
        ...DEFAULT_CAVSAFE_SETTINGS,
        ...normalized,
      },
      premiumPlus,
    );
  }

  const next = await prisma.cavSafeSettings.update({
    where: { id: row.id },
    data: patch,
  });

  return getCavSafeSettings({
    accountId,
    userId: String(next.userId || userId),
    premiumPlus,
  });
}

export async function resolveCavSafeRetentionPolicy(args: {
  accountId: string;
  userId: string | null | undefined;
}): Promise<Pick<CavSafeSettings, "trashRetentionDays" | "autoPurgeTrash">> {
  const settings = await getCavSafeSettings({
    accountId: args.accountId,
    userId: String(args.userId || ""),
    premiumPlus: true,
  });
  return {
    trashRetentionDays: settings.trashRetentionDays,
    autoPurgeTrash: settings.autoPurgeTrash,
  };
}

export async function resolveCavSafeDownloadPreference(args: {
  accountId: string;
  userId: string | null | undefined;
}): Promise<boolean> {
  const settings = await getCavSafeSettings({
    accountId: args.accountId,
    userId: String(args.userId || ""),
    premiumPlus: true,
  });
  return settings.preferDownloadUnknownBinary;
}

export async function resolveCavSafeEvidenceDefaults(args: {
  accountId: string;
  userId: string;
  premiumPlus: boolean;
}): Promise<{
  visibility: PublicArtifactVisibility;
  expiresInDays: 0 | 1 | 7 | 30;
}> {
  const settings = await getCavSafeSettings({
    accountId: args.accountId,
    userId: args.userId,
    premiumPlus: args.premiumPlus,
  });
  return {
    visibility: settings.defaultEvidenceVisibility,
    expiresInDays: settings.defaultEvidenceExpiryDays,
  };
}
