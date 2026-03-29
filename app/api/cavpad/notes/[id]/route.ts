import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavPadNote, moveCavPadNoteToTrash, updateCavPadNote } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PatchNoteBody = {
  title?: unknown;
  textContent?: unknown;
  baseSha256?: unknown;
  directoryId?: unknown;
  pinnedAtISO?: unknown;
  scope?: unknown;
  siteId?: unknown;
};

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
    const includeContent = url.searchParams.get("includeContent") !== "0";

    const note = await getCavPadNote({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      includeContent,
    });

    return jsonNoStore({ ok: true, note }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load CavPad note.");
  }
}

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as PatchNoteBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const note = await updateCavPadNote({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
      title: body.title == null ? undefined : String(body.title || "").trim(),
      textContent: body.textContent == null ? undefined : String(body.textContent || ""),
      baseSha256: body.baseSha256 == null ? undefined : String(body.baseSha256 || "").trim(),
      directoryId: body.directoryId === undefined ? undefined : String(body.directoryId || "").trim() || null,
      pinnedAtISO: body.pinnedAtISO === undefined ? undefined : String(body.pinnedAtISO || "").trim() || null,
      scope: body.scope == null
        ? undefined
        : (String(body.scope || "").trim().toLowerCase() === "site" ? "site" : "workspace"),
      siteId: body.siteId == null ? undefined : String(body.siteId || "").trim() || null,
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
    return cavcloudErrorResponse(err, "Failed to update CavPad note.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const noteId = String(ctx?.params?.id || "").trim();
    if (!noteId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "note id is required." }, 400);
    }

    const result = await moveCavPadNoteToTrash({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      noteId,
    });

    return jsonNoStore(result, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to delete CavPad note.");
  }
}
