"use client";

const ADMIN_TELEMETRY_ENABLED = process.env.NEXT_PUBLIC_ADMIN_TELEMETRY_ENABLED === "1";

export function emitAdminTelemetry(args: {
  event: string;
  route?: string | null;
  sessionKey?: string | null;
  result?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  if (typeof window === "undefined") return;
  const event = String(args.event || "").trim();
  if (!event) return;
  if (!ADMIN_TELEMETRY_ENABLED) return;

  const payload = JSON.stringify({
    event,
    route: String(args.route || "").trim() || window.location.pathname,
    sessionKey: String(args.sessionKey || "").trim() || undefined,
    result: String(args.result || "").trim() || undefined,
    meta: args.meta || undefined,
  });

  try {
    void fetch("/api/admin/telemetry", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      keepalive: true,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: payload,
    });
  } catch {}
}
