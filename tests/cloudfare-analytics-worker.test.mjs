import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const workerSource = fs.readFileSync(path.resolve("cloudfare.worker.js"), "utf8");
const workerCommonJs = workerSource
  .replace("export class RateLimiter", "class RateLimiter")
  .replace("export default withTopLevelGuard(worker);", "const __workerDefaultExport = withTopLevelGuard(worker);")
  .replace("export default {", "const __workerDefaultExport = {")
  .concat("\nmodule.exports = { default: __workerDefaultExport, RateLimiter };");

const workerSandbox = {
  module: { exports: {} },
  exports: {},
  Request,
  Response,
  URL,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
  console,
  setTimeout,
  clearTimeout,
};

vm.createContext(workerSandbox);
vm.runInContext(workerCommonJs, workerSandbox, { filename: "cloudfare.worker.js" });
const worker = workerSandbox.module.exports.default;

async function sha256HexLocal(input) {
  const data = new TextEncoder().encode(String(input || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class FakeBoundStmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = String(sql || "");
    this.args = args;
  }

  bind(...args) {
    return new FakeBoundStmt(this.db, this.sql, args);
  }

  async first() {
    const sql = this.sql.toLowerCase();

    if (sql.includes("from project_keys")) {
      const keyHash = String(this.args[0] || "");
      const row = this.db.projectKeysByHash.get(keyHash);
      if (!row) return null;
      return {
        project_id: Number(row.project_id),
        key_prefix: String(row.key_prefix || "pk"),
        scope: row.scope == null ? null : String(row.scope),
        revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
      };
    }

    if (
      sql.includes("from sites") &&
      sql.includes("where project_id = ?") &&
      sql.includes("and public_id = ?")
    ) {
      const projectId = Number(this.args[0]);
      const publicId = String(this.args[1] || "");
      if (projectId === this.db.site.project_id && publicId === this.db.site.public_id) {
        return {
          id: this.db.site.id,
          public_id: this.db.site.public_id,
          origin: this.db.site.origin,
          host: this.db.site.host,
          label: this.db.site.label,
          is_active: 1,
        };
      }
      return null;
    }

    if (
      sql.includes("from sites") &&
      sql.includes("where project_id = ?") &&
      sql.includes("and origin = ?")
    ) {
      const projectId = Number(this.args[0]);
      const origin = String(this.args[1] || "");
      if (projectId === this.db.site.project_id && origin === this.db.site.origin) {
        return {
          id: this.db.site.id,
          public_id: this.db.site.public_id,
          origin: this.db.site.origin,
          host: this.db.site.host,
          label: this.db.site.label,
          is_active: 1,
        };
      }
      return null;
    }

    if (sql.includes("from events")) {
      return this.db.firstEventQuery(sql, this.args);
    }

    if (sql.includes("select count(*) as n") || sql.includes("count(distinct")) {
      return { n: 0 };
    }

    return null;
  }

  async all() {
    const sql = this.sql.toLowerCase();

    if (sql.includes("from sites") && sql.includes("order by created_at")) {
      const projectId = Number(this.args[0]);
      if (projectId === this.db.site.project_id) {
        return {
          results: [
            {
              public_id: this.db.site.public_id,
              origin: this.db.site.origin,
              host: this.db.site.host,
              label: this.db.site.label,
              is_active: 1,
            },
          ],
        };
      }
      return { results: [] };
    }

    if (sql.includes("from events")) {
      return { results: this.db.allEventQuery(sql, this.args) };
    }

    return { results: [] };
  }

  async run() {
    return { meta: { changes: 1 } };
  }
}

class FakeAnalyticsDb {
  constructor() {
    this.site = {
      id: 1,
      project_id: 1,
      public_id: "site_test_pubid",
      origin: "https://example.com",
      host: "example.com",
      label: "Example",
    };
    this.inserted = [];
    this.projectKeysByHash = new Map();
  }

  prepare(sql) {
    return new FakeBoundStmt(this, sql);
  }

  eventRows() {
    return this.inserted
      .map((stmt) => {
        const args = stmt.args || [];
        if (args.length < 14) return null;
        return {
          project_id: Number(args[0]),
          site_id: Number(args[1]),
          anonymous_id: String(args[2] || ""),
          session_key: String(args[3] || ""),
          page_url: String(args[4] || ""),
          route_path: String(args[5] || ""),
          event_name: String(args[10] || ""),
          event_timestamp: String(args[11] || new Date().toISOString()),
          created_at: new Date().toISOString(),
        };
      })
      .filter(Boolean);
  }

  filteredEventRows(sql, args) {
    const projectId = Number(args[0]);
    const hasSiteFilter = sql.includes("and site_id = ?");
    const siteId = hasSiteFilter ? Number(args[args.length - 1]) : null;
    const aggregateOnly =
      sql.includes("sum(case when event_name") ||
      sql.includes("group by route_path") ||
      sql.includes("substr(event_timestamp");
    return this.eventRows().filter((row) => {
      if (row.project_id !== projectId) return false;
      if (siteId != null && row.site_id !== siteId) return false;
      if (aggregateOnly) return true;
      if (sql.includes("'cavbot_page_view'") && !["cavbot_page_view", "page_view", "pageview", "cavbot_pageview"].includes(row.event_name)) return false;
      if (sql.includes("'cavbot_route_change'") && row.event_name !== "cavbot_route_change") return false;
      if (sql.includes("'cavbot_404'") && row.event_name !== "cavbot_404") return false;
      if (sql.includes("'cavbot_js_error'") && !["cavbot_js_error", "js_error", "javascript_error", "window_error", "cavbot_error"].includes(row.event_name)) return false;
      if (sql.includes("'cavbot_api_error'") && !["cavbot_api_error", "api_error", "fetch_error", "http_error", "network_error"].includes(row.event_name)) return false;
      return true;
    });
  }

  firstEventQuery(sql, args) {
    const rows = this.filteredEventRows(sql, args);
    if (sql.includes("max(created_at) as ts")) {
      return { ts: rows.length ? new Date().toISOString() : null };
    }
    if (sql.includes("count(distinct route_path)")) {
      return { n: new Set(rows.map((row) => row.route_path).filter(Boolean)).size };
    }
    if (sql.includes("count(distinct session_key)")) {
      return { n: new Set(rows.map((row) => row.session_key).filter(Boolean)).size };
    }
    if (sql.includes("count(distinct anonymous_id)")) {
      return { n: new Set(rows.map((row) => row.anonymous_id).filter(Boolean)).size };
    }
    if (sql.includes("count(*) as n")) {
      return { n: rows.length };
    }
    return null;
  }

  allEventQuery(sql, args) {
    const rows = this.filteredEventRows(sql, args);
    if (sql.includes("group by route_path")) {
      const grouped = new Map();
      for (const row of rows) {
        if (!row.route_path) continue;
        const current = grouped.get(row.route_path) || {
          routePath: row.route_path,
          views: 0,
          sessions: new Set(),
          views404: 0,
          jsErrors: 0,
          apiErrors: 0,
          lastSeenISO: row.event_timestamp,
        };
        if (row.event_name === "cavbot_page_view") current.views += 1;
        if (row.session_key) current.sessions.add(row.session_key);
        if (row.event_name === "cavbot_404") current.views404 += 1;
        if (row.event_name === "cavbot_js_error") current.jsErrors += 1;
        if (row.event_name === "cavbot_api_error") current.apiErrors += 1;
        current.lastSeenISO = row.event_timestamp || current.lastSeenISO;
        grouped.set(row.route_path, current);
      }
      return [...grouped.values()].map((row) => ({
        ...row,
        sessions: row.sessions.size,
      }));
    }
    if (sql.includes("substr(event_timestamp")) {
      const byDay = new Map();
      for (const row of rows) {
        const day = row.event_timestamp.slice(0, 10);
        const current = byDay.get(day) || { day, sessions: new Set(), views404: 0, jsErrors: 0, apiErrors: 0 };
        if (row.session_key) current.sessions.add(row.session_key);
        if (row.event_name === "cavbot_404") current.views404 += 1;
        if (row.event_name === "cavbot_js_error") current.jsErrors += 1;
        if (row.event_name === "cavbot_api_error") current.apiErrors += 1;
        byDay.set(day, current);
      }
      return [...byDay.values()].map((row) => ({ ...row, sessions: row.sessions.size }));
    }
    if (sql.includes("select event_timestamp")) {
      return rows.map((row) => ({
        event_timestamp: row.event_timestamp,
        event_name: row.event_name,
        route_path: row.route_path,
        page_url: row.page_url,
        payload_json: "{}",
      }));
    }
    return [];
  }

  async batch(statements) {
    this.inserted.push(...statements.map((stmt) => ({ sql: stmt.sql, args: stmt.args })));
    return [];
  }
}

function createEnv(opts = {}) {
  const db = opts.db || new FakeAnalyticsDb();
  const envOverrides = opts.env || {};

  return {
    CAVBOT_PROJECT_KEY: "cavbot_pk_test",
    CAVBOT_SINGLE_TENANT: "1",
    DEFAULT_PROJECT_ID: "1",
    ANALYTICS_DB: db,
    RL: {
      idFromName(name) {
        return String(name || "");
      },
      get() {
        return {
          fetch: async () =>
            new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        };
      },
    },
    ...envOverrides,
  };
}

function createCtx() {
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch(() => {});
    },
  };
}

function baseRecord() {
  return {
    project_key: "cavbot_pk_test",
    site_public_id: "site_test_pubid",
    site_host: "example.com",
    site_origin: "https://example.com",
    event_id: "evt_test_1",
    ts: Date.now(),
    event_timestamp: new Date().toISOString(),
    event_name: "cavbot_page_view",
    event_type: "page_view",
    anonymous_id: "anon_test",
    visitor_id: "vis_test",
    session_key: "sess_test",
    page_url: "https://example.com/",
    route_path: "/",
    page_type: "marketing-page",
    component: "page-shell",
    referrer_url: "",
    referrer_host: "",
    user_agent_hash: "h1",
    ip_hash: null,
    is_bot: null,
    payload_json: JSON.stringify({ path: "/" }),
    meta_json: JSON.stringify({ sdk_version: "cavbot-web-js-v5.4", env: "production" }),
  };
}

function baseHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Origin: "https://example.com",
    "X-Project-Key": "cavbot_pk_test",
    "X-Cavbot-Sdk-Version": "cavbot-web-js-v5.4",
    "X-Cavbot-Env": "production",
    "X-Cavbot-Site-Host": "example.com",
    "X-Cavbot-Site-Origin": "https://example.com",
    "X-Cavbot-Site-Public-Id": "site_test_pubid",
    ...extra,
  };
}

test("POST /v1/events accepts valid v5 payload", async () => {
  const env = createEnv();
  const payload = {
    project_key: "cavbot_pk_test",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [baseRecord()],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });

  Object.defineProperty(req, "cf", {
    value: { country: "US", continent: "NA", region: "GA", colo: "ATL" },
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.ok, true);
  assert.equal(json.received, 1);
  assert.equal(json.inserted, 1);
  assert.equal(json.dropped, 0);
  assert.equal(env.ANALYTICS_DB.inserted.length, 1);
});

test("POST /v1/events normalizes page_view route paths for page discovery", async () => {
  const env = createEnv({ env: { EVENTS_SCHEMA_V2: "1" } });
  const record = baseRecord();
  record.event_name = "page_view";
  record.event_type = "page_view";
  record.page_url = "https://example.com/pricing?utm=test#plans";
  record.route_path = "";
  record.payload_json = JSON.stringify({ path: "/pricing" });

  const payload = {
    project_key: "cavbot_pk_test",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [record],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.inserted, 1);
  const inserted = env.ANALYTICS_DB.inserted[0];
  assert.equal(inserted.args[5], "/pricing");
  assert.equal(inserted.args[10], "cavbot_page_view");
});

test("real v5 page_view appears in summary routes and SEO page discovery", async () => {
  const env = createEnv({ env: { EVENTS_SCHEMA_V2: "1", CAVBOT_SECRET_KEY: "cavbot_sk_dashboard" } });
  const record = baseRecord();
  record.page_url = "https://example.com/features";
  record.route_path = "/features";

  const ingestReq = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify({
      project_key: "cavbot_pk_test",
      site: {
        origin: "https://example.com",
        host: "example.com",
        site_public_id: "site_test_pubid",
      },
      sdk_version: "cavbot-web-js-v5.4",
      env: "production",
      records: [record],
    }),
  });

  const ingestRes = await worker.fetch(ingestReq, env, createCtx());
  assert.equal(ingestRes.status, 202);

  const summaryReq = new Request("https://worker.test/v1/projects/1/summary?range=7d&origin=https://example.com", {
    method: "GET",
    headers: { "X-Project-Key": "cavbot_sk_dashboard" },
  });

  const summaryRes = await worker.fetch(summaryReq, env, createCtx());
  const summary = await summaryRes.json();

  assert.equal(summaryRes.status, 200);
  assert.equal(summary.metrics.pageViews24h, 1);
  assert.equal(summary.metrics.routesMonitored, 1);
  assert.equal(summary.routes.rollup.pagesObserved ?? summary.seo.rollup.pagesObserved, 1);
  assert.equal(summary.routes.topRoutes[0].routePath, "/features");
  assert.equal(summary.seo.pages[0].urlPath, "/features");
});

test("trusted app proxy forwarded client IP drives ingest rate buckets", async () => {
  let consumedKey = "";
  const env = createEnv({
    env: {
      CAVBOT_ADMIN_TOKEN: "admin_test_token",
      RL: {
        idFromName(name) {
          consumedKey = String(name || "");
          return consumedKey;
        },
        get() {
          return {
            fetch: async (_url, init) => {
              const body = JSON.parse(String(init?.body || "{}"));
              consumedKey = String(body.key || consumedKey || "");
              return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            },
          };
        },
      },
    },
  });

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders({
      "CF-Connecting-IP": "198.51.100.10",
      "X-Admin-Token": "admin_test_token",
      "X-Cavbot-Forwarded-Client-IP": "203.0.113.42",
    }),
    body: JSON.stringify({
      project_key: "cavbot_pk_test",
      site: {
        origin: "https://example.com",
        host: "example.com",
        site_public_id: "site_test_pubid",
      },
      sdk_version: "cavbot-web-js-v5.4",
      env: "production",
      records: [baseRecord()],
    }),
  });

  const res = await worker.fetch(req, env, createCtx());
  assert.equal(res.status, 202);
  assert.equal(consumedKey.endsWith("|203.0.113.42"), true);
  assert.equal(consumedKey.includes("198.51.100.10"), false);
});

test("trusted app proxy can ingest an app-verified key missing from worker D1", async () => {
  const env = createEnv({
    env: {
      CAVBOT_ADMIN_TOKEN: "admin_test_token",
      CAVBOT_PROJECT_KEY: "cavbot_pk_different_env_key",
      NEXT_PUBLIC_CAVBOT_PROJECT_KEY: "",
      CAVBOT_PUBLISHABLE_KEY: "",
    },
  });
  const record = baseRecord();
  record.project_key = "cavbot_pk_app_verified_only";

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders({
      "X-Project-Key": "cavbot_pk_app_verified_only",
      "X-Admin-Token": "admin_test_token",
      "X-Cavbot-Project-Id": "1",
      "X-Cavbot-Verified-Site-Id": "site_test_pubid",
      "X-Cavbot-Forwarded-Client-IP": "203.0.113.42",
    }),
    body: JSON.stringify({
      project_key: "cavbot_pk_app_verified_only",
      site: {
        origin: "https://example.com",
        host: "example.com",
        site_public_id: "site_test_pubid",
      },
      sdk_version: "cavbot-web-js-v5.4",
      env: "production",
      records: [record],
    }),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.inserted, 1);
  assert.equal(env.ANALYTICS_DB.inserted.length, 1);
});

test("OPTIONS /v1/events returns CORS preflight headers", async () => {
  const env = createEnv();
  const req = new Request("https://worker.test/v1/events", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Headers":
        "X-Project-Key, X-Cavbot-Sdk-Version, X-Cavbot-Env, X-Cavbot-Site-Origin, Content-Type",
    },
  });

  const res = await worker.fetch(req, env, createCtx());
  const allowHeaders = res.headers.get("Access-Control-Allow-Headers") || "";

  assert.ok(res.status === 204 || res.status === 200);
  assert.ok(allowHeaders.includes("X-Project-Key"));
  assert.ok(allowHeaders.includes("X-Cavbot-Site-Origin"));
  assert.ok(allowHeaders.includes("Content-Type"));
});

test("POST /v1/events drops records with missing required fields", async () => {
  const env = createEnv();
  const badRecord = baseRecord();
  delete badRecord.event_id;

  const payload = {
    project_key: "cavbot_pk_test",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [badRecord],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.ok, true);
  assert.equal(json.inserted, 0);
  assert.equal(json.dropped, 1);
  assert.equal(env.ANALYTICS_DB.inserted.length, 0);
});

test("POST /v1/events keeps good records when one record is bad", async () => {
  const env = createEnv();
  const good = baseRecord();
  const bad = baseRecord();
  delete bad.event_id;

  const payload = {
    project_key: "cavbot_pk_test",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [good, bad],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.inserted, 1);
  assert.equal(json.dropped, 1);
  assert.equal(env.ANALYTICS_DB.inserted.length, 1);
});

test("POST /v1/events coerces invalid payload/meta JSON with ingest warnings", async () => {
  const env = createEnv();
  const r = baseRecord();
  r.payload_json = "{";
  r.meta_json = "{";

  const payload = {
    project_key: "cavbot_pk_test",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [r],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.inserted, 1);
  assert.equal(json.dropped, 0);

  const inserted = env.ANALYTICS_DB.inserted[0];
  const payloadStr = String(inserted.args[inserted.args.length - 2] || "{}");
  const payloadObj = JSON.parse(payloadStr);
  assert.ok(Array.isArray(payloadObj?.__cavbot?.ingest_warnings));
  assert.ok(payloadObj.__cavbot.ingest_warnings.includes("invalid_payload_json"));
  assert.ok(payloadObj.__cavbot.ingest_warnings.includes("invalid_meta_json"));
});

test("GET /v1/projects/:id/sites blocks publishable key", async () => {
  const env = createEnv();
  const req = new Request("https://worker.test/v1/projects/1/sites", {
    method: "GET",
    headers: {
      "X-Project-Key": "cavbot_pk_test",
    },
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 403);
  assert.equal(json.error, "insufficient_key_scope");
});

test("GET /v1/projects/:id/sites allows secret key with dashboard scope", async () => {
  const env = createEnv({ env: { CAVBOT_SECRET_KEY: "cavbot_sk_dashboard" } });
  const req = new Request("https://worker.test/v1/projects/1/sites", {
    method: "GET",
    headers: {
      "X-Project-Key": "cavbot_sk_dashboard",
    },
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 200);
  assert.equal(json.project.id, "1");
  assert.equal(Array.isArray(json.sites), true);
  assert.equal(json.sites.length, 1);
});

test("POST /v1/events never stores raw secret key in events rows", async () => {
  const env = createEnv({ env: { CAVBOT_SECRET_KEY: "cavbot_sk_ingest" } });
  const payload = {
    project_key: "cavbot_sk_ingest",
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [baseRecord()],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders({ "X-Project-Key": "cavbot_sk_ingest" }),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 202);
  assert.equal(json.inserted, 1);

  const inserted = env.ANALYTICS_DB.inserted[0];
  const storedProjectKey = String(inserted.args[inserted.args.length - 1] || "");
  assert.notEqual(storedProjectKey, "cavbot_sk_ingest");
  assert.ok(storedProjectKey.startsWith("sk_"));
});

test("POST /v1/events rejects D1 key without ingest scope", async () => {
  const db = new FakeAnalyticsDb();
  const rawKey = "cavbot_sk_d1_dashboard_only";
  const keyHash = await sha256HexLocal(rawKey);
  db.projectKeysByHash.set(keyHash, {
    project_id: 1,
    key_prefix: "sk",
    scope: "dashboard",
    revoked_at: null,
  });

  const env = createEnv({
    db,
    env: {
      CAVBOT_PROJECT_KEY: "",
      CAVBOT_SECRET_KEY: "",
      CAVBOT_PUBLISHABLE_KEY: "",
      CAVBOT_PROJECT_PK: "",
      CAVBOT_PROJECT_SK: "",
      NEXT_PUBLIC_CAVBOT_PROJECT_KEY: "",
    },
  });

  const payload = {
    project_key: rawKey,
    site: {
      origin: "https://example.com",
      host: "example.com",
      site_public_id: "site_test_pubid",
    },
    sdk_version: "cavbot-web-js-v5.4",
    env: "production",
    records: [baseRecord()],
  };

  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders({ "X-Project-Key": rawKey }),
    body: JSON.stringify(payload),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 403);
  assert.equal(json.error, "insufficient_key_scope");
  assert.equal(env.ANALYTICS_DB.inserted.length, 0);
});

test("POST /v1/events rejects oversized payloads", async () => {
  const env = createEnv();
  const req = new Request("https://worker.test/v1/events", {
    method: "POST",
    headers: baseHeaders({ "Content-Length": "200000" }),
    body: JSON.stringify({ project_key: "cavbot_pk_test", records: [] }),
  });

  const res = await worker.fetch(req, env, createCtx());
  const json = await res.json();

  assert.equal(res.status, 413);
  assert.equal(json.ok, false);
  assert.equal(json.error, "payload_too_large");
});
