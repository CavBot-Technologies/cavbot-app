// app/api/billing/checkout-session/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripeClient";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { resolveBillingAccountContext } from "@/lib/billingAccount.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: { ...NO_STORE_HEADERS, ...(extraHeaders || {}) },
  });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function toUpper(v: unknown, fallback: string) {
  const x = s(v);
  return x ? x.toUpperCase() : fallback;
}

/**
 * Returns a human-safe "paymentMethod" label for UI:
 * - apple_pay
 * - google_pay
 * - link
 * - card
 * - (fallback) first payment_method_types entry
 */
function detectPaymentMethodLabel(args: {
  paymentIntent?: Stripe.PaymentIntent | null;
  charge?: Stripe.Charge | null;
}): string {
  const pi = args.paymentIntent;
  const ch = args.charge;

  // Prefer Charge details if available (most accurate; includes wallets)
  const pmd = ch?.payment_method_details;
  const type = s(pmd?.type);

  if (type === "card") {
    const walletType = s(pmd?.card?.wallet?.type); // apple_pay | google_pay | link | ...
    if (walletType) return walletType; // matches your UI mappings
    return "card";
  }

  if (type) return type;

  // Fallback: PI payment_method_types (less precise; doesn't always reveal wallet)
  const first = pi?.payment_method_types?.[0];
  return s(first) || "card";
}

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);

    const { searchParams } = new URL(req.url);
    const sessionId = s(searchParams.get("session_id"));
    if (!sessionId) return json({ ok: false, error: "MISSING_SESSION" }, 400);

    const checkout = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["invoice", "payment_intent"],
    });

    if (!checkout || checkout.mode !== "subscription") {
      return json({ ok: false, error: "INVALID_SESSION" }, 400);
    }

    // HARD SAFETY: ensure session belongs to this account (your metadata contract)
    const metaAccountId = s(checkout.metadata?.cavbot_account_id);
    if (!metaAccountId || metaAccountId !== billingCtx.accountId) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    // Stripe objects
    const invoice = typeof checkout.invoice === "object" ? checkout.invoice : null;
    const paymentIntent = typeof checkout.payment_intent === "object" ? checkout.payment_intent : null;

    // Invoice might not be ready immediately; return retryable signal for the client poll loop
    const invoiceId = invoice?.id ? s(invoice.id) : "";
    if (!invoiceId) {
      return json(
        {
          ok: false,
          error: "INVOICE_NOT_READY",
          retryable: true,
          status: checkout.payment_status,
        },
        202
      );
    }

    // Pull best invoice fields
    const invoiceNumber = invoice?.number ? s(invoice.number) : "—";
    const amountPaidCents = typeof invoice?.amount_paid === "number" ? invoice.amount_paid : null;
    const amountTotalCents = typeof invoice?.total === "number" ? invoice.total : null;

    // Prefer amount_paid when available; fall back to total
    const cents = amountPaidCents ?? amountTotalCents ?? 0;

    const currency = toUpper(invoice?.currency, "USD");

    const createdAtMs = typeof invoice?.created === "number" ? invoice.created * 1000 : Date.now();
    const paidAtMs =
      typeof invoice?.status_transitions?.paid_at === "number"
        ? invoice.status_transitions?.paid_at * 1000
        : null;

    const invoicePdfUrl =
      s(invoice?.invoice_pdf) ||
      s(invoice?.hosted_invoice_url) ||
      "";

    // Payment method detection (wallet-aware)
    let charge: Stripe.Charge | null = null;
    try {
      const latestChargeId = typeof paymentIntent?.latest_charge === "string" ? paymentIntent.latest_charge : "";
      if (latestChargeId) {
        charge = await getStripe().charges.retrieve(latestChargeId, {
          expand: ["payment_method"],
        });
      }
    } catch {
      charge = null;
    }

    const paymentMethod = detectPaymentMethodLabel({ paymentIntent, charge });

    // Plan/billing from your metadata (authoritative for UI copy)
    const plan = s(checkout.metadata?.cavbot_plan_id) || "premium";
    const billing = s(checkout.metadata?.cavbot_billing) || "monthly";

    // Status
    const status = s(checkout.payment_status) || "unknown";

    return json({
      ok: true,

      status, // paid | unpaid | no_payment_required | ...
      plan,
      billing,

      invoiceId: invoiceId || null,
      invoiceNumber,

      amount: Number(cents) / 100,
      currency,

      createdAt: createdAtMs,
      paidAt: paidAtMs,

      paymentMethod, // apple_pay | google_pay | link | card | ...
      invoicePdfUrl: invoicePdfUrl || null,
    });
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "FAILED" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}

export async function POST() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, OPTIONS" });
}
