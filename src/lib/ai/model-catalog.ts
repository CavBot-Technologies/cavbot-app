export const CAVAI_AUTO_MODEL_ID = "auto";

export const DEEPSEEK_CHAT_MODEL_ID = "deepseek-chat";
export const DEEPSEEK_REASONER_MODEL_ID = "deepseek-reasoner";

export const ALIBABA_QWEN_FLASH_MODEL_ID = "qwen3.5-flash";
export const ALIBABA_QWEN_PLUS_MODEL_ID = "qwen3.5-plus";
export const ALIBABA_QWEN_MAX_MODEL_ID = "qwen3-max";
export const ALIBABA_QWEN_CODER_MODEL_ID = "qwen3-coder";
export const ALIBABA_QWEN_CHARACTER_MODEL_ID = "qwen-plus-character";
export const ALIBABA_QWEN_IMAGE_MODEL_ID = "qwen-image-2.0-pro";
export const ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID = "qwen-image-edit-max";
export const ALIBABA_QWEN_ASR_MODEL_ID = "qwen3-asr-flash";
export const ALIBABA_QWEN_ASR_REALTIME_MODEL_ID = "qwen3-asr-flash-realtime";
export const ALIBABA_QWEN_TTS_REALTIME_MODEL_ID = "qwen3-tts-instruct-flash-realtime";
export const ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID = "qwen3-omni-flash-realtime";
export const ALIBABA_QWEN_EMBEDDING_MODEL_ID = "text-embedding-v4";
export const ALIBABA_QWEN_RERANK_MODEL_ID = "qwen3-rerank";

export type AiCatalogProviderId = "deepseek" | "alibaba_qwen";
export type AiModelRoleHint = "chat" | "reasoning";

export type AiTextModelMetadata = {
  provider: AiCatalogProviderId;
  researchCapable: boolean;
  codingDefault: boolean;
  premiumPlusOnly: boolean;
  requiresWebResearchMode: boolean;
  supportsThinkingMode: boolean;
  supportsResearchTools: boolean;
};

export type AiTextModelCatalogEntry = {
  id: string;
  label: string;
  providerId: AiCatalogProviderId;
  roles: AiModelRoleHint[];
  metadata: AiTextModelMetadata;
};

export type AiAudioModelCatalogEntry = {
  id: string;
  label: string;
  providerId: "alibaba_qwen";
  capability: "transcription" | "speech";
};

export type AiImageModelCatalogEntry = {
  id: string;
  label: string;
  providerId: "alibaba_qwen";
  capability: "generation" | "edit";
};

export type AiModelCatalog = {
  text: AiTextModelCatalogEntry[];
  audio: AiAudioModelCatalogEntry[];
  image: AiImageModelCatalogEntry[];
};

const KNOWN_MODEL_LABELS: Record<string, string> = {
  [CAVAI_AUTO_MODEL_ID]: "CavAi Auto",
  [DEEPSEEK_CHAT_MODEL_ID]: "DeepSeek Chat",
  [DEEPSEEK_REASONER_MODEL_ID]: "DeepSeek Reasoner",
  [ALIBABA_QWEN_FLASH_MODEL_ID]: "Qwen3.5-Flash",
  [ALIBABA_QWEN_PLUS_MODEL_ID]: "Qwen3.5-Plus",
  [ALIBABA_QWEN_MAX_MODEL_ID]: "Qwen3-Max",
  [ALIBABA_QWEN_CODER_MODEL_ID]: "Caven (powered by Qwen3-Coder)",
  [ALIBABA_QWEN_CHARACTER_MODEL_ID]: "CavBot Companion",
  [ALIBABA_QWEN_IMAGE_MODEL_ID]: "Image Studio (Qwen-Image-2.0-Pro)",
  [ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID]: "Image Edit (Qwen-Image-Edit-Max)",
  [ALIBABA_QWEN_ASR_MODEL_ID]: "Qwen3-ASR-Flash",
  [ALIBABA_QWEN_ASR_REALTIME_MODEL_ID]: "Qwen3-ASR-Flash-Realtime",
  [ALIBABA_QWEN_TTS_REALTIME_MODEL_ID]: "Qwen3-TTS-Instruct-Flash-Realtime",
  [ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID]: "Qwen3-Omni-Flash-Realtime",
  [ALIBABA_QWEN_EMBEDDING_MODEL_ID]: "text-embedding-v4",
  [ALIBABA_QWEN_RERANK_MODEL_ID]: "qwen3-rerank",
};

const MODEL_ID_ALIASES: Record<string, string> = {
  [CAVAI_AUTO_MODEL_ID]: CAVAI_AUTO_MODEL_ID,
  "cavai-auto": CAVAI_AUTO_MODEL_ID,
  "router-default": CAVAI_AUTO_MODEL_ID,
  "router-default-model": CAVAI_AUTO_MODEL_ID,
  "smart-select": CAVAI_AUTO_MODEL_ID,
  "smart-routing": CAVAI_AUTO_MODEL_ID,
  "auto-route": CAVAI_AUTO_MODEL_ID,
  default: CAVAI_AUTO_MODEL_ID,

  [DEEPSEEK_CHAT_MODEL_ID]: DEEPSEEK_CHAT_MODEL_ID,
  deepseek: DEEPSEEK_CHAT_MODEL_ID,

  [DEEPSEEK_REASONER_MODEL_ID]: DEEPSEEK_REASONER_MODEL_ID,
  "deepseek-reasoning": DEEPSEEK_REASONER_MODEL_ID,

  [ALIBABA_QWEN_FLASH_MODEL_ID]: ALIBABA_QWEN_FLASH_MODEL_ID,
  "qwen3-5-flash": ALIBABA_QWEN_FLASH_MODEL_ID,
  "qwen35-flash": ALIBABA_QWEN_FLASH_MODEL_ID,
  "qwen-flash": ALIBABA_QWEN_FLASH_MODEL_ID,
  flash: ALIBABA_QWEN_FLASH_MODEL_ID,

  [ALIBABA_QWEN_PLUS_MODEL_ID]: ALIBABA_QWEN_PLUS_MODEL_ID,
  "qwen3-5-plus": ALIBABA_QWEN_PLUS_MODEL_ID,
  "qwen35-plus": ALIBABA_QWEN_PLUS_MODEL_ID,
  "qwen-plus": ALIBABA_QWEN_PLUS_MODEL_ID,

  [ALIBABA_QWEN_MAX_MODEL_ID]: ALIBABA_QWEN_MAX_MODEL_ID,
  "qwen-max": ALIBABA_QWEN_MAX_MODEL_ID,
  "alibaba-max": ALIBABA_QWEN_MAX_MODEL_ID,

  [ALIBABA_QWEN_CODER_MODEL_ID]: ALIBABA_QWEN_CODER_MODEL_ID,
  "qwen-coder": ALIBABA_QWEN_CODER_MODEL_ID,

  [ALIBABA_QWEN_CHARACTER_MODEL_ID]: ALIBABA_QWEN_CHARACTER_MODEL_ID,
  "qwen-character": ALIBABA_QWEN_CHARACTER_MODEL_ID,
  "cavbot-companion": ALIBABA_QWEN_CHARACTER_MODEL_ID,
  companion: ALIBABA_QWEN_CHARACTER_MODEL_ID,

  [ALIBABA_QWEN_IMAGE_MODEL_ID]: ALIBABA_QWEN_IMAGE_MODEL_ID,
  "qwen-image": ALIBABA_QWEN_IMAGE_MODEL_ID,
  "qwen-image-2": ALIBABA_QWEN_IMAGE_MODEL_ID,
  "qwen-image-2-pro": ALIBABA_QWEN_IMAGE_MODEL_ID,
  "image-studio": ALIBABA_QWEN_IMAGE_MODEL_ID,

  [ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID]: ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  "qwen-image-edit": ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  "image-edit": ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,

  [ALIBABA_QWEN_ASR_MODEL_ID]: ALIBABA_QWEN_ASR_MODEL_ID,
  "qwen-asr": ALIBABA_QWEN_ASR_MODEL_ID,
  "qwen3-asr": ALIBABA_QWEN_ASR_MODEL_ID,

  [ALIBABA_QWEN_ASR_REALTIME_MODEL_ID]: ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  "qwen-asr-realtime": ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  "qwen3-asr-realtime": ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,

  [ALIBABA_QWEN_TTS_REALTIME_MODEL_ID]: ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  "qwen-tts-realtime": ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  "qwen3-tts-realtime": ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,

  [ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID]: ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,
  "qwen-omni-realtime": ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,
  "qwen3-omni-realtime": ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID,

  [ALIBABA_QWEN_EMBEDDING_MODEL_ID]: ALIBABA_QWEN_EMBEDDING_MODEL_ID,
  embedding: ALIBABA_QWEN_EMBEDDING_MODEL_ID,
  embeddings: ALIBABA_QWEN_EMBEDDING_MODEL_ID,

  [ALIBABA_QWEN_RERANK_MODEL_ID]: ALIBABA_QWEN_RERANK_MODEL_ID,
  rerank: ALIBABA_QWEN_RERANK_MODEL_ID,
  "qwen-rerank": ALIBABA_QWEN_RERANK_MODEL_ID,
};

const DEFAULT_UI_MODEL_ORDER: string[] = [
  CAVAI_AUTO_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_ASR_REALTIME_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
];

const DEFAULT_UI_MODEL_ORDER_RANK = new Map<string, number>(
  DEFAULT_UI_MODEL_ORDER.map((id, index) => [id, index + 1])
);

const CAVCODE_MODEL_ORDER: string[] = [
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
];

const CAVCODE_MODEL_ORDER_RANK = new Map<string, number>(
  CAVCODE_MODEL_ORDER.map((id, index) => [id, index + 1])
);

const DEFAULT_TEXT_MODEL_METADATA: AiTextModelMetadata = {
  provider: "deepseek",
  researchCapable: false,
  codingDefault: false,
  premiumPlusOnly: false,
  requiresWebResearchMode: false,
  supportsThinkingMode: true,
  supportsResearchTools: false,
};

const TEXT_MODEL_METADATA: Record<string, AiTextModelMetadata> = {
  [DEEPSEEK_CHAT_MODEL_ID]: {
    provider: "deepseek",
    researchCapable: false,
    codingDefault: false,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
  [DEEPSEEK_REASONER_MODEL_ID]: {
    provider: "deepseek",
    researchCapable: true,
    codingDefault: false,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
  [ALIBABA_QWEN_FLASH_MODEL_ID]: {
    provider: "alibaba_qwen",
    researchCapable: false,
    codingDefault: false,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
  [ALIBABA_QWEN_PLUS_MODEL_ID]: {
    provider: "alibaba_qwen",
    researchCapable: true,
    codingDefault: false,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
  [ALIBABA_QWEN_MAX_MODEL_ID]: {
    provider: "alibaba_qwen",
    researchCapable: true,
    codingDefault: false,
    premiumPlusOnly: true,
    requiresWebResearchMode: true,
    supportsThinkingMode: true,
    supportsResearchTools: true,
  },
  [ALIBABA_QWEN_CODER_MODEL_ID]: {
    provider: "alibaba_qwen",
    researchCapable: false,
    codingDefault: true,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
  [ALIBABA_QWEN_CHARACTER_MODEL_ID]: {
    provider: "alibaba_qwen",
    researchCapable: false,
    codingDefault: false,
    premiumPlusOnly: false,
    requiresWebResearchMode: false,
    supportsThinkingMode: true,
    supportsResearchTools: false,
  },
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeModelLookupKey(value: unknown): string {
  return s(value).toLowerCase().replace(/[\s_]+/g, "-");
}

export function resolveAiModelCanonicalId(modelId: string): string {
  const raw = s(modelId);
  if (!raw) return "";
  const key = normalizeModelLookupKey(raw);
  const alias = MODEL_ID_ALIASES[key];
  if (alias) return alias;
  if (key.includes("qwen") && key.includes("asr") && key.includes("realtime")) return ALIBABA_QWEN_ASR_REALTIME_MODEL_ID;
  if (key.includes("qwen") && key.includes("tts") && key.includes("realtime")) return ALIBABA_QWEN_TTS_REALTIME_MODEL_ID;
  if (key.includes("qwen") && key.includes("omni") && key.includes("realtime")) return ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID;
  if (key.includes("qwen") && key.includes("asr")) return ALIBABA_QWEN_ASR_MODEL_ID;
  if (key.includes("companion")) return ALIBABA_QWEN_CHARACTER_MODEL_ID;
  if (key.includes("qwen") && key.includes("character")) return ALIBABA_QWEN_CHARACTER_MODEL_ID;
  if (key.includes("qwen") && key.includes("image") && key.includes("edit")) return ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
  if (key.includes("qwen") && key.includes("image")) return ALIBABA_QWEN_IMAGE_MODEL_ID;
  if (key.includes("qwen") && key.includes("coder")) return ALIBABA_QWEN_CODER_MODEL_ID;
  if (key.includes("qwen") && key.includes("3.5") && key.includes("flash")) return ALIBABA_QWEN_FLASH_MODEL_ID;
  if (key.includes("qwen") && key.includes("flash")) return ALIBABA_QWEN_FLASH_MODEL_ID;
  if (key.includes("qwen") && key.includes("3.5")) return ALIBABA_QWEN_PLUS_MODEL_ID;
  if (key.includes("qwen") && key.includes("plus")) return ALIBABA_QWEN_PLUS_MODEL_ID;
  if (key.includes("qwen") && key.includes("max")) return ALIBABA_QWEN_MAX_MODEL_ID;
  if (key.includes("embedding")) return ALIBABA_QWEN_EMBEDDING_MODEL_ID;
  if (key.includes("rerank")) return ALIBABA_QWEN_RERANK_MODEL_ID;
  if (key.includes("deepseek") && key.includes("reason")) return DEEPSEEK_REASONER_MODEL_ID;
  if (key.includes("deepseek")) return DEEPSEEK_CHAT_MODEL_ID;
  return raw;
}

export function resolveAiModelLabel(modelId: string): string {
  const id = resolveAiModelCanonicalId(modelId);
  if (!id) return "";
  return KNOWN_MODEL_LABELS[id] || id;
}

export function isAiAutoModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === CAVAI_AUTO_MODEL_ID;
}

export function isQwenCoderModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === ALIBABA_QWEN_CODER_MODEL_ID;
}

export function isQwenFlashModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === ALIBABA_QWEN_FLASH_MODEL_ID;
}

export function isCompanionModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === ALIBABA_QWEN_CHARACTER_MODEL_ID;
}

export function isImageGenerationModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === ALIBABA_QWEN_IMAGE_MODEL_ID;
}

export function isImageEditModelId(modelId: string): boolean {
  return resolveAiModelCanonicalId(modelId) === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
}

export function rankCavCodeModelForUi(modelId: string): number {
  const canonical = resolveAiModelCanonicalId(modelId);
  return CAVCODE_MODEL_ORDER_RANK.get(canonical) || 99;
}

export function rankDefaultModelForUi(modelId: string): number {
  const canonical = resolveAiModelCanonicalId(modelId);
  return DEFAULT_UI_MODEL_ORDER_RANK.get(canonical) || 99;
}

export function resolveAiTextModelMetadata(modelId: string): AiTextModelMetadata {
  const id = resolveAiModelCanonicalId(modelId);
  if (!id) return { ...DEFAULT_TEXT_MODEL_METADATA };
  const direct = TEXT_MODEL_METADATA[id];
  if (direct) return { ...direct };
  if (id.startsWith("deepseek-")) {
    return { ...DEFAULT_TEXT_MODEL_METADATA, provider: "deepseek" };
  }
  if (id.startsWith("qwen")) {
    return { ...DEFAULT_TEXT_MODEL_METADATA, provider: "alibaba_qwen" };
  }
  return { ...DEFAULT_TEXT_MODEL_METADATA };
}
