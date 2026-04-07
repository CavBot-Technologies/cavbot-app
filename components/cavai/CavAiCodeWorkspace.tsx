"use client";

import Image from "next/image";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CAVAI_SAFE_FALLBACK_LINE,
  pickAndRememberCavAiLine,
  readCavAiIdentityFromStorage,
  rememberCavAiIdentity,
  type CavAiIdentityInput,
} from "@/lib/cavai/heroLine";
import {
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  isAiAutoModelId,
  rankCavCodeModelForUi,
  resolveAiModelLabel,
} from "@/src/lib/ai/model-catalog";
import { toReasoningDisplayHelper, toReasoningDisplayLabel } from "@/src/lib/ai/reasoning-display";
import { emitGuardDecision, emitGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import { track } from "@/lib/cavbotAnalytics";
import { buildCavAiRouteContextPayload, resolveCavAiRouteAwareness } from "@/lib/cavai/pageAwareness";
import { readBootClientPlanBootstrap, subscribeClientPlan } from "@/lib/clientPlan";
import { CAVAI_UPLOAD_FILE_ICON_ASSETS, resolveUploadFileIcon } from "@/lib/cavai/uploadFileIcons";
import styles from "./CavAiWorkspace.module.css";

export type CavCodeAssistAction =
  | "explain_error"
  | "suggest_fix"
  | "improve_seo"
  | "write_note"
  | "refactor_safely"
  | "generate_component"
  | "generate_section"
  | "generate_page"
  | "explain_code"
  | "summarize_file"
  | "competitor_research"
  | "accessibility_audit"
  | "ui_mockup_generator"
  | "website_visual_builder"
  | "app_screenshot_enhancer"
  | "brand_asset_generator"
  | "ui_debug_visualizer";

export type CavCodeDiagnostic = {
  code?: string;
  source?: string;
  message: string;
  severity: "error" | "warn" | "info";
  line?: number;
  col?: number;
  file?: string;
};

type CavCodeAssistData = {
  summary: string;
  risk: "low" | "medium" | "high";
  changes: string[];
  proposedCode: string;
  notes: string[];
  followUpChecks: string[];
  targetFilePath?: string | null;
};

type CavAiSessionSummary = {
  id: string;
  title: string;
  contextLabel: string | null;
  preview: string | null;
  updatedAt: string;
  lastMessageAt: string | null;
  model?: string | null;
  reasoningLevel?: "low" | "medium" | "high" | "extra_high" | null;
  queueEnabled?: boolean | null;
  projectRootPath?: string | null;
  activeFilePath?: string | null;
};

type CavAiMessage = {
  id: string;
  role: "user" | "assistant";
  action?: string | null;
  contentText: string;
  contentJson?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  requestId?: string | null;
  status?: string | null;
  feedback?: CavAiMessageFeedbackState | null;
  createdAt: string;
};

type CavAiMessageFeedbackState = {
  reaction: "like" | "dislike" | null;
  copyCount: number;
  shareCount: number;
  retryCount: number;
  updatedAt: string | null;
};

type CavAiExecutionMeta = {
  durationMs: number;
  durationLabel: string;
  showReasoningChip: boolean;
  reasoningLabel: string;
  taskType: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  quality: {
    relevanceToRequest: number;
    relevanceToSurface: number;
    productTruth: number;
    actionability: number;
    coherence: number;
    scopeAlignment: number;
    hallucinationRisk: number;
    overall: number;
    passed: boolean;
    reasons: string[];
  };
  safeSummary: {
    intent: string;
    contextUsed: string[];
    checksPerformed: string[];
    answerPath: string[];
    uncertaintyNotes: string[];
    doneState: "done" | "partial";
  };
};

type CavAiProjectFileRef = {
  path: string;
  name: string;
  lang: string;
  relativePath: string;
};

type CavAiCodeMessageSegment = {
  kind: "text" | "code";
  text: string;
  language?: string | null;
};

type CavAiImageAttachment = {
  id: string;
  assetId?: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  uploading?: boolean;
};

type CavAiUploadedFileAttachment = {
  id: string;
  cavcloudFileId?: string | null;
  cavcloudPath?: string | null;
  path: string;
  name: string;
  lang: string;
  mimeType: string;
  sizeBytes: number;
  iconSrc: string;
  snippet?: string | null;
  uploading?: boolean;
};

type CavCloudAttachFileItem = {
  id: string;
  name: string;
  path: string;
  bytes: number;
  mimeType: string;
  updatedAtISO: string;
  previewSnippet: string | null;
};

type ComposerImageViewerState = {
  imageId: string;
  dataUrl: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type CavenWorkspaceUploadFileRef = {
  id?: string | null;
  cavcloudFileId?: string | null;
  cavcloudPath?: string | null;
  path: string;
  name: string;
  lang?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  snippet?: string | null;
};

type CavAiQueuedPrompt = {
  id: string;
  sessionId: string;
  status: "QUEUED" | "PROCESSING";
  prompt: string;
  action: CavCodeAssistAction;
  filePath: string;
  language: string | null;
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
  imageCount: number;
  createdAt: string;
  payload?: {
    action: CavCodeAssistAction;
    agentId?: string | null;
    agentActionKey?: string | null;
    filePath: string;
    language: string | null;
    selectedCode: string;
    diagnostics: CavCodeDiagnostic[];
    prompt: string;
    model: string | null;
    reasoningLevel: ReasoningLevel | null;
    queueEnabled: boolean;
    imageAttachments: CavAiImageAttachment[];
    context: Record<string, unknown>;
  };
};

type CavAiCodeRetryDraft = {
  userMessageId: string;
  action: CavCodeAssistAction;
  agentId: string | null;
  agentActionKey: string | null;
  prompt: string;
  filePath: string;
  language: string | null;
  selectedCode: string;
  diagnostics: CavCodeDiagnostic[];
  context: Record<string, unknown>;
  model: string;
  reasoningLevel: ReasoningLevel;
  images: CavAiImageAttachment[];
  uploadedFiles: CavAiUploadedFileAttachment[];
  sessionId: string;
};

type CavAiCodeMessageMediaPayload = {
  images: CavAiImageAttachment[];
  uploadedFiles: CavAiUploadedFileAttachment[];
};

type CavenRuntimeCustomAgent = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: "cavcode" | "center" | "all";
  triggers: string[];
};

type PublishedRuntimeAgent = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  surface: "cavcode" | "center" | "all";
  triggers: string[];
};

type CavenRuntimeAgentRef = {
  agentId: string;
  agentActionKey: string;
};

type ApiEnvelope<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error?: string;
      message?: string;
      guardDecision?: unknown;
    };

type ReasoningLevel = "low" | "medium" | "high" | "extra_high";
type CavenInferenceSpeed = "standard" | "fast";
type ViewMode = "chat" | "history";
type BadgeTone = "default" | "lime" | "red";
type ComposerMenu = "quick_actions" | "model" | "audio_model" | "reasoning" | null;
type ComposerQuickActionId = "add_files" | "upload_from_cavcloud";
type CavenComposerEnterBehavior = "enter" | "meta_enter";
type CavenSettingsDropdownSection = "caven" | "ide";
type CavenSettingsModalTab = "skills" | "general" | "ide";
type CavenSkillId = "asr_audio" | "competitor_research" | "accessibility_audit";
type CavAiModelOption = {
  id: string;
  label: string;
};

type CavenWorkspaceSettings = {
  defaultModelId: string;
  inferenceSpeed: CavenInferenceSpeed;
  queueFollowUps: boolean;
  composerEnterBehavior: CavenComposerEnterBehavior;
  includeIdeContext: boolean;
  confirmBeforeApplyPatch: boolean;
  autoOpenResolvedFiles: boolean;
  showReasoningTimeline: boolean;
  telemetryOptIn: boolean;
  defaultReasoningLevel: ReasoningLevel;
  asrAudioSkillEnabled: boolean;
};

type CavenSkillDefinition = {
  id: CavenSkillId;
  name: string;
  summary: string;
  detail: string;
  examplePrompt: string;
  modelAttribution: string;
  iconSrc: string;
};

type QwenModelAvailability = {
  selectable: boolean;
  state: string;
  nextActionId: string | null;
};

type QwenCoderPopoverUiState = {
  entitlement: {
    state: string;
    selectable: boolean;
    creditsUsed: number;
    creditsRemaining: number;
    totalAvailable: number;
    totalRemaining: number;
    percentUsed: number;
    percentRemaining: number;
    stage: string | null;
    warningLevel: 50 | 75 | 90 | 100 | null;
  };
  usage: {
    creditsUsed: number;
    creditsLeft: number;
    creditsTotal: number;
    percentUsed: number;
    percentRemaining: number;
  };
  resetAt: string;
  cooldownEndsAt: string | null;
  contextWindow: {
    currentTokens: number;
    maxTokens: number;
    percentFull: number;
    compactionCount: number;
  } | null;
  guardDecision: unknown;
  modelAvailability: Record<string, QwenModelAvailability>;
  planLabel: string;
};

const MAX_IMAGE_ATTACHMENTS_PREMIUM = 5;
const MAX_IMAGE_ATTACHMENTS_PREMIUM_PLUS = 10;
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_IMAGE_DATA_URL_CHARS = 1_200_000;
const TRANSPARENT_IMAGE_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const MAX_AUDIO_BYTES = 25_000_000;
const REASONING_LEVEL_OPTIONS: Array<{ value: ReasoningLevel; label: string }> = [
  { value: "low", label: toReasoningDisplayLabel("low") },
  { value: "medium", label: toReasoningDisplayLabel("medium") },
  { value: "high", label: toReasoningDisplayLabel("high") },
  { value: "extra_high", label: toReasoningDisplayLabel("extra_high") },
];
const DEFAULT_REASONING_LEVELS: ReasoningLevel[] = ["low", "medium"];
const CAVEN_AGENT_NAME = "Caven";
const CAVEN_MODEL_ATTRIBUTION = "Powered by Qwen3-Coder";
const CAVEN_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const CAVEN_AGENT_ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{1,63}$/;
const CAVEN_DEFAULT_SETTINGS: CavenWorkspaceSettings = {
  defaultModelId: ALIBABA_QWEN_CODER_MODEL_ID,
  inferenceSpeed: "standard",
  queueFollowUps: true,
  composerEnterBehavior: "enter",
  includeIdeContext: true,
  confirmBeforeApplyPatch: true,
  autoOpenResolvedFiles: true,
  showReasoningTimeline: true,
  telemetryOptIn: true,
  defaultReasoningLevel: "medium",
  asrAudioSkillEnabled: true,
};
const CAVEN_SKILLS: CavenSkillDefinition[] = [
  {
    id: "asr_audio",
    name: "Voice Transcription",
    summary: "Transcribe voice and audio into prompt-ready text inside Caven.",
    detail:
      "Qwen3-ASR-Flash lets Caven convert attached audio files into text so developers can drive coding tasks with spoken instructions and recordings.",
    examplePrompt:
      "Transcribe this architecture standup recording and draft a patch plan for the router bug.",
    modelAttribution: "Qwen3-ASR-Flash",
    iconSrc: "/icons/app/cavcode/agents/user-speak-rounded-svgrepo-com.svg",
  },
  {
    id: "competitor_research",
    name: "Competitor Intelligence",
    summary: "Research competitor products, positioning, pricing, and feature gaps with evidence-first comparisons.",
    detail:
      "Competitor Intelligence runs full-spectrum technical and product comparison workflows for market positioning, pricing intelligence, and opportunity gaps.",
    examplePrompt:
      "Compare our platform to the top 5 competitors on onboarding flow, pricing tiers, and key feature gaps, then propose a prioritized response plan.",
    modelAttribution: "Qwen3-Coder",
    iconSrc: "/icons/app/chart-bubble-svgrepo-com.svg",
  },
  {
    id: "accessibility_audit",
    name: "Accessibility Auditor",
    summary: "Audit code for WCAG and a11y risks, then propose practical remediation steps and patches.",
    detail:
      "Accessibility Auditor inspects UI and code paths for WCAG and assistive-tech gaps, then produces concrete remediation guidance and implementation steps.",
    examplePrompt:
      "Audit this page for WCAG 2.2 issues across keyboard navigation, focus order, ARIA semantics, and color contrast. Provide a patch-ready fix plan.",
    modelAttribution: "Qwen3-Coder",
    iconSrc: "/icons/app/cavcode/agents/accessibility-svgrepo-com.svg",
  },
];
const AUDIO_RECORDER_MIME_OPTIONS = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickAudioRecorderMimeType(): string {
  if (typeof window === "undefined") return "";
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return AUDIO_RECORDER_MIME_OPTIONS.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function inferAudioFileExtension(mimeType: string): string {
  const normalized = s(mimeType).toLowerCase();
  if (normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("aac")) return "aac";
  return "webm";
}

function isToggleableCavenSkill(skillId: CavenSkillId): boolean {
  return skillId === "asr_audio";
}

function cavenSkillHelpBullets(skillId: CavenSkillId): string[] {
  if (skillId === "competitor_research") {
    return [
      "Maps competitor product capabilities and positioning into a clear comparison matrix.",
      "Surfaces pricing and packaging gaps with evidence-backed recommendations.",
      "Outputs actionable response priorities for roadmap, messaging, and execution.",
    ];
  }
  if (skillId === "accessibility_audit") {
    return [
      "Detects high-impact accessibility risks across keyboard, focus, semantics, and contrast.",
      "Aligns fixes to WCAG standards with practical implementation guidance.",
      "Turns audit findings into remediation steps your team can apply immediately.",
    ];
  }
  return [
    "Turns voice notes into implementation-ready text.",
    "Lets teams capture code tasks while screen recording or pair-programming.",
    "Keeps transcription inside Caven so workflow stays in one place.",
  ];
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toComposerEnterBehavior(value: unknown): CavenComposerEnterBehavior {
  const raw = s(value).toLowerCase();
  return raw === "meta_enter" ? "meta_enter" : "enter";
}

function toInferenceSpeed(value: unknown): CavenInferenceSpeed {
  const raw = s(value).toLowerCase();
  return raw === "fast" ? "fast" : "standard";
}

function toCavenWorkspaceSettings(value: unknown): CavenWorkspaceSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...CAVEN_DEFAULT_SETTINGS };
  const row = value as Record<string, unknown>;
  const modelRaw = s(row.defaultModelId);
  return {
    defaultModelId: modelRaw || CAVEN_DEFAULT_SETTINGS.defaultModelId,
    inferenceSpeed: toInferenceSpeed(row.inferenceSpeed),
    queueFollowUps: row.queueFollowUps == null ? CAVEN_DEFAULT_SETTINGS.queueFollowUps : row.queueFollowUps === true,
    composerEnterBehavior: toComposerEnterBehavior(row.composerEnterBehavior),
    includeIdeContext: row.includeIdeContext == null ? CAVEN_DEFAULT_SETTINGS.includeIdeContext : row.includeIdeContext === true,
    confirmBeforeApplyPatch:
      row.confirmBeforeApplyPatch == null
        ? CAVEN_DEFAULT_SETTINGS.confirmBeforeApplyPatch
        : row.confirmBeforeApplyPatch === true,
    autoOpenResolvedFiles:
      row.autoOpenResolvedFiles == null ? CAVEN_DEFAULT_SETTINGS.autoOpenResolvedFiles : row.autoOpenResolvedFiles === true,
    showReasoningTimeline:
      row.showReasoningTimeline == null ? CAVEN_DEFAULT_SETTINGS.showReasoningTimeline : row.showReasoningTimeline === true,
    telemetryOptIn: row.telemetryOptIn == null ? CAVEN_DEFAULT_SETTINGS.telemetryOptIn : row.telemetryOptIn === true,
    defaultReasoningLevel: toReasoningLevel(row.defaultReasoningLevel) || CAVEN_DEFAULT_SETTINGS.defaultReasoningLevel,
    asrAudioSkillEnabled:
      row.asrAudioSkillEnabled == null
        ? CAVEN_DEFAULT_SETTINGS.asrAudioSkillEnabled
        : row.asrAudioSkillEnabled === true,
  };
}

function normalizeRuntimeAgentSurface(value: unknown): "cavcode" | "center" | "all" {
  const raw = s(value).toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function normalizeInstalledAgentIdsFromSettings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const entry of value) {
    const id = s(entry).toLowerCase();
    if (!id || !CAVEN_AGENT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push(id);
    if (rows.length >= 240) break;
  }
  return rows;
}

function normalizeRuntimeCustomAgents(value: unknown): CavenRuntimeCustomAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: CavenRuntimeCustomAgent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = s(row.id).toLowerCase();
    const actionKey = s(row.actionKey).toLowerCase();
    if (!id || !actionKey || !CAVEN_AGENT_ID_RE.test(id) || !CAVEN_AGENT_ACTION_KEY_RE.test(actionKey) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const triggersRaw = Array.isArray(row.triggers) ? row.triggers : [];
    const triggers = triggersRaw
      .map((item) => s(item))
      .filter(Boolean)
      .slice(0, 12);
    rows.push({
      id,
      name: s(row.name),
      summary: s(row.summary),
      actionKey,
      surface: normalizeRuntimeAgentSurface(row.surface),
      triggers,
    });
    if (rows.length >= 120) break;
  }
  return rows;
}

function normalizePublishedRuntimeAgents(value: unknown): PublishedRuntimeAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: PublishedRuntimeAgent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = s(row.id).toLowerCase();
    const actionKey = s(row.actionKey).toLowerCase();
    if (!id || !actionKey || !CAVEN_AGENT_ID_RE.test(id) || !CAVEN_AGENT_ACTION_KEY_RE.test(actionKey) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const triggersRaw = Array.isArray(row.triggers) ? row.triggers : [];
    const triggers = triggersRaw
      .map((item) => s(item))
      .filter(Boolean)
      .slice(0, 12);
    rows.push({
      id,
      name: s(row.name),
      summary: s(row.summary),
      actionKey,
      surface: normalizeRuntimeAgentSurface(row.surface),
      triggers,
    });
    if (rows.length >= 240) break;
  }
  return rows;
}

function normalizeAgentRef(args: {
  agentId?: unknown;
  agentActionKey?: unknown;
}): CavenRuntimeAgentRef | null {
  const agentId = s(args.agentId).toLowerCase();
  const agentActionKey = s(args.agentActionKey).toLowerCase();
  if (!agentId || !agentActionKey) return null;
  if (!CAVEN_AGENT_ID_RE.test(agentId) || !CAVEN_AGENT_ACTION_KEY_RE.test(agentActionKey)) return null;
  return { agentId, agentActionKey };
}

function scorePromptForCustomAgent(
  promptLower: string,
  agent: Pick<CavenRuntimeCustomAgent, "actionKey" | "name" | "triggers">
): number {
  let score = 0;
  const actionNeedle = agent.actionKey.replace(/_/g, " ");
  const nameNeedle = s(agent.name).toLowerCase();
  if (promptLower.includes(agent.actionKey)) score += 22;
  if (actionNeedle && promptLower.includes(actionNeedle)) score += 14;
  if (nameNeedle && promptLower.includes(nameNeedle)) score += 10;
  for (const trigger of agent.triggers) {
    const needle = s(trigger).toLowerCase();
    if (!needle || !promptLower.includes(needle)) continue;
    score += Math.max(16, Math.min(42, needle.length));
  }
  return score;
}

function resolvePromptCustomAgentRef(args: {
  prompt: string;
  requestedAction: CavCodeAssistAction;
  installedAgentIds: string[];
  customAgents: CavenRuntimeCustomAgent[];
  publishedAgents?: PublishedRuntimeAgent[];
}): CavenRuntimeAgentRef | null {
  const installedSet = new Set(args.installedAgentIds.map((id) => s(id).toLowerCase()));
  const eligible = [...args.customAgents, ...(args.publishedAgents || [])].filter(
    (agent) => installedSet.has(agent.id) && (agent.surface === "all" || agent.surface === "cavcode")
  );
  if (!eligible.length) return null;

  const promptLower = s(args.prompt).toLowerCase();
  let best: CavenRuntimeCustomAgent | PublishedRuntimeAgent | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const agent of eligible) {
    let score = scorePromptForCustomAgent(promptLower, agent);
    if (agent.actionKey === args.requestedAction) score += 60;
    if (score > bestScore) {
      best = agent;
      bestScore = score;
    }
  }

  if (!best) return null;
  if (eligible.length > 1 && bestScore <= 0) return null;
  return {
    agentId: best.id,
    agentActionKey: best.actionKey,
  };
}

function buildCavCodeRouteContextPayload(args: {
  workspaceId?: string | null;
  projectId?: number | null;
  contextLabel?: string | null;
}): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const awareness = resolveCavAiRouteAwareness({
    pathname: window.location.pathname,
    search: window.location.search,
    workspaceId: s(args.workspaceId) || null,
    projectId: Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0 ? Number(args.projectId) : null,
    contextLabel: s(args.contextLabel) || "CavCode context",
  });
  return buildCavAiRouteContextPayload(awareness);
}

function resolvePreferredCavCodeModel(modelOptions: CavAiModelOption[], fallback?: string | null): string {
  const ids = modelOptions
    .map((row) => s(row.id))
    .filter(Boolean)
    .filter((id) => !isAiAutoModelId(id));
  if (ids.includes(ALIBABA_QWEN_CODER_MODEL_ID)) return ALIBABA_QWEN_CODER_MODEL_ID;
  const fallbackId = s(fallback);
  if (fallbackId && !isAiAutoModelId(fallbackId) && ids.includes(fallbackId)) return fallbackId;
  return ids[0] || ALIBABA_QWEN_CODER_MODEL_ID;
}

function normalizeCavCodeModelOptions(options: CavAiModelOption[]): CavAiModelOption[] {
  const coder = options.find((option) => s(option.id) === ALIBABA_QWEN_CODER_MODEL_ID);
  if (!coder) return [];
  return [{
    id: ALIBABA_QWEN_CODER_MODEL_ID,
    label: resolveAiModelLabel(ALIBABA_QWEN_CODER_MODEL_ID),
  }];
}

function cavCodePlanModelOptions(planIdRaw: unknown): CavAiModelOption[] {
  if (normalizePlanId(planIdRaw) === "free") return [];
  return [{
    id: ALIBABA_QWEN_CODER_MODEL_ID,
    label: resolveAiModelLabel(ALIBABA_QWEN_CODER_MODEL_ID),
  }];
}

function normalizePathLike(value: string): string {
  const input = s(value);
  if (!input) return "";
  const normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function toIsoTime(value: string | null | undefined): string {
  const raw = s(value);
  if (!raw) return "";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function toTimelineLabel(value: string | null | undefined): string {
  const raw = s(value);
  if (!raw) return "now";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "now";

  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.max(1, Math.floor(days / 7))}w`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))}m`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
}

function buildSessionsUrl(args: {
  workspaceId?: string | null;
  projectId?: number | null;
}): string {
  const qp = new URLSearchParams();
  qp.set("surface", "cavcode");
  if (s(args.workspaceId)) qp.set("workspaceId", s(args.workspaceId));
  if (Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0) {
    qp.set("projectId", String(Math.trunc(Number(args.projectId))));
  }
  qp.set("limit", "100");
  return `/api/ai/sessions?${qp.toString()}`;
}

function inferActionFromPrompt(prompt: string): CavCodeAssistAction {
  const text = s(prompt).toLowerCase();
  if (!text) return "suggest_fix";
  if (/\b(mockup|ui mockup|wireframe|screen concept)\b/.test(text)) return "ui_mockup_generator";
  if (/\b(website visual|hero image|marketing visual|landing visual)\b/.test(text)) return "website_visual_builder";
  if (/\b(screenshot|enhance screenshot|retouch|image edit)\b/.test(text)) return "app_screenshot_enhancer";
  if (/\b(brand asset|icon set|banner visual|brand visuals)\b/.test(text)) return "brand_asset_generator";
  if (/\b(ui debug|layout mismatch|visual diff|pixel drift)\b/.test(text)) return "ui_debug_visualizer";
  if (
    /\b(competitor|competition|rival|market analysis|feature gap|pricing compare|battlecard|benchmark)\b/.test(text)
  ) {
    return "competitor_research";
  }
  if (
    /\b(accessibility|a11y|wcag|aria|screen reader|keyboard nav|color contrast|focus ring|alt text)\b/.test(text)
  ) {
    return "accessibility_audit";
  }
  if (text.includes("summarize")) return "summarize_file";
  if (text.includes("explain")) return "explain_code";
  if (text.includes("refactor")) return "refactor_safely";
  if (text.includes("seo") || text.includes("metadata")) return "improve_seo";
  if (text.includes("generate component")) return "generate_component";
  if (text.includes("generate section")) return "generate_section";
  if (text.includes("generate page")) return "generate_page";
  if (text.includes("note")) return "write_note";
  return "suggest_fix";
}

function toCavCodeAction(value: unknown): CavCodeAssistAction {
  const raw = s(value) as CavCodeAssistAction;
  if (
    raw === "explain_error" ||
    raw === "suggest_fix" ||
    raw === "improve_seo" ||
    raw === "write_note" ||
    raw === "refactor_safely" ||
    raw === "generate_component" ||
    raw === "generate_section" ||
    raw === "generate_page" ||
    raw === "explain_code" ||
    raw === "summarize_file" ||
    raw === "competitor_research" ||
    raw === "accessibility_audit" ||
    raw === "ui_mockup_generator" ||
    raw === "website_visual_builder" ||
    raw === "app_screenshot_enhancer" ||
    raw === "brand_asset_generator" ||
    raw === "ui_debug_visualizer"
  ) {
    return raw;
  }
  return "suggest_fix";
}

function parseCavCloudAttachFileItem(value: unknown): CavCloudAttachFileItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  const name = s(row.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    path: s(row.path),
    bytes: Math.max(0, Math.trunc(Number(row.bytes) || 0)),
    mimeType: s(row.mimeType) || "application/octet-stream",
    updatedAtISO: s(row.updatedAtISO) || s(row.createdAtISO),
    previewSnippet: s(row.previewSnippet) || null,
  };
}

function extractPathHints(prompt: string): string[] {
  const text = s(prompt);
  if (!text) return [];
  const hits = text.match(/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+|[A-Za-z0-9._-]+\.[A-Za-z0-9._-]{1,12})/g) || [];
  return Array.from(new Set(hits.map((hit) => s(hit)).filter(Boolean)));
}

function parseAssistantData(message: CavAiMessage): CavCodeAssistData | null {
  const raw = message.contentJson;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (!s(record.summary)) return null;
  return {
    summary: s(record.summary),
    risk: s(record.risk) === "high" ? "high" : s(record.risk) === "medium" ? "medium" : "low",
    changes: Array.isArray(record.changes) ? record.changes.map((row) => s(row)).filter(Boolean) : [],
    proposedCode: String(record.proposedCode || ""),
    notes: Array.isArray(record.notes) ? record.notes.map((row) => s(row)).filter(Boolean) : [],
    followUpChecks: Array.isArray(record.followUpChecks)
      ? record.followUpChecks.map((row) => s(row)).filter(Boolean)
      : [],
    targetFilePath: s(record.targetFilePath) || null,
  };
}

function toSafeFeedbackState(value: CavAiMessageFeedbackState | null | undefined): CavAiMessageFeedbackState {
  return {
    reaction: value?.reaction === "like" || value?.reaction === "dislike" ? value.reaction : null,
    copyCount: Math.max(0, Math.trunc(Number(value?.copyCount || 0))),
    shareCount: Math.max(0, Math.trunc(Number(value?.shareCount || 0))),
    retryCount: Math.max(0, Math.trunc(Number(value?.retryCount || 0))),
    updatedAt: s(value?.updatedAt) || null,
  };
}

function formatReasoningDuration(ms: number): string {
  const safeMs = Math.max(0, Math.trunc(Number(ms) || 0));
  if (safeMs < 1000) return `${safeMs}ms`;

  const mins = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;

  if (mins <= 0) {
    if (millis <= 0) return `${seconds}s`;
    return `${seconds}.${String(millis).padStart(3, "0")}s`;
  }

  if (seconds <= 0 && millis <= 0) return `${mins}m`;
  if (millis <= 0) return `${mins}m ${seconds}s`;
  return `${mins}m ${seconds}.${String(millis).padStart(3, "0")}s`;
}

const REASONING_CONTEXT_LABELS: Record<string, string> = {
  launchsurface: "Current surface",
  contextlabel: "Surface context",
  researchmode: "Research mode",
  researchurlscount: "Research URL count",
  researchurls: "Research URLs",
  imageattachments: "Image attachments",
  effectiveaction: "Routed action",
  sessionhistory: "Recent chat history",
  sessionhistorycount: "Recent message count",
  workspaceid: "Workspace",
  projectid: "Project",
  action: "Action",
};

const REASONING_CHECK_LABELS: Record<string, string> = {
  output_size_check: "Output size validation",
  schema_validation: "Response schema validation",
  semantic_validation: "Semantic relevance validation",
  semantic_repair_pass: "Relevance repair pass",
};

const REASONING_PATH_LABELS: Record<string, string> = {
  initial_generation: "Initial draft generation",
  repair_generation: "Repair draft generation",
};

function toReadableReasoningToken(value: string): string {
  const raw = s(value);
  if (!raw) return "";
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return "";
  return `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`;
}

function toReasoningContextLabel(value: string): string {
  const key = s(value).replace(/[\s_-]+/g, "").toLowerCase();
  return REASONING_CONTEXT_LABELS[key] || toReadableReasoningToken(value);
}

function toReasoningCheckLabel(value: string): string {
  const key = s(value).toLowerCase();
  return REASONING_CHECK_LABELS[key] || toReadableReasoningToken(value);
}

function toReasoningPathLabel(value: string): string {
  const key = s(value).toLowerCase();
  return REASONING_PATH_LABELS[key] || toReadableReasoningToken(value);
}

function toTaskTypeLabel(value: string): string {
  return toReadableReasoningToken(value);
}

function toExecutionMeta(value: unknown): CavAiExecutionMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const summary = row.safeSummary && typeof row.safeSummary === "object" && !Array.isArray(row.safeSummary)
    ? (row.safeSummary as Record<string, unknown>)
    : {};
  const qualityRaw = row.quality && typeof row.quality === "object" && !Array.isArray(row.quality)
    ? (row.quality as Record<string, unknown>)
    : {};
  const level = toReasoningLevel(row.reasoningLevel) || "medium";
  const durationMs = Math.max(0, Math.trunc(Number(row.durationMs) || 0));
  const hasShowReasoningChip = Object.prototype.hasOwnProperty.call(row, "showReasoningChip");
  const showReasoningChip = row.showReasoningChip === true || (!hasShowReasoningChip && durationMs > 0);
  const defaultReasoningLabel = durationMs > 0 ? `Reasoned in ${formatReasoningDuration(durationMs)}` : "Reasoned";
  const intent = s(summary.intent) || "CavAi response";

  return {
    durationMs,
    durationLabel: s(row.durationLabel) || formatReasoningDuration(durationMs),
    showReasoningChip,
    reasoningLabel: s(row.reasoningLabel) || defaultReasoningLabel,
    taskType: s(row.taskType) || "general_question",
    model: s(row.model),
    reasoningLevel: level,
    quality: {
      relevanceToRequest: Math.max(0, Math.trunc(Number(qualityRaw.relevanceToRequest) || 0)),
      relevanceToSurface: Math.max(0, Math.trunc(Number(qualityRaw.relevanceToSurface) || 0)),
      productTruth: Math.max(0, Math.trunc(Number(qualityRaw.productTruth) || 0)),
      actionability: Math.max(0, Math.trunc(Number(qualityRaw.actionability) || 0)),
      coherence: Math.max(0, Math.trunc(Number(qualityRaw.coherence) || 0)),
      scopeAlignment: Math.max(0, Math.trunc(Number(qualityRaw.scopeAlignment) || 0)),
      hallucinationRisk: Math.max(0, Math.trunc(Number(qualityRaw.hallucinationRisk) || 0)),
      overall: Math.max(0, Math.trunc(Number(qualityRaw.overall) || 0)),
      passed: qualityRaw.passed === true,
      reasons: Array.isArray(qualityRaw.reasons) ? qualityRaw.reasons.map((item) => s(item)).filter(Boolean) : [],
    },
    safeSummary: {
      intent,
      contextUsed: Array.isArray(summary.contextUsed) ? summary.contextUsed.map((item) => s(item)).filter(Boolean) : [],
      checksPerformed: Array.isArray(summary.checksPerformed)
        ? summary.checksPerformed.map((item) => s(item)).filter(Boolean)
        : [],
      answerPath: Array.isArray(summary.answerPath) ? summary.answerPath.map((item) => s(item)).filter(Boolean) : [],
      uncertaintyNotes: Array.isArray(summary.uncertaintyNotes)
        ? summary.uncertaintyNotes.map((item) => s(item)).filter(Boolean)
        : [],
      doneState: s(summary.doneState) === "partial" ? "partial" : "done",
    },
  };
}

function resolveExecutionMetaFromMessage(message: CavAiMessage): CavAiExecutionMeta | null {
  const json = message.contentJson;
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;
  return toExecutionMeta(row.__cavAiMeta || row.meta || null);
}

function resolveReasoningLabel(args: {
  message: CavAiMessage;
  allMessages: CavAiMessage[];
  index: number;
}): string {
  if (args.message.role !== "assistant") return "";
  const meta = resolveExecutionMetaFromMessage(args.message);
  if (meta) {
    if (!meta.showReasoningChip) return "";
    const label = s(meta.reasoningLabel);
    if (label) return label;
    if (meta.durationMs > 0) return `Reasoned in ${formatReasoningDuration(meta.durationMs)}`;
    return "Reasoned";
  }
  const assistantTs = Date.parse(s(args.message.createdAt));
  if (!Number.isFinite(assistantTs)) return "";
  for (let pointer = args.index - 1; pointer >= 0; pointer -= 1) {
    const row = args.allMessages[pointer];
    if (!row || row.role !== "user") continue;
    const userTs = Date.parse(s(row.createdAt));
    if (!Number.isFinite(userTs)) break;
    const delta = Math.max(0, assistantTs - userTs);
    if (delta <= 0) return "";
    return `Reasoned in ${formatReasoningDuration(delta)}`;
  }
  return "";
}

function toCodeMessageSegments(contentText: string): CavAiCodeMessageSegment[] {
  const text = String(contentText || "").replace(/\r\n?/g, "\n").trimEnd();
  if (!text) return [];

  const segments: CavAiCodeMessageSegment[] = [];
  const fence = /```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;

  const pushPlain = (raw: string) => {
    const value = String(raw || "").replace(/^\n+|\n+$/g, "").replace(/\n{3,}/g, "\n\n");
    if (!value) return;
    segments.push({ kind: "text", text: value });
  };

  for (const match of text.matchAll(fence)) {
    const start = Number(match.index || 0);
    if (start > cursor) {
      pushPlain(text.slice(cursor, start));
    }

    const language = s(match[1]) || null;
    const code = String(match[2] || "").replace(/^\n+|\n+$/g, "");
    if (s(code)) {
      segments.push({
        kind: "code",
        text: code,
        language,
      });
    }
    cursor = start + String(match[0] || "").length;
  }

  if (cursor < text.length) {
    pushPlain(text.slice(cursor));
  }

  if (!segments.length) {
    segments.push({
      kind: "text",
      text,
    });
  }

  return segments;
}

function toReasoningLevel(value: unknown): ReasoningLevel | null {
  const raw = s(value).toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "extra_high") {
    return raw;
  }
  return null;
}

function reasoningLevelRank(level: ReasoningLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  return 4;
}

function reasoningLevelsUpTo(maxRaw: unknown): ReasoningLevel[] {
  const max = toReasoningLevel(maxRaw);
  if (!max) return DEFAULT_REASONING_LEVELS;
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => reasoningLevelRank(level) <= reasoningLevelRank(max));
}

function reasoningLevelsForPlan(planIdRaw: unknown): ReasoningLevel[] {
  const plan = s(planIdRaw).toLowerCase();
  if (plan === "premium_plus") return ["low", "medium", "high", "extra_high"];
  if (plan === "premium") return ["low", "medium", "high"];
  return DEFAULT_REASONING_LEVELS;
}

function normalizePlanId(value: unknown): "free" | "premium" | "premium_plus" {
  const raw = s(value).toLowerCase();
  if (raw === "premium_plus" || raw === "premium+") return "premium_plus";
  if (raw === "premium") return "premium";
  return "free";
}

function resolveServerPlanId(
  planIdRaw: unknown,
  fallback: "free" | "premium" | "premium_plus"
): "free" | "premium" | "premium_plus" {
  return s(planIdRaw) ? normalizePlanId(planIdRaw) : fallback;
}

function maxImageAttachmentsForPlan(planId: "free" | "premium" | "premium_plus"): number {
  if (planId === "premium_plus") return MAX_IMAGE_ATTACHMENTS_PREMIUM_PLUS;
  if (planId === "premium") return MAX_IMAGE_ATTACHMENTS_PREMIUM;
  return 2;
}

function normalizeReasoningOptions(raw: unknown): ReasoningLevel[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw.map((item) => toReasoningLevel(item)).filter(Boolean) as ReasoningLevel[];
  const unique = Array.from(new Set(parsed));
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => unique.includes(level));
}

function clampReasoningLevelsToPlan(
  options: ReasoningLevel[],
  planIdRaw: unknown
): ReasoningLevel[] {
  const set = new Set<ReasoningLevel>(reasoningLevelsForPlan(planIdRaw));
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => set.has(level) && options.includes(level));
}

function toModelOption(value: unknown): CavAiModelOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  if (!id) return null;
  return {
    id,
    label: resolveAiModelLabel(id),
  };
}

function toDateLabel(value: unknown): string {
  const raw = s(value);
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toCountdownLabel(value: unknown): string {
  const raw = s(value);
  if (!raw) return "—";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "—";
  const diffMs = Math.max(0, ts - Date.now());
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days}d ${remHours}h`;
  const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${Math.max(0, remHours)}h ${Math.max(0, mins)}m`;
}

function toQwenPopoverUiState(body: unknown): QwenCoderPopoverUiState | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const qwen = row.qwenCoder;
  if (!qwen || typeof qwen !== "object" || Array.isArray(qwen)) return null;
  const qwenRow = qwen as Record<string, unknown>;
  const entitlementRaw = qwenRow.entitlement;
  const usageRaw = qwenRow.usage;
  if (!entitlementRaw || typeof entitlementRaw !== "object" || Array.isArray(entitlementRaw)) return null;
  if (!usageRaw || typeof usageRaw !== "object" || Array.isArray(usageRaw)) return null;

  const entitlement = entitlementRaw as Record<string, unknown>;
  const usage = usageRaw as Record<string, unknown>;
  const modelAvailabilityRaw = row.modelAvailability && typeof row.modelAvailability === "object" && !Array.isArray(row.modelAvailability)
    ? (row.modelAvailability as Record<string, unknown>)
    : {};
  const modelAvailability: Record<string, QwenModelAvailability> = {};
  for (const [modelId, recRaw] of Object.entries(modelAvailabilityRaw)) {
    if (!recRaw || typeof recRaw !== "object" || Array.isArray(recRaw)) continue;
    const rec = recRaw as Record<string, unknown>;
    modelAvailability[modelId] = {
      selectable: rec.selectable === true,
      state: s(rec.state),
      nextActionId: s(rec.nextActionId) || null,
    };
  }
  const contextWindowRaw = qwenRow.contextWindow && typeof qwenRow.contextWindow === "object" && !Array.isArray(qwenRow.contextWindow)
    ? (qwenRow.contextWindow as Record<string, unknown>)
    : null;

  return {
    entitlement: {
      state: s(entitlement.state),
      selectable: entitlement.selectable === true,
      creditsUsed: Math.max(0, Math.trunc(Number(entitlement.creditsUsed) || 0)),
      creditsRemaining: Math.max(0, Math.trunc(Number(entitlement.creditsRemaining) || 0)),
      totalAvailable: Math.max(0, Math.trunc(Number(entitlement.totalAvailable) || 0)),
      totalRemaining: Math.max(0, Math.trunc(Number(entitlement.totalRemaining) || 0)),
      percentUsed: Math.max(0, Math.min(100, Number(entitlement.percentUsed) || 0)),
      percentRemaining: Math.max(0, Math.min(100, Number(entitlement.percentRemaining) || 0)),
      stage: s(entitlement.stage) || null,
      warningLevel: [50, 75, 90, 100].includes(Number(entitlement.warningLevel))
        ? (Number(entitlement.warningLevel) as 50 | 75 | 90 | 100)
        : null,
    },
    usage: {
      creditsUsed: Math.max(0, Math.trunc(Number(usage.creditsUsed) || 0)),
      creditsLeft: Math.max(0, Math.trunc(Number(usage.creditsLeft) || 0)),
      creditsTotal: Math.max(0, Math.trunc(Number(usage.creditsTotal) || 0)),
      percentUsed: Math.max(0, Math.min(100, Number(usage.percentUsed) || 0)),
      percentRemaining: Math.max(0, Math.min(100, Number(usage.percentRemaining) || 0)),
    },
    resetAt: s(qwenRow.resetAt),
    cooldownEndsAt: s(qwenRow.cooldownEndsAt) || null,
    contextWindow: contextWindowRaw
      ? {
          currentTokens: Math.max(0, Math.trunc(Number(contextWindowRaw.currentTokens) || 0)),
          maxTokens: Math.max(1, Math.trunc(Number(contextWindowRaw.maxTokens) || 1)),
          percentFull: Math.max(0, Math.min(100, Number(contextWindowRaw.percentFull) || 0)),
          compactionCount: Math.max(0, Math.trunc(Number(contextWindowRaw.compactionCount) || 0)),
        }
      : null,
    guardDecision: row.guardDecision || row.qwenGuardDecision || null,
    modelAvailability,
    planLabel: s(qwenRow.planLabel) || "Premium",
  };
}

function isAudioLikeFile(file: File): boolean {
  const mime = s(file.type).toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const extension = s(file.name).toLowerCase().split(".").pop() || "";
  return ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac", "aac"].includes(extension);
}

function isImageLikeFile(file: File): boolean {
  const mime = s(file.type).toLowerCase();
  if (mime.startsWith("image/")) return true;
  const name = s(file.name).toLowerCase();
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".bmp",
    ".ico",
    ".svg",
  ].some((ext) => name.endsWith(ext));
}

function formatFileSize(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024) return `${Math.max(1, Math.round(value))} B`;
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1024))} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

function formatMimeSubtype(mimeType: string): string {
  const normalized = s(mimeType).toLowerCase().split(";")[0].trim();
  if (!normalized) return "file";
  if (!normalized.includes("/")) return normalized;
  const subtype = normalized.split("/")[1];
  return s(subtype) || normalized;
}

function toRetryUploadedFiles(value: unknown): CavAiUploadedFileAttachment[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const raw = Array.isArray(row.uploadedWorkspaceFiles)
    ? row.uploadedWorkspaceFiles
    : Array.isArray(row.uploadedFiles)
      ? row.uploadedFiles
      : [];
  const files: CavAiUploadedFileAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const name = s(entry.name) || "file";
    const path = s(entry.path);
    const cavcloudFileId = s(entry.cavcloudFileId) || s(entry.id);
    const cavcloudPath = s(entry.cavcloudPath);
    const mimeType = s(entry.mimeType) || "application/octet-stream";
    if (!path && !cavcloudFileId && !cavcloudPath) continue;
    files.push({
      id: cavcloudFileId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
      cavcloudFileId: cavcloudFileId || null,
      cavcloudPath: cavcloudPath || null,
      path,
      name,
      lang: s(entry.lang),
      mimeType,
      sizeBytes: Math.max(1, Math.trunc(Number(entry.sizeBytes) || 1)),
      iconSrc: resolveUploadFileIcon(name, mimeType),
      snippet: s(entry.snippet) || null,
      uploading: false,
    });
    if (files.length >= MAX_IMAGE_ATTACHMENTS_PREMIUM_PLUS) break;
  }
  return files;
}

function toMessageMediaPayload(message: CavAiMessage): CavAiCodeMessageMediaPayload {
  const payloadRaw =
    message.contentJson && typeof message.contentJson === "object" && !Array.isArray(message.contentJson)
      ? (message.contentJson as Record<string, unknown>)
      : {};
  const contextRaw =
    payloadRaw.context && typeof payloadRaw.context === "object" && !Array.isArray(payloadRaw.context)
      ? (payloadRaw.context as Record<string, unknown>)
      : {};
  const imageRaw = Array.isArray(payloadRaw.imageAttachments) ? payloadRaw.imageAttachments : [];
  const images: CavAiImageAttachment[] = imageRaw
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => {
      const item = row as Record<string, unknown>;
      const assetId = s(item.assetId) || s(item.id);
      const dataUrl = s(item.dataUrl) || (assetId ? TRANSPARENT_IMAGE_DATA_URL : "");
      return {
        id: assetId || s(item.id) || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
        assetId: assetId || null,
        name: s(item.name) || "image",
        mimeType: s(item.mimeType) || "image/png",
        sizeBytes: Math.max(1, Math.trunc(Number(item.sizeBytes) || 1)),
        dataUrl,
      };
    })
    .filter((row) => Boolean(s(row.dataUrl)) || Boolean(s(row.assetId)));
  const uploadedFromContext = toRetryUploadedFiles(contextRaw);
  const uploadedFiles = uploadedFromContext.length ? uploadedFromContext : toRetryUploadedFiles(payloadRaw);
  return {
    images,
    uploadedFiles,
  };
}

function parseQueuedPrompt(value: unknown): CavAiQueuedPrompt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  const sessionId = s(row.sessionId);
  const prompt = s(row.prompt);
  const filePath = normalizePathLike(s(row.filePath));
  if (!id || !sessionId || !prompt || !filePath) return null;
  const actionRaw = s(row.action) as CavCodeAssistAction;
  const action: CavCodeAssistAction = actionRaw || "suggest_fix";
  const status = s(row.status).toUpperCase() === "PROCESSING" ? "PROCESSING" : "QUEUED";
  const payloadRaw = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : null;
  const diagnosticsRaw = Array.isArray(payloadRaw?.diagnostics) ? payloadRaw?.diagnostics : [];
  const imageRaw = Array.isArray(payloadRaw?.imageAttachments) ? payloadRaw?.imageAttachments : [];
  const agentRefFromPayload = normalizeAgentRef({
    agentId: payloadRaw?.agentId,
    agentActionKey: payloadRaw?.agentActionKey,
  });
  const payload = payloadRaw
    ? {
        action: (s(payloadRaw.action) as CavCodeAssistAction) || action,
        agentId: agentRefFromPayload?.agentId || null,
        agentActionKey: agentRefFromPayload?.agentActionKey || null,
        filePath: normalizePathLike(s(payloadRaw.filePath) || filePath),
        language: s(payloadRaw.language) || null,
        selectedCode: s(payloadRaw.selectedCode),
        diagnostics: diagnosticsRaw
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item): CavCodeDiagnostic => {
            const row = item as Record<string, unknown>;
            const severityRaw = s(row.severity);
            const severity: CavCodeDiagnostic["severity"] =
              severityRaw === "warn" || severityRaw === "info" ? severityRaw : "error";
            return {
              code: s(row.code) || undefined,
              source: s(row.source) || undefined,
              message: s(row.message),
              severity,
              line: Number.isFinite(Number(row.line)) && Number(row.line) > 0 ? Math.trunc(Number(row.line)) : undefined,
              col: Number.isFinite(Number(row.col)) && Number(row.col) > 0 ? Math.trunc(Number(row.col)) : undefined,
              file: s(row.file) || undefined,
            };
          }),
        prompt: s(payloadRaw.prompt) || prompt,
        model: s(payloadRaw.model) || null,
        reasoningLevel: toReasoningLevel(payloadRaw.reasoningLevel),
        queueEnabled: payloadRaw.queueEnabled === true,
        imageAttachments: imageRaw
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item) => {
            const image = item as Record<string, unknown>;
            const assetId = s(image.assetId);
            const dataUrl = s(image.dataUrl) || (assetId ? TRANSPARENT_IMAGE_DATA_URL : "");
            return {
              id: s(image.id) || assetId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
              assetId: assetId || null,
              name: s(image.name) || "image",
              mimeType: s(image.mimeType) || "image/png",
              sizeBytes: Math.max(0, Math.trunc(Number(image.sizeBytes) || 0)),
              dataUrl,
            };
          })
          .filter((item) => Boolean(item.dataUrl) || Boolean(item.assetId)),
        context:
          payloadRaw.context && typeof payloadRaw.context === "object" && !Array.isArray(payloadRaw.context)
            ? (payloadRaw.context as Record<string, unknown>)
            : {},
      }
    : undefined;
  return {
    id,
    sessionId,
    status,
    prompt,
    action,
    filePath,
    language: s(row.language) || null,
    model: s(row.model) || null,
    reasoningLevel: toReasoningLevel(row.reasoningLevel),
    imageCount: Math.max(0, Math.trunc(Number(row.imageCount) || 0)),
    createdAt: s(row.createdAt),
    payload,
  };
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function matchesPath(file: CavAiProjectFileRef, hint: string): number {
  const normalizedHint = normalizePathLike(hint).toLowerCase();
  const full = normalizePathLike(file.path).toLowerCase();
  const rel = `/${s(file.relativePath)}`.replace(/\/+/g, "/").toLowerCase();
  const leaf = file.name.toLowerCase();
  const hintLeaf = normalizedHint.split("/").filter(Boolean).pop() || "";
  if (normalizedHint === full) return 100;
  if (normalizedHint === rel) return 95;
  if (full.endsWith(normalizedHint)) return 90;
  if (rel.endsWith(normalizedHint)) return 88;
  if (hintLeaf && leaf === hintLeaf) return 82;
  if (hintLeaf && rel.endsWith(`/${hintLeaf}`)) return 78;
  return 0;
}

function resolvePromptTargetFile(args: {
  prompt: string;
  activeFilePath?: string;
  projectFiles: CavAiProjectFileRef[];
}): {
  status: "resolved";
  filePath: string;
} | {
  status: "ambiguous";
  matches: string[];
} | {
  status: "missing";
} {
  const prompt = s(args.prompt);
  const activePath = s(args.activeFilePath);
  const files = Array.isArray(args.projectFiles) ? args.projectFiles : [];

  const normalizedActive = activePath ? normalizePathLike(activePath) : "";
  if (
    normalizedActive &&
    /\b(this file|current file|this component|here)\b/i.test(prompt)
  ) {
    return { status: "resolved", filePath: normalizedActive };
  }

  const hints = extractPathHints(prompt);
  for (const hint of hints) {
    const scored = files
      .map((file) => ({ path: file.path, score: matchesPath(file, hint) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;

    const topScore = scored[0].score;
    const topMatches = scored.filter((row) => row.score === topScore).map((row) => normalizePathLike(row.path));
    if (topMatches.length === 1) {
      return { status: "resolved", filePath: topMatches[0] };
    }
    return { status: "ambiguous", matches: topMatches.slice(0, 8) };
  }

  if (normalizedActive) {
    return { status: "resolved", filePath: normalizedActive };
  }
  return { status: "missing" };
}

export type CavAiCodeWorkspaceProps = {
  mode?: "panel" | "page";
  filePath?: string;
  language?: string;
  workspaceId?: string | null;
  projectId?: number | null;
  diagnostics?: CavCodeDiagnostic[];
  selectedCode?: string;
  getSelectedCode?: () => string;
  context?: Record<string, unknown>;
  projectRootPath?: string | null;
  projectRootName?: string | null;
  projectFiles?: CavAiProjectFileRef[];
  onApplyProposedCode?: (args: { filePath: string; code: string }) => Promise<boolean> | boolean;
  onOpenFilePath?: (filePath: string) => boolean | void;
  onUploadWorkspaceFiles?: (files: File[]) => Promise<CavenWorkspaceUploadFileRef[]> | CavenWorkspaceUploadFileRef[];
  onOpenSkillsTab?: () => void;
  onOpenGeneralSettingsTab?: () => void;
  onOpenIdeSettingsTab?: () => void;
  onOpenConfigToml?: () => void;
  onClose?: () => void;
  expandHref?: string;
  profileTone?: string | null;
};

export default function CavAiCodeWorkspace(props: CavAiCodeWorkspaceProps) {
  const mode = props.mode || "panel";
  const pageMode = mode === "page";
  const language = s(props.language);
  const workspaceId = props.workspaceId || null;
  const getSelectedCodeProp = props.getSelectedCode;
  const selectedCodeProp = props.selectedCode;
  const onApplyProposedCode = props.onApplyProposedCode;
  const onOpenFilePath = props.onOpenFilePath;
  const onUploadWorkspaceFiles = props.onUploadWorkspaceFiles;
  const onOpenSkillsTab = props.onOpenSkillsTab;
  const onOpenGeneralSettingsTab = props.onOpenGeneralSettingsTab;
  const onOpenIdeSettingsTab = props.onOpenIdeSettingsTab;
  const onOpenConfigToml = props.onOpenConfigToml;
  const projectId = Number.isFinite(Number(props.projectId)) && Number(props.projectId) > 0
    ? Math.trunc(Number(props.projectId))
    : null;
  const context = useMemo(() => props.context || {}, [props.context]);

  const [viewMode, setViewMode] = useState<ViewMode>("history");
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<CavAiSessionSummary[]>([]);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [messages, setMessages] = useState<CavAiMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [pendingPromptText, setPendingPromptText] = useState("");
  const [error, setError] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [images, setImages] = useState<CavAiImageAttachment[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<CavAiUploadedFileAttachment[]>([]);
  const [composerImageViewer, setComposerImageViewer] = useState<ComposerImageViewerState | null>(null);
  const [viewerMagnifierVisible, setViewerMagnifierVisible] = useState(false);
  const [viewerMagnifierSupportsHover, setViewerMagnifierSupportsHover] = useState(false);
  const [viewerMagnifierFocusPoint, setViewerMagnifierFocusPoint] = useState({ x: 50, y: 50, px: 0, py: 0 });
  const [applyBusyId, setApplyBusyId] = useState("");
  const [queuedPrompts, setQueuedPrompts] = useState<CavAiQueuedPrompt[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueMenuId, setQueueMenuId] = useState("");
  const [editingQueueId, setEditingQueueId] = useState("");
  const [editingQueuePrompt, setEditingQueuePrompt] = useState("");
  const [editingQueueBusy, setEditingQueueBusy] = useState(false);
  const [queueActionBusyId, setQueueActionBusyId] = useState("");
  const [cavCloudAttachModalOpen, setCavCloudAttachModalOpen] = useState(false);
  const [cavCloudAttachBusy, setCavCloudAttachBusy] = useState(false);
  const [cavCloudAttachLoading, setCavCloudAttachLoading] = useState(false);
  const [cavCloudAttachItems, setCavCloudAttachItems] = useState<CavCloudAttachFileItem[]>([]);
  const [cavCloudAttachQuery, setCavCloudAttachQuery] = useState("");

  const [modelOptions, setModelOptions] = useState<CavAiModelOption[]>([]);
  const [audioModelOptions, setAudioModelOptions] = useState<CavAiModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(ALIBABA_QWEN_CODER_MODEL_ID);
  const [selectedAudioModel, setSelectedAudioModel] = useState("auto");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("medium");
  const [availableReasoningLevels, setAvailableReasoningLevels] = useState<ReasoningLevel[]>(DEFAULT_REASONING_LEVELS);
  const [accountPlanId, setAccountPlanId] = useState<"free" | "premium" | "premium_plus">("free");
  const [qwenPopoverState, setQwenPopoverState] = useState<QwenCoderPopoverUiState | null>(null);
  const [qwenPopoverOpen, setQwenPopoverOpen] = useState(false);
  const [qwenPopoverPinned, setQwenPopoverPinned] = useState(false);
  const [queueEnabled, setQueueEnabled] = useState(false);
  const [, setBadgeTone] = useState<BadgeTone>("default");
  const [openComposerMenu, setOpenComposerMenu] = useState<ComposerMenu>(null);
  const [promptFocused, setPromptFocused] = useState(false);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [profileIdentity, setProfileIdentity] = useState<CavAiIdentityInput>({ fullName: "", username: "" });
  const [heroLine, setHeroLine] = useState(CAVAI_SAFE_FALLBACK_LINE);
  const [reasoningContextLines, setReasoningContextLines] = useState<string[]>([]);
  const [messageActionPending, setMessageActionPending] = useState<Record<string, string>>({});
  const [copiedMessageToken, setCopiedMessageToken] = useState("");
  const [reasoningPanelMessageId, setReasoningPanelMessageId] = useState("");
  const [inlineEditDraft, setInlineEditDraft] = useState<CavAiCodeRetryDraft | null>(null);
  const [inlineEditPrompt, setInlineEditPrompt] = useState("");
  const [inlineEditBusy, setInlineEditBusy] = useState(false);
  const [cavenSettings, setCavenSettings] = useState<CavenWorkspaceSettings>(CAVEN_DEFAULT_SETTINGS);
  const [installedAgentIds, setInstalledAgentIds] = useState<string[]>([]);
  const [customAgents, setCustomAgents] = useState<CavenRuntimeCustomAgent[]>([]);
  const [publishedAgents, setPublishedAgents] = useState<PublishedRuntimeAgent[]>([]);
  const [savingCavenSettingsKey, setSavingCavenSettingsKey] = useState("");
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsDropdownSections, setSettingsDropdownSections] = useState<Record<CavenSettingsDropdownSection, boolean>>({
    caven: true,
    ide: false,
  });
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<CavenSettingsModalTab>("skills");
  const [activeSkillInfoId, setActiveSkillInfoId] = useState<CavenSkillId | "">("");

  const requestAbortRef = useRef<AbortController | null>(null);
  const queueProcessingRef = useRef(false);
  const sessionBootstrapRef = useRef<Promise<string> | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const historySearchInputRef = useRef<HTMLInputElement | null>(null);
  const composerControlsRef = useRef<HTMLDivElement | null>(null);
  const inlineEditInputRef = useRef<HTMLTextAreaElement | null>(null);
  const viewerImageWrapRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const agentScrollRef = useRef<HTMLElement | null>(null);
  const chatShouldAutoScrollRef = useRef(true);
  const activeSessionIdRef = useRef("");
  const sessionMessageCacheRef = useRef<Map<string, CavAiMessage[]>>(new Map());
  const reasoningTickerRef = useRef<number | null>(null);
  const qwenWarningImpressionRef = useRef<Set<string>>(new Set());

  const diagnostics = useMemo<CavCodeDiagnostic[]>(() => {
    const rows = Array.isArray(props.diagnostics) ? props.diagnostics : [];
    return rows.slice(0, 160).map((row): CavCodeDiagnostic => {
      const severityRaw = s(row.severity);
      const severity: CavCodeDiagnostic["severity"] =
        severityRaw === "warn" || severityRaw === "info" ? severityRaw : "error";
      return {
        code: s(row.code) || undefined,
        source: s(row.source) || undefined,
        message: s(row.message).slice(0, 1200),
        severity,
        line: Number.isFinite(Number(row.line)) && Number(row.line) > 0 ? Math.trunc(Number(row.line)) : undefined,
        col: Number.isFinite(Number(row.col)) && Number(row.col) > 0 ? Math.trunc(Number(row.col)) : undefined,
        file: s(row.file) || undefined,
      };
    });
  }, [props.diagnostics]);

  const projectFiles = useMemo(() => {
    const rows = Array.isArray(props.projectFiles) ? props.projectFiles : [];
    return rows
      .map((row) => ({
        path: normalizePathLike(row.path),
        name: s(row.name) || s(row.path).split("/").filter(Boolean).pop() || "file",
        lang: s(row.lang) || "plaintext",
        relativePath: s(row.relativePath),
      }))
      .filter((row) => Boolean(row.path && row.path !== "/"));
  }, [props.projectFiles]);

  const filteredSessions = sessions;
  const filteredHistorySessions = useMemo(() => {
    const query = s(historyQuery).toLowerCase();
    if (!query) return sessions;
    return sessions.filter((row) => {
      const haystack = [
        s(row.title),
        s(row.contextLabel),
        s(row.preview),
        s(row.model),
        s(row.reasoningLevel),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [historyQuery, sessions]);
  const visibleCavCloudAttachItems = useMemo(() => {
    const query = s(cavCloudAttachQuery).toLowerCase();
    if (!query) return cavCloudAttachItems;
    return cavCloudAttachItems.filter((item) => {
      const haystack = [item.name, item.path, item.mimeType].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [cavCloudAttachItems, cavCloudAttachQuery]);
  const quickActionItems = useMemo(
    () => [
      {
        id: "add_files" as const,
        label: "Add photos & files",
      },
      {
        id: "upload_from_cavcloud" as const,
        label: "Upload from CavCloud",
      },
    ],
    []
  );
  const visibleMessages = useMemo(
    () => messages.filter((message) => {
      const status = s(message.status).toUpperCase();
      if (!status) return true;
      return !["QUEUED", "PROCESSING", "PROCESSED", "CANCELLED"].includes(status);
    }),
    [messages]
  );

  const currentSession = useMemo(() => sessions.find((row) => row.id === sessionId) || null, [sessionId, sessions]);
  const reasoningPanelMessage = useMemo(
    () => messages.find((row) => row.id === reasoningPanelMessageId) || null,
    [messages, reasoningPanelMessageId]
  );
  const reasoningPanelMeta = useMemo(
    () => (reasoningPanelMessage ? resolveExecutionMetaFromMessage(reasoningPanelMessage) : null),
    [reasoningPanelMessage]
  );
  const reasoningPanelContextRows = useMemo(
    () => {
      if (!reasoningPanelMeta) return [];
      const rows = reasoningPanelMeta.safeSummary.contextUsed.map((row) => toReasoningContextLabel(row)).filter(Boolean);
      return rows.length ? rows : ["No additional context signals captured."];
    },
    [reasoningPanelMeta]
  );
  const reasoningPanelCheckRows = useMemo(
    () => {
      if (!reasoningPanelMeta) return [];
      const rows = reasoningPanelMeta.safeSummary.checksPerformed.map((row) => toReasoningCheckLabel(row)).filter(Boolean);
      return rows.length ? rows : ["No validation checks recorded."];
    },
    [reasoningPanelMeta]
  );
  const reasoningPanelPathRows = useMemo(
    () => {
      if (!reasoningPanelMeta) return [];
      const rows = reasoningPanelMeta.safeSummary.answerPath.map((row) => toReasoningPathLabel(row)).filter(Boolean);
      return rows.length ? rows : ["No answer path metadata recorded."];
    },
    [reasoningPanelMeta]
  );
  const reasoningPanelTaskLabel = useMemo(
    () => (reasoningPanelMeta ? toTaskTypeLabel(reasoningPanelMeta.taskType) : ""),
    [reasoningPanelMeta]
  );
  const closeReasoningPanel = useCallback(() => {
    setReasoningPanelMessageId("");
  }, []);
  const activeFilePath = normalizePathLike(s(props.filePath));
  const cavenInteractionLocked = useMemo(
    () => accountPlanId === "free" || s(qwenPopoverState?.entitlement?.state).toLowerCase() === "locked_free",
    [accountPlanId, qwenPopoverState]
  );
  const hasQueuedPrompts = queuedPrompts.length > 0;
  const hasPendingPrompt = submitting && Boolean(s(pendingPromptText));
  const hasInlineEdit = Boolean(inlineEditDraft);
  const hasExistingThread = Boolean(sessionId || visibleMessages.length || currentSession || hasPendingPrompt || hasInlineEdit);
  const showCodePanelEmptyLogo =
    !cavenInteractionLocked
    && viewMode !== "history"
    && !loadingMessages
    && !hasPendingPrompt
    && !hasInlineEdit
    && !visibleMessages.length
    && !hasQueuedPrompts;
  const promptPlaceholder = promptFocused
    ? ""
    : hasExistingThread
      ? "Follow up with Caven"
      : "Ask Caven to build, inspect, or improve your code";
  const modelMenuOptions = useMemo(() => {
    const entries = modelOptions
      .map((option) => ({
      id: option.id,
      label: resolveAiModelLabel(option.id),
      }))
      .filter((option) => !isAiAutoModelId(option.id));
    const ordered: CavAiModelOption[] = [];
    const qwenCoder = entries.find((row) => row.id === ALIBABA_QWEN_CODER_MODEL_ID);
    if (qwenCoder) ordered.push(qwenCoder);
    const remainingSorted = entries.slice().sort((a, b) => {
      const rankDiff = rankCavCodeModelForUi(a.id) - rankCavCodeModelForUi(b.id);
      if (rankDiff !== 0) return rankDiff;
      return a.label.localeCompare(b.label);
    });
    for (const option of remainingSorted) {
      if (ordered.some((row) => row.id === option.id)) continue;
      ordered.push(option);
    }
    return ordered;
  }, [modelOptions]);
  const audioModelMenuOptions = useMemo(() => {
    const options: CavAiModelOption[] = [{ id: "auto", label: "Auto transcription model" }];
    for (const option of audioModelOptions) {
      if (options.some((row) => row.id === option.id)) continue;
      options.push({
        id: option.id,
        label: option.label || resolveAiModelLabel(option.id),
      });
    }
    return options;
  }, [audioModelOptions]);
  const selectedModelLabel = useMemo(() => {
    const match = modelMenuOptions.find((option) => option.id === selectedModel);
    if (match) return match.label;
    return resolveAiModelLabel(selectedModel);
  }, [modelMenuOptions, selectedModel]);
  const selectedAudioModelLabel = useMemo(() => {
    return "Voice";
  }, []);
  const qwenAvailability = useMemo(
    () => qwenPopoverState?.modelAvailability?.[ALIBABA_QWEN_CODER_MODEL_ID] || null,
    [qwenPopoverState]
  );
  const qwenLocked = useMemo(
    () => Boolean(qwenAvailability && qwenAvailability.selectable === false),
    [qwenAvailability]
  );
  const qwenUsagePercent = useMemo(
    () => Math.max(0, Math.min(100, Number(qwenPopoverState?.usage?.percentUsed || 0))),
    [qwenPopoverState]
  );
  const qwenUsageLabel = useMemo(
    () => {
      const state = s(qwenPopoverState?.entitlement?.state).toLowerCase();
      if (state === "locked_free" || Number(qwenPopoverState?.usage?.creditsTotal || 0) <= 0) {
        return "Not included on Free";
      }
      return `${Math.round(qwenUsagePercent)}% used`;
    },
    [qwenPopoverState, qwenUsagePercent]
  );
  const maxImageAttachments = useMemo(() => maxImageAttachmentsForPlan(accountPlanId), [accountPlanId]);
  const emitQwenUpgradeDecision = useCallback(() => {
    const fromPayload = emitGuardDecisionFromPayload({ guardDecision: qwenPopoverState?.guardDecision || null });
    if (fromPayload) return fromPayload;
    const entitlementState = s(qwenPopoverState?.entitlement?.state).toLowerCase();
    const actionId =
      entitlementState === "cooldown"
        ? "AI_QWEN_CODER_COOLDOWN"
        : entitlementState === "premium_exhausted"
          ? "AI_QWEN_CODER_PREMIUM_EXHAUSTED"
          : entitlementState === "premium_plus_exhausted"
            ? "AI_QWEN_CODER_PREMIUM_PLUS_EXHAUSTED"
            : "AI_QWEN_CODER_UNLOCK_REQUIRED";
    const actorPlan =
      entitlementState === "premium_plus_exhausted"
        ? "PREMIUM_PLUS"
        : entitlementState === "cooldown" || entitlementState === "premium_exhausted"
          ? "PREMIUM"
          : "FREE";
    const fallbackDecision = buildCavGuardDecision(actionId, {
      plan: actorPlan,
      flags: {
        qwenResetAt: qwenPopoverState?.resetAt || null,
        qwenCooldownEndsAt: qwenPopoverState?.cooldownEndsAt || null,
        qwenCoderEntitlement: qwenPopoverState
          ? {
              state: qwenPopoverState.entitlement.state,
              resetAt: qwenPopoverState.resetAt,
              cooldownEndsAt: qwenPopoverState.cooldownEndsAt,
            }
          : null,
      },
    });
    emitGuardDecision(fallbackDecision);
    return fallbackDecision;
  }, [qwenPopoverState]);
  const reasoningMenuOptions = useMemo(
    () => REASONING_LEVEL_OPTIONS.filter((option) => availableReasoningLevels.includes(option.value)),
    [availableReasoningLevels]
  );
  const selectedReasoningLabel = useMemo(() => {
    const match = REASONING_LEVEL_OPTIONS.find((option) => option.value === reasoningLevel);
    return match?.label || toReasoningDisplayLabel(reasoningLevel);
  }, [reasoningLevel]);
  const asrAudioSkillEnabled = cavenSettings.asrAudioSkillEnabled;
  const showAudioModelSelector = asrAudioSkillEnabled && audioModelMenuOptions.length > 1;
  const activeSkillInfo = useMemo(
    () => CAVEN_SKILLS.find((row) => row.id === activeSkillInfoId) || null,
    [activeSkillInfoId]
  );
  const clearReasoningTicker = useCallback(() => {
    if (typeof window === "undefined") return;
    if (reasoningTickerRef.current === null) return;
    window.clearInterval(reasoningTickerRef.current);
    reasoningTickerRef.current = null;
  }, []);

  const stopReasoningContext = useCallback(() => {
    clearReasoningTicker();
    setReasoningContextLines([]);
  }, [clearReasoningTicker]);

  const startReasoningContext = useCallback((args: {
    filePath: string;
    modelId: string;
    level: ReasoningLevel;
    queued?: boolean;
  }) => {
    clearReasoningTicker();
    if (!cavenSettings.showReasoningTimeline) {
      setReasoningContextLines([]);
      return;
    }
    const targetPath = normalizePathLike(s(args.filePath));
    const fileLeaf = targetPath.split("/").filter(Boolean).pop() || "current file";
    const modelLabel = resolveAiModelLabel(s(args.modelId) || ALIBABA_QWEN_CODER_MODEL_ID);
    const levelLabel = toReasoningDisplayLabel(args.level);
    const stagedLines = [
      args.queued ? `Processing queued request for ${fileLeaf}` : `Collecting editor context from ${fileLeaf}`,
      `Using ${modelLabel} with ${levelLabel} reasoning`,
      "Reviewing selected code and diagnostics",
      "Drafting implementation changes",
      "Finalizing response",
    ];
    const startedAt = Date.now();
    setReasoningContextLines(stagedLines.slice(0, 2));
    if (typeof window === "undefined") return;
    let index = 2;
    reasoningTickerRef.current = window.setInterval(() => {
      setReasoningContextLines((prev) => {
        if (index < stagedLines.length) {
          const nextLine = stagedLines[index];
          index += 1;
          if (!nextLine || prev[prev.length - 1] === nextLine) return prev;
          return [...prev, nextLine].slice(-5);
        }
        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const holdLine = `Still reasoning... ${elapsed}s elapsed`;
        if (prev[prev.length - 1] === holdLine) return prev;
        return [...prev.slice(-4), holdLine];
      });
    }, 2100);
  }, [cavenSettings.showReasoningTimeline, clearReasoningTicker]);

  const loadQwenPopoverState = useCallback(async (nextSessionId?: string | null) => {
    try {
      const qp = new URLSearchParams();
      const sid = s(nextSessionId || sessionId);
      if (sid) qp.set("sessionId", sid);
      const res = await fetch(`/api/ai/qwen-coder/popover${qp.toString() ? `?${qp.toString()}` : ""}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || body.ok !== true) return;
      const next = toQwenPopoverUiState(body);
      if (next) setQwenPopoverState(next);
    } catch {
      // Best effort only.
    }
  }, [sessionId]);

  const trackCavenEvent = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!cavenSettings.telemetryOptIn) return;
    track(event, payload);
  }, [cavenSettings.telemetryOptIn]);

  const applyLoadedSettings = useCallback((value: unknown, publishedValue?: unknown) => {
    const next = toCavenWorkspaceSettings(value);
    const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    setCavenSettings(next);
    if ("installedAgentIds" in raw) {
      setInstalledAgentIds(normalizeInstalledAgentIdsFromSettings(raw.installedAgentIds));
    }
    if ("customAgents" in raw) {
      setCustomAgents(normalizeRuntimeCustomAgents(raw.customAgents));
    }
    if (publishedValue !== undefined) {
      setPublishedAgents(normalizePublishedRuntimeAgents(publishedValue));
    }
    if (!sessionId) {
      setQueueEnabled(next.queueFollowUps);
      setReasoningLevel(next.defaultReasoningLevel);
      setSelectedModel(next.defaultModelId || ALIBABA_QWEN_CODER_MODEL_ID);
    }
    if (!next.asrAudioSkillEnabled) {
      setSelectedAudioModel("auto");
    }
  }, [sessionId]);

  const loadCavenSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/cavai/settings", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ settings?: unknown; publishedAgents?: unknown }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        applyLoadedSettings(CAVEN_DEFAULT_SETTINGS, []);
        return;
      }
      applyLoadedSettings(body.settings || CAVEN_DEFAULT_SETTINGS, body.publishedAgents);
    } catch (err) {
      console.warn("[caven] settings load failed, using defaults", err);
      applyLoadedSettings(CAVEN_DEFAULT_SETTINGS, []);
    }
  }, [applyLoadedSettings]);

  const patchCavenSettings = useCallback(
    async (patch: Partial<CavenWorkspaceSettings>, saveKey = "") => {
      const optimistic = {
        ...cavenSettings,
        ...patch,
      };
      applyLoadedSettings(optimistic);
      if (saveKey) setSavingCavenSettingsKey(saveKey);
      try {
        const res = await fetch("/api/cavai/settings", {
          method: "PATCH",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify(patch),
        });
        const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ settings?: unknown; publishedAgents?: unknown }>;
        if (!res.ok || !body.ok) {
          emitGuardDecisionFromPayload(body);
          throw new Error(s((body as { message?: unknown }).message) || "Failed to update Caven settings.");
        }
        applyLoadedSettings(body.settings, body.publishedAgents);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update Caven settings.");
        void loadCavenSettings();
      } finally {
        setSavingCavenSettingsKey("");
      }
    },
    [applyLoadedSettings, cavenSettings, loadCavenSettings]
  );

  useEffect(() => {
    if (!qwenPopoverOpen || !qwenPopoverState) return;
    trackCavenEvent("qwen_coder_popover_open", {
      surface: "cavcode",
      planLabel: qwenPopoverState.planLabel,
      usagePercent: Math.round(qwenPopoverState.usage.percentUsed),
    });
    const warning = qwenPopoverState.entitlement.warningLevel;
    if (!warning) return;
    const key = `${warning}:${qwenPopoverState.resetAt}`;
    if (qwenWarningImpressionRef.current.has(key)) return;
    qwenWarningImpressionRef.current.add(key);
    trackCavenEvent("qwen_coder_low_balance_warning_impression", {
      surface: "cavcode",
      warningLevel: warning,
      usagePercent: Math.round(qwenPopoverState.usage.percentUsed),
      planLabel: qwenPopoverState.planLabel,
    });
  }, [qwenPopoverOpen, qwenPopoverState, trackCavenEvent]);

  useLayoutEffect(() => {
    const boot = readBootClientPlanBootstrap();
    setAccountPlanId(boot.planId);
    setModelOptions(boot.planId === "free" ? [] : cavCodePlanModelOptions(boot.planId));
    setAvailableReasoningLevels(reasoningLevelsForPlan(boot.planId));
  }, []);

  useEffect(() => {
    return subscribeClientPlan((planId) => {
      setAccountPlanId(planId);
    });
  }, []);

  const loadProviderModels = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/test?catalog=context&surface=cavcode&action=generate_component", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        planId?: string;
        models?: { chat?: string; reasoning?: string };
        modelCatalog?: {
          text?: unknown[];
          audio?: unknown[];
        };
        reasoning?: {
          maxLevel?: unknown;
          options?: unknown[];
        };
        qwenCoder?: unknown;
        qwenGuardDecision?: unknown;
        modelAvailability?: unknown;
        guardDecision?: unknown;
      };
      if (!res.ok || body.ok !== true) {
        emitGuardDecisionFromPayload(body);
        setModelOptions(cavCodePlanModelOptions(accountPlanId));
        setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
        return;
      }
      const effectivePlanId = resolveServerPlanId(body.planId, accountPlanId);
      setAccountPlanId(effectivePlanId);
      const hasCatalog = Boolean(body.modelCatalog && typeof body.modelCatalog === "object");
      const textOptions = Array.isArray(body.modelCatalog?.text)
        ? body.modelCatalog?.text.map((row) => toModelOption(row)).filter(Boolean) as CavAiModelOption[]
        : [];
      if (hasCatalog) {
        const nextOptions = normalizeCavCodeModelOptions(textOptions);
        setModelOptions(nextOptions.length ? nextOptions : cavCodePlanModelOptions(effectivePlanId));
      } else {
        setModelOptions(cavCodePlanModelOptions(effectivePlanId));
      }

      const audioOptions = Array.isArray(body.modelCatalog?.audio)
        ? body.modelCatalog?.audio.map((row) => toModelOption(row)).filter(Boolean) as CavAiModelOption[]
        : [];
      setAudioModelOptions(audioOptions);

      const optionsFromPolicy = normalizeReasoningOptions(body.reasoning?.options);
      if (optionsFromPolicy.length) {
        const nextReasoning = clampReasoningLevelsToPlan(optionsFromPolicy, effectivePlanId);
        setAvailableReasoningLevels(nextReasoning.length ? nextReasoning : reasoningLevelsForPlan(effectivePlanId));
      } else {
        const optionsFromMax = reasoningLevelsUpTo(body.reasoning?.maxLevel);
        const nextReasoning = optionsFromMax.length ? optionsFromMax : reasoningLevelsForPlan(effectivePlanId);
        const nextReasoningLevels = clampReasoningLevelsToPlan(nextReasoning, effectivePlanId);
        setAvailableReasoningLevels(nextReasoningLevels.length ? nextReasoningLevels : reasoningLevelsForPlan(effectivePlanId));
      }

      const qwenState = toQwenPopoverUiState(body);
      if (qwenState) {
        setQwenPopoverState(qwenState);
      }
    } catch {
      // Best effort only.
      setModelOptions(cavCodePlanModelOptions(accountPlanId));
      setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
    }
  }, [accountPlanId]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await fetch(buildSessionsUrl({ workspaceId, projectId }), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ sessions?: CavAiSessionSummary[] }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to load sessions.");
      }

      const rows = Array.isArray(body.sessions) ? body.sessions : [];
      setSessions(rows);
      if (!rows.length) {
        activeSessionIdRef.current = "";
        setSessionId("");
        setViewMode("history");
        setMessages([]);
        setQueuedPrompts([]);
        return;
      }

      const activeSessionId = s(activeSessionIdRef.current);
      if (activeSessionId && rows.some((row) => row.id === activeSessionId)) return;
      activeSessionIdRef.current = "";
      setSessionId("");
      setMessages([]);
      setQueuedPrompts([]);
      setViewMode("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions.");
    } finally {
      setLoadingSessions(false);
    }
  }, [projectId, workspaceId]);

  const loadMessages = useCallback(async (nextSessionId: string) => {
    const normalized = s(nextSessionId);
    if (!normalized) {
      setMessages([]);
      return;
    }
    const cachedMessages = sessionMessageCacheRef.current.get(normalized);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
    try {
      const res = await fetch(`/api/ai/sessions/${encodeURIComponent(normalized)}/messages?limit=240`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ messages?: CavAiMessage[] }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to load messages.");
      }
      const rows = Array.isArray(body.messages) ? body.messages : [];
      const normalizedRows = rows.map((row) => ({
        ...(row as CavAiMessage),
        feedback: toSafeFeedbackState((row as CavAiMessage).feedback),
      }));
      sessionMessageCacheRef.current.set(normalized, normalizedRows);
      if (s(activeSessionIdRef.current) !== normalized) return;
      setMessages(normalizedRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load messages.");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadQueuedPrompts = useCallback(async (nextSessionId: string) => {
    const normalized = s(nextSessionId);
    if (!normalized) {
      setQueuedPrompts([]);
      return;
    }
    setLoadingQueue(true);
    try {
      const qp = new URLSearchParams();
      qp.set("sessionId", normalized);
      qp.set("limit", "80");
      const res = await fetch(`/api/ai/cavcode/queue?${qp.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ queued?: unknown[] }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to load queue.");
      }
      const rows = Array.isArray(body.queued) ? body.queued.map((row) => parseQueuedPrompt(row)).filter(Boolean) : [];
      setQueuedPrompts(rows as CavAiQueuedPrompt[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queue.");
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const claimNextQueuedPrompt = useCallback(async (nextSessionId: string): Promise<CavAiQueuedPrompt | null> => {
    const normalized = s(nextSessionId);
    if (!normalized) return null;
    const res = await fetch("/api/ai/cavcode/queue", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-cavbot-csrf": "1",
      },
      body: JSON.stringify({
        mode: "claim_next",
        sessionId: normalized,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ queuedPrompt?: unknown }>;
    if (!res.ok || !body.ok) {
      emitGuardDecisionFromPayload(body);
      throw new Error(s((body as { message?: unknown }).message) || "Failed to claim queued prompt.");
    }
    return parseQueuedPrompt(body.queuedPrompt || null);
  }, []);

  useEffect(() => {
    void loadProviderModels();
  }, [loadProviderModels]);

  useEffect(() => {
    void loadCavenSettings();
  }, [loadCavenSettings]);

  useEffect(() => {
    void loadQwenPopoverState(sessionId || null);
  }, [loadQwenPopoverState, sessionId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sources = [
      "/icons/app/image-combiner-svgrepo-com.svg",
      "/icons/copy-svgrepo-com.svg",
      "/icons/app/reload-svgrepo-com.svg",
    ];
    for (const src of sources) {
      const image = new window.Image();
      image.decoding = "async";
      image.src = src;
    }
  }, []);

  useEffect(() => {
    const syncIdentity = () => setProfileIdentity(readCavAiIdentityFromStorage());
    syncIdentity();
    const onProfileSync = () => syncIdentity();
    const onProfile = (event: Event) => {
      const detail = ((event as CustomEvent<Record<string, unknown>>).detail || {}) as Record<string, unknown>;
      const nextIdentity = rememberCavAiIdentity({
        fullName: s(detail.fullName) || s(detail.displayName),
        username: s(detail.username),
      });
      setProfileIdentity(nextIdentity);
    };
    window.addEventListener("cb:profile", onProfile as EventListener);
    window.addEventListener("cb:profile-sync", onProfileSync as EventListener);
    return () => {
      window.removeEventListener("cb:profile", onProfile as EventListener);
      window.removeEventListener("cb:profile-sync", onProfileSync as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          authenticated?: boolean;
          user?: {
            displayName?: unknown;
            username?: unknown;
          };
          account?: {
            tier?: unknown;
            tierEffective?: unknown;
          };
        };
        if (cancelled) return;
        if (!res.ok || body.ok !== true || body.authenticated !== true) {
          if (res.status === 401 || body.authenticated === false) {
            setAccountPlanId("free");
          }
          return;
        }
        const nextIdentity = rememberCavAiIdentity({
          fullName: s(body.user?.displayName),
          username: s(body.user?.username),
        });
        setProfileIdentity(nextIdentity);
        const authPlanId = normalizePlanId(body.account?.tierEffective ?? body.account?.tier);
        setAccountPlanId(authPlanId);
      } catch {
        // Best effort only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextLine = pickAndRememberCavAiLine({
      surface: "cavcode",
      identity: {
        fullName: profileIdentity.fullName,
        username: profileIdentity.username,
      },
      scopeKey: "code:cavcode",
    });
    setHeroLine(nextLine || CAVAI_SAFE_FALLBACK_LINE);
  }, [profileIdentity.fullName, profileIdentity.username]);

  useEffect(() => {
    const handler = (event: Event) => {
      const tone = (event as CustomEvent).detail?.tone as BadgeTone | undefined;
      if (!tone || (tone !== "default" && tone !== "lime" && tone !== "red")) {
        setBadgeTone("default");
        return;
      }
      setBadgeTone(tone);
    };
    window.addEventListener("cb:eye-tone", handler);
    return () => window.removeEventListener("cb:eye-tone", handler);
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const normalized = s(sessionId);
    if (!normalized) return;
    sessionMessageCacheRef.current.set(normalized, messages);
  }, [messages, sessionId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setQueuedPrompts([]);
      return;
    }
    void loadMessages(sessionId);
    void loadQueuedPrompts(sessionId);
  }, [loadMessages, loadQueuedPrompts, sessionId]);

  useEffect(() => {
    if (!reasoningPanelMessageId) return;
    if (messages.some((row) => row.id === reasoningPanelMessageId)) return;
    setReasoningPanelMessageId("");
  }, [messages, reasoningPanelMessageId]);

  useEffect(() => {
    if (!copiedMessageToken || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setCopiedMessageToken(""), 1_600);
    return () => window.clearTimeout(timer);
  }, [copiedMessageToken]);

  useEffect(() => {
    setQueueMenuId("");
    setEditingQueueId("");
    setEditingQueuePrompt("");
    setQueueActionBusyId("");
  }, [sessionId]);

  useEffect(() => {
    if (!currentSession) return;
    if (currentSession.reasoningLevel) setReasoningLevel(currentSession.reasoningLevel);
    if (typeof currentSession.queueEnabled === "boolean") setQueueEnabled(currentSession.queueEnabled);
  }, [currentSession]);

  useEffect(() => {
    if (cavenSettings.showReasoningTimeline) return;
    stopReasoningContext();
  }, [cavenSettings.showReasoningTimeline, stopReasoningContext]);

  useEffect(() => {
    if (currentSession) return;
    setQueueEnabled(cavenSettings.queueFollowUps);
    setReasoningLevel(cavenSettings.defaultReasoningLevel);
    setSelectedModel(cavenSettings.defaultModelId || ALIBABA_QWEN_CODER_MODEL_ID);
  }, [cavenSettings.defaultModelId, cavenSettings.defaultReasoningLevel, cavenSettings.queueFollowUps, currentSession]);

  useEffect(() => {
    if (!isAiAutoModelId(selectedModel)) return;
    setSelectedModel(resolvePreferredCavCodeModel(modelOptions, ALIBABA_QWEN_CODER_MODEL_ID));
  }, [modelOptions, selectedModel]);

  useEffect(() => {
    if (!modelOptions.length) return;
    if (modelOptions.some((row) => row.id === selectedModel)) return;
    setSelectedModel(resolvePreferredCavCodeModel(modelOptions, selectedModel));
  }, [modelOptions, selectedModel]);

  useEffect(() => {
    if (!modelOptions.length) return;
    if (s(currentSession?.model)) return;
    const preferred = resolvePreferredCavCodeModel(modelOptions, selectedModel);
    if (preferred === selectedModel) return;
    setSelectedModel(preferred);
  }, [currentSession?.model, modelOptions, selectedModel]);

  useEffect(() => {
    if (selectedAudioModel === "auto") return;
    if (audioModelOptions.some((row) => row.id === selectedAudioModel)) return;
    setSelectedAudioModel("auto");
  }, [audioModelOptions, selectedAudioModel]);

  useEffect(() => {
    setModelOptions((prev) => {
      const nextOptions = normalizeCavCodeModelOptions(prev);
      if (normalizePlanId(accountPlanId) === "free") return [];
      return nextOptions.length ? nextOptions : cavCodePlanModelOptions(accountPlanId);
    });
    setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
  }, [accountPlanId]);

  useEffect(() => {
    if (availableReasoningLevels.includes(reasoningLevel)) return;
    const fallback = availableReasoningLevels.includes("medium")
      ? "medium"
      : availableReasoningLevels[availableReasoningLevels.length - 1] || "low";
    setReasoningLevel(fallback);
  }, [availableReasoningLevels, reasoningLevel]);

  const scrollChatToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = agentScrollRef.current;
    if (!node) return;
    const top = Math.max(0, node.scrollHeight);
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top, behavior });
      return;
    }
    node.scrollTop = top;
  }, []);

  const onChatScroll = useCallback(() => {
    if (viewMode !== "chat") return;
    const node = agentScrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    chatShouldAutoScrollRef.current = distanceFromBottom <= 72;
  }, [viewMode]);

  useEffect(() => {
    chatShouldAutoScrollRef.current = true;
    setInlineEditDraft(null);
    setInlineEditPrompt("");
    setInlineEditBusy(false);
  }, [sessionId, viewMode]);

  useEffect(() => {
    if (viewMode !== "chat") return;
    if (!chatShouldAutoScrollRef.current) return;
    scrollChatToLatest(hasPendingPrompt ? "smooth" : "auto");
  }, [hasInlineEdit, hasPendingPrompt, loadingMessages, reasoningContextLines.length, scrollChatToLatest, sessionId, submitting, viewMode, visibleMessages.length]);

  useEffect(() => {
    if (!inlineEditDraft) return;
    if (typeof window === "undefined") return;
    const handle = window.requestAnimationFrame(() => {
      const input = inlineEditInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [inlineEditDraft]);

  useEffect(
    () => () => {
      clearReasoningTicker();
      if (!requestAbortRef.current) return;
      requestAbortRef.current.abort();
      requestAbortRef.current = null;
    },
    [clearReasoningTicker]
  );

  useEffect(() => {
    if (!openComposerMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = composerControlsRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      setOpenComposerMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenComposerMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openComposerMenu]);

  useEffect(() => {
    if (openComposerMenu !== "model") {
      setQwenPopoverOpen(false);
      setQwenPopoverPinned(false);
    }
  }, [openComposerMenu]);

  useEffect(() => {
    if (asrAudioSkillEnabled) return;
    if (openComposerMenu !== "audio_model") return;
    setOpenComposerMenu(null);
  }, [openComposerMenu, asrAudioSkillEnabled]);

  useEffect(() => {
    if (!settingsMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = settingsMenuRef.current;
      const target = event.target;
      if (!root || !(target instanceof Node)) return;
      if (root.contains(target)) return;
      setSettingsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsMenuOpen]);

  useEffect(() => {
    if (!historyModalOpen) return;
    setSettingsMenuOpen(false);
    setOpenComposerMenu(null);
    const timeoutId = window.setTimeout(() => {
      historySearchInputRef.current?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [historyModalOpen]);

  useEffect(() => {
    if (!settingsModalOpen && !activeSkillInfoId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeSkillInfoId) {
        setActiveSkillInfoId("");
        return;
      }
      if (settingsModalOpen) {
        setSettingsModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSkillInfoId, settingsModalOpen]);

  const resolveSelectedCode = useCallback(() => {
    if (getSelectedCodeProp) {
      const value = s(getSelectedCodeProp());
      if (value) return value;
    }
    return s(selectedCodeProp);
  }, [getSelectedCodeProp, selectedCodeProp]);

  const ensureActiveSessionId = useCallback(async (): Promise<string> => {
    const existing = s(sessionId);
    if (existing) return existing;
    if (sessionBootstrapRef.current) return sessionBootstrapRef.current;

    const request = (async () => {
      const res = await fetch("/api/ai/sessions", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          surface: "cavcode",
          title: "CavCode context",
          contextLabel: "CavCode context",
          workspaceId: s(workspaceId) || undefined,
          projectId: projectId || undefined,
          context: {
            ...(cavenSettings.includeIdeContext
              ? buildCavCodeRouteContextPayload({
                  workspaceId: s(workspaceId) || null,
                  projectId: projectId || null,
                  contextLabel: "CavCode context",
                })
              : {}),
            surface: "cavcode",
            queueEnabled,
            activeFilePath: activeFilePath || null,
            activeProjectRootPath: cavenSettings.includeIdeContext ? s(props.projectRootPath) || null : null,
            activeProjectRootName: cavenSettings.includeIdeContext ? s(props.projectRootName) || null : null,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ sessionId?: string }>;
      const nextSessionId = body.ok ? s(body.sessionId) : "";
      if (!res.ok || !body.ok || !nextSessionId) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to initialize Caven session.");
      }
      activeSessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
      setViewMode("chat");
      return nextSessionId;
    })();

    sessionBootstrapRef.current = request;
    try {
      return await request;
    } finally {
      if (sessionBootstrapRef.current === request) {
        sessionBootstrapRef.current = null;
      }
    }
  }, [
    activeFilePath,
    cavenSettings.includeIdeContext,
    projectId,
    props.projectRootName,
    props.projectRootPath,
    queueEnabled,
    sessionId,
    workspaceId,
  ]);

  const runDraft = useCallback(async (
    draft: {
      prompt: string;
      images: CavAiImageAttachment[];
      model: string;
      reasoningLevel: ReasoningLevel;
    },
    options?: {
      queueMessageId?: string | null;
      action?: CavCodeAssistAction;
      agentId?: string | null;
      agentActionKey?: string | null;
      filePath?: string | null;
      language?: string | null;
      selectedCode?: string;
      diagnostics?: CavCodeDiagnostic[];
      context?: Record<string, unknown>;
      sessionId?: string | null;
      clearComposer?: boolean;
      showPending?: boolean;
    }
  ): Promise<boolean> => {
    const promptText = s(draft.prompt);
    if (!promptText) return false;
    if (draft.images.some((image) => image.uploading === true)) {
      setError("Images are still uploading. Please wait a moment.");
      return false;
    }
    if (uploadedFiles.some((file) => file.uploading === true)) {
      setError("Files are still uploading. Please wait a moment.");
      return false;
    }
    const draftModelId = s(draft.model);
    const effectiveModelId = draftModelId && !isAiAutoModelId(draftModelId)
      ? draftModelId
      : resolvePreferredCavCodeModel(modelOptions, selectedModel);

    let resolvedFilePath = normalizePathLike(s(options?.filePath));
    if (!resolvedFilePath) {
      const targetResolution = resolvePromptTargetFile({
        prompt: promptText,
        activeFilePath,
        projectFiles,
      });
      if (targetResolution.status === "ambiguous") {
        setError(`Multiple files match. Use a clearer path: ${targetResolution.matches.join(", ")}`);
        return false;
      }
      if (targetResolution.status === "missing") {
        setError("Caven could not resolve a target file in the active project folder.");
        return false;
      }
      resolvedFilePath = targetResolution.filePath;
    }

    const action = options?.action || inferActionFromPrompt(promptText);
    const explicitAgentRef = normalizeAgentRef({
      agentId: options?.agentId,
      agentActionKey: options?.agentActionKey,
    });
    const customAgentRef = explicitAgentRef || resolvePromptCustomAgentRef({
      prompt: promptText,
      requestedAction: action,
      installedAgentIds,
      customAgents,
      publishedAgents,
    });
    let resolvedSessionId = s(options?.sessionId) || s(sessionId);
    if (!resolvedSessionId) {
      try {
        resolvedSessionId = await ensureActiveSessionId();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize Caven session.");
        return false;
      }
    }
    const includeIdeContext = cavenSettings.includeIdeContext;
    const selectedCode = includeIdeContext
      ? (options?.selectedCode !== undefined ? s(options.selectedCode) : resolveSelectedCode())
      : "";
    const diagnosticsPayload = includeIdeContext
      ? (Array.isArray(options?.diagnostics) ? options?.diagnostics : diagnostics)
      : [];
    const languagePayload = options?.language !== undefined ? s(options.language) : language;
    const contextPayload = {
      aiSurface: mode === "panel" ? "cavcode-left-panel" : "cavcode-full-workspace",
      activeFilePath: resolvedFilePath,
      uploadedWorkspaceFiles: uploadedFiles
        .filter((file) => !file.uploading && (s(file.path) || s(file.cavcloudFileId)))
        .map((file) => ({
          cavcloudFileId: s(file.cavcloudFileId) || undefined,
          cavcloudPath: s(file.cavcloudPath) || undefined,
          path: file.path,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          snippet: s(file.snippet) || undefined,
        })),
      ...(includeIdeContext
        ? {
            ...buildCavCodeRouteContextPayload({
              workspaceId: s(workspaceId) || null,
              projectId: projectId || null,
              contextLabel: "CavCode context",
            }),
            ...context,
            activeProjectRootPath: s(props.projectRootPath) || null,
            activeProjectRootName: s(props.projectRootName) || null,
            projectFiles: projectFiles.slice(0, 400).map((file) => ({
              path: file.path,
              relativePath: file.relativePath,
              lang: file.lang,
            })),
          }
        : {
            contextScope: "minimal_ide",
            activeProjectRootPath: null,
            activeProjectRootName: null,
            projectFiles: [],
          }),
      ...(options?.context || {}),
    };

    if (options?.clearComposer !== false) {
      setPrompt("");
      setImages([]);
      setUploadedFiles([]);
    }

    if (options?.showPending !== false) {
      chatShouldAutoScrollRef.current = true;
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          scrollChatToLatest("smooth");
        });
      }
      setPendingPromptText(promptText);
    }
    startReasoningContext({
      filePath: resolvedFilePath,
      modelId: effectiveModelId || ALIBABA_QWEN_CODER_MODEL_ID,
      level: draft.reasoningLevel || "medium",
      queued: Boolean(s(options?.queueMessageId)),
    });
    setSubmitting(true);
    setError("");
    const controller = new AbortController();
    requestAbortRef.current = controller;

    try {
      const res = await fetch("/api/ai/cavcode/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          agentId: customAgentRef?.agentId || undefined,
          agentActionKey: customAgentRef?.agentActionKey || undefined,
          filePath: resolvedFilePath,
          language: languagePayload || undefined,
          selectedCode: selectedCode || undefined,
          diagnostics: diagnosticsPayload,
          prompt: promptText,
          sessionId: resolvedSessionId || undefined,
          queueMessageId: s(options?.queueMessageId) || undefined,
          workspaceId: s(workspaceId) || undefined,
          projectId: projectId || undefined,
          model: effectiveModelId || ALIBABA_QWEN_CODER_MODEL_ID,
          reasoningLevel: draft.reasoningLevel,
          queueEnabled,
          imageAttachments: draft.images
            .map((image) => {
              const assetId = s(image.assetId);
              const dataUrl = s(image.dataUrl);
              const includeDataUrl = !assetId && dataUrl.length > 0 && dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS;
              return {
                id: image.id,
                assetId: assetId || undefined,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl: includeDataUrl ? dataUrl : undefined,
              };
            })
            .filter((image) => Boolean(s(image.assetId) || s(image.dataUrl))),
          context: contextPayload,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        data?: CavCodeAssistData;
        sessionId?: string;
      }>;
      if (!res.ok || !body.ok || !body.data) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "CavCode assist failed.");
      }

      const nextSessionId = s(body.ok ? body.sessionId : "") || resolvedSessionId;
      if (nextSessionId) {
        activeSessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setViewMode("chat");
        await loadMessages(nextSessionId);
        await loadQueuedPrompts(nextSessionId);
      }
      await loadSessions();
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "CavCode assist failed.");
      }
      return false;
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      if (options?.showPending !== false) {
        setPendingPromptText("");
      }
      setSubmitting(false);
      stopReasoningContext();
      void loadQwenPopoverState(resolvedSessionId || sessionId || null);
    }
  }, [
    activeFilePath,
    cavenSettings.includeIdeContext,
    customAgents,
    context,
    diagnostics,
    installedAgentIds,
    language,
    loadMessages,
    loadQueuedPrompts,
    loadSessions,
    mode,
    modelOptions,
    projectFiles,
    projectId,
    props.projectRootName,
    props.projectRootPath,
    publishedAgents,
    queueEnabled,
    loadQwenPopoverState,
    ensureActiveSessionId,
    resolveSelectedCode,
    scrollChatToLatest,
    setPendingPromptText,
    selectedModel,
    sessionId,
    startReasoningContext,
    stopReasoningContext,
    uploadedFiles,
    workspaceId,
  ]);

  const applyFeedbackStateForMessage = useCallback((messageId: string, feedback: CavAiMessageFeedbackState) => {
    setMessages((prev) =>
      prev.map((item) =>
        item.id === messageId
          ? {
              ...item,
              feedback: toSafeFeedbackState(feedback),
            }
          : item
      )
    );
  }, []);

  const runMessageFeedbackAction = useCallback(
    async (messageId: string, action: "copy" | "share" | "retry" | "like" | "dislike" | "clear_reaction") => {
      const activeSessionId = s(sessionId);
      if (!activeSessionId) return null;
      setMessageActionPending((prev) => ({ ...prev, [messageId]: action }));
      try {
        const res = await fetch(
          `/api/ai/sessions/${encodeURIComponent(activeSessionId)}/messages/${encodeURIComponent(messageId)}/feedback`,
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1",
            },
            body: JSON.stringify({ action }),
          }
        );
        const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
          feedback?: CavAiMessageFeedbackState;
          message?: string;
        }>;
        if (!res.ok || !body.ok || !body.feedback) {
          emitGuardDecisionFromPayload(body);
          throw new Error(s((body as { message?: unknown }).message) || "Failed to update message action.");
        }
        applyFeedbackStateForMessage(messageId, body.feedback);
        return body.feedback;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update message action.");
        return null;
      } finally {
        setMessageActionPending((prev) => {
          if (!(messageId in prev)) return prev;
          const next = { ...prev };
          delete next[messageId];
          return next;
        });
      }
    },
    [applyFeedbackStateForMessage, sessionId]
  );

  const copyTextWithFeedback = useCallback(
    async (item: CavAiMessage, text: string, token: string) => {
      const content = s(text);
      if (!content) return;
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        setError("Copy failed. Please try again.");
        return;
      }
      setCopiedMessageToken(token);
      void runMessageFeedbackAction(item.id, "copy");
    },
    [runMessageFeedbackAction]
  );

  const onToggleMessageReaction = useCallback(
    (item: CavAiMessage, reaction: "like" | "dislike") => {
      void runMessageFeedbackAction(item.id, reaction);
    },
    [runMessageFeedbackAction]
  );

  const onShareMessage = useCallback(
    async (item: CavAiMessage) => {
      const text = s(item.contentText);
      if (!text) return;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({
            title: item.role === "assistant" ? "CavCode response" : "CavCode prompt",
            text,
          });
        } else {
          await navigator.clipboard.writeText(text);
          setCopiedMessageToken(`share:${item.id}`);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Share failed.");
        return;
      }
      void runMessageFeedbackAction(item.id, "share");
    },
    [runMessageFeedbackAction]
  );

  const resolveRetryDraft = useCallback((messageId: string): CavAiCodeRetryDraft | null => {
    const index = messages.findIndex((row) => row.id === messageId);
    if (index < 0) return null;
    const current = messages[index];
    let userMessage: CavAiMessage | null = null;
    if (current.role === "user") {
      userMessage = current;
    } else {
      for (let pointer = index - 1; pointer >= 0; pointer -= 1) {
        const row = messages[pointer];
        if (row.role !== "user") continue;
        userMessage = row;
        break;
      }
    }
    if (!userMessage) return null;

    const payloadRaw =
      userMessage.contentJson && typeof userMessage.contentJson === "object" && !Array.isArray(userMessage.contentJson)
        ? (userMessage.contentJson as Record<string, unknown>)
        : {};
    const diagnosticsRaw = Array.isArray(payloadRaw.diagnostics) ? payloadRaw.diagnostics : [];
    const imageRaw = Array.isArray(payloadRaw.imageAttachments) ? payloadRaw.imageAttachments : [];
    const diagnosticsPayload: CavCodeDiagnostic[] = diagnosticsRaw
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => {
        const item = row as Record<string, unknown>;
        const severityRaw = s(item.severity);
        const severity: CavCodeDiagnostic["severity"] =
          severityRaw === "warn" || severityRaw === "info" ? severityRaw : "error";
        return {
          code: s(item.code) || undefined,
          source: s(item.source) || undefined,
          message: s(item.message),
          severity,
          line: Number.isFinite(Number(item.line)) && Number(item.line) > 0 ? Math.trunc(Number(item.line)) : undefined,
          col: Number.isFinite(Number(item.col)) && Number(item.col) > 0 ? Math.trunc(Number(item.col)) : undefined,
          file: s(item.file) || undefined,
        };
      })
      .filter((row) => Boolean(s(row.message)));
    const imagesPayload: CavAiImageAttachment[] = imageRaw
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => {
        const item = row as Record<string, unknown>;
        const assetId = s(item.assetId) || s(item.id);
        const dataUrl = s(item.dataUrl) || (assetId ? TRANSPARENT_IMAGE_DATA_URL : "");
        return {
          id: assetId || s(item.id) || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
          assetId: assetId || null,
          name: s(item.name) || "image",
          mimeType: s(item.mimeType) || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(item.sizeBytes) || 0)),
          dataUrl,
        };
      })
      .filter((row) => Boolean(s(row.dataUrl)) || Boolean(s(row.assetId)));

    const promptText = s(payloadRaw.prompt) || s(userMessage.contentText);
    if (!promptText) return null;
    const resolvedFilePath = normalizePathLike(s(payloadRaw.filePath) || activeFilePath);
    if (!resolvedFilePath) return null;
    const modelFromPayload = s(payloadRaw.model);
    const effectiveModel = modelFromPayload && !isAiAutoModelId(modelFromPayload)
      ? modelFromPayload
      : resolvePreferredCavCodeModel(modelOptions, selectedModel);
    const reasoningFromPayload = toReasoningLevel(payloadRaw.reasoningLevel) || reasoningLevel;
    const contextPayload =
      payloadRaw.context && typeof payloadRaw.context === "object" && !Array.isArray(payloadRaw.context)
        ? (payloadRaw.context as Record<string, unknown>)
        : {};
    const uploadedFilesPayload = toRetryUploadedFiles(contextPayload);
    const agentRef = normalizeAgentRef({
      agentId: payloadRaw.agentId,
      agentActionKey: payloadRaw.agentActionKey,
    });

    return {
      userMessageId: userMessage.id,
      action: toCavCodeAction(payloadRaw.action) || inferActionFromPrompt(promptText),
      agentId: agentRef?.agentId || null,
      agentActionKey: agentRef?.agentActionKey || null,
      prompt: promptText,
      filePath: resolvedFilePath,
      language: s(payloadRaw.language) || null,
      selectedCode: s(payloadRaw.selectedCode),
      diagnostics: diagnosticsPayload,
      context: contextPayload,
      model: effectiveModel,
      reasoningLevel: reasoningFromPayload,
      images: imagesPayload,
      uploadedFiles: uploadedFilesPayload,
      sessionId: s(sessionId),
    };
  }, [activeFilePath, messages, modelOptions, reasoningLevel, selectedModel, sessionId]);

  const applyRetryDraftToComposer = useCallback((retryDraft: CavAiCodeRetryDraft) => {
    if (
      cavenSettings.autoOpenResolvedFiles
      && onOpenFilePath
      && retryDraft.filePath
      && retryDraft.filePath !== activeFilePath
    ) {
      void onOpenFilePath(retryDraft.filePath);
    }
    setPrompt(retryDraft.prompt);
    setSelectedModel(retryDraft.model);
    setReasoningLevel(retryDraft.reasoningLevel);
    setImages(retryDraft.images);
    setUploadedFiles(retryDraft.uploadedFiles);
  }, [activeFilePath, cavenSettings.autoOpenResolvedFiles, onOpenFilePath]);

  const onRetryMessage = useCallback(
    async (item: CavAiMessage) => {
      const retryDraft = resolveRetryDraft(item.id);
      if (!retryDraft) {
        setError("No prior coding prompt found for retry.");
        return;
      }
      applyRetryDraftToComposer(retryDraft);
      void runMessageFeedbackAction(item.id, "retry");
      await runDraft(
        {
          prompt: retryDraft.prompt,
          images: retryDraft.images,
          model: retryDraft.model,
          reasoningLevel: retryDraft.reasoningLevel,
        },
        {
          action: retryDraft.action,
          agentId: retryDraft.agentId,
          agentActionKey: retryDraft.agentActionKey,
          filePath: retryDraft.filePath,
          language: retryDraft.language,
          selectedCode: retryDraft.selectedCode,
          diagnostics: retryDraft.diagnostics,
          context: {
            ...(retryDraft.context || {}),
            retryFromMessageId: item.id,
            retryFromSessionId: s(sessionId) || null,
          },
          sessionId: retryDraft.sessionId || s(sessionId) || undefined,
          clearComposer: true,
          showPending: true,
        }
      );
    },
    [applyRetryDraftToComposer, resolveRetryDraft, runDraft, runMessageFeedbackAction, sessionId]
  );

  const onEditMessage = useCallback(
    (item: CavAiMessage) => {
      const retryDraft = resolveRetryDraft(item.id);
      if (!retryDraft) {
        setError("No prior coding prompt found for edit.");
        return;
      }
      if (!s(retryDraft.userMessageId)) {
        setError("Unable to edit this prompt right now.");
        return;
      }
      setViewMode("chat");
      setInlineEditDraft(retryDraft);
      setInlineEditPrompt(retryDraft.prompt);
      setInlineEditBusy(false);
      setPrompt("");
      setImages([]);
      setUploadedFiles([]);
      setError("");
    },
    [resolveRetryDraft]
  );

  const onCancelInlineEdit = useCallback(() => {
    if (inlineEditBusy || submitting) return;
    setInlineEditDraft(null);
    setInlineEditPrompt("");
  }, [inlineEditBusy, submitting]);

  const onSubmitInlineEdit = useCallback(async () => {
    if (!inlineEditDraft) return;
    if (inlineEditBusy || submitting) return;
    const editedPrompt = s(inlineEditPrompt);
    if (!editedPrompt) {
      setError("Prompt is required.");
      return;
    }
    setInlineEditBusy(true);
    const ok = await runDraft(
      {
        prompt: editedPrompt,
        images: inlineEditDraft.images,
        model: inlineEditDraft.model,
        reasoningLevel: inlineEditDraft.reasoningLevel,
      },
      {
        action: inlineEditDraft.action,
        agentId: inlineEditDraft.agentId,
        agentActionKey: inlineEditDraft.agentActionKey,
        filePath: inlineEditDraft.filePath,
        language: inlineEditDraft.language,
        selectedCode: inlineEditDraft.selectedCode,
        diagnostics: inlineEditDraft.diagnostics,
        context: {
          ...(inlineEditDraft.context || {}),
          retryFromMessageId: inlineEditDraft.userMessageId,
          retryFromSessionId: s(sessionId) || null,
        },
        sessionId: inlineEditDraft.sessionId || s(sessionId) || undefined,
        clearComposer: true,
        showPending: true,
      }
    );
    if (ok) {
      setInlineEditDraft(null);
      setInlineEditPrompt("");
    }
    setInlineEditBusy(false);
  }, [inlineEditBusy, inlineEditDraft, inlineEditPrompt, runDraft, sessionId, submitting]);

  const onInlineEditPromptKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    void onSubmitInlineEdit();
  }, [onSubmitInlineEdit]);

  const enqueueDraft = useCallback(async (draft: {
    prompt: string;
    images: CavAiImageAttachment[];
    model: string;
    reasoningLevel: ReasoningLevel;
  }): Promise<boolean> => {
    const promptText = s(draft.prompt);
    if (!promptText) return false;
    if (draft.images.some((image) => image.uploading === true)) {
      setError("Images are still uploading. Please wait a moment.");
      return false;
    }
    if (uploadedFiles.some((file) => file.uploading === true)) {
      setError("Files are still uploading. Please wait a moment.");
      return false;
    }
    const draftModelId = s(draft.model);
    const effectiveModelId = draftModelId && !isAiAutoModelId(draftModelId)
      ? draftModelId
      : resolvePreferredCavCodeModel(modelOptions, selectedModel);

    const targetResolution = resolvePromptTargetFile({
      prompt: promptText,
      activeFilePath,
      projectFiles,
    });
    if (targetResolution.status === "ambiguous") {
      setError(`Multiple files match. Use a clearer path: ${targetResolution.matches.join(", ")}`);
      return false;
    }
    if (targetResolution.status === "missing") {
      setError("Caven could not resolve a target file in the active project folder.");
      return false;
    }
    const inferredAction = inferActionFromPrompt(promptText);
    const customAgentRef = resolvePromptCustomAgentRef({
      prompt: promptText,
      requestedAction: inferredAction,
      installedAgentIds,
      customAgents,
      publishedAgents,
    });

    let targetSessionId = s(sessionId);
    if (!targetSessionId) {
      try {
        targetSessionId = await ensureActiveSessionId();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize Caven session.");
        return false;
      }
    }

    const includeIdeContext = cavenSettings.includeIdeContext;
    try {
      const res = await fetch("/api/ai/cavcode/queue", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          mode: "enqueue",
          sessionId: targetSessionId || undefined,
          workspaceId: s(workspaceId) || undefined,
          projectId: projectId || undefined,
          action: inferredAction,
          agentId: customAgentRef?.agentId || undefined,
          agentActionKey: customAgentRef?.agentActionKey || undefined,
          filePath: targetResolution.filePath,
          language: language || undefined,
          selectedCode: includeIdeContext ? (resolveSelectedCode() || undefined) : undefined,
          diagnostics: includeIdeContext ? diagnostics : [],
          prompt: promptText,
          model: effectiveModelId || ALIBABA_QWEN_CODER_MODEL_ID,
          reasoningLevel: draft.reasoningLevel,
          queueEnabled,
          imageAttachments: draft.images
            .map((image) => {
              const assetId = s(image.assetId);
              const dataUrl = s(image.dataUrl);
              const includeDataUrl = !assetId && dataUrl.length > 0 && dataUrl.length <= MAX_IMAGE_DATA_URL_CHARS;
              return {
                id: image.id,
                assetId: assetId || undefined,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl: includeDataUrl ? dataUrl : undefined,
              };
            })
            .filter((image) => Boolean(s(image.assetId) || s(image.dataUrl))),
          context: {
            aiSurface: mode === "panel" ? "cavcode-left-panel" : "cavcode-full-workspace",
            activeFilePath: targetResolution.filePath,
            uploadedWorkspaceFiles: uploadedFiles
              .filter((file) => !file.uploading && (s(file.path) || s(file.cavcloudFileId)))
              .map((file) => ({
                cavcloudFileId: s(file.cavcloudFileId) || undefined,
                cavcloudPath: s(file.cavcloudPath) || undefined,
                path: file.path,
                name: file.name,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                snippet: s(file.snippet) || undefined,
              })),
            ...(includeIdeContext
              ? {
                  ...buildCavCodeRouteContextPayload({
                    workspaceId: s(workspaceId) || null,
                    projectId: projectId || null,
                    contextLabel: "CavCode context",
                  }),
                  ...context,
                  activeProjectRootPath: s(props.projectRootPath) || null,
                  activeProjectRootName: s(props.projectRootName) || null,
                  projectFiles: projectFiles.slice(0, 400).map((file) => ({
                    path: file.path,
                    relativePath: file.relativePath,
                    lang: file.lang,
                  })),
                }
              : {
                  contextScope: "minimal_ide",
                  activeProjectRootPath: null,
                  activeProjectRootName: null,
                  projectFiles: [],
                }),
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ sessionId?: string }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to queue prompt.");
      }

      const nextSessionId = s(body.ok ? body.sessionId : "") || targetSessionId;
      if (nextSessionId) {
        activeSessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        await loadQueuedPrompts(nextSessionId);
      }
      await loadSessions();
      setPrompt("");
      setImages([]);
      setUploadedFiles([]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue prompt.");
      return false;
    }
  }, [
    activeFilePath,
    cavenSettings.includeIdeContext,
    customAgents,
    context,
    diagnostics,
    installedAgentIds,
    language,
    loadQueuedPrompts,
    loadSessions,
    modelOptions,
    mode,
    projectFiles,
    projectId,
    props.projectRootName,
    props.projectRootPath,
    publishedAgents,
    queueEnabled,
    ensureActiveSessionId,
    resolveSelectedCode,
    selectedModel,
    sessionId,
    uploadedFiles,
    workspaceId,
  ]);

  const processQueuedPrompts = useCallback(async () => {
    const baseSessionId = s(sessionId);
    if (!baseSessionId) return;
    if (queueProcessingRef.current) return;
    if (requestAbortRef.current) return;
    if (submitting) return;
    queueProcessingRef.current = true;
    try {
      while (true) {
        if (requestAbortRef.current) break;
        const claimed = await claimNextQueuedPrompt(baseSessionId);
        if (!claimed) break;
        const payload = claimed.payload;
        const draft = {
          prompt: s(payload?.prompt) || claimed.prompt,
          images: Array.isArray(payload?.imageAttachments) ? payload?.imageAttachments : [],
          model: s(payload?.model) || ALIBABA_QWEN_CODER_MODEL_ID,
          reasoningLevel: payload?.reasoningLevel || "medium",
        };
        const queuedDiagnostics: CavCodeDiagnostic[] = Array.isArray(payload?.diagnostics)
          ? (payload?.diagnostics as unknown as CavCodeDiagnostic[])
          : diagnostics;
        const ok = await runDraft(draft, {
          queueMessageId: claimed.id,
          action: payload?.action || claimed.action,
          agentId: payload?.agentId || null,
          agentActionKey: payload?.agentActionKey || null,
          filePath: payload?.filePath || claimed.filePath,
          language: payload?.language || language || null,
          selectedCode: payload?.selectedCode || "",
          diagnostics: queuedDiagnostics,
          context: payload?.context || {},
          sessionId: claimed.sessionId || baseSessionId,
          clearComposer: false,
          showPending: false,
        });
        await loadQueuedPrompts(baseSessionId);
        if (!ok) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process queued prompts.");
    } finally {
      queueProcessingRef.current = false;
    }
  }, [
    claimNextQueuedPrompt,
    diagnostics,
    language,
    loadQueuedPrompts,
    runDraft,
    sessionId,
    submitting,
  ]);

  const onStop = useCallback(() => {
    const controller = requestAbortRef.current;
    if (!controller) return;
    requestAbortRef.current = null;
    controller.abort();
    setPendingPromptText("");
    setSubmitting(false);
    stopReasoningContext();
  }, [stopReasoningContext]);

  const onPrimaryAction = useCallback(() => {
    if (cavenInteractionLocked) {
      emitQwenUpgradeDecision();
      return;
    }
    if (!submitting && sessionBootstrapRef.current) return;
    const draft = {
      prompt,
      images: [...images],
      model: selectedModel,
      reasoningLevel,
    };
    if (submitting) {
      if (!queueEnabled || !s(prompt)) {
        onStop();
        return;
      }
      void enqueueDraft(draft);
      return;
    }
    void runDraft(draft).then((ok) => {
      if (!ok) return;
      void processQueuedPrompts();
    });
  }, [cavenInteractionLocked, emitQwenUpgradeDecision, enqueueDraft, images, onStop, processQueuedPrompts, prompt, queueEnabled, reasoningLevel, runDraft, selectedModel, submitting]);

  const onReviewQueuedPrompt = useCallback((item: CavAiQueuedPrompt) => {
    if (!onOpenFilePath) return;
    const targetPath = normalizePathLike(s(item.payload?.filePath) || s(item.filePath));
    if (!targetPath) return;
    const opened = onOpenFilePath(targetPath);
    if (opened === false) {
      setError(`Caven could not open ${targetPath} in the editor.`);
    }
  }, [onOpenFilePath]);

  const onSaveQueuedPromptEdit = useCallback(async () => {
    const messageId = s(editingQueueId);
    const nextPrompt = s(editingQueuePrompt);
    const currentSessionId = s(sessionId);
    if (!messageId || !nextPrompt || !currentSessionId) return;

    setEditingQueueBusy(true);
    try {
      const res = await fetch(`/api/ai/cavcode/queue/${encodeURIComponent(messageId)}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
          prompt: nextPrompt,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ queuedPrompt?: unknown }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to update queued message.");
      }
      await loadQueuedPrompts(currentSessionId);
      setEditingQueueId("");
      setEditingQueuePrompt("");
      setQueueMenuId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update queued message.");
    } finally {
      setEditingQueueBusy(false);
    }
  }, [editingQueueId, editingQueuePrompt, loadQueuedPrompts, sessionId]);

  const onRemoveQueuedPrompt = useCallback(async (item: CavAiQueuedPrompt) => {
    const currentSessionId = s(sessionId);
    const messageId = s(item.id);
    if (!currentSessionId || !messageId || item.status !== "QUEUED") return;

    setQueueActionBusyId(messageId);
    try {
      const res = await fetch(`/api/ai/cavcode/queue/${encodeURIComponent(messageId)}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          sessionId: currentSessionId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        messageId?: string;
      }>;
      if (!res.ok || !body.ok) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to remove queued message.");
      }
      await loadQueuedPrompts(currentSessionId);
      setQueueMenuId("");
      if (editingQueueId === messageId) {
        setEditingQueueId("");
        setEditingQueuePrompt("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove queued message.");
    } finally {
      setQueueActionBusyId((prev) => (prev === messageId ? "" : prev));
    }
  }, [editingQueueId, loadQueuedPrompts, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (!hasQueuedPrompts) return;
    if (submitting) return;
    void processQueuedPrompts();
  }, [hasQueuedPrompts, processQueuedPrompts, sessionId, submitting]);

  const transcribeAudioFile = useCallback(async (file: File, forcedModelId?: string): Promise<string | null> => {
    if (!asrAudioSkillEnabled) {
      throw new Error("Voice transcription is disabled in Caven settings.");
    }
    if (!isAudioLikeFile(file)) return null;
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      throw new Error(`Audio file must be between 1 byte and ${MAX_AUDIO_BYTES} bytes.`);
    }

    const form = new FormData();
    form.set("file", file);
    const overrideModel = s(forcedModelId);
    if (overrideModel) {
      form.set("model", overrideModel);
    } else if (selectedAudioModel !== "auto") {
      form.set("model", selectedAudioModel);
    }
    if (s(workspaceId)) form.set("workspaceId", s(workspaceId));
    if (projectId) form.set("projectId", String(projectId));
    form.set("origin", mode === "panel" ? "cavcode-left-panel" : "cavcode-full-workspace");

    setTranscribingAudio(true);
    try {
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "x-cavbot-csrf": "1",
        },
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        data?: {
          text?: string;
        };
      }>;
      if (!res.ok || !body.ok || !s(body.data?.text)) {
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Audio transcription failed.");
      }
      return s(body.data?.text);
    } finally {
      setTranscribingAudio(false);
    }
  }, [mode, projectId, selectedAudioModel, asrAudioSkillEnabled, workspaceId]);

  const clearVoiceCapture = useCallback(() => {
    const recorder = voiceRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      voiceRecorderRef.current = null;
    }
    const stream = voiceStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    }
    voiceChunksRef.current = [];
  }, []);

  const processCapturedVoice = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      setError("No audio was captured.");
      return;
    }
    setProcessingVoice(true);
    try {
      const extension = inferAudioFileExtension(blob.type);
      const file = new File(
        [blob],
        `voice-${Date.now().toString(36)}.${extension}`,
        { type: blob.type || "audio/webm" }
      );
      const transcript = await transcribeAudioFile(file, ALIBABA_QWEN_ASR_MODEL_ID);
      const spokenPrompt = s(transcript);
      if (!spokenPrompt) {
        setError("Voice input did not produce a transcript.");
        return;
      }
      if (cavenInteractionLocked) {
        emitQwenUpgradeDecision();
        return;
      }
      if (sessionBootstrapRef.current || submitting) return;
      const draft = {
        prompt: spokenPrompt,
        images: [...images],
        model: selectedModel,
        reasoningLevel,
      };
      const ok = await runDraft(draft);
      if (ok) {
        await processQueuedPrompts();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice input failed.");
    } finally {
      setProcessingVoice(false);
    }
  }, [
    cavenInteractionLocked,
    emitQwenUpgradeDecision,
    images,
    processQueuedPrompts,
    reasoningLevel,
    runDraft,
    selectedModel,
    submitting,
    transcribeAudioFile,
  ]);

  const stopVoiceCapture = useCallback(() => {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const startVoiceCapture = useCallback(async () => {
    if (recordingVoice || processingVoice || transcribingAudio || submitting) return;
    if (!asrAudioSkillEnabled) {
      setError("Voice transcription is disabled in Caven settings.");
      return;
    }
    if (cavenInteractionLocked) {
      emitQwenUpgradeDecision();
      return;
    }
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice input is not available in this browser.");
      return;
    }

    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data || event.data.size <= 0) return;
        voiceChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        clearVoiceCapture();
        setRecordingVoice(false);
        setProcessingVoice(false);
        setError("Voice capture failed.");
      };

      recorder.onstop = () => {
        const chunks = voiceChunksRef.current.slice();
        const fallbackType = recorder.mimeType || "audio/webm";
        clearVoiceCapture();
        setRecordingVoice(false);
        const blob = chunks.length ? new Blob(chunks, { type: fallbackType }) : null;
        if (!blob || !blob.size) {
          setError("No audio was captured.");
          return;
        }
        void processCapturedVoice(blob);
      };

      recorder.start(250);
      setRecordingVoice(true);
    } catch (err) {
      clearVoiceCapture();
      setRecordingVoice(false);
      setProcessingVoice(false);
      setError(err instanceof Error ? err.message : "Voice capture failed.");
    }
  }, [
    asrAudioSkillEnabled,
    cavenInteractionLocked,
    clearVoiceCapture,
    emitQwenUpgradeDecision,
    processCapturedVoice,
    processingVoice,
    recordingVoice,
    submitting,
    transcribingAudio,
  ]);

  const promptHasTypedInput = prompt.length > 0;
  const onComposerPrimaryAction = useCallback(() => {
    if (submitting || promptHasTypedInput) {
      onPrimaryAction();
      return;
    }
    if (recordingVoice) {
      stopVoiceCapture();
      return;
    }
    if (processingVoice || transcribingAudio) return;
    void startVoiceCapture();
  }, [
    onPrimaryAction,
    processingVoice,
    promptHasTypedInput,
    recordingVoice,
    startVoiceCapture,
    stopVoiceCapture,
    submitting,
    transcribingAudio,
  ]);

  useEffect(() => () => {
    clearVoiceCapture();
  }, [clearVoiceCapture]);

  const toComposerImageViewerState = useCallback((image: CavAiImageAttachment): ComposerImageViewerState | null => {
    const imageId = s(image.id);
    const dataUrl = s(image.dataUrl);
    if (!imageId || !dataUrl) return null;
    return {
      imageId,
      dataUrl,
      name: s(image.name) || "image",
      mimeType: s(image.mimeType) || "image/png",
      sizeBytes: Math.max(1, Math.trunc(Number(image.sizeBytes) || 1)),
    };
  }, []);

  const composerViewerImages = useMemo(
    () => images.filter((image) => Boolean(s(image.dataUrl))),
    [images]
  );

  const composerViewerActiveIndex = useMemo(() => {
    if (!composerImageViewer) return -1;
    return composerViewerImages.findIndex((image) => s(image.id) === composerImageViewer.imageId);
  }, [composerImageViewer, composerViewerImages]);

  const showComposerViewerNavigation = composerViewerImages.length > 1 && composerViewerActiveIndex >= 0;

  const activeComposerImageViewer = useMemo(() => {
    if (!composerImageViewer) return null;
    if (composerViewerActiveIndex >= 0 && composerViewerImages[composerViewerActiveIndex]) {
      return toComposerImageViewerState(composerViewerImages[composerViewerActiveIndex]) || composerImageViewer;
    }
    return composerImageViewer;
  }, [composerImageViewer, composerViewerActiveIndex, composerViewerImages, toComposerImageViewerState]);

  const closeComposerImageViewer = useCallback(() => {
    setComposerImageViewer(null);
    setViewerMagnifierVisible(false);
  }, []);

  const openComposerImageViewer = useCallback((image: CavAiImageAttachment) => {
    const next = toComposerImageViewerState(image);
    if (!next) return;
    setComposerImageViewer(next);
  }, [toComposerImageViewerState]);

  const openComposerImageViewerByIndex = useCallback((index: number) => {
    if (index < 0 || index >= composerViewerImages.length) return;
    const next = toComposerImageViewerState(composerViewerImages[index]);
    if (!next) return;
    setComposerImageViewer(next);
  }, [composerViewerImages, toComposerImageViewerState]);

  const openComposerImageViewerPrev = useCallback(() => {
    if (composerViewerActiveIndex <= 0) return;
    openComposerImageViewerByIndex(composerViewerActiveIndex - 1);
  }, [composerViewerActiveIndex, openComposerImageViewerByIndex]);

  const openComposerImageViewerNext = useCallback(() => {
    if (composerViewerActiveIndex < 0 || composerViewerActiveIndex >= composerViewerImages.length - 1) return;
    openComposerImageViewerByIndex(composerViewerActiveIndex + 1);
  }, [composerViewerActiveIndex, composerViewerImages.length, openComposerImageViewerByIndex]);

  useEffect(() => {
    if (!activeComposerImageViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposerImageViewer();
        return;
      }
      if (!showComposerViewerNavigation) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        openComposerImageViewerPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        openComposerImageViewerNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeComposerImageViewer,
    closeComposerImageViewer,
    openComposerImageViewerNext,
    openComposerImageViewerPrev,
    showComposerViewerNavigation,
  ]);

  useEffect(() => {
    setViewerMagnifierVisible(false);
    setViewerMagnifierSupportsHover(false);
    setViewerMagnifierFocusPoint({ x: 50, y: 50, px: 0, py: 0 });
  }, [activeComposerImageViewer?.imageId]);

  const onComposerViewerMediaLoaded = useCallback((img: HTMLImageElement) => {
    const width = Math.max(0, Number(img.naturalWidth) || 0);
    const height = Math.max(0, Number(img.naturalHeight) || 0);
    const mime = s(activeComposerImageViewer?.mimeType).toLowerCase();
    const supports = width > height && width >= 480 && height >= 220 && !mime.includes("svg");
    setViewerMagnifierSupportsHover(supports);
  }, [activeComposerImageViewer?.mimeType]);

  const onComposerViewerMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!viewerMagnifierSupportsHover) return;
    const node = viewerImageWrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const px = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const py = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const x = (px / rect.width) * 100;
    const y = (py / rect.height) * 100;
    setViewerMagnifierFocusPoint({ x, y, px, py });
    setViewerMagnifierVisible(true);
  }, [viewerMagnifierSupportsHover]);

  const onComposerViewerMouseLeave = useCallback(() => {
    setViewerMagnifierVisible(false);
  }, []);

  const loadCavCloudAttachItems = useCallback(async () => {
    setCavCloudAttachLoading(true);
    try {
      const res = await fetch("/api/cavcloud/gallery", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        files?: unknown[];
      };
      if (!res.ok || body.ok !== true) {
        throw new Error(s(body.message) || "Failed to load CavCloud files.");
      }
      const items = Array.isArray(body.files)
        ? body.files.map((row) => parseCavCloudAttachFileItem(row)).filter(Boolean) as CavCloudAttachFileItem[]
        : [];
      setCavCloudAttachItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CavCloud files.");
    } finally {
      setCavCloudAttachLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cavCloudAttachModalOpen) return;
    void loadCavCloudAttachItems();
  }, [cavCloudAttachModalOpen, loadCavCloudAttachItems]);

  const attachFromCavCloud = useCallback(async (file: CavCloudAttachFileItem) => {
    if (!file || cavenInteractionLocked) return;
    if (images.length + uploadedFiles.length >= maxImageAttachments) {
      setError(`Upload limit reached for this plan. Max ${maxImageAttachments} files per prompt.`);
      return;
    }

    setCavCloudAttachBusy(true);
    setError("");
    try {
      const mime = s(file.mimeType).toLowerCase();
      if (mime.startsWith("image/")) {
        const res = await fetch("/api/cavai/image-studio/import", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify({
            source: "cavcloud",
            fileId: file.id,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          assetId?: unknown;
          asset?: Record<string, unknown> | null;
          preview?: Record<string, unknown> | null;
        };
        if (!res.ok || body.ok !== true) {
          throw new Error(s(body.message) || "Image import failed.");
        }
        const assetId = s(body.assetId) || s(body.asset?.id);
        const dataUrl = s(body.preview?.dataUrl) || s(body.asset?.dataUrl);
        if (!assetId || !dataUrl) {
          throw new Error("Imported image payload is incomplete.");
        }
        const nextImage: CavAiImageAttachment = {
          id: assetId,
          assetId,
          name: s(body.preview?.fileName) || s(body.asset?.fileName) || s(file.name) || "image",
          mimeType: s(body.preview?.mimeType) || s(body.asset?.mimeType) || mime || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(body.asset?.bytes) || Number(file.bytes) || 1)),
          dataUrl,
          uploading: false,
        };
        setImages((prev) => {
          if (prev.some((row) => s(row.assetId) === assetId || s(row.id) === assetId)) return prev;
          return [...prev, nextImage].slice(0, maxImageAttachments);
        });
      } else {
        const cavcloudFileId = s(file.id);
        const nextFile: CavAiUploadedFileAttachment = {
          id: cavcloudFileId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
          cavcloudFileId: cavcloudFileId || null,
          cavcloudPath: s(file.path) || null,
          path: s(file.path),
          name: s(file.name) || "file",
          lang: "plaintext",
          mimeType: s(file.mimeType) || "application/octet-stream",
          sizeBytes: Math.max(1, Math.trunc(Number(file.bytes) || 1)),
          iconSrc: resolveUploadFileIcon(s(file.name), s(file.mimeType)),
          snippet: s(file.previewSnippet) || null,
          uploading: false,
        };
        setUploadedFiles((prev) => {
          if (prev.some((row) => s(row.cavcloudFileId) === cavcloudFileId && cavcloudFileId)) return prev;
          return [...prev, nextFile].slice(0, maxImageAttachments);
        });
      }
      setCavCloudAttachModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach CavCloud file.");
    } finally {
      setCavCloudAttachBusy(false);
    }
  }, [cavenInteractionLocked, images.length, maxImageAttachments, uploadedFiles.length]);

  const applyQuickAction = useCallback((actionId: ComposerQuickActionId) => {
    if (cavenInteractionLocked) return;
    if (actionId === "add_files") {
      setOpenComposerMenu(null);
      imageInputRef.current?.click();
      return;
    }
    if (actionId === "upload_from_cavcloud") {
      setOpenComposerMenu(null);
      setCavCloudAttachModalOpen(true);
      void loadCavCloudAttachItems();
    }
  }, [cavenInteractionLocked, loadCavCloudAttachItems]);

  const onAttachFiles = useCallback(async (files: FileList | null) => {
    if (cavenInteractionLocked) return;
    if (!files || !files.length) return;
    const current = [...images];
    const currentFiles = [...uploadedFiles];
    const incoming = Array.from(files);
    const imageUploadQueue: Array<{ file: File; mime: string; optimisticId: string }> = [];
    const workspaceUploadQueue: Array<{ file: File; optimisticId: string }> = [];
    const audioTranscriptionQueue: File[] = [];
    const transcriptBlocks: string[] = [];
    let audioError = "";
    let imageError = "";
    let fileError = "";
    let uploadLimitHit = false;
    let imageSizeRejected = false;
    let acceptedCount = current.length + currentFiles.length;
    for (const file of incoming) {
      const mime = s(file.type).toLowerCase();
      if (acceptedCount >= maxImageAttachments) {
        uploadLimitHit = true;
        continue;
      }
      if (isImageLikeFile(file)) {
        if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
          imageSizeRejected = true;
          continue;
        }
        const optimisticId = `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
        current.push({
          id: optimisticId,
          assetId: null,
          name: s(file.name) || "image",
          mimeType: mime || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
          dataUrl: TRANSPARENT_IMAGE_DATA_URL,
          uploading: true,
        });
        imageUploadQueue.push({ file, mime, optimisticId });
        acceptedCount += 1;
        continue;
      }

      if (!onUploadWorkspaceFiles) {
        fileError = "File upload is unavailable in this workspace.";
        continue;
      }
      if (file.size <= 0) {
        fileError = "One or more files were empty and skipped.";
        continue;
      }
      if (isAudioLikeFile(file) && asrAudioSkillEnabled) {
        audioTranscriptionQueue.push(file);
      }

      const optimisticId = `file_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
      const optimisticFile: CavAiUploadedFileAttachment = {
        id: optimisticId,
        cavcloudFileId: null,
        cavcloudPath: null,
        path: "",
        name: s(file.name) || "file",
        lang: "plaintext",
        mimeType: mime || "text/plain",
        sizeBytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
        iconSrc: resolveUploadFileIcon(s(file.name), mime),
        snippet: null,
        uploading: true,
      };
      currentFiles.push(optimisticFile);
      workspaceUploadQueue.push({ file, optimisticId });
      acceptedCount += 1;
    }

    setImages([...current]);
    setUploadedFiles([...currentFiles]);

    const commitOptimisticImage = (optimisticId: string, next: CavAiImageAttachment | null) => {
      const idx = current.findIndex((row) => row.id === optimisticId);
      if (idx < 0) return;
      if (!next) {
        current.splice(idx, 1);
      } else {
        current[idx] = next;
      }
      setImages([...current]);
    };

    for (const queuedImage of imageUploadQueue) {
      const { file, mime, optimisticId } = queuedImage;
      try {
        const dataUrl = await toDataUrl(file);
        if (!dataUrl) {
          imageError = "One or more images could not be read.";
          commitOptimisticImage(optimisticId, null);
          continue;
        }
        const pendingPreviewImage = current.find((row) => row.id === optimisticId);
        if (pendingPreviewImage) {
          commitOptimisticImage(optimisticId, {
            ...pendingPreviewImage,
            dataUrl,
          });
        }
        const uploadRes = await fetch("/api/cavai/image-studio/upload/device", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify({
            fileName: s(file.name) || `image-${Date.now()}.png`,
            mimeType: mime || "image/png",
            bytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
            dataUrl,
          }),
        });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          assetId?: unknown;
          asset?: Record<string, unknown> | null;
          preview?: Record<string, unknown> | null;
        };
        if (!uploadRes.ok || uploadBody.ok !== true) {
          imageError = s(uploadBody.message) || "Image upload failed.";
          commitOptimisticImage(optimisticId, null);
          continue;
        }
        const assetId = s(uploadBody.assetId) || s(uploadBody.asset?.id);
        const previewDataUrl = s(uploadBody.preview?.dataUrl) || s(uploadBody.asset?.dataUrl) || dataUrl;
        commitOptimisticImage(optimisticId, {
          id: assetId || optimisticId,
          assetId: assetId || null,
          name: s(uploadBody.preview?.fileName) || s(uploadBody.asset?.fileName) || s(file.name) || "image",
          mimeType: s(uploadBody.preview?.mimeType) || s(uploadBody.asset?.mimeType) || mime || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(uploadBody.asset?.bytes) || Number(file.size) || 1)),
          dataUrl: previewDataUrl,
          uploading: false,
        });
      } catch {
        imageError = "Image upload failed.";
        commitOptimisticImage(optimisticId, null);
      }
    }

    if (workspaceUploadQueue.length && onUploadWorkspaceFiles) {
      try {
        const uploadedRows = await Promise.resolve(
          onUploadWorkspaceFiles(workspaceUploadQueue.map((item) => item.file))
        );
        for (let index = 0; index < workspaceUploadQueue.length; index += 1) {
          const queued = workspaceUploadQueue[index];
          const uploadedRow = Array.isArray(uploadedRows) ? uploadedRows[index] : null;
          const uploadedPathRaw = s(uploadedRow?.path);
          const resolvedPath = uploadedPathRaw ? normalizePathLike(uploadedPathRaw) : "";
          const pendingIndex = currentFiles.findIndex((row) => row.id === queued.optimisticId);
          if (pendingIndex < 0) continue;
          if (!resolvedPath) {
            currentFiles.splice(pendingIndex, 1);
            if (!fileError) fileError = "One or more files could not be mapped into CavCode.";
            continue;
          }
          const sourceFile = queued.file;
          const sourceMime = s(sourceFile.type).toLowerCase();
          currentFiles[pendingIndex] = {
            id: s(uploadedRow?.id) || queued.optimisticId,
            cavcloudFileId: s(uploadedRow?.cavcloudFileId) || s(uploadedRow?.id) || null,
            cavcloudPath: s(uploadedRow?.cavcloudPath) || null,
            path: resolvedPath,
            name: s(uploadedRow?.name) || s(sourceFile.name) || "file",
            lang: s(uploadedRow?.lang) || "plaintext",
            mimeType: s(uploadedRow?.mimeType) || sourceMime || "text/plain",
            sizeBytes: Math.max(1, Math.trunc(Number(uploadedRow?.sizeBytes) || Number(sourceFile.size) || 1)),
            iconSrc: resolveUploadFileIcon(
              s(uploadedRow?.name) || s(sourceFile.name),
              s(uploadedRow?.mimeType) || sourceMime
            ),
            snippet: s(uploadedRow?.snippet) || null,
            uploading: false,
          };
        }
      } catch (err) {
        fileError = err instanceof Error ? s(err.message) || "File upload failed." : "File upload failed.";
        for (const queued of workspaceUploadQueue) {
          const pendingIndex = currentFiles.findIndex((row) => row.id === queued.optimisticId);
          if (pendingIndex >= 0) {
            currentFiles.splice(pendingIndex, 1);
          }
        }
      }
    }

    if (audioTranscriptionQueue.length && asrAudioSkillEnabled) {
      for (const file of audioTranscriptionQueue) {
        try {
          const transcript = await transcribeAudioFile(file);
          if (transcript) {
            transcriptBlocks.push(`[Audio Transcript: ${s(file.name) || "audio"}]\n${transcript}`);
          }
        } catch (err) {
          audioError = err instanceof Error ? err.message : "Audio transcription failed.";
        }
      }
    }

    setImages([...current]);
    setUploadedFiles([...currentFiles]);
    if (transcriptBlocks.length) {
      setPrompt((prev) => {
        const existing = s(prev);
        const joined = transcriptBlocks.join("\n\n");
        return existing ? `${existing}\n\n${joined}` : joined;
      });
    }
    if (audioError) {
      setError(audioError);
      return;
    }
    if (imageError) {
      setError(imageError);
      return;
    }
    if (fileError) {
      setError(fileError);
      return;
    }
    if (uploadLimitHit) {
      setError(`Upload limit reached for this plan. Max ${maxImageAttachments} files per prompt.`);
      return;
    }
    if (imageSizeRejected) {
      setError(`One or more images exceed ${Math.floor(MAX_IMAGE_BYTES / 1_000_000)}MB and were skipped.`);
      return;
    }
    setError("");
  }, [
    asrAudioSkillEnabled,
    cavenInteractionLocked,
    images,
    maxImageAttachments,
    onUploadWorkspaceFiles,
    transcribeAudioFile,
    uploadedFiles,
  ]);

  const openUploadedFileAttachment = useCallback((item: CavAiUploadedFileAttachment) => {
    if (item.uploading) return;
    const rawPath = s(item.path) || s(item.cavcloudPath);
    if (!rawPath) return;
    const targetPath = normalizePathLike(rawPath);
    if (onOpenFilePath) {
      const opened = onOpenFilePath(targetPath);
      if (opened !== false) return;
    }
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams();
      qp.set("cavai", "1");
      qp.set("cloud", "1");
      qp.set("file", s(item.cavcloudPath) || targetPath);
      window.open(`/cavcode?${qp.toString()}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (onOpenFilePath) {
      setError(`Caven could not open ${targetPath} in the editor.`);
    }
  }, [onOpenFilePath]);

  const onApplyFromMessage = useCallback(async (message: CavAiMessage) => {
    const parsed = parseAssistantData(message);
    if (!parsed || !s(parsed.proposedCode) || !onApplyProposedCode) return;
    const targetPath = s(parsed.targetFilePath) || activeFilePath;
    if (!targetPath) return;
    if (cavenSettings.confirmBeforeApplyPatch && typeof window !== "undefined") {
      const approved = window.confirm(`Apply this patch to ${targetPath}?`);
      if (!approved) return;
    }
    setApplyBusyId(message.id);
    try {
      await onApplyProposedCode({
        filePath: targetPath,
        code: parsed.proposedCode,
      });
    } finally {
      setApplyBusyId("");
    }
  }, [activeFilePath, cavenSettings.confirmBeforeApplyPatch, onApplyProposedCode]);

  const onSelectHistorySession = useCallback((item: CavAiSessionSummary) => {
    const normalized = s(item.id);
    if (!normalized) return;
    activeSessionIdRef.current = normalized;
    const cachedMessages = sessionMessageCacheRef.current.get(normalized);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
    if (s(sessionId) === normalized) {
      void loadMessages(normalized);
      void loadQueuedPrompts(normalized);
    }
    setSessionId(normalized);
    setViewMode("chat");
    setHistoryModalOpen(false);
    if (cavenSettings.autoOpenResolvedFiles && onOpenFilePath && s(item.activeFilePath)) {
      void onOpenFilePath(s(item.activeFilePath));
    }
  }, [cavenSettings.autoOpenResolvedFiles, loadMessages, loadQueuedPrompts, onOpenFilePath, sessionId]);

  const toggleSettingsSection = useCallback((section: CavenSettingsDropdownSection) => {
    setSettingsDropdownSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  }, []);

  const openSettingsModal = useCallback((tab: CavenSettingsModalTab) => {
    if (tab === "skills" && onOpenSkillsTab) {
      onOpenSkillsTab();
      setSettingsModalOpen(false);
      setSettingsMenuOpen(false);
      return;
    }
    if (tab === "general" && onOpenGeneralSettingsTab) {
      onOpenGeneralSettingsTab();
      setSettingsModalOpen(false);
      setSettingsMenuOpen(false);
      return;
    }
    if (tab === "ide" && onOpenIdeSettingsTab) {
      onOpenIdeSettingsTab();
      setSettingsModalOpen(false);
      setSettingsMenuOpen(false);
      return;
    }
    setSettingsModalTab(tab);
    setSettingsModalOpen(true);
    setSettingsMenuOpen(false);
  }, [onOpenGeneralSettingsTab, onOpenIdeSettingsTab, onOpenSkillsTab]);

  const openConfigToml = useCallback(() => {
    if (onOpenConfigToml) {
      onOpenConfigToml();
      setSettingsModalOpen(false);
      setSettingsMenuOpen(false);
      return;
    }
    setError("config.toml is available from CavCode Caven settings.");
    setSettingsMenuOpen(false);
  }, [onOpenConfigToml]);

  const onComposerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (submitting && !queueEnabled) return;
    if (cavenSettings.composerEnterBehavior === "meta_enter" && !(event.metaKey || event.ctrlKey)) return;
    if (cavenSettings.composerEnterBehavior === "enter" && (event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    onPrimaryAction();
  }, [cavenSettings.composerEnterBehavior, onPrimaryAction, queueEnabled, submitting]);

  return (
    <section
      className={[
        styles.shell,
        styles.codePanelShell,
        pageMode ? styles.pageShell : "",
        !pageMode ? styles.codePanelMode : "",
        styles.codeAgentShell,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <div className={styles.title}>
            <span>CAVEN</span>
          </div>
        </div>
      </header>

      <div className={styles.agentTopBar}>
        <div className={styles.agentTopRow} aria-busy={loadingSessions}>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={[styles.headBtn, styles.iconHeadBtn, styles.headBtnBare].join(" ")}
              onClick={() => {
                setHistoryQuery("");
                setHistoryModalOpen((prev) => !prev);
              }}
              aria-label="Open history"
              title="History"
            >
              <span className={styles.historyGlyph} aria-hidden="true" />
            </button>

            <div className={styles.settingsMenuWrap} ref={settingsMenuRef}>
              <button
                type="button"
                className={[styles.headBtn, styles.iconHeadBtn, styles.headBtnBare].join(" ")}
                onClick={() => setSettingsMenuOpen((prev) => !prev)}
                aria-label="Open Caven settings menu"
                title="Caven settings"
                aria-haspopup="menu"
                aria-expanded={settingsMenuOpen}
              >
                <span className={styles.settingsGlyph} aria-hidden="true" />
              </button>

              {settingsMenuOpen ? (
                <div className={styles.settingsMenuPanel} role="menu" aria-label="Caven settings menu">
                  <button
                    type="button"
                    className={styles.settingsMenuSectionBtn}
                    onClick={() => toggleSettingsSection("caven")}
                  >
                    <span>Caven settings</span>
                    <span
                      className={[
                        styles.settingsChevron,
                        settingsDropdownSections.caven ? styles.settingsChevronOpen : "",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                  </button>
                  {settingsDropdownSections.caven ? (
                    <div className={styles.settingsMenuSectionBody}>
                      <button
                        type="button"
                        className={styles.settingsMenuAction}
                        onClick={() => openSettingsModal("skills")}
                      >
                        Agents
                      </button>
                      <button
                        type="button"
                        className={styles.settingsMenuAction}
                        onClick={() => openSettingsModal("general")}
                      >
                        General
                      </button>
                      <button
                        type="button"
                        className={styles.settingsMenuAction}
                        onClick={openConfigToml}
                      >
                        Open config.toml
                      </button>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className={styles.settingsMenuSectionBtn}
                    onClick={() => toggleSettingsSection("ide")}
                  >
                    <span>IDE settings</span>
                    <span
                      className={[
                        styles.settingsChevron,
                        settingsDropdownSections.ide ? styles.settingsChevronOpen : "",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                  </button>
                  {settingsDropdownSections.ide ? (
                    <div className={styles.settingsMenuSectionBody}>
                      <button
                        type="button"
                        className={styles.settingsMenuAction}
                        onClick={() => openSettingsModal("ide")}
                      >
                        Open IDE settings
                      </button>
                      <label className={styles.settingsMenuSwitchRow}>
                        <span>Queue follow-ups</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.queueFollowUps}
                          onChange={(event) => void patchCavenSettings(
                            { queueFollowUps: event.currentTarget.checked },
                            "queueFollowUps"
                          )}
                          disabled={Boolean(savingCavenSettingsKey)}
                        />
                      </label>
                      <label className={styles.settingsMenuSwitchRow}>
                        <span>Include IDE context</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.includeIdeContext}
                          onChange={(event) => void patchCavenSettings(
                            { includeIdeContext: event.currentTarget.checked },
                            "includeIdeContext"
                          )}
                          disabled={Boolean(savingCavenSettingsKey)}
                        />
                      </label>
                      <label className={styles.settingsMenuSwitchRow}>
                        <span>Enter sends prompt</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.composerEnterBehavior === "enter"}
                          onChange={(event) => void patchCavenSettings(
                            { composerEnterBehavior: event.currentTarget.checked ? "enter" : "meta_enter" },
                            "composerEnterBehavior"
                          )}
                          disabled={Boolean(savingCavenSettingsKey)}
                        />
                      </label>
                    </div>
                  ) : null}

                  {savingCavenSettingsKey ? (
                    <div className={styles.settingsMenuMeta}>
                      Saving...
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className={[styles.headBtn, styles.iconHeadBtn, styles.headBtnBare].join(" ")}
              onClick={() => {
                if (requestAbortRef.current) {
                  requestAbortRef.current.abort();
                  requestAbortRef.current = null;
                }
                activeSessionIdRef.current = "";
                setSessionId("");
                setMessages([]);
                setPendingPromptText("");
                setSubmitting(false);
                setViewMode("history");
                setError("");
                setQueueEnabled(cavenSettings.queueFollowUps);
                setReasoningLevel(cavenSettings.defaultReasoningLevel);
                setSettingsMenuOpen(false);
                stopReasoningContext();
              }}
              aria-label="New chat"
              title="New chat"
            >
              <span className={styles.newChatGlyph} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className={styles.agentBody}>
        <section ref={agentScrollRef} className={styles.agentScrollable} onScroll={onChatScroll}>
          {cavenInteractionLocked ? (
            <div className={styles.cavenLockedDockCard} role="status" aria-live="polite">
              <div className={styles.cavenLockedDockTitle}>Available on premium plans.</div>
              <a
                className={styles.cavenLockedDockCta}
                href="/settings/upgrade?plan=premium&billing=monthly"
                onClick={() => {
                  trackCavenEvent("qwen_coder_upgrade_cta_click", {
                    surface: "cavcode",
                    source: "top_locked_card",
                    planLabel: qwenPopoverState?.planLabel || "unknown",
                    state: qwenPopoverState?.entitlement?.state || "locked_free",
                  });
                }}
              >
                UPGRADE
              </a>
            </div>
          ) : null}
          {viewMode === "history" ? (
            <div className={styles.sessionsList}>
              {!filteredSessions.length ? (
                <div className={styles.historyEmpty} />
              ) : null}

              {filteredSessions.map((item) => {
                const isOn = s(sessionId) === item.id;
                const isRunning = submitting && isOn;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={[styles.sessionItem, isOn ? styles.sessionItemOn : "", styles.historyCard].filter(Boolean).join(" ")}
                    onClick={() => onSelectHistorySession(item)}
                  >
                    <div className={styles.sessionTitle}>{item.title || item.contextLabel || "Untitled conversation"}</div>
                    <div className={styles.historyMetaLine}>
                      <span>{toTimelineLabel(item.lastMessageAt || item.updatedAt)}</span>
                      {isRunning ? (
                        <span className={styles.sessionRunningPill}>
                          <span className={styles.sessionRunningGlyph} aria-hidden="true" />
                          Reasoning
                        </span>
                      ) : null}
                      {item.model ? <span>{item.model}</span> : null}
                      {item.reasoningLevel ? <span>{item.reasoningLevel}</span> : null}
                    </div>
                    {item.preview ? <div className={styles.sessionPreview}>{item.preview}</div> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={[styles.chatStream, showCodePanelEmptyLogo ? styles.chatStreamEmpty : ""].filter(Boolean).join(" ")}>
              {showCodePanelEmptyLogo ? (
                <div className={styles.emptyLarge}>
                  <span className={styles.codePanelEmptyLogo} role="img" aria-label={heroLine}>
                    <span className={styles.codePanelEmptyLogoGlyph} aria-hidden="true" />
                  </span>
                </div>
              ) : null}

              {loadingQueue ? <div className={styles.metaText}>Loading queue...</div> : null}

              {hasQueuedPrompts ? (
                <div className={styles.queueStack}>
                  {queuedPrompts.map((item) => {
                    const isEditing = editingQueueId === item.id;
                    const isMenuOpen = queueMenuId === item.id;
                    const queueStatusLabel = item.status === "PROCESSING" ? "Processing" : "Queued";
                    const reviewPath = normalizePathLike(s(item.payload?.filePath) || item.filePath);
                    return (
                      <article key={item.id} className={styles.queueCard}>
                        <div className={styles.queueCardTop}>
                          <div className={styles.queueCardMeta}>
                            <span className={styles.queueStatus}>{queueStatusLabel}</span>
                            <span className={styles.queueTime}>{toTimelineLabel(item.createdAt)}</span>
                          </div>
                          {onOpenFilePath && reviewPath ? (
                            <button
                              type="button"
                              className={styles.queueReviewBtn}
                              onClick={() => onReviewQueuedPrompt(item)}
                              aria-label={`Steer queued prompt for ${reviewPath}`}
                            >
                              Steer
                            </button>
                          ) : null}
                        </div>

                        {!isEditing ? (
                          <div className={styles.queuePromptRow}>
                            <div className={styles.queuePromptText}>{item.prompt}</div>
                            <span className={styles.queueSteerGlyph} aria-hidden="true" />
                            <div className={styles.queueMenuWrap}>
                              <button
                                type="button"
                                className={styles.queueMenuBtn}
                                aria-label="Queue actions"
                                onClick={() => setQueueMenuId((prev) => (prev === item.id ? "" : item.id))}
                              >
                                ⋯
                              </button>
                              {isMenuOpen ? (
                                <div className={styles.queueMenu}>
                                  <button
                                    type="button"
                                    className={styles.queueMenuItem}
                                    onClick={() => {
                                      setEditingQueueId(item.id);
                                      setEditingQueuePrompt(item.prompt);
                                      setQueueMenuId("");
                                    }}
                                    disabled={item.status !== "QUEUED" || queueActionBusyId === item.id}
                                  >
                                    Edit message
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.queueMenuItem}
                                    onClick={() => void onRemoveQueuedPrompt(item)}
                                    disabled={item.status !== "QUEUED" || queueActionBusyId === item.id}
                                  >
                                    {queueActionBusyId === item.id ? "Removing..." : "Remove from queue"}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.queueMenuItem}
                                    onClick={() => {
                                      setQueueEnabled(false);
                                      setQueueMenuId("");
                                    }}
                                    disabled={queueActionBusyId === item.id}
                                  >
                                    Turn off queueing
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className={styles.queueEditWrap}>
                            <textarea
                              className={styles.queueEditInput}
                              value={editingQueuePrompt}
                              onChange={(event) => setEditingQueuePrompt(event.currentTarget.value)}
                            />
                            <div className={styles.queueEditActions}>
                              <button
                                type="button"
                                className={styles.queueEditBtn}
                                onClick={() => {
                                  setEditingQueueId("");
                                  setEditingQueuePrompt("");
                                }}
                                disabled={editingQueueBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className={[styles.queueEditBtn, styles.queueEditBtnOn].join(" ")}
                                onClick={() => void onSaveQueuedPromptEdit()}
                                disabled={editingQueueBusy || !s(editingQueuePrompt)}
                              >
                                {editingQueueBusy ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {visibleMessages.map((message, messageIndex) => {
                const isAssistant = message.role === "assistant";
                const segments = toCodeMessageSegments(message.contentText);
                const parsed = parseAssistantData(message);
                const canApply = Boolean(parsed && s(parsed.proposedCode) && onApplyProposedCode);
                const targetPath = s(parsed?.targetFilePath) || activeFilePath;
                const executionMeta = isAssistant ? resolveExecutionMetaFromMessage(message) : null;
                const reasoningLabel = resolveReasoningLabel({
                  message,
                  allMessages: visibleMessages,
                  index: messageIndex,
                });
                const canOpenReasoning = Boolean(
                  isAssistant && executionMeta && executionMeta.showReasoningChip && executionMeta.safeSummary
                );
                const feedback = toSafeFeedbackState(message.feedback);
                const pendingAction = s(messageActionPending[message.id]).toLowerCase();
                const reactionBusy = pendingAction === "like" || pendingAction === "dislike" || pendingAction === "clear_reaction";
                const copyBusy = pendingAction === "copy";
                const copyConfirmed = copiedMessageToken === `copy:${message.id}` || copiedMessageToken === `share:${message.id}`;
                const shareBusy = pendingAction === "share";
                const retryBusy = pendingAction === "retry";
                const editBusy = pendingAction === "edit";
                const mediaPayload = !isAssistant ? toMessageMediaPayload(message) : null;
                const userImages = mediaPayload?.images || [];
                const userUploadedFiles = mediaPayload?.uploadedFiles || [];
                const hasUserMedia = !isAssistant && (userImages.length > 0 || userUploadedFiles.length > 0);
                const isUserMessage = !isAssistant;
                const showMessageActions = isAssistant || isUserMessage;
                return (
                  <article
                    key={message.id}
                    className={[
                      styles.message,
                      isAssistant ? styles.messageAssistant : styles.messageUser,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className={styles.messageHead}>
                      {isAssistant ? (
                        <>
                          <span className={styles.centerResponseLogo} aria-hidden="true" />
                          <div className={styles.centerReasoningMetaRow}>
                            <span className={styles.messageRole}>{CAVEN_AGENT_NAME}</span>
                            {reasoningLabel ? (
                              canOpenReasoning ? (
                                <button
                                  type="button"
                                  className={[styles.centerMessageRole, styles.centerReasoningBtn].join(" ")}
                                  onClick={() => setReasoningPanelMessageId(message.id)}
                                  aria-label="Open reasoning summary"
                                  title="Open reasoning summary"
                                >
                                  {reasoningLabel}
                                </button>
                              ) : (
                                <span className={styles.centerMessageRole}>{reasoningLabel}</span>
                              )
                            ) : null}
                          </div>
                        </>
                      ) : null}
                      <span className={styles.messageTime} style={isAssistant ? undefined : { marginInlineStart: "auto" }}>
                        {toTimelineLabel(message.createdAt)} • {toIsoTime(message.createdAt)}
                      </span>
                    </div>

                    <div className={styles.messageBody}>
                      {!isAssistant && hasUserMedia ? (
                        <div className={styles.attachmentsRow}>
                          {userImages.map((image) => {
                            const canPreviewImage = Boolean(s(image.dataUrl)) && s(image.dataUrl) !== TRANSPARENT_IMAGE_DATA_URL;
                            return (
                              <div key={`message-image-${message.id}-${image.id}`} className={styles.attachmentChip}>
                                {canPreviewImage ? (
                                  <span className={styles.attachmentPreviewWrap}>
                                    <button
                                      type="button"
                                      className={styles.attachmentPreviewBtn}
                                      onClick={() => openComposerImageViewer(image)}
                                      aria-label={`Open ${image.name}`}
                                      title={image.name}
                                    >
                                      <Image src={image.dataUrl} alt="" width={24} height={24} unoptimized className={styles.attachmentPreview} />
                                    </button>
                                  </span>
                                ) : (
                                  <span className={styles.attachmentFileIconWrap} aria-hidden="true">
                                    <Image
                                      src={resolveUploadFileIcon(image.name, image.mimeType)}
                                      alt=""
                                      width={18}
                                      height={18}
                                      className={styles.attachmentFileIcon}
                                      unoptimized
                                    />
                                  </span>
                                )}
                                <span className={styles.attachmentName}>{image.name}</span>
                              </div>
                            );
                          })}
                          {userUploadedFiles.map((file) => (
                            <div
                              key={`message-file-${message.id}-${file.id}`}
                              className={[styles.attachmentChip, styles.attachmentFileChip].join(" ")}
                            >
                              <span className={styles.attachmentFileIconWrap} aria-hidden="true">
                                <Image src={file.iconSrc} alt="" width={18} height={18} className={styles.attachmentFileIcon} unoptimized />
                              </span>
                              <button
                                type="button"
                                className={styles.attachmentFileOpenBtn}
                                onClick={() => openUploadedFileAttachment(file)}
                                disabled={!s(file.path) && !s(file.cavcloudPath)}
                                aria-label={`Open ${file.name}`}
                                title={file.path || file.cavcloudPath || file.name}
                              >
                                <span className={styles.attachmentName}>{file.name}</span>
                                <span className={styles.attachmentFileMeta}>
                                  {formatMimeSubtype(file.mimeType)} · {formatFileSize(file.sizeBytes)}
                                </span>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {segments.map((segment, index) => {
                        const token = `${message.id}:${index}`;
                        if (segment.kind === "code") {
                          return (
                            <section key={token} className={styles.codeMessageBlock}>
                              <div className={styles.codeMessageHead}>{segment.language || "code"}</div>
                              <pre className={styles.codeMessageText}>{segment.text}</pre>
                            </section>
                          );
                        }
                        return (
                          <div key={token} className={styles.messageText}>
                            {segment.text}
                          </div>
                        );
                      })}
                    </div>

                    {parsed && s(parsed.proposedCode) ? (
                      <div className={styles.messagePatch}>
                        <div className={styles.resultTitle}>Proposed Code</div>
                        {targetPath ? <div className={styles.patchTarget}>{targetPath}</div> : null}
                        <pre className={[styles.resultText, styles.code].join(" ")}>{parsed.proposedCode}</pre>
                        <div className={styles.patchActions}>
                          {onOpenFilePath && targetPath ? (
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => void onOpenFilePath?.(targetPath)}
                            >
                              Open File
                            </button>
                          ) : null}
                          {canApply ? (
                            <button
                              type="button"
                              className={[styles.actionBtn, styles.actionBtnOn].join(" ")}
                              onClick={() => void onApplyFromMessage(message)}
                              disabled={applyBusyId === message.id}
                            >
                              {applyBusyId === message.id ? "Applying..." : "Apply Patch"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {showMessageActions ? (
                      <div
                        className={[
                          styles.centerMessageActions,
                          isUserMessage ? styles.centerUserMessageActions : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {(isAssistant || isUserMessage) ? (
                          <button
                            type="button"
                            className={[
                              styles.centerMessageActionBtn,
                              copyConfirmed ? styles.centerMessageActionBtnOn : "",
                              copyBusy ? styles.centerMessageActionBtnBusy : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => void copyTextWithFeedback(message, message.contentText, `copy:${message.id}`)}
                            disabled={copyBusy || editBusy || cavenInteractionLocked}
                            aria-label="Copy message"
                            title="Copy"
                          >
                            <span
                              className={[
                                styles.centerMessageActionGlyph,
                                copyConfirmed
                                  ? styles.centerMessageActionGlyphCheck
                                  : styles.centerMessageActionGlyphCopy,
                              ].join(" ")}
                              aria-hidden="true"
                            />
                          </button>
                        ) : null}

                        {isUserMessage ? (
                          <button
                            type="button"
                            className={[
                              styles.centerMessageActionBtn,
                              editBusy ? styles.centerMessageActionBtnBusy : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => void onEditMessage(message)}
                            disabled={editBusy || submitting || cavenInteractionLocked}
                            aria-label="Edit and resend this prompt"
                            title="Edit"
                          >
                            <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphEdit].join(" ")} aria-hidden="true" />
                          </button>
                        ) : null}

                        {isAssistant ? (
                          <>
                            <button
                              type="button"
                              className={[
                                styles.centerMessageActionBtn,
                                feedback.reaction === "like" ? styles.centerMessageActionBtnReactionOn : "",
                                reactionBusy ? styles.centerMessageActionBtnBusy : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => onToggleMessageReaction(message, "like")}
                              disabled={reactionBusy || cavenInteractionLocked}
                              aria-label="Like message"
                              title="Like"
                            >
                              <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphLike].join(" ")} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={[
                                styles.centerMessageActionBtn,
                                feedback.reaction === "dislike" ? styles.centerMessageActionBtnReactionOn : "",
                                reactionBusy ? styles.centerMessageActionBtnBusy : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => onToggleMessageReaction(message, "dislike")}
                              disabled={reactionBusy || cavenInteractionLocked}
                              aria-label="Dislike message"
                              title="Dislike"
                            >
                              <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphDislike].join(" ")} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={[
                                styles.centerMessageActionBtn,
                                shareBusy ? styles.centerMessageActionBtnBusy : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => void onShareMessage(message)}
                              disabled={shareBusy || cavenInteractionLocked}
                              aria-label="Share message"
                              title="Share"
                            >
                              <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphShare].join(" ")} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className={[
                                styles.centerMessageActionBtn,
                                retryBusy ? styles.centerMessageActionBtnBusy : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onClick={() => void onRetryMessage(message)}
                              disabled={retryBusy || submitting || cavenInteractionLocked}
                              aria-label="Retry from this message"
                              title="Retry"
                            >
                              <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphRetry].join(" ")} aria-hidden="true" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}

              {inlineEditDraft ? (
                <article className={[styles.message, styles.messageUser].join(" ")}>
                  <div className={styles.inlineEditShell}>
                    <textarea
                      ref={inlineEditInputRef}
                      value={inlineEditPrompt}
                      onChange={(event) => setInlineEditPrompt(event.currentTarget.value)}
                      onKeyDown={onInlineEditPromptKeyDown}
                      className={styles.inlineEditInput}
                      rows={4}
                      aria-label="Edit prompt"
                      disabled={inlineEditBusy || submitting || cavenInteractionLocked}
                    />
                    <div className={styles.inlineEditActions}>
                      <button
                        type="button"
                        className={styles.inlineEditCancelBtn}
                        onClick={onCancelInlineEdit}
                        disabled={inlineEditBusy || submitting || cavenInteractionLocked}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.inlineEditSendBtn}
                        onClick={() => void onSubmitInlineEdit()}
                        disabled={inlineEditBusy || submitting || cavenInteractionLocked || !s(inlineEditPrompt)}
                        aria-label="Send edited prompt"
                        title="Send"
                      >
                        <span className={[styles.primaryBtnGlyph, styles.primaryBtnGlyphRun].join(" ")} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              ) : null}

              {hasPendingPrompt ? (
                <>
                  <article className={[styles.message, styles.messageUser].join(" ")}>
                    <div className={styles.messageBody}>
                      <div className={styles.messageText}>{pendingPromptText}</div>
                    </div>
                  </article>
                </>
              ) : null}
              {submitting ? (
                <article className={[styles.message, styles.messageAssistant, styles.agentMessageLoading].join(" ")}>
                  <div className={styles.agentMessageLoadingBody}>
                    <span className={styles.agentMessageLoadingGlyph} aria-hidden="true" />
                    <div className={styles.reasoningLoadingStack}>
                      <span className={styles.reasoningLoadingTitle}>Reasoning</span>
                      {reasoningContextLines.length ? (
                        <div className={styles.reasoningLoadingContext} aria-live="polite">
                          {reasoningContextLines.map((line, index) => (
                            <span key={`cavcode-reasoning-${index}`} className={styles.reasoningLoadingLine}>
                              {line}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ) : null}
            </div>
          )}
        </section>

        {historyModalOpen ? (
          <div
            className={[styles.centerSessionModalOverlay, styles.cavcodeHistoryModalOverlay].join(" ")}
            role="dialog"
            aria-modal="true"
            aria-label="Task history"
            onClick={() => setHistoryModalOpen(false)}
          >
            <div
              className={[styles.centerSessionModal, styles.cavcodeHistoryModal].join(" ")}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={[styles.centerSessionModalHead, styles.cavcodeHistoryModalHead].join(" ")}>
                <input
                  ref={historySearchInputRef}
                  className={[styles.cavcodeHistorySearchInput, styles.cavcodeHistoryHeadSearchInput].join(" ")}
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.currentTarget.value)}
                  placeholder="Search recent tasks"
                  aria-label="Search recent tasks"
                />
              </div>
              <div className={[styles.centerSessionModalBody, styles.cavcodeHistoryModalBody].join(" ")}>
                <div className={styles.cavcodeHistoryList} role="list" aria-label="Task history list">
                  {!sessions.length ? (
                    <div className={styles.cavcodeHistoryEmpty}>
                      <p className={styles.cavcodeHistoryEmptyText}>No tasks yet.</p>
                    </div>
                  ) : null}
                  {sessions.length && !filteredHistorySessions.length ? (
                    <div className={styles.centerHistoryEmpty}>No matching tasks.</div>
                  ) : null}
                  {filteredHistorySessions.map((item) => {
                    const isOn = s(sessionId) === item.id;
                    const isRunning = submitting && isOn;
                    return (
                      <button
                        key={`history-modal-${item.id}`}
                        type="button"
                        className={[styles.sessionItem, isOn ? styles.sessionItemOn : "", styles.historyCard].filter(Boolean).join(" ")}
                        onClick={() => onSelectHistorySession(item)}
                      >
                        <div className={styles.sessionTitle}>{item.title || item.contextLabel || "Untitled conversation"}</div>
                        <div className={styles.historyMetaLine}>
                          <span>{toTimelineLabel(item.lastMessageAt || item.updatedAt)}</span>
                          {isRunning ? (
                            <span className={styles.sessionRunningPill}>
                              <span className={styles.sessionRunningGlyph} aria-hidden="true" />
                              Reasoning
                            </span>
                          ) : null}
                          {item.model ? <span>{item.model}</span> : null}
                          {item.reasoningLevel ? <span>{item.reasoningLevel}</span> : null}
                        </div>
                        {item.preview ? <div className={styles.sessionPreview}>{item.preview}</div> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {reasoningPanelMessage && reasoningPanelMeta ? (
          <div
            className={styles.centerSessionModalOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Reasoning summary"
            onClick={closeReasoningPanel}
          >
            <div
              className={[styles.centerSessionModal, styles.centerReasoningModal].join(" ")}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.centerSessionModalHead}>
                <h3 className={styles.centerSessionModalTitle}>Reasoning Summary</h3>
                <button
                  type="button"
                  className={styles.centerSessionModalCloseBtn}
                  onClick={closeReasoningPanel}
                  aria-label="Close reasoning summary"
                >
                  <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                </button>
              </div>
              <div className={[styles.centerSessionModalBody, styles.centerReasoningBody].join(" ")}>
                <div className={styles.centerReasoningPromptBlock}>
                  <p className={styles.centerReasoningPromptLabel}>Your question</p>
                  <p className={styles.centerSessionModalCopy}>{reasoningPanelMeta.safeSummary.intent}</p>
                </div>
                <div className={styles.centerReasoningMetaRow}>
                  <span className={styles.centerReasoningMetaChip}>
                    <span className={styles.centerReasoningMetaKey}>Model</span>
                    <strong>{resolveAiModelLabel(reasoningPanelMeta.model) || reasoningPanelMeta.model || "Unknown"}</strong>
                  </span>
                  <span className={styles.centerReasoningMetaChip}>
                    <span className={styles.centerReasoningMetaKey}>Timing</span>
                    <strong>{reasoningPanelMeta.reasoningLabel || `Reasoned in ${reasoningPanelMeta.durationLabel}`}</strong>
                  </span>
                  <span className={styles.centerReasoningMetaChip}>
                    <span className={styles.centerReasoningMetaKey}>Task</span>
                    <strong>{reasoningPanelTaskLabel || "General"}</strong>
                  </span>
                </div>

                <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                  <h3 className={styles.centerResearchSectionTitle}>Context considered</h3>
                  <ul className={styles.centerResearchList}>
                    {reasoningPanelContextRows.map((row, index) => (
                      <li key={`cavcode-reason-context-${index}`}>{row}</li>
                    ))}
                  </ul>
                </section>

                <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                  <h3 className={styles.centerResearchSectionTitle}>Validation checks</h3>
                  <ul className={styles.centerResearchList}>
                    {reasoningPanelCheckRows.map((row, index) => (
                      <li key={`cavcode-reason-check-${index}`}>{row}</li>
                    ))}
                  </ul>
                </section>

                <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                  <h3 className={styles.centerResearchSectionTitle}>Answer path</h3>
                  <ul className={styles.centerResearchList}>
                    {reasoningPanelPathRows.map((row, index) => (
                      <li key={`cavcode-reason-path-${index}`}>{row}</li>
                    ))}
                  </ul>
                </section>

                <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                  <h3 className={styles.centerResearchSectionTitle}>Quality Snapshot</h3>
                  <div className={styles.centerReasoningQualityGrid}>
                    <span className={styles.centerReasoningMetric}><span>Overall</span><strong>{reasoningPanelMeta.quality.overall}</strong></span>
                    <span className={styles.centerReasoningMetric}><span>Request relevance</span><strong>{reasoningPanelMeta.quality.relevanceToRequest}</strong></span>
                    <span className={styles.centerReasoningMetric}><span>Surface relevance</span><strong>{reasoningPanelMeta.quality.relevanceToSurface}</strong></span>
                    <span className={styles.centerReasoningMetric}><span>Actionability</span><strong>{reasoningPanelMeta.quality.actionability}</strong></span>
                    <span className={styles.centerReasoningMetric}><span>Coherence</span><strong>{reasoningPanelMeta.quality.coherence}</strong></span>
                    <span className={styles.centerReasoningMetric}><span>Scope alignment</span><strong>{reasoningPanelMeta.quality.scopeAlignment}</strong></span>
                  </div>
                </section>

                {reasoningPanelMeta.safeSummary.uncertaintyNotes.length ? (
                  <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                    <h3 className={styles.centerResearchSectionTitle}>Uncertainty Notes</h3>
                    <ul className={styles.centerResearchList}>
                      {reasoningPanelMeta.safeSummary.uncertaintyNotes.map((row, index) => (
                        <li key={`cavcode-reason-uncertainty-${index}`}>{row}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
              <div className={styles.centerSessionModalFoot}>
                <button
                  type="button"
                  className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnPrimary].join(" ")}
                  onClick={closeReasoningPanel}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {cavCloudAttachModalOpen ? (
          <div
            className={styles.centerSessionModalOverlay}
            role="presentation"
            onClick={(event) => {
              if (event.currentTarget !== event.target) return;
              if (cavCloudAttachBusy) return;
              setCavCloudAttachModalOpen(false);
            }}
          >
            <section
              className={[styles.centerSessionModal, styles.imageStudioModal].join(" ")}
              role="dialog"
              aria-modal="true"
              aria-labelledby="caven-cavcloud-attach-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className={styles.centerSessionModalHead}>
                <h2
                  id="caven-cavcloud-attach-title"
                  className={styles.centerSessionModalTitle}
                  title="Attach from CavCloud"
                >
                  Attach from CavCloud
                </h2>
                <button
                  type="button"
                  className={styles.centerSessionModalCloseBtn}
                  onClick={() => setCavCloudAttachModalOpen(false)}
                  aria-label="Close dialog"
                  disabled={cavCloudAttachBusy}
                >
                  <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                </button>
              </header>
              <div className={styles.centerSessionModalBody}>
                <p className={styles.centerSessionModalCopy}>
                  Choose a CavCloud file to attach to this Caven prompt.
                </p>
                <input
                  type="search"
                  className={styles.cavCloudAttachSearch}
                  placeholder="Search CavCloud files"
                  value={cavCloudAttachQuery}
                  onChange={(event) => setCavCloudAttachQuery(event.currentTarget.value)}
                  disabled={cavCloudAttachBusy}
                />
                <div className={styles.cavCloudAttachGalleryWrap}>
                  {cavCloudAttachLoading ? (
                    <div className={styles.cavCloudAttachStatus}>Loading CavCloud files...</div>
                  ) : visibleCavCloudAttachItems.length ? (
                    <div className={styles.cavCloudAttachGrid}>
                      {visibleCavCloudAttachItems.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className={styles.cavCloudAttachCard}
                          onClick={() => void attachFromCavCloud(file)}
                          disabled={cavCloudAttachBusy}
                          title={file.path || file.name}
                        >
                          <span className={styles.cavCloudAttachCardIconWrap} aria-hidden="true">
                            <Image
                              src={resolveUploadFileIcon(file.name, file.mimeType)}
                              alt=""
                              width={16}
                              height={16}
                              className={styles.cavCloudAttachCardIcon}
                              unoptimized
                            />
                          </span>
                          <span className={styles.cavCloudAttachCardTitle}>{file.name}</span>
                          <span className={styles.cavCloudAttachCardSubtitle}>
                            {formatMimeSubtype(file.mimeType)} · {formatFileSize(file.bytes)}
                          </span>
                          <span className={styles.cavCloudAttachCardDate}>
                            {file.updatedAtISO ? toIsoTime(file.updatedAtISO) : "No date"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.cavCloudAttachEmpty}>
                      No matching files available in CavCloud.
                    </div>
                  )}
                </div>
              </div>
              <footer className={styles.centerSessionModalFoot}>
                <button
                  type="button"
                  className={styles.centerSessionModalBtn}
                  onClick={() => setCavCloudAttachModalOpen(false)}
                  disabled={cavCloudAttachBusy}
                >
                  Close
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        {settingsModalOpen ? (
          <div
            className={styles.centerSessionModalOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Caven settings"
            onClick={() => setSettingsModalOpen(false)}
          >
            <div
              className={[styles.centerSessionModal, styles.cavenSettingsModal].join(" ")}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.centerSessionModalHead}>
                <h3 className={styles.centerSessionModalTitle}>Caven Settings</h3>
                <button
                  type="button"
                  className={styles.centerSessionModalCloseBtn}
                  onClick={() => setSettingsModalOpen(false)}
                  aria-label="Close Caven settings"
                >
                  <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                </button>
              </div>
              <div className={[styles.centerSessionModalBody, styles.cavenSettingsBody].join(" ")}>
                <div className={styles.cavenSettingsTabs}>
                  {onOpenSkillsTab ? null : (
                    <button
                      type="button"
                      className={[
                        styles.cavenSettingsTabBtn,
                        settingsModalTab === "skills" ? styles.cavenSettingsTabBtnOn : "",
                      ].join(" ")}
                      onClick={() => setSettingsModalTab("skills")}
                    >
                      Caven Settings
                    </button>
                  )}
                  {onOpenGeneralSettingsTab ? null : (
                    <button
                      type="button"
                      className={[
                        styles.cavenSettingsTabBtn,
                        settingsModalTab === "general" ? styles.cavenSettingsTabBtnOn : "",
                      ].join(" ")}
                      onClick={() => setSettingsModalTab("general")}
                    >
                      General
                    </button>
                  )}
                  <button
                    type="button"
                    className={[
                      styles.cavenSettingsTabBtn,
                      settingsModalTab === "ide" ? styles.cavenSettingsTabBtnOn : "",
                    ].join(" ")}
                    onClick={() => setSettingsModalTab("ide")}
                  >
                    IDE Settings
                  </button>
                </div>

                {!onOpenSkillsTab && settingsModalTab === "skills" ? (
                  <div className={styles.cavenSettingsPane}>
                    <div className={styles.cavenSettingsPaneTitle}>Agents</div>
                    <div className={styles.cavenSettingsPaneSub}>
                      Manage installed agents for this workspace. Full CavAi and Companion agent banks are available in Agent Mode and the Caven Agents panel.
                    </div>
                    {CAVEN_SKILLS.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        className={styles.cavenSkillCard}
                        onClick={() => setActiveSkillInfoId(skill.id)}
                      >
                        <div className={styles.cavenSkillCardMain}>
                          <div className={styles.cavenSkillTitleRow}>
                            <Image src={skill.iconSrc} alt="" width={16} height={16} unoptimized className={styles.cavenSkillIcon} />
                            <div className={styles.cavenSkillTitle}>{skill.name}</div>
                          </div>
                          <div className={styles.cavenSkillSummary}>{skill.summary}</div>
                        </div>
                        {isToggleableCavenSkill(skill.id) ? (
                          <label
                            className={styles.cavenSkillToggleWrap}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className={styles.cavenSkillToggleLabel}>Enabled</span>
                            <input
                              type="checkbox"
                              checked={asrAudioSkillEnabled}
                              onChange={(event) => void patchCavenSettings(
                                { asrAudioSkillEnabled: event.currentTarget.checked },
                                "asrAudioSkillEnabled"
                              )}
                              disabled={Boolean(savingCavenSettingsKey)}
                            />
                          </label>
                        ) : (
                          <span className={styles.cavenSkillToggleLabel}>Installed</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : settingsModalTab === "general" ? (
                  <div className={styles.cavenSettingsPane}>
                    <div className={styles.cavenSettingsPaneTitle}>General</div>
                    <div className={styles.cavenSettingsGrid}>
                      <label className={styles.cavenSettingRow}>
                        <span>Default model</span>
                        <input
                          type="text"
                          className={styles.cavenSettingSelect}
                          value={cavenSettings.defaultModelId}
                          onChange={(event) => void patchCavenSettings(
                            { defaultModelId: s(event.currentTarget.value) || ALIBABA_QWEN_CODER_MODEL_ID },
                            "defaultModelId"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Speed</span>
                        <select
                          className={styles.cavenSettingSelect}
                          value={cavenSettings.inferenceSpeed}
                          onChange={(event) => void patchCavenSettings(
                            { inferenceSpeed: toInferenceSpeed(event.currentTarget.value) },
                            "inferenceSpeed"
                          )}
                        >
                          <option value="standard">Standard</option>
                          <option value="fast">Fast</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        className={styles.cavenSettingsTabBtn}
                        onClick={openConfigToml}
                      >
                        Open config.toml
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cavenSettingsPane}>
                    <div className={styles.cavenSettingsPaneTitle}>IDE Settings</div>
                    <div className={styles.cavenSettingsGrid}>
                      <label className={styles.cavenSettingRow}>
                        <span>Queue follow-ups</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.queueFollowUps}
                          onChange={(event) => void patchCavenSettings(
                            { queueFollowUps: event.currentTarget.checked },
                            "queueFollowUps"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Composer enter behavior</span>
                        <select
                          className={styles.cavenSettingSelect}
                          value={cavenSettings.composerEnterBehavior}
                          onChange={(event) => void patchCavenSettings(
                            { composerEnterBehavior: toComposerEnterBehavior(event.currentTarget.value) },
                            "composerEnterBehavior"
                          )}
                        >
                          <option value="enter">Enter sends</option>
                          <option value="meta_enter">Cmd/Ctrl + Enter sends</option>
                        </select>
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Default reasoning level</span>
                        <select
                          className={styles.cavenSettingSelect}
                          value={cavenSettings.defaultReasoningLevel}
                          onChange={(event) => {
                            const next = toReasoningLevel(event.currentTarget.value) || "medium";
                            void patchCavenSettings({ defaultReasoningLevel: next }, "defaultReasoningLevel");
                          }}
                        >
                          {REASONING_LEVEL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Include IDE context</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.includeIdeContext}
                          onChange={(event) => void patchCavenSettings(
                            { includeIdeContext: event.currentTarget.checked },
                            "includeIdeContext"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Confirm before Apply Patch</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.confirmBeforeApplyPatch}
                          onChange={(event) => void patchCavenSettings(
                            { confirmBeforeApplyPatch: event.currentTarget.checked },
                            "confirmBeforeApplyPatch"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Auto-open resolved files</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.autoOpenResolvedFiles}
                          onChange={(event) => void patchCavenSettings(
                            { autoOpenResolvedFiles: event.currentTarget.checked },
                            "autoOpenResolvedFiles"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Show reasoning timeline</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.showReasoningTimeline}
                          onChange={(event) => void patchCavenSettings(
                            { showReasoningTimeline: event.currentTarget.checked },
                            "showReasoningTimeline"
                          )}
                        />
                      </label>
                      <label className={styles.cavenSettingRow}>
                        <span>Share telemetry</span>
                        <input
                          type="checkbox"
                          checked={cavenSettings.telemetryOptIn}
                          onChange={(event) => void patchCavenSettings(
                            { telemetryOptIn: event.currentTarget.checked },
                            "telemetryOptIn"
                          )}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className={styles.centerSessionModalFoot}>
                <button
                  type="button"
                  className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnPrimary].join(" ")}
                  onClick={() => setSettingsModalOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeSkillInfo ? (
          <div
            className={styles.centerSessionModalOverlay}
            role="dialog"
            aria-modal="true"
            aria-label={`${activeSkillInfo.name} details`}
            onClick={() => setActiveSkillInfoId("")}
          >
            <div
              className={[styles.centerSessionModal, styles.cavenSkillInfoModal].join(" ")}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.centerSessionModalHead}>
                <h3 className={styles.centerSessionModalTitle}>{activeSkillInfo.name}</h3>
                <button
                  type="button"
                  className={styles.centerSessionModalCloseBtn}
                  onClick={() => setActiveSkillInfoId("")}
                  aria-label="Close agent details"
                >
                  <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                </button>
              </div>
              <div className={[styles.centerSessionModalBody, styles.cavenSkillInfoBody].join(" ")}>
                <p className={styles.cavenSkillInfoSummary}>{activeSkillInfo.detail}</p>
                <div className={styles.cavenSkillInfoMeta}>Model: {activeSkillInfo.modelAttribution}</div>
                <section className={styles.cavenSkillInfoSection}>
                  <h4 className={styles.cavenSkillInfoSectionTitle}>Example prompt</h4>
                  <pre className={styles.cavenSkillInfoPrompt}>{activeSkillInfo.examplePrompt}</pre>
                </section>
                <section className={styles.cavenSkillInfoSection}>
                  <h4 className={styles.cavenSkillInfoSectionTitle}>How it helps</h4>
                  <ul className={styles.centerResearchList}>
                    {cavenSkillHelpBullets(activeSkillInfo.id).map((item, index) => (
                      <li key={`caven-skill-help-${activeSkillInfo.id}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              </div>
              <div className={styles.centerSessionModalFoot}>
                {isToggleableCavenSkill(activeSkillInfo.id) ? (
                  <button
                    type="button"
                    className={styles.centerSessionModalBtn}
                    onClick={() => void patchCavenSettings(
                      { asrAudioSkillEnabled: !asrAudioSkillEnabled },
                      "asrAudioSkillEnabled"
                    )}
                  >
                    {asrAudioSkillEnabled ? "Disable Voice" : "Enable Voice"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.centerSessionModalBtn}
                    disabled
                  >
                    Installed
                  </button>
                )}
                <button
                  type="button"
                  className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnPrimary].join(" ")}
                  onClick={() => {
                    setActiveSkillInfoId("");
                    setSettingsModalOpen(false);
                    setPrompt((prev) => (s(prev) ? prev : activeSkillInfo.examplePrompt));
                  }}
                >
                  Use In Composer
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <footer className={styles.agentComposer}>
          {images.length || uploadedFiles.length ? (
            <div className={styles.attachmentsRow}>
              {images.map((image) => (
                <div
                  key={image.id}
                  className={[
                    styles.attachmentChip,
                    image.uploading ? styles.attachmentChipUploading : "",
                  ].filter(Boolean).join(" ")}
                >
                  <span className={styles.attachmentPreviewWrap}>
                    <button
                      type="button"
                      className={[
                        styles.attachmentPreviewBtn,
                        image.uploading ? styles.attachmentPreviewBtnDisabled : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => openComposerImageViewer(image)}
                      disabled={image.uploading}
                      aria-label={`Open ${image.name}`}
                      title={image.name}
                    >
                      <Image src={image.dataUrl} alt="" width={24} height={24} unoptimized className={styles.attachmentPreview} />
                    </button>
                    {(s(image.mimeType).toLowerCase().includes("svg") || s(image.name).toLowerCase().endsWith(".svg")) ? (
                      <span className={styles.attachmentFileTypeBadge} aria-hidden="true">
                        <Image src={CAVAI_UPLOAD_FILE_ICON_ASSETS.svg} alt="" width={12} height={12} className={styles.attachmentFileIcon} unoptimized />
                      </span>
                    ) : null}
                    {image.uploading ? (
                      <span className={styles.attachmentPreviewLoadingOverlay} aria-hidden="true">
                        <span className={styles.attachmentPreviewLoadingRing} />
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.attachmentName}>{image.name}</span>
                  {!image.uploading ? (
                    <button
                      type="button"
                      className={styles.attachmentRemove}
                      onClick={() => {
                        setImages((prev) => prev.filter((item) => item.id !== image.id));
                        setComposerImageViewer((prev) => (prev && prev.imageId === image.id ? null : prev));
                      }}
                      aria-label={`Remove ${image.name}`}
                    >
                      <span className={styles.attachmentRemoveGlyph} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
              {uploadedFiles.map((file) => (
                <div
                  key={file.id}
                  className={[
                    styles.attachmentChip,
                    styles.attachmentFileChip,
                    file.uploading ? styles.attachmentChipUploading : "",
                  ].filter(Boolean).join(" ")}
                >
                  <span className={styles.attachmentFileIconWrap} aria-hidden="true">
                    <Image src={file.iconSrc} alt="" width={18} height={18} className={styles.attachmentFileIcon} unoptimized />
                    {file.uploading ? (
                      <span className={styles.attachmentPreviewLoadingOverlay} aria-hidden="true">
                        <span className={styles.attachmentPreviewLoadingRing} />
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className={[
                      styles.attachmentFileOpenBtn,
                      file.uploading ? styles.attachmentFileOpenBtnDisabled : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => openUploadedFileAttachment(file)}
                    disabled={file.uploading || !s(file.path)}
                    aria-label={file.uploading ? `Uploading ${file.name}` : `Open ${file.name} in CavCode`}
                    title={file.uploading ? `Uploading ${file.name}` : file.path || file.name}
                  >
                    <span className={styles.attachmentName}>{file.name}</span>
                    <span className={styles.attachmentFileMeta}>
                      {file.uploading
                        ? "Uploading..."
                        : `${formatMimeSubtype(file.mimeType)} · ${formatFileSize(file.sizeBytes)}`}
                    </span>
                  </button>
                  {!file.uploading ? (
                    <button
                      type="button"
                      className={styles.attachmentRemove}
                      onClick={() => setUploadedFiles((prev) => prev.filter((item) => item.id !== file.id))}
                      aria-label={`Remove ${file.name}`}
                    >
                      <span className={styles.attachmentRemoveGlyph} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className={styles.composerInputWrap}>
            <textarea
              className={styles.input}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              onKeyDown={onComposerKeyDown}
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
              placeholder={promptPlaceholder}
              disabled={cavenInteractionLocked}
            />
          </div>

          <div className={styles.composerControls} ref={composerControlsRef}>
            <div className={styles.iconMenuWrap}>
              <button
                type="button"
                className={[styles.actionBtn, styles.iconActionBtn, styles.menuTriggerBtn].join(" ")}
                onClick={() => {
                  if (cavenInteractionLocked) return;
                  setOpenComposerMenu((prev) => (prev === "quick_actions" ? null : "quick_actions"));
                }}
                title="Open quick actions"
                aria-label="Open quick actions"
                aria-haspopup="menu"
                aria-expanded={openComposerMenu === "quick_actions"}
                disabled={cavenInteractionLocked}
              >
                <span className={styles.plusGlyph} aria-hidden="true" />
              </button>
              {openComposerMenu === "quick_actions" ? (
                <div className={[styles.iconMenu, styles.centerQuickActionsMenu].join(" ")} role="menu" aria-label="Quick actions">
                  {quickActionItems.map((item) => (
                    <button
                      key={`quick-action-${item.id}`}
                      type="button"
                      role="menuitem"
                      className={[styles.iconMenuItem, styles.centerQuickActionMenuItem].join(" ")}
                      onClick={() => applyQuickAction(item.id)}
                    >
                      <span className={styles.centerQuickActionMenuLead}>
                        <span
                          className={[
                            styles.centerQuickActionMenuGlyph,
                            item.id === "upload_from_cavcloud"
                              ? styles.centerQuickActionMenuGlyphUploadFromCavCloud
                              : styles.centerQuickActionMenuGlyphAddFiles,
                          ].join(" ")}
                          aria-hidden="true"
                        />
                        <span className={styles.centerQuickActionMenuText}>
                          <span className={styles.centerQuickActionMenuLabel}>{item.label}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={styles.iconMenuWrap}>
              <button
                type="button"
                className={[styles.actionBtn, styles.iconActionBtn, styles.menuTriggerBtn].join(" ")}
                onClick={() => {
                  if (cavenInteractionLocked) return;
                  setOpenComposerMenu((prev) => (prev === "model" ? null : "model"));
                }}
                aria-label={selectedModelLabel}
                aria-haspopup="menu"
                aria-expanded={openComposerMenu === "model"}
                title={selectedModelLabel}
                disabled={cavenInteractionLocked}
              >
                <span className={[styles.selectGlyph, styles.modelGlyph].join(" ")} aria-hidden="true" />
              </button>
              {openComposerMenu === "model" ? (
                <div className={styles.iconMenu} role="menu" aria-label="Model options">
                  {modelMenuOptions.map((option) => {
                    const isOn = selectedModel === option.id;
                    const isQwenCoder = option.id === ALIBABA_QWEN_CODER_MODEL_ID;
                    const isLocked = isQwenCoder && qwenLocked;
                    const lockReason = isQwenCoder && qwenPopoverState
                      ? qwenPopoverState.entitlement.state === "cooldown"
                        ? `Cooling down until ${toCountdownLabel(qwenPopoverState.cooldownEndsAt)}`
                        : qwenPopoverState.entitlement.state === "locked_free"
                          ? "Not included on Free"
                          : qwenPopoverState.entitlement.state === "premium_plus_exhausted"
                            ? `Resets ${toDateLabel(qwenPopoverState.resetAt)}`
                            : qwenPopoverState.entitlement.state === "premium_exhausted"
                              ? `Resets ${toDateLabel(qwenPopoverState.resetAt)}`
                              : ""
                      : "";
                    return (
                      <div
                        key={option.id}
                        className={styles.iconMenuItemRow}
                        onMouseEnter={() => {
                          if (!isQwenCoder) return;
                          setQwenPopoverOpen(true);
                        }}
                        onMouseLeave={() => {
                          if (!isQwenCoder) return;
                          if (qwenPopoverPinned) return;
                          setQwenPopoverOpen(false);
                        }}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isOn}
                          className={[
                            styles.iconMenuItem,
                            isOn ? styles.iconMenuItemOn : "",
                            isLocked ? styles.iconMenuItemLocked : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => {
                            if (isLocked) {
                              setQwenPopoverPinned(true);
                              setQwenPopoverOpen(true);
                              trackCavenEvent("qwen_coder_selection_blocked", {
                                surface: "cavcode",
                                state: qwenPopoverState?.entitlement?.state || "unknown",
                                planLabel: qwenPopoverState?.planLabel || "unknown",
                              });
                              emitQwenUpgradeDecision();
                              return;
                            }
                            if (isQwenCoder) {
                              trackCavenEvent("qwen_coder_selection_allowed", {
                                surface: "cavcode",
                                planLabel: qwenPopoverState?.planLabel || "unknown",
                              });
                            }
                            setSelectedModel(option.id);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <span className={styles.iconMenuItemLabel}>{option.label}</span>
                          {isLocked ? <span className={styles.iconMenuLockTag}>Locked</span> : null}
                        </button>
                        {isQwenCoder && qwenPopoverState ? (
                          <>
                            <button
                              type="button"
                              className={styles.qwenUsageBadgeBtn}
                              aria-label={`Caven usage: ${qwenUsageLabel}`}
                              onClick={(event) => {
                                if (cavenInteractionLocked) return;
                                event.preventDefault();
                                event.stopPropagation();
                                setQwenPopoverOpen((prev) => {
                                  const next = !prev;
                                  setQwenPopoverPinned(next);
                                  if (next) {
                                    trackCavenEvent("qwen_coder_popover_open", {
                                      surface: "cavcode",
                                      trigger: "badge_click",
                                      planLabel: qwenPopoverState.planLabel,
                                    });
                                  }
                                  return next;
                                });
                              }}
                            >
                              <span className={styles.qwenUsageBadgeBar} aria-hidden="true">
                                <span
                                  className={styles.qwenUsageBadgeFill}
                                  style={{ width: `${qwenUsagePercent}%` }}
                                />
                              </span>
                              <span className={styles.qwenUsageBadgeText}>{Math.round(qwenUsagePercent)}%</span>
                            </button>
                            {qwenPopoverOpen ? (
                              <div
                                className={styles.qwenUsagePopover}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                              >
                                <button
                                  type="button"
                                  className={styles.qwenUsagePopoverClose}
                                  aria-label="Close Caven usage"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setQwenPopoverPinned(false);
                                    setQwenPopoverOpen(false);
                                  }}
                                >
                                  <span className={styles.qwenUsagePopoverCloseGlyph} aria-hidden="true" />
                                </button>
                                {qwenPopoverState.entitlement.state === "locked_free" || qwenPopoverState.usage.creditsTotal <= 0 ? (
                                  <>
                                    <div className={styles.qwenUsagePopoverTitle}>Caven usage</div>
                                    <div className={styles.qwenUsagePopoverMetric}>Not included on Free</div>
                                    <div className={styles.qwenUsagePopoverLine}>Caven is available on Premium and Premium+.</div>
                                    <div className={styles.qwenUsagePopoverLine}>{CAVEN_MODEL_ATTRIBUTION}</div>
                                    <a
                                      className={styles.qwenUsagePopoverCta}
                                      href="/settings/upgrade?plan=premium&billing=monthly"
                                      onClick={() => {
                                        trackCavenEvent("qwen_coder_upgrade_cta_click", {
                                          surface: "cavcode",
                                          source: "popover",
                                          planLabel: qwenPopoverState.planLabel,
                                          state: qwenPopoverState.entitlement.state,
                                        });
                                      }}
                                    >
                                      Upgrade
                                    </a>
                                    {lockReason ? <div className={styles.qwenUsagePopoverState}>{lockReason}</div> : null}
                                  </>
                                ) : (
                                  <>
                                <div className={styles.qwenUsagePopoverTitle}>Caven usage</div>
                                <div className={styles.qwenUsagePopoverLine}>{CAVEN_MODEL_ATTRIBUTION}</div>
                                <div className={styles.qwenUsagePopoverMetric}>{Math.round(qwenUsagePercent)}% used</div>
                                <div className={styles.qwenUsagePopoverLine}>
                                  {qwenPopoverState.usage.creditsUsed} / {qwenPopoverState.usage.creditsTotal} credits used
                                </div>
                                <div className={styles.qwenUsagePopoverLine}>
                                  {qwenPopoverState.usage.creditsLeft} credits left
                                </div>
                                {qwenPopoverState.contextWindow ? (
                                  <>
                                    <div className={styles.qwenUsagePopoverSectionLabel}>Current context window</div>
                                    <div className={styles.qwenUsagePopoverLine}>
                                      {Math.round(qwenPopoverState.contextWindow.percentFull)}% full
                                    </div>
                                    <div className={styles.qwenUsagePopoverLine}>
                                      {qwenPopoverState.contextWindow.currentTokens.toLocaleString()} / {qwenPopoverState.contextWindow.maxTokens.toLocaleString()} tokens
                                    </div>
                                  </>
                                ) : null}
                                {qwenPopoverState.entitlement.state === "cooldown" ? (
                                  <div className={styles.qwenUsagePopoverLine}>Cooldown ends in {toCountdownLabel(qwenPopoverState.cooldownEndsAt)}</div>
                                ) : (
                                  <div className={styles.qwenUsagePopoverLine}>Resets {toDateLabel(qwenPopoverState.resetAt)}</div>
                                )}
                                {qwenPopoverState.contextWindow && qwenPopoverState.contextWindow.compactionCount > 0 ? (
                                  <div className={styles.qwenUsagePopoverHint}>CavAi automatically compacts context when needed.</div>
                                ) : null}
                                {qwenPopoverState.entitlement.warningLevel ? (
                                  <div className={styles.qwenUsagePopoverState}>
                                    {qwenPopoverState.entitlement.warningLevel}% usage warning reached
                                  </div>
                                ) : null}
                                {qwenPopoverState.planLabel !== "Premium+" ? (
                                  <a
                                    className={styles.qwenUsagePopoverCta}
                                    href="/settings/upgrade?plan=premium_plus&billing=monthly"
                                    onClick={() => {
                                      trackCavenEvent("qwen_coder_upgrade_cta_click", {
                                        surface: "cavcode",
                                        source: "popover",
                                        planLabel: qwenPopoverState.planLabel,
                                        state: qwenPopoverState.entitlement.state,
                                      });
                                    }}
                                  >
                                    Upgrade to Premium+
                                  </a>
                                ) : null}
                                {lockReason ? <div className={styles.qwenUsagePopoverState}>{lockReason}</div> : null}
                                  </>
                                )}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className={styles.iconMenuWrap}>
              <button
                type="button"
                className={[styles.actionBtn, styles.iconActionBtn, styles.menuTriggerBtn].join(" ")}
                onClick={() => {
                  if (cavenInteractionLocked) return;
                  setOpenComposerMenu((prev) => (prev === "reasoning" ? null : "reasoning"));
                }}
                aria-label={selectedReasoningLabel}
                aria-haspopup="menu"
                aria-expanded={openComposerMenu === "reasoning"}
                title={selectedReasoningLabel}
                disabled={cavenInteractionLocked}
              >
                <span className={[styles.selectGlyph, styles.reasoningGlyph].join(" ")} aria-hidden="true" />
              </button>
              {openComposerMenu === "reasoning" ? (
                <div className={styles.iconMenu} role="menu" aria-label="Reasoning options">
                  {reasoningMenuOptions.map((option) => {
                    const isOn = reasoningLevel === option.value;
                    const helper = toReasoningDisplayHelper(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isOn}
                        className={[styles.iconMenuItem, isOn ? styles.iconMenuItemOn : ""].filter(Boolean).join(" ")}
                        onClick={() => {
                          setReasoningLevel(option.value);
                          setOpenComposerMenu(null);
                        }}
                        title={helper ? `${option.label}: ${helper}` : option.label}
                      >
                        <span className={styles.iconMenuItemLabel}>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className={[
                styles.actionBtn,
                styles.iconActionBtn,
                styles.queueIconBtn,
                queueEnabled ? styles.queueIconBtnOn : styles.queueIconBtnOff,
              ].join(" ")}
              onClick={() => {
                if (cavenInteractionLocked) return;
                setQueueEnabled((prev) => {
                  const next = !prev;
                  void patchCavenSettings({ queueFollowUps: next }, "queueFollowUps");
                  return next;
                });
              }}
              title="Allow prompt queue"
              aria-label={`Queue ${queueEnabled ? "on" : "off"}`}
              aria-pressed={queueEnabled}
              disabled={cavenInteractionLocked}
            >
              <span className={styles.queueGlyph} aria-hidden="true" />
            </button>

            {showAudioModelSelector ? (
              <div className={[styles.iconMenuWrap, styles.composerRightStart].join(" ")}>
                <button
                  type="button"
                  className={[styles.actionBtn, styles.iconActionBtn, styles.composerAudioBtn, styles.menuTriggerBtn].join(" ")}
                  onClick={() => {
                    if (cavenInteractionLocked) return;
                    setOpenComposerMenu((prev) => (prev === "audio_model" ? null : "audio_model"));
                  }}
                  aria-label={selectedAudioModelLabel}
                  aria-haspopup="menu"
                  aria-expanded={openComposerMenu === "audio_model"}
                  title={selectedAudioModelLabel}
                  disabled={cavenInteractionLocked}
                >
                  <span className={[styles.selectGlyph, styles.audioGlyph].join(" ")} aria-hidden="true" />
                </button>
                {openComposerMenu === "audio_model" ? (
                  <div className={styles.iconMenu} role="menu" aria-label="Transcription model options">
                    {audioModelMenuOptions.map((option) => {
                      const isOn = selectedAudioModel === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isOn}
                          className={[styles.iconMenuItem, isOn ? styles.iconMenuItemOn : ""].filter(Boolean).join(" ")}
                          onClick={() => {
                            setSelectedAudioModel(option.id);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <span className={styles.iconMenuItemLabel}>{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className={[
                styles.primaryBtn,
                styles.composerSendBtn,
                showAudioModelSelector ? styles.composerSendBtnPaired : "",
                submitting ? styles.primaryBtnStop : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={onComposerPrimaryAction}
              aria-label={
                submitting
                  ? "Stop Caven prompt"
                  : recordingVoice
                    ? "Stop voice input"
                    : promptHasTypedInput
                      ? "Send Caven prompt"
                      : "Start voice input"
              }
              title={
                submitting
                  ? "Stop"
                  : recordingVoice
                    ? "Stop voice"
                    : promptHasTypedInput
                      ? "Send"
                      : "Start voice"
              }
              disabled={cavenInteractionLocked || processingVoice}
            >
              <span
                className={[
                  styles.primaryBtnGlyph,
                  submitting || recordingVoice
                    ? styles.primaryBtnGlyphStop
                    : promptHasTypedInput
                      ? styles.primaryBtnGlyphRun
                      : styles.primaryBtnGlyphVoice,
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              />
            </button>
          </div>

          {transcribingAudio ? <div className={styles.metaText}>Transcribing audio...</div> : null}
          {error ? <div className={styles.error}>{error}</div> : null}

          <input
            ref={imageInputRef}
            type="file"
            accept="*/*"
            multiple
            style={{ display: "none" }}
            onChange={async (event) => {
              const input = event.currentTarget;
              await onAttachFiles(input.files);
              input.value = "";
            }}
          />
        </footer>

        {activeComposerImageViewer ? (
          <div
            className={styles.centerImageViewerOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Uploaded image preview"
            onClick={closeComposerImageViewer}
          >
            <section
              className={styles.centerImageViewer}
              onClick={(event) => event.stopPropagation()}
            >
              <header className={styles.centerImageViewerHead}>
                <div className={styles.centerImageViewerMetaMain}>
                  <span className={styles.centerImageViewerTitle}>{activeComposerImageViewer.name}</span>
                  <span className={styles.centerImageViewerSubtitle}>
                    {formatMimeSubtype(activeComposerImageViewer.mimeType)} · {formatFileSize(activeComposerImageViewer.sizeBytes)}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.centerImageViewerCloseBtn}
                  onClick={closeComposerImageViewer}
                  aria-label="Close image preview"
                >
                  <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                </button>
              </header>
              <div className={[styles.centerImageViewerCanvas, styles.cavenImageViewerCanvas].join(" ")}>
                {showComposerViewerNavigation ? (
                  <button
                    type="button"
                    className={[
                      styles.centerImageViewerNavBtn,
                      styles.centerImageViewerNavBtnPrev,
                      styles.cavenImageViewerNavBtn,
                    ].join(" ")}
                    onClick={openComposerImageViewerPrev}
                    aria-label="Previous uploaded image"
                    disabled={composerViewerActiveIndex <= 0}
                  >
                    <span
                      className={[styles.centerImageViewerNavGlyph, styles.centerImageViewerNavGlyphLeft].join(" ")}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
                <div
                  ref={viewerImageWrapRef}
                  className={styles.cavenImageViewerMediaWrap}
                  onMouseMove={onComposerViewerMouseMove}
                  onMouseLeave={onComposerViewerMouseLeave}
                >
                  <Image
                    src={activeComposerImageViewer.dataUrl}
                    alt={activeComposerImageViewer.name}
                    width={1280}
                    height={1280}
                    unoptimized
                    className={styles.centerImageViewerMedia}
                    onLoadingComplete={onComposerViewerMediaLoaded}
                  />
                  {viewerMagnifierVisible && viewerMagnifierSupportsHover ? (
                    <span
                      className={styles.cavenImageViewerMagnifier}
                      style={{
                        left: `${viewerMagnifierFocusPoint.px}px`,
                        top: `${viewerMagnifierFocusPoint.py}px`,
                        backgroundImage: `url(${activeComposerImageViewer.dataUrl})`,
                        backgroundPosition: `${viewerMagnifierFocusPoint.x}% ${viewerMagnifierFocusPoint.y}%`,
                      }}
                      aria-hidden="true"
                    >
                      <span className={styles.cavenImageViewerMagnifierGlyph} />
                    </span>
                  ) : null}
                </div>
                {showComposerViewerNavigation ? (
                  <button
                    type="button"
                    className={[
                      styles.centerImageViewerNavBtn,
                      styles.centerImageViewerNavBtnNext,
                      styles.cavenImageViewerNavBtn,
                    ].join(" ")}
                    onClick={openComposerImageViewerNext}
                    aria-label="Next uploaded image"
                    disabled={composerViewerActiveIndex >= composerViewerImages.length - 1}
                  >
                    <span
                      className={[styles.centerImageViewerNavGlyph, styles.centerImageViewerNavGlyphRight].join(" ")}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
