// app/api/billing/summary/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { resolvePlanIdFromTier, PLANS } from "@/lib/plans";
import { getQwenCoderPopoverState } from "@/src/lib/ai/qwen-coder-credits.server";

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

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const accountId = sess.accountId;
    const userId = String(sess.sub || "").trim();

    const account = await prisma.account.findUnique({
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

    if (!account) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);

    const currentPlanId = resolvePlanIdFromTier(account.tier);
    const planDef = PLANS[currentPlanId];

    const [membersCount, invitesCount] = await Promise.all([
      prisma.membership.count({ where: { accountId } }),
      prisma.invite.count({
        where: {
          accountId,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

    const projects = await prisma.project.findMany({
      where: { accountId, isActive: true },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    const sitesUsed = projectIds.length
      ? await prisma.site.count({ where: { projectId: { in: projectIds }, isActive: true } })
      : 0;

    // Prefer Stripe provider subscription if present
    const subscriptionSelect = {
      status: true,
      tier: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      provider: true,
      customerId: true,
      billingCycle: true,
      stripePriceId: true,
      stripeSubscriptionId: true,
    } as const;

    const latestStripeSub = await prisma.subscription.findFirst({
      where: { accountId, provider: "stripe" },
      orderBy: { createdAt: "desc" },
      select: subscriptionSelect,
    });

    const latestAnySub = !latestStripeSub
      ? await prisma.subscription.findFirst({
          where: { accountId },
          orderBy: { createdAt: "desc" },
          select: subscriptionSelect,
        })
      : null;

    const subRow = latestStripeSub || latestAnySub;

    const seatLimit = limitToNullable(planDef.limits.seats);
    const websiteLimit = limitToNullable(planDef.limits.websites);

    const billingCycle =
      subRow?.billingCycle || account.pendingDowngradeBilling || account.lastUpgradeBilling || "monthly";

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
          pendingDowngradeAt: toIsoOrNull(account.pendingDowngradeAt),
          pendingDowngradeEffectiveAt: toIsoOrNull(account.pendingDowngradeEffectiveAt),
          lastUpgradeAt: toIsoOrNull(account.lastUpgradeAt),
          trialStartedAt: toIsoOrNull(account.trialStartedAt),
          trialEndsAt: toIsoOrNull(account.trialEndsAt),
        },
        subscription,
        computed: {
          currentPlanId,
          seatLimit,
          websiteLimit,
          seatsUsed: membersCount + invitesCount,
          websitesUsed: sitesUsed,
          billingCycle,
          providerConnected,
          stripeConnected,
          portalReady,
        },
        qwenCoderUsage,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_SUMMARY_FAILED", message: "Failed to load billing summary." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}
