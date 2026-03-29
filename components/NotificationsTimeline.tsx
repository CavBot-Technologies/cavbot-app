"use client";

import { useEffect, useMemo, useState } from "react";

type RangeKey = "24h" | "7d" | "14d" | "30d";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "14d", label: "14 Days" },
  { value: "30d", label: "30 Days" },
];

const WINDOW_DAYS: Record<RangeKey, number> = {
  "24h": 7,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

const CHART_WIDTH = 980;
const CHART_HEIGHT = 210;
const CHART_PADDING = 12;

type TrendPoint = { day: string; sessions: number; views404: number };
type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Dict;
  }
  return null;
}

function n(value: unknown, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

function parseISODate(value: string) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return Number.isFinite(date.getTime()) ? date : null;
}

function toISODateUTC(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysUTC(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeTrendDays(raw: unknown, windowDays: number): TrendPoint[] {
  const arr = Array.isArray(raw) ? raw : [];
  const points: TrendPoint[] = arr
    .map((point) => {
      const dict = asDict(point);
      return {
        day:
          typeof dict?.day === "string"
            ? dict.day.slice(0, 10)
            : typeof dict?.date === "string"
            ? dict.date.slice(0, 10)
            : "",
        sessions: n(dict?.sessions ?? dict?.views ?? dict?.pageViews ?? 0),
        views404: n(dict?.views404 ?? dict?.v404 ?? dict?.notFoundViews ?? 0),
      };
    })
    .filter((p) => !!p.day);

  if (!points.length) return [];

  const last = parseISODate(points[points.length - 1].day) || new Date();
  const start = addDaysUTC(last, -(windowDays - 1));

  const byDay = new Map(points.map((p) => [p.day, p]));
  const out: TrendPoint[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const day = toISODateUTC(addDaysUTC(start, i));
    const existing = byDay.get(day);
    out.push({
      day,
      sessions: existing ? n(existing.sessions, 0) : 0,
      views404: existing ? n(existing.views404, 0) : 0,
    });
  }
  return out;
}

function fmtInt(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function svgBars(series: number[], width: number, height: number, pad = 10) {
  const max = Math.max(1, ...series);
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const bars = Math.max(series.length, 1);
  const gap = Math.max(2, Math.floor(innerWidth / bars) * 0.22);
  const barWidth = Math.max(3, Math.floor((innerWidth - gap * (bars - 1)) / bars));

  let x = pad;
  const rects: string[] = [];
  for (let i = 0; i < bars; i += 1) {
    const value = series[i] ?? 0;
    const barHeight = Math.max(1, Math.round((value / max) * innerHeight));
    const y = pad + (innerHeight - barHeight);
    rects.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" ry="6" />`);
    x += barWidth + gap;
  }
  return rects.join("");
}

function svgLinePath(series: number[], width: number, height: number, pad = 10) {
  const max = Math.max(1, ...series);
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const pointsCount = Math.max(series.length, 1);
  const step = pointsCount > 1 ? innerWidth / (pointsCount - 1) : 0;

  const points: Array<[number, number]> = [];
  for (let i = 0; i < pointsCount; i += 1) {
    const value = series[i] ?? 0;
    const x = pad + step * i;
    const y = pad + (innerHeight - (value / max) * innerHeight);
    points.push([x, y]);
  }

  if (!points.length) return "";

  let path = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` L ${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;
  }
  return path;
}

export default function NotificationsTimeline() {
  const [range, setRange] = useState<RangeKey>("24h");
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const fetchTimeline = async () => {
      setLoading(true);
      setError(null);
      setTrend([]);

      try {
        const summaryRange = range === "30d" ? "30d" : "7d";
        const params = new URLSearchParams({ range: summaryRange });
        const response = await fetch(`/api/summary?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          | { ok?: boolean; data?: unknown; error?: string }
          | null;

        if (!response.ok || payload?.ok === false || !payload?.data) {
          throw new Error(payload?.error || "Unable to load timeline data.");
        }

        if (!active) return;

        const summary = asDict(payload.data);
        const rawTrend =
          range === "30d" ? summary?.trend30d ?? summary?.trend ?? null : summary?.trend7d ?? summary?.trend ?? null;
        const normalized = normalizeTrendDays(rawTrend, WINDOW_DAYS[range]);
        if (active) setTrend(normalized);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Unable to load timeline data.";
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchTimeline();

    return () => {
      active = false;
      controller.abort();
    };
  }, [range]);

  const sessionsSeries = useMemo(() => trend.map((point) => point.sessions), [trend]);
  const views404Series = useMemo(() => trend.map((point) => point.views404), [trend]);
  const windowLabel = range === "24h" ? "7D" : range === "7d" ? "7D" : range === "14d" ? "14D" : "30D";

  return (
    <div className="notifications-timeline">
      <label className="notifications-timeline-range">
        <span className="notifications-timeline-label">Timeline</span>
        <select
          className="notifications-timeline-select"
          value={range}
          onChange={(event) => setRange(event.target.value as RangeKey)}
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="notifications-timeline-chartbox">
        {loading ? (
          <div className="notifications-timeline-loading">Loading timeline…</div>
        ) : error ? (
          <div className="notifications-timeline-error">{error}</div>
        ) : trend.length ? (
          <div className="routes-chartwrap">
            <div className="routes-chartmeta">
              <span className="routes-pill">
                Window: <b>{windowLabel}</b>
              </span>
              <span className="routes-pill">
                Points: <b>{fmtInt(trend.length)}</b>
              </span>
            </div>
            <br />
            <div className="routes-chart" aria-label="Sessions trend with 404 overlay">
              <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height="150" role="img" aria-hidden="false">
                <g
                  className="routes-bars"
                  dangerouslySetInnerHTML={{ __html: svgBars(sessionsSeries, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING) }}
                />
                <path className="routes-line" d={svgLinePath(views404Series, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING)} />
              </svg>
              <div className="routes-chartlegend">
                <span className="routes-legend-item">
                  <span className="routes-dot routes-dot-bars" /> Sessions
                </span>
                <span className="routes-legend-item">
                  <span className="routes-dot routes-dot-line" /> 404 views
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="routes-empty">
            <div className="routes-empty-title">No trend data available yet.</div>
            <div className="routes-empty-sub">
              As traffic arrives, CavBot will build a route activity timeline (sessions + 404 overlay) without synthetic filler.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
