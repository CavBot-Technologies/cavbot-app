// lib/cavbotApi.server.ts
import "server-only";
import type { CavBotSite, ProjectSummary } from "./cavbotTypes";

export type SummaryRange = "7d" | "30d";

type CavBotEnv = {
  baseUrl: string;
  secretKey?: string;  // cavbot_sk_... (OPTIONAL for admin-only reads/writes)
  adminToken?: string; // server-only admin (dashboard/admin reads)
  runtimeEnv?: string;
  sdkVersion?: string;
};

type SummaryOptions = {
  range?: SummaryRange;
  siteId?: string;
  siteOrigin?: string;
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

const DEFAULT_TIMEOUT_MS = 10_000;
let _cachedEnv: CavBotEnv | null = null;

function env(name: string) {
  return (process.env[name] || "").trim();
}

function normalizeBaseUrl(input: string): string {
  const s = (input || "").trim();
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

function getEnv(): CavBotEnv {
  if (_cachedEnv) return _cachedEnv;

  const baseUrlRaw = env("CAVBOT_API_BASE_URL") || env("CAVBOT_API_URL");

  // NOTE (upgrade): secretKey is OPTIONAL now for admin-only endpoints
  const secretKey = env("CAVBOT_SECRET_KEY") || env("CAVBOT_PROJECT_KEY") || "";

  const adminToken = env("CAVBOT_ADMIN_TOKEN") || undefined;

  const runtimeEnv = env("CAVBOT_RUNTIME_ENV") || env("NODE_ENV") || undefined;
  const sdkVersion = env("CAVBOT_SDK_VERSION") || undefined;

  if (!baseUrlRaw) {
    throw new Error("Missing env vars: CAVBOT_API_BASE_URL or CAVBOT_API_URL.");
  }

  _cachedEnv = {
    baseUrl: normalizeBaseUrl(baseUrlRaw),
    secretKey: secretKey || undefined,
    adminToken,
    runtimeEnv,
    sdkVersion,
  };

  return _cachedEnv;
}

function normalizeOrigin(input: string): string {
  const s = (input || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.origin; // strips path/query
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

function errorMessage(base: string, status: number, body: any) {
  const code = body?.code ? ` ${String(body.code)}` : "";
  const detail =
    body?.error ? `: ${String(body.error)}` :
    body?.message ? `: ${String(body.message)}` :
    "";
  return `${base} (${status})${code}${detail}`;
}

function randomHex(bytes = 16) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new CavBotApiError(`Request timed out after ${timeoutMs}ms`, 408, "timeout");
    throw new CavBotApiError(`Network error while calling CavBot API`, 503, "network_error");
  } finally {
    clearTimeout(t);
  }
}

function buildHeaders(opts?: {
  requireAdmin?: boolean;
  requireProjectKey?: boolean;
  requestId?: string;
}) {
  const { secretKey, adminToken, runtimeEnv, sdkVersion } = getEnv();

  const requireAdmin = Boolean(opts?.requireAdmin);
  const requireProjectKey = Boolean(opts?.requireProjectKey);

  if (requireAdmin && !adminToken) {
    throw new Error("Missing env var: CAVBOT_ADMIN_TOKEN (required for admin/dashboard endpoints).");
  }

  if (requireProjectKey && !secretKey) {
    throw new Error("Missing env var: CAVBOT_PROJECT_KEY or CAVBOT_SECRET_KEY (required for project-key endpoints).");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Server-to-server auth (optional now; only included if present)
  if (secretKey) headers["X-Project-Key"] = secretKey;

  if (requireAdmin && adminToken) headers["X-Admin-Token"] = adminToken;

  if (runtimeEnv) headers["X-Cavbot-Env"] = runtimeEnv;
  if (sdkVersion) headers["X-Cavbot-Sdk-Version"] = sdkVersion;

  // Traceability at scale (helps debug prod incidents)
  headers["X-Request-Id"] = opts?.requestId || `cav_${Date.now()}_${randomHex(8)}`;

  return headers;
}

/* =========================
  READS
  ========================= */

export async function getProjectSites(projectId: string | number): Promise<CavBotSite[]> {
  const { baseUrl } = getEnv();

  const res = await fetchWithTimeout(
    `${baseUrl}/v1/projects/${String(projectId)}/sites`,
    {
      method: "GET",
      headers: buildHeaders({ requireAdmin: true }),
      cache: "no-store",
    }
  );

  const json = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(errorMessage("Failed to load sites", res.status, json), res.status, json?.code, reqId);
  }

  return (Array.isArray(json?.sites) ? json.sites : []) as CavBotSite[];
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
    headers: buildHeaders({ requireAdmin: true }),
    cache: "no-store",
  });

  const json = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(errorMessage("Failed to load summary", res.status, json), res.status, json?.code, reqId);
  }

  return json as ProjectSummary;
}

/* =========================
  ADMIN SITE SYNC (Worker/D1)
  ========================= */

export async function registerWorkerSite(projectId: string | number, origin: string, label: string) {
  const { baseUrl } = getEnv();

  const safeOrigin = normalizeOrigin(origin);
  const safeLabel = normalizeLabel(label);

  const res = await fetchWithTimeout(
    `${baseUrl}/v1/admin/projects/${String(projectId)}/sites`,
    {
      method: "POST",
      headers: buildHeaders({ requireAdmin: true }),
      body: JSON.stringify({ origin: safeOrigin, label: safeLabel }),
      cache: "no-store",
    }
  );

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(errorMessage("Failed to register site in Worker", res.status, body), res.status, body?.code, reqId);
  }

  return body;
}

export async function updateWorkerSite(
  projectId: string | number,
  params: { origin: string; newOrigin?: string; label?: string; isActive?: boolean }
) {
  const { baseUrl } = getEnv();

  const payload = {
    origin: normalizeOrigin(params.origin),
    newOrigin: params.newOrigin ? normalizeOrigin(params.newOrigin) : undefined,
    label: params.label ? normalizeLabel(params.label) : undefined,
    isActive: typeof params.isActive === "boolean" ? params.isActive : undefined,
  };

  const res = await fetchWithTimeout(
    `${baseUrl}/v1/admin/projects/${String(projectId)}/sites`,
    {
      method: "PATCH",
      headers: buildHeaders({ requireAdmin: true }),
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );

  const body = await safeJson(res);
  if (!res.ok) {
    const reqId = res.headers.get("X-Request-Id") || undefined;
    throw new CavBotApiError(errorMessage("Failed to update Worker site", res.status, body), res.status, body?.code, reqId);
  }

  return body;
}