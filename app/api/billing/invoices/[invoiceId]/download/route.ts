// app/api/billing/invoice/[invoiceId]/download/route.ts
import "server-only";

import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripeClient";
import { requireSession, requireAccountContext, requireAccountRole, isApiAuthError } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function s(v: unknown) {
  return String(v ?? "").trim();
}

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE_HEADERS } });
}

type DownloadParams = { invoiceId: string };

export async function GET(req: NextRequest, ctx: { params: Promise<DownloadParams> }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    await requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const accountId = s(sess.accountId);
    const params = await ctx.params;
    const invoiceId = s(params?.invoiceId);

    if (!invoiceId) return json({ ok: false, error: "MISSING_INVOICE_ID" }, 400);

    const acct = await prisma.account.findUnique({
      where: { id: accountId },
      select: { stripeCustomerId: true },
    });

    const stripeCustomerId = s(acct?.stripeCustomerId);
    if (!stripeCustomerId) return json({ ok: false, error: "NO_STRIPE_CUSTOMER" }, 409);

    // Retrieve invoice from Stripe (authoritative)
    const inv = (await getStripe().invoices.retrieve(invoiceId)) as Stripe.Invoice;

    // Ownership check: invoice.customer must match this account's Stripe customer
    const invCustomerId = typeof inv?.customer === "string" ? inv.customer : inv?.customer?.id || "";
    if (s(invCustomerId) !== stripeCustomerId) {
      return json({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const pdf = s(inv?.invoice_pdf);
    const hosted = s(inv?.hosted_invoice_url);
    const target = pdf || hosted;

    if (!target) return json({ ok: false, error: "NO_INVOICE_URL" }, 404);

    // 303 is a safe redirect for “open/download”
    return NextResponse.redirect(target, { status: 303, headers: { ...NO_STORE_HEADERS } });
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "INVOICE_DOWNLOAD_FAILED" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}

export async function POST() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
