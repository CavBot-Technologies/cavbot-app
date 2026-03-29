import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import { augmentFaviconFindings } from "@/lib/cavai/favicon.server";

const BASE_DETECTED_AT = "2026-02-18T00:00:00.000Z";

function buildBaseInput(): NormalizedScanInputV1 {
  return {
    origin: "https://acme.example",
    pagesSelected: ["/"],
    pageLimit: 5,
    findings: [
      {
        id: "finding_base_route",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://acme.example",
        pagePath: "/",
        templateHint: "marketing_home",
        detectedAt: BASE_DETECTED_AT,
      },
    ],
    context: {
      routeMetadata: {
        favicon: {
          hasFavicon: false,
          iconHref: null,
          appleTouchHref: null,
          manifestHref: null,
          maskIconHref: null,
        },
      },
    },
  };
}

test("adds missing_favicon only when DOM lacks icon and /favicon.ico returns 404/410", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method || "GET") });
    return new Response(null, { status: 404 });
  };

  const findings = await augmentFaviconFindings({
    input: buildBaseInput(),
    fetchImpl,
  });

  const faviconFinding = findings.find((item) => item.code === "missing_favicon");
  assert.ok(faviconFinding);
  assert.equal(faviconFinding?.severity, "medium");
  assert.equal(
    faviconFinding?.evidence.some((e) => e.type === "http" && e.status === 404),
    true
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://acme.example/favicon.ico");
});

test("suppresses missing_favicon when default /favicon.ico exists", async () => {
  const fetchImpl = async () => new Response(null, { status: 200 });
  const findings = await augmentFaviconFindings({
    input: buildBaseInput(),
    fetchImpl,
  });
  assert.equal(findings.some((item) => item.code === "missing_favicon"), false);
});

test("adds apple-touch + manifest findings when favicon exists but supporting links are missing", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method || "GET") });
    return new Response(null, { status: 200 });
  };

  const input = buildBaseInput();
  input.context = {
    routeMetadata: {
      favicon: {
        hasFavicon: true,
        iconHref: "https://acme.example/favicon-32x32.png",
        appleTouchHref: null,
        manifestHref: null,
      },
    },
  };

  const findings = await augmentFaviconFindings({
    input,
    fetchImpl,
  });

  assert.equal(findings.some((item) => item.code === "missing_apple_touch_icon"), true);
  assert.equal(findings.some((item) => item.code === "missing_web_manifest_icon_set"), true);
  assert.equal(findings.some((item) => item.code === "theme_color_needs_branding"), true);
  assert.equal(calls.length, 0);
});

test("does not emit theme_color_needs_branding when theme-color is set to a non-white brand color", async () => {
  const input = buildBaseInput();
  input.context = {
    routeMetadata: {
      favicon: {
        hasFavicon: true,
        iconHref: "https://acme.example/favicon-32x32.png",
        appleTouchHref: "https://acme.example/apple-touch-icon.png",
        manifestHref: "https://acme.example/site.webmanifest",
        themeColor: "#202124",
        msTileColor: "#202124",
      },
    },
  };

  const findings = await augmentFaviconFindings({
    input,
    fetchImpl: async () => new Response(null, { status: 200 }),
  });
  assert.equal(findings.some((item) => item.code === "theme_color_needs_branding"), false);
});

test("reuses per-run probe cache so repeated origin checks do not refetch", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string | URL) => {
    calls.push(String(url));
    return new Response(null, { status: 404 });
  };
  const probeCache = new Map<string, { url: string; method: "HEAD" | "GET"; status: number }>();

  await augmentFaviconFindings({
    input: buildBaseInput(),
    fetchImpl,
    probeCache,
  });
  await augmentFaviconFindings({
    input: buildBaseInput(),
    fetchImpl,
    probeCache,
  });

  assert.equal(calls.length, 1);
});
