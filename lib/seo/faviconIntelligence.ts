import { createHash } from "crypto";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type UnknownRecord = Record<string, unknown>;

export type FaviconIssuePriority = "P0" | "P1" | "P2";

export type FaviconIssueCode =
  | "missing_favicon"
  | "broken_icon_url"
  | "html_instead_of_icon"
  | "missing_apple_touch_icon"
  | "missing_16x16"
  | "missing_32x32"
  | "declared_size_mismatch"
  | "apple_touch_not_180"
  | "icon_too_small"
  | "non_square_icon"
  | "icon_too_large"
  | "duplicate_icon";

export type FaviconIssue = {
  code: FaviconIssueCode;
  priority: FaviconIssuePriority;
  title: string;
  detail: string;
  affectedCount: number;
  urls: string[];
};

export type FaviconStatus = "ok" | "warn" | "broken";

export type FaviconPrimaryKind = "tab" | "apple-touch" | "manifest";

export type FaviconSource =
  | "html:icon"
  | "html:shortcut icon"
  | "html:apple-touch-icon"
  | "html:apple-touch-icon-precomposed"
  | "html:mask-icon"
  | "html:msapplication-TileImage"
  | "manifest"
  | "fallback:favicon.ico"
  | "fallback:apple-touch-icon.png"
  | "summary:icon"
  | "summary:apple-touch-icon"
  | "summary:manifest"
  | "summary:mask-icon"
  | "summary:msapplication-TileImage";

export type FaviconIconRecord = {
  url: string;
  rel: string;
  source: FaviconSource;
  declaredSizes: string[];
  typeHint: string | null;
  fetchStatus: number;
  contentType: string | null;
  bytes: number | null;
  actualWidth: number | null;
  actualHeight: number | null;
  isSquare: boolean | null;
  format: "png" | "ico" | "svg" | "webp" | "jpg" | "unknown";
  cacheHints: { cacheControl: string | null; etag: string | null };
  contentHash: string | null;
  status: FaviconStatus;
  warningCodes: FaviconIssueCode[];
  primaryKinds: FaviconPrimaryKind[];
};

export type FaviconPrioritySummary = {
  p0: number;
  p1: number;
  p2: number;
  topIssues: FaviconIssue[];
};

export type FaviconIntelligenceResult = {
  origin: string;
  hasAnyFavicon: boolean;
  hasAppleTouchIcon: boolean;
  hasManifestIcon: boolean;
  primary: {
    tabIconUrl: string | null;
    appleTouchUrl: string | null;
    manifestIconUrl: string | null;
  };
  icons: FaviconIconRecord[];
  issues: FaviconIssue[];
  priorities: FaviconPrioritySummary;
  recommendedSet: string[];
  thresholds: {
    maxIconBytes: number;
  };
};

export type FaviconIntelligenceInput = {
  origin: string;
  summary?: unknown;
  fetchImpl?: FetchLike;
};

type RawIconCandidate = {
  url: string;
  rel: string;
  source: FaviconSource;
  declaredSizes: string[];
  typeHint: string | null;
  discoveryOrder: number;
};

type HeadSignals = {
  hasIconLink: boolean;
  hasAppleLink: boolean;
  hasManifestLink: boolean;
  manifestUrl: string | null;
};

type InspectResult = {
  fetchStatus: number;
  contentType: string | null;
  bytes: number | null;
  cacheHints: { cacheControl: string | null; etag: string | null };
  prefixBytes: Uint8Array | null;
  methodUsed: "HEAD" | "GET" | "NONE";
};

type EvaluatedIcon = Omit<FaviconIconRecord, "status" | "warningCodes" | "primaryKinds"> & {
  discoveryOrder: number;
  icoSizes: string[];
  isVector: boolean;
  hasDeclaredMismatch: boolean;
  expectedApple180: boolean;
};

type DimensionsProbe = {
  width: number | null;
  height: number | null;
  icoSizes: string[];
  isVector: boolean;
};

const MAX_PROBE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
const MAX_ICON_CANDIDATES = 24;
const MAX_ISSUE_URLS = 8;
const MAX_ICON_BYTES = 200 * 1024;
const RECOMMENDED_SET = [
  "/favicon.ico (contains 16x16 + 32x32)",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png (180x180)",
  "/site.webmanifest with 192x192 + 512x512 icons",
] as const;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstRecord(...values: unknown[]): UnknownRecord | null {
  for (const value of values) {
    const rec = asRecord(value);
    if (rec) return rec;
  }
  return null;
}

function firstString(record: UnknownRecord | null, ...keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function normalizeOrigin(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}`;
    try {
      return new URL(withScheme).origin;
    } catch {
      return "";
    }
  }
}

function normalizeRel(rel: string): string {
  const tokens = String(rel || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return Array.from(new Set(tokens)).join(" ");
}

function parseTagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:\-.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = String(match[1] || "").toLowerCase();
    const value = (match[3] ?? match[4] ?? match[5] ?? "").trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function parseDeclaredSizes(raw: string | null | undefined): string[] {
  const tokens = String(raw || "")
    .toLowerCase()
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const token of tokens) {
    if (token === "any" || /^\d+x\d+$/.test(token)) out.push(token);
  }
  return Array.from(new Set(out));
}

function resolveAbsoluteUrl(href: string | null | undefined, base: string): string | null {
  const raw = String(href || "").trim();
  if (!raw) return null;
  if (/^data:/i.test(raw) || /^javascript:/i.test(raw)) return null;
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

export function extractHtmlFaviconCandidates(input: {
  html: string;
  pageUrl: string;
}): { candidates: RawIconCandidate[]; signals: HeadSignals } {
  const html = String(input.html || "");
  const pageUrl = String(input.pageUrl || "");
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[1] : html;

  const baseTagMatch = head.match(/<base\b[^>]*>/i);
  const baseAttrs = baseTagMatch ? parseTagAttributes(baseTagMatch[0]) : {};
  const baseHref = resolveAbsoluteUrl(baseAttrs.href || "", pageUrl) || pageUrl;

  let discoveryOrder = 0;
  const candidates: RawIconCandidate[] = [];
  let hasIconLink = false;
  let hasAppleLink = false;
  let hasManifestLink = false;
  let manifestUrl: string | null = null;

  const linkRegex = /<link\b[^>]*>/gi;
  for (const match of head.matchAll(linkRegex)) {
    const attrs = parseTagAttributes(match[0]);
    const rel = normalizeRel(attrs.rel || "");
    const href = resolveAbsoluteUrl(attrs.href || "", baseHref);
    if (!rel || !href) continue;
    const relTokens = new Set(rel.split(/\s+/).filter(Boolean));
    const declaredSizes = parseDeclaredSizes(attrs.sizes || null);
    const typeHint = attrs.type ? attrs.type.trim().toLowerCase() : null;

    if (relTokens.has("manifest")) {
      hasManifestLink = true;
      if (!manifestUrl) manifestUrl = href;
    }

    if (relTokens.has("mask-icon")) {
      candidates.push({
        url: href,
        rel: "mask-icon",
        source: "html:mask-icon",
        declaredSizes,
        typeHint,
        discoveryOrder: discoveryOrder++,
      });
    }

    const isShortcutIcon = rel === "shortcut icon";
    const isRegularIcon = relTokens.has("icon");
    if (isShortcutIcon || isRegularIcon) {
      hasIconLink = true;
      candidates.push({
        url: href,
        rel: isShortcutIcon ? "shortcut icon" : "icon",
        source: isShortcutIcon ? "html:shortcut icon" : "html:icon",
        declaredSizes,
        typeHint,
        discoveryOrder: discoveryOrder++,
      });
    }

    if (relTokens.has("apple-touch-icon") || relTokens.has("apple-touch-icon-precomposed")) {
      hasAppleLink = true;
      const source = relTokens.has("apple-touch-icon-precomposed")
        ? "html:apple-touch-icon-precomposed"
        : "html:apple-touch-icon";
      candidates.push({
        url: href,
        rel: source.replace(/^html:/, ""),
        source,
        declaredSizes,
        typeHint,
        discoveryOrder: discoveryOrder++,
      });
    }
  }

  const metaRegex = /<meta\b[^>]*>/gi;
  for (const match of head.matchAll(metaRegex)) {
    const attrs = parseTagAttributes(match[0]);
    const name = String(attrs.name || "").toLowerCase();
    if (name !== "msapplication-tileimage") continue;
    const content = resolveAbsoluteUrl(attrs.content || "", baseHref);
    if (!content) continue;
    candidates.push({
      url: content,
      rel: "msapplication-TileImage",
      source: "html:msapplication-TileImage",
      declaredSizes: [],
      typeHint: null,
      discoveryOrder: discoveryOrder++,
    });
  }

  return {
    candidates,
    signals: {
      hasIconLink,
      hasAppleLink,
      hasManifestLink,
      manifestUrl,
    },
  };
}

export function extractManifestFaviconCandidates(input: {
  manifest: unknown;
  manifestUrl: string;
  startOrder?: number;
}): RawIconCandidate[] {
  const root = asRecord(input.manifest);
  if (!root) return [];
  const icons = asArray(root.icons);
  let order = Number.isFinite(input.startOrder) ? Number(input.startOrder) : 0;
  const out: RawIconCandidate[] = [];

  for (const row of icons) {
    const icon = asRecord(row);
    if (!icon) continue;
    const src = firstString(icon, "src", "url", "href");
    if (!src) continue;
    const url = resolveAbsoluteUrl(src, input.manifestUrl);
    if (!url) continue;
    out.push({
      url,
      rel: "manifest",
      source: "manifest",
      declaredSizes: parseDeclaredSizes(firstString(icon, "sizes")),
      typeHint: firstString(icon, "type"),
      discoveryOrder: order++,
    });
  }

  return out;
}

function parseManifestJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function looksLikeHtmlContentType(contentType: string | null): boolean {
  return typeof contentType === "string" && /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function abortSignalWithTimeout(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function parseContentLength(headers: Headers): number | null {
  const value = headers.get("content-length");
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function readPrefixBytes(response: Response, maxBytes = MAX_PROBE_BYTES): Promise<Uint8Array | null> {
  if (!response.body || typeof response.body.getReader !== "function") {
    const arr = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    return arr.length ? arr.slice(0, maxBytes) : null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const room = maxBytes - total;
      if (chunk.byteLength <= room) {
        chunks.push(chunk);
        total += chunk.byteLength;
        continue;
      }
      chunks.push(chunk.slice(0, room));
      total += room;
      break;
    }
  } catch {
    // ignore partial read errors
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
  }

  if (!chunks.length) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function inspectUrl(url: string, fetchImpl: FetchLike): Promise<InspectResult> {
  let headResponse: Response | null = null;
  let getResponse: Response | null = null;
  let prefixBytes: Uint8Array | null = null;

  try {
    headResponse = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      cache: "no-store",
      signal: abortSignalWithTimeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
  } catch {
    headResponse = null;
  }

  try {
    getResponse = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: abortSignalWithTimeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "image/*,*/*;q=0.8",
        Range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
      },
    });
    if (getResponse.ok) {
      prefixBytes = await readPrefixBytes(getResponse, MAX_PROBE_BYTES);
    }
  } catch {
    getResponse = null;
    prefixBytes = null;
  }

  const finalResponse =
    (getResponse && getResponse.ok ? getResponse : null) ||
    (headResponse && headResponse.ok ? headResponse : null) ||
    getResponse ||
    headResponse;

  const status = finalResponse?.status ?? 0;
  const headers = finalResponse?.headers ?? headResponse?.headers ?? new Headers();
  const contentType = headers.get("content-type");
  const bytes = parseContentLength(headers) ?? (headResponse ? parseContentLength(headResponse.headers) : null);

  const methodUsed: InspectResult["methodUsed"] =
    getResponse && getResponse.ok ? "GET" : headResponse ? "HEAD" : "NONE";

  return {
    fetchStatus: Number(status) || 0,
    contentType: contentType ? contentType.toLowerCase() : null,
    bytes,
    cacheHints: {
      cacheControl: headers.get("cache-control"),
      etag: headers.get("etag"),
    },
    prefixBytes,
    methodUsed,
  };
}

function decodeAscii(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  return Buffer.from(bytes).toString("utf8");
}

function inferFormat(input: {
  contentType: string | null;
  typeHint: string | null;
  url: string;
  prefixBytes: Uint8Array | null;
}): FaviconIconRecord["format"] {
  const contentType = String(input.contentType || "").toLowerCase();
  const typeHint = String(input.typeHint || "").toLowerCase();
  const url = String(input.url || "").toLowerCase();
  const bytes = input.prefixBytes;

  const fromMime = (mime: string) => {
    if (/svg/.test(mime)) return "svg";
    if (/png/.test(mime)) return "png";
    if (/x-icon|icon/.test(mime)) return "ico";
    if (/webp/.test(mime)) return "webp";
    if (/jpe?g/.test(mime)) return "jpg";
    return null;
  };

  const mimeGuess = fromMime(contentType) || fromMime(typeHint);
  if (mimeGuess) return mimeGuess;

  if (url.endsWith(".svg")) return "svg";
  if (url.endsWith(".png")) return "png";
  if (url.endsWith(".ico")) return "ico";
  if (url.endsWith(".webp")) return "webp";
  if (url.endsWith(".jpg") || url.endsWith(".jpeg")) return "jpg";

  if (bytes && bytes.length >= 12) {
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "png";
    }
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
      return "ico";
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return "jpg";
    }
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return "webp";
    }
    const text = decodeAscii(bytes.slice(0, Math.min(bytes.length, 240))).toLowerCase();
    if (text.includes("<svg")) return "svg";
  }

  return "unknown";
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return null;
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseIcoDimensions(bytes: Uint8Array): { width: number; height: number; icoSizes: string[] } | null {
  if (bytes.length < 22) return null;
  if (!(bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00)) return null;
  const count = (bytes[5] << 8) | bytes[4];
  if (count <= 0) return null;
  const sizes: string[] = [];
  let bestW = 0;
  let bestH = 0;
  const entries = Math.min(count, Math.floor((bytes.length - 6) / 16));
  for (let i = 0; i < entries; i++) {
    const offset = 6 + i * 16;
    const w = bytes[offset] || 256;
    const h = bytes[offset + 1] || 256;
    if (w > 0 && h > 0) {
      const token = `${w}x${h}`;
      if (!sizes.includes(token)) sizes.push(token);
      if (w * h > bestW * bestH) {
        bestW = w;
        bestH = h;
      }
    }
  }
  if (!bestW || !bestH) return null;
  sizes.sort((a, b) => {
    const [aw, ah] = a.split("x").map((n) => Number(n));
    const [bw, bh] = b.split("x").map((n) => Number(n));
    if (aw !== bw) return aw - bw;
    return ah - bh;
  });
  return { width: bestW, height: bestH, icoSizes: sizes };
}

function parseSvgDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  const text = decodeAscii(bytes.slice(0, Math.min(bytes.length, 12_000)));
  const svgTagMatch = text.match(/<svg\b[^>]*>/i);
  const svgTag = svgTagMatch ? svgTagMatch[0] : "";

  const widthMatch = svgTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = svgTag.match(/\bheight\s*=\s*["']([^"']+)["']/i);
  const viewBoxMatch = svgTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);

  const parseLen = (raw: string | null | undefined): number | null => {
    const value = String(raw || "").trim().toLowerCase();
    if (!value) return null;
    const numeric = value.replace(/px$/, "");
    const n = Number(numeric);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let width = parseLen(widthMatch?.[1]);
  let height = parseLen(heightMatch?.[1]);
  if ((width == null || height == null) && viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1]
      .trim()
      .split(/[\s,]+/)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (parts.length === 4) {
      if (width == null && parts[2] > 0) width = parts[2];
      if (height == null && parts[3] > 0) height = parts[3];
    }
  }

  return { width, height };
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4) return null;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const isSof =
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf;
    if (isSof && offset + 8 < bytes.length) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function probeDimensions(format: FaviconIconRecord["format"], bytes: Uint8Array | null): DimensionsProbe {
  if (!bytes || !bytes.length) {
    return { width: null, height: null, icoSizes: [], isVector: false };
  }
  if (format === "png") {
    const d = parsePngDimensions(bytes);
    return { width: d?.width ?? null, height: d?.height ?? null, icoSizes: [], isVector: false };
  }
  if (format === "ico") {
    const d = parseIcoDimensions(bytes);
    return {
      width: d?.width ?? null,
      height: d?.height ?? null,
      icoSizes: d?.icoSizes ?? [],
      isVector: false,
    };
  }
  if (format === "svg") {
    const d = parseSvgDimensions(bytes);
    return { width: d.width, height: d.height, icoSizes: [], isVector: true };
  }
  if (format === "webp") {
    const d = parseWebpDimensions(bytes);
    return { width: d?.width ?? null, height: d?.height ?? null, icoSizes: [], isVector: false };
  }
  if (format === "jpg") {
    const d = parseJpegDimensions(bytes);
    return { width: d?.width ?? null, height: d?.height ?? null, icoSizes: [], isVector: false };
  }
  return { width: null, height: null, icoSizes: [], isVector: false };
}

function parseSizeToken(token: string): { width: number; height: number } | null {
  const m = String(token || "").toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

function summarizeStatus(codes: FaviconIssueCode[], fetchStatus: number): FaviconStatus {
  if (codes.includes("broken_icon_url") || codes.includes("html_instead_of_icon")) return "broken";
  if (fetchStatus < 200 || fetchStatus >= 300) return "broken";
  if (codes.length) return "warn";
  return "ok";
}

function sourceSortWeight(source: FaviconSource): number {
  if (source === "html:icon") return 1;
  if (source === "html:shortcut icon") return 2;
  if (source === "html:apple-touch-icon") return 3;
  if (source === "html:apple-touch-icon-precomposed") return 4;
  if (source === "manifest") return 5;
  if (source === "fallback:favicon.ico") return 6;
  if (source === "fallback:apple-touch-icon.png") return 7;
  if (source.startsWith("summary:")) return 8;
  return 9;
}

function dedupeCandidates(candidates: RawIconCandidate[]): RawIconCandidate[] {
  const byUrl = new Map<string, RawIconCandidate>();
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    const existing = byUrl.get(candidate.url);
    if (!existing) {
      byUrl.set(candidate.url, candidate);
      continue;
    }
    const shouldReplace =
      sourceSortWeight(candidate.source) < sourceSortWeight(existing.source) ||
      (sourceSortWeight(candidate.source) === sourceSortWeight(existing.source) &&
        candidate.discoveryOrder < existing.discoveryOrder);
    if (!shouldReplace) continue;
    byUrl.set(candidate.url, {
      ...candidate,
      declaredSizes: candidate.declaredSizes.length ? candidate.declaredSizes : existing.declaredSizes,
      typeHint: candidate.typeHint || existing.typeHint,
    });
  }
  return Array.from(byUrl.values())
    .sort((a, b) => {
      if (a.discoveryOrder !== b.discoveryOrder) return a.discoveryOrder - b.discoveryOrder;
      return a.url.localeCompare(b.url);
    })
    .slice(0, MAX_ICON_CANDIDATES);
}

function extractSummaryFaviconCandidates(summary: unknown, origin: string, startOrder: number): RawIconCandidate[] {
  const root = asRecord(summary);
  if (!root) return [];
  const diagnostic = asRecord(root.diagnostics);
  const guardian = asRecord(root.guardian);
  const snapshot = asRecord(root.snapshot);

  const seoRoot = firstRecord(
    root.seo,
    root.seoIntelligence,
    root.seoPosture,
    diagnostic?.seo,
    guardian?.seo,
    snapshot?.seo,
    null
  );

  const routeMeta = firstRecord(
    root.routeMetadata,
    snapshot?.routeMetadata,
    asRecord(diagnostic?.routeMetadata),
    null
  );

  const favicon = firstRecord(
    seoRoot?.favicon,
    routeMeta?.favicon,
    asRecord(asRecord(routeMeta?.seo)?.favicon),
    null
  );

  if (!favicon) return [];
  let order = startOrder;
  const out: RawIconCandidate[] = [];
  const add = (href: string | null, rel: string, source: FaviconSource, sizesRaw?: string | null, typeHint?: string | null) => {
    const url = resolveAbsoluteUrl(href, origin);
    if (!url) return;
    out.push({
      url,
      rel,
      source,
      declaredSizes: parseDeclaredSizes(sizesRaw || null),
      typeHint: typeHint ? typeHint.toLowerCase() : null,
      discoveryOrder: order++,
    });
  };

  add(firstString(favicon, "iconHref"), "icon", "summary:icon", firstString(favicon, "iconSizes"), firstString(favicon, "iconType"));
  add(firstString(favicon, "appleTouchHref"), "apple-touch-icon", "summary:apple-touch-icon", firstString(favicon, "appleTouchSizes"));
  add(firstString(favicon, "manifestHref"), "manifest", "summary:manifest");
  add(firstString(favicon, "maskIconHref"), "mask-icon", "summary:mask-icon");
  add(firstString(favicon, "msTileImage"), "msapplication-TileImage", "summary:msapplication-TileImage");

  return out;
}

function isAppleCandidate(icon: Pick<FaviconIconRecord, "source" | "rel">): boolean {
  return (
    icon.source === "html:apple-touch-icon" ||
    icon.source === "html:apple-touch-icon-precomposed" ||
    icon.source === "fallback:apple-touch-icon.png" ||
    icon.source === "summary:apple-touch-icon" ||
    /apple-touch-icon/i.test(icon.rel)
  );
}

function isTabCandidate(icon: Pick<FaviconIconRecord, "source" | "rel">): boolean {
  return (
    icon.source === "html:icon" ||
    icon.source === "html:shortcut icon" ||
    icon.source === "fallback:favicon.ico" ||
    icon.source === "summary:icon" ||
    icon.source === "manifest" ||
    icon.source === "summary:manifest" ||
    /\bicon\b/i.test(icon.rel)
  );
}

function isManifestCandidate(icon: Pick<FaviconIconRecord, "source">): boolean {
  return icon.source === "manifest" || icon.source === "summary:manifest";
}

function isAppleStandardNoSize(icon: Pick<FaviconIconRecord, "url" | "declaredSizes">): boolean {
  if (icon.declaredSizes.length) return false;
  try {
    const pathname = new URL(icon.url).pathname.toLowerCase();
    const base = pathname.split("/").pop() || "";
    return (
      base === "apple-touch-icon.png" ||
      base === "apple-touch-icon-precomposed.png" ||
      base === "apple-favicon.png"
    );
  } catch {
    return false;
  }
}

function toHostPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function pickPrimaryIcon(
  icons: EvaluatedIcon[],
  kind: FaviconPrimaryKind
): string | null {
  const filtered = icons.filter((icon) => {
    if (icon.fetchStatus < 200 || icon.fetchStatus >= 300) return false;
    if (looksLikeHtmlContentType(icon.contentType)) return false;
    if (kind === "tab") return isTabCandidate(icon);
    if (kind === "apple-touch") return isAppleCandidate(icon);
    return isManifestCandidate(icon);
  });
  if (!filtered.length) return null;

  const score = (icon: EvaluatedIcon): number => {
    const w = icon.actualWidth ?? 0;
    const h = icon.actualHeight ?? 0;
    const min = Math.min(w || 0, h || 0);
    const max = Math.max(w || 0, h || 0);
    let s = 0;
    if (icon.fetchStatus >= 200 && icon.fetchStatus < 300) s += 200;
    if (icon.format === "svg") s += 20;
    if (kind === "tab") {
      if (min >= 32) s += 90;
      else if (min >= 16) s += 70;
      else if (min > 0) s += 30;
      if (icon.source === "html:icon" || icon.source === "html:shortcut icon") s += 20;
      if (icon.source === "fallback:favicon.ico") s += 14;
    } else if (kind === "apple-touch") {
      if (w === 180 && h === 180) s += 120;
      else if (min >= 180) s += 80;
      else if (min > 0) s += 20;
      if (icon.source === "html:apple-touch-icon") s += 20;
    } else {
      if (max >= 512) s += 100;
      else if (max >= 192) s += 70;
      else if (max > 0) s += 20;
      if (icon.source === "manifest") s += 30;
    }
    return s;
  };

  const ranked = filtered
    .slice()
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sb !== sa) return sb - sa;
      return a.url.localeCompare(b.url);
    });
  return ranked[0]?.url || null;
}

function issuePriorityRank(priority: FaviconIssuePriority): number {
  if (priority === "P0") return 3;
  if (priority === "P1") return 2;
  return 1;
}

function buildIssues(params: {
  icons: EvaluatedIcon[];
  htmlSignals: HeadSignals;
}): { issues: FaviconIssue[]; warningsByUrl: Map<string, Set<FaviconIssueCode>> } {
  const warningsByUrl = new Map<string, Set<FaviconIssueCode>>();
  const issues: FaviconIssue[] = [];

  const pushIssue = (issue: FaviconIssue) => {
    const dedupUrls = Array.from(new Set(issue.urls)).slice(0, MAX_ISSUE_URLS);
    if (!dedupUrls.length && issue.affectedCount > 0) {
      issues.push({ ...issue, urls: [] });
      return;
    }
    issues.push({ ...issue, urls: dedupUrls });
  };

  const mark = (urls: string[], code: FaviconIssueCode) => {
    for (const url of urls) {
      if (!warningsByUrl.has(url)) warningsByUrl.set(url, new Set<FaviconIssueCode>());
      warningsByUrl.get(url)?.add(code);
    }
  };

  const healthy = params.icons.filter((icon) => icon.fetchStatus >= 200 && icon.fetchStatus < 300 && !looksLikeHtmlContentType(icon.contentType));
  const tabHealthy = healthy.filter((icon) => isTabCandidate(icon));
  const appleHealthy = healthy.filter((icon) => isAppleCandidate(icon));

  const fallbackFavicon = params.icons.find((icon) => icon.source === "fallback:favicon.ico") || null;
  const hasFallbackFavicon = !!fallbackFavicon && fallbackFavicon.fetchStatus >= 200 && fallbackFavicon.fetchStatus < 300 && !looksLikeHtmlContentType(fallbackFavicon.contentType);

  if (!params.htmlSignals.hasIconLink && !hasFallbackFavicon) {
    pushIssue({
      code: "missing_favicon",
      priority: "P0",
      title: "Missing favicon",
      detail: "No <link rel=\"icon\"> was detected and /favicon.ico is unavailable.",
      affectedCount: 1,
      urls: fallbackFavicon ? [fallbackFavicon.url] : [],
    });
    if (fallbackFavicon) mark([fallbackFavicon.url], "missing_favicon");
  }

  const brokenIcons = params.icons.filter((icon) => icon.fetchStatus <= 0 || icon.fetchStatus >= 400);
  if (brokenIcons.length) {
    const urls = brokenIcons.map((icon) => icon.url);
    pushIssue({
      code: "broken_icon_url",
      priority: "P0",
      title: "Broken favicon URL",
      detail: "One or more favicon assets return a failed HTTP status.",
      affectedCount: brokenIcons.length,
      urls,
    });
    mark(urls, "broken_icon_url");
  }

  const htmlIcons = params.icons.filter((icon) => looksLikeHtmlContentType(icon.contentType));
  if (htmlIcons.length) {
    const urls = htmlIcons.map((icon) => icon.url);
    pushIssue({
      code: "html_instead_of_icon",
      priority: "P0",
      title: "Icon URL serves HTML",
      detail: "At least one icon URL is returning HTML instead of image content.",
      affectedCount: htmlIcons.length,
      urls,
    });
    mark(urls, "html_instead_of_icon");
  }

  if (!appleHealthy.length) {
    pushIssue({
      code: "missing_apple_touch_icon",
      priority: "P1",
      title: "Missing Apple touch icon",
      detail: "No working apple-touch icon was detected.",
      affectedCount: 1,
      urls: [],
    });
  }

  const tabSizeTokens = new Set<string>();
  for (const icon of tabHealthy) {
    if (icon.actualWidth && icon.actualHeight) {
      tabSizeTokens.add(`${icon.actualWidth}x${icon.actualHeight}`);
    }
    for (const size of icon.icoSizes) tabSizeTokens.add(size);
    for (const size of icon.declaredSizes) {
      if (/^\d+x\d+$/.test(size)) tabSizeTokens.add(size);
    }
    if (icon.isVector) tabSizeTokens.add("any");
  }

  const has16 = tabSizeTokens.has("any") || Array.from(tabSizeTokens).some((token) => {
    const size = parseSizeToken(token);
    return size ? Math.min(size.width, size.height) >= 16 : false;
  });
  const has32 = tabSizeTokens.has("any") || Array.from(tabSizeTokens).some((token) => {
    const size = parseSizeToken(token);
    return size ? Math.min(size.width, size.height) >= 32 : false;
  });

  if (!has16) {
    pushIssue({
      code: "missing_16x16",
      priority: "P1",
      title: "Missing 16x16 tab icon coverage",
      detail: "No suitable small favicon was detected for 16px tab rendering.",
      affectedCount: 1,
      urls: [],
    });
  }
  if (!has32) {
    pushIssue({
      code: "missing_32x32",
      priority: "P1",
      title: "Missing 32x32 tab icon coverage",
      detail: "No suitable 32px favicon was detected for modern tab surfaces.",
      affectedCount: 1,
      urls: [],
    });
  }

  const mismatch = params.icons.filter((icon) => icon.hasDeclaredMismatch);
  if (mismatch.length) {
    const urls = mismatch.map((icon) => icon.url);
    pushIssue({
      code: "declared_size_mismatch",
      priority: "P1",
      title: "Declared size mismatch",
      detail: "One or more icons declare sizes that do not match actual image dimensions.",
      affectedCount: mismatch.length,
      urls,
    });
    mark(urls, "declared_size_mismatch");
  }

  const appleNot180 = params.icons.filter(
    (icon) => isAppleCandidate(icon) && icon.expectedApple180 && !(icon.actualWidth === 180 && icon.actualHeight === 180)
  );
  if (appleNot180.length) {
    const urls = appleNot180.map((icon) => icon.url);
    pushIssue({
      code: "apple_touch_not_180",
      priority: "P1",
      title: "Apple touch icon is not 180x180",
      detail: "apple-touch-icon.png without explicit sizes should resolve to a real 180x180 asset.",
      affectedCount: appleNot180.length,
      urls,
    });
    mark(urls, "apple_touch_not_180");
  }

  const tooSmall = params.icons.filter((icon) => {
    if (!icon.actualWidth || !icon.actualHeight) return false;
    if (isAppleCandidate(icon)) return Math.min(icon.actualWidth, icon.actualHeight) < 180;
    if (isTabCandidate(icon)) return Math.min(icon.actualWidth, icon.actualHeight) < 16;
    return false;
  });
  if (tooSmall.length) {
    const urls = tooSmall.map((icon) => icon.url);
    pushIssue({
      code: "icon_too_small",
      priority: "P1",
      title: "Icon too small",
      detail: "At least one detected icon is below minimum practical dimensions.",
      affectedCount: tooSmall.length,
      urls,
    });
    mark(urls, "icon_too_small");
  }

  const nonSquare = params.icons.filter(
    (icon) =>
      (isAppleCandidate(icon) || isTabCandidate(icon)) &&
      icon.actualWidth != null &&
      icon.actualHeight != null &&
      icon.actualWidth !== icon.actualHeight &&
      !icon.isVector
  );
  if (nonSquare.length) {
    const urls = nonSquare.map((icon) => icon.url);
    pushIssue({
      code: "non_square_icon",
      priority: "P1",
      title: "Non-square icon detected",
      detail: "Favicon and apple-touch assets should be square to avoid crop and blur artifacts.",
      affectedCount: nonSquare.length,
      urls,
    });
    mark(urls, "non_square_icon");
  }

  const tooLarge = params.icons.filter((icon) => (icon.bytes ?? 0) > MAX_ICON_BYTES);
  if (tooLarge.length) {
    const urls = tooLarge.map((icon) => icon.url);
    pushIssue({
      code: "icon_too_large",
      priority: "P2",
      title: "Icon file too large",
      detail: `One or more icon files exceed ${MAX_ICON_BYTES} bytes.`,
      affectedCount: tooLarge.length,
      urls,
    });
    mark(urls, "icon_too_large");
  }

  const duplicateBuckets = new Map<string, string[]>();
  for (const icon of healthy) {
    const width = icon.actualWidth ?? 0;
    const height = icon.actualHeight ?? 0;
    const key = `${icon.format}|${width}x${height}|${icon.contentHash || ""}`;
    if (!duplicateBuckets.has(key)) duplicateBuckets.set(key, []);
    duplicateBuckets.get(key)?.push(icon.url);
  }
  const duplicateUrls = Array.from(duplicateBuckets.values())
    .filter((bucket) => bucket.length >= 2)
    .flat();
  if (duplicateUrls.length) {
    pushIssue({
      code: "duplicate_icon",
      priority: "P2",
      title: "Duplicate icon variants",
      detail: "Multiple icons appear to be duplicates by format and dimensions.",
      affectedCount: duplicateUrls.length,
      urls: duplicateUrls,
    });
    mark(duplicateUrls, "duplicate_icon");
  }

  const uniqueIssues = issues
    .slice()
    .sort((a, b) => {
      const pa = issuePriorityRank(a.priority);
      const pb = issuePriorityRank(b.priority);
      if (pb !== pa) return pb - pa;
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return a.title.localeCompare(b.title);
    });

  return { issues: uniqueIssues, warningsByUrl };
}

function buildPrioritySummary(issues: FaviconIssue[]): FaviconPrioritySummary {
  const p0 = issues.filter((issue) => issue.priority === "P0").length;
  const p1 = issues.filter((issue) => issue.priority === "P1").length;
  const p2 = issues.filter((issue) => issue.priority === "P2").length;
  return {
    p0,
    p1,
    p2,
    topIssues: issues.slice(0, 4),
  };
}

function declaredMatchesActual(icon: {
  declaredSizes: string[];
  actualWidth: number | null;
  actualHeight: number | null;
  icoSizes: string[];
}): boolean {
  if (!icon.declaredSizes.length) return true;
  const declaredNumeric = icon.declaredSizes.filter((size) => /^\d+x\d+$/.test(size));
  if (!declaredNumeric.length || icon.declaredSizes.includes("any")) return true;
  const actualToken =
    icon.actualWidth && icon.actualHeight ? `${icon.actualWidth}x${icon.actualHeight}` : null;
  if (actualToken && declaredNumeric.includes(actualToken)) return true;
  for (const size of icon.icoSizes) {
    if (declaredNumeric.includes(size)) return true;
  }
  return false;
}

async function fetchManifestCandidates(
  manifestUrl: string | null,
  fetchImpl: FetchLike,
  startOrder: number
): Promise<RawIconCandidate[]> {
  if (!manifestUrl) return [];
  try {
    const res = await fetchImpl(manifestUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: abortSignalWithTimeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/manifest+json,application/json,text/plain;q=0.7,*/*;q=0.5" },
    });
    if (!res.ok) return [];
    const text = await res.text().catch(() => "");
    if (!text) return [];
    const manifestJson = parseManifestJson(text);
    return extractManifestFaviconCandidates({
      manifest: manifestJson,
      manifestUrl,
      startOrder,
    });
  } catch {
    return [];
  }
}

function addFallbackCandidates(origin: string, candidates: RawIconCandidate[]): RawIconCandidate[] {
  let order = candidates.length ? Math.max(...candidates.map((item) => item.discoveryOrder)) + 1 : 0;
  const out = candidates.slice();
  const urls = new Set(out.map((item) => item.url));
  const faviconFallback = resolveAbsoluteUrl("/favicon.ico", origin);
  if (faviconFallback && !urls.has(faviconFallback)) {
    out.push({
      url: faviconFallback,
      rel: "icon",
      source: "fallback:favicon.ico",
      declaredSizes: [],
      typeHint: "image/x-icon",
      discoveryOrder: order++,
    });
    urls.add(faviconFallback);
  }
  const appleFallback = resolveAbsoluteUrl("/apple-touch-icon.png", origin);
  if (appleFallback && !urls.has(appleFallback)) {
    out.push({
      url: appleFallback,
      rel: "apple-touch-icon",
      source: "fallback:apple-touch-icon.png",
      declaredSizes: [],
      typeHint: "image/png",
      discoveryOrder: order++,
    });
  }
  return out;
}

export async function buildFaviconIntelligence(input: FaviconIntelligenceInput): Promise<FaviconIntelligenceResult | null> {
  const origin = normalizeOrigin(input.origin);
  if (!origin) return null;

  const fetchImpl = input.fetchImpl || fetch;
  let html = "";
  try {
    const res = await fetchImpl(origin, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: abortSignalWithTimeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "text/html,*/*;q=0.8" },
    });
    html = res.ok ? await res.text().catch(() => "") : "";
  } catch {
    html = "";
  }

  const extracted = extractHtmlFaviconCandidates({
    html,
    pageUrl: origin,
  });

  const fromSummary = extractSummaryFaviconCandidates(
    input.summary,
    origin,
    extracted.candidates.length
  );

  const summaryManifest =
    fromSummary.find((item) => item.source === "summary:manifest")?.url || null;

  const manifestCandidates = await fetchManifestCandidates(
    extracted.signals.manifestUrl || summaryManifest,
    fetchImpl,
    extracted.candidates.length + fromSummary.length
  );

  const deduped = dedupeCandidates(
    addFallbackCandidates(
      origin,
      dedupeCandidates(extracted.candidates.concat(fromSummary).concat(manifestCandidates))
    )
  );

  const inspections = await Promise.all(
    deduped.map(async (candidate) => {
      const inspected = await inspectUrl(candidate.url, fetchImpl);
      const format = inferFormat({
        contentType: inspected.contentType,
        typeHint: candidate.typeHint,
        url: candidate.url,
        prefixBytes: inspected.prefixBytes,
      });
      const dims = probeDimensions(format, inspected.prefixBytes);
      const contentHash = inspected.prefixBytes?.length
        ? createHash("sha256").update(inspected.prefixBytes).digest("hex").slice(0, 20)
        : null;
      return {
        ...candidate,
        fetchStatus: inspected.fetchStatus,
        contentType: inspected.contentType,
        bytes: inspected.bytes,
        cacheHints: inspected.cacheHints,
        format,
        actualWidth: dims.width,
        actualHeight: dims.height,
        icoSizes: dims.icoSizes,
        isVector: dims.isVector,
        isSquare:
          dims.width != null && dims.height != null ? dims.width === dims.height : null,
        contentHash,
      };
    })
  );

  const withChecks: EvaluatedIcon[] = inspections.map((icon) => ({
    ...icon,
    hasDeclaredMismatch: !declaredMatchesActual(icon),
    expectedApple180: isAppleCandidate(icon) && isAppleStandardNoSize(icon),
  }));

  const { issues, warningsByUrl } = buildIssues({
    icons: withChecks,
    htmlSignals: extracted.signals,
  });

  const primary = {
    tabIconUrl: pickPrimaryIcon(withChecks, "tab"),
    appleTouchUrl: pickPrimaryIcon(withChecks, "apple-touch"),
    manifestIconUrl: pickPrimaryIcon(withChecks, "manifest"),
  };

  const iconRows: FaviconIconRecord[] = withChecks
    .slice()
    .sort((a, b) => {
      if (a.discoveryOrder !== b.discoveryOrder) return a.discoveryOrder - b.discoveryOrder;
      return a.url.localeCompare(b.url);
    })
    .map((icon) => {
      const warningCodes = Array.from(warningsByUrl.get(icon.url) || []).sort();
      const primaryKinds: FaviconPrimaryKind[] = [];
      if (primary.tabIconUrl === icon.url) primaryKinds.push("tab");
      if (primary.appleTouchUrl === icon.url) primaryKinds.push("apple-touch");
      if (primary.manifestIconUrl === icon.url) primaryKinds.push("manifest");
      return {
        url: icon.url,
        rel: icon.rel,
        source: icon.source,
        declaredSizes: icon.declaredSizes,
        typeHint: icon.typeHint,
        fetchStatus: icon.fetchStatus,
        contentType: icon.contentType,
        bytes: icon.bytes,
        actualWidth: icon.actualWidth,
        actualHeight: icon.actualHeight,
        isSquare: icon.isSquare,
        format: icon.format,
        cacheHints: icon.cacheHints,
        contentHash: icon.contentHash,
        status: summarizeStatus(warningCodes, icon.fetchStatus),
        warningCodes,
        primaryKinds,
      };
    });

  const hasAnyFavicon = iconRows.some((icon) => isTabCandidate(icon) && icon.status !== "broken");
  const hasAppleTouchIcon = iconRows.some((icon) => isAppleCandidate(icon) && icon.status !== "broken");
  const hasManifestIcon = iconRows.some((icon) => isManifestCandidate(icon) && icon.status !== "broken");

  return {
    origin,
    hasAnyFavicon,
    hasAppleTouchIcon,
    hasManifestIcon,
    primary,
    icons: iconRows,
    issues,
    priorities: buildPrioritySummary(issues),
    recommendedSet: Array.from(RECOMMENDED_SET),
    thresholds: {
      maxIconBytes: MAX_ICON_BYTES,
    },
  };
}

export function faviconIssueToSeoAction(issue: FaviconIssue): {
  severity: "critical" | "high" | "medium";
  impact: "high" | "medium";
  title: string;
  whyItMatters: string;
  howToFix: string[];
} {
  if (issue.priority === "P0") {
    return {
      severity: "critical",
      impact: "high",
      title: `Favicon P0: ${issue.title}`,
      whyItMatters:
        "Critical favicon faults break browser trust signals and can degrade appearance in search/browser surfaces.",
      howToFix: [
        "Fix failing favicon URLs first (404/blocked/HTML responses).",
        "Ensure /favicon.ico is reachable and returns a real image.",
        "Keep icon links in the shared <head> template so every route inherits them.",
      ],
    };
  }
  if (issue.priority === "P1") {
    return {
      severity: "high",
      impact: "medium",
      title: `Favicon P1: ${issue.title}`,
      whyItMatters:
        "Missing or mismatched icon sizes reduce quality on tabs, iOS homescreen, and install surfaces.",
      howToFix: [
        "Ship 16x16 + 32x32 tab coverage and a 180x180 apple-touch icon.",
        "Align declared sizes with the real pixel dimensions.",
        "Use square assets and verify headers return image MIME types.",
      ],
    };
  }
  return {
    severity: "medium",
    impact: "medium",
    title: `Favicon P2: ${issue.title}`,
    whyItMatters: "Optimizing icon payloads and duplicates improves efficiency and consistency.",
    howToFix: [
      "Compress oversized icons while preserving visual quality.",
      "Remove duplicate icon variants where possible.",
      "Keep only the variants that serve real platform needs.",
    ],
  };
}

export function faviconSourceLabel(source: FaviconSource): string {
  if (source === "html:icon") return "icon";
  if (source === "html:shortcut icon") return "shortcut";
  if (source === "html:apple-touch-icon") return "apple";
  if (source === "html:apple-touch-icon-precomposed") return "apple precomposed";
  if (source === "html:mask-icon") return "mask";
  if (source === "html:msapplication-TileImage") return "ms tile";
  if (source === "manifest" || source === "summary:manifest") return "manifest";
  if (source === "fallback:favicon.ico") return "fallback /favicon.ico";
  if (source === "fallback:apple-touch-icon.png") return "fallback /apple-touch-icon.png";
  if (source === "summary:icon") return "summary icon";
  if (source === "summary:apple-touch-icon") return "summary apple";
  if (source === "summary:mask-icon") return "summary mask";
  return "summary";
}

export function faviconPrimaryLabel(kind: FaviconPrimaryKind): string {
  if (kind === "tab") return "Primary tab";
  if (kind === "apple-touch") return "Primary apple";
  return "Primary manifest";
}

export function faviconIssueLabel(code: FaviconIssueCode): string {
  if (code === "missing_favicon") return "Missing favicon";
  if (code === "broken_icon_url") return "Broken URL";
  if (code === "html_instead_of_icon") return "Served as HTML";
  if (code === "missing_apple_touch_icon") return "Missing apple touch";
  if (code === "missing_16x16") return "Missing 16x16";
  if (code === "missing_32x32") return "Missing 32x32";
  if (code === "declared_size_mismatch") return "Declared size mismatch";
  if (code === "apple_touch_not_180") return "Apple icon not 180x180";
  if (code === "icon_too_small") return "Too small";
  if (code === "non_square_icon") return "Non-square";
  if (code === "icon_too_large") return "Too large";
  return "Duplicate";
}

export function faviconSizeLabel(icon: Pick<FaviconIconRecord, "actualWidth" | "actualHeight" | "format">): string {
  if (icon.actualWidth != null && icon.actualHeight != null) return `${icon.actualWidth}x${icon.actualHeight}`;
  if (icon.format === "svg") return "vector";
  return "unknown";
}

export function faviconBytesLabel(bytes: number | null): string {
  if (!Number.isFinite(bytes || NaN) || bytes == null || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function faviconIssueScopeLabel(issue: FaviconIssue): string {
  if (!issue.urls.length) return issue.detail;
  const samples = issue.urls.slice(0, 2).map((url) => toHostPath(url));
  return `${issue.detail} ${samples.join(", ")}`;
}
