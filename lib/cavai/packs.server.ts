import "server-only";

import { prisma } from "@/lib/prisma";
import {
  CAVAI_INSIGHT_PACK_VERSION_V1,
  validateInsightPackV1,
  type CavAiInsightPackV1,
  type CavAiPriorityV1,
} from "@/packages/cavai-contracts/src";

export type CavAiPackHistoryEntry = {
  runId: string;
  createdAtISO: string;
  generatedAtISO: string | null;
  pagesScanned: number;
  pageLimit: number;
  engineVersion: string;
  packVersion: string;
  findingCount: number;
  priorityCount: number;
  topPriorityCode: string | null;
  topPriorityScore: number | null;
  overlayDiffSummary: string | null;
};

export type CavAiLatestPackWithHistory = {
  origin: string;
  pack: CavAiInsightPackV1 | null;
  history: CavAiPackHistoryEntry[];
};

export function normalizeOriginStrict(input: unknown): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProto);
    if (!parsed.hostname || parsed.hostname.includes("..")) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function safePack(raw: unknown): CavAiInsightPackV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as CavAiInsightPackV1;
  if (candidate.packVersion !== CAVAI_INSIGHT_PACK_VERSION_V1) return null;
  const validated = validateInsightPackV1(candidate);
  if (!validated.ok) return null;
  return candidate;
}

function topPriorityFromPack(pack: CavAiInsightPackV1 | null): CavAiPriorityV1 | null {
  if (!pack || !Array.isArray(pack.priorities) || !pack.priorities.length) return null;
  const rows = pack.priorities.slice().sort((a, b) => {
    const aScore = Number(a?.priorityScore);
    const bScore = Number(b?.priorityScore);
    if (Number.isFinite(aScore) && Number.isFinite(bScore) && bScore !== aScore) return bScore - aScore;
    const aCode = String(a?.code || "");
    const bCode = String(b?.code || "");
    if (aCode < bCode) return -1;
    if (aCode > bCode) return 1;
    return 0;
  });
  return rows[0] || null;
}

function clampLimit(input: unknown): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(25, Math.trunc(value)));
}

export async function getLatestPackWithHistory(args: {
  accountId: string;
  origin: string;
  limit?: number;
}): Promise<CavAiLatestPackWithHistory> {
  const limit = clampLimit(args.limit);
  const runs = await prisma.cavAiRun.findMany({
    where: {
      accountId: args.accountId,
      origin: args.origin,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      insightPack: {
        select: {
          generatedAt: true,
          packJson: true,
        },
      },
      _count: {
        select: {
          findings: true,
        },
      },
    },
  });

  const history: CavAiPackHistoryEntry[] = runs.map((run) => {
    const pack = safePack(run.insightPack?.packJson);
    const topPriority = topPriorityFromPack(pack);
    const topPriorityScoreRaw = Number(topPriority?.priorityScore);

    return {
      runId: run.id,
      createdAtISO: run.createdAt.toISOString(),
      generatedAtISO: run.insightPack?.generatedAt ? run.insightPack.generatedAt.toISOString() : null,
      pagesScanned: Number(run.pagesScanned || 0),
      pageLimit: Number(run.pageLimit || 0),
      engineVersion: String(run.engineVersion || ""),
      packVersion: String(run.packVersion || ""),
      findingCount: Number(run._count?.findings || 0),
      priorityCount: Array.isArray(pack?.priorities) ? pack.priorities.length : 0,
      topPriorityCode: topPriority?.code || null,
      topPriorityScore: Number.isFinite(topPriorityScoreRaw) ? topPriorityScoreRaw : null,
      overlayDiffSummary: pack?.overlay?.diff?.summary || null,
    };
  });

  const latestPack = safePack(runs[0]?.insightPack?.packJson);
  return {
    origin: args.origin,
    pack: latestPack,
    history,
  };
}
