import "server-only";

import { findAccountById, getAuthPool } from "@/lib/authDb";
import { prisma } from "@/lib/prisma";
import {
  cavcloudPerFileMaxBytesBigIntForPlan,
  cavcloudPerFileMaxBytesForPlan,
  cavcloudStorageLimitBytesBigIntForPlan,
  cavcloudStorageLimitBytesForPlan,
  mergeCavCloudPlanAccounts,
  resolveCavCloudEffectivePlan,
  type CavCloudPlanAccountInput,
  type CavCloudPlanSubscriptionInput,
} from "@/lib/cavcloud/plan";

type PlanReader = Pick<typeof prisma, "account" | "subscription">;
const PAID_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

export type CavCloudPlanContext = ReturnType<typeof resolveCavCloudEffectivePlan> & {
  account: CavCloudPlanAccountInput | null;
  subscription: CavCloudPlanSubscriptionInput;
  limitBytes: number | null;
  limitBytesBigInt: bigint | null;
  perFileMaxBytes: number;
  perFileMaxBytesBigInt: bigint;
};

async function readPrismaAccountPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanAccountInput | null> {
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

async function readAuthAccountPlanInput(accountId: string): Promise<CavCloudPlanAccountInput | null> {
  const key = String(accountId || "").trim();
  if (!key) return null;

  try {
    const pool = getAuthPool();
    const account = await findAccountById(pool, key);
    if (!account) return null;
    return {
      tier: account.tier,
      trialSeatActive: account.trialSeatActive,
      trialEndsAt: account.trialEndsAt,
    };
  } catch {
    return null;
  }
}

async function readAccountPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanAccountInput | null> {
  if (!accountId) return null;

  const [authAccount, prismaAccount] = await Promise.all([
    readAuthAccountPlanInput(accountId),
    readPrismaAccountPlanInput(accountId, tx),
  ]);

  return mergeCavCloudPlanAccounts(authAccount, prismaAccount);
}

async function readSubscriptionPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanSubscriptionInput> {
  if (!accountId) return null;

  try {
    const paid = await tx.subscription.findFirst({
      where: {
        accountId,
        status: { in: Array.from(PAID_SUBSCRIPTION_STATUSES) },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        status: true,
        tier: true,
      },
    });
    if (paid) return paid;
  } catch {}

  try {
    const latest = await tx.subscription.findFirst({
      where: { accountId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        status: true,
        tier: true,
      },
    });
    return latest;
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
