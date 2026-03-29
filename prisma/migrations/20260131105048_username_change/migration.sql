-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'USERNAME_CHANGED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastUsernameChangeAt" TIMESTAMP(3),
ADD COLUMN     "usernameChangeCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UsernameHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "operatorUserId" TEXT,
    "oldUsername" VARCHAR(40),
    "newUsername" VARCHAR(40) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsernameHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsernameTombstone" (
    "id" TEXT NOT NULL,
    "usernameLower" VARCHAR(40) NOT NULL,
    "userId" TEXT NOT NULL,
    "burnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "UsernameTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsernameHistory_userId_idx" ON "UsernameHistory"("userId");

-- CreateIndex
CREATE INDEX "UsernameHistory_accountId_idx" ON "UsernameHistory"("accountId");

-- CreateIndex
CREATE INDEX "UsernameHistory_operatorUserId_idx" ON "UsernameHistory"("operatorUserId");

-- CreateIndex
CREATE INDEX "UsernameHistory_changedAt_idx" ON "UsernameHistory"("changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameTombstone_usernameLower_key" ON "UsernameTombstone"("usernameLower");

-- CreateIndex
CREATE INDEX "UsernameTombstone_userId_idx" ON "UsernameTombstone"("userId");

-- CreateIndex
CREATE INDEX "UsernameTombstone_burnedAt_idx" ON "UsernameTombstone"("burnedAt");

-- AddForeignKey
ALTER TABLE "UsernameHistory" ADD CONSTRAINT "UsernameHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameHistory" ADD CONSTRAINT "UsernameHistory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameHistory" ADD CONSTRAINT "UsernameHistory_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsernameTombstone" ADD CONSTRAINT "UsernameTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
