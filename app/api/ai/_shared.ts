import "server-only";

import { NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { AiProviderError } from "@/src/lib/ai/providers";
import { AiServiceError } from "@/src/lib/ai/ai.types";

export const AI_NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

export function aiJson(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...AI_NO_STORE_HEADERS },
  });
}

export function aiErrorResponse(error: unknown, requestId: string) {
  if (isApiAuthError(error)) {
    return aiJson({ ok: false, requestId, error: error.code }, error.status);
  }
  if (error instanceof AiProviderError || error instanceof AiServiceError) {
    const details = error.details;
    const guardDecision =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as { guardDecision?: unknown }).guardDecision
        : null;
    return aiJson(
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
  return aiJson(
    {
      ok: false,
      requestId,
      error: "SERVER_ERROR",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    },
    500
  );
}
