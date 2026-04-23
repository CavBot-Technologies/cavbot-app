// cavbot-analytics Worker (enterprise key resolution, no random 401s)
// - Accepts project key from: X-Project-Key OR Authorization: Bearer <key>
// - Resolves keys from ENV first (CAVBOT_PROJECT_KEY, NEXT_PUBLIC_CAVBOT_PROJECT_KEY, etc)
// - Optional fallback to D1 project_keys (project_id, key_prefix, key_hash, scope, revoked_at)
// - Optional single-tenant mode so mismatched /projects/:id won't 401 your UI
//
// Step 5 hardening:
// A) Rate limiting / abuse protection by project_id + origin + IP (Durable Object token bucket)
// B) Origin pattern support (careful wildcard): allows sites.origin rows like "https://*.client.com"
//
// Geo Intelligence (Billion Co mode):
// - Ingest stamps __cavbot.geo = { country, continent, subdivision, cavbotRegionId, cavbotRegionName }
// - Supports BOTH payload shapes:
//   (v5) { project_key, site, sdk_version, env, records[] }
//   (legacy) { projectKey, pageUrl, events[] }

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let data = null;
    try {
      data = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const key = String(data?.key || "").trim();
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "missing_key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cap = Math.max(1, Number(data?.capacity || 120));
    const refill = Math.max(0.1, Number(data?.refillPerSec || 2));
    const now = Date.now();

    try {
      const stored = (await this.state.storage.get("bucket")) || {
        tokens: cap,
        last: now,
      };

      const elapsedSec = Math.max(0, (now - Number(stored.last || now)) / 1000);
      const refilled = Math.min(cap, Number(stored.tokens || 0) + elapsedSec * refill);

      if (refilled < 1) {
        await this.state.storage.put("bucket", { tokens: refilled, last: now });
        return new Response(JSON.stringify({ ok: false, limited: true, key }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      await this.state.storage.put("bucket", { tokens: refilled - 1, last: now });
      return new Response(JSON.stringify({ ok: true, key }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("rate_limiter_storage_error", { message: String(e?.message || e) });
      return new Response(
        JSON.stringify({ ok: false, error: "rate_limiter_unavailable" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
}

function getIp(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "0.0.0.0"
  );
}

function makeStatusError(code, status, message) {
  return Object.assign(new Error(message || code), {
    code: String(code || "worker_error"),
    status: Number(status || 500),
  });
}

async function enforceRateLimit(req, env, projectId, origin, opts) {
  const rlRequired = String(env?.RL_REQUIRED || "0") === "1";

  if (!env?.RL) {
    console.error("missing_rl_binding", {
      projectId: String(projectId || ""),
      origin: String(origin || ""),
    });
    if (rlRequired) throw makeStatusError("missing_rl_binding", 500, "Rate limiter binding missing");
    return;
  }

  const ip = getIp(req);
  const o = String(origin || "no-origin").slice(0, 500);
  const pid = String(projectId || "0");

  // key = project_id + origin + IP
  const key = `${pid}|${o}|${ip}`;

  try {
    const id = env.RL.idFromName(key);
    const stub = env.RL.get(id);

    const res = await stub.fetch("https://rl/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        capacity: opts?.capacity ?? 120,
        refillPerSec: opts?.refillPerSec ?? 2,
      }),
    });

    if (res.status === 429) {
      throw makeStatusError("rate_limited", 429, "Rate limited");
    }

    if (res.status >= 500) {
      console.error("rate_limiter_service_error", { status: res.status, key });
      if (rlRequired) throw makeStatusError("rate_limiter_unavailable", 503, "Rate limiter unavailable");
    }
  } catch (e) {
    if (e?.status === 429) throw e;

    console.error("enforce_rate_limit_failed", {
      key,
      message: String(e?.message || e),
    });

    if (rlRequired) throw makeStatusError("rate_limiter_failed", 503, "Rate limiter failed");
  }
}

function withTopLevelGuard(handler) {
  return {
    async fetch(request, env, ctx) {
      const requestId =
        request.headers.get("X-Request-Id") ||
        request.headers.get("x-request-id") ||
        crypto.randomUUID();

      try {
        return await handler.fetch(request, env, ctx);
      } catch (e) {
        const status = Number(e?.status || 500);
        const safeStatus = status >= 400 && status < 600 ? status : 500;
        const errorCode = String(e?.code || "worker_exception");
        const message = String(e?.message || "Worker exception");

        try {
          console.error(
            "worker_unhandled_exception",
            JSON.stringify({
              request_id: requestId,
              path: new URL(request.url).pathname,
              method: request.method,
              status: safeStatus,
              code: errorCode,
              message,
            })
          );
        } catch {
          console.error("worker_unhandled_exception", message);
        }

        return new Response(
          JSON.stringify({
            ok: false,
            error: errorCode,
            message,
            request_id: requestId,
          }),
          {
            status: safeStatus,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          }
        );
      }
    },
  };
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const EVENTS_SCHEMA_V2 = String(env.EVENTS_SCHEMA_V2 || "") === "1";
    const SINGLE_TENANT = String(env.CAVBOT_SINGLE_TENANT || "1") === "1"; // default ON for your setup
    const DEFAULT_PROJECT_ID = Number(env.DEFAULT_PROJECT_ID || env.CAVBOT_DEFAULT_PROJECT_ID || 1);
    const ANALYTICS_DB = env.ANALYTICS_DB || env.DB || null;

    // =========================
    // ROUTE CLASSIFICATION
    // =========================
    const isHealth = request.method === "GET" && path === "/health";

    const isIngest = path === "/v1/events" && request.method === "POST";
    const isIngestPreflight = path === "/v1/events" && request.method === "OPTIONS";

    const isAdmin = path.startsWith("/v1/admin/");
    const isProjectSites =
      request.method === "GET" &&
      path.startsWith("/v1/projects/") &&
      path.endsWith("/sites");
    const isProjectSummary =
      request.method === "GET" &&
      path.startsWith("/v1/projects/") &&
      path.endsWith("/summary");

    // Geo endpoint: region + country breakdown
    const isProjectGeo =
      request.method === "GET" &&
      path.startsWith("/v1/projects/") &&
      path.endsWith("/geo");

    const isAdminVerify = isAdmin && request.method === "GET" && path === "/v1/admin/verify";

    const adminSitesRouteMatch = path.match(/^\/v1\/admin\/projects\/(\d+)\/sites$/);
    const isAdminSitesPost = Boolean(adminSitesRouteMatch) && isAdmin && request.method === "POST";
    const isAdminSitesPatch = Boolean(adminSitesRouteMatch) && isAdmin && request.method === "PATCH";

    // =========================
    // HELPERS
    // =========================
    const origin = request.headers.get("Origin") || "";
    const requestId =
      request.headers.get("X-Request-Id") ||
      request.headers.get("x-request-id") ||
      crypto.randomUUID();
    const MAX_REQUEST_BYTES = 128_000;
    const MAX_INGEST_RECORDS = 40;
    const MAX_ALLOW_HEADER_TOKENS = 32;
    const MAX_ALLOW_HEADER_LENGTH = 2048;
    const ALLOW_HEADER_TOKEN_RE = /^[A-Za-z0-9-]+$/;

    function logWorkerError(event, extra = {}) {
      try {
        const summary = {
          request_id: requestId,
          event: String(event || "worker_error"),
          ...extra,
        };
        console.error("worker_error", JSON.stringify(summary));
      } catch {}
    }

    const BASE_ALLOWED_HEADERS = [
      "Content-Type",
      "Authorization",
      "X-Project-Key",
      "X-Admin-Token",
      "X-Cavbot-Sdk-Version",
      "X-Cavbot-Env",
      "X-Request-Id",

      // v5 site headers (your browser SDK sends these)
      "X-Cavbot-Site-Host",
      "X-Cavbot-Site-Origin",
      "X-Cavbot-Site-Public-Id",
    ];

    function buildAllowHeaders(req) {
      const reqHdrs = (req.headers.get("Access-Control-Request-Headers") || "")
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
        .filter((h) => ALLOW_HEADER_TOKEN_RE.test(h))
        .slice(0, MAX_ALLOW_HEADER_TOKENS);

      const all = BASE_ALLOWED_HEADERS.concat(reqHdrs);
      const seen = new Set();
      const out = [];
      let totalLen = 0;

      for (const h of all) {
        const token = String(h || "").trim();
        if (!ALLOW_HEADER_TOKEN_RE.test(token)) continue;
        const k = token.toLowerCase();
        if (!k) continue;
        if (seen.has(k)) continue;
        seen.add(k);
        if (out.length >= MAX_ALLOW_HEADER_TOKENS) break;
        const addLen = token.length + (out.length ? 2 : 0);
        if (totalLen + addLen > MAX_ALLOW_HEADER_LENGTH) break;
        totalLen += addLen;
        out.push(token);
      }
      return out.join(", ");
    }

    function json(status, payload, extraHeaders = {}) {
      return new Response(JSON.stringify(payload), {
        status,
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
        },
      });
    }

    async function readJsonSafe(req) {
      try {
        const ct = (req.headers.get("Content-Type") || "").toLowerCase();
        if (!ct.includes("application/json")) return null;

        // Hard limit (protects Worker + DB): reject huge bodies early if header present
        const len = Number(req.headers.get("Content-Length") || "0");
        if (Number.isFinite(len) && len > MAX_REQUEST_BYTES) return null;
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_REQUEST_BYTES) return null;
        const text = new TextDecoder().decode(buf);
        if (!text) return null;
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    function safeString(x, maxLen = 360) {
      try {
        const s = x == null ? "" : String(x);
        return s.length > maxLen ? s.slice(0, maxLen) : s;
      } catch {
        return "";
      }
    }

    function safeOriginFromUrl(input) {
      try {
        const u = new URL(String(input || ""));
        return u.origin || "";
      } catch {
        return "";
      }
    }

    function safeHostFromUrl(input) {
      try {
        const u = new URL(String(input || ""));
        return u.host || "";
      } catch {
        return "";
      }
    }

    function getRangeDays(range) {
      return range === "7d" ? 7 : 30;
    }

    function parseProjectIdFromPath(p) {
      const segments = p.split("/").filter(Boolean);
      const raw = segments[2] || ""; // /v1/projects/:id/...
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
      return n;
    }

    async function sha256Hex(input) {
      const data = new TextEncoder().encode(String(input || ""));
      const digest = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    function constantTimeEqualStr(a, b) {
      const enc = new TextEncoder();
      const aa = enc.encode(String(a || ""));
      const bb = enc.encode(String(b || ""));
      if (aa.length !== bb.length) return false;
      let diff = 0;
      for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
      return diff === 0;
    }

    function normalizeKeyPrefixFromKey(rawKey) {
      const k = String(rawKey || "");
      if (k.startsWith("cavbot_pk_")) return "pk";
      if (k.startsWith("cavbot_sk_")) return "sk";
      return "pk";
    }

    function keyPrefixToKind(prefixOrKeyPrefix) {
      const p = String(prefixOrKeyPrefix || "").toLowerCase();
      return p === "sk" ? "secret" : "publishable";
    }

    function defaultScopeForKind(kind) {
      return kind === "secret" ? "ingest,dashboard" : "ingest";
    }

    function normalizeScope(scopeRaw, kind) {
      const fallback = defaultScopeForKind(kind);
      const raw = String(scopeRaw || "").trim();
      if (!raw) return fallback;
      const out = [];
      const seen = new Set();
      for (const token of raw.split(",")) {
        const t = String(token || "").trim().toLowerCase();
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out.length ? out.join(",") : fallback;
    }

    function scopeIncludes(scopeRaw, needed) {
      const want = String(needed || "").trim().toLowerCase();
      if (!want) return false;
      const tokens = String(scopeRaw || "")
        .split(",")
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean);
      return tokens.includes(want);
    }

    function keyIdShortFromHash(keyHashHex) {
      const hex = String(keyHashHex || "")
        .toLowerCase()
        .replace(/[^a-f0-9]/g, "");
      if (!hex) return "0000000000000000";
      return hex.slice(0, 16).padEnd(16, "0");
    }

    function storedProjectKeyValue(rawKey, keyResolved, keyHashHex) {
      if (keyResolved?.kind !== "secret") {
        return safeString(rawKey || "", 2400).trim();
      }
      return `sk_${keyIdShortFromHash(keyHashHex)}`;
    }

    function safeIsoFromMillis(rawTsMs, fallbackIso) {
      const fallback = safeString(fallbackIso || "", 80) || new Date().toISOString();
      const n = Number(rawTsMs);
      if (!Number.isFinite(n) || n <= 0) return null;

      const now = Date.now();
      const minMs = now - 366 * 24 * 60 * 60 * 1000;
      const maxMs = now + 14 * 24 * 60 * 60 * 1000;
      const clamped = Math.min(maxMs, Math.max(minMs, Math.round(n)));

      try {
        return new Date(clamped).toISOString();
      } catch {
        return fallback;
      }
    }

    function isNotRevokedValue(v) {
      if (v == null) return true;
      const s = String(v).trim();
      if (!s) return true;
      if (s === "0") return true;
      return false;
    }

    function extractProjectKey(req, body) {
      const headerKey =
        req.headers.get("X-Project-Key") ||
        req.headers.get("x-project-key") ||
        "";
      const auth =
        req.headers.get("Authorization") ||
        req.headers.get("authorization") ||
        "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : "";
      // v5 uses project_key; legacy uses projectKey
      return headerKey || bearer || (body?.project_key || body?.projectKey || "");
    }

    // =========================
    // CORS
    // =========================
    const dashboardAllowlist = (env.DASHBOARD_ORIGINS || env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    function originAllowedForDashboard(o) {
      if (!o) return false;
      return dashboardAllowlist.includes(o);
    }

    function resolveCorsAllowOrigin() {
      // Ingest: reflect origin (or * if none) to support browser SDK
      if (isIngest || isIngestPreflight) return origin ? origin : "*";

      // Admin / dashboard reads: strict allowlist only
      if (!origin) return "null";
      if (isAdmin || isProjectSites || isProjectSummary || isProjectGeo) {
        return originAllowedForDashboard(origin) ? origin : "null";
      }
      return "null";
    }

    const corsAllowOrigin = resolveCorsAllowOrigin();
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsAllowOrigin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": buildAllowHeaders(request),
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      if ((isAdmin || isProjectSites || isProjectSummary || isProjectGeo) && origin && corsAllowOrigin === "null") {
        return new Response("CORS blocked", { status: 403, headers: corsHeaders });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if ((isAdmin || isProjectSites || isProjectSummary || isProjectGeo) && origin && corsAllowOrigin === "null") {
      return new Response("CORS blocked", { status: 403, headers: corsHeaders });
    }

    // =========================
    // HEALTH
    // =========================
    if (isHealth) return json(200, { ok: true }, corsHeaders);

    // =========================
    // ADMIN AUTH
    // =========================
    function requireAdminToken(req) {
      if (env.CAVBOT_DEV_NO_ADMIN === "1") return { ok: true };

      const expected = safeString(env.CAVBOT_ADMIN_TOKEN || "", 600).trim();
      if (!expected) {
        return {
          ok: false,
          error: "server_misconfigured",
          message: "Missing env CAVBOT_ADMIN_TOKEN",
        };
      }

      const xAdmin =
        req.headers.get("X-Admin-Token") ||
        req.headers.get("x-admin-token") ||
        "";
      const auth =
        req.headers.get("Authorization") ||
        req.headers.get("authorization") ||
        "";

      let token = safeString(xAdmin, 800).trim();
      if (!token && auth.toLowerCase().startsWith("bearer ")) token = auth.slice(7).trim();

      if (!token) return { ok: false, error: "UNAUTHORIZED" };
      if (!constantTimeEqualStr(token, expected)) return { ok: false, error: "UNAUTHORIZED" };

      return { ok: true };
    }

    // =========================
    // KEY LOOKUP (ENV KEYRING FIRST, THEN D1)
    // =========================
    function parseProjectKeysEnv(raw) {
      // Supports:
      // "cavbot_sk_xxx:1,cavbot_pk_yyy:1"
      // "cavbot_sk_xxx,cavbot_pk_yyy" (uses DEFAULT_PROJECT_ID)
      const s = String(raw || "").trim();
      if (!s) return [];
      return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((entry) => {
          const [k, pidRaw] = entry.includes(":") ? entry.split(":") : [entry, ""];
          return { key: (k || "").trim(), projectIdRaw: (pidRaw || "").trim() };
        });
    }

    function collectEnvKeys(env) {
      const candidates = [
        env.CAVBOT_PROJECT_KEY,
        env.NEXT_PUBLIC_CAVBOT_PROJECT_KEY,

        env.CAVBOT_PUBLISHABLE_KEY,
        env.CAVBOT_SECRET_KEY,
        env.CAVBOT_PROJECT_PK,
        env.CAVBOT_PROJECT_SK,

        ...(parseProjectKeysEnv(env.PROJECT_KEYS).map((x) => x.key)),
      ];

      return candidates
        .map((k) => safeString(k || "", 2400).trim())
        .filter(Boolean);
    }

    function projectIdForEnvKey(env, matchedKey) {
      const mapped = parseProjectKeysEnv(env.PROJECT_KEYS);
      if (mapped.length) {
        for (const entry of mapped) {
          if (!entry.key) continue;
          if (!constantTimeEqualStr(matchedKey, entry.key)) continue;
          const pid = entry.projectIdRaw ? Number(entry.projectIdRaw) : DEFAULT_PROJECT_ID;
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      }
      return DEFAULT_PROJECT_ID;
    }

    async function resolveProjectFromKey(rawKey) {
      const k = safeString(rawKey, 2400).trim();
      if (!k) return null;

      // 1) ENV keyring match
      const envKeys = collectEnvKeys(env);
      for (const candidate of envKeys) {
        if (constantTimeEqualStr(k, candidate)) {
          const pid = projectIdForEnvKey(env, candidate);
          const prefix = normalizeKeyPrefixFromKey(candidate);
          const kind = keyPrefixToKind(prefix);
          return {
            projectId: pid,
            kind,
            keyPrefix: prefix,
            source: "env",
            scope: normalizeScope(null, kind),
          };
        }
      }

      // 2) D1 lookup
      if (!ANALYTICS_DB) return null;

      const keyHash = await sha256Hex(k);

      const row = await ANALYTICS_DB.prepare(
        `
        SELECT project_id, key_prefix, scope, revoked_at
        FROM project_keys
        WHERE key_hash = ?
        LIMIT 1
        `
      )
        .bind(keyHash)
        .first();

      if (!row) return null;
      if (!isNotRevokedValue(row.revoked_at)) return null;

      const prefix = String(row.key_prefix || normalizeKeyPrefixFromKey(k)).toLowerCase();
      const kind = keyPrefixToKind(prefix);
      const scope = normalizeScope(row.scope, kind);

      ctx.waitUntil(
        ANALYTICS_DB.prepare(
          `UPDATE project_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?`
        )
          .bind(keyHash)
          .run()
          .catch(() => {})
      );

      return {
        projectId: Number(row.project_id),
        kind,
        keyPrefix: prefix,
        source: "d1",
        scope,
      };
    }

    // Optional dev autoprov (OFF unless enabled)
    async function ensureProjectKeyRow(projectId, rawKey) {
      if (String(env.CAVBOT_DEV_AUTOPROVISION_KEYS || "") !== "1") return false;
      if (!ANALYTICS_DB) return false;

      const k = safeString(rawKey, 2400).trim();
      if (!k) return false;

      const keyHash = await sha256Hex(k);
      const keyPrefix = normalizeKeyPrefixFromKey(k);

      try {
        const existing = await ANALYTICS_DB.prepare(
          `SELECT 1 AS ok FROM project_keys WHERE key_hash = ? LIMIT 1`
        )
          .bind(keyHash)
          .first();

        if (existing?.ok) return true;

        await ANALYTICS_DB.prepare(
          `INSERT INTO project_keys (project_id, key_prefix, key_hash, scope, revoked_at)
           VALUES (?, ?, ?, 'ingest', NULL)`
        )
          .bind(projectId, keyPrefix, keyHash)
          .run();

        return true;
      } catch (e) {
        logWorkerError("ensure_project_key_row_failed");
        return false;
      }
    }

    async function resolveDashboardAccess(requestedProjectId) {
      const adminGate = requireAdminToken(request);
      if (adminGate.ok) {
        return {
          ok: true,
          effectiveProjectId: requestedProjectId,
          rawKey: "",
          keyResolved: null,
        };
      }

      const rawKey = extractProjectKey(request, null);
      let keyResolved = await resolveProjectFromKey(rawKey);

      if (!keyResolved) {
        await ensureProjectKeyRow(DEFAULT_PROJECT_ID, rawKey);
        keyResolved = await resolveProjectFromKey(rawKey);
      }

      if (!keyResolved) {
        return { ok: false, status: 401, payload: { ok: false, error: "invalid_project_key" } };
      }

      const canReadDashboard =
        keyResolved.kind === "secret" && scopeIncludes(keyResolved.scope, "dashboard");
      if (!canReadDashboard) {
        return { ok: false, status: 403, payload: { ok: false, error: "insufficient_key_scope" } };
      }

      const effectiveProjectId = SINGLE_TENANT ? keyResolved.projectId : requestedProjectId;
      if (!SINGLE_TENANT && keyResolved.projectId !== requestedProjectId) {
        return { ok: false, status: 401, payload: { ok: false, error: "invalid_project_key" } };
      }

      return {
        ok: true,
        effectiveProjectId,
        rawKey,
        keyResolved,
      };
    }

    // =========================
    // ORIGIN PATTERN SUPPORT (SAFE)
    // =========================
    function compileOriginPattern(patternOrigin) {
      const s = String(patternOrigin || "").trim();
      if (!s) return null;

      // Exact (no wildcard)
      if (!s.includes("*")) {
        return { kind: "exact", origin: s };
      }

      try {
        const idx = s.indexOf("://");
        if (idx < 0) return null;
        const scheme = s.slice(0, idx);
        const rest = s.slice(idx + 3);
        if (rest.includes("/") || rest.includes("?") || rest.includes("#")) return null;

        const [hostPort] = rest.split("/");
        const host = hostPort;

        if (scheme !== "http" && scheme !== "https") return null;

        const portIdx = host.lastIndexOf(":");
        let hostname = host;
        let port = "";
        if (portIdx > -1 && host.indexOf("]") === -1) {
          const left = host.slice(0, portIdx);
          const right = host.slice(portIdx + 1);
          if (/^\d+$/.test(right)) {
            hostname = left;
            port = right;
          }
        }

        const escaped = hostname
          .split(".")
          .map((label) => {
            if (label === "*") return "[^.]+";
            if (label.includes("*")) return null;
            return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          });

        if (escaped.includes(null)) return null;

        const hostRe = new RegExp("^" + escaped.join("\\.") + "$", "i");

        return {
          kind: "wildcard",
          scheme,
          hostRe,
          port: port || "",
          raw: s,
        };
      } catch {
        return null;
      }
    }

    function originMatchesPattern(requestOrigin, compiled) {
      if (!compiled) return false;
      const ro = String(requestOrigin || "").trim();
      if (!ro) return false;

      if (compiled.kind === "exact") return ro === compiled.origin;

      try {
        const u = new URL(ro);
        if (u.protocol.replace(":", "") !== compiled.scheme) return false;

        const hostOk = compiled.hostRe.test(u.hostname);
        if (!hostOk) return false;

        if (compiled.port) {
          const p = u.port || (u.protocol === "https:" ? "443" : "80");
          return String(p) === String(compiled.port);
        }

        return true;
      } catch {
        return false;
      }
    }

    // =========================
    // GEO INTELLIGENCE (country + CavBot region id)
    // =========================
    const CENTRAL_AMERICA = new Set(["BZ", "CR", "SV", "GT", "HN", "NI", "PA"]);
    const CARIBBEAN = new Set([
      "AI","AG","AW","BB","BL","BM","BQ","BS","CU","CW","DM","DO","GD","GP","HT","JM","KN","KY","LC","MF","MQ","MS","PR","SX","TC","TT","VC","VG","VI"
    ]);
    const SOUTH_AMERICA = new Set(["AR","BO","BR","CL","CO","EC","GF","GY","PE","PY","SR","UY","VE","FK"]);
    const MIDDLE_EAST = new Set([
      "AE","SA","QA","KW","BH","OM","YE","IR","IQ","SY","JO","IL","LB","PS","TR","CY","EG"
    ]);
    const OCEANIA = new Set([
      "AU","NZ","PG","FJ","SB","VU","NC","PF","WS","TO","KI","TV","NR","FM","MH","GU","MP","AS","CK","NU","TK","WF","PW"
    ]);

    function cavbotRegionFromSignals(country, continent) {
      const c = String(country || "").toUpperCase();
      const k = String(continent || "").toUpperCase();

      if (c && MIDDLE_EAST.has(c)) return { id: "region-me", name: "Middle East" };
      if (c && (CENTRAL_AMERICA.has(c) || CARIBBEAN.has(c))) return { id: "region-ca", name: "Central America" };
      if (c && SOUTH_AMERICA.has(c)) return { id: "region-sa", name: "South America" };
      if (c && OCEANIA.has(c)) return { id: "region-oce", name: "Oceania" };

      if (k === "NA") return { id: "region-na", name: "North America" };
      if (k === "SA") return { id: "region-sa", name: "South America" };
      if (k === "EU") return { id: "region-eu", name: "Europe" };
      if (k === "AF") return { id: "region-af", name: "Africa" };
      if (k === "OC") return { id: "region-oce", name: "Oceania" };
      if (k === "AS") return { id: "region-apac", name: "Asia Pacific" };

      return { id: "region-other", name: "Other/Unassigned" };
    }

    function geoFromRequest(req) {
      try {
        const cf = req.cf || {};
        const country = cf.country ? String(cf.country).toUpperCase() : null;
        const continent = cf.continent ? String(cf.continent).toUpperCase() : null;
        const subdivision = cf.region ? safeString(cf.region, 120) : null; // e.g. "CA" / "England" depending
        const colo = cf.colo ? safeString(cf.colo, 20) : null;

        const region = cavbotRegionFromSignals(country, continent);
        return {
          country,
          continent,
          subdivision,
          colo,
          cavbotRegionId: region.id,
          cavbotRegionName: region.name,
        };
      } catch {
        return {
          country: null,
          continent: null,
          subdivision: null,
          colo: null,
          cavbotRegionId: "region-other",
          cavbotRegionName: "Other/Unassigned",
        };
      }
    }

    // =========================
    // SITE LOOKUP (for ingest only)
    // =========================
    async function resolveSite(projectId, pageUrl, reqOrigin, assertedOrigin, keyKind) {
      const inferredOrigin = safeOriginFromUrl(pageUrl);
      const inferredHost = safeHostFromUrl(pageUrl);

      const isServerKey = keyKind === "secret";
      const finalOrigin = safeString(reqOrigin || assertedOrigin || inferredOrigin || "", 500).trim();

      if (!isServerKey) {
        if (!reqOrigin) return { ok: false, error: "missing_origin", message: "Browser Origin required" };
        if (inferredOrigin && reqOrigin !== inferredOrigin) return { ok: false, error: "origin_mismatch" };
      } else {
        if (!finalOrigin) {
          return {
            ok: false,
            error: "missing_site_origin",
            message: "Server ingest requires pageUrl or siteOrigin to resolve a registered site",
          };
        }
      }

      if (!ANALYTICS_DB) {
        return { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" };
      }

      // 1) Exact match (fast path)
      const exact = await ANALYTICS_DB.prepare(
        `
        SELECT id, public_id, origin, host, label, is_active
        FROM sites
        WHERE project_id = ?
          AND origin = ?
          AND is_active = 1
        LIMIT 1
        `
      )
        .bind(projectId, finalOrigin)
        .first();

      if (exact) {
        return {
          ok: true,
          site: {
            id: Number(exact.id),
            publicId: String(exact.public_id),
            origin: String(exact.origin),
            host: String(exact.host || inferredHost || ""),
            label: String(exact.label || exact.host || exact.origin),
          },
        };
      }

      // 2) Wildcard/pattern match (careful)
      const wildcardRows = await ANALYTICS_DB.prepare(
        `
        SELECT id, public_id, origin, host, label, is_active
        FROM sites
        WHERE project_id = ?
          AND is_active = 1
          AND origin LIKE '%*%'
        LIMIT 200
        `
      )
        .bind(projectId)
        .all();

      const candidates = wildcardRows?.results || [];
      for (const r of candidates) {
        const compiled = compileOriginPattern(r.origin);
        if (!compiled) continue;
        if (!originMatchesPattern(finalOrigin, compiled)) continue;

        return {
          ok: true,
          site: {
            id: Number(r.id),
            publicId: String(r.public_id),
            origin: String(finalOrigin),
            host: String(r.host || inferredHost || safeHostFromUrl(finalOrigin) || ""),
            label: String(r.label || r.host || finalOrigin),
          },
        };
      }

      return {
        ok: false,
        error: "unregistered_origin",
        message: "Origin not registered for this project",
      };
    }

    // =========================
    // ADMIN: /v1/admin/verify
    // =========================
    if (isAdminVerify) {
      const gate = requireAdminToken(request);
      if (!gate.ok) return json(gate.error === "server_misconfigured" ? 500 : 401, gate, corsHeaders);

      if (!ANALYTICS_DB) {
        return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
      }

      const events = await ANALYTICS_DB.prepare(`SELECT COUNT(*) AS n FROM events`).first();
      const sites = await ANALYTICS_DB.prepare(`SELECT COUNT(*) AS n FROM sites`).first();
      const keys = await ANALYTICS_DB.prepare(`SELECT COUNT(*) AS n FROM project_keys`).first();

      return json(
        200,
        { ok: true, db: { events: Number(events?.n || 0), sites: Number(sites?.n || 0), keys: Number(keys?.n || 0) } },
        corsHeaders
      );
    }

    // =========================
    // ADMIN: register site
    // =========================
    if (isAdminSitesPost) {
      const gate = requireAdminToken(request);
      if (!gate.ok) return json(gate.error === "server_misconfigured" ? 500 : 401, gate, corsHeaders);

      if (!ANALYTICS_DB) {
        return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
      }

      const projectId = Number(adminSitesRouteMatch[1]);
      const body = await readJsonSafe(request);

      const siteOrigin = safeString(body?.origin || "", 400).trim();
      const label = safeString(body?.label || "", 120).trim();

      if (!siteOrigin.startsWith("http")) {
        return json(400, { ok: false, error: "invalid_origin", message: "origin must be full origin like https://site.com" }, corsHeaders);
      }

      const host = safeHostFromUrl(siteOrigin);
      const publicId = `site_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

      try {
        await ANALYTICS_DB.prepare(
          `INSERT INTO sites (project_id, public_id, origin, host, label, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`
        )
          .bind(projectId, publicId, siteOrigin, host, label || host)
          .run();

        return json(200, { ok: true, projectId, site: { publicId, origin: siteOrigin, host, label: label || host } }, corsHeaders);
      } catch (e) {
        return json(409, { ok: false, error: "site_exists_or_conflict", message: String(e?.message || e) }, corsHeaders);
      }
    }

    // =========================
    // ADMIN: update site
    // =========================
    if (isAdminSitesPatch) {
      const gate = requireAdminToken(request);
      if (!gate.ok) return json(gate.error === "server_misconfigured" ? 500 : 401, gate, corsHeaders);

      if (!ANALYTICS_DB) {
        return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
      }

      const projectId = Number(adminSitesRouteMatch[1]);
      const body = await readJsonSafe(request);

      const originCurrent = safeString(body?.origin || "", 500).trim();
      const newOrigin = safeString(body?.newOrigin || "", 500).trim();
      const newLabel = body?.label != null ? safeString(body.label, 120).trim() : "";
      const isActive = body?.isActive != null ? (Boolean(body.isActive) ? 1 : 0) : null;

      if (!originCurrent) return json(400, { ok: false, error: "missing_origin" }, corsHeaders);
      if (newOrigin && !newOrigin.startsWith("http")) return json(400, { ok: false, error: "invalid_new_origin" }, corsHeaders);

      const host = newOrigin ? safeHostFromUrl(newOrigin) : null;

      const sets = [];
      const binds = [];

      if (newOrigin) { sets.push("origin = ?"); binds.push(newOrigin); }
      if (host != null) { sets.push("host = ?"); binds.push(host); }
      if (newLabel) { sets.push("label = ?"); binds.push(newLabel); }
      if (isActive != null) { sets.push("is_active = ?"); binds.push(isActive); }

      if (!sets.length) return json(400, { ok: false, error: "no_updates" }, corsHeaders);

      const sql = `UPDATE sites SET ${sets.join(", ")} WHERE project_id = ? AND origin = ?`;
      const res = await ANALYTICS_DB.prepare(sql).bind(...binds, projectId, originCurrent).run();

      const updated = Number(res?.meta?.changes || 0);
      if (!updated) return json(404, { ok: false, error: "site_not_found" }, corsHeaders);

      return json(200, { ok: true, updated }, corsHeaders);
    }

    // =========================
    // READ: GET /v1/projects/:id/sites
    // =========================
    if (isProjectSites) {
      const requestedProjectId = parseProjectIdFromPath(path);
      if (!requestedProjectId) return json(400, { ok: false, error: "invalid_project_id" }, corsHeaders);

      if (!ANALYTICS_DB) {
        return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
      }

      const access = await resolveDashboardAccess(requestedProjectId);
      if (!access.ok) return json(access.status, access.payload, corsHeaders);
      const effectiveProjectId = access.effectiveProjectId;

      const rows = await ANALYTICS_DB.prepare(
        `SELECT public_id, origin, host, label, is_active
         FROM sites
         WHERE project_id = ?
         ORDER BY created_at ASC
         LIMIT 200`
      )
        .bind(effectiveProjectId)
        .all();

      const sites = (rows?.results || []).map((r) => ({
        id: String(r.public_id),
        label: String(r.label || r.host || r.origin),
        origin: String(r.origin),
        isActive: Number(r.is_active || 0) === 1,
      }));

      return json(200, { project: { id: String(effectiveProjectId) }, sites }, corsHeaders);
    }

    // =========================
    // READ: GET /v1/projects/:id/summary
    // =========================
    if (isProjectSummary) {
      try {
        const requestedProjectId = parseProjectIdFromPath(path);
        if (!requestedProjectId) {
          return json(400, { ok: false, error: "invalid_project_id", message: "Project id must be a positive integer" }, corsHeaders);
        }

        if (!ANALYTICS_DB) {
          return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
        }

        const access = await resolveDashboardAccess(requestedProjectId);
        if (!access.ok) return json(access.status, access.payload, corsHeaders);

        const effectiveProjectId = access.effectiveProjectId;
        const rawKey = access.rawKey;
        const readKeyResolved = access.keyResolved;

        const range = url.searchParams.get("range") || "30d";
        const days = getRangeDays(range);
        const windowSql = `-${days} day`;

        const siteOrigin = safeString(url.searchParams.get("origin") || "", 400).trim();

        let v2Usable = false;
        if (EVENTS_SCHEMA_V2) {
          const probe = await ANALYTICS_DB.prepare(
            `SELECT COUNT(*) AS n
             FROM events
             WHERE project_id = ?
               AND created_at > datetime('now', ?)`
          )
            .bind(effectiveProjectId, windowSql)
            .first();

          v2Usable = Number(probe?.n || 0) > 0;
        }

        if (EVENTS_SCHEMA_V2 && v2Usable) {
          let siteId = null;

          if (siteOrigin) {
            const s = await ANALYTICS_DB.prepare(
              `SELECT id FROM sites WHERE project_id = ? AND origin = ? AND is_active = 1 LIMIT 1`
            )
              .bind(effectiveProjectId, siteOrigin)
              .first();

            if (!s?.id) {
              return json(404, { ok: false, error: "site_not_found", message: "Origin not registered for this project" }, corsHeaders);
            }
            siteId = Number(s.id);
          }

          const pv24 = await ANALYTICS_DB.prepare(
            `SELECT COUNT(*) AS n
             FROM events
             WHERE project_id = ?
               AND event_name = 'cavbot_page_view'
               AND created_at > datetime('now', '-1 day')
               ${siteId ? "AND site_id = ?" : ""}`
          )
            .bind(effectiveProjectId, ...(siteId ? [siteId] : []))
            .first();

          const sessions = await ANALYTICS_DB.prepare(
            `SELECT COUNT(DISTINCT session_key) AS n
             FROM events
             WHERE project_id = ?
               AND event_name = 'cavbot_page_view'
               AND created_at > datetime('now', ?)
               ${siteId ? "AND site_id = ?" : ""}`
          )
            .bind(effectiveProjectId, windowSql, ...(siteId ? [siteId] : []))
            .first();

          const visitors = await ANALYTICS_DB.prepare(
            `SELECT COUNT(DISTINCT anonymous_id) AS n
             FROM events
             WHERE project_id = ?
               AND created_at > datetime('now', ?)
               ${siteId ? "AND site_id = ?" : ""}`
          )
            .bind(effectiveProjectId, windowSql, ...(siteId ? [siteId] : []))
            .first();

          const routes = await ANALYTICS_DB.prepare(
            `SELECT COUNT(DISTINCT route_path) AS n
             FROM events
             WHERE project_id = ?
               AND created_at > datetime('now', ?)
               ${siteId ? "AND site_id = ?" : ""}`
          )
            .bind(effectiveProjectId, windowSql, ...(siteId ? [siteId] : []))
            .first();

          return json(
            200,
            {
              project: { id: String(effectiveProjectId) },
              window: { range: range === "7d" ? "last_7d" : "last_30d" },
              filter: { origin: siteOrigin || null },
              schema: "v2",
              metrics: {
                pageViews24h: Number(pv24?.n || 0),
                sessions30d: Number(sessions?.n || 0),
                uniqueVisitors30d: Number(visitors?.n || 0),
                routesMonitored: Number(routes?.n || 0),
                guardianScore: 80,
              },
            },
            corsHeaders
          );
        }

        // Legacy fallback (project_key)
        if (!rawKey) {
          return json(400, { ok: false, error: "legacy_requires_project_key" }, corsHeaders);
        }

        const legacyKeys = [rawKey];
        if (readKeyResolved?.kind === "secret") {
          const secretKeyHash = await sha256Hex(rawKey);
          legacyKeys.push(storedProjectKeyValue(rawKey, readKeyResolved, secretKeyHash));
        }
        const legacyKeySql = legacyKeys.length > 1 ? `project_key IN (?, ?)` : `project_key = ?`;
        const legacySiteFilterSql = siteOrigin ? ` AND page_url LIKE ? ` : "";
        const legacySiteBinds = siteOrigin ? [`${siteOrigin}%`] : [];
        const legacyBinds = legacyKeys.length > 1 ? legacyKeys : [legacyKeys[0]];

        const pv24 = await ANALYTICS_DB.prepare(
          `SELECT COUNT(*) AS n
           FROM events
           WHERE ${legacyKeySql}
             AND event_name = 'cavbot_page_view'
             AND created_at > datetime('now', '-1 day')
             ${legacySiteFilterSql}`
        )
          .bind(...legacyBinds, ...legacySiteBinds)
          .first();

        const sessions = await ANALYTICS_DB.prepare(
          `SELECT COUNT(DISTINCT session_key) AS n
           FROM events
           WHERE ${legacyKeySql}
             AND event_name = 'cavbot_page_view'
             AND created_at > datetime('now', ?)
             ${legacySiteFilterSql}`
        )
          .bind(...legacyBinds, windowSql, ...legacySiteBinds)
          .first();

        const visitors = await ANALYTICS_DB.prepare(
          `SELECT COUNT(DISTINCT anonymous_id) AS n
           FROM events
           WHERE ${legacyKeySql}
             AND created_at > datetime('now', ?)
             ${legacySiteFilterSql}`
        )
          .bind(...legacyBinds, windowSql, ...legacySiteBinds)
          .first();

        const routes = await ANALYTICS_DB.prepare(
          `SELECT COUNT(DISTINCT route_path) AS n
           FROM events
           WHERE ${legacyKeySql}
             AND created_at > datetime('now', ?)
             ${legacySiteFilterSql}`
        )
          .bind(...legacyBinds, windowSql, ...legacySiteBinds)
          .first();

        return json(
          200,
          {
            project: { id: String(effectiveProjectId) },
            window: { range: range === "7d" ? "last_7d" : "last_30d" },
            filter: { origin: siteOrigin || null },
            schema: "legacy_fallback",
            metrics: {
              pageViews24h: Number(pv24?.n || 0),
              sessions30d: Number(sessions?.n || 0),
              uniqueVisitors30d: Number(visitors?.n || 0),
              routesMonitored: Number(routes?.n || 0),
              guardianScore: 80,
            },
          },
          corsHeaders
        );
      } catch (e) {
        logWorkerError("summary_error");
        return json(500, { ok: false, error: "summary_failed", message: String(e?.message || e) }, corsHeaders);
      }
    }

    // =========================
    // GEO: GET /v1/projects/:id/geo
    // - Returns top regions + top countries in window (v2 schema)
    // =========================
    if (isProjectGeo) {
      try {
        const requestedProjectId = parseProjectIdFromPath(path);
        if (!requestedProjectId) {
          return json(400, { ok: false, error: "invalid_project_id" }, corsHeaders);
        }

        if (!ANALYTICS_DB) {
          return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
        }

        const access = await resolveDashboardAccess(requestedProjectId);
        if (!access.ok) return json(access.status, access.payload, corsHeaders);
        const effectiveProjectId = access.effectiveProjectId;

        const range = url.searchParams.get("range") || "30d";
        const days = getRangeDays(range);
        const windowSql = `-${days} day`;

        const siteOrigin = safeString(url.searchParams.get("origin") || "", 400).trim();

        if (!EVENTS_SCHEMA_V2) {
          return json(400, { ok: false, error: "geo_requires_v2_schema", message: "Enable EVENTS_SCHEMA_V2=1 for geo aggregation" }, corsHeaders);
        }

        let siteId = null;
        if (siteOrigin) {
          const s = await ANALYTICS_DB.prepare(
            `SELECT id FROM sites WHERE project_id = ? AND origin = ? AND is_active = 1 LIMIT 1`
          )
            .bind(effectiveProjectId, siteOrigin)
            .first();

          if (!s?.id) {
            return json(404, { ok: false, error: "site_not_found", message: "Origin not registered for this project" }, corsHeaders);
          }
          siteId = Number(s.id);
        }

        // Pull region + country from payload_json: __cavbot.geo.*
        const topRegions = await ANALYTICS_DB.prepare(
          `SELECT
             COALESCE(json_extract(payload_json, '$.__cavbot.geo.cavbotRegionId'), 'region-other') AS regionId,
             COALESCE(json_extract(payload_json, '$.__cavbot.geo.cavbotRegionName'), 'Other/Unassigned') AS regionName,
             COUNT(*) AS n
           FROM events
           WHERE project_id = ?
             AND created_at > datetime('now', ?)
             ${siteId ? "AND site_id = ?" : ""}
           GROUP BY regionId, regionName
           ORDER BY n DESC
           LIMIT 30`
        )
          .bind(effectiveProjectId, windowSql, ...(siteId ? [siteId] : []))
          .all();

        const topCountries = await ANALYTICS_DB.prepare(
          `SELECT
             COALESCE(json_extract(payload_json, '$.__cavbot.geo.country'), 'XX') AS country,
             COUNT(*) AS n
           FROM events
           WHERE project_id = ?
             AND created_at > datetime('now', ?)
             ${siteId ? "AND site_id = ?" : ""}
           GROUP BY country
           ORDER BY n DESC
           LIMIT 60`
        )
          .bind(effectiveProjectId, windowSql, ...(siteId ? [siteId] : []))
          .all();

        return json(
          200,
          {
            ok: true,
            project: { id: String(effectiveProjectId) },
            window: { range: range === "7d" ? "last_7d" : "last_30d" },
            filter: { origin: siteOrigin || null },
            geo: {
              regions: (topRegions?.results || []).map((r) => ({
                regionId: String(r.regionId),
                regionName: String(r.regionName),
                count: Number(r.n || 0),
              })),
              countries: (topCountries?.results || []).map((c) => ({
                country: String(c.country),
                count: Number(c.n || 0),
              })),
            },
          },
          corsHeaders
        );
      } catch (e) {
        logWorkerError("geo_error");
        return json(500, { ok: false, error: "geo_failed", message: String(e?.message || e) }, corsHeaders);
      }
    }

    // =========================
    // INGEST: POST /v1/events
    // Supports v5 records[] + legacy events[]
    // Stamps geo + region id into __cavbot.geo
    // =========================
    if (isIngest) {
      try {
        const contentLength = Number(request.headers.get("Content-Length") || "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
          return json(413, { ok: false, error: "payload_too_large", request_id: requestId }, corsHeaders);
        }

        const body = await readJsonSafe(request);
        if (!body) return json(400, { ok: false, error: "invalid_json", request_id: requestId }, corsHeaders);

        try {
          const bodyLen = JSON.stringify(body).length;
          if (bodyLen > MAX_REQUEST_BYTES) {
            return json(413, { ok: false, error: "payload_too_large", request_id: requestId }, corsHeaders);
          }
        } catch {}

        if (!ANALYTICS_DB) {
          return json(500, { ok: false, error: "server_misconfigured", message: "Missing ANALYTICS_DB or DB binding" }, corsHeaders);
        }

        const rawKey = extractProjectKey(request, body);
        if (!rawKey) {
          return json(400, { ok: false, error: "missing_project_key", request_id: requestId }, corsHeaders);
        }

        const isV5 = Array.isArray(body.records);
        const isLegacy = Array.isArray(body.events);
        if (!isV5 && !isLegacy) {
          return json(400, { ok: false, error: "missing_records", request_id: requestId }, corsHeaders);
        }

        const sdkVersion = safeString(
          body.sdk_version ||
            body.sdkVersion ||
            request.headers.get("X-Cavbot-Sdk-Version") ||
            "",
          40
        ).trim();
        const envName = safeString(
          body.env ||
            request.headers.get("X-Cavbot-Env") ||
            "",
          40
        ).trim();

        if (isV5 && !sdkVersion) {
          return json(400, { ok: false, error: "missing_sdk_version", request_id: requestId }, corsHeaders);
        }
        if (isV5 && !envName) {
          return json(400, { ok: false, error: "missing_env", request_id: requestId }, corsHeaders);
        }

        let keyResolved = await resolveProjectFromKey(rawKey);
        if (!keyResolved) {
          await ensureProjectKeyRow(DEFAULT_PROJECT_ID, rawKey);
          keyResolved = await resolveProjectFromKey(rawKey);
        }
        if (!keyResolved) return json(401, { ok: false, error: "invalid_project_key", request_id: requestId }, corsHeaders);
        if (!scopeIncludes(keyResolved.scope, "ingest")) {
          return json(403, { ok: false, error: "insufficient_key_scope", request_id: requestId }, corsHeaders);
        }

        const keyHash = await sha256Hex(rawKey);
        const keyIdShort = keyIdShortFromHash(keyHash);
        const projectKeyStored = storedProjectKeyValue(rawKey, keyResolved, keyHash);

        const v5Site = body.site && typeof body.site === "object" ? body.site : null;
        const headerSiteOrigin = safeString(
          request.headers.get("X-Cavbot-Site-Origin") ||
            request.headers.get("x-cavbot-site-origin") ||
            "",
          500
        ).trim();
        const headerSiteHost = safeString(
          request.headers.get("X-Cavbot-Site-Host") ||
            request.headers.get("x-cavbot-site-host") ||
            "",
          260
        ).trim();
        const headerSitePublicId = safeString(
          request.headers.get("X-Cavbot-Site-Public-Id") ||
            request.headers.get("x-cavbot-site-public-id") ||
            "",
          220
        ).trim();
        const bodySiteOrigin = safeString(v5Site?.origin || body.siteOrigin || body.origin || "", 500).trim();
        const bodySiteHost = safeString(v5Site?.host || body.siteHost || "", 260).trim();
        const bodySitePublicId = safeString(
          v5Site?.site_public_id ||
            v5Site?.public_id ||
            body.site_public_id ||
            body.sitePublicId ||
            "",
          220
        ).trim();

        if (headerSiteOrigin && bodySiteOrigin && headerSiteOrigin !== bodySiteOrigin) {
          return json(400, { ok: false, error: "site_origin_mismatch", request_id: requestId }, corsHeaders);
        }
        if (headerSiteHost && bodySiteHost && headerSiteHost.toLowerCase() !== bodySiteHost.toLowerCase()) {
          return json(400, { ok: false, error: "site_host_mismatch", request_id: requestId }, corsHeaders);
        }
        if (headerSitePublicId && bodySitePublicId && headerSitePublicId !== bodySitePublicId) {
          return json(400, { ok: false, error: "site_public_id_mismatch", request_id: requestId }, corsHeaders);
        }

        // Best site origin signal (v5 prefers header + site.origin)
        const assertedSiteOrigin =
          safeString(
            headerSiteOrigin || bodySiteOrigin || "",
            500
          ).trim() || "";

        // For site resolution, we need a pageUrl.
        // v5: take from first record.page_url if available
        // legacy: body.pageUrl
        const pageUrl =
          (isV5 && body.records[0] && body.records[0].page_url ? safeString(body.records[0].page_url, 1200) : null) ||
          (body.pageUrl != null ? safeString(body.pageUrl, 1200) : null) ||
          null;

        // Step 5A: Rate limit BEFORE heavy work (project_id + origin + IP)
        const rlOrigin = origin || headerSiteOrigin || assertedSiteOrigin || safeOriginFromUrl(pageUrl) || "no-origin";
        try {
          await enforceRateLimit(request, env, keyResolved.projectId, rlOrigin, { capacity: 120, refillPerSec: 2 });
        } catch (e) {
          const rlStatus = Number(e?.status || 503);
          const safeRlStatus = rlStatus >= 400 && rlStatus < 600 ? rlStatus : 503;
          const rlCode = safeString(
            e?.code || (safeRlStatus === 429 ? "rate_limited" : "rate_limiter_failed"),
            120
          ) || "rate_limiter_failed";
          const rlMessage = safeString(e?.message || "", 300);

          logWorkerError("rate_limit_blocked_ingest", {
            status: safeRlStatus,
            code: rlCode,
            message: rlMessage,
          });

          return json(
            safeRlStatus,
            { ok: false, error: rlCode, request_id: requestId },
            corsHeaders
          );
        }

        const siteRes = await resolveSite(keyResolved.projectId, pageUrl, origin, assertedSiteOrigin, keyResolved.kind);
        if (!siteRes.ok) return json(403, { ok: false, error: siteRes.error, message: siteRes.message, request_id: requestId }, corsHeaders);

        const expectedOrigin = safeString(siteRes.site.origin || "", 500).trim();
        const expectedHost = safeString(siteRes.site.host || "", 260).trim().toLowerCase();
        const expectedPublicId = safeString(siteRes.site.publicId || "", 220).trim();
        const assertedHost = safeString(
          headerSiteHost || bodySiteHost || safeHostFromUrl(assertedSiteOrigin) || "",
          260
        ).trim().toLowerCase();
        const assertedPublicId = safeString(headerSitePublicId || bodySitePublicId || "", 220).trim();

        if (headerSiteOrigin && expectedOrigin && headerSiteOrigin !== expectedOrigin) {
          return json(403, { ok: false, error: "tenant_site_origin_mismatch", request_id: requestId }, corsHeaders);
        }
        if (assertedHost && expectedHost && assertedHost !== expectedHost) {
          return json(403, { ok: false, error: "tenant_site_host_mismatch", request_id: requestId }, corsHeaders);
        }
        if (assertedPublicId && expectedPublicId && assertedPublicId !== expectedPublicId) {
          return json(403, { ok: false, error: "tenant_site_public_id_mismatch", request_id: requestId }, corsHeaders);
        }

        // Hard caps: protect DB + prevent abuse
        const incomingCount = isV5 ? (body.records?.length || 0) : (Array.isArray(body.events) ? body.events.length : 0);
        if (!incomingCount) return json(202, { ok: true, received: 0, request_id: requestId }, corsHeaders);
        if (incomingCount > MAX_INGEST_RECORDS) {
          return json(413, { ok: false, error: "too_many_events", request_id: requestId }, corsHeaders);
        }

        // geo snapshot from Cloudflare edge
        const geo = geoFromRequest(request);

        const envelopeMeta = {
          site_id: siteRes.site.id,
          site_public_id: siteRes.site.publicId,
          site_origin: siteRes.site.origin,
          site_host: siteRes.site.host,

          sdkVersion: sdkVersion || null,
          env: envName || null,

          keyKind: keyResolved.kind || null,
          keySource: keyResolved.source || null,
          keyPrefix: keyResolved.keyPrefix || null,
          keyIdShort,

          // geo intelligence (country + your map region id)
          geo,
        };

        const nowIso = new Date().toISOString();
        const batch = [];

        let stmt;
        if (EVENTS_SCHEMA_V2) {
          stmt = ANALYTICS_DB.prepare(
            `INSERT INTO events (
              project_id,
              site_id,
              anonymous_id,
              session_key,
              page_url,
              route_path,
              page_type,
              component,
              referrer,
              user_agent,
              event_name,
              event_timestamp,
              payload_json,
              project_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
        } else {
          stmt = ANALYTICS_DB.prepare(
            `INSERT INTO events (
              anonymous_id,
              session_key,
              page_url,
              route_path,
              page_type,
              component,
              referrer,
              user_agent,
              event_name,
              event_timestamp,
              payload_json,
              project_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
        }

        const ua = safeString(request.headers.get("User-Agent") || "", 360) || null;

        // -----------------
        // V5 path: records[]
        // -----------------
        if (isV5) {
          function parseJsonObject(raw, maxLen) {
            if (typeof raw !== "string" || !raw.trim()) return null;
            if (raw.length > maxLen) return null;
            try {
              const parsed = JSON.parse(raw);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
              return parsed;
            } catch {
              return null;
            }
          }
          let dropped = 0;
          for (let idx = 0; idx < body.records.length; idx++) {
            const r = body.records[idx];
            if (!r || typeof r !== "object") {
              dropped++;
              continue;
            }

            const eventId = safeString(r.event_id || "", 180).trim();
            const name = safeString(r.event_name || "", 120).trim();
            const eventType = safeString(r.event_type || "", 120).trim() || null;
            const tsNum = Number(r.ts);

            if (!eventId || !name || !Number.isFinite(tsNum) || tsNum <= 0) {
              dropped++;
              continue;
            }

            const recordSitePublicId = safeString(r.site_public_id || "", 220).trim();
            const recordSiteOrigin = safeString(r.site_origin || "", 500).trim();
            const recordSiteHost = safeString(r.site_host || "", 260).trim().toLowerCase();
            if (recordSitePublicId && expectedPublicId && recordSitePublicId !== expectedPublicId) {
              dropped++;
              continue;
            }
            if (recordSiteOrigin && expectedOrigin && recordSiteOrigin !== expectedOrigin) {
              dropped++;
              continue;
            }
            if (recordSiteHost && expectedHost && recordSiteHost !== expectedHost) {
              dropped++;
              continue;
            }

            const ts = safeIsoFromMillis(tsNum, nowIso);
            if (!ts) {
              dropped++;
              continue;
            }
            const eventTsMs = Number(Date.parse(ts)) || Math.round(tsNum);

            const warnings = [];
            let payloadObj = parseJsonObject(r.payload_json, 16_000);
            let metaObj = parseJsonObject(r.meta_json, 16_000);
            if (!payloadObj) {
              payloadObj = {};
              warnings.push("invalid_payload_json");
            }
            if (!metaObj) {
              metaObj = {};
              warnings.push("invalid_meta_json");
            }

            const anonymousId = safeString(r?.anonymous_id || "", 160) || null;
            const sessionKey = safeString(r?.session_key || "", 160) || null;

            const page_url = safeString(r?.page_url || pageUrl || "", 900) || null;
            const route_path = safeString(r?.route_path || "", 260) || null;
            const page_type = safeString(r?.page_type || "", 120) || null;
            const component = safeString(r?.component || "", 140) || null;

            const referrer = safeString(r?.referrer_url || "", 900) || null;

            // Merge + stamp our envelope + geo into __cavbot
            const mergedPayload = {
              ...payloadObj,
              __cavbot: {
                ...envelopeMeta,
                request_id: requestId,
                client_meta: metaObj,
                event_id: eventId,
                event_type: eventType,
                event_ts_ms: eventTsMs,
              },
            };

            if (warnings.length) {
              mergedPayload.__cavbot.ingest_warnings = warnings;
            }

            const payloadStr = JSON.stringify(mergedPayload);

            // Guard rail: keep rows sane
            if (payloadStr.length > 20_000) {
              dropped++;
              continue;
            }

            if (EVENTS_SCHEMA_V2) {
              batch.push(
                stmt.bind(
                  keyResolved.projectId,
                  siteRes.site.id,
                  anonymousId,
                  sessionKey,
                  page_url,
                  route_path,
                  page_type,
                  component,
                  referrer,
                  ua,
                  name,
                  ts,
                  payloadStr,
                  projectKeyStored
                )
              );
            } else {
              batch.push(
                stmt.bind(
                  anonymousId,
                  sessionKey,
                  page_url,
                  route_path,
                  page_type,
                  component,
                  referrer,
                  ua,
                  name,
                  ts,
                  payloadStr,
                  projectKeyStored
                )
              );
            }
          }

          if (!batch.length) {
            return json(
              202,
              { ok: true, received: incomingCount, inserted: 0, dropped, schema: "v5_records", request_id: requestId },
              corsHeaders
            );
          }
          await ANALYTICS_DB.batch(batch);
          return json(
            202,
            {
              ok: true,
              received: incomingCount,
              inserted: batch.length,
              dropped,
              schema: "v5_records",
              request_id: requestId,
            },
            corsHeaders
          );
        }

        // -----------------
        // Legacy path: events[]
        // -----------------
        const events = Array.isArray(body.events) ? body.events : [];
        if (!events.length) return json(202, { ok: true, received: 0, request_id: requestId }, corsHeaders);

        const base = {
          anonymous_id: safeString(body.anonymousId || "", 120) || null,
          session_key: safeString(body.sessionKey || "", 120) || null,
          page_url: safeString(pageUrl || "", 900) || null,
          route_path: safeString(body.routePath || "", 260) || null,
          page_type: safeString(body.pageType || "", 120) || null,
          component: safeString(body.component || "", 120) || null,
          referrer: safeString(body.referrer || "", 900) || null,
          user_agent: ua,
          project_key: projectKeyStored,
          project_id: keyResolved.projectId,
          site_id: siteRes.site.id,
        };

        let dropped = 0;
        for (const e of events) {
          const name = safeString(e?.name || "", 120);
          if (!name) {
            dropped++;
            continue;
          }

          const parsedLegacyTsMs = Number(Date.parse(String(e?.timestamp || "")));
          const ts = safeIsoFromMillis(parsedLegacyTsMs, nowIso) || nowIso;
          const eventTsMs = Number(Date.parse(ts)) || Date.now();

          const payload = e && e.payload && typeof e.payload === "object" ? e.payload : {};
          const mergedPayload = {
            ...payload,
            __cavbot: {
              ...envelopeMeta,
              event_id: null,
              event_type: name,
              event_ts_ms: eventTsMs,
            },
          };
          const payloadStr = JSON.stringify(mergedPayload);

          if (payloadStr.length > 20_000) {
            dropped++;
            continue;
          }

          if (EVENTS_SCHEMA_V2) {
            batch.push(
              stmt.bind(
                base.project_id,
                base.site_id,
                base.anonymous_id,
                base.session_key,
                base.page_url,
                base.route_path,
                base.page_type,
                base.component,
                base.referrer,
                base.user_agent,
                name,
                ts,
                payloadStr,
                base.project_key
              )
            );
          } else {
            batch.push(
              stmt.bind(
                base.anonymous_id,
                base.session_key,
                base.page_url,
                base.route_path,
                base.page_type,
                base.component,
                base.referrer,
                base.user_agent,
                name,
                ts,
                payloadStr,
                base.project_key
              )
            );
          }
        }

        if (!batch.length) {
          return json(
            202,
            { ok: true, received: incomingCount, inserted: 0, dropped, schema: "legacy_events", request_id: requestId },
            corsHeaders
          );
        }
        await ANALYTICS_DB.batch(batch);
        return json(
          202,
          {
            ok: true,
            received: incomingCount,
            inserted: batch.length,
            dropped,
            schema: "legacy_events",
            request_id: requestId,
          },
          corsHeaders
        );
      } catch (e) {
        const status = Number(e?.status || 500);
        const safeStatus = status >= 400 && status < 600 ? status : 500;
        const errorCode = safeString(e?.code || "ingest_failed", 120) || "ingest_failed";
        const message = safeString(e?.message || "Ingest failed", 500);

        logWorkerError("ingest_error", {
          status: safeStatus,
          code: errorCode,
          message,
        });

        return json(
          safeStatus,
          { ok: false, error: errorCode, message, request_id: requestId },
          corsHeaders
        );
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};

export default withTopLevelGuard(worker);