import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { findUserById, getAuthPool } from "@/lib/authDb";
import { ensureBillingStripeCustomerBinding, readBillingAccount } from "@/lib/billingRuntime.server";
import { getStripe } from "@/lib/stripeClient";
import { getAppUrl, priceIdFor, type StripePlanId, type StripeBilling } from "@/lib/stripe";
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

type CheckoutResponseData = Record<string, unknown>;
function json(data: CheckoutResponseData, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function normalizePlan(raw: unknown): StripePlanId | null {
  const v = s(raw).toLowerCase();
  if (v === "premium") return "premium";
  if (v === "premium_plus" || v === "premium+") return "premium_plus";
  return null;
}

function normalizeBilling(raw: unknown): StripeBilling {
  const v = s(raw).toLowerCase();
  return v.includes("annual") || v.includes("year") ? "annual" : "monthly";
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const body = (await readSanitizedJson(req, null)) as null | { targetPlan?: string; billing?: string };

    const planId = normalizePlan(body?.targetPlan);
    if (!planId) return json({ ok: false, error: "BAD_INPUT", message: "Missing/invalid targetPlan." }, 400);

    const billing = normalizeBilling(body?.billing);
    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;

    const appUrl = getAppUrl();
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/billing/cancel`;

      const [account, user] = await Promise.all([
        readBillingAccount(accountId),
        findUserById(getAuthPool(), operatorUserId),
      ]);

    if (!account) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);
    if (!user?.email) return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);

      let stripeCustomerId = s(account?.stripeCustomerId);

    if (!stripeCustomerId) {
        const customerParams: Stripe.CustomerCreateParams = {
          email: s(user.email) || undefined,
          name: s(account?.name || user.displayName || user.email) || undefined,
          metadata: {
            cavbot_account_id: String(accountId),
            cavbot_account_slug: s(account?.slug),
          },
        };

      const customer = await (await getStripe()).customers.create(customerParams);
      stripeCustomerId = customer.id;

        await ensureBillingStripeCustomerBinding(accountId, stripeCustomerId);
    }

    const priceId = priceIdFor(planId, billing);

    const session = await (await getStripe()).checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: String(accountId),
      metadata: {
        cavbot_account_id: String(accountId),
        cavbot_plan_id: planId,
        cavbot_billing: billing,
        cavbot_operator_user_id: String(operatorUserId),
      },
      subscription_data: {
        metadata: {
          cavbot_account_id: String(accountId),
          cavbot_plan_id: planId,
          cavbot_billing: billing,
        },
      },
    });

    return json({ ok: true, checkoutSessionId: session.id, url: session.url }, 200);
  } catch (e: unknown) {
    if (isApiAuthError(e)) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: "CHECKOUT_FAILED", message: "Failed to create checkout session." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
