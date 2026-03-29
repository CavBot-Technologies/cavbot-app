import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError, requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getLatestPackWithHistory, normalizeOriginStrict } from "@/lib/cavai/packs.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json(payload: unknown, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseLimit(input: string | null): number {
  const value = Number(input);
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(25, Math.trunc(value)));
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const url = new URL(req.url);
    const origin = normalizeOriginStrict(url.searchParams.get("origin"));
    if (!origin) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_ORIGIN",
          message: "origin is required and must be a valid URL origin.",
        },
        400
      );
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    const result = await getLatestPackWithHistory({
      accountId: String(session.accountId || ""),
      origin,
      limit,
    });

    return json(
      {
        ok: true,
        requestId,
        origin: result.origin,
        pack: result.pack,
        history: result.history,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Server error";
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, OPTIONS" },
  });
}
