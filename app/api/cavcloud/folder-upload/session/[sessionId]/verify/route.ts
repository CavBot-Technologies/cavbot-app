import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { verifyFolderUploadSession } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { sessionId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "UPLOAD_SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }

    const result = await verifyFolderUploadSession({
      accountId: sess.accountId,
      sessionId,
    });

    return jsonNoStore(result, result.ok ? 200 : 409);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to verify folder upload session.");
  }
}
