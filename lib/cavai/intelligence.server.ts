import "server-only";

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  CAVAI_INSIGHT_PACK_VERSION_V1,
  type CavAiFindingV1,
  type CavAiFixPlanV1,
  type CavAiInsightPackV1,
  type CavAiOverlayV1,
  type NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";
import { scopedRunLookupKey } from "@/lib/cavai/scoping";

const IDEMPOTENCY_WINDOW_MS = (() => {
  const parsed = Number(process.env.CAVAI_IDEMPOTENCY_WINDOW_MS || "");
  if (!Number.isFinite(parsed) || parsed < 1_000) return 5 * 60 * 1000;
  return Math.trunc(parsed);
})();
const OVERLAY_HISTORY_WINDOW = 5;

function stableIndex(seed: string, modulo: number) {
  if (modulo <= 0) return 0;
  const hash = createHash("sha256").update(seed).digest("hex");
  const value = Number.parseInt(hash.slice(0, 8), 16);
  if (!Number.isFinite(value)) return 0;
  return value % modulo;
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
  const run = await prisma.cavAiRun.findFirst({
    where: {
      accountId: params.accountId,
      origin: params.origin,
      inputHash: params.inputHash,
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: "desc" },
    include: { insightPack: true },
  });
  if (!run?.insightPack?.packJson) return null;
  return safePack(run.insightPack.packJson);
}

export async function createRunAndFindings(params: {
  accountId: string;
  userId: string;
  input: NormalizedScanInputV1;
  inputHash: string;
  engineVersion: string;
}): Promise<{ runId: string; createdAtIso: string }> {
  const run = await prisma.cavAiRun.create({
    data: {
      accountId: params.accountId,
      origin: params.input.origin,
      createdByUserId: params.userId,
      pagesScanned: params.input.pagesSelected.length,
      pageLimit: params.input.pageLimit,
      pagesSelectedJson: params.input.pagesSelected,
      inputHash: params.inputHash,
      engineVersion: params.engineVersion,
      packVersion: CAVAI_INSIGHT_PACK_VERSION_V1,
    },
  });

  const findingsData = params.input.findings.map((finding) => ({
    accountId: params.accountId,
    runId: run.id,
    code: finding.code,
    pillar: finding.pillar,
    severity: finding.severity,
    pagePath: finding.pagePath,
    templateHint: finding.templateHint || null,
    evidenceJson: finding.evidence as unknown as object,
    detectedAt: new Date(finding.detectedAt),
  }));

  if (findingsData.length) {
    await prisma.cavAiFinding.createMany({ data: findingsData });
  }

  return {
    runId: run.id,
    createdAtIso: run.createdAt.toISOString(),
  };
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
  const runs = await prisma.cavAiRun.findMany({
    where: { accountId: params.accountId, origin: params.origin },
    orderBy: { createdAt: "desc" },
    take: OVERLAY_HISTORY_WINDOW,
    include: {
      findings: { select: { code: true } },
    },
  });

  const generatedFromRunIds = runs.map((run) => run.id);
  const codeHistory: Record<string, { runsSeen: number; consecutiveRuns: number }> = {};
  const runsWithCodes = runs.map((run) => ({
    id: run.id,
    codes: new Set(run.findings.map((finding) => String(finding.code || "").toLowerCase()).filter(Boolean)),
  }));

  const allCodes = new Set<string>();
  for (const run of runsWithCodes) {
    for (const code of run.codes) allCodes.add(code);
  }

  for (const code of allCodes) {
    let runsSeen = 0;
    let consecutiveRuns = 0;
    for (let i = 0; i < runsWithCodes.length; i++) {
      const hasCode = runsWithCodes[i].codes.has(code);
      if (hasCode) {
        runsSeen += 1;
        if (i === consecutiveRuns) consecutiveRuns += 1;
      }
    }
    codeHistory[code] = { runsSeen, consecutiveRuns };
  }

  const issueCounts = runs.map((run) => run.findings.length);
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
  const scopedKey = scopedRunLookupKey(params.accountId, params.runId);
  await prisma.cavAiInsightPack.upsert({
    where: scopedKey,
    create: {
      accountId: params.accountId,
      runId: params.runId,
      packJson: params.pack as unknown as object,
      generatedAt: new Date(params.pack.generatedAt),
      engineVersion: params.pack.engineVersion,
      packVersion: params.pack.packVersion,
      overlayIncluded: params.pack.overlayIncluded,
    },
    update: {
      packJson: params.pack as unknown as object,
      generatedAt: new Date(params.pack.generatedAt),
      engineVersion: params.pack.engineVersion,
      packVersion: params.pack.packVersion,
      overlayIncluded: params.pack.overlayIncluded,
    },
  });
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
  await prisma.cavAiFixPlan.create({
    data: {
      accountId: params.accountId,
      runId: params.runId,
      requestId: params.requestId,
      priorityCode: params.priorityCode,
      source: "deterministic",
      status: "PROPOSED",
      planJson: params.fixPlan as unknown as object,
      createdByUserId: params.userId,
      origin: params.origin || null,
    },
  });
}

export async function getInsightPackForRun(params: {
  accountId: string;
  runId: string;
}): Promise<CavAiInsightPackV1 | null> {
  const scopedKey = scopedRunLookupKey(params.accountId, params.runId);
  const record = await prisma.cavAiInsightPack.findUnique({
    where: scopedKey,
    select: { packJson: true },
  });
  if (!record?.packJson) return null;
  return safePack(record.packJson);
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
