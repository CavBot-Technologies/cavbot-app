import "server-only";

import { randomUUID } from "crypto";
import type Stripe from "stripe";

import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { requireBillingManageRole, resolveBillingAccountContext } from "@/lib/billingAccount.server";
import { resolveBillingPlanResolution } from "@/lib/billingPlan.server";
import { findUserById, getAuthPool } from "@/lib/authDb";
import {
  clearPendingDowngradeState,
  ensureBillingStripeCustomerBinding,
  readBillingAccount,
  readLatestBillingSubscription,
  setPendingDowngradeState,
} from "@/lib/billingRuntime.server";
import { parseBillingCycle } from "@/lib/plans";
import { getStripe } from "@/lib/stripeClient";
import { getAppUrl, priceIdFor, type StripeBilling, type StripePlanId } from "@/lib/stripe";

type PlanId = "free" | "premium" | "premium_plus";
type BillingCycle = "monthly" | "annual";
type DowngradeTarget = "free" | "premium";

type BillingErrorFallback = {
  code: string;
  message: string;
  status?: number;
};

type BillingActor = {
  accountId: string;
  operatorUserId: string;
};

export type BillingUpgradeResult =
  | {
      ok: true;
      mode: "checkout";
      billing: StripeBilling;
      targetPlan: StripePlanId;
      checkoutSessionId: string;
      url: string;
    }
  | {
      ok: true;
      mode: "subscription_update";
      billing: StripeBilling;
      targetPlan: StripePlanId;
      stripeSubscriptionId: string;
      redirectUrl: string;
      url: string;
    };

export type BillingDowngradeResult = {
  ok: true;
  scheduled: {
    toPlan: DowngradeTarget;
    effectiveAt: string | null;
  };
  redirectUrl: string;
  url: string;
};

export class BillingOperationError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeBilling(raw: unknown): StripeBilling {
  const parsed = parseBillingCycle(raw) as BillingCycle;
  return parsed === "annual" ? "annual" : "monthly";
}

function normalizeUpgradeTarget(raw: unknown): StripePlanId | null {
  const value = s(raw).toLowerCase();
  if (value === "premium") return "premium";
  if (value === "premium_plus" || value === "premium+") return "premium_plus";
  return null;
}

function normalizeDowngradeTarget(raw: unknown): DowngradeTarget | null {
  const value = s(raw).toLowerCase();
  if (value === "premium" || value === "pro") return "premium";
  if (value === "free") return "free";
  return null;
}

function allowedUpgradeTarget(current: PlanId, requested: StripePlanId): StripePlanId | null {
  if (current === "free") return requested === "premium" || requested === "premium_plus" ? requested : null;
  if (current === "premium") return requested === "premium_plus" ? "premium_plus" : null;
  return null;
}

function allowedDowngradeTarget(current: PlanId, requested: DowngradeTarget): DowngradeTarget | null {
  if (current === "premium_plus") return requested === "premium" || requested === "free" ? requested : null;
  if (current === "premium") return requested === "free" ? "free" : null;
  return null;
}

function toStripeBilling(billing: BillingCycle): StripeBilling {
  return billing === "annual" ? "annual" : "monthly";
}

function buildUpgradeRedirectUrl(planId: StripePlanId, billing: StripeBilling) {
  const appUrl = getAppUrl();
  return `${appUrl}/settings?tab=billing&upgraded=${encodeURIComponent(planId)}&billing=${encodeURIComponent(billing)}`;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const details: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) details.code = code;
    const status = (error as { status?: unknown }).status;
    if (status !== undefined) details.status = status;
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) details.cause = serializeError(cause);
    return details;
  }

  return error;
}

function logBillingFailure(scope: string, context: Record<string, unknown>, error: unknown) {
  console.error(`[billing/${scope}] failed`, {
    ...context,
    error: serializeError(error),
  });
}

async function requireBillingActor(request: Request): Promise<BillingActor> {
  const session = await requireSession(request);
  const billingCtx = await resolveBillingAccountContext(session);
  requireBillingManageRole(billingCtx);
  return {
    accountId: billingCtx.accountId,
    operatorUserId: billingCtx.userId,
  };
}

async function ensureStripeCustomer(args: BillingActor) {
  const [account, user] = await Promise.all([
    readBillingAccount(args.accountId),
    findUserById(getAuthPool(), args.operatorUserId),
  ]);

  if (!account) {
    throw new BillingOperationError("ACCOUNT_NOT_FOUND", 404, "Account not found.");
  }
  if (!user?.email) {
    throw new BillingOperationError("USER_NOT_FOUND", 404, "User not found.");
  }

  let stripeCustomerId = s(account.stripeCustomerId);
  if (!stripeCustomerId) {
    const email = s(account.billingEmail) || s(user.email) || undefined;
    const name = s(account.name) || s(user.displayName) || s(user.email) || undefined;
    const metadata: Record<string, string> = {
      cavbot_account_id: args.accountId,
    };
    if (account.slug) metadata.cavbot_account_slug = s(account.slug);

    const customer = await (await getStripe()).customers.create(
      {
        email,
        name,
        metadata,
      },
      { idempotencyKey: `cavbot_customer_${args.accountId}` },
    );

    stripeCustomerId = customer.id;
    await ensureBillingStripeCustomerBinding(args.accountId, stripeCustomerId);
  }

  return {
    account,
    user,
    stripeCustomerId,
  };
}

function activeStripeSubscriptionId(status: string | null | undefined, stripeSubscriptionId: string | null | undefined) {
  const normalizedStatus = s(status).toUpperCase();
  const id = s(stripeSubscriptionId);
  if (!id) return "";
  if (normalizedStatus === "CANCELED") return "";
  return id;
}

function paymentCollectionCancelUrl(planId: StripePlanId, billing: StripeBilling) {
  const appUrl = getAppUrl();
  return `${appUrl}/billing/failed?canceled=1&plan=${encodeURIComponent(planId)}&billing=${encodeURIComponent(billing)}`;
}

export async function beginBillingUpgrade(args: {
  request: Request;
  targetPlan: unknown;
  billing: unknown;
}): Promise<BillingUpgradeResult> {
  const requestedTarget = normalizeUpgradeTarget(args.targetPlan);
  const billing = normalizeBilling(args.billing);

  try {
    if (!requestedTarget) {
      throw new BillingOperationError("BAD_INPUT", 400, "Missing or invalid target plan.");
    }

    const actor = await requireBillingActor(args.request);
    const planResolution = await resolveBillingPlanResolution({
      accountId: actor.accountId,
      repair: true,
    });
    const currentPlanId = planResolution.currentPlanId;
    const allowedTarget = allowedUpgradeTarget(currentPlanId, requestedTarget);

    if (!allowedTarget) {
      throw new BillingOperationError(
        "INVALID_UPGRADE_TARGET",
        400,
        `Cannot upgrade from ${currentPlanId} to ${requestedTarget}.`,
      );
    }

    const { stripeCustomerId } = await ensureStripeCustomer(actor);
    const stripe = await getStripe();
    const targetPriceId = priceIdFor(allowedTarget, billing);
    const latestSubscription = await readLatestBillingSubscription(actor.accountId, { provider: "stripe" });
    const existingStripeSubscriptionId = activeStripeSubscriptionId(
      latestSubscription?.status,
      latestSubscription?.stripeSubscriptionId,
    );

    if (existingStripeSubscriptionId) {
      const subscription = (await stripe.subscriptions.retrieve(existingStripeSubscriptionId, {
        expand: ["items.data.price"],
      })) as Stripe.Subscription;
      const firstItem = subscription.items?.data?.[0];

      if (!firstItem?.id) {
        throw new BillingOperationError(
          "SUBSCRIPTION_ITEM_MISSING",
          409,
          "Stripe subscription has no items to update.",
        );
      }

      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: false,
        proration_behavior: "create_prorations",
        items: [{ id: firstItem.id, price: targetPriceId }],
        metadata: {
          cavbot_account_id: actor.accountId,
          cavbot_plan_id: allowedTarget,
          cavbot_billing: billing,
        },
      });

      await clearPendingDowngradeState(actor.accountId);
      await auditLogWrite({
        request: args.request,
        action: "PLAN_UPGRADED",
        accountId: actor.accountId,
        operatorUserId: actor.operatorUserId,
        targetType: "billing",
        targetId: actor.accountId,
        targetLabel: actor.accountId,
        metaJson: {
          billing_event: "stripe_subscription_upgrade_requested",
          oldPlan: currentPlanId,
          newPlan: allowedTarget,
          billing,
          stripeSubscriptionId: subscription.id,
          stripePriceId: targetPriceId,
          updateMode: "subscription_update",
        },
      });

      const redirectUrl = buildUpgradeRedirectUrl(allowedTarget, billing);

      return {
        ok: true,
        mode: "subscription_update",
        billing,
        targetPlan: allowedTarget,
        stripeSubscriptionId: subscription.id,
        redirectUrl,
        url: redirectUrl,
      };
    }

    const appUrl = getAppUrl();
    const checkoutAttemptId = randomUUID();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        billing_address_collection: "auto",
        customer_update: { name: "auto", address: "auto" },
        line_items: [{ price: targetPriceId, quantity: 1 }],
        success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: paymentCollectionCancelUrl(allowedTarget, billing),
        allow_promotion_codes: true,
        client_reference_id: actor.accountId,
        metadata: {
          cavbot_account_id: actor.accountId,
          cavbot_plan_id: allowedTarget,
          cavbot_billing: billing,
          cavbot_operator_user_id: actor.operatorUserId,
        },
        subscription_data: {
          metadata: {
            cavbot_account_id: actor.accountId,
            cavbot_plan_id: allowedTarget,
            cavbot_billing: billing,
          },
        },
      },
      { idempotencyKey: `cavbot_checkout_${actor.accountId}_${allowedTarget}_${billing}_${checkoutAttemptId}` },
    );

    if (!s(session.url)) {
      throw new BillingOperationError("NO_CHECKOUT_URL", 500, "Stripe did not return a checkout URL.");
    }

    return {
      ok: true,
      mode: "checkout",
      billing,
      targetPlan: allowedTarget,
      checkoutSessionId: session.id,
      url: s(session.url),
    };
  } catch (error) {
    if (!isApiAuthError(error) && !(error instanceof BillingOperationError)) {
      logBillingFailure("upgrade", { targetPlan: requestedTarget, billing }, error);
    }
    throw error;
  }
}

export async function scheduleBillingDowngrade(args: {
  request: Request;
  targetPlan: unknown;
  billing: unknown;
}): Promise<BillingDowngradeResult> {
  const requestedTarget = normalizeDowngradeTarget(args.targetPlan);
  const billing = normalizeBilling(args.billing);

  try {
    if (!requestedTarget) {
      throw new BillingOperationError(
        "INVALID_DOWNGRADE_TARGET",
        400,
        'targetPlan must be "premium" or "free".',
      );
    }

    const actor = await requireBillingActor(args.request);
    const planResolution = await resolveBillingPlanResolution({
      accountId: actor.accountId,
      repair: true,
    });
    const currentPlanId = planResolution.currentPlanId;
    const allowedTarget = allowedDowngradeTarget(currentPlanId, requestedTarget);

    if (!allowedTarget) {
      throw new BillingOperationError(
        "INVALID_DOWNGRADE_TARGET",
        400,
        `Cannot downgrade from ${currentPlanId} to ${requestedTarget}.`,
      );
    }

    const latestSubscription = await readLatestBillingSubscription(actor.accountId, { provider: "stripe" });
    const stripeSubscriptionId = activeStripeSubscriptionId(
      latestSubscription?.status,
      latestSubscription?.stripeSubscriptionId,
    );

    if (!stripeSubscriptionId) {
      throw new BillingOperationError(
        "NO_STRIPE_SUBSCRIPTION",
        409,
        "No active Stripe subscription found to downgrade.",
      );
    }

    const stripe = await getStripe();
    const subscription = (await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ["items.data.price"],
    })) as Stripe.Subscription;
    const firstItem = subscription.items?.data?.[0] || null;
    const firstItemRecord = (firstItem ?? {}) as unknown as Record<string, unknown>;
    const startSec = typeof firstItemRecord.current_period_start === "number" ? firstItemRecord.current_period_start : null;
    const endSec = typeof firstItemRecord.current_period_end === "number" ? firstItemRecord.current_period_end : null;
    const periodEnd = endSec ? new Date(endSec * 1000) : null;
    const now = new Date();

    if (allowedTarget === "free") {
      await stripe.subscriptions.update(subscription.id, {
        cancel_at_period_end: true,
        metadata: {
          cavbot_account_id: actor.accountId,
          cavbot_downgrade_to: "free",
        },
      });

      await setPendingDowngradeState(actor.accountId, {
        planId: "free",
        billing,
        scheduledAt: now,
        effectiveAt: periodEnd,
      });

      await auditLogWrite({
        request: args.request,
        action: "PLAN_DOWNGRADED",
        accountId: actor.accountId,
        operatorUserId: actor.operatorUserId,
        targetType: "billing",
        targetId: actor.accountId,
        targetLabel: actor.accountId,
        metaJson: {
          billing_event: "downgrade_scheduled_stripe_cancel_at_period_end",
          oldPlan: currentPlanId,
          newPlan: "free",
          scheduledAt: now.toISOString(),
          effectiveAt: periodEnd ? periodEnd.toISOString() : null,
          stripeSubscriptionId: subscription.id,
        },
      });

      const redirectUrl = `${getAppUrl()}/settings?tab=billing`;
      return {
        ok: true,
        scheduled: {
          toPlan: "free",
          effectiveAt: periodEnd?.toISOString() ?? null,
        },
        redirectUrl,
        url: redirectUrl,
      };
    }

    const currentPriceId = s(firstItem?.price?.id);
    if (!currentPriceId) {
      throw new BillingOperationError(
        "SUBSCRIPTION_ITEM_MISSING",
        409,
        "Stripe subscription has no price item.",
      );
    }
    if (!startSec || !endSec) {
      throw new BillingOperationError("NO_PERIOD_WINDOW", 409, "Stripe subscription missing period window.");
    }

    const targetPriceId = priceIdFor("premium", toStripeBilling(billing));
    let scheduleId: string | null = null;

    if (typeof subscription.schedule === "string") {
      scheduleId = subscription.schedule;
    } else if (subscription.schedule && typeof subscription.schedule === "object" && "id" in subscription.schedule) {
      const maybeId = (subscription.schedule as { id?: unknown }).id;
      scheduleId = typeof maybeId === "string" ? maybeId : null;
    }
    if (!scheduleId) {
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: subscription.id,
      });
      scheduleId = schedule?.id ?? null;
    }
    if (!scheduleId) {
      throw new BillingOperationError("NO_STRIPE_SCHEDULE", 409, "Failed to create Stripe subscription schedule.");
    }

    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases: [
        { items: [{ price: currentPriceId, quantity: 1 }], start_date: startSec, end_date: endSec },
        { items: [{ price: targetPriceId, quantity: 1 }], start_date: endSec },
      ],
      metadata: {
        cavbot_account_id: actor.accountId,
        cavbot_downgrade_to: "premium",
      },
    });

    await setPendingDowngradeState(actor.accountId, {
      planId: "premium",
      billing,
      scheduledAt: now,
      effectiveAt: periodEnd,
    });

    await auditLogWrite({
      request: args.request,
      action: "PLAN_DOWNGRADED",
      accountId: actor.accountId,
      operatorUserId: actor.operatorUserId,
      targetType: "billing",
      targetId: actor.accountId,
      targetLabel: actor.accountId,
      metaJson: {
        billing_event: "downgrade_scheduled_stripe_subscription_schedule",
        oldPlan: currentPlanId,
        newPlan: "premium",
        scheduledAt: now.toISOString(),
        effectiveAt: periodEnd ? periodEnd.toISOString() : null,
        stripeSubscriptionId: subscription.id,
        stripeScheduleId: scheduleId,
        targetPriceId,
      },
    });

    const redirectUrl = `${getAppUrl()}/settings?tab=billing`;
    return {
      ok: true,
      scheduled: {
        toPlan: "premium",
        effectiveAt: periodEnd?.toISOString() ?? null,
      },
      redirectUrl,
      url: redirectUrl,
    };
  } catch (error) {
    if (!isApiAuthError(error) && !(error instanceof BillingOperationError)) {
      logBillingFailure("downgrade", { targetPlan: requestedTarget, billing }, error);
    }
    throw error;
  }
}

export function publicBillingError(error: unknown, fallback: BillingErrorFallback) {
  if (isApiAuthError(error)) {
    return {
      status: error.status,
      error: error.code,
      message: error.message,
    };
  }

  if (error instanceof BillingOperationError) {
    return {
      status: error.status,
      error: error.code,
      message: error.message,
    };
  }

  return {
    status: fallback.status ?? 500,
    error: fallback.code,
    message: fallback.message,
  };
}
