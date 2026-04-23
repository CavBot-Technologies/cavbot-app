import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { buildFixPlanFromInsightPack } from "@/packages/cavai-core/src";
import { getInsightPackForRun, persistDeterministicFixPlan } from "@/lib/cavai/intelligence.server";
import { auditLogWrite } from "@/lib/audit";
import { isApiAuthError, requireUser } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

type FixRequestBody = {
  runId?: unknown;
  priorityCode?: unknown;
};

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    if (isStatusProbe) {
      return json({
        ok: true,
        requestId,
        probe: "cavai_fixes",
        accepted: true,
      });
    }

    const session = await requireWorkspaceResilientSession(req);
    requireUser(session);

    const body = (await readSanitizedJson(req, null)) as FixRequestBody | null;
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const priorityCode =
      typeof body?.priorityCode === "string" ? body.priorityCode.trim().toLowerCase() : "";

    if (!runId || !priorityCode) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "runId and priorityCode are required.",
        },
        400
      );
    }

    const pack = await getInsightPackForRun({
      accountId: session.accountId,
      runId,
    });
    if (!pack) {
      return json({ ok: false, requestId, error: "NOT_FOUND" }, 404);
    }

    const fixPlan = buildFixPlanFromInsightPack(pack, priorityCode);
    if (!fixPlan) {
      return json(
        {
          ok: false,
          requestId,
          error: "PRIORITY_NOT_FOUND",
        },
        404
      );
    }

    await persistDeterministicFixPlan({
      accountId: session.accountId,
      userId: session.sub,
      requestId,
      runId,
      priorityCode,
      fixPlan,
      origin: pack.origin,
    });

    try {
      await auditLogWrite({
        accountId: session.accountId,
        operatorUserId: session.sub,
        action: "SYSTEM_JOB_RAN",
        actionLabel: "CavAi deterministic fix plan generated",
        category: "system",
        severity: "info",
        targetType: "cavai_fix_plan",
        targetId: runId,
        targetLabel: priorityCode,
        request: req,
        metaJson: {
          runId,
          priorityCode,
          requestId,
          origin: pack.origin,
        },
      });
    } catch {
      // Never fail fix-plan delivery on audit log write failures.
    }

    return json(
      {
        ok: true,
        requestId,
        fixPlan,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
