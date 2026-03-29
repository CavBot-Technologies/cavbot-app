import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { getFolderChildrenById } from "@/lib/cavsafe/storage.server";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);
    }
    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: folderId,
      minRole: "VIEWER",
      onDenied: 404,
    });
    if (access.item.kind !== "folder" || !access.item.folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_NOT_FOUND", message: "Folder not found." }, 404);
    }

    const data = await getFolderChildrenById({
      accountId: sess.accountId,
      folderId: access.item.folderId,
    });

    return jsonNoStore({ ok: true, ...data }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load folder children.");
  }
}
