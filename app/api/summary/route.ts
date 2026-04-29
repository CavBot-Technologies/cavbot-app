// app/api/summary/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession } from "@/lib/apiAuth";
import { getProjectSummaryForTenant, type SummaryRange } from "@/lib/cavbotApi.server";
import { resolveProjectAnalyticsAuth } from "@/lib/projectAnalyticsKey.server";
import { readWorkspace } from "@/lib/workspaceStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function normalizeRange(input: string | null): SummaryRange {
  const v = String(input ?? "").trim();
  if (v === "24h" || v === "7d" || v === "14d" || v === "30d") return v as SummaryRange;
  return "30d";
}

function parseProjectId(raw: string | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeMaybeOrigin(input: string | null): string | undefined {
  const raw = String(input ?? "").trim();
  if (!raw) return undefined;

  const withProto =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("BAD_ORIGIN");
  }

  if (!u.hostname || u.hostname.includes("..")) throw new Error("BAD_ORIGIN");
  if (u.username || u.password) throw new Error("BAD_ORIGIN");

  return u.origin;
}

function asHttpError(e: unknown) {
  const msg = String((e as { message?: unknown })?.message || e);

  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { ok: false, error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { ok: false, error: "FORBIDDEN" } };
  if (msg === "BAD_ORIGIN") return { status: 400, payload: { ok: false, error: "BAD_ORIGIN" } };
  if (msg === "PROJECT_KEY_MISSING") return { status: 409, payload: { ok: false, error: "PROJECT_KEY_MISSING" } };
  if (msg === "PROJECT_KEY_DECRYPT_FAILED") {
    return { status: 502, payload: { ok: false, error: "PROJECT_KEY_DECRYPT_FAILED" } };
  }

  return { status: 500, payload: { ok: false, error: "SUMMARY_PROXY_FAILED" } };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);

    const pid = parseProjectId(searchParams.get("projectId"));
    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();
    const workspace = await readWorkspace({ accountId: session.accountId! }).catch(() => null);
    const workspaceProjectId = parseProjectId(String(workspace?.projectId ?? ""));
    const selectedProjectId = pid || workspaceProjectId;

    const project = selectedProjectId
      ? await prisma.project.findFirst({
          where: { id: selectedProjectId, accountId: session.accountId!, isActive: true },
          select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
        })
      : projectSlug
      ? await prisma.project.findFirst({
          where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
          select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
        })
      : await prisma.project.findFirst({
          where: { accountId: session.accountId!, isActive: true },
          orderBy: { createdAt: "asc" },
          select: { id: true, slug: true, name: true, serverKeyEnc: true, serverKeyEncIv: true },
        });

    if (!project) return json({ ok: false, error: "PROJECT_NOT_FOUND" }, 404);

    const range = normalizeRange(searchParams.get("range"));

    const siteOrigin = normalizeMaybeOrigin(
      searchParams.get("origin") ??
        searchParams.get("siteOrigin") ??
        workspace?.activeSiteOrigin ??
        workspace?.workspace?.activeSiteOrigin ??
        null
    );
    const siteId =
      String(searchParams.get("siteId") ?? workspace?.activeSiteId ?? "").trim() || undefined;

    const analyticsAuth = await resolveProjectAnalyticsAuth(project);

    const data = await getProjectSummaryForTenant({
      projectId: project.id,
      range,
      siteOrigin,
      siteId,
      projectKey: analyticsAuth.projectKey,
      adminToken: analyticsAuth.adminToken,
      requestId: `api_summary_${project.id}`,
    });

    const publicProject = { id: project.id, slug: project.slug, name: project.name };
    return json({ ok: true, project: publicProject, data }, 200);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}
