// lib/username.ts
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

// Route segments that must never be claimable as usernames because they are (or may become) first-class app routes
// or public assets. Keep in sync with the public profile routing guard.
export const RESERVED_ROUTE_SLUGS = [
  "settings",
  "console",
  "errors",
  "routes",
  "seo",
  "plan",
  "insights",
  "status",
  "notifications",
  "share",
  "p",
  "auth",
  "register",
  "cavtools",
  "a11y",
  "api",
  "cavcode",
  "login",
  "users",
  "billing",
  "integrations",
  "cavcloud",
  "cavsafe",
  "assets",
  "sdk",
  "arcade",
  "cavbot-arcade",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
] as const;

const RESERVED = new Set([
  "admin",
  "administrator",
  "support",
  "billing",
  "help",
  "security",
  "root",
  "system",
  "moderator",
  "team",
  "staff",
  "owner",
  "cavbot",
  "cavbotio",
  "cavbot_io",
  "cavbotadmin",
  "cavbotadm",
  "cavpad",
  "cavcode",
  "cavcodeviewer",
  "cavcloud",
  "cavpay",
  "cavbotadmin",
  "cavbotadm",
  "cavbotio",
  "cavbotio",
  // Reserved routing segments (identity URLs must never conflict with app routes/assets)
  ...RESERVED_ROUTE_SLUGS,
]);

const RESERVED_PREFIXES = [
  "cavbot",
  "cavcloud",
  "cavcode",
  "cavpad",
  "cavpay",
  "cavcodeviewer",
];

export function normalizeUsername(input: unknown): string {
  const value = String(input ?? "").trim();
  if (!value) return "";
  const trimmed = value.startsWith("@") ? value.slice(1) : value;
  return trimmed.toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  const u = normalizeUsername(username);
  const compact = u.replace(/[^a-z0-9_]/g, "");
  if (!u) return false;
  if (RESERVED.has(u) || RESERVED.has(compact)) return true;
  return RESERVED_PREFIXES.some((p) => u.startsWith(p) || compact.startsWith(p));
}

function matchesBasicPattern(u: string) {
  return /^[a-z][a-z0-9_]*$/.test(u);
}

export function isValidUsername(username: string): boolean {
  const u = normalizeUsername(username);
  if (!u) return false;
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return false;
  if (!matchesBasicPattern(u)) return false;
  if (isReservedUsername(u)) return false;
  return true;
}

export function isBasicUsername(username: string): boolean {
  const u = normalizeUsername(username);
  if (!u) return false;
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return false;
  return matchesBasicPattern(u);
}

export function isLoginUsername(username: string): boolean {
  const u = normalizeUsername(username);
  if (!u) return false;
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return false;
  return /^[a-z][a-z0-9_]*$/.test(u);
}
