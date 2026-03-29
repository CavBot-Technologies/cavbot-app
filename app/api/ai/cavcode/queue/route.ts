import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import {
  claimNextCavCodeQueuedPrompt,
  enqueueCavCodePrompt,
  listCavCodeQueuedPrompts,
} from "@/src/lib/ai/ai.memory";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  CAVAI_REASONING_LEVEL_SCHEMA,
  CAVCODE_ASSIST_ACTION_SCHEMA,
  CAVCODE_DIAGNOSTIC_SCHEMA,
  CAVCODE_IMAGE_ATTACHMENT_SCHEMA,
  AiServiceError,
} from "@/src/lib/ai/ai.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const QUEUE_ENQUEUE_SCHEMA = z.object({
  mode: z.literal("enqueue"),
  sessionId: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  action: CAVCODE_ASSIST_ACTION_SCHEMA,
  agentId: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/).optional(),
  agentActionKey: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_]{1,63}$/).optional(),
  filePath: z.string().trim().min(1).max(2_000),
  language: z.string().trim().max(80).optional(),
  selectedCode: z.string().max(40_000).optional(),
  diagnostics: z.array(CAVCODE_DIAGNOSTIC_SCHEMA).max(200).default([]),
  prompt: z.string().trim().min(1).max(8_000),
  model: z.string().trim().max(120).optional(),
  reasoningLevel: CAVAI_REASONING_LEVEL_SCHEMA.optional(),
  queueEnabled: z.boolean().optional(),
  imageAttachments: z.array(CAVCODE_IMAGE_ATTACHMENT_SCHEMA).max(10).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const QUEUE_CLAIM_SCHEMA = z.object({
  mode: z.literal("claim_next"),
  sessionId: z.string().trim().min(1).max(120),
});

const QUEUE_POST_SCHEMA = z.discriminatedUnion("mode", [
  QUEUE_ENQUEUE_SCHEMA,
  QUEUE_CLAIM_SCHEMA,
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

function countUploadedWorkspaceFiles(context: Record<string, unknown> | null | undefined): number {
  if (!context || typeof context !== "object" || Array.isArray(context)) return 0;
  const raw = (context as Record<string, unknown>).uploadedWorkspaceFiles;
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const cavcloudFileId = s(row.cavcloudFileId) || s(row.id);
    const filePath = s(row.path) || s(row.cavcloudPath);
    if (!cavcloudFileId && !filePath) continue;
    count += 1;
    if (count >= 1000) break;
  }
  return count;
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "cavcode",
    });
    await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "cavcode",
      action: "explain_error",
      requestedModel: null,
      requestedReasoningLevel: "low",
      promptText: "queue_access",
      context: null,
      imageAttachmentCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const url = new URL(req.url);
    const sessionId = s(url.searchParams.get("sessionId"));
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
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(120, Math.trunc(limitRaw))) : 40;

    const queued = await listCavCodeQueuedPrompts({
      accountId: ctx.accountId,
      sessionId,
      limit,
    });

    return json(
      {
        ok: true,
        requestId,
        sessionId,
        queued,
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

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = QUEUE_POST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid CavCode queue payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const ctx = await requireAiRequestContext({
      req,
      surface: "cavcode",
      projectId: parsed.data.mode === "enqueue" ? parsed.data.projectId : undefined,
      workspaceId: parsed.data.mode === "enqueue" ? parsed.data.workspaceId : undefined,
    });

    if (parsed.data.mode === "claim_next") {
      await resolveAiExecutionPolicy({
        accountId: ctx.accountId,
        userId: ctx.userId,
        memberRole: ctx.memberRole,
        planId: ctx.planId,
        surface: "cavcode",
        action: "explain_error",
        requestedModel: null,
        requestedReasoningLevel: "low",
        promptText: "queue_claim",
        context: null,
        imageAttachmentCount: 0,
        sessionId: parsed.data.sessionId,
        isExecution: false,
      });
      const queuedPrompt = await claimNextCavCodeQueuedPrompt({
        accountId: ctx.accountId,
        sessionId: parsed.data.sessionId,
      });
      return json(
        {
          ok: true,
          requestId,
          sessionId: parsed.data.sessionId,
          queuedPrompt,
        },
        200
      );
    }

    const contextPayload = (parsed.data.context || {}) as Record<string, unknown>;
    const imageAttachmentCount = (parsed.data.imageAttachments || []).length;
    const fileAttachmentCount = countUploadedWorkspaceFiles(contextPayload);
    const policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "cavcode",
      action: parsed.data.action,
      requestedModel: parsed.data.model || null,
      requestedReasoningLevel: parsed.data.reasoningLevel || null,
      promptText: parsed.data.prompt,
      context: contextPayload,
      imageAttachmentCount,
      fileAttachmentCount,
      sessionId: parsed.data.sessionId || null,
      isExecution: false,
    });

    const created = await enqueueCavCodePrompt({
      accountId: ctx.accountId,
      userId: ctx.userId,
      sessionId: parsed.data.sessionId || null,
      workspaceId: parsed.data.workspaceId || null,
      projectId: parsed.data.projectId || null,
      requestId,
      action: parsed.data.action,
      agentId: parsed.data.agentId || null,
      agentActionKey: parsed.data.agentActionKey || null,
      filePath: parsed.data.filePath,
      language: parsed.data.language || null,
      selectedCode: parsed.data.selectedCode || "",
      diagnostics: parsed.data.diagnostics as Array<Record<string, unknown>>,
      prompt: parsed.data.prompt,
      model: policy.model,
      reasoningLevel: policy.reasoningLevel,
      queueEnabled: parsed.data.queueEnabled === true,
      imageAttachments: (parsed.data.imageAttachments || []) as Array<Record<string, unknown>>,
      context: contextPayload,
    });

    return json(
      {
        ok: true,
        requestId,
        sessionId: created.sessionId,
        messageId: created.messageId,
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
