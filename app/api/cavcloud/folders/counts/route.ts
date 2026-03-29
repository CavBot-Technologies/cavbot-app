import { requireAccountContext, requireSession, requireUser } from "@/lib/apiAuth";
import { cavcloudErrorResponse, jsonNoStore } from "@/lib/cavcloud/http.server";
import { getCavCloudSettings, toCavCloudListingPreferences } from "@/lib/cavcloud/settings.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_FOLDER_IDS = 64;

function parseFolderIds(url: URL): string[] {
  const merged: string[] = [];
  const idsParam = String(url.searchParams.get("ids") || "").trim();
  if (idsParam) {
    for (const token of idsParam.split(",")) merged.push(token);
  }
  for (const token of url.searchParams.getAll("id")) merged.push(token);
  return Array.from(
    new Set(
      merged
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_FOLDER_IDS);
}

export async function GET(req: Request) {
  try {
    const sess = await requireSession(req);
    requireAccountContext(sess);
    requireUser(sess);

    const url = new URL(req.url);
    const folderIds = parseFolderIds(url);
    if (!folderIds.length) {
      return jsonNoStore(
        { ok: false, error: "FOLDER_IDS_REQUIRED", message: "Provide folder ids via ids=... or repeated id params." },
        400,
      );
    }

    const settings = await getCavCloudSettings({
      accountId: String(sess.accountId || ""),
      userId: String(sess.sub || ""),
    });
    const listing = toCavCloudListingPreferences(settings);

    const folders = await prisma.cavCloudFolder.findMany({
      where: {
        accountId: String(sess.accountId || ""),
        id: { in: folderIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    const validFolderIds = folders.map((row) => String(row.id || "").trim()).filter(Boolean);
    if (!validFolderIds.length) return jsonNoStore({ ok: true, counts: {} }, 200);

    const hideDotfiles = listing.showDotfiles !== true;
    const [folderRows, fileRows] = await Promise.all([
      prisma.cavCloudFolder.groupBy({
        by: ["parentId"],
        where: {
          accountId: String(sess.accountId || ""),
          deletedAt: null,
          parentId: { in: validFolderIds },
          ...(hideDotfiles ? { NOT: { name: { startsWith: "." } } } : {}),
        },
        _count: { _all: true },
      }),
      prisma.cavCloudFile.groupBy({
        by: ["folderId"],
        where: {
          accountId: String(sess.accountId || ""),
          deletedAt: null,
          status: "READY",
          folderId: { in: validFolderIds },
          ...(hideDotfiles ? { NOT: { name: { startsWith: "." } } } : {}),
        },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, { folders: number; files: number }> = {};
    for (const id of validFolderIds) counts[id] = { folders: 0, files: 0 };

    for (const row of folderRows) {
      const id = String(row.parentId || "").trim();
      if (!id || !counts[id]) continue;
      counts[id].folders = Math.max(0, Math.trunc(Number(row?._count?._all || 0)) || 0);
    }

    for (const row of fileRows) {
      const id = String(row.folderId || "").trim();
      if (!id || !counts[id]) continue;
      counts[id].files = Math.max(0, Math.trunc(Number(row?._count?._all || 0)) || 0);
    }

    return jsonNoStore({ ok: true, counts }, 200);
  } catch (err) {
    return cavcloudErrorResponse(err, "Failed to load folder counts.");
  }
}
