import "server-only";

import type pg from "pg";
import { getAuthPool, newDbId, withAuthTransaction } from "@/lib/authDb";
import { formatDayKey } from "@/lib/status/time";
import { auditLogWrite } from "@/lib/audit";
import { EMBED_RATE_LIMIT_LABEL } from "@/lib/security/embedRateLimit";

export type EmbedUsagePayload = {
  verifiedToday: number | null;
  deniedToday: number | null;
  rateLimit: string | null;
  topDeniedOrigins: string[] | null;
};

export const DEFAULT_EMBED_RATE_LIMIT_LABEL = EMBED_RATE_LIMIT_LABEL;

const DENY_AUDIT_INTERVAL_MS = 60 * 60 * 1000;

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<pg.QueryResult<T>>;
};

type MetricParams = {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  keyId: string;
  allowed: boolean;
};

type DeniedOriginParams = {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  keyId: string;
  origin: string;
  request?: Request | null;
  denyCode?: string;
  rateLimited?: boolean;
};

type RawDeniedOriginRow = {
  auditLoggedAt: Date | string | null;
};

type RawMetricSumRow = {
  verified: number | string | null;
  denied: number | string | null;
};

type RawDeniedOriginListRow = {
  origin: string | null;
};

function asInt(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = []
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function recordEmbedMetric(params: MetricParams) {
  if (!params.accountId || !params.siteId) return;
  try {
    const dayKey = formatDayKey(new Date());
    await getAuthPool().query(
      `INSERT INTO "EmbedVerificationMetric" (
         "id",
         "accountId",
         "projectId",
         "siteId",
         "keyId",
         "dayKey",
         "verified",
         "denied",
         "createdAt",
         "updatedAt"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7,
         $8,
         NOW(),
         NOW()
       )
       ON CONFLICT ("projectId", "siteId", "keyId", "dayKey") DO UPDATE
       SET "verified" = "EmbedVerificationMetric"."verified" + EXCLUDED."verified",
           "denied" = "EmbedVerificationMetric"."denied" + EXCLUDED."denied",
           "updatedAt" = NOW()`,
      [
        newDbId(),
        params.accountId,
        params.projectId,
        params.siteId,
        params.keyId,
        dayKey,
        params.allowed ? 1 : 0,
        params.allowed ? 0 : 1,
      ]
    );
  } catch (error) {
    console.error("[embedMetrics] record failed", error);
  }
}

async function upsertDeniedOrigin(
  queryable: Queryable,
  params: Omit<DeniedOriginParams, "siteId"> & { siteId: string },
  dayKey: string
) {
  return queryOne<RawDeniedOriginRow>(
    queryable,
    `INSERT INTO "EmbedDeniedOrigin" (
       "id",
       "accountId",
       "projectId",
       "siteId",
       "keyId",
       "dayKey",
       "origin",
       "attempts",
       "lastDeniedAt",
       "createdAt",
       "updatedAt"
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       1,
       NOW(),
       NOW(),
       NOW()
     )
     ON CONFLICT ("projectId", "siteId", "keyId", "dayKey", "origin") DO UPDATE
     SET "attempts" = "EmbedDeniedOrigin"."attempts" + 1,
         "lastDeniedAt" = NOW(),
         "updatedAt" = NOW()
     RETURNING "auditLoggedAt"`,
    [
      newDbId(),
      params.accountId,
      params.projectId,
      params.siteId,
      params.keyId,
      dayKey,
      params.origin,
    ]
  );
}

export async function trackDeniedOrigin(params: DeniedOriginParams) {
  if (!params.accountId || !params.siteId) return;
  try {
    const dayKey = formatDayKey(new Date());

    await withAuthTransaction(async (tx) => {
      const row = await upsertDeniedOrigin(tx, { ...params, siteId: params.siteId! }, dayKey);
      const lastAudit = row?.auditLoggedAt ? asDate(row.auditLoggedAt)?.getTime() ?? 0 : 0;
      const interval = Date.now() - lastAudit;
      const shouldAudit = !row?.auditLoggedAt || interval > DENY_AUDIT_INTERVAL_MS;

      if (!shouldAudit) return;

      await auditLogWrite({
        request: params.request ?? null,
        accountId: params.accountId,
        action: params.rateLimited ? "KEY_RATE_LIMITED" : "KEY_DENIED_ORIGIN",
        category: "keys",
        severity: "warning",
        targetType: "apiKey",
        targetId: params.keyId,
        targetLabel: `•••• ${params.keyId.slice(-4)}`,
        metaJson: {
          origin: params.origin,
          denyCode: params.denyCode,
          keyLast4: params.keyId.slice(-4),
        },
      });

      await tx.query(
        `UPDATE "EmbedDeniedOrigin"
         SET "auditLoggedAt" = NOW(),
             "updatedAt" = NOW()
         WHERE "projectId" = $1
           AND "siteId" = $2
           AND "keyId" = $3
           AND "dayKey" = $4
           AND "origin" = $5`,
        [params.projectId, params.siteId, params.keyId, dayKey, params.origin]
      );
    });
  } catch (error) {
    console.error("[embedMetrics] denied-origin tracking failed", error);
  }
}

export async function fetchEmbedUsage(options: {
  accountId: string;
  projectId: number;
  siteId?: string | null;
  rateLimitLabel?: string;
}): Promise<EmbedUsagePayload> {
  const dayKey = formatDayKey(new Date());
  const metricValues: unknown[] = [options.accountId, options.projectId, dayKey];
  const originValues: unknown[] = [options.accountId, options.projectId, dayKey];

  let siteClause = "";
  if (options.siteId) {
    metricValues.push(options.siteId);
    originValues.push(options.siteId);
    siteClause = ` AND "siteId" = $4`;
  }

  const metrics = await queryOne<RawMetricSumRow>(
    getAuthPool(),
    `SELECT
       COALESCE(SUM("verified"), 0)::int AS "verified",
       COALESCE(SUM("denied"), 0)::int AS "denied"
     FROM "EmbedVerificationMetric"
     WHERE "accountId" = $1
       AND "projectId" = $2
       AND "dayKey" = $3${siteClause}`,
    metricValues
  );

  const topOrigins = await getAuthPool().query<RawDeniedOriginListRow>(
    `SELECT "origin"
     FROM "EmbedDeniedOrigin"
     WHERE "accountId" = $1
       AND "projectId" = $2
       AND "dayKey" = $3${siteClause}
     ORDER BY "attempts" DESC, "lastDeniedAt" DESC
     LIMIT 5`,
    originValues
  );

  const verified = asInt(metrics?.verified);
  const denied = asInt(metrics?.denied);

  return {
    verifiedToday: verified || null,
    deniedToday: denied || null,
    rateLimit: options.rateLimitLabel ?? DEFAULT_EMBED_RATE_LIMIT_LABEL,
    topDeniedOrigins: topOrigins.rows.length
      ? topOrigins.rows.map((row) => String(row.origin || "").trim()).filter(Boolean)
      : null,
  };
}
