"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanId, formatPlanLabelForUi, getPlanLimits } from "@/lib/plans";
import type { ProjectScanStatus, ScanReport } from "@/lib/scanner";

type ScannerSite = {
  id: string;
  label: string;
  origin: string;
};

type ScannerControlCardProps = {
  projectId: number | null;
  activeSiteId: string;
  sites: ScannerSite[];
  planId: PlanId;
  pushToast: (msg: string, tone: "good" | "watch" | "bad") => void;
};

type ScanStatusResponse = {
  ok: true;
  status: ProjectScanStatus;
};

const SCAN_METRICS_READY_EVENT = "cb:scan-metrics-ready";

export default function ScannerControlCard({
  projectId,
  activeSiteId,
  sites,
  planId,
  pushToast,
}: ScannerControlCardProps) {
  const [scanStatus, setScanStatus] = useState<ProjectScanStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalReport, setModalReport] = useState<ScanReport | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const lastStatusErrorToastRef = useRef<string>("");
  const pushToastRef = useRef(pushToast);
  const lastMetricsReadyRef = useRef("");

  useEffect(() => {
    pushToastRef.current = pushToast;
  }, [pushToast]);

  const activeSite = useMemo(
    () => sites.find((site) => site.id === activeSiteId) || sites[0] || null,
    [sites, activeSiteId]
  );

  const fetchStatus = useCallback(async () => {
    if (!projectId) {
      setFetchError(null);
      setScanStatus(null);
      return;
    }
    setFetchError(null);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/workspaces/${projectId}/scan/status`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as { error?: string } | ScanStatusResponse;
        if (!res.ok || !("ok" in payload)) {
          throw new Error((payload as { error?: string }).error || "Failed to load scan status.");
        }
        lastStatusErrorToastRef.current = "";
        setScanStatus(payload.status);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 1) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
          continue;
        }
      }
    }
    const message = lastError instanceof Error ? lastError.message : "Unable to load scan status.";
    setFetchError(message);
    if (lastStatusErrorToastRef.current !== message) {
      lastStatusErrorToastRef.current = message;
      pushToastRef.current(message, "bad");
    }
  }, [projectId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (scanStatus?.lastJob?.status !== "RUNNING") return;
    const timer = window.setTimeout(fetchStatus, 3200);
    return () => window.clearTimeout(timer);
  }, [scanStatus, fetchStatus]);

  const liveUsage = scanStatus?.usage ?? null;
  const planLimits = useMemo(() => getPlanLimits(planId), [planId]);
  const displayUsage = liveUsage ?? {
    planId,
    planLabel: formatPlanLabelForUi(planId),
    scansThisMonth: 0,
    scansPerMonth: planLimits.scansPerMonth,
    pagesPerScan: planLimits.pagesPerScan,
  };
  const effectivePlanId = liveUsage?.planId ?? planId;
  const planLabel = formatPlanLabelForUi(effectivePlanId);
  const remaining = Math.max(0, displayUsage.scansPerMonth - displayUsage.scansThisMonth);
  const totalScans = displayUsage.scansPerMonth;
  const scansRemainingLabel = `${remaining}/${totalScans}`;
  const isRunning = scanStatus?.lastJob?.status === "RUNNING";
  const isSuccess = scanStatus?.lastJob?.status === "SUCCEEDED";
  const isFailed = scanStatus?.lastJob?.status === "FAILED";
  const latestJob = scanStatus?.lastJob ?? null;
  const report = latestJob?.report ?? null;
  const diagnosticsReady = Boolean(latestJob?.diagnosticsReady);
  const diagnosticsGeneratedAt = latestJob?.diagnosticsGeneratedAt ?? null;
  const diagnosticsGeneratedAtIso = diagnosticsGeneratedAt
    ? new Date(diagnosticsGeneratedAt as unknown as string | Date).toISOString()
    : null;

  const pagesAnalyzed = report?.metrics.pagesAnalyzed ?? latestJob?.pagesScanned ?? 0;
  const issuesFound = report?.metrics.issuesFound ?? latestJob?.issuesFound ?? 0;
  const highPriorityCount =
    report?.metrics.highPriorityCount ?? latestJob?.highPriorityCount ?? 0;

  const canRunScan =
    Boolean(projectId && activeSite && liveUsage) &&
    !isRunning &&
    !isSubmitting &&
    remaining > 0;

  const handleRunScan = useCallback(async () => {
    if (!canRunScan || !projectId || !activeSite) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${projectId}/scan`, {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: activeSite.id }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.message || payload?.error || "Scan request failed.");
      }
      pushToastRef.current("Scan queued. CavBot will analyze the selected pages.", "good");
      fetchStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start scan.";
      pushToastRef.current(message, "bad");
    } finally {
      setIsSubmitting(false);
    }
  }, [activeSite, canRunScan, fetchStatus, projectId]);

  useEffect(() => {
    if (!modalOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [modalOpen]);

  const openModal = () => {
    setModalReport(report);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalReport(null);
  };

  useEffect(() => {
    if (!latestJob || latestJob.status !== "SUCCEEDED" || !diagnosticsReady) return;
    const emissionKey = `${latestJob.id}:${diagnosticsGeneratedAtIso || ""}`;
    if (lastMetricsReadyRef.current === emissionKey) return;
    lastMetricsReadyRef.current = emissionKey;
    window.dispatchEvent(
      new CustomEvent(SCAN_METRICS_READY_EVENT, {
        detail: {
          projectId,
          jobId: latestJob.id,
          origin: latestJob.siteOrigin || activeSite?.origin || "",
          generatedAt: diagnosticsGeneratedAtIso,
        },
      })
    );
  }, [activeSite?.origin, diagnosticsGeneratedAtIso, diagnosticsReady, latestJob, projectId]);

  return (
    <section className="cb-card cb-card-scanner" aria-label="CavScan">
      <div className="cb-card-head">
        <div className="cb-card-head-row">
          <div className="cb-scan-head-copy">
            <h2 className="cb-h2">CavScan</h2>
            <p className="cb-sub cb-scan-head-sub">
              Run controlled inspections and turn issues into priorities.
            </p>
            <br />
            {activeSite ? (
              <>
                <p className="cb-scan-active-site">
                  Active origin: <strong>{activeSite.origin}</strong>
                </p>
                <br />
                <br />
              </>
            ) : (
              <>
                <p className="cb-scan-active-site cb-scan-active-site-empty">
                  Add a website to begin.
                </p>
                <br />
                <br />
              </>
            )}
          </div>
          <div className="cb-scan-head-cta">
            <button
              type="button"
              className="cb-run-scan-btn cb-linkpill"
              disabled={!canRunScan}
              onClick={handleRunScan}
            >
              {isRunning ? "Scan in progress" : "Run scan"}
            </button>
          </div>
        </div>
        <div className="cb-scan-plan-note">
          Plan: <strong>{planLabel}</strong> · Pages per scan: {displayUsage.pagesPerScan}
        </div>
      </div>

      <div className="cb-divider cb-divider-full" />

      <div className="cb-scan-card-body">
        <div className="cb-scan-usage">
          Scans remaining: <strong>{scansRemainingLabel}</strong>
        </div>
        <br />
        <br />

        {fetchError ? (
          <div className="cb-scan-error" role="alert">
            {fetchError}
          </div>
        ) : null}

        {isRunning ? (
          <div className="cb-scan-status">Scan in progress — CavBot is analyzing your selected pages.</div>
        ) : latestJob ? (
          <>
            <div className="cb-scan-metrics">
              <div className="cb-scan-metric">
                <span className="cb-scan-metric-label">Pages analyzed</span>
                <strong>{pagesAnalyzed}</strong>
              </div>
              <div className="cb-scan-metric">
                <span className="cb-scan-metric-label">Issues found</span>
                <strong>{issuesFound}</strong>
              </div>
              <div className="cb-scan-metric">
                <span className="cb-scan-metric-label">High priority</span>
                <strong>{highPriorityCount}</strong>
              </div>
            </div>
            <div className="cb-scan-results-actions">
              <button
                type="button"
                className="cb-linkpill cb-linkpill-ghost"
                onClick={openModal}
                disabled={!report}
              >
                {report ? "View results" : "Report pending…"}
              </button>
              {isFailed ? (
                <span className="cb-scan-status cb-scan-status-warning">
                  {latestJob?.diagnosticsFailureReason || latestJob?.reason || "Last scan failed. Check logs and try again."}
                </span>
              ) : null}
              {isSuccess ? (
                <span className="cb-scan-status cb-scan-status-success">
                  {diagnosticsReady
                    ? "Latest scan completed and refreshed CavAi metrics."
                    : "Crawl completed. CavAi metrics are still warming."}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="cb-scan-subcopy">
            No completed scans yet. CavBot queues the first scan when you add a website, and you can run CavScan any time to refresh live metrics.
            <br />
            <br />
          </p>
        )}
      </div>

      {modalOpen && modalReport ? (
        <div className="cb-scan-modal" role="dialog" aria-modal="true" aria-label="Scan results">
          <div className="cb-scan-modal-overlay" onClick={closeModal} aria-hidden="true" />
          <div className="cb-scan-modal-panel" onClick={(evt) => evt.stopPropagation()}>
            <header className="cb-scan-modal-header">
              <div>
                <p className="cb-scan-modal-caption">CavAi intelligence</p>
                <h3 className="cb-scan-modal-title">Scan results</h3>
                <p className="cb-scan-modal-sub">Why the prioritized issues matter, and what to do next.</p>
              </div>
              <button type="button" className="cb-scan-modal-close" onClick={closeModal} aria-label="Close results">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </header>

            <div className="cb-scan-modal-section">
              <h4 className="cb-scan-modal-section-title">Scan Summary</h4>
              <p className="cb-scan-modal-section-copy">{modalReport.summary}</p>
            </div>

            <div className="cb-scan-modal-section">
              <h4 className="cb-scan-modal-section-title">Confidence Statement</h4>
              <p className="cb-scan-modal-section-copy">{modalReport.confidence}</p>
            </div>

            <div className="cb-scan-modal-section">
              <h4 className="cb-scan-modal-section-title">Top Priorities</h4>
              <ol className="cb-scan-modal-list">
                {modalReport.priorities.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="cb-scan-modal-section">
              <h4 className="cb-scan-modal-section-title">Why These Pages Mattered</h4>
              <ul className="cb-scan-modal-list">
                {modalReport.pages.map((page) => (
                  <li key={page.url}>
                    <strong>{page.reason}</strong>
                    <p>
                      <span className="cb-scan-modal-page">{page.url}</span>
                      {page.status ? ` · HTTP ${page.status}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="cb-scan-modal-section">
              <h4 className="cb-scan-modal-section-title">What To Do Next</h4>
              <ol className="cb-scan-modal-list">
                {modalReport.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
