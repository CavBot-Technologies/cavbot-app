// app/api/billing/checkout/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { beginBillingUpgrade, publicBillingError } from "@/lib/billingFlow.server";
import { readSanitizedJson } from "@/lib/security/userInput";

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
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

type CheckoutBody = {
  targetPlan?: string;
  billing?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await readSanitizedJson(req, null)) as CheckoutBody | null;
    const result = await beginBillingUpgrade({
      request: req,
      targetPlan: body?.targetPlan,
      billing: body?.billing,
    });
    return json(result, 200);
  } catch (error) {
    const issue = publicBillingError(error, {
      code: "CHECKOUT_FAILED",
      message: "Failed to create checkout session.",
    });
    return json({ ok: false, error: issue.error, message: issue.message }, issue.status);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "POST, OPTIONS" } });
}
