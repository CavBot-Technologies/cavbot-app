export const ADMIN_INTERNAL_PREFIX = "/admin-internal";

const DEV_DEFAULT_ADMIN_HOSTS = [
  "admin.localhost",
  "admin.localhost:3000",
  "admin.127.0.0.1",
  "admin.127.0.0.1:3000",
];

const DEFAULT_PREVIEW_SUFFIXES = [".pages.dev", ".workers.dev", ".cavbot-preview.local"];

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function splitEnvList(name: string) {
  return env(name)
    .split(",")
    .map((value) => normalizeHost(value))
    .filter(Boolean);
}

export function normalizeHost(value: string) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  const candidate = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    return parsed.host.toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

export function normalizeAdminPath(pathname: string) {
  const raw = String(pathname || "").trim();
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  return raw;
}

export function sanitizeAdminNextPath(input: string | null | undefined) {
  const value = normalizeAdminPath(String(input || "").trim() || "/overview");
  if (value.startsWith(ADMIN_INTERNAL_PREFIX)) return "/overview";
  return value;
}

export function getAdminPublicPaths() {
  return ["/sign-in", "/forgot-staff-id"];
}

export function isAdminPublicPath(pathname: string) {
  const path = normalizeAdminPath(pathname);
  return path === "/sign-in" || path.startsWith("/forgot-staff-id");
}

export function isAdminInternalPath(pathname: string) {
  const path = normalizeAdminPath(pathname);
  return path === ADMIN_INTERNAL_PREFIX || path.startsWith(`${ADMIN_INTERNAL_PREFIX}/`);
}

export function toAdminInternalPath(pathname: string) {
  const path = normalizeAdminPath(pathname);
  if (isAdminInternalPath(path)) return path;
  return path === "/" ? ADMIN_INTERNAL_PREFIX : `${ADMIN_INTERNAL_PREFIX}${path}`;
}

export function fromAdminInternalPath(pathname: string) {
  const path = normalizeAdminPath(pathname);
  if (!isAdminInternalPath(path)) return path;
  const visible = path.slice(ADMIN_INTERNAL_PREFIX.length) || "/";
  return visible.startsWith("/") ? visible : `/${visible}`;
}

function productionAdminHosts() {
  const configured = [
    ...splitEnvList("ADMIN_PRODUCTION_HOSTS"),
    normalizeHost(env("ADMIN_BASE_URL")),
    "admin.cavbot.io",
  ].filter(Boolean);
  return Array.from(new Set(configured));
}

function previewSuffixes() {
  return Array.from(new Set([...DEFAULT_PREVIEW_SUFFIXES, ...splitEnvList("ADMIN_PREVIEW_HOST_SUFFIXES")]));
}

export function getAdminAllowedHosts() {
  const configured = splitEnvList("ADMIN_ALLOWED_HOSTS");
  const devHosts = process.env.NODE_ENV === "production" ? [] : DEV_DEFAULT_ADMIN_HOSTS;
  const hosts = [...configured, ...productionAdminHosts(), ...devHosts];

  return Array.from(new Set(hosts.map((value) => normalizeHost(value)).filter(Boolean)));
}

export function isAdminHost(host: string) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;

  if (
    process.env.NODE_ENV !== "production"
    && /^admin\.(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalizedHost)
  ) {
    return true;
  }

  if (getAdminAllowedHosts().includes(normalizedHost)) return true;
  return previewSuffixes().some((suffix) => normalizedHost.endsWith(suffix));
}

export function getAdminBaseUrl() {
  const explicit = env("ADMIN_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  if (process.env.NODE_ENV !== "production") {
    return "http://admin.localhost:3000";
  }

  return "https://admin.cavbot.io";
}

export function buildAdminUrl(pathname: string) {
  const base = getAdminBaseUrl();
  return new URL(normalizeAdminPath(pathname), `${base}/`).toString();
}
