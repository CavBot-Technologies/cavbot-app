-- Add per-user CavSafe collaboration targeting for member collab flows.
ALTER TABLE "CavSafeShare"
  ADD COLUMN IF NOT EXISTS "targetUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'CavSafeShare_targetUserId_fkey'
  ) THEN
    ALTER TABLE "CavSafeShare"
      ADD CONSTRAINT "CavSafeShare_targetUserId_fkey"
      FOREIGN KEY ("targetUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "CavSafeShare_targetUserId_idx" ON "CavSafeShare"("targetUserId");
