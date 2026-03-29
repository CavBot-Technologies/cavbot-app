"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockIcon } from "@/components/LockIcon";

type DashboardTier = "PREMIUM" | "PREMIUM_PLUS";
type DashboardTab = "activity" | "audit";
type DashboardSection = "Explore" | "Recents" | "Shared" | "Settings" | "Files";

type DashboardPayload = {
  ok: true;
  tier: DashboardTier;
  securedStorage: {
    usedBytes: number;
    freeBytes: number;
    limitBytes: number;
    growthBytesRange?: number;
    trendPoints?: Array<{ t: number; usedBytes: number }>;
    breakdown?: Array<{ kind: string; bytes: number }>;
    topFolders?: Array<{ folderId: string; name: string; bytes: number; path?: string | null }>;
  };
  activity: {
    events: Array<{
      id: string;
      kind: string;
      label: string;
      createdAt: string;
      subjectType: string;
      subjectId: string;
      metaSafe?: Record<string, string | number | boolean | null> | null;
    }>;
  };
  publishEvidence: {
    recentArtifacts: Array<{
      artifactId: string;
      title: string;
      visibility: string;
      publishedAt: string | null;
      sourcePath?: string | null;
    }>;
    privateEvidenceCount?: number;
    privateEvidenceRecent?: Array<{
      artifactId: string;
      title: string;
      publishedAt: string | null;
    }>;
  };
  queue: {
    activeUploads: Array<{
      id: string;
      kind: "file" | "folder";
      label: string;
      progress: number;
      status: string;
    }>;
    activeMoves: Array<{
      id: string;
      direction: "IN" | "OUT";
      label: string;
      status: string;
    }>;
    failedItems: Array<{
      id: string;
      label: string;
      reasonCode: string;
      queueType?: string;
    }>;
  };
  premiumPlus: {
    locked: boolean;
    audit?: {
      pulse24h: Array<{ kind: string; count: number }>;
      pulse7d: Array<{ kind: string; count: number }>;
      recent: Array<{ id: string; kind: string; label: string; createdAt: string }>;
    };
    integrity?: { lockedCount: number; missingSha256Count: number };
    timeLocks?: {
      lockedCount: number;
      expiredCount: number;
      unlockingSoon: Array<{ fileId: string; name: string; unlockAt: string }>;
    };
    snapshots?: {
      lastSnapshot?: { snapshotId: string; createdAt: string; sha256Prefix: string };
      totalCount: number;
    };
    mounts?: { count: number };
  };
};

type LocalUploadItem = {
  id: string;
  kind: "file" | "folder";
  label: string;
  progress?: number | null;
  status?: string;
};

type LocalMoveItem = {
  id: string;
  direction: "IN" | "OUT";
  label: string;
  status: string;
};

type CavSafeOwnerCommandDashboardProps = {
  isActive: boolean;
  isBusy: boolean;
  mutationSignal: string;
  localUploads?: LocalUploadItem[];
  localMoves?: LocalMoveItem[];
  onOpenSection: (section: DashboardSection) => void;
  onOpenLockedFiles?: () => void;
  onJumpToFolderPath: (path: string) => void | Promise<void>;
  onOpenFilePreview: (args: { fileId?: string | null; path?: string | null; createdAt: string }) => void | Promise<void>;
  onOpenArtifacts: () => void;
  onOpenMounts: () => void;
  onOpenUploadPicker: () => void;
  onRefreshAfterCommand?: () => void | Promise<void>;
};

function normalizePath(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) return "/";
  const withSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let num = value;
  let index = 0;
  while (num >= 1024 && index < units.length - 1) {
    num /= 1024;
    index += 1;
  }
  const rounded = num >= 100 || index === 0 ? Math.round(num) : num >= 10 ? Number(num.toFixed(1)) : Number(num.toFixed(2));
  return `${rounded} ${units[index]}`;
}

function formatGrowth(value: number | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "0 B";
  const abs = Math.abs(value);
  return `${value > 0 ? "+" : "-"}${formatBytes(abs)}`;
}

function formatDateTime(iso: string | null | undefined): string {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildSparkline(points: Array<{ t: number; usedBytes: number }>, width = 560, height = 122) {
  if (!points.length) return null;
  const padX = 8;
  const padY = 8;
  const usableW = Math.max(1, width - padX * 2);
  const usableH = Math.max(1, height - padY * 2);
  const minV = Math.min(...points.map((p) => Math.max(0, p.usedBytes)));
  const maxV = Math.max(...points.map((p) => Math.max(0, p.usedBytes)));
  const span = Math.max(1, maxV - minV);

  const coords = points.map((point, index) => {
    const x = padX + (points.length <= 1 ? 0 : (index / (points.length - 1)) * usableW);
    const normalized = (Math.max(0, point.usedBytes) - minV) / span;
    const y = padY + (1 - normalized) * usableH;
    return { x, y };
  });

  const linePath = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1]?.x.toFixed(2)} ${(height - padY).toFixed(2)} L ${coords[0]?.x.toFixed(2)} ${(height - padY).toFixed(2)} Z`;

  return {
    width,
    height,
    linePath,
    areaPath,
    coords,
  };
}

function visibilityLabel(raw: string): string {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "PUBLIC_PROFILE") return "PUBLIC_PROFILE";
  if (value === "LINK_ONLY") return "LINK_ONLY";
  return "PRIVATE";
}

function reasonLabel(reasonCode: string): string {
  const code = String(reasonCode || "").trim().toUpperCase();
  if (!code) return "Operation failed";
  if (code === "UPLOAD_ABORTED") return "Upload session aborted";
  if (code === "UPLOAD_EXPIRED") return "Upload session expired";
  return code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function LockedStatusIcon() {
  return (
    <span className="cavsafe-ownerLockIcon" aria-label="Locked" title="Locked">
      <LockIcon aria-hidden="true" />
    </span>
  );
}

const CAVSAFE_DASHBOARD_CACHE_KEY = "cavsafe:owner-dashboard:cache:v1";

function readDashboardCache(): DashboardPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = globalThis.__cbSessionStore.getItem(CAVSAFE_DASHBOARD_CACHE_KEY) || globalThis.__cbLocalStore.getItem(CAVSAFE_DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardPayload | null;
    return parsed && parsed.ok === true ? parsed : null;
  } catch {
    return null;
  }
}

function writeDashboardCache(payload: DashboardPayload): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(payload);
    globalThis.__cbSessionStore.setItem(CAVSAFE_DASHBOARD_CACHE_KEY, serialized);
    globalThis.__cbLocalStore.setItem(CAVSAFE_DASHBOARD_CACHE_KEY, serialized);
  } catch {}
}

export default function CavSafeOwnerCommandDashboard(props: CavSafeOwnerCommandDashboardProps) {
  const {
    isActive,
    isBusy,
    mutationSignal,
    localUploads,
    localMoves,
    onOpenSection,
    onOpenLockedFiles,
    onJumpToFolderPath,
    onOpenFilePreview,
    onOpenArtifacts,
    onOpenMounts,
    onOpenUploadPicker,
    onRefreshAfterCommand,
  } = props;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [tab, setTab] = useState<DashboardTab>("activity");
  const [queueActionId, setQueueActionId] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    const cached = readDashboardCache();
    if (cached) setPayload(cached);
  }, []);

  const loadDashboard = useCallback(async (silent = false) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!silent) {
      setError("");
    }

    try {
      const res = await fetch("/api/cavsafe/dashboard?range=7d", {
        method: "GET",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as DashboardPayload | { ok?: false; message?: string } | null;
      if (requestRef.current !== requestId) return;
      if (!res.ok || !body || body.ok !== true) {
        throw new Error(String((body as { message?: string } | null)?.message || `Failed to load dashboard (${res.status}).`));
      }
      setPayload(body);
      writeDashboardCache(body);
      setError("");
      setLoading(false);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    if (!mutationSignal) return;
    void loadDashboard(true);
  }, [mutationSignal, loadDashboard]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isActive, loadDashboard]);

  const tier = payload?.tier || "PREMIUM";
  const plusUnlocked = !!payload && tier === "PREMIUM_PLUS" && !payload.premiumPlus.locked;

  const meterPct = useMemo(() => {
    const used = Math.max(0, Number(payload?.securedStorage.usedBytes || 0));
    const limit = Math.max(0, Number(payload?.securedStorage.limitBytes || 0));
    if (!limit) return 0;
    return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  }, [payload?.securedStorage.limitBytes, payload?.securedStorage.usedBytes]);

  const sparkline = useMemo(() => buildSparkline(payload?.securedStorage.trendPoints || []), [payload?.securedStorage.trendPoints]);

  const breakdownTotal = useMemo(() => {
    return (payload?.securedStorage.breakdown || []).reduce((sum, row) => sum + Math.max(0, Number(row.bytes || 0)), 0);
  }, [payload?.securedStorage.breakdown]);

  const breakdownRows = useMemo(() => {
    const labels: Record<string, string> = {
      images: "Images",
      videos: "Videos",
      documents: "Documents",
      archives: "Archives",
      code: "Code",
      other: "Other",
    };
    return (payload?.securedStorage.breakdown || []).map((row) => {
      const bytes = Math.max(0, Number(row.bytes || 0));
      return {
        kind: String(row.kind || "other").toLowerCase(),
        label: labels[String(row.kind || "other").toLowerCase()] || "Other",
        bytes,
        pct: breakdownTotal > 0 ? Math.max(0, Math.min(100, (bytes / breakdownTotal) * 100)) : 0,
      };
    });
  }, [payload?.securedStorage.breakdown, breakdownTotal]);

  const mergedUploads = useMemo(() => {
    const out = new Map<string, { id: string; kind: "file" | "folder"; label: string; progress: number; status: string; local?: boolean }>();
    for (const row of localUploads || []) {
      const id = String(row.id || "").trim();
      if (!id) continue;
      out.set(id, {
        id,
        kind: row.kind,
        label: String(row.label || "Upload"),
        progress: Math.max(0, Math.min(100, Number(row.progress || 0))),
        status: String(row.status || "UPLOADING"),
        local: true,
      });
    }
    for (const row of payload?.queue.activeUploads || []) {
      if (!out.has(row.id)) {
        out.set(row.id, {
          id: row.id,
          kind: row.kind,
          label: row.label,
          progress: Math.max(0, Math.min(100, Number(row.progress || 0))),
          status: String(row.status || "QUEUED"),
        });
      }
    }
    return Array.from(out.values());
  }, [localUploads, payload?.queue.activeUploads]);

  const mergedMoves = useMemo(() => {
    const out = new Map<string, LocalMoveItem>();
    for (const row of localMoves || []) out.set(row.id, row);
    for (const row of payload?.queue.activeMoves || []) {
      if (!out.has(row.id)) out.set(row.id, row);
    }
    return Array.from(out.values());
  }, [localMoves, payload?.queue.activeMoves]);

  const failedItems = useMemo(() => payload?.queue.failedItems || [], [payload?.queue.failedItems]);
  const activityEvents = payload?.activity.events || [];
  const auditRecent = payload?.premiumPlus.audit?.recent || [];

  const handleActivityClick = useCallback(async (row: DashboardPayload["activity"]["events"][number]) => {
    const meta = row.metaSafe || {};
    const pathCandidate = String(meta.toPath || meta.targetPath || meta.path || "").trim();
    const fileId = String(meta.fileId || (row.subjectType === "file" ? row.subjectId : "") || "").trim();
    const folderPath = normalizePath(pathCandidate || (row.subjectType === "folder" ? row.label : ""));

    if (String(row.kind || "").toUpperCase() === "PUBLISH_ARTIFACT") {
      onOpenArtifacts();
      return;
    }

    if (row.subjectType === "folder" && folderPath && folderPath !== "/") {
      await onJumpToFolderPath(folderPath);
      return;
    }

    if (row.subjectType === "file" || fileId || pathCandidate) {
      await onOpenFilePreview({
        fileId: fileId || null,
        path: pathCandidate || null,
        createdAt: row.createdAt,
      });
      return;
    }

    if (folderPath && folderPath !== "/") {
      await onJumpToFolderPath(folderPath);
    }
  }, [onJumpToFolderPath, onOpenArtifacts, onOpenFilePreview]);

  const handleCancelUpload = useCallback(async (uploadId: string, mode: "cancel" | "forget" = "cancel") => {
    const cleanId = String(uploadId || "").trim();
    if (!cleanId) return false;
    setQueueActionId(cleanId);
    setNotice("");
    try {
      const suffix = mode === "forget" ? "?mode=forget" : "";
      const res = await fetch(`/api/cavsafe/uploads/${encodeURIComponent(cleanId)}${suffix}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const body = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !body?.ok) {
        throw new Error(String(body?.message || "Failed to update upload queue item."));
      }
      await loadDashboard(true);
      if (onRefreshAfterCommand) await onRefreshAfterCommand();
      return true;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Queue action failed.");
      return false;
    } finally {
      setQueueActionId("");
    }
  }, [loadDashboard, onRefreshAfterCommand]);

  const handleRetryFailed = useCallback(async (itemId: string) => {
    const ok = await handleCancelUpload(itemId, "forget");
    if (!ok) return;
    onOpenUploadPicker();
    setNotice("Select the source file again to retry this upload.");
  }, [handleCancelUpload, onOpenUploadPicker]);

  const handleRetryAllFailed = useCallback(async () => {
    const ids = failedItems.map((row) => String(row.id || "").trim()).filter(Boolean);
    if (!ids.length) return;
    setQueueActionId("__retry_all__");
    setNotice("");
    try {
      await Promise.all(ids.map(async (id) => {
        const res = await fetch(`/api/cavsafe/uploads/${encodeURIComponent(id)}?mode=forget`, {
          method: "DELETE",
          cache: "no-store",
        });
        const body = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
        if (!res.ok || !body?.ok) {
          throw new Error(String(body?.message || "Failed to clear failed queue items."));
        }
      }));
      await loadDashboard(true);
      if (onRefreshAfterCommand) await onRefreshAfterCommand();
      onOpenUploadPicker();
      setNotice("Retry all requested. Select source files to continue.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to retry queue items.");
    } finally {
      setQueueActionId("");
    }
  }, [failedItems, loadDashboard, onOpenUploadPicker, onRefreshAfterCommand]);

  const handleCreateSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/cavsafe/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        cache: "no-store",
      });
      const body = await res.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !body?.ok) {
        throw new Error(String(body?.message || "Failed to create snapshot."));
      }
      setNotice("Snapshot created.");
      await loadDashboard(true);
      if (onRefreshAfterCommand) await onRefreshAfterCommand();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Snapshot failed.");
    } finally {
      setSnapshotBusy(false);
    }
  }, [loadDashboard, onRefreshAfterCommand]);

  const showSkeleton = loading && !payload;

  return (
    <div className="cavcloud-homeDash cavcloud-opDash cavsafe-ownerDash">
      {error && !payload ? <div className="cavcloud-empty">{error}</div> : null}
      {notice ? <div className="cavsafe-ownerNotice">{notice}</div> : null}

      <div className="cavcloud-opGrid cavsafe-ownerGrid" aria-live="polite">
        <section className="cavcloud-homeCard cavcloud-opCard cavsafe-ownerPosture" aria-label="Secured storage posture">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitleWithIcon">
              <svg className="cavcloud-homeTitleIcon cavsafe-storageTitleIcon cavsafe-ownerPostureTitleIcon" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
                <path d="M33,6.69h0c-.18-3.41-9.47-4.33-15-4.33S3,3.29,3,6.78V29.37c0,3.49,9.43,4.43,15,4.43s15-.93,15-4.43V6.78s0,0,0,0S33,6.7,33,6.69Zm-2,7.56c-.33.86-5.06,2.45-13,2.45A37.45,37.45,0,0,1,7,15.34v2.08A43.32,43.32,0,0,0,18,18.7c4,0,9.93-.48,13-2v5.17c-.33.86-5.06,2.45-13,2.45A37.45,37.45,0,0,1,7,22.92V25a43.32,43.32,0,0,0,11,1.28c4,0,9.93-.48,13-2v5.1c-.35.86-5.08,2.45-13,2.45S5.3,30.2,5,29.37V6.82C5.3,6,10,4.36,18,4.36c7.77,0,12.46,1.53,13,2.37-.52.87-5.21,2.39-13,2.39A37.6,37.6,0,0,1,7,7.76V9.85a43.53,43.53,0,0,0,11,1.27c4,0,9.93-.48,13-2Z" />
              </svg>
              <div className="cavcloud-homeTitle">Secured Storage Posture</div>
            </div>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h32" />
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h64" />
            </div>
          ) : payload ? (
            <>
              <div className="cavcloud-opMetricRow cavsafe-ownerMetricRow3">
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead"><span>Used</span></div>
                  <strong>{formatBytes(payload.securedStorage.usedBytes)}</strong>
                  <span className="cavcloud-opMetricSub">secured storage in use</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead"><span>Free</span></div>
                  <strong>{formatBytes(payload.securedStorage.freeBytes)}</strong>
                  <span className="cavcloud-opMetricSub">available right now</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead"><span>Total</span></div>
                  <strong>{formatBytes(payload.securedStorage.limitBytes)}</strong>
                  <span className="cavcloud-opMetricSub">CavSafe quota</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead"><span>Growth (7d)</span></div>
                  <strong>{formatGrowth(payload.securedStorage.growthBytesRange)}</strong>
                  <span className="cavcloud-opMetricSub">change in used storage</span>
                </div>
              </div>

              <div className="cavsafe-ownerMeter" aria-label="Secured storage utilization">
                <span style={{ width: `${meterPct}%` }} />
              </div>
              <div className="cavcloud-storageChartMeta">
                <span>{meterPct}% utilized</span>
                <span>{formatBytes(payload.securedStorage.freeBytes)} free</span>
              </div>

              {plusUnlocked ? (
                <>
                  {sparkline ? (
                    <div className="cavcloud-storageChartWrap cavcloud-opSparkWrap">
                      <svg className="cavcloud-storageChart" viewBox={`0 0 ${sparkline.width} ${sparkline.height}`} role="img" aria-label="Secured storage trend">
                        <path d={sparkline.areaPath} className="cavcloud-storageChartArea" />
                        <path d={sparkline.linePath} className="cavcloud-storageChartLine" />
                        {sparkline.coords.map((coord, index) => (
                          <circle
                            key={`${coord.x}-${coord.y}-${index}`}
                            cx={coord.x}
                            cy={coord.y}
                            r={index === sparkline.coords.length - 1 ? 3.2 : 2.2}
                            className="cavcloud-storageChartPoint"
                          />
                        ))}
                      </svg>
                    </div>
                  ) : null}

                  <div className="cavcloud-opBreakdownBar" aria-label="Storage breakdown">
                    {breakdownRows.map((row) => (
                      <span key={row.kind} className={`cavcloud-opBreakdownSeg is-${row.kind}`} style={{ width: `${row.pct}%` }} />
                    ))}
                  </div>
                  <div className="cavcloud-opBreakdownList">
                    {breakdownRows.map((row) => (
                      <div key={row.kind} className="cavcloud-homeRow">
                        <span className="cavcloud-opBreakdownLabel">
                          <span className={`cavcloud-opBreakdownDot is-${row.kind}`} aria-hidden="true" />
                          <span>{row.label}</span>
                        </span>
                        <span>{formatBytes(row.bytes)}</span>
                      </div>
                    ))}
                  </div>

                </>
              ) : (
                <div className="cavsafe-ownerLockedPreview" role="note" aria-label="Premium plus locked posture intelligence">
                  <div className="cavsafe-ownerLockedPreviewBlur" aria-hidden="true">
                    <div className="cavcloud-opBreakdownBar" aria-hidden="true">
                      <span className="cavcloud-opBreakdownSeg is-images" style={{ width: "34%" }} />
                      <span className="cavcloud-opBreakdownSeg is-videos" style={{ width: "24%" }} />
                      <span className="cavcloud-opBreakdownSeg is-documents" style={{ width: "19%" }} />
                      <span className="cavcloud-opBreakdownSeg is-archives" style={{ width: "13%" }} />
                      <span className="cavcloud-opBreakdownSeg is-code" style={{ width: "10%" }} />
                    </div>
                    <div className="cavcloud-opBreakdownList">
                      <div className="cavcloud-homeRow">
                        <span className="cavcloud-opBreakdownLabel">
                          <span className="cavcloud-opBreakdownDot is-images" aria-hidden="true" />
                          <span>Images</span>
                        </span>
                        <span>---</span>
                      </div>
                      <div className="cavcloud-homeRow">
                        <span className="cavcloud-opBreakdownLabel">
                          <span className="cavcloud-opBreakdownDot is-videos" aria-hidden="true" />
                          <span>Videos</span>
                        </span>
                        <span>---</span>
                      </div>
                      <div className="cavcloud-homeRow">
                        <span className="cavcloud-opBreakdownLabel">
                          <span className="cavcloud-opBreakdownDot is-documents" aria-hidden="true" />
                          <span>Documents</span>
                        </span>
                        <span>---</span>
                      </div>
                    </div>
                  </div>
                  <div className="cavsafe-ownerLockedOverlay">
                    <div className="cavsafe-ownerLockedOverlayBody">
                      <div className="cavsafe-ownerLockedTitle">Premium+ unlocks trend and breakdown posture intelligence.</div>
                      <div className="cavsafe-ownerLockedSub">Available on Premium+.</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="cavcloud-empty">Secured storage posture unavailable.</div>
          )}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavsafe-ownerPublish" aria-label="Publish and evidence">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Publish &amp; Evidence</div>
            <button className="cavcloud-homeSeeAll" type="button" disabled={isBusy} onClick={onOpenArtifacts}>View all</button>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
            </div>
          ) : (payload?.publishEvidence.recentArtifacts || []).length ? (
            <div className="cavcloud-opPanelList">
              {(payload?.publishEvidence.recentArtifacts || []).map((row) => (
                <button
                  key={row.artifactId}
                  type="button"
                  className="cavcloud-opPanelRow cavcloud-opPanelRowLink cavcloud-opArtifactRow"
                  disabled={isBusy}
                  onClick={onOpenArtifacts}
                  title={row.sourcePath || row.title}
                >
                  <div className="cavcloud-opArtifactMain">
                    <span className="cavcloud-opArtifactTitle">{row.title}</span>
                    {row.publishedAt ? <span className="cavcloud-opArtifactPath">{formatDateTime(row.publishedAt)}</span> : null}
                  </div>
                  <span className={`cavcloud-opArtifactVisibility is-${visibilityLabel(row.visibility).toLowerCase()}`}>{visibilityLabel(row.visibility)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cavcloud-empty">No published artifacts yet.</div>
          )}

          {plusUnlocked ? (
            <div className="cavcloud-opSubsection">
              <div className="cavcloud-homeTitle">Private Evidence Artifacts</div>
              <div className="cavcloud-homeRow">
                <span>Count</span>
                <span>{Math.max(0, Number(payload?.publishEvidence.privateEvidenceCount || 0))}</span>
              </div>
              {(payload?.publishEvidence.privateEvidenceRecent || []).length ? (
                <div className="cavcloud-homeList">
                  {(payload?.publishEvidence.privateEvidenceRecent || []).map((row) => (
                    <div key={row.artifactId} className="cavcloud-homeRow">
                      <span className="cavcloud-opEllipsis">{row.title}</span>
                      <span>{formatDateTime(row.publishedAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cavcloud-opPanelEmpty">No private evidence artifacts.</div>
              )}
            </div>
          ) : null}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavsafe-ownerModules" aria-label="Owner command modules">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Owner Command Modules</div>
            <span className="cavcloud-opCount"><strong>Premium+</strong></span>
          </div>

          <div className="cavsafe-ownerModuleStack">
            <div className="cavsafe-ownerModule">
              <div className="cavsafe-ownerModuleHead">
                <span>Integrity Lock</span>
                {plusUnlocked ? <span className="cavsafe-ownerModuleStatus">{`${Math.max(0, Number(payload?.premiumPlus.integrity?.lockedCount || 0))} locked`}</span> : null}
              </div>
              {plusUnlocked ? (
                <div className="cavsafe-ownerModuleBody">
                  <div className="cavcloud-homeRow">
                    <span>Missing SHA-256</span>
                    <span>{Math.max(0, Number(payload?.premiumPlus.integrity?.missingSha256Count || 0))}</span>
                  </div>
                  <button
                    className="cavcloud-rowAction"
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      if (onOpenLockedFiles) {
                        onOpenLockedFiles();
                        return;
                      }
                      onOpenSection("Files");
                    }}
                  >
                    View locked files
                  </button>
                </div>
              ) : (
                <div className="cavsafe-ownerLockedHint">
                  <LockedStatusIcon />
                </div>
              )}
            </div>

            <div className="cavsafe-ownerModule">
              <div className="cavsafe-ownerModuleHead">
                <span>Time Locks</span>
                {plusUnlocked ? <span className="cavsafe-ownerModuleStatus">{`${Math.max(0, Number(payload?.premiumPlus.timeLocks?.lockedCount || 0))} active`}</span> : null}
              </div>
              {plusUnlocked ? (
                <div className="cavsafe-ownerModuleBody">
                  <div className="cavcloud-homeRow">
                    <span>Expired</span>
                    <span>{Math.max(0, Number(payload?.premiumPlus.timeLocks?.expiredCount || 0))}</span>
                  </div>
                  {(payload?.premiumPlus.timeLocks?.unlockingSoon || []).length ? (
                    <div className="cavcloud-homeList">
                      {(payload?.premiumPlus.timeLocks?.unlockingSoon || []).map((row) => (
                        <div key={row.fileId} className="cavcloud-homeRow">
                          <span className="cavcloud-opEllipsis">{row.name}</span>
                          <span>{formatDateTime(row.unlockAt)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No unlock windows scheduled.</div>
                  )}
                </div>
              ) : (
                <div className="cavsafe-ownerLockedHint">
                  <LockedStatusIcon />
                </div>
              )}
            </div>

            <div className="cavsafe-ownerModule">
              <div className="cavsafe-ownerModuleHead">
                <span>Snapshots &amp; Archives</span>
                {plusUnlocked ? <span className="cavsafe-ownerModuleStatus">{`${Math.max(0, Number(payload?.premiumPlus.snapshots?.totalCount || 0))} total`}</span> : null}
              </div>
              {plusUnlocked ? (
                <div className="cavsafe-ownerModuleBody">
                  {payload?.premiumPlus.snapshots?.lastSnapshot ? (
                    <div className="cavcloud-homeRow">
                      <span>Last snapshot</span>
                      <span>{formatDateTime(payload.premiumPlus.snapshots.lastSnapshot.createdAt)}</span>
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No snapshot yet.</div>
                  )}
                  {payload?.premiumPlus.snapshots?.lastSnapshot?.sha256Prefix ? (
                    <div className="cavcloud-homeRow">
                      <span>SHA-256</span>
                      <span>{payload.premiumPlus.snapshots.lastSnapshot.sha256Prefix}</span>
                    </div>
                  ) : null}
                  <div className="cavcloud-opInlineActions">
                    <button className="cavcloud-rowAction" type="button" disabled={isBusy || snapshotBusy} onClick={() => void handleCreateSnapshot()}>
                      {snapshotBusy ? "Creating..." : "Create snapshot"}
                    </button>
                    <button className="cavcloud-rowAction" type="button" disabled={isBusy} onClick={() => onOpenSection("Recents")}>View all snapshots</button>
                  </div>
                </div>
              ) : (
                <div className="cavsafe-ownerLockedHint">
                  <LockedStatusIcon />
                </div>
              )}
            </div>

            <div className="cavsafe-ownerModule">
              <div className="cavsafe-ownerModuleHead">
                <span>CavCode Mounts</span>
                {plusUnlocked ? <span className="cavsafe-ownerModuleStatus">{`${Math.max(0, Number(payload?.premiumPlus.mounts?.count || 0))} active`}</span> : null}
              </div>
              {plusUnlocked ? (
                <div className="cavsafe-ownerModuleBody">
                  <button className="cavcloud-rowAction" type="button" disabled={isBusy} onClick={onOpenMounts}>Manage mounts</button>
                </div>
              ) : (
                <div className="cavsafe-ownerLockedHint">
                  <LockedStatusIcon />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavsafe-ownerActivity" aria-label="Activity and audit">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Activity + Audit</div>
            <div className="cavcloud-opInlineActions cavsafe-ownerActivityTabs">
              <button className={`cavcloud-rowAction cavsafe-ownerActivityTab ${tab === "activity" ? "is-active" : ""}`} type="button" onClick={() => setTab("activity")}>Activity</button>
              <button className={`cavcloud-rowAction cavsafe-ownerActivityTab ${tab === "audit" ? "is-active" : ""}`} type="button" onClick={() => setTab("audit")}>Audit</button>
            </div>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
            </div>
          ) : tab === "activity" ? (
            <>
              {activityEvents.length ? (
                <div className="cavcloud-opActivityList cavsafe-ownerActivityList">
                  {activityEvents.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="cavcloud-opActivityItem"
                      disabled={isBusy}
                      onClick={() => void handleActivityClick(row)}
                    >
                      <span className="cavcloud-opEllipsis">{row.label}</span>
                      <span>{formatDateTime(row.createdAt)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="cavcloud-empty">No recent activity.</div>
              )}
              <div className="cavcloud-opSubsection">
                <button className="cavcloud-homeSeeAll" type="button" disabled={isBusy} onClick={() => onOpenSection("Recents")}>View all activity</button>
              </div>
            </>
          ) : plusUnlocked ? (
            <>
              <div className="cavcloud-opMiniMetrics">
                {(payload?.premiumPlus.audit?.pulse24h || []).map((row) => (
                  <div key={`24h-${row.kind}`} className="cavcloud-opMiniMetric">
                    <span>{row.kind} (24h)</span>
                    <strong>{row.count}</strong>
                  </div>
                ))}
                {(payload?.premiumPlus.audit?.pulse7d || []).map((row) => (
                  <div key={`7d-${row.kind}`} className="cavcloud-opMiniMetric">
                    <span>{row.kind} (7d)</span>
                    <strong>{row.count}</strong>
                  </div>
                ))}
              </div>
              {auditRecent.length ? (
                <div className="cavcloud-opActivityList cavsafe-ownerActivityList">
                  {auditRecent.map((row) => (
                    <div key={row.id} className="cavcloud-opActivityItem" role="listitem">
                      <span className="cavcloud-opEllipsis">{row.label}</span>
                      <span>{formatDateTime(row.createdAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cavcloud-empty">No audit events yet.</div>
              )}
            </>
          ) : (
            <div className="cavsafe-ownerAuditGate" role="note" aria-label="Audit log locked on Premium">
              <div className="cavsafe-ownerAuditGateMain">
                <div className="cavsafe-ownerAuditGateTitleRow">
                  <LockedStatusIcon />
                  <span>Audit Log is available on Premium+.</span>
                </div>
                <div className="cavsafe-ownerAuditGateSub">Unlock security pulse summaries and full audit history.</div>
              </div>
              <button
                className="cavcloud-rowAction cavsafe-ownerAuditGateCta"
                type="button"
                onClick={() => {
                  window.location.href = "/plan";
                }}
              >
                Upgrade
              </button>
            </div>
          )}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavsafe-ownerQueue" aria-label="Upload and move queue">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Upload + Move Queue</div>
            <div className="cavcloud-opInlineActions">
              {failedItems.length ? (
                <button
                  className="cavcloud-rowAction"
                  type="button"
                  disabled={isBusy || queueActionId === "__retry_all__"}
                  onClick={() => void handleRetryAllFailed()}
                >
                  {queueActionId === "__retry_all__" ? "Retrying..." : "Retry all failed"}
                </button>
              ) : null}
              <button
                className="cavcloud-rowAction is-icon cavsafe-ownerUploadBtn"
                type="button"
                disabled={isBusy}
                onClick={onOpenUploadPicker}
                aria-label="Upload"
                title="Upload"
              >
                <Image
                  src="/icons/upload-cloud-svgrepo-com.svg"
                  alt=""
                  aria-hidden="true"
                  width={16}
                  height={16}
                  className="cavsafe-ownerUploadIcon"
                />
              </button>
            </div>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h72" />
              <div className="cavcloud-opSkeleton h72" />
            </div>
          ) : (
            <>
              <div className="cavcloud-opMiniMetrics">
                <div className="cavcloud-opMiniMetric">
                  <span>Active uploads</span>
                  <strong>{mergedUploads.length}</strong>
                </div>
                <div className="cavcloud-opMiniMetric">
                  <span>Active moves</span>
                  <strong>{mergedMoves.length}</strong>
                </div>
                <div className="cavcloud-opMiniMetric">
                  <span>Failed items</span>
                  <strong>{failedItems.length}</strong>
                </div>
              </div>

              <div className="cavcloud-opSplitColumns">
                <div className="cavcloud-opPanel">
                  <div className="cavcloud-homeTitle">In progress</div>
                  {mergedUploads.length || mergedMoves.length ? (
                    <div className="cavcloud-opPanelList cavcloud-opQueueList">
                      {mergedUploads.map((row) => (
                        <div key={row.id} className="cavcloud-opQueueItem">
                          <div className="cavcloud-opQueueHead">
                            <span className="cavcloud-opEllipsis">{row.label}</span>
                            <span>{row.progress}%</span>
                          </div>
                          <div className="cavcloud-opProgress">
                            <span style={{ width: `${Math.max(0, Math.min(100, Number(row.progress || 0)))}%` }} />
                          </div>
                          {!row.local ? (
                            <div className="cavcloud-opInlineActions">
                              <button
                                className="cavcloud-rowAction"
                                type="button"
                                disabled={isBusy || queueActionId === row.id}
                                onClick={() => void handleCancelUpload(row.id, "cancel")}
                              >
                                {queueActionId === row.id ? "Canceling..." : "Cancel"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      {mergedMoves.map((row) => (
                        <div key={row.id} className="cavcloud-opQueueItem cavsafe-ownerMoveItem">
                          <div className="cavcloud-opQueueHead">
                            <span className="cavcloud-opEllipsis">{row.direction === "IN" ? "CavCloud → CavSafe" : "CavSafe → CavCloud"}</span>
                            <span>{row.status}</span>
                          </div>
                          <div className="cavcloud-homeRow">
                            <span className="cavcloud-opEllipsis">{row.label}</span>
                            <span />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No active uploads or moves.</div>
                  )}
                </div>

                <div className="cavcloud-opPanel">
                  <div className="cavcloud-homeTitle">Failed items</div>
                  {failedItems.length ? (
                    <div className="cavcloud-opPanelList cavcloud-opFailureList">
                      {failedItems.map((row) => (
                        <div key={row.id} className="cavcloud-opFailureRow">
                          <div className="cavcloud-opFailureBody">
                            <strong className="cavcloud-opEllipsis">{row.label}</strong>
                            <span className="cavcloud-opEllipsis">{reasonLabel(row.reasonCode)}</span>
                          </div>
                          <div className="cavcloud-opInlineActions">
                            <button
                              className="cavcloud-rowAction"
                              type="button"
                              disabled={isBusy || queueActionId === row.id}
                              onClick={() => void handleRetryFailed(row.id)}
                            >
                              {queueActionId === row.id ? "Retrying..." : "Retry"}
                            </button>
                            <button
                              className="cavcloud-rowAction"
                              type="button"
                              disabled={isBusy || queueActionId === row.id}
                              onClick={() => void handleCancelUpload(row.id, "forget")}
                            >
                              {queueActionId === row.id ? "Removing..." : "Cancel"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No failed queue items.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
