import "server-only";

import type pg from "pg";
import type { ProjectScanStatus, ScanJobSummary, ScanReport, ScanUsage } from "@/lib/scanner";
import { findAccountById, getAuthPool } from "@/lib/authDb";
import { PLANS, getPlanLimits, resolvePlanIdFromTier } from "@/lib/plans";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawScanUsageCountRow = {
  count: number | string;
};

type RawScanJobRow = {
  id: string;
  status: string;
  reason: string | null;
  createdAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  pagesScanned: number | string | null;
  issuesFound: number | string | null;
  highPriorityCount: number | string | null;
  overallScore: number | string | null;
  resultJson: unknown;
  siteOrigin: string | null;
  siteLabel: string | null;
  diagnosticsReady: boolean | null;
  diagnosticsGeneratedAt: Date | string | null;
  diagnosticsFailureReason: string | null;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = [],
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

function normalizeScanReport(value: unknown): ScanReport | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as ScanReport;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as ScanReport;
  return null;
}

async function getScanUsage(accountId: string): Promise<ScanUsage> {
  const account = await findAccountById(getAuthPool(), accountId);
  const trialEndsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  const trialActive = Boolean(account?.trialSeatActive) && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now();
  const tierEffective = trialActive ? "PREMIUM_PLUS" : String(account?.tier || "FREE").toUpperCase();
  const planId = resolvePlanIdFromTier(tierEffective);
  const limits = getPlanLimits(planId);

  const usedRow = await queryOne<RawScanUsageCountRow>(
    getAuthPool(),
    `SELECT COUNT(*)::int AS "count"
     FROM "ScanJob" job
     INNER JOIN "Project" project ON project."id" = job."projectId"
     WHERE project."accountId" = $1
       AND job."createdAt" >= DATE_TRUNC('month', NOW())`,
    [accountId],
  );

  return {
    planId,
    planLabel: PLANS[planId].tierLabel,
    scansThisMonth: toInt(usedRow?.count),
    scansPerMonth: limits.scansPerMonth,
    pagesPerScan: limits.pagesPerScan,
  };
}

function normalizeScanSummary(row: RawScanJobRow | null | undefined): ScanJobSummary | null {
  if (!row) return null;
  return {
    id: String(row.id),
    status: row.status as ScanJobSummary["status"],
    reason: row.reason == null ? null : String(row.reason),
    createdAt: toDate(row.createdAt) || new Date(0),
    startedAt: toDate(row.startedAt),
    finishedAt: toDate(row.finishedAt),
    siteOrigin: row.siteOrigin == null ? null : String(row.siteOrigin),
    siteLabel: row.siteLabel == null ? null : String(row.siteLabel),
    pagesScanned: row.pagesScanned == null ? null : toInt(row.pagesScanned),
    issuesFound: row.issuesFound == null ? null : toInt(row.issuesFound),
    highPriorityCount: row.highPriorityCount == null ? null : toInt(row.highPriorityCount),
    overallScore: row.overallScore == null ? null : toInt(row.overallScore),
    report: normalizeScanReport(row.resultJson),
    diagnosticsReady: Boolean(row.diagnosticsReady),
    diagnosticsGeneratedAt: toDate(row.diagnosticsGeneratedAt),
    diagnosticsFailureReason:
      row.diagnosticsFailureReason == null ? null : String(row.diagnosticsFailureReason),
  };
}

export async function getWorkspaceScanUsage(accountId: string) {
  return getScanUsage(accountId);
}

export async function getWorkspaceProjectScanStatus(projectId: number, accountId: string): Promise<ProjectScanStatus> {
  const usage = await getScanUsage(accountId);

  const lastJob = await queryOne<RawScanJobRow>(
    getAuthPool(),
    `SELECT
       job."id",
       job."status",
       job."reason",
       job."createdAt",
       job."startedAt",
       job."finishedAt",
       job."pagesScanned",
       job."issuesFound",
       job."highPriorityCount",
       job."overallScore",
       job."resultJson",
       site."origin" AS "siteOrigin",
       site."label" AS "siteLabel",
       CASE
         WHEN job."status" = 'SUCCEEDED' AND diag."generatedAt" IS NOT NULL THEN TRUE
         ELSE FALSE
       END AS "diagnosticsReady",
       diag."generatedAt" AS "diagnosticsGeneratedAt",
       CASE
         WHEN job."status" = 'FAILED'
          AND job."reason" IS NOT NULL
          AND job."reason" LIKE 'DIAGNOSTICS_GENERATION_FAILED:%'
         THEN job."reason"
         ELSE NULL
       END AS "diagnosticsFailureReason"
     FROM "ScanJob" job
     LEFT JOIN "Site" site ON site."id" = job."siteId"
     LEFT JOIN LATERAL (
       SELECT pack."generatedAt"
       FROM "CavAiRun" run
       INNER JOIN "CavAiInsightPack" pack
         ON pack."runId" = run."id"
        AND pack."accountId" = run."accountId"
       WHERE run."accountId" = $2
         AND run."origin" = site."origin"
         AND run."createdAt" >= job."createdAt"
       ORDER BY run."createdAt" DESC
       LIMIT 1
     ) diag ON TRUE
     WHERE job."projectId" = $1
     ORDER BY job."createdAt" DESC
     LIMIT 1`,
    [projectId, accountId],
  );

  return {
    usage,
    lastJob: normalizeScanSummary(lastJob),
  };
}
