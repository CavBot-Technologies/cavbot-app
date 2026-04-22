import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { writeAdminAuditLog } from "@/lib/admin/audit";
import { deleteAdminTrackedCustomAgent } from "@/lib/admin/agentModeration.server";
import { requireAdminAccess } from "@/lib/admin/staff";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type DeleteBody = {
  accountId?: unknown;
  userId?: unknown;
  agentId?: unknown;
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: {
      ...(base.headers || {}),
      ...NO_STORE_HEADERS,
    },
  });
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req, { scopes: ["platform.read"] });
    const body = (await readSanitizedJson(req, {} as DeleteBody)) as DeleteBody;
    const accountId = s(body.accountId);
    const userId = s(body.userId);
    const agentId = s(body.agentId);
    if (!accountId || !userId || !agentId) {
      return json({ ok: false, error: "BAD_INPUT" }, 400);
    }

    const result = await deleteAdminTrackedCustomAgent({
      accountId,
      userId,
      agentId,
    });
    if (!result) {
      return json({ ok: false, error: "AGENT_NOT_FOUND" }, 404);
    }

    await writeAdminAuditLog({
      actorStaffId: ctx.staff.id,
      actorUserId: ctx.userSession.sub,
      action: "AGENT_DELETED",
      actionLabel: "Operator agent deleted",
      entityType: "tracked_agent",
      entityId: result.tracked.trackingId,
      entityLabel: result.tracked.name,
      request: req,
      beforeJson: {
        agentId: result.tracked.agentId,
        actionKey: result.tracked.actionKey,
        publicationRequested: result.tracked.publicationRequested,
      },
      afterJson: {
        deleted: true,
      },
      metaJson: {
        accountId,
        userId,
        sourceAgentId: result.tracked.agentId,
      },
    });

    return json({ ok: true }, 200);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: "AGENT_DELETE_FAILED" }, 500);
  }
}
