import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavcode primary sidebar keeps the Caven atom brand mark centered behind the Caven panel only", () => {
  const page = read("app/cavcode/page.tsx");
  const css = read("app/cavcode/cavcode.css");

  assert.equal(page.includes('activity === "ai" ? ('), true);
  assert.equal(page.includes('className="cc-sidebar-brandMark"'), true);
  assert.equal(page.includes('src="/icons/app/cavcode/atom-svgrepo-com.svg"'), true);
  assert.equal(page.includes("width={72}"), true);
  assert.equal(page.includes("height={72}"), true);
  assert.equal(page.includes('className="cc-sidebar-brandMarkImg"'), true);
  assert.equal(css.includes(".cc-sidebar-brandMark{"), true);
  assert.equal(css.includes("width: 72px;"), true);
  assert.equal(css.includes("height: 72px;"), true);
  assert.equal(css.includes(".cc-sidebar > :not(.cc-sidebar-brandMark){"), true);
  assert.equal(css.includes("transform: translate(-50%, -50%);"), true);
});
