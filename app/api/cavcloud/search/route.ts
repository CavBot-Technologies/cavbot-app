import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { searchFolderChildren } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const url = new URL(req.url);
    const folderId = String(url.searchParams.get("folderId") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();

    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "folderId is required." }, 400);
    }

    const data = await searchFolderChildren({
      accountId: sess.accountId,
      folderId,
      query: q,
      listing: toCavCloudListingPreferences(
        await getCavCloudSettings({
          accountId: String(sess.accountId || ""),
          userId: String(sess.sub || ""),
        }),
      ),
    });

    return jsonNoStore({ ok: true, ...data }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to search folder.");
  }
}
