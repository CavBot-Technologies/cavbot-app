import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";
const PLAN_CONTEXT_KEY = "cb_plan_context_v1";

export type ClientBootMemberRole = "OWNER" | "ADMIN" | "MEMBER" | null;
export type ClientBootPlanTier = "FREE" | "PREMIUM" | "PREMIUM_PLUS";
export type ClientBootPlanLabel = "FREE" | "PREMIUM" | "PREMIUM+";

export type ClientBootPlanState = {
  planId: PlanId;
  planTier: ClientBootPlanTier;
  planLabel: ClientBootPlanLabel;
  memberRole: ClientBootMemberRole;
  trialActive: boolean;
  trialDaysLeft: number;
};

export type ClientBootProfileState = {
  fullName: string;
  email: string;
  username: string;
  initials: string;
  avatarTone: string;
  avatarImage: string;
  publicProfileEnabled: boolean | null;
};

export type ClientBootSessionState = {
  userId: string;
  accountId: string;
  memberRole: Exclude<ClientBootMemberRole, null>;
};

export type CavbotClientAuthBootstrap = {
  authenticated: boolean;
  session: ClientBootSessionState | null;
  profile: ClientBootProfileState | null;
  plan: ClientBootPlanState | null;
  ts: number;
};

type StoredPlanSnapshot = {
  planTier?: unknown;
  memberRole?: unknown;
  trialActive?: unknown;
  trialDaysLeft?: unknown;
};

type StoredPlanContext = {
  planKey?: unknown;
  planLabel?: unknown;
  planTier?: unknown;
  memberRole?: unknown;
  trialActive?: unknown;
  trialDaysLeft?: unknown;
};

function s(value: unknown) {
  return String(value ?? "").trim();
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readLocalStoreItem(key: string) {
  if (typeof window === "undefined" || typeof globalThis.__cbLocalStore === "undefined") return "";
  try {
    return s(globalThis.__cbLocalStore.getItem(key));
  } catch {
    return "";
  }
}

function normalizeMemberRole(value: unknown): ClientBootMemberRole {
  const role = s(value).toUpperCase();
  if (role === "OWNER" || role === "ADMIN" || role === "MEMBER") return role;
  return null;
}

function normalizePlanTier(value: unknown): ClientBootPlanTier {
  const planId = resolvePlanIdFromTier(value || "free");
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function planLabelForTier(planTier: ClientBootPlanTier): ClientBootPlanLabel {
  if (planTier === "PREMIUM_PLUS") return "PREMIUM+";
  if (planTier === "PREMIUM") return "PREMIUM";
  return "FREE";
}

function planIdForTier(planTier: ClientBootPlanTier): PlanId {
  return planTier === "PREMIUM_PLUS" ? "premium_plus" : planTier === "PREMIUM" ? "premium" : "free";
}

function normalizeTrialDays(trialActive: boolean, value: unknown) {
  const days = Number(value);
  if (!trialActive || !Number.isFinite(days) || days <= 0) return 0;
  return Math.max(0, Math.trunc(days));
}

function parsePublicProfileEnabled(rawValue: string, fallback?: boolean | null) {
  const raw = rawValue.toLowerCase();
  if (raw === "1" || raw === "true" || raw === "public") return true;
  if (raw === "0" || raw === "false" || raw === "private") return false;
  return typeof fallback === "boolean" ? fallback : null;
}

function normalizeBootstrapPayload(value: unknown): CavbotClientAuthBootstrap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const authenticated = Boolean(row.authenticated);
  const planRow = row.plan && typeof row.plan === "object" && !Array.isArray(row.plan)
    ? (row.plan as Record<string, unknown>)
    : null;
  const profileRow = row.profile && typeof row.profile === "object" && !Array.isArray(row.profile)
    ? (row.profile as Record<string, unknown>)
    : null;
  const sessionRow = row.session && typeof row.session === "object" && !Array.isArray(row.session)
    ? (row.session as Record<string, unknown>)
    : null;
  const planTier = planRow ? normalizePlanTier(planRow.planTier || planRow.planId || planRow.planLabel) : "FREE";
  const trialActive = Boolean(planRow?.trialActive);
  return {
    authenticated,
    session: authenticated && sessionRow
      ? {
          userId: s(sessionRow.userId),
          accountId: s(sessionRow.accountId),
          memberRole: (normalizeMemberRole(sessionRow.memberRole) || "MEMBER") as Exclude<ClientBootMemberRole, null>,
        }
      : null,
    profile: authenticated && profileRow
      ? {
          fullName: s(profileRow.fullName),
          email: s(profileRow.email),
          username: s(profileRow.username),
          initials: s(profileRow.initials).slice(0, 3).toUpperCase(),
          avatarTone: s(profileRow.avatarTone).toLowerCase() || "lime",
          avatarImage: s(profileRow.avatarImage),
          publicProfileEnabled:
            typeof profileRow.publicProfileEnabled === "boolean" ? profileRow.publicProfileEnabled : null,
        }
      : null,
    plan: authenticated && planRow
      ? {
          planId: planIdForTier(planTier),
          planTier,
          planLabel: planLabelForTier(planTier),
          memberRole: normalizeMemberRole(planRow.memberRole),
          trialActive,
          trialDaysLeft: normalizeTrialDays(trialActive, planRow.trialDaysLeft),
        }
      : null,
    ts: Number(row.ts) > 0 ? Math.trunc(Number(row.ts)) : Date.now(),
  };
}

export function readBootClientAuthBootstrap(): CavbotClientAuthBootstrap | null {
  if (typeof window === "undefined") return null;
  return normalizeBootstrapPayload(globalThis.__CB_AUTH_BOOTSTRAP__);
}

export function readBootClientPlanState(): ClientBootPlanState | null {
  const snapshot = safeJsonParse<StoredPlanSnapshot>(readLocalStoreItem(SHELL_PLAN_SNAPSHOT_KEY));
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const planTier = normalizePlanTier(snapshot.planTier);
    const trialActive = Boolean(snapshot.trialActive);
    return {
      planId: planIdForTier(planTier),
      planTier,
      planLabel: planLabelForTier(planTier),
      memberRole: normalizeMemberRole(snapshot.memberRole),
      trialActive,
      trialDaysLeft: normalizeTrialDays(trialActive, snapshot.trialDaysLeft),
    };
  }

  const detail = safeJsonParse<StoredPlanContext>(readLocalStoreItem(PLAN_CONTEXT_KEY));
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const planTier = normalizePlanTier(detail.planKey || detail.planTier || detail.planLabel);
    const trialActive = Boolean(detail.trialActive);
    return {
      planId: planIdForTier(planTier),
      planTier,
      planLabel: planLabelForTier(planTier),
      memberRole: normalizeMemberRole(detail.memberRole),
      trialActive,
      trialDaysLeft: normalizeTrialDays(trialActive, detail.trialDaysLeft),
    };
  }

  return readBootClientAuthBootstrap()?.plan ?? null;
}

export function readBootClientProfileState(): ClientBootProfileState | null {
  const boot = readBootClientAuthBootstrap();
  const fallback = boot?.profile ?? null;
  const fullName = readLocalStoreItem("cb_profile_fullName_v1") || s(fallback?.fullName);
  const email = readLocalStoreItem("cb_profile_email_v1") || s(fallback?.email);
  const username = readLocalStoreItem("cb_profile_username_v1") || s(fallback?.username);
  const initials = (readLocalStoreItem("cb_account_initials") || s(fallback?.initials)).slice(0, 3).toUpperCase();
  const avatarTone = (readLocalStoreItem("cb_settings_avatar_tone_v2") || s(fallback?.avatarTone)).toLowerCase() || "lime";
  const avatarImage = readLocalStoreItem("cb_settings_avatar_image_v2") || s(fallback?.avatarImage);
  const publicProfileEnabled = parsePublicProfileEnabled(
    readLocalStoreItem("cb_profile_public_enabled_v1"),
    fallback?.publicProfileEnabled,
  );

  if (!fullName && !email && !username && !initials && !avatarImage && !fallback) return null;
  return {
    fullName,
    email,
    username,
    initials,
    avatarTone,
    avatarImage,
    publicProfileEnabled,
  };
}
