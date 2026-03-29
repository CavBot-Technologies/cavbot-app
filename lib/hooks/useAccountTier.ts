import { useEffect, useState } from "react";
import { resolveTierFromAccount, type Tier } from "@/lib/billing/featureGates";

let cachedTier: Tier | null = null;
let fetchPromise: Promise<Tier> | null = null;

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
  const [tier, setTier] = useState<Tier>(cachedTier ?? "free");

  useEffect(() => {
    if (cachedTier) {
      return;
    }
    let cancelled = false;
    fetchTierOnce().then((next) => {
      if (!cancelled) {
        setTier(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return tier;
}
