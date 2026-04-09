import "server-only";

import {
  getAuthPool,
  findAccountById,
  findMembershipsForUser,
  findSessionMembership,
  pickPrimaryMembership,
} from "@/lib/authDb";
import type { MemberRole, AuthMembership } from "@/lib/authDb";
import { ApiAuthError, requireUser, type CavbotSession } from "@/lib/apiAuth";

export type BillingAccountContext = {
  userId: string;
  accountId: string;
  memberRole: MemberRole;
};

function uniqueMemberships(rows: AuthMembership[]) {
  const seen = new Set<string>();
  const out: AuthMembership[] = [];
  for (const row of rows) {
    const id = String(row.accountId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function orderedMembershipCandidates(current: AuthMembership | null, memberships: AuthMembership[]) {
  const primary = pickPrimaryMembership(memberships);
  const ordered: AuthMembership[] = [];
  if (current) ordered.push(current);
  if (primary) ordered.push(primary);
  for (const row of memberships) ordered.push(row);
  return uniqueMemberships(ordered);
}

function roleFromPrisma(value: string | MemberRole | null | undefined): MemberRole {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "OWNER" || normalized === "ADMIN") return normalized;
  return "MEMBER";
}

export async function resolveBillingAccountContext(sess: CavbotSession): Promise<BillingAccountContext> {
  requireUser(sess);

  const userId = String(sess.sub || "").trim();
  const currentAccountId = String(sess.accountId || "").trim();
  const currentMemberRole = roleFromPrisma(sess.memberRole);
  const pool = getAuthPool();

  const tryResolve = async (candidates: AuthMembership[]) => {
    for (const candidate of candidates) {
      const accountId = String(candidate.accountId || "").trim();
      if (!accountId) continue;

      const account = await findAccountById(pool, accountId);
      if (!account?.id) continue;

      sess.accountId = account.id;
      sess.memberRole = candidate.role;

      return {
        userId,
        accountId: account.id,
        memberRole: candidate.role,
      } satisfies BillingAccountContext;
    }

    return null;
  };

  let currentMembership: AuthMembership | null = null;
  if (currentAccountId) {
    const current = await findSessionMembership(pool, userId, currentAccountId);
    currentMembership = current
      ? {
          id: current.id,
          accountId: current.accountId,
          userId: current.userId,
          role: current.role,
          createdAt: current.createdAt,
        }
      : null;
  }

  const memberships = await findMembershipsForUser(pool, userId);
  const authResolved = await tryResolve(orderedMembershipCandidates(currentMembership, memberships));
  if (authResolved) return authResolved;

  if (currentAccountId) {
    const signedSessionAccount = await findAccountById(pool, currentAccountId);

    if (signedSessionAccount?.id) {
      sess.accountId = signedSessionAccount.id;
      sess.memberRole = currentMemberRole;

      return {
        userId,
        accountId: signedSessionAccount.id,
        memberRole: currentMemberRole,
      } satisfies BillingAccountContext;
    }
  }

  throw new ApiAuthError("ACCOUNT_CONTEXT_REQUIRED", 401);
}

export function requireBillingManageRole(ctx: BillingAccountContext) {
  if (ctx.memberRole !== "OWNER" && ctx.memberRole !== "ADMIN") {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }
}
