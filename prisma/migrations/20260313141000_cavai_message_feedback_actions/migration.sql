-- CavAi message-level feedback and action persistence (copy / reaction / share / retry)
CREATE TABLE "CavAiMessageFeedback" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reaction" VARCHAR(16),
    "copyCount" INTEGER NOT NULL DEFAULT 0,
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastCopiedAt" TIMESTAMP(3),
    "lastSharedAt" TIMESTAMP(3),
    "lastRetriedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CavAiMessageFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CavAiMessageFeedback_accountId_messageId_userId_key"
ON "CavAiMessageFeedback"("accountId", "messageId", "userId");

CREATE INDEX "CavAiMessageFeedback_accountId_sessionId_updatedAt_idx"
ON "CavAiMessageFeedback"("accountId", "sessionId", "updatedAt");

CREATE INDEX "CavAiMessageFeedback_accountId_messageId_updatedAt_idx"
ON "CavAiMessageFeedback"("accountId", "messageId", "updatedAt");

ALTER TABLE "CavAiMessageFeedback"
ADD CONSTRAINT "CavAiMessageFeedback_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "CavAiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavAiMessageFeedback"
ADD CONSTRAINT "CavAiMessageFeedback_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "CavAiMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
