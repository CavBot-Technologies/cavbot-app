import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import { findAccountWorkspaceProject } from "@/lib/workspaceProjects.server";
import { getWorkspaceProjectScanStatus, getWorkspaceScanUsage } from "@/lib/workspaceScans.server";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const base = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...base,
    headers: { ...(base.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseProjectId(raw: string | undefined) {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Next 15+ params can be Promise-like; normalize to avoid undefined project ids.
async function getParams(ctx: unknown): Promise<{ projectId?: string }> {
  if (typeof ctx === "object" && ctx !== null) {
    const params = (ctx as { params?: { projectId?: string } }).params;
    return Promise.resolve(params ?? {});
  }
  return Promise.resolve({});
}

export async function GET(req: NextRequest, ctx: unknown) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    const accountId = String(session.accountId || "").trim();
    if (!accountId) return json({ error: "UNAUTHORIZED" }, 401);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params.projectId);
    if (!projectId) return json({ error: "BAD_PROJECT" }, 400);

    const project = await findAccountWorkspaceProject({
      accountId,
      projectId,
      select: { id: true },
    });
    if (!project) {
      const usage = await getWorkspaceScanUsage(accountId);
      return json({ ok: true, status: { usage, lastJob: null } }, 200);
    }

    const status = await getWorkspaceProjectScanStatus(projectId, accountId);
    return json({ ok: true, status }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch scan status.";
    return json({ error: "SERVER_ERROR", message }, 500);
  }
}
