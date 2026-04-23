import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath) {
  return fs.readFileSync(path.resolve(relPath), "utf8");
}

test("local analytics runtime captures the full vitals payload promised by the UI", () => {
  const source = read("public/cavai/cavai-analytics-v5.js");

  assert.equal(source.includes("fcpMs"), true);
  assert.equal(source.includes("inpMs"), true);
  assert.equal(source.includes('type: "event"'), true);
  assert.equal(source.includes('type: "first-input"'), true);
  assert.equal(source.includes('first-contentful-paint'), true);
});
