import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ApiKeyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isApiAuthError } from "@/lib/apiAuth";
import { requireSettingsOwnerSession } from "@/lib/settings/ownerAuth.server";
import { resolveApiKeyWorkspace } from "@/lib/settings/apiKeyWorkspace.server";
import { buildApiKeyInsertData, serializeApiKey } from "@/lib/apiKeys.server";
import { DEFAULT_RATE_LIMIT_LABEL, KeyUsagePayload, fetchUsageForWorkspace } from "@/lib/apiKeyUsage.server";
import { auditLogWrite } from "@/lib/audit";
import { readSanitizedJson } from "@/lib/security/userInput";

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
  publishableKeys: ReturnType<typeof serializeApiKey>[];
  secretKeys: ReturnType<typeof serializeApiKey>[];
  allowedOrigins: string[];
  site: { id: string; origin: string } | null;
  usage: KeyUsagePayload;
};

function toType(raw: unknown): ApiKeyType {
  const value = String(raw ?? "publishable").trim().toUpperCase();
  if (value === "SECRET" || value === "ADMIN" || value === "PUBLISHABLE") return value as ApiKeyType;
  return "PUBLISHABLE";
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSettingsOwnerSession(req);
    const workspace = await resolveApiKeyWorkspace({ accountId: session.accountId });
    if (!workspace) {
      const emptyPayload: KeyResponse = {
        ok: true,
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

    const keys = await prisma.apiKey.findMany({
      where: { projectId: workspace.projectId },
      orderBy: { createdAt: "desc" },
    });

    const publishableKeys = keys
      .filter((key) => key.type === "PUBLISHABLE")
      .map((key) => serializeApiKey(key, { includeValue: key.status === "ACTIVE" }));
    const secretKeys = keys
      .filter((key) => key.type === "SECRET")
      .map((key) => serializeApiKey(key));

    const siteRecord = workspace.activeSite;
    const allowedOrigins = workspace.allowedOrigins;

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
    const session = await requireSettingsOwnerSession(req);
    const workspace = await resolveApiKeyWorkspace({ accountId: session.accountId });
    if (!workspace) return json({ ok: false, error: "PROJECT_NOT_FOUND" }, 404);

    const body = (await readSanitizedJson(req, null)) as ApiKeyCreateBody | null;

    const type = toType(body?.type);
    let siteId: string | null = null;
    const bodySiteId = String(body?.siteId ?? "").trim();
    if (bodySiteId) {
      const site = await prisma.site.findFirst({
        where: {
          id: bodySiteId,
          projectId: workspace.projectId,
          isActive: true,
        },
      });
      if (!site) return json({ ok: false, error: "SITE_NOT_FOUND" }, 404);
      siteId = site.id;
    } else if (workspace.activeSite?.id) {
      siteId = workspace.activeSite.id;
    }

    const insert = buildApiKeyInsertData({
      type,
      accountId: session.accountId!,
      projectId: workspace.projectId,
      siteId,
      name: String(body?.name || "").trim() || null,
      scopes: Array.isArray(body?.scopes) ? body.scopes : undefined,
    });

    const created = await prisma.apiKey.create({ data: insert.data });

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
          projectId: created.projectId,
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
