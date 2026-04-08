import { useEffect, useState } from "react";
import { resolveTierFromAccount, type Tier } from "@/lib/billing/featureGates";
import { readBootClientPlanBootstrap, subscribeClientPlan } from "@/lib/clientPlan";

let cachedTier: Tier | null = null;
let fetchPromise: Promise<Tier> | null = null;

function readBootTier(): Tier | null {
  const boot = readBootClientPlanBootstrap();
  if (!boot.authenticatedHint) return null;
  return boot.planId as Tier;
}

async function fetchTierOnce(): Promise<Tier> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const response = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const tier = resolveTierFromAccount(payload?.account);
      cachedTier = tier;
      return tier;
    } catch {
      cachedTier = "free";
      return "free";
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

export function useAccountTier(): Tier {
  const [tier, setTier] = useState<Tier>(() => {
    const bootTier = readBootTier();
    if (bootTier) {
      cachedTier = bootTier;
      return bootTier;
    }
    return cachedTier ?? "free";
  });

  useEffect(() => {
    const bootTier = readBootTier();
    if (bootTier) {
      cachedTier = bootTier;
      setTier((prev) => (prev === bootTier ? prev : bootTier));
    }

    let cancelled = false;
    if (!bootTier && !cachedTier) {
      fetchTierOnce().then((next) => {
        if (!cancelled) {
          setTier(next);
        }
      });
    }
    const unsubscribe = subscribeClientPlan((planId) => {
      const nextTier = planId as Tier;
      cachedTier = nextTier;
      setTier(nextTier);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return tier;
}
