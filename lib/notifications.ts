export type NotificationTone = "good" | "watch" | "bad";
export type NotificationFilter = "all" | "unread" | "alerts" | "updates" | "billing";

export type NotificationRaw = {
  id?: string | number;
  title?: string | null;
  body?: string | null;
  createdAt?: string | null;
  tone?: string | null;
  href?: string | null;
  kind?: string | null;
  meta?: Record<string, unknown> | null;
  unread?: boolean | null;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  tone: NotificationTone;
  href?: string;
  kind?: string;
  meta?: Record<string, unknown> | null;
  unread: boolean;
  createdAt?: string;
  createdAtIso?: string;
};

export type NotificationActionMeta = {
  key: string;
  label: string;
  href: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown> | null;
};

export type NotificationJoinRole = "member" | "admin";

export type NotificationShareMeta = {
  permissionLabel: string | null;
  expiresAtIso: string | null;
};

export type NotificationRevealMeta = {
  revealType: "staff_id" | null;
};

export const NOTIFICATION_FILTERS: { key: NotificationFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "alerts", label: "Alerts" },
  { key: "updates", label: "Updates" },
  { key: "billing", label: "Billing" },
];

export function formatNotificationTimestamp(iso?: string) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function toneOrDefault(raw?: string | null): NotificationTone {
  if (!raw) return "good";
  const cleaned = String(raw).trim().toLowerCase();
  if (cleaned === "watch") return "watch";
  if (cleaned === "bad" || cleaned === "error") return "bad";
  return "good";
}

function isBackendOnlyAiAssistLine(value: string): boolean {
  const line = String(value || "").trim();
  if (!line) return false;
  if (/^AI assist (?:completed|failed)\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)\s*\.?$/i.test(line)) return true;
  if (/^\([a-z0-9_-]+:[a-z0-9_.-]+\)$/.test(line)) return true;
  if (/^[a-z0-9_-]+:[a-z0-9_.-]+$/i.test(line)) return true;
  return false;
}

export function sanitizeNotificationTextForUi(value: unknown): string {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    if (isBackendOnlyAiAssistLine(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function isBackendOnlyNotificationRaw(raw: NotificationRaw): boolean {
  const titleRaw = String(raw?.title || "").trim();
  const bodyRaw = String(raw?.body || "").trim();
  const titleIsBackendOnly = isBackendOnlyAiAssistLine(titleRaw);
  const bodyIsBackendOnly = isBackendOnlyAiAssistLine(bodyRaw);
  return (titleIsBackendOnly || bodyIsBackendOnly) && (!titleRaw || titleIsBackendOnly) && (!bodyRaw || bodyIsBackendOnly);
}

export function mapRawNotification(raw: NotificationRaw): NotificationRow {
  const iso = String(raw.createdAt || "");
  const meta = raw.meta && typeof raw.meta === "object" && !Array.isArray(raw.meta)
    ? raw.meta
    : null;
  const safeTitle = sanitizeNotificationTextForUi(raw.title);
  const safeBody = sanitizeNotificationTextForUi(raw.body);
  return {
    id: String((raw.id ?? iso) || Math.random().toString(16)),
    title: safeTitle || "Notification",
    body: safeBody,
    tone: toneOrDefault(raw.tone),
    href: raw.href ? String(raw.href) : undefined,
    kind: raw.kind ? String(raw.kind) : undefined,
    meta,
    unread: Boolean(raw.unread),
    createdAt: formatNotificationTimestamp(iso),
    createdAtIso: iso || undefined,
  };
}

export function normalizeNotificationActions(meta: Record<string, unknown> | null | undefined): NotificationActionMeta[] {
  if (!meta || typeof meta !== "object") return [];
  const actionsRaw = meta.actions;
  if (!actionsRaw || typeof actionsRaw !== "object" || Array.isArray(actionsRaw)) return [];

  const actions = actionsRaw as Record<string, unknown>;
  const out: NotificationActionMeta[] = [];

  for (const [rawKey, row] of Object.entries(actions)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const parsed = row as Record<string, unknown>;
    const href = String(parsed.href || "").trim();
    if (!href) continue;

    const label = String(parsed.label || "").trim();
    const methodRaw = String(parsed.method || "GET").trim().toUpperCase();
    const method = methodRaw === "POST" || methodRaw === "PATCH" || methodRaw === "DELETE"
      ? methodRaw
      : "GET";
    const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? (parsed.body as Record<string, unknown>)
      : null;

    out.push({
      key,
      label: label || (
        key === "saveToCavCloud"
          ? "Save to CavCloud"
          : key === "openInCavCode"
            ? "Open in CavCode"
            : key === "decline"
              ? "Decline"
              : key === "accept"
                ? "Accept"
                : key === "approve"
                  ? "Approve"
                  : key === "deny"
                    ? "Deny"
                    : key === "requestAccess"
                      ? "Request access"
                      : "Open"
      ),
      href,
      method,
      body,
    });
  }

  return out;
}

export function normalizeNotificationJoinRole(value: unknown): NotificationJoinRole {
  return String(value || "").trim().toLowerCase() === "admin" ? "admin" : "member";
}

export function isWorkspaceJoinApprovalAction(action: NotificationActionMeta): boolean {
  if (!action || action.method === "GET") return false;
  const key = String(action.key || "").trim().toLowerCase();
  if (key !== "accept" && key !== "approve") return false;

  const href = String(action.href || "").trim().toLowerCase();
  if (!href) return false;
  if (href === "/api/invites/respond" || href === "/api/access-requests/respond") return true;
  if (href.includes("/api/workspaces/invites/") && href.endsWith("/accept")) return true;
  if (href.includes("/api/workspaces/access-requests/") && href.endsWith("/approve")) return true;
  return false;
}

export function readNotificationShareMeta(meta: Record<string, unknown> | null | undefined): NotificationShareMeta {
  if (!meta || typeof meta !== "object") {
    return { permissionLabel: null, expiresAtIso: null };
  }
  const permissionLabelRaw = String(meta.permissionLabel || "").trim();
  const permissionRaw = String(meta.permission || "").trim().toUpperCase();
  const permissionLabel = permissionLabelRaw
    || (permissionRaw === "EDIT" ? "Collaborate" : permissionRaw === "VIEW" ? "Read-only" : "");

  const expiresAtIso = String(meta.expiresAtISO || "").trim();
  return {
    permissionLabel: permissionLabel || null,
    expiresAtIso: expiresAtIso || null,
  };
}

export function readNotificationRevealMeta(meta: Record<string, unknown> | null | undefined): NotificationRevealMeta {
  if (!meta || typeof meta !== "object") {
    return { revealType: null };
  }

  const revealType = String(meta.revealType || "").trim().toLowerCase();
  return {
    revealType: revealType === "staff_id" ? "staff_id" : null,
  };
}

export function isOperatorIdReadyNotification(input: {
  kind?: string | null;
  meta?: Record<string, unknown> | null;
}) {
  const kind = String(input.kind || "").trim().toUpperCase();
  if (kind === "OPERATOR_ID_READY") return true;
  return readNotificationRevealMeta(input.meta).revealType === "staff_id";
}

export function formatNotificationExpiry(expiresAtIso: string | null | undefined): string {
  const value = String(expiresAtIso || "").trim();
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  const remainingMs = ts - Date.now();
  if (remainingMs <= 0) return "Expired";
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

const BILLING_KEYWORDS = [
  "subscription",
  "invoice",
  "billing",
  "payment",
  "plan",
  "renew",
];

export function filterNotifications(items: NotificationRow[], filter: NotificationFilter) {
  if (filter === "unread") return items.filter((n) => n.unread);
  if (filter === "alerts") return items.filter((n) => n.tone === "watch" || n.tone === "bad");
  if (filter === "updates") return items.filter((n) => n.tone === "good");
  if (filter === "billing") {
    return items.filter((n) => {
      const hay = `${n.title || ""} ${n.body || ""}`.toLowerCase();
      return BILLING_KEYWORDS.some((keyword) => hay.includes(keyword));
    });
  }
  return items;
}
