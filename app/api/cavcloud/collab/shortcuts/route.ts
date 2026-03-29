import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  removeCollabShortcut,
  saveCollabShortcut,
} from "@/lib/cavcloud/userShares.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ShortcutBody = {
  targetType?: unknown;
  targetId?: unknown;
  grantId?: unknown;
};

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as ShortcutBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const saved = await saveCollabShortcut({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      targetType: String(body.targetType || "").trim().toLowerCase() as "file" | "folder",
      targetId: String(body.targetId || "").trim(),
      grantId: String(body.grantId || "").trim() || null,
    });

    return jsonNoStore({ ok: true, shortcut: saved }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to save shortcut.");
  }
}

export async function DELETE(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as ShortcutBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const removed = await removeCollabShortcut({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      targetType: String(body.targetType || "").trim().toLowerCase() as "file" | "folder",
      targetId: String(body.targetId || "").trim(),
    });

    return jsonNoStore(removed, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to remove shortcut.");
  }
}
