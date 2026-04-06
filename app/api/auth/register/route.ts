// app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { isReservedUsername, isValidUsername, normalizeUsername } from "@/lib/username";
import {
  assertWriteOrigin,
  createUserSession,
  hashPassword,
  isApiAuthError,
  sessionCookieOptions,
} from "@/lib/apiAuth";

import { auditLogWrite } from "@/lib/audit";
import {
  buildVerifyErrorPayload,
  ensureActionVerification,
  extractVerifyGrantToken,
  extractVerifySessionId,
  recordVerifyActionFailure,
  recordVerifyActionSuccess,
} from "@/lib/auth/cavbotVerify";
import {
  findUserByEmail,
  findUserByUsername,
  getAuthPool,
  isPgUniqueViolation,
  newDbId,
  pgUniqueViolationMentions,
  withAuthTransaction,
} from "@/lib/authDb";
import { buildPreferredPersonalWorkspaceSlug, derivePersonalWorkspaceNameFromEmail } from "@/lib/profileIdentity";
import { sendSignupWelcomeEmail } from "@/lib/signupWelcomeEmail.server";

import { createHash, randomBytes } from "crypto";
import { readSanitizedJson, readSanitizedFormData } from "@/lib/security/userInput";
import { readCoarseRequestGeo } from "@/lib/requestGeo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

type RegisterBody = {
  email?: string;
  password?: string;
  displayName?: string;
  username?: string;
  accountName?: string;
  accountSlug?: string;
  verificationGrantToken?: string;
  verificationSessionId?: string;
};

function env(name: string) {
  return String(process.env[name as keyof NodeJS.ProcessEnv] || "").trim();
}

function normalizeEmail(email: unknown) {
  return String(email ?? "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(email || "").trim());
}

function toSlug(input: unknown) {
  const s = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "account";
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

async function sha256Hex(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === "string" ? value : String(value);
}

async function readBody(req: Request): Promise<RegisterBody> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const raw = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;
    return {
      email: toStringValue(raw.email),
      password: toStringValue(raw.password),
      displayName: toStringValue(raw.displayName) ?? toStringValue(raw.name),
      username: toStringValue(raw.username),
      accountName: toStringValue(raw.accountName),
      accountSlug: toStringValue(raw.accountSlug),
      verificationGrantToken: toStringValue(raw.verificationGrantToken),
      verificationSessionId: toStringValue(raw.verificationSessionId) ?? toStringValue(raw.verifySessionId),
    };
  }

  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await readSanitizedFormData(req, null);
    if (!fd) return {};
    return {
      email: toStringValue(fd.get("email")),
      password: toStringValue(fd.get("password")),
      displayName: toStringValue(fd.get("displayName")) ?? toStringValue(fd.get("name")),
      username: toStringValue(fd.get("username")),
      accountName: toStringValue(fd.get("accountName")),
      accountSlug: toStringValue(fd.get("accountSlug")),
      verificationGrantToken: toStringValue(fd.get("verificationGrantToken")),
      verificationSessionId: toStringValue(fd.get("verificationSessionId")) ?? toStringValue(fd.get("verifySessionId")),
    };
  }

  const fallback = (await readSanitizedJson(req, ({}))) as Record<string, unknown>;
  return {
    email: toStringValue(fallback.email),
    password: toStringValue(fallback.password),
    displayName: toStringValue(fallback.displayName) ?? toStringValue(fallback.name),
    username: toStringValue(fallback.username),
    accountName: toStringValue(fallback.accountName),
    accountSlug: toStringValue(fallback.accountSlug),
    verificationGrantToken: toStringValue(fallback.verificationGrantToken),
    verificationSessionId: toStringValue(fallback.verificationSessionId) ?? toStringValue(fallback.verifySessionId),
  };
}

type Queryable = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

async function findAvailableAccountSlug(queryable: Queryable, requested: string) {
  let slug = requested;

  for (let i = 0; i < 10; i++) {
    const exists = await queryable.query<{ slug: string }>(
      `SELECT "slug" FROM "Account" WHERE "slug" = $1 LIMIT 1`,
      [slug],
    );
    if (!exists.rows[0]) return slug;
    slug = `${requested}-${randomToken(3)}`;
  }

  return `${requested}-${randomToken(6)}`;
}

/* =========================
  Cloudflare IP + Geo
  ========================= */

export async function POST(req: Request) {
  try {
    const pool = getAuthPool();
    assertWriteOrigin(req);

    if (env("CAVBOT_PUBLIC_SIGNUP") !== "1") {
      return json({ ok: false, error: "signup_disabled" }, 403);
    }

    const body = await readBody(req);

    const verificationGate = ensureActionVerification(req, {
      actionType: "signup",
      route: "/auth",
      sessionIdHint: extractVerifySessionId(req, body?.verificationSessionId),
      verificationGrantToken: extractVerifyGrantToken(req, body?.verificationGrantToken),
    });
    if (!verificationGate.ok) {
      return json(
        buildVerifyErrorPayload(verificationGate),
        verificationGate.decision === "block" ? 429 : 403,
      );
    }

    const verifySessionHint = verificationGate.sessionId;
    const reject = (payload: Record<string, unknown>, status: number) => {
      recordVerifyActionFailure(req, { actionType: "signup", sessionIdHint: verifySessionHint });
      return json(payload, status);
    };

    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    const displayNameRaw =
      body?.displayName != null && String(body.displayName).trim() ? String(body.displayName).trim() : null;
    const usernameRaw = body?.username != null ? String(body.username).trim() : "";
    const usernameNorm = normalizeUsername(usernameRaw);

    if (!email || !password) return reject({ ok: false, error: "missing_fields" }, 400);
    if (!isValidEmail(email)) return reject({ ok: false, error: "invalid_email" }, 400);
    if (!usernameRaw) {
      return reject({ ok: false, error: "username_required", message: "Username is required." }, 400);
    }
    if (usernameRaw !== usernameNorm) {
      return reject({ ok: false, error: "username_lowercase", message: "Username must be lowercase." }, 400);
    }
    if (!isValidUsername(usernameNorm)) {
      return reject(
        { ok: false, error: "invalid_username", message: "Username must be 3–20 chars, lowercase, start with a letter." },
        400,
      );
    }
    if (isReservedUsername(usernameNorm)) {
      return reject({ ok: false, error: "username_reserved", message: "That username is reserved." }, 400);
    }

    if (password.length < 10) {
      return reject({ ok: false, error: "weak_password", message: "Use 10+ characters." }, 400);
    }

    const existingUser = await findUserByEmail(pool, email);
    if (existingUser) return reject({ ok: false, error: "email_in_use" }, 409);

    const existingUsername = await findUserByUsername(pool, usernameNorm);
    if (existingUsername) return reject({ ok: false, error: "username_in_use" }, 409);

    const displayName = displayNameRaw && displayNameRaw.length > 64 ? displayNameRaw.slice(0, 64) : displayNameRaw;

    const accountName =
      body?.accountName != null && String(body.accountName).trim()
        ? String(body.accountName).trim()
        : derivePersonalWorkspaceNameFromEmail(email);

    const requestedSlug =
      body?.accountSlug != null && String(body.accountSlug).trim()
        ? toSlug(body.accountSlug)
        : buildPreferredPersonalWorkspaceSlug({ username: usernameNorm, email, displayName });

    const accountSlug = await findAvailableAccountSlug(pool, requestedSlug);

    const pass = await hashPassword(password);

    const serverKeyRaw = `cavbot_sk_${randomToken(24)}`;
    const serverKeyHash = await sha256Hex(serverKeyRaw);
    const serverKeyLast4 = serverKeyRaw.slice(-4);

    const now = new Date();
    const trialDays = 14;
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const geo = readCoarseRequestGeo(req);

      try {
        const result = await withAuthTransaction(async (tx) => {
          const username = usernameNorm;
          const userId = newDbId();
          const accountId = newDbId();

          await tx.query(
            `INSERT INTO "User" (
                "id",
                "email",
                "username",
                "displayName",
                "lastLoginAt",
                "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [userId, email, username, displayName || null, now],
          );

          await tx.query(
            `INSERT INTO "UserAuth" (
                "userId",
                "passwordAlgo",
                "passwordIters",
                "passwordSalt",
                "passwordHash",
                "updatedAt"
              ) VALUES ($1, $2, $3, $4, $5, NOW())`,
            [userId, pass.algo, pass.iters, pass.salt, pass.hash],
          );

          await tx.query(
            `INSERT INTO "Account" (
                "id",
                "name",
                "slug",
                "tier",
                "trialSeatActive",
                "trialStartedAt",
                "trialEndsAt",
                "trialEverUsed",
                "updatedAt"
              ) VALUES ($1, $2, $3, 'FREE'::"PlanTier", true, $4, $5, true, NOW())`,
            [accountId, accountName, accountSlug, now, trialEndsAt],
          );

          await tx.query(
            `INSERT INTO "Membership" (
                "id",
                "accountId",
                "userId",
                "role"
              ) VALUES ($1, $2, $3, 'OWNER'::"MemberRole")`,
            [newDbId(), accountId, userId],
          );

          await tx.query(
            `INSERT INTO "Subscription" (
                "id",
                "accountId",
                "status",
                "tier",
                "currentPeriodStart",
                "currentPeriodEnd",
                "updatedAt"
              ) VALUES ($1, $2, 'TRIALING'::"SubscriptionStatus", 'FREE'::"PlanTier", $3, $4, NOW())`,
            [newDbId(), accountId, now, trialEndsAt],
          );

          const projectInsert = await tx.query<{ id: number; slug: string }>(
            `INSERT INTO "Project" (
                "accountId",
                "name",
                "slug",
                "serverKeyHash",
                "serverKeyLast4",
                "isActive",
                "updatedAt"
              ) VALUES ($1, $2, 'primary', $3, $4, true, NOW())
              RETURNING "id", "slug"`,
            [accountId, "Primary Project", serverKeyHash, serverKeyLast4],
          );

          const project = {
            id: Number(projectInsert.rows[0]?.id || 0),
            slug: String(projectInsert.rows[0]?.slug || "primary"),
          };

          await tx.query(
            `INSERT INTO "ProjectGuardrails" (
                "projectId",
                "updatedAt"
              ) VALUES ($1, NOW())`,
            [project.id],
          );

          await tx.query(
            `INSERT INTO "ProjectGeoPolicy" (
                "projectId",
                "updatedAt"
              ) VALUES ($1, NOW())`,
            [project.id],
          );

          return {
            user: { id: userId, email, username },
            account: { id: accountId, slug: accountSlug },
            project,
          };
        });

    if (result.account.id) {
      await auditLogWrite({
        request: req,
        action: "ACCOUNT_CREATED",
        accountId: result.account.id,
        operatorUserId: result.user.id,
        targetType: "auth",
        targetId: result.user.id,
        targetLabel: result.user.email || result.user.username || result.user.id,
        metaJson: {
          security_event: "register",
          location: geo.label,
          geoRegion: geo.region,
          geoCountry: geo.country,
        },
      });
    }

      const token = await createUserSession({
        userId: result.user.id,
        accountId: result.account.id,
        memberRole: "OWNER",
      });

      const res = json(
        {
          ok: true,
          userId: result.user.id,
          accountId: result.account.id,
          accountSlug: result.account.slug,
          defaultProjectId: result.project.id,
          defaultProjectSlug: result.project.slug,
          serverKey: serverKeyRaw,
        },
        201
      );

      const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
      const cookieOpts = {
        ...cookieOptsFromLib,
        secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
      };
      res.cookies.set(name, token, cookieOpts);

      const pointerCookieOpts = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      };

      res.cookies.set("cb_active_project_id", String(result.project.id), pointerCookieOpts);
      res.cookies.set("cb_pid", String(result.project.id), pointerCookieOpts);

      await sendSignupWelcomeEmail({
        userId: result.user.id,
        email,
        source: "register",
      });

      recordVerifyActionSuccess(req, { actionType: "signup", sessionIdHint: verifySessionHint });
      return res;
      } catch (error) {
        if (isPgUniqueViolation(error)) {
          if (pgUniqueViolationMentions(error, "email")) return reject({ ok: false, error: "email_in_use" }, 409);
          if (pgUniqueViolationMentions(error, "username")) return reject({ ok: false, error: "username_in_use" }, 409);
          if (pgUniqueViolationMentions(error, "slug")) return reject({ ok: false, error: "account_slug_in_use" }, 409);
          return reject({ ok: false, error: "conflict" }, 409);
        }
        throw error;
      }
    } catch (error) {
      if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: "register_failed", message }, 500);
    }
}
