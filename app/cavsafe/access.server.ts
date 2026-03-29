import { headers } from "next/headers";
import { unstable_cache } from "next/cache";

import { getAppOrigin, getSession } from "@/lib/apiAuth";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { appendGuardReturnParam, resolveGuardReturnFromReferer } from "@/src/lib/cavguard/cavGuard.return";

export type CavsafeAccessContext = {
  isAuthenticated: boolean;
  isOwner: boolean;
  planId: PlanId;
  canEnter: boolean;
  denialCode: "UNAUTHORIZED" | "OWNER_REQUIRED" | "PLAN_REQUIRED" | null;
  cacheScopeKey: string;
};

function sanitizeCacheScope(raw: unknown): string {
  const value = String(raw || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  return value ? value.slice(0, 96) : "anon";
}

function isTrialSeatActiveNow(trialSeatActive: boolean | null, trialEndsAt: Date | null): boolean {
  if (!trialSeatActive || !trialEndsAt) return false;
  const endsAtMs = new Date(trialEndsAt).getTime();
  return Number.isFinite(endsAtMs) && endsAtMs > Date.now();
}

async function resolveAccountPlanId(accountId: string): Promise<PlanId> {
  const id = String(accountId || "").trim();
  if (!id) return "free";
  return cachedResolveAccountPlanId(id);
}

const cachedResolveAccountPlanId = unstable_cache(
  async (resolvedAccountId: string): Promise<PlanId> => {
    const account = await prisma.account.findUnique({
      where: { id: resolvedAccountId },
      select: {
        tier: true,
        trialSeatActive: true,
        trialEndsAt: true,
      },
    });
    if (!account) return "free";
    if (isTrialSeatActiveNow(account.trialSeatActive, account.trialEndsAt)) return "premium_plus";
    return resolvePlanIdFromTier(account.tier);
  },
  ["cavsafe-access-plan"],
  { revalidate: 30 },
);

async function hasPrivateCavsafeAccess(args: {
  accountId: string;
  userId: string;
}): Promise<boolean> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!accountId || !userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  }).catch(() => null);
  const email = String(user?.email || "").trim().toLowerCase();

  const [acl, invite] = await Promise.all([
    prisma.cavSafeAcl.findFirst({
      where: {
        accountId,
        status: "ACTIVE",
        principalType: "USER",
        principalId: userId,
      },
      select: { id: true },
    }).catch(() => null),
    prisma.cavSafeInvite.findFirst({
      where: {
        accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        OR: [
          { inviteeUserId: userId },
          email ? { inviteeEmail: email } : undefined,
        ].filter(Boolean) as Array<{ inviteeUserId?: string; inviteeEmail?: string }>,
      },
      select: { id: true },
    }).catch(() => null),
  ]);

  return Boolean(acl?.id || invite?.id);
}

export async function getCavsafeAccessContext(pathname = "/cavsafe"): Promise<CavsafeAccessContext> {
  try {
    const h = headers();
    const cookie = String(h.get("cookie") || "").trim();
    if (!cookie) {
      return {
        isAuthenticated: false,
        isOwner: false,
        planId: "free",
        canEnter: false,
        denialCode: "UNAUTHORIZED",
        cacheScopeKey: "anon",
      };
    }

    const fallback = new URL(getAppOrigin());
    const host = String(h.get("x-forwarded-host") || h.get("host") || fallback.host).trim();
    const proto = String(h.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";

    const req = new Request(`${proto}://${host}${pathname}`, {
      headers: {
        cookie,
        host,
      },
    });

    const sess = await getSession(req);
    const isAuthenticated = !!sess;
    const isOwner = !!(sess && sess.systemRole === "user" && sess.memberRole === "OWNER");
    const cacheScopeKey = sanitizeCacheScope(sess?.accountId || sess?.sub || "anon");
    let planId: PlanId = "free";

    if (!isAuthenticated) {
      return {
        isAuthenticated,
        isOwner,
        planId,
        canEnter: false,
        denialCode: "UNAUTHORIZED",
        cacheScopeKey,
      };
    }

    planId = sess?.accountId ? await resolveAccountPlanId(sess.accountId) : "free";

    if (planId === "free") {
      return {
        isAuthenticated,
        isOwner,
        planId,
        canEnter: false,
        denialCode: "PLAN_REQUIRED",
        cacheScopeKey,
      };
    }

    if (!isOwner) {
      const hasAccess = await hasPrivateCavsafeAccess({
        accountId: String(sess?.accountId || ""),
        userId: String(sess?.sub || ""),
      });
      if (!hasAccess) {
        return {
          isAuthenticated,
          isOwner,
          planId,
          canEnter: false,
          denialCode: "OWNER_REQUIRED",
          cacheScopeKey,
        };
      }
    }

    return {
      isAuthenticated,
      isOwner,
      planId,
      canEnter: true,
      denialCode: null,
      cacheScopeKey,
    };
  } catch {
    return {
      isAuthenticated: false,
      isOwner: false,
      planId: "free",
      canEnter: false,
      denialCode: "UNAUTHORIZED",
      cacheScopeKey: "anon",
    };
  }
}

export async function isCavsafeOwnerRequest(pathname = "/cavsafe"): Promise<boolean> {
  const access = await getCavsafeAccessContext(pathname);
  return access.canEnter;
}

function resolveCavsafeGuardReturnPath(): string | null {
  try {
    const h = headers();
    const host = String(h.get("x-forwarded-host") || h.get("host") || "").trim();
    return resolveGuardReturnFromReferer({
      referer: h.get("referer"),
      host,
      blockedPrefixes: ["/cavsafe"],
    });
  } catch {
    return null;
  }
}

export function cavsafeDeniedRedirectPath(
  access: Pick<CavsafeAccessContext, "denialCode">,
  nextPath = "/cavsafe",
): string {
  const next = encodeURIComponent(String(nextPath || "/cavsafe"));
  const guardReturn = resolveCavsafeGuardReturnPath();
  if (access.denialCode === "PLAN_REQUIRED") {
    return appendGuardReturnParam("/?cavsafe=upgrade", guardReturn);
  }
  if (access.denialCode === "OWNER_REQUIRED") {
    return appendGuardReturnParam("/?cavsafe=ownerOnly", guardReturn);
  }
  return `/auth?next=${next}`;
}
