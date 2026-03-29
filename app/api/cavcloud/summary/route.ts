import type { Prisma } from "@prisma/client";

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getPlanLimits, resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg", "bmp", "heic", "heif", "tif", "tiff"] as const;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "ogv", "ogg", "avi", "mkv", "wmv", "flv", "3gp"] as const;

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

type AccountPlanShape = {
  tier: unknown;
  trialSeatActive: boolean;
  trialEndsAt: Date | null;
};

function resolveEffectivePlanId(account: AccountPlanShape | null): PlanId {
  const base = resolvePlanIdFromTier(String(account?.tier || "FREE"));
  const trialEndsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  if (account?.trialSeatActive && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()) {
    return "premium_plus";
  }
  return base;
}

function planLimitBytes(account: AccountPlanShape | null, planId: PlanId): number | null {
  const trialEndsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  const trialActive = Boolean(account?.trialSeatActive) && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now();
  if (trialActive) return null;
  return storageLimitBytesForPlan(planId);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

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

    const [account, folderCount, fileCount, imageCount, videoCount, bytesAgg] = await Promise.all([
      prisma.account.findUnique({
        where: { id: accountId },
        select: {
          tier: true,
          trialSeatActive: true,
          trialEndsAt: true,
        },
      }),
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
    ]);

    const usedBig = bytesAgg._sum.bytes ?? BigInt(0);
    const usedBytes = toSafeNumber(usedBig);
    const planId = resolveEffectivePlanId(account);
    const limitBytes = planLimitBytes(account, planId);
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
    if (isMissingCavCloudTablesError(err)) {
      try {
        const sess = await requireSession(req);
        requireAccountContext(sess);
        requireUser(sess);
        const account = await prisma.account.findUnique({
          where: { id: String(sess.accountId || "") },
          select: { tier: true, trialSeatActive: true, trialEndsAt: true },
        });
        const planId = resolveEffectivePlanId(account);
        const limitBytes = planLimitBytes(account, planId);
        return jsonNoStore({
          ok: true,
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
        }, 200);
      } catch {
        // fall through
      }
    }
    return cavcloudErrorResponse(err, "Failed to load CavCloud summary.");
  }
}
