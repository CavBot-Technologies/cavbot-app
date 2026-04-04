import Image from "next/image";
import Link from "next/link";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import StatusShell from "@/components/status/StatusShell";
import { getStatusHistoryMonth } from "@/lib/status/service";
import {
  getSystemStatusHistoryMonthMetrics,
  getSystemStatusSnapshot,
  getSystemStatusTimeline,
} from "@/lib/system-status/pipeline";
import StatusHistoryClient from "./StatusHistoryClient";
import "./history.css";
import "../status.css";

export const metadata = {
  title: {
    absolute: "CavBot Status",
  },
  description: "Browse CavBot incident history built from the live status timeline.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: {
    month?: string;
  };
};

export default async function StatusHistoryPage({ searchParams }: PageProps) {
  const monthParam = searchParams?.month;
  const initialTimeZone = "UTC";

  const [monthWindow, liveStatusSnapshot, timelinePayload] = await Promise.all([
    getSystemStatusHistoryMonthMetrics(monthParam, initialTimeZone),
    getSystemStatusSnapshot({ allowStale: true }),
    getSystemStatusTimeline(30),
  ]);

  const history = await getStatusHistoryMonth(monthWindow.monthKey, initialTimeZone);

  const hasIncident = liveStatusSnapshot.summary.downCount > 0;
  const badgeToneClass = hasIncident ? "cavbot-auth-eye-error" : "";

  const uptimePercentValue = timelinePayload.global?.uptimePct ?? 0;
  const uptimePercentLabel = `${Math.min(100, Math.max(0, uptimePercentValue)).toFixed(1)}%`;

  return (
    <StatusShell variant="history">
      <header className="status-history-header">
        <div className="status-history-brand">
          <Link href="/" aria-label="CavBot home">
            <Image
              src="/logo/official-logotype-light.svg"
              alt="CavBot Logo"
              width={180}
              height={50}
              priority
              unoptimized
            />
          </Link>
        </div>
        <div className="status-history-badge" aria-hidden="true">
          <div className={`cb-badge cb-badge-inline ${badgeToneClass}`} aria-hidden="true">
            <div className="cavbot-badge-frame">
              <CdnBadgeEyes />
            </div>
          </div>
        </div>
      </header>

      <StatusHistoryClient
        initialPayload={{
          monthKey: monthWindow.monthKey,
          prevMonthKey: monthWindow.prevMonthKey,
          nextMonthKey: monthWindow.nextMonthKey,
          summary: history.summary,
          incidents: history.incidents,
          metrics: monthWindow.metrics,
        }}
        initialTimeZone={initialTimeZone}
        lockInitialMonth={typeof monthParam === "string" && monthParam.length > 0}
      />

      <footer className="status-footer">
        <div className="status-footerActions">
          <p className="status-footerUptime">
            Uptime for the current quarter: <strong>{uptimePercentLabel}</strong>
          </p>
          <Link className="status-footerBtn" href="/status">
            View Systems Status
          </Link>
        </div>
      </footer>
    </StatusShell>
  );
}
