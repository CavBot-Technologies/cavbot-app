import "server-only";

import { prisma } from "@/lib/prisma";
import {
  buildCavAiRouteManifestSnapshot,
  persistCavAiRouteManifestSnapshot,
} from "@/lib/cavai/routeManifest.server";
import { ingestWebsiteKnowledgeFromLatestScan } from "@/lib/cavai/websiteKnowledge.server";

export type AiAgentJobState =
  | "planning"
  | "researching"
  | "crawling"
  | "checking"
  | "coding"
  | "validating"
  | "repairing"
  | "waiting_on_source"
  | "ready_for_review"
  | "completed"
  | "failed";

export type AiAgentJobStatus = "queued" | "running" | "waiting" | "ready" | "completed" | "failed" | "cancelled";

export type AiAgentJobType =
  | "route_manifest_audit"
  | "website_knowledge_refresh"
  | "research_background"
  | "diagnostics_investigation"
  | "coding_plan";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toProgress(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.trunc(parsed)));
}

function safeJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeState(value: unknown): AiAgentJobState {
  const raw = s(value).toLowerCase();
  if (
    raw === "planning"
    || raw === "researching"
    || raw === "crawling"
    || raw === "checking"
    || raw === "coding"
    || raw === "validating"
    || raw === "repairing"
    || raw === "waiting_on_source"
    || raw === "ready_for_review"
    || raw === "completed"
    || raw === "failed"
  ) {
    return raw;
  }
  return "planning";
}

function normalizeStatus(value: unknown): AiAgentJobStatus {
  const raw = s(value).toLowerCase();
  if (
    raw === "queued"
    || raw === "running"
    || raw === "waiting"
    || raw === "ready"
    || raw === "completed"
    || raw === "failed"
    || raw === "cancelled"
  ) {
    return raw;
  }
  return "queued";
}

function normalizeJobType(value: unknown): AiAgentJobType {
  const raw = s(value).toLowerCase();
  if (
    raw === "route_manifest_audit"
    || raw === "website_knowledge_refresh"
    || raw === "research_background"
    || raw === "diagnostics_investigation"
    || raw === "coding_plan"
  ) {
    return raw;
  }
  return "research_background";
}

const activeExecutions = new Set<string>();

export type AiAgentJobSummary = {
  id: string;
  requestId: string | null;
  sessionId: string | null;
  surface: string;
  jobType: AiAgentJobType;
  taskType: string | null;
  goal: string;
  state: AiAgentJobState;
  status: AiAgentJobStatus;
  progressPct: number;
  workspaceId: string | null;
  projectId: number | null;
  siteId: string | null;
  origin: string | null;
  context: Record<string, unknown>;
  result: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toSummary(row: {
  id: string;
  requestId: string | null;
  sessionId: string | null;
  surface: string;
  jobType: string;
  taskType: string | null;
  goal: string;
  state: string;
  status: string;
  progressPct: number;
  workspaceId: string | null;
  projectId: number | null;
  siteId: string | null;
  origin: string | null;
  contextJson: unknown;
  resultJson: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AiAgentJobSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    sessionId: row.sessionId,
    surface: row.surface,
    jobType: normalizeJobType(row.jobType),
    taskType: row.taskType,
    goal: row.goal,
    state: normalizeState(row.state),
    status: normalizeStatus(row.status),
    progressPct: toProgress(row.progressPct),
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    siteId: row.siteId,
    origin: row.origin,
    context: safeJsonRecord(row.contextJson),
    result: safeJsonRecord(row.resultJson),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function appendEvent(args: {
  accountId: string;
  userId: string;
  jobId: string;
  state: AiAgentJobState;
  status: AiAgentJobStatus;
  step: string;
  detail?: Record<string, unknown>;
}) {
  await prisma.cavAiAgentJobEvent.create({
    data: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      jobId: s(args.jobId),
      state: args.state,
      status: args.status,
      step: s(args.step).slice(0, 120) || "update",
      detailJson: args.detail ? (args.detail as unknown as object) : undefined,
    },
  });
}

async function transitionJob(args: {
  accountId: string;
  userId: string;
  jobId: string;
  state: AiAgentJobState;
  status: AiAgentJobStatus;
  progressPct: number;
  step: string;
  detail?: Record<string, unknown>;
}) {
  const now = new Date();
  const updateData: Record<string, unknown> = {
    state: args.state,
    status: args.status,
    progressPct: toProgress(args.progressPct),
    lastHeartbeatAt: now,
  };
  if (args.status === "running") {
    updateData.startedAt = now;
  }
  if (args.status === "completed" || args.status === "failed" || args.status === "cancelled") {
    updateData.completedAt = now;
  }

  await prisma.cavAiAgentJob.updateMany({
    where: {
      id: s(args.jobId),
      accountId: s(args.accountId),
      userId: s(args.userId),
    },
    data: updateData,
  });

  await appendEvent({
    accountId: args.accountId,
    userId: args.userId,
    jobId: args.jobId,
    state: args.state,
    status: args.status,
    step: args.step,
    detail: args.detail,
  });
}

export async function createAiAgentJob(args: {
  accountId: string;
  userId: string;
  requestId?: string | null;
  sessionId?: string | null;
  surface: string;
  jobType: AiAgentJobType;
  taskType?: string | null;
  goal: string;
  workspaceId?: string | null;
  projectId?: number | null;
  siteId?: string | null;
  origin?: string | null;
  context?: Record<string, unknown>;
  autoStart?: boolean;
}): Promise<AiAgentJobSummary> {
  const created = await prisma.cavAiAgentJob.create({
    data: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      requestId: s(args.requestId) || null,
      sessionId: s(args.sessionId) || null,
      surface: s(args.surface).slice(0, 32) || "workspace",
      jobType: normalizeJobType(args.jobType),
      taskType: s(args.taskType) || null,
      goal: s(args.goal) || "Long-running CavAi task",
      state: "planning",
      status: "queued",
      progressPct: 0,
      workspaceId: s(args.workspaceId) || null,
      projectId: toProjectId(args.projectId),
      siteId: s(args.siteId) || null,
      origin: s(args.origin) || null,
      contextJson: args.context ? (args.context as unknown as object) : undefined,
    },
  });
  await appendEvent({
    accountId: args.accountId,
    userId: args.userId,
    jobId: created.id,
    state: "planning",
    status: "queued",
    step: "job_created",
    detail: {
      jobType: normalizeJobType(args.jobType),
      taskType: s(args.taskType) || null,
    },
  });

  if (args.autoStart !== false) {
    void executeAiAgentJob({
      accountId: args.accountId,
      userId: args.userId,
      jobId: created.id,
    });
  }

  return getAiAgentJob({
    accountId: args.accountId,
    userId: args.userId,
    jobId: created.id,
  }) as Promise<AiAgentJobSummary>;
}

export async function getAiAgentJob(args: {
  accountId: string;
  userId: string;
  jobId: string;
}): Promise<AiAgentJobSummary | null> {
  const row = await prisma.cavAiAgentJob.findFirst({
    where: {
      id: s(args.jobId),
      accountId: s(args.accountId),
      userId: s(args.userId),
    },
  });
  if (!row) return null;
  return toSummary(row);
}

export async function listAiAgentJobs(args: {
  accountId: string;
  userId: string;
  status?: AiAgentJobStatus | null;
  projectId?: number | null;
  workspaceId?: string | null;
  limit?: number;
}): Promise<AiAgentJobSummary[]> {
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(args.limit || 40))));
  const rows = await prisma.cavAiAgentJob.findMany({
    where: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      ...(s(args.status) ? { status: normalizeStatus(args.status) } : {}),
      ...(toProjectId(args.projectId) ? { projectId: toProjectId(args.projectId) } : {}),
      ...(s(args.workspaceId) ? { workspaceId: s(args.workspaceId) } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((row) => toSummary(row));
}

export async function listAiAgentJobEvents(args: {
  accountId: string;
  userId: string;
  jobId: string;
  limit?: number;
}): Promise<Array<{
  id: string;
  state: AiAgentJobState;
  status: AiAgentJobStatus;
  step: string;
  detail: Record<string, unknown>;
  createdAt: string;
}>> {
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit || 120))));
  const rows = await prisma.cavAiAgentJobEvent.findMany({
    where: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      jobId: s(args.jobId),
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    state: normalizeState(row.state),
    status: normalizeStatus(row.status),
    step: row.step,
    detail: safeJsonRecord(row.detailJson),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function cancelAiAgentJob(args: {
  accountId: string;
  userId: string;
  jobId: string;
  reason?: string | null;
}): Promise<AiAgentJobSummary | null> {
  const updated = await prisma.cavAiAgentJob.updateMany({
    where: {
      id: s(args.jobId),
      accountId: s(args.accountId),
      userId: s(args.userId),
      status: { in: ["queued", "running", "waiting", "ready"] },
    },
    data: {
      status: "cancelled",
      state: "failed",
      progressPct: 100,
      completedAt: new Date(),
      errorCode: "JOB_CANCELLED",
      errorMessage: s(args.reason) || "Cancelled by user.",
      lastHeartbeatAt: new Date(),
    },
  });
  if (updated.count > 0) {
    await appendEvent({
      accountId: args.accountId,
      userId: args.userId,
      jobId: args.jobId,
      state: "failed",
      status: "cancelled",
      step: "job_cancelled",
      detail: {
        reason: s(args.reason) || "Cancelled by user.",
      },
    });
  }
  return getAiAgentJob(args);
}

export async function executeAiAgentJob(args: {
  accountId: string;
  userId: string;
  jobId: string;
}): Promise<void> {
  const key = `${s(args.accountId)}:${s(args.userId)}:${s(args.jobId)}`;
  if (activeExecutions.has(key)) return;
  activeExecutions.add(key);

  try {
    const job = await prisma.cavAiAgentJob.findFirst({
      where: {
        id: s(args.jobId),
        accountId: s(args.accountId),
        userId: s(args.userId),
      },
    });
    if (!job) return;
    const jobType = normalizeJobType(job.jobType);

    await transitionJob({
      accountId: args.accountId,
      userId: args.userId,
      jobId: job.id,
      state: "planning",
      status: "running",
      progressPct: 5,
      step: "planner_started",
      detail: { jobType },
    });

    if (jobType === "route_manifest_audit") {
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "checking",
        status: "running",
        progressPct: 42,
        step: "route_manifest_scanning",
      });
      const snapshot = await buildCavAiRouteManifestSnapshot();
      const persisted = await persistCavAiRouteManifestSnapshot({
        accountId: args.accountId,
        userId: args.userId,
        requestId: job.requestId || `job:${job.id}`,
        source: "agent_job",
        workspaceId: job.workspaceId || null,
        projectId: job.projectId || null,
        origin: job.origin || null,
        snapshot,
      });

      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "ready_for_review",
        status: "ready",
        progressPct: 92,
        step: "route_manifest_ready",
        detail: {
          snapshotId: persisted.id,
          routeCount: snapshot.routeCount,
          adapterCoverageRate: snapshot.adapterCoverageRate,
          uncoveredCount: snapshot.uncoveredCount,
        },
      });

      await prisma.cavAiAgentJob.updateMany({
        where: {
          id: job.id,
          accountId: args.accountId,
          userId: args.userId,
        },
        data: {
          resultJson: {
            snapshotId: persisted.id,
            summary: {
              routeCount: snapshot.routeCount,
              coveredCount: snapshot.coveredCount,
              heuristicCount: snapshot.heuristicCount,
              uncoveredCount: snapshot.uncoveredCount,
              adapterCoverageRate: snapshot.adapterCoverageRate,
            },
          } as unknown as object,
        },
      });

      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "completed",
        status: "completed",
        progressPct: 100,
        step: "job_completed",
      });
      return;
    }

    if (jobType === "website_knowledge_refresh") {
      const projectId = toProjectId(job.projectId);
      if (!projectId) {
        await transitionJob({
          accountId: args.accountId,
          userId: args.userId,
          jobId: job.id,
          state: "waiting_on_source",
          status: "waiting",
          progressPct: 30,
          step: "missing_project_context",
          detail: {
            message: "projectId is required for website knowledge refresh jobs.",
          },
        });
        return;
      }

      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "crawling",
        status: "running",
        progressPct: 46,
        step: "scan_data_ingestion",
      });

      const result = await ingestWebsiteKnowledgeFromLatestScan({
        accountId: args.accountId,
        userId: args.userId,
        requestId: job.requestId || `job:${job.id}`,
        workspaceId: job.workspaceId || null,
        projectId,
        siteId: job.siteId || null,
        origin: job.origin || null,
      });

      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "ready_for_review",
        status: "ready",
        progressPct: 94,
        step: "website_graph_ready",
        detail: {
          graphId: result.id,
          pagesCrawled: result.graph.metrics.pagesCrawled,
          criticalFindings: result.graph.metrics.criticalFindings,
        },
      });

      await prisma.cavAiAgentJob.updateMany({
        where: {
          id: job.id,
          accountId: args.accountId,
          userId: args.userId,
        },
        data: {
          resultJson: {
            graphId: result.id,
            summary: {
              pagesCrawled: result.graph.metrics.pagesCrawled,
              pagesWithErrors: result.graph.metrics.pagesWithErrors,
              findingsTotal: result.graph.metrics.findingsTotal,
              opportunities: result.graph.opportunities.slice(0, 6),
            },
          } as unknown as object,
        },
      });

      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "completed",
        status: "completed",
        progressPct: 100,
        step: "job_completed",
      });
      return;
    }

    if (jobType === "research_background") {
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "researching",
        status: "running",
        progressPct: 35,
        step: "research_started",
      });
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "ready_for_review",
        status: "ready",
        progressPct: 90,
        step: "research_ready_for_review",
        detail: {
          note: "Research lane placeholder completed; attach URLs/sources for deeper runs.",
        },
      });
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "completed",
        status: "completed",
        progressPct: 100,
        step: "job_completed",
      });
      return;
    }

    if (jobType === "diagnostics_investigation") {
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "checking",
        status: "running",
        progressPct: 52,
        step: "diagnostics_checking",
      });
      await transitionJob({
        accountId: args.accountId,
        userId: args.userId,
        jobId: job.id,
        state: "completed",
        status: "completed",
        progressPct: 100,
        step: "job_completed",
      });
      return;
    }

    await transitionJob({
      accountId: args.accountId,
      userId: args.userId,
      jobId: job.id,
      state: "coding",
      status: "running",
      progressPct: 58,
      step: "coding_plan_started",
    });
    await transitionJob({
      accountId: args.accountId,
      userId: args.userId,
      jobId: job.id,
      state: "completed",
      status: "completed",
      progressPct: 100,
      step: "job_completed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent job execution failed.";
    await prisma.cavAiAgentJob.updateMany({
      where: {
        id: s(args.jobId),
        accountId: s(args.accountId),
        userId: s(args.userId),
      },
      data: {
        state: "failed",
        status: "failed",
        progressPct: 100,
        errorCode: "AGENT_JOB_FAILED",
        errorMessage: message.slice(0, 4_000),
        completedAt: new Date(),
        lastHeartbeatAt: new Date(),
      },
    });
    await appendEvent({
      accountId: args.accountId,
      userId: args.userId,
      jobId: args.jobId,
      state: "failed",
      status: "failed",
      step: "job_failed",
      detail: {
        message: message.slice(0, 4_000),
      },
    });
  } finally {
    activeExecutions.delete(key);
  }
}
