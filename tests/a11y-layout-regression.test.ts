import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("A11y page keeps required sections and controls", () => {
  const source = read("app/a11y/page.tsx");

  assert.equal(source.includes('aria-label="Accessibility rollups"'), true);
  assert.equal(source.includes('aria-label="Coverage and integrity"'), true);
  assert.equal(source.includes('aria-label="Accessibility volumes"'), true);
  assert.equal(source.includes('aria-label="Page audits"'), true);
  assert.equal(source.includes('aria-label="Dashboard tools"'), true);

  assert.equal(source.includes("data-range-select"), true);
  assert.equal(source.includes("data-tools-open"), true);
  assert.equal(source.includes("data-tools-modal"), true);
});

test("A11y shell layout uses structured wrapper with explicit spacer breaks", () => {
  const source = read("app/a11y/page.tsx");

  assert.equal(source.includes('<main className="a11y-main">'), true);
  assert.equal(/<br\s*\/?>/.test(source), true, "A11y layout should preserve explicit spacer breaks.");
});

test("A11y CSS keeps shell rhythm and responsive guards", () => {
  const css = read("app/a11y/a11y.css");

  assert.equal(css.includes(".a11y-main{"), true);
  assert.equal(css.includes(".a11y-section{"), true);
  assert.equal(css.includes(".a11y-grid .cb-card{"), true);
  assert.equal(css.includes(".a11y-head-left{"), true);
});
