import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center server reroutes plain-language image prompts and removes companion model hijack", () => {
  const routing = read("src/lib/ai/ai.center-routing.ts");
  const service = read("src/lib/ai/ai.service.ts");

  assert.equal(routing.includes("export function inferCenterImageActionFromPrompt"), true);
  assert.equal(routing.includes("generate|make|create|render|illustrate"), true);
  assert.equal(service.includes("inferCenterActionFromPrompt("), true);
  assert.equal(
    service.includes("const requestedModel = rawRequestedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID && !isCompanionCenterAction(effectiveAction)"),
    true,
  );
});

test("center fast-answer lane forces cheaper execution for trivial prompts", () => {
  const service = read("src/lib/ai/ai.service.ts");
  const workspace = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(service.includes("function shouldUseFastDirectCenterLane"), true);
  assert.equal(service.includes("const deterministicDirectAnswer = fastDirectMode"), true);
  assert.equal(service.includes("providerId = \"cavai_fast_direct\""), true);
  assert.equal(service.includes("requestedReasoningLevel: fastDirectMode ? \"low\""), true);
  assert.equal(service.includes("minimumUsefulChars: fastDirectMode ? 0"), true);
  assert.equal(workspace.includes("useState<ReasoningLevel>(\"medium\")"), true);
});

test("ai shared route keeps a user-safe production error message", () => {
  const source = read("app/api/ai/_shared.ts");
  assert.equal(
    source.includes("CavAi hit a temporary server issue before it could finish the reply. Please retry."),
    true,
  );
});
