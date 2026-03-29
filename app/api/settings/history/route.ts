import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { getAuditActionDefinition } from "@/lib/audit";
import { AUDIT_LOG_USER_ID_COLUMN_SQL } from "@/lib/auditModelCompat";

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

type CursorState = {
  id: string;
  createdAt: Date;
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

function buildWhereClause(options: {
  category: HistoryCategory;
  searchTerm: string | null;
  cursor: CursorState | null;
  accountId: string;
}): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  clauses.push(Prisma.sql`al."accountId" = ${options.accountId}`);

  if (options.category !== "all") {
    clauses.push(Prisma.sql`al."category" = ${options.category}`);
  }

  if (options.cursor) {
    clauses.push(
      Prisma.sql`(al."createdAt" < ${options.cursor.createdAt} OR (al."createdAt" = ${options.cursor.createdAt} AND al."id" < ${options.cursor.id}))`
    );
  }

  if (options.searchTerm) {
    const pattern = `%${options.searchTerm.toLowerCase()}%`;
    clauses.push(
      Prisma.sql`(
        lower(al."action") LIKE ${pattern} OR
        lower(coalesce(al."actionLabel", "")) LIKE ${pattern} OR
        lower(coalesce(al."targetType", "")) LIKE ${pattern} OR
        lower(coalesce(al."targetId", "")) LIKE ${pattern} OR
        lower(coalesce(al."targetLabel", "")) LIKE ${pattern} OR
        lower(coalesce(u."displayName", "")) LIKE ${pattern} OR
        lower(coalesce(u."email", "")) LIKE ${pattern} OR
        lower(coalesce(al."metaJson"::text, "")) LIKE ${pattern}
      )`
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
  const whereClause = buildWhereClause({
    category: options.category,
    searchTerm: options.searchTerm,
    cursor: options.cursor,
    accountId: options.accountId,
  });

  const rows = await prisma.$queryRaw<RawHistoryRow[]>(Prisma.sql`
    SELECT
      al."id",
      al."action",
      al."targetType",
      al."targetId",
      al."targetLabel",
      al."metaJson",
      al."ip",
      al."userAgent",
      al."createdAt",
      al."actionLabel",
      al."category",
      al."severity",
      u."id" AS "operatorId",
      u."displayName" AS "operatorDisplayName",
      u."email" AS "operatorEmail",
      u."fullName" AS "operatorFullName",
      u."username" AS "operatorUsername",
      m."role" AS "operatorRole"
    FROM "AuditLog" al
    LEFT JOIN "User" u ON u."id" = al.${AUDIT_LOG_USER_ID_COLUMN_SQL}
    LEFT JOIN "Membership" m ON m."userId" = u."id" AND m."accountId" = ${options.accountId}
    WHERE ${whereClause}
    ORDER BY al."createdAt" DESC, al."id" DESC
    LIMIT ${options.limit + 1}
  `);

  return rows;
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

    const rows = await fetchHistoryRows({
      accountId: session.accountId,
      category,
      searchTerm: searchQuery || null,
      cursor: cursorState,
      limit,
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const entries = sliced.map((row) => {
      const meta =
        row.metaJson == null
          ? null
          : typeof row.metaJson === "string"
          ? (JSON.parse(row.metaJson) as Record<string, unknown>)
          : (row.metaJson as Record<string, unknown>);
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
