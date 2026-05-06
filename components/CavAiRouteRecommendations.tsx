"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  getCavAiIntelligenceClient,
  type CavAiFixResult,
} from "@/lib/cavai/intelligence.client";
import type { CavAiFixPlanV1, CavAiInsightPackV1, CavAiPriorityV1 } from "@/packages/cavai-contracts/src";

type CavAiRouteRecommendationsProps = {
  panelId: string;
  snapshot: unknown;
  origin: string;
  pagesScanned?: number;
  title?: string;
  subtitle?: string;
  pillars?: Array<"seo" | "performance" | "accessibility" | "ux" | "engagement" | "reliability">;
  prioritySummary?: {
    tone: "good" | "watch" | "bad";
    meta: string;
    headline: string;
    body: string;
    steps: string[];
    hideCta?: boolean;
  };
};

type PackHistoryEntry = {
  runId: string;
  createdAtISO: string;
  generatedAtISO: string | null;
  pagesScanned: number;
  pageLimit: number;
  engineVersion: string;
  packVersion: string;
  findingCount: number;
  priorityCount: number;
  topPriorityCode: string | null;
  topPriorityScore: number | null;
  overlayDiffSummary: string | null;
};

type PackResponseOk = {
  ok: true;
  requestId: string;
  origin: string;
  pack: CavAiInsightPackV1 | null;
  history: PackHistoryEntry[];
};

type PackResponseErr = {
  ok: false;
  requestId?: string;
  error?: string;
  message?: string;
};

type FixPlanState = {
  loading: boolean;
  plan: CavAiFixPlanV1 | null;
  error: string | null;
};

const PACK_CACHE_TTL_MS = 5_000;
const packCache = new Map<string, { at: number; value: PackResponseOk }>();
const SCAN_METRICS_READY_EVENT = "cb:scan-metrics-ready";

function normalizeOrigin(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  // Keep SSR/CSR deterministic: placeholder labels (e.g. "All monitored targets")
  // must never be treated as URLs in one runtime and invalid in another.
  if (/\s/.test(raw)) return "";
  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProto);
    if (!parsed.hostname || /\s/.test(parsed.hostname) || parsed.hostname.includes("%")) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function fmtDateTime(iso: string | null | undefined): string {
  const value = String(iso || "").trim();
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtScore(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function priorityRecencyMs(priority: CavAiPriorityV1): number {
  const record = priority as unknown as Record<string, unknown>;
  for (const key of ["lastSeenAtISO", "lastSeenAt", "updatedAtISO", "updatedAt", "generatedAtISO", "generatedAt", "createdAtISO", "createdAt", "firstSeenAtISO", "firstSeenAt"]) {
    const raw = String(record[key] || "").trim();
    if (!raw) continue;
    const ts = Date.parse(raw);
    if (Number.isFinite(ts)) return ts;
  }
  return 0;
}

function rankPriorities(rows: CavAiPriorityV1[]): CavAiPriorityV1[] {
  return rows.slice().sort((a, b) => {
    const aRecent = priorityRecencyMs(a);
    const bRecent = priorityRecencyMs(b);
    if (bRecent !== aRecent) return bRecent - aRecent;
    const aScore = Number(a?.priorityScore);
    const bScore = Number(b?.priorityScore);
    if (Number.isFinite(aScore) && Number.isFinite(bScore) && bScore !== aScore) return bScore - aScore;
    const aCode = String(a?.code || "");
    const bCode = String(b?.code || "");
    if (aCode < bCode) return -1;
    if (aCode > bCode) return 1;
    return 0;
  });
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed.";
}

function readPackErrorMessage(json: PackResponseErr | null, fallback: string): string {
  if (json?.message && String(json.message).trim()) return String(json.message).trim();
  if (json?.error && String(json.error).trim()) return String(json.error).trim();
  return fallback;
}

export default function CavAiRouteRecommendations(props: CavAiRouteRecommendationsProps) {
  const isCommandCenter = props.panelId === "command-center";
  const isConsolePanel = props.panelId === "console";
  const normalizedOrigin = useMemo(() => normalizeOrigin(props.origin), [props.origin]);
  const pillarFilter = useMemo(() => {
    if (!Array.isArray(props.pillars) || !props.pillars.length) return null;
    return new Set(props.pillars.map((item) => String(item)));
  }, [props.pillars]);
  const [status, setStatus] = useState("Preparing deterministic recommendations...");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<CavAiInsightPackV1 | null>(null);
  const [history, setHistory] = useState<PackHistoryEntry[]>([]);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [busyActionCode, setBusyActionCode] = useState<string>("");
  const [fixPlans, setFixPlans] = useState<Record<string, FixPlanState>>({});

  const visiblePriorities = useMemo(() => {
    if (!pack || !Array.isArray(pack.priorities)) return [] as CavAiPriorityV1[];
    const rows = rankPriorities(pack.priorities);
    const limit = isCommandCenter ? 3 : 4;
    if (!pillarFilter) return rows.slice(0, limit);
    return rows.filter((row) => pillarFilter.has(String(row.pillar || ""))).slice(0, limit);
  }, [isCommandCenter, pack, pillarFilter]);

  const topHistory = useMemo(() => history.slice(0, 4), [history]);
  const showEmptyState = !loading && !visiblePriorities.length;
  const rootClassName = isCommandCenter ? "cb-card cb-card-cavpri" : "cb-card cb-card-pad";
  const bodyStyle = isCommandCenter ? undefined : isConsolePanel ? { marginTop: 32 } : { marginTop: 24 };
  const emptyMessage = useMemo(() => {
    if (!normalizedOrigin) {
      return "Select a primary site to begin.";
    }
    return "CavBot is waiting for the first completed scan for this origin. Initial scans queue automatically when a site is added.";
  }, [normalizedOrigin]);

  const loadPack = useCallback(async () => {
    if (!normalizedOrigin) {
      setPack(null);
      setHistory([]);
      setLoadError(null);
      setStatus("Waiting for a primary monitored origin.");
      return;
    }

    setLoading(true);
    setLoadError(null);
    setStatus("Loading deterministic priorities...");

    try {
      const cacheKey = normalizedOrigin;
      const cached = packCache.get(cacheKey);
      if (cached && Date.now() - cached.at <= PACK_CACHE_TTL_MS) {
        setPack(cached.value.pack);
        setHistory(Array.isArray(cached.value.history) ? cached.value.history : []);
        setStatus(
          cached.value.pack
            ? `Latest deterministic run: ${fmtDateTime(cached.value.pack.generatedAt)}`
            : "No persisted InsightPack for this origin yet."
        );
        setLoading(false);
        return;
      }

      const url = `/api/cavai/packs?origin=${encodeURIComponent(normalizedOrigin)}&limit=6`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as PackResponseOk | PackResponseErr | null;
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(readPackErrorMessage(json as PackResponseErr | null, "Failed to load deterministic pack."));
      }

      packCache.set(cacheKey, {
        at: Date.now(),
        value: json,
      });

      setPack(json.pack);
      setHistory(Array.isArray(json.history) ? json.history : []);
      setStatus(
        json.pack
          ? `Latest deterministic run: ${fmtDateTime(json.pack.generatedAt)}`
          : "No persisted InsightPack for this origin yet."
      );
    } catch (error) {
      setLoadError(summarizeError(error));
      setStatus("Deterministic priorities failed to load.");
    } finally {
      setLoading(false);
    }
  }, [normalizedOrigin]);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  useEffect(() => {
    if (!normalizedOrigin) return;
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ origin?: string }>).detail;
      const eventOrigin = normalizeOrigin(detail?.origin || "");
      if (eventOrigin && eventOrigin !== normalizedOrigin) return;
      packCache.delete(normalizedOrigin);
      void loadPack();
    };
    window.addEventListener(SCAN_METRICS_READY_EVENT, handle as EventListener);
    return () => window.removeEventListener(SCAN_METRICS_READY_EVENT, handle as EventListener);
  }, [loadPack, normalizedOrigin]);

  const getPriorityByCode = useCallback(
    (priorityCode: string): CavAiPriorityV1 | null => {
      if (!pack || !Array.isArray(pack.priorities)) return null;
      const normalized = String(priorityCode || "").trim().toLowerCase();
      if (!normalized) return null;
      return pack.priorities.find((item) => String(item?.code || "").trim().toLowerCase() === normalized) || null;
    },
    [pack]
  );

  const onCreateNote = useCallback(
    async (priorityCode: string) => {
      if (!pack) return;
      const code = String(priorityCode || "").trim().toLowerCase();
      if (!code) return;
      setBusyActionCode(code);
      try {
        const intel = getCavAiIntelligenceClient();
        const note = intel.priorityToCavPadNote(pack, code);
        if (!note) {
          setActionStatus("No deterministic CavPad template is available for this priority.");
          return;
        }
        window.dispatchEvent(
          new CustomEvent("cb:cavpad:create-note-from-priority", {
            detail: {
              requestId: `priority_${pack.runId}_${code}_${Date.now().toString(36)}`,
              title: note.title,
              evidenceLinks: note.evidenceLinks,
              checklist: note.checklist,
              verification: note.verification,
              confidenceSummary: note.confidenceSummary,
              riskSummary: note.riskSummary,
            },
          })
        );
        setActionStatus("Priority note sent to CavPad.");
      } catch (error) {
        setActionStatus(summarizeError(error));
      } finally {
        setBusyActionCode("");
      }
    },
    [pack]
  );

  const onOpenTarget = useCallback(
    async (priorityCode: string) => {
      if (!pack) return;
      const code = String(priorityCode || "").trim().toLowerCase();
      if (!code) return;
      setBusyActionCode(code);
      try {
        const intel = getCavAiIntelligenceClient();
        const priority = getPriorityByCode(code);
        if (!priority) {
          setActionStatus("Priority no longer exists in this run.");
          return;
        }
        const targets = intel.openTargetsForPriority(priority);
        if (!targets.length) {
          setActionStatus("No file target is available for this priority yet.");
          return;
        }
        const resolved = await intel.resolveOpenTarget({
          targets,
          context: {
            generatedAt: pack.generatedAt,
            origin: pack.origin,
          },
        });
        if (!resolved.ok) {
          if (resolved.reason === "ambiguous") {
            setActionStatus("Multiple target matches found. Open Insights to choose a specific file.");
            return;
          }
          setActionStatus(resolved.message || "No matching target found.");
          return;
        }
        if (resolved.resolution === "url") {
          window.open(resolved.url, "_blank", "noopener,noreferrer");
          setActionStatus("Opened URL target.");
          return;
        }
        const href = intel.buildCavCodeHref(resolved.filePath, window.location.search || "");
        window.location.href = href;
      } catch (error) {
        setActionStatus(summarizeError(error));
      } finally {
        setBusyActionCode("");
      }
    },
    [getPriorityByCode, pack]
  );

  const onLoadFixPlan = useCallback(
    async (priorityCode: string) => {
      if (!pack) return;
      const code = String(priorityCode || "").trim().toLowerCase();
      if (!code) return;

      setFixPlans((prev) => ({
        ...prev,
        [code]: { loading: true, plan: null, error: null },
      }));

      try {
        const intel = getCavAiIntelligenceClient();
        const response = (await intel.fixPlan({
          runId: pack.runId,
          priorityCode: code,
        })) as CavAiFixResult;

        if (!response.ok) {
          const message = response.message || response.error || "Failed to load fix plan.";
          setFixPlans((prev) => ({
            ...prev,
            [code]: { loading: false, plan: null, error: message },
          }));
          return;
        }

        setFixPlans((prev) => ({
          ...prev,
          [code]: { loading: false, plan: response.fixPlan, error: null },
        }));
      } catch (error) {
        setFixPlans((prev) => ({
          ...prev,
          [code]: { loading: false, plan: null, error: summarizeError(error) },
        }));
      }
    },
    [pack]
  );

  return (
    <section className={rootClassName} aria-label="CavBot recommendations" data-cavai-route-recs-root={props.panelId}>
      <div className="cb-card-head">
        <div>
          <h2 className="cb-h2">{props.title || "CavBot Recommendations"}</h2>
          <p className="cb-sub">{props.subtitle || "Evidence-linked, deterministic priorities for this surface."}</p>
        </div>
      </div>

      {!isConsolePanel ? (
        <div
          className="cb-divider cb-divider-full"
          style={{
            marginTop: 16,
            marginBottom: 24,
            marginLeft: "calc(0px - var(--pad-lg, 18px))",
            marginRight: "calc(0px - var(--pad-lg, 18px))",
            width: "calc(100% + (var(--pad-lg, 18px) * 2))",
            maxWidth: "none",
          }}
        />
      ) : null}

      <div className={isCommandCenter ? "cb-cavpri-body" : undefined} style={bodyStyle}>
        {!showEmptyState || loading || loadError ? (
          <div className={`cb-sub${isCommandCenter ? " cb-cavpri-status" : ""}`} style={isCommandCenter ? undefined : { marginTop: 12 }}>
            {loadError ? loadError : status}
          </div>
        ) : null}

        {pack?.overlay ? (
          <div className={isCommandCenter ? "cb-cavpri-overlay" : undefined} style={isCommandCenter ? undefined : { marginTop: 10 }}>
            <div className="cb-sub">
              What changed: {pack.overlay.diff?.summary || "Not enough run history to compute change deltas."}
            </div>
            <div className="cb-sub">
              Trend: {String(pack.overlay.trend?.state || "stagnating")} — {pack.overlay.trend?.reason || "No trend reason available."}
            </div>
            <div className="cb-sub">
              Fatigue: {String(pack.overlay.fatigue?.level || "none")} — {pack.overlay.fatigue?.message || "No fatigue message available."}
            </div>
          </div>
        ) : null}

        {visiblePriorities.length ? (
          <ul
            className={isCommandCenter ? `cb-cavpri-list${visiblePriorities.length > 2 ? " is-scroll" : ""}` : undefined}
            style={
              isCommandCenter
                ? undefined
                : {
                    marginTop: 12,
                    marginBottom: 0,
                    paddingLeft: 0,
                    listStyle: "none",
                    display: "grid",
                    gap: 10,
                  }
            }
          >
            {visiblePriorities.map((priority) => {
              const priorityCode = String(priority.code || "").trim().toLowerCase();
              const planState = fixPlans[priorityCode] || { loading: false, plan: null, error: null };
              const evidence = Array.isArray(priority.evidenceFindingIds) ? priority.evidenceFindingIds.slice(0, 6) : [];
              const isBusy = busyActionCode === priorityCode;

              return (
                <li
                  key={priorityCode}
                  className={isCommandCenter ? "cb-cavpri-item" : undefined}
                  style={
                    isCommandCenter
                      ? undefined
                      : {
                          border: "1px solid rgba(255,255,255,0.10)",
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "rgba(255,255,255,0.02)",
                        }
                  }
                >
                  <div className="cb-sub">
                    <strong>{priority.title || priority.code}</strong>
                  </div>
                  <div className="cb-sub">{priority.summary || "No summary available."}</div>
                  <div className="cb-sub">
                    Priority score: {fmtScore(priority.priorityScore)} · Pages: {fmtScore(priority.affectedPages)} / {fmtScore(priority.totalPagesScanned)}
                  </div>
                  <div className="cb-sub">Evidence IDs: {evidence.length ? evidence.join(", ") : "No evidence IDs."}</div>
                  {priority.nextActions?.[0]?.title ? (
                    <div className="cb-sub">Next action: {priority.nextActions[0].title}</div>
                  ) : null}

                  {isCommandCenter ? (
                    <div className="cb-cavpri-actions">
                      <Link
                        className="cb-linkpill"
                        href={`/insights?site=${encodeURIComponent(props.origin || "")}`}
                        aria-label="Open Insights"
                        title="Open Insights"
                      >
                        <Image
                          src="/icons/app/insights-svgrepo-com.svg"
                          alt=""
                          aria-hidden="true"
                          width={14}
                          height={14}
                          style={{ display: "block", filter: "brightness(0) saturate(100%) invert(100%)" }}
                        />
                        <span className="cb-sr-only">Open Insights</span>
                      </Link>
                      <button className="cb-linkpill" type="button" disabled={isBusy} onClick={() => void onCreateNote(priorityCode)}>
                        Create note
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="cb-linkpill" type="button" disabled={isBusy} onClick={() => void onCreateNote(priorityCode)}>
                        Create note
                      </button>
                      <button className="cb-linkpill" type="button" disabled={isBusy} onClick={() => void onOpenTarget(priorityCode)}>
                        Open in CavCode
                      </button>
                      <button
                        className="cb-linkpill"
                        type="button"
                        disabled={isBusy || planState.loading}
                        onClick={() => void onLoadFixPlan(priorityCode)}
                      >
                        {planState.loading ? "Loading fix plan..." : "Load fix plan"}
                      </button>
                    </div>
                  )}

                  {planState.error ? (
                    <div className={`cb-sub${isCommandCenter ? " cb-cavpri-inline-status" : ""}`} style={isCommandCenter ? undefined : { marginTop: 6 }}>
                      {planState.error}
                    </div>
                  ) : null}
                  {planState.plan && !isCommandCenter ? (
                    <div className="cb-sub" style={{ marginTop: 6 }}>
                      <strong>{planState.plan.title}</strong>
                      <div style={{ marginTop: 4 }}>
                        {planState.plan.steps.slice(0, 3).map((step, index) => (
                          <div key={`${priorityCode}-step-${index}`}>{`${index + 1}. ${step}`}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div
            className={isCommandCenter ? "cb-cavpri-empty" : undefined}
            style={
              isCommandCenter
                ? undefined
                : {
                    marginTop: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "rgba(0,0,0,0.10)",
                  }
            }
          >
            <div className="cb-sub">{loading ? "Preparing deterministic priorities..." : emptyMessage}</div>
            {!loading ? (
              <>
                <br />
                <br />
                <div className={isCommandCenter ? "cb-cavpri-actions" : undefined} style={{ marginTop: 0 }}>
                  <Link
                    className="cb-linkpill"
                    href={normalizedOrigin ? `/insights?site=${encodeURIComponent(normalizedOrigin)}` : "/insights"}
                    aria-label="Open Insights"
                    title="Open Insights"
                  >
                    <Image
                      src="/icons/app/insights-svgrepo-com.svg"
                      alt=""
                      aria-hidden="true"
                      width={14}
                      height={14}
                      style={{ display: "block", filter: "brightness(0) saturate(100%) invert(100%)" }}
                    />
                    <span className="cb-sr-only">Open Insights</span>
                  </Link>
                </div>
              </>
            ) : null}
          </div>
        )}

        {actionStatus ? (
          <div className={`cb-sub${isCommandCenter ? " cb-cavpri-status" : ""}`} style={isCommandCenter ? undefined : { marginTop: 10 }}>
            {actionStatus}
          </div>
        ) : null}

        {topHistory.length ? (
          <div className={isCommandCenter ? "cb-cavpri-history" : undefined} style={isCommandCenter ? undefined : { marginTop: 12 }}>
            <div className="cb-sub">Recent runs</div>
            <ul
              className={isCommandCenter ? "cb-cavpri-history-list" : undefined}
              style={isCommandCenter ? undefined : { marginTop: 6, marginBottom: 0, paddingLeft: 0, listStyle: "none" }}
            >
              {topHistory.map((run) => (
                <li key={run.runId} className={`cb-sub${isCommandCenter ? " cb-cavpri-history-item" : ""}`} style={isCommandCenter ? undefined : { marginTop: 4 }}>
                  {fmtDateTime(run.generatedAtISO || run.createdAtISO)} · Findings {fmtScore(run.findingCount)} · Top{" "}
                  {run.topPriorityCode || "—"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {props.prioritySummary ? (
          <div
            className="cb-feedback cb-feedback-inline"
            role="region"
            aria-label="Top priority"
            data-tone={props.prioritySummary.tone}
          >
            <div className="cb-feedback-top">
              <span className="cb-feedback-chip">Top Priority</span>
              <span className="cb-feedback-meta">{props.prioritySummary.meta}</span>
            </div>
            {isConsolePanel ? <br /> : null}

            <div className="cb-feedback-h">{props.prioritySummary.headline}</div>
            <p className="cb-feedback-p">{props.prioritySummary.body}</p>
            {isConsolePanel ? (
              <>
                <br />
                <br />
              </>
            ) : null}

            <ul className="cb-feedback-list" aria-label="Recommended actions">
              {props.prioritySummary.steps.map((step, index) => (
                <li key={`${step}-${index}`}>{step}</li>
              ))}
            </ul>

            {!props.prioritySummary.hideCta ? (
              <Link
                className="cb-linkpill cb-feedback-cta"
                href={normalizedOrigin ? `/insights?site=${encodeURIComponent(normalizedOrigin)}` : "/insights"}
              >
                Open Insights <span aria-hidden="true">›</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
