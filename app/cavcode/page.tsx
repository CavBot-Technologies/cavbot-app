"use client";

/**
 * CavCode — CavBot Code Editor (Monaco) — VS Code-class shell (no toy UI)
 *
 * Install:
 *   npm i monaco-editor @monaco-editor/react
 */

import "./cavcode.css";
import "@/components/CavBotLoadingScreen.css";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffEditorProps, EditorProps } from "@monaco-editor/react";
import type * as MonacoType from "monaco-editor";
import type { WorkspaceNode } from "@/src/lib/cavTerminal";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import { CavGuardModal } from "@/components/CavGuardModal";
import { LockIcon } from "@/components/LockIcon";
import CavAiCodeWorkspace, {
  type CavCodeDiagnostic,
  type CavenWorkspaceUploadFileRef,
} from "@/components/cavai/CavAiCodeWorkspace";
import {
  toCodebaseAbs,
} from "@/src/lib/codebaseFs";
import { inferSyncMimeType, upsertCavcloudTextFile } from "@/lib/cavcloud/sync.client";
import type { FsNode, FsState } from "@/src/lib/codebaseFs";
import { KNOWN_COMMANDS, runCavCommand } from "@/src/lib/cavTerminal";
import type { CavContext } from "@/src/lib/cavTerminal";
import {
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_CODER_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  rankDefaultModelForUi,
  resolveAiModelLabel,
} from "@/src/lib/ai/model-catalog";
import { toReasoningDisplayHelper, toReasoningDisplayLabel } from "@/src/lib/ai/reasoning-display";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";

type MonacoApi = typeof import("monaco-editor");
type MonacoDefaults = {
  setDiagnosticsOptions: (opts: Record<string, unknown>) => void;
  setCompilerOptions: (opts: Record<string, unknown>) => void;
  setEagerModelSync?: (v: boolean) => void;
  addExtraLib?: (content: string, filePath?: string) => void;
};
type MonacoLangs = {
  html?: { htmlDefaults?: { setOptions?: (opts: Record<string, unknown>) => void } };
  css?: {
    cssDefaults?: { setOptions?: (opts: Record<string, unknown>) => void };
    lessDefaults?: { setOptions?: (opts: Record<string, unknown>) => void };
    scssDefaults?: { setOptions?: (opts: Record<string, unknown>) => void };
  };
  json?: { jsonDefaults?: { setDiagnosticsOptions?: (opts: Record<string, unknown>) => void } };
  typescript?: {
    typescriptDefaults?: MonacoDefaults;
    javascriptDefaults?: MonacoDefaults;
    ScriptTarget?: Record<string, unknown>;
    ModuleKind?: Record<string, unknown>;
    ModuleResolutionKind?: Record<string, unknown>;
    JsxEmit?: Record<string, unknown>;
  };
};

/** @monaco-editor/react default export is the Editor component */
const MonacoEditor = dynamic(async () => {
  const mod = await import("@monaco-editor/react");
  return mod.default;
}, { ssr: false }) as React.ComponentType<EditorProps>;
const MonacoDiffEditor = dynamic(async () => {
  const mod = await import("@monaco-editor/react");
  return mod.DiffEditor;
}, { ssr: false }) as React.ComponentType<DiffEditorProps>;

/* =========================
  Types
========================= */
type Lang = string;

type FileNode = {
  id: string;
  kind: "file";
  name: string;
  lang: Lang;
  path: string;
  content: string;

  // Optional: if sourced from the user's actual computer folder (File System Access API)
  fsHandle?: FileSystemFileHandle | null;
};

type FolderNode = {
  id: string;
  kind: "folder";
  name: string;
  path: string;
  children: Array<FileNode | FolderNode>;

  // Optional: if sourced from the user's actual computer folder (File System Access API)
  dirHandle?: FileSystemDirectoryHandle | null;
};

type Node = FileNode | FolderNode;

type GitCompareMode = "staged" | "unstaged";
type TabKind = "file" | "skills" | "git-compare-single" | "git-compare-aggregate";

type Tab = {
  id: string;
  path: string;
  name: string;
  lang: Lang;
  kind?: TabKind;
};

type EditorPane = "primary" | "secondary";
type SplitLayout = "single" | "right" | "down";

type Problem = {
  severity: "error" | "warn" | "info";
  message: string;
  file: string;
  line: number;
  col: number;
  source: string;
  code?: string;
  fixReady?: boolean;
};

type PanelTab = "problems" | "output" | "debug" | "terminal" | "ports" | "git" | "run";
type Activity = "explorer" | "search" | "scm" | "changes" | "extensions" | "live" | "run" | "settings" | "ai";

type ThemeOption = "cavbot-default" | "cavbot-light" | "cavbot-lime" | "cavbot-classic" | "cavbot-dark";
type CavenComposerEnterBehavior = "enter" | "meta_enter";
type CavenReasoningLevel = "low" | "medium" | "high" | "extra_high";
type CavenInferenceSpeed = "standard" | "fast";
type SkillsPageView = "agents" | "general" | "ide";

type EditorSettings = {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  formatOnSave: boolean;
  autosave: boolean;
  telemetry: boolean;
  theme: ThemeOption;
  syncToCavcloud: boolean;
};

type CavenIdeSettings = {
  defaultModelId: string;
  inferenceSpeed: CavenInferenceSpeed;
  queueFollowUps: boolean;
  composerEnterBehavior: CavenComposerEnterBehavior;
  includeIdeContext: boolean;
  confirmBeforeApplyPatch: boolean;
  autoOpenResolvedFiles: boolean;
  showReasoningTimeline: boolean;
  telemetryOptIn: boolean;
  defaultReasoningLevel: CavenReasoningLevel;
};

type ProjectCollaborator = {
  userId: string;
  email: string;
  displayName: string | null;
  role: "VIEWER" | "EDITOR" | "ADMIN";
};

type WorkspaceMemberOption = {
  userId: string;
  email: string;
  displayName: string | null;
};

type CavCodeProjectFileRef = {
  path: string;
  name: string;
  lang: string;
  relativePath: string;
};

type CavCodeWorkspaceSnapshot = {
  version: 1 | 2;
  fs: FolderNode;
  tabs: Tab[];
  activeFileId: string;
  activeProjectRootPath?: string | null;
};

type DeepLinkEditorPosition = {
  line: number;
  col: number;
};

type IdeAgentCard = {
  id: string;
  name: string;
  summary: string;
  iconSrc: string;
  iconBackground?: string | null;
  actionKey: string;
  surface: "cavcode" | "center" | "all";
  defaultInstalled: boolean;
  minimumPlan?: "free" | "premium" | "premium_plus";
};

type BuiltInRegistryCard = {
  id: string;
  name: string;
  summary: string;
  iconSrc: string;
  actionKey: string;
  cavcodeAction: string | null;
  centerAction: string | null;
  minimumPlan: "free" | "premium" | "premium_plus";
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

type CustomCavenAgentRecord = {
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
};

type AgentBuilderAiMode = "help_write" | "generate_agent";
type CommitMessageAiMode = "help_write" | "generate_message";
type AgentBuilderReasoningLevel = "low" | "medium" | "high" | "extra_high";
type AgentBuilderControlMenu = "model" | "reasoning" | null;
type AgentBuilderModelOption = {
  id: string;
  label: string;
};
type AgentBuilderDraftResult = {
  name: string;
  summary: string;
  triggers: string[];
  instructions: string;
  surface: "cavcode" | "center" | "all";
};

const THEME_OPTIONS: Array<{ value: ThemeOption; label: string }> = [
  { value: "cavbot-default", label: "CavBot Default" },
  { value: "cavbot-light", label: "CavBot Light" },
  { value: "cavbot-lime", label: "CavBot Lime" },
  { value: "cavbot-classic", label: "CavBot Classic" },
  { value: "cavbot-dark", label: "CavBot Dark" },
];
const THEME_VALUES = THEME_OPTIONS.map((option) => option.value);

const CAVCODE_WORKSPACE_STATE_SAVE_DEBOUNCE_MS = 650;
const CAVEN_CUSTOM_AGENT_ICON_SRC = "/icons/app/cavcode/agents/custom-agent.svg";
const MAX_CUSTOM_AGENT_ICON_SVG_CHARS = 120_000;
const DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND = "#4EA8FF";
const AGENT_CREATE_PROMPT_HINT_INTERVAL_MS = 6800;
const AGENT_CREATE_PROMPT_HINTS_EMPTY = [
  "Create a frontend QA agent that checks accessibility, responsiveness, and spacing before merge.",
  "Draft an incident response agent for production issues with triage steps and rollback checks.",
  "Generate an SEO audit agent for metadata, headings, and internal-link quality.",
];
const AGENT_CREATE_PROMPT_HINTS_FILLED = [
  "Tighten this into production-ready instructions with stricter guardrails and outputs.",
  "Rewrite this agent to be clearer, shorter, and safer for junior developers.",
  "Improve this draft with better triggers and stronger step-by-step execution rules.",
];
const COMMIT_MESSAGE_PROMPT_HINTS_EMPTY = [
  "Create a concise commit message for staged UI fixes and accessibility updates.",
  "Generate a commit message for refactoring auth checks and error handling.",
  "Write a commit message for introducing a new CavAi action in the Changes panel.",
];
const COMMIT_MESSAGE_PROMPT_HINTS_FILLED = [
  "Rewrite this commit message to be clearer and action-oriented.",
  "Keep the same intent but make this commit title shorter and more specific.",
  "Improve this commit message so reviewers can understand the change at a glance.",
];
const AGENT_BUILDER_REASONING_OPTIONS: Array<{ value: AgentBuilderReasoningLevel; label: string }> = [
  { value: "low", label: toReasoningDisplayLabel("low") },
  { value: "medium", label: toReasoningDisplayLabel("medium") },
  { value: "high", label: toReasoningDisplayLabel("high") },
  { value: "extra_high", label: toReasoningDisplayLabel("extra_high") },
];
const DEFAULT_AGENT_BUILDER_REASONING_LEVELS: AgentBuilderReasoningLevel[] = ["low", "medium"];
const LIVE_VIEWER_URL = "/cavcode-viewer";

const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 12,
  tabSize: 2,
  wordWrap: true,
  minimap: true,
  formatOnSave: false,
  autosave: true,
  telemetry: false,
  theme: "cavbot-default",
  syncToCavcloud: false,
};
const CAVEN_REASONING_LEVEL_OPTIONS: Array<{ value: CavenReasoningLevel; label: string }> = [
  { value: "low", label: toReasoningDisplayLabel("low") },
  { value: "medium", label: toReasoningDisplayLabel("medium") },
  { value: "high", label: toReasoningDisplayLabel("high") },
  { value: "extra_high", label: toReasoningDisplayLabel("extra_high") },
];
const DEFAULT_CAVEN_IDE_SETTINGS: CavenIdeSettings = {
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
};
const CAVEN_GENERAL_MODEL_BASE_IDS = [
  ALIBABA_QWEN_CODER_MODEL_ID,
] as const;

const CAVCODE_SKILLS_TAB_ID = "__cavcode_skills__";
const CAVCODE_SKILLS_TAB_META: Record<SkillsPageView, { path: string; name: string; lang: string }> = {
  agents: {
    path: "/.cavcode/caven-agents",
    name: "Caven Agents",
    lang: "agents",
  },
  general: {
    path: "/.cavcode/caven-general",
    name: "Caven General",
    lang: "general",
  },
  ide: {
    path: "/.cavcode/caven-ide-settings",
    name: "Caven IDE Settings",
    lang: "ide",
  },
};
const CAVCODE_AGENT_CATALOG: IdeAgentCard[] = [
  {
    id: "error_explainer",
    name: "Error Explainer",
    summary: "Break down compiler and runtime errors into plain language with likely causes.",
    iconSrc: "/icons/app/alert-caution-error-svgrepo-com.svg",
    actionKey: "explain_error",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "fix_draft",
    name: "Fix Draft",
    summary: "Generate an initial patch proposal for a bug with low-risk defaults.",
    iconSrc: "/icons/app/cavcode/agents/repairing-browser-svgrepo-com.svg",
    actionKey: "suggest_fix",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "safe_refactor",
    name: "Safe Refactor",
    summary: "Refactor code while preserving behavior and reducing accidental regressions.",
    iconSrc: "/icons/app/cavcode/agents/security-priority-svgrepo-com.svg",
    actionKey: "refactor_safely",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "code_explainer",
    name: "Code Explainer",
    summary: "Explain complex files and call flows quickly for onboarding and review.",
    iconSrc: "/icons/app/cavcode/agents/compile-compiler-script-code-config-svgrepo-com.svg",
    actionKey: "explain_code",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "file_summarizer",
    name: "File Summarizer",
    summary: "Summarize large files into concise technical notes and key takeaways.",
    iconSrc: "/icons/app/cavcode/agents/note-favorite-svgrepo-com.svg",
    actionKey: "summarize_file",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "component_builder",
    name: "Component Builder",
    summary: "Generate reusable UI components with consistent structure and naming.",
    iconSrc: "/icons/app/cavcode/agents/web-application-svgrepo-com.svg",
    actionKey: "generate_component",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "section_builder",
    name: "Section Builder",
    summary: "Draft complete page sections from intent, content, and layout direction.",
    iconSrc: "/icons/app/cavcode/agents/window-section-svgrepo-com.svg",
    actionKey: "generate_section",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "page_builder",
    name: "Page Builder",
    summary: "Generate full page scaffolds with coherent structure and implementation hints.",
    iconSrc: "/icons/app/cavcode/agents/page-builder-clean.svg",
    actionKey: "generate_page",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "seo_improver",
    name: "SEO Improver",
    summary: "Improve metadata, headings, and content structure for search discoverability.",
    iconSrc: "/icons/app/cavcode/agents/seo-svgrepo-com.svg",
    actionKey: "improve_seo",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "engineering_note",
    name: "Engineering Note",
    summary: "Write clean changelogs, technical notes, and implementation summaries.",
    iconSrc: "/icons/app/cavcode/agents/engineering-svgrepo-com.svg",
    actionKey: "write_note",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "competitor_intelligence",
    name: "Competitor Intelligence",
    summary: "Research competitor products, positioning, pricing, and feature gaps with evidence-first comparisons.",
    iconSrc: "/icons/app/chart-bubble-svgrepo-com.svg",
    actionKey: "competitor_research",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "accessibility_auditor",
    name: "Accessibility Auditor",
    summary: "Audit code for WCAG and a11y risks, then propose practical remediation steps and patches.",
    iconSrc: "/icons/app/cavcode/agents/accessibility-svgrepo-com.svg",
    actionKey: "accessibility_audit",
    surface: "cavcode",
    defaultInstalled: true,
  },
  {
    id: "ui_mockup_generator",
    name: "UI Mockup Generator",
    summary: "Generate UI mockups with paired implementation code for websites and apps.",
    iconSrc: "/icons/app/atom-ai-svgrepo-com.svg",
    actionKey: "ui_mockup_generator",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "website_visual_builder",
    name: "Website Visual Builder",
    summary: "Create website-ready visual assets and variants for pages, features, and campaigns.",
    iconSrc: "/icons/app/wireframe-svgrepo-com.svg",
    actionKey: "website_visual_builder",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "app_screenshot_enhancer",
    name: "App Screenshot Enhancer",
    summary: "Enhance product screenshots into marketing-ready visuals with advanced image editing.",
    iconSrc: "/icons/app/screenshot-2-svgrepo-com.svg",
    actionKey: "app_screenshot_enhancer",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium_plus",
  },
  {
    id: "brand_asset_generator",
    name: "Brand Asset Generator",
    summary: "Generate branded icons, banners, and campaign visuals aligned with your product identity.",
    iconSrc: "/icons/app/star-rings-svgrepo-com.svg",
    actionKey: "brand_asset_generator",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "ui_debug_visualizer",
    name: "UI Debug Visualizer",
    summary: "Visualize expected UI states and suggest practical code fixes for layout mismatches.",
    iconSrc: "/icons/app/bug-fix-search-virus-debug-find-svgrepo-com.svg",
    actionKey: "ui_debug_visualizer",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium_plus",
  },
  {
    id: "financial_advisor",
    name: "Financial Advisor",
    summary: "Clarify budgeting, tradeoffs, and money decisions with practical planning support.",
    iconSrc: "/icons/finance-symbol-of-four-currencies-on-a-hand-svgrepo-com.svg",
    actionKey: "financial_advisor",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "therapist_support",
    name: "Therapist Support",
    summary: "Offer reflective grounding and emotional processing support without clinical claims.",
    iconSrc: "/icons/friend-svgrepo-com.svg",
    actionKey: "therapist_support",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "mentor",
    name: "Mentor",
    summary: "Drive disciplined growth with direct guidance on next moves and long-term direction.",
    iconSrc: "/icons/person-svgrepo-com.svg",
    actionKey: "mentor",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "best_friend",
    name: "Best Friend",
    summary: "Bring warm perspective, encouragement, and honest support in daily decision-making.",
    iconSrc: "/icons/teddy-bear-with-heart-svgrepo-com.svg",
    actionKey: "best_friend",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "relationship_advisor",
    name: "Relationship Advisor",
    summary: "Help frame communication and conflict with balanced emotional perspective.",
    iconSrc: "/icons/relationship-counseling-marriage-counseling-couples-therapy-marriage-therapy-svgrepo-com.svg",
    actionKey: "relationship_advisor",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "philosopher",
    name: "Philosopher",
    summary: "Expand perspective with deeper framing on meaning, values, and direction.",
    iconSrc: "/icons/priest-2-svgrepo-com.svg",
    actionKey: "philosopher",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "focus_coach",
    name: "Focus Coach",
    summary: "Reduce overwhelm, prioritize clearly, and convert intent into immediate execution.",
    iconSrc: "/icons/focus-svgrepo-com.svg",
    actionKey: "focus_coach",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "life_strategist",
    name: "Life Strategist",
    summary: "Connect life goals and work goals with practical sequencing and action clarity.",
    iconSrc: "/icons/achievement-2-svgrepo-com.svg",
    actionKey: "life_strategist",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "email_text_agent",
    name: "Messenger",
    summary: "Draft and rewrite messages with flexible professional or personal tone.",
    iconSrc: "/icons/smartphone-2-svgrepo-com.svg",
    actionKey: "email_text_agent",
    surface: "center",
    defaultInstalled: false,
  },
  {
    id: "content_creator",
    name: "Content Creator",
    summary: "Generate titles, sections, and structured website or campaign copy blocks.",
    iconSrc: "/icons/app/aperture-svgrepo-com.svg",
    actionKey: "content_creator",
    surface: "center",
    defaultInstalled: false,
  },
  {
    id: "legal_privacy_terms_ethics_agent",
    name: "Counsel",
    summary: "Draft policy and terms-style language with compliance-oriented framing.",
    iconSrc: "/icons/legal-hammer-symbol-svgrepo-com.svg",
    actionKey: "legal_privacy_terms_ethics_agent",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "pdf_create_edit_preview_agent",
    name: "PDF Studio",
    summary: "Create, refine, and preview PDF outputs for clean document workflows.",
    iconSrc: "/icons/pdf-file-svgrepo-com.svg",
    actionKey: "pdf_create_edit_preview_agent",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "page_404_builder_agent",
    name: "404 Builder",
    summary: "Build 404 route content and page structure for polished not-found UX.",
    iconSrc: "/icons/link-broken-svgrepo-com.svg",
    actionKey: "page_404_builder_agent",
    surface: "center",
    defaultInstalled: false,
  },
  {
    id: "doc_edit_review_agent",
    name: "Doc Review",
    summary: "Review, edit, and restructure documents for clarity and quality.",
    iconSrc: "/icons/doc-on-doc-fill-svgrepo-com.svg",
    actionKey: "doc_edit_review_agent",
    surface: "center",
    defaultInstalled: false,
  },
  {
    id: "web_research_analyst",
    name: "Web Research Analyst",
    summary: "Synthesize external signals into actionable insights for technical decisions.",
    iconSrc: "/icons/app/connection-svgrepo-com.svg",
    actionKey: "web_research",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "incident_analyst",
    name: "Incident Analyst",
    summary: "Digest issue spikes and produce prioritized incident response recommendations.",
    iconSrc: "/icons/app/cavcode/agents/alert-symbol-svgrepo-com.svg",
    actionKey: "summarize_issues",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "storage_organizer",
    name: "Storage Organizer",
    summary: "Recommend cleaner folder structures and artifact organization patterns.",
    iconSrc: "/icons/app/storage-svgrepo-com.svg",
    actionKey: "organize_storage",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "access_auditor",
    name: "Access Auditor",
    summary: "Explain access constraints and flag risky sharing or permission gaps.",
    iconSrc: "/icons/app/cavcode/agents/grapheneos-auditor-svgrepo-com.svg",
    actionKey: "audit_access_context",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "thread_summarizer",
    name: "Thread Summarizer",
    summary: "Condense long threads into clear summaries and rewrite drafts for clarity.",
    iconSrc: "/icons/app/cavcode/agents/message-basic-app-conversation-chat-svgrepo-com.svg",
    actionKey: "summarize_thread",
    surface: "center",
    defaultInstalled: true,
  },
  {
    id: "knowledge_grounding_curator",
    name: "Knowledge Grounding",
    summary: "Ingest docs/pages into retrieval-ready context packs with citations-first grounding.",
    iconSrc: "/icons/app/deep-learning-svgrepo-com.svg",
    actionKey: "knowledge_grounding",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "deterministic_research_planner",
    name: "Deterministic Research Planner",
    summary: "Break one request into deterministic sub-queries and return an evidence matrix.",
    iconSrc: "/icons/app/research-svgrepo-com.svg",
    actionKey: "deterministic_research",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "citation_only_answerer",
    name: "Citation-Only Answerer",
    summary: "Answer strictly from retrieved sources with confidence signals and cited claims.",
    iconSrc: "/icons/app/block-quote-svgrepo-com.svg",
    actionKey: "citation_only_answer",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "prompt_compiler",
    name: "Prompt Compiler",
    summary: "Compile vague requests into structured prompts with constraints and output contracts.",
    iconSrc: "/icons/cavpad/sparkles-svgrepo-com.svg",
    actionKey: "compile_prompt",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "memory_curator",
    name: "Memory Curator",
    summary: "Distill conversations into durable, versioned facts and decision memory.",
    iconSrc: "/icons/app/memory-svgrepo-com.svg",
    actionKey: "curate_memory",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "grounding_gap_detector",
    name: "Grounding Gap Detector",
    summary: "Detect weak grounding, missing evidence, and ask targeted follow-up questions.",
    iconSrc: "/icons/app/grid-3x3-gap-fill-svgrepo-com.svg",
    actionKey: "detect_grounding_gaps",
    surface: "center",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "execution_critic",
    name: "Execution Critic",
    summary: "Run pre-send QA on drafts to catch drift, missing steps, and constraints mismatch.",
    iconSrc: "/icons/app/operation-and-maintenance-center-execution-record-svgrepo-com.svg",
    actionKey: "critique_execution",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "spec_to_tasks_orchestrator",
    name: "Spec-to-Tasks Orchestrator",
    summary: "Convert product intent into deterministic task graphs with ordered implementation steps.",
    iconSrc: "/icons/app/graph-bar-svgrepo-com.svg",
    actionKey: "orchestrate_spec_tasks",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium",
  },
  {
    id: "api_schema_contract_guard",
    name: "API Schema Contract Guard",
    summary: "Validate changes against API and schema contracts before execution and rollout.",
    iconSrc: "/icons/app/api-app-svgrepo-com.svg",
    actionKey: "guard_api_contracts",
    surface: "cavcode",
    defaultInstalled: false,
    minimumPlan: "premium_plus",
  },
];

const DEFAULT_INSTALLED_AGENT_IDS: string[] = [];

const CAVCODE_AGENT_ID_SET = new Set(CAVCODE_AGENT_CATALOG.map((agent) => agent.id));

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
      const id = String(card.id || "").trim().toLowerCase();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push(card);
    }
  }
  return rows;
}

function normalizeInstalledAgentIdsFromUnknown(
  value: unknown,
  fallback: string[],
  customAgentIds?: ReadonlySet<string>,
  knownBuiltInIds?: readonly string[]
): string[] {
  const effectiveBuiltInIds = (knownBuiltInIds && knownBuiltInIds.length)
    ? knownBuiltInIds
    : CAVCODE_AGENT_CATALOG.map((agent) => agent.id);
  const knownBuiltInSet = new Set(
    effectiveBuiltInIds
      .map((id) => String(id || "").trim().toLowerCase())
      .filter(Boolean)
  );
  if (!Array.isArray(value)) return [...fallback];
  const customIds = customAgentIds || new Set<string>();
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const row of value) {
    const id = String(row || "").trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    if (!knownBuiltInSet.has(id) && !customIds.has(id)) continue;
    seen.add(id);
    rows.push(id);
  }
  if (!rows.length) return [...fallback];
  const orderedBuiltIn = [...knownBuiltInSet].filter((id) => seen.has(id));
  const orderedCustom = rows.filter((id) => !knownBuiltInSet.has(id));
  return [...orderedBuiltIn, ...orderedCustom];
}

function toAgentSlug(input: string) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reasoningLevelRank(level: AgentBuilderReasoningLevel): number {
  if (level === "low") return 1;
  if (level === "medium") return 2;
  if (level === "high") return 3;
  return 4;
}

function parseAgentBuilderReasoningLevel(value: unknown): AgentBuilderReasoningLevel | null {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "extra_high") return raw;
  return null;
}

function reasoningLevelsUpTo(maxRaw: unknown): AgentBuilderReasoningLevel[] {
  const max = parseAgentBuilderReasoningLevel(maxRaw);
  if (!max) return DEFAULT_AGENT_BUILDER_REASONING_LEVELS;
  return AGENT_BUILDER_REASONING_OPTIONS
    .map((option) => option.value)
    .filter((level) => reasoningLevelRank(level) <= reasoningLevelRank(max));
}

function reasoningLevelsForPlan(planIdRaw: unknown): AgentBuilderReasoningLevel[] {
  const plan = String(planIdRaw || "").trim().toLowerCase();
  if (plan === "premium_plus") return ["low", "medium", "high", "extra_high"];
  if (plan === "premium") return ["low", "medium", "high"];
  return DEFAULT_AGENT_BUILDER_REASONING_LEVELS;
}

function normalizePlanId(value: unknown): "free" | "premium" | "premium_plus" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "premium_plus" || raw === "premium+") return "premium_plus";
  if (raw === "premium") return "premium";
  return "free";
}

function planTierRank(planId: "free" | "premium" | "premium_plus"): number {
  if (planId === "premium_plus") return 3;
  if (planId === "premium") return 2;
  return 1;
}

function isAgentPlanEligible(
  accountPlanId: unknown,
  minimumPlan: "free" | "premium" | "premium_plus"
): boolean {
  const normalizedAccountPlan = normalizePlanId(accountPlanId);
  return planTierRank(normalizedAccountPlan) >= planTierRank(minimumPlan);
}

function normalizeBuiltInRegistryCard(value: unknown): BuiltInRegistryCard | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim().toLowerCase();
  const name = String(row.name || "").trim();
  if (!id || !name) return null;
  const minimumPlan = normalizePlanId(row.minimumPlan);
  return {
    id,
    name,
    summary: String(row.summary || "").trim(),
    iconSrc: String(row.iconSrc || "").trim(),
    actionKey: String(row.actionKey || "").trim().toLowerCase(),
    cavcodeAction: String(row.cavcodeAction || "").trim().toLowerCase() || null,
    centerAction: String(row.centerAction || "").trim().toLowerCase() || null,
    minimumPlan,
    installed: row.installed === true,
    locked: row.locked === true,
    bank: String(row.bank || "").trim().toLowerCase(),
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
    generatedAt: String(row.generatedAt || "").trim(),
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
      ? row.hiddenSystemIds.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

function requiredPlanLabel(planId: "free" | "premium" | "premium_plus"): "Free" | "Premium" | "Premium+" {
  if (planId === "premium_plus") return "Premium+";
  if (planId === "premium") return "Premium";
  return "Free";
}

function normalizeReasoningOptions(raw: unknown): AgentBuilderReasoningLevel[] {
  if (!Array.isArray(raw)) return [];
  const parsed = raw
    .map((item) => parseAgentBuilderReasoningLevel(item))
    .filter(Boolean) as AgentBuilderReasoningLevel[];
  const unique = Array.from(new Set(parsed));
  return AGENT_BUILDER_REASONING_OPTIONS.map((option) => option.value).filter((level) => unique.includes(level));
}

function toModelOptionFromUnknown(value: unknown): AgentBuilderModelOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id) return null;
  return {
    id,
    label: resolveAiModelLabel(id),
  };
}

const AGENT_BUILDER_EXCLUDED_MODEL_IDS = new Set<string>([
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
]);

function normalizeAgentBuilderModelOptions(options: AgentBuilderModelOption[]): AgentBuilderModelOption[] {
  const map = new Map<string, AgentBuilderModelOption>();
  for (const option of options) {
    const id = String(option.id || "").trim();
    if (!id || id.toLowerCase() === "auto" || AGENT_BUILDER_EXCLUDED_MODEL_IDS.has(id)) continue;
    if (map.has(id)) continue;
    map.set(id, {
      id,
      label: resolveAiModelLabel(id),
    });
  }
  if (!map.size) {
    map.set(DEEPSEEK_CHAT_MODEL_ID, {
      id: DEEPSEEK_CHAT_MODEL_ID,
      label: resolveAiModelLabel(DEEPSEEK_CHAT_MODEL_ID),
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const rankDiff = rankDefaultModelForUi(a.id) - rankDefaultModelForUi(b.id);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
}

function agentBuilderPlanModelIds(planIdRaw: unknown): string[] {
  const planId = normalizePlanId(planIdRaw);
  const ids = [
    DEEPSEEK_CHAT_MODEL_ID,
    ALIBABA_QWEN_FLASH_MODEL_ID,
  ];
  if (planId === "premium" || planId === "premium_plus") {
    ids.push(
      DEEPSEEK_REASONER_MODEL_ID,
      ALIBABA_QWEN_PLUS_MODEL_ID
    );
  }
  if (planId === "premium_plus") {
    ids.push(ALIBABA_QWEN_MAX_MODEL_ID);
  }
  return Array.from(new Set(ids));
}

function agentBuilderPlanModelOptions(planIdRaw: unknown): AgentBuilderModelOption[] {
  return agentBuilderPlanModelIds(planIdRaw).map((id) => ({
    id,
    label: resolveAiModelLabel(id),
  }));
}

function mergeAgentBuilderModelOptionsWithPlan(
  options: AgentBuilderModelOption[],
  planIdRaw: unknown
): AgentBuilderModelOption[] {
  return normalizeAgentBuilderModelOptions([
    ...agentBuilderPlanModelOptions(planIdRaw),
    ...options,
  ]);
}

function mergeAgentBuilderReasoningOptionsWithPlan(
  options: AgentBuilderReasoningLevel[],
  planIdRaw: unknown
): AgentBuilderReasoningLevel[] {
  const set = new Set<AgentBuilderReasoningLevel>([
    ...reasoningLevelsForPlan(planIdRaw),
    ...options,
  ]);
  return AGENT_BUILDER_REASONING_OPTIONS
    .map((option) => option.value)
    .filter((level) => set.has(level));
}

function normalizeAgentSurfaceFromUnknown(value: unknown): "cavcode" | "center" | "all" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "cavcode" || raw === "center" || raw === "all") return raw;
  return "all";
}

function normalizeAgentBuilderDraftFromUnknown(value: unknown): AgentBuilderDraftResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = String(row.name || "").trim().replace(/\s+/g, " ");
  const summary = String(row.summary || "").trim().replace(/\s+/g, " ");
  const instructions = String(row.instructions || "").trim();
  const triggers = Array.isArray(row.triggers)
    ? row.triggers.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
    : String(row.triggers || "")
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  if (!name || !summary || !instructions) return null;
  return {
    name: name.slice(0, 64),
    summary: summary.slice(0, 220),
    triggers,
    instructions: instructions.slice(0, 12000),
    surface: normalizeAgentSurfaceFromUnknown(row.surface),
  };
}

function parseAgentBuilderDraftFromText(value: unknown): AgentBuilderDraftResult | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = (() => {
    try {
      return normalizeAgentBuilderDraftFromUnknown(JSON.parse(raw));
    } catch {
      return null;
    }
  })();
  if (direct) return direct;

  const codeFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFence?.[1]) {
    try {
      const parsed = JSON.parse(codeFence[1].trim());
      const normalized = normalizeAgentBuilderDraftFromUnknown(parsed);
      if (normalized) return normalized;
    } catch {
      // fall through
    }
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      return normalizeAgentBuilderDraftFromUnknown(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function buildAgentCreatePromptHint(hasDraftContent: boolean): string {
  const pool = hasDraftContent ? AGENT_CREATE_PROMPT_HINTS_FILLED : AGENT_CREATE_PROMPT_HINTS_EMPTY;
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)] || pool[0] || "";
}

function buildCommitMessagePromptHint(hasDraftContent: boolean): string {
  const pool = hasDraftContent ? COMMIT_MESSAGE_PROMPT_HINTS_FILLED : COMMIT_MESSAGE_PROMPT_HINTS_EMPTY;
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)] || pool[0] || "";
}

function normalizeCommitMessageFromAi(value: unknown): string {
  const raw = String(value || "").replace(/\r/g, "\n").trim();
  if (!raw) return "";
  const codeFence = raw.match(/```(?:text|md|markdown)?\s*([\s\S]*?)```/i);
  const candidateRaw = codeFence?.[1] ? codeFence[1].trim() : raw;
  const lines = candidateRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const cleaned = line
      .replace(/^commit\s+message\s*:\s*/i, "")
      .replace(/^subject\s*:\s*/i, "")
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    return cleaned.slice(0, 120);
  }
  return candidateRaw.replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeEditorSettingsFromUnknown(value: unknown): EditorSettings {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const themeRaw = String(row.theme || "").trim();
  const theme = THEME_VALUES.includes(themeRaw as ThemeOption) ? (themeRaw as ThemeOption) : DEFAULT_SETTINGS.theme;
  const fontSizeRaw = Number(row.fontSize);
  const tabSizeRaw = Number(row.tabSize);
  return {
    fontSize:
      Number.isFinite(fontSizeRaw) && Number.isInteger(fontSizeRaw)
        ? Math.max(8, Math.min(40, Math.trunc(fontSizeRaw)))
        : DEFAULT_SETTINGS.fontSize,
    tabSize:
      Number.isFinite(tabSizeRaw) && Number.isInteger(tabSizeRaw)
        ? Math.max(1, Math.min(8, Math.trunc(tabSizeRaw)))
        : DEFAULT_SETTINGS.tabSize,
    wordWrap: row.wordWrap == null ? DEFAULT_SETTINGS.wordWrap : row.wordWrap === true,
    minimap: row.minimap == null ? DEFAULT_SETTINGS.minimap : row.minimap === true,
    formatOnSave: row.formatOnSave == null ? DEFAULT_SETTINGS.formatOnSave : row.formatOnSave === true,
    autosave: row.autosave == null ? DEFAULT_SETTINGS.autosave : row.autosave === true,
    telemetry: row.telemetry == null ? DEFAULT_SETTINGS.telemetry : row.telemetry === true,
    theme,
    syncToCavcloud: row.syncToCavcloud == null ? DEFAULT_SETTINGS.syncToCavcloud : row.syncToCavcloud === true,
  };
}

function toCavenComposerEnterBehavior(value: unknown): CavenComposerEnterBehavior {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "meta_enter" ? "meta_enter" : "enter";
}

function toCavenReasoningLevel(value: unknown): CavenReasoningLevel | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "extra_high") return raw;
  return null;
}

function toCavenInferenceSpeed(value: unknown): CavenInferenceSpeed {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "fast" ? "fast" : "standard";
}

function normalizeCavenGeneralModelId(value: unknown): string {
  const raw = String(value ?? "").trim();
  return raw === ALIBABA_QWEN_CODER_MODEL_ID ? raw : ALIBABA_QWEN_CODER_MODEL_ID;
}

function normalizeCavenIdeSettingsFromUnknown(value: unknown): CavenIdeSettings {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    defaultModelId: normalizeCavenGeneralModelId(row.defaultModelId),
    inferenceSpeed: toCavenInferenceSpeed(row.inferenceSpeed),
    queueFollowUps:
      row.queueFollowUps == null ? DEFAULT_CAVEN_IDE_SETTINGS.queueFollowUps : row.queueFollowUps === true,
    composerEnterBehavior: toCavenComposerEnterBehavior(row.composerEnterBehavior),
    includeIdeContext:
      row.includeIdeContext == null ? DEFAULT_CAVEN_IDE_SETTINGS.includeIdeContext : row.includeIdeContext === true,
    confirmBeforeApplyPatch:
      row.confirmBeforeApplyPatch == null
        ? DEFAULT_CAVEN_IDE_SETTINGS.confirmBeforeApplyPatch
        : row.confirmBeforeApplyPatch === true,
    autoOpenResolvedFiles:
      row.autoOpenResolvedFiles == null
        ? DEFAULT_CAVEN_IDE_SETTINGS.autoOpenResolvedFiles
        : row.autoOpenResolvedFiles === true,
    showReasoningTimeline:
      row.showReasoningTimeline == null
        ? DEFAULT_CAVEN_IDE_SETTINGS.showReasoningTimeline
        : row.showReasoningTimeline === true,
    telemetryOptIn: row.telemetryOptIn == null ? DEFAULT_CAVEN_IDE_SETTINGS.telemetryOptIn : row.telemetryOptIn === true,
    defaultReasoningLevel:
      toCavenReasoningLevel(row.defaultReasoningLevel) || DEFAULT_CAVEN_IDE_SETTINGS.defaultReasoningLevel,
  };
}

function normalizeTerminalStateFromUnknown(value: unknown): { lastLoginTs: number; ttySeq: number } {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const lastLoginRaw = Number(row.lastLoginTs);
  const ttySeqRaw = Number(row.ttySeq);
  return {
    lastLoginTs:
      Number.isFinite(lastLoginRaw) && lastLoginRaw > 0
        ? Math.trunc(lastLoginRaw)
        : Date.now(),
    ttySeq:
      Number.isFinite(ttySeqRaw)
        ? Math.max(0, Math.min(999, Math.trunc(ttySeqRaw)))
        : 0,
  };
}

function normalizeAgentIconSvgFromUnknown(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > MAX_CUSTOM_AGENT_ICON_SVG_CHARS) return "";
  if (!/<svg[\s>]/i.test(raw) || !/<\/svg>/i.test(raw)) return "";
  if (/<script[\s>]/i.test(raw)) return "";
  if (/<foreignObject[\s>]/i.test(raw)) return "";
  if (/\son[a-z]+\s*=/i.test(raw)) return "";
  return raw;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexChannel(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`.toUpperCase();
}

function parseRgbChannel(raw: string): number | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(parsed)) return null;
    return clampByte((parsed / 100) * 255);
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return clampByte(parsed);
}

function parseAlphaChannel(raw: string): number | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed / 100));
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360 / 360;
  const saturation = Math.max(0, Math.min(1, s));
  const lightness = Math.max(0, Math.min(1, l));
  if (saturation === 0) {
    const gray = clampByte(lightness * 255);
    return rgbToHex(gray, gray, gray);
  }
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return rgbToHex(
    hueToRgbChannel(p, q, hue + 1 / 3) * 255,
    hueToRgbChannel(p, q, hue) * 255,
    hueToRgbChannel(p, q, hue - 1 / 3) * 255,
  );
}

function normalizeAgentColorHexFromUnknown(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, "").toLowerCase();
  if (
    !normalized
    || normalized === "none"
    || normalized === "transparent"
    || normalized === "currentcolor"
    || normalized === "inherit"
    || normalized.startsWith("url(")
  ) {
    return "";
  }
  const hexMatch = normalized.match(/^#([a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i);
  if (hexMatch) {
    const token = hexMatch[1];
    if (token.length === 3 || token.length === 4) {
      const expanded = token.slice(0, 3).split("").map((part) => `${part}${part}`).join("");
      return `#${expanded}`.toUpperCase();
    }
    return `#${token.slice(0, 6)}`.toUpperCase();
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return "";
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    if (r == null || g == null || b == null) return "";
    if (parts[3] != null) {
      const alpha = parseAlphaChannel(parts[3]);
      if (alpha != null && alpha <= 0) return "";
    }
    return rgbToHex(r, g, b);
  }

  const hslMatch = normalized.match(/^hsla?\(([^)]+)\)$/i);
  if (hslMatch) {
    const parts = hslMatch[1].split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return "";
    const hue = Number.parseFloat(parts[0]);
    const saturation = Number.parseFloat(parts[1].replace("%", ""));
    const lightness = Number.parseFloat(parts[2].replace("%", ""));
    if (!Number.isFinite(hue) || !Number.isFinite(saturation) || !Number.isFinite(lightness)) return "";
    if (parts[3] != null) {
      const alpha = parseAlphaChannel(parts[3]);
      if (alpha != null && alpha <= 0) return "";
    }
    return hslToHex(hue, saturation / 100, lightness / 100);
  }

  if (!normalized.startsWith("#") && /^[a-f0-9]{3,8}$/i.test(normalized)) {
    return normalizeAgentColorHexFromUnknown(`#${normalized}`);
  }
  return "";
}

function hexToRgbTuple(hex: string): [number, number, number] | null {
  const normalized = normalizeAgentColorHexFromUnknown(hex);
  if (!normalized) return null;
  const token = normalized.slice(1);
  return [
    Number.parseInt(token.slice(0, 2), 16),
    Number.parseInt(token.slice(2, 4), 16),
    Number.parseInt(token.slice(4, 6), 16),
  ];
}

function mixAgentHexColors(hex: string, target: string, amount: number): string {
  const left = hexToRgbTuple(hex);
  const right = hexToRgbTuple(target);
  if (!left || !right) return normalizeAgentColorHexFromUnknown(hex) || "";
  const weight = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    left[0] + (right[0] - left[0]) * weight,
    left[1] + (right[1] - left[1]) * weight,
    left[2] + (right[2] - left[2]) * weight,
  );
}

function rgbaFromAgentHex(hex: string, alpha: number): string {
  const rgb = hexToRgbTuple(hex);
  if (!rgb) return `rgba(78,168,255,${alpha})`;
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${safeAlpha})`;
}

function scoreSvgPaletteColor(hex: string, count: number): number {
  const rgb = hexToRgbTuple(hex);
  if (!rgb) return count;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = (max - min) / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  let score = count * 100 + saturation * 20;
  if (luminance < 0.08 || luminance > 0.94) score -= 14;
  if (saturation < 0.08) score -= 10;
  return score;
}

function extractSvgPalette(svg: string): string[] {
  const clean = normalizeAgentIconSvgFromUnknown(svg);
  if (!clean) return [];
  const hits = new Map<string, number>();
  const rawValues: string[] = [];
  const attrPattern = /\b(?:fill|stroke|stop-color|color)\s*=\s*["']([^"']+)["']/gi;
  const stylePattern = /\bstyle\s*=\s*["']([^"']+)["']/gi;
  const styleColorPattern = /\b(?:fill|stroke|stop-color|color)\s*:\s*([^;]+)/gi;

  let match: RegExpExecArray | null = null;
  while ((match = attrPattern.exec(clean))) {
    rawValues.push(match[1] || "");
  }
  while ((match = stylePattern.exec(clean))) {
    const style = match[1] || "";
    let styleMatch: RegExpExecArray | null = null;
    while ((styleMatch = styleColorPattern.exec(style))) {
      rawValues.push(styleMatch[1] || "");
    }
  }

  for (const rawValue of rawValues) {
    const color = normalizeAgentColorHexFromUnknown(rawValue);
    if (!color) continue;
    hits.set(color, (hits.get(color) || 0) + 1);
  }

  return [...hits.entries()]
    .sort((a, b) => scoreSvgPaletteColor(b[0], b[1]) - scoreSvgPaletteColor(a[0], a[1]) || b[1] - a[1])
    .map(([color]) => color)
    .slice(0, 6);
}

function pickDefaultAgentIconBackground(palette: readonly string[]): string {
  for (const color of palette) {
    const rgb = hexToRgbTuple(color);
    if (!rgb) continue;
    const max = Math.max(rgb[0], rgb[1], rgb[2]);
    const min = Math.min(rgb[0], rgb[1], rgb[2]);
    const saturation = (max - min) / 255;
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    if (saturation >= 0.08 && luminance >= 0.12 && luminance <= 0.9) return color;
  }
  return palette[0] || DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND;
}

function buildAgentIconSurfaceStyle(hex: string | null | undefined): React.CSSProperties | undefined {
  const color = normalizeAgentColorHexFromUnknown(hex);
  if (!color) return undefined;
  return {
    ["--cc-agent-icon-bg" as const]: `linear-gradient(135deg, ${mixAgentHexColors(color, "#FFFFFF", 0.16)}, ${mixAgentHexColors(color, "#050915", 0.12)})`,
    ["--cc-agent-icon-border" as const]: rgbaFromAgentHex(mixAgentHexColors(color, "#FFFFFF", 0.28), 0.58),
  };
}

function svgToDataUri(svg: string): string {
  const clean = normalizeAgentIconSvgFromUnknown(svg);
  if (!clean) return CAVEN_CUSTOM_AGENT_ICON_SRC;
  return `data:image/svg+xml;utf8,${encodeURIComponent(clean)}`;
}

function normalizeCustomAgentsFromUnknown(
  value: unknown,
  knownBuiltInIdSet?: ReadonlySet<string>
): CustomCavenAgentRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: CustomCavenAgentRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = String(row.id || "")
      .trim()
      .toLowerCase();
    if (!id || seen.has(id) || knownBuiltInIdSet?.has(id) || CAVCODE_AGENT_ID_SET.has(id)) continue;
    const name = String(row.name || "")
      .trim()
      .replace(/\s+/g, " ");
    const summary = String(row.summary || "")
      .trim()
      .replace(/\s+/g, " ");
    const instructions = String(row.instructions || "").trim();
    if (!name || !summary || !instructions) continue;
    const actionKeyRaw = String(row.actionKey || "").trim().toLowerCase();
    const actionKey = actionKeyRaw || `custom_${toAgentSlug(name).replace(/-/g, "_") || "agent"}`;
    const surface = row.surface === "center" ? "center" : row.surface === "cavcode" ? "cavcode" : "all";
    const triggers = Array.isArray(row.triggers)
      ? row.triggers.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12)
      : [];
    const iconSvg = normalizeAgentIconSvgFromUnknown(row.iconSvg);
    const iconBackground = normalizeAgentColorHexFromUnknown(row.iconBackground) || null;
    const createdAt = String(row.createdAt || "").trim() || new Date().toISOString();
    rows.push({
      id,
      name,
      summary,
      actionKey,
      surface,
      triggers,
      instructions,
      iconSvg,
      iconBackground,
      createdAt,
    });
    seen.add(id);
  }
  return rows;
}

function buildCavenConfigToml(settings: CavenIdeSettings): string {
  const modelId = normalizeCavenGeneralModelId(settings.defaultModelId);
  const followUpBehavior = settings.queueFollowUps ? "queue" : "steer";
  const requireMetaEnter = settings.composerEnterBehavior === "meta_enter";
  return [
    "# Caven config.toml",
    `model = "${modelId}"`,
    `model_reasoning_effort = "${settings.defaultReasoningLevel}"`,
    `speed = "${settings.inferenceSpeed}"`,
    `follow_up_behavior = "${followUpBehavior}"`,
    `require_ctrl_cmd_enter = ${requireMetaEnter ? "true" : "false"}`,
    `include_ide_context = ${settings.includeIdeContext ? "true" : "false"}`,
    `confirm_before_apply_patch = ${settings.confirmBeforeApplyPatch ? "true" : "false"}`,
    `auto_open_resolved_files = ${settings.autoOpenResolvedFiles ? "true" : "false"}`,
    `show_reasoning_timeline = ${settings.showReasoningTimeline ? "true" : "false"}`,
    `share_telemetry = ${settings.telemetryOptIn ? "true" : "false"}`,
    "",
  ].join("\n");
}

function customAgentToCard(record: CustomCavenAgentRecord): IdeAgentCard {
  return {
    id: record.id,
    name: record.name,
    summary: record.summary,
    iconSrc: svgToDataUri(record.iconSvg),
    iconBackground: record.iconBackground,
    actionKey: record.actionKey,
    surface: record.surface,
    defaultInstalled: false,
  };
}

function skillsPageViewFromTabLike(entry: { path?: unknown; name?: unknown; lang?: unknown } | null | undefined): SkillsPageView {
  const path = String(entry?.path || "").trim().toLowerCase();
  if (path.includes("caven-general")) return "general";
  if (path.includes("caven-ide")) return "ide";
  if (path.includes("caven-agents")) return "agents";

  const lang = String(entry?.lang || "").trim().toLowerCase();
  if (lang === "general") return "general";
  if (lang === "ide" || lang === "ide_settings" || lang === "settings_ide") return "ide";
  if (lang === "agents" || lang === "skills") return "agents";

  const name = String(entry?.name || "").trim().toLowerCase();
  if (name.includes("general")) return "general";
  if (name.includes("ide")) return "ide";
  if (name.includes("agent")) return "agents";

  return "agents";
}

function toSkillsTab(view: SkillsPageView = "agents"): Tab {
  const safeView = view === "general" || view === "ide" ? view : "agents";
  const meta = CAVCODE_SKILLS_TAB_META[safeView];
  return {
    id: CAVCODE_SKILLS_TAB_ID,
    path: meta.path,
    name: meta.name,
    lang: meta.lang,
    kind: "skills",
  };
}

/* =========================
  System virtual files
  - Backed by DB (via /api/profile/readme)
  - Must never sync into CavCloud, CavSafe, or workspace persistence
========================= */
const SYS_ROOT_ID = "sys_root";
const SYS_PROFILE_ID = "sys_profile";
const SYS_README_ID = "sys_profile_readme";
const SYS_CAVEN_ID = "sys_caven";
const SYS_CAVEN_CONFIG_ID = "sys_caven_config_toml";

const SYS_ROOT_PATH = "/system";
const SYS_PROFILE_PATH = "/system/profile";
const SYS_README_PATH = "/system/profile/README.md";
const SYS_CAVEN_PATH = "/system/caven";
const SYS_CAVEN_CONFIG_PATH = "/system/caven/config.toml";

/* =========================
  Utils
========================= */
function uid(prefix = "n") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function joinPath(parent: string, name: string) {
  const p = parent === "/" ? "" : parent;
  return `${p}/${name}`.replace(/\/+/g, "/");
}

function fileUri(path: string) {
  const p = normalizePath(path);
  const clean = p.startsWith("/") ? p.slice(1) : p;
  return `file:///${clean}`;
}

function isFolder(n: Node): n is FolderNode {
  return n.kind === "folder";
}

function isFile(n: Node): n is FileNode {
  return n.kind === "file";
}

function safeClone<T>(obj: T): T {
  const sc = (globalThis as typeof globalThis & { structuredClone?: <U>(v: U) => U }).structuredClone;
  if (sc) return sc(obj);
  return JSON.parse(JSON.stringify(obj)) as T;
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

function deriveAccountInitials(fullName?: string | null, username?: string | null, fallback?: string | null): string {
  const name = String(fullName || "").trim();
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(normalizeInitialUsernameSource(String(username || "")));
  if (userInitial) return userInitial;

  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function quickStringSignature(input: string): string {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function cavcodeWorkspaceStateEndpoint(projectId: number | null): string {
  const qs = new URLSearchParams();
  if (projectId && Number.isFinite(projectId) && projectId > 0) {
    qs.set("projectId", String(Math.trunc(projectId)));
  }
  const suffix = qs.toString();
  return suffix ? `/api/cavcode/workspace-state?${suffix}` : "/api/cavcode/workspace-state";
}

function normalizeTabsForWorkspace(root: FolderNode, rawTabs: unknown): Tab[] {
  if (!Array.isArray(rawTabs)) return [];
  const out: Tab[] = [];
  const seen = new Set<string>();

  for (const item of rawTabs) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Partial<Tab>;
    const tabId = String(entry.id || "").trim();
    const tabKind = String(entry.kind || "").trim().toLowerCase();

    if ((tabId === CAVCODE_SKILLS_TAB_ID || tabKind === "skills") && !seen.has(CAVCODE_SKILLS_TAB_ID)) {
      seen.add(CAVCODE_SKILLS_TAB_ID);
      out.push(toSkillsTab(skillsPageViewFromTabLike(entry)));
      continue;
    }

    const byId = entry.id ? findFileById(root, String(entry.id)) : null;
    const byPath = !byId && entry.path ? findNodeByPath(root, String(entry.path)) : null;
    const file = byId || (byPath && isFile(byPath) ? byPath : null);
    if (!file || isSystemPath(file.path)) continue;
    if (seen.has(file.id)) continue;
    seen.add(file.id);
    out.push({
      id: file.id,
      path: file.path,
      name: file.name,
      lang: file.lang,
      kind: "file",
    });
  }

  return out.slice(0, 80);
}

function parseWorkspaceSnapshot(raw: unknown): CavCodeWorkspaceSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const fs = record.fs as FolderNode | undefined;
  if (!fs || typeof fs !== "object" || fs.kind !== "folder" || normalizePath(String(fs.path || "/")) !== "/") {
    return null;
  }

  const nextFs = stripSystemNodes(safeClone(fs));
  const tabs = normalizeTabsForWorkspace(nextFs, record.tabs);
  const activeRaw = String(record.activeFileId || "").trim();
  const activeNode = activeRaw ? findNode(nextFs, activeRaw) : null;
  const activeFileId = activeRaw === CAVCODE_SKILLS_TAB_ID && tabs.some((tab) => tab.id === CAVCODE_SKILLS_TAB_ID)
    ? CAVCODE_SKILLS_TAB_ID
    : activeNode && isFile(activeNode) && !isSystemPath(activeNode.path)
      ? activeRaw
      : "";
  const activeProjectRootPathRaw = String(record.activeProjectRootPath || "").trim();
  const projectRootNode = activeProjectRootPathRaw ? findNodeByPath(nextFs, activeProjectRootPathRaw) : null;
  const activeProjectRootPath =
    projectRootNode && isFolder(projectRootNode) && isUserWorkspacePath(projectRootNode.path)
      ? normalizePath(projectRootNode.path)
      : null;

  return {
    version: 2,
    fs: nextFs,
    tabs,
    activeFileId,
    activeProjectRootPath,
  };
}

function walk(node: Node, fn: (n: Node) => void) {
  fn(node);
  if (isFolder(node)) node.children.forEach((c) => walk(c, fn));
}

function listFiles(root: FolderNode): FileNode[] {
  const out: FileNode[] = [];
  walk(root, (n) => {
    if (isFile(n)) out.push(n);
  });
  return out;
}

function findNode(root: FolderNode, id: string): Node | null {
  let hit: Node | null = null;
  walk(root, (n) => {
    if (n.id === id) hit = n;
  });
  return hit;
}

function findFileById(root: FolderNode, id: string): FileNode | null {
  const n = findNode(root, id);
  return n && isFile(n) ? n : null;
}

function findParentFolder(root: FolderNode, childId: string): FolderNode | null {
  let parent: FolderNode | null = null;
  walk(root, (n) => {
    if (isFolder(n)) {
      if (n.children.some((c) => c.id === childId)) parent = n;
    }
  });
  return parent;
}

function removeNode(root: FolderNode, id: string): FolderNode {
  const clone = safeClone(root);
  const rec = (folder: FolderNode): FolderNode => {
    folder.children = folder.children
      .filter((c) => c.id !== id)
      .map((c) => (isFolder(c) ? rec(c) : c));
    return folder;
  };
  return rec(clone);
}

function replaceNode(root: FolderNode, next: Node): FolderNode {
  if (root.id === next.id) return next as FolderNode;
  const clone = safeClone(root);
  const rec = (folder: FolderNode): FolderNode => {
    folder.children = folder.children.map((c) => {
      if (c.id === next.id) return next;
      if (isFolder(c)) return rec(c);
      return c;
    });
    return folder;
  };
  return rec(clone);
}

function inferLang(filename: string): Lang {
  const lower = filename.toLowerCase();

  // dotenv
  if (lower === ".env" || lower.startsWith(".env.")) return "plaintext";

  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".scss")) return "scss";
  if (lower.endsWith(".less")) return "less";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".svg")) return "xml";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
  if (lower.endsWith(".cpp") || lower.endsWith(".hpp") || lower.endsWith(".cc")) return "cpp";
  if (lower.endsWith(".php")) return "php";
  if (lower.endsWith(".rb")) return "ruby";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "shell";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".toml")) return "toml";
  return "plaintext";
}

function isSystemPath(path: string) {
  const p = normalizePath(path);
  return p === SYS_ROOT_PATH || p.startsWith(SYS_ROOT_PATH + "/");
}

function isLocalOnlySystemPath(path: string) {
  const normalized = normalizePath(path);
  if (isSystemPath(normalized)) return true;
  if (normalized === "/codebase/system" || normalized.startsWith("/codebase/system/")) return true;
  if (normalized === "/cavcode/system" || normalized.startsWith("/cavcode/system/")) return true;
  return false;
}

function stripSystemNodes(root: FolderNode): FolderNode {
  const clone = safeClone(root);
  const rec = (folder: FolderNode): FolderNode => {
    folder.children = folder.children
      .filter((c) => !isSystemPath(c.path))
      .map((c) => (isFolder(c) ? rec(c) : c));
    return folder;
  };
  return rec(clone);
}

function upsertSystemVirtualFiles(
  root: FolderNode,
  options: {
    profileReadmeMarkdown?: string | null;
    cavenConfigToml?: string | null;
  }
): FolderNode {
  const clone = stripSystemNodes(root);

  const profileMarkdown = String(options.profileReadmeMarkdown ?? "");
  const cavenConfigToml = String(options.cavenConfigToml ?? "");

  const sysReadme: FileNode = {
    id: SYS_README_ID,
    kind: "file",
    name: "README.md",
    path: SYS_README_PATH,
    lang: "markdown",
    content: profileMarkdown,
  };
  const cavenConfigFile: FileNode = {
    id: SYS_CAVEN_CONFIG_ID,
    kind: "file",
    name: "config.toml",
    path: SYS_CAVEN_CONFIG_PATH,
    lang: "toml",
    content: cavenConfigToml,
  };

  const sysProfile: FolderNode = {
    id: SYS_PROFILE_ID,
    kind: "folder",
    name: "Profile",
    path: SYS_PROFILE_PATH,
    children: [sysReadme],
  };
  const sysCaven: FolderNode = {
    id: SYS_CAVEN_ID,
    kind: "folder",
    name: "Caven",
    path: SYS_CAVEN_PATH,
    children: [cavenConfigFile],
  };

  const sysRoot: FolderNode = {
    id: SYS_ROOT_ID,
    kind: "folder",
    name: "System",
    path: SYS_ROOT_PATH,
    children: [sysProfile, sysCaven],
  };

  clone.children = [sysRoot, ...clone.children];
  return clone;
}

function publishSysProfileReadme(md: string, serverRevision?: number | null) {
  const revisionValue =
    typeof serverRevision === "number" && Number.isFinite(serverRevision) && serverRevision >= 0
      ? Math.trunc(serverRevision)
      : null;
  try {
    window.dispatchEvent(
      new CustomEvent("cb:sys_profile_readme", {
        detail: { ts: Date.now(), revision: revisionValue ?? undefined },
      })
    );
  } catch {}
}

function defaultProfileReadmeMarkdown(displayName: string) {
  const name = String(displayName || "Operator").trim() || "Operator";
  return [
    `# ${name}`,
    ``,
    `CavBot workspace profile.`,
    ``,
    `## Overview`,
    `This workspace is used to monitor, analyze, and improve website reliability and performance.`,
    ``,
    `## Capabilities`,
    `- Route monitoring`,
    `- Error tracking and stability analysis`,
    `- SEO analysis`,
    `- 404 recovery and interaction tracking`,
    ``,
    `## Workspace`,
    `- Monitored sites: —`,
    `- Last data update: —`,
    ``,
    `This profile reflects live data from CavBot monitoring.`,
    `Only verified data is displayed.`,
    ``,
  ].join("\n");
}

function firstFileId(root: FolderNode) {
  let first = "";
  walk(root, (n) => {
    if (!first && isFile(n)) first = n.id;
  });
  return first;
}

function normalizePath(p: string) {
  const s = String(p || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/+/g, "/");
}

function isCodebasePath(path: string) {
  const normalized = normalizePath(path);
  return normalized === "/codebase" || normalized.startsWith("/codebase/");
}

function isSelfTestPath(path: string) {
  const normalized = normalizePath(path);
  return normalized === "/.cavcode-self-test" || normalized.startsWith("/.cavcode-self-test/");
}

function isWorkspaceSystemPath(path: string) {
  return isSystemPath(path) || isCodebasePath(path) || isSelfTestPath(path);
}

function isUserWorkspacePath(path: string) {
  return !isWorkspaceSystemPath(path);
}

function stripWorkspaceToSpecialRoots(root: FolderNode): FolderNode {
  const clone = safeClone(root);
  clone.children = clone.children.filter((child) => !isUserWorkspacePath(child.path));
  return clone;
}

function relativePathFromRoot(rootPath: string, filePath: string) {
  const root = normalizePath(rootPath);
  const full = normalizePath(filePath);
  if (root === "/") return full.replace(/^\/+/, "");
  if (full === root) return "";
  if (!full.startsWith(`${root}/`)) return full.replace(/^\/+/, "");
  return full.slice(root.length + 1);
}

function ensureFolderPath(root: FolderNode, absolutePath: string): FolderNode {
  const normalized = normalizePath(absolutePath);
  if (normalized === "/") return root;
  const parts = normalized.replace(/^\/+/, "").split("/").filter(Boolean);
  let current = root;

  for (const part of parts) {
    const hit = current.children.find((child) => isFolder(child) && child.name.toLowerCase() === part.toLowerCase());
    if (hit && isFolder(hit)) {
      hit.path = joinPath(current.path, hit.name);
      current = hit;
      continue;
    }
    const created: FolderNode = {
      id: uid("f"),
      kind: "folder",
      name: part,
      path: joinPath(current.path, part),
      children: [],
    };
    current.children.push(created);
    current = created;
  }
  return current;
}

function readPositiveQueryInt(sp: URLSearchParams, keys: string[]): number | null {
  for (const key of keys) {
    const raw = String(sp.get(key) || "").trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function shouldOpenCavAiSurface(sp: URLSearchParams): boolean {
  const activity = String(sp.get("activity") || "").trim().toLowerCase();
  if (activity === "ai" || activity === "cavai") return true;
  const cavAi = String(sp.get("cavai") || sp.get("ai") || "").trim().toLowerCase();
  return cavAi === "1" || cavAi === "true" || cavAi === "open" || cavAi === "yes";
}

function readDeepLinkEditorPosition(sp: URLSearchParams): DeepLinkEditorPosition | null {
  const line = readPositiveQueryInt(sp, ["line", "l", "row"]);
  const col = readPositiveQueryInt(sp, ["col", "column", "c"]);
  if (!line && !col) return null;
  return {
    line: line || 1,
    col: col || 1,
  };
}

function formatMacTerminalDate(ts: number) {
  const date = new Date(Number.isFinite(ts) ? ts : Date.now());
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, " ");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${days[date.getDay()] || "Mon"} ${months[date.getMonth()] || "Jan"} ${day} ${hh}:${mm}:${ss}`;
}

function terminalTtyLabelFromSeq(value: number) {
  const seq = Number.isFinite(value) ? Math.max(0, Math.min(999, Math.trunc(value))) : 0;
  return `ttys${String(seq).padStart(3, "0")}`;
}

function hashString(input: string) {
  const s = String(input || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function stableId(prefix: string, path: string) {
  return `${prefix}_${hashString(path)}`;
}

type CavtoolsFsItem = {
  type: "file" | "folder";
  name: string;
  path: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAtISO?: string | null;
};

type CavtoolsWorkspaceDiagnostic = {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warn" | "info";
  source: string;
  code?: string;
  message: string;
  fixReady?: boolean;
};

type CavtoolsWorkspaceDiagnosticsSummary = {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  filesScanned: number;
  generatedAtISO: string;
  truncated: boolean;
};

type CavtoolsExecBlock =
  | { kind: "text"; title?: string; lines: string[] }
  | { kind: "table"; title?: string; columns: string[]; rows: Array<Record<string, string | number | boolean | null>> }
  | { kind: "json"; title?: string; data: unknown }
  | { kind: "files"; title?: string; cwd: string; items: CavtoolsFsItem[] }
  | {
      kind: "diagnostics";
      title?: string;
      diagnostics: CavtoolsWorkspaceDiagnostic[];
      summary: CavtoolsWorkspaceDiagnosticsSummary;
    }
  | { kind: "open"; title?: string; url: string; label?: string }
  | { kind: "warning"; message: string };

type CavtoolsExecResult = {
  ok: boolean;
  cwd: string;
  command: string;
  warnings: string[];
  blocks: CavtoolsExecBlock[];
  durationMs: number;
  error?: {
    code?: string;
    message?: string;
  };
};

type RuntimeRunKind = "dev" | "build" | "test";
type RuntimeSessionStatus = "starting" | "running" | "exited" | "failed" | "stopped";
type DebugSessionStatus = "starting" | "running" | "paused" | "exited" | "failed" | "stopped";

type RuntimeLogEntry = {
  seq: number;
  atISO: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type RuntimeLogsPayload = {
  type: "cav_runtime_logs_v1";
  sessionId: string;
  status: RuntimeSessionStatus;
  kind: RuntimeRunKind;
  exitCode: number | null;
  exitSignal: string | null;
  nextSeq: number;
  logTruncated: boolean;
  entries: RuntimeLogEntry[];
};

type RuntimeStatusPayload = {
  type: "cav_runtime_started_v1" | "cav_runtime_restarted_v1" | "cav_runtime_status_v1" | "cav_runtime_stop_v1";
  sessionId: string;
  kind: RuntimeRunKind;
  status: RuntimeSessionStatus;
  exitCode?: number | null;
  exitSignal?: string | null;
  nextSeq?: number | null;
};

type DebugLocation = {
  file: string | null;
  line: number | null;
  column: number | null;
};

type DebugBreakpointKind = "source" | "function" | "logpoint";

type DebugBreakpoint = {
  id: string;
  kind: DebugBreakpointKind;
  enabled: boolean;
  setId?: string | null;
  condition?: string | null;
  hitCondition?: string | null;
  logMessage?: string | null;
  functionName?: string | null;
  file: string;
  line: number;
  verified: boolean;
  hitCount?: number;
  adapterBreakpointId?: string | null;
  message?: string | null;
};

type DebugStackFrame = {
  id: number;
  frameId?: string;
  threadId?: number;
  name: string;
  file: string | null;
  line: number | null;
  column: number | null;
};

type DebugThread = {
  id: number;
  name: string;
  stopped: boolean;
  reason?: string | null;
};

type DebugScope = {
  name: string;
  variablesReference: number;
  expensive: boolean;
  presentationHint?: string | null;
};

type DebugVariable = {
  name: string;
  value: string;
  type?: string | null;
  variablesReference: number;
  evaluateName?: string | null;
};

type DebugWatch = {
  expression: string;
  value: string | null;
};

type DebugDataBreakpoint = {
  id: string;
  enabled: boolean;
  accessType: "read" | "write" | "readWrite";
  variablesReference: number;
  expression?: string | null;
  message?: string | null;
};

type DebugExceptionFilters = {
  all: boolean;
  uncaught: boolean;
};

type DebugConsoleEntry = {
  seq: number;
  atISO: string;
  category: "stdout" | "stderr" | "console" | "repl" | "exception";
  text: string;
  level?: string | null;
};

type DebugAdapterCapabilities = {
  supportsConditionalBreakpoints: boolean;
  supportsHitConditionalBreakpoints: boolean;
  supportsLogPoints: boolean;
  supportsFunctionBreakpoints: boolean;
  supportsExceptionFilterOptions: boolean;
  supportsStepBack: boolean;
  supportsSetVariable: boolean;
  supportsEvaluateForHovers: boolean;
  supportsDataBreakpoints: boolean;
  supportsReadMemoryRequest: boolean;
};

type DebugLoadedScript = {
  scriptId: string;
  url: string;
  file: string | null;
  cavcodePath: string | null;
  sourceMapUrl: string | null;
  hash: string | null;
  language: string | null;
  isModule: boolean;
  lastSeenISO: string;
};

type DebugLoadedModule = {
  module: string;
  scriptCount: number;
};

type DebugLogEntry = {
  seq: number;
  atISO: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type DebugStatusPayload = {
  type: "cav_debug_status_v1";
  sessionId: string;
  status: DebugSessionStatus;
  entryPath: string;
  projectId?: number;
  adapterId?: string;
  adapterLabel?: string;
  adapterType?: string;
  launchTargetName?: string | null;
  launchCompoundName?: string | null;
  launchProfileId?: string | null;
  workspaceVariantId?: string | null;
  launchRequest?: "launch" | "attach";
  postDebugTask?: string | null;
  postDebugTaskRan?: boolean;
  attachInfo?: {
    host: string | null;
    port: number | null;
    wsUrl: string | null;
    processId: number | null;
  } | null;
  capabilities?: DebugAdapterCapabilities | null;
  exitCode?: number | null;
  exitSignal?: string | null;
  nextSeq?: number;
  currentLocation: DebugLocation;
  breakpoints: DebugBreakpoint[];
  functionBreakpoints: DebugBreakpoint[];
  dataBreakpoints: DebugDataBreakpoint[];
  exceptionFilters?: DebugExceptionFilters;
  threads: DebugThread[];
  selectedThreadId?: number | null;
  selectedFrameOrdinal?: number | null;
  stack: DebugStackFrame[];
  scopes: DebugScope[];
  watches: DebugWatch[];
  consoleEntries: DebugConsoleEntry[];
  loadedScripts?: DebugLoadedScript[];
  loadedModules?: DebugLoadedModule[];
};

type DebugLogsPayload = {
  type: "cav_debug_logs_v1";
  sessionId: string;
  status: DebugSessionStatus;
  adapterId?: string;
  adapterLabel?: string;
  adapterType?: string;
  launchTargetName?: string | null;
  launchCompoundName?: string | null;
  launchProfileId?: string | null;
  workspaceVariantId?: string | null;
  launchRequest?: "launch" | "attach";
  postDebugTask?: string | null;
  postDebugTaskRan?: boolean;
  attachInfo?: {
    host: string | null;
    port: number | null;
    wsUrl: string | null;
    processId: number | null;
  } | null;
  capabilities?: DebugAdapterCapabilities | null;
  exitCode: number | null;
  exitSignal: string | null;
  nextSeq: number;
  logTruncated: boolean;
  currentLocation?: DebugLocation;
  breakpoints?: DebugBreakpoint[];
  functionBreakpoints?: DebugBreakpoint[];
  dataBreakpoints?: DebugDataBreakpoint[];
  exceptionFilters?: DebugExceptionFilters;
  threads?: DebugThread[];
  selectedThreadId?: number | null;
  selectedFrameOrdinal?: number | null;
  stack?: DebugStackFrame[];
  scopes?: DebugScope[];
  watches?: DebugWatch[];
  consoleEntries?: DebugConsoleEntry[];
  loadedScripts?: DebugLoadedScript[];
  loadedModules?: DebugLoadedModule[];
  entries: DebugLogEntry[];
};

type DebugEvalPayload = {
  type: "cav_debug_eval_v1";
  sessionId: string;
  expression: string;
  frameOrdinal: number | null;
  value: string;
  valueType: string | null;
  variablesReference: number;
};

type DebugVarsPayload = {
  type: "cav_debug_vars_v1";
  sessionId: string;
  variablesReference: number;
  start: number;
  count: number;
  returned: number;
  rows: DebugVariable[];
};

type CavcodeEventPayload = {
  seq: number;
  kind: string;
  projectId: number;
  userId: string;
  atISO: string;
  payload: Record<string, unknown>;
};

type CavcodeEventsStreamPayload = {
  type: "cavcode_events_v1";
  projectId: number;
  afterSeq: number;
  nextSeq: number;
  events: CavcodeEventPayload[];
};

type DebugSessionListPayload = {
  type: "cav_debug_sessions_v1";
  activeSessionId: string | null;
  count: number;
  sessions: DebugStatusPayload[];
};

type DebugLaunchProfile = {
  id: string;
  name: string;
  description: string | null;
  runtimeExecutable: string | null;
  runtimeArgs: string[];
  programArgs: string[];
  cwdCavcodePath: string | null;
  env: Record<string, string>;
  preLaunchTask: string | null;
  postDebugTask: string | null;
};

type DebugWorkspaceVariant = {
  id: string;
  name: string;
  description: string | null;
  runtimeExecutable: string | null;
  runtimeArgs: string[];
  programArgs: string[];
  cwdCavcodePath: string | null;
  env: Record<string, string>;
  preLaunchTask: string | null;
  postDebugTask: string | null;
};

type DebugLaunchTarget = {
  id: string;
  name: string;
  request: "launch" | "attach";
  debugType: string;
  adapterId: string;
  entryCavcodePath: string | null;
  cwdCavcodePath: string | null;
  runtimeExecutable: string;
  runtimeArgs: string[];
  programArgs: string[];
  stopOnEntry: boolean;
  env: Record<string, string>;
  sourceMaps: boolean;
  outFiles: string[];
  attachHost: string | null;
  attachPort: number | null;
  attachWsUrl: string | null;
  attachProcessId: number | null;
  preLaunchTask: string | null;
  postDebugTask: string | null;
  profileId: string | null;
  workspaceVariantId: string | null;
  presentationGroup: string | null;
};

type DebugLaunchCompound = {
  id: string;
  name: string;
  configurationRefs: string[];
  targetIds: string[];
  preLaunchTask: string | null;
  postDebugTask: string | null;
  stopAll: boolean;
  presentationGroup: string | null;
};

type DebugTaskDefinition = {
  id: string;
  label: string;
  type: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  detail: string | null;
  dependsOn: string[];
};

type DebugLaunchManifestPayload = {
  type: "cav_debug_launch_manifest_v1";
  count: number;
  targets: DebugLaunchTarget[];
  compounds: DebugLaunchCompound[];
  profiles: DebugLaunchProfile[];
  workspaceVariants: DebugWorkspaceVariant[];
  tasks: DebugTaskDefinition[];
};

type GitStatusFile = {
  path: string;
  renameFrom: string | null;
  index: string;
  worktree: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  ignored: boolean;
  conflicted: boolean;
};

type GitRemote = {
  name: string;
  fetch: string;
  push: string;
};

type GitStatusPayload = {
  type: "cav_git_status_v2";
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  files: GitStatusFile[];
  remotes: GitRemote[];
  conflicts: string[];
  workspaceSync?: {
    filesWritten: number;
    filesRemoved: number;
    bytesWritten: number;
    warnings: string[];
  };
};

type GitAuthRequiredPayload = {
  type: "cav_git_auth_required_v1";
  command: string;
  message: string;
};

type GitComparePayload = {
  type: "cav_git_compare_v1";
  mode: GitCompareMode;
  path: string;
  renameFrom: string | null;
  status: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
  binary: boolean;
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
  addedLines: number;
  removedLines: number;
};

type ChangesListEntry = {
  key: string;
  mode: GitCompareMode;
  path: string;
  renameFrom: string | null;
  status: string;
  statusLetter: string;
  staged: boolean;
  untracked: boolean;
  conflicted: boolean;
  index: string;
  worktree: string;
};

const RUNTIME_ACTIVE_STATUSES = new Set<RuntimeSessionStatus>(["starting", "running"]);
const DEBUG_STREAM_ACTIVE_STATUSES = new Set<DebugSessionStatus>(["starting", "running", "paused"]);

type CavtoolsFileReadResult = {
  ok: true;
  path: string;
  mimeType: string;
  readOnly: boolean;
  content: string;
  updatedAtISO?: string | null;
  sha256?: string | null;
  versionNumber?: number | null;
  etag?: string | null;
};

function createEmptyCodebaseFs(): FsState {
  const ts = Date.now();
  const root: FsNode = { type: "dir", name: "/", path: "/", createdAt: ts, updatedAt: ts };
  const codebase: FsNode = { type: "dir", name: "cavcode", path: "/codebase", createdAt: ts, updatedAt: ts };
  return {
    cwd: "/codebase",
    nodes: {
      "/": root,
      "/codebase": codebase,
    },
  };
}

function toCavcodePathFromCodebase(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/codebase") return "/cavcode";
  if (normalized.startsWith("/codebase/")) return `/cavcode${normalized.slice("/codebase".length)}`;
  return normalized;
}

function toCodebasePathFromCavcode(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/cavcode") return "/codebase";
  if (normalized.startsWith("/cavcode/")) return `/codebase${normalized.slice("/cavcode".length)}`;
  return normalized;
}

function readCavtoolsQueryContext() {
  if (typeof window === "undefined") {
    return { projectId: null as number | null, siteOrigin: null as string | null };
  }
  try {
    const sp = new URLSearchParams(window.location.search);
    const rawProject = String(sp.get("project") || sp.get("projectId") || "").trim();
    const projectIdNum = Number(rawProject);
    const projectId =
      Number.isFinite(projectIdNum) && Number.isInteger(projectIdNum) && projectIdNum > 0 ? projectIdNum : null;
    const siteOrigin = String(sp.get("site") || "").trim() || null;
    return { projectId, siteOrigin };
  } catch {
    return { projectId: null as number | null, siteOrigin: null as string | null };
  }
}

function fromServerOutputToCodebaseText(text: string): string {
  return String(text || "")
    .replace(/\/cavcode\b/g, "/codebase")
    .replace(/\bCavCode\b/g, "Codebase")
    .replace(/\bcavcode\b/g, "codebase");
}

const CHANGES_COMPARE_TAB_PREFIX = "__cav_changes_compare__:";
const CHANGES_AGGREGATE_TAB_PREFIX = "__cav_changes_aggregate__:";

function fileNameFromPath(path: string): string {
  const normalized = String(path || "").trim().replace(/\\/g, "/");
  if (!normalized) return "file";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function toChangesCompareKey(mode: GitCompareMode, path: string): string {
  return `${mode}:${String(path || "").trim()}`;
}

function toChangesCompareTabId(path: string, mode: GitCompareMode): string {
  return `${CHANGES_COMPARE_TAB_PREFIX}${mode}:${encodeURIComponent(path)}`;
}

function readChangesCompareTabId(tabId: string): { mode: GitCompareMode; path: string } | null {
  const raw = String(tabId || "");
  if (!raw.startsWith(CHANGES_COMPARE_TAB_PREFIX)) return null;
  const rest = raw.slice(CHANGES_COMPARE_TAB_PREFIX.length);
  const splitAt = rest.indexOf(":");
  if (splitAt <= 0) return null;
  const modeRaw = rest.slice(0, splitAt).trim().toLowerCase();
  const encodedPath = rest.slice(splitAt + 1);
  const mode: GitCompareMode = modeRaw === "staged" ? "staged" : "unstaged";
  const path = decodeURIComponent(encodedPath || "");
  if (!path) return null;
  return { mode, path };
}

function toChangesAggregateTabId(mode: GitCompareMode): string {
  return `${CHANGES_AGGREGATE_TAB_PREFIX}${mode}`;
}

function readChangesAggregateTabId(tabId: string): GitCompareMode | null {
  const raw = String(tabId || "");
  if (!raw.startsWith(CHANGES_AGGREGATE_TAB_PREFIX)) return null;
  const modeRaw = raw.slice(CHANGES_AGGREGATE_TAB_PREFIX.length).trim().toLowerCase();
  if (!modeRaw) return null;
  return modeRaw === "staged" ? "staged" : "unstaged";
}

function resolveChangesStatusLetter(file: GitStatusFile, mode: GitCompareMode): string {
  if (file.conflicted) return "C";
  if (mode === "unstaged" && file.untracked) return "U";
  const raw = mode === "staged" ? String(file.index || "") : String(file.worktree || "");
  const status = raw.trim();
  if (!status || status === "?") return "M";
  if (status === "!") return "I";
  return status.slice(0, 1).toUpperCase();
}

function toChangesEntries(payload: GitStatusPayload | null): ChangesListEntry[] {
  if (!payload?.files?.length) return [];
  const out: ChangesListEntry[] = [];
  for (const file of payload.files) {
    if (file.staged) {
      out.push({
        key: `staged:${file.path}`,
        mode: "staged",
        path: file.path,
        renameFrom: file.renameFrom,
        status: file.status,
        statusLetter: resolveChangesStatusLetter(file, "staged"),
        staged: file.staged,
        untracked: file.untracked,
        conflicted: file.conflicted,
        index: file.index,
        worktree: file.worktree,
      });
    }
    if (file.unstaged || file.untracked) {
      out.push({
        key: `unstaged:${file.path}`,
        mode: "unstaged",
        path: file.path,
        renameFrom: file.renameFrom,
        status: file.status,
        statusLetter: resolveChangesStatusLetter(file, "unstaged"),
        staged: file.staged,
        untracked: file.untracked,
        conflicted: file.conflicted,
        index: file.index,
        worktree: file.worktree,
      });
    }
  }
  return out;
}

function toServerTerminalCommand(input: string): string {
  let text = String(input || "").trim();
  if (!text) return text;

  if (/^cav\s+open\s+codebase$/i.test(text)) return "open /cavcode";

  if (/^cav\s+open\s+--\s+/i.test(text)) {
    return text.replace(/^cav\s+open\s+--\s+/i, "open ").replace(/\/codebase\b/g, "/cavcode");
  }

  if (/^cav\s+run\s+--\s+/i.test(text)) {
    return text.replace(/^cav\s+run\s+--\s+/i, "open ").replace(/\/codebase\b/g, "/cavcode");
  }

  if (/^cav\s+codebase\b/i.test(text)) {
    const parts = text.split(/\s+/);
    const action = String(parts[2] || "").toLowerCase();
    const argA = parts[3] || "";
    const restFromAction = text.replace(/^cav\s+codebase\s+/i, "");

    if (action === "pwd") return "pwd";
    if (action === "ls") return argA ? `ls ${argA}` : "ls /cavcode";
    if (action === "tree") return argA ? `tree ${argA}` : "tree /cavcode";
    if (action === "cd") return argA ? `cd ${argA}` : "cd /cavcode";
    if (action === "cat") return argA ? `cat ${argA}` : "cat /cavcode";
    if (action === "open") return argA ? `open ${argA}` : "open /cavcode";
    if (action === "mkdir") return argA ? `mkdir ${argA}` : "mkdir /cavcode/new-folder";
    if (action === "touch") return argA ? `touch ${argA}` : "touch /cavcode/new-file.txt";
    if (action === "rm") return argA ? `rm ${argA}` : "rm /cavcode/new-file.txt";
    if (action === "write") {
      const writePayload = restFromAction.replace(/^write\s+/i, "");
      return `write ${writePayload}`;
    }
  }

  text = text.replace(/\/codebase\b/g, "/cavcode");
  return text;
}

function quoteForCavArg(input: string): string {
  const raw = String(input || "");
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shouldPreferServerCommand(raw: string): boolean {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return false;
  if (/^(pwd|cd|ls|tree|cat|mkdir|touch|write|edit|rm|mv|cp|open|search|lint|help)\b/.test(text)) return true;
  if (/^cav\b/.test(text)) return true;
  return false;
}

function isMutatingServerCommand(raw: string): boolean {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return false;
  if (/^(mkdir|touch|write|edit|rm|mv|cp)\b/.test(text)) return true;
  if (/^cav\s+(cloud\s+(publish|unpublish)|safe\s+(invite|revoke))\b/.test(text)) return true;
  if (/^cav\s+git\s+(compare|stage|unstage|commit|checkout|branch\s+(create|delete)|rebase|cherry-pick|pull|sync|conflicts\s+resolve)\b/.test(text)) return true;
  if (/^cav\s+template\s+init\b/.test(text)) return true;
  if (/^cav\s+loop\s+replace\b/.test(text)) return true;
  return false;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRuntimeKind(value: unknown): RuntimeRunKind | null {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "dev" || kind === "build" || kind === "test") return kind;
  return null;
}

function parseRuntimeStatus(value: unknown): RuntimeSessionStatus | null {
  const status = String(value || "").trim().toLowerCase();
  if (status === "starting" || status === "running" || status === "exited" || status === "failed" || status === "stopped") {
    return status;
  }
  return null;
}

function parseDebugStatus(value: unknown): DebugSessionStatus | null {
  const status = String(value || "").trim().toLowerCase();
  if (
    status === "starting"
    || status === "running"
    || status === "paused"
    || status === "exited"
    || status === "failed"
    || status === "stopped"
  ) {
    return status;
  }
  return null;
}

function parseDebugLocation(value: unknown): DebugLocation {
  const row = asObjectRecord(value);
  const fileRaw = row ? String(row.file || "").trim() : "";
  const lineRaw = row ? Number(row.line) : NaN;
  const columnRaw = row ? Number(row.column) : NaN;
  return {
    file: fileRaw || null,
    line: Number.isFinite(lineRaw) && Number.isInteger(lineRaw) && lineRaw > 0 ? Math.trunc(lineRaw) : null,
    column: Number.isFinite(columnRaw) && Number.isInteger(columnRaw) && columnRaw > 0 ? Math.trunc(columnRaw) : null,
  };
}

function parseDebugAdapterCapabilities(value: unknown): DebugAdapterCapabilities | null {
  const row = asObjectRecord(value);
  if (!row) return null;
  return {
    supportsConditionalBreakpoints: row.supportsConditionalBreakpoints !== false,
    supportsHitConditionalBreakpoints: row.supportsHitConditionalBreakpoints !== false,
    supportsLogPoints: row.supportsLogPoints !== false,
    supportsFunctionBreakpoints: row.supportsFunctionBreakpoints !== false,
    supportsExceptionFilterOptions: row.supportsExceptionFilterOptions !== false,
    supportsStepBack: row.supportsStepBack === true,
    supportsSetVariable: row.supportsSetVariable === true,
    supportsEvaluateForHovers: row.supportsEvaluateForHovers !== false,
    supportsDataBreakpoints: row.supportsDataBreakpoints === true,
    supportsReadMemoryRequest: row.supportsReadMemoryRequest === true,
  };
}

function parseDebugBreakpoint(value: unknown): DebugBreakpoint | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const id = String(rec.id || "").trim();
  const file = String(rec.file || "").trim();
  const lineRaw = Number(rec.line);
  if (!id || !file || !Number.isFinite(lineRaw) || !Number.isInteger(lineRaw) || lineRaw <= 0) return null;
  const kindRaw = String(rec.kind || "").trim();
  const kind: DebugBreakpointKind = kindRaw === "function" || kindRaw === "logpoint" ? kindRaw : "source";
  return {
    id,
    kind,
    enabled: rec.enabled !== false,
    setId: String(rec.setId || "").trim() || null,
    condition: String(rec.condition || "").trim() || null,
    hitCondition: String(rec.hitCondition || "").trim() || null,
    logMessage: String(rec.logMessage || "").trim() || null,
    functionName: String(rec.functionName || "").trim() || null,
    file,
    line: Math.trunc(lineRaw),
    verified: rec.verified !== false,
    hitCount: Number.isFinite(Number(rec.hitCount)) ? Math.max(0, Math.trunc(Number(rec.hitCount))) : 0,
    adapterBreakpointId: String(rec.adapterBreakpointId || "").trim() || null,
    message: String(rec.message || "").trim() || null,
  };
}

function parseDebugDataBreakpoint(value: unknown): DebugDataBreakpoint | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const id = String(rec.id || "").trim();
  const variablesReference = Number(rec.variablesReference);
  if (!id || !Number.isFinite(variablesReference) || !Number.isInteger(variablesReference) || variablesReference <= 0) return null;
  const accessRaw = String(rec.accessType || "").trim();
  const accessType = accessRaw === "read" || accessRaw === "readWrite" ? accessRaw : "write";
  return {
    id,
    enabled: rec.enabled !== false,
    accessType,
    variablesReference: Math.trunc(variablesReference),
    expression: String(rec.expression || "").trim() || null,
    message: String(rec.message || "").trim() || null,
  };
}

function parseDebugStackFrame(value: unknown): DebugStackFrame | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const idRaw = Number(rec.id);
  const name = String(rec.name || "").trim() || "frame";
  const file = String(rec.file || "").trim() || null;
  const lineRaw = Number(rec.line);
  const colRaw = Number(rec.column);
  return {
    id: Number.isFinite(idRaw) ? Math.max(0, Math.trunc(idRaw)) : 0,
    frameId: String(rec.frameId || "").trim() || undefined,
    threadId: Number.isFinite(Number(rec.threadId)) ? Math.max(0, Math.trunc(Number(rec.threadId))) : undefined,
    name,
    file,
    line: Number.isFinite(lineRaw) && Number.isInteger(lineRaw) && lineRaw > 0 ? Math.trunc(lineRaw) : null,
    column: Number.isFinite(colRaw) && Number.isInteger(colRaw) && colRaw > 0 ? Math.trunc(colRaw) : null,
  };
}

function parseDebugWatch(value: unknown): DebugWatch | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const expression = String(rec.expression || "").trim();
  if (!expression) return null;
  return {
    expression,
    value: rec.value == null ? null : String(rec.value),
  };
}

function parseDebugThread(value: unknown): DebugThread | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const idRaw = Number(rec.id);
  if (!Number.isFinite(idRaw) || !Number.isInteger(idRaw) || idRaw < 0) return null;
  return {
    id: Math.trunc(idRaw),
    name: String(rec.name || "").trim() || "thread",
    stopped: rec.stopped === true,
    reason: String(rec.reason || "").trim() || null,
  };
}

function parseDebugScope(value: unknown): DebugScope | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const name = String(rec.name || "").trim();
  const variablesReference = Number(rec.variablesReference);
  if (!name || !Number.isFinite(variablesReference) || !Number.isInteger(variablesReference) || variablesReference < 0) return null;
  return {
    name,
    variablesReference: Math.trunc(variablesReference),
    expensive: rec.expensive === true,
    presentationHint: String(rec.presentationHint || "").trim() || null,
  };
}

function parseDebugVariable(value: unknown): DebugVariable | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const name = String(rec.name || "").trim();
  const valueText = String(rec.value || "");
  const variablesReferenceRaw = Number(rec.variablesReference);
  if (!name || !Number.isFinite(variablesReferenceRaw) || !Number.isInteger(variablesReferenceRaw) || variablesReferenceRaw < 0) return null;
  return {
    name,
    value: valueText,
    type: String(rec.type || "").trim() || null,
    variablesReference: Math.trunc(variablesReferenceRaw),
    evaluateName: String(rec.evaluateName || "").trim() || null,
  };
}

function parseDebugConsoleEntry(value: unknown): DebugConsoleEntry | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const seqRaw = Number(rec.seq);
  if (!Number.isFinite(seqRaw) || !Number.isInteger(seqRaw) || seqRaw < 0) return null;
  const categoryRaw = String(rec.category || "").trim();
  const category = categoryRaw === "stderr" || categoryRaw === "console" || categoryRaw === "repl" || categoryRaw === "exception"
    ? categoryRaw
    : "stdout";
  const text = String(rec.text || "");
  return {
    seq: Math.trunc(seqRaw),
    atISO: String(rec.atISO || "").trim(),
    category,
    text,
    level: String(rec.level || "").trim() || null,
  };
}

function parseDebugLoadedScript(value: unknown): DebugLoadedScript | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const scriptId = String(rec.scriptId || "").trim();
  const url = String(rec.url || "").trim();
  if (!scriptId || !url) return null;
  return {
    scriptId,
    url,
    file: String(rec.file || "").trim() || null,
    cavcodePath: String(rec.cavcodePath || "").trim() || null,
    sourceMapUrl: String(rec.sourceMapUrl || "").trim() || null,
    hash: String(rec.hash || "").trim() || null,
    language: String(rec.language || "").trim() || null,
    isModule: rec.isModule === true,
    lastSeenISO: String(rec.lastSeenISO || "").trim(),
  };
}

function parseDebugLoadedModule(value: unknown): DebugLoadedModule | null {
  const rec = asObjectRecord(value);
  if (!rec) return null;
  const moduleName = String(rec.module || "").trim();
  if (!moduleName) return null;
  return {
    module: moduleName,
    scriptCount: Number.isFinite(Number(rec.scriptCount)) ? Math.max(0, Math.trunc(Number(rec.scriptCount))) : 0,
  };
}

function parseRuntimeStatusPayload(value: unknown): RuntimeStatusPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  const type = String(data.type || "").trim();
  if (
    type !== "cav_runtime_started_v1"
    && type !== "cav_runtime_restarted_v1"
    && type !== "cav_runtime_status_v1"
    && type !== "cav_runtime_stop_v1"
  ) {
    return null;
  }
  const sessionId = String(data.sessionId || "").trim();
  const kind = parseRuntimeKind(data.kind);
  const status = parseRuntimeStatus(data.status);
  if (!sessionId || !kind || !status) return null;
  const exitCode = Number.isFinite(Number(data.exitCode)) ? Math.trunc(Number(data.exitCode)) : null;
  const exitSignal = String(data.exitSignal || "").trim() || null;
  const nextSeq = Number.isFinite(Number(data.nextSeq)) ? Math.max(0, Math.trunc(Number(data.nextSeq))) : null;
  return {
    type: type as RuntimeStatusPayload["type"],
    sessionId,
    kind,
    status,
    exitCode,
    exitSignal,
    nextSeq,
  };
}

function parseRuntimeLogsPayload(value: unknown): RuntimeLogsPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_runtime_logs_v1") return null;
  const sessionId = String(data.sessionId || "").trim();
  const kind = parseRuntimeKind(data.kind);
  const status = parseRuntimeStatus(data.status);
  if (!sessionId || !kind || !status) return null;

  const rawEntries = Array.isArray(data.entries) ? data.entries : [];
  const entries: RuntimeLogEntry[] = rawEntries
    .map((entry): RuntimeLogEntry | null => {
      const row = asObjectRecord(entry);
      if (!row) return null;
      const seq = Number.isFinite(Number(row.seq)) ? Math.max(0, Math.trunc(Number(row.seq))) : null;
      const streamRaw = String(row.stream || "").trim().toLowerCase();
      const stream = streamRaw === "stdout" || streamRaw === "stderr" || streamRaw === "system" ? streamRaw : null;
      if (seq == null || !stream) return null;
      return {
        seq,
        atISO: String(row.atISO || "").trim(),
        stream,
        text: String(row.text || ""),
      };
    })
    .filter((entry): entry is RuntimeLogEntry => Boolean(entry));

  return {
    type: "cav_runtime_logs_v1",
    sessionId,
    status,
    kind,
    exitCode: Number.isFinite(Number(data.exitCode)) ? Math.trunc(Number(data.exitCode)) : null,
    exitSignal: String(data.exitSignal || "").trim() || null,
    nextSeq: Number.isFinite(Number(data.nextSeq)) ? Math.max(0, Math.trunc(Number(data.nextSeq))) : 0,
    logTruncated: data.logTruncated === true,
    entries,
  };
}

function parseDebugStatusPayload(value: unknown): DebugStatusPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_status_v1") return null;
  const sessionId = String(data.sessionId || "").trim();
  const status = parseDebugStatus(data.status);
  const entryPath = String(data.entryPath || "").trim();
  if (!sessionId || !status || !entryPath) return null;

  const breakpoints = (Array.isArray(data.breakpoints) ? data.breakpoints : [])
    .map((row) => parseDebugBreakpoint(row))
    .filter((row): row is DebugBreakpoint => Boolean(row));
  const functionBreakpoints = (Array.isArray(data.functionBreakpoints) ? data.functionBreakpoints : [])
    .map((row) => parseDebugBreakpoint(row))
    .filter((row): row is DebugBreakpoint => Boolean(row));
  const dataBreakpoints = (Array.isArray(data.dataBreakpoints) ? data.dataBreakpoints : [])
    .map((row) => parseDebugDataBreakpoint(row))
    .filter((row): row is DebugDataBreakpoint => Boolean(row));
  const threads = (Array.isArray(data.threads) ? data.threads : [])
    .map((row) => parseDebugThread(row))
    .filter((row): row is DebugThread => Boolean(row));
  const stack = (Array.isArray(data.stack) ? data.stack : [])
    .map((row) => parseDebugStackFrame(row))
    .filter((row): row is DebugStackFrame => Boolean(row));
  const scopes = (Array.isArray(data.scopes) ? data.scopes : [])
    .map((row) => parseDebugScope(row))
    .filter((row): row is DebugScope => Boolean(row));
  const watches = (Array.isArray(data.watches) ? data.watches : [])
    .map((row) => parseDebugWatch(row))
    .filter((row): row is DebugWatch => Boolean(row));
  const consoleEntries = (Array.isArray(data.consoleEntries) ? data.consoleEntries : [])
    .map((row) => parseDebugConsoleEntry(row))
    .filter((row): row is DebugConsoleEntry => Boolean(row));
  const loadedScripts = (Array.isArray(data.loadedScripts) ? data.loadedScripts : [])
    .map((row) => parseDebugLoadedScript(row))
    .filter((row): row is DebugLoadedScript => Boolean(row));
  const loadedModules = (Array.isArray(data.loadedModules) ? data.loadedModules : [])
    .map((row) => parseDebugLoadedModule(row))
    .filter((row): row is DebugLoadedModule => Boolean(row));
  const exceptionFiltersRaw = asObjectRecord(data.exceptionFilters);
  const attachInfoRaw = asObjectRecord(data.attachInfo);

  return {
    type: "cav_debug_status_v1",
    sessionId,
    status,
    entryPath,
    projectId: Number.isFinite(Number(data.projectId)) ? Math.trunc(Number(data.projectId)) : undefined,
    adapterId: String(data.adapterId || "").trim() || undefined,
    adapterLabel: String(data.adapterLabel || "").trim() || undefined,
    adapterType: String(data.adapterType || "").trim() || undefined,
    launchTargetName: String(data.launchTargetName || "").trim() || null,
    launchCompoundName: String(data.launchCompoundName || "").trim() || null,
    launchProfileId: String(data.launchProfileId || "").trim() || null,
    workspaceVariantId: String(data.workspaceVariantId || "").trim() || null,
    launchRequest: String(data.launchRequest || "").trim() === "attach" ? "attach" : "launch",
    postDebugTask: String(data.postDebugTask || "").trim() || null,
    postDebugTaskRan: data.postDebugTaskRan === true,
    attachInfo: attachInfoRaw
      ? {
          host: String(attachInfoRaw.host || "").trim() || null,
          port: Number.isFinite(Number(attachInfoRaw.port)) ? Math.trunc(Number(attachInfoRaw.port)) : null,
          wsUrl: String(attachInfoRaw.wsUrl || "").trim() || null,
          processId: Number.isFinite(Number(attachInfoRaw.processId)) ? Math.trunc(Number(attachInfoRaw.processId)) : null,
        }
      : null,
    capabilities: parseDebugAdapterCapabilities(data.capabilities),
    exitCode: Number.isFinite(Number(data.exitCode)) ? Math.trunc(Number(data.exitCode)) : null,
    exitSignal: String(data.exitSignal || "").trim() || null,
    nextSeq: Number.isFinite(Number(data.nextSeq)) ? Math.max(0, Math.trunc(Number(data.nextSeq))) : 0,
    currentLocation: parseDebugLocation(data.currentLocation),
    breakpoints,
    functionBreakpoints,
    dataBreakpoints,
    exceptionFilters: {
      all: exceptionFiltersRaw?.all === true,
      uncaught: exceptionFiltersRaw?.uncaught === true,
    },
    threads,
    selectedThreadId: Number.isFinite(Number(data.selectedThreadId)) ? Math.trunc(Number(data.selectedThreadId)) : null,
    selectedFrameOrdinal: Number.isFinite(Number(data.selectedFrameOrdinal)) ? Math.max(0, Math.trunc(Number(data.selectedFrameOrdinal))) : null,
    stack,
    scopes,
    watches,
    consoleEntries,
    loadedScripts,
    loadedModules,
  };
}

function parseDebugLogsPayload(value: unknown): DebugLogsPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_logs_v1") return null;
  const sessionId = String(data.sessionId || "").trim();
  const status = parseDebugStatus(data.status);
  if (!sessionId || !status) return null;

  const entriesRaw = Array.isArray(data.entries) ? data.entries : [];
  const entries: DebugLogEntry[] = entriesRaw
    .map((entry): DebugLogEntry | null => {
      const row = asObjectRecord(entry);
      if (!row) return null;
      const seq = Number.isFinite(Number(row.seq)) ? Math.max(0, Math.trunc(Number(row.seq))) : null;
      const streamRaw = String(row.stream || "").trim().toLowerCase();
      const stream = streamRaw === "stdout" || streamRaw === "stderr" || streamRaw === "system" ? streamRaw : null;
      if (seq == null || !stream) return null;
      return {
        seq,
        atISO: String(row.atISO || "").trim(),
        stream,
        text: String(row.text || ""),
      };
    })
    .filter((row): row is DebugLogEntry => Boolean(row));

  const breakpoints = (Array.isArray(data.breakpoints) ? data.breakpoints : [])
    .map((row) => parseDebugBreakpoint(row))
    .filter((row): row is DebugBreakpoint => Boolean(row));
  const functionBreakpoints = (Array.isArray(data.functionBreakpoints) ? data.functionBreakpoints : [])
    .map((row) => parseDebugBreakpoint(row))
    .filter((row): row is DebugBreakpoint => Boolean(row));
  const dataBreakpoints = (Array.isArray(data.dataBreakpoints) ? data.dataBreakpoints : [])
    .map((row) => parseDebugDataBreakpoint(row))
    .filter((row): row is DebugDataBreakpoint => Boolean(row));
  const threads = (Array.isArray(data.threads) ? data.threads : [])
    .map((row) => parseDebugThread(row))
    .filter((row): row is DebugThread => Boolean(row));
  const stack = (Array.isArray(data.stack) ? data.stack : [])
    .map((row) => parseDebugStackFrame(row))
    .filter((row): row is DebugStackFrame => Boolean(row));
  const scopes = (Array.isArray(data.scopes) ? data.scopes : [])
    .map((row) => parseDebugScope(row))
    .filter((row): row is DebugScope => Boolean(row));
  const watches = (Array.isArray(data.watches) ? data.watches : [])
    .map((row) => parseDebugWatch(row))
    .filter((row): row is DebugWatch => Boolean(row));
  const consoleEntries = (Array.isArray(data.consoleEntries) ? data.consoleEntries : [])
    .map((row) => parseDebugConsoleEntry(row))
    .filter((row): row is DebugConsoleEntry => Boolean(row));
  const loadedScripts = (Array.isArray(data.loadedScripts) ? data.loadedScripts : [])
    .map((row) => parseDebugLoadedScript(row))
    .filter((row): row is DebugLoadedScript => Boolean(row));
  const loadedModules = (Array.isArray(data.loadedModules) ? data.loadedModules : [])
    .map((row) => parseDebugLoadedModule(row))
    .filter((row): row is DebugLoadedModule => Boolean(row));
  const exceptionFiltersRaw = asObjectRecord(data.exceptionFilters);
  const attachInfoRaw = asObjectRecord(data.attachInfo);

  return {
    type: "cav_debug_logs_v1",
    sessionId,
    status,
    adapterId: String(data.adapterId || "").trim() || undefined,
    adapterLabel: String(data.adapterLabel || "").trim() || undefined,
    adapterType: String(data.adapterType || "").trim() || undefined,
    launchTargetName: String(data.launchTargetName || "").trim() || null,
    launchCompoundName: String(data.launchCompoundName || "").trim() || null,
    launchProfileId: String(data.launchProfileId || "").trim() || null,
    workspaceVariantId: String(data.workspaceVariantId || "").trim() || null,
    launchRequest: String(data.launchRequest || "").trim() === "attach" ? "attach" : "launch",
    postDebugTask: String(data.postDebugTask || "").trim() || null,
    postDebugTaskRan: data.postDebugTaskRan === true,
    attachInfo: attachInfoRaw
      ? {
          host: String(attachInfoRaw.host || "").trim() || null,
          port: Number.isFinite(Number(attachInfoRaw.port)) ? Math.trunc(Number(attachInfoRaw.port)) : null,
          wsUrl: String(attachInfoRaw.wsUrl || "").trim() || null,
          processId: Number.isFinite(Number(attachInfoRaw.processId)) ? Math.trunc(Number(attachInfoRaw.processId)) : null,
        }
      : null,
    capabilities: parseDebugAdapterCapabilities(data.capabilities),
    exitCode: Number.isFinite(Number(data.exitCode)) ? Math.trunc(Number(data.exitCode)) : null,
    exitSignal: String(data.exitSignal || "").trim() || null,
    nextSeq: Number.isFinite(Number(data.nextSeq)) ? Math.max(0, Math.trunc(Number(data.nextSeq))) : 0,
    logTruncated: data.logTruncated === true,
    currentLocation: data.currentLocation ? parseDebugLocation(data.currentLocation) : undefined,
    breakpoints,
    functionBreakpoints,
    dataBreakpoints,
    exceptionFilters: {
      all: exceptionFiltersRaw?.all === true,
      uncaught: exceptionFiltersRaw?.uncaught === true,
    },
    threads,
    selectedThreadId: Number.isFinite(Number(data.selectedThreadId)) ? Math.trunc(Number(data.selectedThreadId)) : null,
    selectedFrameOrdinal: Number.isFinite(Number(data.selectedFrameOrdinal)) ? Math.max(0, Math.trunc(Number(data.selectedFrameOrdinal))) : null,
    stack,
    scopes,
    watches,
    consoleEntries,
    loadedScripts,
    loadedModules,
    entries,
  };
}

function parseDebugEvalPayload(value: unknown): DebugEvalPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_eval_v1") return null;
  const sessionId = String(data.sessionId || "").trim();
  const expression = String(data.expression || "").trim();
  if (!sessionId || !expression) return null;
  return {
    type: "cav_debug_eval_v1",
    sessionId,
    expression,
    frameOrdinal: Number.isFinite(Number(data.frameOrdinal)) ? Math.max(0, Math.trunc(Number(data.frameOrdinal))) : null,
    value: String(data.value || ""),
    valueType: String(data.valueType || "").trim() || null,
    variablesReference: Number.isFinite(Number(data.variablesReference)) ? Math.max(0, Math.trunc(Number(data.variablesReference))) : 0,
  };
}

function parseDebugVarsPayload(value: unknown): DebugVarsPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_vars_v1") return null;
  const sessionId = String(data.sessionId || "").trim();
  if (!sessionId) return null;
  const rows = (Array.isArray(data.rows) ? data.rows : [])
    .map((row) => parseDebugVariable(row))
    .filter((row): row is DebugVariable => Boolean(row));
  return {
    type: "cav_debug_vars_v1",
    sessionId,
    variablesReference: Number.isFinite(Number(data.variablesReference)) ? Math.max(0, Math.trunc(Number(data.variablesReference))) : 0,
    start: Number.isFinite(Number(data.start)) ? Math.max(0, Math.trunc(Number(data.start))) : 0,
    count: Number.isFinite(Number(data.count)) ? Math.max(1, Math.trunc(Number(data.count))) : rows.length,
    returned: Number.isFinite(Number(data.returned)) ? Math.max(0, Math.trunc(Number(data.returned))) : rows.length,
    rows,
  };
}

function parseCavcodeEventsPayload(value: unknown): CavcodeEventsStreamPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cavcode_events_v1") return null;
  const projectIdRaw = Number(data.projectId);
  if (!Number.isFinite(projectIdRaw) || !Number.isInteger(projectIdRaw) || projectIdRaw <= 0) return null;
  const afterSeq = Number.isFinite(Number(data.afterSeq)) ? Math.max(0, Math.trunc(Number(data.afterSeq))) : 0;
  const nextSeq = Number.isFinite(Number(data.nextSeq)) ? Math.max(0, Math.trunc(Number(data.nextSeq))) : afterSeq;
  const rawEvents = Array.isArray(data.events) ? data.events : [];
  const events: CavcodeEventPayload[] = rawEvents
    .map((row): CavcodeEventPayload | null => {
      const record = asObjectRecord(row);
      if (!record) return null;
      const seqRaw = Number(record.seq);
      const eventProjectIdRaw = Number(record.projectId);
      if (!Number.isFinite(seqRaw) || !Number.isInteger(seqRaw) || seqRaw < 0) return null;
      if (!Number.isFinite(eventProjectIdRaw) || !Number.isInteger(eventProjectIdRaw) || eventProjectIdRaw <= 0) return null;
      const kind = String(record.kind || "").trim();
      if (!kind) return null;
      const payloadRecord = asObjectRecord(record.payload) || {};
      return {
        seq: Math.trunc(seqRaw),
        kind,
        projectId: Math.trunc(eventProjectIdRaw),
        userId: String(record.userId || "").trim(),
        atISO: String(record.atISO || "").trim(),
        payload: payloadRecord,
      };
    })
    .filter((row): row is CavcodeEventPayload => Boolean(row));
  return {
    type: "cavcode_events_v1",
    projectId: Math.trunc(projectIdRaw),
    afterSeq,
    nextSeq,
    events,
  };
}

function parseDebugSessionListPayload(value: unknown): DebugSessionListPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_sessions_v1") return null;
  const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
    .map((row) => parseDebugStatusPayload(row))
    .filter((row): row is DebugStatusPayload => Boolean(row));
  return {
    type: "cav_debug_sessions_v1",
    activeSessionId: String(data.activeSessionId || "").trim() || null,
    count: Number.isFinite(Number(data.count)) ? Math.max(0, Math.trunc(Number(data.count))) : sessions.length,
    sessions,
  };
}

function parseDebugLaunchManifestPayload(value: unknown): DebugLaunchManifestPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_debug_launch_manifest_v1") return null;

  const parseProfile = (valueInner: unknown): DebugLaunchProfile | null => {
    const rec = asObjectRecord(valueInner);
    if (!rec) return null;
    const id = String(rec.id || "").trim();
    const name = String(rec.name || "").trim();
    if (!id || !name) return null;
    const envRaw = asObjectRecord(rec.env) || {};
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(envRaw)) {
      const envKey = String(key || "").trim();
      if (!envKey) continue;
      env[envKey] = String(raw ?? "");
    }
    return {
      id,
      name,
      description: String(rec.description || "").trim() || null,
      runtimeExecutable: String(rec.runtimeExecutable || "").trim() || null,
      runtimeArgs: Array.isArray(rec.runtimeArgs) ? rec.runtimeArgs.map((row) => String(row || "")).filter(Boolean) : [],
      programArgs: Array.isArray(rec.programArgs) ? rec.programArgs.map((row) => String(row || "")).filter(Boolean) : [],
      cwdCavcodePath: String(rec.cwdCavcodePath || "").trim() || null,
      env,
      preLaunchTask: String(rec.preLaunchTask || "").trim() || null,
      postDebugTask: String(rec.postDebugTask || "").trim() || null,
    };
  };

  const parseVariant = (valueInner: unknown): DebugWorkspaceVariant | null => {
    const rec = asObjectRecord(valueInner);
    if (!rec) return null;
    const id = String(rec.id || "").trim();
    const name = String(rec.name || "").trim();
    if (!id || !name) return null;
    const envRaw = asObjectRecord(rec.env) || {};
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(envRaw)) {
      const envKey = String(key || "").trim();
      if (!envKey) continue;
      env[envKey] = String(raw ?? "");
    }
    return {
      id,
      name,
      description: String(rec.description || "").trim() || null,
      runtimeExecutable: String(rec.runtimeExecutable || "").trim() || null,
      runtimeArgs: Array.isArray(rec.runtimeArgs) ? rec.runtimeArgs.map((row) => String(row || "")).filter(Boolean) : [],
      programArgs: Array.isArray(rec.programArgs) ? rec.programArgs.map((row) => String(row || "")).filter(Boolean) : [],
      cwdCavcodePath: String(rec.cwdCavcodePath || "").trim() || null,
      env,
      preLaunchTask: String(rec.preLaunchTask || "").trim() || null,
      postDebugTask: String(rec.postDebugTask || "").trim() || null,
    };
  };

  const parseTarget = (valueInner: unknown): DebugLaunchTarget | null => {
    const rec = asObjectRecord(valueInner);
    if (!rec) return null;
    const id = String(rec.id || "").trim();
    const name = String(rec.name || "").trim();
    if (!id || !name) return null;
    const envRaw = asObjectRecord(rec.env) || {};
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(envRaw)) {
      const envKey = String(key || "").trim();
      if (!envKey) continue;
      env[envKey] = String(raw ?? "");
    }
    return {
      id,
      name,
      request: String(rec.request || "").trim() === "attach" ? "attach" : "launch",
      debugType: String(rec.debugType || "").trim(),
      adapterId: String(rec.adapterId || "").trim(),
      entryCavcodePath: String(rec.entryCavcodePath || "").trim() || null,
      cwdCavcodePath: String(rec.cwdCavcodePath || "").trim() || null,
      runtimeExecutable: String(rec.runtimeExecutable || "").trim(),
      runtimeArgs: Array.isArray(rec.runtimeArgs) ? rec.runtimeArgs.map((row) => String(row || "")).filter(Boolean) : [],
      programArgs: Array.isArray(rec.programArgs) ? rec.programArgs.map((row) => String(row || "")).filter(Boolean) : [],
      stopOnEntry: rec.stopOnEntry === true,
      env,
      sourceMaps: rec.sourceMaps !== false,
      outFiles: Array.isArray(rec.outFiles) ? rec.outFiles.map((row) => String(row || "")).filter(Boolean) : [],
      attachHost: String(rec.attachHost || "").trim() || null,
      attachPort: Number.isFinite(Number(rec.attachPort)) ? Math.max(0, Math.trunc(Number(rec.attachPort))) : null,
      attachWsUrl: String(rec.attachWsUrl || "").trim() || null,
      attachProcessId: Number.isFinite(Number(rec.attachProcessId)) ? Math.max(0, Math.trunc(Number(rec.attachProcessId))) : null,
      preLaunchTask: String(rec.preLaunchTask || "").trim() || null,
      postDebugTask: String(rec.postDebugTask || "").trim() || null,
      profileId: String(rec.profileId || "").trim() || null,
      workspaceVariantId: String(rec.workspaceVariantId || "").trim() || null,
      presentationGroup: String(rec.presentationGroup || "").trim() || null,
    };
  };

  const parseCompound = (valueInner: unknown): DebugLaunchCompound | null => {
    const rec = asObjectRecord(valueInner);
    if (!rec) return null;
    const id = String(rec.id || "").trim();
    const name = String(rec.name || "").trim();
    if (!id || !name) return null;
    return {
      id,
      name,
      configurationRefs: Array.isArray(rec.configurationRefs)
        ? rec.configurationRefs.map((row) => String(row || "")).filter(Boolean)
        : [],
      targetIds: Array.isArray(rec.targetIds) ? rec.targetIds.map((row) => String(row || "")).filter(Boolean) : [],
      preLaunchTask: String(rec.preLaunchTask || "").trim() || null,
      postDebugTask: String(rec.postDebugTask || "").trim() || null,
      stopAll: rec.stopAll !== false,
      presentationGroup: String(rec.presentationGroup || "").trim() || null,
    };
  };

  const parseTask = (valueInner: unknown): DebugTaskDefinition | null => {
    const rec = asObjectRecord(valueInner);
    if (!rec) return null;
    const id = String(rec.id || "").trim();
    const label = String(rec.label || "").trim();
    if (!id || !label) return null;
    const envRaw = asObjectRecord(rec.env) || {};
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(envRaw)) {
      const envKey = String(key || "").trim();
      if (!envKey) continue;
      env[envKey] = String(raw ?? "");
    }
    return {
      id,
      label,
      type: String(rec.type || "").trim(),
      command: String(rec.command || "").trim(),
      args: Array.isArray(rec.args) ? rec.args.map((row) => String(row || "")).filter(Boolean) : [],
      cwd: String(rec.cwd || "").trim() || null,
      env,
      detail: String(rec.detail || "").trim() || null,
      dependsOn: Array.isArray(rec.dependsOn) ? rec.dependsOn.map((row) => String(row || "")).filter(Boolean) : [],
    };
  };

  return {
    type: "cav_debug_launch_manifest_v1",
    count: Number.isFinite(Number(data.count)) ? Math.max(0, Math.trunc(Number(data.count))) : 0,
    targets: (Array.isArray(data.targets) ? data.targets : [])
      .map((row) => parseTarget(row))
      .filter((row): row is DebugLaunchTarget => Boolean(row)),
    compounds: (Array.isArray(data.compounds) ? data.compounds : [])
      .map((row) => parseCompound(row))
      .filter((row): row is DebugLaunchCompound => Boolean(row)),
    profiles: (Array.isArray(data.profiles) ? data.profiles : [])
      .map((row) => parseProfile(row))
      .filter((row): row is DebugLaunchProfile => Boolean(row)),
    workspaceVariants: (Array.isArray(data.workspaceVariants) ? data.workspaceVariants : [])
      .map((row) => parseVariant(row))
      .filter((row): row is DebugWorkspaceVariant => Boolean(row)),
    tasks: (Array.isArray(data.tasks) ? data.tasks : [])
      .map((row) => parseTask(row))
      .filter((row): row is DebugTaskDefinition => Boolean(row)),
  };
}

function parseGitStatusPayload(value: unknown): GitStatusPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_git_status_v2") return null;
  const files = (Array.isArray(data.files) ? data.files : [])
    .map((row): GitStatusFile | null => {
      const rec = asObjectRecord(row);
      if (!rec) return null;
      const filePath = String(rec.path || "").trim();
      if (!filePath) return null;
      return {
        path: filePath,
        renameFrom: String(rec.renameFrom || "").trim() || null,
        index: String(rec.index || "").trim(),
        worktree: String(rec.worktree || "").trim(),
        status: String(rec.status || "").trim(),
        staged: rec.staged === true,
        unstaged: rec.unstaged === true,
        untracked: rec.untracked === true,
        ignored: rec.ignored === true,
        conflicted: rec.conflicted === true,
      };
    })
    .filter((row): row is GitStatusFile => Boolean(row));
  const remotes = (Array.isArray(data.remotes) ? data.remotes : [])
    .map((row): GitRemote | null => {
      const rec = asObjectRecord(row);
      if (!rec) return null;
      const name = String(rec.name || "").trim();
      if (!name) return null;
      return {
        name,
        fetch: String(rec.fetch || "").trim(),
        push: String(rec.push || "").trim(),
      };
    })
    .filter((row): row is GitRemote => Boolean(row));
  return {
    type: "cav_git_status_v2",
    branch: String(data.branch || "").trim(),
    detached: data.detached === true,
    upstream: String(data.upstream || "").trim() || null,
    ahead: Number.isFinite(Number(data.ahead)) ? Math.max(0, Math.trunc(Number(data.ahead))) : 0,
    behind: Number.isFinite(Number(data.behind)) ? Math.max(0, Math.trunc(Number(data.behind))) : 0,
    stagedCount: Number.isFinite(Number(data.stagedCount)) ? Math.max(0, Math.trunc(Number(data.stagedCount))) : files.filter((f) => f.staged).length,
    unstagedCount: Number.isFinite(Number(data.unstagedCount)) ? Math.max(0, Math.trunc(Number(data.unstagedCount))) : files.filter((f) => f.unstaged).length,
    untrackedCount: Number.isFinite(Number(data.untrackedCount)) ? Math.max(0, Math.trunc(Number(data.untrackedCount))) : files.filter((f) => f.untracked).length,
    conflictedCount: Number.isFinite(Number(data.conflictedCount)) ? Math.max(0, Math.trunc(Number(data.conflictedCount))) : files.filter((f) => f.conflicted).length,
    files,
    remotes,
    conflicts: (Array.isArray(data.conflicts) ? data.conflicts : []).map((row) => String(row || "").trim()).filter(Boolean),
    workspaceSync: asObjectRecord(data.workspaceSync)
      ? {
          filesWritten: Number.isFinite(Number((data.workspaceSync as Record<string, unknown>).filesWritten))
            ? Math.max(0, Math.trunc(Number((data.workspaceSync as Record<string, unknown>).filesWritten)))
            : 0,
          filesRemoved: Number.isFinite(Number((data.workspaceSync as Record<string, unknown>).filesRemoved))
            ? Math.max(0, Math.trunc(Number((data.workspaceSync as Record<string, unknown>).filesRemoved)))
            : 0,
          bytesWritten: Number.isFinite(Number((data.workspaceSync as Record<string, unknown>).bytesWritten))
            ? Math.max(0, Math.trunc(Number((data.workspaceSync as Record<string, unknown>).bytesWritten)))
            : 0,
          warnings: Array.isArray((data.workspaceSync as Record<string, unknown>).warnings)
            ? ((data.workspaceSync as Record<string, unknown>).warnings as unknown[]).map((row) => String(row || "")).filter(Boolean)
            : [],
        }
      : undefined,
  };
}

function parseGitAuthRequiredPayload(value: unknown): GitAuthRequiredPayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_git_auth_required_v1") return null;
  const command = String(data.command || "").trim();
  const message = String(data.message || "").trim();
  if (!command || !message) return null;
  return {
    type: "cav_git_auth_required_v1",
    command,
    message,
  };
}

function parseGitComparePayload(value: unknown): GitComparePayload | null {
  const data = asObjectRecord(value);
  if (!data) return null;
  if (String(data.type || "").trim() !== "cav_git_compare_v1") return null;
  const modeRaw = String(data.mode || "").trim().toLowerCase();
  const mode: GitCompareMode = modeRaw === "staged" ? "staged" : "unstaged";
  const filePath = String(data.path || "").trim();
  if (!filePath) return null;
  return {
    type: "cav_git_compare_v1",
    mode,
    path: filePath,
    renameFrom: String(data.renameFrom || "").trim() || null,
    status: String(data.status || "").trim(),
    staged: data.staged === true,
    untracked: data.untracked === true,
    conflicted: data.conflicted === true,
    binary: data.binary === true,
    leftLabel: String(data.leftLabel || "").trim() || (mode === "staged" ? "HEAD" : "Index"),
    rightLabel: String(data.rightLabel || "").trim() || (mode === "staged" ? "Index" : "Working Tree"),
    leftContent: String(data.leftContent ?? ""),
    rightContent: String(data.rightContent ?? ""),
    addedLines: Number.isFinite(Number(data.addedLines)) ? Math.max(0, Math.trunc(Number(data.addedLines))) : 0,
    removedLines: Number.isFinite(Number(data.removedLines)) ? Math.max(0, Math.trunc(Number(data.removedLines))) : 0,
  };
}

function readRuntimeStatusPayloadFromBlock(block: CavtoolsExecBlock): RuntimeStatusPayload | null {
  if (block.kind !== "json") return null;
  return parseRuntimeStatusPayload(block.data);
}

function readRuntimeLogsPayloadFromBlock(block: CavtoolsExecBlock): RuntimeLogsPayload | null {
  if (block.kind !== "json") return null;
  return parseRuntimeLogsPayload(block.data);
}

function readDebugStatusPayloadFromBlock(block: CavtoolsExecBlock): DebugStatusPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugStatusPayload(block.data);
}

function readDebugLogsPayloadFromBlock(block: CavtoolsExecBlock): DebugLogsPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugLogsPayload(block.data);
}

function readDebugEvalPayloadFromBlock(block: CavtoolsExecBlock): DebugEvalPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugEvalPayload(block.data);
}

function readDebugVarsPayloadFromBlock(block: CavtoolsExecBlock): DebugVarsPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugVarsPayload(block.data);
}

function readDebugSessionListPayloadFromBlock(block: CavtoolsExecBlock): DebugSessionListPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugSessionListPayload(block.data);
}

function readDebugLaunchManifestPayloadFromBlock(block: CavtoolsExecBlock): DebugLaunchManifestPayload | null {
  if (block.kind !== "json") return null;
  return parseDebugLaunchManifestPayload(block.data);
}

function readGitStatusPayloadFromBlock(block: CavtoolsExecBlock): GitStatusPayload | null {
  if (block.kind !== "json") return null;
  return parseGitStatusPayload(block.data);
}

function readGitAuthRequiredPayloadFromBlock(block: CavtoolsExecBlock): GitAuthRequiredPayload | null {
  if (block.kind !== "json") return null;
  return parseGitAuthRequiredPayload(block.data);
}

function readGitComparePayloadFromBlock(block: CavtoolsExecBlock): GitComparePayload | null {
  if (block.kind !== "json") return null;
  return parseGitComparePayload(block.data);
}

function toProblemFromWorkspaceDiagnostic(diag: CavtoolsWorkspaceDiagnostic): Problem | null {
  const fileRaw = normalizePath(String(diag.file || ""));
  if (!fileRaw) return null;
  const file = toCodebasePathFromCavcode(fileRaw);
  if (!file.startsWith("/codebase/")) return null;
  const severityRaw = String(diag.severity || "").toLowerCase();
  const severity: Problem["severity"] =
    severityRaw === "error" ? "error" : severityRaw === "warn" || severityRaw === "warning" ? "warn" : "info";
  const line = Number.isFinite(Number(diag.line)) ? Math.max(1, Math.trunc(Number(diag.line))) : 1;
  const col = Number.isFinite(Number(diag.col)) ? Math.max(1, Math.trunc(Number(diag.col))) : 1;
  const message = String(diag.message || "").trim();
  if (!message) return null;
  const source = String(diag.source || "workspace").trim() || "workspace";
  const code = String(diag.code || "").trim() || undefined;
  return {
    severity,
    message,
    file,
    line,
    col,
    source,
    code,
    fixReady: diag.fixReady === true || Boolean(code),
  };
}

function dedupeProblems(items: Problem[]): Problem[] {
  const seen = new Set<string>();
  const out: Problem[] = [];
  for (const row of items) {
    const key = [
      normalizePath(row.file || ""),
      String(Math.max(1, Math.trunc(Number(row.line) || 1))),
      String(Math.max(1, Math.trunc(Number(row.col) || 1))),
      row.severity,
      String(row.source || "").trim().toLowerCase(),
      String(row.code || "").trim(),
      String(row.message || "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function collectWorkspaceProblemsFromBlocks(blocks: CavtoolsExecBlock[]): Problem[] {
  const out: Problem[] = [];
  for (const block of blocks || []) {
    if (block.kind !== "diagnostics") continue;
    for (const diag of block.diagnostics || []) {
      const mapped = toProblemFromWorkspaceDiagnostic(diag);
      if (mapped) out.push(mapped);
    }
  }
  return dedupeProblems(out);
}

function formatCavtoolsBlockToTerminalLines(block: CavtoolsExecBlock): string[] {
  if (block.kind === "warning") {
    return [fromServerOutputToCodebaseText(block.message)];
  }

  if (block.kind === "text") {
    const lines = [...(block.title ? [block.title] : []), ...(block.lines || [])];
    return lines.map((line) => fromServerOutputToCodebaseText(line));
  }

  if (block.kind === "json") {
    const debugLogs = readDebugLogsPayloadFromBlock(block);
    if (debugLogs) {
      return debugLogs.entries
        .map((entry) => {
          const text = String(entry.text || "").trimEnd();
          if (!text) return "";
          if (entry.stream === "stderr") return `[debug:stderr] ${text}`;
          if (entry.stream === "system") return `[debug] ${text}`;
          return `[debug] ${text}`;
        })
        .filter(Boolean)
        .map((line) => fromServerOutputToCodebaseText(line));
    }

    const debugStatus = readDebugStatusPayloadFromBlock(block);
    if (debugStatus) {
      const statusText = debugStatus.status.toUpperCase();
      const exitText =
        debugStatus.exitCode != null
          ? ` (exit ${debugStatus.exitCode})`
          : debugStatus.exitSignal
            ? ` (${debugStatus.exitSignal})`
            : "";
      const locationText =
        debugStatus.currentLocation?.file && debugStatus.currentLocation?.line
          ? ` @ ${toCodebasePathFromCavcode(normalizePath(debugStatus.currentLocation.file))}:${debugStatus.currentLocation.line}`
          : "";
      return [
        fromServerOutputToCodebaseText(
          `[debug] session ${debugStatus.sessionId} ${statusText}${locationText}${exitText}`
        ),
      ];
    }

    const runtimeLogs = readRuntimeLogsPayloadFromBlock(block);
    if (runtimeLogs) {
      return runtimeLogs.entries
        .map((entry) => {
          const text = String(entry.text || "").trimEnd();
          if (!text) return "";
          if (entry.stream === "stderr") return `[stderr] ${text}`;
          if (entry.stream === "system") return `[runtime] ${text}`;
          return text;
        })
        .filter(Boolean)
        .map((line) => fromServerOutputToCodebaseText(line));
    }

    const runtimeStatus = readRuntimeStatusPayloadFromBlock(block);
    if (runtimeStatus) {
      const statusText = runtimeStatus.status.toUpperCase();
      const exitText =
        runtimeStatus.exitCode != null
          ? ` (exit ${runtimeStatus.exitCode})`
          : runtimeStatus.exitSignal
            ? ` (${runtimeStatus.exitSignal})`
            : "";
      return [
        fromServerOutputToCodebaseText(
          `[runtime] ${runtimeStatus.kind} session ${runtimeStatus.sessionId} ${statusText}${exitText}`
        ),
      ];
    }

    const prefix = block.title ? [block.title] : [];
    return [...prefix, JSON.stringify(block.data ?? {}, null, 2)].map((line) => fromServerOutputToCodebaseText(line));
  }

  if (block.kind === "open") {
    const lines = [block.title || "Open", block.label || block.url, block.url];
    return lines.map((line) => fromServerOutputToCodebaseText(line));
  }

  if (block.kind === "files") {
    const header = `${block.title || "Listing"} ${toCodebasePathFromCavcode(block.cwd)}`;
    const rows = (block.items || []).map((item) => {
      const kind = item.type === "folder" ? "dir " : "file";
      const size = item.type === "file" && Number.isFinite(Number(item.sizeBytes || 0)) ? `  ${item.sizeBytes}B` : "";
      return `${kind}  ${toCodebasePathFromCavcode(item.path)}${size}`;
    });
    return [header, ...rows];
  }

  if (block.kind === "diagnostics") {
    const summary = block.summary || {
      total: block.diagnostics.length,
      errors: 0,
      warnings: 0,
      infos: 0,
      filesScanned: 0,
      generatedAtISO: "",
      truncated: false,
    };
    const head = `${block.title || "Workspace Diagnostics"}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info`;
    const lines: string[] = [head];
    if (summary.filesScanned) lines.push(`Scanned ${summary.filesScanned} file(s).`);
    if (summary.generatedAtISO) lines.push(`Generated ${summary.generatedAtISO}`);
    const samples = (block.diagnostics || []).slice(0, 12).map((diag) => {
      const path = toCodebasePathFromCavcode(normalizePath(diag.file || ""));
      const code = String(diag.code || "").trim();
      const codeText = code ? ` ${code}` : "";
      return `${diag.severity.toUpperCase()} ${path}:${diag.line}:${diag.col}${codeText} ${diag.message}`;
    });
    lines.push(...samples);
    if ((block.diagnostics || []).length > 12) {
      lines.push(`... ${block.diagnostics.length - 12} more diagnostics`);
    }
    return lines.map((line) => fromServerOutputToCodebaseText(line));
  }

  const cols = block.columns || [];
  const rows = (block.rows || []).map((row) => cols.map((col) => String(row[col] ?? "")).join("\t"));
  return [...(block.title ? [block.title] : []), ...(cols.length ? [cols.join("\t")] : []), ...rows].map((line) =>
    fromServerOutputToCodebaseText(line)
  );
}

function codebaseToFolder(fsState: FsState): FolderNode {
  const rootPath = "/codebase";
  const root: FolderNode = {
    id: stableId("cbf", rootPath),
    kind: "folder",
    name: "cavcode",
    path: rootPath,
    children: [],
  };

  const folderMap = new Map<string, FolderNode>();
  folderMap.set(rootPath, root);

  const ensureFolder = (path: string) => {
    const normalized = normalizePath(path);
    if (folderMap.has(normalized)) return folderMap.get(normalized)!;
    const parentPath = normalizePath(normalized.split("/").slice(0, -1).join("/") || "/");
    const name = normalized.split("/").filter(Boolean).pop() || "folder";
    const parent = ensureFolder(parentPath);
    const folder: FolderNode = {
      id: stableId("cbf", normalized),
      kind: "folder",
      name,
      path: normalized,
      children: [],
    };
    parent.children.push(folder);
    folderMap.set(normalized, folder);
    return folder;
  };

  const nodes = Object.keys(fsState.nodes)
    .map((k) => fsState.nodes[k])
    .filter(Boolean)
    .filter((n) => n.path.startsWith("/codebase"));

  for (const n of nodes) {
    if (n.path === "/codebase") continue;
    if (n.type === "dir") {
      ensureFolder(n.path);
      continue;
    }
    const parentPath = normalizePath(n.path.split("/").slice(0, -1).join("/") || "/");
    const parent = ensureFolder(parentPath);
    const file: FileNode = {
      id: stableId("cbf", n.path),
      kind: "file",
      name: n.name,
      path: n.path,
      lang: inferLang(n.name),
      content: String(n.content ?? ""),
    };
    parent.children.push(file);
  }

  return root;
}

function upsertCodebaseFolderIntoWorkspace(root: FolderNode, fsState: FsState): FolderNode {
  const codebaseFolder = codebaseToFolder(fsState);
  const existing = findNodeByPath(root, "/codebase");
  if (existing && isFolder(existing)) {
    codebaseFolder.id = existing.id;
    return replaceNode(root, codebaseFolder);
  }
  const clone = safeClone(root);
  clone.children = [...clone.children, codebaseFolder];
  return clone;
}

function findNodeByPath(root: FolderNode, p: string): Node | null {
  const needle = normalizePath(p);
  let hit: Node | null = null;
  walk(root, (n) => {
    if (!hit && n.path === needle) hit = n;
  });
  return hit;
}

function ensureUniqueName(folder: FolderNode, wanted: string) {
  const base = wanted.trim() || "untitled";
  const exists = (name: string) => folder.children.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!exists(base)) return base;

  const ext = base.includes(".") ? `.${base.split(".").pop()}` : "";
  const stem = ext ? base.slice(0, -ext.length) : base;

  for (let i = 2; i < 999; i++) {
    const tryName = `${stem}-${i}${ext}`;
    if (!exists(tryName)) return tryName;
  }
  return `${stem}-${Date.now().toString(16)}${ext}`;
}

function splitRelPath(rel: string) {
  return String(rel || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
}

function isProbablyTextFile(name: string) {
  const lower = name.toLowerCase();
  // Treat common code + config + docs as text; images/binaries as non-text
  if (
    lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp") || lower.endsWith(".gif") ||
    lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".mp3") || lower.endsWith(".wav") ||
    lower.endsWith(".zip") || lower.endsWith(".rar") || lower.endsWith(".7z") || lower.endsWith(".pdf")
  ) return false;
  return true;
}

function isHtmlFilePath(p: string) {
  const lower = String(p || "").toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

function isTextContentType(contentType: string) {
  const ct = String(contentType || "").toLowerCase();
  if (!ct) return false;
  return (
    ct.startsWith("text/")
    || ct.includes("json")
    || ct.includes("xml")
    || ct.includes("yaml")
    || ct.includes("toml")
    || ct.includes("javascript")
    || ct.includes("typescript")
    || ct.includes("svg")
    || ct.includes("webmanifest")
  );
}

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  // If inside Monaco, never treat Delete as filesystem delete.
  if (el.closest?.(".monaco-editor")) return true;
  return false;
}

const FILE_ICON_BASE = "/icons/app/cavcode/code-pack/cavbot-default";
const FILE_ICON_ASSETS: Record<string, string> = {
  tsx: `${FILE_ICON_BASE}/logo-ts-svgrepo-com.svg`,
  ts: `${FILE_ICON_BASE}/logo-ts-svgrepo-com.svg`,
  jsx: `${FILE_ICON_BASE}/js-svgrepo-com.svg`,
  js: `${FILE_ICON_BASE}/js-svgrepo-com.svg`,
  json: `${FILE_ICON_BASE}/json-svgrepo-com.svg`,
  css: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  scss: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  less: `${FILE_ICON_BASE}/css-svgrepo-com.svg`,
  md: `${FILE_ICON_BASE}/info-circle-svgrepo-com.svg`,
  txt: `${FILE_ICON_BASE}/text-svgrepo-com.svg`,
  html: `${FILE_ICON_BASE}/html-5-svgrepo-com.svg`,
  yml: `${FILE_ICON_BASE}/xml-document-svgrepo-com.svg`,
  git: `${FILE_ICON_BASE}/git-svgrepo-com.svg`,
  toml: `${FILE_ICON_BASE}/toml-svgrepo-com.svg`,
  prisma: `${FILE_ICON_BASE}/light-prisma-svgrepo-com.svg`,
  env: `${FILE_ICON_BASE}/dollar-sign-symbol-bold-text-svgrepo-com.svg`,
  sh: `${FILE_ICON_BASE}/text-svgrepo-com.svg`,
  svg: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  xml: `${FILE_ICON_BASE}/xml-document-svgrepo-com.svg`,
  png: `${FILE_ICON_BASE}/png-svgrepo-com.svg`,
  jpg: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  ico: `${FILE_ICON_BASE}/ico-svgrepo-com.svg`,
  image: `${FILE_ICON_BASE}/image-document-svgrepo-com.svg`,
  video: `${FILE_ICON_BASE}/video-document-svgrepo-com.svg`,
  csv: `${FILE_ICON_BASE}/csv-document-svgrepo-com.svg`,
  excel: `${FILE_ICON_BASE}/excel-document-svgrepo-com.svg`,
  pdf: `${FILE_ICON_BASE}/pdf-svgrepo-com.svg`,
  zip: `${FILE_ICON_BASE}/zip-document-svgrepo-com.svg`,
  psd: `${FILE_ICON_BASE}/psd-document-svgrepo-com.svg`,
  eps: `${FILE_ICON_BASE}/eps-document-svgrepo-com.svg`,
  nodot: `${FILE_ICON_BASE}/align-left-svgrepo-com.svg`,
  file: `${FILE_ICON_BASE}/txt-document-svgrepo-com.svg`,
};

function iconKeyForName(name: string, lang?: Lang) {
  const lower = String(name || "").trim().toLowerCase();
  if (!lower) return "file";
  if (lang === "html") return "html";
  if (lower === ".gitignore" || lower.endsWith(".gitignore")) return "git";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) return "excel";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".zip") || lower.endsWith(".gz") || lower.endsWith(".tar") || lower.endsWith(".tgz") || lower.endsWith(".rar") || lower.endsWith(".7z")) return "zip";
  if (lower.endsWith(".psd")) return "psd";
  if (lower.endsWith(".eps")) return "eps";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "txt";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".scss")) return "scss";
  if (lower.endsWith(".less")) return "less";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".prisma")) return "prisma";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "md";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".webmanifest")) return "nodot";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yml";
  if (lower.endsWith(".env") || lower.startsWith(".env.")) return "env";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "sh";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".ico")) return "ico";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico"].some((ext) => lower.endsWith(ext))) return "image";
  if ([".mp4", ".webm", ".mov", ".m4v", ".ogv"].some((ext) => lower.endsWith(ext))) return "video";
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".xml")) return "xml";
  if (!lower.includes(".")) return "nodot";
  return "file";
}

function FileGlyph(props: { name: string; lang?: Lang }) {
  const kind = iconKeyForName(props.name, props.lang);
  const src = FILE_ICON_ASSETS[kind] ?? FILE_ICON_ASSETS.file;
  return (
    <span className={`cc-file-icon cc-file-icon-${kind}`} data-kind={kind} aria-hidden="true">
      <Image className="cc-file-icon-img" src={src} alt="" width={16} height={16} aria-hidden="true" unoptimized />
    </span>
  );
}

function IconFolder(props: { open?: boolean }) {
  const open = !!props.open;
  return (
    <Image
      className={`cc-folder-svg${open ? " is-open" : ""}`}
      src="/icons/app/cavcode/folder-2-svgrepo-com.svg"
      alt=""
      width={16}
      height={16}
      aria-hidden="true"
    />
  );
}

function IconNewFile() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/file-add-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconNewFolder() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/folder-add-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconUploadFiles() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/file-add-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconUploadFolder() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/folder-upload-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconRefresh() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/refresh-cw-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconCollapseAll() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/collapse-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconSearch() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/search-alt-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconExplorer() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/files-stack-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconGear() {
  return <IconGearGlyph className="cc-act-svg" size={18} />;
}

function IconGearGlyph({ className, size }: { className?: string; size?: number }) {
  const iconSize = Number.isFinite(size) ? Math.max(8, Math.round(size as number)) : 18;
  return (
    <svg
      className={className}
      width={iconSize}
      height={iconSize}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="m4.929 4.93.001-.002.002.001.527-.528a.575.575 0 0 1 .786-.025l1.21 1.061c.332.305.774.492 1.26.492.514 0 .98-.21 1.316-.548.318-.32.52-.754.539-1.235h.004l.105-1.607a.575.575 0 0 1 .574-.537h.746V2v.002h.747c.303 0 .554.235.574.537l.105 1.607h.005c.019.484.223.92.544 1.24.336.335.8.543 1.312.543.492 0 .94-.192 1.272-.504l1.196-1.05a.575.575 0 0 1 .786.026l.528.528.002-.002v.002l-.001.002.528.527a.575.575 0 0 1 .026.786l-1.06 1.212a1.85 1.85 0 0 0-.492 1.258c0 .515.21.98.548 1.317.32.318.753.52 1.235.539v.004l1.606.105c.303.02.538.271.538.574V12H22v.002h-.002v.746a.575.575 0 0 1-.537.574l-1.607.107v.001c-.484.02-.92.223-1.24.544-.335.336-.543.8-.543 1.312 0 .486.187.928.493 1.26h-.002l1.062 1.211c.2.228.188.572-.026.786l-.528.528v.002h-.001l-.528.527a.575.575 0 0 1-.785.026l-1.168-1.021a1.851 1.851 0 0 0-1.302-.534c-.515 0-.98.21-1.317.548-.318.32-.52.755-.54 1.238h-.004l-.105 1.607a.575.575 0 0 1-.54.536H11.22a.575.575 0 0 1-.54-.536l-.105-1.607h-.004a1.851 1.851 0 0 0-.545-1.244 1.851 1.851 0 0 0-1.31-.542c-.504 0-.96.2-1.295.526l-1.177 1.03a.575.575 0 0 1-.785-.027l-.528-.528-.001-.001-.528-.528a.575.575 0 0 1-.026-.786l1.062-1.21-.001-.001a1.85 1.85 0 0 0 .493-1.26c0-.515-.21-.98-.548-1.317a1.85 1.85 0 0 0-1.236-.539v-.001l-1.607-.107a.575.575 0 0 1-.537-.574v-.746H2V12h.001v-.747c0-.303.235-.554.538-.574l1.606-.105v-.004a1.851 1.851 0 0 0 1.242-.545c.335-.336.542-.8.542-1.31 0-.49-.19-.935-.499-1.267L4.376 6.244a.575.575 0 0 1 .026-.786l.528-.527-.001-.002zM16.286 12a4.286 4.286 0 1 1-8.572 0 4.286 4.286 0 0 1 8.572 0z"
        fill="#000000"
      />
    </svg>
  );
}

/** Live icon */
function IconLive() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/broadcast-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

/** Run & Debug */
function IconRunDebug() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/debug-alt-small-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconScm() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/git.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconChanges() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/git-compare-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconCloud() {
  return (
    <Image
      className="cc-act-svg"
      src="/icons/app/cavcode/cloud-storage-svgrepo-com.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconCloudLink() {
  return (
    <Image
      className="cc-act-svg cc-act-cavcloud-mark"
      src="/logo/cavbot-logomark.svg"
      alt=""
      width={18}
      height={18}
      aria-hidden="true"
    />
  );
}

function IconCavAi() {
  return <span className="cc-act-svg cc-act-ai-svg" aria-hidden="true" />;
}

function IconMenuDots() {
  return (
    <svg className="cc-menu-dots-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

/* =========================
  Seed workspace
  - ZERO pre-made files/folders.
========================= */
function seedFS(): FolderNode {
  return {
    id: "root",
    kind: "folder",
    name: "root",
    path: "/",
    children: [],
  };
}

const SELF_TEST_FOLDER_PATH = "/.cavcode-self-test";
const DIAGNOSTICS_SELF_TEST_FILES: Array<{ name: string; lang: Lang; content: string }> = [
  {
    name: "ts-error.ts",
    lang: "typescript",
    content: `const typedNumber: number = "untyped";`,
  },
  {
    name: "ts-quickfix.tsx",
    lang: "typescript",
    content: `import { useMemo } from "react";

export default function QuickFixExample() {
  return <div>CavAi Fixes</div>;
}`,
  },
  {
    name: "ts-alias.ts",
    lang: "typescript",
    content: `import { default as layout } from "@/app/layout";
console.log(layout);`,
  },
  {
    name: "valid.html",
    lang: "html",
    content: `<!DOCTYPE html>
<html lang="en">
  <body>
    <button type="button">Valid</button>
  </body>
</html>`,
  },
  {
    name: "invalid.html",
    lang: "html",
    content: `<div>
  <span>Missing closing tags`,
  },
];

function injectDiagnosticsSelfTestFiles(root: FolderNode): FolderNode {
  const clone = safeClone(root);
  let folder = findNodeByPath(clone, SELF_TEST_FOLDER_PATH);
  if (!folder) {
    folder = {
      id: uid("fld"),
      kind: "folder",
      name: ".cavcode-self-test",
      path: SELF_TEST_FOLDER_PATH,
      children: [],
    };
    clone.children = [...clone.children, folder];
  }
  if (!isFolder(folder)) return clone;

  folder.children = DIAGNOSTICS_SELF_TEST_FILES.map((fileDef) => {
    const filePath = joinPath(SELF_TEST_FOLDER_PATH, fileDef.name);
    const existing = findNodeByPath(clone, filePath);
    if (existing && isFile(existing)) {
      return {
        ...existing,
        lang: fileDef.lang,
        content: fileDef.content,
        name: fileDef.name,
        path: filePath,
      };
    }
    return {
      id: uid("file"),
      kind: "file",
      name: fileDef.name,
      lang: fileDef.lang,
      path: filePath,
      content: fileDef.content,
    };
  });

  return clone;
}

function cloneNodeWithNewIds(node: FolderNode | FileNode, parentPath: string): FolderNode | FileNode {
  if (node.kind === "file") {
    return {
      ...node,
      id: uid("file"),
      path: joinPath(parentPath, node.name),
    };
  }
  const nextPath = joinPath(parentPath, node.name);
  return {
    ...node,
    id: uid("fld"),
    path: nextPath,
    children: node.children.map((c) => cloneNodeWithNewIds(c, nextPath)) as Array<FolderNode | FileNode>,
  };
}

/* =========================
  Page
========================= */
export default function CavCodePage() {
  const router = useRouter();
  const [isDesktop, setIsDesktop] = useState(true);
  const [booting, setBooting] = useState(true);
  const [, setBootFailed] = useState(false);
  const bootTimerRef = useRef<number | null>(null);
  const didMountRef = useRef(false);

  // IDE UI state
  const [activity, setActivity] = useState<Activity>("explorer");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // FS + selection
  const [fsReady, setFsReady] = useState(false);
  const [fs, setFS] = useState<FolderNode>(() => seedFS());
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({ root: true });
  const [selectedId, setSelectedId] = useState<string>("root");
  const [folderToggleCueId, setFolderToggleCueId] = useState<string>("");
  const [activeFileId, setActiveFileId] = useState<string>("");
  const [splitLayout, setSplitLayout] = useState<SplitLayout>("single");
  const [secondaryFileId, setSecondaryFileId] = useState<string>("");
  const [activePane, setActivePane] = useState<EditorPane>("primary");
  const [activeProjectRootPath, setActiveProjectRootPath] = useState<string | null>(null);
  const [modifiedFileIds, setModifiedFileIds] = useState<Set<string>>(() => new Set());
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabDragId, setTabDragId] = useState<string | null>(null);
  const [tabDropHint, setTabDropHint] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [codebaseFs, setCodebaseFs] = useState<FsState>(() => createEmptyCodebaseFs());
  const [codebaseSyncStatus, setCodebaseSyncStatus] = useState<{ lastSyncTs?: number; storageActive?: boolean }>({
    lastSyncTs: undefined,
    storageActive: true,
  });
  const codebaseFsRef = useRef<FsState>(createEmptyCodebaseFs());
  const hydratedCodebasePathsRef = useRef<Set<string>>(new Set());
  const codebaseSyncBusyRef = useRef(false);
  const cavcloudSyncTimerRef = useRef<number | null>(null);
  const cavcloudSyncRevisionRef = useRef(0);
  const cavcloudSyncedSignatureRef = useRef<Map<string, string>>(new Map());
  const workspaceSnapshotLastHashRef = useRef<string>("");
  const workspaceSnapshotSaveTimerRef = useRef<number | null>(null);
  const savedFileHashByIdRef = useRef<Record<string, string>>({});

  const ensureSavedHashForFile = useCallback((file: FileNode): string => {
    const existing = savedFileHashByIdRef.current[file.id];
    if (typeof existing === "string" && existing.length > 0) return existing;
    const baseline = hashString(String(file.content ?? ""));
    savedFileHashByIdRef.current[file.id] = baseline;
    return baseline;
  }, []);

  const applyDirtyStateForFile = useCallback((fileId: string, baselineHash: string, content: string) => {
    const nextHash = hashString(String(content ?? ""));
    const shouldBeDirty = nextHash !== baselineHash;
    setModifiedFileIds((prev) => {
      const hasDirty = prev.has(fileId);
      if (hasDirty === shouldBeDirty) return prev;
      const next = new Set(prev);
      if (shouldBeDirty) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  }, []);

  const markFileSaved = useCallback((fileId: string, content: string) => {
    savedFileHashByIdRef.current[fileId] = hashString(String(content ?? ""));
    setModifiedFileIds((prev) => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
  }, []);

  // settings
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [skillsPageView, setSkillsPageView] = useState<SkillsPageView>("agents");
  const [cavenIdeSettings, setCavenIdeSettings] = useState<CavenIdeSettings>(DEFAULT_CAVEN_IDE_SETTINGS);
  const [accountPlanId, setAccountPlanId] = useState<"free" | "premium" | "premium_plus">("free");
  const [savingCavenIdeSettingsKey, setSavingCavenIdeSettingsKey] = useState<keyof CavenIdeSettings | "">("");
  const settingsBootstrappedRef = useRef(false);
  const settingsPersistTimerRef = useRef<number | null>(null);
  const settingsPersistedHashRef = useRef("");
  const [projectCollabBusy, setProjectCollabBusy] = useState<boolean>(false);
  const [projectCollabError, setProjectCollabError] = useState<string>("");
  const [projectCollabStatus, setProjectCollabStatus] = useState<string>("");
  const [projectCollaborators, setProjectCollaborators] = useState<ProjectCollaborator[]>([]);
  const [workspaceMemberOptions, setWorkspaceMemberOptions] = useState<WorkspaceMemberOption[]>([]);
  const [projectCollabUserId, setProjectCollabUserId] = useState<string>("");
  const [projectCollabRole, setProjectCollabRole] = useState<"VIEWER" | "EDITOR" | "ADMIN">("VIEWER");
  const [projectCollabSubmitting, setProjectCollabSubmitting] = useState<boolean>(false);

  // inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  // search surface
  const [searchQuery, setSearchQuery] = useState("");
  const [agentsSearchQuery, setAgentsSearchQuery] = useState("");
  const [customAgents, setCustomAgents] = useState<CustomCavenAgentRecord[]>([]);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [createAgentName, setCreateAgentName] = useState("");
  const [createAgentSummary, setCreateAgentSummary] = useState("");
  const [createAgentTriggers, setCreateAgentTriggers] = useState("");
  const [createAgentInstructions, setCreateAgentInstructions] = useState("");
  const [createAgentSurface, setCreateAgentSurface] = useState<"cavcode" | "center" | "all">("all");
  const [createAgentIconSvg, setCreateAgentIconSvg] = useState("");
  const [createAgentIconBackground, setCreateAgentIconBackground] = useState("");
  const [createAgentIconPalette, setCreateAgentIconPalette] = useState<string[]>([]);
  const [createAgentColorInput, setCreateAgentColorInput] = useState("");
  const [createAgentColorMenuOpen, setCreateAgentColorMenuOpen] = useState(false);
  const [createAgentError, setCreateAgentError] = useState("");
  const createAgentIconInputRef = useRef<HTMLInputElement | null>(null);
  const createAgentColorInputRef = useRef<HTMLInputElement | null>(null);
  const createAgentColorNativeInputRef = useRef<HTMLInputElement | null>(null);
  const createAgentColorMenuRef = useRef<HTMLDivElement | null>(null);
  const [createAgentAiBusy, setCreateAgentAiBusy] = useState(false);
  const [createAgentAiMenuOpen, setCreateAgentAiMenuOpen] = useState(false);
  const [createAgentAiPromptOpen, setCreateAgentAiPromptOpen] = useState(false);
  const [createAgentAiPromptText, setCreateAgentAiPromptText] = useState("");
  const [createAgentAiPromptHint, setCreateAgentAiPromptHint] = useState("");
  const [createAgentAiPromptHintCycle, setCreateAgentAiPromptHintCycle] = useState(0);
  const [createAgentAiWorkingMode, setCreateAgentAiWorkingMode] = useState<AgentBuilderAiMode | null>(null);
  const [createAgentAiControlMenu, setCreateAgentAiControlMenu] = useState<AgentBuilderControlMenu>(null);
  const [createAgentAiModelOptions, setCreateAgentAiModelOptions] = useState<AgentBuilderModelOption[]>(
    () => agentBuilderPlanModelOptions("free")
  );
  const [createAgentAiModelId, setCreateAgentAiModelId] = useState(DEEPSEEK_CHAT_MODEL_ID);
  const [createAgentAiReasoningOptions, setCreateAgentAiReasoningOptions] = useState<AgentBuilderReasoningLevel[]>(
    DEFAULT_AGENT_BUILDER_REASONING_LEVELS
  );
  const [createAgentAiReasoningLevel, setCreateAgentAiReasoningLevel] =
    useState<AgentBuilderReasoningLevel>("medium");
  const [createAgentAiSessionId, setCreateAgentAiSessionId] = useState("");
  const [createAgentAiModelsLoaded, setCreateAgentAiModelsLoaded] = useState(false);
  const createAgentAiControlsRef = useRef<HTMLDivElement | null>(null);
  const createAgentAiHelpPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const createAgentAiPromptHintRecentRef = useRef<string[]>([]);
  const [agentRegistrySnapshot, setAgentRegistrySnapshot] = useState<AgentRegistrySnapshot>({
    ...EMPTY_AGENT_REGISTRY_SNAPSHOT,
  });
  const agentRegistrySnapshotRef = useRef<AgentRegistrySnapshot>({
    ...EMPTY_AGENT_REGISTRY_SNAPSHOT,
  });
  const [installedAgentIds, setInstalledAgentIds] = useState<string[]>([...DEFAULT_INSTALLED_AGENT_IDS]);
  const installedAgentIdsRef = useRef<string[]>([...DEFAULT_INSTALLED_AGENT_IDS]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [savingAgentId, setSavingAgentId] = useState("");
  const [agentManageMenuId, setAgentManageMenuId] = useState("");

  // bottom panel
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [gitAdvancedOpen, setGitAdvancedOpen] = useState(true);
  const [terminalSplitView, setTerminalSplitView] = useState(false);
  const [panelViewMenuOpen, setPanelViewMenuOpen] = useState(false);
  const [scmHeaderMenuOpen, setScmHeaderMenuOpen] = useState(false);
  const [changesHeaderMenuOpen, setChangesHeaderMenuOpen] = useState(false);
  const [explorerHeaderMenuOpen, setExplorerHeaderMenuOpen] = useState(false);
  const [runHeaderMenuOpen, setRunHeaderMenuOpen] = useState(false);
  const panelViewMenuRef = useRef<HTMLDivElement | null>(null);
  const scmHeaderMenuRef = useRef<HTMLDivElement | null>(null);
  const changesHeaderMenuRef = useRef<HTMLDivElement | null>(null);
  const explorerHeaderMenuRef = useRef<HTMLDivElement | null>(null);
  const runHeaderMenuRef = useRef<HTMLDivElement | null>(null);
  const [runDebugExpanded, setRunDebugExpanded] = useState(false);

  // problems
  const [editorProblems, setEditorProblems] = useState<Problem[]>([]);
  const [workspaceProblems, setWorkspaceProblems] = useState<Problem[]>([]);
  const problems = useMemo(
    () => dedupeProblems([...workspaceProblems, ...editorProblems]),
    [editorProblems, workspaceProblems]
  );
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });

  // Auth context (for System virtual files)
  const [me, setMe] = useState<{ userId: string; username: string; displayName: string } | null>(null);

  // terminal (command bus day-1)
  const [termLines, setTermLines] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [operatorName, setOperatorName] = useState<string>("Operator");
  const [profileFullName, setProfileFullName] = useState<string>("");
  const [profileUsername, setProfileUsername] = useState<string>("");
  const [termLastLoginTs, setTermLastLoginTs] = useState<number>(() => Date.now());
  const [termTtyLabel, setTermTtyLabel] = useState<string>("ttys000");
  const [termBootMetaReady, setTermBootMetaReady] = useState(false);
  const termBootedRef = useRef(false);
  const terminalMetaBootedRef = useRef(false);
  const termOutRef = useRef<HTMLDivElement | null>(null);
  const termHistoryRef = useRef<string[]>([]);
  const termHistIndexRef = useRef<number>(-1);
  const [runtimeSessionId, setRuntimeSessionId] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeSessionStatus | null>(null);
  const [runtimeKind, setRuntimeKind] = useState<RuntimeRunKind | null>(null);
  const [runtimeExitCode, setRuntimeExitCode] = useState<number | null>(null);
  const [runtimeExitSignal, setRuntimeExitSignal] = useState<string | null>(null);
  const [runtimeActionBusy, setRuntimeActionBusy] = useState("");
  const runtimeSessionIdRef = useRef("");
  const runtimeStatusRef = useRef<RuntimeSessionStatus | null>(null);
  const runtimeLogSeqRef = useRef(0);
  const runtimePollBusyRef = useRef(false);
  const runtimeEventSourceRef = useRef<EventSource | null>(null);
  const [runtimeStreamFallbackMode, setRuntimeStreamFallbackMode] = useState(false);
  const [debugSessionId, setDebugSessionId] = useState("");
  const [debugStatus, setDebugStatus] = useState<DebugSessionStatus | null>(null);
  const [debugEntryPath, setDebugEntryPath] = useState("");
  const [debugExitCode, setDebugExitCode] = useState<number | null>(null);
  const [debugExitSignal, setDebugExitSignal] = useState<string | null>(null);
  const [debugCurrentLocation, setDebugCurrentLocation] = useState<DebugLocation>({ file: null, line: null, column: null });
  const [debugBreakpoints, setDebugBreakpoints] = useState<DebugBreakpoint[]>([]);
  const [debugFunctionBreakpoints, setDebugFunctionBreakpoints] = useState<DebugBreakpoint[]>([]);
  const [debugDataBreakpoints, setDebugDataBreakpoints] = useState<DebugDataBreakpoint[]>([]);
  const [debugThreads, setDebugThreads] = useState<DebugThread[]>([]);
  const [debugSelectedThreadId, setDebugSelectedThreadId] = useState<number | null>(null);
  const [debugSelectedFrameOrdinal, setDebugSelectedFrameOrdinal] = useState<number | null>(null);
  const [debugStack, setDebugStack] = useState<DebugStackFrame[]>([]);
  const [debugScopes, setDebugScopes] = useState<DebugScope[]>([]);
  const [debugWatches, setDebugWatches] = useState<DebugWatch[]>([]);
  const [debugConsoleEntries, setDebugConsoleEntries] = useState<DebugConsoleEntry[]>([]);
  const [debugExceptionFilters, setDebugExceptionFilters] = useState<DebugExceptionFilters>({ all: false, uncaught: false });
  const [debugAdapterLabel, setDebugAdapterLabel] = useState("");
  const [debugAdapterType, setDebugAdapterType] = useState("");
  const [debugLaunchTargetName, setDebugLaunchTargetName] = useState("");
  const [debugLaunchCompoundName, setDebugLaunchCompoundName] = useState("");
  const [debugLaunchProfileId, setDebugLaunchProfileId] = useState("");
  const [debugWorkspaceVariantId, setDebugWorkspaceVariantId] = useState("");
  const [debugLaunchRequest, setDebugLaunchRequest] = useState<"launch" | "attach" | null>(null);
  const [debugPostTaskLabel, setDebugPostTaskLabel] = useState("");
  const [debugPostTaskRan, setDebugPostTaskRan] = useState(false);
  const [debugCapabilities, setDebugCapabilities] = useState<DebugAdapterCapabilities | null>(null);
  const [debugWatchInput, setDebugWatchInput] = useState("");
  const [debugEvalInput, setDebugEvalInput] = useState("");
  const [debugEvalOutput, setDebugEvalOutput] = useState<DebugEvalPayload | null>(null);
  const [debugVarsCursor, setDebugVarsCursor] = useState<{ variablesReference: number; start: number; count: number }>({
    variablesReference: 0,
    start: 0,
    count: 0,
  });
  const [debugVariables, setDebugVariables] = useState<DebugVariable[]>([]);
  const [debugLoadedScripts, setDebugLoadedScripts] = useState<DebugLoadedScript[]>([]);
  const [debugLoadedModules, setDebugLoadedModules] = useState<DebugLoadedModule[]>([]);
  const [debugSessionsList, setDebugSessionsList] = useState<DebugStatusPayload[]>([]);
  const [debugActiveSessionId, setDebugActiveSessionId] = useState("");
  const [debugLaunchManifest, setDebugLaunchManifest] = useState<DebugLaunchManifestPayload | null>(null);
  const [debugLaunchSelector, setDebugLaunchSelector] = useState("");
  const [debugLaunchSelectorType, setDebugLaunchSelectorType] = useState<"target" | "compound">("target");
  const [debugLaunchProfileOverride, setDebugLaunchProfileOverride] = useState("");
  const [debugLaunchVariantOverride, setDebugLaunchVariantOverride] = useState("");
  const [debugActionBusy, setDebugActionBusy] = useState("");
  const debugSessionIdRef = useRef("");
  const debugStatusRef = useRef<DebugSessionStatus | null>(null);
  const debugLogSeqRef = useRef(0);
  const debugPollBusyRef = useRef(false);
  const debugEventSourceRef = useRef<EventSource | null>(null);
  const [debugStreamFallbackMode, setDebugStreamFallbackMode] = useState(false);
  const debugBreakpointsRef = useRef<DebugBreakpoint[]>([]);
  const debugDecorationsRef = useRef<Record<EditorPane, string[]>>({
    primary: [],
    secondary: [],
  });
  const cavcodeEventSourceRef = useRef<EventSource | null>(null);
  const cavcodeEventSeqRef = useRef(0);
  const [scmStatusPayload, setScmStatusPayload] = useState<GitStatusPayload | null>(null);
  const [scmAuthRequired, setScmAuthRequired] = useState<GitAuthRequiredPayload | null>(null);
  const [scmActionBusy, setScmActionBusy] = useState("");
  const [scmCommitMessage, setScmCommitMessage] = useState("");
  const [scmPartialPath, setScmPartialPath] = useState("");
  const [scmPartialStartLine, setScmPartialStartLine] = useState("1");
  const [scmPartialEndLine, setScmPartialEndLine] = useState("1");
  const [scmBranchNameInput, setScmBranchNameInput] = useState("");
  const [scmRemoteNameInput, setScmRemoteNameInput] = useState("origin");
  const [scmRemoteUrlInput, setScmRemoteUrlInput] = useState("");
  const [scmRemoteBranchInput, setScmRemoteBranchInput] = useState("main");
  const [scmConflictPathInput, setScmConflictPathInput] = useState("");
  const [changesActionBusy, setChangesActionBusy] = useState("");
  const [changesCommitMessage, setChangesCommitMessage] = useState("");
  const [changesCommitMenuOpen, setChangesCommitMenuOpen] = useState(false);
  const [changesCommitAiBusy, setChangesCommitAiBusy] = useState(false);
  const [changesCommitAiMenuOpen, setChangesCommitAiMenuOpen] = useState(false);
  const [changesCommitAiPromptOpen, setChangesCommitAiPromptOpen] = useState(false);
  const [changesCommitAiPromptText, setChangesCommitAiPromptText] = useState("");
  const [changesCommitAiPromptHint, setChangesCommitAiPromptHint] = useState("");
  const [changesCommitAiPromptHintCycle, setChangesCommitAiPromptHintCycle] = useState(0);
  const [changesCommitAiWorkingMode, setChangesCommitAiWorkingMode] = useState<CommitMessageAiMode | null>(null);
  const [changesCommitAiModelOptions, setChangesCommitAiModelOptions] = useState<AgentBuilderModelOption[]>(
    () => agentBuilderPlanModelOptions("free")
  );
  const [changesCommitAiModelId, setChangesCommitAiModelId] = useState(DEEPSEEK_CHAT_MODEL_ID);
  const [changesCommitAiReasoningOptions, setChangesCommitAiReasoningOptions] = useState<AgentBuilderReasoningLevel[]>(
    DEFAULT_AGENT_BUILDER_REASONING_LEVELS
  );
  const [changesCommitAiReasoningLevel, setChangesCommitAiReasoningLevel] =
    useState<AgentBuilderReasoningLevel>("medium");
  const [changesCommitAiSessionId, setChangesCommitAiSessionId] = useState("");
  const [changesCommitAiModelsLoaded, setChangesCommitAiModelsLoaded] = useState(false);
  const changesCommitMenuRef = useRef<HTMLDivElement | null>(null);
  const changesCommitAiControlsRef = useRef<HTMLDivElement | null>(null);
  const changesCommitAiHelpPromptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const changesCommitAiPromptHintRecentRef = useRef<string[]>([]);
  const [changesCompareByKey, setChangesCompareByKey] = useState<Record<string, GitComparePayload>>({});
  const [changesCompareBusyKey, setChangesCompareBusyKey] = useState("");
  const [changesAggregateSelectionKey, setChangesAggregateSelectionKey] = useState("");
  const fileSyncMetaRef = useRef<Record<string, { sha256: string | null; versionNumber: number | null }>>({});
  const PROMPT_PREFIX = useMemo(() => {
    const rawUser = String(profileUsername || me?.username || "").trim().toLowerCase();
    const user = rawUser.replace(/\s+/g, "");
    return `${user || "operator"}@cavbot:~$`;
  }, [me?.username, profileUsername]);
  const terminalBootLines = useMemo(
    () => [`Last login: ${formatMacTerminalDate(termLastLoginTs)} on ${termTtyLabel}`, PROMPT_PREFIX, ""],
    [PROMPT_PREFIX, termLastLoginTs, termTtyLabel]
  );

  // profile avatar + menu
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [avatarInitials, setAvatarInitials] = useState<string>("");
  const [profileTone, setProfileTone] = useState<string>("lime");
  const [profilePublicEnabled, setProfilePublicEnabled] = useState<boolean | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileBtnRef = useRef<HTMLButtonElement | null>(null);

  const [sysProfileReadme, setSysProfileReadme] = useState<{ markdown: string; loaded: boolean; revision: number }>({
    markdown: defaultProfileReadmeMarkdown("Operator"),
    loaded: true,
    revision: 0,
  });
  const sysOpenRef = useRef(false);
  const cloudOpenRef = useRef("");
  const sysAutosaveRef = useRef<{ timer: number | null; lastSavedHash: string; lastSavedRevision: number }>({
    timer: null,
    lastSavedHash: "",
    lastSavedRevision: 0,
  });

  // Monaco refs
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const editorRefs = useRef<Record<EditorPane, MonacoType.editor.IStandaloneCodeEditor | null>>({
    primary: null,
    secondary: null,
  });
  const paneDisposablesRef = useRef<Record<EditorPane, MonacoType.IDisposable[]>>({
    primary: [],
    secondary: [],
  });
  const monacoRef = useRef<MonacoApi | null>(null);
  const markersDispRef = useRef<MonacoType.IDisposable | null>(null);
  const cursorDispRef = useRef<MonacoType.IDisposable | null>(null);
  const activePaneRef = useRef<EditorPane>("primary");

  // Upload inputs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Folder upload input
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // CavCloud connect
  const [cloudConnectOpen, setCloudConnectOpen] = useState(false);
  const [cloudFolders, setCloudFolders] = useState<FolderNode[]>([]);
  const [cloudSelectedPath, setCloudSelectedPath] = useState<string>("/");
  const [cloudFoldersLoading, setCloudFoldersLoading] = useState(false);
  const cloudFoldersLoadPromiseRef = useRef<Promise<void> | null>(null);
  const cloudFoldersLoadedRef = useRef(false);

  // Drag/drop import overlay (kept for mechanics; NO “upload screen” rendered)
  const [dragArmed, setDragArmed] = useState(false);
  const dragDepth = useRef(0);

  // VS Code-style context menu (ctrl+right click)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const isClient = typeof window !== "undefined";
  const projectIdFromQuery = useMemo(() => {
    if (!isClient) return null;
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = String(sp.get("project") || sp.get("projectId") || "").trim();
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      if (!shouldOpenCavAiSurface(sp)) return;
      setSidebarOpen(true);
      setActivity("ai");
    } catch {}
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;

    const selectors = [
      ".cc-act[title]",
      ".cc-side-icbtn[title]",
      ".cc-tabtool[title]",
      ".cc-panel-tool[title]",
      ".cc-panel-close[title]",
      ".cc-sbtn[title]",
      ".monaco-editor .find-widget .button[title]",
      ".monaco-editor .find-widget .monaco-button[title]",
      ".monaco-editor .find-widget .codicon[title]",
      ".monaco-editor .find-widget .action-label[title]",
    ].join(",");

    const syncTips = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(selectors));
      for (const node of nodes) {
        const label = String(node.getAttribute("title") || "").trim();
        if (!label) continue;
        if (!String(node.getAttribute("aria-label") || "").trim()) {
          node.setAttribute("aria-label", label);
        }
        node.setAttribute("data-cc-tip", label);
        node.removeAttribute("title");
      }
    };

    syncTips();
    const observer = new MutationObserver(() => syncTips());
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    return () => observer.disconnect();
  }, [isClient]);

  useEffect(() => {
    activePaneRef.current = activePane;
  }, [activePane]);

  useEffect(() => {
    agentRegistrySnapshotRef.current = agentRegistrySnapshot;
  }, [agentRegistrySnapshot]);

  useEffect(() => {
    installedAgentIdsRef.current = installedAgentIds;
  }, [installedAgentIds]);

  useEffect(() => {
    debugBreakpointsRef.current = debugBreakpoints;
  }, [debugBreakpoints]);

  /* =========================
    Toast (tight)
  ========================= */
  const [toast, setToast] = useState<{ msg: string; tone: "good" | "watch" | "bad" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pushToast = useCallback((msg: string, tone: "good" | "watch" | "bad" = "good") => {
    setToast({ msg, tone });
    const timerOwner = typeof window === "undefined" ? globalThis : window;
    if (toastTimer.current) timerOwner.clearTimeout(toastTimer.current);
    toastTimer.current = timerOwner.setTimeout(() => setToast(null), 2600);
  }, []);

  const persistWorkspaceSnapshotToServer = useCallback(
    async (snapshot: CavCodeWorkspaceSnapshot): Promise<boolean> => {
      try {
        const endpoint = cavcodeWorkspaceStateEndpoint(projectIdFromQuery);
        const res = await fetch(endpoint, {
          method: "PUT",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ snapshot }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [projectIdFromQuery]
  );

  const fetchWorkspaceSnapshotFromServer = useCallback(async (): Promise<CavCodeWorkspaceSnapshot | null> => {
    try {
      const endpoint = cavcodeWorkspaceStateEndpoint(projectIdFromQuery);
      const res = await fetch(endpoint, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { ok?: boolean; snapshot?: unknown } | null;
      if (!json || json.ok !== true || !json.snapshot) return null;
      return parseWorkspaceSnapshot(json.snapshot);
    } catch {
      return null;
    }
  }, [projectIdFromQuery]);

  const callCavtoolsExec = useCallback(async (command: string, cwd = "/cavcode"): Promise<CavtoolsExecResult | null> => {
    try {
      const { projectId, siteOrigin } = readCavtoolsQueryContext();
      const res = await fetch("/api/cavtools/exec", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cwd,
          command,
          projectId,
          siteOrigin,
        }),
      });
      const json = (await res.json().catch(() => null)) as CavtoolsExecResult | null;
      return json;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (termBootMetaReady) return;
    const timer = window.setTimeout(() => {
      if (terminalMetaBootedRef.current) return;
      const now = Date.now();
      const ttySeq = now % 1000;
      terminalMetaBootedRef.current = true;
      setTermLastLoginTs(now);
      setTermTtyLabel(terminalTtyLabelFromSeq(ttySeq));
      setTermBootMetaReady(true);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [termBootMetaReady]);

  useEffect(() => {
    if (!termBootMetaReady) return;
    if (termBootedRef.current) return;
    termBootedRef.current = true;
    setTermLines(terminalBootLines);
  }, [termBootMetaReady, terminalBootLines]);

  const fetchCodebaseFsFromServer = useCallback(
    async (prevState: FsState): Promise<FsState> => {
      const nowTs = Date.now();
      const nodes: Record<string, FsNode> = {
        "/": {
          type: "dir",
          name: "/",
          path: "/",
          createdAt: nowTs,
          updatedAt: nowTs,
        },
        "/codebase": {
          type: "dir",
          name: "cavcode",
          path: "/codebase",
          createdAt: nowTs,
          updatedAt: nowTs,
        },
      };

      const prevContent = new Map<string, string>();
      for (const key of Object.keys(prevState.nodes || {})) {
        const node = prevState.nodes[key];
        if (!node || node.type !== "file") continue;
        prevContent.set(node.path, String(node.content ?? ""));
      }

      const queue: string[] = ["/cavcode"];
      const visited = new Set<string>();
      let scanned = 0;
      let cwd = "/codebase";

      while (queue.length && scanned < 1200) {
        const cavPath = queue.shift() || "/cavcode";
        const normalizedCavPath = normalizePath(cavPath);
        if (visited.has(normalizedCavPath)) continue;
        visited.add(normalizedCavPath);
        scanned += 1;

        const result = await callCavtoolsExec(`ls ${normalizedCavPath}`, normalizedCavPath);
        if (!result) continue;

        const filesBlock = (result.blocks || []).find(
          (block): block is Extract<CavtoolsExecBlock, { kind: "files" }> => block.kind === "files"
        );
        if (!filesBlock) continue;

        cwd = toCodebasePathFromCavcode(filesBlock.cwd || "/cavcode");
        const dirPath = toCodebasePathFromCavcode(filesBlock.cwd || "/cavcode");
        if (!nodes[dirPath]) {
          const folderTs = Date.now();
          nodes[dirPath] = {
            type: "dir",
            name: dirPath.split("/").filter(Boolean).pop() || "cavcode",
            path: dirPath,
            createdAt: folderTs,
            updatedAt: folderTs,
          };
        }

        for (const item of filesBlock.items || []) {
          const itemPath = toCodebasePathFromCavcode(item.path);
          const itemTsRaw = item.updatedAtISO ? Date.parse(item.updatedAtISO) : Date.now();
          const itemTs = Number.isFinite(itemTsRaw) ? itemTsRaw : Date.now();

          if (item.type === "folder") {
            if (!nodes[itemPath]) {
              nodes[itemPath] = {
                type: "dir",
                name: item.name || itemPath.split("/").filter(Boolean).pop() || "folder",
                path: itemPath,
                createdAt: itemTs,
                updatedAt: itemTs,
              };
            } else {
              nodes[itemPath] = {
                ...nodes[itemPath],
                updatedAt: itemTs,
              };
            }

            const cavChildPath = normalizePath(item.path);
            if (!visited.has(cavChildPath)) queue.push(cavChildPath);
            continue;
          }

          nodes[itemPath] = {
            type: "file",
            name: item.name || itemPath.split("/").filter(Boolean).pop() || "file",
            path: itemPath,
            createdAt: itemTs,
            updatedAt: itemTs,
            content: prevContent.get(itemPath) ?? "",
          };
        }
      }

      if (!nodes[cwd] || nodes[cwd].type !== "dir") cwd = "/codebase";
      return { cwd, nodes };
    },
    [callCavtoolsExec]
  );

  const syncCodebaseFsFromServer = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (codebaseSyncBusyRef.current) return;
      codebaseSyncBusyRef.current = true;
      try {
        const next = await fetchCodebaseFsFromServer(codebaseFsRef.current);
        codebaseFsRef.current = next;
        setCodebaseFs(next);
        setCodebaseSyncStatus({ lastSyncTs: Date.now(), storageActive: true });
        if (!opts?.silent) pushToast("Codebase synced from server.", "good");
      } catch {
        setCodebaseSyncStatus({ lastSyncTs: Date.now(), storageActive: false });
        if (!opts?.silent) pushToast("Codebase sync failed.", "bad");
      } finally {
        codebaseSyncBusyRef.current = false;
      }
    },
    [fetchCodebaseFsFromServer, pushToast]
  );

  const hydrateCodebaseFileFromServer = useCallback(async (codebasePath: string, force = false): Promise<void> => {
    const normalized = normalizePath(codebasePath);
    if (!normalized.startsWith("/codebase/")) return;
    if (!force && hydratedCodebasePathsRef.current.has(normalized)) return;

    const { projectId, siteOrigin } = readCavtoolsQueryContext();
    const cavPath = toCavcodePathFromCodebase(normalized);
    const qs = new URLSearchParams();
    qs.set("path", cavPath);
    if (projectId) qs.set("projectId", String(projectId));
    if (siteOrigin) qs.set("siteOrigin", siteOrigin);

    try {
      const res = await fetch(`/api/cavtools/file?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as CavtoolsFileReadResult | null;
      if (!json || json.ok !== true) return;

      hydratedCodebasePathsRef.current.add(normalized);
      const nextContent = String(json.content ?? "");
      const nextSha = typeof json.sha256 === "string" ? String(json.sha256 || "").trim().toLowerCase() : "";
      const nextVersionRaw = Number(json.versionNumber);
      const nextVersionNumber =
        Number.isFinite(nextVersionRaw) && Number.isInteger(nextVersionRaw) && nextVersionRaw > 0
          ? Math.trunc(nextVersionRaw)
          : null;
      fileSyncMetaRef.current[normalized] = {
        sha256: nextSha || null,
        versionNumber: nextVersionNumber,
      };

      setCodebaseFs((prev) => {
        const existing = prev.nodes[normalized];
        if (!existing || existing.type !== "file") return prev;
        if (String(existing.content ?? "") === nextContent) return prev;
        const copy = { ...prev.nodes };
        copy[normalized] = {
          ...existing,
          content: nextContent,
          updatedAt: Date.now(),
        };
        return { ...prev, nodes: copy };
      });

      let hydratedFileId = "";
      setFS((prev) => {
        const hit = findNodeByPath(prev, normalized);
        if (!hit || !isFile(hit)) return prev;
        hydratedFileId = hit.id;
        if (String(hit.content ?? "") === nextContent) return prev;
        return replaceNode(prev, { ...hit, content: nextContent });
      });
      if (hydratedFileId) {
        markFileSaved(hydratedFileId, nextContent);
      }
    } catch {
      // noop
    }
  }, [markFileSaved]);

  const saveCodebaseFileToServer = useCallback(async (codebasePath: string, content: string): Promise<boolean> => {
    const normalized = normalizePath(codebasePath);
    if (!normalized.startsWith("/codebase/")) return true;
    const cavPath = toCavcodePathFromCodebase(normalized);
    const { projectId, siteOrigin } = readCavtoolsQueryContext();
    const priorMeta = fileSyncMetaRef.current[normalized] || { sha256: null, versionNumber: null as number | null };
    try {
      const res = await fetch("/api/cavtools/file", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: cavPath,
          content,
          mimeType: inferSyncMimeType(normalized.split("/").filter(Boolean).pop() || "file.txt"),
          baseSha256: priorMeta.sha256,
          projectId,
          siteOrigin,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | null
        | {
            ok?: boolean;
            sha256?: string | null;
            versionNumber?: number | null;
            error?: {
              code?: string;
              message?: string;
              latest?: {
                sha256?: string | null;
                versionNumber?: number | null;
              };
            };
          };
      if (res.ok && json?.ok === true) {
        const nextSha = String(json.sha256 || "").trim().toLowerCase();
        const nextVersionRaw = Number(json.versionNumber);
        const nextVersion =
          Number.isFinite(nextVersionRaw) && Number.isInteger(nextVersionRaw) && nextVersionRaw > 0
            ? Math.trunc(nextVersionRaw)
            : priorMeta.versionNumber;
        fileSyncMetaRef.current[normalized] = {
          sha256: nextSha || priorMeta.sha256 || null,
          versionNumber: nextVersion ?? null,
        };
        return true;
      }

      const conflictCode = String(json?.error?.code || "").trim().toUpperCase();
      if (res.status === 409 && conflictCode === "FILE_EDIT_CONFLICT") {
        const latestSha = String(json?.error?.latest?.sha256 || "").trim().toLowerCase() || null;
        const latestVersionRaw = Number(json?.error?.latest?.versionNumber);
        const latestVersion =
          Number.isFinite(latestVersionRaw) && Number.isInteger(latestVersionRaw) && latestVersionRaw > 0
            ? Math.trunc(latestVersionRaw)
            : null;
        fileSyncMetaRef.current[normalized] = {
          sha256: latestSha,
          versionNumber: latestVersion,
        };
        pushToast("File changed in another session. Sync and save again.", "watch");
      }
      return false;
    } catch {
      return false;
    }
  }, [pushToast]);

  const loadProjectCollaborators = useCallback(async () => {
    if (!projectIdFromQuery) {
      setProjectCollaborators([]);
      setWorkspaceMemberOptions([]);
      setProjectCollabUserId("");
      return;
    }

    setProjectCollabBusy(true);
    setProjectCollabError("");
    try {
      const [membersRes, collabRes] = await Promise.all([
        fetch("/api/members", {
          cache: "no-store",
          credentials: "include",
        }),
        fetch(`/api/cavcode/projects/${encodeURIComponent(String(projectIdFromQuery))}/collaborators`, {
          cache: "no-store",
          credentials: "include",
        }),
      ]);

      const membersJson = (await membersRes.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        members?: Array<{
          user?: {
            id?: string;
            email?: string;
            displayName?: string | null;
          };
        }>;
      } | null;

      const collabJson = (await collabRes.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        collaborators?: Array<{
          userId?: string;
          email?: string;
          displayName?: string | null;
          role?: string;
        }>;
      } | null;

      if (!membersRes.ok || !membersJson?.ok) {
        throw new Error(String(membersJson?.message || "Failed to load workspace members."));
      }
      if (!collabRes.ok || !collabJson?.ok) {
        throw new Error(String(collabJson?.message || "Failed to load project collaborators."));
      }

      const memberRows: WorkspaceMemberOption[] = Array.isArray(membersJson.members)
        ? membersJson.members
            .map((entry) => {
              const userId = String(entry?.user?.id || "").trim();
              const email = String(entry?.user?.email || "").trim();
              if (!userId || !email) return null;
              return {
                userId,
                email,
                displayName: entry?.user?.displayName ? String(entry.user.displayName) : null,
              };
            })
            .filter((entry): entry is WorkspaceMemberOption => Boolean(entry))
        : [];

      const collabRows: ProjectCollaborator[] = Array.isArray(collabJson.collaborators)
        ? collabJson.collaborators
            .map((entry) => {
              const userId = String(entry?.userId || "").trim();
              const email = String(entry?.email || "").trim();
              const roleRaw = String(entry?.role || "").trim().toUpperCase();
              const role = roleRaw === "EDITOR" || roleRaw === "ADMIN" ? roleRaw : "VIEWER";
              if (!userId || !email) return null;
              return {
                userId,
                email,
                displayName: entry?.displayName ? String(entry.displayName) : null,
                role: role as ProjectCollaborator["role"],
              };
            })
            .filter((entry): entry is ProjectCollaborator => Boolean(entry))
        : [];

      setWorkspaceMemberOptions(memberRows);
      setProjectCollaborators(collabRows);
      if (!projectCollabUserId && memberRows.length) {
        setProjectCollabUserId(memberRows[0].userId);
      }
    } catch (err) {
      setProjectCollabError(err instanceof Error ? err.message : "Failed to load project collaborators.");
    } finally {
      setProjectCollabBusy(false);
    }
  }, [projectCollabUserId, projectIdFromQuery]);

  const addProjectCollaborator = useCallback(async () => {
    if (!projectIdFromQuery) {
      setProjectCollabError("Project context is required.");
      return;
    }
    if (!projectCollabUserId) {
      setProjectCollabError("Select a workspace member.");
      return;
    }

    setProjectCollabSubmitting(true);
    setProjectCollabError("");
    setProjectCollabStatus("");
    try {
      const res = await fetch(`/api/cavcode/projects/${encodeURIComponent(String(projectIdFromQuery))}/collaborators`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: projectCollabUserId,
          role: projectCollabRole,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to save project collaborator."));
      }

      await loadProjectCollaborators();
      setProjectCollabStatus("Collaborator updated.");
      pushToast("Project collaborator updated.", "good");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save project collaborator.";
      setProjectCollabError(message);
      pushToast(message, "bad");
    } finally {
      setProjectCollabSubmitting(false);
    }
  }, [loadProjectCollaborators, projectCollabRole, projectCollabUserId, projectIdFromQuery, pushToast]);

  const revokeProjectCollaborator = useCallback(async (userId: string) => {
    if (!projectIdFromQuery || !userId) return;

    setProjectCollabSubmitting(true);
    setProjectCollabError("");
    setProjectCollabStatus("");
    try {
      const res = await fetch(
        `/api/cavcode/projects/${encodeURIComponent(String(projectIdFromQuery))}/collaborators/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to revoke project collaborator."));
      }

      await loadProjectCollaborators();
      setProjectCollabStatus("Collaborator revoked.");
      pushToast("Project collaborator revoked.", "good");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to revoke project collaborator.";
      setProjectCollabError(message);
      pushToast(message, "bad");
    } finally {
      setProjectCollabSubmitting(false);
    }
  }, [loadProjectCollaborators, projectIdFromQuery, pushToast]);

  useEffect(() => {
    if (activity !== "settings") return;
    void loadProjectCollaborators();
  }, [activity, loadProjectCollaborators]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeFileId) || null, [activeFileId, tabs]);
  const primaryTab = activeTab;
  const secondaryTab = useMemo(() => tabs.find((tab) => tab.id === secondaryFileId) || null, [secondaryFileId, tabs]);
  const primaryFile = useMemo(() => (activeFileId ? findFileById(fs, activeFileId) : null), [fs, activeFileId]);
  const secondaryFile = useMemo(() => (secondaryFileId ? findFileById(fs, secondaryFileId) : null), [fs, secondaryFileId]);
  const primaryAggregateMode = useMemo(
    () => (primaryTab ? readChangesAggregateTabId(primaryTab.id) : null),
    [primaryTab]
  );
  const secondaryAggregateMode = useMemo(
    () => (secondaryTab ? readChangesAggregateTabId(secondaryTab.id) : null),
    [secondaryTab]
  );
  const activeFile = useMemo(
    () => (activePane === "secondary" ? secondaryFile || primaryFile : primaryFile || secondaryFile),
    [activePane, primaryFile, secondaryFile]
  );
  const activeSkillsTab = useMemo(
    () => Boolean(activeTab && (activeTab.kind === "skills" || activeTab.id === CAVCODE_SKILLS_TAB_ID)),
    [activeTab]
  );
  const tabsBarActiveId = splitLayout !== "single" && activePane === "secondary" ? secondaryFileId || activeFileId : activeFileId;
  useEffect(() => {
    if (!activeSkillsTab || !activeTab) return;
    const nextView = skillsPageViewFromTabLike(activeTab);
    if (nextView === skillsPageView) return;
    setSkillsPageView(nextView);
  }, [activeSkillsTab, activeTab, skillsPageView]);
  const customAgentIdSet = useMemo(() => new Set(customAgents.map((agent) => agent.id)), [customAgents]);
  const installedAgentSet = useMemo(() => new Set(installedAgentIds), [installedAgentIds]);
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
  const builtInRegistryById = useMemo(() => {
    const map = new Map<string, BuiltInRegistryCard>();
    for (const card of builtInRegistryCards) {
      map.set(card.id, card);
    }
    return map;
  }, [builtInRegistryCards]);
  const customAgentCards = useMemo(() => customAgents.map((agent) => customAgentToCard(agent)), [customAgents]);
  const normalizedAgentSearchQuery = useMemo(
    () => agentsSearchQuery.trim().toLowerCase(),
    [agentsSearchQuery]
  );
  const matchesAgentQuery = useCallback((agent: { name: string; summary: string; actionKey: string }) => {
    if (!normalizedAgentSearchQuery) return true;
    const haystack = `${agent.name} ${agent.summary} ${agent.actionKey}`.toLowerCase();
    return haystack.includes(normalizedAgentSearchQuery);
  }, [normalizedAgentSearchQuery]);
  const visibleCustomAgents = useMemo(
    () => customAgentCards.filter((agent) => matchesAgentQuery(agent)),
    [customAgentCards, matchesAgentQuery]
  );
  const cavenNativeUnlockedCards = useMemo(() => {
    const seen = new Set<string>();
    const rows: BuiltInRegistryCard[] = [];
    for (const card of [...agentRegistrySnapshot.caven.installed, ...agentRegistrySnapshot.caven.available]) {
      if (card.locked || !isAgentPlanEligible(accountPlanId, card.minimumPlan)) continue;
      if (!card.id || seen.has(card.id)) continue;
      seen.add(card.id);
      rows.push(card);
    }
    return rows;
  }, [accountPlanId, agentRegistrySnapshot.caven.available, agentRegistrySnapshot.caven.installed]);
  const cavenInstalledAgents = useMemo(
    () => cavenNativeUnlockedCards.filter((agent) => installedAgentSet.has(agent.id) && matchesAgentQuery(agent)),
    [cavenNativeUnlockedCards, installedAgentSet, matchesAgentQuery]
  );
  const cavenAvailableAgents = useMemo(
    () => cavenNativeUnlockedCards.filter((agent) => !installedAgentSet.has(agent.id) && matchesAgentQuery(agent)),
    [cavenNativeUnlockedCards, installedAgentSet, matchesAgentQuery]
  );
  const cavenPremiumLockedAgents = useMemo(() => {
    const seen = new Set<string>();
    const rows: BuiltInRegistryCard[] = [];
    for (const agent of agentRegistrySnapshot.caven.premiumLocked) {
      if (isAgentPlanEligible(accountPlanId, agent.minimumPlan)) continue;
      if (!agent.id || seen.has(agent.id) || !matchesAgentQuery(agent)) continue;
      seen.add(agent.id);
      rows.push(agent);
    }
    return rows;
  }, [accountPlanId, agentRegistrySnapshot.caven.premiumLocked, matchesAgentQuery]);
  const cavenSupportUnlockedCards = useMemo(() => {
    const seen = new Set<string>();
    const rows: BuiltInRegistryCard[] = [];
    for (const card of agentRegistrySnapshot.caven.support) {
      if (card.locked || !isAgentPlanEligible(accountPlanId, card.minimumPlan)) continue;
      if (!card.id || seen.has(card.id)) continue;
      seen.add(card.id);
      rows.push(card);
    }
    return rows;
  }, [accountPlanId, agentRegistrySnapshot.caven.support]);
  const cavenSupportInstalledAgents = useMemo(
    () => cavenSupportUnlockedCards.filter((agent) => installedAgentSet.has(agent.id) && matchesAgentQuery(agent)),
    [cavenSupportUnlockedCards, installedAgentSet, matchesAgentQuery]
  );
  const cavenSupportAvailableAgents = useMemo(
    () => cavenSupportUnlockedCards.filter((agent) => !installedAgentSet.has(agent.id) && matchesAgentQuery(agent)),
    [cavenSupportUnlockedCards, installedAgentSet, matchesAgentQuery]
  );
  const cavenSupportLockedAgents = useMemo(() => {
    const seen = new Set<string>();
    const rows: BuiltInRegistryCard[] = [];
    for (const card of agentRegistrySnapshot.caven.support) {
      const lockedForPlan = !isAgentPlanEligible(accountPlanId, card.minimumPlan);
      if ((!card.locked && !lockedForPlan) || !matchesAgentQuery(card) || seen.has(card.id)) continue;
      seen.add(card.id);
      rows.push(card);
    }
    return rows;
  }, [accountPlanId, agentRegistrySnapshot.caven.support, matchesAgentQuery]);
  const cavenGeneralModelOptions = useMemo(() => {
    return CAVEN_GENERAL_MODEL_BASE_IDS.map((id) => ({
      id,
      label: resolveAiModelLabel(id),
    }));
  }, []);
  const cavenConfigToml = useMemo(() => buildCavenConfigToml(cavenIdeSettings), [cavenIdeSettings]);
  const applyAgentSettingsFromServer = useCallback((args: {
    settings: Record<string, unknown>;
    fallbackInstalled: string[];
    agentRegistry?: unknown;
    planId?: unknown;
  }) => {
    const nextRegistrySnapshot = args.agentRegistry !== undefined
      ? normalizeAgentRegistrySnapshot(args.agentRegistry)
      : agentRegistrySnapshotRef.current;
    if (args.planId !== undefined) {
      setAccountPlanId(normalizePlanId(args.planId));
    }
    setAgentRegistrySnapshot(nextRegistrySnapshot);
    agentRegistrySnapshotRef.current = nextRegistrySnapshot;

    const nextBuiltInIds = flattenBuiltInRegistryCards(nextRegistrySnapshot).map((card) => card.id);
    const nextBuiltInIdSet = new Set(nextBuiltInIds);
    const nextCustomAgents = normalizeCustomAgentsFromUnknown(args.settings.customAgents, nextBuiltInIdSet);
    const customIdSet = new Set(nextCustomAgents.map((agent) => agent.id));
    const normalizedInstalled = normalizeInstalledAgentIdsFromUnknown(
      args.settings.installedAgentIds,
      args.fallbackInstalled,
      customIdSet,
      nextBuiltInIds
    );
    const normalizedEditorSettings = normalizeEditorSettingsFromUnknown(args.settings.editorSettings);
    const normalizedCavenIdeSettings = normalizeCavenIdeSettingsFromUnknown(args.settings);
    setCustomAgents(nextCustomAgents);
    setInstalledAgentIds(normalizedInstalled);
    setSettings(normalizedEditorSettings);
    setCavenIdeSettings(normalizedCavenIdeSettings);
    settingsPersistedHashRef.current = quickStringSignature(JSON.stringify(normalizedEditorSettings));
    settingsBootstrappedRef.current = true;

    if (!terminalMetaBootedRef.current) {
      const persistedTerminalState = normalizeTerminalStateFromUnknown(args.settings.terminalState);
      const nextSeq = (persistedTerminalState.ttySeq + 1) % 1000;
      const now = Date.now();
      terminalMetaBootedRef.current = true;
      setTermLastLoginTs(persistedTerminalState.lastLoginTs);
      setTermTtyLabel(terminalTtyLabelFromSeq(nextSeq));
      setTermBootMetaReady(true);
      void fetch("/api/cavai/settings", {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          terminalState: {
            lastLoginTs: now,
            ttySeq: nextSeq,
          },
        }),
      }).catch(() => {});
    }
  }, []);

  const refreshInstalledAgentsFromSettings = useCallback(async (silent = false) => {
    if (!silent) setLoadingAgents(true);
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
        planId?: unknown;
        message?: unknown;
      };
      if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
        throw new Error(String(body.message || "Failed to load Caven agent settings."));
      }
      const settings = body.settings as Record<string, unknown>;
      applyAgentSettingsFromServer({
        settings,
        fallbackInstalled: installedAgentIdsRef.current,
        agentRegistry: body.agentRegistry,
        planId: body.planId,
      });
      if (!silent) pushToast("Agents list refreshed.", "good");
    } catch (err) {
      if (!silent) {
        pushToast(err instanceof Error ? err.message : "Failed to refresh agents.", "bad");
      }
    } finally {
      if (!silent) setLoadingAgents(false);
    }
  }, [applyAgentSettingsFromServer, pushToast]);

  const patchCavenIdeSettings = useCallback((patch: Partial<CavenIdeSettings>, key: keyof CavenIdeSettings) => {
    if (savingCavenIdeSettingsKey) return;
    const normalizedPatch = { ...patch };
    if ("defaultModelId" in normalizedPatch) {
      normalizedPatch.defaultModelId = normalizeCavenGeneralModelId(normalizedPatch.defaultModelId);
    }
    const previous = cavenIdeSettings;
    const optimistic = normalizeCavenIdeSettingsFromUnknown({ ...previous, ...normalizedPatch });
    setCavenIdeSettings(optimistic);
    setSavingCavenIdeSettingsKey(key);

    void (async () => {
      try {
        const res = await fetch("/api/cavai/settings", {
          method: "PATCH",
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify(normalizedPatch),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          settings?: unknown;
          agentRegistry?: unknown;
          planId?: unknown;
          message?: unknown;
        };
        if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
          throw new Error(String(body.message || "Failed to update Caven IDE settings."));
        }
        const settings = body.settings as Record<string, unknown>;
        applyAgentSettingsFromServer({
          settings,
          fallbackInstalled: installedAgentIds,
          agentRegistry: body.agentRegistry,
          planId: body.planId,
        });
      } catch (err) {
        setCavenIdeSettings(previous);
        pushToast(err instanceof Error ? err.message : "Failed to update Caven IDE settings.", "bad");
      } finally {
        setSavingCavenIdeSettingsKey("");
      }
    })();
  }, [applyAgentSettingsFromServer, cavenIdeSettings, installedAgentIds, pushToast, savingCavenIdeSettingsKey]);

  useEffect(() => {
    void refreshInstalledAgentsFromSettings(true);
  }, [refreshInstalledAgentsFromSettings]);

  useEffect(() => {
    if (!agentManageMenuId) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        setAgentManageMenuId("");
        return;
      }
      const root = target.closest(`[data-agent-manage-id="${agentManageMenuId}"]`);
      if (root) return;
      setAgentManageMenuId("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAgentManageMenuId("");
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [agentManageMenuId]);

  const toggleAgentInstalled = useCallback((agentId: string, install: boolean) => {
    if (savingAgentId) return;
    const customAgent = customAgents.find((row) => row.id === agentId) || null;
    const builtInAgent = builtInRegistryById.get(agentId) || null;
    const agentName = customAgent?.name || builtInAgent?.name || "Agent";
    if (!customAgent && !builtInAgent) return;
    if (install && builtInAgent?.locked) {
      const required = requiredPlanLabel(builtInAgent.minimumPlan);
      pushToast(`${agentName} requires ${required}.`, "watch");
      return;
    }
    const nextSet = new Set(installedAgentIds);
    if (install) nextSet.add(agentId);
    else nextSet.delete(agentId);
    const orderedBuiltIn = knownBuiltInAgentIds.filter((id) => nextSet.has(id));
    const orderedCustom = customAgents.map((row) => row.id).filter((id) => nextSet.has(id));
    const orderedUnknown = installedAgentIds.filter(
      (id) => !knownBuiltInAgentIdSet.has(id) && !customAgentIdSet.has(id) && nextSet.has(id)
    );
    const nextIds = [...orderedBuiltIn, ...orderedCustom, ...orderedUnknown];
    const prevIds = [...installedAgentIds];
    setInstalledAgentIds(nextIds);

    setSavingAgentId(agentId);

    void (async () => {
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
          planId?: unknown;
          message?: unknown;
        };
        if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
          throw new Error(String(body.message || "Failed to update Caven agents."));
        }
        const settings = body.settings as Record<string, unknown>;
        applyAgentSettingsFromServer({
          settings,
          fallbackInstalled: nextIds,
          agentRegistry: body.agentRegistry,
          planId: body.planId,
        });
        pushToast(`${agentName} ${install ? "installed" : "uninstalled"}.`, "good");
      } catch (err) {
        setInstalledAgentIds(prevIds);
        pushToast(err instanceof Error ? err.message : `Failed to update ${agentName}.`, "bad");
      } finally {
        setSavingAgentId("");
      }
    })();
  }, [
    applyAgentSettingsFromServer,
    builtInRegistryById,
    customAgentIdSet,
    customAgents,
    installedAgentIds,
    knownBuiltInAgentIds,
    knownBuiltInAgentIdSet,
    pushToast,
    savingAgentId,
  ]);

  const persistCustomAgentRegistry = useCallback((args: {
    targetAgentId: string;
    nextCustomAgents: CustomCavenAgentRecord[];
    nextInstalledIds: string[];
    successToast: string;
    onRollback: () => void;
  }) => {
    if (savingAgentId) return;
    setSavingAgentId(args.targetAgentId);
    void (async () => {
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
            customAgents: args.nextCustomAgents,
            installedAgentIds: args.nextInstalledIds,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          settings?: unknown;
          agentRegistry?: unknown;
          planId?: unknown;
          message?: unknown;
        };
        if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
          throw new Error(String(body.message || "Failed to update custom agents."));
        }
        const settings = body.settings as Record<string, unknown>;
        applyAgentSettingsFromServer({
          settings,
          fallbackInstalled: args.nextInstalledIds,
          agentRegistry: body.agentRegistry,
          planId: body.planId,
        });
        pushToast(args.successToast, "good");
      } catch (err) {
        args.onRollback();
        pushToast(err instanceof Error ? err.message : "Failed to update custom agents.", "bad");
      } finally {
        setSavingAgentId("");
      }
    })();
  }, [applyAgentSettingsFromServer, pushToast, savingAgentId]);

  const moveCustomAgentSurface = useCallback((agentId: string, surface: "cavcode" | "center" | "all") => {
    if (savingAgentId) return;
    const previousCustom = [...customAgents];
    const previousInstalled = [...installedAgentIds];
    const target = customAgents.find((agent) => agent.id === agentId);
    if (!target || target.surface === surface) return;

    const nextCustom = customAgents.map((agent) =>
      agent.id === agentId
        ? {
            ...agent,
            surface,
          }
        : agent
    );
    setCustomAgents(nextCustom);
    setAgentManageMenuId("");
    const targetName = target.name || "Agent";
    persistCustomAgentRegistry({
      targetAgentId: agentId,
      nextCustomAgents: nextCustom,
      nextInstalledIds: previousInstalled,
      successToast: `${targetName} moved to ${surface === "all" ? "all surfaces" : surface === "center" ? "CavAi" : "Caven"}.`,
      onRollback: () => {
        setCustomAgents(previousCustom);
        setInstalledAgentIds(previousInstalled);
      },
    });
  }, [customAgents, installedAgentIds, persistCustomAgentRegistry, savingAgentId]);

  const deleteCustomAgent = useCallback((agentId: string) => {
    if (savingAgentId) return;
    const previousCustom = [...customAgents];
    const previousInstalled = [...installedAgentIds];
    const target = customAgents.find((agent) => agent.id === agentId);
    if (!target) return;

    const nextCustom = customAgents.filter((agent) => agent.id !== agentId);
    const nextInstalled = installedAgentIds.filter((id) => id !== agentId);
    setCustomAgents(nextCustom);
    setInstalledAgentIds(nextInstalled);
    setAgentManageMenuId("");
    persistCustomAgentRegistry({
      targetAgentId: agentId,
      nextCustomAgents: nextCustom,
      nextInstalledIds: nextInstalled,
      successToast: `${target.name} deleted.`,
      onRollback: () => {
        setCustomAgents(previousCustom);
        setInstalledAgentIds(previousInstalled);
      },
    });
  }, [customAgents, installedAgentIds, persistCustomAgentRegistry, savingAgentId]);

  const createAgentAiModelLabel = useMemo(
    () =>
      createAgentAiModelOptions.find((row) => row.id === createAgentAiModelId)?.label
      || resolveAiModelLabel(createAgentAiModelId)
      || "Model",
    [createAgentAiModelId, createAgentAiModelOptions]
  );
  const createAgentAiReasoningLabel = useMemo(
    () =>
      AGENT_BUILDER_REASONING_OPTIONS.find((row) => row.value === createAgentAiReasoningLevel)?.label
      || toReasoningDisplayLabel(createAgentAiReasoningLevel),
    [createAgentAiReasoningLevel]
  );
  const createAgentAiPromptActionLabel = useMemo(() => {
    if (createAgentAiBusy && createAgentAiWorkingMode === "help_write") return "Generating...";
    return "Generate";
  }, [createAgentAiBusy, createAgentAiWorkingMode]);
  const changesCommitAiPromptActionLabel = useMemo(() => {
    if (changesCommitAiBusy && changesCommitAiWorkingMode === "help_write") return "Generating...";
    return "Generate";
  }, [changesCommitAiBusy, changesCommitAiWorkingMode]);

  const loadChangesCommitAiControls = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/test?catalog=plan&surface=cavcode&action=write_note", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        planId?: unknown;
        models?: { chat?: unknown; reasoning?: unknown };
        modelCatalog?: { text?: unknown[] };
        reasoning?: { maxLevel?: unknown; options?: unknown[] };
      };
      const policyPlanId = normalizePlanId(body.planId);
      const effectivePlanId =
        planTierRank(policyPlanId) >= planTierRank(accountPlanId) ? policyPlanId : accountPlanId;
      if (!res.ok || body.ok !== true) {
        setChangesCommitAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, effectivePlanId));
        setChangesCommitAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, effectivePlanId));
        return;
      }

      const catalogRows = Array.isArray(body.modelCatalog?.text)
        ? body.modelCatalog?.text.map((row) => toModelOptionFromUnknown(row)).filter(Boolean) as AgentBuilderModelOption[]
        : [];
      const fallbackRows = [String(body.models?.chat || "").trim(), String(body.models?.reasoning || "").trim()]
        .filter(Boolean)
        .map((id) => ({ id, label: resolveAiModelLabel(id) }));
      const nextModels = normalizeAgentBuilderModelOptions(catalogRows.length ? catalogRows : fallbackRows);
      setChangesCommitAiModelOptions(mergeAgentBuilderModelOptionsWithPlan(nextModels, effectivePlanId));

      const optionsFromPolicy = normalizeReasoningOptions(body.reasoning?.options);
      const optionsFromMax = reasoningLevelsUpTo(body.reasoning?.maxLevel);
      const optionsFromPlan = reasoningLevelsForPlan(body.planId);
      const nextReasoning =
        optionsFromPolicy.length
          ? optionsFromPolicy
          : optionsFromMax.length
            ? optionsFromMax
            : optionsFromPlan;
      setChangesCommitAiReasoningOptions(mergeAgentBuilderReasoningOptionsWithPlan(nextReasoning, effectivePlanId));
    } catch {
      setChangesCommitAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, accountPlanId));
      setChangesCommitAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, accountPlanId));
    } finally {
      setChangesCommitAiModelsLoaded(true);
    }
  }, [accountPlanId]);

  const loadCreateAgentAiControls = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/test?catalog=plan&surface=cavcode&action=write_note", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        planId?: unknown;
        models?: { chat?: unknown; reasoning?: unknown };
        modelCatalog?: { text?: unknown[] };
        reasoning?: { maxLevel?: unknown; options?: unknown[] };
      };
      const policyPlanId = normalizePlanId(body.planId);
      const effectivePlanId =
        planTierRank(policyPlanId) >= planTierRank(accountPlanId) ? policyPlanId : accountPlanId;
      if (!res.ok || body.ok !== true) {
        setCreateAgentAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, effectivePlanId));
        setCreateAgentAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, effectivePlanId));
        return;
      }

      const catalogRows = Array.isArray(body.modelCatalog?.text)
        ? body.modelCatalog?.text.map((row) => toModelOptionFromUnknown(row)).filter(Boolean) as AgentBuilderModelOption[]
        : [];
      const fallbackRows = [String(body.models?.chat || "").trim(), String(body.models?.reasoning || "").trim()]
        .filter(Boolean)
        .map((id) => ({ id, label: resolveAiModelLabel(id) }));
      const nextModels = normalizeAgentBuilderModelOptions(catalogRows.length ? catalogRows : fallbackRows);
      setCreateAgentAiModelOptions(mergeAgentBuilderModelOptionsWithPlan(nextModels, effectivePlanId));

      const optionsFromPolicy = normalizeReasoningOptions(body.reasoning?.options);
      const optionsFromMax = reasoningLevelsUpTo(body.reasoning?.maxLevel);
      const optionsFromPlan = reasoningLevelsForPlan(body.planId);
      const nextReasoning =
        optionsFromPolicy.length
          ? optionsFromPolicy
          : optionsFromMax.length
            ? optionsFromMax
            : optionsFromPlan;
      setCreateAgentAiReasoningOptions(mergeAgentBuilderReasoningOptionsWithPlan(nextReasoning, effectivePlanId));
    } catch {
      setCreateAgentAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, accountPlanId));
      setCreateAgentAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, accountPlanId));
    } finally {
      setCreateAgentAiModelsLoaded(true);
    }
  }, [accountPlanId]);

  const runCreateAgentAiDraft = useCallback(async (mode: AgentBuilderAiMode, helpPromptInput?: string) => {
    if (createAgentAiBusy) return;
    const helpPrompt = String(helpPromptInput || "").trim();
    if (mode === "help_write" && !helpPrompt) {
      pushToast("Add a brief prompt for CavAi first.", "watch");
      return;
    }

    const currentTriggers = createAgentTriggers
      .split(/[\n,]/g)
      .map((row) => row.trim())
      .filter(Boolean)
      .slice(0, 12);

    const prompt = [
      "You are assisting with a Create Agent form for Caven.",
      "Output only strict JSON. No markdown. No code fences.",
      `Required JSON schema: {"name":"string","summary":"string","triggers":["string"],"instructions":"string","surface":"cavcode|center|all"}`,
      "Constraints:",
      "- name: 2-64 chars, concise and professional.",
      "- summary: 10-220 chars, one sentence.",
      "- triggers: 3-8 short phrases, array of strings.",
      "- instructions: 80-1200 chars, clear operational steps and guardrails.",
      "- surface: pick cavcode, center, or all.",
      "",
      mode === "help_write"
        ? `User request:\n${helpPrompt}`
        : "Generate a complete, production-ready agent profile from context.",
      "",
      `Current draft name: ${createAgentName.trim() || "(empty)"}`,
      `Current draft summary: ${createAgentSummary.trim() || "(empty)"}`,
      `Current draft triggers: ${currentTriggers.length ? currentTriggers.join(", ") : "(empty)"}`,
      `Current draft instructions: ${createAgentInstructions.trim() || "(empty)"}`,
      `Current draft surface: ${createAgentSurface}`,
      "",
      "Return valid JSON only.",
    ].join("\n");

    setCreateAgentAiBusy(true);
    setCreateAgentAiWorkingMode(mode);
    setCreateAgentAiMenuOpen(mode === "generate_agent");
    setCreateAgentAiPromptOpen(false);
    setCreateAgentAiControlMenu(null);
    setCreateAgentError("");

    try {
      const res = await fetch("/api/ai/center/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          action: "write_note",
          surface: "cavcode",
          prompt,
          goal: mode === "help_write" ? `Help draft this agent: ${helpPrompt}` : "Generate a complete Caven agent draft.",
          model: createAgentAiModelId,
          reasoningLevel: createAgentAiReasoningLevel,
          sessionId: String(createAgentAiSessionId || "").trim() || undefined,
          contextLabel: "Caven Agent Builder",
          context: {
            mode,
            createAgent: {
              name: createAgentName,
              summary: createAgentSummary,
              triggers: currentTriggers,
              instructions: createAgentInstructions,
              surface: createAgentSurface,
            },
            selectedModel: createAgentAiModelId,
            reasoningLevel: createAgentAiReasoningLevel,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sessionId?: unknown;
        message?: unknown;
        data?: {
          answer?: unknown;
          summary?: unknown;
        };
      };
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(String(body.message || "CavAi could not generate this agent."));
      }

      const nextSessionId = String(body.sessionId || "").trim();
      if (nextSessionId) setCreateAgentAiSessionId(nextSessionId);

      const parsedDraft = parseAgentBuilderDraftFromText(body.data.answer || body.data.summary || "");
      if (!parsedDraft) {
        throw new Error("CavAi returned a response that could not be applied to the agent form.");
      }

      setCreateAgentName(parsedDraft.name);
      setCreateAgentSummary(parsedDraft.summary);
      setCreateAgentTriggers(parsedDraft.triggers.join(", "));
      setCreateAgentInstructions(parsedDraft.instructions);
      setCreateAgentSurface(parsedDraft.surface);
      pushToast(mode === "generate_agent" ? "CavAi generated your agent draft." : "CavAi updated your draft.", "good");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "CavAi could not generate this agent.", "bad");
    } finally {
      setCreateAgentAiBusy(false);
      setCreateAgentAiWorkingMode(null);
      setCreateAgentAiMenuOpen(false);
      setCreateAgentAiPromptOpen(false);
      setCreateAgentAiPromptText("");
    }
  }, [
    createAgentAiBusy,
    createAgentAiModelId,
    createAgentAiReasoningLevel,
    createAgentAiSessionId,
    createAgentInstructions,
    createAgentName,
    createAgentSummary,
    createAgentSurface,
    createAgentTriggers,
    pushToast,
  ]);

  const openCreateAgentAiPrompt = useCallback(() => {
    if (createAgentAiBusy) return;
    setCreateAgentAiControlMenu(null);
    setCreateAgentAiMenuOpen(false);
    setCreateAgentAiPromptText("");
    setCreateAgentAiPromptOpen(true);
  }, [createAgentAiBusy]);

  const submitCreateAgentAiPrompt = useCallback(() => {
    if (createAgentAiBusy) return;
    const trimmed = String(createAgentAiPromptText || "").trim();
    if (!trimmed) {
      createAgentAiHelpPromptInputRef.current?.focus();
      return;
    }
    void runCreateAgentAiDraft("help_write", trimmed);
  }, [createAgentAiBusy, createAgentAiPromptText, runCreateAgentAiDraft]);

  const rotateCreateAgentAiPromptHint = useCallback(() => {
    const hasDraftContent = Boolean(
      createAgentName.trim() || createAgentSummary.trim() || createAgentTriggers.trim() || createAgentInstructions.trim()
    );
    let nextHint = "";
    const recent = createAgentAiPromptHintRecentRef.current;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = buildAgentCreatePromptHint(hasDraftContent);
      if (!recent.includes(candidate)) {
        nextHint = candidate;
        break;
      }
      nextHint = candidate;
    }
    if (!nextHint) nextHint = "Generate a production-ready agent with clear triggers and guardrails.";
    recent.push(nextHint);
    if (recent.length > 28) recent.splice(0, recent.length - 28);
    setCreateAgentAiPromptHint(nextHint);
    setCreateAgentAiPromptHintCycle((value) => value + 1);
  }, [createAgentInstructions, createAgentName, createAgentSummary, createAgentTriggers]);

  const rotateChangesCommitAiPromptHint = useCallback(() => {
    const hasDraftContent = Boolean(String(changesCommitMessage || "").trim());
    let nextHint = "";
    const recent = changesCommitAiPromptHintRecentRef.current;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = buildCommitMessagePromptHint(hasDraftContent);
      if (!recent.includes(candidate)) {
        nextHint = candidate;
        break;
      }
      nextHint = candidate;
    }
    if (!nextHint) nextHint = "Write a concise commit title for the current staged changes.";
    recent.push(nextHint);
    if (recent.length > 28) recent.splice(0, recent.length - 28);
    setChangesCommitAiPromptHint(nextHint);
    setChangesCommitAiPromptHintCycle((value) => value + 1);
  }, [changesCommitMessage]);

  useEffect(() => {
    if (activity !== "changes") return;
    if (changesCommitAiModelsLoaded) return;
    void loadChangesCommitAiControls();
  }, [activity, changesCommitAiModelsLoaded, loadChangesCommitAiControls]);

  useEffect(() => {
    if (changesCommitAiModelOptions.some((row) => row.id === changesCommitAiModelId)) return;
    setChangesCommitAiModelId(changesCommitAiModelOptions[0]?.id || DEEPSEEK_CHAT_MODEL_ID);
  }, [changesCommitAiModelId, changesCommitAiModelOptions]);

  useEffect(() => {
    if (changesCommitAiReasoningOptions.some((row) => row === changesCommitAiReasoningLevel)) return;
    setChangesCommitAiReasoningLevel(changesCommitAiReasoningOptions[0] || "medium");
  }, [changesCommitAiReasoningLevel, changesCommitAiReasoningOptions]);

  useEffect(() => {
    setChangesCommitAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, accountPlanId));
    setChangesCommitAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, accountPlanId));
    setCreateAgentAiModelOptions((prev) => mergeAgentBuilderModelOptionsWithPlan(prev, accountPlanId));
    setCreateAgentAiReasoningOptions((prev) => mergeAgentBuilderReasoningOptionsWithPlan(prev, accountPlanId));
  }, [accountPlanId]);

  useEffect(() => {
    if (activity !== "changes") {
      changesCommitAiPromptHintRecentRef.current = [];
      return;
    }
    if (!changesCommitAiPromptOpen) {
      changesCommitAiPromptHintRecentRef.current = [];
      return;
    }
    rotateChangesCommitAiPromptHint();
    const interval = window.setInterval(() => rotateChangesCommitAiPromptHint(), AGENT_CREATE_PROMPT_HINT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activity, changesCommitAiPromptOpen, rotateChangesCommitAiPromptHint]);

  useEffect(() => {
    if (activity !== "changes") return;
    if (!changesCommitAiPromptOpen) return;
    const timer = window.setTimeout(() => changesCommitAiHelpPromptInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [activity, changesCommitAiPromptOpen]);

  useEffect(() => {
    if (activity !== "changes") return;
    if (!changesCommitAiMenuOpen && !changesCommitAiPromptOpen) return;

    const closeMenus = () => {
      setChangesCommitAiMenuOpen(false);
      setChangesCommitAiPromptOpen(false);
    };

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest("[data-changes-commit-ai='true']")) return;
      closeMenus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenus();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activity, changesCommitAiMenuOpen, changesCommitAiPromptOpen]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (createAgentAiModelsLoaded) return;
    void loadCreateAgentAiControls();
  }, [createAgentAiModelsLoaded, createAgentOpen, loadCreateAgentAiControls]);

  useEffect(() => {
    if (createAgentAiModelOptions.some((row) => row.id === createAgentAiModelId)) return;
    setCreateAgentAiModelId(createAgentAiModelOptions[0]?.id || DEEPSEEK_CHAT_MODEL_ID);
  }, [createAgentAiModelId, createAgentAiModelOptions]);

  useEffect(() => {
    if (createAgentAiReasoningOptions.some((row) => row === createAgentAiReasoningLevel)) return;
    setCreateAgentAiReasoningLevel("medium");
  }, [createAgentAiReasoningLevel, createAgentAiReasoningOptions]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (!createAgentAiPromptOpen) return;
    const timer = window.setTimeout(() => createAgentAiHelpPromptInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [createAgentAiPromptOpen, createAgentOpen]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (!createAgentAiPromptOpen) {
      createAgentAiPromptHintRecentRef.current = [];
      return;
    }
    rotateCreateAgentAiPromptHint();
    const interval = window.setInterval(() => rotateCreateAgentAiPromptHint(), AGENT_CREATE_PROMPT_HINT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [createAgentAiPromptOpen, createAgentOpen, rotateCreateAgentAiPromptHint]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (!createAgentAiMenuOpen && !createAgentAiPromptOpen && !createAgentAiControlMenu) return;

    const closeMenus = () => {
      setCreateAgentAiMenuOpen(false);
      setCreateAgentAiPromptOpen(false);
      setCreateAgentAiControlMenu(null);
    };

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest("[data-agent-create-ai='true']")) return;
      closeMenus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenus();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createAgentAiControlMenu, createAgentAiMenuOpen, createAgentAiPromptOpen, createAgentOpen]);

  const commitCreateAgentIconBackground = useCallback((value: string) => {
    const normalized = normalizeAgentColorHexFromUnknown(value);
    if (!normalized) {
      const fallback = createAgentIconBackground || pickDefaultAgentIconBackground(createAgentIconPalette);
      setCreateAgentColorInput(fallback);
      return false;
    }
    setCreateAgentIconBackground(normalized);
    setCreateAgentColorInput(normalized);
    return true;
  }, [createAgentIconBackground, createAgentIconPalette]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (!createAgentIconSvg) {
      setCreateAgentColorMenuOpen(false);
      return;
    }
    if (!createAgentColorMenuOpen) return;
    const timer = window.setTimeout(() => createAgentColorInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [createAgentColorMenuOpen, createAgentIconSvg, createAgentOpen]);

  useEffect(() => {
    if (!createAgentOpen) return;
    if (!createAgentColorMenuOpen) return;

    const closeMenu = () => setCreateAgentColorMenuOpen(false);

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest("[data-agent-create-color='true']")) return;
      closeMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenu();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createAgentColorMenuOpen, createAgentOpen]);

  const closeCreateAgent = useCallback(() => {
    setCreateAgentOpen(false);
    setCreateAgentName("");
    setCreateAgentSummary("");
    setCreateAgentTriggers("");
    setCreateAgentInstructions("");
    setCreateAgentSurface("all");
    setCreateAgentIconSvg("");
    setCreateAgentIconBackground("");
    setCreateAgentIconPalette([]);
    setCreateAgentColorInput("");
    setCreateAgentColorMenuOpen(false);
    if (createAgentIconInputRef.current) createAgentIconInputRef.current.value = "";
    setCreateAgentError("");
    setCreateAgentAiBusy(false);
    setCreateAgentAiMenuOpen(false);
    setCreateAgentAiPromptOpen(false);
    setCreateAgentAiPromptText("");
    setCreateAgentAiPromptHint("");
    setCreateAgentAiControlMenu(null);
    setCreateAgentAiWorkingMode(null);
  }, []);

  const onCreateAgentIconUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0] || null;
    if (!file) return;

    const fileName = String(file.name || "").toLowerCase();
    const isSvg = file.type === "image/svg+xml" || fileName.endsWith(".svg");
    if (!isSvg) {
      setCreateAgentError("Icon must be an SVG file (.svg).");
      input.value = "";
      return;
    }
    if (file.size > 180 * 1024) {
      setCreateAgentError("SVG icon is too large. Keep it under 180KB.");
      input.value = "";
      return;
    }

    try {
      const svgText = await file.text();
      const normalized = normalizeAgentIconSvgFromUnknown(svgText);
      if (!normalized) {
        setCreateAgentError("Invalid SVG icon. Upload a clean SVG without scripts.");
        input.value = "";
        return;
      }
      const palette = extractSvgPalette(normalized);
      const defaultColor = pickDefaultAgentIconBackground(palette);
      setCreateAgentIconSvg(normalized);
      setCreateAgentIconPalette(palette);
      setCreateAgentIconBackground(defaultColor);
      setCreateAgentColorInput(defaultColor);
      setCreateAgentColorMenuOpen(false);
      setCreateAgentError("");
    } catch {
      setCreateAgentError("Failed to read icon file.");
      input.value = "";
    }
  }, []);

  const createCustomAgent = useCallback(() => {
    if (savingAgentId) return;
    const name = createAgentName.trim().replace(/\s+/g, " ");
    const summary = createAgentSummary.trim().replace(/\s+/g, " ");
    const instructions = createAgentInstructions.trim();
    const iconSvg = normalizeAgentIconSvgFromUnknown(createAgentIconSvg);
    const iconBackground = normalizeAgentColorHexFromUnknown(createAgentIconBackground) || null;
    const triggerList = createAgentTriggers
      .split(/[\n,]/g)
      .map((row) => row.trim())
      .filter(Boolean)
      .slice(0, 12);

    if (name.length < 2) {
      setCreateAgentError("Name must be at least 2 characters.");
      return;
    }
    if (summary.length < 10) {
      setCreateAgentError("Description must be at least 10 characters.");
      return;
    }
    if (instructions.length < 20) {
      setCreateAgentError("Instructions must be at least 20 characters.");
      return;
    }
    if (!iconSvg) {
      setCreateAgentError("Agent icon is required. Upload an SVG icon.");
      return;
    }

    const baseSlug = toAgentSlug(name) || "agent";
    const candidate = `custom_${baseSlug}`;
    const taken = new Set<string>([...knownBuiltInAgentIds, ...customAgents.map((row) => row.id)]);
    const id = taken.has(candidate) ? `${candidate}_${Date.now().toString(36)}` : candidate;
    const actionKey = `custom_${(toAgentSlug(name) || id).replace(/-/g, "_")}`;
    const record: CustomCavenAgentRecord = {
      id,
      name,
      summary,
      actionKey,
      surface: createAgentSurface,
      triggers: triggerList,
      instructions,
      iconSvg,
      iconBackground,
      createdAt: new Date().toISOString(),
    };

    const nextCustomAgents = [record, ...customAgents];
    const nextInstalled = installedAgentIds.includes(record.id) ? installedAgentIds : [...installedAgentIds, record.id];
    const previousInstalled = [...installedAgentIds];
    const previousCustom = [...customAgents];
    setCustomAgents(nextCustomAgents);
    setInstalledAgentIds(nextInstalled);
    setSavingAgentId(record.id);

    void (async () => {
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
            customAgents: nextCustomAgents,
            installedAgentIds: nextInstalled,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          settings?: unknown;
          agentRegistry?: unknown;
          planId?: unknown;
          message?: unknown;
        };
        if (!res.ok || !body.ok || !body.settings || typeof body.settings !== "object") {
          throw new Error(String(body.message || "Failed to create agent."));
        }
        const settings = body.settings as Record<string, unknown>;
        applyAgentSettingsFromServer({
          settings,
          fallbackInstalled: nextInstalled,
          agentRegistry: body.agentRegistry,
          planId: body.planId,
        });
        setAgentsSearchQuery("");
        closeCreateAgent();
        pushToast(`${name} created and installed.`, "good");
      } catch (err) {
        setCustomAgents(previousCustom);
        setInstalledAgentIds(previousInstalled);
        setCreateAgentError(err instanceof Error ? err.message : "Failed to create agent.");
      } finally {
        setSavingAgentId("");
      }
    })();
  }, [
    applyAgentSettingsFromServer,
    closeCreateAgent,
    createAgentInstructions,
    createAgentIconBackground,
    createAgentIconSvg,
    createAgentName,
    createAgentSummary,
    createAgentSurface,
    createAgentTriggers,
    customAgents,
    installedAgentIds,
    knownBuiltInAgentIds,
    pushToast,
    savingAgentId,
  ]);

  const activeProjectRoot = useMemo(() => {
    if (!activeProjectRootPath) return null;
    const hit = findNodeByPath(fs, activeProjectRootPath);
    if (!hit || !isFolder(hit) || !isUserWorkspacePath(hit.path)) return null;
    return hit;
  }, [activeProjectRootPath, fs]);

  useEffect(() => {
    if (!activeProjectRootPath) return;
    if (activeProjectRoot) return;
    setActiveProjectRootPath(null);
  }, [activeProjectRoot, activeProjectRootPath]);

  const cavAiProjectFiles = useMemo<CavCodeProjectFileRef[]>(() => {
    const files = listFiles(fs)
      .filter((file) => isUserWorkspacePath(file.path))
      .filter((file) => (activeProjectRoot ? normalizePath(file.path).startsWith(`${normalizePath(activeProjectRoot.path)}/`) : true))
      .slice(0, 1200)
      .map((file) => ({
        path: file.path,
        name: file.name,
        lang: file.lang,
        relativePath: activeProjectRoot ? relativePathFromRoot(activeProjectRoot.path, file.path) : file.path.replace(/^\/+/, ""),
      }));
    return files;
  }, [activeProjectRoot, fs]);

  /* =========================
    Monaco cancellation noise suppression (dev overlay killer)
    Monaco can legitimately cancel async work when switching models.
  ========================= */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const isCanceled = (reason: unknown) => {
      if (!reason) return false;
      if (typeof reason === "string") {
        const text = reason.toLowerCase();
        return (
          text.includes("canceled") ||
          text.includes("cancelled") ||
          text.includes("operation canceled") ||
          text.includes("operation cancelled") ||
          text.includes("aborterror") ||
          text.includes("aborted")
        );
      }
      if (typeof reason === "object") {
        const r = reason as Record<string, unknown>;
        const name = String(r.name || "").toLowerCase();
        const msg = String(r.message || "").toLowerCase();
        const text = `${name} ${msg}`;
        return (
          text.includes("canceled") ||
          text.includes("cancelled") ||
          text.includes("operation canceled") ||
          text.includes("operation cancelled") ||
          text.includes("aborterror") ||
          text.includes("aborted")
        );
      }
      return false;
    };

    const onRej = (event: PromiseRejectionEvent) => {
      if (!isCanceled(event.reason)) return;
      event.preventDefault();
    };

    const onErr = (event: ErrorEvent) => {
      if (!isCanceled(event.error) && !isCanceled(event.message)) return;
      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", onRej, true);
    window.addEventListener("error", onErr, true);
    return () => {
      window.removeEventListener("unhandledrejection", onRej, true);
      window.removeEventListener("error", onErr, true);
    };
  }, []);

  const projectContextReady = useMemo(() => {
    if (!fs) return false;
    const files = listFiles(fs);
    const hasUserWorkspaceFiles = files.some((file) => isUserWorkspacePath(file.path));
    const hasMountedCodebaseFiles = files.some((file) => normalizePath(file.path).startsWith("/codebase/"));
    return hasUserWorkspaceFiles || hasMountedCodebaseFiles;
  }, [fs]);

  useEffect(() => {
    if (projectContextReady) return;
    setWorkspaceProblems([]);
  }, [projectContextReady]);

  const activeFileHasErrors = useMemo(() => {
    if (!activeFile) return false;
    const ap = normalizePath(activeFile.path);
    return problems.some((p) => p.severity === "error" && normalizePath(p.file) === ap);
  }, [activeFile, problems]);

  const activeFileDiagnostics = useMemo<CavCodeDiagnostic[]>(() => {
    if (!activeFile) return [];
    const activePath = normalizePath(activeFile.path);
    return problems
      .filter((row) => normalizePath(row.file) === activePath)
      .slice(0, 180)
      .map((row) => ({
        code: row.code || undefined,
        source: row.source || undefined,
        message: row.message,
        severity: row.severity,
        line: row.line,
        col: row.col,
        file: row.file,
      }));
  }, [activeFile, problems]);

  const resolveEditorSelectionCode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return "";
    try {
      const model = editor.getModel?.();
      const selection = editor.getSelection?.();
      if (!model || !selection || selection.isEmpty()) return "";
      return String(model.getValueInRange(selection)).slice(0, 40_000);
    } catch {
      return "";
    }
  }, []);

  const cavAiCodeContext = useMemo(() => {
    const errorCount = problems.filter((row) => row.severity === "error").length;
    const warningCount = problems.filter((row) => row.severity === "warn").length;
    return {
      source: "cavcode",
      activeFilePath: activeFile?.path || null,
      activeProjectRootPath: activeProjectRoot?.path || null,
      activeProjectRootName: activeProjectRoot?.name || null,
      openTabCount: tabs.length,
      modifiedFileCount: modifiedFileIds.size,
      cursor: cursorPos,
      diagnostics: {
        total: problems.length,
        errorCount,
        warningCount,
      },
      projectFiles: cavAiProjectFiles.slice(0, 400).map((row) => ({
        path: row.path,
        relativePath: row.relativePath,
        lang: row.lang,
      })),
      projectId: projectIdFromQuery,
      panelTab,
    };
  }, [
    activeFile?.path,
    activeProjectRoot?.name,
    activeProjectRoot?.path,
    cavAiProjectFiles,
    cursorPos,
    modifiedFileIds.size,
    panelTab,
    problems,
    projectIdFromQuery,
    tabs.length,
  ]);

  const cavAiExpandHref = useMemo(() => {
    const qp = new URLSearchParams();
    qp.set("cavai", "1");
    if (activeFile?.path) qp.set("file", activeFile.path);
    if (Number.isFinite(Number(projectIdFromQuery)) && Number(projectIdFromQuery) > 0) {
      qp.set("projectId", String(Math.trunc(Number(projectIdFromQuery))));
    }
    return `/cavcode?${qp.toString()}`;
  }, [activeFile?.path, projectIdFromQuery]);

  const resolveWorkspaceFilePathForAi = useCallback((rawFilePath: string): string | null => {
    const raw = String(rawFilePath || "").trim();
    if (!raw) return null;

    const normalizedRaw = normalizePath(raw);
    if (normalizedRaw !== "/") {
      const directNode = findNodeByPath(fs, normalizedRaw);
      if (directNode && isFile(directNode)) return directNode.path;
    }

    const activeRootPath = activeProjectRoot ? normalizePath(activeProjectRoot.path) : null;
    const relativeRaw = raw.replace(/^\/+/, "");
    if (activeRootPath && relativeRaw) {
      const rootedCandidate = normalizePath(joinPath(activeRootPath, relativeRaw));
      const rootedNode = findNodeByPath(fs, rootedCandidate);
      if (rootedNode && isFile(rootedNode)) return rootedNode.path;
    }

    const targetLeaf = raw.split("/").filter(Boolean).pop()?.toLowerCase() || "";
    if (!targetLeaf) return null;

    const scopedFiles = cavAiProjectFiles.filter((file) =>
      activeRootPath ? normalizePath(file.path).startsWith(`${activeRootPath}/`) : true
    );
    const exactLeafMatches = scopedFiles.filter((file) => file.name.toLowerCase() === targetLeaf);
    if (exactLeafMatches.length === 1) return exactLeafMatches[0].path;
    return null;
  }, [activeProjectRoot, cavAiProjectFiles, fs]);

  const openWorkspaceFileByPathForAi = useCallback((rawFilePath: string) => {
    const resolvedPath = resolveWorkspaceFilePathForAi(rawFilePath);
    if (!resolvedPath) return false;
    const target = findNodeByPath(fs, resolvedPath);
    if (!target || !isFile(target)) return false;
    openFile(target);
    return true;
  }, [fs, openFile, resolveWorkspaceFilePathForAi]);

  const uploadWorkspaceFilesFromCaven = useCallback(async (rawFiles: File[]): Promise<CavenWorkspaceUploadFileRef[]> => {
    const files = Array.isArray(rawFiles) ? rawFiles : [];
    if (!files.length) return [];

    const updated = safeClone(fs);
    const fallbackRoot =
      activeProjectRoot
      || fs.children.find((child): child is FolderNode => isFolder(child) && isUserWorkspacePath(child.path))
      || null;
    const importBaseFolderPath = fallbackRoot ? normalizePath(fallbackRoot.path) : null;
    const targetFolder = importBaseFolderPath ? ensureFolderPath(updated, importBaseFolderPath) : updated;

    const uploaded: CavenWorkspaceUploadFileRef[] = [];
    const failedUploads: string[] = [];
    for (const file of files.slice(0, 120)) {
      const requestedName = String(file.name || "").trim() || `upload-${Date.now().toString(36)}.txt`;
      const safeFolderPath = "/Caven Uploads";
      let cavcloudFileId = "";
      let cavcloudPath = "";
      let cavcloudSnippet = "";
      try {
        const form = new FormData();
        form.set("file", file, requestedName);
        form.set("name", requestedName);
        const uploadRes = await fetch(`/api/cavcloud/files/upload?folderPath=${encodeURIComponent(safeFolderPath)}`, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: {
            "x-cavbot-csrf": "1",
          },
          body: form,
        });
        const uploadBody = (await uploadRes.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          file?: {
            id?: unknown;
            path?: unknown;
            previewSnippet?: unknown;
          } | null;
        };
        cavcloudFileId = String(uploadBody.file?.id || "").trim();
        cavcloudPath = String(uploadBody.file?.path || "").trim();
        cavcloudSnippet = String(uploadBody.file?.previewSnippet || "").replace(/\u0000/g, "").slice(0, 8_000);
        if (!uploadRes.ok || uploadBody.ok !== true || !cavcloudFileId) {
          throw new Error(String(uploadBody.message || "Upload to CavCloud failed."));
        }
      } catch {
        failedUploads.push(requestedName);
        continue;
      }

      const uniqueName = ensureUniqueName(targetFolder, requestedName);
      let content = "";
      if (isProbablyTextFile(uniqueName)) {
        try {
          content = await file.text();
        } catch {
          content = cavcloudSnippet || "";
        }
      } else {
        content = `/* Binary file: ${uniqueName}\n * Uploaded from Caven composer.\n */\n`;
      }

      const created = upsertFileInFolder(targetFolder, uniqueName, content);
      uploaded.push({
        id: created.id,
        cavcloudFileId: cavcloudFileId || null,
        cavcloudPath: cavcloudPath || null,
        path: created.path,
        name: created.name,
        lang: created.lang,
        mimeType: String(file.type || "").trim() || null,
        sizeBytes: Math.max(1, Math.trunc(Number(file.size) || 1)),
        snippet: cavcloudSnippet || null,
      });
    }

    if (!uploaded.length) {
      throw new Error("Caven could not upload files to CavCloud.");
    }
    if (failedUploads.length) {
      pushToast(`${failedUploads.length} file upload${failedUploads.length === 1 ? "" : "s"} failed in CavCloud.`, "watch");
    }

    let nextActiveRootPath = importBaseFolderPath;
    if (!nextActiveRootPath) {
      const firstUserRoot = updated.children.find((child): child is FolderNode => isFolder(child) && isUserWorkspacePath(child.path));
      nextActiveRootPath = firstUserRoot ? normalizePath(firstUserRoot.path) : null;
    }

    setFS(updated);
    if (nextActiveRootPath) {
      const rootNode = findNodeByPath(updated, nextActiveRootPath);
      if (rootNode && isFolder(rootNode)) {
        setOpenFolders((prev) => ({ ...prev, root: true, [rootNode.id]: true }));
        setActiveProjectRootPath(nextActiveRootPath);
      } else {
        setOpenFolders((prev) => ({ ...prev, root: true }));
      }
    } else {
      setOpenFolders((prev) => ({ ...prev, root: true }));
    }

    const lastUploadedId = String(uploaded[uploaded.length - 1]?.id || "").trim();
    if (lastUploadedId) {
      setSelectedId(lastUploadedId);
      setActiveFileId(lastUploadedId);
      setActivePane("primary");
    }

    let codebasePersistFailure = false;
    for (const row of uploaded) {
      const targetPath = normalizePath(String(row.path || ""));
      if (!targetPath.startsWith("/codebase/")) continue;
      const node = findNodeByPath(updated, targetPath);
      if (!node || !isFile(node)) continue;
      const saved = await saveCodebaseFileToServer(targetPath, String(node.content || ""));
      if (!saved) {
        codebasePersistFailure = true;
        continue;
      }
      hydratedCodebasePathsRef.current.add(targetPath);
    }
    if (uploaded.some((row) => normalizePath(String(row.path || "")).startsWith("/codebase/"))) {
      void syncCodebaseFsFromServer({ silent: true });
    }
    if (codebasePersistFailure) {
      pushToast("Some uploaded files could not be saved to codebase storage.", "bad");
    }

    return uploaded;
  }, [activeProjectRoot, fs, pushToast, saveCodebaseFileToServer, syncCodebaseFsFromServer]);

  const openCavenSkillsTab = useCallback((view: SkillsPageView = "agents") => {
    const nextSkillsTab = toSkillsTab(view);
    setSkillsPageView(view);
    setTabs((prev) => {
      const at = prev.findIndex((tab) => tab.id === CAVCODE_SKILLS_TAB_ID || tab.kind === "skills");
      if (at < 0) return [...prev, nextSkillsTab];
      const current = prev[at];
      if (
        current.id === nextSkillsTab.id
        && current.path === nextSkillsTab.path
        && current.name === nextSkillsTab.name
        && current.lang === nextSkillsTab.lang
        && current.kind === nextSkillsTab.kind
      ) {
        return prev;
      }
      const next = [...prev];
      next[at] = nextSkillsTab;
      return next;
    });
    setActiveFileId(CAVCODE_SKILLS_TAB_ID);
    setActivePane("primary");
    setSidebarOpen(true);
    setActivity("ai");
  }, []);
  const openCavenAgentsTab = useCallback(() => {
    openCavenSkillsTab("agents");
  }, [openCavenSkillsTab]);
  const openCavenGeneralTab = useCallback(() => {
    openCavenSkillsTab("general");
  }, [openCavenSkillsTab]);
  const openCavenIdeSettingsTab = useCallback(() => {
    openCavenSkillsTab("ide");
  }, [openCavenSkillsTab]);
  const openCavenConfigTomlTab = useCallback(() => {
    setFS((prev) =>
      upsertSystemVirtualFiles(prev, {
        profileReadmeMarkdown: sysProfileReadme.loaded ? sysProfileReadme.markdown : "",
        cavenConfigToml,
      })
    );
    const configTab: Tab = {
      id: SYS_CAVEN_CONFIG_ID,
      path: SYS_CAVEN_CONFIG_PATH,
      name: "config.toml",
      lang: "toml",
      kind: "file",
    };
    setTabs((prev) => {
      if (prev.some((tab) => tab.id === SYS_CAVEN_CONFIG_ID)) return prev;
      return [...prev, configTab];
    });
    setActivity("explorer");
    setSidebarOpen(true);
    setOpenFolders((prev) => ({ ...prev, [SYS_ROOT_ID]: true, [SYS_CAVEN_ID]: true }));
    setSelectedId(SYS_CAVEN_CONFIG_ID);
    setActiveFileId(SYS_CAVEN_CONFIG_ID);
    setActivePane("primary");
  }, [cavenConfigToml, sysProfileReadme.loaded, sysProfileReadme.markdown]);

  const applyAiProposedCodeToWorkspaceFile = useCallback(async (args: { filePath: string; code: string }) => {
    const resolvedPath = resolveWorkspaceFilePathForAi(args.filePath);
    if (!resolvedPath) {
      pushToast("CavAi could not resolve the target file in the active project.", "bad");
      return false;
    }

    let targetFileId = "";
    let targetBaselineHash = "";
    const nextContent = String(args.code || "");
    setFS((prev) => {
      const hit = findNodeByPath(prev, resolvedPath);
      if (!hit || !isFile(hit)) return prev;
      targetFileId = hit.id;
      targetBaselineHash = ensureSavedHashForFile(hit);
      return replaceNode(prev, {
        ...hit,
        content: nextContent,
      });
    });

    if (!targetFileId) {
      pushToast("CavAi patch target is missing from workspace.", "bad");
      return false;
    }

    setSelectedId(targetFileId);
    setActiveFileId(targetFileId);
    applyDirtyStateForFile(targetFileId, targetBaselineHash, nextContent);

    if (resolvedPath.startsWith("/codebase/")) {
      const persisted = await saveCodebaseFileToServer(resolvedPath, nextContent);
      if (!persisted) {
        pushToast("CavAi applied locally, but saving to codebase failed.", "bad");
        return false;
      }
      markFileSaved(targetFileId, nextContent);
      hydratedCodebasePathsRef.current.add(normalizePath(resolvedPath));
      void syncCodebaseFsFromServer({ silent: true });
    }

    pushToast(`Applied CavAi patch to ${resolvedPath}.`, "good");
    return true;
  }, [
    applyDirtyStateForFile,
    ensureSavedHashForFile,
    markFileSaved,
    pushToast,
    resolveWorkspaceFilePathForAi,
    saveCodebaseFileToServer,
    syncCodebaseFsFromServer,
  ]);

  useEffect(() => {
    bootTimerRef.current = window.setTimeout(() => {
      if (!didMountRef.current) setBootFailed(true);
    }, 4000);
    return () => {
      if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
      bootTimerRef.current = null;
    };
  }, []);

  /* =========================
    Desktop gate
  ========================= */
  useEffect(() => {
    const check = () => setIsDesktop(window.matchMedia("(min-width: 980px)").matches);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  /* =========================
    Auth bootstrap (for System virtual files)
  ========================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const j = (await res.json().catch(() => null)) as unknown;
        if (!alive) return;
        const r = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
        if (!r || r.ok !== true || r.authenticated !== true) return;
        const u = r.user && typeof r.user === "object" ? (r.user as Record<string, unknown>) : null;
        const account = r.account && typeof r.account === "object" ? (r.account as Record<string, unknown>) : null;
        const authPlanId = normalizePlanId(account?.tierEffective ?? account?.tier);
        const userId = String(u?.id || "").trim();
        const username = String(u?.username || "").trim().toLowerCase();
        const displayName = String(u?.displayName || username || "Operator").trim() || "Operator";
        const initials = String(u?.initials || "").trim();
        const avatarTone = String(u?.avatarTone || "").trim().toLowerCase();
        const avatarImage = String(u?.avatarImage || "").trim();
        if (!userId) return;
        setMe({ userId, username, displayName });
        setProfileFullName(displayName);
        setProfileUsername(username);
        setAvatarInitials(deriveAccountInitials(displayName, username, initials));
        if (displayName) setOperatorName(displayName);
        if (avatarTone) setProfileTone(avatarTone);
        if (avatarImage || avatarImage === "") setAvatarUrl(avatarImage);
        if (typeof u?.publicProfileEnabled === "boolean") {
          setProfilePublicEnabled(u.publicProfileEnabled);
        }
        setAccountPlanId((prev) => (planTierRank(authPlanId) >= planTierRank(prev) ? authPlanId : prev));
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* =========================
    Load workspace snapshot (server-authoritative)
  ========================= */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const snapshot = await fetchWorkspaceSnapshotFromServer();

      const next = snapshot || {
        version: 2 as const,
        fs: seedFS(),
        tabs: [] as Tab[],
        activeFileId: "",
        activeProjectRootPath: null,
      };

      const fsRoot = next.fs && next.fs.kind === "folder" ? next.fs : seedFS();
      const tabsNormalized = normalizeTabsForWorkspace(fsRoot, next.tabs);

      let activeId = String(next.activeFileId || "").trim();
      const activeCandidate = activeId ? findNode(fsRoot, activeId) : null;
      const activeIsSkillsTab = activeId === CAVCODE_SKILLS_TAB_ID
        && tabsNormalized.some((tab) => tab.id === CAVCODE_SKILLS_TAB_ID);
      if (!activeIsSkillsTab && !(activeCandidate && isFile(activeCandidate))) activeId = "";
      if (!activeId) {
        activeId = firstFileId(fsRoot) || "";
      }

      const snapshotRootPath = String(next.activeProjectRootPath || "").trim();
      let nextActiveProjectRootPath: string | null = null;
      if (snapshotRootPath) {
        const rootNode = findNodeByPath(fsRoot, snapshotRootPath);
        if (rootNode && isFolder(rootNode) && isUserWorkspacePath(rootNode.path)) {
          nextActiveProjectRootPath = normalizePath(rootNode.path);
        }
      }

      if (!nextActiveProjectRootPath) {
        const topLevelUserFolders = fsRoot.children.filter((child) => isFolder(child) && isUserWorkspacePath(child.path));
        if (topLevelUserFolders.length === 1) {
          nextActiveProjectRootPath = normalizePath(topLevelUserFolders[0].path);
        }
      }

      let finalTabs = tabsNormalized;
      if (activeId && !finalTabs.some((tab) => tab.id === activeId)) {
        const activeFile = findFileById(fsRoot, activeId);
        if (activeFile && !isSystemPath(activeFile.path)) {
          finalTabs = [
            ...finalTabs,
            {
              id: activeFile.id,
              path: activeFile.path,
              name: activeFile.name,
              lang: activeFile.lang,
              kind: "file",
            },
          ];
        }
      }

      if (cancelled) return;

      const nextSavedHashes: Record<string, string> = {};
      walk(fsRoot, (node) => {
        if (!isFile(node)) return;
        nextSavedHashes[node.id] = hashString(String(node.content ?? ""));
      });
      savedFileHashByIdRef.current = nextSavedHashes;
      setModifiedFileIds(() => new Set());

      setFS(fsRoot);
      setTabs(finalTabs);
      setActiveFileId(activeId);
      setActiveProjectRootPath(nextActiveProjectRootPath);
      setFsReady(true);

      const fsWithoutSystem = stripSystemNodes(fsRoot);
      const baselineSnapshot: CavCodeWorkspaceSnapshot = {
        version: 2,
        fs: fsWithoutSystem,
        tabs: normalizeTabsForWorkspace(fsWithoutSystem, finalTabs),
        activeFileId: activeId,
        activeProjectRootPath: nextActiveProjectRootPath || null,
      };
      workspaceSnapshotLastHashRef.current = hashString(JSON.stringify(baselineSnapshot));
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchWorkspaceSnapshotFromServer, persistWorkspaceSnapshotToServer]);

  /* =========================
    System/Profile/README.md load + inject
  ========================= */
  useEffect(() => {
    if (!me?.username) return;
    let alive = true;
    (async () => {
      try {
        const u = encodeURIComponent(me.username);
        const res = await fetch(`/api/profile/readme?username=${u}`, { credentials: "include" });
        const j = (await res.json().catch(() => null)) as unknown;
        const r = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
        const revisionRaw = Number(r?.revision);
        const revision =
          Number.isFinite(revisionRaw) && Number.isInteger(revisionRaw) && revisionRaw >= 0
            ? Math.trunc(revisionRaw)
            : 0;
        const rawMd = r && r.ok === true && typeof r.markdown === "string" ? (r.markdown as string) : "";
        const md =
          String(rawMd || "").trim()
            ? String(rawMd)
            : defaultProfileReadmeMarkdown(me.displayName);
        if (!alive) return;
        sysAutosaveRef.current.lastSavedHash = hashString(md);
        sysAutosaveRef.current.lastSavedRevision = revision;
        setSysProfileReadme({ markdown: md, loaded: true, revision });
        publishSysProfileReadme(md, revision);
      } catch {
        if (!alive) return;
        const md = defaultProfileReadmeMarkdown(me.displayName);
        sysAutosaveRef.current.lastSavedHash = hashString(md);
        sysAutosaveRef.current.lastSavedRevision = 0;
        setSysProfileReadme({ markdown: md, loaded: true, revision: 0 });
        publishSysProfileReadme(md, 0);
      }
    })();
    return () => {
      alive = false;
    };
  }, [me?.username, me?.displayName]);

  useEffect(() => {
    if (!fsReady) return;
    const profileMarkdown = String(sysProfileReadme.markdown || "").trim()
      ? sysProfileReadme.markdown
      : defaultProfileReadmeMarkdown(me?.displayName || "Operator");
    const needsSystemRoot = !findNodeByPath(fs, SYS_ROOT_PATH);
    const needsReadmeNode = !findNodeByPath(fs, SYS_README_PATH);
    const needsConfigNode = !findNodeByPath(fs, SYS_CAVEN_CONFIG_PATH);
    if (!needsSystemRoot && !needsReadmeNode && !needsConfigNode) return;
    setFS((prev) =>
      upsertSystemVirtualFiles(prev, {
        profileReadmeMarkdown: profileMarkdown,
        cavenConfigToml,
      })
    );
    setOpenFolders((p) => ({ ...p, [SYS_ROOT_ID]: true, [SYS_PROFILE_ID]: true, [SYS_CAVEN_ID]: true }));
  }, [cavenConfigToml, fs, fsReady, me?.displayName, sysProfileReadme.markdown]);

  /* =========================
    Deep link: /cavcode?sys=profile-readme
  ========================= */
  useEffect(() => {
    if (!isClient) return;
    if (!fsReady) return;
    if (!sysProfileReadme.loaded) return;
    if (sysOpenRef.current) return;

    try {
      const sp = new URLSearchParams(window.location.search);
      const sys = String(sp.get("sys") || "").trim();
      if (sys !== "profile-readme") return;

      const node = findNodeByPath(fs, SYS_README_PATH);
      if (!node || !isFile(node)) return;

      sysOpenRef.current = true;
      setActivity("explorer");
      setOpenFolders((p) => ({ ...p, root: true, [SYS_ROOT_ID]: true, [SYS_PROFILE_ID]: true }));
      openFile(node);
      window.setTimeout(() => editorRef.current?.focus?.(), 0);
    } catch {}
  }, [isClient, fsReady, sysProfileReadme.loaded, fs, openFile]);

  /* =========================
    Deep link: /cavcode?file=/path/to/file
    - Supports cloud links (`cloud=1`) and direct CavCode links.
    - Supports optional cursor targeting (`line` / `col`).
  ========================= */
  useEffect(() => {
    if (!isClient) return;
    if (!fsReady) return;

    const sp = new URLSearchParams(window.location.search);
    const keepAiOpen = shouldOpenCavAiSurface(sp);
    const cloudFlag = String(sp.get("cloud") || "").trim().toLowerCase();
    const fileParam = String(sp.get("file") || "").trim();
    const cloudMode = cloudFlag === "1" || cloudFlag === "true";
    if (!fileParam) return;

    const requestedPathRaw = normalizePath(fileParam);
    if (requestedPathRaw === "/") return;
    const requestedCodebasePath =
      requestedPathRaw === "/cavcode" || requestedPathRaw.startsWith("/cavcode/")
        ? toCodebasePathFromCavcode(requestedPathRaw)
        : requestedPathRaw === "/codebase" || requestedPathRaw.startsWith("/codebase/")
          ? normalizePath(requestedPathRaw)
          : null;
    const requestedWorkspacePath = requestedCodebasePath || requestedPathRaw;
    const editorPosition = readDeepLinkEditorPosition(sp);

    const requestKey = [
      cloudFlag || "0",
      requestedPathRaw,
      editorPosition?.line || "",
      editorPosition?.col || "",
    ].join(":");
    if (cloudOpenRef.current === requestKey) return;
    cloudOpenRef.current = requestKey;

    let cancelled = false;

    const focusEditorPosition = (position: DeepLinkEditorPosition | null) => {
      if (!position || cancelled) return;
      let tries = 0;
      const maxTries = 8;

      const apply = () => {
        if (cancelled) return;
        const ed = editorRef.current;
        if (!ed) {
          if (tries < maxTries) {
            tries += 1;
            window.setTimeout(apply, 40);
          }
          return;
        }
        try {
          ed.revealPositionInCenter({
            lineNumber: Math.max(1, position.line),
            column: Math.max(1, position.col),
          });
          ed.setPosition({
            lineNumber: Math.max(1, position.line),
            column: Math.max(1, position.col),
          });
          ed.focus();
        } catch {
          if (tries < maxTries) {
            tries += 1;
            window.setTimeout(apply, 40);
          }
        }
      };

      window.setTimeout(apply, 0);
    };

    const focusFile = (fileId: string) => {
      if (!fileId || cancelled) return;
      setActivity(keepAiOpen ? "ai" : "explorer");
      if (keepAiOpen) setSidebarOpen(true);
      setSelectedId(fileId);
      setActiveFileId(fileId);
      focusEditorPosition(editorPosition);
    };

    const upsertAtPath = (path: string, content: string): string => {
      const rel = splitRelPath(path.replace(/^\/+/, ""));
      if (!rel.length) return "";
      let openedId = "";
      setFS((prev) => {
        const existing = findNodeByPath(prev, path);
        if (existing && isFile(existing)) {
          openedId = existing.id;
          return prev;
        }
        const updated = safeClone(prev);
        const ensureChildFolder = (parent: FolderNode, segName: string): FolderNode => {
          const hit = parent.children.find((child) => isFolder(child) && child.name.toLowerCase() === segName.toLowerCase());
          if (hit && isFolder(hit)) {
            hit.path = joinPath(parent.path, hit.name);
            return hit;
          }
          const created: FolderNode = {
            id: uid("f"),
            kind: "folder",
            name: segName,
            path: joinPath(parent.path, segName),
            children: [],
          };
          parent.children.push(created);
          return created;
        };

        let folder = updated;
        for (let i = 0; i < rel.length - 1; i++) {
          folder = ensureChildFolder(folder, rel[i]);
        }

        const fileName = rel[rel.length - 1];
        const filePath = joinPath(folder.path, fileName);
        const fileHit = folder.children.find((child) => isFile(child) && child.name.toLowerCase() === fileName.toLowerCase());
        if (fileHit && isFile(fileHit)) {
          fileHit.path = filePath;
          fileHit.content = String(content || "");
          fileHit.lang = inferLang(fileHit.name);
          openedId = fileHit.id;
          return updated;
        }

        const created: FileNode = {
          id: uid("file"),
          kind: "file",
          name: fileName,
          path: filePath,
          lang: inferLang(fileName),
          content: String(content || ""),
        };
        folder.children.push(created);
        openedId = created.id;
        return updated;
      });
      return openedId;
    };

    const openExistingWorkspaceFile = (path: string): boolean => {
      const node = findNodeByPath(fs, path);
      if (!node || !isFile(node)) return false;
      focusFile(node.id);
      return true;
    };

    const openCodebaseFileFromSnapshot = (path: string): boolean => {
      let openedId = "";
      setFS((prev) => {
        const updated = upsertCodebaseFolderIntoWorkspace(safeClone(prev), codebaseFsRef.current);
        const node = findNodeByPath(updated, path);
        if (node && isFile(node)) {
          openedId = node.id;
        }
        return updated;
      });
      if (!openedId) return false;
      void hydrateCodebaseFileFromServer(path, true);
      focusFile(openedId);
      return true;
    };

    const fetchCloudTextByPath = async (path: string): Promise<string | null> => {
      const endpoints = ["/api/cavcloud/files/by-path", "/api/cavsafe/files/by-path"];
      for (const endpoint of endpoints) {
        try {
          const res = await fetch(`${endpoint}?path=${encodeURIComponent(path)}&raw=1`, {
            method: "GET",
            cache: "no-store",
          });
          if (!res.ok) continue;
          const length = Number(res.headers.get("content-length") || "");
          if (Number.isFinite(length) && length > 2 * 1024 * 1024) continue;
          const contentType = String(res.headers.get("content-type") || "").toLowerCase();
          if (!isTextContentType(contentType) && !isProbablyTextFile(path)) continue;
          const body = await res.text();
          if (body.includes("\u0000")) continue;
          return body;
        } catch {}
      }
      return null;
    };

    void (async () => {
      if (requestedCodebasePath) {
        if (openExistingWorkspaceFile(requestedWorkspacePath)) return;
        if (openCodebaseFileFromSnapshot(requestedWorkspacePath)) return;
        await syncCodebaseFsFromServer({ silent: true });
        if (cancelled) return;
        if (openCodebaseFileFromSnapshot(requestedWorkspacePath)) return;
        pushToast(`Could not open ${requestedPathRaw} in CavCode.`, "watch");
        return;
      }

      if (openExistingWorkspaceFile(requestedWorkspacePath)) return;
      if (!cloudMode) {
        pushToast(`File not found in current workspace: ${requestedPathRaw}`, "watch");
        return;
      }

      const remoteText = await fetchCloudTextByPath(requestedPathRaw);
      if (cancelled || remoteText == null) {
        if (!cancelled) pushToast("Could not open that cloud file in CavCode.", "watch");
        return;
      }

      const openedId = upsertAtPath(requestedWorkspacePath, remoteText);
      if (openedId) {
        focusFile(openedId);
        return;
      }

      pushToast("Could not open that cloud file in CavCode.", "watch");
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isClient,
    fsReady,
    fs,
    hydrateCodebaseFileFromServer,
    syncCodebaseFsFromServer,
    pushToast,
  ]);

  /* =========================
    Persist
  ========================= */
  useEffect(() => {
    if (!fsReady) return;
    const fsSnapshot = stripSystemNodes(fs);
    const tabsSnapshot = normalizeTabsForWorkspace(fsSnapshot, tabs);
    const activeFileInScope = tabsSnapshot.some((tab) => tab.id === activeFileId) ? activeFileId : "";
    const rootNode = activeProjectRootPath ? findNodeByPath(fsSnapshot, activeProjectRootPath) : null;
    const activeProjectRootPathInScope =
      rootNode && isFolder(rootNode) && isUserWorkspacePath(rootNode.path) ? normalizePath(rootNode.path) : null;

    const snapshot: CavCodeWorkspaceSnapshot = {
      version: 2,
      fs: fsSnapshot,
      tabs: tabsSnapshot,
      activeFileId: activeFileInScope,
      activeProjectRootPath: activeProjectRootPathInScope,
    };
    const snapshotHash = hashString(JSON.stringify(snapshot));
    if (snapshotHash === workspaceSnapshotLastHashRef.current) return;

    if (workspaceSnapshotSaveTimerRef.current) {
      window.clearTimeout(workspaceSnapshotSaveTimerRef.current);
      workspaceSnapshotSaveTimerRef.current = null;
    }

    workspaceSnapshotSaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const ok = await persistWorkspaceSnapshotToServer(snapshot);
        if (ok) {
          workspaceSnapshotLastHashRef.current = snapshotHash;
        }
      })();
    }, CAVCODE_WORKSPACE_STATE_SAVE_DEBOUNCE_MS);

    return () => {
      if (workspaceSnapshotSaveTimerRef.current) {
        window.clearTimeout(workspaceSnapshotSaveTimerRef.current);
        workspaceSnapshotSaveTimerRef.current = null;
      }
    };
  }, [activeFileId, activeProjectRootPath, fs, fsReady, persistWorkspaceSnapshotToServer, tabs]);

  useEffect(() => {
    if (!fsReady) return;

    if (!settings.syncToCavcloud) {
      if (cavcloudSyncTimerRef.current) {
        window.clearTimeout(cavcloudSyncTimerRef.current);
        cavcloudSyncTimerRef.current = null;
      }
      cavcloudSyncedSignatureRef.current.clear();
      return;
    }

    const snapshot = listFiles(stripSystemNodes(fs))
      .filter((file) => !isLocalOnlySystemPath(file.path))
      .map((file) => {
        const fullPath = normalizePath(file.path);
        const relativePath = fullPath.replace(/^\/+/, "");
        const slash = relativePath.lastIndexOf("/");
        const name = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
        const folderRel = slash >= 0 ? relativePath.slice(0, slash) : "";
        const folderPath = folderRel ? `/Synced/CavCode/${folderRel}` : "/Synced/CavCode";
        return {
          path: fullPath,
          name,
          folderPath,
          content: String(file.content || ""),
          signature: quickStringSignature(file.content),
        };
      })
      .filter((item) => Boolean(item.name))
      .sort((a, b) => a.path.localeCompare(b.path));

    const nextSignatures = new Map(snapshot.map((item) => [item.path, item.signature]));
    const changed = snapshot.filter((item) => cavcloudSyncedSignatureRef.current.get(item.path) !== item.signature);

    if (!changed.length) {
      cavcloudSyncedSignatureRef.current = nextSignatures;
      return;
    }

    cavcloudSyncRevisionRef.current += 1;
    const revision = cavcloudSyncRevisionRef.current;

    if (cavcloudSyncTimerRef.current) {
      window.clearTimeout(cavcloudSyncTimerRef.current);
      cavcloudSyncTimerRef.current = null;
    }

    cavcloudSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        let synced = 0;
        let failed = 0;
        const merged = new Map(cavcloudSyncedSignatureRef.current);

        for (const item of changed) {
          try {
            await upsertCavcloudTextFile({
              folderPath: item.folderPath,
              name: item.name,
              mimeType: inferSyncMimeType(item.name),
              content: item.content,
              source: "cavcode",
            });
            merged.set(item.path, item.signature);
            synced += 1;
          } catch {
            failed += 1;
          }
        }

        if (revision !== cavcloudSyncRevisionRef.current) return;

        cavcloudSyncedSignatureRef.current = failed === 0 ? nextSignatures : merged;
        if (failed > 0) {
          pushToast(`CavCloud sync incomplete (${failed} file${failed === 1 ? "" : "s"} failed).`, "bad");
        } else if (synced > 0) {
          window.dispatchEvent(new Event("cb:workspace"));
        }
      })();
    }, 1100);

    return () => {
      if (cavcloudSyncTimerRef.current) {
        window.clearTimeout(cavcloudSyncTimerRef.current);
        cavcloudSyncTimerRef.current = null;
      }
    };
  }, [fs, fsReady, pushToast, settings.syncToCavcloud]);

  useEffect(() => {
    if (!fsReady) return;
    void syncCodebaseFsFromServer({ silent: true });

    const intervalId = window.setInterval(() => {
      void syncCodebaseFsFromServer({ silent: true });
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [fsReady, syncCodebaseFsFromServer]);

  useEffect(() => {
    codebaseFsRef.current = codebaseFs;
  }, [codebaseFs]);

  useEffect(() => {
    if (!fsReady) return;
    setFS((prev) => upsertCodebaseFolderIntoWorkspace(prev, codebaseFs));
  }, [codebaseFs, fsReady]);

  useEffect(() => {
    if (!activeFile?.path || !activeFile.path.startsWith("/codebase/")) return;
    void hydrateCodebaseFileFromServer(activeFile.path);
  }, [activeFile?.path, hydrateCodebaseFileFromServer]);

  useEffect(() => {
    if (!settingsBootstrappedRef.current) return;
    const nextHash = quickStringSignature(JSON.stringify(settings));
    if (nextHash === settingsPersistedHashRef.current) return;

    if (settingsPersistTimerRef.current) {
      window.clearTimeout(settingsPersistTimerRef.current);
      settingsPersistTimerRef.current = null;
    }

    settingsPersistTimerRef.current = window.setTimeout(() => {
      void (async () => {
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
              editorSettings: settings,
            }),
          });
          if (!res.ok) return;
          settingsPersistedHashRef.current = nextHash;
        } catch {
          // Best effort only.
        }
      })();
    }, 280);

    return () => {
      if (settingsPersistTimerRef.current) {
        window.clearTimeout(settingsPersistTimerRef.current);
        settingsPersistTimerRef.current = null;
      }
    };
  }, [settings]);

  /* =========================
    Tabs ensure active exists
  ========================= */
  useEffect(() => {
    if (!activeFile) return;
    setTabs((prev) => {
      if (prev.some((t) => t.id === activeFile.id)) return prev;
      return [...prev, { id: activeFile.id, path: activeFile.path, name: activeFile.name, lang: activeFile.lang, kind: "file" }];
    });
  }, [activeFile]);

  useEffect(() => {
    if (splitLayout === "single") {
      if (activePane === "secondary") setActivePane("primary");
      return;
    }

    const hasSecondaryFile = secondaryFileId ? Boolean(findFileById(fs, secondaryFileId)) : false;
    if (hasSecondaryFile) return;

    const activeAsFile = activeFileId ? findFileById(fs, activeFileId) : null;
    const fallbackTab = tabs
      .slice()
      .reverse()
      .find((tab) => Boolean(findFileById(fs, tab.id)));
    const fallbackId = activeAsFile?.id || fallbackTab?.id || "";
    setSecondaryFileId(fallbackId);
    if (!fallbackId && activePane === "secondary") {
      setActivePane("primary");
    }
  }, [activeFileId, activePane, fs, secondaryFileId, splitLayout, tabs]);

  /* =========================
    Profile avatar
  ========================= */
  useEffect(() => {
    const onProfile = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{
          fullName?: string;
          username?: string;
          initials?: string;
          avatarTone?: string;
          avatarImage?: string;
          publicProfileEnabled?: boolean;
        }>).detail;
        const fullName = String(detail?.fullName || "").trim();
        const username = String(detail?.username || "").trim().toLowerCase();
        const fallbackInitials = String(detail?.initials || "").trim();
        if (fullName) {
          setProfileFullName(fullName);
          setOperatorName(fullName);
        }
        if (username) setProfileUsername(username);
        if (fullName || username || fallbackInitials) {
          setAvatarInitials((prev) =>
            deriveAccountInitials(
              fullName || profileFullName,
              username || profileUsername,
              fallbackInitials || prev
            )
          );
        }
        const nextTone = String(detail?.avatarTone || "").trim().toLowerCase();
        if (nextTone) setProfileTone(nextTone);
        if (typeof detail?.avatarImage === "string") {
          setAvatarUrl(String(detail.avatarImage || "").trim());
        }
        if (typeof detail?.publicProfileEnabled === "boolean") {
          setProfilePublicEnabled(detail.publicProfileEnabled);
        }
      } catch {}
    };

    window.addEventListener("cb:profile", onProfile as EventListener);
    return () => {
      window.removeEventListener("cb:profile", onProfile as EventListener);
    };
  }, [profileFullName, profileUsername]);

  const accountInitials = useMemo(
    () => deriveAccountInitials(profileFullName, profileUsername, avatarInitials),
    [avatarInitials, profileFullName, profileUsername]
  );
  const publicProfileHref = useMemo(() => {
    return buildCanonicalPublicProfileHref(profileUsername);
  }, [profileUsername]);
  const profileMenuLabel = useMemo(() => {
    if (profilePublicEnabled === null) return "Profile";
    return profilePublicEnabled ? "Public Profile" : "Private Profile";
  }, [profilePublicEnabled]);

  /* =========================
    Profile menu: click-outside
  ========================= */
  useEffect(() => {
    if (!profileOpen) return;
    const onDown = (e: MouseEvent) => {
      const btn = profileBtnRef.current;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (btn && (btn === t || btn.contains(t))) return;

      const menu = document.getElementById("cc-profile-menu");
      if (menu && (menu === t || menu.contains(t))) return;

      setProfileOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [profileOpen]);

  /* =========================
    Context menu: click-outside + ESC
  ========================= */
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) { setCtxMenu(null); return; }
      const menu = document.getElementById("cc-ctx");
      if (menu && (menu === t || menu.contains(t))) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!panelViewMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setPanelViewMenuOpen(false);
        return;
      }
      const root = panelViewMenuRef.current;
      if (root && root.contains(target)) return;
      setPanelViewMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanelViewMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [panelViewMenuOpen]);

  useEffect(() => {
    if (!scmHeaderMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setScmHeaderMenuOpen(false);
        return;
      }
      const root = scmHeaderMenuRef.current;
      if (root && root.contains(target)) return;
      setScmHeaderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setScmHeaderMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [scmHeaderMenuOpen]);

  useEffect(() => {
    if (!changesHeaderMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setChangesHeaderMenuOpen(false);
        return;
      }
      const root = changesHeaderMenuRef.current;
      if (root && root.contains(target)) return;
      setChangesHeaderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChangesHeaderMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [changesHeaderMenuOpen]);

  useEffect(() => {
    if (!runHeaderMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setRunHeaderMenuOpen(false);
        return;
      }
      const root = runHeaderMenuRef.current;
      if (root && root.contains(target)) return;
      setRunHeaderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRunHeaderMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [runHeaderMenuOpen]);

  useEffect(() => {
    if (!panelOpen) setPanelViewMenuOpen(false);
  }, [panelOpen]);

  useEffect(() => {
    if (activity !== "scm") setScmHeaderMenuOpen(false);
  }, [activity]);

  useEffect(() => {
    if (activity !== "changes") setChangesHeaderMenuOpen(false);
  }, [activity]);

  useEffect(() => {
    if (activity !== "changes") setChangesCommitMenuOpen(false);
  }, [activity]);

  useEffect(() => {
    if (activity === "changes") return;
    setChangesCommitAiMenuOpen(false);
    setChangesCommitAiPromptOpen(false);
  }, [activity]);

  useEffect(() => {
    if (activity !== "run") setRunHeaderMenuOpen(false);
  }, [activity]);

  useEffect(() => {
    if (activity !== "explorer") setExplorerHeaderMenuOpen(false);
  }, [activity]);

  useEffect(() => {
    if (!changesCommitMenuOpen) return;
    setChangesCommitAiMenuOpen(false);
    setChangesCommitAiPromptOpen(false);
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setChangesCommitMenuOpen(false);
        return;
      }
      const root = changesCommitMenuRef.current;
      if (root && root.contains(target)) return;
      setChangesCommitMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChangesCommitMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [changesCommitMenuOpen]);

  useEffect(() => {
    if (!explorerHeaderMenuOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setExplorerHeaderMenuOpen(false);
        return;
      }
      const root = explorerHeaderMenuRef.current;
      if (root && root.contains(target)) return;
      setExplorerHeaderMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExplorerHeaderMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [explorerHeaderMenuOpen]);

  /* =========================
    Monaco: workspace model sync
  ========================= */
  const syncMonacoModels = useCallback((root: FolderNode, activeUriStr?: string) => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const files = listFiles(root);
    const wanted = new Set<string>();

    for (const f of files) {
      const uri = monaco.Uri.parse(fileUri(f.path));
      const uriStr = uri.toString();
      wanted.add(uriStr);

      const existing = monaco.editor.getModel(uri);
      if (!existing) {
        const model = monaco.editor.createModel(f.content, f.lang || "plaintext", uri);
        try {
          const l = String(f.lang || "").toLowerCase();
          if (l === "typescript" || l === "javascript") model.setEOL(monaco.editor.EndOfLineSequence.LF);
        } catch {}
      } else {
        try {
          const curLang = existing.getLanguageId?.() || "";
          if (f.lang && curLang !== f.lang && monaco.editor.setModelLanguage) {
            monaco.editor.setModelLanguage(existing, f.lang);
          }
        } catch {}

        try {
          // Avoid fighting the controlled MonacoEditor value prop for the active file.
          if (activeUriStr && uriStr === activeUriStr) continue;
          const cur = existing.getValue();
          if (cur !== f.content) existing.setValue(f.content);
        } catch {}
      }
    }

    try {
      const all = monaco.editor.getModels?.() || [];
      for (const m of all) {
        const u = m.uri?.toString?.() || "";
        if (u.startsWith("file://") && !wanted.has(u)) {
          try { m.dispose(); } catch {}
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!fsReady) return;
    if (!monacoRef.current) return;
    const activeUri = activeFile?.path ? fileUri(activeFile.path) : "";
    syncMonacoModels(fs, activeUri);
  }, [fs, fsReady, syncMonacoModels, activeFile?.path]);

  useEffect(() => {
    if (!fsReady) return;
    if (activeFile) return;
    if (didMountRef.current) return;
    window.requestAnimationFrame(() => setBooting(false));
  }, [fsReady, activeFile]);

  const runDiagnosticsSelfTest = useCallback(() => {
    let targetId: string | null = null;
    setFS((prev) => {
      const next = injectDiagnosticsSelfTestFiles(prev);
      const candidate = findNodeByPath(next, `${SELF_TEST_FOLDER_PATH}/ts-error.ts`);
      if (candidate && isFile(candidate)) {
        targetId = candidate.id;
      }
      return next;
    });
    setActivity("explorer");
    if (targetId) {
      setSelectedId(targetId);
      setActiveFileId(targetId);
    }
    pushToast("Diagnostics self-test workspace is ready.", "good");
    return {
      files: DIAGNOSTICS_SELF_TEST_FILES.map((f) => `${SELF_TEST_FOLDER_PATH}/${f.name}`),
    };
  }, [setFS, setSelectedId, setActiveFileId, setActivity, pushToast]);

  useEffect(() => {
    if (!isClient) return;
    type WindowWithSelfTest = Window & { __CAVCODE_SELF_TEST?: { run: () => unknown } };
    const win = window as WindowWithSelfTest;
    const payload = { run: runDiagnosticsSelfTest };
    win.__CAVCODE_SELF_TEST = payload;
    console.info("CavCode diagnostics self-test ready. Run window.__CAVCODE_SELF_TEST.run() in CavTools.");
    return () => {
      if (win.__CAVCODE_SELF_TEST === payload) {
        win.__CAVCODE_SELF_TEST = undefined;
      }
    };
  }, [isClient, runDiagnosticsSelfTest]);

  /* =========================
    Explorer actions
  ========================= */
  function cueFolderToggleBorder(folderId: string) {
    setFolderToggleCueId(folderId);
  }

  function toggleFolder(folderId: string) {
    setOpenFolders((p) => ({ ...p, [folderId]: !p[folderId] }));
  }

  function openFile(file: FileNode) {
    setSelectedId(file.id);
    if (splitLayout !== "single" && activePane === "secondary") {
      setSecondaryFileId(file.id);
      return;
    }
    setActivePane("primary");
    setActiveFileId(file.id);
  }

  function createIn(folderId: string, kind: "file" | "folder") {
    const requestedFolder = findNode(fs, folderId);
    if (!requestedFolder || !isFolder(requestedFolder)) return;
    const folder = requestedFolder.id === "root" && activeProjectRoot ? activeProjectRoot : requestedFolder;
    if (isSystemPath(folder.path)) {
      pushToast("System files are managed by CavBot.", "watch");
      return;
    }

    const baseName = kind === "folder" ? "new-folder" : "new-file.ts";
    const name = ensureUniqueName(folder, baseName);
    const path = joinPath(folder.path, name);

    const next: Node =
      kind === "folder"
        ? { id: uid("f"), kind: "folder", name, path, children: [] }
        : { id: uid("file"), kind: "file", name, path, lang: inferLang(name), content: "" };

    const updated = safeClone(fs);
    const parent = findNode(updated, folder.id) as FolderNode;
    parent.children = [...parent.children, next];
    setFS(updated);

    setOpenFolders((p) => ({ ...p, [folder.id]: true }));
    if (kind === "folder" && parent.id === "root") {
      setActiveProjectRootPath(path);
    }
    setSelectedId(next.id);

    if (kind === "file") openFile(next as FileNode);

    setRenamingId(next.id);
    setRenameValue(name);

    pushToast(kind === "file" ? "File created." : "Folder created.", "good");
  }

  function targetFolderForCreate(): string {
    const sel = selectedId ? findNode(fs, selectedId) : null;
    if (!sel) return activeProjectRoot?.id || "root";
    if (isFolder(sel)) {
      if (sel.id === "root" && activeProjectRoot) return activeProjectRoot.id;
      return sel.id;
    }
    const parent = findParentFolder(fs, sel.id);
    return parent?.id || activeProjectRoot?.id || "root";
  }

  function commitRename(id: string, nextNameRaw: string) {
    const nextName = String(nextNameRaw || "").trim();
    const node = findNode(fs, id);
    if (!node) return;
    if (isSystemPath(node.path)) {
      pushToast("System files cannot be renamed.", "watch");
      setRenamingId(null);
      setRenameValue("");
      return;
    }

    if (!nextName) {
      setRenamingId(null);
      setRenameValue("");
      return;
    }

    const parent = findParentFolder(fs, id) || fs;
    const unique = ensureUniqueName(parent, nextName);
    const nextPath = joinPath(parent.path, unique);

    if (isFile(node)) {
      const nextFile: FileNode = { ...node, name: unique, path: nextPath, lang: inferLang(unique) };
      setFS((prev) => replaceNode(prev, nextFile));
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, name: unique, path: nextPath, lang: nextFile.lang } : t)));
      pushToast("Renamed.", "good");
    } else {
      const nextFolder: FolderNode = safeClone(node);
      nextFolder.name = unique;
      nextFolder.path = nextPath;

      const rewrite = (f: FolderNode) => {
        f.children = f.children.map((c) => {
          if (isFolder(c)) {
            const nf = safeClone(c);
            nf.path = joinPath(f.path, nf.name);
            rewrite(nf);
            return nf;
          }
          const nf = safeClone(c);
          nf.path = joinPath(f.path, nf.name);
          nf.lang = inferLang(nf.name);
          return nf;
        });
      };
      rewrite(nextFolder);

      setFS((prev) => replaceNode(prev, nextFolder));
      pushToast("Renamed.", "good");
    }

    setRenamingId(null);
    setRenameValue("");
  }

  const deleteNode = useCallback(
    (id: string) => {
      const n = findNode(fs, id);
      if (!n) return;
      if (isSystemPath(n.path)) {
        pushToast("System files cannot be deleted.", "watch");
        return;
      }

      const doomed = new Set<string>();
      walk(n, (x) => doomed.add(x.id));
      for (const doomedId of doomed) {
        delete savedFileHashByIdRef.current[doomedId];
      }
      setModifiedFileIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const doomedId of doomed) {
          if (!next.delete(doomedId)) continue;
          changed = true;
        }
        return changed ? next : prev;
      });
      setTabs((prev) => prev.filter((t) => !doomed.has(t.id)));

      const nextFS = removeNode(fs, id);
      setFS(nextFS);

      setActiveFileId((prev) => {
        if (prev && !doomed.has(prev)) return prev;
        const first = firstFileId(nextFS);
        return first || "";
      });

      setSelectedId("root");
      pushToast("Deleted.", "watch");
    },
    [fs, pushToast]
  );

  function collapseAll() {
    setOpenFolders({ root: true });
    pushToast("Explorer collapsed.", "good");
  }

  function refreshExplorer() {
    pushToast("Explorer refreshed.", "good");
  }

  function shouldReplaceActiveProjectRoot(nextFolderName: string) {
    const incoming = String(nextFolderName || "").trim().toLowerCase();
    if (!incoming) return false;
    const existingUserRoots = fs.children.filter((child) => isFolder(child) && isUserWorkspacePath(child.path));
    if (!existingUserRoots.length) return false;
    if (activeProjectRoot) {
      return activeProjectRoot.name.trim().toLowerCase() !== incoming;
    }
    if (existingUserRoots.length > 1) return true;
    return existingUserRoots[0].name.trim().toLowerCase() !== incoming;
  }

  function confirmReplaceActiveProjectRoot(nextFolderName: string) {
    if (!shouldReplaceActiveProjectRoot(nextFolderName)) return true;
    const fallbackRoot = fs.children.find((child) => isFolder(child) && isUserWorkspacePath(child.path));
    const currentName = activeProjectRoot?.name || (fallbackRoot && isFolder(fallbackRoot) ? fallbackRoot.name : "Current folder");
    if (typeof window === "undefined") return false;
    return window.confirm(
      `Replace "${currentName}" with "${nextFolderName}"?\n\nThis keeps one active project folder open in CavCode.`
    );
  }

  /* =========================
    Import folders/files (Upload + Drag/Drop)
    - VS Code logic:
      • If an active folder is open, imported files are added into that folder context.
      • If you import a FOLDER while another folder is active, CavCode asks to replace it.
      • If no folder is active, importing a FOLDER creates the active project root.
      • If browser cannot give directory entries, we still detect folder via webkitRelativePath.
  ========================= */
  function getOrCreateFolderCaseInsensitive(parent: FolderNode, wantedName: string) {
    const hit = parent.children.find((c) => isFolder(c) && c.name.toLowerCase() === wantedName.toLowerCase()) as FolderNode | undefined;
    if (hit) return hit;

    const unique = ensureUniqueName(parent, wantedName);
    const created: FolderNode = {
      id: uid("f"),
      kind: "folder",
      name: unique,
      path: joinPath(parent.path, unique),
      children: [],
    };
    parent.children.push(created);
    return created;
  }

  function getOrCreateChildFolderCaseInsensitive(parent: FolderNode, segName: string) {
    const hit = parent.children.find((c) => isFolder(c) && c.name.toLowerCase() === segName.toLowerCase()) as FolderNode | undefined;
    if (hit) return hit;

    const created: FolderNode = {
      id: uid("f"),
      kind: "folder",
      name: segName,
      path: joinPath(parent.path, segName),
      children: [],
    };
    parent.children.push(created);
    return created;
  }

  function upsertFileInFolder(folder: FolderNode, fileName: string, content: string, handle?: FileSystemFileHandle | null) {
    const filePath = joinPath(folder.path, fileName);

    const existing = folder.children.find((c) => isFile(c) && c.name.toLowerCase() === fileName.toLowerCase()) as FileNode | undefined;
    if (existing) {
      existing.content = content;
      existing.lang = inferLang(fileName);
      existing.path = filePath;
      existing.fsHandle = handle ?? existing.fsHandle ?? null;
      return existing;
    }

    const created: FileNode = {
      id: uid("file"),
      kind: "file",
      name: fileName,
      path: filePath,
      lang: inferLang(fileName),
      content,
      fsHandle: handle ?? null,
    };
    folder.children.push(created);
    return created;
  }

  function applyRelPathIntoFS(
    root: FolderNode,
    opts: { topFolderName?: string | null; baseFolderPath?: string | null },
    relParts: string[],
    leaf: { content: string; handle?: FileSystemFileHandle | null }
  ): { topFolderId?: string } {
    // If topFolderName is provided => create/reuse that folder at root.
    // If topFolderName is null/undefined => file lands directly under root (no auto folder).
    let baseFolder: FolderNode = root;
    let topFolderId: string | undefined;

    if (opts.baseFolderPath) {
      baseFolder = ensureFolderPath(root, opts.baseFolderPath);
    }

    if (opts.topFolderName) {
      const top = getOrCreateFolderCaseInsensitive(baseFolder, opts.topFolderName);
      baseFolder = top;
      topFolderId = top.id;
    }

    let cur = baseFolder;

    for (let i = 0; i < relParts.length; i++) {
      const part = relParts[i];
      const isLast = i === relParts.length - 1;

      if (isLast) {
        upsertFileInFolder(cur, part, leaf.content, leaf.handle);
      } else {
        cur = getOrCreateChildFolderCaseInsensitive(cur, part);
        // Ensure path is consistent
        cur.path = joinPath(findParentFolder(root, cur.id)?.path || cur.path.split("/").slice(0, -1).join("/") || "/", cur.name);
      }
    }

    // Hard normalize paths for the branch we just created (ensures nested paths match)
    // This keeps model URIs stable.
    const normalizeBranch = (folder: FolderNode) => {
      folder.children = folder.children.map((c) => {
        if (isFolder(c)) {
          const nf = c;
          nf.path = joinPath(folder.path, nf.name);
          normalizeBranch(nf);
          return nf;
        }
        const nf = c;
        nf.path = joinPath(folder.path, nf.name);
        nf.lang = inferLang(nf.name);
        return nf;
      });
    };
    normalizeBranch(baseFolder);

    return { topFolderId };
  }

  async function importFromFileArray(files: File[], folderNameOrNull: string | null) {
    const arr = Array.from(files || []);
    if (!arr.length) return;

    const replaceActiveRoot = Boolean(folderNameOrNull && shouldReplaceActiveProjectRoot(folderNameOrNull));
    if (replaceActiveRoot && !confirmReplaceActiveProjectRoot(folderNameOrNull || "Folder")) {
      pushToast("Folder import canceled.", "watch");
      return;
    }

    const updated = replaceActiveRoot ? stripWorkspaceToSpecialRoots(safeClone(fs)) : safeClone(fs);
    const fallbackRoot =
      activeProjectRoot
      || fs.children.find((child): child is FolderNode => isFolder(child) && isUserWorkspacePath(child.path))
      || null;
    const activeRootPathAtImport = fallbackRoot ? normalizePath(fallbackRoot.path) : null;
    const importBaseFolderPath = !folderNameOrNull && activeRootPathAtImport ? activeRootPathAtImport : null;

    let imported = 0;
    let topFolderId: string | undefined;
    const createdFileIds: string[] = [];

    for (const f of arr.slice(0, 5000)) {
      // If folder upload (webkitRelativePath), first segment is folder name.
      // If folder import is expected, ONLY accept real folder files (must have webkitRelativePath with "/").
      // This prevents the "folder placeholder" (0-byte file) from becoming an empty file in your explorer.
      const relPath = String(f.webkitRelativePath || "");

      // If we're importing a folder, only accept real folder entries.
      if (folderNameOrNull) {
        // Real folder picks ALWAYS provide a path like: "MyFolder/src/index.ts"
        // If it's missing, it's usually a directory placeholder -> skip.
        if (!relPath.includes("/")) continue;
        // Extra safety: only accept files that belong to this folder
        if (!relPath.startsWith(`${folderNameOrNull}/`)) continue;
      }

      const rel = folderNameOrNull ? relPath : (relPath || f.name);
      const parts = splitRelPath(rel);

      // For folder import: drop the top folder segment
      const effectiveParts =
        folderNameOrNull
          ? (parts.length > 1 ? parts.slice(1) : [parts[parts.length - 1] || f.name])
          : (parts.length ? parts : [f.name]);

      let content = "";
      if (isProbablyTextFile(f.name)) {
        try { content = await f.text(); } catch { content = ""; }
      } else {
        content = `/* Binary file: ${f.name}\n * CavCode viewer support is handled in the Viewer module.\n */\n`;
      }

      const res = applyRelPathIntoFS(
        updated,
        { topFolderName: folderNameOrNull, baseFolderPath: importBaseFolderPath },
        effectiveParts,
        { content }
      );
      if (res.topFolderId) topFolderId = res.topFolderId;

      // Track the file we just created/updated by its resolved path
      const leafBasePath = folderNameOrNull
        ? joinPath(importBaseFolderPath || "/", folderNameOrNull)
        : importBaseFolderPath || "/";
      const leafPath = normalizePath(joinPath(leafBasePath, effectiveParts.join("/")));
      const leafNode = findNodeByPath(updated, leafPath);
      if (leafNode && isFile(leafNode)) createdFileIds.push(leafNode.id);

      imported++;
    }

    if (!imported) {
      pushToast("No files were imported.", "watch");
      return;
    }

    let nextActiveRootPath = activeRootPathAtImport;
    if (topFolderId) {
      const topFolder = findNode(updated, topFolderId);
      if (topFolder && isFolder(topFolder)) {
        nextActiveRootPath = normalizePath(topFolder.path);
      }
    } else if (importBaseFolderPath) {
      const baseFolder = findNodeByPath(updated, importBaseFolderPath);
      if (baseFolder && isFolder(baseFolder)) {
        nextActiveRootPath = normalizePath(baseFolder.path);
      }
    }

    setFS(updated);
    setOpenFolders((p) => ({ ...p, root: true }));
    setActiveProjectRootPath(nextActiveRootPath || null);

    // VS behavior:
    // • If folder import: expand folder only (no auto-open tabs).
    // • If file-only import: Files land at root and open in editor.
    if (topFolderId) {
      // Expand that folder only
      setOpenFolders((p) => ({ ...p, root: true, [topFolderId!]: true }));
      pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`, "good");
    } else {
      pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`, "good");

      // Open the most recently imported file
      const last = createdFileIds[createdFileIds.length - 1] || "";
      if (last) setActiveFileId(last);
    }

    setActivity("explorer");
  }

  async function importFromFileList(files: FileList, folderNameOrNull: string | null) {
    await importFromFileArray(Array.from(files || []), folderNameOrNull);
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    if (!files || !files.length) {
      e.currentTarget.value = "";
      return;
    }
    await importFromFileList(files, null);
    e.currentTarget.value = "";
  }

  async function importFromDirectoryHandle(handle: FileSystemDirectoryHandle) {
    const rootName = "name" in handle && handle.name ? String(handle.name) : "UploadedFolder";
    const replaceActiveRoot = shouldReplaceActiveProjectRoot(rootName);
    if (replaceActiveRoot && !confirmReplaceActiveProjectRoot(rootName)) {
      pushToast("Folder import canceled.", "watch");
      return;
    }

    const updated = replaceActiveRoot ? stripWorkspaceToSpecialRoots(safeClone(fs)) : safeClone(fs);
    let imported = 0;
    let topFolderId: string | undefined;

    const walk = async (dir: FileSystemDirectoryHandle, relBase: string) => {
      const iter = (dir as FileSystemDirectoryHandle & { values: () => AsyncIterable<FileSystemHandle> }).values();
      for await (const entry of iter) {
        if (entry.kind === "directory") {
          const nextBase = relBase ? `${relBase}/${entry.name}` : entry.name;
          await walk(entry as FileSystemDirectoryHandle, nextBase);
        } else {
          const fileHandle = entry as FileSystemFileHandle;
          let content = "";
          try {
            const file = await fileHandle.getFile();
            if (isProbablyTextFile(file.name)) content = await file.text();
            else content = `/* Binary file: ${file.name}\n * CavCode viewer support is handled in the Viewer module.\n */\n`;
          } catch {
            content = "";
          }
          const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
          const parts = splitRelPath(rel);
          const res = applyRelPathIntoFS(updated, { topFolderName: rootName }, parts, { content });
          if (res.topFolderId) topFolderId = res.topFolderId;
          imported++;
        }
      }
    };

    await walk(handle, "");

    if (!imported) {
      pushToast("No files found in that folder.", "watch");
      return;
    }

    const topFolder = topFolderId ? findNode(updated, topFolderId) : null;
    const nextActiveRootPath = topFolder && isFolder(topFolder) ? normalizePath(topFolder.path) : null;
    setFS(updated);
    setOpenFolders((p) => ({ ...p, root: true, ...(topFolderId ? { [topFolderId]: true } : {}) }));
    setActiveProjectRootPath(nextActiveRootPath);
    pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"}.`, "good");
    setActivity("explorer");
  }

  function openFolderPickerUpload() {
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      pushToast("Upload Folder needs Chrome/Edge (use Connect Folder otherwise).", "watch");
      return;
    }
    picker()
      .then((handle) => importFromDirectoryHandle(handle))
      .catch(() => {});
  }

  async function fetchCavCloudTreeLite(folderPath: string) {
    const normalized = normalizePath(folderPath || "/");
    const res = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(normalized)}&lite=1`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | null
      | {
          ok?: boolean;
          folder?: { name?: string; path?: string } | null;
          folders?: Array<{ name?: string; path?: string }>;
          files?: Array<{ name?: string; path?: string; mimeType?: string | null }>;
        };
    if (!json?.ok) return null;
    return json;
  }

  async function readCavCloudFileText(path: string): Promise<string> {
    const normalized = normalizePath(path || "/");
    try {
      const res = await fetch(`/api/cavcloud/files/by-path?path=${encodeURIComponent(normalized)}&raw=1`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return "";
      const length = Number(res.headers.get("content-length") || "");
      if (Number.isFinite(length) && length > 2 * 1024 * 1024) return "";
      const contentType = String(res.headers.get("content-type") || "").toLowerCase();
      if (!isTextContentType(contentType) && !isProbablyTextFile(normalized)) return "";
      const body = await res.text();
      return body.includes("\u0000") ? "" : body;
    } catch {
      return "";
    }
  }

  async function loadCloudConnectFolders(force = false) {
    if (!force && cloudFoldersLoadedRef.current && cloudFolders.length) return;
    if (cloudFoldersLoadPromiseRef.current) return cloudFoldersLoadPromiseRef.current;

    const loadPromise = (async () => {
      setCloudFoldersLoading(true);
      const visited = new Set<string>();
      const queue: string[] = ["/"];
      const folders: FolderNode[] = [];

      while (queue.length && folders.length < 240) {
        const batch: string[] = [];
        while (queue.length && batch.length < 8) {
          const candidate = normalizePath(queue.shift() || "/");
          if (!candidate || visited.has(candidate)) continue;
          visited.add(candidate);
          batch.push(candidate);
        }
        if (!batch.length) continue;

        const rows = await Promise.all(
          batch.map(async (current) => ({
            current,
            tree: await fetchCavCloudTreeLite(current),
          }))
        );

        for (const row of rows) {
          if (folders.length >= 240) break;
          const tree = row.tree;
          if (!tree?.folder) continue;

          const folderPath = normalizePath(String(tree.folder.path || row.current || "/"));
          const folderName = folderPath === "/"
            ? "CavCloud"
            : String(tree.folder.name || folderPath.split("/").filter(Boolean).pop() || "Folder");
          folders.push({
            id: stableId("cavcloud-folder", folderPath),
            kind: "folder",
            name: folderName,
            path: folderPath,
            children: [],
          });

          for (const child of tree.folders || []) {
            const childPath = normalizePath(String(child?.path || ""));
            if (!childPath || visited.has(childPath)) continue;
            queue.push(childPath);
          }
        }
      }

      const ordered = folders.sort((a, b) => a.path.localeCompare(b.path));
      if (!ordered.length) {
        cloudFoldersLoadedRef.current = false;
        pushToast("CavCloud has no accessible folders yet.", "watch");
        return;
      }
      cloudFoldersLoadedRef.current = true;
      setCloudFolders(ordered);
      setCloudSelectedPath((prev) => {
        const normalizedPrev = normalizePath(prev || "/");
        if (ordered.some((folder) => folder.path === normalizedPrev)) return normalizedPrev;
        return ordered[0]?.path || "/";
      });
    })()
      .catch(() => {
        cloudFoldersLoadedRef.current = false;
        pushToast("Failed to load CavCloud folders.", "bad");
      })
      .finally(() => {
        setCloudFoldersLoading(false);
        cloudFoldersLoadPromiseRef.current = null;
      });

    cloudFoldersLoadPromiseRef.current = loadPromise;
    return loadPromise;
  }

  function openCloudConnect() {
    setCloudConnectOpen(true);
    if (!cloudFolders.length) {
      setCloudFolders([{
        id: stableId("cavcloud-folder", "/"),
        kind: "folder",
        name: "CavCloud",
        path: "/",
        children: [],
      }]);
      setCloudSelectedPath("/");
    }
    void loadCloudConnectFolders(false);
  }

  async function importFromCavCloud(path: string) {
    const selectedPath = normalizePath(path || "/");
    let importedFiles = 0;

    const buildFolder = async (folderPath: string, depth: number): Promise<FolderNode | null> => {
      if (depth > 8) return null;
      const tree = await fetchCavCloudTreeLite(folderPath);
      if (!tree?.folder) return null;

      const normalizedFolderPath = normalizePath(String(tree.folder.path || folderPath || "/"));
      const folderName =
        normalizedFolderPath === "/"
          ? "CavCloud"
          : String(tree.folder.name || normalizedFolderPath.split("/").filter(Boolean).pop() || "Folder");
      const folderNode: FolderNode = {
        id: stableId("cavcloud-import-folder", normalizedFolderPath),
        kind: "folder",
        name: folderName,
        path: normalizedFolderPath,
        children: [],
      };

      const childFolders = (tree.folders || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
      for (const child of childFolders) {
        const childPath = normalizePath(String(child.path || ""));
        if (!childPath) continue;
        const childNode = await buildFolder(childPath, depth + 1);
        if (childNode) folderNode.children.push(childNode);
      }

      const files = (tree.files || []).slice().sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));
      for (const file of files) {
        if (importedFiles >= 420) break;
        const fileName = String(file.name || "").trim();
        const filePath = normalizePath(String(file.path || joinPath(normalizedFolderPath, fileName)));
        if (!fileName || !filePath) continue;
        const content = await readCavCloudFileText(filePath);
        folderNode.children.push({
          id: stableId("cavcloud-import-file", filePath),
          kind: "file",
          name: fileName,
          path: filePath,
          lang: inferLang(fileName),
          content,
        });
        importedFiles += 1;
      }

      return folderNode;
    };

    const importedRoot = await buildFolder(selectedPath, 0);
    if (!importedRoot) {
      pushToast("CavCloud folder could not be loaded.", "bad");
      return;
    }

    const replaceCurrentRoot = fs.children.some((child) => isFolder(child) && isUserWorkspacePath(child.path));
    if (replaceCurrentRoot && !confirmReplaceActiveProjectRoot(importedRoot.name)) {
      pushToast("Folder import canceled.", "watch");
      return;
    }

    const updated = replaceCurrentRoot
      ? stripWorkspaceToSpecialRoots(safeClone(fs))
      : safeClone(fs);
    const desiredName = ensureUniqueName(updated, importedRoot.name || "CavCloud");
    const rootForClone: FolderNode = {
      ...importedRoot,
      name: desiredName,
    };
    const cloned = cloneNodeWithNewIds(rootForClone, "/");
    if (!isFolder(cloned)) {
      pushToast("CavCloud folder could not be mounted.", "bad");
      return;
    }
    const insertedRootId = cloned.id;
    updated.children.push(cloned);

    setFS(updated);
    setOpenFolders((prev) => ({ ...prev, root: true, ...(insertedRootId ? { [insertedRootId]: true } : {}) }));
    setActiveProjectRootPath(normalizePath(cloned.path));
    pushToast(`Connected CavCloud: ${selectedPath}`, "good");
  }

  /* =========================
    Drag/drop folder import (SOLID)
    - Preserves actual dropped folder name.
    - Recursively traverses directories when supported (Chromium).
  ========================= */
  type WebkitEntry = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath?: string;
    file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
    createReader?: () => {
      readEntries: (cb: (entries: WebkitEntry[]) => void, err?: (e: unknown) => void) => void;
    };
  };
  async function importHandle(handle: FileSystemHandle, topName?: string) {
    // This MUST be the folder name we show in the explorer
    const rootFolderName = String(topName || handle.name || "DroppedFolder");

    // If the dropped handle is a file, we should NOT pretend it’s a folder.
    if (handle.kind !== "directory") {
      pushToast("Drop a folder to import as a folder.", "watch");
      return;
    }

    const replaceActiveRoot = shouldReplaceActiveProjectRoot(rootFolderName);
    if (replaceActiveRoot && !confirmReplaceActiveProjectRoot(rootFolderName)) {
      pushToast("Folder import canceled.", "watch");
      return;
    }

    const updated = replaceActiveRoot ? stripWorkspaceToSpecialRoots(safeClone(fs)) : safeClone(fs);
    let imported = 0;
    let topFolderId: string | undefined;

    // Walk a directory handle and import ALL nested files into a REAL folder node.
    const walkDirHandle = async (dir: FileSystemDirectoryHandle, relBase: string[]) => {
      const iter = (dir as FileSystemDirectoryHandle & { values: () => AsyncIterable<FileSystemHandle> }).values();
      for await (const entry of iter) {
        if (imported >= 5000) return;

        if (entry.kind === "directory") {
          await walkDirHandle(entry as FileSystemDirectoryHandle, [...relBase, entry.name]);
          continue;
        }

        // entry is a file
        const fh = entry as FileSystemFileHandle;

        let content = "";
        try {
          const file = await fh.getFile();
          if (isProbablyTextFile(file.name)) content = await file.text();
          else content = `/* Binary file: ${file.name}\n * CavCode viewer support is handled in the Viewer module.\n */\n`;
        } catch {
          content = "";
        }

        // IMPORTANT:
        // relParts must be: [subfolder1, subfolder2, ..., filename]
        // NOT just the filename alone.
        const relParts = [...relBase, fh.name];

        const res = applyRelPathIntoFS(updated, { topFolderName: rootFolderName }, relParts, {
          content,
          handle: fh,
        });

        if (res.topFolderId) topFolderId = res.topFolderId;
        imported++;
      }
    };

    // Start walking at the dropped folder root.
    await walkDirHandle(handle as FileSystemDirectoryHandle, []);

    if (!imported) {
      pushToast("No files found in that folder.", "watch");
      return;
    }

    const topFolder = topFolderId ? findNode(updated, topFolderId) : null;
    const nextActiveRootPath = topFolder && isFolder(topFolder) ? normalizePath(topFolder.path) : null;
    setFS(updated);
    setOpenFolders((p) => ({ ...p, root: true, ...(topFolderId ? { [topFolderId]: true } : {}) }));
    setActiveProjectRootPath(nextActiveRootPath);

    pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"} from ${rootFolderName}.`, "good");

    // Folder import should NOT open tabs

    setActivity("explorer");
  }

  async function readAllEntries(dir: WebkitEntry): Promise<WebkitEntry[]> {
    const reader = dir.createReader?.();
    if (!reader) return [];
    const out: WebkitEntry[] = [];

    // readEntries returns chunks; keep reading until empty
    let done = false;
    while (!done) {
      const batch = await new Promise<WebkitEntry[]>((resolve) => {
        try {
          reader.readEntries((ents: WebkitEntry[]) => resolve(ents || []), () => resolve([]));
        } catch {
          resolve([]);
        }
      });
      if (!batch.length) {
        done = true;
      } else {
        out.push(...batch);
      }
    }
    return out;
  }

  async function entryToFile(entry: WebkitEntry): Promise<File | null> {
    const fileFn = entry.file;
    if (!entry.isFile || !fileFn) return null;

    const f = await new Promise<File | null>((resolve) => {
      try {
        fileFn((file: File) => resolve(file), () => resolve(null));
      } catch {
        resolve(null);
      }
    });
    return f;
  }

  async function importDirectoryEntry(dir: WebkitEntry) {
    // Root folder name is the folder you dropped (EXACT)
    const rootFolderName = String(dir.name || "DroppedFolder");

    const replaceActiveRoot = shouldReplaceActiveProjectRoot(rootFolderName);
    if (replaceActiveRoot && !confirmReplaceActiveProjectRoot(rootFolderName)) {
      pushToast("Folder import canceled.", "watch");
      return;
    }

    const updated = replaceActiveRoot ? stripWorkspaceToSpecialRoots(safeClone(fs)) : safeClone(fs);
    let imported = 0;
    let topFolderId: string | undefined;

    const walkDir = async (current: WebkitEntry, relBase: string[]) => {
      const entries = await readAllEntries(current);
      for (const ent of entries) {
        if (imported >= 5000) return;
        if (ent.isDirectory) {
          await walkDir(ent, [...relBase, ent.name]);
          continue;
        }
        if (ent.isFile) {
          const file = await entryToFile(ent);
          if (!file) continue;

          let content = "";
          if (isProbablyTextFile(file.name)) {
            try { content = await file.text(); } catch { content = ""; }
          } else {
            content = `/* Binary file: ${file.name}\n * CavCode viewer support is handled in the Viewer module.\n */\n`;
          }

          // relParts excludes the root folder name (rootFolderName becomes the import top folder)
          const relParts = [...relBase, file.name];
          const res = applyRelPathIntoFS(updated, { topFolderName: rootFolderName }, relParts, { content });
          if (res.topFolderId) topFolderId = res.topFolderId;
          imported++;
        }
      }
    };

    await walkDir(dir, []);

    if (!imported) {
      pushToast("No files found in that folder.", "watch");
      return;
    }

    const topFolder = topFolderId ? findNode(updated, topFolderId) : null;
    const nextActiveRootPath = topFolder && isFolder(topFolder) ? normalizePath(topFolder.path) : null;
    setFS(updated);
    setOpenFolders((p) => ({ ...p, root: true, ...(topFolderId ? { [topFolderId]: true } : {}) }));
    setActiveProjectRootPath(nextActiveRootPath);
    pushToast(`Imported ${imported} file${imported === 1 ? "" : "s"} from ${rootFolderName}.`, "good");

    // Folder import should NOT open tabs

    setActivity("explorer");
  }

  function detectFolderUploadFromFileList(dtFiles: FileList) {
    const arr = Array.from(dtFiles || []);
    // If any file has webkitRelativePath with a slash, it's a folder drag/drop or folder selection
    const firstWithRel = arr.find((f) => {
      const rel = String(f.webkitRelativePath || "");
      return rel.includes("/");
    });
    if (!firstWithRel) return null;

    const rel = String(firstWithRel.webkitRelativePath || "");
    const folderName = splitRelPath(rel)[0] || null;
    return folderName;
  }

  async function importFromDataTransfer(dt: DataTransfer) {
    const items = Array.from(dt.items || []);

    // 1) Modern Chromium path (BEST): handles real folders
    const hasFSHandle = items.some(
      (it) =>
        typeof (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle> })
          .getAsFileSystemHandle === "function"
    );
    if (hasFSHandle) {
      const handles: FileSystemHandle[] = [];

      for (const it of items) {
        try {
          const h = await (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle> }).getAsFileSystemHandle?.();
          if (h) handles.push(h);
        } catch {}
      }

      const dirs = handles.filter((h) => h.kind === "directory");
      if (dirs.length) {
        for (const d of dirs.slice(0, 8)) {
          await importHandle(d, d.name);
        }
        return true;
      }

      // If it's only files, import as files
      const filesOnly = handles.filter((h) => h.kind === "file") as FileSystemFileHandle[];
      if (filesOnly.length) {
        if (dt.files && dt.files.length) {
          await importFromFileList(dt.files, null);
          return true;
        }

        // Fallback: read File objects from handles
        const arr: File[] = [];
        for (const fh of filesOnly.slice(0, 200)) {
          try { arr.push(await fh.getFile()); } catch {}
        }
        if (arr.length) {
          await importFromFileArray(arr, null);
          return true;
        }
      }
    }

    // 2) Legacy Chromium path: webkitGetAsEntry
    const entries: WebkitEntry[] = [];
    for (const it of items) {
      const ent = (it as DataTransferItem & { webkitGetAsEntry?: () => WebkitEntry | null }).webkitGetAsEntry?.();
      if (ent) entries.push(ent);
    }

    const dirEntries = entries.filter((e) => e.isDirectory);
    if (dirEntries.length) {
      for (const d of dirEntries.slice(0, 8)) {
        await importDirectoryEntry(d);
      }
      return true;
    }

    const fileEntries = entries.filter((e) => e.isFile);
    if (fileEntries.length) {
      const droppedFiles: File[] = [];
      for (const ent of fileEntries.slice(0, 5000)) {
        const file = await entryToFile(ent);
        if (file) droppedFiles.push(file);
      }
      if (droppedFiles.length) {
        await importFromFileArray(droppedFiles, null);
        return true;
      }
    }

    // 3) Final fallback: dt.files
    // NOTE: This fallback CAN NOT guarantee folder drag/drop.
    // Some browsers only give a folder placeholder file here.
    if (dt.files && dt.files.length) {
      const folderName = detectFolderUploadFromFileList(dt.files);

      if (folderName) {
        await importFromFileList(dt.files, folderName);
        return true;
      }

      await importFromFileList(dt.files, null);
      return true;
    }

    // 4) Last-resort file extraction from drag items.
    const droppedItemFiles: File[] = [];
    for (const it of items) {
      if (it.kind !== "file") continue;
      const file = it.getAsFile?.();
      if (file) droppedItemFiles.push(file);
    }
    if (droppedItemFiles.length) {
      await importFromFileArray(droppedItemFiles, null);
      return true;
    }

    return false;
  }

  /* =========================
    Save (CavBot) + optional Save to Disk
    - Cmd/Ctrl+S always saves (CavBot/local persistence) and shows "Saved."
    - If file has fsHandle, we also attempt to write-through silently.
  ========================= */
  const saveActiveToDiskIfConnected = useCallback(
    async (opts?: { silent?: boolean }) => {
      const f = activeFile;
      if (!f) return;
      if (!f.fsHandle) return;

      try {
        const writable = await f.fsHandle.createWritable();
        await writable.write(f.content ?? "");
        await writable.close();
      } catch {
        if (!opts?.silent) pushToast("Save failed (permission/locked).", "bad");
      }
    },
    [activeFile, pushToast]
  );

  const saveNow = useCallback(async () => {
    try {
      if (settings.formatOnSave) {
        const ed = editorRef.current;
        await ed?.getAction?.("editor.action.formatDocument")?.run?.();
      }
    } catch {}

    // System virtual README: persist to DB, never to CavCloud/workspace storage.
    if (activeFile?.path && normalizePath(activeFile.path) === SYS_README_PATH) {
      const md = String(activeFile.content ?? "");
      if (Buffer.byteLength(md, "utf8") > 64 * 1024) {
        pushToast("README too large (max 64KB).", "bad");
        return;
      }
      try {
        const expectedRevision = Math.max(0, Math.trunc(Number(sysAutosaveRef.current.lastSavedRevision || 0)));
        const res = await fetch("/api/profile/readme", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify({ markdown: md, expectedRevision }),
        });
        const j = (await res.json().catch(() => null)) as unknown;
        const r = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
        if (r && r.ok === true) {
          const revisionRaw = Number(r.revision);
          const revision =
            Number.isFinite(revisionRaw) && Number.isInteger(revisionRaw) && revisionRaw >= 0
              ? Math.trunc(revisionRaw)
              : expectedRevision + 1;
          sysAutosaveRef.current.lastSavedHash = hashString(md);
          sysAutosaveRef.current.lastSavedRevision = revision;
          setSysProfileReadme({ markdown: md, loaded: true, revision });
          publishSysProfileReadme(md, revision);
          if (activeFile?.id) {
            markFileSaved(activeFile.id, md);
          }
          pushToast("Saved.", "good");
        } else if (r && r.error === "REVISION_CONFLICT") {
          const currentRevisionRaw = Number(r.currentRevision);
          const currentRevision =
            Number.isFinite(currentRevisionRaw) && Number.isInteger(currentRevisionRaw) && currentRevisionRaw >= 0
              ? Math.trunc(currentRevisionRaw)
              : expectedRevision;
          sysAutosaveRef.current.lastSavedRevision = currentRevision;
          setSysProfileReadme({ markdown: md, loaded: true, revision: currentRevision });
          publishSysProfileReadme(md, currentRevision);
          pushToast("README changed in another tab. Save again to apply your latest edit.", "watch");
        } else {
          pushToast(String(r?.message || "Save failed."), "bad");
        }
      } catch {
        pushToast("Save failed.", "bad");
      }
      return;
    }

    if (activeFile?.path && activeFile.path.startsWith("/codebase/")) {
      const ok = await saveCodebaseFileToServer(activeFile.path, String(activeFile.content ?? ""));
      if (!ok) {
        pushToast("Save failed.", "bad");
        return;
      }
      markFileSaved(activeFile.id, String(activeFile.content ?? ""));
      hydratedCodebasePathsRef.current.add(normalizePath(activeFile.path));
      void syncCodebaseFsFromServer({ silent: true });
      pushToast("Saved.", "good");
      await saveActiveToDiskIfConnected({ silent: true });
      return;
    }

    const fsSnapshot = stripSystemNodes(fs);
    const tabsSnapshot = normalizeTabsForWorkspace(fsSnapshot, tabs);
    const activeFileInScope = tabsSnapshot.some((tab) => tab.id === activeFileId) ? activeFileId : "";
    const rootNode = activeProjectRootPath ? findNodeByPath(fsSnapshot, activeProjectRootPath) : null;
    const activeProjectRootPathInScope =
      rootNode && isFolder(rootNode) && isUserWorkspacePath(rootNode.path) ? normalizePath(rootNode.path) : null;
    const snapshot: CavCodeWorkspaceSnapshot = {
      version: 2,
      fs: fsSnapshot,
      tabs: tabsSnapshot,
      activeFileId: activeFileInScope,
      activeProjectRootPath: activeProjectRootPathInScope,
    };
    const snapshotHash = hashString(JSON.stringify(snapshot));
    const saved = await persistWorkspaceSnapshotToServer(snapshot);
    if (!saved) {
      pushToast("Save failed.", "bad");
      return;
    }
    workspaceSnapshotLastHashRef.current = snapshotHash;
    if (activeFile?.id) {
      markFileSaved(activeFile.id, String(activeFile.content ?? ""));
    }
    pushToast("Saved.", "good");
    await saveActiveToDiskIfConnected({ silent: true });
  }, [
    settings.formatOnSave,
    editorRef,
    pushToast,
    saveActiveToDiskIfConnected,
    persistWorkspaceSnapshotToServer,
    activeFile,
    activeFileId,
    activeProjectRootPath,
    fs,
    tabs,
    setSysProfileReadme,
    markFileSaved,
    saveCodebaseFileToServer,
    syncCodebaseFsFromServer,
  ]);

  /* =========================
    System README autosave (debounced)
  ========================= */
  useEffect(() => {
    if (!settings.autosave) return;
    const f = activeFile;
    if (!f?.path) return;
    if (normalizePath(f.path) !== SYS_README_PATH) return;

    const md = String(f.content ?? "");
    const h = hashString(md);
    if (h === sysAutosaveRef.current.lastSavedHash) return;

    const ref = sysAutosaveRef.current;
    if (ref.timer) window.clearTimeout(ref.timer);
    ref.timer = window.setTimeout(async () => {
      // Timer fired; clear only if it is still ours.
      if (ref.timer) ref.timer = null;
      // Recheck latest
      const latest = findNodeByPath(fs, SYS_README_PATH);
      if (!latest || !isFile(latest)) return;
      const latestMd = String(latest.content ?? "");
      const latestHash = hashString(latestMd);
      if (latestHash === ref.lastSavedHash) return;
      if (Buffer.byteLength(latestMd, "utf8") > 64 * 1024) return; // don't spam API; user will see size error on hard save

      try {
        const expectedRevision = Math.max(0, Math.trunc(Number(ref.lastSavedRevision || 0)));
        const res = await fetch("/api/profile/readme", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-cavbot-csrf": "1",
          },
          body: JSON.stringify({ markdown: latestMd, expectedRevision }),
        });
        const j = (await res.json().catch(() => null)) as unknown;
        const r = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
        if (r && r.ok === true) {
          const revisionRaw = Number(r.revision);
          const revision =
            Number.isFinite(revisionRaw) && Number.isInteger(revisionRaw) && revisionRaw >= 0
              ? Math.trunc(revisionRaw)
              : expectedRevision + 1;
          ref.lastSavedHash = latestHash;
          ref.lastSavedRevision = revision;
          setSysProfileReadme({ markdown: latestMd, loaded: true, revision });
          publishSysProfileReadme(latestMd, revision);
          markFileSaved(latest.id, latestMd);
        } else if (r && r.error === "REVISION_CONFLICT") {
          const currentRevisionRaw = Number(r.currentRevision);
          if (Number.isFinite(currentRevisionRaw) && Number.isInteger(currentRevisionRaw) && currentRevisionRaw >= 0) {
            ref.lastSavedRevision = Math.trunc(currentRevisionRaw);
          }
        }
      } catch {}
    }, 650);
    const timerId = ref.timer;

    return () => {
      if (timerId) window.clearTimeout(timerId);
      if (ref.timer === timerId) ref.timer = null;
    };
  }, [activeFile, markFileSaved, settings.autosave, fs]);

  /* =========================
    Editor content updates (autosave)
  ========================= */
  function updateFileContentById(fileId: string, next: string) {
    const source = findFileById(fs, fileId);
    if (!source) return;
    if (normalizePath(source.path) === SYS_CAVEN_CONFIG_PATH) return;
    const nextFile: FileNode = { ...source, content: next };
    if (next !== source.content) {
      const baselineHash = ensureSavedHashForFile(source);
      applyDirtyStateForFile(nextFile.id, baselineHash, next);
    }
    setFS((prev) => replaceNode(prev, nextFile));
    if (nextFile.path.startsWith("/codebase/")) {
      setCodebaseFs((prev) => {
        const existing = prev.nodes[nextFile.path];
        if (!existing || existing.type !== "file") return prev;
        const copy = { ...prev.nodes };
        copy[nextFile.path] = {
          ...existing,
          content: next,
          updatedAt: Date.now(),
        };
        return { ...prev, nodes: copy };
      });
    }
  }

  /* =========================
    Tabs
  ========================= */
  function splitEditorTo(layout: Exclude<SplitLayout, "single">) {
    if (splitLayout === layout) {
      setSplitLayout("single");
      setActivePane("primary");
      return;
    }
    setSplitLayout(layout);
    setSecondaryFileId((prev) => {
      if (prev) return prev;
      const fallback = String(activeFileId || "").trim();
      if (fallback) return fallback;
      return String(tabs[tabs.length - 1]?.id || "").trim();
    });
  }

  function selectTabInActivePane(tabId: string) {
    const nextTabId = String(tabId || "").trim();
    if (!nextTabId) return;
    const nextTab = tabs.find((tab) => tab.id === nextTabId);
    const allowSecondaryTarget = !nextTab || nextTab.kind !== "skills";
    if (splitLayout !== "single" && activePane === "secondary" && allowSecondaryTarget) {
      setSecondaryFileId(nextTabId);
      return;
    }
    setActivePane("primary");
    setActiveFileId(nextTabId);
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const nextTabs = prev.filter((t) => t.id !== id);
      if (activeFileId === id) setActiveFileId(nextTabs[nextTabs.length - 1]?.id || "");
      if (secondaryFileId === id) {
        const fallback = nextTabs.find((tab) => tab.id !== activeFileId)?.id || nextTabs[nextTabs.length - 1]?.id || "";
        setSecondaryFileId(fallback);
        if (!fallback) setSplitLayout("single");
      }
      return nextTabs;
    });
    if (secondaryFileId === id && activePane === "secondary") {
      setActivePane("primary");
    }
  }

  function readDraggedTabId(event: React.DragEvent<HTMLElement>): string | null {
    const byState = String(tabDragId || "").trim();
    if (byState) return byState;
    const byCustomMime = String(event.dataTransfer.getData("application/x-cavcode-tab-id") || "").trim();
    if (byCustomMime) return byCustomMime;
    const byText = String(event.dataTransfer.getData("text/plain") || "").trim();
    if (byText) return byText;
    return null;
  }

  function reorderTabs(dragId: string, targetId: string, side: "before" | "after") {
    if (!dragId || !targetId || dragId === targetId) return;
    setTabs((prev) => {
      const fromIndex = prev.findIndex((t) => t.id === dragId);
      const targetIndex = prev.findIndex((t) => t.id === targetId);
      if (fromIndex < 0 || targetIndex < 0) return prev;

      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      const targetIndexAfterRemoval = next.findIndex((t) => t.id === targetId);
      if (!moved || targetIndexAfterRemoval < 0) return prev;

      let insertAt = targetIndexAfterRemoval + (side === "after" ? 1 : 0);
      if (insertAt < 0) insertAt = 0;
      if (insertAt > next.length) insertAt = next.length;
      next.splice(insertAt, 0, moved);
      return next;
    });
  }

  function moveTabToEnd(dragId: string) {
    if (!dragId) return;
    setTabs((prev) => {
      const fromIndex = prev.findIndex((t) => t.id === dragId);
      if (fromIndex < 0 || fromIndex === prev.length - 1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.push(moved);
      return next;
    });
  }

  /* =========================
    Terminal command bus (Day 1)
  ========================= */
  const termWriteLines = useCallback((lines: string[]) => {
    setTermLines((p) => [...p, ...lines]);
  }, []);

  const applyRuntimeStatusPayload = useCallback((payload: RuntimeStatusPayload | null) => {
    if (!payload) return;
    const nextSeq = Number.isFinite(Number(payload.nextSeq)) ? Math.max(0, Math.trunc(Number(payload.nextSeq))) : null;
    if (runtimeSessionIdRef.current !== payload.sessionId) {
      runtimeLogSeqRef.current = nextSeq ?? 0;
    } else if (nextSeq != null) {
      runtimeLogSeqRef.current = Math.max(runtimeLogSeqRef.current, nextSeq);
    }
    runtimeSessionIdRef.current = payload.sessionId;
    runtimeStatusRef.current = payload.status;
    setRuntimeSessionId(payload.sessionId);
    setRuntimeStatus(payload.status);
    setRuntimeKind(payload.kind);
    setRuntimeExitCode(payload.exitCode ?? null);
    setRuntimeExitSignal(payload.exitSignal ?? null);
  }, []);

  const applyRuntimeLogsPayload = useCallback((payload: RuntimeLogsPayload | null) => {
    if (!payload) return;
    if (runtimeSessionIdRef.current !== payload.sessionId) {
      runtimeLogSeqRef.current = payload.nextSeq;
    } else {
      runtimeLogSeqRef.current = Math.max(runtimeLogSeqRef.current, payload.nextSeq);
    }
    runtimeSessionIdRef.current = payload.sessionId;
    runtimeStatusRef.current = payload.status;
    setRuntimeSessionId(payload.sessionId);
    setRuntimeStatus(payload.status);
    setRuntimeKind(payload.kind);
    setRuntimeExitCode(payload.exitCode ?? null);
    setRuntimeExitSignal(payload.exitSignal ?? null);
  }, []);

  const applyRuntimePayloadsFromBlocks = useCallback(
    (blocks: CavtoolsExecBlock[]) => {
      let statusPayload: RuntimeStatusPayload | null = null;
      let logsPayload: RuntimeLogsPayload | null = null;
      for (const block of blocks || []) {
        const maybeStatus = readRuntimeStatusPayloadFromBlock(block);
        if (maybeStatus) statusPayload = maybeStatus;
        const maybeLogs = readRuntimeLogsPayloadFromBlock(block);
        if (maybeLogs) logsPayload = maybeLogs;
      }
      if (statusPayload) applyRuntimeStatusPayload(statusPayload);
      if (logsPayload) applyRuntimeLogsPayload(logsPayload);
    },
    [applyRuntimeLogsPayload, applyRuntimeStatusPayload]
  );

  const applyDebugStatusPayload = useCallback((payload: DebugStatusPayload | null) => {
    if (!payload) return;
    const nextSeq = Number.isFinite(Number(payload.nextSeq)) ? Math.max(0, Math.trunc(Number(payload.nextSeq))) : 0;
    if (debugSessionIdRef.current !== payload.sessionId) {
      debugLogSeqRef.current = nextSeq;
    } else {
      debugLogSeqRef.current = Math.max(debugLogSeqRef.current, nextSeq);
    }
    debugSessionIdRef.current = payload.sessionId;
    debugStatusRef.current = payload.status;
    setDebugSessionId(payload.sessionId);
    setDebugStatus(payload.status);
    setDebugEntryPath(payload.entryPath);
    setDebugExitCode(payload.exitCode ?? null);
    setDebugExitSignal(payload.exitSignal ?? null);
    setDebugCurrentLocation(payload.currentLocation || { file: null, line: null, column: null });
    setDebugBreakpoints(payload.breakpoints || []);
    setDebugFunctionBreakpoints(payload.functionBreakpoints || []);
    setDebugDataBreakpoints(payload.dataBreakpoints || []);
    setDebugThreads(payload.threads || []);
    setDebugSelectedThreadId(payload.selectedThreadId ?? null);
    setDebugSelectedFrameOrdinal(payload.selectedFrameOrdinal ?? null);
    setDebugStack(payload.stack || []);
    setDebugScopes(payload.scopes || []);
    setDebugWatches(payload.watches || []);
    setDebugConsoleEntries(payload.consoleEntries || []);
    setDebugExceptionFilters(payload.exceptionFilters || { all: false, uncaught: false });
    setDebugAdapterLabel(String(payload.adapterLabel || ""));
    setDebugAdapterType(String(payload.adapterType || payload.adapterId || ""));
    setDebugLaunchTargetName(String(payload.launchTargetName || ""));
    setDebugLaunchCompoundName(String(payload.launchCompoundName || ""));
    setDebugLaunchProfileId(String(payload.launchProfileId || ""));
    setDebugWorkspaceVariantId(String(payload.workspaceVariantId || ""));
    setDebugLaunchRequest(payload.launchRequest || null);
    setDebugPostTaskLabel(String(payload.postDebugTask || ""));
    setDebugPostTaskRan(payload.postDebugTaskRan === true);
    setDebugCapabilities(payload.capabilities || null);
    setDebugLoadedScripts(payload.loadedScripts || []);
    setDebugLoadedModules(payload.loadedModules || []);
    setDebugActiveSessionId(payload.sessionId);
    setDebugSessionsList((prev) => {
      const next = prev.filter((row) => row.sessionId !== payload.sessionId);
      next.unshift(payload);
      return next.slice(0, 40);
    });
  }, []);

  const applyDebugLogsPayload = useCallback((payload: DebugLogsPayload | null) => {
    if (!payload) return;
    if (debugSessionIdRef.current !== payload.sessionId) {
      debugLogSeqRef.current = payload.nextSeq;
    } else {
      debugLogSeqRef.current = Math.max(debugLogSeqRef.current, payload.nextSeq);
    }
    debugSessionIdRef.current = payload.sessionId;
    debugStatusRef.current = payload.status;
    setDebugSessionId(payload.sessionId);
    setDebugStatus(payload.status);
    setDebugExitCode(payload.exitCode ?? null);
    setDebugExitSignal(payload.exitSignal ?? null);
    if (payload.currentLocation) {
      setDebugCurrentLocation(payload.currentLocation);
    }
    setDebugBreakpoints(payload.breakpoints || []);
    setDebugFunctionBreakpoints(payload.functionBreakpoints || []);
    setDebugDataBreakpoints(payload.dataBreakpoints || []);
    setDebugThreads(payload.threads || []);
    setDebugSelectedThreadId(payload.selectedThreadId ?? null);
    setDebugSelectedFrameOrdinal(payload.selectedFrameOrdinal ?? null);
    setDebugStack(payload.stack || []);
    setDebugScopes(payload.scopes || []);
    setDebugWatches(payload.watches || []);
    setDebugConsoleEntries(payload.consoleEntries || []);
    setDebugExceptionFilters(payload.exceptionFilters || { all: false, uncaught: false });
    if (payload.adapterLabel) setDebugAdapterLabel(payload.adapterLabel);
    if (payload.adapterType || payload.adapterId) setDebugAdapterType(String(payload.adapterType || payload.adapterId || ""));
    if (payload.launchTargetName != null) setDebugLaunchTargetName(String(payload.launchTargetName || ""));
    if (payload.launchCompoundName != null) setDebugLaunchCompoundName(String(payload.launchCompoundName || ""));
    if (payload.launchProfileId != null) setDebugLaunchProfileId(String(payload.launchProfileId || ""));
    if (payload.workspaceVariantId != null) setDebugWorkspaceVariantId(String(payload.workspaceVariantId || ""));
    if (payload.launchRequest) setDebugLaunchRequest(payload.launchRequest);
    if (payload.postDebugTask != null) setDebugPostTaskLabel(String(payload.postDebugTask || ""));
    if (payload.postDebugTaskRan != null) setDebugPostTaskRan(payload.postDebugTaskRan === true);
    if (payload.capabilities) setDebugCapabilities(payload.capabilities);
    if (payload.loadedScripts) setDebugLoadedScripts(payload.loadedScripts);
    if (payload.loadedModules) setDebugLoadedModules(payload.loadedModules);
    setDebugActiveSessionId(payload.sessionId);
    setDebugSessionsList((prev) => {
      const existing = prev.find((row) => row.sessionId === payload.sessionId);
      if (!existing) return prev;
      const merged: DebugStatusPayload = {
        ...existing,
        status: payload.status,
        adapterId: payload.adapterId || existing.adapterId,
        adapterLabel: payload.adapterLabel || existing.adapterLabel,
        adapterType: payload.adapterType || existing.adapterType,
        launchTargetName: payload.launchTargetName ?? existing.launchTargetName,
        launchCompoundName: payload.launchCompoundName ?? existing.launchCompoundName,
        launchProfileId: payload.launchProfileId ?? existing.launchProfileId,
        workspaceVariantId: payload.workspaceVariantId ?? existing.workspaceVariantId,
        launchRequest: payload.launchRequest || existing.launchRequest,
        postDebugTask: payload.postDebugTask ?? existing.postDebugTask,
        postDebugTaskRan: payload.postDebugTaskRan ?? existing.postDebugTaskRan,
        attachInfo: payload.attachInfo ?? existing.attachInfo,
        capabilities: payload.capabilities || existing.capabilities,
        exitCode: payload.exitCode,
        exitSignal: payload.exitSignal,
        currentLocation: payload.currentLocation || existing.currentLocation,
        breakpoints: payload.breakpoints || existing.breakpoints,
        functionBreakpoints: payload.functionBreakpoints || existing.functionBreakpoints,
        dataBreakpoints: payload.dataBreakpoints || existing.dataBreakpoints,
        exceptionFilters: payload.exceptionFilters || existing.exceptionFilters,
        threads: payload.threads || existing.threads,
        selectedThreadId: payload.selectedThreadId ?? existing.selectedThreadId,
        selectedFrameOrdinal: payload.selectedFrameOrdinal ?? existing.selectedFrameOrdinal,
        stack: payload.stack || existing.stack,
        scopes: payload.scopes || existing.scopes,
        watches: payload.watches || existing.watches,
        consoleEntries: payload.consoleEntries || existing.consoleEntries,
        loadedScripts: payload.loadedScripts || existing.loadedScripts,
        loadedModules: payload.loadedModules || existing.loadedModules,
      };
      const next = prev.filter((row) => row.sessionId !== payload.sessionId);
      next.unshift(merged);
      return next.slice(0, 40);
    });
  }, []);

  const applyDebugEvalPayload = useCallback((payload: DebugEvalPayload | null) => {
    if (!payload) return;
    setDebugEvalOutput(payload);
  }, []);

  const applyDebugVarsPayload = useCallback((payload: DebugVarsPayload | null) => {
    if (!payload) return;
    setDebugVarsCursor({
      variablesReference: payload.variablesReference,
      start: payload.start,
      count: payload.count,
    });
    setDebugVariables(payload.rows || []);
  }, []);

  const applyDebugSessionListPayload = useCallback((payload: DebugSessionListPayload | null) => {
    if (!payload) return;
    setDebugSessionsList(payload.sessions || []);
    if (payload.activeSessionId) {
      setDebugActiveSessionId(payload.activeSessionId);
    }
  }, []);

  const applyDebugLaunchManifestPayload = useCallback((payload: DebugLaunchManifestPayload | null) => {
    if (!payload) return;
    setDebugLaunchManifest(payload);
    if (!debugLaunchSelector) {
      if (payload.compounds.length) {
        setDebugLaunchSelector(`compound:${payload.compounds[0].id}`);
        setDebugLaunchSelectorType("compound");
      } else if (payload.targets.length) {
        setDebugLaunchSelector(`target:${payload.targets[0].id}`);
        setDebugLaunchSelectorType("target");
      }
    }
  }, [debugLaunchSelector]);

  const applyScmStatusPayload = useCallback((payload: GitStatusPayload | null) => {
    if (!payload) return;
    setScmStatusPayload(payload);
  }, []);

  const applyScmAuthPayload = useCallback((payload: GitAuthRequiredPayload | null) => {
    if (!payload) return;
    setScmAuthRequired(payload);
  }, []);

  const applyDebugDerivedPayloadsFromBlocks = useCallback(
    (blocks: CavtoolsExecBlock[]) => {
      let evalPayload: DebugEvalPayload | null = null;
      let varsPayload: DebugVarsPayload | null = null;
      let sessionsPayload: DebugSessionListPayload | null = null;
      let launchManifestPayload: DebugLaunchManifestPayload | null = null;
      for (const block of blocks || []) {
        const maybeEval = readDebugEvalPayloadFromBlock(block);
        if (maybeEval) evalPayload = maybeEval;
        const maybeVars = readDebugVarsPayloadFromBlock(block);
        if (maybeVars) varsPayload = maybeVars;
        const maybeSessions = readDebugSessionListPayloadFromBlock(block);
        if (maybeSessions) sessionsPayload = maybeSessions;
        const maybeManifest = readDebugLaunchManifestPayloadFromBlock(block);
        if (maybeManifest) launchManifestPayload = maybeManifest;
      }
      if (evalPayload) applyDebugEvalPayload(evalPayload);
      if (varsPayload) applyDebugVarsPayload(varsPayload);
      if (sessionsPayload) applyDebugSessionListPayload(sessionsPayload);
      if (launchManifestPayload) applyDebugLaunchManifestPayload(launchManifestPayload);
    },
    [applyDebugEvalPayload, applyDebugLaunchManifestPayload, applyDebugSessionListPayload, applyDebugVarsPayload]
  );

  const applyDebugPayloadsFromBlocks = useCallback(
    (blocks: CavtoolsExecBlock[]) => {
      let statusPayload: DebugStatusPayload | null = null;
      let logsPayload: DebugLogsPayload | null = null;
      for (const block of blocks || []) {
        const maybeStatus = readDebugStatusPayloadFromBlock(block);
        if (maybeStatus) statusPayload = maybeStatus;
        const maybeLogs = readDebugLogsPayloadFromBlock(block);
        if (maybeLogs) logsPayload = maybeLogs;
      }
      if (statusPayload) applyDebugStatusPayload(statusPayload);
      if (logsPayload) applyDebugLogsPayload(logsPayload);
      applyDebugDerivedPayloadsFromBlocks(blocks);
    },
    [applyDebugDerivedPayloadsFromBlocks, applyDebugLogsPayload, applyDebugStatusPayload]
  );

  const applyScmPayloadsFromBlocks = useCallback(
    (blocks: CavtoolsExecBlock[]) => {
      let statusPayload: GitStatusPayload | null = null;
      let authPayload: GitAuthRequiredPayload | null = null;
      let comparePayload: GitComparePayload | null = null;
      for (const block of blocks || []) {
        const maybeStatus = readGitStatusPayloadFromBlock(block);
        if (maybeStatus) statusPayload = maybeStatus;
        const maybeAuth = readGitAuthRequiredPayloadFromBlock(block);
        if (maybeAuth) authPayload = maybeAuth;
        const maybeCompare = readGitComparePayloadFromBlock(block);
        if (maybeCompare) comparePayload = maybeCompare;
      }
      if (statusPayload) applyScmStatusPayload(statusPayload);
      if (authPayload) applyScmAuthPayload(authPayload);
      if (comparePayload) {
        const compareKey = toChangesCompareKey(comparePayload.mode, comparePayload.path);
        setChangesCompareByKey((prev) => ({ ...prev, [compareKey]: comparePayload as GitComparePayload }));
      }
      if (!authPayload) {
        setScmAuthRequired(null);
      }
    },
    [applyScmAuthPayload, applyScmStatusPayload]
  );

  const closeRuntimeEventSource = useCallback(() => {
    const existing = runtimeEventSourceRef.current;
    if (!existing) return;
    runtimeEventSourceRef.current = null;
    try {
      existing.close();
    } catch {}
  }, []);
  const closeDebugEventSource = useCallback(() => {
    const existing = debugEventSourceRef.current;
    if (!existing) return;
    debugEventSourceRef.current = null;
    try {
      existing.close();
    } catch {}
  }, []);
  const closeCavcodeEventSource = useCallback(() => {
    const existing = cavcodeEventSourceRef.current;
    if (!existing) return;
    cavcodeEventSourceRef.current = null;
    try {
      existing.close();
    } catch {}
  }, []);

  const backgroundLintBusyRef = useRef(false);
  const backgroundLintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (activity !== "run") return;
    let cancelled = false;
    void (async () => {
      const statusResult = await callCavtoolsExec("cav debug status --all", "/cavcode");
      if (!cancelled && statusResult?.blocks) {
        applyDebugPayloadsFromBlocks(statusResult.blocks);
      }
      const launchResult = await callCavtoolsExec("cav debug config list", "/cavcode");
      if (!cancelled && launchResult?.blocks) {
        applyDebugPayloadsFromBlocks(launchResult.blocks);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activity, applyDebugPayloadsFromBlocks, callCavtoolsExec]);

  useEffect(() => {
    if (activity !== "scm" && activity !== "changes") return;
    let cancelled = false;
    void (async () => {
      const statusResult = await callCavtoolsExec("cav git status", "/cavcode");
      if (!cancelled && statusResult?.blocks) {
        applyScmPayloadsFromBlocks(statusResult.blocks);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activity, applyScmPayloadsFromBlocks, callCavtoolsExec]);

  const refreshWorkspaceDiagnostics = useCallback(async () => {
    if (backgroundLintBusyRef.current) return;
    backgroundLintBusyRef.current = true;
    try {
      const result = await callCavtoolsExec("lint", "/cavcode");
      if (!result || !result.ok) return;
      const nextProblems = collectWorkspaceProblemsFromBlocks(result.blocks || []);
      setWorkspaceProblems(nextProblems);
    } finally {
      backgroundLintBusyRef.current = false;
    }
  }, [callCavtoolsExec]);

  async function runCmd(input: string) {
    const raw = String(input || "").trim();
    if (!raw) return;

    termWriteLines([`${PROMPT_PREFIX} ${raw}`]);
    let handledByServer = false;

    if (shouldPreferServerCommand(raw)) {
      const serverCommand = toServerTerminalCommand(raw);
      const serverCwd = toCavcodePathFromCodebase(codebaseFs.cwd || "/codebase");
      const serverResult = await callCavtoolsExec(serverCommand, serverCwd);

      if (serverResult) {
        const errorCode = String(serverResult.error?.code || "").trim();
        const unknown = errorCode === "UNKNOWN_COMMAND" || errorCode === "UNKNOWN_CAV_COMMAND";
        if (!unknown || serverResult.ok) {
          handledByServer = true;

          const lines: string[] = [];
          const nextWorkspaceProblems = collectWorkspaceProblemsFromBlocks(serverResult.blocks || []);
          const hasDiagnosticsBlock = (serverResult.blocks || []).some((block) => block.kind === "diagnostics");
          applyRuntimePayloadsFromBlocks(serverResult.blocks || []);
          applyDebugPayloadsFromBlocks(serverResult.blocks || []);
          applyScmPayloadsFromBlocks(serverResult.blocks || []);
          for (const block of serverResult.blocks || []) {
            lines.push(...formatCavtoolsBlockToTerminalLines(block));
          }
          for (const warning of serverResult.warnings || []) {
            lines.push(fromServerOutputToCodebaseText(warning));
          }
          if (!serverResult.ok && lines.length === 0) {
            lines.push(fromServerOutputToCodebaseText(serverResult.error?.message || "Command failed."));
          }
          if (lines.length) termWriteLines(lines);
          if (hasDiagnosticsBlock) {
            setWorkspaceProblems(nextWorkspaceProblems);
          }
          if (nextWorkspaceProblems.length) {
            setPanelOpen(true);
            setPanelTab("problems");
          }

          const nextCwd = toCodebasePathFromCavcode(serverResult.cwd || "/cavcode");
          setCodebaseFs((prev) => {
            if (!prev.nodes[nextCwd] || prev.nodes[nextCwd].type !== "dir") return prev;
            if (prev.cwd === nextCwd) return prev;
            return { ...prev, cwd: nextCwd };
          });

          if (isMutatingServerCommand(serverCommand) || /^cd\b|^ls\b|^tree\b|^cav\s+sync\b/i.test(serverCommand)) {
            void syncCodebaseFsFromServer({ silent: true });
          }
        }
      }
    }

    if (!handledByServer) {
      const ctx = buildCavCtx();
      const result = runCavCommand(ctx, raw);
      if (result.lines && result.lines.length) {
        termWriteLines(result.lines);
      }
    }

    termHistoryRef.current = [raw, ...termHistoryRef.current].slice(0, 120);
    termHistIndexRef.current = -1;
  }

  useEffect(() => {
    if (!fsReady || !projectContextReady) return;
    if (backgroundLintTimerRef.current) {
      window.clearTimeout(backgroundLintTimerRef.current);
      backgroundLintTimerRef.current = null;
    }
    backgroundLintTimerRef.current = window.setTimeout(() => {
      backgroundLintTimerRef.current = null;
      void refreshWorkspaceDiagnostics();
    }, 3500);

    return () => {
      if (backgroundLintTimerRef.current) {
        window.clearTimeout(backgroundLintTimerRef.current);
        backgroundLintTimerRef.current = null;
      }
    };
  }, [fs, fsReady, projectContextReady, refreshWorkspaceDiagnostics]);

  useEffect(
    () => () => {
      closeRuntimeEventSource();
    },
    [closeRuntimeEventSource]
  );

  useEffect(
    () => () => {
      closeDebugEventSource();
    },
    [closeDebugEventSource]
  );

  useEffect(
    () => () => {
      closeCavcodeEventSource();
    },
    [closeCavcodeEventSource]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!projectIdFromQuery) {
      closeCavcodeEventSource();
      cavcodeEventSeqRef.current = 0;
      return;
    }
    if (typeof window.EventSource === "undefined") return;
    closeCavcodeEventSource();

    const { siteOrigin } = readCavtoolsQueryContext();
    const query = new URLSearchParams();
    query.set("projectId", String(projectIdFromQuery));
    query.set("afterSeq", String(Math.max(0, Math.trunc(Number(cavcodeEventSeqRef.current) || 0))));
    if (siteOrigin) query.set("siteOrigin", siteOrigin);
    const source = new window.EventSource(`/api/cavcode/events?${query.toString()}`, { withCredentials: true });
    cavcodeEventSourceRef.current = source;
    let closed = false;

    const handleEvents = (event: Event) => {
      const text = String((event as MessageEvent<string>).data || "");
      if (!text) return;
      try {
        const parsed = parseCavcodeEventsPayload(JSON.parse(text));
        if (!parsed) return;
        cavcodeEventSeqRef.current = Math.max(cavcodeEventSeqRef.current, parsed.nextSeq);
        const lines: string[] = [];
        for (const row of parsed.events || []) {
          const detail = asObjectRecord(row.payload) || {};
          const path = String(detail.path || detail.file || "").trim();
          const branch = String(detail.branch || detail.name || "").trim();
          const hint = path || branch || "";
          lines.push(`[event] ${row.kind}${hint ? ` · ${hint}` : ""}`);
        }
        if (lines.length) termWriteLines(lines.slice(-8));
        if ((parsed.events || []).some((row) => row.kind === "file.write" || row.kind.startsWith("loop."))) {
          void refreshWorkspaceDiagnostics();
        }
      } catch {}
    };

    const handleError = () => {
      if (closed) return;
      closed = true;
      closeCavcodeEventSource();
    };

    source.addEventListener("cavcode_events", handleEvents);
    source.addEventListener("cavcode_error", handleError);
    source.onerror = handleError;

    return () => {
      closed = true;
      source.removeEventListener("cavcode_events", handleEvents);
      source.removeEventListener("cavcode_error", handleError);
      if (cavcodeEventSourceRef.current === source) {
        cavcodeEventSourceRef.current = null;
      }
      try {
        source.close();
      } catch {}
    };
  }, [closeCavcodeEventSource, projectIdFromQuery, refreshWorkspaceDiagnostics, termWriteLines]);

  useEffect(() => {
    if (!debugSessionId || !debugStatus || !DEBUG_STREAM_ACTIVE_STATUSES.has(debugStatus)) {
      closeDebugEventSource();
      if (debugStreamFallbackMode) setDebugStreamFallbackMode(false);
      return;
    }
    if (typeof window === "undefined") return;
    if (debugStreamFallbackMode) return;
    if (typeof window.EventSource === "undefined") {
      if (!debugStreamFallbackMode) setDebugStreamFallbackMode(true);
      return;
    }
    closeDebugEventSource();

    const { projectId, siteOrigin } = readCavtoolsQueryContext();
    const query = new URLSearchParams();
    query.set("sessionId", debugSessionId);
    query.set("afterSeq", String(Math.max(0, Math.trunc(Number(debugLogSeqRef.current) || 0))));
    if (projectId) query.set("projectId", String(projectId));
    if (siteOrigin) query.set("siteOrigin", siteOrigin);

    const source = new window.EventSource(`/api/cavtools/debug/events?${query.toString()}`, { withCredentials: true });
    debugEventSourceRef.current = source;
    let closed = false;

    const handleStatus = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = parseDebugStatusPayload(JSON.parse(data));
        if (!parsed) return;
        const previousSession = debugSessionIdRef.current;
        const previousStatus = debugStatusRef.current;
        applyDebugStatusPayload(parsed);
        if (previousSession !== parsed.sessionId || previousStatus !== parsed.status) {
          termWriteLines(formatCavtoolsBlockToTerminalLines({ kind: "json", data: parsed }));
        }
      } catch {}
    };

    const handleLogs = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = parseDebugLogsPayload(JSON.parse(data));
        if (!parsed) return;
        applyDebugLogsPayload(parsed);
        const lines = formatCavtoolsBlockToTerminalLines({ kind: "json", data: parsed });
        if (lines.length) termWriteLines(lines);
      } catch {}
    };

    const handleTerminalEvent = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as { reason?: string; message?: string; status?: string };
        if (!parsed || typeof parsed !== "object") return;
        if (parsed.message) {
          termWriteLines([fromServerOutputToCodebaseText(String(parsed.message))]);
        } else if (parsed.reason === "completed" && parsed.status) {
          termWriteLines([`[debug] session ${debugSessionId} ${String(parsed.status).toUpperCase()}`]);
        }
      } catch {}
    };

    const handleError = () => {
      if (closed) return;
      if (debugEventSourceRef.current === source) {
        debugEventSourceRef.current = null;
      }
      try {
        source.close();
      } catch {}
      setDebugStreamFallbackMode(true);
    };

    source.addEventListener("debug_status", handleStatus);
    source.addEventListener("debug_logs", handleLogs);
    source.addEventListener("debug_end", handleTerminalEvent);
    source.addEventListener("debug_error", handleTerminalEvent);
    source.onerror = handleError;

    return () => {
      closed = true;
      source.removeEventListener("debug_status", handleStatus);
      source.removeEventListener("debug_logs", handleLogs);
      source.removeEventListener("debug_end", handleTerminalEvent);
      source.removeEventListener("debug_error", handleTerminalEvent);
      source.onerror = null;
      if (debugEventSourceRef.current === source) {
        debugEventSourceRef.current = null;
      }
      try {
        source.close();
      } catch {}
    };
  }, [
    applyDebugLogsPayload,
    applyDebugStatusPayload,
    closeDebugEventSource,
    debugSessionId,
    debugStatus,
    debugStreamFallbackMode,
    termWriteLines,
  ]);

  useEffect(() => {
    if (!runtimeSessionId || !runtimeStatus || !RUNTIME_ACTIVE_STATUSES.has(runtimeStatus)) {
      closeRuntimeEventSource();
      if (runtimeStreamFallbackMode) setRuntimeStreamFallbackMode(false);
      return;
    }
    if (typeof window === "undefined") return;
    if (runtimeStreamFallbackMode) return;
    if (typeof window.EventSource === "undefined") {
      if (!runtimeStreamFallbackMode) setRuntimeStreamFallbackMode(true);
      return;
    }
    closeRuntimeEventSource();

    const { projectId, siteOrigin } = readCavtoolsQueryContext();
    const query = new URLSearchParams();
    query.set("sessionId", runtimeSessionId);
    query.set("afterSeq", String(Math.max(0, Math.trunc(Number(runtimeLogSeqRef.current) || 0))));
    if (projectId) query.set("projectId", String(projectId));
    if (siteOrigin) query.set("siteOrigin", siteOrigin);

    const source = new window.EventSource(`/api/cavtools/runtime/events?${query.toString()}`, { withCredentials: true });
    runtimeEventSourceRef.current = source;
    let closed = false;

    const handleStatus = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = parseRuntimeStatusPayload(JSON.parse(data));
        if (!parsed) return;
        const previousSession = runtimeSessionIdRef.current;
        const previousStatus = runtimeStatusRef.current;
        applyRuntimeStatusPayload(parsed);
        if (previousSession !== parsed.sessionId || previousStatus !== parsed.status) {
          termWriteLines(formatCavtoolsBlockToTerminalLines({ kind: "json", data: parsed }));
        }
      } catch {}
    };

    const handleLogs = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = parseRuntimeLogsPayload(JSON.parse(data));
        if (!parsed) return;
        applyRuntimeLogsPayload(parsed);
        const lines = formatCavtoolsBlockToTerminalLines({ kind: "json", data: parsed });
        if (lines.length) termWriteLines(lines);
      } catch {}
    };

    const handleTerminalEvent = (event: Event) => {
      const data = String((event as MessageEvent<string>).data || "");
      if (!data) return;
      try {
        const parsed = JSON.parse(data) as { reason?: string; message?: string; status?: string };
        if (!parsed || typeof parsed !== "object") return;
        if (parsed.message) {
          termWriteLines([fromServerOutputToCodebaseText(String(parsed.message))]);
        } else if (parsed.reason === "completed" && parsed.status) {
          termWriteLines([`[runtime] session ${runtimeSessionId} ${String(parsed.status).toUpperCase()}`]);
        }
      } catch {}
    };

    const handleError = () => {
      if (closed) return;
      if (runtimeEventSourceRef.current === source) {
        runtimeEventSourceRef.current = null;
      }
      try {
        source.close();
      } catch {}
      setRuntimeStreamFallbackMode(true);
    };

    source.addEventListener("runtime_status", handleStatus);
    source.addEventListener("runtime_logs", handleLogs);
    source.addEventListener("runtime_end", handleTerminalEvent);
    source.addEventListener("runtime_error", handleTerminalEvent);
    source.onerror = handleError;

    return () => {
      closed = true;
      source.removeEventListener("runtime_status", handleStatus);
      source.removeEventListener("runtime_logs", handleLogs);
      source.removeEventListener("runtime_end", handleTerminalEvent);
      source.removeEventListener("runtime_error", handleTerminalEvent);
      source.onerror = null;
      if (runtimeEventSourceRef.current === source) {
        runtimeEventSourceRef.current = null;
      }
      try {
        source.close();
      } catch {}
    };
  }, [
    applyRuntimeLogsPayload,
    applyRuntimeStatusPayload,
    closeRuntimeEventSource,
    runtimeSessionId,
    runtimeStatus,
    runtimeStreamFallbackMode,
    termWriteLines,
  ]);

  useEffect(() => {
    if (!runtimeSessionId || !runtimeStatus || !RUNTIME_ACTIVE_STATUSES.has(runtimeStatus)) return;
    if (
      typeof window !== "undefined"
      && typeof window.EventSource !== "undefined"
      && !runtimeStreamFallbackMode
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (cancelled) return;
      if (runtimePollBusyRef.current) {
        schedule(950);
        return;
      }
      runtimePollBusyRef.current = true;
      try {
        const afterSeq = Math.max(0, Math.trunc(Number(runtimeLogSeqRef.current) || 0));
        const result = await callCavtoolsExec(`cav run logs ${runtimeSessionId} ${afterSeq}`, "/cavcode");
        if (!result) return;
        const lines: string[] = [];
        applyRuntimePayloadsFromBlocks(result.blocks || []);
        for (const block of result.blocks || []) {
          lines.push(...formatCavtoolsBlockToTerminalLines(block));
        }
        for (const warning of result.warnings || []) {
          lines.push(fromServerOutputToCodebaseText(warning));
        }
        if (!result.ok && lines.length === 0) {
          lines.push(fromServerOutputToCodebaseText(result.error?.message || "Runtime polling failed."));
        }
        if (lines.length) termWriteLines(lines);
      } finally {
        runtimePollBusyRef.current = false;
      }

      if (cancelled) return;
      if (runtimeSessionIdRef.current !== runtimeSessionId) return;
      const latestStatus = runtimeStatusRef.current;
      if (latestStatus && RUNTIME_ACTIVE_STATUSES.has(latestStatus)) {
        schedule(900);
      }
    };

    schedule(220);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [applyRuntimePayloadsFromBlocks, callCavtoolsExec, runtimeSessionId, runtimeStatus, runtimeStreamFallbackMode, termWriteLines]);

  useEffect(() => {
    if (!debugSessionId || !debugStatus || !DEBUG_STREAM_ACTIVE_STATUSES.has(debugStatus)) return;
    if (
      typeof window !== "undefined"
      && typeof window.EventSource !== "undefined"
      && !debugStreamFallbackMode
    ) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        timer = null;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (cancelled) return;
      if (debugPollBusyRef.current) {
        schedule(950);
        return;
      }
      debugPollBusyRef.current = true;
      try {
        const afterSeq = Math.max(0, Math.trunc(Number(debugLogSeqRef.current) || 0));
        const result = await callCavtoolsExec(`cav debug logs ${debugSessionId} ${afterSeq}`, "/cavcode");
        if (!result) return;
        const lines: string[] = [];
        applyDebugPayloadsFromBlocks(result.blocks || []);
        for (const block of result.blocks || []) {
          lines.push(...formatCavtoolsBlockToTerminalLines(block));
        }
        for (const warning of result.warnings || []) {
          lines.push(fromServerOutputToCodebaseText(warning));
        }
        if (!result.ok && lines.length === 0) {
          lines.push(fromServerOutputToCodebaseText(result.error?.message || "Debug polling failed."));
        }
        if (lines.length) termWriteLines(lines);
      } finally {
        debugPollBusyRef.current = false;
      }

      if (cancelled) return;
      if (debugSessionIdRef.current !== debugSessionId) return;
      const latestStatus = debugStatusRef.current;
      if (latestStatus && DEBUG_STREAM_ACTIVE_STATUSES.has(latestStatus)) {
        schedule(900);
      }
    };

    schedule(220);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [applyDebugPayloadsFromBlocks, callCavtoolsExec, debugSessionId, debugStatus, debugStreamFallbackMode, termWriteLines]);

  function runPanelAction(action: "dev" | "build" | "lint" | "test") {
    setPanelOpen(true);
    setPanelTab("terminal");

    if (action === "lint") {
      void runCmd("lint");
      return;
    }
    if (runtimeActionBusy) return;
    setRuntimeActionBusy(action);
    void runCmd(`cav run ${action}`).finally(() => {
      setRuntimeActionBusy("");
    });
  }

  function stopRuntimeSessionFromPanel() {
    if (!runtimeSessionId || runtimeActionBusy) return;
    setPanelOpen(true);
    setPanelTab("terminal");
    setRuntimeActionBusy("stop");
    void runCmd(`cav run stop ${runtimeSessionId}`).finally(() => {
      setRuntimeActionBusy("");
    });
  }

  function restartRuntimeSessionFromPanel() {
    if (!runtimeSessionId || runtimeActionBusy) return;
    setPanelOpen(true);
    setPanelTab("terminal");
    setRuntimeActionBusy("restart");
    void runCmd(`cav run restart ${runtimeSessionId}`).finally(() => {
      setRuntimeActionBusy("");
    });
  }

  function focusDebugLocation(filePath: string | null, line: number | null, column: number | null) {
    const file = normalizePath(String(filePath || ""));
    if (!file || !file.startsWith("/cavcode/")) return;
    const codePath = toCodebasePathFromCavcode(file);
    const node = findNodeByPath(fs, codePath);
    if (node && isFile(node)) {
      openFile(node);
      window.setTimeout(() => {
        const ed = editorRef.current;
        if (!ed) return;
        try {
          ed.revealPositionInCenter({
            lineNumber: line && line > 0 ? line : 1,
            column: column && column > 0 ? column : 1,
          });
          ed.setPosition({
            lineNumber: line && line > 0 ? line : 1,
            column: column && column > 0 ? column : 1,
          });
          ed.focus();
        } catch {}
      }, 0);
    }
  }

  function startDebugSessionFromPanel() {
    if (debugActionBusy) return;
    const activePath = activeFile?.path ? toCavcodePathFromCodebase(activeFile.path) : "";
    if (!activePath || !activePath.startsWith("/cavcode/")) {
      pushToast("Open a codebase file to start debugging.", "watch");
      return;
    }
    setPanelOpen(true);
    setPanelTab("terminal");
    setDebugActionBusy("start");
    void runCmd(`cav debug start ${quoteForCavArg(activePath)}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function sendDebugControl(action: "continue" | "pause" | "next" | "step" | "out" | "stop" | "status") {
    if (!debugSessionId || debugActionBusy) return;
    setPanelOpen(true);
    setPanelTab("terminal");
    setDebugActionBusy(action);
    const command =
      action === "status"
        ? `cav debug status ${debugSessionId}`
        : action === "stop"
          ? `cav debug stop ${debugSessionId}`
          : `cav debug ${action} ${debugSessionId}`;
    void runCmd(command).finally(() => {
      setDebugActionBusy("");
    });
  }

  function addDebugBreakpointAtCursor() {
    const activePath = activeFile?.path ? toCavcodePathFromCodebase(activeFile.path) : "";
    if (!activePath || !activePath.startsWith("/cavcode/")) {
      pushToast("Open a file to add a breakpoint.", "watch");
      return;
    }
    if (!debugSessionId || debugActionBusy) return;
    const target = `${activePath}:${Math.max(1, Math.trunc(Number(cursorPos.line) || 1))}`;
    setDebugActionBusy("break-set");
    void runCmd(`cav debug break set ${quoteForCavArg(target)} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function clearDebugBreakpointAtCursor() {
    const activePath = activeFile?.path ? toCavcodePathFromCodebase(activeFile.path) : "";
    if (!activePath || !activePath.startsWith("/cavcode/")) {
      pushToast("Open a file to clear a breakpoint.", "watch");
      return;
    }
    if (!debugSessionId || debugActionBusy) return;
    const target = `${activePath}:${Math.max(1, Math.trunc(Number(cursorPos.line) || 1))}`;
    setDebugActionBusy("break-clear");
    void runCmd(`cav debug break clear ${quoteForCavArg(target)} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function addDebugWatchFromPanel() {
    const expression = String(debugWatchInput || "").trim();
    if (!expression) return;
    if (!debugSessionId || debugActionBusy) return;
    setDebugActionBusy("watch-add");
    const quoted = quoteForCavArg(expression);
    void runCmd(`cav debug watch add ${quoted} ${debugSessionId}`).finally(() => {
      setDebugWatchInput("");
      setDebugActionBusy("");
    });
  }

  function removeDebugWatchFromPanel(expression: string) {
    const expr = String(expression || "").trim();
    if (!expr || !debugSessionId || debugActionBusy) return;
    setDebugActionBusy("watch-remove");
    const quoted = quoteForCavArg(expr);
    void runCmd(`cav debug watch remove ${quoted} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function selectDebugFrameFromPanel(frameOrdinal: number, frame: DebugStackFrame) {
    if (!debugSessionId || debugActionBusy) return;
    setDebugActionBusy("frame-select");
    void runCmd(`cav debug frame select ${Math.max(1, Math.trunc(frameOrdinal))} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
    focusDebugLocation(frame.file, frame.line, frame.column);
  }

  function inspectDebugScopeVariables(variablesReference: number) {
    if (!debugSessionId || debugActionBusy) return;
    const ref = Math.max(0, Math.trunc(Number(variablesReference) || 0));
    if (ref <= 0) return;
    setDebugActionBusy("vars");
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(`cav debug vars ${ref} 0 120 ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function runDebugEvaluateFromPanel(mode: "evaluate" | "repl" = "evaluate") {
    const expression = String(debugEvalInput || "").trim();
    if (!expression || !debugSessionId || debugActionBusy) return;
    const frameOrdinal = Number.isFinite(Number(debugSelectedFrameOrdinal)) ? Math.max(1, Math.trunc(Number(debugSelectedFrameOrdinal))) : null;
    setDebugActionBusy(mode === "repl" ? "repl" : "evaluate");
    const quoted = quoteForCavArg(expression);
    const command = mode === "repl"
      ? `cav debug repl ${quoted} ${debugSessionId}`
      : frameOrdinal
        ? `cav debug evaluate ${quoted} ${frameOrdinal} ${debugSessionId}`
        : `cav debug evaluate ${quoted} ${debugSessionId}`;
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(command).finally(() => {
      setDebugActionBusy("");
    });
  }

  function setDebugExceptionMode(mode: "none" | "uncaught" | "all") {
    if (!debugSessionId || debugActionBusy) return;
    setDebugActionBusy("exceptions");
    void runCmd(`cav debug break exceptions set ${mode} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function refreshDebugLaunchManifestFromPanel() {
    if (debugActionBusy) return;
    setDebugActionBusy("launch-refresh");
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd("cav debug config list").finally(() => {
      setDebugActionBusy("");
    });
  }

  function startDebugFromLaunchSelection(mode: "start" | "attach") {
    const rawSelector = String(debugLaunchSelector || "").trim();
    if (!rawSelector || debugActionBusy) return;
    const selector = rawSelector.includes(":") ? rawSelector.split(":").slice(1).join(":") : rawSelector;
    if (mode === "attach" && debugLaunchSelectorType === "compound") {
      pushToast("Compound attach is not supported. Select an attach target.", "watch");
      return;
    }
    const args: string[] = [
      `cav debug config ${mode}`,
      quoteForCavArg(selector),
    ];
    if (debugLaunchProfileOverride) {
      args.push("--profile", quoteForCavArg(debugLaunchProfileOverride));
    }
    if (debugLaunchVariantOverride) {
      args.push("--variant", quoteForCavArg(debugLaunchVariantOverride));
    }
    args.push(debugLaunchSelectorType === "compound" ? "--compound" : "--target");
    setDebugActionBusy(mode === "attach" ? "launch-attach" : "launch-start");
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(args.join(" ")).finally(() => {
      setDebugActionBusy("");
      void runCmd("cav debug status --all");
    });
  }

  function selectDebugSessionFromPanel(sessionId: string) {
    const id = String(sessionId || "").trim();
    if (!id || debugActionBusy) return;
    setDebugActionBusy("session-select");
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(`cav debug select ${quoteForCavArg(id)}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  function selectDebugThreadFromPanel(threadId: number) {
    if (!debugSessionId || debugActionBusy) return;
    const id = Math.max(0, Math.trunc(Number(threadId) || 0));
    setDebugActionBusy("thread-select");
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(`cav debug threads select ${id} ${debugSessionId}`).finally(() => {
      setDebugActionBusy("");
    });
  }

  async function refreshChangesStatus() {
    if (changesActionBusy) return;
    setChangesActionBusy("changes-status");
    try {
      const statusResult = await callCavtoolsExec("cav git status", "/cavcode");
      if (statusResult?.blocks) {
        applyScmPayloadsFromBlocks(statusResult.blocks);
      }
    } finally {
      setChangesActionBusy("");
    }
  }

  function runScmCommandFromChanges(command: string, busyTag: string) {
    if (!command || changesActionBusy) return;
    setChangesActionBusy(busyTag);
    void runCmd(command).finally(() => {
      setChangesActionBusy("");
    });
  }

  const loadChangesCompare = useCallback(async (
    pathValue: string,
    mode: GitCompareMode,
    force = false
  ): Promise<GitComparePayload | null> => {
    const relPath = String(pathValue || "").trim();
    if (!relPath) return null;
    const compareKey = toChangesCompareKey(mode, relPath);
    if (!force && changesCompareByKey[compareKey]) return changesCompareByKey[compareKey];
    if (changesCompareBusyKey === compareKey) return null;
    setChangesCompareBusyKey(compareKey);
    try {
      const modeFlag = mode === "staged" ? "--staged" : "--unstaged";
      const command = `cav git compare ${quoteForCavArg(relPath)} ${modeFlag}`;
      const result = await callCavtoolsExec(command, "/cavcode");
      if (!result?.blocks) return null;
      applyScmPayloadsFromBlocks(result.blocks);
      let payload: GitComparePayload | null = null;
      for (const block of result.blocks) {
        const maybe = readGitComparePayloadFromBlock(block);
        if (maybe) payload = maybe;
      }
      if (payload) {
        const nextKey = toChangesCompareKey(payload.mode, payload.path);
        setChangesCompareByKey((prev) => ({ ...prev, [nextKey]: payload }));
        return payload;
      }
      if (!result.ok) {
        pushToast(result.error?.message || "Compare failed.", "bad");
      }
      return null;
    } finally {
      setChangesCompareBusyKey("");
    }
  }, [applyScmPayloadsFromBlocks, callCavtoolsExec, changesCompareByKey, changesCompareBusyKey, pushToast]);

  function openCodeFileFromChanges(pathValue: string) {
    const relPath = String(pathValue || "").trim().replace(/^\/+/, "");
    if (!relPath) return;
    const codebasePath = `/codebase/${relPath}`;
    if (openWorkspaceFileByPathForAi(codebasePath)) {
      return;
    }
    void hydrateCodebaseFileFromServer(codebasePath).then(() => {
      window.setTimeout(() => {
        if (!openWorkspaceFileByPathForAi(codebasePath)) {
          pushToast(`File not found in workspace: ${codebasePath}`, "watch");
        }
      }, 0);
    });
  }

  function openChangesCompare(entry: ChangesListEntry) {
    const relPath = String(entry.path || "").trim();
    if (!relPath) return;
    const mode = entry.mode;
    const tabId = toChangesCompareTabId(relPath, mode);
    const shortName = fileNameFromPath(relPath);
    const suffix = mode === "staged" ? "(Index)" : "(Working Tree)";
    setTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) return prev;
      return [
        ...prev,
        {
          id: tabId,
          path: `/codebase/${relPath.replace(/^\/+/, "")}`,
          name: `${shortName} ${suffix}`,
          lang: "diff",
          kind: "git-compare-single",
        },
      ];
    });
    setActivePane("primary");
    setActiveFileId(tabId);
    setActivity("changes");
    setSidebarOpen(true);
    void loadChangesCompare(relPath, mode);
  }

  function openChangesAggregateTab(mode: GitCompareMode) {
    const tabId = toChangesAggregateTabId(mode);
    const count = mode === "staged" ? stagedChangesEntries.length : unstagedChangesEntries.length;
    const tabName = `Git: Changes (${count} files)`;
    setTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) {
        return prev.map((tab) => (tab.id === tabId ? { ...tab, name: tabName } : tab));
      }
      return [
        ...prev,
        {
          id: tabId,
          path: `/codebase/.git/changes/${mode}`,
          name: tabName,
          lang: "diff",
          kind: "git-compare-aggregate",
        },
      ];
    });
    setActivePane("primary");
    setActiveFileId(tabId);
    setActivity("changes");
    setSidebarOpen(true);
    const firstEntry = (mode === "staged" ? stagedChangesEntries : unstagedChangesEntries)[0];
    if (firstEntry) {
      const firstKey = toChangesCompareKey(firstEntry.mode, firstEntry.path);
      setChangesAggregateSelectionKey(firstKey);
      void loadChangesCompare(firstEntry.path, firstEntry.mode);
    }
  }

  function runChangesStageToggle(entry: ChangesListEntry) {
    const relPath = String(entry.path || "").trim();
    if (!relPath) return;
    if (entry.mode === "staged") {
      runScmCommandFromChanges(`cav git unstage ${quoteForCavArg(relPath)}`, "changes-unstage-file");
      return;
    }
    runScmCommandFromChanges(`cav git stage ${quoteForCavArg(relPath)}`, "changes-stage-file");
  }

  async function runChangesCommitAiDraft(mode: CommitMessageAiMode, helpPromptInput?: string) {
    if (changesCommitAiBusy) return;
    const helpPrompt = String(helpPromptInput || "").trim();
    if (mode === "help_write" && !helpPrompt) {
      pushToast("Add a brief prompt for CavAi first.", "watch");
      return;
    }
    const currentMessage = String(changesCommitMessage || "").trim();
    const branchLabel = String(scmStatusPayload?.branch || "main").trim() || "main";
    const upstreamLabel = String(scmStatusPayload?.upstream || "").trim();
    const stagedPreview = stagedChangesEntries
      .slice(0, 40)
      .map((entry) => `${entry.statusLetter} ${entry.renameFrom ? `${entry.renameFrom} -> ${entry.path}` : entry.path}`)
      .join("\n");
    const unstagedPreview = unstagedChangesEntries
      .slice(0, 40)
      .map((entry) => `${entry.statusLetter} ${entry.renameFrom ? `${entry.renameFrom} -> ${entry.path}` : entry.path}`)
      .join("\n");
    const action = mode === "help_write" && currentMessage ? "rewrite_clearly" : "write_note";
    const goal = mode === "help_write"
      ? `Rewrite this commit message based on instruction: ${helpPrompt}`
      : "Generate a concise commit message from current git changes.";
    const prompt = mode === "help_write"
      ? [
          "Rewrite the commit message using the user's instruction and current git context.",
          "Return exactly one commit subject line in plain text.",
          "Keep it concise (ideally under 72 characters), imperative, and specific.",
          "Do not use markdown, bullets, labels, or quotes.",
          `User instruction:\n${helpPrompt}`,
          `Current commit message: ${currentMessage || "(empty)"}`,
          `Branch: ${branchLabel}${upstreamLabel ? ` -> ${upstreamLabel}` : ""}`,
          `Staged count: ${stagedChangesEntries.length}`,
          `Unstaged count: ${unstagedChangesEntries.length}`,
          `Staged files:\n${stagedPreview || "(none)"}`,
          `Unstaged files:\n${unstagedPreview || "(none)"}`,
        ].join("\n\n")
      : [
          "Generate a git commit message from current repo changes.",
          "Return exactly one commit subject line in plain text.",
          "Keep it concise (ideally under 72 characters), imperative, and specific.",
          "Do not use markdown, bullets, labels, or quotes.",
          currentMessage ? `Current draft to improve (optional): ${currentMessage}` : "",
          `Branch: ${branchLabel}${upstreamLabel ? ` -> ${upstreamLabel}` : ""}`,
          `Ahead: ${scmStatusPayload?.ahead ?? 0}`,
          `Behind: ${scmStatusPayload?.behind ?? 0}`,
          `Conflicts: ${scmStatusPayload?.conflictedCount ?? 0}`,
          `Staged count: ${stagedChangesEntries.length}`,
          `Unstaged count: ${unstagedChangesEntries.length}`,
          `Staged files:\n${stagedPreview || "(none)"}`,
          `Unstaged files:\n${unstagedPreview || "(none)"}`,
        ]
          .filter(Boolean)
          .join("\n\n");

    const selectedModelLabel =
      changesCommitAiModelOptions.find((row) => row.id === changesCommitAiModelId)?.label
      || resolveAiModelLabel(changesCommitAiModelId)
      || "Model";

    setChangesCommitAiBusy(true);
    setChangesCommitAiWorkingMode(mode);
    setChangesCommitAiMenuOpen(mode === "generate_message");
    setChangesCommitAiPromptOpen(false);
    setChangesCommitMenuOpen(false);
    try {
      const res = await fetch("/api/ai/center/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          action,
          surface: "cavcode",
          goal,
          prompt,
          model: changesCommitAiModelId,
          reasoningLevel: changesCommitAiReasoningLevel,
          sessionId: String(changesCommitAiSessionId || "").trim() || undefined,
          contextLabel: "CavCode commit message",
          context: {
            mode,
            planId: accountPlanId,
            branch: branchLabel,
            upstream: upstreamLabel || null,
            stagedCount: stagedChangesEntries.length,
            unstagedCount: unstagedChangesEntries.length,
            selectedModel: changesCommitAiModelId,
            selectedModelLabel,
            reasoningLevel: changesCommitAiReasoningLevel,
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sessionId?: unknown;
        message?: unknown;
        data?: {
          answer?: unknown;
          summary?: unknown;
        };
      };
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(String(body.message || "CavAi commit message request failed."));
      }

      const nextSessionId = String(body.sessionId || "").trim();
      if (nextSessionId) setChangesCommitAiSessionId(nextSessionId);

      const nextMessage =
        normalizeCommitMessageFromAi(body.data.answer || "")
        || normalizeCommitMessageFromAi(body.data.summary || "");
      if (!nextMessage) {
        throw new Error("CavAi returned a commit message that could not be applied.");
      }
      setChangesCommitMessage(nextMessage);
      pushToast(mode === "generate_message" ? "CavAi generated your commit message." : "CavAi updated your commit message.", "good");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "CavAi commit message request failed.", "bad");
    } finally {
      setChangesCommitAiBusy(false);
      setChangesCommitAiWorkingMode(null);
      setChangesCommitAiMenuOpen(false);
      setChangesCommitAiPromptOpen(false);
      setChangesCommitAiPromptText("");
    }
  }

  function openChangesCommitAiPrompt() {
    if (changesCommitAiBusy) return;
    setChangesCommitMenuOpen(false);
    setChangesCommitAiMenuOpen(false);
    setChangesCommitAiPromptText("");
    setChangesCommitAiPromptOpen(true);
  }

  function submitChangesCommitAiPrompt() {
    if (changesCommitAiBusy) return;
    const trimmed = String(changesCommitAiPromptText || "").trim();
    if (!trimmed) {
      changesCommitAiHelpPromptInputRef.current?.focus();
      return;
    }
    void runChangesCommitAiDraft("help_write", trimmed);
  }

  function runChangesCommitAction(action: "commit" | "amend" | "commit-push" | "commit-sync") {
    if (changesActionBusy || changesCommitAiBusy) return;
    const message = String(changesCommitMessage || "").trim();
    if ((action === "commit" || action === "commit-push" || action === "commit-sync") && !message) {
      pushToast("Enter a commit message first.", "watch");
      return;
    }
    setChangesCommitMenuOpen(false);
    setChangesCommitAiMenuOpen(false);
    setChangesCommitAiPromptOpen(false);
    setChangesActionBusy(action);
    void (async () => {
      if (action === "amend") {
        await runCmd("cav git commit --amend");
      } else if (action === "commit") {
        await runCmd(`cav git commit ${quoteForCavArg(message)}`);
      } else if (action === "commit-push") {
        await runCmd(`cav git commit ${quoteForCavArg(message)}`);
        await runCmd(buildScmRemoteCommand("push"));
      } else if (action === "commit-sync") {
        await runCmd(`cav git commit ${quoteForCavArg(message)}`);
        await runCmd("cav git sync");
      }
      await refreshChangesStatus();
    })().finally(() => {
      setChangesActionBusy("");
    });
  }

  function runScmCommandFromPanel(command: string, busyTag: string) {
    if (!command || scmActionBusy) return;
    setScmActionBusy(busyTag);
    setPanelOpen(true);
    setPanelTab("terminal");
    void runCmd(command).finally(() => {
      setScmActionBusy("");
    });
  }

  function refreshScmStatusFromPanel() {
    runScmCommandFromPanel("cav git status", "status");
  }

  function runScmPartialStage(mode: "stage" | "unstage") {
    const rawPath = String(scmPartialPath || "").trim();
    const fallbackPath = activeFile?.path ? toCavcodePathFromCodebase(activeFile.path) : "";
    const pathValue = rawPath || fallbackPath;
    if (!pathValue) {
      pushToast("Select a file path for partial staging.", "watch");
      return;
    }
    const pathArg = pathValue.startsWith("/codebase/") ? toCavcodePathFromCodebase(pathValue) : pathValue;
    const startRaw = Number(scmPartialStartLine);
    const endRaw = Number(scmPartialEndLine);
    const start = Number.isFinite(startRaw) && startRaw > 0 ? Math.trunc(startRaw) : 1;
    const end = Number.isFinite(endRaw) && endRaw >= start ? Math.trunc(endRaw) : start;
    runScmCommandFromPanel(
      `cav git ${mode} line ${quoteForCavArg(pathArg)} ${start} ${end}`,
      `${mode}-partial`
    );
  }

  function resolveScmConflictFromPanel(strategy: "ours" | "theirs" | "both") {
    const pathValue = String(scmConflictPathInput || "").trim();
    if (!pathValue) {
      pushToast("Enter a conflict file path.", "watch");
      return;
    }
    const pathArg = pathValue.startsWith("/codebase/") ? toCavcodePathFromCodebase(pathValue) : pathValue;
    runScmCommandFromPanel(
      `cav git conflicts resolve ${quoteForCavArg(pathArg)} ${strategy}`,
      `conflict-${strategy}`
    );
  }

  function buildScmRemoteCommand(action: "fetch" | "pull" | "push"): string {
    const remote = String(scmRemoteNameInput || "").trim();
    const branch = String(scmRemoteBranchInput || "").trim();
    const parts: string[] = ["cav git", action];
    if (action === "push") parts.push("--set-upstream");
    if (remote) parts.push(quoteForCavArg(remote));
    if (branch) parts.push(quoteForCavArg(branch));
    return parts.join(" ");
  }

  function handleTermKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = termInput;
      setTermInput("");
      void runCmd(v);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setTermInput("");
      termHistIndexRef.current = -1;
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const hist = termHistoryRef.current;
      if (!hist.length) return;
      const next = Math.min(hist.length - 1, termHistIndexRef.current + 1);
      termHistIndexRef.current = next;
      setTermInput(hist[next] || "");
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const hist = termHistoryRef.current;
      if (!hist.length) return;
      const next = Math.max(-1, termHistIndexRef.current - 1);
      termHistIndexRef.current = next;
      setTermInput(next === -1 ? "" : hist[next] || "");
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const current = String(termInput || "").trim();
      if (!current) {
        setTermInput("cav ");
        return;
      }
      const lc = current.toLowerCase();
      const hit = KNOWN_COMMANDS.find((x) => x.toLowerCase().startsWith(lc));
      if (hit) {
        setTermInput(hit);
        return;
      }
      const hit2 = KNOWN_COMMANDS.find((x) => x.toLowerCase().includes(lc));
      if (hit2) setTermInput(hit2);
    }
  }

  function buildCavCtx(): CavContext {
    const qsInfo = (() => {
      if (typeof window === "undefined") return { pairs: [] as Array<[string, string]>, project: "", site: "" };
      try {
        const sp = new URLSearchParams(window.location.search);
        const project = (sp.get("project") || "").trim();
        const site = (sp.get("site") || "").trim();
        const pairs: Array<[string, string]> = [];
        if (project) pairs.push(["project", project]);
        if (site) pairs.push(["site", site]);
        return { pairs, project, site };
      } catch {
        return { pairs: [] as Array<[string, string]>, project: "", site: "" };
      }
    })();

    const navigate = (path: string, pairs?: Array<[string, string]>) => {
      const all = pairs && pairs.length ? pairs : qsInfo.pairs;
      if (!all.length) {
        router.push(path);
        return;
      }
      const qs = all.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      router.push(`${path}?${qs}`);
    };
    const openLive = (path: string, pairs?: Array<[string, string]>) => {
      const all = pairs && pairs.length ? [...pairs] : [...qsInfo.pairs];
      if (activeFile?.path && isHtmlFilePath(activeFile.path)) {
        all.push(["file", activeFile.path]);
      }
      const hasProject = all.some(([k, v]) => (k === "project" || k === "projectId") && String(v || "").trim().length > 0);
      const hasMount = all.some(([k]) => k === "mount");
      if (hasProject && !hasMount) all.push(["mount", "1"]);
      const qs = all.length ? `?${all.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
      window.open(`${path}${qs}`, "_blank", "noopener,noreferrer");
    };

    const openWorkspaceFile = (path: string, opts?: { line?: number; col?: number; focus?: boolean }) => {
      const node = findNodeByPath(fs, path);
      if (node && isFile(node)) {
        openFile(node);
        if (opts?.focus) {
          window.setTimeout(() => {
            const ed = editorRef.current;
            if (!ed) return;
            try {
              ed.revealPositionInCenter({ lineNumber: opts.line || 1, column: opts.col || 1 });
              ed.setPosition({ lineNumber: opts.line || 1, column: opts.col || 1 });
              ed.focus();
            } catch {}
          }, 0);
        }
      }
    };

    const openCodebaseFile = (absPath: string, opts?: { line?: number; col?: number; focus?: boolean }) => {
      const abs = toCodebaseAbs(absPath, codebaseFs.cwd);
      const node = codebaseFs.nodes[abs];
      if (!node || node.type !== "file") return;

      const updated = upsertCodebaseFolderIntoWorkspace(safeClone(fs), codebaseFs);
      const leaf = findNodeByPath(updated, abs);
      if (leaf && isFile(leaf)) {
        setFS(updated);
        openFile(leaf);
        void hydrateCodebaseFileFromServer(abs);
        if (opts?.focus) {
          window.setTimeout(() => {
            const ed = editorRef.current;
            if (!ed) return;
            try {
              ed.revealPositionInCenter({ lineNumber: opts.line || 1, column: opts.col || 1 });
              ed.setPosition({ lineNumber: opts.line || 1, column: opts.col || 1 });
              ed.focus();
            } catch {}
          }, 0);
        }
      } else {
        setFS(updated);
      }
    };

    return {
      operator: operatorName,
      projectId: qsInfo.project || null,
      siteOrigin: qsInfo.site || null,
      pageKind: "cavcode",
      activeFilePath: activeFile?.path || "",
      now: () => Date.now(),

      navigate,
      openLive,
      getQSBasePairs: () => qsInfo.pairs,

      setTab: (key) => setActivity(key as Activity),
      focusTerminal: () => {
        const el = document.querySelector<HTMLInputElement>(".cc-term-in");
        el?.focus();
      },
      focusEditor: () => editorRef.current?.focus?.(),

      openCodebaseFile,
      openWorkspaceFile,

      getMarkers: () =>
        problems.map((p) => ({
          file: p.file,
          line: p.line,
          col: p.col,
          severity: p.severity === "error" ? "error" : "warn",
          message: p.message,
        })),

      getEventCounts: () => {
        const errors = problems.filter((p) => p.severity === "error").length;
        const warnings = problems.filter((p) => p.severity === "warn").length;
        return { errors, warnings };
      },

      clearOutput: () => setTermLines(terminalBootLines),

      codebaseGet: () => codebaseFs,
      codebaseSet: (next) => {
        setCodebaseFs(next);
        setFS((prev) => upsertCodebaseFolderIntoWorkspace(prev, next));
      },
      codebaseUpdate: (mutator) =>
        setCodebaseFs((prev) => {
          const next = mutator(prev);
          setFS((root) => upsertCodebaseFolderIntoWorkspace(root, next));
          return next;
        }),

      workspaceGet: () => fs as unknown as WorkspaceNode,
      workspaceSet: (next: WorkspaceNode) => setFS(next as unknown as FolderNode),
      workspaceUpdate: (mutator: (prev: WorkspaceNode) => WorkspaceNode) =>
        setFS((prev) => mutator(prev as unknown as WorkspaceNode) as unknown as FolderNode),

      forceSync: () => {
        void syncCodebaseFsFromServer({ silent: true });
      },
      getSyncStatus: () => codebaseSyncStatus,

      liveUrl: LIVE_VIEWER_URL,
      getExportPayload: () => {
        return {
          operator: operatorName,
          projectId: qsInfo.project || null,
          siteOrigin: qsInfo.site || null,
          activeFile: activeFile?.path || null,
          tabs,
          problems,
          codebase: {
            cwd: codebaseFs.cwd,
            files: Object.keys(codebaseFs.nodes)
              .map((k) => codebaseFs.nodes[k])
              .filter(Boolean)
              .filter((n) => n.type === "file" && n.path.startsWith("/codebase/"))
              .slice(0, 250)
              .map((n) => ({ path: n.path, updatedAt: n.updatedAt })),
          },
          workspace: {
            files: listFiles(fs).map((f) => ({ path: f.path, lang: f.lang })),
          },
          ts: Date.now(),
        };
      },
    };
  }

  function openLiveWithActiveFile() {
    try {
      const sp = new URLSearchParams(window.location.search);
      const project = (sp.get("project") || "").trim();
      const site = (sp.get("site") || "").trim();
      const pairs: Array<[string, string]> = [];
      if (project) pairs.push(["project", project]);
      if (site) pairs.push(["site", site]);
      if (activeFile?.path && isHtmlFilePath(activeFile.path)) {
        pairs.push(["file", activeFile.path]);
      }
      if (project && !pairs.some(([k]) => k === "mount")) {
        pairs.push(["mount", "1"]);
      }
      const qs = pairs.length ? `?${pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : "";
      window.open(`${LIVE_VIEWER_URL}${qs}`, "_blank", "noopener,noreferrer");
    } catch {
      window.open(LIVE_VIEWER_URL, "_blank", "noopener,noreferrer");
    }
  }

  useEffect(() => {
    if (!termOutRef.current) return;
    termOutRef.current.scrollTop = termOutRef.current.scrollHeight;
  }, [termLines]);

  /* =========================
    Monaco mount + diagnostics
  ========================= */
  function disposePaneDisposables(pane: EditorPane) {
    const bag = paneDisposablesRef.current[pane];
    if (!bag.length) return;
    for (const item of bag) {
      try {
        item.dispose();
      } catch {}
    }
    paneDisposablesRef.current[pane] = [];
  }

  function bindCursorTracking(editor: MonacoType.editor.IStandaloneCodeEditor) {
    try {
      cursorDispRef.current?.dispose();
    } catch {}
    cursorDispRef.current = editor.onDidChangeCursorPosition((e) => {
      const line = e.position?.lineNumber || 1;
      const col = e.position?.column || 1;
      setCursorPos({ line, col });
    });
  }

  function onEditorMount(editor: MonacoType.editor.IStandaloneCodeEditor, monaco: MonacoApi, pane: EditorPane = "primary") {
    editorRefs.current[pane] = editor;
    editorRef.current = editor;
    monacoRef.current = monaco;

    try {
      // Monaco workers (Next.js compatible)
      const globalEnv = globalThis as typeof globalThis & {
        MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
      };
      if (typeof window !== "undefined" && !globalEnv.MonacoEnvironment) {
        globalEnv.MonacoEnvironment = {
          getWorker: function (_moduleId: string, label: string) {
            if (label === "json") {
              return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker", import.meta.url), { type: "module" });
            }
            if (label === "css" || label === "scss" || label === "less") {
              return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker", import.meta.url), { type: "module" });
            }
            if (label === "html" || label === "handlebars" || label === "razor") {
              return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker", import.meta.url), { type: "module" });
            }
            if (label === "typescript" || label === "javascript") {
              return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker", import.meta.url), { type: "module" });
            }
            return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker", import.meta.url), { type: "module" });
          },
        };
      }
    } catch {}

    monaco.editor.defineTheme("cavbot-default", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "98A3B3" },
        { token: "string", foreground: "C6E48B" },
        { token: "keyword", foreground: "8B5CFF" },
        { token: "number", foreground: "FFCC66" },
        { token: "type.identifier", foreground: "B9C85A" },
      ],
      colors: {
        "editor.background": "#070A16",
        "editor.foreground": "#EAF0FF",
        "editorLineNumber.foreground": "#5A6475",
        "editorLineNumber.activeForeground": "#B9C85A",
        "editorCursor.foreground": "#B9C85A",
        "editor.selectionBackground": "#2A1F55",
        "editor.inactiveSelectionBackground": "#1A1730",
        "editorIndentGuide.background": "#20253A",
        "editorIndentGuide.activeBackground": "#343B58",
        "editorWidget.background": "#0A0F22",
        "editorSuggestWidget.background": "#0A0F22",
        "editorSuggestWidget.border": "#2A3352",
        "editorHoverWidget.background": "#0A0F22",
        "editorHoverWidget.border": "#2A3352",
        "peekView.border": "#2A3352",
        "inputValidation.errorBorder": "#2A3352",
        "editorError.foreground": "#FF4D4D",
        "editorWarning.foreground": "#FFCC66",
      },
    });

    monaco.editor.defineTheme("cavbot-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6B7280" },
        { token: "string", foreground: "2F6F3E" },
        { token: "keyword", foreground: "6D47FF" },
        { token: "number", foreground: "8A5A00" },
        { token: "type.identifier", foreground: "5C7A2D" },
      ],
      colors: {
        "editor.background": "#F7F8FC",
        "editor.foreground": "#0B0D12",
        "editorLineNumber.foreground": "#9AA2B2",
        "editorLineNumber.activeForeground": "#5C7A2D",
        "editorCursor.foreground": "#5C7A2D",
        "editor.selectionBackground": "#E2DAFF",
        "editor.inactiveSelectionBackground": "#F0ECFA",
        "editorIndentGuide.background": "#E2E6EF",
        "editorIndentGuide.activeBackground": "#C9D1E3",
        "editorWidget.background": "#FFFFFF",
        "editorSuggestWidget.background": "#FFFFFF",
        "editorSuggestWidget.border": "#D0D7E6",
        "editorHoverWidget.background": "#FFFFFF",
        "editorHoverWidget.border": "#D0D7E6",
        "peekView.border": "#D0D7E6",
        "inputValidation.errorBorder": "#D0D7E6",
        "editorError.foreground": "#D92D2D",
        "editorWarning.foreground": "#B06B00",
      },
    });

    monaco.editor.defineTheme("cavbot-lime", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "79b567" },
        { token: "string", foreground: "c5f09b" },
        { token: "keyword", foreground: "d5dca0" },
        { token: "number", foreground: "a7d87e" },
        { token: "type.identifier", foreground: "b9c85a" },
      ],
      colors: {
        "editor.background": "#030f07",
        "editor.foreground": "#e9f6d3",
        "editorLineNumber.foreground": "#3f6c48",
        "editorLineNumber.activeForeground": "#c7e394",
        "editorCursor.foreground": "#b9c85a",
        "editor.selectionBackground": "rgba(185,200,90,0.3)",
        "editor.inactiveSelectionBackground": "rgba(185,200,90,0.08)",
        "editorLineHighlightBackground": "rgba(185,200,90,0.1)",
        "editorIndentGuide.background": "rgba(116,148,116,0.65)",
        "editorIndentGuide.activeBackground": "rgba(185,200,90,0.75)",
        "editorWidget.background": "#04140a",
        "editorSuggestWidget.background": "#04140a",
        "editorSuggestWidget.border": "rgba(185,200,90,0.45)",
        "editorHoverWidget.background": "#04140a",
        "editorHoverWidget.border": "rgba(185,200,90,0.45)",
        "peekView.border": "rgba(185,200,90,0.45)",
        "inputValidation.errorBorder": "rgba(185,200,90,0.45)",
        "editorError.foreground": "#ff5b5b",
        "editorWarning.foreground": "#ffcc66",
      },
    });

    monaco.editor.defineTheme("cavbot-classic", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955" },
        { token: "string", foreground: "ce9178" },
        { token: "keyword", foreground: "569cd6" },
        { token: "number", foreground: "b5cea8" },
        { token: "type.identifier", foreground: "4ec9b0" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editorLineNumber.foreground": "#858585",
        "editorLineNumber.activeForeground": "#c3e88d",
        "editorCursor.foreground": "#aeafad",
        "editor.selectionBackground": "#094771",
        "editor.inactiveSelectionBackground": "#2a2d2e",
        "editorLineHighlightBackground": "#2a2d2e",
        "editorIndentGuide.background": "#404040",
        "editorIndentGuide.activeBackground": "#707070",
        "editorWidget.background": "#252526",
        "editorSuggestWidget.background": "#252526",
        "editorSuggestWidget.border": "#3f3f46",
        "editorHoverWidget.background": "#252526",
        "editorHoverWidget.border": "#3f3f46",
        "peekView.border": "#3f3f46",
        "inputValidation.errorBorder": "#3f3f46",
        "editorError.foreground": "#f44747",
        "editorWarning.foreground": "#ff8800",
      },
    });

    monaco.editor.defineTheme("cavbot-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7d9bcf" },
        { token: "string", foreground: "c6d8ff" },
        { token: "keyword", foreground: "79b9ff" },
        { token: "number", foreground: "b0c6ff" },
        { token: "type.identifier", foreground: "81b1e0" },
      ],
      colors: {
        "editor.background": "#01030f",
        "editor.foreground": "#dfe8ff",
        "editorLineNumber.foreground": "#4b5465",
        "editorLineNumber.activeForeground": "#99b1d8",
        "editorCursor.foreground": "#c6d8ff",
        "editor.selectionBackground": "rgba(121,185,255,0.18)",
        "editor.inactiveSelectionBackground": "rgba(121,185,255,0.08)",
        "editorLineHighlightBackground": "rgba(121,185,255,0.08)",
        "editorIndentGuide.background": "rgba(70,82,110,0.55)",
        "editorIndentGuide.activeBackground": "rgba(121,185,255,0.6)",
        "editorWidget.background": "#050715",
        "editorSuggestWidget.background": "#050715",
        "editorSuggestWidget.border": "rgba(121,185,255,0.35)",
        "editorHoverWidget.background": "#050715",
        "editorHoverWidget.border": "rgba(121,185,255,0.35)",
        "peekView.border": "rgba(121,185,255,0.35)",
        "inputValidation.errorBorder": "rgba(121,185,255,0.35)",
        "editorError.foreground": "#ff6f6f",
        "editorWarning.foreground": "#ffc66d",
      },
    });

    monaco.editor.setTheme(settings.theme);

    try {
      const monacoLang = monaco.languages as unknown as MonacoLangs;

      // HTML diagnostics (squiggles)
      monacoLang.html?.htmlDefaults?.setOptions?.({
        validate: true,
        suggest: { html5: true },
        data: { useDefaultDataProvider: true },
      });

      // CSS diagnostics
      monacoLang.css?.cssDefaults?.setOptions?.({ validate: true });
      monacoLang.css?.lessDefaults?.setOptions?.({ validate: true });
      monacoLang.css?.scssDefaults?.setOptions?.({ validate: true });

      // JSON diagnostics
      monacoLang.json?.jsonDefaults?.setDiagnosticsOptions?.({
        validate: true,
        allowComments: true,
        trailingCommas: "ignore",
      });
    } catch {}

    try {
      editor.updateOptions({
        renderValidationDecorations: "on",
        lightbulb: { enabled: "on" as MonacoType.editor.ShowLightbulbIconMode },
      });
    } catch {}

    try {
      const activeUri = activeFile?.path ? fileUri(activeFile.path) : "";
      syncMonacoModels(fs, activeUri);
    } catch {}

    try {
      const configureTsDefaults = (defaults: {
        setDiagnosticsOptions: (opts: { noSemanticValidation?: boolean; noSyntaxValidation?: boolean }) => void;
        setCompilerOptions: (opts: Record<string, unknown>) => void;
        setEagerModelSync?: (v: boolean) => void;
      }) => {
        defaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
        });

        const tsApi = monaco.languages.typescript as unknown as {
          ScriptTarget?: Record<string, number>;
          ModuleKind?: Record<string, number>;
          ModuleResolutionKind?: Record<string, number>;
          JsxEmit?: Record<string, number>;
        };
        const scriptTarget =
          tsApi?.ScriptTarget?.ES2022 ??
          tsApi?.ScriptTarget?.ESNext ??
          tsApi?.ScriptTarget?.Latest ??
          99;
        const moduleKind =
          tsApi?.ModuleKind?.ESNext ??
          tsApi?.ModuleKind?.ES2022 ??
          tsApi?.ModuleKind?.ES2015 ??
          99;
        const moduleResolution =
          tsApi?.ModuleResolutionKind?.Bundler ??
          tsApi?.ModuleResolutionKind?.NodeNext ??
          tsApi?.ModuleResolutionKind?.NodeJs ??
          99;
        const jsxEmit =
          tsApi?.JsxEmit?.Preserve ??
          tsApi?.JsxEmit?.ReactJSX ??
          4;

        defaults.setCompilerOptions({
          target: scriptTarget,
          module: moduleKind,
          moduleResolution,
          jsx: jsxEmit,
          allowNonTsExtensions: true,
          allowJs: true,
          checkJs: false,
          noEmit: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          isolatedModules: true,
          useDefineForClassFields: true,
          baseUrl: "/",
          paths: {
            "@/*": ["./*"],
          },
          lib: ["es2022", "dom", "dom.iterable", "dom.asynciterable", "webworker"],
          strict: false,
          noImplicitAny: false,
          skipLibCheck: true,
          allowSyntheticDefaultImports: true,
          types: ["node", "next"],
        });

        defaults.setEagerModelSync?.(true);
      };

      const tsLang = (monaco.languages as unknown as MonacoLangs).typescript;
      if (tsLang?.typescriptDefaults) configureTsDefaults(tsLang.typescriptDefaults);
      if (tsLang?.javascriptDefaults) configureTsDefaults(tsLang.javascriptDefaults);
    } catch {}

    const pumpProblems = () => {
      try {
        const markers = monaco.editor.getModelMarkers({}) as Array<{
          severity?: number;
          message?: string;
          resource?: { path?: string };
          startLineNumber?: number;
          startColumn?: number;
          owner?: string;
          code?: string | { value?: string };
        }>;

        const mapped: Problem[] = markers
          .slice(0, 600)
          .map((mk) => {
            const sev = mk.severity ?? 1;
            const severity: Problem["severity"] = sev >= 8 ? "error" : sev >= 4 ? "warn" : "info";
            const rawPath = String(mk.resource?.path || "");
            const file = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
            const rawCode =
              typeof mk.code === "string"
                ? mk.code
                : mk.code && typeof mk.code === "object"
                ? String(mk.code.value || "")
                : "";
            const code = String(rawCode || "").trim();
            const source = String(mk.owner || "monaco").trim() || "monaco";
            return {
              severity,
              message: String(mk.message || "").trim(),
              file,
              line: mk.startLineNumber || 1,
              col: mk.startColumn || 1,
              source,
              code: code || undefined,
              fixReady: Boolean(code),
            };
          })
          .filter((x) => x.message && (x.severity === "error" || x.severity === "warn"));

        setEditorProblems(mapped);
      } catch {}
    };

    try { markersDispRef.current?.dispose(); } catch {}
    markersDispRef.current = monaco.editor.onDidChangeMarkers(pumpProblems);
    pumpProblems();

    try {
      editor.onDidChangeModel?.(() => {
        pumpProblems();
      });
    } catch {}
    try {
      editor.onDidChangeModelContent?.(() => {
        window.requestAnimationFrame(() => pumpProblems());
      });
    } catch {}

    disposePaneDisposables(pane);
    try {
      const focusDisp = editor.onDidFocusEditorText(() => {
        editorRef.current = editor;
        setActivePane(pane);
        bindCursorTracking(editor);
      });
      paneDisposablesRef.current[pane].push(focusDisp);
    } catch {}

    if (activePaneRef.current === pane) {
      bindCursorTracking(editor);
    }

    try {
      editor.addAction({
        id: "cavcode.quickFix",
        label: "CavAi Fixes",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
        ],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1.4,
        run: () => {
          let shouldFallbackToCavAi = false;
          let shouldTryNativeQuickFix = true;
          try {
            const model = editor.getModel?.();
            const position = editor.getPosition?.();
            if (model && position) {
              const markerLine = Math.max(1, Math.trunc(Number(position.lineNumber) || 1));
              const nearbyMarkers = monaco.editor
                .getModelMarkers({ resource: model.uri })
                .filter((marker) => {
                  const startLine = Math.max(1, Math.trunc(Number(marker.startLineNumber) || 1));
                  return Math.abs(startLine - markerLine) <= 2;
                })
                .filter((marker) => Number(marker.severity || 0) >= 4);
              if (nearbyMarkers.length) {
                const hasLikelyNativeFixProvider = nearbyMarkers.some((marker) => {
                  const source = String(marker.source || "").toLowerCase();
                  if (!source) return false;
                  return (
                    source.includes("eslint")
                    || source.includes("stylelint")
                    || source.includes("biome")
                    || source.includes("json")
                    || source.includes("html")
                    || source.includes("css")
                  );
                });
                shouldFallbackToCavAi = !hasLikelyNativeFixProvider;
                shouldTryNativeQuickFix = hasLikelyNativeFixProvider;
              }
            }
          } catch {}
          if (!shouldTryNativeQuickFix && shouldFallbackToCavAi) {
            setActivity("ai");
            pushToast("No native quick fix found here. CavAi Fixes is ready for an AI patch.", "watch");
            return;
          }
          editor.getAction("editor.action.quickFix")?.run?.();
          if (!shouldFallbackToCavAi) return;
          setActivity("ai");
          pushToast("No native quick fix found here. CavAi Fixes is ready for an AI patch.", "watch");
        },
      });
    } catch {}
    try {
      editor.addAction({
        id: "cavcode.organizeImports",
        label: "Organize Imports",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO,
        ],
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1.5,
        run: () => {
          editor.getAction("editor.action.organizeImports")?.run?.();
        },
      });
    } catch {}
    try {
      const gutterDisp = editor.onMouseDown((event) => {
        try {
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
          const line = Math.max(1, Math.trunc(Number(event.target.position?.lineNumber) || 0));
          if (!line) return;
          const model = editor.getModel?.();
          const modelPath = normalizePath(String(model?.uri?.path || ""));
          if (!modelPath || !modelPath.startsWith("/codebase/")) return;
          const cavPath = toCavcodePathFromCodebase(modelPath);
          const exists = debugBreakpointsRef.current.some(
            (row) => normalizePath(row.file) === cavPath && Math.max(1, Math.trunc(Number(row.line) || 1)) === line
          );
          const target = quoteForCavArg(`${cavPath}:${line}`);
          if (exists) {
            void runCmd(`cav debug break clear ${target}`);
          } else {
            void runCmd(`cav debug break set ${target}`);
          }
        } catch {}
      });
      paneDisposablesRef.current[pane].push(gutterDisp);
    } catch {}
    try {
      const pos = editor.getPosition?.();
      if (pos) setCursorPos({ line: pos.lineNumber, col: pos.column });
    } catch {}

    didMountRef.current = true;
    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    bootTimerRef.current = null;
    setBootFailed(false);
    window.requestAnimationFrame(() => setBooting(false));
  }

  useEffect(() => {
    const paneEditors = editorRefs.current;
    return () => {
      try { markersDispRef.current?.dispose(); } catch {}
      markersDispRef.current = null;
      try { cursorDispRef.current?.dispose(); } catch {}
      cursorDispRef.current = null;
      disposePaneDisposables("primary");
      disposePaneDisposables("secondary");
      paneEditors.primary = null;
      paneEditors.secondary = null;
    };
  }, []);

  /* =========================
    Apply editor settings live
  ========================= */
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    try {
      monaco.editor.setTheme(settings.theme);
    } catch {}
    const editors = [editorRefs.current.primary, editorRefs.current.secondary].filter(
      (row): row is MonacoType.editor.IStandaloneCodeEditor => Boolean(row)
    );
    for (const ed of editors) {
      try {
        ed.updateOptions({
          fontSize: settings.fontSize,
          tabSize: settings.tabSize,
          wordWrap: settings.wordWrap ? "on" : "off",
          minimap: { enabled: settings.minimap, side: "right", showSlider: "mouseover" },
          scrollbar: {
            vertical: "visible",
            horizontal: "auto",
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 10,
          },
          overviewRulerLanes: 3,
          overviewRulerBorder: false,
        });
      } catch {}
    }
  }, [settings]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    const panes: Array<{ pane: EditorPane; editor: MonacoType.editor.IStandaloneCodeEditor | null }> = [
      { pane: "primary", editor: editorRefs.current.primary },
      { pane: "secondary", editor: editorRefs.current.secondary },
    ];

    for (const { pane, editor } of panes) {
      if (!editor) continue;
      const model = editor.getModel?.();
      const modelPath = normalizePath(String(model?.uri?.path || ""));
      const existing = debugDecorationsRef.current[pane] || [];
      if (!modelPath || !modelPath.startsWith("/codebase/")) {
        debugDecorationsRef.current[pane] = editor.deltaDecorations(existing, []);
        continue;
      }

      const cavPath = toCavcodePathFromCodebase(modelPath);
      const bpDecorations = debugBreakpoints
        .filter((bp) => normalizePath(bp.file) === cavPath)
        .map((bp) => ({
          range: new monaco.Range(Math.max(1, bp.line), 1, Math.max(1, bp.line), 1),
          options: {
            glyphMarginClassName: bp.verified ? "cc-debug-breakpoint-glyph" : "cc-debug-breakpoint-glyph cc-debug-breakpoint-pending",
            glyphMarginHoverMessage: [{ value: bp.message ? `Breakpoint: ${bp.message}` : "Breakpoint" }],
          },
        }));

      const locationDecorations =
        debugCurrentLocation?.file && debugCurrentLocation?.line && normalizePath(debugCurrentLocation.file) === cavPath
          ? [{
            range: new monaco.Range(
              Math.max(1, debugCurrentLocation.line),
              1,
              Math.max(1, debugCurrentLocation.line),
              1
            ),
            options: {
              isWholeLine: true,
              className: "cc-debug-current-line",
              linesDecorationsClassName: "cc-debug-current-line-gutter",
            },
          }]
          : [];

      const inlineValuesText = (() => {
        if (!debugCurrentLocation?.file || !debugCurrentLocation?.line) return "";
        if (normalizePath(debugCurrentLocation.file) !== cavPath) return "";
        const inlinePairs = debugVariables
          .filter((variable) => variable.variablesReference <= 0)
          .slice(0, 4)
          .map((variable) => `${variable.name}=${variable.value}`)
          .filter(Boolean);
        return inlinePairs.join(" · ");
      })();
      const inlineValueDecorations =
        inlineValuesText && debugCurrentLocation?.line
          ? [{
            range: new monaco.Range(
              Math.max(1, debugCurrentLocation.line),
              1,
              Math.max(1, debugCurrentLocation.line),
              1
            ),
            options: {
              after: {
                content: `  ${inlineValuesText}`,
                inlineClassName: "cc-debug-inline-values-text",
              },
            },
          }]
          : [];

      debugDecorationsRef.current[pane] = editor.deltaDecorations(existing, [
        ...bpDecorations,
        ...locationDecorations,
        ...inlineValueDecorations,
      ]);
    }
  }, [debugBreakpoints, debugCurrentLocation, debugVariables]);

  /* =========================
    VS Code Find (Monaco native)
    - No custom modal.
    - Cmd/Ctrl+F uses Monaco's built-in find widget.
  ========================= */
  function openMonacoFind(mode: "find" | "replace" = "find") {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      if (mode === "replace") {
        ed.getAction?.("editor.action.startFindReplaceAction")?.run?.();
      } else {
        ed.getAction?.("actions.find")?.run?.();
      }
      ed.focus?.();
    } catch {}
  }

  /* =========================
    Keyboard (VS-grade)
    - Added:
      • Delete key deletes selected node (file/folder) like VS Code explorer
  ========================= */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Always capture Cmd/Ctrl+S inside CavCode (including Monaco/editor inputs)
      // so browser/system "Save Page" never opens here.
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void saveNow();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((p) => !p);
        return;
      }

      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setActivity("search");
        const el = document.getElementById("cc-search") as HTMLInputElement | null;
        window.setTimeout(() => el?.focus(), 0);
        return;
      }

      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openMonacoFind("find");
        setPanelOpen(false);
        return;
      }

      // Optional: VS Code replace shortcut (Cmd/Ctrl+H) -> replace widget
      if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        openMonacoFind("replace");
        setPanelOpen(false);
        return;
      }

      if (e.key === "F2") {
        const node = selectedId ? findNode(fs, selectedId) : null;
        if (!node || node.id === "root") return;
        e.preventDefault();
        setRenamingId(node.id);
        setRenameValue(node.name);
        return;
      }

      if (e.key === "Delete") {
        const node = selectedId ? findNode(fs, selectedId) : null;
        if (!node || node.id === "root") return;
        e.preventDefault();
        deleteNode(node.id);
        return;
      }

      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanelOpen((p) => !p);
        return;
      }

      if (e.key === "Escape") {
        if (renamingId) {
          setRenamingId(null);
          setRenameValue("");
          return;
        }
        if (profileOpen) {
          setProfileOpen(false);
          return;
        }
        if (ctxMenu) {
          setCtxMenu(null);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    fs,
    selectedId,
    renamingId,
    activeFileId,
    activeFile,
    profileOpen,
    ctxMenu,
    settings,
    deleteNode,
    saveNow,
  ]);

  /* =========================
    Search
  ========================= */
  const searchHits = useMemo(() => {
    const q = String(searchQuery || "").trim().toLowerCase();
    if (!q) return [];
    const hits: Array<{ id: string; path: string; name: string; kind: "file" | "folder" }> = [];
    walk(fs, (n) => {
      const hay = `${n.name} ${n.path}`.toLowerCase();
      if (hay.includes(q)) hits.push({ id: n.id, path: n.path, name: n.name, kind: n.kind });
    });
    return hits.slice(0, 160);
  }, [fs, searchQuery]);

  /* =========================
    Drag/drop overlay handlers (NO UI overlay rendered)
  ========================= */
  function armDrag() {
    dragDepth.current += 1;
    setDragArmed(true);
  }
  function disarmDrag() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragArmed(false);
  }

  function isInternalTabDrag(dt: DataTransfer | null): boolean {
    if (!dt) return false;
    return Array.from(dt.types || []).includes("application/x-cavcode-tab-id");
  }

  async function onDropImport(e: React.DragEvent) {
    if (isInternalTabDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragArmed(false);

    const dt = e.dataTransfer;
    if (!dt) return;

    const ok = await importFromDataTransfer(dt);
    if (!ok) pushToast("Nothing to import.", "watch");
  }

  /* =========================
    Mobile / small viewport
  ========================= */
  const errCount = problems.filter((p) => p.severity === "error").length;
  const warnCount = problems.filter((p) => p.severity === "warn").length;
  const activeDebugCavPath = activeFile?.path ? toCavcodePathFromCodebase(activeFile.path) : "";
  const activeCursorLine = Math.max(1, Math.trunc(Number(cursorPos.line) || 1));
  const cursorBreakpointExists = Boolean(
    activeDebugCavPath
    && debugBreakpoints.some(
      (bp) => normalizePath(bp.file) === normalizePath(activeDebugCavPath) && Math.max(1, Math.trunc(Number(bp.line) || 1)) === activeCursorLine
    )
  );
  const canDebugContinue = debugStatus === "paused";
  const canDebugPause = debugStatus === "running";
  const canDebugStep = debugStatus === "paused";
  const debugStackByThread = useMemo(() => {
    const groups = new Map<number, DebugStackFrame[]>();
    for (const frame of debugStack) {
      const threadId = Number.isFinite(Number(frame.threadId)) ? Math.max(0, Math.trunc(Number(frame.threadId))) : 0;
      const bucket = groups.get(threadId) || [];
      bucket.push(frame);
      groups.set(threadId, bucket);
    }
    return Array.from(groups.entries())
      .map(([threadId, frames]) => ({ threadId, frames }))
      .sort((a, b) => a.threadId - b.threadId);
  }, [debugStack]);
  const terminalVisibleLines = useMemo(() => termLines.slice(-320), [termLines]);
  const outputLines = useMemo(
    () => termLines.filter((line) => !String(line || "").startsWith(PROMPT_PREFIX)).slice(-320),
    [PROMPT_PREFIX, termLines]
  );
  const detectedPortEntries = useMemo(() => {
    const rows: Array<{ id: string; label: string; url: string }> = [];
    const seen = new Set<string>();
    const runtimeProtocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "https" : "http";
    const runtimeHost = typeof window !== "undefined" ? String(window.location.hostname || "").trim() : "";
    const urlPattern = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|[a-z0-9.-]+)(?::\d{2,5})?(?:\/[^\s]*)?/gi;
    const hostPortPattern = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/gi;
    const cavbotHostPattern = /\bcavbothost(\d{2,5})\b/gi;

    for (const rawLine of termLines.slice(-560)) {
      const line = String(rawLine || "").trim();
      if (!line) continue;

      for (const rawUrl of line.match(urlPattern) || []) {
        const normalized = rawUrl.replace(/[),.;]+$/g, "");
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        rows.push({ id: normalized, label: normalized, url: normalized });
      }

      let hostMatch: RegExpExecArray | null;
      hostPortPattern.lastIndex = 0;
      while ((hostMatch = hostPortPattern.exec(line))) {
        const host = String(hostMatch[1] || "").trim().toLowerCase();
        const port = String(hostMatch[2] || "").trim();
        if (!port) continue;
        const resolvedHost = host === "0.0.0.0" ? "127.0.0.1" : host;
        const key = `${runtimeProtocol}://${resolvedHost}:${port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ id: key, label: `${resolvedHost}:${port}`, url: key });
      }

      let cavbotHostMatch: RegExpExecArray | null;
      cavbotHostPattern.lastIndex = 0;
      while ((cavbotHostMatch = cavbotHostPattern.exec(line))) {
        const port = String(cavbotHostMatch[1] || "").trim();
        if (!port) continue;
        if (!runtimeHost) continue;
        const key = `${runtimeProtocol}://${runtimeHost}:${port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ id: key, label: `cavbothost${port}`, url: key });
      }
    }

    return rows.slice(0, 28);
  }, [termLines]);
  const scmStatusSummary = useMemo(() => {
    if (scmStatusPayload) {
      return `${scmStatusPayload.branch || "HEAD"}${scmStatusPayload.upstream ? ` -> ${scmStatusPayload.upstream}` : ""} · ↑${scmStatusPayload.ahead} ↓${scmStatusPayload.behind} · staged ${scmStatusPayload.stagedCount} · unstaged ${scmStatusPayload.unstagedCount} · conflicts ${scmStatusPayload.conflictedCount}`;
    }
    return "No commits yet on main · ↑0 ↓0 · staged 0 · unstaged 0 · conflicts 0";
  }, [scmStatusPayload]);
  const runStatusSummary = useMemo(() => {
    const runtimeLabel = runtimeSessionId
      ? `${(runtimeStatus || "unknown").toUpperCase()}${runtimeKind ? ` · ${(runtimeKind || "dev").toUpperCase()}` : ""}`
      : "IDLE";
    const debugLabel = debugSessionId ? (debugStatus || "unknown").toUpperCase() : "IDLE";
    return `Runtime ${runtimeLabel} · Debug ${debugLabel}`;
  }, [debugSessionId, debugStatus, runtimeKind, runtimeSessionId, runtimeStatus]);
  const scmBranchLabel = scmStatusPayload?.branch || "main";
  const scmHeaderMeta = scmStatusPayload
    ? `↑${scmStatusPayload.ahead} ↓${scmStatusPayload.behind} · staged ${scmStatusPayload.stagedCount} · unstaged ${scmStatusPayload.unstagedCount} · conflicts ${scmStatusPayload.conflictedCount}`
    : "No commits yet · ↑0 ↓0 · staged 0 · unstaged 0 · conflicts 0";
  const runHeaderMeta = `${runtimeSessionId ? "runtime active" : "runtime idle"} · ${debugSessionId ? "debug active" : "debug idle"}`;
  const scmStagedFiles = useMemo(
    () => (scmStatusPayload?.files || []).filter((file) => file.staged).slice(0, 100),
    [scmStatusPayload]
  );
  const scmUnstagedFiles = useMemo(
    () => (scmStatusPayload?.files || []).filter((file) => file.unstaged || file.untracked).slice(0, 100),
    [scmStatusPayload]
  );
  const changesEntries = useMemo(() => toChangesEntries(scmStatusPayload), [scmStatusPayload]);
  const stagedChangesEntries = useMemo(
    () => changesEntries.filter((entry) => entry.mode === "staged"),
    [changesEntries]
  );
  const unstagedChangesEntries = useMemo(
    () => changesEntries.filter((entry) => entry.mode === "unstaged"),
    [changesEntries]
  );
  const changesCount = changesEntries.length;
  const visibleAggregateMode = activePane === "secondary" ? secondaryAggregateMode : primaryAggregateMode;
  const visibleAggregateEntries = useMemo(() => {
    if (visibleAggregateMode === "staged") return stagedChangesEntries;
    if (visibleAggregateMode === "unstaged") return unstagedChangesEntries;
    return [] as ChangesListEntry[];
  }, [stagedChangesEntries, unstagedChangesEntries, visibleAggregateMode]);
  const visibleAggregateSelectedEntry = useMemo(() => {
    if (!visibleAggregateEntries.length) return null;
    const selected = visibleAggregateEntries.find(
      (entry) => toChangesCompareKey(entry.mode, entry.path) === changesAggregateSelectionKey
    );
    return selected || visibleAggregateEntries[0] || null;
  }, [changesAggregateSelectionKey, visibleAggregateEntries]);

  useEffect(() => {
    if (!visibleAggregateSelectedEntry) return;
    const compareKey = toChangesCompareKey(visibleAggregateSelectedEntry.mode, visibleAggregateSelectedEntry.path);
    if (changesCompareByKey[compareKey] || changesCompareBusyKey === compareKey) return;
    void loadChangesCompare(visibleAggregateSelectedEntry.path, visibleAggregateSelectedEntry.mode);
  }, [changesCompareByKey, changesCompareBusyKey, loadChangesCompare, visibleAggregateSelectedEntry]);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const mode = readChangesAggregateTabId(tab.id);
        if (!mode) return tab;
        const count = mode === "staged" ? stagedChangesEntries.length : unstagedChangesEntries.length;
        const name = `Git: Changes (${count} files)`;
        if (tab.name === name) return tab;
        changed = true;
        return { ...tab, name };
      });
      return changed ? next : prev;
    });
  }, [stagedChangesEntries.length, unstagedChangesEntries.length]);

  useEffect(() => {
    const allKeys = new Set(changesEntries.map((entry) => toChangesCompareKey(entry.mode, entry.path)));
    if (changesAggregateSelectionKey && allKeys.has(changesAggregateSelectionKey)) return;
    const first = changesEntries[0];
    if (!first) {
      setChangesAggregateSelectionKey("");
      return;
    }
    setChangesAggregateSelectionKey(toChangesCompareKey(first.mode, first.path));
  }, [changesAggregateSelectionKey, changesEntries]);

  const scmPanelCount =
    (scmStatusPayload?.stagedCount || 0)
    + (scmStatusPayload?.unstagedCount || 0)
    + (scmStatusPayload?.conflictedCount || 0);
  const panelTabs = useMemo(
    () => [
      { id: "problems" as PanelTab, label: "PROBLEMS", count: errCount + warnCount },
      { id: "output" as PanelTab, label: "OUTPUT", count: outputLines.length },
      {
        id: "run" as PanelTab,
        label: "RUN PANEL",
        count: runtimeSessionId && runtimeStatus && RUNTIME_ACTIVE_STATUSES.has(runtimeStatus) ? 1 : 0,
      },
      { id: "debug" as PanelTab, label: "DEBUG CONSOLE", count: debugConsoleEntries.length },
      { id: "terminal" as PanelTab, label: "TERMINAL", count: 0 },
      { id: "git" as PanelTab, label: "GIT PANEL", count: scmPanelCount },
      { id: "ports" as PanelTab, label: "PORTS", count: detectedPortEntries.length },
    ],
    [debugConsoleEntries.length, detectedPortEntries.length, errCount, outputLines.length, runtimeSessionId, runtimeStatus, scmPanelCount, warnCount]
  );
  const nonPinnedPanelTabs = useMemo(() => panelTabs.filter((tab) => tab.id !== "git" && tab.id !== "run"), [panelTabs]);
  const runtimeSessionActive = Boolean(
    runtimeSessionId
    && runtimeStatus
    && RUNTIME_ACTIVE_STATUSES.has(runtimeStatus)
  );
  const rootThemeClass = `theme-${settings.theme}`;

  if (!isDesktop) {
    const closeDesktopOnlyGuard = () => {
      if (typeof window !== "undefined" && window.history.length > 1) {
        router.back();
        return;
      }
      router.replace("/");
    };

    return (
      <div className="cc-root">
        {dragArmed ? (
          <div
            className="cc-dropCatch"
            onDragOver={(e) => {
              if (isInternalTabDrag(e.dataTransfer)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={onDropImport}
            onDragLeave={(e) => {
              if (isInternalTabDrag(e.dataTransfer)) return;
              e.preventDefault();
              disarmDrag();
            }}
          />
        ) : null}

        <CavGuardModal
          open={true}
          onClose={closeDesktopOnlyGuard}
          decision={{
            code: "FEATURE_DISABLED",
            actionId: "CAVCODE_DESKTOP_ONLY",
            title: "Desktop viewport required.",
            request: "",
            reason: "Open CavCode on desktop to continue.",
          }}
        />
      </div>
    );
  }

  /* =========================
    Tree renderer (NO ROOT ROW)
    - Root "CavCode" folder row removed.
    - We render only root children.
    - Added:
      • Ctrl + Right Click opens context menu (Rename/Delete)
  ========================= */
  function folderHasModifiedDescendant(folder: FolderNode): boolean {
    for (const child of folder.children) {
      if (isFolder(child)) {
        if (folderHasModifiedDescendant(child)) return true;
        continue;
      }
      if (modifiedFileIds.has(child.id)) return true;
    }
    return false;
  }

  function Tree({ node, depth = 0 }: { node: Node; depth?: number }) {
    const pad = 10;
    const isSel = node.id === selectedId;

    const onCtx = (e: React.MouseEvent) => {
      const ctrl = e.ctrlKey; // your requirement: CONTROL + right click
      if (!ctrl) return;

      e.preventDefault();
      e.stopPropagation();

      setSelectedId(node.id);
      setCtxMenu({ x: e.clientX, y: e.clientY, id: node.id });
    };

    if (isFolder(node)) {
      const open = !!openFolders[node.id];
      const hasModifiedDescendant = folderHasModifiedDescendant(node);

      return (
        <div className="cc-tree-row">
          <button
            className={`cc-row cc-row-folder ${isSel ? "is-sel" : ""} ${folderToggleCueId === node.id && !isSel ? "is-toggle-border" : ""}`}
            style={{ paddingLeft: pad, borderRadius: 0, outline: "none" }}
            onContextMenu={onCtx}
            onClick={(e) => {
              const isMac = navigator.platform.toLowerCase().includes("mac");
              const mod = isMac ? e.metaKey : e.ctrlKey;
              const clickTarget = e.target as HTMLElement | null;
              const clickedChevron = clickTarget?.closest(".cc-chev") !== null;

              e.preventDefault();
              e.stopPropagation();

              if (clickedChevron) {
                cueFolderToggleBorder(node.id);
                toggleFolder(node.id);
                return;
              }

              setFolderToggleCueId((current) => (current === node.id ? "" : current));
              setSelectedId(node.id);

              if (mod && node.id !== "root") {
                setRenamingId(node.id);
                setRenameValue(node.name);
                return;
              }

              toggleFolder(node.id);
            }}
          >
            <span className="cc-chev" aria-hidden="true">
              <Image
                className="cc-chev-img"
                src={open ? "/icons/app/cavcode/arrow-down-svgrepo-com.svg" : "/icons/app/cavcode/arrow-right-svgrepo-com.svg"}
                alt=""
                width={12}
                height={12}
                aria-hidden="true"
              />
            </span>
            <IconFolder open={open} />
            {renamingId === node.id ? (
              <input
                className="cc-rename"
                value={renameValue}
                autoFocus
                onChange={(ev) => setRenameValue(ev.target.value)}
                onBlur={() => commitRename(node.id, renameValue)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") commitRename(node.id, renameValue);
                  if (ev.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                }}
              />
            ) : (
              <span className="cc-name">{node.name}</span>
            )}
            {renamingId === node.id || isSystemPath(node.path) ? null : (
              <span className={`cc-scm ${hasModifiedDescendant ? "cc-scm-dot-mod" : "cc-scm-dot"}`} aria-hidden="true">●</span>
            )}
          </button>

          {open ? (
            <div className="cc-children">
              {node.children.length ? (
                node.children
                  .slice()
                  .sort((a, b) => {
                    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((c) => <Tree key={c.id} node={c} depth={depth + 1} />)
              ) : (
                <div className="cc-emptyline" style={{ paddingLeft: pad + 14 }}>No files</div>
              )}
            </div>
          ) : null}
        </div>
      );
    }

    const fileIsModified = modifiedFileIds.has(node.id);

    return (
      <button
        className={`cc-row cc-row-file ${isSel ? "is-sel" : ""} ${node.id === activeFileId ? "is-openfile" : ""}`}
        style={{ paddingLeft: pad, borderRadius: 0, outline: "none" }}
        onContextMenu={onCtx}
        onClick={(e) => {
          const isMac = navigator.platform.toLowerCase().includes("mac");
          const mod = isMac ? e.metaKey : e.ctrlKey;

          e.preventDefault();
          e.stopPropagation();

          setSelectedId(node.id);

          if (mod) {
            setRenamingId(node.id);
            setRenameValue(node.name);
            return;
          }

          openFile(node);
        }}
      >
        <span className="cc-chev-spacer" aria-hidden="true" />
        <FileGlyph name={renamingId === node.id ? renameValue || node.name : node.name} lang={node.lang} />
        {renamingId === node.id ? (
          <input
            className="cc-rename"
            value={renameValue}
            autoFocus
            onChange={(ev) => setRenameValue(ev.target.value)}
            onBlur={() => commitRename(node.id, renameValue)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") commitRename(node.id, renameValue);
              if (ev.key === "Escape") { setRenamingId(null); setRenameValue(""); }
            }}
          />
        ) : (
          <span className="cc-name">{node.name}</span>
        )}
        {renamingId === node.id || isSystemPath(node.path) ? null : (
          <span className={`cc-scm ${fileIsModified ? "cc-scm-m" : "cc-scm-u"}`} aria-hidden="true">
            {fileIsModified ? "M" : "U"}
          </span>
        )}
      </button>
    );
  }

  function focusEditorPane(pane: EditorPane) {
    if (pane === "secondary" && splitLayout !== "single") {
      setActivePane("secondary");
      return;
    }
    setActivePane("primary");
    if (primaryFile?.id && primaryFile.id !== activeFileId) {
      setActiveFileId(primaryFile.id);
    }
  }

  function renderChangesDiffSurface(mode: GitCompareMode, relPath: string) {
    const compareKey = toChangesCompareKey(mode, relPath);
    const payload = changesCompareByKey[compareKey] || null;
    const busy = changesCompareBusyKey === compareKey;
    const entry = changesEntries.find((row) => row.mode === mode && row.path === relPath) || null;
    const statusLetter = String(entry?.statusLetter || payload?.status || "M").slice(0, 1).toUpperCase();
    const changeActionLabel = mode === "staged" ? "Unstage" : "Stage";
    const changeBusyTag = mode === "staged" ? "changes-unstage-file" : "changes-stage-file";
    const hasPayload = Boolean(payload);

    return (
      <div className="cc-changes-diffSurface">
        <div className="cc-changes-diffHead">
          <div className="cc-changes-diffMeta">
            <div className="cc-changes-diffPath mono">{fromServerOutputToCodebaseText(relPath)}</div>
            <div className="cc-changes-diffSub">
              {mode === "staged" ? "HEAD ↔ Index" : "Index ↔ Working Tree"}
              {payload ? ` · +${payload.addedLines} -${payload.removedLines}` : ""}
            </div>
          </div>
          <div className="cc-changes-diffActions">
            <span className="cc-changes-statusBadge mono" aria-label={`Status ${statusLetter}`}>
              {statusLetter}
            </span>
            <button
              type="button"
              className="cc-git-btn cc-changes-miniAction"
              onClick={() => {
                if (entry) {
                  runChangesStageToggle(entry);
                  return;
                }
                const command = mode === "staged"
                  ? `cav git unstage ${quoteForCavArg(relPath)}`
                  : `cav git stage ${quoteForCavArg(relPath)}`;
                runScmCommandFromChanges(command, changeBusyTag);
              }}
              disabled={Boolean(changesActionBusy)}
            >
              {changeActionLabel}
            </button>
            <button
              type="button"
              className="cc-git-btn cc-changes-miniAction"
              onClick={() => openCodeFileFromChanges(relPath)}
            >
              Open File
            </button>
            <button
              type="button"
              className="cc-git-btn cc-changes-miniAction"
              onClick={() => {
                void loadChangesCompare(relPath, mode, true);
              }}
              disabled={busy}
            >
              {busy ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="cc-changes-diffBody">
          {busy && !hasPayload ? (
            <div className="cc-editor-empty">
              <div className="cc-editor-empty-title">Loading compare...</div>
            </div>
          ) : payload?.binary ? (
            <div className="cc-editor-empty">
              <div className="cc-editor-empty-title">Binary file compare preview is unavailable.</div>
              <div className="cc-editor-empty-sub">Open the file to inspect content or metadata.</div>
            </div>
          ) : payload ? (
            <MonacoDiffEditor
              height="100%"
              width="100%"
              original={payload.leftContent}
              modified={payload.rightContent}
              language={inferLang(fileNameFromPath(relPath))}
              theme={settings.theme}
              options={{
                readOnly: true,
                originalEditable: false,
                automaticLayout: true,
                renderSideBySide: true,
                enableSplitViewResizing: true,
                minimap: { enabled: false },
                scrollbar: {
                  vertical: "visible",
                  horizontal: "auto",
                  verticalScrollbarSize: 14,
                  horizontalScrollbarSize: 10,
                },
                fontFamily: '"JetBrains Mono","SF Mono",Menlo,Monaco,Consolas,"Liberation Mono",monospace',
                fontSize: settings.fontSize,
                lineHeight: Math.round(settings.fontSize * 1.5),
                renderWhitespace: "selection",
                wordWrap: settings.wordWrap ? "on" : "off",
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <div className="cc-editor-empty">
              <div className="cc-editor-empty-title">No compare payload loaded.</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderChangesAggregatePane(mode: GitCompareMode) {
    const rows = mode === "staged" ? stagedChangesEntries : unstagedChangesEntries;
    if (!rows.length) {
      return (
        <div className="cc-editor-empty">
          <div className="cc-editor-empty-title">No {mode} changes.</div>
        </div>
      );
    }
    const selected = rows.find((entry) => toChangesCompareKey(entry.mode, entry.path) === changesAggregateSelectionKey) || rows[0];
    const selectedKey = toChangesCompareKey(selected.mode, selected.path);

    return (
      <div className="cc-changes-aggregate">
        <aside className="cc-changes-aggregateList" aria-label="Changes list">
          {rows.map((entry) => {
            const rowKey = toChangesCompareKey(entry.mode, entry.path);
            const isOn = rowKey === selectedKey;
            const pathLabel = fromServerOutputToCodebaseText(entry.path);
            return (
              <button
                key={entry.key}
                type="button"
                className={`cc-changes-row${isOn ? " is-on" : ""}`}
                onClick={() => {
                  setChangesAggregateSelectionKey(rowKey);
                  void loadChangesCompare(entry.path, entry.mode);
                }}
              >
                <span className="cc-changes-rowStatus mono">{entry.statusLetter}</span>
                <span className="cc-changes-rowPath mono" title={pathLabel}>{pathLabel}</span>
              </button>
            );
          })}
        </aside>
        <div className="cc-changes-aggregatePreview">
          {selected ? renderChangesDiffSurface(selected.mode, selected.path) : null}
        </div>
      </div>
    );
  }

  function renderCodeEditorPane(file: FileNode | null, tab: Tab | null, pane: EditorPane) {
    const compareTab = tab ? readChangesCompareTabId(tab.id) : null;
    if (compareTab) {
      return renderChangesDiffSurface(compareTab.mode, compareTab.path);
    }

    const aggregateMode = tab ? readChangesAggregateTabId(tab.id) : null;
    if (aggregateMode) {
      return renderChangesAggregatePane(aggregateMode);
    }

    if (!file) {
      return (
        <div className="cc-editor-empty">
          <div className="cc-editor-empty-title">Open a file.</div>
        </div>
      );
    }

    return (
      <MonacoEditor
        height="100%"
        width="100%"
        language={file.lang}
        value={file.content}
        onChange={(v) => {
          const next = String(v ?? "");
          const paneEditor = editorRefs.current[pane];
          const modelPath = normalizePath(String(paneEditor?.getModel?.()?.uri?.path || ""));
          const modelNode = modelPath ? findNodeByPath(fs, modelPath) : null;
          const target = modelNode && isFile(modelNode) ? modelNode : file;
          updateFileContentById(target.id, next);
        }}
        onMount={(editor, monaco) => onEditorMount(editor, monaco, pane)}
        path={fileUri(file.path)}
        options={{
          minimap: { enabled: settings.minimap, side: "right", showSlider: "mouseover" },
          scrollbar: {
            vertical: "visible",
            horizontal: "auto",
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 10,
          },
          overviewRulerLanes: 3,
          overviewRulerBorder: false,
          readOnly: normalizePath(file.path) === SYS_CAVEN_CONFIG_PATH,
          fontFamily: '"JetBrains Mono","SF Mono",Menlo,Monaco,Consolas,"Liberation Mono",monospace',
          fontSize: settings.fontSize,
          lineHeight: Math.round(settings.fontSize * 1.5),
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: "on",
          renderLineHighlight: "line",
          roundedSelection: false,
          automaticLayout: true,
          tabSize: settings.tabSize,
          insertSpaces: true,
          wordWrap: settings.wordWrap ? "on" : "off",
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          formatOnPaste: true,
          formatOnType: true,
          glyphMargin: true,
          folding: true,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          renderValidationDecorations: "on",
          find: { addExtraSpaceOnTop: false, autoFindInSelection: "never", seedSearchStringFromSelection: "always" },
        }}
        theme={settings.theme}
      />
    );
  }

  /* =========================
    Render IDE
  ========================= */
  return (
    <div
      className={`cc-root ${rootThemeClass} ${errCount > 0 ? "has-errors" : ""} ${activeFileHasErrors ? "has-active-errors" : ""}`}
      onDragEnter={(e) => {
        if (isInternalTabDrag(e.dataTransfer)) return;
        e.preventDefault();
        armDrag();
      }}
      onDragOver={(e) => {
        if (isInternalTabDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (isInternalTabDrag(e.dataTransfer)) return;
        e.preventDefault();
        disarmDrag();
      }}
      onDrop={onDropImport}
    >
      {/* PURE RED flashing eyes when active file has errors (no blue) */}
      <style>{`
        @keyframes ccEyeRedPulse {
          0% { transform: scale(1); opacity: .55; filter: saturate(1.1); }
          50% { transform: scale(1.06); opacity: 1; filter: saturate(1.8); }
          100% { transform: scale(1); opacity: .55; filter: saturate(1.1); }
        }
      `}</style>

      {booting ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
          }}
        >
          <CavBotLoadingScreen
            title="CavCode"
            className="cc-loading-screen"
          />
        </div>
      ) : null}

      {/* VS Code-style context menu */}
      {ctxMenu ? (
        <div
          id="cc-ctx"
          style={{
            position: "fixed",
            left: Math.max(12, Math.min((isClient ? window.innerWidth : 1200) - 220, ctxMenu.x)),
            top: Math.max(12, Math.min((isClient ? window.innerHeight : 800) - 120, ctxMenu.y)),
            width: 200,
            background: "rgba(10,15,34,0.98)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
            padding: 6,
            zIndex: 999999,
          }}
          role="menu"
          aria-label="Explorer menu"
        >
          <button
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 10px",
              borderRadius: 10,
              border: "0",
              background: "transparent",
              color: "rgba(235,245,255,0.92)",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => {
              const node = findNode(fs, ctxMenu.id);
              if (!node || node.id === "root") { setCtxMenu(null); return; }
              setRenamingId(node.id);
              setRenameValue(node.name);
              setCtxMenu(null);
            }}
          >
            Rename
          </button>

          <button
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 10px",
              borderRadius: 10,
              border: "0",
              background: "transparent",
              color: "rgba(255,120,120,0.95)",
              cursor: "pointer",
              fontSize: 13,
            }}
            onClick={() => {
              const node = findNode(fs, ctxMenu.id);
              if (!node || node.id === "root") { setCtxMenu(null); return; }
              deleteNode(node.id);
              setCtxMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
      <input
        ref={(el) => {
          folderInputRef.current = el;
          // Non-standard directory-picking attributes (Chromium/WebKit)
          // Set via DOM attributes to avoid TSX typing errors.
          if (el) {
            try { el.setAttribute("webkitdirectory", ""); } catch {}
            try { el.setAttribute("directory", ""); } catch {}
          }
        }}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={async (e) => {
          const files = e.currentTarget.files;
          if (!files || !files.length) return;

          const arr = Array.from(files);

          // A REAL folder upload ALWAYS has webkitRelativePath like:
          // "MyFolder/src/index.ts"
          const firstReal = arr.find((x) => String(x.webkitRelativePath || "").includes("/"));
          if (!firstReal) {
            // This is the exact scenario that creates "folder uploaded as a file"
            // (browser gave you a folder placeholder / no folder structure)
            pushToast("Folder upload failed: browser did not provide folder contents. Use Connect Folder.", "watch");
            e.currentTarget.value = "";
            return;
          }

          const rel = String(firstReal.webkitRelativePath || "");
          const folderName = splitRelPath(rel)[0] || "UploadedFolder";

          await importFromFileList(files, folderName);

          e.currentTarget.value = "";
          setActivity("explorer");
        }}
      />

      <div className={`cc-ide ${sidebarOpen ? "has-sidebar" : "no-sidebar"} ${sidebarOpen && activity === "ai" ? "ai-sidebar-open" : ""}`}>
        {/* Activity Bar */}
        <aside className="cc-activity" aria-label="Activity Bar">
          <button className={`cc-act ${activity === "explorer" ? "is-on" : ""}`} onClick={() => setActivity("explorer")} title="Explorer">
            <IconExplorer />
          </button>

          <button className={`cc-act ${activity === "search" ? "is-on" : ""}`} onClick={() => setActivity("search")} title="Search (Cmd/Ctrl+P)">
            <IconSearch />
          </button>

          <button className={`cc-act ${activity === "scm" ? "is-on" : ""}`} onClick={() => setActivity("scm")} title="Source Control">
            <IconScm />
          </button>

          <button
            className={`cc-act cc-act-changes ${activity === "changes" ? "is-on" : ""}`}
            onClick={() => {
              setSidebarOpen(true);
              setActivity("changes");
            }}
            title="Changes"
          >
            <IconChanges />
            {changesCount > 0 ? (
              <span className="cc-act-badge" aria-hidden="true">
                {changesCount > 999 ? "1k+" : String(changesCount)}
              </span>
            ) : null}
          </button>

          <button className={`cc-act ${activity === "live" ? "is-on" : ""}`} onClick={() => setActivity("live")} title="Live">
            <IconLive />
          </button>

          <button
            className={`cc-act ${activity === "run" ? "is-on" : ""}`}
            onClick={() => {
              setSidebarOpen(true);
              setActivity("run");
            }}
            title="Run & Debug"
          >
            <IconRunDebug />
          </button>

          <button
            className="cc-act cc-act-cloud"
            onClick={() => { window.open("/cavcloud", "_blank", "noopener,noreferrer"); }}
            title="CavCloud Storage"
            aria-label="CavCloud Storage"
          >
            <IconCloud />
          </button>

          <button
            className={`cc-act ${activity === "ai" ? "is-on" : ""}`}
            onClick={() => {
              setSidebarOpen(true);
              setActivity("ai");
            }}
            title="CavAi"
          >
            <IconCavAi />
          </button>

          <div className="cc-act-spacer" />

          <button
            ref={profileBtnRef}
            className="cc-profile"
            title="Operator"
            onClick={() => setProfileOpen((p) => !p)}
            aria-expanded={profileOpen}
            aria-controls="cc-profile-menu"
          >
            <span className="cb-account-chip cb-avatar-plain" data-tone={profileTone || "lime"} aria-hidden="true">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={96}
                  height={96}
                  quality={60}
                  unoptimized
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <span className="cb-account-initials">{accountInitials}</span>
              )}
            </span>
          </button>

          {profileOpen ? (
            <div id="cc-profile-menu" className="cc-profile-menu" role="menu" aria-label="Profile menu">
              <button
                className="cc-pm-item"
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false);
                  if (publicProfileHref) {
                    openCanonicalPublicProfileWindow({ href: publicProfileHref, fallbackHref: "/settings?tab=account" });
                    return;
                  }
                  router.push("/settings?tab=account");
                }}
              >
                {profileMenuLabel}
              </button>

              <button
                className="cc-pm-item cc-pm-itemDanger"
                role="menuitem"
                onClick={async () => {
                  setProfileOpen(false);
                  try {
                    await fetch("/api/auth/logout", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      cache: "no-store",
                      credentials: "include",
                    });
                  } catch {}
                  if (typeof window !== "undefined") {
                    window.location.replace("/auth?mode=login");
                    return;
                  }
                  router.replace("/auth?mode=login");
                }}
              >
                Log out
              </button>
            </div>
          ) : null}

          <button className={`cc-act cc-act-underprofile ${activity === "settings" ? "is-on" : ""}`} onClick={() => setActivity("settings")} title="Settings">
            <IconGear />
          </button>
        </aside>

        {/* Primary Sidebar */}
        {sidebarOpen ? (
          <aside className="cc-sidebar" aria-label="Primary Sidebar">
            {activity === "explorer" ? (
              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">EXPLORER</div>
                  <br />
                  <div className="cc-side-actions" aria-label="Explorer Actions">
                    <button className="cc-side-icbtn" onClick={() => createIn(targetFolderForCreate(), "file")} title="New File">
                      <IconNewFile />
                    </button>
                    <button className="cc-side-icbtn" onClick={() => createIn(targetFolderForCreate(), "folder")} title="New Folder">
                      <IconNewFolder />
                    </button>
                    <button className="cc-side-icbtn" onClick={refreshExplorer} title="Refresh Explorer">
                      <IconRefresh />
                    </button>
                    <button className="cc-side-icbtn" onClick={collapseAll} title="Collapse All">
                      <IconCollapseAll />
                    </button>
                    <div className="cc-side-menuShell" ref={explorerHeaderMenuRef}>
                      <button
                        className={`cc-side-icbtn ${explorerHeaderMenuOpen ? "is-on" : ""}`}
                        type="button"
                        title="Explorer more actions"
                        aria-label="Explorer more actions"
                        aria-haspopup="menu"
                        aria-expanded={explorerHeaderMenuOpen}
                        onClick={() => setExplorerHeaderMenuOpen((prev) => !prev)}
                      >
                        <IconMenuDots />
                      </button>
                      {explorerHeaderMenuOpen ? (
                        <div className="cc-side-menu cc-side-menuExplorer" role="menu" aria-label="Explorer actions menu">
                          <button
                            className="cc-side-menuItem cc-side-menuItemWithIcon"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setExplorerHeaderMenuOpen(false);
                              void openCloudConnect();
                            }}
                          >
                            <IconCloudLink />
                            <span className="cc-side-menuItemLabel">Import from CavCloud</span>
                          </button>
                          <button
                            className="cc-side-menuItem cc-side-menuItemWithIcon"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setExplorerHeaderMenuOpen(false);
                              openFolderPickerUpload();
                            }}
                          >
                            <IconUploadFolder />
                            <span className="cc-side-menuItemLabel">Upload Folder</span>
                          </button>
                          <button
                            className="cc-side-menuItem cc-side-menuItemWithIcon"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setExplorerHeaderMenuOpen(false);
                              fileInputRef.current?.click();
                            }}
                          >
                            <IconUploadFiles />
                            <span className="cc-side-menuItemLabel">
                              {activeProjectRoot ? `Upload Files to ${activeProjectRoot.name}` : "Upload Files"}
                            </span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

	                <div className="cc-tree" role="tree" aria-label="Workspace">
	                  <div className="cc-tree-root">
	                    {fs.children
	                      .slice()
	                      .sort((a, b) => {
	                        const aSys = isSystemPath(a.path);
	                        const bSys = isSystemPath(b.path);
	                        if (aSys !== bSys) return aSys ? -1 : 1;
	                        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
	                        return a.name.localeCompare(b.name);
	                      })
	                      .map((c) => (
	                        <Tree key={c.id} node={c} depth={0} />
	                      ))}
	                  </div>
	                </div>

              </>
	            ) : activity === "search" ? (
	              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">SEARCH</div>
                  <div className="cc-side-actions" />
                </div>

                <div className="cc-search">
                  <input
                    id="cc-search"
                    className="cc-search-in"
                    placeholder="Search files (Cmd/Ctrl+P)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <div className="cc-search-results">
                    {searchQuery.trim() ? (
                      searchHits.length ? (
                        searchHits.map((h) => (
                          <button
                            key={h.id}
                            className="cc-hit"
                            onClick={() => {
                              const node = findNode(fs, h.id);
                              if (!node) return;
                              setSelectedId(node.id);
                              if (isFolder(node)) {
                                setOpenFolders((prev) => ({ ...prev, [node.id]: true }));
                                setActivity("explorer");
                              } else {
                                openFile(node);
                              }
                            }}
                          >
                            <span className={`cc-hit-kind ${h.kind}`}>{h.kind}</span>
                            <span className="cc-hit-name">{h.name}</span>
                            <span className="cc-hit-path mono">{h.path}</span>
                          </button>
                        ))
                      ) : (
                        <div className="cc-search-empty">No matches.</div>
                      )
                    ) : (
                      <div className="cc-search-empty">Type to search the workspace.</div>
                    )}
	                  </div>
	                </div>
	              </>
	            ) : activity === "scm" ? (
	              <>
	                <div className="cc-sidebar-head">
	                  <div className="cc-side-title">SOURCE CONTROL</div>
                    <div className="cc-side-actions">
                      <div className="cc-side-menuShell" ref={scmHeaderMenuRef}>
                        <button
                          className={`cc-side-menuBtn ${scmHeaderMenuOpen ? "is-on" : ""}`}
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={scmHeaderMenuOpen}
                          aria-label="Source Control actions"
                          onClick={() => setScmHeaderMenuOpen((prev) => !prev)}
                        >
                          <IconMenuDots />
                        </button>
                        {scmHeaderMenuOpen ? (
                          <div className="cc-side-menu" role="menu" aria-label="Source Control menu">
                            <button
                              className="cc-side-menuItem"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                setPanelOpen(true);
                                setPanelTab("git");
                                setScmHeaderMenuOpen(false);
                              }}
                            >
                              Open Git Panel
                            </button>
                            <button
                              className="cc-side-menuItem"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                setPanelOpen(true);
                                setPanelTab("debug");
                                setScmHeaderMenuOpen(false);
                              }}
                            >
                              Debug Console
                            </button>
                            <button
                              className="cc-side-menuItem"
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                setPanelOpen(true);
                                setPanelTab("terminal");
                                setScmHeaderMenuOpen(false);
                              }}
                            >
                              Terminal
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
	                </div>
		                <div className="cc-run cc-run-scmMinimal">
		                  <div className="cc-run-card cc-run-card-scm">
			                    <div className="cc-run-title">Git Panel</div>
			                    <div className="cc-run-sub">Manage your repository in the bottom Git Panel.</div>
			                    <div className="cc-run-sub cc-run-sub-scmStatus">{scmStatusSummary}</div>
                      {scmAuthRequired ? (
                        <div className="cc-set-note is-error mono">
                          {`Auth required: ${scmAuthRequired.command} · ${scmAuthRequired.message}`}
                        </div>
                      ) : null}
			                    <div className="cc-run-actions cc-run-actions-compact cc-run-actions-scm">
		                      <button className="cc-run-btn cc-run-btn2 cc-run-btn-scm" onClick={refreshScmStatusFromPanel} disabled={Boolean(scmActionBusy)}>
                          {scmActionBusy === "status" ? "Refreshing..." : "Refresh Status"}
		                      </button>
			                      <button className="cc-run-btn cc-run-btn-scm" onClick={() => runScmCommandFromPanel("cav git diff", "diff")} disabled={Boolean(scmActionBusy)}>
		                        Diff
			                      </button>
			                      <button className="cc-run-btn cc-run-btn-scm" onClick={() => runScmCommandFromPanel("cav git stage .", "stage-all")} disabled={Boolean(scmActionBusy)}>
		                        Stage All
			                      </button>
			                    </div>
			                  </div>
		                </div>
	              </>
	            ) : activity === "changes" ? (
              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">CHANGES</div>
                  <div className="cc-side-actions">
                    <div className="cc-side-menuShell" ref={changesHeaderMenuRef}>
                      <button
                        className={`cc-side-menuBtn ${changesHeaderMenuOpen ? "is-on" : ""}`}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={changesHeaderMenuOpen}
                        aria-label="Changes actions"
                        onClick={() => setChangesHeaderMenuOpen((prev) => !prev)}
                      >
                        <IconMenuDots />
                      </button>
                      {changesHeaderMenuOpen ? (
                        <div className="cc-side-menu" role="menu" aria-label="Changes menu">
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setChangesHeaderMenuOpen(false);
                              void refreshChangesStatus();
                            }}
                          >
                            Refresh
                          </button>
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setChangesHeaderMenuOpen(false);
                              openChangesAggregateTab("unstaged");
                            }}
                          >
                            Open Git: Changes
                          </button>
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              setPanelOpen(true);
                              setPanelTab("git");
                              setChangesHeaderMenuOpen(false);
                            }}
                          >
                            Open Git Panel
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="cc-changes">
                  <div className="cc-changes-commitWrap">
                    <div className="cc-changes-commitInputRow">
                      <input
                        className="cc-search-in cc-changes-commitInput"
                        value={changesCommitMessage}
                        onChange={(event) => setChangesCommitMessage(event.currentTarget.value)}
                        placeholder="Message"
                      />
                      <div className="cc-changes-commitAiControl" data-changes-commit-ai="true" ref={changesCommitAiControlsRef}>
                        <button
                          type="button"
                          className={`cc-run-btn cc-changes-commitAiBtn ${changesCommitAiMenuOpen || changesCommitAiPromptOpen ? "is-on" : ""}`}
                          onClick={() => {
                            if (changesCommitAiBusy) return;
                            setChangesCommitMenuOpen(false);
                            setChangesCommitAiPromptOpen(false);
                            setChangesCommitAiMenuOpen((prev) => !prev);
                          }}
                          aria-label="Open CavAi commit message actions"
                          title={changesCommitAiBusy ? "CavAi is generating..." : "CavAi commit message actions"}
                          aria-haspopup="menu"
                          aria-expanded={changesCommitAiMenuOpen || changesCommitAiPromptOpen}
                          disabled={changesCommitAiBusy}
                        >
                          <span className="cc-changes-commitAiGlyph" aria-hidden="true" />
                        </button>
                        {changesCommitAiMenuOpen ? (
                          <div className="cc-agentCreateAiMenu cc-agentCreateAiMenu--draft cc-changes-commitAiMenu" role="menu" aria-label="CavAi commit actions">
                            <button
                              type="button"
                              className={`cc-agentCreateAiMenuItem cc-agentCreateAiMenuItem--draft ${
                                changesCommitAiBusy && changesCommitAiWorkingMode === "help_write" ? "is-working" : ""
                              }`}
                              role="menuitem"
                              onClick={openChangesCommitAiPrompt}
                              disabled={changesCommitAiBusy}
                              aria-busy={changesCommitAiBusy && changesCommitAiWorkingMode === "help_write"}
                            >
                              <span className="cc-agentCreateAiMenuItemRow">
                                <span className="cc-agentCreateAiMenuItemTitle">Help me write</span>
                                <span
                                  className={`cc-agentCreateAiMenuItemIcon cc-agentCreateAiMenuItemIcon--wand ${
                                    changesCommitAiBusy && changesCommitAiWorkingMode === "help_write" ? "is-working" : ""
                                  }`}
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`cc-agentCreateAiMenuItem cc-agentCreateAiMenuItem--draft ${
                                changesCommitAiBusy && changesCommitAiWorkingMode === "generate_message" ? "is-working" : ""
                              }`}
                              role="menuitem"
                              onClick={() => void runChangesCommitAiDraft("generate_message")}
                              disabled={changesCommitAiBusy}
                              aria-busy={changesCommitAiBusy && changesCommitAiWorkingMode === "generate_message"}
                            >
                              <span className="cc-agentCreateAiMenuItemRow">
                                <span className="cc-agentCreateAiMenuItemTitle">Generate with CavAi</span>
                                <span
                                  className={`cc-agentCreateAiMenuItemIcon cc-agentCreateAiMenuItemIcon--sparkles ${
                                    changesCommitAiBusy && changesCommitAiWorkingMode === "generate_message" ? "is-working" : ""
                                  }`}
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                          </div>
                        ) : null}
                        {changesCommitAiPromptOpen ? (
                          <div className="cc-agentCreateAiMenu cc-agentCreateAiMenu--prompt cc-changes-commitAiMenu" role="dialog" aria-label="Help me write prompt">
                            <div className="cc-agentCreateAiPromptWrap">
                              <textarea
                                ref={changesCommitAiHelpPromptInputRef}
                                className="cc-agentCreateAiPromptInput"
                                value={changesCommitAiPromptText}
                                onChange={(event) => setChangesCommitAiPromptText(String(event.currentTarget.value || "").slice(0, 1200))}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
                                  event.preventDefault();
                                  submitChangesCommitAiPrompt();
                                }}
                                placeholder=""
                                spellCheck
                                disabled={changesCommitAiBusy}
                              />
                              {!changesCommitAiPromptText.trim() ? (
                                <span key={changesCommitAiPromptHintCycle} className="cc-agentCreateAiPromptHint" aria-hidden="true">
                                  {changesCommitAiPromptHint}
                                </span>
                              ) : null}
                            </div>
                            <div className="cc-agentCreateAiPromptActions">
                              <button
                                type="button"
                                className="cc-agentCreateAiPromptBtn cc-agentCreateAiPromptBtn--ghost"
                                onClick={() => {
                                  setChangesCommitAiPromptOpen(false);
                                  setChangesCommitAiMenuOpen(true);
                                }}
                                disabled={changesCommitAiBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="cc-agentCreateAiPromptBtn is-primary"
                                onClick={submitChangesCommitAiPrompt}
                                disabled={changesCommitAiBusy || !changesCommitAiPromptText.trim()}
                              >
                                {changesCommitAiPromptActionLabel}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="cc-changes-commitActions" ref={changesCommitMenuRef}>
                      <button
                        className="cc-run-btn cc-run-btn2 cc-changes-commitPrimary"
                        onClick={() => runChangesCommitAction("commit")}
                        disabled={Boolean(changesActionBusy) || changesCommitAiBusy || !String(changesCommitMessage || "").trim()}
                      >
                        {changesActionBusy === "commit" ? "Committing..." : "Commit"}
                      </button>
                      <button
                        className={`cc-run-btn cc-changes-commitMenuBtn ${changesCommitMenuOpen ? "is-on" : ""}`}
                        onClick={() => {
                          if (changesCommitAiBusy || changesActionBusy) return;
                          setChangesCommitAiMenuOpen(false);
                          setChangesCommitAiPromptOpen(false);
                          setChangesCommitMenuOpen((prev) => !prev);
                        }}
                        aria-label="Commit options"
                        aria-haspopup="menu"
                        aria-expanded={changesCommitMenuOpen}
                        disabled={Boolean(changesActionBusy) || changesCommitAiBusy}
                      >
                        <Image
                          src="/icons/app/cavcode/arrow-down-svgrepo-com.svg"
                          alt=""
                          width={12}
                          height={12}
                          aria-hidden="true"
                        />
                      </button>
                      {changesCommitMenuOpen ? (
                        <div className="cc-side-menu cc-changes-commitMenu" role="menu" aria-label="Commit options">
                          <button className="cc-side-menuItem" role="menuitem" onClick={() => runChangesCommitAction("commit")}>
                            Commit
                          </button>
                          <button className="cc-side-menuItem" role="menuitem" onClick={() => runChangesCommitAction("amend")}>
                            Commit (Amend)
                          </button>
                          <button className="cc-side-menuItem" role="menuitem" onClick={() => runChangesCommitAction("commit-push")}>
                            Commit & Push
                          </button>
                          <button className="cc-side-menuItem" role="menuitem" onClick={() => runChangesCommitAction("commit-sync")}>
                            Commit & Sync
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="cc-changes-group">
                    <div className="cc-changes-groupHead mono">
                      <span>STAGED</span>
                      <span>{stagedChangesEntries.length}</span>
                    </div>
                    <div className="cc-changes-list" role="list" aria-label="Staged changes">
                      {stagedChangesEntries.length ? (
                        stagedChangesEntries.map((entry) => {
                          const rowKey = toChangesCompareKey(entry.mode, entry.path);
                          const compareOpen = Boolean(tabs.find((tab) => tab.id === toChangesCompareTabId(entry.path, entry.mode)));
                          return (
                            <div key={entry.key} className={`cc-changes-entry${compareOpen ? " is-open" : ""}`} role="listitem">
                              <button
                                className="cc-changes-entryMain"
                                type="button"
                                onClick={() => {
                                  setChangesAggregateSelectionKey(rowKey);
                                  openChangesCompare(entry);
                                }}
                              >
                                <span className="cc-changes-entryStatus mono">{entry.statusLetter}</span>
                                <span className="cc-changes-entryPath mono" title={fromServerOutputToCodebaseText(entry.path)}>
                                  {fromServerOutputToCodebaseText(entry.path)}
                                </span>
                              </button>
                              <div className="cc-changes-entryBtns">
                                <button
                                  className="cc-git-miniBtn"
                                  type="button"
                                  onClick={() => runChangesStageToggle(entry)}
                                  disabled={Boolean(changesActionBusy)}
                                >
                                  Unstage
                                </button>
                                <button
                                  className="cc-git-miniBtn"
                                  type="button"
                                  onClick={() => openCodeFileFromChanges(entry.path)}
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="cc-set-note">No staged changes.</div>
                      )}
                    </div>
                  </div>

                  <div className="cc-changes-group">
                    <div className="cc-changes-groupHead mono">
                      <span>CHANGES</span>
                      <span>{unstagedChangesEntries.length}</span>
                    </div>
                    <div className="cc-changes-list" role="list" aria-label="Unstaged changes">
                      {unstagedChangesEntries.length ? (
                        unstagedChangesEntries.map((entry) => {
                          const rowKey = toChangesCompareKey(entry.mode, entry.path);
                          const compareOpen = Boolean(tabs.find((tab) => tab.id === toChangesCompareTabId(entry.path, entry.mode)));
                          return (
                            <div key={entry.key} className={`cc-changes-entry${compareOpen ? " is-open" : ""}`} role="listitem">
                              <button
                                className="cc-changes-entryMain"
                                type="button"
                                onClick={() => {
                                  setChangesAggregateSelectionKey(rowKey);
                                  openChangesCompare(entry);
                                }}
                              >
                                <span className="cc-changes-entryStatus mono">{entry.statusLetter}</span>
                                <span className="cc-changes-entryPath mono" title={fromServerOutputToCodebaseText(entry.path)}>
                                  {fromServerOutputToCodebaseText(entry.path)}
                                </span>
                              </button>
                              <div className="cc-changes-entryBtns">
                                <button
                                  className="cc-git-miniBtn"
                                  type="button"
                                  onClick={() => runChangesStageToggle(entry)}
                                  disabled={Boolean(changesActionBusy)}
                                >
                                  Stage
                                </button>
                                <button
                                  className="cc-git-miniBtn"
                                  type="button"
                                  onClick={() => openCodeFileFromChanges(entry.path)}
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="cc-set-note">No unstaged changes.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : activity === "ai" ? (
	              <CavAiCodeWorkspace
                mode="panel"
                filePath={activeFile?.path || ""}
                language={activeFile?.lang || ""}
                profileTone={profileTone}
                workspaceId={projectIdFromQuery ? String(projectIdFromQuery) : null}
                projectId={projectIdFromQuery}
                diagnostics={activeFileDiagnostics}
                getSelectedCode={resolveEditorSelectionCode}
                projectRootPath={activeProjectRoot?.path || null}
                projectRootName={activeProjectRoot?.name || null}
                projectFiles={cavAiProjectFiles}
                context={cavAiCodeContext}
                onApplyProposedCode={applyAiProposedCodeToWorkspaceFile}
                onOpenFilePath={openWorkspaceFileByPathForAi}
                onUploadWorkspaceFiles={uploadWorkspaceFilesFromCaven}
                onOpenSkillsTab={openCavenAgentsTab}
                onOpenGeneralSettingsTab={openCavenGeneralTab}
                onOpenIdeSettingsTab={openCavenIdeSettingsTab}
                onOpenConfigToml={openCavenConfigTomlTab}
                onClose={() => setActivity("explorer")}
                expandHref={cavAiExpandHref}
              />
            ) : activity === "settings" ? (
              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">SETTINGS</div>
                </div>

                <div className="cc-settings">
                  <div className="cc-set-card">
                    <div className="cc-set-title">Editor</div>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Font Size</span>
                      <input
                        className="cc-set-input"
                        type="number"
                        min={10}
                        max={22}
                        value={settings.fontSize}
                        onChange={(e) => setSettings((s) => ({ ...s, fontSize: Math.max(10, Math.min(22, Number(e.target.value) || 12)) }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Tab Size</span>
                      <input
                        className="cc-set-input"
                        type="number"
                        min={2}
                        max={8}
                        value={settings.tabSize}
                        onChange={(e) => setSettings((s) => ({ ...s, tabSize: Math.max(2, Math.min(8, Number(e.target.value) || 2)) }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Word Wrap</span>
                      <input
                        type="checkbox"
                        checked={settings.wordWrap}
                        onChange={(e) => setSettings((s) => ({ ...s, wordWrap: e.target.checked }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Minimap</span>
                      <input
                        type="checkbox"
                        checked={settings.minimap}
                        onChange={(e) => setSettings((s) => ({ ...s, minimap: e.target.checked }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Format on Save</span>
                      <input
                        type="checkbox"
                        checked={settings.formatOnSave}
                        onChange={(e) => setSettings((s) => ({ ...s, formatOnSave: e.target.checked }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Autosave</span>
                      <input
                        type="checkbox"
                        checked={settings.autosave}
                        onChange={(e) => setSettings((s) => ({ ...s, autosave: e.target.checked }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Sync to CavCloud</span>
                      <input
                        type="checkbox"
                        checked={settings.syncToCavcloud}
                        onChange={(e) => setSettings((s) => ({ ...s, syncToCavcloud: e.target.checked }))}
                      />
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Theme</span>
                      <select
                        className="cc-set-input"
                        value={settings.theme}
                        onChange={(e) => {
                          const next = e.target.value as ThemeOption;
                          const safeTheme = THEME_VALUES.includes(next) ? next : settings.theme;
                          setSettings((s) => ({ ...s, theme: safeTheme }));
                        }}
                      >
                        {THEME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="cc-set-row">
                      <span className="cc-set-label">Telemetry</span>
                      <input
                        type="checkbox"
                        checked={settings.telemetry}
                        onChange={(e) => setSettings((s) => ({ ...s, telemetry: e.target.checked }))}
                      />
                    </label>
                  </div>

                  <div className="cc-set-card">
                    <div className="cc-set-title">Project Collaborators</div>
                    {!projectIdFromQuery ? (
                      <div className="cc-set-note">
                        Open CavCode with a project context to manage collaborators.
                      </div>
                    ) : (
                      <>
                        <div className="cc-set-note">
                          {`Project #${projectIdFromQuery}`}
                        </div>

                        <label className="cc-set-row cc-set-rowStack">
                          <span className="cc-set-label">Workspace member</span>
                          <select
                            className="cc-set-input cc-set-inputWide"
                            value={projectCollabUserId}
                            onChange={(e) => setProjectCollabUserId(e.target.value)}
                            disabled={projectCollabBusy || projectCollabSubmitting || !workspaceMemberOptions.length}
                          >
                            {workspaceMemberOptions.length ? null : <option value="">No workspace members</option>}
                            {workspaceMemberOptions.map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.displayName ? `${member.displayName} (${member.email})` : member.email}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="cc-set-row cc-set-rowStack">
                          <span className="cc-set-label">Role</span>
                          <select
                            className="cc-set-input cc-set-inputWide"
                            value={projectCollabRole}
                            onChange={(e) => {
                              const next = String(e.target.value || "").toUpperCase();
                              setProjectCollabRole(next === "EDITOR" || next === "ADMIN" ? next : "VIEWER");
                            }}
                            disabled={projectCollabBusy || projectCollabSubmitting}
                          >
                            <option value="VIEWER">Viewer</option>
                            <option value="EDITOR">Editor</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </label>

                        <div className="cc-run-actions">
                          <button
                            className="cc-run-btn cc-run-btn2"
                            onClick={() => void addProjectCollaborator()}
                            disabled={projectCollabBusy || projectCollabSubmitting || !projectCollabUserId}
                          >
                            {projectCollabSubmitting ? "Saving..." : "Save collaborator"}
                          </button>
                        </div>

                        {projectCollabError ? <div className="cc-set-note is-error">{projectCollabError}</div> : null}
                        {projectCollabStatus ? <div className="cc-set-note is-success">{projectCollabStatus}</div> : null}

                        <div className="cc-set-subtitle">Current collaborators</div>
                        {projectCollaborators.length ? (
                          <div className="cc-collabList">
                            {projectCollaborators.map((collaborator) => (
                              <div key={collaborator.userId} className="cc-collabRow">
                                <div>
                                  <div className="cc-collabName">
                                    {collaborator.displayName || collaborator.email || collaborator.userId}
                                  </div>
                                  <div className="cc-collabMeta">{collaborator.role}</div>
                                </div>
                                <button
                                  className="cc-run-btn cc-collabRevokeBtn"
                                  onClick={() => void revokeProjectCollaborator(collaborator.userId)}
                                  disabled={projectCollabBusy || projectCollabSubmitting}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="cc-set-note">
                            {projectCollabBusy ? "Loading collaborators..." : "No project collaborators set."}
                          </div>
                        )}

                        <div className="cc-run-actions">
                          <button
                            className="cc-run-btn"
                            onClick={() => void loadProjectCollaborators()}
                            disabled={projectCollabBusy || projectCollabSubmitting}
                          >
                            {projectCollabBusy ? "Refreshing..." : "Refresh"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : activity === "live" ? (
              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">LIVE</div>
                </div>

                <div className="cc-run">
                  <div className="cc-run-card">
                    <div className="cc-run-title">Go Live</div>
                    <div className="cc-run-sub">Open the live viewer for your current workspace.</div>
                    <div className="cc-run-actions cc-liveGo-actions">
                      <button className="cc-run-btn cc-run-btn2" onClick={openLiveWithActiveFile}>
                        Go Live
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : activity === "run" ? (
              <>
                <div className="cc-sidebar-head">
                  <div className="cc-side-title">RUN &amp; DEBUG</div>
                  <div className="cc-side-actions">
                    <div className="cc-side-menuShell" ref={runHeaderMenuRef}>
                      <button
                        className={`cc-side-menuBtn ${runHeaderMenuOpen ? "is-on" : ""}`}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={runHeaderMenuOpen}
                        aria-label="Run and debug actions"
                        onClick={() => setRunHeaderMenuOpen((prev) => !prev)}
                      >
                        <IconMenuDots />
                      </button>
                      {runHeaderMenuOpen ? (
                        <div className="cc-side-menu" role="menu" aria-label="Run and debug menu">
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              if (activeSkillsTab) setActiveFileId("");
                              setPanelOpen(true);
                              setPanelTab("run");
                              setRunHeaderMenuOpen(false);
                            }}
                          >
                            Open Run Panel
                          </button>
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              if (activeSkillsTab) setActiveFileId("");
                              setPanelOpen(true);
                              setPanelTab("terminal");
                              setRunHeaderMenuOpen(false);
                            }}
                          >
                            Terminal
                          </button>
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              if (activeSkillsTab) setActiveFileId("");
                              setPanelOpen(true);
                              setPanelTab("debug");
                              setRunHeaderMenuOpen(false);
                            }}
                          >
                            Debug Console
                          </button>
                          <button
                            className="cc-side-menuItem"
                            role="menuitem"
                            type="button"
                            onClick={() => {
                              if (activeSkillsTab) setActiveFileId("");
                              setPanelOpen(true);
                              setPanelTab("git");
                              setRunHeaderMenuOpen(false);
                            }}
                          >
                            Git Panel
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="cc-run cc-run-scmMinimal cc-run-onlyHub">
                  <div className="cc-run-card cc-run-card-scm cc-run-card-runPanel">
                    <div className="cc-run-title">Run Panel</div>
                    <div className="cc-run-sub">Manage runtime and debugging in the bottom Run Panel.</div>
                    <div className="cc-run-sub cc-run-sub-scmStatus">{runStatusSummary}</div>
                    <div className="cc-run-actions cc-run-actions-compact cc-run-actions-scm">
                      <button className="cc-run-btn cc-run-btn2 cc-run-btn-scm" onClick={() => { if (activeSkillsTab) setActiveFileId(""); setPanelOpen(true); setPanelTab("run"); }}>
                        Run Panel
                      </button>
                      <button className="cc-run-btn cc-run-btn-scm" onClick={() => { if (activeSkillsTab) setActiveFileId(""); setPanelOpen(true); setPanelTab("terminal"); }}>
                        Terminal
                      </button>
                      <button className="cc-run-btn cc-run-btn-scm" onClick={() => { if (activeSkillsTab) setActiveFileId(""); setPanelOpen(true); setPanelTab("debug"); }}>
                        Debug Console
                      </button>
                    </div>
                  </div>

                </div>
              </>
            ) : (
              <div className="cc-sidebar-empty">
                <div className="cc-empty-title">{activity.toUpperCase()}</div>
                <div className="cc-empty-sub">Use Terminal + Run to execute commands, diagnostics, and runtime sessions for this workspace.</div>
              </div>
            )}
          </aside>
        ) : null}

        {/* Workbench */}
        <section className={`cc-workbench${panelExpanded && panelOpen && !activeSkillsTab ? " is-panel-maximized" : ""}`} aria-label="Workbench">
          {/* Tabs (browser tabs, not pills) */}
          <div className="cc-tabshead">
            <div
              className="cc-tabsbar"
              role="tablist"
              aria-label="Open Editors"
              onDragOver={(e) => {
                const dragId = readDraggedTabId(e);
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const target = e.target as HTMLElement | null;
                if (!target?.closest(".cc-tab")) setTabDropHint(null);
              }}
              onDrop={(e) => {
                const dragId = readDraggedTabId(e);
                if (!dragId) return;
                const target = e.target as HTMLElement | null;
                if (target?.closest(".cc-tab")) return;
                e.preventDefault();
                moveTabToEnd(dragId);
                setTabDropHint(null);
                setTabDragId(null);
              }}
            >
              {tabs.length ? (
                tabs.map((t) => {
                  const on = t.id === tabsBarActiveId;
                  const isDragging = tabDragId === t.id;
                  const dropBefore = tabDropHint?.id === t.id && tabDropHint.side === "before";
                  const dropAfter = tabDropHint?.id === t.id && tabDropHint.side === "after";
                  const tabIsFile = t.kind !== "skills" && t.kind !== "git-compare-single" && t.kind !== "git-compare-aggregate";
                  const tabIsDirty = tabIsFile && modifiedFileIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      className={`cc-tab ${on ? "is-on" : ""} ${isDragging ? "is-dragging" : ""} ${dropBefore ? "drag-before" : ""} ${dropAfter ? "drag-after" : ""}`}
                      onClick={() => selectTabInActivePane(t.id)}
                      role="tab"
                      aria-selected={on}
                      draggable
                      onDragStart={(e) => {
                        setTabDragId(t.id);
                        setTabDropHint(null);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("application/x-cavcode-tab-id", t.id);
                        e.dataTransfer.setData("text/plain", t.id);
                      }}
                      onDragOver={(e) => {
                        const dragId = readDraggedTabId(e);
                        if (!dragId || dragId === t.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const side: "before" | "after" = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                        setTabDropHint({ id: t.id, side });
                      }}
                      onDrop={(e) => {
                        const dragId = readDraggedTabId(e);
                        if (!dragId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragId === t.id) {
                          setTabDropHint(null);
                          return;
                        }
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const side: "before" | "after" = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                        reorderTabs(dragId, t.id, side);
                        setTabDropHint(null);
                        setTabDragId(null);
                      }}
                      onDragEnd={() => {
                        setTabDragId(null);
                        setTabDropHint(null);
                      }}
                    >
                      <span className="cc-tab-ic" aria-hidden="true">
                        {t.kind === "skills" ? (
                          <IconGearGlyph className="cc-tab-gear" size={14} />
                        ) : t.kind === "git-compare-single" || t.kind === "git-compare-aggregate" ? (
                          <Image
                            className="cc-tab-gear"
                            src="/icons/app/git-compare-svgrepo-com.svg"
                            alt=""
                            width={14}
                            height={14}
                            aria-hidden="true"
                          />
                        ) : (
                          <FileGlyph name={t.name} lang={t.lang} />
                        )}
                      </span>
                      <span className="cc-tab-name">{t.name}</span>
                      {tabIsDirty ? (
                        <span className="cc-tab-dirty" aria-label={`${t.name} has unsaved changes`} />
                      ) : (
                        <span
                          className="cc-tab-x"
                          role="button"
                          aria-label={`Close ${t.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(t.id);
                          }}
                        >
                          <span className="cb-closeIcon" aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="cc-tabs-empty" aria-hidden="true" />
              )}
            </div>
            <div className="cc-tabs-right" role="toolbar" aria-label="Editor split controls">
              <button
                type="button"
                className={`cc-tabtool ${splitLayout === "right" ? "is-on" : ""}`}
                title="Split Editor Right"
                aria-label="Split Editor Right"
                onClick={() => splitEditorTo("right")}
              >
                <Image src="/icons/app/cavcode/split-cells-horizontal-svgrepo-com.svg" alt="" width={17} height={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`cc-tabtool ${splitLayout === "down" ? "is-on" : ""}`}
                title="Split Editor Down"
                aria-label="Split Editor Down"
                onClick={() => splitEditorTo("down")}
              >
                <Image src="/icons/app/cavcode/split-cells-vertical-svgrepo-com.svg" alt="" width={17} height={17} aria-hidden="true" />
              </button>
              <Link className="cc-tabs-cavenLogo" aria-label="Open Workspace Command Center" href="/">
                <Image src="/logo/cavbot-logomark.svg" alt="Caven AI" width={16} height={16} />
              </Link>
            </div>
          </div>

          {/* Editor */}
          <div className="cc-editor">
            {activeSkillsTab ? (
              <div className="cc-skills-page" role="region" aria-label="Caven settings">
                <div className="cc-skills-toolbar">
                  {skillsPageView === "agents" ? (
                    !createAgentOpen ? (
                    <>
                      <button
                        type="button"
                        className="cc-skills-refresh"
                        onClick={() => void refreshInstalledAgentsFromSettings(false)}
                        disabled={loadingAgents || Boolean(savingAgentId)}
                      >
                        <IconRefresh />
                        Refresh
                      </button>
                      <input
                        className="cc-skills-search"
                        value={agentsSearchQuery}
                        onChange={(event) => setAgentsSearchQuery(event.currentTarget.value)}
                        placeholder="Search agents"
                        aria-label="Search agents"
                      />
                      <button
                        type="button"
                        className="cc-skills-newAgent"
                        onClick={() => {
                          setCreateAgentError("");
                          setCreateAgentOpen(true);
                        }}
                      >
                        <Image
                          src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
                          alt=""
                          width={14}
                          height={14}
                          className="cc-skills-newAgentIcon"
                          unoptimized
                          aria-hidden="true"
                        />
                        <span>New Agent</span>
                      </button>
                    </>
                    ) : (
                    <div className="cc-agentCreateToolbar">
                    <button
                      type="button"
                      className="cc-agentCreateBackBtn"
                      onClick={() => closeCreateAgent()}
                      aria-label="Back to agents"
                      title="Back to agents"
                      disabled={createAgentAiBusy || Boolean(savingAgentId)}
                    >
                      <span className="cc-agentCreateBackIcon" aria-hidden="true" />
                    </button>
                    <div className="cc-agentCreateAiControls" data-agent-create-ai="true" ref={createAgentAiControlsRef}>
                      <div className={`cc-agentCreateAiControl ${createAgentAiControlMenu === "model" ? "is-open" : ""}`}>
                        <button
                          type="button"
                          className="cc-agentCreateAiIconBtn"
                          onClick={() => {
                            setCreateAgentAiMenuOpen(false);
                            setCreateAgentAiPromptOpen(false);
                            setCreateAgentAiControlMenu((prev) => (prev === "model" ? null : "model"));
                          }}
                          aria-label={`Model selector. Current model: ${createAgentAiModelLabel}`}
                          aria-haspopup="menu"
                          aria-expanded={createAgentAiControlMenu === "model"}
                          title={createAgentAiModelLabel}
                        >
                          <Image
                            src="/icons/app/cavcode/3d-modelling-round-820-svgrepo-com.svg"
                            alt=""
                            width={16}
                            height={16}
                            className="cc-agentCreateAiIconSvg"
                            unoptimized
                            aria-hidden="true"
                          />
                        </button>
                        {createAgentAiControlMenu === "model" ? (
                          <div className="cc-agentCreateAiMenu" role="menu" aria-label="Model selector">
                            {createAgentAiModelOptions.map((option) => {
                              const isOn = option.id === createAgentAiModelId;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  className={`cc-agentCreateAiMenuItem ${isOn ? "is-on" : ""}`}
                                  role="menuitemradio"
                                  aria-checked={isOn}
                                  onClick={() => {
                                    setCreateAgentAiModelId(option.id);
                                    setCreateAgentAiControlMenu(null);
                                  }}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className={`cc-agentCreateAiControl ${createAgentAiControlMenu === "reasoning" ? "is-open" : ""}`}>
                        <button
                          type="button"
                          className="cc-agentCreateAiIconBtn"
                          onClick={() => {
                            setCreateAgentAiMenuOpen(false);
                            setCreateAgentAiPromptOpen(false);
                            setCreateAgentAiControlMenu((prev) => (prev === "reasoning" ? null : "reasoning"));
                          }}
                          aria-label={`Reasoning selector. Current: ${createAgentAiReasoningLabel}`}
                          aria-haspopup="menu"
                          aria-expanded={createAgentAiControlMenu === "reasoning"}
                          title={createAgentAiReasoningLabel}
                        >
                          <Image
                            src="/icons/app/cavcode/brain-svgrepo-com.svg"
                            alt=""
                            width={16}
                            height={16}
                            className="cc-agentCreateAiIconSvg"
                            unoptimized
                            aria-hidden="true"
                          />
                        </button>
                        {createAgentAiControlMenu === "reasoning" ? (
                          <div className="cc-agentCreateAiMenu" role="menu" aria-label="Reasoning selector">
                            {createAgentAiReasoningOptions.map((option) => {
                              const label =
                                AGENT_BUILDER_REASONING_OPTIONS.find((row) => row.value === option)?.label
                                || toReasoningDisplayLabel(option);
                              const isOn = option === createAgentAiReasoningLevel;
                              const helper = toReasoningDisplayHelper(option);
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  className={`cc-agentCreateAiMenuItem ${isOn ? "is-on" : ""}`}
                                  role="menuitemradio"
                                  aria-checked={isOn}
                                  onClick={() => {
                                    setCreateAgentAiReasoningLevel(option);
                                    setCreateAgentAiControlMenu(null);
                                  }}
                                  title={helper ? `${label}: ${helper}` : label}
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>

                      <div className={`cc-agentCreateAiControl ${createAgentAiMenuOpen ? "is-open" : ""}`}>
                        <button
                          type="button"
                          className="cc-agentCreateAiIconBtn cc-agentCreateAiIconBtn--ai"
                          onClick={() => {
                            if (createAgentAiBusy) return;
                            setCreateAgentAiPromptOpen(false);
                            setCreateAgentAiControlMenu(null);
                            setCreateAgentAiMenuOpen((prev) => !prev);
                          }}
                          aria-label="Open CavAi agent actions"
                          title={createAgentAiBusy ? "CavAi is generating..." : "CavAi agent actions"}
                          aria-haspopup="menu"
                          aria-expanded={createAgentAiMenuOpen || createAgentAiPromptOpen}
                          disabled={createAgentAiBusy}
                        >
                          <span className="cc-agentCreateAiGlyph" aria-hidden="true" />
                        </button>
                        {createAgentAiMenuOpen ? (
                          <div className="cc-agentCreateAiMenu cc-agentCreateAiMenu--draft" role="menu" aria-label="CavAi agent actions">
                            <button
                              type="button"
                              className={`cc-agentCreateAiMenuItem cc-agentCreateAiMenuItem--draft ${
                                createAgentAiBusy && createAgentAiWorkingMode === "help_write" ? "is-working" : ""
                              }`}
                              role="menuitem"
                              onClick={openCreateAgentAiPrompt}
                              disabled={createAgentAiBusy}
                              aria-busy={createAgentAiBusy && createAgentAiWorkingMode === "help_write"}
                            >
                              <span className="cc-agentCreateAiMenuItemRow">
                                <span className="cc-agentCreateAiMenuItemTitle">Help me create</span>
                                <span
                                  className={`cc-agentCreateAiMenuItemIcon cc-agentCreateAiMenuItemIcon--wand ${
                                    createAgentAiBusy && createAgentAiWorkingMode === "help_write" ? "is-working" : ""
                                  }`}
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                            <button
                              type="button"
                              className={`cc-agentCreateAiMenuItem cc-agentCreateAiMenuItem--draft ${
                                createAgentAiBusy && createAgentAiWorkingMode === "generate_agent" ? "is-working" : ""
                              }`}
                              role="menuitem"
                              onClick={() => void runCreateAgentAiDraft("generate_agent")}
                              disabled={createAgentAiBusy}
                              aria-busy={createAgentAiBusy && createAgentAiWorkingMode === "generate_agent"}
                            >
                              <span className="cc-agentCreateAiMenuItemRow">
                                <span className="cc-agentCreateAiMenuItemTitle">Generate with CavAi</span>
                                <span
                                  className={`cc-agentCreateAiMenuItemIcon cc-agentCreateAiMenuItemIcon--sparkles ${
                                    createAgentAiBusy && createAgentAiWorkingMode === "generate_agent" ? "is-working" : ""
                                  }`}
                                  aria-hidden="true"
                                />
                              </span>
                            </button>
                          </div>
                        ) : null}
                        {createAgentAiPromptOpen ? (
                          <div className="cc-agentCreateAiMenu cc-agentCreateAiMenu--prompt" role="dialog" aria-label="Help me write prompt">
                            <div className="cc-agentCreateAiPromptWrap">
                              <textarea
                                ref={createAgentAiHelpPromptInputRef}
                                className="cc-agentCreateAiPromptInput"
                                value={createAgentAiPromptText}
                                onChange={(event) => setCreateAgentAiPromptText(String(event.currentTarget.value || "").slice(0, 1200))}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
                                  event.preventDefault();
                                  submitCreateAgentAiPrompt();
                                }}
                                placeholder=""
                                spellCheck
                                disabled={createAgentAiBusy}
                              />
                              {!createAgentAiPromptText.trim() ? (
                                <span key={createAgentAiPromptHintCycle} className="cc-agentCreateAiPromptHint" aria-hidden="true">
                                  {createAgentAiPromptHint}
                                </span>
                              ) : null}
                            </div>
                            <div className="cc-agentCreateAiPromptActions">
                              <button
                                type="button"
                                className="cc-agentCreateAiPromptBtn cc-agentCreateAiPromptBtn--ghost"
                                onClick={() => {
                                  setCreateAgentAiPromptOpen(false);
                                  setCreateAgentAiMenuOpen(true);
                                }}
                                disabled={createAgentAiBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="cc-agentCreateAiPromptBtn is-primary"
                                onClick={submitCreateAgentAiPrompt}
                                disabled={createAgentAiBusy || !createAgentAiPromptText.trim()}
                              >
                                {createAgentAiPromptActionLabel}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    </div>
                  )) : null}
                </div>

                {skillsPageView === "agents" && createAgentOpen ? (() => {
                  const draftName = createAgentName.trim() || "Untitled Agent";
                  const draftSummary =
                    createAgentSummary.trim()
                    || "Give your agent a clear mission so people know exactly when to bring it in.";
                  const createAgentBusy = Boolean(savingAgentId);

                  return (
                    <section className="cc-agentCreatePanel" role="region" aria-label="Create Agent">
                      <div className="cc-agentCreatePanelInner">
                        <header className="cc-agentCreateHero">
                          <div className="cc-agentCreateHeadWrap">
                            <div className="cc-agentCreateHead">
                              <div>
                                <h3>Create Agent</h3>
                              </div>
                            </div>
                            <p className="cc-agentCreateSub">
                              Shape an install-ready specialist with a clear role, operating voice, and launch surface.
                            </p>
                          </div>

                          <div className="cc-agentCreateIdentityCard">
                            <div className="cc-agentCreateIdentityMedia">
                              {createAgentIconSvg ? (
                                <div
                                  className="cc-agentCreateColorWrap"
                                  data-agent-create-color="true"
                                  ref={createAgentColorMenuRef}
                                >
                                  <button
                                    type="button"
                                    className={`cc-agentCreateColorBtn ${createAgentColorMenuOpen ? "is-open" : ""}`}
                                    onClick={() => setCreateAgentColorMenuOpen((prev) => !prev)}
                                    aria-label="Choose agent icon background color"
                                    aria-haspopup="dialog"
                                    aria-expanded={createAgentColorMenuOpen}
                                  >
                                    <svg viewBox="0 0 20 20" aria-hidden="true" className="cc-agentCreateColorBtnGlyph">
                                      <path
                                        d="M9.22 2.44a2.2 2.2 0 0 1 3.11 0l1.7 1.7a2.2 2.2 0 0 1 0 3.11l-1.06 1.05a2.6 2.6 0 0 1 1.4 2.3A2.6 2.6 0 0 1 11.77 13H8.8a2.45 2.45 0 0 0-2.44 2.44c0 1.26-1.03 2.28-2.3 2.28a2.3 2.3 0 0 1-2.3-2.28c0-1.13.83-2.08 1.92-2.25l5.54-10.75Zm1.55 1.55a.7.7 0 0 0-.99 0L7.85 7.92l4.23 4.23 1.94-1.94a.7.7 0 0 0 0-.99ZM4.06 14.7a.78.78 0 1 0 .01 1.56.78.78 0 0 0-.01-1.56Z"
                                        fill="currentColor"
                                      />
                                    </svg>
                                    <span
                                      className="cc-agentCreateColorBtnDot"
                                      aria-hidden="true"
                                      style={{ background: createAgentIconBackground || DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND }}
                                    />
                                  </button>
                                  {createAgentColorMenuOpen ? (
                                    <div className="cc-agentCreateColorMenu" role="dialog" aria-label="Agent icon color">
                                      <button
                                        type="button"
                                        className="cc-agentCreateColorPreview"
                                        onClick={() => createAgentColorNativeInputRef.current?.click()}
                                        style={{ background: createAgentIconBackground || DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND }}
                                      >
                                        <span className="cc-agentCreateColorPreviewLabel">Open color picker</span>
                                      </button>
                                      <input
                                        ref={createAgentColorNativeInputRef}
                                        className="cc-agentCreateColorNativeInput"
                                        type="color"
                                        value={createAgentIconBackground || DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND}
                                        onChange={(event) => {
                                          const next = normalizeAgentColorHexFromUnknown(event.currentTarget.value)
                                            || DEFAULT_CUSTOM_AGENT_ICON_BACKGROUND;
                                          setCreateAgentIconBackground(next);
                                          setCreateAgentColorInput(next);
                                        }}
                                        tabIndex={-1}
                                        aria-hidden="true"
                                      />
                                      <label className="cc-agentCreateColorField" htmlFor="cc-agent-create-color-input">
                                        <span className="cc-agentCreateColorFieldLabel">Hex</span>
                                        <input
                                          ref={createAgentColorInputRef}
                                          id="cc-agent-create-color-input"
                                          className="cc-agentCreateColorHexInput"
                                          value={createAgentColorInput}
                                          onChange={(event) => {
                                            const next = String(event.currentTarget.value || "").slice(0, 9);
                                            setCreateAgentColorInput(next);
                                            const normalized = normalizeAgentColorHexFromUnknown(next);
                                            if (normalized) setCreateAgentIconBackground(normalized);
                                          }}
                                          onBlur={() => {
                                            void commitCreateAgentIconBackground(createAgentColorInput);
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key !== "Enter") return;
                                            event.preventDefault();
                                            void commitCreateAgentIconBackground(createAgentColorInput);
                                          }}
                                          placeholder="#4EA8FF"
                                          spellCheck={false}
                                          autoCapitalize="off"
                                          autoCorrect="off"
                                        />
                                      </label>
                                      {createAgentIconPalette.length ? (
                                        <div className="cc-agentCreateColorSwatches" aria-label="Detected icon colors">
                                          {createAgentIconPalette.map((color) => (
                                            <button
                                              key={color}
                                              type="button"
                                              className={`cc-agentCreateColorSwatch ${
                                                color === createAgentIconBackground ? "is-active" : ""
                                              }`}
                                              onClick={() => {
                                                setCreateAgentIconBackground(color);
                                                setCreateAgentColorInput(color);
                                              }}
                                              title={color}
                                              aria-label={`Use ${color} for the icon background`}
                                              style={{ background: color }}
                                            />
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              <button
                                type="button"
                                className="cc-agentCreateIconBox cc-agentCreateIconBox--hero"
                                onClick={() => createAgentIconInputRef.current?.click()}
                                aria-label="Upload agent icon"
                                style={createAgentIconSvg && createAgentIconBackground
                                  ? {
                                      background: createAgentIconBackground,
                                      borderColor: rgbaFromAgentHex(
                                        mixAgentHexColors(createAgentIconBackground, "#FFFFFF", 0.22),
                                        0.32,
                                      ),
                                    }
                                  : undefined}
                              >
                                {createAgentIconSvg ? (
                                  <Image
                                    src={svgToDataUri(createAgentIconSvg)}
                                    alt=""
                                    width={70}
                                    height={70}
                                    className="cc-agentCreateIconPreview"
                                    unoptimized
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <span className="cc-agentCreateIconPlaceholderGlyph" aria-hidden="true" />
                                )}
                              </button>
                            </div>

                            <div className="cc-agentCreateIdentityBody">
                              <div className="cc-agentCreateIdentityKicker">Agent avatar</div>
                              <div className="cc-agentCreateIdentityNameRow">
                                <h4 className="cc-agentCreateIdentityName">{draftName}</h4>
                              </div>
                              <p className="cc-agentCreateIdentitySummary">{draftSummary}</p>
                            </div>

                            <input
                              ref={createAgentIconInputRef}
                              id="cc-agent-create-icon-input"
                              className="cc-agentCreateIconInput"
                              type="file"
                              accept=".svg,image/svg+xml"
                              onChange={(event) => void onCreateAgentIconUpload(event)}
                            />
                          </div>
                        </header>

                        <form
                          className="cc-agentCreateForm"
                          onSubmit={(event) => {
                            event.preventDefault();
                            createCustomAgent();
                          }}
                        >
                          <section className="cc-agentCreateSection" aria-labelledby="cc-agent-create-identity-title">
                            <div className="cc-agentCreateSectionHead">
                              <div>
                                <span className="cc-agentCreateSectionEyebrow">Identity</span>
                                <h4 id="cc-agent-create-identity-title">How the agent shows up</h4>
                              </div>
                              <p className="cc-agentCreateSectionNote">
                                Make the role easy to read before anyone opens the agent.
                              </p>
                            </div>
                            <div className="cc-agentCreateFieldGrid">
                              <div className="cc-agentCreateField">
                                <label className="cc-agentCreateLabel" htmlFor="cc-agent-create-name">Name</label>
                                <p id="cc-agent-create-name-note" className="cc-agentCreateFieldNote">
                                  Short, sharp, and easy to scan inside the agent shelf.
                                </p>
                                <input
                                  id="cc-agent-create-name"
                                  className="cc-agentCreateInput"
                                  aria-describedby="cc-agent-create-name-note"
                                  value={createAgentName}
                                  onChange={(event) => {
                                    setCreateAgentName(event.currentTarget.value);
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                  placeholder="Error Explainer"
                                  maxLength={64}
                                />
                              </div>

                              <div className="cc-agentCreateField cc-agentCreateField--wide">
                                <label className="cc-agentCreateLabel" htmlFor="cc-agent-create-summary">Description</label>
                                <p id="cc-agent-create-summary-note" className="cc-agentCreateFieldNote">
                                  Summarize the outcome this agent owns for the team.
                                </p>
                                <textarea
                                  id="cc-agent-create-summary"
                                  className="cc-agentCreateInput cc-agentCreateTextarea cc-agentCreateTextarea--short"
                                  aria-describedby="cc-agent-create-summary-note"
                                  value={createAgentSummary}
                                  onChange={(event) => {
                                    setCreateAgentSummary(event.currentTarget.value);
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                  placeholder="Explain failures, isolate root cause, and suggest safe next steps."
                                  rows={3}
                                  maxLength={220}
                                />
                              </div>
                            </div>
                          </section>

                          <section className="cc-agentCreateSection" aria-labelledby="cc-agent-create-behavior-title">
                            <div className="cc-agentCreateSectionHead">
                              <div>
                                <span className="cc-agentCreateSectionEyebrow">Behavior</span>
                                <h4 id="cc-agent-create-behavior-title">How the agent should think and respond</h4>
                              </div>
                              <p className="cc-agentCreateSectionNote">
                                Capture the cues that wake it up and the rules it should follow.
                              </p>
                            </div>
                            <div className="cc-agentCreateFieldGrid">
                              <div className="cc-agentCreateField">
                                <label className="cc-agentCreateLabel" htmlFor="cc-agent-create-triggers">Trigger phrases</label>
                                <p id="cc-agent-create-triggers-note" className="cc-agentCreateFieldNote">
                                  Add phrases users naturally say when they need this specialist.
                                </p>
                                <input
                                  id="cc-agent-create-triggers"
                                  className="cc-agentCreateInput"
                                  aria-describedby="cc-agent-create-triggers-note"
                                  value={createAgentTriggers}
                                  onChange={(event) => {
                                    setCreateAgentTriggers(event.currentTarget.value);
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                  placeholder="e.g. explain stack trace, summarize PR, debug failing test"
                                  maxLength={240}
                                />
                              </div>

                              <div className="cc-agentCreateField cc-agentCreateField--wide">
                                <label className="cc-agentCreateLabel" htmlFor="cc-agent-create-instructions">Instructions</label>
                                <p id="cc-agent-create-instructions-note" className="cc-agentCreateFieldNote">
                                  Define the agent&apos;s operating principles, tone, guardrails, and output expectations.
                                </p>
                                <textarea
                                  id="cc-agent-create-instructions"
                                  className="cc-agentCreateInput cc-agentCreateTextarea cc-agentCreateTextarea--tall"
                                  aria-describedby="cc-agent-create-instructions-note"
                                  value={createAgentInstructions}
                                  onChange={(event) => {
                                    setCreateAgentInstructions(event.currentTarget.value);
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                  placeholder="You are a precise debugging partner. Explain the failure, identify the likely root cause, and propose the safest next move before suggesting larger changes."
                                  rows={7}
                                  maxLength={2400}
                                />
                              </div>
                            </div>
                          </section>

                          <fieldset className="cc-agentCreateSection cc-agentCreateSection--surface" aria-describedby="cc-agent-create-surface-note">
                            <legend className="cc-agentCreateSectionLegend">Placement</legend>
                            <div className="cc-agentCreateSectionHead">
                              <div>
                                <span className="cc-agentCreateSectionEyebrow">Placement</span>
                                <h4 className="cc-agentCreateSectionTitle">Choose the launch surface</h4>
                              </div>
                              <p id="cc-agent-create-surface-note" className="cc-agentCreateSectionNote">
                                Decide where users can meet this agent.
                              </p>
                            </div>
                            <div className="cc-agentCreateSurfaceGrid">
                              <label className={`cc-agentCreateSurfaceCard ${createAgentSurface === "all" ? "is-selected" : ""}`}>
                                <input
                                  className="cc-agentCreateSurfaceInput"
                                  type="radio"
                                  name="cc-agent-create-surface"
                                  value="all"
                                  checked={createAgentSurface === "all"}
                                  onChange={() => {
                                    setCreateAgentSurface("all");
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                />
                                <span className="cc-agentCreateSurfaceCardTop">
                                  <span className="cc-agentCreateSurfaceKicker">Everywhere</span>
                                  <span className="cc-agentCreateSurfaceCheck" aria-hidden="true" />
                                </span>
                                <span className="cc-agentCreateSurfaceTitle">All surfaces</span>
                                <span className="cc-agentCreateSurfaceDesc">
                                  Install once and keep the agent available anywhere Caven appears.
                                </span>
                              </label>

                              <label className={`cc-agentCreateSurfaceCard ${createAgentSurface === "cavcode" ? "is-selected" : ""}`}>
                                <input
                                  className="cc-agentCreateSurfaceInput"
                                  type="radio"
                                  name="cc-agent-create-surface"
                                  value="cavcode"
                                  checked={createAgentSurface === "cavcode"}
                                  onChange={() => {
                                    setCreateAgentSurface("cavcode");
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                />
                                <span className="cc-agentCreateSurfaceCardTop">
                                  <span className="cc-agentCreateSurfaceKicker">Workspace</span>
                                  <span className="cc-agentCreateSurfaceCheck" aria-hidden="true" />
                                </span>
                                <span className="cc-agentCreateSurfaceTitle">Caven</span>
                                <span className="cc-agentCreateSurfaceDesc">
                                  Keep the agent focused on hands-on creation and workspace execution inside Caven.
                                </span>
                              </label>

                              <label className={`cc-agentCreateSurfaceCard ${createAgentSurface === "center" ? "is-selected" : ""}`}>
                                <input
                                  className="cc-agentCreateSurfaceInput"
                                  type="radio"
                                  name="cc-agent-create-surface"
                                  value="center"
                                  checked={createAgentSurface === "center"}
                                  onChange={() => {
                                    setCreateAgentSurface("center");
                                    if (createAgentError) setCreateAgentError("");
                                  }}
                                />
                                <span className="cc-agentCreateSurfaceCardTop">
                                  <span className="cc-agentCreateSurfaceKicker">Conversation</span>
                                  <span className="cc-agentCreateSurfaceCheck" aria-hidden="true" />
                                </span>
                                <span className="cc-agentCreateSurfaceTitle">CavAi</span>
                                <span className="cc-agentCreateSurfaceDesc">
                                  Reserve the agent for conversational planning, guidance, and centered collaboration.
                                </span>
                              </label>
                            </div>
                          </fieldset>

                          {createAgentError ? <div className="cc-agentCreateError" role="alert">{createAgentError}</div> : null}

                          <div className="cc-agentCreateActions">
                            <div className="cc-agentCreateActionsRow">
                              <button
                                type="button"
                                className="cc-agentCreateBtn"
                                onClick={() => closeCreateAgent()}
                                disabled={createAgentBusy}
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="cc-agentCreateBtn cc-agentCreateBtnPrimary"
                                disabled={createAgentBusy}
                              >
                                {createAgentBusy ? "Creating..." : "Create Agent"}
                              </button>
                            </div>
                          </div>
                        </form>
                      </div>
                    </section>
                  );
                })() : null}

                {skillsPageView === "agents" && !createAgentOpen ? (
                  <>
                    <div className="cc-skills-head">
                      <h2>Caven Agents</h2>
                      <p>Give Caven a team of specialists.</p>
                    </div>

                    <div className="cc-skills-sectionLabel">Installed</div>
                    <div className="cc-skills-grid">
                      {cavenInstalledAgents.map((agent) => (
                        <article key={agent.id} className="cc-skills-card" title={agent.summary}>
                          <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                            <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                          </span>
                          <div className="cc-skills-cardBody">
                            <div className="cc-skills-cardTitle">{agent.name}</div>
                          </div>
                          <span className="cc-skills-cardActionWrap" data-agent-manage-id={agent.id}>
                            <button
                              type="button"
                              className="cc-skills-cardIconBtn is-installed cc-skills-cardManageBtn"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAgentManageMenuId((prev) => (prev === agent.id ? "" : agent.id));
                              }}
                              disabled={Boolean(savingAgentId)}
                              title={`Manage ${agent.name}`}
                              aria-label={`Manage ${agent.name}`}
                            >
                              <svg className="cc-skills-cardManageCheck" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <path
                                  d="M3.25 8.5L6.5 11.75L12.75 4.75"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.9"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              <svg className="cc-skills-cardManageDots" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
                              </svg>
                            </button>
                            {agentManageMenuId === agent.id ? (
                              <div className="cc-skills-cardManageMenu" role="menu" onClick={(event) => event.stopPropagation()}>
                                <button
                                  type="button"
                                  className="cc-skills-cardManageMenuItem"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setAgentManageMenuId("");
                                    toggleAgentInstalled(agent.id, false);
                                  }}
                                >
                                  Uninstall
                                </button>
                              </div>
                            ) : null}
                          </span>
                        </article>
                      ))}
                      {!cavenInstalledAgents.length ? <div className="cc-skills-empty">No installed agents match your search.</div> : null}
                    </div>

                    <div className="cc-skills-sectionLabel">Available</div>
                    <div className="cc-skills-grid">
                      {cavenAvailableAgents.map((agent) => (
                        <article key={agent.id} className="cc-skills-card" title={agent.summary}>
                          <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                            <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                          </span>
                          <div className="cc-skills-cardBody">
                            <div className="cc-skills-cardTitle">{agent.name}</div>
                          </div>
                          <button
                            type="button"
                            className="cc-skills-cardIconBtn"
                            onClick={() => toggleAgentInstalled(agent.id, true)}
                            disabled={Boolean(savingAgentId)}
                            title="Install Agent"
                            aria-label={`Install ${agent.name}`}
                          >
                            <Image
                              src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
                              alt=""
                              width={15}
                              height={15}
                              aria-hidden="true"
                            />
                          </button>
                        </article>
                      ))}
                      {!cavenAvailableAgents.length ? <div className="cc-skills-empty">All Caven-native agents are installed.</div> : null}
                    </div>

                    <div className="cc-skills-sectionLabel">Caven Support Skills</div>
                    <div className="cc-skills-grid">
                      {cavenSupportInstalledAgents.map((agent) => (
                        <article key={agent.id} className="cc-skills-card" title={agent.summary}>
                          <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                            <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                          </span>
                          <div className="cc-skills-cardBody">
                            <div className="cc-skills-cardTitle">{agent.name}</div>
                          </div>
                          <span className="cc-skills-cardActionWrap" data-agent-manage-id={agent.id}>
                            <button
                              type="button"
                              className="cc-skills-cardIconBtn is-installed cc-skills-cardManageBtn"
                              onClick={(event) => {
                                event.stopPropagation();
                                setAgentManageMenuId((prev) => (prev === agent.id ? "" : agent.id));
                              }}
                              disabled={Boolean(savingAgentId)}
                              title={`Manage ${agent.name}`}
                              aria-label={`Manage ${agent.name}`}
                            >
                              <svg className="cc-skills-cardManageCheck" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <path
                                  d="M3.25 8.5L6.5 11.75L12.75 4.75"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.9"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                              <svg className="cc-skills-cardManageDots" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                                <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
                              </svg>
                            </button>
                            {agentManageMenuId === agent.id ? (
                              <div className="cc-skills-cardManageMenu" role="menu" onClick={(event) => event.stopPropagation()}>
                                <button
                                  type="button"
                                  className="cc-skills-cardManageMenuItem"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setAgentManageMenuId("");
                                    toggleAgentInstalled(agent.id, false);
                                  }}
                                >
                                  Uninstall
                                </button>
                              </div>
                            ) : null}
                          </span>
                        </article>
                      ))}
                      {cavenSupportAvailableAgents.map((agent) => (
                        <article key={agent.id} className="cc-skills-card" title={agent.summary}>
                          <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                            <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                          </span>
                          <div className="cc-skills-cardBody">
                            <div className="cc-skills-cardTitle">{agent.name}</div>
                          </div>
                          <button
                            type="button"
                            className="cc-skills-cardIconBtn"
                            onClick={() => toggleAgentInstalled(agent.id, true)}
                            disabled={Boolean(savingAgentId)}
                            title="Install Support Skill"
                            aria-label={`Install ${agent.name}`}
                          >
                            <Image
                              src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
                              alt=""
                              width={15}
                              height={15}
                              aria-hidden="true"
                            />
                          </button>
                        </article>
                      ))}
                      {cavenSupportLockedAgents.map((agent) => {
                        const requiredPlan = agent.minimumPlan;
                        const requiredLabel = requiredPlanLabel(requiredPlan);
                        const upgradeHref = requiredPlan === "premium_plus"
                          ? "/settings/upgrade?plan=premium_plus&billing=monthly"
                          : "/settings/upgrade?plan=premium&billing=monthly";
                        return (
                          <article
                            key={agent.id}
                            className="cc-skills-card"
                            title={`${agent.summary} Requires ${requiredLabel}.`}
                          >
                            <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                              <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                            </span>
                            <div className="cc-skills-cardBody">
                              <div className="cc-skills-cardTitle">{agent.name}</div>
                            </div>
                            <a
                              href={upgradeHref}
                              className="cc-skills-cardIconBtn"
                              title={`Locked. Requires ${requiredLabel}`}
                              aria-label={`${agent.name} is locked. Requires ${requiredLabel}`}
                            >
                              <LockIcon width={15} height={15} aria-hidden="true" />
                            </a>
                          </article>
                        );
                      })}
                      {!cavenSupportInstalledAgents.length && !cavenSupportAvailableAgents.length && !cavenSupportLockedAgents.length
                        ? <div className="cc-skills-empty">No support skills match your search.</div>
                        : null}
                    </div>

                    {cavenPremiumLockedAgents.length ? (
                      <>
                        <div className="cc-skills-sectionLabel">Premium+ Locked</div>
                        <div className="cc-skills-grid">
                          {cavenPremiumLockedAgents.map((agent) => {
                            const requiredPlan = agent.minimumPlan;
                            const requiredLabel = requiredPlanLabel(requiredPlan);
                            const upgradeHref = requiredPlan === "premium_plus"
                              ? "/settings/upgrade?plan=premium_plus&billing=monthly"
                              : "/settings/upgrade?plan=premium&billing=monthly";
                            return (
                              <article
                                key={agent.id}
                                className="cc-skills-card"
                                title={`${agent.summary} Requires ${requiredLabel}.`}
                              >
                                <span className="cc-skills-cardIcon" data-agent-id={agent.id} aria-hidden="true">
                                  <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                                </span>
                                <div className="cc-skills-cardBody">
                                  <div className="cc-skills-cardTitle">{agent.name}</div>
                                </div>
                                <a
                                  href={upgradeHref}
                                  className="cc-skills-cardIconBtn"
                                  title={`Locked. Requires ${requiredLabel}`}
                                  aria-label={`${agent.name} is locked. Requires ${requiredLabel}`}
                                >
                                  <LockIcon width={15} height={15} aria-hidden="true" />
                                </a>
                              </article>
                            );
                          })}
                        </div>
                      </>
                    ) : null}

                    <div className="cc-skills-sectionLabel">My Agents</div>
                    <div className="cc-skills-grid">
                      <button
                        type="button"
                        className="cc-skills-card cc-skills-cardBuild"
                        onClick={() => {
                          setCreateAgentError("");
                          setCreateAgentOpen(true);
                        }}
                        aria-label="Build an agent"
                      >
                        <span className="cc-skills-cardIcon cc-skills-cardIconPlain" aria-hidden="true">
                          <Image
                            src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
                            alt=""
                            width={18}
                            height={18}
                            className="cc-skills-buildCardIconImg"
                            unoptimized
                          />
                        </span>
                        <div className="cc-skills-cardBody">
                          <div className="cc-skills-cardTitle">Build an agent</div>
                          <div className="cc-skills-cardSummary">
                            Build your own agent, add triggers, and define instructions.
                          </div>
                        </div>
                      </button>
                      {visibleCustomAgents.map((agent) => (
                        <article key={agent.id} className="cc-skills-card" title={agent.summary}>
                          <span
                            className="cc-skills-cardIcon"
                            data-agent-id={agent.id}
                            aria-hidden="true"
                            style={buildAgentIconSurfaceStyle(agent.iconBackground)}
                          >
                            <Image src={agent.iconSrc} alt="" width={22} height={22} unoptimized />
                          </span>
                          <div className="cc-skills-cardBody">
                            <div className="cc-skills-cardTitle">{agent.name}</div>
                          </div>
                          {installedAgentSet.has(agent.id) ? (
                            <span className="cc-skills-cardActionWrap" data-agent-manage-id={agent.id}>
                              <button
                                type="button"
                                className="cc-skills-cardIconBtn is-installed cc-skills-cardManageBtn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setAgentManageMenuId((prev) => (prev === agent.id ? "" : agent.id));
                                }}
                                disabled={Boolean(savingAgentId)}
                                title={`Manage ${agent.name}`}
                                aria-label={`Manage ${agent.name}`}
                              >
                                <svg className="cc-skills-cardManageCheck" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                  <path
                                    d="M3.25 8.5L6.5 11.75L12.75 4.75"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.9"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                                <svg className="cc-skills-cardManageDots" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                  <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
                                  <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                                  <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
                                </svg>
                              </button>
                              {agentManageMenuId === agent.id ? (
                                <div className="cc-skills-cardManageMenu" role="menu" onClick={(event) => event.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="cc-skills-cardManageMenuItem"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setAgentManageMenuId("");
                                      toggleAgentInstalled(agent.id, false);
                                    }}
                                  >
                                    Uninstall
                                  </button>
                                  <button
                                    type="button"
                                    className="cc-skills-cardManageMenuItem"
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
                                    className="cc-skills-cardManageMenuItem"
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
                                    className="cc-skills-cardManageMenuItem"
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
                                    className="cc-skills-cardManageMenuItem cc-skills-cardManageMenuItemDanger"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      deleteCustomAgent(agent.id);
                                    }}
                                  >
                                    Delete Agent
                                  </button>
                                </div>
                              ) : null}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="cc-skills-cardIconBtn"
                              onClick={() => toggleAgentInstalled(agent.id, true)}
                              disabled={Boolean(savingAgentId)}
                              title={`Install ${agent.name}`}
                              aria-label={`Install ${agent.name}`}
                            >
                              <Image
                                src="/icons/app/cavcode/plus-large-svgrepo-com.svg"
                                alt=""
                                width={15}
                                height={15}
                                aria-hidden="true"
                              />
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  </>
                ) : skillsPageView === "general" ? (
                  <>
                    <div className="cc-skills-head">
                      <h2>General</h2>
                      <p>Core Caven behavior and runtime defaults.</p>
                    </div>
                    <section className="cc-ideSettingsPanel" role="region" aria-label="Caven general settings">
                      <label className="cc-ideSettingsRow">
                        <span>Default model</span>
                        <select
                          className="cc-ideSettingsSelect"
                          value={normalizeCavenGeneralModelId(cavenIdeSettings.defaultModelId)}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { defaultModelId: normalizeCavenGeneralModelId(event.currentTarget.value) },
                              "defaultModelId"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        >
                          {cavenGeneralModelOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Speed</span>
                        <select
                          className="cc-ideSettingsSelect"
                          value={cavenIdeSettings.inferenceSpeed}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { inferenceSpeed: toCavenInferenceSpeed(event.currentTarget.value) },
                              "inferenceSpeed"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        >
                          <option value="standard">Standard</option>
                          <option value="fast">Fast</option>
                        </select>
                      </label>
                    </section>
                    <section className="cc-ideSettingsPanel cc-ideSettingsPanelSub" role="region" aria-label="Caven queue and composer settings">
                      <label className="cc-ideSettingsRow">
                        <span>Follow-up behavior</span>
                        <div className="cc-ideFollowUps">
                          <button
                            type="button"
                            className={`cc-ideFollowUpsBtn ${cavenIdeSettings.queueFollowUps ? "is-on" : ""}`}
                            onClick={() => void patchCavenIdeSettings({ queueFollowUps: true }, "queueFollowUps")}
                            disabled={Boolean(savingCavenIdeSettingsKey)}
                          >
                            Queue
                          </button>
                          <button
                            type="button"
                            className={`cc-ideFollowUpsBtn ${!cavenIdeSettings.queueFollowUps ? "is-on" : ""}`}
                            onClick={() => void patchCavenIdeSettings({ queueFollowUps: false }, "queueFollowUps")}
                            disabled={Boolean(savingCavenIdeSettingsKey)}
                          >
                            Steer
                          </button>
                        </div>
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Require ⌘/Ctrl + Enter for send</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.composerEnterBehavior === "meta_enter"}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { composerEnterBehavior: event.currentTarget.checked ? "meta_enter" : "enter" },
                              "composerEnterBehavior"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <div className="cc-ideSettingsRow cc-ideSettingsRowAction">
                        <span>config.toml</span>
                        <button
                          type="button"
                          className="cc-skills-refresh cc-ideSettingsInlineAction"
                          onClick={openCavenConfigTomlTab}
                        >
                          Open config.toml
                        </button>
                      </div>
                    </section>
                    <div className="cc-ideSettingsMeta">
                      {savingCavenIdeSettingsKey ? "Saving..." : ""}
                    </div>
                  </>
                ) : skillsPageView === "ide" ? (
                  <>
                    <div className="cc-skills-head">
                      <h2>IDE Settings</h2>
                      <p>Configure how Caven behaves inside CavCode.</p>
                    </div>
                    <section className="cc-ideSettingsPanel" role="region" aria-label="Caven IDE settings">
                      <label className="cc-ideSettingsRow">
                        <span>Queue follow-ups</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.queueFollowUps}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { queueFollowUps: event.currentTarget.checked },
                              "queueFollowUps"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Composer enter behavior</span>
                        <select
                          className="cc-ideSettingsSelect"
                          value={cavenIdeSettings.composerEnterBehavior}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { composerEnterBehavior: toCavenComposerEnterBehavior(event.currentTarget.value) },
                              "composerEnterBehavior"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        >
                          <option value="enter">Enter sends</option>
                          <option value="meta_enter">Cmd/Ctrl + Enter sends</option>
                        </select>
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Default reasoning level</span>
                        <select
                          className="cc-ideSettingsSelect"
                          value={cavenIdeSettings.defaultReasoningLevel}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              {
                                defaultReasoningLevel:
                                  toCavenReasoningLevel(event.currentTarget.value)
                                  || DEFAULT_CAVEN_IDE_SETTINGS.defaultReasoningLevel,
                              },
                              "defaultReasoningLevel"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        >
                          {CAVEN_REASONING_LEVEL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Include IDE context</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.includeIdeContext}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { includeIdeContext: event.currentTarget.checked },
                              "includeIdeContext"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Confirm before Apply Patch</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.confirmBeforeApplyPatch}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { confirmBeforeApplyPatch: event.currentTarget.checked },
                              "confirmBeforeApplyPatch"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Auto-open resolved files</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.autoOpenResolvedFiles}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { autoOpenResolvedFiles: event.currentTarget.checked },
                              "autoOpenResolvedFiles"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Show reasoning timeline</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.showReasoningTimeline}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { showReasoningTimeline: event.currentTarget.checked },
                              "showReasoningTimeline"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                      <label className="cc-ideSettingsRow">
                        <span>Share telemetry</span>
                        <input
                          type="checkbox"
                          checked={cavenIdeSettings.telemetryOptIn}
                          onChange={(event) =>
                            void patchCavenIdeSettings(
                              { telemetryOptIn: event.currentTarget.checked },
                              "telemetryOptIn"
                            )
                          }
                          disabled={Boolean(savingCavenIdeSettingsKey)}
                        />
                      </label>
                    </section>
                    <div className="cc-ideSettingsMeta">
                      {savingCavenIdeSettingsKey ? "Saving..." : ""}
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <div
                className={`cc-editor-panes ${splitLayout === "right" ? "is-right" : splitLayout === "down" ? "is-down" : "is-single"}`}
              >
                <div
                  className={`cc-editor-pane ${activePane === "primary" ? "is-active" : ""}`}
                  data-pane="primary"
                  onMouseDown={() => focusEditorPane("primary")}
                >
                    {renderCodeEditorPane(primaryFile, primaryTab, "primary")}
                </div>
                {splitLayout !== "single" ? (
                  <div
                    className={`cc-editor-pane is-secondary ${activePane === "secondary" ? "is-active" : ""}`}
                    data-pane="secondary"
                    onMouseDown={() => focusEditorPane("secondary")}
                  >
                    {renderCodeEditorPane(secondaryFile, secondaryTab, "secondary")}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Bottom Panel */}
	          {panelOpen && !activeSkillsTab ? (
	            <div className={`cc-panel ${panelExpanded ? "is-expanded" : ""}`} aria-label="Panel">
	              <div className={`cc-panel-tabs${panelTab === "git" || panelTab === "run" ? " is-git" : ""}`} data-cc-hard="panel-tabs">
	                {panelTab === "git" ? (
                    <div className="cc-panel-gitHead">
                      <div className="cc-panel-gitHeadTitleWrap">
                        <span className="cc-panel-gitHeadTitle">GIT PANEL</span>
                        <span className="cc-panel-gitHeadBranch mono">{scmBranchLabel}</span>
                      </div>
                      <div className="cc-panel-gitHeadMeta mono">{scmHeaderMeta}</div>
                    </div>
                  ) : panelTab === "run" ? (
                    <div className="cc-panel-gitHead">
                      <div className="cc-panel-gitHeadTitleWrap">
                        <span className="cc-panel-gitHeadTitle">RUN PANEL</span>
                        <span className="cc-panel-gitHeadBranch mono">{runtimeSessionId ? `session ${runtimeSessionId}` : "no session"}</span>
                      </div>
                      <div className="cc-panel-gitHeadMeta mono">{runHeaderMeta}</div>
                    </div>
                  ) : (
                    <>
                      {nonPinnedPanelTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`cc-ptab ${panelTab === tab.id ? "is-on" : ""}`}
                          data-cc-hard="panel-tab"
                          role="tab"
                          aria-selected={panelTab === tab.id}
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            setPanelViewMenuOpen(false);
                            setPanelTab(tab.id);
                          }}
                          onClick={() => {
                            setPanelViewMenuOpen(false);
                            setPanelTab(tab.id);
                          }}
                        >
                          {tab.label}
                          {tab.id === "problems" || tab.count ? (
                            <span className={`cc-badgeCount${tab.id === "problems" ? " is-problems" : ""}`} aria-hidden="true">
                              {tab.count}
                            </span>
                          ) : null}
                        </button>
                      ))}
                      <div className="cc-panel-spacer" />
                      <div className="cc-panel-meta mono">
                        {panelTab === "terminal" || panelTab === "output"
                          ? termTtyLabel
                          : panelTab === "debug"
                            ? `${debugConsoleEntries.length} debug events`
                          : panelTab === "ports"
                            ? `${detectedPortEntries.length} endpoints`
                            : `${errCount} errors · ${warnCount} warnings`}
                      </div>
                    </>
                  )}
	                <div className="cc-panel-tools" role="toolbar" aria-label="Panel controls">
                  {panelTab === "terminal" || panelTab === "output" ? (
                    <>
                      <button
                        className="cc-panel-tool"
                        onClick={() => {
                          setPanelTab("terminal");
                          termWriteLines([PROMPT_PREFIX, ""]);
                        }}
                        title="New terminal"
                        aria-label="New terminal"
                      >
                        <Image src="/icons/app/cavcode/plus-large-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                      </button>
                      <button
                        className={`cc-panel-tool ${terminalSplitView ? "is-on" : ""}`}
                        onClick={() => setTerminalSplitView((prev) => !prev)}
                        title="Split terminal"
                        aria-label="Split terminal"
                      >
                        <Image src="/icons/app/cavcode/split-cells-horizontal-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                      </button>
                      <button
                        className="cc-panel-tool"
                        onClick={() => setTermLines(terminalBootLines)}
                        title="Clear terminal"
                        aria-label="Clear terminal"
                      >
                        <Image src="/icons/trash-bin-2-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                      </button>
                      <button
                        className="cc-panel-tool"
                        onClick={stopRuntimeSessionFromPanel}
                        disabled={!runtimeSessionActive || Boolean(runtimeActionBusy)}
                        title="Stop runtime"
                        aria-label="Stop runtime"
                      >
                        <Image src="/icons/app/cavcode/stop-circle-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                      </button>
                    </>
                  ) : null}
                  {panelTab === "debug" ? (
                    <button
                      className="cc-panel-tool"
                      onClick={() => {
                        if (debugActionBusy) return;
                        setDebugActionBusy("status-all");
                        void runCmd("cav debug status --all").finally(() => setDebugActionBusy(""));
                      }}
                      disabled={Boolean(debugActionBusy)}
                      title="Refresh debug sessions"
                      aria-label="Refresh debug sessions"
                    >
                      <Image src="/icons/app/cavcode/refresh-cw-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  {panelTab === "ports" ? (
                    <button
                      className="cc-panel-tool"
                      onClick={() => void runCmd("cav remote port list")}
                      title="Refresh ports"
                      aria-label="Refresh ports"
                    >
                      <Image src="/icons/app/cavcode/refresh-cw-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  {panelTab === "git" ? (
                    <button
                      className="cc-panel-tool"
                      onClick={refreshScmStatusFromPanel}
                      disabled={Boolean(scmActionBusy)}
                      title="Refresh git status"
                      aria-label="Refresh git status"
                    >
                      <Image src="/icons/app/cavcode/refresh-cw-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  {panelTab === "run" ? (
                    <button
                      className="cc-panel-tool"
                      onClick={() => void runCmd("cav run status")}
                      disabled={Boolean(runtimeActionBusy)}
                      title="Refresh runtime status"
                      aria-label="Refresh runtime status"
                    >
                      <Image src="/icons/app/cavcode/refresh-cw-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                    </button>
                  ) : null}
	                  <div className="cc-panel-viewSwitcher" ref={panelViewMenuRef}>
	                    <button
	                      className={`cc-panel-tool ${panelViewMenuOpen ? "is-on" : ""}`}
	                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={panelViewMenuOpen}
                      aria-label="Panel view options"
                      onClick={() => setPanelViewMenuOpen((prev) => !prev)}
	                    >
	                      <IconMenuDots />
	                    </button>
	                    {panelViewMenuOpen ? (
	                      <div className="cc-panel-viewMenu" role="menu" aria-label="Panel view options">
                          {panelTab === "git" ? (
                            <>
	                            <button
	                              className="cc-panel-viewItem"
	                              role="menuitem"
	                              type="button"
	                              onClick={() => {
                                  refreshScmStatusFromPanel();
	                                setPanelViewMenuOpen(false);
	                              }}
                                disabled={Boolean(scmActionBusy)}
	                            >
	                              {scmActionBusy === "status" ? "Refreshing..." : "Refresh Status"}
	                            </button>
	                            <button
	                              className="cc-panel-viewItem"
	                              role="menuitem"
	                              type="button"
	                              onClick={() => {
                                  runScmCommandFromPanel("cav git diff", "diff");
	                                setPanelViewMenuOpen(false);
	                              }}
                                disabled={Boolean(scmActionBusy)}
	                            >
	                              Diff
	                            </button>
	                            <button
	                              className="cc-panel-viewItem"
	                              role="menuitem"
	                              type="button"
	                              onClick={() => {
                                  runScmCommandFromPanel("cav git stage .", "stage-all");
	                                setPanelViewMenuOpen(false);
	                              }}
                                disabled={Boolean(scmActionBusy)}
	                            >
	                              Stage All
	                            </button>
	                            <button
	                              className="cc-panel-viewItem"
	                              role="menuitem"
	                              type="button"
	                              onClick={() => {
                                  runScmCommandFromPanel("cav git unstage .", "unstage-all");
	                                setPanelViewMenuOpen(false);
	                              }}
                                disabled={Boolean(scmActionBusy)}
	                            >
	                              Unstage All
	                            </button>
                            </>
                          ) : (
                            <>
	                            <button
	                              className={`cc-panel-viewItem${panelTab === "run" ? " is-on" : ""}`}
	                              role="menuitemradio"
	                              aria-checked={panelTab === "run"}
	                              type="button"
	                              onClick={() => {
	                                setPanelTab("run");
	                                setPanelOpen(true);
	                                setPanelViewMenuOpen(false);
	                              }}
	                            >
	                              Run Panel
	                            </button>
	                            <button
	                              className={`cc-panel-viewItem${panelTab === "debug" ? " is-on" : ""}`}
	                              role="menuitemradio"
	                              aria-checked={panelTab === "debug"}
	                              type="button"
	                              onClick={() => {
	                                setPanelTab("debug");
	                                setPanelOpen(true);
	                                setPanelViewMenuOpen(false);
	                              }}
	                            >
	                              Debug Console
	                            </button>
		                            <button
		                              className="cc-panel-viewItem"
		                              role="menuitemradio"
		                              aria-checked={false}
		                              type="button"
		                              onClick={() => {
		                                setPanelTab("git");
	                                setPanelOpen(true);
	                                setPanelViewMenuOpen(false);
	                              }}
	                            >
	                              Git Panel
	                            </button>
	                            <button
	                              className={`cc-panel-viewItem${panelTab === "terminal" ? " is-on" : ""}`}
	                              role="menuitemradio"
	                              aria-checked={panelTab === "terminal"}
	                              type="button"
	                              onClick={() => {
	                                setPanelTab("terminal");
	                                setPanelOpen(true);
	                                setPanelViewMenuOpen(false);
	                              }}
	                            >
	                              Terminal
	                            </button>
                            </>
                          )}
	                      </div>
	                    ) : null}
	                  </div>
                  <button
                    className={`cc-panel-tool ${panelExpanded ? "is-on" : ""}`}
                    onClick={() => setPanelExpanded((prev) => !prev)}
                    title={panelExpanded ? "Restore panel size" : "Expand panel"}
                    aria-label={panelExpanded ? "Restore panel size" : "Expand panel"}
                  >
                    <Image src="/icons/app/cavcode/full-screen-svgrepo-com.svg" alt="" width={13} height={13} aria-hidden="true" />
                  </button>
                </div>
                <button
                  className="cc-panel-close"
                  data-cc-hard="panel-close"
                  onClick={() => {
                    setPanelOpen(false);
                    setPanelExpanded(false);
                    setPanelViewMenuOpen(false);
                  }}
                  title="Close Panel (Cmd/Ctrl+J)"
                >
                  <span className="cb-closeIcon" aria-hidden="true" />
                </button>
              </div>
              <div className="cc-panel-divider" data-cc-hard="panel-divider" aria-hidden="true" />

              {panelTab === "terminal" ? (
                <div className={`cc-terminal ${terminalSplitView ? "is-split" : ""}`} role="region" aria-label="Terminal">
                  <div className="cc-term-grid">
                    <div className="cc-term-pane">
                      <div className="cc-term-out mono" ref={termOutRef}>
                        {terminalVisibleLines.map((l, i) => (
                          <div key={i} className="cc-term-line">{l}</div>
                        ))}
                      </div>
                    </div>
                    {terminalSplitView ? (
                      <div className="cc-term-pane">
                        <div className="cc-term-out mono">
                          {terminalVisibleLines.map((l, i) => (
                            <div key={`split-${i}`} className="cc-term-line">{l}</div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <form
                    className="cc-term-inbar"
                    data-cc-hard="term-inbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = termInput;
                      setTermInput("");
                      void runCmd(v);
                    }}
                  >
                    <span className="cc-term-prompt mono">{PROMPT_PREFIX}</span>
                    <input
                      className="cc-term-in mono"
                      data-cc-hard="term-input"
                      value={termInput}
                      onChange={(e) => setTermInput(e.target.value)}
                      onKeyDown={handleTermKeyDown}
                      placeholder="cav run dev · cav run logs · cav diag"
                    />
                  </form>
                </div>
              ) : panelTab === "output" ? (
                <div className="cc-output" role="region" aria-label="Output">
                  <div className="cc-term-out mono">
                    {outputLines.length ? (
                      outputLines.map((line, index) => (
                        <div key={`out-${index}`} className="cc-term-line">{line}</div>
                      ))
                    ) : (
                      <div className="cc-panel-empty">No output yet.</div>
                    )}
                  </div>
                </div>
              ) : panelTab === "run" ? (
                <div className="cc-panel-git cc-panel-run" role="region" aria-label="Run Panel">
                  <div className="cc-run-card">
                    <div className="cc-run-title">Launch</div>
                    <div className="cc-run-sub">Dev/Build/Test now run in a server runtime workspace with live terminal logs. Lint runs full workspace diagnostics.</div>
                    <div className="cc-run-sub mono">
                      {runtimeSessionId
                        ? `Session ${runtimeSessionId} · ${(runtimeKind || "dev").toUpperCase()} · ${(runtimeStatus || "unknown").toUpperCase()}${runtimeExitCode != null ? ` · exit ${runtimeExitCode}` : runtimeExitSignal ? ` · ${runtimeExitSignal}` : ""}`
                        : "Session none"}
                    </div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => runPanelAction("dev")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        {runtimeActionBusy === "dev" ? "Starting..." : "Run (Dev)"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => runPanelAction("build")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        {runtimeActionBusy === "build" ? "Starting..." : "Build"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => runPanelAction("lint")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Lint
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => runPanelAction("test")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        {runtimeActionBusy === "test" ? "Starting..." : "Test"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={stopRuntimeSessionFromPanel}
                        disabled={
                          Boolean(runtimeActionBusy)
                          || !runtimeSessionId
                          || !runtimeStatus
                          || !RUNTIME_ACTIVE_STATUSES.has(runtimeStatus)
                        }
                      >
                        {runtimeActionBusy === "stop" ? "Stopping..." : "Stop"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={restartRuntimeSessionFromPanel}
                        disabled={Boolean(runtimeActionBusy) || !runtimeSessionId}
                      >
                        {runtimeActionBusy === "restart" ? "Restarting..." : "Restart"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav run status")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Status
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">Project Service &amp; Tasks</div>
                    <div className="cc-run-sub">Real tsserver lifecycle + remote workspace sync watchers + tasks.json execution/history.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav project service start")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Start Project Service
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav project service status")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Service Status
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav project service diagnostics")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Service Diagnostics
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav task list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Task List
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav task history 20")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Task History
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">Extension Host</div>
                    <div className="cc-run-sub">Server-backed extension marketplace/install lifecycle with signed manifests, host runtime sessions, and activation events.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav extension list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Installed
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav extension marketplace list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Marketplace
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav extension host start")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Host Start
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav extension host status")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Host Status
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav extension activate onStartupFinished")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Activate Startup
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">Collab &amp; Security</div>
                    <div className="cc-run-sub">DB-backed collaboration sessions/presence/oplog plus execution policy, secret broker, quarantine scan, and forensic audit trail.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav collab session list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Collab Sessions
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav security status")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Security Status
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav security scan run")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Security Scan
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav security audit 80")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Security Audit
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">Remote Dev</div>
                    <div className="cc-run-sub">Server-backed remote provider/session orchestration with port forwards and remote debug adapter discovery.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav remote provider list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Providers
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav remote session status --all")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Sessions
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav remote port list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Port Forwards
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav remote debug adapters")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Debug Adapters
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">Reliability &amp; Replay</div>
                    <div className="cc-run-sub">SLO budget status, crash tracking, reliability snapshots, and deterministic replay streams for runtime/task/debug loops.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav reliability status")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Reliability Status
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav reliability snapshots")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Snapshots
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav reliability replay")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Replay
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav reliability crash list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Crashes
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card cc-run-card-advanced">
                    <div className="cc-run-title">AI Loop &amp; Workbench</div>
                    <div className="cc-run-sub">Deterministic checkpointed AI repair loops plus persisted command palette/shortcut/view/layout state.</div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav loop checkpoint create panel-checkpoint")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Checkpoint
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav loop run \"reduce diagnostics\" --cycles 2 --rollback")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Loop Run
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => void runCmd("cav ui palette list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Palette
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => void runCmd("cav ui layout list")}
                        disabled={Boolean(runtimeActionBusy)}
                      >
                        Layout
                      </button>
                    </div>
                  </div>

                  <div className="cc-run-card">
                    <div className="cc-run-title">Debugger</div>
                    <div className="cc-run-sub">DAP-style debug session with launch/attach routing, breakpoint controls, stack/scopes/vars, and REPL.</div>
                    <div className="cc-run-sub mono">
                      {debugSessionId
                        ? `Session ${debugSessionId} · ${(debugStatus || "unknown").toUpperCase()}${debugExitCode != null ? ` · exit ${debugExitCode}` : debugExitSignal ? ` · ${debugExitSignal}` : ""}`
                        : "Session none"}
                    </div>
                    {debugAdapterLabel ? (
                      <div className="cc-run-sub mono">
                        {debugAdapterLabel}{debugAdapterType ? ` · ${debugAdapterType}` : ""}{debugLaunchRequest ? ` · ${debugLaunchRequest.toUpperCase()}` : ""}
                        {debugLaunchTargetName ? ` · ${debugLaunchTargetName}` : ""}
                        {debugLaunchCompoundName ? ` · compound:${debugLaunchCompoundName}` : ""}
                        {debugLaunchProfileId ? ` · profile:${debugLaunchProfileId}` : ""}
                        {debugWorkspaceVariantId ? ` · variant:${debugWorkspaceVariantId}` : ""}
                      </div>
                    ) : null}
                    {debugPostTaskLabel ? (
                      <div className="cc-run-sub mono">
                        {`postDebugTask ${debugPostTaskLabel} · ${debugPostTaskRan ? "ran" : "pending"}`}
                      </div>
                    ) : null}
                    {debugEntryPath ? <div className="cc-run-sub mono">{fromServerOutputToCodebaseText(debugEntryPath)}</div> : null}
                    {debugCurrentLocation.file && debugCurrentLocation.line ? (
                      <button
                        className="cc-debug-inlineLink mono"
                        onClick={() => focusDebugLocation(debugCurrentLocation.file, debugCurrentLocation.line, debugCurrentLocation.column)}
                      >
                        {fromServerOutputToCodebaseText(`${normalizePath(debugCurrentLocation.file)}:${debugCurrentLocation.line}`)}
                      </button>
                    ) : null}
                    <div className="cc-run-actions cc-run-actions-compact">
                      <button
                        className="cc-run-btn"
                        onClick={() => setRunDebugExpanded((prev) => !prev)}
                      >
                        {runDebugExpanded ? "Hide Debug Details" : "Show Debug Details"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => {
                          setPanelOpen(true);
                          setPanelTab("debug");
                        }}
                      >
                        Debug Console
                      </button>
                    </div>

                    {runDebugExpanded ? (
                    <>
                    <div className="cc-debug-watchRow">
                      <select
                        className="cc-set-input cc-set-inputWide"
                        value={debugActiveSessionId || debugSessionId}
                        onChange={(event) => selectDebugSessionFromPanel(event.target.value)}
                        disabled={Boolean(debugActionBusy) || !debugSessionsList.length}
                      >
                        {(debugSessionsList.length ? debugSessionsList : (debugSessionId ? [{
                          sessionId: debugSessionId,
                          status: debugStatus || "starting",
                          entryPath: debugEntryPath,
                        }] : [])).map((session) => (
                          <option key={`dbg-session-${session.sessionId}`} value={session.sessionId}>
                            {`${session.sessionId} · ${(session.status || "unknown").toUpperCase()} · ${fromServerOutputToCodebaseText(session.entryPath || "")}`}
                          </option>
                        ))}
                        {!debugSessionsList.length && !debugSessionId ? <option value="">No sessions</option> : null}
                      </select>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => {
                          if (debugActionBusy) return;
                          setDebugActionBusy("status-all");
                          setPanelOpen(true);
                          setPanelTab("terminal");
                          void runCmd("cav debug status --all").finally(() => setDebugActionBusy(""));
                        }}
                        disabled={Boolean(debugActionBusy)}
                      >
                        {debugActionBusy === "status-all" ? "Refreshing..." : "Sessions"}
                      </button>
                    </div>
                    <div className="cc-debug-watchRow">
                      <select
                        className="cc-set-input cc-set-inputWide"
                        value={debugLaunchSelector}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDebugLaunchSelector(next);
                          if (next.startsWith("compound:")) {
                            setDebugLaunchSelectorType("compound");
                          } else {
                            setDebugLaunchSelectorType("target");
                          }
                        }}
                        disabled={Boolean(debugActionBusy)}
                      >
                        {debugLaunchManifest?.compounds.map((compound) => (
                          <option key={`dbg-compound-${compound.id}`} value={`compound:${compound.id}`}>
                            {`Compound · ${compound.name}`}
                          </option>
                        )) || null}
                        {debugLaunchManifest?.targets.map((target) => (
                          <option key={`dbg-target-${target.id}`} value={`target:${target.id}`}>
                            {`${target.request.toUpperCase()} · ${target.name}`}
                          </option>
                        )) || null}
                        {!debugLaunchManifest?.targets?.length && !debugLaunchManifest?.compounds?.length ? (
                          <option value="">No launch targets</option>
                        ) : null}
                      </select>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={refreshDebugLaunchManifestFromPanel}
                        disabled={Boolean(debugActionBusy)}
                      >
                        {debugActionBusy === "launch-refresh" ? "Refreshing..." : "Launch Configs"}
                      </button>
                    </div>
                    <div className="cc-debug-watchRow">
                      <select
                        className="cc-set-input cc-set-inputWide"
                        value={debugLaunchProfileOverride}
                        onChange={(event) => setDebugLaunchProfileOverride(event.target.value)}
                        disabled={Boolean(debugActionBusy)}
                      >
                        <option value="">Profile: default</option>
                        {(debugLaunchManifest?.profiles || []).map((profile) => (
                          <option key={`dbg-profile-${profile.id}`} value={profile.name}>
                            {`Profile · ${profile.name}`}
                          </option>
                        ))}
                      </select>
                      <select
                        className="cc-set-input cc-set-inputWide"
                        value={debugLaunchVariantOverride}
                        onChange={(event) => setDebugLaunchVariantOverride(event.target.value)}
                        disabled={Boolean(debugActionBusy)}
                      >
                        <option value="">Variant: default</option>
                        {(debugLaunchManifest?.workspaceVariants || []).map((variant) => (
                          <option key={`dbg-variant-${variant.id}`} value={variant.name}>
                            {`Variant · ${variant.name}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={startDebugSessionFromPanel}
                        disabled={Boolean(debugActionBusy) || !activeDebugCavPath || !activeDebugCavPath.startsWith("/cavcode/")}
                      >
                        {debugActionBusy === "start" ? "Starting..." : "Start (Active File)"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => {
                          if (debugActionBusy) return;
                          setDebugActionBusy("start-launch");
                          void runCmd("cav debug start").finally(() => setDebugActionBusy(""));
                        }}
                        disabled={Boolean(debugActionBusy)}
                      >
                        {debugActionBusy === "start-launch" ? "Starting..." : "Start (launch.json)"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => startDebugFromLaunchSelection("start")}
                        disabled={Boolean(debugActionBusy) || !debugLaunchSelector}
                      >
                        {debugActionBusy === "launch-start" ? "Starting..." : "Start Selected"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => startDebugFromLaunchSelection("attach")}
                        disabled={Boolean(debugActionBusy) || !debugLaunchSelector}
                      >
                        {debugActionBusy === "launch-attach" ? "Attaching..." : "Attach Selected"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => sendDebugControl("continue")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !canDebugContinue}
                      >
                        {debugActionBusy === "continue" ? "Running..." : "Continue"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => sendDebugControl("pause")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !canDebugPause}
                      >
                        {debugActionBusy === "pause" ? "Pausing..." : "Pause"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => sendDebugControl("next")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !canDebugStep}
                      >
                        {debugActionBusy === "next" ? "Stepping..." : "Step Over"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => sendDebugControl("step")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !canDebugStep}
                      >
                        {debugActionBusy === "step" ? "Stepping..." : "Step In"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => sendDebugControl("out")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !canDebugStep}
                      >
                        {debugActionBusy === "out" ? "Stepping..." : "Step Out"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={addDebugBreakpointAtCursor}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !activeDebugCavPath || !activeDebugCavPath.startsWith("/cavcode/")}
                      >
                        {debugActionBusy === "break-set" ? "Setting..." : `Breakpoint @ ${activeCursorLine}`}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={clearDebugBreakpointAtCursor}
                        disabled={
                          Boolean(debugActionBusy)
                          || !debugSessionId
                          || !activeDebugCavPath
                          || !activeDebugCavPath.startsWith("/cavcode/")
                          || !cursorBreakpointExists
                        }
                      >
                        {debugActionBusy === "break-clear" ? "Clearing..." : `Clear Breakpoint @ ${activeCursorLine}`}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => sendDebugControl("status")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      >
                        {debugActionBusy === "status" ? "Refreshing..." : "Refresh Debug Status"}
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => sendDebugControl("stop")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      >
                        {debugActionBusy === "stop" ? "Stopping..." : "Stop Debugger"}
                      </button>
                    </div>

                    <div className="cc-run-actions">
                      <button
                        className="cc-run-btn"
                        onClick={() => setDebugExceptionMode("none")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      >
                        Exceptions: None
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => setDebugExceptionMode("uncaught")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      >
                        Exceptions: Uncaught
                      </button>
                      <button
                        className="cc-run-btn cc-run-btn2"
                        onClick={() => setDebugExceptionMode("all")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      >
                        Exceptions: All ({debugExceptionFilters.all ? "ON" : debugExceptionFilters.uncaught ? "UNCAUGHT" : "OFF"})
                      </button>
                    </div>

                    <div className="cc-debug-watchRow">
                      <input
                        className="cc-set-input cc-set-inputWide"
                        value={debugWatchInput}
                        onChange={(event) => setDebugWatchInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          addDebugWatchFromPanel();
                        }}
                        placeholder="Watch expression (e.g. user.id)"
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      />
                      <button
                        className="cc-run-btn"
                        onClick={addDebugWatchFromPanel}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !String(debugWatchInput || "").trim()}
                      >
                        {debugActionBusy === "watch-add" ? "Adding..." : "Add Watch"}
                      </button>
                    </div>

                    <div className="cc-debug-watchRow">
                      <input
                        className="cc-set-input cc-set-inputWide"
                        value={debugEvalInput}
                        onChange={(event) => setDebugEvalInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          runDebugEvaluateFromPanel("evaluate");
                        }}
                        placeholder="Evaluate expression (e.g. user.profile.name)"
                        disabled={Boolean(debugActionBusy) || !debugSessionId}
                      />
                      <button
                        className="cc-run-btn"
                        onClick={() => runDebugEvaluateFromPanel("evaluate")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !String(debugEvalInput || "").trim()}
                      >
                        {debugActionBusy === "evaluate" ? "Evaluating..." : "Evaluate"}
                      </button>
                      <button
                        className="cc-run-btn"
                        onClick={() => runDebugEvaluateFromPanel("repl")}
                        disabled={Boolean(debugActionBusy) || !debugSessionId || !String(debugEvalInput || "").trim()}
                      >
                        {debugActionBusy === "repl" ? "Running..." : "REPL"}
                      </button>
                    </div>
                    {debugEvalOutput ? (
                      <div className="cc-run-sub mono">
                        {debugEvalOutput.expression} = {debugEvalOutput.value}
                        {debugEvalOutput.valueType ? ` (${debugEvalOutput.valueType})` : ""}
                        {debugEvalOutput.variablesReference ? ` · ref ${debugEvalOutput.variablesReference}` : ""}
                      </div>
                    ) : null}

                    <div className="cc-debug-grid">
                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Call Stack</div>
                        <div className="cc-debug-list">
                          {debugStackByThread.length ? (
                            debugStackByThread.map((group) => (
                              <div key={`thread-stack-${group.threadId}`}>
                                <div className="cc-set-note mono">
                                  Thread {group.threadId}
                                </div>
                                {group.frames.slice(0, 24).map((frame) => {
                                  const framePath = frame.file ? fromServerOutputToCodebaseText(normalizePath(frame.file)) : "unknown";
                                  return (
                                    <button
                                      key={`stack-${group.threadId}-${frame.id}-${frame.name}-${frame.line || 0}`}
                                      className={`cc-debug-item mono ${debugSelectedFrameOrdinal === frame.id ? "is-on" : ""}`}
                                      onClick={() => selectDebugFrameFromPanel(frame.id, frame)}
                                      disabled={!debugSessionId}
                                    >
                                      {frame.name} {frame.line ? `${framePath}:${frame.line}` : framePath}
                                    </button>
                                  );
                                })}
                              </div>
                            ))
                          ) : (
                            <div className="cc-set-note">No frames yet.</div>
                          )}
                        </div>
                      </div>

                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Watches</div>
                        <div className="cc-debug-list">
                          {debugWatches.length ? (
                            debugWatches.slice(0, 24).map((watch) => (
                              <div key={`watch-${watch.expression}`} className="cc-debug-itemRow">
                                <div className="cc-debug-item mono">
                                  {watch.expression} = {watch.value ?? "null"}
                                </div>
                                <button
                                  className="cc-debug-remove"
                                  onClick={() => removeDebugWatchFromPanel(watch.expression)}
                                  disabled={Boolean(debugActionBusy) || !debugSessionId}
                                  title="Remove watch"
                                >
                                  ×
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="cc-set-note">No watch expressions.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="cc-debug-grid">
                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Threads</div>
                        <div className="cc-debug-list">
                          {debugThreads.length ? (
                            debugThreads.map((thread) => (
                              <button
                                key={`thread-${thread.id}`}
                                className={`cc-debug-item mono ${debugSelectedThreadId === thread.id ? "is-on" : ""}`}
                                onClick={() => selectDebugThreadFromPanel(thread.id)}
                                disabled={Boolean(debugActionBusy) || !debugSessionId}
                              >
                                {thread.name} · {thread.stopped ? "stopped" : "running"}{thread.reason ? ` · ${thread.reason}` : ""}
                              </button>
                            ))
                          ) : (
                            <div className="cc-set-note">No thread data.</div>
                          )}
                        </div>
                      </div>

                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Scopes</div>
                        <div className="cc-debug-list">
                          {debugScopes.length ? (
                            debugScopes.map((scope) => (
                              <div key={`scope-${scope.name}-${scope.variablesReference}`} className="cc-debug-itemRow">
                                <button
                                  className="cc-debug-item mono"
                                  onClick={() => inspectDebugScopeVariables(scope.variablesReference)}
                                  disabled={Boolean(debugActionBusy) || !debugSessionId || scope.variablesReference <= 0}
                                >
                                  {scope.name} · ref {scope.variablesReference}
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="cc-set-note">No scopes for selected frame.</div>
                          )}
                        </div>
                      </div>

                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Variables</div>
                        <div className="cc-debug-list">
                          {debugVariables.length ? (
                            debugVariables.slice(0, 120).map((variable) => (
                              <button
                                key={`var-${variable.evaluateName || variable.name}`}
                                className="cc-debug-item mono"
                                onClick={() => {
                                  if (variable.variablesReference > 0) {
                                    inspectDebugScopeVariables(variable.variablesReference);
                                  }
                                }}
                                disabled={Boolean(debugActionBusy) || !debugSessionId || variable.variablesReference <= 0}
                              >
                                {variable.name} = {variable.value}{variable.type ? ` (${variable.type})` : ""}
                              </button>
                            ))
                          ) : (
                            <div className="cc-set-note">Inspect a scope to view variables.</div>
                          )}
                        </div>
                        {debugVarsCursor.variablesReference > 0 ? (
                          <div className="cc-run-sub mono">
                            ref {debugVarsCursor.variablesReference} · start {debugVarsCursor.start} · count {debugVarsCursor.count}
                          </div>
                        ) : null}
                      </div>

                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Debug Console</div>
                        <div className="cc-debug-list">
                          {debugConsoleEntries.length ? (
                            debugConsoleEntries.slice(-120).map((entry) => (
                              <div key={`console-${entry.seq}`} className="cc-debug-item mono">
                                [{entry.category}] {entry.text}
                              </div>
                            ))
                          ) : (
                            <div className="cc-set-note">No console events yet.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="cc-debug-grid">
                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Loaded Scripts</div>
                        <div className="cc-debug-list">
                          {debugLoadedScripts.length ? (
                            debugLoadedScripts.slice(0, 120).map((script) => (
                              <button
                                key={`loaded-script-${script.scriptId}`}
                                className="cc-debug-item mono"
                                onClick={() => {
                                  if (script.cavcodePath) {
                                    focusDebugLocation(script.cavcodePath, 1, 1);
                                  }
                                }}
                                disabled={!script.cavcodePath}
                              >
                                {fromServerOutputToCodebaseText(script.cavcodePath || script.url)}
                                {script.isModule ? " · module" : ""}
                              </button>
                            ))
                          ) : (
                            <div className="cc-set-note">No loaded scripts yet.</div>
                          )}
                        </div>
                      </div>
                      <div className="cc-debug-col">
                        <div className="cc-set-subtitle">Loaded Modules</div>
                        <div className="cc-debug-list">
                          {debugLoadedModules.length ? (
                            debugLoadedModules.slice(0, 120).map((module) => (
                              <div key={`loaded-module-${module.module}`} className="cc-debug-item mono">
                                {module.module} · {module.scriptCount}
                              </div>
                            ))
                          ) : (
                            <div className="cc-set-note">No module groups yet.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="cc-set-subtitle">Breakpoints</div>
                    <div className="cc-debug-list">
                      {debugBreakpoints.length ? (
                        debugBreakpoints.slice(0, 40).map((bp) => (
                          <div key={bp.id} className="cc-debug-itemRow">
                            <button
                              className="cc-debug-item mono"
                              onClick={() => focusDebugLocation(bp.file, bp.line, 1)}
                            >
                              {bp.enabled ? "●" : "○"} {fromServerOutputToCodebaseText(`${normalizePath(bp.file)}:${bp.line}`)}
                              {bp.kind === "logpoint" ? " · logpoint" : ""}
                              {bp.setId ? ` · set:${bp.setId}` : ""}
                              {bp.condition ? ` · if ${bp.condition}` : ""}
                              {bp.hitCondition ? ` · hit ${bp.hitCondition}` : ""}
                            </button>
                            <button
                              className="cc-debug-remove"
                              onClick={() => {
                                if (!debugSessionId || debugActionBusy) return;
                                setDebugActionBusy(bp.enabled ? "break-disable" : "break-enable");
                                const target = quoteForCavArg(bp.id);
                                const action = bp.enabled ? "disable" : "enable";
                                void runCmd(`cav debug break ${action} ${target} ${debugSessionId}`).finally(() => {
                                  setDebugActionBusy("");
                                });
                              }}
                              disabled={Boolean(debugActionBusy) || !debugSessionId}
                              title={bp.enabled ? "Disable breakpoint" : "Enable breakpoint"}
                            >
                              {bp.enabled ? "⏸" : "▶"}
                            </button>
                            <button
                              className="cc-debug-remove"
                              onClick={() => {
                                if (!debugSessionId || debugActionBusy) return;
                                setDebugActionBusy("break-clear");
                                const target = quoteForCavArg(`${normalizePath(bp.file)}:${bp.line}`);
                                void runCmd(`cav debug break clear ${target} ${debugSessionId}`).finally(() => {
                                  setDebugActionBusy("");
                                });
                              }}
                              disabled={Boolean(debugActionBusy) || !debugSessionId}
                              title="Remove breakpoint"
                            >
                              ×
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="cc-set-note">No breakpoints set.</div>
                      )}
                    </div>

                    <div className="cc-set-subtitle">Function Breakpoints</div>
                    <div className="cc-debug-list">
                      {debugFunctionBreakpoints.length ? (
                        debugFunctionBreakpoints.slice(0, 40).map((bp) => (
                          <div key={bp.id} className="cc-debug-itemRow">
                            <div className="cc-debug-item mono">
                              {bp.enabled ? "●" : "○"} {bp.functionName || bp.id}
                              {bp.setId ? ` · set:${bp.setId}` : ""}
                              {bp.condition ? ` · if ${bp.condition}` : ""}
                              {bp.hitCondition ? ` · hit ${bp.hitCondition}` : ""}
                            </div>
                            <button
                              className="cc-debug-remove"
                              onClick={() => {
                                if (!debugSessionId || debugActionBusy) return;
                                setDebugActionBusy("break-fn-remove");
                                const target = quoteForCavArg(bp.functionName || bp.id);
                                void runCmd(`cav debug break function remove ${target} ${debugSessionId}`).finally(() => {
                                  setDebugActionBusy("");
                                });
                              }}
                              disabled={Boolean(debugActionBusy) || !debugSessionId}
                              title="Remove function breakpoint"
                            >
                              ×
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="cc-set-note">No function breakpoints.</div>
                      )}
                    </div>

                    <div className="cc-set-subtitle">Data Breakpoints</div>
                    <div className="cc-debug-list">
                      {debugDataBreakpoints.length ? (
                        debugDataBreakpoints.slice(0, 40).map((bp) => (
                          <div key={bp.id} className="cc-debug-item mono">
                            {bp.enabled ? "●" : "○"} {bp.accessType} · ref {bp.variablesReference}
                            {bp.expression ? ` · ${bp.expression}` : ""}
                            {bp.message ? ` · ${bp.message}` : ""}
                          </div>
                        ))
                      ) : (
                        <div className="cc-set-note">
                          {debugCapabilities?.supportsDataBreakpoints ? "No data breakpoints." : "Adapter does not expose data breakpoints."}
                        </div>
                      )}
                    </div>
                    </>
                    ) : null}
                  </div>

                  <div className="cc-run-card">
                    <div className="cc-run-title">Save</div>
                    <div className="cc-run-sub">Cmd/Ctrl+S saves to CavBot. If a folder is connected, we also write-through to disk.</div>
                    <div className="cc-run-actions">
                      <button className="cc-run-btn cc-run-btn2" onClick={() => void saveNow()}>
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : panelTab === "debug" ? (
                <div className="cc-panel-debug" role="region" aria-label="Debug Console">
                  <div className="cc-term-out mono">
                    {debugConsoleEntries.length ? (
                      debugConsoleEntries.slice(-280).map((entry) => (
                        <div key={`debug-console-${entry.seq}`} className="cc-term-line">
                          [{entry.category}] {entry.text}
                        </div>
                      ))
                    ) : (
                      <div className="cc-panel-empty">No debug console events yet.</div>
                    )}
                  </div>
                </div>
	              ) : panelTab === "git" ? (
	                <div className="cc-panel-git" role="region" aria-label="Git Panel">
		                  <section className="cc-git-section cc-git-changesSection">
	                      <div className="cc-git-sectionHead cc-git-changesHead">
	                        <div className="cc-git-changesIntro">
	                          <div className="cc-git-sectionTitle">Changes</div>
	                          <div className="cc-git-sectionSub">Staged and unstaged partitions with fast status and diff operations.</div>
	                        </div>
	                        <div className="cc-git-toolbar cc-git-changesToolbar">
                          <button className="cc-git-btn" onClick={refreshScmStatusFromPanel} disabled={Boolean(scmActionBusy)}>
                            {scmActionBusy === "status" ? "Refreshing..." : "Status"}
                          </button>
                          <button className="cc-git-btn" onClick={() => runScmCommandFromPanel("cav git diff", "diff")} disabled={Boolean(scmActionBusy)}>
                            Diff
                          </button>
                          <button className="cc-git-btn" onClick={() => runScmCommandFromPanel("cav git stage .", "stage-all")} disabled={Boolean(scmActionBusy)}>
                            Stage All
                          </button>
                          <button className="cc-git-btn" onClick={() => runScmCommandFromPanel("cav git unstage .", "unstage-all")} disabled={Boolean(scmActionBusy)}>
                            Unstage All
                          </button>
                        </div>
                      </div>
                      {scmAuthRequired ? (
                        <div className="cc-set-note is-error mono">
                          {`Auth required: ${scmAuthRequired.command} · ${scmAuthRequired.message}`}
                        </div>
                      ) : null}
                      <div className="cc-git-changesGrid">
                        <div className="cc-git-changesCol">
                          <div className="cc-git-colHead">Staged</div>
                          <div className="cc-git-fileList">
                            {scmStagedFiles.length ? (
                              scmStagedFiles.map((file) => (
                                <div key={`scm-staged-${file.path}`} className="cc-git-fileRow">
                                  <span className="cc-git-filePath mono">{fromServerOutputToCodebaseText(file.path)}</span>
                                  <button
                                    className="cc-git-miniBtn"
                                    onClick={() => runScmCommandFromPanel(`cav git unstage ${quoteForCavArg(file.path)}`, "unstage-file")}
                                    disabled={Boolean(scmActionBusy)}
                                  >
                                    Unstage
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="cc-set-note">No staged files.</div>
                            )}
                          </div>
                        </div>
                        <div className="cc-git-changesCol">
                          <div className="cc-git-colHead">Unstaged</div>
                          <div className="cc-git-fileList">
                            {scmUnstagedFiles.length ? (
                              scmUnstagedFiles.map((file) => (
                                <div key={`scm-unstaged-${file.path}`} className="cc-git-fileRow">
                                  <span className="cc-git-filePath mono">{fromServerOutputToCodebaseText(file.path)}</span>
                                  <button
                                    className="cc-git-miniBtn"
                                    onClick={() => runScmCommandFromPanel(`cav git stage ${quoteForCavArg(file.path)}`, "stage-file")}
                                    disabled={Boolean(scmActionBusy)}
                                  >
                                    Stage
                                  </button>
                                </div>
                              ))
                            ) : (
                              <div className="cc-set-note">No unstaged files.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="cc-git-section">
                      <div className="cc-git-sectionHead">
                        <div className="cc-git-sectionTitle">Commit</div>
                      </div>
                      <div className="cc-git-row">
                        <input
                          className="cc-git-input cc-git-input-grow"
                          placeholder="Commit message"
                          value={scmCommitMessage}
                          onChange={(event) => setScmCommitMessage(event.target.value)}
                          disabled={Boolean(scmActionBusy)}
                        />
                        <button
                          className="cc-git-btn"
                          onClick={() => runScmCommandFromPanel(`cav git commit ${quoteForCavArg(String(scmCommitMessage || "").trim())}`, "commit")}
                          disabled={Boolean(scmActionBusy) || !String(scmCommitMessage || "").trim()}
                        >
                          {scmActionBusy === "commit" ? "Committing..." : "Commit"}
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => runScmCommandFromPanel("cav git commit --amend", "commit-amend")}
                          disabled={Boolean(scmActionBusy)}
                        >
                          {scmActionBusy === "commit-amend" ? "Amending..." : "Amend"}
                        </button>
                      </div>
                    </section>

                    <section className="cc-git-section">
                      <div className="cc-git-sectionHead">
                        <div>
                          <div className="cc-git-sectionTitle">Git AI</div>
                          <div className="cc-git-sectionSub">AI-assisted Git workflows for planning, commit drafting, and verify/repair loops.</div>
                        </div>
                      </div>
                      <div className="cc-git-toolbar">
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setActivity("ai");
                            setPanelOpen(false);
                            pushToast("Caven is open with workspace context.", "good");
                          }}
                        >
                          Open Caven
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav loop run \"review git diff and produce a staged patch plan\" --cycles 1");
                          }}
                        >
                          AI Stage Plan
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav loop run \"draft commit message from current git diff\" --cycles 1");
                          }}
                        >
                          AI Commit Draft
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav loop run \"verify git changes with diagnostics and tests\" --cycles 2 --rollback");
                          }}
                        >
                          AI Verify Loop
                        </button>
                      </div>
                    </section>

                    <section className="cc-git-section">
                      <div className="cc-git-sectionHead">
                        <div className="cc-git-sectionTitle">Branch & Sync</div>
                      </div>
                      <div className="cc-git-row">
                        <input
                          className="cc-git-input"
                          placeholder="remote"
                          value={scmRemoteNameInput}
                          onChange={(event) => setScmRemoteNameInput(event.target.value)}
                          disabled={Boolean(scmActionBusy)}
                        />
                        <input
                          className="cc-git-input"
                          placeholder="branch"
                          value={scmRemoteBranchInput}
                          onChange={(event) => setScmRemoteBranchInput(event.target.value)}
                          disabled={Boolean(scmActionBusy)}
                        />
                        <button className="cc-git-btn" onClick={() => runScmCommandFromPanel(buildScmRemoteCommand("fetch"), "fetch")} disabled={Boolean(scmActionBusy)}>
                          Fetch
                        </button>
                        <button className="cc-git-btn" onClick={() => runScmCommandFromPanel(buildScmRemoteCommand("pull"), "pull")} disabled={Boolean(scmActionBusy)}>
                          Pull
                        </button>
                        <button className="cc-git-btn" onClick={() => runScmCommandFromPanel(buildScmRemoteCommand("push"), "push")} disabled={Boolean(scmActionBusy)}>
                          Push
                        </button>
                        <button className="cc-git-btn" onClick={() => runScmCommandFromPanel("cav git sync", "sync")} disabled={Boolean(scmActionBusy)}>
                          Sync
                        </button>
                      </div>
                    </section>

                    <section className="cc-git-section cc-git-advanced" aria-label="Advanced Git controls">
                      <button
                        type="button"
                        className="cc-git-advancedSummary"
                        aria-expanded={gitAdvancedOpen}
                        aria-controls="cc-git-advanced-body"
                        onClick={() => setGitAdvancedOpen((prev) => !prev)}
                      >
                        <span className={`cc-git-advancedChevron${gitAdvancedOpen ? " is-open" : ""}`} aria-hidden="true">
                          <Image src="/icons/chevron-right-svgrepo-com.svg" alt="" width={12} height={12} />
                        </span>
                        <span>Advanced</span>
                      </button>
                      {gitAdvancedOpen ? (
                        <div id="cc-git-advanced-body" className="cc-git-advancedBody">
                          <div className="cc-git-advancedGroup">
                            <div className="cc-git-advancedGroupHead">
                              <div className="cc-git-advancedGroupTitle">Branch Operations</div>
                            </div>
                            <div className="cc-git-advancedFieldRow">
                              <input
                                className="cc-git-input cc-git-advancedInput"
                                placeholder="branch"
                                value={scmBranchNameInput}
                                onChange={(event) => setScmBranchNameInput(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                              <button
                                className="cc-git-btn cc-git-advancedPrimaryAction"
                                onClick={() => runScmCommandFromPanel(`cav git checkout ${quoteForCavArg(scmBranchNameInput)}`, "checkout")}
                                disabled={Boolean(scmActionBusy) || !String(scmBranchNameInput || "").trim()}
                              >
                                Checkout
                              </button>
                            </div>
                            <div className="cc-git-advancedActionRow">
                              <button className="cc-git-btn" title="List branches" onClick={() => runScmCommandFromPanel("cav git branch list", "branches")} disabled={Boolean(scmActionBusy)}>
                                List
                              </button>
                              <button className="cc-git-btn" title="Rebase continue" onClick={() => runScmCommandFromPanel("cav git rebase --continue", "rebase-continue")} disabled={Boolean(scmActionBusy)}>
                                Rebase
                              </button>
                              <button className="cc-git-btn" title="Cherry-pick continue" onClick={() => runScmCommandFromPanel("cav git cherry-pick --continue", "cherry-continue")} disabled={Boolean(scmActionBusy)}>
                                Cherry
                              </button>
                            </div>
                          </div>

                          <div className="cc-git-advancedGroup">
                            <div className="cc-git-advancedGroupHead">
                              <div className="cc-git-advancedGroupTitle">Remote Management</div>
                            </div>
                            <div className="cc-git-advancedFieldRow">
                              <input
                                className="cc-git-input cc-git-advancedInput cc-git-advancedInputCompact"
                                placeholder="remote"
                                value={scmRemoteNameInput}
                                onChange={(event) => setScmRemoteNameInput(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                              <input
                                className="cc-git-input cc-git-advancedInput cc-git-advancedInputWide"
                                placeholder="remote url"
                                value={scmRemoteUrlInput}
                                onChange={(event) => setScmRemoteUrlInput(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                              <button
                                className="cc-git-btn cc-git-advancedPrimaryAction"
                                title="Add remote"
                                onClick={() => runScmCommandFromPanel(`cav git remote add ${quoteForCavArg(scmRemoteNameInput || "origin")} ${quoteForCavArg(scmRemoteUrlInput)}`, "remote-add")}
                                disabled={Boolean(scmActionBusy) || !String(scmRemoteUrlInput || "").trim()}
                              >
                                Add
                              </button>
                            </div>
                            <div className="cc-git-advancedActionRow">
                              <button className="cc-git-btn" title="List remotes" onClick={() => runScmCommandFromPanel("cav git remote list", "remote-list")} disabled={Boolean(scmActionBusy)}>
                                List
                              </button>
                            </div>
                          </div>

                          <div className="cc-git-advancedGroup">
                            <div className="cc-git-advancedGroupHead">
                              <div className="cc-git-advancedGroupTitle">Range Staging</div>
                            </div>
                            <div className="cc-git-advancedFieldRow">
                              <input
                                className="cc-git-input cc-git-advancedInput cc-git-advancedInputWide"
                                placeholder="/cavcode/path/to/file.ts"
                                value={scmPartialPath}
                                onChange={(event) => setScmPartialPath(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                              <input
                                className="cc-git-input cc-git-input-num"
                                type="number"
                                min={1}
                                placeholder="start"
                                value={scmPartialStartLine}
                                onChange={(event) => setScmPartialStartLine(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                              <input
                                className="cc-git-input cc-git-input-num"
                                type="number"
                                min={1}
                                placeholder="end"
                                value={scmPartialEndLine}
                                onChange={(event) => setScmPartialEndLine(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                            </div>
                            <div className="cc-git-advancedActionRow">
                              <button className="cc-git-btn" title="Stage selected line range" onClick={() => runScmPartialStage("stage")} disabled={Boolean(scmActionBusy)}>
                                Stage
                              </button>
                              <button className="cc-git-btn" title="Unstage selected line range" onClick={() => runScmPartialStage("unstage")} disabled={Boolean(scmActionBusy)}>
                                Unstage
                              </button>
                            </div>
                          </div>

                          <div className="cc-git-advancedGroup">
                            <div className="cc-git-advancedGroupHead">
                              <div className="cc-git-advancedGroupTitle">Conflict Resolution</div>
                            </div>
                            <div className="cc-git-advancedFieldRow">
                              <input
                                className="cc-git-input cc-git-advancedInput cc-git-advancedInputWide"
                                placeholder="conflict file path"
                                value={scmConflictPathInput}
                                onChange={(event) => setScmConflictPathInput(event.target.value)}
                                disabled={Boolean(scmActionBusy)}
                              />
                            </div>
                            <div className="cc-git-advancedActionRow">
                              <button className="cc-git-btn" title="Resolve with ours" onClick={() => resolveScmConflictFromPanel("ours")} disabled={Boolean(scmActionBusy)}>
                                Ours
                              </button>
                              <button className="cc-git-btn" title="Resolve with theirs" onClick={() => resolveScmConflictFromPanel("theirs")} disabled={Boolean(scmActionBusy)}>
                                Theirs
                              </button>
                              <button className="cc-git-btn" title="Resolve with both" onClick={() => resolveScmConflictFromPanel("both")} disabled={Boolean(scmActionBusy)}>
                                Both
                              </button>
                              <button className="cc-git-btn" title="List conflict paths" onClick={() => runScmCommandFromPanel("cav git conflicts list", "conflicts")} disabled={Boolean(scmActionBusy)}>
                                List
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <section className="cc-git-section">
                      <div className="cc-git-sectionHead">
                        <div>
                          <div className="cc-git-sectionTitle">Indexer</div>
                          <div className="cc-git-sectionSub">AST symbols, references, and dependency graph refresh.</div>
                        </div>
                      </div>
                      <div className="cc-git-toolbar">
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav index refresh");
                          }}
                        >
                          Refresh
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav index symbols");
                          }}
                        >
                          Symbols
                        </button>
                        <button
                          className="cc-git-btn"
                          onClick={() => {
                            setPanelOpen(true);
                            setPanelTab("terminal");
                            void runCmd("cav events");
                          }}
                        >
                          Events
                        </button>
                      </div>
                    </section>
	                </div>
	              ) : panelTab === "ports" ? (
                <div className="cc-panel-ports" role="region" aria-label="Ports">
                  {detectedPortEntries.length ? (
                    detectedPortEntries.map((entry) => (
                      <div key={entry.id} className="cc-port-row">
                        <div className="cc-port-label mono">{entry.label}</div>
                        <button
                          className="cc-port-open"
                          onClick={() => {
                            if (typeof window === "undefined") return;
                            window.open(entry.url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          Open
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="cc-panel-empty">
                      No ports detected yet. Run <span className="mono">cav run dev</span> or <span className="mono">cav remote port list</span>.
                    </div>
                  )}
                </div>
              ) : (
                <div className="cc-problems" role="region" aria-label="Problems">
                {problems.length ? (
                    problems.slice(0, 280).map((p, i) => (
                      <button
                        key={`${p.file}-${p.line}-${p.col}-${i}`}
                        className={`cc-prob tone-${p.severity === "error" ? "bad" : p.severity === "warn" ? "watch" : "good"}`}
                        onClick={() => {
                          const node = findNodeByPath(fs, p.file);
                          if (node && isFile(node)) openFile(node);

                          window.setTimeout(() => {
                            const ed = editorRef.current;
                            if (!ed) return;
                            try {
                              ed.revealPositionInCenter({ lineNumber: p.line, column: p.col });
                              ed.setPosition({ lineNumber: p.line, column: p.col });
                              ed.focus();
                            } catch {}
                          }, 0);
                        }}
                      >
                        <div className="cc-prob-top">
                          <span className="cc-prob-sev mono">{p.severity.toUpperCase()}</span>
                          <span className="cc-prob-loc mono">{p.line}:{p.col}</span>
                        </div>
                        <div className="cc-prob-file mono">{p.file}</div>
                        <div className="cc-prob-meta mono">
                          <span>{p.source || "monaco"}</span>
                          {p.code ? <span>{p.code}</span> : <span>no-code</span>}
                          <span>{p.fixReady ? "cavai-fix-ready" : "manual-fix"}</span>
                        </div>
                        <div className="cc-prob-msg">{p.message}</div>
                      </button>
                    ))
                  ) : (
                    <div className="cc-prob-empty">
                      <div className="cc-editor-empty-title">All clear.</div>
                      <div className="cc-editor-empty-sub">Editor markers and workspace lint diagnostics show up here.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* Status Bar */}
          <footer className="cc-status" aria-label="Status Bar">
            <div className="cc-status-left">
              <button className="cc-sbtn" onClick={() => setSidebarOpen((p) => !p)} title="Toggle Sidebar (Cmd/Ctrl+B)">
                {sidebarOpen ? "SIDEBAR" : "SIDEBAR OFF"}
              </button>
              <span className="cc-sbadge cc-sbadge-static" aria-label="Cursor position">
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              <span className="cc-status-sep" aria-hidden="true">•</span>
              <span className="cc-status-path mono">{activeFile?.path || "—"}</span>
            </div>

            <div className="cc-status-right mono">
              <button
                className={`cc-sbadge ${errCount ? "is-bad" : ""}`}
                onClick={() => {
                  setPanelOpen(true);
                  setPanelTab("problems");
                  const ed = editorRef.current;
                  if (!ed) return;
                  ed.getAction?.("editor.action.marker.next")?.run?.();
                  ed.focus?.();
                }}
                title="Open Problems"
              >
                {errCount} ERR
              </button>
              <button
                className={`cc-sbadge ${warnCount ? "is-watch" : ""}`}
                onClick={() => {
                  setPanelOpen(true);
                  setPanelTab("problems");
                  const ed = editorRef.current;
                  if (!ed) return;
                  ed.getAction?.("editor.action.marker.next")?.run?.();
                  ed.focus?.();
                }}
                title="Open Problems"
              >
                {warnCount} WARN
              </button>

              <span className="cc-status-sep" aria-hidden="true">•</span>
              <span className="cc-slang">{String(activeFile?.lang || "—").toUpperCase()}</span>

              <span className="cc-status-sep" aria-hidden="true">•</span>
              <button className="cc-sbtn" onClick={() => setPanelOpen((p) => !p)} title="Toggle Panel (Cmd/Ctrl+J)">
                PANEL
              </button>

              <span className="cc-status-sep" aria-hidden="true">•</span>
              <button className="cc-sbtn" onClick={() => void saveNow()} title="Save (Cmd/Ctrl+S)">
                SAVE
              </button>

              <span className="cc-status-sep" aria-hidden="true">•</span>
              <button className="cc-sbtn" onClick={() => openMonacoFind("find")} title="Find (Cmd/Ctrl+F)">
                FIND
              </button>

              <span className="cc-status-sep" aria-hidden="true">•</span>
              <button
                className="cc-sbadge is-live"
                onClick={openLiveWithActiveFile}
                title="Go Live"
                aria-label="Go Live"
              >
                <span className="cc-live-ic cc-live-ic-mask" aria-hidden="true" />
                Go Live
              </button>
            </div>
          </footer>

          {cloudConnectOpen ? (
            <div className="cc-modal cc-cloudConnect-modal">
              <div className="cc-modal-card cc-cloudConnect-card" role="dialog" aria-modal="true">
                <div className="cc-modal-title">Import from CavCloud</div>
                <div className="cc-modal-body">
                  <label className="cc-modal-field cc-cloudConnect-field">
                    <span>Select a folder</span>
                    <select
                      className="cc-modal-input cc-cloudConnect-input"
                      value={cloudSelectedPath}
                      onChange={(e) => setCloudSelectedPath(e.currentTarget.value)}
                    >
                      {cloudFoldersLoading && !cloudFolders.length ? <option value="/">Loading folders...</option> : null}
                      {cloudFolders.map((f) => (
                        <option key={f.path} value={f.path}>{f.path}</option>
                      ))}
                    </select>
                  </label>
                  <div className="cc-modal-sub">
                    {activeProjectRoot
                      ? `This will replace ${activeProjectRoot.name} after confirmation.`
                      : "This will import the selected CavCloud folder into your workspace."}
                  </div>
                  {cloudFoldersLoading ? (
                    <div className="cc-modal-sub cc-cloudConnect-loading">Refreshing CavCloud folders...</div>
                  ) : null}
                </div>
                <div className="cc-modal-actions cc-cloudConnect-actions">
                  <button className="cc-modal-btn cc-cloudConnect-cancel" onClick={() => setCloudConnectOpen(false)}>Cancel</button>
                  <button
                    className="cc-modal-btn cc-cloudConnect-connect"
                    onClick={() => {
                      void importFromCavCloud(cloudSelectedPath);
                      setCloudConnectOpen(false);
                    }}
                  >
                    Connect
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Toast */}
          {toast ? (
            <div className="cc-toast" role="status" aria-live="polite" data-tone={toast.tone}>
              {toast.msg}
            </div>
          ) : null}

        </section>
      </div>
    </div>
  );
}
