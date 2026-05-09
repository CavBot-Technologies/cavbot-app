import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("CavAi Center model picker treats policy catalog as authoritative", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("function filterCenterModelOptionsForPlan("), true);
  assert.equal(source.includes("function filterCenterReasoningLevelsForPlan("), true);
  assert.equal(source.includes("function centerPlanModelOptions("), true);
  assert.equal(source.includes("ALIBABA_QWEN_CODER_MODEL_ID"), true);
  assert.equal(source.includes("const policyPlanLagging = planTierRank(policyPlanId) < planTierRank(accountPlanId);"), true);
  assert.equal(source.includes("policyPlanLagging"), true);
  assert.equal(source.includes("normalizeCenterModelOptions(options).filter((option) => allowedIds.has(option.id))"), true);
  assert.equal(source.includes("allowed.has(level) && set.has(level)"), true);
  assert.equal(source.includes("void loadProviderModels();"), true);
  assert.equal(source.includes("setModelOptions(filterCenterModelOptionsForPlan(catalogOptions, effectivePlanId));"), true);
  assert.equal(source.includes("setModelOptions(mergeCenterModelOptionsWithPlan"), false);
  assert.equal(source.includes("mergeCenterReasoningLevelsWithPlan"), false);
});
