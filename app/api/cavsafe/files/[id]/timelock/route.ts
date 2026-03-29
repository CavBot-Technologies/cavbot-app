import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  unlockAt?: unknown;
  expireAt?: unknown;
  clear?: unknown;
};

function asDateOrNull(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const ts = Date.parse(String(raw));
  if (!Number.isFinite(ts)) return null;
  return new Date(ts);
}

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as Body | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);

    const clear = Boolean(body.clear);
    const unlockAt = clear ? null : asDateOrNull(body.unlockAt);
    const expireAt = clear ? null : asDateOrNull(body.expireAt);
    if (!clear) {
      if (body.unlockAt != null && !unlockAt) {
        return jsonNoStore({ ok: false, error: "UNLOCK_AT_INVALID", message: "unlockAt must be a valid ISO timestamp." }, 400);
      }
      if (body.expireAt != null && !expireAt) {
        return jsonNoStore({ ok: false, error: "EXPIRE_AT_INVALID", message: "expireAt must be a valid ISO timestamp." }, 400);
      }
      if (unlockAt && expireAt && expireAt.getTime() <= unlockAt.getTime()) {
        return jsonNoStore({ ok: false, error: "TIMELOCK_RANGE_INVALID", message: "expireAt must be later than unlockAt." }, 400);
      }
    }

    const updated = await prisma.cavSafeFile.updateMany({
      where: {
        id: fileId,
        accountId: sess.accountId,
        deletedAt: null,
      },
      data: {
        unlockAt,
        expireAt,
      },
    });
    if (!updated.count) return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);

    const file = await prisma.cavSafeFile.findFirst({
      where: {
        id: fileId,
        accountId: sess.accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
        unlockAt: true,
        expireAt: true,
      },
    });
    if (!file) return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);

    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: file.unlockAt || file.expireAt ? "TIMELOCK_SET" : "TIMELOCK_CLEAR",
      subjectType: "file",
      subjectId: file.id,
      label: file.unlockAt || file.expireAt ? "Time lock updated" : "Time lock cleared",
      meta: {
        path: file.path,
        unlockAtISO: file.unlockAt ? new Date(file.unlockAt).toISOString() : null,
        expireAtISO: file.expireAt ? new Date(file.expireAt).toISOString() : null,
      },
    });

    return jsonNoStore({
      ok: true,
      file: {
        id: file.id,
        path: file.path,
        unlockAtISO: file.unlockAt ? new Date(file.unlockAt).toISOString() : null,
        expireAtISO: file.expireAt ? new Date(file.expireAt).toISOString() : null,
      },
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update time lock.");
  }
}

