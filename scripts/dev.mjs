// scripts/dev.mjs
//
// Run `next dev` while continuously fixing a Next.js dev-server chunk lookup mismatch:
// `.next/server/webpack-runtime.js` sometimes tries to `require("./<id>.js")` even though
// chunks are emitted to `.next/server/chunks/<id>.js`.
//
// This watcher creates symlinks `.next/server/<id>.js -> chunks/<id>.js` for numeric chunks
// for the lifetime of the dev server.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// This repo targets Node >=20 and <24 (see package.json engines and .nvmrc).
// Running unsupported Node versions can corrupt `.next` output in dev (missing chunks, broken runtime requires).
function checkNodeVersion() {
  try {
    const major = Number(String(process.versions.node || "").split(".")[0] || 0);
    if (!Number.isFinite(major) || major <= 0) return;

    const supported = major >= 20 && major < 24;
    if (supported) return;

    // Allow local override: sometimes this still works, but it's not officially supported.
    if (process.env.CB_IGNORE_NODE_ENGINE === "1") return;

    // Keep local dev unblocked. Show this only when explicitly requested.
    if (process.env.CB_SHOW_NODE_ENGINE_WARN === "1") {
      const msg =
        `Unsupported Node.js v${process.versions.node} for this repo (expected >=20 <24).\n` +
        `Fix: switch to Node 22 (see .nvmrc) and restart dev.\n` +
        `Override: run \`npm run dev:unsafe\` (or set CB_IGNORE_NODE_ENGINE=1).`;
      console.warn(msg);
    }
  } catch {
    // ignore
  }
}

checkNodeVersion();

const root = process.cwd();
const nextDir = path.join(root, ".next");
const serverDir = path.join(root, ".next", "server");
const chunksDir = path.join(serverDir, "chunks");
const vendorDir = path.join(serverDir, "vendor-chunks");
const chunksVendorDir = path.join(chunksDir, "vendor-chunks");

function cleanNextOnBoot() {
  // Default behavior: always boot dev from a clean .next to avoid stale HMR/runtime chunk state.
  // Set CB_SKIP_DEV_CLEAN=1 to keep previous behavior.
  if (process.env.CB_SKIP_DEV_CLEAN === "1") return;
  try {
    fs.rmSync(nextDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

cleanNextOnBoot();

function lstatMaybe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function exists(p) {
  return lstatMaybe(p) !== null;
}

function linkOne(chunkFile) {
  // e.g. "8948.js" -> ".next/server/8948.js" -> "chunks/8948.js"
  if (!/^\d+\.js$/.test(chunkFile)) return;

  const target = path.join(chunksDir, chunkFile);
  const link = path.join(serverDir, chunkFile);

  if (!exists(target)) return;

  const st = lstatMaybe(link);
  if (st) return;

  try {
    // Relative keeps the symlink stable if the repo moves.
    fs.symlinkSync(path.join("chunks", chunkFile), link);
  } catch {
    // Ignore; next might be concurrently writing/cleaning.
  }
}

function runOnce() {
  if (!exists(serverDir) || !exists(chunksDir)) return;
  let files = [];
  try {
    files = fs.readdirSync(chunksDir);
  } catch {
    return;
  }
  for (const f of files) linkOne(f);

  // Some Next versions emit vendor chunks into `.next/server/chunks/vendor-chunks/*`
  // but the runtime `require("./vendor-chunks/<name>.js")` expects them in
  // `.next/server/vendor-chunks/*`. Mirror them if present.
  try {
    if (exists(chunksVendorDir)) {
      if (!exists(vendorDir)) fs.mkdirSync(vendorDir, { recursive: true });
      const vendorFiles = fs.readdirSync(chunksVendorDir);
      for (const vf of vendorFiles) {
        if (!vf.endsWith(".js")) continue;
        const target = path.join(chunksVendorDir, vf);
        const link = path.join(vendorDir, vf);
        if (!exists(target)) continue;
        if (exists(link)) continue;
        try {
          fs.symlinkSync(path.relative(vendorDir, target), link);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

// Keep this tight so the symlink exists before webpack-runtime attempts to require it.
const intervalMs = Number(process.env.CB_FIX_CHUNKS_INTERVAL_MS || 50);
const int = setInterval(runOnce, intervalMs);
runOnce();

function nextCmd() {
  const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
  if (exists(bin)) return { cmd: bin, args: ["dev"] };
  // Fallback (shouldn't be needed in this repo, but keeps dev unblocked).
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["next", "dev"] };
}

const { cmd, args } = nextCmd();
const childEnv = {
  ...process.env,
  // Keep local dev overlay focused on app errors by skipping Next telemetry/version staleness checks.
  NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || "1",
};
const child = spawn(cmd, args, { stdio: "inherit", env: childEnv });

function shutdown(code) {
  clearInterval(int);
  process.exit(code);
}

child.on("exit", (code) => shutdown(typeof code === "number" ? code : 1));
child.on("error", () => shutdown(1));

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
