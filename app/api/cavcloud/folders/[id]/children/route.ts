import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { getFolderChildrenById } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const folderId = String(ctx?.params?.id || "").trim();
    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);
    }

    const data = await getFolderChildrenById({
      accountId: sess.accountId,
      folderId,
      listing: toCavCloudListingPreferences(
        await getCavCloudSettings({
          accountId: String(sess.accountId || ""),
          userId: String(sess.sub || ""),
        }),
      ),
    });

    return jsonNoStore({ ok: true, ...data }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load folder children.");
  }
}
