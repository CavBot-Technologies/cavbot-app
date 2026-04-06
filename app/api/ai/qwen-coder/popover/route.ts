import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  buildQwenCoderPopoverFallbackState,
  getQwenCoderPopoverState,
  isQwenCoderCreditSchemaMismatchError,
} from "@/src/lib/ai/qwen-coder-credits.server";
import { ALIBABA_QWEN_CODER_MODEL_ID } from "@/src/lib/ai/model-catalog";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : (init || {});
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function buildPopoverPayload(args: {
  requestId: string;
  state: Awaited<ReturnType<typeof getQwenCoderPopoverState>>;
  ctx: Awaited<ReturnType<typeof requireAiRequestContext>>;
  degraded?: boolean;
}) {
  const nextActionId = args.state.entitlement.nextActionId;
  const guardDecision = nextActionId
    ? buildGuardDecisionPayload({
        actionId: nextActionId,
        role: args.ctx.memberRole || undefined,
        plan: args.ctx.planId === "premium_plus" ? "PREMIUM_PLUS" : args.ctx.planId === "premium" ? "PREMIUM" : "FREE",
        flags: {
          qwenResetAt: args.state.entitlement.resetAt,
          qwenCooldownEndsAt: args.state.entitlement.cooldownEndsAt,
          qwenCoderEntitlement: args.state.entitlement,
        },
      })?.guardDecision || null
    : null;

  return {
    ok: true,
    ...(args.degraded ? { degraded: true } : {}),
    requestId: args.requestId,
    qwenCoder: args.state,
    guardDecision,
    modelAvailability: {
      [ALIBABA_QWEN_CODER_MODEL_ID]: {
        selectable: args.state.entitlement.selectable,
        state: args.state.entitlement.state,
        nextActionId: args.state.entitlement.nextActionId,
      },
    },
  };
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const sessionId = s(new URL(req.url).searchParams.get("sessionId")) || null;
    const ctx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    try {
      const state = await getQwenCoderPopoverState({
        accountId: ctx.accountId,
        userId: ctx.userId,
        planId: ctx.planId,
        sessionId,
      });
      return json(buildPopoverPayload({ requestId, state, ctx }));
    } catch (error) {
      if (!isQwenCoderCreditSchemaMismatchError(error)) throw error;
      console.warn("[qwen-coder/popover] degraded to fallback state", error);
      const state = buildQwenCoderPopoverFallbackState({
        planId: ctx.planId,
      });
      return json(buildPopoverPayload({ requestId, state, ctx, degraded: true }));
    }
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code, message: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to load Caven usage.";
    return json({ ok: false, requestId, error: "QWEN_CODER_POPOVER_FAILED", message }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
