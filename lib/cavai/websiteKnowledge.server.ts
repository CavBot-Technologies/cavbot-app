import "server-only";

import { prisma } from "@/lib/prisma";

export const CAVAI_WEBSITE_GRAPH_VERSION = "website_graph_v1";

export type CavAiWebsiteKnowledgePage = {
  url: string;
  path: string;
  title: string | null;
  status: number | null;
  responseTimeMs: number | null;
  payloadBytes: number | null;
  signals: {
    canonical: string | null;
    metaDescription: string | null;
    headingCount: number;
    internalLinkCount: number;
    schemaTypes: string[];
  };
};

export type CavAiWebsiteKnowledgeGraph = {
  version: string;
  generatedAt: string;
  source: {
    type: "scan_job";
    scanJobId: string;
    scanCreatedAt: string;
    scanFinishedAt: string | null;
    siteId: string;
  };
  site: {
    projectId: number;
    siteId: string;
    origin: string;
    label: string;
  };
  metrics: {
    pagesCrawled: number;
    pagesWithErrors: number;
    pagesWithSlowResponse: number;
    avgResponseTimeMs: number;
    findingsTotal: number;
    criticalFindings: number;
    highFindings: number;
    brokenRouteFindings: number;
    missingMetadataPages: number;
    thinPageRiskCount: number;
    duplicateTitleRiskCount: number;
  };
  pages: CavAiWebsiteKnowledgePage[];
  findings: Array<{
    pillar: string;
    severity: string;
    message: string;
    evidence: Record<string, unknown> | null;
  }>;
  opportunities: string[];
};

type JsonRecord = Record<string, unknown>;

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function toIso(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

function urlPath(value: string): string {
  const raw = s(value);
  if (!raw) return "/";
  try {
    const parsed = new URL(raw);
    return parsed.pathname || "/";
  } catch {
    return "/";
  }
}

function stringArray(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const row of value) {
    const text = s(row);
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function detectOpportunitySignals(graph: {
  pages: CavAiWebsiteKnowledgePage[];
  findings: Array<{ pillar: string; severity: string; message: string }>;
  metrics: CavAiWebsiteKnowledgeGraph["metrics"];
}): string[] {
  const opportunities: string[] = [];
  const { metrics } = graph;
  if (metrics.pagesWithErrors > 0) {
    opportunities.push(`Fix ${metrics.pagesWithErrors} page(s) returning 4xx/5xx or network failures.`);
  }
  if (metrics.pagesWithSlowResponse > 0) {
    opportunities.push(`Optimize response times for ${metrics.pagesWithSlowResponse} slow page(s).`);
  }
  if (metrics.missingMetadataPages > 0) {
    opportunities.push(`Fill missing title/meta tags on ${metrics.missingMetadataPages} page(s).`);
  }
  if (metrics.thinPageRiskCount > 0) {
    opportunities.push(`Expand thin content on ${metrics.thinPageRiskCount} page(s) to improve ranking potential.`);
  }
  if (metrics.duplicateTitleRiskCount > 0) {
    opportunities.push(`Resolve duplicate title risk across ${metrics.duplicateTitleRiskCount} page(s).`);
  }
  const critical = graph.findings.filter((row) => s(row.severity).toUpperCase() === "CRITICAL").slice(0, 3);
  for (const row of critical) {
    opportunities.push(`Critical ${row.pillar} issue: ${row.message}`);
  }
  return opportunities.slice(0, 12);
}

export async function buildWebsiteKnowledgeGraphFromLatestScan(args: {
  accountId: string;
  projectId: number;
  siteId?: string | null;
}): Promise<CavAiWebsiteKnowledgeGraph> {
  const projectId = toProjectId(args.projectId);
  if (!projectId) {
    throw new Error("projectId is required to build website knowledge.");
  }

  const scanJob = await prisma.scanJob.findFirst({
    where: {
      projectId,
      project: {
        accountId: s(args.accountId),
      },
      ...(s(args.siteId) ? { siteId: s(args.siteId) } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      site: {
        select: {
          id: true,
          label: true,
          origin: true,
        },
      },
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 600,
      },
      findings: {
        orderBy: { createdAt: "desc" },
        take: 200,
      },
    },
  });

  if (!scanJob) {
    throw new Error("No scan data is available for this project/site yet.");
  }

  const pages: CavAiWebsiteKnowledgePage[] = scanJob.snapshots.map((snapshot) => {
    const meta = asRecord(snapshot.metaJson);
    const canonical = s(meta.canonicalUrl) || s(meta.canonical) || null;
    const metaDescription = s(meta.metaDescription) || s(meta.description) || null;
    const headings = stringArray(meta.headings, 40);
    const internalLinks = stringArray(meta.internalLinks, 60);
    const schemaTypes = stringArray(meta.schemaTypes, 20);
    return {
      url: s(snapshot.pageUrl),
      path: urlPath(snapshot.pageUrl),
      title: s(snapshot.title) || null,
      status: Number.isFinite(Number(snapshot.status)) ? Number(snapshot.status) : null,
      responseTimeMs: Number.isFinite(Number(snapshot.responseTimeMs)) ? Number(snapshot.responseTimeMs) : null,
      payloadBytes: Number.isFinite(Number(snapshot.payloadBytes)) ? Number(snapshot.payloadBytes) : null,
      signals: {
        canonical,
        metaDescription,
        headingCount: headings.length,
        internalLinkCount: internalLinks.length,
        schemaTypes,
      },
    };
  });

  const findings = scanJob.findings.map((finding) => ({
    pillar: s(finding.pillar).toLowerCase(),
    severity: s(finding.severity).toUpperCase(),
    message: s(finding.message),
    evidence: asRecord(finding.evidence || null),
  }));

  const pagesWithErrors = pages.filter((row) => row.status == null || row.status >= 400).length;
  const pagesWithSlowResponse = pages.filter((row) => Number(row.responseTimeMs || 0) >= 1_500).length;
  const avgResponseTimeMs = pages.length
    ? Math.round(
        pages.reduce((sum, row) => sum + (Number.isFinite(Number(row.responseTimeMs)) ? Number(row.responseTimeMs) : 0), 0)
        / pages.length
      )
    : 0;
  const criticalFindings = findings.filter((row) => row.severity === "CRITICAL").length;
  const highFindings = findings.filter((row) => row.severity === "HIGH").length;
  const brokenRouteFindings = findings.filter((row) => row.pillar === "routes").length;
  const missingMetadataPages = pages.filter((row) => !s(row.title) || !s(row.signals.metaDescription)).length;
  const thinPageRiskCount = pages.filter((row) => Number(row.payloadBytes || 0) > 0 && Number(row.payloadBytes || 0) < 1200).length;
  const titleHistogram = new Map<string, number>();
  for (const page of pages) {
    const key = s(page.title).toLowerCase();
    if (!key) continue;
    titleHistogram.set(key, (titleHistogram.get(key) || 0) + 1);
  }
  const duplicateTitleRiskCount = pages.filter((row) => {
    const key = s(row.title).toLowerCase();
    if (!key) return false;
    return Number(titleHistogram.get(key) || 0) > 1;
  }).length;

  const metrics: CavAiWebsiteKnowledgeGraph["metrics"] = {
    pagesCrawled: pages.length,
    pagesWithErrors,
    pagesWithSlowResponse,
    avgResponseTimeMs,
    findingsTotal: findings.length,
    criticalFindings,
    highFindings,
    brokenRouteFindings,
    missingMetadataPages,
    thinPageRiskCount,
    duplicateTitleRiskCount,
  };

  const graph: CavAiWebsiteKnowledgeGraph = {
    version: CAVAI_WEBSITE_GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      type: "scan_job",
      scanJobId: scanJob.id,
      scanCreatedAt: scanJob.createdAt.toISOString(),
      scanFinishedAt: toIso(scanJob.finishedAt),
      siteId: scanJob.siteId,
    },
    site: {
      projectId,
      siteId: scanJob.siteId,
      origin: s(scanJob.site?.origin),
      label: s(scanJob.site?.label),
    },
    metrics,
    pages,
    findings,
    opportunities: [],
  };
  graph.opportunities = detectOpportunitySignals({ pages: graph.pages, findings: graph.findings, metrics });

  return graph;
}

export async function persistWebsiteKnowledgeGraph(args: {
  accountId: string;
  userId: string;
  requestId?: string | null;
  source?: string | null;
  sourceRef?: string | null;
  workspaceId?: string | null;
  projectId?: number | null;
  siteId?: string | null;
  origin?: string | null;
  graph: CavAiWebsiteKnowledgeGraph;
}): Promise<{ id: string }> {
  const graph = args.graph;
  const summaryJson = {
    metrics: graph.metrics,
    opportunities: graph.opportunities.slice(0, 8),
    pageCount: graph.pages.length,
    findingCount: graph.findings.length,
  };
  const signalJson = {
    pagesWithErrors: graph.metrics.pagesWithErrors,
    pagesWithSlowResponse: graph.metrics.pagesWithSlowResponse,
    missingMetadataPages: graph.metrics.missingMetadataPages,
    brokenRouteFindings: graph.metrics.brokenRouteFindings,
    criticalFindings: graph.metrics.criticalFindings,
    duplicateTitleRiskCount: graph.metrics.duplicateTitleRiskCount,
  };
  const created = await prisma.cavAiWebsiteKnowledgeGraph.create({
    data: {
      accountId: s(args.accountId),
      userId: s(args.userId),
      requestId: s(args.requestId) || null,
      source: s(args.source) || "scan_job",
      sourceRef: s(args.sourceRef) || null,
      workspaceId: s(args.workspaceId) || null,
      projectId: toProjectId(args.projectId),
      siteId: s(args.siteId) || null,
      origin: s(args.origin) || null,
      graphVersion: graph.version,
      graphJson: graph as unknown as object,
      signalJson: signalJson as unknown as object,
      summaryJson: summaryJson as unknown as object,
    },
    select: { id: true },
  });
  return created;
}

export async function ingestWebsiteKnowledgeFromLatestScan(args: {
  accountId: string;
  userId: string;
  requestId?: string | null;
  workspaceId?: string | null;
  projectId: number;
  siteId?: string | null;
  origin?: string | null;
}): Promise<{ id: string; graph: CavAiWebsiteKnowledgeGraph }> {
  const graph = await buildWebsiteKnowledgeGraphFromLatestScan({
    accountId: args.accountId,
    projectId: args.projectId,
    siteId: args.siteId || null,
  });
  const created = await persistWebsiteKnowledgeGraph({
    accountId: args.accountId,
    userId: args.userId,
    requestId: args.requestId || null,
    source: "scan_job",
    sourceRef: graph.source.scanJobId,
    workspaceId: args.workspaceId || null,
    projectId: args.projectId,
    siteId: graph.site.siteId,
    origin: args.origin || graph.site.origin,
    graph,
  });
  return {
    id: created.id,
    graph,
  };
}

export async function getLatestWebsiteKnowledgeGraph(args: {
  accountId: string;
  projectId?: number | null;
  workspaceId?: string | null;
  siteId?: string | null;
}): Promise<{
  id: string;
  createdAt: string;
  graph: CavAiWebsiteKnowledgeGraph;
} | null> {
  const row = await prisma.cavAiWebsiteKnowledgeGraph.findFirst({
    where: {
      accountId: s(args.accountId),
      ...(toProjectId(args.projectId) ? { projectId: toProjectId(args.projectId) } : {}),
      ...(s(args.workspaceId) ? { workspaceId: s(args.workspaceId) } : {}),
      ...(s(args.siteId) ? { siteId: s(args.siteId) } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      graphJson: true,
    },
  });
  if (!row?.graphJson || typeof row.graphJson !== "object" || Array.isArray(row.graphJson)) return null;
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    graph: row.graphJson as unknown as CavAiWebsiteKnowledgeGraph,
  };
}

export function summarizeWebsiteKnowledgeForAiContext(graph: CavAiWebsiteKnowledgeGraph): Record<string, unknown> {
  return {
    version: graph.version,
    generatedAt: graph.generatedAt,
    site: graph.site,
    metrics: graph.metrics,
    topOpportunities: graph.opportunities.slice(0, 8),
    pages: graph.pages.slice(0, 24).map((row) => ({
      url: row.url,
      path: row.path,
      title: row.title,
      status: row.status,
      responseTimeMs: row.responseTimeMs,
      signals: row.signals,
    })),
    findings: graph.findings.slice(0, 32),
  };
}

export async function listWebsiteKnowledgeGraphHistory(args: {
  accountId: string;
  projectId?: number | null;
  workspaceId?: string | null;
  siteId?: string | null;
  limit?: number;
}): Promise<Array<{
  id: string;
  createdAt: string;
  graphVersion: string;
  source: string;
  sourceRef: string | null;
  projectId: number | null;
  siteId: string | null;
  origin: string | null;
  summary: Record<string, unknown>;
}>> {
  const limit = Math.max(1, Math.min(40, Math.trunc(Number(args.limit || 12))));
  const rows = await prisma.cavAiWebsiteKnowledgeGraph.findMany({
    where: {
      accountId: s(args.accountId),
      ...(toProjectId(args.projectId) ? { projectId: toProjectId(args.projectId) } : {}),
      ...(s(args.workspaceId) ? { workspaceId: s(args.workspaceId) } : {}),
      ...(s(args.siteId) ? { siteId: s(args.siteId) } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      graphVersion: true,
      source: true,
      sourceRef: true,
      projectId: true,
      siteId: true,
      origin: true,
      summaryJson: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    graphVersion: row.graphVersion,
    source: row.source,
    sourceRef: row.sourceRef,
    projectId: row.projectId,
    siteId: row.siteId,
    origin: row.origin,
    summary: asRecord(row.summaryJson),
  }));
}
