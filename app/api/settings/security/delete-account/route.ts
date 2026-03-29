// app/api/settings/security/delete-account/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isApiAuthError, verifyPassword } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, { ...resInit, headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS } });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/* =========================
   Cloudflare IP + Geo (best-effort)
   ========================= */

function readCloudflareGeo(req: NextRequest) {
  const countryRaw = safeStr(req.headers.get("cf-ipcountry")).trim();
  const country = countryRaw && countryRaw !== "XX" ? countryRaw : "";
  return { country: country || null, region: null as string | null, label: country || null };
}

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as unknown;
    const password = String((body as Record<string, unknown>)?.password || "");
    if (!password) return json({ error: "BAD_INPUT", message: "Password is required." }, 400);

    const userId = sess.sub;
    const accountId = sess.accountId;

    const geo = readCloudflareGeo(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { auth: true },
    });

    if (!user || !user.auth) return json({ error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    const salt = String(user.auth.passwordSalt || "");
    const hash = String(user.auth.passwordHash || "");
    const iters = Number(user.auth.passwordIters || 210000);

    const ok = await verifyPassword(password, salt, iters, hash);
    if (!ok) return json({ error: "INVALID_PASSWORD", message: "Password is incorrect." }, 403);

    // Block removing last OWNER (industry standard)
    if (sess.memberRole === "OWNER") {
      const owners = await prisma.membership.count({ where: { accountId, role: "OWNER" } });
      if (owners <= 1) {
        return json(
          {
            error: "LAST_OWNER",
            message: "You are the last OWNER of this workspace. Transfer ownership before deleting your account.",
          },
          409
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      // Cascades remove UserAuth/AuthTokens/Memberships/etc (per your schema)
      await tx.user.delete({ where: { id: userId } });
    });

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "ACCOUNT_DELETED",
        accountId,
        operatorUserId: userId,
        targetType: "auth",
        targetId: userId,
        targetLabel: userId,
        metaJson: {
          security_event: "account_deleted",
          location: geo.label,
          geoCountry: geo.country,
          geoRegion: geo.region,
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "DELETE_ACCOUNT_FAILED", message: "Failed to delete account." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" } });
}
