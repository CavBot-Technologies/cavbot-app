function normalizeOriginStrict(origin: string): string {
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

export function originAllowed(originHeader: string | null, rows: Array<{ origin: string; matchType: string }>): boolean {
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
      // stored origin should look like "https://*.client.com"
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