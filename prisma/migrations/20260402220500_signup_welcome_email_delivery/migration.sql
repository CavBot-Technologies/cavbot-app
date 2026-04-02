CREATE TABLE "SignupWelcomeEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "templateRef" VARCHAR(160) NOT NULL DEFAULT 'cavbot-sign-up',
    "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "processingToken" VARCHAR(96),
    "sentAt" TIMESTAMP(3),
    "resendMessageId" VARCHAR(191),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupWelcomeEmail_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignupWelcomeEmail_userId_key" ON "SignupWelcomeEmail"("userId");
CREATE INDEX "SignupWelcomeEmail_status_idx" ON "SignupWelcomeEmail"("status");
CREATE INDEX "SignupWelcomeEmail_sentAt_idx" ON "SignupWelcomeEmail"("sentAt");
CREATE INDEX "SignupWelcomeEmail_lastAttemptedAt_idx" ON "SignupWelcomeEmail"("lastAttemptedAt");
CREATE INDEX "SignupWelcomeEmail_processingStartedAt_idx" ON "SignupWelcomeEmail"("processingStartedAt");

ALTER TABLE "SignupWelcomeEmail"
ADD CONSTRAINT "SignupWelcomeEmail_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
