import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getFolderUploadSessionStatus } from "@/lib/cavcloud/storage.server";

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

    const url = new URL(req.url);
    const failedPage = Number(String(url.searchParams.get("failedPage") || "").trim() || "1");
    const failedPageSize = Number(String(url.searchParams.get("failedPageSize") || "").trim() || "100");

    const status = await getFolderUploadSessionStatus({
      accountId: sess.accountId,
      sessionId,
      failedPage,
      failedPageSize,
    });

    return jsonNoStore({ ok: true, ...status }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load folder upload session status.");
  }
}
