// app/api/auth/recovery/email/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeOkResponse } from "@/lib/auth/passwordReset";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppOrigin } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore() {
  return {
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function appUrl() {
  return getAppOrigin().replace(/\/+$/, "");
}

function normalizeDomain(v: string) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+.*$/, "");
}

function hostFromOrigin(origin: string) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function domainMatches(host: string, domain: string) {
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

export async function POST(req: Request) {
  try {
    const body = (await readSanitizedJson(req, {} as Record<string, unknown>)) as Record<string, unknown>;
    const domain = normalizeDomain(String(body?.domain || ""));

    // Always return ok (prevents enumeration)
    if (!domain) {
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // ------------------------------------------------------------
    // STEP 1: Find a matching Site by domain
    // - We use a "contains" prefilter for speed
    // - Then confirm hostname match safely
    // ------------------------------------------------------------
    const candidates = await prisma.site.findMany({
      where: {
        isActive: true,
        origin: { contains: domain },
      },
      select: {
        id: true,
        projectId: true,
        origin: true,
        createdAt: true,
      },
      take: 50,
    });

    const matches = candidates
      .map((s) => ({ ...s, host: hostFromOrigin(s.origin) }))
      .filter((s) => domainMatches(s.host, domain))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // If nothing matched -> still ok (security)
    if (!matches.length) {
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    const projectId = matches[0].projectId;

    // ------------------------------------------------------------
    // STEP 2: Resolve Account for that Project
    // Project -> Account
    // ------------------------------------------------------------
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        slug: true,
        name: true,
        accountId: true,
        isActive: true,
      },
    });

    if (!project?.accountId || !project.isActive) {
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // ------------------------------------------------------------
    // STEP 3: Find the Account OWNER (fallback ADMIN)
    // Account -> Membership(role) -> User(email)
    // ------------------------------------------------------------
    const ownerMembership = await prisma.membership.findFirst({
      where: {
        accountId: project.accountId,
        role: "OWNER",
      },
      select: {
        user: { select: { email: true, displayName: true } },
      },
    });

    const adminMembership = !ownerMembership
      ? await prisma.membership.findFirst({
          where: {
            accountId: project.accountId,
            role: "ADMIN",
          },
          select: {
            user: { select: { email: true, displayName: true } },
          },
        })
      : null;

    const recipient = ownerMembership?.user?.email || adminMembership?.user?.email || "";

    if (!recipient) {
      return NextResponse.json(safeOkResponse(), { headers: noStore() });
    }

    // ------------------------------------------------------------
    // STEP 4: Send official recovery email (no info leak)
    // ------------------------------------------------------------
    const loginLink = `${appUrl()}/auth?mode=login`;
    const resetLink = `${appUrl()}/users/recovery#password`;

    await sendEmail({
      to: recipient,
      subject: "CavBot Account Recovery — Domain Lookup",
      html: `
        <div style="font-family: ui-sans-serif, system-ui; line-height:1.6;">
          <h2 style="margin:0 0 10px;">Account recovery requested</h2>

          <p style="margin:0 0 14px;">
            A recovery request was submitted for the domain <strong>${domain}</strong>.
          </p>

          <p style="margin:0 0 14px;">
            If you manage this workspace, continue to sign in using the account email on file.
          </p>

          <p style="margin:16px 0;">
            <a href="${loginLink}"
              style="display:inline-block; padding:12px 16px; border-radius:12px;
                     background:#b9c85a; color:#0b1020; text-decoration:none; font-weight:700;">
              Continue to login
            </a>
          </p>

          <p style="margin:12px 0;">
            Need a reset link instead?
          </p>

          <p style="margin:0 0 14px;">
            <a href="${resetLink}" style="color:#4ea8ff; text-decoration:none; font-weight:600;">
              Start password reset
            </a>
          </p>

          <p style="margin:14px 0 0; font-size:12px; color:#6b7280;">
            If you didn’t request this, you can safely ignore this message.
          </p>
        </div>
      `,
    });

    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  } catch {
    return NextResponse.json(safeOkResponse(), { headers: noStore() });
  }
}
