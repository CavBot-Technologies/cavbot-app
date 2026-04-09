import "server-only";

import type pg from "pg";

import { getAuthPool } from "@/lib/authDb";
import {
  findLatestEntitledSubscription,
  isSubscriptionEntitled,
  isTrialSeatEntitled,
  resolveEffectivePlanId,
} from "@/lib/accountPlan.server";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

type StoredAccountTier = "FREE" | "PREMIUM" | "ENTERPRISE";

export type BillingPlanSource = "account" | "subscription" | "trial" | "fallback";

export type BillingPlanAccountRecord = {
  id: string;
  tier?: unknown;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | string | null;
};

type EntitledSubscriptionRecord = Awaited<ReturnType<typeof findLatestEntitledSubscription>>;

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type PrismaBillingPlanDbClient = {
  account: {
    findUnique: (query: {
      where?: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<{
      id: string;
      tier: unknown;
      trialSeatActive: boolean | null;
      trialEndsAt: Date | string | null;
    } | null>;
    update: (query: {
      where?: Record<string, unknown>;
      data?: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  subscription: {
    findFirst: (query: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
      select?: Record<string, boolean>;
    }) => Promise<EntitledSubscriptionRecord | null>;
  };
};

type BillingPlanDbClient = Queryable | PrismaBillingPlanDbClient;

type RawBillingPlanAccountRow = {
  id: string;
  tier: string | null;
  trialSeatActive: boolean | null;
  trialEndsAt: Date | string | null;
};

export type BillingPlanResolution = {
  currentPlanId: PlanId;
  accountPlanId: PlanId;
  planSource: BillingPlanSource;
  authoritative: boolean;
  driftDetected: boolean;
  entitledSubscription: EntitledSubscriptionRecord | null;
  repairedStoredTier: StoredAccountTier | null;
};

function persistedTierFromPlanId(planId: PlanId): StoredAccountTier {
  if (planId === "premium_plus") return "ENTERPRISE";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

async function loadBillingPlanAccount(
  accountIdRaw: string,
  tx: BillingPlanDbClient = getAuthPool(),
): Promise<BillingPlanAccountRecord | null> {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) return null;

  const row = typeof (tx as Queryable | null)?.query === "function"
    ? (
        await (tx as Queryable).query<RawBillingPlanAccountRow>(
          `SELECT
             "id",
             "tier",
             "trialSeatActive",
             "trialEndsAt"
           FROM "Account"
           WHERE "id" = $1
           LIMIT 1`,
          [accountId],
        )
      ).rows[0] ?? null
    : await (tx as PrismaBillingPlanDbClient).account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          tier: true,
          trialSeatActive: true,
          trialEndsAt: true,
        },
      });

  if (!row?.id) return null;

  return {
    id: row.id,
    tier: row.tier,
    trialSeatActive: row.trialSeatActive,
    trialEndsAt: row.trialEndsAt,
  };
}

export function computeBillingPlanResolution(args: {
  account?: BillingPlanAccountRecord | null;
  entitledSubscription?: EntitledSubscriptionRecord | null;
}): BillingPlanResolution {
  const account = args.account ?? null;
  const entitledSubscription = args.entitledSubscription ?? null;

  if (!account?.id) {
    return {
      currentPlanId: "free",
      accountPlanId: "free",
      planSource: "fallback",
      authoritative: false,
      driftDetected: false,
      entitledSubscription,
      repairedStoredTier: null,
    };
  }

  const accountPlanId = resolvePlanIdFromTier(account.tier || "FREE");
  const currentPlanId = resolveEffectivePlanId({
    account,
    subscription: entitledSubscription,
  });

  let planSource: BillingPlanSource = "account";
  if (isTrialSeatEntitled(account)) {
    planSource = "trial";
  } else if (isSubscriptionEntitled(entitledSubscription)) {
    planSource = "subscription";
  }

  return {
    currentPlanId,
    accountPlanId,
    planSource,
    authoritative: true,
    driftDetected: currentPlanId !== accountPlanId,
    entitledSubscription,
    repairedStoredTier: null,
  };
}

export async function resolveBillingPlanResolution(args: {
  accountId: string;
  account?: BillingPlanAccountRecord | null;
  tx?: BillingPlanDbClient;
  repair?: boolean;
}): Promise<BillingPlanResolution> {
  const tx = args.tx ?? getAuthPool();
  const accountId = String(args.accountId || "").trim();
  const account = args.account ?? (await loadBillingPlanAccount(accountId, tx));

  if (!account?.id) {
    return computeBillingPlanResolution({});
  }

  const entitledSubscription = await findLatestEntitledSubscription(account.id, tx).catch((error) => {
    console.error("[billing/plan] entitled subscription lookup failed", error);
    return null;
  });

  const resolution = computeBillingPlanResolution({
    account,
    entitledSubscription,
  });

  if (!resolution.driftDetected) {
    return resolution;
  }

  if (resolution.planSource !== "subscription") {
    return resolution;
  }

  const repairedStoredTier = persistedTierFromPlanId(resolution.currentPlanId);
  const storedTier = String(account.tier || "FREE").trim().toUpperCase();

  if (args.repair === false || storedTier === repairedStoredTier) {
    return {
      ...resolution,
      repairedStoredTier: storedTier === repairedStoredTier ? repairedStoredTier : null,
    };
  }

  try {
    if (typeof (tx as Queryable | null)?.query === "function") {
      await (tx as Queryable).query(
        `UPDATE "Account"
         SET "tier" = $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [account.id, repairedStoredTier],
      );
    } else {
      await (tx as PrismaBillingPlanDbClient).account.update({
        where: { id: account.id },
        data: { tier: repairedStoredTier },
      });
    }

    console.warn(
      "[billing/plan] repaired account tier drift",
      JSON.stringify({
        accountId: account.id,
        storedTier,
        repairedStoredTier,
        currentPlanId: resolution.currentPlanId,
      }),
    );

    return {
      ...resolution,
      repairedStoredTier,
    };
  } catch (error) {
    console.error(
      "[billing/plan] failed to repair account tier drift",
      JSON.stringify({
        accountId: account.id,
        storedTier,
        repairedStoredTier,
        currentPlanId: resolution.currentPlanId,
      }),
      error,
    );
    return resolution;
  }
}
