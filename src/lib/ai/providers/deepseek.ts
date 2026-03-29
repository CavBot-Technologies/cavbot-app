import "server-only";

import {
  AiProviderError,
  type AiModelRole,
  type AiProvider,
  type AiProviderGenerateRequest,
  type AiProviderGenerateResponse,
  type AiProviderPublicConfig,
} from "@/src/lib/ai/providers/types";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_CHAT_MODEL = "deepseek-chat";
const DEFAULT_DEEPSEEK_REASONING_MODEL = "deepseek-reasoner";
const DEFAULT_TIMEOUT_MS = 20_000;

type DeepSeekProviderConfig = {
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  reasoningModel: string;
};

type DeepSeekChatCompletionResponse = {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  error?: {
    message?: unknown;
    type?: unknown;
    code?: unknown;
  };
};

type DeepSeekConfigValidation = {
  ok: true;
  value: DeepSeekProviderConfig;
} | {
  ok: false;
  missing: string[];
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeBaseUrl(input: string): string {
  const value = s(input) || DEFAULT_DEEPSEEK_BASE_URL;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return DEFAULT_DEEPSEEK_BASE_URL;
  }
}

function asInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.trunc(parsed));
}

function asJsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const text = s((item as { text?: unknown }).text);
        return text;
      })
      .filter(Boolean)
      .join("\n");
  }
  return s(value);
}

function readDeepSeekConfig(): DeepSeekConfigValidation {
  const apiKey = s(process.env.DEEPSEEK_API_KEY);
  const baseUrl = normalizeBaseUrl(s(process.env.DEEPSEEK_BASE_URL));
  const chatModel = s(process.env.DEEPSEEK_MODEL) || DEFAULT_DEEPSEEK_CHAT_MODEL;
  const reasoningModel = s(process.env.DEEPSEEK_REASONING_MODEL) || DEFAULT_DEEPSEEK_REASONING_MODEL;

  const missing: string[] = [];
  if (!apiKey) missing.push("DEEPSEEK_API_KEY");

  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    value: {
      apiKey,
      baseUrl,
      chatModel,
      reasoningModel,
    },
  };
}

export function assertDeepSeekEnv(): DeepSeekProviderConfig {
  const result = readDeepSeekConfig();
  if (!result.ok) {
    throw new AiProviderError(
      "DEEPSEEK_ENV_MISSING",
      `Missing required DeepSeek environment variables: ${result.missing.join(", ")}`,
      500,
      { missing: result.missing }
    );
  }
  return result.value;
}

export function deepSeekEnvStatus() {
  const result = readDeepSeekConfig();
  if (!result.ok) {
    return {
      ok: false as const,
      missing: result.missing,
      baseUrl: normalizeBaseUrl(s(process.env.DEEPSEEK_BASE_URL)),
      chatModel: s(process.env.DEEPSEEK_MODEL) || DEFAULT_DEEPSEEK_CHAT_MODEL,
      reasoningModel: s(process.env.DEEPSEEK_REASONING_MODEL) || DEFAULT_DEEPSEEK_REASONING_MODEL,
    };
  }
  return {
    ok: true as const,
    missing: [] as string[],
    baseUrl: result.value.baseUrl,
    chatModel: result.value.chatModel,
    reasoningModel: result.value.reasoningModel,
  };
}

export class DeepSeekProvider implements AiProvider {
  readonly id = "deepseek" as const;
  readonly supportsJsonMode = true;
  private readonly config: DeepSeekProviderConfig;

  constructor(config?: DeepSeekProviderConfig) {
    this.config = config || assertDeepSeekEnv();
  }

  resolveModel(role: AiModelRole): string {
    return role === "reasoning" ? this.config.reasoningModel : this.config.chatModel;
  }

  getPublicConfig(): AiProviderPublicConfig {
    return {
      id: this.id,
      supportsJsonMode: this.supportsJsonMode,
      models: {
        chat: this.config.chatModel,
        reasoning: this.config.reasoningModel,
      },
      baseUrl: this.config.baseUrl,
    };
  }

  async generate(input: AiProviderGenerateRequest): Promise<AiProviderGenerateResponse> {
    const model = s(input.model);
    if (!model) {
      throw new AiProviderError("DEEPSEEK_MODEL_MISSING", "model is required.", 400);
    }
    if (!Array.isArray(input.messages) || !input.messages.length) {
      throw new AiProviderError("DEEPSEEK_MESSAGES_MISSING", "messages are required.", 400);
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
      const url = `${this.config.baseUrl}/chat/completions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: requestController.signal,
        body: JSON.stringify({
          model,
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens,
          response_format:
            input.responseFormat?.type === "json_object" ? { type: "json_object" } : undefined,
          stream: false,
        }),
      });

      const payload = (await res.json().catch(() => null)) as DeepSeekChatCompletionResponse | null;
      if (!res.ok) {
        const status = Number(res.status || 500);
        const message =
          s(payload?.error?.message) ||
          `DeepSeek request failed with HTTP ${status}.`;
        throw new AiProviderError(
          "DEEPSEEK_REQUEST_FAILED",
          message,
          status,
          {
            status,
            providerErrorType: s(payload?.error?.type) || null,
            providerErrorCode: s(payload?.error?.code) || null,
          }
        );
      }

      const firstChoice = payload?.choices?.[0];
      const content = asJsonString(firstChoice?.message?.content);
      if (!content) {
        throw new AiProviderError(
          "DEEPSEEK_EMPTY_RESPONSE",
          "DeepSeek returned an empty response payload.",
          502,
          payload
        );
      }

      return {
        id: s(payload?.id) || crypto.randomUUID(),
        model: s(payload?.model) || model,
        content,
        finishReason: s(firstChoice?.finish_reason) || null,
        usage: {
          promptTokens: asInt(payload?.usage?.prompt_tokens),
          completionTokens: asInt(payload?.usage?.completion_tokens),
          totalTokens: asInt(payload?.usage?.total_tokens),
        },
        raw: payload,
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        if (timedOut) {
          throw new AiProviderError("DEEPSEEK_TIMEOUT", `DeepSeek request timed out after ${timeoutMs}ms.`, 504);
        }
        throw new AiProviderError("DEEPSEEK_ABORTED", "DeepSeek request was cancelled.", 499);
      }
      const message = error instanceof Error ? error.message : "Unknown provider error";
      throw new AiProviderError("DEEPSEEK_NETWORK_ERROR", message, 502);
    } finally {
      clearTimeout(timer);
      for (const fn of detachFns) fn();
    }
  }
}

let deepSeekProviderSingleton: DeepSeekProvider | null = null;

export function getDeepSeekProvider(): DeepSeekProvider {
  if (!deepSeekProviderSingleton) {
    deepSeekProviderSingleton = new DeepSeekProvider();
  }
  return deepSeekProviderSingleton;
}
