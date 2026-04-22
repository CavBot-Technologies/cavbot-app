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

export default async function CavGuardPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/security/cavguard", { scopes: ["security.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range);
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const events = await prisma.adminEvent.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      name: { in: ["cavguard_rendered", "cavguard_flagged", "cavguard_blocked", "cavguard_overridden"] },
    },
    orderBy: { createdAt: "asc" },
  });

  const renders = events.filter((event) => event.name === "cavguard_rendered").length;
  const flagged = events.filter((event) => event.name === "cavguard_flagged").length;
  const blocked = events.filter((event) => event.name === "cavguard_blocked").length;
  const overrides = events.filter((event) => event.name === "cavguard_overridden").length;
  const effectivenessRate = flagged > 0 ? (blocked / flagged) * 100 : 0;

  const trend = buildAdminTrendPoints(
    events.map((event) => ({
      date: event.createdAt,
      value: event.name === "cavguard_flagged" ? 1 : 0,
      secondaryValue: event.name === "cavguard_overridden" ? 1 : 0,
    })),
    range,
    month,
  );
  const recent = [...events].reverse().slice(0, 14);

  return (
    <AdminPage
      title="CavGuard"
      subtitle="Guard render traffic, flagged sessions, blocks, overrides, and recent guard effectiveness signals."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Renders" value={formatInt(renders)} meta="Guard modal or decision surfaces displayed" />
        <MetricCard label="Flagged" value={formatInt(flagged)} meta="Sessions marked for guard attention" />
        <MetricCard label="Blocked" value={formatInt(blocked)} meta="Protected actions blocked" />
        <MetricCard label="Overrides" value={formatInt(overrides)} meta="CTA or manual override activity" />
        <MetricCard label="Effectiveness" value={`${effectivenessRate.toFixed(1)}%`} meta="Blocked divided by flagged sessions" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Guard interventions"
          subtitle={`Flagged sessions versus override activity over ${rangeLabel}.`}
          labels={trend.map((point) => point.label)}
          primary={trend.map((point) => point.value)}
          secondary={trend.map((point) => point.secondaryValue || 0)}
          primaryLabel="Flagged"
          secondaryLabel="Overrides"
        />

        <Panel title="Recent CavGuard events" subtitle="Latest guard-related event records.">
          <div className="hq-list">
            {recent.map((event) => (
              <div key={event.id} className="hq-listRow">
                <div>
                  <div className="hq-listLabel">{event.name}</div>
                  <div className="hq-listMeta">{event.origin || event.sessionKey || "No origin"} · {formatDateTime(event.createdAt)}</div>
                </div>
                <Badge tone={event.name.includes("blocked") ? "bad" : event.name.includes("overridden") ? "watch" : "good"}>
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
