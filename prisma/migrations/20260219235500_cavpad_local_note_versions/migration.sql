-- CavPad-native, DB-backed note version history (independent of CavCloud sync).

CREATE TABLE IF NOT EXISTS "CavPadNoteVersion" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "textContent" TEXT NOT NULL DEFAULT '',
  "directoryId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavPadNoteVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CavPadNoteVersion_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteVersion_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "CavPadNote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteVersion_directoryId_fkey"
    FOREIGN KEY ("directoryId") REFERENCES "CavPadDirectory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteVersion_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cavpad_note_version_unique"
  ON "CavPadNoteVersion"("accountId", "noteId", "versionNumber");

CREATE INDEX IF NOT EXISTS "CavPadNoteVersion_accountId_noteId_createdAt_idx"
  ON "CavPadNoteVersion"("accountId", "noteId", "createdAt");

CREATE INDEX IF NOT EXISTS "CavPadNoteVersion_accountId_noteId_versionNumber_idx"
  ON "CavPadNoteVersion"("accountId", "noteId", "versionNumber");

