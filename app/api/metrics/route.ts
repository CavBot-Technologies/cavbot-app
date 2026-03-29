// app/api/metrics/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getLatestPackWithHistory, normalizeOriginStrict } from "@/lib/cavai/packs.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const origin = normalizeOriginStrict(req.nextUrl.searchParams.get("origin"));
    if (!origin) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_ORIGIN",
          message: "origin query param is required.",
        },
        400
      );
    }

    const data = await getLatestPackWithHistory({
      accountId: String(session.accountId || ""),
      origin,
      limit: 6,
    });

    if (!data.pack) {
      return json(
        {
          ok: false,
          requestId,
          error: "INSUFFICIENT_DATA",
          message: "No persisted CavAi runs exist for this origin yet.",
          history: data.history,
        },
        200
      );
    }

    const topPriority = data.pack.priorities?.[0] || null;
    return json(
      {
        ok: true,
        requestId,
        origin,
        generatedAt: data.pack.generatedAt,
        engineVersion: data.pack.engineVersion,
        findings: data.pack.core.findings.length,
        priorities: data.pack.priorities.length,
        topPriorityCode: topPriority?.code || null,
        topPriorityScore: Number.isFinite(Number(topPriority?.priorityScore))
          ? Number(topPriority?.priorityScore)
          : null,
        confidenceLevel: data.pack.confidence.level,
        confidenceReason: data.pack.confidence.reason,
        riskLevel: data.pack.risk.level,
        riskReason: data.pack.risk.reason,
        trend: data.pack.overlay?.trend || null,
        fatigue: data.pack.overlay?.fatigue || null,
        history: data.history,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to load metrics";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}
