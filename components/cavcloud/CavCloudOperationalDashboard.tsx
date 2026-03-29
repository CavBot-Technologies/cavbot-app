"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DashboardStorage = {
  usedBytes: number;
  totalBytesLimit: number | null;
  freeBytes: number | null;
  growthBytesRange: number;
  trendPoints: Array<{ t: number; usedBytes: number }>;
  breakdown: Array<{ kind: string; bytes: number }>;
  largestFolders: Array<{ folderId: string; name: string; bytes: number; path?: string | null }>;
};

type DashboardActivityEvent = {
  id: string;
  kind: string;
  label: string;
  createdAt: string;
  subjectType: string;
  subjectId: string;
  metaSafe?: Record<string, string | number | boolean | null> | null;
};

type DashboardSharesArtifacts = {
  activeSharesCount: number;
  expiringSoon: Array<{ shareId: string; label: string; expiresAt: string }>;
  recentArtifacts: Array<{ artifactId: string; title: string; visibility: string; publishedAt: string | null; sourcePath?: string | null }>;
};

type DashboardUploadSession = {
  sessionId: string;
  rootFolderId: string;
  rootFolderPath: string;
  rootName: string;
  status: string;
  discovered: number;
  uploaded: number;
  failed: number;
  provider?: string;
};

type DashboardPayload = {
  ok: true;
  storage: DashboardStorage;
  activity: { events: DashboardActivityEvent[] };
  sharesArtifacts: DashboardSharesArtifacts;
  uploads: { activeFolderUploads: DashboardUploadSession[] };
};

type UploadFailure = {
  sessionId?: string | null;
  fileId?: string | null;
  relPath?: string | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  provider?: string | null;
};

type FolderUploadDiagnostics = {
  sessionId?: string;
  discoveredCount?: number;
  uploadedCount?: number;
  failedCount?: number;
  missingCount?: number;
};

type UploadingFile = {
  id: string;
  name: string;
  path: string;
  status?: string | null;
  bytes?: number;
  updatedAtISO?: string;
};

type CavCloudOperationalDashboardProps = {
  refreshNonce: number;
  isActive: boolean;
  isBusy: boolean;
  uploadsPendingCount: number;
  uploadsFailedCount: number;
  folderUploadDiagnostics: FolderUploadDiagnostics;
  folderUploadFailures: UploadFailure[];
  uploadingFiles: UploadingFile[];
  onOpenSection: (section: "Recents" | "Shared" | "Starred" | "Explore") => void;
  onJumpToFolderPath: (path: string) => void | Promise<void>;
  onOpenFileById: (fileId: string, fallbackPath?: string) => void | Promise<void>;
  onOpenArtifacts: () => void;
  onRetryAllFailed: () => void | Promise<void>;
  onRetryFailedItem: (failureKey: string) => void | Promise<void>;
  onCancelFailedItem: (failureKey: string) => void;
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
  if (value == null || !Number.isFinite(value) || value < 0) return "0 B";
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

function formatGrowth(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 B";
  const abs = Math.abs(value);
  const prefix = value > 0 ? "+" : "-";
  return `${prefix}${formatBytes(abs)}`;
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString();
}

function formatDate(iso: string): string {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleDateString();
}

function formatTime(iso: string): string {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleTimeString();
}

function parentFolderPath(rawPath: string): string {
  const normalized = normalizePath(rawPath);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  parts.pop();
  return `/${parts.join("/")}`;
}

function buildSparkline(points: Array<{ t: number; usedBytes: number }>, width = 580, height = 148) {
  if (!points.length) return null;
  const padX = 8;
  const padY = 10;
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

function failureKey(row: UploadFailure): string {
  return `${String(row?.sessionId || "")}::${String(row?.fileId || "")}::${String(row?.relPath || "")}`;
}

function visibilityLabel(raw: string): string {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "PUBLIC_PROFILE") return "PUBLIC_PROFILE";
  if (value === "LINK_ONLY") return "LINK_ONLY";
  return "PRIVATE";
}

function classifyActivity(event: DashboardActivityEvent): "uploads" | "shares" | "publish" | "cavsafe" | "all" {
  const kind = String(event.kind || "").toUpperCase();
  const path = String(event.metaSafe?.path || "").toLowerCase();
  const metaText = JSON.stringify(event.metaSafe || {}).toLowerCase();

  if (path.includes("cavsafe") || metaText.includes("cavsafe")) return "cavsafe";
  if (
    kind === "SHARE_CREATED"
    || kind === "SHARE_REVOKED"
    || kind === "COLLAB_GRANTED"
    || kind === "COLLAB_REVOKED"
    || kind === "ACCESS_GRANTED"
    || kind === "ACCESS_REVOKED"
  ) {
    return "shares";
  }
  if (kind === "PUBLISHED_ARTIFACT" || kind === "ARTIFACT_PUBLISHED" || kind === "UNPUBLISHED_ARTIFACT") return "publish";
  if (
    kind === "GOOGLE_DRIVE_IMPORT_STARTED"
    || kind === "GOOGLE_DRIVE_IMPORT_COMPLETED"
    || kind === "GOOGLE_DRIVE_IMPORT_FILE_FAILED"
    || kind === "GOOGLE_DRIVE_CONNECTED"
    || kind === "GOOGLE_DRIVE_DISCONNECTED"
  ) {
    return "uploads";
  }
  if (
    kind === "UPLOAD_FILE"
    || kind === "FILE_UPLOADED"
    || kind === "CREATE_FOLDER"
    || kind === "MOVE_FILE"
    || kind === "FOLDER_MOVED"
    || kind === "RENAME_FILE"
    || kind === "FILE_RENAMED"
    || kind === "DELETE_FILE"
    || kind === "FILE_DELETED"
    || kind === "RESTORE_FILE"
    || kind === "DUPLICATE_FILE"
    || kind === "ZIP_CREATED"
  ) {
    return "uploads";
  }
  return "all";
}

function safeProgress(done: number, total: number): number {
  const normalizedTotal = Math.max(0, Number(total || 0));
  const normalizedDone = Math.max(0, Number(done || 0));
  if (normalizedTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((normalizedDone / normalizedTotal) * 100)));
}

const CAVCLOUD_DASHBOARD_CACHE_KEY = "cavcloud:op-dashboard:cache:v1";

function readDashboardCache(): DashboardPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = globalThis.__cbSessionStore.getItem(CAVCLOUD_DASHBOARD_CACHE_KEY) || globalThis.__cbLocalStore.getItem(CAVCLOUD_DASHBOARD_CACHE_KEY);
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
    globalThis.__cbSessionStore.setItem(CAVCLOUD_DASHBOARD_CACHE_KEY, serialized);
    globalThis.__cbLocalStore.setItem(CAVCLOUD_DASHBOARD_CACHE_KEY, serialized);
  } catch {}
}

export default function CavCloudOperationalDashboard(props: CavCloudOperationalDashboardProps) {
  const {
    refreshNonce,
    isActive,
    isBusy,
    uploadsPendingCount,
    uploadsFailedCount,
    folderUploadDiagnostics,
    folderUploadFailures,
    uploadingFiles,
    onOpenSection,
    onJumpToFolderPath,
    onOpenFileById,
    onOpenArtifacts,
    onRetryAllFailed,
    onRetryFailedItem,
    onCancelFailedItem,
  } = props;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [activityFilter, setActivityFilter] = useState<"all" | "uploads" | "shares" | "publish">("all");
  const [completedOpen, setCompletedOpen] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const cached = readDashboardCache();
    if (cached) setPayload(cached);
  }, []);

  const openLinkedPath = useCallback(async (rawPath: string) => {
    const normalized = normalizePath(rawPath);
    if (!normalized || normalized === "/") return;
    onOpenSection("Explore");
    try {
      await onJumpToFolderPath(normalized);
      return;
    } catch {
      // If sourcePath is a file path, fall back to its containing folder.
    }
    const fallback = parentFolderPath(normalized);
    if (fallback === normalized) return;
    try {
      await onJumpToFolderPath(fallback);
    } catch {
      // Keep dashboard stable when path is no longer available.
    }
  }, [onJumpToFolderPath, onOpenSection]);

  const loadDashboard = useCallback(async (silent = false) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!silent) {
      setError("");
    }

    try {
      const res = await fetch("/api/cavcloud/dashboard?range=7d", {
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
      const message = err instanceof Error ? err.message : "Failed to load dashboard.";
      setError(message);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    if (!refreshNonce) return;
    void loadDashboard(true);
  }, [refreshNonce, loadDashboard]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => {
      void loadDashboard(true);
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isActive, loadDashboard]);

  const storage = payload?.storage;
  const activityEvents = useMemo(() => Array.isArray(payload?.activity?.events) ? payload.activity.events : [], [payload?.activity?.events]);
  const sharesArtifacts = payload?.sharesArtifacts;
  const sessionUploads = payload?.uploads?.activeFolderUploads || [];

  const filteredActivity = useMemo(() => {
    if (activityFilter === "all") return activityEvents;
    return activityEvents.filter((event) => classifyActivity(event) === activityFilter);
  }, [activityEvents, activityFilter]);

  const sparkline = useMemo(() => buildSparkline(storage?.trendPoints || []), [storage?.trendPoints]);

  const breakdownTotal = useMemo(() => {
    return (storage?.breakdown || []).reduce((sum, row) => sum + Math.max(0, Number(row.bytes || 0)), 0);
  }, [storage?.breakdown]);

  const sortedBreakdown = useMemo(() => {
    const labels: Record<string, string> = {
      images: "Images",
      video: "Video",
      code: "Code",
      docs: "Docs",
      archives: "Archives",
      other: "Other",
    };
    return (storage?.breakdown || []).map((row) => ({
      kind: row.kind,
      label: labels[String(row.kind || "").toLowerCase()] || String(row.kind || "Other"),
      bytes: Math.max(0, Number(row.bytes || 0)),
      pct: breakdownTotal > 0 ? Math.max(0, Math.min(100, (Math.max(0, Number(row.bytes || 0)) / breakdownTotal) * 100)) : 0,
    }));
  }, [storage?.breakdown, breakdownTotal]);

  const localUploadFiles = useMemo(() => {
    return (uploadingFiles || [])
      .filter((row) => String(row.status || "").toUpperCase() === "UPLOADING")
      .slice(0, 8);
  }, [uploadingFiles]);

  const localDiagnostics = useMemo(() => {
    const discovered = Math.max(0, Number(folderUploadDiagnostics?.discoveredCount || 0));
    const uploaded = Math.max(0, Number(folderUploadDiagnostics?.uploadedCount || 0));
    const failed = Math.max(0, Number(folderUploadDiagnostics?.failedCount || 0));
    const missing = Math.max(0, Number(folderUploadDiagnostics?.missingCount || 0));
    const pending = Math.max(0, discovered - uploaded - failed);
    return { discovered, uploaded, failed, pending, missing };
  }, [folderUploadDiagnostics]);
  const hasInProgressUploads = sessionUploads.length > 0 || localUploadFiles.length > 0 || localDiagnostics.pending > 0;

  const handleActivityClick = useCallback(async (event: DashboardActivityEvent) => {
    const meta = event.metaSafe || {};
    const fileId = String(meta.fileId || (event.subjectType === "file" ? event.subjectId : "")).trim();
    const folderPath = String(meta.toPath || meta.targetPath || meta.path || "").trim();
    const filePath = String(meta.path || meta.targetPath || meta.toPath || "").trim();

    if (
      event.kind === "SHARE_CREATED"
      || event.kind === "SHARE_REVOKED"
      || event.kind === "COLLAB_GRANTED"
      || event.kind === "COLLAB_REVOKED"
      || event.kind === "ACCESS_GRANTED"
      || event.kind === "ACCESS_REVOKED"
    ) {
      onOpenSection("Shared");
      return;
    }

    if (event.kind === "PUBLISHED_ARTIFACT" || event.kind === "ARTIFACT_PUBLISHED" || event.kind === "UNPUBLISHED_ARTIFACT") {
      onOpenArtifacts();
      return;
    }

    if (event.subjectType === "folder" && folderPath) {
      await onJumpToFolderPath(normalizePath(folderPath));
      return;
    }

    if (fileId) {
      await onOpenFileById(fileId, filePath || undefined);
      return;
    }

    if (folderPath) {
      await onJumpToFolderPath(normalizePath(folderPath));
    }
  }, [onJumpToFolderPath, onOpenArtifacts, onOpenFileById, onOpenSection]);

  const showSkeleton = loading && !payload;

  return (
    <div className="cavcloud-homeDash cavcloud-opDash">
      {error && !payload ? <div className="cavcloud-empty">{error}</div> : null}

      <div className="cavcloud-opGrid" aria-live="polite">
        <section className="cavcloud-homeCard cavcloud-opCard cavcloud-opStorage" aria-label="Storage posture">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitleWithIcon">
              <svg className="cavcloud-homeTitleIcon is-storage" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">
                <path d="M33,6.69h0c-.18-3.41-9.47-4.33-15-4.33S3,3.29,3,6.78V29.37c0,3.49,9.43,4.43,15,4.43s15-.93,15-4.43V6.78s0,0,0,0S33,6.7,33,6.69Zm-2,7.56c-.33.86-5.06,2.45-13,2.45A37.45,37.45,0,0,1,7,15.34v2.08A43.32,43.32,0,0,0,18,18.7c4,0,9.93-.48,13-2v5.17c-.33.86-5.06,2.45-13,2.45A37.45,37.45,0,0,1,7,22.92V25a43.32,43.32,0,0,0,11,1.28c4,0,9.93-.48,13-2v5.1c-.35.86-5.08,2.45-13,2.45S5.3,30.2,5,29.37V6.82C5.3,6,10,4.36,18,4.36c7.77,0,12.46,1.53,13,2.37-.52.87-5.21,2.39-13,2.39A37.6,37.6,0,0,1,7,7.76V9.85a43.53,43.53,0,0,0,11,1.27c4,0,9.93-.48,13-2Z" />
              </svg>
              <span className="cavcloud-homeTitle">Storage Posture</span>
            </div>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h32" />
              <div className="cavcloud-opSkeleton h120" />
              <div className="cavcloud-opSkeleton h64" />
            </div>
          ) : storage ? (
            <>
              <div className="cavcloud-opMetricRow">
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead">
                    <span>Used</span>
                  </div>
                  <strong>{formatBytes(storage.usedBytes)}</strong>
                  <span className="cavcloud-opMetricSub">{storage.totalBytesLimit == null ? "Tracked usage" : "of plan capacity"}</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead">
                    <span>Free</span>
                  </div>
                  <strong>{storage.freeBytes == null ? "Unlimited" : formatBytes(storage.freeBytes)}</strong>
                  <span className="cavcloud-opMetricSub">{storage.freeBytes == null ? "Plan has no limit" : "remaining space"}</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead">
                    <span>Total</span>
                  </div>
                  <strong>{storage.totalBytesLimit == null ? "Unlimited" : formatBytes(storage.totalBytesLimit)}</strong>
                  <span className="cavcloud-opMetricSub">{storage.totalBytesLimit == null ? "Uncapped storage" : "plan storage limit"}</span>
                </div>
                <div className="cavcloud-opMetric">
                  <div className="cavcloud-opMetricHead">
                    <span>Growth (7d)</span>
                  </div>
                  <strong>{formatGrowth(storage.growthBytesRange)}</strong>
                  <span className="cavcloud-opMetricSub">change in used storage</span>
                </div>
              </div>

              {sparkline ? (
                <div className="cavcloud-storageChartWrap cavcloud-opSparkWrap">
                  <svg className="cavcloud-storageChart" viewBox={`0 0 ${sparkline.width} ${sparkline.height}`} role="img" aria-label="7-day storage trend">
                    <path d={sparkline.areaPath} className="cavcloud-storageChartArea" />
                    <path d={sparkline.linePath} className="cavcloud-storageChartLine" />
                    {sparkline.coords.map((coord, index) => (
                      <circle
                        key={`${coord.x}-${coord.y}-${index}`}
                        cx={coord.x}
                        cy={coord.y}
                        r={index === sparkline.coords.length - 1 ? 3.2 : 2.1}
                        className="cavcloud-storageChartPoint"
                      />
                    ))}
                  </svg>
                </div>
              ) : (
                <div className="cavcloud-empty">No storage trend yet.</div>
              )}

              <div className="cavcloud-opBreakdownBar" aria-label="Storage breakdown by type">
                {sortedBreakdown.map((row) => (
                  <span key={row.kind} className={`cavcloud-opBreakdownSeg is-${row.kind}`} style={{ width: `${Math.max(0, row.pct)}%` }} />
                ))}
              </div>

              <div className="cavcloud-opBreakdownList">
                {sortedBreakdown.map((row) => (
                  <div key={row.kind} className="cavcloud-homeRow">
                    <span className="cavcloud-opBreakdownLabel">
                      <span className={`cavcloud-opBreakdownDot is-${row.kind}`} aria-hidden="true" />
                      <span>{row.label}</span>
                    </span>
                    <span>{formatBytes(row.bytes)}</span>
                  </div>
                ))}
              </div>

              <div className="cavcloud-opSubsection">
                <div className="cavcloud-homeTitle">Largest folders</div>
                {storage.largestFolders.length ? (
                  <div className="cavcloud-homeList">
                    {storage.largestFolders.map((row) => (
                      <div key={row.folderId} className="cavcloud-homeRow">
                        <button
                          className="cavcloud-homeSeeAll"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void onJumpToFolderPath(normalizePath(row.path || "/"))}
                          title={String(row.path || "/")}
                        >
                          {row.name}
                        </button>
                        <span>{formatBytes(row.bytes)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="cavcloud-empty">No folder usage yet.</div>
                )}
              </div>
            </>
          ) : (
            <div className="cavcloud-empty">Storage unavailable.</div>
          )}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavcloud-opActivity" aria-label="Activity feed">
          <div className="cavcloud-homeTitleRow">
            <select
              className="cavcloud-paneTitleSelect cavcloud-opFilterSelect"
              aria-label="Activity filter"
              value={activityFilter}
              onChange={(event) => setActivityFilter(event.target.value as "all" | "uploads" | "shares" | "publish")}
            >
              <option value="all">Activity Feed</option>
              <option value="uploads">Uploads</option>
              <option value="shares">Shares</option>
              <option value="publish">Publish</option>
            </select>
            <button className="cavcloud-homeSeeAll" type="button" disabled={isBusy} onClick={() => onOpenSection("Recents")}>View all</button>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
              <div className="cavcloud-opSkeleton h40" />
            </div>
          ) : filteredActivity.length ? (
            <div className="cavcloud-opActivityList">
              {filteredActivity.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="cavcloud-opActivityItem"
                  disabled={isBusy}
                  onClick={() => void handleActivityClick(event)}
                  title={String(event.metaSafe?.path || "")}
                >
                  <span className="cavcloud-opEllipsis">{event.label}</span>
                  <span>{formatTimestamp(event.createdAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="cavcloud-empty">No matching events.</div>
          )}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavcloud-opShares" aria-label="Shares and artifacts">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Shares &amp; Artifacts</div>
            <div className="cavcloud-opInlineActions">
              <button className="cavcloud-homeSeeAll" type="button" disabled={isBusy} onClick={onOpenArtifacts}>View artifacts</button>
            </div>
          </div>

          {showSkeleton ? (
            <div className="cavcloud-opSkeletonStack">
              <div className="cavcloud-opSkeleton h30" />
              <div className="cavcloud-opSkeleton h72" />
              <div className="cavcloud-opSkeleton h72" />
            </div>
          ) : sharesArtifacts ? (
            <>
              <div className="cavcloud-opMiniMetrics">
                <div className="cavcloud-opMiniMetric">
                  <span>Active shares</span>
                  <strong>{Math.max(0, Number(sharesArtifacts.activeSharesCount || 0))}</strong>
                </div>
                <div className="cavcloud-opMiniMetric">
                  <span>Expiring soon</span>
                  <strong>{sharesArtifacts.expiringSoon.length}</strong>
                </div>
                <div className="cavcloud-opMiniMetric">
                  <span>Recent artifacts</span>
                  <strong>{sharesArtifacts.recentArtifacts.length}</strong>
                </div>
              </div>

              <div className="cavcloud-opSplitColumns cavcloud-opSplitColumnsShares">
                <div className="cavcloud-opPanel">
                  <div className="cavcloud-homeTitle">Expiring soon</div>
                  {sharesArtifacts.expiringSoon.length ? (
                    <div className="cavcloud-opPanelList">
                      {sharesArtifacts.expiringSoon.map((row) => (
                        <button
                          key={row.shareId}
                          type="button"
                          className="cavcloud-opPanelRow cavcloud-opPanelRowLink cavcloud-opExpiryRow"
                          disabled={isBusy}
                          onClick={() => void openLinkedPath(row.label)}
                          title={row.label}
                        >
                          <span className="cavcloud-opExpiryStack">
                            <span className="cavcloud-opExpiryTitle">{row.label}</span>
                            <br />
                            <span className="cavcloud-opExpiryDate">{formatDate(row.expiresAt)}</span>
                            <br />
                            <span className="cavcloud-opExpiryTime">{formatTime(row.expiresAt)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No active expirations.</div>
                  )}
                </div>

                <div className="cavcloud-opPanel">
                  <div className="cavcloud-homeTitle">Recent artifacts</div>
                  {sharesArtifacts.recentArtifacts.length ? (
                    <div className="cavcloud-opPanelList">
                      {sharesArtifacts.recentArtifacts.map((row) => (
                        <button
                          key={row.artifactId}
                          type="button"
                          className="cavcloud-opPanelRow cavcloud-opPanelRowLink cavcloud-opArtifactRow"
                          disabled={isBusy || !String(row.sourcePath || "").trim()}
                          onClick={() => void openLinkedPath(String(row.sourcePath || ""))}
                          title={String(row.sourcePath || row.title)}
                        >
                          <div className="cavcloud-opArtifactMain">
                            <span className="cavcloud-opArtifactTitle">{row.title}</span>
                            {row.sourcePath ? <span className="cavcloud-opArtifactPath">{row.sourcePath}</span> : null}
                          </div>
                          <span className={`cavcloud-opArtifactVisibility is-${visibilityLabel(row.visibility).toLowerCase()}`}>{visibilityLabel(row.visibility)}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="cavcloud-opPanelEmpty">No artifacts yet.</div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="cavcloud-empty">Share data unavailable.</div>
          )}
        </section>

        <section className="cavcloud-homeCard cavcloud-opCard cavcloud-opUploads" aria-label="Upload and import queue">
          <div className="cavcloud-homeTitleRow">
            <div className="cavcloud-homeTitle">Upload / Import Queue</div>
            <div className="cavcloud-opInlineActions">
              {uploadsFailedCount > 0 ? (
                <button className="cavcloud-rowAction" type="button" disabled={isBusy} onClick={() => void onRetryAllFailed()}>Resume all</button>
              ) : null}
            </div>
          </div>

          <div className="cavcloud-opMiniMetrics">
            <div className="cavcloud-opMiniMetric">
              <span>In progress</span>
              <strong>{uploadsPendingCount}</strong>
            </div>
            <div className="cavcloud-opMiniMetric">
              <span>Failed</span>
              <strong>{uploadsFailedCount}</strong>
            </div>
            <div className="cavcloud-opMiniMetric">
              <span>Completed</span>
              <strong>{localDiagnostics.uploaded}</strong>
            </div>
          </div>

          <div className="cavcloud-opSplitColumns">
            <div className="cavcloud-opPanel">
              <div className="cavcloud-homeTitle">In progress</div>
              {hasInProgressUploads ? (
                <div className="cavcloud-opPanelList cavcloud-opQueueList">
                  {sessionUploads.map((session) => {
                    const progress = safeProgress(session.uploaded, session.discovered);
                    return (
                      <div key={session.sessionId} className="cavcloud-opQueueItem">
                        <div className="cavcloud-opQueueHead">
                          <span className="cavcloud-opEllipsis">{session.rootName}</span>
                          <span>{session.uploaded}/{Math.max(0, session.discovered)} ({progress}%)</span>
                        </div>
                        <div className="cavcloud-opProgress">
                          <span style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    );
                  })}

                  {localDiagnostics.discovered > 0 ? (
                    <div className="cavcloud-opQueueItem">
                      <div className="cavcloud-opQueueHead">
                        <span className="cavcloud-opEllipsis">Current folder session</span>
                        <span>{localDiagnostics.uploaded}/{localDiagnostics.discovered} ({safeProgress(localDiagnostics.uploaded, localDiagnostics.discovered)}%)</span>
                      </div>
                      <div className="cavcloud-opProgress">
                        <span style={{ width: `${safeProgress(localDiagnostics.uploaded, localDiagnostics.discovered)}%` }} />
                      </div>
                    </div>
                  ) : null}

                  {localUploadFiles.map((file) => (
                    <div key={file.id} className="cavcloud-opQueueItem">
                      <div className="cavcloud-opQueueHead">
                        <span className="cavcloud-opEllipsis">{file.name}</span>
                        <span>Uploading...</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cavcloud-opPanelEmpty">No active uploads.</div>
              )}
            </div>

            <div className="cavcloud-opPanel">
              <div className="cavcloud-homeTitle">Failed uploads</div>
              {folderUploadFailures.length ? (
                <div className="cavcloud-opPanelList cavcloud-opFailureList">
                  {folderUploadFailures.slice(0, 12).map((row) => {
                    const key = failureKey(row);
                    const isGoogleDrive = String(row.provider || "").toUpperCase() === "GOOGLE_DRIVE";
                    return (
                      <div key={key} className="cavcloud-opFailureRow">
                        <div className="cavcloud-opFailureBody">
                          <strong className="cavcloud-opEllipsis">{String(row.relPath || "Upload item")}</strong>
                          <span className="cavcloud-opEllipsis">{String(row.errorMessage || row.errorCode || "Upload failed")}</span>
                        </div>
                        <div className="cavcloud-opInlineActions">
                          <button className="cavcloud-rowAction" type="button" disabled={isBusy} onClick={() => void onRetryFailedItem(key)}>Retry</button>
                          {!isGoogleDrive ? (
                            <button className="cavcloud-rowAction" type="button" disabled={isBusy} onClick={() => onCancelFailedItem(key)}>Cancel</button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="cavcloud-opPanelEmpty">No failed uploads.</div>
              )}
            </div>
          </div>

          {localDiagnostics.uploaded > 0 ? (
            <div className="cavcloud-opSubsection">
              <button className="cavcloud-homeSeeAll" type="button" onClick={() => setCompletedOpen((value) => !value)}>
                {completedOpen ? "Hide" : "Show"} completed uploads
              </button>
              {completedOpen ? (
                <div className="cavcloud-opQueueMeta">
                  <span>{localDiagnostics.uploaded} completed</span>
                  <span>{localDiagnostics.missing} pending verification</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
