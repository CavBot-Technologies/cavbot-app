import { NextResponse } from "next/server";

export const ADMIN_NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

export function adminJson<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: {
      ...(base.headers || {}),
      ...ADMIN_NO_STORE_HEADERS,
    },
  });
}

export function safeId(value: unknown) {
  return String(value || "").trim();
}

export function safeText(value: unknown, max = 10000) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized.slice(0, Math.max(1, max));
}

export function maskOpaqueId(value: unknown) {
  const suffix = safeId(value).slice(-4);
  return suffix ? `•••• ${suffix}` : "••••";
}
