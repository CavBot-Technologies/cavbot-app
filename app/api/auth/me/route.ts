// app/api/auth/me/route.ts
import { NextResponse } from "next/server";

import { isApiAuthError, readVerifiedSession } from "@/lib/apiAuth";
import type { CavbotSession } from "@/lib/apiAuth";
import { readAuthSessionView } from "@/lib/authSessionView.server";

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

const AUTH_ME_TIMEOUT_MS = 3_000;

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

async function withAuthMeDeadline<T>(promise: Promise<T>, timeoutMs = AUTH_ME_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("AUTH_ME_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildSessionFallbackPayload(sess: CavbotSession) {
  if (sess.systemRole === "system") {
    return {
      ok: true,
      authenticated: true,
      degraded: true,
      indeterminate: true,
      session: sess,
      capabilities: { aiReady: false },
    } as const;
  }

  const userId = String(sess.sub || "").trim();
  const accountId = String(sess.accountId || "").trim();
  const memberRole = String(sess.memberRole || "").trim().toUpperCase();
  const normalizedMemberRole =
    memberRole === "OWNER" || memberRole === "ADMIN" || memberRole === "MEMBER"
      ? memberRole
      : "MEMBER";

  return {
    ok: true,
    authenticated: true,
    degraded: true,
    indeterminate: true,
    session: {
      ...sess,
      accountId: accountId || null,
      memberRole: normalizedMemberRole,
    },
    user: {
      id: userId,
      email: "",
      username: null,
      displayName: null,
      fullName: null,
      usernameChangeCount: 0,
      lastUsernameChangeAt: null,
      publicProfileEnabled: false,
      avatarImage: null,
      avatarTone: "lime",
      createdAt: new Date(0),
      lastLoginAt: null,
      emailVerifiedAt: null,
      initials: "C",
    },
    profile: {
      id: userId,
      email: "",
      username: null,
      displayName: null,
      fullName: null,
      usernameChangeCount: 0,
      lastUsernameChangeAt: null,
      publicProfileEnabled: false,
      avatarImage: null,
      avatarTone: "lime",
      createdAt: new Date(0),
      lastLoginAt: null,
      emailVerifiedAt: null,
      initials: "C",
    },
    account: {
      id: accountId || "",
      name: null,
      slug: null,
      tier: "FREE",
      tierEffective: "FREE",
      createdAt: new Date(0),
      trialSeatActive: false,
      trialStartedAt: null,
      trialEndsAt: null,
      trialEverUsed: false,
      trialActive: false,
      trialDaysLeft: 0,
    },
    membership: {
      id: "",
      accountId: accountId || "",
      userId,
      role: normalizedMemberRole,
      createdAt: new Date(0),
      userEmail: "",
      userDisplayName: null,
      accountName: "",
      accountSlug: "",
      accountTier: "FREE",
    },
    capabilities: { aiReady: false },
    policy: {
      ...DEFAULT_CAVCLOUD_COLLAB_POLICY,
      allowArcadeCollaboratorAccess: false,
    },
  } as const;
}

export async function GET(req: Request) {
  const sess = await withAuthMeDeadline(readVerifiedSession(req), 1_000).catch(() => null);

  try {
    if (!sess) {
      return json(
        { ok: true, authenticated: false, signedOut: true, error: "UNAUTHORIZED", capabilities: { aiReady: false } },
        200,
      );
    }

    if (sess.systemRole === "system") {
      return json({ ok: true, authenticated: true, degraded: false, session: sess, capabilities: { aiReady: false } }, 200);
    }

    const view = await readAuthSessionView(sess, AUTH_ME_TIMEOUT_MS);
    if (!view) {
      return json(buildSessionFallbackPayload(sess), 200);
    }

    return json(
      {
        ok: true,
        authenticated: true,
        degraded: view.degraded,
        session: {
          ...sess,
          accountId: view.membership?.accountId || sess.accountId,
          memberRole: view.membership?.role || sess.memberRole,
        },
        user: view.user,
        profile: view.user,
        account: view.account,
        membership: view.membership,
        capabilities: {
          aiReady: Boolean(view.account?.id),
        },
        policy: {
          ...DEFAULT_CAVCLOUD_COLLAB_POLICY,
          allowArcadeCollaboratorAccess: false,
        },
      },
      200,
    );
  } catch (error) {
    if (isApiAuthError(error) && (error.status === 401 || error.status === 403)) {
      return json(
        { ok: true, authenticated: false, signedOut: true, error: error.code, capabilities: { aiReady: false } },
        200,
      );
    }

    if (sess) {
      const payload = buildSessionFallbackPayload(sess);
      return json(
        {
          ...payload,
          ...(isApiAuthError(error) ? { error: error.code } : {}),
        },
        200,
      );
    }

    return json(
      {
        ok: true,
        authenticated: false,
        degraded: true,
        indeterminate: true,
        capabilities: { aiReady: false },
        ...(isApiAuthError(error) ? { error: error.code } : {}),
      },
      200,
    );
  }
}
