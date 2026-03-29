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
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request, ctx: { params: { shareId?: string } }) {
  try {
    const sess = await requireSession(req);
    requireUser(sess);
    requireAccountContext(sess);
    const userId = String(sess.sub);
    const accountId = String(sess.accountId);

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "SHARE_READ_ONLY",
      errorCode: "UNAUTHORIZED",
    });

    const shareId = String(ctx?.params?.shareId || "").trim();
    if (!shareId) return jsonNoStore({ ok: false, message: "shareId is required." }, { status: 400 });

    const share = await prisma.cavCloudShare.findFirst({
      where: { id: shareId, createdByUserId: userId, revokedAt: null },
      select: {
        id: true,
        artifactId: true,
        artifact: {
          select: {
            sourcePath: true,
            type: true,
          },
        },
      },
    });
    if (!share) return jsonNoStore({ ok: false, message: "Not found." }, { status: 404 });

    const res = await prisma.cavCloudShare.updateMany({
      where: { id: shareId, createdByUserId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (!res.count) return jsonNoStore({ ok: false, message: "Not found." }, { status: 404 });

    try {
      await prisma.cavCloudActivity.create({
        data: {
          accountId,
          operatorUserId: userId,
          action: "share.unshare",
          targetType: share.artifact?.type === "FOLDER" ? "folder" : "file",
          targetId: share.artifactId,
          targetPath: share.artifact?.sourcePath || null,
          metaJson: { shareId },
        },
      });
    } catch {
      // Activity log failure should not block revoke.
    }
    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "SHARE_REVOKED",
      subjectType: "share",
      subjectId: shareId,
      label: share.artifact?.sourcePath || share.artifactId || shareId,
      meta: {
        shareId,
        artifactId: share.artifactId,
      },
    });

    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized" }, { status });
    return jsonNoStore({ ok: false, message: "Revoke failed." }, { status: 500 });
  }
}
