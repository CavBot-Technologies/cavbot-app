import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("settings widget and status page use the shared useSystemStatus hook", () => {
  const settingsWidget = read("app/settings/sections/SettingsStatusCard.tsx");
  const statusOverview = read("components/status/StatusLiveOverview.tsx");

  assert.equal(settingsWidget.includes("useSystemStatus"), true);
  assert.equal(statusOverview.includes("useSystemStatus"), true);
  assert.equal(settingsWidget.includes('fetch("/api/status"'), false);
});

test("root layout starts the system status bootstrap on app load", () => {
  const layout = read("app/layout.tsx");
  assert.equal(layout.includes("SystemStatusBootstrap"), true);
  assert.equal(layout.includes("<SystemStatusBootstrap />"), true);
});

test("system status page renders the shared live overview surface", () => {
  const statusPage = read("app/status/page.tsx");
  assert.equal(statusPage.includes("<StatusLiveOverview"), true);
  assert.equal(statusPage.includes("<StatusTimelineSection"), true);
});

test("shared system status hook is configured for polling and dedupe", () => {
  const hookSource = read("lib/hooks/useSystemStatus.ts");
  assert.equal(hookSource.includes("refreshInterval"), true);
  assert.equal(hookSource.includes("dedupingInterval"), true);
  assert.equal(hookSource.includes("keepPreviousData"), true);
});

test("system status timeline route is wired to shared system-status pipeline", () => {
  const timelineRoute = read("app/api/system-status/timeline/route.ts");
  assert.equal(timelineRoute.includes("getSystemStatusTimeline"), true);
  assert.equal(timelineRoute.includes("SYSTEM_STATUS_TIMELINE_FAILED"), true);
});

test("status history page is wired to shared system-status month metrics", () => {
  const historyPage = read("app/status/history/page.tsx");
  const historyClient = read("app/status/history/StatusHistoryClient.tsx");
  assert.equal(historyPage.includes("getSystemStatusHistoryMonthMetrics"), true);
  assert.equal(historyPage.includes("<StatusHistoryClient"), true);
  assert.equal(historyClient.includes("filterIncidentsForSelectedDay"), true);
  assert.equal(historyClient.includes("status-history-calendar-popover"), true);
});

test("status history api merges month metrics from shared system-status pipeline", () => {
  const historyRoute = read("app/api/status/history/route.ts");
  assert.equal(historyRoute.includes("getSystemStatusHistoryMonthMetrics"), true);
  assert.equal(historyRoute.includes("metrics: monthWindow.metrics"), true);
});

test("status timeline labels use deterministic UTC day formatting to prevent hydration drift", () => {
  const timeline = read("components/status/StatusTimeline.tsx");
  assert.equal(timeline.includes('timeZone: "UTC"'), true);
  assert.equal(timeline.includes("formatTimelineDay(entry.dayKey)"), true);
});
