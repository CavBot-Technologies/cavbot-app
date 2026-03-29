import "server-only";

import type { CavSafeOperationKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type OperationSubjectType = "file" | "folder" | "share" | "artifact" | "snapshot" | "system";

const BASIC_ACTIVITY_KINDS: CavSafeOperationKind[] = [
  "CREATE_FOLDER",
  "UPLOAD_FILE",
  "MOVE",
  "RENAME",
  "DELETE",
  "RESTORE",
  "MOVE_IN",
  "MOVE_OUT",
  "PUBLISH_ARTIFACT",
];

function isMissingOperationLogTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavsafeoperationlog") && (msg.includes("does not exist") || msg.includes("relation"));
}

function trimLabel(value: string): string {
  const input = String(value || "").trim();
  if (!input) return "CavSafe operation";
  if (input.length <= 220) return input;
  return input.slice(0, 220);
}

export function cavsafeBasicOperationKinds(): CavSafeOperationKind[] {
  return [...BASIC_ACTIVITY_KINDS];
}

export function inferCavsafeOperationKindFromActivity(args: {
  action: string;
  targetType: string;
  meta?: Record<string, unknown> | null;
}): CavSafeOperationKind | null {
  const action = String(args.action || "").trim().toLowerCase();
  const targetType = String(args.targetType || "").trim().toLowerCase();
  const meta = args.meta || null;

  if (action === "folder.create") return "CREATE_FOLDER";
  if (
    action === "file.upload.simple"
    || action === "file.upload.multipart.complete"
    || action === "file.metadata.create"
    || action === "file.zip"
    || action === "folder.zip"
    || action === "upload.files"
    || action === "upload.folder"
  ) {
    return "UPLOAD_FILE";
  }
  if (action === "file.delete" || action === "folder.delete" || action === "trash.permanent_delete") {
    return "DELETE";
  }
  if (action === "trash.restore") return "RESTORE";
  if (action === "share.create" || action === "share.revoke" || action === "share.unshare") {
    return "SHARE_ATTEMPT";
  }
  if (action === "file.update" || action === "folder.update") {
    const fromPath = String(meta?.fromPath || "").trim();
    const toPath = String(meta?.toPath || "").trim();
    const fromParentId = String(meta?.fromParentId || "").trim();
    const toParentId = String(meta?.toParentId || "").trim();
    const moved = !!((fromPath && toPath && fromPath !== toPath) || (fromParentId && toParentId && fromParentId !== toParentId));
    return moved ? "MOVE" : "RENAME";
  }
  if (targetType === "share") return "SHARE_ATTEMPT";
  return null;
}

export async function writeCavSafeOperationLog(args: {
  accountId: string;
  operatorUserId?: string | null;
  kind: CavSafeOperationKind;
  subjectType: OperationSubjectType;
  subjectId: string;
  label: string;
  meta?: Prisma.InputJsonValue;
}) {
  const accountId = String(args.accountId || "").trim();
  const subjectId = String(args.subjectId || "").trim();
  if (!accountId || !subjectId) return;

  try {
    await prisma.cavSafeOperationLog.create({
      data: {
        accountId,
        operatorUserId: String(args.operatorUserId || "").trim() || null,
        kind: args.kind,
        subjectType: args.subjectType,
        subjectId,
        label: trimLabel(args.label),
        meta: args.meta,
      },
    });
  } catch (err) {
    if (isMissingOperationLogTableError(err)) return;
  }
}

