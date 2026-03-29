import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { revokeFileCollaborator } from "@/lib/cavcloud/collab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(req: Request, ctx: { params: { id?: string; userId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const fileId = String(ctx?.params?.id || "").trim();
    const targetUserId = String(ctx?.params?.userId || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);
    if (!targetUserId) {
      return jsonNoStore({ ok: false, error: "USER_ID_REQUIRED", message: "user id is required." }, 400);
    }

    await revokeFileCollaborator({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      fileId,
      targetUserId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to revoke file collaborator.");
  }
}
