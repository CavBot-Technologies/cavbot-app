import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { buildCavcloudGatewayUrl } from "@/lib/cavcloud/gateway.server";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { prisma } from "@/lib/prisma";
import { resolvePublicArtifactScope, resolveScopedPath } from "@/lib/publicProfile/publicArtifacts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // fallback
    }
  }
  return new URL(req.url).origin;
}

function notFound() {
  noStore();
  return new NextResponse("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(req: Request, ctx: { params: { id?: string } }) {
  try {
    const artifactId = String(ctx?.params?.id || "").trim();
    const url = new URL(req.url);
    const username = String(url.searchParams.get("username") || "").trim();
    const path = url.searchParams.get("path");
    const download = url.searchParams.get("download") === "1";

    if (!artifactId || !username) return notFound();

    const scope = await resolvePublicArtifactScope({ artifactId, username });
    if (!scope) return notFound();

    let objectKey = "";
    if (scope.type === "FOLDER") {
      if (!scope.rootFolder) return notFound();

      const scopedPath = resolveScopedPath(scope.rootFolder.path, path);
      if (!scopedPath || scopedPath === scope.rootFolder.path) return notFound();

      const file = await prisma.cavCloudFile.findFirst({
        where: {
          accountId: scope.rootFolder.accountId,
          path: scopedPath,
          deletedAt: null,
        },
        select: {
          r2Key: true,
        },
      });
      if (!file?.r2Key) return notFound();
      objectKey = String(file.r2Key).trim();
    } else {
      objectKey = String(scope.storageKey || "").trim();
      if (!objectKey && scope.sourcePath) {
        const file = await prisma.cavCloudFile.findFirst({
          where: {
            path: scope.sourcePath,
            deletedAt: null,
            account: {
              members: {
                some: {
                  userId: scope.ownerUserId,
                },
              },
            },
          },
          select: { r2Key: true },
        });
        objectKey = String(file?.r2Key || "").trim();
      }
      if (!objectKey) return notFound();
    }

    const token = mintCavCloudObjectToken({
      origin: appOrigin(req),
      objectKey,
      ttlSeconds: 300,
    });
    const target = buildCavcloudGatewayUrl({
      objectKey,
      token,
      download,
    });

    noStore();
    const res = NextResponse.redirect(target, 302);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "origin");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  } catch {
    return notFound();
  }
}

