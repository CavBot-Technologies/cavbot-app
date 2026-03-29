"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { CavCloudPreviewPanel } from "@/components/cavcloud/CavCloudPreviewPanel";
import type { CavCloudPreviewItem, CavCloudPreviewKind } from "@/components/cavcloud/preview.types";

type ArtifactKind = "folder" | "document" | "data" | "archive" | "media" | "file";

type ArtifactDisplayItem = {
  id: string;
  title: string;
  type: string;
  publishedAtISO: string;
  viewCount: number;
  href: string | null;
  kind: ArtifactKind;
  summary: string;
  isPreview: boolean;
  previewSrc: string | null;
  previewPath: string | null;
  previewMimeType: string | null;
  previewKind: CavCloudPreviewKind | null;
};

type BrowseFileArtifactPayload = {
  id: string;
  title: string;
  sourcePath: string;
  mimeType: string;
  sizeBytes: number | null;
  previewKind: CavCloudPreviewKind;
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
  viewCount: number;
};

type BrowseFileItem = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  bytes: number | null;
  previewKind: CavCloudPreviewKind;
  updatedAtISO: string;
  viewCount: number;
};

type FolderRoute = {
  username: string;
  artifactId: string;
};

type FolderExplorerSession = {
  title: string;
  route: FolderRoute | null;
  rootPath: string;
  currentPath: string;
  breadcrumbs: BrowseBreadcrumb[];
  folders: BrowseFolderItem[];
  files: BrowseFileItem[];
  loading: boolean;
  error: string;
  emptyMessage: string;
};

type BrowseResponse = {
  ok: boolean;
  mode: "folder" | "file";
  artifact?: BrowseFileArtifactPayload;
  folder?: BrowseFolder;
  breadcrumbs?: BrowseBreadcrumb[];
  folders?: BrowseFolderItem[];
  files?: BrowseFileItem[];
};

type ViewTrackResponse = {
  ok: boolean;
  artifactId?: string;
  itemPath?: string;
  viewCount?: number;
};

type PublicArtifactsResponse = {
  ok?: boolean;
  items?: ArtifactDisplayItem[];
};

const PUBLIC_ARTIFACTS_SYNC_CHANNEL = "cb-public-profile-artifacts-v1";
const PUBLIC_ARTIFACTS_SYNC_KEY = "cb_public_profile_artifacts_rev_v1";

function emitPublicArtifactsSync(username: string) {
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const payload = { username: normalizedUsername, ts: Date.now() };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PUBLIC_ARTIFACTS_SYNC_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    }
  } catch {
    // BroadcastChannel unavailable.
  }
  try {
    globalThis.__cbLocalStore.setItem(PUBLIC_ARTIFACTS_SYNC_KEY, JSON.stringify(payload));
  } catch {
    // best effort
  }
  try {
    window.dispatchEvent(new CustomEvent("cb:public-profile-artifacts-refresh", { detail: payload }));
  } catch {
    // best effort
  }
}

function chunkArtifacts(items: ArtifactDisplayItem[], size: number): ArtifactDisplayItem[][] {
  const out: ArtifactDisplayItem[][] = [];
  const step = Math.max(1, Math.trunc(size) || 1);
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

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

function parsePublicArtifactHref(href: string): { username: string; artifactId: string } | null {
  const input = String(href || "").trim();
  if (!input) return null;

  const rawPath = (() => {
    try {
      return new URL(input, "https://app.cavbot.io").pathname;
    } catch {
      return "";
    }
  })();

  const parts = rawPath.split("/").filter(Boolean);
  const pIdx = parts.findIndex((v) => v === "p");
  if (pIdx < 0 || pIdx + 2 >= parts.length) return null;
  if (parts[pIdx + 2] !== "artifact") return null;
  if (pIdx + 3 >= parts.length) return null;

  const username = decodeURIComponent(String(parts[pIdx + 1] || "").trim());
  const artifactId = decodeURIComponent(String(parts[pIdx + 3] || "").trim());
  if (!username || !artifactId) return null;
  return { username, artifactId };
}

function ArtifactKindIcon({ kind }: { kind: ArtifactKind }) {
  if (kind === "folder") {
    return <span className="pp-artifactIconMask pp-artifactIconMaskFolder" aria-hidden="true" />;
  }
  return <span className="pp-artifactIconMask pp-artifactIconMaskFile" aria-hidden="true" />;
}

function itemDateLabel(value: string): string {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "Unknown date";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fileTypeLabel(name: string): string {
  const clean = String(name || "").trim();
  const idx = clean.lastIndexOf(".");
  if (idx <= 0 || idx >= clean.length - 1) return "FILE";
  return clean.slice(idx + 1).toUpperCase();
}

function normalizeCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function viewCountText(value: number): string {
  const count = normalizeCount(value);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count);
}

function viewAriaLabel(value: number): string {
  const count = normalizeCount(value);
  const formatted = viewCountText(count);
  return `${formatted} ${count === 1 ? "view" : "views"}`;
}

export function PublicArtifactsCarousel({
  username,
  items,
  isOwner = false,
}: {
  username: string;
  items: ArtifactDisplayItem[];
  isOwner?: boolean;
}) {
  const normalizedUsername = React.useMemo(() => String(username || "").trim().toLowerCase(), [username]);
  const [artifactItems, setArtifactItems] = React.useState<ArtifactDisplayItem[]>(items);
  const [isUnpublishBusy, setIsUnpublishBusy] = React.useState(false);
  const [activeArtifactId, setActiveArtifactId] = React.useState<string | null>(null);
  const pages = React.useMemo(() => chunkArtifacts(artifactItems, 3), [artifactItems]);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const folderFetchTokenRef = React.useRef(0);
  const [activePage, setActivePage] = React.useState(0);
  const [previewItem, setPreviewItem] = React.useState<CavCloudPreviewItem | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = React.useState<string | null>(null);
  const [folderSession, setFolderSession] = React.useState<FolderExplorerSession | null>(null);
  const [artifactViewCountsById, setArtifactViewCountsById] = React.useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const item of items) out[item.id] = normalizeCount(item.viewCount);
    return out;
  });
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setArtifactItems(items);
  }, [items]);

  const syncActivePage = React.useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const width = el.clientWidth || 1;
    const next = Math.round(el.scrollLeft / width);
    const bounded = Math.max(0, Math.min(next, Math.max(0, pages.length - 1)));
    setActivePage(bounded);
  }, [pages.length]);

  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;

    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(syncActivePage);
    };
    const onResize = () => syncActivePage();

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    syncActivePage();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [syncActivePage]);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  React.useEffect(() => {
    setArtifactViewCountsById((prev) => {
      const next = { ...prev };
      for (const item of artifactItems) {
        if (next[item.id] == null) next[item.id] = normalizeCount(item.viewCount);
      }
      return next;
    });
  }, [artifactItems]);

  React.useEffect(() => {
    setActivePage((prev) => Math.max(0, Math.min(prev, Math.max(0, pages.length - 1))));
  }, [pages.length]);

  const refreshArtifacts = React.useCallback(async () => {
    if (!normalizedUsername) return;
    try {
      const query = new URLSearchParams();
      query.set("username", normalizedUsername);
      const res = await fetch(`/api/public/profile/artifacts?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as PublicArtifactsResponse | null;
      if (!res.ok || payload?.ok !== true || !Array.isArray(payload.items)) return;
      setArtifactItems(payload.items);
      setArtifactViewCountsById((prev) => {
        const next = { ...prev };
        for (const item of payload.items || []) {
          next[item.id] = normalizeCount(item.viewCount);
        }
        return next;
      });
    } catch {
      // Best-effort refresh only.
    }
  }, [normalizedUsername]);

  React.useEffect(() => {
    if (!isOwner || !isClient || !normalizedUsername) return;
    let alive = true;

    const shouldRefresh = (candidateUsername: unknown) => {
      const candidate = String(candidateUsername || "").trim().toLowerCase();
      return !candidate || candidate === normalizedUsername;
    };

    const onRefreshEvent = (event: Event) => {
      const custom = event as CustomEvent<{ username?: string }>;
      if (!shouldRefresh(custom?.detail?.username)) return;
      if (!alive) return;
      void refreshArtifacts();
    };

    const onStorage = (event: StorageEvent) => {
      if (!event || event.key !== PUBLIC_ARTIFACTS_SYNC_KEY) return;
      if (!alive) return;
      try {
        const parsed = event.newValue ? (JSON.parse(event.newValue) as { username?: string }) : null;
        if (!shouldRefresh(parsed?.username)) return;
      } catch {
        // Ignore malformed payloads.
      }
      void refreshArtifacts();
    };

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(PUBLIC_ARTIFACTS_SYNC_CHANNEL);
        channel.onmessage = (event) => {
          const payload = event?.data as { username?: string } | null;
          if (!shouldRefresh(payload?.username)) return;
          if (!alive) return;
          void refreshArtifacts();
        };
      }
    } catch {
      channel = null;
    }

    window.addEventListener("cb:public-profile-artifacts-refresh", onRefreshEvent as EventListener);
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(() => {
      if (!alive) return;
      void refreshArtifacts();
    }, 4_000);

    return () => {
      alive = false;
      window.removeEventListener("cb:public-profile-artifacts-refresh", onRefreshEvent as EventListener);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
      }
    };
  }, [isClient, isOwner, normalizedUsername, refreshArtifacts]);

  const goToPage = React.useCallback((targetPage: number) => {
    const el = trackRef.current;
    if (!el) return;
    const bounded = Math.max(0, Math.min(targetPage, Math.max(0, pages.length - 1)));
    el.scrollTo({ left: bounded * el.clientWidth, behavior: "smooth" });
    setActivePage(bounded);
  }, [pages.length]);

  const closePreview = React.useCallback(() => {
    setPreviewItem(null);
    setActiveArtifactId(null);
  }, []);

  const setTopLevelViewCount = React.useCallback((artifactId: string, nextCount: number) => {
    setArtifactViewCountsById((prev) => ({
      ...prev,
      [artifactId]: normalizeCount(nextCount),
    }));
  }, []);

  const bumpTopLevelViewCount = React.useCallback((artifactId: string) => {
    setArtifactViewCountsById((prev) => ({
      ...prev,
      [artifactId]: normalizeCount((prev[artifactId] ?? 0) + 1),
    }));
  }, []);

  const applyExplorerViewCount = React.useCallback((pathRaw: string, nextCount: number) => {
    const normalizedTarget = normalizePath(pathRaw);
    const normalizedCount = normalizeCount(nextCount);
    setFolderSession((prev) => {
      if (!prev) return prev;
      let changed = false;
      const folders = prev.folders.map((folder) => {
        if (normalizePath(folder.path) !== normalizedTarget) return folder;
        changed = true;
        return { ...folder, viewCount: normalizedCount };
      });
      const files = prev.files.map((file) => {
        if (normalizePath(file.path) !== normalizedTarget) return file;
        changed = true;
        return { ...file, viewCount: normalizedCount };
      });
      return changed ? { ...prev, folders, files } : prev;
    });
  }, []);

  const trackArtifactView = React.useCallback(async (args: {
    route: FolderRoute;
    itemPath?: string | null;
  }): Promise<number | null> => {
    try {
      const query = new URLSearchParams();
      query.set("username", args.route.username);
      if (args.itemPath) query.set("path", normalizePath(args.itemPath));
      const res = await fetch(
        `/api/public/artifacts/${encodeURIComponent(args.route.artifactId)}/view?${query.toString()}`,
        { method: "POST", cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as ViewTrackResponse | null;
      if (!res.ok || !json?.ok) return null;
      return normalizeCount(json.viewCount);
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    if (!previewItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closePreview, previewItem]);

  React.useEffect(() => {
    if (!previewItem || !isClient) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isClient, previewItem]);

  React.useEffect(() => {
    if (!isClient || previewItem) return;
    const body = document.body;
    if (!body) return;
    if (body.classList.contains("cb-modal-open")) return;
    if (body.style.overflow === "hidden") {
      body.style.removeProperty("overflow");
    }
  }, [isClient, previewItem]);

  const loadFolderSession = React.useCallback(async (args: {
    title: string;
    route: FolderRoute;
    path: string;
    emptyMessage?: string;
  }) => {
    const normalizedPath = normalizePath(args.path);
    const emptyMessage = String(args.emptyMessage || "This folder is empty.");
    const token = ++folderFetchTokenRef.current;

    setFolderSession((prev) => ({
      title: args.title,
      route: args.route,
      rootPath: prev?.route?.artifactId === args.route.artifactId ? prev.rootPath : normalizedPath,
      currentPath: normalizedPath,
      breadcrumbs: prev?.route?.artifactId === args.route.artifactId ? prev.breadcrumbs : [],
      folders: prev?.route?.artifactId === args.route.artifactId ? prev.folders : [],
      files: prev?.route?.artifactId === args.route.artifactId ? prev.files : [],
      loading: true,
      error: "",
      emptyMessage,
    }));

    try {
      const query = new URLSearchParams();
      query.set("username", args.route.username);
      if (normalizedPath !== "/") query.set("path", normalizedPath);
      const res = await fetch(
        `/api/public/artifacts/${encodeURIComponent(args.route.artifactId)}/browse?${query.toString()}`,
        { method: "GET", cache: "no-store" }
      );
      const json = (await res.json().catch(() => null)) as BrowseResponse | null;
      if (!res.ok || !json?.ok || json.mode !== "folder" || !json.folder) {
        throw new Error("This folder is unavailable.");
      }

      if (token !== folderFetchTokenRef.current) return;

      setFolderSession({
        title: args.title,
        route: args.route,
        rootPath: normalizePath(json.folder.rootPath || json.folder.path || "/"),
        currentPath: normalizePath(json.folder.path || normalizedPath),
        breadcrumbs: Array.isArray(json.breadcrumbs) ? json.breadcrumbs : [],
        folders: Array.isArray(json.folders)
          ? json.folders.map((folder) => ({
              ...folder,
              viewCount: normalizeCount((folder as { viewCount?: unknown }).viewCount),
            }))
          : [],
        files: Array.isArray(json.files)
          ? json.files.map((file) => ({
              ...file,
              viewCount: normalizeCount((file as { viewCount?: unknown }).viewCount),
            }))
          : [],
        loading: false,
        error: "",
        emptyMessage,
      });
    } catch (error) {
      if (token !== folderFetchTokenRef.current) return;
      const message = error instanceof Error ? error.message : "Failed to load folder.";
      setFolderSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          loading: false,
          error: message,
        };
      });
    }
  }, []);

  const openFolderArtifact = React.useCallback((artifact: ArtifactDisplayItem) => {
    setPreviewItem(null);
    const route = artifact.href ? parsePublicArtifactHref(artifact.href) : null;
    if (!route) {
      bumpTopLevelViewCount(artifact.id);
      folderFetchTokenRef.current += 1;
      setFolderSession({
        title: artifact.title,
        route: null,
        rootPath: "/",
        currentPath: "/",
        breadcrumbs: [
          {
            id: `preview-root-${artifact.id}`,
            name: artifact.title,
            path: "/",
            isRoot: true,
          },
        ],
        folders: [],
        files: [],
        loading: false,
        error: "",
        emptyMessage: "No files in this published folder yet.",
      });
      return;
    }

    void trackArtifactView({
      route,
      itemPath: "/",
    }).then((nextCount) => {
      if (nextCount != null) setTopLevelViewCount(artifact.id, nextCount);
    });

    void loadFolderSession({
      title: artifact.title,
      route,
      path: "/",
      emptyMessage: "No files in this published folder yet.",
    });
  }, [bumpTopLevelViewCount, loadFolderSession, setTopLevelViewCount, trackArtifactView]);

  const openFolderPath = React.useCallback((path: string) => {
    if (!folderSession?.route) return;
    setPreviewItem(null);
    const normalizedPath = normalizePath(path);
    void trackArtifactView({
      route: folderSession.route,
      itemPath: normalizedPath,
    }).then((nextCount) => {
      if (nextCount != null) applyExplorerViewCount(normalizedPath, nextCount);
    });
    void loadFolderSession({
      title: folderSession.title,
      route: folderSession.route,
      path: normalizedPath,
      emptyMessage: folderSession.emptyMessage,
    });
  }, [applyExplorerViewCount, folderSession, loadFolderSession, trackArtifactView]);

  const openFolderFilePreview = React.useCallback((item: BrowseFileItem) => {
    if (!folderSession?.route) return;
    const filePath = normalizePath(item.path);
    void trackArtifactView({
      route: folderSession.route,
      itemPath: filePath,
    }).then((nextCount) => {
      if (nextCount != null) applyExplorerViewCount(filePath, nextCount);
    });
    const query = new URLSearchParams();
    query.set("username", folderSession.route.username);
    if (filePath !== "/") query.set("path", filePath);
    const downloadQuery = new URLSearchParams(query);
    downloadQuery.set("download", "1");

    const openQuery = new URLSearchParams();
    openQuery.set("path", filePath);

    setPreviewItem({
      id: `artifact:${folderSession.route.artifactId}:${filePath}`,
      resourceId: folderSession.route.artifactId,
      source: "artifact",
      previewKind: item.previewKind || "unknown",
      mediaKind: item.previewKind || "unknown",
      name: item.name || basename(filePath),
      path: filePath,
      mimeType: String(item.mimeType || "application/octet-stream"),
      bytes: item.bytes,
      rawSrc: `/api/public/artifacts/${encodeURIComponent(folderSession.route.artifactId)}/file?${query.toString()}`,
      downloadSrc: `/api/public/artifacts/${encodeURIComponent(folderSession.route.artifactId)}/file?${downloadQuery.toString()}`,
      openHref: `/p/${encodeURIComponent(folderSession.route.username)}/artifact/${encodeURIComponent(folderSession.route.artifactId)}?${openQuery.toString()}`,
    });
    setActiveArtifactId(folderSession.route.artifactId);
  }, [applyExplorerViewCount, folderSession, trackArtifactView]);

  const openFilePreview = React.useCallback(async (artifact: ArtifactDisplayItem) => {
    if (artifact.kind === "folder") return;

    if (artifact.isPreview && artifact.previewSrc) {
      const filePath = normalizePath(artifact.previewPath || `/${artifact.title}`);
      const fileName = basename(filePath) === "/" ? artifact.title : basename(filePath);
      const mimeType = String(artifact.previewMimeType || "application/octet-stream");
      const previewKind = artifact.previewKind || "unknown";

      setPreviewItem({
        id: `preview:${artifact.id}:${filePath}`,
        resourceId: artifact.id,
        source: "file",
        previewKind,
        mediaKind: previewKind,
        name: fileName || artifact.title,
        path: filePath,
        mimeType,
        bytes: null,
        rawSrc: artifact.previewSrc,
        downloadSrc: artifact.previewSrc,
        openHref: artifact.previewSrc,
      });
      setActiveArtifactId(null);
      bumpTopLevelViewCount(artifact.id);
      return;
    }

    if (!artifact.href) return;

    const route = parsePublicArtifactHref(artifact.href);
    if (!route) return;
    setActiveArtifactId(route.artifactId);

    void trackArtifactView({
      route,
      itemPath: null,
    }).then((nextCount) => {
      if (nextCount != null) setTopLevelViewCount(artifact.id, nextCount);
    });

    setLoadingPreviewId(artifact.id);

    try {
      const browseQuery = new URLSearchParams();
      browseQuery.set("username", route.username);

      const browseRes = await fetch(
        `/api/public/artifacts/${encodeURIComponent(route.artifactId)}/browse?${browseQuery.toString()}`,
        { method: "GET", cache: "no-store" }
      );
      const browseJson = (await browseRes.json().catch(() => null)) as BrowseResponse | null;
      const payload = browseJson?.artifact;

      if (!browseRes.ok || !browseJson?.ok || browseJson.mode !== "file" || !payload) return;

      const filePath = normalizePath(payload.sourcePath || "/");
      const fileName = basename(filePath) === "/" ? payload.title : basename(filePath);
      const fileQuery = new URLSearchParams();
      fileQuery.set("username", route.username);
      if (filePath !== "/") fileQuery.set("path", filePath);
      const downloadQuery = new URLSearchParams(fileQuery);
      downloadQuery.set("download", "1");
      const cleanBytes = typeof payload.sizeBytes === "number" && Number.isFinite(payload.sizeBytes)
        ? Math.max(0, Math.trunc(payload.sizeBytes))
        : null;

      setPreviewItem({
        id: `artifact:${route.artifactId}:${filePath}`,
        resourceId: route.artifactId,
        source: "artifact",
        previewKind: payload.previewKind || "unknown",
        mediaKind: payload.previewKind || "unknown",
        name: fileName || payload.title,
        path: filePath,
        mimeType: String(payload.mimeType || "application/octet-stream"),
        bytes: cleanBytes,
        rawSrc: `/api/public/artifacts/${encodeURIComponent(route.artifactId)}/file?${fileQuery.toString()}`,
        downloadSrc: `/api/public/artifacts/${encodeURIComponent(route.artifactId)}/file?${downloadQuery.toString()}`,
        openHref: artifact.href,
      });
    } finally {
      setLoadingPreviewId((current) => (current === artifact.id ? null : current));
    }
  }, [bumpTopLevelViewCount, setTopLevelViewCount, trackArtifactView]);

  const openPreviewInPage = React.useCallback(() => {
    if (!previewItem || typeof window === "undefined") return;
    window.location.assign(previewItem.openHref);
  }, [previewItem]);

  const copyPreviewLink = React.useCallback(async () => {
    if (!previewItem || typeof window === "undefined") return;
    try {
      const href = new URL(previewItem.openHref, window.location.origin).href;
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(href);
    } catch {
      // Best effort only.
    }
  }, [previewItem]);

  const unpublishActiveArtifact = React.useCallback(async () => {
    if (!isOwner || !activeArtifactId || isUnpublishBusy) return;
    const artifactId = String(activeArtifactId || "").trim();
    if (!artifactId) return;

    const previousItems = artifactItems;
    setIsUnpublishBusy(true);
    setArtifactItems((prev) => prev.filter((item) => item.id !== artifactId));
    setPreviewItem(null);
    setActiveArtifactId(null);
    setFolderSession((prev) => {
      if (!prev?.route) return prev;
      return prev.route.artifactId === artifactId ? null : prev;
    });

    try {
      const res = await fetch(`/api/cavcloud/artifacts/${encodeURIComponent(artifactId)}`, {
        method: "DELETE",
        cache: "no-store",
        headers: {
          "x-cavbot-csrf": "1",
        },
      });
      const payload = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || payload?.ok !== true) {
        throw new Error(String(payload?.message || "Failed to unpublish artifact."));
      }

      emitPublicArtifactsSync(normalizedUsername);
      try {
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
        window.dispatchEvent(new CustomEvent("cb:team:refresh"));
      } catch {
        // ignore
      }
      void refreshArtifacts();
    } catch {
      setArtifactItems(previousItems);
      void refreshArtifacts();
    } finally {
      setIsUnpublishBusy(false);
    }
  }, [activeArtifactId, artifactItems, isOwner, isUnpublishBusy, normalizedUsername, refreshArtifacts]);

  const folderExplorerBreadcrumbs = React.useMemo(() => {
    if (!folderSession) return [] as BrowseBreadcrumb[];
    if (folderSession.breadcrumbs.length) return folderSession.breadcrumbs;
    return [
      {
        id: `root:${folderSession.title}`,
        name: folderSession.title,
        path: folderSession.rootPath || "/",
        isRoot: true,
      },
    ] as BrowseBreadcrumb[];
  }, [folderSession]);

  const folderExplorerHasItems = Boolean(
    folderSession && (folderSession.folders.length > 0 || folderSession.files.length > 0)
  );
  const showFolderExplorerCrumbs = folderExplorerBreadcrumbs.length > 1;
  const folderExplorerShowEmpty = Boolean(
    folderSession && !folderSession.loading && !folderSession.error && !folderExplorerHasItems
  );

  if (!pages.length) {
    return (
      <div className="pp-empty">
        No published artifacts yet.
        <div className="pp-emptySub">Publish files or folders from CavCloud or CavSafe to surface them here.</div>
      </div>
    );
  }

  return (
    <div className="pp-artifacts" aria-label="Published artifacts carousel">
      {folderSession ? (
        <section className="pp-artifactExplorer" aria-label={`${folderSession.title} folder`}>
          <div className="pp-artifactExplorerTop">
            <button
              type="button"
              className="pp-artifactsNavBtn pp-artifactExplorerBack"
              aria-label="Back to published artifacts"
              onClick={() => {
                folderFetchTokenRef.current += 1;
                setFolderSession(null);
              }}
            >
              <span className="pp-artifactExplorerBackIcon" aria-hidden="true" />
            </button>
            <div className="pp-artifactExplorerTitleWrap">
              <div className="pp-artifactExplorerTitle">{folderSession.title}</div>
            </div>
          </div>

          {showFolderExplorerCrumbs ? (
            <nav className="pp-artifactExplorerCrumbs" aria-label="Folder path">
              {folderExplorerBreadcrumbs.map((crumb, idx) => {
                const active = normalizePath(crumb.path) === normalizePath(folderSession.currentPath);
                return (
                  <React.Fragment key={`${crumb.path}:${crumb.id}:${idx}`}>
                    <button
                      type="button"
                      className={`pp-artifactExplorerCrumb${active ? " is-active" : ""}`}
                      onClick={() => openFolderPath(crumb.path)}
                      disabled={active || folderSession.loading || !folderSession.route}
                    >
                      {crumb.name}
                    </button>
                    {idx < folderExplorerBreadcrumbs.length - 1 ? (
                      <span className="pp-artifactExplorerCrumbSep" aria-hidden="true">
                        /
                      </span>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </nav>
          ) : null}

          <div className={`pp-artifactExplorerCanvas${showFolderExplorerCrumbs ? "" : " is-noCrumbs"}`}>
            {folderSession.loading ? <div className="pp-artifactExplorerState">Loading folder…</div> : null}
            {!folderSession.loading && folderSession.error ? (
              <div className="pp-artifactExplorerState">{folderSession.error}</div>
            ) : null}
            {folderExplorerShowEmpty ? (
              <div className="pp-artifactExplorerState">{folderSession.emptyMessage}</div>
            ) : null}

            {folderExplorerHasItems ? (
              <div className="pp-artifactExplorerGrid" role="list" aria-label="Folder contents">
                {folderSession.folders.map((folder) => (
                  <button
                    key={`folder:${folder.id}`}
                    type="button"
                    className="pp-artifactExplorerItem"
                    role="listitem"
                    onClick={() => openFolderPath(folder.path)}
                  >
                    <div
                      className="pp-artifactExplorerViews"
                      aria-label={viewAriaLabel(folder.viewCount)}
                      title={viewAriaLabel(folder.viewCount)}
                    >
                      <span className="pp-viewBadgeIcon" aria-hidden="true" />
                      <span className="pp-viewBadgeCount">{viewCountText(folder.viewCount)}</span>
                    </div>
                    <span className="pp-artifactIcon kind-folder" aria-hidden="true">
                      <ArtifactKindIcon kind="folder" />
                    </span>
                    <div className="pp-artifactExplorerName">{folder.name}</div>
                    <div className="pp-artifactExplorerMeta">Folder</div>
                    <div className="pp-artifactExplorerDate">{itemDateLabel(folder.updatedAtISO)}</div>
                  </button>
                ))}

                {folderSession.files.map((file) => (
                  <button
                    key={`file:${file.id}`}
                    type="button"
                    className="pp-artifactExplorerItem"
                    role="listitem"
                    onClick={() => openFolderFilePreview(file)}
                  >
                    <div
                      className="pp-artifactExplorerViews"
                      aria-label={viewAriaLabel(file.viewCount)}
                      title={viewAriaLabel(file.viewCount)}
                    >
                      <span className="pp-viewBadgeIcon" aria-hidden="true" />
                      <span className="pp-viewBadgeCount">{viewCountText(file.viewCount)}</span>
                    </div>
                    <span className="pp-artifactIcon kind-file" aria-hidden="true">
                      <ArtifactKindIcon kind="file" />
                    </span>
                    <div className="pp-artifactExplorerName">{file.name}</div>
                    <div className="pp-artifactExplorerMeta">{fileTypeLabel(file.name)}</div>
                    <div className="pp-artifactExplorerDate">{itemDateLabel(file.updatedAtISO)}</div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <div className="pp-artifactsTrack" ref={trackRef}>
            {pages.map((page, pageIdx) => (
              <section key={`artifact-page-${pageIdx}`} className="pp-artifactsPage" aria-label={`Artifacts page ${pageIdx + 1} of ${pages.length}`}>
                <div className="pp-artifactsPageGrid" role="list" aria-label={`Published artifacts page ${pageIdx + 1}`}>
                  {page.map((artifact) => {
                    const artifactDate = itemDateLabel(artifact.publishedAtISO);
                    const isPreviewLoading = loadingPreviewId === artifact.id;
                    const topLevelViewCount = artifactViewCountsById[artifact.id] ?? normalizeCount(artifact.viewCount);
                    const body = (
                      <>
                        <div className="pp-artifactHead">
                          <div
                            className="pp-artifactViews"
                            aria-label={viewAriaLabel(topLevelViewCount)}
                            title={viewAriaLabel(topLevelViewCount)}
                          >
                            <span className="pp-viewBadgeIcon" aria-hidden="true" />
                            <span className="pp-viewBadgeCount">{viewCountText(topLevelViewCount)}</span>
                          </div>
                          <span className={`pp-artifactIcon kind-${artifact.kind}`} aria-hidden="true">
                            <ArtifactKindIcon kind={artifact.kind} />
                          </span>
                          <div className="pp-artifactBody">
                            <div className="pp-artifactTitle">{artifact.title}</div>
                            <div className="pp-artifactMeta">
                              <span className="pp-artifactType">{artifact.type}</span>
                              <span className="pp-artifactDate">{artifactDate}</span>
                            </div>
                          </div>
                        </div>
                        <div className="pp-artifactSummary">{artifact.summary}</div>
                      </>
                    );

                    if (artifact.kind === "folder") {
                      return (
                        <button
                          key={artifact.id}
                          type="button"
                          className={`pp-artifact pp-artifactFolderLauncher${artifact.isPreview ? " is-preview" : ""}`}
                          role="listitem"
                          aria-label={`Open folder ${artifact.title}`}
                          onClick={() => openFolderArtifact(artifact)}
                        >
                          {body}
                        </button>
                      );
                    }

                    return (
                      <button
                        key={artifact.id}
                        type="button"
                        className={`pp-artifact pp-artifactFileLauncher${artifact.isPreview ? " is-preview" : ""}`}
                        role="listitem"
                        aria-label={`Open file ${artifact.title}`}
                        onClick={() => void openFilePreview(artifact)}
                        disabled={isPreviewLoading}
                        aria-busy={isPreviewLoading ? "true" : undefined}
                      >
                        {body}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {pages.length > 1 ? (
            <div className="pp-artifactsControls">
              <div className="pp-artifactsPager" aria-label="Artifact carousel pagination">
                <button
                  type="button"
                  className="pp-artifactsNavBtn"
                  onClick={() => goToPage(activePage - 1)}
                  disabled={activePage <= 0}
                  aria-label="Previous artifacts page"
                >
                  &larr;
                </button>
                <div className="pp-artifactsDots">
                  {pages.map((_, idx) => (
                    <button
                      key={`artifact-dot-${idx}`}
                      type="button"
                      className={`pp-artifactsDot ${idx === activePage ? "is-active" : ""}`}
                      aria-label={`Go to artifacts page ${idx + 1}`}
                      aria-current={idx === activePage ? "true" : undefined}
                      onClick={() => goToPage(idx)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="pp-artifactsNavBtn"
                  onClick={() => goToPage(activePage + 1)}
                  disabled={activePage >= pages.length - 1}
                  aria-label="Next artifacts page"
                >
                  &rarr;
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {previewItem && isClient
        ? createPortal(
            <div
              className="pp-artifactPreviewModal"
              role="dialog"
              aria-modal="true"
              aria-label={`Preview ${previewItem.name}`}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closePreview();
              }}
            >
              <div className="pp-artifactPreviewFrame">
                <CavCloudPreviewPanel
                  item={previewItem}
                  mode="panel"
                  onClose={closePreview}
                  onOpen={openPreviewInPage}
                  onCopyLink={copyPreviewLink}
                  onShare={() => {}}
                  canShare={false}
                  canCopyLink={true}
                  allowEditing={false}
                  onOpenInCavCode={isOwner && activeArtifactId ? () => void unpublishActiveArtifact() : undefined}
                  openInCavCodeLabel={isOwner && activeArtifactId ? (isUnpublishBusy ? "Unpublishing..." : "Unpublish") : undefined}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
