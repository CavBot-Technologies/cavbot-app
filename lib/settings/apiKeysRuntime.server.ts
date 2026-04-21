import "server-only";

import {
  getAuthPool,
  newDbId,
  withAuthTransaction,
} from "@/lib/authDb";
import type {
  ApiKeyInsertRecord,
  ApiKeyRecord,
  ApiKeyStatus,
  ApiKeyType,
} from "@/lib/apiKeys.server";
import type { AllowedOriginRow } from "@/originMatch";

type RawApiKeyRow = {
  id: string;
  accountId: string | null;
  projectId: number | string | null;
  type: string;
  status: string;
  name: string | null;
  prefix: string;
  last4: string;
  keyHash: string;
  value: string | null;
  scopes: string[] | null;
  lastUsedAt: Date | string | null;
  siteId: string | null;
  rotatedFromId: string | null;
  rotatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawApiKeySiteRow = {
  id: string;
  origin: string;
  projectId: number | string;
};

type RawAllowedOriginRow = {
  origin: string | null;
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

function normalizeApiKeyType(value: string | null | undefined): ApiKeyType {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "SECRET") return "SECRET";
  if (normalized === "ADMIN") return "ADMIN";
  return "PUBLISHABLE";
}

function normalizeApiKeyStatus(value: string | null | undefined): ApiKeyStatus {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ROTATED") return "ROTATED";
  if (normalized === "REVOKED") return "REVOKED";
  return "ACTIVE";
}

function mapApiKey(row: RawApiKeyRow): ApiKeyRecord {
  return {
    id: String(row.id || "").trim(),
    accountId: row.accountId ? String(row.accountId).trim() : null,
    projectId: row.projectId == null ? null : asNumber(row.projectId),
    type: normalizeApiKeyType(row.type),
    status: normalizeApiKeyStatus(row.status),
    name: row.name ? String(row.name).trim() : null,
    prefix: String(row.prefix || "").trim(),
    last4: String(row.last4 || "").trim(),
    keyHash: String(row.keyHash || "").trim(),
    value: row.value ?? null,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    siteId: row.siteId ? String(row.siteId).trim() : null,
    rotatedFromId: row.rotatedFromId ? String(row.rotatedFromId).trim() : null,
    rotatedAt: asDate(row.rotatedAt),
    createdAt: asDate(row.createdAt) || new Date(0),
    updatedAt: asDate(row.updatedAt) || new Date(0),
    lastUsedAt: asDate(row.lastUsedAt),
  };
}

export async function listApiKeysForProject(projectId: number) {
  const result = await getAuthPool().query<RawApiKeyRow>(
    `SELECT
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "name",
       "prefix",
       "last4",
       "keyHash",
       "value",
       "scopes",
       "lastUsedAt",
       "siteId",
       "rotatedFromId",
       "rotatedAt",
       "createdAt",
       "updatedAt"
     FROM "ApiKey"
     WHERE "projectId" = $1
     ORDER BY "createdAt" DESC`,
    [projectId],
  );

  return result.rows.map(mapApiKey);
}

export async function findSiteForProject(args: {
  siteId: string;
  projectId: number;
}) {
  const result = await getAuthPool().query<RawApiKeySiteRow>(
    `SELECT "id", "origin", "projectId"
     FROM "Site"
     WHERE "id" = $1
       AND "projectId" = $2
       AND "isActive" = TRUE
     LIMIT 1`,
    [args.siteId, args.projectId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id || "").trim(),
    origin: String(row.origin || "").trim(),
    projectId: asNumber(row.projectId),
  };
}

export async function findSiteForAccount(args: {
  siteId: string;
  accountId: string;
}) {
  const result = await getAuthPool().query<RawApiKeySiteRow>(
    `SELECT s."id", s."origin", s."projectId"
     FROM "Site" s
     INNER JOIN "Project" p
       ON p."id" = s."projectId"
     WHERE s."id" = $1
       AND s."isActive" = TRUE
       AND p."accountId" = $2
       AND p."isActive" = TRUE
     LIMIT 1`,
    [args.siteId, args.accountId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id || "").trim(),
    origin: String(row.origin || "").trim(),
    projectId: asNumber(row.projectId),
  };
}

export async function createApiKeyRecord(insertData: ApiKeyInsertRecord) {
  const id = newDbId();
  const result = await getAuthPool().query<RawApiKeyRow>(
    `INSERT INTO "ApiKey" (
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "name",
       "prefix",
       "last4",
       "keyHash",
       "value",
       "scopes",
       "siteId",
       "rotatedFromId",
       "createdAt",
       "updatedAt"
     ) VALUES (
       $1, $2, $3, $4::"ApiKeyType", $5::"ApiKeyStatus", $6, $7, $8, $9, $10, $11::text[], $12, $13, NOW(), NOW()
     )
     RETURNING
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "name",
       "prefix",
       "last4",
       "keyHash",
       "value",
       "scopes",
       "lastUsedAt",
       "siteId",
       "rotatedFromId",
       "rotatedAt",
       "createdAt",
       "updatedAt"`,
    [
      id,
      insertData.accountId,
      insertData.projectId,
      insertData.type,
      insertData.status,
      insertData.name,
      insertData.prefix,
      insertData.last4,
      insertData.keyHash,
      insertData.value,
      insertData.scopes,
      insertData.siteId,
      insertData.rotatedFromId,
    ],
  );

  return result.rows[0] ? mapApiKey(result.rows[0]) : null;
}

export async function findApiKeyForAccount(args: {
  keyId: string;
  accountId: string;
}) {
  const result = await getAuthPool().query<RawApiKeyRow>(
    `SELECT
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "name",
       "prefix",
       "last4",
       "keyHash",
       "value",
       "scopes",
       "lastUsedAt",
       "siteId",
       "rotatedFromId",
       "rotatedAt",
       "createdAt",
       "updatedAt"
     FROM "ApiKey"
     WHERE "id" = $1
       AND "accountId" = $2
     LIMIT 1`,
    [args.keyId, args.accountId],
  );

  return result.rows[0] ? mapApiKey(result.rows[0]) : null;
}

export async function rotateApiKeyRecord(args: {
  existingKeyId: string;
  insertData: ApiKeyInsertRecord;
  rotatedAt: Date;
}) {
  return withAuthTransaction(async (client) => {
    await client.query(
      `UPDATE "ApiKey"
       SET "status" = 'ROTATED'::"ApiKeyStatus",
           "rotatedAt" = $2,
           "value" = NULL,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [args.existingKeyId, args.rotatedAt],
    );

    const nextId = newDbId();
    const nextResult = await client.query<RawApiKeyRow>(
      `INSERT INTO "ApiKey" (
         "id",
         "accountId",
         "projectId",
         "type",
         "status",
         "name",
         "prefix",
         "last4",
         "keyHash",
         "value",
         "scopes",
         "siteId",
         "rotatedFromId",
         "createdAt",
         "updatedAt"
       ) VALUES (
         $1, $2, $3, $4::"ApiKeyType", $5::"ApiKeyStatus", $6, $7, $8, $9, $10, $11::text[], $12, $13, NOW(), NOW()
       )
       RETURNING
         "id",
         "accountId",
         "projectId",
         "type",
         "status",
         "name",
         "prefix",
         "last4",
         "keyHash",
         "value",
         "scopes",
         "lastUsedAt",
         "siteId",
         "rotatedFromId",
         "rotatedAt",
         "createdAt",
         "updatedAt"`,
      [
        nextId,
        args.insertData.accountId,
        args.insertData.projectId,
        args.insertData.type,
        args.insertData.status,
        args.insertData.name,
        args.insertData.prefix,
        args.insertData.last4,
        args.insertData.keyHash,
        args.insertData.value,
        args.insertData.scopes,
        args.insertData.siteId,
        args.insertData.rotatedFromId,
      ],
    );

    return nextResult.rows[0] ? mapApiKey(nextResult.rows[0]) : null;
  });
}

export async function revokeApiKeyRecord(args: {
  keyId: string;
  revokedAt: Date;
}) {
  const result = await getAuthPool().query<RawApiKeyRow>(
    `UPDATE "ApiKey"
     SET "status" = 'REVOKED'::"ApiKeyStatus",
         "rotatedAt" = $2,
         "value" = NULL,
         "updatedAt" = NOW()
     WHERE "id" = $1
     RETURNING
       "id",
       "accountId",
       "projectId",
       "type",
       "status",
       "name",
       "prefix",
       "last4",
       "keyHash",
       "value",
       "scopes",
       "lastUsedAt",
       "siteId",
       "rotatedFromId",
       "rotatedAt",
       "createdAt",
       "updatedAt"`,
    [args.keyId, args.revokedAt],
  );

  return result.rows[0] ? mapApiKey(result.rows[0]) : null;
}

export async function replaceSiteAllowedOrigins(args: {
  siteId: string;
  entries: AllowedOriginRow[];
}) {
  await withAuthTransaction(async (client) => {
    await client.query(
      `DELETE FROM "SiteAllowedOrigin"
       WHERE "siteId" = $1`,
      [args.siteId],
    );

    for (const entry of args.entries) {
      await client.query(
        `INSERT INTO "SiteAllowedOrigin" (
           "id",
           "siteId",
           "origin",
           "matchType",
           "createdAt"
         ) VALUES (
           $1,
           $2,
           $3,
           $4::"SiteAllowedOriginMatchType",
           NOW()
         )`,
        [newDbId(), args.siteId, entry.origin, entry.matchType],
      );
    }
  });
}

export async function listSiteAllowedOrigins(siteId: string) {
  const result = await getAuthPool().query<RawAllowedOriginRow>(
    `SELECT "origin"
     FROM "SiteAllowedOrigin"
     WHERE "siteId" = $1`,
    [siteId],
  );

  return result.rows
    .map((row) => String(row.origin || "").trim())
    .filter(Boolean);
}
