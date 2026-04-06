// app/api/billing/checkout/route.ts
import "server-only";


import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import crypto from "crypto";


import { prisma } from "@/lib/prisma";
import {
  requireSession,
  isApiAuthError,
} from "@/lib/apiAuth";
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


type CheckoutBody = {
  targetPlan?: string;
  billing?: string;
};


function readIdempotencyKey(req: NextRequest) {
  // Optional: client may pass X-Idempotency-Key for safe retries
  const k = s(req.headers.get("x-idempotency-key"));
  if (k) return k;


  // Fallback: stable-per-request key (prevents accidental duplicates on retries from the same client request body)
  // NOTE: Not stable across separate clicks (by design).
  return crypto.randomUUID();
}


export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);


    const body = (await readSanitizedJson(req, null)) as CheckoutBody | null;


    const planId = normalizePlan(body?.targetPlan);
    if (!planId) return json({ ok: false, error: "BAD_INPUT", message: "Missing/invalid targetPlan." }, 400);


    const billing = normalizeBilling(body?.billing);
    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;


    const appUrl = getAppUrl();
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/billing/failed?canceled=1&plan=${encodeURIComponent(planId)}&billing=${encodeURIComponent(billing)}`;


    const [account, user] = await Promise.all([
      prisma.account.findUnique({
        where: { id: accountId },
        select: { id: true, name: true, slug: true, stripeCustomerId: true, billingEmail: true },
      }),
      prisma.user.findUnique({
        where: { id: operatorUserId },
        select: { id: true, email: true, displayName: true },
      }),
    ]);


    if (!account) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);
    if (!user?.email) return json({ ok: false, error: "USER_NOT_FOUND", message: "User not found." }, 404);


    let stripeCustomerId = account?.stripeCustomerId ? String(account.stripeCustomerId).trim() : "";


    if (!stripeCustomerId) {
      const email =
        account?.billingEmail || user.email ? String(account?.billingEmail || user.email).trim() : undefined;
      const name =
        account?.name || user.displayName || user.email ? String(account?.name || user.displayName || user.email).trim() : undefined;

      const metadata: Record<string, string> = {
        cavbot_account_id: accountId,
      };
      if (account?.slug) metadata.cavbot_account_slug = String(account.slug).trim();

      const customerParams: Stripe.CustomerCreateParams = {
        email,
        name,
        metadata,
      };


      const customer = await getStripe().customers.create(customerParams, {
        idempotencyKey: `cavbot_customer_${accountId}`,
      });


      stripeCustomerId = customer.id;


      await prisma.account.update({
        where: { id: accountId },
        data: { stripeCustomerId },
      });
    }


    const priceId = priceIdFor(planId, billing);
    const idem = readIdempotencyKey(req);


    const session = await getStripe().checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,


        // Make Stripe collect/update what it needs without you touching PAN data.
        billing_address_collection: "auto",
        customer_update: { name: "auto", address: "auto" },


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
      },
      { idempotencyKey: `cavbot_checkout_${accountId}_${planId}_${billing}_${idem}` }
    );


    return json({ ok: true, checkoutSessionId: session.id, url: session.url }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "CHECKOUT_FAILED", message: "Failed to create checkout session." }, 500);
  }
}


export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}


export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
