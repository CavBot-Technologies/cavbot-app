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
import { isCavbotFounderAccountIdentity } from "@/lib/profileIdentity";

type PlanReader = Pick<typeof prisma, "account" | "subscription">;
const PAID_SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"] as const;

type CavCloudPlanAccountRecord = CavCloudPlanAccountInput & {
  name?: unknown;
  slug?: unknown;
};

export type CavCloudPlanContext = ReturnType<typeof resolveCavCloudEffectivePlan> & {
  account: CavCloudPlanAccountInput | null;
  subscription: CavCloudPlanSubscriptionInput;
  limitBytes: number | null;
  limitBytesBigInt: bigint | null;
  perFileMaxBytes: number;
  perFileMaxBytesBigInt: bigint;
};

export type EffectiveAccountPlanContext = CavCloudPlanContext;

async function readPrismaAccountPlanInput(accountId: string, tx: PlanReader): Promise<CavCloudPlanAccountRecord | null> {
  if (!accountId) return null;

  try {
    return await tx.account.findUnique({
      where: { id: accountId },
      select: {
        name: true,
        slug: true,
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
        name: true,
        slug: true,
        tier: true,
      },
    });
  } catch {
    return null;
  }
}

async function readAuthAccountPlanInput(accountId: string): Promise<CavCloudPlanAccountRecord | null> {
  const key = String(accountId || "").trim();
  if (!key) return null;

  try {
    const pool = getAuthPool();
    const account = await findAccountById(pool, key);
    if (!account) return null;
    return {
      name: account.name,
      slug: account.slug,
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

  const merged = mergeCavCloudPlanAccounts(authAccount, prismaAccount);
  const founderAccount = isCavbotFounderAccountIdentity({
    slug: authAccount?.slug ?? prismaAccount?.slug,
    name: authAccount?.name ?? prismaAccount?.name,
  });
  if (!merged) return null;
  if (!founderAccount) return merged;
  return {
    ...merged,
    tier: "PREMIUM_PLUS",
  };
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

export async function getEffectiveAccountPlanContext(
  accountId: string,
  tx: PlanReader = prisma,
): Promise<EffectiveAccountPlanContext> {
  return getCavCloudPlanContext(accountId, tx);
}
