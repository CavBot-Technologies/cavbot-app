import "server-only";

import {
  ApiAuthError,
  requireAccountContext,
  requireAccountRole,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import {
  findLatestEntitledSubscription,
  resolveEffectivePlanId as resolveEffectiveAccountPlanId,
} from "@/lib/accountPlan.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import type { PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type CavsafePlanId = Extract<PlanId, "premium" | "premium_plus">;

export type CavsafeAuthorizedSession = CavbotAccountSession & {
  cavsafePlanId: CavsafePlanId;
  cavsafePremiumPlus: boolean;
};

type CavsafeAccountPlanRecord = {
  tier?: unknown;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | null;
};

function normalizeCavsafePlanId(planId: PlanId): CavsafePlanId | null {
  if (planId === "premium_plus") return "premium_plus";
  if (planId === "premium") return "premium";
  return null;
}

export function isCavsafePlanSchemaMismatchError(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["Account", "Subscription"],
    columns: ["tier", "trialSeatActive", "trialEndsAt", "status", "currentPeriodEnd", "updatedAt", "createdAt"],
  });
}

async function findCavsafeAccountPlanRecord(accountId: string): Promise<CavsafeAccountPlanRecord | null> {
  try {
    return await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        tier: true,
        trialSeatActive: true,
        trialEndsAt: true,
      },
    });
  } catch (err) {
    if (
      !isSchemaMismatchError(err, {
        tables: ["Account"],
        columns: ["trialSeatActive", "trialEndsAt"],
      })
    ) {
      throw err;
    }
  }

  return prisma.account.findUnique({
    where: { id: accountId },
    select: {
      tier: true,
    },
  });
}

async function resolveCavsafePlanId(accountId: string): Promise<CavsafePlanId> {
  const [account, entitledSubscription] = await Promise.all([
    findCavsafeAccountPlanRecord(accountId),
    findLatestEntitledSubscription(accountId),
  ]);

  if (!account) throw new ApiAuthError("UNAUTHORIZED", 401);

  const planId = normalizeCavsafePlanId(resolveEffectiveAccountPlanId({
    account,
    subscription: entitledSubscription,
  }));
  if (planId) return planId;
  throw new ApiAuthError("PLAN_REQUIRED", 403);
}

export function cavsafeTierTokenFromPlanId(planId: CavsafePlanId): "PREMIUM" | "PREMIUM_PLUS" {
  return planId === "premium_plus" ? "PREMIUM_PLUS" : "PREMIUM";
}

export async function resolveCavsafePlanIdOrDefault(
  accountIdRaw: string,
  fallback: CavsafePlanId = "premium",
): Promise<CavsafePlanId> {
  const accountId = String(accountIdRaw || "").trim();
  if (!accountId) return fallback;
  try {
    return await resolveCavsafePlanId(accountId);
  } catch {
    return fallback;
  }
}

export async function requireCavsafeOwnerContext(req: Request): Promise<CavbotAccountSession> {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);
  requireAccountRole(sess, ["OWNER"]);
  return sess;
}

export async function requireCavsafeOwnerSession(req: Request): Promise<CavsafeAuthorizedSession> {
  const sess = await requireCavsafeOwnerContext(req);
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
