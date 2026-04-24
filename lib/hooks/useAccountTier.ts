import { useEffect, useState } from "react";
import { resolveTierFromAccount, type Tier } from "@/lib/billing/featureGates";
import { publishClientPlan, readBootClientPlanBootstrap, subscribeClientPlan } from "@/lib/clientPlan";

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
      const billingResponse = await fetch("/api/billing/summary", { method: "GET", cache: "no-store" });
      const billingPayload = await billingResponse.json().catch(() => ({}));
      const billingPlanId = String(billingPayload?.computed?.currentPlanId || "").trim();
      if (billingResponse.ok && (billingPlanId === "free" || billingPlanId === "premium" || billingPlanId === "premium_plus")) {
        const tier = billingPlanId as Tier;
        cachedTier = tier;
        publishClientPlan({ planId: tier, preserveStrongerCached: true });
        return tier;
      }

      const response = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const tier = resolveTierFromAccount(payload?.account);
      cachedTier = tier;
      publishClientPlan({ planId: tier, preserveStrongerCached: true });
      return tier;
    } catch {
      const bootTier = readBootTier();
      const tier = bootTier ?? cachedTier ?? "free";
      cachedTier = tier;
      return tier;
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
