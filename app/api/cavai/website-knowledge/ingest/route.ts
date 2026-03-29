import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireSession } from "@/lib/apiAuth";
import { ingestWebsiteKnowledgeFromLatestScan } from "@/lib/cavai/websiteKnowledge.server";
import { readSanitizedJson } from "@/lib/security/userInput";

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

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const body = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;
    const projectId = toProjectId(body?.projectId);
    if (!projectId) {
      return json({
        ok: false,
        requestId,
        error: "INVALID_PROJECT",
        message: "projectId is required.",
      }, 400);
    }

    const result = await ingestWebsiteKnowledgeFromLatestScan({
      accountId: String(session.accountId || ""),
      userId: String(session.sub || ""),
      requestId,
      workspaceId: s(body?.workspaceId) || null,
      projectId,
      siteId: s(body?.siteId) || null,
      origin: s(body?.origin) || null,
    });

    return json({
      ok: true,
      requestId,
      graphId: result.id,
      graph: result.graph,
    }, 201);
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to ingest website knowledge graph.";
    return json(
      {
        ok: false,
        requestId,
        error: "WEBSITE_KNOWLEDGE_INGEST_FAILED",
        ...(process.env.NODE_ENV !== "production" ? { message } : {}),
      },
      500
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "POST, OPTIONS" },
  });
}
