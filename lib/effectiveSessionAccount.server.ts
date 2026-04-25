import "server-only";

import { headers } from "next/headers";

import { getAppOrigin, getSession, type CavbotSession } from "@/lib/apiAuth";
import {
  compareMembershipPriority,
  findMembershipsForUser,
  membershipTierRank,
  pickPrimaryMembership,
  withDedicatedAuthClient,
} from "@/lib/authDb";

const EFFECTIVE_ACCOUNT_LOOKUP_TIMEOUT_MS = 650;

async function withEffectiveAccountDeadline<T>(
  promise: Promise<T>,
  timeoutMs = EFFECTIVE_ACCOUNT_LOOKUP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("EFFECTIVE_ACCOUNT_LOOKUP_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveEffectiveAccountIdForSession(
  session: CavbotSession | null | undefined,
): Promise<string | null> {
  if (!session || session.systemRole !== "user") return null;

  const currentAccountId = String(session.accountId || "").trim();
  const userId = String(session.sub || "").trim();
  if (!userId) return currentAccountId || null;

  try {
    const memberships = await withEffectiveAccountDeadline(
      withDedicatedAuthClient((authClient) => findMembershipsForUser(authClient, userId)),
      currentAccountId ? EFFECTIVE_ACCOUNT_LOOKUP_TIMEOUT_MS : 1_200,
    );
    const primaryMembership = pickPrimaryMembership(memberships);
    if (!primaryMembership) return currentAccountId || null;

    const currentMembership = currentAccountId
      ? memberships.find((membership) => String(membership.accountId) === currentAccountId) ?? null
      : null;

    if (!currentMembership) return String(primaryMembership.accountId || "").trim() || null;

    const shouldPromote =
      primaryMembership.accountId !== currentMembership.accountId &&
      membershipTierRank(primaryMembership.accountTier) > membershipTierRank(currentMembership.accountTier) &&
      compareMembershipPriority(primaryMembership, currentMembership) < 0;

    return shouldPromote
      ? String(primaryMembership.accountId || "").trim() || null
      : currentAccountId || null;
  } catch {
    return currentAccountId || null;
  }
}

export async function resolveEffectiveAccountIdFromRequest(req: Request) {
  const session = await getSession(req);
  return resolveEffectiveAccountIdForSession(session);
}

export async function resolveEffectiveAccountIdFromHeaders() {
  try {
    const headerStore = await headers();
    const cookie = String(headerStore.get("cookie") || "").trim();
    if (!cookie) return null;

    const fallback = new URL(getAppOrigin());
    const host = String(headerStore.get("x-forwarded-host") || headerStore.get("host") || fallback.host).trim();
    const proto = String(headerStore.get("x-forwarded-proto") || fallback.protocol.replace(/:$/, "")).trim() || "http";

    const req = new Request(`${proto}://${host}/_effective_account`, {
      headers: {
        cookie,
        host,
      },
    });

    return await resolveEffectiveAccountIdFromRequest(req);
  } catch {
    return null;
  }
}
