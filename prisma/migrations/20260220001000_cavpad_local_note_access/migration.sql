-- CavPad-native collaboration ACL for notes (independent of CavCloud sync).

CREATE TABLE IF NOT EXISTS "CavPadNoteAccess" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "CavCloudAccessPermission" NOT NULL DEFAULT 'VIEW',
  "expiresAt" TIMESTAMP(3),
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavPadNoteAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CavPadNoteAccess_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteAccess_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "CavPadNote"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadNoteAccess_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cavpad_note_access_unique"
  ON "CavPadNoteAccess"("accountId", "noteId", "userId");

CREATE INDEX IF NOT EXISTS "CavPadNoteAccess_accountId_noteId_idx"
  ON "CavPadNoteAccess"("accountId", "noteId");

CREATE INDEX IF NOT EXISTS "CavPadNoteAccess_accountId_userId_idx"
  ON "CavPadNoteAccess"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavPadNoteAccess_accountId_expiresAt_idx"
  ON "CavPadNoteAccess"("accountId", "expiresAt");

