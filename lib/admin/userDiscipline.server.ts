import "server-only";

import type { AdminDisciplineStatus, Prisma } from "@prisma/client";

import { getAuthPool } from "@/lib/authDb";
import { isSoftTableAccessError } from "@/lib/dbSchemaGuard";
import { prisma } from "@/lib/prisma";

export type UserDisciplineStatus = AdminDisciplineStatus;

export type UserDisciplineState = {
  userId: string;
  status: UserDisciplineStatus;
  violationCount: number;
  suspendedUntilISO: string | null;
  suspendedAtISO: string | null;
  suspendedByStaffId: string | null;
  suspensionDays: number | null;
  revokedAtISO: string | null;
  revokedByStaffId: string | null;
  lastRecoveryResetAtISO: string | null;
  lastSessionKillAtISO: string | null;
  lastIdentityReviewAtISO: string | null;
  lastIdentityReviewById: string | null;
  note: string | null;
  metadata: Record<string, unknown> | null;
  updatedAtISO: string;
};

const userDisciplineStateSelect = {
  userId: true,
  status: true,
  violationCount: true,
  suspendedUntil: true,
  suspendedAt: true,
  suspendedByStaffId: true,
  suspensionDays: true,
  revokedAt: true,
  revokedByStaffId: true,
  lastRecoveryResetAt: true,
  lastSessionKillAt: true,
  lastIdentityReviewAt: true,
  lastIdentityReviewById: true,
  note: true,
  metadataJson: true,
  updatedAt: true,
} satisfies Prisma.AdminUserDisciplineSelect;

type UserDisciplineRow = Prisma.AdminUserDisciplineGetPayload<{
  select: typeof userDisciplineStateSelect;
}>;

type RawUserDisciplineRow = {
  userId: string;
  status: UserDisciplineStatus;
  violationCount: number | bigint | null;
  suspendedUntil: Date | string | null;
  suspendedAt: Date | string | null;
  suspendedByStaffId: string | null;
  suspensionDays: number | bigint | null;
  revokedAt: Date | string | null;
  revokedByStaffId: string | null;
  lastRecoveryResetAt: Date | string | null;
  lastSessionKillAt: Date | string | null;
  lastIdentityReviewAt: Date | string | null;
  lastIdentityReviewById: string | null;
  note: string | null;
  metadataJson: unknown;
  updatedAt: Date | string;
};

type UserDisciplineSerializableRow = UserDisciplineRow | RawUserDisciplineRow;

type MutateUserDisciplineArgs = {
  userId: string;
  actorStaffId?: string | null;
  durationDays?: 7 | 14 | 30;
  note?: string | null;
};

function safeId(value: unknown) {
  return String(value || "").trim();
}

function safeNote(value: unknown) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized.slice(0, 2000) : null;
}

function toISO(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function serializeState(
  row: UserDisciplineSerializableRow | null,
): UserDisciplineState | null {
  if (!row?.userId) return null;
  return {
    userId: row.userId,
    status: row.status,
    violationCount: Math.max(0, Number(row.violationCount || 0)),
    suspendedUntilISO: toISO(row.suspendedUntil),
    suspendedAtISO: toISO(row.suspendedAt),
    suspendedByStaffId: safeId(row.suspendedByStaffId) || null,
    suspensionDays: Number.isFinite(Number(row.suspensionDays)) ? Number(row.suspensionDays) : null,
    revokedAtISO: toISO(row.revokedAt),
    revokedByStaffId: safeId(row.revokedByStaffId) || null,
    lastRecoveryResetAtISO: toISO(row.lastRecoveryResetAt),
    lastSessionKillAtISO: toISO(row.lastSessionKillAt),
    lastIdentityReviewAtISO: toISO(row.lastIdentityReviewAt),
    lastIdentityReviewById: safeId(row.lastIdentityReviewById) || null,
    note: row.note || null,
    metadata: asRecord(row.metadataJson),
    updatedAtISO: toISO(row.updatedAt) || new Date(0).toISOString(),
  };
}

function mergeMetadata(
  current: Prisma.JsonValue | null | undefined,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  return {
    ...(asRecord(current) || {}),
    ...patch,
  } as Prisma.InputJsonValue;
}

async function readRow(userId: string) {
  try {
    const result = await getAuthPool().query<RawUserDisciplineRow>(
      `SELECT
         "userId",
         "status",
         "violationCount",
         "suspendedUntil",
         "suspendedAt",
         "suspendedByStaffId",
         "suspensionDays",
         "revokedAt",
         "revokedByStaffId",
         "lastRecoveryResetAt",
         "lastSessionKillAt",
         "lastIdentityReviewAt",
         "lastIdentityReviewById",
         "note",
         "metadataJson",
         "updatedAt"
       FROM "AdminUserDiscipline"
       WHERE "userId" = $1
       LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminUserDiscipline"])) return null;
    throw err;
  }
}

function normalizeExpiredSuspension(
  state: UserDisciplineState | null,
): UserDisciplineState | null {
  if (!state || state.status !== "SUSPENDED" || !state.suspendedUntilISO) return state;
  if (new Date(state.suspendedUntilISO).getTime() > Date.now()) return state;
  return {
    ...state,
    status: "ACTIVE",
    suspendedUntilISO: null,
    suspendedAtISO: null,
    suspendedByStaffId: null,
    suspensionDays: null,
  };
}

export async function getUserDisciplineState(userIdInput: string): Promise<UserDisciplineState | null> {
  const userId = safeId(userIdInput);
  if (!userId) return null;
  return normalizeExpiredSuspension(serializeState(await readRow(userId)));
}

export async function getUserDisciplineMap(userIdsInput: string[]) {
  const userIds = Array.from(new Set((Array.isArray(userIdsInput) ? userIdsInput : []).map((value) => safeId(value)).filter(Boolean)));
  if (!userIds.length) return new Map<string, UserDisciplineState>();
  let rows: RawUserDisciplineRow[] = [];
  try {
    rows = (
      await getAuthPool().query<RawUserDisciplineRow>(
        `SELECT
           "userId",
           "status",
           "violationCount",
           "suspendedUntil",
           "suspendedAt",
           "suspendedByStaffId",
           "suspensionDays",
           "revokedAt",
           "revokedByStaffId",
           "lastRecoveryResetAt",
           "lastSessionKillAt",
           "lastIdentityReviewAt",
           "lastIdentityReviewById",
           "note",
           "metadataJson",
           "updatedAt"
         FROM "AdminUserDiscipline"
         WHERE "userId" = ANY($1::text[])`,
        [userIds],
      )
    ).rows;
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminUserDiscipline"])) {
      return new Map<string, UserDisciplineState>();
    }
    throw err;
  }

  const out = new Map<string, UserDisciplineState>();
  for (const row of rows) {
    const state = serializeState(row);
    if (!state) continue;
    if (state.status === "SUSPENDED" && state.suspendedUntilISO) {
      const untilMs = new Date(state.suspendedUntilISO).getTime();
      if (Number.isFinite(untilMs) && untilMs <= Date.now()) continue;
    }
    out.set(state.userId, state);
  }
  return out;
}

export async function listUserDisciplineStates(args?: {
  statuses?: UserDisciplineStatus[];
  take?: number;
}) {
  const statuses = Array.from(new Set((args?.statuses || []).filter(Boolean)));
  const take = Math.min(Math.max(Number(args?.take) || 40, 1), 200);
  let rows: RawUserDisciplineRow[] = [];
  try {
    rows = statuses.length
      ? (
          await getAuthPool().query<RawUserDisciplineRow>(
            `SELECT
               "userId",
               "status",
               "violationCount",
               "suspendedUntil",
               "suspendedAt",
               "suspendedByStaffId",
               "suspensionDays",
               "revokedAt",
               "revokedByStaffId",
               "lastRecoveryResetAt",
               "lastSessionKillAt",
               "lastIdentityReviewAt",
               "lastIdentityReviewById",
               "note",
               "metadataJson",
               "updatedAt"
             FROM "AdminUserDiscipline"
             WHERE "status" = ANY($1::text[])
             ORDER BY "updatedAt" DESC
             LIMIT $2`,
            [statuses, take],
          )
        ).rows
      : (
          await getAuthPool().query<RawUserDisciplineRow>(
            `SELECT
               "userId",
               "status",
               "violationCount",
               "suspendedUntil",
               "suspendedAt",
               "suspendedByStaffId",
               "suspensionDays",
               "revokedAt",
               "revokedByStaffId",
               "lastRecoveryResetAt",
               "lastSessionKillAt",
               "lastIdentityReviewAt",
               "lastIdentityReviewById",
               "note",
               "metadataJson",
               "updatedAt"
             FROM "AdminUserDiscipline"
             ORDER BY "updatedAt" DESC
             LIMIT $1`,
            [take],
          )
        ).rows;
  } catch (err) {
    if (isSoftTableAccessError(err, ["AdminUserDiscipline"])) return [];
    throw err;
  }

  return rows.map((row) => serializeState(row)).filter((row): row is UserDisciplineState => Boolean(row));
}

export async function suspendUser(args: MutateUserDisciplineArgs): Promise<{
  state: UserDisciplineState | null;
  escalatedToRevoke: boolean;
}> {
  const userId = safeId(args.userId);
  const actorStaffId = safeId(args.actorStaffId) || null;
  if (!userId || !args.durationDays) return { state: null, escalatedToRevoke: false };

  const current = await getUserDisciplineState(userId);
  const nextViolationCount = Math.max(0, current?.violationCount || 0) + 1;
  if (current?.status === "REVOKED" || nextViolationCount >= 3) {
    const revoked = await revokeUser({
      userId,
      actorStaffId,
      note: args.note,
      violationCount: nextViolationCount,
    });
    return { state: revoked, escalatedToRevoke: true };
  }

  const now = new Date();
  const suspendedUntil = new Date(now.getTime() + args.durationDays * 24 * 60 * 60 * 1000);
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      status: "SUSPENDED",
      violationCount: nextViolationCount,
      suspendedUntil,
      suspendedAt: now,
      suspendedByStaffId: actorStaffId,
      suspensionDays: args.durationDays,
      revokedAt: null,
      revokedByStaffId: null,
      note: safeNote(args.note),
      metadataJson: mergeMetadata(current?.metadata as Prisma.JsonValue, {
        lastAction: "suspend",
      }),
    },
    create: {
      userId,
      status: "SUSPENDED",
      violationCount: nextViolationCount,
      suspendedUntil,
      suspendedAt: now,
      suspendedByStaffId: actorStaffId,
      suspensionDays: args.durationDays,
      note: safeNote(args.note),
      metadataJson: { lastAction: "suspend" },
    },
    select: userDisciplineStateSelect,
  });

  return { state: serializeState(row), escalatedToRevoke: false };
}

export async function restoreUser(args: { userId: string; actorStaffId?: string | null; note?: string | null }) {
  const userId = safeId(args.userId);
  if (!userId) return null;
  const current = await readRow(userId);
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      status: "ACTIVE",
      suspendedUntil: null,
      suspendedAt: null,
      suspendedByStaffId: null,
      suspensionDays: null,
      note: safeNote(args.note),
      metadataJson: mergeMetadata(current?.metadataJson, {
        lastAction: "restore",
        lastRestoredByStaffId: safeId(args.actorStaffId) || null,
      }),
    },
    create: {
      userId,
      status: "ACTIVE",
      note: safeNote(args.note),
      metadataJson: {
        lastAction: "restore",
        lastRestoredByStaffId: safeId(args.actorStaffId) || null,
      },
    },
    select: userDisciplineStateSelect,
  });
  return serializeState(row);
}

export async function revokeUser(args: {
  userId: string;
  actorStaffId?: string | null;
  note?: string | null;
  violationCount?: number;
}) {
  const userId = safeId(args.userId);
  const actorStaffId = safeId(args.actorStaffId) || null;
  if (!userId) return null;
  const now = new Date();
  const current = await readRow(userId);
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      status: "REVOKED",
      violationCount: Math.max(Number(current?.violationCount || 0), Number(args.violationCount || 0)),
      suspendedUntil: null,
      suspendedAt: null,
      suspendedByStaffId: null,
      suspensionDays: null,
      revokedAt: now,
      revokedByStaffId: actorStaffId,
      note: safeNote(args.note),
      metadataJson: mergeMetadata(current?.metadataJson, {
        lastAction: "revoke",
      }),
    },
    create: {
      userId,
      status: "REVOKED",
      violationCount: Math.max(1, Number(args.violationCount || 1)),
      revokedAt: now,
      revokedByStaffId: actorStaffId,
      note: safeNote(args.note),
      metadataJson: { lastAction: "revoke" },
    },
    select: userDisciplineStateSelect,
  });
  await killUserSessions({ userId, actorStaffId });
  return serializeState(row);
}

export async function killUserSessions(args: { userId: string; actorStaffId?: string | null }) {
  const userId = safeId(args.userId);
  if (!userId) return null;
  const now = new Date();
  await prisma.userAuth.updateMany({
    where: { userId },
    data: {
      sessionVersion: {
        increment: 1,
      },
    },
  });
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      lastSessionKillAt: now,
      metadataJson: mergeMetadata((await readRow(userId))?.metadataJson, {
        lastAction: "kill_sessions",
        lastSessionKillByStaffId: safeId(args.actorStaffId) || null,
      }),
    },
    create: {
      userId,
      lastSessionKillAt: now,
      metadataJson: {
        lastAction: "kill_sessions",
        lastSessionKillByStaffId: safeId(args.actorStaffId) || null,
      },
    },
    select: userDisciplineStateSelect,
  });
  return serializeState(row);
}

export async function resetUserRecovery(args: { userId: string; actorStaffId?: string | null; note?: string | null }) {
  const userId = safeId(args.userId);
  if (!userId) return null;
  const now = new Date();
  await prisma.authToken.deleteMany({
    where: { userId },
  });
  const current = await readRow(userId);
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      lastRecoveryResetAt: now,
      note: safeNote(args.note),
      metadataJson: mergeMetadata(current?.metadataJson, {
        lastAction: "reset_recovery",
        lastRecoveryResetByStaffId: safeId(args.actorStaffId) || null,
      }),
    },
    create: {
      userId,
      lastRecoveryResetAt: now,
      note: safeNote(args.note),
      metadataJson: {
        lastAction: "reset_recovery",
        lastRecoveryResetByStaffId: safeId(args.actorStaffId) || null,
      },
    },
    select: userDisciplineStateSelect,
  });
  return serializeState(row);
}

export async function recordUserIdentityReview(args: {
  userId: string;
  actorStaffId?: string | null;
  outcome: string;
  note?: string | null;
}) {
  const userId = safeId(args.userId);
  const outcome = safeId(args.outcome).slice(0, 80) || "reviewed";
  if (!userId) return null;
  const now = new Date();
  const current = await readRow(userId);
  const row = await prisma.adminUserDiscipline.upsert({
    where: { userId },
    update: {
      lastIdentityReviewAt: now,
      lastIdentityReviewById: safeId(args.actorStaffId) || null,
      note: safeNote(args.note),
      metadataJson: mergeMetadata(current?.metadataJson, {
        lastAction: "identity_review",
        identityReviewOutcome: outcome,
      }),
    },
    create: {
      userId,
      lastIdentityReviewAt: now,
      lastIdentityReviewById: safeId(args.actorStaffId) || null,
      note: safeNote(args.note),
      metadataJson: {
        lastAction: "identity_review",
        identityReviewOutcome: outcome,
      },
    },
    select: userDisciplineStateSelect,
  });
  return serializeState(row);
}
