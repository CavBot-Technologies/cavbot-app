import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudBulkDeletePurge } from "@/lib/cavcloud/notifications.server";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { softDeleteFolder, updateFolder } from "@/lib/cavcloud/storage.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpdateFolderBody = {
  name?: unknown;
  parentId?: unknown;
};

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as UpdateFolderBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "RENAME_MOVE_FOLDER",
      resourceType: "FOLDER",
      resourceId: folderId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const folder = await updateFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
      name: body.name == null ? undefined : String(body.name || "").trim(),
      parentId: body.parentId === undefined ? undefined : body.parentId == null ? null : String(body.parentId || "").trim(),
    });

    return jsonNoStore({ ok: true, folder }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update folder.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  let accountId = "";
  let userId = "";
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);
    accountId = String(sess.accountId || "").trim();
    userId = String(sess.sub || "").trim();

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);

    await assertCavCloudActionAllowed({
      accountId: sess.accountId,
      userId: sess.sub,
      action: "DELETE_TO_TRASH",
      resourceType: "FOLDER",
      resourceId: folderId,
      neededPermission: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const deleted = await softDeleteFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId,
    });

    if (accountId && userId) {
      try {
        await notifyCavCloudBulkDeletePurge({
          accountId,
          userId,
          removedFiles: deleted.removedFiles,
          removedFolders: deleted.removedFolders,
          reason: "delete_to_trash",
          href: "/cavcloud",
        });
      } catch {
        // Non-blocking notification write.
      }
    }

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to delete folder.");
  }
}
