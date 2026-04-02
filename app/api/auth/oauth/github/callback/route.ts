// app/api/auth/oauth/github/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { MemberRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReservedUsername, isValidUsername, normalizeUsername, USERNAME_MAX } from "@/lib/username";
import { createUserSession, isApiAuthError, sessionCookieOptions } from "@/lib/apiAuth";
import { createHash, randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function roleRank(role: MemberRole) {
  if (role === "OWNER") return 3;
  if (role === "ADMIN") return 2;
  return 1;
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function appBase(req: NextRequest) {
  return req.nextUrl.origin.replace(/\/+$/, "");
}

function normalizeMode(mode: string | null | undefined) {
  return mode === "login" ? "login" : "signup";
}

function withNoStore(res: NextResponse) {
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.headers.set(k, v);
  return res;
}

function safeNextPath(input: string | null) {
  const raw = String(input || "").trim();
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\n") || raw.includes("\r")) return "/";
  return raw;
}

function redirectTo(req: NextRequest, path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return withNoStore(NextResponse.redirect(`${appBase(req)}${p}`));
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

function normalizeEmail(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
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

async function exchangeCodeForToken(code: string) {
  const client_id = mustEnv("GITHUB_CLIENT_ID");
  const client_secret = mustEnv("GITHUB_CLIENT_SECRET");

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ client_id, client_secret, code }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "github_token_exchange_failed");
  }

  return String(data.access_token);
}

async function fetchGitHubProfile(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "CavBot",
      accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("github_profile_failed");
  return data;
}

async function fetchGitHubEmail(token: string) {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "CavBot",
      accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });

  const data = (await res.json().catch(() => [])) as Array<{
    email?: string;
    primary?: boolean;
    verified?: boolean;
  }>;
  if (!res.ok || !Array.isArray(data)) throw new Error("github_email_failed");

  const primary = data.find((entry) => entry.primary && entry.verified);
  const anyVerified = data.find((entry) => entry.verified);
  const fallback = data[0];

  return normalizeEmail(primary?.email || anyVerified?.email || fallback?.email || "");
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    const cookieState = req.cookies.get("cb_oauth_state")?.value || "";
    const nextCookie = req.cookies.get("cb_oauth_next")?.value || "/";
    const mode = normalizeMode(req.cookies.get("cb_oauth_mode")?.value);
    const safeNext = safeNextPath(nextCookie);
    const authPath = (error: string) => `/auth?mode=${mode}&error=${error}`;

    if (!code) return redirectTo(req, authPath("github_missing_code"));
    if (!state || !cookieState || state !== cookieState) {
      return redirectTo(req, authPath("github_state_mismatch"));
    }

    // 1) Exchange code -> token
    const ghToken = await exchangeCodeForToken(code);

    // 2) Fetch GitHub profile
    const profile = await fetchGitHubProfile(ghToken);

    const githubId = String(profile?.id || "");
    const login = String(profile?.login || "").trim();
    const displayName =
      String(profile?.name || profile?.login || "")
        .trim()
        .slice(0, 64) || undefined;

    if (!githubId) return redirectTo(req, authPath("github_id_missing"));

    // 3) Fetch email (required for your User model)
    let email = "";
    try {
      email = await fetchGitHubEmail(ghToken);
    } catch {
      email = "";
    }
    if (!email) return redirectTo(req, authPath("github_email_missing"));

    const now = new Date();

    // 4) Resolve identity + user + workspace inside one transaction (bulletproof)
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // A) Lookup identity first
      const identity = await tx.oAuthIdentity.findUnique({
        where: {
          provider_providerId: {
            provider: "github",
            providerId: githubId,
          },
        },
        select: { userId: true },
      });

      // B) Find user either by identity OR by email
      let user = identity?.userId
        ? await tx.user.findUnique({
            where: { id: identity.userId },
            select: { id: true, email: true, username: true },
          })
        : null;

      if (!user) {
        user = await tx.user.findUnique({
          where: { email },
          select: { id: true, email: true, username: true },
        });
      }

      // C) Create user if missing
      if (!user) {
        const username = await findAvailableUsername(tx, email.split("@")[0] || "cavbot");
        user = await tx.user.create({
          data: {
            email,
            username,
            displayName: displayName || undefined,
            lastLoginAt: now,
          },
          select: { id: true, email: true, username: true },
        });
      } else {
        // Update login stamp + displayName
        await tx.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: now,
            displayName: displayName || undefined,
            ...(user.username ? {} : { username: await findAvailableUsername(tx, email.split("@")[0] || "cavbot") }),
          },
        });

        // Optional: If GitHub email changed & the new email isn't taken, update it.
        if (email && email !== user.email) {
          const taken = await tx.user.findUnique({ where: { email } });
          if (!taken) {
            user = await tx.user.update({
              where: { id: user.id },
              data: { email },
              select: { id: true, email: true, username: true },
            });
          }
        }
      }

      // D) Upsert identity link (prevents duplicate accounts)
      await tx.oAuthIdentity.upsert({
        where: {
          provider_providerId: {
            provider: "github",
            providerId: githubId,
          },
        },
        update: {
          userId: user.id,
          email: email || undefined,
        },
        create: {
          provider: "github",
          providerId: githubId,
          userId: user.id,
          email: email || undefined,
        },
      });

      // E) Ensure memberships exist (workspace)
      let memberships = await tx.membership.findMany({
        where: { userId: user.id },
        select: { accountId: true, role: true, createdAt: true },
      });

      // Create full workspace (same as register route) if none exists
      if (!memberships.length) {
        const desiredSlug = toSlug(login || `acct-${user.id.slice(-8)}`);

        // find available slug (within transaction)
        let slug = desiredSlug;
        for (let i = 0; i < 10; i++) {
          const exists = await tx.account.findUnique({ where: { slug } });
          if (!exists) break;
          slug = `${desiredSlug}-${randomToken(3)}`;
        }

        const accountName = `${(login || displayName || "CavBot").slice(0, 32)} Account`;

        const trialDays = 14;
        const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

        const serverKeyRaw = `cavbot_sk_${randomToken(24)}`;
        const serverKeyHash = await sha256Hex(serverKeyRaw);
        const serverKeyLast4 = serverKeyRaw.slice(-4);

        const account = await tx.account.create({
          data: {
            name: accountName,
            slug,
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

        memberships = await tx.membership.findMany({
          where: { userId: user.id },
          select: { accountId: true, role: true, createdAt: true },
        });
      }

      if (!memberships.length) throw new Error("oauth_membership_missing");

      // F) Choose active membership deterministically
      const active = [...memberships].sort((a, b) => {
        const rr = roleRank(b.role) - roleRank(a.role);
        if (rr !== 0) return rr;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })[0];

      const firstProject = await tx.project.findFirst({
        where: { accountId: active.accountId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      return { user, active, firstProject };
    });

    // 5) Mint official CavBot session
    const token = await createUserSession({
      userId: result.user.id,
      accountId: result.active.accountId,
      memberRole: result.active.role,
    });

    // 6) Redirect to safe next location
    const res = withNoStore(NextResponse.redirect(`${appBase(req)}${safeNext}`));

    // clear oauth cookies
    clearCookie(res, "cb_oauth_state");
    clearCookie(res, "cb_oauth_next");
    clearCookie(res, "cb_oauth_mode");

    // session cookie (matches your login/register routes)
    const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
    const cookieOpts = {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    };
    res.cookies.set(name, token, cookieOpts);

    // pointer cookies (matches login/register)
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

    return res;
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return redirectTo(req, `/auth?mode=${normalizeMode(req.cookies.get("cb_oauth_mode")?.value)}&error=auth_error`);
    }
    console.error("[auth][oauth][github][callback]", error);
    return redirectTo(req, `/auth?mode=${normalizeMode(req.cookies.get("cb_oauth_mode")?.value)}&error=oauth_failed`);
  }
}
