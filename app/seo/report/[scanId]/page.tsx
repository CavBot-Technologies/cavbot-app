import "../report.css";

import { unstable_noStore as noStore } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import AppShell from "@/components/AppShell";
import { getAppOrigin, isApiAuthError } from "@/lib/apiAuth";
import { gateModuleAccess } from "@/lib/moduleGate.server";
import { prisma } from "@/lib/prisma";
import {
  isSeoScanReport,
  type SeoIssue,
  type SeoIssueCategory,
  type SeoScanStoredReport,
} from "@/lib/seo/seoScan.server";
import { requireWorkspaceSession } from "@/lib/workspaceAuth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ scanId?: string }>;
};

const CATEGORY_LABELS: Record<SeoIssueCategory, string> = {
  metadata: "Metadata",
  indexability: "Indexability",
  structure: "Structure",
  social: "Social Preview",
  favicon: "Favicon",
  structured_data: "Structured Data",
  robots: "Robots",
  sitemap: "Sitemap",
};

function cleanScanId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 140) : "";
}

function fmtDate(value: string | Date | null | undefined) {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function fmtNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function valueOrDash(value: unknown) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
  return text || "Not detected";
}

function toneForSeverity(severity: SeoIssue["severity"]) {
  if (severity === "critical" || severity === "high") return "bad";
  if (severity === "medium" || severity === "low") return "watch";
  if (severity === "notice") return "notice";
  return "good";
}

function statusLabel(report: SeoScanStoredReport) {
  if (report.status === "failed") return "Failed";
  return report.scoreBand;
}

function groupedChecks(report: SeoScanStoredReport) {
  return report.checks.reduce<Record<string, SeoIssue[]>>((acc, check) => {
    const label = CATEGORY_LABELS[check.category] || check.category;
    acc[label] = acc[label] || [];
    acc[label].push(check);
    return acc;
  }, {});
}

function ReportUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <main className="seo-report-page">
        <div className="seo-report-shell">
          <section className="seo-report-empty">
            <p className="seo-report-kicker">SEO Audit</p>
            <h1>{title}</h1>
            <p>{message}</p>
            <Link href="/seo" className="seo-report-button">
              Back to SEO
            </Link>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "good" | "watch" | "bad" | "notice";
}) {
  return (
    <div className="seo-report-card" data-tone={tone}>
      <div className="seo-report-card-label">{label}</div>
      <div className="seo-report-card-value">{value}</div>
      <div className="seo-report-card-detail">{detail}</div>
    </div>
  );
}

function IssueRow({ issue }: { issue: SeoIssue }) {
  return (
    <article className="seo-report-issue" data-tone={toneForSeverity(issue.severity)}>
      <div className="seo-report-issue-top">
        <span>{issue.label}</span>
        <span>{issue.severity === "none" ? "pass" : issue.severity}</span>
      </div>
      <p>{issue.message}</p>
      {issue.recommendation ? <p className="seo-report-rec">{issue.recommendation}</p> : null}
      {issue.url ? <div className="seo-report-url">{issue.url}</div> : null}
    </article>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: SeoIssue[] }) {
  const failed = checks.filter((check) => check.status !== "pass").length;
  return (
    <section className="seo-report-check-group">
      <div className="seo-report-check-head">
        <h3>{title}</h3>
        <span>{failed ? `${failed} to review` : "clear"}</span>
      </div>
      <div className="seo-report-check-list">
        {checks.map((check) => (
          <div className="seo-report-check" key={check.id} data-tone={toneForSeverity(check.severity)}>
            <span>{check.label}</span>
            <span>{check.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RawDetails({ report }: { report: SeoScanStoredReport }) {
  const rows: Array<[string, string]> = [
    ["Status code", report.raw.statusCode == null ? "Not recorded" : String(report.raw.statusCode)],
    ["Final URL", valueOrDash(report.raw.finalUrl)],
    ["Content type", valueOrDash(report.raw.contentType)],
    ["Title", valueOrDash(report.raw.title)],
    ["Description", valueOrDash(report.raw.description)],
    ["Canonical", valueOrDash(report.raw.canonical)],
    ["Robots", valueOrDash(report.raw.robots)],
    ["H1 count", String(report.raw.h1Count)],
    ["Word count", String(report.raw.wordCount)],
    ["JSON-LD count", String(report.raw.jsonLdCount)],
    ["robots.txt status", report.raw.robotsTxtStatus == null ? "Not recorded" : String(report.raw.robotsTxtStatus)],
    ["sitemap.xml status", report.raw.sitemapXmlStatus == null ? "Not recorded" : String(report.raw.sitemapXmlStatus)],
  ];

  return (
    <section className="seo-report-panel">
      <div className="seo-report-section-head">
        <h2>Raw Technical Details</h2>
        <p>Stored scan facts from this run.</p>
      </div>
      <div className="seo-report-details">
        {rows.map(([label, value]) => (
          <div className="seo-report-detail-row" key={label}>
            <span>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeoReport({ report, siteLabel }: { report: SeoScanStoredReport; siteLabel: string }) {
  const priority = report.summary.topPriorityFix;
  const grouped = groupedChecks(report);
  const topIssues = report.issues.slice(0, 8);
  const scoreTone: "good" | "watch" | "bad" =
    report.status === "failed" || report.score < 55 ? "bad" : report.score < 75 ? "watch" : "good";

  return (
    <AppShell title="Workspace" subtitle="Workspace command center">
      <main className="seo-report-page">
        <div className="seo-report-shell">
          <header className="seo-report-header">
            <div>
              <p className="seo-report-kicker">SEO Audit</p>
              <h1>{report.origin}</h1>
              <p className="seo-report-sub">
                {siteLabel} - {statusLabel(report)} - scanned {fmtDate(report.scannedAt)}
              </p>
            </div>
            <div className="seo-report-score" data-tone={scoreTone}>
              <span>{report.status === "failed" ? "Failed" : report.score}</span>
              <small>{report.status === "failed" ? report.error?.code || "Scan error" : report.scoreBand}</small>
            </div>
          </header>

          <section className="seo-report-grid seo-report-grid-four">
            <MetricCard label="SEO Score" value={report.status === "failed" ? "0" : String(report.score)} detail={report.scoreBand} tone={scoreTone} />
            <MetricCard label="Pages Checked" value={fmtNumber(report.summary.pagesChecked)} detail="Single verified origin" />
            <MetricCard label="Issues Found" value={fmtNumber(report.summary.issuesFound)} detail={`${fmtNumber(report.summary.highPriorityCount)} high priority`} />
            <MetricCard
              label="Top Priority Fix"
              value={priority?.label || "No priority"}
              detail={priority?.severity || "Clean"}
              tone={priority ? toneForSeverity(priority.severity) : "good"}
            />
          </section>

          {report.status === "failed" ? (
            <section className="seo-report-panel seo-report-panel-alert">
              <div className="seo-report-section-head">
                <h2>Scan Did Not Complete</h2>
                <p>{report.error?.message || "CavBot could not complete this scan."}</p>
              </div>
            </section>
          ) : null}

          <section className="seo-report-grid seo-report-grid-two">
            <div className="seo-report-panel">
              <div className="seo-report-section-head">
                <h2>Search Preview</h2>
                <p>How the audited page presents its main indexable message.</p>
              </div>
              <div className="seo-report-preview">
                <div className="seo-report-preview-url">{report.finalUrl}</div>
                <h3>{valueOrDash(report.metadata.title)}</h3>
                <p>{valueOrDash(report.metadata.description)}</p>
                <div className="seo-report-preview-meta">
                  <span>Canonical: {valueOrDash(report.metadata.canonical)}</span>
                  <span>Icon: {report.favicon.primaryIconUrl ? "Detected" : "Not detected"}</span>
                </div>
              </div>
            </div>

            <div className="seo-report-panel">
              <div className="seo-report-section-head">
                <h2>Priority Fixes</h2>
                <p>Ranked by impact on crawlability, previews, and page clarity.</p>
              </div>
              <div className="seo-report-issues">
                {topIssues.length ? (
                  topIssues.map((issue) => <IssueRow issue={issue} key={issue.id} />)
                ) : (
                  <div className="seo-report-clean">No priority fixes were found in this scan.</div>
                )}
              </div>
            </div>
          </section>

          <section className="seo-report-panel">
            <div className="seo-report-section-head">
              <h2>Technical Checks</h2>
              <p>Grouped checks from the active CavBot SEO scan engine.</p>
            </div>
            <div className="seo-report-check-grid">
              {Object.entries(grouped).map(([title, checks]) => (
                <CheckGroup checks={checks} key={title} title={title} />
              ))}
            </div>
          </section>

          <RawDetails report={report} />
        </div>
      </main>
    </AppShell>
  );
}

export default async function SeoReportPage({ params }: PageProps) {
  noStore();

  const { scanId } = await params;
  const id = cleanScanId(scanId);
  if (!id) return <ReportUnavailable title="Missing scan" message="CavBot could not identify the requested SEO scan." />;

  const requestHeaders = await headers();
  const nextPath = `/seo/report/${encodeURIComponent(id)}`;
  const req = new Request(`${getAppOrigin()}${nextPath}`, {
    headers: new Headers(requestHeaders),
  });

  let session: Awaited<ReturnType<typeof requireWorkspaceSession>>;
  try {
    session = await requireWorkspaceSession(req);
  } catch (error) {
    if (isApiAuthError(error) && error.status === 401) {
      redirect(`/auth?next=${encodeURIComponent(nextPath)}`);
    }
    throw error;
  }

  await gateModuleAccess(req, "seo", "redirect");

  const scan = await prisma.scanJob.findFirst({
    where: {
      id,
      reason: {
        startsWith: "SEO_AUDIT",
      },
      project: {
        accountId: session.accountId,
        isActive: true,
      },
    },
    include: {
      site: {
        select: {
          label: true,
          origin: true,
        },
      },
    },
  });

  if (!scan) {
    return <ReportUnavailable title="Scan not found" message="This SEO scan is not available in the current workspace." />;
  }

  if (!isSeoScanReport(scan.resultJson)) {
    return <ReportUnavailable title="Report unavailable" message="The scan exists, but it does not contain a CavBot SEO report payload." />;
  }

  return <SeoReport report={scan.resultJson} siteLabel={scan.site?.label || scan.site?.origin || "Verified site"} />;
}
