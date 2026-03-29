import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { deleteCavPadDirectory, listCavPadDirectories, updateCavPadDirectory } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PatchDirectoryBody = {
  name?: unknown;
  parentId?: unknown;
  pinnedAtISO?: unknown;
};

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const directoryId = String(ctx?.params?.id || "").trim();
    if (!directoryId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "directory id is required." }, 400);
    }

    const body = (await readSanitizedJson(req, null)) as PatchDirectoryBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const directories = await updateCavPadDirectory({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      directoryId,
      name: body.name == null ? undefined : String(body.name || "").trim(),
      parentId: body.parentId === undefined ? undefined : String(body.parentId || "").trim() || null,
      pinnedAtISO: body.pinnedAtISO === undefined ? undefined : String(body.pinnedAtISO || "").trim() || null,
    });

    return jsonNoStore({ ok: true, directories }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update CavPad directory.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const directoryId = String(ctx?.params?.id || "").trim();
    if (!directoryId) {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "directory id is required." }, 400);
    }

    await deleteCavPadDirectory({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      directoryId,
    });

    const directories = await listCavPadDirectories({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });

    return jsonNoStore({ ok: true, directories }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to delete CavPad directory.");
  }
}
