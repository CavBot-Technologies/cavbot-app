import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichProjectSummaryWithLatestPack,
  enrichProjectSummaryWithLocalWebVitals,
  harmonizeProjectSummarySignals,
} from "../lib/projectSummaryEnrichment.server";
import type { ProjectSummary } from "../lib/cavbotTypes";
import type { CavAiLatestPackWithHistory } from "../lib/cavai/packs.server";
import type { SiteWebVitalsRollup } from "../lib/webVitals.server";

test("project summary enrichment backfills specialist diagnostics from the latest persisted pack", () => {
  const summary: ProjectSummary = {
    project: { id: "1", name: "CavBot", projectId: 1 },
    window: { range: "30d" },
    metrics: {
      sessions30d: 32,
      views40430d: 11,
      jsErrors30d: 3,
      apiErrors30d: 2,
      a11yIssues30d: 5,
      contrastFailures30d: 2,
      focusInvisible30d: 1,
      guardianScore: 80,
    },
  };

  const latestPack: CavAiLatestPackWithHistory = {
    origin: "https://cavbot.io",
    history: [
      {
        runId: "run_1",
        createdAtISO: "2026-04-22T20:00:00.000Z",
        generatedAtISO: "2026-04-22T20:00:00.000Z",
        pagesScanned: 1,
        pageLimit: 5,
        engineVersion: "v1",
        packVersion: "cavai.insightpack.v1",
        findingCount: 6,
        priorityCount: 4,
        topPriorityCode: "missing_title",
        topPriorityScore: 88,
        overlayDiffSummary: null,
      },
    ],
    pack: {
      packVersion: "cavai.insightpack.v1",
      engineVersion: "v1",
      inputHash: "hash",
      coreDeterministic: true,
      overlayIncluded: true,
      requestId: "req_1",
      runId: "run_1",
      accountId: "acct_1",
      origin: "https://cavbot.io",
      generatedAt: "2026-04-22T20:00:00.000Z",
      pagesScanned: 1,
      pageLimit: 5,
      core: {
        findings: [
          {
            id: "f_1",
            code: "missing_title",
            pillar: "seo",
            severity: "high",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
          {
            id: "f_2",
            code: "missing_canonical",
            pillar: "seo",
            severity: "medium",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
          {
            id: "f_3",
            code: "contrast_failure",
            pillar: "accessibility",
            severity: "medium",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
          {
            id: "f_4",
            code: "missing_form_labels",
            pillar: "accessibility",
            severity: "medium",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
          {
            id: "f_5",
            code: "status_404_misconfigured",
            pillar: "reliability",
            severity: "high",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/404",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
          {
            id: "f_6",
            code: "api_error_cluster",
            pillar: "reliability",
            severity: "high",
            evidence: [],
            origin: "https://cavbot.io",
            pagePath: "/api/demo",
            detectedAt: "2026-04-22T20:00:00.000Z",
          },
        ],
        patterns: [],
        priorities: [],
        explanations: [],
        nextActions: [],
        confidence: {
          level: "high",
          reason: "Synthetic test pack",
          evidenceFindingIds: ["f_1"],
        },
        risk: {
          level: "medium",
          reason: "Synthetic test pack",
          evidenceFindingIds: ["f_1"],
        },
      },
      priorities: [
        {
          code: "missing_title",
          pillar: "seo",
          severity: "high",
          title: "Missing title",
          summary: "Title tag is missing.",
          affectedPages: 1,
          totalPagesScanned: 1,
          coverage: 100,
          severityWeight: 1,
          coverageWeight: 1,
          pageImportanceWeight: 1,
          crossPillarWeight: 1,
          effortPenalty: 1,
          persistenceWeight: 1,
          coreScore: 1,
          priorityScore: 88,
          confidence: "high",
          confidenceReason: "Synthetic test pack",
          evidenceFindingIds: ["f_1"],
          nextActions: [],
        },
      ],
      explanations: [],
      nextActions: [],
      confidence: {
        level: "high",
        reason: "Synthetic test pack",
        evidenceFindingIds: ["f_1"],
      },
      risk: {
        level: "medium",
        reason: "Synthetic test pack",
        evidenceFindingIds: ["f_1"],
      },
      overlay: {
        historyWindow: 1,
        generatedFromRunIds: ["run_1"],
        codeHistory: {},
        trend: { state: "stagnating", reason: "Synthetic test pack" },
        fatigue: { level: "none", message: "Synthetic test pack" },
      },
    },
  };

  const enriched = enrichProjectSummaryWithLatestPack(summary, latestPack) as ProjectSummary & Record<string, unknown>;
  const diagnostics = enriched.diagnostics as Record<string, unknown>;
  const seo = diagnostics.seo as Record<string, unknown>;
  const seoRollup = seo.rollup as Record<string, unknown>;
  const a11y = diagnostics.a11y as Record<string, unknown>;
  const a11yRollup = a11y.rollup as Record<string, unknown>;
  const errors = diagnostics.errors as Record<string, unknown>;
  const errorTotals = errors.totals as Record<string, unknown>;
  const routes = diagnostics.routes as Record<string, unknown>;
  const routesRollup = routes.rollup as Record<string, unknown>;
  const controlRoom = enriched.controlRoom as Record<string, unknown>;

  assert.equal(diagnostics.guardianScore, 80);
  assert.equal(Array.isArray(diagnostics.guardianTrend), true);
  assert.equal(Array.isArray(diagnostics.trend7d), true);
  assert.equal(seoRollup.pagesObserved, 1);
  assert.equal(seoRollup.missingTitleCount, 1);
  assert.equal(seoRollup.missingCanonicalCount, 1);
  assert.equal(Array.isArray(seo.pages), true);
  assert.equal(a11yRollup.missingFormLabelCount, 1);
  assert.equal(a11yRollup.contrastFailCount, 2);
  assert.equal(errorTotals.jsErrors, 3);
  assert.equal(errorTotals.apiErrors, 2);
  assert.equal(Array.isArray(errors.groups), true);
  assert.equal(routesRollup.views404Count, 11);
  assert.equal(Array.isArray(routes.topRoutes), true);
  assert.equal(controlRoom.views404Total, 11);
  assert.equal(controlRoom.unique404Routes, 1);
});

test("summary harmonization strips the frozen guardian score when no real supporting signals exist", () => {
  const summary: ProjectSummary = {
    project: { id: "1", name: "CavBot", projectId: 1 },
    window: { range: "30d" },
    metrics: {
      guardianScore: 80,
    },
  };

  const harmonized = harmonizeProjectSummarySignals(summary) as ProjectSummary & Record<string, unknown>;
  const metrics = harmonized.metrics as Record<string, unknown>;

  assert.equal("guardianScore" in harmonized, false);
  assert.equal("guardianScore" in metrics, false);
});

test("local web vitals enrichment backfills both rollup fields and legacy console vitals keys", () => {
  const summary: ProjectSummary = {
    project: { id: "1", name: "CavBot", projectId: 1 },
    window: { range: "30d" },
    metrics: {},
  };
  const rollup: SiteWebVitalsRollup = {
    updatedAtISO: "2026-04-23T06:15:00.000Z",
    samples: 19,
    lcpP75Ms: 2100,
    inpP75Ms: 165,
    clsP75: 0.08,
    fcpP75Ms: 980,
    ttfbP75Ms: 420,
    slowPagesCount: 1,
    unstableLayoutPages: 0,
  };

  const enriched = enrichProjectSummaryWithLocalWebVitals(summary, rollup) as ProjectSummary & Record<string, unknown>;
  const metrics = enriched.metrics as Record<string, unknown>;
  const webVitals = enriched.webVitals as Record<string, unknown>;
  const vitalsRollup = webVitals.rollup as Record<string, unknown>;

  assert.equal(vitalsRollup.samples, 19);
  assert.equal(vitalsRollup.lcpP75Ms, 2100);
  assert.equal(vitalsRollup.inpP75Ms, 165);
  assert.equal(vitalsRollup.fcpP75Ms, 980);
  assert.equal(vitalsRollup.ttfbP75Ms, 420);
  assert.equal(metrics.avgLcpMs, 2100);
  assert.equal(metrics.avgTtfbMs, 420);
  assert.equal(metrics.globalCls, 0.08);
  assert.equal(metrics.slowPagesCount, 1);
  assert.equal(metrics.unstableLayoutPages, 0);
});
