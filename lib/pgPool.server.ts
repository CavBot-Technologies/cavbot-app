import "server-only";

import pg from "pg";

function envPositiveInt(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function isWorkerdRuntime() {
  const versions = process.versions as NodeJS.ProcessVersions & { workerd?: string };
  return Boolean(versions.workerd) || String(process.env.CF_PAGES || "").trim() === "1";
}

function poolConfig(connectionString: string): pg.PoolConfig {
  const workerd = isWorkerdRuntime();
  return {
    connectionString,
    max: envPositiveInt("CAVBOT_PG_POOL_MAX", workerd ? 4 : 10),
    idleTimeoutMillis: envPositiveInt("CAVBOT_PG_IDLE_TIMEOUT_MS", workerd ? 10_000 : 30_000),
    connectionTimeoutMillis: envPositiveInt("CAVBOT_PG_CONNECT_TIMEOUT_MS", workerd ? 4_000 : 5_000),
    query_timeout: envPositiveInt("CAVBOT_PG_QUERY_TIMEOUT_MS", workerd ? 8_000 : 15_000),
    statement_timeout: envPositiveInt("CAVBOT_PG_STATEMENT_TIMEOUT_MS", workerd ? 8_000 : 15_000),
    keepAlive: true,
  };
}

export function createLoggedPgPool(connectionString: string, label: string) {
  const pool = new pg.Pool(poolConfig(connectionString));
  pool.on("error", (error) => {
    console.error(`[${label}] pg pool idle client error`, error);
  });
  return pool;
}
