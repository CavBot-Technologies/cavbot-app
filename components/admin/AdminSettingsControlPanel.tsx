"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  platformHref: string;
  securityHref: string;
  auditHref: string;
  alertsHref: string;
};

type RollupResponse = {
  ok?: boolean;
  error?: string;
};

export function AdminSettingsControlPanel(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function syncRollups() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/rollups", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });
      const payload = (await response.json().catch(() => ({}))) as RollupResponse;
      if (!response.ok || !payload.ok) {
        setMessage("Rollup sync failed.");
        return;
      }
      setMessage("Rollups synced.");
      router.refresh();
    } catch {
      setMessage("Rollup sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hq-settingsActionShell">
      <div className="hq-settingsActionGrid">
        <button type="button" className="hq-button" disabled={busy} onClick={() => void syncRollups()}>
          {busy ? "Syncing..." : "Sync rollups"}
        </button>
        <Link href={props.platformHref} className="hq-buttonGhost">
          Platform
        </Link>
        <Link href={props.securityHref} className="hq-buttonGhost">
          Security
        </Link>
        <Link href={props.auditHref} className="hq-buttonGhost">
          Audit
        </Link>
        <Link href={props.alertsHref} className="hq-buttonGhost">
          Alerts
        </Link>
      </div>
      <p className="hq-helperText">
        Command-only controls. Host and environment mutation stays outside HQ; live recovery and audit tooling routes from here.
      </p>
      {message ? <p className="hq-helperText">{message}</p> : null}
    </div>
  );
}
