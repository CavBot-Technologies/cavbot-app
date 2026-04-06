import "server-only";

import { prisma } from "@/lib/prisma";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

type AccountPlanRecord = {
  tier?: unknown;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | string | null;
};

type SubscriptionPlanRecord = {
  tier?: unknown;
  status?: unknown;
  currentPeriodEnd?: Date | string | null;
};

type PlanResolverDbClient = {
  subscription: {
    findFirst: typeof prisma.subscription.findFirst;
  };
};

const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  premium: 1,
  premium_plus: 2,
};

const ENTITLED_SUBSCRIPTION_STATUSES = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

function parseDateMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isTrialSeatEntitled(account: AccountPlanRecord | null | undefined, now = Date.now()) {
  const endsAtMs = parseDateMs(account?.trialEndsAt);
  return Boolean(account?.trialSeatActive) && endsAtMs != null && endsAtMs > now;
}

export function isSubscriptionEntitled(
  subscription: SubscriptionPlanRecord | null | undefined,
  now = Date.now(),
) {
  const status = String(subscription?.status || "").trim().toUpperCase();
  if (!ENTITLED_SUBSCRIPTION_STATUSES.has(status)) return false;
  const endsAtMs = parseDateMs(subscription?.currentPeriodEnd);
  return endsAtMs == null || endsAtMs > now;
}

export function resolveEffectivePlanId(args: {
  account?: AccountPlanRecord | null;
  subscription?: SubscriptionPlanRecord | null;
  now?: number;
}): PlanId {
  const now = Number.isFinite(args.now) ? Number(args.now) : Date.now();
  if (isTrialSeatEntitled(args.account, now)) return "premium_plus";

  const accountPlanId = resolvePlanIdFromTier(args.account?.tier || "FREE");
  const subscriptionPlanId = isSubscriptionEntitled(args.subscription, now)
    ? resolvePlanIdFromTier(args.subscription?.tier || "FREE")
    : "free";

  return PLAN_RANK[subscriptionPlanId] > PLAN_RANK[accountPlanId] ? subscriptionPlanId : accountPlanId;
}

export function planTierTokenFromPlanId(planId: PlanId): "FREE" | "PREMIUM" | "PREMIUM_PLUS" {
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

export async function findLatestEntitledSubscription(
  accountIdRaw: string,
  tx: PlanResolverDbClient = prisma,
) {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) return null;

  return tx.subscription.findFirst({
    where: {
      accountId,
      status: {
        in: ["ACTIVE", "TRIALING", "PAST_DUE"],
      },
    },
    orderBy: [
      { currentPeriodEnd: "desc" },
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      tier: true,
      status: true,
      currentPeriodEnd: true,
    },
  });
}
