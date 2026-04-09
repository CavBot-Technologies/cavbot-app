// app/api/billing/summary/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { PLANS } from "@/lib/plans";
import { getQwenCoderPopoverState } from "@/src/lib/ai/qwen-coder-credits.server";
import { resolveBillingAccountContext } from "@/lib/billingAccount.server";
import { resolveBillingPlanResolution, type BillingPlanSource } from "@/lib/billingPlan.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

function toIsoOrNull(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function limitToNullable(x: number | "unlimited") {
  return typeof x === "number" ? x : null;
}

function buildEmptyBillingSummary() {
  const fallbackPlanId = "free" as const;
  const planDef = PLANS[fallbackPlanId];

  return {
    ok: true,
    account: {
      id: "",
      slug: "",
      tier: "FREE" as const,
      billingEmail: null,
      trialSeatActive: false,
      trialStartedAt: null,
      trialEndsAt: null,
      pendingDowngradePlanId: null,
      pendingDowngradeBilling: null,
      pendingDowngradeAt: null,
      pendingDowngradeEffectiveAt: null,
      lastUpgradePlanId: null,
      lastUpgradeBilling: null,
      lastUpgradeAt: null,
      lastUpgradeProrated: null,
      stripeCustomerId: null,
    },
    subscription: null,
    computed: {
      currentPlanId: fallbackPlanId,
      planSource: "fallback" as const,
      authoritative: false,
      seatLimit: limitToNullable(planDef.limits.seats),
      websiteLimit: limitToNullable(planDef.limits.websites),
      seatsUsed: 0,
      websitesUsed: 0,
      billingCycle: "monthly" as const,
      providerConnected: false,
      stripeConnected: false,
      portalReady: false,
    },
    qwenCoderUsage: null,
  };
}

type SummaryAccountRecord = {
  id: string;
  slug: string;
  tier: "FREE" | "PREMIUM" | "ENTERPRISE";
  billingEmail: string | null;
  trialSeatActive: boolean | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  pendingDowngradePlanId: string | null;
  pendingDowngradeBilling: string | null;
  pendingDowngradeAt: Date | null;
  pendingDowngradeEffectiveAt: Date | null;
  lastUpgradePlanId: string | null;
  lastUpgradeBilling: string | null;
  lastUpgradeAt: Date | null;
  lastUpgradeProrated: boolean | null;
  stripeCustomerId: string | null;
};

type SummarySubscriptionRecord = {
  status: string;
  tier: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  provider: string | null;
  customerId: string | null;
  billingCycle: string | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
};

type SummaryComputedRecord = {
  currentPlanId: "free" | "premium" | "premium_plus";
  planSource: BillingPlanSource;
  authoritative: boolean;
  seatLimit: number | null;
  websiteLimit: number | null;
  seatsUsed: number;
  websitesUsed: number;
  billingCycle: "monthly" | "annual";
  providerConnected: boolean;
  stripeConnected: boolean;
  portalReady: boolean;
};

async function findBillingAccount(accountId: string): Promise<SummaryAccountRecord | null> {
  try {
    return await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        slug: true,
        tier: true,
        billingEmail: true,
        trialSeatActive: true,
        trialStartedAt: true,
        trialEndsAt: true,
        pendingDowngradePlanId: true,
        pendingDowngradeBilling: true,
        pendingDowngradeAt: true,
        pendingDowngradeEffectiveAt: true,
        lastUpgradePlanId: true,
        lastUpgradeBilling: true,
        lastUpgradeAt: true,
        lastUpgradeProrated: true,
        stripeCustomerId: true,
      },
    });
  } catch (error) {
    console.error("[billing/summary] account full select failed", error);
  }

  try {
    const fallback = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        slug: true,
        tier: true,
        billingEmail: true,
        trialSeatActive: true,
        trialStartedAt: true,
        trialEndsAt: true,
        stripeCustomerId: true,
      },
    });

    if (!fallback) return null;

    return {
      ...fallback,
      pendingDowngradePlanId: null,
      pendingDowngradeBilling: null,
      pendingDowngradeAt: null,
      pendingDowngradeEffectiveAt: null,
      lastUpgradePlanId: null,
      lastUpgradeBilling: null,
      lastUpgradeAt: null,
      lastUpgradeProrated: false,
    };
  } catch (error) {
    console.error("[billing/summary] account fallback select failed", error);
    return null;
  }
}

async function findLatestSubscription(
  accountId: string,
  provider?: "stripe"
): Promise<SummarySubscriptionRecord | null> {
  try {
    return await prisma.subscription.findFirst({
      where: provider ? { accountId, provider } : { accountId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        tier: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        provider: true,
        customerId: true,
        billingCycle: true,
        stripePriceId: true,
        stripeSubscriptionId: true,
      },
    });
  } catch (error) {
    console.error(
      provider
        ? "[billing/summary] latest stripe subscription select failed"
        : "[billing/summary] latest subscription select failed",
      error
    );
  }

  try {
    const fallback = await prisma.subscription.findFirst({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        tier: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
      },
    });

    if (!fallback) return null;

    return {
      ...fallback,
      provider: null,
      customerId: null,
      billingCycle: null,
      stripePriceId: null,
      stripeSubscriptionId: null,
    };
  } catch (error) {
    console.error("[billing/summary] subscription fallback select failed", error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    const accountId = billingCtx.accountId;
    const userId = billingCtx.userId;

    const account = await findBillingAccount(accountId);

    if (!account) return json(buildEmptyBillingSummary(), 200);

    const planResolution = await resolveBillingPlanResolution({
      accountId,
      account,
      repair: true,
    });
    const currentPlanId = planResolution.currentPlanId;
    const planDef = PLANS[currentPlanId];

    const [membersCount, invitesCount] = await Promise.all([
      prisma.membership.count({ where: { accountId } }).catch((error) => {
        console.error("[billing/summary] membership count failed", error);
        return 0;
      }),
      prisma.invite
        .count({
          where: {
            accountId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
        })
        .catch((error) => {
          console.error("[billing/summary] invite count failed", error);
          return 0;
        }),
    ]);

    const projects = await prisma.project.findMany({
      where: { accountId, isActive: true },
      select: { id: true },
    }).catch((error) => {
      console.error("[billing/summary] project lookup failed", error);
      return [];
    });
    const projectIds = projects.map((p) => p.id);

    const sitesUsed = projectIds.length
      ? await prisma.site.count({ where: { projectId: { in: projectIds }, isActive: true } }).catch((error) => {
          console.error("[billing/summary] site count failed", error);
          return 0;
        })
      : 0;

    const latestStripeSub = await findLatestSubscription(accountId, "stripe");

    const latestAnySub = !latestStripeSub ? await findLatestSubscription(accountId) : null;

    const subRow = latestStripeSub || latestAnySub;

    const seatLimit = limitToNullable(planDef.limits.seats);
    const websiteLimit = limitToNullable(planDef.limits.websites);

    const billingCycleRaw =
      subRow?.billingCycle || account.pendingDowngradeBilling || account.lastUpgradeBilling || "monthly";
    const billingCycle = billingCycleRaw === "annual" ? "annual" : "monthly";

    let subscription = null;

    if (subRow) {
      subscription = {
        ...subRow,
        currentPeriodStart: toIsoOrNull(subRow.currentPeriodStart),
        currentPeriodEnd: toIsoOrNull(subRow.currentPeriodEnd),
      };
    } else if (account.trialSeatActive) {
      subscription = {
        status: "TRIALING",
        tier: account.tier,
        currentPeriodStart: toIsoOrNull(account.trialStartedAt),
        currentPeriodEnd: toIsoOrNull(account.trialEndsAt),
        provider: null,
        customerId: account.stripeCustomerId || null,
        billingCycle,
        stripePriceId: null,
        stripeSubscriptionId: null,
      };
    } else {
      subscription = {
        status: "ACTIVE",
        tier: account.tier,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        provider: null,
        customerId: account.stripeCustomerId || null,
        billingCycle,
        stripePriceId: null,
        stripeSubscriptionId: null,
      };
    }

    const stripeConnected = Boolean(account.stripeCustomerId);
    const providerConnected = Boolean(subscription?.provider === "stripe" || account.stripeCustomerId);
    const portalReady = Boolean(account.stripeCustomerId);
    const qwenCoderUsage = userId
      ? await getQwenCoderPopoverState({
          accountId,
          userId,
          planId: currentPlanId,
          sessionId: null,
        }).catch(() => null)
      : null;

    return json(
      {
        ok: true,
        account: {
          ...account,
          tier: planResolution.repairedStoredTier ?? account.tier,
          pendingDowngradeAt: toIsoOrNull(account.pendingDowngradeAt),
          pendingDowngradeEffectiveAt: toIsoOrNull(account.pendingDowngradeEffectiveAt),
          lastUpgradeAt: toIsoOrNull(account.lastUpgradeAt),
          trialStartedAt: toIsoOrNull(account.trialStartedAt),
          trialEndsAt: toIsoOrNull(account.trialEndsAt),
        },
        subscription,
        computed: {
          currentPlanId,
          planSource: planResolution.planSource,
          authoritative: planResolution.authoritative,
          seatLimit,
          websiteLimit,
          seatsUsed: membersCount + invitesCount,
          websitesUsed: sitesUsed,
          billingCycle,
          providerConnected,
          stripeConnected,
          portalReady,
        } satisfies SummaryComputedRecord,
        qwenCoderUsage,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error) && error.code === "ACCOUNT_CONTEXT_REQUIRED") {
      return json(buildEmptyBillingSummary(), 200);
    }
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_SUMMARY_FAILED", message: "Failed to load billing summary." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}
