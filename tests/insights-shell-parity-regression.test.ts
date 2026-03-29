import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("Insights shell keeps console-section wrappers in expected order", () => {
  const source = read("app/insights/page.tsx");

  const heroIdx = source.indexOf('aria-label="Insights rollups"');
  const findingsIdx = source.indexOf('aria-label="Priority findings"');
  const snapshotsIdx = source.indexOf('aria-label="Signal snapshots"');
  const trendIdx = source.indexOf('aria-label="Trends"');
  const hotspotsIdx = source.indexOf('aria-label="Hotspots"');

  assert.equal(heroIdx > -1, true);
  assert.equal(findingsIdx > heroIdx, true);
  assert.equal(snapshotsIdx > findingsIdx, true);
  assert.equal(trendIdx > snapshotsIdx, true);
  assert.equal(hotspotsIdx > trendIdx, true);
});

test("Insights shell keeps rebuilt spacing hooks and no explicit spacer tags", () => {
  const source = read("app/insights/page.tsx");
  const css = read("app/insights/insights.css");

  assert.equal(source.includes('<main className="ins-main ins-shell">'), true);
  assert.equal(source.includes('className="ins-grid ins-shell-section"'), true);
  assert.equal(source.includes('className="ins-split ins-shell-section ins-lower-section"'), true);
  assert.equal(/<br\s*\/?>/.test(source), false);

  assert.equal(css.includes(".ins-main.ins-shell{"), true);
  assert.equal(css.includes(".ins-shell-section{"), true);
  assert.equal(css.includes(".ins-page .ins-findings-main{"), true);
});
