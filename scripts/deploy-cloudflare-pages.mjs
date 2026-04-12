#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shouldSkipBuild = process.env.CF_DEPLOY_SKIP_BUILD === "1";
const shouldSkipMigrations = process.env.CF_DEPLOY_SKIP_MIGRATIONS === "1";
const env = {
  ...process.env,
  CF_PREBUNDLE_WORKER: "1"
};

function hasRealDatabaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  return !trimmed.includes("placeholder@127.0.0.1:5432/cavbot")
    && !trimmed.includes("paste_your_base_url_here")
    && !trimmed.includes("db.prisma.io:5432");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const guardOutput = execFileSync("node", ["scripts/cloudflare-deploy-guard.mjs", "--json"], {
  cwd: rootDir,
  encoding: "utf8",
  env
}).trim();

const metadata = JSON.parse(guardOutput);

if (!shouldSkipMigrations && (hasRealDatabaseUrl(env.DIRECT_URL) || hasRealDatabaseUrl(env.DATABASE_URL))) {
  run("npm", ["run", "db:migrate"]);
}

if (!shouldSkipBuild) {
  run("npm", ["run", "build:cloudflare"]);
}

run("npm", ["run", "prepare:cloudflare:pages"]);

run("wrangler", [
  "pages",
  "deploy",
  ".open-next/pages-deploy",
  "--project-name",
  "cavbot-app",
  "--branch",
  metadata.branch,
  "--commit-hash",
  metadata.commitHash,
  "--commit-message",
  metadata.commitMessage,
  "--commit-dirty=false",
  "--no-bundle"
]);
