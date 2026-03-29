"use client";

import { rewriteLegacyInternalRuntimeAssetPath } from "@/lib/cavbotAssetPolicy";

type EntManifest = {
  entry?: { html?: string; css?: string[]; js?: string[] };
  assets?: { basePath?: string; files?: string[] };
};

const CDN_BASE = "https://cdn.cavbot.io";

function normalizePath(input: string) {
  let p = String(input || "").trim();
  if (!p) return "/";
  p = p.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  // Collapse and resolve dot segments (posix-style)
  const parts = p.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return `/${out.join("/")}`;
}

function resolveAssetPath(basePath: string, ref: string) {
  const cleaned = String(ref || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("/")) return normalizePath(cleaned);
  const baseDir = normalizePath(basePath).replace(/\/[^/]*$/, "/");
  return normalizePath(`${baseDir}${cleaned}`);
}

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url) || /^\/\//.test(url);
}

function rewriteSharedPublicPath(p: string) {
  // Entertainment packages are served from /entertainment/... (CDN) but some shared assets
  // in the packaged HTML are referenced via ../../../404/... which assumes /cavbot-arcade as a root.
  const normalized = normalizePath(p);
  if (normalized.startsWith("/404/")) return `/cavbot-arcade${normalized}`;
  return normalized;
}

function pickAbsoluteAssetUrl(absPath: string, appOrigin: string) {
  const p = normalizePath(absPath);
  const runtimeRewrite = rewriteLegacyInternalRuntimeAssetPath(p);
  if (runtimeRewrite) return `${appOrigin}${runtimeRewrite}`;

  // Shared arcade assets live under the app's `public/`.
  if (p.startsWith("/cavbot-arcade/")) return `${appOrigin}${p}`;

  // CavBot core assets are served by the app domain (and should be present under `public/`).
  if (p.startsWith("/clients/")) return `${appOrigin}${p}`;
  if (p.startsWith("/cavcore/")) return `${appOrigin}${p}`;
  if (p.startsWith("/cavai/")) return `${appOrigin}${p}`;
  if (p.startsWith("/cavbot/")) return `${appOrigin}${p}`;
  if (p.startsWith("/sdk/")) return `${appOrigin}${p}`;

  // Default: app origin (safer for any other absolute paths you might host locally).
  return `${appOrigin}${p}`;
}

function rewriteHtmlAssets(raw: string, entryPath: string, assetUrls: Record<string, string>, appOrigin: string) {
  const rewriteUrl = (value: string) => {
    const cleaned = String(value || "").trim();
    if (!cleaned || /^data:|^blob:/i.test(cleaned)) return { kind: "keep", value: cleaned };
    if (isExternalUrl(cleaned)) return { kind: "keep", value: cleaned };

    if (cleaned.startsWith("/")) {
      const resolved = normalizePath(cleaned);
      const hit = assetUrls[resolved];
      if (hit) return { kind: "replace", value: hit };
      return { kind: "replace", value: pickAbsoluteAssetUrl(resolved, appOrigin) };
    }

    const resolved = resolveAssetPath(entryPath, cleaned);
    const hit = assetUrls[resolved];
    if (hit) return { kind: "replace", value: hit };

    const shared = rewriteSharedPublicPath(resolved);
    if (shared !== resolved) return { kind: "replace", value: pickAbsoluteAssetUrl(shared, appOrigin) };

    return { kind: "keep", value: cleaned };
  };

  const attrRe = /\b(src|href|poster)\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let out = raw.replace(attrRe, (full, attr, _wrapped, d1, d2, d3) => {
    const value = d1 || d2 || d3 || "";
    const rewritten = rewriteUrl(value);
    if (rewritten.kind !== "replace") return full;
    return `${attr}="${rewritten.value}"`;
  });

  // srcset (comma-separated candidates)
  const srcSetRe = /\bsrcset\s*=\s*("([^"]+)"|'([^']+)')/gi;
  out = out.replace(srcSetRe, (full, wrapped, d1, d2) => {
    const rawSet = String(d1 || d2 || "");
    const parts = rawSet
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((candidate) => {
        const m = candidate.match(/^(\S+)(\s+.+)?$/);
        if (!m) return candidate;
        const url = m[1];
        const desc = m[2] || "";
        const rewritten = rewriteUrl(url);
        const nextUrl = rewritten.kind === "replace" ? rewritten.value : url;
        return `${nextUrl}${desc}`.trim();
      });
    return `srcset="${parts.join(", ")}"`;
  });

  return out;
}

function rewriteCssAssets(raw: string, basePath: string, assetUrls: Record<string, string>, appOrigin: string) {
  const urlRe = /url\(([^)]+)\)/gi;
  let out = raw.replace(urlRe, (full, inner) => {
    const cleaned = String(inner || "").trim().replace(/^['"]|['"]$/g, "");
    if (!cleaned || /^data:|^blob:/i.test(cleaned)) return full;
    if (isExternalUrl(cleaned)) return full;
    if (cleaned.startsWith("/")) {
      return `url(${pickAbsoluteAssetUrl(cleaned, appOrigin)})`;
    }
    const resolved = resolveAssetPath(basePath, cleaned);
    const hit = assetUrls[resolved];
    if (hit) return `url(${hit})`;
    const shared = rewriteSharedPublicPath(resolved);
    if (shared !== resolved) return `url(${pickAbsoluteAssetUrl(shared, appOrigin)})`;
    return full;
  });

  // Handle @import statements (url(...) or quoted) so they don't resolve against about:blank.
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))(?:\s*\))?\s*;/gi;
  out = out.replace(importRe, (full, a, b, c) => {
    const value = a || b || c || "";
    const cleaned = String(value || "").trim();
    if (!cleaned || /^data:|^blob:/i.test(cleaned)) return full;
    if (isExternalUrl(cleaned)) return full;
    if (cleaned.startsWith("/")) {
      return `@import url("${pickAbsoluteAssetUrl(cleaned, appOrigin)}");`;
    }
    const resolved = resolveAssetPath(basePath, cleaned);
    const hit = assetUrls[resolved];
    if (hit) return `@import url("${hit}");`;
    const shared = rewriteSharedPublicPath(resolved);
    if (shared !== resolved) return `@import url("${pickAbsoluteAssetUrl(shared, appOrigin)}");`;
    return full;
  });

  return out;
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

async function fetchText(url: string, token: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return await res.text();
}

async function fetchBlob(url: string, token: string): Promise<Blob> {
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return await res.blob();
}

async function mintEntToken(basePath: string): Promise<string> {
  const res = await fetch("/api/arcade-ent/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ basePath }),
  });
  if (!res.ok) {
    let msg = await res.text().catch(() => "");
    try {
      const parsed = JSON.parse(msg) as { error?: string; message?: string };
      msg = parsed?.message || parsed?.error || msg;
    } catch {}
    throw new Error(msg || `UNAUTHORIZED`);
  }
  const data = (await res.json()) as { ok: boolean; token?: string; error?: string; message?: string };
  if (!data?.ok || !data.token) {
    throw new Error(data?.message || data?.error || "Token mint failed");
  }
  return data.token;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function writeLoadingDoc(w: Window, title: string) {
  const safeTitle = String(title || "CavBot Arcade").replace(/[<>]/g, "");
  w.document.open();
  w.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${safeTitle}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #070A12; color: #EAF0FF; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    .wrap { height: 100%; display: grid; place-items: center; }
    .card { width: min(720px, 92vw); padding: 28px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10); }
    .k { letter-spacing: .12em; text-transform: uppercase; font-size: 12px; opacity: .7; }
    .t { font-size: 18px; margin-top: 10px; line-height: 1.4; }
    .b { margin-top: 16px; font-size: 13px; opacity: .75; }
    .bar { height: 10px; border-radius: 999px; background: rgba(255,255,255,0.10); overflow: hidden; margin-top: 18px; }
    .bar > i { display:block; height:100%; width: 42%; background: linear-gradient(90deg, #b9c85a, #8b5cff); animation: slide 1.1s ease-in-out infinite alternate; }
    @keyframes slide { from { transform: translateX(-30%); } to { transform: translateX(140%); } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="k">CavBot Arcade</div>
      <div class="t">Loading entertainment package…</div>
      <div class="bar"><i></i></div>
      <div class="b">Secure gateway: token-gated R2</div>
    </div>
  </div>
</body>
</html>`);
  w.document.close();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function writeErrorDoc(w: Window, title: string, message: string) {
  const safeTitle = String(title || "CavBot Arcade").replace(/[<>]/g, "");
  const safeMessage = String(message || "Launch failed.").replace(/[<>]/g, "");
  w.document.open();
  w.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${safeTitle}</title>
  <style>
    html, body { height: 100%; margin: 0; background: #070A12; color: #EAF0FF; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    .wrap { height: 100%; display: grid; place-items: center; }
    .card { width: min(820px, 92vw); padding: 28px; border-radius: 16px; background: rgba(255,70,70,0.08); border: 1px solid rgba(255,70,70,0.22); }
    .k { letter-spacing: .12em; text-transform: uppercase; font-size: 12px; opacity: .8; }
    .t { font-size: 16px; margin-top: 10px; line-height: 1.45; white-space: pre-wrap; }
    a { color: #b9c85a; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="k">Launch failed</div>
      <div class="t">${safeMessage}</div>
      <div class="t" style="opacity:.85;margin-top:14px;">You can close this tab and try again.</div>
    </div>
  </div>
</body>
</html>`);
  w.document.close();
}

export type EntertainmentSrcDocResult = {
  srcDoc: string;
  cleanup: () => void;
};

export async function loadEntertainmentGameSrcDoc(opts: {
  slug: string;
  version?: string;
  title?: string;
}): Promise<EntertainmentSrcDocResult> {
  const slug = String(opts.slug || "").trim();
  const version = String(opts.version || "v1").trim() || "v1";
  if (!slug) {
    throw new Error("Invalid game slug.");
  }

  const basePath = normalizePath(`/entertainment/${slug}/${version}`);
  const appOrigin = window.location.origin;
  const entryUrl = `${CDN_BASE}/arcade-ent${basePath}/index.html`;
  const manifestUrl = `${CDN_BASE}/arcade-ent${basePath}/manifest.json`;

  try {
    const token = await mintEntToken(basePath);

    const manifest = await fetchJson<EntManifest>(manifestUrl, token);
    const entryHtmlRel = String(manifest?.entry?.html || "index.html");
    const cssRels = Array.isArray(manifest?.entry?.css) ? manifest.entry!.css!.map(String) : [];
    const jsRels = Array.isArray(manifest?.entry?.js) ? manifest.entry!.js!.map(String) : [];
    const assetBase = String(manifest?.assets?.basePath || "");
    const assetFiles = Array.isArray(manifest?.assets?.files) ? manifest.assets!.files!.map(String) : [];

    const entryPath = normalizePath(`${basePath}/${entryHtmlRel}`);

    // 1) Fetch binary assets first (so CSS url() rewrites can point to blob URLs).
    const urlMap: Record<string, string> = {};
    const createdUrls: string[] = [];
    await Promise.all(
      assetFiles.map(async (name) => {
        if (!name) return;
        const rel = assetBase ? `${assetBase.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}` : name;
        const absPath = normalizePath(`${basePath}/${rel}`);
        const blob = await fetchBlob(`${CDN_BASE}/arcade-ent${absPath}`, token);
        const u = URL.createObjectURL(blob);
        createdUrls.push(u);
        urlMap[absPath] = u;
      })
    );

    // 1b) Also fetch any in-package assets referenced by index.html that aren't listed in manifest.json.
    // This prevents "about:blank" resolving ./files/... into /files/... on the app origin (404).
    const rawHtmlForScan = await fetchText(entryUrl, token);
    const attrRe = /\b(src|href|poster)\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi;
    const extraRefs = new Set<string>();
    rawHtmlForScan.replace(attrRe, (_full, _attr, _wrapped, d1, d2, d3) => {
      const value = d1 || d2 || d3 || "";
      const cleaned = String(value || "").trim();
      if (!cleaned || /^data:|^blob:/i.test(cleaned)) return "";
      if (isExternalUrl(cleaned)) return "";
      if (cleaned.startsWith("/")) return "";
      const resolved = resolveAssetPath(entryPath, cleaned);
      if (resolved.startsWith(`${basePath}/`)) extraRefs.add(resolved);
      return "";
    });
    await Promise.all(
      Array.from(extraRefs).map(async (absPath) => {
        if (urlMap[absPath]) return;
        try {
          const blob = await fetchBlob(`${CDN_BASE}/arcade-ent${absPath}`, token);
          const u = URL.createObjectURL(blob);
          createdUrls.push(u);
          urlMap[absPath] = u;
        } catch {
          // If it's missing in R2, leave it unresolved; the game may still run.
        }
      })
    );

    // 2) CSS blobs (rewritten).
    await Promise.all(
      cssRels.map(async (rel) => {
        if (!rel) return;
        const absPath = normalizePath(`${basePath}/${rel}`);
        const rawCss = await fetchText(`${CDN_BASE}/arcade-ent${absPath}`, token);
        const rewritten = rewriteCssAssets(rawCss, absPath, urlMap, appOrigin);
        const blob = new Blob([rewritten], { type: "text/css; charset=utf-8" });
        const u = URL.createObjectURL(blob);
        createdUrls.push(u);
        urlMap[absPath] = u;
      })
    );

    // 3) JS blobs.
    await Promise.all(
      jsRels.map(async (rel) => {
        if (!rel) return;
        const absPath = normalizePath(`${basePath}/${rel}`);
        const rawJs = await fetchText(`${CDN_BASE}/arcade-ent${absPath}`, token);
        const blob = new Blob([rawJs], { type: "application/javascript; charset=utf-8" });
        const u = URL.createObjectURL(blob);
        createdUrls.push(u);
        urlMap[absPath] = u;
      })
    );

    // 4) Entry HTML (rewritten to blob asset URLs).
    const srcDoc = rewriteHtmlAssets(rawHtmlForScan, entryPath, urlMap, appOrigin);

    return {
      srcDoc,
      cleanup: () => {
        createdUrls.forEach((u) => {
          try {
            URL.revokeObjectURL(u);
          } catch {}
        });
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error || "Launch failed.");
    throw new Error(msg);
  }
}

export async function launchEntertainmentGame(opts: { slug: string; version?: string; title?: string }) {
  const slug = String(opts.slug || "").trim();
  if (!slug) return;
  // Default behavior is now "in-place" (same window). The UI decides how to present the srcDoc.
  // Keep this export for call sites that still expect a one-liner.
  const result = await loadEntertainmentGameSrcDoc(opts);
  result.cleanup();
}
