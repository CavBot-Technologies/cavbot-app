import "server-only";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type LiveMetadataSnapshot = {
  pageUrl: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  h1Count: number | null;
  wordCount: number | null;
  jsonLdCount: number | null;
  schemaTypes: string[] | null;
  htmlLang: string | null;
};

function normalizeFetchUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}`;
    try {
      return new URL(withScheme).toString();
    } catch {
      return "";
    }
  }
}

function abortSignalWithTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x60;/gi, "`")
    .replace(/&#x3D;/gi, "=")
    .replace(/&nbsp;/gi, " ");
}

function cleanText(value: string | null | undefined): string | null {
  const raw = decodeHtmlEntities(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
  return raw || null;
}

function parseTagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:\-.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(attrRegex)) {
    const key = String(match[1] || "").toLowerCase();
    const value = String(match[3] ?? match[4] ?? match[5] ?? "").trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
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

function firstMetaContent(head: string, predicates: Array<(attrs: Record<string, string>) => boolean>): string | null {
  const metaTags = head.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = parseTagAttributes(tag);
    if (!attrs.content) continue;
    if (predicates.some((predicate) => predicate(attrs))) {
      return cleanText(attrs.content);
    }
  }
  return null;
}

function collectSchemaTypes(node: unknown, sink: Set<string>) {
  if (!node || sink.size >= 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaTypes(item, sink);
    return;
  }
  if (typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  const typeValue = rec["@type"];
  if (typeof typeValue === "string" && typeValue.trim()) sink.add(typeValue.trim());
  if (Array.isArray(typeValue)) {
    for (const item of typeValue) {
      if (typeof item === "string" && item.trim()) sink.add(item.trim());
    }
  }
  if (Array.isArray(rec["@graph"])) collectSchemaTypes(rec["@graph"], sink);
}

export async function fetchLiveMetadataSnapshot(input: {
  origin?: string;
  url?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<LiveMetadataSnapshot | null> {
  const targetUrl = normalizeFetchUrl(input.url || input.origin || "");
  if (!targetUrl) return null;

  const fetchImpl = input.fetchImpl || fetch;
  const timeoutMs = Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : 4_000;

  try {
    const response = await fetchImpl(targetUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: abortSignalWithTimeout(timeoutMs),
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });

    if (!response.ok) return null;

    const finalUrl = response.url || targetUrl;
    const html = await response.text().catch(() => "");
    if (!html) {
      return {
        pageUrl: finalUrl,
        title: null,
        description: null,
        canonical: null,
        robots: null,
        h1Count: null,
        wordCount: null,
        jsonLdCount: null,
        schemaTypes: null,
        htmlLang: null,
      };
    }

    const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
    const head = headMatch ? headMatch[1] : html;
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;
    const baseTagMatch = head.match(/<base\b[^>]*>/i);
    const baseAttrs = baseTagMatch ? parseTagAttributes(baseTagMatch[0]) : {};
    const baseUrl = resolveAbsoluteUrl(baseAttrs.href || "", finalUrl) || finalUrl;
    const htmlTagMatch = html.match(/<html\b[^>]*>/i);
    const htmlAttrs = htmlTagMatch ? parseTagAttributes(htmlTagMatch[0]) : {};

    const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title =
      cleanText(titleMatch?.[1]) ||
      firstMetaContent(head, [
        (attrs) => attrs.property === "og:title",
        (attrs) => attrs.name === "twitter:title",
      ]);

    const description = firstMetaContent(head, [
      (attrs) => attrs.name === "description",
      (attrs) => attrs.property === "og:description",
      (attrs) => attrs.name === "twitter:description",
    ]);

    const robots = firstMetaContent(head, [(attrs) => attrs.name === "robots"]);

    const linkTags = head.match(/<link\b[^>]*>/gi) || [];
    let canonical: string | null = null;
    for (const tag of linkTags) {
      const attrs = parseTagAttributes(tag);
      const rel = String(attrs.rel || "").toLowerCase();
      if (!rel.split(/\s+/).includes("canonical")) continue;
      canonical = resolveAbsoluteUrl(attrs.href || "", baseUrl);
      if (canonical) break;
    }

    if (!canonical) {
      const ogUrl = firstMetaContent(head, [(attrs) => attrs.property === "og:url"]);
      canonical = resolveAbsoluteUrl(ogUrl, baseUrl) || resolveAbsoluteUrl(finalUrl, baseUrl);
    }

    const h1Count = (body.match(/<h1\b[^>]*>/gi) || []).length;
    const jsonLdScripts = Array.from(
      html.matchAll(/<script\b[^>]*type\s*=\s*("application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi),
    );
    const schemaTypes = new Set<string>();
    for (const match of jsonLdScripts) {
      const raw = String(match[2] || "").trim();
      if (!raw) continue;
      try {
        collectSchemaTypes(JSON.parse(raw), schemaTypes);
      } catch {
        continue;
      }
    }

    const bodyText = decodeHtmlEntities(
      body
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    const words = bodyText.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [];

    return {
      pageUrl: finalUrl,
      title,
      description,
      canonical,
      robots,
      h1Count,
      wordCount: words.length,
      jsonLdCount: jsonLdScripts.length,
      schemaTypes: schemaTypes.size ? Array.from(schemaTypes).slice(0, 12) : null,
      htmlLang: cleanText(htmlAttrs.lang),
    };
  } catch {
    return null;
  }
}
