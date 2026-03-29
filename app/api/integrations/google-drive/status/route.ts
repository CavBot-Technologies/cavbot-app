import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getGoogleDriveConnectionStatus } from "@/lib/integrations/googleDrive.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const status = await getGoogleDriveConnectionStatus({
      accountId: session.accountId,
      userId: session.sub,
    });

    return jsonNoStore({
      ok: true,
      connected: status.connected,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to load Google Drive connection status.");
  }
}
