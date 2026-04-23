import "server-only";

import type { SummaryRange } from "@/lib/cavbotApi.server";
import { getAuthPool, newDbId, withAuthTransaction } from "@/lib/authDb";

type WebVitalsRecord = {
  routePath: string;
  pageUrl: string | null;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  eventId: string | null;
  sessionKey: string | null;
  sampleAt: Date;
};

type RawRollupRow = {
  samples: number | string | null;
  updatedAt: Date | string | null;
  lcpP75Ms: number | string | null;
  inpP75Ms: number | string | null;
  clsP75: number | string | null;
  fcpP75Ms: number | string | null;
  ttfbP75Ms: number | string | null;
};

type RawRouteRollupRow = {
  slowPagesCount: number | string | null;
  unstableLayoutPages: number | string | null;
};

export type SiteWebVitalsRollup = {
  updatedAtISO: string | null;
  samples: number;
  lcpP75Ms: number | null;
  inpP75Ms: number | null;
  clsP75: number | null;
  fcpP75Ms: number | null;
  ttfbP75Ms: number | null;
  slowPagesCount: number;
  unstableLayoutPages: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asDateInput(value: unknown): Date | string | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRoutePath(value: unknown, pageUrl: string | null) {
  const raw = String(value || "").trim();
  if (raw) {
    if (raw.startsWith("/")) return raw;
    try {
      const url = new URL(raw);
      return `${url.pathname || "/"}${url.search || ""}` || "/";
    } catch {
      return `/${raw.replace(/^\/+/, "")}` || "/";
    }
  }

  if (!pageUrl) return "/";
  try {
    const url = new URL(pageUrl);
    return `${url.pathname || "/"}${url.search || ""}` || "/";
  } catch {
    return "/";
  }
}

function parsePayloadJson(value: unknown) {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function rangeToInterval(range: SummaryRange | undefined) {
  if (range === "24h") return "1 day";
  if (range === "7d") return "7 days";
  if (range === "14d") return "14 days";
  return "30 days";
}

function extractWebVitalsRecords(payload: Record<string, unknown> | null | undefined) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const out: WebVitalsRecord[] = [];

  for (const item of records.slice(0, 48)) {
    const record = asRecord(item);
    if (!record) continue;

    const eventType = String(record.event_type || record.eventType || record.event_name || "").trim().toLowerCase();
    if (eventType !== "web_vitals" && eventType !== "cavbot_web_vitals") continue;

    const payloadJson = parsePayloadJson(record.payload_json ?? record.payloadJson);
    if (!payloadJson) continue;

    const pageUrl = String(record.page_url || record.pageUrl || payloadJson.url || "").trim() || null;
    const routePath = normalizeRoutePath(record.route_path || record.routePath || payloadJson.path, pageUrl);

    const lcpMs = asNumber(payloadJson.lcpMs);
    const inpMs = asNumber(payloadJson.inpMs);
    const cls = asNumber(payloadJson.cls);
    const fcpMs = asNumber(payloadJson.fcpMs);
    const ttfbMs = asNumber(payloadJson.ttfbMs);
    if (lcpMs == null && inpMs == null && cls == null && fcpMs == null && ttfbMs == null) continue;

    const sampleAt =
      asDate(
        asDateInput(record.event_timestamp) ||
          asDateInput(record.eventTimestamp) ||
          asDateInput(payloadJson.tsISO) ||
          asDateInput(payloadJson.detectedAt) ||
          null,
      ) || new Date();

    out.push({
      routePath,
      pageUrl,
      lcpMs: lcpMs == null ? null : Math.round(clamp(lcpMs, 0, 120_000)),
      inpMs: inpMs == null ? null : Math.round(clamp(inpMs, 0, 120_000)),
      cls: cls == null ? null : clamp(Number(cls.toFixed(4)), 0, 10),
      fcpMs: fcpMs == null ? null : Math.round(clamp(fcpMs, 0, 120_000)),
      ttfbMs: ttfbMs == null ? null : Math.round(clamp(ttfbMs, 0, 120_000)),
      eventId: String(record.event_id || record.eventId || "").trim() || null,
      sessionKey: String(record.session_key || record.sessionKey || "").trim() || null,
      sampleAt,
    });
  }

  return out;
}

export function payloadContainsWarmTelemetry(payload: Record<string, unknown> | null | undefined) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  return records.some((item) => {
    const record = asRecord(item);
    if (!record) return false;
    const eventType = String(record.event_type || record.eventType || record.event_name || "").trim().toLowerCase();
    return eventType === "page_view" || eventType === "cavbot_page_view" || eventType === "web_vitals" || eventType === "cavbot_web_vitals";
  });
}

export async function recordWebVitalsSamplesBestEffort(args: {
  siteId: string;
  siteOrigin: string;
  payload?: Record<string, unknown> | null;
}) {
  const samples = extractWebVitalsRecords(args.payload);
  if (!samples.length) return 0;

  try {
    await withAuthTransaction(async (tx) => {
      for (const sample of samples) {
        const meta = JSON.stringify({
          origin: args.siteOrigin,
          routePath: sample.routePath,
          pageUrl: sample.pageUrl,
          lcpMs: sample.lcpMs,
          inpMs: sample.inpMs,
          cls: sample.cls,
          fcpMs: sample.fcpMs,
          ttfbMs: sample.ttfbMs,
          eventId: sample.eventId,
          sessionKey: sample.sessionKey,
        });

        await tx.query(
          `INSERT INTO "SiteEvent" (
             "id",
             "siteId",
             "type",
             "message",
             "tone",
             "meta",
             "createdAt"
           )
           VALUES (
             $1,
             $2,
             'WEB_VITALS_SAMPLE',
             'Web vitals sample recorded',
             NULL,
             $3::jsonb,
             $4
           )`,
          [newDbId(), args.siteId, meta, sample.sampleAt],
        );
      }
    });
  } catch (error) {
    console.error("[web-vitals] sample persistence failed", error);
    return 0;
  }

  return samples.length;
}

export async function fetchSiteWebVitalsRollup(args: {
  siteId: string;
  range?: SummaryRange;
}): Promise<SiteWebVitalsRollup | null> {
  const interval = rangeToInterval(args.range);
  const values = [args.siteId, interval];

  const rollup = await getAuthPool().query<RawRollupRow>(
    `WITH samples AS (
       SELECT
         "createdAt",
         NULLIF(COALESCE("meta"->>'routePath', "meta"->>'path'), '') AS route_path,
         CASE WHEN NULLIF("meta"->>'lcpMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'lcpMs', '')::double precision END AS lcp_ms,
         CASE WHEN NULLIF("meta"->>'inpMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'inpMs', '')::double precision END AS inp_ms,
         CASE WHEN NULLIF("meta"->>'cls', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'cls', '')::double precision END AS cls,
         CASE WHEN NULLIF("meta"->>'fcpMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'fcpMs', '')::double precision END AS fcp_ms,
         CASE WHEN NULLIF("meta"->>'ttfbMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'ttfbMs', '')::double precision END AS ttfb_ms
       FROM "SiteEvent"
       WHERE "siteId" = $1
         AND "type" = 'WEB_VITALS_SAMPLE'
         AND "createdAt" >= NOW() - $2::interval
     )
     SELECT
       COUNT(*) FILTER (
         WHERE lcp_ms IS NOT NULL
            OR inp_ms IS NOT NULL
            OR cls IS NOT NULL
            OR fcp_ms IS NOT NULL
            OR ttfb_ms IS NOT NULL
       )::int AS "samples",
       MAX("createdAt") AS "updatedAt",
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) FILTER (WHERE lcp_ms IS NOT NULL) AS "lcpP75Ms",
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms) FILTER (WHERE inp_ms IS NOT NULL) AS "inpP75Ms",
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cls) FILTER (WHERE cls IS NOT NULL) AS "clsP75",
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fcp_ms) FILTER (WHERE fcp_ms IS NOT NULL) AS "fcpP75Ms",
       PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ttfb_ms) FILTER (WHERE ttfb_ms IS NOT NULL) AS "ttfbP75Ms"
     FROM samples`,
    values,
  );

  const routeRollup = await getAuthPool().query<RawRouteRollupRow>(
    `WITH samples AS (
       SELECT
         NULLIF(COALESCE("meta"->>'routePath', "meta"->>'path'), '') AS route_path,
         CASE WHEN NULLIF("meta"->>'lcpMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'lcpMs', '')::double precision END AS lcp_ms,
         CASE WHEN NULLIF("meta"->>'inpMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'inpMs', '')::double precision END AS inp_ms,
         CASE WHEN NULLIF("meta"->>'cls', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'cls', '')::double precision END AS cls,
         CASE WHEN NULLIF("meta"->>'ttfbMs', '') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN NULLIF("meta"->>'ttfbMs', '')::double precision END AS ttfb_ms
       FROM "SiteEvent"
       WHERE "siteId" = $1
         AND "type" = 'WEB_VITALS_SAMPLE'
         AND "createdAt" >= NOW() - $2::interval
     ),
     route_rollups AS (
       SELECT
         route_path,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY lcp_ms) FILTER (WHERE lcp_ms IS NOT NULL) AS lcp_p75_ms,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY inp_ms) FILTER (WHERE inp_ms IS NOT NULL) AS inp_p75_ms,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cls) FILTER (WHERE cls IS NOT NULL) AS cls_p75,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ttfb_ms) FILTER (WHERE ttfb_ms IS NOT NULL) AS ttfb_p75_ms
       FROM samples
       WHERE route_path IS NOT NULL
       GROUP BY route_path
     )
     SELECT
       COUNT(*) FILTER (
         WHERE COALESCE(lcp_p75_ms, 0) > 4000
            OR COALESCE(inp_p75_ms, 0) > 500
            OR COALESCE(ttfb_p75_ms, 0) > 1800
       )::int AS "slowPagesCount",
       COUNT(*) FILTER (WHERE COALESCE(cls_p75, 0) > 0.25)::int AS "unstableLayoutPages"
     FROM route_rollups`,
    values,
  );

  const row = rollup.rows[0];
  if (!row || asInt(row.samples) <= 0) return null;

  const routeRow = routeRollup.rows[0];
  const updatedAt = asDate(row.updatedAt);

  return {
    updatedAtISO: updatedAt ? updatedAt.toISOString() : null,
    samples: asInt(row.samples),
    lcpP75Ms: asNumber(row.lcpP75Ms),
    inpP75Ms: asNumber(row.inpP75Ms),
    clsP75: asNumber(row.clsP75),
    fcpP75Ms: asNumber(row.fcpP75Ms),
    ttfbP75Ms: asNumber(row.ttfbP75Ms),
    slowPagesCount: asInt(routeRow?.slowPagesCount),
    unstableLayoutPages: asInt(routeRow?.unstableLayoutPages),
  };
}
