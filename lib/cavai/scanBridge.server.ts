import "server-only";

import type { ScanFindingSeverity } from "@prisma/client";
import type { ScanReport } from "@/lib/scanner";
import { generateInsightPackFromInput } from "@/lib/cavai/pipeline.server";
import {
  CAVAI_NORMALIZED_INPUT_VERSION_V1,
  type CavAiEvidenceRef,
  type CavAiFindingV1,
  type CavAiPillar,
  type CavAiSeverity,
  type NormalizedScanInputV1,
} from "@/packages/cavai-contracts/src";

type ScanArtifactFinding = {
  pillar: string;
  severity: ScanFindingSeverity | string;
  message: string;
  evidence?: Record<string, unknown> | null;
};

type ScanArtifactSnapshot = {
  pageUrl: string;
  title: string | null;
  status: number | null;
  responseTimeMs: number | null;
  payloadBytes: number | null;
  metaJson?: Record<string, unknown> | null;
};

function asInt(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeOrigin(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("SCAN_ORIGIN_REQUIRED");
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return new URL(withProto).origin;
}

function pagePathFromUrl(input: string, fallbackOrigin: string) {
  const raw = String(input || "").trim();
  if (!raw) return "/";
  try {
    const url = new URL(raw, fallbackOrigin);
    return `${url.pathname || "/"}${url.search || ""}` || "/";
  } catch {
    return raw.startsWith("/") ? raw : "/";
  }
}

function normalizeSeverity(input: ScanFindingSeverity | string): CavAiSeverity {
  const raw = String(input || "").trim().toLowerCase();
  if (raw === "critical") return "critical";
  if (raw === "high") return "high";
  if (raw === "medium") return "medium";
  if (raw === "low") return "low";
  return "note";
}

function extractPageUrl(
  finding: ScanArtifactFinding,
  snapshotsByPath: Map<string, ScanArtifactSnapshot>,
  origin: string,
) {
  const pageUrl =
    String(finding.evidence?.pageUrl || "").trim() ||
    String(finding.evidence?.url || "").trim() ||
    "";
  if (pageUrl) return pageUrl;

  const routePath =
    String(finding.evidence?.routePath || "").trim() ||
    String(finding.evidence?.path || "").trim();
  if (routePath) {
    return `${origin}${routePath.startsWith("/") ? routePath : `/${routePath}`}`;
  }

  const fallbackSnapshot = snapshotsByPath.values().next().value as ScanArtifactSnapshot | undefined;
  return String(fallbackSnapshot?.pageUrl || `${origin}/`);
}

function deriveCode(finding: ScanArtifactFinding, pagePath: string) {
  const pillar = String(finding.pillar || "").trim().toLowerCase();
  const message = String(finding.message || "").trim().toLowerCase();
  const status = asInt(finding.evidence?.status);
  const pageUrl = String(finding.evidence?.pageUrl || "").trim().toLowerCase();
  const isApiLike = pagePath.startsWith("/api") || pageUrl.includes("/api");

  if (pillar === "seo") {
    if (message.includes("title tag is missing")) return "missing_title";
    if (message.includes("meta description")) return "missing_meta_description";
  }

  if (pillar === "a11y") {
    if (message.includes("missing alt")) return "image_missing_alt";
  }

  if (pillar === "routes") {
    if (status === 404) return "route_http_404";
    if (status != null && status >= 500) return "route_http_5xx";
    if (status != null && status >= 400) return "route_http_404";
  }

  if (pillar === "errors") {
    return isApiLike ? "api_error_cluster" : "js_error_fingerprint";
  }

  if (pillar === "ux") {
    return "slow_response";
  }

  return isApiLike ? "api_error_cluster" : "js_error_fingerprint";
}

function pillarForCode(code: string): CavAiPillar {
  if (code === "missing_title" || code === "missing_meta_description") return "seo";
  if (code === "image_missing_alt") return "accessibility";
  if (code === "slow_response") return "performance";
  return "reliability";
}

function buildEvidence(
  params: {
    code: string;
    pageUrl: string;
    pagePath: string;
    finding: ScanArtifactFinding;
    snapshot: ScanArtifactSnapshot | null;
  },
): CavAiEvidenceRef[] {
  const evidence: CavAiEvidenceRef[] = [];
  const status = asInt(params.finding.evidence?.status) ?? params.snapshot?.status ?? null;
  const responseTimeMs =
    asInt(params.finding.evidence?.responseTimeMs) ?? params.snapshot?.responseTimeMs ?? null;
  const altCount = asInt(params.finding.evidence?.count);
  const reason = String(params.finding.evidence?.reason || "").trim() || undefined;

  evidence.push({
    type: "route",
    path: params.pagePath,
    ...(status != null ? { statusCode: status } : {}),
    ...(reason ? { reason } : {}),
  });

  if (params.code === "missing_title") {
    evidence.push({
      type: "dom",
      selector: "title",
      snippet: "Missing <title> tag",
    });
  } else if (params.code === "missing_meta_description") {
    evidence.push({
      type: "dom",
      selector: 'meta[name="description"]',
      snippet: "Missing meta description",
    });
  } else if (params.code === "image_missing_alt") {
    evidence.push({
      type: "metric",
      name: "missing_alt_images",
      value: Math.max(1, altCount ?? 1),
      unit: "count",
    });
  } else if (params.code === "slow_response") {
    evidence.push({
      type: "metric",
      name: "response_time_ms",
      value: Math.max(1, responseTimeMs ?? 1),
      unit: "ms",
    });
  } else {
    evidence.push({
      type: "log",
      level: status != null && status >= 500 ? "error" : "warn",
      fingerprint: `${params.code}:${params.pagePath}`,
      message: String(params.finding.message || "").slice(0, 500),
    });
  }

  if (status != null) {
    evidence.push({
      type: "http",
      url: params.pageUrl,
      status,
      method: "GET",
    });
  }

  return evidence.slice(0, 8);
}

export function createNormalizedScanInputFromScanArtifacts(args: {
  origin: string;
  pageLimit: number;
  pagesSelected?: string[];
  report?: ScanReport | null;
  findings: ScanArtifactFinding[];
  snapshots?: ScanArtifactSnapshot[];
  jobId?: string;
  projectId?: number;
  siteId?: string;
}): NormalizedScanInputV1 {
  const origin = normalizeOrigin(args.origin);
  const snapshots = Array.isArray(args.snapshots) ? args.snapshots : [];
  const snapshotsByPath = new Map<string, ScanArtifactSnapshot>();
  for (const snapshot of snapshots) {
    const pagePath = pagePathFromUrl(snapshot.pageUrl, origin);
    snapshotsByPath.set(pagePath, snapshot);
  }

  const rawPages = Array.isArray(args.pagesSelected) && args.pagesSelected.length
    ? args.pagesSelected
    : Array.isArray(args.report?.pages)
    ? args.report.pages.map((page) => page.url)
    : snapshots.map((snapshot) => snapshot.pageUrl);
  const pagesSelected = Array.from(
    new Set(
      rawPages
        .map((page) => pagePathFromUrl(page, origin))
        .filter(Boolean),
    ),
  );

  const findings: CavAiFindingV1[] = args.findings.map((finding, index) => {
    const pageUrl = extractPageUrl(finding, snapshotsByPath, origin);
    const pagePath = pagePathFromUrl(pageUrl, origin);
    const snapshot = snapshotsByPath.get(pagePath) || null;
    const code = deriveCode(finding, pagePath);

    return {
      id: `scan_${String(args.jobId || "job").slice(0, 48)}_${index + 1}`,
      code,
      pillar: pillarForCode(code),
      severity: normalizeSeverity(finding.severity),
      evidence: buildEvidence({
        code,
        pageUrl,
        pagePath,
        finding,
        snapshot,
      }),
      origin,
      pagePath,
      detectedAt: new Date().toISOString(),
      templateHint: pagePath === "/" ? "homepage" : null,
    };
  });

  return {
    version: CAVAI_NORMALIZED_INPUT_VERSION_V1,
    origin,
    pagesSelected: pagesSelected.length ? pagesSelected : ["/"],
    pageLimit: Math.max(1, Math.trunc(Number(args.pageLimit || pagesSelected.length || 1))),
    findings,
    context: {
      traits: {
        source: "cavscan",
        ...(args.jobId ? { scanJobId: String(args.jobId) } : {}),
        ...(args.projectId != null ? { projectId: args.projectId } : {}),
        ...(args.siteId ? { siteId: args.siteId } : {}),
      },
    },
  };
}

export async function generateInsightPackFromScanArtifacts(args: {
  accountId: string;
  userId: string;
  origin: string;
  pageLimit: number;
  pagesSelected?: string[];
  report?: ScanReport | null;
  findings: ScanArtifactFinding[];
  snapshots?: ScanArtifactSnapshot[];
  jobId?: string;
  projectId?: number;
  siteId?: string;
  requestId?: string;
}) {
  const input = createNormalizedScanInputFromScanArtifacts({
    origin: args.origin,
    pageLimit: args.pageLimit,
    pagesSelected: args.pagesSelected,
    report: args.report,
    findings: args.findings,
    snapshots: args.snapshots,
    jobId: args.jobId,
    projectId: args.projectId,
    siteId: args.siteId,
  });

  return generateInsightPackFromInput({
    accountId: args.accountId,
    userId: args.userId,
    input,
    requestId: args.requestId,
    meta: {
      workspaceId: args.accountId,
      ...(args.projectId != null ? { projectId: args.projectId } : {}),
    },
  });
}
