import { isApiAuthError } from "@/lib/apiAuth";
import {
  isCavsafePlanSchemaMismatchError,
  requireCavsafeOwnerContext,
  requireCavsafeOwnerSession,
} from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { getRootFolder } from "@/lib/cavsafe/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isMissingCavSafeTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavsafe")) return true;
  if (msg.includes("relation") && msg.includes("cavsafe")) return true;
  return false;
}

function isCavSafeRootSchemaMismatch(err: unknown) {
  return isCavsafePlanSchemaMismatchError(err) || isSchemaMismatchError(err, {
    tables: ["CavSafeFolder", "CavSafeShare"],
    columns: [
      "path",
      "name",
      "parentId",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "folderId",
      "fileId",
      "revokedAt",
      "expiresAt",
      "mode",
    ],
  });
}

function degradedRootPayload() {
  const now = new Date().toISOString();
  const root = { id: "root", name: "root", path: "/", parentId: null, createdAtISO: now, updatedAtISO: now };
  return {
    ok: true,
    degraded: true,
    rootFolderId: root.id,
    root,
    defaultFolder: root,
  };
}

async function buildDegradedRootResponse(req: Request) {
  await requireCavsafeOwnerContext(req);
  return jsonNoStore(degradedRootPayload(), 200);
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

    const root = await getRootFolder({
      accountId: sess.accountId,
    });

    return jsonNoStore({
      ok: true,
      rootFolderId: root.id,
      root,
      defaultFolder: root,
    }, 200);
  } catch (err) {
    if (isApiAuthError(err)) {
      return cavsafeErrorResponse(err, "Failed to load CavSafe root.");
    }
    if (isMissingCavSafeTablesError(err) || isCavSafeRootSchemaMismatch(err)) {
      try {
        return await buildDegradedRootResponse(req);
      } catch (fallbackError) {
        return cavsafeErrorResponse(fallbackError, "Failed to load CavSafe root.");
      }
    }
    try {
      return await buildDegradedRootResponse(req);
    } catch {}
    return cavsafeErrorResponse(err, "Failed to load CavSafe root.");
  }
}
