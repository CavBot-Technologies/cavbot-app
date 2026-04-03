import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { ensureCavCloudShareExpirySoonNotifications } from "@/lib/cavcloud/notifications.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, status = 200, extra?: Record<string, string>) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE_HEADERS, ...(extra || {}) } });
}

function s(v: unknown) {
  return String(v ?? "").trim();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

type CursorPayload = { createdAt: string; id: string };

function decodeCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as CursorPayload | null;
    if (!parsed) return null;
    const createdAt = new Date(String(parsed.createdAt));
    if (!Number.isFinite(createdAt.getTime())) return null;
    const id = String(parsed.id || "").trim();
    if (!id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(record: { createdAt: Date; id: string }) {
  try {
    return Buffer.from(
      JSON.stringify({
        createdAt: record.createdAt.toISOString(),
        id: record.id,
      })
    ).toString("base64");
  } catch {
    return "";
  }
}

function degradedNotificationsList() {
  return { ok: true, degraded: true, notifications: [], nextCursor: null };
}

function degradedNotificationsMutation() {
  return { ok: true, degraded: true };
}

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    if (sess.memberRole !== "OWNER") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "NOTIFICATIONS_OWNER_ONLY",
        role: sess.memberRole || "ANON",
      });
      return json({ ok: false, error: "UNAUTHORIZED", ...(guardPayload || {}) }, 403);
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId) || null;

    if (accountId) {
      try {
        await ensureCavCloudShareExpirySoonNotifications({ accountId, userId });
      } catch {
        // Non-blocking: notification synthesis must never block reads.
      }
    }

    const url = new URL(req.url);
    const unread = s(url.searchParams.get("unread")) === "1";
    const limit = clamp(Number(url.searchParams.get("limit") || 20), 1, 50);
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    const accountScope = accountId
      ? [{ accountId }, { accountId: null }]
      : [{ accountId: null }];

    const baseWhere = {
      userId,
      OR: accountScope,
      ...(unread ? { readAt: null } : {}),
    };

    const cursorCondition = cursor
      ? {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            {
              createdAt: cursor.createdAt,
              id: { lt: cursor.id },
            },
          ],
        }
      : null;

    const where = cursorCondition
      ? {
          AND: [baseWhere, cursorCondition],
        }
      : baseWhere;

    const items = await prisma.notification.findMany({
      where,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limit,
      select: {
        id: true,
        title: true,
        body: true,
        href: true,
        kind: true,
        metaJson: true,
        tone: true,
        createdAt: true,
        readAt: true,
      },
    });

    const nextCursor =
      items.length === limit && items[items.length - 1]
        ? (() => {
            const candidate = encodeCursor({
              createdAt: items[items.length - 1].createdAt,
              id: items[items.length - 1].id,
            });
            return candidate || null;
          })()
        : null;

    return json(
      {
        ok: true,
        notifications: items.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          href: n.href,
          kind: n.kind || "GENERIC",
          meta: n.metaJson || null,
          tone: n.tone === "GOOD" ? "good" : n.tone === "WATCH" ? "watch" : "bad",
          createdAt: n.createdAt.toISOString(),
          unread: !n.readAt,
        })),
        nextCursor,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, ...(guardPayload || {}) }, error.status);
    }
    if (
      isSchemaMismatchError(error, {
        tables: ["Notification"],
        columns: ["kind", "metaJson", "tone", "readAt", "accountId"],
      })
    ) {
      return json(degradedNotificationsList(), 200);
    }
    return json(degradedNotificationsList(), 200);
  }
}

export async function POST(req: NextRequest) {
  // mark read
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    if (sess.memberRole !== "OWNER") {
      const guardPayload = buildGuardDecisionPayload({
        actionId: "NOTIFICATIONS_OWNER_ONLY",
        role: sess.memberRole || "ANON",
      });
      return json({ ok: false, error: "UNAUTHORIZED", ...(guardPayload || {}) }, 403);
    }

    const userId = s(sess.sub);
    const accountId = s(sess.accountId) || null;

    const body = (await readSanitizedJson(req, null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.map((x) => s(x)).filter(Boolean) : [];

    if (!ids.length) return json({ ok: true }, 200);

    await prisma.notification.updateMany({
      where: {
        id: { in: ids },
        userId,
        readAt: null,
        OR: accountId ? [{ accountId }, { accountId: null }] : [{ accountId: null }],
      },
      data: { readAt: new Date() },
    });

    return json({ ok: true }, 200);
  } catch (error) {
    if (isApiAuthError(error)) {
      const guardPayload = buildGuardDecisionPayload({
        actionId: error.status === 403 ? "NOTIFICATIONS_OWNER_ONLY" : "AUTH_REQUIRED",
      });
      return json({ ok: false, error: error.code, ...(guardPayload || {}) }, error.status);
    }
    if (
      isSchemaMismatchError(error, {
        tables: ["Notification"],
        columns: ["readAt", "accountId"],
      })
    ) {
      return json(degradedNotificationsMutation(), 200);
    }
    return json(degradedNotificationsMutation(), 200);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" } });
}
