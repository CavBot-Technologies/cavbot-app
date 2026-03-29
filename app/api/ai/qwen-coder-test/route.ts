import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AI_NO_STORE_HEADERS, aiErrorResponse, aiJson } from "@/app/api/ai/_shared";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { writeAiAudit, writeAiUsageLog } from "@/src/lib/ai/ai.audit";
import { requireAiRequestContext, type AiRequestContext } from "@/src/lib/ai/ai.guard";
import { resolveAiExecutionPolicy, type AiExecutionPolicy } from "@/src/lib/ai/ai.policy";
import { ALIBABA_QWEN_CODER_MODEL_ID, resolveAiModelLabel } from "@/src/lib/ai/model-catalog";
import { getAiProvider } from "@/src/lib/ai/providers";
import { AiServiceError, type CavAiReasoningLevel } from "@/src/lib/ai/ai.types";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  captureQwenCoderContextSnapshot,
  estimateContextTokensForSnapshot,
  finalizeQwenCoderCharge,
  refundOrAdjustQwenCoderCharge,
} from "@/src/lib/ai/qwen-coder-credits.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION_ID = "qwen_coder_test";

const QWEN_CODER_TEST_REQUEST_SCHEMA = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  reasoningLevel: z.enum(["low", "medium", "high", "extra_high"]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(64).max(4_096).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

function mapAiError(error: unknown): AiServiceError {
  if (error instanceof AiServiceError) return error;
  if (error instanceof Error) return new AiServiceError("QWEN_CODER_TEST_FAILED", error.message, 500);
  return new AiServiceError("QWEN_CODER_TEST_FAILED", "Qwen coder test failed.", 500);
}

function qwenCoderTestRouteEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return String(process.env.CAVBOT_ENABLE_AI_TEST_ROUTES || "").trim() === "1";
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  if (!qwenCoderTestRouteEnabled()) {
    return aiJson({ ok: false, requestId, error: "NOT_FOUND" }, 404);
  }
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";
  const startedAt = Date.now();

  let requestCtx: AiRequestContext | null = null;
  let policy: AiExecutionPolicy | null = null;
  let model = ALIBABA_QWEN_CODER_MODEL_ID;
  let providerId = "alibaba_qwen";
  let latestPromptTokens = 0;
  let latestCompletionTokens = 0;
  let requestContextTokens = 0;

  try {
    if (isStatusProbe) {
      return aiJson({ ok: true, requestId, probe: "ai_qwen_coder_test", accepted: true }, 200);
    }

    if (!hasRequestIntegrityHeader(req)) {
      return aiJson(
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
    const parsed = QWEN_CODER_TEST_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid Qwen coder test payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }
    requestContextTokens = estimateContextTokensForSnapshot(parsed.data.context || null);

    requestCtx = await requireAiRequestContext({
      req,
      surface: "cavcode",
      workspaceId: parsed.data.workspaceId,
      projectId: parsed.data.projectId,
    });

    const requestedReasoning = (parsed.data.reasoningLevel || "high") as CavAiReasoningLevel;
    policy = await resolveAiExecutionPolicy({
      accountId: requestCtx.accountId,
      userId: requestCtx.userId,
      memberRole: requestCtx.memberRole,
      planId: requestCtx.planId,
      surface: "cavcode",
      action: ACTION_ID,
      requestedModel: ALIBABA_QWEN_CODER_MODEL_ID,
      requestedReasoningLevel: requestedReasoning,
      promptText: parsed.data.prompt,
      context: parsed.data.context || null,
      imageAttachmentCount: 0,
      sessionId: null,
      requestId,
      isExecution: true,
    });

    const provider = getAiProvider(policy.providerId);
    providerId = provider.id;
    model = policy.model;
    const completion = await provider.generate({
      model: policy.model,
      messages: [
        {
          role: "system",
          content: [
            "You are CavBot Qwen Coder verification route.",
            "Respond with concise technical output.",
            "Do not include markdown code fences.",
          ].join(" "),
        },
        {
          role: "user",
          content: parsed.data.prompt,
        },
      ],
      responseFormat: { type: "text" },
      temperature: parsed.data.temperature ?? 0.1,
      maxTokens: parsed.data.maxTokens ?? 900,
      timeoutMs: policy.requestLimits.maxExecutionTimeMs,
      signal: req.signal,
      metadata: {
        route: "qwen-coder-test",
        action: ACTION_ID,
        plan: requestCtx.planId,
        reasoningLevel: policy.reasoningLevel,
      },
    });
    latestPromptTokens = Math.max(0, Number(completion.usage.promptTokens || 0));
    latestCompletionTokens = Math.max(0, Number(completion.usage.completionTokens || 0));

    await writeAiUsageLog({
      accountId: requestCtx.accountId,
      userId: requestCtx.userId,
      surface: "cavcode",
      action: ACTION_ID,
      provider: provider.id,
      model: completion.model || policy.model,
      requestId,
      workspaceId: requestCtx.workspaceId,
      projectId: requestCtx.projectId,
      origin: "qwen-coder-test",
      inputChars: parsed.data.prompt.length,
      outputChars: completion.content.length,
      promptTokens: completion.usage.promptTokens,
      completionTokens: completion.usage.completionTokens,
      totalTokens: completion.usage.totalTokens,
      latencyMs: Date.now() - startedAt,
      status: "SUCCESS",
    });

    await writeAiAudit({
      req,
      accountId: requestCtx.accountId,
      userId: requestCtx.userId,
      requestId,
      surface: "cavcode",
      action: ACTION_ID,
      provider: provider.id,
      model: completion.model || policy.model,
      status: "SUCCESS",
      memberRole: requestCtx.memberRole,
      planId: requestCtx.planId,
      actionClass: policy.actionClass,
      reasoningLevel: policy.reasoningLevel,
      weightedUsageUnits: policy.weightedUsageUnits,
      latencyMs: Date.now() - startedAt,
      workspaceId: requestCtx.workspaceId,
      projectId: requestCtx.projectId,
      origin: "qwen-coder-test",
      outcome: "response_generated",
    });

    await finalizeQwenCoderCharge({
      accountId: requestCtx.accountId,
      userId: requestCtx.userId,
      requestId,
      modelName: completion.model || policy.model,
      conversationId: null,
      taskId: "qwen_coder_test",
      reason: "success",
      usage: {
        inputTokens: latestPromptTokens,
        retrievedContextTokens: requestContextTokens,
        outputTokens: latestCompletionTokens,
        compactionTokens: 0,
        toolRuntimeSeconds: Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)),
        diffGenerated: false,
        testsRun: false,
        lintRun: false,
        typecheckRun: false,
        patchApplyAttempted: false,
        complexity: "small",
      },
    }).catch(() => {});

    await captureQwenCoderContextSnapshot({
      accountId: requestCtx.accountId,
      userId: requestCtx.userId,
      sessionId: null,
      conversationId: null,
      activeModel: completion.model || policy.model,
      currentContextTokens: requestContextTokens,
    }).catch(() => {});

    return aiJson(
      {
        ok: true,
        requestId,
        providerId: provider.id,
        model: completion.model || policy.model,
        modelLabel: resolveAiModelLabel(completion.model || policy.model),
        reasoningLevel: policy.reasoningLevel,
        output: completion.content,
        usage: completion.usage,
      },
      200
    );
  } catch (error) {
    if (requestCtx) {
      const mapped = mapAiError(error);
      await writeAiUsageLog({
        accountId: requestCtx.accountId,
        userId: requestCtx.userId,
        surface: "cavcode",
        action: ACTION_ID,
        provider: providerId,
        model,
        requestId,
        workspaceId: requestCtx.workspaceId,
        projectId: requestCtx.projectId,
        origin: "qwen-coder-test",
        inputChars: 0,
        outputChars: 0,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorCode: mapped.code,
      });

      await writeAiAudit({
        req,
        accountId: requestCtx.accountId,
        userId: requestCtx.userId,
        requestId,
        surface: "cavcode",
        action: ACTION_ID,
        provider: providerId,
        model,
        status: "ERROR",
        memberRole: requestCtx.memberRole,
        planId: requestCtx.planId,
        actionClass: policy?.actionClass || "premium_plus_heavy_coding",
        reasoningLevel: policy?.reasoningLevel || "high",
        weightedUsageUnits: policy?.weightedUsageUnits || 0,
        latencyMs: Date.now() - startedAt,
        workspaceId: requestCtx.workspaceId,
        projectId: requestCtx.projectId,
        origin: "qwen-coder-test",
        errorCode: mapped.code,
        outcome: "failed",
      });

      if (policy?.qwenCoderReservation) {
        const runtimeSeconds = Math.max(0, Math.ceil((Date.now() - startedAt) / 1000));
        const failureReason = runtimeSeconds <= 2 && latestPromptTokens <= 0 && latestCompletionTokens <= 0
          ? "failure_early"
          : "failure_partial";
        await refundOrAdjustQwenCoderCharge({
          accountId: requestCtx.accountId,
          userId: requestCtx.userId,
          requestId,
          modelName: model,
          conversationId: null,
          taskId: "qwen_coder_test",
          reason: failureReason,
          usage: {
            inputTokens: latestPromptTokens,
            retrievedContextTokens: requestContextTokens,
            outputTokens: latestCompletionTokens,
            compactionTokens: 0,
            toolRuntimeSeconds: runtimeSeconds,
            diffGenerated: false,
            testsRun: false,
            lintRun: false,
            typecheckRun: false,
            patchApplyAttempted: false,
            complexity: "small",
          },
        }).catch(() => {});
      }
    }
    return aiErrorResponse(error, requestId);
  } finally {
    policy?.releaseGenerationSlot();
  }
}

export async function OPTIONS() {
  if (!qwenCoderTestRouteEnabled()) {
    return new NextResponse(null, {
      status: 404,
      headers: { ...AI_NO_STORE_HEADERS },
    });
  }
  return new NextResponse(null, {
    status: 204,
    headers: { ...AI_NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
