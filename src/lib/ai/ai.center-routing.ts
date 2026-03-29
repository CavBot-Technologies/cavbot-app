import type { AiCenterAssistAction, AiCenterSurface, AiTaskType } from "@/src/lib/ai/ai.types";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

const GENERIC_CENTER_ACTIONS = new Set<AiCenterAssistAction>([
  "write_note",
  "summarize_thread",
  "technical_recap",
  "bullets_to_plan",
]);

export function isGenericCenterAction(action: AiCenterAssistAction): boolean {
  return GENERIC_CENTER_ACTIONS.has(action);
}

export function inferCenterActionFromPrompt(
  prompt: string,
  selectedAction: AiCenterAssistAction = "technical_recap"
): AiCenterAssistAction {
  const text = s(prompt).toLowerCase();
  const normalizedSelected = selectedAction || "technical_recap";
  if (!text) return normalizedSelected;

  const candidates: Array<{ pattern: RegExp; action: AiCenterAssistAction }> = [
    { pattern: /\b(multimodal|live multimodal|omni|analyze this video|analyze this audio|cross-modal)\b/, action: "live_multimodal" },
    { pattern: /\b(budget|spending|expense|debt|cash flow|money plan|financial plan)\b/, action: "financial_advisor" },
    { pattern: /\b(overwhelmed|panic|anxious|anxiety|ground me|journal|process this feeling)\b/, action: "therapist_support" },
    { pattern: /\b(mentor me|mentorship|discipline|long-term growth|coach me)\b/, action: "mentor" },
    { pattern: /\b(as a friend|best friend|i feel alone|be real with me)\b/, action: "best_friend" },
    { pattern: /\b(relationship|partner|girlfriend|boyfriend|spouse|communication conflict)\b/, action: "relationship_advisor" },
    { pattern: /\b(philosophy|meaning|purpose|existential|stoic|stoicism)\b/, action: "philosopher" },
    { pattern: /\b(focus|deep work|procrastinat|prioritize my day|lock in)\b/, action: "focus_coach" },
    { pattern: /\b(life strategy|life plan|life goals|career + life|next chapter)\b/, action: "life_strategist" },
    { pattern: /\b(email|e-mail|text message|dm|reply draft|rewrite this message)\b/, action: "email_text_agent" },
    { pattern: /\b(content creator|website copy|landing copy|headline|subheadline|section copy)\b/, action: "content_creator" },
    { pattern: /\b(privacy policy|terms of service|terms and conditions|ethics policy|compliance language)\b/, action: "legal_privacy_terms_ethics_agent" },
    { pattern: /\b(pdf|portable document|document export|edit pdf|preview pdf)\b/, action: "pdf_create_edit_preview_agent" },
    { pattern: /\b(404 page|not found page|error page copy)\b/, action: "page_404_builder_agent" },
    { pattern: /\b(edit document|review this doc|rewrite this document|document feedback)\b/, action: "doc_edit_review_agent" },
    { pattern: /\b(companion|cavbot companion|talk it through|burnout|decompress)\b/, action: "companion_chat" },
    { pattern: /\b(image studio|generate image|visual concept|mockup visual)\b/, action: "image_studio" },
    { pattern: /\b(image edit|edit image|enhance screenshot|retouch)\b/, action: "image_edit" },
    { pattern: /\b(research|sources?|citation|evidence|compare)\b/, action: "web_research" },
    { pattern: /\b(anomaly|spike|incident|error(s)?|latency|diagnostic|issue(s)?)\b/, action: "summarize_issues" },
    { pattern: /\b(policy|security|permission|access|private|acl|cavsafe)\b/, action: "explain_access_restrictions" },
    { pattern: /\b(folder|storage|directory|artifact(s)?|publish|cavcloud)\b/, action: "organize_storage" },
    { pattern: /\b(dashboard|console)\b.{0,40}\b(summary|overview|status|health)\b/, action: "summarize_issues" },
    { pattern: /\b(html|css|javascript|typescript|python|sql|code|snippet|script|function|class|component|api|bug|debug|fix|refactor)\b/, action: "technical_recap" },
    { pattern: /\b(rewrite|rephrase|clarify|simplify wording|retitle|rename|headline|title)\b/, action: "rewrite_clearly" },
    { pattern: /\bsummary|summarize|recap|tl;dr\b/, action: "summarize_thread" },
    { pattern: /\b(write|draft|compose|create)\b.{0,40}\b(note|memo|email|message|letter|announcement)\b/, action: "write_note" },
    { pattern: /\b(next step|what should i do|execution plan|roadmap|strategy|priorit(y|ize)|plan my)\b/, action: "recommend_next_steps" },
    { pattern: /\bplan\b|\bweek\b|\bschedule\b/, action: "bullets_to_plan" },
    { pattern: /\b(seo|google|serp|ranking|rank|keyword|meta description|schema)\b/, action: "technical_recap" },
  ];

  for (const candidate of candidates) {
    if (!candidate.pattern.test(text)) continue;
    return candidate.action;
  }

  if (normalizedSelected === "write_note") return "technical_recap";
  return normalizedSelected;
}

function isResearchTask(taskType: AiTaskType): boolean {
  return taskType === "research";
}

function isSecurityTask(taskType: AiTaskType): boolean {
  return taskType === "cavsafe_policy" || taskType === "cavsafe_security_guidance" || taskType === "security_policy";
}

function isStorageTask(taskType: AiTaskType): boolean {
  return taskType === "cavcloud_organization" || taskType === "cavcloud_guidance" || taskType === "storage_guidance";
}

function isDashboardTask(taskType: AiTaskType): boolean {
  return (
    taskType === "dashboard_summary"
    || taskType === "dashboard_diagnostics"
    || taskType === "dashboard_error_explanation"
    || taskType === "diagnostics_explanation"
  );
}

function isWritingTask(taskType: AiTaskType): boolean {
  return (
    taskType === "writing"
    || taskType === "rewrite"
    || taskType === "note_writing"
    || taskType === "note_rewrite"
    || taskType === "note_summary"
    || taskType === "summarization"
    || taskType === "summary"
    || taskType === "title_improvement"
    || taskType === "naming"
  );
}

function isCodeTask(taskType: AiTaskType): boolean {
  return (
    taskType === "code_explain"
    || taskType === "code_generate"
    || taskType === "code_fix"
    || taskType === "code_refactor"
    || taskType === "code_plan"
    || taskType === "code_review"
    || taskType === "patch_proposal"
    || taskType === "code_explanation"
    || taskType === "code_generation"
  );
}

function isPlanningTask(taskType: AiTaskType): boolean {
  return (
    taskType === "planning"
    || taskType === "strategy"
    || taskType === "productivity"
    || taskType === "workspace_guidance"
    || taskType === "decision_support"
  );
}

export function resolveCenterActionForTask(args: {
  surface: AiCenterSurface;
  requestedAction: AiCenterAssistAction;
  taskType: AiTaskType;
  researchModeRequested: boolean;
}): AiCenterAssistAction {
  if (args.researchModeRequested || isResearchTask(args.taskType)) return "web_research";

  if (args.surface !== "general" && args.surface !== "workspace") {
    return args.requestedAction;
  }

  if (!isGenericCenterAction(args.requestedAction)) {
    return args.requestedAction;
  }

  if (isDashboardTask(args.taskType)) return "summarize_issues";
  if (isSecurityTask(args.taskType)) return "explain_access_restrictions";
  if (isStorageTask(args.taskType)) return "organize_storage";
  if (isPlanningTask(args.taskType)) return "recommend_next_steps";
  if (args.taskType === "note_writing") return "write_note";
  if (args.taskType === "note_summary" || args.taskType === "summarization" || args.taskType === "summary") return "summarize_thread";
  if (isWritingTask(args.taskType)) return "rewrite_clearly";
  if (isCodeTask(args.taskType)) return "technical_recap";
  if (
    args.taskType === "seo"
    || args.taskType === "keyword_research"
    || args.taskType === "content_brief"
    || args.taskType === "website_improvement"
    || args.taskType === "seo_help"
    || args.taskType === "general_question"
    || args.taskType === "general_chat"
    || args.taskType === "explanation"
    || args.taskType === "tutoring"
    || args.taskType === "comparison"
    || args.taskType === "brainstorming"
  ) {
    return "technical_recap";
  }

  return args.requestedAction || "technical_recap";
}
