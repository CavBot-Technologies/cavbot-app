-- Persist CavPad pin state for notes and directories server-side.

ALTER TABLE "CavPadNote"
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);

ALTER TABLE "CavPadDirectory"
  ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "CavPadNote_accountId_pinnedAt_idx"
  ON "CavPadNote"("accountId", "pinnedAt");

CREATE INDEX IF NOT EXISTS "CavPadDirectory_accountId_pinnedAt_idx"
  ON "CavPadDirectory"("accountId", "pinnedAt");
