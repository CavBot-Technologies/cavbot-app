import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { isApiAuthError, requireAccountContext, requireAccountRole, requireSession, requireUser } from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";
import {
  createWorkspaceAccessRequest,
  isWorkspaceAccessRequestSchemaMismatch,
  listWorkspaceAccessRequests,
} from "@/lib/workspaceTeam.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie",
};

function json<T>(data: T, init?: number | ResponseInit) {
  const resInit: ResponseInit = typeof init === "number" ? { status: init } : init ?? {};
  return NextResponse.json(data, {
    ...resInit,
    headers: { ...(resInit.headers || {}), ...NO_STORE_HEADERS },
  });
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function readClientIp(req: NextRequest): string {
  const direct =
    String(req.headers.get("cf-connecting-ip") || "").trim() ||
    String(req.headers.get("true-client-ip") || "").trim() ||
    String(req.headers.get("x-real-ip") || "").trim();
  if (direct) return direct;
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return String(forwarded.split(",")[0] || "").trim();
}

type CreateAccessRequestBody = {
  targetWorkspaceId?: unknown;
  targetOwnerUsername?: unknown;
  targetOwnerProfileUrl?: unknown;
};

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    await requireAccountRole(session, ["OWNER", "ADMIN"]);

    const status = s(new URL(req.url).searchParams.get("status"));

    const requests = await listWorkspaceAccessRequests({
      accountId: session.accountId,
      operatorUserId: session.sub,
      status,
    });

    return json({ ok: true, requests: requests || [] }, 200);
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    if (isWorkspaceAccessRequestSchemaMismatch(error)) {
      return json({ ok: true, degraded: true, requests: [] }, 200);
    }
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!hasRequestIntegrityHeader(req)) {
      return json(
        { ok: false, error: "BAD_CSRF", message: "Missing request integrity token." },
        403,
      );
    }

    const session = await requireSession(req);
    requireUser(session);

    const rate = consumeInMemoryRateLimit({
      key: `workspace-access-request:${session.sub}`,
      limit: 20,
      windowMs: 60_000,
    });

    if (!rate.allowed) {
      return json(
        { ok: false, error: "RATE_LIMITED", message: "Too many access requests. Please try again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rate.retryAfterSec),
          },
        }
      );
    }

    const clientIp = readClientIp(req);
    if (clientIp) {
      const ipRate = consumeInMemoryRateLimit({
        key: `workspace-access-request:ip:${clientIp}`,
        limit: 80,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return json(
          { ok: false, error: "RATE_LIMITED", message: "Too many access requests from this network. Please try again." },
          {
            status: 429,
            headers: {
              "Retry-After": String(ipRate.retryAfterSec),
            },
          }
        );
      }
    }

    const body = (await readSanitizedJson(req, null)) as CreateAccessRequestBody | null;

    const result = await createWorkspaceAccessRequest({
      requesterUserId: session.sub,
      targetWorkspaceId: s(body?.targetWorkspaceId) || null,
      targetOwnerUsername: s(body?.targetOwnerUsername) || null,
      targetOwnerProfileUrl: s(body?.targetOwnerProfileUrl) || null,
    });

    if (!result.ok) {
      const status =
        result.error === "ALREADY_MEMBER"
          ? 409
          : result.error === "TARGET_NOT_FOUND"
            ? 404
            : 400;
      return json(result, status);
    }

    await auditLogWrite({
      request: req,
      accountId: result.workspace.id,
      operatorUserId: session.sub,
      action: "PROJECT_UPDATED",
      actionLabel: "Workspace access requested",
      targetType: "workspace_access_request",
      targetId: result.request.id,
      targetLabel: result.workspace.name,
      metaJson: {
        deduped: result.deduped,
        targetWorkspaceId: result.workspace.id,
      },
    });

    return json(
      {
        ok: true,
        deduped: result.deduped,
        request: result.request,
        workspace: result.workspace,
      },
      result.deduped ? 200 : 201
    );
  } catch (error) {
    if (isApiAuthError(error)) return json({ ok: false, error: error.code }, error.status);
    if (isWorkspaceAccessRequestSchemaMismatch(error)) {
      return json(
        {
          ok: false,
          error: "FEATURE_UNAVAILABLE",
          message: "Workspace access requests are temporarily unavailable.",
        },
        503,
      );
    }
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...NO_STORE_HEADERS, Allow: "GET, POST, OPTIONS" },
  });
}
