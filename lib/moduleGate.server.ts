// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
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
  const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
  const planId = plan?.planId ?? resolvePlanIdFromTier("FREE");
  const allowed = hasModule(planId, moduleId);

  if (allowed) return { ok: true, planId };

  if (mode === "redirect") redirect("/plan");

  return { ok: false, planId, mode };
}
