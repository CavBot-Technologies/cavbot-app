import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { normalizeUsernameLookupQuery } from "@/lib/workspaceIdentity";
import { resolveUsersForWorkspaceQuery } from "@/lib/workspaceTeam.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireUser(session);

    const q = s(new URL(req.url).searchParams.get("q"));
    const normalized = normalizeUsernameLookupQuery(q);
    if (!normalized) return json({ ok: true, users: [] }, 200);

    const rate = consumeInMemoryRateLimit({
      key: `users-resolve:${session.sub}`,
      limit: 60,
      windowMs: 60_000,
    });

    if (!rate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many lookups. Please try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rate.retryAfterSec),
          },
        }
      );
    }

    const users = await resolveUsersForWorkspaceQuery({
      query: normalized,
      limit: 10,
    });

    return json({ ok: true, users }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}

export async function POST() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { Allow: "GET, OPTIONS" } });
}
