import "server-only";

import type pg from "pg";
import { auditLogWrite } from "@/lib/audit";
import { getAuthPool, newDbId } from "@/lib/authDb";

export type SiteDeletionMode = "SAFE" | "DESTRUCTIVE";
export type SitePurgeMode = "delayed" | "immediate";

const DEFAULT_RETENTION_DAYS = 30;

type SiteDeletionRecord = {
  id: string;
  siteId: string;
  projectId: number | string;
  accountId: string;
  operatorUserId: string | null;
  origin: string | null;
  purgeScheduledAt: Date | string | null;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

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

  await getAuthPool().query(
    `DELETE FROM "ScanJob"
     WHERE "projectId" = $1
       AND "siteId" = $2`,
    [projectId, siteId]
  );

  console.info(`[site-deletion] analytics purged (${mode}) for ${siteId}@${projectId} (${origin})`);
}

export async function runSitePurgeJob(limit = 32) {
  const queued = await getAuthPool().query<SiteDeletionRecord>(
    `SELECT
       "id",
       "siteId",
       "projectId",
       "accountId",
       "operatorUserId",
       "origin",
       "purgeScheduledAt"
     FROM "SiteDeletion"
     WHERE "status" = 'SCHEDULED'::"SiteDeletionStatus"
       AND "purgeScheduledAt" <= NOW()
     ORDER BY "purgeScheduledAt" ASC
     LIMIT $1`,
    [limit]
  );

  const purgedSiteIds: string[] = [];

  for (const record of queued.rows) {
    try {
      await purgeSiteAnalytics({
        projectId: Number(record.projectId),
        siteId: String(record.siteId),
        origin: record.origin || "",
        mode: "delayed",
      });

      const purgedAt = new Date();
      await getAuthPool().query(
        `UPDATE "SiteDeletion"
         SET "status" = 'PURGED'::"SiteDeletionStatus",
             "purgedAt" = $2
         WHERE "id" = $1`,
        [String(record.id), purgedAt]
      );

      await auditLogWrite({
        action: "SITE_PURGE_EXECUTED",
        accountId: String(record.accountId),
        operatorUserId: record.operatorUserId || null,
        targetType: "site",
        targetId: String(record.siteId),
        targetLabel: record.origin || String(record.siteId),
        metaJson: {
          mode: "delayed",
          origin: record.origin,
          scheduledAt: toDate(record.purgeScheduledAt)?.toISOString() ?? null,
          purgedAt: purgedAt.toISOString(),
        },
      });

      purgedSiteIds.push(String(record.siteId));
    } catch (error) {
      console.error(`[site-deletion] purge failed for ${record.siteId}@${record.projectId}`, error);
      await getAuthPool()
        .query(
          `UPDATE "SiteDeletion"
           SET "status" = 'FAILED'::"SiteDeletionStatus"
           WHERE "id" = $1`,
          [String(record.id)]
        )
        .catch(() => null);
    }
  }

  return purgedSiteIds;
}
