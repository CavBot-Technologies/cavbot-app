// app/api/billing/invoices/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripeClient";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function toIso(d: Date) {
  try {
    return new Date(d).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function fmtMoney(cents: number | null | undefined, currency: string | null | undefined) {
  const cur = safeStr(currency || "usd").toUpperCase();
  const c = typeof cents === "number" ? cents : 0;
  const amt = (c / 100).toFixed(2);
  return `$${amt} ${cur}`;
}

type InvoiceMeta = Record<string, unknown>;

type InvoiceRow = {
  id: string;
  createdAt: string;
  title: string;
  amount: string;
  status: "posted" | "scheduled" | "archived" | "failed";
  downloadUrl?: string | null; // NEW (your UI should prefer this)
  meta?: InvoiceMeta;
};

function mapStripeInvoiceStatus(inv: Stripe.Invoice): InvoiceRow["status"] {
  const status = safeStr(inv.status).toLowerCase(); // draft/open/paid/uncollectible/void
  if (status === "paid") return "posted";
  if (status === "void" || status === "uncollectible") return "archived";
  if (status === "open" || status === "draft") return "scheduled";
  return "scheduled";
}

function downloadRouteForInvoiceId(invoiceId: string) {
  const id = s(invoiceId);
  if (!id) return null;
  return `/api/billing/invoices/${encodeURIComponent(id)}/download`;
}

function hasStripeSecret() {
  return Boolean(s(process.env.STRIPE_SECRET_KEY));
}

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, stripeCustomerId: true },
    });

    // ----------------------------
    // A) PRIMARY: Stripe invoices
    // ----------------------------
    const stripeCustomerId = safeStr(account?.stripeCustomerId);
    const stripeRows: InvoiceRow[] = [];

    if (stripeCustomerId && hasStripeSecret()) {
      try {
        const invoices = (await getStripe().invoices.list({
          customer: stripeCustomerId,
          limit: 20,
        })) as Stripe.ApiList<Stripe.Invoice>;

        for (const inv of invoices.data) {
          const number = safeStr(inv.number) || safeStr(inv.id);
          const createdAtIso = inv.created ? new Date(inv.created * 1000).toISOString() : new Date().toISOString();

          const cents =
            typeof inv.amount_paid === "number"
              ? inv.amount_paid
              : typeof inv.amount_due === "number"
              ? inv.amount_due
              : typeof inv.total === "number"
              ? inv.total
              : 0;

          const currency = safeStr(inv.currency || "usd");
          const status = mapStripeInvoiceStatus(inv);

          stripeRows.push({
            id: safeStr(inv.id),
            createdAt: createdAtIso,
            title: number ? `Invoice ${number}` : "Invoice",
            amount: fmtMoney(cents, currency),
            status,
            downloadUrl: downloadRouteForInvoiceId(String(inv.id)),
            meta: {
              stripeInvoiceId: inv.id,
              number: inv.number || null,
              invoicePdfUrl: inv.invoice_pdf || null,
              hostedInvoiceUrl: inv.hosted_invoice_url || null,
              status: inv.status || null,
            },
          });
        }
      } catch (error) {
        console.error("[billing/invoices] stripe invoice lookup failed", error);
      }
    }

    // -----------------------------------------
    // B) FALLBACK: AuditLog “billing events”
    // -----------------------------------------
    const logs = await prisma.auditLog
      .findMany({
        where: {
          accountId,
          metaJson: {
            path: ["billing_event"],
            not: Prisma.JsonNull,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, createdAt: true, metaJson: true },
      })
      .catch((error) => {
        console.error("[billing/invoices] audit billing-event lookup failed", error);
        return [];
      });

    const auditRows: InvoiceRow[] = [];

    for (const l of logs) {
      const meta = (l.metaJson ?? {}) as InvoiceMeta;
      const evt = safeStr(meta?.billing_event);
      if (!evt) continue;

      // Helpers for audit rows
        const stripeInvoiceId = s(meta?.stripeInvoiceId || "");
      const downloadUrl = stripeInvoiceId ? downloadRouteForInvoiceId(stripeInvoiceId) : null;

      if (evt === "upgrade_applied") {
        const toPlan = safeStr(meta?.toPlan || "").toUpperCase() || "UPGRADE";
        const billing = safeStr(meta?.billing || "");
        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Upgrade applied → ${toPlan}${billing ? ` (${billing})` : ""}`,
          amount: "—",
          status: "posted",
          downloadUrl: null,
          meta,
        });
        continue;
      }

      if (evt === "downgrade_scheduled") {
        const toPlan = safeStr(meta?.toPlan || "").toUpperCase() || "DOWNGRADE";
        const effectiveAt = safeStr(meta?.effectiveAt || "");
        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Downgrade scheduled → ${toPlan}${effectiveAt ? ` (effective ${new Date(effectiveAt).toLocaleDateString()})` : ""}`,
          amount: "—",
          status: "scheduled",
          downloadUrl: null,
          meta,
        });
        continue;
      }

      if (evt === "downgrade_canceled") {
        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Downgrade canceled`,
          amount: "—",
          status: "archived",
          downloadUrl: null,
          meta,
        });
        continue;
      }

      if (evt === "stripe_invoice_paid") {
        // If webhook logged amountPaid/currency, show it.
        const amountPaid = typeof meta?.amountPaid === "number" ? meta.amountPaid : null;
        const currency = s(meta?.currency || "usd") || "usd";

        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Stripe invoice paid`,
          amount: amountPaid == null ? "—" : fmtMoney(amountPaid, currency),
          status: "posted",
          downloadUrl,
          meta,
        });
        continue;
      }

      if (evt === "stripe_invoice_payment_failed") {
        const amountDue = typeof meta?.amountDue === "number" ? meta.amountDue : null; // optional if you log it later
        const currency = s(meta?.currency || "usd") || "usd";

        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Stripe payment failed`,
          amount: amountDue == null ? "—" : fmtMoney(amountDue, currency),
          status: "failed",
          downloadUrl,
          meta,
        });
        continue;
      }

      if (evt === "stripe_subscription_sync") {
        const planId = safeStr(meta?.planId || "");
        const billing = safeStr(meta?.billing || "");
        const status = safeStr(meta?.status || "");
        auditRows.push({
          id: l.id,
          createdAt: toIso(l.createdAt),
          title: `Stripe subscription sync${planId ? ` → ${planId}` : ""}${billing ? ` (${billing})` : ""}${status ? ` · ${status}` : ""}`,
          amount: "—",
          status: "archived",
          downloadUrl: null,
          meta,
        });
        continue;
      }
    }

    // Merge (Stripe invoices first, audit events after). De-dupe by id.
    const seen = new Set<string>();
    const merged: InvoiceRow[] = [];

    for (const r of [...stripeRows, ...auditRows]) {
      const id = safeStr(r.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(r);
    }

    return json({ ok: true, invoices: merged }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "BILLING_INVOICES_FAILED", message: "Failed to load invoices." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" } });
}

export async function POST() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}
