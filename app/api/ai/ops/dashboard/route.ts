import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { requireAiRequestContext } from "@/src/lib/ai/ai.guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function toDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(1, Math.min(90, Math.trunc(parsed)));
}

function ratio(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  return Number(((Math.max(0, part) / whole) * 100).toFixed(2));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasRouteSignal(contextSignalsJson: unknown): boolean {
  for (const row of asArray(contextSignalsJson)) {
    const key = String(row ?? "").toLowerCase();
    if (!key) continue;
    if (key.includes("route") || key.includes("pageawareness") || key.includes("adapter")) return true;
  }
  return false;
}

function qualityOverall(qualityJson: unknown): number {
  const q = asRecord(qualityJson);
  const parsed = Number(q.overall);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const ctx = await requireAiRequestContext({
      req,
      surface: "console",
    });
    const days = toDays(new URL(req.url).searchParams.get("days"));
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      usageRows,
      traces,
      toolCalls,
      memoryEvents,
      messageFeedback,
      agentJobs,
      latestRouteManifest,
      latestWebsiteGraph,
    ] = await Promise.all([
      prisma.cavAiUsageLog.findMany({
        where: {
          accountId: ctx.accountId,
          createdAt: { gte: windowStart },
        },
        select: {
          status: true,
          latencyMs: true,
        },
      }),
      prisma.cavAiReasoningTrace.findMany({
        where: {
          accountId: ctx.accountId,
          createdAt: { gte: windowStart },
        },
        select: {
          repairAttempted: true,
          repairApplied: true,
          qualityJson: true,
          contextSignalsJson: true,
          taskType: true,
          durationMs: true,
        },
      }),
      prisma.cavAiToolCall.findMany({
        where: {
          accountId: ctx.accountId,
          createdAt: { gte: windowStart },
        },
        select: {
          status: true,
          toolId: true,
          latencyMs: true,
        },
      }),
      prisma.cavAiUserMemoryEvent.findMany({
        where: {
          accountId: ctx.accountId,
          createdAt: { gte: windowStart },
        },
        select: {
          eventType: true,
        },
      }),
      prisma.cavAiMessageFeedback.findMany({
        where: {
          accountId: ctx.accountId,
          updatedAt: { gte: windowStart },
        },
        select: {
          reaction: true,
          retryCount: true,
        },
      }),
      prisma.cavAiAgentJob.findMany({
        where: {
          accountId: ctx.accountId,
          createdAt: { gte: windowStart },
        },
        select: {
          status: true,
        },
      }),
      prisma.cavAiRouteManifestSnapshot.findFirst({
        where: { accountId: ctx.accountId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          routeCount: true,
          coveredCount: true,
          heuristicCount: true,
          uncoveredCount: true,
          adapterCoverageRate: true,
        },
      }),
      prisma.cavAiWebsiteKnowledgeGraph.findFirst({
        where: { accountId: ctx.accountId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          graphVersion: true,
          summaryJson: true,
        },
      }),
    ]);

    const successCount = usageRows.filter((row) => row.status === "SUCCESS").length;
    const errorCount = usageRows.filter((row) => row.status === "ERROR").length;
    const avgLatencyMs = usageRows.length
      ? Math.round(
          usageRows.reduce((sum, row) => sum + (Number.isFinite(Number(row.latencyMs)) ? Number(row.latencyMs) : 0), 0)
          / usageRows.length
        )
      : 0;

    const repairAttemptedCount = traces.filter((row) => row.repairAttempted).length;
    const repairAppliedCount = traces.filter((row) => row.repairApplied).length;
    const lowQualityCount = traces.filter((row) => qualityOverall(row.qualityJson) < 62).length;
    const contextAwareCount = traces.filter((row) => hasRouteSignal(row.contextSignalsJson)).length;
    const avgReasoningMs = traces.length
      ? Math.round(traces.reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0) / traces.length)
      : 0;

    const toolSuccessCount = toolCalls.filter((row) => {
      const status = String(row.status || "").toUpperCase();
      return status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED";
    }).length;
    const toolErrorCount = toolCalls.filter((row) => String(row.status || "").toUpperCase() === "ERROR").length;
    const toolAvgLatencyMs = toolCalls.length
      ? Math.round(toolCalls.reduce((sum, row) => sum + (Number(row.latencyMs) || 0), 0) / toolCalls.length)
      : 0;

    const memoryExtractCount = memoryEvents.filter((row) => row.eventType === "fact_learned").length;
    const memoryRetrieveCount = memoryEvents.filter((row) => row.eventType === "fact_retrieved").length;
    const memorySuppressedCount = memoryEvents.filter((row) => row.eventType === "fact_stale_suppressed").length;

    const positiveFeedback = messageFeedback.filter((row) => row.reaction === "like").length;
    const negativeFeedback = messageFeedback.filter((row) => row.reaction === "dislike").length;
    const retryFeedbackCount = messageFeedback.reduce((sum, row) => sum + Math.max(0, Number(row.retryCount || 0)), 0);

    const jobCompleted = agentJobs.filter((row) => row.status === "completed").length;
    const jobFailed = agentJobs.filter((row) => row.status === "failed").length;
    const jobWaiting = agentJobs.filter((row) => row.status === "waiting").length;
    const jobRunning = agentJobs.filter((row) => row.status === "running").length;

    return json({
      ok: true,
      requestId,
      window: {
        days,
        start: windowStart.toISOString(),
        end: new Date().toISOString(),
      },
      usage: {
        total: usageRows.length,
        success: successCount,
        error: errorCount,
        successRate: ratio(successCount, usageRows.length),
        avgLatencyMs,
      },
      quality: {
        traces: traces.length,
        repairAttempted: repairAttemptedCount,
        repairApplied: repairAppliedCount,
        repairAttemptRate: ratio(repairAttemptedCount, traces.length),
        repairApplyRate: ratio(repairAppliedCount, repairAttemptedCount || 1),
        lowQualityCount,
        lowQualityRate: ratio(lowQualityCount, traces.length),
        contextAwareCount,
        contextAwareRate: ratio(contextAwareCount, traces.length),
        avgReasoningMs,
      },
      tools: {
        calls: toolCalls.length,
        success: toolSuccessCount,
        error: toolErrorCount,
        successRate: ratio(toolSuccessCount, toolCalls.length),
        avgLatencyMs: toolAvgLatencyMs,
      },
      memory: {
        events: memoryEvents.length,
        extractCount: memoryExtractCount,
        retrieveCount: memoryRetrieveCount,
        staleSuppressedCount: memorySuppressedCount,
      },
      feedback: {
        positive: positiveFeedback,
        negative: negativeFeedback,
        retryCount: retryFeedbackCount,
      },
      longRunningJobs: {
        total: agentJobs.length,
        running: jobRunning,
        waiting: jobWaiting,
        completed: jobCompleted,
        failed: jobFailed,
        completionRate: ratio(jobCompleted, agentJobs.length),
        failureRate: ratio(jobFailed, agentJobs.length),
      },
      routeManifest: latestRouteManifest
        ? {
            id: latestRouteManifest.id,
            createdAt: latestRouteManifest.createdAt.toISOString(),
            routeCount: latestRouteManifest.routeCount,
            coveredCount: latestRouteManifest.coveredCount,
            heuristicCount: latestRouteManifest.heuristicCount,
            uncoveredCount: latestRouteManifest.uncoveredCount,
            adapterCoverageRate: Number(latestRouteManifest.adapterCoverageRate || 0),
          }
        : null,
      websiteKnowledge: latestWebsiteGraph
        ? {
            id: latestWebsiteGraph.id,
            createdAt: latestWebsiteGraph.createdAt.toISOString(),
            graphVersion: latestWebsiteGraph.graphVersion,
            summary: asRecord(latestWebsiteGraph.summaryJson),
          }
        : null,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to generate AI ops dashboard metrics.";
    return json(
      {
        ok: false,
        requestId,
        error: "AI_OPS_DASHBOARD_FAILED",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
