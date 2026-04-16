import "server-only";

import pg from "pg";

import { getAuthPool } from "@/lib/authDb";
import type { BillingCycle } from "@/lib/plans";
import { planFromPriceId } from "@/lib/stripe";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawBillingAccountRow = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  trialSeatActive: boolean | null;
  trialStartedAt: Date | string | null;
  trialEndsAt: Date | string | null;
  trialEverUsed: boolean | null;
  pendingDowngradePlanId: string | null;
  pendingDowngradeBilling: string | null;
  pendingDowngradeAt: Date | string | null;
  pendingDowngradeEffectiveAt: Date | string | null;
  pendingDowngradeAppliesAtRenewal: boolean | null;
  lastUpgradePlanId: string | null;
  lastUpgradeBilling: string | null;
  lastUpgradeAt: Date | string | null;
  lastUpgradeProrated: boolean | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawBillingAuditRow = {
  id: string;
  createdAt: Date | string;
  metaJson: unknown;
};

type RawBillingSubscriptionRow = {
  status: string | null;
  tier: string | null;
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  provider: string | null;
  customerId: string | null;
  billingCycle: string | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
};

type RawCountRow = {
  total: number | string | null;
};

export type BillingRuntimeAccount = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  billingEmail: string | null;
  stripeCustomerId: string | null;
  trialSeatActive: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialEverUsed: boolean;
  pendingDowngradePlanId: string | null;
  pendingDowngradeBilling: string | null;
  pendingDowngradeAt: Date | null;
  pendingDowngradeEffectiveAt: Date | null;
  pendingDowngradeAppliesAtRenewal: boolean;
  lastUpgradePlanId: string | null;
  lastUpgradeBilling: string | null;
  lastUpgradeAt: Date | null;
  lastUpgradeProrated: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingAuditEventRow = {
  id: string;
  createdAt: Date;
  metaJson: unknown;
};

export type BillingRuntimeSubscription = {
  status: string | null;
  tier: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  provider: string | null;
  customerId: string | null;
  billingCycle: BillingCycle | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
};

export type BillingUsageMetrics = {
  seatsUsed: number;
  websitesUsed: number;
};

const BILLING_RUNTIME_SOFT_FAIL_DB_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

const ONE_DAY_MS = 86_400_000;
const MONTHLY_CYCLE_MIN_DAYS = 20;
const MONTHLY_CYCLE_MAX_DAYS = 45;
const ANNUAL_CYCLE_MIN_DAYS = 300;

function collectErrorMessages(err: unknown, depth = 0): string[] {
  if (!err || depth > 3) return [];
  if (typeof err === "string") return [err.toLowerCase()];
  if (typeof err !== "object") return [];

  const typed = err as {
    message?: unknown;
    detail?: unknown;
    cause?: unknown;
  };

  return [
    String(typed.message || "").toLowerCase(),
    String(typed.detail || "").toLowerCase(),
    ...collectErrorMessages(typed.cause, depth + 1),
  ].filter(Boolean);
}

export function isBillingRuntimeUnavailableError(err: unknown) {
  const dbCode = String((err as { code?: unknown })?.code || "").toUpperCase();
  if (BILLING_RUNTIME_SOFT_FAIL_DB_CODES.has(dbCode)) return true;

  const messages = collectErrorMessages(err);
  return messages.some((message) =>
    message.includes("service unavailable")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("connection terminated")
    || message.includes("connection reset")
    || message.includes("connection refused")
    || message.includes("too many clients")
    || message.includes("remaining connection slots")
    || message.includes("can not reach database server")
    || message.includes("can't reach database server")
    || message.includes("getaddrinfo")
    || message.includes("server closed the connection unexpectedly")
    || message.includes("admin shutdown")
    || message.includes("pool")
  );
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asNumber(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeBillingCycleValue(value: unknown): BillingCycle | null {
  const token = String(value ?? "").trim().toLowerCase();
  if (!token) return null;
  if (token.includes("annual") || token.includes("year")) return "annual";
  if (token.includes("month")) return "monthly";
  return null;
}

export function inferBillingCycleFromSubscription(args: {
  billingCycle?: unknown;
  stripePriceId?: unknown;
  currentPeriodStart?: Date | string | null;
  currentPeriodEnd?: Date | string | null;
}): BillingCycle | null {
  const explicit = normalizeBillingCycleValue(args.billingCycle);
  if (explicit) return explicit;

  const stripePriceId = String(args.stripePriceId ?? "").trim();
  const priceMatch = stripePriceId ? planFromPriceId(stripePriceId) : null;
  if (priceMatch?.billing) return priceMatch.billing;

  const currentPeriodStart = asDate(args.currentPeriodStart);
  const currentPeriodEnd = asDate(args.currentPeriodEnd);
  if (!currentPeriodStart || !currentPeriodEnd) return null;

  const durationDays = (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) / ONE_DAY_MS;
  if (!Number.isFinite(durationDays) || durationDays <= 0) return null;
  if (durationDays >= ANNUAL_CYCLE_MIN_DAYS) return "annual";
  if (durationDays >= MONTHLY_CYCLE_MIN_DAYS && durationDays <= MONTHLY_CYCLE_MAX_DAYS) return "monthly";
  return null;
}

function mapBillingAccount(row: RawBillingAccountRow): BillingRuntimeAccount {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tier: row.tier,
    billingEmail: row.billingEmail,
    stripeCustomerId: row.stripeCustomerId,
    trialSeatActive: Boolean(row.trialSeatActive),
    trialStartedAt: asDate(row.trialStartedAt),
    trialEndsAt: asDate(row.trialEndsAt),
    trialEverUsed: Boolean(row.trialEverUsed),
    pendingDowngradePlanId: row.pendingDowngradePlanId,
    pendingDowngradeBilling: row.pendingDowngradeBilling,
    pendingDowngradeAt: asDate(row.pendingDowngradeAt),
    pendingDowngradeEffectiveAt: asDate(row.pendingDowngradeEffectiveAt),
    pendingDowngradeAppliesAtRenewal: Boolean(row.pendingDowngradeAppliesAtRenewal),
    lastUpgradePlanId: row.lastUpgradePlanId,
    lastUpgradeBilling: row.lastUpgradeBilling,
    lastUpgradeAt: asDate(row.lastUpgradeAt),
    lastUpgradeProrated: Boolean(row.lastUpgradeProrated),
    createdAt: asDate(row.createdAt) || new Date(0),
    updatedAt: asDate(row.updatedAt) || new Date(0),
  };
}

function mapBillingSubscription(row: RawBillingSubscriptionRow): BillingRuntimeSubscription {
  return {
    status: row.status ?? null,
    tier: row.tier ?? null,
    currentPeriodStart: asDate(row.currentPeriodStart),
    currentPeriodEnd: asDate(row.currentPeriodEnd),
    provider: row.provider ?? null,
    customerId: row.customerId ?? null,
    billingCycle: inferBillingCycleFromSubscription({
      billingCycle: row.billingCycle,
      stripePriceId: row.stripePriceId,
      currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd,
    }),
    stripePriceId: row.stripePriceId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
  };
}

function accountSelectSql() {
  return `SELECT
      "id",
      "name",
      "slug",
      "tier",
      "billingEmail",
      "stripeCustomerId",
      "trialSeatActive",
      "trialStartedAt",
      "trialEndsAt",
      "trialEverUsed",
      "pendingDowngradePlanId",
      "pendingDowngradeBilling",
      "pendingDowngradeAt",
      "pendingDowngradeEffectiveAt",
      "pendingDowngradeAppliesAtRenewal",
      "lastUpgradePlanId",
      "lastUpgradeBilling",
      "lastUpgradeAt",
      "lastUpgradeProrated",
      "createdAt",
      "updatedAt"
    FROM "Account"`;
}

export async function readBillingAccount(
  accountId: string,
  queryable: Queryable = getAuthPool(),
): Promise<BillingRuntimeAccount | null> {
  const result = await queryable.query<RawBillingAccountRow>(
    `${accountSelectSql()}
     WHERE "id" = $1
     LIMIT 1`,
    [accountId],
  );

  return result.rows[0] ? mapBillingAccount(result.rows[0]) : null;
}

export async function ensureBillingStripeCustomerBinding(
  accountId: string,
  stripeCustomerId: string,
  queryable: Queryable = getAuthPool(),
): Promise<BillingRuntimeAccount | null> {
  const result = await queryable.query<RawBillingAccountRow>(
    `UPDATE "Account"
     SET "stripeCustomerId" = COALESCE(NULLIF("stripeCustomerId", ''), $2),
         "updatedAt" = NOW()
     WHERE "id" = $1
     RETURNING
       "id",
       "name",
       "slug",
       "tier",
       "billingEmail",
       "stripeCustomerId",
       "trialSeatActive",
       "trialStartedAt",
       "trialEndsAt",
       "trialEverUsed",
       "pendingDowngradePlanId",
       "pendingDowngradeBilling",
       "pendingDowngradeAt",
       "pendingDowngradeEffectiveAt",
       "pendingDowngradeAppliesAtRenewal",
       "lastUpgradePlanId",
       "lastUpgradeBilling",
       "lastUpgradeAt",
       "lastUpgradeProrated",
       "createdAt",
       "updatedAt"`,
    [accountId, stripeCustomerId],
  );

  return result.rows[0] ? mapBillingAccount(result.rows[0]) : null;
}

export async function clearPendingDowngradeState(
  accountId: string,
  queryable: Queryable = getAuthPool(),
): Promise<void> {
  await queryable.query(
    `UPDATE "Account"
     SET "pendingDowngradePlanId" = NULL,
         "pendingDowngradeBilling" = NULL,
         "pendingDowngradeAt" = NULL,
         "pendingDowngradeEffectiveAt" = NULL,
         "pendingDowngradeAppliesAtRenewal" = true,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [accountId],
  );
}

export async function setPendingDowngradeState(
  accountId: string,
  args: {
    planId: string;
    billing: BillingCycle;
    scheduledAt: Date;
    effectiveAt: Date | null;
    appliesAtRenewal?: boolean;
  },
  queryable: Queryable = getAuthPool(),
): Promise<void> {
  await queryable.query(
    `UPDATE "Account"
     SET "pendingDowngradePlanId" = $2,
         "pendingDowngradeBilling" = $3,
         "pendingDowngradeAt" = $4,
         "pendingDowngradeEffectiveAt" = $5,
         "pendingDowngradeAppliesAtRenewal" = $6,
         "updatedAt" = NOW()
     WHERE "id" = $1`,
    [
      accountId,
      String(args.planId || "").trim() || null,
      String(args.billing || "").trim() || null,
      args.scheduledAt,
      args.effectiveAt,
      args.appliesAtRenewal ?? true,
    ],
  );
}

export async function listBillingInvoiceAuditRows(
  accountId: string,
  limit = 50,
  queryable: Queryable = getAuthPool(),
): Promise<BillingAuditEventRow[]> {
  const cappedLimit = Math.max(1, Math.min(limit, 100));
  const result = await queryable.query<RawBillingAuditRow>(
    `SELECT "id", "createdAt", "metaJson"
     FROM "AuditLog"
     WHERE "accountId" = $1
       AND COALESCE("metaJson"->>'billing_event', '') <> ''
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [accountId, cappedLimit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    createdAt: asDate(row.createdAt) || new Date(0),
    metaJson: row.metaJson,
  }));
}

export async function readLatestBillingSubscription(
  accountId: string,
  options?: {
    provider?: string;
    queryable?: Queryable;
  },
): Promise<BillingRuntimeSubscription | null> {
  const queryable = options?.queryable ?? getAuthPool();
  const provider = String(options?.provider || "").trim();
  const values: unknown[] = [accountId];
  const providerClause = provider
    ? (() => {
        values.push(provider);
        return `AND "provider" = $2`;
      })()
    : "";

  const result = await queryable.query<RawBillingSubscriptionRow>(
    `SELECT
       "status",
       "tier",
       "currentPeriodStart",
       "currentPeriodEnd",
       "provider",
       "customerId",
       "billingCycle",
       "stripePriceId",
       "stripeSubscriptionId"
     FROM "Subscription"
     WHERE "accountId" = $1
       ${providerClause}
     ORDER BY "createdAt" DESC NULLS LAST
     LIMIT 1`,
    values,
  );

  return result.rows[0] ? mapBillingSubscription(result.rows[0]) : null;
}

export async function readBillingUsageMetrics(
  accountId: string,
  queryable: Queryable = getAuthPool(),
): Promise<BillingUsageMetrics> {
  const [members, invites, sites] = await Promise.all([
    queryable.query<RawCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM "Membership"
       WHERE "accountId" = $1`,
      [accountId],
    ),
    queryable.query<RawCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM "Invite"
       WHERE "accountId" = $1
         AND UPPER(COALESCE("status"::text, '')) = 'PENDING'
         AND ("expiresAt" IS NULL OR "expiresAt" > NOW())`,
      [accountId],
    ),
    queryable.query<RawCountRow>(
      `SELECT COUNT(*)::int AS total
       FROM "Site" AS s
       INNER JOIN "Project" AS p
         ON p."id" = s."projectId"
       WHERE p."accountId" = $1
         AND COALESCE(p."isActive", false) = true
         AND COALESCE(s."isActive", false) = true`,
      [accountId],
    ),
  ]);

  return {
    seatsUsed: asNumber(members.rows[0]?.total) + asNumber(invites.rows[0]?.total),
    websitesUsed: asNumber(sites.rows[0]?.total),
  };
}
