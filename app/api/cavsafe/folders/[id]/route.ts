import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { softDeleteFolder, updateFolder } from "@/lib/cavsafe/storage.server";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";
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
    const sess = await requireUserSession(req);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: folderId,
      minRole: "EDITOR",
      onDenied: 403,
    });
    if (access.item.kind !== "folder" || !access.item.folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_NOT_FOUND", message: "Folder not found." }, 404);
    }

    const body = (await readSanitizedJson(req, null)) as UpdateFolderBody | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const folder = await updateFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: access.item.folderId,
      name: body.name == null ? undefined : String(body.name || "").trim(),
      parentId: body.parentId === undefined ? undefined : body.parentId == null ? null : String(body.parentId || "").trim(),
    });

    return jsonNoStore({ ok: true, folder }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update folder.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: folderId,
      minRole: "OWNER",
      onDenied: 403,
    });
    if (access.item.kind !== "folder" || !access.item.folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_NOT_FOUND", message: "Folder not found." }, 404);
    }

    await softDeleteFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: access.item.folderId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to delete folder.");
  }
}
