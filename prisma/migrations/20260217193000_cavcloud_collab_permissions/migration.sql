-- CavCloud collaboration + permissions + version history

DO $$
BEGIN
  CREATE TYPE "CavCloudAccessPermission" AS ENUM ('VIEW', 'EDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCloudFolderAccessRole" AS ENUM ('VIEWER', 'EDITOR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCodeProjectAccessRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCollabResourceType" AS ENUM ('FILE', 'FOLDER', 'PROJECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavCollabRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavContributorPermission" AS ENUM ('EDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'COLLAB_ACCESS_GRANTED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'COLLAB_ACCESS_GRANTED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'COLLAB_ACCESS_REVOKED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'COLLAB_ACCESS_REVOKED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'COLLAB_REQUEST_CREATED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'COLLAB_REQUEST_CREATED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'COLLAB_REQUEST_APPROVED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'COLLAB_REQUEST_APPROVED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'COLLAB_REQUEST_DENIED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'COLLAB_REQUEST_DENIED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'FILE_EDIT_SAVED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'FILE_EDIT_SAVED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'FILE_EDIT_CONFLICT'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'FILE_EDIT_CONFLICT';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'FILE_EDIT_DENIED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'FILE_EDIT_DENIED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'CONTRIBUTOR_LINK_CREATED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'CONTRIBUTOR_LINK_CREATED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'CONTRIBUTOR_LINK_USED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'CONTRIBUTOR_LINK_USED';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'CavCloudOperationKind' AND e.enumlabel = 'CONTRIBUTOR_LINK_DENIED'
  ) THEN
    ALTER TYPE "CavCloudOperationKind" ADD VALUE 'CONTRIBUTOR_LINK_DENIED';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "CavCloudFileAccess" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "CavCloudAccessPermission" NOT NULL DEFAULT 'VIEW',
  "expiresAt" TIMESTAMP(3),
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudFileAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCloudFolderAccess" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CavCloudFolderAccessRole" NOT NULL DEFAULT 'VIEWER',
  "expiresAt" TIMESTAMP(3),
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudFolderAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCodeProjectAccess" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "projectId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CavCodeProjectAccessRole" NOT NULL DEFAULT 'VIEWER',
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCodeProjectAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCollabAccessRequest" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "resourceType" "CavCollabResourceType" NOT NULL,
  "resourceId" TEXT NOT NULL,
  "requestedPermission" "CavCloudAccessPermission" NOT NULL DEFAULT 'EDIT',
  "status" "CavCollabRequestStatus" NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  CONSTRAINT "CavCollabAccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCloudFileVersion" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "r2Key" TEXT NOT NULL,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "restoredFromVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudFileVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavContributorLink" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "resourceType" "CavCollabResourceType" NOT NULL,
  "resourceId" TEXT NOT NULL,
  "permission" "CavContributorPermission" NOT NULL DEFAULT 'EDIT',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavContributorLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CavCloudCollabPolicy" (
  "accountId" TEXT NOT NULL,
  "allowAdminsManageCollaboration" BOOLEAN NOT NULL DEFAULT false,
  "allowMembersEditFiles" BOOLEAN NOT NULL DEFAULT false,
  "allowMembersCreateUpload" BOOLEAN NOT NULL DEFAULT false,
  "allowAdminsPublishArtifacts" BOOLEAN NOT NULL DEFAULT false,
  "enableContributorLinks" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudCollabPolicy_pkey" PRIMARY KEY ("accountId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFileAccess_accountId_fileId_userId_key"
  ON "CavCloudFileAccess"("accountId", "fileId", "userId");

CREATE INDEX IF NOT EXISTS "CavCloudFileAccess_accountId_fileId_idx"
  ON "CavCloudFileAccess"("accountId", "fileId");

CREATE INDEX IF NOT EXISTS "CavCloudFileAccess_accountId_userId_idx"
  ON "CavCloudFileAccess"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavCloudFileAccess_accountId_expiresAt_idx"
  ON "CavCloudFileAccess"("accountId", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFolderAccess_accountId_folderId_userId_key"
  ON "CavCloudFolderAccess"("accountId", "folderId", "userId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderAccess_accountId_folderId_idx"
  ON "CavCloudFolderAccess"("accountId", "folderId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderAccess_accountId_userId_idx"
  ON "CavCloudFolderAccess"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavCloudFolderAccess_accountId_expiresAt_idx"
  ON "CavCloudFolderAccess"("accountId", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeProjectAccess_accountId_projectId_userId_key"
  ON "CavCodeProjectAccess"("accountId", "projectId", "userId");

CREATE INDEX IF NOT EXISTS "CavCodeProjectAccess_accountId_projectId_idx"
  ON "CavCodeProjectAccess"("accountId", "projectId");

CREATE INDEX IF NOT EXISTS "CavCodeProjectAccess_accountId_userId_idx"
  ON "CavCodeProjectAccess"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavCollabAccessRequest_accountId_status_createdAt_idx"
  ON "CavCollabAccessRequest"("accountId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CavCollabAccessRequest_accountId_resourceType_resourceId_idx"
  ON "CavCollabAccessRequest"("accountId", "resourceType", "resourceId");

CREATE INDEX IF NOT EXISTS "CavCollabAccessRequest_requesterUserId_createdAt_idx"
  ON "CavCollabAccessRequest"("requesterUserId", "createdAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "CavCloudFileVersion_fileId_versionNumber_key"
  ON "CavCloudFileVersion"("fileId", "versionNumber");

CREATE INDEX IF NOT EXISTS "CavCloudFileVersion_fileId_createdAt_idx"
  ON "CavCloudFileVersion"("fileId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "CavCloudFileVersion_accountId_fileId_idx"
  ON "CavCloudFileVersion"("accountId", "fileId");

CREATE UNIQUE INDEX IF NOT EXISTS "CavContributorLink_tokenHash_key"
  ON "CavContributorLink"("tokenHash");

CREATE INDEX IF NOT EXISTS "CavContributorLink_accountId_expiresAt_idx"
  ON "CavContributorLink"("accountId", "expiresAt");

CREATE INDEX IF NOT EXISTS "CavContributorLink_accountId_createdAt_idx"
  ON "CavContributorLink"("accountId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileAccess_accountId_fkey'
      AND table_name = 'CavCloudFileAccess'
  ) THEN
    ALTER TABLE "CavCloudFileAccess"
      ADD CONSTRAINT "CavCloudFileAccess_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileAccess_fileId_fkey'
      AND table_name = 'CavCloudFileAccess'
  ) THEN
    ALTER TABLE "CavCloudFileAccess"
      ADD CONSTRAINT "CavCloudFileAccess_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileAccess_userId_fkey'
      AND table_name = 'CavCloudFileAccess'
  ) THEN
    ALTER TABLE "CavCloudFileAccess"
      ADD CONSTRAINT "CavCloudFileAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileAccess_grantedByUserId_fkey'
      AND table_name = 'CavCloudFileAccess'
  ) THEN
    ALTER TABLE "CavCloudFileAccess"
      ADD CONSTRAINT "CavCloudFileAccess_grantedByUserId_fkey"
      FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderAccess_accountId_fkey'
      AND table_name = 'CavCloudFolderAccess'
  ) THEN
    ALTER TABLE "CavCloudFolderAccess"
      ADD CONSTRAINT "CavCloudFolderAccess_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderAccess_folderId_fkey'
      AND table_name = 'CavCloudFolderAccess'
  ) THEN
    ALTER TABLE "CavCloudFolderAccess"
      ADD CONSTRAINT "CavCloudFolderAccess_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavCloudFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderAccess_userId_fkey'
      AND table_name = 'CavCloudFolderAccess'
  ) THEN
    ALTER TABLE "CavCloudFolderAccess"
      ADD CONSTRAINT "CavCloudFolderAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFolderAccess_grantedByUserId_fkey'
      AND table_name = 'CavCloudFolderAccess'
  ) THEN
    ALTER TABLE "CavCloudFolderAccess"
      ADD CONSTRAINT "CavCloudFolderAccess_grantedByUserId_fkey"
      FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectAccess_accountId_fkey'
      AND table_name = 'CavCodeProjectAccess'
  ) THEN
    ALTER TABLE "CavCodeProjectAccess"
      ADD CONSTRAINT "CavCodeProjectAccess_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectAccess_projectId_fkey'
      AND table_name = 'CavCodeProjectAccess'
  ) THEN
    ALTER TABLE "CavCodeProjectAccess"
      ADD CONSTRAINT "CavCodeProjectAccess_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectAccess_userId_fkey'
      AND table_name = 'CavCodeProjectAccess'
  ) THEN
    ALTER TABLE "CavCodeProjectAccess"
      ADD CONSTRAINT "CavCodeProjectAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCodeProjectAccess_grantedByUserId_fkey'
      AND table_name = 'CavCodeProjectAccess'
  ) THEN
    ALTER TABLE "CavCodeProjectAccess"
      ADD CONSTRAINT "CavCodeProjectAccess_grantedByUserId_fkey"
      FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCollabAccessRequest_accountId_fkey'
      AND table_name = 'CavCollabAccessRequest'
  ) THEN
    ALTER TABLE "CavCollabAccessRequest"
      ADD CONSTRAINT "CavCollabAccessRequest_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCollabAccessRequest_requesterUserId_fkey'
      AND table_name = 'CavCollabAccessRequest'
  ) THEN
    ALTER TABLE "CavCollabAccessRequest"
      ADD CONSTRAINT "CavCollabAccessRequest_requesterUserId_fkey"
      FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCollabAccessRequest_resolvedByUserId_fkey'
      AND table_name = 'CavCollabAccessRequest'
  ) THEN
    ALTER TABLE "CavCollabAccessRequest"
      ADD CONSTRAINT "CavCollabAccessRequest_resolvedByUserId_fkey"
      FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileVersion_accountId_fkey'
      AND table_name = 'CavCloudFileVersion'
  ) THEN
    ALTER TABLE "CavCloudFileVersion"
      ADD CONSTRAINT "CavCloudFileVersion_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileVersion_fileId_fkey'
      AND table_name = 'CavCloudFileVersion'
  ) THEN
    ALTER TABLE "CavCloudFileVersion"
      ADD CONSTRAINT "CavCloudFileVersion_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudFileVersion_createdByUserId_fkey'
      AND table_name = 'CavCloudFileVersion'
  ) THEN
    ALTER TABLE "CavCloudFileVersion"
      ADD CONSTRAINT "CavCloudFileVersion_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavContributorLink_accountId_fkey'
      AND table_name = 'CavContributorLink'
  ) THEN
    ALTER TABLE "CavContributorLink"
      ADD CONSTRAINT "CavContributorLink_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavContributorLink_createdByUserId_fkey'
      AND table_name = 'CavContributorLink'
  ) THEN
    ALTER TABLE "CavContributorLink"
      ADD CONSTRAINT "CavContributorLink_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CavCloudCollabPolicy_accountId_fkey'
      AND table_name = 'CavCloudCollabPolicy'
  ) THEN
    ALTER TABLE "CavCloudCollabPolicy"
      ADD CONSTRAINT "CavCloudCollabPolicy_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
