// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { isApiAuthError, requireSession, requireAccountContext } from "@/lib/apiAuth";
import { findAccountById, findUserById, getAuthPool } from "@/lib/authDb";
import { resolveTierFromAccount } from "@/lib/billing/featureGates";
import { resolveBillingPlanResolution } from "@/lib/billingPlan.server";
import { resolvePlanIdFromTier, hasModule, type ModuleId, type PlanId } from "@/lib/plans";

export type GateMode = "screen" | "redirect";

export type GateResult =
  | { ok: true; planId: ReturnType<typeof resolvePlanIdFromTier> }
  | { ok: false; planId: ReturnType<typeof resolvePlanIdFromTier>; mode: GateMode };

function planRank(planId: PlanId) {
  if (planId === "premium_plus") return 2;
  if (planId === "premium") return 1;
  return 0;
}

function strongestPlanId(...planIds: Array<PlanId | null | undefined>): PlanId {
  return planIds.reduce<PlanId>((strongest, planId) => {
    if (!planId) return strongest;
    return planRank(planId) > planRank(strongest) ? planId : strongest;
  }, "free");
}

function isSafePageRead(req: Request) {
  const method = String(req.method || "GET").trim().toUpperCase();
  return method === "GET" || method === "HEAD";
}

function withGateDeadline<T>(promise: Promise<T>, timeoutMs = 1_800): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("MODULE_GATE_TIMEOUT")), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function resolveStoredAccountPlan(accountId: string): Promise<ReturnType<typeof resolvePlanIdFromTier> | null> {
  const account = await withGateDeadline(findAccountById(getAuthPool(), accountId), 900).catch(() => null);
  if (!account) return null;
  return resolveTierFromAccount({
    tier: account.tier,
    trialSeatActive: account.trialSeatActive,
    trialEndsAt: account.trialEndsAt,
  });
}

async function resolveOwnerEntitlementPlan(userId: string): Promise<PlanId | null> {
  const ownerUsername = String(process.env.CAVBOT_OWNER_USERNAME || "").trim().toLowerCase();
  const ownerEmail = String(process.env.CAVBOT_OWNER_EMAIL || "").trim().toLowerCase();
  if (!ownerUsername && !ownerEmail) return null;

  const user = await withGateDeadline(findUserById(getAuthPool(), userId), 900).catch(() => null);
  if (!user) return null;

  const username = String(user.username || "").trim().toLowerCase();
  const email = String(user.email || "").trim().toLowerCase();
  if ((ownerUsername && username === ownerUsername) || (ownerEmail && email === ownerEmail)) {
    return "premium_plus";
  }
  return null;
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
  const fallbackPlanId = resolvePlanIdFromTier("free");
  let planId: ReturnType<typeof resolvePlanIdFromTier> = fallbackPlanId;
  const storedPlanId = await resolveStoredAccountPlan(accountId);
  const ownerPlanId = await resolveOwnerEntitlementPlan(sess.sub);
  try {
    // Keep navigation bounded; billing reconciliation handles clearExpiredTrialSeat elsewhere.
    const planResolution = await withGateDeadline(
      resolveBillingPlanResolution({
        accountId,
        repair: false,
      }),
    );
    planId = strongestPlanId(planResolution.currentPlanId, storedPlanId, ownerPlanId);
  } catch (error) {
    planId = strongestPlanId(storedPlanId, ownerPlanId);
    try {
      console.error(
        "[module-gate]",
        JSON.stringify({
          event: "plan_resolution_failed",
          accountId,
          moduleId,
          code: error instanceof Error ? error.message : String(error),
          fallbackPlanId: storedPlanId,
          ownerPlanId,
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
