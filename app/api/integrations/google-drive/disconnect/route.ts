import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { disconnectGoogleDrive } from "@/lib/integrations/googleDrive.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const result = await disconnectGoogleDrive({
      accountId: session.accountId,
      userId: session.sub,
    });

    return jsonNoStore({
      ok: true,
      disconnected: result.disconnected,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to disconnect Google Drive.");
  }
}
