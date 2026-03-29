import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { listAiAgentJobEvents } from "@/src/lib/ai/ai.agent-jobs";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

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

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(1, Math.min(240, Math.trunc(parsed)));
}

export async function GET(req: NextRequest, ctx: { params: { jobId: string } }) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await requireAiRequestContext({ req, surface: "console" });
    const url = new URL(req.url);
    const events = await listAiAgentJobEvents({
      accountId: auth.accountId,
      userId: auth.userId,
      jobId: s(ctx.params.jobId),
      limit: toLimit(url.searchParams.get("limit")),
    });
    return json({
      ok: true,
      requestId,
      events,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to list agent job events.";
    return json({
      ok: false,
      requestId,
      error: "AI_AGENT_JOB_EVENTS_FAILED",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
