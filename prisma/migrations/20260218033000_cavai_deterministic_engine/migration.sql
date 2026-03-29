-- CavAi deterministic engine persistence (tenant-scoped)

CREATE TABLE "CavAiRun" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pagesScanned" INTEGER NOT NULL,
  "pageLimit" INTEGER NOT NULL,
  "pagesSelectedJson" JSONB NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL,
  "engineVersion" VARCHAR(64) NOT NULL,
  "packVersion" VARCHAR(64) NOT NULL,

  CONSTRAINT "CavAiRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiFinding" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "pillar" VARCHAR(24) NOT NULL,
  "severity" VARCHAR(16) NOT NULL,
  "pagePath" TEXT NOT NULL,
  "templateHint" VARCHAR(160),
  "evidenceJson" JSONB NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiInsightPack" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "packJson" JSONB NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "engineVersion" VARCHAR(64) NOT NULL,
  "packVersion" VARCHAR(64) NOT NULL,
  "overlayIncluded" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "CavAiInsightPack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CavAiRun_accountId_origin_createdAt_idx"
ON "CavAiRun"("accountId", "origin", "createdAt");

CREATE INDEX "CavAiRun_accountId_origin_inputHash_createdAt_idx"
ON "CavAiRun"("accountId", "origin", "inputHash", "createdAt");

CREATE INDEX "CavAiFinding_accountId_runId_idx"
ON "CavAiFinding"("accountId", "runId");

CREATE INDEX "CavAiFinding_accountId_code_idx"
ON "CavAiFinding"("accountId", "code");

CREATE INDEX "CavAiFinding_accountId_detectedAt_idx"
ON "CavAiFinding"("accountId", "detectedAt");

CREATE INDEX "CavAiInsightPack_accountId_generatedAt_idx"
ON "CavAiInsightPack"("accountId", "generatedAt");

CREATE UNIQUE INDEX "CavAiInsightPack_accountId_runId_key"
ON "CavAiInsightPack"("accountId", "runId");

CREATE UNIQUE INDEX "CavAiInsightPack_runId_key"
ON "CavAiInsightPack"("runId");

ALTER TABLE "CavAiFinding"
ADD CONSTRAINT "CavAiFinding_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CavAiRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavAiInsightPack"
ADD CONSTRAINT "CavAiInsightPack_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "CavAiRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
