"use client";

import AppShell from "@/components/AppShell";
import {
  NotificationFilter,
  NotificationRaw,
  NotificationRow,
  NotificationTone,
  NOTIFICATION_FILTERS,
  filterNotifications,
  isBackendOnlyNotificationRaw,
  mapRawNotification,
} from "@/lib/notifications";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./page.css";

const PAGE_LIMIT = 50;
const NOTIFICATIONS_ENDPOINT = "/api/notifications";
const MARK_ALL_ENDPOINT = "/api/notifications/read-all";

type NotificationsResponse = {
  ok?: boolean;
  notifications?: NotificationRaw[];
  nextCursor?: string | null;
  error?: string;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [markAllConfirm, setMarkAllConfirm] = useState(false);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<NotificationTone>("good");

  const hasUnread = items.some((item) => item.unread);
  const filteredItems = useMemo(() => filterNotifications(items, filter), [items, filter]);

  const fetchNotifications = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      const { cursor, append } = opts || {};
      if (append) {
        setLoadMoreLoading(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
        if (cursor) params.set("cursor", cursor);

        const response = await fetch(`${NOTIFICATIONS_ENDPOINT}?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });

        const data = (await response.json().catch(() => null)) as NotificationsResponse | null;
        if (!response.ok || data?.ok === false || !Array.isArray(data?.notifications)) {
          throw new Error(data?.error || "Unable to load notifications.");
        }

        const incoming = data.notifications
          .filter((row) => !isBackendOnlyNotificationRaw(row))
          .map(mapRawNotification);
        setNextCursor(data.nextCursor ?? null);

        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((item) => item.id));
            const merged = [...prev];
            for (const item of incoming) {
              if (seen.has(item.id)) continue;
              merged.push(item);
            }
            return merged;
          });
        } else {
          setItems(incoming);
          setExpandedId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load notifications.");
      } finally {
        if (append) {
          setLoadMoreLoading(false);
        } else {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const markAsRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, unread: false } : item)));
    try {
      const response = await fetch(NOTIFICATIONS_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to mark read.");
      }
    } catch {
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, unread: true } : item)));
    }
  }, []);

  const handleRowClick = (item: NotificationRow) => {
    setExpandedId((prev) => (prev === item.id ? null : item.id));
    if (item.unread) {
      markAsRead(item.id);
    }
  };

  const handleRefresh = () => {
    setNextCursor(null);
    fetchNotifications();
  };

  const handleLoadMore = () => {
    if (loadMoreLoading || !nextCursor) return;
    fetchNotifications({ cursor: nextCursor, append: true });
  };

  const handleMarkAllToggle = () => {
    if (markAllConfirm) {
      setMarkAllConfirm(false);
      return;
    }
    if (!hasUnread || markAllLoading) return;
    setMarkAllConfirm(true);
  };

  const confirmMarkAll = async () => {
    setMarkAllLoading(true);
    setError(null);
    try {
      const response = await fetch(MARK_ALL_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "workspace" }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || "Unable to mark all as read.");
      }
      setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
      setToast("All notifications marked as read.");
      setToastTone("good");
      setMarkAllConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark all read.");
    } finally {
      setMarkAllLoading(false);
      setMarkAllConfirm(false);
    }
  };

  const cancelMarkAll = () => {
    if (markAllLoading) return;
    setMarkAllConfirm(false);
  };

  const markAllCheckboxId = "notifications-markall-toggle";

  const showEmptyState = !loading && filteredItems.length === 0;
  const emptyCopy =
    filter === "unread"
      ? "No unread notifications."
      : "All clear — no notifications yet.";

  return (
    <AppShell
      title="Notifications"
      subtitle="Activity and system updates for your workspace."
    >
      <div className="notifications-page">
        <header className="notifications-header">
          <div className="notifications-titleblock">
            <h1 className="notifications-header-title">Notifications</h1>
            <p className="notifications-header-subtitle">Activity and system updates for your workspace.</p>
          </div>
          <div className="notifications-header-actions">
            <button
              type="button"
              className="notifications-refresh"
              onClick={handleRefresh}
              disabled={loading || loadMoreLoading || markAllLoading}
              aria-label="Refresh notifications"
            >
              <span className="notifications-refresh-icon" aria-hidden="true" />
              <span className="cb-sr-only">Refresh notifications</span>
            </button>
          </div>
        </header>

        {markAllConfirm ? (
          <div className="notifications-markall-confirm" role="status">
            <div>
              Mark every notification as read for this workspace. This cannot be undone.
            </div>
            <div className="notifications-markall-confirm-actions">
              <button
                type="button"
                className="notifications-markall-confirm-btn"
                onClick={confirmMarkAll}
                disabled={markAllLoading}
              >
                Apply
              </button>
              <button
                type="button"
                className="notifications-markall-confirm-btn is-ghost"
                onClick={cancelMarkAll}
                disabled={markAllLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {toast ? (
          <div className="notifications-toast" role="status" aria-live="polite" data-tone={toastTone}>
            {toast}
          </div>
        ) : null}

        {error ? (
          <div className="notifications-error" role="alert">
            {error}
          </div>
        ) : null}

          <div className="notifications-tabrow">
            <div className="notifications-filter-wrap">
              <label className="notifications-filter-label" htmlFor="notifications-filter-select">
                Filter
              </label>
              <div className="notifications-filter-control">
                <span className="notifications-filter-icon" aria-hidden="true" />
                <select
                  id="notifications-filter-select"
                  className="notifications-filter-select"
                  aria-label="Notification filters"
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value as NotificationFilter)}
                >
                  {NOTIFICATION_FILTERS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="notifications-filter-chevron" aria-hidden="true" />
              </div>
            </div>
            <label className="notifications-markall notifications-markall-tab" htmlFor={markAllCheckboxId}>
              <input
                id={markAllCheckboxId}
                type="checkbox"
                checked={markAllConfirm}
                onChange={handleMarkAllToggle}
                disabled={!hasUnread || markAllLoading}
              />
              <span className="notifications-markall-box" aria-hidden="true" />
              <span className="notifications-markall-text">Mark all as read</span>
            </label>
          </div>

        <div className="notifications-body">
          {loading ? (
            <div className="notifications-loading">Loading notifications…</div>
          ) : showEmptyState ? (
            <div className="notifications-empty-state">
              <div className="notifications-empty-state-title">{emptyCopy}</div>
            </div>
          ) : (
            <ul className={`notifications-list${filteredItems.length > 12 ? " is-scroll" : ""}`}>
              {filteredItems.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <li
                    key={item.id}
                    className="notifications-row"
                    data-tone={item.tone}
                    data-unread={item.unread ? "1" : "0"}
                  >
                    <button
                      type="button"
                      className="notifications-row-button"
                      onClick={() => handleRowClick(item)}
                      aria-expanded={isExpanded}
                      aria-controls={`notification-detail-${item.id}`}
                    >
                      <div className="notifications-row-status">
                        {item.unread ? (
                          <>
                            <span
                              className="cb-notif-dot notifications-row-dot"
                              aria-hidden="true"
                            />
                            <span className="notifications-status-label">Unread</span>
                          </>
                        ) : (
                          <span className="notifications-status-label is-read">Read</span>
                        )}
                      </div>
                      <div className="notifications-row-content">
                        <div className="notifications-row-heading">
                          <span className="notifications-row-title">{item.title || "Untitled"}</span>
                          <span className="notifications-row-time">{item.createdAt || "—"}</span>
                        </div>
                        <p className="notifications-row-snippet">{item.body || "No details provided."}</p>
                      </div>
                      <span className="notifications-row-chevron" aria-hidden="true">
                        {isExpanded ? "˅" : "›"}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div
                        className="notifications-row-detail"
                        id={`notification-detail-${item.id}`}
                        role="region"
                      >
                        <div className="notifications-row-detail-meta">
                          Status: {item.unread ? "Unread" : "Read"}
                        </div>
                        <p className="notifications-row-detail-body">{item.body || "No additional details."}</p>
                        <div className="notifications-row-detail-time">{item.createdAt || "—"}</div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {nextCursor && !loading ? (
            <div className="notifications-footer">
              <button
                type="button"
                className="notifications-loadmore"
                onClick={handleLoadMore}
                disabled={loadMoreLoading}
              >
                {loadMoreLoading ? "Loading more…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
