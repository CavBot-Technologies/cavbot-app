-- AlterTable
ALTER TABLE "NotificationSettings" ADD COLUMN     "digestEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "digestInApp" BOOLEAN NOT NULL DEFAULT false;
