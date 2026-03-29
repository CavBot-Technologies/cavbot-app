-- CavAi route manifest snapshots, website knowledge graph, and long-running agent jobs

CREATE TABLE "CavAiRouteManifestSnapshot" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" VARCHAR(120) NOT NULL,
  "source" VARCHAR(40) NOT NULL,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "manifestVersion" VARCHAR(40) NOT NULL,
  "routeCount" INTEGER NOT NULL DEFAULT 0,
  "coveredCount" INTEGER NOT NULL DEFAULT 0,
  "heuristicCount" INTEGER NOT NULL DEFAULT 0,
  "uncoveredCount" INTEGER NOT NULL DEFAULT 0,
  "adapterCoverageRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "manifestJson" JSONB NOT NULL,
  "coverageJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiRouteManifestSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiWebsiteKnowledgeGraph" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" VARCHAR(120),
  "source" VARCHAR(40) NOT NULL,
  "sourceRef" VARCHAR(180),
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "siteId" VARCHAR(120),
  "origin" TEXT,
  "graphVersion" VARCHAR(40) NOT NULL,
  "graphJson" JSONB NOT NULL,
  "signalJson" JSONB,
  "summaryJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiWebsiteKnowledgeGraph_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiAgentJob" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" VARCHAR(120),
  "requestId" VARCHAR(120),
  "surface" VARCHAR(32) NOT NULL,
  "jobType" VARCHAR(48) NOT NULL,
  "taskType" VARCHAR(64),
  "goal" TEXT NOT NULL,
  "state" VARCHAR(40) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "progressPct" INTEGER NOT NULL DEFAULT 0,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "siteId" VARCHAR(120),
  "origin" TEXT,
  "contextJson" JSONB,
  "resultJson" JSONB,
  "errorCode" VARCHAR(120),
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiAgentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiAgentJobEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "state" VARCHAR(40) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "step" VARCHAR(120) NOT NULL,
  "detailJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiAgentJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CavAiRouteManifestSnapshot_accountId_createdAt_idx" ON "CavAiRouteManifestSnapshot"("accountId", "createdAt");
CREATE INDEX "CavAiRouteManifestSnapshot_accountId_requestId_idx" ON "CavAiRouteManifestSnapshot"("accountId", "requestId");
CREATE INDEX "CavAiRouteManifestSnapshot_accountId_projectId_createdAt_idx" ON "CavAiRouteManifestSnapshot"("accountId", "projectId", "createdAt");
CREATE INDEX "CavAiRouteManifestSnapshot_accountId_workspaceId_createdAt_idx" ON "CavAiRouteManifestSnapshot"("accountId", "workspaceId", "createdAt");

CREATE INDEX "CavAiWebsiteKnowledgeGraph_accountId_createdAt_idx" ON "CavAiWebsiteKnowledgeGraph"("accountId", "createdAt");
CREATE INDEX "CavAiWebsiteKnowledgeGraph_accountId_projectId_createdAt_idx" ON "CavAiWebsiteKnowledgeGraph"("accountId", "projectId", "createdAt");
CREATE INDEX "CavAiWebsiteKnowledgeGraph_accountId_workspaceId_createdAt_idx" ON "CavAiWebsiteKnowledgeGraph"("accountId", "workspaceId", "createdAt");
CREATE INDEX "CavAiWebsiteKnowledgeGraph_accountId_siteId_createdAt_idx" ON "CavAiWebsiteKnowledgeGraph"("accountId", "siteId", "createdAt");

CREATE INDEX "CavAiAgentJob_accountId_createdAt_idx" ON "CavAiAgentJob"("accountId", "createdAt");
CREATE INDEX "CavAiAgentJob_accountId_status_createdAt_idx" ON "CavAiAgentJob"("accountId", "status", "createdAt");
CREATE INDEX "CavAiAgentJob_accountId_state_createdAt_idx" ON "CavAiAgentJob"("accountId", "state", "createdAt");
CREATE INDEX "CavAiAgentJob_accountId_requestId_createdAt_idx" ON "CavAiAgentJob"("accountId", "requestId", "createdAt");
CREATE INDEX "CavAiAgentJob_accountId_projectId_createdAt_idx" ON "CavAiAgentJob"("accountId", "projectId", "createdAt");
CREATE INDEX "CavAiAgentJob_accountId_workspaceId_createdAt_idx" ON "CavAiAgentJob"("accountId", "workspaceId", "createdAt");

CREATE INDEX "CavAiAgentJobEvent_accountId_jobId_createdAt_idx" ON "CavAiAgentJobEvent"("accountId", "jobId", "createdAt");
CREATE INDEX "CavAiAgentJobEvent_accountId_state_createdAt_idx" ON "CavAiAgentJobEvent"("accountId", "state", "createdAt");
CREATE INDEX "CavAiAgentJobEvent_accountId_status_createdAt_idx" ON "CavAiAgentJobEvent"("accountId", "status", "createdAt");

ALTER TABLE "CavAiAgentJobEvent"
  ADD CONSTRAINT "CavAiAgentJobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "CavAiAgentJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
