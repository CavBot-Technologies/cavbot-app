import type {
  AiCenterAssistRequest,
  AiTaskType,
  CavAiReasoningLevel,
  CavCodeAssistRequest,
} from "@/src/lib/ai/ai.types";
import type { AiSurfaceContextPack } from "@/src/lib/ai/ai.quality";

type CavCodeRetryAttachment = {
  id: string;
  assetId?: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string | null;
};

type BuildCavCodeRetryUserJsonArgs = {
  input: CavCodeAssistRequest;
  model: string | null;
  reasoningLevel: "low" | "medium" | "high" | "extra_high";
  queueEnabled: boolean;
  imageAttachments: CavCodeRetryAttachment[];
  taskType: AiTaskType;
  contextPack: AiSurfaceContextPack;
  context: Record<string, unknown>;
};

export function buildCavCodeRetryUserJson(args: BuildCavCodeRetryUserJsonArgs) {
  return {
    action: args.input.action,
    filePath: args.input.filePath,
    language: args.input.language || null,
    selectedCode: args.input.selectedCode || "",
    diagnostics: args.input.diagnostics || [],
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    queueEnabled: args.queueEnabled,
    imageAttachments: args.imageAttachments,
    taskType: args.taskType,
    contextPack: args.contextPack,
    context: args.context,
  };
}

type BuildCenterRetryUserJsonArgs = {
  input: AiCenterAssistRequest;
  effectiveAction: string;
  model: string | null;
  reasoningLevel: CavAiReasoningLevel;
  actionClass: string;
  taskType: AiTaskType;
  researchMode: boolean;
  researchToolBundle: string[];
  researchUrls: string[];
  imageAttachments: CavCodeRetryAttachment[];
  contextPack: AiSurfaceContextPack;
  context: Record<string, unknown>;
};

export function buildCenterRetryUserJson(args: BuildCenterRetryUserJsonArgs) {
  return {
    action: args.effectiveAction,
    surface: args.input.surface,
    prompt: args.input.prompt,
    goal: args.input.goal || null,
    contextLabel: args.input.contextLabel || null,
    model: args.model,
    reasoningLevel: args.reasoningLevel,
    actionClass: args.actionClass,
    taskType: args.taskType,
    researchMode: args.researchMode,
    researchToolBundle: args.researchToolBundle,
    researchUrls: args.researchUrls,
    imageAttachments: args.imageAttachments,
    contextPack: args.contextPack,
    context: args.context,
  };
}
