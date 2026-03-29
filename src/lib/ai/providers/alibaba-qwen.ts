import "server-only";

import OpenAI from "openai";
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
} from "@/src/lib/ai/model-catalog";
import {
  AiProviderError,
  type AiModelRole,
  type AiProvider,
  type AiProviderGenerateRequest,
  type AiProviderGenerateResponse,
  type AiProviderPublicConfig,
} from "@/src/lib/ai/providers/types";

const ALIBABA_QWEN_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const ALIBABA_QWEN_CN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const ALIBABA_QWEN_US_BASE_URL = "https://dashscope-us.aliyuncs.com/compatible-mode/v1";
const ALIBABA_QWEN_DEFAULT_API_BASE_URL = "https://dashscope-intl.aliyuncs.com/api/v1";
const ALIBABA_QWEN_CN_API_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";
const ALIBABA_QWEN_US_API_BASE_URL = "https://dashscope-us.aliyuncs.com/api/v1";
const DASHSCOPE_QWEN3_TTS_MAX_INPUT_CHARS = 600;
const DEFAULT_TIMEOUT_MS = 40_000;
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 90_000;
const MAX_TRANSCRIPTION_AUDIO_BYTES = 10_000_000;

export const ALIBABA_QWEN_PLUS_MODEL = ALIBABA_QWEN_PLUS_MODEL_ID;
export const ALIBABA_QWEN_MAX_MODEL = ALIBABA_QWEN_MAX_MODEL_ID;
export const ALIBABA_QWEN_FLASH_MODEL = ALIBABA_QWEN_FLASH_MODEL_ID;
export const ALIBABA_QWEN_CODER_MODEL = ALIBABA_QWEN_CODER_MODEL_ID;
export const ALIBABA_QWEN_CHARACTER_MODEL = ALIBABA_QWEN_CHARACTER_MODEL_ID;
export const ALIBABA_QWEN_IMAGE_MODEL = ALIBABA_QWEN_IMAGE_MODEL_ID;
export const ALIBABA_QWEN_IMAGE_EDIT_MODEL = ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
export const ALIBABA_QWEN_ASR_MODEL = ALIBABA_QWEN_ASR_MODEL_ID;
export const ALIBABA_QWEN_ASR_REALTIME_MODEL = ALIBABA_QWEN_ASR_REALTIME_MODEL_ID;
export const ALIBABA_QWEN_TTS_REALTIME_MODEL = ALIBABA_QWEN_TTS_REALTIME_MODEL_ID;
export const ALIBABA_QWEN_OMNI_REALTIME_MODEL = ALIBABA_QWEN_OMNI_REALTIME_MODEL_ID;
export const ALIBABA_QWEN_EMBEDDING_MODEL = ALIBABA_QWEN_EMBEDDING_MODEL_ID;
export const ALIBABA_QWEN_RERANK_MODEL = ALIBABA_QWEN_RERANK_MODEL_ID;

type AlibabaQwenConfig = {
  apiKey: string;
  baseUrl: string;
  flashModel: string;
  plusModel: string;
  maxModel: string;
  coderModel: string;
  characterModel: string;
  imageModel: string;
  imageEditModel: string;
  asrModel: string;
  asrRealtimeModel: string;
  ttsRealtimeModel: string;
  omniRealtimeModel: string;
  embeddingModel: string;
  rerankModel: string;
};

type AlibabaQwenConfigValidation =
  | {
      ok: true;
      value: AlibabaQwenConfig;
    }
  | {
      ok: false;
      missing: string[];
      invalid: string[];
      baseUrl: string;
      flashModel: string;
      plusModel: string;
      maxModel: string;
      coderModel: string;
      characterModel: string;
      imageModel: string;
      imageEditModel: string;
      asrModel: string;
      asrRealtimeModel: string;
      ttsRealtimeModel: string;
      omniRealtimeModel: string;
      embeddingModel: string;
      rerankModel: string;
    };

export type AlibabaQwenTranscriptionResult = {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  model: string;
  raw: unknown;
};

export type AlibabaQwenImageAsset = {
  url: string | null;
  b64Json: string | null;
  revisedPrompt: string | null;
};

export type AlibabaQwenImageResult = {
  model: string;
  images: AlibabaQwenImageAsset[];
  raw: unknown;
};

export type AlibabaQwenSpeechResult = {
  model: string;
  contentType: string;
  audioBuffer: ArrayBuffer;
  raw: unknown;
};

export type AlibabaQwenEmbeddingResult = {
  model: string;
  embedding: number[];
  dimensions: number;
  raw: unknown;
};

export type AlibabaQwenRerankItem = {
  index: number;
  score: number;
  document: string;
};

export type AlibabaQwenRerankResult = {
  model: string;
  items: AlibabaQwenRerankItem[];
  raw: unknown;
};

type AlibabaEmbeddingCreateParams = Parameters<OpenAI["embeddings"]["create"]>[0];

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function readConfiguredSecret(names: string[]): string {
  for (const name of names) {
    const raw = s(process.env[name]);
    if (!raw) continue;
    if (raw.toLowerCase() === "paste_your_key_here") continue;
    return raw;
  }
  return "";
}

function normalizeBaseUrl(input: string): string {
  const raw = s(input) || ALIBABA_QWEN_DEFAULT_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return ALIBABA_QWEN_DEFAULT_BASE_URL;
  }
}

function asInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function asChatContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const maybeText = s((item as { text?: unknown }).text);
        if (maybeText) return maybeText;
        const maybeType = s((item as { type?: unknown }).type).toLowerCase();
        if (maybeType === "text") {
          return s((item as { text?: unknown; content?: unknown }).text || (item as { content?: unknown }).content);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return s(value);
}

function inferAudioMimeType(file: File): string {
  const direct = s(file.type).toLowerCase();
  if (direct.startsWith("audio/")) return direct;
  const ext = s(file.name).toLowerCase().split(".").pop() || "";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "mp4") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "flac") return "audio/flac";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "webm") return "audio/webm";
  if (ext === "wav") return "audio/wav";
  return "audio/mpeg";
}

async function toAudioDataUri(file: File): Promise<string> {
  const mimeType = inferAudioMimeType(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function resolveTranscriptionBaseUrls(baseUrl: string): string[] {
  const normalized = normalizeBaseUrl(baseUrl);
  const unique = new Set<string>([
    normalized,
    ALIBABA_QWEN_DEFAULT_BASE_URL,
    ALIBABA_QWEN_CN_BASE_URL,
    ALIBABA_QWEN_US_BASE_URL,
  ]);
  return Array.from(unique);
}

function toDashScopeApiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}/api/v1`;
  } catch {
    return ALIBABA_QWEN_DEFAULT_API_BASE_URL;
  }
}

function resolveDashScopeApiBaseUrls(baseUrl: string): string[] {
  const candidates = resolveTranscriptionBaseUrls(baseUrl).map(toDashScopeApiBaseUrl);
  const unique = new Set<string>([
    ...candidates,
    ALIBABA_QWEN_DEFAULT_API_BASE_URL,
    ALIBABA_QWEN_CN_API_BASE_URL,
    ALIBABA_QWEN_US_API_BASE_URL,
  ]);
  return Array.from(unique);
}

function normalizeDashScopeSpeechModel(model: string): string {
  const normalized = s(model);
  if (!normalized) return "qwen3-tts-instruct-flash";
  if (normalized === "qwen3-tts-instruct-flash-realtime") return "qwen3-tts-instruct-flash";
  if (normalized === "qwen3-tts-flash-realtime") return "qwen3-tts-flash";
  if (normalized.endsWith("-realtime")) return normalized.replace(/-realtime$/i, "");
  return normalized;
}

function resolveDashScopeSpeechModelCandidates(model: string): string[] {
  const requested = s(model);
  const normalized = normalizeDashScopeSpeechModel(requested);
  const unique = new Set<string>();
  if (requested) unique.add(requested);
  if (normalized) unique.add(normalized);
  return Array.from(unique);
}

type DashScopeSpeechTextCandidate = {
  name: string;
  text: string;
  truncated: boolean;
  originalChars: number;
};

function truncateDashScopeSpeechText(text: string, maxChars: number): string {
  const raw = s(text);
  if (!raw) return "";
  if (raw.length <= maxChars) return raw;
  const hardSlice = raw.slice(0, maxChars);
  const pivot = Math.floor(maxChars * 0.65);
  let cut = Math.max(
    hardSlice.lastIndexOf("."),
    hardSlice.lastIndexOf("!"),
    hardSlice.lastIndexOf("?"),
    hardSlice.lastIndexOf(";"),
    hardSlice.lastIndexOf(","),
    hardSlice.lastIndexOf(" ")
  );
  if (cut < pivot) cut = -1;
  const sliced = cut >= 0 ? hardSlice.slice(0, cut + 1) : hardSlice;
  const trimmed = sliced.trim();
  return trimmed || hardSlice.trim() || raw.slice(0, maxChars);
}

function buildDashScopeSpeechTextCandidates(text: string): DashScopeSpeechTextCandidate[] {
  const raw = s(text);
  const candidates: DashScopeSpeechTextCandidate[] = [
    {
      name: "input-full",
      text: raw,
      truncated: false,
      originalChars: raw.length,
    },
  ];
  const truncated = truncateDashScopeSpeechText(raw, DASHSCOPE_QWEN3_TTS_MAX_INPUT_CHARS);
  if (truncated && truncated !== raw) {
    candidates.push({
      name: `input-truncated-${DASHSCOPE_QWEN3_TTS_MAX_INPUT_CHARS}-chars`,
      text: truncated,
      truncated: true,
      originalChars: raw.length,
    });
  }
  return candidates;
}

type DashScopeSpeechPayloadVariant = {
  name: string;
  body: Record<string, unknown>;
};

function buildDashScopeSpeechPayloadVariants(args: {
  model: string;
  text: string;
  voice: string;
  instructions: string;
}): DashScopeSpeechPayloadVariant[] {
  const inputBase: Record<string, unknown> = {
    text: args.text,
    voice: args.voice,
  };

  const variants: DashScopeSpeechPayloadVariant[] = [];
  const seen = new Set<string>();
  const pushVariant = (name: string, body: Record<string, unknown>) => {
    const key = JSON.stringify(body);
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ name, body });
  };

  pushVariant("input-basic", {
    model: args.model,
    input: inputBase,
  });

  if (args.instructions) {
    pushVariant("input-instructions", {
      model: args.model,
      input: {
        ...inputBase,
        instructions: args.instructions,
      },
    });

    pushVariant("top-level-instructions", {
      model: args.model,
      input: inputBase,
      instructions: args.instructions,
      optimize_instructions: true,
    });

    pushVariant("parameters-instructions", {
      model: args.model,
      input: inputBase,
      parameters: {
        instructions: args.instructions,
        optimize_instructions: true,
      },
    });
  }

  return variants;
}

function resolveDashScopeErrorMessage(args: {
  payload: unknown;
  rawText: string;
  status: number;
  operation: "speech" | "image" | "chat" | "transcription";
}): string {
  const root = args.payload && typeof args.payload === "object"
    ? (args.payload as Record<string, unknown>)
    : {};
  const nestedError = root.error && typeof root.error === "object"
    ? (root.error as Record<string, unknown>)
    : {};
  const message = s(
    root.message
    || root.error_message
    || root.msg
    || root.error
    || nestedError.message
    || nestedError.msg
  );
  const code = s(
    root.code
    || root.error_code
    || nestedError.code
  );
  if (message && code) return `${message} (${code})`;
  if (message) return message;
  if (code) return `Alibaba Qwen ${args.operation} failed (${code}).`;
  return s(args.rawText) || `Alibaba Qwen ${args.operation} failed with HTTP ${args.status}.`;
}

function isRecoverableDashScopeSpeechFailure(status: number, message: string): boolean {
  if (status === 404 || status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500) return true;
  if (status === 400 || status === 422) {
    return /\b(model|voice|instruction|parameter|language|unsupported|invalid|not found|format|length|long|large|max(?:imum)?|token|character|limit|quota|size|exceed|required|missing)\b/i.test(message);
  }
  return false;
}

function defaultSpeechContentType(format?: "mp3" | "wav" | "pcm"): string {
  if (format === "mp3") return "audio/mpeg";
  if (format === "pcm") return "audio/L16";
  return "audio/wav";
}

function asImageAssets(payload: unknown): AlibabaQwenImageAsset[] {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const direct = Array.isArray(root.data) ? root.data : [];
  const output = root.output && typeof root.output === "object" ? (root.output as Record<string, unknown>) : {};
  const nested = Array.isArray(output.results)
    ? output.results
    : (Array.isArray(output.images) ? output.images : []);

  const rows = [...direct, ...nested];
  const assets: AlibabaQwenImageAsset[] = [];
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = s(row.url || row.image_url || row.imageUrl) || null;
    const b64Json = s(row.b64_json || row.b64Json || row.base64) || null;
    const revisedPrompt = s(row.revised_prompt || row.revisedPrompt) || null;
    if (!url && !b64Json) continue;
    assets.push({
      url,
      b64Json,
      revisedPrompt,
    });
  }
  return assets;
}

function tokenizeForRank(value: string): Set<string> {
  return new Set(
    s(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
  );
}

function tokenOverlapRank(query: string, document: string): number {
  const left = tokenizeForRank(query);
  const right = tokenizeForRank(document);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) {
    if (right.has(token)) hits += 1;
  }
  return hits / Math.max(1, left.size);
}

function lexicalRerank(args: {
  query: string;
  documents: string[];
  topN: number;
}): AlibabaQwenRerankItem[] {
  return args.documents
    .map((document, index) => ({
      index,
      score: tokenOverlapRank(args.query, document),
      document,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.topN);
}

function readAlibabaQwenConfig(): AlibabaQwenConfigValidation {
  const apiKey = readConfiguredSecret(["ALIBABA_API_KEY", "ALIBABA_QWEN_API_KEY", "DASHSCOPE_API_KEY"]);
  const baseUrl = normalizeBaseUrl(s(process.env.ALIBABA_BASE_URL || process.env.ALIBABA_QWEN_BASE_URL || process.env.DASHSCOPE_BASE_URL));
  const flashModel = s(process.env.ALIBABA_FLASH_MODEL || process.env.ALIBABA_QWEN_FLASH_MODEL || process.env.DASHSCOPE_FLASH_MODEL)
    || ALIBABA_QWEN_FLASH_MODEL;
  const plusModel = s(process.env.ALIBABA_PLUS_MODEL || process.env.ALIBABA_QWEN_PLUS_MODEL || process.env.DASHSCOPE_PLUS_MODEL)
    || ALIBABA_QWEN_PLUS_MODEL;
  const maxModel = s(process.env.ALIBABA_MAX_MODEL || process.env.ALIBABA_QWEN_MAX_MODEL || process.env.DASHSCOPE_MAX_MODEL)
    || ALIBABA_QWEN_MAX_MODEL;
  const coderModel = s(process.env.ALIBABA_QWEN_CODER_MODEL || process.env.DASHSCOPE_CODER_MODEL)
    || ALIBABA_QWEN_CODER_MODEL;
  const characterModel = s(
    process.env.ALIBABA_QWEN_CHARACTER_MODEL
    || process.env.ALIBABA_CHARACTER_MODEL
    || process.env.DASHSCOPE_CHARACTER_MODEL
  ) || ALIBABA_QWEN_CHARACTER_MODEL;
  const imageModel = s(
    process.env.ALIBABA_QWEN_IMAGE_MODEL
    || process.env.ALIBABA_IMAGE_MODEL
    || process.env.DASHSCOPE_IMAGE_MODEL
  ) || ALIBABA_QWEN_IMAGE_MODEL;
  const imageEditModel = s(
    process.env.ALIBABA_QWEN_IMAGE_EDIT_MODEL
    || process.env.ALIBABA_IMAGE_EDIT_MODEL
    || process.env.DASHSCOPE_IMAGE_EDIT_MODEL
  ) || ALIBABA_QWEN_IMAGE_EDIT_MODEL;
  const asrModel = s(process.env.ALIBABA_ASR_MODEL || process.env.ALIBABA_QWEN_ASR_MODEL || process.env.DASHSCOPE_ASR_MODEL)
    || ALIBABA_QWEN_ASR_MODEL;
  const asrRealtimeModel = s(
    process.env.ALIBABA_ASR_REALTIME_MODEL
    || process.env.ALIBABA_QWEN_ASR_REALTIME_MODEL
    || process.env.DASHSCOPE_ASR_REALTIME_MODEL
  ) || ALIBABA_QWEN_ASR_REALTIME_MODEL;
  const ttsRealtimeModel = s(
    process.env.ALIBABA_TTS_REALTIME_MODEL
    || process.env.ALIBABA_QWEN_TTS_REALTIME_MODEL
    || process.env.DASHSCOPE_TTS_REALTIME_MODEL
  ) || ALIBABA_QWEN_TTS_REALTIME_MODEL;
  const omniRealtimeModel = s(
    process.env.ALIBABA_OMNI_REALTIME_MODEL
    || process.env.ALIBABA_QWEN_OMNI_REALTIME_MODEL
    || process.env.DASHSCOPE_OMNI_REALTIME_MODEL
  ) || ALIBABA_QWEN_OMNI_REALTIME_MODEL;
  const embeddingModel = s(
    process.env.ALIBABA_EMBEDDING_MODEL
    || process.env.ALIBABA_QWEN_EMBEDDING_MODEL
    || process.env.DASHSCOPE_EMBEDDING_MODEL
  ) || ALIBABA_QWEN_EMBEDDING_MODEL;
  const rerankModel = s(
    process.env.ALIBABA_RERANK_MODEL
    || process.env.ALIBABA_QWEN_RERANK_MODEL
    || process.env.DASHSCOPE_RERANK_MODEL
  ) || ALIBABA_QWEN_RERANK_MODEL;

  const missing: string[] = [];
  const invalid: string[] = [];

  if (!apiKey) {
    missing.push("ALIBABA_API_KEY");
  }
  if (flashModel !== ALIBABA_QWEN_FLASH_MODEL) {
    invalid.push(`ALIBABA_FLASH_MODEL must be "${ALIBABA_QWEN_FLASH_MODEL}"`);
  }
  if (plusModel !== ALIBABA_QWEN_PLUS_MODEL) {
    invalid.push(`ALIBABA_PLUS_MODEL must be "${ALIBABA_QWEN_PLUS_MODEL}"`);
  }
  if (maxModel !== ALIBABA_QWEN_MAX_MODEL) {
    invalid.push(`ALIBABA_MAX_MODEL must be "${ALIBABA_QWEN_MAX_MODEL}"`);
  }
  if (coderModel !== ALIBABA_QWEN_CODER_MODEL) {
    invalid.push(`ALIBABA_QWEN_CODER_MODEL must be "${ALIBABA_QWEN_CODER_MODEL}"`);
  }
  if (characterModel !== ALIBABA_QWEN_CHARACTER_MODEL) {
    invalid.push(`ALIBABA_QWEN_CHARACTER_MODEL must be "${ALIBABA_QWEN_CHARACTER_MODEL}"`);
  }
  if (imageModel !== ALIBABA_QWEN_IMAGE_MODEL) {
    invalid.push(`ALIBABA_QWEN_IMAGE_MODEL must be "${ALIBABA_QWEN_IMAGE_MODEL}"`);
  }
  if (imageEditModel !== ALIBABA_QWEN_IMAGE_EDIT_MODEL) {
    invalid.push(`ALIBABA_QWEN_IMAGE_EDIT_MODEL must be "${ALIBABA_QWEN_IMAGE_EDIT_MODEL}"`);
  }
  if (asrModel !== ALIBABA_QWEN_ASR_MODEL) {
    invalid.push(`ALIBABA_ASR_MODEL must be "${ALIBABA_QWEN_ASR_MODEL}"`);
  }
  if (asrRealtimeModel !== ALIBABA_QWEN_ASR_REALTIME_MODEL) {
    invalid.push(`ALIBABA_ASR_REALTIME_MODEL must be "${ALIBABA_QWEN_ASR_REALTIME_MODEL}"`);
  }
  if (ttsRealtimeModel !== ALIBABA_QWEN_TTS_REALTIME_MODEL) {
    invalid.push(`ALIBABA_TTS_REALTIME_MODEL must be "${ALIBABA_QWEN_TTS_REALTIME_MODEL}"`);
  }
  if (omniRealtimeModel !== ALIBABA_QWEN_OMNI_REALTIME_MODEL) {
    invalid.push(`ALIBABA_OMNI_REALTIME_MODEL must be "${ALIBABA_QWEN_OMNI_REALTIME_MODEL}"`);
  }
  if (embeddingModel !== ALIBABA_QWEN_EMBEDDING_MODEL) {
    invalid.push(`ALIBABA_EMBEDDING_MODEL must be "${ALIBABA_QWEN_EMBEDDING_MODEL}"`);
  }
  if (rerankModel !== ALIBABA_QWEN_RERANK_MODEL) {
    invalid.push(`ALIBABA_RERANK_MODEL must be "${ALIBABA_QWEN_RERANK_MODEL}"`);
  }

  if (missing.length || invalid.length) {
    return {
      ok: false,
      missing,
      invalid,
      baseUrl,
      flashModel: flashModel || ALIBABA_QWEN_FLASH_MODEL,
      plusModel: plusModel || ALIBABA_QWEN_PLUS_MODEL,
      maxModel: maxModel || ALIBABA_QWEN_MAX_MODEL,
      coderModel: coderModel || ALIBABA_QWEN_CODER_MODEL,
      characterModel: characterModel || ALIBABA_QWEN_CHARACTER_MODEL,
      imageModel: imageModel || ALIBABA_QWEN_IMAGE_MODEL,
      imageEditModel: imageEditModel || ALIBABA_QWEN_IMAGE_EDIT_MODEL,
      asrModel: asrModel || ALIBABA_QWEN_ASR_MODEL,
      asrRealtimeModel: asrRealtimeModel || ALIBABA_QWEN_ASR_REALTIME_MODEL,
      ttsRealtimeModel: ttsRealtimeModel || ALIBABA_QWEN_TTS_REALTIME_MODEL,
      omniRealtimeModel: omniRealtimeModel || ALIBABA_QWEN_OMNI_REALTIME_MODEL,
      embeddingModel: embeddingModel || ALIBABA_QWEN_EMBEDDING_MODEL,
      rerankModel: rerankModel || ALIBABA_QWEN_RERANK_MODEL,
    };
  }

  return {
    ok: true,
    value: {
      apiKey,
      baseUrl,
      flashModel: ALIBABA_QWEN_FLASH_MODEL,
      plusModel: ALIBABA_QWEN_PLUS_MODEL,
      maxModel: ALIBABA_QWEN_MAX_MODEL,
      coderModel: ALIBABA_QWEN_CODER_MODEL,
      characterModel: ALIBABA_QWEN_CHARACTER_MODEL,
      imageModel: ALIBABA_QWEN_IMAGE_MODEL,
      imageEditModel: ALIBABA_QWEN_IMAGE_EDIT_MODEL,
      asrModel: ALIBABA_QWEN_ASR_MODEL,
      asrRealtimeModel: ALIBABA_QWEN_ASR_REALTIME_MODEL,
      ttsRealtimeModel: ALIBABA_QWEN_TTS_REALTIME_MODEL,
      omniRealtimeModel: ALIBABA_QWEN_OMNI_REALTIME_MODEL,
      embeddingModel: ALIBABA_QWEN_EMBEDDING_MODEL,
      rerankModel: ALIBABA_QWEN_RERANK_MODEL,
    },
  };
}

export function assertAlibabaQwenEnv(): AlibabaQwenConfig {
  const result = readAlibabaQwenConfig();
  if (!result.ok) {
    const code = result.invalid.length ? "ALIBABA_QWEN_MODEL_UNSUPPORTED" : "ALIBABA_QWEN_ENV_MISSING";
    const message = result.invalid.length
      ? `Alibaba Qwen model environment is invalid: ${result.invalid.join("; ")}`
      : `Missing required Alibaba Qwen environment variables: ${result.missing.join(", ")}`;
    throw new AiProviderError(code, message, 500, {
      missing: result.missing,
      invalid: result.invalid,
    });
  }
  return result.value;
}

export function alibabaQwenEnvStatus() {
  const result = readAlibabaQwenConfig();
  if (!result.ok) {
    return {
      ok: false as const,
      missing: result.missing,
      invalid: result.invalid,
      baseUrl: result.baseUrl,
      flashModel: result.flashModel,
      plusModel: result.plusModel,
      maxModel: result.maxModel,
      coderModel: result.coderModel,
      characterModel: result.characterModel,
      imageModel: result.imageModel,
      imageEditModel: result.imageEditModel,
      asrModel: result.asrModel,
      asrRealtimeModel: result.asrRealtimeModel,
      ttsRealtimeModel: result.ttsRealtimeModel,
      omniRealtimeModel: result.omniRealtimeModel,
      embeddingModel: result.embeddingModel,
      rerankModel: result.rerankModel,
    };
  }

  return {
    ok: true as const,
    missing: [] as string[],
    invalid: [] as string[],
    baseUrl: result.value.baseUrl,
    flashModel: result.value.flashModel,
    plusModel: result.value.plusModel,
    maxModel: result.value.maxModel,
    coderModel: result.value.coderModel,
    characterModel: result.value.characterModel,
    imageModel: result.value.imageModel,
    imageEditModel: result.value.imageEditModel,
    asrModel: result.value.asrModel,
    asrRealtimeModel: result.value.asrRealtimeModel,
    ttsRealtimeModel: result.value.ttsRealtimeModel,
    omniRealtimeModel: result.value.omniRealtimeModel,
    embeddingModel: result.value.embeddingModel,
    rerankModel: result.value.rerankModel,
  };
}

let alibabaQwenClientSingleton: OpenAI | null = null;

export function getAlibabaQwenClient(): OpenAI {
  if (!alibabaQwenClientSingleton) {
    const config = assertAlibabaQwenEnv();
    alibabaQwenClientSingleton = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }
  return alibabaQwenClientSingleton;
}

export class AlibabaQwenProvider implements AiProvider {
  readonly id = "alibaba_qwen" as const;
  readonly supportsJsonMode = true;
  private readonly config: AlibabaQwenConfig;
  private readonly client: OpenAI;

  constructor(config?: AlibabaQwenConfig, client?: OpenAI) {
    this.config = config || assertAlibabaQwenEnv();
    this.client = client || getAlibabaQwenClient();
  }

  resolveModel(role: AiModelRole): string {
    if (role === "reasoning") return this.config.maxModel;
    return this.config.plusModel;
  }

  getPublicConfig(): AiProviderPublicConfig {
    return {
      id: this.id,
      supportsJsonMode: this.supportsJsonMode,
      models: {
        chat: this.config.plusModel,
        reasoning: this.config.maxModel,
      },
      baseUrl: this.config.baseUrl,
    };
  }

  async generate(input: AiProviderGenerateRequest): Promise<AiProviderGenerateResponse> {
    const model = s(input.model);
    if (!model) {
      throw new AiProviderError("ALIBABA_QWEN_MODEL_MISSING", "model is required.", 400);
    }
    if (
      model !== this.config.flashModel
      && model !== this.config.plusModel
      && model !== this.config.maxModel
      && model !== this.config.omniRealtimeModel
      && model !== this.config.coderModel
      && model !== this.config.characterModel
    ) {
      throw new AiProviderError(
        "ALIBABA_QWEN_MODEL_UNSUPPORTED",
        `Unsupported Alibaba Qwen model "${model}". Allowed models: "${this.config.flashModel}", "${this.config.plusModel}", "${this.config.maxModel}", "${this.config.omniRealtimeModel}", "${this.config.coderModel}", and "${this.config.characterModel}".`,
        400
      );
    }
    if (!Array.isArray(input.messages) || !input.messages.length) {
      throw new AiProviderError("ALIBABA_QWEN_MESSAGES_MISSING", "messages are required.", 400);
    }

    const timeoutMs = Math.max(2_000, Number(input.timeoutMs || DEFAULT_TIMEOUT_MS));
    const timeoutController = new AbortController();
    const requestController = new AbortController();
    const detachFns: Array<() => void> = [];
    let timedOut = false;

    const forwardAbort = (source: AbortSignal | null | undefined) => {
      if (!source) return;
      if (source.aborted) {
        requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
        return;
      }
      const handler = () => {
        requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      };
      source.addEventListener("abort", handler, { once: true });
      detachFns.push(() => source.removeEventListener("abort", handler));
    };

    forwardAbort(input.signal);
    forwardAbort(timeoutController.signal);

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);

    try {
      const tools = Array.isArray(input.tools) && input.tools.length
        ? input.tools
            .map((tool) => {
              const id = s(tool.id);
              if (!id) return null;
              return {
                type: "function" as const,
                function: {
                  name: id,
                  description: s(tool.description) || `${id} tool`,
                  parameters: {
                    type: "object",
                    additionalProperties: true,
                    properties: {},
                  },
                },
              };
            })
            .filter(Boolean)
        : undefined;

      const reasoningEffort = s(input.reasoningEffort).toLowerCase();
      const completion = await this.client.chat.completions.create(
        {
          model,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens,
          response_format:
            input.responseFormat?.type === "json_object" ? { type: "json_object" } : undefined,
          tools,
          tool_choice: tools?.length ? input.toolChoice || "auto" : undefined,
          reasoning_effort:
            reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high"
              ? reasoningEffort
              : undefined,
          stream: false,
        } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        {
          signal: requestController.signal,
        }
      );

      const firstChoice = completion.choices?.[0];
      const content = asChatContent(firstChoice?.message?.content);
      if (!content) {
        throw new AiProviderError(
          "ALIBABA_QWEN_EMPTY_RESPONSE",
          "Alibaba Qwen returned an empty response payload.",
          502,
          completion
        );
      }

      return {
        id: s(completion.id) || crypto.randomUUID(),
        model: s(completion.model) || model,
        content,
        finishReason: s(firstChoice?.finish_reason) || null,
        usage: {
          promptTokens: asInt(completion.usage?.prompt_tokens),
          completionTokens: asInt(completion.usage?.completion_tokens),
          totalTokens: asInt(completion.usage?.total_tokens),
        },
        raw: completion,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        if (timedOut) {
          throw new AiProviderError(
            "ALIBABA_QWEN_TIMEOUT",
            `Alibaba Qwen request timed out after ${timeoutMs}ms.`,
            504
          );
        }
        throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen request was cancelled.", 499);
      }

      const status = Number((error as { status?: unknown })?.status || 0);
      if (status > 0) {
        throw new AiProviderError(
          "ALIBABA_QWEN_REQUEST_FAILED",
          error instanceof Error ? error.message : `Alibaba Qwen request failed with HTTP ${status}.`,
          status
        );
      }

      const message = error instanceof Error ? error.message : "Unknown provider error";
      throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
    } finally {
      clearTimeout(timer);
      for (const fn of detachFns) fn();
    }
  }
}

let alibabaQwenProviderSingleton: AlibabaQwenProvider | null = null;

export function getAlibabaQwenProvider(): AlibabaQwenProvider {
  if (!alibabaQwenProviderSingleton) {
    alibabaQwenProviderSingleton = new AlibabaQwenProvider();
  }
  return alibabaQwenProviderSingleton;
}

export async function generateAlibabaQwenImage(args: {
  prompt: string;
  model?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenImageResult> {
  const config = assertAlibabaQwenEnv();
  const prompt = s(args.prompt);
  if (!prompt) {
    throw new AiProviderError("ALIBABA_QWEN_IMAGE_PROMPT_REQUIRED", "prompt is required.", 400);
  }

  const model = s(args.model) || config.imageModel;
  if (model !== config.imageModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen image model "${model}". Only "${config.imageModel}" is allowed.`,
      400
    );
  }

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const result = await getAlibabaQwenClient().images.generate(
      {
        model,
        prompt,
        size: s(args.size) || "1024x1024",
      } as unknown as OpenAI.Images.ImageGenerateParams,
      {
        signal: requestController.signal,
      }
    );

    const images = asImageAssets(result);
    if (!images.length) {
      throw new AiProviderError(
        "ALIBABA_QWEN_EMPTY_IMAGE_RESPONSE",
        "Alibaba Qwen returned an empty image payload.",
        502,
        result
      );
    }

    return {
      model,
      images,
      raw: result,
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen image generation timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen image generation was cancelled.", 499);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status > 0) {
      throw new AiProviderError(
        "ALIBABA_QWEN_REQUEST_FAILED",
        error instanceof Error ? error.message : `Alibaba Qwen image generation failed with HTTP ${status}.`,
        status
      );
    }
    const message = error instanceof Error ? error.message : "Unknown provider error";
    throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}

export async function editAlibabaQwenImage(args: {
  prompt: string;
  image: File;
  model?: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenImageResult> {
  const config = assertAlibabaQwenEnv();
  const prompt = s(args.prompt);
  if (!prompt) {
    throw new AiProviderError("ALIBABA_QWEN_IMAGE_PROMPT_REQUIRED", "prompt is required.", 400);
  }
  if (!(args.image instanceof File)) {
    throw new AiProviderError("ALIBABA_QWEN_IMAGE_INPUT_REQUIRED", "image file is required.", 400);
  }

  const model = s(args.model) || config.imageEditModel;
  if (model !== config.imageEditModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen image edit model "${model}". Only "${config.imageEditModel}" is allowed.`,
      400
    );
  }

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const result = await getAlibabaQwenClient().images.edit(
      {
        model,
        prompt,
        image: args.image,
        size: s(args.size) || "1024x1024",
      } as unknown as OpenAI.Images.ImageEditParams,
      {
        signal: requestController.signal,
      }
    );

    const images = asImageAssets(result);
    if (!images.length) {
      throw new AiProviderError(
        "ALIBABA_QWEN_EMPTY_IMAGE_RESPONSE",
        "Alibaba Qwen returned an empty image-edit payload.",
        502,
        result
      );
    }

    return {
      model,
      images,
      raw: result,
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen image edit timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen image edit was cancelled.", 499);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status > 0) {
      throw new AiProviderError(
        "ALIBABA_QWEN_REQUEST_FAILED",
        error instanceof Error ? error.message : `Alibaba Qwen image edit failed with HTTP ${status}.`,
        status
      );
    }
    const message = error instanceof Error ? error.message : "Unknown provider error";
    throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}

export async function transcribeAlibabaQwenAudio(args: {
  file: File;
  model?: string;
  strictModel?: boolean;
  prompt?: string;
  language?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenTranscriptionResult> {
  const config = assertAlibabaQwenEnv();
  const model = s(args.model) || config.asrModel;
  if (model !== config.asrModel && model !== config.asrRealtimeModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen transcription model "${model}". Allowed models: "${config.asrRealtimeModel}" and "${config.asrModel}".`,
      400
    );
  }
  if (args.strictModel === true && model === config.asrRealtimeModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_REALTIME_MODEL_REQUIRES_STREAMING",
      `Model "${config.asrRealtimeModel}" requires realtime streaming (WebSocket). File transcription on this route must use "${config.asrModel}".`,
      400,
      {
        requestedModel: model,
        supportedFileTranscriptionModel: config.asrModel,
      }
    );
  }

  if (!(args.file instanceof File)) {
    throw new AiProviderError("ALIBABA_QWEN_AUDIO_FILE_REQUIRED", "audio file is required.", 400);
  }
  if (args.file.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new AiProviderError(
      "ALIBABA_QWEN_AUDIO_TOO_LARGE",
      `Audio file exceeds ${MAX_TRANSCRIPTION_AUDIO_BYTES} bytes, which is the maximum supported for DashScope OpenAI-compatible ASR.`,
      400,
      {
        maxBytes: MAX_TRANSCRIPTION_AUDIO_BYTES,
        sizeBytes: args.file.size,
      }
    );
  }

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TRANSCRIPTION_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const prompt = s(args.prompt);
    const language = s(args.language);
    const audioDataUri = await toAudioDataUri(args.file);

    const createTranscription = (client: OpenAI, modelId: string) =>
      client.chat.completions.create(
        {
          model: modelId,
          messages: [
            ...(prompt
              ? [
                  {
                    role: "system" as const,
                    content: [{ type: "text", text: prompt }],
                  },
                ]
              : []),
            {
              role: "user" as const,
              content: [
                {
                  type: "input_audio",
                  input_audio: {
                    data: audioDataUri,
                  },
                },
              ],
            },
          ],
          temperature: 0,
          stream: false,
          extra_body: language
            ? {
                asr_options: {
                  language,
                },
              }
            : undefined,
        } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: requestController.signal }
      );

    const primaryBaseUrl = normalizeBaseUrl(config.baseUrl);
    const baseUrlCandidates = resolveTranscriptionBaseUrls(primaryBaseUrl);
    const modelCandidates =
      args.strictModel === true
        ? [model]
        : (model === config.asrRealtimeModel ? [config.asrRealtimeModel, config.asrModel] : [model]);

    const attempts: Array<{
      model: string;
      baseUrl: string;
      upstreamStatus: number;
      message: string;
    }> = [];
    let result: unknown = null;
    let resolvedModel = model;
    let lastError: unknown = null;

    outer:
    for (const modelCandidate of modelCandidates) {
      for (const baseUrl of baseUrlCandidates) {
        const client = baseUrl === primaryBaseUrl
          ? getAlibabaQwenClient()
          : new OpenAI({
              apiKey: config.apiKey,
              baseURL: baseUrl,
            });
        try {
          result = await createTranscription(client, modelCandidate);
          resolvedModel = modelCandidate;
          break outer;
        } catch (attemptError) {
          lastError = attemptError;
          const upstreamStatus = Number((attemptError as { status?: unknown })?.status || 0);
          const message = s(attemptError instanceof Error ? attemptError.message : "");
          attempts.push({
            model: modelCandidate,
            baseUrl,
            upstreamStatus,
            message,
          });

          if (upstreamStatus === 404) {
            continue;
          }

          const realtimeModelMaybeUnavailable =
            modelCandidate === config.asrRealtimeModel
            && upstreamStatus === 400
            && /\b(model|unsupported|not found|invalid)\b/i.test(message);
          if (realtimeModelMaybeUnavailable) {
            break;
          }

          throw attemptError;
        }
      }
    }

    if (!result) {
      const all404 = attempts.length > 0 && attempts.every((item) => item.upstreamStatus === 404);
      if (all404) {
        throw new AiProviderError(
          "ALIBABA_QWEN_TRANSCRIPTION_ENDPOINT_NOT_FOUND",
          "Alibaba Qwen transcription endpoint returned 404. Check DashScope region/base URL and OpenAI-compatible ASR availability for this API key.",
          502,
          {
            model,
            upstreamStatus: 404,
            attemptedBaseUrls: Array.from(new Set(attempts.map((item) => item.baseUrl))),
            attempts,
          }
        );
      }
      if (lastError) throw lastError;
      throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", "Alibaba Qwen transcription failed without a provider response.", 502);
    }

    const root = result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : {};
    const output = root.output && typeof root.output === "object"
      ? (root.output as Record<string, unknown>)
      : {};
    const usage = root.usage && typeof root.usage === "object"
      ? (root.usage as Record<string, unknown>)
      : {};
    const firstChoice = Array.isArray(root.choices) && root.choices[0] && typeof root.choices[0] === "object"
      ? (root.choices[0] as Record<string, unknown>)
      : {};
    const firstMessage = firstChoice.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : {};
    const text = asChatContent(firstMessage.content || root.text || output.text);
    if (!text) {
      throw new AiProviderError(
        "ALIBABA_QWEN_EMPTY_TRANSCRIPTION",
        "Alibaba Qwen returned an empty transcription payload.",
        502,
        result
      );
    }

    const resolvedLanguage = s(root.language || output.language || language) || null;
    const durationSeconds = asNumber(
      root.duration
      || output.duration
      || usage.audio_duration
      || usage.audio_duration_seconds
    );

    return {
      text,
      language: resolvedLanguage,
      durationSeconds,
      model: resolvedModel,
      raw: result,
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen transcription timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen transcription was cancelled.", 499);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status > 0) {
      throw new AiProviderError(
        "ALIBABA_QWEN_REQUEST_FAILED",
        error instanceof Error ? error.message : `Alibaba Qwen transcription failed with HTTP ${status}.`,
        status
      );
    }
    const message = error instanceof Error ? error.message : "Unknown provider error";
    throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}

export async function synthesizeAlibabaQwenSpeech(args: {
  text: string;
  model?: string;
  voice?: string;
  instructions?: string;
  format?: "mp3" | "wav" | "pcm";
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenSpeechResult> {
  const config = assertAlibabaQwenEnv();
  const text = s(args.text);
  if (!text) {
    throw new AiProviderError("ALIBABA_QWEN_TTS_TEXT_REQUIRED", "text is required.", 400);
  }

  const model = s(args.model) || config.ttsRealtimeModel;
  if (model !== config.ttsRealtimeModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen speech model "${model}". Only "${config.ttsRealtimeModel}" is allowed.`,
      400
    );
  }
  const modelCandidates = resolveDashScopeSpeechModelCandidates(model);
  const voice = s(args.voice) || "Ethan";
  const instructions = s(args.instructions);
  const textCandidates = buildDashScopeSpeechTextCandidates(text);

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const apiBaseCandidates = resolveDashScopeApiBaseUrls(config.baseUrl);
    const attempts: Array<{
      apiBaseUrl: string;
      endpoint: string;
      model: string;
      textVariant: string;
      inputChars: number;
      inputTruncated: boolean;
      payloadVariant: string;
      upstreamStatus: number;
      message: string;
    }> = [];

    let payloadResult: unknown = null;
    let audioBuffer: ArrayBuffer | null = null;
    let contentType = defaultSpeechContentType(args.format);
    let lastError: unknown = null;
    let lastRecoverableAttempt: (typeof attempts)[number] | null = null;
    let resolvedModel = model;

    outer:
    for (const apiBaseUrl of apiBaseCandidates) {
      const endpoint = `${apiBaseUrl.replace(/\/+$/, "")}/services/aigc/multimodal-generation/generation`;
      for (const modelCandidate of modelCandidates) {
        for (const textCandidate of textCandidates) {
          const payloadVariants = buildDashScopeSpeechPayloadVariants({
            model: modelCandidate,
            text: textCandidate.text,
            voice,
            instructions,
          });
          for (const payloadVariant of payloadVariants) {
            try {
              const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${config.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(payloadVariant.body),
                signal: requestController.signal,
              });

              const rawText = await response.text();
              let payload: unknown = null;
              try {
                payload = rawText ? JSON.parse(rawText) : null;
              } catch {
                payload = rawText;
              }

              if (!response.ok) {
                const message = resolveDashScopeErrorMessage({
                  payload,
                  rawText,
                  status: response.status,
                  operation: "speech",
                });
                const attempt = {
                  apiBaseUrl,
                  endpoint,
                  model: modelCandidate,
                  textVariant: textCandidate.name,
                  inputChars: textCandidate.text.length,
                  inputTruncated: textCandidate.truncated,
                  payloadVariant: payloadVariant.name,
                  upstreamStatus: response.status,
                  message,
                };
                attempts.push(attempt);
                if (isRecoverableDashScopeSpeechFailure(response.status, message)) {
                  lastRecoverableAttempt = attempt;
                  continue;
                }
                throw new AiProviderError("ALIBABA_QWEN_REQUEST_FAILED", message, response.status, {
                  apiBaseUrl,
                  endpoint,
                  model: modelCandidate,
                  textVariant: textCandidate.name,
                  inputChars: textCandidate.text.length,
                  inputTruncated: textCandidate.truncated,
                  payloadVariant: payloadVariant.name,
                  upstream: payload,
                });
              }

              payloadResult = payload;
              const root = payload && typeof payload === "object"
                ? (payload as Record<string, unknown>)
                : {};
              const output = root.output && typeof root.output === "object"
                ? (root.output as Record<string, unknown>)
                : {};
              const audio = output.audio && typeof output.audio === "object"
                ? (output.audio as Record<string, unknown>)
                : {};
              const inlineAudio = s(
                audio.data
                || audio.audio
                || audio.b64
                || audio.b64_audio
                || output.audio_data
                || root.audio_data
              );
              if (inlineAudio) {
                const binary = Buffer.from(inlineAudio, "base64");
                audioBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
                resolvedModel = modelCandidate;
                break outer;
              }

              const audioUrl = s(audio.url || output.audio_url || root.audio_url);
              if (audioUrl) {
                let audioResponse = await fetch(audioUrl, {
                  method: "GET",
                  headers: {
                    Accept: "audio/*",
                  },
                  signal: requestController.signal,
                });

                if (!audioResponse.ok && (audioResponse.status === 401 || audioResponse.status === 403)) {
                  const retryWithAuth = await fetch(audioUrl, {
                    method: "GET",
                    headers: {
                      Accept: "audio/*",
                      Authorization: `Bearer ${config.apiKey}`,
                    },
                    signal: requestController.signal,
                  });
                  if (retryWithAuth.ok) {
                    audioResponse = retryWithAuth;
                  }
                }

                if (!audioResponse.ok) {
                  const message = `Alibaba Qwen speech audio download failed with HTTP ${audioResponse.status}.`;
                  const attempt = {
                    apiBaseUrl,
                    endpoint,
                    model: modelCandidate,
                    textVariant: textCandidate.name,
                    inputChars: textCandidate.text.length,
                    inputTruncated: textCandidate.truncated,
                    payloadVariant: payloadVariant.name,
                    upstreamStatus: audioResponse.status,
                    message,
                  };
                  attempts.push(attempt);
                  if (isRecoverableDashScopeSpeechFailure(audioResponse.status, message)) {
                    lastRecoverableAttempt = attempt;
                    continue;
                  }
                  throw new AiProviderError(
                    "ALIBABA_QWEN_REQUEST_FAILED",
                    message,
                    audioResponse.status,
                    {
                      apiBaseUrl,
                      endpoint,
                      model: modelCandidate,
                      textVariant: textCandidate.name,
                      inputChars: textCandidate.text.length,
                      inputTruncated: textCandidate.truncated,
                      payloadVariant: payloadVariant.name,
                      audioUrl,
                    }
                  );
                }
                const headerType = s(audioResponse.headers.get("content-type"));
                if (headerType) contentType = headerType;
                audioBuffer = await audioResponse.arrayBuffer();
                if (audioBuffer.byteLength > 0) {
                  resolvedModel = modelCandidate;
                  break outer;
                }
              }

              attempts.push({
                apiBaseUrl,
                endpoint,
                model: modelCandidate,
                textVariant: textCandidate.name,
                inputChars: textCandidate.text.length,
                inputTruncated: textCandidate.truncated,
                payloadVariant: payloadVariant.name,
                upstreamStatus: 502,
                message: "Alibaba Qwen speech response did not include audio data.",
              });
            } catch (attemptError) {
              lastError = attemptError;
              if (attemptError instanceof AiProviderError) {
                if (isRecoverableDashScopeSpeechFailure(attemptError.status, attemptError.message)) {
                  continue;
                }
                throw attemptError;
              }
              const status = Number((attemptError as { status?: unknown })?.status || 0);
              const message = attemptError instanceof Error ? attemptError.message : "";
              if (isRecoverableDashScopeSpeechFailure(status, message)) continue;
              throw attemptError;
            }
          }
        }
      }
    }

    if (!audioBuffer || audioBuffer.byteLength <= 0) {
      const all404 = attempts.length > 0 && attempts.every((item) => item.upstreamStatus === 404);
      if (all404) {
        throw new AiProviderError(
          "ALIBABA_QWEN_TTS_ENDPOINT_NOT_FOUND",
          "Alibaba Qwen speech endpoint returned 404. Check DashScope region/base URL compatibility for TTS.",
          502,
          {
            model,
            modelCandidates,
            attemptedApiBaseUrls: attempts.map((item) => item.apiBaseUrl),
            attempts,
          }
        );
      }
      if (lastRecoverableAttempt) {
        throw new AiProviderError(
          "ALIBABA_QWEN_REQUEST_FAILED",
          lastRecoverableAttempt.message,
          lastRecoverableAttempt.upstreamStatus || 400,
          {
            model,
            modelCandidates,
            textCandidates: textCandidates.map((item) => ({
              name: item.name,
              inputChars: item.text.length,
              inputTruncated: item.truncated,
              originalChars: item.originalChars,
            })),
            attempts,
          }
        );
      }
      if (lastError instanceof AiProviderError) throw lastError;
      throw new AiProviderError(
        "ALIBABA_QWEN_EMPTY_SPEECH_RESPONSE",
        "Alibaba Qwen returned an empty speech payload.",
        502,
        payloadResult
      );
    }

    return {
      model: resolvedModel,
      contentType,
      audioBuffer,
      raw: payloadResult,
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen speech timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen speech request was cancelled.", 499);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status > 0) {
      throw new AiProviderError(
        "ALIBABA_QWEN_REQUEST_FAILED",
        error instanceof Error ? error.message : `Alibaba Qwen speech failed with HTTP ${status}.`,
        status
      );
    }
    const message = error instanceof Error ? error.message : "Unknown provider error";
    throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}

export async function embedAlibabaQwenText(args: {
  text: string;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenEmbeddingResult> {
  const config = assertAlibabaQwenEnv();
  const text = s(args.text);
  if (!text) {
    throw new AiProviderError("ALIBABA_QWEN_EMBEDDING_TEXT_REQUIRED", "text is required.", 400);
  }

  const model = s(args.model) || config.embeddingModel;
  if (model !== config.embeddingModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen embedding model "${model}". Only "${config.embeddingModel}" is allowed.`,
      400
    );
  }

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const result = await getAlibabaQwenClient().embeddings.create(
      {
        model,
        input: text,
      } as unknown as AlibabaEmbeddingCreateParams,
      {
        signal: requestController.signal,
      }
    );

    const first = Array.isArray((result as { data?: unknown[] }).data)
      ? ((result as { data: unknown[] }).data[0] as { embedding?: unknown } | undefined)
      : undefined;
    const embedding = Array.isArray(first?.embedding)
      ? first.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    if (!embedding.length) {
      throw new AiProviderError(
        "ALIBABA_QWEN_EMPTY_EMBEDDING_RESPONSE",
        "Alibaba Qwen returned an empty embedding payload.",
        502,
        result
      );
    }

    return {
      model,
      embedding,
      dimensions: embedding.length,
      raw: result,
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen embeddings timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen embeddings request was cancelled.", 499);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    if (status > 0) {
      throw new AiProviderError(
        "ALIBABA_QWEN_REQUEST_FAILED",
        error instanceof Error ? error.message : `Alibaba Qwen embeddings failed with HTTP ${status}.`,
        status
      );
    }
    const message = error instanceof Error ? error.message : "Unknown provider error";
    throw new AiProviderError("ALIBABA_QWEN_NETWORK_ERROR", message, 502);
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}

export async function rerankAlibabaQwenDocuments(args: {
  query: string;
  documents: string[];
  model?: string;
  topN?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AlibabaQwenRerankResult> {
  const config = assertAlibabaQwenEnv();
  const query = s(args.query);
  const documents = Array.isArray(args.documents)
    ? args.documents.map((value) => s(value)).filter(Boolean)
    : [];
  const topN = Math.max(1, Math.min(24, Math.trunc(Number(args.topN || 8))));

  if (!query) {
    throw new AiProviderError("ALIBABA_QWEN_RERANK_QUERY_REQUIRED", "query is required.", 400);
  }
  if (!documents.length) {
    throw new AiProviderError("ALIBABA_QWEN_RERANK_DOCUMENTS_REQUIRED", "documents are required.", 400);
  }

  const model = s(args.model) || config.rerankModel;
  if (model !== config.rerankModel) {
    throw new AiProviderError(
      "ALIBABA_QWEN_MODEL_UNSUPPORTED",
      `Unsupported Alibaba Qwen rerank model "${model}". Only "${config.rerankModel}" is allowed.`,
      400
    );
  }

  const timeoutMs = Math.max(2_000, Number(args.timeoutMs || DEFAULT_TIMEOUT_MS));
  const timeoutController = new AbortController();
  const requestController = new AbortController();
  const detachFns: Array<() => void> = [];
  let timedOut = false;

  const forwardAbort = (source: AbortSignal | null | undefined) => {
    if (!source) return;
    if (source.aborted) {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
      return;
    }
    const handler = () => {
      requestController.abort((source as AbortSignal & { reason?: unknown }).reason);
    };
    source.addEventListener("abort", handler, { once: true });
    detachFns.push(() => source.removeEventListener("abort", handler));
  };

  forwardAbort(args.signal);
  forwardAbort(timeoutController.signal);

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: topN,
      }),
      signal: requestController.signal,
      cache: "no-store",
    });

    if (response.ok) {
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const rows = Array.isArray(payload.results)
        ? payload.results
        : (Array.isArray(payload.data) ? payload.data : []);
      const parsed = rows
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const item = row as Record<string, unknown>;
          const index = Math.trunc(Number(item.index ?? item.document_index ?? -1));
          const score = Number(item.relevance_score ?? item.score ?? 0);
          if (!Number.isFinite(index) || index < 0 || index >= documents.length) return null;
          if (!Number.isFinite(score)) return null;
          return {
            index,
            score,
            document: documents[index] || "",
          } satisfies AlibabaQwenRerankItem;
        })
        .filter(Boolean) as AlibabaQwenRerankItem[];
      if (parsed.length) {
        return {
          model,
          items: parsed.slice(0, topN),
          raw: payload,
        };
      }
    }

    const fallback = lexicalRerank({
      query,
      documents,
      topN,
    });
    return {
      model,
      items: fallback,
      raw: { fallback: "lexical_rerank" },
    };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      if (timedOut) {
        throw new AiProviderError("ALIBABA_QWEN_TIMEOUT", `Alibaba Qwen rerank timed out after ${timeoutMs}ms.`, 504);
      }
      throw new AiProviderError("ALIBABA_QWEN_ABORTED", "Alibaba Qwen rerank request was cancelled.", 499);
    }

    const fallback = lexicalRerank({
      query,
      documents,
      topN,
    });
    return {
      model,
      items: fallback,
      raw: {
        fallback: "lexical_rerank",
        message: error instanceof Error ? error.message : "Unknown provider error",
      },
    };
  } finally {
    clearTimeout(timer);
    for (const fn of detachFns) fn();
  }
}
