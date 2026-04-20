import "server-only";

import type pg from "pg";

import { findAccountById, getAuthPool, withAuthTransaction } from "@/lib/authDb";
import { type Tier } from "@/lib/billing/featureGates";
import { resolveCavCloudEffectivePlan } from "@/lib/cavcloud/plan";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawSubscriptionRow = {
  status: string | null;
  tier: string | null;
};

type RawSiteArcadeConfigRow = {
  siteId: string;
  enabled: boolean;
  gameSlug: string | null;
  gameVersion: string | null;
  optionsJson: unknown;
  updatedAt: Date | string;
};

export type SiteArcadeConfigRecord = {
  siteId: string;
  enabled: boolean;
  gameSlug: string | null;
  gameVersion: string;
  optionsRecord: Record<string, unknown> | null;
  updatedAt: Date;
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeOptions(value: unknown) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = [],
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

function mapSiteArcadeConfig(row: RawSiteArcadeConfigRow | null | undefined): SiteArcadeConfigRecord | null {
  if (!row) return null;
  return {
    siteId: String(row.siteId || "").trim(),
    enabled: Boolean(row.enabled),
    gameSlug: row.gameSlug ? String(row.gameSlug).trim() : null,
    gameVersion: String(row.gameVersion || "v1").trim() || "v1",
    optionsRecord: normalizeOptions(row.optionsJson),
    updatedAt: toDate(row.updatedAt) || new Date(0),
  };
}

export async function readSettingsAccountTier(accountId?: string | null): Promise<Tier> {
  const normalizedAccountId = String(accountId || "").trim();
  if (!normalizedAccountId) return "free";

  const pool = getAuthPool();
  const [account, paidSubscription, latestSubscription] = await Promise.all([
    findAccountById(pool, normalizedAccountId).catch(() => null),
    queryOne<RawSubscriptionRow>(
      pool,
      `SELECT "status", "tier"
       FROM "Subscription"
       WHERE "accountId" = $1
         AND "status" IN ('ACTIVE', 'TRIALING', 'PAST_DUE')
       ORDER BY "updatedAt" DESC, "createdAt" DESC
       LIMIT 1`,
      [normalizedAccountId],
    ).catch(() => null),
    queryOne<RawSubscriptionRow>(
      pool,
      `SELECT "status", "tier"
       FROM "Subscription"
       WHERE "accountId" = $1
       ORDER BY "updatedAt" DESC, "createdAt" DESC
       LIMIT 1`,
      [normalizedAccountId],
    ).catch(() => null),
  ]);

  const effective = resolveCavCloudEffectivePlan({
    account: account
      ? {
          tier: account.tier,
          trialSeatActive: account.trialSeatActive,
          trialEndsAt: account.trialEndsAt,
        }
      : null,
    subscription: paidSubscription ?? latestSubscription,
  });

  return effective.planId;
}

export async function readSiteArcadeConfig(siteId: string) {
  const row = await queryOne<RawSiteArcadeConfigRow>(
    getAuthPool(),
    `SELECT
       "siteId",
       "enabled",
       "gameSlug",
       "gameVersion",
       "optionsJson",
       "updatedAt"
     FROM "SiteArcadeConfig"
     WHERE "siteId" = $1
     LIMIT 1`,
    [siteId],
  );

  return mapSiteArcadeConfig(row);
}

export async function saveSiteArcadeConfig(args: {
  siteId: string;
  enabled: boolean;
  gameSlug: string | null;
  gameVersion: string;
  optionsRecord: Record<string, unknown>;
}) {
  return withAuthTransaction(async (client) => {
    const result = await client.query<RawSiteArcadeConfigRow>(
      `INSERT INTO "SiteArcadeConfig" (
         "siteId",
         "enabled",
         "gameSlug",
         "gameVersion",
         "optionsJson"
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb
       )
       ON CONFLICT ("siteId") DO UPDATE
       SET "enabled" = EXCLUDED."enabled",
           "gameSlug" = EXCLUDED."gameSlug",
           "gameVersion" = EXCLUDED."gameVersion",
           "optionsJson" = EXCLUDED."optionsJson",
           "updatedAt" = NOW()
       RETURNING
         "siteId",
         "enabled",
         "gameSlug",
         "gameVersion",
         "optionsJson",
         "updatedAt"`,
      [
        args.siteId,
        args.enabled,
        args.gameSlug,
        args.gameVersion,
        JSON.stringify(args.optionsRecord || {}),
      ],
    );

    return mapSiteArcadeConfig(result.rows[0]);
  });
}
