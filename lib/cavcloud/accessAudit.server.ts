import "server-only";

import type { CavCloudOperationKind, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getCavCloudOperatorContext } from "@/lib/cavcloud/permissions.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";

type AccessFileEventKind = "FILE_OPENED" | "FILE_DOWNLOADED";

function trimPath(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.slice(0, 900);
}

function buildMeta(args: {
  fileId: string;
  filePath?: string | null;
  source?: string | null;
  extra?: Prisma.InputJsonValue;
}): Prisma.InputJsonValue {
  const meta: Record<string, unknown> = {
    fileId: args.fileId,
    scope: "ACCESS",
  };
  const filePath = trimPath(args.filePath);
  if (filePath) meta.path = filePath;
  const source = String(args.source || "").trim();
  if (source) meta.source = source.slice(0, 64);
  if (args.extra && typeof args.extra === "object" && !Array.isArray(args.extra)) {
    Object.assign(meta, args.extra as Record<string, unknown>);
  }
  return meta as Prisma.InputJsonValue;
}

async function operatorIsOwner(accountId: string, operatorUserId: string): Promise<boolean> {
  try {
    const operator = await getCavCloudOperatorContext({
      accountId,
      userId: operatorUserId,
    });
    return operator.role === "OWNER";
  } catch {
    return false;
  }
}

export async function writeCavCloudFileAccessEvent(args: {
  accountId: string;
  operatorUserId: string;
  fileId: string;
  filePath?: string | null;
  kind: AccessFileEventKind;
  source?: string | null;
  dedupeWithinMinutes?: number;
  meta?: Prisma.InputJsonValue;
}) {
  const accountId = String(args.accountId || "").trim();
  const operatorUserId = String(args.operatorUserId || "").trim();
  const fileId = String(args.fileId || "").trim();
  if (!accountId || !operatorUserId || !fileId) return;

  // Access intelligence is collaborator-focused, so owner reads are intentionally suppressed.
  if (await operatorIsOwner(accountId, operatorUserId)) return;

  const kind: CavCloudOperationKind = args.kind;

  const dedupeMinutes = Math.max(0, Math.trunc(Number(args.dedupeWithinMinutes || 0)));
  if (kind === "FILE_OPENED" && dedupeMinutes > 0) {
    try {
      const since = new Date(Date.now() - dedupeMinutes * 60 * 1000);
      const existing = await prisma.cavCloudOperationLog.findFirst({
        where: {
          accountId,
          operatorUserId,
          kind,
          subjectType: "file",
          subjectId: fileId,
          createdAt: { gte: since },
        },
        select: { id: true },
      });
      if (existing?.id) return;
    } catch {
      // Fail-open: dedupe probe should never block event writes.
    }
  }

  await writeCavCloudOperationLog({
    accountId,
    operatorUserId,
    kind,
    subjectType: "file",
    subjectId: fileId,
    label: trimPath(args.filePath) || fileId,
    meta: buildMeta({
      fileId,
      filePath: args.filePath,
      source: args.source,
      extra: args.meta,
    }),
  });
}
