-- CavCloud usage trend points for real storage history charts
CREATE TABLE "CavCloudUsagePoint" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "usedBytes" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CavCloudUsagePoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CavCloudUsagePoint_accountId_bucketStart_key"
  ON "CavCloudUsagePoint"("accountId", "bucketStart");

CREATE INDEX "CavCloudUsagePoint_accountId_bucketStart_idx"
  ON "CavCloudUsagePoint"("accountId", "bucketStart");

ALTER TABLE "CavCloudUsagePoint"
  ADD CONSTRAINT "CavCloudUsagePoint_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
