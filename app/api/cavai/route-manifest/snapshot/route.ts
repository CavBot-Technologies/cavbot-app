import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireSession } from "@/lib/apiAuth";
import {
  buildCavAiRouteManifestSnapshot,
  getCavAiRouteManifestSnapshot,
  listCavAiRouteManifestSnapshots,
  persistCavAiRouteManifestSnapshot,
} from "@/lib/cavai/routeManifest.server";
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
    const snapshotId = s(url.searchParams.get("snapshotId"));
    if (snapshotId) {
      const snapshot = await getCavAiRouteManifestSnapshot({
        accountId: String(session.accountId || ""),
        snapshotId,
      });
      if (!snapshot) {
        return json({
          ok: false,
          requestId,
          error: "SNAPSHOT_NOT_FOUND",
          message: "Route manifest snapshot was not found.",
        }, 404);
      }
      return json({
        ok: true,
        requestId,
        snapshot,
      });
    }

    const snapshots = await listCavAiRouteManifestSnapshots({
      accountId: String(session.accountId || ""),
      workspaceId: s(url.searchParams.get("workspaceId")) || null,
      projectId: toProjectId(url.searchParams.get("projectId")),
      limit: toLimit(url.searchParams.get("limit")),
    });

    return json({
      ok: true,
      requestId,
      snapshots,
    });
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to load route manifest snapshots.";
    return json({
      ok: false,
      requestId,
      error: "ROUTE_MANIFEST_LIST_FAILED",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    }, 500);
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const body = (await readSanitizedJson(req, null)) as Record<string, unknown> | null;
    const workspaceId = s(body?.workspaceId) || null;
    const projectId = toProjectId(body?.projectId);
    const origin = s(body?.origin) || null;

    const snapshot = await buildCavAiRouteManifestSnapshot();
    const saved = await persistCavAiRouteManifestSnapshot({
      accountId: String(session.accountId || ""),
      userId: String(session.sub || ""),
      requestId,
      source: "route_manifest_scan",
      workspaceId,
      projectId,
      origin,
      snapshot,
    });

    return json({
      ok: true,
      requestId,
      snapshotId: saved.id,
      summary: {
        routeCount: snapshot.routeCount,
        coveredCount: snapshot.coveredCount,
        heuristicCount: snapshot.heuristicCount,
        uncoveredCount: snapshot.uncoveredCount,
        adapterCoverageRate: snapshot.adapterCoverageRate,
        adapterCount: snapshot.adapterCount,
      },
      snapshot,
    }, 201);
  } catch (error) {
    if (isApiAuthError(error)) {
      return json({ ok: false, requestId, error: error.code }, error.status);
    }
    const message = error instanceof Error ? error.message : "Failed to generate route manifest snapshot.";
    return json({
      ok: false,
      requestId,
      error: "ROUTE_MANIFEST_SNAPSHOT_FAILED",
      ...(process.env.NODE_ENV !== "production" ? { message } : {}),
    }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" },
  });
}
