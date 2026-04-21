import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerResilientSession } from "@/lib/settings/ownerAuth.server";
import { readApiKeyWorkspaceCookieHints, resolveApiKeyWorkspace } from "@/lib/settings/apiKeyWorkspace.server";
import {
  buildApiKeyInsertData,
  serializeApiKey,
  type ApiKeyType,
} from "@/lib/apiKeys.server";
import { DEFAULT_RATE_LIMIT_LABEL, KeyUsagePayload, fetchUsageForWorkspace } from "@/lib/apiKeyUsage.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  createApiKeyRecord,
  findSiteForAccount,
  findSiteForProject,
  listActiveSitesForAccount,
  listApiKeysForProject,
  listAllowedOriginsForSite,
} from "@/lib/settings/apiKeysRuntime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(payload: T, init?: number | ResponseInit) {
  const baseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(payload, {
    ...baseInit,
    headers: { ...(baseInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

type ApiKeyCreateBody = {
  type?: string;
  siteId?: string;
  name?: string;
  scopes?: unknown;
};

type KeyResponse = {
  ok: true;
  projectId: number | null;
  sites: { id: string; origin: string }[];
  publishableKeys: ReturnType<typeof serializeApiKey>[];
  secretKeys: ReturnType<typeof serializeApiKey>[];
  allowedOrigins: string[];
  site: { id: string; origin: string } | null;
  usage: KeyUsagePayload;
};

type WorkspaceSiteSummary = {
  id: string;
  origin: string;
  projectId: number;
};

function toType(raw: unknown): ApiKeyType {
  const value = String(raw ?? "publishable").trim().toUpperCase();
  if (value === "SECRET" || value === "ADMIN" || value === "PUBLISHABLE") return value as ApiKeyType;
  return "PUBLISHABLE";
}

function safeSerializeKeyList(
  keys: Awaited<ReturnType<typeof listApiKeysForProject>>,
  type: ApiKeyType,
  includeActiveValue = false,
) {
  return keys
    .filter((key) => key.type === type)
    .flatMap((key) => {
      try {
        return [serializeApiKey(key, { includeValue: includeActiveValue && key.status === "ACTIVE" })];
      } catch (error) {
        console.error("[settings/api-keys] serialize failed", {
          keyId: key.id,
          keyType: key.type,
          detail: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });
}

async function resolveApiKeyWorkspaceWithFallback(args: {
  accountId: string;
  requestedSiteId?: string | null;
  preferredProjectId?: number | null;
  activeSiteIdHint?: string | null;
  activeSiteOriginHint?: string | null;
}) {
  try {
    return await resolveApiKeyWorkspace(args);
  } catch (error) {
    console.error("[settings/api-keys] workspace resolve failed", {
      accountId: args.accountId,
      requestedSiteId: args.requestedSiteId ?? null,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  let sites: WorkspaceSiteSummary[] = [];
  try {
    sites = await listActiveSitesForAccount(args.accountId);
  } catch (error) {
    console.error("[settings/api-keys] site fallback failed", {
      accountId: args.accountId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!sites.length) return null;

  const requestedSiteId = String(args.requestedSiteId || "").trim();
  const activeSite =
    (requestedSiteId ? sites.find((site) => site.id === requestedSiteId) : null) ??
    sites[0] ??
    null;
  if (!activeSite) return null;

  const projectSites = sites
    .filter((site) => site.projectId === activeSite.projectId)
    .map((site) => ({ id: site.id, origin: site.origin }));

  let allowedOrigins = [activeSite.origin];
  try {
    const extraOrigins = await listAllowedOriginsForSite(activeSite.id);
    allowedOrigins = Array.from(new Set([activeSite.origin, ...extraOrigins]));
  } catch (error) {
    console.error("[settings/api-keys] fallback allowed origins lookup failed", {
      siteId: activeSite.id,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    projectId: activeSite.projectId,
    sites: projectSites,
    activeSite: { id: activeSite.id, origin: activeSite.origin },
    allowedOrigins,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerResilientSession(req);
    const workspaceHints = readApiKeyWorkspaceCookieHints(req);
    const requestedSiteId = String(req.nextUrl.searchParams.get("siteId") || "").trim() || undefined;
    const workspace = await resolveApiKeyWorkspaceWithFallback({
      accountId: session.accountId,
      requestedSiteId,
      ...workspaceHints,
    });
    if (!workspace) {
      const emptyPayload: KeyResponse = {
        ok: true,
        projectId: null,
        sites: [],
        publishableKeys: [],
        secretKeys: [],
        allowedOrigins: [],
        site: null,
        usage: {
          verifiedToday: null,
          deniedToday: null,
          rateLimit: DEFAULT_RATE_LIMIT_LABEL,
          topDeniedOrigins: null,
        },
      };
      return json(emptyPayload, 200);
    }

    let keys: Awaited<ReturnType<typeof listApiKeysForProject>> = [];
    try {
      keys = await listApiKeysForProject(workspace.projectId);
    } catch (error) {
      console.error("[settings/api-keys] project key lookup failed", {
        projectId: workspace.projectId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const siteRecord = workspace.activeSite;
    const scopedKeys = siteRecord?.id
      ? keys.filter((key) => String(key.siteId || "").trim() === siteRecord.id)
      : keys.filter((key) => !String(key.siteId || "").trim());

    const publishableKeys = safeSerializeKeyList(scopedKeys, "PUBLISHABLE", true);
    const secretKeys = safeSerializeKeyList(scopedKeys, "SECRET");
    const allowedOrigins = siteRecord ? workspace.allowedOrigins : [];

    const usage =
      (await fetchUsageForWorkspace({
        projectId: workspace.projectId,
        accountId: session.accountId!,
        siteId: siteRecord?.id ?? null,
        siteOrigin: siteRecord?.origin ?? null,
      })) ??
      {
        verifiedToday: null,
        deniedToday: null,
        rateLimit: DEFAULT_RATE_LIMIT_LABEL,
        topDeniedOrigins: null,
      };

    const payload: KeyResponse = {
      ok: true,
      projectId: workspace.projectId,
      sites: workspace.sites.map((site) => ({ id: site.id, origin: site.origin })),
      publishableKeys,
      secretKeys,
      allowedOrigins,
      site: siteRecord ? { id: siteRecord.id, origin: siteRecord.origin } : null,
      usage,
    };

    return json(payload, 200);
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    console.error("[settings/api-keys] load failed", error);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await readSanitizedJson(req, null)) as ApiKeyCreateBody | null;
    const session = await requireSettingsOwnerResilientSession(req);
    const workspaceHints = readApiKeyWorkspaceCookieHints(req);
    const requestedSiteId = String(body?.siteId ?? "").trim() || undefined;
    let workspace = await resolveApiKeyWorkspaceWithFallback({
      accountId: session.accountId,
      requestedSiteId,
      ...workspaceHints,
    });

    const type = toType(body?.type);
    let siteId: string | null = null;
    let projectId: number | null = workspace?.projectId ?? null;
    const bodySiteId = String(body?.siteId ?? "").trim();
    if (bodySiteId) {
      const site =
        (projectId
          ? await findSiteForProject({
              siteId: bodySiteId,
              projectId,
            })
          : null) ??
        (await findSiteForAccount({
          siteId: bodySiteId,
          accountId: session.accountId,
        }));
      if (!site) return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
      siteId = site.id;
      projectId = site.projectId;
      if (!workspace && projectId) {
        workspace = {
          projectId,
          sites: [{ id: site.id, origin: site.origin }],
          activeSite: { id: site.id, origin: site.origin },
          allowedOrigins: [site.origin],
        };
      }
    } else if (workspace?.activeSite?.id) {
      siteId = workspace.activeSite.id;
    }
    if (!projectId && workspace?.projectId) {
      projectId = workspace.projectId;
    }
    if (!projectId) return json({ ok: false, error: "PROJECT_NOT_FOUND" }, 404);

    const insert = buildApiKeyInsertData({
      type,
      accountId: session.accountId!,
      projectId,
      siteId,
      name: String(body?.name || "").trim() || null,
      scopes: Array.isArray(body?.scopes) ? body.scopes : undefined,
    });

    const created = await createApiKeyRecord(insert.data);
    if (!created) {
      return json({ ok: false, error: "CREATE_KEY_FAILED", message: "Failed to create API key." }, 500);
    }

    if (session.accountId) {
      await auditLogWrite({
        request: req,
        action: "KEY_CREATED",
        accountId: session.accountId,
        operatorUserId: session.sub,
        targetType: "apiKey",
        targetId: created.id,
        targetLabel: created.name || created.last4,
        metaJson: {
          keyType: type,
          last4: created.last4,
          scopes: created.scopes,
          siteId: created.siteId,
          projectId: created.projectId ?? projectId,
        },
      });
    }

    return json(
      {
        ok: true,
        key: serializeApiKey(created, { includeValue: type === "PUBLISHABLE" }),
        plaintextKey: insert.plaintextKey,
      },
      201
    );
  } catch (error: unknown) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    const message = error instanceof Error ? error.message : String(error);
    console.error("[settings/api-keys] create failed", error);
    return json({ ok: false, error: "CREATE_KEY_FAILED", message }, 500);
  }
}
