"use client";

import useSWR from "swr";
import StatusTimeline from "@/components/status/StatusTimeline";
import { STATUS_SEQUENCE, STATUS_UI_MAP } from "@/lib/status/ui";
import type { ServiceStatusState, StatusTimelinePayload } from "@/lib/status/types";

const DEFAULT_DAYS = 30;
const DEFAULT_POLL_MS = 15_000;
const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

async function fetchStatusTimeline(url: string): Promise<StatusTimelinePayload> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Status timeline request failed (${response.status})`);
  }
  const payload = (await response.json()) as Partial<StatusTimelinePayload>;
  if (!payload || !Array.isArray(payload.services)) {
    throw new Error("Status timeline payload was malformed");
  }
  return payload as StatusTimelinePayload;
}

function entryPercentLabel(value: number) {
  return `${value.toFixed(1)}%`;
}

export default function StatusTimelineSection({
  initialPayload,
  days = DEFAULT_DAYS,
  pollMs = DEFAULT_POLL_MS,
}: {
  initialPayload: StatusTimelinePayload;
  days?: number;
  pollMs?: number;
}) {
  const key = `/api/system-status/timeline?days=${encodeURIComponent(String(days))}`;
  const swr = useSWR<StatusTimelinePayload>(key, fetchStatusTimeline, {
    fallbackData: initialPayload,
    keepPreviousData: true,
    refreshInterval: Math.max(5_000, pollMs),
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    revalidateIfStale: true,
    dedupingInterval: 5_000,
  });

  const timelinePayload = swr.data ?? initialPayload;
  const legendItems: Array<{
    status: ServiceStatusState;
    label: string;
    color: string;
  }> = STATUS_SEQUENCE.map((status) => ({
    status,
    label: STATUS_UI_MAP[status].label,
    color: STATUS_UI_MAP[status].color,
  }));

  const timelineStats = timelinePayload.services.reduce(
    (acc, lane) => {
      lane.timeline.forEach((entry) => {
        acc.total += 1;
        acc.counts[entry.status] += 1;
      });
      return acc;
    },
    {
      total: 0,
      counts: {
        HEALTHY: 0,
        AT_RISK: 0,
        INCIDENT: 0,
        UNKNOWN: 0,
      },
    } as { total: number; counts: Record<ServiceStatusState, number> }
  );

  const timelinePercent = (status: ServiceStatusState) =>
    timelineStats.total ? (timelineStats.counts[status] / timelineStats.total) * 100 : 0;
  const historyPercentLabel = (status: ServiceStatusState) =>
    timelineStats.total ? entryPercentLabel(timelinePercent(status)) : entryPercentLabel(0);
  const timelineStatsFallbackSamples = timelinePayload.services.length * timelinePayload.days;
  const sampleCount = timelinePayload.global.samplesLogged ?? timelineStatsFallbackSamples;

  return (
    <section className="status-history status-history--uptime">
      <div className="status-historyHeader">
        <div>
          <h2>Uptime timeline</h2>
          <p>Last {timelinePayload.days} days</p>
        </div>
        <div className="status-historyHeaderStat">
          <span className="status-historyHeaderLabel">Samples logged</span>
          <strong>{sampleCount ? NUMBER_FORMATTER.format(sampleCount) : "—"}</strong>
        </div>
      </div>
      <div className="status-historyPanel">
        <div className="status-historyPanelHead">
          <div className="status-historyPanelMetrics" aria-label="Timeline distribution" role="list">
            {legendItems.map((item) => (
              <article
                key={`metric-${item.status}`}
                className="status-historyPanelMetric"
                data-status={item.status}
                role="listitem"
              >
                <span className="status-historyMetricLabel">{item.label}</span>
                <strong>{historyPercentLabel(item.status)}</strong>
                <span className="status-historyMetricSamples">
                  {NUMBER_FORMATTER.format(timelineStats.counts[item.status])} slots
                </span>
              </article>
            ))}
          </div>
        </div>
        <div className="status-historyGrid">
          <StatusTimeline services={timelinePayload.services} />
        </div>
      </div>
    </section>
  );
}
