import "server-only";

import { createHash } from "crypto";
import type pg from "pg";
import { getAuthPool, newDbId, withAuthTransaction } from "@/lib/authDb";
import {
  CAVAI_INSIGHT_PACK_VERSION_V1,
  type CavAiFindingV1,
  type CavAiFixPlanV1,
  type CavAiInsightPackV1,
  type CavAiOverlayV1,
  type NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";

const IDEMPOTENCY_WINDOW_MS = (() => {
  const parsed = Number(process.env.CAVAI_IDEMPOTENCY_WINDOW_MS || "");
  if (!Number.isFinite(parsed) || parsed < 1_000) return 5 * 60 * 1000;
  return Math.trunc(parsed);
})();
const OVERLAY_HISTORY_WINDOW = 5;

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<pg.QueryResult<T>>;
};

type RawPackRow = {
  packJson: unknown;
};

type RawRunLookupRow = {
  runId: string;
  createdAt: Date | string;
  packJson: unknown;
};

type RawCreatedRunRow = {
  id: string;
  createdAt: Date | string;
};

type RawOverlayRunRow = {
  id: string;
};

type RawFindingCodeRow = {
  runId: string;
  code: string | null;
};

function stableIndex(seed: string, modulo: number) {
  if (modulo <= 0) return 0;
  const hash = createHash("sha256").update(seed).digest("hex");
  const value = Number.parseInt(hash.slice(0, 8), 16);
  if (!Number.isFinite(value)) return 0;
  return value % modulo;
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

function safePack(raw: unknown): CavAiInsightPackV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const pack = raw as CavAiInsightPackV1;
  if (pack.packVersion !== CAVAI_INSIGHT_PACK_VERSION_V1) return null;
  if (!pack.runId || !pack.requestId || !pack.engineVersion) return null;
  if (!pack.core || !Array.isArray(pack.core.findings)) return null;
  return pack;
}

export async function findIdempotentPack(params: {
  accountId: string;
  origin: string;
  inputHash: string;
}): Promise<CavAiInsightPackV1 | null> {
  const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const row = await queryOne<RawRunLookupRow>(
    getAuthPool(),
    `SELECT
       r."id" AS "runId",
       r."createdAt",
       p."packJson"
     FROM "CavAiRun" r
     LEFT JOIN "CavAiInsightPack" p
       ON p."runId" = r."id"
      AND p."accountId" = r."accountId"
     WHERE r."accountId" = $1
       AND r."origin" = $2
       AND r."inputHash" = $3
       AND r."createdAt" >= $4
     ORDER BY r."createdAt" DESC
     LIMIT 1`,
    [params.accountId, params.origin, params.inputHash, windowStart]
  );
  return safePack(row?.packJson);
}

export async function createRunAndFindings(params: {
  accountId: string;
  userId: string;
  input: NormalizedScanInputV1;
  inputHash: string;
  engineVersion: string;
}): Promise<{ runId: string; createdAtIso: string }> {
  return withAuthTransaction(async (tx) => {
    const runId = newDbId();
    const created = await queryOne<RawCreatedRunRow>(
      tx,
      `INSERT INTO "CavAiRun" (
         "id",
         "accountId",
         "origin",
         "createdByUserId",
         "pagesScanned",
         "pageLimit",
         "pagesSelectedJson",
         "inputHash",
         "engineVersion",
         "packVersion",
         "createdAt"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7::jsonb,
         $8,
         $9,
         $10,
         NOW()
       )
       RETURNING "id", "createdAt"`,
      [
        runId,
        params.accountId,
        params.input.origin,
        params.userId,
        params.input.pagesSelected.length,
        params.input.pageLimit,
        JSON.stringify(params.input.pagesSelected),
        params.inputHash,
        params.engineVersion,
        CAVAI_INSIGHT_PACK_VERSION_V1,
      ]
    );

    if (!created) {
      throw new Error("CAVAI_RUN_CREATE_FAILED");
    }

    if (params.input.findings.length) {
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const finding of params.input.findings) {
        const base = values.length;
        values.push(
          newDbId(),
          params.accountId,
          runId,
          finding.code,
          finding.pillar,
          finding.severity,
          finding.pagePath,
          finding.templateHint || null,
          JSON.stringify(finding.evidence),
          new Date(finding.detectedAt)
        );
        tuples.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10})`
        );
      }

      await tx.query(
        `INSERT INTO "CavAiFinding" (
           "id",
           "accountId",
           "runId",
           "code",
           "pillar",
           "severity",
           "pagePath",
           "templateHint",
           "evidenceJson",
           "detectedAt"
         )
         VALUES ${tuples.join(", ")}`,
        values
      );
    }

    return {
      runId,
      createdAtIso: asDate(created.createdAt)?.toISOString() || new Date().toISOString(),
    };
  });
}

function trendFromIssueCounts(counts: number[]) {
  if (counts.length < 2) {
    return {
      state: "stagnating" as const,
      reason: "Only one run is available, so trend movement is not yet measurable.",
    };
  }
  const current = counts[0];
  const previous = counts[1];
  if (current < previous) {
    return {
      state: "improving" as const,
      reason: "Current run has fewer deterministic findings than the prior run.",
    };
  }
  if (current > previous) {
    return {
      state: "degrading" as const,
      reason: "Current run has more deterministic findings than the prior run.",
    };
  }
  return {
    state: "stagnating" as const,
    reason: "Finding volume is unchanged from the prior run.",
  };
}

export async function computeOverlay(params: {
  accountId: string;
  origin: string;
}): Promise<CavAiOverlayV1> {
  const runsResult = await getAuthPool().query<RawOverlayRunRow>(
    `SELECT "id"
     FROM "CavAiRun"
     WHERE "accountId" = $1
       AND "origin" = $2
     ORDER BY "createdAt" DESC
     LIMIT $3`,
    [params.accountId, params.origin, OVERLAY_HISTORY_WINDOW]
  );

  const runIds = runsResult.rows.map((row) => String(row.id));
  const findingsResult = runIds.length
    ? await getAuthPool().query<RawFindingCodeRow>(
        `SELECT "runId", "code"
         FROM "CavAiFinding"
         WHERE "runId" = ANY($1::text[])`,
        [runIds]
      )
    : { rows: [] as RawFindingCodeRow[] };

  const codeMap = new Map<string, Set<string>>();
  for (const runId of runIds) codeMap.set(runId, new Set<string>());
  for (const finding of findingsResult.rows) {
    const runId = String(finding.runId || "");
    const code = String(finding.code || "").toLowerCase().trim();
    if (!runId || !code) continue;
    const bucket = codeMap.get(runId);
    if (bucket) bucket.add(code);
  }

  const generatedFromRunIds = runIds.slice();
  const codeHistory: Record<string, { runsSeen: number; consecutiveRuns: number }> = {};
  const runsWithCodes = runIds.map((runId) => ({
    id: runId,
    codes: codeMap.get(runId) || new Set<string>(),
  }));

  const allCodes = new Set<string>();
  for (const run of runsWithCodes) {
    for (const code of run.codes) allCodes.add(code);
  }

  for (const code of allCodes) {
    let runsSeen = 0;
    let consecutiveRuns = 0;
    for (let i = 0; i < runsWithCodes.length; i += 1) {
      const hasCode = runsWithCodes[i].codes.has(code);
      if (hasCode) {
        runsSeen += 1;
        if (i === consecutiveRuns) consecutiveRuns += 1;
      }
    }
    codeHistory[code] = { runsSeen, consecutiveRuns };
  }

  const issueCounts = runsWithCodes.map((run) => run.codes.size);
  const trend = trendFromIssueCounts(issueCounts);

  const currentCodes = runsWithCodes[0]?.codes || new Set<string>();
  const previousCodes = runsWithCodes[1]?.codes || new Set<string>();
  const resolvedCodes = Array.from(previousCodes).filter((code) => !currentCodes.has(code)).sort();
  const newCodes = Array.from(currentCodes).filter((code) => !previousCodes.has(code)).sort();
  const persistedCodes = Array.from(currentCodes).filter((code) => previousCodes.has(code)).sort();

  let diffSummary = "Not enough run history to compute what changed.";
  if (runsWithCodes.length >= 2) {
    diffSummary = [
      resolvedCodes.length ? `${resolvedCodes.length} resolved` : "0 resolved",
      newCodes.length ? `${newCodes.length} new` : "0 new",
      persistedCodes.length ? `${persistedCodes.length} persisted` : "0 persisted",
    ].join(" · ");
  }

  const praiseVariants = [
    "CavBot detected measurable cleanup. Keep this repair cadence.",
    "Deterministic posture improved. Continue closing remaining priority codes.",
    "Nice momentum: resolved findings outpaced regressions in this run.",
    "Operational quality moved forward with evidence-backed fixes.",
  ];
  const praiseLine =
    resolvedCodes.length > 0
      ? praiseVariants[stableIndex(`${params.origin}|${resolvedCodes.join(",")}`, praiseVariants.length)]
      : "No resolved findings yet; focus on the top persisted priority.";
  const praiseReason =
    resolvedCodes.length > 0
      ? `Resolved codes: ${resolvedCodes.slice(0, 6).join(", ")}`
      : persistedCodes.length
      ? `Persisted codes: ${persistedCodes.slice(0, 6).join(", ")}`
      : "No comparable history window yet.";

  let fatigue: CavAiOverlayV1["fatigue"] = {
    level: "none",
    message: "No repeated priority fatigue detected across recent runs.",
  };
  const highestConsecutive = Object.values(codeHistory).reduce(
    (max, entry) => Math.max(max, entry.consecutiveRuns),
    0
  );
  if (highestConsecutive >= 3) {
    fatigue = {
      level: "high",
      message: "Repeated issues persisted across 3 or more consecutive runs.",
    };
  } else if (highestConsecutive >= 2) {
    fatigue = {
      level: "watch",
      message: "Some issues are repeating in consecutive runs and need ownership.",
    };
  }

  return {
    historyWindow: OVERLAY_HISTORY_WINDOW,
    generatedFromRunIds,
    codeHistory,
    diff: {
      resolvedCodes,
      newCodes,
      persistedCodes,
      summary: diffSummary,
    },
    praise: {
      line: praiseLine,
      reason: praiseReason,
      nextPriorityCode: persistedCodes[0] || newCodes[0] || undefined,
    },
    trend,
    fatigue,
  };
}

export async function persistInsightPack(params: {
  accountId: string;
  runId: string;
  pack: CavAiInsightPackV1;
}): Promise<void> {
  await getAuthPool().query(
    `INSERT INTO "CavAiInsightPack" (
       "id",
       "accountId",
       "runId",
       "packJson",
       "generatedAt",
       "engineVersion",
       "packVersion",
       "overlayIncluded"
     )
     VALUES (
       $1,
       $2,
       $3,
       $4::jsonb,
       $5,
       $6,
       $7,
       $8
     )
     ON CONFLICT ("runId") DO UPDATE
     SET "accountId" = EXCLUDED."accountId",
         "packJson" = EXCLUDED."packJson",
         "generatedAt" = EXCLUDED."generatedAt",
         "engineVersion" = EXCLUDED."engineVersion",
         "packVersion" = EXCLUDED."packVersion",
         "overlayIncluded" = EXCLUDED."overlayIncluded"`,
    [
      newDbId(),
      params.accountId,
      params.runId,
      JSON.stringify(params.pack),
      new Date(params.pack.generatedAt),
      params.pack.engineVersion,
      params.pack.packVersion,
      params.pack.overlayIncluded,
    ]
  );
}

export async function persistDeterministicFixPlan(params: {
  accountId: string;
  userId: string;
  requestId: string;
  runId: string;
  priorityCode: string;
  fixPlan: CavAiFixPlanV1;
  origin?: string;
}): Promise<void> {
  await getAuthPool().query(
    `INSERT INTO "CavAiFixPlan" (
       "id",
       "accountId",
       "runId",
       "requestId",
       "priorityCode",
       "source",
       "status",
       "planJson",
       "createdByUserId",
       "origin",
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
       $8::jsonb,
       $9,
       $10,
       NOW(),
       NOW()
     )`,
    [
      newDbId(),
      params.accountId,
      params.runId,
      params.requestId,
      params.priorityCode,
      "deterministic",
      "PROPOSED",
      JSON.stringify(params.fixPlan),
      params.userId,
      params.origin || null,
    ]
  );
}

export async function getInsightPackForRun(params: {
  accountId: string;
  runId: string;
}): Promise<CavAiInsightPackV1 | null> {
  const record = await queryOne<RawPackRow>(
    getAuthPool(),
    `SELECT "packJson"
     FROM "CavAiInsightPack"
     WHERE "accountId" = $1
       AND "runId" = $2
     LIMIT 1`,
    [params.accountId, params.runId]
  );
  return safePack(record?.packJson);
}

export function normalizeFindingsForInput(
  findings: CavAiFindingV1[],
  origin: string
): CavAiFindingV1[] {
  return findings
    .map((finding, idx) => ({
      ...finding,
      id: finding.id || `finding_${idx + 1}`,
      origin: finding.origin || origin,
      pagePath: finding.pagePath || "/",
      templateHint: finding.templateHint || null,
    }))
    .filter((finding) => !!finding.id && !!finding.code);
}
