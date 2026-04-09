// app/api/billing/checkout-embedded/route.ts
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

function json<T>(data: T, init?: number | ResponseInit) {
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

async function ensureStripeCustomer(args: { accountId: string; operatorEmail: string }) {
  const account = await readBillingAccount(args.accountId);

  if (!account) {
    const err = new Error("Account not found.");
    (err as Partial<Error & { status?: number }>).status = 404;
    throw err;
  }

  const existingCustomerId = account.stripeCustomerId ?? "";
  if (existingCustomerId) return existingCustomerId;

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

  const customer = await (await getStripe()).customers.create(customerParams);
  const stripeCustomerId = customer.id;

  await ensureBillingStripeCustomerBinding(args.accountId, stripeCustomerId);

  return stripeCustomerId;
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;

    const body = (await readSanitizedJson(req, null)) as { targetPlan?: unknown; billing?: unknown } | null;

    const planId = normalizePlan(body?.targetPlan);
    if (!planId) return json({ ok: false, error: "BAD_INPUT", message: "Missing/invalid targetPlan." }, 400);

    const billing = normalizeBilling(body?.billing);

    const operator = await findUserById(getAuthPool(), operatorUserId);
    const operatorEmail = typeof operator?.email === "string" ? operator.email : "";
    if (!operatorEmail) return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);

    const stripeCustomerId = await ensureStripeCustomer({ accountId, operatorEmail });

    const appUrl = getAppUrl();

    // Return the user to YOUR billing page (forever)
    const returnUrl = `${appUrl}/settings?tab=billing`;

    const priceId = priceIdFor(planId, billing);

    const session = await (await getStripe()).checkout.sessions.create({
      ui_mode: "embedded",
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: String(accountId),
      return_url: returnUrl,
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

    const clientSecret = typeof session.client_secret === "string" ? session.client_secret : "";
    if (!clientSecret) {
      return json({ ok: false, error: "NO_CLIENT_SECRET", message: "Stripe did not return a client secret." }, 500);
    }

    return json({ ok: true, clientSecret }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "EMBEDDED_CHECKOUT_FAILED", message: "Failed to start embedded checkout." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
