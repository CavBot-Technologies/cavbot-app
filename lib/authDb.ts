import "server-only";

import pg from "pg";
import { randomUUID } from "crypto";
import { createLoggedPgPool } from "@/lib/pgPool.server";
import { normalizeCavbotFounderProfile } from "@/lib/profileIdentity";

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawMembershipRow = {
  id: string;
  accountId: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  accountTier?: string | null;
};

type RawUserRow = {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  fullName: string | null;
  usernameChangeCount: number | null;
  lastUsernameChangeAt: string | Date | null;
  publicProfileEnabled: boolean | null;
  avatarImage: string | null;
  avatarTone: string | null;
  createdAt: string | Date;
  lastLoginAt: string | Date | null;
  emailVerifiedAt: string | Date | null;
};

type RawPublicProfileUserRow = RawUserRow & {
  fullName: string | null;
  bio: string | null;
  companyName: string | null;
  companySubcategory: string | null;
  country: string | null;
  region: string | null;
  githubUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  customLinkUrl: string | null;
  showCavbotProfileLink: boolean | null;
  publicShowReadme: boolean | null;
  publicShowWorkspaceSnapshot: boolean | null;
  publicShowHealthOverview: boolean | null;
  publicShowCapabilities: boolean | null;
  publicShowArtifacts: boolean | null;
  publicShowPlanTier: boolean | null;
  publicShowBio: boolean | null;
  publicShowIdentityLinks: boolean | null;
  publicShowIdentityLocation: boolean | null;
  publicShowIdentityEmail: boolean | null;
  publicWorkspaceId: string | null;
  publicStatusEnabled: boolean | null;
  publicStatusMode: string | null;
  publicStatusNote: string | null;
  publicStatusUpdatedAt: string | Date | null;
  showStatusOnPublicProfile: boolean | null;
  userStatus: string | null;
  userStatusNote: string | null;
  userStatusUpdatedAt: string | Date | null;
};

type RawUserAuthRow = {
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
};

type RawAccountRow = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  createdAt: string | Date;
  trialSeatActive: boolean;
  trialStartedAt: string | Date | null;
  trialEndsAt: string | Date | null;
  trialEverUsed: boolean;
};

type RawAuthTokenRow = {
  id: string;
  userId: string;
  type: string;
  tokenHash: string;
  expiresAt: string | Date;
  usedAt: string | Date | null;
  metaJson: Record<string, unknown> | null;
  createdAt: string | Date;
};

export type AuthMembership = {
  id: string;
  accountId: string;
  userId: string;
  role: MemberRole;
  createdAt: Date;
  accountTier?: string | null;
};

export type AuthUser = {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  fullName: string | null;
  usernameChangeCount: number | null;
  lastUsernameChangeAt: Date | null;
  publicProfileEnabled: boolean;
  avatarImage: string | null;
  avatarTone: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
};

export type AuthPublicProfileUser = AuthUser & {
  fullName: string | null;
  bio: string | null;
  companyName: string | null;
  companySubcategory: string | null;
  country: string | null;
  region: string | null;
  githubUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  customLinkUrl: string | null;
  showCavbotProfileLink: boolean;
  publicShowReadme: boolean;
  publicShowWorkspaceSnapshot: boolean;
  publicShowHealthOverview: boolean;
  publicShowCapabilities: boolean;
  publicShowArtifacts: boolean;
  publicShowPlanTier: boolean;
  publicShowBio: boolean;
  publicShowIdentityLinks: boolean;
  publicShowIdentityLocation: boolean;
  publicShowIdentityEmail: boolean;
  publicWorkspaceId: string | null;
  publicStatusEnabled: boolean;
  publicStatusMode: string | null;
  publicStatusNote: string | null;
  publicStatusUpdatedAt: Date | null;
  showStatusOnPublicProfile: boolean;
  userStatus: string | null;
  userStatusNote: string | null;
  userStatusUpdatedAt: Date | null;
};

export type AuthUserAuth = {
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
};

export type AuthAccount = {
  id: string;
  name: string;
  slug: string;
  tier: string;
  createdAt: Date;
  trialSeatActive: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialEverUsed: boolean;
};

export type AuthTokenRecord = {
  id: string;
  userId: string;
  type: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  metaJson: Record<string, unknown> | null;
  createdAt: Date;
};

export type SessionMembershipRecord = {
  id: string;
  accountId: string;
  userId: string;
  role: MemberRole;
  createdAt: Date;
  userEmail: string;
  userDisplayName: string | null;
  accountName: string;
  accountSlug: string;
  accountTier: string;
};

declare global {
  var __cavbotAuthPool: pg.Pool | undefined;
}

function createAuthPool(connectionString: string) {
  return createLoggedPgPool(connectionString, "authDb");
}

function databaseUrl() {
  const value = String(process.env.DATABASE_URL || "").trim();
  if (!value) throw new Error("DATABASE_URL is missing.");
  return value;
}

function asDate(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function normalizeRole(value: string | null | undefined): MemberRole {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  return "MEMBER";
}

export function membershipTierRank(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized.includes("PREMIUM_PLUS") ||
    normalized.includes("PREMIUM+") ||
    normalized.includes("ENTERPRISE") ||
    normalized.includes("PLUS")
  ) {
    return 3;
  }
  if (
    normalized.includes("PREMIUM") ||
    normalized.includes("PRO") ||
    normalized.includes("PAID")
  ) {
    return 2;
  }
  return 1;
}

function membershipRoleRank(value: string | null | undefined) {
  const role = normalizeRole(value);
  if (role === "OWNER") return 3;
  if (role === "ADMIN") return 2;
  return 1;
}

function mapMembership(row: RawMembershipRow): AuthMembership {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    role: normalizeRole(row.role),
    createdAt: asDate(row.createdAt) || new Date(0),
    accountTier: typeof row.accountTier === "string" ? row.accountTier : null,
  };
}

function mapUser(row: RawUserRow): AuthUser {
  const normalized = normalizeCavbotFounderProfile({
    username: row.username,
    displayName: row.displayName,
    fullName: row.fullName,
  });
  const fullName = normalized.fullName;
  const displayName = fullName || normalized.displayName;
  return {
    id: row.id,
    email: row.email,
    username: normalized.username,
    displayName,
    fullName,
    usernameChangeCount: row.usernameChangeCount ?? 0,
    lastUsernameChangeAt: asDate(row.lastUsernameChangeAt),
    publicProfileEnabled: Boolean(row.publicProfileEnabled),
    avatarImage: row.avatarImage,
    avatarTone: row.avatarTone,
    createdAt: asDate(row.createdAt) || new Date(0),
    lastLoginAt: asDate(row.lastLoginAt),
    emailVerifiedAt: asDate(row.emailVerifiedAt),
  };
}

function mapPublicProfileUser(row: RawPublicProfileUserRow): AuthPublicProfileUser {
  const base = mapUser(row);
  return {
    ...base,
    fullName: row.fullName,
    bio: row.bio,
    companyName: row.companyName,
    companySubcategory: row.companySubcategory,
    country: row.country,
    region: row.region,
    githubUrl: row.githubUrl,
    instagramUrl: row.instagramUrl,
    linkedinUrl: row.linkedinUrl,
    customLinkUrl: row.customLinkUrl,
    showCavbotProfileLink: Boolean(row.showCavbotProfileLink),
    publicShowReadme: Boolean(row.publicShowReadme),
    publicShowWorkspaceSnapshot: Boolean(row.publicShowWorkspaceSnapshot),
    publicShowHealthOverview: Boolean(row.publicShowHealthOverview),
    publicShowCapabilities: Boolean(row.publicShowCapabilities),
    publicShowArtifacts: Boolean(row.publicShowArtifacts),
    publicShowPlanTier: Boolean(row.publicShowPlanTier),
    publicShowBio: Boolean(row.publicShowBio),
    publicShowIdentityLinks: Boolean(row.publicShowIdentityLinks),
    publicShowIdentityLocation: Boolean(row.publicShowIdentityLocation),
    publicShowIdentityEmail: Boolean(row.publicShowIdentityEmail),
    publicWorkspaceId: row.publicWorkspaceId,
    publicStatusEnabled: Boolean(row.publicStatusEnabled),
    publicStatusMode: row.publicStatusMode,
    publicStatusNote: row.publicStatusNote,
    publicStatusUpdatedAt: asDate(row.publicStatusUpdatedAt),
    showStatusOnPublicProfile: Boolean(row.showStatusOnPublicProfile),
    userStatus: row.userStatus,
    userStatusNote: row.userStatusNote,
    userStatusUpdatedAt: asDate(row.userStatusUpdatedAt),
  };
}

function mapUserAuth(row: RawUserAuthRow): AuthUserAuth {
  return {
    userId: row.userId,
    passwordAlgo: row.passwordAlgo,
    passwordIters: Number(row.passwordIters || 0),
    passwordSalt: row.passwordSalt,
    passwordHash: row.passwordHash,
    twoFactorEmailEnabled: Boolean(row.twoFactorEmailEnabled),
    twoFactorAppEnabled: Boolean(row.twoFactorAppEnabled),
    totpSecret: row.totpSecret,
    totpSecretPending: row.totpSecretPending,
    sessionVersion: row.sessionVersion == null ? null : Number(row.sessionVersion),
  };
}

function mapAccount(row: RawAccountRow): AuthAccount {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tier: row.tier,
    createdAt: asDate(row.createdAt) || new Date(0),
    trialSeatActive: Boolean(row.trialSeatActive),
    trialStartedAt: asDate(row.trialStartedAt),
    trialEndsAt: asDate(row.trialEndsAt),
    trialEverUsed: Boolean(row.trialEverUsed),
  };
}

function mapAuthToken(row: RawAuthTokenRow): AuthTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    tokenHash: row.tokenHash,
    expiresAt: asDate(row.expiresAt) || new Date(0),
    usedAt: asDate(row.usedAt),
    metaJson: row.metaJson || null,
    createdAt: asDate(row.createdAt) || new Date(0),
  };
}

export function getAuthPool() {
  if (global.__cavbotAuthPool) return global.__cavbotAuthPool;

  const pool = createAuthPool(databaseUrl());
  global.__cavbotAuthPool = pool;

  return pool;
}

async function queryOne<T extends pg.QueryResultRow>(queryable: Queryable, text: string, values: unknown[] = []) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function withAuthTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await getAuthPool().connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

export function newDbId() {
  return randomUUID();
}

export function isPgUniqueViolation(error: unknown): error is { code: string; detail?: string; constraint?: string } {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

export function pgUniqueViolationMentions(error: unknown, field: string) {
  const detail = String((error as { detail?: unknown })?.detail || "").toLowerCase();
  const constraint = String((error as { constraint?: unknown })?.constraint || "").toLowerCase();
  const hit = field.toLowerCase();
  return detail.includes(`(${hit})`) || constraint.includes(hit);
}

export function compareMembershipPriority<T extends { role: string; createdAt: Date; accountTier?: string | null }>(
  left: T,
  right: T,
) {
  const tierRank = membershipTierRank(right.accountTier) - membershipTierRank(left.accountTier);
  if (tierRank !== 0) return tierRank;

  const roleRank = membershipRoleRank(right.role) - membershipRoleRank(left.role);
  if (roleRank !== 0) return roleRank;

  return left.createdAt.getTime() - right.createdAt.getTime();
}

export function pickPrimaryMembership<T extends { role: string; createdAt: Date; accountTier?: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    return compareMembershipPriority(a, b);
  })[0] ?? null;
}

export async function findUserByEmail(queryable: Queryable, email: string) {
  const row = await queryOne<RawUserRow>(
    queryable,
    `SELECT
        "id",
        "email",
        "username",
        "displayName",
        "fullName",
        "usernameChangeCount",
        "lastUsernameChangeAt",
        "publicProfileEnabled",
        "avatarImage",
        "avatarTone",
        "createdAt",
        "lastLoginAt",
        "emailVerifiedAt"
      FROM "User"
      WHERE "email" = $1
      LIMIT 1`,
    [email],
  );
  return row ? mapUser(row) : null;
}

export async function findUserByUsername(queryable: Queryable, username: string) {
  const row = await queryOne<RawUserRow>(
    queryable,
    `SELECT
        "id",
        "email",
        "username",
        "displayName",
        "fullName",
        "usernameChangeCount",
        "lastUsernameChangeAt",
        "publicProfileEnabled",
        "avatarImage",
        "avatarTone",
        "createdAt",
        "lastLoginAt",
        "emailVerifiedAt"
      FROM "User"
      WHERE "username" = $1
      LIMIT 1`,
    [username],
  );
  return row ? mapUser(row) : null;
}

export async function findUserById(queryable: Queryable, userId: string) {
  const row = await queryOne<RawUserRow>(
    queryable,
    `SELECT
        "id",
        "email",
        "username",
        "displayName",
        "fullName",
        "usernameChangeCount",
        "lastUsernameChangeAt",
        "publicProfileEnabled",
        "avatarImage",
        "avatarTone",
        "createdAt",
        "lastLoginAt",
        "emailVerifiedAt"
      FROM "User"
      WHERE "id" = $1
      LIMIT 1`,
    [userId],
  );
  return row ? mapUser(row) : null;
}

export async function findUserIdByStaffCode(queryable: Queryable, staffCode: string) {
  const row = await queryOne<{ userId: string }>(
    queryable,
    `SELECT "userId"
      FROM "StaffProfile"
      WHERE "staffCode" = $1
      LIMIT 1`,
    [staffCode],
  );
  return row ? String(row.userId) : null;
}

export async function findStaffEmailByCode(queryable: Queryable, staffCode: string) {
  const row = await queryOne<{ email: string }>(
    queryable,
    `SELECT u."email"
      FROM "StaffProfile" s
      JOIN "User" u ON u."id" = s."userId"
      WHERE s."staffCode" = $1
      LIMIT 1`,
    [staffCode],
  );
  return row ? String(row.email || "").trim().toLowerCase() : null;
}

export async function findPublicProfileUserByUsername(queryable: Queryable, username: string) {
  const row = await queryOne<RawPublicProfileUserRow>(
    queryable,
    `SELECT
        "id",
        "email",
        "username",
        "displayName",
        "usernameChangeCount",
        "lastUsernameChangeAt",
        "publicProfileEnabled",
        "avatarImage",
        "avatarTone",
        "createdAt",
        "lastLoginAt",
        "emailVerifiedAt",
        "fullName",
        "bio",
        "companyName",
        "companySubcategory",
        "country",
        "region",
        "githubUrl",
        "instagramUrl",
        "linkedinUrl",
        "customLinkUrl",
        "showCavbotProfileLink",
        "publicShowReadme",
        "publicShowWorkspaceSnapshot",
        "publicShowHealthOverview",
        "publicShowCapabilities",
        "publicShowArtifacts",
        "publicShowPlanTier",
        "publicShowBio",
        "publicShowIdentityLinks",
        "publicShowIdentityLocation",
        "publicShowIdentityEmail",
        "publicWorkspaceId",
        "publicStatusEnabled",
        "publicStatusMode",
        "publicStatusNote",
        "publicStatusUpdatedAt",
        "showStatusOnPublicProfile",
        "userStatus",
        "userStatusNote",
        "userStatusUpdatedAt"
      FROM "User"
      WHERE "username" = $1
      LIMIT 1`,
    [username],
  );
  return row ? mapPublicProfileUser(row) : null;
}

export async function findUserAuth(queryable: Queryable, userId: string) {
  const row = await queryOne<RawUserAuthRow>(
    queryable,
    `SELECT
        "userId",
        "passwordAlgo",
        "passwordIters",
        "passwordSalt",
        "passwordHash",
        "twoFactorEmailEnabled",
        "twoFactorAppEnabled",
        "totpSecret",
        "totpSecretPending",
        "sessionVersion"
      FROM "UserAuth"
      WHERE "userId" = $1
      LIMIT 1`,
    [userId],
  );
  return row ? mapUserAuth(row) : null;
}

export async function findMembershipsForUser(queryable: Queryable, userId: string) {
  const result = await queryable.query<RawMembershipRow>(
    `SELECT
        m."id",
        m."accountId",
        m."userId",
        m."role",
        m."createdAt",
        a."tier" AS "accountTier"
      FROM "Membership" m
      JOIN "Account" a ON a."id" = m."accountId"
      WHERE m."userId" = $1`,
    [userId],
  );
  return result.rows.map(mapMembership);
}

export async function findSessionMembership(queryable: Queryable, userId: string, accountId: string) {
  const row = await queryOne<{
    id: string;
    accountId: string;
    userId: string;
    role: string;
    createdAt: string | Date;
    userEmail: string;
    userDisplayName: string | null;
    accountName: string;
    accountSlug: string;
    accountTier: string;
  }>(
    queryable,
    `SELECT
        m."id",
        m."accountId",
        m."userId",
        m."role",
        m."createdAt",
        u."email" AS "userEmail",
        u."displayName" AS "userDisplayName",
        a."name" AS "accountName",
        a."slug" AS "accountSlug",
        a."tier" AS "accountTier"
      FROM "Membership" m
      JOIN "User" u ON u."id" = m."userId"
      JOIN "Account" a ON a."id" = m."accountId"
      WHERE m."userId" = $1
        AND m."accountId" = $2
      LIMIT 1`,
    [userId, accountId],
  );
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    role: normalizeRole(row.role),
    createdAt: asDate(row.createdAt) || new Date(0),
    userEmail: row.userEmail,
    userDisplayName: row.userDisplayName,
    accountName: row.accountName,
    accountSlug: row.accountSlug,
    accountTier: row.accountTier,
  } satisfies SessionMembershipRecord;
}

export async function findAccountById(queryable: Queryable, accountId: string) {
  const row = await queryOne<RawAccountRow>(
    queryable,
    `SELECT
        "id",
        "name",
        "slug",
        "tier",
        "createdAt",
        "trialSeatActive",
        "trialStartedAt",
        "trialEndsAt",
        "trialEverUsed"
      FROM "Account"
      WHERE "id" = $1
      LIMIT 1`,
    [accountId],
  );
  return row ? mapAccount(row) : null;
}

export async function clearExpiredTrialSeat(queryable: Queryable, accountId: string) {
  await queryable.query(
    `UPDATE "Account"
      SET "trialSeatActive" = false,
          "updatedAt" = NOW()
      WHERE "id" = $1
        AND "trialSeatActive" = true
        AND "trialEndsAt" IS NOT NULL
        AND "trialEndsAt" <= NOW()`,
    [accountId],
  );
}

export async function findFirstProjectIdByAccount(queryable: Queryable, accountId: string) {
  const row = await queryOne<{ id: number }>(
    queryable,
    `SELECT "id"
      FROM "Project"
      WHERE "accountId" = $1
        AND "isActive" = true
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    [accountId],
  );
  return row ? { id: Number(row.id) } : null;
}

export async function findActiveProjectByIdForAccount(queryable: Queryable, accountId: string, projectId: number) {
  const row = await queryOne<{ id: number }>(
    queryable,
    `SELECT "id"
      FROM "Project"
      WHERE "id" = $1
        AND "accountId" = $2
        AND "isActive" = true
      LIMIT 1`,
    [projectId, accountId],
  );
  return row ? { id: Number(row.id) } : null;
}

export async function findAuthTokenByHash(queryable: Queryable, tokenHash: string) {
  const row = await queryOne<RawAuthTokenRow>(
    queryable,
    `SELECT
        "id",
        "userId",
        "type",
        "tokenHash",
        "expiresAt",
        "usedAt",
        "metaJson",
        "createdAt"
      FROM "AuthToken"
      WHERE "tokenHash" = $1
      LIMIT 1`,
    [tokenHash],
  );
  return row ? mapAuthToken(row) : null;
}

export async function createAuthTokenRecord(
  queryable: Queryable,
  args: {
    id?: string;
    userId: string;
    type: string;
    tokenHash: string;
    expiresAt: Date;
    metaJson?: Record<string, unknown> | null;
  },
) {
  await queryable.query(
    `INSERT INTO "AuthToken" (
        "id",
        "userId",
        "type",
        "tokenHash",
        "expiresAt",
        "metaJson"
      ) VALUES ($1, $2, $3::"AuthTokenType", $4, $5, $6::jsonb)`,
    [
      args.id || newDbId(),
      args.userId,
      args.type,
      args.tokenHash,
      args.expiresAt,
      args.metaJson ? JSON.stringify(args.metaJson) : null,
    ],
  );
}

export async function updateAuthTokenRecord(
  queryable: Queryable,
  args: {
    id: string;
    expiresAt?: Date;
    usedAt?: Date | null;
    metaJson?: Record<string, unknown> | null;
  },
) {
  await queryable.query(
    `UPDATE "AuthToken"
      SET "expiresAt" = COALESCE($2, "expiresAt"),
          "usedAt" = COALESCE($3, "usedAt"),
          "metaJson" = COALESCE($4::jsonb, "metaJson")
      WHERE "id" = $1`,
    [
      args.id,
      args.expiresAt ?? null,
      args.usedAt ?? null,
      args.metaJson ? JSON.stringify(args.metaJson) : null,
    ],
  );
}

export async function markAuthTokenUsed(queryable: Queryable, id: string, usedAt = new Date()) {
  await queryable.query(`UPDATE "AuthToken" SET "usedAt" = $2 WHERE "id" = $1`, [id, usedAt]);
}

export async function touchUserLastLogin(queryable: Queryable, userId: string, at = new Date()) {
  await queryable.query(`UPDATE "User" SET "lastLoginAt" = $2, "updatedAt" = NOW() WHERE "id" = $1`, [userId, at]);
}

export async function userHasOAuthIdentity(queryable: Queryable, userId: string) {
  const row = await queryOne<{ id: string }>(
    queryable,
    `SELECT "id"
      FROM "OAuthIdentity"
      WHERE "userId" = $1
      LIMIT 1`,
    [userId],
  );
  return Boolean(row?.id);
}
