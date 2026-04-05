import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { deleteCavcloudObject } from "@/lib/cavcloud/r2.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const LEGACY_WORKSPACE_STATE_ROOT = "/System/CavCode/WorkspaceState";
const legacyCleanupDoneByAccount = new Set<string>();
const legacyCleanupInFlightByAccount = new Map<string, Promise<void>>();
let workspaceStateTableReady = false;

type WorkspaceStateRow = {
  snapshot: unknown;
  updatedAtISO: string | null;
};

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function parseProjectId(raw: unknown): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

async function ensureWorkspaceStateTable() {
  if (workspaceStateTableReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeWorkspaceState" (
      "accountId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "scopeKey" TEXT NOT NULL,
      "projectId" INTEGER NULL,
      "snapshot" JSONB NOT NULL,
      "snapshotBytes" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeWorkspaceState_pkey" PRIMARY KEY ("accountId", "userId", "scopeKey")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeWorkspaceState_account_user_idx"
    ON "CavCodeWorkspaceState" ("accountId", "userId");
  `);
  workspaceStateTableReady = true;
}

async function readWorkspaceState(args: {
  accountId: string;
  userId: string;
  scopeKey: string;
}): Promise<WorkspaceStateRow | null> {
  await ensureWorkspaceStateTable();
  const rows = await prisma.$queryRaw<Array<{ snapshot: unknown; updatedAt: Date | string | null }>>(
    Prisma.sql`
      SELECT
        "snapshot",
        "updatedAt"
      FROM "CavCodeWorkspaceState"
      WHERE "accountId" = ${args.accountId}
        AND "userId" = ${args.userId}
        AND "scopeKey" = ${args.scopeKey}
      LIMIT 1
    `
  );
  const row = rows[0];
  if (!row) return null;
  const updatedAt = row.updatedAt ? new Date(row.updatedAt) : null;
  return {
    snapshot: row.snapshot,
    updatedAtISO: updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt.toISOString() : null,
  };
}

async function writeWorkspaceState(args: {
  accountId: string;
  userId: string;
  scopeKey: string;
  projectId: number | null;
  snapshot: unknown;
  snapshotBytes: number;
}): Promise<void> {
  await ensureWorkspaceStateTable();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeWorkspaceState" (
        "accountId",
        "userId",
        "scopeKey",
        "projectId",
        "snapshot",
        "snapshotBytes"
      ) VALUES (
        ${args.accountId},
        ${args.userId},
        ${args.scopeKey},
        ${args.projectId},
        CAST(${JSON.stringify(args.snapshot)} AS jsonb),
        ${Math.max(0, Math.trunc(args.snapshotBytes))}
      )
      ON CONFLICT ("accountId", "userId", "scopeKey")
      DO UPDATE SET
        "projectId" = EXCLUDED."projectId",
        "snapshot" = EXCLUDED."snapshot",
        "snapshotBytes" = EXCLUDED."snapshotBytes",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
}

function httpErrorStatus(error: unknown): number {
  const status = Number((error as { status?: unknown })?.status || 500);
  return Number.isFinite(status) ? Math.max(400, Math.min(599, Math.trunc(status))) : 500;
}

function isMissingCavCloudTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavcloud")) return true;
  if (msg.includes("relation") && msg.includes("cavcloud")) return true;
  return false;
}

function isWorkspaceStateSchemaMismatch(err: unknown): boolean {
  return isSchemaMismatchError(err, {
    tables: [
      "Project",
      "CavCodeWorkspaceState",
      "CavCloudFolder",
      "CavCloudFile",
      "CavCloudFileVersion",
    ],
    columns: [
      "accountId",
      "isActive",
      "createdAt",
      "scopeKey",
      "snapshot",
      "snapshotBytes",
      "deletedAt",
      "path",
      "r2Key",
      "updatedAt",
      "projectId",
      "userId",
    ],
  });
}

function degradedWorkspaceStateResponse(projectId: number | null = null) {
  return jsonNoStore({
    ok: true,
    degraded: true,
    projectId,
    scopeKey: projectId ? `project_${projectId}` : "project_none",
    snapshot: null,
    storage: "degraded",
    path: null,
    updatedAtISO: null,
  });
}

function shouldDegradeWorkspaceStateError(error: unknown) {
  const status = httpErrorStatus(error);
  return status !== 401 && status !== 403 && status !== 404;
}

async function resolveWorkspaceScope(accountId: string, projectIdInput: number | null) {
  if (projectIdInput) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectIdInput,
        accountId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!project?.id) {
      const error = new Error("Project not found.");
      (error as { status?: number }).status = 404;
      throw error;
    }
    return {
      projectId: project.id,
      scopeKey: `project_${project.id}`,
    };
  }

  const firstProject = await prisma.project.findFirst({
    where: {
      accountId,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: { id: true },
  });

  if (!firstProject?.id) {
    return {
      projectId: null as number | null,
      scopeKey: "project_none",
    };
  }

  return {
    projectId: firstProject.id,
    scopeKey: `project_${firstProject.id}`,
  };
}

async function pruneLegacyAncestorIfEmpty(accountId: string, path: string): Promise<void> {
  const folder = await prisma.cavCloudFolder.findFirst({
    where: {
      accountId,
      path,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!folder?.id) return;

  const [childFolder, childFile] = await Promise.all([
    prisma.cavCloudFolder.findFirst({
      where: {
        accountId,
        parentId: folder.id,
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.cavCloudFile.findFirst({
      where: {
        accountId,
        folderId: folder.id,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);
  if (childFolder?.id || childFile?.id) return;

  await prisma.cavCloudFolder.deleteMany({
    where: { id: folder.id },
  });
}

async function purgeLegacyWorkspaceStateFromCavCloud(accountId: string): Promise<void> {
  const prefix = `${LEGACY_WORKSPACE_STATE_ROOT}/`;

  const files = await prisma.cavCloudFile.findMany({
    where: {
      accountId,
      deletedAt: null,
      path: { startsWith: prefix },
    },
    select: {
      id: true,
      r2Key: true,
    },
  });

  const fileIds = files.map((row) => row.id);
  const versionRows =
    fileIds.length > 0
      ? await prisma.cavCloudFileVersion.findMany({
        where: {
          accountId,
          fileId: { in: fileIds },
        },
        select: {
          r2Key: true,
        },
      })
      : [];

  const objectKeys = Array.from(
    new Set(
      [...files.map((row) => String(row.r2Key || "").trim()), ...versionRows.map((row) => String(row.r2Key || "").trim())].filter(Boolean)
    )
  );
  await Promise.all(
    objectKeys.map(async (objectKey) => {
      try {
        await deleteCavcloudObject(objectKey);
      } catch {
        // best-effort cleanup
      }
    })
  );

  if (fileIds.length > 0) {
    await prisma.cavCloudFile.deleteMany({
      where: {
        accountId,
        id: { in: fileIds },
      },
    });
  }

  const folders = await prisma.cavCloudFolder.findMany({
    where: {
      accountId,
      deletedAt: null,
      OR: [
        { path: LEGACY_WORKSPACE_STATE_ROOT },
        { path: { startsWith: prefix } },
      ],
    },
    select: {
      id: true,
      path: true,
    },
  });

  folders.sort((a, b) => b.path.length - a.path.length);
  for (const folder of folders) {
    await prisma.cavCloudFolder.deleteMany({
      where: {
        id: folder.id,
      },
    });
  }

  await pruneLegacyAncestorIfEmpty(accountId, "/System/CavCode");
  await pruneLegacyAncestorIfEmpty(accountId, "/System");
}

async function ensureLegacyWorkspaceStatePurged(accountId: string): Promise<void> {
  const key = String(accountId || "").trim();
  if (!key) return;
  if (legacyCleanupDoneByAccount.has(key)) return;

  const existingTask = legacyCleanupInFlightByAccount.get(key);
  if (existingTask) {
    await existingTask;
    return;
  }

  const task = (async () => {
    try {
      try {
        await purgeLegacyWorkspaceStateFromCavCloud(key);
      } catch (err) {
        if (!isMissingCavCloudTablesError(err)) throw err;
      }
    } finally {
      legacyCleanupDoneByAccount.add(key);
    }
  })();

  legacyCleanupInFlightByAccount.set(key, task);
  try {
    await task;
  } finally {
    legacyCleanupInFlightByAccount.delete(key);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectIdHint = parseProjectId(url.searchParams.get("projectId") || url.searchParams.get("project"));
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const accountId = s(session.accountId);
    const userId = s(session.sub);
    const scope = await resolveWorkspaceScope(accountId, projectIdHint);
    await ensureLegacyWorkspaceStatePurged(accountId);
    const row = await readWorkspaceState({
      accountId,
      userId,
      scopeKey: scope.scopeKey,
    });

    return jsonNoStore({
      ok: true,
      projectId: scope.projectId,
      scopeKey: scope.scopeKey,
      snapshot: row?.snapshot ?? null,
      storage: "db",
      path: null,
      updatedAtISO: row?.updatedAtISO ?? null,
    });
  } catch (error) {
    if (isWorkspaceStateSchemaMismatch(error)) {
      return degradedWorkspaceStateResponse(projectIdHint);
    }
    if (shouldDegradeWorkspaceStateError(error)) {
      return degradedWorkspaceStateResponse(projectIdHint);
    }
    const status = httpErrorStatus(error);
    const message = error instanceof Error ? error.message : "Failed to read CavCode workspace state.";
    return jsonNoStore(
      {
        ok: false,
        error: status === 404 ? "NOT_FOUND" : status === 401 || status === 403 ? "UNAUTHORIZED" : "READ_FAILED",
        message,
      },
      status
    );
  }
}

type PutBody = {
  snapshot?: unknown;
  projectId?: unknown;
};

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const queryProjectIdHint = parseProjectId(url.searchParams.get("projectId") || url.searchParams.get("project"));
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const accountId = s(session.accountId);
    const userId = s(session.sub);
    const body = (await readSanitizedJson(req, null)) as PutBody | null;
    if (!body || !body.snapshot || typeof body.snapshot !== "object" || Array.isArray(body.snapshot)) {
      return jsonNoStore(
        {
          ok: false,
          error: "INVALID_SNAPSHOT",
          message: "snapshot object is required.",
        },
        400
      );
    }

    const projectIdHint =
      queryProjectIdHint ||
      parseProjectId(body.projectId);
    const scope = await resolveWorkspaceScope(accountId, projectIdHint);

    const payloadText = JSON.stringify(body.snapshot);
    const payloadBytes = Buffer.byteLength(payloadText, "utf8");
    if (!payloadText || payloadBytes <= 2 || payloadBytes > MAX_SNAPSHOT_BYTES) {
      return jsonNoStore(
        {
          ok: false,
          error: "INVALID_SNAPSHOT_SIZE",
          message: `snapshot must be between 3 bytes and ${MAX_SNAPSHOT_BYTES} bytes.`,
        },
        400
      );
    }

    await ensureLegacyWorkspaceStatePurged(accountId);
    await writeWorkspaceState({
      accountId,
      userId,
      scopeKey: scope.scopeKey,
      projectId: scope.projectId,
      snapshot: body.snapshot,
      snapshotBytes: payloadBytes,
    });

    return jsonNoStore({
      ok: true,
      projectId: scope.projectId,
      scopeKey: scope.scopeKey,
      storage: "db",
      path: null,
      updatedAtISO: new Date().toISOString(),
    });
  } catch (error) {
    if (isWorkspaceStateSchemaMismatch(error)) {
      return degradedWorkspaceStateResponse(queryProjectIdHint);
    }
    if (shouldDegradeWorkspaceStateError(error)) {
      return degradedWorkspaceStateResponse(queryProjectIdHint);
    }
    const status = httpErrorStatus(error);
    const message = error instanceof Error ? error.message : "Failed to save CavCode workspace state.";
    return jsonNoStore(
      {
        ok: false,
        error: status === 404 ? "NOT_FOUND" : status === 401 || status === 403 ? "UNAUTHORIZED" : "WRITE_FAILED",
        message,
      },
      status
    );
  }
}
