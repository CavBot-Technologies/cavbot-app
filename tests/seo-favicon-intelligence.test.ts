import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildFaviconIntelligence,
  extractHtmlFaviconCandidates,
  extractManifestFaviconCandidates,
} from "@/lib/seo/faviconIntelligence";

const FIXTURE_DIR = path.resolve("tests/fixtures/favicon");
const PNG_16 = fs.readFileSync(path.join(FIXTURE_DIR, "icon-16x16.png"));
const ICO_32 = fs.readFileSync(path.join(FIXTURE_DIR, "icon-32x32.ico"));

function contentHeaders(contentType: string, body: Uint8Array | Buffer) {
  return {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "cache-control": "public,max-age=86400",
    etag: "\"fixture\"",
  };
}

test("extractHtmlFaviconCandidates captures head icon links, manifest, and ms tile image", () => {
  const html = `
    <html>
      <head>
        <base href="https://cdn.example.com/assets/">
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">
        <link rel="shortcut icon" href="/favicon.ico">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#006EE6">
        <link rel="manifest" href="/site.webmanifest">
        <meta name="msapplication-TileImage" content="/mstile-144x144.png">
      </head>
    </html>
  `;
  const { candidates, signals } = extractHtmlFaviconCandidates({
    html,
    pageUrl: "https://brand.example/",
  });

  assert.equal(signals.hasIconLink, true);
  assert.equal(signals.hasAppleLink, true);
  assert.equal(signals.hasManifestLink, true);
  assert.equal(signals.manifestUrl, "https://cdn.example.com/site.webmanifest");

  const sources = candidates.map((item) => item.source).sort();
  assert.equal(sources.includes("html:icon"), true);
  assert.equal(sources.includes("html:shortcut icon"), true);
  assert.equal(sources.includes("html:apple-touch-icon"), true);
  assert.equal(sources.includes("html:mask-icon"), true);
  assert.equal(sources.includes("html:msapplication-TileImage"), true);
});

test("extractManifestFaviconCandidates resolves manifest icon entries", () => {
  const icons = extractManifestFaviconCandidates({
    manifest: {
      icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "https://cdn.example.com/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    manifestUrl: "https://brand.example/site.webmanifest",
  });

  assert.equal(icons.length, 2);
  assert.equal(icons[0].url, "https://brand.example/android-chrome-192x192.png");
  assert.equal(icons[0].declaredSizes[0], "192x192");
  assert.equal(icons[1].url, "https://cdn.example.com/icon-512.png");
  assert.equal(icons[1].source, "manifest");
});

test("buildFaviconIntelligence checks fallback /favicon.ico and /apple-touch-icon.png", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || "GET").toUpperCase();
    calls.push({ url: href, method });

    if (href === "https://fallback.example" && method === "GET") {
      return new Response("<html><head></head><body>Empty</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (href === "https://fallback.example/favicon.ico") {
      return new Response(null, { status: 404, headers: { "content-type": "text/plain" } });
    }
    if (href === "https://fallback.example/apple-touch-icon.png") {
      return new Response(null, { status: 404, headers: { "content-type": "text/plain" } });
    }
    return new Response(null, { status: 404 });
  };

  const result = await buildFaviconIntelligence({
    origin: "https://fallback.example",
    fetchImpl,
  });

  assert.ok(result);
  assert.equal(result?.issues.some((issue) => issue.code === "missing_favicon" && issue.priority === "P0"), true);
  assert.equal(
    result?.issues.some((issue) => issue.code === "missing_apple_touch_icon" && issue.priority === "P1"),
    true
  );
  assert.equal(calls.some((call) => call.url === "https://fallback.example/favicon.ico"), true);
  assert.equal(calls.some((call) => call.url === "https://fallback.example/apple-touch-icon.png"), true);
});

test("buildFaviconIntelligence probes PNG and ICO dimensions from fixtures", async () => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || "GET").toUpperCase();

    if (href === "https://sizes.example" && method === "GET") {
      return new Response(
        `<html><head>
          <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png">
          <link rel="shortcut icon" href="/favicon.ico">
        </head></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    if (href === "https://sizes.example/favicon-16x16.png") {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: contentHeaders("image/png", PNG_16) });
      }
      return new Response(PNG_16, { status: 200, headers: contentHeaders("image/png", PNG_16) });
    }

    if (href === "https://sizes.example/favicon.ico") {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: contentHeaders("image/x-icon", ICO_32) });
      }
      return new Response(ICO_32, { status: 200, headers: contentHeaders("image/x-icon", ICO_32) });
    }

    if (href === "https://sizes.example/apple-touch-icon.png") {
      return new Response(null, { status: 404, headers: { "content-type": "text/plain" } });
    }

    return new Response(null, { status: 404 });
  };

  const result = await buildFaviconIntelligence({
    origin: "https://sizes.example",
    fetchImpl,
  });
  assert.ok(result);

  const pngIcon = result?.icons.find((icon) => icon.url.endsWith("/favicon-16x16.png")) || null;
  const icoIcon = result?.icons.find((icon) => icon.url.endsWith("/favicon.ico")) || null;

  assert.equal(pngIcon?.format, "png");
  assert.equal(pngIcon?.actualWidth, 16);
  assert.equal(pngIcon?.actualHeight, 16);

  assert.equal(icoIcon?.format, "ico");
  assert.equal(icoIcon?.actualWidth, 32);
  assert.equal(icoIcon?.actualHeight, 32);
});

test("priority rules map missing favicon to P0 and missing apple touch to P1", async () => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = String(init?.method || "GET").toUpperCase();

    if (href === "https://priority.example" && method === "GET") {
      return new Response(
        `<html><head><link rel="icon" href="/favicon.ico"></head></html>`,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    if (href === "https://priority.example/favicon.ico") {
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: contentHeaders("image/x-icon", ICO_32) });
      }
      return new Response(ICO_32, { status: 200, headers: contentHeaders("image/x-icon", ICO_32) });
    }

    if (href === "https://priority.example/apple-touch-icon.png") {
      return new Response(null, { status: 404, headers: { "content-type": "text/plain" } });
    }

    return new Response(null, { status: 404 });
  };

  const result = await buildFaviconIntelligence({
    origin: "https://priority.example",
    fetchImpl,
  });
  assert.ok(result);
  assert.equal(result?.issues.some((issue) => issue.code === "missing_favicon"), false);
  assert.equal(
    result?.issues.some((issue) => issue.code === "missing_apple_touch_icon" && issue.priority === "P1"),
    true
  );
});

test("SEO page favicon section renders from payload without client fetch waterfall code", () => {
  const source = fs.readFileSync(path.resolve("app/seo/page.tsx"), "utf8");
  const start = source.indexOf("/* FAVICONS */");
  const end = source.indexOf("/* PAGE AUDITS */");
  assert.ok(start >= 0 && end > start);

  const section = source.slice(start, end);
  assert.match(section, /faviconIcons\.map\(/);
  assert.match(section, /aria-label="Favicons"/);
  assert.equal(/fetch\(/.test(section), false);
});
