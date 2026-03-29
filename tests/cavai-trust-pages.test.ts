import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import { augmentTrustPageFindings } from "@/lib/cavai/trust-pages.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function fixture(): NormalizedScanInputV1 {
  return {
    origin: "https://shop.example",
    pagesSelected: ["/"],
    pageLimit: 10,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://shop.example",
        pagePath: "/",
        templateHint: "home",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      traits: {
        siteProfile: "ecommerce",
      },
      routeMetadata: {
        trustPages: {
          links: [
            { href: "/contact", text: "Contact", inFooter: false },
            { href: "/about", text: "About", inFooter: false },
          ],
        },
      },
    },
  };
}

test("trust pages augmenter emits policy gaps and footer discoverability findings", async () => {
  const resolveTxt = async (): Promise<string[][]> => [["v=spf1 include:_spf.example.com ~all"], ["v=DMARC1; p=none"]];

  const findings = await augmentTrustPageFindings({
    input: fixture(),
    resolveTxt,
  });

  assert.equal(findings.some((row) => row.code === "missing_privacy_policy"), true);
  assert.equal(findings.some((row) => row.code === "missing_terms"), true);
  assert.equal(findings.some((row) => row.code === "missing_returns_policy"), true);
  assert.equal(findings.some((row) => row.code === "policy_not_linked_in_footer"), true);
  assert.equal(findings.some((row) => row.code === "missing_spf_record"), false);
  assert.equal(findings.some((row) => row.code === "missing_dmarc_record"), false);
});
