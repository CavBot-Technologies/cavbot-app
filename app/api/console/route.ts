// app/api/console/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, requireAccountContext, isApiAuthError } from "@/lib/apiAuth";
import type { SummaryRange } from "@/lib/cavbotApi.server";
import { CavBotApiError, getProjectSummaryForTenant } from "@/lib/cavbotApi.server";
import { resolveProjectAnalyticsAuth } from "@/lib/projectAnalyticsKey.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

// ===== Workspace cookie keys (match Command Center + writeWorkspace) =====
const KEY_ACTIVE_PROJECT_ID = "cb_active_project_id";
const KEY_ACTIVE_SITE_ORIGIN_PREFIX = "cb_active_site_origin__";
const KEY_ACTIVE_SITE_ID_PREFIX = "cb_active_site_id__";

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function getCookieDecoded(req: NextRequest, key: string): string {
  const raw = String(req.cookies.get(key)?.value ?? "").trim();
  return safeDecode(raw).trim();
}

function normalizeRange(input: string | null): SummaryRange {
  const v = String(input ?? "").trim();
  if (v === "24h" || v === "7d" || v === "14d" || v === "30d") return v as SummaryRange;
  return "30d";
}

function parseProjectId(raw: string | null | undefined): number | null {
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

function toPublicError(e: unknown) {
  // apiAuth.ts errors (session/origin/roles)
  if (isApiAuthError(e)) {
    const status = e.status ?? 401;
    const code = e.code || "UNAUTHORIZED";
    if (code === "BAD_ORIGIN") return { status: 403, payload: { error: "BAD_ORIGIN" } };
    if (status === 403) return { status: 403, payload: { error: "FORBIDDEN" } };
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }

  // BAD_ORIGIN thrown by normalizeMaybeOrigin
  const message =
    e instanceof Error
      ? e.message
      : typeof e === "string"
      ? e
      : undefined;
  if (message === "BAD_ORIGIN") {
    return { status: 400, payload: { error: "BAD_ORIGIN" } };
  }

  // CavBot API client errors
  if (e instanceof CavBotApiError) {
    return {
      status: e.status && e.status >= 400 && e.status <= 599 ? e.status : 502,
      payload: {
        error: "CAVBOT_API_ERROR",
        code: e.code || undefined,
        requestId: e.requestId || undefined,
      },
    };
  }

  return { status: 500, payload: { error: "CONSOLE_SUMMARY_FAILED" } };
}

export async function GET(req: NextRequest) {
  try {
    // MUST be NextRequest so apiAuth can reliably read cookies
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = req.nextUrl;
    const range = normalizeRange(searchParams.get("range"));

    // Priority order:
    // 1) URL param (project / projectId)
    // 2) cookie cb_active_project_id (new)
    // 3) cookie cb_pid (legacy fallback)
    // 4) fallback to first active project in DB (for this account)
    const pidFromQuery =
      parseProjectId(searchParams.get("project")) || parseProjectId(searchParams.get("projectId"));

    const pidFromCookie =
      parseProjectId(req.cookies.get(KEY_ACTIVE_PROJECT_ID)?.value) ||
      parseProjectId(req.cookies.get("cb_pid")?.value);

    const pid = pidFromQuery ?? pidFromCookie;

    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();

    const project = pid
      ? await prisma.project.findFirst({
          where: { id: pid, accountId: session.accountId!, isActive: true },
          select: {
            id: true,
            slug: true,
            name: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        })
      : projectSlug
      ? await prisma.project.findFirst({
          where: { slug: projectSlug, accountId: session.accountId!, isActive: true },
          select: {
            id: true,
            slug: true,
            name: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        })
      : await prisma.project.findFirst({
          where: { accountId: session.accountId!, isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            slug: true,
            name: true,
            serverKeyEnc: true,
            serverKeyEncIv: true,
          },
        });

    if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);

    // ===== SITE SCOPING (this is the fix) =====
    // Query params win. If absent, fall back to Command Center cookie pointers for THIS project.
    const pidStr = String(project.id);

    const siteOriginFromQuery = normalizeMaybeOrigin(
      searchParams.get("origin") ?? searchParams.get("siteOrigin")
    );

    const siteIdFromQuery = String(searchParams.get("siteId") ?? "").trim() || undefined;

    const siteOriginFromCookie = normalizeMaybeOrigin(
      getCookieDecoded(req, `${KEY_ACTIVE_SITE_ORIGIN_PREFIX}${pidStr}`) || null
    );

    const siteIdFromCookie =
      getCookieDecoded(req, `${KEY_ACTIVE_SITE_ID_PREFIX}${pidStr}`) || undefined;

    const siteOrigin = siteOriginFromQuery ?? siteOriginFromCookie;
    const siteId = siteIdFromQuery ?? siteIdFromCookie;

    const analyticsAuth = await resolveProjectAnalyticsAuth(project);

    const out = await getProjectSummaryForTenant({
      projectId: project.id,
      range,
      siteOrigin,
      siteId,
      projectKey: analyticsAuth.projectKey,
      adminToken: analyticsAuth.adminToken,
      requestId: `console_${project.id}_${Date.now()}`,
    });

    return json(out, 200);
  } catch (error) {
    const { status, payload } = toPublicError(error);
    return json(payload, status);
  }
}
