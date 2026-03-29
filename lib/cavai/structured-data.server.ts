import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  asRecord,
  asRecordArray,
  dedupeFindings,
  deriveDetectedAt,
  findFirstRecord,
  normalizeOrigin,
  normalizePath,
  readString,
  resolveSiteProfile,
  routeMetadataFromInput,
  sha256Hex,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

type JsonLdScriptEntry = {
  selector: string;
  text: string;
};

type ParsedJsonLdNode = {
  raw: Record<string, unknown>;
  types: string[];
  id: string | null;
  selector: string;
};

type StructuredDataSnapshot = {
  scripts: JsonLdScriptEntry[];
  headMeta: {
    canonical: string | null;
    ogSiteName: string | null;
    ogTitle: string | null;
    ogUrl: string | null;
    ogImage: string | null;
  };
  faviconMeta: {
    hasManifest: boolean | null;
    themeColor: string | null;
  };
  identityConfig: {
    source: string | null;
    personName: string | null;
    orgName: string | null;
    logoUrl: string | null;
    sameAs: string[];
  };
};

const STRUCTURED_DATA_CODES = new Set([
  "invalid_json_ld",
  "missing_structured_data",
  "missing_website_schema",
  "missing_organization_schema",
  "missing_person_schema",
  "duplicate_json_ld_ids",
  "missing_softwareapp_fields",
  "missing_canonical",
  "social_tags",
  "missing_manifest",
  "missing_theme_color",
]);

function canonicalJson(input: unknown): string {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map((row) => walk(row));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = walk((value as Record<string, unknown>)[key]);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(walk(input));
}

function normalizeTypeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  const one = String(value || "").trim();
  return one ? [one] : [];
}

function flattenJsonLdNodes(value: unknown): Record<string, unknown>[] {
  const row = asRecord(value);
  if (!row) return [];
  const graphRows = Array.isArray(row["@graph"]) ? asRecordArray(row["@graph"]) : [];
  if (graphRows.length) return graphRows;
  return [row];
}

function extractJsonLdScripts(routeMetadata: Record<string, unknown> | null): JsonLdScriptEntry[] {
  if (!routeMetadata) return [];
  const structuredData =
    findFirstRecord(routeMetadata, ["structuredData", "structured_data", "jsonLd", "jsonld"]) ||
    findFirstRecord(asRecord(routeMetadata.seo), ["structuredData", "jsonLd", "jsonld"]);

  const scriptsRaw =
    (Array.isArray(structuredData?.scripts) ? structuredData?.scripts : null) ||
    (Array.isArray(structuredData?.blocks) ? structuredData?.blocks : null) ||
    (Array.isArray(structuredData?.jsonLdBlocks) ? structuredData?.jsonLdBlocks : null) ||
    [];

  const out: JsonLdScriptEntry[] = [];
  for (let i = 0; i < scriptsRaw.length; i++) {
    const row = asRecord(scriptsRaw[i]);
    if (!row) continue;
    const text = readString(row.text, 40_000) || readString(row.json, 40_000) || readString(row.raw, 40_000);
    if (!text) continue;
    const selector =
      readString(row.selector, 240) ||
      `script[type="application/ld+json"]:nth-of-type(${i + 1})`;
    out.push({ selector, text });
  }

  if (out.length) return out;

  const directRaw = Array.isArray(structuredData?.rawScripts) ? structuredData?.rawScripts : [];
  for (let i = 0; i < directRaw.length; i++) {
    const text = readString(directRaw[i], 40_000);
    if (!text) continue;
    out.push({
      selector: `script[type="application/ld+json"]:nth-of-type(${i + 1})`,
      text,
    });
  }

  return out;
}

function normalizeHeadMeta(routeMetadata: Record<string, unknown> | null) {
  const headMeta =
    findFirstRecord(routeMetadata, ["headMeta", "head", "meta"]) ||
    findFirstRecord(asRecord(routeMetadata?.seo), ["headMeta", "head", "meta"]);

  return {
    canonical: readString(headMeta?.canonical, 1200),
    ogSiteName: readString(headMeta?.ogSiteName, 240),
    ogTitle: readString(headMeta?.ogTitle, 320),
    ogUrl: readString(headMeta?.ogUrl, 1200),
    ogImage: readString(headMeta?.ogImage, 1200),
  };
}

function normalizeFaviconMeta(routeMetadata: Record<string, unknown> | null) {
  const favicon =
    findFirstRecord(routeMetadata, ["favicon", "iconMeta"]) ||
    findFirstRecord(asRecord(routeMetadata?.seo), ["favicon"]);

  return {
    hasManifest: typeof favicon?.hasManifest === "boolean" ? favicon.hasManifest : null,
    themeColor: readString(favicon?.themeColor, 80),
  };
}

function normalizeIdentityConfig(routeMetadata: Record<string, unknown> | null) {
  const identity =
    findFirstRecord(routeMetadata, ["siteIdentity", "identity", "identityConfig"]) ||
    findFirstRecord(asRecord(routeMetadata?.seo), ["siteIdentity", "identity"]);
  if (!identity) {
    return {
      source: null,
      personName: null,
      orgName: null,
      logoUrl: null,
      sameAs: [] as string[],
    };
  }

  const sameAs = Array.isArray(identity.sameAs)
    ? identity.sameAs
        .map((value) => readString(value, 1200))
        .filter((value): value is string => !!value)
        .slice(0, 25)
    : [];

  return {
    source: readString(identity.source, 80),
    personName: readString(identity.personName, 160) || readString(identity.name, 160),
    orgName: readString(identity.orgName, 160) || readString(identity.organizationName, 160),
    logoUrl: readString(identity.logoUrl, 1200),
    sameAs,
  };
}

function readSnapshot(input: NormalizedScanInputV1): StructuredDataSnapshot {
  const routeMetadata = routeMetadataFromInput(input);
  return {
    scripts: extractJsonLdScripts(routeMetadata),
    headMeta: normalizeHeadMeta(routeMetadata),
    faviconMeta: normalizeFaviconMeta(routeMetadata),
    identityConfig: normalizeIdentityConfig(routeMetadata),
  };
}

function collectKeywordHints(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  const keywords = findFirstRecord(routeMetadata, ["keywords", "keywordSignals"]);
  const candidates = Array.isArray(keywords?.candidates) ? keywords?.candidates : [];
  return candidates
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => !!row)
    .map((row) => readString(row.term, 80) || readString(row.keyword, 80))
    .filter((row): row is string => !!row)
    .slice(0, 40);
}

function buildRecipe(params: {
  profile: ReturnType<typeof resolveSiteProfile>["profile"];
  origin: string;
  identity: StructuredDataSnapshot["identityConfig"];
}) {
  const origin = params.origin;
  const personName = params.identity.personName || "[PERSON_NAME_PLACEHOLDER]";
  const orgName = params.identity.orgName || "[ORGANIZATION_NAME_PLACEHOLDER]";
  const logo = params.identity.logoUrl || "[LOGO_URL_PLACEHOLDER]";
  const sameAs = params.identity.sameAs.length ? params.identity.sameAs : ["[SAME_AS_PROFILE_URL]"];

  const websiteNode = {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    url: `${origin}/`,
    name: orgName,
    publisher: { "@id": `${origin}/#organization` },
  };

  const organizationNode = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: orgName,
    url: `${origin}/`,
    logo,
  };

  const personNode = {
    "@type": "Person",
    "@id": `${origin}/#person`,
    name: personName,
    url: `${origin}/`,
    worksFor: { "@id": `${origin}/#organization` },
    sameAs,
  };

  const graph: Record<string, unknown>[] = [];
  if (params.profile === "personal") {
    graph.push(personNode, organizationNode, websiteNode);
  } else if (params.profile === "company") {
    graph.push(organizationNode, websiteNode);
  } else if (params.profile === "software") {
    graph.push(organizationNode, websiteNode);
  } else if (params.profile === "ecommerce") {
    graph.push(organizationNode, websiteNode);
  } else if (params.profile === "content") {
    graph.push(organizationNode, websiteNode);
  } else {
    graph.push(organizationNode, websiteNode);
  }

  const payload = {
    "@context": "https://schema.org",
    "@graph": graph,
  };

  return JSON.stringify(payload, null, 2);
}

function hasType(types: Set<string>, expected: string[]) {
  const norm = expected.map((item) => String(item).toLowerCase());
  for (const type of types) {
    const row = String(type).toLowerCase();
    if (norm.includes(row)) return true;
  }
  return false;
}

function derivePagePath(input: NormalizedScanInputV1) {
  const fromFindings = input.findings
    .map((row) => normalizePath(row.pagePath))
    .filter(Boolean)
    .sort();
  if (fromFindings.length) return fromFindings[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) return normalizePath(input.pagesSelected[0]);
  return "/";
}

export async function augmentStructuredDataFindings(params: {
  input: NormalizedScanInputV1;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !STRUCTURED_DATA_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;
  const detectedAt = deriveDetectedAt(input.findings);
  const pagePath = derivePagePath(input);

  const snapshot = readSnapshot(input);
  const findings: CavAiFindingV1[] = [];

  const parsedNodes: ParsedJsonLdNode[] = [];
  const parseErrors: Array<{ selector: string; message: string }> = [];

  for (const script of snapshot.scripts) {
    try {
      const parsed = JSON.parse(script.text) as unknown;
      const nodes = flattenJsonLdNodes(parsed);
      for (const node of nodes) {
        const types = normalizeTypeList(node["@type"]);
        const id = readString(node["@id"], 900);
        parsedNodes.push({ raw: node, types, id, selector: script.selector });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "JSON parse failed";
      parseErrors.push({ selector: script.selector, message: message.slice(0, 220) });
    }
  }

  for (let i = 0; i < parseErrors.length; i++) {
    const row = parseErrors[i];
    findings.push({
      id: stableFindingId("invalid_json_ld", origin, pagePath, `${i + 1}:${row.selector}`),
      code: "invalid_json_ld",
      pillar: "seo",
      severity: "high",
      evidence: [
        {
          type: "dom",
          selector: row.selector,
          snippet: `JSON-LD parse failed: ${row.message}`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const types = new Set<string>();
  for (const node of parsedNodes) {
    for (const type of node.types) {
      const normalized = String(type || "").trim();
      if (!normalized) continue;
      types.add(normalized);
    }
  }

  const idMap = new Map<string, string>();
  const duplicateIds = new Set<string>();
  for (const node of parsedNodes) {
    if (!node.id) continue;
    const canonical = canonicalJson(node.raw);
    const existing = idMap.get(node.id);
    if (!existing) {
      idMap.set(node.id, canonical);
      continue;
    }
    if (existing !== canonical) {
      duplicateIds.add(node.id);
    }
  }

  for (const duplicate of Array.from(duplicateIds).sort()) {
    findings.push({
      id: stableFindingId("duplicate_json_ld_ids", origin, pagePath, duplicate),
      code: "duplicate_json_ld_ids",
      pillar: "seo",
      severity: "high",
      evidence: [
        {
          type: "dom",
          selector: "script[type=\"application/ld+json\"]",
          snippet: `Conflicting JSON-LD @id detected: ${duplicate}`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const profile = resolveSiteProfile(input, {
    schemaTypes: new Set(Array.from(types).map((value) => value.toLowerCase())),
    pathHints: input.pagesSelected,
    keywordHints: collectKeywordHints(input),
  });

  const recipe = buildRecipe({
    profile: profile.profile,
    origin,
    identity: snapshot.identityConfig,
  });

  if (!parsedNodes.length) {
    findings.push({
      id: stableFindingId("missing_structured_data", origin, pagePath),
      code: "missing_structured_data",
      pillar: "seo",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "script[type=\"application/ld+json\"]",
          snippet: "No JSON-LD script blocks detected on this page.",
        },
        {
          type: "log",
          level: "info",
          fingerprint: "structured_data_profile",
          message: `${profile.profile} (${profile.confidence}) — ${profile.reason}`,
        },
        {
          type: "log",
          level: "info",
          fingerprint: "structured_data_recipe",
          message: recipe.slice(0, 1200),
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const hasWebsite = hasType(types, ["WebSite"]);
  const hasOrganization = hasType(types, ["Organization", "LocalBusiness", "Corporation"]);
  const hasPerson = hasType(types, ["Person"]);

  const requirePerson = profile.profile === "personal";

  if (!hasWebsite) {
    findings.push({
      id: stableFindingId("missing_website_schema", origin, pagePath),
      code: "missing_website_schema",
      pillar: "seo",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "script[type=\"application/ld+json\"]",
          snippet: "No WebSite node found in JSON-LD graph.",
        },
        {
          type: "log",
          level: "info",
          fingerprint: "structured_data_recipe",
          message: recipe.slice(0, 1200),
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (!hasOrganization) {
    findings.push({
      id: stableFindingId("missing_organization_schema", origin, pagePath),
      code: "missing_organization_schema",
      pillar: "seo",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "script[type=\"application/ld+json\"]",
          snippet: "No Organization node found in JSON-LD graph.",
        },
        {
          type: "log",
          level: "info",
          fingerprint: "structured_data_profile",
          message: `${profile.profile} (${profile.confidence}) — ${profile.reason}`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (requirePerson && !hasPerson) {
    const hasConfiguredIdentity =
      !!snapshot.identityConfig.source &&
      (!!snapshot.identityConfig.personName || !!snapshot.identityConfig.orgName);
    findings.push({
      id: stableFindingId("missing_person_schema", origin, pagePath),
      code: "missing_person_schema",
      pillar: "seo",
      severity: hasConfiguredIdentity ? "medium" : "note",
      evidence: [
        {
          type: "dom",
          selector: "script[type=\"application/ld+json\"]",
          snippet: "Personal profile requires a Person node in JSON-LD.",
        },
        {
          type: "log",
          level: hasConfiguredIdentity ? "info" : "warn",
          fingerprint: "site_identity_config",
          message: hasConfiguredIdentity
            ? "Identity config exists in authenticated settings, but Person schema is missing."
            : "Identity config missing in authenticated settings; insufficient data for Person fields.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (profile.profile === "software") {
    const hasSoftwareApp = hasType(types, ["SoftwareApplication"]);
    const identityConfig = snapshot.identityConfig;
    const hasSoftwarePrereqs = !!identityConfig.orgName && !!identityConfig.logoUrl;
    if (!hasSoftwareApp && !hasSoftwarePrereqs) {
      findings.push({
        id: stableFindingId("missing_softwareapp_fields", origin, pagePath),
        code: "missing_softwareapp_fields",
        pillar: "seo",
        severity: "note",
        evidence: [
          {
            type: "log",
            level: "info",
            fingerprint: "software_schema_config",
            message:
              "SoftwareApplication schema skipped: required authenticated Site Identity fields are incomplete.",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  if (!snapshot.headMeta.canonical) {
    findings.push({
      id: stableFindingId("missing_canonical", origin, pagePath),
      code: "missing_canonical",
      pillar: "seo",
      severity: "medium",
      evidence: [
        {
          type: "dom",
          selector: "link[rel=\"canonical\"]",
          snippet: "Missing canonical link tag in <head>.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const missingOg =
    !snapshot.headMeta.ogSiteName ||
    !snapshot.headMeta.ogTitle ||
    !snapshot.headMeta.ogUrl ||
    !snapshot.headMeta.ogImage;
  if (missingOg) {
    findings.push({
      id: stableFindingId("social_tags", origin, pagePath),
      code: "social_tags",
      pillar: "engagement",
      severity: "low",
      evidence: [
        {
          type: "dom",
          selector: "meta[property^=\"og:\"]",
          snippet:
            "Missing one or more Open Graph tags (og:site_name, og:title, og:url, og:image).",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (snapshot.faviconMeta.hasManifest === false) {
    findings.push({
      id: stableFindingId("missing_manifest", origin, pagePath),
      code: "missing_manifest",
      pillar: "seo",
      severity: "low",
      evidence: [
        {
          type: "dom",
          selector: "link[rel=\"manifest\"]",
          snippet: "No web manifest link detected in <head>.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  if (!snapshot.faviconMeta.themeColor) {
    findings.push({
      id: stableFindingId("missing_theme_color", origin, pagePath),
      code: "missing_theme_color",
      pillar: "ux",
      severity: "note",
      evidence: [
        {
          type: "dom",
          selector: "meta[name=\"theme-color\"]",
          snippet: "Missing theme-color meta tag.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  return dedupeFindings(passthroughFindings.concat(findings)).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
    return a.id.localeCompare(b.id);
  });
}

export function deterministicStructuredDataRecipeHash(input: {
  origin: string;
  profile: string;
  source: string;
}) {
  return sha256Hex(`${input.origin}|${input.profile}|${input.source}`).slice(0, 16);
}
