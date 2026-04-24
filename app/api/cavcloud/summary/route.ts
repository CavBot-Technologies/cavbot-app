import type { Prisma } from "@prisma/client";

import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import {
  cavcloudErrorResponse,
  isCavCloudServiceUnavailableError,
  jsonNoStore,
  withCavCloudDeadline,
} from "@/lib/cavcloud/http.server";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { getPlanLimits, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "bmp", "heic", "heif", "tif", "tiff"] as const;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "ogv", "ogg", "avi", "mkv", "wmv", "flv", "3gp"] as const;
const SUMMARY_TIMEOUT_MS = 4_000;
const SUMMARY_FALLBACK_PLAN_TIMEOUT_MS = 750;

function toSafeNumber(value: bigint): number {
  if (value < BigInt(0)) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  return Number(value);
}

function storageLimitBytesForPlan(planId: PlanId): number | null {
  const limits = getPlanLimits(planId);
  if (limits.storageGb === "unlimited") return null;
  const bytes = Number(limits.storageGb || 0) * 1024 * 1024 * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.trunc(bytes);
}

function isMissingCavCloudTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavcloud")) return true;
  if (msg.includes("relation") && msg.includes("cavcloud")) return true;
  return false;
}

function extClauses(exts: readonly string[]): Prisma.CavCloudFileWhereInput[] {
  return exts.map((ext) => ({
    name: {
      endsWith: `.${ext}`,
      mode: "insensitive",
    },
  }));
}

function degradedSummaryPayload(plan: { planId: PlanId; limitBytes: number | null } | null = null) {
  const planId = plan?.planId ?? "free";
  const limitBytes = plan ? plan.limitBytes : storageLimitBytesForPlan(planId);
  return {
    ok: true,
    degraded: true,
    summary: {
      usedBytes: 0,
      usedBytesExact: "0",
      limitBytes,
      remainingBytes: limitBytes,
      folders: 0,
      files: 0,
      images: 0,
      videos: 0,
      other: 0,
      planId,
      generatedAtISO: new Date().toISOString(),
    },
  };
}

function buildStaticDegradedSummaryResponse() {
  return jsonNoStore(degradedSummaryPayload(), 200);
}

async function buildDegradedSummaryResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);

  const accountId = String(sess.accountId || "");
  try {
    const plan = await withCavCloudDeadline(
      getEffectiveAccountPlanContext(accountId).catch(() => null),
      {
        timeoutMs: SUMMARY_FALLBACK_PLAN_TIMEOUT_MS,
        message: "Timed out loading degraded CavCloud summary.",
      },
    );

    return jsonNoStore(degradedSummaryPayload(plan ? { planId: plan.planId, limitBytes: plan.limitBytes } : null), 200);
  } catch {
    return buildStaticDegradedSummaryResponse();
  }
}

export async function GET(req: Request) {
  let sessionValidated = false;

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    sessionValidated = true;

    const accountId = String(sess.accountId || "").trim();

    const imageWhere: Prisma.CavCloudFileWhereInput = {
      accountId,
      deletedAt: null,
      OR: [
        { mimeType: { startsWith: "image/" } },
        ...extClauses(IMAGE_EXTENSIONS),
      ],
    };
    const videoWhere: Prisma.CavCloudFileWhereInput = {
      accountId,
      deletedAt: null,
      OR: [
        { mimeType: { startsWith: "video/" } },
        ...extClauses(VIDEO_EXTENSIONS),
      ],
    };

    const planContextPromise = getEffectiveAccountPlanContext(accountId).catch(() => null);

    const [planContext, folderCount, fileCount, imageCount, videoCount, bytesAgg] = await withCavCloudDeadline(
      Promise.all([
        planContextPromise,
        prisma.cavCloudFolder.count({
          where: { accountId, deletedAt: null, path: { not: "/" } },
        }),
        prisma.cavCloudFile.count({
          where: { accountId, deletedAt: null },
        }),
        prisma.cavCloudFile.count({
          where: imageWhere,
        }),
        prisma.cavCloudFile.count({
          where: videoWhere,
        }),
        prisma.cavCloudFile.aggregate({
          where: { accountId, deletedAt: null },
          _sum: { bytes: true },
        }),
      ]),
      {
        timeoutMs: SUMMARY_TIMEOUT_MS,
        message: "Timed out loading CavCloud summary.",
      },
    );

    const usedBig = bytesAgg._sum.bytes ?? BigInt(0);
    const usedBytes = toSafeNumber(usedBig);
    const planId = planContext?.planId ?? "free";
    const limitBytes = planContext?.limitBytes ?? storageLimitBytesForPlan(planId);
    const remainingBytes = limitBytes == null ? null : Math.max(0, limitBytes - usedBytes);
    const otherCount = Math.max(0, fileCount - imageCount - videoCount);

    return jsonNoStore({
      ok: true,
      summary: {
        usedBytes,
        usedBytesExact: usedBig.toString(),
        limitBytes,
        remainingBytes,
        folders: folderCount,
        files: fileCount,
        images: imageCount,
        videos: videoCount,
        other: otherCount,
        planId,
        generatedAtISO: new Date().toISOString(),
      },
    }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load CavCloud summary.");
    }
    if (sessionValidated && isCavCloudServiceUnavailableError(err)) {
      return buildStaticDegradedSummaryResponse();
    }
    if (sessionValidated) {
      return buildStaticDegradedSummaryResponse();
    }
    if (
      isMissingCavCloudTablesError(err) ||
      isSchemaMismatchError(err, {
        tables: ["Account"],
        columns: ["trialSeatActive", "trialEndsAt", "tier"],
      })
    ) {
      try {
        return await buildDegradedSummaryResponse(req);
      } catch (fallbackError) {
        if (fallbackError instanceof ApiAuthError) {
          return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud summary.");
        }
        return buildStaticDegradedSummaryResponse();
      }
    }
    try {
      return await buildDegradedSummaryResponse(req);
    } catch (fallbackError) {
      if (fallbackError instanceof ApiAuthError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load CavCloud summary.");
      }
      return buildStaticDegradedSummaryResponse();
    }
  }
}
