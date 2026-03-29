import { resolveTxt as dnsResolveTxt } from "node:dns/promises";
import type { CavAiFindingV1, NormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import {
  asRecord,
  asRecordArray,
  dedupeFindings,
  deriveDetectedAt,
  normalizeOrigin,
  normalizePath,
  readBoolean,
  readString,
  resolveSiteProfile,
  routeMetadataFromInput,
  stableFindingId,
} from "@/lib/cavai/augment.utils";

type ResolveTxtFn = (hostname: string) => Promise<string[][]>;

type TrustLink = {
  href: string;
  text: string;
  inFooter: boolean;
};

const TRUST_CODES = new Set([
  "missing_privacy_policy",
  "missing_terms",
  "missing_contact_page",
  "missing_about_page",
  "missing_cookie_policy",
  "missing_accessibility_statement",
  "missing_shipping_policy",
  "missing_returns_policy",
  "missing_refund_policy",
  "policy_not_linked_in_footer",
  "email_dns_not_checked",
  "missing_spf_record",
  "missing_dmarc_record",
]);

function derivePagePath(input: NormalizedScanInputV1) {
  const fromFindings = input.findings
    .map((item) => normalizePath(item.pagePath))
    .filter(Boolean)
    .sort();
  if (fromFindings.length) return fromFindings[0];
  if (Array.isArray(input.pagesSelected) && input.pagesSelected.length) return normalizePath(input.pagesSelected[0]);
  return "/";
}

function readTrustSnapshot(input: NormalizedScanInputV1) {
  const routeMetadata = routeMetadataFromInput(input);
  if (!routeMetadata) return null;
  return (
    asRecord(routeMetadata.trustPages) ||
    asRecord(routeMetadata.trust) ||
    asRecord(routeMetadata.policies) ||
    null
  );
}

function readLinks(snapshot: Record<string, unknown> | null): TrustLink[] {
  if (!snapshot) return [];
  const linksRaw = Array.isArray(snapshot.links) ? snapshot.links : [];
  const out: TrustLink[] = [];
  for (const row of asRecordArray(linksRaw)) {
    const href = readString(row.href, 1200) || "";
    const text = readString(row.text, 240) || "";
    const inFooter = readBoolean(row.inFooter) === true;
    if (!href && !text) continue;
    out.push({ href: href.toLowerCase(), text: text.toLowerCase(), inFooter });
  }
  return out;
}

function hasPolicyLink(links: TrustLink[], patterns: readonly RegExp[]) {
  return links.some((row) => {
    const haystack = `${row.href} ${row.text}`;
    return patterns.some((pattern) => pattern.test(haystack));
  });
}

function hasFooterPolicyLink(links: TrustLink[], patterns: readonly RegExp[]) {
  return links.some((row) => {
    if (!row.inFooter) return false;
    const haystack = `${row.href} ${row.text}`;
    return patterns.some((pattern) => pattern.test(haystack));
  });
}

async function checkEmailDns(origin: string, resolver: ResolveTxtFn): Promise<
  | { checked: true; hasSpf: boolean; hasDmarc: boolean }
  | { checked: false; reason: string }
> {
  try {
    const hostname = new URL(origin).hostname;
    const txt = await resolver(hostname);
    const dmarcTxt = await resolver(`_dmarc.${hostname}`);

    const txtRows = txt
      .map((row) => row.join("").toLowerCase())
      .filter(Boolean);
    const dmarcRows = dmarcTxt
      .map((row) => row.join("").toLowerCase())
      .filter(Boolean);

    const hasSpf = txtRows.some((row) => row.includes("v=spf1"));
    const hasDmarc = dmarcRows.some((row) => row.includes("v=dmarc1"));
    return { checked: true, hasSpf, hasDmarc };
  } catch (error) {
    const message = error instanceof Error ? error.message : "dns_lookup_failed";
    return { checked: false, reason: message.slice(0, 160) };
  }
}

export async function augmentTrustPageFindings(params: {
  input: NormalizedScanInputV1;
  resolveTxt?: ResolveTxtFn;
}): Promise<CavAiFindingV1[]> {
  const input = params.input;
  const passthroughFindings = input.findings.filter(
    (finding) => !TRUST_CODES.has(String(finding.code || "").trim().toLowerCase())
  );

  const snapshot = readTrustSnapshot(input);
  if (!snapshot) return passthroughFindings;

  const origin = normalizeOrigin(input.origin);
  if (!origin) return passthroughFindings;

  const pagePath = derivePagePath(input);
  const detectedAt = deriveDetectedAt(input.findings);
  const links = readLinks(snapshot);

  const findings: CavAiFindingV1[] = [];

  const required = [
    {
      code: "missing_privacy_policy",
      selector: "a[href*='privacy' i]",
      patterns: [/privacy/],
      severity: "high" as const,
      message: "Privacy Policy link not detected.",
    },
    {
      code: "missing_terms",
      selector: "a[href*='terms' i],a[href*='tos' i]",
      patterns: [/terms/, /tos/, /terms-of-service/],
      severity: "high" as const,
      message: "Terms of Service link not detected.",
    },
    {
      code: "missing_contact_page",
      selector: "a[href*='contact' i],a[href^='mailto:']",
      patterns: [/contact/, /^mailto:/],
      severity: "medium" as const,
      message: "Contact page/link not detected.",
    },
    {
      code: "missing_about_page",
      selector: "a[href*='about' i]",
      patterns: [/about/],
      severity: "low" as const,
      message: "About page link not detected.",
    },
    {
      code: "missing_cookie_policy",
      selector: "a[href*='cookie' i]",
      patterns: [/cookie/],
      severity: "note" as const,
      message: "Cookie policy link not detected.",
    },
    {
      code: "missing_accessibility_statement",
      selector: "a[href*='accessibility' i],a[href*='a11y' i]",
      patterns: [/accessibility/, /a11y/],
      severity: "note" as const,
      message: "Accessibility statement link not detected.",
    },
  ];

  for (const row of required) {
    const exists = hasPolicyLink(links, row.patterns);
    if (exists) continue;
    findings.push({
      id: stableFindingId(row.code, origin, pagePath),
      code: row.code,
      pillar: "ux",
      severity: row.severity,
      evidence: [
        {
          type: "dom",
          selector: row.selector,
          snippet: row.message,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const profile = resolveSiteProfile(input, {
    pathHints: input.pagesSelected,
    keywordHints: links.map((row) => row.text).slice(0, 50),
  });

  if (profile.profile === "ecommerce") {
    const ecommerceRequired = [
      {
        code: "missing_shipping_policy",
        selector: "a[href*='shipping' i]",
        patterns: [/shipping/, /delivery/],
        message: "Shipping policy link not detected.",
      },
      {
        code: "missing_returns_policy",
        selector: "a[href*='returns' i]",
        patterns: [/returns?/],
        message: "Returns policy link not detected.",
      },
      {
        code: "missing_refund_policy",
        selector: "a[href*='refund' i]",
        patterns: [/refund/],
        message: "Refund policy link not detected.",
      },
    ] as const;

    for (const row of ecommerceRequired) {
      if (hasPolicyLink(links, row.patterns)) continue;
      findings.push({
        id: stableFindingId(row.code, origin, pagePath),
        code: row.code,
        pillar: "ux",
        severity: "medium",
        evidence: [
          {
            type: "dom",
            selector: row.selector,
            snippet: row.message,
          },
          {
            type: "log",
            level: "info",
            fingerprint: "site_profile",
            message: `Profile ${profile.profile} (${profile.confidence}) requires this trust page.`,
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }
  }

  const footerCoveragePatterns = [
    /privacy/,
    /terms/,
    /contact/,
    /about/,
  ];
  const hasFooterCoverage = hasFooterPolicyLink(links, footerCoveragePatterns);
  const hasAnyCoverage = hasPolicyLink(links, footerCoveragePatterns);

  if (hasAnyCoverage && !hasFooterCoverage) {
    findings.push({
      id: stableFindingId("policy_not_linked_in_footer", origin, pagePath),
      code: "policy_not_linked_in_footer",
      pillar: "ux",
      severity: "low",
      evidence: [
        {
          type: "dom",
          selector: "footer a[href]",
          snippet: "Trust/policy pages exist but are not discoverable in footer navigation.",
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  }

  const dnsStatus = await checkEmailDns(origin, params.resolveTxt || dnsResolveTxt);
  if (!dnsStatus.checked) {
    findings.push({
      id: stableFindingId("email_dns_not_checked", origin, pagePath),
      code: "email_dns_not_checked",
      pillar: "reliability",
      severity: "note",
      evidence: [
        {
          type: "log",
          level: "info",
          fingerprint: "email_dns",
          message: `SPF/DMARC checks not completed (${dnsStatus.reason}).`,
        },
      ],
      origin,
      pagePath,
      templateHint: null,
      detectedAt,
    });
  } else {
    if (!dnsStatus.hasSpf) {
      findings.push({
        id: stableFindingId("missing_spf_record", origin, pagePath),
        code: "missing_spf_record",
        pillar: "reliability",
        severity: "medium",
        evidence: [
          {
            type: "log",
            level: "warn",
            fingerprint: "email_dns",
            message: "SPF TXT record not found for the site domain.",
          },
        ],
        origin,
        pagePath,
        templateHint: null,
        detectedAt,
      });
    }

    if (!dnsStatus.hasDmarc) {
      findings.push({
        id: stableFindingId("missing_dmarc_record", origin, pagePath),
        code: "missing_dmarc_record",
        pillar: "reliability",
        severity: "medium",
        evidence: [
          {
            type: "log",
            level: "warn",
            fingerprint: "email_dns",
            message: "DMARC TXT record not found for the site domain.",
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
