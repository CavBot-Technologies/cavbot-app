import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  augmentAccessibilityPlusFindings,
  deterministicContrastSuggestion,
} from "@/lib/cavai/accessibility-plus.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function baseInput(profile: string): NormalizedScanInputV1 {
  return {
    origin: "https://app.example",
    pagesSelected: ["/dashboard"],
    pageLimit: 8,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://app.example",
        pagePath: "/dashboard",
        templateHint: "dashboard",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      traits: {
        siteProfile: profile,
      },
      routeMetadata: {
        accessibilityPlus: {
          missingAccessibleNames: 2,
          missingFormLabels: 3,
          hasH1: false,
          headingSkipCount: 1,
          hasMainLandmark: false,
          focusOutlineRemovedCount: 2,
          tabindexMisuseCount: 1,
          focusTrapCount: 1,
          contrastFailures: [
            {
              selector: ".hero-subtitle",
              ratio: 2.4,
              fg: "#777777",
              bg: "#ffffff",
            },
          ],
          tapTargetsTooSmall: [
            {
              selector: ".tiny-cta",
              width: 24,
              height: 20,
            },
          ],
          imageMissingAltCount: 1,
          autoplayAudioUnmutedCount: 1,
          mediaMissingControlsCount: 1,
          mediaMissingCaptionsCount: 1,
          prefersReducedMotionRespected: false,
          tablesMissingHeaderCount: 1,
          iconButtonMissingLabelCount: 2,
          modalAriaMissingCount: 1,
          chartSummaryMissingCount: 1,
        },
      },
    },
  };
}

test("contrast suggestion is deterministic for same colors", () => {
  const first = deterministicContrastSuggestion({ fg: "#777777", bg: "#ffffff" });
  const second = deterministicContrastSuggestion({ fg: "#777777", bg: "#ffffff" });

  assert.deepEqual(first, second);
  assert.ok(first);
  assert.equal(first?.suggestedFg, "#000000");
});

test("accessibility-plus augmenter emits core and software-profile findings", async () => {
  const findings = await augmentAccessibilityPlusFindings({
    input: baseInput("software"),
  });

  assert.equal(findings.some((row) => row.code === "missing_form_labels"), true);
  assert.equal(findings.some((row) => row.code === "contrast_failure"), true);
  assert.equal(findings.some((row) => row.code === "autoplay_audio_detected"), true);
  assert.equal(findings.some((row) => row.code === "table_headers_missing"), true);
  assert.equal(findings.some((row) => row.code === "icon_button_missing_label"), true);
});
