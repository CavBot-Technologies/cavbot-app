// app/api/settings/security/delete-account/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, verifyPassword } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import {
  countAccountOwners,
  deleteUserAccount,
  readSecurityUserAuth,
} from "@/lib/settings/securityRuntime.server";
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

export async function POST(req: NextRequest) {
  try {
    const sess = await requireSettingsOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as unknown;
    const password = String((body as Record<string, unknown>)?.password || "");
    if (!password) return json({ error: "BAD_INPUT", message: "Password is required." }, 400);

    const userId = sess.sub;
    const accountId = sess.accountId;

    const geo = readCoarseRequestGeo(req);

    const auth = await readSecurityUserAuth(userId);
    if (!auth) return json({ error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    const salt = String(auth.passwordSalt || "");
    const hash = String(auth.passwordHash || "");
    const iters = Number(auth.passwordIters || 210000);

    const ok = await verifyPassword(password, salt, iters, hash);
    if (!ok) return json({ error: "INVALID_PASSWORD", message: "Password is incorrect." }, 403);

    // Block removing last OWNER (industry standard)
    if (sess.memberRole === "OWNER") {
      const owners = await countAccountOwners(accountId);
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

    const deleted = await deleteUserAccount(userId);
    if (!deleted) return json({ error: "AUTH_NOT_FOUND", message: "Auth record not found." }, 404);

    if (accountId) {
      await auditLogWrite({
        request: req,
        action: "ACCOUNT_DELETED",
        accountId,
        operatorUserId: null,
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
