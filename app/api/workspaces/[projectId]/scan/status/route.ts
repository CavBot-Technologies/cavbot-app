import "server-only";

import { NextResponse } from "next/server";
import { getPlanLimits, PLANS } from "@/lib/plans";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function GET(req: Request, ctx: unknown) {
  void req;
  void ctx;

  const planId = "free";
  const limits = getPlanLimits(planId);
  return json({
    ok: true,
    degraded: true,
    status: {
      usage: {
        planId,
        planLabel: PLANS[planId].tierLabel,
        scansThisMonth: 0,
        scansPerMonth: limits.scansPerMonth,
        pagesPerScan: limits.pagesPerScan,
      },
      lastJob: null,
    },
  }, 200);
}
