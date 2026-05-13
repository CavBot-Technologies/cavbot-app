import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerResilientSession } from "@/lib/settings/ownerAuth.server";
import {
  listHistoryRows,
  resolveHistoryAccountIds,
  resolveHistoryCursor,
  resolveHistoryOperatorRoles,
  type SettingsHistoryCategory,
  type SettingsHistoryRow,
} from "@/lib/settings/historyRuntime.server";
import { getAuditActionDefinition } from "@/lib/audit";
import { browserDisplayName, detectBrowser } from "@/lib/browser";
import { pickClientIp, readRequestGeo } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

const PAGE_SIZE = 24;
const HISTORY_RESPONSE_TIMEOUT_MS = 2_500;

type HistoryEntryCategory = "all" | "sites" | "keys" | "system" | "changes";

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

function deriveTargetLabel(row: SettingsHistoryRow, meta: Record<string, unknown> | null): string {
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

function deviceLabel(uaRaw: string) {
  const ua = String(uaRaw || "");
  if (!ua) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac OS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return null;
}

async function withHistoryDeadline<T>(promise: Promise<T>, timeoutMs = HISTORY_RESPONSE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("SETTINGS_HISTORY_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildCurrentSessionHistoryEntry(
  req: NextRequest,
  session: Awaited<ReturnType<typeof requireSettingsOwnerResilientSession>>,
) {
  const userAgent = String(req.headers.get("user-agent") || "").trim();
  const browser = detectBrowser(userAgent);
  const device = deviceLabel(userAgent);
  const geo = readRequestGeo(req);
  const ip = pickClientIp(req) || geo.ip || null;
  const browserName = browserDisplayName(browser);
  const targetLabel = `${browserName}${device ? ` on ${device}` : ""}`;

  return {
    id: "current-session",
    action: "AUTH_SIGNED_IN",
    actionLabel: "Current session",
    category: "system",
    severity: "info",
    targetType: "Session",
    targetId: null,
    targetLabel,
    operator: {
      id: session.sub,
      fullName: null,
      displayName: "Current operator",
      email: null,
      role: session.memberRole,
      username: null,
    },
    meta: {
      browser,
      device,
      location: geo.label,
      geoRegion: geo.region,
      geoCountry: geo.country,
      geoCity: geo.city,
    },
    ip,
    userAgent: userAgent || null,
    createdAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerResilientSession(req);

    const url = new URL(req.url);
    const categoryParam = (url.searchParams.get("category") || "all").toLowerCase();
    const category = (["all", "sites", "keys", "system", "changes"].includes(categoryParam)
      ? (categoryParam as HistoryEntryCategory)
      : "all") as HistoryEntryCategory;
    const searchQuery = (url.searchParams.get("q") || "").trim();
    const cursorId = (url.searchParams.get("cursor") || "").trim() || null;
    const rawLimit = Number(url.searchParams.get("limit") || PAGE_SIZE);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 10), 50) : PAGE_SIZE;
    const payload = await withHistoryDeadline((async () => {
      const accountIds = await resolveHistoryAccountIds(session);

      const cursorState = cursorId
        ? await resolveHistoryCursor(accountIds, cursorId)
        : null;
      if (cursorId && !cursorState) {
        return { ok: false as const, error: "BAD_CURSOR", status: 400 };
      }

      const rows = await listHistoryRows({
        accountIds,
        category: category as SettingsHistoryCategory,
        searchTerm: searchQuery || null,
        cursor: cursorState,
        limit,
      });

      const roleMap = await resolveHistoryOperatorRoles(
        accountIds,
        Array.from(new Set(rows.map((row) => String(row.operator?.id || "").trim()).filter(Boolean))),
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

        const actionDefinition = getAuditActionDefinition(
          row.action as Parameters<typeof getAuditActionDefinition>[0],
        );
        const actionLabel =
          row.actionLabel.trim() || actionDefinition?.label || formatActionLabel(row.action);
        const resolvedCategory =
          (row.category as HistoryEntryCategory)
          || (actionDefinition?.category as HistoryEntryCategory)
          || "system";
        const severity =
          row.severity || actionDefinition?.severity || "info";

        return {
          id: row.id,
          action: row.action,
          actionLabel,
          category: resolvedCategory,
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

      return { ok: true as const, entries, nextCursor };
    })()).catch(() => ({
      ok: true as const,
      degraded: true,
      entries: [buildCurrentSessionHistoryEntry(req, session)],
      nextCursor: null,
    }));

    if (!payload.ok) return json({ ok: false, error: payload.error }, payload.status);
    return json(payload, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({
      ok: true,
      degraded: true,
      entries: [],
      nextCursor: null,
    }, 200);
  }
}
