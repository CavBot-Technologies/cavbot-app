"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  isFolder: boolean;
  isGoogleNativeDoc: boolean;
  exportHint?: "PDF" | "XLSX";
};

type DriveListPayload = {
  ok?: boolean;
  folderId?: string;
  nextPageToken?: string | null;
  items?: DriveItem[];
  message?: string;
};

type DriveStatusPayload = {
  ok?: boolean;
  connected?: boolean;
  message?: string;
};

type CreateSessionPayload = {
  ok?: boolean;
  sessionId?: string;
  message?: string;
};

type Breadcrumb = {
  id: string | null;
  label: string;
};

type CavCloudGoogleDriveImportModalProps = {
  disabled?: boolean;
  targetFolderId: string | null;
  targetFolderPath: string;
  onClose: () => void;
  onSessionCreated: (sessionId: string) => void;
  onNotify: (tone: "good" | "watch" | "bad", message: string) => void;
};

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const rounded = amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

function selectionTypeFor(item: DriveItem): "file" | "folder" {
  return item.isFolder ? "folder" : "file";
}

export default function CavCloudGoogleDriveImportModal(props: CavCloudGoogleDriveImportModalProps) {
  const {
    disabled,
    targetFolderId,
    targetFolderPath,
    onClose,
    onSessionCreated,
    onNotify,
  } = props;

  const [statusLoading, setStatusLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [statusError, setStatusError] = useState("");

  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, label: "My Drive" }]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [pageStack, setPageStack] = useState<Array<string | null>>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");

  const [selection, setSelection] = useState<Record<string, "file" | "folder">>({});
  const [creatingSession, setCreatingSession] = useState(false);
  const compactLayout = statusLoading || !connected;

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id || null;

  const selectedItems = useMemo(() => {
    return Object.entries(selection).map(([id, type]) => ({ id, type }));
  }, [selection]);

  const selectedCount = selectedItems.length;

  const fetchConnectionStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError("");
    try {
      const response = await fetch("/api/integrations/google-drive/status", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as DriveStatusPayload | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.message || "Failed to check Google Drive connection."));
      }
      setConnected(Boolean(payload.connected));
    } catch (error) {
      setConnected(false);
      setStatusError(error instanceof Error ? error.message : "Failed to check Google Drive connection.");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchListing = useCallback(async (folderId: string | null, token: string | null) => {
    setListLoading(true);
    setListError("");

    try {
      const params = new URLSearchParams();
      if (folderId) params.set("folderId", folderId);
      if (token) params.set("pageToken", token);
      params.set("pageSize", "100");

      const response = await fetch(`/api/integrations/google-drive/list?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
      });
      const payload = (await response.json().catch(() => null)) as DriveListPayload | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.message || "Failed to load Google Drive folder."));
      }

      setItems(Array.isArray(payload.items) ? payload.items : []);
      setNextPageToken(payload.nextPageToken ? String(payload.nextPageToken) : null);
    } catch (error) {
      setItems([]);
      setNextPageToken(null);
      setListError(error instanceof Error ? error.message : "Failed to load Google Drive folder.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnectionStatus();
  }, [fetchConnectionStatus]);

  useEffect(() => {
    if (!connected) return;
    void fetchListing(currentFolderId, pageToken);
  }, [connected, currentFolderId, pageToken, fetchListing]);

  const openFolder = useCallback((item: DriveItem) => {
    if (!item.isFolder) return;
    setBreadcrumbs((previous) => [...previous, { id: item.id, label: item.name }]);
    setPageToken(null);
    setPageStack([]);
  }, []);

  const goToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs((previous) => previous.slice(0, Math.max(1, index + 1)));
    setPageToken(null);
    setPageStack([]);
  }, []);

  const goToNextPage = useCallback(() => {
    if (!nextPageToken) return;
    setPageStack((previous) => [...previous, pageToken]);
    setPageToken(nextPageToken);
  }, [nextPageToken, pageToken]);

  const goToPreviousPage = useCallback(() => {
    setPageStack((previous) => {
      if (!previous.length) return previous;
      const next = [...previous];
      const token = next.pop() ?? null;
      setPageToken(token);
      return next;
    });
  }, []);

  const toggleSelection = useCallback((item: DriveItem) => {
    const type = selectionTypeFor(item);
    setSelection((previous) => {
      const next = { ...previous };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = type;
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({});
  }, []);

  const startOauthConnect = useCallback(() => {
    window.location.assign("/api/integrations/google-drive/connect");
  }, []);

  const createImportSession = useCallback(async () => {
    if (!targetFolderId) {
      onNotify("watch", "Select a CavCloud destination folder before importing.");
      return;
    }
    if (!selectedItems.length) {
      onNotify("watch", "Select at least one Google Drive file or folder.");
      return;
    }

    setCreatingSession(true);
    try {
      const response = await fetch("/api/integrations/google-drive/import/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          targetFolderId,
          items: selectedItems,
          mode: "copy",
        }),
      });

      const payload = (await response.json().catch(() => null)) as CreateSessionPayload | null;
      if (!response.ok || !payload?.ok || !payload.sessionId) {
        throw new Error(String(payload?.message || "Failed to start Google Drive import."));
      }

      onSessionCreated(payload.sessionId);
      onNotify("good", "Google Drive import started.");
      onClose();
    } catch (error) {
      onNotify("bad", error instanceof Error ? error.message : "Failed to start Google Drive import.");
    } finally {
      setCreatingSession(false);
    }
  }, [onClose, onNotify, onSessionCreated, selectedItems, targetFolderId]);

  return (
    <div className="cavcloud-modal" role="dialog" aria-modal="true" aria-labelledby="cavcloud-google-drive-title" onClick={onClose}>
      <div
        className={`cavcloud-modalCard cavcloud-googleDriveModalCard${compactLayout ? " cavcloud-googleDriveModalCardCompact" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cavcloud-modalTitle" id="cavcloud-google-drive-title">Import from Google Drive</div>

        <div className="cavcloud-modalBody">
          {statusLoading ? (
            <div className="cavcloud-modalText">Checking Google Drive connection...</div>
          ) : !connected ? (
            <div className="cavcloud-googleDriveConnectState">
              <p className="cavcloud-modalText">Connect Google Drive to import files and folders into CavCloud.</p>
              {statusError ? <p className="cavcloud-modalText">{statusError}</p> : null}
              <div className="cavcloud-modalActions cavcloud-googleDriveConnectActions">
                <button className="cavcloud-rowAction" type="button" onClick={onClose} disabled={Boolean(disabled)}>Close</button>
                <button className="cavcloud-rowAction cavcloud-googleDriveConnectBtn" type="button" onClick={startOauthConnect} disabled={Boolean(disabled)}>Connect Google Drive</button>
              </div>
            </div>
          ) : (
            <div className="cavcloud-googleDriveBrowserWrap">
              <div className="cavcloud-googleDriveBrowserCols">
                <aside className="cavcloud-googleDriveSidebar" aria-label="Google Drive folders">
                  <div className="cavcloud-googleDriveSectionTitle">Folders</div>
                  <div className="cavcloud-googleDriveBreadcrumbs">
                    {breadcrumbs.map((crumb, index) => (
                      <button
                        key={`${crumb.id || "root"}_${index}`}
                        type="button"
                        className="cavcloud-homeSeeAll"
                        onClick={() => goToBreadcrumb(index)}
                        disabled={listLoading}
                      >
                        {crumb.label}
                      </button>
                    ))}
                  </div>

                  <div className="cavcloud-googleDriveFolderNav">
                    {items.filter((item) => item.isFolder).slice(0, 20).map((folder) => (
                      <button
                        key={folder.id}
                        className="cavcloud-opPanelRow cavcloud-opPanelRowLink"
                        type="button"
                        onClick={() => openFolder(folder)}
                        disabled={listLoading}
                        title={folder.name}
                      >
                        <span className="cavcloud-opEllipsis">{folder.name}</span>
                      </button>
                    ))}
                    {!items.some((item) => item.isFolder) ? (
                      <div className="cavcloud-opPanelEmpty">No subfolders in this location.</div>
                    ) : null}
                  </div>
                </aside>

                <section className="cavcloud-googleDriveMain" aria-label="Google Drive items">
                  <div className="cavcloud-googleDriveSectionHead">
                    <div className="cavcloud-googleDriveSectionTitle">Items</div>
                    <div className="cavcloud-opInlineActions">
                      <button className="cavcloud-rowAction" type="button" onClick={clearSelection} disabled={listLoading || !selectedCount}>Clear selection</button>
                    </div>
                  </div>

                  {listError ? <div className="cavcloud-empty">{listError}</div> : null}
                  {listLoading ? <div className="cavcloud-modalText">Loading Google Drive items...</div> : null}

                  {!listLoading ? (
                    <div className="cavcloud-googleDriveList">
                      {items.map((item) => (
                        <label key={item.id} className="cavcloud-googleDriveRow">
                          <input
                            type="checkbox"
                            className="cavcloud-googleDriveCheckbox"
                            checked={Boolean(selection[item.id])}
                            onChange={() => toggleSelection(item)}
                          />
                          <button
                            type="button"
                            className="cavcloud-googleDriveName"
                            onClick={() => openFolder(item)}
                            disabled={!item.isFolder}
                            title={item.name}
                          >
                            {item.name}
                          </button>
                          <span className="cavcloud-googleDriveMeta">{item.isFolder ? "Folder" : formatBytes(item.sizeBytes)}</span>
                          <span className="cavcloud-googleDriveMeta">{item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString() : "-"}</span>
                          <span className="cavcloud-googleDriveMeta">
                            {item.isGoogleNativeDoc && item.exportHint ? (
                              <span>
                                {item.exportHint === "PDF" ? "Google Doc/Slides -> PDF" : "Google Sheets -> XLSX"}
                              </span>
                            ) : "-"}
                          </span>
                        </label>
                      ))}
                      {!items.length && !listError ? <div className="cavcloud-opPanelEmpty">This folder is empty.</div> : null}
                    </div>
                  ) : null}

                  <div className="cavcloud-googleDrivePager">
                    <button className="cavcloud-rowAction" type="button" onClick={goToPreviousPage} disabled={listLoading || pageStack.length === 0}>Previous</button>
                    <button className="cavcloud-rowAction" type="button" onClick={goToNextPage} disabled={listLoading || !nextPageToken}>Next</button>
                  </div>
                </section>
              </div>

              <div className="cavcloud-googleDriveFooter">
                <div className="cavcloud-modalText">Destination: {targetFolderPath || "/"}</div>
                <div className="cavcloud-modalText">Selected items: {selectedCount}</div>
              </div>

              <div className="cavcloud-modalActions">
                <button className="cavcloud-rowAction" type="button" onClick={onClose} disabled={Boolean(disabled) || creatingSession}>Close</button>
                <button className="cavcloud-rowAction" type="button" onClick={createImportSession} disabled={Boolean(disabled) || creatingSession || !selectedCount || !targetFolderId}>
                  {creatingSession ? "Starting..." : "Import"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
