import "server-only";

import {
  findAccountById,
  findActiveProjectByIdForAccount,
  findMembershipsForUser,
  findPublicProfileUserByUsername,
  findUserById,
  getAuthPool,
  pickPrimaryMembership,
} from "@/lib/authDb";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import {
  isAllowedReservedPublicUsername,
  isBasicUsername,
  isReservedUsername,
  normalizeUsername,
  RESERVED_ROUTE_SLUGS,
} from "@/lib/username";
import type { CavbotSession } from "@/lib/apiAuth";

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function parseWorkspaceProjectId(raw: unknown): number | null {
  const value = s(raw);
  if (!value) return null;
  if (!/^[0-9]{1,10}$/.test(value)) return null;
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id)) return null;
  return id;
}

function toPublicProfileUrl(rawUsername: unknown): string {
  const username = normalizeUsername(rawUsername);
  if (!username) return "";
  return `app.cavbot.io/${username}`;
}

function resolveWorkspaceDisplayName(input: {
  companyName?: unknown;
  username?: unknown;
  accountName?: unknown;
}): string {
  const companyName = s(input.companyName);
  if (companyName) return companyName;

  const profileUrl = toPublicProfileUrl(input.username);
  if (profileUrl) return profileUrl;

  return s(input.accountName) || "Workspace";
}

function isUnsafeProfileSlug(raw: string) {
  const v = s(raw);
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

function canUseUsername(raw: string) {
  if (isUnsafeProfileSlug(raw)) return false;
  const username = normalizeUsername(raw);
  if (!username || !isBasicUsername(username)) return false;
  if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) return false;
  if (isReservedUsername(username) && !isAllowedReservedPublicUsername(username, OWNER_USERNAME)) return false;
  return true;
}

export type PublicProfileWorkspaceContext = {
  username: string;
  profileUserId: string;
  workspaceId: string | null;
  workspaceName: string;
  planId: PlanId;
};

export type PublicProfileViewerTeamState = {
  authenticated: boolean;
  viewerUserId: string | null;
  viewerEmail: string | null;
  inWorkspace: boolean;
  workspaceRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  canManageWorkspace: boolean;
  canInviteFromCurrentAccount: boolean;
  pendingInvite: null | {
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    expiresAtISO: string;
  };
  pendingRequest: null | {
    id: string;
    createdAtISO: string;
  };
};

export async function resolvePublicProfileWorkspaceContext(usernameRaw: string): Promise<PublicProfileWorkspaceContext | null> {
  if (!canUseUsername(usernameRaw)) return null;
  const username = normalizeUsername(usernameRaw);
  if (!username) return null;

  const authPool = (() => {
    try {
      return getAuthPool();
    } catch {
      return null;
    }
  })();

  const authUser = authPool ? await findPublicProfileUserByUsername(authPool, username).catch(() => null) : null;
  const user = authUser ?? (await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      companyName: true,
      publicWorkspaceId: true,
    },
  }).catch(() => null));
  if (!user?.id || !user.username) return null;

  const preferredProjectId = parseWorkspaceProjectId(user.publicWorkspaceId);
  const preferredAccountId = preferredProjectId != null
    ? await prisma.project.findFirst({
        where: {
          id: preferredProjectId,
          isActive: true,
          account: {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
        },
        select: {
          accountId: true,
        },
      }).then((row) => s(row?.accountId)).catch(() => "")
    : "";

  const ownerMembership = preferredAccountId
    ? null
    : await prisma.membership.findFirst({
        where: {
          userId: user.id,
          role: "OWNER",
        },
        orderBy: { createdAt: "asc" },
        select: {
          accountId: true,
        },
      }).catch(() => null);

  const fallbackMembership = preferredAccountId || ownerMembership?.accountId
    ? null
    : await prisma.membership.findFirst({
        where: {
          userId: user.id,
        },
        orderBy: { createdAt: "asc" },
        select: {
          accountId: true,
        },
      }).catch(() => null);

  let accountId = preferredAccountId || s(ownerMembership?.accountId) || s(fallbackMembership?.accountId);
  if (!accountId && authPool) {
    const memberships = await findMembershipsForUser(authPool, s(user.id)).catch(() => []);

    if (preferredProjectId != null) {
      for (const membership of memberships) {
        const project = await findActiveProjectByIdForAccount(authPool, membership.accountId, preferredProjectId).catch(() => null);
        if (project?.id) {
          accountId = membership.accountId;
          break;
        }
      }
    }

    if (!accountId) {
      const primaryMembership = pickPrimaryMembership(memberships);
      accountId = s(primaryMembership?.accountId);
    }
  }
  const account = accountId
    ? await prisma.account.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          name: true,
          tier: true,
        },
      }).catch(() => null)
    : null;
  const authAccount = !account && accountId && authPool ? await findAccountById(authPool, accountId).catch(() => null) : null;

  const workspaceId = s(account?.id) || null;
  const workspaceName = resolveWorkspaceDisplayName({
    companyName: "companyName" in user ? user.companyName : null,
    username: user.username || username,
    accountName: account?.name || authAccount?.name,
  });
  const planId = resolvePlanIdFromTier(s(account?.tier || authAccount?.tier) || "FREE");

  return {
    username: s(user.username) || username,
    profileUserId: s(user.id),
    workspaceId: workspaceId || s(authAccount?.id) || null,
    workspaceName,
    planId,
  };
}

export async function resolvePublicProfileViewerTeamState(args: {
  session: CavbotSession | null;
  workspaceId: string | null;
}): Promise<PublicProfileViewerTeamState> {
  const session = args.session;
  const workspaceId = s(args.workspaceId) || null;

  if (!session || session.systemRole !== "user") {
    return {
      authenticated: false,
      viewerUserId: null,
      viewerEmail: null,
      inWorkspace: false,
      workspaceRole: null,
      canManageWorkspace: false,
      canInviteFromCurrentAccount: false,
      pendingInvite: null,
      pendingRequest: null,
    };
  }

  const viewerUserId = s(session.sub);
  if (!viewerUserId || viewerUserId === "system") {
    return {
      authenticated: false,
      viewerUserId: null,
      viewerEmail: null,
      inWorkspace: false,
      workspaceRole: null,
      canManageWorkspace: false,
      canInviteFromCurrentAccount: false,
      pendingInvite: null,
      pendingRequest: null,
    };
  }

  const authPool = (() => {
    try {
      return getAuthPool();
    } catch {
      return null;
    }
  })();

  const authViewer = authPool ? await findUserById(authPool, viewerUserId).catch(() => null) : null;
  const viewer = authViewer ?? (await prisma.user.findUnique({
    where: { id: viewerUserId },
    select: {
      id: true,
      email: true,
    },
  }).catch(() => null));
  const viewerEmail = s(viewer?.email).toLowerCase() || null;

  const canInviteFromCurrentAccount = (() => {
    const role = s(session.memberRole).toUpperCase();
    return role === "OWNER" || role === "ADMIN";
  })();

  if (!workspaceId) {
    return {
      authenticated: true,
      viewerUserId,
      viewerEmail,
      inWorkspace: false,
      workspaceRole: null,
      canManageWorkspace: false,
      canInviteFromCurrentAccount,
      pendingInvite: null,
      pendingRequest: null,
    };
  }

  const membership = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: workspaceId,
        userId: viewerUserId,
      },
    },
    select: {
      role: true,
    },
  }).catch(() => null);
  const authMembership = !membership && authPool
    ? (await findMembershipsForUser(authPool, viewerUserId).catch(() => [])).find((row) => row.accountId === workspaceId) ?? null
    : null;

  const workspaceRoleRaw = s(membership?.role || authMembership?.role).toUpperCase();
  const workspaceRole = workspaceRoleRaw === "OWNER" || workspaceRoleRaw === "ADMIN" || workspaceRoleRaw === "MEMBER"
    ? (workspaceRoleRaw as "OWNER" | "ADMIN" | "MEMBER")
    : null;
  const inWorkspace = Boolean(workspaceRole);
  const canManageWorkspace = workspaceRole === "OWNER" || workspaceRole === "ADMIN";

  let pendingInvite: PublicProfileViewerTeamState["pendingInvite"] = null;
  let pendingRequest: PublicProfileViewerTeamState["pendingRequest"] = null;

  if (!inWorkspace) {
    const invite = await prisma.invite.findFirst({
      where: {
        accountId: workspaceId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        OR: [
          { inviteeUserId: viewerUserId },
          ...(viewerEmail
            ? [
                { inviteeEmail: viewerEmail },
                { email: viewerEmail },
              ]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        role: true,
        expiresAt: true,
      },
    }).catch(() => null);

    const inviteRoleRaw = s(invite?.role).toUpperCase();
    const inviteRole = inviteRoleRaw === "OWNER" || inviteRoleRaw === "ADMIN" || inviteRoleRaw === "MEMBER"
      ? (inviteRoleRaw as "OWNER" | "ADMIN" | "MEMBER")
      : "MEMBER";

    if (invite?.id && invite?.expiresAt) {
      pendingInvite = {
        id: s(invite.id),
        role: inviteRole,
        expiresAtISO: new Date(invite.expiresAt).toISOString(),
      };
    }

    const request = await prisma.workspaceAccessRequest.findFirst({
      where: {
        accountId: workspaceId,
        requesterUserId: viewerUserId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
      },
    }).catch(() => null);

    if (request?.id && request?.createdAt) {
      pendingRequest = {
        id: s(request.id),
        createdAtISO: new Date(request.createdAt).toISOString(),
      };
    }
  }

  return {
    authenticated: true,
    viewerUserId,
    viewerEmail,
    inWorkspace,
    workspaceRole,
    canManageWorkspace,
    canInviteFromCurrentAccount,
    pendingInvite,
    pendingRequest,
  };
}
