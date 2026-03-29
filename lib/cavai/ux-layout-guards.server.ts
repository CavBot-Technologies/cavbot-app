import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  asRecord,
  asRecordArray,
  dedupeFindings,
  deriveDetectedAt,
  normalizeOrigin,
  normalizePath,
  readBoolean,
  readNumber,
  readString,
  routeMetadataFromInput,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

const UX_LAYOUT_CODES = new Set([
  "horizontal_overflow_detected",
  "viewport_meta_missing",
  "text_clip_overflow_risk",
  "high_layout_shift",
  "missing_loading_state",
  "logo_missing_in_header",
  "logo_missing_alt",
  "logo_image_too_large",
]);

function derivePagePath(input: NormalizedScanInputV1) {
  const pages = input.findings
    .map((item) => normalizePath(item.pagePath))
    .filter(Boolean)
    .sort();
  if (pages.length) return pages[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) return normalizePath(input.pagesSelected[0]);
  return "/";
}

function readUxSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;

  const uxLayout =
    asRecord(routeMetadata.uxLayout) ||
    asRecord(routeMetadata.ux) ||
    asRecord(asRecord(routeMetadata.snapshot)?.uxLayout) ||
    null;

  const performance =
    asRecord(routeMetadata.performance) ||
    asRecord(asRecord(routeMetadata.snapshot)?.performance) ||
    null;

  return {
    uxLayout,
    performance,
  };
}

export async function augmentUxLayoutGuardFindings(params: {
  input: NormalizedScanInputV1;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !UX_LAYOUT_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const snapshot = readUxSnapshot(input);
  if (!snapshot?.uxLayout && !snapshot?.performance) return passthroughFindings;

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;
  const pagePath = derivePagePath(input);
  const detectedAt = deriveDetectedAt(input.findings);

  const findings: CavAiFindingV1[] = [];
  const uxLayout = snapshot.uxLayout;

  if (uxLayout) {
    const hasOverflow = readBoolean(uxLayout.hasHorizontalOverflow) === true;
    const overflowAmount = readNumber(uxLayout.horizontalOverflowPx) || 0;
    if (hasOverflow || overflowAmount > 0) {
      const offenders = Array.isArray(uxLayout.overflowOffenders)
        ? asRecordArray(uxLayout.overflowOffenders).slice(0, 5)
        : [];
      const selector =
        readString(offenders[0]?.selector, 260) ||
        "html, body";
      findings.push({
        id: stableFindingId("horizontal_overflow_detected", origin, pagePath),
        code: "horizontal_overflow_detected",
        pillar: "ux",
        severity: overflowAmount > 32 ? "high" : "medium",
        evidence: [
          {
            type: "dom",
            selector,
            snippet: `Horizontal overflow detected (${Math.round(overflowAmount)}px beyond viewport).`,
          },
          {
            type: "metric",
            name: "horizontal_overflow_px",
            value: overflowAmount,
            unit: "px",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    if (readBoolean(uxLayout.hasViewportMeta) === false) {
      findings.push({
        id: stableFindingId("viewport_meta_missing", origin, pagePath),
        code: "viewport_meta_missing",
        pillar: "ux",
        severity: "medium",
        evidence: [
          {
            type: "dom",
            selector: "meta[name='viewport']",
            snippet: "Viewport meta tag is missing.",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    const textClipRisks = Array.isArray(uxLayout.textClipRisks)
      ? asRecordArray(uxLayout.textClipRisks).slice(0, 6)
      : [];
    for (let i = 0; i < textClipRisks.length; i++) {
      const row = textClipRisks[i];
      const selector = readString(row.selector, 260) || "h1,h2,h3,.headline";
      const overflowMode = readString(row.overflowMode, 40) || "hidden";
      findings.push({
        id: stableFindingId("text_clip_overflow_risk", origin, pagePath, `${selector}:${i + 1}`),
        code: "text_clip_overflow_risk",
        pillar: "ux",
        severity: "medium",
        evidence: [
          {
            type: "dom",
            selector,
            snippet: `Potential text clipping detected (overflow mode: ${overflowMode}).`,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    const logo = asRecord(uxLayout.logo);
    if (logo) {
      if (readBoolean(logo.existsInHeader) === false) {
        findings.push({
          id: stableFindingId("logo_missing_in_header", origin, pagePath),
          code: "logo_missing_in_header",
          pillar: "ux",
          severity: "medium",
          evidence: [
            {
              type: "dom",
              selector: "header img, header [class*='logo' i]",
              snippet: "Header logo was not detected.",
            },
          ],
          origin,
          pagePath,
          templateHint: null,
          detectedAt,
        });
      }

      if (readBoolean(logo.altMissing) === true) {
        findings.push({
          id: stableFindingId("logo_missing_alt", origin, pagePath),
          code: "logo_missing_alt",
          pillar: "accessibility",
          severity: "low",
          evidence: [
            {
              type: "dom",
              selector: readString(logo.selector, 240) || "header img",
              snippet: "Header logo image is missing alt text.",
            },
          ],
          origin,
          pagePath,
          templateHint: null,
          detectedAt,
        });
      }

      const estimatedKb = readNumber(logo.estimatedKb);
      if (estimatedKb != null && estimatedKb > 256) {
        findings.push({
          id: stableFindingId("logo_image_too_large", origin, pagePath),
          code: "logo_image_too_large",
          pillar: "performance",
          severity: estimatedKb > 512 ? "high" : "medium",
          evidence: [
            {
              type: "dom",
              selector: readString(logo.selector, 240) || "header img",
              snippet: `Estimated logo weight is ${Math.round(estimatedKb)}KB.`,
            },
            {
              type: "metric",
              name: "logo_estimated_kb",
              value: estimatedKb,
              unit: "kb",
            },
          ],
          origin,
          pagePath,
          templateHint: null,
          detectedAt,
        });
      }
    }
  }

  const cls =
    readNumber(snapshot.performance?.cls) ||
    readNumber(snapshot.performance?.clsP75) ||
    readNumber(snapshot.uxLayout?.cls);
  if (cls != null && cls >= 0.1) {
    findings.push({
      id: stableFindingId("high_layout_shift", origin, pagePath),
      code: "high_layout_shift",
      pillar: "performance",
      severity: cls >= 0.25 ? "high" : "medium",
      evidence: [
        {
          type: "metric",
          name: "cls",
          value: cls,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });

    if (readBoolean(snapshot.uxLayout?.hasLoadingState) === false) {
      findings.push({
        id: stableFindingId("missing_loading_state", origin, pagePath),
        code: "missing_loading_state",
        pillar: "ux",
        severity: "note",
        evidence: [
          {
            type: "dom",
            selector: "[aria-busy], .skeleton, .loading",
            snippet: "No deterministic loading-state affordance detected while layout shift is elevated.",
          },
          {
            type: "metric",
            name: "cls",
            value: cls,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  return dedupeFindings(passthroughFindings.concat(findings)).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
    return a.id.localeCompare(b.id);
  });
}
