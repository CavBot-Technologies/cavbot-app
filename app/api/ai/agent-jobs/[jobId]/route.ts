import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isApiAuthError } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import { cancelAiAgentJob, executeAiAgentJob, getAiAgentJob } from "@/src/lib/ai/ai.agent-jobs";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const PATCH_SCHEMA = z.object({
  action: z.enum(["cancel", "resume"]),
  reason: z.string().trim().max(2000).optional(),
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

export async function GET(req: NextRequest, ctx: { params: { jobId: string } }) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await requireAiRequestContext({ req, surface: "console" });
    const job = await getAiAgentJob({
      accountId: auth.accountId,
      userId: auth.userId,
      jobId: s(ctx.params.jobId),
    });
    if (!job) {
      return json({
        ok: false,
        requestId,
        error: "JOB_NOT_FOUND",
      }, 404);
    }
    return json({
      ok: true,
      requestId,
      job,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to load agent job.";
    return json({
      ok: false,
      requestId,
      error: "AI_AGENT_JOB_GET_FAILED",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    }, 500);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { jobId: string } }) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const auth = await requireAiRequestContext({ req, surface: "console" });
    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = PATCH_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json({
        ok: false,
        requestId,
        error: "INVALID_INPUT",
        message: "Invalid agent job action payload.",
        details: parsed.error.flatten(),
      }, 400);
    }

    const jobId = s(ctx.params.jobId);
    if (parsed.data.action === "cancel") {
      const updated = await cancelAiAgentJob({
        accountId: auth.accountId,
        userId: auth.userId,
        jobId,
        reason: parsed.data.reason || null,
      });
      if (!updated) {
        return json({ ok: false, requestId, error: "JOB_NOT_FOUND" }, 404);
      }
      return json({ ok: true, requestId, job: updated });
    }

    void executeAiAgentJob({
      accountId: auth.accountId,
      userId: auth.userId,
      jobId,
    });
    const job = await getAiAgentJob({
      accountId: auth.accountId,
      userId: auth.userId,
      jobId,
    });
    if (!job) {
      return json({ ok: false, requestId, error: "JOB_NOT_FOUND" }, 404);
    }
    return json({ ok: true, requestId, job });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to update agent job.";
    return json({
      ok: false,
      requestId,
      error: "AI_AGENT_JOB_PATCH_FAILED",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, PATCH, OPTIONS" },
  });
}
