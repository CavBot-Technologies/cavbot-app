-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SITE_DELETION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'SITE_ANALYTICS_PURGED';

-- DropForeignKey
ALTER TABLE "SiteDeletion" DROP CONSTRAINT "SiteDeletion_accountId_fkey";

-- DropForeignKey
ALTER TABLE "SiteDeletion" DROP CONSTRAINT "SiteDeletion_operatorUserId_fkey";

-- DropForeignKey
ALTER TABLE "SiteDeletion" DROP CONSTRAINT "SiteDeletion_projectId_fkey";

-- DropForeignKey
ALTER TABLE "SiteDeletion" DROP CONSTRAINT "SiteDeletion_siteId_fkey";

-- AlterTable
ALTER TABLE "SiteDeletion" ALTER COLUMN "requestedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "purgeScheduledAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "purgedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SiteDeletion_accountId_idx" ON "SiteDeletion"("accountId");

-- CreateIndex
CREATE INDEX "SiteDeletion_mode_idx" ON "SiteDeletion"("mode");

-- CreateIndex
CREATE INDEX "SiteDeletion_status_idx" ON "SiteDeletion"("status");

-- CreateIndex
CREATE INDEX "SiteDeletion_purgeScheduledAt_idx" ON "SiteDeletion"("purgeScheduledAt");

-- AddForeignKey
ALTER TABLE "SiteDeletion" ADD CONSTRAINT "SiteDeletion_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDeletion" ADD CONSTRAINT "SiteDeletion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDeletion" ADD CONSTRAINT "SiteDeletion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteDeletion" ADD CONSTRAINT "SiteDeletion_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
