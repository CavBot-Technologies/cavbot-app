import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { exportCavPadNote } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ExportBody = {
  target?: unknown;
};

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as ExportBody | null;
    const target = String(body?.target || "cavcloud").trim().toLowerCase();
    if (target !== "cavcloud" && target !== "cavsafe") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "target must be cavcloud or cavsafe." }, 400);
    }

    const result = await exportCavPadNote({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      target,
    });

    return jsonNoStore(result, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to export CavPad note.");
  }
}
