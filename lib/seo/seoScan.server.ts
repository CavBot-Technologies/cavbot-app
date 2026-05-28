import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  Prisma,
  ScanFindingSeverity,
  ScanJobStatus,
  type ScanJob,
} from "@prisma/client";

import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";

export const SEO_SCAN_REASON_PREFIX = "SEO_AUDIT";
export const SEO_SCAN_REASON = `${SEO_SCAN_REASON_PREFIX}_SINGLE_PAGE`;

const MAX_REDIRECTS = 3;
const HTML_MAX_BYTES = 1_250_000;
const AUX_MAX_BYTES = 180_000;
const FETCH_TIMEOUT_MS = 12_000;
const AUX_TIMEOUT_MS = 6_000;
const SEO_SCAN_VERSION = 1;

const NO_CREDENTIALS_MESSAGE = "Origins may not include usernames or passwords.";
const INTERNAL_HOST_MESSAGE = "Internal, private, and local origins cannot be scanned.";

export type SeoIssueSeverity = "critical" | "high" | "medium" | "low" | "notice" | "none";
export type SeoCheckStatus = "pass" | "fail" | "warning" | "notice";
export type SeoIssueCategory =
  | "metadata"
  | "indexability"
  | "structure"
  | "social"
  | "favicon"
  | "structured_data"
  | "robots"
  | "sitemap";

export type SeoIssue = {
  id: string;
  category: SeoIssueCategory;
  label: string;
  status: SeoCheckStatus;
  severity: SeoIssueSeverity;
  message: string;
  recommendation?: string | null;
  url?: string;
};

export type SeoScoreBand = "Clean" | "Stable" | "Needs Attention" | "At Risk";

type HeadingRow = {
  level: number;
  text: string;
};

type LinkRow = {
  rel: string;
  href: string;
  type?: string | null;
  sizes?: string | null;
};

type JsonLdResult = {
  count: number;
  validCount: number;
  invalidCount: number;
  types: string[];
  contexts: string[];
  parseErrors: string[];
};

type FetchedResource = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  xRobotsTag: string | null;
  body: string;
  bytes: number;
  responseTimeMs: number;
  redirectCount: number;
  redirectChain: string[];
};

type AssetCheck = {
  url: string;
  status: number | null;
  contentType: string | null;
  ok: boolean;
  errorCode?: string | null;
};

export type SeoScanStoredReport = {
  kind: "seo_audit";
  version: number;
  mode: "single-page";
  origin: string;
  requestedUrl: string;
  finalUrl: string;
  status: "succeeded" | "failed";
  scannedAt: string;
  durationMs: number;
  score: number;
  scoreBand: SeoScoreBand;
  summary: {
    pagesChecked: number;
    issuesFound: number;
    highPriorityCount: number;
    topPriorityFix: SeoIssue | null;
  };
  fetch: {
    statusCode: number | null;
    contentType: string | null;
    redirectCount: number;
    redirectChain: string[];
    responseBytes: number;
    responseTimeMs: number;
  };
  metadata: {
    title: string | null;
    titleLength: number;
    description: string | null;
    descriptionLength: number;
    canonical: string | null;
    canonicalValid: boolean;
    canonicalSameOrigin: boolean | null;
    htmlLang: string | null;
  };
  indexability: {
    robotsMeta: string | null;
    xRobotsTag: string | null;
    noindex: boolean;
    nofollow: boolean;
    robotsTxt: AssetCheck;
    sitemapXml: AssetCheck;
  };
  structure: {
    h1Count: number;
    h1s: string[];
    headings: HeadingRow[];
    emptyHeadingCount: number;
    headingOrderValid: boolean;
    wordCount: number;
  };
  social: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    ogUrl: string | null;
    twitterCard: string | null;
    twitterTitle: string | null;
    twitterDescription: string | null;
    twitterImage: string | null;
  };
  favicon: {
    links: LinkRow[];
    checked: AssetCheck[];
    faviconIco: AssetCheck;
    appleTouchIcon: LinkRow | null;
    manifestIcon: LinkRow | null;
    maskIcon: LinkRow | null;
    primaryIconUrl: string | null;
  };
  structuredData: JsonLdResult;
  checks: SeoIssue[];
  issues: SeoIssue[];
  raw: {
    statusCode: number | null;
    finalUrl: string;
    contentType: string | null;
    title: string | null;
    description: string | null;
    canonical: string | null;
    robots: string | null;
    h1Count: number;
    wordCount: number;
    jsonLdCount: number;
    robotsTxtStatus: number | null;
    sitemapXmlStatus: number | null;
  };
  error?: {
    code: string;
    message: string;
  } | null;
};

export type SeoScanRunResult = ScanJob & {
  resultJson: Prisma.JsonValue | null;
};

type CreateSeoScanInput = {
  accountId: string;
  operatorUserId?: string | null;
  projectId: number;
  siteId: string;
  origin: string;
  source?: string | null;
  request?: Request | null;
};

type SeoScanErrorCode =
  | "INVALID_ORIGIN"
  | "UNSAFE_ORIGIN"
  | "DNS_LOOKUP_FAILED"
  | "FETCH_FAILED"
  | "RESPONSE_TOO_LARGE"
  | "TOO_MANY_REDIRECTS"
  | "UNSAFE_REDIRECT_TARGET"
  | "RATE_LIMITED"
  | "SCAN_FAILED";

export class SeoScanError extends Error {
  code: SeoScanErrorCode;
  status: number;
  safeMessage: string;
  retryAfterSec?: number;

  constructor(code: SeoScanErrorCode, safeMessage: string, status = 400, retryAfterSec?: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.safeMessage = safeMessage;
    this.retryAfterSec = retryAfterSec;
  }
}

function cleanText(value: unknown, max = 500) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max) : text;
}

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}

function withHttpsDefault(input: string) {
  const raw = input.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function hasForbiddenHostnameChars(hostname: string) {
  if (!hostname || hostname.length > 253 || hostname.includes("..")) return true;
  if (hostname.startsWith(".") || hostname.endsWith(".")) return true;
  return hostname
    .split(".")
    .some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/i.test(label) || label.startsWith("-") || label.endsWith("-"));
}

function normalizePort(protocol: string, port: string) {
  if (!port) return "";
  if (protocol === "https:" && port === "443") return "";
  if (protocol === "http:" && port === "80") return "";
  return `:${port}`;
}

export function normalizeSeoScanOrigin(input: unknown): string | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(withHttpsDefault(raw));
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) {
    throw new SeoScanError("INVALID_ORIGIN", NO_CREDENTIALS_MESSAGE, 400);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (hasForbiddenHostnameChars(hostname) && !isIP(hostname)) return null;

  const portPart = normalizePort(parsed.protocol, parsed.port);
  const hostPart = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return `${parsed.protocol}//${hostPart}${portPart}`;
}

function clientIpFromRequest(req?: Request | null) {
  if (!req) return "";
  const candidates = ["cf-connecting-ip", "true-client-ip", "x-forwarded-for", "x-real-ip"];
  for (const header of candidates) {
    const raw = String(req.headers.get(header) || "").trim();
    if (!raw) continue;
    return raw.split(",")[0]?.trim() || "";
  }
  return "";
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return -1;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : -1;
  });
  return nums.every((value) => value >= 0) ? nums : null;
}

function isBlockedIPv4(host: string) {
  const ip = parseIPv4(host);
  if (!ip) return false;
  const [a, b, c, d] = ip;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  if (a === 169 && b === 254 && c === 169 && d === 254) return true;
  return false;
}

function isBlockedIPv6(host: string) {
  const normalized = host.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  const mapped = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1] && isBlockedIPv4(mapped[1])) return true;
  return false;
}

function isBlockedIp(host: string) {
  const normalized = host.replace(/^\[/, "").replace(/\]$/, "");
  const version = isIP(normalized);
  if (version === 4) return isBlockedIPv4(normalized);
  if (version === 6) return isBlockedIPv6(normalized);
  return false;
}

function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal") return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (host.endsWith(".home") || host.endsWith(".corp") || host.endsWith(".intranet")) return true;
  if (host.endsWith(".test") || host.endsWith(".invalid")) return true;
  if (!host.includes(".") && !isIP(host)) return true;
  return false;
}

async function assertPublicFetchUrl(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SeoScanError("UNSAFE_ORIGIN", "Only HTTP and HTTPS origins can be scanned.", 400);
  }
  if (url.username || url.password) {
    throw new SeoScanError("UNSAFE_ORIGIN", NO_CREDENTIALS_MESSAGE, 400);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (isBlockedHostname(hostname) || isBlockedIp(hostname)) {
    throw new SeoScanError("UNSAFE_ORIGIN", INTERNAL_HOST_MESSAGE, 400);
  }

  if (isIP(hostname)) return;

  let resolved: Array<{ address: string }> = [];
  try {
    resolved = await lookup(hostname, { all: true, verbatim: false });
  } catch {
    throw new SeoScanError("DNS_LOOKUP_FAILED", "CavBot could not resolve that origin.", 400);
  }

  if (!resolved.length || resolved.some((row) => isBlockedIp(row.address))) {
    throw new SeoScanError("UNSAFE_ORIGIN", INTERNAL_HOST_MESSAGE, 400);
  }
}

function decodeHtmlEntities(input: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, key: string) => {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return named[normalized] ?? full;
  });
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseAttrs(tag: string) {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(re)) {
    const key = match[1]?.toLowerCase();
    if (!key) continue;
    attrs[key] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return attrs;
}

function firstTagContent(html: string, tagName: string) {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(re);
  return match?.[1] ? stripTags(match[1]) : null;
}

function parseHtmlSnapshot(html: string, pageUrl: string) {
  const meta: Record<string, string> = {};
  const links: LinkRow[] = [];
  const headings: HeadingRow[] = [];

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const key = (attrs.name || attrs.property || attrs["http-equiv"] || "").toLowerCase();
    const content = cleanText(attrs.content || "", 800);
    if (key && content) meta[key] = content;
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const rel = cleanText(attrs.rel || "", 140).toLowerCase();
    const hrefRaw = cleanText(attrs.href || "", 1200);
    if (!rel || !hrefRaw) continue;
    let href = hrefRaw;
    try {
      href = new URL(hrefRaw, pageUrl).toString();
    } catch {}
    links.push({
      rel,
      href,
      type: attrs.type || null,
      sizes: attrs.sizes || null,
    });
  }

  for (const match of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    headings.push({
      level: Number(match[1]),
      text: stripTags(match[2] || ""),
    });
  }

  const jsonLd = parseJsonLd(html);
  const bodyText = stripTags(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " "),
  );
  const wordCount = (bodyText.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []).length;
  const title = firstTagContent(html, "title");
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] || "";
  const htmlAttrs = htmlTag ? parseAttrs(htmlTag) : {};

  return {
    title: cleanText(title || "", 800) || null,
    description: meta.description || null,
    canonical: links.find((link) => link.rel.split(/\s+/).includes("canonical"))?.href || null,
    robotsMeta: meta.robots || meta["googlebot"] || null,
    meta,
    links,
    headings,
    h1s: headings.filter((heading) => heading.level === 1).map((heading) => heading.text).filter(Boolean),
    emptyHeadingCount: headings.filter((heading) => !heading.text).length,
    headingOrderValid: validateHeadingOrder(headings),
    wordCount,
    jsonLd,
    htmlLang: htmlAttrs.lang || null,
  };
}

function parseJsonLd(html: string): JsonLdResult {
  const result: JsonLdResult = {
    count: 0,
    validCount: 0,
    invalidCount: 0,
    types: [],
    contexts: [],
    parseErrors: [],
  };

  for (const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)) {
    const tag = match[0];
    const open = tag.match(/^<script\b[^>]*>/i)?.[0] || "";
    const attrs = parseAttrs(open);
    if (String(attrs.type || "").toLowerCase() !== "application/ld+json") continue;

    result.count += 1;
    const body = tag
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(body);
      result.validCount += 1;
      collectJsonLdSignals(parsed, result);
    } catch (error) {
      result.invalidCount += 1;
      result.parseErrors.push(error instanceof Error ? error.message.slice(0, 140) : "Invalid JSON-LD");
    }
  }

  result.types = Array.from(new Set(result.types)).slice(0, 12);
  result.contexts = Array.from(new Set(result.contexts)).slice(0, 8);
  return result;
}

function collectJsonLdSignals(value: unknown, result: JsonLdResult) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdSignals(item, result));
    return;
  }
  if (!value || typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  const context = rec["@context"];
  const type = rec["@type"];
  if (typeof context === "string") result.contexts.push(context);
  if (typeof type === "string") result.types.push(type);
  if (Array.isArray(type)) {
    type.forEach((item) => {
      if (typeof item === "string") result.types.push(item);
    });
  }
  const graph = rec["@graph"];
  if (Array.isArray(graph)) graph.forEach((item) => collectJsonLdSignals(item, result));
}

function validateHeadingOrder(headings: HeadingRow[]) {
  let previous = 0;
  for (const heading of headings) {
    if (previous > 0 && heading.level > previous + 1) return false;
    previous = heading.level;
  }
  return true;
}

async function readTextLimited(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maxBytes) {
      throw new SeoScanError("RESPONSE_TOO_LARGE", "The response was too large to scan safely.", 413);
    }
    return { text, bytes };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw new SeoScanError("RESPONSE_TOO_LARGE", "The response was too large to scan safely.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString("utf8"), bytes: total };
}

async function fetchWithRedirects(
  inputUrl: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects?: number;
  },
): Promise<FetchedResource> {
  const redirectChain: string[] = [];
  let current = new URL(inputUrl);
  const start = performance.now();
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  for (let count = 0; count <= maxRedirects; count += 1) {
    await assertPublicFetchUrl(current);
    redirectChain.push(current.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.8,*/*;q=0.5",
          "user-agent": "CavBotSeoAudit/1.0 (+https://cavbot.io)",
        },
      });
    } catch {
      clearTimeout(timeout);
      throw new SeoScanError("FETCH_FAILED", "CavBot could not fetch the approved origin.", 502);
    }
    clearTimeout(timeout);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        const { text, bytes } = await readTextLimited(response, options.maxBytes);
        return resourceFromResponse(response, current.toString(), current.toString(), text, bytes, redirectChain, elapsedMs(start));
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SeoScanError("UNSAFE_REDIRECT_TARGET", "The target returned an invalid redirect.", 400);
      }
      try {
        await assertPublicFetchUrl(next);
      } catch (error) {
        if (error instanceof SeoScanError) {
          throw new SeoScanError("UNSAFE_REDIRECT_TARGET", "The target redirected to an unsafe location.", 400);
        }
        throw error;
      }
      if (count >= maxRedirects) {
        throw new SeoScanError("TOO_MANY_REDIRECTS", "The target redirects too many times.", 400);
      }
      current = next;
      continue;
    }

    const { text, bytes } = await readTextLimited(response, options.maxBytes);
    return resourceFromResponse(response, inputUrl, current.toString(), text, bytes, redirectChain, elapsedMs(start));
  }

  throw new SeoScanError("TOO_MANY_REDIRECTS", "The target redirects too many times.", 400);
}

function resourceFromResponse(
  response: Response,
  requestedUrl: string,
  finalUrl: string,
  body: string,
  bytes: number,
  redirectChain: string[],
  responseTimeMs: number,
): FetchedResource {
  return {
    url: requestedUrl,
    finalUrl,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    xRobotsTag: cleanText(response.headers.get("x-robots-tag") || "", 300) || null,
    body,
    bytes,
    responseTimeMs,
    redirectCount: Math.max(0, redirectChain.length - 1),
    redirectChain,
  };
}

async function fetchAssetStatus(url: string, maxBytes = AUX_MAX_BYTES): Promise<AssetCheck> {
  try {
    const fetched = await fetchWithRedirects(url, {
      timeoutMs: AUX_TIMEOUT_MS,
      maxBytes,
      maxRedirects: MAX_REDIRECTS,
    });
    return {
      url,
      status: fetched.status,
      contentType: fetched.contentType || null,
      ok: fetched.status >= 200 && fetched.status < 400,
    };
  } catch (error) {
    return {
      url,
      status: null,
      contentType: null,
      ok: false,
      errorCode: error instanceof SeoScanError ? error.code : "FETCH_FAILED",
    };
  }
}

function sameOrigin(left: string | null, right: string) {
  if (!left) return null;
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function isValidHttpUrl(value: string | null) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function makeIssue(
  id: string,
  category: SeoIssueCategory,
  label: string,
  status: SeoCheckStatus,
  severity: SeoIssueSeverity,
  message: string,
  recommendation?: string | null,
  url?: string,
): SeoIssue {
  return {
    id,
    category,
    label,
    status,
    severity,
    message,
    recommendation: recommendation || null,
    url,
  };
}

function scoreIssues(issues: SeoIssue[]) {
  const weight: Record<SeoIssueSeverity, number> = {
    critical: 18,
    high: 10,
    medium: 6,
    low: 3,
    notice: 1,
    none: 0,
  };
  const score = issues.reduce((current, issue) => current - weight[issue.severity], 100);
  return Math.max(0, Math.min(100, score));
}

export function scoreBandFor(score: number): SeoScoreBand {
  if (score >= 90) return "Clean";
  if (score >= 75) return "Stable";
  if (score >= 55) return "Needs Attention";
  return "At Risk";
}

function actionableIssues(checks: SeoIssue[]) {
  return checks.filter((issue) => issue.status !== "pass" && issue.severity !== "none");
}

function priorityIssues(issues: SeoIssue[]) {
  const rank: Record<SeoIssueSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    notice: 4,
    none: 5,
  };
  return issues.slice().sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function buildChecks(args: {
  origin: string;
  finalUrl: string;
  fetched: FetchedResource;
  htmlOk: boolean;
  parsed: ReturnType<typeof parseHtmlSnapshot> | null;
  robotsTxt: AssetCheck;
  sitemapXml: AssetCheck;
  faviconIco: AssetCheck;
  faviconChecks: AssetCheck[];
}) {
  const checks: SeoIssue[] = [];
  const { origin, finalUrl, fetched, htmlOk, parsed, robotsTxt, sitemapXml, faviconIco, faviconChecks } = args;
  checks.push(
    makeIssue(
      "http-status-ok",
      "indexability",
      "HTTP status",
      fetched.status >= 200 && fetched.status < 300 ? "pass" : "fail",
      fetched.status >= 200 && fetched.status < 300 ? "none" : fetched.status >= 500 ? "critical" : "high",
      `The page returned HTTP ${fetched.status}.`,
      fetched.status >= 200 && fetched.status < 300 ? null : "Return a stable 2xx response for the canonical landing page.",
      finalUrl,
    ),
  );

  checks.push(
    makeIssue(
      "html-content-type",
      "indexability",
      "HTML content",
      htmlOk ? "pass" : "fail",
      htmlOk ? "none" : "high",
      htmlOk ? "The response is HTML." : `The response content type is ${fetched.contentType || "unknown"}.`,
      htmlOk ? null : "Serve HTML for the audited page so crawlers can evaluate metadata and structure.",
      finalUrl,
    ),
  );

  if (!parsed) return checks;

  const titleLength = parsed.title?.length || 0;
  checks.push(
    makeIssue(
      "title-present",
      "metadata",
      "Title tag",
      parsed.title ? "pass" : "fail",
      parsed.title ? "none" : "critical",
      parsed.title ? `Title is present (${titleLength} characters).` : "The page is missing a title tag.",
      parsed.title ? null : "Add a concise, descriptive title tag.",
      finalUrl,
    ),
  );
  if (parsed.title) {
    checks.push(
      makeIssue(
        "title-length",
        "metadata",
        "Title length",
        titleLength >= 20 && titleLength <= 65 ? "pass" : "warning",
        titleLength >= 20 && titleLength <= 65 ? "none" : "medium",
        `Title length is ${titleLength} characters.`,
        titleLength < 20
          ? "Expand the title with clear page context and primary terms."
          : titleLength > 65
          ? "Shorten the title so search previews do not truncate important text."
          : null,
        finalUrl,
      ),
    );
  }

  const descriptionLength = parsed.description?.length || 0;
  checks.push(
    makeIssue(
      "description-present",
      "metadata",
      "Meta description",
      parsed.description ? "pass" : "fail",
      parsed.description ? "none" : "high",
      parsed.description ? `Description is present (${descriptionLength} characters).` : "The page is missing a meta description.",
      parsed.description ? null : "Add a clear meta description that summarizes the page.",
      finalUrl,
    ),
  );
  if (parsed.description) {
    checks.push(
      makeIssue(
        "description-length",
        "metadata",
        "Description length",
        descriptionLength >= 70 && descriptionLength <= 170 ? "pass" : "warning",
        descriptionLength >= 70 && descriptionLength <= 170 ? "none" : "medium",
        `Description length is ${descriptionLength} characters.`,
        descriptionLength < 70
          ? "Add more useful context for the search result preview."
          : descriptionLength > 170
          ? "Tighten the description so the most useful message appears before truncation."
          : null,
        finalUrl,
      ),
    );
  }

  const canonicalValid = isValidHttpUrl(parsed.canonical);
  const canonicalSame = sameOrigin(parsed.canonical, origin);
  checks.push(
    makeIssue(
      "canonical-present",
      "metadata",
      "Canonical link",
      parsed.canonical ? "pass" : "warning",
      parsed.canonical ? "none" : "medium",
      parsed.canonical ? "Canonical link is present." : "No canonical URL was found.",
      parsed.canonical ? null : "Add a canonical link so crawlers understand the preferred URL.",
      finalUrl,
    ),
  );
  if (parsed.canonical) {
    checks.push(
      makeIssue(
        "canonical-valid",
        "metadata",
        "Canonical URL validity",
        canonicalValid ? "pass" : "fail",
        canonicalValid ? "none" : "high",
        canonicalValid ? "Canonical URL is valid." : "Canonical URL is invalid or uses an unsupported protocol.",
        canonicalValid ? null : "Use a full HTTP or HTTPS canonical URL.",
        parsed.canonical,
      ),
    );
    checks.push(
      makeIssue(
        "canonical-origin",
        "indexability",
        "Canonical origin",
        canonicalSame ? "pass" : "warning",
        canonicalSame ? "none" : "medium",
        canonicalSame ? "Canonical stays on the approved origin." : "Canonical points away from the approved origin.",
        canonicalSame ? null : "Confirm the canonical destination is intentional and trusted.",
        parsed.canonical,
      ),
    );
  }

  const robots = (parsed.robotsMeta || "").toLowerCase();
  const noindex = robots.includes("noindex");
  const nofollow = robots.includes("nofollow");
  checks.push(
    makeIssue(
      "robots-noindex",
      "indexability",
      "Robots noindex",
      noindex ? "fail" : "pass",
      noindex ? "critical" : "none",
      noindex ? "The page contains a noindex directive." : "No noindex directive was detected.",
      noindex ? "Remove noindex from pages that should be discoverable." : null,
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "robots-nofollow",
      "indexability",
      "Robots nofollow",
      nofollow ? "warning" : "pass",
      nofollow ? "medium" : "none",
      nofollow ? "The page contains a nofollow directive." : "No nofollow directive was detected.",
      nofollow ? "Remove nofollow unless this page should not pass link discovery signals." : null,
      finalUrl,
    ),
  );

  checks.push(
    makeIssue(
      "robots-txt",
      "robots",
      "robots.txt",
      robotsTxt.ok ? "pass" : "notice",
      robotsTxt.ok ? "none" : "notice",
      robotsTxt.ok ? "robots.txt is reachable." : "robots.txt was not reachable during the scan.",
      robotsTxt.ok ? null : "Add or verify robots.txt if you need crawler-level rules.",
      robotsTxt.url,
    ),
  );
  checks.push(
    makeIssue(
      "sitemap-xml",
      "sitemap",
      "sitemap.xml",
      sitemapXml.ok ? "pass" : "warning",
      sitemapXml.ok ? "none" : "low",
      sitemapXml.ok ? "sitemap.xml is reachable." : "sitemap.xml was not reachable during the scan.",
      sitemapXml.ok ? null : "Publish a sitemap or expose its location from robots.txt.",
      sitemapXml.url,
    ),
  );

  const h1Count = parsed.h1s.length;
  checks.push(
    makeIssue(
      "h1-present",
      "structure",
      "H1 heading",
      h1Count > 0 ? "pass" : "fail",
      h1Count > 0 ? "none" : "high",
      h1Count > 0 ? `${h1Count} H1 heading${h1Count === 1 ? "" : "s"} detected.` : "The page has no H1 heading.",
      h1Count > 0 ? null : "Add one clear H1 that describes the page.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "h1-count",
      "structure",
      "H1 count",
      h1Count <= 1 ? "pass" : "warning",
      h1Count <= 1 ? "none" : "medium",
      h1Count <= 1 ? "H1 count is clean." : `${h1Count} H1 headings were detected.`,
      h1Count <= 1 ? null : "Use one primary H1 and demote supporting section headings.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "heading-order",
      "structure",
      "Heading order",
      parsed.headingOrderValid ? "pass" : "warning",
      parsed.headingOrderValid ? "none" : "low",
      parsed.headingOrderValid ? "Heading hierarchy does not skip levels." : "Heading hierarchy skips levels.",
      parsed.headingOrderValid ? null : "Keep headings in logical order, such as H1, H2, then H3.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "empty-headings",
      "structure",
      "Empty headings",
      parsed.emptyHeadingCount === 0 ? "pass" : "warning",
      parsed.emptyHeadingCount === 0 ? "none" : "low",
      parsed.emptyHeadingCount === 0 ? "No empty headings were found." : `${parsed.emptyHeadingCount} empty heading tag(s) were found.`,
      parsed.emptyHeadingCount === 0 ? null : "Remove empty heading tags or add meaningful text.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "word-count",
      "structure",
      "Body content depth",
      parsed.wordCount >= 200 ? "pass" : "warning",
      parsed.wordCount >= 200 ? "none" : "medium",
      `Visible word count is ${parsed.wordCount}.`,
      parsed.wordCount >= 200 ? null : "Add useful content that explains the page clearly for visitors and crawlers.",
      finalUrl,
    ),
  );

  const socialRequired = [
    ["og:title", parsed.meta["og:title"]],
    ["og:description", parsed.meta["og:description"]],
    ["og:image", parsed.meta["og:image"]],
    ["og:url", parsed.meta["og:url"]],
    ["twitter:card", parsed.meta["twitter:card"]],
    ["twitter:title", parsed.meta["twitter:title"]],
    ["twitter:description", parsed.meta["twitter:description"]],
    ["twitter:image", parsed.meta["twitter:image"]],
  ] as const;
  for (const [field, value] of socialRequired) {
    checks.push(
      makeIssue(
        `social-${field.replace(/[:_]/g, "-")}`,
        "social",
        field,
        value ? "pass" : "notice",
        value ? "none" : "notice",
        value ? `${field} is present.` : `${field} is missing.`,
        value ? null : "Add social preview metadata for cleaner link sharing.",
        finalUrl,
      ),
    );
  }

  const iconLinks = parsed.links.filter((link) => /\bicon\b/.test(link.rel) || link.rel.includes("manifest") || link.rel.includes("mask-icon"));
  checks.push(
    makeIssue(
      "favicon-head-links",
      "favicon",
      "Favicon links",
      iconLinks.length > 0 ? "pass" : "warning",
      iconLinks.length > 0 ? "none" : "low",
      iconLinks.length > 0 ? `${iconLinks.length} icon-related link(s) were found.` : "No icon links were found in the document head.",
      iconLinks.length > 0 ? null : "Add favicon, apple-touch-icon, and manifest links for browser and device surfaces.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "favicon-ico",
      "favicon",
      "/favicon.ico",
      faviconIco.ok ? "pass" : "warning",
      faviconIco.ok ? "none" : "low",
      faviconIco.ok ? "/favicon.ico is reachable." : "/favicon.ico was not reachable.",
      faviconIco.ok ? null : "Serve a fallback favicon at /favicon.ico.",
      faviconIco.url,
    ),
  );
  const brokenIcons = faviconChecks.filter((asset) => !asset.ok);
  checks.push(
    makeIssue(
      "favicon-response-health",
      "favicon",
      "Icon responses",
      brokenIcons.length === 0 ? "pass" : "warning",
      brokenIcons.length === 0 ? "none" : "low",
      brokenIcons.length === 0
        ? "Checked icon resources responded successfully."
        : `${brokenIcons.length} checked icon resource(s) did not respond successfully.`,
      brokenIcons.length === 0 ? null : "Fix or remove broken icon links from the page head.",
      finalUrl,
    ),
  );

  checks.push(
    makeIssue(
      "jsonld-present",
      "structured_data",
      "JSON-LD",
      parsed.jsonLd.count > 0 ? "pass" : "notice",
      parsed.jsonLd.count > 0 ? "none" : "notice",
      parsed.jsonLd.count > 0 ? `${parsed.jsonLd.count} JSON-LD block(s) detected.` : "No JSON-LD structured data was detected.",
      parsed.jsonLd.count > 0 ? null : "Add JSON-LD if this page benefits from structured data.",
      finalUrl,
    ),
  );
  checks.push(
    makeIssue(
      "jsonld-valid",
      "structured_data",
      "JSON-LD validity",
      parsed.jsonLd.invalidCount === 0 ? "pass" : "warning",
      parsed.jsonLd.invalidCount === 0 ? "none" : "medium",
      parsed.jsonLd.invalidCount === 0
        ? "All detected JSON-LD parsed correctly."
        : `${parsed.jsonLd.invalidCount} JSON-LD block(s) failed to parse.`,
      parsed.jsonLd.invalidCount === 0 ? null : "Fix invalid JSON-LD so crawlers can read structured data.",
      finalUrl,
    ),
  );

  return checks;
}

async function performSeoScan(origin: string): Promise<SeoScanStoredReport> {
  const start = performance.now();
  const requestedUrl = origin;
  let fetched: FetchedResource | null = null;

  try {
    fetched = await fetchWithRedirects(requestedUrl, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: HTML_MAX_BYTES,
      maxRedirects: MAX_REDIRECTS,
    });
  } catch (error) {
    const safe =
      error instanceof SeoScanError
        ? { code: error.code, message: error.safeMessage }
        : { code: "FETCH_FAILED", message: "CavBot could not fetch the approved origin." };
    return failedReport(origin, requestedUrl, safe.code, safe.message, elapsedMs(start));
  }

  const finalUrl = fetched.finalUrl;
  const htmlOk = /text\/html|application\/xhtml\+xml/i.test(fetched.contentType || "");
  const parsed = htmlOk ? parseHtmlSnapshot(fetched.body, finalUrl) : null;
  const finalOrigin = new URL(finalUrl).origin;

  const robotsTxtUrl = new URL("/robots.txt", finalOrigin).toString();
  const sitemapXmlUrl = new URL("/sitemap.xml", finalOrigin).toString();
  const faviconIcoUrl = new URL("/favicon.ico", finalOrigin).toString();

  const [robotsTxt, sitemapXml, faviconIco] = await Promise.all([
    fetchAssetStatus(robotsTxtUrl, AUX_MAX_BYTES),
    fetchAssetStatus(sitemapXmlUrl, AUX_MAX_BYTES),
    fetchAssetStatus(faviconIcoUrl, 80_000),
  ]);

  const faviconLinks = parsed
    ? parsed.links.filter((link) => /\bicon\b/.test(link.rel) || link.rel.includes("manifest") || link.rel.includes("mask-icon"))
    : [];
  const faviconCheckUrls = Array.from(new Set(faviconLinks.map((link) => link.href).filter(Boolean))).slice(0, 6);
  const faviconChecks = await Promise.all(faviconCheckUrls.map((url) => fetchAssetStatus(url, 90_000)));
  const primaryIconUrl = faviconChecks.find((asset) => asset.ok)?.url || (faviconIco.ok ? faviconIco.url : null);

  const checks = buildChecks({
    origin,
    finalUrl,
    fetched,
    htmlOk,
    parsed,
    robotsTxt,
    sitemapXml,
    faviconIco,
    faviconChecks,
  });

  const issues = actionableIssues(checks);
  const priority = priorityIssues(issues);
  const score = scoreIssues(issues);
  const robotsMeta = parsed?.robotsMeta || null;
  const robotsText = `${robotsMeta || ""} ${fetched.xRobotsTag || ""}`.toLowerCase();
  const noindex = robotsText.includes("noindex");
  const nofollow = robotsText.includes("nofollow");
  const canonical = parsed?.canonical || null;
  const canonicalValid = isValidHttpUrl(canonical);
  const canonicalSameOrigin = sameOrigin(canonical, origin);

  return {
    kind: "seo_audit",
    version: SEO_SCAN_VERSION,
    mode: "single-page",
    origin,
    requestedUrl,
    finalUrl,
    status: "succeeded",
    scannedAt: nowIso(),
    durationMs: elapsedMs(start),
    score,
    scoreBand: scoreBandFor(score),
    summary: {
      pagesChecked: 1,
      issuesFound: issues.length,
      highPriorityCount: issues.filter((issue) => issue.severity === "critical" || issue.severity === "high").length,
      topPriorityFix: priority[0] || null,
    },
    fetch: {
      statusCode: fetched.status,
      contentType: fetched.contentType || null,
      redirectCount: fetched.redirectCount,
      redirectChain: fetched.redirectChain,
      responseBytes: fetched.bytes,
      responseTimeMs: fetched.responseTimeMs,
    },
    metadata: {
      title: parsed?.title || null,
      titleLength: parsed?.title?.length || 0,
      description: parsed?.description || null,
      descriptionLength: parsed?.description?.length || 0,
      canonical,
      canonicalValid,
      canonicalSameOrigin,
      htmlLang: parsed?.htmlLang || null,
    },
    indexability: {
      robotsMeta,
      xRobotsTag: fetched.xRobotsTag,
      noindex,
      nofollow,
      robotsTxt,
      sitemapXml,
    },
    structure: {
      h1Count: parsed?.h1s.length || 0,
      h1s: parsed?.h1s.slice(0, 8) || [],
      headings: parsed?.headings.slice(0, 40) || [],
      emptyHeadingCount: parsed?.emptyHeadingCount || 0,
      headingOrderValid: parsed?.headingOrderValid ?? true,
      wordCount: parsed?.wordCount || 0,
    },
    social: {
      ogTitle: parsed?.meta["og:title"] || null,
      ogDescription: parsed?.meta["og:description"] || null,
      ogImage: parsed?.meta["og:image"] || null,
      ogUrl: parsed?.meta["og:url"] || null,
      twitterCard: parsed?.meta["twitter:card"] || null,
      twitterTitle: parsed?.meta["twitter:title"] || null,
      twitterDescription: parsed?.meta["twitter:description"] || null,
      twitterImage: parsed?.meta["twitter:image"] || null,
    },
    favicon: {
      links: faviconLinks.slice(0, 12),
      checked: faviconChecks,
      faviconIco,
      appleTouchIcon: faviconLinks.find((link) => link.rel.includes("apple-touch-icon")) || null,
      manifestIcon: faviconLinks.find((link) => link.rel.includes("manifest")) || null,
      maskIcon: faviconLinks.find((link) => link.rel.includes("mask-icon")) || null,
      primaryIconUrl,
    },
    structuredData:
      parsed?.jsonLd || {
        count: 0,
        validCount: 0,
        invalidCount: 0,
        types: [],
        contexts: [],
        parseErrors: [],
      },
    checks,
    issues,
    raw: {
      statusCode: fetched.status,
      finalUrl,
      contentType: fetched.contentType || null,
      title: parsed?.title || null,
      description: parsed?.description || null,
      canonical,
      robots: robotsMeta,
      h1Count: parsed?.h1s.length || 0,
      wordCount: parsed?.wordCount || 0,
      jsonLdCount: parsed?.jsonLd.count || 0,
      robotsTxtStatus: robotsTxt.status,
      sitemapXmlStatus: sitemapXml.status,
    },
    error: null,
  };
}

function failedReport(
  origin: string,
  requestedUrl: string,
  code: string,
  message: string,
  durationMs: number,
): SeoScanStoredReport {
  const issue = makeIssue(
    "scan-fetch-failed",
    "indexability",
    "Fetch failed",
    "fail",
    "critical",
    message,
    "Confirm the approved site is reachable from the public internet and try again.",
    requestedUrl,
  );
  return {
    kind: "seo_audit",
    version: SEO_SCAN_VERSION,
    mode: "single-page",
    origin,
    requestedUrl,
    finalUrl: requestedUrl,
    status: "failed",
    scannedAt: nowIso(),
    durationMs,
    score: 0,
    scoreBand: "At Risk",
    summary: {
      pagesChecked: 0,
      issuesFound: 1,
      highPriorityCount: 1,
      topPriorityFix: issue,
    },
    fetch: {
      statusCode: null,
      contentType: null,
      redirectCount: 0,
      redirectChain: [requestedUrl],
      responseBytes: 0,
      responseTimeMs: 0,
    },
    metadata: {
      title: null,
      titleLength: 0,
      description: null,
      descriptionLength: 0,
      canonical: null,
      canonicalValid: false,
      canonicalSameOrigin: null,
      htmlLang: null,
    },
    indexability: {
      robotsMeta: null,
      xRobotsTag: null,
      noindex: false,
      nofollow: false,
      robotsTxt: { url: new URL("/robots.txt", origin).toString(), status: null, contentType: null, ok: false, errorCode: "NOT_RUN" },
      sitemapXml: { url: new URL("/sitemap.xml", origin).toString(), status: null, contentType: null, ok: false, errorCode: "NOT_RUN" },
    },
    structure: {
      h1Count: 0,
      h1s: [],
      headings: [],
      emptyHeadingCount: 0,
      headingOrderValid: true,
      wordCount: 0,
    },
    social: {
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      ogUrl: null,
      twitterCard: null,
      twitterTitle: null,
      twitterDescription: null,
      twitterImage: null,
    },
    favicon: {
      links: [],
      checked: [],
      faviconIco: { url: new URL("/favicon.ico", origin).toString(), status: null, contentType: null, ok: false, errorCode: "NOT_RUN" },
      appleTouchIcon: null,
      manifestIcon: null,
      maskIcon: null,
      primaryIconUrl: null,
    },
    structuredData: {
      count: 0,
      validCount: 0,
      invalidCount: 0,
      types: [],
      contexts: [],
      parseErrors: [],
    },
    checks: [issue],
    issues: [issue],
    raw: {
      statusCode: null,
      finalUrl: requestedUrl,
      contentType: null,
      title: null,
      description: null,
      canonical: null,
      robots: null,
      h1Count: 0,
      wordCount: 0,
      jsonLdCount: 0,
      robotsTxtStatus: null,
      sitemapXmlStatus: null,
    },
    error: {
      code,
      message,
    },
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function severityForFinding(severity: SeoIssueSeverity): ScanFindingSeverity | null {
  if (severity === "critical") return ScanFindingSeverity.CRITICAL;
  if (severity === "high") return ScanFindingSeverity.HIGH;
  if (severity === "medium") return ScanFindingSeverity.MEDIUM;
  if (severity === "low") return ScanFindingSeverity.LOW;
  return null;
}

export function enforceSeoScanRateLimit(input: {
  accountId: string;
  projectId: number;
  siteId: string;
  userId?: string | null;
  ip?: string | null;
}) {
  const checks = [
    { key: `seo-scan:acct:${input.accountId}`, limit: 30, windowMs: 60 * 60 * 1000 },
    { key: `seo-scan:project:${input.projectId}`, limit: 24, windowMs: 60 * 60 * 1000 },
    { key: `seo-scan:site:${input.siteId}`, limit: 8, windowMs: 60 * 60 * 1000 },
    { key: input.userId ? `seo-scan:user:${input.userId}` : "", limit: 12, windowMs: 60 * 60 * 1000 },
    { key: input.ip ? `seo-scan:ip:${input.ip}` : "", limit: 40, windowMs: 60 * 60 * 1000 },
  ];

  for (const check of checks) {
    const result = consumeInMemoryRateLimit(check);
    if (!result.allowed) {
      throw new SeoScanError(
        "RATE_LIMITED",
        "SEO audit scans are rate limited. Try again shortly.",
        429,
        result.retryAfterSec,
      );
    }
  }
}

export async function createSeoScanAndRun(input: CreateSeoScanInput): Promise<SeoScanRunResult> {
  const normalizedOrigin = normalizeSeoScanOrigin(input.origin);
  if (!normalizedOrigin) {
    throw new SeoScanError("INVALID_ORIGIN", "Enter a valid HTTP or HTTPS origin.", 400);
  }

  const ip = clientIpFromRequest(input.request);
  enforceSeoScanRateLimit({
    accountId: input.accountId,
    projectId: input.projectId,
    siteId: input.siteId,
    userId: input.operatorUserId,
    ip,
  });

  const queued = await prisma.scanJob.create({
    data: {
      projectId: input.projectId,
      siteId: input.siteId,
      status: ScanJobStatus.QUEUED,
      reason: SEO_SCAN_REASON,
      resultJson: jsonInput({
        kind: "seo_audit",
        version: SEO_SCAN_VERSION,
        status: "queued",
        origin: normalizedOrigin,
        source: input.source || null,
      }),
    },
  });

  await auditLogWrite({
    accountId: input.accountId,
    action: "SCAN_STARTED",
    operatorUserId: input.operatorUserId || null,
    targetType: "seo_scan",
    targetId: queued.id,
    targetLabel: normalizedOrigin,
    metaJson: {
      projectId: input.projectId,
      siteId: input.siteId,
      origin: normalizedOrigin,
      source: input.source || null,
    },
    request: input.request || null,
  }).catch(() => null);

  await prisma.scanJob.update({
    where: { id: queued.id },
    data: {
      status: ScanJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  let report: SeoScanStoredReport;
  try {
    report = await performSeoScan(normalizedOrigin);
  } catch {
    report = failedReport(
      normalizedOrigin,
      normalizedOrigin,
      "SCAN_FAILED",
      "CavBot could not complete this SEO scan.",
      0,
    );
  }
  const status = report.status === "succeeded" ? ScanJobStatus.SUCCEEDED : ScanJobStatus.FAILED;

  await prisma.$transaction(async (tx) => {
    await tx.scanJob.update({
      where: { id: queued.id },
      data: {
        status,
        resultJson: jsonInput(report),
        pagesScanned: report.summary.pagesChecked,
        issuesFound: report.summary.issuesFound,
        highPriorityCount: report.summary.highPriorityCount,
        overallScore: report.score,
        durationMs: report.durationMs,
        finishedAt: new Date(),
      },
    });

    await tx.scanSnapshot.create({
      data: {
        scanJobId: queued.id,
        siteId: input.siteId,
        pageUrl: report.finalUrl || report.requestedUrl,
        title: report.metadata.title,
        status: report.fetch.statusCode,
        responseTimeMs: report.fetch.responseTimeMs || null,
        payloadBytes: report.fetch.responseBytes || null,
        metaJson: jsonInput({
          kind: "seo_audit",
          title: report.metadata.title,
          description: report.metadata.description,
          canonical: report.metadata.canonical,
          robots: report.indexability.robotsMeta,
          h1Count: report.structure.h1Count,
          wordCount: report.structure.wordCount,
          score: report.score,
          scoreBand: report.scoreBand,
        }),
      },
    });

    const actionable = report.issues
      .map((issue) => ({ issue, severity: severityForFinding(issue.severity) }))
      .filter((row): row is { issue: SeoIssue; severity: ScanFindingSeverity } => Boolean(row.severity))
      .slice(0, 50);

    if (actionable.length) {
      await tx.scanFinding.createMany({
        data: actionable.map(({ issue, severity }) => ({
          scanJobId: queued.id,
          siteId: input.siteId,
          pillar: `seo:${issue.category}`,
          severity,
          message: `${issue.label}: ${issue.message}`.slice(0, 1000),
          evidence: jsonInput({
            id: issue.id,
            status: issue.status,
            severity: issue.severity,
            recommendation: issue.recommendation || null,
            url: issue.url || null,
          }),
        })),
      });
    }
  });

  await auditLogWrite({
    accountId: input.accountId,
    action: status === ScanJobStatus.SUCCEEDED ? "SCAN_COMPLETED" : "SCAN_FAILED",
    operatorUserId: input.operatorUserId || null,
    targetType: "seo_scan",
    targetId: queued.id,
    targetLabel: normalizedOrigin,
    metaJson: {
      projectId: input.projectId,
      siteId: input.siteId,
      origin: normalizedOrigin,
      score: report.score,
      issuesFound: report.summary.issuesFound,
      error: report.error || null,
    },
    request: input.request || null,
  }).catch(() => null);

  const completed = await prisma.scanJob.findUnique({ where: { id: queued.id } });
  return completed as SeoScanRunResult;
}

export function isSeoScanReport(value: unknown): value is SeoScanStoredReport {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "seo_audit" &&
    typeof (value as { version?: unknown }).version === "number"
  );
}
