import { requireCavsafeOwnerSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { abortMultipartSession } from "@/lib/cavsafe/storage.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function DELETE(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireCavsafeOwnerSession(req);
    const uploadId = String(ctx?.params?.id || "").trim();
    if (!uploadId) {
      return jsonNoStore({ ok: false, error: "UPLOAD_ID_REQUIRED", message: "upload id is required." }, 400);
    }

    const url = new URL(req.url);
    const mode = String(url.searchParams.get("mode") || "").trim().toLowerCase();

    if (mode === "forget" || mode === "cleanup") {
      const removed = await prisma.$transaction(async (tx) => {
        await tx.cavSafeMultipartPart.deleteMany({
          where: {
            uploadId,
          },
        });

        const row = await tx.cavSafeMultipartUpload.deleteMany({
          where: {
            id: uploadId,
            accountId: sess.accountId,
            status: { in: ["ABORTED", "EXPIRED"] },
          },
        });
        return row.count;
      });

      if (!removed) {
        return jsonNoStore({ ok: false, error: "UPLOAD_NOT_FOUND", message: "Upload session not found." }, 404);
      }

      return jsonNoStore({ ok: true, removed: true }, 200);
    }

    await abortMultipartSession({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      uploadId,
    });

    return jsonNoStore({ ok: true }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to cancel upload session.");
  }
}
