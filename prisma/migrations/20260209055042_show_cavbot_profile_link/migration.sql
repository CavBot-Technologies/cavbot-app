-- Add privacy-first preference for showing the CavBot public profile link in workspace surfaces
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "showCavbotProfileLink" BOOLEAN NOT NULL DEFAULT false;
