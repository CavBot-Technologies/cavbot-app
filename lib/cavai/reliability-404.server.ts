import { createHash } from "crypto";
import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  asRecord,
  dedupeFindings,
  deriveDetectedAt,
  normalizeOrigin,
  normalizePath,
  readBoolean,
  readString,
  routeMetadataFromInput,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type HttpProbe = {
  url: string;
  status: number;
  method: "HEAD" | "GET";
  bodySnippet: string;
};

const RELIABILITY_CODES = new Set([
  "missing_custom_404_page",
  "broken_404_nav_home",
  "internal_links_to_404",
  "status_404_misconfigured",
  "missing_home_link",
  "missing_nav_landmark",
  "broken_back_to_top",
  "inconsistent_navigation",
  "recommend_404_arcade_game",
]);

const GAME_CATALOG = [
  {
    id: "catch-cavbot",
    name: "Catch CavBot",
    assetPath: "https://cdn.cavbot.io/arcade/404/catch-cavbot/v1/index.html",
  },
  {
    id: "tennis-cavbot",
    name: "Tennis CavBot",
    assetPath: "https://cdn.cavbot.io/arcade/404/tennis-cavbot/v1/index.html",
  },
] as const;

function derivePagePath(input: NormalizedScanInputV1) {
  const pages = input.findings
    .map((item) => normalizePath(item.pagePath))
    .filter(Boolean)
    .sort();
  if (pages.length) return pages[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) return normalizePath(input.pagesSelected[0]);
  return "/";
}

function deterministic404Game(origin: string, seed: string) {
  const digest = createHash("sha256").update(`${origin}|${seed}|404`).digest("hex");
  const n = Number.parseInt(digest.slice(0, 8), 16);
  const idx = Number.isFinite(n) ? n % GAME_CATALOG.length : 0;
  return GAME_CATALOG[idx];
}

async function probeUrl(args: {
  fetchImpl: FetchLike;
  url: string;
  maxBodyChars?: number;
}): Promise<HttpProbe> {
  const maxBodyChars = Math.max(0, Math.min(1000, Number(args.maxBodyChars || 480)));
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(2400)
      : undefined;

  try {
    const head = await args.fetchImpl(args.url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal: timeoutSignal,
    });
    const status = Number(head.status) || 0;
    if (status && status !== 405 && status !== 501) {
      return {
        url: args.url,
        status,
        method: "HEAD",
        bodySnippet: "",
      };
    }
  } catch {
    // fallback to GET
  }

  try {
    const get = await args.fetchImpl(args.url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: timeoutSignal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Range: "bytes=0-1500",
      },
    });
    const text = await get.text().catch(() => "");
    return {
      url: args.url,
      status: Number(get.status) || 0,
      method: "GET",
      bodySnippet: String(text || "").slice(0, maxBodyChars),
    };
  } catch {
    return {
      url: args.url,
      status: 0,
      method: "GET",
      bodySnippet: "",
    };
  }
}

function readReliabilitySnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return (
    asRecord(routeMetadata.reliability404) ||
    asRecord(routeMetadata.reliability) ||
    asRecord(routeMetadata.routes) ||
    null
  );
}

function readNavigationSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return asRecord(routeMetadata.navigation);
}

function resolveInternalLinkTargets(snapshot: Record<string, unknown> | null, origin: string): string[] {
  if (!snapshot) return [];

  const rawLinks = Array.isArray(snapshot.internalLinks) ? snapshot.internalLinks : [];
  const out = new Set<string>();
  for (const row of rawLinks.slice(0, 24)) {
    if (typeof row === "string") {
      const p = normalizePath(row);
      if (p.startsWith("http://") || p.startsWith("https://")) continue;
      out.add(p);
      continue;
    }
    const record = asRecord(row);
    if (!record) continue;
    const href = readString(record.href, 1200) || readString(record.path, 1200);
    if (!href) continue;
    try {
      const u = new URL(href, origin);
      if (u.origin !== origin) continue;
      out.add(`${u.pathname || "/"}${u.search || ""}` || "/");
    } catch {
      const p = normalizePath(href);
      if (p) out.add(p);
    }
  }

  return Array.from(out).sort().slice(0, 12);
}

export function deterministic404GameRecommendation(input: {
  origin: string;
  seed: string;
}) {
  return deterministic404Game(input.origin, input.seed);
}

export async function augmentReliability404Findings(params: {
  input: NormalizedScanInputV1;
  fetchImpl?: FetchLike;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !RELIABILITY_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;

  const pagePath = derivePagePath(input);
  const detectedAt = deriveDetectedAt(input.findings);
  const fetchImpl = params.fetchImpl || fetch;

  const snapshot = readReliabilitySnapshot(input);
  const navigation = readNavigationSnapshot(input);
  const findings: CavAiFindingV1[] = [];

  const probePath =
    readString(snapshot?.probePath, 200) ||
    `/__cavai_not_found_probe_${createHash("sha256").update(origin).digest("hex").slice(0, 12)}`;
  const notFoundProbeUrl = new URL(normalizePath(probePath), origin).toString();
  const notFoundProbe = await probeUrl({
    fetchImpl,
    url: notFoundProbeUrl,
    maxBodyChars: 720,
  });

  if (notFoundProbe.status === 200) {
    findings.push({
      id: stableFindingId("status_404_misconfigured", origin, pagePath),
      code: "status_404_misconfigured",
      pillar: "reliability",
      severity: "high",
      evidence: [
        {
          type: "http",
          url: notFoundProbe.url,
          method: notFoundProbe.method,
          status: 200,
        },
        {
          type: "route",
          path: normalizePath(probePath),
          statusCode: 200,
          reason: "Missing routes should not return HTTP 200.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const hasCustom404FromSnapshot = readBoolean(snapshot?.hasCustom404Page);
  const body = String(notFoundProbe.bodySnippet || "").toLowerCase();
  const bodyMentions404 = /404|not found|page not found/.test(body);
  const bodyHasHome = /href\s*=\s*["']\/["']/.test(body) || /back\s+home|home page|go home/.test(body);

  if (hasCustom404FromSnapshot === false || (notFoundProbe.status === 404 && !bodyMentions404)) {
    findings.push({
      id: stableFindingId("missing_custom_404_page", origin, pagePath),
      code: "missing_custom_404_page",
      pillar: "reliability",
      severity: "medium",
      evidence: [
        {
          type: "http",
          url: notFoundProbe.url,
          method: notFoundProbe.method,
          status: notFoundProbe.status || 0,
        },
        {
          type: "route",
          path: normalizePath(probePath),
          statusCode: notFoundProbe.status || undefined,
          reason: "Custom 404 experience was not detected reliably.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if ((notFoundProbe.status === 404 || hasCustom404FromSnapshot === true) && !bodyHasHome && readBoolean(snapshot?.hasHomeLinkOn404) !== true) {
    findings.push({
      id: stableFindingId("broken_404_nav_home", origin, pagePath),
      code: "broken_404_nav_home",
      pillar: "reliability",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "main a[href='/'], [data-404-home]",
          snippet: "404 surface does not expose a clear path back home.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const internalTargets = resolveInternalLinkTargets(snapshot, origin);
  if (internalTargets.length) {
    let hits404 = 0;
    const sampleBad: string[] = [];
    for (const path of internalTargets) {
      const probe = await probeUrl({
        fetchImpl,
        url: new URL(path, origin).toString(),
      });
      if (probe.status === 404 || probe.status === 410) {
        hits404 += 1;
        sampleBad.push(path);
      }
    }
    if (hits404 > 0) {
      findings.push({
        id: stableFindingId("internal_links_to_404", origin, pagePath),
        code: "internal_links_to_404",
        pillar: "reliability",
        severity: hits404 >= 3 ? "high" : "medium",
        evidence: [
          {
            type: "route",
            path: sampleBad[0] || "/",
            statusCode: 404,
            reason: `${hits404} internal link(s) resolve to 404/410.`,
          },
          {
            type: "metric",
            name: "internal_links_to_404",
            value: hits404,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  if (readBoolean(navigation?.hasHomeLink) === false) {
    findings.push({
      id: stableFindingId("missing_home_link", origin, pagePath),
      code: "missing_home_link",
      pillar: "ux",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "header a[href='/'], a[aria-label*='home' i]",
          snippet: "Global navigation is missing a direct Home link.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (readBoolean(navigation?.hasNavLandmark) === false) {
    findings.push({
      id: stableFindingId("missing_nav_landmark", origin, pagePath),
      code: "missing_nav_landmark",
      pillar: "accessibility",
      severity: "low",
      evidence: [
        {
          type: "dom",
          selector: "nav,[role='navigation']",
          snippet: "Navigation landmark is missing or not detectable.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (readBoolean(navigation?.backToTopBroken) === true) {
    findings.push({
      id: stableFindingId("broken_back_to_top", origin, pagePath),
      code: "broken_back_to_top",
      pillar: "ux",
      severity: "low",
      evidence: [
        {
          type: "dom",
          selector: "a[href='#top'], [data-back-to-top]",
          snippet: "Back-to-top affordance exists but appears non-functional.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (readBoolean(navigation?.inconsistentAcrossPages) === true) {
    findings.push({
      id: stableFindingId("inconsistent_navigation", origin, pagePath),
      code: "inconsistent_navigation",
      pillar: "ux",
      severity: "medium",
      evidence: [
        {
          type: "metric",
          name: "inconsistent_navigation",
          value: 1,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const shouldRecommendGame =
    findings.some((row) =>
      row.code === "missing_custom_404_page" ||
      row.code === "status_404_misconfigured" ||
      row.code === "broken_404_nav_home"
    ) ||
    readBoolean(snapshot?.hasCustom404Page) === true;

  if (shouldRecommendGame) {
    const game = deterministic404Game(origin, `${detectedAt}|${probePath}`);
    findings.push({
      id: stableFindingId("recommend_404_arcade_game", origin, pagePath),
      code: "recommend_404_arcade_game",
      pillar: "engagement",
      severity: "note",
      evidence: [
        {
          type: "log",
          level: "info",
          fingerprint: `404_arcade:${game.id}`,
          message: `Deterministic recommendation: ${game.name} for the 404 recovery surface.`,
        },
        {
          type: "route",
          path: "/404",
          reason: `Implementation target asset: ${game.assetPath}`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  return dedupeFindings(passthroughFindings.concat(findings)).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
    return a.id.localeCompare(b.id);
  });
}
