-- CavCloud-backed Public Artifacts + tokenized Share Links (read-only, expiring, revocable)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'PublicArtifactVisibility'
  ) THEN
    CREATE TYPE "PublicArtifactVisibility" AS ENUM ('PRIVATE', 'LINK_ONLY', 'PUBLIC_PROFILE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'CavCloudShareMode'
  ) THEN
    CREATE TYPE "CavCloudShareMode" AS ENUM ('READ_ONLY');
  END IF;
END $$;

ALTER TABLE "PublicArtifact"
  ADD COLUMN IF NOT EXISTS "storageKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "mimeType" VARCHAR(200) NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sha256" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "visibility" "PublicArtifactVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN IF NOT EXISTS "sourcePath" TEXT;

CREATE INDEX IF NOT EXISTS "PublicArtifact_visibility_idx" ON "PublicArtifact"("visibility");
CREATE INDEX IF NOT EXISTS "PublicArtifact_userId_visibility_publishedAt_idx" ON "PublicArtifact"("userId","visibility","publishedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PublicArtifact_userId_sourcePath_key" ON "PublicArtifact"("userId","sourcePath");

CREATE TABLE IF NOT EXISTS "CavCloudShare" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "mode" "CavCloudShareMode" NOT NULL DEFAULT 'READ_ONLY',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CavCloudShare_artifactId_idx" ON "CavCloudShare"("artifactId");
CREATE INDEX IF NOT EXISTS "CavCloudShare_createdByUserId_idx" ON "CavCloudShare"("createdByUserId");
CREATE INDEX IF NOT EXISTS "CavCloudShare_expiresAt_idx" ON "CavCloudShare"("expiresAt");
CREATE INDEX IF NOT EXISTS "CavCloudShare_revokedAt_idx" ON "CavCloudShare"("revokedAt");
CREATE INDEX IF NOT EXISTS "CavCloudShare_artifactId_expiresAt_idx" ON "CavCloudShare"("artifactId","expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavCloudShare_artifactId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShare"
      ADD CONSTRAINT "CavCloudShare_artifactId_fkey"
      FOREIGN KEY ("artifactId") REFERENCES "PublicArtifact"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CavCloudShare_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "CavCloudShare"
      ADD CONSTRAINT "CavCloudShare_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

