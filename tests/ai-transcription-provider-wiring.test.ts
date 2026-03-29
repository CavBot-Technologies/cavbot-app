import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("Alibaba transcription uses chat completions input_audio flow", () => {
  const source = read("src/lib/ai/providers/alibaba-qwen.ts");
  assert.equal(source.includes("chat.completions.create"), true);
  assert.equal(source.includes("type: \"input_audio\""), true);
  assert.equal(source.includes("audio.transcriptions.create"), false);
  assert.equal(source.includes("resolveTranscriptionBaseUrls"), true);
  assert.equal(source.includes("ALIBABA_QWEN_REALTIME_MODEL_REQUIRES_STREAMING"), true);
});
