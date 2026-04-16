// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { isApiAuthError, requireSession, requireAccountContext } from "@/lib/apiAuth";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { resolvePlanIdFromTier, hasModule, type ModuleId } from "@/lib/plans";

export type GateMode = "screen" | "redirect";

export type GateResult =
  | { ok: true; planId: ReturnType<typeof resolvePlanIdFromTier> }
  | { ok: false; planId: ReturnType<typeof resolvePlanIdFromTier>; mode: GateMode };

function isSafePageRead(req: Request) {
  const method = String(req.method || "GET").trim().toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  try {
    return !new URL(req.url).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

export async function gateModuleAccess(
  req: Request,
  moduleId: ModuleId,
  mode: GateMode = "screen"
): Promise<GateResult> {
  noStore();

  let sess: Awaited<ReturnType<typeof requireSession>>;
  try {
    sess = await requireSession(req);
    requireAccountContext(sess);
  } catch (error) {
    if (mode === "screen" && isSafePageRead(req) && isApiAuthError(error) && error.code === "AUTH_BACKEND_UNAVAILABLE") {
      return { ok: true, planId: "premium_plus" };
    }
    throw error;
  }

  const accountId = sess.accountId!;
  const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
  const planId = plan?.planId ?? resolvePlanIdFromTier("FREE");
  const allowed = hasModule(planId, moduleId);

  if (allowed) return { ok: true, planId };

  if (mode === "redirect") redirect("/plan");

  return { ok: false, planId, mode };
}
