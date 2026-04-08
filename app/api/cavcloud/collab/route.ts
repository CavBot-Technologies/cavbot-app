import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, isCavCloudServiceUnavailableError, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listCollabInbox } from "@/lib/cavcloud/userShares.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseFilter(req: Request) {
  const filterRaw = String(new URL(req.url).searchParams.get("filter") || "").trim();
  return filterRaw === "readonly" || filterRaw === "edit" || filterRaw === "expiringSoon"
    ? filterRaw
    : "all";
}

function isCavCloudCollabSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: [
      "CavCloudFileAccess",
      "CavCloudFolderAccess",
      "CavCloudShortcut",
      "CavCloudActivity",
      "CavCloudFile",
      "CavCloudFolder",
      "User",
    ],
    columns: [
      "userId",
      "fileId",
      "folderId",
      "permission",
      "role",
      "expiresAt",
      "deletedAt",
      "grantedByUserId",
      "username",
      "displayName",
      "mimeType",
      "bytes",
      "updatedAt",
      "path",
      "targetType",
      "targetId",
    ],
    fields: ["file", "folder", "grantedByUser"],
  });
}

async function buildDegradedCollabResponse(req: Request, filter: ReturnType<typeof parseFilter>) {
  const sess = await requireSession(req);
  requireUser(sess);
  requireAccountContext(sess);

  return jsonNoStore({
    ok: true,
    degraded: true,
    filter,
    items: [],
    summary: {
      total: 0,
      readonly: 0,
      canEdit: 0,
      expiringSoon: 0,
    },
  }, 200);
}

export async function GET(req: Request) {
  const filter = parseFilter(req);
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const collab = await listCollabInbox({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      filter,
    });

    return jsonNoStore(
      {
        ok: true,
        filter,
        ...collab,
      },
      200,
    );
  } catch (err) {
    if (isCavCloudServiceUnavailableError(err) || isCavCloudCollabSchemaMismatch(err)) {
      return jsonNoStore({
        ok: true,
        degraded: true,
        filter,
        items: [],
        summary: {
          total: 0,
          readonly: 0,
          canEdit: 0,
          expiringSoon: 0,
        },
      }, 200);
    }
    try {
      return await buildDegradedCollabResponse(req, filter);
    } catch {
      // Preserve the original error response if degraded auth/context recovery also fails.
    }
    return cavcloudErrorResponse(err, "Failed to load collaboration inbox.");
  }
}
