// app/api/settings/security/sessions/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { detectBrowser } from "@/lib/browser";
import { withAuditLogUserIdField } from "@/lib/auditModelCompat";
import { composeLocationLabel, pickClientIp, readGeoFromMeta, readRequestGeo } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

/* =========================
  Browser + device detection
  ========================= */

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

function titleCase(s: string) {
  const v = String(s || "");
  return v ? v[0].toUpperCase() + v.slice(1) : v;
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  if (!Number.isFinite(t)) return "—";

  const secs = Math.max(1, Math.floor((now - t) / 1000));
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days >= 30) {
    const m = Math.floor(days / 30);
    return `${m} month${m === 1 ? "" : "s"} ago`;
  }
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hrs >= 1) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  if (mins >= 1) return `${mins} min ago`;
  return "Just now";
}

/* =========================
  API
  ========================= */

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const accountId = sess.accountId;
    const userId = sess.sub;

    const uaNow = String(req.headers.get("user-agent") || "");
    const browserNow = detectBrowser(uaNow);
    const devNow = deviceLabel(uaNow);

    const ipNow = pickClientIp(req);
    const geoNow = readRequestGeo(req);

    const events = await prisma.auditLog.findMany({
      where: withAuditLogUserIdField({ accountId }, userId) as Prisma.AuditLogWhereInput,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        ip: true,
        userAgent: true,
        metaJson: true,
      },
    });

    type SessionRow = {
      id: string;
      label: string;
      browser: string | null;
      device: string | null;
      userAgent: string | null;
      location: string | null;
      statusText: string;
      createdAt: string;
      isCurrent: boolean;
      ip: string | null;
    };

    const out: SessionRow[] = [];

    out.push({
      id: "current",
      label: `${browserNow === "unknown" ? "Session" : titleCase(browserNow)}${devNow ? ` on ${devNow}` : ""}`,
      browser: browserNow,
      device: devNow,
      userAgent: uaNow || null,
      location: geoNow.label,
      statusText: "Active",
      createdAt: new Date().toISOString(),
      isCurrent: true,
      ip: ipNow || null,
    });

    for (const e of events) {
      const eua = String(e.userAgent || "");
      const b = detectBrowser(eua);
      const dv = deviceLabel(eua);

      const ip = String(e.ip || "").trim();
      const metaGeo = readGeoFromMeta(e.metaJson);
      const locFromMeta = metaGeo.label || composeLocationLabel({ ip: ip || null });

      out.push({
        id: e.id,
        label: `${b === "unknown" ? "Session" : titleCase(b)}${dv ? ` on ${dv}` : ""}`,
        browser: b,
        device: dv,
        userAgent: eua || null,
        location: locFromMeta,
        statusText: timeAgo(e.createdAt.toISOString()),
        createdAt: e.createdAt.toISOString(),
        isCurrent: false,
        ip: ip || null,
      });
    }

    return json({ ok: true, sessions: out }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "SECURITY_SESSIONS_FAILED", message: "Failed to load session history." }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const accountId = sess.accountId;
    const userId = sess.sub;

    const id = String(req.nextUrl.searchParams.get("id") || "").trim();
    if (!id) return json({ error: "MISSING_ID", message: "Missing session id." }, 400);
    if (id === "current") return json({ error: "CANNOT_DELETE_CURRENT", message: "Cannot delete current session." }, 400);

    const row = await prisma.auditLog.findFirst({
      where: withAuditLogUserIdField({ id, accountId }, userId) as Prisma.AuditLogWhereInput,
      select: { id: true },
    });

    if (!row) return json({ error: "NOT_FOUND", message: "Session record not found." }, 404);

    await prisma.auditLog.delete({ where: { id } });

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "SECURITY_SESSION_DELETE_FAILED", message: "Failed to remove session record." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, DELETE, OPTIONS" },
  });
}
