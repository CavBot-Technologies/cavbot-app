-- CavCloud cloud-native storage foundation
-- - Server-authoritative folders/files with soft-delete + trash lifecycle
-- - Quota/materialized usage table
-- - Server activity log
-- - Multipart upload session + part tracking

-- CreateEnum
CREATE TYPE "CavCloudMultipartStatus" AS ENUM ('CREATED', 'COMPLETED', 'ABORTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "CavCloudFolder" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" VARCHAR(220) NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CavCloudFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudFile" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "name" VARCHAR(220) NOT NULL,
  "path" TEXT NOT NULL,
  "r2Key" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "mimeType" VARCHAR(200) NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CavCloudFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudTrash" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgeAfter" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudTrash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudQuota" (
  "accountId" TEXT NOT NULL,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudQuota_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "CavCloudStorageShare" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "mode" "CavCloudShareMode" NOT NULL DEFAULT 'READ_ONLY',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "CavCloudStorageShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudActivity" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "action" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(32) NOT NULL,
  "targetId" TEXT,
  "targetPath" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudMultipartUpload" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "fileName" VARCHAR(220) NOT NULL,
  "filePath" TEXT NOT NULL,
  "mimeType" VARCHAR(200) NOT NULL,
  "r2Key" TEXT NOT NULL,
  "r2UploadId" VARCHAR(200) NOT NULL,
  "expectedBytes" BIGINT,
  "partSizeBytes" INTEGER NOT NULL DEFAULT 5242880,
  "status" "CavCloudMultipartStatus" NOT NULL DEFAULT 'CREATED',
  "createdByUserId" TEXT NOT NULL,
  "completedFileId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudMultipartUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavCloudMultipartPart" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "etag" VARCHAR(200) NOT NULL,
  "bytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudMultipartPart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CavCloudFolder_accountId_path_key" ON "CavCloudFolder"("accountId", "path");
CREATE INDEX "CavCloudFolder_accountId_parentId_idx" ON "CavCloudFolder"("accountId", "parentId");
CREATE INDEX "CavCloudFolder_accountId_deletedAt_idx" ON "CavCloudFolder"("accountId", "deletedAt");
CREATE INDEX "CavCloudFolder_accountId_path_idx" ON "CavCloudFolder"("accountId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "CavCloudFile_accountId_path_key" ON "CavCloudFile"("accountId", "path");
CREATE INDEX "CavCloudFile_accountId_folderId_idx" ON "CavCloudFile"("accountId", "folderId");
CREATE INDEX "CavCloudFile_accountId_deletedAt_idx" ON "CavCloudFile"("accountId", "deletedAt");
CREATE INDEX "CavCloudFile_accountId_path_idx" ON "CavCloudFile"("accountId", "path");

-- CreateIndex
CREATE INDEX "CavCloudTrash_accountId_purgeAfter_idx" ON "CavCloudTrash"("accountId", "purgeAfter");
CREATE INDEX "CavCloudTrash_accountId_deletedAt_idx" ON "CavCloudTrash"("accountId", "deletedAt");
CREATE INDEX "CavCloudTrash_fileId_idx" ON "CavCloudTrash"("fileId");
CREATE INDEX "CavCloudTrash_folderId_idx" ON "CavCloudTrash"("folderId");

-- CreateIndex
CREATE INDEX "CavCloudStorageShare_accountId_idx" ON "CavCloudStorageShare"("accountId");
CREATE INDEX "CavCloudStorageShare_fileId_idx" ON "CavCloudStorageShare"("fileId");
CREATE INDEX "CavCloudStorageShare_folderId_idx" ON "CavCloudStorageShare"("folderId");
CREATE INDEX "CavCloudStorageShare_createdByUserId_idx" ON "CavCloudStorageShare"("createdByUserId");
CREATE INDEX "CavCloudStorageShare_expiresAt_idx" ON "CavCloudStorageShare"("expiresAt");
CREATE INDEX "CavCloudStorageShare_revokedAt_idx" ON "CavCloudStorageShare"("revokedAt");

-- CreateIndex
CREATE INDEX "CavCloudActivity_accountId_createdAt_idx" ON "CavCloudActivity"("accountId", "createdAt");
CREATE INDEX "CavCloudActivity_accountId_action_idx" ON "CavCloudActivity"("accountId", "action");
CREATE INDEX "CavCloudActivity_operatorUserId_createdAt_idx" ON "CavCloudActivity"("operatorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CavCloudMultipartUpload_accountId_status_createdAt_idx" ON "CavCloudMultipartUpload"("accountId", "status", "createdAt");
CREATE INDEX "CavCloudMultipartUpload_folderId_idx" ON "CavCloudMultipartUpload"("folderId");
CREATE INDEX "CavCloudMultipartUpload_createdByUserId_idx" ON "CavCloudMultipartUpload"("createdByUserId");
CREATE INDEX "CavCloudMultipartUpload_expiresAt_idx" ON "CavCloudMultipartUpload"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CavCloudMultipartPart_uploadId_partNumber_key" ON "CavCloudMultipartPart"("uploadId", "partNumber");
CREATE INDEX "CavCloudMultipartPart_uploadId_idx" ON "CavCloudMultipartPart"("uploadId");

-- AddForeignKey
ALTER TABLE "CavCloudFolder"
  ADD CONSTRAINT "CavCloudFolder_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudFolder"
  ADD CONSTRAINT "CavCloudFolder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CavCloudFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudFile"
  ADD CONSTRAINT "CavCloudFile_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudFile"
  ADD CONSTRAINT "CavCloudFile_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CavCloudTrash"
  ADD CONSTRAINT "CavCloudTrash_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudTrash"
  ADD CONSTRAINT "CavCloudTrash_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudTrash"
  ADD CONSTRAINT "CavCloudTrash_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudQuota"
  ADD CONSTRAINT "CavCloudQuota_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudStorageShare"
  ADD CONSTRAINT "CavCloudStorageShare_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudStorageShare"
  ADD CONSTRAINT "CavCloudStorageShare_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudStorageShare"
  ADD CONSTRAINT "CavCloudStorageShare_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudStorageShare"
  ADD CONSTRAINT "CavCloudStorageShare_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudActivity"
  ADD CONSTRAINT "CavCloudActivity_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudActivity"
  ADD CONSTRAINT "CavCloudActivity_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudMultipartUpload"
  ADD CONSTRAINT "CavCloudMultipartUpload_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudMultipartUpload"
  ADD CONSTRAINT "CavCloudMultipartUpload_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CavCloudMultipartUpload"
  ADD CONSTRAINT "CavCloudMultipartUpload_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudMultipartUpload"
  ADD CONSTRAINT "CavCloudMultipartUpload_completedFileId_fkey"
  FOREIGN KEY ("completedFileId") REFERENCES "CavCloudFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavCloudMultipartPart"
  ADD CONSTRAINT "CavCloudMultipartPart_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "CavCloudMultipartUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
