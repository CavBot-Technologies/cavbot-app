// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { isApiAuthError, requireSession, requireAccountContext } from "@/lib/apiAuth";
import {
  clearExpiredTrialSeat,
  findAccountById,
  findMembershipsForUser,
  findSessionMembership,
  getAuthPool,
  pickPrimaryMembership,
} from "@/lib/authDb";
import { findLatestEntitledSubscription, resolveEffectivePlanId } from "@/lib/accountPlan.server";
import { resolveEffectiveAccountIdForSession } from "@/lib/effectiveSessionAccount.server";
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

  const pool = getAuthPool();
  const accountId = (await resolveEffectiveAccountIdForSession(sess).catch(() => null)) || sess.accountId!;
  const userId = String(sess.sub || "").trim();

  const sessionMembership =
    (userId && accountId
      ? await findSessionMembership(pool, userId, accountId).catch(() => null)
      : null) || null;

  let fallbackMembership: Awaited<ReturnType<typeof pickPrimaryMembership<Awaited<ReturnType<typeof findMembershipsForUser>>[number]>>> | null =
    null;
  if (!sessionMembership && userId) {
    const memberships = await findMembershipsForUser(pool, userId).catch(() => []);
    fallbackMembership = pickPrimaryMembership(memberships);
  }

  await clearExpiredTrialSeat(pool, accountId).catch(() => null);

  const [account, subscription] = await Promise.all([
    findAccountById(pool, accountId).catch(() => null),
    findLatestEntitledSubscription(accountId, pool).catch(() => null),
  ]);

  const planId = resolveEffectivePlanId({
    account:
      account ||
      (sessionMembership || fallbackMembership
        ? { tier: sessionMembership?.accountTier || fallbackMembership?.accountTier || "FREE" }
        : null),
    subscription,
  }) ?? resolvePlanIdFromTier("FREE");
  const allowed = hasModule(planId, moduleId);

  if (allowed) return { ok: true, planId };

  if (mode === "redirect") redirect("/plan");

  return { ok: false, planId, mode };
}
