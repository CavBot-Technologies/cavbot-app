import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { runSurfaceAssist } from "@/src/lib/ai/ai.service";
import { CAVPAD_ASSIST_REQUEST_SCHEMA } from "@/src/lib/ai/ai.types";
import { AI_NO_STORE_HEADERS, aiErrorResponse, aiJson } from "@/app/api/ai/_shared";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const isStatusProbe = req.headers.get("x-cavbot-status-probe") === "1";

  try {
    if (isStatusProbe) {
      return aiJson({ ok: true, requestId, probe: "ai_cavpad_assist", accepted: true }, 200);
    }

    if (!hasRequestIntegrityHeader(req)) {
      return aiJson(
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
    const parsed = CAVPAD_ASSIST_REQUEST_SCHEMA.safeParse(bodyRaw);
    if (!parsed.success) {
      return aiJson(
        {
          ok: false,
          requestId,
          error: "INVALID_INPUT",
          message: "Invalid CavPad assist payload.",
          details: parsed.error.flatten(),
        },
        400
      );
    }

    const result = await runSurfaceAssist({
      req,
      requestId,
      surface: "cavpad",
      input: parsed.data,
    });

    if (!result.ok) return aiJson(result, result.status || 502);
    return aiJson(result, 200);
  } catch (error) {
    return aiErrorResponse(error, requestId);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...AI_NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
