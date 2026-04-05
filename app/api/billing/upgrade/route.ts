// app/api/billing/upgrade/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { getStripe } from "@/lib/stripeClient";
import { getAppUrl, priceIdFor, type StripePlanId, type StripeBilling } from "@/lib/stripe";
import { resolvePlanIdFromTier, parseBillingCycle } from "@/lib/plans";
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

function normalizeBilling(raw: unknown): BillingCycle {
  const parsed = parseBillingCycle(raw) as BillingCycle;
  return parsed === "annual" ? "annual" : "monthly";
}

function normalizeTargetPlan(raw: unknown): PlanId {
  const v = s(raw).toLowerCase();
  if (v === "premium_plus" || v === "premium+") return "premium_plus";
  if (v === "premium" || v === "pro") return "premium";
  if (v === "free") return "free";
  return "premium";
}

function allowedUpgradeTarget(current: PlanId, requested: PlanId): PlanId | null {
  if (current === "free") return requested === "premium" || requested === "premium_plus" ? requested : null;
  if (current === "premium") return requested === "premium_plus" ? "premium_plus" : null;
  return null;
}

function toStripePlanId(p: PlanId): StripePlanId | null {
  if (p === "premium") return "premium";
  if (p === "premium_plus") return "premium_plus";
  return null;
}

function toStripeBilling(b: BillingCycle): StripeBilling {
  return b === "annual" ? "annual" : "monthly";
}

async function ensureStripeCustomer(args: { accountId: string; operatorEmail: string }) {
  const account = await prisma.account.findUnique({
    where: { id: args.accountId },
    select: { id: true, name: true, slug: true, stripeCustomerId: true, billingEmail: true },
  });
  if (!account) {
    const err = new Error("Account not found.");
    (err as Partial<Error & { status?: number }>).status = 404;
    throw err;
  }

  const existingId = account.stripeCustomerId ? String(account.stripeCustomerId).trim() : "";
  if (existingId) return { stripeCustomerId: existingId };

  const email = account.billingEmail ? String(account.billingEmail).trim() : args.operatorEmail;
  const name = account.name ? String(account.name).trim() : args.operatorEmail;

  const metadata: Record<string, string> = {
    cavbot_account_id: args.accountId,
  };
  if (account.slug) metadata.cavbot_account_slug = String(account.slug).trim();

  const customerParams: Stripe.CustomerCreateParams = {
    email: email || undefined,
    name: name || undefined,
    metadata,
  };

  const customer = await getStripe().customers.create(customerParams);
  const stripeCustomerId = customer.id;

  await prisma.account.update({ where: { id: args.accountId }, data: { stripeCustomerId } });
  return { stripeCustomerId };
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;

    const body = (await readSanitizedJson(req, null)) as null | { targetPlan?: string; billing?: string };

    const requestedTarget = normalizeTargetPlan(body?.targetPlan);
    const billing: BillingCycle = normalizeBilling(body?.billing);

    const acct = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, tier: true },
    });
    if (!acct) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);

    const currentPlanId = (resolvePlanIdFromTier(acct.tier) as PlanId) || "free";
    const allowed = allowedUpgradeTarget(currentPlanId, requestedTarget);
    if (!allowed) {
      return json(
        { ok: false, error: "INVALID_UPGRADE_TARGET", message: `Cannot upgrade from ${currentPlanId} to ${requestedTarget}.` },
        400
      );
    }

    const stripePlan = toStripePlanId(allowed);
    if (!stripePlan) return json({ ok: false, error: "BAD_INPUT", message: "Invalid targetPlan for upgrade." }, 400);

    const operator = (await prisma.user.findUnique({
      where: { id: operatorUserId },
      select: { id: true, email: true },
    })) as { id: string; email: string | null } | null;
    if (!operator?.email) return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);

    const { stripeCustomerId } = await ensureStripeCustomer({ accountId, operatorEmail: operator.email });

    const priceId = priceIdFor(stripePlan, toStripeBilling(billing));

    const latestStripeSub = await prisma.subscription.findFirst({
      where: { accountId, provider: "stripe", stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { stripeSubscriptionId: true },
    });

    await prisma.account.update({
      where: { id: accountId },
      data: {
        pendingDowngradePlanId: null,
        pendingDowngradeBilling: null,
        pendingDowngradeAt: null,
        pendingDowngradeEffectiveAt: null,
        pendingDowngradeAppliesAtRenewal: true,
      },
    });

    // Update existing subscription in place
    if (latestStripeSub?.stripeSubscriptionId) {
      const sub = (await getStripe().subscriptions.retrieve(String(latestStripeSub.stripeSubscriptionId), {
        expand: ["items.data.price"],
      })) as Stripe.Subscription;

      const item = sub?.items?.data?.[0];
      if (!item?.id) {
        return json(
          { ok: false, error: "SUBSCRIPTION_ITEM_MISSING", message: "Stripe subscription has no items to update." },
          409
        );
      }

      await getStripe().subscriptions.update(sub.id, {
        proration_behavior: "create_prorations",
        items: [{ id: item.id, price: priceId }],
        metadata: {
          cavbot_account_id: String(accountId),
          cavbot_plan_id: stripePlan,
          cavbot_billing: toStripeBilling(billing),
        },
      });

      return json({ ok: true, mode: "subscription_update", stripeSubscriptionId: sub.id, targetPlan: stripePlan, billing }, 200);
    }

    // Otherwise use Checkout for subscription creation
    const appUrl = getAppUrl();
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/billing/cancel`;

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(accountId),
      metadata: {
        cavbot_account_id: String(accountId),
        cavbot_plan_id: stripePlan,
        cavbot_billing: toStripeBilling(billing),
        cavbot_operator_user_id: String(operatorUserId),
      },
      subscription_data: {
        metadata: {
          cavbot_account_id: String(accountId),
          cavbot_plan_id: stripePlan,
          cavbot_billing: toStripeBilling(billing),
        },
      },
    });

    return json({ ok: true, mode: "checkout", checkoutSessionId: session.id, url: session.url ?? null }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_UPGRADE_FAILED", message: "Failed to start upgrade." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
