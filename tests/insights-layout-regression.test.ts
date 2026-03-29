import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("Insights page keeps required sections and action controls", () => {
  const source = read("app/insights/page.tsx");

  assert.equal(source.includes('aria-label="Insights rollups"'), true);
  assert.equal(source.includes('aria-label="Priority findings"'), true);
  assert.equal(source.includes('aria-label="Signal snapshots"'), true);
  assert.equal(source.includes('aria-label="Trends"'), true);
  assert.equal(source.includes('aria-label="Hotspots"'), true);

  assert.equal(source.includes("data-cavai-create-note"), true);
  assert.equal(source.includes("data-cavai-open-targets"), true);
  assert.equal(source.includes("data-tools-modal"), true);
  assert.equal(source.includes("data-tools-open"), true);
});

test("Insights shell layout keeps structured wrapper without spacer break hacks", () => {
  const source = read("app/insights/page.tsx");

  assert.equal(source.includes('<main className="ins-main ins-shell">'), true);
  assert.equal(source.includes('className="ins-grid ins-shell-section"'), true);
  assert.equal(source.includes('className="cb-card cb-card-pad ins-shell-section"'), true);
  assert.equal(/<br\s*\/?>/.test(source), false, "Insights layout should not depend on explicit spacer breaks.");
});

test("Insights CSS keeps responsive grid and overflow guards", () => {
  const css = read("app/insights/insights.css");

  assert.equal(css.includes(".ins-main.ins-shell{"), true);
  assert.equal(css.includes(".ins-shell-section{"), true);
  assert.equal(css.includes(".ins-findings-main{"), true);
  assert.equal(css.includes(".ins-page .ins-findings-main{"), true);
  assert.equal(css.includes("@media (max-width: 1100px){"), true);
});
