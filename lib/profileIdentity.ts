import { normalizeUsername } from "@/lib/username";

function s(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeProviderDisplayName(value: unknown, max = 64) {
  const normalized = s(value).slice(0, max);
  return normalized || null;
}

export function hasMeaningfulProfileName(value: unknown) {
  return s(value).length > 0;
}

export function buildPersonalWorkspaceName(displayName: unknown) {
  const base = s(displayName) || "CavBot User";
  return `${base.slice(0, 32)} Account`;
}

export function toWorkspaceSlug(value: unknown) {
  const normalized = s(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "account";
}

export function derivePersonalWorkspaceNameFromEmail(email: unknown) {
  const domain = s(email).toLowerCase().split("@")[1] || "";
  const base = (domain.split(".")[0] || "CavBot").trim();
  const nice = base ? base.slice(0, 1).toUpperCase() + base.slice(1) : "CavBot";
  return `${nice} Account`;
}

export function buildPreferredPersonalWorkspaceSlug(input: {
  username?: unknown;
  email?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}) {
  const username = normalizeUsername(s(input.username).replace(/^@+/, ""));
  if (username) return username;
  const emailLocal = s(input.email).toLowerCase().split("@")[0] || "";
  if (emailLocal) return toWorkspaceSlug(emailLocal);
  const label = s(input.fullName) || s(input.displayName);
  if (label) return toWorkspaceSlug(label);
  return "account";
}

export function buildAutoWorkspaceSlugCandidates(input: {
  email?: unknown;
  username?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}) {
  const values = new Set<string>();
  const push = (value: unknown) => {
    const raw = s(value);
    if (!raw) return;
    values.add(raw.toLowerCase());
    values.add(toWorkspaceSlug(raw));
  };

  const emailLocal = s(input.email).toLowerCase().split("@")[0] || "";
  const derivedAccountName = derivePersonalWorkspaceNameFromEmail(input.email);

  push(input.username);
  push(input.displayName);
  push(input.fullName);
  push(emailLocal);
  push(buildPersonalWorkspaceName(input.displayName));
  push(buildPersonalWorkspaceName(input.fullName));
  push(buildPersonalWorkspaceName(input.username));
  push(buildPersonalWorkspaceName(emailLocal));
  push(derivedAccountName);

  return values;
}
