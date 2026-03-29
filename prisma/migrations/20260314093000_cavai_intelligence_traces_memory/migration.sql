-- CavAi intelligence trace + memory persistence
-- Adds reasoning/tool/retry/model-selection/share artifacts and user memory controls.

CREATE TABLE "CavAiReasoningTrace" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "taskType" VARCHAR(64) NOT NULL,
  "actionClass" VARCHAR(64) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "model" VARCHAR(120) NOT NULL,
  "reasoningLevel" VARCHAR(24) NOT NULL,
  "researchMode" BOOLEAN NOT NULL DEFAULT false,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "showReasoningChip" BOOLEAN NOT NULL DEFAULT false,
  "repairAttempted" BOOLEAN NOT NULL DEFAULT false,
  "repairApplied" BOOLEAN NOT NULL DEFAULT false,
  "qualityJson" JSONB,
  "safeSummaryJson" JSONB,
  "contextSignalsJson" JSONB,
  "checksJson" JSONB,
  "answerPathJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiReasoningTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiToolCall" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "toolId" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "latencyMs" INTEGER,
  "inputJson" JSONB,
  "outputJson" JSONB,
  "errorCode" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiToolCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiRetryEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "requestId" VARCHAR(120) NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "taskType" VARCHAR(64),
  "sourceMessageId" VARCHAR(120),
  "sourceSessionId" VARCHAR(120),
  "model" VARCHAR(120),
  "reasoningLevel" VARCHAR(24),
  "researchMode" BOOLEAN NOT NULL DEFAULT false,
  "contextJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiRetryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiModelSelectionEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "requestId" VARCHAR(120) NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "taskType" VARCHAR(64),
  "actionClass" VARCHAR(64) NOT NULL,
  "planId" VARCHAR(32) NOT NULL,
  "requestedModel" VARCHAR(120),
  "resolvedModel" VARCHAR(120) NOT NULL,
  "providerId" VARCHAR(32) NOT NULL,
  "reasoningLevel" VARCHAR(24) NOT NULL,
  "manualSelection" BOOLEAN NOT NULL DEFAULT false,
  "fallbackReason" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiModelSelectionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiUserMemorySetting" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memoryEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CavAiUserMemorySetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiUserMemoryFact" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "factKey" VARCHAR(120) NOT NULL,
  "factValue" TEXT NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  "sourceSessionId" VARCHAR(120),
  "sourceMessageId" VARCHAR(120),
  "lastUsedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CavAiUserMemoryFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiUserMemoryEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" VARCHAR(32) NOT NULL,
  "factId" VARCHAR(120),
  "sessionId" VARCHAR(120),
  "requestId" VARCHAR(120),
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiUserMemoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiShareArtifact" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "mode" VARCHAR(24) NOT NULL,
  "targetIdentity" VARCHAR(200),
  "internalUrl" TEXT,
  "externalUrl" TEXT,
  "externalTokenHash" VARCHAR(64),
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CavAiShareArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CavAiReasoningTrace_accountId_requestId_idx" ON "CavAiReasoningTrace"("accountId", "requestId");
CREATE INDEX "CavAiReasoningTrace_accountId_sessionId_createdAt_idx" ON "CavAiReasoningTrace"("accountId", "sessionId", "createdAt");
CREATE INDEX "CavAiReasoningTrace_accountId_userId_createdAt_idx" ON "CavAiReasoningTrace"("accountId", "userId", "createdAt");

CREATE INDEX "CavAiToolCall_accountId_requestId_createdAt_idx" ON "CavAiToolCall"("accountId", "requestId", "createdAt");
CREATE INDEX "CavAiToolCall_accountId_sessionId_createdAt_idx" ON "CavAiToolCall"("accountId", "sessionId", "createdAt");
CREATE INDEX "CavAiToolCall_accountId_toolId_createdAt_idx" ON "CavAiToolCall"("accountId", "toolId", "createdAt");

CREATE INDEX "CavAiRetryEvent_accountId_sessionId_createdAt_idx" ON "CavAiRetryEvent"("accountId", "sessionId", "createdAt");
CREATE INDEX "CavAiRetryEvent_accountId_requestId_idx" ON "CavAiRetryEvent"("accountId", "requestId");
CREATE INDEX "CavAiRetryEvent_accountId_sourceMessageId_createdAt_idx" ON "CavAiRetryEvent"("accountId", "sourceMessageId", "createdAt");

CREATE INDEX "CavAiModelSelectionEvent_accountId_requestId_createdAt_idx" ON "CavAiModelSelectionEvent"("accountId", "requestId", "createdAt");
CREATE INDEX "CavAiModelSelectionEvent_accountId_sessionId_createdAt_idx" ON "CavAiModelSelectionEvent"("accountId", "sessionId", "createdAt");
CREATE INDEX "CavAiModelSelectionEvent_accountId_userId_createdAt_idx" ON "CavAiModelSelectionEvent"("accountId", "userId", "createdAt");

CREATE UNIQUE INDEX "CavAiUserMemorySetting_accountId_userId_key" ON "CavAiUserMemorySetting"("accountId", "userId");
CREATE INDEX "CavAiUserMemorySetting_accountId_userId_updatedAt_idx" ON "CavAiUserMemorySetting"("accountId", "userId", "updatedAt");

CREATE UNIQUE INDEX "CavAiUserMemoryFact_accountId_userId_factKey_key" ON "CavAiUserMemoryFact"("accountId", "userId", "factKey");
CREATE INDEX "CavAiUserMemoryFact_accountId_userId_category_updatedAt_idx" ON "CavAiUserMemoryFact"("accountId", "userId", "category", "updatedAt");
CREATE INDEX "CavAiUserMemoryFact_accountId_userId_lastUsedAt_idx" ON "CavAiUserMemoryFact"("accountId", "userId", "lastUsedAt");
CREATE INDEX "CavAiUserMemoryFact_accountId_userId_deletedAt_idx" ON "CavAiUserMemoryFact"("accountId", "userId", "deletedAt");

CREATE INDEX "CavAiUserMemoryEvent_accountId_userId_createdAt_idx" ON "CavAiUserMemoryEvent"("accountId", "userId", "createdAt");
CREATE INDEX "CavAiUserMemoryEvent_accountId_requestId_createdAt_idx" ON "CavAiUserMemoryEvent"("accountId", "requestId", "createdAt");
CREATE INDEX "CavAiUserMemoryEvent_accountId_factId_createdAt_idx" ON "CavAiUserMemoryEvent"("accountId", "factId", "createdAt");

CREATE INDEX "CavAiShareArtifact_accountId_sessionId_createdAt_idx" ON "CavAiShareArtifact"("accountId", "sessionId", "createdAt");
CREATE INDEX "CavAiShareArtifact_accountId_userId_createdAt_idx" ON "CavAiShareArtifact"("accountId", "userId", "createdAt");
CREATE INDEX "CavAiShareArtifact_accountId_externalTokenHash_idx" ON "CavAiShareArtifact"("accountId", "externalTokenHash");
CREATE INDEX "CavAiShareArtifact_accountId_revokedAt_idx" ON "CavAiShareArtifact"("accountId", "revokedAt");
