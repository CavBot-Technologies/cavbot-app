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

const compatRoot = path.join(deployDir, "server-functions", "default");
const nextDistServerDir = path.join(compatRoot, "node_modules", "next", "dist");

const compatReplacements = [
  ["react-dom/server.edge", "next/dist/compiled/react-dom/server.edge"],
  ["react-dom/static.edge", "next/dist/compiled/react-dom/static.edge"],
  ["react-dom/server-rendering-stub", "next/dist/compiled/react-dom/server-rendering-stub"],
  ["react-server-dom-webpack/client.edge", "next/dist/compiled/react-server-dom-webpack/client.edge"],
  ["react-server-dom-webpack/server.edge", "next/dist/compiled/react-server-dom-webpack/server.edge"],
  ["react-server-dom-webpack/server.node", "next/dist/compiled/react-server-dom-webpack/server.node"],
  ["react-server-dom-turbopack/client.edge", "next/dist/compiled/react-server-dom-turbopack/client.edge"],
  ["react-server-dom-turbopack/server.edge", "next/dist/compiled/react-server-dom-turbopack/server.edge"],
  ["react-server-dom-turbopack/server.node", "next/dist/compiled/react-server-dom-turbopack/server.node"],
  ["@opentelemetry/api", "next/dist/compiled/@opentelemetry/api"]
];

async function applyCompatRewrites(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await applyCompatRewrites(fullPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs") && !entry.name.endsWith(".cjs")) {
      continue;
    }
    const source = await readFile(fullPath, "utf8");
    let rewritten = source;
    for (const [from, to] of compatReplacements) {
      rewritten = rewritten.replaceAll(`"${from}"`, `"${to}"`);
      rewritten = rewritten.replaceAll(`'${from}'`, `'${to}'`);
    }
    if (rewritten !== source) {
      await writeFile(fullPath, rewritten, "utf8");
    }
  }
}

await applyCompatRewrites(nextDistServerDir);
await applyCompatRewrites(path.join(rootDir, "node_modules", "next", "dist"));

for (const pkg of ["react", "react-dom"]) {
  const srcPkg = path.join(rootDir, "node_modules", pkg);
  const dstPkg = path.join(compatRoot, "node_modules", pkg);
  await rm(dstPkg, { recursive: true, force: true });
  await cp(srcPkg, dstPkg, { recursive: true });
}

async function writeCrittersShim(nodeModulesDir) {
  const crittersDir = path.join(nodeModulesDir, "critters");
  await mkdir(crittersDir, { recursive: true });
  await writeFile(
    path.join(crittersDir, "package.json"),
    JSON.stringify(
      {
        name: "critters",
        version: "0.0.0-cavbot-shim",
        main: "index.js"
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await writeFile(
    path.join(crittersDir, "index.js"),
    [
      "class Critters {",
      "  constructor(options = {}) {",
      "    this.options = options;",
      "  }",
      "  async process(html) {",
      "    return html;",
      "  }",
      "}",
      "module.exports = Critters;",
      "module.exports.default = Critters;"
    ].join("\n") + "\n",
    "utf8"
  );
}

async function writeOtelAlias(nodeModulesDir) {
  const otelApiDir = path.join(nodeModulesDir, "@opentelemetry", "api");
  await mkdir(otelApiDir, { recursive: true });
  await writeFile(
    path.join(otelApiDir, "package.json"),
    JSON.stringify(
      {
        name: "@opentelemetry/api",
        version: "0.0.0-cavbot-shim",
        main: "index.js"
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  await writeFile(
    path.join(otelApiDir, "index.js"),
    "module.exports = require('next/dist/compiled/@opentelemetry/api');\n",
    "utf8"
  );
}

await writeCrittersShim(path.join(compatRoot, "node_modules"));
await writeOtelAlias(path.join(compatRoot, "node_modules"));
await writeCrittersShim(path.join(rootDir, "node_modules"));
await writeOtelAlias(path.join(rootDir, "node_modules"));

const deployNodeModulesDir = path.join(deployDir, "node_modules");
await rm(deployNodeModulesDir, { recursive: true, force: true });
await cp(path.join(compatRoot, "node_modules"), deployNodeModulesDir, { recursive: true });

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
