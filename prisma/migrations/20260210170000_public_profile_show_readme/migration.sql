-- Add README visibility toggle to public profile settings
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicShowReadme" BOOLEAN NOT NULL DEFAULT true;
