export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDayUtc(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function clampDays(days: number) {
  if (!Number.isFinite(days)) return 30;
  return Math.max(7, Math.min(90, Math.floor(days)));
}

export function formatDayKey(date: Date) {
  const day = date instanceof Date ? date : new Date(date);
  const year = day.getUTCFullYear();
  const month = String(day.getUTCMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(day.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}
