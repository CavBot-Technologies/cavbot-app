import "server-only";

import type { Prisma, SiteDeletion } from "@prisma/client";
import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export type SiteDeletionMode = "SAFE" | "DESTRUCTIVE";
export type SitePurgeMode = "delayed" | "immediate";

const DEFAULT_RETENTION_DAYS = 30;

export function retentionDate(retentionDays = DEFAULT_RETENTION_DAYS) {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + (Number.isFinite(retentionDays) ? retentionDays : DEFAULT_RETENTION_DAYS));
  return when;
}

export async function purgeSiteAnalytics(opts: {
  projectId: number;
  siteId: string;
  mode: SitePurgeMode;
  origin?: string;
}) {
  const { projectId, siteId, origin = "", mode } = opts;

  await prisma.$transaction([
    prisma.scanJob.deleteMany({ where: { projectId, siteId } }),
    // Future: delete route aggregates / snapshots / caches / object storage blobs here.
  ]);

  console.info(`[site-deletion] analytics purged (${mode}) for ${siteId}@${projectId} (${origin})`);
}

export async function upsertSiteDeletionRecord(opts: {
  tx: Prisma.TransactionClient;
  projectId: number;
  siteId: string;
  accountId: string;
  operatorUserId: string | null;
  mode: SiteDeletionMode;
  origin: string;
  retentionDays?: number | null;
}): Promise<SiteDeletion> {
  const { tx, projectId, siteId, accountId, operatorUserId, mode, origin, retentionDays } = opts;
  const now = new Date();
  const isSafe = mode === "SAFE";
  const purgeDate = isSafe ? retentionDate(retentionDays ?? DEFAULT_RETENTION_DAYS) : now;
  const status = isSafe ? ("SCHEDULED" as const) : ("PURGED" as const);
  const data = {
    mode,
    origin,
    status,
    purgeScheduledAt: purgeDate,
    purgedAt: isSafe ? null : now,
    operatorUserId,
    metaJson: {
      retentionDays: retentionDays ?? DEFAULT_RETENTION_DAYS,
      requestedAt: now.toISOString(),
    },
  };

  const existing = await tx.siteDeletion.findFirst({ where: { siteId } });

  if (existing) {
    return tx.siteDeletion.update({
      where: { id: existing.id },
      data,
    });
  }

  return tx.siteDeletion.create({
    data: {
      ...data,
      siteId,
      projectId,
      accountId,
      retentionDays: retentionDays ?? DEFAULT_RETENTION_DAYS,
    },
  });
}

export async function runSitePurgeJob(limit = 32) {
  const now = new Date();
  const queued = await prisma.siteDeletion.findMany({
    where: { status: "SCHEDULED", purgeScheduledAt: { lte: now } },
    take: limit,
    orderBy: { purgeScheduledAt: "asc" },
  });

  const purgedSiteIds: string[] = [];

  for (const record of queued) {
    try {
      await purgeSiteAnalytics({
        projectId: record.projectId,
        siteId: record.siteId,
        origin: record.origin || "",
        mode: "delayed",
      });

      await prisma.siteDeletion.update({
        where: { id: record.id },
        data: { status: "PURGED", purgedAt: new Date() },
      });

      await auditLogWrite({
        action: "SITE_PURGE_EXECUTED",
        accountId: record.accountId,
        operatorUserId: null,
        targetType: "site",
        targetId: record.siteId,
        targetLabel: record.origin || record.siteId,
        metaJson: {
          mode: "delayed",
          origin: record.origin,
          scheduledAt: record.purgeScheduledAt?.toISOString() ?? null,
          purgedAt: new Date().toISOString(),
        },
      });

      purgedSiteIds.push(record.siteId);
    } catch (error) {
      console.error(`[site-deletion] purge failed for ${record.siteId}@${record.projectId}`, error);
      await prisma.siteDeletion.update({
        where: { id: record.id },
        data: { status: "FAILED" },
      });
    }
  }

  return purgedSiteIds;
}
