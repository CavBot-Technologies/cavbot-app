"use client";

import Image from "next/image";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { browserDisplayName, detectBrowser, type BrowserKey } from "@/lib/browser";

type HistoryCategory = "all" | "sites" | "keys" | "system" | "changes";

type HistoryEntry = {
  id: string;
  action: string;
  actionLabel: string;
  category: string;
  severity: "info" | "warning" | "destructive";
  targetType: string | null;
  targetId: string | null;
  targetLabel: string;
  operator: {
    id: string | null;
    fullName: string | null;
    displayName: string;
    role: string | null;
    email: string | null;
    username: string | null;
  };
  meta: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

type HistoryResponse = {
  ok: true;
  entries: HistoryEntry[];
  nextCursor: string | null;
} | {
  ok: false;
  error: string;
};

const FILTERS: Array<{ key: HistoryCategory; label: string }> = [
  { key: "all", label: "All" },
  { key: "sites", label: "Sites" },
  { key: "keys", label: "Keys" },
  { key: "system", label: "System" },
  { key: "changes", label: "Changes" },
];
const MAX_VISIBLE_HISTORY_CARDS = 6;

const SEVERITY_LABEL: Record<HistoryEntry["severity"], string> = {
  info: "Info",
  warning: "Warning",
  destructive: "Destructive",
};

const HISTORY_BACKEND_STATUS_RE = /^AI assist (?:completed|failed)\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)\s*\.?$/i;
const HISTORY_BACKEND_TOKEN_RE = /^\(?[a-z0-9_-]+:[a-z0-9_.-]+\)?$/i;

function sanitizeHistoryText(value: unknown): string {
  const raw = String(value || "").replace(/\r\n?/g, "\n");
  if (!raw) return "";
  const lines = raw.split("\n");
  const kept: string[] = [];

  for (const rawLine of lines) {
    const trimmed = String(rawLine || "").trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }
    if (HISTORY_BACKEND_TOKEN_RE.test(trimmed)) continue;

    let line = String(rawLine || "");
    line = line.replace(/AI assist completed\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)/gi, "CavAi assist completed");
    line = line.replace(/AI assist failed\s*\([a-z0-9_-]+:[a-z0-9_.-]+\)/gi, "CavAi assist failed");
    line = line.replace(/\(\s*[a-z0-9_-]+:[a-z0-9_.-]+\s*\)/gi, "");
    line = line.replace(/\bai_assist\b/gi, "CavAi");
    line = line.replace(/\bcavtools_command\b/gi, "CavTools Command");
    line = line.replace(/\s{2,}/g, " ").trim();
    if (!line) continue;
    if (HISTORY_BACKEND_STATUS_RE.test(line)) {
      line = /failed/i.test(line) ? "CavAi assist failed" : "CavAi assist completed";
    }
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeHistoryMetaValue(value: unknown): unknown {
  if (typeof value === "string") {
    const cleaned = sanitizeHistoryText(value);
    return cleaned || null;
  }
  if (Array.isArray(value)) {
    const out = value
      .map((item) => sanitizeHistoryMetaValue(item))
      .filter((item) => item !== null && item !== "");
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = sanitizeHistoryMetaValue(entry);
      if (cleaned === null || cleaned === "") continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

function sanitizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  const actionLabel = sanitizeHistoryText(entry.actionLabel) || "CavAi";
  const targetLabel = sanitizeHistoryText(entry.targetLabel) || "—";
  const targetTypeRaw = sanitizeHistoryText(entry.targetType || "");
  const targetType = targetTypeRaw || null;
  const metaRaw = sanitizeHistoryMetaValue(entry.meta);
  const meta = metaRaw && typeof metaRaw === "object" && !Array.isArray(metaRaw)
    ? (metaRaw as Record<string, unknown>)
    : null;
  return {
    ...entry,
    actionLabel,
    targetLabel,
    targetType,
    meta,
  };
}

function SeverityIcon({ severity }: { severity: HistoryEntry["severity"] }) {
  return (
    <span className="hx-infoIcon" aria-hidden="true" title={SEVERITY_LABEL[severity]}>
      <span className="hx-infoIconGlyph" />
    </span>
  );
}

function BrowserIcon({ browser }: { browser: BrowserKey }) {
  if (browser === "safari") {
    return (
      <span className="hx-browserIcon" aria-hidden="true" title="Safari">
        <Image src="/icons/app/safari-option-svgrepo-com.svg" alt="" width={18} height={18} loading="lazy" decoding="async" />
      </span>
    );
  }

  if (browser === "chrome") {
    return (
      <span className="hx-browserIcon" aria-hidden="true" title="Chrome">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.16)" />
          <path d="M12 3a9 9 0 0 1 7.8 4.5H12Z" fill="rgba(255,90,90,0.50)" />
          <path d="M19.8 7.5A9 9 0 0 1 12 21l4.8-8.3Z" fill="rgba(185,200,90,0.50)" />
          <path d="M12 21A9 9 0 0 1 4.2 7.5L9.2 16Z" fill="rgba(78,168,255,0.50)" />
          <circle cx="12" cy="12" r="3.4" fill="rgba(234,240,255,0.78)" />
          <circle cx="12" cy="12" r="2.1" fill="rgba(78,168,255,0.18)" />
        </svg>
      </span>
    );
  }

  if (browser === "brave") {
    return (
      <span className="hx-browserIcon" aria-hidden="true" title="Brave">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <path
            d="M12 3l4 1.2 2 2.8-.7 9.2L12 21 6.7 16.2 6 7l2-2.8L12 3Z"
            fill="rgba(255,120,120,0.16)"
            stroke="rgba(255,255,255,0.16)"
          />
          <path d="M9 9h6l-1 6h-4L9 9Z" fill="rgba(234,240,255,0.74)" />
        </svg>
      </span>
    );
  }

  if (browser === "firefox") {
    return (
      <span className="hx-browserIcon" aria-hidden="true" title="Firefox">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(139,92,255,0.14)" stroke="rgba(255,255,255,0.16)" />
          <path
            d="M7.4 15.9c1.5 1.6 3.3 2.4 5.2 2.4 3.5 0 6.2-2.5 6.2-5.8 0-2.7-1.9-4.9-4.6-5.5 1.2 1.5.4 3-1.1 3.4-1.1.3-2.2-.2-2.8-1.2-1.3 1.1-2.1 2.7-2.1 4.2 0 .9.3 1.8 1.2 2.5Z"
            fill="rgba(234,240,255,0.74)"
          />
        </svg>
      </span>
    );
  }

  if (browser === "edge") {
    return (
      <span className="hx-browserIcon" aria-hidden="true" title="Edge">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(78,168,255,0.12)" stroke="rgba(255,255,255,0.16)" />
          <path
            d="M18 14.5c-.8 2.3-3 3.9-5.7 3.9-3.4 0-6.1-2.5-6.1-5.7 0-2.8 2-5.1 4.8-5.6-.9 1.1-.5 2.2.4 2.8.9.6 2.2.6 3.2.1 1.4-.7 3-.3 3.4 1.1Z"
            fill="rgba(185,200,90,0.50)"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="hx-browserIcon" aria-hidden="true" title="Session">
      <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
        <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" />
        <path d="M8 12h8" stroke="rgba(255,255,255,0.58)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function metaValue(meta: Record<string, unknown> | null, key: string) {
  if (!meta) return "";
  const value = meta[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveBrowser(entry: HistoryEntry): BrowserKey {
  const fromMeta = String(entry.meta?.browser || "").trim().toLowerCase();
  if (["safari", "chrome", "brave", "firefox", "edge"].includes(fromMeta)) return fromMeta as BrowserKey;
  return detectBrowser(entry.userAgent || "");
}

function resolveDevice(entry: HistoryEntry): string {
  const fromMeta = metaValue(entry.meta, "device");
  if (fromMeta) return fromMeta;
  const ua = String(entry.userAgent || "");
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac OS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

function resolveRegion(entry: HistoryEntry): string {
  return (
    metaValue(entry.meta, "geoRegion") ||
    metaValue(entry.meta, "region") ||
    metaValue(entry.meta, "regionCode") ||
    "Not captured"
  );
}

function resolveLocation(entry: HistoryEntry): string {
  return (
    metaValue(entry.meta, "location") ||
    metaValue(entry.meta, "geoLabel") ||
    metaValue(entry.meta, "place") ||
    "Not captured"
  );
}

function resolveOrigin(entry: HistoryEntry): string {
  const origin = metaValue(entry.meta, "origin");
  if (origin) return origin;
  const target = String(entry.targetLabel || "").trim();
  if (/^https?:\/\//i.test(target)) return target;
  return "Not captured";
}

function resolveIp(entry: HistoryEntry): string {
  const ip = String(entry.ip || "").trim();
  return ip || "Not captured";
}

function resolveUserAgent(entry: HistoryEntry): string {
  const ua = String(entry.userAgent || "").trim();
  return ua || "Not captured";
}

function formatMetaJson(meta: Record<string, unknown> | null): string {
  if (!meta || typeof meta !== "object") {
    return '{\n  "status": "Not captured"\n}';
  }
  try {
    return sanitizeHistoryText(JSON.stringify(meta, null, 2)) || '{\n  "status": "Not captured"\n}';
  } catch {
    return '{\n  "status": "Unavailable"\n}';
  }
}

function normalizeLast4(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  return "";
}

function resolveKeyLast4(entry: HistoryEntry): string {
  const meta = entry.meta;
  const candidateValues = [
    meta?.keyLast4,
    meta?.last4,
    meta?.newLast4,
    meta?.oldLast4,
    meta?.previousLast4,
    entry.targetLabel,
    entry.targetId,
  ];
  for (const value of candidateValues) {
    const last4 = normalizeLast4(value);
    if (last4) return `•••• ${last4}`;
  }
  return "Not recorded";
}

function determineActionTone(label: string, action: string, severity: HistoryEntry["severity"]) {
  const text = `${label || ""} ${action || ""}`.toLowerCase();
  const positive = ["account_updated", "update", "updated", "upgrade", "upgraded", "validate", "validated", "created", "added", "approved", "authorized"];
  const negative = ["delete", "deleted", "remove", "removed", "fail", "failed", "revoked", "denied", "cancel", "canceled"];
  const signIn = ["signed in", "sign-in detected", "auth_signed_in"];
  const signOut = ["signed out", "sign out", "auth_signed_out"];

  if (negative.some((term) => text.includes(term))) return "bad";
  if (signOut.some((term) => text.includes(term))) return "warn";
  if (signIn.some((term) => text.includes(term))) return "live";
  if (positive.some((term) => text.includes(term))) return "good";
  if (severity === "destructive") return "bad";
  return severity === "warning" ? "bad" : "good";
}

export default function HistoryClient() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [category, setCategory] = useState<HistoryCategory>("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridMaxHeight, setGridMaxHeight] = useState<number | null>(null);

  const fetchHistory = useCallback(
    async (opts: { loadMore: boolean; cursor?: string | null }) => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("category", category);
        params.set("limit", "24");
        if (opts.loadMore && opts.cursor) params.set("cursor", opts.cursor);

        const response = await fetch(`/api/settings/history?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json()) as HistoryResponse;
        if (!response.ok || !payload.ok) {
          throw new Error((payload as { error?: string }).error || "Failed to load history.");
        }

        const incoming = (payload.entries || []).map(sanitizeHistoryEntry);
        setEntries((prev) => (opts.loadMore ? [...prev, ...incoming] : incoming));
        setNextCursor(payload.nextCursor);
        setHasMore(Boolean(payload.nextCursor));
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError("Unable to load history right now.");
      } finally {
        setLoading(false);
      }
    },
    [category]
  );

  useEffect(() => {
    setEntries([]);
    setNextCursor(null);
    setHasMore(false);
    setExpandedId(null);
    fetchHistory({ loadMore: false, cursor: null });
    return () => {
      controllerRef.current?.abort();
    };
  }, [category, fetchHistory]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    if (!nextCursor) return;
    fetchHistory({ loadMore: true, cursor: nextCursor });
  }, [fetchHistory, hasMore, loading, nextCursor]);

  const formattedEntries = useMemo(
    () =>
      [...entries]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((entry) => ({
          ...entry,
          when: new Date(entry.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        })),
    [entries]
  );

  const isInitialLoading = loading && !formattedEntries.length;
  const shouldScrollGrid = formattedEntries.length > MAX_VISIBLE_HISTORY_CARDS;

  useLayoutEffect(() => {
    if (!shouldScrollGrid) {
      setGridMaxHeight(null);
      return;
    }

    let raf = 0;
    const measure = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const cards = grid.querySelectorAll<HTMLElement>(".hx-card");
      const cutoffCard = cards[MAX_VISIBLE_HISTORY_CARDS - 1];
      if (!cutoffCard) {
        setGridMaxHeight(null);
        return;
      }
      const nextHeight = Math.ceil(cutoffCard.offsetTop + cutoffCard.offsetHeight);
      setGridMaxHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
    };
  }, [shouldScrollGrid, entries, expandedId]);

  const scrollStyle = shouldScrollGrid
    ? {
        maxHeight: `${gridMaxHeight || 980}px`,
        overflowY: "auto" as const,
        scrollbarWidth: "none" as const,
        msOverflowStyle: "none" as const,
      }
    : undefined;

  return (
    <div className="hx-history">
      <div className="hx-controls">
        <div className="hx-filters">
          <label className="hx-filter-label" htmlFor="history-filter-select">
            Filter
          </label>
          <div className="hx-filter-control">
            <span className="hx-filter-icon" aria-hidden="true" />
            <select
              id="history-filter-select"
              className="hx-filter-select"
              aria-label="History filters"
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value as HistoryCategory)}
            >
              {FILTERS.map((filter) => (
                <option key={filter.key} value={filter.key}>
                  {filter.label}
                </option>
              ))}
            </select>
            <span className="hx-filter-chevron" aria-hidden="true" />
          </div>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="hx-loading" role="status" aria-label="Loading history">
          <span className="hx-loadingIcon" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="hx-error">{error}</div>
      ) : !formattedEntries.length ? (
        <div className="hx-empty">
          <div className="hx-empty-title">No history yet.</div>
          <div className="hx-empty-sub">Activity will appear here as account and security events are recorded.</div>
        </div>
      ) : (
        <div
          ref={gridRef}
          className={`hx-grid ${shouldScrollGrid ? "is-scroll" : ""}`}
          style={scrollStyle}
        >
          {formattedEntries.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const browser = resolveBrowser(entry);
          const device = resolveDevice(entry);
          const region = resolveRegion(entry);
          const timeLabel = new Date(entry.createdAt).toLocaleTimeString(undefined, {
            timeStyle: "short",
          });
          const operatorFullName = entry.operator.fullName?.trim();
          const operatorDisplayName = entry.operator.displayName?.trim();
          const operatorEmail = entry.operator.email?.trim();
          const operatorUsername = entry.operator.username?.trim();
          const operatorRoleRaw = entry.operator.role?.trim() || null;
          const operatorRole = operatorRoleRaw ? operatorRoleRaw.toUpperCase() : null;
          const primaryName = operatorFullName || operatorDisplayName;
          const usernameFallback = operatorUsername ? `@${operatorUsername}` : null;
          const isOwner = operatorRole === "OWNER";
          const emailFallback = isOwner || !operatorEmail ? null : `@${operatorEmail.split("@")[0]}`;
          const operatorLabel =
            primaryName || usernameFallback || emailFallback || "Unknown operator";
          const severityLabel = SEVERITY_LABEL[entry.severity];
          const toggleExpanded = () =>
            setExpandedId((prev) => (prev === entry.id ? null : entry.id));
          return (
            <article
              key={entry.id}
              className={`hx-card ${isExpanded ? "is-expanded" : ""}`}
            >
              <div className="hx-card-top">
                <div className="hx-card-time">
                  <span className="hx-card-date">{entry.when}</span>
                  <span className="hx-card-timeSub">{timeLabel}</span>
                </div>
                <div className="hx-card-chipWrap">
                  <button
                    type="button"
                    className={`hx-chipToggle ${isExpanded ? "is-on" : ""}`}
                    onClick={toggleExpanded}
                    aria-expanded={isExpanded}
                    aria-controls={`history-details-${entry.id}`}
                    aria-label={isExpanded ? "Hide details" : `View details for ${entry.actionLabel}`}
                    title={isExpanded ? "Hide details" : "View details"}
                  >
                    <SeverityIcon severity={entry.severity} />
                    <span className="cb-sr-only">{severityLabel}</span>
                  </button>
                </div>
              </div>
              <div className="hx-card-grid">
                <div className="hx-card-field">
                  <span className="hx-card-label">Operator</span>
                  <span className="hx-card-value">{operatorLabel}</span>
                  {operatorRole ? (
                    <span className="hx-card-sub">{operatorRole}</span>
                  ) : null}
                  {Boolean(operatorEmail && !isOwner) ? (
                    <span className="hx-card-sublight">{operatorEmail}</span>
                  ) : null}
                </div>
                <div className="hx-card-field">
                  <span className="hx-card-label">Action</span>
                  <span
                    className={`hx-card-value hx-action hx-action-tone-${determineActionTone(
                      entry.actionLabel,
                      entry.action,
                      entry.severity
                    )}`}
                  >
                    {entry.actionLabel}
                  </span>
                </div>
                <div className="hx-card-field">
                  <span className="hx-card-label">Browser</span>
                  <span className="hx-card-value hx-browserValue">
                    <BrowserIcon browser={browser} />
                    <span>{browserDisplayName(browser)}</span>
                  </span>
                  {device || region !== "Not captured" ? (
                    <span className="hx-card-sublight">
                      {[device, region !== "Not captured" ? region : ""].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </div>
                <div className="hx-card-field">
                  <span className="hx-card-label">Target</span>
                  <span className="hx-card-value hx-target">{entry.targetLabel || "—"}</span>
                  {entry.targetType ? (
                    <span className="hx-card-sublight">{entry.targetType}</span>
                  ) : null}
                </div>
              </div>
              {isExpanded ? (
                <div
                  id={`history-details-${entry.id}`}
                  className="hx-card-details"
                >
                  <div className="hx-card-detailsSummary">
                    <div className="hx-card-detailItem">
                      <strong>ORIGIN</strong>
                      <span className="hx-card-detailValue hx-mono">{resolveOrigin(entry)}</span>
                    </div>
                    <div className="hx-card-detailItem">
                      <strong>KEY LAST4</strong>
                      <span className="hx-card-detailValue">{resolveKeyLast4(entry)}</span>
                    </div>
                    <div className="hx-card-detailItem">
                      <strong>REGION</strong>
                      <span className="hx-card-detailValue">{region}</span>
                    </div>
                    <div className="hx-card-detailItem">
                      <strong>LOCATION</strong>
                      <span className="hx-card-detailValue">{resolveLocation(entry)}</span>
                    </div>
                    <div className="hx-card-detailItem">
                      <strong>IP</strong>
                      <span className="hx-card-detailValue hx-mono">{resolveIp(entry)}</span>
                    </div>
                  </div>
                  <div className="hx-card-detailsPanels">
                    <section className="hx-card-detailsPanel">
                      <strong>META</strong>
                      <pre className="hx-meta hx-metaJson">{formatMetaJson(entry.meta)}</pre>
                    </section>
                    <section className="hx-card-detailsPanel">
                      <strong>USER AGENT</strong>
                      <pre className="hx-meta hx-userAgentValue">{resolveUserAgent(entry)}</pre>
                    </section>
                  </div>
                </div>
              ) : null}
            </article>
          );
          })}
        </div>
      )}

      {formattedEntries.length ? (
        <div className="hx-actions">
          <button
            className="hx-link"
            type="button"
            onClick={loadMore}
            disabled={!hasMore || loading}
          >
            {hasMore ? "Load more history" : "All caught up"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
