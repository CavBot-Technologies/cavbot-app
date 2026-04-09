import "server-only";

import { getAuthPool, newDbId } from "@/lib/authDb";
import type { AuditAction, AuditCategory, AuditSeverity } from "@prisma/client";

type AuditActionDefinition = {
  label: string;
  category: AuditCategory;
  severity: AuditSeverity;
};

const ACTION_DEFINITIONS: Record<AuditAction, AuditActionDefinition> = {
  ACCOUNT_CREATED: { label: "Account created", category: "changes", severity: "info" },
  ACCOUNT_DELETED: { label: "Account deleted", category: "changes", severity: "destructive" },
  ACCOUNT_UPDATED: { label: "Account updated", category: "changes", severity: "info" },
  ALLOWLIST_UPDATED: { label: "Allowlist updated", category: "keys", severity: "warning" },
  AUTH_2FA_EMAIL_SENT: { label: "2FA code sent", category: "system", severity: "info" },
  AUTH_LOGIN_FAILED: { label: "Sign-in failed", category: "system", severity: "warning" },
  AUTH_SIGNED_IN: { label: "Sign-in detected", category: "system", severity: "info" },
  AUTH_SIGNED_OUT: { label: "Signed out", category: "system", severity: "info" },
  BILLING_UPDATED: { label: "Billing updated", category: "changes", severity: "info" },
  EMAIL_CHANGED: { label: "Email changed", category: "changes", severity: "info" },
  KEY_CREATED: { label: "Key created", category: "keys", severity: "info" },
  KEY_ROTATED: { label: "Key rotated", category: "keys", severity: "info" },
  KEY_REVOKED: { label: "Key revoked", category: "keys", severity: "destructive" },
  KEY_USED: { label: "Key used", category: "keys", severity: "info" },
  KEY_DENIED_ORIGIN: { label: "Key denied origin", category: "keys", severity: "warning" },
  KEY_RATE_LIMITED: { label: "Key rate limited", category: "keys", severity: "warning" },
  WIDGET_VERIFIED: { label: "Widget verified", category: "system", severity: "info" },
  WIDGET_DENIED: { label: "Widget denied", category: "system", severity: "warning" },
  INTEGRATION_CONNECTED: { label: "Connection detected", category: "system", severity: "info" },
  MEMBER_INVITED: { label: "Member invited", category: "changes", severity: "info" },
  MEMBER_REMOVED: { label: "Member removed", category: "changes", severity: "warning" },
  MEMBER_ROLE_UPDATED: { label: "Member role changed", category: "changes", severity: "warning" },
  PASSWORD_CHANGED: { label: "Password changed", category: "changes", severity: "info" },
  PLAN_DOWNGRADED: { label: "Plan downgraded", category: "changes", severity: "warning" },
  PLAN_UPGRADED: { label: "Plan upgraded", category: "changes", severity: "info" },
  PROFILE_UPDATED: { label: "Profile updated", category: "changes", severity: "info" },
  SECURITY_SETTINGS_UPDATED: { label: "Security settings updated", category: "changes", severity: "info" },
  PROJECT_CREATED: { label: "Project created", category: "changes", severity: "info" },
  PROJECT_UPDATED: { label: "Project updated", category: "changes", severity: "info" },
  RETENTION_WINDOW_EXPIRED: { label: "Retention window expired", category: "system", severity: "warning" },
  SITE_ADDED: { label: "Website added", category: "sites", severity: "info" },
  SITE_ANALYTICS_PURGED: { label: "Site analytics purged", category: "sites", severity: "destructive" },
  SITE_CREATED: { label: "Site created", category: "sites", severity: "info" },
  SITE_DELETED_IMMEDIATE: { label: "Website deleted immediately", category: "sites", severity: "destructive" },
  SITE_DELETION_REQUESTED: { label: "Site deletion requested", category: "sites", severity: "warning" },
  SITE_DETACHED: { label: "Website removed (monitoring stopped)", category: "sites", severity: "warning" },
  SITE_PURGE_EXECUTED: { label: "Analytics permanently deleted", category: "sites", severity: "destructive" },
  SITE_PURGE_SCHEDULED: { label: "Analytics purge scheduled", category: "sites", severity: "warning" },
  SITE_RESTORED: { label: "Website restored", category: "sites", severity: "info" },
  SITE_SUSPENDED: { label: "Site suspended", category: "sites", severity: "warning" },
  SITE_VERIFIED: { label: "Site verified", category: "sites", severity: "info" },
  SCAN_STARTED: { label: "Scan started", category: "system", severity: "info" },
  SCAN_COMPLETED: { label: "Scan completed", category: "system", severity: "info" },
  SCAN_FAILED: { label: "Scan failed", category: "system", severity: "warning" },
  SCAN_REPORT_DOWNLOADED: { label: "Scan report downloaded", category: "system", severity: "info" },
  SYSTEM_JOB_RAN: { label: "System job executed", category: "system", severity: "info" },
  USERNAME_CHANGED: { label: "Username changed", category: "changes", severity: "info" },
};

type AuditLogWriteParams = {
  accountId: string;
  action: AuditAction;
  operatorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metaJson?: Record<string, unknown> | null;
  origin?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  request?: Request | null;
  category?: AuditCategory;
  severity?: AuditSeverity;
  actionLabel?: string | null;
};

const HEADER_CANDIDATES = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-forwarded-for",
  "x-real-ip",
];

function safeHeader(value?: string | null) {
  return value?.trim() ?? "";
}

function defaultActionLabel(action: string) {
  return action
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function pickClientIp(req?: Request | null) {
  if (!req) return "";
  for (const header of HEADER_CANDIDATES) {
    const raw = safeHeader(req.headers.get(header));
    if (!raw) continue;
    if (header === "x-forwarded-for") {
      return raw.split(",")[0].trim();
    }
    return raw.split(",")[0].trim();
  }
  return "";
}

function canonicalizeOrigin(value?: unknown) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return null;
  try {
    const withProto = raw.includes("//") ? raw : `https://${raw}`;
    const parsed = new URL(withProto);
    const scheme = parsed.protocol === "http:" ? "http:" : "https:";
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port && !["80", "443"].includes(parsed.port) ? `:${parsed.port}` : "";
    return `${scheme}//${host}${port}`;
  } catch {
    return raw;
  }
}

function canonicalizeLast4(value?: unknown) {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  return digits.slice(-4);
}

type AuditMeta = Record<string, unknown>;

function normalizeMeta(meta?: Record<string, unknown> | null): AuditMeta | null {
  if (!meta) return null;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (value === null) {
      normalized[key] = null;
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        normalized[key] = null;
        continue;
      }

      if (key === "origin" || key === "siteOrigin") {
        const parsed = canonicalizeOrigin(trimmed);
        normalized[key] = parsed ?? null;
        continue;
      }

      if (key === "keyLast4" || key === "last4") {
        const formatted = canonicalizeLast4(trimmed);
        normalized[key] = formatted ?? null;
        continue;
      }

      normalized[key] = trimmed;
      continue;
    }

    normalized[key] = value;
  }

  if (!Object.keys(normalized).length) return null;
  try {
    return JSON.parse(JSON.stringify(normalized)) as AuditMeta;
  } catch {
    return null;
  }
}

function attachOrigin(meta: AuditMeta | null, value?: string | null) {
  const canonical = canonicalizeOrigin(value ?? undefined);
  if (!canonical) return meta;
  if (meta && typeof meta.origin === "string" && meta.origin.trim()) {
    return meta;
  }
  return meta ? { ...meta, origin: canonical } : { origin: canonical };
}

function deriveTargetLabelFromMeta(
  meta: AuditMeta | null,
  fallbackType?: string | null,
  fallbackId?: string | null
) {
  if (meta) {
    const origin = typeof meta.origin === "string" && meta.origin.trim() ? meta.origin.trim() : null;
    if (origin) return origin;

    const keyLast4 = typeof meta.keyLast4 === "string" && meta.keyLast4.trim() ? meta.keyLast4.trim() : null;
    if (keyLast4) return `•••• ${keyLast4}`;

    const last4 = typeof meta.last4 === "string" && meta.last4.trim() ? meta.last4.trim() : null;
    if (last4) return `•••• ${last4}`;

    const username = typeof meta.username === "string" && meta.username.trim() ? meta.username.trim() : null;
    if (username) return username;

    const targetLabel = typeof meta.targetLabel === "string" && meta.targetLabel.trim() ? meta.targetLabel.trim() : null;
    if (targetLabel) return targetLabel;

    const keyName = typeof meta.keyName === "string" && meta.keyName.trim() ? meta.keyName.trim() : null;
    if (keyName) return keyName;
  }

  if (fallbackType && fallbackId) return `${fallbackType} · ${fallbackId}`;
  if (fallbackType) return fallbackType;
  return null;
}

export async function auditLogWrite(params: AuditLogWriteParams) {
  if (!params.accountId) return;

  const definition = ACTION_DEFINITIONS[params.action];
  const ip = (params.ip ?? pickClientIp(params.request) ?? "").trim();
  const userAgent = (params.userAgent ?? safeHeader(params.request?.headers.get("user-agent")) ?? "").trim();

  let meta = normalizeMeta(params.metaJson);
  const headerOrigin = params.request
    ? safeHeader(params.request.headers.get("origin") ?? params.request.headers.get("referer"))
    : "";
  const originSource = params.origin ?? headerOrigin;
  meta = attachOrigin(meta, originSource || undefined);

  const category = params.category ?? definition?.category ?? "system";
  const severity = params.severity ?? definition?.severity ?? "info";
  const actionLabel =
    params.actionLabel?.trim() || definition?.label || defaultActionLabel(params.action);

  const resolvedTargetLabel = params.targetLabel?.trim() || deriveTargetLabelFromMeta(meta) || null;

  try {
    await getAuthPool().query(
      `INSERT INTO "AuditLog" (
         "id",
         "accountId",
         "operatorUserId",
         "action",
         "actionLabel",
         "category",
         "severity",
         "targetType",
         "targetId",
         "targetLabel",
         "metaJson",
         "ip",
         "userAgent",
         "createdAt"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::"AuditAction",
         $5,
         $6::"AuditCategory",
         $7::"AuditSeverity",
         $8,
         $9,
         $10,
         $11::jsonb,
         $12,
         $13,
         NOW()
       )`,
      [
        newDbId(),
        params.accountId,
        params.operatorUserId ?? null,
        params.action,
        actionLabel,
        category,
        severity,
        params.targetType ?? null,
        params.targetId ?? null,
        resolvedTargetLabel,
        meta ? JSON.stringify(meta) : null,
        ip || null,
        userAgent || null,
      ],
    );
  } catch (error) {
    console.error("[auditLog] write failed", error);
  }
}

export function getAuditActionDefinition(action: AuditAction) {
  return ACTION_DEFINITIONS[action];
}
