import { isApiAuthError } from "@/lib/apiAuth";
import {
  isCavsafePlanSchemaMismatchError,
  requireCavsafeOwnerContext,
  requireCavsafeOwnerSession,
} from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { listGalleryFiles } from "@/lib/cavsafe/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isCavSafeGallerySchemaMismatch(err: unknown) {
  return isCavsafePlanSchemaMismatchError(err) || isSchemaMismatchError(err, {
    tables: ["CavSafeFile", "CavSafeShare"],
    columns: [
      "folderId",
      "name",
      "path",
      "r2Key",
      "bytes",
      "mimeType",
      "sha256",
      "previewSnippet",
      "previewSnippetUpdatedAt",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "fileId",
      "revokedAt",
      "expiresAt",
      "mode",
    ],
    fields: [
      "folderId",
      "name",
      "path",
      "r2Key",
      "bytes",
      "mimeType",
      "sha256",
      "previewSnippet",
      "previewSnippetUpdatedAt",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "fileId",
      "revokedAt",
      "expiresAt",
      "mode",
    ],
  });
}

async function buildDegradedGalleryResponse(req: Request) {
  await requireCavsafeOwnerContext(req);
  return jsonNoStore(
    {
      ok: true,
      degraded: true,
      files: [],
    },
    200,
  );
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const files = await listGalleryFiles({ accountId: sess.accountId });
    return jsonNoStore({ ok: true, files }, 200);
  } catch (err) {
    if (isApiAuthError(err)) {
      return cavsafeErrorResponse(err, "Failed to load gallery.");
    }
    if (isCavSafeGallerySchemaMismatch(err)) {
      try {
        return await buildDegradedGalleryResponse(req);
      } catch (fallbackError) {
        return cavsafeErrorResponse(fallbackError, "Failed to load gallery.");
      }
    }
    try {
      return await buildDegradedGalleryResponse(req);
    } catch {}
    return cavsafeErrorResponse(err, "Failed to load gallery.");
  }
}
