import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { declineDirectUserShare } from "@/lib/cavcloud/userShares.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const shareId = String(ctx?.params?.id || "").trim();
    if (!shareId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "share id is required." }, 400);
    }

    const declined = await declineDirectUserShare({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      shareId,
    });

    return jsonNoStore(declined, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to decline share.");
  }
}
