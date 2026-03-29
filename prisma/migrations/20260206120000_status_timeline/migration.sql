CREATE TABLE "StatusService" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StatusService_slug_key" ON "StatusService"("slug");
CREATE INDEX "StatusService_slug_idx" ON "StatusService"("slug");

CREATE TABLE "StatusSample" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "dayKey" VARCHAR(10) NOT NULL,
    "status" "ServiceStatusState" NOT NULL,
    "message" TEXT,
    "incidentId" TEXT,
    "component" TEXT,
    "durationMs" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StatusSample_serviceId_dayKey_idx" ON "StatusSample"("serviceId", "dayKey");
CREATE INDEX "StatusSample_occurredAt_idx" ON "StatusSample"("occurredAt");

ALTER TABLE "StatusSample" ADD CONSTRAINT "StatusSample_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "StatusService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
