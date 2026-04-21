type OriginMatchType = "EXACT" | "WILDCARD_SUBDOMAIN";

export type AllowedOriginRow = {
  origin: string;
  matchType: OriginMatchType;
};

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.uk",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "com.au",
  "com.br",
  "com.mx",
  "com.tr",
  "edu.au",
  "gov.au",
  "gov.uk",
  "net.au",
  "net.br",
  "org.au",
  "org.br",
  "org.uk",
]);

function isLocalHost(value: string) {
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.endsWith(".local")
  );
}

function isIpLiteral(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":");
}

function hasLikelyApexStructure(hostname: string) {
  const labels = hostname
    .toLowerCase()
    .split(".")
    .map((label) => label.trim())
    .filter(Boolean);

  if (labels.length < 2) return false;
  if (labels.length === 2) return true;
  if (labels.length !== 3) return false;

  return MULTI_LABEL_PUBLIC_SUFFIXES.has(`${labels[1]}.${labels[2]}`);
}

function deriveCompanionHostname(hostname: string) {
  const normalized = hostname.toLowerCase().trim();
  if (!normalized || isLocalHost(normalized) || isIpLiteral(normalized)) return null;

  if (normalized.startsWith("www.")) {
    const bare = normalized.slice(4).trim();
    return bare || null;
  }

  if (!hasLikelyApexStructure(normalized)) return null;
  return `www.${normalized}`;
}

export function normalizeOriginStrict(origin: string): string {
  const u = new URL(origin);
  // Only allow http(s)
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad_origin_scheme");
  // No path/query/fragment allowed in stored origins
  return `${u.protocol}//${u.host}`;
}

export function expandRelatedExactOrigins(origin: string): string[] {
  const canonical = normalizeOriginStrict(origin);
  const parsed = new URL(canonical);
  const companionHostname = deriveCompanionHostname(parsed.hostname);
  if (!companionHostname) return [canonical];

  const companionOrigin = `${parsed.protocol}//${companionHostname}${parsed.port ? `:${parsed.port}` : ""}`;
  return companionOrigin === canonical ? [canonical] : [canonical, companionOrigin];
}

export function originsShareWebsiteContext(left: string, right: string): boolean {
  try {
    const canonicalRight = normalizeOriginStrict(right);
    return expandRelatedExactOrigins(left).includes(canonicalRight);
  } catch {
    return false;
  }
}

export function canonicalizeWebsiteContextOrigin(input: string, canonicalOrigin: string): string {
  const normalizedCanonical = normalizeOriginStrict(canonicalOrigin);
  const normalizedInput = normalizeOriginStrict(input);
  return originsShareWebsiteContext(normalizedInput, normalizedCanonical)
    ? normalizedCanonical
    : normalizedInput;
}

export function canonicalizeWebsiteContextHost(input: string, canonicalOrigin: string): string {
  const raw = String(input || "").trim();
  if (!raw) return raw;

  let canonical: URL;
  try {
    canonical = new URL(normalizeOriginStrict(canonicalOrigin));
  } catch {
    return raw;
  }

  const normalizedInput = raw.toLowerCase();
  const canonicalHost = canonical.host.toLowerCase();
  if (normalizedInput === canonicalHost) return canonical.host;

  const companionHostname = deriveCompanionHostname(canonical.hostname);
  if (!companionHostname) return raw;

  const companionHost = `${companionHostname}${canonical.port ? `:${canonical.port}` : ""}`.toLowerCase();
  return normalizedInput === companionHost ? canonical.host : raw;
}

export function canonicalizeWebsiteContextUrl(input: string, canonicalOrigin: string): string {
  const raw = String(input || "").trim();
  if (!raw) return raw;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return raw;
  }

  const normalizedCanonical = normalizeOriginStrict(canonicalOrigin);
  if (!originsShareWebsiteContext(parsed.origin, normalizedCanonical)) {
    return raw;
  }

  return new URL(`${parsed.pathname}${parsed.search}${parsed.hash}`, normalizedCanonical).toString();
}

function hostMatchesWildcard(host: string, base: string): boolean {
  // base is like "client.com"
  if (host === base) return true;
  return host.endsWith(`.${base}`);
}

function canonicalizeExactOrigin(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("Enter a domain or origin.");

  const withProto = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("That doesn’t look like a valid domain/origin.");
  }

  const allowHttp = isLocalHost(u.hostname);
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    throw new Error("Origins must use HTTPS.");
  }
  if (!u.hostname || u.hostname.includes("..")) throw new Error("That origin is invalid.");
  if (u.username || u.password) throw new Error("Origins may not include credentials.");

  return `${u.protocol}//${u.host}`;
}

function canonicalizeWildcardOrigin(raw: string): AllowedOriginRow {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (!trimmed) throw new Error("Enter a wildcard origin.");

  if (trimmed.includes("://") && !trimmed.startsWith("https://")) {
    throw new Error("Wildcard origins must use HTTPS.");
  }

  const withoutProto = trimmed.replace(/^https?:\/\//, "");
  const host = withoutProto.split("/")[0];
  if (!host.startsWith("*.")) throw new Error("Wildcard origins must start with `*.`");
  if (host.includes("..")) throw new Error("Wildcard origin is invalid.");
  if (host.includes(":")) throw new Error("Wildcard origins cannot include ports.");

  const rest = host.slice(2);
  if (!rest || rest.includes("*") || rest.startsWith(".") || rest.endsWith(".")) {
    throw new Error("Wildcard origin is malformed.");
  }

  return { origin: `https://${host}`, matchType: "WILDCARD_SUBDOMAIN" };
}

export function canonicalizeAllowlistOrigin(input: string): AllowedOriginRow {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("Origin is required.");

  if (trimmed.includes("*")) {
    return canonicalizeWildcardOrigin(trimmed);
  }

  return { origin: canonicalizeExactOrigin(trimmed), matchType: "EXACT" };
}

export function originAllowed(originHeader: string | null, rows: AllowedOriginRow[]): boolean {
  if (!originHeader) return false;
  let origin: string;
  try {
    origin = normalizeOriginStrict(originHeader);
  } catch {
    return false;
  }

  const o = new URL(origin);

  for (const r of rows) {
    const mt = (r.matchType || "EXACT").toUpperCase();

    if (mt === "EXACT") {
      try {
        if (expandRelatedExactOrigins(r.origin).includes(origin)) return true;
      } catch {
        continue;
      }
      continue;
    }

    if (mt === "WILDCARD_SUBDOMAIN") {
      const raw = String(r.origin || "");
      if (!raw.startsWith("https://*.")) continue;

      const base = raw.replace("https://*.", "").trim();
      if (!base || base.includes("/") || base.includes(":")) continue;

      if (o.protocol !== "https:") continue; // enforce https only for wildcard
      if (hostMatchesWildcard(o.hostname, base)) return true;
    }
  }

  return false;
}
