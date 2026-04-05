// app/api/billing/payment-method/route.ts
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

function s(value: unknown) {
  return String(value ?? "").trim();
}

function hasStripeSecret() {
  return Boolean(s(process.env.STRIPE_SECRET_KEY));
}
 
 
function readIdem(req: NextRequest, fallbackPrefix: string) {
  const header = s(req.headers.get("x-idempotency-key"));
  return header ? `${fallbackPrefix}_${header}` : `${fallbackPrefix}_${crypto.randomUUID()}`;
}

type PaymentMethodSummary = {
  ok: true;
  hasPaymentMethod: boolean;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  billingName: string | null;
};
 
 
function pmEmpty(): PaymentMethodSummary {
  return {
    ok: true,
    hasPaymentMethod: false,
    brand: null,
    last4: null,
    expMonth: null,
    expYear: null,
    billingName: null,
  };
}
 
 
function pmFromCard(pm: Stripe.PaymentMethod): PaymentMethodSummary {
  const card = pm.card ?? null;
  return {
    ok: true,
    hasPaymentMethod: true,
    brand: card?.brand ? s(card.brand) : null,
    last4: card?.last4 ? s(card.last4) : null,
    expMonth: typeof card?.exp_month === "number" ? card.exp_month : null,
    expYear: typeof card?.exp_year === "number" ? card.exp_year : null,
    billingName: pm.billing_details?.name ? s(pm.billing_details.name) : null,
  };
}
 
 
async function ensureStripeCustomer(args: {
  accountId: string;
  email?: string | null;
  name?: string | null;
  address?: Stripe.AddressParam | null;
}) {
  const account = await prisma.account.findUnique({
    where: { id: args.accountId },
    select: {
      id: true,
      name: true,
      slug: true,
      stripeCustomerId: true,
      billingEmail: true,
    },
  });
  if (!account) throw Object.assign(new Error("Account not found."), { status: 404 });

  let customerId = s(account.stripeCustomerId);
  const email = s(args.email) || s(account.billingEmail) || undefined;
  const name = s(args.name) || s(account.name) || undefined;
 
 
  if (!customerId) {
    const customer = await getStripe().customers.create(
      {
        email,
        name,
        address: args.address || undefined,
          metadata: {
            cavbot_account_id: String(args.accountId),
            cavbot_account_slug: s(account.slug || ""),
          },
      },
      { idempotencyKey: `cavbot_customer_${args.accountId}` }
    );
 
 
    customerId = customer.id;
 
 
    await prisma.account.update({
      where: { id: args.accountId },
      data: { stripeCustomerId: customerId },
    });
 
 
    return customerId;
  }
 
 
  // Keep Stripe customer profile current (invoice appearance + risk checks)
  if (email || name || args.address) {
    await getStripe().customers.update(customerId, {
      email,
      name,
      address: args.address || undefined,
    });
  }
 
 
  return customerId;
}
 
 
export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);

    if (!hasStripeSecret()) return json(pmEmpty(), 200);

    const accountId = billingCtx.accountId;
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { stripeCustomerId: true },
    });

    const customerId = s(account?.stripeCustomerId);
    if (!customerId) return json(pmEmpty(), 200);

    let customer: Stripe.Customer | Stripe.DeletedCustomer;
    try {
      customer = await getStripe().customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
    } catch (error) {
      console.error("[billing/payment-method] stripe customer lookup failed", error);
      return json(pmEmpty(), 200);
    }

    if ("deleted" in customer && customer.deleted) return json(pmEmpty(), 200);

    const paymentMethod = customer.invoice_settings?.default_payment_method as
      | Stripe.PaymentMethod
      | string
      | null;
    if (typeof paymentMethod === "string") return json(pmEmpty(), 200);
    if (!paymentMethod || paymentMethod.type !== "card") return json(pmEmpty(), 200);

    return json(pmFromCard(paymentMethod), 200);
  } catch (error: unknown) {
    if (isApiAuthError(error) && error.code === "ACCOUNT_CONTEXT_REQUIRED") return json(pmEmpty(), 200);
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "PAYMENT_METHOD_FETCH_FAILED", message: "Failed to load payment method." }, 500);
  }
}
 
 
/**
 * POST supports 2 modes:
 * A) Create SetupIntent
 *    Body: { name?: string, address?: {...} }
 *    -> { ok:true, clientSecret }
 *
 * B) Finalize default payment method
 *    Body: { setupIntentId: string }
 *    -> returns fresh PaymentMethodSummary (so CavCard updates instantly)
 */
export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);
 
 
    const accountId = billingCtx.accountId;
    const operatorUserId = billingCtx.userId;
 
 
    type BodyAddress = {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postal_code?: string;
      country?: string;
    };

    type PaymentMethodBody =
      | {
          setupIntentId: string;
        }
      | {
          name?: string;
          address?: BodyAddress;
          setupIntentId?: undefined;
        };

    const body = (await readSanitizedJson(req, null)) as null | PaymentMethodBody;
 
 
    // -----------------------
    // Mode B: finalize default PM
    // -----------------------
    const setupIntentId = s(body?.setupIntentId);
    if (setupIntentId) {
      const si = await getStripe().setupIntents.retrieve(setupIntentId, {
        expand: ["payment_method", "customer"],
      });

      const customerId =
        typeof si.customer === "string" ? si.customer : (si.customer as Stripe.Customer)?.id || "";

      if (!customerId) return json({ ok: false, error: "NO_CUSTOMER", message: "Missing client billing profile on SetupIntent." }, 409);

      const pmObj = si.payment_method;
      const pmId = typeof pmObj === "string" ? pmObj : pmObj?.id || "";
 
 
      if (!pmId) return json({ ok: false, error: "NO_PAYMENT_METHOD", message: "SetupIntent missing payment method." }, 409);
 
 
      // Safety: ensure this customer belongs to this CavBot account.
      // If the account has no stripeCustomerId yet, bind it now.
      const acc = await prisma.account.findUnique({
        where: { id: accountId },
        select: { stripeCustomerId: true },
      });
 
 
      const expectedCustomerId = s(acc?.stripeCustomerId);
      if (expectedCustomerId && expectedCustomerId !== customerId) {
        return json({ ok: false, error: "FORBIDDEN", message: "Client billing profile mismatch." }, 403);
      }
 
 
      if (!expectedCustomerId) {
        await prisma.account.update({
          where: { id: accountId },
          data: { stripeCustomerId: customerId },
        });
      }
 
 
      // Extra safety: ensure PM belongs to this customer (wallet/card correctness)
      const pm = await getStripe().paymentMethods.retrieve(pmId);
      const pmCustomer =
        typeof pm.customer === "string" ? pm.customer : (pm.customer as Stripe.Customer)?.id || "";
      if (pmCustomer && pmCustomer !== customerId) {
        return json({ ok: false, error: "FORBIDDEN", message: "Payment method mismatch." }, 403);
      }
 
 
      await getStripe().customers.update(customerId, {
        invoice_settings: { default_payment_method: pmId },
      });
 
 
      if (accountId) {
        await auditLogWrite({
          request: req,
          action: "BILLING_UPDATED",
          accountId,
          operatorUserId,
          targetType: "billing",
          targetId: accountId,
          targetLabel: customerId,
          metaJson: {
            billing_event: "stripe_payment_method_set_default",
            stripeCustomerId: customerId,
            paymentMethodId: pmId,
            setupIntentId,
          },
        });
      }
 
 
      // Return fresh payload so BillingClient updates CavCard instantly
      if (pm.type !== "card") {
        return json(pmEmpty(), 200);
      }
      return json(pmFromCard(pm), 200);
    }
 
 
    // -----------------------
    // Mode A: create SetupIntent
    // -----------------------
    const name = s(body && "name" in body ? body.name : undefined) || null;
    const addr = body && "address" in body ? body.address : null;
 
 
    const address: Stripe.AddressParam | null = addr
      ? {
          line1: s(addr.line1) || undefined,
          line2: s(addr.line2) || undefined,
          city: s(addr.city) || undefined,
          state: s(addr.state) || undefined,
          postal_code: s(addr.postal_code) || undefined,
          country: s(addr.country) || undefined,
        }
      : null;
 
 
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { billingEmail: true, name: true },
    });
 
 
    const customerId = await ensureStripeCustomer({
      accountId,
      email: account ? s(account.billingEmail) || null : null,
      name: name || (account ? s(account.name) || null : null),
      address,
    });
 
 
    const idem = readIdem(req, `cavbot_setup_intent_${accountId}`);
 
 
    const setupIntent = await getStripe().setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { cavbot_account_id: String(accountId) },
      },
      { idempotencyKey: idem }
    );
 
 
    const clientSecret = s(setupIntent.client_secret);
    if (!clientSecret) {
      return json({ ok: false, error: "NO_CLIENT_SECRET", message: "Stripe did not return a client secret." }, 500);
    }
 
 
    return json({ ok: true, clientSecret }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "PAYMENT_METHOD_FAILED", message: "Payment method request failed." }, 500);
  }
}
 
 
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" } });
}
