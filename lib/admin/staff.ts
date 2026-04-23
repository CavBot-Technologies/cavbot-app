import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, type StaffProfile, type StaffStatus, type StaffSystemRole } from "@prisma/client";
import type pg from "pg";

import { buildAdminDepartmentScopeSet, normalizeAdminDepartment } from "@/lib/admin/access";
import { sanitizeAdminNextPath } from "@/lib/admin/config";
import { readOperatorInviteMeta } from "@/lib/admin/operatorOnboarding.server";
import { getAuthPool } from "@/lib/authDb";
import { getSession, requireUser, type CavbotUserSession, ApiAuthError } from "@/lib/apiAuth";
import { hasAdminScope, type AdminScope } from "@/lib/admin/permissions";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { getAdminSession, type AdminSession } from "@/lib/admin/session";
import { patchStaffLifecycleMetadata, readStaffSuspendedUntil } from "@/lib/admin/staffDisplay";
import { prisma } from "@/lib/prisma";

type StaffProfileWithUser = StaffProfile & {
  user: {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    fullName: string | null;
    avatarImage: string | null;
    avatarTone: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
  };
};

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawStaffProfileRow = {
  id: string;
  userId: string;
  staffCode: string;
  systemRole: StaffSystemRole | string;
  positionTitle: string;
  status: StaffStatus | string;
  onboardingStatus: string;
  invitedEmail: string | null;
  invitedByUserId: string | null;
  createdByUserId: string | null;
  notes: string | null;
  scopes: string[] | null;
  metadataJson: Prisma.JsonValue | null;
  lastAdminLoginAt: Date | string | null;
  lastAdminStepUpAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  userEmail: string;
  userUsername: string | null;
  userDisplayName: string | null;
  userFullName: string | null;
  userAvatarImage: string | null;
  userAvatarTone: string | null;
  userLastLoginAt: Date | string | null;
  userCreatedAt: Date | string;
};

const RETIRED_STAFF_CODES = ["CAV-000001"] as const;
const RETIRED_STAFF_CODE_FLOOR = 1;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = [],
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

function normalizeStaffProfileRow(row: RawStaffProfileRow): StaffProfileWithUser {
  return {
    id: String(row.id),
    userId: String(row.userId),
    staffCode: String(row.staffCode),
    systemRole: toSafeStaffRole(row.systemRole),
    positionTitle: String(row.positionTitle || "Staff"),
    status: String(row.status || "INVITED").toUpperCase() as StaffStatus,
    onboardingStatus: String(row.onboardingStatus || "PENDING").toUpperCase() as StaffProfile["onboardingStatus"],
    invitedEmail: row.invitedEmail == null ? null : String(row.invitedEmail),
    invitedByUserId: row.invitedByUserId == null ? null : String(row.invitedByUserId),
    createdByUserId: row.createdByUserId == null ? null : String(row.createdByUserId),
    notes: row.notes == null ? null : String(row.notes),
    scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : [],
    metadataJson: row.metadataJson ?? null,
    lastAdminLoginAt: toDate(row.lastAdminLoginAt),
    lastAdminStepUpAt: toDate(row.lastAdminStepUpAt),
    createdAt: toDate(row.createdAt) || new Date(0),
    updatedAt: toDate(row.updatedAt) || new Date(0),
    user: {
      id: String(row.userId),
      email: String(row.userEmail || ""),
      username: row.userUsername == null ? null : String(row.userUsername),
      displayName: row.userDisplayName == null ? null : String(row.userDisplayName),
      fullName: row.userFullName == null ? null : String(row.userFullName),
      avatarImage: row.userAvatarImage == null ? null : String(row.userAvatarImage),
      avatarTone: row.userAvatarTone == null ? null : String(row.userAvatarTone),
      lastLoginAt: toDate(row.userLastLoginAt),
      createdAt: toDate(row.userCreatedAt) || new Date(0),
    },
  };
}

async function readStaffProfileByUserIdRuntime(userId: string) {
  const row = await queryOne<RawStaffProfileRow>(
    getAuthPool(),
    `SELECT
       staff."id",
       staff."userId",
       staff."staffCode",
       staff."systemRole",
       staff."positionTitle",
       staff."status",
       staff."onboardingStatus",
       staff."invitedEmail",
       staff."invitedByUserId",
       staff."createdByUserId",
       staff."notes",
       staff."scopes",
       staff."metadataJson",
       staff."lastAdminLoginAt",
       staff."lastAdminStepUpAt",
       staff."createdAt",
       staff."updatedAt",
       user_row."email" AS "userEmail",
       user_row."username" AS "userUsername",
       user_row."displayName" AS "userDisplayName",
       user_row."fullName" AS "userFullName",
       user_row."avatarImage" AS "userAvatarImage",
       user_row."avatarTone" AS "userAvatarTone",
       user_row."lastLoginAt" AS "userLastLoginAt",
       user_row."createdAt" AS "userCreatedAt"
     FROM "StaffProfile" staff
     INNER JOIN "User" user_row ON user_row."id" = staff."userId"
     WHERE staff."userId" = $1
     LIMIT 1`,
    [userId],
  );
  return row ? normalizeStaffProfileRow(row) : null;
}

export function normalizeStaffCode(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  return `CAV-${digits.padStart(6, "0").slice(-6)}`;
}

export function getConfiguredOwnerStaffCode() {
  const configured = normalizeStaffCode(env("CAVBOT_ADMIN_STAFF_CODE") || env("ADMIN_OWNER_STAFF_CODE"));
  if (!configured || isRetiredStaffCode(configured)) return "";
  return configured;
}

export function getOwnerStaffCodeCandidates() {
  const configured = getConfiguredOwnerStaffCode();
  return configured ? [configured] : [];
}

export function isRetiredStaffCode(value: string | null | undefined) {
  const normalized = normalizeStaffCode(value);
  return Boolean(normalized && RETIRED_STAFF_CODES.includes(normalized as (typeof RETIRED_STAFF_CODES)[number]));
}

export function formatStaffCode(value: number) {
  return normalizeStaffCode(String(Math.max(1, Math.trunc(value))));
}

export function maskStaffCode(value: string | null | undefined) {
  const normalized = normalizeStaffCode(value);
  const suffix = normalized.slice(-4);
  return suffix ? `•••• ${suffix}` : "••••";
}

function toSafeStaffRole(value: unknown): StaffSystemRole {
  const role = String(value || "").trim().toUpperCase();
  if (role === "OWNER" || role === "ADMIN" || role === "READ_ONLY") return role;
  return "MEMBER";
}

function inviteDepartmentFromMeta(meta: unknown) {
  const value =
    meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>).department
      : "";
  return normalizeAdminDepartment(value);
}

export async function getStaffProfileByUserId(userId: string) {
  const profile = await readStaffProfileByUserIdRuntime(userId);

  return syncExpiredStaffSuspension(profile);
}

export async function findStaffProfileByIdentifier(identifier: string) {
  const raw = String(identifier || "").trim();
  if (!raw) return null;

  const normalizedEmail = raw.includes("@") ? raw.toLowerCase() : "";
  const normalizedStaffCode = normalizeStaffCode(raw);

  const profile = await prisma.staffProfile.findFirst({
    where: normalizedEmail
      ? { user: { email: normalizedEmail } }
      : { staffCode: normalizedStaffCode },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          fullName: true,
          avatarImage: true,
          avatarTone: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
    },
  }) as StaffProfileWithUser | null;

  return syncExpiredStaffSuspension(profile);
}

async function activateExistingStaffProfile(profile: StaffProfileWithUser) {
  if (profile.status === "ACTIVE" && profile.onboardingStatus !== "PENDING") {
    return profile;
  }

  if (profile.status !== "ACTIVE" && profile.status !== "INVITED") {
    return profile;
  }

  await prisma.staffProfile.update({
    where: { id: profile.id },
    data: {
      status: "ACTIVE",
      onboardingStatus: profile.onboardingStatus === "COMPLETED" ? "COMPLETED" : "READY",
      invitedEmail: profile.invitedEmail || profile.user.email,
    },
  });

  return getStaffProfileByUserId(profile.userId);
}

async function syncExpiredStaffSuspension(profile: StaffProfileWithUser | null) {
  if (!profile || profile.status !== "SUSPENDED") return profile;

  const suspendedUntil = readStaffSuspendedUntil(profile.metadataJson);
  if (!suspendedUntil || suspendedUntil.getTime() > Date.now()) return profile;

  await prisma.staffProfile.update({
    where: { id: profile.id },
    data: {
      status: "ACTIVE",
      metadataJson: patchStaffLifecycleMetadata(profile.metadataJson, {
        suspendedUntilISO: null,
        suspendedAtISO: null,
        suspendedByStaffId: null,
        suspensionDays: null,
      }) ?? Prisma.JsonNull,
    },
  });

  return (await prisma.staffProfile.findUnique({
    where: { userId: profile.userId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          fullName: true,
          avatarImage: true,
          avatarTone: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
    },
  })) as StaffProfileWithUser | null;
}

async function materializePendingStaffInviteForUser(userId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const invite = await prisma.staffInvite.findFirst({
    where: {
      normalizedEmail,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!invite) return null;

  const inviteMeta = readOperatorInviteMeta(invite.metaJson);
  if (inviteMeta.notificationAcceptRequired) {
    return null;
  }

  const staffCode = await issueNextStaffCode();
  const createdAt = new Date();
  const department = inviteMeta.department || inviteDepartmentFromMeta(invite.metaJson);

  const profile = await prisma.staffProfile.create({
    data: {
      userId,
      staffCode,
      systemRole: invite.systemRole,
      scopes: buildAdminDepartmentScopeSet(department),
      positionTitle: invite.positionTitle,
      status: "ACTIVE",
      onboardingStatus: "READY",
      invitedEmail: normalizedEmail,
      invitedByUserId: invite.invitedByUserId || null,
      createdByUserId: invite.invitedByUserId || null,
      metadataJson: {
        inviteId: invite.id,
        onboardedFromInvite: true,
        department,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          fullName: true,
          avatarImage: true,
          avatarTone: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
    },
  }) as StaffProfileWithUser;

  await prisma.staffInvite.update({
    where: { id: invite.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: createdAt,
      inviteeUserId: userId,
      acceptedStaffId: profile.id,
    },
  });

  await recordAdminEventSafe({
    name: "staff_onboarded",
    actorUserId: invite.invitedByUserId || null,
    subjectUserId: userId,
    result: "accepted",
    metaJson: {
      inviteId: invite.id,
      staffId: profile.id,
      systemRole: invite.systemRole,
      positionTitle: invite.positionTitle,
      department,
    },
  });

  return profile;
}

export async function ensureStaffProfileForUser(userId: string, email?: string | null) {
  const existing = await getStaffProfileByUserId(userId);
  if (existing) {
    const activated = await activateExistingStaffProfile(existing);
    return activated;
  }

  await ensureAdminOwnerBootstrap();

  const bootstrapped = await getStaffProfileByUserId(userId);
  if (bootstrapped) {
    const activated = await activateExistingStaffProfile(bootstrapped);
    return activated;
  }

  return materializePendingStaffInviteForUser(userId, normalizeEmail(email));
}

async function ensureStaffSequenceFloor(minimumValue: number) {
  const existing = await prisma.staffSequence.findUnique({
    where: { key: "staff" },
  });

  if (!existing) {
    await prisma.staffSequence.create({
      data: {
        key: "staff",
        lastValue: minimumValue,
      },
    });
    return;
  }

  if (existing.lastValue >= minimumValue) return;
  await prisma.staffSequence.update({
    where: { key: "staff" },
    data: {
      lastValue: minimumValue,
    },
  });
}

function parseStaffCodeNumber(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return 0;
  return Math.max(0, Number.parseInt(digits, 10) || 0);
}

export async function issueNextStaffCode() {
  await ensureStaffSequenceFloor(RETIRED_STAFF_CODE_FLOOR);
  await prisma.staffSequence.upsert({
    where: { key: "staff" },
    update: {},
    create: {
      key: "staff",
      lastValue: RETIRED_STAFF_CODE_FLOOR,
    },
  });

  const sequence = await prisma.staffSequence.update({
    where: { key: "staff" },
    data: {
      lastValue: {
        increment: 1,
      },
    },
  });

  return formatStaffCode(sequence.lastValue);
}

async function ensureConfiguredFounderStaffProfile(ownerUserId: string) {
  const founderEmail = normalizeEmail(env("CAVBOT_FOUNDER_EMAIL"));
  if (!founderEmail) return null;

  const founder = await prisma.user.findUnique({
    where: { email: founderEmail },
    select: {
      id: true,
      email: true,
    },
  });

  if (!founder?.id || founder.id === ownerUserId) return null;

  const founderTitle = env("CAVBOT_FOUNDER_POSITION_TITLE") || "Founder & CEO";
  const ownerStaffCode = getConfiguredOwnerStaffCode();
  const configuredStaffCode = normalizeStaffCode(env("CAVBOT_FOUNDER_STAFF_CODE"));
  const existing = await prisma.staffProfile.findUnique({
    where: { userId: founder.id },
    select: {
      id: true,
      staffCode: true,
    },
  });

  const desiredStaffCode =
    configuredStaffCode && !isRetiredStaffCode(configuredStaffCode) && configuredStaffCode !== ownerStaffCode
      ? configuredStaffCode
      : existing?.staffCode && !isRetiredStaffCode(existing.staffCode) && normalizeStaffCode(existing.staffCode) !== ownerStaffCode
        ? normalizeStaffCode(existing.staffCode)
        : await issueNextStaffCode();

  const floor = parseStaffCodeNumber(desiredStaffCode);
  if (floor > 0) {
    await ensureStaffSequenceFloor(floor);
  }

  return prisma.staffProfile.upsert({
    where: { userId: founder.id },
    update: {
      staffCode: desiredStaffCode,
      systemRole: "OWNER",
      scopes: buildAdminDepartmentScopeSet("COMMAND"),
      positionTitle: founderTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: founder.email,
      metadataJson: {
        founderAccount: true,
        configuredFounder: true,
      },
    },
    create: {
      userId: founder.id,
      staffCode: desiredStaffCode,
      systemRole: "OWNER",
      scopes: buildAdminDepartmentScopeSet("COMMAND"),
      positionTitle: founderTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: founder.email,
      invitedByUserId: ownerUserId,
      createdByUserId: ownerUserId,
      metadataJson: {
        founderAccount: true,
        configuredFounder: true,
      },
    },
  });
}

export async function ensureAdminOwnerBootstrap() {
  const ownerEmail = normalizeEmail(env("ADMIN_OWNER_EMAIL") || env("CAVBOT_OWNER_EMAIL"));
  if (!ownerEmail) {
    return { ok: false as const, reason: "OWNER_EMAIL_MISSING" as const };
  }

  const ownerStaffCode = getConfiguredOwnerStaffCode();
  if (!ownerStaffCode) {
    return { ok: false as const, reason: "OWNER_STAFF_CODE_MISSING" as const, ownerEmail };
  }
  const ownerStaffCodeCandidates = getOwnerStaffCodeCandidates();

  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail.toLowerCase() },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      fullName: true,
    },
  });

  if (!owner) {
    return { ok: false as const, reason: "OWNER_USER_NOT_FOUND" as const, ownerEmail };
  }

  const existingFounder = await prisma.staffProfile.findFirst({
    where: {
      OR: [{ userId: owner.id }, { staffCode: { in: ownerStaffCodeCandidates } }],
    },
    select: {
      id: true,
      userId: true,
      staffCode: true,
    },
  });

  if (
    existingFounder?.staffCode
    && ownerStaffCodeCandidates.includes(normalizeStaffCode(existingFounder.staffCode))
    && existingFounder.userId !== owner.id
  ) {
    throw new Error("Founder staff code is already assigned to another user.");
  }

  const ownerName = env("ADMIN_OWNER_NAME");
  const ownerPositionTitle = env("ADMIN_OWNER_POSITION_TITLE") || env("CAVBOT_OWNER_POSITION_TITLE") || "Founder & CEO";
  const ownerEmailLocal = owner.email.split("@")[0]?.trim().toLowerCase() || "";
  const ownerUsername = String(owner.username || "").trim().toLowerCase();
  const ownerDisplayName = String(owner.displayName || "").trim().toLowerCase();
  const ownerFullName = String(owner.fullName || "").trim().toLowerCase();
  const shouldHydrateOwnerName =
    Boolean(ownerName) && (
      !owner.displayName
      || !owner.fullName
      || ownerDisplayName === ownerEmailLocal
      || ownerFullName === ownerEmailLocal
      || (ownerUsername && ownerDisplayName === ownerUsername)
      || (ownerUsername && ownerFullName === ownerUsername)
    );

  if (shouldHydrateOwnerName) {
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        displayName: ownerName,
        fullName: ownerName,
      },
    });
  }

  const profile = await prisma.staffProfile.upsert({
    where: { userId: owner.id },
    update: {
      staffCode: ownerStaffCode,
      systemRole: "OWNER",
      scopes: buildAdminDepartmentScopeSet("COMMAND"),
      positionTitle: ownerPositionTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: owner.email,
      invitedByUserId: owner.id,
      createdByUserId: owner.id,
      metadataJson: {
        founder: true,
        immutableFounderId: true,
      },
    },
    create: {
      userId: owner.id,
      staffCode: ownerStaffCode,
      systemRole: "OWNER",
      scopes: buildAdminDepartmentScopeSet("COMMAND"),
      positionTitle: ownerPositionTitle,
      status: "ACTIVE",
      onboardingStatus: "COMPLETED",
      invitedEmail: owner.email,
      invitedByUserId: owner.id,
      createdByUserId: owner.id,
      metadataJson: {
        founder: true,
        immutableFounderId: true,
      },
    },
  });

  const ownerStaffFloor = parseStaffCodeNumber(ownerStaffCode);
  if (ownerStaffFloor > 0) {
    await ensureStaffSequenceFloor(ownerStaffFloor);
  }
  await ensureConfiguredFounderStaffProfile(owner.id);

  return {
    ok: true as const,
    profile,
  };
}

export type RequiredAdminContext = {
  userSession: CavbotUserSession;
  adminSession: AdminSession;
  staff: StaffProfileWithUser;
};

function assertStaffSessionIntegrity(adminSession: AdminSession, staff: StaffProfileWithUser) {
  if (adminSession.sub !== staff.userId) throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);
  if (adminSession.staffId !== staff.id || adminSession.staffCode !== staff.staffCode) {
    throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);
  }
  if (toSafeStaffRole(adminSession.role) !== staff.systemRole) {
    throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);
  }
}

function isAllowedStaffStatus(status: StaffStatus) {
  return status === "ACTIVE";
}

export async function requireAdminAccess(req: Request, options?: { scopes?: AdminScope[] }) {
  const userSession = await getSession(req);
  if (!userSession) throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);
  requireUser(userSession);

  const adminSession = await getAdminSession(req);
  let staff = await getStaffProfileByUserId(userSession.sub);
  if (!staff) {
    await ensureAdminOwnerBootstrap();
    staff = await getStaffProfileByUserId(userSession.sub);
  }
  if (!adminSession || !staff) throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);

  assertStaffSessionIntegrity(adminSession, staff);

  if (!isAllowedStaffStatus(staff.status)) {
    throw new ApiAuthError("ADMIN_FORBIDDEN", 403);
  }

  if (options?.scopes?.length) {
    const allowed = options.scopes.every((scope) => hasAdminScope(staff, scope));
    if (!allowed) throw new ApiAuthError("ADMIN_FORBIDDEN", 403);
  }

  return {
    userSession,
    adminSession,
    staff,
  } satisfies RequiredAdminContext;
}

export async function requireActiveStaffSession(req: Request, options?: { scopes?: AdminScope[] }) {
  const userSession = await getSession(req);
  if (!userSession) throw new ApiAuthError("ADMIN_AUTH_REQUIRED", 401);
  requireUser(userSession);

  let staff = await getStaffProfileByUserId(userSession.sub);
  if (!staff) {
    await ensureAdminOwnerBootstrap();
    staff = await getStaffProfileByUserId(userSession.sub);
  }
  if (!staff || !isAllowedStaffStatus(staff.status)) {
    throw new ApiAuthError("ADMIN_FORBIDDEN", 403);
  }

  if (options?.scopes?.length) {
    const allowed = options.scopes.every((scope) => hasAdminScope(staff, scope));
    if (!allowed) throw new ApiAuthError("ADMIN_FORBIDDEN", 403);
  }

  return {
    userSession,
    staff,
  };
}

export async function requireAdminAccessFromRequestContext(pathname: string, options?: { scopes?: AdminScope[] }) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const host = String(headerStore.get("x-forwarded-host") || headerStore.get("host") || "localhost:3000").trim();
  const proto = String(headerStore.get("x-forwarded-proto") || "http").trim() || "http";
  const request = new Request(`${proto}://${host}${pathname}`, {
    method: "GET",
    headers: {
      cookie: cookieStore.toString(),
      "user-agent": String(headerStore.get("user-agent") || "admin"),
      host,
      "x-forwarded-host": host,
      "x-forwarded-proto": proto,
    },
  });

  try {
    return await requireAdminAccess(request, options);
  } catch (error) {
    if (error instanceof ApiAuthError && error.code === "ADMIN_AUTH_REQUIRED") {
      redirect(`/sign-in?next=${encodeURIComponent(sanitizeAdminNextPath(pathname || "/"))}`);
    }
    throw error;
  }
}
