import { createHash } from "crypto";
import {
  CAVAI_FIX_PLAN_VERSION_V1,
  CAVAI_INSIGHT_PACK_VERSION_V1,
  resolveCodeDefinition,
  type CavAiCodeHistoryV1,
  type CavAiConfidenceBlockV1,
  type CavAiFixPlanV1,
  type CavAiInsightPackV1,
  type CavAiNextActionV1,
  type CavAiOverlayV1,
  type CavAiPatternV1,
  type CavAiPillar,
  type CavAiPriorityConfidence,
  type CavAiPriorityV1,
  type CavAiRiskBlockV1,
  type CavAiRiskLevel,
  type CavAiSeverity,
  type NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";

const SEVERITY_WEIGHT: Record<CavAiSeverity, number> = {
  critical: 40,
  high: 30,
  medium: 18,
  low: 10,
  note: 4,
};

const SEVERITY_RANK: Record<CavAiSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  note: 1,
};

const EFFORT_PENALTY: Record<"trivial" | "small" | "medium" | "large" | "major", number> = {
  trivial: 2,
  small: 6,
  medium: 10,
  large: 15,
  major: 20,
};

const FAVICON_ASSET_LINES = [
  "- /favicon.ico (multi-size ICO: 16x16, 32x32, ideally 48x48)",
  "- /favicon-16x16.png",
  "- /favicon-32x32.png",
  "- /apple-touch-icon.png (180x180)",
  "- /android-chrome-192x192.png",
  "- /android-chrome-512x512.png",
  "- /site.webmanifest (references 192 + 512 icons)",
  "- Optional: /safari-pinned-tab.svg + <link rel=\"mask-icon\" ...>",
  "- Optional: <meta name=\"theme-color\" ...>",
];

const FAVICON_HEAD_SNIPPET = [
  "<link rel=\"icon\" href=\"/favicon.ico\">",
  "<link rel=\"icon\" type=\"image/png\" sizes=\"32x32\" href=\"/favicon-32x32.png\">",
  "<link rel=\"icon\" type=\"image/png\" sizes=\"16x16\" href=\"/favicon-16x16.png\">",
  "<link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\">",
  "<link rel=\"manifest\" href=\"/site.webmanifest\">",
  "<!-- Optional Safari pinned tab -->",
  "<link rel=\"mask-icon\" href=\"/safari-pinned-tab.svg\">",
  "<meta name=\"theme-color\" content=\"#ffffff\">",
].join("\n");

const ARCADE_404_GAMES = [
  {
    id: "catch-cavbot",
    name: "Catch CavBot",
    filePath: "/public/cavbot-arcade/404/catch-cavbot/v1/index.html",
    manifestPath: "/public/cavbot-arcade/404/catch-cavbot/v1/manifest.json",
  },
  {
    id: "tennis-cavbot",
    name: "Tennis CavBot",
    filePath: "/public/cavbot-arcade/404/tennis-cavbot/v1/index.html",
    manifestPath: "/public/cavbot-arcade/404/tennis-cavbot/v1/manifest.json",
  },
] as const;

type SuggestionTemplate = {
  id: string;
  titleVariants: string[];
  detailVariants: string[];
};

const PILLAR_TEMPLATE_LIBRARY: Record<CavAiPillar, SuggestionTemplate[]> = {
  seo: [
    {
      id: "seo-entity-coverage",
      titleVariants: [
        "Tighten entity coverage on {page}",
        "Fill schema coverage gap on {page}",
        "Close structured metadata gap on {page}",
      ],
      detailVariants: [
        "Audit {code} on {page} and align schema/meta tags with canonical intent.",
        "Patch template metadata on {page} to eliminate repeat SEO drift.",
        "Apply deterministic SEO head defaults for {page} and adjacent routes.",
      ],
    },
    {
      id: "seo-head-template",
      titleVariants: [
        "Normalize shared head template for {page}",
        "Stabilize metadata template on {page}",
        "Repair head defaults driving {code}",
      ],
      detailVariants: [
        "Implement one shared head source for title/description/canonical/OG on {page}.",
        "Use deterministic fallback metadata rules to prevent this signal from recurring.",
        "Connect metadata generation to route-level intent while preserving canonical consistency.",
      ],
    },
    {
      id: "seo-crawl-integrity",
      titleVariants: [
        "Restore crawl integrity around {page}",
        "Improve indexability posture for {page}",
        "Strengthen crawl-ready metadata on {page}",
      ],
      detailVariants: [
        "Verify canonical/index signals and remove contradictory metadata for {page}.",
        "Use deterministic crawl policy checks to keep this route index-safe.",
        "Re-scan index directives after metadata fixes to confirm evidence clears.",
      ],
    },
  ],
  accessibility: [
    {
      id: "a11y-name-label",
      titleVariants: [
        "Fix label/name coverage on {page}",
        "Patch accessible naming gaps on {page}",
        "Normalize control labels on {page}",
      ],
      detailVariants: [
        "Resolve {code} by mapping each control to a stable accessible name.",
        "Apply semantic labeling patterns and verify with keyboard-only traversal.",
        "Use deterministic label audits to prevent regression on shared UI components.",
      ],
    },
    {
      id: "a11y-focus-order",
      titleVariants: [
        "Repair focus behavior on {page}",
        "Stabilize keyboard order on {page}",
        "Normalize focus-visible patterns on {page}",
      ],
      detailVariants: [
        "Restore predictable focus order and visible focus rings for all interactive targets.",
        "Audit tabindex/focus traps and re-validate modal escape paths on {page}.",
        "Use focusable element inventory checks to verify full keyboard reachability.",
      ],
    },
    {
      id: "a11y-media-motion",
      titleVariants: [
        "Reduce media/motion friction on {page}",
        "Harden motion and media accessibility on {page}",
        "Bring playback behavior in line on {page}",
      ],
      detailVariants: [
        "Disable disruptive autoplay and ensure captions/controls are available where media is present.",
        "Honor prefers-reduced-motion and provide deterministic playback controls.",
        "Re-test media flows with keyboard and screen reader expectations.",
      ],
    },
  ],
  ux: [
    {
      id: "ux-layout-guard",
      titleVariants: [
        "Stabilize layout guardrails on {page}",
        "Repair visual overflow and clipping on {page}",
        "Tighten layout integrity on {page}",
      ],
      detailVariants: [
        "Fix overflow root cause and validate viewport-safe rendering on target breakpoints.",
        "Patch clipping/bleed conditions and reserve stable content space.",
        "Apply deterministic layout constraints to avoid repeat regressions.",
      ],
    },
    {
      id: "ux-navigation-recovery",
      titleVariants: [
        "Improve navigation recovery on {page}",
        "Strengthen wayfinding controls on {page}",
        "Restore journey resilience on {page}",
      ],
      detailVariants: [
        "Ensure home/recovery actions are visible and keyboard-accessible.",
        "Normalize nav behavior across templates to reduce route dead ends.",
        "Validate route-level navigation parity after template patching.",
      ],
    },
    {
      id: "ux-trust-surface",
      titleVariants: [
        "Harden trust page discoverability",
        "Elevate legal/trust visibility on {page}",
        "Improve footer trust navigation",
      ],
      detailVariants: [
        "Link privacy/terms/contact pages in footer and high-intent flows.",
        "Align trust pages to profile expectations and verify discoverability.",
        "Keep trust links deterministic across templates and route variants.",
      ],
    },
  ],
  performance: [
    {
      id: "perf-shift-control",
      titleVariants: [
        "Reduce layout shift pressure on {page}",
        "Stabilize rendering path on {page}",
        "Patch visual instability on {page}",
      ],
      detailVariants: [
        "Reserve media/content dimensions and avoid post-render jumps.",
        "Add deterministic loading states where async content shifts layout.",
        "Re-check CLS after applying template-level stabilization.",
      ],
    },
    {
      id: "perf-asset-budget",
      titleVariants: [
        "Trim critical asset weight on {page}",
        "Optimize heavy visual assets on {page}",
        "Enforce lighter above-fold payload on {page}",
      ],
      detailVariants: [
        "Compress oversized images/icons and ensure responsive asset delivery.",
        "Apply deterministic asset-size budgets for shared components.",
        "Validate transfer weight reductions with a fresh diagnostics run.",
      ],
    },
    {
      id: "perf-runtime-budget",
      titleVariants: [
        "Lower runtime contention on {page}",
        "Reduce main-thread pressure on {page}",
        "Improve interactive stability on {page}",
      ],
      detailVariants: [
        "Split heavy scripts and defer non-critical execution paths.",
        "Protect interaction readiness with deterministic long-task controls.",
        "Verify runtime regressions are cleared before deploy.",
      ],
    },
  ],
  engagement: [
    {
      id: "engagement-recovery",
      titleVariants: [
        "Boost recovery conversion from {page}",
        "Strengthen re-engagement loop on {page}",
        "Improve retention cues around {page}",
      ],
      detailVariants: [
        "Add a clear next action for users who hit this friction point.",
        "Improve route recovery language and visual hierarchy for faster re-entry.",
        "Re-test path completion after deterministic copy/CTA updates.",
      ],
    },
    {
      id: "engagement-social-preview",
      titleVariants: [
        "Improve share-preview quality on {page}",
        "Harden social discovery cues for {page}",
        "Upgrade referral presentation for {page}",
      ],
      detailVariants: [
        "Ensure previews include coherent title/image metadata for route context.",
        "Align metadata and trust cues to reduce drop-off from shared links.",
        "Verify referral surface consistency after metadata updates.",
      ],
    },
    {
      id: "engagement-404-delight",
      titleVariants: [
        "Add deterministic 404 delight layer",
        "Deploy recovery mini-game for 404 journeys",
        "Improve not-found engagement loop",
      ],
      detailVariants: [
        "Select the deterministic arcade module and wire it into the 404 recovery surface.",
        "Pair 404 recovery copy with a lightweight engagement module to reduce bounce.",
        "Keep runtime loop unchanged and mount game assets on the 404 template only.",
      ],
    },
  ],
  reliability: [
    {
      id: "rel-route-integrity",
      titleVariants: [
        "Restore route integrity on {page}",
        "Patch deterministic route failures on {page}",
        "Stabilize endpoint reliability for {page}",
      ],
      detailVariants: [
        "Resolve failing route status responses and verify with deterministic probes.",
        "Repair link/handler mismatches that produce repeat not-found signals.",
        "Re-scan route status posture after fixes to confirm evidence clears.",
      ],
    },
    {
      id: "rel-auth-funnel",
      titleVariants: [
        "Stabilize auth funnel error rate",
        "Reduce login/signup failure pressure",
        "Resolve recurring auth endpoint cluster",
      ],
      detailVariants: [
        "Triage top auth fingerprint clusters and patch dominant failure paths.",
        "Measure success/failure deltas after each auth fix deployment.",
        "Maintain opt-in aggregated auth telemetry to track conversion recovery.",
      ],
    },
    {
      id: "rel-observability-loop",
      titleVariants: [
        "Close reliability observability loop",
        "Improve deterministic incident detection",
        "Harden evidence coverage for reliability fixes",
      ],
      detailVariants: [
        "Attach fix verification to evidence IDs and replay diagnostics after patching.",
        "Promote recurring reliability codes into owned runbooks with clear owners.",
        "Use consistent route/error probes to prevent silent regressions.",
      ],
    },
  ],
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizePath(path: string) {
  const value = String(path || "").trim();
  if (!value) return "/";
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}

function normalizeRouteShape(path: string) {
  const trimmed = normalizePath(path).replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length) return "/";
  const normalized = parts.map((part) => {
    const lower = part.toLowerCase();
    if (/^\d+$/.test(lower)) return ":id";
    if (/^[a-f0-9]{8,}$/.test(lower)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(lower)) return ":id";
    return lower;
  });
  return `/${normalized.join("/")}`;
}

function pickSeverity(a: CavAiSeverity, b: CavAiSeverity) {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function coverageWeight(coverage: number) {
  if (coverage >= 0.8) return 22;
  if (coverage >= 0.6) return 18;
  if (coverage >= 0.4) return 14;
  if (coverage >= 0.25) return 10;
  if (coverage >= 0.1) return 6;
  return 2;
}

function pageImportanceWeight(samplePages: string[]) {
  let maxWeight = 3;
  for (const page of samplePages) {
    const p = normalizePath(page).toLowerCase();
    if (p === "/") return 18;
    if (/(pricing|checkout|billing|signup|login|onboarding)/.test(p)) {
      maxWeight = Math.max(maxWeight, 16);
      continue;
    }
    if (/(docs|api|install|getting-started)/.test(p)) {
      maxWeight = Math.max(maxWeight, 14);
      continue;
    }
    if (/(dashboard|console|app|workspace|routes|insights)/.test(p)) {
      maxWeight = Math.max(maxWeight, 14);
      continue;
    }
    if (/(features|solutions)/.test(p)) {
      maxWeight = Math.max(maxWeight, 10);
      continue;
    }
    if (/(blog|news|article|editorial)/.test(p)) {
      maxWeight = Math.max(maxWeight, 6);
    }
  }
  return maxWeight;
}

function crossPillarWeight(pillars: Set<CavAiPillar>) {
  if (pillars.size >= 3) return 10;
  if (pillars.size === 2) return 6;
  return 0;
}

function stableIndex(input: string, modulo: number) {
  if (modulo <= 0) return 0;
  const digest = createHash("sha256").update(input).digest("hex");
  const value = Number.parseInt(digest.slice(0, 8), 16);
  if (!Number.isFinite(value)) return 0;
  return value % modulo;
}

function fillTemplate(template: string, params: { page: string; code: string; defaultAction: string }) {
  return template
    .replace(/\{page\}/g, params.page)
    .replace(/\{code\}/g, params.code)
    .replace(/\{defaultAction\}/g, params.defaultAction);
}

function pickDeterministic404Game(origin: string, runId: string) {
  const idx = stableIndex(`${origin}|${runId}|404`, ARCADE_404_GAMES.length);
  return ARCADE_404_GAMES[idx];
}

function confidenceForPriority(params: {
  coverage: number;
  affectedPages: number;
  repeatedTemplate: boolean;
  consecutiveRuns: number;
}) {
  if (params.coverage >= 0.6 || params.consecutiveRuns >= 2) {
    return {
      level: "high" as CavAiPriorityConfidence,
      reason: "High confidence from broad coverage or repeated persistence across runs.",
    };
  }
  if (params.affectedPages >= 2 && params.repeatedTemplate) {
    return {
      level: "medium" as CavAiPriorityConfidence,
      reason: "Medium confidence from repeated findings on shared templates.",
    };
  }
  return {
    level: "low" as CavAiPriorityConfidence,
    reason: "Low confidence because the signal is isolated with no persistence history.",
  };
}

function riskFromPriorities(priorities: CavAiPriorityV1[]): CavAiRiskBlockV1 {
  const criticalCount = priorities.filter((item) => item.severity === "critical").length;
  const highCount = priorities.filter((item) => item.severity === "high").length;
  const mediumCount = priorities.filter((item) => item.severity === "medium").length;
  const evidenceFindingIds = priorities
    .flatMap((priority) => priority.evidenceFindingIds)
    .filter(Boolean)
    .slice(0, 20);

  let level: CavAiRiskLevel = "low";
  let reason = "Risk is currently contained to low-severity deterministic findings.";

  if (criticalCount > 0 || highCount >= 3) {
    level = "high";
    reason = "High risk due to critical findings or repeated high-severity issues.";
  } else if (highCount > 0 || mediumCount > 2) {
    level = "medium";
    reason = "Medium risk due to unresolved high/medium severity findings.";
  }

  return {
    level,
    reason,
    evidenceFindingIds: evidenceFindingIds.length ? evidenceFindingIds : ["finding_none"],
  };
}

function confidenceFromPriorities(priorities: CavAiPriorityV1[]): CavAiConfidenceBlockV1 {
  const evidenceFindingIds = priorities
    .flatMap((priority) => priority.evidenceFindingIds)
    .filter(Boolean)
    .slice(0, 20);
  if (!priorities.length) {
    return {
      level: "high",
      reason: "High confidence because no deterministic findings were produced.",
      evidenceFindingIds: evidenceFindingIds.length ? evidenceFindingIds : ["finding_none"],
    };
  }
  const avgCoverage =
    priorities.reduce((sum, item) => sum + item.coverage, 0) / Math.max(1, priorities.length);
  if (avgCoverage >= 0.6) {
    return {
      level: "high",
      reason: "High confidence from broad finding coverage across scanned pages.",
      evidenceFindingIds: evidenceFindingIds.length ? evidenceFindingIds : ["finding_none"],
    };
  }
  if (avgCoverage >= 0.25) {
    return {
      level: "medium",
      reason: "Medium confidence from moderate deterministic coverage.",
      evidenceFindingIds: evidenceFindingIds.length ? evidenceFindingIds : ["finding_none"],
    };
  }
  return {
    level: "low",
    reason: "Low confidence because findings are concentrated on a small set of pages.",
    evidenceFindingIds: evidenceFindingIds.length ? evidenceFindingIds : ["finding_none"],
  };
}

function nextActionsForPriority(params: {
  code: string;
  origin: string;
  samplePages: string[];
  evidenceFindingIds: string[];
  pillar: CavAiPillar;
  targetArea: "content" | "template" | "config";
  defaultAction: string;
  fileTargets: string[];
  engineVersion: string;
  runId: string;
}) {
  const codeId = params.code.replace(/[^a-z0-9_-]/gi, "_");
  const openTargets = params.samplePages.slice(0, 3).map((page, idx) => ({
    type: "url" as const,
    target: new URL(normalizePath(page), params.origin).toString(),
    label: `Affected page ${idx + 1}`,
  })) as CavAiNextActionV1["openTargets"];

  const fileOpenTargets = params.fileTargets.slice(0, 2).map((target, idx) => ({
    type: "file" as const,
    target,
    label: `Workspace target ${idx + 1}`,
  })) as CavAiNextActionV1["openTargets"];

  const allTargets: CavAiNextActionV1["openTargets"] = openTargets.concat(fileOpenTargets);
  let primaryTitle = `Apply fix: ${params.defaultAction}`;
  let primaryDetail = params.defaultAction;
  let safeAutoFix: boolean | undefined;

  if (params.code === "missing_favicon") {
    primaryTitle = "Add favicon assets + head links";
    primaryDetail = [
      "A favicon is your site's icon in browser tabs, bookmarks, history, and some search surfaces.",
      "It improves recognition and trust, and prevents generic browser fallback icons.",
      "Recommended assets:",
      ...FAVICON_ASSET_LINES,
      "Head snippet:",
      FAVICON_HEAD_SNIPPET,
    ].join("\n");
    safeAutoFix = false;
  } else if (params.code === "missing_apple_touch_icon") {
    primaryTitle = "Add Apple touch icon link";
    primaryDetail = [
      "Provide a dedicated iOS home-screen icon.",
      "Add: <link rel=\"apple-touch-icon\" sizes=\"180x180\" href=\"/apple-touch-icon.png\">",
    ].join("\n");
    safeAutoFix = false;
  } else if (params.code === "missing_web_manifest_icon_set" || params.code === "missing_manifest") {
    primaryTitle = "Add web manifest icon set";
    primaryDetail = [
      "Publish /site.webmanifest with 192x192 and 512x512 icons.",
      "Ensure <link rel=\"manifest\" href=\"/site.webmanifest\"> is in the shared head template.",
    ].join("\n");
    safeAutoFix = false;
  } else if (
    params.code === "theme_color_needs_branding" ||
    params.code === "missing_theme_color"
  ) {
    primaryTitle = "Set branded theme/tile colors";
    primaryDetail = [
      "Set a non-generic browser chrome color for tabs/PWA surfaces.",
      "<meta name=\"theme-color\" content=\"#202124\">",
      "<meta name=\"msapplication-TileColor\" content=\"#202124\">",
    ].join("\n");
    safeAutoFix = false;
  } else if (params.code === "missing_structured_data") {
    primaryTitle = "Add baseline JSON-LD graph";
    primaryDetail = [
      "Publish a schema.org JSON-LD graph with Organization + WebSite nodes.",
      "Use authenticated Site Identity values only; avoid inferred placeholders in production.",
    ].join("\n");
    safeAutoFix = false;
  } else if (
    params.code === "missing_website_schema" ||
    params.code === "missing_organization_schema" ||
    params.code === "missing_person_schema"
  ) {
    primaryTitle = "Complete required JSON-LD entity nodes";
    primaryDetail = [
      "Add missing schema entities in the shared JSON-LD graph.",
      "Use stable @id conventions: origin + #person/#organization/#website.",
    ].join("\n");
    safeAutoFix = false;
  } else if (params.code === "duplicate_json_ld_ids") {
    primaryTitle = "Resolve duplicate JSON-LD @id collisions";
    primaryDetail =
      "Ensure each @id resolves to one canonical node definition and merge conflicting duplicates.";
    safeAutoFix = false;
  }

  const baseAction: CavAiNextActionV1 = {
    id: `action_${codeId}_fix`,
    code: params.code,
    title: primaryTitle,
    detail: primaryDetail,
    targetArea: params.targetArea,
    safeAutoFix,
    evidenceFindingIds: params.evidenceFindingIds.slice(0, 50),
    openTargets: allTargets,
  };

  const verifyAction: CavAiNextActionV1 = {
    id: `action_${codeId}_verify`,
    code: params.code,
    title: "Verify with tests, lint, and rescan",
    detail:
      "Run deterministic checks for impacted routes, then rescan to confirm evidence is cleared.",
    targetArea: params.targetArea,
    evidenceFindingIds: params.evidenceFindingIds.slice(0, 50),
    openTargets: allTargets,
  };

  const templates = PILLAR_TEMPLATE_LIBRARY[params.pillar] || [];
  const templateActions: CavAiNextActionV1[] = [];
  const templatePages = params.samplePages.length ? params.samplePages.slice(0, 4) : ["/"];
  const templateFileTargets = params.fileTargets.slice(0, 1);

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    for (let p = 0; p < templatePages.length; p++) {
      const page = normalizePath(templatePages[p]);
      const seed = `${params.code}|${params.origin}|${page}|${params.engineVersion}|${template.id}`;
      const title = fillTemplate(
        template.titleVariants[stableIndex(`${seed}|title`, template.titleVariants.length)],
        {
          page,
          code: params.code,
          defaultAction: params.defaultAction,
        }
      );
      const detail = fillTemplate(
        template.detailVariants[stableIndex(`${seed}|detail`, template.detailVariants.length)],
        {
          page,
          code: params.code,
          defaultAction: params.defaultAction,
        }
      );
      const actionTargets: CavAiNextActionV1["openTargets"] = [
        {
          type: "url",
          target: new URL(page, params.origin).toString(),
          label: "Affected page",
        },
      ];
      if (templateFileTargets.length) {
        actionTargets.push({
          type: "file",
          target: templateFileTargets[0],
          label: "Primary workspace target",
        });
      }
      templateActions.push({
        id: `action_${codeId}_${template.id}_${p + 1}`,
        code: params.code,
        title,
        detail,
        targetArea: params.targetArea,
        evidenceFindingIds: params.evidenceFindingIds.slice(0, 50),
        openTargets: actionTargets,
      });
      if (templateActions.length >= 12) break;
    }
    if (templateActions.length >= 12) break;
  }

  const needs404Game =
    params.code === "missing_custom_404_page" ||
    params.code === "status_404_misconfigured" ||
    params.code === "broken_404_nav_home" ||
    params.code === "recommend_404_arcade_game";
  if (needs404Game) {
    const game = pickDeterministic404Game(params.origin, params.runId);
    templateActions.push({
      id: `action_${codeId}_404_arcade`,
      code: params.code,
      title: `Add deterministic 404 module: ${game.name}`,
      detail: `Use ${game.name} for the 404 recovery surface. Keep runtime loops untouched and mount assets at ${game.filePath}.`,
      targetArea: "template",
      evidenceFindingIds: params.evidenceFindingIds.slice(0, 50),
      openTargets: [
        {
          type: "url",
          target: new URL("/404", params.origin).toString(),
          label: "404 route target",
        },
        {
          type: "file",
          target: game.filePath,
          label: "404 game module",
        },
        {
          type: "file",
          target: game.manifestPath,
          label: "404 game manifest",
        },
      ],
    });
  }

  return [baseAction, verifyAction].concat(templateActions);
}

function whyMattersByPillar(pillar: CavAiPillar) {
  if (pillar === "seo") return "This affects discoverability and search intent capture.";
  if (pillar === "performance") return "This affects perceived speed and conversion completion.";
  if (pillar === "accessibility") return "This impacts assistive technology usability and compliance.";
  if (pillar === "ux") return "This creates friction in core user journeys.";
  if (pillar === "engagement") return "This lowers user retention and conversion intent.";
  return "This introduces reliability risk across production workflows.";
}

function buildPriorityExplanation(priority: CavAiPriorityV1, totalPagesScanned: number) {
  const samplePages = priority.nextActions
    .flatMap((action) => action.openTargets)
    .filter((target) => target.type === "url")
    .map((target) => {
      try {
        return new URL(target.target).pathname || "/";
      } catch {
        return "/";
      }
    })
    .slice(0, 3);

  const examples = samplePages.length ? samplePages.join(", ") : "(no sample pages)";
  if (priority.code === "missing_favicon") {
    return [
      "A favicon is your site's icon in browser tabs, bookmarks, and some search results.",
      "It boosts recognition and trust because users can identify your site instantly.",
      `CavBot detected missing favicon coverage on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
      `Examples: ${examples}.`,
      "Current evidence indicates no declared favicon and /favicon.ico is unavailable for fallback.",
      "Fix: add a favicon asset set and shared head links.",
      "Recommended assets:",
      ...FAVICON_ASSET_LINES,
      "Head snippet:",
      FAVICON_HEAD_SNIPPET,
      `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    ].join("\n");
  }
  if (priority.code === "theme_color_needs_branding") {
    return [
      "CavBot detected missing or generic theme-color branding metadata.",
      `It appears on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
      `Examples: ${examples}.`,
      "When theme-color remains default/white, browser surfaces can look generic and reduce trust cues.",
      "Fix: set meta theme-color and msapplication tile color to a brand-safe value.",
      `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    ].join("\n");
  }
  if (
    priority.code === "missing_structured_data" ||
    priority.code === "missing_website_schema" ||
    priority.code === "missing_organization_schema" ||
    priority.code === "missing_person_schema" ||
    priority.code === "invalid_json_ld" ||
    priority.code === "duplicate_json_ld_ids"
  ) {
    return [
      `CavBot detected a structured-data issue (${priority.code}).`,
      `It appears on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
      `Examples: ${examples}.`,
      "Why it matters: malformed or incomplete schema can block rich results and entity trust signals.",
      "Fix path: validate JSON-LD syntax, maintain stable @id nodes, and publish required Organization/WebSite/Person nodes based on configured profile.",
      `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    ].join("\n");
  }
  if (priority.code === "missing_theme_color") {
    return [
      "CavBot detected missing theme-color metadata.",
      `It appears on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
      `Examples: ${examples}.`,
      "Fix: set a branded theme-color value in the shared head template.",
      `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    ].join("\n");
  }
  if (
    priority.code === "missing_custom_404_page" ||
    priority.code === "status_404_misconfigured" ||
    priority.code === "internal_links_to_404"
  ) {
    return [
      "CavBot detected 404 reliability risk.",
      `It appears on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
      `Examples: ${examples}.`,
      "Fix: return proper 404 status, repair internal links, and provide a clear recovery path on the 404 template.",
      `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
    ].join("\n");
  }
  return [
    `CavBot detected ${priority.title.toLowerCase()} (${priority.code}).`,
    `It appears on ${priority.affectedPages} page(s) out of ${totalPagesScanned}.`,
    `Examples: ${examples}.`,
    `Why it matters: ${whyMattersByPillar(priority.pillar)}`,
    `What to do next: ${priority.nextActions[0]?.detail || "Review the evidence and apply the mapped fix."}`,
    `Confidence: ${priority.confidence.toUpperCase()} — ${priority.confidenceReason}`,
  ].join(" ");
}

function defaultOverlay(): CavAiOverlayV1 {
  return {
    historyWindow: 5,
    generatedFromRunIds: [],
    codeHistory: {},
    diff: {
      resolvedCodes: [],
      newCodes: [],
      persistedCodes: [],
      summary: "No historical diff was available for this request.",
    },
    praise: {
      line: "No historical improvements detected yet.",
      reason: "Diff context unavailable.",
    },
    trend: {
      state: "stagnating",
      reason: "No historical run overlay was available for this request.",
    },
    fatigue: {
      level: "none",
      message: "No repeated priority fatigue detected in the current overlay window.",
    },
  };
}

function stableSortPriorities(priorities: CavAiPriorityV1[]) {
  return priorities.slice().sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) return severityDiff;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.coverage !== a.coverage) return b.coverage - a.coverage;
    if (b.pageImportanceWeight !== a.pageImportanceWeight) {
      return b.pageImportanceWeight - a.pageImportanceWeight;
    }
    return a.code.localeCompare(b.code);
  });
}

export function canonicalJson(input: unknown): string {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = visit((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(visit(input));
}

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function buildInputHash(input: NormalizedScanInputV1) {
  return sha256Hex(canonicalJson(input));
}

type BuildCoreOptions = {
  engineVersion: string;
  requestId: string;
  runId: string;
  accountId: string;
  generatedAt: string;
  inputHash: string;
};

function resolveFileTargets(input: NormalizedScanInputV1) {
  const raw = input.context?.routeMetadata;
  if (!raw || typeof raw !== "object") return [];
  const value = (raw as Record<string, unknown>).fileTargets;
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

export function buildDeterministicCore(
  input: NormalizedScanInputV1,
  opts: BuildCoreOptions
): CavAiInsightPackV1 {
  const findings = input.findings
    .slice()
    .sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
      return a.id.localeCompare(b.id);
    })
    .map((finding) => ({
      ...finding,
      pagePath: normalizePath(finding.pagePath),
      templateHint: finding.templateHint || null,
    }));

  const pagesScanned = Math.max(1, input.pagesSelected.length);
  const patternGroups = new Map<string, typeof findings>();
  for (const finding of findings) {
    const key = `${finding.code}::${finding.templateHint || ""}::${normalizeRouteShape(
      finding.pagePath
    )}`;
    const existing = patternGroups.get(key) || [];
    existing.push(finding);
    patternGroups.set(key, existing);
  }

  const patterns: CavAiPatternV1[] = Array.from(patternGroups.entries())
    .map(([key, group]) => {
      const parts = key.split("::");
      const code = parts[0] || group[0].code;
      const templateHint = parts[1] || null;
      const routeShape = parts[2] || null;
      const pillar = group[0].pillar;
      const severity = group.reduce(
        (highest, current) => pickSeverity(highest, current.severity),
        group[0].severity
      );
      const uniquePages = Array.from(new Set(group.map((item) => normalizePath(item.pagePath)))).sort();
      const coverage = uniquePages.length / Math.max(1, pagesScanned);
      let scope: CavAiPatternV1["scope"] = "single";
      if (uniquePages.length > 1 && templateHint) scope = "template";
      if (coverage >= 0.6 || uniquePages.length >= Math.max(3, Math.ceil(pagesScanned * 0.6))) {
        scope = "sitewide";
      }
      const confidence: CavAiPriorityConfidence =
        coverage >= 0.6 ? "high" : uniquePages.length >= 2 ? "medium" : "low";
      const confidenceReason =
        confidence === "high"
          ? "Coverage crosses 60% of scanned pages."
          : confidence === "medium"
          ? "Finding appears on multiple pages in this run."
          : "Finding is isolated to a single page.";

      return {
        code,
        pillar,
        severity,
        scope,
        affectedPages: uniquePages.length,
        totalPagesScanned: pagesScanned,
        samplePages: uniquePages.slice(0, 5),
        confidence,
        confidenceReason,
        evidenceFindingIds: group.map((item) => item.id),
        templateHint,
        routeShape,
      };
    })
    .sort((a, b) => {
      if (SEVERITY_RANK[b.severity] !== SEVERITY_RANK[a.severity]) {
        return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      }
      if (b.affectedPages !== a.affectedPages) return b.affectedPages - a.affectedPages;
      return a.code.localeCompare(b.code);
    });

  const fileTargets = resolveFileTargets(input);
  const groupsByCode = new Map<string, typeof findings>();
  for (const finding of findings) {
    const existing = groupsByCode.get(finding.code) || [];
    existing.push(finding);
    groupsByCode.set(finding.code, existing);
  }

  const priorities: CavAiPriorityV1[] = Array.from(groupsByCode.entries()).map(([code, group]) => {
    const evidenceFindingIds = group.map((item) => item.id).sort();
    const pages = Array.from(new Set(group.map((item) => normalizePath(item.pagePath)))).sort();
    const pillars = new Set(group.map((item) => item.pillar));
    const templateCounts = new Map<string, number>();
    for (const finding of group) {
      const template = String(finding.templateHint || "").trim();
      if (!template) continue;
      templateCounts.set(template, (templateCounts.get(template) || 0) + 1);
    }
    const repeatedTemplate = Array.from(templateCounts.values()).some((count) => count >= 2);

    const severity = group.reduce(
      (highest, current) => pickSeverity(highest, current.severity),
      group[0].severity
    );
    const definition = resolveCodeDefinition(code, group[0].pillar);
    const coverage = pages.length / Math.max(1, pagesScanned);
    const severityWeight = SEVERITY_WEIGHT[severity];
    const coverageWeightValue = coverageWeight(coverage);
    const pageImportanceWeightValue = pageImportanceWeight(pages);
    const crossPillarWeightValue = crossPillarWeight(pillars);
    const effortPenalty = EFFORT_PENALTY[definition.effort];

    const baseScore =
      severityWeight +
      coverageWeightValue +
      pageImportanceWeightValue +
      crossPillarWeightValue -
      effortPenalty;
    const coreScore =
      severity === "critical" ? Math.max(clamp(baseScore, 0, 100), 70) : clamp(baseScore, 0, 100);

    const confidence = confidenceForPriority({
      coverage,
      affectedPages: pages.length,
      repeatedTemplate,
      consecutiveRuns: 0,
    });

    const nextActions = nextActionsForPriority({
      code,
      origin: input.origin,
      samplePages: pages,
      evidenceFindingIds,
      pillar: definition.pillar,
      targetArea: definition.targetArea,
      defaultAction: definition.defaultAction,
      fileTargets,
      engineVersion: opts.engineVersion,
      runId: opts.runId,
    });

    return {
      code,
      pillar: definition.pillar,
      severity,
      title: `Resolve ${definition.label}`,
      summary: `${definition.label} appears on ${pages.length} of ${pagesScanned} scanned pages.`,
      affectedPages: pages.length,
      totalPagesScanned: pagesScanned,
      coverage,
      severityWeight,
      coverageWeight: coverageWeightValue,
      pageImportanceWeight: pageImportanceWeightValue,
      crossPillarWeight: crossPillarWeightValue,
      effortPenalty,
      persistenceWeight: 0,
      coreScore,
      priorityScore: coreScore,
      confidence: confidence.level,
      confidenceReason: confidence.reason,
      evidenceFindingIds,
      nextActions,
    };
  });

  const sortedCorePriorities = stableSortPriorities(priorities);
  const nextActions = sortedCorePriorities
    .flatMap((priority) => priority.nextActions.slice(0, 1))
    .slice(0, 8);
  const confidence = confidenceFromPriorities(sortedCorePriorities);
  const risk = riskFromPriorities(sortedCorePriorities);

  const allEvidenceIds = findings.map((finding) => finding.id);
  const explanations = [
    {
      id: "scan_summary",
      title: "Scan summary",
      text: `CavBot analyzed ${pagesScanned} selected page(s) for ${input.origin} and produced ${findings.length} deterministic finding(s).`,
      evidenceFindingIds: allEvidenceIds.slice(0, 40),
    },
    {
      id: "confidence_statement",
      title: "Confidence",
      text: `Confidence is ${confidence.level.toUpperCase()}: ${confidence.reason}`,
      evidenceFindingIds: confidence.evidenceFindingIds.slice(0, 40),
    },
    {
      id: "risk_statement",
      title: "Risk",
      text: `Risk is ${risk.level.toUpperCase()}: ${risk.reason}`,
      evidenceFindingIds: risk.evidenceFindingIds.slice(0, 40),
    },
    {
      id: "priorities_list",
      title: "Priorities",
      text: sortedCorePriorities.length
        ? sortedCorePriorities
            .slice(0, 5)
            .map((priority, idx) => `${idx + 1}. ${priority.title} (score ${priority.priorityScore})`)
            .join(" ")
        : "No priorities were generated.",
      evidenceFindingIds: sortedCorePriorities
        .flatMap((priority) => priority.evidenceFindingIds)
        .slice(0, 40),
    },
    {
      id: "next_actions_list",
      title: "Next actions",
      text: nextActions.length
        ? nextActions
            .slice(0, 5)
            .map((action, idx) => `${idx + 1}. ${action.title}`)
            .join(" ")
        : "No follow-up actions were generated.",
      evidenceFindingIds: nextActions.flatMap((action) => action.evidenceFindingIds).slice(0, 40),
    },
    ...sortedCorePriorities.map((priority) => ({
      id: `priority_${priority.code}`,
      title: `Priority: ${priority.title}`,
      text: buildPriorityExplanation(priority, pagesScanned),
      evidenceFindingIds: priority.evidenceFindingIds.slice(0, 40),
    })),
  ];

  const generatedAt =
    Number.isFinite(Date.parse(opts.generatedAt)) && opts.generatedAt ? opts.generatedAt : new Date(0).toISOString();

  const core = {
    findings,
    patterns,
    priorities: sortedCorePriorities,
    explanations,
    nextActions,
    confidence,
    risk,
  };

  return {
    packVersion: CAVAI_INSIGHT_PACK_VERSION_V1,
    meta: {
      packVersion: CAVAI_INSIGHT_PACK_VERSION_V1,
      engineVersion: opts.engineVersion,
      createdAt: generatedAt,
      runId: opts.runId,
      requestId: opts.requestId,
      origin: input.origin,
      accountId: opts.accountId,
    },
    engineVersion: opts.engineVersion,
    inputHash: opts.inputHash,
    coreDeterministic: true,
    overlayIncluded: false,
    requestId: opts.requestId,
    runId: opts.runId,
    accountId: opts.accountId,
    origin: input.origin,
    generatedAt,
    pagesScanned,
    pageLimit: input.pageLimit,
    core,
    priorities: core.priorities,
    explanations: core.explanations,
    nextActions: core.nextActions,
    confidence: core.confidence,
    risk: core.risk,
  };
}

export function applyOverlay(
  pack: CavAiInsightPackV1,
  overlayInput: CavAiOverlayV1 | null | undefined
): CavAiInsightPackV1 {
  const overlay = overlayInput || defaultOverlay();
  const mergedPriorities = pack.core.priorities.map((priority) => {
    const history: CavAiCodeHistoryV1 = overlay.codeHistory[priority.code] || {
      runsSeen: 0,
      consecutiveRuns: 0,
    };
    const persistenceWeight = Math.min(
      12,
      Math.max(0, history.runsSeen * 2 + history.consecutiveRuns * 2)
    );

    const score =
      priority.severityWeight +
      priority.coverageWeight +
      priority.pageImportanceWeight +
      priority.crossPillarWeight +
      persistenceWeight -
      priority.effortPenalty;
    const withClamp = clamp(score, 0, 100);
    const priorityScore =
      priority.severity === "critical" ? Math.max(withClamp, 70) : withClamp;

    const confidence = confidenceForPriority({
      coverage: priority.coverage,
      affectedPages: priority.affectedPages,
      repeatedTemplate: false,
      consecutiveRuns: history.consecutiveRuns,
    });

    return {
      ...priority,
      persistenceWeight,
      priorityScore,
      confidence: confidence.level,
      confidenceReason: confidence.reason,
    };
  });

  const sortedPriorities = stableSortPriorities(mergedPriorities);
  const nextActions = sortedPriorities
    .flatMap((priority) => priority.nextActions.slice(0, 1))
    .slice(0, 8);
  const confidence = confidenceFromPriorities(sortedPriorities);
  const risk = riskFromPriorities(sortedPriorities);

  const baseBlocks = pack.core.explanations.filter((block) => !block.id.startsWith("priority_"));
  const overlayEvidenceIds = sortedPriorities
    .flatMap((priority) => priority.evidenceFindingIds)
    .slice(0, 40);
  const overlayBlocks = [] as typeof baseBlocks;
  if (overlay.diff) {
    overlayBlocks.push({
      id: "overlay_diff",
      title: "What changed",
      text: overlay.diff.summary,
      evidenceFindingIds: overlayEvidenceIds.length ? overlayEvidenceIds : ["finding_none"],
    });
  }
  if (overlay.praise) {
    overlayBlocks.push({
      id: "overlay_praise",
      title: "Improvement signal",
      text: `${overlay.praise.line} ${overlay.praise.reason}`.trim(),
      evidenceFindingIds: overlayEvidenceIds.length ? overlayEvidenceIds : ["finding_none"],
    });
  }
  const priorityBlocks = sortedPriorities.map((priority) => ({
    id: `priority_${priority.code}`,
    title: `Priority: ${priority.title}`,
    text: buildPriorityExplanation(priority, pack.pagesScanned),
    evidenceFindingIds: priority.evidenceFindingIds.slice(0, 40),
  }));
  const explanations = baseBlocks.concat(overlayBlocks, priorityBlocks);

  return {
    ...pack,
    overlayIncluded: true,
    overlay,
    priorities: sortedPriorities,
    explanations,
    nextActions,
    confidence,
    risk,
  };
}

export function buildFixPlanFromInsightPack(
  pack: CavAiInsightPackV1,
  priorityCode: string
): CavAiFixPlanV1 | null {
  const normalizedCode = String(priorityCode || "").trim().toLowerCase();
  if (!normalizedCode) return null;
  const priority = pack.priorities.find((item) => item.code === normalizedCode);
  if (!priority) return null;
  const definition = resolveCodeDefinition(priority.code, priority.pillar);
  const primaryAction = priority.nextActions[0];
  const openTargets = priority.nextActions
    .flatMap((action) => action.openTargets)
    .slice(0, 10);

  return {
    version: CAVAI_FIX_PLAN_VERSION_V1,
    meta: {
      packVersion: pack.packVersion,
      engineVersion: pack.engineVersion,
      createdAt: new Date().toISOString(),
      runId: pack.runId,
      requestId: pack.requestId,
      origin: pack.origin,
      accountId: pack.accountId,
    },
    runId: pack.runId,
    priorityCode: priority.code,
    title: `CavBot fix plan: ${priority.title}`,
    targetArea: definition.targetArea,
    evidenceFindingIds: priority.evidenceFindingIds.slice(0, 50),
    steps: [
      `Review evidence-linked findings for ${priority.code} and confirm reproducibility.`,
      primaryAction?.detail || definition.defaultAction,
      `Apply changes in the ${definition.targetArea} layer and keep fixes scoped to affected targets.`,
      "Document the change and expected impact before verification.",
    ],
    verificationSteps: [
      "Run lint/tests relevant to impacted routes or templates.",
      "Verify impacted URLs/files in openTargets render correctly.",
      "Run a fresh CavBot diagnostics scan and confirm evidence IDs clear.",
    ],
    openTargets,
  };
}

export {
  validateNarrationAgainstInsightPack,
  validateCodeFixProposalAgainstInsightPack,
  type CavAiCodeFixProposalProvider,
  type CavAiNarrationProvider,
  type CavAiProviderValidationError,
  type CavAiProviderValidationErrorCode,
  type CavAiProviderValidationResult,
} from "./provider";
