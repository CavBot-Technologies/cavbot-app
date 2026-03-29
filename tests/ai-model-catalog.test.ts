import assert from "node:assert/strict";
import test from "node:test";

import {
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_EMBEDDING_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_RERANK_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  CAVAI_AUTO_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  rankCavCodeModelForUi,
  rankDefaultModelForUi,
  resolveAiModelCanonicalId,
  resolveAiModelLabel,
  resolveAiTextModelMetadata,
} from "@/src/lib/ai/model-catalog";

test("model catalog constants stay pinned to approved ids", () => {
  assert.equal(DEEPSEEK_CHAT_MODEL_ID, "deepseek-chat");
  assert.equal(DEEPSEEK_REASONER_MODEL_ID, "deepseek-reasoner");
  assert.equal(ALIBABA_QWEN_FLASH_MODEL_ID, "qwen3.5-flash");
  assert.equal(ALIBABA_QWEN_PLUS_MODEL_ID, "qwen3.5-plus");
  assert.equal(ALIBABA_QWEN_MAX_MODEL_ID, "qwen3-max");
  assert.equal(ALIBABA_QWEN_CODER_MODEL_ID, "qwen3-coder");
  assert.equal(ALIBABA_QWEN_CHARACTER_MODEL_ID, "qwen-plus-character");
  assert.equal(ALIBABA_QWEN_IMAGE_MODEL_ID, "qwen-image-2.0-pro");
  assert.equal(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID, "qwen-image-edit-max");
  assert.equal(ALIBABA_QWEN_ASR_MODEL_ID, "qwen3-asr-flash");
  assert.equal(ALIBABA_QWEN_ASR_REALTIME_MODEL_ID, "qwen3-asr-flash-realtime");
  assert.equal(ALIBABA_QWEN_TTS_REALTIME_MODEL_ID, "qwen3-tts-instruct-flash-realtime");
  assert.equal(ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID, "qwen3-omni-flash-realtime");
  assert.equal(ALIBABA_QWEN_EMBEDDING_MODEL_ID, "text-embedding-v4");
  assert.equal(ALIBABA_QWEN_RERANK_MODEL_ID, "qwen3-rerank");
});

test("model labels stay user-facing and clean", () => {
  assert.equal(resolveAiModelLabel(DEEPSEEK_CHAT_MODEL_ID), "DeepSeek Chat");
  assert.equal(resolveAiModelLabel(DEEPSEEK_REASONER_MODEL_ID), "DeepSeek Reasoner");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_FLASH_MODEL_ID), "Qwen3.5-Flash");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_PLUS_MODEL_ID), "Qwen3.5-Plus");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_MAX_MODEL_ID), "Qwen3-Max");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_CODER_MODEL_ID), "Caven (powered by Qwen3-Coder)");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_CHARACTER_MODEL_ID), "CavBot Companion");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_IMAGE_MODEL_ID), "Image Studio (Qwen-Image-2.0-Pro)");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID), "Image Edit (Qwen-Image-Edit-Max)");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_ASR_MODEL_ID), "Qwen3-ASR-Flash");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_ASR_REALTIME_MODEL_ID), "Qwen3-ASR-Flash-Realtime");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_TTS_REALTIME_MODEL_ID), "Qwen3-TTS-Instruct-Flash-Realtime");
  assert.equal(resolveAiModelLabel(ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID), "Qwen3-Omni-Flash-Realtime");
});

test("official aliases resolve to canonical UI labels", () => {
  assert.equal(resolveAiModelCanonicalId("cavai-auto"), CAVAI_AUTO_MODEL_ID);
  assert.equal(resolveAiModelLabel("cavai-auto"), "CavAi Auto");
  assert.equal(resolveAiModelLabel("deepseek"), "DeepSeek Chat");
  assert.equal(resolveAiModelLabel("qwen-max"), "Qwen3-Max");
  assert.equal(resolveAiModelLabel("qwen3-coder"), "Caven (powered by Qwen3-Coder)");
  assert.equal(resolveAiModelLabel("qwen3-5-flash"), "Qwen3.5-Flash");
  assert.equal(resolveAiModelLabel("qwen3-5-plus"), "Qwen3.5-Plus");
  assert.equal(resolveAiModelLabel("qwen-asr"), "Qwen3-ASR-Flash");
  assert.equal(resolveAiModelLabel("qwen-asr-realtime"), "Qwen3-ASR-Flash-Realtime");
  assert.equal(resolveAiModelLabel("qwen-tts-realtime"), "Qwen3-TTS-Instruct-Flash-Realtime");
  assert.equal(resolveAiModelLabel("qwen-omni-realtime"), "Qwen3-Omni-Flash-Realtime");
  assert.equal(resolveAiModelLabel("embedding"), "text-embedding-v4");
  assert.equal(resolveAiModelLabel("rerank"), "qwen3-rerank");
  assert.equal(resolveAiModelLabel("companion"), "CavBot Companion");
  assert.equal(resolveAiModelLabel("image-studio"), "Image Studio (Qwen-Image-2.0-Pro)");
  assert.equal(resolveAiModelLabel("image-edit"), "Image Edit (Qwen-Image-Edit-Max)");
});

test("default model ranks keep global picker ordering", () => {
  const ordered = [
    CAVAI_AUTO_MODEL_ID,
    DEEPSEEK_CHAT_MODEL_ID,
    ALIBABA_QWEN_FLASH_MODEL_ID,
    DEEPSEEK_REASONER_MODEL_ID,
    ALIBABA_QWEN_PLUS_MODEL_ID,
    ALIBABA_QWEN_MAX_MODEL_ID,
    ALIBABA_QWEN_CODER_MODEL_ID,
    ALIBABA_QWEN_CHARACTER_MODEL_ID,
    ALIBABA_QWEN_IMAGE_MODEL_ID,
    ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ];
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(rankDefaultModelForUi(ordered[i - 1]) < rankDefaultModelForUi(ordered[i]), true);
  }
});

test("cavcode model ranks keep coder-first ordering", () => {
  const ordered = [
    ALIBABA_QWEN_CODER_MODEL_ID,
    ALIBABA_QWEN_PLUS_MODEL_ID,
    DEEPSEEK_REASONER_MODEL_ID,
    ALIBABA_QWEN_FLASH_MODEL_ID,
    DEEPSEEK_CHAT_MODEL_ID,
    ALIBABA_QWEN_MAX_MODEL_ID,
  ];
  for (let i = 1; i < ordered.length; i += 1) {
    assert.equal(rankCavCodeModelForUi(ordered[i - 1]) < rankCavCodeModelForUi(ordered[i]), true);
  }
});

test("Qwen3-Max metadata remains research-only and premium plus constrained", () => {
  const metadata = resolveAiTextModelMetadata(ALIBABA_QWEN_MAX_MODEL_ID);
  assert.equal(metadata.provider, "alibaba_qwen");
  assert.equal(metadata.researchCapable, true);
  assert.equal(metadata.codingDefault, false);
  assert.equal(metadata.premiumPlusOnly, true);
  assert.equal(metadata.requiresWebResearchMode, true);
  assert.equal(metadata.supportsThinkingMode, true);
  assert.equal(metadata.supportsResearchTools, true);
});

test("Caven coding model metadata stays coding-first and not premium-plus-only", () => {
  const metadata = resolveAiTextModelMetadata(ALIBABA_QWEN_CODER_MODEL_ID);
  assert.equal(metadata.provider, "alibaba_qwen");
  assert.equal(metadata.researchCapable, false);
  assert.equal(metadata.codingDefault, true);
  assert.equal(metadata.premiumPlusOnly, false);
  assert.equal(metadata.requiresWebResearchMode, false);
  assert.equal(metadata.supportsThinkingMode, true);
  assert.equal(metadata.supportsResearchTools, false);
});

test("Qwen3.5-Flash metadata stays available for fast general lane", () => {
  const metadata = resolveAiTextModelMetadata(ALIBABA_QWEN_FLASH_MODEL_ID);
  assert.equal(metadata.provider, "alibaba_qwen");
  assert.equal(metadata.researchCapable, false);
  assert.equal(metadata.codingDefault, false);
  assert.equal(metadata.premiumPlusOnly, false);
  assert.equal(metadata.requiresWebResearchMode, false);
  assert.equal(metadata.supportsThinkingMode, true);
  assert.equal(metadata.supportsResearchTools, false);
});
