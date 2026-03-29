export type BrowserKey = "safari" | "chrome" | "brave" | "firefox" | "edge" | "unknown";

export const KNOWN_BROWSERS: BrowserKey[] = ["safari", "chrome", "brave", "firefox", "edge"];

export function detectBrowser(uaRaw: string): BrowserKey {
  const ua = String(uaRaw || "").toLowerCase();
  if (!ua) return "unknown";

  if (ua.includes("brave")) return "brave";
  if (ua.includes("edgios") || ua.includes("edg/") || ua.includes("edge/")) return "edge";
  if (ua.includes("firefox/") || ua.includes("fxios")) return "firefox";

  if (
    (ua.includes("chrome") || ua.includes("crios") || ua.includes("crmo")) &&
    !ua.includes("chromium") &&
    !ua.includes("edg") &&
    !ua.includes("opr/")
  ) {
    return "chrome";
  }

  if (
    ua.includes("safari") &&
    !ua.includes("chrome") &&
    !ua.includes("chromium") &&
    !ua.includes("edg") &&
    !ua.includes("firefox")
  ) {
    return "safari";
  }

  return "unknown";
}

export function guessBrowserFromLabel(label: string): BrowserKey {
  const normalized = String(label || "").toLowerCase();
  if (!normalized) return "unknown";
  for (const browser of KNOWN_BROWSERS) {
    if (normalized.includes(browser)) {
      return browser;
    }
  }
  return "unknown";
}

export function browserDisplayName(browser: BrowserKey | string) {
  const key = String(browser || "").toLowerCase();
  if (!key || !KNOWN_BROWSERS.includes(key as BrowserKey)) {
    return "Session";
  }
  return key[0].toUpperCase() + key.slice(1);
}
