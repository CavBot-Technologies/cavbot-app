import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";

import { ApiAuthError } from "@/lib/apiAuth";
import { CavCloudError } from "@/lib/cavcloud/storage.server";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

export function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function statusFromUnknown(err: unknown): number {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && Number.isFinite(status) && status >= 100 && status <= 599) return status;
  return 500;
}

export function cavcloudErrorResponse(err: unknown, fallbackMessage: string) {
  if (err instanceof ApiAuthError) {
    const guardPayload = buildGuardDecisionPayload({
      status: err.status,
      errorCode: err.code,
    });
    return jsonNoStore({ ok: false, error: err.code, message: err.code, ...(guardPayload || {}) }, err.status);
  }

  if (err instanceof CavCloudError) {
    const guardPayload = buildGuardDecisionPayload({
      status: err.status,
      errorCode: err.code,
    });
    return jsonNoStore({ ok: false, error: err.code, message: err.message, ...(guardPayload || {}) }, err.status);
  }

  const status = statusFromUnknown(err);
  if (status === 401 || status === 403) {
    const guardPayload = buildGuardDecisionPayload({
      status,
      errorCode: "UNAUTHORIZED",
    });
    return jsonNoStore({ ok: false, error: "UNAUTHORIZED", message: "Unauthorized", ...(guardPayload || {}) }, status);
  }
  if (status === 404) {
    return jsonNoStore({ ok: false, error: "NOT_FOUND", message: "Not found." }, 404);
  }
  if (status === 409) {
    return jsonNoStore({ ok: false, error: "CONFLICT", message: "Conflict." }, 409);
  }
  if (status === 429) {
    return jsonNoStore({ ok: false, error: "RATE_LIMITED", message: "Rate limited." }, 429);
  }

  return jsonNoStore({ ok: false, error: "INTERNAL", message: fallbackMessage }, 500);
}
