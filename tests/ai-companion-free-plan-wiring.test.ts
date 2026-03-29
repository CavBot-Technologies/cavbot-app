import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center submit path pins companion prompts to CavBot Companion model", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  assert.equal(source.includes("const companionActionSelected = actionCandidate === \"companion_chat\";"), true);
  assert.equal(source.includes("const requestModelId = companionActionSelected"), true);
  assert.equal(source.includes("? ALIBABA_QWEN_CHARACTER_MODEL_ID"), true);
  assert.equal(source.includes("model: requestModelId === CAVAI_AUTO_MODEL_ID ? undefined : requestModelId"), true);
});

test("policy falls back to companion model instead of plan-blocking mismatched manual models", () => {
  const source = read("src/lib/ai/ai.policy.ts");
  assert.equal(source.includes("args.actionClass === \"companion_chat\""), true);
  assert.equal(source.includes("model: ALIBABA_QWEN_CHARACTER_MODEL_ID"), true);
  assert.equal(source.includes("fallbackReason: \"companion_model_enforced\""), true);
  assert.equal(source.includes("CavBot Companion is temporarily unavailable."), true);
});
