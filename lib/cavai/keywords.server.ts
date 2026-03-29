import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  asRecord,
  asRecordArray,
  dedupeFindings,
  deriveDetectedAt,
  normalizeOrigin,
  normalizePath,
  readNumber,
  readString,
  resolveSiteProfile,
  routeMetadataFromInput,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

const KEYWORD_CODES = new Set([
  "keyword_cluster_gap",
  "keywords_insufficient_data",
  "auth_login_failure_spike",
  "signup_failure_spike",
  "auth_endpoint_error_cluster",
  "geo_distribution_shift",
]);

const PROFILE_CLUSTERS: Record<string, string[]> = {
  personal: ["portfolio", "services", "about", "contact", "projects", "testimonials"],
  company: ["solutions", "about", "contact", "pricing", "security", "support"],
  ecommerce: ["shop", "checkout", "shipping", "returns", "refund", "reviews"],
  software: ["features", "pricing", "docs", "api", "integration", "security"],
  content: ["guides", "tutorial", "resources", "newsletter", "category", "archives"],
  unknown: ["about", "contact", "services", "help"],
};

function derivePagePath(input: NormalizedScanInputV1) {
  const fromFindings = input.findings
    .map((item) => normalizePath(item.pagePath))
    .filter(Boolean)
    .sort();
  if (fromFindings.length) return fromFindings[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) return normalizePath(input.pagesSelected[0]);
  return "/";
}

function readKeywordSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return asRecord(routeMetadata.keywords) || asRecord(routeMetadata.keywordSignals) || null;
}

function readAuthSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return asRecord(routeMetadata.authFunnel) || asRecord(routeMetadata.auth) || null;
}

function readGeoSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return asRecord(routeMetadata.geoTrend) || asRecord(routeMetadata.geo) || null;
}

function normalizeKeywordCandidates(snapshot: Record<string, unknown> | null) {
  if (!snapshot) return [] as Array<{ term: string; count: number; sources: string[]; sample: string | null }>;
  const rows = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
  const normalized = asRecordArray(rows)
    .map((row) => {
      const term =
        readString(row.term, 64) ||
        readString(row.keyword, 64) ||
        null;
      if (!term) return null;
      const count = Math.max(1, Math.min(10000, Math.round(Number(row.count || row.weight || 1) || 1)));
      const sources = Array.isArray(row.sources)
        ? row.sources
            .map((value) => readString(value, 260))
            .filter((value): value is string => !!value)
            .slice(0, 6)
        : [];
      const sample = readString(row.sample, 200) || null;
      return {
        term: term.toLowerCase(),
        count,
        sources,
        sample,
      };
    })
    .filter((row): row is { term: string; count: number; sources: string[]; sample: string | null } => !!row);

  const bucket = new Map<string, { term: string; count: number; sources: Set<string>; sample: string | null }>();
  for (const row of normalized) {
    const key = row.term;
    const existing = bucket.get(key);
    if (!existing) {
      bucket.set(key, {
        term: row.term,
        count: row.count,
        sources: new Set(row.sources),
        sample: row.sample,
      });
      continue;
    }
    existing.count += row.count;
    for (const source of row.sources) existing.sources.add(source);
    if (!existing.sample && row.sample) existing.sample = row.sample;
  }

  return Array.from(bucket.values())
    .map((row) => ({
      term: row.term,
      count: row.count,
      sources: Array.from(row.sources).sort(),
      sample: row.sample,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.term.localeCompare(b.term);
    })
    .slice(0, 40);
}

export async function augmentKeywordFindings(params: {
  input: NormalizedScanInputV1;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !KEYWORD_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;

  const pagePath = derivePagePath(input);
  const detectedAt = deriveDetectedAt(input.findings);
  const findings: CavAiFindingV1[] = [];

  const keywordSnapshot = readKeywordSnapshot(input);
  const keywordCandidates = normalizeKeywordCandidates(keywordSnapshot);

  if (!keywordCandidates.length) {
    findings.push({
      id: stableFindingId("keywords_insufficient_data", origin, pagePath),
      code: "keywords_insufficient_data",
      pillar: "seo",
      severity: "note",
      evidence: [
        {
          type: "dom",
          selector: "title,meta[name='description'],h1,h2,main",
          snippet: "Insufficient keyword signals were available in this run.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  } else {
    const profile = resolveSiteProfile(input, {
      pathHints: input.pagesSelected,
      keywordHints: keywordCandidates.map((row) => row.term),
    });

    const clusters = PROFILE_CLUSTERS[profile.profile] || PROFILE_CLUSTERS.unknown;
    const keywordText = keywordCandidates.map((row) => row.term).join(" ");

    let clusterGaps = 0;
    for (const token of clusters) {
      if (keywordText.includes(token)) continue;
      clusterGaps += 1;
      if (clusterGaps > 8) break;
      findings.push({
        id: stableFindingId("keyword_cluster_gap", origin, pagePath, token),
        code: "keyword_cluster_gap",
        pillar: "seo",
        severity: "note",
        evidence: [
          {
            type: "dom",
            selector: "title,meta[name='description'],h1,h2,nav,main",
            snippet: `Missing profile-aligned topic cluster token: ${token}`,
          },
          {
            type: "log",
            level: "info",
            fingerprint: "keyword_profile_alignment",
            message: `Profile ${profile.profile} (${profile.confidence}) suggests token cluster \"${token}\".`,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  const authSnapshot = readAuthSnapshot(input);
  if (authSnapshot) {
    const loginAttempts = readNumber(authSnapshot.loginAttempts) || 0;
    const loginFailures = readNumber(authSnapshot.loginFailures) || 0;
    const signupAttempts = readNumber(authSnapshot.signupAttempts) || 0;
    const signupFailures = readNumber(authSnapshot.signupFailures) || 0;

    const loginFailureRate = loginAttempts > 0 ? loginFailures / loginAttempts : 0;
    const signupFailureRate = signupAttempts > 0 ? signupFailures / signupAttempts : 0;

    if (loginAttempts >= 20 && loginFailureRate >= 0.2) {
      findings.push({
        id: stableFindingId("auth_login_failure_spike", origin, pagePath),
        code: "auth_login_failure_spike",
        pillar: "reliability",
        severity: loginFailureRate >= 0.35 ? "high" : "medium",
        evidence: [
          {
            type: "metric",
            name: "auth_login_failure_rate",
            value: Number((loginFailureRate * 100).toFixed(2)),
            unit: "%",
          },
          {
            type: "metric",
            name: "auth_login_attempts",
            value: loginAttempts,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    if (signupAttempts >= 20 && signupFailureRate >= 0.2) {
      findings.push({
        id: stableFindingId("signup_failure_spike", origin, pagePath),
        code: "signup_failure_spike",
        pillar: "reliability",
        severity: signupFailureRate >= 0.35 ? "high" : "medium",
        evidence: [
          {
            type: "metric",
            name: "auth_signup_failure_rate",
            value: Number((signupFailureRate * 100).toFixed(2)),
            unit: "%",
          },
          {
            type: "metric",
            name: "auth_signup_attempts",
            value: signupAttempts,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    const errorClusters = Array.isArray(authSnapshot.errorClusters)
      ? asRecordArray(authSnapshot.errorClusters)
      : [];
    const strongest = errorClusters
      .map((row) => ({
        fingerprint: readString(row.fingerprint, 120) || readString(row.code, 120) || "",
        hits: Math.max(0, Math.round(Number(row.hits || row.count || 0) || 0)),
      }))
      .filter((row) => !!row.fingerprint && row.hits > 0)
      .sort((a, b) => b.hits - a.hits)[0];

    if (strongest && strongest.hits >= 8) {
      findings.push({
        id: stableFindingId("auth_endpoint_error_cluster", origin, pagePath),
        code: "auth_endpoint_error_cluster",
        pillar: "reliability",
        severity: strongest.hits >= 20 ? "high" : "medium",
        evidence: [
          {
            type: "log",
            level: "error",
            fingerprint: strongest.fingerprint,
            message: `Auth error fingerprint cluster observed (${strongest.hits} hits).`,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  const geoSnapshot = readGeoSnapshot(input);
  if (geoSnapshot) {
    const countries = Array.isArray(geoSnapshot.countries)
      ? asRecordArray(geoSnapshot.countries)
      : [];
    const top = countries
      .map((row) => ({
        country: readString(row.country, 80) || readString(row.countryCode, 80) || "",
        share: readNumber(row.sharePct) || readNumber(row.share) || 0,
      }))
      .filter((row) => !!row.country)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3);

    const topShare = top.reduce((sum, row) => sum + row.share, 0);
    if (top.length >= 1 && topShare >= 80) {
      findings.push({
        id: stableFindingId("geo_distribution_shift", origin, pagePath),
        code: "geo_distribution_shift",
        pillar: "engagement",
        severity: "note",
        evidence: [
          {
            type: "metric",
            name: "geo_top_country_share_pct",
            value: Number(topShare.toFixed(2)),
            unit: "%",
          },
          {
            type: "log",
            level: "info",
            fingerprint: "geo_distribution",
            message: `Top countries: ${top.map((row) => `${row.country}:${row.share.toFixed(1)}%`).join(", ")}`,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  return dedupeFindings(passthroughFindings.concat(findings)).sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.pagePath !== b.pagePath) return a.pagePath.localeCompare(b.pagePath);
    return a.id.localeCompare(b.id);
  });
}
