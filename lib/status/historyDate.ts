const MONTH_KEY_REGEX = /^(\d{4})-(\d{2})$/;
const DAY_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

type DateParts = {
  year: number;
  month: number;
  day: number;
};

export type CalendarDayCell = {
  dayKey: string;
  dayOfMonth: number;
  inMonth: boolean;
};

const datePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>();

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseMonthKey(value: string | undefined | null): DateParts | null {
  if (!value) return null;
  const match = MONTH_KEY_REGEX.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month, day: 1 };
}

function parseDayKey(value: string | undefined | null): DateParts | null {
  if (!value) return null;
  const match = DAY_KEY_REGEX.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

function getDatePartsFormatter(timeZone: string) {
  const cached = datePartsFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  datePartsFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getOffsetFormatter(timeZone: string) {
  const cached = offsetFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  offsetFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getWeekdayFormatter(timeZone: string) {
  const cached = weekdayFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  weekdayFormatterCache.set(timeZone, formatter);
  return formatter;
}

function getDateParts(value: Date, timeZone: string) {
  const parts = getDatePartsFormatter(timeZone).formatToParts(value);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day") {
      lookup[part.type] = part.value;
    }
  }
  return {
    year: Number(lookup.year || 0),
    month: Number(lookup.month || 0),
    day: Number(lookup.day || 0),
  };
}

function getTimeZoneOffsetMinutes(value: Date, timeZone: string) {
  const zoneName =
    getOffsetFormatter(timeZone)
      .formatToParts(value)
      .find((part) => part.type === "timeZoneName")
      ?.value || "GMT";
  if (zoneName === "GMT" || zoneName === "UTC") return 0;
  const match = /(GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/.exec(zoneName);
  if (!match) return 0;
  const sign = match[2] === "-" ? -1 : 1;
  const hours = Number(match[3] || 0);
  const minutes = Number(match[4] || 0);
  return sign * (hours * 60 + minutes);
}

function formatMonthKeyFromParts(parts: DateParts) {
  return `${parts.year}-${pad2(parts.month)}`;
}

function formatDayKeyFromParts(parts: DateParts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function zonedDateTimeToUtcDate(
  input: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number; ms?: number },
  timeZone: string
) {
  const hour = input.hour ?? 0;
  const minute = input.minute ?? 0;
  const second = input.second ?? 0;
  const ms = input.ms ?? 0;
  const expectedUtc = Date.UTC(input.year, input.month - 1, input.day, hour, minute, second, ms);
  let candidate = expectedUtc;

  for (let idx = 0; idx < 3; idx += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(candidate), timeZone);
    const nextCandidate =
      Date.UTC(input.year, input.month - 1, input.day, hour, minute, second, ms) -
      offsetMinutes * 60_000;
    if (nextCandidate === candidate) break;
    candidate = nextCandidate;
  }

  return new Date(candidate);
}

function getWeekdayIndexForLocalDate(
  input: { year: number; month: number; day: number },
  timeZone: string
) {
  const utcDate = zonedDateTimeToUtcDate({ ...input, hour: 12 }, timeZone);
  const label = getWeekdayFormatter(timeZone).format(utcDate).slice(0, 3).toLowerCase();
  return WEEKDAY_INDEX[label] ?? 0;
}

function shiftUtcDateByDays(parts: DateParts, daysDelta: number) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysDelta));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function resolveHistoryTimeZone(
  value: string | null | undefined,
  fallback = "UTC"
) {
  if (isValidTimeZone(value)) return value;
  if (isValidTimeZone(fallback)) return fallback;
  return "UTC";
}

export function formatMonthKeyFromDateInTimeZone(value: Date | number, timeZone: string) {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const date = value instanceof Date ? value : new Date(value);
  const parts = getDateParts(date, safeTimeZone);
  return formatMonthKeyFromParts({ ...parts, day: 1 });
}

export function formatDayKeyFromDateInTimeZone(value: Date | number, timeZone: string) {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const date = value instanceof Date ? value : new Date(value);
  const parts = getDateParts(date, safeTimeZone);
  return formatDayKeyFromParts(parts);
}

export function normalizeMonthKey(input: string | undefined, fallbackKey: string) {
  const fallbackParsed = parseMonthKey(fallbackKey);
  const fallback = fallbackParsed
    ? formatMonthKeyFromParts(fallbackParsed)
    : formatMonthKeyFromDateInTimeZone(new Date(), "UTC");
  const parsed = parseMonthKey(input);
  if (!parsed) return fallback;
  return formatMonthKeyFromParts(parsed);
}

export function normalizeDayKey(input: string | null | undefined): string | null {
  const parsed = parseDayKey(input);
  if (!parsed) return null;
  return formatDayKeyFromParts(parsed);
}

export function monthKeyFromDayKey(dayKey: string) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey.slice(0, 7);
  return formatMonthKeyFromParts(parsed);
}

export function addMonthsToMonthKey(monthKey: string, delta: number) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}`;
}

export function addDaysToDayKey(dayKey: string, delta: number) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey;
  return formatDayKeyFromParts(shiftUtcDateByDays(parsed, delta));
}

export function getDaysInMonth(monthKey: string) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return 31;
  return new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
}

export function getMonthWindowUtcForTimeZone(monthKey: string, timeZone: string) {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const parsed = parseMonthKey(monthKey) ?? parseMonthKey(formatMonthKeyFromDateInTimeZone(new Date(), safeTimeZone));
  if (!parsed) {
    const now = new Date();
    return { start: now, end: now };
  }
  const start = zonedDateTimeToUtcDate(
    { year: parsed.year, month: parsed.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    safeTimeZone
  );
  const nextMonthKey = addMonthsToMonthKey(formatMonthKeyFromParts(parsed), 1);
  const nextParsed = parseMonthKey(nextMonthKey);
  if (!nextParsed) {
    const end = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000);
    return { start, end };
  }
  const end = zonedDateTimeToUtcDate(
    { year: nextParsed.year, month: nextParsed.month, day: 1, hour: 0, minute: 0, second: 0, ms: 0 },
    safeTimeZone
  );
  return { start, end };
}

export function formatHistoryMonthLabel(monthKey: string, timeZone: string, short = false) {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return monthKey;
  const date = zonedDateTimeToUtcDate(
    { year: parsed.year, month: parsed.month, day: 1, hour: 12, minute: 0, second: 0, ms: 0 },
    safeTimeZone
  );
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: safeTimeZone,
    month: short ? "short" : "long",
    year: "numeric",
  });
  return formatter.format(date);
}

export function formatHistoryDayLabel(dayKey: string, timeZone: string) {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey;
  const date = zonedDateTimeToUtcDate(
    { year: parsed.year, month: parsed.month, day: parsed.day, hour: 12, minute: 0, second: 0, ms: 0 },
    safeTimeZone
  );
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: safeTimeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return formatter.format(date);
}

export function buildCalendarGrid(monthKey: string, timeZone: string): CalendarDayCell[] {
  const safeTimeZone = resolveHistoryTimeZone(timeZone);
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return [];

  const firstWeekday = getWeekdayIndexForLocalDate(parsed, safeTimeZone);
  const daysInCurrentMonth = getDaysInMonth(monthKey);
  const prevMonthKey = addMonthsToMonthKey(monthKey, -1);
  const daysInPrevMonth = getDaysInMonth(prevMonthKey);
  const cells: CalendarDayCell[] = [];

  for (let idx = firstWeekday - 1; idx >= 0; idx -= 1) {
    const day = daysInPrevMonth - idx;
    const dayKey = `${prevMonthKey}-${pad2(day)}`;
    cells.push({
      dayKey,
      dayOfMonth: day,
      inMonth: false,
    });
  }

  for (let day = 1; day <= daysInCurrentMonth; day += 1) {
    cells.push({
      dayKey: `${monthKey}-${pad2(day)}`,
      dayOfMonth: day,
      inMonth: true,
    });
  }

  const totalCells = 42;
  let trailingDay = 1;
  const nextMonthKey = addMonthsToMonthKey(monthKey, 1);
  while (cells.length < totalCells) {
    cells.push({
      dayKey: `${nextMonthKey}-${pad2(trailingDay)}`,
      dayOfMonth: trailingDay,
      inMonth: false,
    });
    trailingDay += 1;
  }

  return cells;
}
