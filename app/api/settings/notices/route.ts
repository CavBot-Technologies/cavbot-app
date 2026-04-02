import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isApiAuthError,
  requireAccountContext,
  requireSession,
  requireUser,
} from "@/lib/apiAuth";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

export type NoticeRecord = {
  id: string;
  tone: string;
  title: string;
  body: string;
  createdAt: string;
  siteId: string | null;
  meta: Record<string, unknown> | null;
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireUser(session);
    requireAccountContext(session);

    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") || 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 5), 50) : 20;

    const notices = await prisma.workspaceNotice.findMany({
      where: { accountId: session.accountId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const payload = {
      ok: true,
      notices: notices.map((notice) => ({
        id: notice.id,
        tone: notice.tone,
        title: notice.title,
        body: notice.body,
        createdAt: notice.createdAt.toISOString(),
        siteId: notice.siteId,
        meta: notice.meta,
      })),
    };

    return json(payload, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    console.error("Failed to load workspace notices", error);
    return json({ ok: true, notices: [] }, 200);
  }
}
