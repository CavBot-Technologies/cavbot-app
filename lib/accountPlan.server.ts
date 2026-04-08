import "server-only";

import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
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
const SUBSCRIPTION_SOFT_FAIL_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2037"]);
const SUBSCRIPTION_SOFT_FAIL_DB_CODES = new Set(["08000", "08001", "08003", "08004", "08006", "08007", "53300", "57P01", "57P02", "57P03"]);

function parseDateMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function collectErrorMessages(err: unknown, depth = 0): string[] {
  if (!err || depth > 3) return [];
  if (typeof err === "string") return [err.toLowerCase()];
  if (typeof err !== "object") return [];

  const typed = err as {
    message?: unknown;
    meta?: { message?: unknown };
    cause?: unknown;
  };

  return [
    String(typed?.meta?.message || "").toLowerCase(),
    String(typed?.message || "").toLowerCase(),
    ...collectErrorMessages(typed?.cause, depth + 1),
  ].filter(Boolean);
}

function isSubscriptionLookupSoftFailure(err: unknown) {
  const prismaCode = String((err as { code?: unknown })?.code || "").toUpperCase();
  const dbCode = String((err as { meta?: { code?: unknown } })?.meta?.code || "").toUpperCase();

  if (SUBSCRIPTION_SOFT_FAIL_PRISMA_CODES.has(prismaCode)) return true;
  if (SUBSCRIPTION_SOFT_FAIL_DB_CODES.has(dbCode)) return true;
  if (
    isSchemaMismatchError(err, {
      tables: ["Subscription"],
      columns: ["accountId", "status", "currentPeriodEnd", "updatedAt", "createdAt", "tier"],
    })
  ) {
    return true;
  }

  const messages = collectErrorMessages(err);
  return messages.some((message) =>
    message.includes("service unavailable")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("connection terminated")
    || message.includes("connection reset")
    || message.includes("connection refused")
    || message.includes("too many clients")
    || message.includes("remaining connection slots")
    || message.includes("can not reach database server")
    || message.includes("can't reach database server")
    || message.includes("server closed the connection unexpectedly")
    || message.includes("admin shutdown")
    || message.includes("query engine exited")
  );
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

  try {
    return await tx.subscription.findFirst({
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
  } catch (error) {
    if (isSubscriptionLookupSoftFailure(error)) return null;
    throw error;
  }
}
