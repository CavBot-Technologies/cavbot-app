-- Team invites v2: user-targeted invites + access requests

CREATE TYPE "WorkspaceInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
CREATE TYPE "WorkspaceAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');

ALTER TABLE "Invite"
  ADD COLUMN "inviteeEmail" TEXT,
  ADD COLUMN "inviteeUserId" TEXT,
  ADD COLUMN "status" "WorkspaceInviteStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Invite"
SET "status" = CASE
  WHEN "acceptedAt" IS NOT NULL THEN 'ACCEPTED'::"WorkspaceInviteStatus"
  WHEN "expiresAt" <= NOW() THEN 'EXPIRED'::"WorkspaceInviteStatus"
  ELSE 'PENDING'::"WorkspaceInviteStatus"
END;

CREATE TABLE "WorkspaceAccessRequest" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "status" "WorkspaceAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  "respondedByUserId" TEXT,

  CONSTRAINT "WorkspaceAccessRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_inviteeUserId_fkey"
  FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAccessRequest"
  ADD CONSTRAINT "WorkspaceAccessRequest_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAccessRequest"
  ADD CONSTRAINT "WorkspaceAccessRequest_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceAccessRequest"
  ADD CONSTRAINT "WorkspaceAccessRequest_respondedByUserId_fkey"
  FOREIGN KEY ("respondedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Invite_accountId_status_idx" ON "Invite"("accountId", "status");
CREATE INDEX "Invite_inviteeUserId_status_idx" ON "Invite"("inviteeUserId", "status");
CREATE INDEX "Invite_inviteeEmail_status_idx" ON "Invite"("inviteeEmail", "status");
CREATE INDEX "WorkspaceAccessRequest_accountId_status_idx" ON "WorkspaceAccessRequest"("accountId", "status");
CREATE INDEX "WorkspaceAccessRequest_requesterUserId_status_idx" ON "WorkspaceAccessRequest"("requesterUserId", "status");
