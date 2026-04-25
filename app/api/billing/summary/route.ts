// app/api/billing/summary/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, readVerifiedSession } from "@/lib/apiAuth";
import { withDedicatedAuthClient } from "@/lib/authDb";
import { readAuthSessionView } from "@/lib/authSessionView.server";
import { PLANS, resolvePlanIdFromTier } from "@/lib/plans";
import { getQwenCoderPopoverState } from "@/src/lib/ai/qwen-coder-credits.server";
import { resolveBillingPlanResolution, type BillingPlanSource } from "@/lib/billingPlan.server";
import {
  normalizeBillingCycleValue,
  isBillingRuntimeUnavailableError,
  readBillingAccount,
  readBillingUsageMetrics,
  readLatestBillingSubscription,
} from "@/lib/billingRuntime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const BILLING_SUMMARY_TIMEOUT_MS = 2_500;
const BILLING_USAGE_AUX_TIMEOUT_MS = 750;

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

async function withBillingDeadline<T>(
  promise: Promise<T>,
  timeoutMs = BILLING_SUMMARY_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("BILLING_SUMMARY_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    degraded: true,
  };
}

type SummaryAccountRecord = {
  id: string;
  slug: string;
  tier: string;
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

function buildFallbackBillingSummary(args: {
  accountId: string;
  accountSlug?: string | null;
  tierEffective?: string | null;
  tier?: string | null;
}) {
  const currentPlanId = resolvePlanIdFromTier(args.tierEffective || args.tier || "FREE");
  const planDef = PLANS[currentPlanId];
  return {
    ok: true,
    degraded: true,
    account: {
      id: args.accountId,
      slug: String(args.accountSlug || ""),
      tier: String(args.tierEffective || args.tier || "FREE").toUpperCase() || "FREE",
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
      currentPlanId,
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

async function readBillingSnapshot(accountId: string) {
  return withDedicatedAuthClient(async (authClient) => {
    const account = await readBillingAccount(accountId, authClient);
    if (!account) {
      return {
        account: null,
        subRow: null,
        usageMetrics: { seatsUsed: 0, websitesUsed: 0 },
      };
    }

    const subRow = await readLatestBillingSubscription(accountId, {
      queryable: authClient,
    }).catch(() => null);
    const usageMetrics = await readBillingUsageMetrics(accountId, authClient).catch(() => ({
      seatsUsed: 0,
      websitesUsed: 0,
    }));

    return {
      account,
      subRow,
      usageMetrics,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const sess = await readVerifiedSession(req).catch(() => null);
    if (!sess || sess.systemRole !== "user") {
      return json({ ok: false, error: "UNAUTHORIZED", message: "UNAUTHORIZED" }, 401);
    }

    const accountId = String(sess.accountId || "").trim();
    const userId = String(sess.sub || "").trim();
    if (!accountId) return json(buildEmptyBillingSummary(), 200);

    const view = await withBillingDeadline(readAuthSessionView(sess)).catch(() => null);
    const billingSnapshot = await withBillingDeadline(readBillingSnapshot(accountId)).catch(() => null);
    const account = (billingSnapshot?.account ?? null) as SummaryAccountRecord | null;

    if (!account) {
      if (view?.account) {
        return json(
          buildFallbackBillingSummary({
            accountId,
            accountSlug: view.account.slug,
            tierEffective: view.account.tierEffective,
            tier: view.account.tier,
          }),
          200,
        );
      }
      return json(buildEmptyBillingSummary(), 200);
    }

    const planResolution = await withBillingDeadline(
      resolveBillingPlanResolution({
        accountId,
        account,
        repair: false,
      }),
    ).catch(() => null);

    const currentPlanId =
      planResolution?.currentPlanId
      ?? resolvePlanIdFromTier(view?.account.tierEffective || account.tier || "FREE");
    const planDef = PLANS[currentPlanId];

    const usageMetrics = billingSnapshot?.usageMetrics ?? {
      seatsUsed: 0,
      websitesUsed: 0,
    };

    const subRow = billingSnapshot?.subRow ?? null;

    const seatLimit = limitToNullable(planDef.limits.seats);
    const websiteLimit = limitToNullable(planDef.limits.websites);

    const billingCycle =
      normalizeBillingCycleValue(subRow?.billingCycle)
      ?? normalizeBillingCycleValue(account.pendingDowngradeBilling)
      ?? normalizeBillingCycleValue(account.lastUpgradeBilling)
      ?? "monthly";

    const subscription = subRow
      ? {
          ...subRow,
          currentPeriodStart: toIsoOrNull(subRow.currentPeriodStart),
          currentPeriodEnd: toIsoOrNull(subRow.currentPeriodEnd),
        }
      : account.trialSeatActive
        ? {
            status: "TRIALING",
            tier: account.tier,
            currentPeriodStart: toIsoOrNull(account.trialStartedAt),
            currentPeriodEnd: toIsoOrNull(account.trialEndsAt),
            provider: null,
            customerId: account.stripeCustomerId || null,
            billingCycle,
            stripePriceId: null,
            stripeSubscriptionId: null,
          }
        : {
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

    const stripeConnected = Boolean(account.stripeCustomerId);
    const providerConnected = Boolean(subscription?.provider === "stripe" || account.stripeCustomerId);
    const portalReady = Boolean(account.stripeCustomerId);
    const qwenCoderUsage = userId
      ? await withBillingDeadline(
          getQwenCoderPopoverState({
            accountId,
            userId,
            planId: currentPlanId,
            sessionId: null,
          }),
          BILLING_USAGE_AUX_TIMEOUT_MS,
        ).catch(() => null)
      : null;

    return json(
      {
        ok: true,
        degraded: Boolean(view?.degraded),
        account: {
          ...account,
          tier:
            planResolution?.repairedStoredTier
            ?? String(view?.account.tierEffective || account.tier).toUpperCase(),
          pendingDowngradeAt: toIsoOrNull(account.pendingDowngradeAt),
          pendingDowngradeEffectiveAt: toIsoOrNull(account.pendingDowngradeEffectiveAt),
          lastUpgradeAt: toIsoOrNull(account.lastUpgradeAt),
          trialStartedAt: toIsoOrNull(account.trialStartedAt),
          trialEndsAt: toIsoOrNull(account.trialEndsAt),
        },
        subscription,
        computed: {
          currentPlanId,
          planSource: planResolution?.planSource ?? "fallback",
          authoritative: Boolean(planResolution?.authoritative),
          seatLimit,
          websiteLimit,
          seatsUsed: usageMetrics.seatsUsed,
          websitesUsed: usageMetrics.websitesUsed,
          billingCycle,
          providerConnected,
          stripeConnected,
          portalReady,
        } satisfies SummaryComputedRecord,
        qwenCoderUsage,
      },
      200,
    );
  } catch (error) {
    if (isApiAuthError(error) && error.code === "ACCOUNT_CONTEXT_REQUIRED") {
      return json(buildEmptyBillingSummary(), 200);
    }
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    if (isBillingRuntimeUnavailableError(error)) {
      return json(
        { ok: false, error: "SERVICE_UNAVAILABLE", message: "Billing summary is temporarily unavailable." },
        503,
      );
    }
    return json({ ok: false, error: "BILLING_SUMMARY_FAILED", message: "Failed to load billing summary." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}
