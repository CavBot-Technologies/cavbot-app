import { prisma } from "@/lib/prisma";
import type {
  ServiceHistoryEntry,
  ServiceHistoryLane,
  ServiceKey,
  ServiceStatusPayload,
  ServiceStatusRow,
  ServiceStatusState,
  StatusHistoryPayload,
  StatusHistoryMonthPayload,
  StatusHistorySummaryCounts,
  StatusTimelinePayload,
  StatusTimelineSample,
  StatusTimelineService,
  IncidentDetailPayload,
  IncidentDetailUpdate,
  IncidentStatus,
} from "./types";
import { SERVICE_DEFINITIONS, SERVICE_ORDER } from "./constants";
import {
  formatMonthKeyFromDateInTimeZone,
  getMonthWindowUtcForTimeZone,
  normalizeMonthKey,
  resolveHistoryTimeZone,
} from "./historyDate";
import { clampDays, formatDayKey, ONE_DAY_MS, startOfDayUtc } from "./time";
import { getRandomStatusMessage } from "./messages";

type TimelineSampleRow = {
  serviceKey: ServiceKey;
  dayKey: string;
  status: ServiceStatusState;
  message: string;
  incidentId: string | null;
  component: string | null;
  durationMs: number | null;
  occurredAt: Date;
};

function normalizeCavToolsText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const legacyLower = ["d", "e", "v", "t", "o", "o", "l", "s"].join("");
  const legacyPascal = ["D", "e", "v", "T", "o", "o", "l", "s"].join("");
  const legacyPhrase = ["Developer", "Tools"].join(" ");
  const legacyPath = `/${legacyLower}\\b`;
  return value
    .replace(new RegExp(legacyPhrase, "gi"), "CavTools")
    .replace(new RegExp(legacyPath, "gi"), "/cavtools")
    .replace(new RegExp(`\\b${legacyPascal}\\b`, "g"), "CavTools")
    .replace(new RegExp(`\\b${legacyLower}\\b`, "g"), "CavTools");
}

const buildServiceRow = (key: ServiceKey): ServiceStatusRow => {
  return {
    serviceKey: key,
    displayName: SERVICE_DEFINITIONS[key].displayName,
    status: "UNKNOWN",
    lastCheckedAt: null,
    lastLatencyMs: null,
    region: SERVICE_DEFINITIONS[key].region ?? "Global",
    errorMessage: null,
    consecutiveFailures: 0,
    metaJson: null,
  };
};

const buildFallbackPayload = (): ServiceStatusPayload => ({
  services: SERVICE_ORDER.map(buildServiceRow),
  lastIncident: null,
  incidents: [],
  updatedAt: null,
  regionDefault: "Global",
  uptimeSeries: null,
});

export async function getStatusPayload(): Promise<ServiceStatusPayload> {
  try {
    const rows = await prisma.serviceStatus.findMany({
      where: { serviceKey: { in: SERVICE_ORDER } },
    });

    const rowMap = new Map<string, ServiceStatusRow>();
    for (const row of rows) {
      const key = row.serviceKey as ServiceKey;
      const canonicalDisplayName = SERVICE_DEFINITIONS[key]?.displayName || row.displayName;
      rowMap.set(row.serviceKey, {
        serviceKey: key,
        displayName: canonicalDisplayName,
        status: row.status as ServiceStatusState,
        lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
        lastLatencyMs: row.lastLatencyMs ?? null,
        region: row.region || "Global",
        errorMessage: normalizeCavToolsText(row.errorMessage),
        consecutiveFailures: row.consecutiveFailures ?? 0,
        metaJson: row.metaJson ?? null,
      });
    }

    const services = SERVICE_ORDER.map((key) => {
      const entry = rowMap.get(key);
      return entry ?? buildServiceRow(key);
    });

    const updatedAt =
      rows.length > 0
        ? new Date(
            Math.max(
              ...rows.map((row) => (row.lastCheckedAt ? row.lastCheckedAt.getTime() : 0)),
              0
            )
          ).toISOString()
        : null;

    const incidentRows = await prisma.incident.findMany({
      orderBy: { startedAt: "desc" },
      take: 6,
    });

    const mappedIncidents = incidentRows.map((row) => {
      const defaultMessage = getRandomStatusMessage(row.status, row.id);
      const bodyOverride = row.body ?? defaultMessage ?? null;
      return {
        id: row.id,
        title: normalizeCavToolsText(row.title) ?? row.title,
        status: row.status,
        impact: row.impact,
        body: normalizeCavToolsText(bodyOverride),
        affectedServices: (row.affectedServices ?? []) as ServiceKey[],
        startedAt: row.startedAt.toISOString(),
        resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      };
    });

    const resolvedIncidents = mappedIncidents.filter((incident) => incident.status === "RESOLVED");
    const activeIncidents = mappedIncidents.filter((incident) => incident.status !== "RESOLVED");
    const orderedIncidents = [...activeIncidents, ...resolvedIncidents];

    const lastIncident = orderedIncidents[0] ?? null;

    return {
      services,
      lastIncident,
      incidents: orderedIncidents,
      updatedAt,
      regionDefault: "Global",
      uptimeSeries: null,
    };
  } catch (error) {
    console.error("Failed to load status payload; falling back to defaults.", error);
    return buildFallbackPayload();
  }
}

export async function getStatusHistory(days = 30): Promise<StatusHistoryPayload> {
  const safeDays = clampDays(days);
  const windowStart = startOfDayUtc(Date.now() - (safeDays - 1) * ONE_DAY_MS);
  const rows = await prisma.serviceStatusHistory.findMany({
    where: {
      checkedAt: {
        gte: windowStart,
      },
    },
    orderBy: { checkedAt: "asc" },
  });

  const severity: Record<ServiceStatusState, number> = {
    INCIDENT: 4,
    AT_RISK: 3,
    UNKNOWN: 2,
    HEALTHY: 1,
  };

  const timelines: Record<ServiceKey, Map<string, ServiceStatusState>> = SERVICE_ORDER.reduce(
    (acc, key) => {
      acc[key] = new Map();
      return acc;
    },
    {} as Record<ServiceKey, Map<string, ServiceStatusState>>
  );

  for (const row of rows) {
    const key = row.serviceKey as ServiceKey;
    const serviceTimeline = timelines[key];
    if (!serviceTimeline) continue;
    const dayKey = startOfDayUtc(row.checkedAt.getTime()).toISOString();
    const previous = serviceTimeline.get(dayKey);
    const currentSeverity = severity[row.status as ServiceStatusState] ?? 0;
    const prevSeverity = previous ? severity[previous] ?? 0 : 0;
    if (!previous || currentSeverity >= prevSeverity) {
      serviceTimeline.set(dayKey, row.status as ServiceStatusState);
    }
  }

  const lanes: ServiceHistoryLane[] = SERVICE_ORDER.map((key) => {
    const serviceTimeline = timelines[key];
    const timeline: ServiceHistoryEntry[] = [];
    for (let idx = 0; idx < safeDays; idx += 1) {
      const day = new Date(windowStart.getTime() + idx * ONE_DAY_MS);
      const dayKey = day.toISOString();
      const status = serviceTimeline.get(dayKey) ?? "UNKNOWN";
      timeline.push({ ts: day.getTime(), status: status as ServiceStatusState });
    }
    return {
      serviceKey: key,
      displayName: SERVICE_DEFINITIONS[key].displayName,
      timeline,
    };
  });

  return {
    services: lanes,
    days: safeDays,
    updatedAt: rows.length ? rows[rows.length - 1].checkedAt.toISOString() : null,
    regionDefault: "Global",
  };
}

function timelineFallbackMessage(status: ServiceStatusState) {
  if (status === "HEALTHY") return "No incidents";
  if (status === "AT_RISK") return "Elevated latency or probe failures";
  if (status === "INCIDENT") return "Incident detected";
  return "No data";
}

function buildFallbackTimeline(safeDays: number, windowStart: Date): StatusTimelinePayload {
  const sampleDays = SERVICE_ORDER.map((key) => {
    const timeline: StatusTimelineSample[] = [];
    for (let idx = 0; idx < safeDays; idx += 1) {
      const dayDate = new Date(windowStart.getTime() + idx * ONE_DAY_MS);
      const dayKey = formatDayKey(dayDate);
      timeline.push({
        dayKey,
        ts: dayDate.getTime(),
        status: "UNKNOWN",
        message: timelineFallbackMessage("UNKNOWN"),
        incidentId: null,
        component: SERVICE_DEFINITIONS[key].displayName,
        durationMs: null,
      });
    }
    return {
      serviceKey: key,
      displayName: SERVICE_DEFINITIONS[key].displayName,
      timeline,
      uptimePct: 0,
    };
  });

  return {
    ok: true,
    days: safeDays,
    global: {
      uptimePct: 0,
      samplesLogged: 0,
    },
    services: sampleDays,
    updatedAt: null,
  };
}

async function buildHistoryTimelineSamples(windowStart: Date): Promise<TimelineSampleRow[]> {
  const historyRows = await prisma.serviceStatusHistory.findMany({
    where: {
      checkedAt: {
        gte: windowStart,
      },
      serviceKey: {
        in: SERVICE_ORDER,
      },
    },
    orderBy: [
      { serviceKey: "asc" },
      { checkedAt: "asc" },
    ],
  });

  return historyRows
    .map((row) => {
      const key = row.serviceKey as ServiceKey;
      const definition = SERVICE_DEFINITIONS[key];
      if (!definition) return null;
      return {
        serviceKey: key,
        dayKey: formatDayKey(row.checkedAt),
        status: row.status,
        message:
          normalizeCavToolsText(row.errorMessage?.trim()) ??
          timelineFallbackMessage(row.status),
        incidentId: null,
        component: definition.displayName,
        durationMs: row.latencyMs ?? null,
        occurredAt: row.checkedAt,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value != null);
}

export async function getStatusTimeline(days = 30): Promise<StatusTimelinePayload> {
  const safeDays = clampDays(days);
  const windowStart = startOfDayUtc(Date.now() - (safeDays - 1) * ONE_DAY_MS);
  try {
    const rawSamples = await prisma.statusSample.findMany({
      where: {
        occurredAt: {
          gte: windowStart,
        },
        service: {
          slug: {
            in: SERVICE_ORDER,
          },
        },
      },
      orderBy: [
        { serviceId: "asc" },
        { occurredAt: "asc" },
      ],
      include: {
        service: true,
      },
    });

    const normalizedSamples = rawSamples
      .map((row) => {
        const slug = row.service?.slug as ServiceKey | undefined;
        const definition = slug ? SERVICE_DEFINITIONS[slug] : undefined;
        if (!definition || !slug) return null;
        return {
          serviceKey: slug,
          dayKey: row.dayKey || formatDayKey(row.occurredAt),
          status: row.status,
          message:
            normalizeCavToolsText(row.message?.trim()) ||
            timelineFallbackMessage(row.status),
          incidentId: row.incidentId ?? null,
          component: definition.displayName,
          durationMs: row.durationMs ?? null,
          occurredAt: row.occurredAt,
        };
      })
      .filter((value): value is NonNullable<typeof value> => value != null);

    const timelineSamples =
      normalizedSamples.length > 0 ? normalizedSamples : await buildHistoryTimelineSamples(windowStart);

    const severity: Record<ServiceStatusState, number> = {
      INCIDENT: 4,
      AT_RISK: 3,
      UNKNOWN: 2,
      HEALTHY: 1,
    };

    const timelineMap = SERVICE_ORDER.reduce((acc, key) => {
      acc[key] = new Map<string, { sample: TimelineSampleRow; severity: number }>();
      return acc;
    }, {} as Record<ServiceKey, Map<string, { sample: TimelineSampleRow; severity: number }>>);

    for (const row of timelineSamples) {
      const map = timelineMap[row.serviceKey];
      if (!map) continue;
      const dayKey = row.dayKey;
      const currentSeverity = severity[row.status] ?? 0;
      const existing = map.get(dayKey);
      if (
        !existing ||
        currentSeverity > existing.severity ||
        (currentSeverity === existing.severity &&
          row.occurredAt.getTime() > existing.sample.occurredAt.getTime())
      ) {
        map.set(dayKey, { sample: row, severity: currentSeverity });
      }
    }

    const serviceRows: StatusTimelineService[] = [];
    let healthyCount = 0;
    let recordedEntries = 0;
    for (const key of SERVICE_ORDER) {
      const dayMap = timelineMap[key];
      let serviceHealthy = 0;
      let serviceRecorded = 0;
      const timeline: StatusTimelineSample[] = [];
      for (let idx = 0; idx < safeDays; idx += 1) {
        const dayDate = new Date(windowStart.getTime() + idx * ONE_DAY_MS);
        const dayKey = formatDayKey(dayDate);
        const entry = dayMap.get(dayKey);
        const status = (entry?.sample.status ?? "UNKNOWN") as ServiceStatusState;
        if (entry) {
          serviceRecorded += 1;
          recordedEntries += 1;
          if (status === "HEALTHY") {
            serviceHealthy += 1;
            healthyCount += 1;
          }
        }
        const message =
          normalizeCavToolsText(entry?.sample.message?.trim()) ||
          timelineFallbackMessage(status);
        const timestamp = entry?.sample.occurredAt?.getTime() ?? dayDate.getTime();
        timeline.push({
          dayKey,
          ts: timestamp,
          status,
          message,
          incidentId: entry?.sample.incidentId ?? null,
          component: SERVICE_DEFINITIONS[key].displayName,
          durationMs: entry?.sample.durationMs ?? null,
        });
      }
      const uptimePct = serviceRecorded ? (serviceHealthy / serviceRecorded) * 100 : 0;
      serviceRows.push({
        serviceKey: key,
        displayName: SERVICE_DEFINITIONS[key].displayName,
        timeline,
        uptimePct: Number(uptimePct.toFixed(2)),
      });
    }

    const globalUptime = recordedEntries ? (healthyCount / recordedEntries) * 100 : 0;
    const samplesLogged = timelineSamples.length;
    const updatedAt =
      samplesLogged > 0
        ? new Date(Math.max(...timelineSamples.map((entry) => entry.occurredAt.getTime()))).toISOString()
        : null;

    return {
      ok: true,
      days: safeDays,
      global: {
        uptimePct: Number(globalUptime.toFixed(2)),
        samplesLogged,
      },
      services: serviceRows,
      updatedAt,
    };
  } catch (error) {
    console.error("Failed to load status timeline; falling back to defaults.", error);
    return buildFallbackTimeline(safeDays, windowStart);
  }
}

function mapToSummaryStatus(status: IncidentStatus): keyof StatusHistorySummaryCounts {
  if (status === "MONITORING") return "MONITORING";
  if (status === "RESOLVED") return "RESOLVED";
  return "INVESTIGATING";
}

const INCIDENT_CANONICAL_STATUSES: IncidentStatus[] = [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
];

const INCIDENT_STATUS_ORDER_INDEX: Record<IncidentStatus, number> = INCIDENT_CANONICAL_STATUSES.reduce(
  (acc, status, index) => {
    acc[status] = index;
    return acc;
  },
  {} as Record<IncidentStatus, number>
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getIncidentTimelineLength(
  incidentStatus: IncidentStatus,
  updates: { status: IncidentStatus }[]
) {
  const incidentIndex = INCIDENT_STATUS_ORDER_INDEX[incidentStatus] ?? 0;
  const highestIndex = updates.reduce((max, update) => {
    const index = INCIDENT_STATUS_ORDER_INDEX[update.status] ?? 0;
    return index > max ? index : max;
  }, incidentIndex);
  return highestIndex + 1;
}

function extractAffectedServices(row: {
  affectedServices: string[];
  affectedServicesJson: unknown;
}) {
  if (Array.isArray(row.affectedServices) && row.affectedServices.length) {
    return row.affectedServices as ServiceKey[];
  }
  if (Array.isArray(row.affectedServicesJson)) {
    const keys = row.affectedServicesJson
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object") {
          const candidate = (entry as { serviceKey?: unknown }).serviceKey;
          if (typeof candidate === "string") {
            return candidate;
          }
        }
        return null;
      })
      .filter((value): value is string => Boolean(value));
    if (keys.length) {
      return keys as ServiceKey[];
    }
  }
  return [];
}

function buildMonthKeys(rows: { startedAt: Date }[], timeZone: string): string[] {
  const unique = new Set<string>();
  rows.forEach((row) => {
    unique.add(formatMonthKeyFromDateInTimeZone(row.startedAt, timeZone));
  });
  return Array.from(unique).sort();
}

export async function getStatusHistoryMonth(
  monthKey?: string,
  timeZoneInput?: string
): Promise<StatusHistoryMonthPayload> {
  const timeZone = resolveHistoryTimeZone(timeZoneInput, "UTC");
  const currentMonthKey = formatMonthKeyFromDateInTimeZone(new Date(), timeZone);
  const normalizedMonthKey = normalizeMonthKey(monthKey, currentMonthKey);
  const { start, end } = getMonthWindowUtcForTimeZone(normalizedMonthKey, timeZone);
  const fallbackCounts: StatusHistorySummaryCounts = {
    INVESTIGATING: 0,
    MONITORING: 0,
    RESOLVED: 0,
  };
  const fallbackPayload: StatusHistoryMonthPayload = {
    monthKey: normalizedMonthKey,
    prevMonthKey: null,
    nextMonthKey: null,
    summary: {
      state: "NO_INCIDENTS",
      counts: fallbackCounts,
    },
    incidents: [],
  };

  try {
    const monthRows = await prisma.incident.findMany({
      select: { startedAt: true },
      orderBy: { startedAt: "asc" },
    });
    const monthKeys = buildMonthKeys(monthRows, timeZone);
    const prevMonthKey = monthKeys.filter((key) => key < normalizedMonthKey).pop() ?? null;
    const nextMonthKey = monthKeys.find((key) => key > normalizedMonthKey) ?? null;

    const incidents = await prisma.incident.findMany({
      where: {
        startedAt: {
          gte: start,
          lt: end,
        },
      },
      orderBy: { startedAt: "desc" },
      include: {
        updates: {
          select: { status: true },
        },
      },
    });

    const counts: StatusHistorySummaryCounts = { ...fallbackCounts };

    const incidentRows = incidents.map((incident) => {
      const summaryKey = mapToSummaryStatus(incident.status);
      counts[summaryKey] += 1;
      return {
        id: incident.id,
        title: normalizeCavToolsText(incident.title) ?? incident.title,
        status: incident.status,
        impact: incident.impact,
        startedAt: incident.startedAt.toISOString(),
        resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
        updates: incident.updates,
        affectedServices: extractAffectedServices(incident),
      };
    });

    const incidentsPayload = incidentRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      impact: row.impact,
      startedAt: row.startedAt,
      resolvedAt: row.resolvedAt,
      affectedServices: row.affectedServices,
      updatesCount: row.updates.length,
    }));

    const summaryState =
      incidentsPayload.length > 0 ? "INCIDENTS_REPORTED" : "NO_INCIDENTS";

    return {
      monthKey: normalizedMonthKey,
      prevMonthKey,
      nextMonthKey,
      summary: {
        state: summaryState,
        counts,
      },
      incidents: incidentsPayload,
    };
  } catch (error) {
    console.error("Failed to load status history month; falling back.", error);
    return fallbackPayload;
  }
}

export async function getIncidentDetail(
  incidentId: string
): Promise<IncidentDetailPayload | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      updates: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!incident) return null;
  const affectedServices = extractAffectedServices(incident);
  const updates: IncidentDetailUpdate[] = incident.updates.map((update) => ({
    ts: update.createdAt.getTime(),
    status: update.status,
    message: normalizeCavToolsText(update.message) ?? update.message,
    affectedServices,
    metricsSnapshot: null,
  }));
  return {
    incident: {
      id: incident.id,
      title: normalizeCavToolsText(incident.title) ?? incident.title,
      status: incident.status,
      impact: incident.impact,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      affectedServices,
    },
    updates,
  };
}
