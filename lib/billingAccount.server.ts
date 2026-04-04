import "server-only";

import { getAuthPool, findMembershipsForUser, findSessionMembership, pickPrimaryMembership } from "@/lib/authDb";
import type { MemberRole, AuthMembership } from "@/lib/authDb";
import { prisma } from "@/lib/prisma";
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

export async function resolveBillingAccountContext(sess: CavbotSession): Promise<BillingAccountContext> {
  requireUser(sess);

  const pool = getAuthPool();
  const userId = String(sess.sub || "").trim();
  const currentAccountId = String(sess.accountId || "").trim();

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
  const candidates = orderedMembershipCandidates(currentMembership, memberships);

  for (const candidate of candidates) {
    const accountId = String(candidate.accountId || "").trim();
    if (!accountId) continue;

    const account = await prisma.account
      .findUnique({
        where: { id: accountId },
        select: { id: true },
      })
      .catch(() => null);

    if (!account?.id) continue;

    sess.accountId = account.id;
    sess.memberRole = candidate.role;

    return {
      userId,
      accountId: account.id,
      memberRole: candidate.role,
    };
  }

  throw new ApiAuthError("ACCOUNT_CONTEXT_REQUIRED", 401);
}

export function requireBillingManageRole(ctx: BillingAccountContext) {
  if (ctx.memberRole !== "OWNER" && ctx.memberRole !== "ADMIN") {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }
}
