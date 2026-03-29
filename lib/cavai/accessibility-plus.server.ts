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
  resolveSiteProfile,
  routeMetadataFromInput,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

type Rgb = { r: number; g: number; b: number };

const A11Y_PLUS_CODES = new Set([
  "missing_accessible_name",
  "missing_form_labels",
  "placeholder_as_label",
  "heading_level_skipped",
  "missing_main_landmark",
  "focus_outline_removed",
  "tabindex_misuse",
  "focus_trap_detected",
  "contrast_failure",
  "tap_target_too_small",
  "image_missing_alt",
  "autoplay_audio_detected",
  "media_controls_missing",
  "captions_track_missing",
  "reduced_motion_not_respected",
  "checkout_error_association_missing",
  "focus_error_summary_missing",
  "product_image_alt_coverage_low",
  "table_headers_missing",
  "icon_button_missing_label",
  "modal_aria_missing",
  "chart_text_summary_missing",
]);

function derivePagePath(input: NormalizedScanInputV1) {
  const fromFindings = input.findings
    .map((item) => normalizePath(item.pagePath))
    .filter(Boolean)
    .sort();
  if (fromFindings.length) return fromFindings[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) {
    return normalizePath(input.pagesSelected[0]);
  }
  return "/";
}

function findAccessibilitySnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return (
    asRecord(routeMetadata.accessibilityPlus) ||
    asRecord(routeMetadata.accessibility) ||
    asRecord(asRecord(routeMetadata.seo)?.accessibilityPlus) ||
    null
  );
}

function parseHex(value: string): Rgb | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const short = /^#([0-9a-f]{3})$/i.exec(raw);
  if (short) {
    const chunk = short[1];
    return {
      r: Number.parseInt(chunk[0] + chunk[0], 16),
      g: Number.parseInt(chunk[1] + chunk[1], 16),
      b: Number.parseInt(chunk[2] + chunk[2], 16),
    };
  }
  const full = /^#([0-9a-f]{6})$/i.exec(raw);
  if (full) {
    const hex = full[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function parseRgb(value: string): Rgb | null {
  const raw = String(value || "").trim().toLowerCase();
  const match = /^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/.exec(raw);
  if (!match) return null;
  return {
    r: Math.max(0, Math.min(255, Number(match[1]))),
    g: Math.max(0, Math.min(255, Number(match[2]))),
    b: Math.max(0, Math.min(255, Number(match[3]))),
  };
}

function parseColor(value: string): Rgb | null {
  return parseHex(value) || parseRgb(value);
}

function toHex(color: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

function relativeLuminance(color: Rgb): number {
  const normalize = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const r = normalize(color.r);
  const g = normalize(color.g);
  const b = normalize(color.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: Rgb, bg: Rgb): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function suggestContrastFix(fgRaw: string, bgRaw: string, minRatio = 4.5) {
  const fg = parseColor(fgRaw);
  const bg = parseColor(bgRaw);
  if (!fg || !bg) return null;
  const ratio = contrastRatio(fg, bg);
  if (ratio >= minRatio) {
    return {
      ratio,
      suggestedFg: toHex(fg),
      suggestedBg: toHex(bg),
      reason: "Already passing.",
    };
  }

  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 255, g: 255, b: 255 };

  const blackRatio = contrastRatio(black, bg);
  if (blackRatio >= minRatio) {
    return {
      ratio,
      suggestedFg: "#000000",
      suggestedBg: toHex(bg),
      reason: "Use black foreground to satisfy WCAG contrast.",
    };
  }

  const whiteRatio = contrastRatio(white, bg);
  if (whiteRatio >= minRatio) {
    return {
      ratio,
      suggestedFg: "#ffffff",
      suggestedBg: toHex(bg),
      reason: "Use white foreground to satisfy WCAG contrast.",
    };
  }

  const lighten = { ...fg };
  const darken = { ...fg };
  for (let step = 0; step < 64; step++) {
    lighten.r = Math.min(255, lighten.r + 4);
    lighten.g = Math.min(255, lighten.g + 4);
    lighten.b = Math.min(255, lighten.b + 4);
    const ratioLight = contrastRatio(lighten, bg);
    if (ratioLight >= minRatio) {
      return {
        ratio,
        suggestedFg: toHex(lighten),
        suggestedBg: toHex(bg),
        reason: "Lighten foreground until contrast passes.",
      };
    }

    darken.r = Math.max(0, darken.r - 4);
    darken.g = Math.max(0, darken.g - 4);
    darken.b = Math.max(0, darken.b - 4);
    const ratioDark = contrastRatio(darken, bg);
    if (ratioDark >= minRatio) {
      return {
        ratio,
        suggestedFg: toHex(darken),
        suggestedBg: toHex(bg),
        reason: "Darken foreground until contrast passes.",
      };
    }
  }

  return {
    ratio,
    suggestedFg: "#000000",
    suggestedBg: "#ffffff",
    reason: "Fallback to black/white pair.",
  };
}

function pushCountFinding(params: {
  findings: CavAiFindingV1[];
  code: string;
  pillar?: CavAiFindingV1["pillar"];
  severity: CavAiFindingV1["severity"];
  count: number;
  selector: string;
  message: string;
  origin: string;
  pagePath: string;
  detectedAt: string;
}) {
  if (!(params.count > 0)) return;
  params.findings.push({
    id: stableFindingId(params.code, params.origin, params.pagePath),
    code: params.code,
    pillar: params.pillar || "accessibility",
    severity: params.severity,
    evidence: [
      {
        type: "dom",
        selector: params.selector,
        snippet: params.message,
      },
      {
        type: "metric",
        name: `${params.code}_count`,
        value: params.count,
      },
    ],
    origin: params.origin,
    pagePath: params.pagePath,
    templateHint: null,
    detectedAt: params.detectedAt,
  });
}

export function deterministicContrastSuggestion(input: {
  fg: string;
  bg: string;
  minRatio?: number;
}) {
  return suggestContrastFix(input.fg, input.bg, input.minRatio || 4.5);
}

export async function augmentAccessibilityPlusFindings(params: {
  input: NormalizedScanInputV1;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !A11Y_PLUS_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const snapshot = findAccessibilitySnapshot(input);
  if (!snapshot) return passthroughFindings;

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;
  const pagePath = derivePagePath(input);
  const detectedAt = deriveDetectedAt(input.findings);

  const findings: CavAiFindingV1[] = [];

  pushCountFinding({
    findings,
    code: "missing_accessible_name",
    severity: "high",
    count: readNumber(snapshot.missingAccessibleNames) || readNumber(snapshot.unlabeledControlCount) || 0,
    selector: "button, a, input, textarea, select",
    message: "Interactive elements are missing accessible names.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "missing_form_labels",
    severity: "high",
    count: readNumber(snapshot.missingFormLabels) || readNumber(snapshot.missingFormLabelCount) || 0,
    selector: "input, textarea, select",
    message: "Form controls are missing associated labels.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "placeholder_as_label",
    severity: "medium",
    count: readNumber(snapshot.placeholderAsLabelCount) || 0,
    selector: "input[placeholder], textarea[placeholder]",
    message: "Placeholder text is being used as the primary label.",
    origin,
    pagePath,
    detectedAt,
  });

  const missingH1 = readBoolean(snapshot.hasH1) === false || (readNumber(snapshot.h1Count) || 0) === 0;
  if (missingH1) {
    findings.push({
      id: stableFindingId("missing_h1", origin, pagePath),
      code: "missing_h1",
      pillar: "accessibility",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "h1",
          snippet: "No H1 heading found on page.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  pushCountFinding({
    findings,
    code: "heading_level_skipped",
    severity: "medium",
    count: readNumber(snapshot.headingSkipCount) || readNumber(snapshot.headingLevelSkips) || 0,
    selector: "h1,h2,h3,h4,h5,h6",
    message: "Heading levels are skipped in the document outline.",
    origin,
    pagePath,
    detectedAt,
  });

  if (readBoolean(snapshot.hasMainLandmark) === false) {
    findings.push({
      id: stableFindingId("missing_main_landmark", origin, pagePath),
      code: "missing_main_landmark",
      pillar: "accessibility",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "main,[role=\"main\"]",
          snippet: "Main landmark is missing.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  pushCountFinding({
    findings,
    code: "focus_outline_removed",
    severity: "medium",
    count: readNumber(snapshot.focusOutlineRemovedCount) || 0,
    selector: "*:focus,*:focus-visible",
    message: "Focus outlines are removed from one or more interactive elements.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "tabindex_misuse",
    severity: "medium",
    count: readNumber(snapshot.tabindexMisuseCount) || 0,
    selector: "[tabindex]",
    message: "Potential tabindex misuse detected.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "focus_trap_detected",
    severity: "high",
    count: readNumber(snapshot.focusTrapCount) || 0,
    selector: "dialog,[role=\"dialog\"],.modal",
    message: "Potential focus trap detected in modal/dialog flows.",
    origin,
    pagePath,
    detectedAt,
  });

  const contrastSamples = Array.isArray(snapshot.contrastFailures)
    ? asRecordArray(snapshot.contrastFailures).slice(0, 8)
    : [];
  for (let i = 0; i < contrastSamples.length; i++) {
    const row = contrastSamples[i];
    const selector = readString(row.selector, 260) || "*";
    const ratio = readNumber(row.ratio) || 0;
    const fg = readString(row.fg, 80) || readString(row.foreground, 80) || "";
    const bg = readString(row.bg, 80) || readString(row.background, 80) || "";
    const fix = suggestContrastFix(fg, bg, 4.5);
    findings.push({
      id: stableFindingId("contrast_failure", origin, pagePath, `${selector}:${i + 1}`),
      code: "contrast_failure",
      pillar: "accessibility",
      severity: ratio > 0 && ratio < 3 ? "high" : "medium",
      evidence: [
        {
          type: "dom",
          selector,
          snippet: fix
            ? `Contrast ${ratio.toFixed(2)}:1 for ${fg} on ${bg}. Suggested ${fix.suggestedFg} on ${fix.suggestedBg}.`
            : `Contrast ${ratio.toFixed(2)}:1 detected; color values unavailable for deterministic fix.`,
        },
        {
          type: "metric",
          name: "contrast_ratio",
          value: ratio,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const tapTargets = Array.isArray(snapshot.tapTargetsTooSmall)
    ? asRecordArray(snapshot.tapTargetsTooSmall).slice(0, 8)
    : [];
  for (let i = 0; i < tapTargets.length; i++) {
    const row = tapTargets[i];
    const width = readNumber(row.width) || 0;
    const height = readNumber(row.height) || 0;
    const selector = readString(row.selector, 260) || "button,a,[role=button]";
    findings.push({
      id: stableFindingId("tap_target_too_small", origin, pagePath, `${selector}:${i + 1}`),
      code: "tap_target_too_small",
      pillar: "accessibility",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector,
          snippet: `Tap target measures ${Math.round(width)}x${Math.round(height)}px; recommended minimum is 44x44px.`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  pushCountFinding({
    findings,
    code: "image_missing_alt",
    severity: "medium",
    count: readNumber(snapshot.missingAltCount) || readNumber(snapshot.imageMissingAltCount) || 0,
    selector: "img:not([alt]),img[alt='']",
    message: "Images missing alternative text detected.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "autoplay_audio_detected",
    severity: "high",
    count: readNumber(snapshot.autoplayAudioUnmutedCount) || 0,
    selector: "audio[autoplay],video[autoplay]",
    message: "Autoplay media with audible audio detected.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "media_controls_missing",
    severity: "medium",
    count: readNumber(snapshot.mediaMissingControlsCount) || 0,
    selector: "audio,video",
    message: "Media elements are missing user controls.",
    origin,
    pagePath,
    detectedAt,
  });

  pushCountFinding({
    findings,
    code: "captions_track_missing",
    severity: "medium",
    count: readNumber(snapshot.mediaMissingCaptionsCount) || 0,
    selector: "video",
    message: "Video media appears to be missing captions tracks.",
    origin,
    pagePath,
    detectedAt,
  });

  if (readBoolean(snapshot.prefersReducedMotionRespected) === false) {
    findings.push({
      id: stableFindingId("reduced_motion_not_respected", origin, pagePath),
      code: "reduced_motion_not_respected",
      pillar: "accessibility",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "@media (prefers-reduced-motion)",
          snippet: "prefers-reduced-motion handling appears incomplete.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const profile = resolveSiteProfile(input, { pathHints: input.pagesSelected });
  if (profile.profile === "ecommerce") {
    pushCountFinding({
      findings,
      code: "checkout_error_association_missing",
      severity: "high",
      count: readNumber(snapshot.checkoutErrorAssociationMissingCount) || 0,
      selector: "form [aria-describedby]",
      message: "Checkout field errors are not associated to form controls.",
      origin,
      pagePath,
      detectedAt,
    });

    if (readBoolean(snapshot.focusToErrorSummary) === false) {
      findings.push({
        id: stableFindingId("focus_error_summary_missing", origin, pagePath),
        code: "focus_error_summary_missing",
        pillar: "accessibility",
        severity: "medium",
        evidence: [
          {
            type: "dom",
            selector: "[role=\"alert\"], [data-error-summary]",
            snippet: "Focus does not move to checkout error summary after submit.",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    const productAltCoverage = readNumber(snapshot.productImageAltCoveragePct);
    if (productAltCoverage != null && productAltCoverage < 90) {
      findings.push({
        id: stableFindingId("product_image_alt_coverage_low", origin, pagePath),
        code: "product_image_alt_coverage_low",
        pillar: "accessibility",
        severity: "medium",
        evidence: [
          {
            type: "metric",
            name: "product_image_alt_coverage_pct",
            value: productAltCoverage,
            unit: "%",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  if (profile.profile === "software") {
    pushCountFinding({
      findings,
      code: "table_headers_missing",
      severity: "medium",
      count: readNumber(snapshot.tablesMissingHeaderCount) || 0,
      selector: "table",
      message: "Tables missing th/header associations detected.",
      origin,
      pagePath,
      detectedAt,
    });

    pushCountFinding({
      findings,
      code: "icon_button_missing_label",
      severity: "medium",
      count: readNumber(snapshot.iconButtonMissingLabelCount) || 0,
      selector: "button",
      message: "Icon-only buttons missing accessible labels.",
      origin,
      pagePath,
      detectedAt,
    });

    pushCountFinding({
      findings,
      code: "modal_aria_missing",
      severity: "high",
      count: readNumber(snapshot.modalAriaMissingCount) || 0,
      selector: "dialog,[role=\"dialog\"]",
      message: "Modal dialog semantics (aria-modal/focus trap) appear incomplete.",
      origin,
      pagePath,
      detectedAt,
    });

    pushCountFinding({
      findings,
      code: "chart_text_summary_missing",
      severity: "note",
      count: readNumber(snapshot.chartSummaryMissingCount) || 0,
      selector: "canvas,svg,[data-chart]",
      message: "Charts are missing adjacent text summaries.",
      origin,
      pagePath,
      detectedAt,
    });
  }

  return dedupeFindings(passthroughFindings.concat(findings)).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
    return a.id.localeCompare(b.id);
  });
}
