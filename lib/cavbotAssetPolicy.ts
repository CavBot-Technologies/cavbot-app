const DEFAULT_CDN_BASE = "https://cdn.cavbot.io";
const DEFAULT_APP_ASSET_BASE = "https://app.cavbot.io";

const INTERNAL_PATHS = {
  analyticsScript: "/cavai/cavai-analytics-v5.js",
  brainScript: "/cavai/cavai.js",
  widgetScript: "/cavbot/widget/cavbot-widget.js",
  arcadeLoaderScript: "/cavbot/arcade/loader.js",
  badgeInlineCss: "/cavbot/badge/cavbot-badge-inline.css",
  badgeRingCss: "/cavbot/badge/cavbot-badge-ring.css",
  headOrbitCss: "/cavbot/head/cavbot-head-orbit.css",
  fullBodyCss: "/cavbot/body/cavbot-full-body.css",
} as const;

export type CavbotAssetContext = "internal_runtime" | "customer_snippet";

export type CavbotAssetPolicy = {
  context: CavbotAssetContext;
  baseUrl: string;
  cacheKey: string | null;
  scripts: {
    analytics: string;
    brain: string;
    widget: string;
    arcadeLoader: string;
  };
  styles: {
    badgeInline: string;
    badgeRing: string;
    headOrbit: string;
    fullBody: string;
  };
};

function trimTrailingSlash(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

function sanitizeCacheKey(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 80);
}

function buildPublicAppAssetBase(): string {
  const candidate =
    process.env.NEXT_PUBLIC_WIDGET_CONFIG_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.CAVBOT_APP_ORIGIN ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : DEFAULT_APP_ASSET_BASE);
  const normalized = trimTrailingSlash(String(candidate || ""));
  return normalized || DEFAULT_APP_ASSET_BASE;
}

function buildInternalCacheKey(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const raw =
    process.env.NEXT_PUBLIC_CAVBOT_ASSET_VERSION ||
    process.env.CAVBOT_ASSET_VERSION ||
    process.env.NEXT_PUBLIC_CAVBOT_BUILD_ID ||
    process.env.CAVBOT_BUILD_ID ||
    process.env.NEXT_BUILD_ID ||
    process.env.BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.GITHUB_SHA ||
    process.env.SOURCE_VERSION ||
    process.env.npm_package_version ||
    "prod";

  const normalized = sanitizeCacheKey(raw);
  return normalized || "prod";
}

function withCacheKey(pathname: string, cacheKey: string | null): string {
  if (!cacheKey) return pathname;
  const joiner = pathname.includes("?") ? "&" : "?";
  return `${pathname}${joiner}v=${encodeURIComponent(cacheKey)}`;
}

function buildInternalPolicy(): CavbotAssetPolicy {
  const cacheKey = buildInternalCacheKey();
  return {
    context: "internal_runtime",
    baseUrl: "/",
    cacheKey,
    scripts: {
      analytics: withCacheKey(INTERNAL_PATHS.analyticsScript, cacheKey),
      brain: withCacheKey(INTERNAL_PATHS.brainScript, cacheKey),
      widget: withCacheKey(INTERNAL_PATHS.widgetScript, cacheKey),
      arcadeLoader: withCacheKey(INTERNAL_PATHS.arcadeLoaderScript, cacheKey),
    },
    styles: {
      badgeInline: withCacheKey(INTERNAL_PATHS.badgeInlineCss, cacheKey),
      badgeRing: withCacheKey(INTERNAL_PATHS.badgeRingCss, cacheKey),
      headOrbit: withCacheKey(INTERNAL_PATHS.headOrbitCss, cacheKey),
      fullBody: withCacheKey(INTERNAL_PATHS.fullBodyCss, cacheKey),
    },
  };
}

function buildCustomerSnippetPolicy(): CavbotAssetPolicy {
  const cdnBase = trimTrailingSlash(
    process.env.CAVBOT_CDN_BASE_URL ||
      process.env.NEXT_PUBLIC_CAVBOT_CDN_BASE_URL ||
      DEFAULT_CDN_BASE
  );
  const appBase = buildPublicAppAssetBase();

  return {
    context: "customer_snippet",
    baseUrl: cdnBase || DEFAULT_CDN_BASE,
    cacheKey: null,
    scripts: {
      analytics: `${appBase}${INTERNAL_PATHS.analyticsScript}`,
      brain: `${cdnBase || DEFAULT_CDN_BASE}/sdk/cavai/v1/cavai.min.js`,
      widget: `${cdnBase || DEFAULT_CDN_BASE}/sdk/widget/v1/cavbot-widget.min.js`,
      arcadeLoader: `${cdnBase || DEFAULT_CDN_BASE}/sdk/arcade/v1/loader.min.js`,
    },
    styles: {
      badgeInline: `${cdnBase || DEFAULT_CDN_BASE}/sdk/ui/v1/cavbot-badge-inline.css`,
      badgeRing: `${cdnBase || DEFAULT_CDN_BASE}/sdk/ui/v1/cavbot-badge-ring.css`,
      headOrbit: `${cdnBase || DEFAULT_CDN_BASE}/sdk/ui/v1/cavbot-head-orbit.css`,
      fullBody: `${cdnBase || DEFAULT_CDN_BASE}/sdk/ui/v1/cavbot-full-body.css`,
    },
  };
}

export function resolveCavbotAssetPolicy(context: CavbotAssetContext): CavbotAssetPolicy {
  return context === "internal_runtime"
    ? buildInternalPolicy()
    : buildCustomerSnippetPolicy();
}

export function isInternalRuntimeAssetUrl(url: string): boolean {
  const value = String(url || "");
  return value.startsWith("/cavai/") || value.startsWith("/cavbot/");
}

function stripQueryAndHash(url: string): string {
  const hashIdx = url.indexOf("#");
  const queryIdx = url.indexOf("?");
  let end = url.length;
  if (hashIdx >= 0) end = Math.min(end, hashIdx);
  if (queryIdx >= 0) end = Math.min(end, queryIdx);
  return url.slice(0, end);
}

const LEGACY_TO_INTERNAL: Record<string, keyof CavbotAssetPolicy["scripts"] | keyof CavbotAssetPolicy["styles"]> = {
  "/clients/cavbot-cdn/sdk/v5/cavai-analytics-v5.min.js": "analytics",
  "/clients/cavbot-cdn/sdk/v5/cavai-analytics-v5.js": "analytics",
  "/sdk/v5/cavai-analytics-v5.min.js": "analytics",
  "/sdk/v5/cavai-analytics-v5.js": "analytics",
  "/clients/cavbot-cdn/sdk/cavai/v1/cavai.min.js": "brain",
  "/sdk/cavai/v1/cavai.min.js": "brain",
  "/sdk/brain/v1/cavai.min.js": "brain",
  "/clients/cavbot-cdn/sdk/widget/v1/cavbot-widget.min.js": "widget",
  "/sdk/widget/v1/cavbot-widget.min.js": "widget",
  "/clients/cavbot-cdn/sdk/arcade/v1/loader.min.js": "arcadeLoader",
  "/sdk/arcade/v1/loader.min.js": "arcadeLoader",
  "/clients/cavbot-cdn/sdk/ui/v1/cavbot-badge-inline.css": "badgeInline",
  "/clients/cavbot-cdn/sdk/ui/v1/cavbot-badge-ring.css": "badgeRing",
  "/clients/cavbot-cdn/sdk/ui/v1/cavbot-head-orbit.css": "headOrbit",
  "/clients/cavbot-cdn/sdk/ui/v1/cavbot-full-body.css": "fullBody",
  "/sdk/ui/v1/cavbot-badge-inline.css": "badgeInline",
  "/sdk/ui/v1/cavbot-badge-ring.css": "badgeRing",
  "/sdk/ui/v1/cavbot-head-orbit.css": "headOrbit",
  "/sdk/ui/v1/cavbot-full-body.css": "fullBody",
};

export function rewriteLegacyInternalRuntimeAssetPath(url: string): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  const pathOnly = stripQueryAndHash(trimmed);
  const key = LEGACY_TO_INTERNAL[pathOnly];
  if (!key) return null;
  const policy = resolveCavbotAssetPolicy("internal_runtime");
  if (key in policy.scripts) {
    return policy.scripts[key as keyof CavbotAssetPolicy["scripts"]];
  }
  return policy.styles[key as keyof CavbotAssetPolicy["styles"]];
}
