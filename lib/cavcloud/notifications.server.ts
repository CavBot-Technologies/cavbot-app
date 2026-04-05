import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getCavCloudPlanContext } from "@/lib/cavcloud/plan.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import { CAVCLOUD_NOTIFICATION_KINDS } from "@/lib/notificationKinds";

type NotificationTone = "GOOD" | "WATCH" | "BAD";

const SHARE_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SHARE_EXPIRY_SCAN_THROTTLE_MS = 3 * 60 * 1000;

const shareExpiryScanByOperator = new Map<string, number>();

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

function hoursRemaining(expiresAt: Date, now: Date): string {
  const deltaMs = expiresAt.getTime() - now.getTime();
  const hours = Math.max(1, Math.round(deltaMs / (60 * 60 * 1000)));
  return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
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
  meta?: Prisma.JsonObject | null;
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
  const quota = await prisma.cavCloudQuota.findUnique({
    where: { accountId },
    select: { usedBytes: true },
  });

  let usedBytes = BigInt(0);
  if (typeof quota?.usedBytes === "bigint") {
    usedBytes = quota.usedBytes;
  } else {
    const agg = await prisma.cavCloudFile.aggregate({
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

  const plan = await getCavCloudPlanContext(accountId);
  if (plan.limitBytesBigInt == null) {
    return {
      usedBytes,
      limitBytes: null,
      pct: null,
    };
  }

  const limitBytes = plan.limitBytesBigInt;
  return {
    usedBytes,
    limitBytes,
    pct: percentage(usedBytes, limitBytes),
  };
}

export async function notifyCavCloudUploadFailure(args: {
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

  const settings = await getCavCloudSettings({ accountId, userId });
  if (!settings.notifyUploadFailures) return false;

  const fileLabel = truncateText(args.fileName || "", 96);
  const context = truncateText(args.context || "Upload", 80);
  const reason = truncateText(args.errorMessage || "Upload failed after retry handling.", 180);
  const body = fileLabel
    ? `${context}: ${fileLabel}. ${reason}`
    : `${context}: ${reason}`;

  return createNotification({
    userId,
    accountId,
    title: "Upload failed",
    body,
    tone: "BAD",
    href: args.href || "/cavcloud",
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_UPLOAD_FAILED,
    dedupeHours: 1,
    dedupeByBody: true,
  });
}

export async function notifyCavCloudArtifactPublishedState(args: {
  accountId: string;
  userId: string;
  published: boolean;
  artifactLabel?: string | null;
  visibility?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavCloudSettings({ accountId, userId });
  if (!settings.notifyArtifactPublished) return false;

  const title = args.published ? "Artifact published" : "Artifact unpublished";
  const label = truncateText(args.artifactLabel || "Artifact", 120);
  const visibility = s(args.visibility).toUpperCase() || (args.published ? "LINK_ONLY" : "PRIVATE");
  const body = args.published
    ? `${label} is now ${visibility}.`
    : `${label} is now PRIVATE.`;

  return createNotification({
    userId,
    accountId,
    title,
    body,
    tone: args.published ? "GOOD" : "WATCH",
    href: args.href || "/cavcloud",
    kind: args.published
      ? CAVCLOUD_NOTIFICATION_KINDS.CLOUD_ARTIFACT_PUBLISHED
      : CAVCLOUD_NOTIFICATION_KINDS.CLOUD_ARTIFACT_UNPUBLISHED,
    dedupeHours: 2,
    dedupeByBody: true,
  });
}

export async function notifyCavCloudBulkDeletePurge(args: {
  accountId: string;
  userId: string;
  removedFiles?: number;
  removedFolders?: number;
  reason?: string | null;
  href?: string | null;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavCloudSettings({ accountId, userId });
  if (!settings.notifyBulkDeletePurge) return false;

  const removedFiles = Math.max(0, Math.trunc(Number(args.removedFiles || 0)));
  const removedFolders = Math.max(0, Math.trunc(Number(args.removedFolders || 0)));
  const total = removedFiles + removedFolders;
  const reason = s(args.reason) || "manual";
  const isLifecyclePurge = reason === "lifecycle_purge";
  if (!isLifecyclePurge && total <= 1) return false;

  const parts: string[] = [];
  if (removedFiles > 0) parts.push(`${removedFiles} file${removedFiles === 1 ? "" : "s"}`);
  if (removedFolders > 0) parts.push(`${removedFolders} folder${removedFolders === 1 ? "" : "s"}`);
  const summary = parts.length ? parts.join(" and ") : "items";

  const title = isLifecyclePurge ? "Trash purge completed" : "Bulk delete activity";
  const body = isLifecyclePurge
    ? `Auto-purge permanently removed ${summary}.`
    : `Permanent delete removed ${summary}.`;

  return createNotification({
    userId,
    accountId,
    title,
    body,
    tone: "WATCH",
    href: args.href || "/cavcloud",
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_PURGE_COMPLETED,
    dedupeHours: 2,
    dedupeByBody: true,
  });
}

export async function notifyCavCloudStorageThresholds(args: {
  accountId: string;
  userId: string;
}): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  const settings = await getCavCloudSettings({ accountId, userId });
  if (!settings.notifyStorage80 && !settings.notifyStorage95) return false;

  const snapshot = await resolveStorageSnapshot(accountId);
  if (!snapshot.limitBytes || snapshot.pct == null || snapshot.pct < 80) return false;

  const pct = snapshot.pct;
  const body = `CavCloud is at ${pct}% of storage (${formatBytes(snapshot.usedBytes)} / ${formatBytes(snapshot.limitBytes)}).`;

  if (pct >= 95 && settings.notifyStorage95) {
    return createNotification({
      userId,
      accountId,
      title: "Storage 95% threshold reached",
      body,
      tone: "BAD",
      href: "/cavcloud",
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_STORAGE_LOW_95,
      meta: {
        threshold: 95,
        pct,
      },
      dedupeHours: 6,
    });
  }

  if (settings.notifyStorage80) {
    return createNotification({
      userId,
      accountId,
      title: "Storage 80% threshold reached",
      body,
      tone: "WATCH",
      href: "/cavcloud",
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_STORAGE_LOW_80,
      meta: {
        threshold: 80,
        pct,
      },
      dedupeHours: 6,
    });
  }

  return false;
}

export async function ensureCavCloudShareExpirySoonNotifications(args: {
  accountId: string;
  userId: string;
}): Promise<number> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return 0;

  const operatorKey = `${accountId}:${userId}`;
  const nowMs = Date.now();
  const lastScannedAt = shareExpiryScanByOperator.get(operatorKey) || 0;
  if (nowMs - lastScannedAt < SHARE_EXPIRY_SCAN_THROTTLE_MS) return 0;
  shareExpiryScanByOperator.set(operatorKey, nowMs);

  if (!(await isInAppEnabled(userId, accountId))) return 0;
  const settings = await getCavCloudSettings({ accountId, userId });
  if (!settings.notifyShareExpiringSoon) return 0;

  const now = new Date(nowMs);
  const windowEnd = new Date(nowMs + SHARE_EXPIRY_WINDOW_MS);
  const title = "Share link expiring soon";

  const [artifactShares, storageShares, existing] = await Promise.all([
    prisma.cavCloudShare.findMany({
      where: {
        accountId,
        createdByUserId: userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
          lte: windowEnd,
        },
      },
      orderBy: { expiresAt: "asc" },
      select: {
        id: true,
        expiresAt: true,
        artifact: {
          select: {
            displayTitle: true,
            sourcePath: true,
          },
        },
      },
      take: 20,
    }),
    prisma.cavCloudStorageShare.findMany({
      where: {
        accountId,
        createdByUserId: userId,
        revokedAt: null,
        expiresAt: {
          gt: now,
          lte: windowEnd,
        },
      },
      orderBy: { expiresAt: "asc" },
      select: {
        id: true,
        expiresAt: true,
        file: {
          select: {
            name: true,
            path: true,
          },
        },
        folder: {
          select: {
            name: true,
            path: true,
          },
        },
      },
      take: 20,
    }),
    prisma.notification.findMany({
      where: {
        userId,
        accountId,
        title,
        createdAt: {
          gt: new Date(nowMs - 22 * 60 * 60 * 1000),
        },
      },
      select: {
        href: true,
      },
    }),
  ]);

  const existingHrefs = new Set(existing.map((row) => s(row.href)).filter(Boolean));
  let sent = 0;

  for (const share of artifactShares) {
    const href = `/share/${share.id}`;
    if (!href || existingHrefs.has(href)) continue;

    const label = truncateText(share.artifact?.displayTitle || share.artifact?.sourcePath || "Shared item", 120);
    const body = `${label} expires ${hoursRemaining(share.expiresAt, now)}.`;
    const created = await createNotification({
      userId,
      accountId,
      title,
      body,
      tone: "WATCH",
      href,
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_SHARE_EXPIRING_SOON,
      dedupeHours: 22,
      dedupeByHref: true,
    });
    if (created) {
      existingHrefs.add(href);
      sent += 1;
      if (sent >= 8) return sent;
    }
  }

  for (const share of storageShares) {
    const href = `/cavcloud/share/${share.id}`;
    if (!href || existingHrefs.has(href)) continue;

    const label = truncateText(
      share.file?.name || share.folder?.name || share.file?.path || share.folder?.path || "Shared item",
      120,
    );
    const body = `${label} expires ${hoursRemaining(share.expiresAt, now)}.`;
    const created = await createNotification({
      userId,
      accountId,
      title,
      body,
      tone: "WATCH",
      href,
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_SHARE_EXPIRING_SOON,
      dedupeHours: 22,
      dedupeByHref: true,
    });
    if (created) {
      existingHrefs.add(href);
      sent += 1;
      if (sent >= 8) return sent;
    }
  }

  return sent;
}

type CavCloudCollabSignalArgs = {
  accountId: string;
  userId: string;
  kind: string;
  title: string;
  body?: string | null;
  href?: string | null;
  tone?: NotificationTone;
  meta?: Prisma.JsonObject | null;
  dedupeHours?: number;
};

export async function notifyCavCloudCollabSignal(args: CavCloudCollabSignalArgs): Promise<boolean> {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) return false;
  if (!(await isInAppEnabled(userId, accountId))) return false;

  return createNotification({
    userId,
    accountId,
    title: args.title,
    body: args.body || null,
    href: args.href || "/cavcloud",
    tone: args.tone || "WATCH",
    kind: s(args.kind) || CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_REQUEST_CREATED,
    meta: args.meta || null,
    dedupeHours: args.dedupeHours,
    dedupeByBody: true,
  });
}
