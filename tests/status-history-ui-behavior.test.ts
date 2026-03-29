import assert from "node:assert/strict";
import test from "node:test";
import {
  filterIncidentsForSelectedDay,
  getHistoryHeadingLabel,
  selectHistoryDay,
  selectHistoryMonth,
} from "@/lib/status/historyView";
import type { StatusHistoryMonthIncident } from "@/lib/status/types";

const SAMPLE_INCIDENTS: StatusHistoryMonthIncident[] = [
  {
    id: "inc-1",
    title: "API timeouts",
    status: "MONITORING",
    impact: "MAJOR",
    startedAt: "2026-02-20T03:30:00.000Z",
    resolvedAt: null,
    affectedServices: ["cavai"],
    updatesCount: 2,
  },
  {
    id: "inc-2",
    title: "Probe failures",
    status: "RESOLVED",
    impact: "MINOR",
    startedAt: "2026-02-20T20:10:00.000Z",
    resolvedAt: "2026-02-20T22:00:00.000Z",
    affectedServices: ["cavcloud"],
    updatesCount: 3,
  },
];

test("history behavior: selecting day filters incident list", () => {
  const tz = "America/Los_Angeles";
  const dayState = selectHistoryDay(
    { selectedMonth: "2026-02", selectedDay: null },
    "2026-02-19"
  );
  const visible = filterIncidentsForSelectedDay(SAMPLE_INCIDENTS, dayState.selectedDay, tz);

  assert.equal(dayState.selectedMonth, "2026-02");
  assert.equal(dayState.selectedDay, "2026-02-19");
  assert.deepEqual(visible.map((row) => row.id), ["inc-1"]);
});

test("history behavior: selecting month clears day selection and updates heading", () => {
  const tz = "America/Los_Angeles";
  const withDay = {
    selectedMonth: "2026-02",
    selectedDay: "2026-02-19",
  };
  const monthState = selectHistoryMonth(withDay, "2026-03");

  const before = getHistoryHeadingLabel(withDay.selectedMonth, tz);
  const after = getHistoryHeadingLabel(monthState.selectedMonth, tz);

  assert.equal(monthState.selectedMonth, "2026-03");
  assert.equal(monthState.selectedDay, null);
  assert.notEqual(after, before);
});
