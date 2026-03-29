"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import React from "react";

import { CavCloudCollaborateModal } from "@/components/cavcloud/CavCloudCollaborateModal";
import { CavCloudTextEditor } from "@/components/cavcloud/CavCloudTextEditor";
import { CavCloudTextPreview } from "@/components/cavcloud/CavCloudTextPreview";
import type { CavCloudPreviewItem } from "@/components/cavcloud/preview.types";

const UI_ROOT_PATH_LABEL = "/cavcloud";
const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");

type CavCloudTextPanelProps = {
  item: CavCloudPreviewItem;
  mode?: "panel" | "page";
  onClose: () => void;
  onOpen: () => void;
  onCopyLink: () => void | Promise<void>;
  onShare: () => void;
  canCopyLink?: boolean;
  canShare?: boolean;
  onOpenInCavCode?: () => void;
  onMountInCavCodeViewer?: () => void;
  mountInCavCodeViewerLocked?: boolean;
  onMountInCavCodeViewerLocked?: () => void;
  mountInCavCodeViewerLockedMessage?: string;
  allowEditing?: boolean;
  openInCavCodeLabel?: string;
};

type TextCacheRecord = {
  text: string;
  bytes: number | null;
  modifiedAtISO: string | null;
  mimeType: string;
  fileId: string | null;
};

type FileVersionRow = {
  id: string;
  versionNumber: number;
  sha256: string;
  bytes: number;
  createdByUserId: string | null;
  createdAtISO: string;
  restoredFromVersionId: string | null;
};

type CollabAccessRow = {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  permission: "VIEW" | "EDIT";
  expiresAtISO: string | null;
};

type CollabAccessResponse = {
  ok?: boolean;
  accessList?: CollabAccessRow[];
};

type AccessLogOperator = {
  id: string | null;
  displayName: string;
  username: string | null;
  initials: string;
};

type AccessLogRow = {
  id: string;
  actionLabel: string;
  createdAtISO: string;
  targetPath: string | null;
  operator: AccessLogOperator;
};

type AccessLogResponse = {
  ok?: boolean;
  message?: string;
  rows?: AccessLogRow[];
  nextCursor?: string | null;
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

function extensionUpper(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  const idx = raw.lastIndexOf(".");
  if (idx < 0) return "FILE";
  return raw.slice(idx + 1).toUpperCase() || "FILE";
}

function dateLabel(value?: string | null): string {
  const v = String(value || "").trim();
  if (!v) return "-";
  const ts = Date.parse(v);
  if (!Number.isFinite(ts)) return "-";
  return new Date(ts).toLocaleString();
}

function accessExpiryLabel(value: string | null): string {
  if (!value) return "Never";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "Never";
  const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

function accessUserLabel(row: { displayName: string | null; username: string | null; email: string | null; userId: string }): string {
  const displayName = String(row.displayName || "").trim();
  if (displayName) return displayName;
  const username = String(row.username || "").trim();
  if (username) return `@${username}`;
  const email = String(row.email || "").trim();
  if (email) return email;
  return String(row.userId || "").trim() || "-";
}

function shortSha(value: string | null | undefined): string {
  const sha = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return "-";
  return `${sha.slice(0, 10)}...${sha.slice(-8)}`;
}

function parentPath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw || raw === "/") return UI_ROOT_PATH_LABEL;
  const parts = raw.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : UI_ROOT_PATH_LABEL;
}

function normalizeTypeLabel(item: CavCloudPreviewItem, mimeTypeOverride: string): string {
  const mime = String(mimeTypeOverride || item.mimeType || "").trim();
  if (mime) {
    const top = mime.split("/")[1] || mime;
    return top.toUpperCase();
  }
  return extensionUpper(item.name);
}

function normalizePath(rawPath: string): string {
  const raw = String(rawPath || "").trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function runDownload(downloadSrc: string) {
  const href = String(downloadSrc || "").trim();
  if (!href || typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noreferrer";
  link.style.position = "fixed";
  link.style.left = "-9999px";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function cacheKey(source: string, resourceId: string, path: string, modifiedAtISO: string | null, bytes: number | null): string {
  return [
    source,
    resourceId,
    normalizePath(path),
    String(modifiedAtISO || ""),
    String(bytes ?? ""),
  ].join("::");
}

export function CavCloudTextPanel(props: CavCloudTextPanelProps) {
  const { item, onClose, onOpen, onCopyLink, onShare } = props;
  const router = useRouter();
  const mode = props.mode || "panel";
  const canCopyLink = props.canCopyLink !== false;
  const canShare = props.canShare !== false;
  const allowEditing = props.allowEditing !== false;
  const mountInViewerLocked = props.mountInCavCodeViewerLocked === true;
  const mountInViewerLockedMessage = String(props.mountInCavCodeViewerLockedMessage || "").trim() || "Available on premium plans or upgrade to premium plan.";
  const openInCavCodeLabel = String(props.openInCavCodeLabel || "Open in CavCode").trim() || "Open in CavCode";

  const previewKind = item.previewKind || item.mediaKind || "unknown";
  const isTextual = previewKind === "text" || previewKind === "code";
  const canOpenInCavCode = isTextual || previewKind === "unknown";
  const itemSource = item.source;
  const itemResourceId = item.resourceId;
  const itemPath = item.path;

  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const textCacheRef = React.useRef<Map<string, TextCacheRecord>>(new Map());
  const copyFeedbackTimerRef = React.useRef<number | null>(null);
  const discardActionRef = React.useRef<(() => void) | null>(null);

  const [toolbarHidden, setToolbarHidden] = React.useState<boolean>(false);
  const [copying, setCopying] = React.useState<boolean>(false);
  const [copied, setCopied] = React.useState<boolean>(false);
  const [shareBusy, setShareBusy] = React.useState<boolean>(false);
  const [collabOpen, setCollabOpen] = React.useState<boolean>(false);
  const [infoOpen, setInfoOpen] = React.useState<boolean>(false);
  const [discardModalOpen, setDiscardModalOpen] = React.useState<boolean>(false);
  const [panelMode, setPanelMode] = React.useState<"read" | "edit">("read");
  const [textWrap, setTextWrap] = React.useState<boolean>(false);
  const [textGrid, setTextGrid] = React.useState<boolean>(false);
  const [textLoading, setTextLoading] = React.useState<boolean>(false);
  const [saveBusy, setSaveBusy] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>("");
  const [tooLarge, setTooLarge] = React.useState<boolean>(false);
  const [textValue, setTextValue] = React.useState<string>("");
  const [baselineText, setBaselineText] = React.useState<string>("");
  const [resolvedBytes, setResolvedBytes] = React.useState<number | null>(item.bytes ?? null);
  const [resolvedModifiedAtISO, setResolvedModifiedAtISO] = React.useState<string | null>(item.modifiedAtISO || null);
  const [resolvedMimeType, setResolvedMimeType] = React.useState<string>(String(item.mimeType || "").trim());
  const [resolvedFileId, setResolvedFileId] = React.useState<string | null>(item.source === "file" ? item.resourceId : null);
  const [knownSha256, setKnownSha256] = React.useState<string | null>(null);
  const [knownVersionNumber, setKnownVersionNumber] = React.useState<number | null>(null);
  const [versions, setVersions] = React.useState<FileVersionRow[]>([]);
  const [versionsBusy, setVersionsBusy] = React.useState<boolean>(false);
  const [versionsError, setVersionsError] = React.useState<string>("");
  const [collabAccessBusy, setCollabAccessBusy] = React.useState<boolean>(false);
  const [collabAccessError, setCollabAccessError] = React.useState<string>("");
  const [collabAccessList, setCollabAccessList] = React.useState<CollabAccessRow[]>([]);
  const [accessLogBusy, setAccessLogBusy] = React.useState<boolean>(false);
  const [accessLogError, setAccessLogError] = React.useState<string>("");
  const [accessLogRows, setAccessLogRows] = React.useState<AccessLogRow[]>([]);
  const [accessLogNextCursor, setAccessLogNextCursor] = React.useState<string | null>(null);
  const [accessLogDenied, setAccessLogDenied] = React.useState<boolean>(false);
  const [restoreBusyVersionId, setRestoreBusyVersionId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setToolbarHidden(false);
    setCopying(false);
    setCopied(false);
    setShareBusy(false);
    setCollabOpen(false);
    setInfoOpen(false);
    setDiscardModalOpen(false);
    setPanelMode("read");
    setTextWrap(false);
    setTextGrid(false);
    setTextLoading(false);
    setSaveBusy(false);
    setError("");
    setTooLarge(false);
    setTextValue("");
    setBaselineText("");
    setResolvedBytes(item.bytes ?? null);
    setResolvedModifiedAtISO(item.modifiedAtISO || null);
    setResolvedMimeType(String(item.mimeType || "").trim());
    setResolvedFileId(item.source === "file" ? item.resourceId : null);
    setKnownSha256(null);
    setKnownVersionNumber(null);
    setVersions([]);
    setVersionsBusy(false);
    setVersionsError("");
    setCollabAccessBusy(false);
    setCollabAccessError("");
    setCollabAccessList([]);
    setAccessLogBusy(false);
    setAccessLogError("");
    setAccessLogRows([]);
    setAccessLogNextCursor(null);
    setAccessLogDenied(false);
    setRestoreBusyVersionId(null);
    discardActionRef.current = null;
    if (copyFeedbackTimerRef.current != null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, [item.bytes, item.id, item.mimeType, item.modifiedAtISO, item.resourceId, item.source]);

  React.useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (item.source !== "by_path") return;
    const normalizedPath = normalizePath(item.path);
    if (!normalizedPath) return;

    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/cavcloud/files/by-path?path=${encodeURIComponent(normalizedPath)}`, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null) as {
          ok?: boolean;
          file?: {
            id?: string;
            mimeType?: string | null;
            bytes?: number | null;
            createdAtISO?: string | null;
            updatedAtISO?: string | null;
          };
        } | null;

        if (!alive || !res.ok || !json?.ok || !json.file) return;
        setResolvedFileId(String(json.file.id || "").trim() || null);
        const nextMime = String(json.file.mimeType || "").trim();
        if (nextMime) setResolvedMimeType(nextMime);
        const nextBytesRaw = Number(json.file.bytes);
        if (Number.isFinite(nextBytesRaw) && nextBytesRaw >= 0) {
          setResolvedBytes(Math.trunc(nextBytesRaw));
        }
        const nextModified = String(json.file.updatedAtISO || json.file.createdAtISO || "").trim();
        if (nextModified) setResolvedModifiedAtISO(nextModified);
      } catch {
        // Metadata fallback is best effort only.
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [item.path, item.source]);

  React.useEffect(() => {
    if (!resolvedFileId) {
      setKnownSha256(null);
      setKnownVersionNumber(null);
      return;
    }

    let alive = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}`, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          file?: {
            sha256?: string | null;
            versionNumber?: number | null;
          };
        } | null;
        if (!alive || !res.ok || !json?.ok) return;

        const nextSha = String(json.file?.sha256 || "").trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(nextSha)) {
          setKnownSha256(nextSha);
        } else {
          setKnownSha256(null);
        }
        const nextVersionRaw = Number(json.file?.versionNumber);
        if (Number.isFinite(nextVersionRaw) && nextVersionRaw > 0) {
          setKnownVersionNumber(Math.trunc(nextVersionRaw));
        }
      } catch {
        // Metadata fetch is best-effort only.
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [resolvedFileId]);

  const activeCacheKey = React.useMemo(
    () => cacheKey(itemSource, itemResourceId, itemPath, resolvedModifiedAtISO, resolvedBytes),
    [itemPath, itemResourceId, itemSource, resolvedBytes, resolvedModifiedAtISO]
  );

  React.useEffect(() => {
    if (!isTextual) {
      setError("");
      setTooLarge(false);
      setTextValue("");
      setBaselineText("");
      return;
    }

    if (resolvedBytes != null && resolvedBytes > MAX_INLINE_TEXT_BYTES) {
      setTooLarge(true);
      setTextLoading(false);
      setError("");
      setTextValue("");
      setBaselineText("");
      return;
    }

    const cached = textCacheRef.current.get(activeCacheKey);
    if (cached) {
      setTextValue(cached.text);
      setBaselineText(cached.text);
      setResolvedBytes(cached.bytes);
      setResolvedModifiedAtISO(cached.modifiedAtISO);
      setResolvedMimeType(cached.mimeType || resolvedMimeType);
      if (cached.fileId) setResolvedFileId(cached.fileId);
      setError("");
      setTooLarge(false);
      setTextLoading(false);
      return;
    }

    let alive = true;
    const ctrl = new AbortController();

    setTextLoading(true);
    setError("");
    setTooLarge(false);

    (async () => {
      try {
        const res = await fetch(item.rawSrc, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("LOAD_FAILED");

        const contentLengthRaw = Number(res.headers.get("content-length"));
        if (Number.isFinite(contentLengthRaw) && contentLengthRaw > MAX_INLINE_TEXT_BYTES) {
          if (!alive) return;
          setTooLarge(true);
          setTextLoading(false);
          setTextValue("");
          setBaselineText("");
          return;
        }

        const buffer = await res.arrayBuffer();
        if (!alive) return;
        if (buffer.byteLength > MAX_INLINE_TEXT_BYTES) {
          setTooLarge(true);
          setTextLoading(false);
          setTextValue("");
          setBaselineText("");
          return;
        }

        const text = UTF8_DECODER.decode(buffer).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        setTextValue(text);
        setBaselineText(text);
        setResolvedBytes(buffer.byteLength);
        setTextLoading(false);
        setError("");
        setTooLarge(false);
        const cacheRecord: TextCacheRecord = {
          text,
          bytes: buffer.byteLength,
          modifiedAtISO: resolvedModifiedAtISO,
          mimeType: resolvedMimeType || item.mimeType || "text/plain",
          fileId: resolvedFileId,
        };
        textCacheRef.current.set(activeCacheKey, cacheRecord);
        textCacheRef.current.set(cacheKey(itemSource, itemResourceId, itemPath, resolvedModifiedAtISO, buffer.byteLength), cacheRecord);
      } catch {
        if (!alive) return;
        setTextLoading(false);
        setError("Preview unavailable.");
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [activeCacheKey, isTextual, item.mimeType, item.rawSrc, itemPath, itemResourceId, itemSource, resolvedBytes, resolvedFileId, resolvedMimeType, resolvedModifiedAtISO]);

  const textDirty = panelMode === "edit" && textValue !== baselineText;
  const canEdit = allowEditing && isTextual && !tooLarge && !textLoading;
  const canSave = allowEditing && Boolean(resolvedFileId) && textDirty && !saveBusy;
  const headerMeta = `${normalizeTypeLabel(item, resolvedMimeType)} \u00b7 ${bytesLabel(resolvedBytes)}`;
  const encodingLabel = "UTF-8";

  const runCopyLink = React.useCallback(async () => {
    if (copying || !canCopyLink) return;
    setCopied(false);
    setCopying(true);
    try {
      await onCopyLink();
      setCopied(true);
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimerRef.current = null;
      }, 1400);
    } catch {
      // Parent handles copy-link failures.
      setCopied(false);
    } finally {
      setCopying(false);
    }
  }, [canCopyLink, copying, onCopyLink]);

  const runShare = React.useCallback(async () => {
    if (shareBusy || !canShare) return;
    setShareBusy(true);
    try {
      await onShare();
    } catch {
      // Parent handles share failures.
    } finally {
      setShareBusy(false);
    }
  }, [canShare, onShare, shareBusy]);

  const toggleFullscreen = React.useCallback(async () => {
    const el = surfaceRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
        return;
      }
      await el.requestFullscreen();
    } catch {
      // Ignore fullscreen API errors.
    }
  }, []);

  const dismissDiscardModal = React.useCallback(() => {
    discardActionRef.current = null;
    setDiscardModalOpen(false);
  }, []);

  const confirmDiscardChanges = React.useCallback(() => {
    const nextAction = discardActionRef.current;
    discardActionRef.current = null;
    setDiscardModalOpen(false);
    nextAction?.();
  }, []);

  const requestDiscardConfirm = React.useCallback((onDiscard: () => void): boolean => {
    if (!textDirty) {
      onDiscard();
      return true;
    }
    discardActionRef.current = onDiscard;
    setDiscardModalOpen(true);
    return false;
  }, [textDirty]);

  const cancelEdit = React.useCallback(() => {
    requestDiscardConfirm(() => {
      setPanelMode("read");
      setTextValue(baselineText);
      setError("");
    });
  }, [baselineText, requestDiscardConfirm]);

  const runClose = React.useCallback(() => {
    if (panelMode === "edit") {
      requestDiscardConfirm(() => onClose());
      return;
    }
    onClose();
  }, [onClose, panelMode, requestDiscardConfirm]);

  const saveContent = React.useCallback(async () => {
    if (!canSave || !resolvedFileId || !isTextual) return;
    setSaveBusy(true);
    setError("");
    try {
      const baseMime = String(resolvedMimeType || item.mimeType || "text/plain").trim() || "text/plain";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (knownSha256) headers["If-Match"] = `"${knownSha256}"`;

      const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}/content`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          content: textValue,
          mimeType: `${baseMime}; charset=utf-8`,
          baseSha256: knownSha256 || undefined,
        }),
      });
      const json = await res.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        message?: string;
        latest?: {
          sha256?: string | null;
          versionNumber?: number | null;
        };
        file?: {
          bytes?: number;
          mimeType?: string | null;
          sha256?: string | null;
          versionNumber?: number | null;
          createdAtISO?: string | null;
          updatedAtISO?: string | null;
        };
      } | null;
      if (res.status === 409 || json?.error === "FILE_EDIT_CONFLICT") {
        const latestSha = String(json?.latest?.sha256 || "").trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(latestSha)) setKnownSha256(latestSha);
        const latestVersionRaw = Number(json?.latest?.versionNumber);
        if (Number.isFinite(latestVersionRaw) && latestVersionRaw > 0) {
          setKnownVersionNumber(Math.trunc(latestVersionRaw));
        }
        throw new Error(String(json?.message || "File changed since your last read. Reload and retry."));
      }
      if (!res.ok || !json?.ok) {
        throw new Error("SAVE_FAILED");
      }

      const updatedAtISO = String(json?.file?.updatedAtISO || json?.file?.createdAtISO || "").trim() || new Date().toISOString();
      const bytesRaw = Number(json?.file?.bytes);
      const nextBytes = Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.trunc(bytesRaw) : UTF8_ENCODER.encode(textValue).byteLength;
      const nextMime = String(json?.file?.mimeType || baseMime).trim() || baseMime;
      const nextSha = String(json?.file?.sha256 || "").trim().toLowerCase();
      const nextVersionRaw = Number(json?.file?.versionNumber);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cavcloud:file-updated", {
          detail: {
            fileId: resolvedFileId,
            path: normalizePath(itemPath),
            updatedAtISO,
            bytes: nextBytes,
          },
        }));
      }

      setResolvedModifiedAtISO(updatedAtISO);
      setResolvedBytes(nextBytes);
      setResolvedMimeType(nextMime);
      setBaselineText(textValue);
      setPanelMode("read");
      setTooLarge(false);
      setError("");
      if (/^[a-f0-9]{64}$/.test(nextSha)) setKnownSha256(nextSha);
      if (Number.isFinite(nextVersionRaw) && nextVersionRaw > 0) {
        setKnownVersionNumber(Math.trunc(nextVersionRaw));
      }

      const nextKey = cacheKey(itemSource, itemResourceId, itemPath, updatedAtISO, nextBytes);
      textCacheRef.current.set(nextKey, {
        text: textValue,
        bytes: nextBytes,
        modifiedAtISO: updatedAtISO,
        mimeType: nextMime,
        fileId: resolvedFileId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file changes. Try again.");
    } finally {
      setSaveBusy(false);
    }
  }, [
    canSave,
    isTextual,
    item.mimeType,
    itemPath,
    itemResourceId,
    itemSource,
    knownSha256,
    resolvedFileId,
    resolvedMimeType,
    textValue,
  ]);

  const loadVersions = React.useCallback(async () => {
    if (!resolvedFileId) return;
    setVersionsBusy(true);
    setVersionsError("");
    try {
      const res = await fetch(`/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}/versions?limit=50`, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        versions?: Array<{
          id?: string;
          versionNumber?: number;
          sha256?: string;
          bytes?: number;
          createdByUserId?: string | null;
          createdAtISO?: string;
          restoredFromVersionId?: string | null;
        }>;
      } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to load version history."));
      }

      const rows: FileVersionRow[] = Array.isArray(json.versions)
        ? json.versions
            .map((version) => {
              const id = String(version?.id || "").trim();
              const createdAtISO = String(version?.createdAtISO || "").trim();
              const versionNumber = Number(version?.versionNumber);
              if (!id || !createdAtISO || !Number.isFinite(versionNumber) || versionNumber <= 0) return null;
              return {
                id,
                versionNumber: Math.trunc(versionNumber),
                sha256: String(version?.sha256 || "").trim().toLowerCase(),
                bytes: Math.max(0, Math.trunc(Number(version?.bytes || 0))),
                createdByUserId: version?.createdByUserId ? String(version.createdByUserId) : null,
                createdAtISO,
                restoredFromVersionId: version?.restoredFromVersionId ? String(version.restoredFromVersionId) : null,
              };
            })
            .filter((row): row is FileVersionRow => Boolean(row))
        : [];

      setVersions(rows);
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : "Failed to load version history.");
    } finally {
      setVersionsBusy(false);
    }
  }, [resolvedFileId]);

  const restoreVersionNow = React.useCallback(async (versionId: string) => {
    if (!resolvedFileId || !versionId || restoreBusyVersionId) return;
    setRestoreBusyVersionId(versionId);
    setError("");
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (knownSha256) headers["If-Match"] = `"${knownSha256}"`;

      const res = await fetch(
        `/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}/versions/${encodeURIComponent(versionId)}/restore`,
        {
          method: "POST",
          cache: "no-store",
          headers,
          body: JSON.stringify({
            baseSha256: knownSha256 || undefined,
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        message?: string;
        latest?: {
          sha256?: string | null;
          versionNumber?: number | null;
        };
        file?: {
          bytes?: number;
          mimeType?: string | null;
          sha256?: string | null;
          versionNumber?: number | null;
          updatedAtISO?: string | null;
          createdAtISO?: string | null;
        };
      } | null;

      if (res.status === 409 || json?.error === "FILE_EDIT_CONFLICT") {
        const latestSha = String(json?.latest?.sha256 || "").trim().toLowerCase();
        if (/^[a-f0-9]{64}$/.test(latestSha)) setKnownSha256(latestSha);
        const latestVersionRaw = Number(json?.latest?.versionNumber);
        if (Number.isFinite(latestVersionRaw) && latestVersionRaw > 0) {
          setKnownVersionNumber(Math.trunc(latestVersionRaw));
        }
        throw new Error(String(json?.message || "Restore conflict. Refresh and retry."));
      }
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || "Failed to restore version."));
      }

      const updatedAtISO = String(json?.file?.updatedAtISO || json?.file?.createdAtISO || "").trim() || new Date().toISOString();
      const bytesRaw = Number(json?.file?.bytes);
      const nextBytes = Number.isFinite(bytesRaw) && bytesRaw >= 0 ? Math.trunc(bytesRaw) : resolvedBytes;
      const nextMime = String(json?.file?.mimeType || resolvedMimeType).trim() || resolvedMimeType;
      const nextSha = String(json?.file?.sha256 || "").trim().toLowerCase();
      const nextVersionRaw = Number(json?.file?.versionNumber);

      setPanelMode("read");
      setResolvedModifiedAtISO(updatedAtISO);
      setResolvedBytes(nextBytes);
      setResolvedMimeType(nextMime);
      setTextValue("");
      setBaselineText("");
      if (/^[a-f0-9]{64}$/.test(nextSha)) setKnownSha256(nextSha);
      if (Number.isFinite(nextVersionRaw) && nextVersionRaw > 0) {
        setKnownVersionNumber(Math.trunc(nextVersionRaw));
      }

      textCacheRef.current.delete(activeCacheKey);
      await loadVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore version.");
    } finally {
      setRestoreBusyVersionId(null);
    }
  }, [
    activeCacheKey,
    knownSha256,
    loadVersions,
    resolvedBytes,
    resolvedFileId,
    resolvedMimeType,
    restoreBusyVersionId,
  ]);

  const restoreVersion = React.useCallback((versionId: string) => {
    if (!resolvedFileId || !versionId || restoreBusyVersionId) return;
    if (panelMode === "edit" && textDirty) {
      requestDiscardConfirm(() => {
        setPanelMode("read");
        setTextValue(baselineText);
        setError("");
        void restoreVersionNow(versionId);
      });
      return;
    }
    void restoreVersionNow(versionId);
  }, [
    baselineText,
    panelMode,
    requestDiscardConfirm,
    resolvedFileId,
    restoreBusyVersionId,
    restoreVersionNow,
    textDirty,
  ]);

  React.useEffect(() => {
    if (!infoOpen || !resolvedFileId) return;
    void loadVersions();
  }, [infoOpen, loadVersions, resolvedFileId, knownVersionNumber]);

  React.useEffect(() => {
    if (!infoOpen || !resolvedFileId) {
      setCollabAccessBusy(false);
      setCollabAccessError("");
      setCollabAccessList([]);
      return;
    }

    let active = true;
    setCollabAccessBusy(true);
    setCollabAccessError("");

    const params = new URLSearchParams({
      targetType: "file",
      targetId: resolvedFileId,
    });

    void fetch(`/api/cavcloud/shares/user?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as CollabAccessResponse | null;
        if (!active) return;
        if (!res.ok || body?.ok === false) throw new Error("Failed to load collaboration access.");
        setCollabAccessList(Array.isArray(body?.accessList) ? body.accessList : []);
      })
      .catch((err) => {
        if (!active) return;
        setCollabAccessError(err instanceof Error ? err.message : "Failed to load collaboration access.");
      })
      .finally(() => {
        if (!active) return;
        setCollabAccessBusy(false);
      });

    return () => {
      active = false;
    };
  }, [infoOpen, resolvedFileId]);

  React.useEffect(() => {
    if (!infoOpen || !resolvedFileId) {
      setAccessLogBusy(false);
      setAccessLogError("");
      setAccessLogRows([]);
      setAccessLogNextCursor(null);
      setAccessLogDenied(false);
      return;
    }

    let active = true;
    setAccessLogBusy(true);
    setAccessLogError("");
    setAccessLogDenied(false);

    void fetch(`/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}/access-log?limit=20`, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as AccessLogResponse | null;
        if (!active) return;
        if (res.status === 403) {
          setAccessLogDenied(true);
          setAccessLogRows([]);
          setAccessLogNextCursor(null);
          return;
        }
        if (!res.ok || body?.ok === false) throw new Error(String(body?.message || "Failed to load access log."));
        setAccessLogRows(Array.isArray(body?.rows) ? body.rows : []);
        setAccessLogNextCursor(String(body?.nextCursor || "").trim() || null);
      })
      .catch((err) => {
        if (!active) return;
        setAccessLogError(err instanceof Error ? err.message : "Failed to load access log.");
        setAccessLogRows([]);
        setAccessLogNextCursor(null);
      })
      .finally(() => {
        if (!active) return;
        setAccessLogBusy(false);
      });

    return () => {
      active = false;
    };
  }, [infoOpen, resolvedFileId]);

  const loadMoreAccessLog = React.useCallback(async () => {
    if (!resolvedFileId || !accessLogNextCursor || accessLogBusy || accessLogDenied) return;
    setAccessLogBusy(true);
    setAccessLogError("");
    try {
      const res = await fetch(
        `/api/cavcloud/files/${encodeURIComponent(resolvedFileId)}/access-log?limit=20&cursor=${encodeURIComponent(accessLogNextCursor)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "include",
        },
      );
      const body = (await res.json().catch(() => null)) as AccessLogResponse | null;
      if (res.status === 403) {
        setAccessLogDenied(true);
        setAccessLogRows([]);
        setAccessLogNextCursor(null);
        return;
      }
      if (!res.ok || body?.ok === false) {
        throw new Error(String(body?.message || "Failed to load access log."));
      }

      const rows = Array.isArray(body?.rows) ? body.rows : [];
      setAccessLogRows((prev) => [...prev, ...rows]);
      setAccessLogNextCursor(String(body?.nextCursor || "").trim() || null);
    } catch (err) {
      setAccessLogError(err instanceof Error ? err.message : "Failed to load access log.");
    } finally {
      setAccessLogBusy(false);
    }
  }, [accessLogBusy, accessLogDenied, accessLogNextCursor, resolvedFileId]);

  const openInCavCode = React.useCallback(() => {
    if (!canOpenInCavCode) return;
    if (props.onOpenInCavCode) {
      props.onOpenInCavCode();
      return;
    }
    // Root-cause fix (A1): keep CavCloud->CavCode transitions in SPA navigation.
    router.push("/cavcode");
  }, [canOpenInCavCode, props, router]);
  const mountInCavCodeViewer = React.useCallback(() => {
    if (mountInViewerLocked) {
      if (props.onMountInCavCodeViewerLocked) {
        props.onMountInCavCodeViewerLocked();
      }
      return;
    }
    if (!props.onMountInCavCodeViewer) return;
    props.onMountInCavCodeViewer();
  }, [mountInViewerLocked, props]);
  const showMountInViewerButton = mountInViewerLocked || !!props.onMountInCavCodeViewer;

  React.useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (discardModalOpen) {
        ev.preventDefault();
        dismissDiscardModal();
        return;
      }
      if (infoOpen) {
        ev.preventDefault();
        setInfoOpen(false);
        return;
      }
      if (panelMode === "edit") {
        ev.preventDefault();
        cancelEdit();
        return;
      }
      ev.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelEdit, discardModalOpen, dismissDiscardModal, infoOpen, onClose, panelMode]);

  const detailsRows: Array<{ label: string; value: string }> = [
    { label: "Name", value: item.name || "-" },
    { label: "Saved in", value: parentPath(item.path) },
    { label: "Size", value: bytesLabel(resolvedBytes) },
    { label: "Modified", value: dateLabel(resolvedModifiedAtISO || item.modifiedAtISO) },
    { label: "Type", value: normalizeTypeLabel(item, resolvedMimeType) },
  ];

  const mimeLabel = String(resolvedMimeType || "").trim();
  if (mimeLabel) detailsRows.push({ label: "MIME", value: mimeLabel });
  if (isTextual) detailsRows.push({ label: "Encoding", value: encodingLabel });
  if (knownVersionNumber && Number.isFinite(knownVersionNumber)) {
    detailsRows.push({ label: "Current version", value: `v${knownVersionNumber}` });
  }
  if (knownSha256) {
    detailsRows.push({ label: "Current SHA", value: shortSha(knownSha256) });
  }
  detailsRows.push({ label: "Uploaded by", value: String(item.uploadedBy || "").trim() || "CavCloud user" });
  if (item.uploadedAtISO) detailsRows.push({ label: "Date uploaded", value: dateLabel(item.uploadedAtISO) });
  if (item.createdAtISO) detailsRows.push({ label: "Date created", value: dateLabel(item.createdAtISO) });
  const sharedUsersCount = React.useMemo(() => {
    const fromItem = Number(item.sharedUserCount || 0);
    if (Number.isFinite(fromItem) && fromItem > 0) return Math.max(0, Math.trunc(fromItem));
    return collabAccessList.length;
  }, [collabAccessList.length, item.sharedUserCount]);
  const collaborationEnabled = React.useMemo(() => {
    if (item.collaborationEnabled) return true;
    return collabAccessList.some((row) => row.permission === "EDIT");
  }, [collabAccessList, item.collaborationEnabled]);

  return (
    <section
      className={`cc-previewPanel ${mode === "page" ? "is-page" : ""} ${panelMode === "edit" ? "is-editing" : ""}`.trim()}
      aria-label="CavCloud preview panel"
    >
      <header className="cc-previewHeader">
        <div className="cc-previewHeadLeft">
          <h2 className="cc-previewName" title={item.name}>{item.name}</h2>
          <div className="cc-previewMetaLine">{headerMeta}</div>
          <button
            className="cc-previewInfoBtn"
            type="button"
            onClick={() => setInfoOpen(true)}
          >
            File info
          </button>
        </div>
        <div className="cc-previewHeadRight">
          {panelMode === "edit" && isTextual ? (
            <>
              <div className="cc-previewEditStatus">{textDirty ? "Unsaved changes" : "No changes made"}</div>
              <button
                className="cc-previewActionBtn"
                type="button"
                onClick={cancelEdit}
              >
                Cancel
              </button>
              <button
                className="cc-previewActionBtn cc-previewActionBtnSave"
                type="button"
                onClick={() => void saveContent()}
                disabled={!canSave}
              >
                {saveBusy ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button
                className="cc-previewIconBtn"
                type="button"
                onClick={() => void runCopyLink()}
                disabled={!canCopyLink || copying}
                aria-label={copied ? "Link copied" : "Copy link"}
                title={copied ? "Link copied" : "Copy link"}
              >
                <Image
                  src="/icons/link-alt-1-svgrepo-com.svg"
                  alt=""
                  width={14}
                  height={14}
                  className="cc-previewCopyIcon"
                  aria-hidden="true"
                />
              </button>
              <button
                className="cc-previewIconBtn"
                type="button"
                onClick={() => void runShare()}
                disabled={!canShare || shareBusy}
                aria-label="Share"
                title="Share"
              >
                <Image src="/icons/team-svgrepo-com.svg" alt="" width={14} height={14} className="cc-previewCopyIcon" aria-hidden="true" />
              </button>
              {mode === "panel" ? (
                <button
                  className="cc-previewActionBtn"
                  type="button"
                  onClick={onOpen}
                  aria-label="Open viewer"
                >
                  Open
                </button>
              ) : null}
            </>
          )}
          <button
            className="cc-previewIconBtn"
            type="button"
            onClick={runClose}
            aria-label={mode === "page" ? "Back" : "Close preview"}
            title={mode === "page" ? "Back" : "Close"}
          >
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={`cc-previewToolbar ${toolbarHidden ? "is-hidden" : ""}`}>
        {isTextual ? (
          <>
            {panelMode === "read" ? (
              <button
                className="cc-previewToolBtn"
                type="button"
                onClick={() => setPanelMode("edit")}
                disabled={!canEdit}
              >
                Edit content
              </button>
            ) : null}
            <button
              className="cc-previewToolBtn"
              type="button"
              onClick={() => setTextWrap((prev) => !prev)}
            >
              {textWrap ? "Wrap: On" : "Wrap: Off"}
            </button>
            {canOpenInCavCode ? (
              <button
                className="cc-previewToolBtn"
                type="button"
                onClick={openInCavCode}
              >
                {openInCavCodeLabel}
              </button>
            ) : null}
            {showMountInViewerButton ? (
              <button
                className={`cc-previewToolBtn ${mountInViewerLocked ? "is-locked" : ""}`.trim()}
                type="button"
                onClick={mountInCavCodeViewer}
                aria-disabled={mountInViewerLocked ? "true" : undefined}
                title={mountInViewerLocked ? mountInViewerLockedMessage : undefined}
              >
                Mount in Viewer
              </button>
            ) : null}
            <button
              className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewToolBtnEdge"
              type="button"
              onClick={() => setTextGrid((prev) => !prev)}
              aria-label={textGrid ? "Hide alignment grid" : "Show alignment grid"}
              title={textGrid ? "Hide alignment grid" : "Show alignment grid"}
            >
              <Image
                className="cc-previewToolGlyph"
                src={textGrid ? "/icons/grid-4-svgrepo-com.svg" : "/icons/grid-1-svgrepo-com.svg"}
                alt=""
                width={20}
                height={20}
                aria-hidden="true"
              />
            </button>
            <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen" title="Fullscreen">
              <Image className="cc-previewToolGlyph" src="/icons/full-screen-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
            <button
              className="cc-previewToolBtn cc-previewToolBtnIconOnly"
              type="button"
              onClick={() => setToolbarHidden(true)}
              aria-label="Hide toolbar"
              title="Hide toolbar"
            >
              <Image className="cc-previewToolGlyph" src="/icons/hide-sdebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <button className="cc-previewToolBtn" type="button" onClick={() => runDownload(item.downloadSrc)}>Download</button>
            {mode === "panel" ? <button className="cc-previewToolBtn" type="button" onClick={onOpen}>Open</button> : null}
            <button className="cc-previewToolBtn cc-previewToolBtnIconOnly" type="button" onClick={() => void toggleFullscreen()} aria-label="Fullscreen" title="Fullscreen">
              <Image className="cc-previewToolGlyph" src="/icons/full-screen-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
            <button
              className="cc-previewToolBtn cc-previewToolBtnIconOnly cc-previewToolBtnEdge"
              type="button"
              onClick={() => setToolbarHidden(true)}
              aria-label="Hide toolbar"
              title="Hide toolbar"
            >
              <Image className="cc-previewToolGlyph" src="/icons/hide-sdebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div ref={surfaceRef} className="cc-previewCanvasWrap">
        <div className={`cc-previewCanvas ${isTextual ? "is-text" : "is-unknown"}`}>
          {error ? <div className="cc-previewError">{error}</div> : null}

          {!error && isTextual ? (
            tooLarge ? (
              <div className="cc-previewUnavailable">
                <div className="cc-previewUnavailableText">File is larger than 2 MB and cannot be previewed inline.</div>
                <div className="cc-previewUnavailableActions">
                  <button className="cc-previewActionBtn" type="button" onClick={() => runDownload(item.downloadSrc)}>Download</button>
                  {canOpenInCavCode ? <button className="cc-previewActionBtn" type="button" onClick={openInCavCode}>{openInCavCodeLabel}</button> : null}
                  {showMountInViewerButton ? <button className={`cc-previewActionBtn ${mountInViewerLocked ? "is-locked" : ""}`.trim()} type="button" onClick={mountInCavCodeViewer} aria-disabled={mountInViewerLocked ? "true" : undefined} title={mountInViewerLocked ? mountInViewerLockedMessage : undefined}>Mount in Viewer</button> : null}
                  {mode === "panel" ? <button className="cc-previewActionBtn" type="button" onClick={onOpen}>Open</button> : null}
                </div>
              </div>
            ) : textLoading ? (
              <div className="cc-previewTextLoading">Loading text preview…</div>
            ) : panelMode === "edit" ? (
              <CavCloudTextEditor
                value={textValue}
                wrap={textWrap}
                showGrid={textGrid}
                disabled={saveBusy}
                onChange={setTextValue}
                onEscape={cancelEdit}
              />
            ) : (
              <CavCloudTextPreview text={textValue} wrap={textWrap} showGrid={textGrid} />
            )
          ) : null}

          {!error && !isTextual ? (
            <div className="cc-previewUnavailable">
              <div className="cc-previewUnavailableText">Preview unavailable.</div>
              <div className="cc-previewUnavailableActions">
                <button className="cc-previewActionBtn" type="button" onClick={() => runDownload(item.downloadSrc)}>Download</button>
                {canOpenInCavCode ? <button className="cc-previewActionBtn" type="button" onClick={openInCavCode}>{openInCavCodeLabel}</button> : null}
                {showMountInViewerButton ? <button className={`cc-previewActionBtn ${mountInViewerLocked ? "is-locked" : ""}`.trim()} type="button" onClick={mountInCavCodeViewer} aria-disabled={mountInViewerLocked ? "true" : undefined} title={mountInViewerLocked ? mountInViewerLockedMessage : undefined}>Mount in Viewer</button> : null}
                {mode === "panel" ? <button className="cc-previewActionBtn" type="button" onClick={onOpen}>Open</button> : null}
              </div>
            </div>
          ) : null}
        </div>

        {toolbarHidden ? (
          <button
            className="cc-previewToolbarToggle"
            type="button"
            onClick={() => setToolbarHidden(false)}
            aria-label="Show toolbar"
            title="Show toolbar"
          >
            <Image className="cc-previewToolGlyph" src="/icons/show-sidebar-vert-svgrepo-com.svg" alt="" width={20} height={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {infoOpen ? (
        <div className="cc-previewInfoOverlay" role="dialog" aria-modal="true" aria-labelledby="cc-preview-info-title" onClick={() => setInfoOpen(false)}>
          <div className="cc-previewInfoCard" onClick={(ev) => ev.stopPropagation()}>
            <div className="cc-previewInfoHead">
              <h3 className="cc-previewInfoTitle" id="cc-preview-info-title">Properties</h3>
              <button className="cc-previewInfoClose" type="button" onClick={() => setInfoOpen(false)} aria-label="Close properties">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cc-previewInfoRows">
              {detailsRows.map((row) => (
                <div key={row.label} className="cc-previewInfoRow">
                  <div className="cc-previewInfoLabel">{row.label}</div>
                  <div className={`cc-previewInfoValue ${row.label === "Uploaded by" ? "is-user" : ""}`}>
                    {row.label === "Uploaded by" ? <span key={row.value} className="cc-previewInfoUserValue">{row.value}</span> : row.value}
                  </div>
                </div>
              ))}
            </div>
            <div className="cc-previewInfoSection">
              <div className="cc-previewInfoSectionHead">
                <div className="cc-previewInfoSectionTitle">Version history</div>
                <div className="cc-previewInfoSectionHeadActions">
                  <button
                    className="cc-previewActionBtn cc-previewActionBtnIcon"
                    type="button"
                    onClick={() => void loadVersions()}
                    disabled={!resolvedFileId || versionsBusy}
                    aria-label={versionsBusy ? "Refreshing version history" : "Refresh version history"}
                    title={versionsBusy ? "Refreshing version history" : "Refresh version history"}
                  >
                    <span
                      aria-hidden="true"
                      className={`cc-previewRefreshIcon${versionsBusy ? " is-spinning" : ""}`}
                    />
                  </button>
                  {resolvedFileId && isTextual ? (
                    <button
                      className="cc-previewActionBtn"
                      type="button"
                      onClick={() => router.push(`/cavcloud/files/${encodeURIComponent(resolvedFileId)}/history`)}
                    >
                      Open full history
                    </button>
                  ) : null}
                </div>
              </div>
              {isTextual ? (
                <div className="cc-previewVersionHint">Version history is available for text/code files.</div>
              ) : null}
              {!resolvedFileId ? (
                <div className="cc-previewVersionEmpty">Version history is unavailable for this file.</div>
              ) : versionsBusy && !versions.length ? (
                <div className="cc-previewVersionEmpty">Loading versions...</div>
              ) : versionsError ? (
                <div className="cc-previewVersionError">{versionsError}</div>
              ) : !versions.length ? (
                <div className="cc-previewVersionEmpty">No versions found.</div>
              ) : (
                <div className="cc-previewVersionList">
                  {versions.map((version) => {
                    const isCurrent = knownVersionNumber != null && version.versionNumber === knownVersionNumber;
                    const restoreBusy = restoreBusyVersionId === version.id;
                    return (
                      <div key={version.id} className={`cc-previewVersionRow ${isCurrent ? "is-current" : ""}`.trim()}>
                        <div className="cc-previewVersionMeta">
                          <div className="cc-previewVersionTitle">
                            {`v${version.versionNumber}`}
                            {isCurrent ? " (current)" : ""}
                          </div>
                          <div className="cc-previewVersionSub">
                            {dateLabel(version.createdAtISO)}
                            {" \u00b7 "}
                            {bytesLabel(version.bytes)}
                            {" \u00b7 "}
                            {shortSha(version.sha256)}
                            {version.restoredFromVersionId ? " \u00b7 restored" : ""}
                          </div>
                        </div>
                        <button
                          className="cc-previewActionBtn"
                          type="button"
                          onClick={() => void restoreVersion(version.id)}
                          disabled={!allowEditing || isCurrent || Boolean(restoreBusyVersionId) || saveBusy}
                        >
                          {restoreBusy ? "Restoring..." : "Restore"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="cc-previewInfoSection">
              <div className="cc-previewInfoSectionHead">
                <div className="cc-previewInfoSectionTitle">Collaboration</div>
              </div>
              {collabAccessBusy ? (
                <div className="cc-previewVersionEmpty">Loading access...</div>
              ) : collabAccessError ? (
                <div className="cc-previewVersionError">{collabAccessError}</div>
              ) : (
                <div className="cc-previewVersionList">
                  <div className="cc-previewVersionRow">
                    <div className="cc-previewVersionMeta">
                      <div className="cc-previewVersionTitle">Owner (you)</div>
                      <div className="cc-previewVersionSub">Full access</div>
                    </div>
                  </div>
                  <div className="cc-previewVersionRow">
                    <div className="cc-previewVersionMeta">
                      <div className="cc-previewVersionTitle">{sharedUsersCount} direct user share{sharedUsersCount === 1 ? "" : "s"}</div>
                      <div className="cc-previewVersionSub">
                        {collaborationEnabled ? "Collaboration enabled" : "Read-only sharing"}
                      </div>
                    </div>
                  </div>
                  {collabAccessList.length ? (
                    collabAccessList.map((row) => (
                      <div key={row.id} className="cc-previewVersionRow">
                        <div className="cc-previewVersionMeta">
                          <div className="cc-previewVersionTitle">
                            {accessUserLabel(row)}
                          </div>
                          <div className="cc-previewVersionSub">
                            {row.permission === "EDIT" ? "Collaborate" : "Read-only"}
                            {" \u00b7 "}
                            {accessExpiryLabel(row.expiresAtISO)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="cc-previewVersionEmpty">No direct collaborators yet.</div>
                  )}
                </div>
              )}
            </div>

            <div className="cc-previewInfoSection">
              <div className="cc-previewInfoSectionHead">
                <div className="cc-previewInfoSectionTitle">Access Log</div>
              </div>
              {accessLogDenied ? (
                <div className="cc-previewVersionEmpty">Access restricted to the CavBot Account Owner.</div>
              ) : accessLogBusy && !accessLogRows.length ? (
                <div className="cc-previewVersionEmpty">Loading access log...</div>
              ) : accessLogError ? (
                <div className="cc-previewVersionError">{accessLogError}</div>
              ) : !accessLogRows.length ? (
                <div className="cc-previewVersionEmpty">No access events yet.</div>
              ) : (
                <div className="cc-previewVersionList">
                  {accessLogRows.map((row) => (
                    <div key={row.id} className="cc-previewVersionRow">
                      <div className="cc-previewVersionMeta">
                        <div className="cc-previewVersionTitle">
                          <span className="cc-previewAccessOperatorInitials" aria-hidden="true">{row.operator.initials || "CB"}</span>
                          <span>{row.operator.displayName || "CavCloud user"}</span>
                          {row.operator.username ? (
                            <span className="cc-previewAccessOperatorHandle">{`@${row.operator.username}`}</span>
                          ) : null}
                        </div>
                        <div className="cc-previewVersionSub">
                          {row.actionLabel}
                          {" · "}
                          {dateLabel(row.createdAtISO)}
                          {row.targetPath ? ` · ${row.targetPath}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                  {accessLogNextCursor && !accessLogDenied ? (
                    <div className="cc-previewVersionRow">
                      <button
                        className="cc-previewActionBtn"
                        type="button"
                        onClick={() => void loadMoreAccessLog()}
                        disabled={accessLogBusy}
                      >
                        {accessLogBusy ? "Loading..." : "Load more"}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {discardModalOpen ? (
        <div
          className="cc-previewDiscardOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cc-preview-discard-title"
          aria-describedby="cc-preview-discard-text"
          onClick={dismissDiscardModal}
        >
          <div className="cc-previewDiscardCard" onClick={(ev) => ev.stopPropagation()}>
            <div className="cc-previewDiscardEyebrow">CavCloud Editor</div>
            <h3 className="cc-previewDiscardTitle" id="cc-preview-discard-title">Discard unsaved changes?</h3>
            <p className="cc-previewDiscardText" id="cc-preview-discard-text">
              Your edits have not been saved. Keep editing to continue, or discard them now.
            </p>
            <div className="cc-previewDiscardActions">
              <button className="cc-previewActionBtn" type="button" onClick={dismissDiscardModal}>
                Keep editing
              </button>
              <button
                className="cc-previewActionBtn cc-previewDiscardConfirm"
                type="button"
                onClick={confirmDiscardChanges}
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CavCloudCollaborateModal
        open={collabOpen}
        resourceType="FILE"
        resourceId={resolvedFileId}
        resourceName={item.name}
        resourcePath={item.path}
        onClose={() => setCollabOpen(false)}
      />
    </section>
  );
}
