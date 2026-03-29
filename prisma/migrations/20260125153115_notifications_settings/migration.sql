-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "promoEmail" BOOLEAN NOT NULL DEFAULT false,
    "productUpdates" BOOLEAN NOT NULL DEFAULT true,
    "billingEmails" BOOLEAN NOT NULL DEFAULT true,
    "securityEmails" BOOLEAN NOT NULL DEFAULT true,
    "inAppSignals" BOOLEAN NOT NULL DEFAULT true,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "quietHours" BOOLEAN NOT NULL DEFAULT false,
    "evtSubDue" BOOLEAN NOT NULL DEFAULT true,
    "evtSubRenewed" BOOLEAN NOT NULL DEFAULT true,
    "evtSubExpired" BOOLEAN NOT NULL DEFAULT true,
    "evtUpgraded" BOOLEAN NOT NULL DEFAULT true,
    "evtDowngraded" BOOLEAN NOT NULL DEFAULT true,
    "evtSiteCritical" BOOLEAN NOT NULL DEFAULT true,
    "evtSeatInviteAccepted" BOOLEAN NOT NULL DEFAULT true,
    "evtSeatLimitHit" BOOLEAN NOT NULL DEFAULT true,
    "evtNewFeatures" BOOLEAN NOT NULL DEFAULT true,
    "metaJson" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_userId_key" ON "NotificationSettings"("userId");

-- CreateIndex
CREATE INDEX "NotificationSettings_accountId_idx" ON "NotificationSettings"("accountId");

-- CreateIndex
CREATE INDEX "NotificationSettings_updatedAt_idx" ON "NotificationSettings"("updatedAt");

-- CreateIndex
CREATE INDEX "NotificationSettings_accountId_createdAt_idx" ON "NotificationSettings"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationSettings_userId_createdAt_idx" ON "NotificationSettings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationSettings_dedupeKey_idx" ON "NotificationSettings"("dedupeKey");

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
