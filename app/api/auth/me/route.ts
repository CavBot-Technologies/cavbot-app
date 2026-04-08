// app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { createUserSession, requireSession, isApiAuthError, sessionCookieOptions } from "@/lib/apiAuth";
import type { CavbotSession } from "@/lib/apiAuth";
import {
  compareMembershipPriority,
  clearExpiredTrialSeat,
  type AuthUser,
  findAccountById,
  findMembershipsForUser,
  findSessionMembership,
  findUserById,
  getAuthPool,
  membershipTierRank,
  pickPrimaryMembership,
} from "@/lib/authDb";
import {
  findLatestEntitledSubscription,
  isTrialSeatEntitled,
  planTierTokenFromPlanId,
  resolveEffectivePlanId,
} from "@/lib/accountPlan.server";
import { normalizeCavbotFounderProfile } from "@/lib/profileIdentity";

const DEFAULT_CAVCLOUD_COLLAB_POLICY = {
  allowAdminsManageCollaboration: false,
  allowMembersEditFiles: false,
  allowMembersCreateUpload: false,
  allowAdminsPublishArtifacts: false,
  allowAdminsViewAccessLogs: false,
  enableContributorLinks: false,
  allowTeamAiAccess: false,
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function attachUserSessionCookie(req: Request, res: NextResponse, token: string) {
  const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
  const cookieOpts = {
    ...cookieOptsFromLib,
    secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
  };
  res.cookies.set(name, token, cookieOpts);
  return res;
}

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function deriveInitials(displayName?: string | null, username?: string | null) {
  const name = String(displayName || "").trim();
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(String(username || "").trim().replace(/^@+/, ""));
  if (userInitial) return userInitial;
  return "C";
}

/** Returns { trialActive, tierEffective, daysLeft } */
type MembershipRecord = {
  role: string;
  createdAt: Date;
  accountId: string;
  userId: string;
  accountName?: string | null;
  accountSlug?: string | null;
  accountTier?: string | null;
};

type PrismaAccount = {
  id: string;
  name: string | null;
  slug: string | null;
  tier: string;
  createdAt: Date;
  trialSeatActive: boolean | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialEverUsed: boolean | null;
};

type AccountWithComputed = PrismaAccount & {
  trialActive: boolean;
  tierEffective: string;
  trialDaysLeft: number;
};

function computeEffectiveTier(account: PrismaAccount) {
  const now = Date.now();
  const endsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  const trialActive = isTrialSeatEntitled(account, now);

  const daysLeft =
    trialActive && endsAtMs > now
      ? Math.max(0, Math.ceil((endsAtMs - now) / (1000 * 60 * 60 * 24)))
      : 0;

  return { trialActive, daysLeft };
}

function sessionIssuedAtDate(sess: CavbotSession) {
  const issuedAtMs = Number(sess?.iat || 0) * 1000;
  return Number.isFinite(issuedAtMs) && issuedAtMs > 0 ? new Date(issuedAtMs) : new Date();
}

function buildFallbackUser(userId: string, sess: CavbotSession): AuthUser {
  return {
    id: userId,
    email: "",
    username: null,
    displayName: null,
    fullName: null,
    usernameChangeCount: 0,
    lastUsernameChangeAt: null,
    publicProfileEnabled: false,
    avatarImage: null,
    avatarTone: null,
    createdAt: sessionIssuedAtDate(sess),
    lastLoginAt: null,
    emailVerifiedAt: null,
  };
}

function fallbackMembershipFromSession(sess: CavbotSession): MembershipRecord | null {
  if (sess.systemRole !== "user" || !sess.sub || !sess.accountId || !sess.memberRole) return null;
  return {
    role: sess.memberRole,
    createdAt: sessionIssuedAtDate(sess),
    accountId: String(sess.accountId),
    userId: String(sess.sub),
    accountName: null,
    accountSlug: null,
    accountTier: "FREE",
  };
}

function buildFallbackAccountFromMembership(args: {
  sess: CavbotSession;
  membership: MembershipRecord | null;
  entitledSubscription: Awaited<ReturnType<typeof findLatestEntitledSubscription>> | null;
}): AccountWithComputed | null {
  const accountId = String(args.sess.accountId || args.membership?.accountId || "").trim();
  if (!accountId) return null;

  const fallbackAccount: PrismaAccount = {
    id: accountId,
    name: args.membership?.accountName || null,
    slug: args.membership?.accountSlug || null,
    tier: String(args.membership?.accountTier || "FREE"),
    createdAt: args.membership?.createdAt || sessionIssuedAtDate(args.sess),
    trialSeatActive: false,
    trialStartedAt: null,
    trialEndsAt: null,
    trialEverUsed: false,
  };

  const eff = computeEffectiveTier(fallbackAccount);
  const effectivePlanId = resolveEffectivePlanId({
    account: fallbackAccount,
    subscription: args.entitledSubscription,
  });

  return {
    ...fallbackAccount,
    tierEffective: planTierTokenFromPlanId(effectivePlanId),
    trialActive: eff.trialActive,
    trialDaysLeft: eff.daysLeft,
  };
}

export async function GET(req: Request) {
  try {
    const pool = getAuthPool();
    let degraded = false;
    let sess: CavbotSession;

    try {
      sess = await requireSession(req);
    } catch (error) {
      if (isApiAuthError(error) && (error.status === 401 || error.status === 403)) {
        return json({ ok: true, authenticated: false, error: error.code }, 200);
      }
      throw error;
    }

    // System sessions (internal tooling)
    if (sess.systemRole === "system") {
      return json({ ok: true, authenticated: true, degraded, session: sess }, 200);
    }

    const userId = String(sess?.sub || "").trim();
    const accountId = sess?.accountId ? String(sess.accountId).trim() : null;

    if (!userId) return json({ ok: true, authenticated: false }, 200);

    let user: AuthUser | null = null;
    let userLookupFailed = false;
    try {
      user = await findUserById(pool, userId);
    } catch {
      userLookupFailed = true;
      degraded = true;
    }

    if (!user) {
      if (!userLookupFailed) return json({ ok: true, authenticated: false }, 200);
      user = buildFallbackUser(userId, sess);
    }

    const normalizedUser = {
      ...user,
      ...normalizeCavbotFounderProfile({
        username: user.username,
        displayName: user.displayName,
        fullName: user.fullName,
      }),
    };
    const initials = deriveInitials(normalizedUser.displayName, normalizedUser.username);

    let membership: MembershipRecord | null = null;
    let account: PrismaAccount | null = null;
    let accountWithComputed: AccountWithComputed | null = null;
    let collabPolicy = { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };

    let membershipLookupFailed = false;
    const currentMembershipRecord = accountId
      ? await findSessionMembership(pool, userId, accountId).catch(() => {
          membershipLookupFailed = true;
          degraded = true;
          return null;
        })
      : null;
    const fallbackMembership = membershipLookupFailed ? fallbackMembershipFromSession(sess) : null;
    const baselineMembershipRecord = currentMembershipRecord ?? fallbackMembership;
    const memberships = await findMembershipsForUser(pool, userId).catch(() => {
      degraded = true;
      return [];
    });
    const primaryMembership = pickPrimaryMembership(memberships);
    const shouldPromoteMembership = primaryMembership
      ? (
          primaryMembership.accountId !== baselineMembershipRecord?.accountId &&
          (
            !baselineMembershipRecord ||
            membershipTierRank(primaryMembership.accountTier) > membershipTierRank(baselineMembershipRecord.accountTier)
          ) &&
          (
            !baselineMembershipRecord ||
            compareMembershipPriority(
              {
                role: primaryMembership.role,
                createdAt: primaryMembership.createdAt,
                accountTier: primaryMembership.accountTier,
              },
              {
                role: baselineMembershipRecord.role,
                createdAt: baselineMembershipRecord.createdAt,
                accountTier: baselineMembershipRecord.accountTier,
              }
            ) < 0
          )
        )
      : false;
    const promotedMembershipRecord = shouldPromoteMembership && primaryMembership
      ? await findSessionMembership(pool, userId, primaryMembership.accountId).catch(() => {
          degraded = true;
          return null;
        })
      : null;
    const effectiveMembershipRecord = promotedMembershipRecord ?? currentMembershipRecord ?? fallbackMembership;

    if (!effectiveMembershipRecord) {
      return json({ ok: true, authenticated: false }, 200);
    }

    membership = {
      role: effectiveMembershipRecord.role,
      createdAt: effectiveMembershipRecord.createdAt,
      accountId: effectiveMembershipRecord.accountId,
      userId: effectiveMembershipRecord.userId,
      accountName: effectiveMembershipRecord.accountName,
      accountSlug: effectiveMembershipRecord.accountSlug,
      accountTier: effectiveMembershipRecord.accountTier,
    };

    const effectiveAccountId = String(effectiveMembershipRecord.accountId || "").trim();

    await clearExpiredTrialSeat(pool, effectiveAccountId).catch(() => {
      degraded = true;
    });
    let accountLookupFailed = false;
    const [accountRecord, entitledSubscription] = await Promise.all([
      findAccountById(pool, effectiveAccountId).catch(() => {
        accountLookupFailed = true;
        degraded = true;
        return null;
      }),
      findLatestEntitledSubscription(effectiveAccountId).catch(() => {
        degraded = true;
        return null;
      }),
    ]);

    if (!accountRecord) {
      if (!accountLookupFailed) return json({ ok: true, authenticated: false }, 200);
      accountWithComputed = buildFallbackAccountFromMembership({
        sess,
        membership,
        entitledSubscription,
      });
    } else {
      account = accountRecord;

      // Compute effective tier for UI + gates
      const eff = computeEffectiveTier(account);
      const effectivePlanId = resolveEffectivePlanId({
        account,
        subscription: entitledSubscription,
      });
      accountWithComputed = {
        ...account,
        tierEffective: planTierTokenFromPlanId(effectivePlanId),
        trialActive: eff.trialActive,
        trialDaysLeft: eff.daysLeft,
      };
    }

    collabPolicy = { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };

    const responseUser = {
      ...normalizedUser,
      initials,
    };
    const response = json(
      {
        ok: true,
        authenticated: true,
        degraded,
        session: membership
          ? {
              ...sess,
              accountId: membership.accountId,
              memberRole: membership.role,
            }
          : sess,
        user: responseUser,
        profile: responseUser,
        account: accountWithComputed ?? account,
        membership,
        policy: {
          ...collabPolicy,
          allowArcadeCollaboratorAccess: Boolean(collabPolicy.enableContributorLinks),
        },
      },
      200
    );
    if (promotedMembershipRecord) {
      const token = await createUserSession({
        userId: promotedMembershipRecord.userId,
        accountId: promotedMembershipRecord.accountId,
        memberRole: String(promotedMembershipRecord.role).toUpperCase() === "OWNER"
          ? "OWNER"
          : String(promotedMembershipRecord.role).toUpperCase() === "ADMIN"
            ? "ADMIN"
            : "MEMBER",
      });
      return attachUserSessionCookie(req, response, token);
    }
    return response;
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: true, authenticated: false }, 200);
  }
}
