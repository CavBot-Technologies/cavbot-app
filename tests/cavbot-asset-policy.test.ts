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

test("customer snippet policy uses the app-hosted analytics asset and keeps the rest on absolute URLs", () => {
  const customer = resolveCavbotAssetPolicy("customer_snippet");
  assert.equal(
    customer.scripts.analytics.includes("/cavai/cavai-analytics-v5.js"),
    true,
    `Customer analytics script should come from the app-hosted collector: ${customer.scripts.analytics}`
  );
  assert.equal(
    customer.scripts.analytics.startsWith("https://app.cavbot.io") || customer.scripts.analytics.startsWith("http://localhost:3000"),
    true,
    `Customer analytics script must use the app origin: ${customer.scripts.analytics}`
  );

  const snippetScripts = [customer.scripts.brain, customer.scripts.widget, customer.scripts.arcadeLoader];

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

test("next config serves the analytics asset locally instead of rewriting it to the CDN", () => {
  const nextConfigSource = fs.readFileSync(path.join(ROOT, "next.config.mjs"), "utf8");
  assert.equal(nextConfigSource.includes('source: "/cavai/cavai-analytics-v5.js"'), false);
  assert.equal(nextConfigSource.includes("sdk/v5/cavai-analytics-v5.min.js"), false);
});

test("app shell runtime stays off hardcoded CDN analytics fallbacks", () => {
  const layoutSource = fs.readFileSync(path.join(ROOT, "app", "layout.tsx"), "utf8");
  const appHostSource = fs.readFileSync(path.join(ROOT, "app", "_components", "AppHostRuntimeMounts.tsx"), "utf8");

  assert.equal(
    /cdn\.cavbot\.io/i.test(layoutSource),
    false,
    "Layout must not hardcode CDN runtime assets"
  );
  assert.equal(
    /CAVBOT_CDN_BASE_URL/.test(layoutSource),
      false,
      "Layout must not use CDN env fallbacks for internal runtime assets"
  );
  assert.equal(appHostSource.includes("resolveCavbotAssetPolicy"), true);
  assert.equal(appHostSource.includes("OFFICIAL_CDN_ASSETS.scripts.brain"), true);
  assert.equal(appHostSource.includes("sdk/v5/cavai-analytics-v5.min.js"), false);
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
