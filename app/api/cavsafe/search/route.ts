import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { searchFolderChildren } from "@/lib/cavsafe/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);

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
    });

    return jsonNoStore({ ok: true, ...data }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to search folder.");
  }
}
