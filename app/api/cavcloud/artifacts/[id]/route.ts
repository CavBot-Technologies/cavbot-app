import { NextResponse } from "next/server";
import { revalidatePath, unstable_noStore as noStore } from "next/cache";

import { auditLogWrite } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { notifyCavCloudArtifactPublishedState } from "@/lib/cavcloud/notifications.server";
import { writeCavCloudOperationLog } from "@/lib/cavcloud/operationLog.server";
import { assertCavCloudActionAllowed } from "@/lib/cavcloud/permissions.server";
import { hasRequestIntegrityHeader } from "@/lib/security/requestIntegrity";
import { consumeInMemoryRateLimit } from "@/lib/serverRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonNoStore<T>(body: T, status = 200) {
  noStore();
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function readClientIp(req: Request): string {
  const direct =
    String(req.headers.get("cf-connecting-ip") || "").trim() ||
    String(req.headers.get("true-client-ip") || "").trim() ||
    String(req.headers.get("x-real-ip") || "").trim();
  if (direct) return direct;
  const forwarded = String(req.headers.get("x-forwarded-for") || "").trim();
  if (!forwarded) return "";
  return String(forwarded.split(",")[0] || "").trim();
}

export async function DELETE(_req: Request, ctx: { params: { id?: string } }) {
  try {
    if (!hasRequestIntegrityHeader(_req)) {
      return jsonNoStore({ ok: false, error: "BAD_CSRF", message: "Missing request integrity token." }, 403);
    }

    const sess = await requireSession(_req);
    requireUser(sess);
    requireAccountContext(sess);

    const artifactId = String(ctx?.params?.id || "").trim();
    if (!artifactId) return jsonNoStore({ ok: false, message: "artifact id is required." }, 400);

    const userId = String(sess.sub || "").trim();
    const accountId = String(sess.accountId || "").trim();

    const userRate = consumeInMemoryRateLimit({
      key: `artifact-unpublish:user:${userId}`,
      limit: 40,
      windowMs: 60_000,
    });
    if (!userRate.allowed) {
      return jsonNoStore(
        { ok: false, error: "RATE_LIMITED", message: "Too many unpublish requests. Please retry shortly." },
        429
      );
    }
    const ip = readClientIp(_req);
    if (ip) {
      const ipRate = consumeInMemoryRateLimit({
        key: `artifact-unpublish:ip:${ip}`,
        limit: 120,
        windowMs: 60_000,
      });
      if (!ipRate.allowed) {
        return jsonNoStore(
          { ok: false, error: "RATE_LIMITED", message: "Too many unpublish requests from this network." },
          429
        );
      }
    }

    await assertCavCloudActionAllowed({
      accountId,
      userId,
      action: "PUBLISH_ARTIFACT",
      errorCode: "UNAUTHORIZED",
    });

    const artifact = await prisma.publicArtifact.findFirst({
      where: {
        id: artifactId,
        userId,
      },
      select: {
        id: true,
        sourcePath: true,
      },
    });
    if (!artifact) return jsonNoStore({ ok: false, message: "Artifact not found." }, 404);

    await prisma.publicArtifact.update({
      where: { id: artifact.id },
      data: {
        visibility: "PRIVATE",
        publishedAt: null,
      },
    });

    try {
      await prisma.cavCloudActivity.create({
        data: {
          accountId,
          operatorUserId: userId,
          action: "artifact.unpublish",
          targetType: "artifact",
          targetId: artifact.id,
          targetPath: artifact.sourcePath || null,
        },
      });
    } catch {
      // Non-blocking.
    }

    await writeCavCloudOperationLog({
      accountId,
      operatorUserId: userId,
      kind: "UNPUBLISHED_ARTIFACT",
      subjectType: "artifact",
      subjectId: artifact.id,
      label: String(artifact.sourcePath || artifact.id),
      meta: {
        visibility: "PRIVATE",
      },
    });

    await auditLogWrite({
      request: _req,
      accountId,
      operatorUserId: userId,
      action: "PROJECT_UPDATED",
      actionLabel: "Artifact unpublished",
      targetType: "artifact",
      targetId: artifact.id,
      targetLabel: String(artifact.sourcePath || artifact.id),
      metaJson: {
        source: "api/cavcloud/artifacts/[id]",
        visibility: "PRIVATE",
      },
    });

    try {
      await notifyCavCloudArtifactPublishedState({
        accountId,
        userId,
        published: false,
        artifactLabel: artifact.sourcePath || artifact.id,
        visibility: "PRIVATE",
        href: "/cavcloud",
      });
    } catch {
      // Non-blocking notification write.
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      const username = String(user?.username || "").trim();
      if (username) {
        revalidatePath(`/u/${username}`);
        revalidatePath(`/${username}`);
      }
    } catch {
      // Best-effort.
    }

    return jsonNoStore({ ok: true }, 200);
  } catch (e: unknown) {
    const err = e as { status?: unknown };
    const status = typeof err?.status === "number" ? err.status : 500;
    if (status === 401 || status === 403) return jsonNoStore({ ok: false, message: "Unauthorized." }, status);
    return jsonNoStore({ ok: false, message: "Failed to unpublish artifact." }, 500);
  }
}
