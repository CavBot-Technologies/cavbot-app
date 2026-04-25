import "server-only";

import { withDedicatedAuthClient } from "@/lib/authDb";
import {
  CAVAI_INSIGHT_PACK_VERSION_V1,
  validateInsightPackV1,
  type CavAiInsightPackV1,
  type CavAiPriorityV1,
} from "@/packages/cavai-contracts/src";

type RawPackHistoryRow = {
  runId: string;
  createdAt: Date | string;
  pagesScanned: number | string | null;
  pageLimit: number | string | null;
  engineVersion: string | null;
  packVersion: string | null;
  generatedAt: Date | string | null;
  packJson: unknown;
  findingCount: number | string | null;
};

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

const PACK_HISTORY_QUERY_TIMEOUT_MS = 2_200;

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asInt(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

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
  const result = await withDedicatedAuthClient(async (authClient) => {
    await authClient.query(`SET statement_timeout = ${PACK_HISTORY_QUERY_TIMEOUT_MS}`);
    return authClient.query<RawPackHistoryRow>(
      `SELECT
         r."id" AS "runId",
         r."createdAt",
         r."pagesScanned",
         r."pageLimit",
         r."engineVersion",
         r."packVersion",
         p."generatedAt",
         p."packJson",
         COALESCE(f."findingCount", 0) AS "findingCount"
       FROM "CavAiRun" r
       LEFT JOIN "CavAiInsightPack" p
         ON p."runId" = r."id"
        AND p."accountId" = r."accountId"
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS "findingCount"
         FROM "CavAiFinding" cf
         WHERE cf."runId" = r."id"
       ) f ON TRUE
       WHERE r."accountId" = $1
         AND r."origin" = $2
       ORDER BY r."createdAt" DESC
       LIMIT $3`,
      [args.accountId, args.origin, limit]
    );
  });

  const history: CavAiPackHistoryEntry[] = result.rows.map((row) => {
    const pack = safePack(row.packJson);
    const topPriority = topPriorityFromPack(pack);
    const topPriorityScoreRaw = Number(topPriority?.priorityScore);

    return {
      runId: String(row.runId),
      createdAtISO: asDate(row.createdAt)?.toISOString() || new Date(0).toISOString(),
      generatedAtISO: asDate(row.generatedAt)?.toISOString() ?? null,
      pagesScanned: asInt(row.pagesScanned),
      pageLimit: asInt(row.pageLimit),
      engineVersion: String(row.engineVersion || ""),
      packVersion: String(row.packVersion || ""),
      findingCount: asInt(row.findingCount),
      priorityCount: Array.isArray(pack?.priorities) ? pack.priorities.length : 0,
      topPriorityCode: topPriority?.code || null,
      topPriorityScore: Number.isFinite(topPriorityScoreRaw) ? topPriorityScoreRaw : null,
      overlayDiffSummary: pack?.overlay?.diff?.summary || null,
    };
  });

  const latestPack = safePack(result.rows[0]?.packJson);
  return {
    origin: args.origin,
    pack: latestPack,
    history,
  };
}
