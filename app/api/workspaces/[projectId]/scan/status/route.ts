import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { findAccountWorkspaceProject } from "@/lib/workspaceProjects.server";
import { getWorkspaceProjectScanStatus, getWorkspaceScanUsage } from "@/lib/workspaceScans.server";
import { getPlanLimits, PLANS } from "@/lib/plans";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";

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
    const session = await requireWorkspaceResilientSession(req);
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
      const usage = await getWorkspaceScanUsage(accountId).catch(() => {
        const planId = "free";
        const limits = getPlanLimits(planId);
        return {
          planId,
          planLabel: PLANS[planId].tierLabel,
          scansThisMonth: 0,
          scansPerMonth: limits.scansPerMonth,
          pagesPerScan: limits.pagesPerScan,
        };
      });
      return json({ ok: true, status: { usage, lastJob: null } }, 200);
    }

    let status;
    try {
      status = await getWorkspaceProjectScanStatus(projectId, accountId);
    } catch (error) {
      console.error("[workspace-scan-status]", {
        projectId,
        accountId,
        detail: error instanceof Error ? error.message : String(error),
      });
      const planId = "free";
      const limits = getPlanLimits(planId);
      const usage = await getWorkspaceScanUsage(accountId).catch(() => ({
        planId,
        planLabel: PLANS[planId].tierLabel,
        scansThisMonth: 0,
        scansPerMonth: limits.scansPerMonth,
        pagesPerScan: limits.pagesPerScan,
      }));
      return json({ ok: true, degraded: true, status: { usage, lastJob: null } }, 200);
    }

    return json({ ok: true, status }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ error: error.code }, error.status);
    const message = error instanceof Error ? error.message : "Failed to fetch scan status.";
    return json({ error: "SERVER_ERROR", message }, 500);
  }
}
