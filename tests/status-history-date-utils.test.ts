import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDayKeyFromDateInTimeZone,
  formatMonthKeyFromDateInTimeZone,
  getMonthWindowUtcForTimeZone,
  normalizeMonthKey,
  resolveHistoryTimeZone,
} from "@/lib/status/historyDate";

test("history date utils derive month/day keys in timezone-safe way", () => {
  const ts = Date.UTC(2026, 1, 1, 7, 30, 0);
  const la = "America/Los_Angeles";

  assert.equal(formatMonthKeyFromDateInTimeZone(ts, "UTC"), "2026-02");
  assert.equal(formatMonthKeyFromDateInTimeZone(ts, la), "2026-01");
  assert.equal(formatDayKeyFromDateInTimeZone(ts, la), "2026-01-31");
});

test("history month windows convert local month boundaries to UTC correctly", () => {
  const la = "America/Los_Angeles";
  const feb = getMonthWindowUtcForTimeZone("2026-02", la);
  assert.equal(feb.start.toISOString(), "2026-02-01T08:00:00.000Z");
  assert.equal(feb.end.toISOString(), "2026-03-01T08:00:00.000Z");
});

test("history date utils normalize invalid month and timezone input", () => {
  assert.equal(normalizeMonthKey("2026-99", "2026-02"), "2026-02");
  assert.equal(resolveHistoryTimeZone("Bad/Timezone", "UTC"), "UTC");
});
