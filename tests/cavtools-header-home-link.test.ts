import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavTools studio header routes the visible brandmark home and uses the developer subtitle", () => {
  const source = read("app/cavtools/page.tsx");
  const css = read("app/cavtools/cavtools.css");

  assert.equal(source.includes('if (tab === "studio") return "for developers";'), true);
  assert.equal(source.includes('<Link className="cb-cavtools-title-row" aria-label="Go to homepage" href="/">'), true);
  assert.equal(source.includes('<span className="cb-cavtools-top-sub">{tabSubtitle}</span>'), true);

  assert.equal(css.includes(".cb-cavtools-title-row{"), true);
  assert.equal(css.includes("text-decoration:none;"), true);
  assert.equal(css.includes(".cb-cavtools-title-row:focus-visible{"), true);
});
