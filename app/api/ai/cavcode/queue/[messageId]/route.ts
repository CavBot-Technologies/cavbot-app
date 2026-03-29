import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { cancelCavCodeQueuedPrompt, editCavCodeQueuedPrompt } from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const PATCH_SCHEMA = z.object({
  sessionId: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8_000),
});

const DELETE_SCHEMA = z.object({
  sessionId: z.string().trim().min(1).max(120),
});

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

export async function PATCH(
  req: NextRequest,
  ctx: {
    params: Promise<{ messageId?: string }>;
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
    const messageId = s(params.messageId);
    if (!messageId) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "messageId is required.",
        },
        400
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = PATCH_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid queued message edit payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const aiCtx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    await resolveAiExecutionPolicy({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memberRole: aiCtx.memberRole,
      planId: aiCtx.planId,
      surface: "cavcode",
      action: "explain_error",
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: parsed.data.prompt,
      context: null,
      imageAttachmentCount: 0,
      sessionId: parsed.data.sessionId,
      isExecution: false,
    });

    const updated = await editCavCodeQueuedPrompt({
      accountId: aiCtx.accountId,
      sessionId: parsed.data.sessionId,
      messageId,
      prompt: parsed.data.prompt,
    });

    return json(
      {
        ok: true,
        requestId,
        queuedPrompt: updated,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, requestId, error: error.code }, error.status);
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

export async function DELETE(
  req: NextRequest,
  ctx: {
    params: Promise<{ messageId?: string }>;
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
    const messageId = s(params.messageId);
    if (!messageId) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "messageId is required.",
        },
        400
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = DELETE_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid queued message delete payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const aiCtx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    await resolveAiExecutionPolicy({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memberRole: aiCtx.memberRole,
      planId: aiCtx.planId,
      surface: "cavcode",
      action: "explain_error",
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "queue_delete",
      context: null,
      imageAttachmentCount: 0,
      sessionId: parsed.data.sessionId,
      isExecution: false,
    });

    await cancelCavCodeQueuedPrompt({
      accountId: aiCtx.accountId,
      sessionId: parsed.data.sessionId,
      messageId,
    });

    return json(
      {
        ok: true,
        requestId,
        messageId,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, requestId, error: error.code }, error.status);
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
    headers: { ...NO_STORE_HEADERS, Allow: "PATCH, DELETE, OPTIONS" },
  });
}
