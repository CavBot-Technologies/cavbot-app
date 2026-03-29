/*
  Warnings:

  - A unique constraint covering the columns `[userId,accountId]` on the table `NotificationSettings` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "NotificationSettings_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_userId_accountId_key" ON "NotificationSettings"("userId", "accountId");
