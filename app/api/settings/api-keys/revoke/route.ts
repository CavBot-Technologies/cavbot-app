import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  findApiKeyForAccount,
  revokeApiKeyRecord,
} from "@/lib/settings/apiKeysRuntime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type ApiKeyActionBody = { keyId?: string };

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerSession(req);

    const body = (await readSanitizedJson(req, null)) as ApiKeyActionBody | null;
    const keyId = String(body?.keyId || "").trim();
    if (!keyId) return json({ ok: false, error: "KEY_ID_REQUIRED" }, 400);

    const key = await findApiKeyForAccount({
      keyId,
      accountId: session.accountId,
    });

    if (!key) return json({ ok: false, error: "KEY_NOT_FOUND" }, 404);
    if (key.status === "REVOKED") return json({ ok: true }, 200);

    await revokeApiKeyRecord({
      keyId: key.id,
      revokedAt: new Date(),
    });

    if (session.accountId) {
      await auditLogWrite({
        request: req,
        action: "KEY_REVOKED",
        accountId: session.accountId,
        operatorUserId: session.sub,
        targetType: "apiKey",
        targetId: key.id,
        targetLabel: key.name || `•••• ${key.last4}`,
        metaJson: {
          keyType: key.type,
          last4: key.last4,
          scopes: key.scopes,
          siteId: key.siteId,
        },
      });
    }

    return json({ ok: true }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[settings/api-keys/revoke] revoke failed", error);
    return json({ ok: false, error: "REVOKE_FAILED", message }, 500);
  }
}
