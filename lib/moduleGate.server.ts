// /lib/moduleGate.server.ts
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { resolvePlanIdFromTier, hasModule, type ModuleId } from "@/lib/plans";

export type GateMode = "screen" | "redirect";

export type GateResult =
  | { ok: true; planId: ReturnType<typeof resolvePlanIdFromTier> }
  | { ok: false; planId: ReturnType<typeof resolvePlanIdFromTier>; mode: GateMode };

function computeTierEffective(account: {
  tier: string;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | null;
}) {
  const now = Date.now();
  const endsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;

  const trialActive = Boolean(account?.trialSeatActive) && endsAtMs > now;

  let tierEffective = String(account?.tier || "FREE").toUpperCase();

  // Map ENTERPRISE to top access (your rule)
  if (tierEffective === "ENTERPRISE") tierEffective = "PREMIUM_PLUS";

  // Trial temporarily grants top access
  if (trialActive) tierEffective = "PREMIUM_PLUS";

  return tierEffective;
}

export async function gateModuleAccess(
  req: Request,
  moduleId: ModuleId,
  mode: GateMode = "screen"
): Promise<GateResult> {
  noStore();

  const sess = await requireSession(req);
  requireAccountContext(sess);

  const accountId = sess.accountId!;
  const account = await prisma.account.findFirst({
    where: { id: accountId },
    select: {
      tier: true,

      // TRIAL FIELDS (same as /api/auth/me)
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });

  const tierEffective = computeTierEffective({
    tier: String(account?.tier || "FREE"),
    trialSeatActive: account?.trialSeatActive,
    trialEndsAt: account?.trialEndsAt,
  });

  const planId = resolvePlanIdFromTier(tierEffective);
  const allowed = hasModule(planId, moduleId);

  if (allowed) return { ok: true, planId };

  if (mode === "redirect") redirect("/plan");

  return { ok: false, planId, mode };
}
