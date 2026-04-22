import { resolveCavbotAssetPolicy } from "@/lib/cavbotAssetPolicy";

const CUSTOMER_ASSET_POLICY = resolveCavbotAssetPolicy("customer_snippet");

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getAppOriginPublic() {
  const candidate =
    process.env.NEXT_PUBLIC_WIDGET_CONFIG_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.CAVBOT_APP_ORIGIN ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  const normalized = trimTrailingSlash(String(candidate || ""));
  return normalized;
}

const APP_ORIGIN = getAppOriginPublic();
const WIDGET_CONFIG_ORIGIN = trimTrailingSlash(
  process.env.NEXT_PUBLIC_WIDGET_CONFIG_ORIGIN ||
    process.env.CAVBOT_WIDGET_CONFIG_ORIGIN ||
    APP_ORIGIN
);
const EMBED_API_BASE = trimTrailingSlash(
  process.env.NEXT_PUBLIC_EMBED_API_URL ||
    process.env.CAVBOT_EMBED_API_URL ||
    APP_ORIGIN
);
const EMBED_ANALYTICS_ENDPOINT = EMBED_API_BASE ? `${EMBED_API_BASE}/api/embed/analytics` : "/api/embed/analytics";

function toJsonString(value: string | null | undefined) {
  return typeof value === "string" ? JSON.stringify(value) : "null";
}

export type WidgetType = "badge" | "head" | "body";
export type WidgetStyle = "inline" | "ring" | "orbit" | "full";
export type WidgetPosition =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left"
  | "center"
  | "center-left"
  | "center-right"
  | "inline";

export interface SnippetContext {
  publishableKey?: string | null;
  siteId?: string | null;
}

export function isSnippetReady(context: SnippetContext): boolean {
  return Boolean(context.publishableKey && context.siteId);
}

export interface ArcadeSnippetContext extends SnippetContext {
  appOrigin?: string | null;
}

export function buildAnalyticsSnippet(context: SnippetContext): string {
  if (!isSnippetReady(context)) return "";
  return `<script>
  window.CAVBOT_API_URL = ${JSON.stringify(EMBED_ANALYTICS_ENDPOINT)};
  window.CAVBOT_PROJECT_KEY = ${toJsonString(context.publishableKey)};
  window.CAVBOT_SITE = ${toJsonString(context.siteId)};
  window.CAVBOT_SITE_ID = ${toJsonString(context.siteId)};
  window.CAVBOT_SITE_PUBLIC_ID = ${toJsonString(context.siteId)};
</script>
<script src="${CUSTOMER_ASSET_POLICY.scripts.analytics}" defer></script>`;
}

export function buildBrainSnippet(context: SnippetContext): string {
  if (!isSnippetReady(context)) return "";
  return `<script
  defer
  src="${CUSTOMER_ASSET_POLICY.scripts.brain}"
  data-api="${EMBED_ANALYTICS_ENDPOINT}"
  data-project-key="${context.publishableKey}"
  data-site-id="${context.siteId}"
  data-site="${context.siteId}">
</script>`;
}

export function buildArcadeSnippet(context: ArcadeSnippetContext, env: string = "404"): string {
  if (!isSnippetReady(context)) return "";
  const origin = trimTrailingSlash(context.appOrigin ?? APP_ORIGIN);
  const originAttr = origin ? ` data-config-origin="${origin}"` : "";
  return `<script
  defer
  src="${CUSTOMER_ASSET_POLICY.scripts.arcadeLoader}"
  data-project-key="${context.publishableKey}"
  data-site-id="${context.siteId}"
  data-site="${context.siteId}"
${originAttr}
  data-env="${env}">
</script>`;
}

export interface WidgetSnippetOptions {
  widget: WidgetType;
  style: WidgetStyle;
  position: WidgetPosition;
  ready: boolean;
  context: SnippetContext;
}

export function buildWidgetSnippet(options: WidgetSnippetOptions): string {
  if (!options.ready) return "";
  const projectAttr = options.context.publishableKey
    ? ` data-project-key="${options.context.publishableKey}"`
    : "";
  const siteAttr = options.context.siteId ? ` data-site="${options.context.siteId}"` : "";
  const originAttr = WIDGET_CONFIG_ORIGIN ? ` data-config-origin="${WIDGET_CONFIG_ORIGIN}"` : "";
  return `<script
  defer
  src="${CUSTOMER_ASSET_POLICY.scripts.widget}"
  data-cavbot-widget="${options.widget}"
  data-style="${options.style}"
  data-position="${options.position}"${projectAttr}${siteAttr}${originAttr}>
</script>`;
}

export interface WidgetSnippetConfig {
  id: string;
  title: string;
  description: string;
  widget: WidgetType;
  style: WidgetStyle;
  position: WidgetPosition;
  meta?: string;
  lockMessage?: string;
}

const badgeInline: WidgetSnippetConfig = {
  id: "widget-badge-inline",
  title: "Badge — Inline",
  description: "Single-dot badge for light touch prompts.",
  widget: "badge",
  style: "inline",
  position: "bottom-right",
  lockMessage: "Select a site and key to unlock",
};

const badgeRing: WidgetSnippetConfig = {
  id: "widget-badge-ring",
  title: "Badge — Ring",
  description: "Ring badge that feels like an orbiting assistant.",
  widget: "badge",
  style: "ring",
  position: "bottom-right",
  lockMessage: "Select a site and key to unlock",
};

const headOrbit: WidgetSnippetConfig = {
  id: "widget-head-orbit",
  title: "Head — Orbit",
  description: "Available with a subscription; Hovering, eye-aware CavBot head powered by CavAi.",
  widget: "head",
  style: "orbit",
  position: "center-right",
  lockMessage: "Select a site and key to unlock",
};

const bodyFull: WidgetSnippetConfig = {
  id: "widget-body-full",
  title: "Full body",
  description: "Available only on premium+; Full-body presence engineered for CavBot-controlled experiences.",
  widget: "body",
  style: "full",
  position: "center",
  lockMessage: "Select a site and key to unlock",
};

export const WIDGET_SNIPPET_GROUPS: { title: string; configs: WidgetSnippetConfig[] }[] = [
  {
    title: "Badge",
    configs: [badgeInline, badgeRing],
  },
  {
    title: "Head",
    configs: [headOrbit],
  },
  {
    title: "Body",
    configs: [bodyFull],
  },
];

export const WIDGET_SNIPPET_CONFIGS = [badgeInline, badgeRing, headOrbit, bodyFull];

// Embed runtime config needs a canonical style allowlist per widget.
export const STYLE_OPTIONS: Record<WidgetType, WidgetStyle[]> = {
  badge: ["inline", "ring"],
  head: ["orbit"],
  body: ["full"],
};
