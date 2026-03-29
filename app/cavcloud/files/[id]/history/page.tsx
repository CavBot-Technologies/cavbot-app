"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React from "react";

import { CavCloudTextPreview } from "@/components/cavcloud/CavCloudTextPreview";
import { isTextLikeFile } from "@/lib/filePreview";

import "@/components/cavcloud/cavcloud-preview.css";
import "./history.css";

type FileMeta = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  sha256: string | null;
  versionNumber: number | null;
  bytes: number | null;
  updatedAtISO: string | null;
  createdAtISO: string | null;
};

type VersionRow = {
  id: string;
  versionNumber: number;
  sha256: string;
  bytes: number;
  createdByUserId: string | null;
  createdAtISO: string;
  restoredFromVersionId: string | null;
};

type VersionsResponse = {
  ok?: boolean;
  message?: string;
  versions?: VersionRow[];
  page?: number;
  limit?: number;
  hasMore?: boolean;
  canRestore?: boolean;
};

function bytesLabel(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unitIdx]}`;
}

function shortSha(value: string | null | undefined): string {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return "-";
  return `${sha.slice(0, 10)}...${sha.slice(-8)}`;
}

function dateLabel(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

export default function CavCloudFileHistoryPage() {
  const params = useParams<{ id?: string }>();
  const fileId = String(params?.id || "").trim();

  const [fileMeta, setFileMeta] = React.useState<FileMeta | null>(null);
  const [fileBusy, setFileBusy] = React.useState<boolean>(false);
  const [fileError, setFileError] = React.useState<string>("");

  const [versions, setVersions] = React.useState<VersionRow[]>([]);
  const [versionsBusy, setVersionsBusy] = React.useState<boolean>(false);
  const [versionsError, setVersionsError] = React.useState<string>("");
  const [versionsPage, setVersionsPage] = React.useState<number>(1);
  const [versionsHasMore, setVersionsHasMore] = React.useState<boolean>(false);
  const [canRestore, setCanRestore] = React.useState<boolean>(false);

  const [selectedVersionId, setSelectedVersionId] = React.useState<string>("");
  const [previewText, setPreviewText] = React.useState<string>("");
  const [previewBusy, setPreviewBusy] = React.useState<boolean>(false);
  const [previewError, setPreviewError] = React.useState<string>("");
  const [restoreBusyVersionId, setRestoreBusyVersionId] = React.useState<string>("");

  const selectedVersion = React.useMemo(
    () => versions.find((row) => row.id === selectedVersionId) || null,
    [versions, selectedVersionId],
  );

  const loadFileMeta = React.useCallback(async () => {
    if (!fileId) return;
    setFileBusy(true);
    setFileError("");
    try {
      const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(fileId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        file?: {
          id?: string;
          name?: string;
          path?: string;
          mimeType?: string;
          sha256?: string | null;
          versionNumber?: number | null;
          bytes?: number | null;
          updatedAtISO?: string | null;
          createdAtISO?: string | null;
        };
      } | null;

      if (!res.ok || !json?.ok || !json.file) {
        throw new Error(String(json?.message || "Failed to load file."));
      }

      const versionRaw = Number(json.file.versionNumber);
      const bytesRaw = Number(json.file.bytes);
      setFileMeta({
        id: String(json.file.id || fileId),
        name: String(json.file.name || "File"),
        path: String(json.file.path || "/"),
        mimeType: String(json.file.mimeType || "application/octet-stream"),
        sha256: String(json.file.sha256 || "").trim() || null,
        versionNumber: Number.isFinite(versionRaw) && versionRaw > 0 ? Math.trunc(versionRaw) : null,
        bytes: Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.trunc(bytesRaw) : null,
        updatedAtISO: String(json.file.updatedAtISO || "").trim() || null,
        createdAtISO: String(json.file.createdAtISO || "").trim() || null,
      });
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Failed to load file.");
      setFileMeta(null);
    } finally {
      setFileBusy(false);
    }
  }, [fileId]);

  const loadVersions = React.useCallback(async (page: number) => {
    if (!fileId) return;
    setVersionsBusy(true);
    setVersionsError("");
    try {
      const res = await fetch(
        `/api/cavcloud/files/${encodeURIComponent(fileId)}/versions?limit=24&page=${encodeURIComponent(String(page))}`,
        { method: "GET", cache: "no-store" },
      );
      const json = (await res.json().catch(() => null)) as VersionsResponse | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to load versions."));
      }

      const rows = Array.isArray(json.versions) ? json.versions : [];
      setVersions(rows);
      setVersionsHasMore(Boolean(json.hasMore));
      setCanRestore(Boolean(json.canRestore));
      setVersionsPage(Math.max(1, Number(json.page || page) || page));

      if (!rows.length) {
        setSelectedVersionId("");
      } else if (!rows.some((row) => row.id === selectedVersionId)) {
        setSelectedVersionId(rows[0].id);
      }
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : "Failed to load versions.");
      setVersions([]);
      setVersionsHasMore(false);
      setSelectedVersionId("");
    } finally {
      setVersionsBusy(false);
    }
  }, [fileId, selectedVersionId]);

  React.useEffect(() => {
    if (!fileId) return;
    void loadFileMeta();
    void loadVersions(1);
  }, [fileId, loadFileMeta, loadVersions]);

  React.useEffect(() => {
    if (!fileId || !selectedVersion) {
      setPreviewText("");
      setPreviewError("");
      setPreviewBusy(false);
      return;
    }

    const name = String(fileMeta?.name || "").trim();
    const mimeType = String(fileMeta?.mimeType || "").trim();
    if (!isTextLikeFile(name, mimeType)) {
      setPreviewText("");
      setPreviewBusy(false);
      setPreviewError("");
      return;
    }

    let alive = true;
    const ctrl = new AbortController();
    setPreviewBusy(true);
    setPreviewError("");

    void fetch(
      `/api/cavcloud/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(selectedVersion.id)}?raw=1`,
      {
        method: "GET",
        cache: "no-store",
        signal: ctrl.signal,
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load version content.");
        const text = await res.text();
        if (!alive) return;
        setPreviewText(text);
      })
      .catch((err) => {
        if (!alive) return;
        setPreviewText("");
        setPreviewError(err instanceof Error ? err.message : "Failed to load version content.");
      })
      .finally(() => {
        if (!alive) return;
        setPreviewBusy(false);
      });

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [fileId, fileMeta?.mimeType, fileMeta?.name, selectedVersion]);

  const restoreVersion = React.useCallback(async (versionId?: string) => {
    const targetVersionId = String(versionId || selectedVersion?.id || "").trim();
    if (!fileId || !targetVersionId || !canRestore) return;
    setRestoreBusyVersionId(targetVersionId);
    setVersionsError("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const currentSha = String(fileMeta?.sha256 || "").trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(currentSha)) {
        headers["If-Match"] = `"${currentSha}"`;
      }
      const res = await fetch(
        `/api/cavcloud/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(targetVersionId)}/restore`,
        {
          method: "POST",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            baseSha256: /^[a-f0-9]{64}$/.test(currentSha) ? currentSha : undefined,
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to restore version."));
      }

      await Promise.all([loadFileMeta(), loadVersions(1)]);
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : "Failed to restore version.");
    } finally {
      setRestoreBusyVersionId("");
    }
  }, [canRestore, fileId, fileMeta?.sha256, loadFileMeta, loadVersions, selectedVersion?.id]);

  const isTextualFile = React.useMemo(
    () => isTextLikeFile(String(fileMeta?.name || ""), String(fileMeta?.mimeType || "")),
    [fileMeta?.mimeType, fileMeta?.name],
  );

  const currentVersionNumber = fileMeta?.versionNumber ?? null;
  const selectedIsCurrent = selectedVersion && currentVersionNumber != null
    ? selectedVersion.versionNumber === currentVersionNumber
    : false;

  return (
    <div className="cc-historyRoot">
      <header className="cc-historyHead">
        <div>
          <div className="cc-historyBreadcrumb">
            <Link href="/cavcloud" className="cc-historyHeadLink">CavCloud</Link>
            <span aria-hidden="true">/</span>
            <span>Version History</span>
          </div>
          <h1 className="cc-historyTitle">{fileMeta?.name || "Version history"}</h1>
          <div className="cc-historySub">{fileMeta?.path || "/"}</div>
        </div>
        <div className="cc-historyHeadActions">
          <Link href={`/cavcloud/view/${encodeURIComponent(fileId)}?source=file`} className="cc-previewActionBtn">
            Open file
          </Link>
          <Link href="/cavcloud" className="cc-previewActionBtn">
            Back
          </Link>
        </div>
      </header>

      {fileError ? <div className="cc-historyError">{fileError}</div> : null}
      <div className="cc-historyBody">
        <aside className="cc-historyListCard">
          <div className="cc-historyListHead">
            <div className="cc-historySectionTitle">Versions</div>
            <div className="cc-historySectionMeta">
              {fileBusy ? "Loading file…" : currentVersionNumber ? `Current v${currentVersionNumber}` : "Current version unknown"}
            </div>
          </div>
          <div className="cc-historyVersionList" aria-label="Version list">
            {versionsBusy && !versions.length ? <div className="cc-previewVersionEmpty">Loading versions...</div> : null}
            {versionsError ? <div className="cc-previewVersionError">{versionsError}</div> : null}
            {!versionsBusy && !versionsError && !versions.length ? (
              <div className="cc-previewVersionEmpty">No versions found.</div>
            ) : null}
            {versions.map((row) => {
              const isActive = row.id === selectedVersionId;
              const isCurrent = currentVersionNumber != null && row.versionNumber === currentVersionNumber;
              const restoreBusy = restoreBusyVersionId === row.id;
              return (
                <div key={row.id} className={`cc-previewVersionRow cc-historyVersionRow ${isActive ? "is-active" : ""}`.trim()}>
                  <button
                    type="button"
                    className="cc-historyVersionPick"
                    onClick={() => setSelectedVersionId(row.id)}
                    aria-pressed={isActive}
                  >
                    <div className="cc-previewVersionMeta">
                      <div className="cc-previewVersionTitle">
                        {`v${row.versionNumber}`}
                        {isCurrent ? " (current)" : ""}
                      </div>
                      <div className="cc-previewVersionSub">
                        {dateLabel(row.createdAtISO)}
                        {" · "}
                        {bytesLabel(row.bytes)}
                        {" · "}
                        {shortSha(row.sha256)}
                        {row.restoredFromVersionId ? " · restored" : ""}
                      </div>
                    </div>
                  </button>
                  <div className="cc-historyVersionActions">
                    {canRestore && !isCurrent ? (
                      <button
                        type="button"
                        className="cc-previewActionBtn"
                        onClick={() => void restoreVersion(row.id)}
                        disabled={Boolean(restoreBusyVersionId)}
                      >
                        {restoreBusy ? "Restoring..." : "Restore"}
                      </button>
                    ) : null}
                    <a
                      className="cc-previewActionBtn"
                      href={`/api/cavcloud/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(row.id)}?raw=1&download=1`}
                    >
                      Download
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="cc-historyPager">
            <button
              type="button"
              className="cc-previewActionBtn"
              onClick={() => void loadVersions(Math.max(1, versionsPage - 1))}
              disabled={versionsBusy || versionsPage <= 1}
            >
              Previous
            </button>
            <span className="cc-historyPagerMeta">{`Page ${versionsPage}`}</span>
            <button
              type="button"
              className="cc-previewActionBtn"
              onClick={() => void loadVersions(versionsPage + 1)}
              disabled={versionsBusy || !versionsHasMore}
            >
              Next
            </button>
          </div>
        </aside>

        <section className="cc-historyViewerCard">
          <div className="cc-historyViewerHead">
            <div className="cc-historySectionTitle">Preview</div>
            <div className="cc-historySectionMeta">
              {selectedVersion ? `${selectedVersion.versionNumber === currentVersionNumber ? "Current" : "Historical"} version` : "Select a version"}
            </div>
          </div>
          <div className="cc-historyViewerCanvas">
            {!selectedVersion ? <div className="cc-previewVersionEmpty">Select a version to preview.</div> : null}
            {selectedVersion && !isTextualFile ? (
              <div className="cc-previewUnavailable">
                <div className="cc-previewUnavailableText">Inline preview is available for text/code files.</div>
                <div className="cc-previewUnavailableActions">
                  <a
                    className="cc-previewActionBtn"
                    href={`/api/cavcloud/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(selectedVersion.id)}?raw=1&download=1`}
                  >
                    Download version
                  </a>
                </div>
              </div>
            ) : null}
            {selectedVersion && isTextualFile && previewBusy ? (
              <div className="cc-previewVersionEmpty">Loading version preview...</div>
            ) : null}
            {selectedVersion && isTextualFile && previewError ? (
              <div className="cc-previewVersionError">{previewError}</div>
            ) : null}
            {selectedVersion && isTextualFile && !previewBusy && !previewError ? (
              <CavCloudTextPreview text={previewText} wrap={false} showGrid={false} />
            ) : null}
          </div>
          {selectedVersion ? (
            <div className="cc-historyViewerFoot">
              <div className="cc-historyViewerFootMeta">
                {`v${selectedVersion.versionNumber} · ${dateLabel(selectedVersion.createdAtISO)} · ${bytesLabel(selectedVersion.bytes)} · ${shortSha(selectedVersion.sha256)}`}
              </div>
              {canRestore && !selectedIsCurrent ? (
                <button
                  type="button"
                  className="cc-previewActionBtn cc-previewActionBtnSave"
                  onClick={() => void restoreVersion(selectedVersion.id)}
                  disabled={Boolean(restoreBusyVersionId)}
                >
                  {restoreBusyVersionId === selectedVersion.id ? "Restoring..." : "Restore this version"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
