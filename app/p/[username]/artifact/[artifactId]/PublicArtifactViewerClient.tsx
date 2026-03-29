"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React from "react";

import { CavCloudPreviewPanel } from "@/components/cavcloud/CavCloudPreviewPanel";
import type { CavCloudPreviewItem, CavCloudPreviewKind } from "@/components/cavcloud/preview.types";

import "./artifact-viewer.css";

type PublicArtifactViewerClientProps = {
  username: string;
  artifactId: string;
  title: string;
  type: string;
  sourcePath: string;
  mimeType: string;
  sizeBytes: number | null;
  isOwner: boolean;
  rootPath: string;
};

type BrowseFolder = {
  id: string;
  name: string;
  path: string;
  rootPath: string;
};

type BrowseBreadcrumb = {
  id: string;
  name: string;
  path: string;
  isRoot: boolean;
};

type BrowseFolderItem = {
  id: string;
  name: string;
  path: string;
  updatedAtISO: string;
};

type BrowseFileItem = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  bytes: number | null;
  previewKind: CavCloudPreviewKind;
  updatedAtISO: string;
};

type BrowseResponse = {
  ok: boolean;
  mode: "folder" | "file";
  folder?: BrowseFolder;
  breadcrumbs?: BrowseBreadcrumb[];
  folders?: BrowseFolderItem[];
  files?: BrowseFileItem[];
};

type ActionTarget =
  | {
      kind: "artifact";
    }
  | {
      kind: "folder";
      item: BrowseFolderItem;
    }
  | {
      kind: "file";
      item: BrowseFileItem;
    };

function normalizePath(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "/";
  const withLeadingSlash = input.startsWith("/") ? input : `/${input}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  if (collapsed.length > 1 && collapsed.endsWith("/")) return collapsed.slice(0, -1);
  return collapsed || "/";
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

function inferPreviewKind(mimeType: string, fileName: string): CavCloudPreviewKind {
  const mime = String(mimeType || "").trim().toLowerCase();
  const lowerName = String(fileName || "").trim().toLowerCase();
  const extIdx = lowerName.lastIndexOf(".");
  const ext = extIdx >= 0 ? lowerName.slice(extIdx + 1) : "";

  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "application/yaml"
  ) {
    if (["md", "json", "html", "css", "js", "ts", "tsx", "jsx", "xml", "yml", "yaml"].includes(ext)) return "code";
    return "text";
  }
  if (["png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "bmp", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "m4v", "webm", "ogv"].includes(ext)) return "video";
  if (["md", "json", "html", "css", "js", "ts", "tsx", "jsx", "xml", "yml", "yaml"].includes(ext)) return "code";
  if (["txt", "csv", "log"].includes(ext)) return "text";
  return "unknown";
}

function nowIsoSafe(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function filePreviewItem(args: {
  username: string;
  artifactId: string;
  filePath: string;
  name: string;
  mimeType: string;
  bytes: number | null;
  previewKind: CavCloudPreviewKind;
  updatedAtISO?: string | null;
}): CavCloudPreviewItem {
  const query = new URLSearchParams();
  query.set("username", args.username);
  query.set("path", args.filePath);
  const rawSrc = `/api/public/artifacts/${encodeURIComponent(args.artifactId)}/file?${query.toString()}`;
  const downloadQuery = new URLSearchParams(query);
  downloadQuery.set("download", "1");

  const openQuery = new URLSearchParams();
  openQuery.set("path", args.filePath);

  return {
    id: `artifact:${args.artifactId}:${args.filePath}`,
    resourceId: args.artifactId,
    source: "artifact",
    previewKind: args.previewKind,
    mediaKind: args.previewKind,
    name: args.name,
    path: args.filePath,
    mimeType: args.mimeType || "application/octet-stream",
    bytes: args.bytes,
    modifiedAtISO: nowIsoSafe(args.updatedAtISO),
    rawSrc,
    downloadSrc: `/api/public/artifacts/${encodeURIComponent(args.artifactId)}/file?${downloadQuery.toString()}`,
    openHref: `/p/${encodeURIComponent(args.username)}/artifact/${encodeURIComponent(args.artifactId)}?${openQuery.toString()}`,
  };
}

function parentFolder(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

export function PublicArtifactViewerClient(props: PublicArtifactViewerClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isFolderArtifact = String(props.type || "").trim().toUpperCase() === "FOLDER";
  const [currentPath, setCurrentPath] = React.useState<string>(() => {
    const fromQuery = String(searchParams.get("path") || "").trim();
    return normalizePath(fromQuery || props.rootPath || "/");
  });
  const [loading, setLoading] = React.useState<boolean>(isFolderArtifact);
  const [error, setError] = React.useState<string>("");
  const [folder, setFolder] = React.useState<BrowseFolder | null>(null);
  const [breadcrumbs, setBreadcrumbs] = React.useState<BrowseBreadcrumb[]>([]);
  const [folders, setFolders] = React.useState<BrowseFolderItem[]>([]);
  const [files, setFiles] = React.useState<BrowseFileItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [previewItem, setPreviewItem] = React.useState<CavCloudPreviewItem | null>(null);
  const [actionTarget, setActionTarget] = React.useState<ActionTarget | null>(null);
  const [ownerDeleteBusy, setOwnerDeleteBusy] = React.useState<boolean>(false);

  const rootPath = normalizePath(props.rootPath || "/");

  const syncUrlPath = React.useCallback((nextPath: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (isFolderArtifact) {
      if (nextPath && nextPath !== rootPath) url.searchParams.set("path", nextPath);
      else url.searchParams.delete("path");
    } else {
      url.searchParams.delete("path");
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [isFolderArtifact, rootPath]);

  const loadFolder = React.useCallback(async (nextPath: string) => {
    if (!isFolderArtifact) return;

    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      query.set("username", props.username);
      query.set("path", normalizePath(nextPath));
      const res = await fetch(
        `/api/public/artifacts/${encodeURIComponent(props.artifactId)}/browse?${query.toString()}`,
        { method: "GET", cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as BrowseResponse | null;
      if (!res.ok || !json?.ok || json.mode !== "folder" || !json.folder) {
        throw new Error("This folder is unavailable.");
      }

      setFolder(json.folder);
      setBreadcrumbs(Array.isArray(json.breadcrumbs) ? json.breadcrumbs : []);
      setFolders(Array.isArray(json.folders) ? json.folders : []);
      setFiles(Array.isArray(json.files) ? json.files : []);
      setCurrentPath(normalizePath(json.folder.path));
      syncUrlPath(json.folder.path);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load folder.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isFolderArtifact, props.artifactId, props.username, syncUrlPath]);

  React.useEffect(() => {
    if (!isFolderArtifact) return;
    void loadFolder(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFolderArtifact]);

  React.useEffect(() => {
    if (!isFolderArtifact) return;
    const fromQuery = String(searchParams.get("path") || "").trim();
    if (!fromQuery) return;
    const normalized = normalizePath(fromQuery);
    if (normalized === currentPath) return;
    setCurrentPath(normalized);
    void loadFolder(normalized);
  }, [currentPath, isFolderArtifact, loadFolder, searchParams]);

  React.useEffect(() => {
    if (isFolderArtifact) return;
    const filePath = normalizePath(props.sourcePath || "/");
    const item = filePreviewItem({
      username: props.username,
      artifactId: props.artifactId,
      filePath,
      name: basename(filePath) === "/" ? props.title : basename(filePath),
      mimeType: props.mimeType || "application/octet-stream",
      bytes: props.sizeBytes,
      previewKind: inferPreviewKind(props.mimeType, basename(filePath)),
    });
    setPreviewItem(item);
  }, [isFolderArtifact, props.artifactId, props.mimeType, props.sizeBytes, props.sourcePath, props.title, props.username]);

  const openFolder = React.useCallback((item: BrowseFolderItem) => {
    setPreviewItem(null);
    setSelectedId(item.id);
    setActionTarget(null);
    const next = normalizePath(item.path);
    setCurrentPath(next);
    void loadFolder(next);
  }, [loadFolder]);

  const openFile = React.useCallback((item: BrowseFileItem) => {
    setSelectedId(item.id);
    setActionTarget(null);
    setPreviewItem(filePreviewItem({
      username: props.username,
      artifactId: props.artifactId,
      filePath: normalizePath(item.path),
      name: item.name,
      mimeType: item.mimeType || "application/octet-stream",
      bytes: item.bytes,
      previewKind: item.previewKind || inferPreviewKind(item.mimeType, item.name),
      updatedAtISO: item.updatedAtISO,
    }));
  }, [props.artifactId, props.username]);

  const closePreview = React.useCallback(() => {
    setPreviewItem(null);
    syncUrlPath(currentPath);
  }, [currentPath, syncUrlPath]);

  const copyLink = React.useCallback(async () => {
    if (typeof window === "undefined") return;
    const href = window.location.href;
    if (!href) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
      }
    } catch {
      // Best effort only.
    }
  }, []);

  const downloadFile = React.useCallback((item: BrowseFileItem) => {
    const query = new URLSearchParams();
    query.set("username", props.username);
    query.set("path", normalizePath(item.path));
    query.set("download", "1");
    const href = `/api/public/artifacts/${encodeURIComponent(props.artifactId)}/file?${query.toString()}`;
    if (typeof window !== "undefined") window.location.assign(href);
  }, [props.artifactId, props.username]);

  const deleteArtifact = React.useCallback(async () => {
    if (!props.isOwner || ownerDeleteBusy) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Remove this artifact from your public profile?");
      if (!ok) return;
    }

    setOwnerDeleteBusy(true);
    try {
      const res = await fetch(`/api/cavcloud/artifacts/${encodeURIComponent(props.artifactId)}`, {
        method: "DELETE",
        cache: "no-store",
        headers: {
          "x-cavbot-csrf": "1",
        },
      });
      if (!res.ok) throw new Error("Failed to remove artifact.");
      router.push(`/${encodeURIComponent(props.username)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to remove artifact.";
      setError(message);
    } finally {
      setOwnerDeleteBusy(false);
      setActionTarget(null);
    }
  }, [ownerDeleteBusy, props.artifactId, props.isOwner, props.username, router]);

  const moveUp = React.useCallback(() => {
    if (!folder) return;
    const parent = parentFolder(folder.path);
    if (normalizePath(folder.rootPath) === normalizePath(folder.path)) return;
    setCurrentPath(parent);
    void loadFolder(parent);
  }, [folder, loadFolder]);

  const listEmpty = !loading && !error && folders.length === 0 && files.length === 0;
  const showingPreview = Boolean(previewItem);

  return (
    <main className="pav-page" aria-label="Public artifact viewer">
      <section className="pav-shell">
        <header className="pav-head">
          <div className="pav-headLeft">
            <Link className="pav-back" href={`/${encodeURIComponent(props.username)}`} aria-label={`Back to @${props.username}`}>
              Back to @{props.username}
            </Link>
            <h1 className="pav-title">{props.title}</h1>
            <div className="pav-subtitle">{isFolderArtifact ? "Public folder artifact" : "Public file artifact"}</div>
          </div>
          <div className="pav-headRight">
            {isFolderArtifact && folder && normalizePath(folder.path) !== normalizePath(folder.rootPath) ? (
              <button type="button" className="pav-btn" onClick={moveUp}>
                Up
              </button>
            ) : null}
            <button
              type="button"
              className="pav-iconBtn"
              aria-label="Artifact options"
              onClick={() => setActionTarget({ kind: "artifact" })}
            >
              &#8942;
            </button>
          </div>
        </header>

        {isFolderArtifact && breadcrumbs.length ? (
          <nav className="pav-breadcrumbs" aria-label="Folder breadcrumbs">
            {breadcrumbs.map((crumb) => (
              <button
                key={`${crumb.path}:${crumb.id}`}
                type="button"
                className={`pav-crumb ${normalizePath(crumb.path) === normalizePath(currentPath) ? "is-active" : ""}`}
                onClick={() => {
                  const next = normalizePath(crumb.path);
                  setCurrentPath(next);
                  void loadFolder(next);
                }}
              >
                {crumb.name}
              </button>
            ))}
          </nav>
        ) : null}

        {error ? <div className="pav-error">{error}</div> : null}

        {showingPreview && previewItem ? (
          <div className="pav-previewWrap">
            <CavCloudPreviewPanel
              item={previewItem}
              mode="page"
              onClose={closePreview}
              onOpen={() => {}}
              onCopyLink={copyLink}
              onShare={() => {}}
              canShare={false}
              canCopyLink={true}
              allowEditing={false}
            />
          </div>
        ) : (
          <div className="pav-body">
            {loading ? <div className="pav-loading">Loading files…</div> : null}
            {listEmpty ? <div className="pav-empty">No files in this folder.</div> : null}

            {folders.length || files.length ? (
              <div className="pav-grid" role="list" aria-label="Artifact items">
                {folders.map((item) => (
                  <div
                    key={`folder:${item.id}`}
                    role="listitem"
                    className={`pav-item ${selectedId === item.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => openFolder(item)}
                  >
                    <button
                      type="button"
                      className="pav-itemMenu"
                      aria-label={`Options for ${item.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setActionTarget({ kind: "folder", item });
                      }}
                    >
                      &#8942;
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/folder-svgrepo-com.svg" alt="" className="pav-itemIcon" />
                    <div className="pav-itemName" title={item.name}>{item.name}</div>
                  </div>
                ))}

                {files.map((item) => (
                  <div
                    key={`file:${item.id}`}
                    role="listitem"
                    className={`pav-item ${selectedId === item.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => openFile(item)}
                  >
                    <button
                      type="button"
                      className="pav-itemMenu"
                      aria-label={`Options for ${item.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setActionTarget({ kind: "file", item });
                      }}
                    >
                      &#8942;
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icons/file-2-svgrepo-com.svg" alt="" className="pav-itemIcon" />
                    <div className="pav-itemName" title={item.name}>{item.name}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {actionTarget ? (
        <div
          className="pav-modalBackdrop"
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setActionTarget(null);
          }}
        >
          <div className="pav-modal">
            <div className="pav-modalTitle">Options</div>

            {actionTarget.kind === "folder" ? (
              <button type="button" className="pav-modalBtn" onClick={() => openFolder(actionTarget.item)}>
                Open folder
              </button>
            ) : null}

            {actionTarget.kind === "file" ? (
              <>
                <button type="button" className="pav-modalBtn" onClick={() => openFile(actionTarget.item)}>
                  Open file
                </button>
                <button type="button" className="pav-modalBtn" onClick={() => downloadFile(actionTarget.item)}>
                  Download file
                </button>
              </>
            ) : null}

            {actionTarget.kind === "artifact" && !showingPreview && !isFolderArtifact ? (
              <button
                type="button"
                className="pav-modalBtn"
                onClick={() => {
                  if (!isFolderArtifact) {
                    const item = filePreviewItem({
                      username: props.username,
                      artifactId: props.artifactId,
                      filePath: normalizePath(props.sourcePath || "/"),
                      name: basename(props.sourcePath || "/"),
                      mimeType: props.mimeType || "application/octet-stream",
                      bytes: props.sizeBytes,
                      previewKind: inferPreviewKind(props.mimeType, props.sourcePath),
                    });
                    setPreviewItem(item);
                  }
                  setActionTarget(null);
                }}
              >
                Open artifact
              </button>
            ) : null}

            {props.isOwner ? (
              <button
                type="button"
                className="pav-modalBtn is-danger"
                onClick={() => void deleteArtifact()}
                disabled={ownerDeleteBusy}
              >
                {ownerDeleteBusy ? "Removing..." : "Remove from public profile"}
              </button>
            ) : null}

            <button type="button" className="pav-modalBtn" onClick={() => setActionTarget(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
