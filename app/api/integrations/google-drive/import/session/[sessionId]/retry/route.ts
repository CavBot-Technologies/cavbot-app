import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { retryGoogleDriveImportItems } from "@/lib/integrations/googleDriveImport.server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RetryBody = {
  itemId?: unknown;
};

export async function POST(req: Request, ctx: { params: { sessionId?: string } }) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const sessionId = String(ctx?.params?.sessionId || "").trim();
    if (!sessionId) {
      return jsonNoStore({ ok: false, error: "SESSION_ID_REQUIRED", message: "sessionId is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as RetryBody | null;
    const itemId = String(body?.itemId || "").trim() || null;

    const retried = await retryGoogleDriveImportItems({
      accountId: session.accountId,
      userId: session.sub,
      sessionId,
      itemId,
    });

    return jsonNoStore({
      ok: true,
      retriedCount: retried.retriedCount,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to retry Google Drive import items.");
  }
}
