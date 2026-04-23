import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const workerSource = fs.readFileSync(path.resolve("public/codex/cloudfare-anlytics-worker.js"), "utf8");
const workerCommonJs = workerSource
  .replace("export class RateLimiter", "class RateLimiter")
  .replace(/export default\s+([^;]+);/, "const __workerDefaultExport = $1;")
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
vm.runInContext(workerCommonJs, workerSandbox, { filename: "cloudfare-anlytics-worker.js" });
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
