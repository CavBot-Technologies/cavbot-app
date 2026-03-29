// /lib/plans.ts
// CavBot Plan System (Source of Truth)
// - Defines plan IDs, display names, pricing, feature limits, modules, and recommendations
// - Used by UI + API guardrails to enforce limits

export type PlanId = "free" | "premium" | "premium_plus";
export type BillingCycle = "monthly" | "annual";
export type ModuleId = "errors" | "seo" | "a11y" | "insights";

export type PlanPricing = {
  monthly?: { price: number; unit?: string; note?: string };
  annual?: { price: number; unit?: string; note?: string };
};

export type PlanLimits = {
  websites: number | "unlimited";
  seats: number;
  arcadeUnlocked: number | "all";
  storageGb?: number | "unlimited";
  cavSafeSecuredStorageGb?: number | "unlimited";
  scansPerMonth: number;
  pagesPerScan: number;
};

export type PlanModules = Record<ModuleId, boolean>;

export type PlanDefinition = {
  id: PlanId;
  displayName: string; // CavTower, CavControl, CavElite
  tierLabel: string; // FREE TIER, PREMIUM, PREMIUM+
  description: string;
  recommended?: boolean;

  pricing: PlanPricing;
  limits: PlanLimits;
  modules: PlanModules;

  includes: string[];
  footnote?: string;
};

type RawTierInput = {
  tier?: string;
  tierEffective?: string;
} & Record<string, unknown>;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    displayName: "CavTower",
    tierLabel: "FREE TIER",
    description:
      "A clean entry into CavBot — command access, routing control, and one arcade experience enabled.",
    recommended: false,
    pricing: {
      monthly: { price: 0, unit: "/ month", note: "" },
      annual: { price: 0, unit: "/ year", note: "" },
    },
    limits: {
      websites: 1,
      seats: 4,
      arcadeUnlocked: 1,
      storageGb: 5,
      cavSafeSecuredStorageGb: 0,
      scansPerMonth: 5,
      pagesPerScan: 5,
    },
    modules: {
      errors: false,
      seo: false,
      a11y: false,
      insights: false,
    },
    includes: [
      "Caven Credits: Not included on Free",
      "CavCloud storage: 5 GB",
      "CavSafe (locked)",
      "1 arcade game available",
      "Dashboard",
      "Badge widget (Inline / Ring)",
      "Routing",
      "Control Room",
      "1 website",
      "4 seats included",
    ],
    footnote: "Start with visibility. Upgrade when you’re ready to run CavBot at full power.",
  },

  premium: {
    id: "premium",
    displayName: "CavControl",
    tierLabel: "PREMIUM",
    description:
      "Built for serious teams — deeper visibility, stronger monitoring, and limited Caven capacity for monthly coding work.",
    recommended: true,
    pricing: {
      monthly: {
        price: 19.99,
        unit: "/ month",
        note: "Billed monthly — cancel anytime.",
      },
      annual: {
        price: 199.99,
        unit: "/ year",
        note: "Billed annually — Save 17% vs monthly.",
      },
    },
    limits: {
      websites: 6,
      seats: 8,
      arcadeUnlocked: 3,
      storageGb: 50,
      cavSafeSecuredStorageGb: 10,
      scansPerMonth: 50,
      pagesPerScan: 100,
    },
    modules: {
      errors: true,
      seo: true,
      a11y: false,
      insights: false,
    },
    includes: [
      "Caven Credits: 400 / month",
      "Caven is powered by Qwen3-Coder",
      "CavCloud storage: 50 GB",
      "CavSafe (Owner-only) + 10GB Secured Storage",
      "3 arcade games unlocked",
      "Proactive diagnostics + anomaly watch",
      "Badge + Head orbit widgets",
      "Expanded workspace capacity",
      "6 websites",
      "8 seats included",
    ],
    footnote: "Premium is the operational upgrade — deeper signal, stronger coverage, real control.",
  },

  premium_plus: {
    id: "premium_plus",
    displayName: "CavElite",
    tierLabel: "PREMIUM+",
    description:
      "Maximum CavBot access — every intelligence module, high-capacity scale, and a high monthly Caven allowance with rollover.",
    recommended: true,
    pricing: {
      monthly: {
        price: 39.99,
        unit: "/ month",
        note: "Billed monthly — cancel anytime.",
      },
      annual: {
        price: 399.99,
        unit: "/ year",
        note: "Billed annually — Save 17% vs monthly.",
      },
    },
    limits: {
      websites: 20,
      seats: 16,
      arcadeUnlocked: "all",
      storageGb: 500,
      cavSafeSecuredStorageGb: 50,
      scansPerMonth: 500,
      pagesPerScan: 1000,
    },
    modules: {
      errors: true,
      seo: true,
      a11y: true,
      insights: true,
    },
    includes: [
      "Caven Credits: 4,000 / month + rollover up to one extra month",
      "Caven is powered by Qwen3-Coder",
      "CavCloud storage: 500 GB",
      "CavSafe (Owner-only) + 50GB Secured Storage + Integrity Lock + Audit Log + Mountable CavSafe + Time Locks + Snapshots + CavSafe Analytics",
      "All arcade games unlocked",
      "Always-on diagnostics + incident readiness",
      "20 websites",
      "16 seats included",
      "Full widget core (Badge + Head + Full body)",
    ],
    footnote: "CavElite is CavBot at full scale — full intelligence, elite reliability, and high-capacity workspace limits.",
  },
};

/**
 * Internal: normalize raw tier inputs into a safe uppercase token
 * Accepts:
 * - string tier values ("FREE", "PREMIUM", "ENTERPRISE", "PREMIUM_PLUS")
 * - objects returned from /api/auth/me ("{ tierEffective: 'PREMIUM_PLUS' }")
 */
function readTierToken(rawTier: unknown): string {
  // Support passing account object directly
  if (rawTier && typeof rawTier === "object") {
    const tierObj = rawTier as RawTierInput;

    const eff = String(tierObj?.tierEffective || "").trim();
    if (eff) return eff;

    const t = String(tierObj?.tier || "").trim();
    if (t) return t;
  }

  return String(rawTier || "").trim();
}

/**
 *Exported EXACT name your system expects
 * Resolve PlanId from database/workspace tier input.
 *
 * Supports:
 * - FREE
 * - PREMIUM
 * - ENTERPRISE (maps to premium_plus)
 * - PREMIUM_PLUS / PREMIUM PLUS / PREMIUM+ (maps to premium_plus)
 * - PRO / PAID (maps to premium)
 *
 * NOTE:
 * Trial is handled upstream by setting tierEffective="PREMIUM_PLUS"
 * (your /api/auth/me already does this correctly).
 */
export function resolvePlanIdFromTier(rawTier: unknown): PlanId {
  const token = readTierToken(rawTier)
    .replace(/[_\s]+/g, "_") // normalize spaces -> underscores
    .replace(/\+/g, "_PLUS") // normalize "+" -> "_PLUS"
    .toUpperCase();

  // Top access
  if (
    token.includes("PREMIUM_PLUS") ||
    token.includes("ENTERPRISE") ||
    token.includes("PLUS")
  ) {
    return "premium_plus";
  }

  // Middle access
  if (
    token.includes("PREMIUM") ||
    token.includes("PRO") ||
    token.includes("PAID")
  ) {
    return "premium";
  }

  return "free";
}

/**
 *Exported EXACT name your page expects
 * Read billing cycle from query param value.
 */
export function parseBillingCycle(input: unknown): BillingCycle {
  const raw = String(Array.isArray(input) ? input[0] : input || "")
    .toLowerCase()
    .trim();

  if (raw.includes("annual") || raw.includes("year")) return "annual";
  return "monthly";
}

/**
 * Helper: pricing for a plan + cycle (UI friendly)
 */
export function getPlanPrice(planId: PlanId, billing: BillingCycle) {
  const def = PLANS[planId];
  const p = def?.pricing?.[billing];

  // Free always $0/month for the UI behavior you designed
  if (planId === "free") {
    return { price: "0", unit: "/ month", note: "" };
  }

  return {
    price: String(p?.price ?? "--"),
    unit: String(p?.unit ?? (billing === "annual" ? "/ year" : "/ month")),
    note: String(p?.note ?? ""),
  };
}

/**
 * Helper: limits for plan (used by UI + API checks)
 */
export function getPlanLimits(planId: PlanId): PlanLimits {
  return PLANS[planId]?.limits ?? PLANS.free.limits;
}

/**
 * Helper: module access
 */
export function hasModule(planId: PlanId, moduleId: ModuleId): boolean {
  return PLANS[planId]?.modules?.[moduleId] === true;
}

/**
 * UI-safe plan label for human-facing copy.
 * Keeps internal IDs (e.g. "premium_plus") from leaking into rendered text.
 */
export function formatPlanLabelForUi(rawPlanId: unknown): "CavTower" | "CavControl" | "CavElite" {
  const token = String(rawPlanId || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    token === "premium_plus" ||
    token === "premium+" ||
    token === "plus" ||
    token === "enterprise"
  ) {
    return "CavElite";
  }
  if (token === "premium" || token === "pro" || token === "paid") return "CavControl";
  return "CavTower";
}
