-- CavCloud reliable folder upload session tracking

DO $$
BEGIN
  CREATE TYPE "CavCloudFolderUploadSessionStatus" AS ENUM ('CREATED', 'UPLOADING', 'COMPLETE', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCloudFolderUploadSessionFileStatus" AS ENUM ('CREATED', 'UPLOADING', 'READY', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "CavCloudFolderUploadSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "parentFolderId" TEXT NOT NULL,
  "rootFolderId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "requestedRootName" VARCHAR(220) NOT NULL,
  "resolvedRootName" VARCHAR(220) NOT NULL,
  "status" "CavCloudFolderUploadSessionStatus" NOT NULL DEFAULT 'CREATED',
  "discoveredFilesCount" INTEGER NOT NULL DEFAULT 0,
  "createdFilesCount" INTEGER NOT NULL DEFAULT 0,
  "finalizedFilesCount" INTEGER NOT NULL DEFAULT 0,
  "failedFilesCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudFolderUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCloudFolderUploadSessionFile" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "relPath" TEXT NOT NULL,
  "status" "CavCloudFolderUploadSessionFileStatus" NOT NULL DEFAULT 'CREATED',
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "mimeTypeGuess" VARCHAR(200),
  "errorCode" VARCHAR(64),
  "errorMessage" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudFolderUploadSessionFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_sessionId_relPath_key"
  ON "CavCloudFolderUploadSessionFile" ("sessionId", "relPath");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_sessionId_fileId_key"
  ON "CavCloudFolderUploadSessionFile" ("sessionId", "fileId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSession_accountId_status_updatedAt_idx"
  ON "CavCloudFolderUploadSession" ("accountId", "status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSession_accountId_createdAt_idx"
  ON "CavCloudFolderUploadSession" ("accountId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSession_parentFolderId_idx"
  ON "CavCloudFolderUploadSession" ("parentFolderId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSession_rootFolderId_idx"
  ON "CavCloudFolderUploadSession" ("rootFolderId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSession_createdByUserId_idx"
  ON "CavCloudFolderUploadSession" ("createdByUserId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_sessionId_status_idx"
  ON "CavCloudFolderUploadSessionFile" ("sessionId", "status");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_accountId_sessionId_status_idx"
  ON "CavCloudFolderUploadSessionFile" ("accountId", "sessionId", "status");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_folderId_idx"
  ON "CavCloudFolderUploadSessionFile" ("folderId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderUploadSessionFile_fileId_idx"
  ON "CavCloudFolderUploadSessionFile" ("fileId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSession_accountId_fkey'
      AND table_name = 'CavCloudFolderUploadSession'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSession"
      ADD CONSTRAINT "CavCloudFolderUploadSession_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSession_parentFolderId_fkey'
      AND table_name = 'CavCloudFolderUploadSession'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSession"
      ADD CONSTRAINT "CavCloudFolderUploadSession_parentFolderId_fkey"
      FOREIGN KEY ("parentFolderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSession_rootFolderId_fkey'
      AND table_name = 'CavCloudFolderUploadSession'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSession"
      ADD CONSTRAINT "CavCloudFolderUploadSession_rootFolderId_fkey"
      FOREIGN KEY ("rootFolderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSession_createdByUserId_fkey'
      AND table_name = 'CavCloudFolderUploadSession'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSession"
      ADD CONSTRAINT "CavCloudFolderUploadSession_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSessionFile_sessionId_fkey'
      AND table_name = 'CavCloudFolderUploadSessionFile'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSessionFile"
      ADD CONSTRAINT "CavCloudFolderUploadSessionFile_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "CavCloudFolderUploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSessionFile_accountId_fkey'
      AND table_name = 'CavCloudFolderUploadSessionFile'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSessionFile"
      ADD CONSTRAINT "CavCloudFolderUploadSessionFile_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSessionFile_folderId_fkey'
      AND table_name = 'CavCloudFolderUploadSessionFile'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSessionFile"
      ADD CONSTRAINT "CavCloudFolderUploadSessionFile_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderUploadSessionFile_fileId_fkey'
      AND table_name = 'CavCloudFolderUploadSessionFile'
  ) THEN
    ALTER TABLE "CavCloudFolderUploadSessionFile"
      ADD CONSTRAINT "CavCloudFolderUploadSessionFile_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
