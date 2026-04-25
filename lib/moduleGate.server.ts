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
  pickPrimaryMembership,
  withDedicatedAuthClient,
} from "@/lib/authDb";
import { findLatestEntitledSubscription, resolveEffectivePlanId } from "@/lib/accountPlan.server";
import { resolveEffectiveAccountIdForSession } from "@/lib/effectiveSessionAccount.server";
import { resolvePlanIdFromTier, hasModule, type ModuleId } from "@/lib/plans";

export type GateMode = "screen" | "redirect";

export type GateResult =
  | { ok: true; planId: ReturnType<typeof resolvePlanIdFromTier> }
  | { ok: false; planId: ReturnType<typeof resolvePlanIdFromTier>; mode: GateMode };

const MODULE_GATE_READ_TIMEOUT_MS = 1_500;

function isSafePageRead(req: Request) {
  const method = String(req.method || "GET").trim().toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  try {
    return !new URL(req.url).pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

async function withModuleGateDeadline<T>(
  promise: Promise<T>,
  timeoutMs = MODULE_GATE_READ_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("MODULE_GATE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
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

  const accountId = (await resolveEffectiveAccountIdForSession(sess).catch(() => null)) || sess.accountId!;
  const userId = String(sess.sub || "").trim();
  try {
    const result = await withDedicatedAuthClient(async (authClient) => {
      const sessionMembership =
        (userId && accountId
          ? await withModuleGateDeadline(findSessionMembership(authClient, userId, accountId)).catch(() => null)
          : null) || null;

      let fallbackMembership: Awaited<ReturnType<typeof pickPrimaryMembership<Awaited<ReturnType<typeof findMembershipsForUser>>[number]>>> | null =
        null;
      if (!sessionMembership && userId) {
        const memberships = await withModuleGateDeadline(findMembershipsForUser(authClient, userId)).catch(() => []);
        fallbackMembership = pickPrimaryMembership(memberships);
      }

      await withModuleGateDeadline(clearExpiredTrialSeat(authClient, accountId)).catch(() => null);

      const [account, subscription] = await Promise.all([
        withModuleGateDeadline(findAccountById(authClient, accountId)).catch(() => null),
        withModuleGateDeadline(findLatestEntitledSubscription(accountId, authClient)).catch(() => null),
      ]);

      const planId = resolveEffectivePlanId({
        account:
          account ||
          (sessionMembership || fallbackMembership
            ? { tier: sessionMembership?.accountTier || fallbackMembership?.accountTier || "FREE" }
            : null),
        subscription,
      }) ?? resolvePlanIdFromTier("FREE");

      return { planId, allowed: hasModule(planId, moduleId) };
    });

    if (result.allowed) return { ok: true, planId: result.planId };

    if (mode === "redirect") redirect("/plan");

    return { ok: false, planId: result.planId, mode };
  } catch (error) {
    if (mode === "screen" && isSafePageRead(req)) {
      return { ok: true, planId: "premium_plus" };
    }
    throw error;
  }
}
