import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { getAuditActionDefinition } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type HistoryCategory = "all" | "sites" | "keys" | "system" | "changes";

const PAGE_SIZE = 24;
const HISTORY_SCHEMA_CACHE_TTL = process.env.NODE_ENV === "production" ? 60_000 : 2_000;

type CursorState = {
  id: string;
  createdAt: Date;
};

type HistorySchemaShape = {
  auditLog: Set<string>;
  user: Set<string>;
  membership: Set<string>;
  auditLogUserIdColumn: "operatorUserId" | "actorUserId" | null;
};

type RawHistoryRow = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metaJson: string | Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  operatorId: string | null;
  operatorDisplayName: string | null;
  operatorEmail: string | null;
  operatorRole: string | null;
  operatorFullName: string | null;
  operatorUsername: string | null;
  actionLabel: string | null;
  category: string | null;
  severity: string | null;
};

let historySchemaCache: { value: HistorySchemaShape; fetchedAt: number } | null = null;

function formatActionLabel(action: string) {
  return action
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function deriveTargetLabel(row: RawHistoryRow, meta: Record<string, unknown> | null): string {
  if (row.targetLabel && row.targetLabel.trim()) return row.targetLabel;
  if (meta && typeof meta === "object") {
    if (typeof meta.origin === "string") return meta.origin;
    if (typeof meta.last4 === "string") return `•••• ${meta.last4}`;
    if (typeof meta.username === "string") return meta.username;
    if (typeof meta.keyName === "string") return meta.keyName;
  }
  if (row.targetType && row.targetId) {
    return `${row.targetType} · ${row.targetId}`;
  }
  if (row.targetType) return row.targetType;
  return "—";
}

function selectColumnSql(
  available: Set<string>,
  tableAlias: string,
  column: string,
  alias: string,
  cast: "text" | "jsonb" = "text",
) {
  if (available.has(column)) {
    return `"${tableAlias}"."${column}" AS "${alias}"`;
  }
  return `NULL::${cast} AS "${alias}"`;
}

async function getHistorySchema(): Promise<HistorySchemaShape> {
  if (historySchemaCache && Date.now() - historySchemaCache.fetchedAt < HISTORY_SCHEMA_CACHE_TTL) {
    return historySchemaCache.value;
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>(Prisma.sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('AuditLog', 'User', 'Membership')
    `);

    const auditLog = new Set<string>();
    const user = new Set<string>();
    const membership = new Set<string>();

    for (const row of rows) {
      if (row.table_name === "AuditLog") auditLog.add(row.column_name);
      if (row.table_name === "User") user.add(row.column_name);
      if (row.table_name === "Membership") membership.add(row.column_name);
    }

    const value: HistorySchemaShape = {
      auditLog,
      user,
      membership,
      auditLogUserIdColumn: auditLog.has("operatorUserId")
        ? "operatorUserId"
        : auditLog.has("actorUserId")
        ? "actorUserId"
        : null,
    };

    historySchemaCache = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return {
      auditLog: new Set(),
      user: new Set(),
      membership: new Set(),
      auditLogUserIdColumn: null,
    };
  }
}

function buildWhereClause(options: {
  category: HistoryCategory;
  searchTerm: string | null;
  cursor: CursorState | null;
  accountId: string;
  schema: HistorySchemaShape;
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  clauses.push(Prisma.sql`al."accountId" = ${options.accountId}`);

  if (options.category !== "all" && options.schema.auditLog.has("category")) {
    clauses.push(Prisma.sql`al."category" = ${options.category}`);
  }

  if (options.cursor) {
    clauses.push(
      Prisma.sql`(al."createdAt" < ${options.cursor.createdAt} OR (al."createdAt" = ${options.cursor.createdAt} AND al."id" < ${options.cursor.id}))`
    );
  }

  if (options.searchTerm) {
    const pattern = `%${options.searchTerm.toLowerCase()}%`;
    const searchClauses: Prisma.Sql[] = [Prisma.sql`lower(al."action") LIKE ${pattern}`];

    if (options.schema.auditLog.has("actionLabel")) {
      searchClauses.push(Prisma.sql`lower(coalesce(al."actionLabel", "")) LIKE ${pattern}`);
    }
    if (options.schema.auditLog.has("targetType")) {
      searchClauses.push(Prisma.sql`lower(coalesce(al."targetType", "")) LIKE ${pattern}`);
    }
    if (options.schema.auditLog.has("targetId")) {
      searchClauses.push(Prisma.sql`lower(coalesce(al."targetId", "")) LIKE ${pattern}`);
    }
    if (options.schema.auditLog.has("targetLabel")) {
      searchClauses.push(Prisma.sql`lower(coalesce(al."targetLabel", "")) LIKE ${pattern}`);
    }
    if (options.schema.user.has("displayName")) {
      searchClauses.push(Prisma.sql`lower(coalesce(u."displayName", "")) LIKE ${pattern}`);
    }
    if (options.schema.user.has("email")) {
      searchClauses.push(Prisma.sql`lower(coalesce(u."email", "")) LIKE ${pattern}`);
    }
    if (options.schema.auditLog.has("metaJson")) {
      searchClauses.push(Prisma.sql`lower(coalesce(al."metaJson"::text, "")) LIKE ${pattern}`);
    }

    clauses.push(
      Prisma.sql`(${Prisma.join(searchClauses, " OR ")})`
    );
  }

  return clauses.length ? Prisma.join(clauses, " AND ") : Prisma.sql`TRUE`;
}

async function fetchHistoryRows(options: {
  accountId: string;
  category: HistoryCategory;
  searchTerm: string | null;
  cursor: CursorState | null;
  limit: number;
}) {
  const schema = await getHistorySchema();
  if (!schema.auditLog.size) return [];

  const whereClause = buildWhereClause({
    category: options.category,
    searchTerm: options.searchTerm,
    cursor: options.cursor,
    accountId: options.accountId,
    schema,
  });

  const joinUserSql = schema.auditLogUserIdColumn
    ? Prisma.raw(`u."id" = al."${schema.auditLogUserIdColumn}"`)
    : Prisma.sql`FALSE`;

  const selectColumns = Prisma.raw([
    `al."id"`,
    `al."action"`,
    selectColumnSql(schema.auditLog, "al", "targetType", "targetType"),
    selectColumnSql(schema.auditLog, "al", "targetId", "targetId"),
    selectColumnSql(schema.auditLog, "al", "targetLabel", "targetLabel"),
    selectColumnSql(schema.auditLog, "al", "metaJson", "metaJson", "jsonb"),
    selectColumnSql(schema.auditLog, "al", "ip", "ip"),
    selectColumnSql(schema.auditLog, "al", "userAgent", "userAgent"),
    `al."createdAt" AS "createdAt"`,
    selectColumnSql(schema.auditLog, "al", "actionLabel", "actionLabel"),
    selectColumnSql(schema.auditLog, "al", "category", "category"),
    selectColumnSql(schema.auditLog, "al", "severity", "severity"),
    `u."id" AS "operatorId"`,
    selectColumnSql(schema.user, "u", "displayName", "operatorDisplayName"),
    selectColumnSql(schema.user, "u", "email", "operatorEmail"),
    selectColumnSql(schema.user, "u", "fullName", "operatorFullName"),
    selectColumnSql(schema.user, "u", "username", "operatorUsername"),
    selectColumnSql(schema.membership, "m", "role", "operatorRole"),
  ].join(",\n      "));

  const rows = await prisma.$queryRaw<RawHistoryRow[]>(Prisma.sql`
    SELECT
      ${selectColumns}
    FROM "AuditLog" al
    LEFT JOIN "User" u ON ${joinUserSql}
    LEFT JOIN "Membership" m ON m."userId" = u."id" AND m."accountId" = ${options.accountId}
    WHERE ${whereClause}
    ORDER BY al."createdAt" DESC, al."id" DESC
    LIMIT ${options.limit + 1}
  `);

  return rows;
}

function parseMetaJson(value: RawHistoryRow["metaJson"]): Record<string, unknown> | null {
  if (value == null) return null;
  try {
    return typeof value === "string"
      ? (JSON.parse(value) as Record<string, unknown>)
      : (value as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerSession(req);

    const url = new URL(req.url);
    const categoryParam = (url.searchParams.get("category") || "all").toLowerCase();
    const category = (["all", "sites", "keys", "system", "changes"].includes(categoryParam)
      ? (categoryParam as HistoryCategory)
      : "all") as HistoryCategory;
    const searchQuery = (url.searchParams.get("q") || "").trim();
    const cursorId = (url.searchParams.get("cursor") || "").trim() || null;
    const rawLimit = Number(url.searchParams.get("limit") || PAGE_SIZE);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 10), 50) : PAGE_SIZE;

    let cursorState: CursorState | null = null;
    if (cursorId) {
      const cursorRow = await prisma.auditLog.findFirst({
        where: { id: cursorId, accountId: session.accountId },
        select: { id: true, createdAt: true },
      });
      if (!cursorRow) {
        return json({ ok: false, error: "BAD_CURSOR" }, 400);
      }
      cursorState = { id: cursorRow.id, createdAt: cursorRow.createdAt };
    }

    let rows: RawHistoryRow[] = [];
    try {
      rows = await fetchHistoryRows({
        accountId: session.accountId,
        category,
        searchTerm: searchQuery || null,
        cursor: cursorState,
        limit,
      });
    } catch (error) {
      console.error("[settings/history] query failed", error);
      return json({ ok: true, entries: [], nextCursor: null }, 200);
    }

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const entries = sliced.map((row) => {
      const meta = parseMetaJson(row.metaJson);
      const actingUser = row.operatorId
        ? {
            id: row.operatorId,
            fullName: row.operatorFullName,
            displayName: row.operatorDisplayName || "",
            email: row.operatorEmail,
            role: row.operatorRole,
            username: row.operatorUsername,
          }
        : {
            id: null,
            fullName: null,
            displayName: "System",
            email: null,
            role: null,
            username: null,
          };

      const actionDefinition = getAuditActionDefinition(row.action as AuditAction);
      const actionLabel =
        row.actionLabel?.trim() || actionDefinition?.label || formatActionLabel(row.action);
      const category =
        (row.category as HistoryCategory) || actionDefinition?.category || "system";
      const severity =
        (row.severity as "info" | "warning" | "destructive") || actionDefinition?.severity || "info";

      return {
        id: row.id,
        action: row.action,
        actionLabel,
        category,
        severity,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: deriveTargetLabel(row, meta),
        operator: actingUser,
        meta,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
      };
    });

    const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

    return json({ ok: true, entries, nextCursor }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "HISTORY_FETCH_FAILED" }, 500);
  }
}
