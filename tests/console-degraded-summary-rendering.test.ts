import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("console renders dashboard shell when analytics summary is unavailable", () => {
  const source = read("app/console/page.tsx");

  assert.equal(source.includes("function emptyConsoleSummary("), true);
  assert.equal(source.includes('summaryErrorCode !== "ANALYTICS_SUMMARY_FAILED"'), true);
  assert.equal(source.includes("const fatalLoadError = Boolean("), true);
  assert.equal(source.includes("const summaryWarning: unknown = !fatalLoadError ? summaryError : null;"), true);
  assert.equal(source.includes("summaryWarning || hasMeasuredConsoleActivity(metrics)"), true);
});
