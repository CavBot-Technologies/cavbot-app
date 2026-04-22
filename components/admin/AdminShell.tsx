"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { ADMIN_NAV, formatAdminDepartmentLabel, type AdminDepartment } from "@/lib/admin/access";
import { fromAdminInternalPath } from "@/lib/admin/config";
import { hasAdminScope } from "@/lib/admin/permissions";

type StaffView = {
  displayName: string;
  username: string | null;
  avatarImage: string | null;
  avatarTone: string | null;
  positionTitle: string;
  systemRole: string;
  department: AdminDepartment;
  scopes: string[];
  maskedStaffCode: string;
};

type AdminMailThreadSummary = {
  id: string;
  subject: string | null;
  counterpartLabel: string | null;
  boxLabel: string | null;
  preview: string;
  senderAvatarImage: string | null;
  senderAvatarTone: string | null;
  unread: boolean;
  archived: boolean;
  lastMessageAt: string;
  isDirect: boolean;
};

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function normalizeInitialUsernameSource(rawUsername: string) {
  const trimmed = String(rawUsername || "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const pathname = new URL(trimmed).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    return tail.replace(/^@+/, "");
  } catch {
    return trimmed;
  }
}

function deriveAccountInitials(fullName?: string | null, username?: string | null, fallback?: string | null) {
  const name = String(fullName || "").trim();
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(normalizeInitialUsernameSource(String(username || "")));
  if (userInitial) return userInitial;

  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function formatAdminCompactRelativeTime(input?: string | null) {
  const timestamp = Date.parse(String(input || ""));
  if (!Number.isFinite(timestamp)) return "";

  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "Now";

  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} Min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} Hr`;

  const days = Math.round(hours / 24);
  return `${days} D`;
}

function getAdminMailThreadTitle(thread: AdminMailThreadSummary) {
  return thread.subject || thread.counterpartLabel || thread.boxLabel || "CavChat message";
}

function stripMailSubjectPrefix(subject: string, preview: string) {
  const normalizedSubject = String(subject || "").trim();
  const normalizedPreview = String(preview || "").trim();
  if (!normalizedSubject || !normalizedPreview) return normalizedPreview;

  const previewLower = normalizedPreview.toLowerCase();
  const subjectLower = normalizedSubject.toLowerCase();

  if (!previewLower.startsWith(subjectLower)) return normalizedPreview;

  return normalizedPreview.slice(normalizedSubject.length).trim().replace(/^[-:•\s]+/, "").trim();
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="hq-navLockIcon">
      <path
        d="M5.5 6V4.75a2.5 2.5 0 1 1 5 0V6h.75A1.75 1.75 0 0 1 13 7.75v4.5A1.75 1.75 0 0 1 11.25 14h-6.5A1.75 1.75 0 0 1 3 12.25v-4.5A1.75 1.75 0 0 1 4.75 6zm1.25 0h2.5V4.75a1.25 1.25 0 1 0-2.5 0z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconDotsGrid() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <g fill="currentColor" opacity="0.95">
        <circle cx="5" cy="5" r="1.4" />
        <circle cx="11" cy="5" r="1.4" />
        <circle cx="17" cy="5" r="1.4" />
        <circle cx="5" cy="11" r="1.4" />
        <circle cx="11" cy="11" r="1.4" />
        <circle cx="17" cy="11" r="1.4" />
        <circle cx="5" cy="17" r="1.4" />
        <circle cx="11" cy="17" r="1.4" />
        <circle cx="17" cy="17" r="1.4" />
      </g>
    </svg>
  );
}

export default function AdminShell(props: {
  staff: StaffView;
  homeHref: string;
  appAccountHref: string;
  initialMailUnreadCount?: number;
  initialMailThreads?: AdminMailThreadSummary[];
  initialMailReady?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  const mailWrapRef = useRef<HTMLDivElement | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [mailUnreadCount, setMailUnreadCount] = useState(() => Number(props.initialMailUnreadCount) || 0);
  const [mailThreads, setMailThreads] = useState<AdminMailThreadSummary[]>(() => props.initialMailThreads || []);
  const [mailHydrated, setMailHydrated] = useState(Boolean(props.initialMailReady));
  const [mailActionBusyId, setMailActionBusyId] = useState<string | null>(null);
  const mailMountedRef = useRef(true);
  const mailRefreshPromiseRef = useRef<Promise<void> | null>(null);
  const mailLastRefreshAtRef = useRef(props.initialMailReady ? Date.now() : 0);
  const visiblePath = fromAdminInternalPath(pathname || props.homeHref);
  const accountInitials = useMemo(
    () => deriveAccountInitials(props.staff.displayName, props.staff.username, props.staff.displayName),
    [props.staff.displayName, props.staff.username]
  );
  const viewer = useMemo(
    () => ({
      systemRole: props.staff.systemRole,
      scopes: props.staff.scopes,
    }),
    [props.staff.scopes, props.staff.systemRole],
  );
  const canOpenBroadcasts = useMemo(
    () => hasAdminScope(viewer, "notifications.read"),
    [viewer],
  );
  const canOpenMail = useMemo(
    () => hasAdminScope(viewer, "messaging.read"),
    [viewer],
  );
  const canWriteMail = useMemo(
    () => hasAdminScope(viewer, "messaging.write"),
    [viewer],
  );

  const normalizeMailThreads = useCallback((threads?: AdminMailThreadSummary[] | null) => (
    Array.isArray(threads)
      ? threads.filter((thread) => thread.unread && !thread.archived).slice(0, 6)
      : []
  ), []);

  const refreshMailState = useCallback(async (options?: { silent?: boolean; force?: boolean; preloadOnly?: boolean }) => {
    if (!canOpenMail) return;

    const now = Date.now();
    if (!options?.force && options?.preloadOnly && mailLastRefreshAtRef.current && now - mailLastRefreshAtRef.current < 15_000) {
      return;
    }
    if (mailRefreshPromiseRef.current && !options?.force) {
      await mailRefreshPromiseRef.current;
      return;
    }

    const shouldShowLoading = !options?.silent && !mailHydrated && mailThreads.length === 0;
    if (shouldShowLoading) setMailLoading(true);

    const refreshTask = (async () => {
      try {
        const [unreadResponse, threadsResponse] = await Promise.all([
          fetch("/api/admin/chat/unread", {
            credentials: "include",
            cache: "no-store",
          }),
          fetch("/api/admin/chat/threads", {
            credentials: "include",
            cache: "no-store",
          }),
        ]);
        const unreadPayload = unreadResponse.ok
          ? (await unreadResponse.json()) as { unreadCount?: number }
          : null;
        const threadsPayload = threadsResponse.ok
          ? (await threadsResponse.json()) as { threads?: AdminMailThreadSummary[] }
          : null;

        if (!mailMountedRef.current) return;

        setMailUnreadCount(Number(unreadPayload?.unreadCount) || 0);
        setMailThreads(normalizeMailThreads(threadsPayload?.threads || []));
        setMailHydrated(true);
        mailLastRefreshAtRef.current = Date.now();
      } catch {
        if (!mailMountedRef.current) return;
        setMailHydrated(true);
      } finally {
        if (mailMountedRef.current && shouldShowLoading) {
          setMailLoading(false);
        }
        mailRefreshPromiseRef.current = null;
      }
    })();

    mailRefreshPromiseRef.current = refreshTask;
    await refreshTask;
  }, [canOpenMail, mailHydrated, mailThreads.length, normalizeMailThreads]);
  const navSections = useMemo(() => {
    return ADMIN_NAV
      .filter((section) => section.label !== "Human Resources" || props.staff.department === "HUMAN_RESOURCES")
      .map((section) => {
        const items = section.items
          .map((item) => ({
            ...item,
            allowed: hasAdminScope(viewer, item.scope),
          }))
          .filter((item) => props.staff.department === "HUMAN_RESOURCES" || item.allowed);
        return { ...section, items };
      })
      .filter((section) => section.items.length > 0);
  }, [props.staff.department, viewer]);
  useEffect(() => {
    if (!accountOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!accountWrapRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1181px)");
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) {
        setNavOpen(false);
      }
    };

    handleChange(mediaQuery);
    const listener = (event: MediaQueryListEvent) => handleChange(event);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    return () => {
      mailMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!mailOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!mailWrapRef.current?.contains(event.target as Node)) {
        setMailOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMailOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mailOpen]);

  useEffect(() => {
    if (!canOpenMail) return;

    void refreshMailState({ silent: true, preloadOnly: true });

    const intervalId = window.setInterval(() => {
      void refreshMailState({ silent: true, preloadOnly: true });
    }, 25_000);

    const onFocus = () => {
      void refreshMailState({ silent: true, preloadOnly: true });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshMailState({ silent: true, preloadOnly: true });
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canOpenMail, refreshMailState]);

  const signOut = async () => {
    await fetch("/api/admin/session", {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    }).catch(() => null);
    router.replace("/sign-in");
  };

  const handleMailToggle = () => {
    const nextOpen = !mailOpen;
    setMailOpen(nextOpen);
    if (nextOpen && canOpenMail) {
      void refreshMailState({ silent: true, force: !mailHydrated || mailThreads.length === 0 });
    }
  };

  const openMailThread = async (threadId: string) => {
    setMailActionBusyId(threadId);
    if (canWriteMail) {
      try {
        await fetch(`/api/admin/chat/threads/${threadId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({ action: "mark_read" }),
        });
      } catch {
        // Navigate even if the optimistic read marker fails.
      }
    }

    setMailUnreadCount((current) => Math.max(0, current - 1));
    setMailThreads((current) => current.filter((thread) => thread.id !== threadId));
    setMailOpen(false);
    setMailActionBusyId(null);
    router.push(`/chat?thread=${encodeURIComponent(threadId)}`);
  };

  return (
    <div className="hq-shell">
      <div
        className={`hq-overlay ${navOpen ? "is-open" : ""}`}
        aria-hidden={!navOpen}
        onClick={() => setNavOpen(false)}
      />

      <aside className={`hq-sidebar ${navOpen ? "is-open" : ""}`} aria-label="HQ navigation" id="hq-mobile-drawer">
        <div className="hq-sidebarTop">
          <Link
            href={props.homeHref}
            className="cb-wordmark hq-sidebarLogotype"
            aria-label="CavBot HQ home"
            onClick={() => setNavOpen(false)}
          >
            <Image
              src="/logo/official-logotype-light.svg"
              alt="CavBot"
              width={156}
              height={26}
              className="cb-wordmark-img hq-sidebarLogotypeImg"
              priority
            />
          </Link>
          <span className="hq-chip hq-sidebarPositionChip" title={props.staff.positionTitle}>
            {props.staff.positionTitle}
          </span>
        </div>

        <div className="hq-sidebarNav" aria-label="HQ navigation">
          {navSections.map((section) => (
            <section key={section.label} className="hq-navSection">
              <div className="hq-navLabel">{section.label}</div>
              <nav className="hq-nav">
                {section.items.map((item) => (
                  item.allowed ? (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="hq-navLink"
                      data-active={visiblePath === item.href}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="hq-navTitleRow">
                        <span className="hq-navTitle">{item.label}</span>
                      </span>
                      <span className="hq-navSub">{item.sub}</span>
                    </Link>
                  ) : (
                    <div key={item.href} className="hq-navLink" data-disabled="true" aria-disabled="true">
                      <span className="hq-navTitleRow">
                        <span className="hq-navTitle">{item.label}</span>
                        <LockIcon />
                      </span>
                      <span className="hq-navSub">{item.sub}</span>
                    </div>
                  )
                ))}
              </nav>
            </section>
          ))}
        </div>

        <div className="hq-sidebarBottom">
          <div className="hq-metaCard">
            <div className="hq-metaRow">
              <span className="hq-metaLabel">Operator</span>
              <span className="hq-metaValue hq-metaValueTitle">{props.staff.displayName}</span>
            </div>
            <div className="hq-metaRow">
              <span className="hq-metaLabel">Department</span>
              <span className="hq-metaValue">{formatAdminDepartmentLabel(props.staff.department)}</span>
            </div>
            <div className="hq-metaRow">
              <span className="hq-metaLabel">Position</span>
              <span className="hq-metaValue">{props.staff.positionTitle}</span>
            </div>
            <div className="hq-metaRow">
              <span className="hq-metaLabel">Staff ID</span>
              <span className="hq-metaValue">{props.staff.maskedStaffCode}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="hq-main">
        <header className="hq-topbar">
          <div className="hq-topbarLead">
            <button
              className="hq-mobileMenuButton"
              type="button"
              aria-label="Open HQ menu"
              aria-expanded={navOpen}
              aria-controls="hq-mobile-drawer"
              onClick={() => {
                setAccountOpen(false);
                setMailOpen(false);
                setNavOpen(true);
              }}
            >
              <IconDotsGrid />
            </button>
            <Link href={props.homeHref} className="hq-logotype hq-logotypeCompact" aria-label="CavBot HQ home">
              <span className="cb-badge-left" aria-hidden="true">
                <span className="cb-badge cb-badge-inline">
                  <CdnBadgeEyes />
                </span>
              </span>
              <span className="hq-logotypeText hq-topbarLogotypeFull">Headquarter</span>
              <span className="hq-logotypeText hq-topbarLogotypeCompactLabel">Hq</span>
            </Link>
            <span className="hq-chip hq-topbarPositionChip" title={props.staff.positionTitle}>
              {props.staff.positionTitle}
            </span>
          </div>
          <div className="hq-topbarActions">
            {canOpenBroadcasts ? (
              <Link
                href="/broadcasts"
                className="hq-topbarShortcut"
                data-active={visiblePath === "/broadcasts"}
                aria-label="Open Broadcast Center"
                title="Broadcast Center"
              >
                <span className="hq-topbarShortcutIcon hq-topbarBroadcastIcon" aria-hidden="true" />
              </Link>
            ) : null}
            {canOpenMail ? (
              <div className="cb-notif-wrap hq-topbarMailWrap" ref={mailWrapRef}>
                <button
                  className="hq-topbarShortcut cb-notif-btn"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={mailOpen}
                  aria-label="Open CavChat inbox"
                  title="CavChat inbox"
                  onMouseEnter={() => {
                    void refreshMailState({ silent: true, preloadOnly: true });
                  }}
                  onFocus={() => {
                    void refreshMailState({ silent: true, preloadOnly: true });
                  }}
                  onClick={() => {
                    void handleMailToggle();
                  }}
                >
                  <span className="hq-topbarShortcutIcon hq-topbarMailIcon" aria-hidden="true" />
                  {mailUnreadCount > 0 ? (
                    <span className="cb-notif-bubble hq-topbarMailBubble" aria-label={`${mailUnreadCount} unread staff messages`}>
                      {mailUnreadCount > 99 ? "99+" : String(mailUnreadCount)}
                    </span>
                  ) : null}
                </button>

                {mailOpen ? (
                  <div className="cb-notif-menu" role="menu" aria-label="CavChat inbox">
                    <div className="cb-notif-head">
                      <div className="cb-notif-head-row">
                        <div className="cb-notif-title">CavChat inbox</div>
                        <div className="cb-notif-head-actions">
                          <button
                            className="cb-notif-close"
                            type="button"
                            onClick={() => setMailOpen(false)}
                            aria-label="Close CavChat inbox"
                          >
                            <span className="cb-closeIcon" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="cb-notif-body">
                      {mailLoading && mailThreads.length === 0 ? (
                        <div className="cb-notif-empty">
                          <div className="cb-notif-empty-title">Checking staff mail</div>
                          <div className="cb-notif-empty-sub">Pulling the latest unread CavChat threads.</div>
                        </div>
                      ) : mailThreads.length === 0 ? (
                        <div className="cb-notif-empty">
                          <div className="cb-notif-empty-title">Inbox is clear</div>
                          <div className="cb-notif-empty-sub">New staff messages and org box updates will appear here.</div>
                        </div>
                      ) : (
                        <div className="cb-notif-list">
                          {mailThreads.map((thread) => {
                            const subject = getAdminMailThreadTitle(thread);
                            const sender = thread.counterpartLabel || thread.boxLabel || "CavChat";
                            const preview = stripMailSubjectPrefix(subject, thread.preview);
                            const senderInitials = deriveAccountInitials(sender, null, sender);
                            return (
                              <div className="cb-notif-item is-unread" key={thread.id}>
                                <button
                                  type="button"
                                  className="cb-notif-link cb-notif-link-btn cb-notif-itemPrimary"
                                  disabled={mailActionBusyId === thread.id}
                                  onClick={() => {
                                    void openMailThread(thread.id);
                                  }}
                                >
                                  <div className="hq-avatar hq-topbarMailNotifAvatar" data-size="sm" data-tone={thread.senderAvatarTone || "navy"} aria-hidden="true">
                                    {thread.senderAvatarImage ? (
                                      <img src={thread.senderAvatarImage} alt="" />
                                    ) : (
                                      <span className="hq-topbarMailNotifInitials">{senderInitials}</span>
                                    )}
                                  </div>
                                  <div className="cb-notif-meta hq-topbarMailNotifMeta">
                                    <div className="hq-topbarMailNotifTopRow">
                                      <div className="hq-topbarMailNotifSender">{sender}</div>
                                      <div className="cb-notif-item-time hq-topbarMailNotifTime">{formatAdminCompactRelativeTime(thread.lastMessageAt)}</div>
                                    </div>
                                    <div className="hq-topbarMailNotifSubject">{subject}</div>
                                    {preview ? <div className="cb-notif-item-body hq-topbarMailNotifBody">{preview}</div> : null}
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="cb-notif-foot">
                      <Link
                        className="cb-notif-viewall hq-topbarMailViewAllButton"
                        data-department={props.staff.department}
                        href="/chat"
                        aria-label="Open full CavChat inbox"
                        title="Open full CavChat inbox"
                        onClick={() => setMailOpen(false)}
                      >
                        <span className="hq-topbarMailExpandIcon" aria-hidden="true" />
                        <span className="cb-sr-only">Open full CavChat inbox</span>
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="cb-account-wrap" ref={accountWrapRef}>
              <button
                className="hq-accountButton hq-topbarAccountButton"
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label="Open account menu"
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span
                  className="cb-account-chip cb-avatar-plain hq-accountChip hq-topbarAccountChip"
                  data-tone={props.staff.avatarTone || "lime"}
                  aria-hidden="true"
                >
                  {props.staff.avatarImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={props.staff.avatarImage} alt="" />
                  ) : (
                    <span className="cb-account-initials">{accountInitials}</span>
                  )}
                </span>
              </button>

              {accountOpen ? (
                <div className="cb-menu cb-menu-right cb-account-menu" role="menu" aria-label="Account">
                  <button
                    className="cb-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      router.push(props.appAccountHref);
                    }}
                  >
                    My CavBot Account
                  </button>
                  <button
                    className="cb-menu-item danger"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false);
                      void signOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="hq-content">{props.children}</div>
      </main>
    </div>
  );
}
