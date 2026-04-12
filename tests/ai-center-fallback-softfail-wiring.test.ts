import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center semantic soft-fail keeps model output instead of forcing deterministic fallback", () => {
  const source = read("src/lib/ai/ai.service.ts");
  assert.equal(source.includes("const hasUsableCenterAnswer = s(textFromStructuredOutput(data)).length >= 48;"), true);
  assert.equal(source.includes("const shouldApplySafeFallback = quality.hardFail || !hasUsableCenterAnswer;"), true);
  assert.equal(source.includes("checksPerformed.push(\"semantic_soft_fail_accepted\")"), true);
  assert.equal(source.includes("answerPath.push(\"soft_fail_keep_model_output\")"), true);
});

test("safe center fallback copy avoids meta echo loops and companion self-description", () => {
  const source = read("src/lib/ai/ai.service.ts");
  assert.equal(source.includes("if (args.actionClass === \"companion_chat\")"), true);
  assert.equal(source.includes("I understood your request:"), false);
  assert.equal(source.includes("I am CavBot Companion: a calm, practical AI partner for clarity, decisions, and momentum."), false);
  assert.equal(source.includes("I could not complete image generation right now"), true);
  assert.equal(source.includes("I hit a temporary model issue before finishing the direct answer"), true);
  assert.equal(source.includes("actionClass: policy.actionClass"), true);
});
