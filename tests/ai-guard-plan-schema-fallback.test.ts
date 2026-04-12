import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("AI request guard falls back to tier-only plan resolution on account trial schema drift", () => {
  const source = read("src/lib/ai/ai.guard.ts");

  assert.equal(source.includes("isSchemaMismatchError"), true);
  assert.equal(source.includes("\"trialSeatActive\""), true);
  assert.equal(source.includes("\"trialEndsAt\""), true);
  assert.equal(source.includes("SELECT \"tier\""), true);
  assert.equal(source.includes("return resolvePlanIdFromTier(fallback.tier);"), true);
});
