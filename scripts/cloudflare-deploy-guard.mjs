#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const allowDirty = process.env.CF_GUARD_ALLOW_DIRTY === "1";
const skipFetch = process.env.CF_GUARD_SKIP_FETCH === "1";
const jsonOutput = process.argv.includes("--json");

function fail(message) {
  console.error(`Cloudflare deploy guard failed: ${message}`);
  process.exit(1);
}

function runGit(args, options = {}) {
  const output = execFileSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
  return typeof output === "string" ? output.trim() : "";
}

try {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree !== "true") {
    fail("this command must run inside a git worktree.");
  }
} catch {
  fail("this command must run inside a git worktree.");
}

if (!skipFetch) {
  try {
    runGit(["fetch", "origin", "main", "--quiet"]);
  } catch {
    fail("unable to fetch origin/main.");
  }
}

const commitHash = runGit(["rev-parse", "HEAD"]);

if (!allowDirty) {
  const status = runGit(["status", "--porcelain"]);
  if (status.length > 0) {
    fail("working tree is not clean. Commit or stash changes before production ad-hoc deploy.");
  }
}

try {
  runGit(["merge-base", "--is-ancestor", commitHash, "origin/main"]);
} catch {
  fail(`HEAD (${commitHash}) is not contained in origin/main.`);
}

let commitMessage = runGit(["log", "-1", "--pretty=%B", commitHash]).replace(/\s+/g, " ").trim();
if (!commitMessage) {
  commitMessage = `Deploy ${commitHash.slice(0, 12)}`;
}

const metadata = {
  branch: "main",
  commitHash,
  commitMessage,
  commitDirty: "false"
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
} else {
  console.log("Cloudflare deploy guard passed.");
  console.log(`branch=${metadata.branch}`);
  console.log(`commit_hash=${metadata.commitHash}`);
  console.log(`commit_dirty=${metadata.commitDirty}`);
}
