import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { prisma } from "@/lib/prisma";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  locked?: unknown;
};

export async function PATCH(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const fileId = String(ctx?.params?.id || "").trim();
    if (!fileId) return jsonNoStore({ ok: false, error: "FILE_ID_REQUIRED", message: "file id is required." }, 400);

    const body = (await readSanitizedJson(req, null)) as Body | null;
    if (!body) return jsonNoStore({ ok: false, error: "BAD_REQUEST", message: "Invalid JSON body." }, 400);
    const locked = Boolean(body.locked);
    const immutableAt = locked ? new Date() : null;

    const file = await prisma.cavSafeFile.updateMany({
      where: {
        id: fileId,
        accountId: sess.accountId,
        deletedAt: null,
      },
      data: {
        immutableAt,
      },
    });
    if (!file.count) return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);

    const refreshed = await prisma.cavSafeFile.findFirst({
      where: {
        id: fileId,
        accountId: sess.accountId,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
        immutableAt: true,
      },
    });
    if (!refreshed) return jsonNoStore({ ok: false, error: "FILE_NOT_FOUND", message: "File not found." }, 404);

    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: locked ? "IMMUTABLE_SET" : "IMMUTABLE_CLEAR",
      subjectType: "file",
      subjectId: refreshed.id,
      label: locked ? "Integrity lock enabled" : "Integrity lock cleared",
      meta: {
        path: refreshed.path,
      },
    });

    return jsonNoStore({
      ok: true,
      file: {
        id: refreshed.id,
        path: refreshed.path,
        immutableAtISO: refreshed.immutableAt ? new Date(refreshed.immutableAt).toISOString() : null,
      },
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to update integrity lock.");
  }
}

