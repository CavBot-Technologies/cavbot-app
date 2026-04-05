// app/api/billing/downgrade/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { getStripe } from "@/lib/stripeClient";
import { priceIdFor, type StripePlanId, type StripeBilling } from "@/lib/stripe";
import { resolvePlanIdFromTier, parseBillingCycle } from "@/lib/plans";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireBillingManageRole, resolveBillingAccountContext } from "@/lib/billingAccount.server";

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

function s(v: unknown) {
  return String(v ?? "").trim();
}

type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";
type DowngradeTarget = "free" | "premium";

function normalizeBillingCycle(input: unknown): BillingCycle {
  const parsed = parseBillingCycle(input) as BillingCycle;
  return parsed === "annual" ? "annual" : "monthly";
}

function normalizeDowngradeTarget(raw: unknown): DowngradeTarget | null {
  const v = s(raw).toLowerCase();
  if (v === "premium" || v === "pro") return "premium";
  if (v === "free") return "free";
  return null;
}

function allowedDowngradeTarget(current: PlanId, requested: DowngradeTarget): DowngradeTarget | null {
  if (current === "premium_plus") return requested === "premium" || requested === "free" ? requested : null;
  if (current === "premium") return requested === "free" ? "free" : null;
  return null;
}

function toStripeBilling(b: BillingCycle): StripeBilling {
  return b === "annual" ? "annual" : "monthly";
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;

    const body = (await readSanitizedJson(req, null)) as null | { targetPlan?: string; billing?: string };

    const requestedTarget = normalizeDowngradeTarget(body?.targetPlan);
    const billing: BillingCycle = normalizeBillingCycle(body?.billing);

    if (!requestedTarget) {
      return json({ ok: false, error: "INVALID_DOWNGRADE_TARGET", message: `targetPlan must be "premium" or "free".` }, 400);
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, tier: true },
    });
    if (!account) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);

    const currentPlanId = (resolvePlanIdFromTier(account.tier) as PlanId) || "free";
    const allowed = allowedDowngradeTarget(currentPlanId, requestedTarget);
    if (!allowed) {
      return json(
        { ok: false, error: "INVALID_DOWNGRADE_TARGET", message: `Cannot downgrade from ${currentPlanId} to ${requestedTarget}.` },
        400
      );
    }

    const latestStripeSub = await prisma.subscription.findFirst({
      where: { accountId, provider: "stripe", stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { stripeSubscriptionId: true },
    });

    if (!latestStripeSub?.stripeSubscriptionId) {
      return json({ ok: false, error: "NO_STRIPE_SUBSCRIPTION", message: "No active Stripe subscription found to downgrade." }, 409);
    }

    const sub = await getStripe().subscriptions.retrieve(String(latestStripeSub.stripeSubscriptionId), {
      expand: ["items.data.price"],
    }) as Stripe.Subscription;

    const firstItem = sub?.items?.data?.[0] || null;

    const now = new Date();
    // Stripe's TS types have shifted across versions; read these defensively without using `any`.
    const firstItemRec = (firstItem ?? {}) as unknown as Record<string, unknown>;
    const startSec = typeof firstItemRec["current_period_start"] === "number" ? (firstItemRec["current_period_start"] as number) : null;
    const endSec = typeof firstItemRec["current_period_end"] === "number" ? (firstItemRec["current_period_end"] as number) : null;
    const periodEnd = endSec ? new Date(endSec * 1000) : null;

    if (allowed === "free") {
      await getStripe().subscriptions.update(sub.id, {
        cancel_at_period_end: true,
        metadata: {
          cavbot_account_id: String(accountId),
          cavbot_downgrade_to: "free",
        },
      });

      await prisma.account.update({
        where: { id: accountId },
        data: {
          pendingDowngradePlanId: "free",
          pendingDowngradeBilling: billing,
          pendingDowngradeAt: now,
          pendingDowngradeEffectiveAt: periodEnd,
          pendingDowngradeAppliesAtRenewal: true,
        },
      });

      if (accountId) {
        await auditLogWrite({
          request: req,
          action: "PLAN_DOWNGRADED",
          accountId,
          operatorUserId,
          targetType: "billing",
          targetId: accountId,
          targetLabel: accountId,
          metaJson: {
            billing_event: "downgrade_scheduled_stripe_cancel_at_period_end",
            oldPlan: currentPlanId,
            newPlan: "free",
            scheduledAt: now.toISOString(),
            effectiveAt: periodEnd ? periodEnd.toISOString() : null,
            stripeSubscriptionId: sub.id,
          },
        });
      }

      return json({ ok: true, scheduled: { toPlan: "free", effectiveAt: periodEnd?.toISOString() ?? null } }, 200);
    }

    const item = firstItem;
    const currentPriceId = item?.price?.id || null;
    if (!currentPriceId) {
      return json({ ok: false, error: "SUBSCRIPTION_ITEM_MISSING", message: "Stripe subscription has no price item." }, 409);
    }

    const targetPriceId = priceIdFor("premium" as StripePlanId, toStripeBilling(billing));

    let scheduleId: string | null = null;
    if (typeof sub.schedule === "string") {
      scheduleId = sub.schedule;
    } else if (sub.schedule && typeof sub.schedule === "object" && "id" in sub.schedule) {
      const maybeId = (sub.schedule as { id?: unknown }).id;
      scheduleId = typeof maybeId === "string" ? maybeId : null;
    }
    if (!scheduleId) {
      const schedule = await getStripe().subscriptionSchedules.create({ from_subscription: sub.id });
      scheduleId = schedule?.id ?? null;
    }

    if (!scheduleId) {
      return json({ ok: false, error: "NO_STRIPE_SCHEDULE", message: "Failed to create Stripe subscription schedule." }, 409);
    }

    if (!startSec || !endSec) {
      return json({ ok: false, error: "NO_PERIOD_WINDOW", message: "Stripe subscription missing period window." }, 409);
    }

    await getStripe().subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases: [
        { items: [{ price: currentPriceId, quantity: 1 }], start_date: startSec, end_date: endSec },
        { items: [{ price: targetPriceId, quantity: 1 }], start_date: endSec },
      ],
      metadata: {
        cavbot_account_id: String(accountId),
        cavbot_downgrade_to: "premium",
      },
    });

    await prisma.account.update({
      where: { id: accountId },
      data: {
        pendingDowngradePlanId: "premium",
        pendingDowngradeBilling: billing,
        pendingDowngradeAt: now,
        pendingDowngradeEffectiveAt: periodEnd,
        pendingDowngradeAppliesAtRenewal: true,
      },
    });

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "PLAN_DOWNGRADED",
        accountId,
        operatorUserId,
        targetType: "billing",
        targetId: accountId,
        targetLabel: accountId,
        metaJson: {
          billing_event: "downgrade_scheduled_stripe_subscription_schedule",
          oldPlan: currentPlanId,
          newPlan: "premium",
          scheduledAt: now.toISOString(),
          effectiveAt: periodEnd ? periodEnd.toISOString() : null,
          stripeSubscriptionId: sub.id,
          stripeScheduleId: scheduleId,
          targetPriceId,
        },
      });
    }

    return json({ ok: true, scheduled: { toPlan: "premium", effectiveAt: periodEnd?.toISOString() ?? null } }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_DOWNGRADE_FAILED", message: "Failed to schedule downgrade." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
