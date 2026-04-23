// app/api/workspaces/[projectId]/sites/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  requireAccountRole,
  isApiAuthError,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import {
  assertWorkerSiteRegistrationConfig,
  CavBotApiConfigError,
  CavBotApiError,
  registerWorkerSite,
} from "@/lib/cavbotApi.server";
import {
  createDefaultAllowedOriginsForSite,
  createProjectNotice,
  createWorkspaceSite,
  findAccountTier,
  findOwnedWorkspaceProjectForSites,
  listActiveWorkspaceSites,
  markWorkspaceSiteVerified,
  rollbackCreatedWorkspaceSite,
} from "@/lib/workspaceSites.server";

// Plan system enforcement
import { isPermissionDeniedError, isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { resolvePlanIdFromTier, getPlanLimits } from "@/lib/plans";
import { getCavbotAppOrigins } from "@/lib/security/embedAppOrigins";
import { readSanitizedJson } from "@/lib/security/userInput";
import { expandRelatedExactOrigins } from "@/originMatch";
import {
  requireLowRiskWorkspaceSession,
  requireWorkspaceSession,
} from "@/lib/workspaceAuth.server";
import { requestInitialSiteScanBestEffort } from "@/lib/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function requestIdFrom(req: Request) {
  const incoming =
    req.headers.get("x-request-id") ||
    req.headers.get("x-vercel-id") ||
    req.headers.get("cf-ray");
  return (incoming && incoming.trim()) || crypto.randomUUID();
}

function withBaseHeaders(headers?: HeadersInit, rid?: string) {
  const base: Record<string, string> = { ...NO_STORE_HEADERS };
  if (rid) base["x-cavbot-request-id"] = rid;
  return { ...(headers || {}), ...base };
}

function json(data: unknown, init?: number | ResponseInit, rid?: string) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: withBaseHeaders(resInit.headers, rid),
  });
}

function parseProjectId(raw: string): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// Next 15+ params can be a Promise — always await it safely
async function getParams(ctx: unknown): Promise<{ projectId?: string }> {
  if (typeof ctx === "object" && ctx !== null) {
    const params = (ctx as { params?: { projectId?: string } }).params;
    return Promise.resolve(params ?? {});
  }
  return Promise.resolve({});
}

/**
 * Canonical origin rules (important for slug + duplicates):
 * - default https:// if no protocol
 * - lowercase hostname
 * - strip leading www.
 * - reject credentials
 * - keep scheme + host (+ port only if non-default)
 */
function normalizeOrigin(input: string): string {
  const raw = (input || "").trim();
  if (!raw) throw new Error("Enter a domain or origin.");

  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("That doesn’t look like a valid domain/origin.");
  }

  if (!u.hostname || u.hostname.includes("..")) throw new Error("That domain/origin is invalid.");
  if (u.username || u.password) throw new Error("Origins may not include credentials.");

  const host = u.hostname.toLowerCase();
  const isDefaultPort =
    (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
    (u.protocol === "http:" && (u.port === "" || u.port === "80"));

  const portPart = isDefaultPort ? "" : `:${u.port}`;
  const scheme = u.protocol === "http:" ? "http:" : "https:"; // force only http/https

  return `${scheme}//${host}${portPart}`;
}

function hostLabel(origin: string) {
  return new URL(origin).hostname.replace(/^www\./, "");
}

function normalizeNotes(input: string) {
  const notes = String(input || "").trim().slice(0, 160);
  return notes || null;
}

function baseSlugFromOrigin(origin: string) {
  const host = new URL(origin).hostname.replace(/^www\./, "").toLowerCase();
  return host
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isWorkspaceSiteSchemaOutOfDate(error: unknown) {
  return isSchemaMismatchError(error, {
    tables: ["Site", "SiteAllowedOrigin", "ProjectNotice", "Project"],
    columns: ["notes", "topSiteId", "origin", "slug", "projectId", "siteId"],
    fields: ["siteAllowedOrigin", "projectNotice"],
  });
}

function isWorkspaceSitePermissionDenied(error: unknown) {
  return isPermissionDeniedError(error, ["Site", "SiteAllowedOrigin", "ProjectNotice", "Project"]);
}

function logWorkspaceSiteFailure(args: {
  route: string;
  requestId: string;
  accountId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  errorCode: string;
  error: unknown;
  workerRequestId?: string;
}) {
  console.error("[workspace-sites]", {
    route: args.route,
    requestId: args.requestId,
    workerRequestId: args.workerRequestId || null,
    accountId: args.accountId || null,
    projectId: args.projectId || null,
    origin: args.origin || null,
    errorCode: args.errorCode,
    detail: args.error instanceof Error ? args.error.message : String(args.error),
  });
}

function siteFailureResponse(args: {
  route: string;
  requestId: string;
  accountId?: string | null;
  projectId?: number | null;
  origin?: string | null;
  error: unknown;
  phase: "create" | "wiring";
}) {
  const workerRequestId = args.error instanceof CavBotApiError ? args.error.requestId : undefined;

  if (isWorkspaceSiteSchemaOutOfDate(args.error)) {
    logWorkspaceSiteFailure({ ...args, errorCode: "DB_SCHEMA_OUT_OF_DATE", workerRequestId });
    return json(
      {
        error: "DB_SCHEMA_OUT_OF_DATE",
        message: "Website setup is temporarily unavailable while workspace schema updates finish.",
        requestId: args.requestId,
        retryable: false,
      },
      409,
      args.requestId
    );
  }

  if (isWorkspaceSitePermissionDenied(args.error)) {
    logWorkspaceSiteFailure({ ...args, errorCode: "DB_PERMISSION_DENIED", workerRequestId });
    return json(
      {
        error: "DB_PERMISSION_DENIED",
        message: "Website setup is temporarily unavailable while workspace permissions are being repaired.",
        requestId: args.requestId,
        retryable: false,
      },
      503,
      args.requestId
    );
  }

  if (args.error instanceof CavBotApiConfigError || (args.error as { code?: unknown })?.code === "config_invalid") {
    logWorkspaceSiteFailure({ ...args, errorCode: "SITE_WIRING_CONFIG_INVALID", workerRequestId });
    return json(
      {
        error: "SITE_WIRING_CONFIG_INVALID",
        message: "CavBot website wiring is temporarily unavailable while backend configuration is being repaired.",
        requestId: args.requestId,
        retryable: false,
      },
      500,
      args.requestId
    );
  }

  if (args.phase === "wiring") {
    const status = Number((args.error as { status?: unknown })?.status);
    logWorkspaceSiteFailure({ ...args, errorCode: "SITE_WIRING_FAILED", workerRequestId });
    return json(
      {
        error: "SITE_WIRING_FAILED",
        message: "CavBot could not finish wiring this website for tracking. Please try again in a moment.",
        detail: args.error instanceof Error ? args.error.message : undefined,
        requestId: args.requestId,
        retryable: true,
      },
      Number.isFinite(status) && status >= 400 && status < 600 ? status : 502,
      args.requestId
    );
  }

  logWorkspaceSiteFailure({ ...args, errorCode: "SITE_CREATE_FAILED", workerRequestId });
  return json(
    {
      error: "SITE_CREATE_FAILED",
      message: "CavBot could not add this website right now. Please try again.",
      requestId: args.requestId,
      retryable: true,
    },
    500,
    args.requestId
  );
}

async function createProjectNoticeBestEffort(projectId: number, origin: string, requestId: string) {
  try {
    await createProjectNotice(projectId, origin);
  } catch (error) {
    if (!isWorkspaceSiteSchemaOutOfDate(error)) {
      logWorkspaceSiteFailure({
        route: "/api/workspaces/[projectId]/sites",
        requestId,
        projectId,
        origin,
        errorCode: "PROJECT_NOTICE_WRITE_FAILED",
        error,
      });
    }
  }
}

export async function GET(req: Request, ctx: unknown) {
  const rid = requestIdFrom(req);

  try {
    const sess = await requireWorkspaceSession(req);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT", requestId: rid }, 400, rid);

    const project = await findOwnedWorkspaceProjectForSites(sess.accountId, projectId);
    if (!project) return json({ error: "NOT_FOUND", requestId: rid }, 404, rid);

    const sites = await listActiveWorkspaceSites(project.id, "asc");

    return json({ topSiteId: project.topSiteId, sites }, 200, rid);
  } catch (e) {
    if (isApiAuthError(e)) return json({ error: e.code, requestId: rid }, e.status, rid);
    return json({ error: "SERVER_ERROR", requestId: rid }, 500, rid);
  }
}

export async function POST(req: Request, ctx: unknown) {
  const rid = requestIdFrom(req);

  try {
    const sess = await requireLowRiskWorkspaceSession(req);
    requireAccountRole(sess, ["OWNER", "ADMIN"]);

    const params = await getParams(ctx);
    const projectId = parseProjectId(params?.projectId || "");
    if (!projectId) return json({ error: "BAD_PROJECT", requestId: rid }, 400, rid);

    // Load project
    const project = await findOwnedWorkspaceProjectForSites(sess.accountId, projectId);
    if (!project) return json({ error: "NOT_FOUND", requestId: rid }, 404, rid);

    // Load account tier (Plan enforcement source)
    const accountTier = await findAccountTier(sess.accountId);

    const planId = resolvePlanIdFromTier(accountTier || "FREE");
    const limits = getPlanLimits(planId);

    const body = (await readSanitizedJson(req, null)) as null | {
      origin?: string;
      label?: string;
      notes?: string;
    };

    const originRaw = (body?.origin || "").trim();
    const labelRaw = (body?.label || "").trim();
    const notes = normalizeNotes(body?.notes || "");

    let origin: string;
    try {
      origin = normalizeOrigin(originRaw);
    } catch (err) {
      return json(
        {
          error: "BAD_ORIGIN",
          message: err instanceof Error ? err.message : "Invalid origin.",
          requestId: rid,
        },
        400,
        rid
      );
    }

    const label = (labelRaw || hostLabel(origin)).slice(0, 48);
    const baseSlug = baseSlugFromOrigin(origin);
    const originAliases = expandRelatedExactOrigins(origin);

    try {
      assertWorkerSiteRegistrationConfig();
    } catch (error) {
      return siteFailureResponse({
        route: "/api/workspaces/[projectId]/sites",
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        origin,
        error,
        phase: "wiring",
      });
    }

    try {
      const result = await createWorkspaceSite({
        projectId: project.id,
        accountId: sess.accountId,
        origin,
        originAliases,
        label,
        notes,
        baseSlug,
        siteLimit: limits.websites === "unlimited" ? null : limits.websites,
      });

      if ("limitBlocked" in result) {
        return json(
          {
            error: "PLAN_SITE_LIMIT",
            message:
              planId === "free"
                ? "Free Tier allows 1 website. Upgrade to add more."
                : "You’ve reached the website limit for this plan.",
            planId,
            current: result.current,
            limit: result.limit,
            requestId: rid,
          },
          403,
          rid
        );
      }

      // conflict path
      if (result.conflict) {
        return json({ error: "SITE_EXISTS", site: result.site, requestId: rid }, 409, rid);
      }

      try {
        await createDefaultAllowedOriginsForSite(result.site.id, [
          ...originAliases,
          ...getCavbotAppOrigins(),
        ]);
        await registerWorkerSite(project.id, result.site.origin, result.site.label);
        await markWorkspaceSiteVerified(result.site.id);
      } catch (error) {
        await rollbackCreatedWorkspaceSite({
          projectId: project.id,
          siteId: result.site.id,
          autoPinned: result.autoPinned,
        });

        return siteFailureResponse({
          route: "/api/workspaces/[projectId]/sites",
          requestId: rid,
          accountId: sess.accountId,
          projectId,
          origin: result.site.origin,
          error,
          phase: "wiring",
        });
      }

      await createProjectNoticeBestEffort(project.id, result.site.origin, rid);

      const initialScan = await requestInitialSiteScanBestEffort({
        projectId: project.id,
        siteId: result.site.id,
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        ip:
          (req.headers.get("cf-connecting-ip")
            || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || req.headers.get("true-client-ip"))
          ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
        reason: "Initial site activation",
      });

      if (sess.accountId) {
        try {
          await auditLogWrite({
            request: req,
            action: "SITE_ADDED",
            accountId: sess.accountId,
            operatorUserId: sess.sub,
            targetType: "site",
            targetId: result.site.id,
            targetLabel: result.site.origin,
            metaJson: {
              origin: result.site.origin,
              label: result.site.label,
              projectId,
            },
          });
        } catch (error) {
          logWorkspaceSiteFailure({
            route: "/api/workspaces/[projectId]/sites",
            requestId: rid,
            accountId: sess.accountId,
            projectId,
            origin: result.site.origin,
            errorCode: "AUDIT_LOG_WRITE_FAILED",
            error,
          });
        }
      }

      return json({ site: result.site, topSiteId: result.topSiteId, initialScan }, 201, rid);
    } catch (e: unknown) {
      return siteFailureResponse({
        route: "/api/workspaces/[projectId]/sites",
        requestId: rid,
        accountId: sess.accountId,
        projectId,
        origin,
        error: e,
        phase: "create",
      });
    }
  } catch (e) {
    if (isApiAuthError(e)) return json({ error: e.code, requestId: rid }, e.status, rid);
    return siteFailureResponse({
      route: "/api/workspaces/[projectId]/sites",
      requestId: rid,
      error: e,
      phase: "create",
    });
  }
}
