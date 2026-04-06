// app/api/stripe/setup-intent/route.ts
import "server-only";


import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";


import { prisma } from "@/lib/prisma";
import {
  requireSession,
  isApiAuthError,
} from "@/lib/apiAuth";
import { getStripe } from "@/lib/stripeClient";
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


function readIdempotencyKey(req: NextRequest) {
  const k = s(req.headers.get("x-idempotency-key"));
  return k || crypto.randomUUID();
}


export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    const billingCtx = await resolveBillingAccountContext(sess);
    requireBillingManageRole(billingCtx);


    const accountId = billingCtx.accountId;


  const body = (await readSanitizedJson(req, null)) as
    | null
    | {
        name?: string;
        address?: {
          line1?: string;
          line2?: string;
          city?: string;
          state?: string;
          postal_code?: string;
          country?: string;
        };
      };


    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        billingEmail: true,
        stripeCustomerId: true,
        name: true,
        slug: true,
      },
    });


    if (!account) return json({ ok: false, error: "ACCOUNT_NOT_FOUND", message: "Account not found." }, 404);


    const idem = readIdempotencyKey(req);


    let customerId = s(account.stripeCustomerId);


    if (!customerId) {
      const customer = await getStripe().customers.create(
        {
          email: s(account.billingEmail) || undefined,
          name: s(body?.name) || s(account.name) || undefined,
          address: body?.address
            ? {
                line1: s(body.address.line1) || undefined,
                line2: s(body.address.line2) || undefined,
                city: s(body.address.city) || undefined,
                state: s(body.address.state) || undefined,
                postal_code: s(body.address.postal_code) || undefined,
                country: s(body.address.country) || undefined,
              }
            : undefined,
            metadata: {
              cavbot_account_id: String(accountId),
              cavbot_account_slug: s(account.slug),
            },
        },
        { idempotencyKey: `cavbot_customer_${accountId}` }
      );


      customerId = customer.id;


      await prisma.account.update({
        where: { id: accountId },
        data: { stripeCustomerId: customerId },
      });
    } else {
      // keep Stripe customer info up to date (optional but enterprise-grade)
      const name = s(body?.name);
      const addr = body?.address;


      if (name || addr) {
        await getStripe().customers.update(customerId, {
          name: name || undefined,
          address: addr
            ? {
                line1: s(addr.line1) || undefined,
                line2: s(addr.line2) || undefined,
                city: s(addr.city) || undefined,
                state: s(addr.state) || undefined,
                postal_code: s(addr.postal_code) || undefined,
                country: s(addr.country) || undefined,
              }
            : undefined,
        });
      }
    }


    const setupIntent = await getStripe().setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: { cavbot_account_id: String(accountId) },
      },
      { idempotencyKey: `cavbot_setup_intent_${accountId}_${idem}` }
    );


    const clientSecret = s(setupIntent.client_secret);
    if (!clientSecret) {
      return json({ ok: false, error: "NO_CLIENT_SECRET", message: "Stripe did not return a client secret." }, 500);
    }


    return json({ ok: true, clientSecret }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: "SETUP_INTENT_FAILED", message: "Failed to create setup intent." }, 500);
  }
}


export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}
