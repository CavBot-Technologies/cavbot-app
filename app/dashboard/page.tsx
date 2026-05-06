import "../console/console.css";

import Link from "next/link";
import AppShell from "@/components/AppShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dashboardModules = [
  {
    href: "/errors",
    title: "Error Intelligence",
    copy: "JS failures, API stability, broken routes, and recovery signals.",
    metric: "Stability",
  },
  {
    href: "/seo",
    title: "SEO Performance",
    copy: "Indexing posture, metadata coverage, page structure, and live SEO signals.",
    metric: "Search",
  },
  {
    href: "/routes",
    title: "Routing",
    copy: "Discovery paths, crawl routes, and monitored URL coverage.",
    metric: "Paths",
  },
  {
    href: "/a11y",
    title: "A11y Snapshot",
    copy: "Contrast, keyboard posture, audits, and accessibility diagnostics.",
    metric: "Access",
  },
  {
    href: "/insights",
    title: "CavBot Insights",
    copy: "Priorities, persisted scan findings, and trend diagnostics.",
    metric: "Insights",
  },
  {
    href: "/cavbot-arcade",
    title: "Control Room",
    copy: "Gameplay, leaderboard posture, and engagement loops.",
    metric: "Arcade",
  },
];

export default function DashboardPage() {
  return (
    <AppShell title="CavBot Dashboard">
      <div className="cb-console">
        <section className="cb-pagehead-row" aria-label="Dashboard page heading">
          <div className="cb-pagehead">
            <h1 className="cb-pagehead-title">
              <span className="cb-pagehead-name">CavBot</span>
              <span className="cb-pagehead-dashboard">Dashboard</span>
            </h1>
            <p className="cb-pagehead-sub">
              Operational health, analytics modules, and workspace control.
            </p>
          </div>
        </section>

        <section className="cb-card" aria-label="Dashboard status">
          <div className="cb-card-head">
            <h2 className="cb-h2">Workspace Overview</h2>
            <p className="cb-sub">
              Dashboard rendering is isolated from long-running analytics work. Open a module to inspect live data.
            </p>
          </div>
          <div className="cb-kv">
            <div className="cb-kv-row">
              <span className="cb-k">Status</span>
              <span className="cb-v">Ready</span>
            </div>
            <div className="cb-kv-row">
              <span className="cb-k">Route</span>
              <span className="cb-v">/dashboard</span>
            </div>
          </div>
        </section>

        <section className="cb-grid cb-grid-2" aria-label="Dashboard modules">
          {dashboardModules.map((item) => (
            <Link key={item.href} href={item.href} className="cb-card cb-card-link">
              <div className="cb-card-head">
                <span className="cb-pill">{item.metric}</span>
                <h2 className="cb-h2">{item.title}</h2>
                <p className="cb-sub">{item.copy}</p>
              </div>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
