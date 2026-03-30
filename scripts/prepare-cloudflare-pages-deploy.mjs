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
const buildIdValue = (await readFile(path.join(openNextDir, "assets", "BUILD_ID"), "utf8")
  .catch(async () => readFile(path.join(openNextDir, "BUILD_ID"), "utf8"))).trim();

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

// Keep OpenNext behavior while routing to the smaller server index entrypoint.
// prebundleWorkerForPages() below then collapses this to a single-file worker.
const workerSource = await readFile(path.join(openNextDir, "worker.js"), "utf8");
const patchedWorkerSource = workerSource.replace(
  "./server-functions/default/handler.mjs",
  "./server-functions/default/index.mjs"
);
await writeFile(path.join(deployDir, "_worker.js"), patchedWorkerSource, "utf8");

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
    const builtinAliases = [
      { specifier: "path", alias: "__cavbot_node_path" },
      { specifier: "module", alias: "__cavbot_node_module" },
      { specifier: "async_hooks", alias: "__cavbot_node_async_hooks" },
      { specifier: "crypto", alias: "__cavbot_node_crypto" },
      { specifier: "vm", alias: "__cavbot_node_vm" },
      { specifier: "http", alias: "__cavbot_node_http" },
      { specifier: "https", alias: "__cavbot_node_https" },
      { specifier: "stream", alias: "__cavbot_node_stream" },
      { specifier: "stream/web", alias: "__cavbot_node_stream_web" },
      { specifier: "buffer", alias: "__cavbot_node_buffer" },
      { specifier: "url", alias: "__cavbot_node_url" },
      { specifier: "util", alias: "__cavbot_node_util" },
      { specifier: "events", alias: "__cavbot_node_events" },
      { specifier: "fs", alias: "__cavbot_node_fs" },
      { specifier: "os", alias: "__cavbot_node_os" },
      { specifier: "net", alias: "__cavbot_node_net" },
      { specifier: "tls", alias: "__cavbot_node_tls" },
      { specifier: "zlib", alias: "__cavbot_node_zlib" },
      { specifier: "querystring", alias: "__cavbot_node_querystring" }
    ];
    const builtinImportPreamble = builtinAliases
      .map(({ specifier, alias }) => `import * as ${alias} from "node:${specifier}";`)
      .join("");
    const resolveBuiltinRef = ({ specifier, alias }) =>
      specifier === "module"
        ? "__cavbot_node_module_cjs"
        : alias;
    const builtinRequireEntries = builtinAliases
      .flatMap((entry) => {
        const ref = resolveBuiltinRef(entry);
        return [
          `"${entry.specifier}": ${ref}`,
          `"node:${entry.specifier}": ${ref}`
        ];
      })
      .join(",");
    const requireShimPreamble =
      `const __cavbot_node_module_cjs=__cavbot_node_module.default||__cavbot_node_module.Module||__cavbot_node_module;` +
      `const __cavbotBuiltinModules={${builtinRequireEntries}};` +
      `const require=Object.assign(function(id){const key=String(id||"");` +
      `if(Object.prototype.hasOwnProperty.call(__cavbotBuiltinModules,key))return __cavbotBuiltinModules[key];` +
      `throw Error('Dynamic require of "'+key+'" is not supported');},{resolve:function(id){return String(id||"");}});`;
    bundledSource = `${builtinImportPreamble}${requireShimPreamble}${bundledSource}`;
    bundledSource = bundledSource.replaceAll('eval("require")', "require");
    bundledSource = bundledSource.replaceAll("eval('require')", "require");

    const dynamicRequireHelperNeedle =
      'function(e){if(typeof require<"u")return require.apply(this,arguments);throw Error(\'Dynamic require of "\'+e+\'" is not supported\')}';
    const dynamicRequireHelperPatch =
      'function(e){if(typeof require<"u")return require.apply(this,arguments);if(typeof process<"u"&&typeof process.getBuiltinModule=="function"){let t=process.getBuiltinModule(e);if(t==null&&typeof e=="string"&&!e.startsWith("node:"))t=process.getBuiltinModule("node:"+e);if(t!=null)return t;}throw Error(\'Dynamic require of "\'+e+\'" is not supported\')}';
    if (bundledSource.includes(dynamicRequireHelperNeedle)) {
      bundledSource = bundledSource.replace(dynamicRequireHelperNeedle, dynamicRequireHelperPatch);
    }
    for (const entry of builtinAliases) {
      const ref = resolveBuiltinRef(entry);
      bundledSource = bundledSource.replaceAll(`In("${entry.specifier}")`, ref);
      bundledSource = bundledSource.replaceAll(`In("node:${entry.specifier}")`, ref);
    }
    const buildIdGetterStart = "getBuildId(){let t=(0,uu.join)(this.distDir,yc.BUILD_ID_FILE);";
    const buildIdStartIdx = bundledSource.indexOf(buildIdGetterStart);
    if (buildIdStartIdx >= 0) {
      let depth = 0;
      let endIdx = -1;
      for (let i = buildIdStartIdx; i < bundledSource.length; i += 1) {
        const ch = bundledSource[i];
        if (ch === "{") depth += 1;
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }
      if (endIdx > buildIdStartIdx) {
        bundledSource =
          bundledSource.slice(0, buildIdStartIdx) +
          `getBuildId(){return ${JSON.stringify(buildIdValue)}}` +
          bundledSource.slice(endIdx + 1);
      }
    }

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
