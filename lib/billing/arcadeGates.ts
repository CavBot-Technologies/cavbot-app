import type { PlanId } from "@/lib/plans";

export type ArcadeLockLabel = "Premium" | "Premium+";
export type ArcadeLockInfo = {
  locked: boolean;
  unlockTier: ArcadeLockLabel;
};
export type ArcadeLockMap = Record<string, ArcadeLockInfo>;

const ARCADE_GAME_SORT_ORDER = [
  "catch-cavbot",
  "cavbot-imposter",
  "cavbot-signal-chase",
  "cavbot-cache-sweep",
  "futbol-cavbot",
  "tennis-cavbot",
] as const;

const TIER_RANK: Record<PlanId, number> = {
  free: 0,
  premium: 1,
  premium_plus: 2,
};

const ARCADE_GAME_UNLOCK_TIER: Record<string, PlanId> = {
  "catch-cavbot": "free",
  "cavbot-imposter": "premium",
  "cavbot-signal-chase": "premium",
  "cavbot-cache-sweep": "premium_plus",
  "futbol-cavbot": "premium_plus",
  "tennis-cavbot": "premium_plus",
};

function tierRank(tier: PlanId) {
  return TIER_RANK[tier] ?? TIER_RANK.free;
}

export function getAllowedArcadeGames(tier: PlanId): string[] {
  const rank = tierRank(tier);
  return ARCADE_GAME_SORT_ORDER.filter((slug) => tierRank(ARCADE_GAME_UNLOCK_TIER[slug] ?? "premium_plus") <= rank);
}

export function isArcadeGameAllowed(tier: PlanId, slug: string): boolean {
  return tierRank(tier) >= tierRank(ARCADE_GAME_UNLOCK_TIER[slug] ?? "premium_plus");
}

export function arcadeLockLabelForGame(slug: string): ArcadeLockLabel {
  const tier = ARCADE_GAME_UNLOCK_TIER[slug] ?? "premium_plus";
  return tier === "premium_plus" ? "Premium+" : "Premium";
}

export function getArcadeLockMapForTier(tier: PlanId): ArcadeLockMap {
  const rank = tierRank(tier);
  return ARCADE_GAME_SORT_ORDER.reduce<ArcadeLockMap>((map, slug) => {
    const requiredTier = ARCADE_GAME_UNLOCK_TIER[slug] ?? "premium_plus";
    map[slug] = {
      locked: tierRank(requiredTier) > rank,
      unlockTier: arcadeLockLabelForGame(slug),
    };
    return map;
  }, {} as ArcadeLockMap);
}

export { ARCADE_GAME_SORT_ORDER };
