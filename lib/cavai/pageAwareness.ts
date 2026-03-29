export type CavAiCenterSurface = "general" | "workspace" | "console" | "cavcloud" | "cavsafe" | "cavpad" | "cavcode";

export type CavAiPageCategory =
  | "general"
  | "workspace"
  | "home"
  | "dashboard"
  | "analytics"
  | "diagnostics"
  | "errors"
  | "routing"
  | "seo"
  | "a11y"
  | "insights"
  | "settings"
  | "billing"
  | "account"
  | "auth"
  | "notifications"
  | "integrations"
  | "geo"
  | "support"
  | "tools"
  | "storage"
  | "security"
  | "notes"
  | "code"
  | "arcade"
  | "status"
  | "profile"
  | "share"
  | "docs"
  | "cavbot"
  | "invite"
  | "public"
  | "unknown";

export type CavAiRouteAwarenessInput = {
  pathname?: string | null;
  search?: string | null;
  origin?: string | null;
  workspaceId?: string | null;
  projectId?: string | number | null;
  siteId?: string | null;
  routeParams?: Record<string, unknown> | null;
  contextLabel?: string | null;
};

export type CavAiPageContextAdapter = {
  id: string;
  routePatterns: string[];
  surface: CavAiCenterSurface;
  category: CavAiPageCategory;
  contextLabel: string;
  tools?: string[];
  memoryScopes?: string[];
  recommendedActionClasses?: string[];
  allowedActions?: string[];
  restrictedActions?: string[];
  priority?: number;
};

export type CavAiRouteAwareness = {
  surface: CavAiCenterSurface;
  contextLabel: string;
  routePathname: string;
  routeSearch: string;
  routePattern: string;
  routeSegment: string;
  routeCategory: CavAiPageCategory;
  routeParams: Record<string, string>;
  workspaceId: string | null;
  projectId: number | null;
  siteId: string | null;
  tools: string[];
  memoryScopes: string[];
  recommendedActionClasses: string[];
  allowedActions: string[];
  restrictedActions: string[];
  adapterId: string;
  confidence: "exact" | "prefix" | "heuristic";
};

type RouteMatch = {
  matched: boolean;
  params: Record<string, string>;
  score: number;
  confidence: "exact" | "prefix";
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toPathname(pathname: unknown): string {
  const input = s(pathname).replace(/[#?].*$/, "");
  if (!input) return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/");
  if (normalized.length <= 1) return "/";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function toSearch(search: unknown): string {
  const input = s(search);
  if (!input) return "";
  if (input.startsWith("?")) return input;
  return `?${input}`;
}

function splitPath(path: string): string[] {
  return toPathname(path)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizePattern(pattern: string): string {
  const raw = toPathname(pattern);
  return raw === "/" ? raw : raw.replace(/\/+$/, "");
}

function isDynamicSegment(segment: string): boolean {
  return (segment.startsWith("[") && segment.endsWith("]")) || segment.startsWith(":");
}

function dynamicSegmentKey(segment: string): string {
  if (segment.startsWith("[") && segment.endsWith("]")) {
    const key = segment.slice(1, -1).trim();
    return key || "param";
  }
  if (segment.startsWith(":")) {
    const key = segment.slice(1).trim();
    return key || "param";
  }
  return "param";
}

function matchRoutePattern(pathname: string, pattern: string): RouteMatch {
  const pathParts = splitPath(pathname);
  const patternParts = splitPath(pattern);
  const params: Record<string, string> = {};
  let score = 0;
  let confidence: "exact" | "prefix" = "exact";

  let i = 0;
  let j = 0;
  while (i < patternParts.length && j < pathParts.length) {
    const p = patternParts[i];
    const v = pathParts[j];

    if (p === "**") {
      score += 1;
      confidence = "prefix";
      i = patternParts.length;
      j = pathParts.length;
      break;
    }
    if (p === "*") {
      score += 2;
      confidence = "prefix";
      i += 1;
      j += 1;
      continue;
    }
    if (isDynamicSegment(p)) {
      score += 4;
      confidence = "prefix";
      params[dynamicSegmentKey(p)] = v;
      i += 1;
      j += 1;
      continue;
    }
    if (p !== v) {
      return { matched: false, params: {}, score: 0, confidence: "prefix" };
    }
    score += 8;
    i += 1;
    j += 1;
  }

  if (i < patternParts.length) {
    if (patternParts[i] === "**" && i === patternParts.length - 1) {
      score += 1;
      confidence = "prefix";
      i += 1;
    } else {
      return { matched: false, params: {}, score: 0, confidence: "prefix" };
    }
  }

  if (j < pathParts.length) {
    return { matched: false, params: {}, score: 0, confidence: "prefix" };
  }

  score += Math.max(1, patternParts.length);
  return { matched: true, params, score, confidence };
}

const registeredAdapters: CavAiPageContextAdapter[] = [];
const adapterIds = new Set<string>();

function normalizedAdapter(adapter: CavAiPageContextAdapter): CavAiPageContextAdapter {
  return {
    ...adapter,
    id: s(adapter.id) || `adapter_${registeredAdapters.length + 1}`,
    routePatterns: (adapter.routePatterns || []).map((item) => normalizePattern(item)).filter(Boolean),
    tools: Array.from(new Set((adapter.tools || []).map((item) => s(item)).filter(Boolean))),
    memoryScopes: Array.from(new Set((adapter.memoryScopes || []).map((item) => s(item)).filter(Boolean))),
    recommendedActionClasses: Array.from(
      new Set((adapter.recommendedActionClasses || []).map((item) => s(item)).filter(Boolean))
    ),
    allowedActions: Array.from(new Set((adapter.allowedActions || []).map((item) => s(item)).filter(Boolean))),
    restrictedActions: Array.from(new Set((adapter.restrictedActions || []).map((item) => s(item)).filter(Boolean))),
    priority: Number.isFinite(Number(adapter.priority)) ? Math.trunc(Number(adapter.priority)) : 100,
  };
}

function sortAdapters() {
  registeredAdapters.sort((a, b) => {
    const byPriority = (b.priority || 0) - (a.priority || 0);
    if (byPriority !== 0) return byPriority;
    return a.id.localeCompare(b.id);
  });
}

export function registerCavAiPageContextAdapter(adapter: CavAiPageContextAdapter): CavAiPageContextAdapter {
  const next = normalizedAdapter(adapter);
  if (!next.routePatterns.length) {
    throw new Error(`CavAi page context adapter "${next.id}" requires at least one route pattern.`);
  }
  if (adapterIds.has(next.id)) {
    const index = registeredAdapters.findIndex((item) => item.id === next.id);
    if (index >= 0) registeredAdapters[index] = next;
  } else {
    adapterIds.add(next.id);
    registeredAdapters.push(next);
  }
  sortAdapters();
  return next;
}

export function registerCavAiPageContextAdapters(adapters: CavAiPageContextAdapter[]): CavAiPageContextAdapter[] {
  return adapters.map((adapter) => registerCavAiPageContextAdapter(adapter));
}

export function listCavAiPageContextAdapters(): CavAiPageContextAdapter[] {
  return registeredAdapters.map((item) => ({ ...item }));
}

const DEFAULT_ADAPTERS: CavAiPageContextAdapter[] = [
  {
    id: "home",
    routePatterns: ["/", "/command-center"],
    surface: "workspace",
    category: "home",
    contextLabel: "Workspace context",
    tools: ["dashboard_reader", "insights_reader", "settings_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 300,
  },
  {
    id: "cavai-center",
    routePatterns: ["/cavai", "/cavai/**"],
    surface: "general",
    category: "general",
    contextLabel: "General context",
    tools: ["research", "writing", "planning"],
    memoryScopes: ["thread", "working", "long_term"],
    recommendedActionClasses: ["light", "standard", "heavy"],
    priority: 320,
  },
  {
    id: "console",
    routePatterns: ["/console", "/console/**"],
    surface: "console",
    category: "diagnostics",
    contextLabel: "Console context",
    tools: ["diagnostics_reader", "insights_reader", "routing_error_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 310,
  },
  {
    id: "insights",
    routePatterns: ["/insights", "/insights/**"],
    surface: "console",
    category: "insights",
    contextLabel: "Insights context",
    tools: ["insights_reader", "analytics_reader"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 305,
  },
  {
    id: "errors",
    routePatterns: ["/errors", "/errors/**", "/404-control-room", "/404-control-room/**", "/status/incidents", "/status/incidents/**"],
    surface: "console",
    category: "errors",
    contextLabel: "Error context",
    tools: ["routing_error_reader", "diagnostics_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["heavy"],
    priority: 305,
  },
  {
    id: "routing",
    routePatterns: ["/routes", "/routes/**"],
    surface: "console",
    category: "routing",
    contextLabel: "Routing context",
    tools: ["routing_error_reader", "route_manifest_reader"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 305,
  },
  {
    id: "seo",
    routePatterns: ["/seo", "/seo/**"],
    surface: "workspace",
    category: "seo",
    contextLabel: "SEO context",
    tools: ["website_crawler", "seo_analyzer", "metadata_extractor"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 304,
  },
  {
    id: "a11y",
    routePatterns: ["/a11y", "/a11y/**"],
    surface: "workspace",
    category: "a11y",
    contextLabel: "Accessibility context",
    tools: ["accessibility_analyzer", "diagnostics_reader"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 304,
  },
  {
    id: "status",
    routePatterns: ["/status", "/status/**"],
    surface: "console",
    category: "status",
    contextLabel: "Status context",
    tools: ["status_reader", "diagnostics_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["standard"],
    priority: 304,
  },
  {
    id: "cavcloud",
    routePatterns: ["/cavcloud", "/cavcloud/**"],
    surface: "cavcloud",
    category: "storage",
    contextLabel: "CavCloud context",
    tools: ["file_inventory", "artifact_reader", "storage_organization"],
    memoryScopes: ["workspace", "project", "site", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 320,
  },
  {
    id: "cavsafe",
    routePatterns: ["/cavsafe", "/cavsafe/**"],
    surface: "cavsafe",
    category: "security",
    contextLabel: "CavSafe context",
    tools: ["policy_reader", "security_diagnostics", "access_audit"],
    memoryScopes: ["workspace", "project", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 320,
  },
  {
    id: "share",
    routePatterns: ["/share", "/share/**"],
    surface: "cavcloud",
    category: "share",
    contextLabel: "Share context",
    tools: ["share_reader", "artifact_reader", "storage_organization"],
    memoryScopes: ["workspace", "project", "site", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 318,
  },
  {
    id: "cavpad",
    routePatterns: ["/cavpad", "/cavpad/**", "/notes", "/notes/**", "/pad", "/pad/**"],
    surface: "cavpad",
    category: "notes",
    contextLabel: "CavPad context",
    tools: ["note_reader", "note_writer", "summary_tools"],
    memoryScopes: ["thread", "working", "workspace", "long_term"],
    recommendedActionClasses: ["light", "standard"],
    priority: 315,
  },
  {
    id: "cavcode",
    routePatterns: ["/cavcode", "/cavcode/**", "/cavcode-viewer", "/cavcode-viewer/**"],
    surface: "cavcode",
    category: "code",
    contextLabel: "CavCode context",
    tools: ["file_graph", "diagnostics_reader", "diff_proposal", "patch_application"],
    memoryScopes: ["workspace", "project", "product_interaction"],
    recommendedActionClasses: ["heavy", "premium_plus_heavy_coding"],
    priority: 325,
  },
  {
    id: "settings",
    routePatterns: ["/settings", "/settings/**"],
    surface: "workspace",
    category: "settings",
    contextLabel: "Settings context",
    tools: ["settings_reader", "plan_reader", "policy_reader"],
    memoryScopes: ["workspace", "long_term"],
    recommendedActionClasses: ["light", "standard"],
    priority: 290,
  },
  {
    id: "billing",
    routePatterns: ["/billing", "/billing/**", "/plan", "/plan/**"],
    surface: "workspace",
    category: "billing",
    contextLabel: "Billing context",
    tools: ["billing_reader", "plan_reader"],
    memoryScopes: ["workspace", "long_term"],
    recommendedActionClasses: ["light", "standard"],
    restrictedActions: ["destructive_change_without_confirmation"],
    priority: 290,
  },
  {
    id: "notifications",
    routePatterns: ["/notifications", "/notifications/**"],
    surface: "workspace",
    category: "notifications",
    contextLabel: "Notifications context",
    tools: ["notifications_reader", "workspace_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["light", "standard"],
    priority: 288,
  },
  {
    id: "geo",
    routePatterns: ["/geo", "/geo/**"],
    surface: "workspace",
    category: "geo",
    contextLabel: "Geo context",
    tools: ["analytics_reader", "workspace_reader"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["standard"],
    priority: 286,
  },
  {
    id: "cavtools",
    routePatterns: ["/cavtools", "/cavtools/**"],
    surface: "workspace",
    category: "tools",
    contextLabel: "Tools context",
    tools: ["tool_registry_reader", "workspace_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["standard", "heavy"],
    priority: 286,
  },
  {
    id: "integrations",
    routePatterns: ["/settings/integrations", "/settings/integrations/**", "/integrations", "/integrations/**"],
    surface: "workspace",
    category: "integrations",
    contextLabel: "Integrations context",
    tools: ["integrations_reader", "settings_reader"],
    memoryScopes: ["workspace", "long_term"],
    recommendedActionClasses: ["standard"],
    priority: 286,
  },
  {
    id: "arcade",
    routePatterns: ["/cavbot-arcade", "/cavbot-arcade/**"],
    surface: "workspace",
    category: "arcade",
    contextLabel: "Arcade context",
    tools: ["arcade_state_reader"],
    memoryScopes: ["workspace", "product_interaction"],
    recommendedActionClasses: ["light", "standard"],
    priority: 280,
  },
  {
    id: "auth-account",
    routePatterns: ["/auth", "/auth/**", "/users", "/users/**"],
    surface: "workspace",
    category: "auth",
    contextLabel: "Auth context",
    tools: ["account_reader", "security_reader"],
    memoryScopes: ["long_term"],
    recommendedActionClasses: ["light", "standard"],
    restrictedActions: ["privileged_operation_without_reauth"],
    priority: 280,
  },
  {
    id: "invites-access",
    routePatterns: ["/accept-invite", "/accept-invite/**", "/request-access", "/request-access/**"],
    surface: "workspace",
    category: "invite",
    contextLabel: "Invite context",
    tools: ["account_reader", "access_reader"],
    memoryScopes: ["workspace", "long_term"],
    recommendedActionClasses: ["light", "standard"],
    priority: 279,
  },
  {
    id: "public-profile",
    routePatterns: ["/u/[username]", "/u/[username]/**", "/p/[username]/artifact/[artifactId]", "/p/[username]/artifact/[artifactId]/**"],
    surface: "workspace",
    category: "public",
    contextLabel: "Public profile context",
    tools: ["public_profile_reader", "content_rewrite"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["light", "standard"],
    priority: 275,
  },
  {
    id: "user-profile",
    routePatterns: ["/u", "/u/**", "/p", "/p/**"],
    surface: "workspace",
    category: "profile",
    contextLabel: "Profile context",
    tools: ["public_profile_reader", "content_rewrite"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["light", "standard"],
    priority: 272,
  },
  {
    id: "cavbot-pages",
    routePatterns: ["/cavbot", "/cavbot/**", "/CAVBOT-2.0", "/CAVBOT-2.0/**"],
    surface: "workspace",
    category: "cavbot",
    contextLabel: "CavBot context",
    tools: ["product_docs_reader", "content_rewrite"],
    memoryScopes: ["workspace", "website_intelligence"],
    recommendedActionClasses: ["light", "standard"],
    priority: 271,
  },
];

for (const adapter of DEFAULT_ADAPTERS) {
  registerCavAiPageContextAdapter(adapter);
}

function fallbackFromFirstSegment(segment: string): {
  surface: CavAiCenterSurface;
  category: CavAiPageCategory;
  label: string;
  tools: string[];
} {
  const value = s(segment).toLowerCase();
  if (value === "cavcode") {
    return {
      surface: "cavcode",
      category: "code",
      label: "CavCode context",
      tools: ["file_graph", "diff_proposal"],
    };
  }
  if (value === "cavcloud" || value === "share") {
    return {
      surface: "cavcloud",
      category: value === "share" ? "share" : "storage",
      label: value === "share" ? "Share context" : "CavCloud context",
      tools: ["file_inventory", "artifact_reader"],
    };
  }
  if (value === "cavsafe") {
    return {
      surface: "cavsafe",
      category: "security",
      label: "CavSafe context",
      tools: ["policy_reader", "security_diagnostics"],
    };
  }
  if (value === "cavpad" || value === "notes" || value === "pad") {
    return {
      surface: "cavpad",
      category: "notes",
      label: "CavPad context",
      tools: ["note_reader", "note_writer"],
    };
  }
  if (value === "console" || value === "errors" || value === "status" || value === "routes" || value === "insights") {
    return {
      surface: "console",
      category: "diagnostics",
      label: "Console context",
      tools: ["diagnostics_reader", "insights_reader"],
    };
  }
  if (value === "notifications") {
    return {
      surface: "workspace",
      category: "notifications",
      label: "Notifications context",
      tools: ["notifications_reader", "workspace_reader"],
    };
  }
  if (value === "auth" || value === "users" || value === "accept-invite" || value === "request-access") {
    return {
      surface: "workspace",
      category: "auth",
      label: "Auth context",
      tools: ["account_reader", "security_reader"],
    };
  }
  if (value === "geo") {
    return {
      surface: "workspace",
      category: "geo",
      label: "Geo context",
      tools: ["analytics_reader", "workspace_reader"],
    };
  }
  if (value === "cavtools") {
    return {
      surface: "workspace",
      category: "tools",
      label: "Tools context",
      tools: ["tool_registry_reader", "workspace_reader"],
    };
  }
  if (value === "cavbot" || value === "cavbot-arcade") {
    return {
      surface: "workspace",
      category: value === "cavbot-arcade" ? "arcade" : "cavbot",
      label: value === "cavbot-arcade" ? "Arcade context" : "CavBot context",
      tools: ["product_docs_reader", "workspace_reader"],
    };
  }
  if (value === "cavai") {
    return {
      surface: "general",
      category: "general",
      label: "General context",
      tools: ["research", "writing", "planning"],
    };
  }
  return {
    surface: "workspace",
    category: "workspace",
    label: "Workspace context",
    tools: ["dashboard_reader", "settings_reader"],
  };
}

function parseSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function mergeRouteParams(
  input: CavAiRouteAwarenessInput,
  matchParams: Record<string, string>,
  searchParams: URLSearchParams
): {
  routeParams: Record<string, string>;
  workspaceId: string | null;
  projectId: number | null;
  siteId: string | null;
} {
  const inputParams = input.routeParams && typeof input.routeParams === "object" && !Array.isArray(input.routeParams)
    ? input.routeParams
    : {};

  const routeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputParams)) {
    const text = s(value);
    if (!text) continue;
    routeParams[s(key)] = text;
  }
  for (const [key, value] of Object.entries(matchParams)) {
    if (!s(key) || !s(value)) continue;
    routeParams[s(key)] = s(value);
  }

  const workspaceId = s(input.workspaceId) || s(searchParams.get("workspaceId")) || s(searchParams.get("workspace")) || null;
  const projectId = toProjectId(input.projectId) || toProjectId(searchParams.get("projectId")) || toProjectId(searchParams.get("project"));
  const siteId = s(input.siteId) || s(searchParams.get("siteId")) || s(searchParams.get("site")) || null;

  if (workspaceId) routeParams.workspaceId = workspaceId;
  if (projectId) routeParams.projectId = String(projectId);
  if (siteId) routeParams.siteId = siteId;

  return {
    routeParams,
    workspaceId,
    projectId,
    siteId,
  };
}

function toRouteSegment(pathname: string): string {
  const first = splitPath(pathname)[0];
  return first || "root";
}

function routeInputFromOrigin(input: CavAiRouteAwarenessInput): { pathname: string; search: string } {
  const givenPath = s(input.pathname);
  const givenSearch = s(input.search);
  if (givenPath) {
    return {
      pathname: toPathname(givenPath),
      search: toSearch(givenSearch),
    };
  }

  const origin = s(input.origin);
  if (!origin) return { pathname: "/", search: "" };
  try {
    const parsed = new URL(origin);
    return {
      pathname: toPathname(parsed.pathname),
      search: toSearch(givenSearch || parsed.search),
    };
  } catch {
    const [pathOnly, queryOnly] = origin.split("?");
    return {
      pathname: toPathname(pathOnly || "/"),
      search: toSearch(givenSearch || queryOnly || ""),
    };
  }
}

export function resolveCavAiRouteAwareness(input: CavAiRouteAwarenessInput): CavAiRouteAwareness {
  const normalized = routeInputFromOrigin(input);
  const pathname = normalized.pathname;
  const search = normalized.search;
  const searchParams = parseSearchParams(search);
  const routeSegment = toRouteSegment(pathname);

  let bestAdapter: CavAiPageContextAdapter | null = null;
  let bestPattern = "";
  let bestMatch: RouteMatch | null = null;
  let bestScore = -1;

  for (const adapter of registeredAdapters) {
    for (const pattern of adapter.routePatterns) {
      const match = matchRoutePattern(pathname, pattern);
      if (!match.matched) continue;
      const score = match.score + Math.max(0, adapter.priority || 0);
      if (score <= bestScore) continue;
      bestScore = score;
      bestAdapter = adapter;
      bestPattern = pattern;
      bestMatch = match;
    }
  }

  if (!bestAdapter || !bestMatch) {
    const fallback = fallbackFromFirstSegment(routeSegment);
    const merged = mergeRouteParams(input, {}, searchParams);
    return {
      surface: fallback.surface,
      contextLabel: s(input.contextLabel) || fallback.label,
      routePathname: pathname,
      routeSearch: search,
      routePattern: "/**",
      routeSegment,
      routeCategory: fallback.category,
      routeParams: merged.routeParams,
      workspaceId: merged.workspaceId,
      projectId: merged.projectId,
      siteId: merged.siteId,
      tools: fallback.tools,
      memoryScopes: ["workspace", "product_interaction"],
      recommendedActionClasses: ["light", "standard"],
      allowedActions: [],
      restrictedActions: [],
      adapterId: "fallback",
      confidence: "heuristic",
    };
  }

  const merged = mergeRouteParams(input, bestMatch.params, searchParams);
  return {
    surface: bestAdapter.surface,
    contextLabel: s(input.contextLabel) || bestAdapter.contextLabel,
    routePathname: pathname,
    routeSearch: search,
    routePattern: bestPattern,
    routeSegment,
    routeCategory: bestAdapter.category,
    routeParams: merged.routeParams,
    workspaceId: merged.workspaceId,
    projectId: merged.projectId,
    siteId: merged.siteId,
    tools: bestAdapter.tools || [],
    memoryScopes: bestAdapter.memoryScopes || [],
    recommendedActionClasses: bestAdapter.recommendedActionClasses || [],
    allowedActions: bestAdapter.allowedActions || [],
    restrictedActions: bestAdapter.restrictedActions || [],
    adapterId: bestAdapter.id,
    confidence: bestMatch.confidence,
  };
}

export function buildCavAiRouteContextPayload(awareness: CavAiRouteAwareness): Record<string, unknown> {
  return {
    routePathname: awareness.routePathname,
    routeSearch: awareness.routeSearch,
    routePattern: awareness.routePattern,
    routeCategory: awareness.routeCategory,
    routeSegment: awareness.routeSegment,
    routeParams: awareness.routeParams,
    adapterId: awareness.adapterId,
    surface: awareness.surface,
    contextLabel: awareness.contextLabel,
    workspaceId: awareness.workspaceId,
    projectId: awareness.projectId,
    siteId: awareness.siteId,
    tools: awareness.tools,
    memoryScopes: awareness.memoryScopes,
    recommendedActionClasses: awareness.recommendedActionClasses,
    allowedActions: awareness.allowedActions,
    restrictedActions: awareness.restrictedActions,
    confidence: awareness.confidence,
    pageAwareness: {
      surface: awareness.surface,
      contextLabel: awareness.contextLabel,
      category: awareness.routeCategory,
      routePattern: awareness.routePattern,
      routePathname: awareness.routePathname,
      routeSearch: awareness.routeSearch,
      routeParams: awareness.routeParams,
      adapterId: awareness.adapterId,
      tools: awareness.tools,
      memoryScopes: awareness.memoryScopes,
      recommendedActionClasses: awareness.recommendedActionClasses,
      allowedActions: awareness.allowedActions,
      restrictedActions: awareness.restrictedActions,
      confidence: awareness.confidence,
    },
  };
}

export function resolveCavAiSurfaceForPathname(pathname: string): CavAiCenterSurface {
  return resolveCavAiRouteAwareness({ pathname }).surface;
}

export function resolveCavAiContextLabelForPathname(pathname: string): string {
  return resolveCavAiRouteAwareness({ pathname }).contextLabel;
}
