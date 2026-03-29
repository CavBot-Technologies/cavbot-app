import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import {
  CavCodeMountError,
  listProjectMounts,
  normalizeMountSourceType,
  upsertProjectMount,
} from "@/lib/cavcode/mounts.server";
import { assertCavCloudActionAllowed, assertCavCodeProjectAccess } from "@/lib/cavcloud/permissions.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpsertBody = {
  projectId?: unknown;
  folderId?: unknown;
  mountPath?: unknown;
  sourceType?: unknown;
  mode?: unknown;
  priority?: unknown;
};

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

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

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
      needed: "VIEW",
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

    const mounts = await listProjectMounts(sess.accountId, projectId, { includeCavsafe });
    return jsonNoStore({ ok: true, mounts }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to load project mounts.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as UpsertBody | null;
    if (!body) return jsonNoStore({ ok: false, code: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const projectId = parseProjectId(body.projectId);
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

    const sourceType = normalizeMountSourceType(body.sourceType);
    if (sourceType === "CAVSAFE") {
      const plusSess = await requireCavsafePremiumPlusSession(req);
      if (plusSess.accountId !== sess.accountId) {
        return jsonNoStore({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" }, 403);
      }
    }

    const mount = await upsertProjectMount({
      accountId: sess.accountId,
      projectId,
      folderId: String(body.folderId || "").trim(),
      mountPath: String(body.mountPath || "").trim(),
      sourceType,
      mode: String(body.mode || "").trim().toUpperCase() === "READ_WRITE" ? "READ_WRITE" : "READ_ONLY",
      priority: Number(body.priority),
    });

    return jsonNoStore({ ok: true, mount }, 200);
  } catch (err) {
    return handleRouteError(err, "Failed to upsert project mount.");
  }
}
