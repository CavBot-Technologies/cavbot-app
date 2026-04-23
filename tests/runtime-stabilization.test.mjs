import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("legacy sites route stays on runtime-safe workspace wiring", () => {
  const source = read("app/api/sites/route.ts");

  assert.equal(source.includes('from "@/lib/prisma"'), false);
  assert.equal(source.includes('from "@prisma/client"'), false);
  assert.equal(source.includes("getAuthPool"), true);
  assert.equal(source.includes("createWorkspaceSite"), true);
  assert.equal(source.includes("createDefaultAllowedOriginsForSite"), true);
  assert.equal(source.includes("rollbackCreatedWorkspaceSite"), true);
  assert.equal(source.includes("registerWorkerSite"), true);
  assert.equal(source.includes("markWorkspaceSiteVerified"), true);
  assert.equal(source.includes("requestInitialSiteScanBestEffort"), true);
  assert.equal(source.includes("initialScan"), true);
});

test("embed analytics route records local activity after successful upstream delivery", () => {
  const routeSource = read("app/api/embed/analytics/route.ts");
  const helperSource = read("lib/security/embedAnalyticsTracker.server.ts");
  const metricsSource = read("lib/security/embedMetrics.server.ts");
  const footerSource = read("app/api/system-footer/metrics/route.ts");

  assert.equal(routeSource.includes("recordAnalyticsEmbedActivityBestEffort"), true);
  assert.equal(routeSource.includes("if (response.ok)"), true);
  assert.equal(routeSource.includes("payload: canonicalPayload"), true);
  assert.equal(helperSource.includes("'ANALYTICS'::\"EmbedInstallKind\""), true);
  assert.equal(helperSource.includes('"WorkspaceNotice"'), true);
  assert.equal(helperSource.includes('"SiteEvent"'), true);
  assert.equal(helperSource.includes("analytics_ingest"), true);
  assert.equal(helperSource.includes("markWorkspaceSiteVerified"), true);
  assert.equal(helperSource.includes("recordWebVitalsSamplesBestEffort"), true);
  assert.equal(helperSource.includes("Telemetry warm scan"), true);
  assert.equal(metricsSource.includes('from "@/lib/prisma"'), false);
  assert.equal(metricsSource.includes('"EmbedVerificationMetric"'), true);
  assert.equal(footerSource.includes('from "@/lib/prisma"'), false);
  assert.equal(footerSource.includes("getAuthPool"), true);
});

test("cavai persistence paths avoid prisma runtime access on production routes", () => {
  const packsSource = read("lib/cavai/packs.server.ts");
  const intelligenceSource = read("lib/cavai/intelligence.server.ts");
  const diagnosticsRoute = read("app/api/cavai/diagnostics/route.ts");
  const metricsRoute = read("app/api/metrics/route.ts");
  const fixesRoute = read("app/api/cavai/fixes/route.ts");
  const packRoute = read("app/api/cavai/packs/route.ts");

  assert.equal(packsSource.includes('from "@/lib/prisma"'), false);
  assert.equal(packsSource.includes("getAuthPool"), true);
  assert.equal(packsSource.includes('"CavAiRun"'), true);
  assert.equal(intelligenceSource.includes('from "@/lib/prisma"'), false);
  assert.equal(intelligenceSource.includes("withAuthTransaction"), true);
  assert.equal(intelligenceSource.includes('"CavAiInsightPack"'), true);
  assert.equal(intelligenceSource.includes('"CavAiFinding"'), true);
  assert.equal(diagnosticsRoute.includes("requireWorkspaceResilientSession"), true);
  assert.equal(metricsRoute.includes("requireWorkspaceResilientSession"), true);
  assert.equal(metricsRoute.includes("requestInitialSiteScanBestEffort"), true);
  assert.equal(metricsRoute.includes("findOwnedWorkspaceSiteByOrigin"), true);
  assert.equal(metricsRoute.includes("diagnosticsPending"), true);
  assert.equal(metricsRoute.includes("initialScan"), true);
  assert.equal(fixesRoute.includes("requireWorkspaceResilientSession"), true);
  assert.equal(packRoute.includes("requireWorkspaceResilientSession"), true);
});

test("scan completion now bridges raw scan artifacts into persisted CavAi packs", () => {
  const scannerSource = read("lib/scanner.ts");
  const diagnosticsSource = read("app/api/cavai/diagnostics/route.ts");
  const pipelineSource = read("lib/cavai/pipeline.server.ts");
  const bridgeSource = read("lib/cavai/scanBridge.server.ts");
  const statusSource = read("lib/workspaceScans.server.ts");

  assert.equal(scannerSource.includes("generateInsightPackFromScanArtifacts"), true);
  assert.equal(scannerSource.includes("DIAGNOSTICS_GENERATION_FAILED"), true);
  assert.equal(scannerSource.includes("requestInitialSiteScanBestEffort"), true);
  assert.equal(scannerSource.includes("classifyInitialSiteScanFailure"), true);
  assert.equal(diagnosticsSource.includes("generateInsightPackFromInput"), true);
  assert.equal(pipelineSource.includes("augmentKeywordFindings"), true);
  assert.equal(pipelineSource.includes("findIdempotentPack"), true);
  assert.equal(bridgeSource.includes("createNormalizedScanInputFromScanArtifacts"), true);
  assert.equal(statusSource.includes("diagnosticsReady"), true);
  assert.equal(statusSource.includes("diagnosticsFailureReason"), true);
});

test("status probes and workspace site helpers align to the app-hosted analytics asset", () => {
  const statusSource = read("lib/status/constants.ts");
  const helperSource = read("lib/workspaceSites.server.ts");

  assert.equal(statusSource.includes('url: "/cavai/cavai-analytics-v5.js"'), true);
  assert.equal(statusSource.includes('url: "/sdk/v5/cavai-analytics-v5.min.js"'), false);
  assert.equal(helperSource.includes("export async function findOwnedWorkspaceSiteByOrigin"), true);
});
