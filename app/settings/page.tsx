"use client";

import "./settings.css";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import AppShell from "@/components/AppShell";
import SettingsStatusCard from "./sections/SettingsStatusCard";
import AccountOverviewClient from "./sections/AccountOverviewClient";
import TeamClient from "./sections/TeamClient";
import CollaborationClient from "./sections/CollaborationClient";
import SecurityClient from "./sections/SecurityClient";
import NotificationsClient from "./sections/NotificationsClient";
import BillingClient from "./sections/BillingClient";
import ApiKeysPanel from "./sections/ApiKeysPanel";
import HistoryClient from "./sections/HistoryClient";

type SettingsKey =
  | "account"
  | "team"
  | "collaboration"
  | "security"
  | "notifications"
  | "billing"
  | "integrations"
  | "api"
  | "history";

function safeKey(v: string | undefined): SettingsKey {
  const k = String(v || "account").toLowerCase().trim();
  if (k === "team") return "team";
  if (k === "collaboration") return "collaboration";
  if (k === "security") return "security";
  if (k === "notifications") return "notifications";
  if (k === "billing") return "billing";
  if (k === "integrations") return "integrations";
  if (k === "api") return "api";
  if (k === "history") return "history";
  return "account";
}

function hrefWith(next: Partial<{ tab: SettingsKey }>, current: SettingsKey) {
  const p = new URLSearchParams();
  p.set("tab", next.tab || current);
  return `?${p.toString()}`;
}

function buildSettingsHref(key: SettingsKey, current: SettingsKey) {
  if (key === "integrations") {
    return "/settings/integrations";
  }
  return hrefWith({ tab: key }, current);
}

function PlaceholderPanel(props: { title: string; subtitle: string }) {
  return (
    <section className="sx-panel" aria-label={props.title}>
      <header className="sx-panelHead">
        <div>
          <h2 className="sx-h2">{props.title}</h2>
          <p className="sx-sub">{props.subtitle}</p>
        </div>
        <span className="sx-badge">Staged</span>
      </header>

      <div className="sx-empty">
        <div className="sx-emptyTitle">This module is queued.</div>
        <div className="sx-emptySub">
          The Settings system is live. Next step is wiring this panel to persistence + API routes.
        </div>
      </div>
    </section>
  );
}

const SETTINGS_PRELOAD_ROUTES = [
  "/settings",
  "/settings?tab=account",
  "/settings?tab=team",
  "/settings?tab=collaboration",
  "/settings?tab=security",
  "/settings?tab=notifications",
  "/settings?tab=billing",
  "/settings?tab=api",
  "/settings?tab=history",
  "/settings/integrations",
] as const;

/* =========================
  Icons
========================= */
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="sx-ico">
      <path
        d="M12 12.2c2.55 0 4.6-2.06 4.6-4.6S14.55 3 12 3 7.4 5.06 7.4 7.6 9.45 12.2 12 12.2Zm0 2.2c-4.1 0-8 2.03-8 5.22 0 .86.72 1.58 1.6 1.58h12.8c.88 0 1.6-.72 1.6-1.58 0-3.19-3.9-5.22-8-5.22Z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="sx-ico">
      <path
        d="M16.8 11.6c1.75 0 3.2-1.45 3.2-3.2S18.55 5.2 16.8 5.2s-3.2 1.45-3.2 3.2 1.45 3.2 3.2 3.2ZM9.8 12.2c2.55 0 4.6-2.06 4.6-4.6S12.35 3 9.8 3 5.2 5.06 5.2 7.6 7.25 12.2 9.8 12.2Zm7 1.6c-1.32 0-2.6.28-3.7.78 1.52.98 2.5 2.35 2.5 3.96v.44h4.8c.88 0 1.6-.72 1.6-1.58 0-2.45-2.75-3.6-5.2-3.6ZM9.8 14.4c-4.1 0-8 2.03-8 5.22 0 .86.72 1.58 1.6 1.58h12.8c.88 0 1.6-.72 1.6-1.58 0-3.19-3.9-5.22-8-5.22Z"
        fill="currentColor"
        opacity="0.92"
      />
    </svg>
  );
}

function IconCollaborationTeam() {
  return <span aria-hidden="true" className="sx-ico sx-ico-team" />;
}

function IconShield() {
  return <span aria-hidden="true" className="sx-ico sx-ico-shield" />;
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="sx-ico">
      <path
        d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-6.2V11c0-3.4-2-6.2-5.4-7V3.4c0-.9-.7-1.6-1.6-1.6s-1.6.7-1.6 1.6V4c-3.4.8-5.4 3.6-5.4 7v4.8L3.6 17v1.4h16.8V17L19 15.8Z"
        fill="#ffffff"
        opacity="0.92"
      />
    </svg>
  );
}

function IconCard() {
  return <span aria-hidden="true" className="sx-ico sx-ico-card" />;
}

function IconPlug() {
  return <span aria-hidden="true" className="sx-ico sx-ico-plug" />;
}

function IconKey() {
  return <span aria-hidden="true" className="sx-ico sx-ico-api" />;
}

function IconHistory() {
  return <span aria-hidden="true" className="sx-ico sx-ico-history" />;
}

function HistoryPanel() {
  return (
    <section className="sx-panel" aria-label="History">
      <header className="sx-panelHead">
        <div>
          <h2 className="sx-h2">History</h2>
          <p className="sx-sub">System events + activity.</p>
        </div>
      </header>

      <div className="sx-body">
        <HistoryClient />
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<SettingsKey>("account");
  const [mountedTabs, setMountedTabs] = useState<SettingsKey[]>(["account"]);
  const tabFromUrl = safeKey(searchParams?.get("tab") || undefined);

  useEffect(() => {
    SETTINGS_PRELOAD_ROUTES.forEach((href) => {
      try {
        router.prefetch(href);
      } catch {}
    });
  }, [router]);

  useEffect(() => {
    const onPopState = () => {
      const next = safeKey(new URLSearchParams(window.location.search).get("tab") || undefined);
      setTab(next);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setTab(tabFromUrl);
  }, [tabFromUrl]);

  useEffect(() => {
    setMountedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
  }, [tab]);

  const nav = useMemo<
    Array<{
      key: SettingsKey;
      label: string;
      sub: string;
      icon: ReactNode;
    }>
  >(
    () => [
      { key: "account", label: "Account", sub: "Profile + presence", icon: <IconUser /> },
      { key: "team", label: "Team", sub: "Members + roles", icon: <IconUsers /> },
      { key: "collaboration", label: "Collaboration", sub: "Permissions + roles", icon: <IconCollaborationTeam /> },
      { key: "security", label: "Security", sub: "Auth + recovery", icon: <IconShield /> },
      { key: "notifications", label: "Notifications", sub: "Signals + routing", icon: <IconBell /> },
      { key: "billing", label: "Billing", sub: "Plan + invoices", icon: <IconCard /> },
      { key: "api", label: "API & Keys", sub: "Tokens + access", icon: <IconKey /> },
      { key: "integrations", label: "Integrations", sub: "Connections", icon: <IconPlug /> },
      { key: "history", label: "History", sub: "System events + activity", icon: <IconHistory /> },
    ],
    []
  );

  const active = useMemo(() => nav.find((n) => n.key === tab) || nav[0], [nav, tab]);
  const mountedTabSet = useMemo(() => new Set<SettingsKey>(mountedTabs), [mountedTabs]);

  const prefetchSettingsHref = useCallback(
    (href: string) => {
      try {
        router.prefetch(href);
      } catch {}
    },
    [router]
  );

  const onTabLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>, key: SettingsKey) => {
      if (key === "integrations") return;
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();

      if (tab === key) return;
      setTab(key);

      const nextHref = `/settings?tab=${encodeURIComponent(key)}`;
      try {
        window.history.pushState({}, "", nextHref);
      } catch {
        router.push(nextHref);
      }

      const dd = document.querySelector(".sx-dd") as HTMLDetailsElement | null;
      if (dd?.open) dd.open = false;
    },
    [router, tab]
  );

  return (
    <AppShell title="Settings" subtitle="Account preferences and workspace configuration">
      <div className="sx-page">
        <header className="sx-top">
          <div className="sx-topLeft">
            <h1 className="sx-h1">Settings</h1>
            <p className="sx-desc">
              Manage your account, team, security, notifications, and billing in one place.
            </p>
            <br />
            <br />
          </div>
        </header>

        <div className="sx-frame">
          <aside className="sx-side" aria-label="Settings navigation">
            <div className="sx-sideHead">
              <div className="sx-sideTitle">Configuration</div>
              <div className="sx-sideHint">Choose a panel.</div>
            </div>
            <br />
            <nav className="sx-sideNav">
              {nav.map((it) => {
                const href = buildSettingsHref(it.key, tab);
                return (
                  <Link
                    key={it.key}
                    href={href}
                    className={`sx-item ${tab === it.key ? "is-on" : ""}`}
                    aria-current={tab === it.key ? "page" : undefined}
                    onMouseEnter={() => prefetchSettingsHref(href)}
                    onFocus={() => prefetchSettingsHref(href)}
                    onClick={(event) => onTabLinkClick(event, it.key)}
                  >
                    <span className="sx-itemIcon" aria-hidden="true">
                      {it.icon}
                    </span>
                    <span className="sx-itemText">
                      <span className="sx-itemLabel">{it.label}</span>
                      <span className="sx-itemSub">{it.sub}</span>
                    </span>

                    <span className="sx-itemArrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="16" height="16">
                        <path
                          d="M9 6.5 14.5 12 9 17.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="0.86"
                        />
                      </svg>
                    </span>
                  </Link>
                );
              })}
            </nav>
            <div className="sx-sideStatus">
              <SettingsStatusCard />
            </div>
          </aside>

          <main className="sx-main" aria-label="Settings panel">
            <div className="sx-mainContent">
              <div className="sx-mobileNav" aria-label="Settings navigation (mobile)">
                <details className="sx-dd" open={false}>
                  <summary className="sx-ddSummary">
                    <span className="sx-itemIcon" aria-hidden="true">
                      {active.icon}
                    </span>

                    <span className="sx-itemText">
                      <span className="sx-itemLabel">{active.label}</span>
                      <span className="sx-itemSub">{active.sub}</span>
                    </span>

                    <span className="sx-ddCaret" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path
                          d="M7 10l5 5 5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          opacity="0.9"
                        />
                      </svg>
                    </span>
                  </summary>

                  <div className="sx-ddMenu" role="menu" aria-label="Settings panels">
                    {nav.map((it) => {
                      const href = buildSettingsHref(it.key, tab);
                      return (
                        <Link
                          key={it.key}
                          href={href}
                          className={`sx-item sx-itemMini ${tab === it.key ? "is-on" : ""}`}
                          aria-current={tab === it.key ? "page" : undefined}
                          onMouseEnter={() => prefetchSettingsHref(href)}
                          onFocus={() => prefetchSettingsHref(href)}
                          onClick={(event) => onTabLinkClick(event, it.key)}
                        >
                          <span className="sx-itemIcon" aria-hidden="true">
                            {it.icon}
                          </span>
                          <span className="sx-itemText">
                            <span className="sx-itemLabel">{it.label}</span>
                            <span className="sx-itemSub">{it.sub}</span>
                          </span>
                          <span className="sx-itemArrow" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="16" height="16">
                              <path
                                d="M9 6.5 14.5 12 9 17.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity="0.86"
                              />
                            </svg>
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </details>
              </div>

              {mountedTabSet.has("account") ? (
                <section hidden={tab !== "account"} aria-hidden={tab !== "account"}>
                  <AccountOverviewClient />
                </section>
              ) : null}
              {mountedTabSet.has("team") ? (
                <section hidden={tab !== "team"} aria-hidden={tab !== "team"}>
                  <TeamClient />
                </section>
              ) : null}
              {mountedTabSet.has("collaboration") ? (
                <section hidden={tab !== "collaboration"} aria-hidden={tab !== "collaboration"}>
                  <CollaborationClient />
                </section>
              ) : null}
              {mountedTabSet.has("security") ? (
                <section hidden={tab !== "security"} aria-hidden={tab !== "security"}>
                  <SecurityClient />
                </section>
              ) : null}
              {mountedTabSet.has("notifications") ? (
                <section hidden={tab !== "notifications"} aria-hidden={tab !== "notifications"}>
                  <NotificationsClient />
                </section>
              ) : null}
              {mountedTabSet.has("billing") ? (
                <section hidden={tab !== "billing"} aria-hidden={tab !== "billing"}>
                  <BillingClient />
                </section>
              ) : null}
              {mountedTabSet.has("api") ? (
                <section hidden={tab !== "api"} aria-hidden={tab !== "api"}>
                  <ApiKeysPanel />
                </section>
              ) : null}
              {mountedTabSet.has("history") ? (
                <section hidden={tab !== "history"} aria-hidden={tab !== "history"}>
                  <HistoryPanel />
                </section>
              ) : null}
              {mountedTabSet.has("integrations") ? (
                <section hidden={tab !== "integrations"} aria-hidden={tab !== "integrations"}>
                  <PlaceholderPanel title="Integrations" subtitle="Connect tooling, workflows, and monitored systems." />
                </section>
              ) : null}
            </div>
          </main>
        </div>
      </div>
    </AppShell>
  );
}
