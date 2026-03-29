-- CavCloud mounted filesystem control-plane
-- - Operation log table (server-generated recents)
-- - Project mount table
-- - File path resolver index table
-- - Folder/file metadata extensions for mount resolver

DO $$
BEGIN
  CREATE TYPE "CavCloudOperationKind" AS ENUM (
    'CREATE_FOLDER',
    'UPLOAD_FILE',
    'MOVE_FILE',
    'RENAME_FILE',
    'DELETE_FILE',
    'RESTORE_FILE',
    'SHARE_CREATED',
    'SHARE_REVOKED',
    'DUPLICATE_FILE',
    'ZIP_CREATED',
    'PUBLISHED_ARTIFACT',
    'UNPUBLISHED_ARTIFACT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCloudMountMode" AS ENUM ('READ_ONLY', 'READ_WRITE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "CavCloudFolder"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

ALTER TABLE "CavCloudFile"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "relPath" TEXT NOT NULL DEFAULT '';

UPDATE "CavCloudFile"
SET "relPath" = TRIM(LEADING '/' FROM COALESCE("path", ''))
WHERE COALESCE("relPath", '') = '';

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFolder_accountId_parentId_name_key"
  ON "CavCloudFolder"("accountId", "parentId", "name");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFile_accountId_folderId_name_key"
  ON "CavCloudFile"("accountId", "folderId", "name");

CREATE INDEX IF NOT EXISTS "CavCloudFile_accountId_relPath_idx"
  ON "CavCloudFile"("accountId", "relPath");

CREATE TABLE IF NOT EXISTS "CavCloudOperationLog" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "operatorUserId" TEXT,
  "kind" "CavCloudOperationKind" NOT NULL,
  "subjectType" VARCHAR(32) NOT NULL,
  "subjectId" TEXT NOT NULL,
  "label" VARCHAR(220) NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudOperationLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCodeProjectMount" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "projectId" INTEGER NOT NULL,
  "folderId" TEXT NOT NULL,
  "mountPath" VARCHAR(512) NOT NULL,
  "mode" "CavCloudMountMode" NOT NULL DEFAULT 'READ_ONLY',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCodeProjectMount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCloudFilePathIndex" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "normalizedRelPath" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudFilePathIndex_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CavCloudOperationLog_accountId_createdAt_idx"
  ON "CavCloudOperationLog"("accountId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CavCloudOperationLog_operatorUserId_createdAt_idx"
  ON "CavCloudOperationLog"("operatorUserId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeProjectMount_accountId_projectId_mountPath_key"
  ON "CavCodeProjectMount"("accountId", "projectId", "mountPath");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeProjectMount_accountId_projectId_folderId_key"
  ON "CavCodeProjectMount"("accountId", "projectId", "folderId");

CREATE INDEX IF NOT EXISTS "CavCodeProjectMount_accountId_projectId_idx"
  ON "CavCodeProjectMount"("accountId", "projectId");

CREATE INDEX IF NOT EXISTS "CavCodeProjectMount_accountId_folderId_idx"
  ON "CavCodeProjectMount"("accountId", "folderId");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFilePathIndex_accountId_folderId_normalizedRelPath_key"
  ON "CavCloudFilePathIndex"("accountId", "folderId", "normalizedRelPath");

CREATE INDEX IF NOT EXISTS "CavCloudFilePathIndex_accountId_folderId_normalizedRelPath_idx"
  ON "CavCloudFilePathIndex"("accountId", "folderId", "normalizedRelPath");

CREATE INDEX IF NOT EXISTS "CavCloudFilePathIndex_fileId_idx"
  ON "CavCloudFilePathIndex"("fileId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudOperationLog_accountId_fkey'
      AND table_name = 'CavCloudOperationLog'
  ) THEN
    ALTER TABLE "CavCloudOperationLog"
      ADD CONSTRAINT "CavCloudOperationLog_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudOperationLog_operatorUserId_fkey'
      AND table_name = 'CavCloudOperationLog'
  ) THEN
    ALTER TABLE "CavCloudOperationLog"
      ADD CONSTRAINT "CavCloudOperationLog_operatorUserId_fkey"
      FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectMount_accountId_fkey'
      AND table_name = 'CavCodeProjectMount'
  ) THEN
    ALTER TABLE "CavCodeProjectMount"
      ADD CONSTRAINT "CavCodeProjectMount_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectMount_projectId_fkey'
      AND table_name = 'CavCodeProjectMount'
  ) THEN
    ALTER TABLE "CavCodeProjectMount"
      ADD CONSTRAINT "CavCodeProjectMount_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectMount_folderId_fkey'
      AND table_name = 'CavCodeProjectMount'
  ) THEN
    ALTER TABLE "CavCodeProjectMount"
      ADD CONSTRAINT "CavCodeProjectMount_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFilePathIndex_accountId_fkey'
      AND table_name = 'CavCloudFilePathIndex'
  ) THEN
    ALTER TABLE "CavCloudFilePathIndex"
      ADD CONSTRAINT "CavCloudFilePathIndex_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFilePathIndex_fileId_fkey'
      AND table_name = 'CavCloudFilePathIndex'
  ) THEN
    ALTER TABLE "CavCloudFilePathIndex"
      ADD CONSTRAINT "CavCloudFilePathIndex_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFilePathIndex_folderId_fkey'
      AND table_name = 'CavCloudFilePathIndex'
  ) THEN
    ALTER TABLE "CavCloudFilePathIndex"
      ADD CONSTRAINT "CavCloudFilePathIndex_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavCloudStorageShare_exactly_one_target_chk'
  ) THEN
    ALTER TABLE "CavCloudStorageShare"
      ADD CONSTRAINT "CavCloudStorageShare_exactly_one_target_chk"
      CHECK (num_nonnulls("fileId", "folderId") = 1);
  END IF;
END
$$;
