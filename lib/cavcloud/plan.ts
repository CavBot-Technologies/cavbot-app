import { getPlanLimits, resolvePlanIdFromTier, type PlanId } from "@/lib/plans";

export type CavCloudPlanAccountInput = {
  tier?: unknown;
  trialSeatActive?: boolean | null;
  trialEndsAt?: string | number | Date | null;
};

export type CavCloudPlanSubscriptionInput = {
  status?: unknown;
  tier?: unknown;
} | null | undefined;

export type CavCloudResolvedPlan = {
  planId: PlanId;
  trialActive: boolean;
  source: "trial" | "subscription" | "account";
};

function parseEndsAt(value?: string | number | Date | null) {
  if (!value) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = new Date(String(value));
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

function hasPaidSubscriptionStatus(status: unknown) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "TRIALING" || normalized === "PAST_DUE";
}

export function cavcloudPlanRank(planId: PlanId) {
  if (planId === "premium_plus") return 3;
  if (planId === "premium") return 2;
  return 1;
}

export function cavcloudTierTokenForPlanId(planId: PlanId) {
  if (planId === "premium_plus") return "PREMIUM_PLUS";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

export function isCavCloudTrialSeatActive(account?: CavCloudPlanAccountInput | null) {
  const endsAtMs = parseEndsAt(account?.trialEndsAt);
  return Boolean(account?.trialSeatActive) && endsAtMs !== null && endsAtMs > Date.now();
}

export function mergeCavCloudPlanAccounts(
  ...accounts: Array<CavCloudPlanAccountInput | null | undefined>
): CavCloudPlanAccountInput | null {
  const rows = accounts.filter((account): account is CavCloudPlanAccountInput => Boolean(account));
  if (rows.length === 0) return null;

  let bestTier: string | undefined;
  let bestRank = 0;

  for (const row of rows) {
    const rawTier = String(row.tier || "").trim();
    if (!rawTier) continue;
    const rank = cavcloudPlanRank(resolvePlanIdFromTier(rawTier));
    if (!bestTier || rank > bestRank) {
      bestTier = rawTier;
      bestRank = rank;
    }
  }

  const trialRow = rows.find((row) => isCavCloudTrialSeatActive(row))
    ?? rows.find((row) => row.trialSeatActive != null || row.trialEndsAt != null)
    ?? rows[0];

  return {
    tier: bestTier ?? rows[0]?.tier,
    trialSeatActive: trialRow?.trialSeatActive ?? rows[0]?.trialSeatActive ?? null,
    trialEndsAt: trialRow?.trialEndsAt ?? rows[0]?.trialEndsAt ?? null,
  };
}

export function resolveCavCloudEffectivePlan(args: {
  account?: CavCloudPlanAccountInput | null;
  subscription?: CavCloudPlanSubscriptionInput;
}): CavCloudResolvedPlan {
  const account = args.account ?? null;
  const subscription = args.subscription ?? null;

  if (isCavCloudTrialSeatActive(account)) {
    return {
      planId: "premium_plus",
      trialActive: true,
      source: "trial",
    };
  }

  if (hasPaidSubscriptionStatus(subscription?.status)) {
    const accountPlanId = resolvePlanIdFromTier(account?.tier || "FREE");
    const subscriptionPlanId = resolvePlanIdFromTier(subscription?.tier || "FREE");
    const winningPlanId = cavcloudPlanRank(subscriptionPlanId) >= cavcloudPlanRank(accountPlanId)
      ? subscriptionPlanId
      : accountPlanId;
    if (winningPlanId !== "free") {
      return {
        planId: winningPlanId,
        trialActive: false,
        source: winningPlanId === subscriptionPlanId ? "subscription" : "account",
      };
    }
  }

  return {
    planId: resolvePlanIdFromTier(account?.tier || "FREE"),
    trialActive: false,
    source: "account",
  };
}

export function cavcloudStorageLimitBytesForPlan(planId: PlanId, options?: { trialActive?: boolean }) {
  if (options?.trialActive) return null;
  const limits = getPlanLimits(planId);
  if (limits.storageGb === "unlimited") return null;
  const bytes = Number(limits.storageGb || 0) * 1024 * 1024 * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.trunc(bytes);
}

export function cavcloudStorageLimitBytesBigIntForPlan(planId: PlanId, options?: { trialActive?: boolean }) {
  const bytes = cavcloudStorageLimitBytesForPlan(planId, options);
  return bytes == null ? null : BigInt(bytes);
}

export function cavcloudPerFileMaxBytesForPlan(planId: PlanId) {
  const free = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_FREE", 64 * 1024 * 1024);
  const premium = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM", 1024 * 1024 * 1024);
  const premiumPlus = envPositiveInt("CAVCLOUD_MAX_FILE_BYTES_PREMIUM_PLUS", 5 * 1024 * 1024 * 1024);
  if (planId === "premium_plus") return premiumPlus;
  if (planId === "premium") return premium;
  return free;
}

export function cavcloudPerFileMaxBytesBigIntForPlan(planId: PlanId) {
  return BigInt(cavcloudPerFileMaxBytesForPlan(planId));
}
