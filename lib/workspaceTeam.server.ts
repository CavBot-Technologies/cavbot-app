import "server-only";

import crypto from "crypto";

import type { Prisma } from "@prisma/client";

import { getEffectiveAccountPlanContext } from "@/lib/cavcloud/plan.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { WORKSPACE_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { normalizeUsernameExact, normalizeUsernameLookupQuery } from "@/lib/workspaceIdentity";

type InviteRole = "ADMIN" | "MEMBER";

type WorkspaceInviteStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "EXPIRED";
type WorkspaceAccessRequestStatus = "PENDING" | "APPROVED" | "DENIED";

type NotificationTone = "GOOD" | "WATCH" | "BAD";

export type WorkspaceResolvedUser = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type WorkspaceInviteView = {
  id: string;
  accountId: string;
  role: InviteRole;
  status: WorkspaceInviteStatus;
  createdAtISO: string;
  expiresAtISO: string;
  respondedAtISO: string | null;
  inviteeUserId: string | null;
  inviteeEmail: string | null;
  invitee: WorkspaceResolvedUser | null;
};

export type WorkspaceAccessRequestView = {
  id: string;
  accountId: string;
  status: WorkspaceAccessRequestStatus;
  createdAtISO: string;
  respondedAtISO: string | null;
  respondedByUserId: string | null;
  requester: WorkspaceResolvedUser;
};

type CreateInviteInput = {
  accountId: string;
  inviterUserId: string;
  role: InviteRole;
  inviteeUserId?: string | null;
  inviteeEmail?: string | null;
};

type CreateInviteResult =
  | { ok: false; error: "BAD_INPUT" | "SELF_INVITE" | "INVITEE_NOT_FOUND" | "ALREADY_MEMBER" | "PLAN_SEAT_LIMIT"; message: string }
  | {
      ok: true;
      reused: boolean;
      invite: WorkspaceInviteView;
      emailDelivery: null | {
        to: string;
        token: string;
      };
    };

type InviteActionResult =
  | { ok: false; error: string; message: string }
  | {
      ok: true;
      inviteId: string;
      accountId: string;
      workspaceName: string;
      status: WorkspaceInviteStatus;
      membershipId: string | null;
      alreadyHandled: boolean;
      alreadyMember: boolean;
      grantedRole: InviteRole | null;
      subjectUserId: string | null;
      subjectUsername: string | null;
    };

type CreateAccessRequestInput = {
  requesterUserId: string;
  targetWorkspaceId?: string | null;
  targetOwnerUsername?: string | null;
  targetOwnerProfileUrl?: string | null;
};

type CreateAccessRequestResult =
  | { ok: false; error: "BAD_TARGET" | "TARGET_NOT_FOUND" | "ALREADY_MEMBER"; message: string }
  | {
      ok: true;
      deduped: boolean;
      request: WorkspaceAccessRequestView;
      workspace: {
        id: string;
        name: string;
      };
    };

type AccessRequestDecisionResult =
  | { ok: false; error: string; message: string }
  | {
      ok: true;
      requestId: string;
      accountId: string;
      workspaceName: string;
      status: WorkspaceAccessRequestStatus;
      membershipId: string | null;
      alreadyHandled: boolean;
      alreadyMember: boolean;
      grantedRole: InviteRole | null;
      subjectUserId: string | null;
      subjectUsername: string | null;
    };

const INVITE_EXPIRY_DAYS = 7;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toPublicProfileUrl(raw: unknown): string {
  const username = normalizeUsernameExact(raw);
  if (!username) return "";
  return `app.cavbot.io/${username}`;
}

function resolveTargetWorkspaceName(input: {
  companyName?: unknown;
  accountName?: unknown;
  ownerUsername?: unknown;
  fallbackOwnerInput?: unknown;
}): string {
  const companyName = s(input.companyName);
  if (companyName) return companyName;

  const profileUrl = toPublicProfileUrl(input.ownerUsername || input.fallbackOwnerInput || "");
  if (profileUrl) return profileUrl;

  return s(input.accountName) || "Workspace";
}

function toISO(date: Date | null | undefined): string | null {
  if (!date) return null;
  try {
    return date.toISOString();
  } catch {
    return null;
  }
}

function toSafeInviteRole(raw: unknown): InviteRole {
  return String(raw || "").trim().toUpperCase() === "ADMIN" ? "ADMIN" : "MEMBER";
}

function parseInviteRoleStrict(raw: unknown): InviteRole | null {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return null;
  if (value === "ADMIN" || value === "MEMBER") return value;
  return null;
}

function normalizeEmail(raw: unknown): string {
  return s(raw).toLowerCase();
}

function isEmailLike(raw: string): boolean {
  return raw.includes("@") && raw.includes(".") && raw.length <= 254;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hasManageTeamRole(rawRole: unknown): boolean {
  const role = String(rawRole || "").trim().toUpperCase();
  return role === "OWNER" || role === "ADMIN";
}

function jsonMeta(meta: Record<string, unknown>): Prisma.JsonObject {
  return meta as Prisma.JsonObject;
}

export function isWorkspaceAccessRequestSchemaMismatch(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["WorkspaceAccessRequest", "Membership", "User", "Account"],
    columns: [
      "accountId",
      "requesterUserId",
      "respondedByUserId",
      "status",
      "createdAt",
      "respondedAt",
      "role",
      "username",
      "displayName",
      "avatarImage",
      "companyName",
      "name",
    ],
  });
}

async function writeWorkspaceNotification(args: {
  userId: string;
  title: string;
  body: string;
  kind: string;
  tone?: NotificationTone;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const userId = s(args.userId);
  if (!userId) return;

  await prisma.notification.create({
    data: {
      userId,
      accountId: null,
      title: s(args.title) || "Workspace update",
      body: s(args.body) || null,
      kind: s(args.kind) || "GENERIC",
      tone: args.tone || "GOOD",
      metaJson: args.meta ? jsonMeta(args.meta) : undefined,
    },
  });
}

async function expirePendingInvitesForAccount(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
  await tx.invite.updateMany({
    where: {
      accountId,
      status: "PENDING",
      expiresAt: { lte: new Date() },
    },
    data: {
      status: "EXPIRED",
      respondedAt: new Date(),
    },
  });
}

async function currentSeatCapacity(accountId: string): Promise<{ seatLimit: number; planId: string }> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { tier: true },
  });

  const plan = await getEffectiveAccountPlanContext(accountId).catch(() => null);
  const planId = plan?.planId ?? resolvePlanIdFromTier(account?.tier || "FREE");
  const limits = getPlanLimits(planId);
  return {
    seatLimit: Number(limits?.seats ?? 0),
    planId,
  };
}

async function assertSeatCapacityForInvite(tx: Prisma.TransactionClient, args: { accountId: string; seatLimit: number }): Promise<boolean> {
  if (args.seatLimit <= 0) return true;

  const [membersCount, pendingInvitesCount] = await Promise.all([
    tx.membership.count({
      where: { accountId: args.accountId },
    }),
    tx.invite.count({
      where: {
        accountId: args.accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  return membersCount + pendingInvitesCount < args.seatLimit;
}

async function assertSeatCapacityForMembership(tx: Prisma.TransactionClient, args: {
  accountId: string;
  userId: string;
  seatLimit: number;
}): Promise<boolean> {
  if (args.seatLimit <= 0) return true;

  const existingMembership = await tx.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.userId,
      },
    },
    select: { id: true },
  });

  if (existingMembership?.id) return true;

  const [membersCount, pendingInvitesCount] = await Promise.all([
    tx.membership.count({ where: { accountId: args.accountId } }),
    tx.invite.count({
      where: {
        accountId: args.accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);

  return membersCount + pendingInvitesCount < args.seatLimit;
}

async function resolveManageTeamOperator(args: { accountId: string; operatorUserId: string }) {
  const membership = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.operatorUserId,
      },
    },
    select: { role: true },
  });

  if (!hasManageTeamRole(membership?.role)) return null;
  return membership;
}

async function resolveWorkspaceOwnerOperator(args: { accountId: string; operatorUserId: string }) {
  const membership = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.operatorUserId,
      },
    },
    select: { role: true },
  });

  return String(membership?.role || "").trim().toUpperCase() === "OWNER" ? membership : null;
}

async function resolveWorkspaceInviteeFromInput(args: {
  inviteeUserId?: string | null;
  inviteeEmail?: string | null;
}): Promise<
  | { ok: false; error: "BAD_INPUT" | "INVITEE_NOT_FOUND"; message: string }
  | {
      ok: true;
      mode: "user" | "email";
      inviteeUserId: string | null;
      inviteeEmail: string | null;
      internalEmail: string;
      inviteeProfile: WorkspaceResolvedUser | null;
    }
> {
  const inviteeUserId = s(args.inviteeUserId);
  const inviteeEmail = normalizeEmail(args.inviteeEmail);

  if ((inviteeUserId ? 1 : 0) + (inviteeEmail ? 1 : 0) !== 1) {
    return {
      ok: false,
      error: "BAD_INPUT",
      message: "Provide exactly one invite target.",
    };
  }

  if (inviteeUserId) {
    const invitee = await prisma.user.findUnique({
      where: { id: inviteeUserId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarImage: true,
      },
    });

    if (!invitee?.id || !s(invitee.email)) {
      return {
        ok: false,
        error: "INVITEE_NOT_FOUND",
        message: "Invitee was not found.",
      };
    }

    return {
      ok: true,
      mode: "user",
      inviteeUserId: invitee.id,
      inviteeEmail: null,
      internalEmail: normalizeEmail(invitee.email),
      inviteeProfile: {
        userId: invitee.id,
        username: s(invitee.username),
        displayName: invitee.displayName || null,
        avatarUrl: invitee.avatarImage || null,
      },
    };
  }

  if (!inviteeEmail || !isEmailLike(inviteeEmail)) {
    return {
      ok: false,
      error: "BAD_INPUT",
      message: "Enter a valid email address.",
    };
  }

  return {
    ok: true,
    mode: "email",
    inviteeUserId: null,
    inviteeEmail,
    internalEmail: inviteeEmail,
    inviteeProfile: null,
  };
}

async function resolveWorkspaceIdentity(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      name: true,
    },
  });
  return {
    id: s(account?.id),
    name: s(account?.name) || "Workspace",
  };
}

function inviteNotificationMeta(args: {
  inviteId: string;
  workspace: { id: string; name: string };
  inviter: { userId: string; username: string; displayName: string | null; avatarUrl: string | null };
  role: InviteRole;
}) {
  return {
    entityType: "invite",
    entityId: args.inviteId,
    workspace: {
      id: args.workspace.id,
      name: args.workspace.name,
    },
    inviter: {
      userId: args.inviter.userId,
      username: args.inviter.username || null,
      displayName: args.inviter.displayName,
      avatarUrl: args.inviter.avatarUrl,
    },
    role: args.role,
    actions: {
      accept: {
        label: "Accept",
        href: "/api/invites/respond",
        method: "POST",
        body: {
          inviteId: args.inviteId,
          decision: "ACCEPT",
        },
      },
      deny: {
        label: "Deny",
        href: "/api/invites/respond",
        method: "POST",
        body: {
          inviteId: args.inviteId,
          decision: "DECLINE",
        },
      },
    },
  };
}

function accessRequestNotificationMeta(args: {
  requestId: string;
  workspace: { id: string; name: string };
  requester: { userId: string; username: string; displayName: string | null; avatarUrl: string | null };
}) {
  return {
    entityType: "access_request",
    entityId: args.requestId,
    workspace: {
      id: args.workspace.id,
      name: args.workspace.name,
    },
    requester: {
      userId: args.requester.userId,
      username: args.requester.username || null,
      displayName: args.requester.displayName,
      avatarUrl: args.requester.avatarUrl,
    },
    actions: {
      approve: {
        label: "Approve",
        href: "/api/access-requests/respond",
        method: "POST",
        body: {
          requestId: args.requestId,
          decision: "APPROVE",
        },
      },
      deny: {
        label: "Deny",
        href: "/api/access-requests/respond",
        method: "POST",
        body: {
          requestId: args.requestId,
          decision: "DENY",
        },
      },
    },
  };
}

function atLabel(username: string | null | undefined, fallback: string): string {
  const value = s(username);
  return value ? `@${value}` : fallback;
}

async function notifyWorkspaceInviteReceived(args: {
  inviteeUserId: string;
  inviteId: string;
  workspace: { id: string; name: string };
  inviter: { userId: string; username: string; displayName: string | null; avatarUrl: string | null };
  role: InviteRole;
}) {
  const inviterLabel = atLabel(args.inviter.username, "A workspace admin");
  await writeWorkspaceNotification({
    userId: args.inviteeUserId,
    title: "Workspace invite",
    body: `${inviterLabel} invited you to join ${args.workspace.name} as ${args.role === "ADMIN" ? "Admin" : "Member"}.`,
    kind: WORKSPACE_NOTIFICATION_KINDS.WORKSPACE_INVITE_RECEIVED,
    tone: "GOOD",
    meta: inviteNotificationMeta({
      inviteId: args.inviteId,
      workspace: args.workspace,
      inviter: args.inviter,
      role: args.role,
    }),
  });
}

async function notifyWorkspaceInviteAccepted(args: {
  inviterUserId: string;
  inviteId: string;
  workspace: { id: string; name: string };
  invitee: { userId: string; username: string; displayName: string | null; avatarUrl: string | null };
  grantedRole: InviteRole;
}) {
  const inviteeLabel = atLabel(args.invitee.username, "A workspace member");
  await writeWorkspaceNotification({
    userId: args.inviterUserId,
    title: "Invite accepted",
    body: `${inviteeLabel} accepted your invite as ${args.grantedRole === "ADMIN" ? "Admin" : "Member"}.`,
    kind: WORKSPACE_NOTIFICATION_KINDS.WORKSPACE_INVITE_ACCEPTED,
    tone: "GOOD",
    meta: {
      entityType: "invite",
      entityId: args.inviteId,
      workspace: args.workspace,
      invitee: {
        userId: args.invitee.userId,
        username: args.invitee.username || null,
        displayName: args.invitee.displayName,
        avatarUrl: args.invitee.avatarUrl,
      },
      inviteId: args.inviteId,
      grantedRole: args.grantedRole,
    },
  });
}

async function notifyWorkspaceAccessRequestReceived(args: {
  requestId: string;
  ownerUserId: string;
  workspace: { id: string; name: string };
  requester: { userId: string; username: string; displayName: string | null; avatarUrl: string | null };
}) {
  const requesterLabel = atLabel(args.requester.username, "A CavBot user");
  await writeWorkspaceNotification({
    userId: args.ownerUserId,
    title: "Access request",
    body: `${requesterLabel} requested access to ${args.workspace.name}.`,
    kind: WORKSPACE_NOTIFICATION_KINDS.WORKSPACE_ACCESS_REQUEST_RECEIVED,
    tone: "WATCH",
    meta: accessRequestNotificationMeta({
      requestId: args.requestId,
      workspace: args.workspace,
      requester: args.requester,
    }),
  });
}

async function notifyAccessRequestApproved(args: {
  requesterUserId: string;
  workspace: { id: string; name: string };
  approverUsername: string;
  requestId: string;
  grantedRole: InviteRole;
}) {
  const approverLabel = atLabel(args.approverUsername, "A workspace owner");
  await writeWorkspaceNotification({
    userId: args.requesterUserId,
    title: "Access request approved",
    body: `${approverLabel} approved your access request as ${args.grantedRole === "ADMIN" ? "Admin" : "Member"}.`,
    kind: WORKSPACE_NOTIFICATION_KINDS.WORKSPACE_ACCESS_REQUEST_APPROVED,
    tone: "GOOD",
    meta: {
      entityType: "access_request",
      entityId: args.requestId,
      workspace: args.workspace,
      approver: {
        username: args.approverUsername || null,
      },
      requestId: args.requestId,
      grantedRole: args.grantedRole,
    },
  });
}

function mapInviteForView(invite: {
  id: string;
  accountId: string;
  role: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  inviteeUserId: string | null;
  inviteeEmail: string | null;
  invitee: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarImage: string | null;
  } | null;
}): WorkspaceInviteView {
  return {
    id: invite.id,
    accountId: invite.accountId,
    role: toSafeInviteRole(invite.role),
    status: (s(invite.status) || "PENDING") as WorkspaceInviteStatus,
    createdAtISO: toISO(invite.createdAt) || new Date(0).toISOString(),
    expiresAtISO: toISO(invite.expiresAt) || new Date(0).toISOString(),
    respondedAtISO: toISO(invite.respondedAt),
    inviteeUserId: invite.inviteeUserId,
    inviteeEmail: invite.inviteeEmail,
    invitee: invite.invitee
      ? {
          userId: invite.invitee.id,
          username: s(invite.invitee.username),
          displayName: invite.invitee.displayName,
          avatarUrl: invite.invitee.avatarImage,
        }
      : null,
  };
}

function mapAccessRequestForView(request: {
  id: string;
  accountId: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
  respondedByUserId: string | null;
  requesterUser: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarImage: string | null;
  };
}): WorkspaceAccessRequestView {
  return {
    id: request.id,
    accountId: request.accountId,
    status: (s(request.status) || "PENDING") as WorkspaceAccessRequestStatus,
    createdAtISO: toISO(request.createdAt) || new Date(0).toISOString(),
    respondedAtISO: toISO(request.respondedAt),
    respondedByUserId: request.respondedByUserId,
    requester: {
      userId: request.requesterUser.id,
      username: s(request.requesterUser.username),
      displayName: request.requesterUser.displayName,
      avatarUrl: request.requesterUser.avatarImage,
    },
  };
}

export async function resolveUsersForWorkspaceQuery(args: {
  query: string;
  limit?: number;
}): Promise<WorkspaceResolvedUser[]> {
  const query = normalizeUsernameLookupQuery(args.query);
  if (!query) return [];

  const limit = Math.max(1, Math.min(10, Math.trunc(Number(args.limit || 8)) || 8));

  const rows = await prisma.user.findMany({
    where: {
      OR: [
        {
          username: {
            startsWith: query,
            mode: "insensitive",
          },
        },
        {
          username: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          displayName: {
            contains: query,
            mode: "insensitive",
          },
        },
      ],
    },
    take: Math.max(limit * 3, 20),
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarImage: true,
    },
  });

  const ranked = rows
    .filter((row) => s(row.username))
    .map((row) => ({
      userId: row.id,
      username: s(row.username),
      displayName: row.displayName || null,
      avatarUrl: row.avatarImage || null,
    }))
    .sort((a, b) => {
      const aUsername = a.username.toLowerCase();
      const bUsername = b.username.toLowerCase();
      const exactA = aUsername === query ? 0 : 1;
      const exactB = bUsername === query ? 0 : 1;
      if (exactA !== exactB) return exactA - exactB;

      const prefixA = aUsername.startsWith(query) ? 0 : 1;
      const prefixB = bUsername.startsWith(query) ? 0 : 1;
      if (prefixA !== prefixB) return prefixA - prefixB;

      if (aUsername.length !== bUsername.length) return aUsername.length - bUsername.length;
      return aUsername.localeCompare(bUsername);
    });

  return ranked.slice(0, limit);
}

export async function createWorkspaceInvite(input: CreateInviteInput): Promise<CreateInviteResult> {
  const accountId = s(input.accountId);
  const inviterUserId = s(input.inviterUserId);
  const role = toSafeInviteRole(input.role);

  if (!accountId || !inviterUserId) {
    return {
      ok: false,
      error: "BAD_INPUT",
      message: "Missing workspace invite context.",
    };
  }

  const inviteTarget = await resolveWorkspaceInviteeFromInput({
    inviteeUserId: input.inviteeUserId,
    inviteeEmail: input.inviteeEmail,
  });
  if (!inviteTarget.ok) return inviteTarget;

  if (inviteTarget.inviteeUserId && inviteTarget.inviteeUserId === inviterUserId) {
    return {
      ok: false,
      error: "SELF_INVITE",
      message: "You cannot invite yourself.",
    };
  }

  const inviter = await prisma.user.findUnique({
    where: { id: inviterUserId },
    select: { id: true, email: true, username: true, displayName: true, avatarImage: true },
  });

  if (inviteTarget.mode === "email" && inviter?.email && normalizeEmail(inviter.email) === inviteTarget.inviteeEmail) {
    return {
      ok: false,
      error: "SELF_INVITE",
      message: "You cannot invite yourself.",
    };
  }

  const { seatLimit } = await currentSeatCapacity(accountId);

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const transactionResult = await prisma.$transaction(async (tx) => {
    await expirePendingInvitesForAccount(tx, accountId);

    const existingMember = inviteTarget.inviteeUserId
      ? await tx.membership.findUnique({
          where: {
            accountId_userId: {
              accountId,
              userId: inviteTarget.inviteeUserId,
            },
          },
          select: { id: true },
        })
      : await tx.membership.findFirst({
          where: {
            accountId,
            user: {
              email: inviteTarget.internalEmail,
            },
          },
          select: { id: true },
        });

    if (existingMember?.id) {
      return { kind: "ALREADY_MEMBER" as const };
    }

    const pendingInvite = await tx.invite.findFirst({
      where: {
        accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        ...(inviteTarget.inviteeUserId
          ? { inviteeUserId: inviteTarget.inviteeUserId }
          : { inviteeEmail: inviteTarget.inviteeEmail }),
      },
      select: {
        id: true,
        accountId: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        respondedAt: true,
        inviteeUserId: true,
        inviteeEmail: true,
        invitee: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarImage: true,
          },
        },
      },
    });

    if (pendingInvite?.id) {
      return {
        kind: "REUSED" as const,
        invite: pendingInvite,
      };
    }

    const hasCapacity = await assertSeatCapacityForInvite(tx, { accountId, seatLimit });
    if (!hasCapacity) {
      return { kind: "PLAN_SEAT_LIMIT" as const };
    }

    const created = await tx.invite.create({
      data: {
        accountId,
        email: inviteTarget.internalEmail,
        inviteeEmail: inviteTarget.inviteeEmail,
        inviteeUserId: inviteTarget.inviteeUserId,
        role,
        status: "PENDING",
        tokenHash,
        expiresAt,
        sentById: inviterUserId,
      },
      select: {
        id: true,
        accountId: true,
        role: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        respondedAt: true,
        inviteeUserId: true,
        inviteeEmail: true,
        invitee: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarImage: true,
          },
        },
      },
    });

    return {
      kind: "CREATED" as const,
      invite: created,
    };
  });

  if (transactionResult.kind === "ALREADY_MEMBER") {
    return {
      ok: false,
      error: "ALREADY_MEMBER",
      message: "This user is already a member.",
    };
  }

  if (transactionResult.kind === "PLAN_SEAT_LIMIT") {
    return {
      ok: false,
      error: "PLAN_SEAT_LIMIT",
      message: "Seat limit reached for this plan.",
    };
  }

  const workspace = await resolveWorkspaceIdentity(accountId);
  const inviterIdentity = {
    userId: s(inviter?.id),
    username: s(inviter?.username),
    displayName: inviter?.displayName || null,
    avatarUrl: inviter?.avatarImage || null,
  };

  const invite = mapInviteForView(transactionResult.invite);

  if (transactionResult.kind === "CREATED") {
    if (invite.inviteeUserId) {
      await notifyWorkspaceInviteReceived({
        inviteeUserId: invite.inviteeUserId,
        inviteId: invite.id,
        workspace,
        inviter: inviterIdentity,
        role: invite.role,
      });
    } else if (invite.inviteeEmail) {
      const matchedUser = await prisma.user.findUnique({
        where: { email: invite.inviteeEmail },
        select: { id: true },
      });

      if (matchedUser?.id) {
        await notifyWorkspaceInviteReceived({
          inviteeUserId: matchedUser.id,
          inviteId: invite.id,
          workspace,
          inviter: inviterIdentity,
          role: invite.role,
        });
      }
    }
  }

  return {
    ok: true,
    reused: transactionResult.kind === "REUSED",
    invite,
    emailDelivery: transactionResult.kind === "CREATED" && inviteTarget.mode === "email"
      ? {
          to: inviteTarget.inviteeEmail || inviteTarget.internalEmail,
          token,
        }
      : null,
  };
}

async function resolveInviteForOperator(args: { inviteId: string; operatorUserId: string }) {
  const invite = await prisma.invite.findUnique({
    where: { id: args.inviteId },
    select: {
      id: true,
      accountId: true,
      sentById: true,
      inviteeUserId: true,
      inviteeEmail: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      respondedAt: true,
    },
  });

  if (!invite?.id) {
    return {
      ok: false as const,
      error: "INVITE_NOT_FOUND",
      message: "Invite was not found.",
    };
  }

  const operator = await prisma.user.findUnique({
    where: { id: args.operatorUserId },
    select: { id: true, email: true, username: true, displayName: true, avatarImage: true },
  });

  if (!operator?.id) {
    return {
      ok: false as const,
      error: "UNAUTHORIZED",
      message: "Invitee account not found.",
    };
  }

  const operatorEmail = normalizeEmail(operator.email);
  const inviteEmail = normalizeEmail(invite.inviteeEmail || invite.email);

  const allowed = invite.inviteeUserId
    ? invite.inviteeUserId === operator.id
    : inviteEmail && operatorEmail && inviteEmail === operatorEmail;

  if (!allowed) {
    return {
      ok: false as const,
      error: "INVITE_FORBIDDEN",
      message: "You are not allowed to respond to this invite.",
    };
  }

  return {
    ok: true as const,
    operator,
    invite,
  };
}

export async function acceptWorkspaceInvite(args: {
  inviteId: string;
  operatorUserId: string;
  role?: InviteRole | string | null;
}): Promise<InviteActionResult> {
  const inviteId = s(args.inviteId);
  const operatorUserId = s(args.operatorUserId);
  if (!inviteId || !operatorUserId) {
    return { ok: false, error: "BAD_INVITE", message: "Invite id is required." };
  }

  const requestedRole = parseInviteRoleStrict(args.role);
  if (args.role !== undefined && args.role !== null && !requestedRole) {
    return {
      ok: false,
      error: "FORBIDDEN",
      message: "Role must be MEMBER or ADMIN.",
    };
  }

  const resolved = await resolveInviteForOperator({ inviteId, operatorUserId });
  if (!resolved.ok) return resolved;
  const workspace = await resolveWorkspaceIdentity(resolved.invite.accountId);
  const grantedRole = requestedRole || toSafeInviteRole(resolved.invite.role);

  const status = s(resolved.invite.status).toUpperCase() as WorkspaceInviteStatus;

  if (status === "EXPIRED" || resolved.invite.expiresAt <= new Date()) {
    await prisma.invite.updateMany({
      where: { id: inviteId, status: "PENDING" },
      data: { status: "EXPIRED", respondedAt: new Date() },
    });
    return {
      ok: false,
      error: "INVITE_EXPIRED",
      message: "Invite is expired.",
    };
  }

  if (status === "DECLINED") {
    return {
      ok: false,
      error: "INVITE_DECLINED",
      message: "Invite was declined. Request access instead.",
    };
  }

  if (status === "REVOKED") {
    return {
      ok: false,
      error: "INVITE_REVOKED",
      message: "Invite is no longer active.",
    };
  }

  if (status === "ACCEPTED") {
    const existing = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId: resolved.invite.accountId,
          userId: operatorUserId,
        },
      },
      select: { id: true, role: true },
    });

    if (!existing?.id) {
      return {
        ok: false,
        error: "INVITE_ACCEPTED_MEMBERSHIP_MISSING",
        message: "Invite is accepted but membership is missing.",
      };
    }

    if (existing.role !== grantedRole) {
      await prisma.membership.update({
        where: { id: existing.id },
        data: { role: grantedRole },
      });
    }

    return {
      ok: true,
      inviteId,
      accountId: resolved.invite.accountId,
      workspaceName: workspace.name,
      status: "ACCEPTED",
      membershipId: existing.id,
      alreadyHandled: true,
      alreadyMember: true,
      grantedRole,
      subjectUserId: operatorUserId,
      subjectUsername: s(resolved.operator.username) || null,
    };
  }

  const accepted = await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.upsert({
      where: {
        accountId_userId: {
          accountId: resolved.invite.accountId,
          userId: operatorUserId,
        },
      },
      create: {
        accountId: resolved.invite.accountId,
        userId: operatorUserId,
        role: grantedRole,
      },
      update: {
        role: grantedRole,
      },
      select: { id: true, role: true },
    });

    await tx.invite.update({
      where: { id: inviteId },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        respondedAt: new Date(),
        inviteeUserId: operatorUserId,
      },
    });

    return membership;
  });

  if (resolved.invite.sentById && resolved.invite.sentById !== operatorUserId) {
    await notifyWorkspaceInviteAccepted({
      inviterUserId: resolved.invite.sentById,
      inviteId,
      workspace,
      invitee: {
        userId: operatorUserId,
        username: s(resolved.operator.username),
        displayName: resolved.operator.displayName || null,
        avatarUrl: resolved.operator.avatarImage || null,
      },
      grantedRole,
    });
  }

  return {
    ok: true,
    inviteId,
    accountId: resolved.invite.accountId,
    workspaceName: workspace.name,
    status: "ACCEPTED",
    membershipId: accepted.id,
    alreadyHandled: false,
    alreadyMember: false,
    grantedRole: toSafeInviteRole(accepted.role),
    subjectUserId: operatorUserId,
    subjectUsername: s(resolved.operator.username) || null,
  };
}

export async function declineWorkspaceInvite(args: { inviteId: string; operatorUserId: string }): Promise<InviteActionResult> {
  const inviteId = s(args.inviteId);
  const operatorUserId = s(args.operatorUserId);
  if (!inviteId || !operatorUserId) {
    return { ok: false, error: "BAD_INVITE", message: "Invite id is required." };
  }

  const resolved = await resolveInviteForOperator({ inviteId, operatorUserId });
  if (!resolved.ok) return resolved;
  const workspace = await resolveWorkspaceIdentity(resolved.invite.accountId);
  const subjectUsername = s(resolved.operator.username) || null;

  const status = s(resolved.invite.status).toUpperCase() as WorkspaceInviteStatus;

  if (status === "DECLINED") {
    return {
      ok: true,
      inviteId,
      accountId: resolved.invite.accountId,
      workspaceName: workspace.name,
      status: "DECLINED",
      membershipId: null,
      alreadyHandled: true,
      alreadyMember: false,
      grantedRole: null,
      subjectUserId: operatorUserId,
      subjectUsername,
    };
  }

  if (status === "ACCEPTED") {
    return {
      ok: false,
      error: "INVITE_ALREADY_ACCEPTED",
      message: "Invite is already accepted.",
    };
  }

  if (status === "REVOKED") {
    return {
      ok: false,
      error: "INVITE_REVOKED",
      message: "Invite is no longer active.",
    };
  }

  if (status === "EXPIRED" || resolved.invite.expiresAt <= new Date()) {
    await prisma.invite.updateMany({
      where: { id: inviteId, status: "PENDING" },
      data: { status: "EXPIRED", respondedAt: new Date() },
    });
    return {
      ok: false,
      error: "INVITE_EXPIRED",
      message: "Invite is expired.",
    };
  }

  await prisma.invite.update({
    where: { id: inviteId },
    data: {
      status: "DECLINED",
      respondedAt: new Date(),
      inviteeUserId: operatorUserId,
    },
  });

  return {
    ok: true,
    inviteId,
    accountId: resolved.invite.accountId,
    workspaceName: workspace.name,
    status: "DECLINED",
    membershipId: null,
    alreadyHandled: false,
    alreadyMember: false,
    grantedRole: null,
    subjectUserId: operatorUserId,
    subjectUsername,
  };
}

async function resolveTargetWorkspace(input: {
  targetWorkspaceId?: string | null;
  targetOwnerUsername?: string | null;
  targetOwnerProfileUrl?: string | null;
}): Promise<{ id: string; name: string } | null> {
  const targetWorkspaceId = s(input.targetWorkspaceId);
  if (targetWorkspaceId) {
    const workspace = await prisma.account.findUnique({
      where: { id: targetWorkspaceId },
      select: {
        id: true,
        name: true,
        members: {
          where: {
            role: "OWNER",
          },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            user: {
              select: {
                companyName: true,
                username: true,
              },
            },
          },
        },
      },
    });
    if (!workspace?.id) return null;
    const workspaceOwner = workspace.members?.[0]?.user;
    return {
      id: workspace.id,
      name: resolveTargetWorkspaceName({
        companyName: workspaceOwner?.companyName,
        accountName: workspace.name,
        ownerUsername: workspaceOwner?.username,
        fallbackOwnerInput: input.targetOwnerUsername || input.targetOwnerProfileUrl,
      }),
    };
  }

  const username = normalizeUsernameExact(input.targetOwnerUsername || input.targetOwnerProfileUrl || "");
  if (!username) return null;

  const ownerMembership = await prisma.membership.findFirst({
    where: {
      role: "OWNER",
      user: {
        username: {
          equals: username,
          mode: "insensitive",
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      user: {
        select: {
          companyName: true,
          username: true,
        },
      },
      account: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!ownerMembership?.account?.id) return null;
  return {
    id: ownerMembership.account.id,
    name: resolveTargetWorkspaceName({
      companyName: ownerMembership.user?.companyName,
      accountName: ownerMembership.account.name,
      ownerUsername: ownerMembership.user?.username || username,
      fallbackOwnerInput: input.targetOwnerProfileUrl || input.targetOwnerUsername,
    }),
  };
}

export async function resolveWorkspaceAccessTarget(input: {
  targetWorkspaceId?: string | null;
  targetOwnerUsername?: string | null;
  targetOwnerProfileUrl?: string | null;
}): Promise<{ id: string; name: string } | null> {
  return resolveTargetWorkspace(input);
}

async function listWorkspaceOwners(accountId: string): Promise<string[]> {
  const owners = await prisma.membership.findMany({
    where: {
      accountId,
      role: "OWNER",
    },
    select: { userId: true },
  });

  return owners.map((row) => s(row.userId)).filter(Boolean);
}

export async function createWorkspaceAccessRequest(input: CreateAccessRequestInput): Promise<CreateAccessRequestResult> {
  const requesterUserId = s(input.requesterUserId);
  if (!requesterUserId) {
    return {
      ok: false,
      error: "BAD_TARGET",
      message: "Requester is required.",
    };
  }

  const workspace = await resolveTargetWorkspace({
    targetWorkspaceId: input.targetWorkspaceId,
    targetOwnerUsername: input.targetOwnerUsername,
    targetOwnerProfileUrl: input.targetOwnerProfileUrl,
  });

  if (!workspace?.id) {
    return {
      ok: false,
      error: "TARGET_NOT_FOUND",
      message: "Workspace target was not found.",
    };
  }

  const existingMembership = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: workspace.id,
        userId: requesterUserId,
      },
    },
    select: { id: true },
  });

  if (existingMembership?.id) {
    return {
      ok: false,
      error: "ALREADY_MEMBER",
      message: "You are already a member of this workspace.",
    };
  }

  const [requesterIdentity, requestRecord] = await prisma.$transaction(async (tx) => {
    const requester = await tx.user.findUnique({
      where: { id: requesterUserId },
      select: { id: true, username: true, displayName: true, avatarImage: true },
    });

    if (!requester?.id) {
      throw new Error("REQUESTER_NOT_FOUND");
    }

    const pending = await tx.workspaceAccessRequest.findFirst({
      where: {
        accountId: workspace.id,
        requesterUserId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        accountId: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        respondedByUserId: true,
        requesterUser: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarImage: true,
          },
        },
      },
    });

    if (pending?.id) {
      return [
        {
          userId: requester.id,
          username: s(requester.username),
          displayName: requester.displayName || null,
          avatarUrl: requester.avatarImage || null,
        },
        {
          deduped: true,
          record: pending,
        },
      ] as const;
    }

    const created = await tx.workspaceAccessRequest.create({
      data: {
        accountId: workspace.id,
        requesterUserId,
        status: "PENDING",
      },
      select: {
        id: true,
        accountId: true,
        status: true,
        createdAt: true,
        respondedAt: true,
        respondedByUserId: true,
        requesterUser: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarImage: true,
          },
        },
      },
    });

    return [
      {
        userId: requester.id,
        username: s(requester.username),
        displayName: requester.displayName || null,
        avatarUrl: requester.avatarImage || null,
      },
      {
        deduped: false,
        record: created,
      },
    ] as const;
  });

  if (!requestRecord.deduped) {
    const owners = await listWorkspaceOwners(workspace.id);
    for (const ownerUserId of owners) {
      await notifyWorkspaceAccessRequestReceived({
        requestId: requestRecord.record.id,
        ownerUserId,
        workspace,
        requester: requesterIdentity,
      });
    }
  }

  return {
    ok: true,
    deduped: requestRecord.deduped,
    request: mapAccessRequestForView(requestRecord.record),
    workspace,
  };
}

export async function listWorkspaceAccessRequests(args: {
  accountId: string;
  operatorUserId: string;
  status?: string | null;
}): Promise<WorkspaceAccessRequestView[] | null> {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  if (!accountId || !operatorUserId) return null;

  const operator = await resolveManageTeamOperator({ accountId, operatorUserId });
  if (!operator) return null;

  const statusRaw = s(args.status).toUpperCase();
  const status = statusRaw === "PENDING" || statusRaw === "APPROVED" || statusRaw === "DENIED"
    ? statusRaw
    : null;

  const rows = await prisma.workspaceAccessRequest.findMany({
    where: {
      accountId,
      ...(status ? { status } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      accountId: true,
      status: true,
      createdAt: true,
      respondedAt: true,
      respondedByUserId: true,
      requesterUser: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarImage: true,
        },
      },
    },
  });

  return rows.map(mapAccessRequestForView);
}

export async function approveWorkspaceAccessRequest(args: {
  requestId: string;
  operatorUserId: string;
  role?: InviteRole | string | null;
}): Promise<AccessRequestDecisionResult> {
  const requestId = s(args.requestId);
  const operatorUserId = s(args.operatorUserId);
  if (!requestId || !operatorUserId) {
    return {
      ok: false,
      error: "BAD_REQUEST",
      message: "Request id is required.",
    };
  }

  const requestedRole = parseInviteRoleStrict(args.role);
  if (args.role !== undefined && args.role !== null && !requestedRole) {
    return {
      ok: false,
      error: "FORBIDDEN",
      message: "Role must be MEMBER or ADMIN.",
    };
  }
  const grantedRole = requestedRole || "MEMBER";

  const request = await prisma.workspaceAccessRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      accountId: true,
      requesterUserId: true,
      status: true,
    },
  });

  if (!request?.id) {
    return {
      ok: false,
      error: "REQUEST_NOT_FOUND",
      message: "Request not found.",
    };
  }

  const operator = await resolveWorkspaceOwnerOperator({
    accountId: request.accountId,
    operatorUserId,
  });

  if (!operator) {
    return {
      ok: false,
      error: "FORBIDDEN",
      message: "You do not have permission to review requests.",
    };
  }

  const [workspace, requesterIdentity] = await Promise.all([
    resolveWorkspaceIdentity(request.accountId),
    prisma.user.findUnique({
      where: { id: request.requesterUserId },
      select: { id: true, username: true },
    }),
  ]);
  const subjectUsername = s(requesterIdentity?.username) || null;

  if (request.status === "DENIED") {
    return {
      ok: false,
      error: "REQUEST_ALREADY_DENIED",
      message: "Request has already been denied.",
    };
  }

  if (request.status === "APPROVED") {
    const existingMembership = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId: request.accountId,
          userId: request.requesterUserId,
        },
      },
      select: { id: true, role: true },
    });

    if (!existingMembership?.id) {
      return {
        ok: false,
        error: "REQUEST_APPROVED_MEMBERSHIP_MISSING",
        message: "Request is approved but membership is missing.",
      };
    }

    if (existingMembership.role !== grantedRole) {
      await prisma.membership.update({
        where: { id: existingMembership.id },
        data: { role: grantedRole },
      });
    }

    return {
      ok: true,
      requestId,
      accountId: request.accountId,
      workspaceName: workspace.name,
      status: "APPROVED",
      membershipId: existingMembership.id,
      alreadyHandled: true,
      alreadyMember: true,
      grantedRole,
      subjectUserId: request.requesterUserId,
      subjectUsername,
    };
  }

  const { seatLimit } = await currentSeatCapacity(request.accountId);

  const result = await prisma.$transaction(async (tx) => {
    const hasCapacity = await assertSeatCapacityForMembership(tx, {
      accountId: request.accountId,
      userId: request.requesterUserId,
      seatLimit,
    });

    if (!hasCapacity) {
      return {
        kind: "PLAN_SEAT_LIMIT" as const,
      };
    }

    const membership = await tx.membership.upsert({
      where: {
        accountId_userId: {
          accountId: request.accountId,
          userId: request.requesterUserId,
        },
      },
      create: {
        accountId: request.accountId,
        userId: request.requesterUserId,
        role: grantedRole,
      },
      update: {
        role: grantedRole,
      },
      select: { id: true, role: true },
    });

    const updatedRequest = await tx.workspaceAccessRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        respondedAt: new Date(),
        respondedByUserId: operatorUserId,
      },
      select: {
        id: true,
      },
    });

    return {
      kind: "APPROVED" as const,
      requestId: updatedRequest.id,
      membershipId: membership.id,
      role: membership.role,
    };
  });

  if (result.kind === "PLAN_SEAT_LIMIT") {
    return {
      ok: false,
      error: "PLAN_SEAT_LIMIT",
      message: "Seat limit reached for this plan.",
    };
  }

  const approver = await prisma.user.findUnique({
    where: { id: operatorUserId },
    select: { username: true },
  });
  await notifyAccessRequestApproved({
    requesterUserId: request.requesterUserId,
    workspace,
    approverUsername: s(approver?.username),
    requestId,
    grantedRole,
  });

  return {
    ok: true,
    requestId,
    accountId: request.accountId,
    workspaceName: workspace.name,
    status: "APPROVED",
    membershipId: result.membershipId,
    alreadyHandled: false,
    alreadyMember: false,
    grantedRole: toSafeInviteRole(result.role),
    subjectUserId: request.requesterUserId,
    subjectUsername,
  };
}

export async function denyWorkspaceAccessRequest(args: {
  requestId: string;
  operatorUserId: string;
}): Promise<AccessRequestDecisionResult> {
  const requestId = s(args.requestId);
  const operatorUserId = s(args.operatorUserId);
  if (!requestId || !operatorUserId) {
    return {
      ok: false,
      error: "BAD_REQUEST",
      message: "Request id is required.",
    };
  }

  const request = await prisma.workspaceAccessRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      accountId: true,
      requesterUserId: true,
      status: true,
    },
  });

  if (!request?.id) {
    return {
      ok: false,
      error: "REQUEST_NOT_FOUND",
      message: "Request not found.",
    };
  }

  const operator = await resolveWorkspaceOwnerOperator({
    accountId: request.accountId,
    operatorUserId,
  });

  if (!operator) {
    return {
      ok: false,
      error: "FORBIDDEN",
      message: "You do not have permission to review requests.",
    };
  }

  const workspace = await resolveWorkspaceIdentity(request.accountId);
  const requesterIdentity = await prisma.user.findUnique({
    where: { id: request.requesterUserId },
    select: { id: true, username: true },
  });
  const subjectUsername = s(requesterIdentity?.username) || null;

  if (request.status === "APPROVED") {
    return {
      ok: false,
      error: "REQUEST_ALREADY_APPROVED",
      message: "Request has already been approved.",
    };
  }

  if (request.status === "DENIED") {
    return {
      ok: true,
      requestId,
      accountId: request.accountId,
      workspaceName: workspace.name,
      status: "DENIED",
      membershipId: null,
      alreadyHandled: true,
      alreadyMember: false,
      grantedRole: null,
      subjectUserId: request.requesterUserId,
      subjectUsername,
    };
  }

  await prisma.workspaceAccessRequest.update({
    where: { id: requestId },
    data: {
      status: "DENIED",
      respondedAt: new Date(),
      respondedByUserId: operatorUserId,
    },
  });

  return {
    ok: true,
    requestId,
    accountId: request.accountId,
    workspaceName: workspace.name,
    status: "DENIED",
    membershipId: null,
    alreadyHandled: false,
    alreadyMember: false,
    grantedRole: null,
    subjectUserId: request.requesterUserId,
    subjectUsername,
  };
}
