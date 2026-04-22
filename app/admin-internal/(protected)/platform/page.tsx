import {
  AdminPage,
  Badge,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatUserHandle,
  getAccountOwners,
  parseAdminMonth,
  parseAdminRange,
  readNumberPath,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { getSystemStatusSnapshot } from "@/lib/system-status/pipeline";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sharePercent(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function statusLabel(kind: "live" | "at_risk" | "down" | "unknown") {
  if (kind === "down") return "Incident";
  if (kind === "at_risk") return "At risk";
  if (kind === "live") return "Healthy";
  return "Unknown";
}

function statusChartKey(kind: "live" | "at_risk" | "down" | "unknown") {
  if (kind === "down") return "incident" as const;
  if (kind === "at_risk") return "at-risk" as const;
  if (kind === "live") return "healthy" as const;
  return "unknown" as const;
}

export default async function PlatformPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/platform", { scopes: ["platform.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const [scanJobs, recentScans, routeSnapshots, siteGraphs, liveStatusSnapshot, siteEvents, notices] = await Promise.all([
    prisma.scanJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        projectId: true,
        createdAt: true,
        finishedAt: true,
        pagesScanned: true,
        issuesFound: true,
        overallScore: true,
        site: {
          select: {
            origin: true,
            label: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            account: {
              select: { id: true, name: true },
            },
          },
        },
      },
    }),
    prisma.scanJob.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { status: true, createdAt: true },
    }),
    prisma.cavAiRouteManifestSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        accountId: true,
        projectId: true,
        createdAt: true,
        routeCount: true,
        coveredCount: true,
        heuristicCount: true,
        uncoveredCount: true,
        adapterCoverageRate: true,
      },
    }),
    prisma.cavAiWebsiteKnowledgeGraph.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        accountId: true,
        projectId: true,
        siteId: true,
        createdAt: true,
        summaryJson: true,
      },
    }),
    getSystemStatusSnapshot({ allowStale: false }),
    prisma.siteEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        message: true,
        tone: true,
        createdAt: true,
        site: {
          select: {
            label: true,
            origin: true,
            project: {
              select: {
                name: true,
                account: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.workspaceNotice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        tone: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
      },
    }),
  ]);
  const accountOwners = await getAccountOwners(
    Array.from(
      new Set([
        ...scanJobs.map((scan) => scan.project.account.id),
        ...siteEvents.map((event) => event.site.project.account.id),
        ...notices.map((notice) => notice.account.id),
      ]),
    ),
  );

  const scanTrend = buildAdminTrendPoints(
    recentScans.map((row) => ({ date: row.createdAt, value: row.status === "SUCCEEDED" ? 1 : 0, secondaryValue: row.status === "FAILED" ? 1 : 0 })),
    range,
    month,
  );
  const totalCoveredRoutes = routeSnapshots.reduce((sum, row) => sum + row.coveredCount, 0);
  const totalUncoveredRoutes = routeSnapshots.reduce((sum, row) => sum + row.uncoveredCount, 0);
  const avgCoverage = routeSnapshots.length
    ? routeSnapshots.reduce((sum, row) => sum + Number(row.adapterCoverageRate || 0), 0) / routeSnapshots.length
    : 0;

  const graphMetrics = siteGraphs.reduce(
    (acc, row) => {
      acc.pages += readNumberPath(row.summaryJson, ["metrics.pagesCrawled", "pageCount"]) || 0;
      acc.findings += readNumberPath(row.summaryJson, ["metrics.findingsTotal", "findingCount"]) || 0;
      acc.brokenRoutes += readNumberPath(row.summaryJson, ["metrics.brokenRouteFindings"]) || 0;
      acc.errors += readNumberPath(row.summaryJson, ["metrics.pagesWithErrors"]) || 0;
      acc.missingMetadata += readNumberPath(row.summaryJson, ["metrics.missingMetadataPages"]) || 0;
      return acc;
    },
    { pages: 0, findings: 0, brokenRoutes: 0, errors: 0, missingMetadata: 0 },
  );

  const healthyServices = liveStatusSnapshot.summary.liveCount;
  const atRiskServices = liveStatusSnapshot.summary.atRiskCount;
  const incidentServices = liveStatusSnapshot.summary.downCount;
  const totalServices = liveStatusSnapshot.services.length;
  const healthyPercent = sharePercent(healthyServices, totalServices);
  const atRiskPercent = sharePercent(atRiskServices, totalServices);
  const incidentPercent = sharePercent(incidentServices, totalServices);
  const healthDistribution = [
    { key: "healthy", label: "Healthy", count: healthyServices, percent: healthyPercent },
    { key: "at-risk", label: "At risk", count: atRiskServices, percent: atRiskPercent },
    { key: "incident", label: "Incident", count: incidentServices, percent: incidentPercent },
  ] as const;

  return (
    <AdminPage
      title="Platform"
      subtitle="Engine room for CavBot route intelligence, scan activity, notices, errors, and current service health."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Scan jobs" value={formatInt(scanJobs.length)} meta={`${formatInt(recentScans.filter((row) => row.status === "FAILED").length)} recent failures`} />
        <MetricCard label="Route coverage" value={formatInt(totalCoveredRoutes)} meta={`${formatInt(totalUncoveredRoutes)} uncovered · ${avgCoverage.toFixed(1)}% average`} />
        <MetricCard label="Pages crawled" value={formatInt(graphMetrics.pages)} meta={`${formatInt(graphMetrics.findings)} findings in recent knowledge graphs`} />
        <MetricCard label="Broken routes" value={formatInt(graphMetrics.brokenRoutes)} meta={`${formatInt(graphMetrics.errors)} pages with errors`} />
        <MetricCard label="Missing metadata" value={formatInt(graphMetrics.missingMetadata)} meta="SEO gaps from recent scans" />
        <MetricCard label="Open notices" value={formatInt(notices.filter((notice) => notice.tone !== "GOOD").length)} meta="Recent workspace notices needing attention" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Service health"
          subtitle={`Live CavBot service distribution across the current monitored set in ${rangeLabel}.`}
        >
          <div className="hq-platformHealthChartWrap">
            <div className="hq-platformHealthChart" role="img" aria-label="Service health distribution chart">
              {healthDistribution.map((status) => (
                <div key={status.key} className="hq-platformHealthBarColumn">
                  <div className="hq-platformHealthBarTrack" aria-hidden="true">
                    <div
                      className="hq-platformHealthBarFill"
                      data-status={status.key}
                      data-empty={status.count === 0 ? "true" : "false"}
                      style={{ height: `${status.count > 0 ? Math.max(status.percent, 12) : 6}%` }}
                    />
                  </div>
                  <div className="hq-platformHealthBarLabel">{status.label}</div>
                  <div className="hq-platformHealthBarSub" data-status={status.key}>{status.percent}%</div>
                  <div className="hq-platformHealthBarValue">{formatInt(status.count)}</div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
        <TrendChart
          title="Scan outcomes"
          subtitle={`Successful scan completions versus failures across ${rangeLabel}.`}
          labels={scanTrend.map((row) => row.label)}
          primary={scanTrend.map((row) => row.value)}
          secondary={scanTrend.map((row) => row.secondaryValue || 0)}
          primaryLabel="Succeeded"
          secondaryLabel="Failed"
        />
      </section>

      <section className="hq-grid hq-gridThree">
        <Panel title="Recent scans" subtitle="Newest site scans with score and issue counts.">
          <div className="hq-list">
            {scanJobs.slice(0, 8).map((scan) => (
              <div key={scan.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{formatUserHandle(accountOwners.get(scan.project.account.id))} · {scan.project.name || scan.project.slug}</div>
                  <div className="hq-listMeta">
                    {scan.site.origin} · {formatInt(scan.pagesScanned || 0)} pages · {formatInt(scan.issuesFound || 0)} issues
                  </div>
                </div>
                <Badge tone={scan.status === "FAILED" ? "bad" : scan.status === "RUNNING" ? "watch" : "good"}>
                  {scan.status}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Recent site events" subtitle="Operational events emitted from monitored sites.">
          <div className="hq-list">
            {siteEvents.map((event) => (
              <div key={event.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{formatUserHandle(accountOwners.get(event.site.project.account.id))} · {event.site.label}</div>
                  <div className="hq-listMeta">{event.type} · {event.message}</div>
                </div>
                <Badge tone={event.tone === "GOOD" ? "good" : event.tone === "WATCH" ? "watch" : "bad"}>
                  {formatDateTime(event.createdAt)}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Service status" subtitle="Latest live service checks from the shared CavBot status subsystem.">
          <div className="hq-list">
            {liveStatusSnapshot.services.map((service) => (
              <div key={service.key} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{service.label}</div>
                  <div className="hq-listMeta">
                    {typeof service.latencyMs === "number" ? `${formatInt(service.latencyMs)} ms` : "No latency yet"} · {formatDateTime(service.checkedAt)}
                  </div>
                </div>
                <div
                  className="hq-platformServiceState"
                  data-status={statusChartKey(service.status)}
                  aria-label={statusLabel(service.status)}
                  title={statusLabel(service.status)}
                >
                  <span className="hq-platformServiceStateDot" aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
