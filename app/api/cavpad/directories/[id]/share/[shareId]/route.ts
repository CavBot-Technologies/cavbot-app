import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { revokeCavPadDirectoryShare, updateCavPadDirectoryShare } from "@/lib/cavpad/server";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PatchShareBody = {
  permission?: unknown;
  expiresInDays?: unknown;
};

export async function PATCH(req: Request, ctx: { params: { id?: string; shareId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const directoryId = String(ctx?.params?.id || "").trim();
    const shareId = String(ctx?.params?.shareId || "").trim();
    if (!directoryId || !shareId) {
      return jsonNoStore(
        { ok: false, error: "BAD_REQUEST", message: "directory id and share id are required." },
        400,
      );
    }

    const body = (await readSanitizedJson(req, null)) as PatchShareBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const permissionRaw = String(body.permission || "").trim().toUpperCase();
    const permission = permissionRaw === "EDIT" || permissionRaw === "VIEW"
      ? (permissionRaw as "EDIT" | "VIEW")
      : undefined;
    const expiresInDays = body.expiresInDays == null ? undefined : body.expiresInDays;
    if (!permission && expiresInDays == null) {
      return jsonNoStore(
        { ok: false, error: "BAD_REQUEST", message: "permission or expiresInDays is required." },
        400,
      );
    }

    const updated = await updateCavPadDirectoryShare({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      directoryId,
      shareId,
      permission,
      expiresInDays,
    });

    return jsonNoStore(updated, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to update CavPad folder share.");
  }
}

export async function DELETE(req: Request, ctx: { params: { id?: string; shareId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const directoryId = String(ctx?.params?.id || "").trim();
    const shareId = String(ctx?.params?.shareId || "").trim();
    if (!directoryId || !shareId) {
      return jsonNoStore(
        { ok: false, error: "BAD_REQUEST", message: "directory id and share id are required." },
        400,
      );
    }

    const removed = await revokeCavPadDirectoryShare({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
      directoryId,
      shareId,
    });

    return jsonNoStore(removed, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to revoke CavPad folder share.");
  }
}
