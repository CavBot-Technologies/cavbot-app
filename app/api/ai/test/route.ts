import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError } from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";
import {
  resolveAiExecutionPolicy,
  resolveVisibleModelCatalogForContext,
  resolveVisibleModelCatalogForPlan,
} from "@/src/lib/ai/ai.policy";
import { ALIBABA_QWEN_CODER_MODEL_ID, ALIBABA_QWEN_MAX_MODEL_ID } from "@/src/lib/ai/model-catalog";
import {
  AiProviderError,
  getAiModelCatalog,
  assertAiProviderReady,
  getAiProvider,
  getAiProviderStatuses,
  getAiProviderStatus,
  resolveProviderIdForModel,
} from "@/src/lib/ai/providers";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { readSanitizedJson } from "@/lib/security/userInput";
import { getQwenCoderPopoverState } from "@/src/lib/ai/qwen-coder-credits.server";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const TEST_REQUEST_SCHEMA = z.object({
  mode: z.enum(["dry_run", "roundtrip"]).default("dry_run"),
  provider: z.enum(["deepseek", "alibaba_qwen"]).optional(),
  modelRole: z.enum(["chat", "reasoning"]).default("chat"),
  model: z.string().trim().max(120).optional(),
  prompt: z.string().trim().max(1_200).optional(),
});

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function aiTestRoutesEnabled() {
  if (process.env.NODE_ENV !== "production") return true;
  return s(process.env.CAVBOT_ENABLE_AI_TEST_ROUTES) === "1";
}

function parsePolicySurface(raw: unknown): "center" | "audio" | "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode" {
  const value = s(raw).toLowerCase();
  if (value === "audio") return "audio";
  if (value === "console" || value === "cavcloud" || value === "cavsafe" || value === "cavpad" || value === "cavcode") {
    return value;
  }
  return "center";
}

type ReasoningLevel = "low" | "medium" | "high" | "extra_high";

function reasoningRank(level: ReasoningLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  return 4;
}

function parseReasoningLevel(raw: unknown): ReasoningLevel | null {
  const value = s(raw).toLowerCase();
  if (value === "low" || value === "medium" || value === "high" || value === "extra_high") return value;
  return null;
}

function reasoningLevelsUpTo(maxRaw: unknown): ReasoningLevel[] {
  const levels: ReasoningLevel[] = ["low", "medium", "high", "extra_high"];
  const maxLevel = parseReasoningLevel(maxRaw) || "medium";
  return levels.filter((level) => reasoningRank(level) <= reasoningRank(maxLevel));
}

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const url = new URL(req.url);
    const action = s(url.searchParams.get("action")) || "technical_recap";
    const policySurface = parsePolicySurface(url.searchParams.get("surface"));
    const catalogScope = s(url.searchParams.get("catalog")).toLowerCase();
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const capabilityPolicy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: policySurface,
      action,
      requestedModel: null,
      requestedReasoningLevel: "medium",
      promptText: "capability-check",
      context: null,
      imageAttachmentCount: 0,
      researchUrlsCount: 0,
      sessionId: null,
      isExecution: false,
    });

    const status = getAiProviderStatus();
    const statuses = getAiProviderStatuses();
    const modelCatalog = catalogScope === "context"
      ? resolveVisibleModelCatalogForContext({
          planId: ctx.planId,
          memberRole: ctx.memberRole,
          allowTeamAiAccess: capabilityPolicy.allowTeamAiAccess,
          surface: policySurface,
          action,
          modelCatalog: getAiModelCatalog(),
        })
      : resolveVisibleModelCatalogForPlan({
          planId: ctx.planId,
          memberRole: ctx.memberRole,
          allowTeamAiAccess: capabilityPolicy.allowTeamAiAccess,
          modelCatalog: getAiModelCatalog(),
        });
    const qwenCoderState = policySurface === "cavcode"
      ? await getQwenCoderPopoverState({
          accountId: ctx.accountId,
          userId: ctx.userId,
          planId: ctx.planId,
          sessionId: s(url.searchParams.get("sessionId")) || null,
        }).catch(() => null)
      : null;
    const qwenGuardDecision = qwenCoderState?.entitlement?.nextActionId
      ? buildGuardDecisionPayload({
          actionId: qwenCoderState.entitlement.nextActionId,
          role: ctx.memberRole || undefined,
          plan: ctx.planId === "premium_plus" ? "PREMIUM_PLUS" : ctx.planId === "premium" ? "PREMIUM" : "FREE",
          flags: {
            qwenResetAt: qwenCoderState.entitlement.resetAt,
            qwenCooldownEndsAt: qwenCoderState.entitlement.cooldownEndsAt,
            qwenCoderEntitlement: qwenCoderState.entitlement,
          },
        })?.guardDecision || null
      : null;
    return json(
      {
        ok: true,
        requestId,
        provider: status.providerId,
        planId: ctx.planId,
        planLabel: capabilityPolicy.planLabel,
        memberRole: ctx.memberRole,
        allowTeamAiAccess: capabilityPolicy.allowTeamAiAccess,
        envReady: status.ok,
        missingEnv: status.missing,
        invalidEnv: status.invalid,
        baseUrl: status.baseUrl,
        models: {
          chat: status.chatModel,
          reasoning: status.reasoningModel,
        },
        audioModels: {
          transcriptionRealtime: s(status.asrRealtimeModel) || null,
          transcriptionFallback: s(status.asrModel) || null,
          speechRealtime: s(status.ttsRealtimeModel) || null,
          ...(status.audioModel ? { transcription: status.audioModel } : {}),
        },
        infrastructureModels: {
          omniRealtime: s(status.omniRealtimeModel) || null,
          embedding: s(status.embeddingModel) || null,
          rerank: s(status.rerankModel) || null,
        },
        providers: statuses,
        modelCatalog,
        research: {
          enabled: modelCatalog.text.some((item) => s(item.id) === ALIBABA_QWEN_MAX_MODEL_ID),
          model: ALIBABA_QWEN_MAX_MODEL_ID,
          actionClass: capabilityPolicy.actionClass,
          toolBundle: capabilityPolicy.researchToolBundle,
          researchMode: capabilityPolicy.researchMode,
        },
        reasoning: {
          effectiveLevel: capabilityPolicy.reasoningLevel,
          maxLevel: capabilityPolicy.maxReasoningLevel,
          options: reasoningLevelsUpTo(capabilityPolicy.maxReasoningLevel),
          clamped: capabilityPolicy.reasoningClamped,
        },
        ...(qwenCoderState ? {
          qwenCoder: qwenCoderState,
          qwenGuardDecision,
          modelAvailability: {
            [ALIBABA_QWEN_MAX_MODEL_ID]: { selectable: true },
            [ALIBABA_QWEN_CODER_MODEL_ID]: {
              selectable: qwenCoderState.entitlement.selectable,
              state: qwenCoderState.entitlement.state,
              nextActionId: qwenCoderState.entitlement.nextActionId,
            },
          },
        } : {}),
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

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  if (!aiTestRoutesEnabled()) {
    return json({ ok: false, requestId, error: "NOT_FOUND" }, 404);
  }

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

    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });

    const rate = consumeInMemoryRateLimit({
      key: `ai-test:${ctx.accountId}:${ctx.userId}`,
      limit: 6,
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

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = TEST_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid AI test payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const modelOverride = s(parsed.data.model) || undefined;
    const policy = await resolveAiExecutionPolicy({
      accountId: ctx.accountId,
      userId: ctx.userId,
      memberRole: ctx.memberRole,
      planId: ctx.planId,
      surface: "center",
      action: parsed.data.modelRole === "reasoning" ? "prioritize_fixes" : "technical_recap",
      requestedModel: modelOverride || null,
      requestedReasoningLevel: parsed.data.modelRole === "reasoning" ? "high" : "medium",
      promptText: parsed.data.prompt || "ai-test",
      context: null,
      imageAttachmentCount: 0,
      researchUrlsCount: 0,
      sessionId: null,
      isExecution: false,
    });
    const providerId = resolveProviderIdForModel(policy.model, parsed.data.provider);
    const envStatus = assertAiProviderReady(providerId);
    if (parsed.data.mode === "dry_run") {
      return json(
        {
          ok: true,
          requestId,
          mode: "dry_run",
          provider: envStatus.providerId,
          envReady: envStatus.ok,
          missingEnv: envStatus.missing,
          invalidEnv: envStatus.invalid,
          models: {
            chat: envStatus.chatModel,
            reasoning: envStatus.reasoningModel,
          },
          audioModels: envStatus.audioModel ? { transcription: envStatus.audioModel } : {},
          baseUrl: envStatus.baseUrl,
          planId: ctx.planId,
          planLabel: policy.planLabel,
          memberRole: ctx.memberRole,
          allowTeamAiAccess: policy.allowTeamAiAccess,
          modelCatalog: resolveVisibleModelCatalogForContext({
            planId: ctx.planId,
            memberRole: ctx.memberRole,
            allowTeamAiAccess: policy.allowTeamAiAccess,
            surface: "center",
            action: parsed.data.modelRole === "reasoning" ? "prioritize_fixes" : "technical_recap",
            modelCatalog: getAiModelCatalog(),
          }),
        },
        200
      );
    }

    const provider = getAiProvider(providerId);
    const model = policy.model;
    const prompt =
      parsed.data.prompt ||
      "Return a one-line health acknowledgement for CavBot AI platform wiring.";
    const completion = await provider.generate({
      model,
      messages: [
        {
          role: "system",
          content: "You are CavBot AI test route. Keep output short.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      responseFormat: { type: "text" },
      temperature: 0,
      maxTokens: 120,
      timeoutMs: 20_000,
    });

    return json(
      {
        ok: true,
        requestId,
        mode: "roundtrip",
        provider: provider.id,
        model,
        output: completion.content,
        usage: completion.usage,
        planId: ctx.planId,
        memberRole: ctx.memberRole,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    if (error instanceof AiProviderError || error instanceof AiServiceError) {
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
  if (!aiTestRoutesEnabled()) {
    return new NextResponse(null, {
      status: 404,
      headers: { ...NO_STORE_HEADERS },
    });
  }
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" },
  });
}
