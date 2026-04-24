import "server-only";

import type { CavbotSession } from "@/lib/apiAuth";
import {
  findAccountById,
  findSessionMembership,
  findUserById,
  getAuthPool,
  type AuthUser,
  type SessionMembershipRecord,
} from "@/lib/authDb";
import {
  findLatestEntitledSubscription,
  isTrialSeatEntitled,
  planTierTokenFromPlanId,
  resolveEffectivePlanId,
} from "@/lib/accountPlan.server";
import { resolvePlanIdFromTier } from "@/lib/plans";
import { normalizeCavbotFounderProfile } from "@/lib/profileIdentity";

function s(value: unknown) {
  return String(value ?? "").trim();
}

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function deriveInitials(displayName?: string | null, username?: string | null) {
  const name = s(displayName);
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const duo = `${firstInitialChar(parts[0] || "")}${firstInitialChar(parts[1] || "")}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(s(username).replace(/^@+/, ""));
  if (userInitial) return userInitial;
  return "C";
}

function normalizeRole(value: unknown): "OWNER" | "ADMIN" | "MEMBER" {
  const role = s(value).toUpperCase();
  if (role === "OWNER" || role === "ADMIN") return role;
  return "MEMBER";
}

function asDate(value: unknown, fallback?: Date | null) {
  if (!value) return fallback ?? null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : fallback ?? null;
}

export type AuthSessionViewUser = AuthUser & {
  initials: string;
};

export type AuthSessionViewAccount = {
  id: string;
  name: string | null;
  slug: string | null;
  tier: string;
  tierEffective: "FREE" | "PREMIUM" | "PREMIUM_PLUS";
  createdAt: Date;
  trialSeatActive: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialEverUsed: boolean;
  trialActive: boolean;
  trialDaysLeft: number;
};

export type AuthSessionView = {
  degraded: boolean;
  user: AuthSessionViewUser;
  membership: SessionMembershipRecord | null;
  account: AuthSessionViewAccount;
};

function fallbackUserFromSession(args: {
  userId: string;
  session: CavbotSession;
  membership: SessionMembershipRecord | null;
  user: AuthUser | null;
}) {
  const source = args.user ?? null;
  const membershipDisplayName = s(args.membership?.userDisplayName);
  const normalized = normalizeCavbotFounderProfile({
    username: source?.username,
    displayName: source?.displayName || membershipDisplayName || null,
    fullName: source?.fullName || membershipDisplayName || null,
  });

  const displayName = s(normalized.displayName || normalized.fullName) || null;
  const fullName = s(normalized.fullName || normalized.displayName) || null;
  const username = s(normalized.username) || null;

  return {
    id: args.userId,
    email: source?.email || args.membership?.userEmail || "",
    username,
    displayName,
    fullName,
    usernameChangeCount: source?.usernameChangeCount ?? 0,
    lastUsernameChangeAt: source?.lastUsernameChangeAt ?? null,
    publicProfileEnabled: source?.publicProfileEnabled ?? false,
    avatarImage: source?.avatarImage ?? null,
    avatarTone: s(source?.avatarTone).toLowerCase() || "lime",
    createdAt: source?.createdAt ?? new Date(),
    lastLoginAt: source?.lastLoginAt ?? null,
    emailVerifiedAt: source?.emailVerifiedAt ?? null,
    initials: deriveInitials(displayName, username),
  } satisfies AuthSessionViewUser;
}

function fallbackAccountFromSession(args: {
  accountId: string;
  membership: SessionMembershipRecord | null;
  tier: string;
}) {
  const tier = s(args.tier).toUpperCase() || "FREE";
  const tierEffective = planTierTokenFromPlanId(resolvePlanIdFromTier(tier));
  return {
    id: args.accountId,
    name: s(args.membership?.accountName) || null,
    slug: s(args.membership?.accountSlug) || null,
    tier,
    tierEffective,
    createdAt: new Date(0),
    trialSeatActive: false,
    trialStartedAt: null,
    trialEndsAt: null,
    trialEverUsed: false,
    trialActive: false,
    trialDaysLeft: 0,
  } satisfies AuthSessionViewAccount;
}

function computeTrialDaysLeft(account: {
  trialEndsAt?: Date | null;
}) {
  const endsAtMs = account.trialEndsAt instanceof Date ? account.trialEndsAt.getTime() : null;
  if (!endsAtMs || !Number.isFinite(endsAtMs)) return 0;
  const diff = endsAtMs - Date.now();
  if (diff <= 0) return 0;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export async function readAuthSessionView(
  session: CavbotSession,
): Promise<AuthSessionView | null> {
  if (session.systemRole !== "user") return null;

  const userId = s(session.sub);
  const accountId = s(session.accountId);
  if (!userId || !accountId) return null;

  try {
    const pool = getAuthPool();
    let degraded = false;

    const membershipRow = await findSessionMembership(pool, userId, accountId).catch(() => {
      degraded = true;
      return null;
    });

    const userRow = await findUserById(pool, userId).catch(() => {
      degraded = true;
      return null;
    });

    const user = fallbackUserFromSession({
      userId,
      session,
      membership: membershipRow,
      user: userRow,
    });

    let account = fallbackAccountFromSession({
      accountId,
      membership: membershipRow,
      tier: membershipRow?.accountTier || "FREE",
    });

    const accountRow = await findAccountById(pool, accountId).catch(() => {
      degraded = true;
      return null;
    });

    if (accountRow) {
      const subscriptionRow = await findLatestEntitledSubscription(accountId, pool).catch(() => {
        degraded = true;
        return null;
      });
      account = {
        id: accountRow.id,
        name: accountRow.name ?? membershipRow?.accountName ?? null,
        slug: accountRow.slug ?? membershipRow?.accountSlug ?? null,
        tier: s(accountRow.tier).toUpperCase() || account.tier,
        tierEffective: planTierTokenFromPlanId(
          resolveEffectivePlanId({
            account: accountRow,
            subscription: subscriptionRow,
          }),
        ),
        createdAt: accountRow.createdAt,
        trialSeatActive: Boolean(accountRow.trialSeatActive),
        trialStartedAt: asDate(accountRow.trialStartedAt),
        trialEndsAt: asDate(accountRow.trialEndsAt),
        trialEverUsed: Boolean(accountRow.trialEverUsed),
        trialActive: isTrialSeatEntitled(accountRow),
        trialDaysLeft: isTrialSeatEntitled(accountRow) ? computeTrialDaysLeft(accountRow) : 0,
      };
    }

    return {
      degraded,
      user,
      membership: membershipRow ?? {
        id: "",
        accountId,
        userId,
        role: normalizeRole(session.memberRole),
        createdAt: new Date(0),
        userEmail: user.email,
        userDisplayName: user.displayName,
        accountName: account.name || "",
        accountSlug: account.slug || "",
        accountTier: account.tier,
      },
      account,
    } satisfies AuthSessionView;
  } catch {
    return {
      degraded: true,
      user: fallbackUserFromSession({
        userId,
        session,
        membership: null,
        user: null,
      }),
      membership: {
        id: "",
        accountId,
        userId,
        role: normalizeRole(session.memberRole),
        createdAt: new Date(0),
        userEmail: "",
        userDisplayName: null,
        accountName: "",
        accountSlug: "",
        accountTier: "FREE",
      },
      account: fallbackAccountFromSession({
        accountId,
        membership: null,
        tier: "FREE",
      }),
    };
  }
}
