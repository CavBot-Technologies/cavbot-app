import { USERNAME_MAX, isBasicUsername, normalizeUsername } from "@/lib/username";

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function usernameFromUrlPath(pathname: string): string {
  const parts = String(pathname || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) return "";
  if (String(parts[0] || "").toLowerCase() === "u") {
    return parts[1] || "";
  }
  return parts[parts.length - 1] || "";
}

export function extractUsernameCandidate(raw: unknown): string {
  const value = s(raw);
  if (!value) return "";

  let candidate = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      candidate = usernameFromUrlPath(parsed.pathname);
    } catch {
      return "";
    }
  }

  const normalized = normalizeUsername(candidate).replace(/^@+/, "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.slice(0, USERNAME_MAX);
}

export function normalizeUsernameLookupQuery(raw: unknown): string {
  const candidate = extractUsernameCandidate(raw);
  if (!candidate) return "";
  if (!/^[a-z0-9_]+$/.test(candidate)) return "";
  return candidate;
}

export function normalizeUsernameExact(raw: unknown): string {
  const candidate = normalizeUsernameLookupQuery(raw);
  if (!candidate) return "";
  return isBasicUsername(candidate) ? candidate : "";
}
