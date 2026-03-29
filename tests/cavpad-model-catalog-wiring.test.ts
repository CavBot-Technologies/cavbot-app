import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavpad model selector is fed by surface-aware policy catalog", () => {
  const source = read("components/CavPad.tsx");
  assert.equal(source.includes('/api/ai/test?catalog=context&surface=cavpad&action=write_note'), true);
  assert.equal(source.includes("normalizeCavPadModelOptions(body.modelCatalog?.text)"), true);
  assert.equal(source.includes("if (cavAiLiveModelOptions.length) return cavAiLiveModelOptions;"), true);
});

test("cavpad free fallback model stack includes non-deepseek choices", () => {
  const source = read("components/CavPad.tsx");
  assert.equal(source.includes("[DEEPSEEK_CHAT_MODEL_ID, ALIBABA_QWEN_FLASH_MODEL_ID, ALIBABA_QWEN_CHARACTER_MODEL_ID]"), true);
});
