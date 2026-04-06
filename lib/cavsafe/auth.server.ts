import "server-only";

import {
  ApiAuthError,
  requireAccountContext,
  requireAccountRole,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import type { PlanId } from "@/lib/plans";

export type CavsafePlanId = Extract<PlanId, "premium" | "premium_plus">;

export type CavsafeAuthorizedSession = CavbotAccountSession & {
  cavsafePlanId: CavsafePlanId;
  cavsafePremiumPlus: boolean;
};

async function resolveCavsafePlanId(accountId: string): Promise<CavsafePlanId> {
  const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
  if (!plan) throw new ApiAuthError("UNAUTHORIZED", 401);

  const planId = plan.planId;

  if (planId === "premium_plus") return "premium_plus";
  if (planId === "premium") return "premium";
  throw new ApiAuthError("PLAN_REQUIRED", 403);
}

export async function requireCavsafeOwnerSession(req: Request): Promise<CavsafeAuthorizedSession> {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  requireAccountRole(sess, ["OWNER"]);

  const cavsafePlanId = await resolveCavsafePlanId(sess.accountId);
  return {
    ...sess,
    cavsafePlanId,
    cavsafePremiumPlus: cavsafePlanId === "premium_plus",
  };
}

export async function requireCavsafePremiumPlusSession(req: Request): Promise<CavsafeAuthorizedSession> {
  const sess = await requireCavsafeOwnerSession(req);
  if (!sess.cavsafePremiumPlus) throw new ApiAuthError("PLAN_UPGRADE_REQUIRED", 403);
  return sess;
}
