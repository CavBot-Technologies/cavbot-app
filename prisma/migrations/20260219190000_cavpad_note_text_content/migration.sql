-- Persist CavPad note bodies independently from CavCloud file sync.
ALTER TABLE "CavPadNote"
  ADD COLUMN IF NOT EXISTS "textContent" TEXT NOT NULL DEFAULT '';
