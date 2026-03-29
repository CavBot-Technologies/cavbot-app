"use client";

import Link from "next/link";
import { Fragment } from "react";
import LocalTimestamp from "@/components/status/LocalTimestamp";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import { STATUS_UI_MAP } from "@/lib/status/ui";

export default function SettingsStatusCard() {
  const { services, checkedAt, isLoading, isRefreshing, error } = useSystemStatus({
    pollMs: 15_000,
  });
  const unknownReason =
    services.find((service) => service.status === "unknown" && service.reason)?.reason || null;
  const errorReason = error instanceof Error ? error.message : null;
  const checkedLabel = checkedAt ? (
    <>
      Last checked <LocalTimestamp value={checkedAt} fallback="Checking..." />
    </>
  ) : (
    "Checking system health…"
  );
  const refreshLabel = isRefreshing ? "Refreshing health checks…" : checkedLabel;

  return (
    <div className="sx-status-card" aria-label="System Status">
      <div className="sx-status-cardHead">
        <div>
          <div className="sx-footK">System Status</div>
          <p className="sx-status-sub">Live health of CavBot services.</p>
        </div>
      </div>
      <br />
      <br />
      <div className="sx-status-list">
        {services.map((service) => {
          const meta = STATUS_UI_MAP[service.state] || STATUS_UI_MAP.UNKNOWN;
          return (
            <Fragment key={service.key}>
              <div className="sx-status-row">
                <span className="sx-status-name">{service.label}</span>
                <span className="sx-status-value">
                  <span className={`sx-status-dot ${meta.dotClass}`} aria-hidden="true" />
                  <span className="sx-status-label">{service.statusLabel}</span>
                </span>
              </div>
              <br aria-hidden="true" />
            </Fragment>
          );
        })}
      </div>
      <div className="sx-status-meta" aria-live="polite">
        <span>{isLoading ? "Checking system health…" : refreshLabel}</span>
        {errorReason ? <span>{errorReason}</span> : unknownReason ? <span>{unknownReason}</span> : null}
      </div>
      <br />
      <Link className="sx-status-cta" href="/status" target="_blank" rel="noreferrer">
        View system status
      </Link>
    </div>
  );
}
