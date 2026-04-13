"use client";

import Link from "next/link";
import Image from "next/image";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { LockIcon } from "@/components/LockIcon";
import CavAiVoiceOrb, { type CavAiVoiceOrbMode } from "@/components/cavai/CavAiVoiceOrb";
import { isReservedUsername, isValidUsername, normalizeUsername } from "@/lib/username";
import {
  CAVAI_SAFE_FALLBACK_LINE,
  pickAndRememberCavAiLine,
  readCavAiIdentityFromStorage,
  rememberCavAiIdentity,
  type CavAiSurface,
  type CavAiIdentityInput,
} from "@/lib/cavai/heroLine";
import {
  ALIBABA_QWEN_ASR_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID,
  ALIBABA_QWEN_IMAGE_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
  CAVAI_AUTO_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  isAiAutoModelId,
  rankDefaultModelForUi,
  resolveAiModelLabel,
} from "@/src/lib/ai/model-catalog";
import { toReasoningDisplayHelper, toReasoningDisplayLabel } from "@/src/lib/ai/reasoning-display";
import { inferCenterActionFromPrompt } from "@/src/lib/ai/ai.center-routing";
import { emitGuardDecisionFromPayload, readGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import { buildCavAiRouteContextPayload, resolveCavAiRouteAwareness } from "@/lib/cavai/pageAwareness";
import { resolveUploadFileIcon } from "@/lib/cavai/uploadFileIcons";
import { readBootClientProfileState } from "@/lib/clientAuthBootstrap";
import { publishClientPlan, readBootClientPlanBootstrap, subscribeClientPlan } from "@/lib/clientPlan";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";
import styles from "./CavAiWorkspace.module.css";

export type AiCenterSurface = "general" | "workspace" | "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode";

type AiCenterAction =
  | "companion_chat"
  | "financial_advisor"
  | "therapist_support"
  | "mentor"
  | "best_friend"
  | "relationship_advisor"
  | "philosopher"
  | "focus_coach"
  | "life_strategist"
  | "email_text_agent"
  | "content_creator"
  | "legal_privacy_terms_ethics_agent"
  | "pdf_create_edit_preview_agent"
  | "page_404_builder_agent"
  | "doc_edit_review_agent"
  | "image_studio"
  | "image_edit"
  | "live_multimodal"
  | "web_research"
  | "explain_spike"
  | "summarize_issues"
  | "prioritize_fixes"
  | "write_incident_note"
  | "recommend_next_steps"
  | "summarize_folder"
  | "explain_artifact"
  | "draft_publish_copy"
  | "organize_storage"
  | "explain_access_restrictions"
  | "summarize_secure_file"
  | "review_collaboration_state"
  | "audit_access_context"
  | "write_note"
  | "summarize_thread"
  | "rewrite_clearly"
  | "technical_recap"
  | "bullets_to_plan";

type CavAiCenterData = {
  summary: string;
  risk: "low" | "medium" | "high";
  answer: string;
  generatedImages?: Array<{
    url?: string;
    b64Json?: string;
  }>;
  researchMode?: boolean;
  keyFindings?: string[];
  extractedEvidence?: Array<{
    source: string;
    url?: string;
    note: string;
  }>;
  sources?: Array<{
    title: string;
    url: string;
    note?: string;
  }>;
  suggestedNextActions?: string[];
  recommendations: string[];
  notes: string[];
  followUpChecks: string[];
  evidenceRefs: string[];
  imageStudio?: {
    mode?: string;
    jobId?: string | null;
    presetId?: string | null;
    presetLabel?: string | null;
    sourcePrompt?: string | null;
    sourceAssetId?: string | null;
    assets?: Array<{
      assetId?: string;
      url?: string;
      b64Json?: string;
      fileName?: string;
      mimeType?: string;
    }>;
  };
};

type ImageStudioPreset = {
  id: string;
  slug: string;
  label: string;
  subtitle: string | null;
  thumbnailUrl: string | null;
  category: string;
  planTier: "free" | "premium" | "premium_plus";
  displayOrder: number;
  isFeatured: boolean;
  isActive: boolean;
  createdAtISO: string;
  updatedAtISO: string;
  locked: boolean;
};

type ImageStudioHistoryRow = {
  id: string;
  entryType: string;
  mode: string | null;
  promptSummary: string | null;
  saved: boolean;
  savedTarget: string | null;
  createdAtISO: string;
  jobId: string | null;
  assetId: string | null;
  presetId: string | null;
  presetLabel: string | null;
  imageUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  modelUsed: string | null;
  sourcePrompt: string | null;
};

type ImageStudioGalleryItem = {
  id: string;
  name: string;
  path: string;
  bytes: number;
  mimeType: string;
  updatedAtISO: string;
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

type CavAiSessionSummary = {
  id: string;
  surface: AiCenterSurface;
  title: string;
  contextLabel: string | null;
  workspaceId: string | null;
  projectId: number | null;
  origin: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessageAt: string | null;
  preview: string | null;
};

type CavAiMessage = {
  id: string;
  role: "user" | "assistant";
  action: string | null;
  contentText: string;
  contentJson: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
  feedback: CavAiMessageFeedbackState | null;
};

type CenterSessionCacheMessageEntry = {
  sessionId: string;
  messages: CavAiMessage[];
  updatedAtMs: number;
};

type CenterSessionCacheSnapshot = {
  activeSessionId: string;
  sessions: CavAiSessionSummary[];
  messageEntries: CenterSessionCacheMessageEntry[];
};

type GuestSessionSyncMessagePayload = {
  role: "user" | "assistant";
  action: string | null;
  contentText: string;
  contentJson: Record<string, unknown> | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
};

type GuestSessionSyncSessionPayload = {
  localSessionId: string;
  surface: AiCenterSurface;
  title: string;
  contextLabel: string | null;
  origin: string | null;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
  messages: GuestSessionSyncMessagePayload[];
};

type GuestSessionSyncPayload = {
  sessions: GuestSessionSyncSessionPayload[];
};

type CavAiMessageFeedbackState = {
  reaction: "like" | "dislike" | null;
  copyCount: number;
  shareCount: number;
  retryCount: number;
  updatedAt: string | null;
};

type CavAiQualityScores = {
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

type CavAiReasoningSummary = {
  intent: string;
  contextUsed: string[];
  checksPerformed: string[];
  answerPath: string[];
  uncertaintyNotes: string[];
  doneState: "done" | "partial";
};

type CavAiExecutionMeta = {
  durationMs: number;
  durationLabel: string;
  showReasoningChip: boolean;
  reasoningLabel: string;
  taskType: string;
  surface: string;
  action: string;
  actionClass: string;
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  researchMode: boolean;
  repairAttempted: boolean;
  repairApplied: boolean;
  contextSignals: string[];
  quality: CavAiQualityScores;
  safeSummary: CavAiReasoningSummary;
};

type CavAiMessageSegment = {
  kind: "text" | "prompt";
  text: string;
  language?: string | null;
};

type SessionActionModal =
  | { type: "share"; session: CavAiSessionSummary }
  | { type: "rename"; session: CavAiSessionSummary }
  | { type: "delete"; session: CavAiSessionSummary };

type GuestAuthStage = "email" | "login_password" | "signup_details";

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
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  iconSrc: string;
  snippet?: string | null;
  uploading?: boolean;
};

type ComposerImageViewerState = {
  imageId: string;
  dataUrl: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

type CavAiCenterSubmitOverride = {
  prompt?: string;
  action?: AiCenterAction;
  agentId?: string | null;
  agentActionKey?: string | null;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  researchMode?: boolean;
  deferUiRefresh?: boolean;
  showPendingPrompt?: boolean;
  researchUrls?: string[];
  images?: CavAiImageAttachment[];
  uploadedFiles?: CavAiUploadedFileAttachment[];
  sessionId?: string;
  contextLabel?: string | null;
  context?: Record<string, unknown>;
};

type CavAiCenterRetryDraft = Required<
  Pick<
    CavAiCenterSubmitOverride,
    "prompt" | "action" | "model" | "reasoningLevel" | "researchMode" | "images" | "uploadedFiles" | "sessionId" | "agentId" | "agentActionKey"
  >
> & {
  userMessageId: string;
  researchUrls: string[];
  contextLabel: string | null;
  context: Record<string, unknown>;
};

type CavAiMessageMediaPayload = {
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
  instructions: string;
  iconSvg: string;
  iconBackground: string | null;
  createdAt: string;
  publicationRequested: boolean;
  publicationRequestedAt: string | null;
};

type PublishedOperatorAgentRecord = {
  id: string;
  sourceAgentId: string;
  sourceUserId: string;
  sourceAccountId: string;
  ownerName: string;
  ownerUsername: string | null;
  name: string;
  summary: string;
  actionKey: string;
  surface: "cavcode" | "center" | "all";
  triggers: string[];
  instructions: string;
  iconSvg: string;
  iconBackground: string | null;
  publishedAt: string;
  updatedAt: string;
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

type CenterConfig = {
  contextLabel: string;
  actions: Array<{
    action: AiCenterAction;
    label: string;
    prompt: string;
  }>;
};

type ReasoningLevel = "low" | "medium" | "high" | "extra_high";
type VoiceCaptureIntent = "dictate" | "speak";
type ComposerMenu = "model" | "audio_model" | "reasoning" | "quick_actions" | "agent_mode" | null;
type FloatingComposerMenuAnchor = {
  menu: Exclude<ComposerMenu, null>;
  left: number;
  bottom: number;
  width: number;
  maxHeight: number;
};
type ComposerQuickActionId =
  | "add_files"
  | "upload_from_cavcloud"
  | "recent_files"
  | "create_image"
  | "edit_image"
  | "deep_research";
type ComposerQuickMode = "create_image" | "edit_image" | "deep_research" | "agent_mode";
type CavAiModelOption = {
  id: string;
  label: string;
};
type CavAiSelectableOption = CavAiModelOption & {
  locked: boolean;
};
type CavAiReasoningSelectableOption = {
  value: ReasoningLevel;
  label: string;
  locked: boolean;
};
type CenterAgentPlanId = "free" | "premium" | "premium_plus";
type CenterBuiltInAgentCatalogEntry = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  iconSrc: string;
  minimumPlan: CenterAgentPlanId;
  centerAction: AiCenterAction;
  family: "cavai" | "caven";
  surface: "cavcode" | "center" | "all";
  mode?: "general" | "companion";
};
type CenterRuntimeAgentOption = {
  id: string;
  name: string;
  summary: string;
  actionKey: string;
  iconSrc: string;
  minimumPlan: CenterAgentPlanId;
  centerAction: AiCenterAction | null;
  source: "builtin" | "custom" | "published";
  family: "cavai" | "caven";
  surface: "cavcode" | "center" | "all";
  mode: "general" | "companion";
  locked: boolean;
  bank: string;
  ownerName?: string | null;
  ownerUsername?: string | null;
};
type BuiltInRegistryCard = {
  id: string;
  name: string;
  summary: string;
  iconSrc: string;
  actionKey: string;
  cavcodeAction: string | null;
  centerAction: string | null;
  minimumPlan: CenterAgentPlanId;
  installed: boolean;
  locked: boolean;
  bank: string;
  supportForCaven: boolean;
  source: "builtin";
};
type AgentRegistrySnapshot = {
  generatedAt: string;
  caven: {
    installed: BuiltInRegistryCard[];
    available: BuiltInRegistryCard[];
    support: BuiltInRegistryCard[];
    premiumLocked: BuiltInRegistryCard[];
  };
  cavai: {
    installed: BuiltInRegistryCard[];
    available: BuiltInRegistryCard[];
    locked: BuiltInRegistryCard[];
  };
  companion: {
    installed: BuiltInRegistryCard[];
    available: BuiltInRegistryCard[];
  };
  hiddenSystemIds: string[];
};
type SidebarSurfaceMenuItem = {
  surface: AiCenterSurface;
  label: string;
  description: string;
};

const MAX_IMAGE_ATTACHMENTS_PREMIUM = 5;
const MAX_IMAGE_ATTACHMENTS_PREMIUM_PLUS = 10;
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_IMAGE_DATA_URL_CHARS = 1_200_000;
const TRANSPARENT_IMAGE_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const MAX_RECENT_IMAGE_LIBRARY = 12;
const MAX_AUDIO_BYTES = 25_000_000;
const CAVAI_UPLOAD_FOLDER_PATH = "/CavAi Uploads";
const MAX_CUSTOM_AGENT_ICON_SVG_CHARS = 120_000;
const CENTER_COMPOSER_MIN_HEIGHT_PX = 92;
const CENTER_COMPOSER_MAX_HEIGHT_PX = 198;
const CAVEN_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const CAVEN_AGENT_ACTION_KEY_RE = /^[a-z0-9][a-z0-9_]{1,63}$/;
const REASONING_LEVEL_OPTIONS: Array<{ value: ReasoningLevel; label: string }> = [
  { value: "low", label: toReasoningDisplayLabel("low") },
  { value: "medium", label: toReasoningDisplayLabel("medium") },
  { value: "high", label: toReasoningDisplayLabel("high") },
  { value: "extra_high", label: toReasoningDisplayLabel("extra_high") },
];
const DEFAULT_REASONING_LEVELS: ReasoningLevel[] = ["low", "medium"];
const AUDIO_RECORDER_MIME_OPTIONS = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];
const MAX_TTS_BLOB_CACHE_ITEMS = 18;
const CAVBOT_TTS_PLAYBACK_START_OFFSET_SEC = 0.08;
const CAVBOT_TTS_CONTINUATION_START_OFFSET_SEC = 0.035;
const CAVBOT_TTS_FIRST_CHUNK_MAX_CHARS = 8_000;
const CAVBOT_TTS_FIRST_CHUNK_SOFT_BREAK_MIN_CHARS = 2_000;
const CAVBOT_TTS_CHUNK_MAX_CHARS = 8_000;
const CAVBOT_TTS_CHUNK_SOFT_BREAK_MIN_CHARS = 2_000;
const CAVBOT_TTS_PREFETCH_CHUNK_WINDOW = 4;
const CAVBOT_TTS_PLAYBACK_TARGET_VOLUME = 0.84;
const CAVBOT_TTS_FADE_IN_MS = 80;
const CAVBOT_TTS_VOICE_ID = "Ethan";
const CAVBOT_TTS_INSTRUCTIONS = "Voice profile: Cavbot Ethan. Adult male baritone voice, low and grounded. Keep delivery direct, calm, and confident with a steady pace and crisp diction. Start exactly on the first spoken word with no pre-roll. Pronounce every word fully and clearly. Enunciate technical terms and hyphenated terms as distinct words with clean consonants. Maintain one consistent masculine tone and one consistent loudness across the entire response, including long paragraphs. Keep gain stable and flat: no crescendos, no emphasis spikes, no sudden volume jumps, and no sudden drops. No audible inhale, exhale, mouth noise, lip smack, hiss, gasp, breath, or sudden loud bursts. Keep the style plainspoken and studio-clean. Avoid bright or airy tone, playful cadence, sing-song inflection, theatrical emphasis, or dramatic pitch swings.";
const CAVBOT_TTS_PROFILE_CACHE_TAG = "male_bass_v5_locked";
const CAVBOT_TTS_AUDIO_FORMAT = "wav" as const;
const CAVBOT_TTS_LEAD_SILENCE_ANALYSIS_MAX_SEC = 0.65;
const CAVBOT_TTS_LEAD_SILENCE_FLOOR_SEC = 0.08;
const CAVBOT_TTS_LEAD_SILENCE_SUSTAIN_SEC = 0.006;
const CAVBOT_TTS_LEAD_SILENCE_PREROLL_SEC = 0.008;
const CAVBOT_TTS_LEAD_SILENCE_MIN_THRESHOLD = 0.0025;
const CAVBOT_TTS_LEAD_SILENCE_FLOOR_MULTIPLIER = 2.8;
const CAVBOT_TTS_LEAD_SILENCE_PEAK_RATIO = 0.018;
const SESSION_MESSAGE_PREFETCH_COUNT = 10;
const RECENT_FILES_EMPTY_HINT = "No recent files yet. Add a file and it will appear here.";
const CENTER_LOAD_SESSIONS_FAILED_MESSAGE = "Failed to load sessions.";
const CENTER_LOAD_MESSAGES_FAILED_MESSAGE = "Failed to load messages.";
const CAVAI_GUEST_SESSION_CACHE_STORAGE_PREFIX = "cavai_center_guest_session_cache_v1";
const CAVAI_GUEST_SESSION_CACHE_MAX_SESSIONS = 60;
const CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGE_ENTRIES = 80;
const CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGES_PER_SESSION = 240;
const CAVAI_GUEST_SYNC_LOCAL_SESSION_ID_MAX_CHARS = 160;
const CAVAI_GUEST_SYNC_TITLE_MAX_CHARS = 220;
const CAVAI_GUEST_SYNC_CONTEXT_LABEL_MAX_CHARS = 220;
const CAVAI_GUEST_SYNC_ORIGIN_MAX_CHARS = 240;
const CAVAI_GUEST_SYNC_PREVIEW_MAX_CHARS = 800;
const CAVAI_GUEST_SYNC_TIMESTAMP_MAX_CHARS = 120;
const CAVAI_GUEST_SYNC_ACTION_MAX_CHARS = 120;
const CAVAI_GUEST_SYNC_MESSAGE_MAX_CHARS = 40_000;
const CAVAI_GUEST_SYNC_PROVIDER_MAX_CHARS = 32;
const CAVAI_GUEST_SYNC_MODEL_MAX_CHARS = 120;
const CAVAI_GUEST_SYNC_STATUS_MAX_CHARS = 24;
const CAVAI_GUEST_SYNC_ERROR_CODE_MAX_CHARS = 120;
const CAVAI_GUEST_SESSION_SYNC_PENDING_STORAGE_KEY = "cavai_center_guest_sync_pending_v1";
const CAVAI_GUEST_PREVIEW_LOGIN_HREF = "/auth?mode=login&next=%2Fcavai";
const CAVAI_GUEST_PREVIEW_LOCK_MESSAGE = "Sign in to unlock uploads, image tools, advanced models, and deeper reasoning.";
const CAVAI_MOBILE_LAYOUT_BREAKPOINT_PX = 760;
const CAVAI_TERMS_OF_USE_HREF = "https://www.cavbot.io/terms-of-use";
const CAVAI_PRIVACY_POLICY_HREF = "https://www.cavbot.io/privacy-policy";

function resolveFloatingComposerMenuPreferredWidth(menu: Exclude<ComposerMenu, null>): number {
  if (menu === "agent_mode") return 338;
  if (menu === "quick_actions") return 244;
  return 200;
}

const CAVAI_GUEST_PREVIEW_MODELS: CavAiSelectableOption[] = [
  {
    id: ALIBABA_QWEN_FLASH_MODEL_ID,
    label: "Qwen3.5-Flash",
    locked: false,
  },
  {
    id: CAVAI_AUTO_MODEL_ID,
    label: "CavAi Auto",
    locked: true,
  },
  {
    id: DEEPSEEK_CHAT_MODEL_ID,
    label: "DeepSeek Chat",
    locked: true,
  },
  {
    id: ALIBABA_QWEN_CHARACTER_MODEL_ID,
    label: "CavBot Companion",
    locked: true,
  },
  {
    id: DEEPSEEK_REASONER_MODEL_ID,
    label: "DeepSeek Reasoner",
    locked: true,
  },
  {
    id: ALIBABA_QWEN_PLUS_MODEL_ID,
    label: "Qwen3.5-Plus",
    locked: true,
  },
  {
    id: ALIBABA_QWEN_MAX_MODEL_ID,
    label: "Qwen3-Max",
    locked: true,
  },
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

function hashSpeechText(value: string): string {
  const input = String(value || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function resolveSpeechCacheKey(_speakingKeyRaw: string, text: string): string {
  return `text:${hashSpeechText(`${CAVBOT_TTS_PROFILE_CACHE_TAG}|${CAVBOT_TTS_VOICE_ID}|${text}`)}`;
}

function splitSpeechTextIntoChunks(textRaw: string): string[] {
  const text = s(textRaw).replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (text.length <= CAVBOT_TTS_CHUNK_MAX_CHARS) return [text];

  const chunks: string[] = [];
  let cursor = 0;
  let isFirstChunk = true;
  while (cursor < text.length) {
    const chunkMaxChars = isFirstChunk ? CAVBOT_TTS_FIRST_CHUNK_MAX_CHARS : CAVBOT_TTS_CHUNK_MAX_CHARS;
    const chunkMinBreak = isFirstChunk ? CAVBOT_TTS_FIRST_CHUNK_SOFT_BREAK_MIN_CHARS : CAVBOT_TTS_CHUNK_SOFT_BREAK_MIN_CHARS;
    let end = Math.min(cursor + chunkMaxChars, text.length);
    if (end < text.length) {
      const window = text.slice(cursor, end);
      const sentenceBreak = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
        window.lastIndexOf("; ")
      );
      const clauseBreak = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
      const breakPos = Math.max(sentenceBreak, clauseBreak);
      if (breakPos >= chunkMinBreak) {
        end = cursor + breakPos + 1;
      }
    }

    if (end <= cursor) {
      end = Math.min(cursor + chunkMaxChars, text.length);
    }
    const chunk = text.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    cursor = end;
    isFirstChunk = false;
  }

  return chunks.length ? chunks : [text];
}

function normalizeSpeechTextForTts(textRaw: string): string {
  let text = normalizeCenterMessageText(textRaw);
  if (!text) return "";
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  text = text.replace(/```([\s\S]*?)```/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/[–—]/g, "-");
  text = text.replace(/([A-Za-z])\-([A-Za-z])/g, "$1 $2");
  text = text.replace(/&/g, " and ");
  text = text.replace(/@/g, " at ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, 8_000);
}

function detectLeadingSpeechTrimOffsetSec(decoded: AudioBuffer): number {
  const sampleRate = Math.max(1, Number(decoded.sampleRate) || 0);
  const totalFrames = Math.max(0, Number(decoded.length) || 0);
  const channelCount = Math.max(1, Number(decoded.numberOfChannels) || 0);
  if (!sampleRate || !totalFrames || !channelCount) return 0;

  const analysisFrames = Math.min(
    totalFrames,
    Math.max(1, Math.floor(sampleRate * CAVBOT_TTS_LEAD_SILENCE_ANALYSIS_MAX_SEC))
  );
  if (analysisFrames <= 0) return 0;

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(decoded.getChannelData(channel));
  }

  const floorFrames = Math.min(
    analysisFrames,
    Math.max(1, Math.floor(sampleRate * CAVBOT_TTS_LEAD_SILENCE_FLOOR_SEC))
  );
  let peak = 0;
  let floorPeak = 0;
  for (let frame = 0; frame < analysisFrames; frame += 1) {
    let framePeak = 0;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = Math.abs(channels[channel]?.[frame] || 0);
      if (sample > framePeak) framePeak = sample;
    }
    if (framePeak > peak) peak = framePeak;
    if (frame < floorFrames && framePeak > floorPeak) floorPeak = framePeak;
  }
  if (peak < CAVBOT_TTS_LEAD_SILENCE_MIN_THRESHOLD) return 0;

  const threshold = Math.min(
    0.24,
    Math.max(
      CAVBOT_TTS_LEAD_SILENCE_MIN_THRESHOLD,
      floorPeak * CAVBOT_TTS_LEAD_SILENCE_FLOOR_MULTIPLIER,
      peak * CAVBOT_TTS_LEAD_SILENCE_PEAK_RATIO
    )
  );

  const sustainFrames = Math.max(1, Math.floor(sampleRate * CAVBOT_TTS_LEAD_SILENCE_SUSTAIN_SEC));
  let run = 0;
  let onsetFrame = -1;
  for (let frame = 0; frame < analysisFrames; frame += 1) {
    let framePeak = 0;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const sample = Math.abs(channels[channel]?.[frame] || 0);
      if (sample > framePeak) framePeak = sample;
    }
    if (framePeak >= threshold) {
      run += 1;
      if (run >= sustainFrames) {
        onsetFrame = frame - run + 1;
        break;
      }
      continue;
    }
    run = 0;
  }
  if (onsetFrame <= 0) return 0;

  const prerollFrames = Math.max(0, Math.floor(sampleRate * CAVBOT_TTS_LEAD_SILENCE_PREROLL_SEC));
  const trimFrames = Math.max(0, onsetFrame - prerollFrames);
  return trimFrames / sampleRate;
}

async function analyzeSpeechLeadTrimOffsetSec(blob: Blob): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  const ctx = new AudioContextCtor();
  try {
    const encoded = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(encoded.slice(0));
    const detected = detectLeadingSpeechTrimOffsetSec(decoded);
    if (!Number.isFinite(detected) || detected < 0) return 0;
    return detected;
  } catch {
    return null;
  } finally {
    void ctx.close().catch(() => {});
  }
}

function toSpeechErrorMessage(error: unknown): string {
  if (error instanceof Error) return s(error.message);
  if (typeof error === "string") return s(error);
  return "";
}

function toVoiceCaptureErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access was denied. Allow microphone access and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone was detected on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Microphone access is busy in another app. Close the other app and try again.";
    }
  }
  const message = toSpeechErrorMessage(error).trim();
  if (!message) return "Voice capture failed.";
  const lowered = message.toLowerCase();
  if (
    lowered.includes("permission denied")
    || lowered.includes("notallowederror")
    || lowered.includes("user denied")
  ) {
    return "Microphone access was denied. Allow microphone access and try again.";
  }
  if (
    lowered.includes("microphone is not allowed in this document")
    || lowered.includes("permissions policy violation")
  ) {
    return "Microphone access is blocked by the app security policy.";
  }
  return message;
}

function isSpeechPlaybackBlockedError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "NotAllowedError") return true;
  const message = toSpeechErrorMessage(error).toLowerCase();
  if (!message) return false;
  return (
    message.includes("notallowederror")
    || message.includes("not allowed by the user agent")
    || message.includes("user denied permission")
    || message.includes("play() failed")
    || message.includes("interact with the document")
  );
}

function reasoningLevelRank(level: ReasoningLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  return 4;
}

function parseReasoningLevel(raw: unknown): ReasoningLevel | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "low" || value === "medium" || value === "high" || value === "extra_high") return value;
  return null;
}

function reasoningLevelsUpTo(maxRaw: unknown): ReasoningLevel[] {
  const max = parseReasoningLevel(maxRaw);
  if (!max) return DEFAULT_REASONING_LEVELS;
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => reasoningLevelRank(level) <= reasoningLevelRank(max));
}

function reasoningLevelsForPlan(planIdRaw: unknown): ReasoningLevel[] {
  const plan = String(planIdRaw ?? "").trim().toLowerCase();
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

function hasBootProfileSignal(value: {
  fullName?: unknown;
  email?: unknown;
  username?: unknown;
  initials?: unknown;
} | null | undefined): boolean {
  if (!value) return false;
  return Boolean(s(value.fullName) || s(value.email) || s(value.username) || s(value.initials));
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

function toPlanTierLabel(value: unknown): "Free" | "Premium" | "Premium+" {
  const plan = normalizePlanId(value);
  if (plan === "premium_plus") return "Premium+";
  if (plan === "premium") return "Premium";
  return "Free";
}

function planTierRank(plan: "free" | "premium" | "premium_plus"): number {
  if (plan === "premium_plus") return 3;
  if (plan === "premium") return 2;
  return 1;
}

function centerPlanModelIds(planIdRaw: unknown): string[] {
  const planId = normalizePlanId(planIdRaw);
  const ids = [
    DEEPSEEK_CHAT_MODEL_ID,
    ALIBABA_QWEN_FLASH_MODEL_ID,
    ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ];
  if (planId === "premium" || planId === "premium_plus") {
    ids.push(
      DEEPSEEK_REASONER_MODEL_ID,
      ALIBABA_QWEN_PLUS_MODEL_ID,
      ALIBABA_QWEN_IMAGE_MODEL_ID
    );
  }
  if (planId === "premium_plus") {
    ids.push(ALIBABA_QWEN_MAX_MODEL_ID, ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
  }
  return Array.from(new Set(ids));
}

function centerPlanModelOptions(planIdRaw: unknown): CavAiModelOption[] {
  return centerPlanModelIds(planIdRaw).map((id) => ({
    id,
    label: resolveAiModelLabel(id),
  }));
}

function clampCenterModelOptionsToPlan(
  options: CavAiModelOption[],
  planIdRaw: unknown
): CavAiModelOption[] {
  const allowed = new Set(centerPlanModelIds(planIdRaw));
  return normalizeCenterModelOptions(options.filter((option) => allowed.has(s(option.id))));
}

function clampCenterReasoningLevelsToPlan(
  options: ReasoningLevel[],
  planIdRaw: unknown
): ReasoningLevel[] {
  const set = new Set<ReasoningLevel>(reasoningLevelsForPlan(planIdRaw));
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => set.has(level) && options.includes(level));
}

function isPlanLocked(args: {
  accountPlanId: "free" | "premium" | "premium_plus";
  minimumPlan: CenterAgentPlanId;
}): boolean {
  return planTierRank(args.accountPlanId) < planTierRank(args.minimumPlan);
}

function normalizeReasoningOptions(raw: unknown): ReasoningLevel[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((item) => parseReasoningLevel(item))
    .filter(Boolean) as ReasoningLevel[];
  const unique = Array.from(new Set(parsed));
  return REASONING_LEVEL_OPTIONS
    .map((option) => option.value)
    .filter((level) => unique.includes(level));
}

const CENTER_CONFIG: Record<AiCenterSurface, CenterConfig> = {
  general: {
    contextLabel: "General context",
    actions: [
      { action: "technical_recap", label: "General Assist", prompt: "Answer the user's question directly and clearly." },
      {
        action: "summarize_thread",
        label: "Summarize Thread",
        prompt: "Summarize this thread into concise decisions and next steps.",
      },
      { action: "bullets_to_plan", label: "Bullets to Plan", prompt: "Turn these bullets into an execution plan with owners and order." },
      { action: "write_note", label: "Write Note", prompt: "Write a clear note from the user's request." },
      { action: "companion_chat", label: "CavBot Companion", prompt: "Talk to CavBot in a calm, supportive, focused way." },
      { action: "image_studio", label: "Image Studio", prompt: "Generate a high-quality image concept from this prompt." },
      { action: "image_edit", label: "Image Edit", prompt: "Edit the uploaded image according to this prompt." },
    ],
  },
  workspace: {
    contextLabel: "Workspace context",
    actions: [
      { action: "technical_recap", label: "General Assist", prompt: "Answer directly with practical help for this workspace context." },
      {
        action: "summarize_thread",
        label: "Summarize Thread",
        prompt: "Summarize this workspace thread into concise decisions and next steps.",
      },
      { action: "bullets_to_plan", label: "Bullets to Plan", prompt: "Turn these bullets into an execution plan with owners and order." },
      { action: "write_note", label: "Write Note", prompt: "Write a clear workspace note for current priorities." },
      { action: "companion_chat", label: "CavBot Companion", prompt: "Talk to CavBot in a calm, supportive, focused way." },
      { action: "image_studio", label: "Image Studio", prompt: "Generate a high-quality image concept from this prompt." },
      { action: "image_edit", label: "Image Edit", prompt: "Edit the uploaded image according to this prompt." },
    ],
  },
  console: {
    contextLabel: "Console context",
    actions: [
      { action: "explain_spike", label: "Explain Spike", prompt: "Explain this telemetry spike and likely root causes from available context." },
      { action: "summarize_issues", label: "Summarize Issues", prompt: "Summarize current issues by severity and blast radius." },
      { action: "prioritize_fixes", label: "Prioritize Fixes", prompt: "Prioritize fixes with low-risk, high-impact order." },
      { action: "write_incident_note", label: "Incident Note", prompt: "Draft an incident note with timeline, impact, and mitigations." },
      { action: "recommend_next_steps", label: "Next Steps", prompt: "Recommend concrete next steps for the current posture." },
    ],
  },
  cavcloud: {
    contextLabel: "CavCloud context",
    actions: [
      { action: "summarize_folder", label: "Summarize Folder", prompt: "Summarize this folder's purpose, risks, and key artifacts." },
      { action: "explain_artifact", label: "Explain Artifact", prompt: "Explain this artifact's current state and what to do next." },
      { action: "draft_publish_copy", label: "Draft Publish Copy", prompt: "Draft publish-ready copy for this artifact set." },
      {
        action: "organize_storage",
        label: "Organize Storage",
        prompt: "Recommend a clean folder organization strategy with naming rules.",
      },
    ],
  },
  cavsafe: {
    contextLabel: "CavSafe context",
    actions: [
      {
        action: "explain_access_restrictions",
        label: "Explain Restrictions",
        prompt: "Explain current access restrictions and expected policy outcomes.",
      },
      {
        action: "summarize_secure_file",
        label: "Summarize Secure File",
        prompt: "Summarize this secured item without leaking sensitive data.",
      },
      {
        action: "review_collaboration_state",
        label: "Collaboration Review",
        prompt: "Review collaboration state and highlight risky permission patterns.",
      },
      {
        action: "audit_access_context",
        label: "Audit Access",
        prompt: "Audit this access context and list high-confidence follow-up checks.",
      },
      { action: "write_note", label: "Private Note", prompt: "Draft a private operational note for this secure context." },
    ],
  },
  cavpad: {
    contextLabel: "CavPad context",
    actions: [
      { action: "write_note", label: "Write Note", prompt: "Write a structured note from this context." },
      { action: "summarize_thread", label: "Summarize Thread", prompt: "Summarize this note thread with key decisions." },
      { action: "rewrite_clearly", label: "Rewrite Clearly", prompt: "Rewrite this content clearly and directly." },
      { action: "technical_recap", label: "Technical Recap", prompt: "Create a technical recap suitable for engineers." },
      { action: "bullets_to_plan", label: "Bullets to Plan", prompt: "Convert these bullets into an ordered execution plan." },
    ],
  },
  cavcode: {
    contextLabel: "CavCode context",
    actions: [
      { action: "recommend_next_steps", label: "Next Steps", prompt: "Recommend next engineering steps for the current coding context." },
      {
        action: "write_note",
        label: "Engineering Note",
        prompt: "Write an engineering note summarizing current code-state decisions.",
      },
      {
        action: "technical_recap",
        label: "Technical Recap",
        prompt: "Create a technical recap for the current file and diagnostics context.",
      },
    ],
  },
};

const SIDEBAR_SURFACE_MENU: SidebarSurfaceMenuItem[] = [
  { surface: "general", label: "CavAi", description: "Ask across any topic with full general AI assistance." },
  { surface: "cavcode", label: "Caven", description: "Run coding-focused reasoning and implementation support." },
];

const CENTER_BUILT_IN_AGENT_BANK: CenterBuiltInAgentCatalogEntry[] = [
  {
    id: "financial_advisor",
    name: "Financial Advisor",
    summary: "Clarify budgeting, tradeoffs, and money decisions with practical, grounded planning support.",
    actionKey: "financial_advisor",
    iconSrc: "/icons/finance-symbol-of-four-currencies-on-a-hand-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "financial_advisor",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "therapist_support",
    name: "Therapist Support",
    summary: "Offer reflective grounding and emotional processing support without claiming clinical authority.",
    actionKey: "therapist_support",
    iconSrc: "/icons/friend-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "therapist_support",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "mentor",
    name: "Mentor",
    summary: "Drive disciplined growth, pattern recognition, and next-move guidance for long-term progress.",
    actionKey: "mentor",
    iconSrc: "/icons/person-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "mentor",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "best_friend",
    name: "Best Friend",
    summary: "Bring warm perspective, honest encouragement, and steady companionship in daily decisions.",
    actionKey: "best_friend",
    iconSrc: "/icons/teddy-bear-with-heart-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "best_friend",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "relationship_advisor",
    name: "Relationship Advisor",
    summary: "Help frame communication, conflict, and emotional perspective with balanced, practical advice.",
    actionKey: "relationship_advisor",
    iconSrc: "/icons/relationship-counseling-marriage-counseling-couples-therapy-marriage-therapy-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "relationship_advisor",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "philosopher",
    name: "Philosopher",
    summary: "Expand perspective with deeper framing, meaning, and thoughtful reflection for better decisions.",
    actionKey: "philosopher",
    iconSrc: "/icons/priest-2-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "philosopher",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "focus_coach",
    name: "Focus Coach",
    summary: "Cut overwhelm, re-center priorities, and convert intent into concrete execution steps.",
    actionKey: "focus_coach",
    iconSrc: "/icons/focus-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "focus_coach",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "life_strategist",
    name: "Life Strategist",
    summary: "Connect life goals and work goals with practical sequencing and realistic momentum plans.",
    actionKey: "life_strategist",
    iconSrc: "/icons/achievement-2-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "life_strategist",
    family: "cavai",
    surface: "center",
    mode: "companion",
  },
  {
    id: "email_text_agent",
    name: "Messenger",
    summary: "Draft, rewrite, and tone-shift emails or messages for professional and personal use cases.",
    actionKey: "email_text_agent",
    iconSrc: "/icons/smartphone-2-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "email_text_agent",
    family: "cavai",
    surface: "center",
  },
  {
    id: "content_creator",
    name: "Content Creator",
    summary: "Generate structured titles, sections, paragraphs, and website-ready content blocks.",
    actionKey: "content_creator",
    iconSrc: "/icons/app/aperture-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "content_creator",
    family: "cavai",
    surface: "center",
  },
  {
    id: "legal_privacy_terms_ethics_agent",
    name: "Counsel",
    summary: "Draft policy and terms-style language with compliance-conscious structure and legal-review framing.",
    actionKey: "legal_privacy_terms_ethics_agent",
    iconSrc: "/icons/legal-hammer-symbol-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "legal_privacy_terms_ethics_agent",
    family: "cavai",
    surface: "center",
  },
  {
    id: "pdf_create_edit_preview_agent",
    name: "PDF Studio",
    summary: "Generate, refine, and preview PDF-ready outputs for clean document workflows.",
    actionKey: "pdf_create_edit_preview_agent",
    iconSrc: "/icons/pdf-file-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "pdf_create_edit_preview_agent",
    family: "cavai",
    surface: "center",
  },
  {
    id: "page_404_builder_agent",
    name: "404 Builder",
    summary: "Create 404 route-page content and code guidance for polished not-found experiences.",
    actionKey: "page_404_builder_agent",
    iconSrc: "/icons/link-broken-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "page_404_builder_agent",
    family: "cavai",
    surface: "center",
  },
  {
    id: "doc_edit_review_agent",
    name: "Doc Review",
    summary: "Review, rewrite, and improve document clarity, structure, and editorial quality.",
    actionKey: "doc_edit_review_agent",
    iconSrc: "/icons/doc-on-doc-fill-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "doc_edit_review_agent",
    family: "cavai",
    surface: "center",
  },
  {
    id: "error_explainer",
    name: "Error Explainer",
    summary: "Break down compiler and runtime errors into plain language with likely causes.",
    actionKey: "explain_error",
    iconSrc: "/icons/app/alert-caution-error-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "summarize_issues",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "fix_draft",
    name: "Fix Draft",
    summary: "Generate an initial patch proposal for a bug with low-risk defaults.",
    actionKey: "suggest_fix",
    iconSrc: "/icons/app/cavcode/agents/repairing-browser-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "prioritize_fixes",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "safe_refactor",
    name: "Safe Refactor",
    summary: "Refactor code while preserving behavior and reducing accidental regressions.",
    actionKey: "refactor_safely",
    iconSrc: "/icons/app/cavcode/agents/security-priority-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "code_explainer",
    name: "Code Explainer",
    summary: "Explain complex files and call flows quickly for onboarding and review.",
    actionKey: "explain_code",
    iconSrc: "/icons/app/cavcode/agents/compile-compiler-script-code-config-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "file_summarizer",
    name: "File Summarizer",
    summary: "Summarize large files into concise technical notes and key takeaways.",
    actionKey: "summarize_file",
    iconSrc: "/icons/app/cavcode/agents/note-favorite-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "summarize_thread",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "component_builder",
    name: "Component Builder",
    summary: "Generate reusable UI components with consistent structure and naming.",
    actionKey: "generate_component",
    iconSrc: "/icons/app/cavcode/agents/web-application-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "section_builder",
    name: "Section Builder",
    summary: "Draft complete page sections from intent, content, and layout direction.",
    actionKey: "generate_section",
    iconSrc: "/icons/app/cavcode/agents/window-section-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "page_builder",
    name: "Page Builder",
    summary: "Generate full page scaffolds with coherent structure and implementation hints.",
    actionKey: "generate_page",
    iconSrc: "/icons/app/cavcode/agents/page-builder-clean.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "seo_improver",
    name: "SEO Improver",
    summary: "Improve metadata, headings, and content structure for search discoverability.",
    actionKey: "improve_seo",
    iconSrc: "/icons/app/cavcode/agents/seo-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "web_research",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "engineering_note",
    name: "Engineering Note",
    summary: "Write clean changelogs, technical notes, and implementation summaries.",
    actionKey: "write_note",
    iconSrc: "/icons/app/cavcode/agents/engineering-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "write_note",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "competitor_intelligence",
    name: "Competitor Intelligence",
    summary: "Research competitor products, positioning, pricing, and feature gaps with evidence-first comparisons.",
    actionKey: "competitor_research",
    iconSrc: "/icons/app/chart-bubble-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "web_research",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "accessibility_auditor",
    name: "Accessibility Auditor",
    summary: "Audit code for WCAG and a11y risks, then propose practical remediation steps and patches.",
    actionKey: "accessibility_audit",
    iconSrc: "/icons/app/cavcode/agents/accessibility-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "web_research_analyst",
    name: "Web Research Analyst",
    summary: "Synthesize external signals into actionable insights for technical decisions.",
    actionKey: "web_research",
    iconSrc: "/icons/app/connection-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "web_research",
    family: "cavai",
    surface: "center",
  },
  {
    id: "incident_analyst",
    name: "Incident Analyst",
    summary: "Digest issue spikes and produce prioritized incident response recommendations.",
    actionKey: "summarize_issues",
    iconSrc: "/icons/app/cavcode/agents/alert-symbol-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "summarize_issues",
    family: "cavai",
    surface: "center",
  },
  {
    id: "storage_organizer",
    name: "Storage Organizer",
    summary: "Recommend cleaner folder structures and artifact organization patterns.",
    actionKey: "organize_storage",
    iconSrc: "/icons/app/storage-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "organize_storage",
    family: "cavai",
    surface: "center",
  },
  {
    id: "access_auditor",
    name: "Access Auditor",
    summary: "Explain access constraints and flag risky sharing or permission gaps.",
    actionKey: "audit_access_context",
    iconSrc: "/icons/app/cavcode/agents/grapheneos-auditor-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "audit_access_context",
    family: "cavai",
    surface: "center",
  },
  {
    id: "thread_summarizer",
    name: "Thread Summarizer",
    summary: "Condense long threads into clear summaries and rewrite drafts for clarity.",
    actionKey: "summarize_thread",
    iconSrc: "/icons/app/cavcode/agents/message-basic-app-conversation-chat-svgrepo-com.svg",
    minimumPlan: "free",
    centerAction: "summarize_thread",
    family: "cavai",
    surface: "center",
  },
  {
    id: "knowledge_grounding_curator",
    name: "Knowledge Grounding",
    summary: "Ingest docs/pages into retrieval-ready context packs with citations-first grounding.",
    actionKey: "knowledge_grounding",
    iconSrc: "/icons/app/deep-learning-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "web_research",
    family: "cavai",
    surface: "center",
  },
  {
    id: "deterministic_research_planner",
    name: "Deterministic Research Planner",
    summary: "Break one request into deterministic sub-queries and return an evidence matrix.",
    actionKey: "deterministic_research",
    iconSrc: "/icons/app/research-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "web_research",
    family: "cavai",
    surface: "center",
  },
  {
    id: "citation_only_answerer",
    name: "Citation-Only Answerer",
    summary: "Answer strictly from retrieved sources with confidence signals and cited claims.",
    actionKey: "citation_only_answer",
    iconSrc: "/icons/app/block-quote-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "web_research",
    family: "cavai",
    surface: "center",
  },
  {
    id: "prompt_compiler",
    name: "Prompt Compiler",
    summary: "Compile vague requests into structured prompts with constraints and output contracts.",
    actionKey: "compile_prompt",
    iconSrc: "/icons/cavpad/sparkles-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "bullets_to_plan",
    family: "cavai",
    surface: "center",
  },
  {
    id: "memory_curator",
    name: "Memory Curator",
    summary: "Distill conversations into durable, versioned facts and decision memory.",
    actionKey: "curate_memory",
    iconSrc: "/icons/app/memory-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "summarize_thread",
    family: "cavai",
    surface: "center",
  },
  {
    id: "grounding_gap_detector",
    name: "Grounding Gap Detector",
    summary: "Detect weak grounding, missing evidence, and ask targeted follow-up questions.",
    actionKey: "detect_grounding_gaps",
    iconSrc: "/icons/app/grid-3x3-gap-fill-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "web_research",
    family: "cavai",
    surface: "center",
  },
  {
    id: "execution_critic",
    name: "Execution Critic",
    summary: "Run pre-send QA on drafts to catch drift, missing steps, and constraints mismatch.",
    actionKey: "critique_execution",
    iconSrc: "/icons/app/operation-and-maintenance-center-execution-record-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "spec_to_tasks_orchestrator",
    name: "Spec-to-Tasks Orchestrator",
    summary: "Convert product intent into deterministic task graphs with ordered implementation steps.",
    actionKey: "orchestrate_spec_tasks",
    iconSrc: "/icons/app/graph-bar-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "bullets_to_plan",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "api_schema_contract_guard",
    name: "API Schema Contract Guard",
    summary: "Validate changes against API and schema contracts before execution and rollout.",
    actionKey: "guard_api_contracts",
    iconSrc: "/icons/app/api-app-svgrepo-com.svg",
    minimumPlan: "premium_plus",
    centerAction: "technical_recap",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "ui_mockup_generator",
    name: "UI Mockup Generator",
    summary: "Generate UI mockups with paired implementation code for websites and apps.",
    actionKey: "ui_mockup_generator",
    iconSrc: "/icons/app/atom-ai-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "image_studio",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "website_visual_builder",
    name: "Website Visual Builder",
    summary: "Create website-ready visual assets and variants for pages, features, and campaigns.",
    actionKey: "website_visual_builder",
    iconSrc: "/icons/app/wireframe-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "image_studio",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "app_screenshot_enhancer",
    name: "App Screenshot Enhancer",
    summary: "Enhance product screenshots into marketing-ready visuals with advanced image editing.",
    actionKey: "app_screenshot_enhancer",
    iconSrc: "/icons/app/screenshot-2-svgrepo-com.svg",
    minimumPlan: "premium_plus",
    centerAction: "image_edit",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "brand_asset_generator",
    name: "Brand Asset Generator",
    summary: "Generate branded icons, banners, and campaign visuals aligned with your product identity.",
    actionKey: "brand_asset_generator",
    iconSrc: "/icons/app/star-rings-svgrepo-com.svg",
    minimumPlan: "premium",
    centerAction: "image_studio",
    family: "caven",
    surface: "cavcode",
  },
  {
    id: "ui_debug_visualizer",
    name: "UI Debug Visualizer",
    summary: "Visualize expected UI states and suggest practical code fixes for layout mismatches.",
    actionKey: "ui_debug_visualizer",
    iconSrc: "/icons/app/bug-fix-search-virus-debug-find-svgrepo-com.svg",
    minimumPlan: "premium_plus",
    centerAction: "image_studio",
    family: "caven",
    surface: "cavcode",
  },
];

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function isValidEmailAddress(value: string): boolean {
  const normalized = s(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized);
}

function suggestGuestAuthUsername(email: string): string {
  const localPart = s(email).toLowerCase().split("@")[0] || "cavbotuser";
  const cleaned = normalizeUsername(localPart.replace(/[^a-z0-9_]/g, ""));
  if (isValidUsername(cleaned) && !isReservedUsername(cleaned)) return cleaned;
  const fallback = normalizeUsername(`cavbot${Math.random().toString(36).slice(2, 8)}`);
  if (isValidUsername(fallback) && !isReservedUsername(fallback)) return fallback;
  return "cavbotuser";
}

function mapGuestAuthError(errorCode: unknown, fallback: string): string {
  const code = s(errorCode).toLowerCase();
  if (!code) return fallback;
  if (code === "invalid_credentials") return "Incorrect email or password.";
  if (code === "missing_credentials") return "Email and password are required.";
  if (code === "email_required") return "Email is required.";
  if (code === "invalid_email") return "Enter a valid email address.";
  if (code === "weak_password") return "Password must be at least 10 characters.";
  if (code === "username_required") return "Username is required to create an account.";
  if (code === "username_lowercase") return "Username must be lowercase.";
  if (code === "invalid_username") return "Username must be 3-20 characters, lowercase, and start with a letter.";
  if (code === "username_reserved") return "That username is reserved.";
  if (code === "username_in_use") return "That username is already in use.";
  if (code === "email_in_use") return "That email already has an account.";
  if (code === "signup_disabled") return "Sign up is currently disabled.";
  if (code === "lookup_failed") return "Unable to continue with email right now.";
  return fallback;
}

const EMPTY_AGENT_REGISTRY_SNAPSHOT: AgentRegistrySnapshot = {
  generatedAt: "",
  caven: {
    installed: [],
    available: [],
    support: [],
    premiumLocked: [],
  },
  cavai: {
    installed: [],
    available: [],
    locked: [],
  },
  companion: {
    installed: [],
    available: [],
  },
  hiddenSystemIds: [],
};

const LEGACY_CENTER_BUILT_IN_AGENT_BY_ID = new Map(
  CENTER_BUILT_IN_AGENT_BANK.map((row) => [row.id, row])
);

function normalizeBuiltInRegistryCard(value: unknown): BuiltInRegistryCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id).toLowerCase();
  const name = s(row.name);
  if (!id || !name) return null;
  const plan = normalizePlanId(row.minimumPlan);
  return {
    id,
    name,
    summary: s(row.summary),
    iconSrc: s(row.iconSrc),
    actionKey: s(row.actionKey).toLowerCase(),
    cavcodeAction: s(row.cavcodeAction).toLowerCase() || null,
    centerAction: s(row.centerAction).toLowerCase() || null,
    minimumPlan: plan,
    installed: row.installed === true,
    locked: row.locked === true,
    bank: s(row.bank).toLowerCase(),
    supportForCaven: row.supportForCaven === true,
    source: "builtin",
  };
}

function normalizeBuiltInRegistryCardList(value: unknown): BuiltInRegistryCard[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: BuiltInRegistryCard[] = [];
  for (const item of value) {
    const parsed = normalizeBuiltInRegistryCard(item);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    rows.push(parsed);
  }
  return rows;
}

function normalizeAgentRegistrySnapshot(value: unknown): AgentRegistrySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_AGENT_REGISTRY_SNAPSHOT };
  }
  const row = value as Record<string, unknown>;
  const caven = row.caven && typeof row.caven === "object" && !Array.isArray(row.caven)
    ? row.caven as Record<string, unknown>
    : {};
  const cavai = row.cavai && typeof row.cavai === "object" && !Array.isArray(row.cavai)
    ? row.cavai as Record<string, unknown>
    : {};
  const companion = row.companion && typeof row.companion === "object" && !Array.isArray(row.companion)
    ? row.companion as Record<string, unknown>
    : {};

  return {
    generatedAt: s(row.generatedAt),
    caven: {
      installed: normalizeBuiltInRegistryCardList(caven.installed),
      available: normalizeBuiltInRegistryCardList(caven.available),
      support: normalizeBuiltInRegistryCardList(caven.support),
      premiumLocked: normalizeBuiltInRegistryCardList(caven.premiumLocked),
    },
    cavai: {
      installed: normalizeBuiltInRegistryCardList(cavai.installed),
      available: normalizeBuiltInRegistryCardList(cavai.available),
      locked: normalizeBuiltInRegistryCardList(cavai.locked),
    },
    companion: {
      installed: normalizeBuiltInRegistryCardList(companion.installed),
      available: normalizeBuiltInRegistryCardList(companion.available),
    },
    hiddenSystemIds: Array.isArray(row.hiddenSystemIds)
      ? row.hiddenSystemIds.map((item) => s(item).toLowerCase()).filter(Boolean)
      : [],
  };
}

function flattenBuiltInRegistryCards(snapshot: AgentRegistrySnapshot): BuiltInRegistryCard[] {
  const seen = new Set<string>();
  const rows: BuiltInRegistryCard[] = [];
  const buckets: BuiltInRegistryCard[][] = [
    snapshot.caven.installed,
    snapshot.caven.available,
    snapshot.caven.support,
    snapshot.caven.premiumLocked,
    snapshot.cavai.installed,
    snapshot.cavai.available,
    snapshot.cavai.locked,
    snapshot.companion.installed,
    snapshot.companion.available,
  ];
  for (const bucket of buckets) {
    for (const card of bucket) {
      if (!card.id || seen.has(card.id)) continue;
      seen.add(card.id);
      rows.push(card);
    }
  }
  return rows;
}

function toCenterRuntimeBuiltInAgent(args: {
  card: BuiltInRegistryCard;
}): CenterRuntimeAgentOption {
  const legacy = LEGACY_CENTER_BUILT_IN_AGENT_BY_ID.get(args.card.id);
  const centerAction = toAiCenterAction(args.card.centerAction) || toAiCenterAction(args.card.actionKey);
  const resolvedMode: "general" | "companion" =
    legacy?.mode === "companion" || args.card.bank === "companion" ? "companion" : "general";
  const resolvedFamily: "cavai" | "caven" =
    legacy?.family === "caven" || args.card.bank === "caven" || args.card.supportForCaven ? "caven" : "cavai";
  return {
    id: args.card.id,
    name: args.card.name,
    summary: args.card.summary,
    actionKey: args.card.actionKey,
    iconSrc: args.card.iconSrc || legacy?.iconSrc || "",
    minimumPlan: args.card.minimumPlan,
    centerAction,
    source: "builtin",
    family: resolvedFamily,
    surface: "center",
    mode: resolvedMode,
    locked: args.card.locked,
    bank: args.card.bank,
  };
}

const IMAGE_STUDIO_PRESET_LOCK_POLICY_SECTIONS = [
  {
    title: "Preset Protection",
    paragraphs: [
      "CavAi is using the full preset behind the scenes.",
      "Detailed generation prompts stay hidden to preserve consistency, protect premium styles, and keep output quality high.",
    ],
  },
  {
    title: "Activation Line Rules",
    paragraphs: [
      "The text shown in the box is only a visible activation line.",
      "The first line stays locked.",
      "If no second-line text is added, CavAi ignores that line and runs the hidden preset as-is.",
      "If the user adds text on the second line, CavAi treats that added text as a custom instruction and combines it with the hidden preset system.",
    ],
  },
] as const;
type ImageStudioActivationLineMode = "create" | "edit";

function normalizeLineBreaks(value: string): string {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function splitFirstLine(value: string): { firstLine: string; remainder: string } {
  const normalized = normalizeLineBreaks(value);
  const lineBreakIndex = normalized.indexOf("\n");
  if (lineBreakIndex === -1) return { firstLine: normalized, remainder: "" };
  return {
    firstLine: normalized.slice(0, lineBreakIndex),
    remainder: normalized.slice(lineBreakIndex + 1),
  };
}

function normalizeImageStudioActivationLine(value: string): string {
  return s(value).replace(/\s+/g, " ").toLowerCase();
}

function buildImageStudioActivationLine(mode: ImageStudioActivationLineMode, presetLabel: string): string {
  const label = s(presetLabel);
  if (!label) return "";
  if (mode === "edit") return `Edit image in ${label} style`;
  return `Create image in ${label} style`;
}

function isImageStudioActivationLine(value: string): boolean {
  const normalized = normalizeImageStudioActivationLine(value);
  return /^create image in .+ style$/.test(normalized) || /^edit image in .+ style$/.test(normalized);
}

function buildLockedImageStudioPrompt(activationLine: string, userText: string): string {
  const normalizedActivationLine = s(activationLine);
  if (!normalizedActivationLine) return normalizeLineBreaks(userText);
  const normalizedUserText = normalizeLineBreaks(userText).replace(/^\n+/, "");
  return `${normalizedActivationLine}\n${normalizedUserText}`;
}

function extractImageStudioUserTextFromLockedPrompt(nextValue: string, activationLine: string): string {
  const normalizedValue = normalizeLineBreaks(nextValue);
  if (!normalizedValue) return "";
  const expectedLine = s(activationLine);
  if (!expectedLine) return normalizedValue;

  const { firstLine, remainder } = splitFirstLine(normalizedValue);
  const expectedNorm = normalizeImageStudioActivationLine(expectedLine);
  const firstNorm = normalizeImageStudioActivationLine(firstLine);

  if (firstNorm === expectedNorm) return remainder;
  if (isImageStudioActivationLine(firstLine)) return remainder;

  const firstLower = firstLine.toLowerCase();
  const expectedLower = expectedLine.toLowerCase();
  const expectedIndex = firstLower.indexOf(expectedLower);
  if (expectedIndex === -1) return normalizedValue;

  const before = firstLine.slice(0, expectedIndex);
  const after = firstLine.slice(expectedIndex + expectedLine.length);
  const stitched = [before + after, remainder].filter(Boolean).join("\n");
  return stitched.replace(/^\n+/, "");
}

function stripLeadingImageStudioActivationLine(value: string): string {
  const normalizedValue = normalizeLineBreaks(value);
  const { firstLine, remainder } = splitFirstLine(normalizedValue);
  if (!isImageStudioActivationLine(firstLine)) return normalizedValue;
  return remainder;
}

function matchesAnyImageStudioActivationLine(value: string, presetLabel: string): boolean {
  const { firstLine } = splitFirstLine(value);
  const normalized = normalizeImageStudioActivationLine(firstLine);
  if (!normalized) return false;
  const createLine = buildImageStudioActivationLine("create", presetLabel);
  const editLine = buildImageStudioActivationLine("edit", presetLabel);
  return normalized === normalizeImageStudioActivationLine(createLine)
    || normalized === normalizeImageStudioActivationLine(editLine);
}

function buildCenterRouteContextPayload(args: {
  surface: AiCenterSurface;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
}): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const awareness = resolveCavAiRouteAwareness({
    pathname: window.location.pathname,
    search: window.location.search,
    origin: s(args.origin) || undefined,
    contextLabel: s(args.contextLabel) || undefined,
    workspaceId: s(args.workspaceId) || undefined,
    projectId: Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0 ? Number(args.projectId) : undefined,
  });
  const payload = buildCavAiRouteContextPayload(awareness);
  return {
    ...payload,
    launchSurface: args.surface,
  };
}

function firstInitialChar(input: string): string {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function normalizeInitialUsernameSource(rawUsername: string): string {
  const trimmed = String(rawUsername || "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const pathname = new URL(trimmed).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    return tail.replace(/^@+/, "");
  } catch {
    return trimmed;
  }
}

function deriveAccountInitial(username?: string | null, fallback?: string | null): string {
  const userInitial = firstInitialChar(normalizeInitialUsernameSource(String(username || "")));
  if (userInitial) return userInitial;
  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
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
    if (!id || id === "dictate" || !CAVEN_AGENT_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    rows.push(id);
    if (rows.length >= 240) break;
  }
  return rows;
}

function normalizeRuntimeCustomAgents(
  value: unknown,
  knownBuiltInIdSet?: ReadonlySet<string>
): CavenRuntimeCustomAgent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: CavenRuntimeCustomAgent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = s(row.id).toLowerCase();
    const actionKey = s(row.actionKey).toLowerCase();
    if (
      !id
      || !actionKey
      || !CAVEN_AGENT_ID_RE.test(id)
      || !CAVEN_AGENT_ACTION_KEY_RE.test(actionKey)
      || seen.has(id)
      || knownBuiltInIdSet?.has(id)
    ) {
      continue;
    }
    seen.add(id);
    const triggers = Array.isArray(row.triggers)
      ? row.triggers.map((item) => s(item)).filter(Boolean).slice(0, 12)
      : [];
    rows.push({
      id,
      name: s(row.name),
      summary: s(row.summary),
      actionKey,
      surface: normalizeRuntimeAgentSurface(row.surface),
      triggers,
      instructions: s(row.instructions),
      iconSvg: s(row.iconSvg),
      iconBackground: s(row.iconBackground) || null,
      createdAt: s(row.createdAt),
      publicationRequested: row.publicationRequested === true,
      publicationRequestedAt: row.publicationRequested === true
        ? (Number.isFinite(Date.parse(s(row.publicationRequestedAt))) ? new Date(s(row.publicationRequestedAt)).toISOString() : s(row.createdAt) || new Date().toISOString())
        : null,
    });
    if (rows.length >= 120) break;
  }
  return rows;
}

function normalizePublishedOperatorAgents(
  value: unknown,
  knownBuiltInIdSet?: ReadonlySet<string>
): PublishedOperatorAgentRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: PublishedOperatorAgentRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const id = s(row.id).toLowerCase();
    const sourceAgentId = s(row.sourceAgentId).toLowerCase();
    const sourceUserId = s(row.sourceUserId);
    const sourceAccountId = s(row.sourceAccountId);
    const actionKey = s(row.actionKey).toLowerCase();
    if (
      !id
      || !sourceAgentId
      || !sourceUserId
      || !sourceAccountId
      || !actionKey
      || !CAVEN_AGENT_ID_RE.test(id)
      || !CAVEN_AGENT_ID_RE.test(sourceAgentId)
      || !CAVEN_AGENT_ACTION_KEY_RE.test(actionKey)
      || seen.has(id)
      || knownBuiltInIdSet?.has(id)
    ) {
      continue;
    }
    seen.add(id);
    const triggers = Array.isArray(row.triggers)
      ? row.triggers.map((item) => s(item)).filter(Boolean).slice(0, 12)
      : [];
    rows.push({
      id,
      sourceAgentId,
      sourceUserId,
      sourceAccountId,
      ownerName: s(row.ownerName) || "Operator",
      ownerUsername: s(row.ownerUsername) || null,
      name: s(row.name),
      summary: s(row.summary),
      actionKey,
      surface: normalizeRuntimeAgentSurface(row.surface),
      triggers,
      instructions: s(row.instructions),
      iconSvg: s(row.iconSvg),
      iconBackground: s(row.iconBackground) || null,
      publishedAt: s(row.publishedAt),
      updatedAt: s(row.updatedAt),
    });
    if (rows.length >= 240) break;
  }
  return rows;
}

function normalizeRuntimeAgentIconSvg(value: unknown): string {
  const raw = s(value);
  if (!raw) return "";
  if (raw.length > MAX_CUSTOM_AGENT_ICON_SVG_CHARS) return "";
  if (!/<svg[\s>]/i.test(raw) || !/<\/svg>/i.test(raw)) return "";
  if (/<script[\s>]/i.test(raw) || /<foreignObject[\s>]/i.test(raw) || /\son[a-z]+\s*=/i.test(raw)) return "";
  return raw;
}

function runtimeAgentIconSrc(iconSvg: unknown): string {
  const clean = normalizeRuntimeAgentIconSvg(iconSvg);
  if (!clean) return "/icons/app/cavcode/agents/custom-agent.svg";
  return `data:image/svg+xml;utf8,${encodeURIComponent(clean)}`;
}

type InlineGlyphProps = {
  className?: string;
};

function CenterPlusGlyph({ className }: InlineGlyphProps) {
  return <span className={[styles.plusGlyph, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function CenterModelGlyph({ className }: InlineGlyphProps) {
  return <span className={[styles.selectGlyph, styles.modelGlyph, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function CenterReasoningGlyph({ className }: InlineGlyphProps) {
  return <span className={[styles.selectGlyph, styles.reasoningGlyph, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function CenterAudioGlyph({ className }: InlineGlyphProps) {
  return <span className={[styles.selectGlyph, styles.audioGlyph, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function CenterAgentGlyph({ className }: InlineGlyphProps) {
  return <span className={[className, styles.centerAgentModeAgentIcon].filter(Boolean).join(" ")} aria-hidden="true" />;
}

function CenterCloseGlyph({ className }: InlineGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
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
  requestedAction: AiCenterAction;
  installedAgentIds: string[];
  customAgents: CavenRuntimeCustomAgent[];
  publishedAgents?: PublishedOperatorAgentRecord[];
}): CavenRuntimeAgentRef | null {
  const installedSet = new Set(args.installedAgentIds.map((id) => s(id).toLowerCase()));
  const eligible = [...args.customAgents, ...(args.publishedAgents || [])].filter(
    (agent) => installedSet.has(agent.id) && (agent.surface === "all" || agent.surface === "center")
  );
  if (!eligible.length) return null;

  const promptLower = s(args.prompt).toLowerCase();
  let best: CavenRuntimeCustomAgent | PublishedOperatorAgentRecord | null = null;
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

function resolveAccountToneInk(tone: string): string {
  const value = s(tone).toLowerCase();
  if (value === "white" || value === "lime") return "rgba(1,3,15,0.92)";
  if (value === "transparent") return "#b9c85a";
  return "rgba(234,240,255,0.96)";
}

function resolveAccountToneBackground(tone: string): string {
  const value = s(tone).toLowerCase();
  if (value === "transparent") return "transparent";
  if (value === "violet") return "rgba(139,92,255,0.22)";
  if (value === "blue") return "rgba(78,168,255,0.22)";
  if (value === "white") return "rgba(255,255,255,0.92)";
  if (value === "navy") return "rgba(1,3,15,0.78)";
  return "rgba(185,200,90,0.92)";
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

function normalizeCenterModelOptions(options: CavAiModelOption[]): CavAiModelOption[] {
  const map = new Map<string, CavAiModelOption>();
  for (const option of options) {
    const id = s(option.id);
    if (!id || isAiAutoModelId(id)) continue;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      label: resolveAiModelLabel(id),
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const rankDiff = rankDefaultModelForUi(a.id) - rankDefaultModelForUi(b.id);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
}

function extractUrlsFromText(value: string, max = 8): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const text = String(value || "");
  const pattern = /https?:\/\/[^\s<>"'`)\]}]+/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = s(match[0]).replace(/[.,;!?]+$/, "");
    if (!raw) continue;
    try {
      const normalized = new URL(raw).toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= max) break;
    } catch {
      // Ignore malformed URL fragments.
    }
  }
  return urls;
}

function toCenterData(value: unknown): CavAiCenterData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const summary = s(row.summary);
  const answer = s(row.answer);
  if (!summary && !answer) return null;
  const riskRaw = s(row.risk).toLowerCase();
  const risk = riskRaw === "low" || riskRaw === "medium" || riskRaw === "high" ? riskRaw : "low";

  const list = (input: unknown): string[] =>
    Array.isArray(input) ? input.map((item) => s(item)).filter(Boolean) : [];

  const extractedEvidence = Array.isArray(row.extractedEvidence)
    ? row.extractedEvidence
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const evidence = item as Record<string, unknown>;
          const source = s(evidence.source);
          const note = s(evidence.note);
          const url = s(evidence.url);
          if (!source || !note) return null;
          return {
            source,
            note,
            ...(url ? { url } : {}),
          };
        })
        .filter(Boolean) as NonNullable<CavAiCenterData["extractedEvidence"]>
    : [];

  const sources = Array.isArray(row.sources)
    ? row.sources
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const source = item as Record<string, unknown>;
          const title = s(source.title);
          const url = s(source.url);
          const note = s(source.note);
          if (!title || !url) return null;
          return {
            title,
            url,
            ...(note ? { note } : {}),
          };
        })
        .filter(Boolean) as NonNullable<CavAiCenterData["sources"]>
    : [];

  const generatedImages = Array.isArray(row.generatedImages)
    ? row.generatedImages
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const image = item as Record<string, unknown>;
          const url = s(image.url);
          const b64Json = s(image.b64Json);
          if (!url && !b64Json) return null;
          return {
            ...(url ? { url } : {}),
            ...(b64Json ? { b64Json } : {}),
          };
        })
        .filter(Boolean) as NonNullable<CavAiCenterData["generatedImages"]>
    : [];

  const imageStudioRaw =
    row.imageStudio && typeof row.imageStudio === "object" && !Array.isArray(row.imageStudio)
      ? (row.imageStudio as Record<string, unknown>)
      : null;
  const imageStudioAssets = Array.isArray(imageStudioRaw?.assets)
    ? imageStudioRaw?.assets
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const asset = item as Record<string, unknown>;
          const assetId = s(asset.assetId);
          const url = s(asset.url);
          const b64Json = s(asset.b64Json);
          const fileName = s(asset.fileName);
          const mimeType = s(asset.mimeType);
          if (!assetId && !url && !b64Json) return null;
          return {
            ...(assetId ? { assetId } : {}),
            ...(url ? { url } : {}),
            ...(b64Json ? { b64Json } : {}),
            ...(fileName ? { fileName } : {}),
            ...(mimeType ? { mimeType } : {}),
          };
        })
        .filter(Boolean) as NonNullable<NonNullable<CavAiCenterData["imageStudio"]>["assets"]>
    : [];
  const imageStudio =
    imageStudioRaw && (
      imageStudioAssets.length
      || s(imageStudioRaw.jobId)
      || s(imageStudioRaw.presetId)
      || s(imageStudioRaw.mode)
    )
      ? {
          ...(s(imageStudioRaw.mode) ? { mode: s(imageStudioRaw.mode) } : {}),
          ...(s(imageStudioRaw.jobId) ? { jobId: s(imageStudioRaw.jobId) } : {}),
          ...(s(imageStudioRaw.presetId) ? { presetId: s(imageStudioRaw.presetId) } : {}),
          ...(s(imageStudioRaw.presetLabel) ? { presetLabel: s(imageStudioRaw.presetLabel) } : {}),
          ...(s(imageStudioRaw.sourcePrompt) ? { sourcePrompt: s(imageStudioRaw.sourcePrompt) } : {}),
          ...(s(imageStudioRaw.sourceAssetId) ? { sourceAssetId: s(imageStudioRaw.sourceAssetId) } : {}),
          ...(imageStudioAssets.length ? { assets: imageStudioAssets } : {}),
        }
      : undefined;

  return {
    summary: summary || answer || "Research response",
    risk: risk as CavAiCenterData["risk"],
    answer: answer || summary,
    generatedImages,
    researchMode: row.researchMode === true,
    keyFindings: list(row.keyFindings),
    extractedEvidence,
    sources,
    suggestedNextActions: list(row.suggestedNextActions),
    recommendations: list(row.recommendations),
    notes: list(row.notes),
    followUpChecks: list(row.followUpChecks),
    evidenceRefs: list(row.evidenceRefs),
    ...(imageStudio ? { imageStudio } : {}),
  };
}

function parseImageStudioPreset(value: unknown): ImageStudioPreset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  const slug = s(row.slug);
  const label = s(row.label);
  if (!id || !slug || !label) return null;
  const planTierRaw = s(row.planTier).toLowerCase();
  const planTier: ImageStudioPreset["planTier"] =
    planTierRaw === "premium_plus"
      ? "premium_plus"
      : planTierRaw === "premium"
        ? "premium"
        : "free";
  return {
    id,
    slug,
    label,
    subtitle: s(row.subtitle) || null,
    thumbnailUrl: s(row.thumbnailUrl) || null,
    category: s(row.category),
    planTier,
    displayOrder: Math.max(0, Math.trunc(Number(row.displayOrder) || 0)),
    isFeatured: row.isFeatured === true,
    isActive: row.isActive !== false,
    createdAtISO: s(row.createdAtISO),
    updatedAtISO: s(row.updatedAtISO),
    locked: row.locked === true,
  };
}

function parseImageStudioHistoryRow(value: unknown): ImageStudioHistoryRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  if (!id) return null;
  return {
    id,
    entryType: s(row.entryType),
    mode: s(row.mode) || null,
    promptSummary: s(row.promptSummary) || null,
    saved: row.saved === true,
    savedTarget: s(row.savedTarget) || null,
    createdAtISO: s(row.createdAtISO),
    jobId: s(row.jobId) || null,
    assetId: s(row.assetId) || null,
    presetId: s(row.presetId) || null,
    presetLabel: s(row.presetLabel) || null,
    imageUrl: s(row.imageUrl) || null,
    fileName: s(row.fileName) || null,
    mimeType: s(row.mimeType) || null,
    modelUsed: s(row.modelUsed) || null,
    sourcePrompt: s(row.sourcePrompt) || null,
  };
}

function parseImageStudioGalleryItem(value: unknown): ImageStudioGalleryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  const name = s(row.name);
  const mimeType = s(row.mimeType).toLowerCase();
  if (!id || !name || !mimeType.startsWith("image/")) return null;
  return {
    id,
    name,
    path: s(row.path),
    bytes: Math.max(0, Math.trunc(Number(row.bytes) || 0)),
    mimeType,
    updatedAtISO: s(row.updatedAtISO) || s(row.createdAtISO),
  };
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
    mimeType: s(row.mimeType).toLowerCase() || "application/octet-stream",
    updatedAtISO: s(row.updatedAtISO) || s(row.createdAtISO),
    previewSnippet: s(row.previewSnippet) || null,
  };
}

function toExecutionMeta(value: unknown): CavAiExecutionMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const safeSummary = row.safeSummary && typeof row.safeSummary === "object" && !Array.isArray(row.safeSummary)
    ? (row.safeSummary as Record<string, unknown>)
    : {};
  const quality = row.quality && typeof row.quality === "object" && !Array.isArray(row.quality)
    ? (row.quality as Record<string, unknown>)
    : {};
  const reasoningLevel = parseReasoningLevel(row.reasoningLevel) || "medium";
  const contextSignals = Array.isArray(row.contextSignals)
    ? row.contextSignals.map((item) => s(item)).filter(Boolean)
    : [];
  const reasons = Array.isArray(quality.reasons)
    ? quality.reasons.map((item) => s(item)).filter(Boolean)
    : [];
  const durationMs = Math.max(0, Math.trunc(Number(row.durationMs) || 0));
  const hasShowReasoningChip = Object.prototype.hasOwnProperty.call(row, "showReasoningChip");
  const showReasoningChip = row.showReasoningChip === true || (!hasShowReasoningChip && durationMs > 0);
  const defaultReasoningLabel = durationMs > 0 ? `Reasoned in ${formatReasoningDuration(durationMs)}` : "Reasoned";
  const intent = s(safeSummary.intent) || "CavAi response";

  return {
    durationMs,
    durationLabel: s(row.durationLabel) || formatReasoningDuration(durationMs),
    showReasoningChip,
    reasoningLabel: s(row.reasoningLabel) || defaultReasoningLabel,
    taskType: s(row.taskType) || "general_question",
    surface: s(row.surface) || "workspace",
    action: s(row.action),
    actionClass: s(row.actionClass),
    providerId: s(row.providerId),
    model: s(row.model),
    reasoningLevel,
    researchMode: row.researchMode === true,
    repairAttempted: row.repairAttempted === true,
    repairApplied: row.repairApplied === true,
    contextSignals,
    quality: {
      relevanceToRequest: Math.max(0, Math.trunc(Number(quality.relevanceToRequest) || 0)),
      relevanceToSurface: Math.max(0, Math.trunc(Number(quality.relevanceToSurface) || 0)),
      productTruth: Math.max(0, Math.trunc(Number(quality.productTruth) || 0)),
      actionability: Math.max(0, Math.trunc(Number(quality.actionability) || 0)),
      coherence: Math.max(0, Math.trunc(Number(quality.coherence) || 0)),
      scopeAlignment: Math.max(0, Math.trunc(Number(quality.scopeAlignment) || 0)),
      hallucinationRisk: Math.max(0, Math.trunc(Number(quality.hallucinationRisk) || 0)),
      overall: Math.max(0, Math.trunc(Number(quality.overall) || 0)),
      passed: quality.passed === true,
      reasons,
    },
    safeSummary: {
      intent,
      contextUsed: Array.isArray(safeSummary.contextUsed)
        ? safeSummary.contextUsed.map((item) => s(item)).filter(Boolean)
        : [],
      checksPerformed: Array.isArray(safeSummary.checksPerformed)
        ? safeSummary.checksPerformed.map((item) => s(item)).filter(Boolean)
        : [],
      answerPath: Array.isArray(safeSummary.answerPath)
        ? safeSummary.answerPath.map((item) => s(item)).filter(Boolean)
        : [],
      uncertaintyNotes: Array.isArray(safeSummary.uncertaintyNotes)
        ? safeSummary.uncertaintyNotes.map((item) => s(item)).filter(Boolean)
        : [],
      doneState: s(safeSummary.doneState) === "partial" ? "partial" : "done",
    },
  };
}

function resolveExecutionMetaFromMessage(message: CavAiMessage): CavAiExecutionMeta | null {
  const json = message.contentJson;
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;
  return toExecutionMeta(row.__cavAiMeta || row.meta || null);
}

function isAudioLikeFile(file: File): boolean {
  const mime = s(file.type).toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const extension = s(file.name).toLowerCase().split(".").pop() || "";
  return ["mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac", "aac"].includes(extension);
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("IMAGE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function mergeRecentImageLibrary(
  current: CavAiImageAttachment[],
  incoming: CavAiImageAttachment[]
): CavAiImageAttachment[] {
  if (!incoming.length) return current;
  const seen = new Set<string>();
  const next: CavAiImageAttachment[] = [];
  for (const row of [...incoming, ...current]) {
    const key = s(row.dataUrl) || `${s(row.name)}:${row.sizeBytes}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(row);
    if (next.length >= MAX_RECENT_IMAGE_LIBRARY) break;
  }
  return next;
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
  if (!normalized) return "png";
  if (!normalized.includes("/")) return normalized;
  const subtype = normalized.split("/")[1];
  return s(subtype) || normalized;
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

function toTitlePreview(value: string): string {
  const text = normalizeCenterMessageText(value).replace(/\s+/g, " ").trim();
  if (!text) return "Untitled chat";
  if (text.length <= 72) return text;
  return `${text.slice(0, 71)}…`;
}

function normalizeSessionTitleForSidebar(value: string): string {
  const raw = s(value);
  if (!raw) return "";
  return raw
    .replace(/^\s*cavpad\s+note\s*[·:-]\s*/i, "")
    .replace(/^\s*note\s*[·:-]\s*/i, "")
    .trim();
}

const GENERIC_SESSION_THREAD_TITLE_KEYS = new Set([
  "workspace context",
  "general context",
  "console context",
  "cavcloud context",
  "cavsafe context",
  "cavpad context",
  "cavcode context",
  "untitled chat",
  "new chat",
  "cavai chat",
]);

function normalizeSessionTitleKey(value: string): string {
  return s(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function buildSyntheticThreadFromSessionSummary(session: CavAiSessionSummary | null): CavAiMessage[] {
  if (!session) return [];
  const title = normalizeSessionTitleForSidebar(s(session.title) || s(session.contextLabel) || "");
  const titleKey = normalizeSessionTitleKey(title);
  const preview = s(session.preview);
  const createdAt = s(session.createdAt) || new Date().toISOString();
  const updatedAt = s(session.updatedAt) || createdAt;
  const rows: CavAiMessage[] = [];

  if (title && !GENERIC_SESSION_THREAD_TITLE_KEYS.has(titleKey)) {
    rows.push({
      id: `${session.id}::seed-user`,
      role: "user",
      action: null,
      contentText: title,
      contentJson: null,
      provider: null,
      model: null,
      requestId: null,
      status: "RECOVERED",
      errorCode: null,
      createdAt,
      feedback: null,
    });
  }

  if (preview && preview !== title) {
    rows.push({
      id: `${session.id}::seed-assistant`,
      role: "assistant",
      action: null,
      contentText: preview,
      contentJson: null,
      provider: null,
      model: null,
      requestId: null,
      status: "RECOVERED",
      errorCode: null,
      createdAt: updatedAt,
      feedback: null,
    });
  }

  return rows;
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
  if (!Number.isFinite(assistantTs)) return "Reasoned";
  for (let pointer = args.index - 1; pointer >= 0; pointer -= 1) {
    const row = args.allMessages[pointer];
    if (!row || row.role !== "user") continue;
    const userTs = Date.parse(s(row.createdAt));
    if (!Number.isFinite(userTs)) break;
    const delta = Math.max(0, assistantTs - userTs);
    if (delta <= 0) return "";
    return `Reasoned in ${formatReasoningDuration(delta)}`;
  }
  return "Reasoned";
}

function normalizeCenterMessageText(value: string): string {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    if (/^\s*[=-]{3,}\s*$/.test(line)) continue;
    // Hide backend/internal action markers (not user-facing content).
    if (
      /^\s*AI assist (?:completed|failed)\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)\s*\.?\s*$/i.test(trimmed)
      || /^\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)\s*$/i.test(trimmed)
      || /^\s*[a-z0-9_-]+:[a-z0-9_.-]+\s*$/i.test(trimmed)
    ) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
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

function toCachedAiCenterSurface(value: unknown): AiCenterSurface {
  const raw = s(value).toLowerCase();
  if (
    raw === "general"
    || raw === "workspace"
    || raw === "console"
    || raw === "cavcloud"
    || raw === "cavsafe"
    || raw === "cavpad"
    || raw === "cavcode"
  ) {
    return raw;
  }
  return "general";
}

function normalizeCachedSessionSummary(value: unknown): CavAiSessionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  if (!id || !isGuestPreviewSessionId(id)) return null;
  const updatedAt = s(row.updatedAt) || new Date().toISOString();
  const createdAt = s(row.createdAt) || updatedAt;
  return {
    id,
    surface: toCachedAiCenterSurface(row.surface),
    title: s(row.title),
    contextLabel: s(row.contextLabel) || null,
    workspaceId: s(row.workspaceId) || null,
    projectId: Number.isFinite(Number(row.projectId)) ? Math.trunc(Number(row.projectId)) : null,
    origin: s(row.origin) || "guest_preview",
    updatedAt,
    createdAt,
    lastMessageAt: s(row.lastMessageAt) || null,
    preview: s(row.preview) || null,
  };
}

function normalizeCachedMessage(value: unknown): CavAiMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = s(row.id);
  if (!id) return null;
  const role = s(row.role).toLowerCase() === "assistant" ? "assistant" : "user";
  return {
    id,
    role,
    action: s(row.action) || null,
    contentText: String(row.contentText ?? ""),
    contentJson:
      row.contentJson && typeof row.contentJson === "object" && !Array.isArray(row.contentJson)
        ? row.contentJson as Record<string, unknown>
        : null,
    provider: s(row.provider) || null,
    model: s(row.model) || null,
    requestId: s(row.requestId) || null,
    status: s(row.status) || null,
    errorCode: s(row.errorCode) || null,
    createdAt: s(row.createdAt) || new Date().toISOString(),
    feedback: toSafeFeedbackState(row.feedback as CavAiMessageFeedbackState | null | undefined),
  };
}

function normalizeCachedMessageEntry(value: unknown): CenterSessionCacheMessageEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sessionId = s(row.sessionId);
  if (!sessionId || !isGuestPreviewSessionId(sessionId)) return null;
  const rawMessages = Array.isArray(row.messages) ? row.messages : [];
  const messages: CavAiMessage[] = [];
  for (const raw of rawMessages) {
    const normalized = normalizeCachedMessage(raw);
    if (!normalized) continue;
    messages.push(normalized);
  }
  const updatedAtMsRaw = Number(row.updatedAtMs);
  const updatedAtMs = Number.isFinite(updatedAtMsRaw) ? Math.trunc(updatedAtMsRaw) : Date.now();
  return {
    sessionId,
    messages: messages.slice(-CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGES_PER_SESSION),
    updatedAtMs,
  };
}

function buildCenterSessionScopeKey(args: {
  surface: AiCenterSurface;
  workspaceId?: string | null;
  projectId?: number | null;
}): string {
  const workspace = s(args.workspaceId);
  const project = Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0
    ? String(Math.trunc(Number(args.projectId)))
    : "";
  return [args.surface, workspace, project].join("::");
}

function buildCenterGuestSessionCacheStorageKey(scopeKey: string): string {
  return `${CAVAI_GUEST_SESSION_CACHE_STORAGE_PREFIX}:${s(scopeKey) || "general"}`;
}

function listCenterGuestSessionCacheScopeKeysFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  const prefix = `${CAVAI_GUEST_SESSION_CACHE_STORAGE_PREFIX}:`;
  const scopes: string[] = [];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = s(storage.key(index));
      if (!key.startsWith(prefix)) continue;
      const scopeKey = s(key.slice(prefix.length));
      if (!scopeKey) continue;
      scopes.push(scopeKey);
    }
  } catch {
    return [];
  }
  return scopes;
}

function hasPendingGuestSessionSyncInStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = s(window.localStorage.getItem(CAVAI_GUEST_SESSION_SYNC_PENDING_STORAGE_KEY));
    if (!raw) return false;
    if (raw === "1") return true;
    const parsed = JSON.parse(raw) as { pending?: unknown } | null;
    return parsed?.pending === true;
  } catch {
    return false;
  }
}

function markPendingGuestSessionSyncInStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CAVAI_GUEST_SESSION_SYNC_PENDING_STORAGE_KEY,
      JSON.stringify({
        pending: true,
        requestedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Best effort only.
  }
}

function clearPendingGuestSessionSyncInStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CAVAI_GUEST_SESSION_SYNC_PENDING_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

function clearAllCenterGuestSessionCacheSnapshotsFromStorage(): void {
  if (typeof window === "undefined") return;
  const prefix = `${CAVAI_GUEST_SESSION_CACHE_STORAGE_PREFIX}:`;
  try {
    const storage = window.localStorage;
    const keysToDelete: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = s(storage.key(index));
      if (!key.startsWith(prefix)) continue;
      keysToDelete.push(key);
    }
    for (const key of keysToDelete) {
      storage.removeItem(key);
    }
  } catch {
    // Best effort only.
  }
}

function hasGuestSessionCacheSnapshotsInStorage(): boolean {
  if (typeof window === "undefined") return false;
  const scopeKeys = listCenterGuestSessionCacheScopeKeysFromStorage();
  for (const scopeKey of scopeKeys) {
    const snapshot = readCenterSessionCacheSnapshot(scopeKey);
    if (!snapshot) continue;
    if (snapshot.sessions.length) return true;
    if (snapshot.messageEntries.some((entry) => Array.isArray(entry.messages) && entry.messages.length > 0)) return true;
  }
  return false;
}

function readCenterSessionCacheSnapshot(scopeKey: string): CenterSessionCacheSnapshot | null {
  if (typeof window === "undefined") return null;
  const storageKey = buildCenterGuestSessionCacheStorageKey(scopeKey);
  let raw = "";
  try {
    raw = window.localStorage.getItem(storageKey) || "";
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  const sessionsRaw = Array.isArray(row.sessions) ? row.sessions : [];
  const sessionSeen = new Set<string>();
  const sessions: CavAiSessionSummary[] = [];
  for (const entry of sessionsRaw) {
    const normalized = normalizeCachedSessionSummary(entry);
    if (!normalized) continue;
    if (sessionSeen.has(normalized.id)) continue;
    sessionSeen.add(normalized.id);
    sessions.push(normalized);
    if (sessions.length >= CAVAI_GUEST_SESSION_CACHE_MAX_SESSIONS) break;
  }

  const messageEntriesRaw = Array.isArray(row.messageEntries) ? row.messageEntries : [];
  const messageEntrySeen = new Set<string>();
  const messageEntries: CenterSessionCacheMessageEntry[] = [];
  for (const entry of messageEntriesRaw) {
    const normalized = normalizeCachedMessageEntry(entry);
    if (!normalized) continue;
    if (messageEntrySeen.has(normalized.sessionId)) continue;
    messageEntrySeen.add(normalized.sessionId);
    messageEntries.push(normalized);
    if (messageEntries.length >= CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGE_ENTRIES) break;
  }

  const activeCandidate = s(row.activeSessionId);
  const activeSessionId = isGuestPreviewSessionId(activeCandidate) ? activeCandidate : "";
  return {
    activeSessionId,
    sessions,
    messageEntries,
  };
}

function toGuestSyncRequiredString(value: unknown, maxChars: number, fallback: string): string {
  const normalized = s(value).slice(0, Math.max(1, Math.trunc(Number(maxChars) || 1)));
  if (normalized) return normalized;
  return s(fallback).slice(0, Math.max(1, Math.trunc(Number(maxChars) || 1)));
}

function toGuestSyncOptionalString(value: unknown, maxChars: number): string | null {
  const normalized = s(value).slice(0, Math.max(1, Math.trunc(Number(maxChars) || 1)));
  return normalized || null;
}

function collectGuestSessionSyncPayloadFromStorage(): GuestSessionSyncPayload {
  const sessionById = new Map<string, GuestSessionSyncSessionPayload>();
  const scopeKeys = listCenterGuestSessionCacheScopeKeysFromStorage();
  for (const scopeKey of scopeKeys) {
    const snapshot = readCenterSessionCacheSnapshot(scopeKey);
    if (!snapshot) continue;
    const messageMap = new Map<string, CavAiMessage[]>(
      snapshot.messageEntries.map((entry) => [entry.sessionId, entry.messages] as const)
    );
    for (const session of snapshot.sessions) {
      const sourceSessionId = s(session.id);
      if (!sourceSessionId || !isGuestPreviewSessionId(sourceSessionId)) continue;
      const localSessionId = sourceSessionId.toLowerCase().slice(0, CAVAI_GUEST_SYNC_LOCAL_SESSION_ID_MAX_CHARS);
      if (!localSessionId || !isGuestPreviewSessionId(localSessionId)) continue;
      const rawMessages = messageMap.get(sourceSessionId) || messageMap.get(localSessionId) || [];
      const normalizedMessages: GuestSessionSyncMessagePayload[] = [];
      for (const row of rawMessages) {
        if (!row || (row.role !== "user" && row.role !== "assistant")) continue;
        const contentText = s(row.contentText).slice(0, CAVAI_GUEST_SYNC_MESSAGE_MAX_CHARS);
        if (!contentText) continue;
        normalizedMessages.push({
          role: row.role,
          action: toGuestSyncOptionalString(row.action, CAVAI_GUEST_SYNC_ACTION_MAX_CHARS),
          contentText,
          contentJson:
            row.contentJson && typeof row.contentJson === "object" && !Array.isArray(row.contentJson)
              ? row.contentJson
              : null,
          provider: toGuestSyncOptionalString(row.provider, CAVAI_GUEST_SYNC_PROVIDER_MAX_CHARS),
          model: toGuestSyncOptionalString(row.model, CAVAI_GUEST_SYNC_MODEL_MAX_CHARS),
          status: toGuestSyncOptionalString(row.status, CAVAI_GUEST_SYNC_STATUS_MAX_CHARS),
          errorCode: toGuestSyncOptionalString(row.errorCode, CAVAI_GUEST_SYNC_ERROR_CODE_MAX_CHARS),
          createdAt: toGuestSyncRequiredString(row.createdAt, CAVAI_GUEST_SYNC_TIMESTAMP_MAX_CHARS, new Date().toISOString()),
        });
        if (normalizedMessages.length >= CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGES_PER_SESSION) break;
      }
      if (!normalizedMessages.length) continue;

      const nowIso = new Date().toISOString();
      const candidate: GuestSessionSyncSessionPayload = {
        localSessionId,
        surface: session.surface || "general",
        title: toGuestSyncRequiredString(
          normalizeSessionTitleForSidebar(session.title || session.contextLabel || "Preview chat"),
          CAVAI_GUEST_SYNC_TITLE_MAX_CHARS,
          "Preview chat"
        ),
        contextLabel: toGuestSyncRequiredString(
          session.contextLabel,
          CAVAI_GUEST_SYNC_CONTEXT_LABEL_MAX_CHARS,
          "Guest preview"
        ),
        origin: toGuestSyncRequiredString(session.origin, CAVAI_GUEST_SYNC_ORIGIN_MAX_CHARS, "guest_preview"),
        createdAt: toGuestSyncRequiredString(session.createdAt, CAVAI_GUEST_SYNC_TIMESTAMP_MAX_CHARS, nowIso),
        updatedAt: toGuestSyncRequiredString(session.updatedAt, CAVAI_GUEST_SYNC_TIMESTAMP_MAX_CHARS, nowIso),
        preview: toGuestSyncOptionalString(session.preview, CAVAI_GUEST_SYNC_PREVIEW_MAX_CHARS),
        messages: normalizedMessages,
      };
      const existing = sessionById.get(localSessionId);
      if (!existing) {
        sessionById.set(localSessionId, candidate);
        continue;
      }
      if (candidate.messages.length > existing.messages.length) {
        sessionById.set(localSessionId, candidate);
        continue;
      }
      const existingUpdatedMs = Date.parse(existing.updatedAt);
      const candidateUpdatedMs = Date.parse(candidate.updatedAt);
      if (Number.isFinite(candidateUpdatedMs) && Number.isFinite(existingUpdatedMs) && candidateUpdatedMs > existingUpdatedMs) {
        sessionById.set(localSessionId, candidate);
      }
    }
  }

  const sessions = Array.from(sessionById.values())
    .sort((left, right) => {
      const leftTs = Date.parse(left.updatedAt);
      const rightTs = Date.parse(right.updatedAt);
      const leftValue = Number.isFinite(leftTs) ? leftTs : 0;
      const rightValue = Number.isFinite(rightTs) ? rightTs : 0;
      return rightValue - leftValue;
    })
    .slice(0, CAVAI_GUEST_SESSION_CACHE_MAX_SESSIONS);

  return { sessions };
}

function isPromptLikeText(value: string): boolean {
  const text = s(value).toLowerCase();
  if (!text) return false;
  if (text.startsWith("prompt:") || text.startsWith("system prompt:")) return true;
  if (text.includes("here's a prompt") || text.includes("here is a prompt")) return true;
  if (text.includes("paste this into codex")) return true;
  if (text.includes("project brief") && text.includes("action steps")) return true;
  if (text.includes("key objectives") && text.includes("deliverables")) return true;
  if (/(^|\n)\s*\*\*project brief[:*]/i.test(text)) return true;
  if (/(^|\n)\s*(goal|task|objective)[:]/i.test(text) && text.length >= 220) return true;
  return false;
}

function isLikelyCodeLikeText(value: string): boolean {
  const text = s(value);
  if (!text) return false;
  if (text.includes("```")) return true;
  const lines = text.split("\n");
  if (lines.length < 4) return false;
  let codeLikeLines = 0;
  for (const line of lines) {
    const row = line.trim();
    if (!row) continue;
    if (/^(import|export|const|let|var|function|class|interface|type)\b/.test(row)) codeLikeLines += 1;
    else if (/^(<(!DOCTYPE|html|head|body|main|section|div|script))/i.test(row)) codeLikeLines += 1;
    else if (/^[{}[\];(),.=<>:+\-*/!&|]+$/.test(row)) codeLikeLines += 1;
    else if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(row)) codeLikeLines += 1;
    else if (/^(def|class|from|import|if|elif|else|for|while|return)\b/.test(row)) codeLikeLines += 1;
  }
  return codeLikeLines >= 3;
}

function toMessageSegments(args: {
  role: "user" | "assistant";
  contentText: string;
}): CavAiMessageSegment[] {
  const text = normalizeCenterMessageText(args.contentText);
  if (!text) return [];
  const segments: CavAiMessageSegment[] = [];
  const fence = /```([A-Za-z0-9_+-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;

  const pushPlainText = (raw: string) => {
    const value = s(raw).replace(/\n{3,}/g, "\n\n");
    if (!value) return;
    const shouldBox =
      args.role === "assistant" && (isPromptLikeText(value) || isLikelyCodeLikeText(value));
    segments.push({
      kind: shouldBox ? "prompt" : "text",
      text: value,
    });
  };

  for (const match of text.matchAll(fence)) {
    const start = Number(match.index || 0);
    if (start > cursor) {
      pushPlainText(text.slice(cursor, start));
    }

    const language = s(match[1]) || null;
    const code = String(match[2] || "").replace(/^\n+|\n+$/g, "");
    if (s(code)) {
      segments.push({
        kind: "prompt",
        text: code,
        language,
      });
    }
    cursor = start + String(match[0] || "").length;
  }

  if (cursor < text.length) {
    pushPlainText(text.slice(cursor));
  }

  if (!segments.length) {
    segments.push({
      kind: args.role === "assistant" && (isPromptLikeText(text) || isLikelyCodeLikeText(text)) ? "prompt" : "text",
      text,
    });
  }

  return segments;
}

function toAiCenterAction(value: unknown): AiCenterAction | null {
  const raw = s(value) as AiCenterAction;
  if (
    raw === "companion_chat" ||
    raw === "financial_advisor" ||
    raw === "therapist_support" ||
    raw === "mentor" ||
    raw === "best_friend" ||
    raw === "relationship_advisor" ||
    raw === "philosopher" ||
    raw === "focus_coach" ||
    raw === "life_strategist" ||
    raw === "email_text_agent" ||
    raw === "content_creator" ||
    raw === "legal_privacy_terms_ethics_agent" ||
    raw === "pdf_create_edit_preview_agent" ||
    raw === "page_404_builder_agent" ||
    raw === "doc_edit_review_agent" ||
    raw === "image_studio" ||
    raw === "image_edit" ||
    raw === "live_multimodal" ||
    raw === "web_research" ||
    raw === "explain_spike" ||
    raw === "summarize_issues" ||
    raw === "prioritize_fixes" ||
    raw === "write_incident_note" ||
    raw === "recommend_next_steps" ||
    raw === "summarize_folder" ||
    raw === "explain_artifact" ||
    raw === "draft_publish_copy" ||
    raw === "organize_storage" ||
    raw === "explain_access_restrictions" ||
    raw === "summarize_secure_file" ||
    raw === "review_collaboration_state" ||
    raw === "audit_access_context" ||
    raw === "write_note" ||
    raw === "summarize_thread" ||
    raw === "rewrite_clearly" ||
    raw === "technical_recap" ||
    raw === "bullets_to_plan"
  ) {
    return raw;
  }
  return null;
}

function toRetryImages(value: unknown): CavAiImageAttachment[] {
  if (!Array.isArray(value)) return [];
  const images: CavAiImageAttachment[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    const assetId = s(item.assetId) || s(item.id);
    const dataUrl = s(item.dataUrl) || (assetId ? TRANSPARENT_IMAGE_DATA_URL : "");
    if (!dataUrl && !assetId) continue;
    images.push({
      id: assetId || s(item.id) || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
      assetId: assetId || null,
      name: s(item.name) || "image",
      mimeType: s(item.mimeType) || "image/png",
      sizeBytes: Math.max(1, Math.trunc(Number(item.sizeBytes) || 0)),
      dataUrl,
    });
    if (images.length >= MAX_IMAGE_ATTACHMENTS_PREMIUM_PLUS) break;
  }
  return images;
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
    const mimeType = s(entry.mimeType) || "application/octet-stream";
    if (!path && !cavcloudFileId) continue;
    files.push({
      id: cavcloudFileId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
      cavcloudFileId: cavcloudFileId || null,
      path,
      name,
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

function toMessageMediaPayload(message: CavAiMessage): CavAiMessageMediaPayload {
  const payloadRaw =
    message.contentJson && typeof message.contentJson === "object" && !Array.isArray(message.contentJson)
      ? (message.contentJson as Record<string, unknown>)
      : {};
  const contextRaw =
    payloadRaw.context && typeof payloadRaw.context === "object" && !Array.isArray(payloadRaw.context)
      ? (payloadRaw.context as Record<string, unknown>)
      : {};
  const images = toRetryImages(payloadRaw.imageAttachments);
  const uploadedFromContext = toRetryUploadedFiles(contextRaw);
  const uploadedFiles = uploadedFromContext.length ? uploadedFromContext : toRetryUploadedFiles(payloadRaw);
  return {
    images,
    uploadedFiles,
  };
}

function isGuestPreviewSessionId(value: unknown): boolean {
  const normalized = s(value).toLowerCase();
  return normalized.startsWith("guest_preview_");
}

function createGuestPreviewLocalSessionId(): string {
  return `guest_preview_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildGuestPreviewTranscript(messages: CavAiMessage[], nextPromptRaw: string): string {
  const transcriptRows: string[] = [];
  for (const row of messages) {
    if (!row || (row.role !== "user" && row.role !== "assistant")) continue;
    const line = row.role === "assistant"
      ? normalizeCenterMessageText(row.contentText).trim()
      : s(row.contentText);
    if (!line) continue;
    transcriptRows.push(`${row.role === "user" ? "User" : "Assistant"}: ${line}`);
  }
  const prompt = s(nextPromptRaw);
  if (prompt) transcriptRows.push(`User: ${prompt}`);
  return transcriptRows.slice(-10).join("\n\n").slice(0, 6_000);
}

function buildSessionsUrl(args?: { limit?: number | null }): string {
  const qp = new URLSearchParams();
  const limitRaw = Number(args?.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 60;
  // Shared history across overlay + full-page Center: do not scope by surface/workspace/project.
  qp.set("limit", String(limit));
  return `/api/ai/sessions?${qp.toString()}`;
}

function buildCavAiSurfaceUrl(args: {
  surface: AiCenterSurface;
  contextLabel?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
}): string {
  if (args.surface === "cavcode") {
    const qp = new URLSearchParams();
    qp.set("cavai", "1");
    if (Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0) {
      qp.set("projectId", String(Math.trunc(Number(args.projectId))));
    }
    return `/cavcode?${qp.toString()}`;
  }

  const qp = new URLSearchParams();
  qp.set("surface", args.surface);
  if (s(args.contextLabel)) qp.set("context", s(args.contextLabel));
  if (s(args.workspaceId)) qp.set("workspaceId", s(args.workspaceId));
  if (Number.isFinite(Number(args.projectId)) && Number(args.projectId) > 0) {
    qp.set("projectId", String(Math.trunc(Number(args.projectId))));
  }
  if (s(args.origin)) qp.set("origin", s(args.origin));
  return `/cavai?${qp.toString()}`;
}

function withSessionInCavAiHref(href: string, nextSessionId?: string | null): string {
  const targetHref = s(href);
  const sessionId = s(nextSessionId);
  if (!targetHref || !sessionId) return targetHref;
  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(targetHref)) {
      const parsed = new URL(targetHref);
      parsed.searchParams.set("sessionId", sessionId);
      return parsed.toString();
    }
    const parsed = new URL(targetHref, "http://cavai.local");
    parsed.searchParams.set("sessionId", sessionId);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const joiner = targetHref.includes("?") ? "&" : "?";
    return `${targetHref}${joiner}sessionId=${encodeURIComponent(sessionId)}`;
  }
}

function withQuickActionInCavAiHref(
  href: string,
  nextQuickAction?: "create_image" | "edit_image" | null
): string {
  const targetHref = s(href);
  const quickAction = s(nextQuickAction).toLowerCase();
  if (!targetHref || (quickAction !== "create_image" && quickAction !== "edit_image")) return targetHref;
  try {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(targetHref)) {
      const parsed = new URL(targetHref);
      parsed.searchParams.set("quickAction", quickAction);
      return parsed.toString();
    }
    const parsed = new URL(targetHref, "http://cavai.local");
    parsed.searchParams.set("quickAction", quickAction);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const joiner = targetHref.includes("?") ? "&" : "?";
    return `${targetHref}${joiner}quickAction=${encodeURIComponent(quickAction)}`;
  }
}

function surfaceNavGlyphClass(surface: AiCenterSurface): string {
  switch (surface) {
    case "general":
      return styles.centerSidebarNavGlyphGeneral;
    case "workspace":
      return styles.centerSidebarNavGlyphWorkspace;
    case "console":
      return styles.centerSidebarNavGlyphConsole;
    case "cavcloud":
      return styles.centerSidebarNavGlyphCloud;
    case "cavsafe":
      return styles.centerSidebarNavGlyphSafe;
    case "cavpad":
      return styles.centerSidebarNavGlyphPad;
    case "cavcode":
      return styles.centerSidebarNavGlyphCode;
    default:
      return styles.centerSidebarNavGlyphWorkspace;
  }
}

function toHeroLineSurface(surface: AiCenterSurface): CavAiSurface {
  if (surface === "general") return "workspace";
  return surface;
}

function isAuthRequiredLikeResponse(status: number, payload: unknown) {
  const decision = readGuardDecisionFromPayload(payload);
  if (decision?.actionId === "AUTH_REQUIRED") return true;
  if (status === 401) return true;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const errorCode = String((payload as Record<string, unknown>).error || "").trim().toUpperCase();
  return errorCode === "AUTH_REQUIRED" || errorCode === "UNAUTHORIZED" || errorCode === "SESSION_REVOKED" || errorCode === "EXPIRED";
}

function isSessionUnavailableLikeResponse(status: number, payload: unknown) {
  if (isAuthRequiredLikeResponse(status, payload)) return false;
  if (status === 404) return true;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const errorCode = String((payload as Record<string, unknown>).error || "").trim().toUpperCase();
  return errorCode === "SESSION_NOT_FOUND";
}

export type CavAiCenterWorkspaceProps = {
  surface: AiCenterSurface;
  contextLabel?: string;
  context?: Record<string, unknown>;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  overlay?: boolean;
  open?: boolean;
  preload?: boolean;
  onClose?: () => void;
  expandHref?: string;
  initialSessionId?: string | null;
  initialQuickMode?: "create_image" | "edit_image" | null;
};

export default function CavAiCenterWorkspace(props: CavAiCenterWorkspaceProps) {
  const overlay = props.overlay !== false;
  const isOpen = overlay ? Boolean(props.open) : true;
  const shouldWarm = isOpen || (overlay ? props.preload !== false : Boolean(props.preload));
  const config = CENTER_CONFIG[props.surface] || CENTER_CONFIG.workspace;
  const explicitInitialSessionId = s(props.initialSessionId);
  const initialSessionScopeKey = useMemo(
    () =>
      buildCenterSessionScopeKey({
        surface: props.surface,
        workspaceId: props.workspaceId,
        projectId: props.projectId,
      }),
    [props.projectId, props.surface, props.workspaceId]
  );

  const [prompt, setPrompt] = useState("");
  const [sessions, setSessions] = useState<CavAiSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState(explicitInitialSessionId);
  const [messages, setMessages] = useState<CavAiMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(Boolean(explicitInitialSessionId));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [guestAuthStage, setGuestAuthStage] = useState<GuestAuthStage>("email");
  const [guestAuthEmail, setGuestAuthEmail] = useState("");
  const [guestAuthPassword, setGuestAuthPassword] = useState("");
  const [guestAuthName, setGuestAuthName] = useState("");
  const [guestAuthUsername, setGuestAuthUsername] = useState("");
  const [guestAuthBusy, setGuestAuthBusy] = useState(false);
  const [guestAuthError, setGuestAuthError] = useState("");
  const [guestAuthDismissed, setGuestAuthDismissed] = useState(false);
  const [accountInitialFallback, setAccountInitialFallback] = useState("");
  const [accountProfileUsername, setAccountProfileUsername] = useState("");
  const [accountProfileAvatar, setAccountProfileAvatar] = useState("");
  const [accountProfileTone, setAccountProfileTone] = useState("lime");
  const [accountProfilePublicEnabled, setAccountProfilePublicEnabled] = useState<boolean | null>(null);
  const [accountPlanId, setAccountPlanId] = useState<"free" | "premium" | "premium_plus">("free");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authProbeReady, setAuthProbeReady] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isPhoneLayout, setIsPhoneLayout] = useState(false);
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [images, setImages] = useState<CavAiImageAttachment[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<CavAiUploadedFileAttachment[]>([]);
  const [modelOptions, setModelOptions] = useState<CavAiModelOption[]>(() => centerPlanModelOptions("free"));
  const [audioModelOptions, setAudioModelOptions] = useState<CavAiModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState(CAVAI_AUTO_MODEL_ID);
  const [researchMode, setResearchMode] = useState(false);
  const [composerQuickMode, setComposerQuickMode] = useState<ComposerQuickMode | null>(() => {
    const raw = s(props.initialQuickMode).toLowerCase();
    if (raw === "create_image" || raw === "edit_image") return raw;
    return null;
  });
  const [manualAgentRef, setManualAgentRef] = useState<CavenRuntimeAgentRef | null>(null);
  const [recentImageLibrary, setRecentImageLibrary] = useState<CavAiImageAttachment[]>([]);
  const [imageStudioPresets, setImageStudioPresets] = useState<ImageStudioPreset[]>([]);
  const [, setImageStudioRecent] = useState<ImageStudioHistoryRow[]>([]);
  const [, setImageStudioSaved] = useState<ImageStudioHistoryRow[]>([]);
  const [, setImageStudioHistory] = useState<ImageStudioHistoryRow[]>([]);
  const [imageStudioHistoryView, setImageStudioHistoryView] = useState<"recent" | "saved" | "history">("recent");
  const [selectedImagePresetId, setSelectedImagePresetId] = useState("");
  const [imageStudioSourceAssetId, setImageStudioSourceAssetId] = useState("");
  const [composerImageViewer, setComposerImageViewer] = useState<ComposerImageViewerState | null>(null);
  const [imageStudioPresetLockModalOpen, setImageStudioPresetLockModalOpen] = useState(false);
  const [imageStudioSaveModalOpen, setImageStudioSaveModalOpen] = useState(false);
  const [imageStudioSaveAssetId, setImageStudioSaveAssetId] = useState("");
  const [imageStudioSaveBusy, setImageStudioSaveBusy] = useState(false);
  const [imageStudioImportModalOpen, setImageStudioImportModalOpen] = useState(false);
  const [imageStudioImportSource, setImageStudioImportSource] = useState<"device" | "cavcloud" | "cavsafe">("device");
  const [imageStudioImportBusy, setImageStudioImportBusy] = useState(false);
  const [imageStudioLoadingSource, setImageStudioLoadingSource] = useState(false);
  const [imageStudioGalleryCloud, setImageStudioGalleryCloud] = useState<ImageStudioGalleryItem[]>([]);
  const [imageStudioGallerySafe, setImageStudioGallerySafe] = useState<ImageStudioGalleryItem[]>([]);
  const [cavCloudAttachModalOpen, setCavCloudAttachModalOpen] = useState(false);
  const [cavCloudAttachBusy, setCavCloudAttachBusy] = useState(false);
  const [cavCloudAttachLoading, setCavCloudAttachLoading] = useState(false);
  const [cavCloudAttachItems, setCavCloudAttachItems] = useState<CavCloudAttachFileItem[]>([]);
  const [cavCloudAttachQuery, setCavCloudAttachQuery] = useState("");
  const [selectedAudioModel, setSelectedAudioModel] = useState("auto");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("medium");
  const [availableReasoningLevels, setAvailableReasoningLevels] = useState<ReasoningLevel[]>(
    () => reasoningLevelsForPlan("free")
  );
  const [openHeaderModelMenu, setOpenHeaderModelMenu] = useState(false);
  const [openComposerMenu, setOpenComposerMenu] = useState<ComposerMenu>(null);
  const [transcribingAudio, setTranscribingAudio] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [processingVoice, setProcessingVoice] = useState(false);
  const [activeVoiceCaptureIntent, setActiveVoiceCaptureIntent] = useState<VoiceCaptureIntent | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState("");
  const [voiceOrbState, setVoiceOrbState] = useState<CavAiVoiceOrbMode>("idle");
  const [voiceOrbStream, setVoiceOrbStream] = useState<MediaStream | null>(null);
  const [pendingPromptText, setPendingPromptText] = useState("");
  const [pendingImageGeneration, setPendingImageGeneration] = useState(false);
  const [reasoningContextLines, setReasoningContextLines] = useState<string[]>([]);
  const [messageActionPending, setMessageActionPending] = useState<Record<string, string>>({});
  const [copiedMessageToken, setCopiedMessageToken] = useState("");
  const [activeSessionMenuId, setActiveSessionMenuId] = useState("");
  const [activeSessionMenuAnchor, setActiveSessionMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  const [floatingComposerMenuAnchor, setFloatingComposerMenuAnchor] = useState<FloatingComposerMenuAnchor | null>(null);
  const [sessionActionModal, setSessionActionModal] = useState<SessionActionModal | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [renameDraftTitle, setRenameDraftTitle] = useState("");
  const [shareMode, setShareMode] = useState<"internal" | "external">("internal");
  const [shareTargetIdentity, setShareTargetIdentity] = useState("");
  const [shareResultUrl, setShareResultUrl] = useState("");
  const [shareDeliveredHint, setShareDeliveredHint] = useState("");
  const [shareResultCopied, setShareResultCopied] = useState(false);
  const [reasoningPanelMessageId, setReasoningPanelMessageId] = useState("");
  const [inlineEditDraft, setInlineEditDraft] = useState<CavAiCenterRetryDraft | null>(null);
  const [inlineEditPrompt, setInlineEditPrompt] = useState("");
  const [inlineEditBusy, setInlineEditBusy] = useState(false);
  const [inlineEditPendingAnchorId, setInlineEditPendingAnchorId] = useState("");
  const [clientHydrated, setClientHydrated] = useState(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLElement | null>(null);
  const inlineEditInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [profileIdentity, setProfileIdentity] = useState<CavAiIdentityInput>(() => ({
    fullName: "",
    username: "",
  }));
  const [heroLine, setHeroLine] = useState(CAVAI_SAFE_FALLBACK_LINE);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageStudioImportInputRef = useRef<HTMLInputElement | null>(null);
  const imageStudioPresetRailRef = useRef<HTMLDivElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef("");
  const ttsPlaybackSessionRef = useRef(0);
  const ttsBlobCacheRef = useRef<Map<string, Blob>>(new Map());
  const ttsBlobRequestRef = useRef<Map<string, Promise<Blob>>>(new Map());
  const ttsLeadTrimCacheRef = useRef<Map<string, number>>(new Map());
  const ttsLeadTrimRequestRef = useRef<Map<string, Promise<number>>>(new Map());
  const ttsBlockedRetryPayloadRef = useRef<{ text: string; speakingKey: string } | null>(null);
  const prefetchedAssistantSpeechIdsRef = useRef<Set<string>>(new Set());
  const autoSpeakNextVoiceReplyRef = useRef(false);
  const lastAutoSpokenVoiceMessageIdRef = useRef("");
  const guestSessionSyncAttemptedRef = useRef(false);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const composerControlsRef = useRef<HTMLDivElement | null>(null);
  const floatingComposerMenuRef = useRef<HTMLDivElement | null>(null);
  const quickActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerModelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerReasoningTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerAudioTriggerRef = useRef<HTMLButtonElement | null>(null);
  const agentModeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const headerModelMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef(explicitInitialSessionId);
  const sessionMessageCacheRef = useRef<Map<string, CavAiMessage[]>>(new Map());
  const sessionMessageRequestRef = useRef<Map<string, Promise<CavAiMessage[]>>>(new Map());
  const preloadedIconSrcRef = useRef<Set<string>>(new Set());
  const warmSessionsKeyRef = useRef("");
  const appliedInitialSessionIdRef = useRef<string | null>(null);
  const warmedModelsRef = useRef(false);
  const warmedAuthProfileRef = useRef(false);
  const reasoningTickerRef = useRef<number | null>(null);
  const [agentRegistrySnapshot, setAgentRegistrySnapshot] = useState<AgentRegistrySnapshot>({
    ...EMPTY_AGENT_REGISTRY_SNAPSHOT,
  });
  const agentRegistrySnapshotRef = useRef<AgentRegistrySnapshot>({
    ...EMPTY_AGENT_REGISTRY_SNAPSHOT,
  });
  const [installedAgentIds, setInstalledAgentIds] = useState<string[]>([]);
  const installedAgentIdsRef = useRef<string[]>([]);
  const [customAgents, setCustomAgents] = useState<CavenRuntimeCustomAgent[]>([]);
  const [publishedAgents, setPublishedAgents] = useState<PublishedOperatorAgentRecord[]>([]);
  const [savingAgentId, setSavingAgentId] = useState("");
  const [agentModeQuery, setAgentModeQuery] = useState("");
  const [agentModeManageAgentId, setAgentModeManageAgentId] = useState("");
  const isGuestPreviewMode = authProbeReady && !isAuthenticated;
  const guestPreviewModelOptions = useMemo(
    () => CAVAI_GUEST_PREVIEW_MODELS.map((row) => ({ id: row.id, label: row.label })),
    [],
  );
  const guestPreviewReasoningLevels = useMemo(
    () => REASONING_LEVEL_OPTIONS.map((row) => row.value),
    [],
  );

  const resetCenterAgentRegistryState = useCallback(() => {
    setAgentRegistrySnapshot({ ...EMPTY_AGENT_REGISTRY_SNAPSHOT });
    agentRegistrySnapshotRef.current = { ...EMPTY_AGENT_REGISTRY_SNAPSHOT };
    setInstalledAgentIds([]);
    installedAgentIdsRef.current = [];
    setCustomAgents([]);
    setPublishedAgents([]);
  }, []);

  const resetImageStudioBootstrapState = useCallback(() => {
    setImageStudioPresets([]);
    setImageStudioRecent([]);
    setImageStudioSaved([]);
    setImageStudioHistory([]);
    setSelectedImagePresetId("");
    setImageStudioGalleryCloud([]);
    setImageStudioGallerySafe([]);
  }, []);

  const applyUnauthenticatedCenterState = useCallback(() => {
    setIsAuthenticated(false);
    setAccountProfilePublicEnabled(null);
    setAccountProfileAvatar("");
    setAccountProfileUsername("");
    setAccountInitialFallback("");
    setAccountProfileTone("lime");
    setAccountPlanId("free");
    publishClientPlan({ planId: "free" });
    setModelOptions(guestPreviewModelOptions);
    setAudioModelOptions([]);
    setAvailableReasoningLevels(guestPreviewReasoningLevels);
    setSessions([]);
    sessionMessageCacheRef.current = new Map();
    sessionMessageRequestRef.current.clear();
    activeSessionIdRef.current = "";
    setSessionId("");
    setLoadingMessages(false);
    setMessages([]);
    setError("");
    setCavCloudAttachItems([]);
    resetCenterAgentRegistryState();
    resetImageStudioBootstrapState();
  }, [
    guestPreviewModelOptions,
    guestPreviewReasoningLevels,
    resetCenterAgentRegistryState,
    resetImageStudioBootstrapState,
  ]);

  const expandHref = useMemo(() => {
    const fallbackHref = buildCavAiSurfaceUrl({
      surface: props.surface,
      contextLabel: props.contextLabel,
      workspaceId: props.workspaceId,
      projectId: props.projectId,
      origin: props.origin,
    });
    return withSessionInCavAiHref(props.expandHref || fallbackHref, sessionId);
  }, [
    props.contextLabel,
    props.expandHref,
    props.origin,
    props.projectId,
    props.surface,
    props.workspaceId,
    sessionId,
  ]);

  const sidebarSurfaceItems = useMemo(
    () =>
      SIDEBAR_SURFACE_MENU.map((item) => {
        const fallbackContext = CENTER_CONFIG[item.surface]?.contextLabel || "Workspace context";
        return {
          ...item,
          active: item.surface === props.surface,
          href: buildCavAiSurfaceUrl({
            surface: item.surface,
            contextLabel: s(props.contextLabel) || fallbackContext,
            workspaceId: props.workspaceId,
            projectId: props.projectId,
            origin: props.origin,
          }),
        };
      }),
    [props.contextLabel, props.origin, props.projectId, props.surface, props.workspaceId]
  );

  useEffect(() => {
    agentRegistrySnapshotRef.current = agentRegistrySnapshot;
  }, [agentRegistrySnapshot]);

  useEffect(() => {
    installedAgentIdsRef.current = installedAgentIds;
  }, [installedAgentIds]);

  useLayoutEffect(() => {
    const boot = readBootClientPlanBootstrap();
    const bootProfileState = readBootClientProfileState();
    const bootProfileUsername = s(bootProfileState?.username).toLowerCase();
    const nextAuthenticatedHint = boot.authenticatedHint || hasBootProfileSignal(bootProfileState);
    setAccountInitialFallback(s(bootProfileState?.initials));
    setAccountProfileUsername(bootProfileUsername);
    setAccountProfileAvatar(s(bootProfileState?.avatarImage));
    setAccountProfileTone(s(bootProfileState?.avatarTone).toLowerCase() || "lime");
    setAccountProfilePublicEnabled(
      typeof bootProfileState?.publicProfileEnabled === "boolean" ? bootProfileState.publicProfileEnabled : null
    );
    setProfileIdentity({
      fullName: s(bootProfileState?.fullName),
      username: bootProfileUsername,
    });
    setAccountPlanId(boot.planId);
    setModelOptions(centerPlanModelOptions(boot.planId));
    setAvailableReasoningLevels(reasoningLevelsForPlan(boot.planId));
    if (nextAuthenticatedHint) {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    return subscribeClientPlan((planId) => {
      setAccountPlanId(planId);
      setIsAuthenticated(true);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = `(max-width: ${CAVAI_MOBILE_LAYOUT_BREAKPOINT_PX}px)`;
    const media = window.matchMedia(query);
    const sync = () => {
      const nextIsPhone = media.matches;
      setIsPhoneLayout(nextIsPhone);
      if (!nextIsPhone) setMobileDrawerOpen(false);
    };
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (overlay || !isPhoneLayout || typeof document === "undefined" || typeof window === "undefined") return;
    const scrollY = window.scrollY;
    const {
      overflow: bodyOverflow,
      overscrollBehaviorY: bodyOverscrollBehaviorY,
      position: bodyPosition,
      top: bodyTop,
      left: bodyLeft,
      right: bodyRight,
      width: bodyWidth,
      height: bodyHeight,
    } = document.body.style;
    const {
      overflow: docOverflow,
      overscrollBehaviorY: docOverscrollBehaviorY,
      height: docHeight,
    } = document.documentElement.style;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.overscrollBehaviorY = "none";
    document.documentElement.style.overscrollBehaviorY = "none";
    document.documentElement.style.height = "100%";
    document.body.style.position = "fixed";
    document.body.style.top = `${-scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = docOverflow;
      document.body.style.overscrollBehaviorY = bodyOverscrollBehaviorY;
      document.documentElement.style.overscrollBehaviorY = docOverscrollBehaviorY;
      document.documentElement.style.height = docHeight;
      document.body.style.position = bodyPosition;
      document.body.style.top = bodyTop;
      document.body.style.left = bodyLeft;
      document.body.style.right = bodyRight;
      document.body.style.width = bodyWidth;
      document.body.style.height = bodyHeight;
      window.scrollTo(0, scrollY);
    };
  }, [isPhoneLayout, overlay]);

  useEffect(() => {
    if (overlay || !isPhoneLayout || typeof document === "undefined") return;
    const { overflowX: bodyOverflowX } = document.body.style;
    const { overflowX: docOverflowX } = document.documentElement.style;
    document.body.style.overflowX = "hidden";
    document.documentElement.style.overflowX = "hidden";
    return () => {
      document.body.style.overflowX = bodyOverflowX;
      document.documentElement.style.overflowX = docOverflowX;
    };
  }, [isPhoneLayout, overlay]);

  const resolveFloatingComposerMenuTrigger = useCallback((menu: Exclude<ComposerMenu, null>) => {
    if (menu === "quick_actions") return quickActionsTriggerRef.current;
    if (menu === "model") return composerModelTriggerRef.current;
    if (menu === "reasoning") return composerReasoningTriggerRef.current;
    if (menu === "audio_model") return composerAudioTriggerRef.current;
    return agentModeTriggerRef.current;
  }, []);

  const syncFloatingComposerMenuAnchor = useCallback((menu: Exclude<ComposerMenu, null>) => {
    if (typeof window === "undefined") return;
    const trigger = resolveFloatingComposerMenuTrigger(menu);
    if (!trigger) return;
    const visualViewport = window.visualViewport;
    const viewportLeft = visualViewport?.offsetLeft ?? 0;
    const viewportTop = visualViewport?.offsetTop ?? 0;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const rect = trigger.getBoundingClientRect();
    const composerShellRect = composerControlsRef.current?.parentElement?.getBoundingClientRect() ?? null;
    const availableWidth = Math.max(120, Math.floor(viewportWidth - 20));
    const width = Math.min(resolveFloatingComposerMenuPreferredWidth(menu), availableWidth);
    const left = Math.min(
      Math.max(viewportLeft + 10, rect.left + viewportLeft),
      Math.max(viewportLeft + 10, viewportLeft + viewportWidth - width - 10)
    );
    const anchorTop = composerShellRect ? composerShellRect.top : rect.top;
    const composerTopInLayoutViewport = anchorTop + viewportTop;
    const bottom = Math.max(8, window.innerHeight - composerTopInLayoutViewport + 8);
    const maxHeight = Math.max(0, Math.floor(anchorTop - 18));
    setFloatingComposerMenuAnchor({
      menu,
      left: Math.round(left),
      bottom: Math.round(bottom),
      width,
      maxHeight,
    });
  }, [resolveFloatingComposerMenuTrigger]);

  useEffect(() => {
    if (!openComposerMenu || !isPhoneLayout) {
      setFloatingComposerMenuAnchor(null);
      return;
    }
    syncFloatingComposerMenuAnchor(openComposerMenu);
    const onViewportChange = () => syncFloatingComposerMenuAnchor(openComposerMenu);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [isPhoneLayout, openComposerMenu, syncFloatingComposerMenuAnchor]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileDrawerOpen]);

  const filteredSessions = useMemo(() => {
    const query = s(sessionQuery).toLowerCase();
    if (!query) return sessions;
    return sessions.filter((item) => {
      const title = s(item.title).toLowerCase();
      const context = s(item.contextLabel).toLowerCase();
      const preview = s(item.preview).toLowerCase();
      return title.includes(query) || context.includes(query) || preview.includes(query);
    });
  }, [sessionQuery, sessions]);
  const visibleSessionCount = useMemo(() => (clientHydrated ? sessions.length : 0), [clientHydrated, sessions.length]);
  const visibleFilteredSessions = useMemo(
    () => (clientHydrated ? filteredSessions : []),
    [clientHydrated, filteredSessions]
  );

  const currentSession = useMemo(() => sessions.find((item) => item.id === sessionId) || null, [sessionId, sessions]);
  const reasoningPanelMessage = useMemo(
    () => messages.find((item) => item.id === reasoningPanelMessageId) || null,
    [messages, reasoningPanelMessageId]
  );
  const reasoningPanelMeta = useMemo(
    () => (reasoningPanelMessage ? resolveExecutionMetaFromMessage(reasoningPanelMessage) : null),
    [reasoningPanelMessage]
  );
  const reasoningPanelContextRows = useMemo(() => {
    if (!reasoningPanelMeta) return [];
    const rawRows = reasoningPanelMeta.safeSummary.contextUsed.length
      ? reasoningPanelMeta.safeSummary.contextUsed
      : reasoningPanelMeta.contextSignals;
    const rows = rawRows.map((row) => toReasoningContextLabel(row)).filter(Boolean);
    return rows.length ? rows : ["No additional context signals captured."];
  }, [reasoningPanelMeta]);
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
  const sessionScopeKey = initialSessionScopeKey;
  const scheduleSessionCachePersist = useCallback((overrides?: {
    sessions?: CavAiSessionSummary[];
    activeSessionId?: string | null;
  }) => {
    if (!isGuestPreviewMode || typeof window === "undefined") return;
    const sessionsSource = Array.isArray(overrides?.sessions) ? overrides.sessions : sessions;
    const normalizedSessions: CavAiSessionSummary[] = [];
    const sessionSeen = new Set<string>();
    for (const row of sessionsSource) {
      const normalized = normalizeCachedSessionSummary(row);
      if (!normalized) continue;
      if (sessionSeen.has(normalized.id)) continue;
      sessionSeen.add(normalized.id);
      normalizedSessions.push(normalized);
      if (normalizedSessions.length >= CAVAI_GUEST_SESSION_CACHE_MAX_SESSIONS) break;
    }

    const messageEntries: CenterSessionCacheMessageEntry[] = [];
    const messageEntrySeen = new Set<string>();
    const nowMs = Date.now();
    for (const [sessionKeyRaw, messageRowsRaw] of sessionMessageCacheRef.current.entries()) {
      const sessionKey = s(sessionKeyRaw);
      if (!sessionKey || !isGuestPreviewSessionId(sessionKey)) continue;
      if (messageEntrySeen.has(sessionKey)) continue;
      const normalizedMessages: CavAiMessage[] = [];
      for (const messageRow of Array.isArray(messageRowsRaw) ? messageRowsRaw : []) {
        const normalized = normalizeCachedMessage(messageRow);
        if (!normalized) continue;
        normalizedMessages.push(normalized);
      }
      messageEntries.push({
        sessionId: sessionKey,
        messages: normalizedMessages.slice(-CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGES_PER_SESSION),
        updatedAtMs: nowMs,
      });
      messageEntrySeen.add(sessionKey);
      if (messageEntries.length >= CAVAI_GUEST_SESSION_CACHE_MAX_MESSAGE_ENTRIES) break;
    }

    const activeCandidate = s(overrides?.activeSessionId ?? (activeSessionIdRef.current || sessionId));
    const activeSessionId = isGuestPreviewSessionId(activeCandidate) ? activeCandidate : "";
    const snapshot: CenterSessionCacheSnapshot = {
      activeSessionId,
      sessions: normalizedSessions,
      messageEntries,
    };

    try {
      window.localStorage.setItem(
        buildCenterGuestSessionCacheStorageKey(sessionScopeKey),
        JSON.stringify(snapshot)
      );
    } catch {
      // Best effort only.
    }
  }, [isGuestPreviewMode, sessionId, sessionScopeKey, sessions]);

  const clearUnavailableSession = useCallback((staleSessionId: string) => {
    const normalized = s(staleSessionId);
    if (!normalized) return;

    const nextSessions = sessions.filter((row) => row.id !== normalized);
    sessionMessageRequestRef.current.delete(normalized);
    sessionMessageCacheRef.current = new Map(
      Array.from(sessionMessageCacheRef.current.entries()).filter(([id]) => id !== normalized)
    );
    setSessions(nextSessions);

    const activeSessionId = s(activeSessionIdRef.current);
    if (activeSessionId !== normalized) {
      setError("");
      scheduleSessionCachePersist({ sessions: nextSessions });
      return;
    }

    const nextActiveSessionId = s(nextSessions[0]?.id);
    const nextCachedMessages = nextActiveSessionId
      ? sessionMessageCacheRef.current.get(nextActiveSessionId) || null
      : null;
    activeSessionIdRef.current = nextActiveSessionId;
    setSessionId(nextActiveSessionId);
    setLoadingMessages(Boolean(nextActiveSessionId && !nextCachedMessages));
    if (!nextActiveSessionId) {
      setMessages([]);
    } else {
      if (nextCachedMessages) setMessages(nextCachedMessages);
      else {
        const summary = nextSessions.find((row) => row.id === nextActiveSessionId) || null;
        setMessages(buildSyntheticThreadFromSessionSummary(summary));
      }
    }
    setError("");
    scheduleSessionCachePersist({
      sessions: nextSessions,
      activeSessionId: nextActiveSessionId,
    });
  }, [scheduleSessionCachePersist, sessions]);

  const overlayEmptyHeadline = "Hi there";
  const overlayEmptySubline = "How can I assist you?";
  const emptyHeadline = overlay ? overlayEmptyHeadline : heroLine || CAVAI_SAFE_FALLBACK_LINE;
  const emptySubline = overlay ? overlayEmptySubline : "";
  const hasInlineEditPending = submitting && Boolean(s(inlineEditPendingAnchorId));
  const hasPendingPrompt = submitting && (Boolean(s(pendingPromptText)) || hasInlineEditPending);
  const hasInlineEdit = Boolean(inlineEditDraft);
  const isEmptyThread = !messages.length && !loadingMessages && !hasPendingPrompt && !hasInlineEdit;
  const showVoiceOrb = voiceOrbState !== "idle";
  const showOverlayGreeting = !(overlay && isEmptyThread && showVoiceOrb);
  const threadInnerClassName = [styles.centerThreadInner, isEmptyThread ? styles.centerThreadInnerEmpty : styles.centerThreadInnerChat]
    .filter(Boolean)
    .join(" ");
  const emptyTitleClassName = [
    styles.centerEmptyTitle,
    overlay ? styles.centerEmptyTitleOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");
  const emptySublineClassName = [
    styles.centerEmptyText,
    overlay ? styles.centerEmptyTextOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sidebarCollapsedActive = !isPhoneLayout && sidebarCollapsed;
  const hasExistingThread = Boolean(sessionId || messages.length || currentSession || hasInlineEdit);
  const centerComposerInThread = !overlay && isEmptyThread && !isPhoneLayout;
  const emptyStateClassName = [
    styles.centerEmptyState,
    centerComposerInThread ? styles.centerEmptyStateWithComposer : "",
    overlay ? styles.centerEmptyStateOverlay : "",
  ]
    .filter(Boolean)
    .join(" ");
  const showSignedOutMobileLegal = !overlay && isPhoneLayout && authProbeReady && isGuestPreviewMode && isEmptyThread;
  const installedAgentIdSet = useMemo(
    () => new Set(installedAgentIds.map((id) => s(id).toLowerCase())),
    [installedAgentIds]
  );
  const builtInRegistryCards = useMemo(
    () => flattenBuiltInRegistryCards(agentRegistrySnapshot),
    [agentRegistrySnapshot]
  );
  const knownBuiltInAgentIds = useMemo(
    () => builtInRegistryCards.map((card) => card.id),
    [builtInRegistryCards]
  );
  const knownBuiltInAgentIdSet = useMemo(
    () => new Set(knownBuiltInAgentIds),
    [knownBuiltInAgentIds]
  );
  const centerAgentMode = useMemo<"general" | "companion">(
    () => (selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID ? "companion" : "general"),
    [selectedModel]
  );
  const modeBuiltInCards = useMemo(() => {
    const seen = new Set<string>();
    const rows: BuiltInRegistryCard[] = [];
    const buckets = isGuestPreviewMode
      ? [
        agentRegistrySnapshot.cavai.installed,
        agentRegistrySnapshot.cavai.available,
        agentRegistrySnapshot.cavai.locked,
        agentRegistrySnapshot.caven.installed,
        agentRegistrySnapshot.caven.available,
        agentRegistrySnapshot.caven.support,
        agentRegistrySnapshot.caven.premiumLocked,
        agentRegistrySnapshot.companion.installed,
        agentRegistrySnapshot.companion.available,
      ]
      : centerAgentMode === "companion"
        ? [agentRegistrySnapshot.companion.installed, agentRegistrySnapshot.companion.available]
        : [
          agentRegistrySnapshot.cavai.installed,
          agentRegistrySnapshot.cavai.available,
          agentRegistrySnapshot.cavai.locked,
          agentRegistrySnapshot.caven.installed,
          agentRegistrySnapshot.caven.available,
          agentRegistrySnapshot.caven.support,
          agentRegistrySnapshot.caven.premiumLocked,
        ];
    for (const bucket of buckets) {
      for (const card of bucket) {
        if (!card.id || seen.has(card.id)) continue;
        seen.add(card.id);
        rows.push(card);
      }
    }
    const fallbackRows = CENTER_BUILT_IN_AGENT_BANK
      .filter((agent) =>
        isGuestPreviewMode
          ? true
          : centerAgentMode === "companion"
          ? agent.mode === "companion"
          : agent.mode !== "companion"
      )
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        summary: agent.summary,
        iconSrc: agent.iconSrc,
        actionKey: agent.actionKey,
        cavcodeAction: null,
        centerAction: agent.centerAction,
        minimumPlan: agent.minimumPlan,
        installed: false,
        locked: isGuestPreviewMode ? true : isPlanLocked({ accountPlanId, minimumPlan: agent.minimumPlan }),
        bank: agent.family,
        supportForCaven: agent.family === "caven",
        source: "builtin" as const,
      }));
    if (!rows.length) return fallbackRows;
    return [
      ...rows,
      ...fallbackRows.filter((card) => !seen.has(card.id)),
    ];
  }, [
    accountPlanId,
    agentRegistrySnapshot.caven.available,
    agentRegistrySnapshot.caven.installed,
    agentRegistrySnapshot.caven.premiumLocked,
    agentRegistrySnapshot.caven.support,
    agentRegistrySnapshot.cavai.available,
    agentRegistrySnapshot.cavai.installed,
    agentRegistrySnapshot.cavai.locked,
    agentRegistrySnapshot.companion.available,
    agentRegistrySnapshot.companion.installed,
    centerAgentMode,
    isGuestPreviewMode,
  ]);
  const builtInCenterAgentBank = useMemo<CenterRuntimeAgentOption[]>(
    () => modeBuiltInCards.map((card) => toCenterRuntimeBuiltInAgent({ card })),
    [modeBuiltInCards]
  );
  const customCenterAgentBank = useMemo<CenterRuntimeAgentOption[]>(
    () =>
      customAgents
        .filter((agent) => agent.surface === "all" || agent.surface === "center")
        .map((agent) => ({
          id: agent.id,
          name: s(agent.name) || agent.id,
          summary: s(agent.summary),
          actionKey: agent.actionKey,
          iconSrc: runtimeAgentIconSrc(agent.iconSvg),
          minimumPlan: "free",
          centerAction: null,
          source: "custom" as const,
          family: "cavai",
          surface: agent.surface,
          mode: "general" as const,
          locked: false,
          bank: "custom",
        })),
    [customAgents]
  );
  const publishedCenterAgentBank = useMemo<CenterRuntimeAgentOption[]>(
    () =>
      publishedAgents
        .filter((agent) => agent.surface === "all" || agent.surface === "center")
        .map((agent) => ({
          id: agent.id,
          name: s(agent.name) || agent.id,
          summary: s(agent.summary),
          actionKey: agent.actionKey,
          iconSrc: runtimeAgentIconSrc(agent.iconSvg),
          minimumPlan: "free",
          centerAction: null,
          source: "published" as const,
          family: "cavai",
          surface: agent.surface,
          mode: "general" as const,
          locked: false,
          bank: "published",
          ownerName: agent.ownerName,
          ownerUsername: agent.ownerUsername,
        })),
    [publishedAgents]
  );
  const centerAgentBankCatalog = useMemo<CenterRuntimeAgentOption[]>(
    () => [...builtInCenterAgentBank, ...customCenterAgentBank, ...publishedCenterAgentBank],
    [builtInCenterAgentBank, customCenterAgentBank, publishedCenterAgentBank]
  );
  const scopedCenterAgentBankCatalog = useMemo(
    () => (isGuestPreviewMode ? centerAgentBankCatalog : centerAgentBankCatalog.filter((agent) => agent.mode === centerAgentMode)),
    [centerAgentBankCatalog, centerAgentMode, isGuestPreviewMode]
  );
  const installedCenterAgents = useMemo(
    () =>
      (isGuestPreviewMode
        ? []
        :
      scopedCenterAgentBankCatalog.filter(
        (agent) =>
          installedAgentIdSet.has(agent.id)
          && !agent.locked
      )),
    [installedAgentIdSet, isGuestPreviewMode, scopedCenterAgentBankCatalog]
  );
  const availableCenterAgentBank = useMemo(
    () =>
      (isGuestPreviewMode
        ? []
        :
      scopedCenterAgentBankCatalog.filter(
        (agent) =>
          !installedAgentIdSet.has(agent.id)
          && !agent.locked
      )),
    [installedAgentIdSet, isGuestPreviewMode, scopedCenterAgentBankCatalog]
  );
  const lockedCenterAgents = useMemo(
    () =>
      (isGuestPreviewMode
        ? scopedCenterAgentBankCatalog
        :
      scopedCenterAgentBankCatalog.filter(
        (agent) => agent.locked
      )),
    [isGuestPreviewMode, scopedCenterAgentBankCatalog]
  );
  const normalizedAgentModeQuery = useMemo(() => s(agentModeQuery).toLowerCase(), [agentModeQuery]);
  const filterAgentListForQuery = useCallback(
    (list: CenterRuntimeAgentOption[]) => {
      if (!normalizedAgentModeQuery) return list;
      return list.filter((agent) => {
        const haystack = [
          agent.name,
          agent.summary,
          agent.actionKey,
          agent.ownerName || "",
          agent.ownerUsername || "",
          agent.source === "custom" ? "my agents private" : "",
          agent.source === "published" ? "published operators shared" : "",
          "cavai",
          agent.mode === "companion" ? "companion cavbot" : "general",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedAgentModeQuery);
      });
    },
    [normalizedAgentModeQuery]
  );
  const visibleInstalledCenterAgents = useMemo(
    () => filterAgentListForQuery(installedCenterAgents),
    [filterAgentListForQuery, installedCenterAgents]
  );
  const visibleAvailableCenterAgentBank = useMemo(
    () => filterAgentListForQuery(availableCenterAgentBank),
    [availableCenterAgentBank, filterAgentListForQuery]
  );
  const visibleLockedCenterAgents = useMemo(
    () => filterAgentListForQuery(lockedCenterAgents),
    [filterAgentListForQuery, lockedCenterAgents]
  );
  const installedMyAgents = useMemo(
    () => visibleInstalledCenterAgents.filter((agent) => agent.source === "custom"),
    [visibleInstalledCenterAgents]
  );
  const installedPublishedCenterAgents = useMemo(
    () => visibleInstalledCenterAgents.filter((agent) => agent.source === "published"),
    [visibleInstalledCenterAgents]
  );
  const installedCavAiAgents = useMemo(
    () => visibleInstalledCenterAgents.filter((agent) =>
      agent.source === "builtin" && (
      centerAgentMode === "companion" && !isGuestPreviewMode
        ? agent.mode === "companion"
        : agent.family === "cavai" && agent.mode !== "companion")
    ),
    [centerAgentMode, isGuestPreviewMode, visibleInstalledCenterAgents]
  );
  const installedCavenAgents = useMemo(
    () => visibleInstalledCenterAgents.filter((agent) => agent.source === "builtin" && agent.family === "caven"),
    [visibleInstalledCenterAgents]
  );
  const bankMyAgents = useMemo(
    () => visibleAvailableCenterAgentBank.filter((agent) => agent.source === "custom"),
    [visibleAvailableCenterAgentBank]
  );
  const bankPublishedCenterAgents = useMemo(
    () => visibleAvailableCenterAgentBank.filter((agent) => agent.source === "published"),
    [visibleAvailableCenterAgentBank]
  );
  const bankCavAiAgents = useMemo(
    () => visibleAvailableCenterAgentBank.filter((agent) =>
      agent.source === "builtin" && (
      centerAgentMode === "companion" && !isGuestPreviewMode
        ? agent.mode === "companion"
        : agent.family === "cavai" && agent.mode !== "companion")
    ),
    [centerAgentMode, isGuestPreviewMode, visibleAvailableCenterAgentBank]
  );
  const bankCavenAgents = useMemo(
    () => visibleAvailableCenterAgentBank.filter((agent) => agent.source === "builtin" && agent.family === "caven"),
    [visibleAvailableCenterAgentBank]
  );
  const lockedCavAiAgents = useMemo(
    () => visibleLockedCenterAgents.filter((agent) =>
      agent.source === "builtin" && (
      centerAgentMode === "companion" && !isGuestPreviewMode
        ? agent.mode === "companion"
        : agent.family === "cavai" && agent.mode !== "companion")
    ),
    [centerAgentMode, isGuestPreviewMode, visibleLockedCenterAgents]
  );
  const lockedCavenAgents = useMemo(
    () => visibleLockedCenterAgents.filter((agent) => agent.source === "builtin" && agent.family === "caven"),
    [visibleLockedCenterAgents]
  );
  const lockedCompanionAgents = useMemo(
    () => visibleLockedCenterAgents.filter((agent) => agent.source === "builtin" && agent.mode === "companion"),
    [visibleLockedCenterAgents]
  );
  const centerPrimaryFamilyLabel = centerAgentMode === "companion" ? "CavBot Companion" : "CavAi";
  const centerPrimarySectionLabel = centerPrimaryFamilyLabel;
  const centerLegacyAgentBankLabel = "Agent Bank";
  const describeCenterAgentMeta = useCallback((agent: CenterRuntimeAgentOption): string => {
    if (agent.source === "published") {
      return agent.ownerUsername ? `by @${agent.ownerUsername}` : `by ${agent.ownerName || "Operator"}`;
    }
    if (agent.source === "custom") {
      const placementLabel = agent.surface === "center"
        ? "CavAi only"
        : agent.surface === "cavcode"
          ? "Caven only"
          : "All surfaces";
      return placementLabel;
    }
    return "";
  }, []);
  const selectedInstalledAgentOption = useMemo(
    () =>
      manualAgentRef
        ? installedCenterAgents.find(
          (agent) =>
            agent.id === manualAgentRef.agentId
            && agent.actionKey === manualAgentRef.agentActionKey
        ) || null
        : null,
    [installedCenterAgents, manualAgentRef]
  );
  const activeAgentName = useMemo(() => {
    if (!selectedInstalledAgentOption) return "";
    return s(selectedInstalledAgentOption.name) || selectedInstalledAgentOption.id;
  }, [selectedInstalledAgentOption]);
  const canUseCreateImage = !isGuestPreviewMode && (accountPlanId === "premium" || accountPlanId === "premium_plus");
  const canUseEditImage = !isGuestPreviewMode && accountPlanId === "premium_plus";
  const canUseCavSafeImageStorage = !isGuestPreviewMode && (accountPlanId === "premium" || accountPlanId === "premium_plus");
  const canUseDeepResearch = !isGuestPreviewMode && (accountPlanId === "premium" || accountPlanId === "premium_plus");
  const maxImageAttachments = useMemo(() => maxImageAttachmentsForPlan(accountPlanId), [accountPlanId]);
  const selectedImagePreset = useMemo(
    () => imageStudioPresets.find((row) => row.id === selectedImagePresetId) || null,
    [imageStudioPresets, selectedImagePresetId]
  );
  const selectedImagePresetActivationMode = useMemo<ImageStudioActivationLineMode>(
    () => (composerQuickMode === "edit_image" ? "edit" : "create"),
    [composerQuickMode]
  );
  const selectedImagePresetActivationLine = useMemo(
    () => (selectedImagePreset
      ? buildImageStudioActivationLine(selectedImagePresetActivationMode, selectedImagePreset.label)
      : ""),
    [selectedImagePreset, selectedImagePresetActivationMode]
  );
  const syncPresetActivationLine = useCallback((args: {
    preset: ImageStudioPreset;
    mode: ImageStudioActivationLineMode;
    force?: boolean;
  }) => {
    const activationLine = buildImageStudioActivationLine(args.mode, args.preset.label);
    if (!activationLine) return;
    const lockedPrefix = `${activationLine}\n`;
    setPrompt((prev) => {
      const current = String(prev ?? "");
      if (args.force) {
        const next = buildLockedImageStudioPrompt(activationLine, "");
        return current === next ? prev : next;
      }
      if (!s(current)) {
        return buildLockedImageStudioPrompt(activationLine, "");
      }
      const { firstLine, remainder } = splitFirstLine(current);
      if (isImageStudioActivationLine(firstLine) || matchesAnyImageStudioActivationLine(current, args.preset.label)) {
        const next = buildLockedImageStudioPrompt(activationLine, remainder);
        return current === next ? prev : next;
      }
      return prev;
    });
    requestAnimationFrame(() => {
      const input = composerInputRef.current;
      if (!input) return;
      const currentValue = normalizeLineBreaks(input.value);
      if (!currentValue.startsWith(lockedPrefix)) return;
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
      input.setSelectionRange(lockedPrefix.length, lockedPrefix.length);
    });
  }, []);
  const imageAttachmentsPresent = images.length > 0;
  const hasCenterAgentOptions = installedCenterAgents.length > 0;
  const hasAnyCenterAgentOptions =
    hasCenterAgentOptions || availableCenterAgentBank.length > 0 || lockedCenterAgents.length > 0;
  const agentModeActive = composerQuickMode === "agent_mode" && Boolean(selectedInstalledAgentOption);
  const activeToolbarQuickMode = composerQuickMode === "create_image"
    || composerQuickMode === "edit_image"
    || composerQuickMode === "deep_research"
    ? composerQuickMode
    : selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID
      ? "companion"
      : null;
  const qwenMaxVisible = modelOptions.some((item) => item.id === ALIBABA_QWEN_MAX_MODEL_ID);
  const researchModeActive = researchMode || selectedModel === ALIBABA_QWEN_MAX_MODEL_ID;
  const showComposerModelControl = overlay;
  const showComposerReasoningControl = true;
  const promptPlaceholder = useMemo(() => {
    if (isGuestPreviewMode) {
      return "Ask CavAi anything...";
    }
    if (composerQuickMode === "agent_mode" && activeAgentName) {
      return hasExistingThread
        ? `Continue with ${activeAgentName}.`
        : `Ask ${activeAgentName} to handle this request.`;
    }
    if (composerQuickMode === "create_image") {
      return canUseEditImage ? "Describe or edit an image" : "Describe an image";
    }
    if (composerQuickMode === "edit_image") {
      return "Describe or edit an image";
    }
    if (selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID) {
      return hasExistingThread
        ? "Continue talking to CavBot."
        : "Talk to CavBot about ideas, strategy, or support.";
    }
    if (hasExistingThread) {
      return researchModeActive
        ? (accountPlanId === "premium_plus" && qwenMaxVisible
          ? "Continue web research with Qwen3-Max"
          : "Continue deep research")
        : "Follow up with CavAi";
    }
    if (overlay) {
      return researchModeActive
        ? "Ask CavAi to research the web and synthesize evidence"
        : "Ask CavAi to plan, inspect, or improve your workspace";
    }
    return researchModeActive ? "Ask CavAi to research the web" : "Ask CavAi";
  }, [
    activeAgentName,
    accountPlanId,
    canUseEditImage,
    composerQuickMode,
    hasExistingThread,
    overlay,
    qwenMaxVisible,
    researchModeActive,
    selectedModel,
    isGuestPreviewMode,
  ]);
  const modelMenuOptions = useMemo<CavAiSelectableOption[]>(() => {
    if (isGuestPreviewMode) {
      return CAVAI_GUEST_PREVIEW_MODELS;
    }
    const options: CavAiSelectableOption[] = [{ id: CAVAI_AUTO_MODEL_ID, label: resolveAiModelLabel(CAVAI_AUTO_MODEL_ID), locked: false }];
    const normalized = normalizeCenterModelOptions(modelOptions);
    const companion = normalized.find((option) => option.id === ALIBABA_QWEN_CHARACTER_MODEL_ID);
    if (companion) {
      options.push({
        id: companion.id,
        label: resolveAiModelLabel(companion.id),
        locked: false,
      });
    }
    for (const option of normalized) {
      if (option.id === ALIBABA_QWEN_IMAGE_MODEL_ID || option.id === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) continue;
      if (options.some((row) => row.id === option.id)) continue;
      options.push({
        id: option.id,
        label: resolveAiModelLabel(option.id),
        locked: false,
      });
    }
    return options;
  }, [isGuestPreviewMode, modelOptions]);
  const deepResearchPreferredModel = useMemo(() => {
    if (isGuestPreviewMode) return ALIBABA_QWEN_FLASH_MODEL_ID;
    const hasPlus = modelMenuOptions.some((option) => option.id === ALIBABA_QWEN_PLUS_MODEL_ID);
    if (accountPlanId === "premium_plus" && qwenMaxVisible) return ALIBABA_QWEN_MAX_MODEL_ID;
    if (hasPlus) return ALIBABA_QWEN_PLUS_MODEL_ID;
    return CAVAI_AUTO_MODEL_ID;
  }, [accountPlanId, isGuestPreviewMode, modelMenuOptions, qwenMaxVisible]);
  const voiceReplyModel = useMemo(() => {
    const available = new Set(modelMenuOptions.map((option) => s(option.id)));
    const selected = s(selectedModel);
    const selectedIsQwenTextModel =
      selected.startsWith("qwen")
      && selected !== ALIBABA_QWEN_CHARACTER_MODEL_ID
      && selected !== ALIBABA_QWEN_IMAGE_MODEL_ID
      && selected !== ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
    if (selectedIsQwenTextModel && available.has(selected)) return selected;
    if (researchModeActive && available.has(ALIBABA_QWEN_MAX_MODEL_ID)) return ALIBABA_QWEN_MAX_MODEL_ID;
    if (available.has(ALIBABA_QWEN_PLUS_MODEL_ID)) return ALIBABA_QWEN_PLUS_MODEL_ID;
    if (available.has(ALIBABA_QWEN_FLASH_MODEL_ID)) return ALIBABA_QWEN_FLASH_MODEL_ID;
    return ALIBABA_QWEN_PLUS_MODEL_ID;
  }, [modelMenuOptions, researchModeActive, selectedModel]);
  const reasoningMenuOptions = useMemo<CavAiReasoningSelectableOption[]>(
    () =>
      REASONING_LEVEL_OPTIONS
        .filter((option) => (isGuestPreviewMode ? true : availableReasoningLevels.includes(option.value)))
        .map((option) => ({
          ...option,
          locked: isGuestPreviewMode ? option.value !== "low" : false,
        })),
    [availableReasoningLevels, isGuestPreviewMode]
  );
  const selectedModelLabel = useMemo(() => {
    if (isGuestPreviewMode) return resolveAiModelLabel(ALIBABA_QWEN_FLASH_MODEL_ID);
    if (selectedModel === ALIBABA_QWEN_IMAGE_MODEL_ID) return "Image Studio";
    if (selectedModel === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) return "Image Edit";
    const match = modelMenuOptions.find((option) => option.id === selectedModel);
    if (match) return match.label;
    if (selectedModel === CAVAI_AUTO_MODEL_ID) return resolveAiModelLabel(CAVAI_AUTO_MODEL_ID);
    return resolveAiModelLabel(selectedModel);
  }, [isGuestPreviewMode, modelMenuOptions, selectedModel]);
  const selectedReasoningLabel = useMemo(() => {
    const match = REASONING_LEVEL_OPTIONS.find((option) => option.value === reasoningLevel);
    return match?.label || toReasoningDisplayLabel(reasoningLevel);
  }, [reasoningLevel]);
  const accountInitial = useMemo(
    () => deriveAccountInitial(accountProfileUsername || profileIdentity.username, accountInitialFallback),
    [accountInitialFallback, accountProfileUsername, profileIdentity.username]
  );
  const accountHasAvatar = Boolean(s(accountProfileAvatar));
  const accountChipBackground = useMemo(() => resolveAccountToneBackground(accountProfileTone), [accountProfileTone]);
  const accountChipInk = useMemo(() => resolveAccountToneInk(accountProfileTone), [accountProfileTone]);
  const accountNameLabel = useMemo(() => {
    const fullName = s(profileIdentity.fullName);
    if (fullName) return fullName;
    const username = normalizeInitialUsernameSource(s(accountProfileUsername || profileIdentity.username));
    if (username) return `${username.slice(0, 1).toUpperCase()}${username.slice(1)}`;
    return "CavBot Operator";
  }, [accountProfileUsername, profileIdentity.fullName, profileIdentity.username]);
  const accountPlanLabel = useMemo(() => toPlanTierLabel(accountPlanId), [accountPlanId]);
  const publicProfileHref = useMemo(() => {
    return buildCanonicalPublicProfileHref(accountProfileUsername);
  }, [accountProfileUsername]);
  const profileMenuLabel = useMemo(() => {
    if (accountProfilePublicEnabled === null) return "Profile";
    return accountProfilePublicEnabled ? "Public Profile" : "Private Profile";
  }, [accountProfilePublicEnabled]);
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
    modelId: string;
    level: ReasoningLevel;
    researchMode: boolean;
    contextLabel: string;
    surface: AiCenterSurface;
  }) => {
    clearReasoningTicker();
    const modelLabel = resolveAiModelLabel(s(args.modelId) || CAVAI_AUTO_MODEL_ID);
    const levelLabel = toReasoningDisplayLabel(args.level);
    const stagedLines = [
      "Syncing",
      `Using ${modelLabel} with ${levelLabel} reasoning`,
      args.researchMode
        ? "Collecting and validating source evidence"
        : `Mapping prompt intent for ${args.surface} actions`,
      "Drafting response and recommendations",
      "Finalizing answer",
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
  }, [clearReasoningTicker]);
  const syncComposerInputHeight = useCallback(() => {
    if (typeof window === "undefined") return;
    const node = composerInputRef.current;
    if (!node) return;
    const computed = window.getComputedStyle(node);
    const minHeight = Number.parseFloat(computed.minHeight) || CENTER_COMPOSER_MIN_HEIGHT_PX;
    const maxHeight = Number.parseFloat(computed.maxHeight) || CENTER_COMPOSER_MAX_HEIGHT_PX;
    const hasTypedInput = s(node.value).length > 0;
    node.style.height = "auto";
    const nextHeight = hasTypedInput
      ? Math.min(maxHeight, Math.max(minHeight, node.scrollHeight))
      : minHeight;
    node.style.height = `${Math.round(nextHeight)}px`;
    node.style.overflowY = node.scrollHeight > maxHeight + 1 ? "auto" : "hidden";
  }, []);

  const appendTranscriptToComposer = useCallback((transcriptRaw: string) => {
    const transcript = s(transcriptRaw);
    if (!transcript) {
      setError("Voice input did not produce a transcript.");
      return false;
    }
    setPrompt((prev) => {
      const existing = s(prev);
      const lockedImagePrompt =
        Boolean(selectedImagePresetActivationLine)
        && normalizeImageStudioActivationLine(existing) === normalizeImageStudioActivationLine(selectedImagePresetActivationLine);
      if (lockedImagePrompt && selectedImagePresetActivationLine) {
        const userText = extractImageStudioUserTextFromLockedPrompt(existing, selectedImagePresetActivationLine);
        const nextUserText = userText ? `${userText}\n\n${transcript}` : transcript;
        return buildLockedImageStudioPrompt(selectedImagePresetActivationLine, nextUserText);
      }
      return existing ? `${existing}\n\n${transcript}` : transcript;
    });
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        syncComposerInputHeight();
        composerInputRef.current?.focus();
      });
    }
    return true;
  }, [selectedImagePresetActivationLine, syncComposerInputHeight]);

  useEffect(() => {
    activeSessionIdRef.current = sessionId;
    scheduleSessionCachePersist({ activeSessionId: sessionId });
  }, [scheduleSessionCachePersist, sessionId]);

  useEffect(() => {
    const normalized = s(sessionId);
    if (!normalized) return;
    if (loadingMessages && !messages.length) return;
    sessionMessageCacheRef.current.set(normalized, messages);
    scheduleSessionCachePersist();
  }, [loadingMessages, messages, scheduleSessionCachePersist, sessionId]);

  useEffect(() => {
    if (!reasoningPanelMessageId) return;
    if (messages.some((item) => item.id === reasoningPanelMessageId)) return;
    setReasoningPanelMessageId("");
  }, [messages, reasoningPanelMessageId]);

  useEffect(() => {
    if (!copiedMessageToken || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setCopiedMessageToken(""), 1_600);
    return () => window.clearTimeout(timer);
  }, [copiedMessageToken]);

  useEffect(() => {
    const normalized = s(props.initialSessionId);
    const previous = appliedInitialSessionIdRef.current;
    if (previous === normalized) return;
    appliedInitialSessionIdRef.current = normalized;
    if (!normalized) {
      // Preserve hydrated boot state when no explicit initial session is provided.
      if (previous === null) return;
      activeSessionIdRef.current = "";
      setInlineEditPendingAnchorId("");
      setPendingPromptText("");
      setSessionId("");
      setLoadingMessages(false);
      setMessages([]);
      scheduleSessionCachePersist({ activeSessionId: "" });
      return;
    }

    activeSessionIdRef.current = normalized;
    setInlineEditPendingAnchorId("");
    setPendingPromptText("");
    const cachedMessages = sessionMessageCacheRef.current.get(normalized);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
    setSessionId(normalized);
    setError("");
    scheduleSessionCachePersist({ activeSessionId: normalized });
  }, [props.initialSessionId, scheduleSessionCachePersist]);

  const loadSessions = useCallback(async (): Promise<boolean> => {
    if (!authProbeReady) return false;
    if (isGuestPreviewMode) return true;
    try {
      const res = await fetch(buildSessionsUrl({ limit: 60 }), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ sessions?: CavAiSessionSummary[] }>;
      if (!res.ok || !body.ok) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return true;
        }
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || CENTER_LOAD_SESSIONS_FAILED_MESSAGE);
      }
      setError("");
      const rows = Array.isArray(body.sessions) ? body.sessions : [];
      setSessions(rows);

      if (!rows.length) {
        activeSessionIdRef.current = "";
        setSessionId("");
        setMessages([]);
        return true;
      }

      const activeSessionId = s(activeSessionIdRef.current);
      if (activeSessionId && rows.some((row) => row.id === activeSessionId)) return true;
      activeSessionIdRef.current = "";
      setSessionId("");
      setMessages([]);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : CENTER_LOAD_SESSIONS_FAILED_MESSAGE;
      setError(message);
      return false;
    }
  }, [applyUnauthenticatedCenterState, authProbeReady, isGuestPreviewMode]);

  const syncGuestSessionCacheToAccount = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    const payload = collectGuestSessionSyncPayloadFromStorage();
    if (!payload.sessions.length) {
      clearPendingGuestSessionSyncInStorage();
      clearAllCenterGuestSessionCacheSnapshotsFromStorage();
      return true;
    }
    try {
      const res = await fetch("/api/cavai/guest-sync", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: unknown;
        error?: unknown;
        requestId?: unknown;
      };
      if (!res.ok || body.ok !== true) {
        const requestId = s(body.requestId);
        const detail = s(body.message) || s(body.error) || "Failed to sync guest chats.";
        const statusLabel = Number.isFinite(res.status) ? `HTTP ${res.status}` : "HTTP error";
        const requestLabel = requestId ? ` · request ${requestId}` : "";
        throw new Error(`${detail} (${statusLabel}${requestLabel})`);
      }
      clearPendingGuestSessionSyncInStorage();
      clearAllCenterGuestSessionCacheSnapshotsFromStorage();
      return true;
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[cavai] guest sync failed", err);
      }
      const detail = err instanceof Error ? s(err.message) : "";
      if (detail) {
        setError((current) => current || detail);
      }
      return false;
    }
  }, []);

  const fetchSessionMessages = useCallback(async (nextSessionId: string): Promise<CavAiMessage[]> => {
    const normalized = s(nextSessionId);
    if (!normalized) return [];
    if (!authProbeReady) return [];
    if (isGuestPreviewMode) {
      const cached = sessionMessageCacheRef.current.get(normalized);
      if (cached) return cached;
      const summary = sessions.find((item) => item.id === normalized) || null;
      return buildSyntheticThreadFromSessionSummary(summary);
    }
    const inFlight = sessionMessageRequestRef.current.get(normalized);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const res = await fetch(`/api/ai/sessions/${encodeURIComponent(normalized)}/messages?limit=240`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ messages?: CavAiMessage[] }>;
      if (!res.ok || !body.ok) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return [];
        }
        if (isSessionUnavailableLikeResponse(res.status, body)) {
          clearUnavailableSession(normalized);
          return [];
        }
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || CENTER_LOAD_MESSAGES_FAILED_MESSAGE);
      }
      const rows = Array.isArray(body.messages) ? body.messages : [];
      const normalizedRows = rows.map((row) => ({
        ...row,
        feedback: toSafeFeedbackState((row as CavAiMessage).feedback),
      }));
      const summary = sessions.find((item) => item.id === normalized) || null;
      const fallbackRows = buildSyntheticThreadFromSessionSummary(summary);
      const resolvedRows = normalizedRows.length ? normalizedRows : fallbackRows;
      sessionMessageCacheRef.current.set(normalized, resolvedRows);
      scheduleSessionCachePersist();
      return resolvedRows;
    })();

    sessionMessageRequestRef.current.set(normalized, requestPromise);
    try {
      return await requestPromise;
    } finally {
      const active = sessionMessageRequestRef.current.get(normalized);
      if (active === requestPromise) {
        sessionMessageRequestRef.current.delete(normalized);
      }
    }
  }, [applyUnauthenticatedCenterState, authProbeReady, clearUnavailableSession, isGuestPreviewMode, scheduleSessionCachePersist, sessions]);

  const loadMessages = useCallback(async (nextSessionId: string) => {
    const normalized = s(nextSessionId);
    if (!normalized) {
      setMessages([]);
      return;
    }

    if (isGuestPreviewMode) {
      const cachedGuestMessages = sessionMessageCacheRef.current.get(normalized);
      if (cachedGuestMessages) {
        setMessages(cachedGuestMessages);
        setLoadingMessages(false);
        return;
      }
      const summary = sessions.find((item) => item.id === normalized) || null;
      setMessages(buildSyntheticThreadFromSessionSummary(summary));
      setLoadingMessages(false);
      return;
    }

    const cachedMessages = sessionMessageCacheRef.current.get(normalized);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
      void fetchSessionMessages(normalized)
        .then((resolvedRows) => {
          if (s(activeSessionIdRef.current) !== normalized) return;
          setMessages(resolvedRows);
        })
        .catch((err) => {
          if (s(activeSessionIdRef.current) !== normalized) return;
          const message = err instanceof Error ? err.message : CENTER_LOAD_MESSAGES_FAILED_MESSAGE;
          // Keep stale cache visible when background refresh fails, but surface the retryable failure.
          setError(message);
        });
      return;
    } else {
      const summary = sessions.find((item) => item.id === normalized) || null;
      const fallbackRows = buildSyntheticThreadFromSessionSummary(summary);
      setMessages(fallbackRows);
      setLoadingMessages(true);
    }

    try {
      const resolvedRows = await fetchSessionMessages(normalized);
      setError("");
      if (s(activeSessionIdRef.current) !== normalized) return;
      setMessages(resolvedRows);
    } catch (err) {
      const message = err instanceof Error ? err.message : CENTER_LOAD_MESSAGES_FAILED_MESSAGE;
      setError(message);
    } finally {
      if (s(activeSessionIdRef.current) === normalized) {
        setLoadingMessages(false);
      }
    }
  }, [fetchSessionMessages, isGuestPreviewMode, sessions]);

  const prefetchSessionMessages = useCallback((seedSessionId?: string | null) => {
    if (isGuestPreviewMode) return;
    const activeId = s(seedSessionId) || s(activeSessionIdRef.current);
    const candidates = sessions
      .map((row) => s(row.id))
      .filter(Boolean)
      .filter((id) => id !== activeId)
      .filter((id) => !sessionMessageCacheRef.current.has(id))
      .filter((id) => !sessionMessageRequestRef.current.has(id))
      .slice(0, SESSION_MESSAGE_PREFETCH_COUNT);
    for (const id of candidates) {
      void fetchSessionMessages(id).catch(() => {
        // Best-effort prefetch.
      });
    }
  }, [fetchSessionMessages, isGuestPreviewMode, sessions]);

  const loadProviderModels = useCallback(async (): Promise<boolean> => {
    if (!authProbeReady) return false;
    if (isGuestPreviewMode) {
      setAccountPlanId("free");
      setModelOptions(guestPreviewModelOptions);
      setAudioModelOptions([]);
      setAvailableReasoningLevels(guestPreviewReasoningLevels);
      return true;
    }
    try {
      const res = await fetch("/api/ai/test?catalog=plan&surface=center&action=technical_recap", {
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
          image?: unknown[];
        };
        reasoning?: {
          maxLevel?: unknown;
          options?: unknown[];
        };
        guardDecision?: unknown;
      };
      if (!res.ok || body.ok !== true) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return true;
        }
        emitGuardDecisionFromPayload(body);
        setModelOptions(centerPlanModelOptions(accountPlanId));
        setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
        return false;
      }
      const effectivePlanId = resolveServerPlanId(body.planId, accountPlanId);
      setAccountPlanId(effectivePlanId);
      publishClientPlan({
        planId: effectivePlanId,
        preserveStrongerCached: true,
      });
      const hasCatalog = Boolean(body.modelCatalog && typeof body.modelCatalog === "object");
      const textOptions = Array.isArray(body.modelCatalog?.text)
        ? body.modelCatalog?.text.map((row) => toModelOption(row)).filter(Boolean) as CavAiModelOption[]
        : [];
      const imageOptions = Array.isArray(body.modelCatalog?.image)
        ? body.modelCatalog?.image.map((row) => toModelOption(row)).filter(Boolean) as CavAiModelOption[]
        : [];
      if (hasCatalog) {
        const nextOptions = clampCenterModelOptionsToPlan([...textOptions, ...imageOptions], effectivePlanId);
        setModelOptions(nextOptions.length ? nextOptions : centerPlanModelOptions(effectivePlanId));
      } else {
        const fallbackOptions = [s(body.models?.chat), s(body.models?.reasoning)]
          .filter(Boolean)
          .map((id) => ({
            id,
            label: resolveAiModelLabel(id),
          }));
        const nextOptions = clampCenterModelOptionsToPlan(fallbackOptions, effectivePlanId);
        setModelOptions(nextOptions.length ? nextOptions : centerPlanModelOptions(effectivePlanId));
      }

      const audioOptions = Array.isArray(body.modelCatalog?.audio)
        ? body.modelCatalog?.audio.map((row) => toModelOption(row)).filter(Boolean) as CavAiModelOption[]
        : [];
      setAudioModelOptions(audioOptions);

      const optionsFromPolicy = normalizeReasoningOptions(body.reasoning?.options);
      if (optionsFromPolicy.length) {
        const nextReasoning = clampCenterReasoningLevelsToPlan(optionsFromPolicy, effectivePlanId);
        setAvailableReasoningLevels(nextReasoning.length ? nextReasoning : reasoningLevelsForPlan(effectivePlanId));
      } else {
        const optionsFromMax = reasoningLevelsUpTo(body.reasoning?.maxLevel);
        const nextReasoning = optionsFromMax.length ? optionsFromMax : reasoningLevelsForPlan(effectivePlanId);
        const nextReasoningLevels = clampCenterReasoningLevelsToPlan(nextReasoning, effectivePlanId);
        setAvailableReasoningLevels(nextReasoningLevels.length ? nextReasoningLevels : reasoningLevelsForPlan(effectivePlanId));
      }
      return true;
    } catch {
      // Best effort only.
      setModelOptions(centerPlanModelOptions(accountPlanId));
      setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
      return false;
    }
  }, [
    accountPlanId,
    applyUnauthenticatedCenterState,
    authProbeReady,
    guestPreviewModelOptions,
    guestPreviewReasoningLevels,
    isGuestPreviewMode,
  ]);

  const loadCavenAgentRegistry = useCallback(async (): Promise<boolean> => {
    if (!authProbeReady) return false;
    if (isGuestPreviewMode) {
      setAccountPlanId("free");
      resetCenterAgentRegistryState();
      return true;
    }
    try {
      const res = await fetch("/api/cavai/settings", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: unknown;
        agentRegistry?: unknown;
        publishedAgents?: unknown;
        planId?: unknown;
      };
      if (!res.ok || body.ok !== true || !body.settings || typeof body.settings !== "object") {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return true;
        }
        return false;
      }
      const effectivePlanId = normalizePlanId(body.planId);
      setAccountPlanId(effectivePlanId);
      publishClientPlan({
        planId: effectivePlanId,
        preserveStrongerCached: true,
      });
      const snapshot = normalizeAgentRegistrySnapshot(body.agentRegistry);
      setAgentRegistrySnapshot(snapshot);
      agentRegistrySnapshotRef.current = snapshot;

      const knownBuiltInIds = flattenBuiltInRegistryCards(snapshot).map((card) => card.id);
      const knownBuiltInIdSet = new Set(knownBuiltInIds);
      const row = body.settings as Record<string, unknown>;
      const nextCustomAgents = normalizeRuntimeCustomAgents(row.customAgents, knownBuiltInIdSet);
      const nextPublishedAgents = normalizePublishedOperatorAgents(body.publishedAgents, knownBuiltInIdSet);
      const nextCustomIdSet = new Set(nextCustomAgents.map((agent) => agent.id));
      const nextPublishedIdSet = new Set(nextPublishedAgents.map((agent) => agent.id));
      const installedRaw = normalizeInstalledAgentIdsFromSettings(row.installedAgentIds);
      const installedSet = new Set(installedRaw);
      const orderedKnown = knownBuiltInIds.filter((id) => installedSet.has(id));
      const orderedCustom = nextCustomAgents.map((agent) => agent.id).filter((id) => installedSet.has(id));
      const orderedPublished = nextPublishedAgents.map((agent) => agent.id).filter((id) => installedSet.has(id));
      const orderedUnknown = installedRaw.filter(
        (id) => !knownBuiltInIdSet.has(id) && !nextCustomIdSet.has(id) && !nextPublishedIdSet.has(id)
      );
      setCustomAgents(nextCustomAgents);
      setPublishedAgents(nextPublishedAgents);
      setInstalledAgentIds([...orderedKnown, ...orderedCustom, ...orderedPublished, ...orderedUnknown]);
      return true;
    } catch {
      return false;
    }
  }, [applyUnauthenticatedCenterState, authProbeReady, isGuestPreviewMode, resetCenterAgentRegistryState]);

  const loadImageStudioBootstrap = useCallback(async (): Promise<boolean> => {
    if (!authProbeReady) return false;
    if (isGuestPreviewMode) {
      resetImageStudioBootstrapState();
      return true;
    }
    try {
      const res = await fetch("/api/cavai/image-studio/bootstrap", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        presets?: unknown[];
        recent?: unknown[];
        saved?: unknown[];
        history?: unknown[];
      };
      if (!res.ok || body.ok !== true) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return true;
        }
        return false;
      }
      const presets = Array.isArray(body.presets)
        ? body.presets.map((row) => parseImageStudioPreset(row)).filter(Boolean) as ImageStudioPreset[]
        : [];
      setImageStudioPresets(presets);
      setImageStudioRecent(
        Array.isArray(body.recent)
          ? body.recent.map((row) => parseImageStudioHistoryRow(row)).filter(Boolean) as ImageStudioHistoryRow[]
          : []
      );
      setImageStudioSaved(
        Array.isArray(body.saved)
          ? body.saved.map((row) => parseImageStudioHistoryRow(row)).filter(Boolean) as ImageStudioHistoryRow[]
          : []
      );
      setImageStudioHistory(
        Array.isArray(body.history)
          ? body.history.map((row) => parseImageStudioHistoryRow(row)).filter(Boolean) as ImageStudioHistoryRow[]
          : []
      );
      setSelectedImagePresetId("");
      return true;
    } catch {
      return false;
    }
  }, [applyUnauthenticatedCenterState, authProbeReady, isGuestPreviewMode, resetImageStudioBootstrapState]);

  const loadImageStudioHistoryView = useCallback(async (view: "recent" | "saved" | "history") => {
    if (!authProbeReady) return false;
    if (isGuestPreviewMode) {
      if (view === "saved") setImageStudioSaved([]);
      else if (view === "history") setImageStudioHistory([]);
      else setImageStudioRecent([]);
      return true;
    }
    try {
      const res = await fetch(`/api/cavai/image-studio/history?view=${encodeURIComponent(view)}&limit=36`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        rows?: unknown[];
      };
      if (!res.ok || body.ok !== true) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          return true;
        }
        return false;
      }
      const rows = Array.isArray(body.rows)
        ? body.rows.map((row) => parseImageStudioHistoryRow(row)).filter(Boolean) as ImageStudioHistoryRow[]
        : [];
      if (view === "saved") {
        setImageStudioSaved(rows);
      } else if (view === "history") {
        setImageStudioHistory(rows);
      } else {
        setImageStudioRecent(rows);
      }
      return true;
    } catch {
      return false;
    }
  }, [applyUnauthenticatedCenterState, authProbeReady, isGuestPreviewMode]);

  const loadImageStudioSourceGallery = useCallback(async (source: "cavcloud" | "cavsafe") => {
    if (isGuestPreviewMode) {
      if (source === "cavsafe") setImageStudioGallerySafe([]);
      else setImageStudioGalleryCloud([]);
      return false;
    }
    if (source === "cavsafe" && !canUseCavSafeImageStorage) {
      setImageStudioGallerySafe([]);
      return false;
    }
    setImageStudioLoadingSource(true);
    try {
      const endpoint = source === "cavsafe" ? "/api/cavsafe/gallery" : "/api/cavcloud/gallery";
      const res = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        files?: unknown[];
      };
      if (!res.ok || body.ok !== true) return false;
      const rows = Array.isArray(body.files)
        ? body.files.map((row) => parseImageStudioGalleryItem(row)).filter(Boolean) as ImageStudioGalleryItem[]
        : [];
      if (source === "cavsafe") {
        setImageStudioGallerySafe(rows);
      } else {
        setImageStudioGalleryCloud(rows);
      }
      return true;
    } catch {
      return false;
    } finally {
      setImageStudioLoadingSource(false);
    }
  }, [canUseCavSafeImageStorage, isGuestPreviewMode]);

  const loadCavCloudAttachItems = useCallback(async () => {
    if (isGuestPreviewMode) {
      setCavCloudAttachItems([]);
      return true;
    }
    setCavCloudAttachLoading(true);
    try {
      const res = await fetch("/api/cavcloud/gallery", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        files?: unknown[];
      };
      if (!res.ok || body.ok !== true) return false;
      const rows = Array.isArray(body.files)
        ? body.files.map((row) => parseCavCloudAttachFileItem(row)).filter(Boolean) as CavCloudAttachFileItem[]
        : [];
      setCavCloudAttachItems(rows);
      return true;
    } catch {
      return false;
    } finally {
      setCavCloudAttachLoading(false);
    }
  }, [isGuestPreviewMode]);

  const preloadIconSources = useCallback((sources: string[]) => {
    if (typeof window === "undefined") return;
    const seen = preloadedIconSrcRef.current;
    for (const rawSource of sources) {
      const source = s(rawSource);
      if (!source || seen.has(source)) continue;
      seen.add(source);
      const img = new window.Image();
      img.decoding = "async";
      img.src = source;
    }
  }, []);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    if (isOpen) {
      warmSessionsKeyRef.current = sessionScopeKey;
      void loadSessions();
      return;
    }
    if (warmSessionsKeyRef.current === sessionScopeKey) return;
    warmSessionsKeyRef.current = sessionScopeKey;
    void (async () => {
      const ok = await loadSessions();
      if (!ok && warmSessionsKeyRef.current === sessionScopeKey) {
        warmSessionsKeyRef.current = "";
      }
    })();
  }, [authProbeReady, isOpen, loadSessions, sessionScopeKey, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    if (isOpen) {
      void loadProviderModels();
      warmedModelsRef.current = true;
      return;
    }
    if (warmedModelsRef.current) return;
    warmedModelsRef.current = true;
    void (async () => {
      const ok = await loadProviderModels();
      if (!ok) warmedModelsRef.current = false;
    })();
  }, [authProbeReady, isOpen, loadProviderModels, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    void loadCavenAgentRegistry();
  }, [authProbeReady, loadCavenAgentRegistry, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    void loadImageStudioBootstrap();
  }, [authProbeReady, loadImageStudioBootstrap, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm) return;
    preloadIconSources([
      "/icons/expand-svgrepo-com.svg",
      "/icons/app/cavcode/plus-large-svgrepo-com.svg",
      "/icons/copy-svgrepo-com.svg",
      "/icons/app/image-combiner-svgrepo-com.svg",
      "/icons/thumb-up-cavai.svg",
      "/icons/thumb-down-cavai.svg",
      "/icons/app/audio-description2-svgrepo-com.svg",
      "/icons/app/stop-svgrepo-com.svg",
      "/icons/app/share-2-svgrepo-com.svg",
      "/icons/app/reload-svgrepo-com.svg",
      ...CENTER_BUILT_IN_AGENT_BANK.map((agent) => agent.iconSrc),
      ...centerAgentBankCatalog.map((agent) => agent.iconSrc),
    ]);
  }, [centerAgentBankCatalog, preloadIconSources, shouldWarm]);

  useEffect(() => {
    if (!authProbeReady) return;
    if (openComposerMenu !== "agent_mode") return;
    void loadCavenAgentRegistry();
  }, [authProbeReady, loadCavenAgentRegistry, openComposerMenu]);

  useEffect(() => {
    if (!imageStudioImportModalOpen) return;
    if (imageStudioImportSource === "cavcloud" && !imageStudioGalleryCloud.length) {
      void loadImageStudioSourceGallery("cavcloud");
    }
    if (imageStudioImportSource === "cavsafe" && !imageStudioGallerySafe.length) {
      void loadImageStudioSourceGallery("cavsafe");
    }
  }, [
    imageStudioGalleryCloud.length,
    imageStudioGallerySafe.length,
    imageStudioImportModalOpen,
    imageStudioImportSource,
    loadImageStudioSourceGallery,
  ]);

  useEffect(() => {
    if (!cavCloudAttachModalOpen) return;
    if (cavCloudAttachItems.length) return;
    void loadCavCloudAttachItems();
  }, [cavCloudAttachItems.length, cavCloudAttachModalOpen, loadCavCloudAttachItems]);

  useEffect(() => {
    setClientHydrated(true);
  }, []);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    if (!sessionId) {
      setMessages([]);
      return;
    }
    void loadMessages(sessionId);
  }, [authProbeReady, isOpen, loadMessages, sessionId, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm || !authProbeReady) return;
    if (!sessions.length) return;
    prefetchSessionMessages(sessionId);
  }, [authProbeReady, prefetchSessionMessages, sessionId, sessions.length, shouldWarm]);

  useEffect(() => {
    scheduleSessionCachePersist({
      sessions,
      activeSessionId: sessionId,
    });
  }, [scheduleSessionCachePersist, sessionId, sessions]);

  useEffect(() => {
    if (isGuestPreviewMode) return;
    if (isPhoneLayout) return;
    if (!sidebarCollapsed) return;
    if (!accountMenuOpen) return;
    setAccountMenuOpen(false);
  }, [accountMenuOpen, isGuestPreviewMode, isPhoneLayout, sidebarCollapsed]);

  useEffect(() => {
    if (isGuestPreviewMode) return;
    setGuestAuthDismissed(false);
    setAccountMenuOpen(false);
    setGuestAuthStage("email");
    setGuestAuthEmail("");
    setGuestAuthPassword("");
    setGuestAuthName("");
    setGuestAuthUsername("");
    setGuestAuthBusy(false);
    setGuestAuthError("");
  }, [isGuestPreviewMode]);

  useEffect(() => {
    if (overlay) return;
    if (!authProbeReady) return;
    if (!isGuestPreviewMode) return;
    if (guestAuthDismissed) return;
    setAccountMenuOpen(true);
  }, [authProbeReady, guestAuthDismissed, isGuestPreviewMode, overlay]);

  useEffect(() => {
    if (isGuestPreviewMode) return;
    setModelOptions(centerPlanModelOptions(accountPlanId));
    setAvailableReasoningLevels(reasoningLevelsForPlan(accountPlanId));
  }, [accountPlanId, isGuestPreviewMode]);

  useEffect(() => {
    if (!overlay) {
      setHistoryOpen(false);
      return;
    }
    if (!isOpen) setHistoryOpen(false);
  }, [isOpen, overlay]);

  useEffect(() => {
    if (!isPhoneLayout) return;
    if (!mobileDrawerOpen) return;
    setSidebarCollapsed(false);
  }, [isPhoneLayout, mobileDrawerOpen]);

  useEffect(() => {
    if (!shouldWarm) return;
    const syncIdentity = () => setProfileIdentity(readCavAiIdentityFromStorage());
    syncIdentity();
    const onProfileSync = () => syncIdentity();
    window.addEventListener("cb:profile-sync", onProfileSync as EventListener);
    return () => {
      window.removeEventListener("cb:profile-sync", onProfileSync as EventListener);
    };
  }, [shouldWarm]);

  const refreshAuthProfile = useCallback(async (opts?: { cancelled?: () => boolean }): Promise<boolean> => {
    const isCancelled = opts?.cancelled;
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
          initials?: unknown;
          avatarTone?: unknown;
          avatarImage?: unknown;
          publicProfileEnabled?: unknown;
        };
        account?: {
          tier?: unknown;
          tierEffective?: unknown;
        };
      };
      if (isCancelled?.()) return false;
      const shouldApplyGuestFallback = isAuthRequiredLikeResponse(res.status, body)
        || (res.ok && body.ok === true && body.authenticated === false);
      if (shouldApplyGuestFallback) {
        applyUnauthenticatedCenterState();
        return false;
      }
      if (!res.ok || body.ok !== true || body.authenticated !== true) {
        // Keep account history visible until the backend explicitly proves the viewer is signed out.
        setIsAuthenticated(true);
        return false;
      }
      setIsAuthenticated(true);
      setAccountProfileUsername(s(body.user?.username).toLowerCase());
      setAccountInitialFallback(s(body.user?.initials));
      setAccountProfileTone(s(body.user?.avatarTone).toLowerCase() || "lime");
      setAccountProfileAvatar(s(body.user?.avatarImage));
      const nextIdentity = rememberCavAiIdentity({
        fullName: s(body.user?.displayName),
        username: s(body.user?.username),
      });
      setProfileIdentity(nextIdentity);
      if (typeof body.user?.publicProfileEnabled === "boolean") {
        setAccountProfilePublicEnabled(body.user.publicProfileEnabled);
      }
      const authPlanId = normalizePlanId(body.account?.tierEffective ?? body.account?.tier);
      setAccountPlanId(authPlanId);
      publishClientPlan({
        planId: authPlanId,
        preserveStrongerCached: true,
      });
      return true;
    } catch {
      if (isCancelled?.()) return false;
      // A transient auth probe failure should not dump the user into guest preview and blank history.
      setIsAuthenticated(true);
      return false;
    } finally {
      if (!isCancelled?.()) {
        setAuthProbeReady(true);
      }
    }
  }, [applyUnauthenticatedCenterState]);

  useEffect(() => {
    if (!shouldWarm) return;
    if (!isOpen && warmedAuthProfileRef.current) return;
    warmedAuthProfileRef.current = true;
    let cancelled = false;
    void refreshAuthProfile({ cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshAuthProfile, shouldWarm]);

  useEffect(() => {
    if (!shouldWarm || typeof window === "undefined") return;
    const refreshProtectedState = async () => {
      const authenticated = await refreshAuthProfile();
      if (!authenticated) return;
      void loadSessions();
      void loadProviderModels();
      void loadCavenAgentRegistry();
      void loadImageStudioHistoryView(imageStudioHistoryView);
    };
    const onFocus = () => {
      void refreshProtectedState();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshProtectedState();
    };
    window.addEventListener("pageshow", onFocus);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", onFocus);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    imageStudioHistoryView,
    loadCavenAgentRegistry,
    loadImageStudioHistoryView,
    loadProviderModels,
    loadSessions,
    refreshAuthProfile,
    shouldWarm,
  ]);

  useEffect(() => {
    if (isAuthenticated) return;
    guestSessionSyncAttemptedRef.current = false;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!shouldWarm || !isAuthenticated) return;
    if (guestSessionSyncAttemptedRef.current) return;
    if (!hasPendingGuestSessionSyncInStorage() && !hasGuestSessionCacheSnapshotsInStorage()) return;
    guestSessionSyncAttemptedRef.current = true;
    void (async () => {
      const synced = await syncGuestSessionCacheToAccount();
      if (!synced) {
        setError((current) => current || "Signed in, but we could not sync your guest chats yet. Refresh to retry.");
        return;
      }
      void loadSessions();
    })();
  }, [isAuthenticated, loadSessions, shouldWarm, syncGuestSessionCacheToAccount]);

  useEffect(() => {
    if (!shouldWarm) return;
    const onProfile = (event: Event) => {
      try {
        const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
        const nextIdentity = rememberCavAiIdentity({
          fullName: s(detail.fullName) || s(detail.displayName),
          username: s(detail.username),
        });
        setProfileIdentity(nextIdentity);
        if (typeof detail.username === "string") {
          setAccountProfileUsername(detail.username.trim().toLowerCase());
        }
        if (typeof detail.initials === "string") {
          setAccountInitialFallback(detail.initials.trim());
        }
        if (typeof detail.tone === "string") {
          setAccountProfileTone(detail.tone.trim().toLowerCase() || "lime");
        } else if (typeof detail.avatarTone === "string") {
          setAccountProfileTone(detail.avatarTone.trim().toLowerCase() || "lime");
        }
        if (typeof detail.avatarImage === "string") {
          setAccountProfileAvatar(detail.avatarImage.trim());
        } else if (detail.avatarImage === null) {
          setAccountProfileAvatar("");
        }
        if (typeof detail.publicProfileEnabled === "boolean") {
          setAccountProfilePublicEnabled(detail.publicProfileEnabled);
        }
      } catch {
        // Best effort only.
      }
    };
    window.addEventListener("cb:profile", onProfile as EventListener);
    return () => window.removeEventListener("cb:profile", onProfile as EventListener);
  }, [shouldWarm]);

  useEffect(() => {
    if (!isGuestPreviewMode) return;
    setSessionActionModal(null);
    setSessionActionBusy(false);
    setRenameDraftTitle("");
    setShareMode("internal");
    setShareTargetIdentity("");
    setShareResultUrl("");
    setShareDeliveredHint("");
    setShareResultCopied(false);
    setManualAgentRef(null);
    setComposerQuickMode(null);
    setResearchMode(false);
    setImages([]);
    setUploadedFiles([]);
    setSelectedModel(ALIBABA_QWEN_FLASH_MODEL_ID);
    setReasoningLevel("low");
    setSelectedAudioModel("auto");

    const snapshot = readCenterSessionCacheSnapshot(sessionScopeKey);
    const snapshotSessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
    let nextSessions: CavAiSessionSummary[] = snapshotSessions;
    if (snapshotSessions.length) {
      setSessions(snapshotSessions);
    } else {
      setSessions((prev) => {
        const fallback = prev.filter((row) => isGuestPreviewSessionId(row.id));
        nextSessions = fallback;
        return fallback;
      });
    }

    const snapshotMessageMap = new Map(
      (snapshot?.messageEntries || []).map((entry) => [entry.sessionId, entry.messages] as const)
    );
    const fallbackMessageMap = new Map(
      Array.from(sessionMessageCacheRef.current.entries()).filter(([key]) => isGuestPreviewSessionId(key))
    );
    const nextMessageMap = snapshotMessageMap.size ? snapshotMessageMap : fallbackMessageMap;
    sessionMessageCacheRef.current = nextMessageMap;

    // Try CavAi should always open as a fresh "new chat" view on first load
    // unless an explicit sessionId is passed in the URL.
    const explicitSessionId = s(props.initialSessionId);
    let nextActiveId = explicitSessionId;
    if (nextActiveId && !isGuestPreviewSessionId(nextActiveId)) {
      nextActiveId = "";
    }

    activeSessionIdRef.current = nextActiveId;
    setSessionId(nextActiveId);
    if (!nextActiveId) {
      setMessages([]);
      return;
    }
    const cachedMessages = nextMessageMap.get(nextActiveId);
    if (cachedMessages) {
      setMessages(cachedMessages);
      return;
    }
    const summary = nextSessions.find((row) => row.id === nextActiveId) || null;
    setMessages(buildSyntheticThreadFromSessionSummary(summary));
  }, [isGuestPreviewMode, props.initialSessionId, sessionScopeKey]);

  useEffect(() => {
    if (!shouldWarm) return;
    const nextLine = pickAndRememberCavAiLine({
      surface: toHeroLineSurface(props.surface),
      identity: {
        fullName: profileIdentity.fullName,
        username: profileIdentity.username,
      },
      scopeKey: `center:${props.surface}`,
    });
    setHeroLine(nextLine || CAVAI_SAFE_FALLBACK_LINE);
  }, [profileIdentity.fullName, profileIdentity.username, props.surface, shouldWarm]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
    setInlineEditDraft(null);
    setInlineEditPrompt("");
    setInlineEditBusy(false);
    setInlineEditPendingAnchorId("");
  }, [sessionId]);

  const scrollThreadToLatest = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = threadRef.current;
    if (!node) return;
    const top = Math.max(0, node.scrollHeight);
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top, behavior });
      return;
    }
    node.scrollTop = top;
  }, []);

  const scrollThreadMessageIntoView = useCallback((messageId: string, behavior: ScrollBehavior = "auto") => {
    const node = threadRef.current;
    const targetMessageId = s(messageId);
    if (!node || !targetMessageId) return;
    const target = Array
      .from(node.querySelectorAll<HTMLElement>("[data-cavai-message-id]"))
      .find((element) => s(element.dataset.cavaiMessageId) === targetMessageId);
    if (!target) return;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior, block: "center", inline: "nearest" });
      return;
    }
    const top = Math.max(0, target.offsetTop - Math.max(24, node.clientHeight / 3));
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top, behavior });
      return;
    }
    node.scrollTop = top;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (!shouldAutoScrollRef.current) return;
    scrollThreadToLatest(hasPendingPrompt ? "smooth" : "auto");
  }, [hasInlineEdit, hasPendingPrompt, isOpen, loadingMessages, messages.length, reasoningContextLines.length, scrollThreadToLatest, sessionId]);

  useEffect(() => {
    if (!inlineEditDraft) return;
    if (typeof window === "undefined") return;
    const targetUserMessageId = s(inlineEditDraft.userMessageId);
    const handle = window.requestAnimationFrame(() => {
      if (targetUserMessageId) {
        scrollThreadMessageIntoView(targetUserMessageId, "smooth");
      }
      const input = inlineEditInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value.length;
      input.setSelectionRange(end, end);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [inlineEditDraft, scrollThreadMessageIntoView]);

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
      const floatingMenu = floatingComposerMenuRef.current;
      if (!root && !floatingMenu) return;
      const target = event.target;
      if (target instanceof Node) {
        if (root?.contains(target)) return;
        if (floatingMenu?.contains(target)) return;
      }
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
    if (openComposerMenu === "agent_mode") return;
    if (!agentModeManageAgentId) return;
    setAgentModeManageAgentId("");
  }, [agentModeManageAgentId, openComposerMenu]);

  useEffect(() => {
    if (!openHeaderModelMenu) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = headerModelMenuRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      setOpenHeaderModelMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenHeaderModelMenu(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openHeaderModelMenu]);

  useEffect(() => {
    if (!accountMenuOpen || isGuestPreviewMode) return;
    const onMouseDown = (event: MouseEvent) => {
      const root = accountMenuRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      setAccountMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [accountMenuOpen, isGuestPreviewMode]);

  const closeActiveSessionMenu = useCallback(() => {
    setActiveSessionMenuId("");
    setActiveSessionMenuAnchor(null);
  }, []);

  const onToggleSessionMenu = useCallback((nextSessionId: string, anchorNode: HTMLButtonElement) => {
    setActiveSessionMenuId((prev) => {
      if (prev === nextSessionId) {
        setActiveSessionMenuAnchor(null);
        return "";
      }
      const rect = anchorNode.getBoundingClientRect();
      setActiveSessionMenuAnchor({
        top: Math.max(8, rect.top - 2),
        right: Math.max(8, window.innerWidth - rect.right),
      });
      return nextSessionId;
    });
  }, []);

  useEffect(() => {
    if (!activeSessionMenuId) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        closeActiveSessionMenu();
        return;
      }
      const inRow = target.closest(`[data-session-menu-id="${activeSessionMenuId}"]`);
      if (inRow) return;
      const inFloatingMenu = target.closest(`[data-session-menu-floating-id="${activeSessionMenuId}"]`);
      if (inFloatingMenu) return;
      closeActiveSessionMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActiveSessionMenu();
    };
    const onViewportChange = () => closeActiveSessionMenu();
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [activeSessionMenuId, closeActiveSessionMenu]);

  useEffect(() => {
    if (!sessionActionModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSessionActionModal(null);
      setSessionActionBusy(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionActionModal]);

  useEffect(() => {
    if (!composerImageViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setComposerImageViewer(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerImageViewer]);

  useEffect(() => {
    if (isOpen) return;
    setAccountMenuOpen(false);
    setOpenComposerMenu(null);
    closeActiveSessionMenu();
  }, [closeActiveSessionMenu, isOpen]);

  useEffect(() => {
    if (isGuestPreviewMode) {
      if (selectedModel !== ALIBABA_QWEN_FLASH_MODEL_ID) {
        setSelectedModel(ALIBABA_QWEN_FLASH_MODEL_ID);
      }
      return;
    }
    if (selectedModel === CAVAI_AUTO_MODEL_ID) return;
    if (modelOptions.some((row) => row.id === selectedModel)) return;
    setResearchMode(false);
    setSelectedModel(CAVAI_AUTO_MODEL_ID);
  }, [isGuestPreviewMode, modelOptions, selectedModel]);

  useEffect(() => {
    if (!isOpen) return;
    syncComposerInputHeight();
  }, [isOpen, prompt, syncComposerInputHeight]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === "undefined") return;
    const handle = window.requestAnimationFrame(() => syncComposerInputHeight());
    return () => window.cancelAnimationFrame(handle);
  }, [isOpen, isPhoneLayout, syncComposerInputHeight]);

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => syncComposerInputHeight();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen, syncComposerInputHeight]);

  useEffect(() => {
    if (!qwenMaxVisible) {
      if (selectedModel === ALIBABA_QWEN_MAX_MODEL_ID) setSelectedModel(CAVAI_AUTO_MODEL_ID);
    }
    if (selectedModel === ALIBABA_QWEN_MAX_MODEL_ID && qwenMaxVisible) {
      if (!researchMode) setResearchMode(true);
      return;
    }
    if (accountPlanId === "free" && researchMode) {
      setResearchMode(false);
    }
  }, [accountPlanId, qwenMaxVisible, researchMode, selectedModel]);

  useEffect(() => {
    if (selectedAudioModel === "auto") return;
    if (audioModelOptions.some((row) => row.id === selectedAudioModel)) return;
    setSelectedAudioModel("auto");
  }, [audioModelOptions, selectedAudioModel]);

  useEffect(() => {
    if (isGuestPreviewMode) {
      if (reasoningLevel !== "low") setReasoningLevel("low");
      return;
    }
    if (availableReasoningLevels.includes(reasoningLevel)) return;
    const fallback = availableReasoningLevels.includes("medium")
      ? "medium"
      : availableReasoningLevels[availableReasoningLevels.length - 1] || "low";
    setReasoningLevel(fallback);
  }, [availableReasoningLevels, isGuestPreviewMode, reasoningLevel]);

  useEffect(() => {
    if (composerQuickMode !== "deep_research") return;
    if (researchModeActive) return;
    setComposerQuickMode(null);
  }, [composerQuickMode, researchModeActive]);

  useEffect(() => {
    if (composerQuickMode === "create_image" && selectedModel !== ALIBABA_QWEN_IMAGE_MODEL_ID) {
      setComposerQuickMode(null);
      return;
    }
    if (composerQuickMode === "edit_image" && selectedModel !== ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) {
      setComposerQuickMode(null);
    }
  }, [composerQuickMode, selectedModel]);

  useEffect(() => {
    if (!selectedImagePreset) return;
    const imageModeActive =
      composerQuickMode === "create_image"
      || composerQuickMode === "edit_image"
      || selectedModel === ALIBABA_QWEN_IMAGE_MODEL_ID
      || selectedModel === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID;
    if (!imageModeActive) return;

    const shouldUseEditTemplate = imageAttachmentsPresent && canUseEditImage;
    const targetQuickMode: ComposerQuickMode = shouldUseEditTemplate ? "edit_image" : "create_image";
    const targetModel = shouldUseEditTemplate ? ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID : ALIBABA_QWEN_IMAGE_MODEL_ID;

    if (composerQuickMode !== targetQuickMode) {
      setComposerQuickMode(targetQuickMode);
    }
    if (selectedModel !== targetModel) {
      setSelectedModel(targetModel);
    }
    if (!shouldUseEditTemplate && imageStudioSourceAssetId) {
      setImageStudioSourceAssetId("");
    }
    syncPresetActivationLine({
      preset: selectedImagePreset,
      mode: shouldUseEditTemplate ? "edit" : "create",
    });
  }, [
    canUseEditImage,
    composerQuickMode,
    imageAttachmentsPresent,
    imageStudioSourceAssetId,
    selectedImagePreset,
    selectedModel,
    syncPresetActivationLine,
  ]);

  useEffect(() => {
    const current = manualAgentRef;
    if (!current) return;
    const stillValid = installedCenterAgents.some(
      (agent) => agent.id === current.agentId && agent.actionKey === current.agentActionKey
    );
    if (stillValid) return;
    setManualAgentRef(null);
    setComposerQuickMode((prev) => (prev === "agent_mode" ? null : prev));
  }, [installedCenterAgents, manualAgentRef]);

  const openMobileDrawer = useCallback(() => {
    if (!isPhoneLayout) return;
    setOpenHeaderModelMenu(false);
    setMobileDrawerOpen(true);
  }, [isPhoneLayout]);

  const closeMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(false);
    setAccountMenuOpen(false);
  }, []);

  const toggleMobileDrawer = useCallback(() => {
    if (!isPhoneLayout) return;
    setOpenHeaderModelMenu(false);
    setMobileDrawerOpen((prev) => !prev);
  }, [isPhoneLayout]);

  const openGuestAuthPanel = useCallback((opts?: { stage?: GuestAuthStage; closeDrawer?: boolean }) => {
    if (!isGuestPreviewMode) return;
    setGuestAuthError("");
    setGuestAuthStage(opts?.stage || "email");
    setGuestAuthDismissed(false);
    setAccountMenuOpen(true);
    if (opts?.closeDrawer) setMobileDrawerOpen(false);
  }, [isGuestPreviewMode]);

  const onNewSession = useCallback(() => {
    if (requestAbortRef.current) {
      requestAbortRef.current.abort();
      requestAbortRef.current = null;
    }
    activeSessionIdRef.current = "";
    setSessionId("");
    setMessages([]);
    setPendingPromptText("");
    setInlineEditPendingAnchorId("");
    setSubmitting(false);
    setError("");
    setPrompt("");
    setImages([]);
    setOpenComposerMenu(null);
    setComposerQuickMode(null);
    setMessageActionPending({});
    setCopiedMessageToken("");
    setHistoryOpen(false);
    setMobileDrawerOpen(false);
    stopReasoningContext();
  }, [stopReasoningContext]);

  const applyModelSelection = useCallback((nextModel: string) => {
    const normalized = s(nextModel) || CAVAI_AUTO_MODEL_ID;
    if (isGuestPreviewMode) {
      if (normalized !== ALIBABA_QWEN_FLASH_MODEL_ID) {
        setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      } else {
        setError("");
      }
      setSelectedModel(ALIBABA_QWEN_FLASH_MODEL_ID);
      setReasoningLevel("low");
      setResearchMode(false);
      setComposerQuickMode(null);
      return;
    }
    if (normalized === ALIBABA_QWEN_MAX_MODEL_ID) {
      setSelectedModel(ALIBABA_QWEN_MAX_MODEL_ID);
      setResearchMode(true);
      setComposerQuickMode("deep_research");
      return;
    }
    if (normalized === ALIBABA_QWEN_IMAGE_MODEL_ID) {
      setSelectedModel(ALIBABA_QWEN_IMAGE_MODEL_ID);
      setResearchMode(false);
      setComposerQuickMode("create_image");
      return;
    }
    if (normalized === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) {
      setSelectedModel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
      setResearchMode(false);
      setComposerQuickMode("edit_image");
      return;
    }
    setSelectedModel(normalized);
    setResearchMode(false);
    setComposerQuickMode((prev) => (prev === "deep_research" || prev === "create_image" || prev === "edit_image" ? null : prev));
  }, [isGuestPreviewMode]);

  const onSelectSession = useCallback((nextSessionId: string) => {
    const normalized = s(nextSessionId);
    if (!normalized) return;
    setMobileDrawerOpen(false);
    activeSessionIdRef.current = normalized;
    const cachedMessages = sessionMessageCacheRef.current.get(normalized);
    if (cachedMessages) {
      setMessages(cachedMessages);
      setLoadingMessages(false);
    } else {
      setMessages([]);
      setLoadingMessages(true);
    }
    setSessionId(normalized);
    setError("");
    setInlineEditPendingAnchorId("");
    if (overlay) setHistoryOpen(false);
    void loadMessages(normalized);
  }, [loadMessages, overlay]);

  const onOpenAccountSettings = useCallback(() => {
    setAccountMenuOpen(false);
    setMobileDrawerOpen(false);
    if (typeof window !== "undefined") {
      if (isGuestPreviewMode) {
        window.location.assign(CAVAI_GUEST_PREVIEW_LOGIN_HREF);
        return;
      }
      openCanonicalPublicProfileWindow({ href: publicProfileHref, fallbackHref: "/settings?tab=account" });
    }
  }, [isGuestPreviewMode, publicProfileHref]);

  const onLogout = useCallback(async () => {
    if (isGuestPreviewMode) {
      if (typeof window !== "undefined") window.location.assign(CAVAI_GUEST_PREVIEW_LOGIN_HREF);
      return;
    }
    if (logoutPending) return;
    setLogoutPending(true);
    setAccountMenuOpen(false);
    setMobileDrawerOpen(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
      });
    } catch {
      // Ignore transport errors and force redirect.
    }

    if (typeof window !== "undefined") {
      window.location.replace("/auth?mode=login");
      return;
    }

    setLogoutPending(false);
  }, [isGuestPreviewMode, logoutPending]);

  const closeGuestAuthPanel = useCallback(() => {
    setGuestAuthDismissed(true);
    setAccountMenuOpen(false);
    setGuestAuthError("");
  }, []);

  const onGuestAuthOauth = useCallback((provider: "github" | "google") => {
    if (typeof window === "undefined") return;
    scheduleSessionCachePersist({
      sessions,
      activeSessionId: sessionId,
    });
    markPendingGuestSessionSyncInStorage();
    const qs = `?next=${encodeURIComponent("/cavai")}`;
    if (provider === "github") {
      window.location.assign(`/api/auth/oauth/github/start${qs}`);
      return;
    }
    window.location.assign(`/api/auth/oauth/google/start${qs}`);
  }, [scheduleSessionCachePersist, sessionId, sessions]);

  const onGuestAuthContinueEmail = useCallback(async () => {
    if (guestAuthBusy) return;
    const email = s(guestAuthEmail).toLowerCase();
    if (!isValidEmailAddress(email)) {
      setGuestAuthError("Enter a valid email address.");
      return;
    }

    setGuestAuthBusy(true);
    setGuestAuthError("");
    try {
      const res = await fetch("/api/auth/lookup/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ email }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        exists?: boolean;
        error?: unknown;
      };
      if (!res.ok || payload.ok !== true) {
        throw new Error(mapGuestAuthError(payload.error, "Unable to continue with email right now."));
      }
      if (payload.exists === true) {
        setGuestAuthStage("login_password");
        return;
      }
      setGuestAuthUsername((prev) => {
        const normalized = normalizeUsername(s(prev).toLowerCase());
        return normalized || suggestGuestAuthUsername(email);
      });
      setGuestAuthStage("signup_details");
    } catch (error) {
      setGuestAuthError((error as Error)?.message || "Unable to continue with email right now.");
    } finally {
      setGuestAuthBusy(false);
    }
  }, [guestAuthBusy, guestAuthEmail]);

  const onGuestAuthSubmitLogin = useCallback(async () => {
    if (guestAuthBusy) return;
    const email = s(guestAuthEmail).toLowerCase();
    const password = s(guestAuthPassword);
    if (!isValidEmailAddress(email)) {
      setGuestAuthError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setGuestAuthError("Enter your password.");
      return;
    }
    setGuestAuthBusy(true);
    setGuestAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          email,
          password,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: unknown;
        challengeRequired?: boolean;
        redirectTo?: unknown;
      };
      if (payload.challengeRequired === true && typeof payload.redirectTo === "string") {
        if (typeof window !== "undefined") {
          scheduleSessionCachePersist({
            sessions,
            activeSessionId: sessionId,
          });
          markPendingGuestSessionSyncInStorage();
          window.location.assign(payload.redirectTo);
        }
        return;
      }
      if (!res.ok || payload.ok !== true) {
        throw new Error(mapGuestAuthError(payload.error, "Log in failed."));
      }
      if (typeof window !== "undefined") {
        scheduleSessionCachePersist({
          sessions,
          activeSessionId: sessionId,
        });
        markPendingGuestSessionSyncInStorage();
        window.location.assign("/cavai");
      }
    } catch (error) {
      setGuestAuthError((error as Error)?.message || "Log in failed.");
    } finally {
      setGuestAuthBusy(false);
    }
  }, [guestAuthBusy, guestAuthEmail, guestAuthPassword, scheduleSessionCachePersist, sessionId, sessions]);

  const onGuestAuthSubmitSignup = useCallback(async () => {
    if (guestAuthBusy) return;
    const email = s(guestAuthEmail).toLowerCase();
    const usernameRaw = s(guestAuthUsername).toLowerCase();
    const username = normalizeUsername(usernameRaw);
    const password = s(guestAuthPassword);
    if (!isValidEmailAddress(email)) {
      setGuestAuthError("Enter a valid email address.");
      return;
    }
    if (!usernameRaw) {
      setGuestAuthError("Username is required to create an account.");
      return;
    }
    if (usernameRaw !== username) {
      setGuestAuthError("Username must be lowercase.");
      return;
    }
    if (!isValidUsername(username)) {
      setGuestAuthError("Username must be 3-20 characters, lowercase, and start with a letter.");
      return;
    }
    if (isReservedUsername(username)) {
      setGuestAuthError("That username is reserved.");
      return;
    }
    if (password.length < 10) {
      setGuestAuthError("Password must be at least 10 characters.");
      return;
    }

    setGuestAuthBusy(true);
    setGuestAuthError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          email,
          password,
          username,
          name: s(guestAuthName) || undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: unknown;
      };
      if (!res.ok || payload.ok !== true) {
        const code = s(payload.error).toLowerCase();
        if (code === "email_in_use") {
          setGuestAuthStage("login_password");
          setGuestAuthError("That email already has an account. Enter your password to log in.");
          return;
        }
        throw new Error(mapGuestAuthError(payload.error, "Sign up failed."));
      }
      if (typeof window !== "undefined") {
        scheduleSessionCachePersist({
          sessions,
          activeSessionId: sessionId,
        });
        markPendingGuestSessionSyncInStorage();
        window.location.assign("/cavai");
      }
    } catch (error) {
      setGuestAuthError((error as Error)?.message || "Sign up failed.");
    } finally {
      setGuestAuthBusy(false);
    }
  }, [guestAuthBusy, guestAuthEmail, guestAuthName, guestAuthPassword, guestAuthUsername, scheduleSessionCachePersist, sessionId, sessions]);

  const onGuestAuthPrimaryAction = useCallback(() => {
    if (guestAuthStage === "email") {
      void onGuestAuthContinueEmail();
      return;
    }
    if (guestAuthStage === "login_password") {
      void onGuestAuthSubmitLogin();
      return;
    }
    void onGuestAuthSubmitSignup();
  }, [guestAuthStage, onGuestAuthContinueEmail, onGuestAuthSubmitLogin, onGuestAuthSubmitSignup]);

  const onSubmit = useCallback(async (override?: string | CavAiCenterSubmitOverride): Promise<string | null> => {
    const submitOverride = typeof override === "string"
      ? { prompt: override }
      : (override || {});
    const deferUiRefresh = submitOverride.deferUiRefresh === true;
    const showPendingPrompt = submitOverride.showPendingPrompt !== false;
    if (submitting) return null;
    const promptValue = s(submitOverride.prompt ?? prompt);
    if (!promptValue) {
      setError("Prompt is required.");
      return null;
    }
    const isGuestRequest = isGuestPreviewMode;
    const requestedReasoningLevel = isGuestRequest
      ? "low"
      : (parseReasoningLevel(submitOverride.reasoningLevel) || reasoningLevel);
    const requestedModel = isGuestRequest
      ? ALIBABA_QWEN_FLASH_MODEL_ID
      : (s(submitOverride.model) || selectedModel);
    const imagesForRequest = Array.isArray(submitOverride.images) ? submitOverride.images : images;
    const uploadedFilesForRequest = Array.isArray(submitOverride.uploadedFiles)
      ? submitOverride.uploadedFiles
      : uploadedFiles;
    if (isGuestRequest && (imagesForRequest.length || uploadedFilesForRequest.length)) {
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      return null;
    }
    if (imagesForRequest.some((image) => image.uploading === true)) {
      setError("Image upload is still in progress. Please wait.");
      return null;
    }
    if (uploadedFilesForRequest.some((file) => file.uploading === true)) {
      setError("Files are still uploading. Please wait a moment.");
      return null;
    }
    const hasImageInputs = imagesForRequest.some((image) => Boolean(s(image.dataUrl)));
    const selectedAction = config.actions[0]?.action || "technical_recap";
    const selectedManualAgent =
      !isGuestRequest && composerQuickMode === "agent_mode" ? selectedInstalledAgentOption : null;
    const modeAction: AiCenterAction | null =
      isGuestRequest
        ? null
        : composerQuickMode === "create_image"
        ? "image_studio"
        : composerQuickMode === "edit_image"
          ? "image_edit"
          : composerQuickMode === "deep_research"
            ? "web_research"
            : null;
    const modeSuggestsImageTask = modeAction === "image_studio" || modeAction === "image_edit";
    const overrideAction = isGuestRequest
      ? "technical_recap"
      : (toAiCenterAction(submitOverride.action) || selectedManualAgent?.centerAction || modeAction);
    const inferredAction = inferCenterActionFromPrompt(promptValue, selectedAction);
    const actionCandidate = overrideAction || inferredAction;
    const companionActionSelected = actionCandidate === "companion_chat";
    const usingResearchMode = isGuestRequest
      ? false
      : (
      companionActionSelected !== true
      && (
        submitOverride.researchMode === true
        || requestedModel === ALIBABA_QWEN_MAX_MODEL_ID
        || researchModeActive
        || selectedModel === ALIBABA_QWEN_MAX_MODEL_ID
        || composerQuickMode === "deep_research"
        || actionCandidate === "web_research"
      )
    );
    const requestModelId = isGuestRequest
      ? ALIBABA_QWEN_FLASH_MODEL_ID
      : (companionActionSelected
        ? ALIBABA_QWEN_CHARACTER_MODEL_ID
        : (usingResearchMode
          ? deepResearchPreferredModel
          : requestedModel));
    const resolvedContextLabel = s(submitOverride.contextLabel ?? props.contextLabel) || config.contextLabel;

    setPrompt("");
    setImages([]);
    setUploadedFiles([]);
    setOpenComposerMenu(null);
    setOpenHeaderModelMenu(false);

    const controller = new AbortController();
    requestAbortRef.current = controller;
    shouldAutoScrollRef.current = true;
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        scrollThreadToLatest("smooth");
      });
    }
    startReasoningContext({
      modelId: requestModelId || CAVAI_AUTO_MODEL_ID,
      level: requestedReasoningLevel,
      researchMode: usingResearchMode,
      contextLabel: resolvedContextLabel,
      surface: props.surface,
    });
    setSubmitting(true);
    setPendingPromptText(showPendingPrompt ? promptValue : "");
    setPendingImageGeneration(modeSuggestsImageTask || hasImageInputs);
    setError("");
    const requestStartedAtMs = Date.now();

    try {
      const resolvedAction = overrideAction
        || (usingResearchMode
          ? "web_research"
          : inferredAction);
      const overrideAgentRef = normalizeAgentRef({
        agentId: submitOverride.agentId,
        agentActionKey: submitOverride.agentActionKey,
      });
      const manualCustomAgentRef = selectedManualAgent?.source === "custom"
        ? normalizeAgentRef({
          agentId: selectedManualAgent.id,
          agentActionKey: selectedManualAgent.actionKey,
        })
        : null;
      const explicitAgentRef = overrideAgentRef || manualCustomAgentRef;
      const customAgentRef = isGuestRequest
        ? null
        : (explicitAgentRef || resolvePromptCustomAgentRef({
          prompt: promptValue,
          requestedAction: resolvedAction,
          installedAgentIds,
          customAgents: composerQuickMode === "agent_mode" ? [] : customAgents,
          publishedAgents: composerQuickMode === "agent_mode" ? [] : publishedAgents,
        }));
      const overrideResearchUrls = Array.isArray(submitOverride.researchUrls)
        ? submitOverride.researchUrls.map((row) => s(row)).filter(Boolean)
        : [];
      const researchUrls = overrideResearchUrls.length
        ? overrideResearchUrls.slice(0, 8)
        : (usingResearchMode ? extractUrlsFromText(promptValue, 8) : []);
      const sessionIdForRequest = s(submitOverride.sessionId) || s(sessionId) || undefined;
      const routeContextForRequest = buildCenterRouteContextPayload({
        surface: props.surface,
        contextLabel: resolvedContextLabel,
        workspaceId: s(props.workspaceId) || null,
        projectId: Number.isFinite(Number(props.projectId)) && Number(props.projectId) > 0
          ? Math.trunc(Number(props.projectId))
          : null,
        origin: s(props.origin) || null,
      });
      const launcherContext = (
        props.context && typeof props.context === "object" && !Array.isArray(props.context)
          ? props.context
          : {}
      );
      const contextForRequest = (
        submitOverride.context && typeof submitOverride.context === "object" && !Array.isArray(submitOverride.context)
          ? submitOverride.context
          : {}
      );
      const isImageAction = resolvedAction === "image_studio" || resolvedAction === "image_edit";
      if (isImageAction) {
        setPendingImageGeneration(true);
      }
      const imageStudioActivationLineUnchanged = (
        Boolean(selectedImagePresetActivationLine)
        && normalizeImageStudioActivationLine(promptValue) === normalizeImageStudioActivationLine(selectedImagePresetActivationLine)
      );
      const imageStudioContext =
        isImageAction
          ? {
              imageStudioPresetId: selectedImagePresetId || undefined,
              imageStudioActivationLine: selectedImagePresetActivationLine || undefined,
              imageStudioActivationLineUnchanged: imageStudioActivationLineUnchanged || undefined,
              imageStudioSourceAssetId:
                resolvedAction === "image_edit"
                  ? (imageStudioSourceAssetId || undefined)
                  : undefined,
            }
          : {};
      const assistEndpoint = isGuestRequest ? "/api/public/cavai/preview-assist" : "/api/ai/center/assist";
      const assistPayload = isGuestRequest
        ? {
            action: "technical_recap",
            surface: "general",
            prompt: promptValue,
            model: ALIBABA_QWEN_FLASH_MODEL_ID,
            reasoningLevel: "low",
            sessionId: sessionIdForRequest,
            contextLabel: "Guest preview",
            context: {
              ...routeContextForRequest,
              contextLabel: resolvedContextLabel,
              mode: "app_guest_preview",
              source: "app.cavai",
              transcript: buildGuestPreviewTranscript(messages, promptValue),
              ...launcherContext,
              ...contextForRequest,
            },
          }
        : {
            action: resolvedAction,
            agentId: customAgentRef?.agentId || undefined,
            agentActionKey: customAgentRef?.agentActionKey || undefined,
            surface: props.surface,
            prompt: promptValue,
            model: requestModelId === CAVAI_AUTO_MODEL_ID ? undefined : requestModelId,
            researchMode: usingResearchMode,
            researchUrls,
            reasoningLevel: requestedReasoningLevel,
            imageAttachments: imagesForRequest
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
            sessionId: sessionIdForRequest,
            workspaceId: s(props.workspaceId) || undefined,
            projectId:
              Number.isFinite(Number(props.projectId)) && Number(props.projectId) > 0
                ? Math.trunc(Number(props.projectId))
                : undefined,
            origin: s(props.origin) || undefined,
            contextLabel: resolvedContextLabel,
            context: {
              ...routeContextForRequest,
              contextLabel: resolvedContextLabel,
              researchMode: usingResearchMode,
              researchUrlsCount: researchUrls.length,
              uploadedWorkspaceFiles: uploadedFilesForRequest
                .filter((file) => !file.uploading && (s(file.path) || s(file.cavcloudFileId)))
                .map((file) => ({
                  id: file.id,
                  cavcloudFileId: s(file.cavcloudFileId) || undefined,
                  path: file.path,
                  name: file.name,
                  mimeType: file.mimeType,
                  sizeBytes: file.sizeBytes,
                  snippet: s(file.snippet) || undefined,
                })),
              ...imageStudioContext,
              ...launcherContext,
              ...contextForRequest,
            },
          };

      const res = await fetch(assistEndpoint, {
        method: "POST",
        credentials: isGuestRequest ? "omit" : "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        signal: controller.signal,
        body: JSON.stringify(assistPayload),
      });

      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        data?: CavAiCenterData;
        sessionId?: string;
        message?: string;
      }>;

      if (!res.ok || !body.ok || !body.data) {
        emitGuardDecisionFromPayload(body);
        const message = s((body as { message?: unknown }).message)
          || "CavAi hit a temporary issue before it could finish the reply. Please retry.";
        throw new Error(message);
      }

      const nextSessionId = s(body.sessionId);
      const answerText = s(body.data.answer).slice(0, 8_000) || null;
      const roundTripDurationMs = Math.max(1, Date.now() - requestStartedAtMs);
      const roundTripDurationLabel = formatReasoningDuration(roundTripDurationMs);
      if (isGuestRequest) {
        const effectiveSessionId = nextSessionId || s(sessionIdForRequest) || createGuestPreviewLocalSessionId();
        const createdAt = new Date().toISOString();
        const userMessage: CavAiMessage = {
          id: `${effectiveSessionId}::u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          action: resolvedAction,
          contentText: promptValue,
          contentJson: {
            prompt: promptValue,
            action: resolvedAction,
            model: ALIBABA_QWEN_FLASH_MODEL_ID,
            reasoningLevel: "low",
            contextLabel: resolvedContextLabel,
            context: {
              mode: "app_guest_preview",
            },
          },
          provider: null,
          model: ALIBABA_QWEN_FLASH_MODEL_ID,
          requestId: null,
          status: "done",
          errorCode: null,
          createdAt,
          feedback: toSafeFeedbackState(null),
        };
        const assistantMessage: CavAiMessage = {
          id: `${effectiveSessionId}::a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          action: resolvedAction,
          contentText: answerText || "",
          contentJson: {
            ...(body.data as unknown as Record<string, unknown>),
            __cavAiMeta: {
              durationMs: roundTripDurationMs,
              durationLabel: roundTripDurationLabel,
              showReasoningChip: true,
              reasoningLabel: `Reasoned in ${roundTripDurationLabel}`,
              model: ALIBABA_QWEN_FLASH_MODEL_ID,
              reasoningLevel: "low",
              safeSummary: {
                intent: promptValue.slice(0, 180),
                contextUsed: ["Guest preview"],
                checksPerformed: [],
                answerPath: ["guest_preview_assist"],
                uncertaintyNotes: [],
                doneState: "done",
              },
              quality: {
                relevanceToRequest: 100,
                relevanceToSurface: 100,
                productTruth: 100,
                actionability: 100,
                coherence: 100,
                scopeAlignment: 100,
                hallucinationRisk: 0,
                overall: 100,
                passed: true,
                reasons: [],
              },
            },
          },
          provider: null,
          model: ALIBABA_QWEN_FLASH_MODEL_ID,
          requestId: null,
          status: "done",
          errorCode: null,
          createdAt: new Date().toISOString(),
          feedback: toSafeFeedbackState(null),
        };

        const existingGuestMessages = sessionMessageCacheRef.current.get(effectiveSessionId) || [];
        const nextGuestMessages = [...existingGuestMessages, userMessage, assistantMessage];
        sessionMessageCacheRef.current.set(effectiveSessionId, nextGuestMessages);
        setMessages(nextGuestMessages);

        const previewText = answerText || promptValue;
        setSessions((prev) => {
          const existing = prev.find((row) => row.id === effectiveSessionId) || null;
          const title = normalizeSessionTitleForSidebar(
            s(existing?.title) || promptValue || "Preview chat"
          );
          const nextRow: CavAiSessionSummary = {
            id: effectiveSessionId,
            surface: "general",
            title,
            contextLabel: "Guest preview",
            workspaceId: null,
            projectId: null,
            origin: "guest_preview",
            updatedAt: createdAt,
            createdAt: existing?.createdAt || createdAt,
            lastMessageAt: createdAt,
            preview: toTitlePreview(previewText),
          };
          const without = prev.filter((row) => row.id !== effectiveSessionId);
          return [nextRow, ...without];
        });

        activeSessionIdRef.current = effectiveSessionId;
        setSessionId(effectiveSessionId);
        if (overlay) setHistoryOpen(false);
        return answerText;
      }
      if (nextSessionId) {
        activeSessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        if (deferUiRefresh) void loadMessages(nextSessionId);
        else await loadMessages(nextSessionId);
      }
      if (deferUiRefresh) void loadSessions();
      else await loadSessions();
      if (overlay) setHistoryOpen(false);
      if (resolvedAction === "image_studio" || resolvedAction === "image_edit") {
        void loadImageStudioHistoryView("recent");
        void loadImageStudioHistoryView("history");
      }
      return answerText;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("");
        return null;
      }
      setError(
        err instanceof Error
          ? err.message
          : "CavAi hit a temporary issue before it could finish the reply. Please retry."
      );
      return null;
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setPendingPromptText("");
      setPendingImageGeneration(false);
      setSubmitting(false);
      stopReasoningContext();
    }
  }, [
    composerQuickMode,
    customAgents,
    config.actions,
    config.contextLabel,
    deepResearchPreferredModel,
    images,
    uploadedFiles,
    imageStudioSourceAssetId,
    installedAgentIds,
    isGuestPreviewMode,
    loadMessages,
    loadImageStudioHistoryView,
    loadSessions,
    messages,
    overlay,
    prompt,
    props.contextLabel,
    props.context,
    props.origin,
    props.projectId,
    props.surface,
    props.workspaceId,
    publishedAgents,
    researchModeActive,
    reasoningLevel,
    selectedModel,
    selectedImagePresetActivationLine,
    selectedImagePresetId,
    selectedInstalledAgentOption,
    sessionId,
    scrollThreadToLatest,
    startReasoningContext,
    stopReasoningContext,
    submitting,
  ]);

  const onStop = useCallback(() => {
    const controller = requestAbortRef.current;
    if (!controller) return;
    requestAbortRef.current = null;
    controller.abort();
    setPendingPromptText("");
    setInlineEditPendingAnchorId("");
    setSubmitting(false);
    setError("");
    stopReasoningContext();
  }, [stopReasoningContext]);

  const onPrimaryAction = useCallback(() => {
    if (submitting) {
      onStop();
      return;
    }
    void onSubmit();
  }, [onStop, onSubmit, submitting]);

  const onPickRecentImage = useCallback((image: CavAiImageAttachment) => {
    if (!s(image.dataUrl)) return;
    setImageStudioSourceAssetId("");
    setImages((prev) => {
      if (prev.some((row) => s(row.dataUrl) === s(image.dataUrl))) return prev;
      if (prev.length + uploadedFiles.length >= maxImageAttachments) return prev;
      return [...prev, image];
    });
  }, [maxImageAttachments, uploadedFiles.length]);

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
    if (!activeComposerImageViewer || !showComposerViewerNavigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
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
    openComposerImageViewerNext,
    openComposerImageViewerPrev,
    showComposerViewerNavigation,
  ]);

  const removeComposerImage = useCallback((imageId: string) => {
    const normalized = s(imageId);
    if (!normalized) return;
    setImages((prev) => prev.filter((item) => item.id !== normalized));
    setComposerImageViewer((prev) => (prev && prev.imageId === normalized ? null : prev));
    if (s(imageStudioSourceAssetId) === normalized) {
      setImageStudioSourceAssetId("");
    }
  }, [imageStudioSourceAssetId]);

  const removeComposerUploadedFile = useCallback((fileId: string) => {
    const normalized = s(fileId);
    if (!normalized) return;
    setUploadedFiles((prev) => prev.filter((item) => item.id !== normalized));
  }, []);

  const openComposerUploadedFile = useCallback((item: CavAiUploadedFileAttachment) => {
    if (item.uploading) return;
    const targetPath = s(item.path);
    if (!targetPath) return;
    if (typeof window === "undefined") return;
    const qp = new URLSearchParams();
    qp.set("cavai", "1");
    qp.set("cloud", "1");
    qp.set("file", targetPath);
    window.open(`/cavcode?${qp.toString()}`, "_blank", "noopener,noreferrer");
  }, []);

  const onAttachmentModeToggle = useCallback((image: CavAiImageAttachment, targetMode: "create" | "edit") => {
    const imageId = s(image.id);
    if (!imageId) return;
    const selectedAttachment = {
      ...image,
      id: imageId,
      dataUrl: s(image.dataUrl) || TRANSPARENT_IMAGE_DATA_URL,
      name: s(image.name) || "image",
      mimeType: s(image.mimeType) || "image/png",
      sizeBytes: Math.max(1, Math.trunc(Number(image.sizeBytes) || 1)),
    } satisfies CavAiImageAttachment;

    if (targetMode === "edit") {
      if (!canUseEditImage) {
        setError("Image Edit requires Premium+.");
        return;
      }
      setImages((prev) => {
        const match = prev.find((row) => row.id === imageId);
        return [match || selectedAttachment];
      });
      setImageStudioSourceAssetId(s(selectedAttachment.assetId) || imageId);
      setComposerQuickMode("edit_image");
      setSelectedModel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
      setResearchMode(false);
      setOpenComposerMenu(null);
      setError("");
      return;
    }

    if (!canUseCreateImage) {
      setError("Image Studio requires Premium or Premium+.");
      return;
    }
    setImages((prev) => {
      const match = prev.find((row) => row.id === imageId);
      return [match || selectedAttachment];
    });
    setImageStudioSourceAssetId("");
    setSelectedImagePresetId("");
    setComposerQuickMode("create_image");
    setSelectedModel(ALIBABA_QWEN_IMAGE_MODEL_ID);
    setResearchMode(false);
    setOpenComposerMenu(null);
    setError("");
  }, [canUseCreateImage, canUseEditImage]);

  const onSelectImageStudioHistoryView = useCallback((view: "recent" | "saved" | "history") => {
    setImageStudioHistoryView(view);
    void loadImageStudioHistoryView(view);
  }, [loadImageStudioHistoryView]);

  const applyImageStudioAssetToComposer = useCallback((payload: {
    assetId?: string | null;
    dataUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes?: number;
  }) => {
    const assetId = s(payload.assetId);
    const attachment: CavAiImageAttachment = {
      id: assetId || crypto.randomUUID(),
      assetId: assetId || null,
      name: payload.fileName || "image",
      mimeType: payload.mimeType || "image/png",
      sizeBytes: Math.max(1, Math.trunc(Number(payload.sizeBytes) || 1)),
      dataUrl: payload.dataUrl,
    };
    setImageStudioSourceAssetId(assetId);
    setImages([attachment]);
    setRecentImageLibrary((prev) => mergeRecentImageLibrary(prev, [attachment]));
    setComposerQuickMode("edit_image");
    setSelectedModel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
  }, []);

  const importImageStudioFromSource = useCallback(async (source: "cavcloud" | "cavsafe", fileId: string) => {
    setImageStudioImportBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cavai/image-studio/import", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          source,
          fileId,
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
      const fileName = s(body.preview?.fileName) || s(body.asset?.fileName) || "imported-image.png";
      const mimeType = s(body.preview?.mimeType) || s(body.asset?.mimeType) || "image/png";
      const sizeBytes = Math.max(1, Math.trunc(Number(body.asset?.bytes) || 1));
      if (!assetId || !dataUrl) throw new Error("Imported image payload is incomplete.");
      applyImageStudioAssetToComposer({
        assetId,
        dataUrl,
        fileName,
        mimeType,
        sizeBytes,
      });
      setImageStudioImportModalOpen(false);
      void loadImageStudioHistoryView("recent");
      void loadImageStudioHistoryView("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image import failed.");
    } finally {
      setImageStudioImportBusy(false);
    }
  }, [applyImageStudioAssetToComposer, loadImageStudioHistoryView]);

  const onImageStudioDeviceImport = useCallback(async (file: File) => {
    setImageStudioImportBusy(true);
    setError("");
    let pendingUploadId = "";
    let localDataUrl = "";
    const localName = s(file.name) || "uploaded-image.png";
    const localMime = s(file.type) || "image/png";
    const localSizeBytes = Math.max(1, Math.trunc(Number(file.size) || 1));
    const applyLocalFallback = () => {
      if (!localDataUrl) return false;
      applyImageStudioAssetToComposer({
        dataUrl: localDataUrl,
        fileName: localName,
        mimeType: localMime,
        sizeBytes: localSizeBytes,
      });
      setError("");
      return true;
    };
    try {
      localDataUrl = await toDataUrl(file);
      pendingUploadId = `uploading_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
      const pendingAttachment: CavAiImageAttachment = {
        id: pendingUploadId,
        assetId: null,
        name: localName,
        mimeType: localMime,
        sizeBytes: localSizeBytes,
        dataUrl: localDataUrl,
        uploading: true,
      };
      setImageStudioSourceAssetId("");
      setImages([pendingAttachment]);
      setComposerQuickMode("edit_image");
      setSelectedModel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
      setImageStudioImportModalOpen(false);
      const res = await fetch("/api/cavai/image-studio/upload/device", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          fileName: s(file.name) || `image-${Date.now()}.png`,
          mimeType: localMime,
          bytes: localSizeBytes,
          dataUrl: localDataUrl,
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
        if (applyLocalFallback()) return;
        throw new Error(s(body.message) || "Device image upload failed.");
      }
      const assetId = s(body.assetId) || s(body.asset?.id);
      const previewDataUrl = s(body.preview?.dataUrl) || s(body.asset?.dataUrl) || localDataUrl;
      const previewName = s(body.preview?.fileName) || s(body.asset?.fileName) || localName;
      const previewMime = s(body.preview?.mimeType) || s(body.asset?.mimeType) || localMime;
      const sizeBytes = Math.max(1, Math.trunc(Number(body.asset?.bytes) || localSizeBytes || 1));
      if (!assetId || !previewDataUrl) {
        if (applyLocalFallback()) return;
        throw new Error("Uploaded image payload is incomplete.");
      }
      applyImageStudioAssetToComposer({
        assetId,
        dataUrl: previewDataUrl,
        fileName: previewName,
        mimeType: previewMime,
        sizeBytes,
      });
      void loadImageStudioHistoryView("recent");
      void loadImageStudioHistoryView("history");
    } catch (err) {
      if (applyLocalFallback()) return;
      if (pendingUploadId) {
        setImages((prev) => prev.filter((row) => row.id !== pendingUploadId));
      }
      setError(err instanceof Error ? err.message : "Device image upload failed.");
    } finally {
      setImageStudioImportBusy(false);
    }
  }, [applyImageStudioAssetToComposer, loadImageStudioHistoryView]);

  const attachFromCavCloud = useCallback(async (file: CavCloudAttachFileItem) => {
    if (!file) return;
    if (images.length + uploadedFiles.length >= maxImageAttachments) {
      setError(`Upload limit reached for this plan. Max ${maxImageAttachments} files per prompt.`);
      return;
    }
    setCavCloudAttachBusy(true);
    setError("");
    try {
      if (s(file.mimeType).toLowerCase().startsWith("image/")) {
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
          mimeType: s(body.preview?.mimeType) || s(body.asset?.mimeType) || s(file.mimeType) || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(body.asset?.bytes) || Number(file.bytes) || 1)),
          dataUrl,
          uploading: false,
        };
        setImages((prev) => {
          if (prev.some((row) => s(row.assetId) === assetId || s(row.id) === assetId)) return prev;
          return [...prev, nextImage].slice(0, maxImageAttachments);
        });
        setRecentImageLibrary((prev) => mergeRecentImageLibrary(prev, [nextImage]));
      } else {
        const cavcloudFileId = s(file.id);
        const nextFile: CavAiUploadedFileAttachment = {
          id: cavcloudFileId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
          cavcloudFileId: cavcloudFileId || null,
          path: s(file.path),
          name: s(file.name) || "file",
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
      setError(err instanceof Error ? err.message : "Failed to attach file.");
    } finally {
      setCavCloudAttachBusy(false);
    }
  }, [images.length, maxImageAttachments, uploadedFiles.length]);

  const openImageStudioImportModal = useCallback((source: "device" | "cavcloud" | "cavsafe") => {
    setImageStudioImportSource(source);
    setImageStudioImportModalOpen(true);
    if (source === "cavcloud") {
      void loadImageStudioSourceGallery("cavcloud");
    } else if (source === "cavsafe") {
      void loadImageStudioSourceGallery("cavsafe");
    }
  }, [loadImageStudioSourceGallery]);

  const openImageStudioSaveModal = useCallback((assetId: string) => {
    const normalized = s(assetId);
    if (!normalized) return;
    setImageStudioSaveAssetId(normalized);
    setImageStudioSaveModalOpen(true);
  }, []);

  const saveImageStudioAsset = useCallback(async (target: "cavcloud" | "cavsafe" | "device") => {
    const assetId = s(imageStudioSaveAssetId);
    if (!assetId) return;
    setImageStudioSaveBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cavai/image-studio/save", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          assetId,
          target,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        download?: {
          dataUrl?: unknown;
          fileName?: unknown;
          mimeType?: unknown;
        };
      };
      if (!res.ok || body.ok !== true) {
        throw new Error(s(body.message) || "Save failed.");
      }
      if (target === "device" && typeof window !== "undefined") {
        const dataUrl = s(body.download?.dataUrl);
        if (dataUrl) {
          const anchor = document.createElement("a");
          anchor.href = dataUrl;
          anchor.download = s(body.download?.fileName) || `cavbot-image-${Date.now()}.png`;
          anchor.rel = "noreferrer";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        }
      }
      setImageStudioSaveModalOpen(false);
      void loadImageStudioHistoryView("recent");
      void loadImageStudioHistoryView("saved");
      void loadImageStudioHistoryView("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setImageStudioSaveBusy(false);
    }
  }, [imageStudioSaveAssetId, loadImageStudioHistoryView]);

  const applyQuickAction = useCallback((actionId: ComposerQuickActionId) => {
    if (isGuestPreviewMode) {
      setOpenComposerMenu(null);
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      return;
    }
    if (actionId === "add_files") {
      setComposerQuickMode((prev) => (prev === "agent_mode" ? prev : null));
      setOpenComposerMenu(null);
      imageInputRef.current?.click();
      return;
    }
    if (actionId === "upload_from_cavcloud") {
      setOpenComposerMenu(null);
      setCavCloudAttachModalOpen(true);
      void loadCavCloudAttachItems();
      return;
    }
    if (actionId === "recent_files") {
      setOpenComposerMenu(null);
      const recentPick = recentImageLibrary.find(
        (image) => !images.some((row) => s(row.dataUrl) === s(image.dataUrl))
      ) || recentImageLibrary[0];
      if (!recentPick) {
        setError(RECENT_FILES_EMPTY_HINT);
        return;
      }
      onPickRecentImage(recentPick);
      return;
    }
    if (actionId === "create_image") {
      if (!canUseCreateImage) return;
      if (overlay && typeof window !== "undefined") {
        const baseCenterHref = s(expandHref) || buildCavAiSurfaceUrl({
          surface: props.surface,
          contextLabel: props.contextLabel,
          workspaceId: props.workspaceId,
          projectId: props.projectId,
          origin: props.origin,
        });
        const redirectHref = withQuickActionInCavAiHref(baseCenterHref, "create_image");
        if (redirectHref) {
          setOpenComposerMenu(null);
          const popup = window.open(redirectHref, "_blank", "noopener,noreferrer");
          if (!popup) {
            window.location.assign(redirectHref);
          }
          return;
        }
      }
      setImageStudioSourceAssetId("");
      setComposerQuickMode("create_image");
      setResearchMode(false);
      setSelectedModel(ALIBABA_QWEN_IMAGE_MODEL_ID);
      setOpenComposerMenu(null);
      return;
    }
    if (actionId === "edit_image") {
      if (!canUseEditImage) return;
      if (overlay && typeof window !== "undefined") {
        const baseCenterHref = s(expandHref) || buildCavAiSurfaceUrl({
          surface: props.surface,
          contextLabel: props.contextLabel,
          workspaceId: props.workspaceId,
          projectId: props.projectId,
          origin: props.origin,
        });
        const redirectHref = withQuickActionInCavAiHref(baseCenterHref, "edit_image");
        if (redirectHref) {
          setOpenComposerMenu(null);
          const popup = window.open(redirectHref, "_blank", "noopener,noreferrer");
          if (!popup) {
            window.location.assign(redirectHref);
          }
          return;
        }
      }
      setOpenComposerMenu(null);
      openImageStudioImportModal("device");
      return;
    }
    if (actionId === "deep_research") {
      if (!canUseDeepResearch) return;
      setComposerQuickMode("deep_research");
      setResearchMode(true);
      setSelectedModel(deepResearchPreferredModel);
      setOpenComposerMenu(null);
      return;
    }
  }, [
    canUseCreateImage,
    canUseDeepResearch,
    canUseEditImage,
    deepResearchPreferredModel,
    images,
    onPickRecentImage,
    openImageStudioImportModal,
    loadCavCloudAttachItems,
    recentImageLibrary,
    expandHref,
    isGuestPreviewMode,
    overlay,
    props.contextLabel,
    props.origin,
    props.projectId,
    props.surface,
    props.workspaceId,
  ]);

  const scrollImageStudioPresetRail = useCallback((direction: "left" | "right") => {
    const rail = imageStudioPresetRailRef.current;
    if (!rail) return;
    const offset = direction === "left" ? -320 : 320;
    rail.scrollBy({ left: offset, behavior: "smooth" });
  }, []);

  const applyImageStudioPreset = useCallback((preset: ImageStudioPreset) => {
    if (preset.locked) {
      setError("This preset is locked for your plan tier.");
      return;
    }
    const shouldUseEditTemplate = imageAttachmentsPresent && canUseEditImage;
    if (selectedImagePresetId === preset.id) {
      setSelectedImagePresetId("");
      setPrompt((prev) => stripLeadingImageStudioActivationLine(prev));
      setError("");
      return;
    }
    setSelectedImagePresetId(preset.id);
    setComposerQuickMode(shouldUseEditTemplate ? "edit_image" : "create_image");
    setSelectedModel(shouldUseEditTemplate ? ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID : ALIBABA_QWEN_IMAGE_MODEL_ID);
    if (!shouldUseEditTemplate) {
      setImageStudioSourceAssetId("");
    }
    syncPresetActivationLine({
      preset,
      mode: shouldUseEditTemplate ? "edit" : "create",
      force: true,
    });
    setError("");
  }, [canUseEditImage, imageAttachmentsPresent, selectedImagePresetId, syncPresetActivationLine]);

  const clearSelectedImageStudioPreset = useCallback(() => {
    const preset = selectedImagePreset;
    setSelectedImagePresetId("");
    if (preset) {
      setPrompt((prev) => stripLeadingImageStudioActivationLine(prev));
    }
    setError("");
  }, [selectedImagePreset]);

  const onImageStudioQuickAction = useCallback((action: "create" | "edit" | "upload" | "recent" | "saved" | "history") => {
    if (action === "create") {
      if (!canUseCreateImage) {
        setError("Image Studio requires Premium or Premium+.");
        return;
      }
      setImageStudioSourceAssetId("");
      setComposerQuickMode("create_image");
      setSelectedModel(ALIBABA_QWEN_IMAGE_MODEL_ID);
      return;
    }
    if (action === "edit") {
      if (!canUseEditImage) {
        setError("Image Edit requires Premium+.");
        return;
      }
      openImageStudioImportModal("device");
      return;
    }
    if (action === "upload") {
      openImageStudioImportModal("device");
      return;
    }
    if (action === "recent") {
      onSelectImageStudioHistoryView("recent");
      return;
    }
    if (action === "saved") {
      onSelectImageStudioHistoryView("saved");
      return;
    }
    onSelectImageStudioHistoryView("history");
  }, [canUseCreateImage, canUseEditImage, onSelectImageStudioHistoryView, openImageStudioImportModal]);

  const onImageStudioHistoryReusePrompt = useCallback((row: ImageStudioHistoryRow) => {
    const nextPrompt = s(row.sourcePrompt) || s(row.promptSummary);
    if (!nextPrompt) return;
    setPrompt(nextPrompt);
    setComposerQuickMode(row.mode === "edit" ? "edit_image" : "create_image");
  }, []);

  const onImageStudioHistoryEdit = useCallback(async (row: ImageStudioHistoryRow) => {
    if (!canUseEditImage) {
      setError("Image Edit requires Premium+.");
      return;
    }
    if (!row.assetId) {
      openImageStudioImportModal("device");
      return;
    }
    try {
      const res = await fetch(`/api/cavai/image-studio/assets/${encodeURIComponent(row.assetId)}?data=1`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        data?: {
          dataUrl?: unknown;
          fileName?: unknown;
          mimeType?: unknown;
        };
        asset?: Record<string, unknown>;
      };
      if (!res.ok || body.ok !== true) {
        throw new Error(s(body.message) || "Failed to open image for editing.");
      }
      const dataUrl = s(body.data?.dataUrl);
      if (!dataUrl) throw new Error("Selected image is missing preview data.");
      applyImageStudioAssetToComposer({
        assetId: row.assetId,
        dataUrl,
        fileName: s(body.data?.fileName) || s(body.asset?.fileName) || row.fileName || "image.png",
        mimeType: s(body.data?.mimeType) || s(body.asset?.mimeType) || row.mimeType || "image/png",
        sizeBytes: Math.max(1, Math.trunc(Number(body.asset?.bytes) || 1)),
      });
      setComposerQuickMode("edit_image");
      setSelectedModel(ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open image for editing.");
    }
  }, [applyImageStudioAssetToComposer, canUseEditImage, openImageStudioImportModal]);

  const clearActiveToolbarQuickMode = useCallback(() => {
    if (activeToolbarQuickMode === "companion" && selectedModel === ALIBABA_QWEN_CHARACTER_MODEL_ID) {
      setSelectedModel(CAVAI_AUTO_MODEL_ID);
    }
    if (composerQuickMode === "create_image" && selectedModel === ALIBABA_QWEN_IMAGE_MODEL_ID) {
      setImageStudioSourceAssetId("");
      setSelectedModel(CAVAI_AUTO_MODEL_ID);
    }
    if (composerQuickMode === "edit_image" && selectedModel === ALIBABA_QWEN_IMAGE_EDIT_MODEL_ID) {
      setImageStudioSourceAssetId("");
      setSelectedModel(CAVAI_AUTO_MODEL_ID);
    }
    if (composerQuickMode === "deep_research") {
      setResearchMode(false);
      if (
        selectedModel === ALIBABA_QWEN_MAX_MODEL_ID
        || selectedModel === ALIBABA_QWEN_PLUS_MODEL_ID
      ) {
        setSelectedModel(CAVAI_AUTO_MODEL_ID);
      }
    }
    setComposerQuickMode((prev) => (prev === "create_image" || prev === "edit_image" || prev === "deep_research" ? null : prev));
  }, [activeToolbarQuickMode, composerQuickMode, selectedModel]);

  const toggleAgentModeMenu = useCallback(() => {
    setOpenHeaderModelMenu(false);
    setOpenComposerMenu((prev) => (prev === "agent_mode" ? null : "agent_mode"));
    setAgentModeQuery("");
  }, []);

  const clearAgentModeSelection = useCallback(() => {
    setOpenComposerMenu(null);
    setManualAgentRef(null);
    setComposerQuickMode((prev) => (prev === "agent_mode" ? null : prev));
  }, []);

  const selectAgentModeOption = useCallback((agent: CenterRuntimeAgentOption) => {
    if (isGuestPreviewMode) {
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      setOpenComposerMenu(null);
      return;
    }
    setManualAgentRef({
      agentId: agent.id,
      agentActionKey: agent.actionKey,
    });
    setComposerQuickMode("agent_mode");
    setOpenComposerMenu(null);
  }, [isGuestPreviewMode]);

  const toggleAgentInstalled = useCallback(async (agentId: string, install: boolean) => {
    if (isGuestPreviewMode) {
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      return;
    }
    if (savingAgentId) return;
    const target = centerAgentBankCatalog.find((agent) => agent.id === agentId);
    if (!target) return;
    if (install && target.locked) return;

    const nextSet = new Set(installedAgentIds);
    if (install) nextSet.add(agentId);
    else nextSet.delete(agentId);

    const customIdSet = new Set(customAgents.map((agent) => agent.id));
    const publishedIdSet = new Set(publishedAgents.map((agent) => agent.id));
    const orderedKnown = knownBuiltInAgentIds.filter((id) => nextSet.has(id));
    const orderedCustom = customAgents.map((agent) => agent.id).filter((id) => nextSet.has(id));
    const orderedPublished = publishedAgents.map((agent) => agent.id).filter((id) => nextSet.has(id));
    const orderedUnknown = installedAgentIds.filter(
      (id) => id !== "dictate" && !knownBuiltInAgentIdSet.has(id) && !customIdSet.has(id) && !publishedIdSet.has(id) && nextSet.has(id)
    );
    const nextIds = [...orderedKnown, ...orderedCustom, ...orderedPublished, ...orderedUnknown];
    const prevIds = [...installedAgentIds];

    setInstalledAgentIds(nextIds);
    setSavingAgentId(agentId);

    try {
      const res = await fetch("/api/cavai/settings", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          installedAgentIds: nextIds,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: unknown;
        agentRegistry?: unknown;
        publishedAgents?: unknown;
        planId?: unknown;
        message?: unknown;
      };
      if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
        throw new Error(s(body.message) || "Failed to update Agent Mode settings.");
      }
      const effectivePlanId = normalizePlanId(body.planId);
      setAccountPlanId(effectivePlanId);
      publishClientPlan({
        planId: effectivePlanId,
        preserveStrongerCached: true,
      });
      const snapshot = normalizeAgentRegistrySnapshot(body.agentRegistry);
      setAgentRegistrySnapshot(snapshot);
      agentRegistrySnapshotRef.current = snapshot;
      const row = body.settings as Record<string, unknown>;
      const nextKnownBuiltInIds = flattenBuiltInRegistryCards(snapshot).map((card) => card.id);
      const nextKnownBuiltInIdSet = new Set(nextKnownBuiltInIds);
      const nextCustomAgents = normalizeRuntimeCustomAgents(row.customAgents, nextKnownBuiltInIdSet);
      const nextPublishedAgents = normalizePublishedOperatorAgents(body.publishedAgents, nextKnownBuiltInIdSet);
      const nextCustomIdSet = new Set(nextCustomAgents.map((agent) => agent.id));
      const nextPublishedIdSet = new Set(nextPublishedAgents.map((agent) => agent.id));
      const installedRaw = normalizeInstalledAgentIdsFromSettings(row.installedAgentIds);
      const installedRawSet = new Set(installedRaw);
      const orderedBuiltIns = nextKnownBuiltInIds.filter((id) => installedRawSet.has(id));
      const orderedCustomAgents = nextCustomAgents.map((agent) => agent.id).filter((id) => installedRawSet.has(id));
      const orderedPublishedAgents = nextPublishedAgents.map((agent) => agent.id).filter((id) => installedRawSet.has(id));
      const orderedLegacy = installedRaw.filter(
        (id) => !nextKnownBuiltInIdSet.has(id) && !nextCustomIdSet.has(id) && !nextPublishedIdSet.has(id)
      );
      setInstalledAgentIds([...orderedBuiltIns, ...orderedCustomAgents, ...orderedPublishedAgents, ...orderedLegacy]);
      setCustomAgents(nextCustomAgents);
      setPublishedAgents(nextPublishedAgents);
      setError("");
    } catch (err) {
      setInstalledAgentIds(prevIds);
      setError(err instanceof Error ? err.message : "Failed to update Agent Mode settings.");
    } finally {
      setSavingAgentId("");
    }
  }, [
    centerAgentBankCatalog,
    customAgents,
    installedAgentIds,
    knownBuiltInAgentIds,
    knownBuiltInAgentIdSet,
    isGuestPreviewMode,
    publishedAgents,
    savingAgentId,
  ]);

  const persistCustomAgentRegistry = useCallback(async (args: {
    nextCustomAgents: CavenRuntimeCustomAgent[];
    nextInstalledIds: string[];
    onRollback: () => void;
    successErrorClear?: boolean;
  }) => {
    try {
      const res = await fetch("/api/cavai/settings", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          customAgents: args.nextCustomAgents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            summary: agent.summary,
            actionKey: agent.actionKey,
            surface: agent.surface,
            triggers: agent.triggers,
            instructions: agent.instructions,
            iconSvg: agent.iconSvg,
            iconBackground: agent.iconBackground,
            createdAt: agent.createdAt,
            publicationRequested: agent.publicationRequested,
            publicationRequestedAt: agent.publicationRequestedAt,
          })),
          installedAgentIds: args.nextInstalledIds,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        settings?: unknown;
        agentRegistry?: unknown;
        publishedAgents?: unknown;
        planId?: unknown;
        message?: unknown;
      };
      if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
        throw new Error(s(body.message) || "Failed to update custom agents.");
      }
      const effectivePlanId = normalizePlanId(body.planId);
      setAccountPlanId(effectivePlanId);
      publishClientPlan({
        planId: effectivePlanId,
        preserveStrongerCached: true,
      });
      const snapshot = normalizeAgentRegistrySnapshot(body.agentRegistry);
      setAgentRegistrySnapshot(snapshot);
      agentRegistrySnapshotRef.current = snapshot;
      const row = body.settings as Record<string, unknown>;
      const nextKnownBuiltInIds = flattenBuiltInRegistryCards(snapshot).map((card) => card.id);
      const nextKnownBuiltInIdSet = new Set(nextKnownBuiltInIds);
      const nextCustomAgents = normalizeRuntimeCustomAgents(row.customAgents, nextKnownBuiltInIdSet);
      const nextPublishedAgents = normalizePublishedOperatorAgents(body.publishedAgents, nextKnownBuiltInIdSet);
      const nextCustomIdSet = new Set(nextCustomAgents.map((agent) => agent.id));
      const nextPublishedIdSet = new Set(nextPublishedAgents.map((agent) => agent.id));
      const installedRaw = normalizeInstalledAgentIdsFromSettings(row.installedAgentIds);
      const installedRawSet = new Set(installedRaw);
      const orderedBuiltIns = nextKnownBuiltInIds.filter((id) => installedRawSet.has(id));
      const orderedCustomAgents = nextCustomAgents.map((agent) => agent.id).filter((id) => installedRawSet.has(id));
      const orderedPublishedAgents = nextPublishedAgents.map((agent) => agent.id).filter((id) => installedRawSet.has(id));
      const orderedLegacy = installedRaw.filter(
        (id) => !nextKnownBuiltInIdSet.has(id) && !nextCustomIdSet.has(id) && !nextPublishedIdSet.has(id)
      );
      setInstalledAgentIds([...orderedBuiltIns, ...orderedCustomAgents, ...orderedPublishedAgents, ...orderedLegacy]);
      setCustomAgents(nextCustomAgents);
      setPublishedAgents(nextPublishedAgents);
      if (args.successErrorClear) setError("");
    } catch (err) {
      args.onRollback();
      setError(err instanceof Error ? err.message : "Failed to update custom agents.");
    }
  }, []);

  const uninstallAgentFromMenu = useCallback((agentId: string) => {
    setAgentModeManageAgentId("");
    void toggleAgentInstalled(agentId, false);
  }, [toggleAgentInstalled]);

  const moveCustomAgentSurface = useCallback((agentId: string, surface: "cavcode" | "center" | "all") => {
    const previousCustomAgents = [...customAgents];
    const previousInstalledIds = [...installedAgentIds];
    const nextCustomAgents = customAgents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            surface,
          }
        : agent
    );
    setCustomAgents(nextCustomAgents);
    setAgentModeManageAgentId("");
    void persistCustomAgentRegistry({
      nextCustomAgents,
      nextInstalledIds: previousInstalledIds,
      onRollback: () => {
        setCustomAgents(previousCustomAgents);
        setInstalledAgentIds(previousInstalledIds);
      },
      successErrorClear: true,
    });
  }, [customAgents, installedAgentIds, persistCustomAgentRegistry]);

  const deleteCustomAgent = useCallback((agentId: string) => {
    const previousCustomAgents = [...customAgents];
    const previousInstalledIds = [...installedAgentIds];
    const nextCustomAgents = customAgents.filter((agent) => agent.id !== agentId);
    const nextInstalledIds = installedAgentIds.filter((id) => id !== agentId);
    setCustomAgents(nextCustomAgents);
    setInstalledAgentIds(nextInstalledIds);
    setAgentModeManageAgentId("");
    setComposerQuickMode((prev) => (manualAgentRef?.agentId === agentId && prev === "agent_mode" ? null : prev));
    if (manualAgentRef?.agentId === agentId) setManualAgentRef(null);
    void persistCustomAgentRegistry({
      nextCustomAgents,
      nextInstalledIds,
      onRollback: () => {
        setCustomAgents(previousCustomAgents);
        setInstalledAgentIds(previousInstalledIds);
      },
      successErrorClear: true,
    });
  }, [customAgents, installedAgentIds, manualAgentRef, persistCustomAgentRegistry]);

  const onComposerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      onPrimaryAction();
    },
    [onPrimaryAction]
  );

  const transcribeAudioFile = useCallback(async (file: File, forcedModelId?: string): Promise<string | null> => {
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
    if (s(props.workspaceId)) form.set("workspaceId", s(props.workspaceId));
    if (Number.isFinite(Number(props.projectId)) && Number(props.projectId) > 0) {
      form.set("projectId", String(Math.trunc(Number(props.projectId))));
    }
    form.set("origin", s(props.origin) || `cavai-center-${props.surface}`);

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
        const error = new Error(s((body as { message?: unknown }).message) || "Audio transcription failed.") as Error & {
          status?: number;
          code?: string;
        };
        error.status = Number(res.status || 0);
        error.code = s((body as { error?: unknown }).error);
        throw error;
      }
      return s(body.data?.text);
    } finally {
      setTranscribingAudio(false);
    }
  }, [props.origin, props.projectId, props.surface, props.workspaceId, selectedAudioModel]);

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
    setVoiceOrbStream(null);
    voiceChunksRef.current = [];
  }, []);

  const clearTtsPlayback = useCallback(() => {
    ttsBlockedRetryPayloadRef.current = null;
    const audio = ttsAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      ttsAudioRef.current = null;
    }
    const url = s(ttsAudioUrlRef.current);
    if (url) {
      URL.revokeObjectURL(url);
      ttsAudioUrlRef.current = "";
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    ttsPlaybackSessionRef.current += 1;
    clearTtsPlayback();
    setSpeakingMessageId("");
    setVoiceOrbState("idle");
  }, [clearTtsPlayback]);

  const cacheTtsBlob = useCallback((cacheKeyRaw: string, blob: Blob) => {
    const cacheKey = s(cacheKeyRaw);
    if (!cacheKey || !blob.size) return;
    const cache = ttsBlobCacheRef.current;
    if (cache.has(cacheKey)) cache.delete(cacheKey);
    cache.set(cacheKey, blob);
    while (cache.size > MAX_TTS_BLOB_CACHE_ITEMS) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }, []);

  const cacheTtsLeadTrimOffset = useCallback((cacheKeyRaw: string, offsetRaw: number) => {
    const cacheKey = s(cacheKeyRaw);
    const offset = Number(offsetRaw);
    if (!cacheKey || !Number.isFinite(offset) || offset < 0) return;
    const cache = ttsLeadTrimCacheRef.current;
    if (cache.has(cacheKey)) cache.delete(cacheKey);
    cache.set(cacheKey, offset);
    while (cache.size > MAX_TTS_BLOB_CACHE_ITEMS) {
      const oldestKey = cache.keys().next().value;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }, []);

  const resolveSpeechLeadTrimOffsetSec = useCallback(async (blob: Blob, cacheKeyRaw: string): Promise<number> => {
    const fallbackOffset = CAVBOT_TTS_PLAYBACK_START_OFFSET_SEC;
    const cacheKey = s(cacheKeyRaw);
    if (!blob.size) return fallbackOffset;

    if (cacheKey) {
      const cached = ttsLeadTrimCacheRef.current.get(cacheKey);
      if (typeof cached === "number" && Number.isFinite(cached)) {
        return Math.max(0, Math.min(fallbackOffset, cached));
      }

      const inFlight = ttsLeadTrimRequestRef.current.get(cacheKey);
      if (inFlight) return inFlight;
    }

    const analyzePromise = (async () => {
      const detected = await analyzeSpeechLeadTrimOffsetSec(blob);
      if (detected === null || !Number.isFinite(detected)) return fallbackOffset;
      return Math.max(0, Math.min(fallbackOffset, detected));
    })();

    if (!cacheKey) return analyzePromise;
    ttsLeadTrimRequestRef.current.set(cacheKey, analyzePromise);
    try {
      const offset = await analyzePromise;
      cacheTtsLeadTrimOffset(cacheKey, offset);
      return offset;
    } finally {
      const active = ttsLeadTrimRequestRef.current.get(cacheKey);
      if (active === analyzePromise) {
        ttsLeadTrimRequestRef.current.delete(cacheKey);
      }
    }
  }, [cacheTtsLeadTrimOffset]);

  const requestSpeechBlob = useCallback(async (textRaw: string, cacheKeyRaw: string): Promise<Blob> => {
    const text = normalizeSpeechTextForTts(textRaw);
    if (!text) throw new Error("Speech text is empty.");
    const cacheKey = s(cacheKeyRaw) || resolveSpeechCacheKey("", text);

    const cacheHit = ttsBlobCacheRef.current.get(cacheKey);
    if (cacheHit) return cacheHit;

    const inFlight = ttsBlobRequestRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const requestPromise = (async () => {
      const requestTts = async (payload: Record<string, unknown>) => {
        const response = await fetch("/api/ai/tts", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify(payload),
        });
        return response;
      };

      const readTtsFailure = async (response: Response): Promise<{ message: string; code: string }> => {
        const body = (await response.json().catch(() => ({}))) as ApiEnvelope<{ message?: string; error?: string }>;
        emitGuardDecisionFromPayload(body);
        return {
          message: s((body as { message?: unknown }).message),
          code: s((body as { error?: unknown }).error).toUpperCase(),
        };
      };

      const baseBody = {
        text,
        model: ALIBABA_QWEN_TTS_REALTIME_MODEL_ID,
        voice: CAVBOT_TTS_VOICE_ID,
        workspaceId: props.workspaceId || undefined,
        projectId: props.projectId || undefined,
        origin: props.origin || undefined,
      };

      const primaryBody = {
        ...baseBody,
        instructions: CAVBOT_TTS_INSTRUCTIONS,
        format: CAVBOT_TTS_AUDIO_FORMAT,
      };

      let res = await requestTts(primaryBody);
      if (!res.ok) {
        const primaryFailure = await readTtsFailure(res);
        const shouldSkipRetry =
          res.status === 401
          || res.status === 403
          || primaryFailure.code === "BAD_CSRF"
          || primaryFailure.code === "UNAUTHORIZED";

        if (!shouldSkipRetry) {
          const fallbackResponse = await requestTts(baseBody);
          if (fallbackResponse.ok) {
            res = fallbackResponse;
          } else {
            const fallbackFailure = await readTtsFailure(fallbackResponse);
            const failureCode = fallbackFailure.code || primaryFailure.code;
            const failureMessage = fallbackFailure.message || primaryFailure.message;
            if (failureMessage) throw new Error(failureMessage);
            if (failureCode) throw new Error(`Speech request failed (${failureCode}).`);
            throw new Error("Failed to generate speech.");
          }
        } else {
          if (primaryFailure.message) throw new Error(primaryFailure.message);
          if (primaryFailure.code) throw new Error(`Speech request failed (${primaryFailure.code}).`);
          throw new Error("Failed to generate speech.");
        }
      }

      const blob = await res.blob();
      if (!blob.size) throw new Error("Speech response was empty.");
      cacheTtsBlob(cacheKey, blob);
      void resolveSpeechLeadTrimOffsetSec(blob, cacheKey).catch(() => {});
      return blob;
    })();

    ttsBlobRequestRef.current.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      const active = ttsBlobRequestRef.current.get(cacheKey);
      if (active === requestPromise) {
        ttsBlobRequestRef.current.delete(cacheKey);
      }
    }
  }, [cacheTtsBlob, props.origin, props.projectId, props.workspaceId, resolveSpeechLeadTrimOffsetSec]);

  const prefetchSpeechForMessage = useCallback((contentTextRaw: string, messageIdRaw: string) => {
    const messageId = s(messageIdRaw);
    const text = normalizeSpeechTextForTts(contentTextRaw);
    if (!messageId || !text) return;
    const chunks = splitSpeechTextIntoChunks(text);
    const firstChunk = chunks[0];
    if (!firstChunk) return;

    const prefetched = prefetchedAssistantSpeechIdsRef.current;
    if (prefetched.has(messageId)) return;
    prefetched.add(messageId);
    while (prefetched.size > MAX_TTS_BLOB_CACHE_ITEMS * 6) {
      const oldestMessageId = prefetched.values().next().value;
      if (!oldestMessageId) break;
      prefetched.delete(oldestMessageId);
    }

    const cacheKey = resolveSpeechCacheKey(`${messageId}:chunk:0`, firstChunk);
    void requestSpeechBlob(firstChunk, cacheKey).catch(() => {
      prefetchedAssistantSpeechIdsRef.current.delete(messageId);
    });
    for (let chunkIndex = 1; chunkIndex < Math.min(chunks.length, CAVBOT_TTS_PREFETCH_CHUNK_WINDOW); chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      if (!chunk) continue;
      const chunkCacheKey = resolveSpeechCacheKey(`${messageId}:chunk:${chunkIndex}`, chunk);
      void requestSpeechBlob(chunk, chunkCacheKey).catch(() => {});
    }
  }, [requestSpeechBlob]);

  const playSpeechFromText = useCallback(
    async (textRaw: string, speakingKey: string): Promise<boolean> => {
      const text = normalizeSpeechTextForTts(textRaw);
      if (!text) return false;

      if (s(speakingMessageId) === speakingKey) {
        stopSpeaking();
        return true;
      }

      const playbackSession = ttsPlaybackSessionRef.current + 1;
      ttsPlaybackSessionRef.current = playbackSession;
      clearTtsPlayback();
      setSpeakingMessageId(speakingKey);
      try {
        const chunks = splitSpeechTextIntoChunks(text);
        if (!chunks.length) return false;
        const chunkBlobPromises = new Map<number, Promise<Blob>>();
        const ensureChunkBlob = (index: number): Promise<Blob> => {
          const cachedPromise = chunkBlobPromises.get(index);
          if (cachedPromise) return cachedPromise;
          const chunk = chunks[index];
          if (!chunk) return Promise.reject(new Error("Speech chunk is empty."));
          const cacheKey = resolveSpeechCacheKey(`${speakingKey}:chunk:${index}`, chunk);
          const promise = requestSpeechBlob(chunk, cacheKey);
          chunkBlobPromises.set(index, promise);
          return promise;
        };
        const prefetchAhead = (fromIndex: number) => {
          for (let index = fromIndex; index < Math.min(chunks.length, fromIndex + CAVBOT_TTS_PREFETCH_CHUNK_WINDOW); index += 1) {
            void ensureChunkBlob(index).catch(() => {});
          }
        };
        prefetchAhead(0);

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          if (ttsPlaybackSessionRef.current !== playbackSession) return false;
          const chunk = chunks[chunkIndex];
          if (!chunk) continue;

          const cacheKey = resolveSpeechCacheKey(`${speakingKey}:chunk:${chunkIndex}`, chunk);
          const blob = await ensureChunkBlob(chunkIndex);
          if (ttsPlaybackSessionRef.current !== playbackSession) return false;
          prefetchAhead(chunkIndex + 1);

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.preload = "auto";
          audio.volume = CAVBOT_TTS_PLAYBACK_TARGET_VOLUME;
          const maxLeadTrimOffset = chunkIndex === 0
            ? CAVBOT_TTS_PLAYBACK_START_OFFSET_SEC
            : CAVBOT_TTS_CONTINUATION_START_OFFSET_SEC;
          const cachedLeadTrimOffset = Math.max(
            0,
            Math.min(
              maxLeadTrimOffset,
              Number(ttsLeadTrimCacheRef.current.get(cacheKey) || 0)
            )
          );
          if (Number.isFinite(cachedLeadTrimOffset) && cachedLeadTrimOffset > 0) {
            const applyLeadTrimOffset = () => {
              const duration = Number(audio.duration || 0);
              if (!Number.isFinite(duration) || duration <= cachedLeadTrimOffset + 0.05) return;
              try {
                audio.currentTime = cachedLeadTrimOffset;
              } catch {
                // Ignore seek failures.
              }
            };
            if (audio.readyState >= 1) {
              applyLeadTrimOffset();
            } else {
              audio.addEventListener("loadedmetadata", applyLeadTrimOffset, { once: true });
            }
          }
          ttsAudioRef.current = audio;
          ttsAudioUrlRef.current = url;
          let fadeFrameId = 0;
          const stopFade = () => {
            if (typeof window === "undefined") return;
            if (!fadeFrameId) return;
            window.cancelAnimationFrame(fadeFrameId);
            fadeFrameId = 0;
          };
          const beginFadeIn = () => {
            if (typeof window === "undefined") {
              audio.volume = CAVBOT_TTS_PLAYBACK_TARGET_VOLUME;
              return;
            }
            if (CAVBOT_TTS_FADE_IN_MS <= 0) {
              audio.volume = CAVBOT_TTS_PLAYBACK_TARGET_VOLUME;
              return;
            }
            audio.volume = 0.001;
            const startedAt = window.performance.now();
            const tick = (now: number) => {
              if (ttsPlaybackSessionRef.current !== playbackSession) return;
              const progress = Math.min(1, Math.max(0, (now - startedAt) / CAVBOT_TTS_FADE_IN_MS));
              audio.volume = CAVBOT_TTS_PLAYBACK_TARGET_VOLUME * progress;
              if (progress < 1) {
                fadeFrameId = window.requestAnimationFrame(tick);
                return;
              }
              fadeFrameId = 0;
            };
            fadeFrameId = window.requestAnimationFrame(tick);
          };

          let cleanupPlaybackListeners = () => {};
          const awaitPlaybackEnd = new Promise<void>((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
              stopFade();
              audio.onended = null;
              audio.onerror = null;
              audio.onpause = null;
            };
            cleanupPlaybackListeners = cleanup;
            const settle = (error?: Error) => {
              if (settled) return;
              settled = true;
              cleanup();
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            };
            audio.onended = () => settle();
            audio.onerror = () => settle(new Error("Speech playback failed."));
            audio.onpause = () => {
              if (ttsPlaybackSessionRef.current !== playbackSession) settle();
            };
          });

          try {
            await audio.play();
          } catch (playError) {
            cleanupPlaybackListeners();
            throw playError;
          }
          beginFadeIn();
          await awaitPlaybackEnd;
          clearTtsPlayback();
        }

        if (ttsPlaybackSessionRef.current !== playbackSession) return false;
        setSpeakingMessageId((current) => (current === speakingKey ? "" : current));
        return true;
      } catch (err) {
        clearTtsPlayback();
        setSpeakingMessageId((current) => (current === speakingKey ? "" : current));
        if (ttsPlaybackSessionRef.current === playbackSession) {
          if (isSpeechPlaybackBlockedError(err)) {
            ttsBlockedRetryPayloadRef.current = {
              text,
              speakingKey,
            };
            setError("");
          } else {
            ttsBlockedRetryPayloadRef.current = null;
            setError(toSpeechErrorMessage(err) || "Failed to generate speech.");
          }
        }
        return false;
      }
    },
    [clearTtsPlayback, requestSpeechBlob, speakingMessageId, stopSpeaking]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const retryBlockedSpeech = () => {
      const payload = ttsBlockedRetryPayloadRef.current;
      if (!payload) return;
      ttsBlockedRetryPayloadRef.current = null;
      void playSpeechFromText(payload.text, payload.speakingKey);
    };
    window.addEventListener("pointerdown", retryBlockedSpeech, true);
    window.addEventListener("keydown", retryBlockedSpeech, true);
    window.addEventListener("touchstart", retryBlockedSpeech, true);
    return () => {
      window.removeEventListener("pointerdown", retryBlockedSpeech, true);
      window.removeEventListener("keydown", retryBlockedSpeech, true);
      window.removeEventListener("touchstart", retryBlockedSpeech, true);
    };
  }, [playSpeechFromText]);

  const processDictatedVoice = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      setError("No audio was captured.");
      setVoiceOrbState("idle");
      setActiveVoiceCaptureIntent(null);
      return;
    }
    setProcessingVoice(true);
    setVoiceOrbState("processing");
    try {
      const extension = inferAudioFileExtension(blob.type);
      const file = new File(
        [blob],
        `dictate-${Date.now().toString(36)}.${extension}`,
        { type: blob.type || "audio/webm" }
      );
      const transcript = await transcribeAudioFile(file);
      if (!appendTranscriptToComposer(transcript || "")) {
        setVoiceOrbState("idle");
        return;
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dictation failed.");
      setVoiceOrbState("idle");
    } finally {
      setProcessingVoice(false);
      setVoiceOrbState("idle");
      setActiveVoiceCaptureIntent(null);
    }
  }, [appendTranscriptToComposer, transcribeAudioFile]);

  const processSpokenVoice = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      setError("No audio was captured.");
      setVoiceOrbState("idle");
      setActiveVoiceCaptureIntent(null);
      return;
    }
    setProcessingVoice(true);
    setVoiceOrbState("processing");
    try {
      const extension = inferAudioFileExtension(blob.type);
      const file = new File(
        [blob],
        `voice-input-${Date.now().toString(36)}.${extension}`,
        { type: blob.type || "audio/webm" }
      );
      const transcript = await transcribeAudioFile(file, ALIBABA_QWEN_ASR_MODEL_ID);
      const spokenPrompt = s(transcript);
      if (!spokenPrompt) {
        setError("Voice input did not produce a transcript.");
        autoSpeakNextVoiceReplyRef.current = false;
        setVoiceOrbState("idle");
        return;
      }
      autoSpeakNextVoiceReplyRef.current = true;
      const reply = await onSubmit({
        prompt: spokenPrompt,
        model: voiceReplyModel,
        deferUiRefresh: true,
      });
      const replyText = s(reply);
      if (!replyText) {
        autoSpeakNextVoiceReplyRef.current = false;
        setVoiceOrbState("idle");
        return;
      }
      const quickSpeakKey = `voice-auto-inline-${hashSpeechText(replyText)}`;
      autoSpeakNextVoiceReplyRef.current = false;
      setVoiceOrbState("speaking");
      const started = await playSpeechFromText(replyText, quickSpeakKey);
      if (!started) {
        autoSpeakNextVoiceReplyRef.current = true;
        setVoiceOrbState("idle");
      }
    } catch (err) {
      autoSpeakNextVoiceReplyRef.current = false;
      setError(err instanceof Error ? err.message : "Voice input failed.");
      setVoiceOrbState("idle");
    } finally {
      setProcessingVoice(false);
      setVoiceOrbState("idle");
      setActiveVoiceCaptureIntent(null);
    }
  }, [onSubmit, playSpeechFromText, transcribeAudioFile, voiceReplyModel]);

  useEffect(() => {
    const latestAssistant = [...messages]
      .reverse()
      .find((item) => item.role === "assistant" && s(item.contentText) && s(item.id));
    if (!latestAssistant) return;
    prefetchSpeechForMessage(latestAssistant.contentText, latestAssistant.id);
  }, [messages, prefetchSpeechForMessage]);

  useEffect(() => {
    if (!autoSpeakNextVoiceReplyRef.current) return;
    const latestAssistant = [...messages]
      .reverse()
      .find((item) => item.role === "assistant" && s(item.contentText));
    if (!latestAssistant) return;
    const latestAssistantId = s(latestAssistant.id);
    if (!latestAssistantId) return;
    if (lastAutoSpokenVoiceMessageIdRef.current === latestAssistantId) return;
    lastAutoSpokenVoiceMessageIdRef.current = latestAssistantId;
    autoSpeakNextVoiceReplyRef.current = false;
    void playSpeechFromText(latestAssistant.contentText, `voice-auto-${latestAssistantId}`);
  }, [messages, playSpeechFromText]);

  const stopVoiceCapture = useCallback(() => {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;
    if (recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const startVoiceCapture = useCallback(async (intent: VoiceCaptureIntent) => {
    if (recordingVoice || processingVoice || transcribingAudio || submitting) return;
    if (typeof window === "undefined" || typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice input is not available in this browser.");
      return;
    }

    setError("");
    setActiveVoiceCaptureIntent(intent);
    setVoiceOrbState("listening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickAudioRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      voiceStreamRef.current = stream;
      setVoiceOrbStream(stream);
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
        setVoiceOrbState("idle");
        setActiveVoiceCaptureIntent(null);
        setError("Voice capture failed.");
      };

      recorder.onstop = () => {
        const chunks = voiceChunksRef.current.slice();
        const fallbackType = recorder.mimeType || "audio/webm";
        clearVoiceCapture();
        setRecordingVoice(false);
        const blob = chunks.length ? new Blob(chunks, { type: fallbackType }) : null;
        if (!blob || !blob.size) {
          setVoiceOrbState("idle");
          setActiveVoiceCaptureIntent(null);
          setError("No audio was captured.");
          return;
        }
        if (intent === "dictate") {
          void processDictatedVoice(blob);
          return;
        }
        void processSpokenVoice(blob);
      };

      recorder.start(250);
      setRecordingVoice(true);
    } catch (err) {
      clearVoiceCapture();
      setRecordingVoice(false);
      setProcessingVoice(false);
      setVoiceOrbState("idle");
      setActiveVoiceCaptureIntent(null);
      setError(toVoiceCaptureErrorMessage(err));
    }
  }, [clearVoiceCapture, processDictatedVoice, processSpokenVoice, processingVoice, recordingVoice, submitting, transcribingAudio]);

  const promptHasTypedInput = prompt.length > 0;
  const dictateCaptureActive = recordingVoice && activeVoiceCaptureIntent === "dictate";
  const speakCaptureActive = recordingVoice && activeVoiceCaptureIntent === "speak";
  const voiceStatus = useMemo(() => {
    if (dictateCaptureActive) {
      return {
        label: "Dictating",
        detail: "Listening now. Tap Dictate again to turn this audio into text.",
      };
    }
    if (speakCaptureActive) {
      return {
        label: "Speak",
        detail: "Listening now. Tap Speak again to send and hear CavAi respond.",
      };
    }
    if (transcribingAudio && activeVoiceCaptureIntent === "dictate") {
      return {
        label: "Transcribing",
        detail: "Turning your audio into text for the composer.",
      };
    }
    if (transcribingAudio || processingVoice) {
      return {
        label: "Thinking",
        detail: "Transcribing your audio and preparing the reply.",
      };
    }
    return null;
  }, [activeVoiceCaptureIntent, dictateCaptureActive, processingVoice, speakCaptureActive, transcribingAudio]);
  const onComposerDictateAction = useCallback(() => {
    if (isGuestPreviewMode) {
      setError("Dictate is locked in guest preview. Sign in to unlock voice input.");
      return;
    }
    if (dictateCaptureActive) {
      stopVoiceCapture();
      return;
    }
    if (recordingVoice || processingVoice || transcribingAudio || submitting) return;
    void startVoiceCapture("dictate");
  }, [
    dictateCaptureActive,
    isGuestPreviewMode,
    processingVoice,
    recordingVoice,
    startVoiceCapture,
    stopVoiceCapture,
    submitting,
    transcribingAudio,
  ]);
  const onComposerPrimaryAction = useCallback(() => {
    if (submitting) {
      onStop();
      return;
    }
    if (promptHasTypedInput) {
      void onSubmit();
      return;
    }
    if (isGuestPreviewMode) {
      return;
    }
    if (speakCaptureActive) {
      stopVoiceCapture();
      return;
    }
    if (recordingVoice || processingVoice || transcribingAudio) return;
    void startVoiceCapture("speak");
  }, [
    onStop,
    onSubmit,
    processingVoice,
    promptHasTypedInput,
    isGuestPreviewMode,
    recordingVoice,
    speakCaptureActive,
    startVoiceCapture,
    stopVoiceCapture,
    submitting,
    transcribingAudio,
  ]);

  const uploadFileToCavCloud = useCallback(async (file: File): Promise<CavAiUploadedFileAttachment> => {
    const requestedName = s(file.name) || `upload-${Date.now().toString(36)}`;
    const form = new FormData();
    form.set("file", file, requestedName);
    form.set("name", requestedName);
    const res = await fetch(`/api/cavcloud/files/upload?folderPath=${encodeURIComponent(CAVAI_UPLOAD_FOLDER_PATH)}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "x-cavbot-csrf": "1",
      },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      file?: {
        id?: unknown;
        path?: unknown;
        name?: unknown;
        mimeType?: unknown;
        bytes?: unknown;
        previewSnippet?: unknown;
      } | null;
    };
    const cavcloudFileId = s(body.file?.id);
    if (!res.ok || body.ok !== true || !cavcloudFileId) {
      throw new Error(s(body.message) || "File upload failed.");
    }
    const mimeType = s(body.file?.mimeType) || s(file.type) || "application/octet-stream";
    const name = s(body.file?.name) || requestedName;
    return {
      id: cavcloudFileId,
      cavcloudFileId,
      path: s(body.file?.path),
      name,
      mimeType,
      sizeBytes: Math.max(1, Math.trunc(Number(body.file?.bytes) || Number(file.size) || 1)),
      iconSrc: resolveUploadFileIcon(name, mimeType),
      snippet: s(body.file?.previewSnippet) || null,
      uploading: false,
    };
  }, []);

  const onAttachFiles = useCallback(async (files: FileList | null) => {
    if (isGuestPreviewMode) {
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      return;
    }
    if (!files || !files.length) return;
    const current = [...images];
    const currentFiles = [...uploadedFiles];
    const newlyAttachedImages: CavAiImageAttachment[] = [];
    const incoming = Array.from(files);
    const imageUploadQueue: Array<{ file: File; mime: string; pendingUploadId: string }> = [];
    const fileUploadQueue: Array<{ file: File; optimisticId: string }> = [];
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
      if (mime.startsWith("image/")) {
        if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
          imageSizeRejected = true;
          continue;
        }
        const pendingUploadId = `uploading_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
        current.push({
          id: pendingUploadId,
          assetId: null,
          name: s(file.name) || "image",
          mimeType: mime || "image/png",
          sizeBytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
          dataUrl: TRANSPARENT_IMAGE_DATA_URL,
          uploading: true,
        });
        imageUploadQueue.push({ file, mime, pendingUploadId });
        acceptedCount += 1;
        continue;
      }

      if (file.size <= 0) {
        fileError = "One or more files were empty and skipped.";
        continue;
      }

      const optimisticId = `file_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
      currentFiles.push({
        id: optimisticId,
        cavcloudFileId: null,
        path: "",
        name: s(file.name) || "file",
        mimeType: mime || "application/octet-stream",
        sizeBytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
        iconSrc: resolveUploadFileIcon(s(file.name), mime),
        snippet: null,
        uploading: true,
      });
      fileUploadQueue.push({ file, optimisticId });
      acceptedCount += 1;
    }

    setImages([...current]);
    setUploadedFiles([...currentFiles]);

    for (const queuedImage of imageUploadQueue) {
      const { file, mime, pendingUploadId } = queuedImage;
      let dataUrl = "";
      const fallbackName = s(file.name) || "image";
      const fallbackMime = mime || "image/png";
      const fallbackSizeBytes = Math.max(1, Math.trunc(Number(file.size) || 1));
      const applyLocalImageFallback = () => {
        const localImage: CavAiImageAttachment = {
          id: pendingUploadId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
          assetId: null,
          name: fallbackName,
          mimeType: fallbackMime,
          sizeBytes: fallbackSizeBytes,
          dataUrl: dataUrl || TRANSPARENT_IMAGE_DATA_URL,
          uploading: false,
        };
        const pendingIndex = current.findIndex((row) => row.id === pendingUploadId);
        if (pendingIndex >= 0) {
          current[pendingIndex] = localImage;
        } else {
          current.push(localImage);
        }
        setImages([...current]);
        newlyAttachedImages.push(localImage);
      };
      try {
        dataUrl = await toDataUrl(file);
        if (!dataUrl) {
          imageError = "One or more images could not be read.";
          const pendingIndex = current.findIndex((row) => row.id === pendingUploadId);
          if (pendingIndex >= 0) {
            current.splice(pendingIndex, 1);
            setImages([...current]);
          }
          continue;
        }
        const pendingPreviewIndex = current.findIndex((row) => row.id === pendingUploadId);
        if (pendingPreviewIndex >= 0) {
          current[pendingPreviewIndex] = {
            ...current[pendingPreviewIndex],
            dataUrl,
          };
          setImages([...current]);
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
          applyLocalImageFallback();
          continue;
        }
        const assetId = s(uploadBody.assetId) || s(uploadBody.asset?.id);
        const previewDataUrl = s(uploadBody.preview?.dataUrl) || s(uploadBody.asset?.dataUrl) || dataUrl;
        if (!assetId || !previewDataUrl) {
          applyLocalImageFallback();
          continue;
        }
        const nextImage: CavAiImageAttachment = {
          id: pendingUploadId || assetId || `${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
          assetId: assetId || null,
          name: s(uploadBody.preview?.fileName) || s(uploadBody.asset?.fileName) || fallbackName,
          mimeType: s(uploadBody.preview?.mimeType) || s(uploadBody.asset?.mimeType) || fallbackMime,
          sizeBytes: Math.max(1, Math.trunc(Number(uploadBody.asset?.bytes) || fallbackSizeBytes || 1)),
          dataUrl: previewDataUrl || TRANSPARENT_IMAGE_DATA_URL,
          uploading: false,
        };
        const pendingIndex = current.findIndex((row) => row.id === pendingUploadId);
        if (pendingIndex >= 0) {
          current[pendingIndex] = nextImage;
        } else {
          current.push(nextImage);
        }
        setImages([...current]);
        newlyAttachedImages.push(nextImage);
      } catch {
        if (dataUrl) {
          applyLocalImageFallback();
          continue;
        }
        const pendingIndex = current.findIndex((row) => row.id === pendingUploadId);
        if (pendingIndex >= 0) {
          current.splice(pendingIndex, 1);
          setImages([...current]);
        }
        imageError = "One or more images could not be read.";
      }
    }

    for (const queuedFile of fileUploadQueue) {
      const { file, optimisticId } = queuedFile;
      try {
        const uploaded = await uploadFileToCavCloud(file);
        const pendingIndex = currentFiles.findIndex((row) => row.id === optimisticId);
        if (pendingIndex >= 0) {
          currentFiles[pendingIndex] = uploaded;
        } else {
          currentFiles.push(uploaded);
        }
      } catch (err) {
        fileError = err instanceof Error ? err.message : "File upload failed.";
        const pendingIndex = currentFiles.findIndex((row) => row.id === optimisticId);
        if (pendingIndex >= 0) {
          currentFiles.splice(pendingIndex, 1);
        }
        continue;
      }

      if (isAudioLikeFile(file) && file.size > 0 && file.size <= MAX_AUDIO_BYTES) {
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
    setImages(current);
    setUploadedFiles(currentFiles);
    if (newlyAttachedImages.length) {
      setImageStudioSourceAssetId("");
      setRecentImageLibrary((prev) => mergeRecentImageLibrary(prev, newlyAttachedImages));
    }
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
  }, [images, isGuestPreviewMode, maxImageAttachments, transcribeAudioFile, uploadFileToCavCloud, uploadedFiles]);

  const onThreadScroll = useCallback(() => {
    const node = threadRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 72;
  }, []);

  useEffect(() => () => {
    clearTtsPlayback();
  }, [clearTtsPlayback]);

  useEffect(() => () => {
    clearVoiceCapture();
  }, [clearVoiceCapture]);

  useEffect(() => {
    if (isOpen) return;
    stopSpeaking();
    clearVoiceCapture();
    setRecordingVoice(false);
    setProcessingVoice(false);
  }, [clearVoiceCapture, isOpen, stopSpeaking]);

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
      if (isGuestPreviewMode) return null;
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
    [applyFeedbackStateForMessage, isGuestPreviewMode, sessionId]
  );

  const copyTextWithFeedback = useCallback(
    async (item: CavAiMessage, text: string, token: string) => {
      const content = item.role === "assistant"
        ? normalizeCenterMessageText(text).trim()
        : String(text || "");
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
      const text = item.role === "assistant"
        ? normalizeCenterMessageText(item.contentText).trim()
        : s(item.contentText);
      if (!text) return;
      try {
        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
          await navigator.share({
            title: item.role === "assistant" ? "CavAi response" : "CavAi prompt",
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

  const onSpeakMessage = useCallback(
    async (item: CavAiMessage) => {
      if (item.role !== "assistant") return;
      const text = normalizeCenterMessageText(item.contentText).trim();
      if (!text) return;
      await playSpeechFromText(text, item.id);
    },
    [playSpeechFromText]
  );

  const resolveRetryDraft = useCallback(
    (messageId: string): CavAiCenterRetryDraft | null => {
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
      const promptValue = s(payloadRaw.prompt) || s(userMessage.contentText);
      if (!promptValue) return null;

      const selectedAction = config.actions[0]?.action || "technical_recap";
      const action = toAiCenterAction(payloadRaw.action)
        || inferCenterActionFromPrompt(promptValue, selectedAction);
      const agentRef = normalizeAgentRef({
        agentId: payloadRaw.agentId,
        agentActionKey: payloadRaw.agentActionKey,
      });
      const model = s(payloadRaw.model) || selectedModel;
      const normalizedReasoningLevel = parseReasoningLevel(payloadRaw.reasoningLevel) || reasoningLevel;
      const researchModeValue = payloadRaw.researchMode === true || model === ALIBABA_QWEN_MAX_MODEL_ID;
      const researchUrls = Array.isArray(payloadRaw.researchUrls)
        ? payloadRaw.researchUrls.map((item) => s(item)).filter(Boolean).slice(0, 8)
        : [];
      const contextLabel = s(payloadRaw.contextLabel) || null;
      const context = (
        payloadRaw.context && typeof payloadRaw.context === "object" && !Array.isArray(payloadRaw.context)
          ? (payloadRaw.context as Record<string, unknown>)
          : {}
      );
      const uploadedFiles = toRetryUploadedFiles(context);

      return {
        userMessageId: userMessage.id,
        prompt: promptValue,
        action,
        agentId: agentRef?.agentId || null,
        agentActionKey: agentRef?.agentActionKey || null,
        model,
        reasoningLevel: normalizedReasoningLevel,
        researchMode: researchModeValue,
        researchUrls,
        images: toRetryImages(payloadRaw.imageAttachments),
        uploadedFiles,
        sessionId: s(sessionId),
        contextLabel,
        context,
      };
    },
    [config.actions, messages, reasoningLevel, selectedModel, sessionId]
  );

  const applyRetryDraftToComposer = useCallback((retryDraft: CavAiCenterRetryDraft) => {
    setPrompt(retryDraft.prompt);
    setSelectedModel(retryDraft.model);
    setReasoningLevel(retryDraft.reasoningLevel);
    setResearchMode(retryDraft.researchMode);
    setImages(retryDraft.images);
    setUploadedFiles(retryDraft.uploadedFiles);
    const retryPresetId = s(retryDraft.context?.imageStudioPresetId);
    if (retryPresetId) setSelectedImagePresetId(retryPresetId);
    const retrySourceAssetId = s(retryDraft.context?.imageStudioSourceAssetId);
    setImageStudioSourceAssetId(retrySourceAssetId);
    if (retryDraft.action === "image_studio") {
      setComposerQuickMode("create_image");
      return;
    }
    if (retryDraft.action === "image_edit") {
      setComposerQuickMode("edit_image");
      return;
    }
    if (retryDraft.researchMode || retryDraft.action === "web_research") {
      setComposerQuickMode("deep_research");
      return;
    }
    if (retryDraft.agentId && retryDraft.agentActionKey) {
      setManualAgentRef({
        agentId: retryDraft.agentId,
        agentActionKey: retryDraft.agentActionKey,
      });
      setComposerQuickMode("agent_mode");
      return;
    }
    setComposerQuickMode(null);
  }, []);

  const rewindSessionFromMessage = useCallback(
    async (targetSessionId: string, targetMessageId: string, fallbackMessage: string): Promise<boolean> => {
      try {
        const rewindRes = await fetch(
          `/api/ai/sessions/${encodeURIComponent(targetSessionId)}/messages/${encodeURIComponent(targetMessageId)}`,
          {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1",
            },
            body: JSON.stringify({ mode: "rewind" }),
          }
        );
        const rewindBody = (await rewindRes.json().catch(() => ({}))) as ApiEnvelope<{
          sessionId?: string;
          messageId?: string;
        }>;
        if (!rewindRes.ok || !rewindBody.ok) {
          emitGuardDecisionFromPayload(rewindBody);
          throw new Error(s((rewindBody as { message?: unknown }).message) || fallbackMessage);
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : fallbackMessage);
        return false;
      }
    },
    []
  );

  const onRetryMessage = useCallback(
    async (item: CavAiMessage) => {
      const retryDraft = resolveRetryDraft(item.id);
      if (!retryDraft) {
        setError("No prior prompt found for retry.");
        return;
      }
      const targetSessionId = s(sessionId) || s(retryDraft.sessionId);
      const targetUserMessageId = s(retryDraft.userMessageId);
      if (!targetSessionId || !targetUserMessageId) {
        setError("Unable to retry this prompt right now.");
        return;
      }
      applyRetryDraftToComposer(retryDraft);
      setInlineEditDraft(null);
      setInlineEditPrompt("");
      setInlineEditPendingAnchorId(targetUserMessageId);
      setError("");
      activeSessionIdRef.current = targetSessionId;
      setSessionId(targetSessionId);
      setMessages((prev) => {
        const anchorIndex = prev.findIndex((row) => row.id === targetUserMessageId);
        if (anchorIndex < 0) return prev;
        return prev.slice(0, anchorIndex + 1);
      });

      const rewound = await rewindSessionFromMessage(
        targetSessionId,
        targetUserMessageId,
        "Failed to retry prompt."
      );
      if (!rewound) {
        await loadMessages(targetSessionId);
        setInlineEditPendingAnchorId("");
        return;
      }

      void runMessageFeedbackAction(item.id, "retry");
      const answer = await onSubmit({
        ...retryDraft,
        sessionId: targetSessionId,
        showPendingPrompt: false,
        context: {
          ...(retryDraft.context || {}),
          retryFromMessageId: item.id,
          retryFromSessionId: targetSessionId,
        },
      });
      if (answer === null) {
        await loadMessages(targetSessionId);
      }
      setInlineEditPendingAnchorId("");
    },
    [
      applyRetryDraftToComposer,
      loadMessages,
      onSubmit,
      resolveRetryDraft,
      rewindSessionFromMessage,
      runMessageFeedbackAction,
      sessionId,
    ]
  );

  const onEditMessage = useCallback(
    (item: CavAiMessage) => {
      const retryDraft = resolveRetryDraft(item.id);
      if (!retryDraft) {
        setError("No prior prompt found for edit.");
        return;
      }
      if (!s(retryDraft.userMessageId)) {
        setError("Unable to edit this prompt right now.");
        return;
      }
      shouldAutoScrollRef.current = false;
      setInlineEditDraft(retryDraft);
      setInlineEditPrompt(retryDraft.prompt);
      setInlineEditBusy(false);
      setPrompt("");
      setImages([]);
      setUploadedFiles([]);
      setError("");
      if (typeof window !== "undefined") {
        const targetUserMessageId = s(retryDraft.userMessageId);
        window.requestAnimationFrame(() => {
          if (!targetUserMessageId) return;
          scrollThreadMessageIntoView(targetUserMessageId, "smooth");
        });
      }
    },
    [resolveRetryDraft, scrollThreadMessageIntoView]
  );

  const onCancelInlineEdit = useCallback(() => {
    if (inlineEditBusy || submitting) return;
    shouldAutoScrollRef.current = true;
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
    const targetSessionId = s(sessionId) || s(inlineEditDraft.sessionId);
    const targetUserMessageId = s(inlineEditDraft.userMessageId);
    if (!targetSessionId || !targetUserMessageId) {
      setError("Unable to edit this prompt right now.");
      return;
    }
    setInlineEditBusy(true);
    try {
      const rewound = await rewindSessionFromMessage(
        targetSessionId,
        targetUserMessageId,
        "Failed to edit prompt."
      );
      if (!rewound) return;

      activeSessionIdRef.current = targetSessionId;
      setSessionId(targetSessionId);
      setInlineEditDraft(null);
      setInlineEditPrompt("");
      setInlineEditPendingAnchorId(targetUserMessageId);
      setMessages((prev) => {
        const optimisticIndex = prev.findIndex((row) => row.id === targetUserMessageId);
        if (optimisticIndex < 0) return prev;
        const next = prev.slice(0, optimisticIndex + 1);
        const target = next[optimisticIndex];
        const targetJson = target.contentJson && typeof target.contentJson === "object" && !Array.isArray(target.contentJson)
          ? { ...(target.contentJson as Record<string, unknown>) }
          : {};
        targetJson.prompt = editedPrompt;
        next[optimisticIndex] = {
          ...target,
          contentText: editedPrompt,
          contentJson: targetJson,
        };
        return next;
      });

      const answer = await onSubmit({
        ...inlineEditDraft,
        prompt: editedPrompt,
        sessionId: targetSessionId,
        showPendingPrompt: false,
        context: {
          ...(inlineEditDraft.context || {}),
          retryFromMessageId: inlineEditDraft.userMessageId,
          retryFromSessionId: targetSessionId,
        },
      });
      if (answer === null) {
        await loadMessages(targetSessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit prompt.");
    } finally {
      setInlineEditPendingAnchorId("");
      setInlineEditBusy(false);
    }
  }, [
    inlineEditBusy,
    inlineEditDraft,
    inlineEditPrompt,
    loadMessages,
    onSubmit,
    rewindSessionFromMessage,
    sessionId,
    submitting,
  ]);

  const onInlineEditPromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    void onSubmitInlineEdit();
  }, [onSubmitInlineEdit]);

  const onFocusSessionSearch = useCallback(() => {
    if (isPhoneLayout) {
      setChatsExpanded(true);
      setMobileDrawerOpen(true);
    }
    const input = searchInputRef.current;
    if (input) {
      input.focus();
      input.select();
      return;
    }
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const nextInput = searchInputRef.current;
      if (!nextInput) return;
      nextInput.focus();
      nextInput.select();
    });
  }, [isPhoneLayout]);

  const closeSessionActionModal = useCallback(() => {
    setSessionActionModal(null);
    setSessionActionBusy(false);
    setRenameDraftTitle("");
    setShareMode("internal");
    setShareTargetIdentity("");
    setShareResultUrl("");
    setShareDeliveredHint("");
    setShareResultCopied(false);
  }, []);

  const openSessionActionModal = useCallback((type: SessionActionModal["type"], session: CavAiSessionSummary) => {
    if (isGuestPreviewMode && type !== "delete") {
      setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
      closeActiveSessionMenu();
      return;
    }
    closeActiveSessionMenu();
    if (type === "rename") {
      setRenameDraftTitle(normalizeSessionTitleForSidebar(session.title || session.contextLabel || "Untitled chat"));
    } else {
      setRenameDraftTitle("");
    }
    setShareMode("internal");
    setShareTargetIdentity("");
    setShareResultUrl("");
    setShareDeliveredHint("");
    setShareResultCopied(false);
    setSessionActionModal({ type, session });
  }, [closeActiveSessionMenu, isGuestPreviewMode]);

  const onRenameSession = useCallback(async () => {
    if (!sessionActionModal || sessionActionModal.type !== "rename") return;
    const nextTitle = s(renameDraftTitle).slice(0, 220);
    if (!nextTitle) {
      setError("Title is required.");
      return;
    }
    setSessionActionBusy(true);
    try {
      const res = await fetch(`/api/ai/sessions/${encodeURIComponent(sessionActionModal.session.id)}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({ title: nextTitle }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        session?: { id: string; title: string };
        message?: string;
      }>;
      if (!res.ok || !body.ok || !body.session) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          closeSessionActionModal();
          return;
        }
        if (isSessionUnavailableLikeResponse(res.status, body)) {
          clearUnavailableSession(sessionActionModal.session.id);
          closeSessionActionModal();
          return;
        }
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to rename chat.");
      }
      setSessions((prev) =>
        prev.map((row) => (row.id === body.session?.id ? { ...row, title: body.session.title } : row))
      );
      closeSessionActionModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename chat.");
      setSessionActionBusy(false);
    }
  }, [applyUnauthenticatedCenterState, clearUnavailableSession, closeSessionActionModal, renameDraftTitle, sessionActionModal]);

  const onDeleteSession = useCallback(async () => {
    if (!sessionActionModal || sessionActionModal.type !== "delete") return;
    const doomedSessionId = sessionActionModal.session.id;
    if (isGuestPreviewMode) {
      const nextSessions = sessions.filter((row) => row.id !== doomedSessionId);
      setSessions(nextSessions);
      sessionMessageCacheRef.current = new Map(
        Array.from(sessionMessageCacheRef.current.entries()).filter(([id]) => id !== doomedSessionId)
      );
      let nextActiveSessionId = s(sessionId);
      if (nextActiveSessionId === doomedSessionId) {
        nextActiveSessionId = s(nextSessions[0]?.id);
      }
      if (!isGuestPreviewSessionId(nextActiveSessionId)) {
        nextActiveSessionId = "";
      }
      activeSessionIdRef.current = nextActiveSessionId;
      setSessionId(nextActiveSessionId);
      setLoadingMessages(false);
      if (!nextActiveSessionId) {
        setMessages([]);
      } else {
        const cached = sessionMessageCacheRef.current.get(nextActiveSessionId);
        if (cached) setMessages(cached);
        else {
          const summary = nextSessions.find((row) => row.id === nextActiveSessionId) || null;
          setMessages(buildSyntheticThreadFromSessionSummary(summary));
        }
      }
      scheduleSessionCachePersist({
        sessions: nextSessions,
        activeSessionId: nextActiveSessionId,
      });
      closeSessionActionModal();
      return;
    }
    setSessionActionBusy(true);
    try {
      const res = await fetch(`/api/ai/sessions/${encodeURIComponent(doomedSessionId)}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: {
          "x-cavbot-csrf": "1",
        },
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{ message?: string }>;
      if (!res.ok || !body.ok) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          closeSessionActionModal();
          return;
        }
        if (isSessionUnavailableLikeResponse(res.status, body)) {
          clearUnavailableSession(doomedSessionId);
          closeSessionActionModal();
          return;
        }
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to delete chat.");
      }
      setSessions((prev) => prev.filter((row) => row.id !== doomedSessionId));
      if (s(sessionId) === doomedSessionId) {
        activeSessionIdRef.current = "";
        setSessionId("");
        setLoadingMessages(false);
        setMessages([]);
      }
      closeSessionActionModal();
      void loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete chat.");
      setSessionActionBusy(false);
    }
  }, [applyUnauthenticatedCenterState, clearUnavailableSession, closeSessionActionModal, isGuestPreviewMode, loadSessions, scheduleSessionCachePersist, sessionActionModal, sessionId, sessions]);

  const onShareSession = useCallback(async () => {
    if (!sessionActionModal || sessionActionModal.type !== "share") return;
    setSessionActionBusy(true);
    setShareResultCopied(false);
    try {
      const res = await fetch(`/api/ai/sessions/${encodeURIComponent(sessionActionModal.session.id)}/share`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          mode: shareMode,
          targetIdentity: s(shareTargetIdentity) || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiEnvelope<{
        mode?: string;
        internalUrl?: string;
        externalUrl?: string;
        deliveredTo?: { id: string; label: string } | null;
        message?: string;
      }>;
      if (!res.ok || !body.ok) {
        if (isAuthRequiredLikeResponse(res.status, body)) {
          applyUnauthenticatedCenterState();
          closeSessionActionModal();
          return;
        }
        if (isSessionUnavailableLikeResponse(res.status, body)) {
          clearUnavailableSession(sessionActionModal.session.id);
          closeSessionActionModal();
          return;
        }
        emitGuardDecisionFromPayload(body);
        throw new Error(s((body as { message?: unknown }).message) || "Failed to share chat.");
      }
      const url = shareMode === "external" ? s((body as { externalUrl?: unknown }).externalUrl) : s((body as { internalUrl?: unknown }).internalUrl);
      setShareResultUrl(url);
      const deliveredLabel = s((body as { deliveredTo?: { label?: unknown } | null }).deliveredTo?.label);
      setShareDeliveredHint(deliveredLabel ? `Shared inside app with ${deliveredLabel}.` : "");
      setSessionActionBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share chat.");
      setSessionActionBusy(false);
    }
  }, [applyUnauthenticatedCenterState, clearUnavailableSession, closeSessionActionModal, sessionActionModal, shareMode, shareTargetIdentity]);

  const onCopyShareUrl = useCallback(async () => {
    const url = s(shareResultUrl);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareResultCopied(true);
    } catch {
      setError("Failed to copy share link.");
    }
  }, [shareResultUrl]);

  const onNativeShareUrl = useCallback(async () => {
    const url = s(shareResultUrl);
    if (!url || typeof navigator === "undefined" || typeof navigator.share !== "function") return;
    try {
      await navigator.share({
        title: "CavAi chat",
        url,
      });
    } catch {
      // user canceled or share failed
    }
  }, [shareResultUrl]);

  const renderSessionList = useMemo(() => {
    if (!visibleSessionCount) {
      return (
        <div className={styles.centerHistoryEmpty}>
          {isGuestPreviewMode ? "No preview chats yet." : "No conversations yet."}
        </div>
      );
    }

    if (!visibleFilteredSessions.length) {
      return <div className={styles.centerHistoryEmpty}>No matching conversations.</div>;
    }

    return visibleFilteredSessions.map((item) => {
      const isOn = s(sessionId) === item.id;
      const isRunning = submitting && isOn;
      const stamp = item.lastMessageAt || item.updatedAt;
      const title = toTitlePreview(
        normalizeSessionTitleForSidebar(item.title || item.contextLabel || item.preview || "Untitled chat")
      );
      const menuOpen = activeSessionMenuId === item.id;
      const showSessionActions = true;
      const menuStyle = menuOpen && activeSessionMenuAnchor
        ? {
            top: activeSessionMenuAnchor.top,
            right: activeSessionMenuAnchor.right,
          }
        : undefined;

      return (
        <div
          key={item.id}
          className={[
            styles.centerSessionRow,
            menuOpen ? styles.centerSessionRowMenuOpen : "",
            overlay ? styles.centerSessionRowOverlay : "",
          ].filter(Boolean).join(" ")}
          data-session-menu-id={item.id}
        >
          <button
            type="button"
            className={[styles.centerSessionItem, isOn ? styles.centerSessionItemOn : ""].filter(Boolean).join(" ")}
            onClick={() => onSelectSession(item.id)}
            title={toIsoTime(stamp)}
          >
            <div className={styles.centerSessionTop}>
              <span className={styles.centerSessionTitle}>{title}</span>
              {menuOpen ? null : <span className={styles.centerSessionTimeline}>{toTimelineLabel(stamp)}</span>}
              {isRunning ? (
                <span className={styles.centerSessionRunning}>
                  <span className={styles.centerSessionRunningGlyph} aria-hidden="true" />
                  Reasoning
                </span>
              ) : null}
            </div>
          </button>

          {showSessionActions ? (
            <button
              type="button"
              className={[
                styles.centerSessionMoreBtn,
                menuOpen ? styles.centerSessionMoreBtnOn : "",
                overlay ? styles.centerSessionMoreBtnOverlay : "",
              ].filter(Boolean).join(" ")}
              onClick={(event) => onToggleSessionMenu(item.id, event.currentTarget)}
              aria-label="Chat actions"
              title="Chat actions"
            >
              <span className={styles.centerSessionMoreGlyph} aria-hidden="true" />
            </button>
          ) : null}

          {showSessionActions && menuOpen ? (
            <div
              className={[
                styles.centerSessionMoreMenu,
                menuStyle ? styles.centerSessionMoreMenuFloating : "",
              ].filter(Boolean).join(" ")}
              role="menu"
              aria-label="Chat actions"
              data-session-menu-floating-id={item.id}
              style={menuStyle}
            >
              {isGuestPreviewMode ? null : (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.centerSessionMoreMenuItem}
                    onClick={() => openSessionActionModal("share", item)}
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.centerSessionMoreMenuItem}
                    onClick={() => openSessionActionModal("rename", item)}
                  >
                    Rename
                  </button>
                </>
              )}
              <button
                type="button"
                role="menuitem"
                className={[styles.centerSessionMoreMenuItem, styles.centerSessionMoreMenuItemDanger].join(" ")}
                onClick={() => openSessionActionModal("delete", item)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      );
    });
  }, [
    activeSessionMenuId,
    activeSessionMenuAnchor,
    isGuestPreviewMode,
    overlay,
    onSelectSession,
    onToggleSessionMenu,
    openSessionActionModal,
    sessionId,
    submitting,
    visibleFilteredSessions,
    visibleSessionCount,
  ]);

  const quickActionItems = useMemo(
    () => [
      {
        id: "add_files" as const,
        label: "Add photos & files",
        description: "Attach photos or any file type from your device.",
        locked: isGuestPreviewMode,
      },
      {
        id: "upload_from_cavcloud" as const,
        label: "Upload from CavCloud",
        description: "Attach files directly from CavCloud.",
        locked: isGuestPreviewMode,
      },
      {
        id: "recent_files" as const,
        label: "Recent files",
        description: "Reuse recently attached files in this chat.",
        locked: isGuestPreviewMode,
      },
      {
        id: "create_image" as const,
        label: "Create image",
        description: "Generate images with Image Studio.",
        locked: isGuestPreviewMode || !canUseCreateImage,
      },
      {
        id: "edit_image" as const,
        label: "Edit image",
        description: "Edit uploaded images with Image Edit.",
        locked: isGuestPreviewMode || !canUseEditImage,
      },
      {
        id: "deep_research" as const,
        label: "Deep Research",
        description: "Run web research mode with evidence synthesis.",
        locked: isGuestPreviewMode || !canUseDeepResearch,
      },
    ],
    [canUseCreateImage, canUseDeepResearch, canUseEditImage, isGuestPreviewMode]
  );
  const visibleCavCloudAttachItems = useMemo(() => {
    const query = s(cavCloudAttachQuery).toLowerCase();
    if (!query) return cavCloudAttachItems;
    return cavCloudAttachItems.filter((item) => {
      const haystack = [
        item.name,
        item.path,
        item.mimeType,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [cavCloudAttachItems, cavCloudAttachQuery]);

  const activeToolbarQuickModeLabel = useMemo(() => {
    if (activeToolbarQuickMode === "create_image" || activeToolbarQuickMode === "edit_image") return "Image";
    if (activeToolbarQuickMode === "deep_research") return "Deep Research";
    if (activeToolbarQuickMode === "companion") return "CavBot";
    return "";
  }, [activeToolbarQuickMode]);
  const activeToolbarQuickModeGlyphClass = useMemo(() => {
    if (activeToolbarQuickMode === "create_image") return styles.centerWebResearchGlyphCreateImage;
    if (activeToolbarQuickMode === "edit_image") return styles.centerWebResearchGlyphEditImage;
    if (activeToolbarQuickMode === "companion") return styles.centerWebResearchGlyphCompanion;
    return styles.centerWebResearchGlyphDeepResearch;
  }, [activeToolbarQuickMode]);
  const imageComposerModeActive = composerQuickMode === "create_image" || composerQuickMode === "edit_image";
  const lockImageStudioPromptLine = imageComposerModeActive && Boolean(selectedImagePresetActivationLine);
  const lockedImageStudioPromptPrefix = lockImageStudioPromptLine
    ? `${selectedImagePresetActivationLine}\n`
    : "";
  const createModeActive = composerQuickMode === "create_image";
  const editModeActive = composerQuickMode === "edit_image";
  const showComposerPresetPill = imageComposerModeActive && Boolean(selectedImagePreset);
  const presetPillGlyphClass = composerQuickMode === "edit_image"
    ? styles.centerWebResearchGlyphEditImage
    : styles.centerWebResearchGlyphCreateImage;
  const presetPillModeClass = composerQuickMode === "edit_image"
    ? styles.centerComposerPresetModePillEdit
    : styles.centerComposerPresetModePillCreate;
  const showComposerImageChips = images.length > 0;
  const showComposerFileChips = uploadedFiles.length > 0;
  const showComposerAttachmentChips = showComposerImageChips || showComposerFileChips;
  const showComposerPresetInlineLearnMore = (
    showComposerPresetPill
    && Boolean(selectedImagePresetActivationLine)
    && normalizeImageStudioActivationLine(prompt) === normalizeImageStudioActivationLine(selectedImagePresetActivationLine)
  );
  const shouldSuppressComposerPlaceholder = showComposerPresetInlineLearnMore
    || (isGuestPreviewMode && isEmptyThread && !s(prompt));
  useEffect(() => {
    if (!lockImageStudioPromptLine || !selectedImagePresetActivationLine) return;
    setPrompt((prev) => {
      const current = String(prev ?? "");
      const userText = extractImageStudioUserTextFromLockedPrompt(current, selectedImagePresetActivationLine);
      const next = buildLockedImageStudioPrompt(selectedImagePresetActivationLine, userText);
      return current === next ? prev : next;
    });
  }, [lockImageStudioPromptLine, selectedImagePresetActivationLine]);
  const ensureImageStudioPromptCaret = useCallback((target: HTMLTextAreaElement, options?: { forceLineTwoStart?: boolean }) => {
    if (!lockedImageStudioPromptPrefix) return;
    const currentValue = normalizeLineBreaks(target.value);
    if (!currentValue.startsWith(lockedImageStudioPromptPrefix)) return;
    const lineTwoStart = lockedImageStudioPromptPrefix.length;
    const selectionStart = target.selectionStart ?? lineTwoStart;
    const selectionEnd = target.selectionEnd ?? lineTwoStart;
    if (options?.forceLineTwoStart) {
      if (selectionStart !== lineTwoStart || selectionEnd !== lineTwoStart) {
        target.setSelectionRange(lineTwoStart, lineTwoStart);
      }
      return;
    }
    if (selectionStart < lineTwoStart || selectionEnd < lineTwoStart) {
      target.setSelectionRange(Math.max(selectionStart, lineTwoStart), Math.max(selectionEnd, lineTwoStart));
    }
  }, [lockedImageStudioPromptPrefix]);
  const hasSingleImageAttachment = images.length === 1;
  const hasMultiImageAttachment = images.length > 1;
  const attachmentModeToggleKind = useMemo<"create" | "edit" | null>(() => {
    if (!images.length) return null;
    if (accountPlanId === "premium_plus") {
      if (editModeActive) return "create";
      return "edit";
    }
    if (accountPlanId === "premium") {
      if (createModeActive) return null;
      return "create";
    }
    return null;
  }, [accountPlanId, createModeActive, editModeActive, images.length]);
  const shouldFloatComposerMenu = (
    isPhoneLayout
    && openComposerMenu !== null
    && floatingComposerMenuAnchor?.menu === openComposerMenu
  );
  const shouldPortalComposerMenu = isPhoneLayout && openComposerMenu !== null;
  const floatingComposerMenuStyle = useMemo<CSSProperties | undefined>(() => {
    if (!shouldFloatComposerMenu || !floatingComposerMenuAnchor) return undefined;
    return {
      position: "fixed",
      left: `${floatingComposerMenuAnchor.left}px`,
      bottom: `${floatingComposerMenuAnchor.bottom}px`,
      width: `${floatingComposerMenuAnchor.width}px`,
      minWidth: `${floatingComposerMenuAnchor.width}px`,
      maxWidth: `${floatingComposerMenuAnchor.width}px`,
      maxHeight: floatingComposerMenuAnchor.maxHeight > 0 ? `${floatingComposerMenuAnchor.maxHeight}px` : undefined,
      zIndex: 2147483400,
    };
  }, [floatingComposerMenuAnchor, shouldFloatComposerMenu]);
  const shouldFloatAgentModeMenu = shouldFloatComposerMenu && openComposerMenu === "agent_mode";
  const floatingAgentModeMenuStyle = useMemo<CSSProperties | undefined>(
    () => (shouldFloatAgentModeMenu ? floatingComposerMenuStyle : undefined),
    [floatingComposerMenuStyle, shouldFloatAgentModeMenu]
  );
  const renderInstalledCenterAgentRow = useCallback((agent: CenterRuntimeAgentOption, keyPrefix: string) => {
    const isOn = selectedInstalledAgentOption?.id === agent.id
      && selectedInstalledAgentOption?.actionKey === agent.actionKey;
    const metaLabel = describeCenterAgentMeta(agent);
    return (
      <div
        key={`${keyPrefix}-${agent.id}`}
        role="menuitemradio"
        aria-checked={isOn}
        tabIndex={0}
        className={[
          styles.iconMenuItem,
          styles.centerAgentModeMenuItem,
          isOn ? styles.centerAgentModeMenuItemOn : "",
        ].filter(Boolean).join(" ")}
        onClick={() => selectAgentModeOption(agent)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectAgentModeOption(agent);
        }}
        title={agent.summary || agent.name}
      >
        <span className={styles.centerAgentModeMenuLead}>
          <Image
            src={agent.iconSrc}
            alt=""
            width={18}
            height={18}
            unoptimized
            loading="eager"
            data-agent-id={agent.id}
            className={styles.centerAgentModeMenuIcon}
          />
          <span className={styles.centerAgentModeMenuLabelWrap}>
            <span className={styles.centerAgentModeMenuLabel}>{agent.name}</span>
            {metaLabel ? <span className={styles.centerAgentModeMenuMeta}>{metaLabel}</span> : null}
          </span>
        </span>
        <span className={styles.centerAgentModeMenuActionWrap}>
          <button
            type="button"
            className={styles.centerAgentModeManageBtn}
            aria-label={`Manage ${agent.name}`}
            title={`Manage ${agent.name}`}
            onClick={(event) => {
              event.stopPropagation();
              setAgentModeManageAgentId((prev) => (prev === agent.id ? "" : agent.id));
            }}
          >
            <svg
              className={styles.centerAgentModeManageCheck}
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M3.25 8.5L6.5 11.75L12.75 4.75"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <svg
              className={styles.centerAgentModeManageDots}
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
              <circle cx="8" cy="8" r="1.2" fill="currentColor" />
              <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
            </svg>
          </button>
          {agentModeManageAgentId === agent.id ? (
            <div
              className={styles.centerAgentModeManageMenu}
              role="menu"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={styles.centerAgentModeManageMenuItem}
                onClick={(event) => {
                  event.stopPropagation();
                  uninstallAgentFromMenu(agent.id);
                }}
              >
                Uninstall
              </button>
              {agent.source === "custom" ? (
                <>
                  <button
                    type="button"
                    className={styles.centerAgentModeManageMenuItem}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveCustomAgentSurface(agent.id, "cavcode");
                    }}
                    disabled={agent.surface === "cavcode"}
                  >
                    Move to Caven
                  </button>
                  <button
                    type="button"
                    className={styles.centerAgentModeManageMenuItem}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveCustomAgentSurface(agent.id, "center");
                    }}
                    disabled={agent.surface === "center"}
                  >
                    Move to CavAi
                  </button>
                  <button
                    type="button"
                    className={styles.centerAgentModeManageMenuItem}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveCustomAgentSurface(agent.id, "all");
                    }}
                    disabled={agent.surface === "all"}
                  >
                    Move to All Surfaces
                  </button>
                  <button
                    type="button"
                    className={[styles.centerAgentModeManageMenuItem, styles.centerAgentModeManageMenuItemDanger].join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteCustomAgent(agent.id);
                    }}
                  >
                    Delete Agent
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </span>
      </div>
    );
  }, [
    agentModeManageAgentId,
    deleteCustomAgent,
    describeCenterAgentMeta,
    moveCustomAgentSurface,
    selectAgentModeOption,
    selectedInstalledAgentOption,
    uninstallAgentFromMenu,
  ]);

  const renderAvailableCenterAgentRow = useCallback((agent: CenterRuntimeAgentOption, keyPrefix: string) => {
    const busy = savingAgentId === agent.id;
    const metaLabel = describeCenterAgentMeta(agent);
    return (
      <button
        key={`${keyPrefix}-${agent.id}`}
        type="button"
        role="menuitem"
        className={[
          styles.iconMenuItem,
          styles.centerAgentModeMenuItem,
        ].filter(Boolean).join(" ")}
        onClick={() => {
          void toggleAgentInstalled(agent.id, true);
        }}
        disabled={busy}
        aria-label={busy ? `Installing ${agent.name}` : `Install ${agent.name}`}
        title={agent.summary || agent.name}
      >
        <span className={styles.centerAgentModeMenuLead}>
          <Image
            src={agent.iconSrc}
            alt=""
            width={18}
            height={18}
            unoptimized
            loading="eager"
            data-agent-id={agent.id}
            className={styles.centerAgentModeMenuIcon}
          />
          <span className={styles.centerAgentModeMenuLabelWrap}>
            <span className={styles.centerAgentModeMenuLabel}>{agent.name}</span>
            {metaLabel ? <span className={styles.centerAgentModeMenuMeta}>{metaLabel}</span> : null}
          </span>
        </span>
        <span className={styles.centerAgentModeMenuAction} aria-hidden="true">
          {busy ? (
            "..."
          ) : (
            <Image
              src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
              alt=""
              width={14}
              height={14}
              unoptimized
              className={styles.centerAgentModeMenuActionIcon}
            />
          )}
        </span>
      </button>
    );
  }, [describeCenterAgentMeta, savingAgentId, toggleAgentInstalled]);

  const renderComposerMenuLayer = useCallback((args: {
    menu: Exclude<ComposerMenu, null>;
    className: string;
    ariaLabel: string;
    children: ReactNode;
    style?: CSSProperties;
  }) => {
    if (shouldPortalComposerMenu && args.menu !== openComposerMenu) return null;
    if (shouldPortalComposerMenu && !shouldFloatComposerMenu) return null;
    const menuNode = (
      <>
        {shouldFloatComposerMenu ? (
          <button
            type="button"
            className={styles.centerAgentModeFloatingBackdrop}
            onClick={() => setOpenComposerMenu(null)}
            aria-label="Close composer menu"
          />
        ) : null}
        <div
          ref={shouldFloatComposerMenu ? floatingComposerMenuRef : undefined}
          className={args.className}
          role="menu"
          aria-label={args.ariaLabel}
          style={shouldFloatComposerMenu ? (args.style || floatingComposerMenuStyle) : undefined}
        >
          {args.children}
        </div>
      </>
    );
    if (shouldFloatComposerMenu && typeof document !== "undefined") {
      return createPortal(menuNode, document.body);
    }
    return menuNode;
  }, [floatingComposerMenuStyle, openComposerMenu, shouldFloatComposerMenu, shouldPortalComposerMenu]);

  const composerContent = (
    <>
      <div className={styles.centerComposerInputShell}>
        {showComposerPresetPill && selectedImagePreset ? (
          <div className={styles.centerComposerPresetLockWrap}>
            <div className={styles.centerComposerPresetRow}>
              <button
                type="button"
                className={[
                  styles.centerAgentModeBtn,
                  styles.centerAgentModeBtnSelected,
                  styles.centerQuickModeToolbarBtn,
                  styles.centerComposerPresetModePill,
                  presetPillModeClass,
                ].join(" ")}
                onClick={clearSelectedImageStudioPreset}
                aria-label={`Remove ${selectedImagePreset.label} preset`}
                title="Clear preset"
              >
                <span
                  className={[styles.centerWebResearchGlyph, presetPillGlyphClass].join(" ")}
                  aria-hidden="true"
                />
                <span className={styles.centerAgentModeLabel}>{selectedImagePreset.label}</span>
              </button>
            </div>
          </div>
        ) : null}
        {showComposerImageChips ? (
          <div
            className={[
              styles.centerAttachmentsRow,
              hasSingleImageAttachment ? styles.centerAttachmentsRowSingle : "",
              hasMultiImageAttachment ? styles.centerAttachmentsRowMulti : "",
            ].filter(Boolean).join(" ")}
          >
            {images.map((image, imageIndex) => (
              <div
                key={`composer-image-${s(image.id) || "unknown"}-${imageIndex}`}
                className={[
                  styles.centerAttachmentChip,
                  hasSingleImageAttachment ? styles.centerAttachmentChipSingle : "",
                  hasMultiImageAttachment ? styles.centerAttachmentChipCompact : "",
                  image.uploading ? styles.centerAttachmentChipUploading : "",
                ].filter(Boolean).join(" ")}
              >
                <button
                  type="button"
                  className={[
                    styles.centerAttachmentPreviewBtn,
                    image.uploading ? styles.centerAttachmentPreviewBtnDisabled : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => openComposerImageViewer(image)}
                  disabled={image.uploading === true}
                  aria-label={`Open ${image.name}`}
                >
                  <Image
                    src={image.dataUrl}
                    alt={image.name}
                    width={hasSingleImageAttachment ? 132 : 52}
                    height={hasSingleImageAttachment ? 132 : 52}
                    unoptimized
                    className={[
                      styles.centerAttachmentPreview,
                      hasSingleImageAttachment ? styles.centerAttachmentPreviewSingle : "",
                      hasMultiImageAttachment ? styles.centerAttachmentPreviewCompact : "",
                    ].filter(Boolean).join(" ")}
                  />
                </button>
                {!image.uploading ? (
                  <div
                    className={[
                      styles.centerAttachmentActions,
                      hasSingleImageAttachment ? styles.centerAttachmentActionsSingle : "",
                      hasMultiImageAttachment ? styles.centerAttachmentActionsCompact : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {attachmentModeToggleKind ? (
                      <button
                        type="button"
                        className={[
                          styles.centerAttachmentActionBtn,
                          hasMultiImageAttachment ? styles.centerAttachmentActionBtnCompact : "",
                        ].filter(Boolean).join(" ")}
                        onClick={() => onAttachmentModeToggle(image, attachmentModeToggleKind)}
                        aria-label={
                          attachmentModeToggleKind === "edit"
                            ? `Switch ${image.name} to edit mode`
                            : `Switch ${image.name} to create mode`
                        }
                        title={attachmentModeToggleKind === "edit" ? "Switch to Edit image" : "Switch to Create image"}
                      >
                        <span
                          className={[
                            styles.centerWebResearchGlyph,
                            attachmentModeToggleKind === "edit"
                              ? styles.centerWebResearchGlyphEditImage
                              : styles.centerWebResearchGlyphCreateImage,
                            styles.centerAttachmentModeToggleGlyph,
                          ].join(" ")}
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={[
                        styles.centerAttachmentRemove,
                        hasSingleImageAttachment ? styles.centerAttachmentRemoveSingle : "",
                        hasMultiImageAttachment ? styles.centerAttachmentRemoveCompact : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => removeComposerImage(image.id)}
                      aria-label={`Remove ${image.name}`}
                    >
                      <span className={styles.centerAttachmentRemoveGlyph} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                {image.uploading ? (
                  <span className={styles.centerAttachmentUploadOverlay} aria-hidden="true">
                    <span className={styles.centerAttachmentUploadRing} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {showComposerFileChips ? (
          <div className={styles.attachmentsRow}>
            {uploadedFiles.map((file) => (
              <div
                key={`composer-file-${file.id}`}
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
                  onClick={() => openComposerUploadedFile(file)}
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
                    onClick={() => removeComposerUploadedFile(file.id)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <span className={styles.attachmentRemoveGlyph} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles.centerComposerInputWrap}>
          <textarea
            ref={composerInputRef}
            className={[
              styles.centerComposerInput,
              showComposerAttachmentChips ? styles.centerComposerInputWithMedia : "",
              showComposerPresetInlineLearnMore ? styles.centerComposerInputActivationOverlayMode : "",
              shouldSuppressComposerPlaceholder ? styles.centerComposerInputPlaceholderSuppressed : "",
            ].filter(Boolean).join(" ")}
            value={prompt}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              if (lockImageStudioPromptLine && selectedImagePresetActivationLine) {
                const userText = extractImageStudioUserTextFromLockedPrompt(nextValue, selectedImagePresetActivationLine);
                setPrompt(buildLockedImageStudioPrompt(selectedImagePresetActivationLine, userText));
              } else {
                setPrompt(nextValue);
              }
              syncComposerInputHeight();
            }}
            onFocus={(event) => ensureImageStudioPromptCaret(event.currentTarget, { forceLineTwoStart: true })}
            onClick={(event) => ensureImageStudioPromptCaret(event.currentTarget)}
            onMouseUp={(event) => ensureImageStudioPromptCaret(event.currentTarget)}
            onSelect={(event) => ensureImageStudioPromptCaret(event.currentTarget)}
            onKeyDown={(event) => {
              if (lockedImageStudioPromptPrefix) {
                const lineTwoStart = lockedImageStudioPromptPrefix.length;
                const selectionStart = event.currentTarget.selectionStart ?? lineTwoStart;
                const selectionEnd = event.currentTarget.selectionEnd ?? lineTwoStart;
                const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
                const directTextInput = (event.key.length === 1 || event.key === "Enter") && !hasModifier;
                if (
                  selectionStart < lineTwoStart
                  || selectionEnd < lineTwoStart
                ) {
                  event.currentTarget.setSelectionRange(lineTwoStart, lineTwoStart);
                  if (!directTextInput) {
                    event.preventDefault();
                    return;
                  }
                }
                const clampedStart = event.currentTarget.selectionStart ?? lineTwoStart;
                const clampedEnd = event.currentTarget.selectionEnd ?? lineTwoStart;
                const atBoundary = clampedStart <= lineTwoStart && clampedEnd <= lineTwoStart;
                if (
                  atBoundary
                  && (event.key === "Backspace"
                    || event.key === "ArrowLeft"
                    || event.key === "ArrowUp"
                    || event.key === "Home"
                    || event.key === "PageUp")
                ) {
                  event.preventDefault();
                  event.currentTarget.setSelectionRange(
                    lineTwoStart,
                    lineTwoStart
                  );
                  return;
                }
              }
              onComposerKeyDown(event);
            }}
            placeholder={shouldSuppressComposerPlaceholder ? "" : promptPlaceholder}
          />
          {showComposerPresetInlineLearnMore ? (
            <span className={styles.centerComposerPromptInlineLearnMoreAnchor}>
              <span className={styles.centerComposerPromptInlineLearnMoreText} aria-hidden="true">
                {selectedImagePresetActivationLine}
              </span>
              <button
                type="button"
                className={styles.centerComposerPromptInlineLearnMoreBtn}
                onClick={() => setImageStudioPresetLockModalOpen(true)}
              >
                Learn more
              </button>
            </span>
          ) : null}
        </div>

        <div className={styles.centerComposerFooter} ref={composerControlsRef}>
          <div className={styles.centerComposerLeftTools}>
            <div className={styles.iconMenuWrap}>
              <button
                ref={quickActionsTriggerRef}
                type="button"
                className={[styles.actionBtn, styles.iconActionBtn, styles.centerComposerIconBtn, styles.menuTriggerBtn].join(" ")}
                onClick={() => {
                  setOpenHeaderModelMenu(false);
                  setOpenComposerMenu((prev) => (prev === "quick_actions" ? null : "quick_actions"));
                }}
                title="Open quick actions"
                aria-label="Open quick actions"
                aria-haspopup="menu"
                aria-expanded={openComposerMenu === "quick_actions"}
              >
                <CenterPlusGlyph className={[styles.centerInlineGlyph, styles.centerInlineGlyph18].join(" ")} />
              </button>
              {openComposerMenu === "quick_actions" ? (
                renderComposerMenuLayer({
                  menu: "quick_actions",
                  className: [styles.iconMenu, styles.centerQuickActionsMenu].join(" "),
                  ariaLabel: "Quick actions",
                  children: quickActionItems.map((item) => (
                    <button
                      key={`quick-action-${item.id}`}
                      type="button"
                      role="menuitem"
                      className={[
                        styles.iconMenuItem,
                        styles.centerQuickActionMenuItem,
                        item.locked ? styles.centerQuickActionMenuItemLocked : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => applyQuickAction(item.id)}
                      disabled={item.locked}
                    >
                      <span className={styles.centerQuickActionMenuLead}>
                        {item.id === "deep_research" || item.id === "create_image" || item.id === "edit_image" || item.id === "recent_files" || item.id === "add_files" || item.id === "upload_from_cavcloud" ? (
                          <span
                            className={[
                              styles.centerQuickActionMenuGlyph,
                              item.id === "deep_research"
                                ? styles.centerQuickActionMenuGlyphDeepResearch
                              : item.id === "create_image"
                                ? styles.centerQuickActionMenuGlyphCreateImage
                              : item.id === "edit_image"
                                ? styles.centerQuickActionMenuGlyphEditImage
                                  : item.id === "upload_from_cavcloud"
                                    ? styles.centerQuickActionMenuGlyphUploadFromCavCloud
                                    : item.id === "recent_files"
                                      ? styles.centerQuickActionMenuGlyphRecentFiles
                                      : styles.centerQuickActionMenuGlyphAddFiles,
                            ].join(" ")}
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className={styles.centerQuickActionMenuText}>
                          <span className={styles.centerQuickActionMenuLabel}>{item.label}</span>
                        </span>
                      </span>
                      {item.locked ? (
                        <span className={styles.centerQuickActionMenuLock}>
                          <LockIcon width={12} height={12} aria-hidden="true" />
                        </span>
                      ) : null}
                    </button>
                  )),
                })
              ) : null}
            </div>

            {showComposerModelControl ? (
              <div className={styles.iconMenuWrap}>
                <button
                  ref={composerModelTriggerRef}
                  type="button"
                  className={[styles.actionBtn, styles.iconActionBtn, styles.centerComposerIconBtn, styles.menuTriggerBtn].join(" ")}
                  onClick={() => setOpenComposerMenu((prev) => (prev === "model" ? null : "model"))}
                  aria-label={selectedModelLabel}
                  aria-haspopup="menu"
                  aria-expanded={openComposerMenu === "model"}
                  title={selectedModelLabel}
                >
                  <CenterModelGlyph className={[styles.centerInlineGlyph, styles.centerInlineGlyph18].join(" ")} />
                </button>
                {openComposerMenu === "model" ? (
                  renderComposerMenuLayer({
                    menu: "model",
                    className: styles.iconMenu,
                    ariaLabel: "Model selector",
                    children: modelMenuOptions.map((option) => {
                      const isOn = selectedModel === option.id;
                      const locked = option.locked === true;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isOn}
                          className={[
                            styles.iconMenuItem,
                            isOn ? styles.iconMenuItemOn : "",
                            locked ? styles.iconMenuItemLocked : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => {
                            if (locked) {
                              setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
                              return;
                            }
                            applyModelSelection(option.id);
                            setOpenComposerMenu(null);
                          }}
                          title={locked ? `${option.label} · User only (sign in)` : option.label}
                        >
                          <span className={styles.iconMenuItemLabel}>{option.label}</span>
                          {locked ? (
                            <span className={styles.iconMenuLockTag}>
                              <LockIcon width={12} height={12} aria-hidden="true" />
                            </span>
                          ) : null}
                        </button>
                      );
                    }),
                  })
                ) : null}
              </div>
            ) : null}

            {showComposerReasoningControl ? (
              <div className={styles.iconMenuWrap}>
                <button
                  ref={composerReasoningTriggerRef}
                  type="button"
                  className={[styles.actionBtn, styles.iconActionBtn, styles.centerComposerIconBtn, styles.menuTriggerBtn].join(" ")}
                  onClick={() => setOpenComposerMenu((prev) => (prev === "reasoning" ? null : "reasoning"))}
                  aria-label={selectedReasoningLabel}
                  aria-haspopup="menu"
                  aria-expanded={openComposerMenu === "reasoning"}
                  title={selectedReasoningLabel}
                >
                  <CenterReasoningGlyph className={[styles.centerInlineGlyph, styles.centerInlineGlyph18].join(" ")} />
                </button>
                {openComposerMenu === "reasoning" ? (
                  renderComposerMenuLayer({
                    menu: "reasoning",
                    className: styles.iconMenu,
                    ariaLabel: "Reasoning options",
                    children: reasoningMenuOptions.map((option) => {
                      const isOn = reasoningLevel === option.value;
                      const locked = option.locked === true;
                      const helper = toReasoningDisplayHelper(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isOn}
                          className={[
                            styles.iconMenuItem,
                            isOn ? styles.iconMenuItemOn : "",
                            locked ? styles.iconMenuItemLocked : "",
                          ].filter(Boolean).join(" ")}
                          onClick={() => {
                            if (locked) {
                              setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
                              return;
                            }
                            setReasoningLevel(option.value);
                            setOpenComposerMenu(null);
                          }}
                          title={locked ? `${option.label} · User only (sign in)` : (helper ? `${option.label}: ${helper}` : option.label)}
                        >
                          <span className={styles.iconMenuItemLabel}>{option.label}</span>
                          {locked ? (
                            <span className={styles.iconMenuLockTag}>
                              <LockIcon width={12} height={12} aria-hidden="true" />
                            </span>
                          ) : null}
                        </button>
                      );
                    }),
                  })
                ) : null}
              </div>
            ) : null}

            {activeToolbarQuickMode ? (
              activeToolbarQuickMode === "create_image" || activeToolbarQuickMode === "edit_image" ? null : (
                <button
                  type="button"
                  className={[
                    styles.centerWebResearchBtn,
                    styles.centerWebResearchBtnOn,
                    styles.centerQuickModeToolbarBtn,
                  ].filter(Boolean).join(" ")}
                  aria-label={`Disable ${activeToolbarQuickModeLabel}`}
                  aria-pressed="true"
                  title={`Disable ${activeToolbarQuickModeLabel}`}
                  onClick={clearActiveToolbarQuickMode}
                >
                  <span
                    className={[
                      styles.centerWebResearchGlyph,
                      activeToolbarQuickModeGlyphClass,
                    ].join(" ")}
                    aria-hidden="true"
                  />
                  <span className={styles.centerWebResearchLabel}>{activeToolbarQuickModeLabel}</span>
                </button>
              )
            ) : null}

            <div className={styles.iconMenuWrap}>
              <button
                ref={agentModeTriggerRef}
                type="button"
                className={[
                  styles.centerAgentModeBtn,
                  openComposerMenu === "agent_mode" || agentModeActive ? styles.centerAgentModeBtnOn : "",
                  agentModeActive ? styles.centerQuickModeToolbarBtn : "",
                  agentModeActive ? styles.centerAgentModeBtnSelected : "",
                ].filter(Boolean).join(" ")}
                onClick={agentModeActive ? clearAgentModeSelection : toggleAgentModeMenu}
                aria-pressed={openComposerMenu === "agent_mode" || agentModeActive}
                aria-label={agentModeActive && activeAgentName ? `Disable Agent Mode (${activeAgentName})` : "Open Agent Mode"}
                aria-haspopup={agentModeActive ? undefined : "menu"}
                aria-expanded={agentModeActive ? undefined : openComposerMenu === "agent_mode"}
                title={agentModeActive && activeAgentName ? `Disable Agent Mode (${activeAgentName})` : "Agent Mode"}
              >
                <span className={styles.centerAgentModeGlyph} aria-hidden="true">
                  <CenterAgentGlyph className={styles.centerAgentModeGlyphIcon} />
                  <CenterCloseGlyph className={styles.centerAgentModeGlyphClose} />
                </span>
                <span className={styles.centerAgentModeLabel}>
                  {agentModeActive && activeAgentName ? activeAgentName : "Agent Mode"}
                </span>
                {!hasAnyCenterAgentOptions ? <span className={styles.centerAgentModeCount}>0</span> : null}
              </button>
              {openComposerMenu === "agent_mode" ? (
                renderComposerMenuLayer({
                  menu: "agent_mode",
                  className: [
                    styles.iconMenu,
                    styles.centerAgentModeMenu,
                    shouldFloatAgentModeMenu ? styles.centerAgentModeMenuFloating : "",
                  ].filter(Boolean).join(" "),
                  ariaLabel: `Agent Mode (${centerLegacyAgentBankLabel})`,
                  style: floatingAgentModeMenuStyle,
                  children: (
                    <>
                  <div className={styles.centerAgentModeSearch} role="search">
                    <span className={styles.centerAgentModeSearchGlyph} aria-hidden="true" />
                    <input
                      type="text"
                      value={agentModeQuery}
                      onChange={(event) => setAgentModeQuery(event.currentTarget.value)}
                      className={styles.centerAgentModeSearchInput}
                      placeholder="Search agents"
                      aria-label="Search agents"
                      inputMode="search"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>

                  <div className={styles.centerAgentModeScroll}>
                  <details className={styles.centerAgentModeSection} aria-label="Installed agents">
                    <summary className={styles.centerAgentModeSectionHead}>
                      <span className={styles.centerAgentModeSectionTitle}>Installed</span>
                      <span className={styles.centerAgentModeSectionMeta}>{visibleInstalledCenterAgents.length}</span>
                    </summary>
                    {visibleInstalledCenterAgents.length ? (
                      <>
                        {installedMyAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Installed private agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>My Agents</summary>
                            {installedMyAgents.map((agent) => renderInstalledCenterAgentRow(agent, "installed-my"))}
                          </details>
                        ) : null}
                        {installedPublishedCenterAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Installed published operator agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>Published by other operators</summary>
                            {installedPublishedCenterAgents.map((agent) => renderInstalledCenterAgentRow(agent, "installed-published"))}
                          </details>
                        ) : null}
                        {installedCavAiAgents.length ? (
                          <details
                            className={styles.centerAgentModeFamilyGroup}
                            open
                            aria-label={`Installed ${centerPrimarySectionLabel} (${centerPrimaryFamilyLabel})`}
                          >
                            <summary className={styles.centerAgentModeFamilyTitle}>{centerPrimarySectionLabel}</summary>
                            {installedCavAiAgents.map((agent) => renderInstalledCenterAgentRow(agent, "installed-primary"))}
                          </details>
                        ) : null}
                        {installedCavenAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Installed Caven agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>Caven</summary>
                            {installedCavenAgents.map((agent) => renderInstalledCenterAgentRow(agent, "installed-caven"))}
                          </details>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.centerAgentModeEmpty}>
                        {normalizedAgentModeQuery ? "No installed agents match search." : "No installed agents yet."}
                      </span>
                    )}
                  </details>

                  <details className={styles.centerAgentModeSection} aria-label="Available agents">
                    <summary className={styles.centerAgentModeSectionHead}>
                      <span className={styles.centerAgentModeSectionTitle}>Available</span>
                      <span className={styles.centerAgentModeSectionMeta}>{visibleAvailableCenterAgentBank.length}</span>
                    </summary>
                    {visibleAvailableCenterAgentBank.length ? (
                      <>
                        {bankMyAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Available private agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>My Agents</summary>
                            {bankMyAgents.map((agent) => renderAvailableCenterAgentRow(agent, "available-my"))}
                          </details>
                        ) : null}
                        {bankPublishedCenterAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Available published operator agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>Published by other operators</summary>
                            {bankPublishedCenterAgents.map((agent) => renderAvailableCenterAgentRow(agent, "available-published"))}
                          </details>
                        ) : null}
                        {bankCavAiAgents.length ? (
                          <details
                            className={styles.centerAgentModeFamilyGroup}
                            open
                            aria-label={`Available ${centerPrimarySectionLabel} (${centerPrimaryFamilyLabel})`}
                          >
                            <summary className={styles.centerAgentModeFamilyTitle}>{centerPrimarySectionLabel}</summary>
                            {bankCavAiAgents.map((agent) => renderAvailableCenterAgentRow(agent, "available-primary"))}
                          </details>
                        ) : null}
                        {bankCavenAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Available Caven agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>Caven</summary>
                            {bankCavenAgents.map((agent) => renderAvailableCenterAgentRow(agent, "available-caven"))}
                          </details>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.centerAgentModeEmpty}>
                        {normalizedAgentModeQuery
                          ? "No available agents match search."
                          : "All eligible agents are installed."}
                      </span>
                    )}
                  </details>

                  <details className={styles.centerAgentModeSection} aria-label="Locked agents">
                    <summary className={styles.centerAgentModeSectionHead}>
                      <span className={styles.centerAgentModeSectionTitle}>Locked</span>
                      <span className={styles.centerAgentModeSectionMeta}>{visibleLockedCenterAgents.length}</span>
                    </summary>
                    {visibleLockedCenterAgents.length ? (
                      <>
                        {lockedCavAiAgents.length ? (
                          <details
                            className={styles.centerAgentModeFamilyGroup}
                            open
                            aria-label={`Locked ${centerPrimarySectionLabel} (${centerPrimaryFamilyLabel})`}
                          >
                            <summary className={styles.centerAgentModeFamilyTitle}>{centerPrimarySectionLabel}</summary>
                            {lockedCavAiAgents.map((agent) => (
                              <div
                                key={`agent-locked-${agent.id}`}
                                className={styles.centerAgentModeLockedRow}
                                title={agent.summary || agent.name}
                              >
                                <span className={styles.centerAgentModeMenuLead}>
                                  <Image
                                    src={agent.iconSrc}
                                    alt=""
                                    width={18}
                                    height={18}
                                    unoptimized
                                    loading="eager"
                                    data-agent-id={agent.id}
                                    className={styles.centerAgentModeMenuIcon}
                                  />
                                  <span className={styles.centerAgentModeMenuLabelWrap}>
                                    <span className={styles.centerAgentModeMenuLabel}>{agent.name}</span>
                                  </span>
                                </span>
                                <span className={styles.centerAgentModeLockedMeta}>
                                  <Link href="/plan" className={styles.centerAgentModeUpgradeCta}>
                                    <LockIcon width={14} height={14} aria-hidden="true" />
                                  </Link>
                                </span>
                              </div>
                            ))}
                          </details>
                        ) : null}
                        {lockedCavenAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Locked Caven agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>Caven</summary>
                            {lockedCavenAgents.map((agent) => (
                              <div
                                key={`agent-locked-${agent.id}`}
                                className={styles.centerAgentModeLockedRow}
                                title={agent.summary || agent.name}
                              >
                                <span className={styles.centerAgentModeMenuLead}>
                                  <Image
                                    src={agent.iconSrc}
                                    alt=""
                                    width={18}
                                    height={18}
                                    unoptimized
                                    loading="eager"
                                    data-agent-id={agent.id}
                                    className={styles.centerAgentModeMenuIcon}
                                  />
                                  <span className={styles.centerAgentModeMenuLabelWrap}>
                                    <span className={styles.centerAgentModeMenuLabel}>{agent.name}</span>
                                  </span>
                                </span>
                                <span className={styles.centerAgentModeLockedMeta}>
                                  <Link href="/plan" className={styles.centerAgentModeUpgradeCta}>
                                    <LockIcon width={14} height={14} aria-hidden="true" />
                                  </Link>
                                </span>
                              </div>
                            ))}
                          </details>
                        ) : null}
                        {isGuestPreviewMode && lockedCompanionAgents.length ? (
                          <details className={styles.centerAgentModeFamilyGroup} open aria-label="Locked CavBot Companion agents">
                            <summary className={styles.centerAgentModeFamilyTitle}>CavBot Companion</summary>
                            {lockedCompanionAgents.map((agent) => (
                              <div
                                key={`agent-locked-${agent.id}`}
                                className={styles.centerAgentModeLockedRow}
                                title={agent.summary || agent.name}
                              >
                                <span className={styles.centerAgentModeMenuLead}>
                                  <Image
                                    src={agent.iconSrc}
                                    alt=""
                                    width={18}
                                    height={18}
                                    unoptimized
                                    loading="eager"
                                    data-agent-id={agent.id}
                                    className={styles.centerAgentModeMenuIcon}
                                  />
                                  <span className={styles.centerAgentModeMenuLabelWrap}>
                                    <span className={styles.centerAgentModeMenuLabel}>{agent.name}</span>
                                  </span>
                                </span>
                                <span className={styles.centerAgentModeLockedMeta}>
                                  <Link href="/plan" className={styles.centerAgentModeUpgradeCta}>
                                    <LockIcon width={14} height={14} aria-hidden="true" />
                                  </Link>
                                </span>
                              </div>
                            ))}
                          </details>
                        ) : null}
                      </>
                    ) : (
                      <span className={styles.centerAgentModeEmpty}>
                        {normalizedAgentModeQuery
                          ? "No locked agents match search."
                          : "No locked agents on your current plan."}
                      </span>
                    )}
                  </details>
                  </div>
                    </>
                  ),
                })
              ) : null}
            </div>

          </div>

          <div className={styles.centerComposerRightTools}>
            {isGuestPreviewMode ? (
              <button
                ref={composerAudioTriggerRef}
                type="button"
                className={[
                  styles.actionBtn,
                  styles.iconActionBtn,
                  styles.centerComposerIconBtn,
                  styles.centerComposerAudioBtn,
                ].join(" ")}
                onClick={() => setError("Dictate is locked in guest preview. Sign in to unlock voice input.")}
                aria-label="Dictate · User only (sign in)"
                title="Dictate · User only (sign in)"
              >
                <CenterAudioGlyph className={[styles.centerInlineGlyph, styles.centerInlineGlyph18].join(" ")} />
              </button>
            ) : null}
            {!isGuestPreviewMode ? (
              <button
                ref={composerAudioTriggerRef}
                type="button"
                className={[
                  styles.actionBtn,
                  styles.iconActionBtn,
                  styles.centerComposerIconBtn,
                  styles.centerComposerAudioBtn,
                ].join(" ")}
                onClick={onComposerDictateAction}
                aria-label={dictateCaptureActive ? "Stop dictate" : "Dictate"}
                title={dictateCaptureActive ? "Stop Dictate" : "Dictate"}
                disabled={speakCaptureActive || (!dictateCaptureActive && (processingVoice || transcribingAudio || submitting))}
              >
                <CenterAudioGlyph className={[styles.centerInlineGlyph, styles.centerInlineGlyph18].join(" ")} />
              </button>
            ) : null}

            <button
              type="button"
              className={[
                styles.primaryBtn,
                styles.centerComposerSendBtn,
                submitting ? styles.primaryBtnStop : "",
                submitting ? styles.centerComposerSendBtnStop : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={onComposerPrimaryAction}
              aria-label={
                submitting
                  ? "Stop CavAi prompt"
                  : isGuestPreviewMode
                    ? "Send prompt to CavAi"
                  : speakCaptureActive
                    ? "Stop speak"
                    : promptHasTypedInput
                      ? "Send prompt to CavAi"
                      : "Speak"
              }
              title={
                submitting
                  ? "Stop"
                  : isGuestPreviewMode
                    ? "Send"
                  : speakCaptureActive
                    ? "Stop Speak"
                    : promptHasTypedInput
                      ? "Send"
                      : "Speak"
              }
              disabled={dictateCaptureActive || processingVoice || (isGuestPreviewMode && !promptHasTypedInput)}
            >
              <span
                className={[
                  styles.primaryBtnGlyph,
                  submitting || speakCaptureActive
                    ? styles.primaryBtnGlyphStop
                    : promptHasTypedInput || isGuestPreviewMode
                      ? styles.primaryBtnGlyphRun
                      : styles.primaryBtnGlyphVoice,
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>

      {voiceStatus ? (
        <div className={styles.voiceStatusBar} role="status" aria-live="polite">
          <span className={styles.voiceStatusDot} aria-hidden="true" />
          <span className={styles.voiceStatusLabel}>{voiceStatus.label}</span>
          <span className={styles.voiceStatusDetail}>{voiceStatus.detail}</span>
        </div>
      ) : null}

      {canUseCreateImage && !overlay && (composerQuickMode === "create_image" || composerQuickMode === "edit_image") ? (
        <section className={styles.imageStudioModePanel} aria-label="Image Studio presets">
          {composerQuickMode === "edit_image" && images[0] ? (
            <div className={styles.imageStudioSourcePreview}>
              <Image
                src={images[0].dataUrl}
                alt=""
                width={52}
                height={52}
                unoptimized
                className={styles.imageStudioSourcePreviewImage}
              />
              <div className={styles.imageStudioSourcePreviewMeta}>
                <span className={styles.imageStudioSourcePreviewTitle}>Edit source ready</span>
                <span className={styles.imageStudioSourcePreviewText}>{images[0].name}</span>
              </div>
            </div>
          ) : null}

          <div className={styles.imageStudioPresetShelf}>
            <div className={[styles.imageStudioPresetShelfHead, styles.imageStudioPresetShelfHeadNoTitle].join(" ")}>
              <div className={styles.imageStudioPresetShelfNav}>
                <button
                  type="button"
                  className={styles.imageStudioPresetShelfNavBtn}
                  aria-label="Scroll presets left"
                  onClick={() => scrollImageStudioPresetRail("left")}
                >
                  <span
                    className={[styles.imageStudioPresetShelfNavGlyph, styles.imageStudioPresetShelfNavGlyphLeft].join(" ")}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={styles.imageStudioPresetShelfNavBtn}
                  aria-label="Scroll presets right"
                  onClick={() => scrollImageStudioPresetRail("right")}
                >
                  <span
                    className={[styles.imageStudioPresetShelfNavGlyph, styles.imageStudioPresetShelfNavGlyphRight].join(" ")}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </div>
            <div className={styles.imageStudioPresetRail} ref={imageStudioPresetRailRef}>
              <button
                type="button"
                className={[
                  styles.imageStudioEditTile,
                  !canUseEditImage ? styles.imageStudioEditTileLocked : "",
                ].filter(Boolean).join(" ")}
                onClick={() => {
                  if (!canUseEditImage) return;
                  onImageStudioQuickAction("edit");
                }}
                aria-disabled={!canUseEditImage}
                title={!canUseEditImage ? "Upgrade to Premium+" : undefined}
              >
                <span className={styles.imageStudioEditTileMedia} aria-hidden="true">
                  <Image
                    src="/icons/cavpad/upload-svgrepo-com.svg"
                    alt=""
                    width={28}
                    height={28}
                    unoptimized
                    className={styles.imageStudioEditTileUploadIcon}
                  />
                </span>
                <span className={styles.imageStudioEditTileMeta}>
                  <span className={styles.imageStudioEditTileTitle}>Edit image</span>
                  <span className={styles.imageStudioEditTileText}>Upload or import to transform.</span>
                </span>
              </button>
              {imageStudioPresets.map((preset) => {
                const isOn = selectedImagePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={[
                      styles.imageStudioPresetCard,
                      isOn ? styles.imageStudioPresetCardOn : "",
                      preset.locked ? styles.imageStudioPresetCardLocked : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => applyImageStudioPreset(preset)}
                  >
                    <span className={styles.imageStudioPresetMedia}>
                      {preset.thumbnailUrl ? (
                        <Image
                          src={preset.thumbnailUrl}
                          alt={preset.label}
                          fill
                          sizes="(max-width: 620px) 124px, 136px"
                          unoptimized
                          className={[
                            styles.imageStudioPresetThumb,
                            preset.slug === "realistic-tattoo" ? styles.imageStudioPresetThumbTattooFocus : "",
                          ].filter(Boolean).join(" ")}
                        />
                      ) : (
                        <span className={styles.imageStudioPresetThumbPlaceholder} aria-hidden="true" />
                      )}
                      {preset.locked ? (
                        <span className={styles.imageStudioPresetLockOverlay} aria-hidden="true">
                          <span className={styles.imageStudioPresetLockBadge}>
                            <Image
                              src="/icons/app/block-svgrepo-com.svg"
                              alt=""
                              width={14}
                              height={14}
                              unoptimized
                              className={styles.imageStudioPresetLockBadgeIcon}
                            />
                          </span>
                          <span className={styles.imageStudioPresetLockTooltip}>Premium+ required</span>
                        </span>
                      ) : null}
                    </span>
                    <span className={styles.imageStudioPresetMeta}>
                      <span className={styles.imageStudioPresetLabel}>{preset.label}</span>
                      {preset.subtitle ? <span className={styles.imageStudioPresetSubtitle}>{preset.subtitle}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

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

      <input
        ref={imageStudioImportInputRef}
        type="file"
        accept="image/*"
        className={styles.imageStudioHiddenInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] || null;
          event.currentTarget.value = "";
          if (!file) return;
          void onImageStudioDeviceImport(file);
        }}
      />
    </>
  );

  const activeImageStudioGallery = imageStudioImportSource === "cavsafe" ? imageStudioGallerySafe : imageStudioGalleryCloud;
  const showInlineError = Boolean(error);

  if (!isOpen) return null;

  return (
    <div
      className={overlay ? styles.centerOverlayRoot : styles.centerPageRoot}
      onClick={(event) => {
        if (!overlay) return;
        if (event.currentTarget !== event.target) return;
        props.onClose?.();
      }}
      role={overlay ? "dialog" : "region"}
      aria-modal={overlay ? "true" : undefined}
      aria-label="CavAi"
    >
      <section
        className={[
          styles.centerShell,
          overlay ? styles.centerShellOverlay : styles.centerShellPage,
          !overlay && sidebarCollapsedActive ? styles.centerShellPageSidebarCollapsed : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {!overlay && isPhoneLayout ? (
          <button
            type="button"
            className={[
              styles.centerMobileDrawerBackdrop,
              mobileDrawerOpen ? styles.centerMobileDrawerBackdropOpen : "",
            ].filter(Boolean).join(" ")}
            onClick={closeMobileDrawer}
            aria-label="Close navigation drawer"
            aria-hidden={!mobileDrawerOpen}
            tabIndex={mobileDrawerOpen ? 0 : -1}
          />
        ) : null}

        {!overlay ? (
          <aside
            className={[
              styles.centerSidebar,
              sidebarCollapsedActive ? styles.centerSidebarCollapsed : "",
              mobileDrawerOpen ? styles.centerSidebarMobileOpen : "",
            ].filter(Boolean).join(" ")}
            id="cavai-mobile-drawer"
            aria-label="CavAi conversation history"
            aria-hidden={isPhoneLayout ? !mobileDrawerOpen && !accountMenuOpen : undefined}
          >
            <div className={styles.centerSidebarHead}>
              {sidebarCollapsedActive ? (
                <button
                  type="button"
                  className={styles.centerSidebarCollapsedToggle}
                  aria-label="Open CavAi sidebar"
                  title="Open sidebar"
                  onClick={() => setSidebarCollapsed(false)}
                >
                  <span className={styles.centerSidebarBrandMark} aria-hidden="true" />
                  <span
                    className={[styles.sidebarToggleGlyph, styles.sidebarRightGlyph, styles.centerSidebarCollapsedToggleGlyph].join(" ")}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <>
                  <Link href="/" className={styles.centerSidebarHomeLink} aria-label="Go to CavBot home" title="Home">
                    <span className={styles.centerSidebarBrandMark} aria-hidden="true" />
                  </Link>
                  {isPhoneLayout ? (
                    <button
                      type="button"
                      className={styles.centerSidebarCloseBtn}
                      aria-label="Close navigation drawer"
                      title="Close drawer"
                      onClick={closeMobileDrawer}
                    >
                      <span className={styles.centerGuestAuthCloseGlyph} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.centerSidebarToggleBtn}
                      aria-label="Collapse CavAi sidebar"
                      title="Collapse sidebar"
                      onClick={() => setSidebarCollapsed(true)}
                    >
                      <span className={[styles.sidebarToggleGlyph, styles.sidebarLeftGlyph].join(" ")} aria-hidden="true" />
                    </button>
                  )}
                </>
              )}
            </div>

            <div className={styles.centerSidebarQuickActions}>
              <button
                type="button"
                className={styles.centerSidebarActionBtn}
                onClick={onNewSession}
                aria-label="New chat"
                title="New chat"
              >
                <span className={[styles.centerSidebarActionGlyph, styles.centerSidebarActionGlyphNew].join(" ")} aria-hidden="true" />
                <span className={styles.centerSidebarActionText}>New chat</span>
              </button>
              <button type="button" className={styles.centerSidebarActionBtn} onClick={onFocusSessionSearch} aria-label="Search chats" title="Search chats">
                <span className={[styles.centerSidebarActionGlyph, styles.centerSidebarActionGlyphSearch].join(" ")} aria-hidden="true" />
                <span className={styles.centerSidebarActionText}>Search chats</span>
              </button>
            </div>

            <nav className={styles.centerSidebarSurfaceNav} aria-label="CavAi modules">
              <div id="cavai-modules-list" className={styles.centerSidebarSurfaceNavList}>
                {sidebarSurfaceItems.map((item) => (
                  <Link
                    key={item.surface}
                    href={item.href}
                    className={[styles.centerSidebarNavItem, item.active ? styles.centerSidebarNavItemOn : ""].filter(Boolean).join(" ")}
                    aria-current={item.active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.description}
                    onClick={() => setMobileDrawerOpen(false)}
                  >
                    <span className={[styles.centerSidebarNavGlyph, surfaceNavGlyphClass(item.surface)].join(" ")} aria-hidden="true" />
                    <span className={styles.centerSidebarNavLabel}>{item.label}</span>
                  </Link>
                ))}
              </div>
            </nav>

            {!sidebarCollapsedActive ? (
              <div className={styles.centerSidebarChatsHead}>
                <button
                  type="button"
                  className={styles.centerSidebarSectionToggleBtn}
                  onClick={() => setChatsExpanded((prev) => !prev)}
                  aria-expanded={chatsExpanded}
                  aria-controls="cavai-your-chats-list"
                >
                  <span className={styles.centerSidebarSectionLabel}>Your Chats</span>
                    <span className={styles.centerSidebarSectionToggleMeta}>
                      <span className={styles.centerSidebarChatsMeta}>
                      {`${visibleSessionCount} ${visibleSessionCount === 1 ? "chat" : "chats"}`}
                      </span>
                      <span
                      className={[
                        styles.centerSidebarSectionToggleGlyph,
                        chatsExpanded ? styles.centerSidebarSectionToggleGlyphOpen : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </div>
            ) : null}

            {!sidebarCollapsedActive && chatsExpanded ? (
              <div id="cavai-your-chats-list" className={styles.centerSidebarBody}>
                {isPhoneLayout ? (
                  <input
                    ref={searchInputRef}
                    className={styles.centerSidebarSearchInput}
                    value={sessionQuery}
                    onChange={(event) => setSessionQuery(event.currentTarget.value)}
                    placeholder="Search chats"
                    aria-label="Search chats"
                  />
                ) : null}
                {renderSessionList}
              </div>
            ) : null}

            {!sidebarCollapsedActive ? (
              <div className={styles.centerSidebarFoot}>
                {isGuestPreviewMode ? (
                  authProbeReady ? (
                  <div className={[styles.centerSidebarGuestCta, styles.centerHeaderAccountWrap].join(" ")} ref={accountMenuRef}>
                    <button
                      type="button"
                      className={[styles.centerSidebarActionBtn, styles.centerSidebarActionBtnPrimary].join(" ")}
                      onClick={() => openGuestAuthPanel({ closeDrawer: isPhoneLayout })}
                      aria-label="CavBot Operator"
                      title="CavBot Operator"
                      aria-haspopup="dialog"
                      aria-expanded={accountMenuOpen}
                    >
                      <span
                        className={styles.centerHeaderAccountChip}
                        data-tone="lime"
                        aria-hidden="true"
                        style={
                          {
                            background: resolveAccountToneBackground("lime"),
                            "--center-account-ink": resolveAccountToneInk("lime"),
                          } as React.CSSProperties
                        }
                      >
                        <span className={styles.centerHeaderAccountInitials}>C</span>
                      </span>
                      <span className={styles.centerSidebarActionText}>CavBot Operator</span>
                    </button>
                    {accountMenuOpen ? (
                      <div
                        className={styles.centerGuestAuthPanel}
                        role="dialog"
                        aria-modal="false"
                        aria-label="Sign in or create an account"
                      >
                        <div className={styles.centerGuestAuthPanelHead}>
                          <Image
                            src="/logo/official-logotype-light.svg"
                            alt="CavBot"
                            width={176}
                            height={29}
                            className={styles.centerGuestAuthPanelLogotype}
                            priority
                          />
                          <button
                            type="button"
                            className={styles.centerGuestAuthCloseBtn}
                            onClick={closeGuestAuthPanel}
                            aria-label="Close auth panel"
                            disabled={guestAuthBusy}
                          >
                            <span className={styles.centerGuestAuthCloseGlyph} aria-hidden="true" />
                          </button>
                        </div>
                        <div className={styles.centerGuestAuthPanelBody}>
                          <h3 className={styles.centerGuestAuthTitle}>Sign in or create an account</h3>
                          <p className={styles.centerGuestAuthSubtitle}>Save and sync your searches</p>

                          <button
                            type="button"
                            className={styles.centerGuestAuthProviderBtn}
                            onClick={() => onGuestAuthOauth("google")}
                            disabled={guestAuthBusy}
                          >
                            <span className={styles.centerGuestAuthProviderIcon} aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                                <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1S8.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 6.9 2 2.8 6.1 2.8 11.8S6.9 21.6 12 21.6c6.9 0 8.6-4.9 8.6-7.4 0-.5-.1-1-.1-1.4H12Z" />
                                <path fill="#34A853" d="M3.6 7.3l3.2 2.3C7.7 7.4 9.7 5.7 12 5.7c1.9 0 3.2.8 3.9 1.6l2.6-2.5C16.9 3.3 14.7 2 12 2 8.4 2 5.2 4 3.6 7.3Z" />
                                <path fill="#FBBC05" d="M12 21.6c2.7 0 5-1 6.7-2.6l-3.1-2.4c-.8.6-2 1.3-3.6 1.3-2.3 0-4.3-1.5-5.1-3.7l-3.3 2.5c1.6 3 4.7 4.9 8.4 4.9Z" />
                                <path fill="#4285F4" d="M20.5 11.8c0-.5-.1-1-.1-1.4H12v3.9h5.5c-.3 1.4-1.2 2.6-2.6 3.4l3.1 2.4c1.8-1.7 2.5-4.2 2.5-6.3Z" />
                              </svg>
                            </span>
                            Continue with Google
                          </button>
                          <button
                            type="button"
                            className={styles.centerGuestAuthProviderBtn}
                            onClick={() => onGuestAuthOauth("github")}
                            disabled={guestAuthBusy}
                          >
                            <span className={styles.centerGuestAuthProviderIcon} aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
                                <path
                                  fill="currentColor"
                                  d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
                                />
                              </svg>
                            </span>
                            Continue with GitHub
                          </button>

                          <div className={styles.centerGuestAuthDivider} role="separator" aria-label="or continue with email">
                            <span>or</span>
                          </div>

                          <form
                            className={styles.centerGuestAuthForm}
                            onSubmit={(event) => {
                              event.preventDefault();
                              onGuestAuthPrimaryAction();
                            }}
                          >
                            {guestAuthStage === "email" ? (
                              <div className={styles.centerGuestAuthField}>
                                <input
                                  id="cavai-guest-auth-email"
                                  type="email"
                                  autoComplete="email"
                                  className={[styles.centerGuestAuthInput, styles.centerGuestAuthEmailInput].join(" ")}
                                  value={guestAuthEmail}
                                  onChange={(event) => {
                                    setGuestAuthEmail(event.currentTarget.value);
                                    setGuestAuthError("");
                                  }}
                                  placeholder="Enter your email"
                                  aria-label="Email"
                                  disabled={guestAuthBusy}
                                  required
                                />
                              </div>
                            ) : null}

                            {guestAuthStage === "login_password" ? (
                              <>
                                <div className={styles.centerGuestAuthField}>
                                  <div className={styles.centerGuestAuthEmailValue}>{guestAuthEmail}</div>
                                </div>
                                <div className={styles.centerGuestAuthField}>
                                  <input
                                    id="cavai-guest-auth-password-login"
                                    type="password"
                                    autoComplete="current-password"
                                    className={[styles.centerGuestAuthInput, styles.centerGuestAuthPasswordInput].join(" ")}
                                    value={guestAuthPassword}
                                    onChange={(event) => {
                                      setGuestAuthPassword(event.currentTarget.value);
                                      setGuestAuthError("");
                                    }}
                                    placeholder="Enter your password"
                                    aria-label="Password"
                                    disabled={guestAuthBusy}
                                    required
                                  />
                                </div>
                              </>
                            ) : null}

                            {guestAuthStage === "signup_details" ? (
                              <>
                                <div className={styles.centerGuestAuthField}>
                                  <div className={styles.centerGuestAuthEmailValue}>{guestAuthEmail}</div>
                                </div>
                                <div className={styles.centerGuestAuthField}>
                                  <label className={styles.centerGuestAuthLabel} htmlFor="cavai-guest-auth-name">
                                    Name (optional)
                                  </label>
                                  <input
                                    id="cavai-guest-auth-name"
                                    type="text"
                                    autoComplete="name"
                                    className={styles.centerGuestAuthInput}
                                    value={guestAuthName}
                                    onChange={(event) => {
                                      setGuestAuthName(event.currentTarget.value);
                                      setGuestAuthError("");
                                    }}
                                    placeholder="Name"
                                    disabled={guestAuthBusy}
                                  />
                                </div>
                                <div className={styles.centerGuestAuthField}>
                                  <label className={styles.centerGuestAuthLabel} htmlFor="cavai-guest-auth-username">
                                    Username
                                  </label>
                                  <input
                                    id="cavai-guest-auth-username"
                                    type="text"
                                    autoComplete="username"
                                    className={styles.centerGuestAuthInput}
                                    value={guestAuthUsername}
                                    onChange={(event) => {
                                      setGuestAuthUsername(event.currentTarget.value.toLowerCase());
                                      setGuestAuthError("");
                                    }}
                                    placeholder="Username"
                                    disabled={guestAuthBusy}
                                    required
                                  />
                                </div>
                                <div className={styles.centerGuestAuthField}>
                                  <input
                                    id="cavai-guest-auth-password-signup"
                                    type="password"
                                    autoComplete="new-password"
                                    className={[styles.centerGuestAuthInput, styles.centerGuestAuthPasswordInput].join(" ")}
                                    value={guestAuthPassword}
                                    onChange={(event) => {
                                      setGuestAuthPassword(event.currentTarget.value);
                                      setGuestAuthError("");
                                    }}
                                    placeholder="Use at least 10 characters"
                                    aria-label="Password"
                                    disabled={guestAuthBusy}
                                    required
                                  />
                                </div>
                              </>
                            ) : null}

                            {guestAuthStage !== "email" ? (
                              <button
                                type="button"
                                className={styles.centerGuestAuthSwitchBtn}
                                onClick={() => {
                                  setGuestAuthStage("email");
                                  setGuestAuthPassword("");
                                  setGuestAuthError("");
                                }}
                                disabled={guestAuthBusy}
                              >
                                Use a different email
                              </button>
                            ) : null}

                            <button
                              type="submit"
                              className={styles.centerGuestAuthSubmitBtn}
                              disabled={guestAuthBusy || (guestAuthStage === "email" && s(guestAuthEmail).length < 1)}
                            >
                              {guestAuthBusy
                                ? "Please wait..."
                                : guestAuthStage === "email"
                                  ? "Continue with email"
                                  : guestAuthStage === "login_password"
                                    ? "Log in"
                                    : "Sign up"}
                            </button>
                          </form>
                          {guestAuthError ? <p className={styles.centerGuestAuthError}>{guestAuthError}</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  ) : null
                ) : (
                  <div className={styles.centerHeaderAccountWrap} ref={accountMenuRef}>
                    <button
                      type="button"
                      className={styles.centerSidebarActionBtn}
                      aria-haspopup="menu"
                      aria-expanded={accountMenuOpen}
                      aria-label={`Account: ${accountNameLabel} · ${accountPlanLabel}`}
                      title="Account"
                      onClick={() => setAccountMenuOpen((prev) => !prev)}
                    >
                      <span
                        className={styles.centerHeaderAccountChip}
                        data-tone={accountProfileTone || "lime"}
                        aria-hidden="true"
                        style={
                          {
                            background: accountChipBackground,
                            "--center-account-ink": accountChipInk,
                          } as React.CSSProperties
                        }
                      >
                        {accountHasAvatar ? (
                          <Image
                            src={accountProfileAvatar}
                            alt=""
                            width={96}
                            height={96}
                            quality={60}
                            unoptimized
                            className={styles.centerHeaderAccountAvatarImage}
                          />
                        ) : (
                          <span className={styles.centerHeaderAccountInitials}>{accountInitial}</span>
                        )}
                      </span>
                      <span className={styles.centerSidebarAccountMeta}>
                        <span className={styles.centerSidebarAccountName}>{accountNameLabel}</span>
                        <span className={styles.centerSidebarAccountPlan}>{accountPlanLabel}</span>
                      </span>
                    </button>

                    {accountMenuOpen ? (
                      <div
                        className={[styles.centerHeaderAccountMenu, styles.centerHeaderAccountMenuFromBottom].join(" ")}
                        role="menu"
                        aria-label="Account"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.centerHeaderAccountMenuItem}
                          onClick={onOpenAccountSettings}
                        >
                          {profileMenuLabel}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className={[styles.centerHeaderAccountMenuItem, styles.centerHeaderAccountMenuItemDanger].join(" ")}
                          onClick={() => void onLogout()}
                          disabled={logoutPending}
                        >
                          {logoutPending ? "Logging out..." : "Log out"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </aside>
        ) : null}

        <section className={styles.centerMain} aria-label="CavAi chat workspace">
          <header className={styles.centerMainHeader}>
            {!overlay ? (
              <div className={styles.centerMobileHeaderLeft}>
              <button
                type="button"
                className={[styles.centerIconBtn, styles.centerMobileMenuBtn].join(" ")}
                onClick={toggleMobileDrawer}
                aria-label="Open navigation drawer"
                title="Menu"
                aria-expanded={mobileDrawerOpen}
                aria-controls="cavai-mobile-drawer"
              >
                <Image
                  src="/icons/menu-svgrepo-com.svg"
                  alt=""
                  width={18}
                  height={18}
                  className={styles.centerMobileMenuSvg}
                  aria-hidden="true"
                  unoptimized
                />
              </button>
            </div>
          ) : null}

            <div className={styles.centerMainHeadCopy}>
              <div className={styles.centerMainTitleRow}>
                {overlay ? (
                  <div className={styles.centerMainTitle}>
                    <span>CavAi</span>
                  </div>
                ) : (
                  <div className={styles.centerModelWrap} ref={headerModelMenuRef}>
                    <button
                      type="button"
                      className={styles.centerModelTrigger}
                      onClick={() => {
                        setMobileDrawerOpen(false);
                        setOpenHeaderModelMenu((prev) => !prev);
                      }}
                      aria-haspopup="menu"
                      aria-expanded={openHeaderModelMenu}
                      aria-label={`Model selector. Current model: ${selectedModelLabel}`}
                      title={selectedModelLabel}
                    >
                      <span className={styles.centerModelTriggerText}>{selectedModelLabel}</span>
                      <span
                        className={[
                          styles.centerModelTriggerCaret,
                          openHeaderModelMenu ? styles.centerModelTriggerCaretOpen : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        aria-hidden="true"
                      />
                    </button>
                    {openHeaderModelMenu ? (
                      <div className={styles.centerModelMenu} role="menu" aria-label="Model selector">
                        {modelMenuOptions.map((option) => {
                          const isOn = selectedModel === option.id;
                          const locked = option.locked === true;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isOn}
                              className={[
                                styles.centerModelMenuItem,
                                isOn ? styles.centerModelMenuItemOn : "",
                                locked ? styles.centerModelMenuItemLocked : "",
                              ].filter(Boolean).join(" ")}
                              onClick={() => {
                                if (locked) {
                                  setError(CAVAI_GUEST_PREVIEW_LOCK_MESSAGE);
                                  return;
                                }
                                applyModelSelection(option.id);
                                setOpenHeaderModelMenu(false);
                              }}
                              title={locked ? `${option.label} · User only (sign in)` : option.label}
                            >
                              <span className={styles.centerModelMenuItemLabel}>{option.label}</span>
                              {locked ? (
                                <span className={styles.centerModelMenuLock}>
                                  <LockIcon width={12} height={12} aria-hidden="true" />
                                </span>
                              ) : isOn ? (
                                <span className={styles.centerModelMenuCheck} aria-hidden="true">✓</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.centerHeaderActions}>
              {overlay ? (
                <button
                  type="button"
                  className={styles.centerIconBtn}
                  aria-label="Toggle history"
                  title="History"
                  onClick={() => setHistoryOpen((prev) => !prev)}
                >
                  <span className={styles.historyGlyph} aria-hidden="true" />
                </button>
              ) : null}

              {overlay ? (
                <Link className={styles.centerIconBtn} href={expandHref} target="_blank" rel="noopener noreferrer" prefetch={false} aria-label="Expand CavAi" title="Open full CavAi">
                  <Image
                    src="/icons/expand-svgrepo-com.svg"
                    alt=""
                    width={16}
                    height={16}
                    className={styles.headBtnExpandGlyph}
                    aria-hidden="true"
                    unoptimized
                    loading="eager"
                    priority
                  />
                </Link>
              ) : null}

              {overlay ? (
                <button
                  type="button"
                  className={styles.centerIconBtn}
                  aria-label="New chat"
                  title="New chat"
                  onClick={onNewSession}
                >
                  <span className={styles.newChatGlyph} aria-hidden="true" />
                </button>
              ) : (
                <>
                  {!isPhoneLayout ? (
                    <div className={styles.centerHeaderDesktopSearch}>
                      <input
                        ref={searchInputRef}
                        className={styles.centerSidebarSearchInput}
                        value={sessionQuery}
                        onChange={(event) => setSessionQuery(event.currentTarget.value)}
                        placeholder="Search CavAi"
                        aria-label="Search CavAi"
                      />
                    </div>
                  ) : null}
                  {isPhoneLayout ? (
                    <div className={styles.centerHeaderMobileAccount}>
                      {isGuestPreviewMode ? (
                        <button
                          type="button"
                          className={styles.centerHeaderLoginBtn}
                          onClick={() => openGuestAuthPanel({ closeDrawer: true })}
                          aria-label="Log in"
                          title="Log in"
                          disabled={!authProbeReady}
                        >
                          Log in
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.centerHeaderAccountBtn}
                          onClick={openMobileDrawer}
                          aria-label={`Account: ${accountNameLabel}`}
                          title="Account"
                        >
                          <span
                            className={styles.centerHeaderAccountChip}
                            data-tone={accountProfileTone || "lime"}
                            aria-hidden="true"
                            style={
                              {
                                background: accountChipBackground,
                                "--center-account-ink": accountChipInk,
                              } as React.CSSProperties
                            }
                          >
                            {accountHasAvatar ? (
                              <Image
                                src={accountProfileAvatar}
                                alt=""
                                width={96}
                                height={96}
                                quality={60}
                                unoptimized
                                className={styles.centerHeaderAccountAvatarImage}
                              />
                            ) : (
                              <span className={styles.centerHeaderAccountInitials}>{accountInitial}</span>
                            )}
                          </span>
                        </button>
                      )}
                    </div>
                  ) : null}
                </>
              )}

              {overlay ? (
                <button
                  type="button"
                  className={styles.centerIconBtn}
                  onClick={props.onClose}
                  aria-label="Close CavAi"
                  title="Close"
                >
                  <span className={`cb-closeIcon ${styles.headBtnCloseGlyph}`} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </header>

          {overlay && historyOpen ? (
            <section className={styles.centerOverlayHistory} aria-label="CavAi history">
              <div className={styles.centerOverlaySearch}>
                <input
                  className={styles.centerSidebarSearchInput}
                  value={sessionQuery}
                  onChange={(event) => setSessionQuery(event.currentTarget.value)}
                  placeholder="Search CavAi"
                  aria-label="Search CavAi"
                />
              </div>
              <div className={styles.centerOverlayHistoryBody}>{renderSessionList}</div>
            </section>
          ) : null}

          <section
            ref={threadRef}
            className={styles.centerThread}
            aria-label="Conversation stream"
            onScroll={onThreadScroll}
            style={{ position: "relative" }}
          >
            {showVoiceOrb ? (
              <CavAiVoiceOrb
                active
                mode={voiceOrbState}
                mediaStream={voiceOrbStream}
                placement={isEmptyThread ? "center" : "bottom"}
                centerOffsetY={centerComposerInThread ? -84 : -28}
                bottomOffset={22}
                label="CavAi voice activity"
              />
            ) : null}
            <div className={threadInnerClassName}>
              {isEmptyThread ? (
                <div
                  className={emptyStateClassName}
                >
                  {!overlay ? (
                    <div className={styles.centerEmptyBadgeWrap}>
                      <div className="cb-badge cb-badge-inline" aria-hidden="true">
                        <CdnBadgeEyes />
                      </div>
                    </div>
                  ) : null}
                  {showOverlayGreeting ? (
                    <>
                      <h2 className={emptyTitleClassName}>
                        {overlay ? (
                          <span className={styles.centerEmptyTitleOverlayLead}>{emptyHeadline}</span>
                        ) : (
                          emptyHeadline
                        )}
                      </h2>
                      {emptySubline ? (
                        <p className={emptySublineClassName}>
                          {overlay ? (
                            <span className={styles.centerEmptyTextOverlayLine}>
                              <span className={styles.centerEmptyTextOverlayPrompt}>{emptySubline}</span>
                              <span className={styles.centerEmptyTextOverlayCursor} aria-hidden="true" />
                            </span>
                          ) : (
                            emptySubline
                          )}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                  {centerComposerInThread ? <div className={styles.centerInlineComposer}>{composerContent}</div> : null}
                </div>
              ) : null}

              {messages.map((item, itemIndex) => {
                const structured = item.role === "assistant" ? toCenterData(item.contentJson) : null;
                const keyFindings = structured?.keyFindings || [];
                const extractedEvidence = structured?.extractedEvidence || [];
                const sources = structured?.sources || [];
                const suggestedNextActions = structured?.suggestedNextActions || [];
                const generatedImages = structured?.generatedImages || [];
                const imageStudioAssets = structured?.imageStudio?.assets || [];
                const hasStructuredDetails = Boolean(
                  structured
                  && (
                    structured.researchMode
                    || keyFindings.length
                    || extractedEvidence.length
                    || sources.length
                    || suggestedNextActions.length
                    || generatedImages.length
                    || imageStudioAssets.length
                  )
                );
                const segments = toMessageSegments({
                  role: item.role,
                  contentText: item.contentText,
                });
                const feedback = toSafeFeedbackState(item.feedback);
                const executionMeta = item.role === "assistant" ? resolveExecutionMetaFromMessage(item) : null;
                const reasoningLabel = resolveReasoningLabel({
                  message: item,
                  allMessages: messages,
                  index: itemIndex,
                });
                const canOpenReasoning = Boolean(
                  item.role === "assistant"
                  && executionMeta
                  && executionMeta.showReasoningChip
                  && executionMeta.safeSummary
                );
                const pendingAction = s(messageActionPending[item.id]).toLowerCase();
                const reactionBusy = pendingAction === "like" || pendingAction === "dislike" || pendingAction === "clear_reaction";
                const copyBusy = pendingAction === "copy";
                const copyConfirmed = copiedMessageToken === `copy:${item.id}` || copiedMessageToken === `share:${item.id}`;
                const shareBusy = pendingAction === "share";
                const retryBusy = pendingAction === "retry";
                const editBusy = pendingAction === "edit";
                const speakBusy = speakingMessageId === item.id;
                const mediaPayload = item.role === "user" ? toMessageMediaPayload(item) : null;
                const userImages = mediaPayload?.images || [];
                const userUploadedFiles = mediaPayload?.uploadedFiles || [];
                const hasUserMedia = item.role === "user" && (userImages.length > 0 || userUploadedFiles.length > 0);
                const isUserMessage = item.role === "user";
                const isInlineEditingMessage = Boolean(
                  inlineEditDraft
                  && item.role === "user"
                  && s(inlineEditDraft.userMessageId) === item.id
                );
                const showMessageActions =
                  (item.role === "assistant" || isUserMessage)
                  && !isInlineEditingMessage;
                const showInlineEditPendingAfterMessage = hasInlineEditPending && inlineEditPendingAnchorId === item.id;

                return (
                  <Fragment key={item.id}>
                    <article
                      data-cavai-message-id={item.id}
                      className={[
                        styles.centerMessage,
                        item.role === "user" ? styles.centerMessageUser : styles.centerMessageAssistant,
                        isInlineEditingMessage ? styles.centerMessageEditing : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className={styles.centerMessageHead}>
                        {reasoningLabel ? (
                          canOpenReasoning ? (
                            <button
                              type="button"
                              className={[styles.centerMessageRole, styles.centerReasoningBtn].join(" ")}
                              onClick={() => setReasoningPanelMessageId(item.id)}
                              aria-label="Open reasoning summary"
                              title="Open reasoning summary"
                            >
                              {reasoningLabel}
                            </button>
                          ) : (
                            <span className={styles.centerMessageRole}>{reasoningLabel}</span>
                          )
                        ) : null}
                        <span
                          className={styles.centerMessageTime}
                          title={toIsoTime(item.createdAt)}
                          style={reasoningLabel ? undefined : { marginInlineStart: "auto" }}
                        >
                          {toTimelineLabel(item.createdAt)}
                        </span>
                      </div>

                      <div className={item.role === "assistant" ? styles.centerAssistantContentRow : undefined}>
                        {item.role === "assistant" ? (
                          <span className={[styles.centerResponseLogo, styles.centerResponseLogoCavAi].join(" ")} aria-hidden="true" />
                        ) : null}
                        <div className={styles.centerMessageContentStack}>
                          <div className={styles.centerMessageBody}>
                            {isInlineEditingMessage ? (
                              <div className={[styles.inlineEditShell, styles.centerInlineEditShell, styles.centerInlineEditShellInThread].join(" ")}>
                                <textarea
                                  ref={inlineEditInputRef}
                                  value={inlineEditPrompt}
                                  onChange={(event) => setInlineEditPrompt(event.currentTarget.value)}
                                  onKeyDown={onInlineEditPromptKeyDown}
                                  className={[styles.inlineEditInput, styles.centerInlineEditInput].join(" ")}
                                  rows={7}
                                  aria-label="Edit prompt"
                                  disabled={inlineEditBusy || submitting}
                                />
                                <div className={[styles.inlineEditActions, styles.centerInlineEditActions].join(" ")}>
                                  <button
                                    type="button"
                                    className={styles.inlineEditCancelBtn}
                                    onClick={onCancelInlineEdit}
                                    disabled={inlineEditBusy || submitting}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.inlineEditSendBtn}
                                    onClick={() => void onSubmitInlineEdit()}
                                    disabled={inlineEditBusy || submitting || !s(inlineEditPrompt)}
                                    aria-label="Send edited prompt"
                                    title="Send"
                                  >
                                    <span className={[styles.primaryBtnGlyph, styles.primaryBtnGlyphRun].join(" ")} aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {item.role === "user" && hasUserMedia ? (
                                  <div className={styles.attachmentsRow}>
                                    {userImages.map((image) => {
                                      const canPreviewImage = Boolean(s(image.dataUrl)) && s(image.dataUrl) !== TRANSPARENT_IMAGE_DATA_URL;
                                      return (
                                        <div
                                          key={`message-image-${item.id}-${image.id}`}
                                          className={styles.attachmentChip}
                                        >
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
                                        key={`message-file-${item.id}-${file.id}`}
                                        className={[styles.attachmentChip, styles.attachmentFileChip].join(" ")}
                                      >
                                        <span className={styles.attachmentFileIconWrap} aria-hidden="true">
                                          <Image src={file.iconSrc} alt="" width={18} height={18} className={styles.attachmentFileIcon} unoptimized />
                                        </span>
                                        <button
                                          type="button"
                                          className={styles.attachmentFileOpenBtn}
                                          onClick={() => openComposerUploadedFile(file)}
                                          disabled={!s(file.path)}
                                          aria-label={`Open ${file.name}`}
                                          title={file.path || file.name}
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
                                {segments.map((segment, segmentIndex) => {
                                  const segmentToken = `${item.id}:segment:${segmentIndex}`;
                                  if (segment.kind === "prompt") {
                                    return (
                                      <section key={segmentToken} className={styles.centerPromptBox} aria-label="Prompt box">
                                        <div className={styles.centerPromptBoxTop}>
                                          <span className={styles.centerPromptBoxLabel}>
                                            {item.role === "assistant"
                                              ? reasoningLabel
                                              : (segment.language ? `${segment.language.toUpperCase()} Prompt` : "Prompt Box")}
                                          </span>
                                          <button
                                            type="button"
                                            className={[
                                              styles.centerPromptBoxCopyBtn,
                                              copiedMessageToken === segmentToken ? styles.centerPromptBoxCopyBtnOn : "",
                                            ]
                                              .filter(Boolean)
                                              .join(" ")}
                                            onClick={() => void copyTextWithFeedback(item, segment.text, segmentToken)}
                                            disabled={copyBusy}
                                            aria-label="Copy prompt box"
                                            title="Copy prompt box"
                                          >
                                            <span className={styles.centerPromptBoxCopyGlyph} aria-hidden="true" />
                                          </button>
                                        </div>
                                        <pre className={styles.centerPromptBoxText}>{segment.text}</pre>
                                      </section>
                                    );
                                  }
                                  return (
                                    <div key={segmentToken} className={styles.centerMessageText}>
                                      {segment.text}
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </div>

                          {item.role === "assistant" && hasStructuredDetails ? (
                            <div className={styles.centerMessageStructured}>
                              {structured?.researchMode ? (
                                <span className={styles.centerResearchBadge}>Research Mode · Qwen3-Max</span>
                              ) : null}
                              {keyFindings.length ? (
                                <section className={styles.centerResearchSection}>
                                  <h3 className={styles.centerResearchSectionTitle}>Key Findings</h3>
                                  <ul className={styles.centerResearchList}>
                                    {keyFindings.map((row, index) => (
                                      <li key={`${item.id}-finding-${index}`}>{row}</li>
                                    ))}
                                  </ul>
                                </section>
                              ) : null}
                              {extractedEvidence.length ? (
                                <section className={styles.centerResearchSection}>
                                  <h3 className={styles.centerResearchSectionTitle}>Extracted Evidence</h3>
                                  <ul className={styles.centerResearchList}>
                                    {extractedEvidence.map((row, index) => (
                                      <li key={`${item.id}-evidence-${index}`}>
                                        <strong>{row.source}</strong>
                                        <span>{row.note}</span>
                                        {row.url ? (
                                          <a href={row.url} target="_blank" rel="noreferrer">
                                            {row.url}
                                          </a>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                              ) : null}
                              {sources.length ? (
                                <section className={styles.centerResearchSection}>
                                  <h3 className={styles.centerResearchSectionTitle}>Sources</h3>
                                  <ul className={styles.centerResearchList}>
                                    {sources.map((row, index) => (
                                      <li key={`${item.id}-source-${index}`}>
                                        <strong>{row.title}</strong>
                                        <a href={row.url} target="_blank" rel="noreferrer">
                                          {row.url}
                                        </a>
                                        {row.note ? <span>{row.note}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                              ) : null}
                              {suggestedNextActions.length ? (
                                <section className={styles.centerResearchSection}>
                                  <h3 className={styles.centerResearchSectionTitle}>Suggested Next Actions</h3>
                                  <ul className={styles.centerResearchList}>
                                    {suggestedNextActions.map((row, index) => (
                                      <li key={`${item.id}-next-${index}`}>{row}</li>
                                    ))}
                                  </ul>
                                </section>
                              ) : null}
                              {generatedImages.length ? (
                                <section className={styles.centerResearchSection}>
                                  <h3 className={styles.centerResearchSectionTitle}>Generated Images</h3>
                                  <ul className={styles.centerImageResultList}>
                                    {generatedImages.map((row, index) => {
                                      const imageStudioAsset = imageStudioAssets[index];
                                      const assetId = s(imageStudioAsset?.assetId);
                                      const src = s(imageStudioAsset?.url)
                                        || row.url
                                        || (s(imageStudioAsset?.b64Json) ? `data:image/png;base64,${s(imageStudioAsset?.b64Json)}` : "")
                                        || (row.b64Json ? `data:image/png;base64,${row.b64Json}` : "");
                                      const sourcePrompt = s(structured?.imageStudio?.sourcePrompt) || null;
                                      return (
                                        <li key={`${item.id}-image-${index}`} className={styles.centerImageResultCard}>
                                          {src ? (
                                            <Image
                                              src={src}
                                              alt=""
                                              width={180}
                                              height={120}
                                              unoptimized
                                              className={styles.centerImageResultPreview}
                                            />
                                          ) : null}
                                          <div className={styles.centerImageResultMeta}>
                                            <span className={styles.centerImageResultLabel}>Image {index + 1}</span>
                                          </div>
                                          <div className={styles.centerImageResultActions}>
                                            {src ? (
                                              <a href={src} target="_blank" rel="noreferrer" className={styles.centerImageResultActionBtn}>
                                                Open
                                              </a>
                                            ) : null}
                                            <button
                                              type="button"
                                              className={styles.centerImageResultActionBtn}
                                              onClick={() => onImageStudioHistoryReusePrompt({
                                                id: `${item.id}-img-${index}`,
                                                entryType: "generated",
                                                mode: "generate",
                                                promptSummary: null,
                                                saved: false,
                                                savedTarget: null,
                                                createdAtISO: item.createdAt,
                                                jobId: s(structured?.imageStudio?.jobId) || null,
                                                assetId: assetId || null,
                                                presetId: s(structured?.imageStudio?.presetId) || null,
                                                presetLabel: s(structured?.imageStudio?.presetLabel) || null,
                                                imageUrl: src || null,
                                                fileName: s(imageStudioAsset?.fileName) || null,
                                                mimeType: s(imageStudioAsset?.mimeType) || null,
                                                modelUsed: null,
                                                sourcePrompt,
                                              })}
                                            >
                                              Reuse Prompt
                                            </button>
                                            {assetId ? (
                                              <>
                                                <button
                                                  type="button"
                                                  className={styles.centerImageResultActionBtn}
                                                  onClick={() => void onImageStudioHistoryEdit({
                                                    id: `${item.id}-img-edit-${index}`,
                                                    entryType: "generated",
                                                    mode: "edit",
                                                    promptSummary: null,
                                                    saved: false,
                                                    savedTarget: null,
                                                    createdAtISO: item.createdAt,
                                                    jobId: s(structured?.imageStudio?.jobId) || null,
                                                    assetId,
                                                    presetId: s(structured?.imageStudio?.presetId) || null,
                                                    presetLabel: s(structured?.imageStudio?.presetLabel) || null,
                                                    imageUrl: src || null,
                                                    fileName: s(imageStudioAsset?.fileName) || null,
                                                    mimeType: s(imageStudioAsset?.mimeType) || null,
                                                    modelUsed: null,
                                                    sourcePrompt,
                                                  })}
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  type="button"
                                                  className={styles.centerImageResultActionBtn}
                                                  onClick={() => openImageStudioSaveModal(assetId)}
                                                >
                                                  Save
                                                </button>
                                              </>
                                            ) : null}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </section>
                              ) : null}
                            </div>
                          ) : null}

                          {showMessageActions ? (
                            <div
                              className={[
                                styles.centerMessageActions,
                                item.role === "user" ? styles.centerUserMessageActions : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                            {(item.role === "assistant" || isUserMessage) ? (
                              <button
                                type="button"
                                className={[
                                  styles.centerMessageActionBtn,
                                  copyConfirmed ? styles.centerMessageActionBtnOn : "",
                                  copyBusy ? styles.centerMessageActionBtnBusy : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onClick={() => void copyTextWithFeedback(item, item.contentText, `copy:${item.id}`)}
                                disabled={copyBusy || editBusy}
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

                            {item.role === "user" && !isGuestPreviewMode ? (
                              <button
                                type="button"
                                className={[
                                  styles.centerMessageActionBtn,
                                  editBusy ? styles.centerMessageActionBtnBusy : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                onClick={() => void onEditMessage(item)}
                                disabled={editBusy || submitting}
                                aria-label="Edit and resend this prompt"
                                title="Edit"
                              >
                                <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphEdit].join(" ")} aria-hidden="true" />
                              </button>
                            ) : null}

                            {item.role === "assistant" && !isGuestPreviewMode ? (
                              <>
                                <button
                                  type="button"
                                  className={[
                                    styles.centerMessageActionBtn,
                                    styles.centerMessageActionSpeakBtn,
                                    speakBusy ? styles.centerMessageActionSpeakBtnOn : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  onPointerDown={() => prefetchSpeechForMessage(item.contentText, item.id)}
                                  onPointerEnter={() => prefetchSpeechForMessage(item.contentText, item.id)}
                                  onFocus={() => prefetchSpeechForMessage(item.contentText, item.id)}
                                  onClick={() => void onSpeakMessage(item)}
                                  aria-label={speakBusy ? "Stop speaking message" : "Speak message"}
                                  title={speakBusy ? "Stop" : "Speak"}
                                >
                                  <span
                                    className={[
                                      styles.centerMessageActionGlyph,
                                      speakBusy
                                        ? styles.centerMessageActionGlyphSpeakStop
                                        : styles.centerMessageActionGlyphSpeak,
                                    ].join(" ")}
                                    aria-hidden="true"
                                  />
                                </button>
                                <button
                                  type="button"
                                className={[
                                  styles.centerMessageActionBtn,
                                  feedback.reaction === "like" ? styles.centerMessageActionBtnReactionOn : "",
                                  reactionBusy ? styles.centerMessageActionBtnBusy : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                  onClick={() => onToggleMessageReaction(item, "like")}
                                  disabled={reactionBusy}
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
                                  onClick={() => onToggleMessageReaction(item, "dislike")}
                                  disabled={reactionBusy}
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
                                  onClick={() => void onShareMessage(item)}
                                  disabled={shareBusy}
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
                                  onClick={() => void onRetryMessage(item)}
                                  disabled={retryBusy || submitting}
                                  aria-label="Retry from this message"
                                  title="Retry"
                                >
                                  <span className={[styles.centerMessageActionGlyph, styles.centerMessageActionGlyphRetry].join(" ")} aria-hidden="true" />
                                </button>
                              </>
                            ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                    {showInlineEditPendingAfterMessage ? (
                      <article
                        className={[styles.centerMessage, styles.centerMessageAssistant, styles.centerMessageLoading].join(" ")}
                        aria-live="polite"
                        aria-label="CavAi is generating a response"
                      >
                        <div className={styles.centerMessageLoadingBody}>
                          <span
                            className={[styles.centerResponseLogo, styles.centerResponseLogoCavAi, styles.centerReasoningLoadingLogo].join(" ")}
                            aria-hidden="true"
                          />
                          <div className={styles.reasoningLoadingStack}>
                            <span className={styles.reasoningLoadingTitle}>
                              {pendingImageGeneration ? "Creating image" : "Reasoning"}
                            </span>
                            {pendingImageGeneration ? (
                              <div className={styles.centerImageCreatingSquare} aria-hidden="true" />
                            ) : null}
                            {reasoningContextLines.length && !pendingImageGeneration ? (
                              <div className={styles.reasoningLoadingContext}>
                                {reasoningContextLines.map((line, index) => (
                                  <span key={`${item.id}-pending-reasoning-${index}`} className={styles.reasoningLoadingLine}>
                                    {line}
                                  </span>
                                ))}
                              </div>
                            ) : pendingImageGeneration ? (
                              <div className={styles.reasoningLoadingContext}>
                                <span className={styles.reasoningLoadingLine}>Rendering visual details...</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ) : null}
                  </Fragment>
                );
              })}

              {hasPendingPrompt && !hasInlineEditPending ? (
                <>
                  <article className={[styles.centerMessage, styles.centerMessageUser].join(" ")}>
                    <div className={styles.centerMessageBody}>
                      <div className={styles.centerMessageText}>{pendingPromptText}</div>
                    </div>
                  </article>
                  <article
                    className={[styles.centerMessage, styles.centerMessageAssistant, styles.centerMessageLoading].join(" ")}
                    aria-live="polite"
                    aria-label="CavAi is generating a response"
                  >
                    <div className={styles.centerMessageLoadingBody}>
                      <span
                        className={[styles.centerResponseLogo, styles.centerResponseLogoCavAi, styles.centerReasoningLoadingLogo].join(" ")}
                        aria-hidden="true"
                      />
                      <div className={styles.reasoningLoadingStack}>
                        <span className={styles.reasoningLoadingTitle}>
                          {pendingImageGeneration ? "Creating image" : "Reasoning"}
                        </span>
                        {pendingImageGeneration ? (
                          <div className={styles.centerImageCreatingSquare} aria-hidden="true" />
                        ) : null}
                        {reasoningContextLines.length && !pendingImageGeneration ? (
                          <div className={styles.reasoningLoadingContext}>
                            {reasoningContextLines.map((line, index) => (
                              <span key={`center-reasoning-${index}`} className={styles.reasoningLoadingLine}>
                                {line}
                              </span>
                            ))}
                          </div>
                        ) : pendingImageGeneration ? (
                          <div className={styles.reasoningLoadingContext}>
                            <span className={styles.reasoningLoadingLine}>Rendering visual details...</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                </>
              ) : null}
            </div>
          </section>

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
                        <li key={`reason-context-${index}`}>{row}</li>
                      ))}
                    </ul>
                  </section>

                  <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                    <h3 className={styles.centerResearchSectionTitle}>Validation checks</h3>
                    <ul className={styles.centerResearchList}>
                      {reasoningPanelCheckRows.map((row, index) => (
                        <li key={`reason-check-${index}`}>{row}</li>
                      ))}
                    </ul>
                  </section>

                  <section className={[styles.centerResearchSection, styles.centerReasoningSectionCard].join(" ")}>
                    <h3 className={styles.centerResearchSectionTitle}>Answer path</h3>
                    <ul className={styles.centerResearchList}>
                      {reasoningPanelPathRows.map((row, index) => (
                        <li key={`reason-path-${index}`}>{row}</li>
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
                          <li key={`reason-uncertainty-${index}`}>{row}</li>
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

          {imageStudioPresetLockModalOpen ? (
            <div
              className={styles.centerSessionModalOverlay}
              role="presentation"
              onClick={(event) => {
                if (event.currentTarget !== event.target) return;
                setImageStudioPresetLockModalOpen(false);
              }}
            >
              <section
                className={[styles.centerSessionModal, styles.imageStudioPresetLockModal].join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="image-studio-preset-learn-more-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className={styles.centerSessionModalHead}>
                  <h2 id="image-studio-preset-learn-more-title" className={styles.centerSessionModalTitle}>
                    Hidden Preset Prompt
                  </h2>
                  <button
                    type="button"
                    className={styles.centerSessionModalCloseBtn}
                    onClick={() => setImageStudioPresetLockModalOpen(false)}
                    aria-label="Close dialog"
                  >
                    <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                  </button>
                </header>
                <div className={[styles.centerSessionModalBody, styles.imageStudioPresetLockModalBody].join(" ")}>
                  {IMAGE_STUDIO_PRESET_LOCK_POLICY_SECTIONS.map((section) => (
                    <section key={section.title} className={styles.imageStudioPresetLockPolicySection}>
                      <h3 className={styles.imageStudioPresetLockPolicyTitle}>{section.title}</h3>
                      <p className={[styles.centerSessionModalCopy, styles.imageStudioPresetLockPolicyCopy].join(" ")}>
                        {section.paragraphs.map((paragraph, index) => (
                          <span key={`${section.title}-${index}`}>
                            {paragraph}
                            {index < section.paragraphs.length - 1 ? (
                              <>
                                <br />
                                <br />
                              </>
                            ) : null}
                          </span>
                        ))}
                      </p>
                    </section>
                  ))}
                </div>
                <footer className={styles.centerSessionModalFoot}>
                  <button
                    type="button"
                    className={[styles.centerAgentModeBtn, styles.imageStudioPresetLockCloseBtn].join(" ")}
                    onClick={() => setImageStudioPresetLockModalOpen(false)}
                  >
                    Close
                  </button>
                </footer>
              </section>
            </div>
          ) : null}

          {sessionActionModal ? (
            <div
              className={styles.centerSessionModalOverlay}
              role="presentation"
              onMouseDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (sessionActionBusy) return;
                closeSessionActionModal();
              }}
            >
              <section
                className={styles.centerSessionModal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="cavai-session-action-title"
              >
                <header className={styles.centerSessionModalHead}>
                  <h2 id="cavai-session-action-title" className={styles.centerSessionModalTitle}>
                    {sessionActionModal.type === "share"
                      ? "Share chat"
                      : sessionActionModal.type === "rename"
                        ? "Rename chat"
                        : "Delete chat"}
                  </h2>
                  <button
                    type="button"
                    className={styles.centerSessionModalCloseBtn}
                    onClick={closeSessionActionModal}
                    aria-label="Close dialog"
                    disabled={sessionActionBusy}
                  >
                    <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                  </button>
                </header>

                <div className={styles.centerSessionModalBody}>
                  <p className={styles.centerSessionModalCopy}>
                    {sessionActionModal.type === "share"
                      ? `Choose how to share "${normalizeSessionTitleForSidebar(sessionActionModal.session.title || "Untitled chat")}".`
                      : sessionActionModal.type === "rename"
                        ? "Update the chat title shown in your left panel."
                        : `Delete "${normalizeSessionTitleForSidebar(sessionActionModal.session.title || "Untitled chat")}" permanently?`}
                  </p>

                  {sessionActionModal.type === "share" ? (
                    <div className={styles.centerSessionShareGroup}>
                      <div className={styles.centerSessionShareModes} role="radiogroup" aria-label="Share mode">
                        <button
                          type="button"
                          className={[
                            styles.centerSessionShareModeBtn,
                            shareMode === "internal" ? styles.centerSessionShareModeBtnOn : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => {
                            setShareMode("internal");
                            setShareResultCopied(false);
                          }}
                          aria-pressed={shareMode === "internal"}
                        >
                          Inside app
                        </button>
                        <button
                          type="button"
                          className={[
                            styles.centerSessionShareModeBtn,
                            shareMode === "external" ? styles.centerSessionShareModeBtnOn : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => {
                            setShareMode("external");
                            setShareResultCopied(false);
                          }}
                          aria-pressed={shareMode === "external"}
                        >
                          External link
                        </button>
                      </div>

                      {shareMode === "internal" ? (
                        <div className={styles.centerSessionModalField}>
                          <label className={styles.centerSessionModalLabel} htmlFor="cavai-share-target">
                            Username or email (optional)
                          </label>
                          <input
                            id="cavai-share-target"
                            className={styles.centerSessionModalInput}
                            value={shareTargetIdentity}
                            onChange={(event) => setShareTargetIdentity(event.currentTarget.value)}
                            placeholder="@username or name@example.com"
                            autoComplete="off"
                          />
                          <p className={styles.centerSessionModalHint}>
                            If provided, CavAi sends an in-app notification to that member.
                          </p>
                        </div>
                      ) : (
                        <p className={styles.centerSessionModalHint}>
                          External links are read-only and expire automatically for safety.
                        </p>
                      )}

                      {shareResultUrl ? (
                        <div className={styles.centerSessionShareResult}>
                          <label className={styles.centerSessionModalLabel} htmlFor="cavai-share-url">
                            Share link
                          </label>
                          <div className={styles.centerSessionShareResultRow}>
                            <input
                              id="cavai-share-url"
                              className={styles.centerSessionModalInput}
                              value={shareResultUrl}
                              readOnly
                            />
                            <button
                              type="button"
                              className={styles.centerSessionShareResultBtn}
                              onClick={() => void onCopyShareUrl()}
                            >
                              {shareResultCopied ? "Copied" : "Copy"}
                            </button>
                            {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
                              <button
                                type="button"
                                className={styles.centerSessionShareResultBtn}
                                onClick={() => void onNativeShareUrl()}
                              >
                                Share
                              </button>
                            ) : null}
                          </div>
                          {shareDeliveredHint ? <p className={styles.centerSessionModalHint}>{shareDeliveredHint}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {sessionActionModal.type === "rename" ? (
                    <div className={styles.centerSessionModalField}>
                      <label className={styles.centerSessionModalLabel} htmlFor="cavai-rename-title">
                        Chat title
                      </label>
                      <input
                        id="cavai-rename-title"
                        className={styles.centerSessionModalInput}
                        value={renameDraftTitle}
                        onChange={(event) => setRenameDraftTitle(event.currentTarget.value)}
                        maxLength={220}
                        autoComplete="off"
                        autoFocus
                      />
                    </div>
                  ) : null}

                  {sessionActionModal.type === "delete" ? (
                    <p className={styles.centerSessionModalDangerText}>
                      This removes the entire chat history for this conversation.
                    </p>
                  ) : null}
                </div>

                <footer className={styles.centerSessionModalFoot}>
                  <button
                    type="button"
                    className={styles.centerSessionModalBtn}
                    onClick={closeSessionActionModal}
                    disabled={sessionActionBusy}
                  >
                    Cancel
                  </button>

                  {sessionActionModal.type === "share" ? (
                    <button
                      type="button"
                      className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnPrimary].join(" ")}
                      onClick={() => void onShareSession()}
                      disabled={sessionActionBusy}
                    >
                      {sessionActionBusy
                        ? "Sharing..."
                        : shareMode === "external"
                          ? "Create link"
                          : "Share chat"}
                    </button>
                  ) : null}

                  {sessionActionModal.type === "rename" ? (
                    <button
                      type="button"
                      className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnPrimary].join(" ")}
                      onClick={() => void onRenameSession()}
                      disabled={sessionActionBusy || !s(renameDraftTitle)}
                    >
                      {sessionActionBusy ? "Saving..." : "Save"}
                    </button>
                  ) : null}

                  {sessionActionModal.type === "delete" ? (
                    <button
                      type="button"
                      className={[styles.centerSessionModalBtn, styles.centerSessionModalBtnDanger].join(" ")}
                      onClick={() => void onDeleteSession()}
                      disabled={sessionActionBusy}
                    >
                      {sessionActionBusy ? "Deleting..." : "Delete"}
                    </button>
                  ) : null}
                </footer>
              </section>
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
                aria-labelledby="cavcloud-attach-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className={styles.centerSessionModalHead}>
                  <h2 id="cavcloud-attach-title" className={styles.centerSessionModalTitle}>Upload From CavCloud</h2>
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
                    Choose a CavCloud file to attach to this prompt.
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

          {imageStudioImportModalOpen ? (
            <div
              className={styles.centerSessionModalOverlay}
              role="presentation"
              onClick={(event) => {
                if (event.currentTarget !== event.target) return;
                if (imageStudioImportBusy) return;
                setImageStudioImportModalOpen(false);
              }}
            >
              <section
                className={[styles.centerSessionModal, styles.imageStudioModal].join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="image-studio-import-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className={styles.centerSessionModalHead}>
                  <h2 id="image-studio-import-title" className={styles.centerSessionModalTitle}>Upload / Import Image</h2>
                  <button
                    type="button"
                    className={styles.centerSessionModalCloseBtn}
                    onClick={() => setImageStudioImportModalOpen(false)}
                    aria-label="Close dialog"
                    disabled={imageStudioImportBusy}
                  >
                    <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                  </button>
                </header>
                <div className={styles.centerSessionModalBody}>
                  <p className={styles.centerSessionModalCopy}>
                    Choose an image source for Image Studio / Image Edit.
                  </p>
                  <div className={styles.imageStudioImportSourceRow} role="tablist" aria-label="Image source">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={imageStudioImportSource === "device"}
                      className={[
                        styles.imageStudioImportSourceBtn,
                        imageStudioImportSource === "device" ? styles.imageStudioImportSourceBtnOn : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setImageStudioImportSource("device")}
                    >
                      Device
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={imageStudioImportSource === "cavcloud"}
                      className={[
                        styles.imageStudioImportSourceBtn,
                        imageStudioImportSource === "cavcloud" ? styles.imageStudioImportSourceBtnOn : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setImageStudioImportSource("cavcloud")}
                    >
                      CavCloud
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={imageStudioImportSource === "cavsafe"}
                      className={[
                        styles.imageStudioImportSourceBtn,
                        imageStudioImportSource === "cavsafe" ? styles.imageStudioImportSourceBtnOn : "",
                        !canUseCavSafeImageStorage ? styles.imageStudioImportSourceBtnLocked : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => {
                        if (!canUseCavSafeImageStorage) {
                          setError("CavSafe import requires Premium or Premium+.");
                          return;
                        }
                        setImageStudioImportSource("cavsafe");
                      }}
                    >
                      CavSafe
                      {!canUseCavSafeImageStorage ? <LockIcon width={12} height={12} aria-hidden="true" /> : null}
                    </button>
                  </div>

                  {imageStudioImportSource === "device" ? (
                    <div className={styles.imageStudioDeviceUploadPane}>
                      <button
                        type="button"
                        className={styles.imageStudioDeviceUploadBtn}
                        onClick={() => imageStudioImportInputRef.current?.click()}
                        disabled={imageStudioImportBusy}
                      >
                        {imageStudioImportBusy ? "Uploading..." : "Choose From Device"}
                      </button>
                      <p className={styles.centerSessionModalHint}>
                        Supported formats: PNG, JPG/JPEG, WEBP, GIF.
                      </p>
                    </div>
                  ) : (
                    <div className={styles.imageStudioImportGalleryWrap}>
                      {imageStudioLoadingSource ? (
                        <div className={styles.metaText}>Loading {imageStudioImportSource === "cavsafe" ? "CavSafe" : "CavCloud"} images...</div>
                      ) : activeImageStudioGallery.length ? (
                        <div className={styles.imageStudioImportGalleryGrid}>
                          {activeImageStudioGallery.map((file) => (
                            <button
                              key={file.id}
                              type="button"
                              className={styles.imageStudioImportGalleryItem}
                              onClick={() =>
                                void importImageStudioFromSource(
                                  imageStudioImportSource === "cavsafe" ? "cavsafe" : "cavcloud",
                                  file.id
                                )
                              }
                              disabled={imageStudioImportBusy}
                              title={file.name}
                            >
                              <span className={styles.imageStudioImportGalleryName}>{file.name}</span>
                              <span className={styles.imageStudioImportGalleryMeta}>
                                {Math.max(1, Math.round(file.bytes / 1024))} KB · {toIsoTime(file.updatedAtISO)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.imageStudioImportEmpty}>
                          No image files available in {imageStudioImportSource === "cavsafe" ? "CavSafe" : "CavCloud"}.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <footer className={styles.centerSessionModalFoot}>
                  <button
                    type="button"
                    className={styles.centerSessionModalBtn}
                    onClick={() => setImageStudioImportModalOpen(false)}
                    disabled={imageStudioImportBusy}
                  >
                    Close
                  </button>
                </footer>
              </section>
            </div>
          ) : null}

          {imageStudioSaveModalOpen ? (
            <div
              className={styles.centerSessionModalOverlay}
              role="presentation"
              onClick={(event) => {
                if (event.currentTarget !== event.target) return;
                if (imageStudioSaveBusy) return;
                setImageStudioSaveModalOpen(false);
              }}
            >
              <section
                className={[styles.centerSessionModal, styles.imageStudioModal].join(" ")}
                role="dialog"
                aria-modal="true"
                aria-labelledby="image-studio-save-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className={styles.centerSessionModalHead}>
                  <h2 id="image-studio-save-title" className={styles.centerSessionModalTitle}>Save Image</h2>
                  <button
                    type="button"
                    className={styles.centerSessionModalCloseBtn}
                    onClick={() => setImageStudioSaveModalOpen(false)}
                    aria-label="Close dialog"
                    disabled={imageStudioSaveBusy}
                  >
                    <span className={styles.centerSessionModalCloseGlyph} aria-hidden="true" />
                  </button>
                </header>
                <div className={styles.centerSessionModalBody}>
                  <p className={styles.centerSessionModalCopy}>
                    Choose where to save this image asset.
                  </p>
                  <div className={styles.imageStudioSaveOptions}>
                    <button
                      type="button"
                      className={styles.imageStudioSaveOptionBtn}
                      onClick={() => void saveImageStudioAsset("cavcloud")}
                      disabled={imageStudioSaveBusy}
                    >
                      Save to CavCloud
                    </button>
                    <button
                      type="button"
                      className={[
                        styles.imageStudioSaveOptionBtn,
                        !canUseCavSafeImageStorage ? styles.imageStudioSaveOptionBtnLocked : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => {
                        if (!canUseCavSafeImageStorage) {
                          setError("CavSafe save requires Premium or Premium+.");
                          return;
                        }
                        void saveImageStudioAsset("cavsafe");
                      }}
                      disabled={imageStudioSaveBusy}
                    >
                      Save to CavSafe
                      {!canUseCavSafeImageStorage ? <LockIcon width={12} height={12} aria-hidden="true" /> : null}
                    </button>
                    <button
                      type="button"
                      className={styles.imageStudioSaveOptionBtn}
                      onClick={() => void saveImageStudioAsset("device")}
                      disabled={imageStudioSaveBusy}
                    >
                      Save to Device
                    </button>
                  </div>
                </div>
                <footer className={styles.centerSessionModalFoot}>
                  <button
                    type="button"
                    className={styles.centerSessionModalBtn}
                    onClick={() => setImageStudioSaveModalOpen(false)}
                    disabled={imageStudioSaveBusy}
                  >
                    Cancel
                  </button>
                </footer>
              </section>
            </div>
          ) : null}

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
                <div className={styles.centerImageViewerCanvas}>
                  {showComposerViewerNavigation ? (
                    <button
                      type="button"
                      className={[styles.centerImageViewerNavBtn, styles.centerImageViewerNavBtnPrev].join(" ")}
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
                  <Image
                    src={activeComposerImageViewer.dataUrl}
                    alt={activeComposerImageViewer.name}
                    width={1280}
                    height={1280}
                    unoptimized
                    className={styles.centerImageViewerMedia}
                  />
                  {showComposerViewerNavigation ? (
                    <button
                      type="button"
                      className={[styles.centerImageViewerNavBtn, styles.centerImageViewerNavBtnNext].join(" ")}
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

          {showInlineError ? (
            <div className={error === RECENT_FILES_EMPTY_HINT ? styles.centerNotice : styles.centerError}>
              {error}
            </div>
          ) : null}

          {!centerComposerInThread ? <footer className={styles.centerComposer}>{composerContent}</footer> : null}
          {showSignedOutMobileLegal ? (
            <footer className={styles.centerGuestMobileLegal}>
              <span>By using CavAi, you agree to the </span>
              <a href={CAVAI_TERMS_OF_USE_HREF} target="_blank" rel="noopener noreferrer">Terms</a>
              <span> and </span>
              <a href={CAVAI_PRIVACY_POLICY_HREF} target="_blank" rel="noopener noreferrer">Privacy Policy</a>
              <span>.</span>
            </footer>
          ) : null}
        </section>
      </section>
    </div>
  );
}
