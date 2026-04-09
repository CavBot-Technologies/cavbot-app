import "server-only";

import type {
  CavCodeProjectAccessRole,
  CavCloudAccessPermission,
  CavCloudFolderAccessRole,
} from "@prisma/client";

import { getAuthPool } from "@/lib/authDb";
import { ApiAuthError, type MemberRole } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CAVCLOUD_COLLAB_POLICY,
  getCavCloudCollabPolicy,
  type CavCloudCollabPolicy,
} from "@/lib/cavcloud/collabPolicy.server";

export type CavCollabResourceType = "FILE" | "FOLDER" | "PROJECT";
export type CavEffectivePermission = "NONE" | "VIEW" | "EDIT";

export type CavCloudAction =
  | "CREATE_FOLDER"
  | "UPLOAD_FILE"
  | "EDIT_FILE_CONTENT"
  | "RENAME_MOVE_FILE"
  | "RENAME_MOVE_FOLDER"
  | "DELETE_TO_TRASH"
  | "RESTORE_FROM_TRASH"
  | "PERMANENT_DELETE"
  | "SHARE_READ_ONLY"
  | "PUBLISH_ARTIFACT"
  | "MANAGE_COLLABORATION"
  | "MANAGE_SETTINGS"
  | "MOUNT_CAVCODE"
  | "ACCESS_CAVSAFE";

export type CavCloudOperatorContext = {
  accountId: string;
  userId: string;
  role: MemberRole;
  policy: CavCloudCollabPolicy;
};

type RoleAndPolicy = {
  role: MemberRole;
  policy: CavCloudCollabPolicy;
};

function normalizePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withSlash.replace(/\/+/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed;
}

function ancestorPaths(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") return ["/"];

  const out = ["/"];
  let cursor = "";
  for (const segment of normalized.split("/").filter(Boolean)) {
    cursor = `${cursor}/${segment}`;
    out.push(cursor);
  }
  return out;
}

function permissionRank(permission: CavEffectivePermission): number {
  if (permission === "EDIT") return 2;
  if (permission === "VIEW") return 1;
  return 0;
}

function permissionAtLeast(permission: CavEffectivePermission, needed: CavEffectivePermission): boolean {
  return permissionRank(permission) >= permissionRank(needed);
}

function permissionFromFileGrant(permission: CavCloudAccessPermission): CavEffectivePermission {
  return permission === "EDIT" ? "EDIT" : "VIEW";
}

function permissionFromFolderGrant(role: CavCloudFolderAccessRole): CavEffectivePermission {
  return role === "EDITOR" ? "EDIT" : "VIEW";
}

function permissionFromProjectGrant(role: CavCodeProjectAccessRole): CavEffectivePermission {
  return role === "EDITOR" || role === "ADMIN" ? "EDIT" : "VIEW";
}

function isGrantActive(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

async function resolveMembershipRole(accountId: string, userId: string): Promise<MemberRole | null> {
  const result = await getAuthPool().query<{ role: string | null }>(
    `SELECT "role"
     FROM "Membership"
     WHERE "accountId" = $1
       AND "userId" = $2
     LIMIT 1`,
    [accountId, userId],
  );
  const normalized = String(result.rows[0]?.role || "").toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  if (normalized === "MEMBER") return "MEMBER";
  return null;
}

async function resolveRoleAndPolicy(accountId: string, userId: string): Promise<RoleAndPolicy> {
  const [role, policy] = await Promise.all([
    resolveMembershipRole(accountId, userId),
    getCavCloudCollabPolicy(accountId).catch(() => ({ ...DEFAULT_CAVCLOUD_COLLAB_POLICY })),
  ]);

  if (!role) throw new ApiAuthError("UNAUTHORIZED", 403);
  return {
    role,
    policy,
  };
}

function baselinePermissionForRole(role: MemberRole, policy: CavCloudCollabPolicy): CavEffectivePermission {
  if (role === "OWNER") return "EDIT";

  // CavBot currently allows admins to run day-to-day cloud operations.
  // Keep admin baseline as EDIT to preserve existing behavior while adding explicit overrides.
  if (role === "ADMIN") return "EDIT";

  return policy.allowMembersEditFiles ? "EDIT" : "VIEW";
}

async function resolveDeepestFolderGrant(args: {
  accountId: string;
  userId: string;
  folderPath: string;
}): Promise<CavEffectivePermission | null> {
  const paths = ancestorPaths(args.folderPath);
  if (!paths.length) return null;

  const folders = await prisma.cavCloudFolder.findMany({
    where: {
      accountId: args.accountId,
      deletedAt: null,
      path: { in: paths },
    },
    select: {
      id: true,
      path: true,
    },
  });
  if (!folders.length) return null;

  const folderById = new Map(folders.map((folder) => [folder.id, folder.path]));

  const grants = await prisma.cavCloudFolderAccess.findMany({
    where: {
      accountId: args.accountId,
      userId: args.userId,
      folderId: { in: folders.map((folder) => folder.id) },
    },
    select: {
      role: true,
      expiresAt: true,
      folderId: true,
    },
  });

  let best: { pathLen: number; permission: CavEffectivePermission } | null = null;
  for (const grant of grants) {
    if (!isGrantActive(grant.expiresAt)) continue;
    const path = folderById.get(grant.folderId) || "/";
    const permission = permissionFromFolderGrant(grant.role);
    const pathLen = path.length;

    if (!best || pathLen > best.pathLen) {
      best = { pathLen, permission };
    }
  }

  return best?.permission || null;
}

export async function getCavCloudOperatorContext(args: {
  accountId: string;
  userId: string;
}): Promise<CavCloudOperatorContext> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 403);

  const { role, policy } = await resolveRoleAndPolicy(accountId, userId);
  return {
    accountId,
    userId,
    role,
    policy,
  };
}

export async function getEffectivePermission(args: {
  accountId: string;
  userId: string;
  resourceType: CavCollabResourceType;
  resourceId: string | number;
}): Promise<CavEffectivePermission> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const resourceType = String(args.resourceType || "").toUpperCase() as CavCollabResourceType;

  if (!accountId || !userId) return "NONE";

  const roleAndPolicy = await resolveRoleAndPolicy(accountId, userId).catch(() => null);
  if (!roleAndPolicy) return "NONE";

  const { role, policy } = roleAndPolicy;
  if (role === "OWNER") return "EDIT";

  if (resourceType === "FILE") {
    const fileId = String(args.resourceId || "").trim();
    if (!fileId) return "NONE";

    const file = await prisma.cavCloudFile.findFirst({
      where: {
        id: fileId,
        accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        folder: {
          select: {
            path: true,
          },
        },
      },
    });
    if (!file?.id) return "NONE";

    let effective = baselinePermissionForRole(role, policy);

    const [fileGrant, folderGrant] = await Promise.all([
      prisma.cavCloudFileAccess.findFirst({
        where: {
          accountId,
          fileId,
          userId,
        },
        select: {
          permission: true,
          expiresAt: true,
        },
      }),
      resolveDeepestFolderGrant({
        accountId,
        userId,
        folderPath: String(file.folder?.path || "/"),
      }),
    ]);

    if (folderGrant && permissionRank(folderGrant) > permissionRank(effective)) {
      effective = folderGrant;
    }

    if (fileGrant && isGrantActive(fileGrant.expiresAt)) {
      // File-level grant always wins, including restricting EDIT -> VIEW.
      effective = permissionFromFileGrant(fileGrant.permission);
    }

    return effective;
  }

  if (resourceType === "FOLDER") {
    const folderId = String(args.resourceId || "").trim();
    if (!folderId) return "NONE";

    const folder = await prisma.cavCloudFolder.findFirst({
      where: {
        id: folderId,
        accountId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!folder?.id) return "NONE";

    let effective = baselinePermissionForRole(role, policy);

    const folderGrant = await prisma.cavCloudFolderAccess.findFirst({
      where: {
        accountId,
        folderId,
        userId,
      },
      select: {
        role: true,
        expiresAt: true,
      },
    });

    if (folderGrant && isGrantActive(folderGrant.expiresAt)) {
      const explicit = permissionFromFolderGrant(folderGrant.role);
      if (permissionRank(explicit) > permissionRank(effective)) {
        effective = explicit;
      }
      if (role === "ADMIN" && explicit === "VIEW") {
        // Explicit viewer grant can constrain admin for this folder.
        effective = "VIEW";
      }
    }

    return effective;
  }

  if (resourceType === "PROJECT") {
    const projectIdNum = Number(args.resourceId);
    if (!Number.isFinite(projectIdNum) || !Number.isInteger(projectIdNum) || projectIdNum <= 0) return "NONE";

    const project = await prisma.project.findFirst({
      where: {
        id: projectIdNum,
        accountId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });
    if (!project?.id) return "NONE";

    let effective: CavEffectivePermission = role === "ADMIN" ? "EDIT" : "VIEW";

    const projectGrant = await prisma.cavCodeProjectAccess.findFirst({
      where: {
        accountId,
        projectId: projectIdNum,
        userId,
      },
      select: {
        role: true,
      },
    });

    if (projectGrant?.role) {
      effective = permissionFromProjectGrant(projectGrant.role);
    }

    return effective;
  }

  return "NONE";
}

export async function assertEffectivePermission(args: {
  accountId: string;
  userId: string;
  resourceType: CavCollabResourceType;
  resourceId: string | number;
  needed: CavEffectivePermission;
  errorCode?: string;
}): Promise<CavEffectivePermission> {
  const permission = await getEffectivePermission(args);
  if (!permissionAtLeast(permission, args.needed)) {
    throw new ApiAuthError(args.errorCode || "UNAUTHORIZED", 403);
  }
  return permission;
}

export function isRoleAllowedToManageCollaboration(role: MemberRole, policy: CavCloudCollabPolicy): boolean {
  if (role === "OWNER") return true;
  if (role === "ADMIN") return policy.allowAdminsManageCollaboration;
  return false;
}

export function isRoleAllowedToViewAccessLogs(role: MemberRole, policy: CavCloudCollabPolicy): boolean {
  if (role === "OWNER") return true;
  if (role === "ADMIN") return policy.allowAdminsViewAccessLogs;
  return false;
}

function roleActionAllowed(role: MemberRole, policy: CavCloudCollabPolicy, action: CavCloudAction): boolean {
  if (role === "OWNER") return true;

  if (role === "ADMIN") {
    if (action === "MANAGE_SETTINGS") return false;
    if (action === "ACCESS_CAVSAFE") return false;
    if (action === "PERMANENT_DELETE") return false;
    if (action === "MANAGE_COLLABORATION") return policy.allowAdminsManageCollaboration;
    if (action === "PUBLISH_ARTIFACT") return policy.allowAdminsPublishArtifacts;
    return true;
  }

  if (action === "CREATE_FOLDER" || action === "UPLOAD_FILE") {
    return policy.allowMembersCreateUpload;
  }
  if (action === "EDIT_FILE_CONTENT" || action === "RENAME_MOVE_FILE" || action === "RENAME_MOVE_FOLDER") {
    return true;
  }

  return false;
}

export async function assertCavCloudActionAllowed(args: {
  accountId: string;
  userId: string;
  action: CavCloudAction;
  resourceType?: CavCollabResourceType;
  resourceId?: string | number;
  neededPermission?: CavEffectivePermission;
  errorCode?: string;
}): Promise<CavCloudOperatorContext> {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  if (!accountId || !userId) throw new ApiAuthError("UNAUTHORIZED", 403);

  const { role, policy } = await resolveRoleAndPolicy(accountId, userId);

  if (!roleActionAllowed(role, policy, args.action)) {
    throw new ApiAuthError(args.errorCode || "UNAUTHORIZED", 403);
  }

  if (args.resourceType && args.resourceId != null && args.neededPermission) {
    const effective = await getEffectivePermission({
      accountId,
      userId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
    });
    if (!permissionAtLeast(effective, args.neededPermission)) {
      throw new ApiAuthError(args.errorCode || "UNAUTHORIZED", 403);
    }
  }

  return {
    accountId,
    userId,
    role,
    policy,
  };
}

export async function assertCavCodeProjectAccess(args: {
  accountId: string;
  userId: string;
  projectId: number;
  needed: CavEffectivePermission;
  errorCode?: string;
}) {
  return assertEffectivePermission({
    accountId: args.accountId,
    userId: args.userId,
    resourceType: "PROJECT",
    resourceId: args.projectId,
    needed: args.needed,
    errorCode: args.errorCode,
  });
}
