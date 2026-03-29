"use client";

import * as React from "react";

type ConstellationEntry = {
  tone?: "good" | "ok" | "neutral";
  ageWeeks?: number;
};

type SignalPoint = {
  day: string;
  score: number; // 0..100
};

type Point = { x: number; y: number; score: number };

const CHART_W = 320;
const CHART_H = 128;
const PAD = { top: 10, right: 12, bottom: 22, left: 28 };

function clampScore(raw: number) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function buildSeries(input: number[], telemetryReady: boolean): number[] {
  const cleaned = input.map(clampScore).filter((v) => Number.isFinite(v));
  if (cleaned.some((v) => v > 0)) return cleaned;

  const len = Math.max(28, cleaned.length || 28);
  return Array.from({ length: len }, (_, idx) => {
    const progress = (idx + 1) / len;
    const baseline = telemetryReady ? 14 + progress * 30 : 10 + progress * 18;
    const wave = Math.sin(idx * 0.62) * 2.3 + Math.cos(idx * 0.28) * 1.6;
    return clampScore(baseline + wave);
  });
}

function movingAverageSeries(values: number[], size: number): number[] {
  const window = Math.max(1, Math.trunc(size) || 1);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((sum, n) => sum + n, 0) / Math.max(1, slice.length);
    out.push(avg);
  }
  return out;
}

function toPoints(values: number[]): Point[] {
  if (!values.length) return [];
  const width = CHART_W - PAD.left - PAD.right;
  const height = CHART_H - PAD.top - PAD.bottom;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  return values.map((value, idx) => ({
    x: PAD.left + idx * step,
    y: PAD.top + ((100 - clampScore(value)) / 100) * height,
    score: clampScore(value),
  }));
}

function smoothPath(points: Point[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;

  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  const tension = 0.18;

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const pPrev = points[i - 2] || p0;
    const pNext = points[i + 1] || p1;

    const cp1x = p0.x + (p1.x - pPrev.x) * tension;
    const cp1y = p0.y + (p1.y - pPrev.y) * tension;
    const cp2x = p1.x - (pNext.x - p0.x) * tension;
    const cp2y = p1.y - (pNext.y - p0.y) * tension;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
  }

  return d;
}

function areaPath(points: Point[]): string {
  if (!points.length) return "";
  const line = smoothPath(points);
  const bottom = CHART_H - PAD.bottom;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${line} L ${last.x.toFixed(2)} ${bottom.toFixed(2)} L ${first.x.toFixed(2)} ${bottom.toFixed(2)} Z`;
}

function buildGraph(points: Point[]) {
  return {
    line: smoothPath(points),
    area: areaPath(points),
  };
}

function latestMovingAverage(values: number[], size: number) {
  if (!values.length) return 0;
  const win = values.slice(-Math.max(1, size));
  return win.reduce((sum, v) => sum + v, 0) / Math.max(1, win.length);
}

export function OperationalHistoryConstellation({
  username,
  entries,
  signalSeries,
  hasTelemetry,
}: {
  username: string;
  entries?: ConstellationEntry[];
  signalSeries?: SignalPoint[];
  hasTelemetry?: boolean;
}) {
  const scores = (Array.isArray(signalSeries) ? signalSeries : [])
    .slice(-28)
    .map((point) => clampScore(Number(point?.score || 0)));
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [axisScaleX, setAxisScaleX] = React.useState(1);

  React.useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      const sx = (rect.width || CHART_W) / CHART_W;
      const sy = (rect.height || CHART_H) / CHART_H;
      if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) {
        setAxisScaleX(1);
        return;
      }
      // `preserveAspectRatio="none"` stretches x/y independently.
      // Compensate only text glyphs so labels keep natural proportions.
      const next = Math.max(0.35, Math.min(2.4, sy / sx));
      setAxisScaleX(next);
    };
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(sync);
    });
    ro.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const hasSignalData = scores.some((score) => score > 0);
  const telemetryReady = Boolean(hasTelemetry);
  void username;
  const series = buildSeries(scores, telemetryReady);
  const baseline = movingAverageSeries(series, 5);
  const points = toPoints(series);
  const baselinePoints = toPoints(baseline);
  const graph = buildGraph(points);
  const linePath = graph.line;
  const baselinePath = smoothPath(baselinePoints);
  const fillPath = graph.area;
  const latest = latestMovingAverage(series, 5);
  const prior = series.length >= 10 ? latestMovingAverage(series.slice(0, -5), 5) : latest;
  const delta = latest - prior;
  const eventPressure = Math.min(1, (Array.isArray(entries) ? entries.length : 0) / 12);
  const trendTone = !hasSignalData ? "warming" : delta >= 0 ? "up" : "down";

  const yTicks = [100, 75, 50, 25, 0];
  const xTickIdx = (() => {
    const last = Math.max(0, points.length - 1);
    const idx = [0, Math.round(last * 0.33), Math.round(last * 0.66), last];
    return Array.from(new Set(idx)).sort((a, b) => a - b);
  })();
  const xTickLabels = ["-21d", "-14d", "-7d", "Now"];
  const latestPoint = points[points.length - 1] || null;
  const textNormalizeTransform = (x: number, y: number) => {
    if (Math.abs(axisScaleX - 1) < 0.001) return undefined;
    return `translate(${x} ${y}) scale(${axisScaleX.toFixed(5)} 1) translate(${-x} ${-y})`;
  };
  const pointRx = (r: number) => Math.max(0.8, r * axisScaleX);

  return (
    <svg
      ref={svgRef}
      className="pp-ohChart"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-telemetry={telemetryReady ? "ready" : "warming"}
      data-tone={trendTone}
      style={
        {
          ["--pp-oh-line-alpha" as never]: hasSignalData ? "0.96" : "0.78",
          ["--pp-oh-area-alpha" as never]: hasSignalData ? (0.07 + eventPressure * 0.05).toFixed(3) : "0.04",
          ["--pp-oh-point-alpha" as never]: hasSignalData ? "0.98" : "0.72",
        } as React.CSSProperties
      }
    >
      <g className="pp-ohGrid" aria-hidden="true">
        {yTicks.map((tick) => {
          const y = PAD.top + ((100 - tick) / 100) * (CHART_H - PAD.top - PAD.bottom);
          return <line key={`y-${tick}`} x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y} />;
        })}
      </g>

      <g className="pp-ohAxisLabels" aria-hidden="true">
        {yTicks.map((tick) => {
          const y = PAD.top + ((100 - tick) / 100) * (CHART_H - PAD.top - PAD.bottom);
          return (
            <text
              key={`yl-${tick}`}
              x={4}
              y={y + 3}
              className="pp-ohAxisText"
              transform={textNormalizeTransform(4, y + 3)}
            >
              {tick}
            </text>
          );
        })}
        {xTickIdx.map((idx, i) => {
          const point = points[idx];
          if (!point) return null;
          return (
            <text
              key={`xl-${idx}`}
              x={point.x}
              y={CHART_H - 6}
              className="pp-ohTickText"
              transform={textNormalizeTransform(point.x, CHART_H - 6)}
            >
              {xTickLabels[Math.min(i, xTickLabels.length - 1)]}
            </text>
          );
        })}
      </g>

      <path className="pp-ohArea pp-ohGraphArea" d={fillPath} />
      <path className="pp-ohBaseline" d={baselinePath} />
      <path className="pp-ohLine pp-ohGraphLine" d={linePath} />

      {latestPoint ? (
        <>
          <ellipse className="pp-ohPointRing" cx={latestPoint.x} cy={latestPoint.y} rx={pointRx(4.8)} ry={4.8} />
          <ellipse className="pp-ohPoint" cx={latestPoint.x} cy={latestPoint.y} rx={pointRx(2.4)} ry={2.4} />
        </>
      ) : null}
    </svg>
  );
}
