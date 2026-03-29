import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import StatusShell from "@/components/status/StatusShell";
import { getIncidentDetail, getStatusTimeline } from "@/lib/status/service";
import { ensureStatusSnapshotFresh } from "@/lib/status/checker";
import type {
  IncidentDetailUpdate,
  IncidentImpact,
  IncidentStatus,
  ServiceKey,
} from "@/lib/status/types";
import AffectedServicesPanel from "../components/AffectedServicesPanel";
import "../../status.css";
import "../../history/history.css";
import "../incident.css";
import {
  GENERIC_STATUS_MESSAGE_PATTERNS,
  getRandomStatusMessage,
  STATUS_RESPONSE_MESSAGES,
} from "@/lib/status/messages";

export const metadata = {
  title: {
    absolute: "CavBot Incident Status",
  },
  description: "Deep dive into individual CavBot incidents sourced directly from the status database.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: {
    incidentId: string;
  };
};

const STATUS_LABELS: Record<IncidentStatus, string> = {
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

function statusTone(status: IncidentStatus) {
  if (status === "INVESTIGATING") return "critical";
  if (status === "IDENTIFIED") return "identified";
  if (status === "MONITORING") return "warning";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

const resolvedFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const updateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const IMPACT_LABELS: Record<IncidentImpact, string> = {
  MINOR: "Minor impact",
  MAJOR: "Major impact",
  CRITICAL: "Critical impact",
};

function describeImpact(impact: IncidentImpact) {
  return IMPACT_LABELS[impact] ?? impact.toLowerCase();
}

const STATUS_ORDER_INDEX: Record<IncidentStatus, number> = {
  INVESTIGATING: 0,
  IDENTIFIED: 1,
  MONITORING: 2,
  RESOLVED: 3,
};

const CANONICAL_STATUSES: IncidentStatus[] = [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
];

function buildTimelineEntries(
  updates: IncidentDetailUpdate[],
  incident: {
    id: string;
    status: IncidentStatus;
    startedAt: string;
    resolvedAt: string | null;
    affectedServices: ServiceKey[];
  }
) {
  const seen = new Set<IncidentStatus>();
  const deduped: IncidentDetailUpdate[] = [];
  for (const update of updates) {
    if (!seen.has(update.status)) {
      seen.add(update.status);
      deduped.push(update);
    }
  }

  const highestStatusIndex = Math.max(
    ...deduped.map((update) => STATUS_ORDER_INDEX[update.status]),
    STATUS_ORDER_INDEX[incident.status]
  );

  const statusesToShow = CANONICAL_STATUSES.slice(0, highestStatusIndex + 1);

  const startTs = new Date(incident.startedAt).getTime();
  const resolvedTs = incident.resolvedAt
    ? new Date(incident.resolvedAt).getTime()
    : startTs + 3000;

  const fallbackTimestamps: Record<IncidentStatus, number> = {
    INVESTIGATING: startTs,
    IDENTIFIED: startTs + 1000,
    MONITORING: startTs + 2000,
    RESOLVED: Math.max(resolvedTs, startTs + 3000),
  };

  const statusToUpdate = new Map<IncidentStatus, IncidentDetailUpdate>();
  deduped.forEach((update) => {
    statusToUpdate.set(update.status, update);
  });

  return statusesToShow.map((status) => {
    if (statusToUpdate.has(status)) {
      return statusToUpdate.get(status)!;
    }
      return {
        ts: fallbackTimestamps[status],
        status,
        message: getRandomStatusMessage(status, incident.id),
        affectedServices: incident.affectedServices,
        metricsSnapshot: null,
      };
  });
}

function formatUpdateMessage(update: IncidentDetailUpdate) {
  const overrideMessage = STATUS_RESPONSE_MESSAGES[update.status];
  if (!overrideMessage) return update.message;
  const normalized = update.message?.trim().toLowerCase() ?? "";
  const isGeneric =
    !normalized || GENERIC_STATUS_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
  return isGeneric ? overrideMessage : update.message;
}

export default async function IncidentDetailPage({ params }: Params) {
  await ensureStatusSnapshotFresh();
  const [payload, timelinePayload] = await Promise.all([
    getIncidentDetail(params.incidentId),
    getStatusTimeline(30),
  ]);
  if (!payload) {
    notFound();
  }

  const { incident, updates } = payload;
  const uptimePercentValue = timelinePayload.global?.uptimePct ?? 0;
  const uptimePercentLabel = `${Math.min(100, Math.max(0, uptimePercentValue)).toFixed(1)}%`;
  const tone = statusTone(incident.status);
  const resolvedLabel = incident.resolvedAt
    ? resolvedFormatter.format(new Date(incident.resolvedAt))
    : null;
  const impactLabel = describeImpact(incident.impact);
  const badgeToneClass = incident.status === "RESOLVED" ? "" : "cavbot-auth-eye-error";
  const incidentMetaDescription = incident.resolvedAt
    ? `Started ${resolvedFormatter.format(new Date(incident.startedAt))} · Resolved ${resolvedLabel}`
    : `Started ${resolvedFormatter.format(new Date(incident.startedAt))} · ${incident.status.toLowerCase()}`;
  const timelineEntries = buildTimelineEntries(updates, incident);

  return (
    <StatusShell variant="incident">
      <div className="status-incident-shell">
        <header className="status-history-header status-incident-header">
          <div className="status-history-brand">
            <Link href="/" aria-label="CavBot home">
              <Image
              src="/logo/official-logotype-light.svg"
              alt="CavBot"
              width={180}
              height={50}
              priority
              unoptimized
            />
            </Link>
          </div>
          <div className="status-history-badge">
            <div className={`cb-badge cb-badge-inline ${badgeToneClass}`} aria-hidden="true">
              <div className="cavbot-badge-frame">
                <div className="cavbot-dm-avatar" data-cavbot-head="dm">
                  <div className="cavbot-dm-avatar-core">
                    <div className="cavbot-dm-face">
                      <div className="cavbot-eyes-row">
                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>

                        <div className="cavbot-eye">
                          <div className="cavbot-eye-inner">
                            <div className="cavbot-eye-track">
                              <div className="cavbot-eye-pupil"></div>
                            </div>
                          </div>
                          <div className="cavbot-eye-glow"></div>
                          <div className="cavbot-blink"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="status-history-toolbar status-incident-heroPanel">
          <div className="status-history-title status-incident-heroCopy" />
          <div className="status-history-month-summary status-incident-heroStats">
            <div className="status-incident-title-row">
              <span className={`status-incident-chip status-chip--${tone}`}>
                {STATUS_LABELS[incident.status]}
              </span>
              <span className="status-incident-impactLabel">{impactLabel}</span>
            </div>
          </div>
        </section>

        <section className="status-incidents status-incident-services">
          <header className="status-incidentsHeader">
            <p className="status-incidentsUpdated">{incidentMetaDescription}</p>
          </header>
          <AffectedServicesPanel services={incident.affectedServices} title={incident.title} />
        </section>

        <section className="status-history">
          <div className="status-incident-updates">
            <header>
            <h2>Updates</h2>
          </header>
            <div className="incident-timeline">
              {timelineEntries.length === 0 && (
                <p className="timeline-message">No updates have been recorded yet.</p>
              )}
              {timelineEntries.map((update, index) => {
                const dotTone = statusTone(update.status);
                const formattedMessage = formatUpdateMessage(update);
                const needsSpacing =
                  update.status === "INVESTIGATING" &&
                  formattedMessage === STATUS_RESPONSE_MESSAGES["INVESTIGATING"];
                return (
                  <article key={update.ts} className="incident-timeline-row">
                    <div className="timeline-dot-wrapper">
                      <span className={`timeline-dot timeline-dot--${dotTone}`} />
                      {index < timelineEntries.length - 1 && <span className="timeline-line" aria-hidden />}
                    </div>
                    <div className="incident-timeline-body">
                      <div className="timeline-header">
                        <span className={`status-chip status-chip--${dotTone}`}>
                          {STATUS_LABELS[update.status]}
                        </span>
                        <time dateTime={new Date(update.ts).toISOString()}>
                          {updateFormatter.format(new Date(update.ts))}
                        </time>
                      </div>
                      <p
                        className={`timeline-message${needsSpacing ? " timeline-message--spaced" : ""}`}
                      >
                        {formattedMessage}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <footer className="status-footer">
          <div className="status-footerActions">
            <p className="status-footerUptime">
              Uptime for the current quarter: <strong>{uptimePercentLabel}</strong>
            </p>
            <Link className="status-footerBtn" href="/status/history">
              View History
            </Link>
          </div>
        </footer>
      </div>
    </StatusShell>
  );
}
