import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import { augmentUxLayoutGuardFindings } from "@/lib/cavai/ux-layout-guards.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function fixture(): NormalizedScanInputV1 {
  return {
    origin: "https://layout.example",
    pagesSelected: ["/pricing"],
    pageLimit: 8,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://layout.example",
        pagePath: "/pricing",
        templateHint: "pricing",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      routeMetadata: {
        uxLayout: {
          hasHorizontalOverflow: true,
          horizontalOverflowPx: 56,
          overflowOffenders: [
            {
              selector: ".hero-grid",
            },
          ],
          hasViewportMeta: false,
          textClipRisks: [
            {
              selector: ".hero-title",
              overflowMode: "hidden",
            },
          ],
          hasLoadingState: false,
          cls: 0.21,
          logo: {
            existsInHeader: true,
            altMissing: true,
            selector: "header img.logo",
            estimatedKb: 420,
          },
        },
      },
    },
  };
}

test("ux layout augmenter emits overflow, viewport, shift, and logo findings", async () => {
  const findings = await augmentUxLayoutGuardFindings({ input: fixture() });

  assert.equal(findings.some((row) => row.code === "horizontal_overflow_detected"), true);
  assert.equal(findings.some((row) => row.code === "viewport_meta_missing"), true);
  assert.equal(findings.some((row) => row.code === "text_clip_overflow_risk"), true);
  assert.equal(findings.some((row) => row.code === "high_layout_shift"), true);
  assert.equal(findings.some((row) => row.code === "missing_loading_state"), true);
  assert.equal(findings.some((row) => row.code === "logo_missing_alt"), true);
  assert.equal(findings.some((row) => row.code === "logo_image_too_large"), true);
});
