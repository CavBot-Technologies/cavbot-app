import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, init?: { status?: number }) {
  noStore();
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);

    const accountId = String(sess.accountId || "").trim();
    const userId = String(sess.sub || "").trim();
    const shareId = String(ctx?.params?.id || "").trim();

    if (!shareId) return jsonNoStore({ ok: false, message: "id is required." }, { status: 400 });

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      errorCode: "UNAUTHORIZED",
    });

    const share = await prisma.cavCloudStorageShare.findFirst({
      where: {
        id: shareId,
        accountId,
        createdByUserId: userId,
        revokedAt: null,
      },
      select: {
        id: true,
        fileId: true,
        folderId: true,
        file: {
          select: {
            path: true,
          },
        },
        folder: {
          select: {
            path: true,
          },
        },
      },
    });
    if (!share) return jsonNoStore({ ok: false, message: "Share not found." }, { status: 404 });

    const updated = await prisma.cavCloudStorageShare.updateMany({
      where: {
        id: share.id,
        accountId,
        createdByUserId: userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
    if (!updated.count) return jsonNoStore({ ok: false, message: "Share not found." }, { status: 404 });

    try {
      await prisma.cavCloudActivity.create({
        data: {
          accountId,
          operatorUserId: userId,
          action: "share.revoke",
          targetType: share.fileId ? "file" : "folder",
          targetId: share.fileId || share.folderId || null,
          targetPath: share.file?.path || share.folder?.path || null,
          metaJson: { shareId },
        },
      });
    } catch {
      // Non-blocking.
    }
    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "SHARE_REVOKED",
      subjectType: "share",
      subjectId: shareId,
      label: share.file?.path || share.folder?.path || share.fileId || share.folderId || shareId,
      meta: {
        shareId,
        fileId: share.fileId,
        folderId: share.folderId,
      },
    });

    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    return jsonNoStore({ ok: false, message: "Failed to revoke share." }, { status: 500 });
  }
}
