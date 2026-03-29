import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

function buildDaySeries(days: number, build: (index: number, day: string) => Record<string, number | string>) {
  const start = new Date(Date.UTC(2026, 0, 1));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime());
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const iso = `${y}-${m}-${day}`;
    return { day: iso, ...build(i, iso) };
  });
}

function loadOperationalHistoryModule() {
  const req = createRequire(import.meta.url);
  const moduleLoader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return req(path.resolve("lib/publicProfile/operationalHistory.server.ts")) as typeof import("../lib/publicProfile/operationalHistory.server");
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("Operational history view-model emits deterministic real signal series", () => {
  const { buildOperationalHistoryViewModel } = loadOperationalHistoryModule();
  const routesTrend = buildDaySeries(28, (idx) => {
    const isPrevWeek = idx >= 14 && idx <= 20;
    const isCurrentWeek = idx >= 21;
    return {
      sessions: 420,
      views404: isPrevWeek ? 42 : isCurrentWeek ? 14 : 28,
    };
  });
  const errorsTrend = buildDaySeries(28, (idx) => {
    const isPrevWeek = idx >= 14 && idx <= 20;
    const isCurrentWeek = idx >= 21;
    return {
      jsErrors: isPrevWeek ? 26 : isCurrentWeek ? 9 : 16,
      apiErrors: isPrevWeek ? 19 : isCurrentWeek ? 6 : 12,
      views404: 0,
    };
  });

  const summary30d = {
    updatedAtISO: "2026-02-19T12:00:00.000Z",
    trend30d: routesTrend,
    errors: { trend: errorsTrend },
    seo: {
      updatedAtISO: "2026-02-18T09:00:00.000Z",
      rollup: {
        titleCoveragePct: 91,
        descriptionCoveragePct: 86,
        canonicalCoveragePct: 95,
      },
    },
  };

  const first = buildOperationalHistoryViewModel({
    username: "signal-user",
    workspaceKey: "signal-user",
    summary30d,
    allowErrors: true,
    allowSeo: true,
    arcadeEnabled: true,
  });
  const second = buildOperationalHistoryViewModel({
    username: "signal-user",
    workspaceKey: "signal-user",
    summary30d,
    allowErrors: true,
    allowSeo: true,
    arcadeEnabled: true,
  });

  assert.deepEqual(first, second, "Output should be deterministic for fixed scan inputs.");
  assert.equal(first.hasTelemetry, true);
  assert.equal(first.signalSeries.length, 28);
  assert.equal(first.signalSeries.some((point) => point.score > 0), true);
  assert.equal(typeof first.primarySignal, "string");
  assert.equal(first.entries.length > 0, true);
  assert.equal(first.entries.some((entry) => entry.signal.length > 0), true);
  assert.equal(first.entries.some((entry) => entry.windowLabel.length > 0), true);
});

test("Public profile Operational History section keeps graph-first signal rendering hooks", () => {
  const page = read("app/u/[username]/page.tsx");
  const css = read("app/u/[username]/public-profile.css");
  const viz = read("app/u/[username]/OperationalHistoryConstellation.tsx");

  assert.equal(page.includes("Signal stream"), true);
  assert.equal(page.includes("pp-ohSignalLead"), true);
  assert.equal(page.includes("signalSeries={vm.sections.operationalHistory?.signalSeries || []}"), true);
  assert.equal(page.includes("pp-ohSignal"), true);
  assert.equal(css.includes(".pp-ohGraphLine{"), true);
  assert.equal(css.includes(".pp-ohGraphArea{"), true);
  assert.equal(viz.includes("buildGraph("), true);
  assert.equal(viz.includes("pp-ohGraphLine"), true);
});
