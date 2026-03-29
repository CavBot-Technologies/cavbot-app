import "server-only";

import type { CavCloudOperationKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type OperationSubjectType =
  | "file"
  | "folder"
  | "share"
  | "artifact"
  | "project"
  | "collab_request"
  | "contributor_link"
  | "integration"
  | "import_session"
  | "import_item";

function isMissingOperationLogTableError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  return msg.includes("cavcloudoperationlog") && (msg.includes("does not exist") || msg.includes("relation"));
}

function trimLabel(value: string): string {
  const input = String(value || "").trim();
  if (!input) return "CavCloud operation";
  if (input.length <= 220) return input;
  return input.slice(0, 220);
}

export async function writeCavCloudOperationLog(args: {
  accountId: string;
  operatorUserId?: string | null;
  kind: CavCloudOperationKind;
  subjectType: OperationSubjectType;
  subjectId: string;
  label: string;
  meta?: Prisma.InputJsonValue;
}) {
  const accountId = String(args.accountId || "").trim();
  const subjectId = String(args.subjectId || "").trim();
  if (!accountId || !subjectId) return;

  try {
    await prisma.cavCloudOperationLog.create({
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
    // Fail-open: operation logging must never block user actions.
    if (isMissingOperationLogTableError(err)) return;
  }
}
