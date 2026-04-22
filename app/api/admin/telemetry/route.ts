import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/apiAuth";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { recordAdminEventSafe } from "@/lib/admin/events";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "cavguard_rendered",
  "cavguard_flagged",
  "cavguard_blocked",
  "cavguard_overridden",
  "cavverify_rendered",
  "cavverify_abandoned",
]);

type Body = {
  event?: unknown;
  route?: unknown;
  sessionKey?: unknown;
  result?: unknown;
  meta?: unknown;
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      ...(base.headers || {}),
    },
  });
}

function pickClientIp(req: Request) {
  return String(
    req.headers.get("cf-connecting-ip")
    || req.headers.get("true-client-ip")
    || req.headers.get("x-forwarded-for")
    || req.headers.get("x-real-ip")
    || "",
  ).split(",")[0].trim();
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const body = (await readSanitizedJson(req, {} as Body)) as Body;
  const event = String(body?.event || "").trim();
  if (!ALLOWED_EVENTS.has(event)) return json({ ok: false, error: "BAD_EVENT" }, 400);

  const ip = pickClientIp(req);
  const limit = consumeInMemoryRateLimit({
    key: `admin:telemetry:${event}:${ip}`,
    limit: 50,
    windowMs: 60_000,
  });
  if (!limit.allowed) return json({ ok: true });

  const session = await getSession(req);
  await recordAdminEventSafe({
    name: event,
    actorUserId: session?.systemRole === "user" ? session.sub : null,
    accountId: session?.systemRole === "user" ? session.accountId || null : null,
    origin: String(body?.route || "").trim() || null,
    sessionKey: String(body?.sessionKey || "").trim() || null,
    result: String(body?.result || "").trim() || null,
    metaJson: asRecord(body?.meta),
  });

  return json({ ok: true });
}
