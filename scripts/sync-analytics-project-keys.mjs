import { config as loadEnv } from "dotenv";
import pgPkg from "pg";

const { Pool } = pgPkg;

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
loadEnv({ path: ".env.production.local", override: true });

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const CAVBOT_API_BASE_URL = normalizeBaseUrl(
  String(process.env.CAVBOT_API_BASE_URL || process.env.CAVBOT_API_URL || "").trim()
);
const CAVBOT_ADMIN_TOKEN = String(process.env.CAVBOT_ADMIN_TOKEN || "").trim();

if (!DATABASE_URL) throw new Error("DATABASE_URL is missing.");
if (!CAVBOT_API_BASE_URL) throw new Error("CAVBOT_API_BASE_URL or CAVBOT_API_URL is missing.");
if (!CAVBOT_ADMIN_TOKEN) throw new Error("CAVBOT_ADMIN_TOKEN is missing.");

function normalizeBaseUrl(input) {
  if (!input) return "";
  try {
    return new URL(input).origin.replace(/\/+$/, "");
  } catch {
    return input
      .replace(/\/v1\/events\/?$/i, "")
      .replace(/\/v1\/?$/i, "")
      .replace(/\/+$/, "");
  }
}

function normalizeKeyPrefix(prefix, type) {
  const raw = String(prefix || "").trim().toLowerCase();
  if (raw.startsWith("cavbot_sk") || raw === "sk" || raw === "secret") return "sk";
  if (raw.startsWith("cavbot_pk") || raw === "pk" || raw === "publishable") return "pk";
  const normalizedType = String(type || "").trim().toUpperCase();
  return normalizedType === "SECRET" || normalizedType === "ADMIN" ? "sk" : "pk";
}

function normalizeWorkerScope(row) {
  let hasIngest = false;
  let hasAdmin = false;
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];

  for (const rawScope of scopes) {
    const scope = String(rawScope || "").trim().toLowerCase();
    if (!scope) continue;
    if (
      scope === "events:write" ||
      scope === "analytics:write" ||
      scope === "analytics:events" ||
      scope === "ingest"
    ) {
      hasIngest = true;
    }
    if (
      scope === "admin:all" ||
      scope === "analytics:read" ||
      scope === "dashboard" ||
      scope === "dashboard:read"
    ) {
      hasAdmin = true;
    }
  }

  if (row.type === "SECRET" || row.type === "ADMIN" || hasAdmin) return "admin";
  if (hasIngest) return "ingest";
  return "ingest";
}

function revokedAtFor(row) {
  if (row.status === "ACTIVE") return null;
  const value = row.rotatedAt || row.updatedAt || new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Admin-Token": CAVBOT_ADMIN_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const detail =
      body?.message && body?.error ? `${body.error}: ${body.message}` :
      body?.message || body?.error || text || `HTTP ${res.status}`;
    throw new Error(`Worker key sync failed: ${detail}`);
  }

  return body;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const result = await pool.query(
      `SELECT
         "projectId",
         "type",
         "status",
         "prefix",
         "keyHash",
         "scopes",
         "rotatedAt",
         "updatedAt"
       FROM "ApiKey"
       WHERE "projectId" IS NOT NULL
         AND "keyHash" IS NOT NULL
       ORDER BY "projectId" ASC, "createdAt" ASC`
    );

    const byProject = new Map();
    for (const row of result.rows) {
      const projectId = Number(row.projectId);
      const keyHash = String(row.keyHash || "").trim().toLowerCase();
      if (!Number.isInteger(projectId) || projectId <= 0) continue;
      if (!/^[a-f0-9]{64}$/.test(keyHash)) continue;

      const entry = {
        keyHash,
        keyPrefix: normalizeKeyPrefix(row.prefix, row.type),
        scope: normalizeWorkerScope(row),
        revokedAt: revokedAtFor(row),
      };

      const list = byProject.get(projectId) || [];
      list.push(entry);
      byProject.set(projectId, list);
    }

    let projectCount = 0;
    let keyCount = 0;
    for (const [projectId, keys] of byProject.entries()) {
      for (const batch of chunk(keys, 100)) {
        await postJson(`${CAVBOT_API_BASE_URL}/v1/admin/projects/${projectId}/keys`, { keys: batch });
        keyCount += batch.length;
      }
      projectCount += 1;
      console.log(`synced project ${projectId}: ${keys.length} key rows`);
    }

    console.log(`analytics key sync complete: ${projectCount} projects, ${keyCount} key rows`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
