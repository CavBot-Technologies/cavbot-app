// app/api/settings/account/route.ts
import { NextResponse } from "next/server";
import { revalidateTag, unstable_noStore as noStore } from "next/cache";

import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBasicUsername, isReservedUsername, isValidUsername, normalizeUsername } from "@/lib/username";
import { findPublicProfileUserById, findUserById, withDedicatedAuthClient } from "@/lib/authDb";
import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { readAuthSessionView } from "@/lib/authSessionView.server";
import {
  buildAutoWorkspaceSlugCandidates,
  buildPersonalWorkspaceName,
  buildPreferredPersonalWorkspaceSlug,
  normalizeCavbotFounderProfile,
} from "@/lib/profileIdentity";
import { auditLogWrite } from "@/lib/audit";
import {
  readPublicProfileSettingsFallback,
  writePublicProfileSettingsFallback,
  type PublicProfileSettings,
} from "@/lib/publicProfile/publicProfileSettingsStore.server";
import { readCustomLinkUrlFallback, writeCustomLinkUrlFallback } from "@/lib/profile/customLinkStore.server";
import { readSanitizedJson } from "@/lib/security/userInput";

type RawDb = {
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOW_EMAIL_CHANGE = true;
const SETTINGS_ACCOUNT_PROFILE_TIMEOUT_MS = 1_800;

type ToneKey = "lime" | "violet" | "blue" | "white" | "navy" | "transparent";
const MAX_CUSTOM_LINKS = 6;

const BASE_PROFILE_SELECT = {
  email: true,
  username: true,
  displayName: true,
  fullName: true,
  bio: true,
  country: true,
  region: true,
  timeZone: true,
  avatarTone: true,
  avatarImage: true,
} as const;

type ExtraProfileColumn =
  | "companyName"
  | "companyCategory"
  | "companySubcategory"
  | "githubUrl"
  | "instagramUrl"
  | "linkedinUrl"
  | "customLinkUrl"
  | "showCavbotProfileLink"
  | "showStatusOnPublicProfile"
  | "userStatus"
  | "userStatusNote"
  | "userStatusUpdatedAt"
  | "publicProfileEnabled"
  | "publicShowReadme"
  | "publicShowWorkspaceSnapshot"
  | "publicShowHealthOverview"
  | "publicShowCapabilities"
  | "publicShowArtifacts"
  | "publicShowPlanTier"
  | "publicShowBio"
  | "publicShowIdentityLinks"
  | "publicShowIdentityLocation"
  | "publicShowIdentityEmail"
  | "publicWorkspaceId";

const EXTRA_PROFILE_COLUMNS: ExtraProfileColumn[] = [
  "companyName",
  "companyCategory",
  "companySubcategory",
  "githubUrl",
  "instagramUrl",
  "linkedinUrl",
  "customLinkUrl",
  "showCavbotProfileLink",
  "showStatusOnPublicProfile",
  "userStatus",
  "userStatusNote",
  "userStatusUpdatedAt",
  "publicProfileEnabled",
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
];

const PROFILE_COLUMNS_CACHE_TTL = process.env.NODE_ENV === "production" ? 60_000 : 2_000;

let profileColumnsCache: { columns: Set<string>; fetchedAt: number } | null = null;

async function getAvailableProfileColumns() {
  if (profileColumnsCache && Date.now() - profileColumnsCache.fetchedAt < PROFILE_COLUMNS_CACHE_TTL) {
    return profileColumnsCache.columns;
  }

  try {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name = 'User' OR table_name = 'user')
  `;
    const columns = new Set(rows.map((row) => row.column_name));
    profileColumnsCache = { columns, fetchedAt: Date.now() };
    return columns;
  } catch {
    return new Set<string>();
  }
}

async function buildProfileSelect() {
  const columns = await getAvailableProfileColumns();
  const select: Record<string, boolean> = { ...BASE_PROFILE_SELECT };
  EXTRA_PROFILE_COLUMNS.forEach((column) => {
    if (columns.has(column)) {
      select[column] = true;
    }
  });
  return select;
}

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");
const OWNER_EMAIL = String(process.env.CAVBOT_OWNER_EMAIL || process.env.CAVBOT_CONSOLE_EMAIL || "")
  .trim()
  .toLowerCase();

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function cleanStr(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function cleanTone(v: unknown): ToneKey | null {
  const s = String(v ?? "").trim().toLowerCase();
  const allowed: ToneKey[] = ["lime", "violet", "blue", "white", "navy", "transparent"];
  return (allowed as string[]).includes(s) ? (s as ToneKey) : null;
}

function buildAutoWorkspaceNameCandidates(input: {
  email?: unknown;
  username?: unknown;
  displayName?: unknown;
  fullName?: unknown;
}) {
  const values = new Set<string>();
  const emailLocal = String(input.email ?? "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    ?.trim();

  const push = (value: unknown) => {
    const normalized = String(value ?? "").trim();
    if (!normalized) return;
    values.add(buildPersonalWorkspaceName(normalized));
  };

  push(input.displayName);
  push(input.fullName);
  push(input.username);
  push(emailLocal);
  return values;
}

async function findAvailablePersonalAccountSlug(requested: string, excludeAccountIds: string[] = []) {
  let slug = requested;

  for (let i = 0; i < 10; i++) {
    const exists = await prisma.account.findFirst({
      where: {
        slug,
        ...(excludeAccountIds.length ? { id: { notIn: excludeAccountIds } } : {}),
      },
      select: { id: true },
    });
    if (!exists) return slug;
    slug = `${requested}-${Math.random().toString(16).slice(2, 8)}`;
  }

  return `${requested}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeHttpUrl(raw: string): string | null {
  const input = String(raw || "").trim();
  if (!input) return null;
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(withScheme);
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeOptionalHttpUrl(raw: unknown, max: number): { value: string | null; invalid: boolean } {
  const cleaned = cleanStr(raw, max);
  if (!cleaned) return { value: null, invalid: false };
  const normalized = normalizeHttpUrl(cleaned);
  if (!normalized) return { value: null, invalid: true };
  return { value: normalized, invalid: false };
}

function normalizeCustomLinkUrl(raw: unknown): { value: string | null; invalid: boolean } {
  const cleaned = cleanStr(raw, 2000);
  if (!cleaned) return { value: null, invalid: false };

  const inputs = (() => {
    const src = String(cleaned || "").trim();
    if (!src) return [] as string[];
    if (!src.startsWith("[")) return [src];
    try {
      const parsed = JSON.parse(src);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((entry) => String(entry ?? "").trim());
    } catch {
      return null;
    }
  })();

  if (!inputs) return { value: null, invalid: true };

  const normalized = Array.from(
    new Set(
      inputs
        .map((entry) => normalizeHttpUrl(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );

  // Invalid shape if we started with values but none normalized to safe HTTP(S), or if over the fixed slot count.
  if ((inputs.length > 0 && normalized.length === 0) || normalized.length > MAX_CUSTOM_LINKS) {
    return { value: null, invalid: true };
  }

  if (!normalized.length) return { value: null, invalid: false };
  if (normalized.length === 1) return { value: normalized[0], invalid: false };
  return { value: JSON.stringify(normalized), invalid: false };
}

function isValidDataUrlImage(dataUrl: string): boolean {
  if (!dataUrl) return false;
  if (!dataUrl.startsWith("data:image/")) return false;
  if (!dataUrl.includes(";base64,")) return false;
  return true;
}

function approxBytesFromDataUrl(dataUrl: string): number {
  const i = dataUrl.indexOf(";base64,");
  if (i === -1) return dataUrl.length;
  const b64 = dataUrl.slice(i + ";base64,".length);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function clampDataUrlTo2MB(dataUrl: string, maxBytes = 2 * 1024 * 1024): boolean {
  if (!dataUrl) return true;
  const bytes = approxBytesFromDataUrl(dataUrl);
  return bytes <= maxBytes;
}

function normalizePublicProfileSettings(profile: Record<string, unknown>) {
  const founderIdentity = normalizeCavbotFounderProfile({
    username: profile["username"],
    displayName: profile["displayName"],
    fullName: profile["fullName"],
  });
  const normalizedProfile: Record<string, unknown> = {
    ...profile,
    username: founderIdentity.username,
    displayName: founderIdentity.displayName,
    fullName: founderIdentity.fullName,
  };
  const pickBool = (key: string, fallback: boolean) => {
    const v = normalizedProfile[key];
    return typeof v === "boolean" ? v : fallback;
  };

  const publicWorkspaceId = (() => {
    const v = normalizedProfile["publicWorkspaceId"];
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  })();

  return {
    ...normalizedProfile,
    // Public is the default posture; "Private mode" is the inverted UI toggle.
    publicProfileEnabled: pickBool("publicProfileEnabled", true),
    publicShowReadme: pickBool("publicShowReadme", true),
    publicShowWorkspaceSnapshot: pickBool("publicShowWorkspaceSnapshot", true),
    publicShowHealthOverview: pickBool("publicShowHealthOverview", true),
    publicShowCapabilities: pickBool("publicShowCapabilities", true),
    publicShowArtifacts: pickBool("publicShowArtifacts", true),
    publicShowPlanTier: pickBool("publicShowPlanTier", true),
    publicShowBio: pickBool("publicShowBio", true),
    publicShowIdentityLinks: pickBool("publicShowIdentityLinks", true),
    publicShowIdentityLocation: pickBool("publicShowIdentityLocation", true),
    // Email is always opt-in.
    publicShowIdentityEmail: pickBool("publicShowIdentityEmail", false),
    publicWorkspaceId,
  };
}

function authRequiredProfilePayload(errorCode = "UNAUTHORIZED") {
  return {
    ok: false,
    authRequired: true,
    error: errorCode,
    message: "Unauthorized",
  } as const;
}

async function withSettingsProfileDeadline<T>(
  promise: Promise<T>,
  timeoutMs = SETTINGS_ACCOUNT_PROFILE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("SETTINGS_ACCOUNT_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function requireAuthenticatedProfileSession(req: Request): Promise<{
  session: Awaited<ReturnType<typeof requireSession>>;
  userId: string;
}> {
  const session = await requireSession(req);
  requireUser(session);
  const userId = String(session.sub || "").trim();
  if (!userId) {
    throw new Error("Missing user session subject.");
  }
  return { session, userId };
}



export async function GET(req: Request) {
  noStore();
  let userId = "";

  try {
    const info = await requireAuthenticatedProfileSession(req);
    userId = info.userId;

    const fastProfile = await withSettingsProfileDeadline(
      withDedicatedAuthClient((authClient) => findPublicProfileUserById(authClient, info.userId)),
    ).catch(() => null);
    if (fastProfile) {
      return jsonNoStore(
        { ok: true, profile: normalizePublicProfileSettings(fastProfile as unknown as Record<string, unknown>) },
        { status: 200 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: info.userId },
      select: await buildProfileSelect(),
    });

    if (!user) {
      return jsonNoStore({ ok: false, message: "User not found" }, { status: 404 });
    }

    // If DB columns don't exist yet (dev bootstrap), persist/read from fallback store.
    const columns = await getAvailableProfileColumns();
    const customLinkUrlFallback = await readCustomLinkUrlFallback(prisma as unknown as RawDb, info.userId);
    const userCustom = (() => {
      const raw = (user as unknown as Record<string, unknown>)["customLinkUrl"];
      const s = typeof raw === "string" ? raw.trim() : "";
      return s ? s : null;
    })();
    const mergedCustomLinkUrl = customLinkUrlFallback ?? userCustom ?? null;
    const userWithCustomLink = { ...(user as unknown as Record<string, unknown>), customLinkUrl: mergedCustomLinkUrl };
    const hasPublicColumns =
      columns.has("publicProfileEnabled") &&
      columns.has("publicShowReadme") &&
      columns.has("publicShowWorkspaceSnapshot") &&
      columns.has("publicShowHealthOverview") &&
      columns.has("publicShowCapabilities") &&
      columns.has("publicShowArtifacts") &&
      columns.has("publicShowPlanTier") &&
      columns.has("publicShowBio") &&
      columns.has("publicShowIdentityLinks") &&
      columns.has("publicShowIdentityLocation") &&
      columns.has("publicShowIdentityEmail") &&
      columns.has("publicWorkspaceId");

    if (!hasPublicColumns) {
      const settings = await readPublicProfileSettingsFallback(prisma as unknown as RawDb, info.userId);
      return jsonNoStore(
        {
          ok: true,
          profile: {
            ...normalizePublicProfileSettings({
              ...(userWithCustomLink as unknown as Record<string, unknown>),
              ...settings,
            }),
          },
        },
        { status: 200 }
      );
    }

    return jsonNoStore(
      { ok: true, profile: normalizePublicProfileSettings(userWithCustomLink as unknown as Record<string, unknown>) },
      { status: 200 }
    );
  } catch (e: unknown) {
    if (isApiAuthError(e)) {
      return jsonNoStore(authRequiredProfilePayload(e.code), { status: 200 });
    }
    console.error("GET /api/settings/account failed:", e);
    if (userId) {
      try {
        const authView = await withSettingsProfileDeadline(
          requireAuthenticatedProfileSession(req).then((info) => readAuthSessionView(info.session)),
          1_200,
        ).catch(() => null);
        if (authView?.user) {
          return jsonNoStore(
            {
              ok: true,
              degraded: true,
              profile: normalizePublicProfileSettings(authView.user as unknown as Record<string, unknown>),
            },
            { status: 200 }
          );
        }
        const fallbackUser = await withDedicatedAuthClient((authClient) => findUserById(authClient, userId));
        if (fallbackUser) {
          return jsonNoStore(
            {
              ok: true,
              degraded: true,
              profile: normalizePublicProfileSettings({
                email: fallbackUser.email,
                username: fallbackUser.username,
                fullName: fallbackUser.displayName,
                avatarTone: fallbackUser.avatarTone,
                avatarImage: fallbackUser.avatarImage,
              }),
            },
            { status: 200 }
          );
        }
      } catch {
        // Fall through to the generic degraded response.
      }
    }
    return jsonNoStore(
      { ok: true, degraded: true, profile: normalizePublicProfileSettings({}) },
      { status: 200 }
    );
  }
}

export async function PATCH(req: Request) {
  noStore();

  try {
    const info = await requireAuthenticatedProfileSession(req);

    const { userId, session } = info;

    const availableColumns = await getAvailableProfileColumns();
    const profileSelect = await buildProfileSelect();
    const existingProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!existingProfile) {
      return jsonNoStore({ ok: false, message: "User not found" }, { status: 404 });
    }

    const body = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;

    const fullName = cleanStr(body.fullName, 140);
    const bio = cleanStr(body.bio, 300);
    const country = cleanStr(body.country, 80);
    const region = cleanStr(body.region, 80);
    const timeZone = cleanStr(body.timeZone, 64);
    const companyName = cleanStr(body.companyName, 140);
    const companyCategory = cleanStr(body.companyCategory, 80);
    const companySubcategory = cleanStr(body.companySubcategory, 80);
    const githubUrlResult = normalizeOptionalHttpUrl(body.githubUrl, 200);
    const instagramUrlResult = normalizeOptionalHttpUrl(body.instagramUrl, 200);
    const linkedinUrlResult = normalizeOptionalHttpUrl(body.linkedinUrl, 200);
    const customLinkUrlResult = normalizeCustomLinkUrl(body.customLinkUrl);
    if (githubUrlResult.invalid || instagramUrlResult.invalid || linkedinUrlResult.invalid || customLinkUrlResult.invalid) {
      return jsonNoStore(
        { ok: false, message: "Profile links must use valid http:// or https:// URLs." },
        { status: 400 }
      );
    }
    const githubUrl = githubUrlResult.value;
    const instagramUrl = instagramUrlResult.value;
    const linkedinUrl = linkedinUrlResult.value;
    const customLinkUrl = customLinkUrlResult.value;
    const showCavbotProfileLink =
      typeof body.showCavbotProfileLink === "boolean" ? body.showCavbotProfileLink : null;

    let publicProfileEnabled =
      typeof body.publicProfileEnabled === "boolean" ? body.publicProfileEnabled : null;
    const publicShowReadme =
      typeof body.publicShowReadme === "boolean" ? body.publicShowReadme : null;
    const publicShowWorkspaceSnapshot =
      typeof body.publicShowWorkspaceSnapshot === "boolean" ? body.publicShowWorkspaceSnapshot : null;
    const publicShowHealthOverview =
      typeof body.publicShowHealthOverview === "boolean" ? body.publicShowHealthOverview : null;
    const publicShowCapabilities =
      typeof body.publicShowCapabilities === "boolean" ? body.publicShowCapabilities : null;
    const publicShowArtifacts =
      typeof body.publicShowArtifacts === "boolean" ? body.publicShowArtifacts : null;
    const publicShowPlanTier =
      typeof body.publicShowPlanTier === "boolean" ? body.publicShowPlanTier : null;
    const publicShowBio =
      typeof body.publicShowBio === "boolean" ? body.publicShowBio : null;
    const publicShowIdentityLinks =
      typeof body.publicShowIdentityLinks === "boolean" ? body.publicShowIdentityLinks : null;
    const publicShowIdentityLocation =
      typeof body.publicShowIdentityLocation === "boolean" ? body.publicShowIdentityLocation : null;
    const publicShowIdentityEmail =
      typeof body.publicShowIdentityEmail === "boolean" ? body.publicShowIdentityEmail : null;
    const publicWorkspaceIdRaw = cleanStr(body.publicWorkspaceId, 24);
    const publicWorkspaceId =
      publicWorkspaceIdRaw == null ? null : /^[0-9]{1,10}$/.test(publicWorkspaceIdRaw) ? publicWorkspaceIdRaw : null;

    // Username: treat empty string as "no change" to avoid accidentally clearing usernames on save.
    const usernameRawIncoming = typeof body?.username === "string" ? body.username.trim() : null;
    const hasUsernamePatch = Boolean(usernameRawIncoming && usernameRawIncoming !== "");
    const username = hasUsernamePatch ? normalizeUsername(usernameRawIncoming) : null;
    if (hasUsernamePatch && !isBasicUsername(username || "")) {
      return jsonNoStore({ ok: false, message: "Username must be 3–20 chars, lowercase, start with a letter." }, { status: 400 });
    }
    const existingEmailForOwnerCheck = (() => {
      const v = (existingProfile as unknown as Record<string, unknown>)["email"];
      return typeof v === "string" ? v.trim().toLowerCase() : "";
    })();
    const allowReservedForOwner =
      OWNER_USERNAME &&
      username &&
      username === OWNER_USERNAME &&
      (process.env.NODE_ENV !== "production" ||
        (OWNER_EMAIL && Boolean(existingEmailForOwnerCheck) && existingEmailForOwnerCheck === OWNER_EMAIL));

    if (hasUsernamePatch && !allowReservedForOwner) {
      if (!isValidUsername(username || "")) {
        return jsonNoStore({ ok: false, message: "Username must be 3–20 chars, lowercase, start with a letter." }, { status: 400 });
      }
      if (isReservedUsername(username || "")) {
        return jsonNoStore({ ok: false, message: "That username is reserved." }, { status: 400 });
      }
    }

    const effectiveUsername =
      hasUsernamePatch ? username : (existingProfile.username ? normalizeUsername(existingProfile.username) : null);
    if (publicProfileEnabled === true && !effectiveUsername) {
      publicProfileEnabled = false;
    }

    // Private mode semantics (UI uses an inverted toggle). When the profile is private, force all
    // public section toggles OFF server-side as a safety net (no client-only privacy).
    const forcePrivateMode = publicProfileEnabled === false;
    const publicShowReadmeEffective = forcePrivateMode ? false : publicShowReadme;
    const publicShowWorkspaceSnapshotEffective = forcePrivateMode ? false : publicShowWorkspaceSnapshot;
    const publicShowHealthOverviewEffective = forcePrivateMode ? false : publicShowHealthOverview;
    const publicShowCapabilitiesEffective = forcePrivateMode ? false : publicShowCapabilities;
    const publicShowArtifactsEffective = forcePrivateMode ? false : publicShowArtifacts;
    const publicShowPlanTierEffective =
      forcePrivateMode ? false : publicShowWorkspaceSnapshot === false ? false : publicShowPlanTier;
    const publicShowBioEffective = forcePrivateMode ? false : publicShowBio;
    const publicShowIdentityLinksEffective = forcePrivateMode ? false : publicShowIdentityLinks;
    const publicShowIdentityLocationEffective = forcePrivateMode ? false : publicShowIdentityLocation;
    const publicShowIdentityEmailEffective = forcePrivateMode ? false : publicShowIdentityEmail;

    const avatarToneRaw = cleanTone(body.avatarTone);
    const avatarTone = avatarToneRaw === null ? undefined : avatarToneRaw;

    const avatarImageRaw = String(body.avatarImage ?? "").trim();
    const avatarImage = avatarImageRaw ? avatarImageRaw : null;

    if (avatarImage) {
      if (!isValidDataUrlImage(avatarImage)) {
        return jsonNoStore({ ok: false, message: "Invalid avatar image format" }, { status: 400 });
      }
      if (!clampDataUrlTo2MB(avatarImage)) {
        return jsonNoStore({ ok: false, message: "Avatar image too large (max 2MB)" }, { status: 400 });
      }
    }

    const emailIncoming = cleanStr(body.email, 180);
    const email = emailIncoming || null;

    if (email && !ALLOW_EMAIL_CHANGE) {
      return jsonNoStore(
        { ok: false, message: "Email changes are disabled on this environment" },
        { status: 400 }
      );
    }

    if (email) {
      const emailNorm = email.toLowerCase().trim();

      const existing = await prisma.user.findFirst({
        where: { email: emailNorm, NOT: { id: userId } },
        select: { id: true },
      });

      if (existing) {
        return jsonNoStore({ ok: false, message: "Email already in use" }, { status: 409 });
      }
    }

      if (hasUsernamePatch && username) {
        const existing = await prisma.user.findFirst({
          where: { username, NOT: { id: userId } },
          select: { id: true },
        });
      if (existing) {
        return jsonNoStore({ ok: false, message: "Username already in use" }, { status: 409 });
      }
    }

    const normalizedEmail = email ? email.toLowerCase().trim() : null;
    const profileUpdatePayload: Prisma.UserUpdateInput = {
      fullName,
      displayName: fullName,
      bio,
      country,
      region,
      timeZone,
      avatarTone,
      avatarImage,
      ...(availableColumns.has("companyName") ? { companyName } : {}),
      ...(availableColumns.has("companyCategory") ? { companyCategory } : {}),
      ...(availableColumns.has("companySubcategory") ? { companySubcategory } : {}),
      ...(availableColumns.has("githubUrl") ? { githubUrl } : {}),
      ...(availableColumns.has("instagramUrl") ? { instagramUrl } : {}),
      ...(availableColumns.has("linkedinUrl") ? { linkedinUrl } : {}),
      ...(availableColumns.has("customLinkUrl") ? { customLinkUrl } : {}),
      ...(availableColumns.has("showCavbotProfileLink") && showCavbotProfileLink !== null
        ? { showCavbotProfileLink }
        : {}),
      ...(availableColumns.has("publicProfileEnabled") && publicProfileEnabled !== null
        ? { publicProfileEnabled }
        : {}),
      ...(availableColumns.has("publicShowReadme") && publicShowReadmeEffective !== null
        ? { publicShowReadme: publicShowReadmeEffective }
        : {}),
      ...(availableColumns.has("publicShowWorkspaceSnapshot") && publicShowWorkspaceSnapshotEffective !== null
        ? { publicShowWorkspaceSnapshot: publicShowWorkspaceSnapshotEffective }
        : {}),
      ...(availableColumns.has("publicShowHealthOverview") && publicShowHealthOverviewEffective !== null
        ? { publicShowHealthOverview: publicShowHealthOverviewEffective }
        : {}),
      ...(availableColumns.has("publicShowCapabilities") && publicShowCapabilitiesEffective !== null
        ? { publicShowCapabilities: publicShowCapabilitiesEffective }
        : {}),
      ...(availableColumns.has("publicShowArtifacts") && publicShowArtifactsEffective !== null
        ? { publicShowArtifacts: publicShowArtifactsEffective }
        : {}),
      ...(availableColumns.has("publicShowPlanTier") && publicShowPlanTierEffective !== null
        ? { publicShowPlanTier: publicShowPlanTierEffective }
        : {}),
      ...(availableColumns.has("publicShowBio") && publicShowBioEffective !== null
        ? { publicShowBio: publicShowBioEffective }
        : {}),
      ...(availableColumns.has("publicShowIdentityLinks") && publicShowIdentityLinksEffective !== null
        ? { publicShowIdentityLinks: publicShowIdentityLinksEffective }
        : {}),
      ...(availableColumns.has("publicShowIdentityLocation") && publicShowIdentityLocationEffective !== null
        ? { publicShowIdentityLocation: publicShowIdentityLocationEffective }
        : {}),
      ...(availableColumns.has("publicShowIdentityEmail") && publicShowIdentityEmailEffective !== null
        ? { publicShowIdentityEmail: publicShowIdentityEmailEffective }
        : {}),
      ...(availableColumns.has("publicWorkspaceId") && publicWorkspaceIdRaw != null
        ? { publicWorkspaceId }
        : {}),
      ...(hasUsernamePatch ? { username } : {}),
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
    } as Prisma.UserUpdateInput;

    // If public profile columns aren't available, store in fallback table (dev bootstrap) and avoid losing state on refresh.
    const hasPublicColumns =
      availableColumns.has("publicProfileEnabled") &&
      availableColumns.has("publicShowReadme") &&
      availableColumns.has("publicShowWorkspaceSnapshot") &&
      availableColumns.has("publicShowHealthOverview") &&
      availableColumns.has("publicShowCapabilities") &&
      availableColumns.has("publicShowArtifacts") &&
      availableColumns.has("publicShowPlanTier") &&
      availableColumns.has("publicShowBio") &&
      availableColumns.has("publicShowIdentityLinks") &&
      availableColumns.has("publicShowIdentityLocation") &&
      availableColumns.has("publicShowIdentityEmail") &&
      availableColumns.has("publicWorkspaceId");

    const updated = await prisma.user.update({
      where: { id: userId },
      data: profileUpdatePayload,
      select: profileSelect,
    });

    const renameableOwnerMemberships = await prisma.membership.findMany({
      where: { userId, role: "OWNER" },
      select: {
        accountId: true,
        account: {
          select: {
            id: true,
            name: true,
            slug: true,
            _count: { select: { members: true } },
          },
        },
      },
    });

    if (fullName) {
      const oldWorkspaceNames = buildAutoWorkspaceNameCandidates({
        email: existingProfile.email,
        username: existingProfile.username,
        displayName: (existingProfile as Record<string, unknown>).displayName,
        fullName: existingProfile.fullName,
      });
      const nextWorkspaceName = buildPersonalWorkspaceName(fullName);
      if (!oldWorkspaceNames.has(nextWorkspaceName)) {
        const renameableAccountIds = renameableOwnerMemberships
          .filter((membership) => {
            const accountName = String(membership.account.name || "").trim();
            return accountName && oldWorkspaceNames.has(accountName) && membership.account._count.members <= 1;
          })
          .map((membership) => membership.account.id);

        if (renameableAccountIds.length > 0) {
          await prisma.account.updateMany({
            where: { id: { in: renameableAccountIds } },
            data: { name: nextWorkspaceName },
          });
        }
      }
    }

    if (hasUsernamePatch && username) {
      const oldWorkspaceSlugs = buildAutoWorkspaceSlugCandidates({
        email: existingProfile.email,
        username: existingProfile.username,
        displayName: (existingProfile as Record<string, unknown>).displayName,
        fullName: existingProfile.fullName,
      });
      const slugRenameCandidates = renameableOwnerMemberships.filter((membership) => {
        const accountSlug = String(membership.account.slug || "").trim().toLowerCase();
        return accountSlug && oldWorkspaceSlugs.has(accountSlug) && membership.account._count.members <= 1;
      });

      if (slugRenameCandidates.length > 0) {
        const desiredSlug = buildPreferredPersonalWorkspaceSlug({
          username,
          email: normalizedEmail || existingProfile.email,
          displayName: fullName || (existingProfile as Record<string, unknown>).displayName,
          fullName: fullName || existingProfile.fullName,
        });

        for (const membership of slugRenameCandidates) {
          const currentSlug = String(membership.account.slug || "").trim().toLowerCase();
          if (currentSlug === desiredSlug) continue;
          const nextSlug = await findAvailablePersonalAccountSlug(desiredSlug, [membership.account.id]);
          await prisma.account.update({
            where: { id: membership.account.id },
            data: { slug: nextSlug },
          });
        }
      }
    }

    let updatedForResponse = updated as unknown as Record<string, unknown>;
    if (!hasPublicColumns) {
      const patch: Partial<PublicProfileSettings> = {};
      if (publicProfileEnabled !== null) patch.publicProfileEnabled = publicProfileEnabled;
      if (publicShowReadmeEffective !== null) patch.publicShowReadme = publicShowReadmeEffective;
      if (publicShowWorkspaceSnapshotEffective !== null) patch.publicShowWorkspaceSnapshot = publicShowWorkspaceSnapshotEffective;
      if (publicShowHealthOverviewEffective !== null) patch.publicShowHealthOverview = publicShowHealthOverviewEffective;
      if (publicShowCapabilitiesEffective !== null) patch.publicShowCapabilities = publicShowCapabilitiesEffective;
      if (publicShowArtifactsEffective !== null) patch.publicShowArtifacts = publicShowArtifactsEffective;
      if (publicShowPlanTierEffective !== null) patch.publicShowPlanTier = publicShowPlanTierEffective;
      if (publicShowBioEffective !== null) patch.publicShowBio = publicShowBioEffective;
      if (publicShowIdentityLinksEffective !== null) patch.publicShowIdentityLinks = publicShowIdentityLinksEffective;
      if (publicShowIdentityLocationEffective !== null) patch.publicShowIdentityLocation = publicShowIdentityLocationEffective;
      if (publicShowIdentityEmailEffective !== null) patch.publicShowIdentityEmail = publicShowIdentityEmailEffective;
      if (publicWorkspaceIdRaw != null) patch.publicWorkspaceId = publicWorkspaceId;

      const settings = await writePublicProfileSettingsFallback(prisma as unknown as RawDb, userId, patch);
      updatedForResponse = { ...updatedForResponse, ...settings };
    }

    // Persist in dev fallback table so the value survives reloads even if migrations/columns lag.
    const v = await writeCustomLinkUrlFallback(prisma as unknown as RawDb, userId, customLinkUrl);
    updatedForResponse = { ...updatedForResponse, customLinkUrl: v };
    updatedForResponse = normalizePublicProfileSettings(updatedForResponse);

    const trackedBaseFields = ["fullName", "bio", "country", "region", "timeZone", "avatarTone", "avatarImage"];
    const extraFields = [
      "companyName",
      "companyCategory",
      "companySubcategory",
      "githubUrl",
      "instagramUrl",
      "linkedinUrl",
      "customLinkUrl",
      "showCavbotProfileLink",
      "publicProfileEnabled",
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
    ].filter((field) => availableColumns.has(field));
    const trackedFields = [...trackedBaseFields, ...extraFields];

    const previousSnapshot = existingProfile as Record<string, unknown>;
    const updatedSnapshot = profileUpdatePayload as Record<string, unknown>;

    const existingUsername = (existingProfile as unknown as Record<string, unknown>)["username"] ?? null;
    const existingUsernameNorm = existingUsername != null ? normalizeUsername(String(existingUsername)) : "";
    const usernameChanged = hasUsernamePatch && Boolean(username) && username !== existingUsernameNorm;

    const existingEmail = (existingProfile as unknown as Record<string, unknown>)["email"] ?? null;
    const oldEmail = existingEmail ? String(existingEmail).toLowerCase().trim() : null;
    const emailChanged = normalizedEmail && normalizedEmail !== oldEmail;

    const changedProfileFields = trackedFields.filter((field) => {
      const before = previousSnapshot[field];
      const after = updatedSnapshot[field];
      return before !== after;
    });

    let logAction: AuditAction | null = null;
    let logMeta: Record<string, unknown> | null = null;

    if (usernameChanged) {
      logAction = "USERNAME_CHANGED";
      logMeta = {
        oldUsername: existingProfile.username,
        newUsername: username,
      };
    } else if (emailChanged) {
      logAction = "EMAIL_CHANGED";
      logMeta = {
        oldEmail,
        newEmail: normalizedEmail,
      };
    } else if (changedProfileFields.length > 0) {
      logAction = "PROFILE_UPDATED";
      logMeta = { fieldsChanged: changedProfileFields };
    }

    if (logAction && session.accountId) {
      const existingUsernameLabel =
        (existingProfile as unknown as Record<string, unknown>)["username"] ?? null;
      await auditLogWrite({
        request: req,
        action: logAction,
        accountId: session.accountId,
        operatorUserId: userId,
        targetType: "user",
        targetId: userId,
        targetLabel: String((usernameChanged && username) || existingUsernameLabel || userId),
        metaJson: logMeta,
      });
    }

    // Invalidate public profile VM cache so identity links (GitHub/Instagram/LinkedIn/etc) appear immediately.
    try { revalidateTag("cb-public-profile-v1"); } catch {}

    return jsonNoStore({ ok: true, profile: updatedForResponse }, { status: 200 });
  } catch (e: unknown) {
    if (isApiAuthError(e)) {
      return jsonNoStore({ ok: false, error: e.code, message: "Unauthorized" }, { status: e.status });
    }
    console.error("PATCH /api/settings/account failed:", e);
    return jsonNoStore({ ok: false, message: "Save failed." }, { status: 500 });
  }
}
