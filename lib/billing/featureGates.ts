import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import type { WidgetStyle, WidgetType } from "@/lib/settings/snippetGenerators";

export type Tier = PlanId;

export type WidgetFeature = "badge_inline" | "badge_ring" | "head_orbit" | "body_full";

export type AccountTierContext = {
  tier?: string | null;
  tierEffective?: string | null;
  trialSeatActive?: boolean | null;
  trialEndsAt?: string | number | Date | null;
  trialEverUsed?: boolean | null;
};

function parseEndsAt(value?: string | number | Date | null) {
  if (!value) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = new Date(String(value));
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function computeTierToken(account?: AccountTierContext | null) {
  const now = Date.now();
  const endsAtMs = parseEndsAt(account?.trialEndsAt);
  const trialActive = Boolean(account?.trialSeatActive) && endsAtMs !== null && endsAtMs > now;

  let token = String(account?.tierEffective || account?.tier || "FREE").trim();
  if (!token) token = "FREE";
  const normalized = token.toUpperCase();
  if (normalized === "ENTERPRISE") return "PREMIUM_PLUS";
  if (trialActive) return "PREMIUM_PLUS";
  return normalized;
}

export function resolveTierFromAccount(account?: AccountTierContext | null): Tier {
  const token = computeTierToken(account);
  return resolvePlanIdFromTier(token) as Tier;
}

export function widgetFeatureFromWidget(widget: WidgetType, style: WidgetStyle): WidgetFeature {
  if (widget === "badge") {
    return style === "ring" ? "badge_ring" : "badge_inline";
  }
  if (widget === "head") {
    return "head_orbit";
  }
  return "body_full";
}

export function canUseWidgetFeature(tier: Tier, feature: WidgetFeature): boolean {
  if (feature === "badge_inline" || feature === "badge_ring") {
    return true;
  }
  if (feature === "head_orbit") {
    return tier === "premium" || tier === "premium_plus";
  }
  if (feature === "body_full") {
    return tier === "premium_plus";
  }
  return true;
}

export function gateCopy(
  tier: Tier,
  feature: WidgetFeature
): {
  allowed: boolean;
  reasonTitle: string;
  reasonBody: string;
  upsellTier: "premium" | "premium_plus" | null;
} {
  if (feature === "badge_inline" || feature === "badge_ring") {
    return { allowed: true, reasonTitle: "", reasonBody: "", upsellTier: null };
  }

  if (feature === "head_orbit") {
    const allowed = tier === "premium" || tier === "premium_plus";
    if (allowed) {
      return { allowed: true, reasonTitle: "", reasonBody: "", upsellTier: null };
    }
    return {
      allowed: false,
      reasonTitle: "Unlock CavBot’s animated presence",
      reasonBody: "Upgrade to Premium to enable Head orbit on your sites.",
      upsellTier: "premium",
    };
  }

  if (feature === "body_full") {
    const allowed = tier === "premium_plus";
    if (allowed) {
      return { allowed: true, reasonTitle: "", reasonBody: "", upsellTier: null };
    }
    return {
      allowed: false,
      reasonTitle: "Unlock CavBot’s full presence",
      reasonBody: "Upgrade to Premium+ to enable the Full body widget.",
      upsellTier: "premium_plus",
    };
  }

  return { allowed: true, reasonTitle: "", reasonBody: "", upsellTier: null };
}
