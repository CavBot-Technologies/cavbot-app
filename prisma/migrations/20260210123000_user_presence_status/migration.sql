-- User presence status (public profile) - user-controlled only.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "showStatusOnPublicProfile" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "userStatus" VARCHAR(24),
  ADD COLUMN IF NOT EXISTS "userStatusNote" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "userStatusUpdatedAt" TIMESTAMP(3);

-- Best-effort backfill from prior public status columns (if present).
-- Keep semantics: visibility is the gate; mode/note are preserved even when hidden.
UPDATE "User"
SET
  "showStatusOnPublicProfile" = CASE
    WHEN "showStatusOnPublicProfile" = true THEN true
    WHEN COALESCE("publicStatusEnabled", false) = true THEN true
    ELSE false
  END,
  "userStatus" = COALESCE("userStatus", "publicStatusMode"),
  "userStatusNote" = COALESCE("userStatusNote", "publicStatusNote"),
  "userStatusUpdatedAt" = COALESCE("userStatusUpdatedAt", "publicStatusUpdatedAt")
WHERE
  ("userStatus" IS NULL OR "userStatusNote" IS NULL OR "userStatusUpdatedAt" IS NULL)
  AND (
    "publicStatusEnabled" IS NOT NULL
    OR "publicStatusMode" IS NOT NULL
    OR "publicStatusNote" IS NOT NULL
    OR "publicStatusUpdatedAt" IS NOT NULL
  );

