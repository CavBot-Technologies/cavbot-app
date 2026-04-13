import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

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

let tableReady = false;

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
  await ensureAccountDisciplineTable();

  const rows = await prisma.$queryRaw<RawAccountDisciplineRow[]>(
    Prisma.sql`
      SELECT
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
      WHERE "accountId" = ${accountId}
      LIMIT 1
    `,
  );

  return normalizeRow(rows[0]);
}

export async function getAccountDisciplineState(accountIdInput: string): Promise<AccountDisciplineState | null> {
  const accountId = s(accountIdInput);
  if (!accountId) return null;

  const current = await readAccountDisciplineRow(accountId);
  if (!current) return null;
  if (current.status !== "SUSPENDED" || !current.suspendedUntilISO) return current;

  const suspendedUntilMs = new Date(current.suspendedUntilISO).getTime();
  if (!Number.isFinite(suspendedUntilMs) || suspendedUntilMs > Date.now()) return current;

  await ensureAccountDisciplineTable();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "AdminAccountDiscipline"
      SET
        "status" = 'ACTIVE',
        "suspendedUntil" = NULL,
        "suspendedAt" = NULL,
        "suspendedByStaffId" = NULL,
        "suspensionDays" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${accountId}
    `,
  );

  return readAccountDisciplineRow(accountId);
}
