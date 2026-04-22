CREATE TYPE "StaffSystemRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY');
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED', 'ARCHIVED');
CREATE TYPE "StaffOnboardingStatus" AS ENUM ('PENDING', 'READY', 'COMPLETED');
CREATE TYPE "StaffInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'CANCELED');
CREATE TYPE "AdminMetricBucket" AS ENUM ('MINUTE_5', 'HOURLY', 'DAILY');

CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffCode" VARCHAR(16) NOT NULL,
    "systemRole" "StaffSystemRole" NOT NULL DEFAULT 'MEMBER',
    "positionTitle" VARCHAR(120) NOT NULL DEFAULT 'Staff',
    "status" "StaffStatus" NOT NULL DEFAULT 'INVITED',
    "onboardingStatus" "StaffOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "invitedEmail" VARCHAR(191),
    "invitedByUserId" TEXT,
    "createdByUserId" TEXT,
    "notes" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "metadataJson" JSONB,
    "lastAdminLoginAt" TIMESTAMP(3),
    "lastAdminStepUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" VARCHAR(191) NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "systemRole" "StaffSystemRole" NOT NULL DEFAULT 'MEMBER',
    "positionTitle" VARCHAR(120) NOT NULL,
    "status" "StaffInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" TEXT,
    "invitedByStaffCode" VARCHAR(16),
    "inviteeUserId" TEXT,
    "acceptedStaffId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "message" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffSequence" (
    "key" VARCHAR(32) NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSequence_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorStaffId" TEXT,
    "actorUserId" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "actionLabel" VARCHAR(160) NOT NULL,
    "entityType" VARCHAR(64) NOT NULL,
    "entityId" VARCHAR(191),
    "entityLabel" VARCHAR(191),
    "severity" "AuditSeverity" NOT NULL DEFAULT 'info',
    "ip" VARCHAR(96),
    "userAgent" TEXT,
    "requestHost" VARCHAR(191),
    "sessionKey" VARCHAR(120),
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminEvent" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "actorStaffId" TEXT,
    "actorUserId" TEXT,
    "subjectUserId" TEXT,
    "accountId" TEXT,
    "projectId" INTEGER,
    "siteId" TEXT,
    "origin" TEXT,
    "sessionKey" VARCHAR(120),
    "planTier" VARCHAR(32),
    "environment" VARCHAR(40),
    "status" VARCHAR(40),
    "result" VARCHAR(40),
    "country" VARCHAR(8),
    "region" VARCHAR(80),
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminMetricRollup" (
    "id" TEXT NOT NULL,
    "metric" VARCHAR(80) NOT NULL,
    "bucket" "AdminMetricBucket" NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "scopeKey" VARCHAR(191) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "accountId" TEXT,
    "projectId" INTEGER,
    "siteId" TEXT,
    "origin" TEXT,
    "planTier" VARCHAR(32),
    "status" VARCHAR(40),
    "result" VARCHAR(40),
    "metaKey" VARCHAR(120),
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMetricRollup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");
CREATE UNIQUE INDEX "StaffProfile_staffCode_key" ON "StaffProfile"("staffCode");
CREATE INDEX "StaffProfile_systemRole_status_idx" ON "StaffProfile"("systemRole", "status");
CREATE INDEX "StaffProfile_status_createdAt_idx" ON "StaffProfile"("status", "createdAt");
CREATE INDEX "StaffProfile_invitedEmail_idx" ON "StaffProfile"("invitedEmail");
CREATE INDEX "StaffProfile_lastAdminLoginAt_idx" ON "StaffProfile"("lastAdminLoginAt");

CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");
CREATE INDEX "StaffInvite_normalizedEmail_status_idx" ON "StaffInvite"("normalizedEmail", "status");
CREATE INDEX "StaffInvite_status_expiresAt_idx" ON "StaffInvite"("status", "expiresAt");
CREATE INDEX "StaffInvite_inviteeUserId_status_idx" ON "StaffInvite"("inviteeUserId", "status");

CREATE INDEX "AdminAuditLog_actorStaffId_createdAt_idx" ON "AdminAuditLog"("actorStaffId", "createdAt");
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdminAuditLog_entityType_entityId_idx" ON "AdminAuditLog"("entityType", "entityId");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

CREATE INDEX "AdminEvent_name_createdAt_idx" ON "AdminEvent"("name", "createdAt");
CREATE INDEX "AdminEvent_accountId_createdAt_idx" ON "AdminEvent"("accountId", "createdAt");
CREATE INDEX "AdminEvent_projectId_createdAt_idx" ON "AdminEvent"("projectId", "createdAt");
CREATE INDEX "AdminEvent_siteId_createdAt_idx" ON "AdminEvent"("siteId", "createdAt");
CREATE INDEX "AdminEvent_actorStaffId_createdAt_idx" ON "AdminEvent"("actorStaffId", "createdAt");
CREATE INDEX "AdminEvent_subjectUserId_createdAt_idx" ON "AdminEvent"("subjectUserId", "createdAt");
CREATE INDEX "AdminEvent_sessionKey_createdAt_idx" ON "AdminEvent"("sessionKey", "createdAt");

CREATE UNIQUE INDEX "admin_metric_rollup_metric_bucket_scope" ON "AdminMetricRollup"("metric", "bucket", "bucketStart", "scopeKey");
CREATE INDEX "AdminMetricRollup_bucket_bucketStart_idx" ON "AdminMetricRollup"("bucket", "bucketStart");
CREATE INDEX "AdminMetricRollup_metric_bucket_bucketStart_idx" ON "AdminMetricRollup"("metric", "bucket", "bucketStart");
CREATE INDEX "AdminMetricRollup_accountId_bucket_bucketStart_idx" ON "AdminMetricRollup"("accountId", "bucket", "bucketStart");
CREATE INDEX "AdminMetricRollup_projectId_bucket_bucketStart_idx" ON "AdminMetricRollup"("projectId", "bucket", "bucketStart");
CREATE INDEX "AdminMetricRollup_siteId_bucket_bucketStart_idx" ON "AdminMetricRollup"("siteId", "bucket", "bucketStart");

ALTER TABLE "StaffProfile"
ADD CONSTRAINT "StaffProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
