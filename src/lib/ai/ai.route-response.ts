import "server-only";

import { ApiAuthError } from "@/lib/apiAuth";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

const PASSIVE_AI_AUTH_REQUIRED_CODES = new Set([
  "AUTH_REQUIRED",
  "UNAUTHORIZED",
  "SESSION_REVOKED",
  "EXPIRED",
]);

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export function readPassiveAiAuthErrorCode(error: unknown): string {
  const code = s((error as { code?: unknown })?.code).toUpperCase();
  return PASSIVE_AI_AUTH_REQUIRED_CODES.has(code) ? code : "UNAUTHORIZED";
}

export function isPassiveAiAuthRequiredError(error: unknown): boolean {
  if (error instanceof ApiAuthError) {
    return PASSIVE_AI_AUTH_REQUIRED_CODES.has(readPassiveAiAuthErrorCode(error));
  }
  if (error instanceof AiServiceError) {
    return PASSIVE_AI_AUTH_REQUIRED_CODES.has(readPassiveAiAuthErrorCode(error));
  }
  const status = Number((error as { status?: unknown })?.status);
  if (Number.isFinite(status) && (status === 401 || status === 403)) {
    return PASSIVE_AI_AUTH_REQUIRED_CODES.has(readPassiveAiAuthErrorCode(error));
  }
  return false;
}

export function buildPassiveAiAuthRequiredPayload(errorCode = "UNAUTHORIZED") {
  const normalized = s(errorCode).toUpperCase() || "UNAUTHORIZED";
  const guardPayload = buildGuardDecisionPayload({
    status: 401,
    errorCode: normalized,
  });
  return {
    ok: false,
    authRequired: true,
    error: normalized,
    message: "Unauthorized",
    ...(guardPayload || {}),
  } as const;
}
