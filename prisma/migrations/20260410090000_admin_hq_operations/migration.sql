DO $$ BEGIN
  CREATE TYPE "AdminDisciplineStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminBillingAdjustmentKind" AS ENUM ('CREDIT', 'COMP', 'TRIAL_EXTENSION', 'PLAN_OVERRIDE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminCaseQueue" AS ENUM ('BILLING_OPS', 'TRUST_AND_SAFETY', 'CUSTOMER_SUCCESS', 'BROADCASTS', 'APPROVALS', 'FOUNDER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PENDING_EXTERNAL', 'RESOLVED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminCasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminBroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminChatBoxKind" AS ENUM ('ORG', 'DIRECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminChatThreadStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminChatParticipantRole" AS ENUM ('MEMBER', 'OWNER', 'OBSERVER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminChatMessageKind" AS ENUM ('MESSAGE', 'SYSTEM', 'BROADCAST');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AdminChatBodyStorage" AS ENUM ('INLINE', 'R2');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminAccountDiscipline" (
  "accountId" TEXT NOT NULL,
  "status" "AdminDisciplineStatus" NOT NULL DEFAULT 'ACTIVE',
  "violationCount" INTEGER NOT NULL DEFAULT 0,
  "suspendedUntil" TIMESTAMP(3),
  "suspendedAt" TIMESTAMP(3),
  "suspendedByStaffId" TEXT,
  "suspensionDays" INTEGER,
  "revokedAt" TIMESTAMP(3),
  "revokedByStaffId" TEXT,
  "note" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAccountDiscipline_pkey" PRIMARY KEY ("accountId")
);

CREATE TABLE IF NOT EXISTS "AdminUserDiscipline" (
  "userId" TEXT NOT NULL,
  "status" "AdminDisciplineStatus" NOT NULL DEFAULT 'ACTIVE',
  "violationCount" INTEGER NOT NULL DEFAULT 0,
  "suspendedUntil" TIMESTAMP(3),
  "suspendedAt" TIMESTAMP(3),
  "suspendedByStaffId" TEXT,
  "suspensionDays" INTEGER,
  "revokedAt" TIMESTAMP(3),
  "revokedByStaffId" TEXT,
  "lastRecoveryResetAt" TIMESTAMP(3),
  "lastRecoveryResetByStaffId" TEXT,
  "lastSessionKillAt" TIMESTAMP(3),
  "lastSessionKillByStaffId" TEXT,
  "lastIdentityReviewAt" TIMESTAMP(3),
  "lastIdentityReviewById" TEXT,
  "note" TEXT,
  "metadataJson" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminUserDiscipline_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "AdminEntityNote" (
  "id" TEXT NOT NULL,
  "entityType" VARCHAR(40) NOT NULL,
  "entityId" VARCHAR(191) NOT NULL,
  "authorStaffId" TEXT,
  "authorUserId" TEXT,
  "customerVisibleNote" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "caseId" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminEntityNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminBillingAdjustment" (
  "id" TEXT NOT NULL,
  "accountId" VARCHAR(191) NOT NULL,
  "userId" VARCHAR(191),
  "kind" "AdminBillingAdjustmentKind" NOT NULL,
  "amountCents" INTEGER,
  "currency" VARCHAR(12) NOT NULL DEFAULT 'USD',
  "reason" VARCHAR(160) NOT NULL,
  "note" TEXT,
  "createdByStaffId" TEXT,
  "createdByUserId" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminBillingAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminCase" (
  "id" TEXT NOT NULL,
  "caseCode" VARCHAR(24) NOT NULL,
  "queue" "AdminCaseQueue" NOT NULL,
  "status" "AdminCaseStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "AdminCasePriority" NOT NULL DEFAULT 'MEDIUM',
  "sourceKey" VARCHAR(191),
  "subject" VARCHAR(180) NOT NULL,
  "description" TEXT,
  "accountId" VARCHAR(191),
  "userId" VARCHAR(191),
  "linkedThreadId" VARCHAR(191),
  "linkedCampaignId" VARCHAR(191),
  "assigneeStaffId" TEXT,
  "assigneeUserId" TEXT,
  "slaDueAt" TIMESTAMP(3),
  "customerNotifiedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "metaJson" JSONB,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminCaseNote" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "authorStaffId" TEXT,
  "authorUserId" TEXT,
  "customerVisibleNote" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminCaseNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminBroadcastCampaignV2" (
  "id" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" TEXT NOT NULL,
  "status" "AdminBroadcastStatus" NOT NULL DEFAULT 'DRAFT',
  "audienceType" VARCHAR(40) NOT NULL,
  "targetDepartments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetAccountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ctaLabel" VARCHAR(80),
  "ctaHref" TEXT,
  "dismissalPolicy" VARCHAR(80),
  "dismissAt" TIMESTAMP(3),
  "scheduledFor" TIMESTAMP(3),
  "deliveryWindowStart" TIMESTAMP(3),
  "deliveryWindowEnd" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdByStaffId" TEXT,
  "createdByUserId" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminBroadcastCampaignV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminBroadcastDeliveryV2" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "recipientUserId" VARCHAR(191) NOT NULL,
  "recipientAccountId" VARCHAR(191),
  "channel" VARCHAR(24) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "notificationId" VARCHAR(191),
  "threadId" VARCHAR(191),
  "messageId" VARCHAR(191),
  "errorMessage" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminBroadcastDeliveryV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatBox" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "kind" "AdminChatBoxKind" NOT NULL DEFAULT 'ORG',
  "allowedDepartments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "oversightDepartments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminChatBox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatThread" (
  "id" TEXT NOT NULL,
  "boxId" TEXT,
  "directKey" VARCHAR(191),
  "subject" VARCHAR(180) NOT NULL,
  "status" "AdminChatThreadStatus" NOT NULL DEFAULT 'ACTIVE',
  "isDirect" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdByStaffId" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminChatThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatParticipant" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" VARCHAR(191) NOT NULL,
  "staffId" TEXT,
  "role" "AdminChatParticipantRole" NOT NULL DEFAULT 'MEMBER',
  "lastReadMessageId" VARCHAR(191),
  "readAt" TIMESTAMP(3),
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "isMuted" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminChatParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatMessage" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "senderUserId" VARCHAR(191) NOT NULL,
  "senderStaffId" TEXT,
  "kind" "AdminChatMessageKind" NOT NULL DEFAULT 'MESSAGE',
  "bodyStorage" "AdminChatBodyStorage" NOT NULL DEFAULT 'INLINE',
  "previewText" VARCHAR(320),
  "searchText" TEXT,
  "bodyText" TEXT,
  "bodyR2Key" VARCHAR(191),
  "broadcastCampaignId" VARCHAR(191),
  "caseId" VARCHAR(191),
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "AdminChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatAttachment" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "uploadedByUserId" VARCHAR(191),
  "fileName" VARCHAR(191) NOT NULL,
  "contentType" VARCHAR(120) NOT NULL,
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  "objectKey" VARCHAR(191) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminChatAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminChatDraft" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "userId" VARCHAR(191) NOT NULL,
  "body" TEXT,
  "attachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminChatDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUserDiscipline_userId_key" ON "AdminUserDiscipline"("userId");
CREATE INDEX IF NOT EXISTS "AdminUserDiscipline_status_updatedAt_idx" ON "AdminUserDiscipline"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminUserDiscipline_suspendedUntil_idx" ON "AdminUserDiscipline"("suspendedUntil");

CREATE INDEX IF NOT EXISTS "AdminAccountDiscipline_status_updatedAt_idx" ON "AdminAccountDiscipline"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminAccountDiscipline_suspendedUntil_idx" ON "AdminAccountDiscipline"("suspendedUntil");

CREATE INDEX IF NOT EXISTS "AdminEntityNote_entityType_entityId_createdAt_idx" ON "AdminEntityNote"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminEntityNote_caseId_createdAt_idx" ON "AdminEntityNote"("caseId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminEntityNote_authorStaffId_createdAt_idx" ON "AdminEntityNote"("authorStaffId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminBillingAdjustment_accountId_createdAt_idx" ON "AdminBillingAdjustment"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminBillingAdjustment_userId_createdAt_idx" ON "AdminBillingAdjustment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminBillingAdjustment_kind_createdAt_idx" ON "AdminBillingAdjustment"("kind", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminCase_caseCode_key" ON "AdminCase"("caseCode");
CREATE UNIQUE INDEX IF NOT EXISTS "AdminCase_sourceKey_key" ON "AdminCase"("sourceKey");
CREATE INDEX IF NOT EXISTS "AdminCase_queue_status_priority_idx" ON "AdminCase"("queue", "status", "priority");
CREATE INDEX IF NOT EXISTS "AdminCase_assigneeStaffId_status_updatedAt_idx" ON "AdminCase"("assigneeStaffId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminCase_accountId_status_updatedAt_idx" ON "AdminCase"("accountId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminCase_userId_status_updatedAt_idx" ON "AdminCase"("userId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminCase_slaDueAt_status_idx" ON "AdminCase"("slaDueAt", "status");

CREATE INDEX IF NOT EXISTS "AdminCaseNote_caseId_createdAt_idx" ON "AdminCaseNote"("caseId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminCaseNote_authorStaffId_createdAt_idx" ON "AdminCaseNote"("authorStaffId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminBroadcastCampaignV2_status_scheduledFor_idx" ON "AdminBroadcastCampaignV2"("status", "scheduledFor");
CREATE INDEX IF NOT EXISTS "AdminBroadcastCampaignV2_createdByStaffId_createdAt_idx" ON "AdminBroadcastCampaignV2"("createdByStaffId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminBroadcastCampaignV2_audienceType_createdAt_idx" ON "AdminBroadcastCampaignV2"("audienceType", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminBroadcastDeliveryV2_campaignId_recipientUserId_channel_key" ON "AdminBroadcastDeliveryV2"("campaignId", "recipientUserId", "channel");
CREATE INDEX IF NOT EXISTS "AdminBroadcastDeliveryV2_recipientUserId_status_createdAt_idx" ON "AdminBroadcastDeliveryV2"("recipientUserId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminBroadcastDeliveryV2_status_createdAt_idx" ON "AdminBroadcastDeliveryV2"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminChatBox_slug_key" ON "AdminChatBox"("slug");
CREATE INDEX IF NOT EXISTS "AdminChatBox_kind_createdAt_idx" ON "AdminChatBox"("kind", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminChatThread_directKey_key" ON "AdminChatThread"("directKey");
CREATE INDEX IF NOT EXISTS "AdminChatThread_boxId_updatedAt_idx" ON "AdminChatThread"("boxId", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminChatThread_isDirect_updatedAt_idx" ON "AdminChatThread"("isDirect", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminChatThread_status_lastMessageAt_idx" ON "AdminChatThread"("status", "lastMessageAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminChatParticipant_threadId_userId_key" ON "AdminChatParticipant"("threadId", "userId");
CREATE INDEX IF NOT EXISTS "AdminChatParticipant_userId_isArchived_updatedAt_idx" ON "AdminChatParticipant"("userId", "isArchived", "updatedAt");
CREATE INDEX IF NOT EXISTS "AdminChatParticipant_threadId_updatedAt_idx" ON "AdminChatParticipant"("threadId", "updatedAt");

CREATE INDEX IF NOT EXISTS "AdminChatMessage_threadId_createdAt_idx" ON "AdminChatMessage"("threadId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminChatMessage_senderUserId_createdAt_idx" ON "AdminChatMessage"("senderUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminChatAttachment_messageId_createdAt_idx" ON "AdminChatAttachment"("messageId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "AdminChatDraft_threadId_userId_key" ON "AdminChatDraft"("threadId", "userId");
CREATE INDEX IF NOT EXISTS "AdminChatDraft_userId_updatedAt_idx" ON "AdminChatDraft"("userId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "AdminCaseNote"
    ADD CONSTRAINT "AdminCaseNote_caseId_fkey"
    FOREIGN KEY ("caseId") REFERENCES "AdminCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminBroadcastDeliveryV2"
    ADD CONSTRAINT "AdminBroadcastDeliveryV2_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "AdminBroadcastCampaignV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminChatThread"
    ADD CONSTRAINT "AdminChatThread_boxId_fkey"
    FOREIGN KEY ("boxId") REFERENCES "AdminChatBox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminChatParticipant"
    ADD CONSTRAINT "AdminChatParticipant_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "AdminChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminChatMessage"
    ADD CONSTRAINT "AdminChatMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "AdminChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminChatAttachment"
    ADD CONSTRAINT "AdminChatAttachment_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "AdminChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AdminChatDraft"
    ADD CONSTRAINT "AdminChatDraft_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "AdminChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
