import { AdminPage, Badge, MetricCard, Panel, TrendChart } from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export default async function CavVerifyPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/security/cavverify", { scopes: ["security.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const events = await prisma.adminEvent.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      name: { in: ["cavverify_rendered", "cavverify_started", "cavverify_passed", "cavverify_failed", "cavverify_abandoned"] },
    },
    orderBy: { createdAt: "asc" },
  });

  const renders = events.filter((event) => event.name === "cavverify_rendered").length;
  const starts = events.filter((event) => event.name === "cavverify_started").length;
  const passes = events.filter((event) => event.name === "cavverify_passed").length;
  const fails = events.filter((event) => event.name === "cavverify_failed").length;
  const abandons = events.filter((event) => event.name === "cavverify_abandoned").length;
  const solveRate = starts > 0 ? (passes / starts) * 100 : 0;

  const bySession = new Map<string, { start?: Date; terminal?: Date }>();
  for (const event of events) {
    if (!event.sessionKey) continue;
    const existing = bySession.get(event.sessionKey) || {};
    if (event.name === "cavverify_started" && !existing.start) existing.start = event.createdAt;
    if ((event.name === "cavverify_passed" || event.name === "cavverify_failed" || event.name === "cavverify_abandoned") && !existing.terminal) {
      existing.terminal = event.createdAt;
    }
    bySession.set(event.sessionKey, existing);
  }
  const solveTimes = Array.from(bySession.values())
    .filter((row) => row.start && row.terminal)
    .map((row) => Math.max(0, (row.terminal!.getTime() - row.start!.getTime()) / 1000));
  const medianSolveTimeSeconds = median(solveTimes);

  const trend = buildAdminTrendPoints(
    events.map((event) => ({
      date: event.createdAt,
      value: event.name === "cavverify_rendered" ? 1 : 0,
      secondaryValue: event.name === "cavverify_passed" ? 1 : 0,
    })),
    range,
    month,
  );
  const recent = [...events].reverse().slice(0, 14);

  return (
    <AdminPage
      title="Caverify"
      subtitle="Challenge traffic, starts, solve rate, failures, abandons, median solve time, and recent verify events."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Renders" value={formatInt(renders)} meta="Challenge surfaces displayed" />
        <MetricCard label="Starts" value={formatInt(starts)} meta="Verification starts recorded" />
        <MetricCard label="Passed" value={formatInt(passes)} meta="Successful verification completions" />
        <MetricCard label="Failed" value={formatInt(fails)} meta="Rejected or failed challenge outcomes" />
        <MetricCard label="Abandoned" value={formatInt(abandons)} meta="User abandons or client fallback exits" />
        <MetricCard label="Solve rate" value={`${solveRate.toFixed(1)}%`} meta="Passes divided by starts" />
        <MetricCard label="Median solve time" value={`${formatInt(medianSolveTimeSeconds)}s`} meta="Derived from started-to-terminal event pairs" />
        <MetricCard label="Tracked sessions" value={formatInt(bySession.size)} meta="Session keys with verify activity" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Verify traffic"
          subtitle={`Rendered challenges versus successful completions over ${rangeLabel}.`}
          labels={trend.map((point) => point.label)}
          primary={trend.map((point) => point.value)}
          secondary={trend.map((point) => point.secondaryValue || 0)}
          primaryLabel="Rendered"
          secondaryLabel="Passed"
        />

        <Panel title="Recent Caverify events" subtitle="Latest event records for verification activity.">
          <div className="hq-list">
            {recent.map((event) => (
              <div key={event.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{event.name}</div>
                  <div className="hq-listMeta">{event.origin || event.sessionKey || "No origin"} · {formatDateTime(event.createdAt)}</div>
                </div>
                <Badge tone={event.name.includes("passed") ? "good" : event.name.includes("failed") ? "bad" : "watch"}>
                  {event.result || "event"}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </AdminPage>
  );
}
