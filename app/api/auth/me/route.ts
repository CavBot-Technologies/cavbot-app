// app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isApiAuthError } from "@/lib/apiAuth";
import type { CavbotSession } from "@/lib/apiAuth";
import { getCavCloudCollabPolicy, DEFAULT_CAVCLOUD_COLLAB_POLICY } from "@/lib/cavcloud/collabPolicy.server";

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

  const trialActive = Boolean(account?.trialSeatActive) && endsAtMs > now;

  // IMPORTANT: "PREMIUM_PLUS" doesn't exist in Prisma enum
  // but we can return it as a JSON-only "effective" tier for your UI + gates.
  let tierEffective = String(account?.tier || "FREE").toUpperCase();

  // Map ENTERPRISE to top access
  if (tierEffective === "ENTERPRISE") tierEffective = "PREMIUM_PLUS";

  if (trialActive) tierEffective = "PREMIUM_PLUS";

  const daysLeft =
    trialActive && endsAtMs
      ? Math.max(0, Math.ceil((endsAtMs - now) / (1000 * 60 * 60 * 24)))
      : 0;

  return { trialActive, tierEffective, daysLeft };
}

export async function GET(req: Request) {
  try {
    const sess: CavbotSession | null = await getSession(req);

    // Not logged in -> always 200
    if (!sess) return json({ ok: true, authenticated: false }, 200);

    // System sessions (internal tooling)
    if (sess.systemRole === "system") {
      return json({ ok: true, authenticated: true, session: sess }, 200);
    }

    const userId = String(sess?.sub || "").trim();
    const accountId = sess?.accountId ? String(sess.accountId).trim() : null;

    if (!userId) return json({ ok: true, authenticated: false }, 200);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        usernameChangeCount: true,
        lastUsernameChangeAt: true,
        displayName: true,
        publicProfileEnabled: true,
        avatarImage: true,
        avatarTone: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) return json({ ok: true, authenticated: false }, 200);

    const initials = deriveInitials(user.displayName, user.username);

    let membership: MembershipRecord | null = null;
    let account: PrismaAccount | null = null;
    let accountWithComputed: AccountWithComputed | null = null;
    let collabPolicy = { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };

    if (accountId) {
      const membershipRecord = (await prisma.membership.findUnique({
        where: { accountId_userId: { accountId, userId } },
        select: { role: true, createdAt: true, accountId: true, userId: true },
      })) as MembershipRecord | null;

      membership = membershipRecord;

      if (!membership) return json({ ok: true, authenticated: false }, 200);

      const accountRecord = (await prisma.account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          name: true,
          slug: true,
          tier: true,
          createdAt: true,

          // TRIAL FIELDS (THIS IS WHAT WAS MISSING)
          trialSeatActive: true,
          trialStartedAt: true,
          trialEndsAt: true,
          trialEverUsed: true,
        },
      })) as PrismaAccount | null;

      if (!accountRecord) return json({ ok: true, authenticated: false }, 200);

      account = accountRecord;

      // Auto-expire trial seat if end date passed (keeps DB clean)
      if (account.trialSeatActive && account.trialEndsAt) {
        const ends = new Date(account.trialEndsAt).getTime();
        if (Number.isFinite(ends) && ends <= Date.now()) {
          try {
            await prisma.account.update({
              where: { id: account.id },
              data: { trialSeatActive: false },
            });
            account = { ...account, trialSeatActive: false };
          } catch {}
        }
      }

      // Compute effective tier for UI + gates
      const eff = computeEffectiveTier(account);
      accountWithComputed = {
        ...account,
        tierEffective: eff.tierEffective, // "FREE" | "PREMIUM" | "PREMIUM_PLUS"
        trialActive: eff.trialActive,
        trialDaysLeft: eff.daysLeft,
      };

      try {
        collabPolicy = await getCavCloudCollabPolicy(accountId);
      } catch {
        collabPolicy = { ...DEFAULT_CAVCLOUD_COLLAB_POLICY };
      }
    }

    return json(
      {
        ok: true,
        authenticated: true,
        session: sess,
        user: {
          ...user,
          initials,
        },
        account: accountWithComputed ?? account,
        membership,
        policy: {
          ...collabPolicy,
          allowArcadeCollaboratorAccess: Boolean(collabPolicy.enableContributorLinks),
        },
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: true, authenticated: false }, 200);
  }
}
