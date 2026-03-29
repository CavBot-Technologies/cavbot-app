"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { CavCloudPreviewPanel } from "@/components/cavcloud/CavCloudPreviewPanel";
import type { CavCloudPreviewItem, CavCloudPreviewKind, CavCloudPreviewSource } from "@/components/cavcloud/preview.types";
import { copyTextToClipboard } from "@/lib/clipboard";

import "./viewer.css";

const PREVIEW_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg", "avif", "gif"]);
const PREVIEW_VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const PREVIEW_TEXT_EXTENSIONS = new Set(["txt", "csv", "xml", "log", "yml", "yaml"]);
const PREVIEW_CODE_EXTENSIONS = new Set(["md", "json", "html", "css", "js", "ts", "tsx", "jsx"]);
const PREVIEW_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/avif", "image/gif"]);
const PREVIEW_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/ogg"]);
const PREVIEW_TEXT_MIME_TYPES = new Set(["text/plain", "text/csv", "text/xml", "application/xml"]);
const PREVIEW_CODE_MIME_TYPES = new Set([
  "text/markdown",
  "application/json",
  "text/html",
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/typescript",
  "text/typescript",
]);
type TreeFileItem = {
  id?: string | null;
  name?: string | null;
  path?: string | null;
  mimeType?: string | null;
  bytes?: number | null;
  createdAtISO?: string | null;
  updatedAtISO?: string | null;
};

type ViewerToast = {
  id: string;
  tone: "good" | "bad" | "watch";
  text: string;
};

function fileExtension(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return "";
  return raw.slice(idx + 1);
}

function inferMimeType(name: string): string {
  const ext = fileExtension(name);
  if (!ext) return "application/octet-stream";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "avif") return "image/avif";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  if (ext === "ogv") return "video/ogg";
  if (ext === "txt" || ext === "log") return "text/plain";
  if (ext === "md") return "text/markdown";
  if (ext === "json") return "application/json";
  if (ext === "csv") return "text/csv";
  if (ext === "xml") return "application/xml";
  if (ext === "yml" || ext === "yaml") return "application/yaml";
  if (ext === "html" || ext === "htm") return "text/html";
  if (ext === "css") return "text/css";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "application/javascript";
  if (ext === "ts" || ext === "tsx") return "application/typescript";
  if (ext === "jsx") return "text/javascript";
  return "application/octet-stream";
}

function normalizeMime(mimeType: string, fileName: string): string {
  const direct = String(mimeType || "").trim().toLowerCase();
  if (direct && direct !== "application/octet-stream") return direct;
  return inferMimeType(fileName);
}

function previewKind(
  mimeType: string,
  fileName: string,
  forcedKind?: string | null
): CavCloudPreviewKind {
  const direct = String(forcedKind || "").trim().toLowerCase();
  if (direct === "image" || direct === "video" || direct === "text" || direct === "code" || direct === "unknown") {
    return direct;
  }
  const mime = normalizeMime(mimeType, fileName);
  const ext = fileExtension(fileName);

  if (PREVIEW_IMAGE_MIME_TYPES.has(mime) || PREVIEW_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (PREVIEW_VIDEO_MIME_TYPES.has(mime) || PREVIEW_VIDEO_EXTENSIONS.has(ext)) return "video";
  if (PREVIEW_CODE_MIME_TYPES.has(mime) || PREVIEW_CODE_EXTENSIONS.has(ext)) return "code";
  if (mime.startsWith("text/") || PREVIEW_TEXT_MIME_TYPES.has(mime) || PREVIEW_TEXT_EXTENSIONS.has(ext)) return "text";
  return "unknown";
}

function parseSource(raw: string | null): CavCloudPreviewSource {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "artifact") return "artifact";
  if (value === "trash") return "trash";
  if (value === "by_path") return "by_path";
  return "file";
}

function toNumberOrNull(raw: string | null): number | null {
  if (raw == null) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.trunc(num);
}

function resolveUploaderLabel(opts: { name?: string | null; email?: string | null; username?: string | null }): string {
  const name = String(opts.name || "").trim();
  if (name) return name;
  const email = String(opts.email || "").trim();
  if (email) return email;
  const username = String(opts.username || "").trim();
  if (username) return username;
  return "CavSafe user";
}

function previewRawSrc(source: CavCloudPreviewSource, resourceId: string, byPath: string): string {
  if (source === "artifact") {
    return `/api/cavsafe/artifacts/${encodeURIComponent(resourceId)}/preview?raw=1`;
  }
  if (source === "trash") {
    return `/api/cavsafe/trash/${encodeURIComponent(resourceId)}?raw=1`;
  }
  if (source === "by_path") {
    return `/api/cavsafe/files/by-path?path=${encodeURIComponent(byPath)}&raw=1`;
  }
  return `/api/cavsafe/files/${encodeURIComponent(resourceId)}?raw=1`;
}

function normalizePath(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function parentFolderPath(rawPath: string): string {
  const normalized = normalizePath(rawPath);
  if (normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join("/")}` : "/";
}

function buildViewerHref(args: {
  resourceId: string;
  source: CavCloudPreviewSource;
  kind: CavCloudPreviewKind;
  name: string;
  path: string;
  mimeType: string;
  bytes: number | null;
  createdAtISO?: string | null;
  modifiedAtISO?: string | null;
  uploadedAtISO?: string | null;
  uploadedBy?: string | null;
  shareUrl?: string | null;
  shareFileId?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("source", args.source);
  params.set("kind", args.kind);
  params.set("name", args.name);
  params.set("path", args.path);
  params.set("mime", args.mimeType);
  if (args.bytes != null && Number.isFinite(args.bytes)) params.set("bytes", String(Math.max(0, Math.trunc(args.bytes))));
  if (args.createdAtISO) params.set("created", args.createdAtISO);
  if (args.modifiedAtISO) params.set("modified", args.modifiedAtISO);
  if (args.uploadedAtISO) params.set("uploaded", args.uploadedAtISO);
  if (args.uploadedBy) params.set("uploadedBy", args.uploadedBy);
  if (args.shareUrl) params.set("shareUrl", args.shareUrl);
  if (args.shareFileId) params.set("shareFileId", args.shareFileId);
  return `/cavsafe/view/${encodeURIComponent(args.resourceId)}?${params.toString()}`;
}

export default function CavSafeFileViewerPage() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const searchParams = useSearchParams();

  const resourceId = String(params?.id || "").trim();
  const source = parseSource(searchParams.get("source"));
  const kindParam = String(searchParams.get("kind") || "").trim().toLowerCase();
  const toolParamRaw = String(searchParams.get("tool") || "").trim().toLowerCase();
  const autoEditTool: "adjust" | "crop" | null =
    toolParamRaw === "crop" ? "crop" : toolParamRaw === "adjust" ? "adjust" : null;
  const autoEdit = searchParams.get("edit") === "1" || autoEditTool !== null;

  const [resolvedName, setResolvedName] = React.useState<string>("");
  const [resolvedPath, setResolvedPath] = React.useState<string>("");
  const [resolvedMime, setResolvedMime] = React.useState<string>("");
  const [resolvedBytes, setResolvedBytes] = React.useState<number | null>(null);
  const [resolvedCreatedAt, setResolvedCreatedAt] = React.useState<string>("");
  const [resolvedModifiedAt, setResolvedModifiedAt] = React.useState<string>("");
  const [resolvedUploadedBy, setResolvedUploadedBy] = React.useState<string>("");
  const [folderImageItems, setFolderImageItems] = React.useState<CavCloudPreviewItem[]>([]);
  const [activeFolderResourceId, setActiveFolderResourceId] = React.useState<string>("");
  const [toasts, setToasts] = React.useState<ViewerToast[]>([]);
  const [copyLinkModalOpen, setCopyLinkModalOpen] = React.useState(false);
  const [copyLinkModalValue, setCopyLinkModalValue] = React.useState("");
  const [copyLinkModalCopying, setCopyLinkModalCopying] = React.useState(false);
  const copyLinkModalInputRef = React.useRef<HTMLTextAreaElement | null>(null);

  const byPath = String(searchParams.get("path") || "").trim();
  const name = String(searchParams.get("name") || resolvedName || resourceId || "File").trim();
  const path = String(searchParams.get("path") || resolvedPath || `/${name}`).trim();
  const mimeType = String(searchParams.get("mime") || resolvedMime || "").trim();
  const bytes = toNumberOrNull(searchParams.get("bytes")) ?? resolvedBytes;
  const createdAtISO = String(searchParams.get("created") || resolvedCreatedAt || "").trim() || null;
  const modifiedAtISO = String(searchParams.get("modified") || resolvedModifiedAt || "").trim() || null;
  const uploadedByParam = String(searchParams.get("uploadedBy") || "").trim();
  const uploadedBy = uploadedByParam || resolvedUploadedBy || "CavSafe user";
  const shareUrl = String(searchParams.get("shareUrl") || "").trim() || null;
  const shareFileId = String(searchParams.get("shareFileId") || "").trim() || null;

  const pushToast = React.useCallback((tone: ViewerToast["tone"], text: string) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, tone, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2600);
  }, []);
  const openCopyLinkModal = React.useCallback((value: string) => {
    const next = String(value || "").trim();
    if (!next) return;
    setCopyLinkModalValue(next);
    setCopyLinkModalCopying(false);
    setCopyLinkModalOpen(true);
  }, []);
  const closeCopyLinkModal = React.useCallback(() => {
    setCopyLinkModalOpen(false);
    setCopyLinkModalCopying(false);
  }, []);
  const copyFromCopyLinkModal = React.useCallback(async () => {
    const value = String(copyLinkModalValue || "").trim();
    if (!value) return;
    setCopyLinkModalCopying(true);
    try {
      const copied = await copyTextToClipboard(value);
      if (!copied) {
        return;
      }
      pushToast("good", "Link copied.");
      setCopyLinkModalOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to copy link.";
      pushToast("bad", msg);
    } finally {
      setCopyLinkModalCopying(false);
    }
  }, [copyLinkModalValue, pushToast]);

  React.useEffect(() => {
    if (!copyLinkModalOpen) return;
    const node = copyLinkModalInputRef.current;
    if (!node) return;
    const id = window.setTimeout(() => {
      node.focus();
      node.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [copyLinkModalOpen]);

  React.useEffect(() => {
    if (!copyLinkModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeCopyLinkModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCopyLinkModal, copyLinkModalOpen]);

  React.useEffect(() => {
    if (!resourceId || source !== "file") return;
    const hasEnough = Boolean(searchParams.get("name") && searchParams.get("mime") && searchParams.get("bytes"));
    if (hasEnough) return;

    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/cavsafe/files/${encodeURIComponent(resourceId)}`, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null) as { file?: {
          name?: string;
          path?: string;
          mimeType?: string;
          bytes?: number;
          createdAtISO?: string;
          updatedAtISO?: string;
        } } | null;
        if (!alive || !res.ok || !json?.file) return;
        setResolvedName(String(json.file.name || ""));
        setResolvedPath(String(json.file.path || ""));
        setResolvedMime(String(json.file.mimeType || ""));
        setResolvedBytes(Number.isFinite(Number(json.file.bytes)) ? Number(json.file.bytes) : null);
        setResolvedCreatedAt(String(json.file.createdAtISO || ""));
        setResolvedModifiedAt(String(json.file.updatedAtISO || ""));
      } catch {
        // Ignore metadata fallback errors.
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [resourceId, searchParams, source]);

  React.useEffect(() => {
    if (uploadedByParam) return;

    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        setResolvedUploadedBy(resolveUploaderLabel({
          name: data?.user?.displayName,
          email: data?.user?.email,
          username: data?.user?.username,
        }));
      } catch {
        if (!alive) return;
        setResolvedUploadedBy((prev) => prev || "CavSafe user");
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [uploadedByParam]);

  const mediaKind = React.useMemo<CavCloudPreviewKind>(() => {
    return previewKind(mimeType, name, kindParam);
  }, [kindParam, mimeType, name]);

  const baseItem = React.useMemo<CavCloudPreviewItem | null>(() => {
    if (!resourceId) return null;
    const itemPath = normalizePath(path || byPath || "/");
    const itemMime = normalizeMime(mimeType, name);
    const rawSrc = previewRawSrc(source, resourceId, itemPath);
    const downloadSrc = source === "artifact" || source === "file"
      ? `${rawSrc}&download=1`
      : rawSrc;
    return {
      id: `${source}:${resourceId}`,
      resourceId,
      source,
      previewKind: mediaKind,
      mediaKind,
      name,
      path: itemPath,
      mimeType: itemMime,
      bytes,
      createdAtISO,
      modifiedAtISO,
      uploadedAtISO: createdAtISO,
      uploadedBy,
      shareUrl,
      rawSrc,
      downloadSrc,
      openHref: buildViewerHref({
        resourceId,
        source,
        kind: mediaKind,
        name,
        path: itemPath,
        mimeType: itemMime,
        bytes,
        createdAtISO,
        modifiedAtISO,
        uploadedAtISO: createdAtISO,
        uploadedBy,
        shareUrl,
        shareFileId,
      }),
      shareFileId,
    };
  }, [byPath, bytes, createdAtISO, mediaKind, mimeType, name, path, resourceId, shareFileId, shareUrl, source, modifiedAtISO, uploadedBy]);

  const folderLookupPath = React.useMemo(() => {
    return String(searchParams.get("path") || resolvedPath || "").trim();
  }, [resolvedPath, searchParams]);
  const activePath = React.useMemo(() => normalizePath(folderLookupPath || path || byPath || "/"), [byPath, folderLookupPath, path]);
  const activeFolderPath = React.useMemo(() => parentFolderPath(activePath), [activePath]);

  React.useEffect(() => {
    if (mediaKind !== "image" || (source !== "file" && source !== "by_path")) {
      setFolderImageItems([]);
      setActiveFolderResourceId("");
      return;
    }
    if (!folderLookupPath) {
      setFolderImageItems([]);
      setActiveFolderResourceId("");
      return;
    }

    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(activeFolderPath)}`, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null) as { files?: TreeFileItem[] } | null;
        if (!alive || !res.ok || !Array.isArray(json?.files)) return;

        const nextItems: CavCloudPreviewItem[] = [];
        for (const row of json.files) {
          const fileId = String(row?.id || "").trim();
          const fileName = String(row?.name || "").trim();
          const filePath = normalizePath(String(row?.path || ""));
          if (!fileId || !fileName || !filePath) continue;

          const itemMime = normalizeMime(String(row?.mimeType || ""), fileName);
          if (previewKind(itemMime, fileName) !== "image") continue;

          const fileBytesRaw = Number(row?.bytes);
          const fileBytes = Number.isFinite(fileBytesRaw) && fileBytesRaw >= 0 ? Math.trunc(fileBytesRaw) : null;
          const itemCreatedAtISO = String(row?.createdAtISO || "").trim() || null;
          const itemModifiedAtISO = String(row?.updatedAtISO || "").trim() || null;
          const rawSrc = previewRawSrc("file", fileId, filePath);
          nextItems.push({
            id: `file:${fileId}`,
            resourceId: fileId,
            source: "file",
            previewKind: "image",
            mediaKind: "image",
            name: fileName,
            path: filePath,
            mimeType: itemMime,
            bytes: fileBytes,
            createdAtISO: itemCreatedAtISO,
            modifiedAtISO: itemModifiedAtISO,
            uploadedAtISO: itemCreatedAtISO,
            uploadedBy,
            shareUrl: null,
            rawSrc,
            downloadSrc: `${rawSrc}&download=1`,
            openHref: buildViewerHref({
              resourceId: fileId,
              source: "file",
              kind: "image",
              name: fileName,
              path: filePath,
              mimeType: itemMime,
              bytes: fileBytes,
              createdAtISO: itemCreatedAtISO,
              modifiedAtISO: itemModifiedAtISO,
              uploadedAtISO: itemCreatedAtISO,
              uploadedBy,
              shareFileId: fileId,
            }),
            shareFileId: fileId,
          });
        }

        if (!alive) return;
        setFolderImageItems(nextItems);
        const matchById = source === "file" ? nextItems.find((entry) => entry.resourceId === resourceId) : null;
        const matchByPath = nextItems.find((entry) => normalizePath(entry.path) === activePath) || null;
        const preferred = matchById || matchByPath;
        setActiveFolderResourceId((prev) => {
          if (preferred) return preferred.resourceId;
          if (prev && nextItems.some((entry) => entry.resourceId === prev)) return prev;
          return "";
        });
      } catch {
        if (!alive) return;
        setFolderImageItems([]);
        setActiveFolderResourceId("");
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [activeFolderPath, activePath, folderLookupPath, mediaKind, resourceId, source, uploadedBy]);

  const activeImageIndex = React.useMemo(() => {
    if (!folderImageItems.length) return -1;

    if (activeFolderResourceId) {
      const bySelected = folderImageItems.findIndex((entry) => entry.resourceId === activeFolderResourceId);
      if (bySelected >= 0) return bySelected;
    }

    if (source === "file") {
      const byIdParam = folderImageItems.findIndex((entry) => entry.resourceId === resourceId);
      if (byIdParam >= 0) return byIdParam;
    }

    return folderImageItems.findIndex((entry) => normalizePath(entry.path) === activePath);
  }, [activeFolderResourceId, activePath, folderImageItems, resourceId, source]);

  const item = activeImageIndex >= 0
    ? folderImageItems[activeImageIndex]
    : baseItem;

  const openImageIndex = React.useCallback((index: number) => {
    const next = folderImageItems[index];
    if (!next) return;
    setActiveFolderResourceId(next.resourceId);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", next.openHref);
    }
  }, [folderImageItems]);

  const goPrevImage = React.useCallback(() => {
    if (activeImageIndex <= 0) return;
    openImageIndex(activeImageIndex - 1);
  }, [activeImageIndex, openImageIndex]);

  const goNextImage = React.useCallback(() => {
    if (activeImageIndex < 0 || activeImageIndex >= folderImageItems.length - 1) return;
    openImageIndex(activeImageIndex + 1);
  }, [activeImageIndex, folderImageItems.length, openImageIndex]);

  const noopPagerAction = React.useCallback(() => {}, []);

  const imagePager = React.useMemo(() => {
    if (!item || item.mediaKind !== "image") return null;
    if (activeImageIndex >= 0 && folderImageItems.length) {
      return {
        index: activeImageIndex + 1,
        total: folderImageItems.length,
        canPrev: activeImageIndex > 0,
        canNext: activeImageIndex < folderImageItems.length - 1,
        onPrev: goPrevImage,
        onNext: goNextImage,
      };
    }
    return {
      index: 1,
      total: 1,
      canPrev: false,
      canNext: false,
      onPrev: noopPagerAction,
      onNext: noopPagerAction,
    };
  }, [activeImageIndex, folderImageItems.length, goNextImage, goPrevImage, item, noopPagerAction]);

  const copyLink = React.useCallback(async () => {
    if (!item) return;
    try {
      let link = String(item.shareUrl || "").trim();
      if (!link) {
        link = typeof window !== "undefined" ? window.location.href : "";
      }
      if (!link) {
        pushToast("watch", "Link unavailable for this item.");
        return;
      }

      const copied = await copyTextToClipboard(link);
      if (!copied) {
        openCopyLinkModal(link);
        return;
      }
      pushToast("good", "Link copied.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to copy link.";
      pushToast("bad", msg);
    }
  }, [item, openCopyLinkModal, pushToast]);

  return (
    <div className="cc-viewerRoot">
      <div className="cc-viewerBody">
        {item ? (
          <CavCloudPreviewPanel
            item={item}
            mode="page"
            onClose={() => {
              const folderPath = encodeURIComponent(parentFolderPath(normalizePath(item.path || `/${item.name}`)));
              router.push(`/cavsafe?folderPath=${folderPath}`);
            }}
            onOpen={() => {}}
            onCopyLink={copyLink}
            onShare={() => {}}
            canCopyLink={true}
            canShare={false}
            imagePager={imagePager}
            autoEdit={autoEdit}
            autoEditTool={autoEditTool}
            onOpenInCavCode={() => {
              const filePath = encodeURIComponent(normalizePath(item.path || `/${item.name}`));
              router.push(`/cavcode?cloud=1&file=${filePath}`);
            }}
          />
        ) : (
          <div className="cc-viewerEmpty">Preview unavailable. Use Open from CavSafe and try again.</div>
        )}
      </div>
      {toasts.length ? (
        <div className="cc-viewerToasts" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`cc-viewerToast is-${toast.tone}`}>
              {toast.text}
            </div>
          ))}
        </div>
      ) : null}
      {copyLinkModalOpen ? (
        <div
          className="cc-viewerModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cc-viewer-copy-link-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCopyLinkModal();
          }}
        >
          <div className="cc-viewerModalCard">
            <div className="cc-viewerModalHead">
              <h2 id="cc-viewer-copy-link-title" className="cc-viewerModalTitle">
                Copy link
              </h2>
              <button type="button" className="cc-viewerModalClose" onClick={closeCopyLinkModal} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cc-viewerModalBody">
              <p className="cc-viewerModalText">Clipboard access was blocked. Copy the link below.</p>
              <textarea
                ref={copyLinkModalInputRef}
                className="cc-viewerModalTextarea"
                value={copyLinkModalValue}
                readOnly
                spellCheck={false}
                aria-label="Share link"
              />
            </div>
            <div className="cc-viewerModalActions">
              <button type="button" className="cc-previewActionBtn" onClick={closeCopyLinkModal}>
                Close
              </button>
              <button
                type="button"
                className="cc-previewActionBtn cc-previewActionBtnSave"
                onClick={copyFromCopyLinkModal}
                disabled={copyLinkModalCopying}
              >
                {copyLinkModalCopying ? "Copying..." : "Copy link"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
