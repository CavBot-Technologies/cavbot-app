import "server-only";

import { NextRequest } from "next/server";

import { ApiAuthError, assertWriteOrigin } from "@/lib/apiAuth";
import { adminJson, safeId } from "@/lib/admin/api";
import { readAdminMutationPayload } from "@/lib/admin/hqMutations.server";
import { getUserActionCenterData, performUserAction } from "@/lib/admin/operations.server";
import { hasAdminScope } from "@/lib/admin/permissions";
import { requireAdminAccess } from "@/lib/admin/staff";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequiredScope(action: string) {
  if (
    action === "suspend"
    || action === "restore"
    || action === "revoke"
    || action === "identity_review"
    || action === "reset_recovery"
    || action === "kill_sessions"
  ) {
    return "security.write" as const;
  }
  return "customers.write" as const;
}

export async function GET(req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    await requireAdminAccess(req, { scopes: ["customers.read"] });
    const data = await getUserActionCenterData(params.userId);
    if (!data) return adminJson({ ok: false, error: "USER_NOT_FOUND" }, 404);
    return adminJson({ ok: true, data });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({ ok: false, error: "USER_ACTIONS_READ_FAILED" }, 500);
  }
}

export async function POST(req: NextRequest, { params }: { params: { userId: string } }) {
  try {
    assertWriteOrigin(req);
    const ctx = await requireAdminAccess(req);
    const body = (await readSanitizedJson(req, {})) as Record<string, unknown>;
    const payload = readAdminMutationPayload(body);
    const action = safeId(payload.action || body.action).toLowerCase();
    if (!action) return adminJson({ ok: false, error: "USER_ACTION_REQUIRED" }, 400);

    const requiredScope = getRequiredScope(action);
    if (!hasAdminScope(ctx.staff, requiredScope)) {
      return adminJson({ ok: false, error: "ADMIN_FORBIDDEN" }, 403);
    }

    const input =
      body.input && typeof body.input === "object" && !Array.isArray(body.input)
        ? (body.input as Record<string, unknown>)
        : body;

    const result = await performUserAction({
      actor: {
        staffId: ctx.staff.id,
        userId: ctx.userSession.sub,
      },
      request: req,
      userId: params.userId,
      action,
      payload: {
        ...payload,
        action,
      },
      input,
    });

    return adminJson({ ok: true, action, result });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return adminJson({ ok: false, error: error.code }, error.status);
    }
    return adminJson({
      ok: false,
      error: error instanceof Error ? error.message : "USER_ACTION_FAILED",
    }, 500);
  }
}
