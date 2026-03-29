import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { readAuditLogUserId } from "@/lib/auditModelCompat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

const AUDIT_FILTERS = ["KEY_CREATED", "KEY_ROTATED", "KEY_REVOKED", "ALLOWLIST_UPDATED"] as const satisfies readonly AuditAction[];

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerSession(req);

    const logs = await prisma.auditLog.findMany({
      where: {
        accountId: session.accountId,
        action: { in: [...AUDIT_FILTERS] },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    const entries = logs.map((log) => ({
      id: log.id,
      operatorUserId: readAuditLogUserId(log),
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      meta: log.metaJson,
      createdAt: log.createdAt.toISOString(),
    }));

    return json({ ok: true, entries }, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "AUDIT_FETCH_FAILED" }, 500);
  }
}
