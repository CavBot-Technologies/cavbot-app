-- Add optimistic-concurrency revision tracking for Public Profile README.
ALTER TABLE "PublicProfileReadme"
  ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
