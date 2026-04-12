import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(rel: string) {
  return fs.readFileSync(path.resolve(rel), "utf8");
}

test("cavtools cavcloud worker path avoids broad Prisma namespace runtime imports", () => {
  const commandPlane = read("lib/cavtools/commandPlane.server.ts");
  const cavcloudStorage = read("lib/cavcloud/storage.server.ts");
  const cavsafeStorage = read("lib/cavsafe/storage.server.ts");
  const fileRoute = read("app/api/cavtools/file/route.ts");
  const prismaRuntime = read("lib/prismaRuntime.ts");

  assert.equal(
    commandPlane.includes('import { Prisma, type CavCloudShareMode, type PublicArtifactVisibility } from "@prisma/client";'),
    false,
  );
  assert.equal(
    commandPlane.includes('import { prismaEmpty, prismaJoin, prismaRaw, prismaSql, type Sql } from "@/lib/prismaRuntime";'),
    true,
  );
  assert.equal(commandPlane.includes("const Prisma = {"), true);
  assert.equal(commandPlane.includes("const whereParts: Sql[] = [];"), true);
  assert.equal(commandPlane.includes('import {\n  ensureCavCloudRootFolderRuntime,\n  loadCavCloudTreeLiteRuntime,\n} from "@/lib/cavcloud/runtimeStorage.server";'), true);
  assert.equal(commandPlane.includes('getTreeLite as cavcloudTreeLite'), false);
  assert.equal(commandPlane.includes('const tree = await loadCavCloudTreeLiteRuntime({'), true);
  assert.equal(commandPlane.includes('const latestVersionResult = await getAuthPool().query<{ versionNumber: number | string | null }>('), true);
  assert.equal(commandPlane.includes('prisma.cavCloudFileVersion.findFirst'), false);

  assert.equal(cavcloudStorage.includes('import { Prisma } from "@prisma/client";'), false);
  assert.equal(cavcloudStorage.includes('import type { Prisma } from "@prisma/client";'), true);
  assert.equal(cavcloudStorage.includes('import { SERIALIZABLE_TX_ISOLATION_LEVEL } from "@/lib/prismaRuntime";'), true);
  assert.equal(cavcloudStorage.includes("Prisma.TransactionIsolationLevel.Serializable"), false);

  assert.equal(cavsafeStorage.includes('import { Prisma } from "@prisma/client";'), false);
  assert.equal(cavsafeStorage.includes('import type { Prisma } from "@prisma/client";'), true);
  assert.equal(cavsafeStorage.includes('import { SERIALIZABLE_TX_ISOLATION_LEVEL } from "@/lib/prismaRuntime";'), true);
  assert.equal(cavsafeStorage.includes("Prisma.TransactionIsolationLevel.Serializable"), false);

  assert.equal(
    prismaRuntime.includes('import { empty, join, raw, sqltag, type Sql } from "@prisma/client/runtime/client";'),
    true,
  );
  assert.equal(
    prismaRuntime.includes('export const SERIALIZABLE_TX_ISOLATION_LEVEL: Prisma.TransactionIsolationLevel = "Serializable";'),
    true,
  );

  assert.equal(
    fileRoute.includes('import { readCavtoolsFile, writeCavtoolsFile } from "@/lib/cavtools/commandPlane.server";'),
    false,
  );
  assert.equal(fileRoute.includes('const { readCavtoolsFile } = await import("@/lib/cavtools/commandPlane.server");'), true);
  assert.equal(fileRoute.includes('const { writeCavtoolsFile } = await import("@/lib/cavtools/commandPlane.server");'), true);
});
