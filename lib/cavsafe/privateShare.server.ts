import "server-only";

import type { CavSafeAclRole, CavSafeInviteStatus, Prisma } from "@prisma/client";

import { ApiAuthError } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { CAVSAFE_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { prisma } from "@/lib/prisma";
import {
  cavsafeItemWhere,
  cavsafeRoleAtLeast,
  cavsafeRoleFromApi,
  cavsafeRoleToApi,
  requireCavSafeAccess,
  resolveCavSafeItemById,
  type CavSafeResolvedItem,
} from "@/lib/security/authorize";

type Tx = Prisma.TransactionClient;

type InviteRecipientInput = {
  userId?: unknown;
  email?: unknown;
  username?: unknown;
};

type ResolveInviteTargetResult = {
  inviteeUserId: string | null;
  inviteeEmail: string | null;
  inviteeLabel: string;
};

export type CavSafeAccessListItem = {
  aclId: string;
  principalType: "user" | "workspace";
  principalId: string;
  role: "owner" | "editor" | "viewer";
  status: "active" | "revoked";
  createdAtISO: string;
  updatedAtISO: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
    avatarTone: string | null;
  } | null;
};

export type CavSafePendingInviteListItem = {
  inviteId: string;
  role: "owner" | "editor" | "viewer";
  status: "pending" | "accepted" | "revoked" | "expired";
  inviteeUserId: string | null;
  inviteeEmail: string | null;
  inviteeLabel: string;
  expiresAtISO: string;
  createdAtISO: string;
};

export type CavSafeListItem = {
  itemId: string;
  kind: "file" | "folder";
  name: string;
  path: string;
  role: "owner" | "editor" | "viewer";
  createdAtISO: string;
  updatedAtISO: string;
  mimeType: string | null;
};

export type CavSafeInviteView = {
  inviteId: string;
  itemId: string;
  itemKind: "file" | "folder";
  role: "owner" | "editor" | "viewer";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAtISO: string;
  createdAtISO: string;
  acceptedAtISO: string | null;
  inviteeUserId: string | null;
  inviteeEmail: string | null;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeEmail(raw: unknown): string {
  return s(raw).toLowerCase();
}

function isEmailLike(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(raw);
}

function toISO(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

function mapInviteStatus(status: CavSafeInviteStatus): "pending" | "accepted" | "revoked" | "expired" {
  if (status === "ACCEPTED") return "accepted";
  if (status === "REVOKED") return "revoked";
  if (status === "EXPIRED") return "expired";
  return "pending";
}

function mapInviteRow(args: {
  invite: {
    id: string;
    role: CavSafeAclRole;
    status: CavSafeInviteStatus;
    expiresAt: Date;
    createdAt: Date;
    acceptedAt: Date | null;
    inviteeUserId: string | null;
    inviteeEmail: string | null;
    fileId: string | null;
    folderId: string | null;
  };
}): CavSafeInviteView {
  return {
    inviteId: args.invite.id,
    itemId: args.invite.fileId || args.invite.folderId || "",
    itemKind: args.invite.fileId ? "file" : "folder",
    role: cavsafeRoleToApi(args.invite.role),
    status: mapInviteStatus(args.invite.status),
    expiresAtISO: toISO(args.invite.expiresAt),
    createdAtISO: toISO(args.invite.createdAt),
    acceptedAtISO: args.invite.acceptedAt ? toISO(args.invite.acceptedAt) : null,
    inviteeUserId: args.invite.inviteeUserId,
    inviteeEmail: args.invite.inviteeEmail,
  };
}

async function resolveInviteTarget(args: {
  accountId: string;
  inviterUserId: string;
  invitee: InviteRecipientInput;
}): Promise<ResolveInviteTargetResult> {
  const accountId = s(args.accountId);
  const inviterUserId = s(args.inviterUserId);
  const userId = s(args.invitee.userId);
  const username = s(args.invitee.username).replace(/^@+/, "");
  const email = normalizeEmail(args.invitee.email);

  const providedCount = Number(Boolean(userId)) + Number(Boolean(username)) + Number(Boolean(email));
  if (providedCount !== 1) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  let inviteeUserId: string | null = null;
  let inviteeEmail: string | null = null;
  let inviteeLabel = "";

  if (userId || username) {
    const user = await prisma.user.findFirst({
      where: userId
        ? { id: userId }
        : {
            username: {
              equals: username,
              mode: "insensitive",
            },
          },
      select: {
        id: true,
        username: true,
        email: true,
      },
    });

    if (!user?.id) {
      throw new ApiAuthError("INVITEE_NOT_FOUND", 404);
    }

    inviteeUserId = user.id;
    inviteeEmail = normalizeEmail(user.email || "") || null;
    inviteeLabel = user.username ? `@${user.username}` : inviteeEmail || user.id;
  } else {
    if (!email || !isEmailLike(email)) {
      throw new ApiAuthError("BAD_REQUEST", 400);
    }

    const byEmail = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
      },
    });
    if (!byEmail?.id) {
      throw new ApiAuthError("INVITEE_NOT_FOUND", 404);
    }

    inviteeUserId = byEmail.id;
    inviteeEmail = normalizeEmail(byEmail.email || email) || email;
    inviteeLabel = byEmail.username ? `@${byEmail.username}` : inviteeEmail;
  }

  if (inviteeUserId && inviteeUserId === inviterUserId) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  if (inviteeUserId) {
    const membership = await prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId,
          userId: inviteeUserId,
        },
      },
      select: {
        id: true,
      },
    });
    if (!membership?.id) {
      throw new ApiAuthError("INVITEE_NOT_MEMBER", 403);
    }
  }

  return {
    inviteeUserId,
    inviteeEmail,
    inviteeLabel,
  };
}

function apiRoleRank(role: "owner" | "editor" | "viewer"): number {
  if (role === "owner") return 3;
  if (role === "editor") return 2;
  return 1;
}

async function ensureNotLastOwner(args: {
  tx: Tx;
  accountId: string;
  item: CavSafeResolvedItem;
  targetPrincipalId: string;
  nextRole?: CavSafeAclRole;
}) {
  const target = await args.tx.cavSafeAcl.findFirst({
    where: {
      accountId: args.accountId,
      principalType: "USER",
      principalId: args.targetPrincipalId,
      status: "ACTIVE",
      ...cavsafeItemWhere(args.item),
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (!target?.id || target.role !== "OWNER") return;
  if (args.nextRole === "OWNER") return;

  const ownerCount = await args.tx.cavSafeAcl.count({
    where: {
      accountId: args.accountId,
      status: "ACTIVE",
      role: "OWNER",
      ...cavsafeItemWhere(args.item),
    },
  });

  if (ownerCount <= 1) {
    throw new ApiAuthError("CANNOT_REMOVE_LAST_OWNER", 409);
  }
}

async function createInviteNotification(args: {
  accountId: string;
  inviteeUserId: string;
  inviteId: string;
  item: CavSafeResolvedItem;
  inviterUserId: string;
}) {
  await prisma.notification.create({
    data: {
      userId: args.inviteeUserId,
      accountId: args.accountId,
      title: "CavSafe invite",
      body: "You’ve been invited to a CavSafe item.",
      tone: "GOOD",
      kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_INVITE,
      href: `/cavsafe?inviteId=${encodeURIComponent(args.inviteId)}`,
      metaJson: {
        source: "cavsafe",
        itemId: args.item.itemId,
        itemKind: args.item.kind,
        inviteId: args.inviteId,
        inviterUserId: args.inviterUserId,
        actions: {
          open: {
            label: "Review invite",
            href: `/cavsafe?inviteId=${encodeURIComponent(args.inviteId)}`,
            method: "GET",
          },
        },
      },
    },
  });
}

async function createInviteAudit(args: {
  request: Request;
  accountId: string;
  operatorUserId: string;
  item: CavSafeResolvedItem;
  role: CavSafeAclRole;
  inviteId: string;
  inviteeLabel: string;
}) {
  await auditLogWrite({
    request: args.request,
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    action: "PROJECT_UPDATED",
    actionLabel: "CAVSAFE_INVITE_SENT",
    targetType: args.item.kind,
    targetId: args.item.itemId,
    targetLabel: args.inviteeLabel,
    metaJson: {
      source: "cavsafe_private_share",
      inviteId: args.inviteId,
      role: cavsafeRoleToApi(args.role),
      itemPath: args.item.path,
    },
  });
}

async function createAcceptAudit(args: {
  request: Request;
  accountId: string;
  operatorUserId: string;
  item: CavSafeResolvedItem;
  inviteId: string;
  role: CavSafeAclRole;
}) {
  await auditLogWrite({
    request: args.request,
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    action: "PROJECT_UPDATED",
    actionLabel: "CAVSAFE_INVITE_ACCEPTED",
    targetType: args.item.kind,
    targetId: args.item.itemId,
    targetLabel: args.item.name || args.item.path,
    metaJson: {
      source: "cavsafe_private_share",
      inviteId: args.inviteId,
      role: cavsafeRoleToApi(args.role),
      itemPath: args.item.path,
    },
  });
}

async function createRevokeAudit(args: {
  request: Request;
  accountId: string;
  operatorUserId: string;
  item: CavSafeResolvedItem;
  targetUserId: string;
  targetLabel: string;
}) {
  await auditLogWrite({
    request: args.request,
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    action: "PROJECT_UPDATED",
    actionLabel: "CAVSAFE_ACCESS_REVOKED",
    targetType: args.item.kind,
    targetId: args.item.itemId,
    targetLabel: args.targetLabel,
    metaJson: {
      source: "cavsafe_private_share",
      targetUserId: args.targetUserId,
      itemPath: args.item.path,
    },
  });
}

async function createRoleAudit(args: {
  request: Request;
  accountId: string;
  operatorUserId: string;
  item: CavSafeResolvedItem;
  targetUserId: string;
  role: CavSafeAclRole;
  targetLabel: string;
}) {
  await auditLogWrite({
    request: args.request,
    accountId: args.accountId,
    operatorUserId: args.operatorUserId,
    action: "PROJECT_UPDATED",
    actionLabel: "CAVSAFE_ROLE_CHANGED",
    targetType: args.item.kind,
    targetId: args.item.itemId,
    targetLabel: args.targetLabel,
    metaJson: {
      source: "cavsafe_private_share",
      targetUserId: args.targetUserId,
      role: cavsafeRoleToApi(args.role),
      itemPath: args.item.path,
    },
  });
}

export async function createCavSafeInvite(args: {
  request: Request;
  accountId: string;
  inviterUserId: string;
  itemId: string;
  role: unknown;
  invitee: InviteRecipientInput;
  expiresInDays?: number;
}) {
  const accountId = s(args.accountId);
  const inviterUserId = s(args.inviterUserId);
  const itemId = s(args.itemId);
  if (!accountId || !inviterUserId || !itemId) throw new ApiAuthError("BAD_REQUEST", 400);

  const role = cavsafeRoleFromApi(args.role);
  const { item } = await requireCavSafeAccess({
    accountId,
    userId: inviterUserId,
    itemId,
    minRole: "OWNER",
    onDenied: 403,
  });

  const target = await resolveInviteTarget({
    accountId,
    inviterUserId,
    invitee: args.invitee,
  });

  const expiresInDaysRaw = Number(args.expiresInDays || 7);
  const expiresInDays = Number.isFinite(expiresInDaysRaw) && expiresInDaysRaw > 0
    ? Math.min(30, Math.max(1, Math.trunc(expiresInDaysRaw)))
    : 7;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const whereTarget = target.inviteeUserId
    ? { inviteeUserId: target.inviteeUserId }
    : { inviteeEmail: target.inviteeEmail };

  const pending = await prisma.cavSafeInvite.findFirst({
    where: {
      accountId,
      status: "PENDING",
      ...cavsafeItemWhere(item),
      ...whereTarget,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      inviteeUserId: true,
      inviteeEmail: true,
      fileId: true,
      folderId: true,
    },
  });

  if (pending?.id) {
    return {
      reused: true,
      invite: mapInviteRow({ invite: pending }),
      item,
      target,
    };
  }

  const invite = await prisma.cavSafeInvite.create({
    data: {
      accountId,
      inviterUserId,
      role,
      status: "PENDING",
      expiresAt,
      inviteeUserId: target.inviteeUserId,
      inviteeEmail: target.inviteeEmail,
      ...cavsafeItemWhere(item),
    },
    select: {
      id: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      inviteeUserId: true,
      inviteeEmail: true,
      fileId: true,
      folderId: true,
    },
  });

  if (target.inviteeUserId) {
    try {
      await createInviteNotification({
        accountId,
        inviteeUserId: target.inviteeUserId,
        inviteId: invite.id,
        item,
        inviterUserId,
      });
    } catch {
      // Notification writes are best-effort.
    }
  }

  await createInviteAudit({
    request: args.request,
    accountId,
    operatorUserId: inviterUserId,
    item,
    role,
    inviteId: invite.id,
    inviteeLabel: target.inviteeLabel,
  });

  return {
    reused: false,
    invite: mapInviteRow({ invite }),
    item,
    target,
  };
}

async function resolveInviteForRecipient(args: {
  inviteId: string;
  accountId: string;
  userId: string;
  userEmail: string;
}) {
  const invite = await prisma.cavSafeInvite.findUnique({
    where: { id: args.inviteId },
    select: {
      id: true,
      accountId: true,
      fileId: true,
      folderId: true,
      role: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      inviterUserId: true,
      inviteeUserId: true,
      inviteeEmail: true,
      createdAt: true,
    },
  });

  if (!invite?.id || invite.accountId !== args.accountId) {
    throw new ApiAuthError("NOT_FOUND", 404);
  }

  const inviteEmail = normalizeEmail(invite.inviteeEmail || "");
  const allowed = invite.inviteeUserId
    ? invite.inviteeUserId === args.userId
    : Boolean(inviteEmail && args.userEmail && inviteEmail === args.userEmail);
  if (!allowed) {
    throw new ApiAuthError("FORBIDDEN", 403);
  }

  return invite;
}

export async function acceptCavSafeInvite(args: {
  request: Request;
  accountId: string;
  userId: string;
  userEmail: string;
  inviteId: string;
}) {
  const inviteId = s(args.inviteId);
  if (!inviteId) throw new ApiAuthError("BAD_REQUEST", 400);

  const invite = await resolveInviteForRecipient({
    inviteId,
    accountId: s(args.accountId),
    userId: s(args.userId),
    userEmail: normalizeEmail(args.userEmail),
  });

  const status = invite.status;

  if (status === "ACCEPTED") {
    const itemId = invite.fileId || invite.folderId;
    const item = itemId
      ? await resolveCavSafeItemById({
          accountId: invite.accountId,
          itemId,
        })
      : null;
    if (!item) throw new ApiAuthError("NOT_FOUND", 404);

    return {
      alreadyHandled: true,
      item,
      role: invite.role,
      invite: mapInviteRow({ invite: { ...invite, acceptedAt: invite.acceptedAt || new Date() } }),
    };
  }

  if (status === "REVOKED" || status === "EXPIRED") {
    throw new ApiAuthError("INVITE_NOT_ACTIVE", 409);
  }

  if (invite.status !== "PENDING") {
    throw new ApiAuthError("INVITE_NOT_ACTIVE", 409);
  }

  if (invite.expiresAt.getTime() <= Date.now()) {
    await prisma.cavSafeInvite.updateMany({
      where: {
        id: invite.id,
        status: "PENDING",
      },
      data: {
        status: "EXPIRED",
      },
    });
    throw new ApiAuthError("INVITE_EXPIRED", 409);
  }

  const itemId = invite.fileId || invite.folderId;
  if (!itemId) throw new ApiAuthError("NOT_FOUND", 404);

  const item = await resolveCavSafeItemById({
    accountId: invite.accountId,
    itemId,
  });
  if (!item) throw new ApiAuthError("NOT_FOUND", 404);

  const acceptedAt = new Date();

  await prisma.$transaction(async (tx) => {
    const existingAcl = await tx.cavSafeAcl.findFirst({
      where: {
        accountId: invite.accountId,
        principalType: "USER",
        principalId: args.userId,
        ...cavsafeItemWhere(item),
      },
      select: {
        id: true,
      },
    });

    if (existingAcl?.id) {
      await tx.cavSafeAcl.update({
        where: {
          id: existingAcl.id,
        },
        data: {
          role: invite.role,
          status: "ACTIVE",
          revokedAt: null,
          revokedByUserId: null,
          createdByUserId: invite.inviterUserId,
        },
      });
    } else {
      await tx.cavSafeAcl.create({
        data: {
          accountId: invite.accountId,
          principalType: "USER",
          principalId: args.userId,
          role: invite.role,
          status: "ACTIVE",
          createdByUserId: invite.inviterUserId,
          ...cavsafeItemWhere(item),
        },
      });
    }

    const updatedCount = await tx.cavSafeInvite.updateMany({
      where: {
        id: invite.id,
        status: "PENDING",
      },
      data: {
        status: "ACCEPTED",
        acceptedAt,
        inviteeUserId: args.userId,
      },
    });

    if (updatedCount.count === 0) {
      throw new ApiAuthError("INVITE_NOT_ACTIVE", 409);
    }
  });

  await createAcceptAudit({
    request: args.request,
    accountId: invite.accountId,
    operatorUserId: args.userId,
    item,
    inviteId: invite.id,
    role: invite.role,
  });

  try {
    await prisma.notification.create({
      data: {
        userId: invite.inviterUserId,
        accountId: invite.accountId,
        title: "CavSafe invite accepted",
        body: "A recipient accepted your CavSafe invite.",
        tone: "GOOD",
        kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_INVITE_ACCEPTED,
        href: `/cavsafe?itemId=${encodeURIComponent(item.itemId)}`,
        metaJson: {
          source: "cavsafe",
          inviteId: invite.id,
          itemId: item.itemId,
          itemKind: item.kind,
          acceptedByUserId: args.userId,
        },
      },
    });
  } catch {
    // Non-blocking.
  }

  return {
    alreadyHandled: false,
    item,
    role: invite.role,
    invite: {
      inviteId: invite.id,
      itemId: item.itemId,
      itemKind: item.kind,
      role: cavsafeRoleToApi(invite.role),
      status: "accepted" as const,
      expiresAtISO: toISO(invite.expiresAt),
      createdAtISO: toISO(invite.createdAt),
      acceptedAtISO: toISO(acceptedAt),
      inviteeUserId: args.userId,
      inviteeEmail: invite.inviteeEmail,
    },
  };
}

export async function revokeCavSafeAccess(args: {
  request: Request;
  accountId: string;
  actorUserId: string;
  itemId: string;
  targetUserId: string;
}) {
  const accountId = s(args.accountId);
  const actorUserId = s(args.actorUserId);
  const itemId = s(args.itemId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !actorUserId || !itemId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  const { item } = await requireCavSafeAccess({
    accountId,
    userId: actorUserId,
    itemId,
    minRole: "OWNER",
    onDenied: 403,
  });

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      username: true,
      email: true,
    },
  });
  const targetLabel = targetUser?.username
    ? `@${targetUser.username}`
    : normalizeEmail(targetUser?.email || "") || targetUserId;

  await prisma.$transaction(async (tx) => {
    await ensureNotLastOwner({
      tx,
      accountId,
      item,
      targetPrincipalId: targetUserId,
    });

    await tx.cavSafeAcl.updateMany({
      where: {
        accountId,
        principalType: "USER",
        principalId: targetUserId,
        status: "ACTIVE",
        ...cavsafeItemWhere(item),
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: actorUserId,
      },
    });

    await tx.cavSafeInvite.updateMany({
      where: {
        accountId,
        status: "PENDING",
        ...cavsafeItemWhere(item),
        OR: [
          { inviteeUserId: targetUserId },
          targetUser?.email ? { inviteeEmail: normalizeEmail(targetUser.email) } : undefined,
        ].filter(Boolean) as Prisma.CavSafeInviteWhereInput[],
      },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
      },
    });
  });

  await createRevokeAudit({
    request: args.request,
    accountId,
    operatorUserId: actorUserId,
    item,
    targetUserId,
    targetLabel,
  });

  if (targetUser?.id) {
    try {
      await prisma.notification.create({
        data: {
          userId: targetUser.id,
          accountId,
          title: "CavSafe access revoked",
          body: "Your access to a CavSafe item was revoked.",
          tone: "WATCH",
          kind: CAVSAFE_NOTIFICATION_KINDS.SAFE_ACCESS_REVOKED,
          href: "/cavsafe",
          metaJson: {
            source: "cavsafe",
            itemId: item.itemId,
            itemKind: item.kind,
            revokedByUserId: actorUserId,
          },
        },
      });
    } catch {
      // Best-effort notification.
    }
  }

  return {
    ok: true as const,
    item,
  };
}

export async function changeCavSafeRole(args: {
  request: Request;
  accountId: string;
  actorUserId: string;
  itemId: string;
  targetUserId: string;
  role: unknown;
}) {
  const accountId = s(args.accountId);
  const actorUserId = s(args.actorUserId);
  const itemId = s(args.itemId);
  const targetUserId = s(args.targetUserId);
  const role = cavsafeRoleFromApi(args.role);
  if (!accountId || !actorUserId || !itemId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  const { item } = await requireCavSafeAccess({
    accountId,
    userId: actorUserId,
    itemId,
    minRole: "OWNER",
    onDenied: 403,
  });

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      username: true,
      email: true,
    },
  });

  const targetLabel = targetUser?.username
    ? `@${targetUser.username}`
    : normalizeEmail(targetUser?.email || "") || targetUserId;

  await prisma.$transaction(async (tx) => {
    await ensureNotLastOwner({
      tx,
      accountId,
      item,
      targetPrincipalId: targetUserId,
      nextRole: role,
    });

    const existing = await tx.cavSafeAcl.findFirst({
      where: {
        accountId,
        principalType: "USER",
        principalId: targetUserId,
        status: "ACTIVE",
        ...cavsafeItemWhere(item),
      },
      select: {
        id: true,
      },
    });

    if (!existing?.id) {
      throw new ApiAuthError("NOT_FOUND", 404);
    }

    await tx.cavSafeAcl.update({
      where: {
        id: existing.id,
      },
      data: {
        role,
        status: "ACTIVE",
        revokedAt: null,
        revokedByUserId: null,
      },
    });
  });

  await createRoleAudit({
    request: args.request,
    accountId,
    operatorUserId: actorUserId,
    item,
    targetUserId,
    role,
    targetLabel,
  });

  return {
    ok: true as const,
    item,
    role: cavsafeRoleToApi(role),
  };
}

export async function listCavSafeItems(args: {
  accountId: string;
  userId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  if (!accountId || !userId) throw new ApiAuthError("BAD_REQUEST", 400);

  const [rows, membership] = await Promise.all([
    prisma.cavSafeAcl.findMany({
      where: {
        accountId,
        status: "ACTIVE",
        AND: [
          {
            OR: [
              {
                principalType: "USER",
                principalId: userId,
              },
              {
                principalType: "WORKSPACE",
                principalId: accountId,
              },
            ],
          },
          {
            OR: [
              { fileId: { not: null } },
              { folderId: { not: null } },
            ],
          },
        ],
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        role: true,
        createdAt: true,
        updatedAt: true,
        file: {
          select: {
            id: true,
            name: true,
            path: true,
            mimeType: true,
            updatedAt: true,
            createdAt: true,
            deletedAt: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
            updatedAt: true,
            createdAt: true,
            deletedAt: true,
          },
        },
      },
    }),
    prisma.membership.findUnique({
      where: {
        accountId_userId: {
          accountId,
          userId,
        },
      },
      select: {
        role: true,
      },
    }),
  ]);

  const isWorkspaceOwner = membership?.role === "OWNER";
  const byItemId = new Map<string, CavSafeListItem>();

  for (const row of rows) {
    const role = cavsafeRoleToApi(row.role);

    if (row.file?.id && !row.file.deletedAt) {
      const item: CavSafeListItem = {
        itemId: row.file.id,
        kind: "file",
        name: s(row.file.name),
        path: s(row.file.path),
        role,
        createdAtISO: toISO(row.file.createdAt),
        updatedAtISO: toISO(row.file.updatedAt),
        mimeType: s(row.file.mimeType) || null,
      };
      const existing = byItemId.get(item.itemId);
      if (!existing || apiRoleRank(item.role) > apiRoleRank(existing.role)) {
        byItemId.set(item.itemId, item);
      }
      continue;
    }

    if (row.folder?.id && !row.folder.deletedAt) {
      const item: CavSafeListItem = {
        itemId: row.folder.id,
        kind: "folder",
        name: s(row.folder.name),
        path: s(row.folder.path),
        role,
        createdAtISO: toISO(row.folder.createdAt),
        updatedAtISO: toISO(row.folder.updatedAt),
        mimeType: null,
      };
      const existing = byItemId.get(item.itemId);
      if (!existing || apiRoleRank(item.role) > apiRoleRank(existing.role)) {
        byItemId.set(item.itemId, item);
      }
    }
  }

  if (isWorkspaceOwner) {
    const [ownedFiles, ownedFolders] = await Promise.all([
      prisma.cavSafeFile.findMany({
        where: {
          accountId,
          deletedAt: null,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          name: true,
          path: true,
          mimeType: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.cavSafeFolder.findMany({
        where: {
          accountId,
          deletedAt: null,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          name: true,
          path: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    for (const row of ownedFiles) {
      if (byItemId.has(row.id)) continue;
      byItemId.set(row.id, {
        itemId: row.id,
        kind: "file",
        name: s(row.name),
        path: s(row.path),
        role: "owner",
        createdAtISO: toISO(row.createdAt),
        updatedAtISO: toISO(row.updatedAt),
        mimeType: s(row.mimeType) || null,
      });
    }
    for (const row of ownedFolders) {
      if (byItemId.has(row.id)) continue;
      byItemId.set(row.id, {
        itemId: row.id,
        kind: "folder",
        name: s(row.name),
        path: s(row.path),
        role: "owner",
        createdAtISO: toISO(row.createdAt),
        updatedAtISO: toISO(row.updatedAt),
        mimeType: null,
      });
    }
  }

  const mergedItems = Array.from(byItemId.values()).sort((a, b) => {
    const byUpdated = Date.parse(b.updatedAtISO) - Date.parse(a.updatedAtISO);
    if (Number.isFinite(byUpdated) && byUpdated !== 0) return byUpdated;
    return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  });

  const ownedItems: CavSafeListItem[] = [];
  const sharedWithMeItems: CavSafeListItem[] = [];
  for (const item of mergedItems) {
    if (item.role === "owner") ownedItems.push(item);
    else sharedWithMeItems.push(item);
  }

  return {
    ownedItems,
    sharedWithMeItems,
  };
}

export async function listItemAccessAndPending(args: {
  accountId: string;
  userId: string;
  itemId: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const itemId = s(args.itemId);
  if (!accountId || !userId || !itemId) throw new ApiAuthError("BAD_REQUEST", 400);

  const access = await requireCavSafeAccess({
    accountId,
    userId,
    itemId,
    minRole: "VIEWER",
    onDenied: 404,
  });

  const [accessRows, pendingRows] = await Promise.all([
    prisma.cavSafeAcl.findMany({
      where: {
        accountId,
        status: "ACTIVE",
        principalType: "USER",
        ...cavsafeItemWhere(access.item),
      },
      orderBy: [
        { role: "desc" },
        { updatedAt: "desc" },
      ],
      select: {
        id: true,
        principalType: true,
        principalId: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.cavSafeInvite.findMany({
      where: {
        accountId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
        ...cavsafeItemWhere(access.item),
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        role: true,
        status: true,
        inviteeUserId: true,
        inviteeEmail: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  const userIds = Array.from(
    new Set(
      [
        ...accessRows.map((row) => row.principalId),
        ...pendingRows.map((row) => row.inviteeUserId || ""),
      ].filter(Boolean),
    ),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatarImage: true,
          avatarTone: true,
        },
      })
    : [];

  const userById = new Map(users.map((row) => [row.id, row]));

  const peopleWithAccess: CavSafeAccessListItem[] = accessRows.map((row) => {
    const user = userById.get(row.principalId);
    return {
      aclId: row.id,
      principalType: row.principalType === "WORKSPACE" ? "workspace" : "user",
      principalId: row.principalId,
      role: cavsafeRoleToApi(row.role),
      status: row.status === "REVOKED" ? "revoked" : "active",
      createdAtISO: toISO(row.createdAt),
      updatedAtISO: toISO(row.updatedAt),
      user: user
        ? {
            id: user.id,
            username: s(user.username) || null,
            displayName: user.displayName || null,
            email: s(user.email) || null,
            avatarUrl: s(user.avatarImage) || null,
            avatarTone: s(user.avatarTone) || null,
          }
        : null,
    };
  });

  const pending: CavSafePendingInviteListItem[] = pendingRows.map((row) => {
    const user = row.inviteeUserId ? userById.get(row.inviteeUserId) : null;
    const label = user?.username
      ? `@${user.username}`
      : s(row.inviteeEmail) || row.inviteeUserId || "Recipient";

    return {
      inviteId: row.id,
      role: cavsafeRoleToApi(row.role),
      status: mapInviteStatus(row.status),
      inviteeUserId: row.inviteeUserId,
      inviteeEmail: s(row.inviteeEmail) || null,
      inviteeLabel: label,
      expiresAtISO: toISO(row.expiresAt),
      createdAtISO: toISO(row.createdAt),
    };
  });

  return {
    item: access.item,
    role: cavsafeRoleToApi(access.role),
    canManage: cavsafeRoleAtLeast(access.role, "OWNER"),
    peopleWithAccess,
    pending,
  };
}

export async function listPendingInvitesForUser(args: {
  accountId: string;
  userId: string;
  userEmail: string;
}) {
  const accountId = s(args.accountId);
  const userId = s(args.userId);
  const userEmail = normalizeEmail(args.userEmail);
  if (!accountId || !userId) throw new ApiAuthError("BAD_REQUEST", 400);

  const invites = await prisma.cavSafeInvite.findMany({
    where: {
      accountId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      OR: [
        { inviteeUserId: userId },
        userEmail ? { inviteeEmail: userEmail } : undefined,
      ].filter(Boolean) as Prisma.CavSafeInviteWhereInput[],
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      role: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      acceptedAt: true,
      inviteeUserId: true,
      inviteeEmail: true,
      fileId: true,
      folderId: true,
    },
  });

  return invites.map((invite) => mapInviteRow({ invite }));
}
