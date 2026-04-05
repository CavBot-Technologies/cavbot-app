import { ApiAuthError, requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { getFolderChildrenById, getTreeLite } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function degradedFolderChildrenPayload(folderId: string) {
  const now = new Date().toISOString();
  const rootLike = folderId.toLowerCase() === "root";

  return {
    ok: true,
    degraded: true,
    folder: {
      id: rootLike ? "root" : folderId,
      name: rootLike ? "root" : "folder",
      path: "/",
      parentId: null,
      sharedUserCount: 0,
      collaborationEnabled: false,
      createdAtISO: now,
      updatedAtISO: now,
    },
    breadcrumbs: [{ id: "root", name: "root", path: "/" }],
    folders: [],
    files: [],
  };
}

function buildDegradedFolderChildrenResponse(folderId: string) {
  return jsonNoStore(degradedFolderChildrenPayload(folderId), 200);
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  const folderId = String(ctx?.params?.id || "").trim();

  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    if (!folderId) {
      return jsonNoStore({ ok: false, error: "FOLDER_ID_REQUIRED", message: "Folder id is required." }, 400);
    }

    const listing = toCavCloudListingPreferences(
      await getCavCloudSettings({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
      }),
    );

    const data = folderId.toLowerCase() === "root"
      ? await getTreeLite({
        accountId: sess.accountId,
        folderPath: "/",
        listing,
      })
      : await getFolderChildrenById({
        accountId: sess.accountId,
        folderId,
        listing,
      });

    return jsonNoStore({ ok: true, ...data }, 200);
  } catch (err) {
    if (err instanceof ApiAuthError) {
      return cavcloudErrorResponse(err, "Failed to load folder children.");
    }
    return buildDegradedFolderChildrenResponse(folderId || "root");
  }
}
