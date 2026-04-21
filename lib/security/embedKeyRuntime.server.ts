import "server-only";

import { getAuthPool } from "@/lib/authDb";
import type { AllowedOriginRow } from "@/originMatch";

type RawApiKeyRow = {
  id: string;
  accountId: string | null;
  projectId: number | string | null;
  type: string | null;
  status: string | null;
  last4: string | null;
  updatedAt: Date | string | null;
  siteId: string | null;
  scopes: string[] | null;
};

type RawSiteRow = {
  id: string;
  origin: string;
  projectId: number | string;
  isActive?: boolean | null;
};

type RawAllowedOriginRow = {
  origin: string | null;
  matchType: string | null;
};

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return 0;
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeKeyType(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function normalizeKeyStatus(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMatchType(value: string | null | undefined): AllowedOriginRow["matchType"] {
  return String(value || "").trim().toUpperCase() === "WILDCARD_SUBDOMAIN"
    ? "WILDCARD_SUBDOMAIN"
    : "EXACT";
}

export type RuntimeEmbedKeyRecord = {
  id: string;
  accountId: string | null;
  projectId: number | null;
  type: string;
  status: string;
  last4: string | null;
  updatedAt: Date | null;
  siteId: string | null;
  scopes: string[];
};

export type RuntimeEmbedSiteRecord = {
  id: string;
  origin: string;
  projectId: number;
};

function mapApiKey(row: RawApiKeyRow): RuntimeEmbedKeyRecord {
  return {
    id: String(row.id || "").trim(),
    accountId: row.accountId ? String(row.accountId).trim() : null,
    projectId: row.projectId == null ? null : asNumber(row.projectId),
    type: normalizeKeyType(row.type),
    status: normalizeKeyStatus(row.status),
    last4: row.last4 ? String(row.last4).trim() : null,
    updatedAt: asDate(row.updatedAt),
    siteId: row.siteId ? String(row.siteId).trim() : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope || "").trim()).filter(Boolean) : [],
  };
}

function mapSite(row: RawSiteRow): RuntimeEmbedSiteRecord {
  return {
    id: String(row.id || "").trim(),
    origin: String(row.origin || "").trim(),
    projectId: asNumber(row.projectId),
  };
}

export async function findEmbedKeyByHash(keyHash: string) {
  const result = await getAuthPool().query<RawApiKeyRow>(
    `SELECT
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "last4",
       "updatedAt",
       "siteId",
       "scopes"
     FROM "ApiKey"
     WHERE "keyHash" = $1
       AND "projectId" IS NOT NULL
     LIMIT 1`,
    [keyHash],
  );

  return result.rows[0] ? mapApiKey(result.rows[0]) : null;
}

export async function findEmbedKeyById(keyId: string) {
  const result = await getAuthPool().query<RawApiKeyRow>(
    `SELECT
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "last4",
       "updatedAt",
       "siteId",
       "scopes"
     FROM "ApiKey"
     WHERE "id" = $1
     LIMIT 1`,
    [keyId],
  );

  return result.rows[0] ? mapApiKey(result.rows[0]) : null;
}

export async function findActiveEmbedSite(siteId: string, projectId: number) {
  const result = await getAuthPool().query<RawSiteRow>(
    `SELECT "id", "origin", "projectId"
     FROM "Site"
     WHERE "id" = $1
       AND "projectId" = $2
       AND "isActive" = TRUE
     LIMIT 1`,
    [siteId, projectId],
  );

  return result.rows[0] ? mapSite(result.rows[0]) : null;
}

export async function listEmbedAllowedOrigins(siteId: string): Promise<AllowedOriginRow[]> {
  const result = await getAuthPool().query<RawAllowedOriginRow>(
    `SELECT "origin", "matchType"
     FROM "SiteAllowedOrigin"
     WHERE "siteId" = $1
     ORDER BY "createdAt" ASC`,
    [siteId],
  );

  return result.rows
    .map((row) => ({
      origin: String(row.origin || "").trim(),
      matchType: normalizeMatchType(row.matchType),
    }))
    .filter((row) => !!row.origin);
}
