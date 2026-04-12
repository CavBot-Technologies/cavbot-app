import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listGalleryFiles } from "@/lib/cavcloud/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isMissingCavCloudTablesError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  const prismaCode = String(e?.code || "");
  const dbCode = String(e?.meta?.code || "");
  const msg = String(e?.meta?.message || e?.message || "").toLowerCase();

  if (prismaCode === "P2021") return true;
  if (dbCode === "42P01") return true;
  if (msg.includes("does not exist") && msg.includes("cavcloud")) return true;
  if (msg.includes("relation") && msg.includes("cavcloud")) return true;
  return false;
}

function isCavCloudGallerySchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudFile"],
    columns: [
      "folderId",
      "name",
      "path",
      "relPath",
      "r2Key",
      "bytes",
      "mimeType",
      "sha256",
      "previewSnippet",
      "previewSnippetUpdatedAt",
      "status",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    fields: [
      "folderId",
      "name",
      "path",
      "relPath",
      "r2Key",
      "bytes",
      "mimeType",
      "sha256",
      "previewSnippet",
      "previewSnippetUpdatedAt",
      "status",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
  });
}

async function buildDegradedGalleryResponse(req: Request) {
  const sess = await requireSession(req);
  requireAccountContext(sess);
  requireUser(sess);

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
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const files = await listGalleryFiles({ accountId: sess.accountId });
    return jsonNoStore({ ok: true, files }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load gallery.");
    }
    if (isMissingCavCloudTablesError(err) || isCavCloudGallerySchemaMismatch(err)) {
      try {
        return await buildDegradedGalleryResponse(req);
      } catch (fallbackError) {
        return cavcloudErrorResponse(fallbackError, "Failed to load gallery.");
      }
    }
    try {
      return await buildDegradedGalleryResponse(req);
    } catch {}
    return cavcloudErrorResponse(err, "Failed to load gallery.");
  }
}
