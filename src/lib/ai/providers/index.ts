import "server-only";

import {
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  type AiAudioModelCatalogEntry,
  type AiImageModelCatalogEntry,
  type AiModelCatalog,
  type AiTextModelCatalogEntry,
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
  rankDefaultModelForUi,
  resolveAiModelCanonicalId,
  resolveAiModelLabel,
  resolveAiTextModelMetadata,
} from "@/src/lib/ai/model-catalog";
import { alibabaQwenEnvStatus, getAlibabaQwenProvider } from "@/src/lib/ai/providers/alibaba-qwen";
import { deepSeekEnvStatus, getDeepSeekProvider } from "@/src/lib/ai/providers/deepseek";
import { AiProviderError, type AiModelRole, type AiProvider, type AiProviderId } from "@/src/lib/ai/providers/types";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeProviderId(value: string): AiProviderId | null {
  const normalized = s(value).toLowerCase();
  if (normalized === "deepseek") return "deepseek";
  if (normalized === "alibaba_qwen" || normalized === "alibaba" || normalized === "qwen") return "alibaba_qwen";
  return null;
}

function deepSeekModelIds(): string[] {
  const status = deepSeekEnvStatus();
  const ids = [s(status.chatModel), s(status.reasoningModel)].filter(Boolean);
  return Array.from(new Set(ids));
}

function alibabaQwenModelIds(): string[] {
  const status = alibabaQwenEnvStatus();
  if (!status.ok) {
    return [
      ALIBABA_QWEN_PLUS_MODEL_ID,
      ALIBABA_QWEN_FLASH_MODEL_ID,
      ALIBABA_QWEN_MAX_MODEL_ID,
      ALIBABA_QWEN_CODER_MODEL_ID,
      ALIBABA_QWEN_CHARACTER_MODEL_ID,
      ALIBABA_QWEN_IMAGE_MODEL_ID,
      ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
      ALIBABA_QWEN_ASR_MODEL_ID,
      ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
      ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
      ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,
      ALIBABA_QWEN_EMBEDDING_MODEL_ID,
      ALIBABA_QWEN_RERANK_MODEL_ID,
    ];
  }
  return [
    s(status.flashModel),
    s(status.plusModel),
    s(status.maxModel),
    s(status.coderModel),
    s(status.characterModel),
    s(status.imageModel),
    s(status.imageEditModel),
    s(status.asrModel),
    s(status.asrRealtimeModel),
    s(status.ttsRealtimeModel),
    s(status.omniRealtimeModel),
    s(status.embeddingModel),
    s(status.rerankModel),
  ].filter(Boolean);
}

export function resolveProviderId(raw?: string): AiProviderId {
  const envPreferred = s(raw || process.env.CAVAI_PROVIDER || process.env.AI_PROVIDER || "deepseek");
  const normalized = normalizeProviderId(envPreferred);
  if (normalized) return normalized;
  throw new AiProviderError(
    "AI_PROVIDER_UNSUPPORTED",
    `Unsupported AI provider "${envPreferred}". Only "deepseek" and "alibaba_qwen" are enabled.`,
    500
  );
}

export function resolveProviderIdForModel(modelId?: string, fallbackProviderId?: string): AiProviderId {
  const model = resolveAiModelCanonicalId(s(modelId));
  if (!model) return resolveProviderId(fallbackProviderId);

  if (deepSeekModelIds().includes(model)) return "deepseek";
  if (alibabaQwenModelIds().includes(model)) return "alibaba_qwen";

  throw new AiProviderError(
    "AI_MODEL_UNSUPPORTED",
    `Unsupported model "${model}".`,
    400,
    {
      allowedTextModels: getAiModelCatalog().text.map((row) => row.id),
      allowedAudioModels: getAiModelCatalog().audio.map((row) => row.id),
      allowedImageModels: getAiModelCatalog().image.map((row) => row.id),
    }
  );
}

export function getAiProvider(providerId?: string): AiProvider {
  const resolved = resolveProviderId(providerId);
  if (resolved === "deepseek") return getDeepSeekProvider();
  if (resolved === "alibaba_qwen") return getAlibabaQwenProvider();
  throw new AiProviderError("AI_PROVIDER_UNSUPPORTED", `Unsupported provider: ${resolved}`, 500);
}

export function resolveModelForRole(role: AiModelRole, providerId?: string): string {
  return getAiProvider(providerId).resolveModel(role);
}

export type AiProviderStatus = {
  providerId: AiProviderId;
  ok: boolean;
  missing: string[];
  invalid: string[];
  baseUrl: string;
  chatModel: string;
  reasoningModel: string;
  audioModel: string | null;
  flashModel?: string | null;
  plusModel?: string | null;
  maxModel?: string | null;
  coderModel?: string | null;
  characterModel?: string | null;
  imageModel?: string | null;
  imageEditModel?: string | null;
  asrModel?: string | null;
  asrRealtimeModel?: string | null;
  ttsRealtimeModel?: string | null;
  omniRealtimeModel?: string | null;
  embeddingModel?: string | null;
  rerankModel?: string | null;
};

export function assertAiProviderReady(providerId?: string): AiProviderStatus {
  const resolved = resolveProviderId(providerId);
  if (resolved === "deepseek") {
    const status = deepSeekEnvStatus();
    if (!status.ok) {
      throw new AiProviderError(
        "DEEPSEEK_ENV_MISSING",
        `Missing required DeepSeek environment variables: ${status.missing.join(", ")}`,
        500,
        { missing: status.missing }
      );
    }
    return {
      providerId: resolved,
      ok: true,
      missing: [],
      invalid: [],
      baseUrl: status.baseUrl,
      chatModel: status.chatModel,
      reasoningModel: status.reasoningModel,
      audioModel: null,
    };
  }

  if (resolved === "alibaba_qwen") {
    const status = alibabaQwenEnvStatus();
    if (!status.ok) {
      const code = status.invalid.length ? "ALIBABA_QWEN_MODEL_UNSUPPORTED" : "ALIBABA_QWEN_ENV_MISSING";
      const message = status.invalid.length
        ? `Alibaba Qwen model environment is invalid: ${status.invalid.join("; ")}`
        : `Missing required Alibaba Qwen environment variables: ${status.missing.join(", ")}`;
      throw new AiProviderError(code, message, 500, {
        missing: status.missing,
        invalid: status.invalid,
      });
    }
    return {
      providerId: resolved,
      ok: true,
      missing: [],
      invalid: [],
      baseUrl: status.baseUrl,
      chatModel: status.plusModel,
      reasoningModel: status.maxModel,
      audioModel: status.asrRealtimeModel || status.asrModel,
      flashModel: status.flashModel,
      plusModel: status.plusModel,
      maxModel: status.maxModel,
      coderModel: status.coderModel,
      characterModel: status.characterModel,
      imageModel: status.imageModel,
      imageEditModel: status.imageEditModel,
      asrModel: status.asrModel,
      asrRealtimeModel: status.asrRealtimeModel,
      ttsRealtimeModel: status.ttsRealtimeModel,
      omniRealtimeModel: status.omniRealtimeModel,
      embeddingModel: status.embeddingModel,
      rerankModel: status.rerankModel,
    };
  }

  throw new AiProviderError("AI_PROVIDER_UNSUPPORTED", `Unsupported provider: ${resolved}`, 500);
}

export function getAiProviderStatus(providerId?: string): AiProviderStatus {
  const resolved = resolveProviderId(providerId);
  if (resolved === "deepseek") {
    const status = deepSeekEnvStatus();
    return {
      providerId: resolved,
      ok: status.ok,
      missing: status.missing,
      invalid: [],
      baseUrl: status.baseUrl,
      chatModel: status.chatModel,
      reasoningModel: status.reasoningModel,
      audioModel: null,
    };
  }

  if (resolved === "alibaba_qwen") {
    const status = alibabaQwenEnvStatus();
    return {
      providerId: resolved,
      ok: status.ok,
      missing: status.missing,
      invalid: status.invalid,
      baseUrl: status.baseUrl,
      chatModel: status.plusModel,
      reasoningModel: status.maxModel,
      audioModel: status.asrRealtimeModel || status.asrModel,
      flashModel: status.flashModel,
      plusModel: status.plusModel,
      maxModel: status.maxModel,
      coderModel: status.coderModel,
      characterModel: status.characterModel,
      imageModel: status.imageModel,
      imageEditModel: status.imageEditModel,
      asrModel: status.asrModel,
      asrRealtimeModel: status.asrRealtimeModel,
      ttsRealtimeModel: status.ttsRealtimeModel,
      omniRealtimeModel: status.omniRealtimeModel,
      embeddingModel: status.embeddingModel,
      rerankModel: status.rerankModel,
    };
  }

  return {
    providerId: resolved,
    ok: false,
    missing: ["AI_PROVIDER_UNSUPPORTED"],
    invalid: [],
    baseUrl: "",
    chatModel: "",
    reasoningModel: "",
    audioModel: null,
  };
}

export function getAiProviderStatuses(): AiProviderStatus[] {
  return [getAiProviderStatus("deepseek"), getAiProviderStatus("alibaba_qwen")];
}

function upsertTextModelEntry(
  entries: AiTextModelCatalogEntry[],
  item: { id: string; providerId: "deepseek" | "alibaba_qwen"; role: "chat" | "reasoning" }
) {
  const id = s(item.id);
  if (!id) return;
  const existing = entries.find((entry) => entry.id === id && entry.providerId === item.providerId);
  if (existing) {
    if (!existing.roles.includes(item.role)) existing.roles.push(item.role);
    return;
  }
  entries.push({
    id,
    label: resolveAiModelLabel(id),
    providerId: item.providerId,
    roles: [item.role],
    metadata: resolveAiTextModelMetadata(id),
  });
}

export function getAiModelCatalog(): AiModelCatalog {
  const text: AiTextModelCatalogEntry[] = [];
  const audio: AiAudioModelCatalogEntry[] = [];
  const image: AiImageModelCatalogEntry[] = [];

  const deepseek = getAiProviderStatus("deepseek");
  if (deepseek.ok) {
    upsertTextModelEntry(text, {
      id: deepseek.chatModel,
      providerId: "deepseek",
      role: "chat",
    });
    upsertTextModelEntry(text, {
      id: deepseek.reasoningModel,
      providerId: "deepseek",
      role: "reasoning",
    });
  }

  const qwen = getAiProviderStatus("alibaba_qwen");
  if (qwen.ok) {
    if (s(qwen.flashModel)) {
      upsertTextModelEntry(text, {
        id: s(qwen.flashModel),
        providerId: "alibaba_qwen",
        role: "chat",
      });
    }
    if (s(qwen.plusModel)) {
      upsertTextModelEntry(text, {
        id: s(qwen.plusModel),
        providerId: "alibaba_qwen",
        role: "chat",
      });
    }
    if (s(qwen.maxModel)) {
      upsertTextModelEntry(text, {
        id: s(qwen.maxModel),
        providerId: "alibaba_qwen",
        role: "reasoning",
      });
    }
    if (s(qwen.coderModel)) {
      upsertTextModelEntry(text, {
        id: s(qwen.coderModel),
        providerId: "alibaba_qwen",
        role: "reasoning",
      });
    }
    if (s(qwen.characterModel)) {
      upsertTextModelEntry(text, {
        id: s(qwen.characterModel),
        providerId: "alibaba_qwen",
        role: "chat",
      });
    }
    if (s(qwen.asrModel)) {
      audio.push({
        id: s(qwen.asrModel),
        label: resolveAiModelLabel(s(qwen.asrModel)),
        providerId: "alibaba_qwen",
        capability: "transcription",
      });
    }
    if (s(qwen.asrRealtimeModel)) {
      audio.push({
        id: s(qwen.asrRealtimeModel),
        label: resolveAiModelLabel(s(qwen.asrRealtimeModel)),
        providerId: "alibaba_qwen",
        capability: "transcription",
      });
    }
    if (s(qwen.ttsRealtimeModel)) {
      audio.push({
        id: s(qwen.ttsRealtimeModel),
        label: resolveAiModelLabel(s(qwen.ttsRealtimeModel)),
        providerId: "alibaba_qwen",
        capability: "speech",
      });
    }
    if (s(qwen.imageModel)) {
      image.push({
        id: s(qwen.imageModel),
        label: resolveAiModelLabel(s(qwen.imageModel)),
        providerId: "alibaba_qwen",
        capability: "generation",
      });
    }
    if (s(qwen.imageEditModel)) {
      image.push({
        id: s(qwen.imageEditModel),
        label: resolveAiModelLabel(s(qwen.imageEditModel)),
        providerId: "alibaba_qwen",
        capability: "edit",
      });
    }
  }

  text.sort((a, b) => {
    const rankDiff = rankDefaultModelForUi(a.id) - rankDefaultModelForUi(b.id);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });

  image.sort((a, b) => {
    const rankDiff = rankDefaultModelForUi(a.id) - rankDefaultModelForUi(b.id);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });

  audio.sort((a, b) => {
    const aRealtime = s(a.id) === ALIBABA_QWEN_ASR_REALTIME_MODEL_ID ? 1 : 0;
    const bRealtime = s(b.id) === ALIBABA_QWEN_ASR_REALTIME_MODEL_ID ? 1 : 0;
    if (aRealtime !== bRealtime) return bRealtime - aRealtime;
    return a.label.localeCompare(b.label);
  });

  return { text, audio, image };
}

export * from "@/src/lib/ai/providers/types";
