import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import {
  AiServiceError,
} from "@/src/lib/ai/ai.types";
import {
  getAiUserMemorySetting,
  listAiUserMemoryFacts,
  setAiUserMemoryEnabled,
  upsertAiUserMemoryFact,
} from "@/src/lib/ai/ai.memory";

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
    promptText: "memory_access",
    context: null,
    imageAttachmentCount: 0,
    sessionId: null,
    isExecution: false,
  });
  return aiCtx;
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const aiCtx = await assertMemoryAccess(req);
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 40;
    const [setting, facts] = await Promise.all([
      getAiUserMemorySetting({
        accountId: aiCtx.accountId,
        userId: aiCtx.userId,
      }),
      listAiUserMemoryFacts({
        accountId: aiCtx.accountId,
        userId: aiCtx.userId,
        limit,
      }),
    ]);

    return json({
      ok: true,
      requestId,
      setting,
      facts,
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

export async function PATCH(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json({ ok: false, requestId, error: "BAD_CSRF", message: "Missing request integrity header." }, 403);
    }
    const aiCtx = await assertMemoryAccess(req);
    const bodyRaw = await readSanitizedJson(req, null);
    const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};
    if (typeof body.memoryEnabled !== "boolean") {
      return json({ ok: false, requestId, error: "INVALID_INPUT", message: "memoryEnabled must be boolean." }, 400);
    }

    const setting = await setAiUserMemoryEnabled({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      memoryEnabled: body.memoryEnabled,
    });

    return json({
      ok: true,
      requestId,
      setting,
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

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json({ ok: false, requestId, error: "BAD_CSRF", message: "Missing request integrity header." }, 403);
    }
    const aiCtx = await assertMemoryAccess(req);
    const bodyRaw = await readSanitizedJson(req, null);
    const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
      ? (bodyRaw as Record<string, unknown>)
      : {};

    const categoryRaw = s(body.category).toLowerCase();
    const category = (
      categoryRaw === "identity"
      || categoryRaw === "preference"
      || categoryRaw === "writing_style"
      || categoryRaw === "product_preference"
      || categoryRaw === "project_goal"
    ) ? categoryRaw : "preference";

    const fact = await upsertAiUserMemoryFact({
      accountId: aiCtx.accountId,
      userId: aiCtx.userId,
      factKey: s(body.factKey),
      factValue: s(body.factValue),
      category,
      confidence: Number(body.confidence || 0.75),
      isSensitive: body.isSensitive === true,
    });

    return json({
      ok: true,
      requestId,
      fact,
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
    headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, PATCH, OPTIONS" },
  });
}
