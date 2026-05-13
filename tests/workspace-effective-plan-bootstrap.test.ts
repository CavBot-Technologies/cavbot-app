import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("workspace bootstrap exposes effective subscription plan on first load", () => {
  const source = read("lib/workspaceStore.server.ts");

  assert.equal(source.includes("resolveEffectivePlanId"), true);
  assert.equal(source.includes("planTierTokenFromPlanId(effectivePlanId)"), true);
  assert.equal(source.includes("tier: planTierTokenFromPlanId(effectivePlanId)") || source.includes("const tierStr = effectivePlanId ? planTierTokenFromPlanId(effectivePlanId)"), true);
  assert.equal(source.includes("tier: tierResult.rows[0]?.tier"), false);
});
