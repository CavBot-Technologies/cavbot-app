import "server-only";

import { type MemberRole } from "@/lib/apiAuth";
import { getAuthPool } from "@/lib/authDb";
import type { CavCloudCollabPolicy } from "@/lib/cavcloud/collabPolicy.server";
import { type PlanId } from "@/lib/plans";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import {
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  type AiModelCatalog,
} from "@/src/lib/ai/model-catalog";
import { CAVAI_REASONING_LEVEL_SCHEMA, type CavAiReasoningLevel, type AiSurface, type AiTaskType, AiServiceError } from "@/src/lib/ai/ai.types";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
import { getAiModelCatalog, getAiProviderStatus, resolveProviderIdForModel, type AiProviderToolId } from "@/src/lib/ai/providers";
import type { QwenCoderEntitlement, QwenCoderReservation } from "@/src/lib/ai/qwen-coder-credits.server";

type QwenCreditsModule = typeof import("@/src/lib/ai/qwen-coder-credits.server");

const DEFAULT_CAVCLOUD_COLLAB_POLICY: CavCloudCollabPolicy = {
  allowAdminsManageCollaboration: false,
  allowMembersEditFiles: false,
  allowMembersCreateUpload: false,
  allowAdminsPublishArtifacts: false,
  allowAdminsViewAccessLogs: false,
  enableContributorLinks: false,
  allowTeamAiAccess: false,
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function asInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function toGuardPlan(planId: PlanId): "FREE" | "PREMIUM" | "PREMIUM_PLUS" {
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function toCavAiPlanLabel(planId: PlanId): "CavTower" | "CavControl" | "CavElite" {
  if (planId === "premium_plus") return "CavElite";
  if (planId === "premium") return "CavControl";
  return "CavTower";
}

function parseReasoningLevel(value: unknown): CavAiReasoningLevel {
  const parsed = CAVAI_REASONING_LEVEL_SCHEMA.safeParse(String(value || "").trim().toLowerCase());
  if (parsed.success) return parsed.data;
  return "medium";
}

function defaultReasoningLevelForActionClass(actionClass: AiActionClass): CavAiReasoningLevel {
  if (actionClass === "light" || actionClass === "companion_chat") return "low";
  if (actionClass === "premium_plus_web_research") return "high";
  return "medium";
}

function envBool(name: string): boolean {
  const raw = s(process.env[name]).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envBoolWithDefault(name: string, fallback: boolean): boolean {
  const value = s(process.env[name]);
  if (!value) return fallback;
  const raw = value.toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function envCsv(name: string): Set<string> {
  const raw = s(process.env[name]);
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((item) => s(item).toLowerCase())
      .filter(Boolean)
  );
}

function qwenPlanLabel(planId: PlanId): "Premium" | "Premium+" | "Free" {
  if (planId === "premium_plus") return "Premium+";
  if (planId === "premium") return "Premium";
  return "Free";
}

function utcMonthWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

async function getCavCloudCollabPolicySafe(accountId: string): Promise<CavCloudCollabPolicy> {
  try {
    const { getCavCloudCollabPolicy } = await import("@/lib/cavcloud/collabPolicy.server");
    return await getCavCloudCollabPolicy(accountId);
  } catch {
    return { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };
  }
}

function buildQwenCoderEntitlementFallback(planId: PlanId): QwenCoderEntitlement {
  const now = new Date();
  const cycle = utcMonthWindow(now);
  const selectable = planId === "premium" || planId === "premium_plus";
  const totalCredits = selectable ? 999_999 : 0;
  return {
    state: selectable ? "available" : "locked_free",
    selectable,
    planId,
    planLabel: qwenPlanLabel(planId),
    creditsUsed: 0,
    creditsRemaining: totalCredits,
    totalAvailable: totalCredits,
    totalRemaining: totalCredits,
    percentUsed: 0,
    percentRemaining: selectable ? 100 : 0,
    stage: null,
    billingCycleStart: cycle.start,
    billingCycleEnd: cycle.end,
    resetAt: cycle.end,
    cooldownEndsAt: null,
    warningLevel: null,
    nextActionId: selectable ? null : "AI_QWEN_CODER_UNLOCK_REQUIRED",
  };
}

async function getQwenCoderEntitlementSafe(
  args: Parameters<QwenCreditsModule["getQwenCoderEntitlement"]>[0]
): Promise<Awaited<ReturnType<QwenCreditsModule["getQwenCoderEntitlement"]>> | null> {
  try {
    const { getQwenCoderEntitlement } = await import("@/src/lib/ai/qwen-coder-credits.server");
    return await getQwenCoderEntitlement(args);
  } catch {
    return null;
  }
}

async function estimateQwenCoderCostSafe(
  args: Parameters<QwenCreditsModule["estimateQwenCoderCost"]>[0]
): Promise<ReturnType<QwenCreditsModule["estimateQwenCoderCost"]> | null> {
  try {
    const { estimateQwenCoderCost } = await import("@/src/lib/ai/qwen-coder-credits.server");
    return estimateQwenCoderCost(args);
  } catch {
    return null;
  }
}

async function reserveQwenCoderCreditsSafe(
  args: Parameters<QwenCreditsModule["reserveQwenCoderCredits"]>[0]
): Promise<Awaited<ReturnType<QwenCreditsModule["reserveQwenCoderCredits"]>> | null> {
  try {
    const { reserveQwenCoderCredits } = await import("@/src/lib/ai/qwen-coder-credits.server");
    return await reserveQwenCoderCredits(args);
  } catch {
    return null;
  }
}

function uploadedWorkspaceFileCountFromContext(context: Record<string, unknown> | null | undefined): number {
  if (!context || typeof context !== "object" || Array.isArray(context)) return 0;
  const raw = (context as Record<string, unknown>).uploadedWorkspaceFiles;
  if (!Array.isArray(raw)) return 0;
  let count = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const cavcloudFileId = s(row.cavcloudFileId) || s(row.id);
    const cavcloudPath = s(row.cavcloudPath);
    const filePath = s(row.path);
    if (!cavcloudFileId && !cavcloudPath && !filePath) continue;
    count += 1;
    if (count >= 1000) break;
  }
  return count;
}

export type AiActionClass =
  | "light"
  | "standard"
  | "heavy"
  | "premium_plus_web_research"
  | "premium_plus_heavy_coding"
  | "companion_chat"
  | "image_generation"
  | "image_edit"
  | "audio_transcription"
  | "audio_speech"
  | "multimodal_live";

export type AiResearchToolId = Extract<AiProviderToolId, "web_search" | "web_extractor" | "code_interpreter">;

type RateProfile = {
  perMinute: number;
  perHour: number;
  maxActiveGenerations: number;
  maxSessionDepth: number;
};

type RequestLimitProfile = {
  maxPromptChars: number;
  maxContextChars: number;
  maxImageAttachments: number;
  maxResearchUrls: number;
  maxOutputChars: number;
  maxExecutionTimeMs: number;
};

const WEIGHTED_USAGE_UNITS: Record<AiActionClass, number> = {
  light: 1,
  standard: 3,
  heavy: 8,
  premium_plus_web_research: 22,
  premium_plus_heavy_coding: 15,
  companion_chat: 2,
  image_generation: 9,
  image_edit: 12,
  audio_transcription: 1,
  audio_speech: 1,
  multimodal_live: 10,
};

const BASE_MONTHLY_BUDGET_UNITS: Record<PlanId, number> = {
  free: 240,
  premium: 3_000,
  premium_plus: 12_000,
};

const PREMIUM_IMAGE_ATTACHMENTS_PER_PROMPT = 5;
const PREMIUM_PLUS_IMAGE_ATTACHMENTS_PER_PROMPT = 10;

function attachmentLimitForPlan(baseLimit: number, planId: PlanId): number {
  if (baseLimit <= 0) return 0;
  if (planId === "premium_plus") return PREMIUM_PLUS_IMAGE_ATTACHMENTS_PER_PROMPT;
  if (planId === "premium") return PREMIUM_IMAGE_ATTACHMENTS_PER_PROMPT;
  return 2;
}

function requestLimitsForClass(actionClass: AiActionClass, planId: PlanId): RequestLimitProfile {
  if (actionClass === "light") {
    return {
      maxPromptChars: 4_000,
      maxContextChars: 14_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 8_000,
      maxExecutionTimeMs: 24_000,
    };
  }
  if (actionClass === "standard") {
    return {
      maxPromptChars: 8_000,
      maxContextChars: 24_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 12_000,
      maxExecutionTimeMs: 35_000,
    };
  }
  if (actionClass === "heavy") {
    return {
      maxPromptChars: 10_000,
      maxContextChars: 30_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 18_000,
      maxExecutionTimeMs: 55_000,
    };
  }
  if (actionClass === "premium_plus_web_research") {
    const baseAttachmentLimit = envInt("CAVAI_RESEARCH_MAX_ATTACHMENTS", 2);
    return {
      maxPromptChars: envInt("CAVAI_RESEARCH_MAX_PROMPT_CHARS", 14_000),
      maxContextChars: envInt("CAVAI_RESEARCH_MAX_CONTEXT_CHARS", 52_000),
      maxImageAttachments: attachmentLimitForPlan(baseAttachmentLimit, planId),
      maxResearchUrls: envInt("CAVAI_RESEARCH_MAX_URLS", 8),
      maxOutputChars: envInt("CAVAI_RESEARCH_MAX_OUTPUT_CHARS", 28_000),
      maxExecutionTimeMs: envInt("CAVAI_RESEARCH_TIMEOUT_MS", 90_000),
    };
  }
  if (actionClass === "premium_plus_heavy_coding") {
    return {
      maxPromptChars: 12_000,
      maxContextChars: 42_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 30_000,
      maxExecutionTimeMs: 70_000,
    };
  }
  if (actionClass === "companion_chat") {
    return {
      maxPromptChars: 8_000,
      maxContextChars: 24_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 12_000,
      maxExecutionTimeMs: 35_000,
    };
  }
  if (actionClass === "image_generation") {
    return {
      maxPromptChars: 6_000,
      maxContextChars: 16_000,
      maxImageAttachments: 0,
      maxResearchUrls: 0,
      maxOutputChars: 12_000,
      maxExecutionTimeMs: 60_000,
    };
  }
  if (actionClass === "image_edit") {
    return {
      maxPromptChars: 6_000,
      maxContextChars: 16_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 12_000,
      maxExecutionTimeMs: 70_000,
    };
  }
  if (actionClass === "audio_speech") {
    return {
      maxPromptChars: 8_000,
      maxContextChars: 8_000,
      maxImageAttachments: 0,
      maxResearchUrls: 0,
      maxOutputChars: 16_000,
      maxExecutionTimeMs: 40_000,
    };
  }
  if (actionClass === "multimodal_live") {
    return {
      maxPromptChars: 10_000,
      maxContextChars: 24_000,
      maxImageAttachments: attachmentLimitForPlan(2, planId),
      maxResearchUrls: 0,
      maxOutputChars: 18_000,
      maxExecutionTimeMs: 70_000,
    };
  }
  return {
    maxPromptChars: 2_000,
    maxContextChars: 4_000,
    maxImageAttachments: 0,
    maxResearchUrls: 0,
    maxOutputChars: 40_000,
    maxExecutionTimeMs: 70_000,
  };
}

function rateProfileFor(args: { actionClass: AiActionClass; planId: PlanId }): RateProfile {
  const { actionClass, planId } = args;
  if (actionClass === "premium_plus_web_research") {
    if (planId === "premium_plus") {
      return {
        perMinute: Math.max(1, envInt("CAVAI_RESEARCH_RATE_PER_MINUTE", 3)),
        perHour: Math.max(2, envInt("CAVAI_RESEARCH_RATE_PER_HOUR", 24)),
        maxActiveGenerations: Math.max(1, envInt("CAVAI_RESEARCH_MAX_CONCURRENCY", 1)),
        maxSessionDepth: Math.max(40, envInt("CAVAI_RESEARCH_MAX_SESSION_DEPTH", 120)),
      };
    }
    if (planId === "premium") {
      return { perMinute: 2, perHour: 16, maxActiveGenerations: 1, maxSessionDepth: 90 };
    }
    return { perMinute: 1, perHour: 10, maxActiveGenerations: 1, maxSessionDepth: 70 };
  }
  if (actionClass === "premium_plus_heavy_coding") {
    if (planId === "premium_plus") {
      return { perMinute: 4, perHour: 40, maxActiveGenerations: 1, maxSessionDepth: 240 };
    }
    if (planId === "premium") {
      return { perMinute: 3, perHour: 30, maxActiveGenerations: 1, maxSessionDepth: 180 };
    }
    return { perMinute: 2, perHour: 20, maxActiveGenerations: 1, maxSessionDepth: 150 };
  }
  if (actionClass === "heavy") {
    if (planId === "premium_plus") {
      return { perMinute: 8, perHour: 96, maxActiveGenerations: 2, maxSessionDepth: 320 };
    }
    if (planId === "premium") {
      return { perMinute: 4, perHour: 48, maxActiveGenerations: 1, maxSessionDepth: 200 };
    }
    return { perMinute: 2, perHour: 24, maxActiveGenerations: 1, maxSessionDepth: 160 };
  }
  if (actionClass === "standard") {
    if (planId === "premium_plus") return { perMinute: 18, perHour: 180, maxActiveGenerations: 3, maxSessionDepth: 520 };
    if (planId === "premium") return { perMinute: 12, perHour: 120, maxActiveGenerations: 2, maxSessionDepth: 360 };
    return { perMinute: 8, perHour: 80, maxActiveGenerations: 2, maxSessionDepth: 220 };
  }
  if (actionClass === "audio_transcription") {
    if (planId === "premium_plus") return { perMinute: 10, perHour: 100, maxActiveGenerations: 2, maxSessionDepth: 200 };
    if (planId === "premium") return { perMinute: 8, perHour: 80, maxActiveGenerations: 2, maxSessionDepth: 180 };
    return { perMinute: 6, perHour: 60, maxActiveGenerations: 1, maxSessionDepth: 120 };
  }
  if (actionClass === "audio_speech") {
    if (planId === "premium_plus") return { perMinute: 12, perHour: 120, maxActiveGenerations: 2, maxSessionDepth: 220 };
    if (planId === "premium") return { perMinute: 10, perHour: 100, maxActiveGenerations: 2, maxSessionDepth: 200 };
    return { perMinute: 8, perHour: 80, maxActiveGenerations: 1, maxSessionDepth: 140 };
  }
  if (actionClass === "multimodal_live") {
    if (planId === "premium_plus") return { perMinute: 6, perHour: 60, maxActiveGenerations: 1, maxSessionDepth: 180 };
    if (planId === "premium") return { perMinute: 4, perHour: 40, maxActiveGenerations: 1, maxSessionDepth: 120 };
    return { perMinute: 2, perHour: 20, maxActiveGenerations: 1, maxSessionDepth: 90 };
  }
  if (actionClass === "companion_chat") {
    if (planId === "premium_plus") return { perMinute: 20, perHour: 220, maxActiveGenerations: 3, maxSessionDepth: 480 };
    if (planId === "premium") return { perMinute: 16, perHour: 180, maxActiveGenerations: 2, maxSessionDepth: 360 };
    return { perMinute: 12, perHour: 120, maxActiveGenerations: 2, maxSessionDepth: 260 };
  }
  if (actionClass === "image_generation") {
    if (planId === "premium_plus") return { perMinute: 6, perHour: 72, maxActiveGenerations: 2, maxSessionDepth: 200 };
    if (planId === "premium") return { perMinute: 4, perHour: 48, maxActiveGenerations: 1, maxSessionDepth: 160 };
    return { perMinute: 1, perHour: 1, maxActiveGenerations: 1, maxSessionDepth: 60 };
  }
  if (actionClass === "image_edit") {
    if (planId === "premium_plus") return { perMinute: 4, perHour: 40, maxActiveGenerations: 1, maxSessionDepth: 160 };
    return { perMinute: 1, perHour: 1, maxActiveGenerations: 1, maxSessionDepth: 60 };
  }
  if (planId === "premium_plus") return { perMinute: 24, perHour: 240, maxActiveGenerations: 4, maxSessionDepth: 640 };
  if (planId === "premium") return { perMinute: 16, perHour: 160, maxActiveGenerations: 3, maxSessionDepth: 420 };
  return { perMinute: 10, perHour: 100, maxActiveGenerations: 2, maxSessionDepth: 180 };
}

export function resolveMaxReasoningLevelForPlan(args: {
  planId: PlanId;
}): CavAiReasoningLevel {
  if (args.planId === "premium_plus") return "extra_high";
  if (args.planId === "premium") return "high";
  return "medium";
}

function maxReasoningFor(args: { actionClass: AiActionClass; planId: PlanId }): CavAiReasoningLevel {
  const { actionClass, planId } = args;
  if (
    actionClass === "audio_transcription"
    || actionClass === "audio_speech"
    || actionClass === "multimodal_live"
    || actionClass === "image_generation"
    || actionClass === "image_edit"
  ) return "low";
  return resolveMaxReasoningLevelForPlan({ planId });
}

function deepSeekModels(): { chat: string; reasoning: string } {
  const status = getAiProviderStatus("deepseek");
  return {
    chat: s(status.chatModel) || DEEPSEEK_CHAT_MODEL_ID,
    reasoning: s(status.reasoningModel) || DEEPSEEK_REASONER_MODEL_ID,
  };
}

function monthlyBudgetForPlan(planId: PlanId): number {
  if (planId === "premium_plus") {
    return Math.max(1, envInt("CAVAI_MONTHLY_BUDGET_UNITS_PREMIUM_PLUS", BASE_MONTHLY_BUDGET_UNITS.premium_plus));
  }
  if (planId === "premium") {
    return Math.max(1, envInt("CAVAI_MONTHLY_BUDGET_UNITS_PREMIUM", BASE_MONTHLY_BUDGET_UNITS.premium));
  }
  return Math.max(1, envInt("CAVAI_MONTHLY_BUDGET_UNITS_FREE", BASE_MONTHLY_BUDGET_UNITS.free));
}

function isResearchEnabled(): boolean {
  return envBoolWithDefault("CAVAI_RESEARCH_ENABLED", true);
}

function isResearchKillSwitched(): boolean {
  return envBool("CAVAI_RESEARCH_KILL_SWITCH");
}

function isQwenMaxEnabled(): boolean {
  return envBoolWithDefault("CAVAI_QWEN_MAX_ENABLED", true);
}

export function isResearchActionClass(actionClass: AiActionClass): boolean {
  return actionClass === "premium_plus_web_research";
}

export function resolveResearchToolBundle(actionClass: AiActionClass): AiResearchToolId[] {
  if (!isResearchActionClass(actionClass)) return [];
  if (!isResearchEnabled() || isResearchKillSwitched()) return [];

  const tools: AiResearchToolId[] = [];
  if (envBoolWithDefault("CAVAI_RESEARCH_TOOL_WEB_SEARCH_ENABLED", true)) tools.push("web_search");
  if (envBoolWithDefault("CAVAI_RESEARCH_TOOL_WEB_EXTRACTOR_ENABLED", true)) tools.push("web_extractor");
  if (envBoolWithDefault("CAVAI_RESEARCH_TOOL_CODE_INTERPRETER_ENABLED", true)) tools.push("code_interpreter");
  return tools;
}

function allowedModelsForActionClass(actionClass: AiActionClass): string[] {
  const modelCatalog = getAiModelCatalog();
  if (actionClass === "audio_transcription") return modelCatalog.audio.map((row) => s(row.id)).filter(Boolean);
  if (actionClass === "audio_speech") return [ALIBABA_QWEN_TTS_REALTIME_MODEL_ID];
  if (actionClass === "multimodal_live") return [ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID];
  if (actionClass === "companion_chat") {
    return modelCatalog.text
      .map((row) => s(row.id))
      .filter((id) => id === ALIBABA_QWEN_CHARACTER_MODEL_ID);
  }
  if (actionClass === "image_generation") {
    return modelCatalog.image
      .filter((row) => row.capability === "generation")
      .map((row) => s(row.id))
      .filter(Boolean);
  }
  if (actionClass === "image_edit") {
    return modelCatalog.image
      .filter((row) => row.capability === "edit")
      .map((row) => s(row.id))
      .filter(Boolean);
  }
  return modelCatalog.text.map((row) => s(row.id)).filter(Boolean);
}

function allowedModelsForPlan(args: {
  planId: PlanId;
  surface: AiSurface | "center" | "audio";
}): string[] {
  const deepseek = deepSeekModels();
  const ids = new Set<string>([deepseek.chat || DEEPSEEK_CHAT_MODEL_ID]);
  ids.add(ALIBABA_QWEN_FLASH_MODEL_ID);
  if (args.surface !== "cavcode") {
    ids.add(ALIBABA_QWEN_CHARACTER_MODEL_ID);
  }
  if (args.planId === "premium" || args.planId === "premium_plus") {
    ids.add(deepseek.reasoning);
    ids.add(ALIBABA_QWEN_PLUS_MODEL_ID);
    ids.add(ALIBABA_QWEN_IMAGE_MODEL_ID);
  }
  if ((args.planId === "premium" || args.planId === "premium_plus") && args.surface === "cavcode") {
    ids.add(ALIBABA_QWEN_CODER_MODEL_ID);
  }
  if (args.planId === "premium_plus") {
    if (isQwenMaxEnabled()) ids.add(ALIBABA_QWEN_MAX_MODEL_ID);
    ids.add(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
  }
  return Array.from(ids).filter(Boolean);
}

function isHeavyCodeTask(taskType?: AiTaskType | null): boolean {
  return (
    taskType === "code_generate"
    || taskType === "code_fix"
    || taskType === "code_refactor"
    || taskType === "code_plan"
    || taskType === "code_review"
    || taskType === "patch_proposal"
    || taskType === "code_generation"
  );
}

function isReasoningHeavyTask(taskType?: AiTaskType | null): boolean {
  return (
    taskType === "research"
    || taskType === "seo"
    || taskType === "keyword_research"
    || taskType === "content_brief"
    || taskType === "website_improvement"
    || taskType === "dashboard_diagnostics"
    || taskType === "dashboard_error_explanation"
    || taskType === "dashboard_summary"
    || taskType === "cavsafe_policy"
    || taskType === "cavsafe_security_guidance"
    || taskType === "cavcloud_organization"
    || taskType === "cavcloud_guidance"
    || taskType === "diagnostics_explanation"
    || taskType === "seo_help"
    || taskType === "security_policy"
    || taskType === "storage_guidance"
  );
}

function preferredAutoModel(args: {
  actionClass: AiActionClass;
  taskType?: AiTaskType | null;
  surface: AiSurface | "center" | "audio";
  planId: PlanId;
}): string {
  const deepseek = deepSeekModels();
  const actionClass = args.actionClass;
  if (actionClass === "audio_transcription") return ALIBABA_QWEN_ASR_REALTIME_MODEL_ID;
  if (actionClass === "audio_speech") return ALIBABA_QWEN_TTS_REALTIME_MODEL_ID;
  if (actionClass === "multimodal_live") return ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID;
  if (actionClass === "companion_chat") return ALIBABA_QWEN_CHARACTER_MODEL_ID;
  if (actionClass === "image_generation") return ALIBABA_QWEN_IMAGE_MODEL_ID;
  if (actionClass === "image_edit") return ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
  if (actionClass === "premium_plus_web_research") {
    if (args.planId === "premium_plus" && isQwenMaxEnabled()) return ALIBABA_QWEN_MAX_MODEL_ID;
    return ALIBABA_QWEN_PLUS_MODEL_ID;
  }
  if (actionClass === "premium_plus_heavy_coding") return ALIBABA_QWEN_CODER_MODEL_ID;
  if (args.taskType === "research" && args.planId === "premium_plus") return ALIBABA_QWEN_MAX_MODEL_ID;
  if (
    isHeavyCodeTask(args.taskType)
    && (args.planId === "premium" || args.planId === "premium_plus")
    && args.surface === "cavcode"
  ) {
    return ALIBABA_QWEN_CODER_MODEL_ID;
  }
  if (isHeavyCodeTask(args.taskType) || isReasoningHeavyTask(args.taskType)) {
    return deepseek.reasoning;
  }
  if (actionClass === "light" || actionClass === "standard") {
    if (args.planId === "premium" || args.planId === "premium_plus") {
      return ALIBABA_QWEN_PLUS_MODEL_ID;
    }
    return deepseek.chat;
  }
  if (actionClass === "heavy") return deepseek.reasoning;
  return ALIBABA_QWEN_ASR_MODEL_ID;
}

function canFailOpenModelSelection(actionClass: AiActionClass): boolean {
  return (
    actionClass !== "audio_transcription"
    && actionClass !== "audio_speech"
    && actionClass !== "image_generation"
    && actionClass !== "image_edit"
    && actionClass !== "premium_plus_heavy_coding"
  );
}

function pickPlanFallbackModel(args: {
  actionClass: AiActionClass;
  planId: PlanId;
  surface: AiSurface | "center" | "audio";
  taskType?: AiTaskType | null;
  exclude?: string[];
}): string | null {
  const actionAllowedModels = allowedModelsForActionClass(args.actionClass)
    .filter((id, index, rows) => rows.indexOf(id) === index);
  const standardTextModels = new Set<string>(
    allowedModelsForActionClass("standard").filter(Boolean)
  );
  const planAllowedModels = args.actionClass === "audio_transcription"
    ? [ALIBABA_QWEN_ASR_REALTIME_MODEL_ID, ALIBABA_QWEN_ASR_MODEL_ID]
    : args.actionClass === "audio_speech"
      ? [ALIBABA_QWEN_TTS_REALTIME_MODEL_ID]
      : args.actionClass === "multimodal_live"
        ? [ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID]
        : allowedModelsForPlan({
          planId: args.planId,
          surface: args.surface,
        });
  const planWideModels = allowedModelsForPlan({
    planId: args.planId,
    surface: args.surface,
  });
  const strictCandidates = actionAllowedModels.filter((id) => planAllowedModels.includes(id));
  const broadTextCandidates = planWideModels.filter((id) => standardTextModels.has(id));
  const excluded = new Set<string>((args.exclude || []).map((value) => s(value)).filter(Boolean));
  const preferred = preferredAutoModel({
    actionClass: args.actionClass,
    taskType: args.taskType,
    surface: args.surface,
    planId: args.planId,
  });
  const candidates = [
    ...(strictCandidates.includes(preferred) ? [preferred] : []),
    ...strictCandidates,
    ...broadTextCandidates,
  ].filter((id, index, rows) => id && rows.indexOf(id) === index && !excluded.has(id));

  for (const candidate of candidates) {
    if (candidate === ALIBABA_QWEN_MAX_MODEL_ID && !isQwenMaxEnabled()) continue;
    if (validateModelKillSwitch(candidate) || validateProviderKillSwitch(candidate)) continue;
    if (!isProviderReadyForModel(candidate)) continue;
    return candidate;
  }
  return null;
}

function levelRank(level: CavAiReasoningLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  return 4;
}

function clampReasoningLevel(requested: CavAiReasoningLevel, maxAllowed: CavAiReasoningLevel): {
  effective: CavAiReasoningLevel;
  clamped: boolean;
} {
  if (levelRank(requested) <= levelRank(maxAllowed)) {
    return { effective: requested, clamped: false };
  }
  return { effective: maxAllowed, clamped: true };
}

function classifyGeneralAction(surface: string, actionRaw: string, taskType?: AiTaskType | null): AiActionClass {
  const action = s(actionRaw).toLowerCase();
  const companionModeActions = new Set<string>([
    "financial_advisor",
    "therapist_support",
    "mentor",
    "best_friend",
    "relationship_advisor",
    "philosopher",
    "focus_coach",
    "life_strategist",
  ]);
  if (!action) return "standard";
  if (
    action === "multimodal_live"
    || action === "live_multimodal"
    || action.includes("omni_realtime")
    || action.includes("live_multimodal")
  ) {
    return "multimodal_live";
  }
  if (
    action === "speak_text"
    || action === "voice_speak"
    || action.includes("speak_back")
    || action.includes("text_to_speech")
  ) {
    return "audio_speech";
  }
  if (
    action === "companion_chat"
    || action === "cavbot_companion"
    || companionModeActions.has(action)
    || action.includes("companion")
  ) {
    return "companion_chat";
  }
  if (
    action === "image_studio"
    || action === "ui_mockup_generator"
    || action === "website_visual_builder"
    || action === "brand_asset_generator"
    || action === "ui_debug_visualizer"
    || action.includes("image_studio")
    || action.includes("image_generate")
  ) {
    return "image_generation";
  }
  if (
    action === "image_edit"
    || action === "app_screenshot_enhancer"
    || action.includes("image_edit")
    || action.includes("screenshot_enhance")
  ) {
    return "image_edit";
  }
  if (
    action === "web_research"
    || action.includes("research")
    || taskType === "research"
  ) {
    return "premium_plus_web_research";
  }
  if (surface === "cavcode") {
    if (
      action === "generate_component"
      || action === "generate_section"
      || action === "generate_page"
      || action === "accessibility_audit"
      || action === "qwen_coder_test"
      || isHeavyCodeTask(taskType)
    ) {
      return "premium_plus_heavy_coding";
    }
    if (action === "refactor_safely" || taskType === "code_explain" || taskType === "code_explanation") return "heavy";
    if (action === "explain_error" || action === "explain_code") return "light";
    return "standard";
  }

  if (isReasoningHeavyTask(taskType) || isHeavyCodeTask(taskType)) {
    return "heavy";
  }

  if (
    action.includes("explain_spike")
    || action.includes("prioritize_fixes")
    || action.includes("explain_issue_cluster")
    || action.includes("audit_access_context")
  ) {
    return "heavy";
  }
  if (
    action.includes("rewrite_clearly")
    || action.includes("summarize_thread")
    || action === "write_note"
    || action.includes("summarize_secure_file")
  ) {
    return "light";
  }
  return "standard";
}

export function classifyAiActionClass(args: {
  surface: AiSurface | "center" | "audio";
  action: string;
  taskType?: AiTaskType | null;
}): AiActionClass {
  const action = s(args.action).toLowerCase();
  if (args.surface === "audio") {
    if (
      action === "speak_text"
      || action === "voice_speak"
      || action.includes("speak_back")
      || action.includes("text_to_speech")
    ) {
      return "audio_speech";
    }
    return "audio_transcription";
  }
  if (action === "transcribe_audio") return "audio_transcription";
  if (args.surface === "center") {
    return classifyGeneralAction("workspace", args.action, args.taskType);
  }
  return classifyGeneralAction(args.surface, args.action, args.taskType);
}

function throwGuardedAiError(args: {
  code: string;
  message: string;
  status: number;
  actionId: string;
  role: MemberRole | string | null | undefined;
  planId: PlanId;
  details?: Record<string, unknown>;
}): never {
  const details = args.details || {};
  const qwenEntitlementRaw = details.qwenCoderEntitlement;
  const qwenEntitlement =
    qwenEntitlementRaw && typeof qwenEntitlementRaw === "object" && !Array.isArray(qwenEntitlementRaw)
      ? (qwenEntitlementRaw as Record<string, unknown>)
      : null;
  const qwenResetAt = qwenEntitlement?.resetAt || null;
  const qwenCooldownEndsAt = qwenEntitlement?.cooldownEndsAt || null;
  const guardFlags = (qwenResetAt || qwenCooldownEndsAt || qwenEntitlement)
    ? {
        qwenResetAt,
        qwenCooldownEndsAt,
        qwenCoderEntitlement: qwenEntitlement || null,
      }
    : null;
  const guardPayload = buildGuardDecisionPayload({
    actionId: args.actionId,
    role: args.role || undefined,
    plan: toGuardPlan(args.planId),
    flags: guardFlags,
  });
  throw new AiServiceError(
    args.code,
    args.message,
    args.status,
    {
      ...details,
      ...(guardPayload || {}),
    }
  );
}

function qwenGuardForEntitlement(entitlement: QwenCoderEntitlement): {
  code: string;
  actionId:
    | "AI_QWEN_CODER_UNLOCK_REQUIRED"
    | "AI_QWEN_CODER_COOLDOWN"
    | "AI_QWEN_CODER_PREMIUM_EXHAUSTED"
    | "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED"
    | "AI_USAGE_LIMIT_REACHED";
  message: string;
  status: number;
} {
  if (entitlement.state === "locked_free") {
    return {
      code: "AI_QWEN_CODER_UNLOCK_REQUIRED",
      actionId: "AI_QWEN_CODER_UNLOCK_REQUIRED",
      message: "Caven is available on Premium and Premium+.",
      status: 403,
    };
  }
  if (entitlement.state === "cooldown") {
    return {
      code: "AI_QWEN_CODER_COOLDOWN",
      actionId: "AI_QWEN_CODER_COOLDOWN",
      message: "Caven is cooling down for your current Premium stage.",
      status: 429,
    };
  }
  if (entitlement.state === "premium_plus_exhausted") {
    return {
      code: "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED",
      actionId: "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED",
      message: "Premium+ Caven credits are exhausted for this billing cycle.",
      status: 429,
    };
  }
  if (entitlement.state === "premium_exhausted") {
    return {
      code: "AI_QWEN_CODER_PREMIUM_EXHAUSTED",
      actionId: "AI_QWEN_CODER_PREMIUM_EXHAUSTED",
      message: "Premium Caven credits are exhausted for this billing cycle.",
      status: 429,
    };
  }
  return {
    code: "AI_USAGE_LIMIT_REACHED",
    actionId: "AI_USAGE_LIMIT_REACHED",
    message: "Caven is unavailable right now for this account.",
    status: 429,
  };
}

const activeGenerationSlots = new Map<string, number>();

function acquireGenerationSlot(args: {
  accountId: string;
  userId: string;
  actionClass: AiActionClass;
  maxActiveGenerations: number;
}) {
  const key = `${s(args.accountId)}:${s(args.userId)}:${args.actionClass}`;
  const current = Number(activeGenerationSlots.get(key) || 0);
  if (current >= Math.max(1, args.maxActiveGenerations)) {
    return {
      ok: false as const,
      release: () => {},
      current,
    };
  }
  activeGenerationSlots.set(key, current + 1);
  const release = () => {
    const now = Number(activeGenerationSlots.get(key) || 0);
    if (now <= 1) {
      activeGenerationSlots.delete(key);
      return;
    }
    activeGenerationSlots.set(key, now - 1);
  };
  return {
    ok: true as const,
    release,
    current: current + 1,
  };
}

async function assertSessionDepth(args: {
  accountId: string;
  sessionId?: string | null;
  maxSessionDepth: number;
  role: MemberRole | string | null | undefined;
  planId: PlanId;
}) {
  const sessionId = s(args.sessionId);
  if (!sessionId) return;

  const result = await getAuthPool().query<{ count: string | number }>(
    `SELECT COUNT(*)::int AS "count"
      FROM "CavAiMessage"
      WHERE "accountId" = $1
        AND "sessionId" = $2`,
    [s(args.accountId), sessionId]
  );
  const count = Math.max(0, Number(result.rows[0]?.count || 0));
  if (count <= args.maxSessionDepth) return;

  throwGuardedAiError({
    code: "AI_SESSION_LIMIT_REACHED",
    message: "This conversation reached the session depth limit. Start a new chat to continue.",
    status: 429,
    actionId: "AI_USAGE_LIMIT_REACHED",
    role: args.role,
    planId: args.planId,
    details: {
      sessionDepth: count,
      sessionDepthLimit: args.maxSessionDepth,
    },
  });
}

async function readMonthlyWeightedUsageUnits(accountId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const grouped = (
    await getAuthPool().query<{ surface: string; action: string; count: string | number }>(
      `SELECT
          "surface",
          "action",
          COUNT(*)::int AS "count"
        FROM "CavAiUsageLog"
        WHERE "accountId" = $1
          AND "createdAt" >= $2
          AND "status" = 'SUCCESS'
        GROUP BY "surface", "action"`,
      [s(accountId), monthStart]
    )
  ).rows;

  let total = 0;
  for (const row of grouped) {
    const actionClass = classifyAiActionClass({
      surface: s(row.surface) === "console" && s(row.action) === "transcribe_audio" ? "audio" : (s(row.surface) as AiSurface),
      action: row.action,
    });
    const weight = WEIGHTED_USAGE_UNITS[actionClass];
    total += Math.max(0, Number(row.count || 0)) * weight;
  }
  return total;
}

function normalizeJsonLength(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function validateModelKillSwitch(modelId: string): boolean {
  const disabledModels = envCsv("CAVAI_DISABLED_MODELS");
  return disabledModels.has(s(modelId).toLowerCase());
}

function validateProviderKillSwitch(modelId: string): boolean {
  const provider = resolveProviderIdForModel(modelId);
  const disabledProviders = envCsv("CAVAI_DISABLED_PROVIDERS");
  return disabledProviders.has(s(provider).toLowerCase());
}

function isProviderReadyForModel(modelId: string): boolean {
  try {
    const providerId = resolveProviderIdForModel(modelId);
    const status = getAiProviderStatus(providerId);
    return status.ok;
  } catch {
    return false;
  }
}

function resolveModelForExecution(args: {
  requestedModel?: string | null;
  actionClass: AiActionClass;
  role: MemberRole | string | null | undefined;
  planId: PlanId;
  surface: AiSurface | "center" | "audio";
  taskType?: AiTaskType | null;
  allowUnavailableProviderFallback?: boolean;
}): {
  model: string;
  manualModelSelected: boolean;
  requestedModel: string | null;
  fallbackReason: string | null;
} {
  const actionAllowedModels = allowedModelsForActionClass(args.actionClass)
    .filter((id, index, rows) => rows.indexOf(id) === index);
  const planAllowedModels = args.actionClass === "audio_transcription"
    ? [ALIBABA_QWEN_ASR_REALTIME_MODEL_ID, ALIBABA_QWEN_ASR_MODEL_ID]
    : args.actionClass === "audio_speech"
      ? [ALIBABA_QWEN_TTS_REALTIME_MODEL_ID]
      : args.actionClass === "multimodal_live"
        ? [ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID]
        : allowedModelsForPlan({
          planId: args.planId,
          surface: args.surface,
        });
  const allowedModels = actionAllowedModels.filter((id) => planAllowedModels.includes(id));
  const requested = s(args.requestedModel);
  const failOpenSelection = canFailOpenModelSelection(args.actionClass);
  const disabledAll = envBool("CAVAI_KILL_SWITCH_ALL");
  if (disabledAll) {
    throwGuardedAiError({
      code: "AI_KILL_SWITCH_ENABLED",
      message: "AI is temporarily paused by workspace controls.",
      status: 503,
      actionId: "AI_PROVIDER_DISABLED",
      role: args.role,
      planId: args.planId,
    });
  }

  const disabledClasses = envCsv("CAVAI_DISABLED_ACTION_CLASSES");
  if (disabledClasses.has(args.actionClass)) {
    throwGuardedAiError({
      code: "AI_ACTION_CLASS_DISABLED",
      message: "This AI action class is temporarily disabled.",
      status: 503,
      actionId: "AI_ACTION_CLASS_BLOCKED",
      role: args.role,
      planId: args.planId,
      details: {
        actionClass: args.actionClass,
      },
    });
  }

  if (!allowedModels.length) {
    if (failOpenSelection) {
      const fallbackModel = pickPlanFallbackModel({
        actionClass: args.actionClass,
        planId: args.planId,
        surface: args.surface,
        taskType: args.taskType,
      });
      if (fallbackModel) {
        return {
          model: fallbackModel,
          manualModelSelected: false,
          requestedModel: requested || null,
          fallbackReason: "action_not_available_for_plan_fallback",
        };
      }
    }
    throwGuardedAiError({
      code: "AI_MODEL_NOT_ALLOWED_FOR_ACTION",
      message: "Requested model is not available for this action under your current plan.",
      status: 403,
      actionId: "AI_MODEL_PLAN_BLOCKED",
      role: args.role,
      planId: args.planId,
    });
  }

  if (requested) {
    if (!allowedModels.includes(requested)) {
      if (
        args.actionClass === "companion_chat"
        && allowedModels.includes(ALIBABA_QWEN_CHARACTER_MODEL_ID)
      ) {
        if (
          validateModelKillSwitch(ALIBABA_QWEN_CHARACTER_MODEL_ID)
          || validateProviderKillSwitch(ALIBABA_QWEN_CHARACTER_MODEL_ID)
          || !isProviderReadyForModel(ALIBABA_QWEN_CHARACTER_MODEL_ID)
        ) {
          throwGuardedAiError({
            code: "AI_PROVIDER_UNAVAILABLE",
            message: "CavBot Companion is temporarily unavailable.",
            status: 503,
            actionId: "AI_PROVIDER_DISABLED",
            role: args.role,
            planId: args.planId,
            details: {
              requestedModel: requested,
              actionClass: args.actionClass,
            },
          });
        }
        return {
          model: ALIBABA_QWEN_CHARACTER_MODEL_ID,
          manualModelSelected: false,
          requestedModel: requested,
          fallbackReason: "companion_model_enforced",
        };
      }
      if (failOpenSelection) {
        const fallbackModel = pickPlanFallbackModel({
          actionClass: args.actionClass,
          planId: args.planId,
          surface: args.surface,
          taskType: args.taskType,
          exclude: [requested],
        });
        if (fallbackModel) {
          return {
            model: fallbackModel,
            manualModelSelected: false,
            requestedModel: requested,
            fallbackReason: "requested_model_not_available_for_plan_fallback",
          };
        }
      }
      throwGuardedAiError({
        code: "AI_MODEL_NOT_ALLOWED_FOR_ACTION",
        message: "Requested model is not available for this action under your current plan.",
        status: 403,
        actionId: "AI_MODEL_PLAN_BLOCKED",
        role: args.role,
        planId: args.planId,
        details: {
          requestedModel: requested,
        },
      });
    }

    if (validateModelKillSwitch(requested) || validateProviderKillSwitch(requested) || !isProviderReadyForModel(requested)) {
      if (args.allowUnavailableProviderFallback) {
        return {
          model: requested,
          manualModelSelected: true,
          requestedModel: requested,
          fallbackReason: "requested_model_provider_unavailable_metadata_access",
        };
      }
      if (failOpenSelection) {
        const fallbackModel = pickPlanFallbackModel({
          actionClass: args.actionClass,
          planId: args.planId,
          surface: args.surface,
          taskType: args.taskType,
          exclude: [requested],
        });
        if (fallbackModel) {
          return {
            model: fallbackModel,
            manualModelSelected: false,
            requestedModel: requested,
            fallbackReason: "requested_model_provider_unavailable_fallback",
          };
        }
      }
      throwGuardedAiError({
        code: "AI_PROVIDER_UNAVAILABLE",
        message: "Selected model is temporarily unavailable.",
        status: 503,
        actionId: "AI_PROVIDER_DISABLED",
        role: args.role,
        planId: args.planId,
      });
    }

    return {
      model: requested,
      manualModelSelected: true,
      requestedModel: requested,
      fallbackReason: null,
    };
  }

  let preferred = preferredAutoModel({
    actionClass: args.actionClass,
    taskType: args.taskType,
    surface: args.surface,
    planId: args.planId,
  });
  if (
    args.surface === "cavcode"
    && (args.planId === "premium" || args.planId === "premium_plus")
    && allowedModels.includes(ALIBABA_QWEN_CODER_MODEL_ID)
  ) {
    preferred = ALIBABA_QWEN_CODER_MODEL_ID;
  }
  const candidates = [
    ...(allowedModels.includes(preferred) ? [preferred] : []),
    ...allowedModels,
  ].filter((id, index, list) => list.indexOf(id) === index);
  let metadataFallbackModel = "";
  for (const candidate of candidates) {
    if (candidate === ALIBABA_QWEN_MAX_MODEL_ID && !isQwenMaxEnabled()) continue;
    if (validateModelKillSwitch(candidate) || validateProviderKillSwitch(candidate)) continue;
    if (!isProviderReadyForModel(candidate)) {
      if (!metadataFallbackModel) metadataFallbackModel = candidate;
      continue;
    }
    return {
      model: candidate,
      manualModelSelected: false,
      requestedModel: requested || null,
      fallbackReason: requested ? "requested_model_not_available_for_plan_or_provider" : null,
    };
  }

  if (args.allowUnavailableProviderFallback && metadataFallbackModel) {
    return {
      model: metadataFallbackModel,
      manualModelSelected: false,
      requestedModel: requested || null,
      fallbackReason: "provider_unavailable_metadata_access",
    };
  }

  throwGuardedAiError({
    code: "AI_PROVIDER_UNAVAILABLE",
    message: "No available AI model could be selected for this action right now.",
    status: 503,
    actionId: "AI_PROVIDER_DISABLED",
    role: args.role,
    planId: args.planId,
    details: {
      actionClass: args.actionClass,
      allowedModels,
    },
  });
}

export type AiExecutionPolicy = {
  planLabel: "CavTower" | "CavControl" | "CavElite";
  actionClass: AiActionClass;
  taskType: AiTaskType | null;
  researchMode: boolean;
  researchToolBundle: AiResearchToolId[];
  weightedUsageUnits: number;
  model: string;
  requestedModel: string | null;
  manualModelSelected: boolean;
  modelFallbackReason: string | null;
  providerId: string;
  reasoningLevel: CavAiReasoningLevel;
  reasoningClamped: boolean;
  maxReasoningLevel: CavAiReasoningLevel;
  requestLimits: RequestLimitProfile;
  rateLimits: RateProfile;
  allowTeamAiAccess: boolean;
  qwenCoderEntitlement: QwenCoderEntitlement | null;
  qwenCoderReservation: QwenCoderReservation | null;
  releaseGenerationSlot: () => void;
};

export async function resolveAiExecutionPolicy(args: {
  accountId: string;
  userId: string;
  memberRole: MemberRole | null | undefined;
  planId: PlanId;
  surface: AiSurface | "center" | "audio";
  action: string;
  taskType?: AiTaskType | null;
  requestedModel?: string | null;
  requestedReasoningLevel?: CavAiReasoningLevel | null;
  promptText?: string | null;
  context?: Record<string, unknown> | null;
  imageAttachmentCount?: number | null;
  fileAttachmentCount?: number | null;
  researchUrlsCount?: number | null;
  sessionId?: string | null;
  requestId?: string | null;
  isExecution: boolean;
}): Promise<AiExecutionPolicy> {
  const role = (s(args.memberRole).toUpperCase() || "ANON") as MemberRole | "ANON";
  const actionClass = classifyAiActionClass({
    surface: args.surface,
    action: args.action,
    taskType: args.taskType,
  });
  const weightedUsageUnits = WEIGHTED_USAGE_UNITS[actionClass];
  const planLabel = toCavAiPlanLabel(args.planId);
  const researchModeRequested = isResearchActionClass(actionClass);
  const requestedResearchToolBundle = resolveResearchToolBundle(actionClass);

  const collabPolicy = await getCavCloudCollabPolicySafe(args.accountId);
  const allowTeamAiAccess = Boolean(collabPolicy.allowTeamAiAccess);
  if (role === "ANON") {
    throwGuardedAiError({
      code: "AI_OWNER_ONLY",
      message: "AI access requires an authenticated owner session.",
      status: 401,
      actionId: "AUTH_REQUIRED",
      role,
      planId: args.planId,
      details: {
        allowTeamAiAccess,
      },
    });
  }
  if (role !== "OWNER" && allowTeamAiAccess !== true) {
    const roleNormalized = s(role).toUpperCase();
    const isTeamRole = roleNormalized === "ADMIN" || roleNormalized === "MEMBER";
    throwGuardedAiError({
      code: isTeamRole ? "AI_TEAM_ACCESS_DISABLED" : "AI_OWNER_ONLY",
      message: isTeamRole
        ? "The workspace owner has disabled team AI access."
        : "AI is owner-only until the workspace owner enables team AI access.",
      status: 403,
      actionId: isTeamRole ? "AI_TEAM_ACCESS_DISABLED" : "AI_OWNER_ONLY",
      role,
      planId: args.planId,
      details: {
        allowTeamAiAccess,
      },
    });
  }

  const requestedReasoningLevel = parseReasoningLevel(
    args.requestedReasoningLevel || defaultReasoningLevelForActionClass(actionClass)
  );
  const maxReasoningLevel = maxReasoningFor({
    actionClass,
    planId: args.planId,
  });
  const reasoning = clampReasoningLevel(requestedReasoningLevel, maxReasoningLevel);
  const requestLimits = requestLimitsForClass(actionClass, args.planId);
  const rateLimits = rateProfileFor({
    actionClass,
    planId: args.planId,
  });

  const promptText = s(args.promptText);
  if (promptText.length > requestLimits.maxPromptChars) {
    throwGuardedAiError({
      code: "AI_PROMPT_TOO_LARGE",
      message: `Prompt exceeds max length for this action class (${requestLimits.maxPromptChars} chars).`,
      status: 400,
      actionId: "AI_USAGE_LIMIT_REACHED",
      role,
      planId: args.planId,
      details: {
        promptChars: promptText.length,
        promptLimit: requestLimits.maxPromptChars,
      },
    });
  }

  const contextChars = normalizeJsonLength(args.context || null);
  if (contextChars > requestLimits.maxContextChars) {
    throwGuardedAiError({
      code: "AI_CONTEXT_TOO_LARGE",
      message: "Context payload exceeds allowed size for this action class.",
      status: 400,
      actionId: "AI_USAGE_LIMIT_REACHED",
      role,
      planId: args.planId,
      details: {
        contextChars,
        contextLimit: requestLimits.maxContextChars,
      },
    });
  }

  const imageAttachmentCount = Math.max(0, Number(args.imageAttachmentCount || 0));
  const fileAttachmentCount = asInt(args.fileAttachmentCount ?? uploadedWorkspaceFileCountFromContext(args.context || null));
  const totalAttachmentCount = imageAttachmentCount + fileAttachmentCount;
  if (totalAttachmentCount > requestLimits.maxImageAttachments) {
    throwGuardedAiError({
      code: "AI_ATTACHMENT_LIMIT_REACHED",
      message: "Attachment count exceeds this action class limit.",
      status: 400,
      actionId: "AI_USAGE_LIMIT_REACHED",
      role,
      planId: args.planId,
      details: {
        imageAttachmentCount,
        fileAttachmentCount,
        totalAttachmentCount,
        imageLimit: requestLimits.maxImageAttachments,
      },
    });
  }

  const researchUrlsCount = Math.max(0, Number(args.researchUrlsCount || 0));
  if (researchUrlsCount > requestLimits.maxResearchUrls) {
    throwGuardedAiError({
      code: "AI_RESEARCH_URL_LIMIT_REACHED",
      message: "URL count exceeds the web research request limit.",
      status: 400,
      actionId: "AI_USAGE_LIMIT_REACHED",
      role,
      planId: args.planId,
      details: {
        researchUrlsCount,
        urlLimit: requestLimits.maxResearchUrls,
      },
    });
  }

  if (args.isExecution) {
    const rateMinute = consumeInMemoryRateLimit({
      key: `ai-rate-minute:${s(args.accountId)}:${s(args.userId)}:${actionClass}`,
      limit: rateLimits.perMinute,
      windowMs: 60_000,
    });
    if (!rateMinute.allowed) {
      throwGuardedAiError({
        code: "AI_RATE_LIMIT_MINUTE",
        message: `Too many AI requests. Retry in ${rateMinute.retryAfterSec}s.`,
        status: 429,
        actionId: "AI_USAGE_LIMIT_REACHED",
        role,
        planId: args.planId,
      });
    }

    const rateHour = consumeInMemoryRateLimit({
      key: `ai-rate-hour:${s(args.accountId)}:${s(args.userId)}:${actionClass}`,
      limit: rateLimits.perHour,
      windowMs: 3_600_000,
    });
    if (!rateHour.allowed) {
      throwGuardedAiError({
        code: "AI_RATE_LIMIT_HOUR",
        message: `Hourly AI request limit reached. Retry in ${rateHour.retryAfterSec}s.`,
        status: 429,
        actionId: "AI_USAGE_LIMIT_REACHED",
        role,
        planId: args.planId,
      });
    }

    await assertSessionDepth({
      accountId: args.accountId,
      sessionId: args.sessionId,
      maxSessionDepth: rateLimits.maxSessionDepth,
      role,
      planId: args.planId,
    });

    const monthUsageUnits = await readMonthlyWeightedUsageUnits(args.accountId);
    const monthBudget = monthlyBudgetForPlan(args.planId);
    if (monthUsageUnits + weightedUsageUnits > monthBudget) {
      throwGuardedAiError({
        code: "AI_MONTHLY_BUDGET_EXCEEDED",
        message: "Monthly AI budget limit reached for this workspace plan.",
        status: 429,
        actionId: "AI_USAGE_LIMIT_REACHED",
        role,
        planId: args.planId,
        details: {
          weightedUnitsUsed: monthUsageUnits,
          weightedUnitsRequested: weightedUsageUnits,
          weightedUnitsBudget: monthBudget,
        },
      });
    }
  }

  const modelSelection = resolveModelForExecution({
    requestedModel: args.requestedModel,
    actionClass,
    role,
    planId: args.planId,
    surface: args.surface,
    taskType: args.taskType,
    allowUnavailableProviderFallback: !args.isExecution,
  });
  const model = modelSelection.model;
  const providerId = resolveProviderIdForModel(model);
  const researchMode = researchModeRequested
    && (model === ALIBABA_QWEN_MAX_MODEL_ID || model === ALIBABA_QWEN_PLUS_MODEL_ID)
    && requestedResearchToolBundle.length > 0;
  const researchToolBundle = researchMode ? requestedResearchToolBundle : [];
  let qwenCoderEntitlement: QwenCoderEntitlement | null = null;
  let qwenCoderReservation: QwenCoderReservation | null = null;

  if (model === ALIBABA_QWEN_CODER_MODEL_ID) {
    const entitlementResult = await getQwenCoderEntitlementSafe({
      accountId: args.accountId,
      userId: args.userId,
      planId: args.planId,
    }) || {
      entitlement: buildQwenCoderEntitlementFallback(args.planId),
    };
    qwenCoderEntitlement = entitlementResult.entitlement;

    if (args.isExecution) {
      if (!entitlementResult.entitlement.selectable) {
        const guard = qwenGuardForEntitlement(entitlementResult.entitlement);
        throwGuardedAiError({
          code: guard.code,
          message: guard.message,
          status: guard.status,
          actionId: guard.actionId,
          role,
          planId: args.planId,
          details: {
            qwenCoderEntitlement: entitlementResult.entitlement,
          },
        });
      }

      const estimate = await estimateQwenCoderCostSafe({
        actionClass,
        taskType: args.taskType || null,
        promptText,
        contextJson: args.context || null,
        maxOutputChars: requestLimits.maxOutputChars,
        expectedRuntimeSeconds: Math.ceil(requestLimits.maxExecutionTimeMs / 1000),
        repoSizeFiles: asInt((args.context as Record<string, unknown> | null)?.projectFilesCount || 0),
        filesTouched: asInt((args.context as Record<string, unknown> | null)?.filesTouchedCount || 0),
        toolCount: actionClass === "premium_plus_heavy_coding" ? 2 : 1,
      });
      const reservation = estimate
        ? await reserveQwenCoderCreditsSafe({
            accountId: args.accountId,
            userId: args.userId,
            planId: args.planId,
            requestId: s(args.requestId) || crypto.randomUUID(),
            modelName: model,
            conversationId: s(args.sessionId) || null,
            taskId: s(args.taskType) || null,
            estimate,
          })
        : null;

      if (reservation && !reservation.ok) {
        const guard = qwenGuardForEntitlement(reservation.entitlement);
        const code = reservation.code === "INSUFFICIENT_CREDITS"
          ? "AI_QWEN_CODER_INSUFFICIENT_CREDITS"
          : guard.code;
        throwGuardedAiError({
          code,
          message: reservation.code === "INSUFFICIENT_CREDITS"
            ? "Not enough Caven Credits are left for this request."
            : guard.message,
          status: guard.status,
          actionId: guard.actionId,
          role,
          planId: args.planId,
          details: {
            qwenCoderEntitlement: reservation.entitlement,
            estimatedCredits: estimate?.finalCredits || 0,
          },
        });
      }
      if (reservation?.ok) {
        qwenCoderReservation = reservation.reservation;
        qwenCoderEntitlement = reservation.entitlement;
      }

    }
  }

  let releaseGenerationSlot = () => {};
  if (args.isExecution) {
    const slot = acquireGenerationSlot({
      accountId: args.accountId,
      userId: args.userId,
      actionClass,
      maxActiveGenerations: rateLimits.maxActiveGenerations,
    });
    if (!slot.ok) {
      throwGuardedAiError({
        code: "AI_ACTIVE_GENERATION_LIMIT",
        message: "Active generation limit reached. Retry after current request finishes.",
        status: 429,
        actionId: "AI_USAGE_LIMIT_REACHED",
        role,
        planId: args.planId,
        details: {
          maxActiveGenerations: rateLimits.maxActiveGenerations,
        },
      });
    }
    releaseGenerationSlot = slot.release;
  }

  return {
    planLabel,
    actionClass,
    taskType: args.taskType || null,
    researchMode,
    researchToolBundle,
    weightedUsageUnits,
    model,
    requestedModel: modelSelection.requestedModel,
    manualModelSelected: modelSelection.manualModelSelected,
    modelFallbackReason: modelSelection.fallbackReason,
    providerId,
    reasoningLevel: reasoning.effective,
    reasoningClamped: reasoning.clamped,
    maxReasoningLevel,
    requestLimits,
    rateLimits,
    allowTeamAiAccess,
    qwenCoderEntitlement,
    qwenCoderReservation,
    releaseGenerationSlot,
  };
}

export function resolveVisibleModelCatalogForPlan(args: {
  planId: PlanId;
  memberRole: MemberRole | null | undefined;
  allowTeamAiAccess: boolean;
  modelCatalog?: AiModelCatalog;
}): AiModelCatalog {
  const role = (s(args.memberRole).toUpperCase() || "ANON") as MemberRole | "ANON";
  const canUseAi = role === "OWNER" || args.allowTeamAiAccess;
  if (!canUseAi) return { text: [], audio: [], image: [] };

  const source = args.modelCatalog || getAiModelCatalog();
  const deepseek = deepSeekModels();
  const allowedText = new Set<string>([deepseek.chat || DEEPSEEK_CHAT_MODEL_ID, ALIBABA_QWEN_FLASH_MODEL_ID]);
  const allowedAudio = new Set<string>([ALIBABA_QWEN_ASR_REALTIME_MODEL_ID]);
  const allowedImage = new Set<string>();
  allowedText.add(ALIBABA_QWEN_CHARACTER_MODEL_ID);
  if (args.planId === "premium" || args.planId === "premium_plus") {
    allowedText.add(deepseek.reasoning);
    allowedText.add(ALIBABA_QWEN_PLUS_MODEL_ID);
    allowedImage.add(ALIBABA_QWEN_IMAGE_MODEL_ID);
  }
  if (args.planId === "premium_plus") {
    if (isQwenMaxEnabled()) {
      allowedText.add(ALIBABA_QWEN_MAX_MODEL_ID);
    }
    allowedImage.add(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
  }
  return {
    text: source.text.filter(
      (item) =>
        allowedText.has(s(item.id))
        && !validateModelKillSwitch(s(item.id))
        && !validateProviderKillSwitch(s(item.id))
    ),
    audio: source.audio.filter(
      (item) =>
        allowedAudio.has(s(item.id))
        && !validateModelKillSwitch(s(item.id))
        && !validateProviderKillSwitch(s(item.id))
    ),
    image: source.image.filter(
      (item) =>
        allowedImage.has(s(item.id))
        && !validateModelKillSwitch(s(item.id))
        && !validateProviderKillSwitch(s(item.id))
    ),
  };
}

export function resolveVisibleModelCatalogForContext(args: {
  planId: PlanId;
  memberRole: MemberRole | null | undefined;
  allowTeamAiAccess: boolean;
  surface: AiSurface | "center" | "audio";
  action: string;
  modelCatalog?: AiModelCatalog;
}): AiModelCatalog {
  const source = args.modelCatalog || getAiModelCatalog();
  const base = resolveVisibleModelCatalogForPlan({
    planId: args.planId,
    memberRole: args.memberRole,
    allowTeamAiAccess: args.allowTeamAiAccess,
    modelCatalog: source,
  });
  if (args.surface !== "cavcode") return base;
  if (args.planId !== "premium" && args.planId !== "premium_plus") {
    return { ...base, text: [], image: [] };
  }
  const coderId = ALIBABA_QWEN_CODER_MODEL_ID;
  const coder = source.text.find((item) => s(item.id) === coderId);
  if (!coder) return { ...base, text: [], image: [] };
  if (validateModelKillSwitch(coderId) || validateProviderKillSwitch(coderId)) return { ...base, text: [], image: [] };
  return {
    ...base,
    text: [coder],
    image: [],
  };
}

export function resolveReasoningDirective(args: {
  level: CavAiReasoningLevel;
  actionClass: AiActionClass;
}): string {
  const level = args.level;
  if (level === "low") {
    return "Reasoning mode LOW: prioritize speed, directness, and short planning depth. Avoid unnecessary decomposition.";
  }
  if (level === "medium") {
    return "Reasoning mode MEDIUM: balance speed with structured reasoning and pragmatic planning.";
  }
  if (level === "high") {
    return "Reasoning mode HIGH: use deeper analysis, explicit step planning, and deliberate synthesis before final output.";
  }
  if (args.actionClass === "premium_plus_web_research") {
    return "Reasoning mode EXTRA HIGH: run deepest web research synthesis with strict source triangulation, extraction, and evidence-first conclusions.";
  }
  if (args.actionClass === "premium_plus_heavy_coding") {
    return "Reasoning mode EXTRA HIGH: perform deepest available multi-step coding analysis with validation mindset and careful tradeoff checks.";
  }
  return "Reasoning mode EXTRA HIGH: apply deep analysis and verification before final output.";
}
