import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string): string {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("voice capture uses fixed ASR file model and pinned TTS realtime models", () => {
  const source = read("components/cavai/CavAiCenterWorkspace.tsx");
  assert.equal(source.includes("transcribeAudioFile(file, ALIBABA_QWEN_ASR_MODEL_ID)"), true);
  assert.equal(source.includes("ALIBABA_QWEN_ASR_REALTIME_MODEL_ID"), false);
  assert.equal(source.includes("model: ALIBABA_QWEN_TTS_REALTIME_MODEL_ID"), true);
  assert.equal(source.includes("voice: CAVBOT_TTS_VOICE_ID"), true);
  assert.equal(source.includes("instructions: CAVBOT_TTS_INSTRUCTIONS"), true);
  assert.equal(source.includes("CAVBOT_BROWSER_FALLBACK_RATE"), false);
  assert.equal(source.includes("CAVBOT_BROWSER_FALLBACK_PITCH"), false);
  assert.equal(source.includes("autoSpeakNextVoiceReplyRef"), true);
  assert.equal(source.includes("voice-auto-${latestAssistantId}"), true);
  assert.equal(source.includes("voice-auto-inline-"), true);
  assert.equal(source.includes("deferUiRefresh: true"), true);
  assert.equal(source.includes("requestSpeechBlob"), true);
  assert.equal(source.includes("prefetchSpeechForMessage"), true);
  assert.equal(source.includes("ttsBlobCacheRef"), true);
  assert.equal(source.includes("model: voiceReplyModel"), true);
  assert.equal(source.includes("const fallbackResponse = await requestTts(baseBody);"), true);
  assert.equal(source.includes("Speech request failed ("), true);
  assert.equal(source.includes("speechSynthesis.speak"), false);
});

test("audio service honors explicit model overrides for transcription and speech", () => {
  const source = read("src/lib/ai/ai.service.ts");
  assert.equal(source.includes("const executionModel = modelOverride || policy.model;"), true);
  assert.equal(source.includes("model: executionModel"), true);
  assert.equal(source.includes("DEFAULT_CAVBOT_TTS_INSTRUCTIONS"), true);
  assert.equal(source.includes("strictModel: Boolean(modelOverride)"), true);
});
