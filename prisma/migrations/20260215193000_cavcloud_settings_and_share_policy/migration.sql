ALTER TABLE "PublicArtifact"
  ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "CavCloudShare"
  ADD COLUMN "accountId" TEXT,
  ADD COLUMN "accessPolicy" VARCHAR(32) NOT NULL DEFAULT 'anyone';

ALTER TABLE "CavCloudStorageShare"
  ADD COLUMN "accessPolicy" VARCHAR(32) NOT NULL DEFAULT 'anyone';

CREATE TABLE "CavCloudSettings" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "themeAccent" VARCHAR(24) NOT NULL DEFAULT 'lime',
  "startLocation" VARCHAR(24) NOT NULL DEFAULT 'root',
  "lastFolderId" TEXT,
  "pinnedFolderId" TEXT,
  "defaultView" VARCHAR(16) NOT NULL DEFAULT 'grid',
  "defaultSort" VARCHAR(16) NOT NULL DEFAULT 'name',
  "foldersFirst" BOOLEAN NOT NULL DEFAULT true,
  "showExtensions" BOOLEAN NOT NULL DEFAULT true,
  "showDotfiles" BOOLEAN NOT NULL DEFAULT false,
  "confirmTrashDelete" BOOLEAN NOT NULL DEFAULT true,
  "confirmPermanentDelete" BOOLEAN NOT NULL DEFAULT true,
  "folderUploadMode" VARCHAR(24) NOT NULL DEFAULT 'preserveRoot',
  "nameCollisionRule" VARCHAR(24) NOT NULL DEFAULT 'autoRename',
  "uploadAutoRetry" BOOLEAN NOT NULL DEFAULT true,
  "uploadConcurrency" VARCHAR(12) NOT NULL DEFAULT 'auto',
  "generateTextSnippets" BOOLEAN NOT NULL DEFAULT true,
  "computeSha256" BOOLEAN NOT NULL DEFAULT true,
  "showUploadQueue" BOOLEAN NOT NULL DEFAULT true,
  "shareDefaultExpiryDays" INTEGER NOT NULL DEFAULT 7,
  "shareAccessPolicy" VARCHAR(32) NOT NULL DEFAULT 'anyone',
  "publishDefaultVisibility" "PublicArtifactVisibility" NOT NULL DEFAULT 'LINK_ONLY',
  "publishRequireConfirm" BOOLEAN NOT NULL DEFAULT true,
  "publishDefaultTitleMode" VARCHAR(16) NOT NULL DEFAULT 'filename',
  "publishDefaultExpiryDays" INTEGER NOT NULL DEFAULT 0,
  "trashRetentionDays" INTEGER NOT NULL DEFAULT 30,
  "autoPurgeTrash" BOOLEAN NOT NULL DEFAULT true,
  "preferDownloadUnknownBinary" BOOLEAN NOT NULL DEFAULT true,
  "notifyStorage80" BOOLEAN NOT NULL DEFAULT true,
  "notifyStorage95" BOOLEAN NOT NULL DEFAULT true,
  "notifyUploadFailures" BOOLEAN NOT NULL DEFAULT true,
  "notifyShareExpiringSoon" BOOLEAN NOT NULL DEFAULT true,
  "notifyArtifactPublished" BOOLEAN NOT NULL DEFAULT true,
  "notifyBulkDeletePurge" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CavCloudSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CavCloudSettings_accountId_userId_key" ON "CavCloudSettings"("accountId", "userId");
CREATE INDEX "CavCloudSettings_accountId_idx" ON "CavCloudSettings"("accountId");
CREATE INDEX "CavCloudSettings_userId_idx" ON "CavCloudSettings"("userId");

ALTER TABLE "CavCloudSettings"
  ADD CONSTRAINT "CavCloudSettings_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudSettings"
  ADD CONSTRAINT "CavCloudSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CavCloudShare_accountId_idx" ON "CavCloudShare"("accountId");

ALTER TABLE "CavCloudShare"
  ADD CONSTRAINT "CavCloudShare_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
