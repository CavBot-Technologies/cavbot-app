import "server-only";

import { ApiAuthError } from "@/lib/apiAuth";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { AiServiceError } from "@/src/lib/ai/ai.types";
import { buildGuardDecisionPayload } from "@/src/lib/cavguard/cavGuard.server";

const PASSIVE_AI_AUTH_REQUIRED_CODES = new Set([
  "AUTH_REQUIRED",
  "UNAUTHORIZED",
  "SESSION_REVOKED",
  "EXPIRED",
]);

const PASSIVE_AI_UNAVAILABLE_CODES = new Set([
  "SERVICE_UNAVAILABLE",
  "AI_SESSIONS_UNAVAILABLE",
  "AI_SESSION_MESSAGES_UNAVAILABLE",
  "SESSION_HISTORY_UNAVAILABLE",
]);

const PASSIVE_AI_SOFT_FAIL_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2037"]);
const PASSIVE_AI_SOFT_FAIL_DB_CODES = new Set(["08000", "08001", "08003", "08004", "08006", "08007", "53300", "57P01", "57P02", "57P03"]);

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

function statusFromUnknown(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number" && Number.isFinite(status)) return Math.trunc(status);
  return 500;
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
  if (!error || depth > 3) return [];
  if (typeof error === "string") return [error.toLowerCase()];
  if (typeof error !== "object") return [];

  const typed = error as {
    message?: unknown;
    meta?: { message?: unknown };
    cause?: unknown;
  };

  return [
    String(typed?.meta?.message || "").toLowerCase(),
    String(typed?.message || "").toLowerCase(),
    ...collectErrorMessages(typed?.cause, depth + 1),
  ].filter(Boolean);
}

export function isPassiveAiSessionSchemaMismatch(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["CavAiSession", "CavAiMessage", "CavAiMessageFeedback", "Account", "Membership", "Project"],
    columns: [
      "accountId",
      "userId",
      "sessionId",
      "messageId",
      "surface",
      "title",
      "contextLabel",
      "contextJson",
      "workspaceId",
      "projectId",
      "origin",
      "contentText",
      "contentJson",
      "provider",
      "model",
      "requestId",
      "status",
      "errorCode",
      "feedbackJson",
      "createdAt",
      "updatedAt",
      "lastMessageAt",
      "trialSeatActive",
      "trialEndsAt",
      "tier",
      "deletedAt",
    ],
    fields: [
      "accountId",
      "userId",
      "sessionId",
      "messageId",
      "surface",
      "title",
      "contextLabel",
      "contextJson",
      "workspaceId",
      "projectId",
      "origin",
      "contentText",
      "contentJson",
      "provider",
      "model",
      "requestId",
      "status",
      "errorCode",
      "createdAt",
      "updatedAt",
      "lastMessageAt",
      "trialSeatActive",
      "trialEndsAt",
      "tier",
      "deletedAt",
    ],
  });
}

export function isPassiveAiServiceUnavailableError(error: unknown) {
  const status = statusFromUnknown(error);
  if (status === 502 || status === 503 || status === 504) return true;

  const prismaCode = s((error as { code?: unknown })?.code).toUpperCase();
  const dbCode = s((error as { meta?: { code?: unknown } })?.meta?.code).toUpperCase();
  if (PASSIVE_AI_SOFT_FAIL_PRISMA_CODES.has(prismaCode)) return true;
  if (PASSIVE_AI_SOFT_FAIL_DB_CODES.has(dbCode)) return true;

  const messages = collectErrorMessages(error);
  return messages.some((message) =>
    message.includes("service unavailable")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("deadline exceeded")
    || message.includes("timed out waiting")
    || message.includes("connection terminated")
    || message.includes("connection reset")
    || message.includes("connection refused")
    || message.includes("too many clients")
    || message.includes("remaining connection slots")
    || message.includes("can not reach database server")
    || message.includes("can't reach database server")
    || message.includes("server closed the connection unexpectedly")
    || message.includes("admin shutdown")
    || message.includes("query engine exited")
  );
}

export function isPassiveAiReadUnavailableError(error: unknown) {
  return isPassiveAiSessionSchemaMismatch(error) || isPassiveAiServiceUnavailableError(error);
}

export function buildPassiveAiUnavailablePayload(
  errorCode = "SERVICE_UNAVAILABLE",
  message = "Temporarily unavailable",
) {
  const normalized = s(errorCode).toUpperCase() || "SERVICE_UNAVAILABLE";
  return {
    ok: false,
    unavailable: true,
    degraded: true,
    retryable: true,
    error: PASSIVE_AI_UNAVAILABLE_CODES.has(normalized) ? normalized : "SERVICE_UNAVAILABLE",
    message: s(message) || "Temporarily unavailable",
  } as const;
}
