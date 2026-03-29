import assert from "node:assert/strict";
import test from "node:test";
import { applyOverlay, buildDeterministicCore, buildInputHash } from "@/packages/cavai-core/src";
import { validateInsightPackV1, type NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";

const BASE_INPUT: NormalizedScanInputV1 = {
  origin: "https://acme.example",
  pagesSelected: ["/", "/pricing", "/docs/install", "/blog/post-1", "/dashboard"],
  pageLimit: 10,
  findings: [
    {
      id: "f_1",
      code: "route_http_404",
      pillar: "reliability",
      severity: "critical",
      evidence: [{ type: "http", url: "https://acme.example/", status: 404, method: "GET" }],
      origin: "https://acme.example",
      pagePath: "/",
      templateHint: "marketing_home",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
    {
      id: "f_2",
      code: "route_http_404",
      pillar: "reliability",
      severity: "critical",
      evidence: [{ type: "route", path: "/pricing", statusCode: 404, reason: "missing route" }],
      origin: "https://acme.example",
      pagePath: "/pricing",
      templateHint: "marketing_page",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
    {
      id: "f_3",
      code: "missing_meta_description",
      pillar: "seo",
      severity: "medium",
      evidence: [{ type: "dom", selector: "meta[name='description']" }],
      origin: "https://acme.example",
      pagePath: "/docs/install",
      templateHint: "docs_template",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
    {
      id: "f_4",
      code: "missing_meta_description",
      pillar: "seo",
      severity: "medium",
      evidence: [{ type: "dom", selector: "meta[name='description']" }],
      origin: "https://acme.example",
      pagePath: "/pricing",
      templateHint: "marketing_page",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
    {
      id: "f_5",
      code: "missing_alt",
      pillar: "accessibility",
      severity: "medium",
      evidence: [{ type: "metric", name: "missing_alt_count", value: 4 }],
      origin: "https://acme.example",
      pagePath: "/blog/post-1",
      templateHint: "blog_post",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
  ],
};

function buildPack() {
  return buildDeterministicCore(BASE_INPUT, {
    engineVersion: "cavai-core@1.0.0",
    requestId: "req_fixed",
    runId: "run_fixed",
    accountId: "acct_fixed",
    generatedAt: "2026-02-18T00:00:00.000Z",
    inputHash: buildInputHash(BASE_INPUT),
  });
}

test("core output is deterministic and stable for identical input + engineVersion", () => {
  const first = buildPack();
  const second = buildPack();
  assert.deepEqual(first.core, second.core);
  assert.deepEqual(first.priorities, second.priorities);

  const top = first.priorities[0];
  assert.equal(top.code, "route_http_404");
  assert.equal(top.severityWeight, 40);
  assert.equal(top.coverageWeight, 14); // 2/5 coverage => >=0.40
  assert.equal(top.pageImportanceWeight, 18); // "/" present
  assert.equal(top.crossPillarWeight, 0);
  assert.equal(top.effortPenalty, 10);
  assert.equal(top.coreScore, 70); // critical floor

  const validation = validateInsightPackV1(first);
  assert.equal(validation.ok, true);
});

test("overlay persistence adjusts score deterministically with exact weight formula", () => {
  const core = buildPack();
  const overlaid = applyOverlay(core, {
    historyWindow: 5,
    generatedFromRunIds: ["run_fixed", "run_older"],
    codeHistory: {
      route_http_404: { runsSeen: 3, consecutiveRuns: 3 },
      missing_meta_description: { runsSeen: 2, consecutiveRuns: 1 },
      missing_alt: { runsSeen: 1, consecutiveRuns: 1 },
    },
    diff: {
      resolvedCodes: ["legacy_fixed"],
      newCodes: ["route_http_404"],
      persistedCodes: ["missing_meta_description"],
      summary: "1 resolved · 1 new · 1 persisted",
    },
    praise: {
      line: "Deterministic posture improved.",
      reason: "Resolved one recurring code.",
      nextPriorityCode: "missing_meta_description",
    },
    trend: {
      state: "degrading",
      reason: "Current run has more findings.",
    },
    fatigue: {
      level: "high",
      message: "Repeated issues persisted across 3 or more consecutive runs.",
    },
  });

  const top = overlaid.priorities[0];
  assert.equal(top.code, "route_http_404");
  assert.equal(top.persistenceWeight, 12); // min(12, (3*2)+(3*2))
  assert.equal(top.priorityScore, 74); // 40 + 14 + 18 + 0 + 12 - 10
  assert.equal(overlaid.overlayIncluded, true);
  assert.equal(overlaid.overlay?.fatigue.level, "high");
  assert.ok(overlaid.overlay?.diff);
  assert.ok(overlaid.overlay?.praise);
  assert.match(String(overlaid.overlay?.diff?.summary || ""), /resolved|new|persisted/i);

  const validation = validateInsightPackV1(overlaid);
  assert.equal(validation.ok, true);
});

test("missing_favicon yields deterministic guidance with evidence-linked actions", () => {
  const input: NormalizedScanInputV1 = {
    origin: "https://brand.example",
    pagesSelected: ["/", "/pricing"],
    pageLimit: 5,
    findings: [
      {
        id: "fav_1",
        code: "missing_favicon",
        pillar: "seo",
        severity: "medium",
        evidence: [
          { type: "dom", selector: "link[rel~=\"icon\"]", snippet: "No favicon link tag detected in <head>." },
          { type: "http", url: "https://brand.example/favicon.ico", method: "HEAD", status: 404 },
        ],
        origin: "https://brand.example",
        pagePath: "/",
        templateHint: "marketing_home",
        detectedAt: "2026-02-18T00:00:00.000Z",
      },
    ],
  };

  const first = buildDeterministicCore(input, {
    engineVersion: "cavai-core@1.0.0",
    requestId: "req_favicon",
    runId: "run_favicon",
    accountId: "acct_favicon",
    generatedAt: "2026-02-18T00:00:00.000Z",
    inputHash: buildInputHash(input),
  });
  const second = buildDeterministicCore(input, {
    engineVersion: "cavai-core@1.0.0",
    requestId: "req_favicon",
    runId: "run_favicon",
    accountId: "acct_favicon",
    generatedAt: "2026-02-18T00:00:00.000Z",
    inputHash: buildInputHash(input),
  });

  assert.deepEqual(first.core, second.core);

  const priority = first.priorities[0];
  assert.equal(priority.code, "missing_favicon");
  assert.equal(priority.effortPenalty, 2);
  assert.equal(priority.nextActions[0].safeAutoFix, false);
  assert.match(priority.nextActions[0].detail, /favicon-32x32\.png/);
  assert.match(priority.nextActions[0].detail, /site\.webmanifest/);

  const explanation = first.explanations.find((item) => item.id === "priority_missing_favicon");
  assert.ok(explanation);
  assert.match(String(explanation?.text || ""), /A favicon is your site's icon/);
  assert.match(String(explanation?.text || ""), /\/favicon\.ico is unavailable/);
  assert.deepEqual(explanation?.evidenceFindingIds, ["fav_1"]);

  const validation = validateInsightPackV1(first);
  assert.equal(validation.ok, true);
});
