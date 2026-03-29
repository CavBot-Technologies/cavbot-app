import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { zipFolder } from "@/lib/cavsafe/storage.server";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
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

    const file = await zipFolder({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      folderId: access.item.folderId,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to zip folder.");
  }
}
