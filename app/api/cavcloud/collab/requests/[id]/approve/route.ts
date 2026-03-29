import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { approveCollabAccessRequest } from "@/lib/cavcloud/collab.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const requestId = String(ctx?.params?.id || "").trim();
    if (!requestId) {
      return jsonNoStore({ ok: false, error: "REQUEST_ID_REQUIRED", message: "request id is required." }, 400);
    }

    const request = await approveCollabAccessRequest({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      requestId,
    });

    return jsonNoStore({ ok: true, request }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to approve collaboration request.");
  }
}
