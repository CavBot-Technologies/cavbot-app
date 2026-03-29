DO $$
BEGIN
  CREATE TYPE "CavCloudShortcutTargetType" AS ENUM ('FILE', 'FOLDER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "CavCloudShortcut" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetType" "CavCloudShortcutTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "fileAccessId" TEXT,
  "folderAccessId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudShortcut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudShortcut_accountId_userId_targetType_targetId_key"
  ON "CavCloudShortcut"("accountId", "userId", "targetType", "targetId");

CREATE INDEX IF NOT EXISTS "CavCloudShortcut_accountId_userId_idx"
  ON "CavCloudShortcut"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavCloudShortcut_accountId_targetType_targetId_idx"
  ON "CavCloudShortcut"("accountId", "targetType", "targetId");

CREATE INDEX IF NOT EXISTS "CavCloudShortcut_fileAccessId_idx"
  ON "CavCloudShortcut"("fileAccessId");

CREATE INDEX IF NOT EXISTS "CavCloudShortcut_folderAccessId_idx"
  ON "CavCloudShortcut"("folderAccessId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CavCloudShortcut_accountId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShortcut"
      ADD CONSTRAINT "CavCloudShortcut_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CavCloudShortcut_userId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShortcut"
      ADD CONSTRAINT "CavCloudShortcut_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CavCloudShortcut_fileAccessId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShortcut"
      ADD CONSTRAINT "CavCloudShortcut_fileAccessId_fkey"
      FOREIGN KEY ("fileAccessId") REFERENCES "CavCloudFileAccess"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CavCloudShortcut_folderAccessId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShortcut"
      ADD CONSTRAINT "CavCloudShortcut_folderAccessId_fkey"
      FOREIGN KEY ("folderAccessId") REFERENCES "CavCloudFolderAccess"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
