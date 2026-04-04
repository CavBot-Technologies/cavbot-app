import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma, type AuditAction, type AuditLog, type AuditCategory } from "@prisma/client";
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

type CursorState = {
  id: string;
  createdAt: Date;
};

type RawHistoryRow = AuditLog & {
  operator: {
    id: string;
    displayName: string | null;
    email: string | null;
    fullName: string | null;
    username: string | null;
  } | null;
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
  accountIds: string[];
}): Prisma.AuditLogWhereInput {
  const filters: Prisma.AuditLogWhereInput[] = [{ accountId: { in: options.accountIds } }];

  if (options.category !== "all") {
    filters.push({ category: options.category as AuditCategory });
  }

  if (options.cursor) {
    filters.push({
      OR: [
        { createdAt: { lt: options.cursor.createdAt } },
        {
          AND: [
            { createdAt: options.cursor.createdAt },
            { id: { lt: options.cursor.id } },
          ],
        },
      ],
    });
  }

  if (options.searchTerm) {
    const term = options.searchTerm;
    filters.push({
      OR: [
        { actionLabel: { contains: term, mode: "insensitive" } },
        { targetType: { contains: term, mode: "insensitive" } },
        { targetId: { contains: term, mode: "insensitive" } },
        { targetLabel: { contains: term, mode: "insensitive" } },
        { operator: { is: { displayName: { contains: term, mode: "insensitive" } } } },
        { operator: { is: { email: { contains: term, mode: "insensitive" } } } },
        { operator: { is: { fullName: { contains: term, mode: "insensitive" } } } },
        { operator: { is: { username: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  return filters.length === 1 ? filters[0] : { AND: filters };
}

async function fetchHistoryRows(options: {
  accountIds: string[];
  category: HistoryCategory;
  searchTerm: string | null;
  cursor: CursorState | null;
  limit: number;
}) {
  const whereClause = buildWhereClause({
    category: options.category,
    searchTerm: options.searchTerm,
    cursor: options.cursor,
    accountIds: options.accountIds,
  });

  return prisma.auditLog.findMany({
    where: whereClause,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
    include: {
      operator: {
        select: {
          id: true,
          displayName: true,
          email: true,
          fullName: true,
          username: true,
        },
      },
    },
  }) as Promise<RawHistoryRow[]>;
}

async function resolveOperatorRoles(accountIds: string[], operatorUserIds: string[]) {
  if (!accountIds.length || !operatorUserIds.length) return new Map<string, string>();
  const rows = await prisma.membership.findMany({
    where: {
      accountId: { in: accountIds },
      userId: { in: operatorUserIds },
    },
    select: {
      accountId: true,
      userId: true,
      role: true,
    },
  });

  return new Map(rows.map((row) => [`${row.accountId}:${row.userId}`, row.role]));
}

async function resolveHistoryAccountIds(session: Awaited<ReturnType<typeof requireSettingsOwnerSession>>) {
  const primaryAccountIds = [session.accountId];
  const primaryCount = await prisma.auditLog.count({
    where: { accountId: session.accountId },
  });
  if (primaryCount > 0) return primaryAccountIds;

  const ownerMemberships = await prisma.membership.findMany({
    where: {
      userId: session.sub,
      role: "OWNER",
    },
    select: {
      accountId: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const allOwnerAccountIds = Array.from(
    new Set(
      ownerMemberships
        .map((row) => String(row.accountId || "").trim())
        .filter(Boolean)
    )
  );

  return allOwnerAccountIds.length ? allOwnerAccountIds : primaryAccountIds;
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
    const accountIds = await resolveHistoryAccountIds(session);

    let cursorState: CursorState | null = null;
    if (cursorId) {
      const cursorRow = await prisma.auditLog.findFirst({
        where: { id: cursorId, accountId: { in: accountIds } },
        select: { id: true, createdAt: true },
      });
      if (!cursorRow) {
        return json({ ok: false, error: "BAD_CURSOR" }, 400);
      }
      cursorState = { id: cursorRow.id, createdAt: cursorRow.createdAt };
    }

    const rows = await fetchHistoryRows({
      accountIds,
      category,
      searchTerm: searchQuery || null,
      cursor: cursorState,
      limit,
    });
    const roleMap = await resolveOperatorRoles(
      accountIds,
      Array.from(new Set(rows.map((row) => String(row.operator?.id || "").trim()).filter(Boolean)))
    );

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const entries = sliced.map((row) => {
      const meta = row.metaJson && typeof row.metaJson === "object"
        ? (row.metaJson as Record<string, unknown>)
        : null;
      const actingUser = row.operator?.id
        ? {
            id: row.operator.id,
            fullName: row.operator.fullName,
            displayName: row.operator.displayName || "",
            email: row.operator.email,
            role: roleMap.get(`${row.accountId}:${row.operator.id}`) || null,
            username: row.operator.username,
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
        row.actionLabel.trim() || actionDefinition?.label || formatActionLabel(row.action);
      const category =
        (row.category as HistoryCategory) || (actionDefinition?.category as HistoryCategory) || "system";
      const severity =
        row.severity || actionDefinition?.severity || "info";

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
