import assert from "node:assert/strict";
import test from "node:test";

import {
  CAVAI_PRIORITY_SCHEMA_V1,
  CAVAI_RUN_META_SCHEMA_V1,
  NORMALIZED_SCAN_INPUT_SCHEMA_V1,
  parseFixPlanV1,
} from "@/packages/cavai-contracts/src";

test("Normalized input v1 schema applies version default and validates strict shape", () => {
  const parsed = NORMALIZED_SCAN_INPUT_SCHEMA_V1.safeParse({
    origin: "https://contracts.example",
    pagesSelected: ["/"],
    pageLimit: 5,
    findings: [
      {
        id: "fd_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://contracts.example",
        pagePath: "/",
        detectedAt: "2026-03-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.version, "cavai.normalized_input.v1");
});

test("Priority v1 schema requires evidenceFindingIds", () => {
  const parsed = CAVAI_PRIORITY_SCHEMA_V1.safeParse({
    code: "missing_title",
    pillar: "seo",
    severity: "high",
    title: "Fix title",
    summary: "Missing title on key pages.",
    affectedPages: 1,
    totalPagesScanned: 1,
    coverage: 1,
    severityWeight: 10,
    coverageWeight: 10,
    pageImportanceWeight: 10,
    crossPillarWeight: 0,
    effortPenalty: 2,
    persistenceWeight: 0,
    coreScore: 20,
    priorityScore: 20,
    confidence: "high",
    confidenceReason: "deterministic",
    evidenceFindingIds: [],
    nextActions: [],
  });
  assert.equal(parsed.success, false);
});

test("Fix-plan parser requires metadata and version fields", () => {
  const meta = CAVAI_RUN_META_SCHEMA_V1.parse({
    packVersion: "cavai.insightpack.v1",
    engineVersion: "cavai-core@1.2.0",
    createdAt: "2026-03-01T00:00:00.000Z",
    runId: "run_1",
    requestId: "req_1",
    origin: "https://contracts.example",
    accountId: "acct_1",
  });

  const ok = parseFixPlanV1({
    version: "cavai.fixplan.v1",
    meta,
    priorityCode: "missing_title",
    title: "Fix plan",
    targetArea: "template",
    evidenceFindingIds: ["fd_1"],
    steps: ["Do thing"],
    verificationSteps: ["Check thing"],
    openTargets: [],
  });
  assert.equal(ok.success, true);

  const bad = parseFixPlanV1({
    priorityCode: "missing_title",
  });
  assert.equal(bad.success, false);
});
