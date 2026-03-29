import "server-only";

import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import type { AiSurface, AiUsageStatus } from "@/src/lib/ai/ai.types";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

export type AiUsageLogInput = {
  accountId: string;
  userId: string;
  surface: AiSurface;
  action: string;
  provider: string;
  model: string;
  requestId: string;
  runId?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  inputChars: number;
  outputChars: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  status: AiUsageStatus;
  errorCode?: string | null;
};

export async function writeAiUsageLog(input: AiUsageLogInput) {
  try {
    await prisma.cavAiUsageLog.create({
      data: {
        accountId: s(input.accountId),
        userId: s(input.userId),
        surface: s(input.surface).slice(0, 32),
        action: s(input.action).slice(0, 120),
        provider: s(input.provider).slice(0, 32),
        model: s(input.model).slice(0, 120),
        requestId: s(input.requestId).slice(0, 120),
        runId: s(input.runId) || null,
        workspaceId: s(input.workspaceId) || null,
        projectId: Number.isFinite(Number(input.projectId))
          ? Math.trunc(Number(input.projectId))
          : null,
        origin: s(input.origin) || null,
        inputChars: Math.max(0, Math.trunc(Number(input.inputChars || 0))),
        outputChars: Math.max(0, Math.trunc(Number(input.outputChars || 0))),
        promptTokens: normalizeInt(input.promptTokens),
        completionTokens: normalizeInt(input.completionTokens),
        totalTokens: normalizeInt(input.totalTokens),
        latencyMs: normalizeInt(input.latencyMs),
        status: s(input.status || "ERROR").slice(0, 24),
        errorCode: s(input.errorCode) || null,
      },
    });
  } catch {
    // Usage logging is best-effort and must not fail AI flows.
  }
}

export async function writeAiAudit(args: {
  req: Request;
  accountId: string;
  userId: string;
  requestId: string;
  surface: AiSurface;
  action: string;
  provider: string;
  model: string;
  status: AiUsageStatus;
  runId?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  errorCode?: string | null;
  memberRole?: string | null;
  planId?: string | null;
  actionClass?: string | null;
  reasoningLevel?: string | null;
  weightedUsageUnits?: number | null;
  researchMode?: boolean | null;
  researchToolBundle?: string[] | null;
  researchUrlsCount?: number | null;
  attachmentCount?: number | null;
  latencyMs?: number | null;
  scopePath?: string | null;
  outcome?: string | null;
}) {
  try {
    await auditLogWrite({
      accountId: s(args.accountId),
      operatorUserId: s(args.userId) || null,
      action: "SYSTEM_JOB_RAN",
      actionLabel:
        args.status === "SUCCESS"
          ? `AI assist completed (${args.surface}:${args.action})`
          : `AI assist failed (${args.surface}:${args.action})`,
      category: "system",
      severity: args.status === "SUCCESS" ? "info" : "warning",
      targetType: "ai_assist",
      targetId: s(args.requestId),
      targetLabel: s(args.surface),
      request: args.req,
      metaJson: {
        requestId: s(args.requestId),
        surface: s(args.surface),
        action: s(args.action),
        provider: s(args.provider),
        model: s(args.model),
        status: s(args.status),
        memberRole: s(args.memberRole) || null,
        planId: s(args.planId) || null,
        actionClass: s(args.actionClass) || null,
        reasoningLevel: s(args.reasoningLevel) || null,
        weightedUsageUnits: normalizeInt(args.weightedUsageUnits),
        researchMode: args.researchMode === true,
        researchToolBundle: Array.isArray(args.researchToolBundle)
          ? args.researchToolBundle.map((item) => s(item)).filter(Boolean).slice(0, 8)
          : [],
        researchUrlsCount: normalizeInt(args.researchUrlsCount),
        attachmentCount: normalizeInt(args.attachmentCount),
        latencyMs: normalizeInt(args.latencyMs),
        scopePath: s(args.scopePath) || null,
        outcome: s(args.outcome) || null,
        runId: s(args.runId) || null,
        workspaceId: s(args.workspaceId) || null,
        projectId: Number.isFinite(Number(args.projectId))
          ? Math.trunc(Number(args.projectId))
          : null,
        origin: s(args.origin) || null,
        errorCode: s(args.errorCode) || null,
      },
    });
  } catch {
    // Audit logging is best-effort and must not fail AI flows.
  }
}

export async function persistAiNarration(args: {
  accountId: string;
  userId: string;
  requestId: string;
  provider: string;
  model: string;
  narrationJson: Record<string, unknown>;
  runId?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
}) {
  try {
    await prisma.cavAiNarration.create({
      data: {
        accountId: s(args.accountId),
        runId: s(args.runId) || null,
        requestId: s(args.requestId).slice(0, 120),
        provider: s(args.provider).slice(0, 32),
        model: s(args.model).slice(0, 120),
        narrationJson: args.narrationJson as unknown as object,
        createdByUserId: s(args.userId),
        workspaceId: s(args.workspaceId) || null,
        projectId: Number.isFinite(Number(args.projectId))
          ? Math.trunc(Number(args.projectId))
          : null,
        origin: s(args.origin) || null,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}

export async function persistAiFixPlan(args: {
  accountId: string;
  userId: string;
  requestId: string;
  priorityCode: string;
  source: "deterministic" | "llm";
  status?: "PROPOSED" | "VERIFIED" | "REJECTED";
  planJson: Record<string, unknown>;
  verificationJson?: Record<string, unknown> | null;
  runId?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  origin?: string | null;
}) {
  try {
    await prisma.cavAiFixPlan.create({
      data: {
        accountId: s(args.accountId),
        runId: s(args.runId) || null,
        requestId: s(args.requestId).slice(0, 120),
        priorityCode: s(args.priorityCode).slice(0, 120),
        source: s(args.source).slice(0, 24),
        status: s(args.status || "PROPOSED").slice(0, 24),
        planJson: args.planJson as unknown as object,
        verificationJson: args.verificationJson
          ? (args.verificationJson as unknown as object)
          : undefined,
        createdByUserId: s(args.userId),
        workspaceId: s(args.workspaceId) || null,
        projectId: Number.isFinite(Number(args.projectId))
          ? Math.trunc(Number(args.projectId))
          : null,
        origin: s(args.origin) || null,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}

export async function persistAiReasoningTrace(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId: string;
  surface: string;
  action: string;
  taskType: string;
  actionClass: string;
  provider: string;
  model: string;
  reasoningLevel: string;
  researchMode: boolean;
  durationMs: number;
  showReasoningChip: boolean;
  repairAttempted: boolean;
  repairApplied: boolean;
  quality?: Record<string, unknown> | null;
  safeSummary?: Record<string, unknown> | null;
  contextSignals?: string[] | null;
  checksPerformed?: string[] | null;
  answerPath?: string[] | null;
}) {
  try {
    await prisma.cavAiReasoningTrace.create({
      data: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        sessionId: s(args.sessionId) || null,
        requestId: s(args.requestId).slice(0, 120),
        surface: s(args.surface).slice(0, 32),
        action: s(args.action).slice(0, 120),
        taskType: s(args.taskType).slice(0, 64),
        actionClass: s(args.actionClass).slice(0, 64),
        provider: s(args.provider).slice(0, 32),
        model: s(args.model).slice(0, 120),
        reasoningLevel: s(args.reasoningLevel).slice(0, 24),
        researchMode: args.researchMode === true,
        durationMs: Math.max(0, Math.trunc(Number(args.durationMs || 0))),
        showReasoningChip: args.showReasoningChip === true,
        repairAttempted: args.repairAttempted === true,
        repairApplied: args.repairApplied === true,
        qualityJson: args.quality ? (args.quality as unknown as object) : undefined,
        safeSummaryJson: args.safeSummary ? (args.safeSummary as unknown as object) : undefined,
        contextSignalsJson: Array.isArray(args.contextSignals) ? (args.contextSignals as unknown as object) : undefined,
        checksJson: Array.isArray(args.checksPerformed) ? (args.checksPerformed as unknown as object) : undefined,
        answerPathJson: Array.isArray(args.answerPath) ? (args.answerPath as unknown as object) : undefined,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}

export async function persistAiToolCallTrace(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId: string;
  surface: string;
  action: string;
  toolId: string;
  status: "planned" | "success" | "error";
  latencyMs?: number | null;
  inputJson?: Record<string, unknown> | null;
  outputJson?: Record<string, unknown> | null;
  errorCode?: string | null;
}) {
  try {
    await prisma.cavAiToolCall.create({
      data: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        sessionId: s(args.sessionId) || null,
        requestId: s(args.requestId).slice(0, 120),
        surface: s(args.surface).slice(0, 32),
        action: s(args.action).slice(0, 120),
        toolId: s(args.toolId).slice(0, 80),
        status: s(args.status).toUpperCase().slice(0, 24),
        latencyMs: normalizeInt(args.latencyMs),
        inputJson: args.inputJson ? (args.inputJson as unknown as object) : undefined,
        outputJson: args.outputJson ? (args.outputJson as unknown as object) : undefined,
        errorCode: s(args.errorCode) || null,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}

export async function persistAiRetryEvent(args: {
  accountId: string;
  userId: string;
  sessionId: string;
  requestId: string;
  surface: string;
  action: string;
  taskType?: string | null;
  sourceMessageId?: string | null;
  sourceSessionId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  researchMode?: boolean | null;
  contextJson?: Record<string, unknown> | null;
}) {
  try {
    await prisma.cavAiRetryEvent.create({
      data: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        sessionId: s(args.sessionId),
        requestId: s(args.requestId).slice(0, 120),
        surface: s(args.surface).slice(0, 32),
        action: s(args.action).slice(0, 120),
        taskType: s(args.taskType) || null,
        sourceMessageId: s(args.sourceMessageId) || null,
        sourceSessionId: s(args.sourceSessionId) || null,
        model: s(args.model) || null,
        reasoningLevel: s(args.reasoningLevel) || null,
        researchMode: args.researchMode === true,
        contextJson: args.contextJson ? (args.contextJson as unknown as object) : undefined,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}

export async function persistAiModelSelectionEvent(args: {
  accountId: string;
  userId: string;
  sessionId?: string | null;
  requestId: string;
  surface: string;
  action: string;
  taskType?: string | null;
  actionClass: string;
  planId: string;
  requestedModel?: string | null;
  resolvedModel: string;
  providerId: string;
  reasoningLevel: string;
  manualSelection: boolean;
  fallbackReason?: string | null;
}) {
  try {
    await prisma.cavAiModelSelectionEvent.create({
      data: {
        accountId: s(args.accountId),
        userId: s(args.userId),
        sessionId: s(args.sessionId) || null,
        requestId: s(args.requestId).slice(0, 120),
        surface: s(args.surface).slice(0, 32),
        action: s(args.action).slice(0, 120),
        taskType: s(args.taskType) || null,
        actionClass: s(args.actionClass).slice(0, 64),
        planId: s(args.planId).slice(0, 32),
        requestedModel: s(args.requestedModel) || null,
        resolvedModel: s(args.resolvedModel).slice(0, 120),
        providerId: s(args.providerId).slice(0, 32),
        reasoningLevel: s(args.reasoningLevel).slice(0, 24),
        manualSelection: args.manualSelection === true,
        fallbackReason: s(args.fallbackReason) || null,
      },
    });
  } catch {
    // Non-blocking persistence.
  }
}
