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

type CheckoutResponseData = Record<string, unknown>;
function json(data: CheckoutResponseData, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await readSanitizedJson(req, null)) as null | { targetPlan?: string; billing?: string };
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
