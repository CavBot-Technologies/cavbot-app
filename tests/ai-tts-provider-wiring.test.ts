import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("Alibaba TTS uses DashScope native generation endpoint", () => {
  const source = read("src/lib/ai/providers/alibaba-qwen.ts");
  assert.equal(source.includes("/services/aigc/multimodal-generation/generation"), true);
  assert.equal(source.includes("normalizeDashScopeSpeechModel"), true);
  assert.equal(source.includes("DASHSCOPE_QWEN3_TTS_MAX_INPUT_CHARS = 600"), true);
  assert.equal(source.includes("buildDashScopeSpeechTextCandidates"), true);
  assert.equal(source.includes("input-truncated-${DASHSCOPE_QWEN3_TTS_MAX_INPUT_CHARS}-chars"), true);
  assert.equal(source.includes("|| \"Ethan\""), true);
  assert.equal(source.includes("audio.speech.create"), false);
});
