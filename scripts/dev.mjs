// scripts/dev.mjs
//
// Run `next dev` while continuously fixing a Next.js dev-server chunk lookup mismatch:
// `.next/server/webpack-runtime.js` sometimes tries to `require("./<id>.js")` even though
// chunks are emitted to `.next/server/chunks/<id>.js`.
//
// This watcher creates symlinks `.next/server/<id>.js -> chunks/<id>.js` for numeric chunks
// for the lifetime of the dev server.

import { spawn } from "node:child_process";
import { parse as parseDotenv } from "dotenv";
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

const LOCALHOST_FALLBACK_ORIGIN = "http://localhost:3000";
const LOCAL_DB_ENV_KEYS = ["CAVBOT_DEV_DATABASE_URL", "CAVBOT_DEV_DIRECT_URL"];
const ALWAYS_STRIPPED_INTEGRATION_ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_SIGNUP_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_R2_ENDPOINT",
  "CAVCLOUD_R2_ENDPOINT",
  "CAVCLOUD_R2_ACCESS_KEY_ID",
  "CAVCLOUD_R2_SECRET_ACCESS_KEY",
  "CAVCLOUD_R2_BUCKET",
  "CAVCLOUD_R2_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
];

function readEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return parseDotenv(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

function loadDevEnvSnapshot(rootDir) {
  const merged = {};
  const orderedFiles = [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ];

  for (const relPath of orderedFiles) {
    Object.assign(merged, readEnvFile(path.join(rootDir, relPath)));
  }

  return {
    ...merged,
    ...process.env,
  };
}

function isTruthyFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim() || LOCALHOST_FALLBACK_ORIGIN;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return LOCALHOST_FALLBACK_ORIGIN;
  }
}

function getUrlHostname(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLocalHostname(hostname) {
  if (!hostname) return false;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".local");
}

function isRemoteDatabaseUrl(value) {
  const hostname = getUrlHostname(value);
  if (!hostname) return false;
  return !isLocalHostname(hostname);
}

function describeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "(missing)";
  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\/+/, "") || "(no-db)";
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}/${dbName}`;
  } catch {
    return raw;
  }
}

function isStripeTestSecretKey(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("sk_test_") || raw.startsWith("rk_test_");
}

function isStripeTestPublishableKey(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("pk_test_");
}

function assertSafeLocalDatabase(env) {
  const allowRemoteDb = isTruthyFlag(env.CAVBOT_ALLOW_REMOTE_DEV_DB);
  if (allowRemoteDb) return;

  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const directUrl = String(env.DIRECT_URL || "").trim();
  const remoteUrls = [
    ["DATABASE_URL", databaseUrl],
    ["DIRECT_URL", directUrl],
  ].filter(([, value]) => isRemoteDatabaseUrl(value));

  if (!remoteUrls.length) return;

  const details = remoteUrls.map(([key, value]) => `  - ${key}: ${describeUrl(value)}`).join("\n");
  const msg =
    "\n[cavbot dev] Refusing to start with a remote database in safe localhost mode.\n" +
    `${details}\n\n` +
    "Set a local Postgres URL in `.env.development.local` using `CAVBOT_DEV_DATABASE_URL` " +
    "(and optionally `CAVBOT_DEV_DIRECT_URL`) or explicitly opt in with `CAVBOT_ALLOW_REMOTE_DEV_DB=1`.\n";
  console.error(msg);
  process.exit(1);
}

function applySafeLocalhostEnv(baseEnv) {
  const devOrigin = normalizeOrigin(baseEnv.CAVBOT_DEV_ORIGIN);
  const env = {
    ...baseEnv,
    CAVBOT_DEV_ORIGIN: devOrigin,
    CAVBOT_APP_ORIGIN: devOrigin,
    APP_URL: devOrigin,
    NEXT_PUBLIC_APP_ORIGIN: devOrigin,
    NEXT_PUBLIC_APP_URL: devOrigin,
    AUTH_REDIRECT_BASE_URL: devOrigin,
    NEXT_PUBLIC_WIDGET_CONFIG_ORIGIN: devOrigin,
    NEXT_PUBLIC_EMBED_API_URL: devOrigin,
    NEXT_PUBLIC_CAVBOT_LIVE_MODE: "0",
    NEXT_PUBLIC_CAVBOT_DISABLE_EVENTS: "1",
    CAVBOT_DISABLE_EVENTS: "1",
  };

  const devDatabaseUrl = String(baseEnv.CAVBOT_DEV_DATABASE_URL || "").trim();
  const devDirectUrl = String(baseEnv.CAVBOT_DEV_DIRECT_URL || "").trim();
  if (devDatabaseUrl) env.DATABASE_URL = devDatabaseUrl;
  if (devDirectUrl) {
    env.DIRECT_URL = devDirectUrl;
  } else if (devDatabaseUrl) {
    env.DIRECT_URL = devDatabaseUrl;
  }

  assertSafeLocalDatabase(env);

  const allowLiveIntegrations = isTruthyFlag(baseEnv.CAVBOT_ALLOW_LIVE_INTEGRATIONS_IN_DEV);
  const strippedKeys = [];
  if (!allowLiveIntegrations) {
    for (const key of ALWAYS_STRIPPED_INTEGRATION_ENV_KEYS) {
      if (!String(env[key] || "").trim()) continue;
      env[key] = "";
      strippedKeys.push(key);
    }

    const hasStripeTestKeys =
      isStripeTestSecretKey(baseEnv.STRIPE_SECRET_KEY)
      || isStripeTestPublishableKey(baseEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
    if (!hasStripeTestKeys) {
      for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]) {
        if (!String(env[key] || "").trim()) continue;
        env[key] = "";
        strippedKeys.push(key);
      }
    }
  }

  const localDbSource =
    LOCAL_DB_ENV_KEYS.find((key) => String(baseEnv[key] || "").trim())
    || (String(env.DATABASE_URL || "").trim() ? "DATABASE_URL" : "");

  const modeSummary = [
    `[cavbot dev] Safe localhost mode enabled.`,
    `[cavbot dev] Origin: ${devOrigin}`,
    `[cavbot dev] Database source: ${localDbSource || "unset"}`,
  ];
  if (strippedKeys.length) {
    modeSummary.push(`[cavbot dev] Stripped live integrations: ${strippedKeys.join(", ")}`);
  }
  console.log(`\n${modeSummary.join("\n")}\n`);

  return env;
}

const root = process.cwd();
const devEnvSnapshot = loadDevEnvSnapshot(root);
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
const childEnv = applySafeLocalhostEnv({
  ...devEnvSnapshot,
  // Keep local dev overlay focused on app errors by skipping Next telemetry/version staleness checks.
  NEXT_TELEMETRY_DISABLED: devEnvSnapshot.NEXT_TELEMETRY_DISABLED || "1",
});
const child = spawn(cmd, args, { stdio: "inherit", env: childEnv });

function shutdown(code) {
  clearInterval(int);
  process.exit(code);
}

child.on("exit", (code) => shutdown(typeof code === "number" ? code : 1));
child.on("error", () => shutdown(1));

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
