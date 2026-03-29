import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { listCavPadNoteVersions } from "@/lib/cavpad/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit"));
    const pageRaw = Number(url.searchParams.get("page"));

    const versions = await listCavPadNoteVersions({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 50,
      page: Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1,
    });

    return jsonNoStore({ ok: true, versions }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load CavPad note versions.");
  }
}
