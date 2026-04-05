import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireSession, requireUser } from "@/lib/apiAuth";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import { isWorkspaceAccessRequestSchemaMismatch, resolveWorkspaceAccessTarget } from "@/lib/workspaceTeam.server";

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

    const rate = consumeInMemoryRateLimit({
      key: `workspace-access-target-resolve:${session.sub}`,
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

    const url = new URL(req.url);
    const targetWorkspaceId = s(url.searchParams.get("targetWorkspaceId"));
    const targetOwnerUsername = s(url.searchParams.get("targetOwnerUsername"));
    const targetOwnerProfileUrl = s(url.searchParams.get("targetOwnerProfileUrl"));

    const workspace = await resolveWorkspaceAccessTarget({
      targetWorkspaceId: targetWorkspaceId || null,
      targetOwnerUsername: targetOwnerUsername || null,
      targetOwnerProfileUrl: targetOwnerProfileUrl || null,
    });

    return json({ ok: true, workspace }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    if (isWorkspaceAccessRequestSchemaMismatch(error)) {
      return json({ ok: true, degraded: true, workspace: null }, 200);
    }
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
