import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { restoreCavPadNoteVersion } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RestoreBody = {
  baseSha256?: unknown;
};

export async function POST(req: Request, ctx: { params: { id?: string; versionId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    const versionId = String(ctx?.params?.versionId || "").trim();
    if (!noteId || !versionId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id and version id are required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as RestoreBody | null;

    const note = await restoreCavPadNoteVersion({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      versionId,
      baseSha256: body?.baseSha256 == null ? undefined : String(body.baseSha256 || "").trim(),
    });

    return jsonNoStore({ ok: true, note }, 200);
  } catch (err) {
    if ((err as { code?: unknown })?.code === "FILE_EDIT_CONFLICT") {
      const conflict = err as { latestSha256?: unknown; latestVersionNumber?: unknown; message?: unknown };
      return jsonNoStore({
        ok: false,
        error: "FILE_EDIT_CONFLICT",
        message: String(conflict.message || "File changed since your last read."),
        latest: {
          sha256: String(conflict.latestSha256 || "") || null,
          versionNumber: Number(conflict.latestVersionNumber || 0) || null,
        },
      }, 409);
    }
    return cavcloudErrorResponse(err, "Failed to restore CavPad note version.");
  }
}
