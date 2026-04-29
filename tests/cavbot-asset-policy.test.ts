import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isInternalRuntimeAssetUrl,
  resolveCavbotAssetPolicy,
} from "../lib/cavbotAssetPolicy";

const ROOT = path.resolve(".");
const PUBLIC_ARCADE_ROOT = path.join(ROOT, "public", "cavbot-arcade");

function collectFiles(dir: string, out: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

function extractAttributeValues(html: string, tag: string, attr: string): string[] {
  const pattern = new RegExp(
    `<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`,
    "gi"
  );
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    out.push(String(match[1] || "").trim());
  }
  return out;
}

test("internal runtime policy renders only same-origin CavBot script src values", () => {
  const internal = resolveCavbotAssetPolicy("internal_runtime");
  const html = [
    `<script src="${internal.scripts.analytics}"></script>`,
    `<script src="${internal.scripts.brain}"></script>`,
    `<script src="${internal.scripts.widget}"></script>`,
  ].join("");

  const scriptSrcs = extractAttributeValues(html, "script", "src");
  assert.equal(scriptSrcs.length, 3);

  for (const src of scriptSrcs) {
    assert.equal(
      isInternalRuntimeAssetUrl(src),
      true,
      `Internal runtime script must start with /cavai/ or /cavbot/: ${src}`
    );
    assert.equal(
      /^https?:\/\//i.test(src),
      false,
      `Internal runtime script must not use absolute http(s): ${src}`
    );
  }
});

test("customer snippet policy remains CDN-based", () => {
  const customer = resolveCavbotAssetPolicy("customer_snippet");
  const snippetScripts = [
    customer.scripts.analytics,
    customer.scripts.brain,
    customer.scripts.widget,
    customer.scripts.arcadeLoader,
  ];

  for (const src of snippetScripts) {
    assert.equal(
      src.startsWith("/"),
      false,
      `Customer snippet script must not be same-origin local path: ${src}`
    );
    assert.equal(
      /^https?:\/\//i.test(src),
      true,
      `Customer snippet script must be absolute CDN url: ${src}`
    );
  }
});

test("embed ingestion accepts existing publishable analytics scopes", () => {
  const verifierSource = fs.readFileSync(path.join(ROOT, "lib", "security", "embedVerifier.ts"), "utf8");
  const apiKeySource = fs.readFileSync(path.join(ROOT, "lib", "apiKeys.server.ts"), "utf8");

  assert.equal(apiKeySource.includes('"analytics:events"'), true);
  assert.equal(verifierSource.includes('requiredScope === "analytics:events"'), true);
  assert.equal(verifierSource.includes('allowedScopes.includes("events:write")'), true);
  assert.equal(verifierSource.includes('allowedScopes.includes("analytics:write")'), true);
});

test("embed ingestion proxy preserves client IP for worker rate buckets", () => {
  const routeSource = fs.readFileSync(path.join(ROOT, "app", "api", "embed", "analytics", "route.ts"), "utf8");

  assert.equal(routeSource.includes("function forwardedClientIp"), true);
  assert.equal(routeSource.includes("rateLimit: false"), true);
  assert.equal(routeSource.includes('req.headers.get("cf-connecting-ip")'), true);
  assert.equal(routeSource.includes('req.headers.get("x-forwarded-for")'), true);
  assert.equal(routeSource.includes("Origin: verification.origin"), true);
  assert.equal(routeSource.includes('"X-Cavbot-Project-Id": String(verification.projectId)'), true);
  assert.equal(routeSource.includes('"X-Cavbot-Verified-Site-Id": verification.siteId'), true);
  assert.equal(routeSource.includes('headers["X-Forwarded-For"] = clientIp'), true);
  assert.equal(routeSource.includes('headers["X-Cavbot-Forwarded-Client-IP"] = clientIp'), true);
  assert.equal(routeSource.includes('headers["X-Admin-Token"] = adminToken'), true);
});

test("app runtime keeps deterministic analytics-before-brain order and no CDN fallback", () => {
  const layoutSource = fs.readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8");
  const runtimeSource = fs.readFileSync(
    path.join(ROOT, "app", "_components", "AppHostRuntimeMounts.tsx"),
    "utf8"
  );
  const analyticsId = "cb-runtime-analytics-script";
  const brainId = "cb-runtime-brain-script";
  const analyticsIdx = runtimeSource.indexOf(analyticsId);
  const brainIdx = runtimeSource.indexOf(brainId);

  assert.equal(analyticsIdx >= 0, true, "Analytics runtime script tag id not found");
  assert.equal(brainIdx >= 0, true, "Brain runtime script tag id not found");
  assert.equal(
    analyticsIdx < brainIdx,
    true,
    "App runtime must load analytics script before brain script"
  );
  assert.equal(
    runtimeSource.includes('resolveCavbotAssetPolicy("internal_runtime")'),
    true,
    "App runtime must load same-origin internal runtime assets"
  );
  assert.equal(
    /cdn\.cavbot\.io/i.test(layoutSource + runtimeSource),
    false,
    "App runtime must not hardcode CDN runtime assets"
  );
  assert.equal(
    /CAVBOT_CDN_BASE_URL/.test(layoutSource + runtimeSource),
    false,
    "App runtime must not use CDN env fallbacks for internal runtime assets"
  );
});

test("public arcade tree does not ship local game code bundles", () => {
  if (!fs.existsSync(PUBLIC_ARCADE_ROOT)) {
    assert.ok(true, "public/cavbot-arcade is absent");
    return;
  }

  const blocked = collectFiles(PUBLIC_ARCADE_ROOT).filter((file) => {
    const lower = file.toLowerCase();
    const base = path.basename(lower);
    return (
      lower.endsWith(".html") ||
      lower.endsWith(".js") ||
      lower.endsWith(".css") ||
      base === "manifest.json"
    );
  });

  assert.equal(
    blocked.length,
    0,
    `Public arcade tree must not ship local game code files:\n${blocked.join("\n")}`
  );
});
