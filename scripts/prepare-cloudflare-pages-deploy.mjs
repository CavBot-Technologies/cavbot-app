#!/usr/bin/env node

import { build as esbuildBuild } from "esbuild";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
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

// Pages deploy root must contain static asset files directly.
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

// Keep OpenNext worker import graph intact; prebundleWorkerForPages() below
// will collapse this to a single-file worker for Wrangler --no-bundle deploys.
const workerSource = await readFile(path.join(openNextDir, "worker.js"), "utf8");
await writeFile(path.join(deployDir, "_worker.js"), workerSource, "utf8");

async function splitOversizedHandlerIfNeeded() {
  const handlerDir = path.join(deployDir, "server-functions", "default");
  const handlerPath = path.join(handlerDir, "handler.mjs");
  const originalStats = await stat(handlerPath);
  if (originalStats.size <= MAX_PAGES_FILE_BYTES) {
    return;
  }

  // Keep a copy of the original OpenNext output for debugging/audit.
  await cp(handlerPath, path.join(excludedDir, "handler.mjs"), { recursive: false });

  const tempOutDir = await mkdtemp(path.join(os.tmpdir(), "cavbot-handler-minify-"));
  const tempHandlerPath = path.join(tempOutDir, "handler.mjs");
  try {
    await esbuildBuild({
      entryPoints: [handlerPath],
      bundle: true,
      format: "esm",
      platform: "node",
      target: ["es2022"],
      outfile: tempHandlerPath,
      minify: true,
      legalComments: "none",
      sourcemap: false,
      logLevel: "silent"
    });

    const minifiedStats = await stat(tempHandlerPath);
    if (minifiedStats.size > MAX_PAGES_FILE_BYTES) {
      const mb = (minifiedStats.size / (1024 * 1024)).toFixed(2);
      throw new Error(`Minified handler.mjs is still over 25 MiB (${mb} MiB).`);
    }

    // Replace oversized handler with a minified equivalent.
    await cp(tempHandlerPath, handlerPath, { recursive: false, force: true });
  } finally {
    await rm(tempOutDir, { recursive: true, force: true });
  }
}

await splitOversizedHandlerIfNeeded();

async function prebundleWorkerForPages() {
  const workerPath = path.join(deployDir, "_worker.js");
  const tempOutDir = await mkdtemp(path.join(os.tmpdir(), "cavbot-worker-prebundle-"));
  const bundledWorkerPath = path.join(tempOutDir, "worker.bundle.mjs");
  try {
    await esbuildBuild({
      entryPoints: [workerPath],
      outfile: bundledWorkerPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: ["es2022"],
      external: ["cloudflare:workers"],
      minify: true,
      legalComments: "none",
      sourcemap: false,
      define: {
        "process.env.NODE_ENV": "\"production\""
      },
      logLevel: "silent"
    });

    const bundledStats = await stat(bundledWorkerPath);
    if (bundledStats.size > MAX_PAGES_FILE_BYTES) {
      const mb = (bundledStats.size / (1024 * 1024)).toFixed(2);
      throw new Error(`Prebundled _worker.js exceeds 25 MiB (${mb} MiB).`);
    }

    // Wrangler --no-bundle now rejects _worker.js imports, so deploy a single-file worker.
    await cp(bundledWorkerPath, workerPath, { recursive: false, force: true });
  } finally {
    await rm(tempOutDir, { recursive: true, force: true });
  }
}

await prebundleWorkerForPages();

const oversized = [];
const bannedFileNames = new Set([".DS_Store"]);

async function scanAndPrune(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanAndPrune(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (bannedFileNames.has(entry.name) || entry.name.startsWith(".env")) {
      await rm(fullPath, { force: true });
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

await scanAndPrune(deployDir);

if (oversized.length > 0) {
  const list = oversized.map((item) => `${item.file} (${item.sizeMb} MiB)`).join(", ");
  throw new Error(`Pages upload still contains file(s) larger than 25 MiB: ${list}`);
}

console.log("Prepared .open-next/pages-deploy for Cloudflare Pages.");
