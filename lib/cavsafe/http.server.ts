import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";

import { isApiAuthError } from "@/lib/apiAuth";
import { CavSafeError } from "@/lib/cavsafe/storage.server";
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

export function cavsafeErrorResponse(err: unknown, fallbackMessage: string) {
  if (err instanceof CavSafeError) {
    const guardPayload = buildGuardDecisionPayload({
      status: err.status,
      errorCode: err.code,
    });
    return jsonNoStore({ ok: false, error: err.code, message: err.message, ...(guardPayload || {}) }, err.status);
  }

  if (isApiAuthError(err)) {
    const normalizedCode = String(err.code || "").trim().toUpperCase();
    const explicitActionId = normalizedCode === "PLAN_REQUIRED" || normalizedCode === "PLAN_UPGRADE_REQUIRED"
      ? "CAVSAFE_PLAN_REQUIRED"
      : normalizedCode === "UNAUTHORIZED" && err.status === 403
        ? "CAVSAFE_OWNER_ONLY"
        : normalizedCode === "FORBIDDEN"
          ? "CAVSAFE_ACL_DENIED"
          : null;
    const guardPayload = buildGuardDecisionPayload({
      actionId: explicitActionId,
      status: err.status,
      errorCode: err.code,
    });
    return jsonNoStore({ ok: false, error: err.code, message: err.message || err.code, ...(guardPayload || {}) }, err.status);
  }

  const status = statusFromUnknown(err);
  if (status === 401 || status === 403) {
    const guardPayload = buildGuardDecisionPayload({
      status,
      errorCode: "UNAUTHORIZED",
    });
    return jsonNoStore({ ok: false, error: "UNAUTHORIZED", message: "Unauthorized", ...(guardPayload || {}) }, status);
  }

  return jsonNoStore({ ok: false, error: "INTERNAL", message: fallbackMessage }, 500);
}
