import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReservedUsername, isValidUsername, normalizeUsername, USERNAME_MAX } from "@/lib/username";
import {
  buildPersonalWorkspaceName,
  buildPreferredPersonalWorkspaceSlug,
  hasMeaningfulProfileName,
  normalizeProviderDisplayName,
} from "@/lib/profileIdentity";
import {
  createUserSession,
  getAppOrigin,
  isApiAuthError,
  sessionCookieOptions,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { createHash, randomBytes } from "crypto";
import { sendSignupWelcomeEmail } from "@/lib/signupWelcomeEmail.server";
import { readCoarseRequestGeo } from "@/lib/requestGeo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type Role = "OWNER" | "ADMIN" | "MEMBER";
function roleRank(role: Role) {
  if (role === "OWNER") return 3;
  if (role === "ADMIN") return 2;
  return 1;
}

function normalizeRole(value: string | null | undefined): Role {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  return "MEMBER";
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function appBase() {
  return getAppOrigin().replace(/\/+$/, "");
}

function normalizeMode(mode: string | null | undefined) {
  return mode === "login" ? "login" : "signup";
}

function withNoStore(res: NextResponse) {
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);
  return res;
}

function redirectTo(req: NextRequest, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return withNoStore(NextResponse.redirect(`${appBase()}${p}`));
}

function normalizeEmail(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

async function sha256Hex(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

async function findAvailableUsername(tx: Prisma.TransactionClient, base: string) {
  let candidate = normalizeUsername(base);
  if (!candidate || candidate.length < 3 || !isValidUsername(candidate) || isReservedUsername(candidate)) {
    candidate = `cavuser${randomToken(2)}`;
  }
  if (candidate.length > USERNAME_MAX) candidate = candidate.slice(0, USERNAME_MAX);

  for (let i = 0; i < 10; i++) {
    const exists = await tx.user.findUnique({ where: { username: candidate } });
    if (!exists) return candidate;
    candidate = `${candidate}_${randomToken(2)}`.slice(0, USERNAME_MAX);
    candidate = candidate.replace(/[^a-z0-9_]/g, "");
  }

  return `${candidate}_${randomToken(3)}`.slice(0, USERNAME_MAX).replace(/[^a-z0-9_]/g, "");
}

async function findAvailableAccountSlug(requested: string) {
  let slug = requested;

  for (let i = 0; i < 10; i++) {
    const exists = await prisma.account.findUnique({ where: { slug } });
    if (!exists) return slug;
    slug = `${requested}-${randomToken(3)}`;
  }

  return `${requested}-${randomToken(6)}`;
}

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set(name, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

async function exchangeCodeForToken(code: string) {
  const client_id = mustEnv("GOOGLE_CLIENT_ID");
  const client_secret = mustEnv("GOOGLE_CLIENT_SECRET");
  const redirect_uri = `${appBase()}/api/auth/oauth/google/callback`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      code,
      grant_type: "authorization_code",
      redirect_uri,
    }).toString(),
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || "google_token_exchange_failed");
  }

  return {
    accessToken: String(data.access_token),
    idToken: data.id_token ? String(data.id_token) : "",
  };
}

async function fetchGoogleUserinfo(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("google_userinfo_failed");
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    const cookieState = req.cookies.get("cb_google_oauth_state")?.value || "";
    const next = req.cookies.get("cb_google_oauth_next")?.value || "/";
    const mode = normalizeMode(req.cookies.get("cb_google_oauth_mode")?.value);
    const safeNext = next.startsWith("/") ? next : "/";
    const authPath = (error: string) => `/auth?mode=${mode}&error=${error}`;

    if (!code) return redirectTo(req, authPath("google_missing_code"));

    if (!state || !cookieState || state !== cookieState) {
      return redirectTo(req, authPath("google_state_mismatch"));
    }

    // 1) Exchange code -> token
    const { accessToken } = await exchangeCodeForToken(code);

    // 2) Fetch user identity (OpenID Connect)
    const profile = await fetchGoogleUserinfo(accessToken);

    const googleId = String(profile?.sub || "");
    const email = normalizeEmail(profile?.email || "");
    const emailVerified = Boolean(profile?.email_verified);
    const displayName = normalizeProviderDisplayName(profile?.name || profile?.given_name || "") || undefined;
    const geo = readCoarseRequestGeo(req);

    if (!googleId) {
      return redirectTo(req, authPath("google_id_missing"));
    }

    if (!email) {
      return redirectTo(req, authPath("google_email_missing"));
    }

    const now = new Date();

    // 3) Resolve/Upsert user + identity + workspace
    const result = await prisma.$transaction(async (tx) => {
      let createdUser = false;
      let createdWorkspace = false;

      // A) Find by OAuthIdentity OR by email
      const existingIdentity = await tx.oAuthIdentity.findUnique({
        where: {
          provider_providerId: {
            provider: "google",
            providerId: googleId,
          },
        },
        select: { userId: true },
      });

      let user =
        existingIdentity?.userId
          ? await tx.user.findUnique({
              where: { id: existingIdentity.userId },
              select: { id: true, email: true, username: true, displayName: true, fullName: true },
            })
          : null;

      if (!user) {
        user = await tx.user.findUnique({
          where: { email },
          select: { id: true, email: true, username: true, displayName: true, fullName: true },
        });
      }

      // B) Create or update user
      if (!user) {
        const username = await findAvailableUsername(tx, email.split("@")[0] || "cavbot");
        user = await tx.user.create({
          data: {
            email,
            username,
            displayName: displayName || undefined,
            emailVerifiedAt: emailVerified ? now : undefined,
            lastLoginAt: now,
          },
          select: { id: true, email: true, username: true, displayName: true, fullName: true },
        });
        createdUser = true;
      } else {
        const shouldFillDisplayName =
          !hasMeaningfulProfileName(user.fullName) && !hasMeaningfulProfileName(user.displayName);
        await tx.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: now,
            ...(shouldFillDisplayName && displayName ? { displayName } : {}),
            emailVerifiedAt: emailVerified ? now : undefined,
            ...(user.username ? {} : { username: await findAvailableUsername(tx, email.split("@")[0] || "cavbot") }),
          },
        });
      }

      // C) Upsert OAuthIdentity link
      await tx.oAuthIdentity.upsert({
        where: {
          provider_providerId: {
            provider: "google",
            providerId: googleId,
          },
        },
        update: {
          userId: user.id,
          email: email || undefined,
        },
        create: {
          provider: "google",
          providerId: googleId,
          userId: user.id,
          email: email || undefined,
        },
      });

      // D) Ensure workspace exists
      let memberships = await tx.membership.findMany({
        where: { userId: user.id },
        select: { id: true, accountId: true, role: true, createdAt: true },
      });

      if (!memberships?.length) {
        const desiredSlug = buildPreferredPersonalWorkspaceSlug({
          username: user.username,
          email,
          displayName,
        });
        const accountSlug = await findAvailableAccountSlug(desiredSlug);

        const accountName = buildPersonalWorkspaceName(displayName);

        const trialDays = 14;
        const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

        const serverKeyRaw = `cavbot_sk_${randomToken(24)}`;
        const serverKeyHash = await sha256Hex(serverKeyRaw);
        const serverKeyLast4 = serverKeyRaw.slice(-4);

        const account = await tx.account.create({
          data: {
            name: accountName,
            slug: accountSlug,
            tier: "FREE",
            trialSeatActive: true,
            trialStartedAt: now,
            trialEndsAt,
            trialEverUsed: true,
          },
          select: { id: true },
        });

        await tx.membership.create({
          data: {
            accountId: account.id,
            userId: user.id,
            role: "OWNER",
          },
        });

        await tx.subscription.create({
          data: {
            accountId: account.id,
            status: "TRIALING",
            tier: "FREE",
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt,
          },
        });

        const project = await tx.project.create({
          data: {
            accountId: account.id,
            name: "Primary Project",
            slug: "primary",
            serverKeyHash,
            serverKeyLast4,
            isActive: true,
          },
          select: { id: true },
        });

        await tx.projectGuardrails.create({
          data: {
            projectId: project.id,
            blockUnknownOrigins: true,
            enforceAllowlist: true,
            alertOn404Spike: true,
            alertOnJsSpike: true,
            strictDeletion: true,
          },
        });

        await tx.projectGeoPolicy.create({
          data: {
            projectId: project.id,
            enabled: true,
            captureLevel: "COUNTRY",
            storeContinent: true,
            storeCountry: true,
            storeSubdivision: false,
            storeCity: false,
            includeInDashboard: true,
          },
        });
        createdWorkspace = true;

        memberships = await tx.membership.findMany({
          where: { userId: user.id },
          select: { id: true, accountId: true, role: true, createdAt: true },
        });
      }

      if (!memberships?.length) throw new Error("oauth_membership_missing");

      const active = [...memberships].sort((a, b) => {
        const rr = roleRank(normalizeRole(b.role)) - roleRank(normalizeRole(a.role));
        if (rr !== 0) return rr;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })[0];

      const firstProject = await tx.project.findFirst({
        where: { accountId: active.accountId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      return { user, active, firstProject, createdUser, createdWorkspace };
    });

    // 4) Mint CavBot session
    const memberRole = normalizeRole(result.active.role);
    const session = await createUserSession({
      userId: result.user.id,
      accountId: result.active.accountId,
      memberRole,
    });

    // 5) Redirect to next destination
    const res = withNoStore(NextResponse.redirect(`${appBase()}${safeNext}`));

    // Clear oauth cookies
    clearCookie(res, "cb_google_oauth_state");
    clearCookie(res, "cb_google_oauth_next");
    clearCookie(res, "cb_google_oauth_mode");

    // Session cookie
    const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
    const cookieOpts = {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    };
    res.cookies.set(name, session, cookieOpts);

    // Workspace pointers
    if (result.firstProject?.id) {
      const pointerCookieOpts = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      };

      res.cookies.set("cb_active_project_id", String(result.firstProject.id), pointerCookieOpts);
      res.cookies.set("cb_pid", String(result.firstProject.id), pointerCookieOpts);
    }

    if (result.createdWorkspace) {
      await auditLogWrite({
        request: req,
        action: "ACCOUNT_CREATED",
        accountId: result.active.accountId,
        operatorUserId: result.user.id,
        targetType: "auth",
        targetId: result.user.id,
        targetLabel: result.user.email || result.user.username || result.user.id,
        metaJson: {
          security_event: "oauth_workspace_created",
          provider: "google",
          location: geo.label,
          geoRegion: geo.region,
          geoCountry: geo.country,
        },
      });
    }

    await auditLogWrite({
      request: req,
      action: "AUTH_SIGNED_IN",
      accountId: result.active.accountId,
      operatorUserId: result.user.id,
      targetType: "auth",
      targetId: result.user.id,
      targetLabel: result.user.email || result.user.username || result.user.id,
      metaJson: {
        security_event: result.createdUser ? "oauth_register" : "oauth_login",
        method: "oauth_google",
        location: geo.label,
        geoRegion: geo.region,
        geoCountry: geo.country,
      },
    });

    if (result.createdUser) {
      await sendSignupWelcomeEmail({
        userId: result.user.id,
        email: result.user.email,
        source: "google_oauth",
      });
    }

    return res;
  } catch (error) {
    if (isApiAuthError(error)) {
      return redirectTo(req, `/auth?mode=${normalizeMode(req.cookies.get("cb_google_oauth_mode")?.value)}&error=auth_error`);
    }
    console.error("[auth][oauth][google][callback]", error);
    return redirectTo(req, `/auth?mode=${normalizeMode(req.cookies.get("cb_google_oauth_mode")?.value)}&error=oauth_failed`);
  }
}
