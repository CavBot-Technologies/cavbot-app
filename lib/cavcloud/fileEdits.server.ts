import "server-only";

import type { Prisma } from "@prisma/client";

import { ApiAuthError } from "@/lib/apiAuth";
import { CAVCLOUD_NOTIFICATION_KINDS } from "@/lib/notificationKinds";
import { prisma } from "@/lib/prisma";
import { notifyCavCloudCollabSignal } from "@/lib/cavcloud/notifications.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import {
  CavCloudError,
  listFileVersions,
  replaceFileContent,
  restoreFileVersion,
} from "@/lib/cavcloud/storage.server";

function toMetaJson(meta: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  return meta as Prisma.JsonObject;
}

async function writeEditActivity(args: {
  accountId: string;
  operatorUserId: string;
  action: "EDIT_SAVED" | "EDIT_CONFLICT" | "FAILED_EDIT_ATTEMPT";
  fileId: string;
  meta?: Record<string, unknown> | null;
}) {
  try {
    await prisma.cavCloudActivity.create({
      data: {
        accountId: args.accountId,
        operatorUserId: args.operatorUserId || null,
        action: args.action,
        targetType: "file",
        targetId: args.fileId,
        targetPath: null,
        metaJson: toMetaJson(args.meta),
      },
    });
  } catch {
    // Activity writes must never block save/restore.
  }
}

type SaveFileArgs = {
  accountId: string;
  userId: string;
  fileId: string;
  mimeType?: string | null;
  body: Uint8Array | Buffer;
  generateTextSnippets?: boolean;
  baseSha256?: string | null;
};

export async function saveCavCloudFileContent(args: SaveFileArgs) {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const fileId = String(args.fileId || "").trim();

  try {
    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "EDIT_FILE_CONTENT",
      resourceType: "FILE",
      resourceId: fileId,
      neededPermission: "EDIT",
      errorCode: "FILE_EDIT_DENIED",
    });
  } catch (err) {
    await writeEditActivity({
      accountId,
      operatorUserId: userId,
      action: "FAILED_EDIT_ATTEMPT",
      fileId,
      meta: {
        reason: "permission",
      },
    });

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "FILE_EDIT_DENIED",
      subjectType: "file",
      subjectId: fileId,
      label: "File edit denied",
      meta: {
        reason: "permission",
      },
    });

    await notifyCavCloudCollabSignal({
      accountId,
      userId,
      kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_FILE_EDIT_DENIED,
      title: "Edit denied",
      body: "You do not have permission to edit this file.",
      href: "/cavcloud",
      tone: "BAD",
      dedupeHours: 1,
    });

    throw err;
  }

  try {
    const file = await replaceFileContent({
      accountId,
      operatorUserId: userId,
      fileId,
      mimeType: args.mimeType || null,
      body: args.body,
      generateTextSnippets: args.generateTextSnippets,
      baseSha256: args.baseSha256 || null,
    });

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "FILE_EDIT_SAVED",
      subjectType: "file",
      subjectId: fileId,
      label: "File edit saved",
      meta: {
        sha256: file.sha256,
        versionNumber: Number((file as { versionNumber?: unknown }).versionNumber || 0) || null,
        changed: Boolean((file as { changed?: unknown }).changed),
      },
    });
    await writeEditActivity({
      accountId,
      operatorUserId: userId,
      action: "EDIT_SAVED",
      fileId,
      meta: {
        sha256: file.sha256,
        versionNumber: Number((file as { versionNumber?: unknown }).versionNumber || 0) || null,
      },
    });

    return file;
  } catch (err) {
    if (err instanceof CavCloudError && err.code === "FILE_EDIT_CONFLICT") {
      await writeCavCloudOperationLog({
        accountId,
        operatorUserId: userId,
        kind: "FILE_EDIT_CONFLICT",
        subjectType: "file",
        subjectId: fileId,
        label: "File edit conflict",
        meta: {
          latestSha256: (err as CavCloudError & { latestSha256?: string }).latestSha256 || null,
          latestVersionNumber:
            Number((err as CavCloudError & { latestVersionNumber?: unknown }).latestVersionNumber || 0) || null,
        },
      });
      await writeEditActivity({
        accountId,
        operatorUserId: userId,
        action: "EDIT_CONFLICT",
        fileId,
        meta: {
          latestSha256: (err as CavCloudError & { latestSha256?: string }).latestSha256 || null,
          latestVersionNumber:
            Number((err as CavCloudError & { latestVersionNumber?: unknown }).latestVersionNumber || 0) || null,
        },
      });

      await notifyCavCloudCollabSignal({
        accountId,
        userId,
        kind: CAVCLOUD_NOTIFICATION_KINDS.CLOUD_FILE_EDIT_CONFLICT,
        title: "Edit conflict",
        body: "Your copy is outdated. Refresh this file and retry.",
        href: "/cavcloud",
        tone: "WATCH",
        dedupeHours: 1,
      });
    }

    throw err;
  }
}

type VersionListArgs = {
  accountId: string;
  userId: string;
  fileId: string;
  limit?: number;
  offset?: number;
};

export async function listCavCloudFileVersions(args: VersionListArgs) {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const fileId = String(args.fileId || "").trim();

  await assertCavCloudActionAllowed({
    accountId,
    userId,
    action: "EDIT_FILE_CONTENT",
    resourceType: "FILE",
    resourceId: fileId,
    neededPermission: "VIEW",
    errorCode: "UNAUTHORIZED",
  });

  return listFileVersions({
    accountId,
    fileId,
    limit: args.limit,
    offset: args.offset,
  });
}

type RestoreVersionArgs = {
  accountId: string;
  userId: string;
  fileId: string;
  versionId: string;
  baseSha256?: string | null;
};

export async function restoreCavCloudFileVersion(args: RestoreVersionArgs) {
  const accountId = String(args.accountId || "").trim();
  const userId = String(args.userId || "").trim();
  const fileId = String(args.fileId || "").trim();

  await assertCavCloudActionAllowed({
    accountId,
    userId,
    action: "EDIT_FILE_CONTENT",
    resourceType: "FILE",
    resourceId: fileId,
    neededPermission: "EDIT",
    errorCode: "FILE_EDIT_DENIED",
  });

  try {
    const file = await restoreFileVersion({
      accountId,
      operatorUserId: userId,
      fileId,
      versionId: args.versionId,
      baseSha256: args.baseSha256 || null,
    });

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "FILE_EDIT_SAVED",
      subjectType: "file",
      subjectId: fileId,
      label: "File version restored",
      meta: {
        restoredFromVersionId: args.versionId,
        versionNumber: Number((file as { versionNumber?: unknown }).versionNumber || 0) || null,
      },
    });
    await writeEditActivity({
      accountId,
      operatorUserId: userId,
      action: "EDIT_SAVED",
      fileId,
      meta: {
        restoredFromVersionId: args.versionId,
        versionNumber: Number((file as { versionNumber?: unknown }).versionNumber || 0) || null,
      },
    });

    return file;
  } catch (err) {
    if (err instanceof CavCloudError && err.code === "FILE_EDIT_CONFLICT") {
      await writeCavCloudOperationLog({
        accountId,
        operatorUserId: userId,
        kind: "FILE_EDIT_CONFLICT",
        subjectType: "file",
        subjectId: fileId,
        label: "File restore conflict",
      });
      await writeEditActivity({
        accountId,
        operatorUserId: userId,
        action: "EDIT_CONFLICT",
        fileId,
      });
    }
    if (err instanceof ApiAuthError && err.status === 403) {
      await writeCavCloudOperationLog({
        accountId,
        operatorUserId: userId,
        kind: "FILE_EDIT_DENIED",
        subjectType: "file",
        subjectId: fileId,
        label: "File restore denied",
      });
      await writeEditActivity({
        accountId,
        operatorUserId: userId,
        action: "FAILED_EDIT_ATTEMPT",
        fileId,
        meta: {
          reason: "permission",
        },
      });
    }
    throw err;
  }
}
