// app/api/settings/security/2fa/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import { readCoarseRequestGeo } from "@/lib/requestGeo";

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

export async function GET(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const userId = sess.sub;

    const auth = await prisma.userAuth.findUnique({
      where: { userId },
      select: { twoFactorEmailEnabled: true, twoFactorAppEnabled: true },
    });

    if (!auth) return json({ error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    return json(
      {
        ok: true,
        twoFactor: {
          email2fa: Boolean(auth.twoFactorEmailEnabled),
          app2fa: Boolean(auth.twoFactorAppEnabled),
        },
      },
      200
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "SECURITY_2FA_LOAD_FAILED", message: "Failed to load 2-step settings." }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as unknown;
    const email2fa = Boolean((body as Record<string, unknown>)?.email2fa);
    const app2fa = Boolean((body as Record<string, unknown>)?.app2fa);

    const userId = sess.sub;
    const accountId = sess.accountId;

    const geo = readCoarseRequestGeo(req);

    await prisma.userAuth.update({
      where: { userId },
      data: {
        twoFactorEmailEnabled: email2fa,
        twoFactorAppEnabled: app2fa,
      },
      select: { twoFactorEmailEnabled: true, twoFactorAppEnabled: true },
    });

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "SECURITY_SETTINGS_UPDATED",
        accountId,
        operatorUserId: userId,
        targetType: "auth",
        targetId: userId,
        targetLabel: userId,
        metaJson: {
          security_event: "2fa_preferences",
          email2fa,
          app2fa,
          location: geo.label,
          geoCountry: geo.country,
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: "SECURITY_2FA_FAILED", message: "Failed to save 2-step settings." }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "GET, PATCH, OPTIONS" } });
}
