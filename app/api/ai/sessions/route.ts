import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { createAiSession, listAiSessions } from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  buildPassiveAiAuthRequiredPayload,
  isPassiveAiAuthRequiredError,
  readPassiveAiAuthErrorCode,
} from "@/src/lib/ai/ai.route-response";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { buildPassiveAiUnavailablePayload, isPassiveAiReadUnavailableError } from "@/src/lib/ai/ai.route-response";
import { AI_CENTER_SURFACE_SCHEMA, AiServiceError } from "@/src/lib/ai/ai.types";
import { readSanitizedJson } from "@/lib/security/userInput";

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

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toGuardSurface(surface: unknown): "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode" {
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

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const url = new URL(req.url);
    const surfaceRaw = s(url.searchParams.get("surface"));
    const workspaceId = s(url.searchParams.get("workspaceId")) || null;
    const projectId = toProjectId(url.searchParams.get("projectId"));
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 30;

    const surfaceParsed = surfaceRaw
      ? AI_CENTER_SURFACE_SCHEMA.safeParse(surfaceRaw)
      : { success: true as const, data: undefined };

    if (!surfaceParsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid surface filter.",
        },
        400
      );
    }

    const guardSurface = toGuardSurface(surfaceParsed.data || "workspace");
    const ctx = await requireAiRequestContext({
      req,
      // Session list is account-scoped metadata access; use the same baseline guard as message/history endpoints.
      // Surface policy is still enforced below via resolveAiExecutionPolicy using `guardSurface`.
      surface: "console",
      workspaceId,
      projectId,
    });
    await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: guardSurface,
      action: guardActionForSurface(guardSurface),
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "session_list_access",
      context: null,
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const rows = await listAiSessions({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: surfaceParsed.data,
      workspaceId,
      projectId,
      limit,
    });

    return json(
      {
        ok: true,
        requestId,
        sessions: rows,
      },
      200
    );
  } catch (error) {
    if (isPassiveAiAuthRequiredError(error)) {
      return json(buildPassiveAiAuthRequiredPayload(readPassiveAiAuthErrorCode(error)), 200);
    }
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
    if (isPassiveAiReadUnavailableError(error)) {
      return json(
        {
          ...buildPassiveAiUnavailablePayload(
            "AI_SESSIONS_UNAVAILABLE",
            "AI session history is temporarily unavailable."
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

export async function POST(req: NextRequest) {
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

    const rawBody = await readSanitizedJson(req, null);
    const body = rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : {};

    const surfaceParsed = AI_CENTER_SURFACE_SCHEMA.safeParse(body.surface);
    if (!surfaceParsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "surface is required.",
        },
        400
      );
    }

    const guardSurface = toGuardSurface(surfaceParsed.data);
    const workspaceId = s(body.workspaceId) || null;
    const projectId = toProjectId(body.projectId);
    const ctx = await requireAiRequestContext({
      req,
      // Session creation only allocates metadata; keep context guard consistent with other session endpoints.
      surface: "console",
      workspaceId,
      projectId,
    });
    await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: guardSurface,
      action: guardActionForSurface(guardSurface),
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "session_create_access",
      context: null,
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });
    const rate = consumeInMemoryRateLimit({
      key: `ai-sessions:${ctx.accountId}:${ctx.userId}`,
      limit: 24,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return json(
        {
          ok: false,
          requestId,
          error: "RATE_LIMITED",
          message: `Retry in ${rate.retryAfterSec}s.`,
        },
        429
      );
    }

    const created = await createAiSession({
      accountId: ctx.accountId,
      userId: ctx.userId,
      surface: surfaceParsed.data,
      title: s(body.title) || null,
      contextLabel: s(body.contextLabel) || null,
      workspaceId,
      projectId,
      origin: s(body.origin) || null,
      contextJson:
        body.context && typeof body.context === "object" && !Array.isArray(body.context)
          ? (body.context as Record<string, unknown>)
          : null,
    });

    return json(
      {
        ok: true,
        requestId,
        sessionId: created.id,
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
    headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" },
  });
}
