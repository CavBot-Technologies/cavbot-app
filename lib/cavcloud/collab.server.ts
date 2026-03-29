import "server-only";

import crypto from "crypto";

import type {
  CavCodeProjectAccessRole,
  CavCloudAccessPermission,
  CavCloudFolderAccessRole,
  CavCollabRequestStatus,
  Prisma,
} from "@prisma/client";

import { ApiAuthError } from "@/lib/apiAuth";
import { CAVCLOUD_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { getPlanLimits, resolvePlanIdFromTier } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { notifyCavCloudCollabSignal } from "@/lib/cavcloud/notifications.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import {
  getCavCloudOperatorContext,
  getEffectivePermission,
  isRoleAllowedToManageCollaboration,
  type CavCollabResourceType,
  type CavCloudOperatorContext,
} from "@/lib/cavcloud/permissions.server";

const CONTRIBUTOR_EXPIRY_DAYS = new Set([1, 7, 30]);
const CONTRIBUTOR_CREATE_LIMIT = { max: 20, windowMs: 60_000 };
const CONTRIBUTOR_RESOLVE_LIMIT = { max: 60, windowMs: 60_000 };
const REQUEST_CREATE_LIMIT = { max: 20, windowMs: 60_000 };

type DbClient = Prisma.TransactionClient | typeof prisma;

type LocalRateBucket = {
  windowStartMs: number;
  used: number;
};

const localRateBuckets = new Map<string, LocalRateBucket>();

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function parseOptionalExpiry(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  if (!Number.isFinite(d.getTime())) throw new ApiAuthError("BAD_REQUEST", 400);
  return d;
}

function nowPlusDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateContributorToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function enforceLocalRateLimit(key: string, config: { max: number; windowMs: number }) {
  const now = Date.now();
  const bucket = localRateBuckets.get(key);

  if (!bucket || now - bucket.windowStartMs >= config.windowMs) {
    localRateBuckets.set(key, {
      windowStartMs: now,
      used: 1,
    });
    return;
  }

  if (bucket.used >= config.max) {
    throw new ApiAuthError("RATE_LIMITED", 429);
  }

  bucket.used += 1;
  localRateBuckets.set(key, bucket);
}

async function listOwnerUserIds(accountId: string, tx: DbClient = prisma): Promise<string[]> {
  const owners = await tx.membership.findMany({
    where: {
      accountId,
      role: "OWNER",
    },
    select: {
      userId: true,
    },
  });
  return owners.map((row) => row.userId).filter(Boolean);
}

async function notifyOwners(args: {
  accountId: string;
  title: string;
  body: string;
  kind: string;
  href?: string;
  meta?: Prisma.JsonObject | null;
}) {
  const ownerUserIds = await listOwnerUserIds(args.accountId);
  for (const ownerUserId of ownerUserIds) {
    await notifyCavCloudCollabSignal({
      accountId: args.accountId,
      userId: ownerUserId,
      title: args.title,
      body: args.body,
      kind: args.kind,
      href: args.href,
      tone: "WATCH",
      meta: args.meta || null,
      dedupeHours: 1,
    });
  }
}

async function resolveResourceAccount(args: {
  resourceType: CavCollabResourceType;
  resourceId: string;
}, tx: DbClient = prisma): Promise<string | null> {
  const resourceId = s(args.resourceId);
  if (!resourceId) return null;

  if (args.resourceType === "FILE") {
    const file = await tx.cavCloudFile.findFirst({
      where: {
        id: resourceId,
        deletedAt: null,
      },
      select: { accountId: true },
    });
    return file?.accountId || null;
  }

  if (args.resourceType === "FOLDER") {
    const folder = await tx.cavCloudFolder.findFirst({
      where: {
        id: resourceId,
        deletedAt: null,
      },
      select: { accountId: true },
    });
    return folder?.accountId || null;
  }

  if (args.resourceType === "PROJECT") {
    const projectId = Number(resourceId);
    if (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0) return null;
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        isActive: true,
      },
      select: { accountId: true },
    });
    return project?.accountId || null;
  }

  return null;
}

async function ensureMemberSeatCapacity(args: {
  tx: DbClient;
  accountId: string;
  userId: string;
}) {
  const existing = await args.tx.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.userId,
      },
    },
    select: {
      id: true,
    },
  });
  if (existing?.id) return;

  const account = await args.tx.account.findUnique({
    where: {
      id: args.accountId,
    },
    select: {
      tier: true,
    },
  });

  const planId = resolvePlanIdFromTier(account?.tier || "FREE");
  const seatLimit = Number(getPlanLimits(planId)?.seats ?? 0);
  if (seatLimit > 0) {
    const [membersCount, pendingInvitesCount] = await Promise.all([
      args.tx.membership.count({ where: { accountId: args.accountId } }),
      args.tx.invite.count({
        where: {
          accountId: args.accountId,
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

    if (membersCount + pendingInvitesCount >= seatLimit) {
      throw new ApiAuthError("PLAN_SEAT_LIMIT", 403);
    }
  }

  await args.tx.membership.create({
    data: {
      accountId: args.accountId,
      userId: args.userId,
      role: "MEMBER",
    },
  });
}

function parseFilePermission(raw: unknown): CavCloudAccessPermission {
  const value = s(raw).toUpperCase();
  if (value === "EDIT") return "EDIT";
  if (value === "VIEW") return "VIEW";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

function parseFolderRole(raw: unknown): CavCloudFolderAccessRole {
  const value = s(raw).toUpperCase();
  if (value === "EDITOR") return "EDITOR";
  if (value === "VIEWER") return "VIEWER";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

function parseProjectRole(raw: unknown): CavCodeProjectAccessRole {
  const value = s(raw).toUpperCase();
  if (value === "VIEWER") return "VIEWER";
  if (value === "EDITOR") return "EDITOR";
  if (value === "ADMIN") return "ADMIN";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

async function assertManageCollabAllowed(accountId: string, operatorUserId: string): Promise<CavCloudOperatorContext> {
  const operator = await getCavCloudOperatorContext({ accountId, userId: operatorUserId });
  if (!isRoleAllowedToManageCollaboration(operator.role, operator.policy)) {
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }
  return operator;
}

async function assertTargetUserIsMember(args: {
  accountId: string;
  targetUserId: string;
}): Promise<void> {
  const member = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: args.accountId,
        userId: args.targetUserId,
      },
    },
    select: {
      id: true,
    },
  });
  if (!member?.id) throw new ApiAuthError("UNAUTHORIZED", 403);
}

function parseRequestStatus(raw: unknown): CavCollabRequestStatus | null {
  const normalized = s(raw).toUpperCase();
  if (!normalized) return null;
  if (normalized === "PENDING") return "PENDING";
  if (normalized === "APPROVED") return "APPROVED";
  if (normalized === "DENIED") return "DENIED";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

async function ensureFileInAccount(accountId: string, fileId: string) {
  const file = await prisma.cavCloudFile.findFirst({
    where: {
      id: fileId,
      accountId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!file?.id) throw new ApiAuthError("NOT_FOUND", 404);
}

async function ensureFolderInAccount(accountId: string, folderId: string) {
  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      id: folderId,
      accountId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!folder?.id) throw new ApiAuthError("NOT_FOUND", 404);
}

async function ensureProjectInAccount(accountId: string, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      accountId,
      isActive: true,
    },
    select: {
      id: true,
    },
  });
  if (!project?.id) throw new ApiAuthError("NOT_FOUND", 404);
}

export async function listFileCollaborators(args: {
  accountId: string;
  operatorUserId: string;
  fileId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const fileId = s(args.fileId);
  if (!accountId || !operatorUserId || !fileId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFileInAccount(accountId, fileId);

  const grants = await prisma.cavCloudFileAccess.findMany({
    where: {
      accountId,
      fileId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      userId: true,
      permission: true,
      expiresAt: true,
      grantedByUserId: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          email: true,
          displayName: true,
        },
      },
    },
  });

  return grants.map((grant) => ({
    userId: grant.userId,
    email: s(grant.user?.email),
    displayName: grant.user?.displayName || null,
    permission: grant.permission,
    expiresAtISO: grant.expiresAt ? toIso(grant.expiresAt) : null,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
    updatedAtISO: toIso(grant.updatedAt),
  }));
}

export async function upsertFileCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  fileId: string;
  targetUserId: string;
  permission: unknown;
  expiresAt?: unknown;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const fileId = s(args.fileId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !fileId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFileInAccount(accountId, fileId);
  await assertTargetUserIsMember({ accountId, targetUserId });

  const permission = parseFilePermission(args.permission);
  const expiresAt = parseOptionalExpiry(args.expiresAt);

  const grant = await prisma.cavCloudFileAccess.upsert({
    where: {
      accountId_fileId_userId: {
        accountId,
        fileId,
        userId: targetUserId,
      },
    },
    create: {
      accountId,
      fileId,
      userId: targetUserId,
      permission,
      expiresAt,
      grantedByUserId: operatorUserId,
    },
    update: {
      permission,
      expiresAt,
      grantedByUserId: operatorUserId,
    },
    select: {
      userId: true,
      permission: true,
      expiresAt: true,
      grantedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_GRANTED",
    subjectType: "file",
    subjectId: fileId,
    label: "File collaborator granted",
    meta: {
      userId: targetUserId,
      permission,
      expiresAt: grant.expiresAt ? toIso(grant.expiresAt) : null,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_GRANTED,
    title: "CavCloud access granted",
    body: "You were granted collaborator access.",
    href: "/cavcloud",
    tone: "GOOD",
    dedupeHours: 1,
  });

  return {
    userId: grant.userId,
    permission: grant.permission,
    expiresAtISO: grant.expiresAt ? toIso(grant.expiresAt) : null,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
    updatedAtISO: toIso(grant.updatedAt),
  };
}

export async function revokeFileCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  fileId: string;
  targetUserId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const fileId = s(args.fileId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !fileId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFileInAccount(accountId, fileId);

  await prisma.cavCloudFileAccess.deleteMany({
    where: {
      accountId,
      fileId,
      userId: targetUserId,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REVOKED",
    subjectType: "file",
    subjectId: fileId,
    label: "File collaborator revoked",
    meta: {
      userId: targetUserId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_REVOKED,
    title: "CavCloud access revoked",
    body: "Your collaborator access was revoked.",
    href: "/cavcloud",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return { ok: true as const };
}

export async function listFolderCollaborators(args: {
  accountId: string;
  operatorUserId: string;
  folderId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const folderId = s(args.folderId);
  if (!accountId || !operatorUserId || !folderId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFolderInAccount(accountId, folderId);

  const grants = await prisma.cavCloudFolderAccess.findMany({
    where: {
      accountId,
      folderId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      userId: true,
      role: true,
      expiresAt: true,
      grantedByUserId: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          email: true,
          displayName: true,
        },
      },
    },
  });

  return grants.map((grant) => ({
    userId: grant.userId,
    email: s(grant.user?.email),
    displayName: grant.user?.displayName || null,
    role: grant.role,
    expiresAtISO: grant.expiresAt ? toIso(grant.expiresAt) : null,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
    updatedAtISO: toIso(grant.updatedAt),
  }));
}

export async function upsertFolderCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  folderId: string;
  targetUserId: string;
  role: unknown;
  expiresAt?: unknown;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const folderId = s(args.folderId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !folderId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFolderInAccount(accountId, folderId);
  await assertTargetUserIsMember({ accountId, targetUserId });

  const role = parseFolderRole(args.role);
  const expiresAt = parseOptionalExpiry(args.expiresAt);

  const grant = await prisma.cavCloudFolderAccess.upsert({
    where: {
      accountId_folderId_userId: {
        accountId,
        folderId,
        userId: targetUserId,
      },
    },
    create: {
      accountId,
      folderId,
      userId: targetUserId,
      role,
      expiresAt,
      grantedByUserId: operatorUserId,
    },
    update: {
      role,
      expiresAt,
      grantedByUserId: operatorUserId,
    },
    select: {
      userId: true,
      role: true,
      expiresAt: true,
      grantedByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_GRANTED",
    subjectType: "folder",
    subjectId: folderId,
    label: "Folder collaborator granted",
    meta: {
      userId: targetUserId,
      role,
      expiresAt: grant.expiresAt ? toIso(grant.expiresAt) : null,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_GRANTED,
    title: "CavCloud access granted",
    body: "You were granted collaborator access.",
    href: "/cavcloud",
    tone: "GOOD",
    dedupeHours: 1,
  });

  return {
    userId: grant.userId,
    role: grant.role,
    expiresAtISO: grant.expiresAt ? toIso(grant.expiresAt) : null,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
    updatedAtISO: toIso(grant.updatedAt),
  };
}

export async function revokeFolderCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  folderId: string;
  targetUserId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const folderId = s(args.folderId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !folderId || !targetUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureFolderInAccount(accountId, folderId);

  await prisma.cavCloudFolderAccess.deleteMany({
    where: {
      accountId,
      folderId,
      userId: targetUserId,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REVOKED",
    subjectType: "folder",
    subjectId: folderId,
    label: "Folder collaborator revoked",
    meta: {
      userId: targetUserId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_REVOKED,
    title: "CavCloud access revoked",
    body: "Your collaborator access was revoked.",
    href: "/cavcloud",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return { ok: true as const };
}

export async function listProjectCollaborators(args: {
  accountId: string;
  operatorUserId: string;
  projectId: number;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const projectId = Number(args.projectId);
  if (!accountId || !operatorUserId || !Number.isInteger(projectId) || projectId <= 0) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureProjectInAccount(accountId, projectId);

  const grants = await prisma.cavCodeProjectAccess.findMany({
    where: {
      accountId,
      projectId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      userId: true,
      role: true,
      grantedByUserId: true,
      createdAt: true,
      user: {
        select: {
          email: true,
          displayName: true,
        },
      },
    },
  });

  return grants.map((grant) => ({
    userId: grant.userId,
    email: s(grant.user?.email),
    displayName: grant.user?.displayName || null,
    role: grant.role,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
  }));
}

export async function upsertProjectCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  projectId: number;
  targetUserId: string;
  role: unknown;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const projectId = Number(args.projectId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !Number.isInteger(projectId) || projectId <= 0 || !targetUserId) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureProjectInAccount(accountId, projectId);
  await assertTargetUserIsMember({ accountId, targetUserId });

  const role = parseProjectRole(args.role);

  const grant = await prisma.cavCodeProjectAccess.upsert({
    where: {
      accountId_projectId_userId: {
        accountId,
        projectId,
        userId: targetUserId,
      },
    },
    create: {
      accountId,
      projectId,
      userId: targetUserId,
      role,
      grantedByUserId: operatorUserId,
    },
    update: {
      role,
      grantedByUserId: operatorUserId,
    },
    select: {
      userId: true,
      role: true,
      grantedByUserId: true,
      createdAt: true,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_GRANTED",
    subjectType: "project",
    subjectId: String(projectId),
    label: "Project collaborator granted",
    meta: {
      userId: targetUserId,
      role,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_GRANTED,
    title: "CavCode access granted",
    body: "You were granted project collaborator access.",
    href: "/cavcode",
    tone: "GOOD",
    dedupeHours: 1,
  });

  return {
    userId: grant.userId,
    role: grant.role,
    grantedByUserId: grant.grantedByUserId,
    createdAtISO: toIso(grant.createdAt),
  };
}

export async function revokeProjectCollaborator(args: {
  accountId: string;
  operatorUserId: string;
  projectId: number;
  targetUserId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const projectId = Number(args.projectId);
  const targetUserId = s(args.targetUserId);
  if (!accountId || !operatorUserId || !Number.isInteger(projectId) || projectId <= 0 || !targetUserId) {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  await assertManageCollabAllowed(accountId, operatorUserId);
  await ensureProjectInAccount(accountId, projectId);

  await prisma.cavCodeProjectAccess.deleteMany({
    where: {
      accountId,
      projectId,
      userId: targetUserId,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REVOKED",
    subjectType: "project",
    subjectId: String(projectId),
    label: "Project collaborator revoked",
    meta: {
      userId: targetUserId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: targetUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_REVOKED,
    title: "CavCode access revoked",
    body: "Your project collaborator access was revoked.",
    href: "/cavcode",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return { ok: true as const };
}

export async function createCollabAccessRequest(args: {
  requesterUserId: string;
  resourceType: unknown;
  resourceId: unknown;
  requestedPermission?: unknown;
  message?: unknown;
}) {
  const requesterUserId = s(args.requesterUserId);
  const resourceType = s(args.resourceType).toUpperCase() as CavCollabResourceType;
  const resourceId = s(args.resourceId);
  const message = s(args.message) || null;

  if (!requesterUserId || !resourceId) throw new ApiAuthError("BAD_REQUEST", 400);
  if (resourceType !== "FILE" && resourceType !== "FOLDER" && resourceType !== "PROJECT") {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  enforceLocalRateLimit(`request:${requesterUserId}`, REQUEST_CREATE_LIMIT);

  const accountId = await resolveResourceAccount({
    resourceType,
    resourceId,
  });
  if (!accountId) throw new ApiAuthError("NOT_FOUND", 404);

  const existing = await prisma.cavCollabAccessRequest.findFirst({
    where: {
      accountId,
      requesterUserId,
      resourceType,
      resourceId,
      status: "PENDING",
    },
    select: {
      id: true,
      createdAt: true,
    },
  });
  if (existing?.id) {
    return {
      id: existing.id,
      status: "PENDING" as const,
      createdAtISO: toIso(existing.createdAt),
      deduped: true,
    };
  }

  const request = await prisma.cavCollabAccessRequest.create({
    data: {
      accountId,
      requesterUserId,
      resourceType,
      resourceId,
      requestedPermission: "EDIT",
      status: "PENDING",
      message,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId: requesterUserId,
    kind: "COLLAB_REQUEST_CREATED",
    subjectType: "collab_request",
    subjectId: request.id,
    label: "Collaboration request created",
    meta: {
      resourceType,
      resourceId,
    },
  });

  await notifyOwners({
    accountId,
    title: "Collaboration request",
    body: "A user requested collaborator access.",
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_REQUEST_CREATED,
    href: "/cavcloud",
    meta: {
      requestId: request.id,
      resourceType,
    },
  });

  return {
    id: request.id,
    status: "PENDING" as const,
    createdAtISO: toIso(request.createdAt),
    deduped: false,
  };
}

export async function listCollabAccessRequests(args: {
  accountId: string;
  operatorUserId: string;
  status?: unknown;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const status = parseRequestStatus(args.status);
  if (!accountId || !operatorUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  const operator = await getCavCloudOperatorContext({ accountId, userId: operatorUserId });
  if (operator.role !== "OWNER") throw new ApiAuthError("UNAUTHORIZED", 403);

  const requests = await prisma.cavCollabAccessRequest.findMany({
    where: {
      accountId,
      ...(status ? { status } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      requesterUserId: true,
      resourceType: true,
      resourceId: true,
      requestedPermission: true,
      status: true,
      message: true,
      createdAt: true,
      resolvedAt: true,
      resolvedByUserId: true,
      requesterUser: {
        select: {
          email: true,
          displayName: true,
        },
      },
    },
  });

  return requests.map((request) => ({
    id: request.id,
    requesterUserId: request.requesterUserId,
    requesterEmail: s(request.requesterUser?.email),
    requesterDisplayName: request.requesterUser?.displayName || null,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    requestedPermission: request.requestedPermission,
    status: request.status,
    message: request.message || null,
    createdAtISO: toIso(request.createdAt),
    resolvedAtISO: request.resolvedAt ? toIso(request.resolvedAt) : null,
    resolvedByUserId: request.resolvedByUserId || null,
  }));
}

export async function approveCollabAccessRequest(args: {
  accountId: string;
  operatorUserId: string;
  requestId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const requestId = s(args.requestId);
  if (!accountId || !operatorUserId || !requestId) throw new ApiAuthError("BAD_REQUEST", 400);

  const operator = await getCavCloudOperatorContext({ accountId, userId: operatorUserId });
  if (operator.role !== "OWNER") throw new ApiAuthError("UNAUTHORIZED", 403);

  const approved = await prisma.$transaction(async (tx) => {
    const request = await tx.cavCollabAccessRequest.findFirst({
      where: {
        id: requestId,
        accountId,
      },
      select: {
        id: true,
        requesterUserId: true,
        resourceType: true,
        resourceId: true,
        status: true,
      },
    });

    if (!request?.id) throw new ApiAuthError("NOT_FOUND", 404);
    if (request.status !== "PENDING") throw new ApiAuthError("BAD_REQUEST", 400);

    await ensureMemberSeatCapacity({
      tx,
      accountId,
      userId: request.requesterUserId,
    });

    if (request.resourceType === "FILE") {
      await tx.cavCloudFileAccess.upsert({
        where: {
          accountId_fileId_userId: {
            accountId,
            fileId: request.resourceId,
            userId: request.requesterUserId,
          },
        },
        create: {
          accountId,
          fileId: request.resourceId,
          userId: request.requesterUserId,
          permission: "EDIT",
          grantedByUserId: operatorUserId,
        },
        update: {
          permission: "EDIT",
          grantedByUserId: operatorUserId,
        },
      });
    } else if (request.resourceType === "FOLDER") {
      await tx.cavCloudFolderAccess.upsert({
        where: {
          accountId_folderId_userId: {
            accountId,
            folderId: request.resourceId,
            userId: request.requesterUserId,
          },
        },
        create: {
          accountId,
          folderId: request.resourceId,
          userId: request.requesterUserId,
          role: "EDITOR",
          grantedByUserId: operatorUserId,
        },
        update: {
          role: "EDITOR",
          grantedByUserId: operatorUserId,
        },
      });
    } else if (request.resourceType === "PROJECT") {
      const projectId = Number(request.resourceId);
      if (!Number.isFinite(projectId) || !Number.isInteger(projectId) || projectId <= 0) {
        throw new ApiAuthError("BAD_REQUEST", 400);
      }
      await tx.cavCodeProjectAccess.upsert({
        where: {
          accountId_projectId_userId: {
            accountId,
            projectId,
            userId: request.requesterUserId,
          },
        },
        create: {
          accountId,
          projectId,
          userId: request.requesterUserId,
          role: "EDITOR",
          grantedByUserId: operatorUserId,
        },
        update: {
          role: "EDITOR",
          grantedByUserId: operatorUserId,
        },
      });
    }

    const resolved = await tx.cavCollabAccessRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(),
        resolvedByUserId: operatorUserId,
      },
      select: {
        id: true,
        requesterUserId: true,
        resourceType: true,
        resourceId: true,
        resolvedAt: true,
      },
    });

    return resolved;
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REQUEST_APPROVED",
    subjectType: "collab_request",
    subjectId: approved.id,
    label: "Collaboration request approved",
    meta: {
      resourceType: approved.resourceType,
      resourceId: approved.resourceId,
      requesterUserId: approved.requesterUserId,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_GRANTED",
    subjectType: approved.resourceType === "PROJECT" ? "project" : approved.resourceType === "FOLDER" ? "folder" : "file",
    subjectId: approved.resourceId,
    label: "Collaboration access granted",
    meta: {
      requestId: approved.id,
      requesterUserId: approved.requesterUserId,
      permission: "EDIT",
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: approved.requesterUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_REQUEST_APPROVED,
    title: "Collaboration request approved",
    body: "Your request for collaborator access was approved.",
    href: "/cavcloud",
    tone: "GOOD",
    dedupeHours: 1,
  });

  return {
    id: approved.id,
    status: "APPROVED" as const,
    resolvedAtISO: approved.resolvedAt ? toIso(approved.resolvedAt) : null,
  };
}

export async function denyCollabAccessRequest(args: {
  accountId: string;
  operatorUserId: string;
  requestId: string;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const requestId = s(args.requestId);
  if (!accountId || !operatorUserId || !requestId) throw new ApiAuthError("BAD_REQUEST", 400);

  const operator = await getCavCloudOperatorContext({ accountId, userId: operatorUserId });
  if (operator.role !== "OWNER") throw new ApiAuthError("UNAUTHORIZED", 403);

  const denied = await prisma.cavCollabAccessRequest.updateMany({
    where: {
      id: requestId,
      accountId,
      status: "PENDING",
    },
    data: {
      status: "DENIED",
      resolvedAt: new Date(),
      resolvedByUserId: operatorUserId,
    },
  });

  if (!denied.count) throw new ApiAuthError("NOT_FOUND", 404);

  const request = await prisma.cavCollabAccessRequest.findUnique({
    where: {
      id: requestId,
    },
    select: {
      id: true,
      requesterUserId: true,
      resolvedAt: true,
      resourceType: true,
      resourceId: true,
    },
  });

  if (!request?.id) throw new ApiAuthError("NOT_FOUND", 404);

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REQUEST_DENIED",
    subjectType: "collab_request",
    subjectId: request.id,
    label: "Collaboration request denied",
    meta: {
      resourceType: request.resourceType,
      resourceId: request.resourceId,
      requesterUserId: request.requesterUserId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: request.requesterUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_REQUEST_DENIED,
    title: "Collaboration request denied",
    body: "Your request for collaborator access was denied.",
    href: "/cavcloud",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return {
    id: request.id,
    status: "DENIED" as const,
    resolvedAtISO: request.resolvedAt ? toIso(request.resolvedAt) : null,
  };
}

export async function createContributorLink(args: {
  accountId: string;
  operatorUserId: string;
  resourceType: unknown;
  resourceId: unknown;
  expiresInDays: unknown;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const resourceType = s(args.resourceType).toUpperCase() as CavCollabResourceType;
  const resourceId = s(args.resourceId);
  const expiresInDays = Math.trunc(Number(args.expiresInDays));

  if (!accountId || !operatorUserId || !resourceId) throw new ApiAuthError("BAD_REQUEST", 400);
  if (resourceType !== "FILE" && resourceType !== "FOLDER") throw new ApiAuthError("BAD_REQUEST", 400);
  if (!CONTRIBUTOR_EXPIRY_DAYS.has(expiresInDays)) throw new ApiAuthError("BAD_REQUEST", 400);

  const operator = await getCavCloudOperatorContext({ accountId, userId: operatorUserId });
  if (operator.role !== "OWNER") throw new ApiAuthError("UNAUTHORIZED", 403);
  if (!operator.policy.enableContributorLinks) throw new ApiAuthError("UNAUTHORIZED", 403);

  enforceLocalRateLimit(`contrib:create:${accountId}:${operatorUserId}`, CONTRIBUTOR_CREATE_LIMIT);

  if (resourceType === "FILE") {
    await ensureFileInAccount(accountId, resourceId);
  } else {
    await ensureFolderInAccount(accountId, resourceId);
  }

  const token = generateContributorToken();
  const tokenHash = hashToken(token);
  const expiresAt = nowPlusDays(expiresInDays);

  const link = await prisma.cavContributorLink.create({
    data: {
      accountId,
      resourceType,
      resourceId,
      permission: "EDIT",
      expiresAt,
      createdByUserId: operatorUserId,
      tokenHash,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "CONTRIBUTOR_LINK_CREATED",
    subjectType: "contributor_link",
    subjectId: link.id,
    label: "Contributor link created",
    meta: {
      resourceType,
      resourceId,
      expiresInDays,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: operatorUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_CONTRIBUTOR_LINK_CREATED,
    title: "Contributor link created",
    body: `Contributor link expires in ${expiresInDays} day${expiresInDays === 1 ? "" : "s"}.`,
    href: "/cavcloud",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return {
    id: link.id,
    token,
    expiresAtISO: toIso(link.expiresAt),
  };
}

export async function resolveContributorLink(args: {
  operatorUserId: string;
  token: unknown;
}) {
  const operatorUserId = s(args.operatorUserId);
  const token = s(args.token);
  if (!operatorUserId || !token) throw new ApiAuthError("BAD_REQUEST", 400);

  const tokenHash = hashToken(token);
  const link = await prisma.cavContributorLink.findFirst({
    where: {
      tokenHash,
      expiresAt: {
        gt: new Date(),
      },
    },
    select: {
      id: true,
      accountId: true,
      resourceType: true,
      resourceId: true,
      expiresAt: true,
      createdByUserId: true,
    },
  });

  if (!link?.id) throw new ApiAuthError("NOT_FOUND", 404);

  enforceLocalRateLimit(`contrib:resolve:${link.accountId}:${operatorUserId}`, CONTRIBUTOR_RESOLVE_LIMIT);

  const operatorRole = await prisma.membership.findUnique({
    where: {
      accountId_userId: {
        accountId: link.accountId,
        userId: operatorUserId,
      },
    },
    select: {
      role: true,
    },
  });

  if (!operatorRole?.role) {
    await createCollabAccessRequest({
      requesterUserId: operatorUserId,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      requestedPermission: "EDIT",
      message: "Contributor link requires workspace membership.",
    }).catch(() => null);

    await writeCavCloudOperationLog({
      accountId: link.accountId,
      operatorUserId,
      kind: "CONTRIBUTOR_LINK_DENIED",
      subjectType: "contributor_link",
      subjectId: link.id,
      label: "Contributor link denied",
      meta: {
        reason: "membership_required",
      },
    });

    await notifyCavCloudCollabSignal({
      accountId: link.accountId,
      userId: operatorUserId,
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_CONTRIBUTOR_LINK_DENIED,
      title: "Contributor link denied",
      body: "Join the workspace before using this contributor link.",
      href: "/cavcloud",
      tone: "BAD",
    dedupeHours: 1,
    });

    throw new ApiAuthError("UNAUTHORIZED", 403);
  }

  if (link.resourceType === "FILE") {
    await ensureFileInAccount(link.accountId, link.resourceId);
    await prisma.cavCloudFileAccess.upsert({
      where: {
        accountId_fileId_userId: {
          accountId: link.accountId,
          fileId: link.resourceId,
          userId: operatorUserId,
        },
      },
      create: {
        accountId: link.accountId,
        fileId: link.resourceId,
        userId: operatorUserId,
        permission: "EDIT",
        expiresAt: link.expiresAt,
        grantedByUserId: link.createdByUserId,
      },
      update: {
        permission: "EDIT",
        expiresAt: link.expiresAt,
        grantedByUserId: link.createdByUserId,
      },
    });
  } else if (link.resourceType === "FOLDER") {
    await ensureFolderInAccount(link.accountId, link.resourceId);
    await prisma.cavCloudFolderAccess.upsert({
      where: {
        accountId_folderId_userId: {
          accountId: link.accountId,
          folderId: link.resourceId,
          userId: operatorUserId,
        },
      },
      create: {
        accountId: link.accountId,
        folderId: link.resourceId,
        userId: operatorUserId,
        role: "EDITOR",
        expiresAt: link.expiresAt,
        grantedByUserId: link.createdByUserId,
      },
      update: {
        role: "EDITOR",
        expiresAt: link.expiresAt,
        grantedByUserId: link.createdByUserId,
      },
    });
  } else {
    throw new ApiAuthError("BAD_REQUEST", 400);
  }

  const effective = await getEffectivePermission({
    accountId: link.accountId,
    userId: operatorUserId,
    resourceType: link.resourceType,
    resourceId: link.resourceId,
  });
  if (effective !== "EDIT") {
    await writeCavCloudOperationLog({
      accountId: link.accountId,
      operatorUserId,
      kind: "CONTRIBUTOR_LINK_DENIED",
      subjectType: "contributor_link",
      subjectId: link.id,
      label: "Contributor link denied",
      meta: {
        reason: "permission_engine",
      },
    });
    await notifyCavCloudCollabSignal({
      accountId: link.accountId,
      userId: operatorUserId,
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_CONTRIBUTOR_LINK_DENIED,
      title: "Contributor link denied",
      body: "Contributor access could not be granted.",
      href: "/cavcloud",
      tone: "BAD",
      dedupeHours: 1,
    });
    throw new ApiAuthError("UNAUTHORIZED", 403);
  }

  await writeCavCloudOperationLog({
    accountId: link.accountId,
    operatorUserId,
    kind: "CONTRIBUTOR_LINK_USED",
    subjectType: "contributor_link",
    subjectId: link.id,
    label: "Contributor link used",
    meta: {
      resourceType: link.resourceType,
      resourceId: link.resourceId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId: link.accountId,
    userId: operatorUserId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_CONTRIBUTOR_LINK_USED,
    title: "Contributor link accepted",
    body: "Contributor access has been granted.",
    href: "/cavcloud",
    tone: "GOOD",
    dedupeHours: 1,
  });

  return {
    accountId: link.accountId,
    resourceType: link.resourceType,
    resourceId: link.resourceId,
    deepLink:
      link.resourceType === "FILE"
        ? `/cavcloud/view/${encodeURIComponent(link.resourceId)}`
        : `/cavcloud?folderId=${encodeURIComponent(link.resourceId)}`,
  };
}
