import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { restoreCavPadNote } from "@/lib/cavpad/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const note = await restoreCavPadNote({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
    });

    return jsonNoStore({ ok: true, note }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to restore CavPad note.");
  }
}
