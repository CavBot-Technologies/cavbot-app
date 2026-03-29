import type { CavCodeAssistAction, AiSurface, AiTaskType } from "@/src/lib/ai/ai.types";
import type { AiModelRole } from "@/src/lib/ai/providers";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export function resolveModelRoleForCavCodeAction(action: CavCodeAssistAction): AiModelRole {
  if (
    action === "explain_error" ||
    action === "suggest_fix" ||
    action === "refactor_safely" ||
    action === "explain_code" ||
    action === "competitor_research" ||
    action === "accessibility_audit" ||
    action === "api_schema_contract_guard" ||
    action === "web_research" ||
    action === "summarize_issues" ||
    action === "audit_access_context"
  ) {
    return "reasoning";
  }
  return "chat";
}

export function resolveModelRoleForSurfaceAction(surface: AiSurface, action: string): AiModelRole {
  const normalized = s(action).toLowerCase();
  if (
    normalized.includes("anomaly") ||
    normalized.includes("issue_cluster") ||
    normalized.includes("fix_plan") ||
    normalized.includes("explain_error")
  ) {
    return "reasoning";
  }
  if (surface === "console" && normalized.includes("recommend_next_step")) return "reasoning";
  return "chat";
}

export function resolveModelRoleForTaskType(args: {
  taskType: AiTaskType;
  surface: AiSurface;
  action: string;
}): AiModelRole {
  const task = args.taskType;
  if (
    task === "code_fix"
    || task === "code_generate"
    || task === "code_refactor"
    || task === "code_plan"
    || task === "code_review"
    || task === "patch_proposal"
    || task === "code_explain"
    || task === "code_generation"
    || task === "code_explanation"
  ) {
    return "reasoning";
  }

  if (
    task === "research"
    || task === "seo"
    || task === "keyword_research"
    || task === "content_brief"
    || task === "website_improvement"
    || task === "dashboard_diagnostics"
    || task === "dashboard_error_explanation"
    || task === "dashboard_summary"
    || task === "cavcloud_organization"
    || task === "cavcloud_guidance"
    || task === "cavsafe_policy"
    || task === "cavsafe_security_guidance"
    || task === "strategy"
    || task === "planning"
    || task === "decision_support"
    || task === "diagnostics_explanation"
    || task === "seo_help"
    || task === "security_policy"
    || task === "storage_guidance"
    || task === "workspace_guidance"
  ) {
    return "reasoning";
  }

  if (
    task === "writing"
    || task === "rewrite"
    || task === "title_improvement"
    || task === "naming"
    || task === "note_writing"
    || task === "note_rewrite"
    || task === "note_summary"
    || task === "summarization"
    || task === "general_chat"
    || task === "general_question"
    || task === "productivity"
  ) {
    return "chat";
  }

  return resolveModelRoleForSurfaceAction(args.surface, args.action);
}
