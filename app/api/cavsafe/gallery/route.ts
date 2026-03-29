import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { listGalleryFiles } from "@/lib/cavsafe/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const files = await listGalleryFiles({ accountId: sess.accountId });
    return jsonNoStore({ ok: true, files }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load gallery.");
  }
}
