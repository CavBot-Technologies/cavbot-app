import "server-only";

import type { PlanId } from "@/lib/plans";

const GIB = BigInt(1024) * BigInt(1024) * BigInt(1024);

function envPositiveBigInt(name: string): bigint | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return BigInt(n);
}

const DEFAULT_CAVSAFE_SECURED_STORAGE_LIMITS: Record<PlanId, bigint> = {
  free: BigInt(0),
  premium: BigInt(10) * GIB,
  premium_plus: BigInt(50) * GIB,
};

export function cavsafeSecuredStorageLimitBytesForPlan(planId: PlanId): bigint {
  if (planId === "premium_plus") {
    return (
      envPositiveBigInt("CAVSAFE_SECURED_STORAGE_BYTES_PREMIUM_PLUS")
      ?? DEFAULT_CAVSAFE_SECURED_STORAGE_LIMITS.premium_plus
    );
  }
  if (planId === "premium") {
    return (
      envPositiveBigInt("CAVSAFE_SECURED_STORAGE_BYTES_PREMIUM")
      ?? DEFAULT_CAVSAFE_SECURED_STORAGE_LIMITS.premium
    );
  }
  return envPositiveBigInt("CAVSAFE_SECURED_STORAGE_BYTES_FREE") ?? DEFAULT_CAVSAFE_SECURED_STORAGE_LIMITS.free;
}

export function cavsafeSecuredStorageLimitGbForPlan(planId: PlanId): number {
  const bytes = cavsafeSecuredStorageLimitBytesForPlan(planId);
  const gb = Number(bytes / GIB);
  if (!Number.isFinite(gb) || gb < 0) return 0;
  return Math.trunc(gb);
}

