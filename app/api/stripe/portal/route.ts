import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, isApiAuthError } from "@/lib/apiAuth";
import { getStripe } from "@/lib/stripeClient";
import { getAppUrl } from "@/lib/stripe";
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

function json(data: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);

    const accountId = billingCtx.accountId;
    const appUrl = getAppUrl();

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { stripeCustomerId: true },
    });

    const customer = s(account?.stripeCustomerId);
    if (!customer) {
      return json({ ok: false, error: "NO_STRIPE_CUSTOMER", message: "No billing profile found yet." }, 409);
    }

    const portal = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${appUrl}/settings?tab=billing`,
    });

    return json({ ok: true, url: portal.url }, 200);
  } catch (e) {
    if (isApiAuthError(e)) return json({ ok: false, error: e.code, message: e.message }, e.status);
    return json({ ok: false, error: "PORTAL_FAILED", message: "Failed to open billing portal." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
