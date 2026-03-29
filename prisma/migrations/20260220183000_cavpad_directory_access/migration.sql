-- CavPad folder collaboration ACL for directory-level sharing.

CREATE TABLE IF NOT EXISTS "CavPadDirectoryAccess" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "directoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "CavCloudAccessPermission" NOT NULL DEFAULT 'VIEW',
  "expiresAt" TIMESTAMP(3),
  "grantedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavPadDirectoryAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CavPadDirectoryAccess_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadDirectoryAccess_directoryId_fkey"
    FOREIGN KEY ("directoryId") REFERENCES "CavPadDirectory"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadDirectoryAccess_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CavPadDirectoryAccess_grantedByUserId_fkey"
    FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cavpad_directory_access_unique"
  ON "CavPadDirectoryAccess"("accountId", "directoryId", "userId");

CREATE INDEX IF NOT EXISTS "CavPadDirectoryAccess_accountId_directoryId_idx"
  ON "CavPadDirectoryAccess"("accountId", "directoryId");

CREATE INDEX IF NOT EXISTS "CavPadDirectoryAccess_accountId_userId_idx"
  ON "CavPadDirectoryAccess"("accountId", "userId");

CREATE INDEX IF NOT EXISTS "CavPadDirectoryAccess_accountId_expiresAt_idx"
  ON "CavPadDirectoryAccess"("accountId", "expiresAt");
