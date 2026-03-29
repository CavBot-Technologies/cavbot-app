import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import {
  getAiSessionForAccount,
  renameAiSessionForAccount,
  deleteAiSessionForAccount,
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

async function assertSessionAccess(req: NextRequest, sessionId: string) {
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
    promptText: "session_manage_access",
    context: null,
    imageAttachmentCount: 0,
    sessionId: null,
    isExecution: false,
  });
  return aiCtx;
}

export async function PATCH(
  req: NextRequest,
  ctx: {
    params: Promise<{
      sessionId?: string;
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

    const bodyRaw = await readSanitizedJson(req, null);
    const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};
    const title = s(body.title).slice(0, 220);
    if (!title) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "title is required.",
        },
        400
      );
    }

    const aiCtx = await assertSessionAccess(req, sessionId);
    const updated = await renameAiSessionForAccount({
      accountId: aiCtx.accountId,
      sessionId,
      title,
    });
    return json(
      {
        ok: true,
        requestId,
        sessionId,
        session: updated,
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
    params: Promise<{
      sessionId?: string;
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

    const aiCtx = await assertSessionAccess(req, sessionId);
    await deleteAiSessionForAccount({
      accountId: aiCtx.accountId,
      sessionId,
    });
    return json(
      {
        ok: true,
        requestId,
        sessionId,
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
