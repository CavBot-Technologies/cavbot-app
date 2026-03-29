import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getLatestWebsiteKnowledgeGraph, listWebsiteKnowledgeGraphHistory } from "@/lib/cavai/websiteKnowledge.server";

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

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function toProjectId(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.max(1, Math.min(40, Math.trunc(parsed)));
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const url = new URL(req.url);
    const accountId = String(session.accountId || "");
    const projectId = toProjectId(url.searchParams.get("projectId"));
    const workspaceId = s(url.searchParams.get("workspaceId")) || null;
    const siteId = s(url.searchParams.get("siteId")) || null;
    const includeHistory = s(url.searchParams.get("history")) === "1";

    const latest = await getLatestWebsiteKnowledgeGraph({
      accountId,
      projectId,
      workspaceId,
      siteId,
    });
    const history = includeHistory
      ? await listWebsiteKnowledgeGraphHistory({
          accountId,
          projectId,
          workspaceId,
          siteId,
          limit: toLimit(url.searchParams.get("limit")),
        })
      : [];

    return json({
      ok: true,
      requestId,
      latest,
      history,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to fetch website knowledge graph.";
    return json(
      {
        ok: false,
        requestId,
        error: "WEBSITE_KNOWLEDGE_FETCH_FAILED",
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
