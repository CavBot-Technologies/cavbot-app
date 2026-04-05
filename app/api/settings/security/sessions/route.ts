// app/api/settings/security/sessions/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { detectBrowser } from "@/lib/browser";
import { withAuditLogUserIdField } from "@/lib/auditModelCompat";

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
  Cloudflare geo + IP (CF-first)
  ========================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function pickHeader(req: NextRequest, names: string[]) {
  for (const name of names) {
    const value = safeStr(req.headers.get(name)).trim();
    if (value) return value;
  }
  return "";
}

function readCoordinate(raw: unknown, kind: "lat" | "lon") {
  const value = safeStr(raw).trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (kind === "lat" && (parsed < -90 || parsed > 90)) return null;
  if (kind === "lon" && (parsed < -180 || parsed > 180)) return null;
  return parsed.toFixed(4);
}

function composeLocationLabel(args: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  ip?: string | null;
}) {
  const city = safeStr(args.city).trim();
  const region = safeStr(args.region).trim();
  const country = safeStr(args.country).trim();
  const latitude = safeStr(args.latitude).trim();
  const longitude = safeStr(args.longitude).trim();
  const ip = safeStr(args.ip).trim();

  const placeParts = [city, region, country].filter(Boolean);
  if (placeParts.length) {
    if (latitude && longitude) {
      return `${placeParts.join(", ")} · ${latitude}, ${longitude}`;
    }
    return placeParts.join(", ");
  }

  if (latitude && longitude) {
    return `Lat ${latitude}, Lon ${longitude}`;
  }

  if (ip) {
    return `Approximate network location (IP ${ip})`;
  }

  return "Approximate network location";
}

function pickClientIp(req: NextRequest) {
  // Cloudflare (best)
  const cfConn = safeStr(req.headers.get("cf-connecting-ip")).trim();
  if (cfConn) return cfConn;

  // Some proxies
  const tcip = safeStr(req.headers.get("true-client-ip")).trim();
  if (tcip) return tcip;

  // Generic fallback
  const xff = safeStr(req.headers.get("x-forwarded-for")).trim();
  if (xff) return xff.split(",")[0].trim();

  const xr = safeStr(req.headers.get("x-real-ip")).trim();
  if (xr) return xr;

  return "";
}

/**
 * Cloudflare geo:
 * - cf-ipcountry: "US" (most reliable)
 * - cf-region / cf-region-code: sometimes present
 * City is not reliably available from CF headers.
 */
function readNetworkGeo(req: NextRequest, ip: string | null) {
  const city =
    pickHeader(req, ["cf-ipcity", "x-vercel-ip-city", "x-appengine-city", "x-geo-city"]) || null;

  const region =
    pickHeader(req, [
      "cf-region",
      "cf-region-code",
      "x-vercel-ip-country-region",
      "x-appengine-region",
      "x-geo-region",
    ]) || null;

  const countryRaw = pickHeader(req, ["cf-ipcountry", "x-vercel-ip-country", "x-appengine-country", "x-geo-country"]);
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : null;

  const latitude = readCoordinate(
    pickHeader(req, ["cf-iplatitude", "x-vercel-ip-latitude", "x-geo-latitude", "x-latitude"]),
    "lat"
  );
  const longitude = readCoordinate(
    pickHeader(req, ["cf-iplongitude", "x-vercel-ip-longitude", "x-geo-longitude", "x-longitude"]),
    "lon"
  );

  return {
    city,
    region,
    country,
    latitude,
    longitude,
    label: composeLocationLabel({ city, region, country, latitude, longitude, ip }),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readLocationFromMeta(metaJson: unknown, ip: string | null): string {
  const m: Record<string, unknown> = isRecord(metaJson) ? metaJson : {};

  const direct = [
    m["location"],
    m["geoLabel"],
    m["geo"],
    m["city"],
    m["region"],
    m["country"],
  ]
    .map((value) => safeStr(value).trim())
    .find(Boolean);
  if (direct) return direct;

  const city = safeStr(m["geoCity"] ?? m["city"]).trim() || null;
  const region = safeStr(m["geoRegion"] ?? m["region"] ?? m["regionCode"]).trim() || null;
  const countryRaw = safeStr(m["geoCountry"] ?? m["country"] ?? m["countryCode"]).trim();
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : null;

  const latitude = readCoordinate(
    m["geoLatitude"] ?? m["latitude"] ?? m["lat"] ?? m["geoLat"],
    "lat"
  );
  const longitude = readCoordinate(
    m["geoLongitude"] ?? m["longitude"] ?? m["lng"] ?? m["lon"] ?? m["geoLon"],
    "lon"
  );

  return composeLocationLabel({ city, region, country, latitude, longitude, ip });
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
    const geoNow = readNetworkGeo(req, ipNow || null);

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
    }).catch(async (error) => {
      console.error("[settings/security/sessions] full audit query failed", error);
      return prisma.auditLog.findMany({
        where: withAuditLogUserIdField({ accountId }, userId) as Prisma.AuditLogWhereInput,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          createdAt: true,
          userAgent: true,
        },
      }).catch((fallbackError) => {
        console.error("[settings/security/sessions] fallback audit query failed", fallbackError);
        return [];
      });
    });

    for (const e of events) {
      const eua = String(("userAgent" in e ? e.userAgent : "") || "");
      const b = detectBrowser(eua);
      const dv = deviceLabel(eua);

      const ip = String(("ip" in e ? e.ip : "") || "").trim();
      const locFromMeta = readLocationFromMeta("metaJson" in e ? e.metaJson : null, ip || null);

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
