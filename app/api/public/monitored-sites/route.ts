import "server-only";

import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ORIGINS = new Set([
  "https://cavbot.io",
  "https://www.cavbot.io",
  "https://brand.cavbot.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);

const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
  Vary: "Origin",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CURRENT_WINDOW_DAYS = 30;
const PREVIOUS_WINDOW_DAYS = 30;
const TREND_DAYS = 14;
const SITE_LIMIT = 150;
const CATEGORY_LIMIT = 75;
const TREND_EVENT_LIMIT = 50_000;
const DB_DEADLINE_MS = 7_000;

type CountRow = {
  siteId: string;
  _count: {
    _all: number;
  };
};

type LatestRow = {
  siteId: string;
  _max: {
    createdAt: Date | null;
  };
};

type PublicSite = {
  rank: number;
  host: string;
  origin: string;
  url: string;
  displayName: string;
  faviconUrl: string;
  status: "verified" | "pending";
  onboardedAt: string;
  lastSeenAt: string | null;
  signals: number;
  previousSignals: number;
  delta: number;
  trend: number[];
};

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const headers: Record<string, string> = {
    ...CACHE_HEADERS,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json<T>(req: Request, payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: { ...(init?.headers || {}), ...corsHeaders(req) },
  });
}

function canonicalOrigin(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;

  try {
    const url = new URL(withScheme);
    if (!url.hostname || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    url.pathname = "";
    return url.origin;
  } catch {
    return "";
  }
}

function publicHost(origin: string) {
  try {
    return new URL(origin).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function faviconFor(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

function isoDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function toCountMap(rows: CountRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.siteId, Number(row._count._all || 0));
  }
  return map;
}

function toLatestMap(rows: LatestRow[]) {
  const map = new Map<string, Date | null>();
  for (const row of rows) {
    map.set(row.siteId, row._max.createdAt || null);
  }
  return map;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function trendKeys(now: Date) {
  const keys: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    keys.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  }
  return keys;
}

function uniqueByHost<T extends { host: string }>(sites: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const site of sites) {
    const host = site.host.toLowerCase();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    unique.push(site);
  }

  return unique;
}

function ranked(sites: PublicSite[]) {
  return sites.map((site, index) => ({ ...site, rank: index + 1 }));
}

function withDeadline<T>(promise: Promise<T>, label: string) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label}_DEADLINE`)), DB_DEADLINE_MS);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeout) clearTimeout(timeout);
    }),
    deadline,
  ]);
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const now = new Date();
  const currentStart = new Date(now.getTime() - CURRENT_WINDOW_DAYS * DAY_MS);
  const previousStart = new Date(now.getTime() - (CURRENT_WINDOW_DAYS + PREVIOUS_WINDOW_DAYS) * DAY_MS);
  const trendStart = new Date(now.getTime() - (TREND_DAYS - 1) * DAY_MS);
  const keys = trendKeys(now);

  try {
    const siteRows = await withDeadline(prisma.site.findMany({
      where: {
        isActive: true,
        status: "VERIFIED",
      },
      select: {
        id: true,
        origin: true,
        status: true,
        createdAt: true,
      },
      orderBy: [
        { createdAt: "desc" },
      ],
      take: SITE_LIMIT,
    }), "PUBLIC_MONITORED_SITES");

    const normalizedSites = uniqueByHost(
      siteRows
        .map((site) => {
          const origin = canonicalOrigin(site.origin);
          const host = publicHost(origin);
          if (!origin || !host) return null;

          return {
            id: site.id,
            host,
            origin,
            url: origin,
            displayName: host,
            faviconUrl: faviconFor(host),
            status: site.status === "VERIFIED" ? "verified" as const : "pending" as const,
            onboardedAt: site.createdAt,
          };
        })
        .filter((site): site is NonNullable<typeof site> => Boolean(site)),
    );

    const siteIds = normalizedSites.map((site) => site.id);

    const [currentCounts, previousCounts, latestRows, trendEvents] = siteIds.length
      ? await withDeadline(Promise.all([
        prisma.siteEvent.groupBy({
          by: ["siteId"],
          where: {
            siteId: { in: siteIds },
            createdAt: { gte: currentStart },
          },
          _count: { _all: true },
        }),
        prisma.siteEvent.groupBy({
          by: ["siteId"],
          where: {
            siteId: { in: siteIds },
            createdAt: {
              gte: previousStart,
              lt: currentStart,
            },
          },
          _count: { _all: true },
        }),
        prisma.siteEvent.groupBy({
          by: ["siteId"],
          where: { siteId: { in: siteIds } },
          _max: { createdAt: true },
        }),
        prisma.siteEvent.findMany({
          where: {
            siteId: { in: siteIds },
            createdAt: { gte: trendStart },
          },
          select: {
            siteId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: TREND_EVENT_LIMIT,
        }),
      ]), "PUBLIC_MONITORED_SITE_EVENTS")
      : [[], [], [], []];

    const currentMap = toCountMap(currentCounts);
    const previousMap = toCountMap(previousCounts);
    const latestMap = toLatestMap(latestRows);
    const trendMap = new Map<string, Map<string, number>>();

    for (const event of trendEvents) {
      const bucket = trendMap.get(event.siteId) || new Map<string, number>();
      const key = dayKey(event.createdAt);
      bucket.set(key, (bucket.get(key) || 0) + 1);
      trendMap.set(event.siteId, bucket);
    }

    const sites: PublicSite[] = normalizedSites.map((site) => {
      const signals = currentMap.get(site.id) || 0;
      const previousSignals = previousMap.get(site.id) || 0;
      const bucket = trendMap.get(site.id);

      return {
        rank: 0,
        host: site.host,
        origin: site.origin,
        url: site.url,
        displayName: site.displayName,
        faviconUrl: site.faviconUrl,
        status: site.status,
        onboardedAt: site.onboardedAt.toISOString(),
        lastSeenAt: isoDate(latestMap.get(site.id)),
        signals,
        previousSignals,
        delta: signals - previousSignals,
        trend: keys.map((key) => bucket?.get(key) || 0),
      };
    });

    const active = ranked([...sites].sort((a, b) => {
      if (b.signals !== a.signals) return b.signals - a.signals;
      if (a.status !== b.status) return a.status === "verified" ? -1 : 1;
      return Date.parse(b.onboardedAt) - Date.parse(a.onboardedAt);
    }).slice(0, CATEGORY_LIMIT));

    const recent = ranked([...sites].sort((a, b) => (
      Date.parse(b.onboardedAt) - Date.parse(a.onboardedAt)
    )).slice(0, CATEGORY_LIMIT));

    const top = ranked([...sites].sort((a, b) => {
      if (b.signals !== a.signals) return b.signals - a.signals;
      return Date.parse(b.onboardedAt) - Date.parse(a.onboardedAt);
    }).slice(0, CATEGORY_LIMIT));

    return json(req, {
      ok: true,
      generatedAt: now.toISOString(),
      window: {
        currentDays: CURRENT_WINDOW_DAYS,
        previousDays: PREVIOUS_WINDOW_DAYS,
        trendDays: TREND_DAYS,
      },
      counts: {
        active: active.length,
        recent: recent.length,
        top: top.length,
      },
      sites: {
        active,
        recent,
        top,
      },
    });
  } catch (error) {
    console.error("[public-monitored-sites] snapshot unavailable", error);
    return json(req, {
      ok: false,
      error: "MONITORED_SITES_UNAVAILABLE",
      generatedAt: now.toISOString(),
    }, { status: 503 });
  }
}
