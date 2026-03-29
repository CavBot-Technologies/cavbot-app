-- Add explicit file lifecycle state so folder-manifest rows are not treated as preview-ready before bytes exist.
CREATE TYPE "CavCloudFileStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');

ALTER TABLE "CavCloudFile"
  ADD COLUMN "status" "CavCloudFileStatus" NOT NULL DEFAULT 'READY';

CREATE INDEX "CavCloudFile_accountId_status_idx"
  ON "CavCloudFile"("accountId", "status");
