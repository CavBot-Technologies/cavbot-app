-- CavSafe owner-only secure storage surface
-- Dedicated metadata tables to isolate CavSafe data from CavCloud queries.

-- CreateTable
CREATE TABLE "CavSafeFolder" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" VARCHAR(220) NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CavSafeFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeFile" (
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
  CONSTRAINT "CavSafeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeTrash" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgeAfter" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeTrash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeQuota" (
  "accountId" TEXT NOT NULL,
  "usedBytes" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavSafeQuota_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "CavSafeShare" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "mode" "CavCloudShareMode" NOT NULL DEFAULT 'READ_ONLY',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "CavSafeShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeActivity" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "action" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(32) NOT NULL,
  "targetId" TEXT,
  "targetPath" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeMultipartUpload" (
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
  CONSTRAINT "CavSafeMultipartUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeMultipartPart" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "etag" VARCHAR(200) NOT NULL,
  "bytes" INTEGER NOT NULL,
  "sha256" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeMultipartPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CavSafeUsagePoint" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "usedBytes" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CavSafeUsagePoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CavSafeFolder_accountId_path_key" ON "CavSafeFolder"("accountId", "path");
CREATE INDEX "CavSafeFolder_accountId_parentId_idx" ON "CavSafeFolder"("accountId", "parentId");
CREATE INDEX "CavSafeFolder_accountId_deletedAt_idx" ON "CavSafeFolder"("accountId", "deletedAt");
CREATE INDEX "CavSafeFolder_accountId_path_idx" ON "CavSafeFolder"("accountId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "CavSafeFile_accountId_path_key" ON "CavSafeFile"("accountId", "path");
CREATE INDEX "CavSafeFile_accountId_folderId_idx" ON "CavSafeFile"("accountId", "folderId");
CREATE INDEX "CavSafeFile_accountId_deletedAt_idx" ON "CavSafeFile"("accountId", "deletedAt");
CREATE INDEX "CavSafeFile_accountId_path_idx" ON "CavSafeFile"("accountId", "path");

-- CreateIndex
CREATE INDEX "CavSafeTrash_accountId_purgeAfter_idx" ON "CavSafeTrash"("accountId", "purgeAfter");
CREATE INDEX "CavSafeTrash_accountId_deletedAt_idx" ON "CavSafeTrash"("accountId", "deletedAt");
CREATE INDEX "CavSafeTrash_fileId_idx" ON "CavSafeTrash"("fileId");
CREATE INDEX "CavSafeTrash_folderId_idx" ON "CavSafeTrash"("folderId");

-- CreateIndex
CREATE INDEX "CavSafeShare_accountId_idx" ON "CavSafeShare"("accountId");
CREATE INDEX "CavSafeShare_fileId_idx" ON "CavSafeShare"("fileId");
CREATE INDEX "CavSafeShare_folderId_idx" ON "CavSafeShare"("folderId");
CREATE INDEX "CavSafeShare_createdByUserId_idx" ON "CavSafeShare"("createdByUserId");
CREATE INDEX "CavSafeShare_expiresAt_idx" ON "CavSafeShare"("expiresAt");
CREATE INDEX "CavSafeShare_revokedAt_idx" ON "CavSafeShare"("revokedAt");

-- CreateIndex
CREATE INDEX "CavSafeActivity_accountId_createdAt_idx" ON "CavSafeActivity"("accountId", "createdAt");
CREATE INDEX "CavSafeActivity_accountId_action_idx" ON "CavSafeActivity"("accountId", "action");
CREATE INDEX "CavSafeActivity_operatorUserId_createdAt_idx" ON "CavSafeActivity"("operatorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "CavSafeMultipartUpload_accountId_status_createdAt_idx" ON "CavSafeMultipartUpload"("accountId", "status", "createdAt");
CREATE INDEX "CavSafeMultipartUpload_folderId_idx" ON "CavSafeMultipartUpload"("folderId");
CREATE INDEX "CavSafeMultipartUpload_createdByUserId_idx" ON "CavSafeMultipartUpload"("createdByUserId");
CREATE INDEX "CavSafeMultipartUpload_expiresAt_idx" ON "CavSafeMultipartUpload"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CavSafeMultipartPart_uploadId_partNumber_key" ON "CavSafeMultipartPart"("uploadId", "partNumber");
CREATE INDEX "CavSafeMultipartPart_uploadId_idx" ON "CavSafeMultipartPart"("uploadId");

-- CreateIndex
CREATE UNIQUE INDEX "CavSafeUsagePoint_accountId_bucketStart_key"
  ON "CavSafeUsagePoint"("accountId", "bucketStart");

CREATE INDEX "CavSafeUsagePoint_accountId_bucketStart_idx"
  ON "CavSafeUsagePoint"("accountId", "bucketStart");

-- AddForeignKey
ALTER TABLE "CavSafeFolder"
  ADD CONSTRAINT "CavSafeFolder_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeFolder"
  ADD CONSTRAINT "CavSafeFolder_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CavSafeFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeFile"
  ADD CONSTRAINT "CavSafeFile_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeFile"
  ADD CONSTRAINT "CavSafeFile_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CavSafeTrash"
  ADD CONSTRAINT "CavSafeTrash_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeTrash"
  ADD CONSTRAINT "CavSafeTrash_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "CavSafeFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeTrash"
  ADD CONSTRAINT "CavSafeTrash_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeQuota"
  ADD CONSTRAINT "CavSafeQuota_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeShare"
  ADD CONSTRAINT "CavSafeShare_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeShare"
  ADD CONSTRAINT "CavSafeShare_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "CavSafeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeShare"
  ADD CONSTRAINT "CavSafeShare_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeShare"
  ADD CONSTRAINT "CavSafeShare_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeActivity"
  ADD CONSTRAINT "CavSafeActivity_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeActivity"
  ADD CONSTRAINT "CavSafeActivity_operatorUserId_fkey"
  FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeMultipartUpload"
  ADD CONSTRAINT "CavSafeMultipartUpload_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeMultipartUpload"
  ADD CONSTRAINT "CavSafeMultipartUpload_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CavSafeMultipartUpload"
  ADD CONSTRAINT "CavSafeMultipartUpload_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeMultipartUpload"
  ADD CONSTRAINT "CavSafeMultipartUpload_completedFileId_fkey"
  FOREIGN KEY ("completedFileId") REFERENCES "CavSafeFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavSafeMultipartPart"
  ADD CONSTRAINT "CavSafeMultipartPart_uploadId_fkey"
  FOREIGN KEY ("uploadId") REFERENCES "CavSafeMultipartUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeUsagePoint"
  ADD CONSTRAINT "CavSafeUsagePoint_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
