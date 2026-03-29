import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import { createAiAgentJob, listAiAgentJobs, type AiAgentJobStatus } from "@/src/lib/ai/ai.agent-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const CREATE_SCHEMA = z.object({
  surface: z.string().trim().min(1).max(32).default("workspace"),
  jobType: z.enum([
    "route_manifest_audit",
    "website_knowledge_refresh",
    "research_background",
    "diagnostics_investigation",
    "coding_plan",
  ]),
  taskType: z.string().trim().max(64).optional(),
  goal: z.string().trim().min(1).max(8000),
  sessionId: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().max(160).optional(),
  projectId: z.number().int().positive().optional(),
  siteId: z.string().trim().max(120).optional(),
  origin: z.string().trim().max(2000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  autoStart: z.boolean().optional(),
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

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 40;
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function toStatus(value: unknown): AiAgentJobStatus | null {
  const parsed = s(value).toLowerCase();
  if (
    parsed === "queued"
    || parsed === "running"
    || parsed === "waiting"
    || parsed === "ready"
    || parsed === "completed"
    || parsed === "failed"
    || parsed === "cancelled"
  ) {
    return parsed;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const url = new URL(req.url);
    const jobs = await listAiAgentJobs({
      accountId: ctx.accountId,
      userId: ctx.userId,
      status: toStatus(url.searchParams.get("status")),
      projectId: toProjectId(url.searchParams.get("projectId")),
      workspaceId: s(url.searchParams.get("workspaceId")) || null,
      limit: toLimit(url.searchParams.get("limit")),
    });
    return json({
      ok: true,
      requestId,
      jobs,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to list agent jobs.";
    return json(
      {
        ok: false,
        requestId,
        error: "AI_AGENT_JOBS_LIST_FAILED",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = CREATE_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid agent job payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const job = await createAiAgentJob({
      accountId: ctx.accountId,
      userId: ctx.userId,
      requestId,
      surface: parsed.data.surface,
      jobType: parsed.data.jobType,
      taskType: parsed.data.taskType || null,
      goal: parsed.data.goal,
      sessionId: parsed.data.sessionId || null,
      workspaceId: parsed.data.workspaceId || null,
      projectId: parsed.data.projectId || null,
      siteId: parsed.data.siteId || null,
      origin: parsed.data.origin || null,
      context: parsed.data.context || {},
      autoStart: parsed.data.autoStart !== false,
    });

    return json({
      ok: true,
      requestId,
      job,
    }, 201);
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to create agent job.";
    return json(
      {
        ok: false,
        requestId,
        error: "AI_AGENT_JOB_CREATE_FAILED",
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
