import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  augmentReliability404Findings,
  deterministic404GameRecommendation,
} from "@/lib/cavai/reliability-404.server";

const DETECTED_AT = "2026-02-18T00:00:00.000Z";

function inputFixture(): NormalizedScanInputV1 {
  return {
    origin: "https://reliability.example",
    pagesSelected: ["/"],
    pageLimit: 12,
    findings: [
      {
        id: "base_1",
        code: "missing_title",
        pillar: "seo",
        severity: "high",
        evidence: [{ type: "dom", selector: "title" }],
        origin: "https://reliability.example",
        pagePath: "/",
        templateHint: "home",
        detectedAt: DETECTED_AT,
      },
    ],
    context: {
      routeMetadata: {
        reliability404: {
          internalLinks: ["/ok", "/broken"],
          hasCustom404Page: false,
        },
        navigation: {
          hasHomeLink: false,
          hasNavLandmark: false,
          backToTopBroken: true,
        },
      },
    },
  };
}

test("reliability 404 augmenter detects status misconfiguration, broken links, and deterministic game", async () => {
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = String(init?.method || "GET").toUpperCase();

    if (url.includes("__cavai_not_found_probe_")) {
      return new Response("", { status: 200 });
    }
    if (url.endsWith("/broken")) {
      return new Response("", { status: 404 });
    }
    if (url.endsWith("/ok")) {
      return new Response("", { status: 200 });
    }

    if (method === "HEAD") {
      return new Response("", { status: 200 });
    }
    return new Response("<html><body>ok</body></html>", { status: 200 });
  };

  const findings = await augmentReliability404Findings({
    input: inputFixture(),
    fetchImpl,
  });

  assert.equal(findings.some((row) => row.code === "status_404_misconfigured"), true);
  assert.equal(findings.some((row) => row.code === "internal_links_to_404"), true);
  assert.equal(findings.some((row) => row.code === "missing_home_link"), true);
  assert.equal(findings.some((row) => row.code === "recommend_404_arcade_game"), true);

  const gameA = deterministic404GameRecommendation({
    origin: "https://reliability.example",
    seed: "run_seed",
  });
  const gameB = deterministic404GameRecommendation({
    origin: "https://reliability.example",
    seed: "run_seed",
  });
  assert.deepEqual(gameA, gameB);
});
