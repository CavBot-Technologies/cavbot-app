CREATE TABLE "SiteArcadeConfig" (
    "siteId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "gameSlug" TEXT,
    "gameVersion" TEXT NOT NULL DEFAULT 'v1',
    "optionsJson" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteArcadeConfig_pkey" PRIMARY KEY ("siteId"),
    CONSTRAINT "SiteArcadeConfig_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
