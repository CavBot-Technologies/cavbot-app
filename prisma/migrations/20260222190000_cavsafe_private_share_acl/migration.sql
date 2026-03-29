-- CavSafe private invite-only sharing (ACL + invites)

DO $$
BEGIN
  CREATE TYPE "CavSafeAclPrincipalType" AS ENUM ('USER', 'WORKSPACE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavSafeAclRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavSafeAclStatus" AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "CavSafeInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "CavSafeAcl" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "principalType" "CavSafeAclPrincipalType" NOT NULL DEFAULT 'USER',
  "principalId" TEXT NOT NULL,
  "role" "CavSafeAclRole" NOT NULL DEFAULT 'VIEWER',
  "status" "CavSafeAclStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT,
  "revokedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavSafeAcl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CavSafeAcl_item_kind_check" CHECK (
    (CASE WHEN "fileId" IS NULL THEN 0 ELSE 1 END)
    +
    (CASE WHEN "folderId" IS NULL THEN 0 ELSE 1 END)
    = 1
  )
);

CREATE TABLE IF NOT EXISTS "CavSafeInvite" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fileId" TEXT,
  "folderId" TEXT,
  "inviterUserId" TEXT NOT NULL,
  "inviteeUserId" TEXT,
  "inviteeEmail" TEXT,
  "role" "CavSafeAclRole" NOT NULL DEFAULT 'VIEWER',
  "status" "CavSafeInviteStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavSafeInvite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CavSafeInvite_item_kind_check" CHECK (
    (CASE WHEN "fileId" IS NULL THEN 0 ELSE 1 END)
    +
    (CASE WHEN "folderId" IS NULL THEN 0 ELSE 1 END)
    = 1
  ),
  CONSTRAINT "CavSafeInvite_recipient_check" CHECK (
    (CASE WHEN "inviteeUserId" IS NULL THEN 0 ELSE 1 END)
    +
    (CASE WHEN "inviteeEmail" IS NULL THEN 0 ELSE 1 END)
    = 1
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeAcl_accountId_fkey'
  ) THEN
    ALTER TABLE "CavSafeAcl"
      ADD CONSTRAINT "CavSafeAcl_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeAcl_fileId_fkey'
  ) THEN
    ALTER TABLE "CavSafeAcl"
      ADD CONSTRAINT "CavSafeAcl_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavSafeFile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeAcl_folderId_fkey'
  ) THEN
    ALTER TABLE "CavSafeAcl"
      ADD CONSTRAINT "CavSafeAcl_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeAcl_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "CavSafeAcl"
      ADD CONSTRAINT "CavSafeAcl_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeAcl_revokedByUserId_fkey'
  ) THEN
    ALTER TABLE "CavSafeAcl"
      ADD CONSTRAINT "CavSafeAcl_revokedByUserId_fkey"
      FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeInvite_accountId_fkey'
  ) THEN
    ALTER TABLE "CavSafeInvite"
      ADD CONSTRAINT "CavSafeInvite_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeInvite_fileId_fkey'
  ) THEN
    ALTER TABLE "CavSafeInvite"
      ADD CONSTRAINT "CavSafeInvite_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "CavSafeFile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeInvite_folderId_fkey'
  ) THEN
    ALTER TABLE "CavSafeInvite"
      ADD CONSTRAINT "CavSafeInvite_folderId_fkey"
      FOREIGN KEY ("folderId") REFERENCES "CavSafeFolder"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeInvite_inviterUserId_fkey'
  ) THEN
    ALTER TABLE "CavSafeInvite"
      ADD CONSTRAINT "CavSafeInvite_inviterUserId_fkey"
      FOREIGN KEY ("inviterUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavSafeInvite_inviteeUserId_fkey'
  ) THEN
    ALTER TABLE "CavSafeInvite"
      ADD CONSTRAINT "CavSafeInvite_inviteeUserId_fkey"
      FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeAcl_account_file_principal_unique"
  ON "CavSafeAcl" ("accountId", "fileId", "principalType", "principalId");
CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeAcl_account_folder_principal_unique"
  ON "CavSafeAcl" ("accountId", "folderId", "principalType", "principalId");
CREATE INDEX IF NOT EXISTS "CavSafeAcl_account_file_status_idx"
  ON "CavSafeAcl" ("accountId", "fileId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeAcl_account_folder_status_idx"
  ON "CavSafeAcl" ("accountId", "folderId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeAcl_account_principal_status_idx"
  ON "CavSafeAcl" ("accountId", "principalType", "principalId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeAcl_createdByUserId_idx"
  ON "CavSafeAcl" ("createdByUserId");
CREATE INDEX IF NOT EXISTS "CavSafeAcl_revokedByUserId_idx"
  ON "CavSafeAcl" ("revokedByUserId");

CREATE INDEX IF NOT EXISTS "CavSafeInvite_account_file_status_idx"
  ON "CavSafeInvite" ("accountId", "fileId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeInvite_account_folder_status_idx"
  ON "CavSafeInvite" ("accountId", "folderId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeInvite_account_inviteeUser_status_idx"
  ON "CavSafeInvite" ("accountId", "inviteeUserId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeInvite_account_inviteeEmail_status_idx"
  ON "CavSafeInvite" ("accountId", "inviteeEmail", "status");
CREATE INDEX IF NOT EXISTS "CavSafeInvite_account_inviter_status_idx"
  ON "CavSafeInvite" ("accountId", "inviterUserId", "status");
CREATE INDEX IF NOT EXISTS "CavSafeInvite_expiresAt_idx"
  ON "CavSafeInvite" ("expiresAt");

-- Prevent duplicate pending invites by item + recipient.
CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeInvite_pending_file_user_unique"
  ON "CavSafeInvite" ("accountId", "fileId", "inviteeUserId")
  WHERE "status" = 'PENDING'::"CavSafeInviteStatus"
    AND "fileId" IS NOT NULL
    AND "inviteeUserId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeInvite_pending_folder_user_unique"
  ON "CavSafeInvite" ("accountId", "folderId", "inviteeUserId")
  WHERE "status" = 'PENDING'::"CavSafeInviteStatus"
    AND "folderId" IS NOT NULL
    AND "inviteeUserId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeInvite_pending_file_email_unique"
  ON "CavSafeInvite" ("accountId", "fileId", "inviteeEmail")
  WHERE "status" = 'PENDING'::"CavSafeInviteStatus"
    AND "fileId" IS NOT NULL
    AND "inviteeEmail" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "CavSafeInvite_pending_folder_email_unique"
  ON "CavSafeInvite" ("accountId", "folderId", "inviteeEmail")
  WHERE "status" = 'PENDING'::"CavSafeInviteStatus"
    AND "folderId" IS NOT NULL
    AND "inviteeEmail" IS NOT NULL;

-- Backfill: existing CavSafe items grant OWNER ACL to workspace owners.
INSERT INTO "CavSafeAcl" (
  "id",
  "accountId",
  "fileId",
  "folderId",
  "principalType",
  "principalId",
  "role",
  "status",
  "createdByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  'csa_' || substr(md5(random()::text || clock_timestamp()::text || f.id || m."userId"), 1, 24),
  f."accountId",
  f.id,
  NULL,
  'USER'::"CavSafeAclPrincipalType",
  m."userId",
  'OWNER'::"CavSafeAclRole",
  'ACTIVE'::"CavSafeAclStatus",
  m."userId",
  now(),
  now()
FROM "CavSafeFile" f
INNER JOIN "Membership" m
  ON m."accountId" = f."accountId"
  AND m."role" = 'OWNER'
LEFT JOIN "CavSafeAcl" existing
  ON existing."accountId" = f."accountId"
  AND existing."fileId" = f.id
  AND existing."principalType" = 'USER'::"CavSafeAclPrincipalType"
  AND existing."principalId" = m."userId"
WHERE f."deletedAt" IS NULL
  AND existing."id" IS NULL;

INSERT INTO "CavSafeAcl" (
  "id",
  "accountId",
  "fileId",
  "folderId",
  "principalType",
  "principalId",
  "role",
  "status",
  "createdByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  'csa_' || substr(md5(random()::text || clock_timestamp()::text || d.id || m."userId"), 1, 24),
  d."accountId",
  NULL,
  d.id,
  'USER'::"CavSafeAclPrincipalType",
  m."userId",
  'OWNER'::"CavSafeAclRole",
  'ACTIVE'::"CavSafeAclStatus",
  m."userId",
  now(),
  now()
FROM "CavSafeFolder" d
INNER JOIN "Membership" m
  ON m."accountId" = d."accountId"
  AND m."role" = 'OWNER'
LEFT JOIN "CavSafeAcl" existing
  ON existing."accountId" = d."accountId"
  AND existing."folderId" = d.id
  AND existing."principalType" = 'USER'::"CavSafeAclPrincipalType"
  AND existing."principalId" = m."userId"
WHERE d."deletedAt" IS NULL
  AND existing."id" IS NULL;
