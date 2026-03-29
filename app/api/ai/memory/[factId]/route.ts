import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { deleteAiUserMemoryFact } from "@/src/lib/ai/ai.memory";

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

async function assertMemoryAccess(req: NextRequest) {
  const aiCtx = await requireAiRequestContext({
    req,
    surface: "console",
  });
  await resolveAiExecutionPolicy({
    accountId: aiCtx.accountId,
    userId: aiCtx.userId,
    memberRole: aiCtx.memberRole,
    planId: aiCtx.planId,
    surface: "console",
    action: "summarize_posture",
    requestedModel: null,
    requestedReasoningLevel: "low",
    promptText: "memory_delete_access",
    context: null,
    imageAttachmentCount: 0,
    sessionId: null,
    isExecution: false,
  });
  return aiCtx;
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ factId?: string }> }
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json({ ok: false, requestId, error: "BAD_CSRF", message: "Missing request integrity header." }, 403);
    }
    const params = await ctx.params;
    const factId = s(params.factId);
    if (!factId) {
      return json({ ok: false, requestId, error: "INVALID_INPUT", message: "factId is required." }, 400);
    }
    const aiCtx = await assertMemoryAccess(req);
    await deleteAiUserMemoryFact({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      factId,
    });

    return json({
      ok: true,
      requestId,
      factId,
    }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, requestId, error: error.code }, error.status);
    if (error instanceof AiServiceError) {
      return json(
        {
          ok: false,
          requestId,
          error: error.code,
          message: error.message,
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
    headers: { ...NO_STORE_HEADERS, Allow: "DELETE, OPTIONS" },
  });
}
