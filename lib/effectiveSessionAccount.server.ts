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

const EFFECTIVE_ACCOUNT_LOOKUP_TIMEOUT_MS = 2_500;
const ACTIVE_PROJECT_COOKIE_NAMES = ["cb_active_project_id", "cb_active_project", "cavbot_active_project_id"];

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

function parseActiveProjectId(req: Request): number | null {
  const cookieHeader = String(req.headers.get("cookie") || "");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    const name = rawName?.trim();
    if (!name || !ACTIVE_PROJECT_COOKIE_NAMES.includes(name)) continue;

    const value = decodeURIComponent(rawValueParts.join("=")).trim();
    const projectId = Number(value);
    if (Number.isInteger(projectId) && projectId > 0) return projectId;
  }

  return null;
}

async function resolveEffectiveAccountIdFromProjectCookie(
  req: Request,
  session: CavbotSession | null | undefined,
): Promise<string | null> {
  if (!session || session.systemRole !== "user") return null;

  const userId = String(session.sub || "").trim();
  const projectId = parseActiveProjectId(req);
  if (!userId || !projectId) return null;

  try {
    return await withEffectiveAccountDeadline(
      withDedicatedAuthClient(async (authClient) => {
        const result = await authClient.query<{ accountId: string }>(
          `
            SELECT p."accountId"
              FROM "Project" p
              JOIN "Membership" m
                ON m."accountId" = p."accountId"
               AND m."userId" = $2
             WHERE p."id" = $1
               AND p."isActive" = TRUE
             LIMIT 1
          `,
          [projectId, userId],
        );

        return String(result.rows[0]?.accountId || "").trim() || null;
      }),
    );
  } catch {
    return null;
  }
}

export async function resolveEffectiveAccountIdFromRequest(
  req: Request,
  sessionInput?: CavbotSession | null | undefined,
) {
  const session = sessionInput ?? (await getSession(req));
  const projectAccountId = await resolveEffectiveAccountIdFromProjectCookie(req, session);
  if (projectAccountId) return projectAccountId;

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
