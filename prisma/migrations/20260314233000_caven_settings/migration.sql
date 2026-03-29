-- Caven workspace settings (DB-backed, per account + user)

CREATE TABLE "CavenSettings" (
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "queueFollowUps" BOOLEAN NOT NULL DEFAULT true,
  "composerEnterBehavior" VARCHAR(24) NOT NULL DEFAULT 'enter',
  "includeIdeContext" BOOLEAN NOT NULL DEFAULT true,
  "confirmBeforeApplyPatch" BOOLEAN NOT NULL DEFAULT true,
  "autoOpenResolvedFiles" BOOLEAN NOT NULL DEFAULT true,
  "showReasoningTimeline" BOOLEAN NOT NULL DEFAULT true,
  "telemetryOptIn" BOOLEAN NOT NULL DEFAULT true,
  "defaultReasoningLevel" VARCHAR(24) NOT NULL DEFAULT 'medium',
  "asrAudioSkillEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavenSettings_pkey" PRIMARY KEY ("accountId", "userId")
);

CREATE INDEX "CavenSettings_userId_idx" ON "CavenSettings"("userId");
