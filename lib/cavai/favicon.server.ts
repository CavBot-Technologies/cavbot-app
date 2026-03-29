import { createHash } from "crypto";
import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type FaviconProbe = {
  url: string;
  method: "HEAD" | "GET";
  status: number;
};

type FaviconSignals = {
  hasFavicon: boolean | null;
  hasAppleTouch: boolean | null;
  hasManifest: boolean | null;
  themeColor: string | null;
  msTileColor: string | null;
  msTileImage: string | null;
  pagePath: string;
  templateHint: string | null;
  iconHref: string | null;
};

const FAVICON_CODES = new Set([
  "missing_favicon",
  "missing_apple_touch_icon",
  "missing_web_manifest_icon_set",
  "theme_color_needs_branding",
]);

function normalizeOrigin(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function normalizePath(raw: unknown) {
  const value = String(raw || "").trim();
  if (!value) return "/";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const u = new URL(value);
      return `${u.pathname || "/"}${u.search || ""}`;
    } catch {
      return "/";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function stableFindingId(code: string, origin: string, pagePath: string) {
  const hash = createHash("sha256")
    .update(`${String(code || "")}|${String(origin || "")}|${String(pagePath || "")}`)
    .digest("hex")
    .slice(0, 14);
  return `finding_${String(code || "unknown").toLowerCase()}_${hash}`;
}

function deriveDetectedAt(findings: CavAiFindingV1[]) {
  const detectedAt = findings
    .map((item) => {
      const value = String(item.detectedAt || "").trim();
      if (!value) return "";
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) return "";
      return new Date(ms).toISOString();
    })
    .filter(Boolean)
    .sort();
  return detectedAt[0] || new Date(0).toISOString();
}

function boolOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value: unknown, maxLen: number) {
  if (typeof value !== "string") return null;
  const out = value.trim().slice(0, maxLen);
  return out || null;
}

function routeMetadataFromInput(input: NormalizedScanInputV1) {
  const routeMetadata = input.context?.routeMetadata;
  if (!routeMetadata || typeof routeMetadata !== "object") return null;
  return routeMetadata as Record<string, unknown>;
}

function faviconMetaFromRouteMetadata(routeMetadata: Record<string, unknown> | null) {
  if (!routeMetadata) return null;
  const direct = routeMetadata.favicon;
  if (direct && typeof direct === "object") {
    return direct as Record<string, unknown>;
  }
  const seo = routeMetadata.seo;
  if (seo && typeof seo === "object") {
    const nested = (seo as Record<string, unknown>).favicon;
    if (nested && typeof nested === "object") {
      return nested as Record<string, unknown>;
    }
  }
  return null;
}

function deriveTemplateHint(input: NormalizedScanInputV1) {
  const withTemplate = input.findings
    .map((finding) => String(finding.templateHint || "").trim())
    .filter(Boolean)
    .sort();
  return withTemplate[0] || null;
}

function derivePagePath(input: NormalizedScanInputV1) {
  const withPath = input.findings
    .map((finding) => normalizePath(finding.pagePath))
    .filter(Boolean)
    .sort();
  if (withPath.length) return withPath[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) {
    return normalizePath(input.pagesSelected[0]);
  }
  return "/";
}

function deriveFaviconSignals(input: NormalizedScanInputV1): FaviconSignals | null {
  const routeMetadata = routeMetadataFromInput(input);
  const faviconMeta = faviconMetaFromRouteMetadata(routeMetadata);
  const pagePath = derivePagePath(input);
  const templateHint = deriveTemplateHint(input);

  const incomingCodes = new Set(
    input.findings.map((finding) => String(finding.code || "").trim().toLowerCase()).filter(Boolean)
  );

  let hasFavicon = null as boolean | null;
  let hasAppleTouch = null as boolean | null;
  let hasManifest = null as boolean | null;
  let iconHref = null as string | null;
  let themeColor = null as string | null;
  let msTileColor = null as string | null;
  let msTileImage = null as string | null;

  if (faviconMeta) {
    hasFavicon = boolOrNull(faviconMeta.hasFavicon);
    hasAppleTouch = boolOrNull(faviconMeta.hasAppleTouch);
    hasManifest = boolOrNull(faviconMeta.hasManifest);
    iconHref = stringOrNull(faviconMeta.iconHref, 900);
    const appleTouchHref = stringOrNull(faviconMeta.appleTouchHref, 900);
    const manifestHref = stringOrNull(faviconMeta.manifestHref, 900);
    themeColor = stringOrNull(faviconMeta.themeColor, 80);
    msTileColor = stringOrNull(faviconMeta.msTileColor, 80);
    msTileImage = stringOrNull(faviconMeta.msTileImage, 900);

    if (hasFavicon == null && iconHref) {
      hasFavicon = true;
    }
    if (hasAppleTouch == null && appleTouchHref) {
      hasAppleTouch = true;
    }
    if (hasManifest == null && manifestHref) {
      hasManifest = true;
    }
    if (hasFavicon === true) {
      if (hasAppleTouch == null) hasAppleTouch = !!appleTouchHref;
      if (hasManifest == null) hasManifest = !!manifestHref;
    }
  }

  if (hasFavicon == null) {
    if (incomingCodes.has("missing_favicon")) hasFavicon = false;
    else if (
      incomingCodes.has("missing_apple_touch_icon") ||
      incomingCodes.has("missing_web_manifest_icon_set")
    ) {
      hasFavicon = true;
    }
  }
  if (hasAppleTouch == null && incomingCodes.has("missing_apple_touch_icon")) {
    hasAppleTouch = false;
  }
  if (hasManifest == null && incomingCodes.has("missing_web_manifest_icon_set")) {
    hasManifest = false;
  }

  if (hasFavicon == null && hasAppleTouch == null && hasManifest == null) {
    return null;
  }

  return {
    hasFavicon,
    hasAppleTouch,
    hasManifest,
    themeColor,
    msTileColor,
    msTileImage,
    pagePath,
    templateHint,
    iconHref,
  };
}

function isWhiteLikeThemeColor(raw: string | null) {
  const value = String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!value) return false;
  if (value === "#fff" || value === "#ffffff" || value === "white") return true;
  if (
    value === "rgb(255,255,255)" ||
    value === "rgba(255,255,255,1)" ||
    value === "rgba(255,255,255,1.0)"
  ) {
    return true;
  }
  return false;
}

async function probeDefaultFavicon(params: {
  origin: string;
  fetchImpl: FetchLike;
  probeCache: Map<string, FaviconProbe>;
}): Promise<FaviconProbe> {
  const origin = normalizeOrigin(params.origin);
  if (!origin) {
    return { url: "", method: "HEAD", status: 0 };
  }
  const cached = params.probeCache.get(origin);
  if (cached) return cached;

  const url = new URL("/favicon.ico", origin).toString();
  let probe: FaviconProbe = { url, method: "HEAD", status: 0 };
  const timeoutSignal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(2500)
      : undefined;

  try {
    const head = await params.fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal: timeoutSignal,
      headers: {
        Accept: "image/*,*/*;q=0.8",
      },
    });
    probe = { url, method: "HEAD", status: Number(head.status) || 0 };
  } catch {
    probe = { url, method: "HEAD", status: 0 };
  }

  if (probe.status === 405 || probe.status === 501 || probe.status === 0) {
    try {
      const get = await params.fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: timeoutSignal,
        headers: {
          Accept: "image/*,*/*;q=0.8",
          Range: "bytes=0-0",
        },
      });
      probe = { url, method: "GET", status: Number(get.status) || 0 };
    } catch {
      probe = { url, method: "GET", status: 0 };
    }
  }

  params.probeCache.set(origin, probe);
  return probe;
}

function buildFaviconFindings(params: {
  input: NormalizedScanInputV1;
  signals: FaviconSignals;
  detectedAt: string;
  probe: FaviconProbe | null;
}) {
  const origin = normalizeOrigin(params.input.origin);
  const findings: CavAiFindingV1[] = [];
  const hasIconFromDom = params.signals.hasFavicon === true;
  const fallbackStatus = params.probe ? Number(params.probe.status || 0) : 0;
  const hasFallbackFavicon = fallbackStatus >= 200 && fallbackStatus < 300;
  const faviconPresent = hasIconFromDom || hasFallbackFavicon;

  if (
    params.signals.hasFavicon === false &&
    (fallbackStatus === 404 || fallbackStatus === 410) &&
    origin
  ) {
    findings.push({
      id: stableFindingId("missing_favicon", origin, params.signals.pagePath),
      code: "missing_favicon",
      pillar: "seo",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "link[rel~=\"icon\"]",
          attribute: "rel",
          snippet: "No favicon link tag detected in <head>.",
        },
        {
          type: "http",
          url: params.probe?.url || new URL("/favicon.ico", origin).toString(),
          method: params.probe?.method || "HEAD",
          status: fallbackStatus,
        },
      ],
      origin,
      pagePath: params.signals.pagePath,
      templateHint: params.signals.templateHint,
      detectedAt: params.detectedAt,
    });
  }

  if (faviconPresent && params.signals.hasAppleTouch === false && origin) {
    const domEvidence = [] as CavAiFindingV1["evidence"];
    if (params.signals.iconHref) {
      domEvidence.push({
        type: "dom",
        selector: "link[rel~=\"icon\"]",
        attribute: "href",
        snippet: `Resolved icon: ${params.signals.iconHref}`,
      });
    }
    domEvidence.push({
      type: "dom",
      selector: "link[rel~=\"apple-touch-icon\"]",
      attribute: "rel",
      snippet: "No apple-touch-icon link detected in <head>.",
    });
    findings.push({
      id: stableFindingId("missing_apple_touch_icon", origin, params.signals.pagePath),
      code: "missing_apple_touch_icon",
      pillar: "seo",
      severity: "low",
      evidence: domEvidence,
      origin,
      pagePath: params.signals.pagePath,
      templateHint: params.signals.templateHint,
      detectedAt: params.detectedAt,
    });
  }

  if (faviconPresent && params.signals.hasManifest === false && origin) {
    const domEvidence = [] as CavAiFindingV1["evidence"];
    if (params.signals.iconHref) {
      domEvidence.push({
        type: "dom",
        selector: "link[rel~=\"icon\"]",
        attribute: "href",
        snippet: `Resolved icon: ${params.signals.iconHref}`,
      });
    }
    domEvidence.push({
      type: "dom",
      selector: "link[rel~=\"manifest\"]",
      attribute: "rel",
      snippet: "No manifest link detected in <head>.",
    });
    findings.push({
      id: stableFindingId("missing_web_manifest_icon_set", origin, params.signals.pagePath),
      code: "missing_web_manifest_icon_set",
      pillar: "seo",
      severity: "note",
      evidence: domEvidence,
      origin,
      pagePath: params.signals.pagePath,
      templateHint: params.signals.templateHint,
      detectedAt: params.detectedAt,
    });
  }

  if (faviconPresent && origin) {
    const themeColor = params.signals.themeColor;
    const missingTheme = !themeColor;
    const whiteTheme = isWhiteLikeThemeColor(themeColor);
    if (missingTheme || whiteTheme) {
      const evidence: CavAiFindingV1["evidence"] = [
        {
          type: "dom",
          selector: "meta[name=\"theme-color\"]",
          attribute: "content",
          snippet: missingTheme
            ? "No theme-color meta detected in <head>."
            : `theme-color is ${String(themeColor)}`,
        },
      ];
      if (params.signals.msTileColor || params.signals.msTileImage) {
        evidence.push({
          type: "dom",
          selector: "meta[name=\"msapplication-TileColor\"]",
          attribute: "content",
          snippet: params.signals.msTileColor
            ? `msapplication-TileColor is ${params.signals.msTileColor}`
            : "msapplication-TileColor not set.",
        });
      }
      findings.push({
        id: stableFindingId("theme_color_needs_branding", origin, params.signals.pagePath),
        code: "theme_color_needs_branding",
        pillar: "ux",
        severity: "low",
        evidence,
        origin,
        pagePath: params.signals.pagePath,
        templateHint: params.signals.templateHint,
        detectedAt: params.detectedAt,
      });
    }
  }

  return findings;
}

export async function augmentFaviconFindings(params: {
  input: NormalizedScanInputV1;
  fetchImpl?: FetchLike;
  probeCache?: Map<string, FaviconProbe>;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !FAVICON_CODES.has(String(finding.code || "").trim().toLowerCase())
  );
  const signals = deriveFaviconSignals(input);
  if (!signals) return passthroughFindings;

  const probeCache = params.probeCache || new Map<string, FaviconProbe>();
  const fetchImpl = params.fetchImpl || fetch;
  const shouldProbeDefault = signals.hasFavicon === false;
  const probe = shouldProbeDefault
    ? await probeDefaultFavicon({
        origin: input.origin,
        fetchImpl,
        probeCache,
      })
    : null;

  const detectedAt = deriveDetectedAt(input.findings);
  const faviconFindings = buildFaviconFindings({
    input,
    signals,
    detectedAt,
    probe,
  });

  return passthroughFindings.concat(faviconFindings);
}
