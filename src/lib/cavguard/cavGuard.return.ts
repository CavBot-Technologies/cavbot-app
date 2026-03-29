type ResolveGuardReturnFromRefererArgs = {
  referer?: string | null;
  host?: string | null;
  blockedPrefixes?: string[];
};

export function normalizeGuardReturnPath(rawPath: unknown): string | null {
  const raw = String(rawPath || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw, "http://cavguard.local");
    if (parsed.origin !== "http://cavguard.local") return null;
    const next = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!next.startsWith("/") || next.startsWith("//")) return null;
    return next;
  } catch {
    return null;
  }
}

export function appendGuardReturnParam(path: string, guardReturnPath?: string | null): string {
  const target = String(path || "").trim() || "/";
  const safeReturn = normalizeGuardReturnPath(guardReturnPath);
  if (!safeReturn) return target;

  try {
    const parsed = new URL(target, "http://cavguard.local");
    if (parsed.origin !== "http://cavguard.local") return target;
    parsed.searchParams.set("guardReturn", safeReturn);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return target;
  }
}

export function resolveGuardReturnFromReferer(args: ResolveGuardReturnFromRefererArgs): string | null {
  const referer = String(args.referer || "").trim();
  const host = String(args.host || "").trim().toLowerCase();
  if (!referer || !host) return null;

  try {
    const parsed = new URL(referer);
    if (String(parsed.host || "").trim().toLowerCase() !== host) return null;
    const next = normalizeGuardReturnPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    if (!next) return null;

    const blockedPrefixes = Array.isArray(args.blockedPrefixes) ? args.blockedPrefixes : [];
    const loweredNext = next.toLowerCase();
    for (const prefix of blockedPrefixes) {
      const normalizedPrefix = String(prefix || "").trim().toLowerCase();
      if (!normalizedPrefix) continue;
      if (
        loweredNext === normalizedPrefix ||
        loweredNext.startsWith(`${normalizedPrefix}/`) ||
        loweredNext.startsWith(`${normalizedPrefix}?`)
      ) {
        return null;
      }
    }

    return next;
  } catch {
    return null;
  }
}
