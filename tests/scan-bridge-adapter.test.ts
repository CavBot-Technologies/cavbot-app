import assert from "node:assert/strict";
import test from "node:test";

import { createNormalizedScanInputFromScanArtifacts } from "../lib/cavai/scanBridge.server";

test("scan bridge maps deterministic scan artifacts into CavAi-ready findings and keeps page selection real", () => {
  const input = createNormalizedScanInputFromScanArtifacts({
    origin: "https://example.com",
    pageLimit: 5,
    pagesSelected: [
      "https://example.com/",
      "https://example.com/pricing?ref=nav",
      "https://example.com/api/health",
    ],
    jobId: "job_123",
    projectId: 42,
    siteId: "site_123",
    findings: [
      {
        pillar: "seo",
        severity: "HIGH",
        message: "Title tag is missing on https://example.com/. This hurts SEO and sharing metadata.",
        evidence: { pageUrl: "https://example.com/" },
      },
      {
        pillar: "seo",
        severity: "MEDIUM",
        message: "Meta description not found on https://example.com/pricing. Search previews may be unclear.",
        evidence: { pageUrl: "https://example.com/pricing?ref=nav" },
      },
      {
        pillar: "a11y",
        severity: "MEDIUM",
        message: "3 image(s) missing alt on https://example.com/pricing. Screen readers need alt text.",
        evidence: { pageUrl: "https://example.com/pricing?ref=nav", count: 3 },
      },
      {
        pillar: "routes",
        severity: "CRITICAL",
        message: "Route returned HTTP 404 (Homepage).",
        evidence: { pageUrl: "https://example.com/missing", status: 404, reason: "Homepage" },
      },
      {
        pillar: "errors",
        severity: "HIGH",
        message: "We detected a fetch failure on https://example.com/api/health: ECONNRESET",
        evidence: { pageUrl: "https://example.com/api/health" },
      },
      {
        pillar: "ux",
        severity: "MEDIUM",
        message: "Page load took 3190 ms on https://example.com/pricing.",
        evidence: { pageUrl: "https://example.com/pricing?ref=nav", responseTimeMs: 3190 },
      },
    ],
    snapshots: [
      {
        pageUrl: "https://example.com/",
        title: null,
        status: 200,
        responseTimeMs: 410,
        payloadBytes: 1000,
      },
      {
        pageUrl: "https://example.com/pricing?ref=nav",
        title: "Pricing",
        status: 200,
        responseTimeMs: 3190,
        payloadBytes: 2200,
      },
      {
        pageUrl: "https://example.com/api/health",
        title: null,
        status: 503,
        responseTimeMs: 120,
        payloadBytes: 120,
      },
    ],
  });

  assert.equal(input.origin, "https://example.com");
  assert.deepEqual(input.pagesSelected, ["/", "/pricing?ref=nav", "/api/health"]);
  assert.equal(input.context?.traits?.source, "cavscan");
  assert.equal(input.context?.traits?.scanJobId, "job_123");
  assert.equal(input.findings.length, 6);
  assert.deepEqual(
    input.findings.map((finding) => finding.code),
    [
      "missing_title",
      "missing_meta_description",
      "image_missing_alt",
      "route_http_404",
      "api_error_cluster",
      "slow_response",
    ],
  );
  assert.deepEqual(
    input.findings.map((finding) => finding.pillar),
    [
      "seo",
      "seo",
      "accessibility",
      "reliability",
      "reliability",
      "performance",
    ],
  );
  assert.equal(input.findings[2].pagePath, "/pricing?ref=nav");
  assert.equal(input.findings[2].evidence.some((row) => row.type === "metric"), true);
  assert.equal(input.findings[3].evidence.some((row) => row.type === "http"), true);
  assert.equal(input.findings[4].evidence.some((row) => row.type === "log"), true);
});

test("scan bridge preserves warming-state input even when a scan reports zero findings", () => {
  const input = createNormalizedScanInputFromScanArtifacts({
    origin: "https://clean.example.com",
    pageLimit: 3,
    pagesSelected: ["https://clean.example.com/"],
    findings: [],
    snapshots: [
      {
        pageUrl: "https://clean.example.com/",
        title: "Clean Example",
        status: 200,
        responseTimeMs: 180,
        payloadBytes: 950,
      },
    ],
  });

  assert.equal(input.origin, "https://clean.example.com");
  assert.deepEqual(input.pagesSelected, ["/"]);
  assert.equal(Array.isArray(input.findings), true);
  assert.equal(input.findings.length, 0);
});

test("initial scan failure classification stays honest for queueing soft-fail states", async () => {
  const { ScanRequestError, classifyInitialSiteScanFailure } = await import("../lib/scanner");

  assert.equal(
    classifyInitialSiteScanFailure(new ScanRequestError("SCAN_IN_PROGRESS", 409, "busy")),
    "already_running",
  );
  assert.equal(
    classifyInitialSiteScanFailure(new ScanRequestError("SCAN_RECENT", 429, "cooldown")),
    "rate_limited",
  );
  assert.equal(
    classifyInitialSiteScanFailure(new ScanRequestError("SCAN_LIMIT", 429, "quota")),
    "quota_exhausted",
  );
  assert.equal(
    classifyInitialSiteScanFailure(new ScanRequestError("ORIGIN_NOT_ALLOWLISTED", 400, "allowlist")),
    "site_not_ready",
  );
  assert.equal(classifyInitialSiteScanFailure(new Error("boom")), "queue_failed");
});

test("analytics surfaces switched hero empty states away from dash placeholders", async () => {
  const fs = await import("node:fs");
  const insights = fs.readFileSync(new URL("../app/insights/page.tsx", import.meta.url), "utf8");
  const controlRoom = fs.readFileSync(new URL("../app/404-control-room/page.tsx", import.meta.url), "utf8");
  const publicProfile = fs.readFileSync(new URL("../app/u/[username]/page.tsx", import.meta.url), "utf8");

  assert.equal(insights.includes("Awaiting first scan"), true);
  assert.equal(insights.includes("Not recorded yet"), true);
  assert.equal(controlRoom.includes('"Warming"'), true);
  assert.equal(publicProfile.includes('guardianScore == null ? "Warming" : guardianScore'), true);
});
