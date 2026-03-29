// scripts/fix-next-dev-server-chunks.mjs
//
// Workaround for a Next.js dev-server bug/mismatch where `.next/server/webpack-runtime.js`
// attempts to load chunks with `require("./" + chunkId + ".js")` while chunks are emitted to
// `.next/server/chunks/<id>.js`.
//
// This script creates symlinks in `.next/server/` pointing to the real chunk files.
// Prefer fixing the root cause (Node version / Next version); this is a dev unblocker.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const serverDir = path.join(root, ".next", "server");
const chunksDir = path.join(serverDir, "chunks");

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function linkOne(chunkFile) {
  // e.g. "8948.js" -> ".next/server/8948.js" -> "chunks/8948.js"
  if (!/^\d+\.js$/.test(chunkFile)) return;

  const target = path.join(chunksDir, chunkFile);
  const link = path.join(serverDir, chunkFile);

  if (!exists(target)) return;
  if (exists(link)) return;

  try {
    // relative keeps the symlink stable if the repo moves.
    fs.symlinkSync(path.join("chunks", chunkFile), link);
  } catch {
    // Ignore; next might be concurrently writing/cleaning.
  }
}

function runOnce() {
  if (!exists(chunksDir) || !exists(serverDir)) return;
  let files = [];
  try {
    files = fs.readdirSync(chunksDir);
  } catch {
    return;
  }
  for (const f of files) linkOne(f);
}

// Run a few times; dev server can generate chunks after startup.
const maxMs = Number(process.env.CB_FIX_CHUNKS_MAX_MS || 15_000);
const intervalMs = Number(process.env.CB_FIX_CHUNKS_INTERVAL_MS || 250);
const start = Date.now();

runOnce();
const int = setInterval(() => {
  runOnce();
  if (Date.now() - start > maxMs) clearInterval(int);
}, intervalMs);

