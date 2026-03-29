import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RangeToken = "24h" | "7d";

function parseRange(raw: string | null): RangeToken {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "7d") return "7d";
  return "24h";
}

function rangeStart(range: RangeToken): Date {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  return new Date(now - 24 * 60 * 60 * 1000);
}

function toSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function fileTypeGroup(args: { name: string; mimeType: string }): "code" | "image" | "video" | "other" {
  const mime = String(args.mimeType || "").toLowerCase();
  const name = String(args.name || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.includes("json")
    || mime.includes("javascript")
    || mime.includes("typescript")
    || mime.includes("xml")
    || mime.includes("yaml")
    || mime.includes("x-sh")
    || ["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "txt", "yml", "yaml", "xml", "css", "scss", "html", "htm", "py", "go", "rs", "java", "c", "cpp", "hpp", "h", "sh"].includes(ext)
  ) {
    return "code";
  }
  return "other";
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const url = new URL(req.url);
    const range = parseRange(url.searchParams.get("range"));
    const since = rangeStart(range);

    const [
      totalAgg,
      files,
      immutableCount,
      topFolderAgg,
      pulse24h,
      pulse7d,
      recentEvents,
      deniedCount,
      shareAttemptCount,
      deniedEvents,
    ] = await Promise.all([
      prisma.cavSafeFile.aggregate({
        where: { accountId: sess.accountId, deletedAt: null },
        _sum: { bytes: true },
      }),
      prisma.cavSafeFile.findMany({
        where: { accountId: sess.accountId, deletedAt: null },
        select: {
          id: true,
          folderId: true,
          name: true,
          mimeType: true,
          bytes: true,
          sha256: true,
        },
      }),
      prisma.cavSafeFile.count({
        where: { accountId: sess.accountId, deletedAt: null, immutableAt: { not: null } },
      }),
      prisma.cavSafeFile.groupBy({
        by: ["folderId"],
        where: { accountId: sess.accountId, deletedAt: null },
        _sum: { bytes: true },
        orderBy: { _sum: { bytes: "desc" } },
        take: 5,
      }),
      prisma.cavSafeOperationLog.count({
        where: { accountId: sess.accountId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
      prisma.cavSafeOperationLog.count({
        where: { accountId: sess.accountId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.cavSafeOperationLog.findMany({
        where: { accountId: sess.accountId, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          kind: true,
          label: true,
          createdAt: true,
          subjectType: true,
          subjectId: true,
        },
      }),
      prisma.cavSafeOperationLog.count({
        where: { accountId: sess.accountId, kind: "OPEN_DENIED", createdAt: { gte: since } },
      }),
      prisma.cavSafeOperationLog.count({
        where: { accountId: sess.accountId, kind: "SHARE_ATTEMPT", createdAt: { gte: since } },
      }),
      prisma.cavSafeOperationLog.findMany({
        where: {
          accountId: sess.accountId,
          kind: "OPEN_DENIED",
          createdAt: { gte: since },
        },
        select: {
          meta: true,
        },
        take: 500,
      }),
    ]);

    const usageTotal = totalAgg._sum.bytes ?? BigInt(0);

    const breakdown = {
      code: BigInt(0),
      image: BigInt(0),
      video: BigInt(0),
      other: BigInt(0),
    };
    let shaMissingCount = 0;
    for (const file of files) {
      const group = fileTypeGroup({
        name: file.name,
        mimeType: file.mimeType,
      });
      breakdown[group] += file.bytes;
      const sha = String(file.sha256 || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha)) shaMissingCount += 1;
    }

    const folderIds = topFolderAgg.map((row) => row.folderId);
    const folderRows = folderIds.length
      ? await prisma.cavSafeFolder.findMany({
          where: {
            accountId: sess.accountId,
            id: { in: folderIds },
          },
          select: { id: true, path: true, name: true },
        })
      : [];
    const folderById = new Map(folderRows.map((row) => [row.id, row]));
    const topFolders = topFolderAgg.map((row) => {
      const folder = folderById.get(row.folderId);
      const bytes = row._sum.bytes ?? BigInt(0);
      return {
        folderId: row.folderId,
        folderPath: folder?.path || "/",
        folderName: folder?.name || "folder",
        bytes: toSafeNumber(bytes),
        bytesExact: bytes.toString(),
      };
    });

    const timelockDeniedCount = deniedEvents.reduce((count, row) => {
      const code = String((row.meta as { code?: unknown } | null)?.code || "").toUpperCase();
      if (code.includes("TIMELOCK")) return count + 1;
      return count;
    }, 0);

    const riskSummary = {
      level:
        deniedCount + shareAttemptCount >= 8
          ? "high"
          : deniedCount + shareAttemptCount >= 3
            ? "medium"
            : "low",
      openDeniedCount: deniedCount,
      shareAttemptCount,
      timelockDeniedCount,
      note:
        deniedCount + shareAttemptCount >= 8
          ? "Elevated blocked-access activity detected in selected window."
          : deniedCount + shareAttemptCount >= 3
            ? "Moderate blocked-access activity detected in selected window."
            : "No significant blocked-access activity detected in selected window.",
    } as const;

    return jsonNoStore({
      ok: true,
      range,
      totals: {
        bytes: toSafeNumber(usageTotal),
        bytesExact: usageTotal.toString(),
        files: files.length,
      },
      breakdown: {
        code: { bytes: toSafeNumber(breakdown.code), bytesExact: breakdown.code.toString() },
        image: { bytes: toSafeNumber(breakdown.image), bytesExact: breakdown.image.toString() },
        video: { bytes: toSafeNumber(breakdown.video), bytesExact: breakdown.video.toString() },
        other: { bytes: toSafeNumber(breakdown.other), bytesExact: breakdown.other.toString() },
      },
      topFolders,
      integrity: {
        immutableCount,
        sha256MissingCount: shaMissingCount,
      },
      activityPulse: {
        count24h: pulse24h,
        count7d: pulse7d,
        recent: recentEvents.map((row) => ({
          id: row.id,
          kind: row.kind,
          label: row.label,
          subjectType: row.subjectType,
          subjectId: row.subjectId,
          createdAtISO: new Date(row.createdAt).toISOString(),
        })),
      },
      riskSummary,
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to load CavSafe analytics.");
  }
}
