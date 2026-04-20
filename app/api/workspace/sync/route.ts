// app/api/workspace/sync/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext } from "@/lib/apiAuth";
import { writeWorkspace, type WorkspacePayload } from "@/lib/workspaceStore.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function parseProjectId(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function pickFirstId(ids: string[]) {
  return ids[0] || "";
}

/**
 * POST /api/workspace/sync
 * Client posts snapshot; server:
 * - authenticates
 * - loads DB truth for sites/topSiteId
 * - validates/repairs pointers
 * - writes workspace cookies via writeWorkspace()
 */
export async function POST(req: NextRequest) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as Partial<WorkspacePayload> | null;
    const bodyPayload = body ?? {};

    // Resolve + validate project in account
    const projectId = parseProjectId(bodyPayload.projectId) ?? 1;

    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: sess.accountId! },
      select: { id: true, topSiteId: true },
    });

    if (!project) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    // DB truth (do NOT trust client sites list)
    const rows = await prisma.site.findMany({
      where: { projectId: project.id, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, origin: true, createdAt: true, notes: true },
    });

    const sites = rows.map((r) => ({
      id: r.id,
      label: r.label,
      origin: r.origin,
      createdAt: r.createdAt.getTime(),
      notes: r.notes ?? undefined,
    }));

    const ids = sites.map((s) => s.id);
    const hasSites = ids.length > 0;

    const clientTop = String(bodyPayload.topSiteId ?? "").trim();
    const clientActive = String(bodyPayload.activeSiteId ?? "").trim();

    const dbTop = String(project.topSiteId ?? "").trim();

    const topCandidate =
      (dbTop && ids.includes(dbTop) ? dbTop : "") ||
      (clientTop && ids.includes(clientTop) ? clientTop : "") ||
      (clientActive && ids.includes(clientActive) ? clientActive : "") ||
      (hasSites ? pickFirstId(ids) : "");

    const activeCandidate =
      (clientActive && ids.includes(clientActive) ? clientActive : "") ||
      (clientTop && ids.includes(clientTop) ? clientTop : "") ||
      (topCandidate && ids.includes(topCandidate) ? topCandidate : "") ||
      (hasSites ? pickFirstId(ids) : "");

    const payload: WorkspacePayload = {
      projectId: project.id,
      sites,
      topSiteId: hasSites ? topCandidate : "",
      activeSiteId: hasSites ? activeCandidate : "",
    };

    await writeWorkspace(payload);

    return NextResponse.json(
      {
        ok: true,
        projectId: project.id,
        sitesCount: sites.length,
        topSiteId: payload.topSiteId,
        activeSiteId: payload.activeSiteId,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err: unknown) {
    const msg = String((err as { message?: string })?.message || err);
    const status = msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      { ok: false, error: status === 401 ? "UNAUTHENTICATED" : "BAD_REQUEST" },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...NO_STORE_HEADERS, Allow: "POST,OPTIONS" } });
}
