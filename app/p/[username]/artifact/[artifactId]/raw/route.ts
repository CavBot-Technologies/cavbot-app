import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { buildCavcloudGatewayUrl } from "@/lib/cavcloud/gateway.server";
import { isBasicUsername, normalizeUsername } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // fallthrough
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

export async function GET(req: Request, ctx: { params: { username?: string; artifactId?: string } }) {
  try {
    const username = normalizeUsername(ctx?.params?.username || "");
    const artifactId = String(ctx?.params?.artifactId || "").trim();
    if (!username || !isBasicUsername(username) || !artifactId) return notFound();

    const artifact = await prisma.publicArtifact.findFirst({
      where: {
        id: artifactId,
        visibility: "PUBLIC_PROFILE",
        publishedAt: { not: null },
        user: {
          username,
          publicProfileEnabled: true,
          publicShowArtifacts: true,
        },
      },
      select: {
        storageKey: true,
      },
    });

    const objectKey = String(artifact?.storageKey || "").trim();
    if (!objectKey) return notFound();

    const origin = appOrigin(req);
    const token = mintCavCloudObjectToken({
      origin,
      objectKey,
      ttlSeconds: 300,
    });

    const target = buildCavcloudGatewayUrl({ objectKey, token });

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

