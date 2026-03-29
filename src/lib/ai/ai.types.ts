import { z } from "zod";

export const AI_SURFACES = ["cavcode", "cavcloud", "cavsafe", "cavpad", "console"] as const;
export type AiSurface = (typeof AI_SURFACES)[number];

export const AI_CENTER_SURFACE_SCHEMA = z.enum([
  "general",
  "workspace",
  "console",
  "cavcloud",
  "cavsafe",
  "cavpad",
  "cavcode",
]);
export type AiCenterSurface = z.infer<typeof AI_CENTER_SURFACE_SCHEMA>;

export const AI_RISK_LEVEL_SCHEMA = z.enum(["low", "medium", "high"]);
export type AiRiskLevel = z.infer<typeof AI_RISK_LEVEL_SCHEMA>;

export const CAVAI_REASONING_LEVEL_SCHEMA = z.enum(["low", "medium", "high", "extra_high"]);
export type CavAiReasoningLevel = z.infer<typeof CAVAI_REASONING_LEVEL_SCHEMA>;

export const CAVCODE_IMAGE_ATTACHMENT_SCHEMA = z.object({
  id: z.string().trim().max(120),
  assetId: z.string().trim().max(120).optional(),
  name: z.string().trim().max(280),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.number().int().min(1).max(20_000_000),
  dataUrl: z.string().max(1_500_000).optional(),
});
export type CavCodeImageAttachmentInput = z.infer<typeof CAVCODE_IMAGE_ATTACHMENT_SCHEMA>;

export const CAVCODE_ASSIST_ACTION_SCHEMA = z.enum([
  "explain_error",
  "suggest_fix",
  "improve_seo",
  "write_note",
  "refactor_safely",
  "generate_component",
  "generate_section",
  "generate_page",
  "explain_code",
  "summarize_file",
  "page_404_builder_agent",
  "api_schema_contract_guard",
  "competitor_research",
  "accessibility_audit",
  "ui_mockup_generator",
  "website_visual_builder",
  "app_screenshot_enhancer",
  "brand_asset_generator",
  "ui_debug_visualizer",
  "email_text_agent",
  "content_creator",
  "legal_privacy_terms_ethics_agent",
  "pdf_create_edit_preview_agent",
  "doc_edit_review_agent",
  "web_research",
  "summarize_issues",
  "organize_storage",
  "audit_access_context",
  "summarize_thread",
]);
export type CavCodeAssistAction = z.infer<typeof CAVCODE_ASSIST_ACTION_SCHEMA>;
const CUSTOM_AGENT_ID_SCHEMA = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/);
const CUSTOM_AGENT_ACTION_KEY_SCHEMA = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_]{1,63}$/);

export const CAVCODE_DIAGNOSTIC_SCHEMA = z.object({
  code: z.string().trim().max(120).optional(),
  source: z.string().trim().max(80).optional(),
  message: z.string().trim().min(1).max(1_200),
  severity: z.enum(["error", "warn", "info"]).default("error"),
  line: z.number().int().min(1).max(1_000_000).optional(),
  col: z.number().int().min(1).max(1_000_000).optional(),
});
export type CavCodeDiagnosticInput = z.infer<typeof CAVCODE_DIAGNOSTIC_SCHEMA>;

export const CAVCODE_ASSIST_REQUEST_SCHEMA = z.object({
  action: CAVCODE_ASSIST_ACTION_SCHEMA,
  agentId: CUSTOM_AGENT_ID_SCHEMA.optional(),
  agentActionKey: CUSTOM_AGENT_ACTION_KEY_SCHEMA.optional(),
  filePath: z.string().trim().min(1).max(2_000),
  language: z.string().trim().max(80).optional(),
  selectedCode: z.string().max(40_000).optional(),
  diagnostics: z.array(CAVCODE_DIAGNOSTIC_SCHEMA).max(200).default([]),
  goal: z.string().trim().max(2_000).optional(),
  prompt: z.string().trim().max(8_000).optional(),
  model: z.string().trim().max(120).optional(),
  reasoningLevel: CAVAI_REASONING_LEVEL_SCHEMA.optional(),
  queueEnabled: z.boolean().optional(),
  imageAttachments: z.array(CAVCODE_IMAGE_ATTACHMENT_SCHEMA).max(10).optional(),
  sessionId: z.string().trim().max(120).optional(),
  queueMessageId: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type CavCodeAssistRequest = z.infer<typeof CAVCODE_ASSIST_REQUEST_SCHEMA>;

export const CAVCODE_ASSIST_RESPONSE_SCHEMA = z.object({
  summary: z.string().trim().min(1).max(6_000),
  risk: AI_RISK_LEVEL_SCHEMA,
  changes: z.array(z.string().trim().min(1).max(800)).max(64),
  proposedCode: z.string().max(200_000),
  generatedImages: z.array(
    z.object({
      url: z.string().trim().url().max(2_000).optional(),
      b64Json: z.string().trim().max(2_500_000).optional(),
      revisedPrompt: z.string().trim().max(4_000).optional(),
    })
  ).max(12).optional(),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(64),
  followUpChecks: z.array(z.string().trim().min(1).max(1_000)).max(64),
  targetFilePath: z.string().trim().max(2_000).optional(),
});
export type CavCodeAssistResponse = z.infer<typeof CAVCODE_ASSIST_RESPONSE_SCHEMA>;

export const CAVCLOUD_ASSIST_ACTION_SCHEMA = z.enum([
  "summarize_folder",
  "explain_artifact",
  "propose_publish_copy",
  "recommend_organization",
]);
export type CavCloudAssistAction = z.infer<typeof CAVCLOUD_ASSIST_ACTION_SCHEMA>;

export const CAVSAFE_ASSIST_ACTION_SCHEMA = z.enum([
  "summarize_secured_item",
  "explain_access_state",
  "generate_private_note",
]);
export type CavSafeAssistAction = z.infer<typeof CAVSAFE_ASSIST_ACTION_SCHEMA>;

export const CAVPAD_ASSIST_ACTION_SCHEMA = z.enum([
  "write_structured_note",
  "technical_summary",
  "change_recap",
]);
export type CavPadAssistAction = z.infer<typeof CAVPAD_ASSIST_ACTION_SCHEMA>;

export const CONSOLE_ASSIST_ACTION_SCHEMA = z.enum([
  "explain_telemetry_anomaly",
  "summarize_posture",
  "recommend_next_step",
  "explain_issue_cluster",
]);
export type ConsoleAssistAction = z.infer<typeof CONSOLE_ASSIST_ACTION_SCHEMA>;

const SHARED_SURFACE_ASSIST_REQUEST_SCHEMA = z.object({
  goal: z.string().trim().min(1).max(4_000),
  prompt: z.string().trim().max(8_000).optional(),
  sessionId: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  origin: z.string().trim().max(2_000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const CAVCLOUD_ASSIST_REQUEST_SCHEMA = SHARED_SURFACE_ASSIST_REQUEST_SCHEMA.extend({
  action: CAVCLOUD_ASSIST_ACTION_SCHEMA,
});
export type CavCloudAssistRequest = z.infer<typeof CAVCLOUD_ASSIST_REQUEST_SCHEMA>;

export const CAVSAFE_ASSIST_REQUEST_SCHEMA = SHARED_SURFACE_ASSIST_REQUEST_SCHEMA.extend({
  action: CAVSAFE_ASSIST_ACTION_SCHEMA,
});
export type CavSafeAssistRequest = z.infer<typeof CAVSAFE_ASSIST_REQUEST_SCHEMA>;

export const CAVPAD_ASSIST_REQUEST_SCHEMA = SHARED_SURFACE_ASSIST_REQUEST_SCHEMA.extend({
  action: CAVPAD_ASSIST_ACTION_SCHEMA,
});
export type CavPadAssistRequest = z.infer<typeof CAVPAD_ASSIST_REQUEST_SCHEMA>;

export const CONSOLE_ASSIST_REQUEST_SCHEMA = SHARED_SURFACE_ASSIST_REQUEST_SCHEMA.extend({
  action: CONSOLE_ASSIST_ACTION_SCHEMA,
});
export type ConsoleAssistRequest = z.infer<typeof CONSOLE_ASSIST_REQUEST_SCHEMA>;

export const SURFACE_ASSIST_RESPONSE_SCHEMA = z.object({
  summary: z.string().trim().min(1).max(8_000),
  risk: AI_RISK_LEVEL_SCHEMA,
  recommendations: z.array(z.string().trim().min(1).max(1_200)).max(64),
  notes: z.array(z.string().trim().min(1).max(1_200)).max(64),
  followUpChecks: z.array(z.string().trim().min(1).max(1_200)).max(64),
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).max(64),
});
export type SurfaceAssistResponse = z.infer<typeof SURFACE_ASSIST_RESPONSE_SCHEMA>;

export const AI_CENTER_ASSIST_ACTION_SCHEMA = z.enum([
  "companion_chat",
  "financial_advisor",
  "therapist_support",
  "mentor",
  "best_friend",
  "relationship_advisor",
  "philosopher",
  "focus_coach",
  "life_strategist",
  "email_text_agent",
  "content_creator",
  "legal_privacy_terms_ethics_agent",
  "pdf_create_edit_preview_agent",
  "page_404_builder_agent",
  "doc_edit_review_agent",
  "image_studio",
  "image_edit",
  "live_multimodal",
  "web_research",
  "explain_spike",
  "summarize_issues",
  "prioritize_fixes",
  "write_incident_note",
  "recommend_next_steps",
  "summarize_folder",
  "explain_artifact",
  "draft_publish_copy",
  "organize_storage",
  "explain_access_restrictions",
  "summarize_secure_file",
  "review_collaboration_state",
  "audit_access_context",
  "write_note",
  "summarize_thread",
  "rewrite_clearly",
  "technical_recap",
  "bullets_to_plan",
]);
export type AiCenterAssistAction = z.infer<typeof AI_CENTER_ASSIST_ACTION_SCHEMA>;

export const AI_CENTER_ASSIST_REQUEST_SCHEMA = z.object({
  action: AI_CENTER_ASSIST_ACTION_SCHEMA,
  agentId: CUSTOM_AGENT_ID_SCHEMA.optional(),
  agentActionKey: CUSTOM_AGENT_ACTION_KEY_SCHEMA.optional(),
  surface: AI_CENTER_SURFACE_SCHEMA,
  prompt: z.string().trim().min(1).max(12_000),
  goal: z.string().trim().max(8_000).optional(),
  model: z.string().trim().max(120).optional(),
  researchMode: z.boolean().optional(),
  researchUrls: z.array(z.string().trim().url().max(2_000)).max(12).optional(),
  reasoningLevel: CAVAI_REASONING_LEVEL_SCHEMA.optional(),
  imageAttachments: z.array(CAVCODE_IMAGE_ATTACHMENT_SCHEMA).max(10).optional(),
  sessionId: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().max(120).optional(),
  projectId: z.number().int().positive().optional(),
  origin: z.string().trim().max(2_000).optional(),
  contextLabel: z.string().trim().max(220).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type AiCenterAssistRequest = z.infer<typeof AI_CENTER_ASSIST_REQUEST_SCHEMA>;

export const AI_CENTER_ASSIST_RESPONSE_SCHEMA = z.object({
  summary: z.string().trim().min(1).max(10_000),
  risk: AI_RISK_LEVEL_SCHEMA,
  answer: z.string().trim().min(1).max(24_000),
  generatedImages: z.array(
    z.object({
      url: z.string().trim().url().max(2_000).optional(),
      b64Json: z.string().trim().max(2_500_000).optional(),
      revisedPrompt: z.string().trim().max(4_000).optional(),
    })
  ).max(12).optional(),
  researchMode: z.boolean().optional(),
  keyFindings: z.array(z.string().trim().min(1).max(1_200)).max(64).optional(),
  extractedEvidence: z.array(
    z.object({
      source: z.string().trim().min(1).max(240),
      url: z.string().trim().url().max(2_000).optional(),
      note: z.string().trim().min(1).max(1_600),
    })
  ).max(80).optional(),
  sources: z.array(
    z.object({
      title: z.string().trim().min(1).max(300),
      url: z.string().trim().url().max(2_000),
      note: z.string().trim().max(400).optional(),
    })
  ).max(80).optional(),
  suggestedNextActions: z.array(z.string().trim().min(1).max(1_200)).max(64).optional(),
  researchProfile: z.object({
    model: z.string().trim().min(1).max(120),
    reasoningLevel: CAVAI_REASONING_LEVEL_SCHEMA,
    toolBundle: z.array(z.enum(["web_search", "web_extractor", "code_interpreter"])).max(3),
  }).optional(),
  recommendations: z.array(z.string().trim().min(1).max(1_200)).max(64),
  notes: z.array(z.string().trim().min(1).max(1_200)).max(64),
  followUpChecks: z.array(z.string().trim().min(1).max(1_200)).max(64),
  evidenceRefs: z.array(z.string().trim().min(1).max(240)).max(64),
});
export type AiCenterAssistResponse = z.infer<typeof AI_CENTER_ASSIST_RESPONSE_SCHEMA>;

export const AI_AUDIO_TRANSCRIPTION_RESPONSE_SCHEMA = z.object({
  text: z.string().trim().min(1).max(120_000),
  language: z.string().trim().max(24).nullable(),
  durationSeconds: z.number().finite().min(0).nullable(),
  mimeType: z.string().trim().max(120).nullable(),
  fileName: z.string().trim().max(280).nullable(),
  sizeBytes: z.number().int().min(0).max(200_000_000).nullable(),
});
export type AiAudioTranscriptionResponse = z.infer<typeof AI_AUDIO_TRANSCRIPTION_RESPONSE_SCHEMA>;

export type AiAudioTranscriptionRequest = {
  file: File;
  model?: string;
  prompt?: string;
  language?: string;
  workspaceId?: string;
  projectId?: number;
  origin?: string;
};

export const AI_TASK_TYPE_SCHEMA = z.enum([
  "general_chat",
  "writing",
  "rewrite",
  "title_improvement",
  "naming",
  "brainstorming",
  "strategy",
  "planning",
  "note_writing",
  "note_rewrite",
  "note_summary",
  "website_improvement",
  "seo",
  "keyword_research",
  "content_brief",
  "dashboard_summary",
  "dashboard_diagnostics",
  "dashboard_error_explanation",
  "cavcloud_organization",
  "cavcloud_guidance",
  "cavsafe_policy",
  "cavsafe_security_guidance",
  "summarization",
  "tutoring",
  "explanation",
  "comparison",
  "decision_support",
  "productivity",
  "code_explain",
  "code_generate",
  "code_fix",
  "code_refactor",
  "code_plan",
  "code_review",
  "patch_proposal",
  // Backward-compatibility aliases used by older rows/tests.
  "seo_help",
  "diagnostics_explanation",
  "code_explanation",
  "code_generation",
  "research",
  "workspace_guidance",
  "storage_guidance",
  "security_policy",
  "summary",
  "general_question",
]);
export type AiTaskType = z.infer<typeof AI_TASK_TYPE_SCHEMA>;

export type AiAnswerQualityScores = {
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

export type AiReasoningSummary = {
  intent: string;
  contextUsed: string[];
  checksPerformed: string[];
  answerPath: string[];
  uncertaintyNotes: string[];
  doneState: "done" | "partial";
};

export type AiExecutionMeta = {
  durationMs: number;
  durationLabel: string;
  showReasoningChip: boolean;
  reasoningLabel: string;
  taskType: AiTaskType;
  surface: string;
  action: string;
  actionClass: string;
  providerId: string;
  model: string;
  reasoningLevel: CavAiReasoningLevel;
  researchMode: boolean;
  repairAttempted: boolean;
  repairApplied: boolean;
  contextSignals: string[];
  quality: AiAnswerQualityScores;
  safeSummary: AiReasoningSummary;
};

export type AiUsageStatus = "SUCCESS" | "ERROR";

export class AiServiceError extends Error {
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

export type AiAssistResponseEnvelope<T> = {
  ok: true;
  requestId: string;
  providerId: string;
  model: string;
  sessionId?: string;
  meta?: AiExecutionMeta;
  data: T;
} | {
  ok: false;
  requestId: string;
  error: string;
  message?: string;
  status?: number;
  guardDecision?: Record<string, unknown> | null;
};
