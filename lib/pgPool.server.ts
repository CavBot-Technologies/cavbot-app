import "server-only";

import pg from "pg";

function envPositiveInt(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function envNonNegativeInt(name: string, fallback: number) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function isWorkerdRuntime() {
  const versions = process.versions as NodeJS.ProcessVersions & { workerd?: string };
  return Boolean(versions.workerd) || String(process.env.CF_PAGES || "").trim() === "1";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readQueryText(arg: unknown) {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object" && "text" in arg) {
    const text = (arg as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function isRetriableReadTimeout(error: unknown, arg: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "");
  if (!/query read timeout|statement timeout|timeout exceeded/i.test(message)) {
    return false;
  }

  const text = readQueryText(arg).trim().toUpperCase();
  if (!text) return false;
  return (
    text.startsWith("SELECT") ||
    text.startsWith("WITH") ||
    text.startsWith("SHOW") ||
    text.startsWith("EXPLAIN")
  );
}

function wrapQueryWithRetry<TArgs extends unknown[], TResult>(
  label: string,
  query: (...args: TArgs) => Promise<TResult>,
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await query(...args);
    } catch (error) {
      if (!isRetriableReadTimeout(error, args[0])) {
        throw error;
      }

      console.warn(`[${label}] retrying timed out read query once`);
      await sleep(40);
      return await query(...args);
    }
  };
}

function poolConfig(connectionString: string): pg.PoolConfig {
  const workerd = isWorkerdRuntime();
  const queryTimeoutMs = envNonNegativeInt("CAVBOT_PG_QUERY_TIMEOUT_MS", workerd ? 30_000 : 15_000);
  const statementTimeoutMs = envNonNegativeInt(
    "CAVBOT_PG_STATEMENT_TIMEOUT_MS",
    workerd ? 30_000 : 15_000,
  );

  const config: pg.PoolConfig = {
    connectionString,
    // Keep the edge pool bounded, but large enough that one slow request cannot
    // starve every other auth/bootstrap read in the same isolate.
    max: envPositiveInt("CAVBOT_PG_POOL_MAX", workerd ? 4 : 10),
    idleTimeoutMillis: envPositiveInt("CAVBOT_PG_IDLE_TIMEOUT_MS", workerd ? 30_000 : 30_000),
    connectionTimeoutMillis: envPositiveInt("CAVBOT_PG_CONNECT_TIMEOUT_MS", workerd ? 30_000 : 5_000),
    keepAlive: true,
  };

  if (queryTimeoutMs > 0) {
    config.query_timeout = queryTimeoutMs;
  }

  if (statementTimeoutMs > 0) {
    config.statement_timeout = statementTimeoutMs;
  }

  return config;
}

export function createLoggedPgPool(connectionString: string, label: string) {
  const pool = new pg.Pool(poolConfig(connectionString));
  const originalPoolQuery = pool.query.bind(pool);
  pool.query = wrapQueryWithRetry(label, originalPoolQuery) as typeof pool.query;

  const originalConnect = pool.connect.bind(pool);
  pool.connect = (async () => {
    const client = await originalConnect();
    const originalClientQuery = client.query.bind(client);
    client.query = wrapQueryWithRetry(label, originalClientQuery) as typeof client.query;
    return client;
  }) as typeof pool.connect;

  pool.on("error", (error) => {
    console.error(`[${label}] pg pool idle client error`, error);
  });
  return pool;
}
