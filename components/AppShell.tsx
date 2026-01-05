// components/AppShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

type NavItem = {
  href: string;
  label: string;
  hint: string;
};

export default function AppShell({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode; // <-- prevents the “children missing” TS error
}) {
  const pathname = usePathname();

  const nav: NavItem[] = useMemo(
    () => [
      { href: "/console", label: "Console", hint: "Overall health + events" },
      { href: "/errors", label: "Errors", hint: "JS + API stability" },
      { href: "/seo-structure", label: "SEO", hint: "Indexing posture + structure" },
      { href: "/routes-maps", label: "Routes", hint: "Discovery + crawl paths" },
      { href: "/a11y", label: "A11y", hint: "Audits + Contrast" },
      { href: "/insights", label: "Insights", hint: "Trends + diagnostics" },
      { href: "/404-control-room", label: "Control Room", hint: "Gameplay + scores + leaderboard" },
      { href: "/settings", label: "Settings", hint: "Install keys + project" },
    ],
    [],
  );

  useEffect(() => {
    try {
      window.cavbotAnalytics?.trackConsole?.("cavbot_console_shell_view", {
        path: pathname,
      });
    } catch {}
  }, [pathname]);

  return (
    <div className="cb-shell" data-cavbot-page-type="console">
      {/* SIDEBAR */}
      <aside className="cb-sidebar" aria-label="Primary navigation">
        <div className="cb-side-top">
          {/* Wordmark ONLY */}
          <div className="cb-wordmark" aria-label="CavBot">
            <img
              className="cb-wordmark-img"
              src="/logo/cavbot-wordmark.svg"
              alt="CavBot Wordmark Logo"
            />
          </div>
        </div>

        <nav className="cb-nav" aria-label="Primary">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                className="cb-nav-link"
                href={item.href}
                aria-current={active ? "page" : undefined}
              >
                <span className="cb-nav-meta">
                  <span className="cb-nav-label">{item.label}</span>
                  <span className="cb-nav-hint">{item.hint}</span>
                </span>
                <span className="cb-nav-caret" aria-hidden="true">
                  ›
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="cb-side-bottom" aria-label="Sidebar footer">
          <button className="cb-mini-btn" type="button" aria-label="Quick actions">
            ⟡
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="cb-main">
        <header className="cb-topbar">
          <div className="cb-brand-lockup">
            {/* Real CavBot badge snippet (styled by /public/badge/*.css) */}
            <div className="cb-badge" aria-hidden="true">
              <div className="cavbot-dm-avatar">
                <div className="cavbot-dm-avatar-core">
                  <div className="cavbot-dm-face">
                  <div className="cavbot-eyes-row">
  <div className="cavbot-eye">
    <div className="cavbot-eye-inner">
      <div className="cavbot-eye-track">
        <div className="cavbot-eye-pupil"></div>
      </div>
    </div>
    <div className="cavbot-eye-glow"></div>
    <div className="cavbot-blink"></div>
  </div>

  <div className="cavbot-eye">
    <div className="cavbot-eye-inner">
      <div className="cavbot-eye-track">
        <div className="cavbot-eye-pupil"></div>
      </div>
    </div>
    <div className="cavbot-eye-glow"></div>
    <div className="cavbot-blink"></div>
  </div>
</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Page title (ONLY once) */}
            <div className="cb-title">
              <div className="cb-title-top">{title || "CavCore Console"}</div>
              <div className="cb-title-sub">{subtitle || "Guardian posture · Routes · SEO · Events"}</div>
            </div>
          </div>

          {/* Topbar controls (not random) */}
          <div className="cb-controls" aria-label="Console controls">
            <div className="cb-pill cb-pill-live" title="Connection status">
              <span className="cb-dot" aria-hidden="true" />
              Live
            </div>

            <button className="cb-pill cb-pill-btn" type="button" title="Time range (wire later)">
              Last 24h <span aria-hidden="true">▾</span>
            </button>

            <button className="cb-pill cb-pill-btn" type="button" title="Environment (wire later)">
              Prod <span aria-hidden="true">▾</span>
            </button>

            {/* Account switcher (UI now, wire later) */}
            <button className="cb-account" type="button" title="Account (wire later)">
              <span className="cb-account-chip" aria-hidden="true">
                CP
              </span>
              <span className="cb-account-label">Account</span>
              <span className="cb-account-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </div>
        </header>

        <main id="main" className="cb-content">
          {children || null}
        </main>
      </div>
    </div>
  );
}