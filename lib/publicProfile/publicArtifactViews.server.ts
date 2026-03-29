import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizePublicPathNoTrailingSlash } from "@/lib/publicProfile/publicArtifacts.server";

type ViewRow = {
  itemPath: string;
  viewCount: number;
};

let ensureCounterTablePromise: Promise<void> | null = null;

function normalizeViewPath(raw: string | null | undefined): string {
  const normalized = normalizePublicPathNoTrailingSlash(String(raw || "/"));
  return normalized || "/";
}

async function ensureCounterTable() {
  if (ensureCounterTablePromise) return ensureCounterTablePromise;
  ensureCounterTablePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PublicArtifactViewCounter" (
        "artifactId" TEXT NOT NULL,
        "itemPath" TEXT NOT NULL,
        "viewCount" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY ("artifactId", "itemPath")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PublicArtifactViewCounter_artifactId_idx"
      ON "PublicArtifactViewCounter"("artifactId");
    `);
  })();
  return ensureCounterTablePromise;
}

export async function incrementPublicArtifactViewCount(args: {
  artifactId: string;
  itemPath: string | null | undefined;
}): Promise<{ itemPath: string; viewCount: number }> {
  const artifactId = String(args.artifactId || "").trim();
  if (!artifactId) return { itemPath: "/", viewCount: 0 };
  const itemPath = normalizeViewPath(args.itemPath);

  await ensureCounterTable();

  const rows = await prisma.$queryRawUnsafe<ViewRow[]>(
    `
      INSERT INTO "PublicArtifactViewCounter" (
        "artifactId",
        "itemPath",
        "viewCount",
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, 1, NOW(), NOW())
      ON CONFLICT ("artifactId", "itemPath")
      DO UPDATE SET
        "viewCount" = "PublicArtifactViewCounter"."viewCount" + 1,
        "updatedAt" = NOW()
      RETURNING "itemPath", "viewCount";
    `,
    artifactId,
    itemPath
  );

  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return {
    itemPath,
    viewCount: Number(row?.viewCount || 0),
  };
}

export async function getPublicArtifactViewCountsByPath(args: {
  artifactId: string;
  itemPaths: string[];
}): Promise<Map<string, number>> {
  const artifactId = String(args.artifactId || "").trim();
  const normalizedPaths = Array.from(
    new Set((Array.isArray(args.itemPaths) ? args.itemPaths : []).map((path) => normalizeViewPath(path)))
  );
  const out = new Map<string, number>();
  for (const path of normalizedPaths) out.set(path, 0);
  if (!artifactId || normalizedPaths.length === 0) return out;

  await ensureCounterTable();

  const rows = await prisma.$queryRawUnsafe<ViewRow[]>(
    `
      SELECT "itemPath", "viewCount"
      FROM "PublicArtifactViewCounter"
      WHERE "artifactId" = $1
        AND "itemPath" = ANY($2::text[]);
    `,
    artifactId,
    normalizedPaths
  );

  if (Array.isArray(rows)) {
    for (const row of rows) {
      const key = normalizeViewPath(row?.itemPath);
      out.set(key, Math.max(0, Math.trunc(Number(row?.viewCount || 0))));
    }
  }

  return out;
}
