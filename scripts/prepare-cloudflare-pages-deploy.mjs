#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_PAGES_FILE_BYTES = 25 * 1024 * 1024;
const rootDir = process.cwd();
const openNextDir = path.join(rootDir, ".open-next");
const deployDir = path.join(openNextDir, "pages-deploy");
const excludedDir = path.join(openNextDir, "pages-deploy-excluded");

const requiredPaths = [
  path.join(openNextDir, "assets"),
  path.join(openNextDir, "worker.js"),
  path.join(openNextDir, "cloudflare"),
  path.join(openNextDir, "middleware"),
  path.join(openNextDir, ".build"),
  path.join(openNextDir, "server-functions", "default")
];

for (const requiredPath of requiredPaths) {
  await stat(requiredPath);
}

await rm(deployDir, { recursive: true, force: true });
await rm(excludedDir, { recursive: true, force: true });

await mkdir(deployDir, { recursive: true });
await mkdir(excludedDir, { recursive: true });

// Pages deploy root must contain the static asset tree.
await cp(path.join(openNextDir, "assets"), deployDir, { recursive: true });

await cp(path.join(openNextDir, "cloudflare"), path.join(deployDir, "cloudflare"), {
  recursive: true
});
await cp(path.join(openNextDir, "middleware"), path.join(deployDir, "middleware"), {
  recursive: true
});
await cp(path.join(openNextDir, ".build"), path.join(deployDir, ".build"), { recursive: true });
await cp(path.join(openNextDir, "server-functions"), path.join(deployDir, "server-functions"), {
  recursive: true
});

const workerSource = await readFile(path.join(openNextDir, "worker.js"), "utf8");
const serverImport = './server-functions/default/handler.mjs';
const replacementImport = './server-functions/default/index.mjs';
if (!workerSource.includes(serverImport)) {
  throw new Error(`Expected to find ${serverImport} import in .open-next/worker.js`);
}
const patchedWorker = workerSource.replace(serverImport, replacementImport);
await writeFile(path.join(deployDir, "_worker.js"), patchedWorker, "utf8");

const oversizedHandler = path.join(deployDir, "server-functions", "default", "handler.mjs");
try {
  await cp(oversizedHandler, path.join(excludedDir, "handler.mjs"), { recursive: false });
  await unlink(oversizedHandler);
} catch {
  // If OpenNext ever stops emitting this file, no action needed.
}

const oversized = [];
const bannedFileNames = new Set([".DS_Store"]);

async function scanLargeFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanLargeFiles(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (bannedFileNames.has(entry.name) || entry.name.startsWith(".env")) {
      await unlink(fullPath);
      continue;
    }
    const fileStats = await stat(fullPath);
    if (fileStats.size > MAX_PAGES_FILE_BYTES) {
      oversized.push({
        file: path.relative(deployDir, fullPath),
        sizeMb: (fileStats.size / (1024 * 1024)).toFixed(2)
      });
    }
  }
}

await scanLargeFiles(deployDir);

if (oversized.length > 0) {
  const list = oversized.map((item) => `${item.file} (${item.sizeMb} MiB)`).join(", ");
  throw new Error(`Pages upload still contains file(s) larger than 25 MiB: ${list}`);
}

console.log("Prepared .open-next/pages-deploy for Cloudflare Pages.");
