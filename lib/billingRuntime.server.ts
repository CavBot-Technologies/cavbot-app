import "server-only";

import pg from "pg";

import { getAuthPool } from "@/lib/authDb";

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

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
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
