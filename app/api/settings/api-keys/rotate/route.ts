import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { readWorkspace } from "@/lib/workspaceStore.server";
import { buildApiKeyInsertData, serializeApiKey } from "@/lib/apiKeys.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";

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

    const workspace = await readWorkspace({ accountId: session.accountId });
    const projectId = workspace.projectId;

    const body = (await readSanitizedJson(req, null)) as ApiKeyActionBody | null;
    const keyId = String(body?.keyId || "").trim();
    if (!keyId) return json({ ok: false, error: "KEY_ID_REQUIRED" }, 400);

    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, projectId },
    });

    if (!existing) return json({ ok: false, error: "KEY_NOT_FOUND" }, 404);
    if (existing.status !== "ACTIVE") return json({ ok: false, error: "KEY_NOT_ACTIVE" }, 412);

    const insert = buildApiKeyInsertData({
      type: existing.type,
      accountId: existing.accountId ?? session.accountId!,
      projectId,
      siteId: existing.siteId,
      name: existing.name || null,
      scopes: existing.scopes,
      rotatedFromId: existing.id,
    });

    const now = new Date();

    const nextKey = await prisma.$transaction(async (tx) => {
      await tx.apiKey.update({
        where: { id: existing.id },
        data: { status: "ROTATED", rotatedAt: now, value: null },
      });
      return tx.apiKey.create({ data: insert.data });
    });

    if (session.accountId) {
      await auditLogWrite({
        request: req,
        action: "KEY_ROTATED",
        accountId: session.accountId,
        operatorUserId: session.sub,
        targetType: "apiKey",
        targetId: nextKey.id,
        targetLabel: nextKey.name || `•••• ${nextKey.last4}`,
        metaJson: {
          keyType: existing.type,
          oldLast4: existing.last4,
          newLast4: nextKey.last4,
          scopes: nextKey.scopes,
          siteId: nextKey.siteId,
          rotatedFrom: existing.id,
        },
      });
    }

    return json(
      {
        ok: true,
        key: serializeApiKey(nextKey, { includeValue: existing.type === "PUBLISHABLE" }),
        plaintextKey: insert.plaintextKey,
      },
      200
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: "ROTATE_FAILED", message }, 500);
  }
}
