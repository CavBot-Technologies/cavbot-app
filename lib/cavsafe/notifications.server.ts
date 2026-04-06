import "server-only";

import type { Prisma } from "@prisma/client";

import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { CAVSAFE_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { cavsafeSecuredStorageLimitBytesForPlan } from "@/lib/cavsafe/policy.server";
import { getCavSafeSettings } from "@/lib/cavsafe/settings.server";
import { prisma } from "@/lib/prisma";

type NotificationTone = "GOOD" | "WATCH" | "BAD";

type JsonMeta = Prisma.JsonObject;

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function truncateText(raw: unknown, max = 220): string {
  const value = s(raw);
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function formatBytes(bytes: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = Number(bytes);
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const rounded = value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[idx]}`;
}

function percentage(usedBytes: bigint, limitBytes: bigint): number {
  if (limitBytes <= BigInt(0)) return 0;
  const raw = (Number(usedBytes) / Number(limitBytes)) * 100;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

async function isInAppEnabled(userId: string, accountId: string): Promise<boolean> {
  try {
    const row = await prisma.notificationSettings.findFirst({
      where: {
        userId,
        accountId,
      },
      select: {
        inAppSignals: true,
      },
    });
    return row?.inAppSignals ?? true;
  } catch {
    return true;
  }
}

async function createNotification(args: {
  userId: string;
  accountId: string;
  title: string;
  body?: string | null;
  href?: string | null;
  tone?: NotificationTone;
  kind: string;
  meta?: JsonMeta | null;
  dedupeHours?: number;
  dedupeByHref?: boolean;
  dedupeByBody?: boolean;
}): Promise<boolean> {
  const userId = s(args.userId);
  const accountId = s(args.accountId);
  const title = truncateText(args.title, 120);
  const body = truncateText(args.body || "", 320) || null;
  const kind = truncateText(args.kind || "GENERIC", 64) || "GENERIC";
  if (!userId || !accountId || !title) return false;

  const dedupeHours = Number(args.dedupeHours || 0);
  if (Number.isFinite(dedupeHours) && dedupeHours > 0) {
    const since = new Date(Date.now() - dedupeHours * 60 * 60 * 1000);
    const where: Prisma.NotificationWhereInput = {
      userId,
      accountId,
      title,
      kind,
      createdAt: { gt: since },
    };
    if (args.dedupeByHref && s(args.href)) {
      where.href = s(args.href);
    }
    if (args.dedupeByBody && body) {
      where.body = body;
    }
    const recent = await prisma.notification.findFirst({
      where,
      select: { id: true },
    });
    if (recent) return false;
  }

  await prisma.notification.create({
    data: {
      userId,
      accountId,
      title,
      body,
      href: s(args.href) || null,
      tone: args.tone || "GOOD",
      kind,
      metaJson: args.meta || undefined,
    },
  });

  return true;
}

async function resolveStorageSnapshot(accountId: string): Promise<{
  usedBytes: bigint;
  limitBytes: bigint | null;
  pct: number | null;
}> {
  const [plan, quota] = await Promise.all([
    getEffectiveAccountPlanContext(accountId).catch(() => null),
    prisma.cavSafeQuota.findUnique({
      where: { accountId },
      select: { usedBytes: true },
    }),
  ]);

  let usedBytes = BigInt(0);
  if (typeof quota?.usedBytes === "bigint") {
    usedBytes = quota.usedBytes;
  } else {
    const agg = await prisma.cavSafeFile.aggregate({
      where: {
        accountId,
        deletedAt: null,
      },
      _sum: {
        bytes: true,
      },
    });
    const raw = agg?._sum?.bytes;
    usedBytes = typeof raw === "bigint" ? raw : BigInt(Number(raw || 0));
  }

  const limitBytes = cavsafeSecuredStorageLimitBytesForPlan(plan?.planId || "free");
  if (limitBytes <= BigInt(0)) {
    return {
      usedBytes,
      limitBytes: null,
      pct: null,
    };
  }

  return {
    usedBytes,
    limitBytes,
    pct: percentage(usedBytes, limitBytes),
  };
}

export async function notifyCavSafeUploadFailure(args: {
  accountId: string;
  userId: string;
  fileName?: string | null;
  context?: string | null;
  errorMessage?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeUploadFailures) return false;

  const fileLabel = truncateText(args.fileName || "", 96);
  const context = truncateText(args.context || "Upload", 80);
  const reason = truncateText(args.errorMessage || "Upload failed after retry handling.", 180);
  const body = fileLabel
    ? `${context}: ${fileLabel}. ${reason}`
    : `${context}: ${reason}`;

  return createNotification({
    userId,
    accountId,
    title: "CavSafe upload failed",
    body,
    tone: "BAD",
    href: args.href || "/cavsafe",
    kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_UPLOAD_FAILED,
    dedupeHours: 1,
    dedupeByBody: true,
  });
}

export async function notifyCavSafeMoveFailure(args: {
  accountId: string;
  userId: string;
  direction?: "in" | "out" | "internal";
  context?: string | null;
  errorMessage?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeMoveFailures) return false;

  const direction = args.direction || "internal";
  const context = truncateText(args.context || (direction === "in" ? "Move into CavSafe" : direction === "out" ? "Move out of CavSafe" : "Move in CavSafe"), 120);
  const reason = truncateText(args.errorMessage || "Move failed.", 180);

  return createNotification({
    userId,
    accountId,
    title: "CavSafe move failed",
    body: `${context}: ${reason}`,
    tone: "BAD",
    href: args.href || "/cavsafe",
    kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_MOVE_FAILED,
    dedupeHours: 1,
    dedupeByBody: true,
  });
}

export async function notifyCavSafeEvidencePublished(args: {
  accountId: string;
  userId: string;
  artifactLabel?: string | null;
  visibility?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeEvidencePublished) return false;

  const label = truncateText(args.artifactLabel || "Evidence artifact", 120);
  const visibility = s(args.visibility).toUpperCase() || "LINK_ONLY";

  return createNotification({
    userId,
    accountId,
    title: "CavSafe evidence published",
    body: `${label} is now ${visibility}.`,
    tone: "GOOD",
    href: args.href || "/cavsafe",
    kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_EVIDENCE_PUBLISHED,
    dedupeHours: 2,
    dedupeByBody: true,
  });
}

export async function notifyCavSafeSnapshotCreated(args: {
  accountId: string;
  userId: string;
  snapshotName?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeSnapshotCreated) return false;

  const label = truncateText(args.snapshotName || "Snapshot", 120);

  return createNotification({
    userId,
    accountId,
    title: "CavSafe snapshot created",
    body: `${label} is ready for download.`,
    tone: "GOOD",
    href: args.href || "/cavsafe",
    kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_SNAPSHOT_CREATED,
    dedupeHours: 2,
    dedupeByBody: true,
  });
}

export async function notifyCavSafeTimeLockEvent(args: {
  accountId: string;
  userId: string;
  title?: string | null;
  body?: string | null;
  href?: string | null;
  tone?: NotificationTone;
  dedupeHours?: number;
  meta?: JsonMeta | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeTimeLockEvents) return false;

  return createNotification({
    userId,
    accountId,
    title: truncateText(args.title || "CavSafe time lock event", 120),
    body: truncateText(args.body || "A CavSafe file reached a time-lock milestone.", 320),
    tone: args.tone || "WATCH",
    href: args.href || "/cavsafe",
    kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_TIMELOCK_EVENT,
    dedupeHours: args.dedupeHours || 4,
    dedupeByBody: true,
    meta: args.meta || null,
  });
}

export async function notifyCavSafeStorageThresholds(args: {
  accountId: string;
  userId: string;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavSafeSettings({ accountId, userId, premiumPlus: true });
  if (!settings.notifySafeStorage80 && !settings.notifySafeStorage95) return false;

  const snapshot = await resolveStorageSnapshot(accountId);
  if (!snapshot.limitBytes || snapshot.pct == null || snapshot.pct < 80) return false;

  const pct = snapshot.pct;
  const body = `CavSafe is at ${pct}% of secured storage (${formatBytes(snapshot.usedBytes)} / ${formatBytes(snapshot.limitBytes)}).`;

  if (pct >= 95 && settings.notifySafeStorage95) {
    return createNotification({
      userId,
      accountId,
      title: "Secured Storage 95% threshold reached",
      body,
      tone: "BAD",
      href: "/cavsafe/settings",
      kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_STORAGE_LOW_95,
      meta: {
        threshold: 95,
        pct,
      },
      dedupeHours: 6,
      dedupeByBody: true,
    });
  }

  if (settings.notifySafeStorage80) {
    return createNotification({
      userId,
      accountId,
      title: "Secured Storage 80% threshold reached",
      body,
      tone: "WATCH",
      href: "/cavsafe/settings",
      kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_STORAGE_LOW_80,
      meta: {
        threshold: 80,
        pct,
      },
      dedupeHours: 6,
      dedupeByBody: true,
    });
  }

  return false;
}
