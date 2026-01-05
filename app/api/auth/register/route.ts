// app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assertWriteOrigin,
  createUserSession,
  hashPassword,
  sessionCookieHeader,
} from "@/lib/apiAuth";

export const dynamic = "force-dynamic";

function env(name: string) {
  return String((process.env as any)?.[name] || "").trim();
}

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function toSlug(input: string) {
  const s = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "account";
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(buf));
}

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToHex(b);
}
export const runtime = "edge";
export async function POST(req: Request) {
  try {
    assertWriteOrigin(req);

    // Optional safety gate for early launch:
    // - If CAVBOT_PUBLIC_SIGNUP !== "1", registration is blocked (until you enable it).
    // - Set CAVBOT_PUBLIC_SIGNUP=1 when you’re ready to open to the public.
    if (env("CAVBOT_PUBLIC_SIGNUP") !== "1") {
      return NextResponse.json(
        { ok: false, error: "signup_disabled" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await req.json().catch(() => ({}));

    const email = normalizeEmail(body.email);
    const password = String(body.password || "").trim();
    const displayName = body.displayName != null ? String(body.displayName).trim() : null;

    const accountNameRaw =
      body.accountName != null && String(body.accountName).trim()
        ? String(body.accountName).trim()
        : "CavBot Account";

    const requestedSlug =
      body.accountSlug != null && String(body.accountSlug).trim()
        ? toSlug(String(body.accountSlug))
        : toSlug(accountNameRaw);

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        { ok: false, error: "weak_password", message: "Use 10+ characters." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { ok: false, error: "email_in_use" },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    // Ensure unique account slug (auto-suffix if needed)
    let accountSlug = requestedSlug;
    const slugExists = await prisma.account.findUnique({ where: { slug: accountSlug } });
    if (slugExists) {
      accountSlug = `${requestedSlug}-${randomToken(3)}`; // short suffix
    }

    const pass = await hashPassword(password);

    // Default project provisioning:
    // - create a server key (raw) and store only hash + last4 in DB
    const serverKeyRaw = `cavbot_sk_${randomToken(24)}`;
    const serverKeyHash = await sha256Hex(serverKeyRaw);
    const serverKeyLast4 = serverKeyRaw.slice(-4);

    const now = new Date();
    const trialDays = 14;
    const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          displayName: displayName || undefined,
          lastLoginAt: now,
        },
      });

      await tx.userAuth.create({
        data: {
          userId: user.id,
          passwordAlgo: pass.algo,
          passwordIters: pass.iters,
          passwordSalt: pass.salt,
          passwordHash: pass.hash,
        },
      });

      const account = await tx.account.create({
        data: {
          name: accountNameRaw,
          slug: accountSlug,
          tier: "SOLO",
        },
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
          tier: "SOLO",
          currentPeriodStart: now,
          currentPeriodEnd: trialEnd,
        },
      });

      // Create a default project (slug is unique per account)
      const project = await tx.project.create({
        data: {
          accountId: account.id,
          name: "Primary Project",
          slug: "primary",
          serverKeyHash,
          serverKeyLast4,
          isActive: true,
        },
      });

      return { user, account, project };
    });

    const token = await createUserSession({
      userId: result.user.id,
      accountId: result.account.id,
      memberRole: "OWNER",
    });

    const res = NextResponse.json(
      {
        ok: true,
        userId: result.user.id,
        accountId: result.account.id,
        accountSlug: result.account.slug,
        defaultProjectId: result.project.id,
        defaultProjectSlug: result.project.slug,
        // NOTE: Do not return serverKeyRaw here for security.
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );

    res.headers.set("Set-Cookie", sessionCookieHeader(token));
    return res;
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg === "BAD_ORIGIN" ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: msg === "BAD_ORIGIN" ? "bad_origin" : "register_failed" },
      { status, headers: { "Cache-Control": "no-store" } }
    );
  }
}