import { normalizeUsername } from "@/lib/username";

const CANONICAL_PUBLIC_PROFILE_ORIGIN = "https://app.cavbot.io";

function normalizePublicProfileUsername(rawUsername: unknown): string {
  return normalizeUsername(String(rawUsername || "").trim().replace(/^@+/, "")).trim().toLowerCase();
}

export function buildCanonicalPublicProfileHref(rawUsername: unknown): string {
  const username = normalizePublicProfileUsername(rawUsername);
  if (!username) return "";
  return `${CANONICAL_PUBLIC_PROFILE_ORIGIN}/${encodeURIComponent(username)}`;
}

export function openCanonicalPublicProfileWindow(args: {
  href?: string | null;
  fallbackHref?: string | null;
}): boolean {
  if (typeof window === "undefined") return false;

  const preferredHref = String(args.href || "").trim();
  const fallbackHref = String(args.fallbackHref || "").trim();
  const resolveHref = (value: string) => (
    /^https?:\/\//i.test(value)
      ? value
      : new URL(value, window.location.origin).toString()
  );

  if (preferredHref) {
    const resolvedPreferredHref = resolveHref(preferredHref);
    const doc = window.document;

    if (doc?.body) {
      const anchor = doc.createElement("a");
      anchor.href = resolvedPreferredHref;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.style.display = "none";
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    }

    try {
      const opened = window.open(resolvedPreferredHref, "_blank");
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          // noop
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  if (!fallbackHref) return false;
  window.location.assign(resolveHref(fallbackHref));
  return true;
}
