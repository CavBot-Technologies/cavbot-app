-- Allow storing multiple website URLs (JSON string) without truncation.
-- Safe to run even if the column already exists.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customLinkUrl" TEXT;
ALTER TABLE "User" ALTER COLUMN "customLinkUrl" TYPE TEXT;
