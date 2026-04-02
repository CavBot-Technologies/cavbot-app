import { normalizeUsername } from "@/lib/username";

function normalizePublicProfileUsername(rawUsername: unknown): string {
  return normalizeUsername(String(rawUsername || "").trim().replace(/^@+/, "")).trim().toLowerCase();
}

export function buildCanonicalPublicProfileHref(rawUsername: unknown): string {
  const username = normalizePublicProfileUsername(rawUsername);
  if (!username) return "";
  return `/${encodeURIComponent(username)}`;
}

export function openCanonicalPublicProfileWindow(args: {
  href?: string | null;
  fallbackHref?: string | null;
}): boolean {
  if (typeof window === "undefined") return false;

  const preferredHref = String(args.href || "").trim();
  const fallbackHref = String(args.fallbackHref || "").trim();
  const targetHref = preferredHref || fallbackHref;
  if (!targetHref) return false;

  const resolvedHref = /^https?:\/\//i.test(targetHref)
    ? targetHref
    : new URL(targetHref, window.location.origin).toString();

  if (preferredHref) {
    const opened = window.open(resolvedHref, "_blank", "noopener,noreferrer");
    if (opened) {
      try {
        opened.opener = null;
      } catch {
        // noop
      }
      return true;
    }
  }

  window.location.assign(resolvedHref);
  return Boolean(preferredHref);
}
