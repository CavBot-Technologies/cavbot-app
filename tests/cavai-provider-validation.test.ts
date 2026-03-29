import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeterministicCore,
  buildInputHash,
  validateCodeFixProposalAgainstInsightPack,
  validateNarrationAgainstInsightPack,
} from "@/packages/cavai-core/src";
import type {
  CavAiCodeFixProposalV1,
  CavAiNarrationV1,
  NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";

const INPUT: NormalizedScanInputV1 = {
  origin: "https://provider.example",
  pagesSelected: ["/"],
  pageLimit: 5,
  findings: [
    {
      id: "fd_1",
      code: "missing_title",
      pillar: "seo",
      severity: "high",
      evidence: [{ type: "dom", selector: "title" }],
      origin: "https://provider.example",
      pagePath: "/",
      templateHint: "home",
      detectedAt: "2026-03-01T00:00:00.000Z",
    },
  ],
};

function buildPack() {
  return buildDeterministicCore(INPUT, {
    engineVersion: "cavai-core@1.1.0",
    requestId: "req_provider",
    runId: "run_provider",
    accountId: "acct_provider",
    generatedAt: "2026-03-01T00:00:00.000Z",
    inputHash: buildInputHash(INPUT),
  });
}

test("narration validation rejects unknown evidence ids", () => {
  const pack = buildPack();
  const narration: CavAiNarrationV1 = {
    version: "cavai.narration.v1",
    runId: pack.runId,
    origin: pack.origin,
    generatedAt: pack.generatedAt,
    summary: "Summary",
    blocks: [
      {
        id: "b1",
        title: "Claim",
        text: "Text",
        evidenceFindingIds: ["missing_finding"],
      },
    ],
  };
  const result = validateNarrationAgainstInsightPack(pack, narration);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "EVIDENCE_ID_UNKNOWN"), true);
});

test("code-fix proposal validation requires known priority code", () => {
  const pack = buildPack();
  const proposal: CavAiCodeFixProposalV1 = {
    version: "cavai.codefixproposal.v1",
    runId: pack.runId,
    priorityCode: "unknown_code",
    title: "Fix",
    rationale: "Reason",
    evidenceFindingIds: pack.priorities[0]?.evidenceFindingIds || [],
    patches: [
      {
        filePath: "/app/page.tsx",
        unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
      },
    ],
    openTargets: [],
  };
  const result = validateCodeFixProposalAgainstInsightPack(pack, proposal);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.some((error) => error.code === "PRIORITY_NOT_FOUND"), true);
});
