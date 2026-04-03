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
import { applyVendorPatches } from "./apply-vendor-patches.mjs";

const MAX_PAGES_FILE_BYTES = 25 * 1024 * 1024;
const EXTERNAL_PREBUNDLE_MODULES = [
  "critters",
  "react-dom/server.edge",
  "react-dom/static.edge",
  "react-dom/server-rendering-stub",
  "react-server-dom-webpack/server.node",
  "react-server-dom-webpack/server.edge",
  "react-server-dom-webpack/client.edge",
  "react-server-dom-turbopack/client.edge",
  "react-server-dom-turbopack/server.edge",
  "react-server-dom-turbopack/server.node",
  "@opentelemetry/api"
];
const rootDir = process.cwd();
const openNextDir = path.join(rootDir, ".open-next");
const deployDir = path.join(openNextDir, "pages-deploy");
const excludedDir = path.join(openNextDir, "pages-deploy-excluded");

await applyVendorPatches(rootDir);

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

// Keep the default OpenNext worker entrypoint so runtime bootstrapping remains compatible
// with Workers (the server index path can trigger unsupported fs calls in workerd).
const workerSource = await readFile(path.join(openNextDir, "worker.js"), "utf8");
await writeFile(path.join(deployDir, "_worker.js"), workerSource, "utf8");

const cloudflareInitPath = path.join(deployDir, "cloudflare", "init.js");
const cloudflareInitSource = await readFile(cloudflareInitPath, "utf8");
await writeFile(
  cloudflareInitPath,
  cloudflareInitSource.replace(
    "__ASSETS_RUN_WORKER_FIRST__: false,",
    "__ASSETS_RUN_WORKER_FIRST__: true,",
  ),
  "utf8",
);

const sanitizedCloudflareInitSource = (
  await readFile(cloudflareInitPath, "utf8")
).replace(
  /^\s*import\.meta\.url \?\?= "file:\/\/\/worker\.js";\r?\n/m,
  "",
);
await writeFile(cloudflareInitPath, sanitizedCloudflareInitSource, "utf8");

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
      external: ["cloudflare:workers", ...EXTERNAL_PREBUNDLE_MODULES],
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

    let bundledSource = await readFile(bundledWorkerPath, "utf8");
    const dynamicRequireShimPreamble =
      `import * as __cavbot_node_path from "node:path";` +
      `import * as __cavbot_node_module from "node:module";` +
      `import * as __cavbot_node_async_hooks from "node:async_hooks";` +
      `import * as __cavbot_node_crypto from "node:crypto";` +
      `import * as __cavbot_node_buffer from "node:buffer";` +
      `import * as __cavbot_node_stream from "node:stream";` +
      `import * as __cavbot_node_stream_web from "node:stream/web";` +
      `import * as __cavbot_node_querystring from "node:querystring";` +
      `import * as __cavbot_node_url from "node:url";` +
      `import * as __cavbot_node_http from "node:http";` +
      `import * as __cavbot_node_https from "node:https";` +
      `import * as __cavbot_node_net from "node:net";` +
      `import * as __cavbot_node_tls from "node:tls";` +
      `import * as __cavbot_node_zlib from "node:zlib";` +
      `import * as __cavbot_node_os from "node:os";` +
      `import * as __cavbot_node_fs from "node:fs";` +
      `import * as __cavbot_node_events from "node:events";` +
      `import * as __cavbot_node_util from "node:util";` +
      `import * as __cavbot_node_vm from "node:vm";` +
      `const __cavbot_node_module_cjs=__cavbot_node_module.default||__cavbot_node_module.Module||__cavbot_node_module;` +
      `const __cavbot_builtin_modules={` +
      `"path":__cavbot_node_path,"node:path":__cavbot_node_path,` +
      `"module":__cavbot_node_module_cjs,"node:module":__cavbot_node_module_cjs,` +
      `"async_hooks":__cavbot_node_async_hooks,"node:async_hooks":__cavbot_node_async_hooks,` +
      `"crypto":__cavbot_node_crypto,"node:crypto":__cavbot_node_crypto,` +
      `"buffer":__cavbot_node_buffer,"node:buffer":__cavbot_node_buffer,` +
      `"stream":__cavbot_node_stream,"node:stream":__cavbot_node_stream,` +
      `"stream/web":__cavbot_node_stream_web,"node:stream/web":__cavbot_node_stream_web,` +
      `"querystring":__cavbot_node_querystring,"node:querystring":__cavbot_node_querystring,` +
      `"url":__cavbot_node_url,"node:url":__cavbot_node_url,` +
      `"http":__cavbot_node_http,"node:http":__cavbot_node_http,` +
      `"https":__cavbot_node_https,"node:https":__cavbot_node_https,` +
      `"net":__cavbot_node_net,"node:net":__cavbot_node_net,` +
      `"tls":__cavbot_node_tls,"node:tls":__cavbot_node_tls,` +
      `"zlib":__cavbot_node_zlib,"node:zlib":__cavbot_node_zlib,` +
      `"os":__cavbot_node_os,"node:os":__cavbot_node_os,` +
      `"fs":__cavbot_node_fs,"node:fs":__cavbot_node_fs,` +
      `"events":__cavbot_node_events,"node:events":__cavbot_node_events,` +
      `"util":__cavbot_node_util,"node:util":__cavbot_node_util,` +
      `"vm":__cavbot_node_vm,"node:vm":__cavbot_node_vm` +
      `};` +
      `const require=Object.assign(function(id){const key=String(id??"");` +
      `if(Object.prototype.hasOwnProperty.call(__cavbot_builtin_modules,key))return __cavbot_builtin_modules[key];` +
      `if(typeof process<"u"&&typeof process.getBuiltinModule=="function"){` +
      `let mod=process.getBuiltinModule(key);` +
      `if(mod==null&&typeof key=="string"&&!key.startsWith("node:"))mod=process.getBuiltinModule("node:"+key);` +
      `if(mod!=null)return mod;}` +
      `throw Error('Dynamic require of "'+key+'" is not supported');` +
      `},{resolve:function(id){return String(id??"")}});`;
    bundledSource = `${dynamicRequireShimPreamble}${bundledSource}`;

    const middlewareInitPattern =
      /,([A-Za-z_$][A-Za-z0-9_$]*)=await ([A-Za-z_$][A-Za-z0-9_$]*)\(\{handler:([A-Za-z_$][A-Za-z0-9_$]*),type:"middleware"\}\);/;
    const middlewareInitMatch = bundledSource.match(middlewareInitPattern);
    if (middlewareInitMatch) {
      const middlewareHandlerVar = middlewareInitMatch[1];
      const middlewareFactoryVar = middlewareInitMatch[2];
      const middlewareHandlerFnVar = middlewareInitMatch[3];
      bundledSource = bundledSource.replace(
        middlewareInitPattern,
        `,${middlewareHandlerVar}Promise=${middlewareFactoryVar}({handler:${middlewareHandlerFnVar},type:"middleware"}),${middlewareHandlerVar}=async(...args)=>(await ${middlewareHandlerVar}Promise)(...args);`
      );
    }

    // Wrangler --no-bundle rejects relative imports in _worker.js and validates with an
    // iife compile pass that cannot handle top-level await.
    await writeFile(workerPath, bundledSource, "utf8");
  } finally {
    await rm(tempOutDir, { recursive: true, force: true });
  }
}

if (process.env.CF_PREBUNDLE_WORKER === "1") {
  await prebundleWorkerForPages();
}

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
