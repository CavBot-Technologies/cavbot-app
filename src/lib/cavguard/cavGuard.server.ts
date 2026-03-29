import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import type { CavGuardActorPlan, CavGuardActorRole, CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";

type BuildGuardPayloadArgs = {
  actionId?: string | null;
  status?: number | null;
  errorCode?: string | null;
  role?: CavGuardActorRole | string | null;
  plan?: CavGuardActorPlan | string | null;
  flags?: Record<string, unknown> | null;
};

function normalizeStatus(status: unknown): number {
  const value = Number(status);
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function resolveActionId(args: BuildGuardPayloadArgs): string | null {
  const explicit = String(args.actionId || "").trim();
  if (explicit) return explicit;

  const status = normalizeStatus(args.status);
  const errorCode = String(args.errorCode || "").trim().toUpperCase();
  if (errorCode === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (errorCode === "SETTINGS_OWNER_ONLY") return "SETTINGS_OWNER_ONLY";
  if (errorCode === "NOTIFICATIONS_OWNER_ONLY") return "NOTIFICATIONS_OWNER_ONLY";
  if (errorCode === "CAVSAFE_OWNER_ONLY") return "CAVSAFE_OWNER_ONLY";
  if (errorCode === "CAVSAFE_PLAN_REQUIRED") return "CAVSAFE_PLAN_REQUIRED";
  if (errorCode === "MOVE_TO_CAVSAFE_PLAN_REQUIRED") return "MOVE_TO_CAVSAFE_PLAN_REQUIRED";
  if (errorCode === "CAVSAFE_ACL_DENIED") return "CAVSAFE_ACL_DENIED";
  if (errorCode === "ARCADE_ACCESS_BLOCKED") return "ARCADE_ACCESS_BLOCKED";
  if (errorCode === "ARCADE_CONTROLS_PLAN_REQUIRED") return "ARCADE_CONTROLS_PLAN_REQUIRED";
  if (errorCode === "AI_OWNER_ONLY") return "AI_OWNER_ONLY";
  if (errorCode === "AI_TEAM_ACCESS_DISABLED") return "AI_TEAM_ACCESS_DISABLED";
  if (errorCode === "AI_PLAN_ACTION_BLOCKED") return "AI_PLAN_ACTION_BLOCKED";
  if (errorCode === "AI_MODEL_PLAN_BLOCKED") return "AI_MODEL_PLAN_BLOCKED";
  if (errorCode === "AI_QWEN_CODER_UNLOCK_REQUIRED") return "AI_QWEN_CODER_UNLOCK_REQUIRED";
  if (errorCode === "AI_QWEN_CODER_COOLDOWN") return "AI_QWEN_CODER_COOLDOWN";
  if (errorCode === "AI_QWEN_CODER_PREMIUM_EXHAUSTED") return "AI_QWEN_CODER_PREMIUM_EXHAUSTED";
  if (errorCode === "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED") return "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED";
  if (errorCode === "AI_QWEN_CODER_INSUFFICIENT_CREDITS") return "AI_QWEN_CODER_PREMIUM_EXHAUSTED";
  if (errorCode === "AI_REASONING_LEVEL_BLOCKED") return "AI_REASONING_LEVEL_BLOCKED";
  if (errorCode === "AI_USAGE_LIMIT_REACHED") return "AI_USAGE_LIMIT_REACHED";
  if (errorCode === "AI_ADVANCED_CODING_RESTRICTED") return "AI_ADVANCED_CODING_RESTRICTED";
  if (errorCode === "AI_ACTION_CLASS_BLOCKED") return "AI_ACTION_CLASS_BLOCKED";
  if (errorCode === "AI_PROVIDER_DISABLED") return "AI_PROVIDER_DISABLED";
  if (status === 401) return "AUTH_REQUIRED";

  if (errorCode === "PLAN_REQUIRED") return "CAVSAFE_PLAN_REQUIRED";
  if (errorCode === "PLAN_UPGRADE_REQUIRED") return "CAVSAFE_PLAN_REQUIRED";
  if (errorCode === "OWNER_REQUIRED") return "CAVSAFE_OWNER_ONLY";
  if (errorCode === "AI_ACTION_CLASS_NOT_ALLOWED") return "AI_PLAN_ACTION_BLOCKED";
  if (errorCode === "AI_MODEL_NOT_ALLOWED_FOR_ACTION") return "AI_MODEL_PLAN_BLOCKED";
  if (errorCode === "AI_MODEL_DISABLED" || errorCode === "AI_MODEL_UNAVAILABLE" || errorCode === "AI_PROVIDER_UNAVAILABLE") return "AI_PROVIDER_DISABLED";
  if (errorCode === "AI_MONTHLY_BUDGET_EXCEEDED" || errorCode === "AI_RATE_LIMIT_MINUTE" || errorCode === "AI_RATE_LIMIT_HOUR") return "AI_USAGE_LIMIT_REACHED";
  if (errorCode === "AI_QWEN_CODER_UNLOCK_REQUIRED") return "AI_QWEN_CODER_UNLOCK_REQUIRED";
  if (errorCode === "AI_QWEN_CODER_COOLDOWN") return "AI_QWEN_CODER_COOLDOWN";
  if (errorCode === "AI_QWEN_CODER_PREMIUM_EXHAUSTED") return "AI_QWEN_CODER_PREMIUM_EXHAUSTED";
  if (errorCode === "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED") return "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED";
  if (errorCode === "AI_RESEARCH_NOT_ENABLED") return "AI_ACTION_CLASS_BLOCKED";
  if (errorCode === "ACL_DENIED" || errorCode === "CAVSAFE_ACL_DENIED") return "CAVSAFE_ACL_DENIED";
  if (errorCode.includes("DENIED")) return "CAVSAFE_ACL_DENIED";

  if (status === 403) return "ROLE_BLOCKED";
  return null;
}

export function buildGuardDecisionPayload(args: BuildGuardPayloadArgs): { guardDecision: CavGuardDecision } | null {
  const actionId = resolveActionId(args);
  if (!actionId) return null;
  return {
    guardDecision: buildCavGuardDecision(actionId, {
      role: args.role,
      plan: args.plan,
      flags: args.flags,
    }),
  };
}
