import "server-only";

import type {
  CavCloudFolderAccessRole,
  Prisma,
} from "@prisma/client";

import { ApiAuthError } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { CAVCLOUD_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { notifyCavCloudCollabSignal } from "@/lib/cavcloud/notifications.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";

type TargetType = "file" | "folder";
type Permission = "VIEW" | "EDIT";
type LookupRow = {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  avatarTone: string | null;
  isWorkspaceMember: boolean;
};
type ShareRecipientInput = {
  userId: string;
  permission: Permission;
};
type AccessRow = {
  id: string;
  targetType: TargetType;
  targetId: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  avatarTone: string | null;
  permission: Permission;
  expiresAtISO: string | null;
  createdAtISO: string;
  updatedAtISO: string;
};
type CreateSharesInput = {
  accountId: string;
  operatorUserId: string;
  targetType: TargetType;
  targetId: string;
  recipients: ShareRecipientInput[];
  expiresInDays: 0 | 1 | 7 | 30;
};
type UpdateShareInput = {
  accountId: string;
  operatorUserId: string;
  shareId: string;
  permission?: Permission;
  expiresInDays?: 0 | 1 | 7 | 30;
};
type RevokeShareInput = {
  accountId: string;
  operatorUserId: string;
  shareId: string;
};
type DeclineShareInput = {
  accountId: string;
  operatorUserId: string;
  shareId: string;
};
type CollabFilter = "all" | "readonly" | "edit" | "expiringSoon";
type CollabItem = {
  grantId: string;
  targetType: TargetType;
  targetId: string;
  name: string;
  path: string;
  mimeType: string | null;
  bytes: number | null;
  permission: Permission;
  permissionLabel: "Read-only" | "Collaborate";
  expiresAtISO: string | null;
  expiringSoon: boolean;
  sharedBy: {
    userId: string;
    username: string | null;
    displayName: string | null;
  };
  createdAtISO: string;
  updatedAtISO: string;
  openHref: string;
  openInCavCodeHref: string | null;
  shortcutSaved: boolean;
  removeShortcutBody: {
    targetType: TargetType;
    targetId: string;
  };
  saveShortcutBody: {
    targetType: TargetType;
    targetId: string;
    grantId: string;
  };
  declineHref: string;
};
type SaveShortcutInput = {
  accountId: string;
  operatorUserId: string;
  targetType: TargetType;
  targetId: string;
  grantId?: string | null;
};
type RemoveShortcutInput = {
  accountId: string;
  operatorUserId: string;
  targetType: TargetType;
  targetId: string;
};

const CAVCODE_EDITABLE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "txt",
  "yml",
  "yaml",
  "xml",
  "css",
  "scss",
  "html",
  "htm",
  "py",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "hpp",
  "h",
  "sh",
]);
const CAVCODE_EDITABLE_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/javascript",
  "text/javascript",
  "application/typescript",
  "text/typescript",
];
const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000;
const EXPIRED_EVENT_SCAN_WINDOW_MS = 60 * 60 * 1000;

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function toISO(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function parseTargetType(raw: unknown): TargetType {
  const normalized = s(raw).toLowerCase();
  if (normalized === "file") return "file";
  if (normalized === "folder") return "folder";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

function parsePermission(raw: unknown): Permission {
  const normalized = s(raw).toUpperCase();
  if (normalized === "VIEW") return "VIEW";
  if (normalized === "EDIT") return "EDIT";
  throw new ApiAuthError("BAD_REQUEST", 400);
}

export function parseExpiresInDays(raw: unknown, fallback: 0 | 1 | 7 | 30 = 0): 0 | 1 | 7 | 30 {
  const candidate = raw == null || s(raw) === "" ? fallback : Math.trunc(Number(raw));
  if (candidate === 0 || candidate === 1 || candidate === 7 || candidate === 30) return candidate;
  throw new ApiAuthError("BAD_REQUEST", 400);
}

function expiresAtFromDays(days: 0 | 1 | 7 | 30): Date | null {
  if (days === 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function permissionLabel(permission: Permission): "Read-only" | "Collaborate" {
  return permission === "EDIT" ? "Collaborate" : "Read-only";
}

function folderRoleFromPermission(permission: Permission): CavCloudFolderAccessRole {
  return permission === "EDIT" ? "EDITOR" : "VIEWER";
}

function permissionFromFolderRole(role: CavCloudFolderAccessRole): Permission {
  return role === "EDITOR" ? "EDIT" : "VIEW";
}

function folderPathFromFilePath(path: string): string {
  const normalized = s(path);
  if (!normalized || normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function buildFileOpenHref(path: string, fileId: string): string {
  const folderPath = folderPathFromFilePath(path);
  const params = new URLSearchParams();
  params.set("folderPath", folderPath);
  params.set("fileId", fileId);
  return `/cavcloud?${params.toString()}`;
}

function buildFolderOpenHref(path: string): string {
  const params = new URLSearchParams();
  params.set("folderPath", s(path) || "/");
  return `/cavcloud?${params.toString()}`;
}

function extension(name: string): string {
  const normalized = s(name).toLowerCase();
  const idx = normalized.lastIndexOf(".");
  if (idx < 0) return "";
  return normalized.slice(idx + 1);
}

function isEditableInCavCode(name: string, mimeType: string | null): boolean {
  const ext = extension(name);
  if (ext && CAVCODE_EDITABLE_EXTENSIONS.has(ext)) return true;
  const mime = s(mimeType).toLowerCase();
  if (!mime) return false;
  return CAVCODE_EDITABLE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function normalizeProfileUrlUsername(raw: string): string {
  const value = s(raw);
  if (!value) return "";

  let candidate = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      candidate = new URL(value).pathname;
    } catch {
      candidate = value;
    }
  }

  if (candidate.startsWith("/")) {
    const parts = candidate.split("/").filter(Boolean);
    if (!parts.length) return "";
    if (String(parts[0] || "").toLowerCase() === "u" && parts[1]) {
      return String(parts[1]).replace(/^@+/, "").trim().toLowerCase();
    }
    return String(parts[parts.length - 1] || "").replace(/^@+/, "").trim().toLowerCase();
  }

  return candidate.replace(/^@+/, "").trim().toLowerCase();
}

function senderLabel(user: { username: string | null; displayName: string | null; email: string | null }): string {
  const username = s(user.username);
  if (username) return `@${username}`;
  const displayName = s(user.displayName);
  if (displayName) return displayName;
  const email = s(user.email);
  if (email) return email;
  return "A CavBot user";
}

function jsonMeta(obj: Record<string, unknown>): Prisma.JsonObject {
  return obj as Prisma.JsonObject;
}

async function emitActivity(args: {
  accountId: string;
  operatorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetPath: string | null;
  metaJson?: Prisma.JsonObject;
}) {
  await prisma.cavCloudActivity.create({
    data: {
      accountId: args.accountId,
      operatorUserId: args.operatorUserId,
      action: s(args.action).slice(0, 64) || "activity",
      targetType: s(args.targetType).slice(0, 32) || "item",
      targetId: args.targetId || null,
      targetPath: args.targetPath || null,
      metaJson: args.metaJson || undefined,
    },
  });
}

async function ensureManageAccessAllowed(accountId: string, operatorUserId: string) {
  await assertCavCloudActionAllowed({
    accountId,
    userId: operatorUserId,
    action: "MANAGE_COLLABORATION",
    errorCode: "UNAUTHORIZED",
  });
}

async function resolveTargetOrThrow(args: { accountId: string; targetType: TargetType; targetId: string }) {
  if (args.targetType === "file") {
    const file = await prisma.cavCloudFile.findFirst({
      where: {
        id: args.targetId,
        accountId: args.accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        mimeType: true,
        bytes: true,
        updatedAt: true,
      },
    });
    if (!file?.id) throw new ApiAuthError("NOT_FOUND", 404);
    return {
      targetType: "file" as const,
      id: file.id,
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      bytes: typeof file.bytes === "bigint" ? Number(file.bytes) : Number(file.bytes || 0),
      updatedAtISO: toISO(file.updatedAt) || "",
    };
  }

  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      id: args.targetId,
      accountId: args.accountId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      path: true,
      updatedAt: true,
    },
  });
  if (!folder?.id) throw new ApiAuthError("NOT_FOUND", 404);
  return {
    targetType: "folder" as const,
    id: folder.id,
    name: folder.name,
    path: folder.path,
    mimeType: null,
    bytes: null,
    updatedAtISO: toISO(folder.updatedAt) || "",
  };
}

async function resolveWorkspaceRecipients(args: {
  accountId: string;
  recipientIds: string[];
}) {
  const rows = await prisma.membership.findMany({
    where: {
      accountId: args.accountId,
      userId: { in: args.recipientIds },
    },
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          avatarImage: true,
          avatarTone: true,
        },
      },
    },
  });

  const map = new Map(rows.map((row) => [row.userId, row]));
  for (const requestedId of args.recipientIds) {
    if (!map.has(requestedId)) {
      throw new ApiAuthError("RECIPIENT_NOT_FOUND", 404);
    }
  }
  return map;
}

function makeRecipientActionMeta(args: {
  targetType: TargetType;
  targetId: string;
  grantId: string;
  openHref: string;
  openInCavCodeHref: string | null;
}) {
  return jsonMeta({
    actions: {
      open: {
        label: "Open",
        href: args.openHref,
      },
      saveToCavCloud: {
        label: "Save to CavCloud",
        href: "/api/cavcloud/collab/shortcuts",
        method: "POST",
        body: {
          targetType: args.targetType,
          targetId: args.targetId,
          grantId: args.grantId,
        },
      },
      openInCavCode: args.openInCavCodeHref
        ? {
            label: "Open in CavCode",
            href: args.openInCavCodeHref,
          }
        : null,
      decline: {
        label: "Decline",
        href: `/api/cavcloud/shares/user/${encodeURIComponent(args.grantId)}/decline`,
        method: "POST",
      },
    },
  });
}

export async function lookupShareableUsers(args: {
  accountId: string;
  operatorUserId: string;
  query: string;
  limit?: number;
}): Promise<LookupRow[]> {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const query = s(args.query);
  const limit = Math.max(1, Math.min(20, Math.trunc(Number(args.limit || 8)) || 8));
  if (!accountId || !operatorUserId || !query) return [];

  const profileUsername = normalizeProfileUrlUsername(query);
  const maybeUsername = profileUsername || normalizeProfileUrlUsername(`@${query}`);
  const whereOr: Prisma.MembershipWhereInput[] = [];

  if (maybeUsername) {
    whereOr.push({
      user: {
        username: {
          equals: maybeUsername,
          mode: "insensitive",
        },
      },
    });
  }

  whereOr.push(
    {
      user: {
        username: {
          contains: query.replace(/^@+/, ""),
          mode: "insensitive",
        },
      },
    },
    {
      user: {
        displayName: {
          contains: query,
          mode: "insensitive",
        },
      },
    },
    {
      user: {
        email: {
          contains: query,
          mode: "insensitive",
        },
      },
    },
  );

  const rows = await prisma.membership.findMany({
    where: {
      accountId,
      userId: { not: operatorUserId },
      OR: whereOr,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
    select: {
      userId: true,
      user: {
        select: {
          username: true,
          displayName: true,
          avatarImage: true,
          avatarTone: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    userId: row.userId,
    username: row.user?.username || null,
    displayName: row.user?.displayName || null,
    avatarUrl: row.user?.avatarImage || null,
    avatarTone: row.user?.avatarTone || null,
    isWorkspaceMember: true,
  }));
}

export async function listTargetAccess(args: {
  accountId: string;
  targetType: TargetType;
  targetId: string;
}): Promise<AccessRow[]> {
  const accountId = s(args.accountId);
  const targetType = parseTargetType(args.targetType);
  const targetId = s(args.targetId);
  if (!accountId || !targetId) return [];

  const now = new Date();
  if (targetType === "file") {
    const rows = await prisma.cavCloudFileAccess.findMany({
      where: {
        accountId,
        fileId: targetId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        fileId: true,
        userId: true,
        permission: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            username: true,
            displayName: true,
            email: true,
            avatarImage: true,
            avatarTone: true,
          },
        },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      targetType: "file",
      targetId: row.fileId,
      userId: row.userId,
      username: row.user?.username || null,
      displayName: row.user?.displayName || null,
      email: s(row.user?.email),
      avatarUrl: row.user?.avatarImage || null,
      avatarTone: row.user?.avatarTone || null,
      permission: row.permission,
      expiresAtISO: toISO(row.expiresAt),
      createdAtISO: toISO(row.createdAt) || "",
      updatedAtISO: toISO(row.updatedAt) || "",
    }));
  }

  const rows = await prisma.cavCloudFolderAccess.findMany({
    where: {
      accountId,
      folderId: targetId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      folderId: true,
      userId: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          username: true,
          displayName: true,
          email: true,
          avatarImage: true,
          avatarTone: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    targetType: "folder",
    targetId: row.folderId,
    userId: row.userId,
    username: row.user?.username || null,
    displayName: row.user?.displayName || null,
    email: s(row.user?.email),
    avatarUrl: row.user?.avatarImage || null,
    avatarTone: row.user?.avatarTone || null,
    permission: permissionFromFolderRole(row.role),
    expiresAtISO: toISO(row.expiresAt),
    createdAtISO: toISO(row.createdAt) || "",
    updatedAtISO: toISO(row.updatedAt) || "",
  }));
}

export async function createDirectUserShares(input: CreateSharesInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const targetType = parseTargetType(input.targetType);
  const targetId = s(input.targetId);
  if (!accountId || !operatorUserId || !targetId) throw new ApiAuthError("BAD_REQUEST", 400);

  await ensureManageAccessAllowed(accountId, operatorUserId);

  const dedupedRecipients = Array.from(new Set(
    (Array.isArray(input.recipients) ? input.recipients : [])
      .map((row) => ({
        userId: s(row?.userId),
        permission: parsePermission(row?.permission),
      }))
      .filter((row) => row.userId && row.userId !== operatorUserId)
      .map((row) => `${row.userId}:${row.permission}`),
  )).map((key) => {
    const [userId, permission] = key.split(":");
    return { userId, permission: parsePermission(permission) };
  });
  if (!dedupedRecipients.length) throw new ApiAuthError("BAD_REQUEST", 400);

  const expiresAt = expiresAtFromDays(input.expiresInDays);
  const target = await resolveTargetOrThrow({ accountId, targetType, targetId });
  const recipientMap = await resolveWorkspaceRecipients({
    accountId,
    recipientIds: dedupedRecipients.map((row) => row.userId),
  });

  const operator = await prisma.user.findUnique({
    where: { id: operatorUserId },
    select: {
      username: true,
      displayName: true,
      email: true,
    },
  });
  const sender = senderLabel({
    username: operator?.username || null,
    displayName: operator?.displayName || null,
    email: operator?.email || null,
  });

  const grants = await prisma.$transaction(async (tx) => {
    const created: Array<{
      id: string;
      userId: string;
      permission: Permission;
      expiresAtISO: string | null;
      targetType: TargetType;
      targetId: string;
    }> = [];

    for (const recipient of dedupedRecipients) {
      const recipientInfo = recipientMap.get(recipient.userId);
      if (!recipientInfo?.userId) continue;

      if (targetType === "file") {
        const grant = await tx.cavCloudFileAccess.upsert({
          where: {
            accountId_fileId_userId: {
              accountId,
              fileId: target.id,
              userId: recipient.userId,
            },
          },
          create: {
            accountId,
            fileId: target.id,
            userId: recipient.userId,
            permission: recipient.permission,
            expiresAt,
            grantedByUserId: operatorUserId,
          },
          update: {
            permission: recipient.permission,
            expiresAt,
            grantedByUserId: operatorUserId,
          },
          select: {
            id: true,
            userId: true,
            permission: true,
            expiresAt: true,
          },
        });

        await tx.cavCloudActivity.create({
          data: {
            accountId,
            operatorUserId,
            action: "ACCESS_GRANTED",
            targetType: "file",
            targetId: target.id,
            targetPath: target.path,
            metaJson: jsonMeta({
              grantId: grant.id,
              recipientUserId: grant.userId,
              permission: grant.permission,
              expiresAtISO: toISO(grant.expiresAt),
            }),
          },
        });

        created.push({
          id: grant.id,
          userId: grant.userId,
          permission: grant.permission,
          expiresAtISO: toISO(grant.expiresAt),
          targetType: "file",
          targetId: target.id,
        });
      } else {
        const grant = await tx.cavCloudFolderAccess.upsert({
          where: {
            accountId_folderId_userId: {
              accountId,
              folderId: target.id,
              userId: recipient.userId,
            },
          },
          create: {
            accountId,
            folderId: target.id,
            userId: recipient.userId,
            role: folderRoleFromPermission(recipient.permission),
            expiresAt,
            grantedByUserId: operatorUserId,
          },
          update: {
            role: folderRoleFromPermission(recipient.permission),
            expiresAt,
            grantedByUserId: operatorUserId,
          },
          select: {
            id: true,
            userId: true,
            role: true,
            expiresAt: true,
          },
        });

        const permission = permissionFromFolderRole(grant.role);
        await tx.cavCloudActivity.create({
          data: {
            accountId,
            operatorUserId,
            action: "ACCESS_GRANTED",
            targetType: "folder",
            targetId: target.id,
            targetPath: target.path,
            metaJson: jsonMeta({
              grantId: grant.id,
              recipientUserId: grant.userId,
              permission,
              expiresAtISO: toISO(grant.expiresAt),
            }),
          },
        });

        created.push({
          id: grant.id,
          userId: grant.userId,
          permission,
          expiresAtISO: toISO(grant.expiresAt),
          targetType: "folder",
          targetId: target.id,
        });
      }
    }

    return created;
  });

  for (const grant of grants) {
    const recipient = recipientMap.get(grant.userId);
    const openHref = grant.targetType === "file"
      ? buildFileOpenHref(target.path, target.id)
      : buildFolderOpenHref(target.path);
    const openInCavCodeHref = grant.targetType === "file" && isEditableInCavCode(target.name, target.mimeType)
      ? `/cavcode?cavcloudFileId=${encodeURIComponent(target.id)}`
      : null;

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId,
      kind: "COLLAB_GRANTED",
      subjectType: grant.targetType,
      subjectId: target.id,
      label: target.path,
      meta: {
        event: "ACCESS_GRANTED",
        grantId: grant.id,
        recipientUserId: grant.userId,
        permission: grant.permission,
        expiresAtISO: grant.expiresAtISO,
      },
    });

    const expiresText = grant.expiresAtISO ? ` Expires ${new Date(grant.expiresAtISO).toLocaleDateString()}.` : "";
    const baseBody = `${sender} shared ${target.name} with you.`;
    const body = `${baseBody} ${permissionLabel(grant.permission)} access.${expiresText}`.trim();

    await notifyCavCloudCollabSignal({
      accountId,
      userId: grant.userId,
      kind: grant.targetType === "file"
        ? CAVCLOUD_NOTIFICATION_KINDS.FILE_SHARED_TO_YOU
        : CAVCLOUD_NOTIFICATION_KINDS.FOLDER_SHARED_TO_YOU,
      title: grant.targetType === "file" ? "File shared to you" : "Folder shared to you",
      body,
      href: openHref,
      tone: grant.permission === "EDIT" ? "GOOD" : "WATCH",
      dedupeHours: 1,
      meta: jsonMeta({
        sender: {
          userId: operatorUserId,
          username: operator?.username || null,
          displayName: operator?.displayName || null,
        },
        recipient: {
          userId: grant.userId,
          username: recipient?.user?.username || null,
          displayName: recipient?.user?.displayName || null,
        },
        target: {
          type: grant.targetType,
          id: target.id,
          name: target.name,
          path: target.path,
        },
        permission: grant.permission,
        permissionLabel: permissionLabel(grant.permission),
        expiresAtISO: grant.expiresAtISO,
        ...makeRecipientActionMeta({
          targetType: grant.targetType,
          targetId: target.id,
          grantId: grant.id,
          openHref,
          openInCavCodeHref,
        }),
      }),
    });
  }

  const accessList = await listTargetAccess({
    accountId,
    targetType,
    targetId: target.id,
  });

  return {
    target: {
      type: targetType,
      id: target.id,
      name: target.name,
      path: target.path,
    },
    sent: grants.map((grant) => ({
      shareId: grant.id,
      userId: grant.userId,
      permission: grant.permission,
      permissionLabel: permissionLabel(grant.permission),
      expiresAtISO: grant.expiresAtISO,
    })),
    accessList,
  };
}

async function resolveShareGrantById(args: { accountId: string; shareId: string }) {
  const fileGrant = await prisma.cavCloudFileAccess.findFirst({
    where: {
      accountId: args.accountId,
      id: args.shareId,
    },
    select: {
      id: true,
      accountId: true,
      fileId: true,
      userId: true,
      permission: true,
      expiresAt: true,
      file: {
        select: {
          id: true,
          name: true,
          path: true,
          mimeType: true,
        },
      },
    },
  });
  if (fileGrant?.id) {
    return {
      targetType: "file" as const,
      shareId: fileGrant.id,
      targetId: fileGrant.fileId,
      userId: fileGrant.userId,
      permission: fileGrant.permission as Permission,
      expiresAt: fileGrant.expiresAt,
      targetName: fileGrant.file?.name || "File",
      targetPath: fileGrant.file?.path || "/",
      targetMimeType: fileGrant.file?.mimeType || null,
    };
  }

  const folderGrant = await prisma.cavCloudFolderAccess.findFirst({
    where: {
      accountId: args.accountId,
      id: args.shareId,
    },
    select: {
      id: true,
      accountId: true,
      folderId: true,
      userId: true,
      role: true,
      expiresAt: true,
      folder: {
        select: {
          id: true,
          name: true,
          path: true,
        },
      },
    },
  });
  if (!folderGrant?.id) throw new ApiAuthError("NOT_FOUND", 404);

  return {
    targetType: "folder" as const,
    shareId: folderGrant.id,
    targetId: folderGrant.folderId,
    userId: folderGrant.userId,
    permission: permissionFromFolderRole(folderGrant.role),
    expiresAt: folderGrant.expiresAt,
    targetName: folderGrant.folder?.name || "Folder",
    targetPath: folderGrant.folder?.path || "/",
    targetMimeType: null,
  };
}

export async function updateDirectUserShare(input: UpdateShareInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const shareId = s(input.shareId);
  if (!accountId || !operatorUserId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  await ensureManageAccessAllowed(accountId, operatorUserId);
  const existing = await resolveShareGrantById({ accountId, shareId });

  const nextPermission = input.permission ? parsePermission(input.permission) : existing.permission;
  const nextExpiresAt = input.expiresInDays == null
    ? existing.expiresAt
    : expiresAtFromDays(input.expiresInDays);

  if (existing.targetType === "file") {
    await prisma.cavCloudFileAccess.update({
      where: { id: existing.shareId },
      data: {
        permission: nextPermission,
        expiresAt: nextExpiresAt,
        grantedByUserId: operatorUserId,
      },
    });
  } else {
    await prisma.cavCloudFolderAccess.update({
      where: { id: existing.shareId },
      data: {
        role: folderRoleFromPermission(nextPermission),
        expiresAt: nextExpiresAt,
        grantedByUserId: operatorUserId,
      },
    });
  }

  await emitActivity({
    accountId,
    operatorUserId,
    action: "ACCESS_GRANTED",
    targetType: existing.targetType,
    targetId: existing.targetId,
    targetPath: existing.targetPath,
    metaJson: jsonMeta({
      event: "ACCESS_GRANTED",
      updated: true,
      grantId: existing.shareId,
      recipientUserId: existing.userId,
      permission: nextPermission,
      expiresAtISO: toISO(nextExpiresAt),
    }),
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_GRANTED",
    subjectType: existing.targetType,
    subjectId: existing.targetId,
    label: existing.targetPath,
    meta: {
      event: "ACCESS_GRANTED",
      updated: true,
      grantId: existing.shareId,
      recipientUserId: existing.userId,
      permission: nextPermission,
      expiresAtISO: toISO(nextExpiresAt),
    },
  });

  const openHref = existing.targetType === "file"
    ? buildFileOpenHref(existing.targetPath, existing.targetId)
    : buildFolderOpenHref(existing.targetPath);

  await notifyCavCloudCollabSignal({
    accountId,
    userId: existing.userId,
    kind: existing.targetType === "file"
      ? CAVCLOUD_NOTIFICATION_KINDS.FILE_SHARED_TO_YOU
      : CAVCLOUD_NOTIFICATION_KINDS.FOLDER_SHARED_TO_YOU,
    title: "Shared access updated",
    body: `${existing.targetName} permission changed to ${permissionLabel(nextPermission)}.`,
    href: openHref,
    tone: nextPermission === "EDIT" ? "GOOD" : "WATCH",
    dedupeHours: 1,
    meta: jsonMeta({
      permission: nextPermission,
      permissionLabel: permissionLabel(nextPermission),
      expiresAtISO: toISO(nextExpiresAt),
      ...makeRecipientActionMeta({
        targetType: existing.targetType,
        targetId: existing.targetId,
        grantId: existing.shareId,
        openHref,
        openInCavCodeHref: existing.targetType === "file" && isEditableInCavCode(existing.targetName, existing.targetMimeType)
          ? `/cavcode?cavcloudFileId=${encodeURIComponent(existing.targetId)}`
          : null,
      }),
    }),
  });

  return {
    share: await resolveShareGrantById({ accountId, shareId }),
    accessList: await listTargetAccess({
      accountId,
      targetType: existing.targetType,
      targetId: existing.targetId,
    }),
  };
}

export async function revokeDirectUserShare(input: RevokeShareInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const shareId = s(input.shareId);
  if (!accountId || !operatorUserId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  await ensureManageAccessAllowed(accountId, operatorUserId);
  const existing = await resolveShareGrantById({ accountId, shareId });

  if (existing.targetType === "file") {
    await prisma.$transaction([
      prisma.cavCloudShortcut.deleteMany({
        where: {
          accountId,
          fileAccessId: existing.shareId,
        },
      }),
      prisma.cavCloudFileAccess.delete({
        where: { id: existing.shareId },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.cavCloudShortcut.deleteMany({
        where: {
          accountId,
          folderAccessId: existing.shareId,
        },
      }),
      prisma.cavCloudFolderAccess.delete({
        where: { id: existing.shareId },
      }),
    ]);
  }

  await emitActivity({
    accountId,
    operatorUserId,
    action: "ACCESS_REVOKED",
    targetType: existing.targetType,
    targetId: existing.targetId,
    targetPath: existing.targetPath,
    metaJson: jsonMeta({
      event: "ACCESS_REVOKED",
      grantId: existing.shareId,
      recipientUserId: existing.userId,
    }),
  });

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind: "COLLAB_REVOKED",
    subjectType: existing.targetType,
    subjectId: existing.targetId,
    label: existing.targetPath,
    meta: {
      event: "ACCESS_REVOKED",
      grantId: existing.shareId,
      recipientUserId: existing.userId,
    },
  });

  await notifyCavCloudCollabSignal({
    accountId,
    userId: existing.userId,
    kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_COLLAB_ACCESS_REVOKED,
    title: "Shared access revoked",
    body: `${existing.targetName} access was revoked.`,
    href: "/cavcloud",
    tone: "WATCH",
    dedupeHours: 1,
  });

  return {
    ok: true as const,
    target: {
      type: existing.targetType,
      id: existing.targetId,
      path: existing.targetPath,
    },
    accessList: await listTargetAccess({
      accountId,
      targetType: existing.targetType,
      targetId: existing.targetId,
    }),
  };
}

export async function declineDirectUserShare(input: DeclineShareInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const shareId = s(input.shareId);
  if (!accountId || !operatorUserId || !shareId) throw new ApiAuthError("BAD_REQUEST", 400);

  const existing = await resolveShareGrantById({ accountId, shareId });
  if (existing.userId !== operatorUserId) throw new ApiAuthError("UNAUTHORIZED", 403);

  if (existing.targetType === "file") {
    await prisma.$transaction([
      prisma.cavCloudShortcut.deleteMany({
        where: {
          accountId,
          fileAccessId: existing.shareId,
        },
      }),
      prisma.cavCloudFileAccess.delete({
        where: { id: existing.shareId },
      }),
    ]);
  } else {
    await prisma.$transaction([
      prisma.cavCloudShortcut.deleteMany({
        where: {
          accountId,
          folderAccessId: existing.shareId,
        },
      }),
      prisma.cavCloudFolderAccess.delete({
        where: { id: existing.shareId },
      }),
    ]);
  }

  await emitActivity({
    accountId,
    operatorUserId,
    action: "ACCESS_REVOKED",
    targetType: existing.targetType,
    targetId: existing.targetId,
    targetPath: existing.targetPath,
    metaJson: jsonMeta({
      event: "ACCESS_REVOKED",
      grantId: existing.shareId,
      recipientDeclined: true,
    }),
  });

  return {
    ok: true as const,
    targetType: existing.targetType,
    targetId: existing.targetId,
  };
}

async function maybeLogExpiredAccessEvents(accountId: string, userId: string) {
  const cutoff = new Date(Date.now() - EXPIRED_EVENT_SCAN_WINDOW_MS);
  const recent = await prisma.cavCloudActivity.findFirst({
    where: {
      accountId,
      operatorUserId: userId,
      action: "EXPIRED_ACCESS",
      createdAt: {
        gt: cutoff,
      },
    },
    select: { id: true },
  });
  if (recent?.id) return;

  const now = new Date();
  const [expiredFile, expiredFolder] = await Promise.all([
    prisma.cavCloudFileAccess.findMany({
      where: {
        accountId,
        userId,
        expiresAt: {
          lte: now,
        },
      },
      orderBy: { expiresAt: "desc" },
      take: 20,
      select: {
        id: true,
        fileId: true,
        expiresAt: true,
      },
    }),
    prisma.cavCloudFolderAccess.findMany({
      where: {
        accountId,
        userId,
        expiresAt: {
          lte: now,
        },
      },
      orderBy: { expiresAt: "desc" },
      take: 20,
      select: {
        id: true,
        folderId: true,
        expiresAt: true,
      },
    }),
  ]);

  if (!expiredFile.length && !expiredFolder.length) return;

  const rows: Prisma.CavCloudActivityCreateManyInput[] = [];
  for (const row of expiredFile) {
    rows.push({
      accountId,
      operatorUserId: userId,
      action: "EXPIRED_ACCESS",
      targetType: "file",
      targetId: row.fileId,
      targetPath: null,
      metaJson: jsonMeta({
        grantId: row.id,
        expiresAtISO: toISO(row.expiresAt),
      }),
    });
  }
  for (const row of expiredFolder) {
    rows.push({
      accountId,
      operatorUserId: userId,
      action: "EXPIRED_ACCESS",
      targetType: "folder",
      targetId: row.folderId,
      targetPath: null,
      metaJson: jsonMeta({
        grantId: row.id,
        expiresAtISO: toISO(row.expiresAt),
      }),
    });
  }

  if (rows.length) {
    await prisma.cavCloudActivity.createMany({
      data: rows,
      skipDuplicates: false,
    });
  }
}

export async function listCollabInbox(args: {
  accountId: string;
  operatorUserId: string;
  filter?: CollabFilter;
}) {
  const accountId = s(args.accountId);
  const operatorUserId = s(args.operatorUserId);
  const filter = (s(args.filter) || "all") as CollabFilter;
  if (!accountId || !operatorUserId) throw new ApiAuthError("BAD_REQUEST", 400);

  await assertCavCloudActionAllowed({
    accountId,
    userId: operatorUserId,
    action: "EDIT_FILE_CONTENT",
    neededPermission: "VIEW",
  }).catch(() => {
    // Membership check only.
  });

  await maybeLogExpiredAccessEvents(accountId, operatorUserId).catch(() => {
    // Non-blocking audit enrichment.
  });

  const now = new Date();
  const nowMs = now.getTime();

  const [fileGrants, folderGrants, shortcuts] = await Promise.all([
    prisma.cavCloudFileAccess.findMany({
      where: {
        accountId,
        userId: operatorUserId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        file: {
          deletedAt: null,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        fileId: true,
        permission: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        grantedByUserId: true,
        grantedByUser: {
          select: {
            username: true,
            displayName: true,
          },
        },
        file: {
          select: {
            id: true,
            name: true,
            path: true,
            mimeType: true,
            bytes: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.cavCloudFolderAccess.findMany({
      where: {
        accountId,
        userId: operatorUserId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        folder: {
          deletedAt: null,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        folderId: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        grantedByUserId: true,
        grantedByUser: {
          select: {
            username: true,
            displayName: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.cavCloudShortcut.findMany({
      where: {
        accountId,
        userId: operatorUserId,
      },
      select: {
        targetType: true,
        targetId: true,
      },
    }),
  ]);

  const shortcutSet = new Set(shortcuts.map((row) => `${String(row.targetType).toLowerCase()}:${row.targetId}`));
  const items: CollabItem[] = [];

  for (const row of fileGrants) {
    if (!row.file?.id) continue;
    const expiresAtISO = toISO(row.expiresAt);
    const expiresAtMs = expiresAtISO ? Date.parse(expiresAtISO) : NaN;
    const expiringSoon = Number.isFinite(expiresAtMs) && expiresAtMs - nowMs <= EXPIRING_SOON_MS;

    items.push({
      grantId: row.id,
      targetType: "file",
      targetId: row.fileId,
      name: row.file.name,
      path: row.file.path,
      mimeType: row.file.mimeType || null,
      bytes: typeof row.file.bytes === "bigint" ? Number(row.file.bytes) : Number(row.file.bytes || 0),
      permission: row.permission,
      permissionLabel: permissionLabel(row.permission),
      expiresAtISO,
      expiringSoon,
      sharedBy: {
        userId: row.grantedByUserId,
        username: row.grantedByUser?.username || null,
        displayName: row.grantedByUser?.displayName || null,
      },
      createdAtISO: toISO(row.createdAt) || "",
      updatedAtISO: toISO(row.updatedAt) || "",
      openHref: buildFileOpenHref(row.file.path, row.file.id),
      openInCavCodeHref: isEditableInCavCode(row.file.name, row.file.mimeType)
        ? `/cavcode?cavcloudFileId=${encodeURIComponent(row.file.id)}`
        : null,
      shortcutSaved: shortcutSet.has(`file:${row.file.id}`),
      removeShortcutBody: {
        targetType: "file",
        targetId: row.file.id,
      },
      saveShortcutBody: {
        targetType: "file",
        targetId: row.file.id,
        grantId: row.id,
      },
      declineHref: `/api/cavcloud/shares/user/${encodeURIComponent(row.id)}/decline`,
    });
  }

  for (const row of folderGrants) {
    if (!row.folder?.id) continue;
    const permission = permissionFromFolderRole(row.role);
    const expiresAtISO = toISO(row.expiresAt);
    const expiresAtMs = expiresAtISO ? Date.parse(expiresAtISO) : NaN;
    const expiringSoon = Number.isFinite(expiresAtMs) && expiresAtMs - nowMs <= EXPIRING_SOON_MS;

    items.push({
      grantId: row.id,
      targetType: "folder",
      targetId: row.folderId,
      name: row.folder.name,
      path: row.folder.path,
      mimeType: null,
      bytes: null,
      permission,
      permissionLabel: permissionLabel(permission),
      expiresAtISO,
      expiringSoon,
      sharedBy: {
        userId: row.grantedByUserId,
        username: row.grantedByUser?.username || null,
        displayName: row.grantedByUser?.displayName || null,
      },
      createdAtISO: toISO(row.createdAt) || "",
      updatedAtISO: toISO(row.updatedAt) || "",
      openHref: buildFolderOpenHref(row.folder.path),
      openInCavCodeHref: null,
      shortcutSaved: shortcutSet.has(`folder:${row.folder.id}`),
      removeShortcutBody: {
        targetType: "folder",
        targetId: row.folder.id,
      },
      saveShortcutBody: {
        targetType: "folder",
        targetId: row.folder.id,
        grantId: row.id,
      },
      declineHref: `/api/cavcloud/shares/user/${encodeURIComponent(row.id)}/decline`,
    });
  }

  const filtered = items
    .filter((item) => {
      if (filter === "readonly") return item.permission === "VIEW";
      if (filter === "edit") return item.permission === "EDIT";
      if (filter === "expiringSoon") return item.expiringSoon;
      return true;
    })
    .sort((left, right) => {
      const rightTs = Date.parse(right.updatedAtISO || right.createdAtISO || "") || 0;
      const leftTs = Date.parse(left.updatedAtISO || left.createdAtISO || "") || 0;
      return rightTs - leftTs;
    });

  const summary = {
    total: items.length,
    readonly: items.filter((item) => item.permission === "VIEW").length,
    canEdit: items.filter((item) => item.permission === "EDIT").length,
    expiringSoon: items.filter((item) => item.expiringSoon).length,
  };

  return {
    items: filtered,
    summary,
  };
}

export async function saveCollabShortcut(input: SaveShortcutInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const targetType = parseTargetType(input.targetType);
  const targetId = s(input.targetId);
  const grantId = s(input.grantId || "");
  if (!accountId || !operatorUserId || !targetId) throw new ApiAuthError("BAD_REQUEST", 400);

  const now = new Date();
  if (targetType === "file") {
    const grant = await prisma.cavCloudFileAccess.findFirst({
      where: {
        accountId,
        userId: operatorUserId,
        fileId: targetId,
        ...(grantId ? { id: grantId } : {}),
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        fileId: true,
      },
    });
    if (!grant?.id) throw new ApiAuthError("UNAUTHORIZED", 403);

    const shortcut = await prisma.cavCloudShortcut.upsert({
      where: {
        accountId_userId_targetType_targetId: {
          accountId,
          userId: operatorUserId,
          targetType: "FILE",
          targetId,
        },
      },
      create: {
        accountId,
        userId: operatorUserId,
        targetType: "FILE",
        targetId,
        fileAccessId: grant.id,
      },
      update: {
        fileAccessId: grant.id,
        folderAccessId: null,
      },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        createdAt: true,
      },
    });

    await emitActivity({
      accountId,
      operatorUserId,
      action: "ACCESS_GRANTED",
      targetType: "shortcut",
      targetId: shortcut.id,
      targetPath: null,
      metaJson: jsonMeta({
        shortcut: true,
        targetType: "file",
        targetId,
      }),
    });

    return {
      id: shortcut.id,
      targetType: "file" as const,
      targetId: shortcut.targetId,
      createdAtISO: toISO(shortcut.createdAt),
    };
  }

  const grant = await prisma.cavCloudFolderAccess.findFirst({
    where: {
      accountId,
      userId: operatorUserId,
      folderId: targetId,
      ...(grantId ? { id: grantId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      folderId: true,
    },
  });
  if (!grant?.id) throw new ApiAuthError("UNAUTHORIZED", 403);

  const shortcut = await prisma.cavCloudShortcut.upsert({
    where: {
      accountId_userId_targetType_targetId: {
        accountId,
        userId: operatorUserId,
        targetType: "FOLDER",
        targetId,
      },
    },
    create: {
      accountId,
      userId: operatorUserId,
      targetType: "FOLDER",
      targetId,
      folderAccessId: grant.id,
    },
    update: {
      folderAccessId: grant.id,
      fileAccessId: null,
    },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      createdAt: true,
    },
  });

  await emitActivity({
    accountId,
    operatorUserId,
    action: "ACCESS_GRANTED",
    targetType: "shortcut",
    targetId: shortcut.id,
    targetPath: null,
    metaJson: jsonMeta({
      shortcut: true,
      targetType: "folder",
      targetId,
    }),
  });

  return {
    id: shortcut.id,
    targetType: "folder" as const,
    targetId: shortcut.targetId,
    createdAtISO: toISO(shortcut.createdAt),
  };
}

export async function removeCollabShortcut(input: RemoveShortcutInput) {
  const accountId = s(input.accountId);
  const operatorUserId = s(input.operatorUserId);
  const targetType = parseTargetType(input.targetType);
  const targetId = s(input.targetId);
  if (!accountId || !operatorUserId || !targetId) throw new ApiAuthError("BAD_REQUEST", 400);

  await prisma.cavCloudShortcut.deleteMany({
    where: {
      accountId,
      userId: operatorUserId,
      targetType: targetType === "file" ? "FILE" : "FOLDER",
      targetId,
    },
  });

  await emitActivity({
    accountId,
    operatorUserId,
    action: "ACCESS_REVOKED",
    targetType: "shortcut",
    targetId,
    targetPath: null,
    metaJson: jsonMeta({
      shortcut: true,
      targetType,
      targetId,
    }),
  });

  return { ok: true as const };
}
