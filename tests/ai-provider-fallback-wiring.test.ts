import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("provider json runner falls back to Alibaba Qwen when DeepSeek returns empty response", () => {
  const source = read("src/lib/ai/ai.service.ts");
  assert.equal(source.includes("error.code === \"DEEPSEEK_EMPTY_RESPONSE\""), true);
  assert.equal(source.includes("providerId === \"deepseek\""), true);
  assert.equal(source.includes("providerFallback: \"deepseek_empty_to_alibaba_qwen\""), true);
  assert.equal(source.includes("resolveProviderIdForModel(ALIBABA_QWEN_PLUS_MODEL_ID)"), true);
});
