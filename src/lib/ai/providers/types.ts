import "server-only";

export type AiProviderId = "deepseek" | "alibaba_qwen";

export type AiModelRole = "chat" | "reasoning";

export type AiProviderMessageRole = "system" | "user" | "assistant";

export type AiProviderMessage = {
  role: AiProviderMessageRole;
  content: string;
};

export type AiProviderToolId = "web_search" | "web_extractor" | "code_interpreter";

export type AiProviderTool = {
  id: AiProviderToolId;
  description?: string;
};

export type AiProviderResponseFormat = {
  type: "text" | "json_object";
};

export type AiProviderReasoningEffort = "low" | "medium" | "high";

export type AiProviderGenerateRequest = {
  model: string;
  messages: AiProviderMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: AiProviderResponseFormat;
  tools?: AiProviderTool[];
  toolChoice?: "auto" | "none";
  reasoningEffort?: AiProviderReasoningEffort;
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

export type AiProviderTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

export type AiProviderGenerateResponse = {
  id: string;
  model: string;
  content: string;
  finishReason: string | null;
  usage: AiProviderTokenUsage;
  raw: unknown;
};

export type AiProviderPublicConfig = {
  id: AiProviderId;
  supportsJsonMode: boolean;
  models: {
    chat: string;
    reasoning: string;
  };
  baseUrl: string;
};

export class AiProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 500, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly supportsJsonMode: boolean;
  resolveModel(role: AiModelRole): string;
  getPublicConfig(): AiProviderPublicConfig;
  generate(input: AiProviderGenerateRequest): Promise<AiProviderGenerateResponse>;
}
