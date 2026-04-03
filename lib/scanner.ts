import { prisma } from "@/lib/prisma";
import { auditLogWrite } from "@/lib/audit";
import { PLANS, getPlanLimits, resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { Prisma, type ScanJobStatus, type ScanFindingSeverity } from "@prisma/client";

const SCAN_BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes soft window
const PILLARS = ["routes", "errors", "seo", "a11y", "ux"] as const;
const severityImpact: Record<ScanFindingSeverity, number> = {
  CRITICAL: 25,
  HIGH: 18,
  MEDIUM: 9,
  LOW: 4,
};
const severityPriority: Record<ScanFindingSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};
type RunScanContext = {
  planId: PlanId;
  pageLimit: number;
  accountId: string;
  operatorUserId: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

type PillarKey = (typeof PILLARS)[number];

export type ScanReport = {
  summary: string;
  confidence: string;
  priorities: Array<{ title: string; detail: string; severity: ScanFindingSeverity }>;
  pages: Array<{ url: string; title: string | null; status: number | null; reason: string }>;
  nextSteps: string[];
  metrics: {
    pagesAnalyzed: number;
    issuesFound: number;
    highPriorityCount: number;
    pillarScores: Record<PillarKey, number>;
    overallScore: number;
  };
};

const activeScans = new Set<string>();

export class ScanRequestError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toInputJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  try {
    // Ensure the value is JSON-serializable (and strip functions/symbols/cycles).
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

async function fetchProjectContext(projectId: number) {
  return prisma.project.findFirst({
    where: { id: projectId, isActive: true },
    select: {
      id: true,
      accountId: true,
      guardrails: {
        select: {
          enforceAllowlist: true,
          blockUnknownOrigins: true,
        },
      },
      account: {
        select: {
          tier: true,
          name: true,
          slug: true,
        },
      },
      topSiteId: true,
    },
  });
}

async function getAccountPlan(accountId: string | undefined): Promise<PlanId> {
  if (!accountId) return "free";
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { tier: true, trialSeatActive: true, trialEndsAt: true },
  });
  const now = Date.now();
  const endsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  const trialActive = Boolean(account?.trialSeatActive) && endsAtMs > now;
  const tierEffective = trialActive ? "PREMIUM_PLUS" : String(account?.tier || "FREE").toUpperCase();
  return resolvePlanIdFromTier(tierEffective);
}

export type ScanUsage = {
  planId: PlanId;
  planLabel: string;
  scansThisMonth: number;
  scansPerMonth: number;
  pagesPerScan: number;
};

export async function getMonthlyScanUsage(accountId: string | undefined): Promise<ScanUsage> {
  const planId = await getAccountPlan(accountId);
  const limits = getPlanLimits(planId);
  if (!accountId) {
    return {
      planId,
      planLabel: PLANS[planId].tierLabel,
      scansThisMonth: 0,
      scansPerMonth: limits.scansPerMonth,
      pagesPerScan: limits.pagesPerScan,
    };
  }
  const used = await prisma.scanJob.count({
    where: {
      project: { accountId },
      createdAt: { gte: startOfMonth() },
    },
  });
  return {
    planId,
    planLabel: PLANS[planId].tierLabel,
    scansThisMonth: used,
    scansPerMonth: limits.scansPerMonth,
    pagesPerScan: limits.pagesPerScan,
  };
}

export type ScanJobSummary = {
  id: string;
  status: ScanJobStatus;
  reason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  siteOrigin: string | null;
  siteLabel: string | null;
  pagesScanned: number | null;
  issuesFound: number | null;
  highPriorityCount: number | null;
  overallScore: number | null;
  report: ScanReport | null;
};

export type ProjectScanStatus = {
  usage: ScanUsage;
  lastJob: ScanJobSummary | null;
};

export async function getProjectScanStatus(projectId: number, accountId: string | undefined): Promise<ProjectScanStatus> {
  const usage = await getMonthlyScanUsage(accountId);
  const lastJob = await prisma.scanJob.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      site: { select: { origin: true, label: true } },
    },
  });

  const summary: ScanJobSummary | null = lastJob
    ? {
        id: lastJob.id,
        status: lastJob.status,
        reason: lastJob.reason ?? null,
        createdAt: lastJob.createdAt,
        startedAt: lastJob.startedAt ?? null,
        finishedAt: lastJob.finishedAt ?? null,
        siteOrigin: lastJob.site?.origin ?? null,
        siteLabel: lastJob.site?.label ?? null,
        pagesScanned: lastJob.pagesScanned ?? null,
        issuesFound: lastJob.issuesFound ?? null,
        highPriorityCount: lastJob.highPriorityCount ?? null,
        overallScore: lastJob.overallScore ?? null,
        report: lastJob.resultJson as ScanReport | null,
      }
    : null;

  return { usage, lastJob: summary };
}

type PageFetchResult = {
  url: string;
  status: number | null;
  html: string | null;
  responseTimeMs: number | null;
  payloadBytes: number | null;
  error?: string;
};

async function fetchPage(url: string): Promise<PageFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const start = Date.now();
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
    const html = await res.text().catch(() => "");
    const payloadBytes = html ? Buffer.byteLength(html, "utf-8") : null;
    return {
      url,
      status: res.status,
      html: html || null,
      responseTimeMs: Date.now() - start,
      payloadBytes,
    };
  } catch (error) {
    const maybeError = error instanceof Error ? error.message : "Fetch failed";
    return {
      url,
      status: null,
      html: null,
      responseTimeMs: Date.now() - start,
      payloadBytes: null,
      error: maybeError,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeScanUrl(raw: string, baseOrigin: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("#")) return null;
  try {
    const resolved = new URL(trimmed, baseOrigin);
    if (resolved.origin !== baseOrigin) return null;
    // Keep pathname + search + hash? drop hash for consistency
    const normalized = `${resolved.origin}${resolved.pathname.replace(/\/+$/, "") || "/"}`;
    const search = resolved.search;
    return search ? `${normalized}${search}` : normalized;
  } catch {
    return null;
  }
}

function collectAnchors(html: string) {
  const anchors: string[] = [];
  if (!html) return anchors;
  const regex = /<a[^>]+href=(["'])(.*?)\1[^>]*>/gi;
  for (const match of html.matchAll(regex)) {
    const href = match[2];
    if (href) anchors.push(href);
  }
  return anchors;
}

function extractNavCandidates(html: string, baseOrigin: string, limit = 2) {
  const seen = new Set<string>();
  const addIfValid = (href: string) => {
    const normalized = normalizeScanUrl(href, baseOrigin);
    if (!normalized || seen.has(normalized)) return null;
    seen.add(normalized);
    return normalized;
  };

  const navMatches = [...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)];
  for (const match of navMatches) {
    const anchors = collectAnchors(match[1]);
    for (const href of anchors) {
      const candidate = addIfValid(href);
      if (candidate && seen.size <= limit) {
        // continue to gather
      }
      if (seen.size >= limit) break;
    }
    if (seen.size >= limit) break;
  }

  if (seen.size < limit) {
    const headerMatches = [...html.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)];
    for (const match of headerMatches) {
      const anchors = collectAnchors(match[1]);
      for (const href of anchors) {
        const candidate = addIfValid(href);
        if (!candidate) continue;
        if (seen.size >= limit) break;
      }
      if (seen.size >= limit) break;
    }
  }

  if (seen.size < limit) {
    const anchors = collectAnchors(html);
    for (const href of anchors) {
      const candidate = addIfValid(href);
      if (!candidate) continue;
      if (seen.size >= limit) break;
    }
  }

  return Array.from(seen).slice(0, limit);
}

async function findSitemapCandidate(baseOrigin: string) {
  const sitemapUrl = `${baseOrigin.replace(/\/$/, "")}/sitemap.xml`;
  try {
    const res = await fetch(sitemapUrl, { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text().catch(() => "");
    const match = text.match(/<loc>([^<]+)<\/loc>/i);
    if (!match) return null;
    return normalizeScanUrl(match[1], baseOrigin);
  } catch {
    return null;
  }
}

function findRepresentativeContentLink(html: string, baseOrigin: string, existing: Set<string>) {
  if (!html) return null;
  const keywords = ["blog", "docs", "product", "articles", "resources", "news"];
  const anchors = collectAnchors(html);
  for (const href of anchors) {
    const normalized = normalizeScanUrl(href, baseOrigin);
    if (!normalized || existing.has(normalized)) continue;
    if (keywords.some((keyword) => normalized.toLowerCase().includes(keyword))) {
      return normalized;
    }
  }
  return null;
}

async function buildPageQueue(siteOrigin: string, cap: number) {
  const normalizedOrigin = (() => {
    try {
      return new URL(siteOrigin).origin;
    } catch {
      return siteOrigin;
    }
  })();

  const selected: Array<{ url: string; reason: string }> = [];
  const seen = new Set<string>();

  const addPage = (url: string | null, reason: string) => {
    if (!url || selected.length >= cap) return;
    const final = normalizeScanUrl(url, normalizedOrigin);
    if (!final || seen.has(final)) return;
    seen.add(final);
    selected.push({ url: final, reason });
  };

  addPage(normalizedOrigin, "Homepage");

  const homepage = await fetchPage(normalizedOrigin);
  const homepageHtml = homepage.html || "";

  const navCandidates = extractNavCandidates(homepageHtml, normalizedOrigin, 2);
  navCandidates.forEach((url, idx) => addPage(url, `Primary nav destination #${idx + 1}`));

  const sitemap = await findSitemapCandidate(normalizedOrigin);
  addPage(sitemap, "Sitemap / deep link");

  const representative = findRepresentativeContentLink(homepageHtml, normalizedOrigin, seen);
  addPage(representative, "Representative content");

  if (selected.length < cap && homepageHtml) {
    const anchors = collectAnchors(homepageHtml);
    for (const href of anchors) {
      if (selected.length >= cap) break;
      addPage(href, "Additional content");
    }
  }

  return selected.slice(0, cap);
}

function hasMetaDescription(html: string) {
  return /<meta[^>]+name=(["'])description\1[^>]*content=(["'])(.*?)\2/i.test(html);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title\b[^>]*>(.*?)<\/title>/i);
  if (!match) return null;
  return match[1].trim() || null;
}

function countImagesMissingAlt(html: string) {
  if (!html) return 0;
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  let count = 0;
  for (const match of images) {
    const tag = match[0];
    if (!/\balt\s*=/i.test(tag)) {
      count += 1;
    }
  }
  return count;
}

type PageAnalysis = {
  findings: Array<{
    pillar: PillarKey;
    severity: ScanFindingSeverity;
    message: string;
    evidence?: Record<string, unknown>;
  }>;
  snapshot: {
    pageUrl: string;
    title: string | null;
    status: number | null;
    responseTimeMs: number | null;
    payloadBytes: number | null;
    metaJson: Record<string, unknown> | null;
  };
};

function analyzePage(page: PageFetchResult, reason: string): PageAnalysis {
  const html = page.html || "";
  const findings: PageAnalysis["findings"] = [];
  const title = html ? extractTitle(html) : null;
  const hasMeta = html ? hasMetaDescription(html) : false;
  const missingAlt = html ? countImagesMissingAlt(html) : 0;

  if (page.error) {
    findings.push({
      pillar: "errors",
      severity: "HIGH",
      message: `We detected a fetch failure on ${page.url}: ${page.error}`,
      evidence: { reason, pageUrl: page.url },
    });
  }

  if (page.status && page.status >= 400) {
    findings.push({
      pillar: "routes",
      severity: "CRITICAL",
      message: `Route returned HTTP ${page.status} (${reason}).`,
      evidence: { status: page.status, reason, pageUrl: page.url },
    });
  }

  if (!html && !page.error && !page.status) {
    findings.push({
      pillar: "errors",
      severity: "MEDIUM",
      message: `Unable to read any HTML from ${page.url}.`,
      evidence: { reason, pageUrl: page.url },
    });
  }

  if (html && !title) {
    findings.push({
      pillar: "seo",
      severity: "HIGH",
      message: `Title tag is missing on ${page.url}. This hurts SEO and sharing metadata.`,
      evidence: { reason, pageUrl: page.url },
    });
  }

  if (html && !hasMeta) {
    findings.push({
      pillar: "seo",
      severity: "MEDIUM",
      message: `Meta description not found on ${page.url}. Search previews may be unclear.`,
      evidence: { reason, pageUrl: page.url },
    });
  }

  if (missingAlt > 0) {
    findings.push({
      pillar: "a11y",
      severity: "MEDIUM",
      message: `${missingAlt} image(s) missing alt on ${page.url}. Screen readers need alt text.`,
      evidence: { count: missingAlt, reason, pageUrl: page.url },
    });
  }

  if (page.responseTimeMs && page.responseTimeMs > 2200) {
    findings.push({
      pillar: "ux",
      severity: "MEDIUM",
      message: `Page load took ${Math.round(page.responseTimeMs)} ms on ${page.url}.`,
      evidence: { responseTimeMs: page.responseTimeMs, reason, pageUrl: page.url },
    });
  }

  return {
    findings,
    snapshot: {
      pageUrl: page.url,
      title,
      status: page.status,
      responseTimeMs: page.responseTimeMs,
      payloadBytes: page.payloadBytes,
      metaJson: {
        reason,
        title,
        status: page.status,
        ...(page.error ? { error: page.error } : {}),
      },
    },
  };
}

function buildScanReport(params: {
  siteOrigin: string;
  pages: Array<{ url: string; reason: string }>;
  analyses: PageAnalysis[];
  pageLimit: number;
  capReached: boolean;
}) {
  const { analyses, pages, siteOrigin, pageLimit, capReached } = params;
  const aggregatedFindings = analyses.flatMap((item) => item.findings);
  const pillarScores: Record<PillarKey, number> = {
    routes: 100,
    errors: 100,
    seo: 100,
    a11y: 100,
    ux: 100,
  };

  aggregatedFindings.forEach((finding) => {
    const impact = severityImpact[finding.severity] ?? 0;
    pillarScores[finding.pillar] = Math.max(0, pillarScores[finding.pillar] - impact);
  });

  const averageScore = Math.round(
    PILLARS.reduce((sum, pillar) => sum + pillarScores[pillar], 0) / PILLARS.length
  );
  const issuesFound = aggregatedFindings.length;
  const highPriorityCount = aggregatedFindings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH").length;
  const summaryBase = `We scanned ${pages.length} page${pages.length === 1 ? "" : "s"} across ${siteOrigin}.`;
  const capCopy = capReached
    ? `Scan completed (${pages.length}/${pageLimit} pages analyzed). Upgrade to scan deeper.`
    : "";
  const issuesCopy = issuesFound
    ? `We detected ${issuesFound} ${issuesFound === 1 ? "issue" : "issues"}.`
    : "No detected issues.";

  const priorityEntries = Array.from(
    aggregatedFindings.reduce((map, finding) => {
      const existing = map.get(finding.pillar) ?? [];
      existing.push(finding);
      map.set(finding.pillar, existing);
      return map;
    }, new Map<PillarKey, Array<typeof aggregatedFindings[number]>>())
  )
    .map(([pillar, list]) => {
      const highestSeverity = list.reduce<ScanFindingSeverity>(
        (prev, current) => (severityPriority[current.severity] > severityPriority[prev] ? current.severity : prev),
        list[0].severity
      );
      const sample = list[0];
      return {
        pillar,
        count: list.length,
        severity: highestSeverity,
        sample,
        detailUrl: sample.evidence?.pageUrl as string | undefined,
      };
    })
    .sort(
      (a, b) =>
        severityPriority[b.severity] * 100 + b.count - (severityPriority[a.severity] * 100 + a.count)
    )
    .slice(0, 3)
    .map((entry) => {
      const friendly = {
        routes: "route",
        errors: "error",
        seo: "SEO",
        a11y: "accessibility",
        ux: "UX",
      }[entry.pillar];
      const detailUrl = entry.detailUrl ? ` (e.g. ${entry.detailUrl})` : "";
      return {
        title: `Resolve ${entry.count} ${friendly} ${entry.count === 1 ? "signal" : "signals"}`,
        detail: `We detected ${entry.count} ${friendly}${entry.count === 1 ? "" : " issues"}${detailUrl}.`,
        severity: entry.severity,
        detailUrl: entry.detailUrl,
      };
    });

  const nextSteps: string[] = [];
  if (priorityEntries.length) {
    for (const entry of priorityEntries.slice(0, 2)) {
      const friendly = entry.title.replace(/Resolve /, "").toLowerCase();
      const urlHint = entry.detailUrl ? ` (e.g. ${entry.detailUrl})` : "";
      nextSteps.push(`Prioritize ${friendly}${urlHint} first so the workspace stays stable.`);
    }
  } else {
    nextSteps.push("No findings emerged. Keep scanning after changes to preserve confidence.");
  }

  const reportPages = pages.map((page, index) => ({
    url: page.url,
    title: analyses[index]?.snapshot.title ?? null,
    status: analyses[index]?.snapshot.status ?? null,
    reason: page.reason,
  }));

  return {
    summary: [summaryBase, issuesCopy, capCopy].filter(Boolean).join(" "),
    confidence: `Confidence ${Math.max(0, Math.min(100, averageScore))}% — deterministic heuristics across every pillar.`,
    priorities: priorityEntries.length
      ? priorityEntries
      : [
          {
            title: "No high-priority issues detected",
            detail: "We found no deterministic findings this run. Keep scanning after updates to stay ahead.",
            severity: "MEDIUM" as ScanFindingSeverity,
          },
        ],
    pages: reportPages,
    nextSteps,
  metrics: {
    pagesAnalyzed: pages.length,
    issuesFound,
    highPriorityCount,
    pillarScores,
    overallScore: Math.max(0, Math.min(100, averageScore)),
  },
};
}

async function performScan(siteOrigin: string, pageLimit: number) {
  const pages = await buildPageQueue(siteOrigin, pageLimit);
  const analyses: PageAnalysis[] = [];
  for (const page of pages) {
    const fetchResult = await fetchPage(page.url);
    analyses.push(analyzePage(fetchResult, page.reason));
  }
  const report = buildScanReport({
    siteOrigin,
    pages,
    analyses,
    pageLimit,
    capReached: pages.length >= pageLimit,
  });
  return { report, analyses, pages };
}

async function runScanJob(jobId: string, context: RunScanContext) {
  const job = await prisma.scanJob.findUnique({
    where: { id: jobId },
    include: {
      site: true,
    },
  });
  if (!job?.site) return;
  if (activeScans.has(job.siteId)) return;

  activeScans.add(job.siteId);
  await prisma.scanJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  await auditLogWrite({
    accountId: context.accountId,
    operatorUserId: context.operatorUserId,
    action: "SCAN_STARTED",
    targetType: "site",
    targetId: job.site.id,
    targetLabel: job.site.origin,
    metaJson: {
      reason: job.reason,
      pagesPerScan: context.pageLimit,
      ...(context.ip ? { requestIp: context.ip } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    },
  });

  const scanStart = Date.now();
  try {
    const { report, analyses } = await performScan(job.site.origin, context.pageLimit);

	    const findingsData = analyses.flatMap((analysis) =>
	      analysis.findings.map((finding) => ({
	        scanJobId: jobId,
	        siteId: job.siteId,
	        pillar: finding.pillar,
	        severity: finding.severity,
	        message: finding.message,
	        evidence: toInputJson(finding.evidence),
	      }))
	    );

	    const snapshotsData = analyses.map((analysis) => ({
	      scanJobId: jobId,
	      siteId: job.siteId,
	      pageUrl: analysis.snapshot.pageUrl,
	      title: analysis.snapshot.title,
	      status: analysis.snapshot.status,
	      responseTimeMs: analysis.snapshot.responseTimeMs,
	      payloadBytes: analysis.snapshot.payloadBytes,
	      metaJson: toInputJson(analysis.snapshot.metaJson),
	    }));

    const updateData = {
      status: "SUCCEEDED" as ScanJobStatus,
      finishedAt: new Date(),
      resultJson: report,
      pagesScanned: report.metrics.pagesAnalyzed,
      issuesFound: report.metrics.issuesFound,
      highPriorityCount: report.metrics.highPriorityCount,
      overallScore: report.metrics.overallScore,
      durationMs: Date.now() - scanStart,
    };

    const tx: Prisma.PrismaPromise<unknown>[] = [];
    if (findingsData.length) {
      tx.push(prisma.scanFinding.createMany({ data: findingsData }));
    }
    if (snapshotsData.length) {
      tx.push(prisma.scanSnapshot.createMany({ data: snapshotsData }));
    }
    tx.push(prisma.scanJob.update({ where: { id: jobId }, data: updateData }));
    await prisma.$transaction(tx);

    await auditLogWrite({
      accountId: context.accountId,
      operatorUserId: context.operatorUserId,
      action: "SCAN_COMPLETED",
      targetType: "site",
      targetId: job.site.id,
      targetLabel: job.site.origin,
      metaJson: {
        pagesAnalyzed: report.metrics.pagesAnalyzed,
        issuesFound: report.metrics.issuesFound,
        highPriorityCount: report.metrics.highPriorityCount,
        durationMs: updateData.durationMs,
        ...(context.ip ? { requestIp: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        reason: message,
        resultJson: { error: message },
        durationMs: Date.now() - scanStart,
      },
    });
    await auditLogWrite({
      accountId: context.accountId,
      operatorUserId: context.operatorUserId,
      action: "SCAN_FAILED",
      targetType: "site",
      targetId: job.site.id,
      targetLabel: job.site.origin,
      metaJson: {
        error: message,
        ...(context.ip ? { requestIp: context.ip } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      },
    });
  } finally {
    activeScans.delete(job.siteId);
  }
}

type RequestScanOptions = {
  projectId: number;
  siteId: string;
  accountId?: string;
  operatorUserId: string | null;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string;
};

export type RequestScanResult = {
  jobId: string;
  status: ScanJobStatus;
  scansRemaining: number;
  scansPerMonth: number;
};

export async function requestScan(options: RequestScanOptions): Promise<RequestScanResult> {
  const project = await fetchProjectContext(options.projectId);
  if (!project) {
    throw new ScanRequestError("PROJECT_NOT_FOUND", 404, "Workspace not found.");
  }
  if (!options.accountId || options.accountId !== project.accountId) {
    throw new ScanRequestError("ACCESS_DENIED", 403, "Unauthorized workspace.");
  }

  const site = await prisma.site.findFirst({
    where: { id: options.siteId, projectId: project.id, isActive: true },
    select: { id: true, origin: true },
  });
  if (!site) {
    throw new ScanRequestError("SITE_NOT_FOUND", 404, "Site not found.");
  }

  if (project.guardrails?.enforceAllowlist) {
    const allowed = await prisma.siteAllowedOrigin.findFirst({
      where: { siteId: site.id },
      select: { id: true },
    });
    if (!allowed) {
      throw new ScanRequestError("ORIGIN_NOT_ALLOWLISTED", 400, "Origin not allowlisted.");
    }
  }

  const hasRunning = await prisma.scanJob.findFirst({
    where: { siteId: site.id, status: "RUNNING" },
    select: { id: true },
  });
  if (hasRunning) {
    throw new ScanRequestError("SCAN_IN_PROGRESS", 409, "Scan in progress.");
  }

  const usage = await getMonthlyScanUsage(options.accountId);
  if (usage.scansThisMonth >= usage.scansPerMonth) {
    throw new ScanRequestError(
      "SCAN_LIMIT",
      429,
      "You’ve reached this month’s scan limit. Upgrade to keep scanning."
    );
  }

  const windowStart = new Date(Date.now() - SCAN_BURST_WINDOW_MS);
  const recentBurst = await prisma.scanJob.count({
    where: {
      siteId: site.id,
      createdAt: { gte: windowStart },
    },
  });
  if (recentBurst >= 2) {
    throw new ScanRequestError(
      "SCAN_RECENT",
      429,
      "Recent scan detected. Make changes first, then run again."
    );
  }

  const job = await prisma.scanJob.create({
    data: {
      projectId: project.id,
      siteId: site.id,
      reason: (options.reason || "Manual scan requested").slice(0, 140),
    },
  });

  void runScanJob(job.id, {
    planId: usage.planId,
    pageLimit: usage.pagesPerScan,
    accountId: project.accountId,
    operatorUserId: options.operatorUserId,
    ip: options.ip,
    userAgent: options.userAgent,
  });

  return {
    jobId: job.id,
    status: job.status,
    scansRemaining: Math.max(0, usage.scansPerMonth - (usage.scansThisMonth + 1)),
    scansPerMonth: usage.scansPerMonth,
  };
}
