-- Public profile fields (privacy-first) + explicitly published artifacts

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowWorkspaceSnapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowHealthOverview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowCapabilities" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowArtifacts" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowPlanTier" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicShowBio" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "publicWorkspaceId" VARCHAR(24);

CREATE TABLE IF NOT EXISTS "PublicArtifact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" VARCHAR(140) NOT NULL,
  "type" VARCHAR(32) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicArtifact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PublicArtifact_userId_idx" ON "PublicArtifact"("userId");
CREATE INDEX IF NOT EXISTS "PublicArtifact_publishedAt_idx" ON "PublicArtifact"("publishedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PublicArtifact_userId_fkey'
  ) THEN
    ALTER TABLE "PublicArtifact"
      ADD CONSTRAINT "PublicArtifact_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

