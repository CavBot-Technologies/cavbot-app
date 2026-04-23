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
});

test("embed analytics route records local activity after successful upstream delivery", () => {
  const routeSource = read("app/api/embed/analytics/route.ts");
  const helperSource = read("lib/security/embedAnalyticsTracker.server.ts");
  const metricsSource = read("lib/security/embedMetrics.server.ts");
  const footerSource = read("app/api/system-footer/metrics/route.ts");

  assert.equal(routeSource.includes("recordAnalyticsEmbedActivityBestEffort"), true);
  assert.equal(routeSource.includes("if (response.ok)"), true);
  assert.equal(helperSource.includes("'ANALYTICS'::\"EmbedInstallKind\""), true);
  assert.equal(helperSource.includes('"WorkspaceNotice"'), true);
  assert.equal(helperSource.includes('"SiteEvent"'), true);
  assert.equal(helperSource.includes("analytics_ingest"), true);
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
  assert.equal(fixesRoute.includes("requireWorkspaceResilientSession"), true);
  assert.equal(packRoute.includes("requireWorkspaceResilientSession"), true);
});
