import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getGoogleDriveAccessTokenForUser, listGoogleDriveChildren } from "@/lib/integrations/googleDrive.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    requireAccountContext(session);
    requireUser(session);

    const url = new URL(req.url);
    const folderId = String(url.searchParams.get("folderId") || "").trim() || null;
    const pageToken = String(url.searchParams.get("pageToken") || "").trim() || null;
    const pageSize = Number(url.searchParams.get("pageSize") || "100");

    const { accessToken } = await getGoogleDriveAccessTokenForUser({
      accountId: session.accountId,
      userId: session.sub,
    });

    const listed = await listGoogleDriveChildren({
      accessToken,
      folderId,
      pageToken,
      pageSize,
    });

    return jsonNoStore({
      ok: true,
      folderId: folderId || "root",
      pageToken,
      nextPageToken: listed.nextPageToken,
      items: listed.items,
    }, 200);
  } catch (error) {
    return cavcloudErrorResponse(error, "Failed to list Google Drive items.");
  }
}
