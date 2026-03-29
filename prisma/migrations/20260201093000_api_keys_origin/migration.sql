-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ALLOWLIST_UPDATED';

-- CreateType
CREATE TYPE "SiteAllowedOriginMatchType" AS ENUM ('EXACT','WILDCARD_SUBDOMAIN');

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "value" TEXT,
ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT '{}',
ADD COLUMN "lastUsedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SiteAllowedOrigin" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "matchType" "SiteAllowedOriginMatchType" NOT NULL DEFAULT 'EXACT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAllowedOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteAllowedOrigin_site_origin_key" ON "SiteAllowedOrigin"("siteId","origin");

-- CreateIndex
CREATE INDEX "SiteAllowedOrigin_siteId_idx" ON "SiteAllowedOrigin"("siteId");

-- AddForeignKey
ALTER TABLE "SiteAllowedOrigin" ADD CONSTRAINT "SiteAllowedOrigin_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
