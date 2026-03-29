-- CavPad cloud-backed metadata over CavCloud primitives.

CREATE TABLE "CavPadDirectory" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "parentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavPadDirectory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavPadNote" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "cavcloudFileId" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "directoryId" TEXT,
  "scope" VARCHAR(16) NOT NULL DEFAULT 'workspace',
  "siteId" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trashedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),

  CONSTRAINT "CavPadNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavPadSettings" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "allowSharing" BOOLEAN NOT NULL DEFAULT true,
  "defaultSharePermission" "CavCloudAccessPermission" NOT NULL DEFAULT 'VIEW',
  "defaultShareExpiryDays" INTEGER NOT NULL DEFAULT 0,
  "noteExpiryDays" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CavPadSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cavpad_directory_sibling_name_unique" ON "CavPadDirectory"("accountId", "parentId", "name");
CREATE INDEX "CavPadDirectory_accountId_parentId_idx" ON "CavPadDirectory"("accountId", "parentId");
CREATE INDEX "CavPadDirectory_accountId_updatedAt_idx" ON "CavPadDirectory"("accountId", "updatedAt");

CREATE UNIQUE INDEX "cavpad_note_file_unique" ON "CavPadNote"("accountId", "cavcloudFileId");
CREATE INDEX "CavPadNote_accountId_updatedAt_idx" ON "CavPadNote"("accountId", "updatedAt");
CREATE INDEX "CavPadNote_accountId_trashedAt_idx" ON "CavPadNote"("accountId", "trashedAt");
CREATE INDEX "CavPadNote_accountId_directoryId_idx" ON "CavPadNote"("accountId", "directoryId");
CREATE INDEX "CavPadNote_accountId_ownerUserId_idx" ON "CavPadNote"("accountId", "ownerUserId");

CREATE UNIQUE INDEX "CavPadSettings_accountId_userId_key" ON "CavPadSettings"("accountId", "userId");
CREATE INDEX "CavPadSettings_accountId_idx" ON "CavPadSettings"("accountId");
CREATE INDEX "CavPadSettings_userId_idx" ON "CavPadSettings"("userId");

ALTER TABLE "CavPadDirectory"
  ADD CONSTRAINT "CavPadDirectory_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavPadDirectory"
  ADD CONSTRAINT "CavPadDirectory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CavPadDirectory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavPadNote"
  ADD CONSTRAINT "CavPadNote_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavPadNote"
  ADD CONSTRAINT "CavPadNote_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavPadNote"
  ADD CONSTRAINT "CavPadNote_cavcloudFileId_fkey"
  FOREIGN KEY ("cavcloudFileId") REFERENCES "CavCloudFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavPadNote"
  ADD CONSTRAINT "CavPadNote_directoryId_fkey"
  FOREIGN KEY ("directoryId") REFERENCES "CavPadDirectory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CavPadSettings"
  ADD CONSTRAINT "CavPadSettings_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavPadSettings"
  ADD CONSTRAINT "CavPadSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
