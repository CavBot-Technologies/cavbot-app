CREATE TYPE "ServiceStatusState" AS ENUM ('HEALTHY', 'AT_RISK', 'INCIDENT', 'UNKNOWN');
CREATE TYPE "IncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');
CREATE TYPE "IncidentImpact" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

CREATE TABLE "ServiceStatus" (
    "id" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "ServiceStatusState" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastLatencyMs" INTEGER,
    "errorMessage" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "region" TEXT NOT NULL DEFAULT 'global',
    "metaJson" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceStatus_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServiceStatus_serviceKey_key" ON "ServiceStatus"("serviceKey");
CREATE INDEX "ServiceStatus_status_idx" ON "ServiceStatus"("status");

CREATE TABLE "ServiceStatusHistory" (
    "id" TEXT NOT NULL,
    "serviceStatusId" TEXT NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "status" "ServiceStatusState" NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "region" TEXT NOT NULL DEFAULT 'global',
    "metaJson" JSONB,
    CONSTRAINT "ServiceStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceStatusHistory_serviceKey_checkedAt_idx" ON "ServiceStatusHistory"("serviceKey", "checkedAt");

ALTER TABLE "ServiceStatusHistory" ADD CONSTRAINT "ServiceStatusHistory_serviceStatusId_fkey" FOREIGN KEY ("serviceStatusId") REFERENCES "ServiceStatus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "impact" "IncidentImpact" NOT NULL DEFAULT 'MINOR',
    "body" TEXT,
    "affectedServices" TEXT[] NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);
