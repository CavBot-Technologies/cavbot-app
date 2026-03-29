type OriginMatchType = "EXACT" | "WILDCARD_SUBDOMAIN";

export type AllowedOriginRow = {
  origin: string;
  matchType: OriginMatchType;
};

function isLocalHost(value: string) {
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.endsWith(".local")
  );
}

export function normalizeOriginStrict(origin: string): string {
  const u = new URL(origin);
  // Only allow http(s)
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad_origin_scheme");
  // No path/query/fragment allowed in stored origins
  return `${u.protocol}//${u.host}`;
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
      if (normalizeOriginStrict(r.origin) === origin) return true;
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
