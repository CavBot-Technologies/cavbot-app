// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { clearExpiredTrialSeat, getAuthPool } from "@/lib/authDb";
import { resolveBillingPlanResolution } from "@/lib/billingPlan.server";
import { resolvePlanIdFromTier, hasModule, type ModuleId } from "@/lib/plans";

export type GateMode = "screen" | "redirect";

export type GateResult =
  | { ok: true; planId: ReturnType<typeof resolvePlanIdFromTier> }
  | { ok: false; planId: ReturnType<typeof resolvePlanIdFromTier>; mode: GateMode };

export async function gateModuleAccess(
  req: Request,
  moduleId: ModuleId,
  mode: GateMode = "screen"
): Promise<GateResult> {
  noStore();

  const sess = await requireSession(req);
  requireAccountContext(sess);

  const accountId = sess.accountId!;
  const fallbackPlanId = resolvePlanIdFromTier("free");
  let planId: ReturnType<typeof resolvePlanIdFromTier> = fallbackPlanId;
  try {
    const pool = getAuthPool();
    await clearExpiredTrialSeat(pool, accountId);
    const planResolution = await resolveBillingPlanResolution({
      accountId,
      repair: true,
    });
    planId = planResolution.currentPlanId;
  } catch (error) {
    try {
      console.error(
        "[module-gate]",
        JSON.stringify({
          event: "plan_resolution_failed",
          accountId,
          moduleId,
          code: error instanceof Error ? error.message : String(error),
        }),
      );
    } catch {
      console.error("[module-gate] plan_resolution_failed");
    }
  }
  const allowed = hasModule(planId, moduleId);

  if (allowed) return { ok: true, planId };

  if (mode === "redirect") redirect("/plan");

  return { ok: false, planId, mode };
}
