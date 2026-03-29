import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { CavCodeMountError, deleteProjectMount } from "@/lib/cavcode/mounts.server";
import { assertCavCloudActionAllowed, assertCavCodeProjectAccess } from "@/lib/cavcloud/permissions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function parseProjectId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function handleRouteError(err: unknown, fallbackMessage: string) {
  if (err instanceof CavCodeMountError) {
    return jsonNoStore({ ok: false, code: err.code, message: err.message }, err.status);
  }
  if (err instanceof ApiAuthError) {
    return jsonNoStore({ ok: false, code: err.code, message: err.code }, err.status);
  }

  const status = Number((err as { status?: unknown })?.status || 500);
  if (status === 401 || status === 403) {
    return jsonNoStore({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" }, status);
  }
  return jsonNoStore({ ok: false, code: "INTERNAL", message: fallbackMessage }, 500);
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const mountId = String(ctx?.params?.id || "").trim();
    if (!mountId) {
      return jsonNoStore({ ok: false, code: "MOUNT_ID_REQUIRED", message: "Mount id is required." }, 400);
    }

    const url = new URL(req.url);
    const projectId = parseProjectId(url.searchParams.get("projectId"));
    if (!projectId) {
      return jsonNoStore({ ok: false, code: "PROJECT_ID_REQUIRED", message: "projectId is required." }, 400);
    }

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "MOUNT_CAVCODE",
      errorCode: "UNAUTHORIZED",
    });
    await assertCavCodeProjectAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      projectId,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    let includeCavsafe = false;
    if (sess.memberRole === "OWNER") {
      try {
        const plusSess = await requireCavsafePremiumPlusSession(req);
        includeCavsafe = plusSess.accountId === sess.accountId;
      } catch {
        includeCavsafe = false;
      }
    }

    await deleteProjectMount({
      accountId: sess.accountId,
      projectId,
      mountId,
      includeCavsafe,
    });
    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to delete project mount.");
  }
}
