import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  augmentStructuredDataFindings,
  deterministicStructuredDataRecipeHash,
} from "@/lib/cavai/structured-data.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function baseInput(): NormalizedScanInputV1 {
  return {
    origin: "https://example.com",
    pagesSelected: ["/"],
    pageLimit: 12,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://example.com",
        pagePath: "/",
        templateHint: "home",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      traits: {
        siteProfile: "personal",
      },
      routeMetadata: {
        siteIdentity: {
          source: "workspace_settings",
          personName: "Cavendish Pierre-Louis",
          orgName: "Cavendish Pierre-Louis",
          logoUrl: "https://example.com/logo.png",
          sameAs: ["https://x.com/cavendishpl"],
        },
        structuredData: {
          scripts: [],
        },
      },
    },
  };
}

test("structured data augmenter emits deterministic recipe evidence using configured identity", async () => {
  const findings = await augmentStructuredDataFindings({ input: baseInput() });
  const missingStructured = findings.find((row) => row.code === "missing_structured_data");
  assert.ok(missingStructured);

  const recipeEvidence = missingStructured?.evidence.find(
    (row) => row.type === "log" && row.fingerprint === "structured_data_recipe"
  );
  assert.ok(recipeEvidence);
  const recipeMessage = recipeEvidence && recipeEvidence.type === "log" ? recipeEvidence.message : "";
  assert.match(String(recipeMessage || ""), /"@type": "Person"/);
  assert.match(String(recipeMessage || ""), /Cavendish Pierre-Louis/);

  const hashA = deterministicStructuredDataRecipeHash({
    origin: "https://example.com",
    profile: "personal",
    source: "workspace_settings",
  });
  const hashB = deterministicStructuredDataRecipeHash({
    origin: "https://example.com",
    profile: "personal",
    source: "workspace_settings",
  });
  assert.equal(hashA, hashB);
});

test("structured data augmenter catches invalid json and duplicate @id collisions", async () => {
  const input = baseInput();
  if (!input.context?.routeMetadata || typeof input.context.routeMetadata !== "object") {
    assert.fail("routeMetadata missing");
  }
  (input.context.routeMetadata as Record<string, unknown>).structuredData = {
    scripts: [
      {
        selector: "script[type='application/ld+json']:nth-of-type(1)",
        text: "{ invalid json",
      },
      {
        selector: "script[type='application/ld+json']:nth-of-type(2)",
        text: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": "https://example.com/#organization",
          name: "Example A",
        }),
      },
      {
        selector: "script[type='application/ld+json']:nth-of-type(3)",
        text: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": "https://example.com/#organization",
          name: "Example B",
        }),
      },
    ],
  };

  const findings = await augmentStructuredDataFindings({ input });
  assert.equal(findings.some((row) => row.code === "invalid_json_ld"), true);
  assert.equal(findings.some((row) => row.code === "duplicate_json_ld_ids"), true);
});
