import "server-only";

import { Prisma } from "@prisma/client";

import { isSubscriptionEntitled, isTrialSeatEntitled, resolveEffectivePlanId } from "@/lib/accountPlan.server";
import { PLANS, resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";

export type TrendPoint = {
  key: string;
  label: string;
  value: number;
  secondaryValue?: number;
};

export type AdminRangeKey = "24h" | "7d" | "30d";
export type AdminMonthKey = `${number}-${string}`;
export type AdminWindow = {
  range: AdminRangeKey;
  month: AdminMonthKey | null;
  start: Date;
  end: Date;
  label: string;
  mode: "range" | "month";
};

export function safeNumber(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatInt(value: unknown) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(safeNumber(value));
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBytes(value: unknown, digits = 1) {
  const bytes = safeNumber(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = unitIndex === 0 ? 0 : digits;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function formatPercent(value: number, digits = 1) {
  const normalized = Number.isFinite(value) ? value : 0;
  return `${normalized.toFixed(digits)}%`;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function parsePage(raw: string | null | undefined, fallback = 1) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

export function offsetForPage(page: number, pageSize: number) {
  return Math.max(0, (Math.max(1, page) - 1) * Math.max(1, pageSize));
}

export function buildPageHref(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
  nextPage: number,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry) params.append(key, entry);
      }
      continue;
    }
    if (value) params.set(key, value);
  }
  params.set("page", String(Math.max(1, nextPage)));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function initialsFrom(value: string | null | undefined) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "CB";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "CB";
}

export function emailLocalPart(value: string | null | undefined) {
  const email = String(value || "").trim();
  if (!email) return "";
  return email.split("@")[0]?.trim() || "";
}

export function formatUserHandle(
  user:
    | {
        username?: string | null;
        email?: string | null;
        displayName?: string | null;
        fullName?: string | null;
      }
    | null
    | undefined,
  fallback = "No owner",
) {
  if (user?.username) return `@${user.username}`;
  const local = emailLocalPart(user?.email);
  if (local) return `@${local}`;
  if (user?.displayName) return user.displayName;
  if (user?.fullName) return user.fullName;
  return fallback;
}

export function formatUserName(
  user:
    | {
        fullName?: string | null;
        displayName?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
  fallback = "No owner",
) {
  if (user?.fullName) return user.fullName;
  if (user?.displayName) return user.displayName;
  if (user?.email) return user.email;
  return fallback;
}

export function formatAdminPlanName(tier: string | null | undefined) {
  const token = String(tier || "").trim().toUpperCase();
  if (!token || token === "FREE") return "Free";
  if (token === "PREMIUM") return "Premium";
  if (token === "ENTERPRISE") return "Premium+";
  const plan = PLANS[resolvePlanIdFromTier(token)];
  return plan?.displayName || token;
}

type AdminPlanDisplayArgs = {
  status?: string | null;
  tier?: string | null;
  subscriptionTier?: string | null;
  currentPeriodEnd?: Date | string | null;
  trialSeatActive?: boolean | null;
  trialEndsAt?: Date | string | null;
  now?: Date;
};

function parseAdminDateMs(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function adminPlanTierFromPlanId(planId: PlanId): "FREE" | "PREMIUM" | "ENTERPRISE" {
  if (planId === "premium_plus") return "ENTERPRISE";
  if (planId === "premium") return "PREMIUM";
  return "FREE";
}

function resolveAdminPlanState(args: AdminPlanDisplayArgs) {
  const nowMs = args.now instanceof Date && Number.isFinite(args.now.getTime())
    ? args.now.getTime()
    : Date.now();
  const status = String(args.status || "").trim().toUpperCase();
  const subscriptionTier = String(args.subscriptionTier || args.tier || "FREE").trim().toUpperCase();
  const account = {
    tier: args.tier,
    trialSeatActive: args.trialSeatActive,
    trialEndsAt: args.trialEndsAt,
  };
  const subscription = {
    tier: subscriptionTier,
    status: args.status,
    currentPeriodEnd: args.currentPeriodEnd,
  };
  const subscriptionPeriodEndMs = parseAdminDateMs(args.currentPeriodEnd);
  const isSubscriptionTrialing = status === "TRIALING"
    && resolvePlanIdFromTier(subscriptionTier) === "free"
    && subscriptionPeriodEndMs != null
    && subscriptionPeriodEndMs > nowMs;
  const planId = resolveEffectivePlanId({
    account,
    subscription,
    now: nowMs,
  });

  return {
    status,
    planId,
    planTier: adminPlanTierFromPlanId(planId),
    isTrialing: isTrialSeatEntitled(account, nowMs) || isSubscriptionTrialing,
    isSubscriptionEntitled: isSubscriptionEntitled(subscription, nowMs),
  };
}

export function formatAdminSubscriptionLabel(args: AdminPlanDisplayArgs) {
  const planState = resolveAdminPlanState(args);
  if (planState.isTrialing) return "Trialing";
  if (planState.status === "ACTIVE" && planState.isSubscriptionEntitled) return "Active";
  if (planState.status === "PAST_DUE" && planState.isSubscriptionEntitled) return "Past due";
  if (planState.status === "CANCELED") return "Canceled";
  return formatAdminPlanName(planState.planTier);
}

export function resolveAdminPlanDisplay(args: AdminPlanDisplayArgs) {
  const planState = resolveAdminPlanState(args);
  return {
    isTrialing: planState.isTrialing,
    planId: planState.planId,
    planTier: planState.planTier,
    planLabel: planState.isTrialing ? "Trialing" : formatAdminPlanName(planState.planTier),
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readNumberPath(source: unknown, paths: string[]) {
  const root = asRecord(source);
  if (!root) return null;

  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = root;
    for (const part of parts) {
      const record = asRecord(current);
      if (!record || !(part in record)) {
        current = null;
        break;
      }
      current = record[part];
    }
    const value = safeNumber(current);
    if (Number.isFinite(value) && value !== 0) return value;
    if (current === 0) return 0;
  }

  return null;
}

export function parseRangeDays(raw: string | null | undefined, fallback = 30) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) return fallback;
  return Math.min(180, normalized);
}

export function parseAdminRange(raw: string | null | undefined, fallback: AdminRangeKey = "30d"): AdminRangeKey {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "24h" || value === "7d" || value === "30d") return value;
  return fallback;
}

export function parseAdminMonth(raw: string | null | undefined): AdminMonthKey | null {
  const value = String(raw || "").trim();
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${yearRaw}-${monthRaw}` as AdminMonthKey;
}

export function adminRangeDays(range: AdminRangeKey) {
  if (range === "24h") return 1;
  if (range === "7d") return 7;
  return 30;
}

export function adminRangeStart(range: AdminRangeKey) {
  return rangeStart(adminRangeDays(range));
}

export function adminRangeLabel(range: AdminRangeKey) {
  if (range === "24h") return "last 24 hours";
  if (range === "7d") return "last 7 days";
  return "last 30 days";
}

export function currentAdminMonth() {
  const date = currentDate();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}` as AdminMonthKey;
}

export function currentDate() {
  return new Date();
}

export function rangeStart(days: number) {
  return new Date(currentDate().getTime() - days * 24 * 60 * 60 * 1000);
}

export function futureDate(days: number) {
  return new Date(currentDate().getTime() + days * 24 * 60 * 60 * 1000);
}

export function adminMonthStart(month: AdminMonthKey) {
  const [yearRaw, monthRaw] = month.split("-");
  return new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, 1));
}

export function adminMonthEnd(month: AdminMonthKey) {
  const [yearRaw, monthRaw] = month.split("-");
  return new Date(Date.UTC(Number(yearRaw), Number(monthRaw), 1));
}

export function adminMonthLabel(month: AdminMonthKey) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(adminMonthStart(month));
}

export function resolveAdminWindow(range: AdminRangeKey, month?: AdminMonthKey | null): AdminWindow {
  if (month) {
    return {
      range,
      month,
      start: adminMonthStart(month),
      end: adminMonthEnd(month),
      label: adminMonthLabel(month),
      mode: "month",
    };
  }

  return {
    range,
    month: null,
    start: adminRangeStart(range),
    end: currentDate(),
    label: adminRangeLabel(range),
    mode: "range",
  };
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function addDaysUtc(date: Date, amount: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function addHoursUtc(date: Date, amount: number) {
  const next = new Date(date.getTime());
  next.setUTCHours(next.getUTCHours() + amount);
  return next;
}

function isoDay(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function isoHour(date: Date) {
  const day = isoDay(date);
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${day}T${hour}`;
}

function hourLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
}

export function buildTrendPoints(input: Array<{ date: Date; value: number; secondaryValue?: number }>, days: number) {
  const end = startOfUtcDay(new Date());
  const start = addDaysUtc(end, -(days - 1));
  const map = new Map<string, { value: number; secondaryValue: number }>();

  for (const row of input) {
    const key = isoDay(startOfUtcDay(row.date));
    const existing = map.get(key) || { value: 0, secondaryValue: 0 };
    existing.value += safeNumber(row.value);
    existing.secondaryValue += safeNumber(row.secondaryValue);
    map.set(key, existing);
  }

  const out: TrendPoint[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const current = addDaysUtc(start, offset);
    const key = isoDay(current);
    const value = map.get(key) || { value: 0, secondaryValue: 0 };
    out.push({
      key,
      label: dayLabel(current),
      value: value.value,
      secondaryValue: value.secondaryValue,
    });
  }

  return out;
}

export function buildWindowTrendPoints(
  input: Array<{ date: Date; value: number; secondaryValue?: number }>,
  range: AdminRangeKey,
) {
  if (range !== "24h") return buildTrendPoints(input, adminRangeDays(range));

  const end = startOfUtcHour(new Date());
  const start = addHoursUtc(end, -23);
  const map = new Map<string, { value: number; secondaryValue: number }>();

  for (const row of input) {
    const key = isoHour(startOfUtcHour(row.date));
    const existing = map.get(key) || { value: 0, secondaryValue: 0 };
    existing.value += safeNumber(row.value);
    existing.secondaryValue += safeNumber(row.secondaryValue);
    map.set(key, existing);
  }

  const out: TrendPoint[] = [];
  for (let offset = 0; offset < 24; offset += 1) {
    const current = addHoursUtc(start, offset);
    const key = isoHour(current);
    const value = map.get(key) || { value: 0, secondaryValue: 0 };
    out.push({
      key,
      label: hourLabel(current),
      value: value.value,
      secondaryValue: value.secondaryValue,
    });
  }

  return out;
}

export function buildMonthTrendPoints(
  input: Array<{ date: Date; value: number; secondaryValue?: number }>,
  month: AdminMonthKey,
) {
  const start = adminMonthStart(month);
  const end = adminMonthEnd(month);
  const map = new Map<string, { value: number; secondaryValue: number }>();

  for (const row of input) {
    if (row.date < start || row.date >= end) continue;
    const key = isoDay(startOfUtcDay(row.date));
    const existing = map.get(key) || { value: 0, secondaryValue: 0 };
    existing.value += safeNumber(row.value);
    existing.secondaryValue += safeNumber(row.secondaryValue);
    map.set(key, existing);
  }

  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
  const out: TrendPoint[] = [];
  for (let offset = 0; offset < totalDays; offset += 1) {
    const current = addDaysUtc(start, offset);
    const key = isoDay(current);
    const value = map.get(key) || { value: 0, secondaryValue: 0 };
    out.push({
      key,
      label: dayLabel(current),
      value: value.value,
      secondaryValue: value.secondaryValue,
    });
  }
  return out;
}

export function buildAdminTrendPoints(
  input: Array<{ date: Date; value: number; secondaryValue?: number }>,
  range: AdminRangeKey,
  month?: AdminMonthKey | null,
) {
  if (month) return buildMonthTrendPoints(input, month);
  return buildWindowTrendPoints(input, range);
}

export async function getAccountOwners(accountIds: string[]) {
  if (!accountIds.length) {
    return new Map<string, {
      userId: string;
      email: string;
      username: string | null;
      displayName: string | null;
      fullName: string | null;
      avatarImage: string | null;
      avatarTone: string | null;
    }>();
  }

  const rows = await prisma.membership.findMany({
    where: {
      accountId: { in: accountIds },
      role: "OWNER",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      accountId: true,
      userId: true,
      user: {
        select: {
          email: true,
          username: true,
          displayName: true,
          fullName: true,
          avatarImage: true,
          avatarTone: true,
        },
      },
    },
  });

  const map = new Map<string, {
    userId: string;
    email: string;
    username: string | null;
    displayName: string | null;
    fullName: string | null;
    avatarImage: string | null;
    avatarTone: string | null;
  }>();
  for (const row of rows) {
    if (!map.has(row.accountId)) {
      map.set(row.accountId, {
        userId: row.userId,
        email: row.user.email,
        username: row.user.username,
        displayName: row.user.displayName,
        fullName: row.user.fullName,
        avatarImage: row.user.avatarImage,
        avatarTone: row.user.avatarTone,
      });
    }
  }
  return map;
}

export async function getAccountFootprints(accountIds: string[]) {
  if (!accountIds.length) {
    return new Map<string, {
      projects: number;
      sites: number;
      members: number;
      notices: number;
      scans: number;
      notifications: number;
    }>();
  }

  const ids = Prisma.join(accountIds);
  const rows = await prisma.$queryRaw<Array<{
    accountId: string;
    projects: bigint;
    sites: bigint;
    members: bigint;
    notices: bigint;
    scans: bigint;
    notifications: bigint;
  }>>(Prisma.sql`
    SELECT
      a."id" AS "accountId",
      COUNT(DISTINCT p."id") AS "projects",
      COUNT(DISTINCT s."id") AS "sites",
      COUNT(DISTINCT m."id") AS "members",
      COUNT(DISTINCT wn."id") + COUNT(DISTINCT pn."id") AS "notices",
      COUNT(DISTINCT sj."id") AS "scans",
      COUNT(DISTINCT n."id") AS "notifications"
    FROM "Account" a
    LEFT JOIN "Project" p ON p."accountId" = a."id" AND p."isActive" = true
    LEFT JOIN "Site" s ON s."projectId" = p."id" AND s."isActive" = true
    LEFT JOIN "Membership" m ON m."accountId" = a."id"
    LEFT JOIN "WorkspaceNotice" wn ON wn."accountId" = a."id"
    LEFT JOIN "ProjectNotice" pn ON pn."projectId" = p."id"
    LEFT JOIN "ScanJob" sj ON sj."projectId" = p."id"
    LEFT JOIN "Notification" n ON n."accountId" = a."id"
    WHERE a."id" IN (${ids})
    GROUP BY a."id"
  `);

  const map = new Map<string, {
    projects: number;
    sites: number;
    members: number;
    notices: number;
    scans: number;
    notifications: number;
  }>();
  for (const row of rows) {
    map.set(row.accountId, {
      projects: safeNumber(row.projects),
      sites: safeNumber(row.sites),
      members: safeNumber(row.members),
      notices: safeNumber(row.notices),
      scans: safeNumber(row.scans),
      notifications: safeNumber(row.notifications),
    });
  }
  return map;
}

export async function getLatestSubscriptions(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, { status: string; tier: string; billingCycle: string | null; currentPeriodEnd: Date | null }>();

  const rows = await prisma.subscription.findMany({
    where: {
      accountId: { in: accountIds },
    },
    orderBy: [{ accountId: "asc" }, { createdAt: "desc" }],
    select: {
      accountId: true,
      status: true,
      tier: true,
      billingCycle: true,
      currentPeriodEnd: true,
    },
  });

  const map = new Map<string, { status: string; tier: string; billingCycle: string | null; currentPeriodEnd: Date | null }>();
  for (const row of rows) {
    if (!map.has(row.accountId)) {
      map.set(row.accountId, {
        status: row.status,
        tier: row.tier,
        billingCycle: row.billingCycle,
        currentPeriodEnd: row.currentPeriodEnd,
      });
    }
  }
  return map;
}

export async function getPlanDistribution() {
  const rows = await prisma.account.groupBy({
    by: ["tier"],
    _count: { _all: true },
  });

  const result: Record<string, number> = {};
  for (const row of rows) result[row.tier] = safeNumber(row._count._all);
  return result;
}

export async function getAdminEventTrend(metricNames: string[], window: number | AdminRangeKey, month?: AdminMonthKey | null) {
  if (!metricNames.length) {
    if (typeof window === "number") return buildTrendPoints([], window);
    return month ? buildMonthTrendPoints([], month) : buildWindowTrendPoints([], window);
  }

  const start = typeof window === "number"
    ? rangeStart(window)
    : month
      ? adminMonthStart(month)
      : adminRangeStart(window);
  const end = typeof window === "number"
    ? currentDate()
    : month
      ? adminMonthEnd(month)
      : currentDate();

  const rows = await prisma.adminEvent.findMany({
    where: {
      name: { in: metricNames },
      createdAt: { gte: start, lt: end },
    },
    select: {
      name: true,
      createdAt: true,
    },
  });

  const points = rows.map((row) => ({
    date: row.createdAt,
    value: 1,
    secondaryValue: row.name === metricNames[1] ? 1 : 0,
  }));

  if (typeof window === "number") return buildTrendPoints(points, window);
  return month ? buildMonthTrendPoints(points, month) : buildWindowTrendPoints(points, window);
}
