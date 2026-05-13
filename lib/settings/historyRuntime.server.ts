import "server-only";

import { getAuthPool } from "@/lib/authDb";

export type SettingsHistoryCategory = "all" | "sites" | "keys" | "system" | "changes";

export type SettingsHistoryCursor = {
  id: string;
  createdAt: Date;
};

export type SettingsHistoryRow = {
  id: string;
  accountId: string;
  operatorUserId: string | null;
  action: string;
  actionLabel: string;
  category: string;
  severity: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metaJson: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  operator: {
    id: string;
    displayName: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
};

type RawHistoryCursorRow = {
  id: string;
  createdAt: Date | string;
};

type RawHistoryMembershipRow = {
  accountId: string;
  userId: string;
  role: string;
};

type RawOwnerMembershipRow = {
  accountId: string;
};

type RawHistoryCountRow = {
  count: number | string;
};

type RawHistoryRow = {
  id: string;
  accountId: string;
  operatorUserId: string | null;
  action: string;
  actionLabel: string;
  category: string;
  severity: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metaJson: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date | string;
  operatorId: string | null;
  operatorDisplayName: string | null;
  operatorEmail: string | null;
  operatorFullName: string | null;
  operatorUsername: string | null;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return 0;
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function mapHistoryRow(row: RawHistoryRow): SettingsHistoryRow {
  return {
    id: String(row.id || "").trim(),
    accountId: String(row.accountId || "").trim(),
    operatorUserId: row.operatorUserId ? String(row.operatorUserId).trim() : null,
    action: String(row.action || "").trim(),
    actionLabel: String(row.actionLabel || "").trim(),
    category: String(row.category || "").trim(),
    severity: String(row.severity || "").trim(),
    targetType: row.targetType ? String(row.targetType).trim() : null,
    targetId: row.targetId ? String(row.targetId).trim() : null,
    targetLabel: row.targetLabel ? String(row.targetLabel).trim() : null,
    metaJson: asRecord(row.metaJson),
    ip: row.ip ? String(row.ip).trim() : null,
    userAgent: row.userAgent ? String(row.userAgent).trim() : null,
    createdAt: asDate(row.createdAt) || new Date(0),
    operator: row.operatorId
      ? {
          id: String(row.operatorId).trim(),
          displayName: row.operatorDisplayName ? String(row.operatorDisplayName).trim() : null,
          email: row.operatorEmail ? String(row.operatorEmail).trim() : null,
          fullName: row.operatorFullName ? String(row.operatorFullName).trim() : null,
          username: row.operatorUsername ? String(row.operatorUsername).trim() : null,
        }
      : null,
  };
}

export async function resolveHistoryAccountIds(session: {
  accountId: string;
  sub: string;
}) {
  const primaryAccountIds = [session.accountId];
  const countResult = await getAuthPool().query<RawHistoryCountRow>(
    `SELECT COUNT(*)::int AS "count"
     FROM "AuditLog"
     WHERE "accountId" = $1`,
    [session.accountId],
  );

  if (asNumber(countResult.rows[0]?.count) > 0) return primaryAccountIds;

  const memberships = await getAuthPool().query<RawOwnerMembershipRow>(
    `SELECT "accountId"
     FROM "Membership"
     WHERE "userId" = $1
       AND "role" = 'OWNER'
     ORDER BY "createdAt" ASC`,
    [session.sub],
  );

  const accountIds = Array.from(
    new Set(
      memberships.rows
        .map((row) => String(row.accountId || "").trim())
        .filter(Boolean),
    ),
  );

  return accountIds.length ? accountIds : primaryAccountIds;
}

export async function resolveHistoryCursor(accountIds: string[], cursorId: string) {
  const result = await getAuthPool().query<RawHistoryCursorRow>(
    `SELECT "id", "createdAt"
     FROM "AuditLog"
     WHERE "id" = $1
       AND "accountId" = ANY($2::text[])
     LIMIT 1`,
    [cursorId, accountIds],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id || "").trim(),
    createdAt: asDate(row.createdAt) || new Date(0),
  };
}

export async function listHistoryRows(options: {
  accountIds: string[];
  category: SettingsHistoryCategory;
  searchTerm: string | null;
  cursor: SettingsHistoryCursor | null;
  limit: number;
}) {
  const values: unknown[] = [options.accountIds];
  const filters: string[] = [`l."accountId" = ANY($1::text[])`];

  if (options.category !== "all") {
    values.push(options.category);
    filters.push(`l."category"::text = $${values.length}`);
  }

  if (options.cursor) {
    values.push(options.cursor.createdAt);
    const cursorDateParam = values.length;
    values.push(options.cursor.id);
    const cursorIdParam = values.length;
    filters.push(
      `(l."createdAt" < $${cursorDateParam} OR (l."createdAt" = $${cursorDateParam} AND l."id" < $${cursorIdParam}))`,
    );
  }

  if (options.searchTerm) {
    values.push(`%${options.searchTerm}%`);
    const patternParam = values.length;
    filters.push(
      `(
        COALESCE(l."actionLabel", '') ILIKE $${patternParam}
        OR COALESCE(l."targetType", '') ILIKE $${patternParam}
        OR COALESCE(l."targetId", '') ILIKE $${patternParam}
        OR COALESCE(l."targetLabel", '') ILIKE $${patternParam}
        OR COALESCE(o."displayName", '') ILIKE $${patternParam}
        OR COALESCE(o."email", '') ILIKE $${patternParam}
        OR COALESCE(o."fullName", '') ILIKE $${patternParam}
        OR COALESCE(o."username", '') ILIKE $${patternParam}
      )`,
    );
  }

  values.push(options.limit + 1);

  const result = await getAuthPool().query<RawHistoryRow>(
    `SELECT
       l."id",
       l."accountId",
       l."operatorUserId",
       l."action",
       l."actionLabel",
       l."category",
       l."severity",
       l."targetType",
       l."targetId",
       l."targetLabel",
       l."metaJson",
       l."ip",
       l."userAgent",
       l."createdAt",
       o."id" AS "operatorId",
       o."displayName" AS "operatorDisplayName",
       o."email" AS "operatorEmail",
       o."fullName" AS "operatorFullName",
       o."username" AS "operatorUsername"
     FROM "AuditLog" l
     LEFT JOIN "User" o
       ON o."id" = l."operatorUserId"
     WHERE ${filters.join(" AND ")}
     ORDER BY l."createdAt" DESC, l."id" DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows.map(mapHistoryRow);
}

export async function resolveHistoryOperatorRoles(accountIds: string[], operatorUserIds: string[]) {
  if (!accountIds.length || !operatorUserIds.length) return new Map<string, string>();

  const result = await getAuthPool().query<RawHistoryMembershipRow>(
    `SELECT "accountId", "userId", "role"
     FROM "Membership"
     WHERE "accountId" = ANY($1::text[])
       AND "userId" = ANY($2::text[])`,
    [accountIds, operatorUserIds],
  );

  return new Map(
    result.rows.map((row) => [
      `${String(row.accountId || "").trim()}:${String(row.userId || "").trim()}`,
      String(row.role || "").trim(),
    ]),
  );
}
