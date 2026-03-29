import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listGalleryFiles } from "@/lib/cavcloud/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const files = await listGalleryFiles({ accountId: sess.accountId });
    return jsonNoStore({ ok: true, files }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load gallery.");
  }
}
