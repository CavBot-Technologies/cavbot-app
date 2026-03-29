import type { CavGuardActorPlan, CavGuardActorRole, CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";

type CavGuardDecisionContext = {
  role?: CavGuardActorRole | string | null;
  plan?: CavGuardActorPlan | string | null;
  flags?: Record<string, unknown> | null;
};

const PREMIUM_PLUS_UPGRADE_HREF = "/settings/upgrade?plan=premium_plus&billing=monthly";
const PREMIUM_UPGRADE_HREF = "/settings/upgrade?plan=premium&billing=monthly";
const VIEW_PLANS_HREF = "/plan?billing=monthly";

function normalizeRole(role: CavGuardDecisionContext["role"]): CavGuardActorRole | undefined {
  const value = String(role || "").trim().toUpperCase();
  if (value === "OWNER" || value === "ADMIN" || value === "MEMBER" || value === "ANON") {
    return value as CavGuardActorRole;
  }
  return undefined;
}

function normalizePlan(plan: CavGuardDecisionContext["plan"]): CavGuardActorPlan | undefined {
  const value = String(plan || "").trim().toUpperCase();
  if (value === "FREE" || value === "PREMIUM" || value === "PREMIUM_PLUS") {
    return value as CavGuardActorPlan;
  }
  return undefined;
}

function planLabel(plan: CavGuardActorPlan | undefined): string {
  if (plan === "PREMIUM_PLUS") return "CavElite";
  if (plan === "PREMIUM") return "CavControl";
  return "CavTower";
}

function readStepUp(flags: Record<string, unknown> | null | undefined): CavGuardDecision["stepUp"] {
  const reason = String(flags?.stepUpReason || "").trim();
  if (!reason) return null;
  return { kind: "CAVERIFY", reason };
}

function readSettingsSurface(flags: Record<string, unknown> | null | undefined): string {
  const value = String(flags?.settingsSurface || "").trim();
  return value || "Workspace";
}

function parseIsoDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

function toShortDateLabel(value: unknown): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toCountdownLabel(value: unknown): string | null {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const diffMs = Math.max(0, parsed.getTime() - Date.now());
  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  if (days > 0) return `${days}d ${remHours}h`;
  const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${Math.max(0, remHours)}h ${Math.max(0, mins)}m`;
}

function readQwenEntitlementLike(flags: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  const direct = flags?.qwenCoderEntitlement;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  return null;
}

function readQwenResetDate(flags: Record<string, unknown> | null | undefined): string | null {
  const entitlement = readQwenEntitlementLike(flags);
  return toShortDateLabel(flags?.qwenResetAt || entitlement?.resetAt || null);
}

function readQwenCooldownCountdown(flags: Record<string, unknown> | null | undefined): string | null {
  const entitlement = readQwenEntitlementLike(flags);
  return toCountdownLabel(flags?.qwenCooldownEndsAt || entitlement?.cooldownEndsAt || null);
}

function withCommon(decision: CavGuardDecision, ctx: CavGuardDecisionContext): CavGuardDecision {
  const role = normalizeRole(ctx.role);
  const plan = normalizePlan(ctx.plan);
  return {
    ...decision,
    actorRole: decision.actorRole ?? role,
    actorPlan: decision.actorPlan ?? plan,
    cta: decision.cta ?? null,
    stepUp: decision.stepUp ?? readStepUp(ctx.flags),
  };
}

export function buildCavGuardDecision(actionId: string, ctx: CavGuardDecisionContext): CavGuardDecision {
  const role = normalizeRole(ctx.role);
  const plan = normalizePlan(ctx.plan);
  const settingsSurface = readSettingsSurface(ctx.flags);

  switch (String(actionId || "").trim()) {
    case "AUTH_REQUIRED":
      return withCommon(
        {
          code: "AUTH_REQUIRED",
          actionId: "AUTH_REQUIRED",
          actorRole: role || "ANON",
          title: "Sign in required.",
          request: "Access protected content.",
          reason: "No active session was found for this request.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "SETTINGS_OWNER_ONLY":
      return withCommon(
        {
          code: "OWNER_ONLY",
          actionId: "SETTINGS_OWNER_ONLY",
          actorRole: role,
          title: "Settings restricted.",
          request: `Open ${settingsSurface} settings.`,
          reason: `${settingsSurface} settings are available to the workspace owner only.`,
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "NOTIFICATIONS_OWNER_ONLY":
      return withCommon(
        {
          code: "OWNER_ONLY",
          actionId: "NOTIFICATIONS_OWNER_ONLY",
          actorRole: role,
          title: "Notifications restricted.",
          request: "Open notifications.",
          reason: "Notifications are owner-controlled in this workspace.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "CAVSAFE_OWNER_ONLY":
      return withCommon(
        {
          code: "OWNER_ONLY",
          actionId: "CAVSAFE_OWNER_ONLY",
          actorRole: role,
          title: "CavSafe restricted.",
          request: "Open CavSafe.",
          reason: "CavSafe access is restricted to the workspace owner.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "CAVSAFE_PLAN_REQUIRED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "CAVSAFE_PLAN_REQUIRED",
          actorPlan: plan || "FREE",
          title: "Upgrade required.",
          request: "Access CavSafe.",
          reason: "CavSafe requires an upgraded workspace plan.",
          cta: { label: "Upgrade", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "MOVE_TO_CAVSAFE_PLAN_REQUIRED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "MOVE_TO_CAVSAFE_PLAN_REQUIRED",
          actorPlan: plan || "FREE",
          title: "Upgrade required.",
          request: "Move item to CavSafe.",
          reason: "Moving items into CavSafe requires an upgraded workspace plan.",
          cta: { label: "Upgrade", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "CAVSAFE_ACL_DENIED":
      return withCommon(
        {
          code: "ACL_DENIED",
          actionId: "CAVSAFE_ACL_DENIED",
          title: "Unauthorized action blocked.",
          request: "Open CavSafe item.",
          reason: "This CavSafe item is restricted to approved collaborators.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "ARCADE_ACCESS_BLOCKED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "ARCADE_ACCESS_BLOCKED",
          actorRole: role,
          title: "Arcade access blocked.",
          request: "Open Arcade.",
          reason: "Arcade is owner-only unless the owner enables collaborator access.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "ARCADE_CONTROLS_PLAN_REQUIRED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "ARCADE_CONTROLS_PLAN_REQUIRED",
          actorPlan: plan || "FREE",
          title: "Arcade access.",
          request: "Enable Arcade access controls.",
          reason: "An upgraded workspace plan is required to enable Arcade access controls.",
          cta: { label: "Unlock Arcade", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_OWNER_ONLY":
      return withCommon(
        {
          code: "OWNER_ONLY",
          actionId: "AI_OWNER_ONLY",
          actorRole: role,
          title: "AI is owner-only.",
          request: "Use CavAi features.",
          reason: "AI is owner-only by default in this workspace.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "AI_TEAM_ACCESS_DISABLED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_TEAM_ACCESS_DISABLED",
          actorRole: role,
          title: "AI access disabled for team.",
          request: "Use CavAi features.",
          reason: "The workspace owner disabled team AI access.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "AI_PLAN_ACTION_BLOCKED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "AI_PLAN_ACTION_BLOCKED",
          actorPlan: plan || "FREE",
          title: "Plan limit reached.",
          request: "Run this AI action.",
          reason: `${planLabel(plan)} does not include this AI action class.`,
          cta: { label: "Upgrade", href: PREMIUM_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_MODEL_PLAN_BLOCKED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "AI_MODEL_PLAN_BLOCKED",
          actorPlan: plan || "FREE",
          title: "Model restricted.",
          request: "Use selected AI model.",
          reason: "Selected model is not available on this plan tier.",
          cta: { label: "Upgrade", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_QWEN_CODER_UNLOCK_REQUIRED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "AI_QWEN_CODER_UNLOCK_REQUIRED",
          actorPlan: plan || "FREE",
          title: "Unlock Caven",
          request: "Open Caven.",
          reason: "Caven is available on Premium and Premium+.",
          cta: { label: "Upgrade", href: PREMIUM_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_QWEN_CODER_COOLDOWN":
      {
        const countdown = readQwenCooldownCountdown(ctx.flags);
        const reason = countdown
          ? `Your next Premium coding window opens in ${countdown}. Upgrade to Premium+ for uninterrupted Caven access.`
          : "Your next Premium coding window opens soon. Upgrade to Premium+ for uninterrupted Caven access.";
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_QWEN_CODER_COOLDOWN",
          actorPlan: plan || "PREMIUM",
          title: "Caven cooling down",
          request: "Start another Caven run.",
          reason,
          cta: { label: "Upgrade to Premium+", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );
      }

    case "AI_QWEN_CODER_PREMIUM_EXHAUSTED":
      {
        const resetOn = readQwenResetDate(ctx.flags);
        const reason = resetOn
          ? `Your included Premium coding credits reset on ${resetOn}. Upgrade to Premium+ to continue using Caven now.`
          : "Your included Premium coding credits reset at the next billing cycle.";
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_QWEN_CODER_PREMIUM_EXHAUSTED",
          actorPlan: plan || "PREMIUM",
          title: "Premium Caven credits exhausted",
          request: "Start another Caven run.",
          reason,
          cta: { label: "Upgrade to Premium+", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );
      }

    case "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED":
      {
        const resetOn = readQwenResetDate(ctx.flags);
        const reason = resetOn
          ? `Your monthly Caven credits reset on ${resetOn}.`
          : "Your monthly Caven credits reset at the next billing cycle.";
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED",
          actorPlan: plan || "PREMIUM_PLUS",
          title: "Premium+ Caven credits exhausted",
          request: "Start another Caven run.",
          reason,
          cta: { label: "View Plans", href: VIEW_PLANS_HREF },
          stepUp: null,
        },
        ctx,
      );
      }

    case "AI_REASONING_LEVEL_BLOCKED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_REASONING_LEVEL_BLOCKED",
          actorPlan: plan || "FREE",
          title: "Reasoning level adjusted.",
          request: "Use selected reasoning level.",
          reason: "Selected reasoning level is not available on the current plan tier.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "AI_USAGE_LIMIT_REACHED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_USAGE_LIMIT_REACHED",
          actorPlan: plan || "FREE",
          title: "AI usage limit reached.",
          request: "Run another AI action.",
          reason: "Usage throttles or weighted budget limits were reached.",
          cta: { label: "Upgrade", href: PREMIUM_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_ADVANCED_CODING_RESTRICTED":
      return withCommon(
        {
          code: "PLAN_REQUIRED",
          actionId: "AI_ADVANCED_CODING_RESTRICTED",
          actorPlan: plan || "FREE",
          title: "Advanced coding lane restricted.",
          request: "Run Premium+ heavy coding workflow.",
          reason: "Advanced coding actions require CavElite.",
          cta: { label: "Unlock CavElite", href: PREMIUM_PLUS_UPGRADE_HREF },
          stepUp: null,
        },
        ctx,
      );

    case "AI_ACTION_CLASS_BLOCKED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_ACTION_CLASS_BLOCKED",
          actorPlan: plan || "FREE",
          title: "Action class unavailable.",
          request: "Run selected AI workflow.",
          reason: "This action class is currently unavailable for your workspace policy.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    case "AI_PROVIDER_DISABLED":
      return withCommon(
        {
          code: "FEATURE_DISABLED",
          actionId: "AI_PROVIDER_DISABLED",
          actorPlan: plan || "FREE",
          title: "AI provider unavailable.",
          request: "Run selected AI model.",
          reason: "Model or provider is temporarily disabled. Retry or choose another allowed model.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );

    default:
      return withCommon(
        {
          code: "ROLE_BLOCKED",
          actionId: String(actionId || "ROLE_BLOCKED"),
          actorRole: role,
          title: "Unauthorized action blocked.",
          request: "Access protected workspace action.",
          reason: "This action is restricted by workspace access controls.",
          cta: null,
          stepUp: null,
        },
        ctx,
      );
  }
}

export type { CavGuardDecisionContext };
