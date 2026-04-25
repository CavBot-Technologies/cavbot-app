// app/api/metrics/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { getLatestPackWithHistory, normalizeOriginStrict } from "@/lib/cavai/packs.server";
import { requestInitialSiteScanBestEffort } from "@/lib/scanner";
import { findOwnedWorkspaceSiteByOrigin } from "@/lib/workspaceSites.server";
import { requireWorkspaceResilientSession } from "@/lib/workspaceAuth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METRICS_ROUTE_TIMEOUT_MS = 3_000;

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

function pickClientIp(req: Request) {
  return String(
    req.headers.get("cf-connecting-ip")
    || req.headers.get("true-client-ip")
    || req.headers.get("x-forwarded-for")
    || req.headers.get("x-real-ip")
    || "",
  ).split(",")[0].trim();
}

async function withMetricsDeadline<T>(promise: Promise<T>, timeoutMs = METRICS_ROUTE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("METRICS_ROUTE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const session = await requireWorkspaceResilientSession(req);

    const origin = normalizeOriginStrict(req.nextUrl.searchParams.get("origin"));
    if (!origin) {
      return json(
        {
          ok: false,
          requestId,
          error: "INVALID_ORIGIN",
          message: "origin query param is required.",
        },
        400
      );
    }

    const data = await withMetricsDeadline(
      getLatestPackWithHistory({
        accountId: String(session.accountId || ""),
        origin,
        limit: 6,
      }),
    );

    if (!data.pack) {
      const knownSite = await findOwnedWorkspaceSiteByOrigin(String(session.accountId || ""), origin).catch(() => null);
      const initialScan = knownSite
        ? await requestInitialSiteScanBestEffort({
            projectId: knownSite.projectId,
            siteId: knownSite.siteId,
            accountId: String(session.accountId || ""),
            operatorUserId: session.sub,
            ip: pickClientIp(req),
            userAgent: req.headers.get("user-agent"),
            reason: "Diagnostics warm scan",
          }).catch(() => ({ queued: false, reason: "queue_failed" as const }))
        : null;

      return json(
        {
          ok: false,
          requestId,
          error: "INSUFFICIENT_DATA",
          message: "No persisted CavAi runs exist for this origin yet.",
          history: data.history,
          diagnosticsPending: Boolean(knownSite),
          initialScan,
        },
        200
      );
    }

    const topPriority = data.pack.priorities?.[0] || null;
    return json(
      {
        ok: true,
        requestId,
        origin,
        generatedAt: data.pack.generatedAt,
        engineVersion: data.pack.engineVersion,
        findings: data.pack.core.findings.length,
        priorities: data.pack.priorities.length,
        topPriorityCode: topPriority?.code || null,
        topPriorityScore: Number.isFinite(Number(topPriority?.priorityScore))
          ? Number(topPriority?.priorityScore)
          : null,
        confidenceLevel: data.pack.confidence.level,
        confidenceReason: data.pack.confidence.reason,
        riskLevel: data.pack.risk.level,
        riskReason: data.pack.risk.reason,
        trend: data.pack.overlay?.trend || null,
        fatigue: data.pack.overlay?.fatigue || null,
        history: data.history,
      },
      200
    );
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    return json(
      {
        ok: false,
        requestId,
        error: "SERVER_ERROR",
        history: [],
        degraded: true,
      },
      200
    );
  }
}
