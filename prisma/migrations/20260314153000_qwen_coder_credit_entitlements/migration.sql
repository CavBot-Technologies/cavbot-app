-- Qwen coder credit entitlement system
CREATE TABLE "coder_credit_wallets" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planTier" VARCHAR(32) NOT NULL,
  "billingCycleStart" TIMESTAMP(3) NOT NULL,
  "billingCycleEnd" TIMESTAMP(3) NOT NULL,
  "monthlyAllocation" INTEGER NOT NULL DEFAULT 0,
  "rolloverAllocation" INTEGER NOT NULL DEFAULT 0,
  "totalAvailable" INTEGER NOT NULL DEFAULT 0,
  "totalUsed" INTEGER NOT NULL DEFAULT 0,
  "totalRemaining" INTEGER NOT NULL DEFAULT 0,
  "stagedModeEnabled" BOOLEAN NOT NULL DEFAULT false,
  "stage1Allocation" INTEGER NOT NULL DEFAULT 0,
  "stage1Used" INTEGER NOT NULL DEFAULT 0,
  "stage1ExhaustedAt" TIMESTAMP(3),
  "cooldownEndsAt" TIMESTAMP(3),
  "stage2Allocation" INTEGER NOT NULL DEFAULT 0,
  "stage2Used" INTEGER NOT NULL DEFAULT 0,
  "exhaustedAt" TIMESTAMP(3),
  "resetSource" VARCHAR(64),
  "lastRecomputedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coder_credit_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coder_credit_ledger" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" VARCHAR(120),
  "taskId" VARCHAR(120),
  "requestId" VARCHAR(120) NOT NULL,
  "modelName" VARCHAR(120) NOT NULL,
  "rawInputTokens" INTEGER NOT NULL DEFAULT 0,
  "rawContextTokens" INTEGER NOT NULL DEFAULT 0,
  "rawOutputTokens" INTEGER NOT NULL DEFAULT 0,
  "compactionTokens" INTEGER NOT NULL DEFAULT 0,
  "runtimeSeconds" INTEGER NOT NULL DEFAULT 0,
  "estimatedCredits" INTEGER NOT NULL DEFAULT 0,
  "creditsCharged" INTEGER NOT NULL DEFAULT 0,
  "chargeReason" VARCHAR(64) NOT NULL,
  "chargeState" VARCHAR(24) NOT NULL,
  "reservedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coder_credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coder_usage_snapshots" (
  "id" TEXT NOT NULL,
  "walletId" TEXT,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "billingCycleStart" TIMESTAMP(3) NOT NULL,
  "percentUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "percentRemaining" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "estimatedTasksLeft" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coder_usage_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coder_plan_events" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "oldPlan" VARCHAR(32),
  "newPlan" VARCHAR(32) NOT NULL,
  "eventType" VARCHAR(40) NOT NULL,
  "eventSource" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coder_plan_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coder_context_snapshots" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" VARCHAR(120),
  "conversationId" VARCHAR(120),
  "activeModel" VARCHAR(120) NOT NULL,
  "currentContextTokens" INTEGER NOT NULL DEFAULT 0,
  "maxContextTokens" INTEGER NOT NULL DEFAULT 0,
  "percentFull" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "compactionCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "coder_context_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coder_wallet_cycle_unique" ON "coder_credit_wallets"("accountId", "userId", "billingCycleStart", "billingCycleEnd");
CREATE INDEX "coder_credit_wallets_accountId_userId_createdAt_idx" ON "coder_credit_wallets"("accountId", "userId", "createdAt");
CREATE INDEX "coder_credit_wallets_accountId_userId_billingCycleStart_billingCycleEnd_idx" ON "coder_credit_wallets"("accountId", "userId", "billingCycleStart", "billingCycleEnd");
CREATE INDEX "coder_credit_wallets_accountId_billingCycleStart_billingCycleEnd_idx" ON "coder_credit_wallets"("accountId", "billingCycleStart", "billingCycleEnd");

CREATE UNIQUE INDEX "coder_ledger_request_unique" ON "coder_credit_ledger"("accountId", "userId", "requestId");
CREATE INDEX "coder_credit_ledger_walletId_createdAt_idx" ON "coder_credit_ledger"("walletId", "createdAt");
CREATE INDEX "coder_credit_ledger_accountId_userId_createdAt_idx" ON "coder_credit_ledger"("accountId", "userId", "createdAt");
CREATE INDEX "coder_credit_ledger_accountId_requestId_createdAt_idx" ON "coder_credit_ledger"("accountId", "requestId", "createdAt");
CREATE INDEX "coder_credit_ledger_accountId_chargeState_createdAt_idx" ON "coder_credit_ledger"("accountId", "chargeState", "createdAt");

CREATE UNIQUE INDEX "coder_usage_snapshot_cycle_unique" ON "coder_usage_snapshots"("accountId", "userId", "billingCycleStart");
CREATE INDEX "coder_usage_snapshots_accountId_userId_updatedAt_idx" ON "coder_usage_snapshots"("accountId", "userId", "updatedAt");
CREATE INDEX "coder_usage_snapshots_walletId_updatedAt_idx" ON "coder_usage_snapshots"("walletId", "updatedAt");

CREATE INDEX "coder_plan_events_accountId_userId_createdAt_idx" ON "coder_plan_events"("accountId", "userId", "createdAt");
CREATE INDEX "coder_plan_events_accountId_eventType_createdAt_idx" ON "coder_plan_events"("accountId", "eventType", "createdAt");

CREATE INDEX "coder_context_snapshots_accountId_userId_sessionId_createdAt_idx" ON "coder_context_snapshots"("accountId", "userId", "sessionId", "createdAt");
CREATE INDEX "coder_context_snapshots_accountId_userId_createdAt_idx" ON "coder_context_snapshots"("accountId", "userId", "createdAt");

ALTER TABLE "coder_credit_wallets"
  ADD CONSTRAINT "coder_credit_wallets_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_credit_wallets"
  ADD CONSTRAINT "coder_credit_wallets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_credit_ledger"
  ADD CONSTRAINT "coder_credit_ledger_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "coder_credit_wallets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_credit_ledger"
  ADD CONSTRAINT "coder_credit_ledger_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_credit_ledger"
  ADD CONSTRAINT "coder_credit_ledger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_usage_snapshots"
  ADD CONSTRAINT "coder_usage_snapshots_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "coder_credit_wallets"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "coder_usage_snapshots"
  ADD CONSTRAINT "coder_usage_snapshots_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_usage_snapshots"
  ADD CONSTRAINT "coder_usage_snapshots_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_plan_events"
  ADD CONSTRAINT "coder_plan_events_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_plan_events"
  ADD CONSTRAINT "coder_plan_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_context_snapshots"
  ADD CONSTRAINT "coder_context_snapshots_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "coder_context_snapshots"
  ADD CONSTRAINT "coder_context_snapshots_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
