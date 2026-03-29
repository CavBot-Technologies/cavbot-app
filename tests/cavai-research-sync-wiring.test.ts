import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("center workspace keeps active quick-mode toggle and model selection synchronized", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");

  assert.equal(source.includes("const activeToolbarQuickMode = composerQuickMode === \"create_image\""), true);
  assert.equal(source.includes("const clearActiveToolbarQuickMode = useCallback(() => {"), true);
  assert.equal(source.includes("activeToolbarQuickMode ? ("), true);
  assert.equal(source.includes("onClick={clearActiveToolbarQuickMode}"), true);
  assert.equal(source.includes("setSelectedModel(ALIBABA_QWEN_MAX_MODEL_ID);"), true);
  assert.equal(source.includes("if (selectedModel === ALIBABA_QWEN_MAX_MODEL_ID && qwenMaxVisible) {"), true);
  assert.equal(source.includes("setResearchMode(true);"), true);
  assert.equal(source.includes("setResearchMode(false);"), true);
  assert.equal(source.includes("action: resolvedAction"), true);
  assert.equal(source.includes("researchMode: usingResearchMode"), true);
  assert.equal(source.includes("researchUrls"), true);
});

test("cavcode workspace requests heavy-coding model catalog context for dropdown visibility", () => {
  const source = read("components/cavai/CavAiCodeWorkspace.tsx");
  assert.equal(source.includes("/api/ai/test?catalog=context&surface=cavcode&action=generate_component"), true);
  assert.equal(source.includes("ALIBABA_QWEN_CODER_MODEL_ID"), true);
  assert.equal(source.includes("useState(ALIBABA_QWEN_CODER_MODEL_ID)"), true);
  assert.equal(source.includes("if (qwenCoder) ordered.push(qwenCoder);"), true);
  assert.equal(source.includes("\"Auto model\""), false);
  assert.equal(source.includes("selectedModel === \"auto\""), false);
  assert.equal(source.includes("draft.model === \"auto\""), false);
});

test("center assist backend canonicalizes research lane through web_research action", () => {
  const source = read("src/lib/ai/ai.service.ts");
  const routingSource = read("src/lib/ai/ai.center-routing.ts");
  const policySource = read("src/lib/ai/ai.policy.ts");

  assert.equal(source.includes("const effectiveAction = resolveCenterActionForTask({"), true);
  assert.equal(source.includes("researchModeRequested,"), true);
  assert.equal(routingSource.includes("if (args.researchModeRequested || isResearchTask(args.taskType)) return \"web_research\";"), true);
  assert.equal(source.includes("const modelRole: AiModelRole = researchModeRequested"), true);
  assert.equal(policySource.includes("if (actionClass === \"premium_plus_web_research\") {"), true);
  assert.equal(policySource.includes("return ALIBABA_QWEN_PLUS_MODEL_ID;"), true);
  assert.equal(source.includes("tools: researchMode ? asResearchProviderTools(policy.researchToolBundle) : undefined"), true);
  assert.equal(source.includes("researchToolBundle: policy.researchToolBundle"), true);
});
