import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { parseNormalizedScanInputV1 } from "@/packages/cavai-contracts/src";
import { auditLogWrite } from "@/lib/audit";
import {
  CavAiPackValidationError,
  DEFAULT_CAVAI_ENGINE_VERSION,
  generateInsightPackFromInput,
} from "@/lib/cavai/pipeline.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  isApiAuthError,
} from "@/lib/apiAuth";
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

async function writeDiagnosticsAudit(args: {
  req: NextRequest;
  accountId: string;
  userId: string;
  runId: string;
  origin: string;
  inputHash: string;
  idempotent: boolean;
}) {
  try {
    await auditLogWrite({
      accountId: args.accountId,
      operatorUserId: args.userId,
      action: "SYSTEM_JOB_RAN",
      actionLabel: args.idempotent ? "CavAi diagnostics returned cached pack" : "CavAi diagnostics generated pack",
      category: "system",
      severity: "info",
      targetType: "cavai_diagnostics_run",
      targetId: args.runId,
      targetLabel: args.origin,
      request: args.req,
      metaJson: {
        runId: args.runId,
        origin: args.origin,
        inputHash: args.inputHash,
        idempotent: args.idempotent,
      },
    });
  } catch {
    // Never fail diagnostics on audit-write failures.
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    const rawBody = await readSanitizedJson(req, null);
    if (isStatusProbe) {
      return json({
        ok: true,
        requestId,
        probe: "cavai_diagnostics",
        accepted: true,
      });
    }

    const session = await requireWorkspaceResilientSession(req);

    const parsed = parseNormalizedScanInputV1(rawBody);
    if (!parsed.ok) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: parsed.error,
        },
        400
      );
    }

    const force = new URL(req.url).searchParams.get("force") === "1";
    const result = await generateInsightPackFromInput({
      accountId: session.accountId,
      userId: session.sub,
      requestId,
      input: parsed.value,
      force,
      engineVersion: DEFAULT_CAVAI_ENGINE_VERSION,
      meta: {
        workspaceId: session.accountId,
      },
    });

    await writeDiagnosticsAudit({
      req,
      accountId: session.accountId,
      userId: session.sub,
      runId: result.runId,
      origin: result.input.origin,
      inputHash: result.inputHash,
      idempotent: result.idempotent,
    });

    return json(
      {
        ok: true,
        requestId,
        idempotent: result.idempotent,
        pack: result.pack,
      },
      200
    );
  } catch (error) {
    if (error instanceof CavAiPackValidationError) {
      if (process.env.NODE_ENV !== "production") {
        return json(
          {
            ok: false,
            requestId,
            error: "PACK_VALIDATION_FAILED",
            details: error.details,
          },
          422
        );
      }
      return json(
        {
          ok: false,
          requestId,
          error: "PACK_VALIDATION_FAILED",
        },
        500
      );
    }
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
