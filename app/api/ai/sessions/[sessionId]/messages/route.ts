import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { getAiSessionForAccount, listAiSessionMessages } from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  buildPassiveAiAuthRequiredPayload,
  isPassiveAiAuthRequiredError,
  readPassiveAiAuthErrorCode,
} from "@/src/lib/ai/ai.route-response";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { buildPassiveAiUnavailablePayload, isPassiveAiReadUnavailableError } from "@/src/lib/ai/ai.route-response";
import { AiServiceError } from "@/src/lib/ai/ai.types";

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

function sessionReadGuardAction(): "summarize_posture" {
  return "summarize_posture";
}

export async function GET(
  req: NextRequest,
  ctx: {
    params: Promise<{
      sessionId?: string;
    }>;
  }
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const params = await ctx.params;
    const sessionId = s(params.sessionId);
    if (!sessionId) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "sessionId is required.",
        },
        400
      );
    }

    const aiCtx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    await getAiSessionForAccount({
      accountId: aiCtx.accountId,
      sessionId,
    });
    await resolveAiExecutionPolicy({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memberRole: aiCtx.memberRole,
      planId: aiCtx.planId,
      // Message history reads are metadata access (same class as session list); keep guard neutral.
      surface: "console",
      action: sessionReadGuardAction(),
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "session_message_access",
      context: null,
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;

    const messages = await listAiSessionMessages({
      accountId: aiCtx.accountId,
      sessionId,
      userId: aiCtx.userId,
      limit,
    });

    return json(
      {
        ok: true,
        requestId,
        sessionId,
        messages,
      },
      200
    );
  } catch (error) {
    if (isPassiveAiAuthRequiredError(error)) {
      return json(buildPassiveAiAuthRequiredPayload(readPassiveAiAuthErrorCode(error)), 200);
    }
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    if (error instanceof AiServiceError) {
      const details = error.details;
      const guardDecision =
        details && typeof details === "object" && !Array.isArray(details)
          ? (details as { guardDecision?: unknown }).guardDecision
          : null;
      return json(
        {
          ok: false,
          requestId,
          error: error.code,
          message: error.message,
          ...(guardDecision && typeof guardDecision === "object" ? { guardDecision } : {}),
          ...(process.env.NODE_ENV !== "production" ? { details: error.details } : {}),
        },
        error.status
      );
    }
    if (isPassiveAiReadUnavailableError(error)) {
      return json(
        {
          ...buildPassiveAiUnavailablePayload(
            "AI_SESSION_MESSAGES_UNAVAILABLE",
            "AI session messages are temporarily unavailable."
          ),
          requestId,
        },
        503
      );
    }
    const message = error instanceof Error ? error.message : "Server error";
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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
