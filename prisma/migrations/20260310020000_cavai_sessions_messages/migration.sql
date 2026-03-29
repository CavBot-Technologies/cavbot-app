-- CavAi session/message persistence
-- Server-authoritative cross-device memory for CavAi Center + CavAi Code.

CREATE TABLE "CavAiSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "surface" VARCHAR(32) NOT NULL,
  "title" VARCHAR(220) NOT NULL,
  "contextLabel" VARCHAR(220),
  "contextJson" JSONB,
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageAt" TIMESTAMP(3),

  CONSTRAINT "CavAiSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavAiMessage" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "action" VARCHAR(120),
  "contentText" TEXT NOT NULL,
  "contentJson" JSONB,
  "provider" VARCHAR(32),
  "model" VARCHAR(120),
  "requestId" VARCHAR(120),
  "status" VARCHAR(24),
  "errorCode" VARCHAR(120),
  "workspaceId" VARCHAR(160),
  "projectId" INTEGER,
  "origin" TEXT,
  "createdByUser" VARCHAR(160),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavAiMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CavAiSession_accountId_userId_createdAt_idx"
ON "CavAiSession"("accountId", "userId", "createdAt");

CREATE INDEX "CavAiSession_accountId_surface_updatedAt_idx"
ON "CavAiSession"("accountId", "surface", "updatedAt");

CREATE INDEX "CavAiSession_accountId_workspaceId_updatedAt_idx"
ON "CavAiSession"("accountId", "workspaceId", "updatedAt");

CREATE INDEX "CavAiSession_accountId_projectId_updatedAt_idx"
ON "CavAiSession"("accountId", "projectId", "updatedAt");

CREATE INDEX "CavAiMessage_accountId_sessionId_createdAt_idx"
ON "CavAiMessage"("accountId", "sessionId", "createdAt");

CREATE INDEX "CavAiMessage_accountId_requestId_idx"
ON "CavAiMessage"("accountId", "requestId");

CREATE INDEX "CavAiMessage_accountId_role_createdAt_idx"
ON "CavAiMessage"("accountId", "role", "createdAt");

ALTER TABLE "CavAiMessage"
ADD CONSTRAINT "CavAiMessage_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "CavAiSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
