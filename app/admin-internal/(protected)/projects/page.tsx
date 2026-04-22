import Link from "next/link";

import { AdminPage, MetricCard, Panel } from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
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
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectsPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/projects", { scopes: ["projects.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const projects = await prisma.project.findMany({
    where: { isActive: true, updatedAt: { gte: start, lt: end } },
    orderBy: { updatedAt: "desc" },
    take: 120,
    select: {
      id: true,
      name: true,
      slug: true,
      region: true,
      updatedAt: true,
      createdAt: true,
      account: {
        select: {
          id: true,
          name: true,
          tier: true,
        },
      },
      sites: {
        where: { isActive: true },
        select: { id: true, label: true, origin: true },
      },
      notices: {
        select: { id: true },
      },
      scanJobs: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          createdAt: true,
        },
      },
    },
  });
  const sites = await prisma.site.findMany({
    where: { isActive: true, updatedAt: { gte: start, lt: end } },
    orderBy: { updatedAt: "desc" },
    take: 120,
    select: {
      id: true,
      label: true,
      origin: true,
      rootDomain: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      project: {
        select: {
          id: true,
          name: true,
          slug: true,
          account: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
        },
      },
      scanJobs: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          issuesFound: true,
          overallScore: true,
          createdAt: true,
        },
      },
    },
  });
  const accountOwners = await getAccountOwners(Array.from(new Set([
    ...projects.map((project) => project.account.id),
    ...sites.map((site) => site.project.account.id),
  ])));

  const projectIds = projects.map((project) => project.id);
  const siteIds = sites.map((site) => site.id);
  const [sessionCounts, verifyCounts, guardCounts, graphs, siteVerifyCounts, siteGuardCounts, siteNotices] = await Promise.all([
    projectIds.length
      ? prisma.cavAiSession.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            createdAt: { gte: start, lt: end },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    projectIds.length
      ? prisma.adminEvent.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            createdAt: { gte: start, lt: end },
            name: "cavverify_rendered",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    projectIds.length
      ? prisma.adminEvent.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            createdAt: { gte: start, lt: end },
            name: "cavguard_rendered",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.cavAiWebsiteKnowledgeGraph.findMany({
          where: { siteId: { in: siteIds }, createdAt: { gte: start, lt: end } },
          orderBy: { createdAt: "desc" },
          select: {
            siteId: true,
            summaryJson: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.adminEvent.groupBy({
          by: ["siteId"],
          where: {
            siteId: { in: siteIds },
            createdAt: { gte: start, lt: end },
            name: "cavverify_rendered",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.adminEvent.groupBy({
          by: ["siteId"],
          where: {
            siteId: { in: siteIds },
            createdAt: { gte: start, lt: end },
            name: "cavguard_rendered",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    siteIds.length
      ? prisma.workspaceNotice.groupBy({
          by: ["siteId"],
          where: {
            siteId: { in: siteIds },
            createdAt: { gte: start, lt: end },
            dismissedAt: null,
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const sessionMap = new Map(sessionCounts.map((row) => [row.projectId, row._count._all]));
  const verifyMap = new Map(verifyCounts.map((row) => [row.projectId, row._count._all]));
  const guardMap = new Map(guardCounts.map((row) => [row.projectId, row._count._all]));
  const siteGraphMap = new Map<string, { pages: number; findings: number; brokenRoutes: number; errors: number }>();
  for (const graph of graphs) {
    if (!graph.siteId || siteGraphMap.has(graph.siteId)) continue;
    siteGraphMap.set(graph.siteId, {
      pages: readNumberPath(graph.summaryJson, ["metrics.pagesCrawled", "pageCount"]) || 0,
      findings: readNumberPath(graph.summaryJson, ["metrics.findingsTotal", "findingCount"]) || 0,
      brokenRoutes: readNumberPath(graph.summaryJson, ["metrics.brokenRouteFindings"]) || 0,
      errors: readNumberPath(graph.summaryJson, ["metrics.pagesWithErrors"]) || 0,
    });
  }
  const siteVerifyMap = new Map(siteVerifyCounts.map((row) => [row.siteId, row._count._all]));
  const siteGuardMap = new Map(siteGuardCounts.map((row) => [row.siteId, row._count._all]));
  const siteNoticeMap = new Map(siteNotices.map((row) => [row.siteId, row._count._all]));

  return (
    <AdminPage
      title="Projects"
      subtitle="Project-level operational view with the merged site inventory covering workspace ownership, monitored origins, scan posture, notices, sessions, and security usage."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Projects" value={formatInt(projects.length)} meta={`Active project inventory in ${rangeLabel}`} />
        <MetricCard label="Sites" value={formatInt(projects.reduce((sum, project) => sum + project.sites.length, 0))} meta="Active monitored sites" />
        <MetricCard label="Notices" value={formatInt(projects.reduce((sum, project) => sum + project.notices.length, 0))} meta="Project notices attached" />
        <MetricCard label="Verified sites" value={formatInt(sites.filter((site) => site.status === "VERIFIED").length)} meta="Verified site status" />
        <MetricCard label="Knowledge graphs" value={formatInt(siteGraphMap.size)} meta="Sites with route and SEO intelligence" />
        <MetricCard label="Site notices" value={formatInt(Array.from(siteNoticeMap.values()).reduce((sum, value) => sum + value, 0))} meta="Open notices mapped to a site" />
        <MetricCard
          label="Site security"
          value={formatInt(
            Array.from(siteVerifyMap.values()).reduce((sum, value) => sum + value, 0)
            + Array.from(siteGuardMap.values()).reduce((sum, value) => sum + value, 0),
          )}
          meta="Combined challenge and guard activity"
        />
      </section>

      <Panel title="Project inventory" subtitle="Workspace relationship, site footprint, latest scan state, session volume, and security load.">
        <div className="hq-tableWrap">
          <table className="hq-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Account</th>
                <th>Sites</th>
                <th>Scan posture</th>
                <th>Sessions</th>
                <th>Security</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.name || project.slug}</strong>
                    <span>{project.region} · {formatDateTime(project.createdAt)}</span>
                  </td>
                  <td>
                    <strong><Link href={`/accounts/${project.account.id}`}>{formatUserHandle(accountOwners.get(project.account.id))}</Link></strong>
                    <span>{project.account.tier}</span>
                  </td>
                  <td>
                    <strong>{formatInt(project.sites.length)}</strong>
                    <span>{project.sites.map((site) => site.origin).join(" · ")}</span>
                  </td>
                  <td>
                    <strong>{project.scanJobs[0]?.status || "No scan yet"}</strong>
                    <span>{project.scanJobs[0]?.createdAt ? formatDateTime(project.scanJobs[0].createdAt) : "No recent scan"}</span>
                  </td>
                  <td>
                    <strong>{formatInt(sessionMap.get(project.id) || 0)}</strong>
                    <span>{formatInt(project.notices.length)} notices</span>
                  </td>
                  <td>
                    <strong>{formatInt((verifyMap.get(project.id) || 0) + (guardMap.get(project.id) || 0))} events</strong>
                    <span>{formatInt(guardMap.get(project.id) || 0)} guard escalations</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AdminPage>
  );
}
