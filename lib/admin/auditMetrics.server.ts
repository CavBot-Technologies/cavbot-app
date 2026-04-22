import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type AdminAuditMetricsArgs = {
  start: Date;
  end: Date;
  q?: string;
  action?: string;
  severity?: string;
};

export type AdminAuditMetrics = {
  auditRows: number;
  destructive: number;
  warnings: number;
  info: number;
  uniqueActors: number;
  uniqueSessions: number;
  uniqueIps: number;
  actionTypes: number;
  entitiesTouched: number;
  changedRecords: number;
  crossIpSessions: number;
  repeatDestructiveActors: number;
};

function escapeLikePattern(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildAuditMetricsWhereSql(args: AdminAuditMetricsArgs) {
  let whereSql = Prisma.sql`
    "createdAt" >= ${args.start}
    AND "createdAt" < ${args.end}
  `;

  if (args.q) {
    const likePattern = `%${escapeLikePattern(args.q)}%`;
    whereSql = Prisma.sql`
      ${whereSql}
      AND (
        "action" ILIKE ${likePattern} ESCAPE '\\'
        OR "actionLabel" ILIKE ${likePattern} ESCAPE '\\'
        OR "entityType" ILIKE ${likePattern} ESCAPE '\\'
        OR COALESCE("entityLabel", '') ILIKE ${likePattern} ESCAPE '\\'
      )
    `;
  }

  if (args.action) {
    whereSql = Prisma.sql`
      ${whereSql}
      AND "action" = ${args.action}
    `;
  }

  if (args.severity === "info" || args.severity === "warning" || args.severity === "destructive") {
    whereSql = Prisma.sql`
      ${whereSql}
      AND "severity" = CAST(${args.severity} AS "AuditSeverity")
    `;
  }

  return whereSql;
}

export async function readAdminAuditMetrics(args: AdminAuditMetricsArgs): Promise<AdminAuditMetrics> {
  const whereSql = buildAuditMetricsWhereSql(args);
  const rows = await prisma.$queryRaw<Array<AdminAuditMetrics>>(Prisma.sql`
    WITH filtered AS (
      SELECT *
      FROM "AdminAuditLog"
      WHERE ${whereSql}
    )
    SELECT
      COUNT(*)::int AS "auditRows",
      COUNT(*) FILTER (WHERE "severity" = 'destructive')::int AS "destructive",
      COUNT(*) FILTER (WHERE "severity" = 'warning')::int AS "warnings",
      COUNT(*) FILTER (WHERE "severity" = 'info')::int AS "info",
      COUNT(
        DISTINCT CASE
          WHEN NULLIF(BTRIM(COALESCE("actorStaffId", '')), '') IS NULL
            AND NULLIF(BTRIM(COALESCE("actorUserId", '')), '') IS NULL
            THEN 'system'
          ELSE COALESCE(NULLIF(BTRIM("actorStaffId"), ''), '')
            || '|'
            || COALESCE(NULLIF(BTRIM("actorUserId"), ''), '')
        END
      )::int AS "uniqueActors",
      COUNT(DISTINCT NULLIF(BTRIM(COALESCE("sessionKey", '')), ''))::int AS "uniqueSessions",
      COUNT(DISTINCT NULLIF(BTRIM(COALESCE("ip", '')), ''))::int AS "uniqueIps",
      COUNT(DISTINCT "action")::int AS "actionTypes",
      COUNT(
        DISTINCT COALESCE("entityType", '')
          || '|'
          || COALESCE(NULLIF(BTRIM(COALESCE("entityId", '')), ''), '')
      )::int AS "entitiesTouched",
      COUNT(
        * 
      ) FILTER (
        WHERE (
          "beforeJson" IS NOT NULL
          AND "beforeJson"::text <> 'null'
        ) OR (
          "afterJson" IS NOT NULL
          AND "afterJson"::text <> 'null'
        )
      )::int AS "changedRecords",
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT "sessionKey"
          FROM filtered
          WHERE NULLIF(BTRIM(COALESCE("sessionKey", '')), '') IS NOT NULL
            AND NULLIF(BTRIM(COALESCE("ip", '')), '') IS NOT NULL
          GROUP BY "sessionKey"
          HAVING COUNT(DISTINCT "ip") > 1
        ) AS cross_ip_sessions
      ) AS "crossIpSessions",
      (
        SELECT COUNT(*)::int
        FROM (
          SELECT
            CASE
              WHEN NULLIF(BTRIM(COALESCE("actorStaffId", '')), '') IS NULL
                AND NULLIF(BTRIM(COALESCE("actorUserId", '')), '') IS NULL
                THEN 'system'
              ELSE COALESCE(NULLIF(BTRIM("actorStaffId"), ''), '')
                || '|'
                || COALESCE(NULLIF(BTRIM("actorUserId"), ''), '')
            END AS actor_key
          FROM filtered
          WHERE "severity" = 'destructive'
          GROUP BY 1
          HAVING COUNT(*) >= 2
        ) AS repeat_destructive_actors
      ) AS "repeatDestructiveActors"
    FROM filtered
  `);

  return (
    rows[0] || {
      auditRows: 0,
      destructive: 0,
      warnings: 0,
      info: 0,
      uniqueActors: 0,
      uniqueSessions: 0,
      uniqueIps: 0,
      actionTypes: 0,
      entitiesTouched: 0,
      changedRecords: 0,
      crossIpSessions: 0,
      repeatDestructiveActors: 0,
    }
  );
}
