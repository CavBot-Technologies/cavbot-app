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

function envPositiveInt(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function statusFromUnknown(err: unknown): number {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && Number.isFinite(status) && status >= 100 && status <= 599) return status;
  return 500;
}

function collectErrorMessages(err: unknown, depth = 0): string[] {
  if (!err || depth > 3) return [];
  if (typeof err === "string") return [err.toLowerCase()];
  if (typeof err !== "object") return [];

  const typed = err as {
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

export function cavcloudRequestTimeoutMs() {
  return envPositiveInt("CAVCLOUD_REQUEST_TIMEOUT_MS", 12_000);
}

export function withCavCloudDeadline<T>(
  promise: Promise<T>,
  opts: {
    timeoutMs?: number;
    message?: string;
  } = {},
) {
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs))
    ? Math.max(250, Math.trunc(Number(opts.timeoutMs)))
    : cavcloudRequestTimeoutMs();
  if (timeoutMs <= 0) return promise;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error(opts.message || "Service temporarily unavailable."), {
          status: 503,
          code: "SERVICE_UNAVAILABLE",
        }),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function isCavCloudServiceUnavailableError(err: unknown) {
  const status = statusFromUnknown(err);
  if (status === 502 || status === 503 || status === 504) return true;

  const code = String((err as { code?: unknown })?.code || "").toUpperCase();
  const dbCode = String((err as { meta?: { code?: unknown } })?.meta?.code || "").toUpperCase();
  if (["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2037"].includes(code)) return true;
  if (["08000", "08001", "08003", "08004", "08006", "08007", "53300", "57P01", "57P02", "57P03"].includes(dbCode)) {
    return true;
  }

  const messages = collectErrorMessages(err);
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
  if (status === 502 || status === 503 || status === 504 || isCavCloudServiceUnavailableError(err)) {
    return jsonNoStore(
      {
        ok: false,
        error: "SERVICE_UNAVAILABLE",
        message: "Service temporarily unavailable.",
      },
      503,
    );
  }

  return jsonNoStore({ ok: false, error: "INTERNAL", message: fallbackMessage }, 500);
}
