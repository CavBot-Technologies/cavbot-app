import { NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

import { prisma } from "@/lib/prisma";
import { mintCavCloudObjectToken } from "@/lib/cavcloud/tokens.server";
import { buildCavcloudGatewayUrl } from "@/lib/cavcloud/gateway.server";
import { getSession } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function appOrigin(req: Request): string {
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {}
  }
  return new URL(req.url).origin;
}

function normalizePath(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/+/g, "/");
}

function normalizePathNoTrailingSlash(raw: string) {
  const n = normalizePath(raw);
  if (n.length > 1 && n.endsWith("/")) return n.slice(0, -1);
  return n;
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

function artifactExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

async function canAccessShare(req: Request, policyRaw: string | null | undefined, accountId: string | null | undefined) {
  const policy = String(policyRaw || "anyone").trim();
  if (policy === "anyone") return true;
  const session = await getSession(req);
  if (!session || session.systemRole !== "user" || !String(session.sub || "").trim()) return false;
  if (policy === "cavbotUsers") return true;
  if (policy === "workspaceMembers") {
    const shareAccountId = String(accountId || "").trim();
    if (!shareAccountId) return false;
    const member = await prisma.membership.findFirst({
      where: {
        accountId: shareAccountId,
        userId: String(session.sub || "").trim(),
      },
      select: { id: true },
    });
    return !!member;
  }
  return false;
}

export async function GET(req: Request, ctx: { params: { shareId?: string; artifactId?: string } }) {
  try {
    const shareId = String(ctx?.params?.shareId || "").trim();
    const artifactId = String(ctx?.params?.artifactId || "").trim();
    if (!shareId || !artifactId) return notFound();

    const share = await prisma.cavCloudShare.findUnique({
      where: { id: shareId },
      select: {
        id: true,
        accountId: true,
        mode: true,
        accessPolicy: true,
        expiresAt: true,
        revokedAt: true,
        artifact: {
          select: {
            userId: true,
            storageKey: true,
            sourcePath: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!share) return notFound();
    if (share.revokedAt) return notFound();
    if (new Date(share.expiresAt).getTime() <= Date.now()) return notFound();
    if (share.mode !== "READ_ONLY") return notFound();
    if (!(await canAccessShare(req, share.accessPolicy, share.accountId))) return notFound();
    if (artifactExpired(share.artifact?.expiresAt)) return notFound();

    // This route is only for folder shares (shares that resolve to a listing page).
    if (String(share.artifact?.storageKey || "").trim()) return notFound();

    const ownerUserId = String(share.artifact?.userId || "").trim();
    const folderPathRaw = String(share.artifact?.sourcePath || "").trim();
    if (!ownerUserId || !folderPathRaw) return notFound();

    const folderPath = normalizePathNoTrailingSlash(folderPathRaw);
    const prefix = folderPath === "/" ? "/" : `${folderPath}/`;

    const fileArtifact = await prisma.publicArtifact.findFirst({
      where: { id: artifactId, userId: ownerUserId },
      select: {
        id: true,
        sourcePath: true,
        storageKey: true,
        visibility: true,
        publishedAt: true,
        expiresAt: true,
      },
    });
    if (!fileArtifact) return notFound();

    const filePath = typeof fileArtifact.sourcePath === "string" ? normalizePath(fileArtifact.sourcePath) : "";
    if (!filePath || !filePath.startsWith(prefix)) return notFound();

    if (fileArtifact.visibility === "PRIVATE" || !fileArtifact.publishedAt) return notFound();
    if (artifactExpired(fileArtifact.expiresAt)) return notFound();

    const objectKey = String(fileArtifact.storageKey || "").trim();
    if (!objectKey) return notFound();

    const origin = appOrigin(req);
    const token = mintCavCloudObjectToken({ origin, objectKey, ttlSeconds: 600 });
    const target = buildCavcloudGatewayUrl({ objectKey, token });

    noStore();
    const res = NextResponse.redirect(target, 302);
    res.headers.set("Cache-Control", "no-store");
    // Ensure the CavCloud gateway sees an allowlisted Origin via Referer (origin-only on cross-site).
    res.headers.set("Referrer-Policy", "origin");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  } catch {
    return notFound();
  }
}
