import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("embed analytics route exposes a real OPTIONS handler with request-header-aware CORS", () => {
  const source = read("app/api/embed/analytics/route.ts");

  assert.equal(source.includes("export async function OPTIONS"), true);
  assert.equal(source.includes("access-control-request-headers"), true);
  assert.equal(source.includes("Access-Control-Allow-Headers"), true);
  assert.equal(source.includes("Access-Control-Max-Age"), true);
  assert.equal(source.includes('if (req.method === "OPTIONS")'), false);
});

test("embed verification paths avoid Prisma runtime imports", () => {
  const verifierSource = read("lib/security/embedVerifier.ts");
  const tokenSource = read("lib/security/embedToken.ts");
  const runtimeSource = read("lib/security/embedKeyRuntime.server.ts");
  const analyticsRouteSource = read("app/api/embed/analytics/route.ts");
  const apiKeyVerifierSource = read("lib/apiKeyVerifier.server.ts");
  const rateLimitSource = read("lib/security/embedRateLimit.ts");
  const metricsSource = read("lib/security/embedMetrics.server.ts");

  assert.equal(verifierSource.includes('from "@/lib/prisma"'), false);
  assert.equal(tokenSource.includes('from "@/lib/prisma"'), false);
  assert.equal(runtimeSource.includes('from "@/lib/prisma"'), false);
  assert.equal(verifierSource.includes("EMBED_RATE_LIMIT_SPEC"), true);
  assert.equal(verifierSource.includes("extractEmbedRateLimitActor"), true);
  assert.equal(verifierSource.includes("visitor_id"), true);
  assert.equal(verifierSource.includes("visitorId"), true);
  assert.equal(verifierSource.includes("anonymous_id"), true);
  assert.equal(verifierSource.includes("anonymousId"), true);
  assert.equal(verifierSource.includes("session_key"), true);
  assert.equal(verifierSource.includes("sessionKey"), true);
  assert.equal(verifierSource.includes("session_id"), true);
  assert.equal(verifierSource.includes("sessionId"), true);
  assert.equal(verifierSource.includes("unknown-route"), true);
  assert.equal(verifierSource.includes("actor:"), true);
  assert.equal(apiKeyVerifierSource.includes("EMBED_RATE_LIMIT_SPEC"), true);
  assert.equal(rateLimitSource.includes("capacity: 1200"), true);
  assert.equal(rateLimitSource.includes("refillPerSec: 20"), true);
  assert.equal(metricsSource.includes("EMBED_RATE_LIMIT_LABEL"), true);

  assert.equal(verifierSource.includes("findEmbedKeyByHash"), true);
  assert.equal(verifierSource.includes("findActiveEmbedSite"), true);
  assert.equal(verifierSource.includes("listEmbedAllowedOrigins"), true);

  assert.equal(tokenSource.includes("findEmbedKeyById"), true);
  assert.equal(tokenSource.includes("findActiveEmbedSite"), true);
  assert.equal(tokenSource.includes("originsShareWebsiteContext"), true);
  assert.equal(analyticsRouteSource.includes("verification.siteOrigin"), true);
  assert.equal(analyticsRouteSource.includes("rewriteCanonicalSiteContext"), true);
  assert.equal(analyticsRouteSource.includes("canonicalizeWebsiteContextUrl"), true);
  assert.equal(analyticsRouteSource.includes("canonicalizeWebsiteContextHost"), true);
  assert.equal(analyticsRouteSource.includes('key === "site_host"'), true);
  assert.equal(analyticsRouteSource.includes('key === "base_url"'), true);
});

test("workspace bootstrap routes use the resilient session helper", () => {
  const helperSource = read("lib/workspaceAuth.server.ts");
  const workspacesSource = read("app/api/workspaces/route.ts");
  const workspaceSource = read("app/api/workspace/route.ts");

  assert.equal(helperSource.includes("requireLowRiskWriteSession"), true);
  assert.equal(helperSource.includes("AUTH_BACKEND_UNAVAILABLE"), true);

  assert.equal(workspacesSource.includes("requireWorkspaceResilientSession"), true);
  assert.equal(workspaceSource.includes("requireWorkspaceResilientSession"), true);
});
