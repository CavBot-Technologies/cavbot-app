import { getAppOrigin } from "@/lib/apiAuth";

function normalizeOrigin(input: string | undefined | null): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const hasScheme = /^https?:\/\//i.test(raw);
  const withProto = hasScheme ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    const scheme = u.protocol.toLowerCase();
    const host = u.host.toLowerCase();
    if (!host) return null;
    return `${scheme}//${host}`;
  } catch {
    return null;
  }
}

function maybeAdd(list: Set<string>, value: string | null) {
  if (!value) return;
  list.add(value);
}

export function getCavbotAppOrigins(): string[] {
  const origins = new Set<string>();

  const primary = getAppOrigin();
  maybeAdd(origins, primary);

  maybeAdd(origins, normalizeOrigin(process.env.CAVBOT_APP_ORIGIN));
  maybeAdd(origins, normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL));
  maybeAdd(origins, normalizeOrigin(process.env.APP_URL));
  maybeAdd(origins, normalizeOrigin(process.env.NEXTAUTH_URL));

  if (process.env.NODE_ENV !== "production") {
    maybeAdd(origins, "http://localhost:3000");
    maybeAdd(origins, "http://127.0.0.1:3000");
    maybeAdd(origins, "http://localhost:3001");
    maybeAdd(origins, "http://127.0.0.1:3001");
  }

  return Array.from(origins);
}
