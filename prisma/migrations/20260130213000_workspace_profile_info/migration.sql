-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyName" VARCHAR(140);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyCategory" VARCHAR(80);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "companySubcategory" VARCHAR(80);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "githubUrl" VARCHAR(200);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "instagramUrl" VARCHAR(200);
-- Add SiteDeletion tracking tables and enums
DO $$ BEGIN
  CREATE TYPE "SiteDeletionMode" AS ENUM ('SAFE','DESTRUCTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TYPE "SiteDeletionStatus" AS ENUM ('PENDING','SCHEDULED','PURGED','FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS "SiteDeletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "siteId" TEXT NOT NULL REFERENCES "Site"(id) ON DELETE CASCADE,
  "projectId" INTEGER NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  "accountId" TEXT NOT NULL REFERENCES "Account"(id) ON DELETE CASCADE,
  "operatorUserId" TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  "mode" "SiteDeletionMode" NOT NULL,
  "status" "SiteDeletionStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "purgeScheduledAt" TIMESTAMPTZ,
  "purgedAt" TIMESTAMPTZ,
  "origin" TEXT,
  "metaJson" JSONB,
  "retentionDays" INTEGER,
  CONSTRAINT "SiteDeletion_siteId_key" UNIQUE ("siteId")
);
