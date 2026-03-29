import "server-only";

import {
  ApiAuthError,
  requireAccountContext,
  requireAccountRole,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type CavsafePlanId = Extract<PlanId, "premium" | "premium_plus">;

export type CavsafeAuthorizedSession = CavbotAccountSession & {
  cavsafePlanId: CavsafePlanId;
  cavsafePremiumPlus: boolean;
};

function isTrialSeatActiveNow(trialSeatActive: boolean | null, trialEndsAt: Date | null): boolean {
  if (!trialSeatActive || !trialEndsAt) return false;
  const endsAtMs = new Date(trialEndsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs > Date.now();
}

async function resolveCavsafePlanId(accountId: string): Promise<CavsafePlanId> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });
  if (!account) throw new ApiAuthError("UNAUTHORIZED", 401);

  const trialPlus = isTrialSeatActiveNow(account.trialSeatActive, account.trialEndsAt);
  const planId = trialPlus ? "premium_plus" : resolvePlanIdFromTier(account.tier);

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
