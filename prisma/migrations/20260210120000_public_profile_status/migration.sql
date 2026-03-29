-- Add public profile "work mode" status fields (privacy-first; OFF by default).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "publicStatusEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicStatusMode" VARCHAR(24),
  ADD COLUMN IF NOT EXISTS "publicStatusNote" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "publicStatusUpdatedAt" TIMESTAMP(3);

