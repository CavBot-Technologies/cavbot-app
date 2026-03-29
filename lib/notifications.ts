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
