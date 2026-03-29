import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/apiAuth";
import { getPublicArtifactViewCountsByPath } from "@/lib/publicProfile/publicArtifactViews.server";
import { prisma } from "@/lib/prisma";
import { isBasicUsername, isReservedUsername, normalizeUsername, RESERVED_ROUTE_SLUGS } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const OWNER_USERNAME = normalizeUsername(process.env.CAVBOT_OWNER_USERNAME || "");

function json<T>(body: T, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie",
    },
  });
}

function isUnsafeSlug(raw: string) {
  const v = String(raw || "").trim();
  if (!v) return true;
  if (v.includes(".") || v.includes("/") || v.includes("\\")) return true;
  return false;
}

function normalizePath(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed || "/";
}

type ArtifactKind = "folder" | "document" | "data" | "archive" | "media" | "file";

function artifactKindFromType(type: string, title: string): ArtifactKind {
  const s = `${String(type || "").toLowerCase()} ${String(title || "").toLowerCase()}`;
  if (s.includes("folder") || s.includes("directory")) return "folder";
  if (/(pdf|doc|docx|md|markdown|txt)/.test(s)) return "document";
  if (/(csv|tsv|json|xlsx|xls|dataset|report)/.test(s)) return "data";
  if (/(zip|tar|gz|rar|7z|bundle|archive)/.test(s)) return "archive";
  if (/(png|jpg|jpeg|webp|svg|gif|mp4|mov|mp3|wav|video|image|media)/.test(s)) return "media";
  return "file";
}

function artifactSummaryFromKind(kind: ArtifactKind) {
  if (kind === "folder") return "Published folder";
  if (kind === "document") return "Published document";
  if (kind === "data") return "Published dataset";
  if (kind === "archive") return "Published archive";
  if (kind === "media") return "Published media asset";
  return "Published file";
}

export async function GET(req: NextRequest) {
  try {
    const usernameRaw = String(req.nextUrl.searchParams.get("username") || "").trim();
    if (isUnsafeSlug(usernameRaw)) return json({ ok: true, items: [] }, 200);

    const username = normalizeUsername(usernameRaw);
    if (!username) return json({ ok: true, items: [] }, 200);
    if (!isBasicUsername(username)) return json({ ok: true, items: [] }, 200);
    if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(username)) return json({ ok: true, items: [] }, 200);
    if (isReservedUsername(username) && (!OWNER_USERNAME || username !== OWNER_USERNAME)) {
      return json({ ok: true, items: [] }, 200);
    }

    const user = await prisma.user
      .findUnique({
        where: { username },
        select: {
          id: true,
          username: true,
          publicProfileEnabled: true,
          publicShowArtifacts: true,
        },
      })
      .catch(() => null);
    if (!user?.id) return json({ ok: true, items: [] }, 200);

    const sess = await getSession(req).catch(() => null);
    const viewerUserId = sess && sess.systemRole === "user" ? String(sess.sub || "").trim() : "";
    const isOwner = Boolean(viewerUserId) && viewerUserId === user.id;
    const isVisible = Boolean(user.publicProfileEnabled) && Boolean(user.publicShowArtifacts);
    if (!isOwner && !isVisible) return json({ ok: true, items: [] }, 200);

    const rows = await prisma.publicArtifact
      .findMany({
        where: {
          userId: user.id,
          visibility: "PUBLIC_PROFILE",
          publishedAt: { not: null },
        },
        orderBy: { publishedAt: "desc" },
        take: 12,
        select: {
          id: true,
          displayTitle: true,
          type: true,
          sourcePath: true,
          publishedAt: true,
        },
      })
      .catch(() => []);

    const viewCounts = new Map<string, number>();
    for (const row of rows) {
      const artifactId = String(row.id || "").trim();
      if (!artifactId) continue;
      const sourcePath = normalizePath(String(row.sourcePath || "").trim() || "/");
      const counts = await getPublicArtifactViewCountsByPath({
        artifactId,
        itemPaths: [sourcePath],
      }).catch(() => new Map<string, number>());
      viewCounts.set(artifactId, Math.max(0, Math.trunc(Number(counts.get(sourcePath) || 0))));
    }

    const items = rows.map((row) => {
      const id = String(row.id || "").trim();
      const title = String(row.displayTitle || "").trim().slice(0, 140) || "Artifact";
      const type = String(row.type || "").trim().slice(0, 32) || "Artifact";
      const kind = artifactKindFromType(type, title);
      return {
        id,
        title,
        type,
        publishedAtISO: row.publishedAt ? new Date(row.publishedAt).toISOString() : new Date().toISOString(),
        viewCount: Math.max(0, Math.trunc(Number(viewCounts.get(id) || 0))),
        href: `/p/${encodeURIComponent(String(user.username || username))}/artifact/${encodeURIComponent(id)}`,
        kind,
        summary: artifactSummaryFromKind(kind),
        isPreview: false,
        previewSrc: null,
        previewPath: null,
        previewMimeType: null,
        previewKind: null,
      };
    });

    return json({ ok: true, items }, 200);
  } catch {
    return json({ ok: false, items: [] }, 500);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie",
      Allow: "GET, OPTIONS",
    },
  });
}
