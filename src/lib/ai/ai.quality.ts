import {
  ALIBABA_QWEN_CODER_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  resolveAiModelCanonicalId,
} from "@/src/lib/ai/model-catalog";
import type {
  AiAnswerQualityScores,
  AiReasoningSummary,
  AiTaskType,
  CavAiReasoningLevel,
} from "@/src/lib/ai/ai.types";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function tokenize(value: string): string[] {
  return s(value)
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function uniqueLowerWords(words: string[]): Set<string> {
  const set = new Set<string>();
  for (const word of words) {
    const normalized = s(word).toLowerCase();
    if (normalized) set.add(normalized);
  }
  return set;
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const item of a) {
    if (b.has(item)) hits += 1;
  }
  const denom = Math.max(1, Math.min(a.size, Math.max(8, Math.floor((a.size + b.size) / 3))));
  return hits / denom;
}

function hasAny(textLower: string, terms: readonly string[]): boolean {
  for (const term of terms) {
    if (textLower.includes(term)) return true;
  }
  return false;
}

function countAny(textLower: string, terms: readonly string[]): number {
  let hits = 0;
  for (const term of terms) {
    if (textLower.includes(term)) hits += 1;
  }
  return hits;
}

function keywordScore(textLower: string, terms: readonly string[]): number {
  if (!terms.length) return 0;
  const hits = countAny(textLower, terms);
  return Math.min(1, hits / Math.max(2, Math.min(5, terms.length)));
}

function promptRequestsConcreteCode(promptText: string): boolean {
  const text = s(promptText).toLowerCase();
  if (!text) return false;
  const hasCodeTopic = /\b(code|snippet|html|css|javascript|typescript|python|sql|script|component|function|class|api)\b/.test(text);
  const hasGenerateVerb = /\b(write|build|create|generate|implement|scaffold|make|return|provide|show)\b/.test(text);
  const asksForFullTemplate = /\b(template|boilerplate|full page|single file|all in one|all html css and js|html\/css\/js)\b/.test(text);
  return (hasCodeTopic && hasGenerateVerb) || asksForFullTemplate;
}

function answerContainsConcreteCode(answerText: string): boolean {
  const text = s(answerText);
  if (!text) return false;
  if (/```[\s\S]*```/.test(text)) return true;
  if (/<html[\s>]|<body[\s>]|<script[\s>]|<style[\s>]|<\/[a-z]+>/.test(text)) return true;
  if (/\b(function|const|let|class|import|export|return)\b[\s\S]{0,40}[=({;]/.test(text)) return true;
  return false;
}

function isLegacyCodeTaskType(taskType: AiTaskType): boolean {
  return taskType === "code_generation" || taskType === "code_explanation";
}

function isCodeTaskType(taskType: AiTaskType): boolean {
  return (
    taskType === "code_generate"
    || taskType === "code_explain"
    || taskType === "code_fix"
    || taskType === "code_refactor"
    || taskType === "code_plan"
    || taskType === "code_review"
    || taskType === "patch_proposal"
    || isLegacyCodeTaskType(taskType)
  );
}

function isWritingTaskType(taskType: AiTaskType): boolean {
  return (
    taskType === "writing"
    || taskType === "rewrite"
    || taskType === "title_improvement"
    || taskType === "naming"
    || taskType === "note_writing"
    || taskType === "note_rewrite"
    || taskType === "note_summary"
    || taskType === "summarization"
    || taskType === "summary"
  );
}

function isSeoTaskType(taskType: AiTaskType): boolean {
  return (
    taskType === "seo"
    || taskType === "keyword_research"
    || taskType === "content_brief"
    || taskType === "website_improvement"
    || taskType === "seo_help"
  );
}

function isSecurityTaskType(taskType: AiTaskType): boolean {
  return taskType === "cavsafe_policy" || taskType === "cavsafe_security_guidance" || taskType === "security_policy";
}

function isStorageTaskType(taskType: AiTaskType): boolean {
  return taskType === "cavcloud_organization" || taskType === "cavcloud_guidance" || taskType === "storage_guidance";
}

function isDashboardTaskType(taskType: AiTaskType): boolean {
  return (
    taskType === "dashboard_summary"
    || taskType === "dashboard_diagnostics"
    || taskType === "dashboard_error_explanation"
    || taskType === "diagnostics_explanation"
  );
}

function isGeneralWritingTaskType(taskType: AiTaskType): boolean {
  return (
    taskType === "general_chat"
    || taskType === "general_question"
    || taskType === "writing"
    || taskType === "rewrite"
    || taskType === "title_improvement"
    || taskType === "naming"
    || taskType === "brainstorming"
    || taskType === "strategy"
    || taskType === "planning"
    || taskType === "summarization"
    || taskType === "tutoring"
    || taskType === "explanation"
    || taskType === "comparison"
    || taskType === "decision_support"
    || taskType === "productivity"
    || taskType === "workspace_guidance"
  );
}

const TASK_KEYWORDS: Partial<Record<AiTaskType, readonly string[]>> = {
  general_chat: ["question", "answer", "explain", "helpful"],
  writing: ["draft", "write", "message", "copy", "tone"],
  rewrite: ["rewrite", "rephrase", "clarify", "edit"],
  title_improvement: ["title", "headline", "rename", "improve"],
  naming: ["name", "naming", "brand", "title"],
  brainstorming: ["ideas", "brainstorm", "options", "creative"],
  strategy: ["strategy", "approach", "priorities", "positioning"],
  planning: ["plan", "steps", "timeline", "schedule"],
  research: ["research", "sources", "evidence", "citations", "findings"],
  summarization: ["summary", "recap", "key points", "highlights"],
  tutoring: ["teach", "lesson", "practice", "understand"],
  explanation: ["explain", "why", "how", "concept"],
  comparison: ["compare", "pros", "cons", "tradeoff"],
  decision_support: ["decision", "options", "criteria", "recommend"],
  productivity: ["organize", "prioritize", "week", "tasks"],
  website_improvement: ["homepage", "copy", "conversion", "positioning", "cta"],
  seo: ["seo", "ranking", "serp", "google", "schema", "metadata"],
  keyword_research: ["keyword", "cluster", "intent", "search terms"],
  content_brief: ["content brief", "outline", "sections", "faq"],
  dashboard_summary: ["dashboard", "summary", "health", "overview"],
  dashboard_diagnostics: ["dashboard", "diagnostic", "latency", "incident", "metrics"],
  dashboard_error_explanation: ["error", "stack", "trace", "dashboard", "failure"],
  cavcloud_organization: ["cavcloud", "organize", "folder", "structure", "cleanup"],
  cavcloud_guidance: ["cavcloud", "storage", "artifact", "directory"],
  cavsafe_policy: ["cavsafe", "policy", "access", "permission", "acl"],
  cavsafe_security_guidance: ["cavsafe", "security", "private", "safe", "compliance"],
  note_writing: ["note", "memo", "meeting note", "draft"],
  note_rewrite: ["note", "rewrite", "clarify", "tone"],
  note_summary: ["note", "summary", "recap", "highlights"],
  code_explain: ["code", "explain", "walkthrough", "function", "class"],
  code_generate: ["code", "generate", "build", "component", "snippet", "template"],
  code_fix: ["fix", "debug", "error", "patch", "repair"],
  code_refactor: ["refactor", "clean up", "improve code", "simplify"],
  code_plan: ["architecture", "code plan", "approach", "design"],
  code_review: ["review", "code review", "risks", "issues"],
  patch_proposal: ["diff", "patch", "propose changes", "apply flow"],
  // legacy
  seo_help: ["seo", "keyword", "serp", "rank"],
  diagnostics_explanation: ["diagnostic", "error", "incident", "latency"],
  code_explanation: ["code", "explain", "function", "class"],
  code_generation: ["code", "generate", "component", "snippet"],
  workspace_guidance: ["workspace", "next steps", "guide", "plan"],
  storage_guidance: ["storage", "folder", "artifact", "directory"],
  security_policy: ["security", "policy", "access", "permission"],
  summary: ["summary", "recap", "highlights"],
  general_question: ["answer", "question", "help", "explain"],
};

const SURFACE_KEYWORDS: Record<string, readonly string[]> = {
  cavcode: ["code", "file", "patch", "refactor", "component", "function", "diagnostic"],
  cavcloud: ["storage", "folder", "artifact", "publish", "directory", "file"],
  cavsafe: ["security", "policy", "access", "permission", "private", "compliance"],
  cavpad: ["note", "draft", "thread", "document", "summary", "rewrite"],
  console: ["incident", "health", "telemetry", "issue", "metrics", "diagnostic"],
  workspace: ["workspace", "task", "plan", "project", "next step"],
  general: ["answer", "help", "plan"],
  center: ["answer", "help", "plan"],
};

const ALWAYS_INCLUDE_CONTEXT_KEYS = [
  "pageawareness",
  "routeawareness",
  "routecontext",
  "routepathname",
  "routesearch",
  "routepattern",
  "routecategory",
  "routeparams",
  "adapterid",
  "launchsurface",
  "contextlabel",
  "memoryscopes",
  "tools",
] as const;

const PRODUCT_MODULE_TERMS = ["cavbot", "cavai", "cavcloud", "cavsafe", "cavpad", "cavcode", "dashboard", "workspace"] as const;
const SECURITY_TERMS = ["cavsafe", "security", "policy", "permission", "access", "private", "acl"] as const;
const SEO_TERMS = ["seo", "google", "rank", "serp", "search", "metadata", "keyword", "schema", "intent"] as const;
const STORAGE_TERMS = ["storage", "folder", "artifact", "directory", "bucket", "cavcloud", "file tree"] as const;
const DIAGNOSTIC_TERMS = ["diagnostic", "error", "warn", "failure", "incident", "latency", "anomaly", "trace"] as const;
const CODE_TERMS = ["code", "function", "class", "component", "file", "diff", "patch", "lint", "test", "typescript", "javascript", "python", "html", "css"] as const;
const WRITING_TERMS = ["note", "draft", "summary", "rewrite", "paragraph", "bullet", "message", "headline", "title"] as const;
const MARKETING_TERMS = [
  "upgrade",
  "pricing",
  "subscription",
  "billing",
  "sale",
  "discount",
  "pricing plan",
  "plan tier",
  "tier plan",
] as const;

const KNOWN_MODULES = new Set<string>([
  "cavai",
  "cavbot",
  "cavcode",
  "cavcloud",
  "cavsafe",
  "cavpad",
  "cavtools",
  "cavguard",
  "cavtower",
  "cavcontrol",
  "cavelite",
]);

function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[trimmed]";
  if (value == null) return null;
  if (typeof value === "string") return value.length > 360 ? `${value.slice(0, 360)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeContext(item, depth + 1));
  }
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const entries = Object.entries(input).slice(0, 16);
    const out: Record<string, unknown> = {};
    for (const [key, row] of entries) {
      out[key] = sanitizeContext(row, depth + 1);
    }
    return out;
  }
  return String(value);
}

function extractPromptSignals(text: string): string[] {
  const signals: string[] = [];
  const normalized = s(text);
  if (!normalized) return signals;
  if (/https?:\/\//i.test(normalized)) signals.push("contains_url");
  if (/([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)/.test(normalized)) signals.push("contains_path_hint");
  if (/\b(error|exception|stack trace|failed|failure)\b/i.test(normalized)) signals.push("mentions_errors");
  if (/\b(seo|google|ranking|serp|keyword)\b/i.test(normalized)) signals.push("mentions_seo");
  if (/\b(research|source|citation)\b/i.test(normalized)) signals.push("mentions_research");
  if (/\b(note|draft|rewrite|summary|headline|title)\b/i.test(normalized)) signals.push("mentions_writing");
  if (/\b(cavcloud|cavsafe|cavpad|cavcode|dashboard|workspace)\b/i.test(normalized)) signals.push("mentions_product_context");
  return signals;
}

function promptMentionsProductContext(prompt: string, goal: string): boolean {
  const text = `${s(prompt)} ${s(goal)}`.toLowerCase();
  return hasAny(text, PRODUCT_MODULE_TERMS);
}

function shouldUseProductContext(args: {
  surface: string;
  taskType: AiTaskType;
  prompt: string;
  goal?: string | null;
}): boolean {
  const surface = s(args.surface).toLowerCase();
  const promptGoal = `${s(args.prompt)} ${s(args.goal)}`;
  if (surface === "cavcloud" || surface === "cavsafe" || surface === "cavpad" || surface === "cavcode" || surface === "console") {
    return true;
  }
  if (
    isStorageTaskType(args.taskType)
    || isSecurityTaskType(args.taskType)
    || isDashboardTaskType(args.taskType)
    || isCodeTaskType(args.taskType)
  ) {
    return true;
  }
  return promptMentionsProductContext(promptGoal, "");
}

function contextKeyPatterns(surface: string, taskType: AiTaskType): readonly string[] {
  const normalizedSurface = s(surface).toLowerCase();
  if (normalizedSurface === "cavcode" || isCodeTaskType(taskType)) {
    return [
      "activefile",
      "filepath",
      "projectroot",
      "selectedcode",
      "diagnostic",
      "language",
      "repo",
      "folder",
      "mounted",
      "tree",
      "filegraph",
      "patch",
      "diff",
      "route",
      "page",
      "adapter",
    ];
  }
  if (normalizedSurface === "console" || isDashboardTaskType(taskType)) {
    return [
      "issue",
      "incident",
      "metric",
      "health",
      "diagnostic",
      "error",
      "warning",
      "status",
      "telemetry",
      "route",
      "performance",
      "page",
      "adapter",
    ];
  }
  if (normalizedSurface === "cavcloud" || isStorageTaskType(taskType)) {
    return ["folder", "artifact", "storage", "publish", "path", "file", "directory", "mount", "retention", "route", "page", "site"];
  }
  if (normalizedSurface === "cavsafe" || isSecurityTaskType(taskType)) {
    return ["access", "policy", "permission", "security", "private", "share", "acl", "compliance", "route", "page"];
  }
  if (normalizedSurface === "cavpad" || taskType === "note_writing" || taskType === "note_rewrite" || taskType === "note_summary") {
    return ["note", "thread", "document", "draft", "title", "editor", "summary", "outline", "tone", "route", "page"];
  }
  return ["preference", "memory", "style", "history", "goal", "profile", "route", "page", "workspace", "project", "site", "adapter"];
}

function normalizeTaskFromAction(action: string): AiTaskType | null {
  const normalized = s(action).toLowerCase();
  if (!normalized) return null;
  if (normalized === "financial_advisor") return "decision_support";
  if (
    normalized === "therapist_support"
    || normalized === "mentor"
    || normalized === "best_friend"
    || normalized === "relationship_advisor"
    || normalized === "philosopher"
    || normalized === "focus_coach"
    || normalized === "life_strategist"
    || normalized === "companion_chat"
  ) {
    return "general_chat";
  }
  if (normalized === "email_text_agent") return "writing";
  if (normalized === "content_creator") return "writing";
  if (normalized === "legal_privacy_terms_ethics_agent") return "writing";
  if (normalized === "pdf_create_edit_preview_agent") return "writing";
  if (normalized === "page_404_builder_agent") return "website_improvement";
  if (normalized === "doc_edit_review_agent") return "rewrite";
  if (normalized.includes("accessibility") || normalized.includes("a11y")) return "code_review";
  if (normalized.includes("research")) return "research";
  if (normalized.includes("rewrite")) return "rewrite";
  if (normalized.includes("summary") || normalized.includes("summarize")) return "summarization";
  if (normalized.includes("issue") || normalized.includes("anomaly") || normalized.includes("spike")) return "dashboard_diagnostics";
  if (normalized.includes("storage") || normalized.includes("folder") || normalized.includes("artifact")) return "cavcloud_guidance";
  if (normalized.includes("access") || normalized.includes("secure")) return "cavsafe_security_guidance";
  if (normalized.includes("write_note")) return "note_writing";
  if (normalized.includes("technical_recap")) return null;
  return null;
}

export function classifyAiTaskType(args: {
  surface: string;
  action: string;
  prompt: string;
  goal?: string | null;
}): AiTaskType {
  const surface = s(args.surface).toLowerCase();
  const action = s(args.action).toLowerCase();
  const promptGoal = `${s(args.prompt)} ${s(args.goal)}`.toLowerCase();
  const text = `${promptGoal} ${action}`;

  const actionTask = normalizeTaskFromAction(action);
  const explicitNoteIntent = /\b(write|draft|compose|create|turn)\b.{0,48}\b(note|notes|memo|minutes|meeting notes|release notes)\b/.test(promptGoal)
    || /\bnote to\b/.test(promptGoal)
    || /\binto notes\b/.test(promptGoal)
    || /\bturn this into a note\b/.test(promptGoal)
    || /\bturn this into notes\b/.test(promptGoal);
  const hasCodeSignals = /\b(code|snippet|html|css|javascript|typescript|python|sql|script|function|class|component|api|regex|query|refactor|compile|lint)\b/.test(promptGoal);
  const hasCodeFixIntent = /\b(fix|debug|repair|patch|resolve|unblock|broken|failing|error|exception|compile|lint|test failure)\b/.test(promptGoal)
    || /\b(suggest_fix|refactor_safely)\b/.test(action);
  const hasCodeRefactorIntent = /\b(refactor|clean up|improve structure|reduce duplication)\b/.test(promptGoal);
  const hasCodePlanIntent = /\b(code plan|architecture|design approach|implementation plan)\b/.test(promptGoal);
  const hasCodeReviewIntent = /\b(code review|review this code|risks in this code|review diff)\b/.test(promptGoal);
  const hasPatchIntent = /\b(diff|patch|unified diff|apply patch|propose patch)\b/.test(promptGoal);
  const hasCodeGenerationIntent = promptRequestsConcreteCode(promptGoal)
    || /\b(generate|build|create|write|implement|scaffold|make)\b.{0,18}\b(component|page|endpoint|function|class|html|css|js|script)\b/.test(promptGoal);
  const hasCodeExplainIntent = /\b(explain|walk ?through|how does|what does|why does)\b/.test(promptGoal);
  const hasA11yIntent = /\b(accessibility|a11y|wcag|aria|screen reader|keyboard nav|color contrast|focus ring|alt text)\b/.test(promptGoal);

  if (surface === "cavcode") {
    if (
      action.includes("competitor_research")
      || /\b(competitor|competition|rival|market analysis|feature gap|benchmark|pricing)\b/.test(promptGoal)
    ) {
      return "research";
    }
    if (action.includes("accessibility_audit") || hasA11yIntent) {
      return hasCodeFixIntent ? "code_fix" : "code_review";
    }
    if (hasPatchIntent || action.includes("patch")) return "patch_proposal";
    if (hasCodeReviewIntent || action.includes("review")) return "code_review";
    if (hasCodePlanIntent || action.includes("plan")) return "code_plan";
    if (hasCodeRefactorIntent || action.includes("refactor")) return "code_refactor";
    if (hasCodeFixIntent || action.includes("fix")) return "code_fix";
    if (hasCodeGenerationIntent || action.includes("generate")) return "code_generate";
    return "code_explain";
  }

  if (/\b(research|sources?|citation|evidence|compare market|market research)\b/.test(text)) return "research";

  if (hasCodeSignals) {
    if (hasPatchIntent) return "patch_proposal";
    if (hasCodeReviewIntent) return "code_review";
    if (hasCodePlanIntent) return "code_plan";
    if (hasCodeRefactorIntent) return "code_refactor";
    if (hasCodeFixIntent) return "code_fix";
    if (hasCodeGenerationIntent) return "code_generate";
    if (hasCodeExplainIntent || action.includes("technical_recap")) return "code_explain";
  }

  if (/\b(keyword|keywords|keyword research|keyword cluster|search terms)\b/.test(text)) return "keyword_research";
  if (/\b(content brief|brief for content|faq ideas|outline for page)\b/.test(text)) return "content_brief";
  if (/\b(seo|google|serp|ranking|rank #?1|rank number|schema|meta description)\b/.test(text)) return "seo";
  if (/\b(homepage|landing page copy|conversion|positioning|website copy|site copy)\b/.test(text)) return "website_improvement";

  if (/\b(dashboard)\b/.test(text)) {
    if (/\b(error|errors|exception|stack trace|failed)\b/.test(text)) return "dashboard_error_explanation";
    if (/\b(diagnostic|latency|incident|anomaly|performance|route)\b/.test(text)) return "dashboard_diagnostics";
    if (/\b(summary|summarize|overview|health)\b/.test(text)) return "dashboard_summary";
  }

  if (surface === "console" && /\b(error|latency|incident|diagnostic|anomaly|issue|spike)\b/.test(text)) {
    return "dashboard_diagnostics";
  }

  if (surface === "cavcloud" || /\b(cavcloud|storage|artifact|folder|directory|organize files)\b/.test(text)) {
    if (/\b(organize|cleanup|restructure|group|taxonomy)\b/.test(text)) return "cavcloud_organization";
    return "cavcloud_guidance";
  }

  if (surface === "cavsafe" || /\b(cavsafe|security|permission|policy|private access|acl|compliance)\b/.test(text)) {
    if (/\b(policy|compliance|rule)\b/.test(text)) return "cavsafe_policy";
    return "cavsafe_security_guidance";
  }

  if (explicitNoteIntent || (surface === "cavpad" && /\b(note|document|thread|draft)\b/.test(promptGoal)) || action.includes("write_note")) {
    if (/\b(rewrite|rephrase|clarify)\b/.test(promptGoal)) return "note_rewrite";
    if (/\b(summary|summarize|recap|highlights)\b/.test(promptGoal)) return "note_summary";
    return "note_writing";
  }

  if (/\b(rewrite|rephrase|clarify|simplify wording)\b/.test(text)) return "rewrite";
  if (/\b(title|headline)\b.{0,22}\b(improve|better|rename|rewrite|change)\b/.test(text)) return "title_improvement";
  if (/\b(name|naming|brand name|project name)\b/.test(text)) return "naming";
  if (/\b(brainstorm|ideas?|concepts?)\b/.test(text)) return "brainstorming";
  if (/\b(strategy|positioning|go-to-market|gtm)\b/.test(text)) return "strategy";
  if (/\b(plan my|plan for|week plan|timeline|roadmap|milestones)\b/.test(text)) return "planning";
  if (/\b(summary|summarize|recap|tl;dr)\b/.test(text)) return "summarization";
  if (/\b(tutor|teach me|lesson|learn)\b/.test(text)) return "tutoring";
  if (/\b(compare|comparison|pros and cons|versus|vs)\b/.test(text)) return "comparison";
  if (/\b(decide|decision|choose between|which should i)\b/.test(text)) return "decision_support";
  if (/\b(productivity|organize my week|prioritize tasks|todo)\b/.test(text)) return "productivity";
  if (/\b(workspace|how do i|what should i do|next step|guide)\b/.test(text)) return "planning";
  if (/\b(explain|what is|how does|why does)\b/.test(text)) return "explanation";

  if (actionTask) return actionTask;
  if (/\b(write|draft|compose|caption|message|email|speech)\b/.test(text)) return "writing";

  return "general_chat";
}

export type AiSurfaceContextPack = {
  scope: string;
  context: Record<string, unknown>;
  signalsUsed: string[];
  promptSignals: string[];
};

export function buildSurfaceContextPack(args: {
  surface: string;
  taskType: AiTaskType;
  prompt: string;
  goal?: string | null;
  context?: Record<string, unknown> | null;
  injectedContext?: Record<string, unknown> | null;
}): AiSurfaceContextPack {
  const merged: Record<string, unknown> = {
    ...(args.context && typeof args.context === "object" ? args.context : {}),
    ...(args.injectedContext && typeof args.injectedContext === "object" ? args.injectedContext : {}),
  };
  const promptSignals = extractPromptSignals(`${s(args.prompt)} ${s(args.goal)}`);
  const allowProductContext = shouldUseProductContext({
    surface: args.surface,
    taskType: args.taskType,
    prompt: args.prompt,
    goal: args.goal,
  });
  const patterns = contextKeyPatterns(args.surface, args.taskType).map((item) => item.toLowerCase());

  const picked: Record<string, unknown> = {};
  const signalsUsed: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    const normalized = s(key).toLowerCase();
    if (!normalized) continue;
    const alwaysInclude = ALWAYS_INCLUDE_CONTEXT_KEYS.some((pattern) => normalized.includes(pattern));

    if (!allowProductContext) {
      const isProfileOrMemory =
        normalized.includes("memory")
        || normalized.includes("preference")
        || normalized.includes("profile")
        || normalized.includes("style")
        || normalized.includes("goal")
        || normalized.includes("history")
        || alwaysInclude;
      if (!isProfileOrMemory) continue;
    }

    const include = alwaysInclude || patterns.some((pattern) => normalized.includes(pattern));
    if (!include) continue;
    picked[key] = sanitizeContext(value);
    signalsUsed.push(key);
    if (signalsUsed.length >= 12) break;
  }

  // Keep a minimal context footprint for general-first prompts.
  if (!signalsUsed.length && allowProductContext) {
    for (const [key, value] of Object.entries(merged).slice(0, 6)) {
      picked[key] = sanitizeContext(value);
      signalsUsed.push(key);
    }
  }

  return {
    scope: `${s(args.surface).toLowerCase()}:${args.taskType}`,
    context: picked,
    signalsUsed,
    promptSignals,
  };
}

export type AiAnswerQualityResult = AiAnswerQualityScores & {
  hardFail: boolean;
};

export function evaluateAiAnswerQuality(args: {
  prompt: string;
  goal?: string | null;
  answer: string;
  surface: string;
  taskType: AiTaskType;
  contextSignals?: string[];
}): AiAnswerQualityResult {
  const promptText = `${s(args.prompt)} ${s(args.goal)}`.trim();
  const answerText = s(args.answer);
  const surface = s(args.surface).toLowerCase();
  const answerLower = answerText.toLowerCase();
  const reasons: string[] = [];
  let hardFail = false;

  const promptTokens = uniqueLowerWords(tokenize(promptText));
  const answerTokens = uniqueLowerWords(tokenize(answerText));
  const tokenOverlap = overlapRatio(promptTokens, answerTokens);
  let relevanceToRequest = clampScore(tokenOverlap * 100 + (promptTokens.size < 8 ? 24 : 8));

  const taskKeywords = TASK_KEYWORDS[args.taskType] || TASK_KEYWORDS.general_chat || [];
  const surfaceKeywords = SURFACE_KEYWORDS[surface] || SURFACE_KEYWORDS.center;
  const taskKeywordHit = keywordScore(answerLower, taskKeywords);
  const surfaceKeywordHit = keywordScore(answerLower, surfaceKeywords);
  relevanceToRequest = clampScore((relevanceToRequest * 0.64) + (taskKeywordHit * 36));
  let relevanceToSurface = clampScore((surfaceKeywordHit * 100) * 0.72 + (taskKeywordHit * 100) * 0.28);
  if (args.contextSignals?.length) {
    relevanceToSurface = clampScore(relevanceToSurface + Math.min(8, args.contextSignals.length));
  }

  let actionability = 46;
  if (/(^|\n)\s*(?:[-*]|\d+[.)])\s+\S+/m.test(answerText)) actionability += 28;
  if (/\b(should|next|step|do this|implement|verify|check|run|create|update|fix|draft)\b/i.test(answerText)) actionability += 18;
  if (answerText.length >= 180) actionability += 12;
  actionability = clampScore(actionability);

  let coherence = answerText.length < 24 ? 28 : 74;
  const lines = answerText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const repeated = new Set<string>();
    for (const row of lines) {
      const key = row.toLowerCase();
      if (repeated.has(key)) coherence -= 8;
      else repeated.add(key);
    }
  }
  if (/lorem ipsum|placeholder/i.test(answerText)) coherence -= 18;
  coherence = clampScore(coherence);

  let productTruth = 88;
  const moduleMatches = Array.from(
    new Set((answerLower.match(/\bcav[a-z0-9_-]+\b/g) || []).map((item) => item.toLowerCase()))
  );
  const unknownModules = moduleMatches.filter((item) => !KNOWN_MODULES.has(item));
  if (unknownModules.length) {
    productTruth -= Math.min(48, unknownModules.length * 14);
    reasons.push(`Unknown module references: ${unknownModules.join(", ")}`);
  }
  if (/hallucinat|made up|guessing/i.test(answerLower)) {
    productTruth -= 20;
    reasons.push("Response signals uncertainty without bounded scope.");
  }
  productTruth = clampScore(productTruth);

  let scopeAlignment = clampScore((relevanceToRequest + relevanceToSurface) / 2);

  const hasSeo = hasAny(answerLower, SEO_TERMS);
  const hasSecurity = hasAny(answerLower, SECURITY_TERMS);
  const hasStorage = hasAny(answerLower, STORAGE_TERMS);
  const hasDiagnostic = hasAny(answerLower, DIAGNOSTIC_TERMS);
  const hasCode = hasAny(answerLower, CODE_TERMS);
  const hasWriting = hasAny(answerLower, WRITING_TERMS);
  const hasMarketing = hasAny(answerLower, MARKETING_TERMS);
  const promptNeedsCode = promptRequestsConcreteCode(promptText);
  const answerHasCode = answerContainsConcreteCode(answerText);
  const promptWantsProduct = promptMentionsProductContext(promptText, "");
  const answerMentionsProduct = hasAny(answerLower, PRODUCT_MODULE_TERMS);

  if (isSeoTaskType(args.taskType) && hasSecurity && !hasSeo) {
    hardFail = true;
    scopeAlignment -= 38;
    reasons.push("SEO request drifted into security domain.");
  }
  if (isDashboardTaskType(args.taskType) && hasStorage && !hasDiagnostic) {
    hardFail = true;
    scopeAlignment -= 34;
    reasons.push("Dashboard diagnostics request drifted into storage domain.");
  }
  if (isCodeTaskType(args.taskType) && !hasCode) {
    scopeAlignment -= 30;
    reasons.push("Code task lacks code-scoped response terms.");
  }
  if (isCodeTaskType(args.taskType) && hasMarketing) {
    hardFail = true;
    scopeAlignment -= 30;
    reasons.push("Code task contains marketing/billing language.");
  }
  if (
    (args.taskType === "code_generate" || args.taskType === "code_generation")
    && promptNeedsCode
    && !answerHasCode
  ) {
    hardFail = true;
    scopeAlignment -= 34;
    reasons.push("Code generation request is missing concrete code in the answer.");
  }
  if (isWritingTaskType(args.taskType) && !hasWriting) {
    scopeAlignment -= 20;
    reasons.push("Writing task lacks writing/rewrite framing.");
  }
  if (isSecurityTaskType(args.taskType) && !hasSecurity) {
    scopeAlignment -= 24;
    reasons.push("Security task lacks access/policy framing.");
  }
  if (isStorageTaskType(args.taskType) && !hasStorage) {
    scopeAlignment -= 24;
    reasons.push("Storage task lacks folder/artifact context.");
  }
  if (args.taskType === "research" && !/\b(source|evidence|citation|findings?|compare)\b/i.test(answerText)) {
    scopeAlignment -= 22;
    reasons.push("Research task lacks evidence framing.");
  }
  if (isGeneralWritingTaskType(args.taskType) && answerMentionsProduct && !promptWantsProduct) {
    hardFail = true;
    scopeAlignment -= 32;
    reasons.push("General request drifted into unrelated product module context.");
  }
  if ((args.taskType === "title_improvement" || args.taskType === "naming") && answerText.length > 4_000) {
    scopeAlignment -= 18;
    reasons.push("Title/naming request returned overly broad output.");
  }

  scopeAlignment = clampScore(scopeAlignment);
  const hallucinationRisk = clampScore((productTruth * 0.65) + (scopeAlignment * 0.35));
  const overall = clampScore(
    (relevanceToRequest * 0.22)
    + (relevanceToSurface * 0.16)
    + (productTruth * 0.18)
    + (actionability * 0.14)
    + (coherence * 0.14)
    + (scopeAlignment * 0.16)
  );

  if (relevanceToRequest < 46) reasons.push("Low relevance to the user request.");
  if (relevanceToSurface < 42) reasons.push("Low relevance to the current product surface.");
  if (overall < 62) reasons.push("Overall quality score below release threshold.");

  const passed = !hardFail
    && overall >= 62
    && relevanceToRequest >= 46
    && scopeAlignment >= 44
    && productTruth >= 45
    && coherence >= 40;

  return {
    relevanceToRequest,
    relevanceToSurface,
    productTruth,
    actionability,
    coherence,
    scopeAlignment,
    hallucinationRisk,
    overall,
    passed,
    reasons,
    hardFail,
  };
}

export function buildSemanticRepairDirective(args: {
  taskType: AiTaskType;
  surface: string;
  reasons: string[];
}): string {
  const reasonLine = args.reasons.length
    ? args.reasons.slice(0, 4).join("; ")
    : "Previous response missed user intent.";
  return [
    "Semantic repair pass required.",
    `Task type: ${args.taskType}.`,
    `Surface: ${s(args.surface).toLowerCase()}.`,
    `Failed checks: ${reasonLine}`,
    "Rewrite the answer to directly address the user request and current surface context.",
    "Use high-signal professional wording: precise, specific, and helpful.",
    "Do not introduce unrelated modules, policy drift, or marketing language.",
    "Do not invent metrics, outcomes, customer data, or citations.",
    ...((args.taskType === "code_generation" || args.taskType === "code_generate")
      ? ["If the user asked for code, include concrete runnable code in the answer field using fenced code blocks."]
      : []),
    "Keep scope accurate and actionable.",
    "Return only JSON matching the same schema.",
  ].join("\n");
}

export function formatReasoningDuration(ms: number): string {
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

export function shouldShowReasoningChip(args: {
  model: string;
  reasoningLevel: CavAiReasoningLevel;
  taskType: AiTaskType;
  durationMs: number;
  researchMode: boolean;
}): boolean {
  const model = resolveAiModelCanonicalId(args.model);
  const durationMs = Math.max(0, Math.trunc(Number(args.durationMs) || 0));
  if (durationMs < 900) return false;
  if (args.researchMode) return true;

  if (model === ALIBABA_QWEN_MAX_MODEL_ID || model === ALIBABA_QWEN_CODER_MODEL_ID || model === DEEPSEEK_REASONER_MODEL_ID) {
    return durationMs >= 900;
  }
  if (model === DEEPSEEK_CHAT_MODEL_ID) {
    return (
      durationMs >= 4_500
      || args.reasoningLevel === "high"
      || args.reasoningLevel === "extra_high"
      || args.taskType === "research"
      || args.taskType === "dashboard_diagnostics"
      || args.taskType === "dashboard_error_explanation"
      || args.taskType === "diagnostics_explanation"
      || args.taskType === "code_fix"
      || args.taskType === "code_generate"
      || args.taskType === "code_generation"
    );
  }
  return (
    durationMs >= 3_500
    && (args.reasoningLevel === "high" || args.reasoningLevel === "extra_high")
  );
}

export function buildSafeReasoningSummary(args: {
  prompt: string;
  taskType: AiTaskType;
  contextSignals: string[];
  checksPerformed: string[];
  answerPath: string[];
  quality: AiAnswerQualityScores;
  repairAttempted: boolean;
  repairApplied: boolean;
  researchMode: boolean;
}): AiReasoningSummary {
  const intentPrompt = s(args.prompt).replace(/\s+/g, " ").trim();
  const intent = intentPrompt.length > 180 ? `${intentPrompt.slice(0, 180)}...` : intentPrompt;
  const uncertaintyNotes: string[] = [];
  if (!args.quality.passed) {
    uncertaintyNotes.push("Quality checks flagged residual relevance risks.");
  }
  if (args.repairAttempted && !args.repairApplied) {
    uncertaintyNotes.push("Repair pass was attempted but kept original answer to avoid lower quality.");
  }
  if (args.quality.hallucinationRisk < 55) {
    uncertaintyNotes.push("Potential hallucination risk remained elevated.");
  }
  if (args.researchMode) {
    uncertaintyNotes.push("Web research mode was active; source verification remains recommended.");
  }

  return {
    intent: intent || "Clarify and answer the user request within scoped context.",
    contextUsed: args.contextSignals.length ? args.contextSignals : ["surface_context"],
    checksPerformed: args.checksPerformed.length ? args.checksPerformed : ["schema_validation", "semantic_relevance"],
    answerPath: args.answerPath.length ? args.answerPath : ["initial_generation", "quality_scoring"],
    uncertaintyNotes,
    doneState: args.quality.passed ? "done" : "partial",
  };
}
