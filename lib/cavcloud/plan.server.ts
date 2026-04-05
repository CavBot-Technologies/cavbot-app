import "server-only";

import { prisma } from "@/lib/prisma";
import {
  cavcloudPerFileMaxBytesBigIntForPlan,
  cavcloudPerFileMaxBytesForPlan,
  cavcloudStorageLimitBytesBigIntForPlan,
  cavcloudStorageLimitBytesForPlan,
  resolveCavCloudEffectivePlan,
  type CavCloudPlanAccountInput,
  type CavCloudPlanSubscriptionInput,
} from "@/lib/cavcloud/plan";

type PlanReader = Pick<typeof prisma, "account" | "subscription">;

export type CavCloudPlanContext = ReturnType<typeof resolveCavCloudEffectivePlan> & {
  account: CavCloudPlanAccountInput | null;
  subscription: CavCloudPlanSubscriptionInput;
  limitBytes: number | null;
  limitBytesBigInt: bigint | null;
  perFileMaxBytes: number;
  perFileMaxBytesBigInt: bigint;
};

async function readAccountPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanAccountInput | null> {
  if (!accountId) return null;

  try {
    return await tx.account.findUnique({
      where: { id: accountId },
      select: {
        tier: true,
        trialSeatActive: true,
        trialEndsAt: true,
      },
    });
  } catch {}

  try {
    return await tx.account.findUnique({
      where: { id: accountId },
      select: {
        tier: true,
      },
    });
  } catch {
    return null;
  }
}

async function readSubscriptionPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanSubscriptionInput> {
  if (!accountId) return null;

  try {
    return await tx.subscription.findFirst({
      where: { accountId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        status: true,
        tier: true,
      },
    });
  } catch {
    return null;
  }
}

export async function getCavCloudPlanContext(accountId: string, tx: PlanReader = prisma): Promise<CavCloudPlanContext> {
  const key = String(accountId || "").trim();
  const [account, subscription] = await Promise.all([
    readAccountPlanInput(key, tx),
    readSubscriptionPlanInput(key, tx),
  ]);

  const resolved = resolveCavCloudEffectivePlan({ account, subscription });

  return {
    ...resolved,
    account,
    subscription,
    limitBytes: cavcloudStorageLimitBytesForPlan(resolved.planId, { trialActive: resolved.trialActive }),
    limitBytesBigInt: cavcloudStorageLimitBytesBigIntForPlan(resolved.planId, { trialActive: resolved.trialActive }),
    perFileMaxBytes: cavcloudPerFileMaxBytesForPlan(resolved.planId),
    perFileMaxBytesBigInt: cavcloudPerFileMaxBytesBigIntForPlan(resolved.planId),
  };
}
