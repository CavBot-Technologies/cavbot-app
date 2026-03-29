import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { readSanitizedJson } from "@/lib/security/userInput";
import {
  createDirectUserShares,
  listTargetAccess,
  parseExpiresInDays,
} from "@/lib/cavcloud/userShares.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateDirectShareBody = {
  targetType?: unknown;
  targetId?: unknown;
  recipients?: unknown;
  expiresInDays?: unknown;
};

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const url = new URL(req.url);
    const targetTypeRaw = String(url.searchParams.get("targetType") || "").trim().toLowerCase();
    const targetType = targetTypeRaw === "file" || targetTypeRaw === "folder" ? targetTypeRaw : "";
    const targetId = String(url.searchParams.get("targetId") || "").trim();
    if (!targetType || !targetId) {
      return jsonNoStore(
        { ok: false, error: "BAD_REQUEST", message: "targetType and targetId are required." },
        400,
      );
    }

    const accessList = await listTargetAccess({
      accountId: String(sess.accountId || ""),
      targetType,
      targetId,
    });

    return jsonNoStore({ ok: true, accessList }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to list shared users.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const body = (await readSanitizedJson(req, null)) as CreateDirectShareBody | null;
    if (!body || typeof body !== "object") {
      return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    }

    const recipients = Array.isArray(body.recipients)
      ? body.recipients
          .map((row) => ({
            userId: String((row as { userId?: unknown })?.userId || "").trim(),
            permission: String((row as { permission?: unknown })?.permission || "").trim().toUpperCase(),
          }))
          .filter((row) => row.userId && (row.permission === "VIEW" || row.permission === "EDIT"))
      : [];

    if (!recipients.length) {
      return jsonNoStore(
        { ok: false, error: "BAD_REQUEST", message: "At least one recipient is required." },
        400,
      );
    }

    const created = await createDirectUserShares({
      accountId: String(sess.accountId || ""),
      operatorUserId: String(sess.sub || ""),
      targetType: String(body.targetType || "").trim().toLowerCase() as "file" | "folder",
      targetId: String(body.targetId || "").trim(),
      recipients: recipients.map((row) => ({
        userId: row.userId,
        permission: row.permission as "VIEW" | "EDIT",
      })),
      expiresInDays: parseExpiresInDays(body.expiresInDays, 0),
    });

    return jsonNoStore({ ok: true, ...created }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to share with user.");
  }
}
