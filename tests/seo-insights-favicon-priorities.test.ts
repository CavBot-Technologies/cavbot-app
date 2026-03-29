import assert from "node:assert/strict";
import test from "node:test";
import { generateSeoActions } from "@/lib/seo/seoInsights";
import type { FaviconIntelligenceResult } from "@/lib/seo/faviconIntelligence";

const faviconFixture: FaviconIntelligenceResult = {
  origin: "https://brand.example",
  hasAnyFavicon: false,
  hasAppleTouchIcon: false,
  hasManifestIcon: false,
  primary: {
    tabIconUrl: null,
    appleTouchUrl: null,
    manifestIconUrl: null,
  },
  icons: [],
  issues: [
    {
      code: "missing_favicon",
      priority: "P0",
      title: "Missing favicon",
      detail: "No favicon found.",
      affectedCount: 1,
      urls: ["https://brand.example/favicon.ico"],
    },
    {
      code: "missing_apple_touch_icon",
      priority: "P1",
      title: "Missing Apple touch icon",
      detail: "No apple touch icon found.",
      affectedCount: 1,
      urls: [],
    },
  ],
  priorities: {
    p0: 1,
    p1: 1,
    p2: 0,
    topIssues: [],
  },
  recommendedSet: [
    "/favicon.ico (contains 16x16 + 32x32)",
    "/apple-touch-icon.png (180x180)",
  ],
  thresholds: {
    maxIconBytes: 204800,
  },
};

test("generateSeoActions includes favicon priorities even without page snapshots", () => {
  const actions = generateSeoActions({
    seo: {},
    pages: [],
    scoredPages: [],
    siteOrigin: "https://brand.example",
    favicon: faviconFixture,
  });

  assert.equal(actions.some((action) => action.id === "favicon_missing_favicon"), true);
  assert.equal(actions.some((action) => action.id === "favicon_missing_apple_touch_icon"), true);

  const p0 = actions.find((action) => action.id === "favicon_missing_favicon");
  assert.equal(p0?.severity, "critical");
});
