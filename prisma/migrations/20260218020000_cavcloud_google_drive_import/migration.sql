-- Google Drive integration + CavCloud import sessions

-- Extend operation kinds for server-side history events.
ALTER TYPE "CavCloudOperationKind" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE_CONNECTED';
ALTER TYPE "CavCloudOperationKind" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE_DISCONNECTED';
ALTER TYPE "CavCloudOperationKind" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE_IMPORT_STARTED';
ALTER TYPE "CavCloudOperationKind" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE_IMPORT_COMPLETED';
ALTER TYPE "CavCloudOperationKind" ADD VALUE IF NOT EXISTS 'GOOGLE_DRIVE_IMPORT_FILE_FAILED';

CREATE TYPE "IntegrationProvider" AS ENUM ('GOOGLE_DRIVE');
CREATE TYPE "CavCloudImportSessionStatus" AS ENUM ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "CavCloudImportItemKind" AS ENUM ('FILE', 'FOLDER');
CREATE TYPE "CavCloudImportItemStatus" AS ENUM ('PENDING', 'IMPORTING', 'IMPORTED', 'FAILED');

CREATE TABLE "IntegrationCredential" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "refreshTokenEnc" TEXT NOT NULL,
  "scopes" TEXT NOT NULL DEFAULT '',
  "providerUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavCloudImportSession" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "targetFolderId" TEXT NOT NULL,
  "status" "CavCloudImportSessionStatus" NOT NULL DEFAULT 'CREATED',
  "discoveredCount" INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudImportSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CavCloudImportItem" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerItemId" TEXT NOT NULL,
  "providerPath" TEXT NOT NULL,
  "kind" "CavCloudImportItemKind" NOT NULL,
  "status" "CavCloudImportItemStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode" VARCHAR(64),
  "failureMessageSafe" TEXT,
  "cavCloudFileId" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CavCloudImportItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationCredential_accountId_userId_provider_key"
  ON "IntegrationCredential"("accountId", "userId", "provider");

CREATE INDEX "IntegrationCredential_accountId_provider_idx"
  ON "IntegrationCredential"("accountId", "provider");

CREATE INDEX "CavCloudImportSession_accountId_userId_createdAt_idx"
  ON "CavCloudImportSession"("accountId", "userId", "createdAt" DESC);

CREATE INDEX "CavCloudImportSession_accountId_status_updatedAt_idx"
  ON "CavCloudImportSession"("accountId", "status", "updatedAt" DESC);

CREATE INDEX "CavCloudImportItem_sessionId_status_idx"
  ON "CavCloudImportItem"("sessionId", "status");

CREATE INDEX "CavCloudImportItem_accountId_createdAt_idx"
  ON "CavCloudImportItem"("accountId", "createdAt" DESC);

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationCredential"
  ADD CONSTRAINT "IntegrationCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportSession"
  ADD CONSTRAINT "CavCloudImportSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportSession"
  ADD CONSTRAINT "CavCloudImportSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportSession"
  ADD CONSTRAINT "CavCloudImportSession_targetFolderId_fkey"
  FOREIGN KEY ("targetFolderId") REFERENCES "CavCloudFolder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportItem"
  ADD CONSTRAINT "CavCloudImportItem_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "CavCloudImportSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportItem"
  ADD CONSTRAINT "CavCloudImportItem_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CavCloudImportItem"
  ADD CONSTRAINT "CavCloudImportItem_cavCloudFileId_fkey"
  FOREIGN KEY ("cavCloudFileId") REFERENCES "CavCloudFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
