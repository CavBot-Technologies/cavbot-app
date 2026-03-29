CREATE TABLE "CavSafeSettings" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "themeAccent" VARCHAR(24) NOT NULL DEFAULT 'lime',
  "trashRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "autoPurgeTrash" BOOLEAN NOT NULL DEFAULT true,
  "preferDownloadUnknownBinary" BOOLEAN NOT NULL DEFAULT true,
  "defaultIntegrityLockOnUpload" BOOLEAN NOT NULL DEFAULT false,
  "defaultEvidenceVisibility" "PublicArtifactVisibility" NOT NULL DEFAULT 'LINK_ONLY',
  "defaultEvidenceExpiryDays" INTEGER NOT NULL DEFAULT 0,
  "auditRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "enableAuditExport" BOOLEAN NOT NULL DEFAULT true,
  "timelockDefaultPreset" VARCHAR(24) NOT NULL DEFAULT 'none',
  "notifySafeStorage80" BOOLEAN NOT NULL DEFAULT true,
  "notifySafeStorage95" BOOLEAN NOT NULL DEFAULT true,
  "notifySafeUploadFailures" BOOLEAN NOT NULL DEFAULT true,
  "notifySafeMoveFailures" BOOLEAN NOT NULL DEFAULT true,
  "notifySafeEvidencePublished" BOOLEAN NOT NULL DEFAULT false,
  "notifySafeSnapshotCreated" BOOLEAN NOT NULL DEFAULT false,
  "notifySafeTimeLockEvents" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavSafeSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CavSafeSettings_accountId_userId_key" ON "CavSafeSettings"("accountId", "userId");
CREATE INDEX "CavSafeSettings_accountId_idx" ON "CavSafeSettings"("accountId");
CREATE INDEX "CavSafeSettings_userId_idx" ON "CavSafeSettings"("userId");

ALTER TABLE "CavSafeSettings"
  ADD CONSTRAINT "CavSafeSettings_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavSafeSettings"
  ADD CONSTRAINT "CavSafeSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD COLUMN "kind" VARCHAR(64) NOT NULL DEFAULT 'GENERIC',
  ADD COLUMN "metaJson" JSONB;
