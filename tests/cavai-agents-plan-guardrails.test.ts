import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const cavcodePagePath = path.resolve("app/cavcode/page.tsx");
const cavenSettingsPath = path.resolve("lib/cavai/cavenSettings.server.ts");
const cavaiSettingsRoutePath = path.resolve("app/api/cavai/settings/route.ts");
const modelCatalogPath = path.resolve("src/lib/ai/model-catalog.ts");

test("agents page includes image-capable Caven agents with explicit plan requirements", () => {
  const source = fs.readFileSync(cavcodePagePath, "utf8");
  assert.equal(source.includes('id: "ui_mockup_generator"'), true);
  assert.equal(source.includes('id: "website_visual_builder"'), true);
  assert.equal(source.includes('id: "app_screenshot_enhancer"'), true);
  assert.equal(source.includes('id: "brand_asset_generator"'), true);
  assert.equal(source.includes('id: "ui_debug_visualizer"'), true);
  assert.equal(source.includes('minimumPlan: "premium"'), true);
  assert.equal(source.includes('minimumPlan: "premium_plus"'), true);
  assert.equal(source.includes("isAgentPlanEligible"), true);
  assert.equal(source.includes("Locked"), true);
});

test("server-side Caven settings enforce agent plan eligibility", () => {
  const source = fs.readFileSync(cavenSettingsPath, "utf8");
  assert.equal(source.includes("CAVEN_AGENT_MIN_PLAN"), true);
  assert.equal(source.includes("isAgentPlanEligible"), true);
  assert.equal(source.includes("pickInstalledAgentIds("), true);
  assert.equal(source.includes("planId?: PlanId"), true);
});

test("cavai settings route returns plan context and uses AI request context", () => {
  const source = fs.readFileSync(cavaiSettingsRoutePath, "utf8");
  assert.equal(source.includes("requireAiRequestContext"), true);
  assert.equal(source.includes("planId: ctx.planId"), true);
  assert.equal(source.includes("{ ok: true, settings, planId: ctx.planId }"), true);
});

test("companion/image and newly added system model ids are pinned in the model catalog", () => {
  const source = fs.readFileSync(modelCatalogPath, "utf8");
  assert.equal(source.includes('ALIBABA_QWEN_FLASH_MODEL_ID = "qwen3.5-flash"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_CHARACTER_MODEL_ID = "qwen-plus-character"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_IMAGE_MODEL_ID = "qwen-image-2.0-pro"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID = "qwen-image-edit-max"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_ASR_REALTIME_MODEL_ID = "qwen3-asr-flash-realtime"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_TTS_REALTIME_MODEL_ID = "qwen3-tts-instruct-flash-realtime"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID = "qwen3-omni-flash-realtime"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_EMBEDDING_MODEL_ID = "text-embedding-v4"'), true);
  assert.equal(source.includes('ALIBABA_QWEN_RERANK_MODEL_ID = "qwen3-rerank"'), true);
});

test("agent/install wiring does not use localStorage or sessionStorage as state source", () => {
  const merged = [
    fs.readFileSync(cavcodePagePath, "utf8"),
    fs.readFileSync(cavenSettingsPath, "utf8"),
    fs.readFileSync(cavaiSettingsRoutePath, "utf8"),
  ].join("\n");
  assert.equal(merged.includes("localStorage"), false);
  assert.equal(merged.includes("sessionStorage"), false);
});
