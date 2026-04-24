import "server-only";

import { getAuthPool } from "@/lib/authDb";
import { isSoftTableAccessError } from "@/lib/dbSchemaGuard";

export type AccountDisciplineStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export type AccountDisciplineState = {
  accountId: string;
  status: AccountDisciplineStatus;
  violationCount: number;
  suspendedUntilISO: string | null;
  suspendedAtISO: string | null;
  suspendedByStaffId: string | null;
  suspensionDays: number | null;
  revokedAtISO: string | null;
  revokedByStaffId: string | null;
  note: string | null;
  updatedAtISO: string;
};

type RawAccountDisciplineRow = {
  accountId: string | null;
  status: string | null;
  violationCount: number | bigint | null;
  suspendedUntil: Date | string | null;
  suspendedAt: Date | string | null;
  suspendedByStaffId: string | null;
  suspensionDays: number | bigint | null;
  revokedAt: Date | string | null;
  revokedByStaffId: string | null;
  note: string | null;
  updatedAt: Date | string | null;
};

type MutateAccountDisciplineArgs = {
  accountId: string;
  actorStaffId?: string | null;
  durationDays?: 7 | 14 | 30;
  note?: string | null;
};

let tableReady = false;

async function getPrismaClient() {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function toInt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const raw = s(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeStatus(value: unknown): AccountDisciplineStatus {
  const raw = s(value).toUpperCase();
  if (raw === "SUSPENDED" || raw === "REVOKED") return raw;
  return "ACTIVE";
}

function normalizeRow(row: RawAccountDisciplineRow | null | undefined): AccountDisciplineState | null {
  if (!row) return null;
  const accountId = s(row.accountId);
  if (!accountId) return null;
  return {
    accountId,
    status: normalizeStatus(row.status),
    violationCount: toInt(row.violationCount),
    suspendedUntilISO: toIso(row.suspendedUntil),
    suspendedAtISO: toIso(row.suspendedAt),
    suspendedByStaffId: s(row.suspendedByStaffId) || null,
    suspensionDays: toInt(row.suspensionDays) || null,
    revokedAtISO: toIso(row.revokedAt),
    revokedByStaffId: s(row.revokedByStaffId) || null,
    note: s(row.note) || null,
    updatedAtISO: toIso(row.updatedAt) || new Date(0).toISOString(),
  };
}

async function ensureAccountDisciplineTable() {
  if (tableReady) return;
  const prisma = await getPrismaClient();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AdminAccountDiscipline" (
      "accountId" TEXT PRIMARY KEY,
      "status" VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
      "violationCount" INTEGER NOT NULL DEFAULT 0,
      "suspendedUntil" TIMESTAMPTZ,
      "suspendedAt" TIMESTAMPTZ,
      "suspendedByStaffId" TEXT,
      "suspensionDays" INTEGER,
      "revokedAt" TIMESTAMPTZ,
      "revokedByStaffId" TEXT,
      "note" TEXT,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AdminAccountDiscipline_status_updatedAt_idx"
    ON "AdminAccountDiscipline"("status", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "AdminAccountDiscipline_suspendedUntil_idx"
    ON "AdminAccountDiscipline"("suspendedUntil");
  `);
  tableReady = true;
}

async function readAccountDisciplineRow(accountId: string) {
  try {
    const result = await getAuthPool().query<RawAccountDisciplineRow>(
      `SELECT
         "accountId",
         "status",
         "violationCount",
         "suspendedUntil",
         "suspendedAt",
         "suspendedByStaffId",
         "suspensionDays",
         "revokedAt",
         "revokedByStaffId",
         "note",
         "updatedAt"
       FROM "AdminAccountDiscipline"
       WHERE "accountId" = $1
       LIMIT 1`,
      [accountId],
    );
    return normalizeRow(result.rows[0]);
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminAccountDiscipline"])) return null;
    throw err;
  }
}

function normalizeExpiredSuspension(
  state: AccountDisciplineState | null,
): AccountDisciplineState | null {
  if (!state || state.status !== "SUSPENDED" || !state.suspendedUntilISO) return state;
  const suspendedUntilMs = new Date(state.suspendedUntilISO).getTime();
  if (!Number.isFinite(suspendedUntilMs) || suspendedUntilMs > Date.now()) return state;
  return {
    ...state,
    status: "ACTIVE",
    suspendedUntilISO: null,
    suspendedAtISO: null,
    suspendedByStaffId: null,
    suspensionDays: null,
  };
}

export async function getAccountDisciplineState(accountIdInput: string): Promise<AccountDisciplineState | null> {
  const accountId = s(accountIdInput);
  if (!accountId) return null;
  return normalizeExpiredSuspension(await readAccountDisciplineRow(accountId));
}

export async function getAccountDisciplineMap(accountIds: string[]) {
  const ids = Array.from(new Set((Array.isArray(accountIds) ? accountIds : []).map((value) => s(value)).filter(Boolean)));
  if (!ids.length) return new Map<string, AccountDisciplineState>();
  let rows: RawAccountDisciplineRow[] = [];
  try {
    rows = (
      await getAuthPool().query<RawAccountDisciplineRow>(
        `SELECT
           "accountId",
           "status",
           "violationCount",
           "suspendedUntil",
           "suspendedAt",
           "suspendedByStaffId",
           "suspensionDays",
           "revokedAt",
           "revokedByStaffId",
           "note",
           "updatedAt"
         FROM "AdminAccountDiscipline"
         WHERE "accountId" = ANY($1::text[])`,
        [ids],
      )
    ).rows;
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminAccountDiscipline"])) {
      return new Map<string, AccountDisciplineState>();
    }
    throw err;
  }

  const out = new Map<string, AccountDisciplineState>();
  for (const row of rows) {
    const normalized = normalizeRow(row);
    if (!normalized) continue;
    if (normalized.status === "SUSPENDED" && normalized.suspendedUntilISO) {
      const suspendedUntilMs = new Date(normalized.suspendedUntilISO).getTime();
      if (Number.isFinite(suspendedUntilMs) && suspendedUntilMs <= Date.now()) {
        continue;
      }
    }
    out.set(normalized.accountId, normalized);
  }
  return out;
}

export async function listAccountDisciplineStates(args?: {
  statuses?: AccountDisciplineStatus[];
  take?: number;
}) {
  const statuses = Array.from(new Set((args?.statuses || []).map((value) => normalizeStatus(value)).filter(Boolean)));
  const take = Math.min(Math.max(toInt(args?.take) || 40, 1), 200);
  let rows: RawAccountDisciplineRow[] = [];
  try {
    rows = statuses.length
      ? (
          await getAuthPool().query<RawAccountDisciplineRow>(
            `SELECT
               "accountId",
               "status",
               "violationCount",
               "suspendedUntil",
               "suspendedAt",
               "suspendedByStaffId",
               "suspensionDays",
               "revokedAt",
               "revokedByStaffId",
               "note",
               "updatedAt"
             FROM "AdminAccountDiscipline"
             WHERE "status" = ANY($1::text[])
             ORDER BY "updatedAt" DESC
             LIMIT $2`,
            [statuses, take],
          )
        ).rows
      : (
          await getAuthPool().query<RawAccountDisciplineRow>(
            `SELECT
               "accountId",
               "status",
               "violationCount",
               "suspendedUntil",
               "suspendedAt",
               "suspendedByStaffId",
               "suspensionDays",
               "revokedAt",
               "revokedByStaffId",
               "note",
               "updatedAt"
             FROM "AdminAccountDiscipline"
             ORDER BY "updatedAt" DESC
             LIMIT $1`,
            [take],
          )
        ).rows;
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminAccountDiscipline"])) return [];
    throw err;
  }

  return rows.map((row) => normalizeRow(row)).filter((row): row is AccountDisciplineState => Boolean(row));
}

export async function suspendAccount(args: MutateAccountDisciplineArgs): Promise<{
  state: AccountDisciplineState | null;
  escalatedToRevoke: boolean;
}> {
  const accountId = s(args.accountId);
  const actorStaffId = s(args.actorStaffId) || null;
  if (!accountId || !args.durationDays) {
    return { state: null, escalatedToRevoke: false };
  }
  const current = await getAccountDisciplineState(accountId);
  const nextViolationCount = Math.max(0, current?.violationCount || 0) + 1;
  if (current?.status === "REVOKED" || nextViolationCount >= 3) {
    const revoked = await revokeAccount({
      accountId,
      actorStaffId,
      note: args.note,
      violationCount: nextViolationCount,
    });
    return { state: revoked, escalatedToRevoke: true };
  }

  const now = new Date();
  const suspendedUntil = new Date(now.getTime() + args.durationDays * 24 * 60 * 60 * 1000);
  await ensureAccountDisciplineTable();
  const prisma = await getPrismaClient();
  const { Prisma } = await import("@prisma/client");
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "AdminAccountDiscipline" (
        "accountId",
        "status",
        "violationCount",
        "suspendedUntil",
        "suspendedAt",
        "suspendedByStaffId",
        "suspensionDays",
        "revokedAt",
        "revokedByStaffId",
        "note",
        "updatedAt"
      )
      VALUES (
        ${accountId},
        'SUSPENDED',
        ${nextViolationCount},
        ${suspendedUntil.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz,
        ${actorStaffId},
        ${args.durationDays},
        NULL,
        NULL,
        ${s(args.note) || null},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("accountId")
      DO UPDATE SET
        "status" = 'SUSPENDED',
        "violationCount" = ${nextViolationCount},
        "suspendedUntil" = ${suspendedUntil.toISOString()}::timestamptz,
        "suspendedAt" = ${now.toISOString()}::timestamptz,
        "suspendedByStaffId" = ${actorStaffId},
        "suspensionDays" = ${args.durationDays},
        "revokedAt" = NULL,
        "revokedByStaffId" = NULL,
        "note" = ${s(args.note) || null},
        "updatedAt" = CURRENT_TIMESTAMP
    `,
  );
  return {
    state: await readAccountDisciplineRow(accountId),
    escalatedToRevoke: false,
  };
}

export async function restoreAccount(args: {
  accountId: string;
  actorStaffId?: string | null;
  note?: string | null;
}): Promise<AccountDisciplineState | null> {
  const accountId = s(args.accountId);
  if (!accountId) return null;
  const current = await readAccountDisciplineRow(accountId);
  if (!current) return null;
  await ensureAccountDisciplineTable();
  const prisma = await getPrismaClient();
  const { Prisma } = await import("@prisma/client");
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "AdminAccountDiscipline"
      SET
        "status" = 'ACTIVE',
        "suspendedUntil" = NULL,
        "suspendedAt" = NULL,
        "suspendedByStaffId" = NULL,
        "suspensionDays" = NULL,
        "revokedAt" = NULL,
        "revokedByStaffId" = NULL,
        "note" = ${s(args.note) || current.note || null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${accountId}
    `,
  );
  return readAccountDisciplineRow(accountId);
}

export async function revokeAccount(args: {
  accountId: string;
  actorStaffId?: string | null;
  note?: string | null;
  violationCount?: number;
}): Promise<AccountDisciplineState | null> {
  const accountId = s(args.accountId);
  const actorStaffId = s(args.actorStaffId) || null;
  if (!accountId) return null;
  const current = await readAccountDisciplineRow(accountId);
  const nextViolationCount = Math.max(3, toInt(args.violationCount) || toInt(current?.violationCount));
  await ensureAccountDisciplineTable();
  const prisma = await getPrismaClient();
  const { Prisma } = await import("@prisma/client");
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "AdminAccountDiscipline" (
        "accountId",
        "status",
        "violationCount",
        "suspendedUntil",
        "suspendedAt",
        "suspendedByStaffId",
        "suspensionDays",
        "revokedAt",
        "revokedByStaffId",
        "note",
        "updatedAt"
      )
      VALUES (
        ${accountId},
        'REVOKED',
        ${nextViolationCount},
        NULL,
        NULL,
        NULL,
        NULL,
        CURRENT_TIMESTAMP,
        ${actorStaffId},
        ${s(args.note) || current?.note || null},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("accountId")
      DO UPDATE SET
        "status" = 'REVOKED',
        "violationCount" = ${nextViolationCount},
        "suspendedUntil" = NULL,
        "suspendedAt" = NULL,
        "suspendedByStaffId" = NULL,
        "suspensionDays" = NULL,
        "revokedAt" = CURRENT_TIMESTAMP,
        "revokedByStaffId" = ${actorStaffId},
        "note" = ${s(args.note) || current?.note || null},
        "updatedAt" = CURRENT_TIMESTAMP
    `,
  );
  return readAccountDisciplineRow(accountId);
}
