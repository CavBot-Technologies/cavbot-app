import {
  formatDayKeyFromDateInTimeZone,
  formatHistoryMonthLabel,
  monthKeyFromDayKey,
  normalizeDayKey,
  normalizeMonthKey,
} from "@/lib/status/historyDate";
import type { StatusHistoryMonthIncident } from "@/lib/status/types";

export type HistorySelectionState = {
  selectedMonth: string;
  selectedDay: string | null;
};

export function selectHistoryMonth(
  state: HistorySelectionState,
  monthKey: string
): HistorySelectionState {
  const normalizedMonth = normalizeMonthKey(monthKey, state.selectedMonth);
  const keepSelectedDay = state.selectedDay && monthKeyFromDayKey(state.selectedDay) === normalizedMonth;
  return {
    selectedMonth: normalizedMonth,
    selectedDay: keepSelectedDay ? state.selectedDay : null,
  };
}

export function selectHistoryDay(
  _state: HistorySelectionState,
  dayKey: string
): HistorySelectionState {
  const normalizedDayKey = normalizeDayKey(dayKey);
  if (!normalizedDayKey) {
    return _state;
  }
  return {
    selectedMonth: monthKeyFromDayKey(normalizedDayKey),
    selectedDay: normalizedDayKey,
  };
}

export function getHistoryHeadingLabel(monthKey: string, timeZone: string) {
  return formatHistoryMonthLabel(monthKey, timeZone, false);
}

export function buildIncidentDayCounts(
  incidents: StatusHistoryMonthIncident[],
  timeZone: string
) {
  const byDay = new Map<string, number>();
  for (const incident of incidents) {
    const dayKey = formatDayKeyFromDateInTimeZone(new Date(incident.startedAt), timeZone);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);
  }
  return byDay;
}

export function filterIncidentsForSelectedDay(
  incidents: StatusHistoryMonthIncident[],
  selectedDay: string | null,
  timeZone: string
) {
  const normalizedDay = normalizeDayKey(selectedDay);
  if (!normalizedDay) return [];
  return incidents.filter((incident) => {
    const dayKey = formatDayKeyFromDateInTimeZone(new Date(incident.startedAt), timeZone);
    return dayKey === normalizedDay;
  });
}
