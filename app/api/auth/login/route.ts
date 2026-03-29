// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertWriteOrigin,
  createUserSession,
  isApiAuthError,
  sessionCookieOptions,
  verifyPassword,
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

import { createHash, randomInt } from "crypto";
import { sendEmail } from "@/lib/email/sendEmail"; // <-- must exist (you already use email for password reset)
import { normalizeUsername } from "@/lib/username";
import { readSanitizedJson, readSanitizedFormData } from "@/lib/security/userInput";


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


function normalizeEmail(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}


function safeString(x: unknown) {
  return typeof x === "string" ? x : String(x ?? "");
}

type LoginBody = {
  email?: unknown;
  username?: unknown;
  identifier?: unknown;
  password?: unknown;
  verificationGrantToken?: unknown;
  verificationSessionId?: unknown;
};

async function parseJsonPayload(req: Request): Promise<LoginBody> {
  const raw = await readSanitizedJson(req, null);
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown>;
  return {
    email: data.email,
    username: data.username,
    identifier: data.identifier,
    password: data.password,
    verificationGrantToken: data.verificationGrantToken,
    verificationSessionId: data.verificationSessionId ?? data.verifySessionId,
  };
}

async function readBody(req: Request): Promise<LoginBody> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return parseJsonPayload(req);
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await readSanitizedFormData(req, null);
    if (!fd) return {};
    return {
      email: fd.get("email"),
      username: fd.get("username"),
      identifier: fd.get("identifier"),
      password: fd.get("password"),
      verificationGrantToken: fd.get("verificationGrantToken"),
      verificationSessionId: fd.get("verificationSessionId") ?? fd.get("verifySessionId"),
    };
  }
  return parseJsonPayload(req);
}


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


const DEFAULT_PBKDF2_ITERS = Number(process.env.CAVBOT_PBKDF2_ITERS || 310_000);


function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}


function pickClientIp(req: Request) {
  const cfConn = safeStr(req.headers.get("cf-connecting-ip")).trim();
  if (cfConn) return cfConn;


  const tcip = safeStr(req.headers.get("true-client-ip")).trim();
  if (tcip) return tcip;


  const xff = safeStr(req.headers.get("x-forwarded-for")).trim();
  if (xff) return xff.split(",")[0].trim();


  const xr = safeStr(req.headers.get("x-real-ip")).trim();
  if (xr) return xr;


  return "";
}


function readCloudflareGeo(req: Request) {
  const country = safeStr(req.headers.get("cf-ipcountry")).trim();
  const region = safeStr(req.headers.get("cf-region")).trim() || safeStr(req.headers.get("cf-region-code")).trim();


  const cleanCountry = country && country !== "XX" ? country : "";
  const parts = [region, cleanCountry].map((s) => String(s || "").trim()).filter(Boolean);
  const label = parts.join(", ");


  return {
    country: cleanCountry || null,
    region: region || null,
    label: label || (cleanCountry ? cleanCountry : null),
  };
}


function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}


function newChallengeId() {
  // Opaque ID returned to client; stored only as hash in DB
  return `cb_ch_${createHash("sha256").update(String(Date.now()) + ":" + Math.random()).digest("hex").slice(0, 32)}`;
}


function newEmailCode() {
  // 6-digit code
  return String(randomInt(0, 1000000)).padStart(6, "0");
}


/**
 * We store email 2FA codes in AuthToken, without adding new enums:
 * - type: "EMAIL_RECOVERY" (existing)
 * - tokenHash: sha256(challengeId)
 * - metaJson: { purpose:"2fa_email", codeHash, userId, accountId, uaHash, ipHash, ... }
 */
async function createEmail2faChallenge(args: {
  userId: string;
  accountId: string;
  email: string;
  ua: string;
  ip: string;
  geoLabel: string | null;
}) {
  const challengeId = newChallengeId();
  const code = newEmailCode();


  const uaHash = sha256Hex(String(args.ua || "").trim().toLowerCase());
  const ipHash = sha256Hex(String(args.ip || "").trim());
  const codeHash = sha256Hex(code);


  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min


  await prisma.authToken.create({
    data: {
      userId: args.userId,
      type: "EMAIL_RECOVERY", // reuse existing enum to avoid schema churn
      tokenHash: sha256Hex(challengeId),
      expiresAt,
      metaJson: {
        purpose: "2fa_email",
        codeHash,
        accountId: args.accountId,
        uaHash,
        ipHash,
        geoLabel: args.geoLabel || null,
      },
    },
  });


  // email the code
  await sendEmail({
    to: args.email,
    subject: "Your CavBot security code",
    html: `
      <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
        <h2 style="margin:0 0 10px;">Security verification</h2>
        <p style="margin:0 0 14px;">
          Enter the code below to complete your sign-in.
        </p>


        <div style="margin:16px 0; padding:14px 16px; border-radius:14px; background:#0b1020; border:1px solid rgba(255,255,255,0.14); display:inline-block;">
          <div style="font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:rgba(234,240,255,0.62); margin-bottom:8px;">
            CavBot code
          </div>
          <div style="font-size:26px; font-weight:900; letter-spacing:.16em; color:#eaf0ff;">
            ${code}
          </div>
        </div>


        <p style="margin:14px 0 0; font-size:12px; color:rgba(234,240,255,0.65);">
          This code expires in 10 minutes.
        </p>
      </div>
    `,
  });


  return { challengeId, expiresAt };
}


export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);


    const body = await readBody(req);
    const verificationGate = ensureActionVerification(req, {
      actionType: "login",
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
      recordVerifyActionFailure(req, { actionType: "login", sessionIdHint: verifySessionHint });
      return json(payload, status);
    };

    const rawIdentifier = safeString(body?.email ?? body?.username ?? body?.identifier);
    const normalizedIdentifier = rawIdentifier.trim();
    const treatAsEmail =
      normalizedIdentifier.includes("@") && !normalizedIdentifier.startsWith("@");
    const email = treatAsEmail ? normalizeEmail(normalizedIdentifier) : "";
    const username = treatAsEmail ? "" : normalizeUsername(normalizedIdentifier);
    const password = safeString(body?.password);


    if ((!email && !username) || !password) return reject({ ok: false, error: "missing_credentials" }, 400);


    const user = email
      ? await prisma.user.findUnique({
        where: { email },
        include: { auth: true, memberships: true },
      })
      : await prisma.user.findUnique({
        where: { username },
        include: { auth: true, memberships: true },
      });


    if (!user || !user.auth) return reject({ ok: false, error: "invalid_credentials" }, 401);

    const activeCandidate =
      user.memberships?.length
        ? [...user.memberships].sort((a, b) => {
            const rr = roleRank(normalizeRole(b.role)) - roleRank(normalizeRole(a.role));
            if (rr !== 0) return rr;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          })[0]
        : null;
    const geo = readCloudflareGeo(req);


    const salt = String(user.auth.passwordSalt || "");
    const hash = String(user.auth.passwordHash || "");
    if (!salt || !hash) return json({ ok: false, error: "auth_record_invalid" }, 500);


    const itersRaw = user.auth.passwordIters;
    const itersCandidate = Number(itersRaw);
    const iters =
      Number.isFinite(itersCandidate) && itersCandidate > 0 ? itersCandidate : DEFAULT_PBKDF2_ITERS;


    const ok = await verifyPassword(password, salt, iters, hash);
    if (!ok) {
      if (activeCandidate?.accountId) {
        await auditLogWrite({
          request: req,
          action: "AUTH_LOGIN_FAILED",
          accountId: activeCandidate.accountId,
          operatorUserId: user.id,
          targetType: "auth",
          targetId: user.id,
          metaJson: {
            security_event: "login_password_failed",
            reason: "invalid_credentials",
            location: geo.label,
            geoRegion: geo.region,
            geoCountry: geo.country,
          },
        });
      }
      return reject({ ok: false, error: "invalid_credentials" }, 401);
    }


    if (!user.memberships?.length) return reject({ ok: false, error: "no_account_membership" }, 403);


    const active = activeCandidate ?? user.memberships[0];


    await auditLogWrite({
      request: req,
      action: "AUTH_SIGNED_IN",
      accountId: active.accountId,
      operatorUserId: user.id,
      targetType: "auth",
      targetId: user.id,
      targetLabel: user.email || user.username || user.id,
      metaJson: {
        security_event: "login_password_ok",
        method: "password",
        location: geo.label,
        geoRegion: geo.region,
        geoCountry: geo.country,
      },
    });


    // If 2FA enabled -> Stage A returns challengeRequired (no session cookie)
    const email2fa = Boolean(user.auth.twoFactorEmailEnabled);
    const app2fa = Boolean(user.auth.twoFactorAppEnabled);


  if (email2fa || app2fa) {
    // EMAIL 2FA (ships now)
    if (email2fa) {
      const ua = String(req.headers.get("user-agent") || "");
      const ip = pickClientIp(req);
      const geo = readCloudflareGeo(req);


      const ch = await createEmail2faChallenge({
        userId: user.id,
        accountId: active.accountId,
        email: user.email,
        ua,
        ip,
        geoLabel: geo.label,
      });


      recordVerifyActionSuccess(req, { actionType: "login", sessionIdHint: verifySessionHint });
      return json(
        {
          ok: true,
          challengeRequired: true,
          method: "email",
          challengeId: ch.challengeId,
          expiresAt: ch.expiresAt.toISOString(),
          redirectTo: `/auth/challenge?challengeId=${encodeURIComponent(ch.challengeId)}&method=email`,
        },
        200
      );
    }


    // AUTHENTICATOR APP 2FA (ships now — no resend)
    // We still route through the same challenge page, but verification must validate TOTP.
    const challengeId = newChallengeId();


    await prisma.authToken.create({
      data: {
        userId: user.id,
        type: "EMAIL_RECOVERY", // reuse enum for now
        tokenHash: sha256Hex(challengeId),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        metaJson: {
          purpose: "2fa_app",
          accountId: active.accountId,
        },
      },
    });


    recordVerifyActionSuccess(req, { actionType: "login", sessionIdHint: verifySessionHint });
    return json(
      {
        ok: true,
        challengeRequired: true,
        method: "app",
        challengeId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        redirectTo: `/auth/challenge?challengeId=${encodeURIComponent(challengeId)}&method=app`,
      },
      200
    );
  }

    // No 2FA -> mint session immediately (legacy behavior)
    const memberRole = normalizeRole(active.role);
    const token = await createUserSession({
      userId: user.id,
      accountId: active.accountId,
      memberRole,
    });


    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});


    const res = json({ ok: true, accountId: active.accountId, memberRole }, 200);


    const { name, ...cookieOptsFromLib } = sessionCookieOptions(req);
    const cookieOpts = {
      ...cookieOptsFromLib,
      secure: process.env.NODE_ENV === "production" ? cookieOptsFromLib.secure : false,
    };
    res.cookies.set(name, token, cookieOpts);


    const firstProject = await prisma.project.findFirst({
      where: { accountId: active.accountId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });


    if (firstProject?.id) {
      const pointerCookieOpts = {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      };


      res.cookies.set("cb_active_project_id", String(firstProject.id), pointerCookieOpts);
      res.cookies.set("cb_pid", String(firstProject.id), pointerCookieOpts);
    }


    recordVerifyActionSuccess(req, { actionType: "login", sessionIdHint: verifySessionHint });
    return res;
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "login_failed" }, 500);
  }
}
