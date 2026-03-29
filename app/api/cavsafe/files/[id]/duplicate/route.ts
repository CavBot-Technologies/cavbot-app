import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { duplicateFile } from "@/lib/cavsafe/storage.server";
import { requireCavSafeAccess, requireUserSession } from "@/lib/security/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireUserSession(req);

    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) {
      return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "File id is required." }, 400);
    }

    const access = await requireCavSafeAccess({
      accountId: sess.accountId,
      userId: sess.sub,
      itemId: fileId,
      minRole: "EDITOR",
      onDenied: 403,
    });
    if (access.item.kind !== "file" || !access.item.fileId) {
      return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);
    }

    const file = await duplicateFile({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId: access.item.fileId,
    });

    return jsonNoStore({ ok: true, file }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to duplicate file.");
  }
}
