import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools account menu uses the shared account-menu hover treatment", () => {
  const source = read("app/cavtools/page.tsx");

  assert.equal(source.includes('className="cb-menu cb-menu-right cb-account-menu"'), true);
});
