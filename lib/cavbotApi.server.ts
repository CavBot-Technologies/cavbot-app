// lib/cavbotApi.server.ts
import "server-only";
import type { CavBotSite, ProjectSummary } from "./cavbotTypes";

export type SummaryRange = "24h" | "7d" | "14d" | "30d";

type CavBotEnv = {
  baseUrl: string;

  // Optional "default" key (useful for single-tenant/dev). Multi-tenant routes should override per request.
  secretKey?: string;

  // Admin-only endpoints (dashboard/admin reads/writes)
  adminToken?: string;

  runtimeEnv?: string;
  sdkVersion?: string;
};

export type RequestAuthOverride = {
  projectKey?: string;
  adminToken?: string;
  requestId?: string;
};

type SummaryOptions = {
  range?: SummaryRange;
  siteId?: string;
  siteOrigin?: string;
  auth?: RequestAuthOverride;
};

export class CavBotApiError extends Error {
  status?: number;
  code?: string;
  requestId?: string;

  constructor(message: string, status?: number, code?: string, requestId?: string) {
    super(message);
    this.name = "CavBotApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export class CavBotApiConfigError extends CavBotApiError {
  constructor(message: string, requestId?: string) {
    super(message, 500, "config_invalid", requestId);
    this.name = "CavBotApiConfigError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

let _cachedEnv: CavBotEnv | null = null;

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function normalizeBaseUrl(input: string): string {
  const s = (input || "").trim();
  if (!s) return s;

  // Accept:
  // - https://api.cavbot.io
  // - https://api.cavbot.io/v1
  // - https://api.cavbot.io/v1/events
  try {
    const u = new URL(s);
    return u.origin.replace(/\/+$/, "");
  } catch {
    return s
      .replace(/\/v1\/events\/?$/i, "")
      .replace(/\/v1\/?$/i, "")
      .replace(/\/+$/, "");
  }
}

export function getEnv(): CavBotEnv {
  if (_cachedEnv) return _cachedEnv;

  const baseUrlRaw = env("CAVBOT_API_BASE_URL") || env("CAVBOT_API_URL");
  if (!baseUrlRaw) {
    throw new CavBotApiConfigError("Missing env vars: CAVBOT_API_BASE_URL or CAVBOT_API_URL.");
  }

  const secretKey = env("CAVBOT_SECRET_KEY") || env("CAVBOT_PROJECT_KEY") || "";
  const adminToken = env("CAVBOT_ADMIN_TOKEN") || undefined;

  _cachedEnv = {
    baseUrl: normalizeBaseUrl(baseUrlRaw),
    secretKey: secretKey || undefined,
    adminToken,
    runtimeEnv: env("CAVBOT_RUNTIME_ENV") || env("NODE_ENV") || undefined,
    sdkVersion: env("CAVBOT_SDK_VERSION") || undefined,
  };

  return _cachedEnv;
}

function normalizeOrigin(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.origin;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

function normalizeLabel(input: string): string {
  return (input || "").trim().slice(0, 120);
}

function withQuery(url: string, q: Record<string, string | undefined>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(q)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorMessage(base: string, status: number, body: unknown) {
  const record: Record<string, unknown> =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = record?.code ? ` ${String(record.code)}` : "";
  const detail =
    record?.error ? `: ${String(record.error)}` :
    record?.message ? `: ${String(record.message)}` :
    "";
  return `${base} (${status})${code}${detail}`;
}

function randomHex(bytes = 16) {
  const cryptoObj = typeof globalThis.crypto === "object" ? (globalThis.crypto as Crypto) : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const values = new Uint8Array(bytes);
    cryptoObj.getRandomValues(values);
    return Array.from(values)
      .map((num) => num.toString(16).padStart(2, "0"))
      .join("");
  }

  throw new Error("Web Crypto not available for generating random IDs");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    const err = e as { name?: string } | null;
    if (err?.name === "AbortError") {
      throw new CavBotApiError(`Request timed out after ${timeoutMs}ms`, 408, "timeout");
    }
    throw new CavBotApiError("Network error while calling CavBot API", 503, "network_error");
  } finally {
    clearTimeout(t);
  }
}

function buildHeaders(opts?: {
  requireAdmin?: boolean;
  requireProjectKey?: boolean;
  requestId?: string;

  // per-request overrides (multi-tenant)
  projectKey?: string;
  adminToken?: string;
}) {
  const envv = getEnv();

  const requireAdmin = Boolean(opts?.requireAdmin);
  const requireProjectKey = Boolean(opts?.requireProjectKey);

  const explicitProjectKey = typeof opts?.projectKey === "string";
  const explicitAdminToken = typeof opts?.adminToken === "string" && opts.adminToken.length > 0;
  const projectKey = (explicitProjectKey ? opts.projectKey : envv.secretKey) || "";
  const adminToken = (explicitAdminToken ? opts.adminToken : requireAdmin ? envv.adminToken : "") || "";

  if (requireAdmin && !adminToken) {
    throw new CavBotApiConfigError(
      "Missing env var: CAVBOT_ADMIN_TOKEN (required for admin/dashboard endpoints)."
    );
  }

  if (requireProjectKey && !projectKey && !adminToken) {
    throw new CavBotApiConfigError(
      "Missing project key/admin token (CAVBOT_PROJECT_KEY/CAVBOT_SECRET_KEY, CAVBOT_ADMIN_TOKEN, or per-request auth override)."
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Project auth (server-to-server)
  if (projectKey) headers["X-Project-Key"] = projectKey;

  // Admin auth (server-to-server)
  if ((requireAdmin || explicitAdminToken) && adminToken) headers["X-Admin-Token"] = adminToken;

  // Telemetry / trace
  if (envv.runtimeEnv) headers["X-Cavbot-Env"] = envv.runtimeEnv;
  if (envv.sdkVersion) headers["X-Cavbot-Sdk-Version"] = envv.sdkVersion;

  headers["X-Request-Id"] = opts?.requestId || `cav_${Date.now()}_${randomHex(8)}`;

  return headers;
}

export function assertWorkerSiteRegistrationConfig() {
  const envv = getEnv();
  if (!envv.baseUrl) {
    throw new CavBotApiConfigError("Missing env vars: CAVBOT_API_BASE_URL or CAVBOT_API_URL.");
  }
  if (!envv.adminToken) {
    throw new CavBotApiConfigError(
      "Missing env var: CAVBOT_ADMIN_TOKEN (required for admin/dashboard endpoints)."
    );
  }

  return envv;
}

/* =========================
   READS
   ========================= */

export async function getProjectSites(
  projectId: string | number,
  auth?: RequestAuthOverride
): Promise<CavBotSite[]> {
  const { baseUrl } = getEnv();

  const res = await fetchWithTimeout(`${baseUrl}/v1/projects/${String(projectId)}/sites`, {
    method: "GET",
    headers: buildHeaders({
      requireProjectKey: true,
      projectKey: auth?.projectKey,
      requestId: auth?.requestId,
    }),
    cache: "no-store",
  });

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || auth?.requestId || undefined;
    throw new CavBotApiError(
      errorMessage("Failed to load sites", res.status, body),
      res.status,
      body?.code,
      reqId
    );
  }

  return (Array.isArray(body?.sites) ? body.sites : []) as CavBotSite[];
}

export async function getProjectSummary(
  projectId: string | number,
  options?: SummaryOptions
): Promise<ProjectSummary> {
  const { baseUrl } = getEnv();

  const url = withQuery(`${baseUrl}/v1/projects/${String(projectId)}/summary`, {
    range: options?.range,
    siteId: options?.siteId,
    origin: options?.siteOrigin ? normalizeOrigin(options.siteOrigin) : undefined,
  });

  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: buildHeaders({
      requireProjectKey: true,
      projectKey: options?.auth?.projectKey,
      adminToken: options?.auth?.adminToken,
      requestId: options?.auth?.requestId,
    }),
    cache: "no-store",
  });

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || options?.auth?.requestId || undefined;
    throw new CavBotApiError(
      errorMessage("Failed to load summary", res.status, body),
      res.status,
      body?.code || body?.error,
      reqId
    );
  }

  return body as ProjectSummary;
}

/**
 * Multi-tenant friendly wrapper.
 * Your Next route can pass a per-project key (decrypted from DB).
 */
export async function getProjectSummaryForTenant(input: {
  projectId: string | number;
  range?: SummaryRange;
  siteId?: string;
  siteOrigin?: string;
  projectKey?: string;
  adminToken?: string;
  requestId?: string;
}): Promise<ProjectSummary> {
  return getProjectSummary(input.projectId, {
    range: input.range,
    siteId: input.siteId,
    siteOrigin: input.siteOrigin,
    auth: { projectKey: input.projectKey ?? "", adminToken: input.adminToken, requestId: input.requestId },
  });
}

/* =========================
   ADMIN SITE SYNC (Worker/D1)
   ========================= */

export async function registerWorkerSite(projectId: string | number, origin: string, label: string) {
  const { baseUrl } = assertWorkerSiteRegistrationConfig();

  const safeOrigin = normalizeOrigin(origin);
  const safeLabel = normalizeLabel(label);

  const res = await fetchWithTimeout(`${baseUrl}/v1/admin/projects/${String(projectId)}/sites`, {
    method: "POST",
    headers: buildHeaders({ requireAdmin: true }),
    body: JSON.stringify({ origin: safeOrigin, label: safeLabel }),
    cache: "no-store",
  });

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(
      errorMessage("Failed to register site in Worker", res.status, body),
      res.status,
      body?.code,
      reqId
    );
  }

  return body;
}

export async function updateWorkerSite(
  projectId: string | number,
  params: { origin: string; newOrigin?: string; label?: string; isActive?: boolean }
) {
  const { baseUrl } = assertWorkerSiteRegistrationConfig();

  const payload = {
    origin: normalizeOrigin(params.origin),
    newOrigin: params.newOrigin ? normalizeOrigin(params.newOrigin) : undefined,
    label: params.label ? normalizeLabel(params.label) : undefined,
    isActive: typeof params.isActive === "boolean" ? params.isActive : undefined,
  };

  const res = await fetchWithTimeout(`${baseUrl}/v1/admin/projects/${String(projectId)}/sites`, {
    method: "PATCH",
    headers: buildHeaders({ requireAdmin: true }),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(
      errorMessage("Failed to update Worker site", res.status, body),
      res.status,
      body?.code,
      reqId
    );
  }

  return body;
}
