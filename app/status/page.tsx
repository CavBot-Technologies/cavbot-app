import "./status.css";

import Link from "next/link";
import LocalTimestamp from "@/components/status/LocalTimestamp";
import StatusShell from "@/components/status/StatusShell";
import StatusLiveOverview from "@/components/status/StatusLiveOverview";
import StatusTimelineSection from "@/components/status/StatusTimelineSection";
import { SERVICE_DEFINITIONS } from "@/lib/status/constants";
import { getStatusPayload } from "@/lib/status/service";
import { STATUS_POLL_INTERVAL_MS } from "@/lib/status/checker";
import type { ServiceKey } from "@/lib/status/types";
import { getSystemStatusSnapshot, getSystemStatusTimeline } from "@/lib/system-status/pipeline";

export const metadata = {
  title: {
    absolute: "CavBot System Status",
  },
  description: "Live CavBot System Status dashboard with the latest service health signals.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function heroToneClass(status: "good" | "watch" | "incident") {
  if (status === "incident") return "tone-incident";
  if (status === "watch") return "tone-watch";
  return "tone-good";
}

function describeAffectedServices(services: ServiceKey[]) {
  if (!services.length) return "All CavBot services";
  return services
    .map((serviceKey) => SERVICE_DEFINITIONS[serviceKey]?.displayName ?? serviceKey)
    .join(", ");
}

function titleCaseLabel(value?: string | null) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default async function StatusPage() {
  const [statusPayload, timelinePayload, liveStatusSnapshot] = await Promise.all([
    getStatusPayload(),
    getSystemStatusTimeline(30),
    getSystemStatusSnapshot({ allowStale: true }),
  ]);

  const intervalMinutes = Math.max(1, Math.round(STATUS_POLL_INTERVAL_MS / 60000));
  const heroTone = heroToneClass(
    liveStatusSnapshot.summary.downCount > 0
      ? "incident"
      : liveStatusSnapshot.summary.atRiskCount > 0 || liveStatusSnapshot.summary.unknownCount > 0
      ? "watch"
      : "good"
  );

  const uptimePercentLabel = `${Math.min(100, Math.max(0, timelinePayload.global.uptimePct ?? 0)).toFixed(1)}%`;

  const incidents = statusPayload.incidents ?? [];
  const activeIncidents = incidents.filter((incident) => incident.status !== "RESOLVED");
  const resolvedIncidents = incidents.filter((incident) => incident.status === "RESOLVED");
  const hasIncidents = incidents.length > 0;
  const visibleIncidents = incidents.slice(0, 5);
  const incidentCountLabel =
    incidents.length > 0
      ? [
          activeIncidents.length ? `${activeIncidents.length} active` : null,
          resolvedIncidents.length ? `${resolvedIncidents.length} resolved` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <StatusShell toneClass={heroTone} variant="status">
      <StatusLiveOverview initialData={liveStatusSnapshot} />
      <StatusTimelineSection initialPayload={timelinePayload} />

        <section className="status-incidents">
          <div className="status-incidentsHeader">
            <div>
              <h2>Incidents</h2>
              <p>Active and recent investigations</p>
              {incidentCountLabel ? (
                <p className="status-incidentsMeta">{incidentCountLabel}</p>
              ) : null}
            </div>
            <span className="status-incidentsUpdated">
              Updated <LocalTimestamp value={statusPayload.updatedAt} fallback="Not checked yet" />
            </span>
          </div>
          {hasIncidents ? (
            <div className="status-incidentList">
              {visibleIncidents.map((incident) => (
                <article key={incident.id} className="status-incidentCard" data-tone={incident.status}>
                  <div className="status-incidentTop">
                    <span className="status-incidentBadge">{titleCaseLabel(incident.status)}</span>
                      <span className="status-incidentImpact">
                        {titleCaseLabel(incident.impact)}
                      </span>
                  </div>
                  <h3>{incident.title}</h3>
                  <p className="status-incidentMeta">
                    {incident.resolvedAt
                      ? (
                        <>
                          Started <LocalTimestamp value={incident.startedAt} fallback="—" /> · Resolved{" "}
                          <LocalTimestamp value={incident.resolvedAt} fallback="—" />
                        </>
                      )
                      : (
                        <>
                          Started <LocalTimestamp value={incident.startedAt} fallback="—" /> · {incident.status.toLowerCase()}
                        </>
                      )}
                  </p>
                  <div className="status-incidentDetailList">
                    <div>
                      <span className="status-incidentDetailLabel">Region</span>
                      <strong>{statusPayload.regionDefault || "Global"}</strong>
                    </div>
                    <div>
                      <span className="status-incidentDetailLabel">Affected services</span>
                      <strong>{describeAffectedServices(incident.affectedServices)}</strong>
                    </div>
                    <div>
                      <span className="status-incidentDetailLabel">Last checked</span>
                      <strong>
                        <LocalTimestamp value={statusPayload.updatedAt} fallback="Not checked yet" />
                      </strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <article className="status-incidentCard status-incidentCard--empty">
              <div className="status-incidentCardEmpty">
                <strong>No recent incidents</strong>
                <p>
                  Everything looks clean across our CavBot services. We still refresh this page every {intervalMinutes} minute(s).
                </p>
              </div>
            </article>
          )}
        </section>

        <footer className="status-footer">
          <div className="status-footerActions">
            <p className="status-footerUptime">
              Uptime for the current quarter: <strong>{uptimePercentLabel}</strong>
            </p>
            <Link className="status-footerBtn" href="/status/history">
              View history
            </Link>
          </div>
        </footer>
    </StatusShell>
  );
}
