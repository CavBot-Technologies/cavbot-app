import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  getAiSessionForAccount,
  updateAiMessageFeedback,
  type AiMessageFeedbackAction,
} from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { AiServiceError } from "@/src/lib/ai/ai.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const FEEDBACK_ACTIONS = new Set<AiMessageFeedbackAction>([
  "copy",
  "share",
  "retry",
  "like",
  "dislike",
  "clear_reaction",
]);

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

function toGuardSurface(surface: string): "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode" {
  const raw = s(surface).toLowerCase();
  if (raw === "cavcloud" || raw === "cavsafe" || raw === "cavpad" || raw === "cavcode") return raw;
  return "console";
}

function guardActionForSurface(surface: "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode"): string {
  if (surface === "cavcode") return "explain_error";
  if (surface === "cavcloud") return "recommend_organization";
  if (surface === "cavsafe") return "explain_access_state";
  if (surface === "cavpad") return "technical_summary";
  return "summarize_posture";
}

export async function POST(
  req: NextRequest,
  ctx: {
    params: Promise<{
      sessionId?: string;
      messageId?: string;
    }>;
  }
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        {
          ok: false,
          requestId,
          error: "BAD_CSRF",
          message: "Missing request integrity header.",
        },
        403
      );
    }

    const params = await ctx.params;
    const sessionId = s(params.sessionId);
    const messageId = s(params.messageId);
    if (!sessionId || !messageId) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "sessionId and messageId are required.",
        },
        400
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};
    const actionRaw = s(body.action).toLowerCase();
    if (!FEEDBACK_ACTIONS.has(actionRaw as AiMessageFeedbackAction)) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid feedback action.",
        },
        400
      );
    }

    const aiCtx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const session = await getAiSessionForAccount({
      accountId: aiCtx.accountId,
      sessionId,
    });
    const guardSurface = toGuardSurface(session.surface);
    await resolveAiExecutionPolicy({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memberRole: aiCtx.memberRole,
      planId: aiCtx.planId,
      surface: guardSurface,
      action: guardActionForSurface(guardSurface),
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "session_message_feedback_access",
      context: {
        feedbackAction: actionRaw,
      },
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const feedback = await updateAiMessageFeedback({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      sessionId,
      messageId,
      action: actionRaw as AiMessageFeedbackAction,
    });

    return json(
      {
        ok: true,
        requestId,
        sessionId,
        messageId,
        feedback,
      },
      200
    );
  } catch (error) {
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
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
