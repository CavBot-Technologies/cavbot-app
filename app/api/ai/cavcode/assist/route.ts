import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { runCavCodeAssist } from "@/src/lib/ai/ai.service";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  CAVCODE_ASSIST_REQUEST_SCHEMA,
  AiServiceError,
} from "@/src/lib/ai/ai.types";

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

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    if (isStatusProbe) {
      return json({
        ok: true,
        requestId,
        probe: "ai_cavcode_assist",
        accepted: true,
      });
    }

    if (!hasRequestIntegrityHeader(req)) {
      return json(
        {
          ok: false,
          requestId,
          error: "BAD_CSRF",
          message: "Missing request integrity header.",
        },
        403
      );
    }

    const bodyRaw = await readSanitizedJson(req, null);
    const parsed = CAVCODE_ASSIST_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid CavCode assist payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const result = await runCavCodeAssist({
      req,
      requestId,
      input: parsed.data,
    });

    if (!result.ok) {
      return json(result, result.status || 502);
    }

    return json(result, 200);
  } catch (error) {
    if (isApiAuthError(error)) {
      return json(
        {
          ok: false,
          requestId,
          error: error.code,
        },
        error.status
      );
    }
    if (error instanceof AiServiceError) {
      const details = error.details;
      const guardDecision =
        details && typeof details === "object" && !Array.isArray(details)
          ? (details as { guardDecision?: unknown }).guardDecision
          : null;
      return json(
        {
          ok: false,
          requestId,
          error: error.code,
          message: error.message,
          ...(guardDecision && typeof guardDecision === "object" ? { guardDecision } : {}),
          ...(process.env.NODE_ENV !== "production" ? { details: error.details } : {}),
        },
        error.status
      );
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
