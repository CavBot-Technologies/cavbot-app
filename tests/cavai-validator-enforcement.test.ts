import assert from "node:assert/strict";
import test from "node:test";
import { buildDeterministicCore, buildInputHash } from "@/packages/cavai-core/src";
import { validateInsightPackV1, type NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";

const INPUT: NormalizedScanInputV1 = {
  origin: "https://validator.example",
  pagesSelected: ["/", "/pricing"],
  pageLimit: 8,
  findings: [
    {
      id: "fd_1",
      code: "missing_title",
      pillar: "seo",
      severity: "high",
      evidence: [{ type: "dom", selector: "title" }],
      origin: "https://validator.example",
      pagePath: "/",
      templateHint: "home",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
    {
      id: "fd_2",
      code: "missing_title",
      pillar: "seo",
      severity: "high",
      evidence: [{ type: "dom", selector: "title" }],
      origin: "https://validator.example",
      pagePath: "/pricing",
      templateHint: "pricing",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
  ],
};

function basePack() {
  return buildDeterministicCore(INPUT, {
    engineVersion: "cavai-core@1.0.0",
    requestId: "req_validator",
    runId: "run_validator",
    accountId: "acct_validator",
    generatedAt: "2026-02-18T00:00:00.000Z",
    inputHash: buildInputHash(INPUT),
  });
}

test("validator rejects priorities without evidenceFindingIds", () => {
  const pack = basePack();
  pack.priorities[0].evidenceFindingIds = [];
  const result = validateInsightPackV1(pack);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "PRIORITY_EVIDENCE_EMPTY"), true);
});

test("validator rejects explanation evidence ids that do not exist", () => {
  const pack = basePack();
  pack.explanations[0].evidenceFindingIds = ["missing_finding_id"];
  const result = validateInsightPackV1(pack);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "EVIDENCE_ID_UNKNOWN"), true);
});

test("validator rejects unknown priority codes not present in findings", () => {
  const pack = basePack();
  pack.priorities[0].code = "unknown_code";
  const result = validateInsightPackV1(pack);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "PRIORITY_CODE_UNKNOWN"), true);
});

test("validator enforces evidenceFindingIds for missing_favicon explanation blocks", () => {
  const pack = basePack();
  pack.core.findings = [
    {
      id: "fav_1",
      code: "missing_favicon",
      pillar: "seo",
      severity: "medium",
      evidence: [
        { type: "dom", selector: "link[rel~=\"icon\"]" },
        { type: "http", url: "https://validator.example/favicon.ico", status: 404, method: "HEAD" },
      ],
      origin: "https://validator.example",
      pagePath: "/",
      templateHint: "marketing_home",
      detectedAt: "2026-02-18T00:00:00.000Z",
    },
  ];
  pack.explanations = [
    {
      id: "priority_missing_favicon",
      title: "Priority: Resolve Missing favicon",
      text: "A favicon is your site's icon in browser tabs.",
      evidenceFindingIds: [],
    },
  ];
  const result = validateInsightPackV1(pack);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "EXPLANATION_EVIDENCE_EMPTY"), true);
});

test("validator rejects missing_favicon explanation references to unknown finding ids", () => {
  const pack = basePack();
  pack.explanations = [
    {
      id: "priority_missing_favicon",
      title: "Priority: Resolve Missing favicon",
      text: "Fix: add favicon assets + head links.",
      evidenceFindingIds: ["favicon_not_real"],
    },
  ];
  const result = validateInsightPackV1(pack);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "EVIDENCE_ID_UNKNOWN"), true);
});
