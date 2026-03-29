import { randomBytes, createHash } from "crypto";
import type { ApiKey, ApiKeyType } from "@prisma/client";

type ApiKeyInsertParams = {
  type: ApiKeyType;
  accountId: string;
  projectId: number;
  siteId?: string | null;
  name?: string | null;
  scopes?: string[];
  rotatedFromId?: string | null;
};

export type ApiKeyPayload = {
  id: string;
  type: ApiKeyType;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: string;
  name: string | null;
  scopes: string[];
  bindings: {
    accountId?: string | null;
    projectId?: number | null;
    siteId?: string | null;
  };
  value?: string;
};

const KEY_PREFIXES: Record<ApiKeyType, string> = {
  PUBLISHABLE: "cavbot_pk_web",
  SECRET: "cavbot_sk_server",
  ADMIN: "cavbot_adm",
};

const DEFAULT_SCOPES: Record<ApiKeyType, string[]> = {
  PUBLISHABLE: ["events:write", "analytics:write", "arcade:read"],
  SECRET: ["events:write", "analytics:write", "arcade:read"],
  ADMIN: ["admin:all"],
};

function normalizeScopes(scopes?: string[]): string[] {
  if (!Array.isArray(scopes)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of scopes) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function randomSegment(length = 24) {
  return randomBytes(length).toString("hex");
}

function buildKeyParts(type: ApiKeyType) {
  const prefix = KEY_PREFIXES[type];
  const randomPart = randomSegment();
  const value = `${prefix}_${randomPart}`;
  const last4 = value.slice(-4);
  const hash = hashApiKey(value);
  return { value, prefix, last4, hash };
}

export function hashApiKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildApiKeyInsertData(params: ApiKeyInsertParams) {
  const scopes = normalizeScopes(params.scopes);
  const effectiveScopes = scopes.length > 0 ? scopes : DEFAULT_SCOPES[params.type];
  const { prefix, last4, value, hash } = buildKeyParts(params.type);

  const data = {
    accountId: params.accountId,
    projectId: params.projectId,
    type: params.type,
    status: "ACTIVE" as const,
    name: params.name || null,
    prefix,
    last4,
    keyHash: hash,
    value: params.type === "PUBLISHABLE" ? value : null,
    scopes: effectiveScopes,
    siteId: params.siteId ?? null,
    rotatedFromId: params.rotatedFromId ?? null,
  };

  return { data, plaintextKey: value };
}

export function serializeApiKey(key: ApiKey, options?: { includeValue?: boolean }): ApiKeyPayload {
  return {
    id: key.id,
    type: key.type,
    prefix: key.prefix,
    last4: key.last4,
    createdAt: key.createdAt?.toISOString?.() ?? new Date().toISOString(),
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    status: key.status,
    name: key.name ?? null,
    scopes: key.scopes ?? [],
    bindings: {
      accountId: key.accountId,
      projectId: key.projectId,
      siteId: key.siteId,
    },
    value: options?.includeValue ? key.value ?? undefined : undefined,
  };
}
