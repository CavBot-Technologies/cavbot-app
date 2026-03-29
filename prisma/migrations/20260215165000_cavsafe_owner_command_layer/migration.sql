-- CavSafe owner command layer hardening:
-- - Premium+ file controls (integrity + timelock columns)
-- - Dedicated CavSafe operation log
-- - Snapshot archive metadata

-- AlterTable
ALTER TABLE "CavSafeFile"
  ADD COLUMN "immutableAt" TIMESTAMP(3),
  ADD COLUMN "unlockAt" TIMESTAMP(3),
  ADD COLUMN "expireAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "CavSafeOperationKind" AS ENUM (
  'CREATE_FOLDER',
  'UPLOAD_FILE',
  'MOVE',
  'RENAME',
  'DELETE',
  'RESTORE',
  'MOVE_IN',
  'MOVE_OUT',
  'PUBLISH_ARTIFACT',
  'ACCESS_ATTEMPT',
  'OPEN_DENIED',
  'SHARE_ATTEMPT',
  'IMMUTABLE_SET',
  'IMMUTABLE_CLEAR',
  'TIMELOCK_SET',
  'TIMELOCK_CLEAR',
  'SNAPSHOT_CREATED'
);

-- CreateTable
CREATE TABLE "CavSafeOperationLog" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "kind" "CavSafeOperationKind" NOT NULL,
  "subjectType" VARCHAR(32) NOT NULL,
  "subjectId" TEXT NOT NULL,
  "label" VARCHAR(220) NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeOperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeSnapshot" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "rootFolderId" TEXT,
  "archiveName" VARCHAR(220) NOT NULL,
  "archiveR2Key" TEXT NOT NULL,
  "archiveBytes" BIGINT NOT NULL DEFAULT 0,
  "sha256" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeProjectMount" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "projectId" INTEGER NOT NULL,
  "folderId" TEXT NOT NULL,
  "mountPath" VARCHAR(512) NOT NULL,
  "mode" "CavCloudMountMode" NOT NULL DEFAULT 'READ_ONLY',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavSafeProjectMount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CavSafeOperationLog_accountId_createdAt_idx"
  ON "CavSafeOperationLog"("accountId", "createdAt" DESC);

CREATE INDEX "CavSafeOperationLog_operatorUserId_createdAt_idx"
  ON "CavSafeOperationLog"("operatorUserId", "createdAt");

CREATE INDEX "CavSafeSnapshot_accountId_createdAt_idx"
  ON "CavSafeSnapshot"("accountId", "createdAt" DESC);

CREATE INDEX "CavSafeSnapshot_operatorUserId_createdAt_idx"
  ON "CavSafeSnapshot"("operatorUserId", "createdAt");

CREATE UNIQUE INDEX "CavSafeProjectMount_accountId_projectId_mountPath_key"
  ON "CavSafeProjectMount"("accountId", "projectId", "mountPath");

CREATE UNIQUE INDEX "CavSafeProjectMount_accountId_projectId_folderId_key"
  ON "CavSafeProjectMount"("accountId", "projectId", "folderId");

CREATE INDEX "CavSafeProjectMount_accountId_projectId_idx"
  ON "CavSafeProjectMount"("accountId", "projectId");

CREATE INDEX "CavSafeProjectMount_accountId_folderId_idx"
  ON "CavSafeProjectMount"("accountId", "folderId");

-- AddForeignKey
ALTER TABLE "CavSafeOperationLog"
  ADD CONSTRAINT "CavSafeOperationLog_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeOperationLog"
  ADD CONSTRAINT "CavSafeOperationLog_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeSnapshot"
  ADD CONSTRAINT "CavSafeSnapshot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeSnapshot"
  ADD CONSTRAINT "CavSafeSnapshot_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeProjectMount"
  ADD CONSTRAINT "CavSafeProjectMount_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeProjectMount"
  ADD CONSTRAINT "CavSafeProjectMount_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeProjectMount"
  ADD CONSTRAINT "CavSafeProjectMount_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
