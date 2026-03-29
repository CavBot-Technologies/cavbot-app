-- CavAi AI-service foundation persistence
-- Adds narration, fix-plan, and usage-log models for server-authoritative AI history.

CREATE TABLE "CavAiNarration" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "runId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "narrationJson" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiNarration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiFixPlan" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "runId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "priorityCode" VARCHAR(120) NOT NULL,
  "source" VARCHAR(24) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "planJson" JSONB NOT NULL,
  "verificationJson" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiFixPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiUsageLog" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "inputChars" INTEGER NOT NULL DEFAULT 0,
  "outputChars" INTEGER NOT NULL DEFAULT 0,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "latencyMs" INTEGER,
  "status" VARCHAR(24) NOT NULL,
  "errorCode" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CavAiNarration_accountId_createdAt_idx"
ON "CavAiNarration"("accountId", "createdAt");

CREATE INDEX "CavAiNarration_accountId_runId_idx"
ON "CavAiNarration"("accountId", "runId");

CREATE INDEX "CavAiNarration_accountId_requestId_idx"
ON "CavAiNarration"("accountId", "requestId");

CREATE INDEX "CavAiFixPlan_accountId_createdAt_idx"
ON "CavAiFixPlan"("accountId", "createdAt");

CREATE INDEX "CavAiFixPlan_accountId_runId_idx"
ON "CavAiFixPlan"("accountId", "runId");

CREATE INDEX "CavAiFixPlan_accountId_requestId_idx"
ON "CavAiFixPlan"("accountId", "requestId");

CREATE INDEX "CavAiFixPlan_accountId_priorityCode_createdAt_idx"
ON "CavAiFixPlan"("accountId", "priorityCode", "createdAt");

CREATE INDEX "CavAiUsageLog_accountId_createdAt_idx"
ON "CavAiUsageLog"("accountId", "createdAt");

CREATE INDEX "CavAiUsageLog_accountId_runId_idx"
ON "CavAiUsageLog"("accountId", "runId");

CREATE INDEX "CavAiUsageLog_accountId_requestId_idx"
ON "CavAiUsageLog"("accountId", "requestId");

CREATE INDEX "CavAiUsageLog_accountId_surface_action_createdAt_idx"
ON "CavAiUsageLog"("accountId", "surface", "action", "createdAt");

ALTER TABLE "CavAiNarration"
ADD CONSTRAINT "CavAiNarration_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CavAiRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavAiFixPlan"
ADD CONSTRAINT "CavAiFixPlan_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CavAiRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavAiUsageLog"
ADD CONSTRAINT "CavAiUsageLog_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CavAiRun"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
