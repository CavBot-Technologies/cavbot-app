import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getGoogleDriveImportSessionStatus } from "@/lib/integrations/googleDriveImport.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { sessionId?: string } }) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }

    const url = new URL(req.url);
    const failedPage = Number(url.searchParams.get("failedPage") || "1");
    const failedPageSize = Number(url.searchParams.get("failedPageSize") || "50");

    const payload = await getGoogleDriveImportSessionStatus({
      accountId: session.accountId,
      userId: session.sub,
      sessionId,
      failedPage,
      failedPageSize,
    });

    return jsonNoStore({
      ok: true,
      ...payload,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to load Google Drive import session status.");
  }
}
