import { createHash } from "crypto";
import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";

export type SiteProfileV1 =
  | "personal"
  | "company"
  | "ecommerce"
  | "software"
  | "content"
  | "unknown";

export type SiteProfileResolutionV1 = {
  profile: SiteProfileV1;
  confidence: "high" | "medium" | "low";
  reason: string;
  source: "config" | "heuristic" | "unknown";
};

export function normalizeOrigin(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function normalizePath(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const u = new URL(value);
      return `${u.pathname || "/"}${u.search || ""}` || "/";
    } catch {
      return "/";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

export function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function stableFindingId(code: string, origin: string, pagePath: string, salt?: string) {
  const hash = sha256Hex(
    `${String(code || "").toLowerCase()}|${String(origin || "")}|${String(pagePath || "")}|${String(
      salt || ""
    )}`
  ).slice(0, 16);
  return `finding_${String(code || "unknown").toLowerCase()}_${hash}`;
}

export function deriveDetectedAt(findings: CavAiFindingV1[]) {
  const detectedAt = findings
    .map((item) => {
      const value = String(item.detectedAt || "").trim();
      if (!value) return "";
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) return "";
      return new Date(ms).toISOString();
    })
    .filter(Boolean)
    .sort();
  return detectedAt[0] || new Date(0).toISOString();
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => !!row);
}

export function readString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim().slice(0, maxLen);
  return out || null;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function readNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function routeMetadataFromInput(input: NormalizedScanInputV1) {
  const routeMetadata = input.context?.routeMetadata;
  if (!routeMetadata || typeof routeMetadata !== "object" || Array.isArray(routeMetadata)) {
    return null;
  }
  return routeMetadata as Record<string, unknown>;
}

export function findFirstRecord(root: Record<string, unknown> | null, keys: string[]) {
  if (!root) return null;
  for (const key of keys) {
    const row = asRecord(root[key]);
    if (row) return row;
  }
  return null;
}

export function findFirstString(root: Record<string, unknown> | null, keys: string[]) {
  if (!root) return null;
  for (const key of keys) {
    const value = readString(root[key], 280);
    if (value) return value;
  }
  return null;
}

export function resolveSiteProfile(input: NormalizedScanInputV1, signals?: {
  schemaTypes?: Set<string>;
  pathHints?: string[];
  keywordHints?: string[];
}): SiteProfileResolutionV1 {
  const traits = asRecord(input.context?.traits);
  const traitProfile =
    readString(traits?.siteProfile, 40) ||
    readString(traits?.site_profile, 40) ||
    readString(traits?.profile, 40) ||
    readString(traits?.businessType, 40);
  const normalizedTrait = String(traitProfile || "").toLowerCase();
  if (
    normalizedTrait === "personal" ||
    normalizedTrait === "company" ||
    normalizedTrait === "ecommerce" ||
    normalizedTrait === "software" ||
    normalizedTrait === "content"
  ) {
    return {
      profile: normalizedTrait as SiteProfileV1,
      confidence: "high",
      reason: `Using explicit profile from authenticated context traits (${normalizedTrait}).`,
      source: "config",
    };
  }

  const schemaTypes = new Set(
    Array.from(signals?.schemaTypes || new Set<string>()).map((value) => String(value).toLowerCase())
  );
  const pathHints = (signals?.pathHints || []).map((value) => String(value).toLowerCase());
  const keywordHints = (signals?.keywordHints || []).map((value) => String(value).toLowerCase());

  if (schemaTypes.has("softwareapplication") || pathHints.some((path) => /\/docs|\/api|\/app|\/dashboard/.test(path))) {
    return {
      profile: "software",
      confidence: "medium",
      reason: "Heuristic profile from software schema/path signals.",
      source: "heuristic",
    };
  }

  if (
    schemaTypes.has("product") ||
    schemaTypes.has("offer") ||
    pathHints.some((path) => /\/shop|\/product|\/cart|\/checkout/.test(path)) ||
    keywordHints.some((token) => /shipping|returns|checkout|refund/.test(token))
  ) {
    return {
      profile: "ecommerce",
      confidence: "medium",
      reason: "Heuristic profile from product/checkout signals.",
      source: "heuristic",
    };
  }

  if (
    schemaTypes.has("article") ||
    schemaTypes.has("blogposting") ||
    schemaTypes.has("newsarticle") ||
    pathHints.some((path) => /\/blog|\/news|\/articles/.test(path))
  ) {
    return {
      profile: "content",
      confidence: "low",
      reason: "Heuristic profile from editorial content signals.",
      source: "heuristic",
    };
  }

  if (schemaTypes.has("person") && !schemaTypes.has("organization")) {
    return {
      profile: "personal",
      confidence: "low",
      reason: "Heuristic profile from standalone Person schema.",
      source: "heuristic",
    };
  }

  if (schemaTypes.has("organization") || schemaTypes.has("localbusiness")) {
    return {
      profile: "company",
      confidence: "low",
      reason: "Heuristic profile from organization schema.",
      source: "heuristic",
    };
  }

  return {
    profile: "unknown",
    confidence: "low",
    reason: "Insufficient profile signals in this run.",
    source: "unknown",
  };
}

export function dedupeFindings(findings: CavAiFindingV1[]): CavAiFindingV1[] {
  const seen = new Set<string>();
  const out: CavAiFindingV1[] = [];
  for (const finding of findings) {
    const key = `${finding.id}|${finding.code}|${finding.pagePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
