import crypto from "crypto";

import { requireCavsafePremiumPlusSession } from "@/lib/cavsafe/auth.server";
import { buildCavsafeGatewayUrl } from "@/lib/cavsafe/gateway.server";
import { cavsafeErrorResponse, jsonNoStore } from "@/lib/cavsafe/http.server";
import { notifyCavSafeSnapshotCreated } from "@/lib/cavsafe/notifications.server";
import { writeCavSafeOperationLog } from "@/lib/cavsafe/operationLog.server";
import { getCavsafeObjectStream, putCavsafeObject } from "@/lib/cavsafe/r2.server";
import { getRootFolder } from "@/lib/cavsafe/storage.server";
import { mintCavSafeObjectToken } from "@/lib/cavsafe/tokens.server";
import { buildZipBuffer } from "@/lib/cavsafe/zip.server";
import { prisma } from "@/lib/prisma";
import { getAppOrigin } from "@/lib/apiAuth";
import { readSanitizedJson } from "@/lib/security/userInput";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateBody = {
  folderId?: unknown;
  name?: unknown;
};

function normalizeNodeName(raw: unknown, fallback: string): string {
  const clean = String(raw || "")
    .replace(/[\\/\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 220);
  return clean || fallback;
}

function maxSnapshotSourceBytes(): bigint {
  const raw = Number(String(process.env.CAVSAFE_SNAPSHOT_MAX_SOURCE_BYTES || "").trim());
  if (Number.isFinite(raw) && Number.isInteger(raw) && raw > 0) return BigInt(raw);
  return BigInt(512 * 1024 * 1024);
}

async function readObjectBuffer(objectKey: string): Promise<Buffer> {
  const stream = await getCavsafeObjectStream({ objectKey });
  if (!stream) throw new Error("OBJECT_NOT_FOUND");
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = stream.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  return Buffer.concat(chunks, total);
}

function appOrigin(req: Request): string {
  const origin = String(req.headers.get("origin") || "").trim();
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // ignore
    }
  }
  const referer = String(req.headers.get("referer") || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore
    }
  }
  const env = String(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "").trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      // ignore
    }
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return getAppOrigin();
  }
}

export async function GET(req: Request) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20) || 20));

    const rows = await prisma.cavSafeSnapshot.findMany({
      where: {
        accountId: sess.accountId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      select: {
        id: true,
        archiveName: true,
        archiveR2Key: true,
        archiveBytes: true,
        sha256: true,
        rootFolderId: true,
        createdAt: true,
      },
    });

    const origin = appOrigin(req);
    return jsonNoStore({
      ok: true,
      items: rows.map((row) => {
        const token = mintCavSafeObjectToken({
          origin,
          objectKey: row.archiveR2Key,
          ttlSeconds: 300,
        });
        return {
          id: row.id,
          name: row.archiveName,
          bytes: Number(row.archiveBytes),
          bytesExact: row.archiveBytes.toString(),
          sha256: row.sha256,
          rootFolderId: row.rootFolderId,
          createdAtISO: new Date(row.createdAt).toISOString(),
          downloadUrl: buildCavsafeGatewayUrl({
            objectKey: row.archiveR2Key,
            token,
            download: true,
          }),
        };
      }),
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to list CavSafe snapshots.");
  }
}

export async function POST(req: Request) {
  try {
    const sess = await requireCavsafePremiumPlusSession(req);
    const body = (await readSanitizedJson(req, null)) as CreateBody | null;
    const requestedFolderId = String(body?.folderId || "").trim() || null;

    const rootFolder = requestedFolderId
      ? await prisma.cavSafeFolder.findFirst({
          where: {
            id: requestedFolderId,
            accountId: sess.accountId,
            deletedAt: null,
          },
          select: {
            id: true,
            path: true,
            name: true,
          },
        })
      : await getRootFolder({
          accountId: sess.accountId,
        });
    if (!rootFolder) {
      return jsonNoStore({ ok: false, error: "FOLDER_NOT_FOUND", message: "Source folder not found." }, 404);
    }

    const fileScope = rootFolder.path === "/"
      ? { startsWith: "/" }
      : { startsWith: `${rootFolder.path}/` };
    const files = await prisma.cavSafeFile.findMany({
      where: {
        accountId: sess.accountId,
        deletedAt: null,
        OR: [{ path: rootFolder.path }, { path: fileScope }],
      },
      orderBy: [{ path: "asc" }],
      select: {
        id: true,
        name: true,
        path: true,
        r2Key: true,
        updatedAt: true,
        bytes: true,
      },
    });
    if (!files.length) {
      return jsonNoStore({ ok: false, error: "SNAPSHOT_EMPTY", message: "No files found in source folder." }, 400);
    }

    const maxBytes = maxSnapshotSourceBytes();
    const totalSourceBytes = files.reduce((sum, row) => sum + row.bytes, BigInt(0));
    if (totalSourceBytes > maxBytes) {
      return jsonNoStore({ ok: false, error: "SNAPSHOT_TOO_LARGE", message: "Snapshot source exceeds configured size limit." }, 413);
    }

    const rootPrefix = rootFolder.path === "/" ? "/" : `${rootFolder.path}/`;
    const entries: Array<{ path: string; data: Buffer; modifiedAt?: Date }> = [];
    for (const file of files) {
      const rel = file.path === rootFolder.path
        ? file.name
        : file.path.startsWith(rootPrefix)
          ? file.path.slice(rootPrefix.length)
          : file.name;
      const buffer = await readObjectBuffer(file.r2Key);
      entries.push({
        path: rel,
        data: buffer,
        modifiedAt: file.updatedAt,
      });
    }

    const zipBuffer = buildZipBuffer(entries);
    const sha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");
    const snapshotId = crypto.randomUUID();
    const archiveKey = `safe-archive/${sess.accountId}/${snapshotId}/cavsafe.zip`;
    await putCavsafeObject({
      objectKey: archiveKey,
      body: zipBuffer,
      contentType: "application/zip",
      contentLength: zipBuffer.byteLength,
    });

    const archiveName = normalizeNodeName(body?.name, `${normalizeNodeName(rootFolder.name, "cavsafe")}-snapshot.zip`);
    const snapshot = await prisma.cavSafeSnapshot.create({
      data: {
        id: snapshotId,
        accountId: sess.accountId,
        operatorUserId: sess.sub,
        rootFolderId: rootFolder.id,
        archiveName,
        archiveR2Key: archiveKey,
        archiveBytes: BigInt(zipBuffer.byteLength),
        sha256,
      },
      select: {
        id: true,
        archiveName: true,
        archiveR2Key: true,
        archiveBytes: true,
        sha256: true,
        rootFolderId: true,
        createdAt: true,
      },
    });

    await writeCavSafeOperationLog({
      accountId: sess.accountId,
      operatorUserId: sess.sub,
      kind: "SNAPSHOT_CREATED",
      subjectType: "snapshot",
      subjectId: snapshot.id,
      label: "CavSafe snapshot archive created",
      meta: {
        rootFolderId: rootFolder.id,
        fileCount: files.length,
        sourceBytes: totalSourceBytes.toString(),
        archiveBytes: snapshot.archiveBytes.toString(),
        sha256,
      },
    });

    try {
      await notifyCavSafeSnapshotCreated({
        accountId: String(sess.accountId || ""),
        userId: String(sess.sub || ""),
        snapshotName: snapshot.archiveName,
        href: "/cavsafe/settings",
      });
    } catch {
      // Non-blocking notification write.
    }

    const origin = appOrigin(req);
    const token = mintCavSafeObjectToken({
      origin,
      objectKey: snapshot.archiveR2Key,
      ttlSeconds: 300,
    });

    return jsonNoStore({
      ok: true,
      snapshot: {
        id: snapshot.id,
        name: snapshot.archiveName,
        bytes: Number(snapshot.archiveBytes),
        bytesExact: snapshot.archiveBytes.toString(),
        sha256: snapshot.sha256,
        rootFolderId: snapshot.rootFolderId,
        createdAtISO: new Date(snapshot.createdAt).toISOString(),
        downloadUrl: buildCavsafeGatewayUrl({
          objectKey: snapshot.archiveR2Key,
          token,
          download: true,
        }),
      },
    }, 200);
  } catch (err) {
    return cavsafeErrorResponse(err, "Failed to create CavSafe snapshot.");
  }
}
