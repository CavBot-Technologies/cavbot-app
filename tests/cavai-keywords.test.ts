import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import { augmentKeywordFindings } from "@/lib/cavai/keywords.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function fixture(): NormalizedScanInputV1 {
  return {
    origin: "https://saas.example",
    pagesSelected: ["/docs"],
    pageLimit: 10,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://saas.example",
        pagePath: "/docs",
        templateHint: "docs",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      traits: {
        siteProfile: "software",
      },
      routeMetadata: {
        keywords: {
          candidates: [
            { term: "platform", count: 8, sources: ["title"] },
            { term: "features", count: 5, sources: ["h1"] },
            { term: "dashboard", count: 4, sources: ["main"] },
          ],
        },
        authFunnel: {
          loginAttempts: 100,
          loginFailures: 34,
          signupAttempts: 60,
          signupFailures: 18,
          errorClusters: [
            { fingerprint: "AUTH_500_TIMEOUT", hits: 18 },
          ],
        },
      },
    },
  };
}

test("keywords augmenter emits cluster gaps and auth funnel findings", async () => {
  const findings = await augmentKeywordFindings({ input: fixture() });

  assert.equal(findings.some((row) => row.code === "keyword_cluster_gap"), true);
  assert.equal(findings.some((row) => row.code === "auth_login_failure_spike"), true);
  assert.equal(findings.some((row) => row.code === "signup_failure_spike"), true);
  assert.equal(findings.some((row) => row.code === "auth_endpoint_error_cluster"), true);
});
