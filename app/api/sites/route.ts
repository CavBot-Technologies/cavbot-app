// app/api/sites/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { getAuthPool } from "@/lib/authDb";
import { requireAccountContext, requireAccountRole, requireSession } from "@/lib/apiAuth";
import {
  assertWorkerSiteRegistrationConfig,
  registerWorkerSite,
} from "@/lib/cavbotApi.server";
import { getCavbotAppOrigins } from "@/lib/security/embedAppOrigins";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  createDefaultAllowedOriginsForSite,
  createWorkspaceSite,
  findOwnedWorkspaceProjectForSites,
  rollbackCreatedWorkspaceSite,
} from "@/lib/workspaceSites.server";
import { expandRelatedExactOrigins } from "@/originMatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

type LegacySiteRow = {
  id: string;
  projectId: number | string;
  slug: string;
  label: string;
  origin: string;
  status: string;
  isActive: boolean | null;
  verifiedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ProjectIdRow = {
  id: number | string;
};

function json(payload: unknown, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function parseProjectId(raw: string | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isValidSlug(slug: string) {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug);
}

function normalizeOrigin(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("origin_required");

  const withProto =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  const u = new URL(withProto);

  if (!u.hostname || u.hostname.includes("..")) throw new Error("origin_invalid");
  if (u.username || u.password) throw new Error("origin_invalid");

  return u.origin;
}

function asDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function asSite(row: LegacySiteRow) {
  return {
    id: String(row.id),
    projectId: Number(row.projectId),
    slug: String(row.slug),
    label: String(row.label),
    origin: String(row.origin),
    status: String(row.status),
    isActive: Boolean(row.isActive),
    verifiedAt: asDate(row.verifiedAt)?.toISOString() ?? null,
    createdAt: asDate(row.createdAt)?.toISOString() ?? null,
    updatedAt: asDate(row.updatedAt)?.toISOString() ?? null,
  };
}

async function findOwnedProjectBySlug(accountId: string, projectSlug: string) {
  const result = await getAuthPool().query<ProjectIdRow>(
    `SELECT "id"
     FROM "Project"
     WHERE "slug" = $1
       AND "accountId" = $2
       AND "isActive" = true
     LIMIT 1`,
    [projectSlug, accountId]
  );
  const row = result.rows[0];
  return row ? { id: Number(row.id) } : null;
}

async function listOwnedProjectIds(accountId: string) {
  const result = await getAuthPool().query<ProjectIdRow>(
    `SELECT "id"
     FROM "Project"
     WHERE "accountId" = $1
       AND "isActive" = true
     ORDER BY "createdAt" ASC`,
    [accountId]
  );
  return result.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function listLegacySites(projectIds: number[]) {
  if (!projectIds.length) return [];
  const result = await getAuthPool().query<LegacySiteRow>(
    `SELECT
       "id",
       "projectId",
       "slug",
       "label",
       "origin",
       "status",
       "isActive",
       "verifiedAt",
       "createdAt",
       "updatedAt"
     FROM "Site"
     WHERE "projectId" = ANY($1::int[])
       AND "isActive" = true
     ORDER BY "createdAt" ASC`,
    [projectIds]
  );
  return result.rows.map(asSite);
}

async function findLegacySiteById(siteId: string) {
  const result = await getAuthPool().query<LegacySiteRow>(
    `SELECT
       "id",
       "projectId",
       "slug",
       "label",
       "origin",
       "status",
       "isActive",
       "verifiedAt",
       "createdAt",
       "updatedAt"
     FROM "Site"
     WHERE "id" = $1
     LIMIT 1`,
    [siteId]
  );
  return result.rows[0] ? asSite(result.rows[0]) : null;
}

async function slugExists(projectId: number, slug: string) {
  const result = await getAuthPool().query<{ id: string }>(
    `SELECT "id"
     FROM "Site"
     WHERE "projectId" = $1
       AND "slug" = $2
     LIMIT 1`,
    [projectId, slug]
  );
  return Boolean(result.rows[0]?.id);
}

function asHttpError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "");

  if (msg === "UNAUTHORIZED" || msg === "NO_SESSION" || msg === "UNAUTHENTICATED") {
    return { status: 401, payload: { error: "UNAUTHENTICATED" } };
  }
  if (msg === "FORBIDDEN") return { status: 403, payload: { error: "FORBIDDEN" } };
  if (msg === "BAD_PROJECT" || msg === "PROJECT_NOT_FOUND") {
    return { status: 404, payload: { error: "PROJECT_NOT_FOUND" } };
  }

  return { status: 500, payload: { error: "SITES_FAILED", message: msg } };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);

    const { searchParams } = new URL(req.url);
    const pid = parseProjectId(searchParams.get("projectId"));
    const projectSlug = String(searchParams.get("projectSlug") ?? "").trim();

    let projectIds: number[] = [];

    if (pid) {
      const project = await findOwnedWorkspaceProjectForSites(session.accountId!, pid);
      if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);
      projectIds = [project.id];
    } else if (projectSlug) {
      const project = await findOwnedProjectBySlug(session.accountId!, projectSlug);
      if (!project) return json({ error: "PROJECT_NOT_FOUND" }, 404);
      projectIds = [project.id];
    } else {
      projectIds = await listOwnedProjectIds(session.accountId!);
    }

    if (!projectIds.length) return json({ sites: [] }, 200);

    const sites = await listLegacySites(projectIds);
    return json({ sites }, 200);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireAccountRole(session, ["OWNER", "ADMIN"]);

    const { searchParams } = new URL(req.url);
    const pidQ = parseProjectId(searchParams.get("projectId"));
    const projectSlugQ = String(searchParams.get("projectSlug") ?? "").trim();

    const body = (await readSanitizedJson(req, {} as Record<string, unknown>)) as Record<string, unknown>;

    const slug = String(body.slug ?? "").trim();
    const label = String(body.label ?? "").trim();
    const originRaw = String(body.origin ?? "").trim();
    const pidB = parseProjectId(body.projectId != null ? String(body.projectId) : null);
    const projectSlugB = String(body.projectSlug ?? "").trim();

    const pid = pidB ?? pidQ ?? null;
    const projectSlug = projectSlugB || projectSlugQ;

    if (!slug || !label || !originRaw) {
      return json({ error: "MISSING_FIELDS", message: "slug, label, origin are required" }, 400);
    }
    if (!isValidSlug(slug)) {
      return json(
        { error: "BAD_SLUG", message: "slug must be lowercase letters/numbers with hyphens (3-64 chars)" },
        400
      );
    }

    const project = pid
      ? await findOwnedWorkspaceProjectForSites(session.accountId!, pid)
      : projectSlug
      ? await findOwnedProjectBySlug(session.accountId!, projectSlug)
      : null;

    if (!project) {
      return json(
        {
          error: "BAD_PROJECT",
          message: "projectId or projectSlug is required (and must belong to your account)",
        },
        400
      );
    }

    let origin: string;
    try {
      origin = normalizeOrigin(originRaw);
    } catch {
      return json({ error: "BAD_ORIGIN", message: "origin must be a valid URL or domain" }, 400);
    }

    if (await slugExists(project.id, slug)) {
      return json({ error: "SITE_CONFLICT" }, 409);
    }

    assertWorkerSiteRegistrationConfig();

    const originAliases = expandRelatedExactOrigins(origin);
    const result = await createWorkspaceSite({
      projectId: project.id,
      accountId: session.accountId!,
      origin,
      originAliases,
      label,
      notes: null,
      baseSlug: slug,
      siteLimit: null,
    });

    if ("limitBlocked" in result) {
      return json({ error: "PLAN_SITE_LIMIT", current: result.current, limit: result.limit }, 403);
    }

    if (result.conflict) {
      return json({ error: "SITE_CONFLICT" }, 409);
    }

    try {
      await createDefaultAllowedOriginsForSite(result.site.id, [
        ...originAliases,
        ...getCavbotAppOrigins(),
      ]);
      await registerWorkerSite(project.id, result.site.origin, result.site.label);
    } catch (error) {
      await rollbackCreatedWorkspaceSite({
        projectId: project.id,
        siteId: result.site.id,
        autoPinned: result.autoPinned,
      });
      throw error;
    }

    const site = await findLegacySiteById(result.site.id);
    return json({ site }, 201);
  } catch (e: unknown) {
    const { status, payload } = asHttpError(e);
    return json(payload, status);
  }
}
