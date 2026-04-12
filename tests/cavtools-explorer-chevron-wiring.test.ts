import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools explorer uses the right-aligned site-style dropdown chevron instead of a text glyph", () => {
  const pageSource = read("app/cavtools/page.tsx");
  const cssSource = read("app/cavtools/cavtools.css");

  assert.equal(pageSource.includes('<span className="cb-cavtools-grouplabel">{root.label}</span>'), true);
  assert.equal(pageSource.includes('<span className={`cb-cavtools-groupchev ${isOpen ? "is-open" : ""}`} aria-hidden="true" />'), true);

  assert.equal(cssSource.includes(".cb-cavtools-grouplabel{"), true);
  assert.equal(cssSource.includes("justify-content:space-between;"), true);
  assert.equal(cssSource.includes("background-image: url(\"data:image/svg+xml,%3Csvg"), true);
  assert.equal(cssSource.includes(".cb-cavtools-groupchev.is-open{ transform: rotate(180deg); }"), true);
});
