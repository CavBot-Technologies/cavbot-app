import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { createFolder } from "@/lib/cavcloud/storage.server";
import { isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateFolderBody = {
  name?: unknown;
  parentId?: unknown;
  parentPath?: unknown;
};

function isCavCloudFolderWriteSchemaMismatch(err: unknown) {
  return isSchemaMismatchError(err, {
    tables: ["CavCloudFolder", "CavCloudFile", "CavCloudActivity"],
    columns: [
      "accountId",
      "parentId",
      "name",
      "path",
      "deletedAt",
      "folderId",
      "relPath",
      "action",
      "targetType",
      "targetId",
      "targetPath",
      "metaJson",
    ],
  });
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const body = (await readSanitizedJson(req, null)) as CreateFolderBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "CREATE_FOLDER",
      errorCode: "UNAUTHORIZED",
    });

    const folder = await createFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      name: String(body.name || "").trim(),
      parentId: body.parentId == null ? null : String(body.parentId || "").trim() || null,
      parentPath: body.parentPath == null ? null : String(body.parentPath || "").trim() || null,
    });

    return jsonNoStore({ ok: true, folder }, 200);
  } catch (err) {
    if (isCavCloudFolderWriteSchemaMismatch(err)) {
      return jsonNoStore(
        { ok: false, error: "SERVICE_UNAVAILABLE", message: "CavCloud is temporarily unavailable." },
        503,
      );
    }
    return cavcloudErrorResponse(err, "Failed to create folder.");
  }
}
