import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCavAiRouteContextPayload,
  registerCavAiPageContextAdapter,
  resolveCavAiRouteAwareness,
} from "@/lib/cavai/pageAwareness";

test("route awareness resolves CavSafe and keeps surface-specific context", () => {
  const awareness = resolveCavAiRouteAwareness({
    pathname: "/cavsafe/settings",
    search: "?workspaceId=ws_1&project=42",
  });
  assert.equal(awareness.surface, "cavsafe");
  assert.equal(awareness.routeCategory, "security");
  assert.equal(awareness.workspaceId, "ws_1");
  assert.equal(awareness.projectId, 42);
  assert.equal(awareness.contextLabel, "CavSafe context");
});

test("route awareness falls back heuristically for unknown future routes", () => {
  const awareness = resolveCavAiRouteAwareness({
    pathname: "/future/feature-x",
  });
  assert.equal(awareness.surface, "workspace");
  assert.equal(awareness.routeCategory, "workspace");
  assert.equal(awareness.confidence, "heuristic");
});

test("route awareness captures dynamic params and query entity scopes", () => {
  const awareness = resolveCavAiRouteAwareness({
    pathname: "/u/cavbot",
    search: "?workspace=ws_public&projectId=7&site=site_main",
  });
  assert.equal(awareness.routeCategory, "public");
  assert.equal(awareness.routeParams.username, "cavbot");
  assert.equal(awareness.routeParams.workspaceId, "ws_public");
  assert.equal(awareness.routeParams.projectId, "7");
  assert.equal(awareness.routeParams.siteId, "site_main");
});

test("custom adapter registration supports future route classes without hardcoding", () => {
  registerCavAiPageContextAdapter({
    id: "unit_custom_route_adapter",
    routePatterns: ["/__unit__/research/**"],
    surface: "general",
    category: "analytics",
    contextLabel: "Unit test research context",
    tools: ["web_research"],
    memoryScopes: ["working"],
    recommendedActionClasses: ["heavy"],
    priority: 9_999,
  });

  const awareness = resolveCavAiRouteAwareness({
    pathname: "/__unit__/research/deep-dive",
    search: "?project=9",
  });
  assert.equal(awareness.adapterId, "unit_custom_route_adapter");
  assert.equal(awareness.surface, "general");
  assert.equal(awareness.routeCategory, "analytics");
  assert.equal(awareness.projectId, 9);
});

test("route awareness payload contains stable pageAwareness envelope", () => {
  const awareness = resolveCavAiRouteAwareness({
    pathname: "/seo",
  });
  const payload = buildCavAiRouteContextPayload(awareness);
  assert.equal(typeof payload.pageAwareness, "object");
  assert.equal((payload.pageAwareness as { category?: string }).category, "seo");
  assert.equal((payload.pageAwareness as { routePathname?: string }).routePathname, "/seo");
});
