import "server-only";

import {
  findUserAuth,
  findUserByUsername,
  getAuthPool,
  isPgUniqueViolation,
  newDbId,
  pgUniqueViolationMentions,
  withAuthTransaction,
  type AuthUserAuth,
} from "@/lib/authDb";

type SecuritySettingsStoreErrorCode =
  | "AUTH_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "USERNAME_TAKEN"
  | "SESSION_NOT_FOUND";

export class SecuritySettingsStoreError extends Error {
  code: SecuritySettingsStoreErrorCode;
  status: number;

  constructor(code: SecuritySettingsStoreErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isSecuritySettingsStoreError(error: unknown): error is SecuritySettingsStoreError {
  return error instanceof SecuritySettingsStoreError;
}

type RawSecuritySessionRow = {
  id: string;
  createdAt: Date | string;
  ip: string | null;
  userAgent: string | null;
  metaJson: unknown;
};

type RawUsernameUpdateRow = {
  usernameChangeCount: number | string | null;
  lastUsernameChangeAt: Date | string | null;
};

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return 0;
}

export async function readSecurityUserAuth(userId: string): Promise<AuthUserAuth | null> {
  return findUserAuth(getAuthPool(), userId);
}

export async function updateSecurityTwoFactorFlags(args: {
  userId: string;
  email2fa: boolean;
  app2fa: boolean;
}) {
  const result = await getAuthPool().query<{
    userId: string;
    passwordAlgo: string;
    passwordIters: number;
    passwordSalt: string;
    passwordHash: string;
    twoFactorEmailEnabled: boolean;
    twoFactorAppEnabled: boolean;
    totpSecret: string | null;
    totpSecretPending: string | null;
    sessionVersion: number | null;
  }>(
    `UPDATE "UserAuth"
     SET "twoFactorEmailEnabled" = $2,
         "twoFactorAppEnabled" = $3,
         "updatedAt" = NOW()
     WHERE "userId" = $1
     RETURNING
       "userId",
       "passwordAlgo",
       "passwordIters",
       "passwordSalt",
       "passwordHash",
       "twoFactorEmailEnabled",
       "twoFactorAppEnabled",
       "totpSecret",
       "totpSecretPending",
       "sessionVersion"`,
    [args.userId, args.email2fa, args.app2fa],
  );

  return result.rows[0] || null;
}

export async function storePendingTotpSecret(userId: string, pendingSecret: string) {
  const result = await getAuthPool().query<{
    userId: string;
    passwordAlgo: string;
    passwordIters: number;
    passwordSalt: string;
    passwordHash: string;
    twoFactorEmailEnabled: boolean;
    twoFactorAppEnabled: boolean;
    totpSecret: string | null;
    totpSecretPending: string | null;
    sessionVersion: number | null;
  }>(
    `UPDATE "UserAuth"
     SET "totpSecretPending" = $2,
         "twoFactorAppEnabled" = false,
         "updatedAt" = NOW()
     WHERE "userId" = $1
     RETURNING
       "userId",
       "passwordAlgo",
       "passwordIters",
       "passwordSalt",
       "passwordHash",
       "twoFactorEmailEnabled",
       "twoFactorAppEnabled",
       "totpSecret",
       "totpSecretPending",
       "sessionVersion"`,
    [userId, pendingSecret],
  );

  return result.rows[0] || null;
}

export async function confirmPendingTotpSecret(args: {
  userId: string;
  pendingSecret: string;
  nextSessionVersion: number;
}) {
  const result = await getAuthPool().query(
    `UPDATE "UserAuth"
     SET "totpSecret" = $2,
         "totpSecretPending" = NULL,
         "twoFactorAppEnabled" = true,
         "sessionVersion" = $3,
         "updatedAt" = NOW()
     WHERE "userId" = $1`,
    [args.userId, args.pendingSecret, args.nextSessionVersion],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function disableTotpForUser(args: {
  userId: string;
  nextSessionVersion: number;
}) {
  const result = await getAuthPool().query(
    `UPDATE "UserAuth"
     SET "twoFactorAppEnabled" = false,
         "totpSecret" = NULL,
         "totpSecretPending" = NULL,
         "sessionVersion" = $2,
         "updatedAt" = NOW()
     WHERE "userId" = $1`,
    [args.userId, args.nextSessionVersion],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function updateSecurityPasswordHash(args: {
  userId: string;
  algo: string;
  iters: number;
  salt: string;
  hash: string;
}) {
  const result = await getAuthPool().query<{ sessionVersion: number | string | null }>(
    `UPDATE "UserAuth"
     SET "passwordAlgo" = $2,
         "passwordIters" = $3,
         "passwordSalt" = $4,
         "passwordHash" = $5,
         "sessionVersion" = COALESCE("sessionVersion", 0) + 1,
         "updatedAt" = NOW()
     WHERE "userId" = $1
     RETURNING "sessionVersion"`,
    [args.userId, args.algo, args.iters, args.salt, args.hash],
  );

  return asNumber(result.rows[0]?.sessionVersion);
}

export async function listSecuritySessionHistory(args: {
  accountId: string;
  userId: string;
  limit?: number;
}) {
  const result = await getAuthPool().query<RawSecuritySessionRow>(
    `SELECT "id", "createdAt", "ip", "userAgent", "metaJson"
     FROM "AuditLog"
     WHERE "accountId" = $1
       AND "operatorUserId" = $2
     ORDER BY "createdAt" DESC
     LIMIT $3`,
    [args.accountId, args.userId, Math.max(1, Math.min(args.limit ?? 20, 100))],
  );

  return result.rows;
}

export async function deleteSecuritySessionHistoryEntry(args: {
  accountId: string;
  userId: string;
  id: string;
}) {
  const result = await getAuthPool().query(
    `DELETE FROM "AuditLog"
     WHERE "id" = $1
       AND "accountId" = $2
       AND "operatorUserId" = $3`,
    [args.id, args.accountId, args.userId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function usernameTombstoneExists(usernameLower: string) {
  const result = await getAuthPool().query<{ id: string }>(
    `SELECT "id"
     FROM "UsernameTombstone"
     WHERE "usernameLower" = $1
     LIMIT 1`,
    [usernameLower],
  );

  return Boolean(result.rows[0]?.id);
}

export async function usernameInUse(candidate: string) {
  return Boolean(await findUserByUsername(getAuthPool(), candidate));
}

export async function applyUsernameChange(args: {
  userId: string;
  accountId: string;
  currentUsername: string;
  nextUsername: string;
  changedAt: Date;
}) {
  try {
    return await withAuthTransaction(async (client) => {
      const updatedResult = await client.query<RawUsernameUpdateRow>(
        `UPDATE "User"
         SET "username" = $2,
             "usernameChangeCount" = COALESCE("usernameChangeCount", 0) + 1,
             "lastUsernameChangeAt" = $3,
             "updatedAt" = NOW()
         WHERE "id" = $1
         RETURNING "usernameChangeCount", "lastUsernameChangeAt"`,
        [args.userId, args.nextUsername, args.changedAt],
      );

      const updated = updatedResult.rows[0];
      if (!updated) {
        throw new SecuritySettingsStoreError("USER_NOT_FOUND", 404, "User record not found.");
      }

      await client.query(
        `INSERT INTO "UsernameHistory" (
           "id",
           "userId",
           "accountId",
           "operatorUserId",
           "oldUsername",
           "newUsername",
           "changedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          newDbId(),
          args.userId,
          args.accountId,
          args.userId,
          args.currentUsername || null,
          args.nextUsername,
          args.changedAt,
        ],
      );

      if (args.currentUsername) {
        await client.query(
          `INSERT INTO "UsernameTombstone" (
             "id",
             "usernameLower",
             "userId",
             "burnedAt",
             "reason"
           )
           VALUES ($1, $2, $3, $4, $5)`,
          [newDbId(), args.currentUsername, args.userId, args.changedAt, "username_change"],
        );
      }

      return {
        usernameChangeCount: asNumber(updated.usernameChangeCount),
        lastUsernameChangeAt: asDate(updated.lastUsernameChangeAt),
      };
    });
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      if (pgUniqueViolationMentions(error, "username") || pgUniqueViolationMentions(error, "usernameLower")) {
        throw new SecuritySettingsStoreError("USERNAME_TAKEN", 409, "Username already in use.");
      }
    }
    throw error;
  }
}

export async function countAccountOwners(accountId: string) {
  const result = await getAuthPool().query<{ count: string | number }>(
    `SELECT COUNT(*)::int AS "count"
     FROM "Membership"
     WHERE "accountId" = $1
       AND "role" = 'OWNER'`,
    [accountId],
  );

  return asNumber(result.rows[0]?.count);
}

export async function deleteUserAccount(userId: string) {
  const result = await getAuthPool().query(
    `DELETE FROM "User"
     WHERE "id" = $1`,
    [userId],
  );

  return (result.rowCount ?? 0) > 0;
}

export function readSecuritySessionMeta(metaJson: unknown) {
  if (!metaJson || typeof metaJson !== "object" || Array.isArray(metaJson)) return null;
  return metaJson as Record<string, unknown>;
}
