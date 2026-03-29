"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { SERVICE_DEFINITIONS } from "@/lib/status/constants";
import {
  addDaysToDayKey,
  addMonthsToMonthKey,
  buildCalendarGrid,
  formatDayKeyFromDateInTimeZone,
  formatHistoryDayLabel,
  formatHistoryMonthLabel,
  monthKeyFromDayKey,
  resolveHistoryTimeZone,
  isValidTimeZone,
} from "@/lib/status/historyDate";
import { getRandomStatusMessage } from "@/lib/status/messages";
import {
  buildIncidentDayCounts,
  filterIncidentsForSelectedDay,
  getHistoryHeadingLabel,
  selectHistoryDay,
  selectHistoryMonth,
  type HistorySelectionState,
} from "@/lib/status/historyView";
import type {
  IncidentImpact,
  IncidentStatus,
  ServiceKey,
  StatusHistoryMonthIncident,
  StatusHistoryMonthMetrics,
  StatusHistorySummaryCounts,
  StatusHistorySummaryState,
} from "@/lib/status/types";

type HistoryPayload = {
  monthKey: string;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
  summary: {
    state: StatusHistorySummaryState;
    counts: StatusHistorySummaryCounts;
  };
  incidents: StatusHistoryMonthIncident[];
  metrics: StatusHistoryMonthMetrics;
};

type StatusHistoryClientProps = {
  initialPayload: HistoryPayload;
  initialTimeZone?: string;
  lockInitialMonth?: boolean;
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const IMPACT_LABELS: Record<IncidentImpact, string> = {
  MINOR: "Minor impact",
  MAJOR: "Major impact",
  CRITICAL: "Critical impact",
};

function describeImpact(impact: IncidentImpact) {
  return IMPACT_LABELS[impact] ?? impact.toLowerCase();
}

function formatUpdatesLabel(count: number) {
  return `${count} update${count === 1 ? "" : "s"}`;
}

function getStatusTone(status: IncidentStatus) {
  if (status === "INVESTIGATING" || status === "IDENTIFIED") return "critical";
  if (status === "MONITORING") return "warning";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

function getStatusSentence(status: IncidentStatus, services: ServiceKey[], incidentId: string) {
  const baseMessage = getRandomStatusMessage(status, incidentId);
  const serviceLabel =
    services.length === 1
      ? SERVICE_DEFINITIONS[services[0]]?.displayName ?? services[0]
      : services.length > 1
      ? `${services.length} services`
      : "";
  if (!serviceLabel) {
    return baseMessage;
  }
  const trimmedMessage = baseMessage.trim().replace(/\.$/, "");
  return `${trimmedMessage} for ${serviceLabel}.`;
}

function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function resolveConfiguredTimeZone(browserTimeZone: string) {
  try {
    const response = await fetch("/api/notifications/settings", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      return resolveHistoryTimeZone(browserTimeZone, "UTC");
    }
    const payload = (await response.json().catch(() => null)) as
      | { settings?: { quietHoursTimezone?: unknown } }
      | null;
    const candidate = payload?.settings?.quietHoursTimezone;
    if (isValidTimeZone(candidate)) {
      return candidate;
    }
  } catch {}
  return resolveHistoryTimeZone(browserTimeZone, "UTC");
}

async function fetchHistoryPayload(monthKey: string, timeZone: string, signal: AbortSignal) {
  const query = new URLSearchParams();
  query.set("month", monthKey);
  query.set("tz", timeZone);
  const response = await fetch(`/api/status/history?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Failed to load history for ${monthKey}`);
  }
  return (await response.json()) as HistoryPayload;
}

export default function StatusHistoryClient({
  initialPayload,
  initialTimeZone = "UTC",
  lockInitialMonth = false,
}: StatusHistoryClientProps) {
  const safeInitialTimeZone = resolveHistoryTimeZone(initialTimeZone, "UTC");
  const [timeZone, setTimeZone] = useState(safeInitialTimeZone);
  const [selection, setSelection] = useState<HistorySelectionState>({
    selectedMonth: initialPayload.monthKey,
    selectedDay: null,
  });
  const [calendarMonthKey, setCalendarMonthKey] = useState(initialPayload.monthKey);
  const [payload, setPayload] = useState(initialPayload);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [focusedDayKey, setFocusedDayKey] = useState<string | null>(null);

  const userInteractedRef = useRef(false);
  const cacheRef = useRef<Map<string, HistoryPayload>>(
    new Map([[`${initialPayload.monthKey}|${safeInitialTimeZone}`, initialPayload]])
  );
  const calendarButtonRef = useRef<HTMLButtonElement | null>(null);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);

  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: "short",
      }),
    [timeZone]
  );
  const dayNumberFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        day: "2-digit",
      }),
    [timeZone]
  );
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: "numeric",
        minute: "numeric",
      }),
    [timeZone]
  );

  const activePayload = payload.monthKey === selection.selectedMonth ? payload : null;
  const incidents = useMemo(() => activePayload?.incidents ?? [], [activePayload]);
  const metrics = activePayload?.metrics;
  const todayDayKey = formatDayKeyFromDateInTimeZone(new Date(), timeZone);
  const calendarMonthLabel = formatHistoryMonthLabel(calendarMonthKey, timeZone);
  const monthLabel = getHistoryHeadingLabel(selection.selectedMonth, timeZone);
  const visibleIncidents = useMemo(
    () => filterIncidentsForSelectedDay(incidents, selection.selectedDay, timeZone),
    [incidents, selection.selectedDay, timeZone]
  );
  const incidentDayCounts = useMemo(
    () => buildIncidentDayCounts(incidents, timeZone),
    [incidents, timeZone]
  );
  const calendarGrid = useMemo(
    () => buildCalendarGrid(calendarMonthKey, timeZone),
    [calendarMonthKey, timeZone]
  );
  const calendarFocusedDay = focusedDayKey && monthKeyFromDayKey(focusedDayKey) === calendarMonthKey ? focusedDayKey : null;

  const totalIncidents = incidents.length;
  const summaryTone =
    activePayload && activePayload.summary.counts.INVESTIGATING > 0
      ? "critical"
      : activePayload && activePayload.summary.counts.MONITORING > 0
      ? "warning"
      : "healthy";
  const monthUptimeLabel = `${Math.min(100, Math.max(0, metrics?.uptimePct ?? 0)).toFixed(1)}%`;
  const summaryTitle =
    !activePayload && loadingMonth
      ? `Loading ${monthLabel}…`
      : !activePayload
      ? `Month data unavailable · ${monthLabel}`
      : totalIncidents
      ? `${totalIncidents} Incident${totalIncidents === 1 ? "" : "s"} Logged`
      : null;

  const closeCalendar = useCallback((restoreFocus: boolean) => {
    setCalendarOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        calendarButtonRef.current?.focus();
      });
    }
  }, []);

  const applyMonthSelection = useCallback((nextMonthKey: string) => {
    userInteractedRef.current = true;
    setSelection((prev) => selectHistoryMonth(prev, nextMonthKey));
    setCalendarMonthKey(nextMonthKey);
  }, []);

  const applyDaySelection = useCallback(
    (dayKey: string) => {
      userInteractedRef.current = true;
      setSelection((prev) => selectHistoryDay(prev, dayKey));
      setCalendarMonthKey(monthKeyFromDayKey(dayKey));
      closeCalendar(true);
    },
    [closeCalendar]
  );

  useEffect(() => {
    let cancelled = false;
    const browserTimeZone = resolveHistoryTimeZone(getBrowserTimeZone(), safeInitialTimeZone);
    setTimeZone(browserTimeZone);

    if (!lockInitialMonth && !userInteractedRef.current) {
      const currentMonthKey = formatDayKeyFromDateInTimeZone(new Date(), browserTimeZone).slice(0, 7);
      setSelection({ selectedMonth: currentMonthKey, selectedDay: null });
      setCalendarMonthKey(currentMonthKey);
    }

    void (async () => {
      const configuredTimeZone = await resolveConfiguredTimeZone(browserTimeZone);
      if (cancelled) return;
      setTimeZone(configuredTimeZone);
      if (!lockInitialMonth && !userInteractedRef.current) {
        const currentMonthKey = formatDayKeyFromDateInTimeZone(new Date(), configuredTimeZone).slice(0, 7);
        setSelection({ selectedMonth: currentMonthKey, selectedDay: null });
        setCalendarMonthKey(currentMonthKey);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lockInitialMonth, safeInitialTimeZone]);

  useEffect(() => {
    const requestKey = `${selection.selectedMonth}|${timeZone}`;
    const cached = cacheRef.current.get(requestKey);
    if (cached) {
      setPayload(cached);
      setLoadingMonth(false);
      setFetchError(null);
      return;
    }

    const controller = new AbortController();
    setLoadingMonth(true);
    setFetchError(null);

    void (async () => {
      try {
        const nextPayload = await fetchHistoryPayload(selection.selectedMonth, timeZone, controller.signal);
        if (controller.signal.aborted) return;
        cacheRef.current.set(requestKey, nextPayload);
        setPayload(nextPayload);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Status history client fetch failed:", error);
        setFetchError("Could not refresh this month. Please try again.");
      } finally {
        if (!controller.signal.aborted) {
          setLoadingMonth(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [selection.selectedMonth, timeZone]);

  useEffect(() => {
    if (!calendarOpen) return;
    const preferred =
      selection.selectedDay && monthKeyFromDayKey(selection.selectedDay) === calendarMonthKey
        ? selection.selectedDay
        : monthKeyFromDayKey(todayDayKey) === calendarMonthKey
        ? todayDayKey
        : `${calendarMonthKey}-01`;
    setFocusedDayKey(preferred);
  }, [calendarMonthKey, calendarOpen, selection.selectedDay, timeZone, todayDayKey]);

  useEffect(() => {
    if (!calendarOpen || !calendarFocusedDay) return;
    const selector = `button[data-history-day-key="${calendarFocusedDay}"]`;
    const frame = requestAnimationFrame(() => {
      const node = calendarPopoverRef.current?.querySelector<HTMLButtonElement>(selector);
      node?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [calendarFocusedDay, calendarMonthKey, calendarOpen]);

  useEffect(() => {
    if (!calendarOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (calendarPopoverRef.current?.contains(target)) return;
      if (calendarButtonRef.current?.contains(target)) return;
      closeCalendar(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCalendar(true);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [calendarOpen, closeCalendar]);

  const moveCalendarFocus = useCallback((dayKey: string, dayDelta: number) => {
    const nextDayKey = addDaysToDayKey(dayKey, dayDelta);
    setFocusedDayKey(nextDayKey);
    setCalendarMonthKey((prev) => {
      const nextMonth = monthKeyFromDayKey(nextDayKey);
      return nextMonth === prev ? prev : nextMonth;
    });
  }, []);

  const onDayCellKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, dayKey: string, isDisabled: boolean) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveCalendarFocus(dayKey, -1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveCalendarFocus(dayKey, 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveCalendarFocus(dayKey, -7);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveCalendarFocus(dayKey, 7);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (isDisabled) return;
        applyDaySelection(dayKey);
      }
    },
    [applyDaySelection, moveCalendarFocus]
  );

  const formatIncidentDayParts = useCallback(
    (timestamp: string) => {
      const date = new Date(timestamp);
      return {
        day: dayNumberFormatter.format(date),
        weekday: dayFormatter.format(date),
        time: timeFormatter.format(date),
      };
    },
    [dayFormatter, dayNumberFormatter, timeFormatter]
  );

  const selectedDayLabel = selection.selectedDay
    ? formatHistoryDayLabel(selection.selectedDay, timeZone)
    : null;

  return (
    <>
      <section className="status-history-toolbar">
        <div className="status-history-title">
          <h1 className="status-page-title">History</h1>
        </div>
        <div className="status-history-month-summary">
          {summaryTitle ? (
            <div className={`status-history-summary-chip is-${summaryTone}`}>{summaryTitle}</div>
          ) : null}
          <div className="status-history-date-control">
            <button
              ref={calendarButtonRef}
              type="button"
              className="status-history-calendar-trigger"
              aria-label={`Open calendar for ${monthLabel}`}
              aria-haspopup="dialog"
              aria-expanded={calendarOpen ? "true" : "false"}
              onClick={() => setCalendarOpen((open) => !open)}
            >
              <Image
                src="/icons/app/calendar-svgrepo-com.svg"
                alt=""
                aria-hidden="true"
                className="status-history-calendar-icon"
                width={16}
                height={16}
                unoptimized
              />
            </button>
            {calendarOpen ? (
              <div
                className="status-history-calendar-popover"
                role="dialog"
                aria-label="History date picker"
                ref={calendarPopoverRef}
              >
                <div className="status-history-calendar-head">
                  <button
                    type="button"
                    className="status-history-calendar-nav"
                    aria-label={`Show ${formatHistoryMonthLabel(addMonthsToMonthKey(calendarMonthKey, -1), timeZone)}`}
                    onClick={() => applyMonthSelection(addMonthsToMonthKey(calendarMonthKey, -1))}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <div className="status-history-calendar-title">{calendarMonthLabel}</div>
                  <button
                    type="button"
                    className="status-history-calendar-nav"
                    aria-label={`Show ${formatHistoryMonthLabel(addMonthsToMonthKey(calendarMonthKey, 1), timeZone)}`}
                    onClick={() => applyMonthSelection(addMonthsToMonthKey(calendarMonthKey, 1))}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                </div>

                <div className="status-history-calendar-weekdays" aria-hidden="true">
                  {WEEKDAY_LABELS.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>

                <div className="status-history-calendar-grid">
                  {calendarGrid.map((cell) => {
                    const count = incidentDayCounts.get(cell.dayKey) || 0;
                    const isToday = cell.dayKey === todayDayKey;
                    const isSelected = selection.selectedDay === cell.dayKey;
                    const inFocusedMonth = monthKeyFromDayKey(cell.dayKey) === calendarMonthKey;
                    const isFutureDay = cell.dayKey > todayDayKey;
                    const isDisabled = isFutureDay;
                    const dayLabel = formatHistoryDayLabel(cell.dayKey, timeZone);

                    return (
                      <button
                        key={cell.dayKey}
                        type="button"
                        className={[
                          "status-history-day-cell",
                          cell.inMonth ? "is-in-month" : "is-outside-month",
                          isToday ? "is-today" : "",
                          isSelected ? "is-selected" : "",
                          isDisabled ? "is-disabled" : "",
                          count > 0 ? "has-incidents" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-history-day-key={cell.dayKey}
                        aria-label={
                          isDisabled
                            ? `${dayLabel}, unavailable`
                            : count > 0
                            ? `${dayLabel}, ${count} incident${count === 1 ? "" : "s"}`
                            : `${dayLabel}, no incidents`
                        }
                        aria-pressed={isSelected ? "true" : "false"}
                        aria-disabled={isDisabled ? "true" : "false"}
                        tabIndex={
                          !isDisabled &&
                          (focusedDayKey === cell.dayKey ||
                            (!focusedDayKey && inFocusedMonth && cell.dayOfMonth === 1))
                            ? 0
                            : -1
                        }
                        onFocus={() => setFocusedDayKey(cell.dayKey)}
                        onKeyDown={(event) => onDayCellKeyDown(event, cell.dayKey, isDisabled)}
                        onClick={() => {
                          if (isDisabled) return;
                          applyDaySelection(cell.dayKey);
                        }}
                      >
                        <span>{cell.dayOfMonth}</span>
                        {count > 0 ? <span className="status-history-day-dot" aria-hidden="true"></span> : null}
                      </button>
                    );
                  })}
                </div>

              </div>
            ) : null}
          </div>
          {selectedDayLabel ? (
            <p className="status-history-day-caption">Showing incidents for {selectedDayLabel}.</p>
          ) : null}
          {fetchError ? <p className="status-history-fetch-error">{fetchError}</p> : null}
        </div>
      </section>

      <section className="status-history-list">
        {selection.selectedDay ? (
          visibleIncidents.length === 0 ? (
            <div className="status-history-empty">
              <p>No incidents recorded for {selectedDayLabel}.</p>
            </div>
          ) : (
            visibleIncidents.map((incident) => {
              const { day, weekday, time } = formatIncidentDayParts(incident.startedAt);
              const tone = getStatusTone(incident.status);
              const serviceCount = incident.affectedServices.length;
              const affectedLabel = `${serviceCount} service${serviceCount === 1 ? "" : "s"} affected`;
              const updatesLabel = formatUpdatesLabel(incident.updatesCount);
              const impactClass = incident.impact.toLowerCase();
              return (
                <Link
                  key={incident.id}
                  href={`/status/incidents/${incident.id}`}
                  className={`status-history-incident history-incident is-${tone}`}
                  aria-label={`Incident ${incident.title} started on ${weekday} ${day}`}
                >
                  <div className="status-history-incident-date">
                    <span className="status-history-date-day">{day}</span>
                    <span className="status-history-date-weekday">{weekday}</span>
                  </div>
                  <div className="status-history-incident-content">
                    <div className="status-history-incident-head">
                      <h2>{incident.title}</h2>
                      <span className="status-history-updates">{updatesLabel}</span>
                    </div>
                    <p className="status-history-incident-sub">
                      {getStatusSentence(incident.status, incident.affectedServices, incident.id)}
                    </p>
                    <div className="status-history-incident-flags">
                      <span
                        className={`status-history-incident-flag status-history-incident-flag--impact is-${impactClass}`}
                      >
                        {describeImpact(incident.impact)}
                      </span>
                      <span className="status-history-incident-flag status-history-incident-flag--updates">
                        {updatesLabel}
                      </span>
                      <span className="status-history-incident-flag status-history-incident-flag--services">
                        {affectedLabel}
                      </span>
                    </div>
                  </div>
                  <div className="status-history-incident-time">
                    <span>{time}</span>
                    <span className={`status-history-status-tag status-tag-${tone}`}>
                      {incident.status.toLowerCase()}
                    </span>
                  </div>
                </Link>
              );
            })
          )
        ) : incidents.length === 0 ? (
          <div className="status-history-empty">
            <p>No incidents recorded for {monthLabel}.</p>
            {metrics && metrics.sampleCount > 0 ? (
              <p>
                {metrics.sampleCount.toLocaleString()} health checks logged across{" "}
                {metrics.activeDays.toLocaleString()} day{metrics.activeDays === 1 ? "" : "s"} at{" "}
                {monthUptimeLabel} healthy.
              </p>
            ) : (
              <p>No live health samples were recorded for this month yet.</p>
            )}
          </div>
        ) : (
          <div className="status-history-empty">
            <p>
              {incidents.length.toLocaleString()} incident{incidents.length === 1 ? "" : "s"} logged in {monthLabel}.
            </p>
            <p>Select a day in the calendar to view incident details for that day.</p>
            {metrics ? (
              <p>
                {metrics.sampleCount.toLocaleString()} health checks logged at {monthUptimeLabel} healthy.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}
