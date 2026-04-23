import { resolvePlanIdFromTier } from "@/lib/plans";
import { normalizeUsername } from "@/lib/username";

function s(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeProviderDisplayName(value: unknown, max = 64) {
  const normalized = s(value).slice(0, max);
  return normalized || null;
}

function lower(value: unknown) {
  return s(value).toLowerCase();
}

export const CAVBOT_FOUNDER_USERNAME = "cavbot";
export const CAVBOT_FOUNDER_DISPLAY_NAME = "CavBot Admin";

export function isCavbotFounderIdentity(input: {
  username?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}) {
  const username = lower(input.username).replace(/^@+/, "");
  const displayName = lower(input.displayName);
  const fullName = lower(input.fullName);
  const founderName = CAVBOT_FOUNDER_DISPLAY_NAME.toLowerCase();
  return username === CAVBOT_FOUNDER_USERNAME || displayName === founderName || fullName === founderName;
}

export function isCavbotFounderAccountIdentity(input: {
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}) {
  const slug = lower(input.slug).replace(/[^a-z0-9]+/g, "");
  const name = lower(input.name);
  const displayName = lower(input.displayName);
  const fullName = lower(input.fullName);
  const founderSlug = CAVBOT_FOUNDER_USERNAME.toLowerCase();
  const founderName = CAVBOT_FOUNDER_DISPLAY_NAME.toLowerCase();
  return slug === founderSlug || name === founderName || displayName === founderName || fullName === founderName;
}

export function normalizeCavbotFounderProfile<T extends {
  username?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}>(input: T) {
  const username = s(input.username) || null;
  const displayName = s(input.displayName) || null;
  const fullName = s(input.fullName) || null;

  if (!isCavbotFounderIdentity({ username, displayName, fullName })) {
    return {
      ...input,
      username,
      displayName,
      fullName,
    };
  }

  return {
    ...input,
    username: username || CAVBOT_FOUNDER_USERNAME,
    displayName: CAVBOT_FOUNDER_DISPLAY_NAME,
    fullName: CAVBOT_FOUNDER_DISPLAY_NAME,
  };
}

export function resolveAccountDisplayName(input: {
  username?: unknown;
  displayName?: unknown;
  fullName?: unknown;
  fallbackLabel?: unknown;
}) {
  const normalized = normalizeCavbotFounderProfile({
    username: input.username,
    displayName: input.displayName,
    fullName: input.fullName,
  });
  const full = s(normalized.fullName || normalized.displayName);
  if (full) return full;
  const handle = s(normalized.username || input.username).replace(/^@+/, "");
  if (handle) return `@${handle}`;
  return s(input.fallbackLabel) || "CavBot";
}

export function resolveAccountPlanLabel(input: {
  planId?: unknown;
  planTier?: unknown;
  trialActive?: unknown;
  trialDaysLeft?: unknown;
}) {
  const planId = resolvePlanIdFromTier(input.planId || input.planTier || "free");
  if (planId === "premium_plus") return "Premium+";
  if (planId === "premium") return "Premium";
  return "Free";
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
