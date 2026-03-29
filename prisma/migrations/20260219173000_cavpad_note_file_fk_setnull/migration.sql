-- Keep CavPad trash rows even if the linked CavCloud file is removed.
ALTER TABLE "CavPadNote"
  DROP CONSTRAINT IF EXISTS "CavPadNote_cavcloudFileId_fkey";

ALTER TABLE "CavPadNote"
  ALTER COLUMN "cavcloudFileId" DROP NOT NULL;

ALTER TABLE "CavPadNote"
  ADD CONSTRAINT "CavPadNote_cavcloudFileId_fkey"
  FOREIGN KEY ("cavcloudFileId") REFERENCES "CavCloudFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
