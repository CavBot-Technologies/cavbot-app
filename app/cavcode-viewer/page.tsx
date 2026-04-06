"use client";

import "./live.css";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";

import "../../components/CavBotLoadingScreen.css";
import CavBotLoadingScreen from "../../components/CavBotLoadingScreen";

type DeviceMode = "desktop" | "tablet" | "phone";
type SourceMode = "cavcloud" | "cavsafe";

type FileNode = {
  id: string;
  kind: "file";
  name: string;
  lang?: string;
  path: string;
  content: string;
};

type FolderNode = {
  id: string;
  kind: "folder";
  name: string;
  path: string;
  children: Array<FileNode | FolderNode>;
};

type Node = FileNode | FolderNode;

const LS_CAVCLOUD_FS = "cb_cavcloud_fs_v1";
const LS_CAVCLOUD_TREE_CACHE_PREFIX = "cb_cavcloud_tree_cache_v2";
const LS_CAVSAFE_TREE_CACHE_KEY = "cb_cavsafe_tree_cache_v2";
const MOUNT_SW_PATH = "/mount-runtime.js";
const MOUNT_SW_CONTEXT_TYPE = "CAVCODE_MOUNT_CONTEXT";
const MOUNT_SW_RELOAD_GUARD_KEY = "ccv_mount_sw_reload_v1";

type WorkspaceFile = {
  path: string;
  name: string;
  kind: "html" | "css" | "js" | "image" | "video" | "font" | "doc" | "other";
  mime: string;
  content: string | ArrayBuffer;
  isBinary: boolean;
  isDataUrl?: boolean;
};

type AuthMeResponse = {
  ok?: boolean;
  user?: {
    displayName?: unknown;
    username?: unknown;
    initials?: unknown;
    avatarTone?: unknown;
    avatarImage?: unknown;
    publicProfileEnabled?: unknown;
  };
};

type DriveFolderRow = {
  id?: unknown;
  name?: unknown;
  path?: unknown;
};

type DriveFileRow = {
  id?: unknown;
  name?: unknown;
  path?: unknown;
};

type DriveRootResponse = {
  ok?: boolean;
  rootFolderId?: unknown;
  root?: { id?: unknown };
};

type DriveChildrenResponse = {
  ok?: boolean;
  folders?: DriveFolderRow[];
  files?: DriveFileRow[];
};

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseProjectId(raw: string | null): number | null {
  const n = Number(raw || "");
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isFalsyFlag(raw: string | null): boolean {
  const v = String(raw || "").trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

function isFolder(n: Node): n is FolderNode {
  return n.kind === "folder";
}
function isFile(n: Node): n is FileNode {
  return n.kind === "file";
}
function walk(node: Node, fn: (n: Node) => void) {
  fn(node);
  if (isFolder(node)) node.children.forEach((c) => walk(c, fn));
}
function listFiles(root: FolderNode): FileNode[] {
  const out: FileNode[] = [];
  walk(root, (n) => {
    if (isFile(n)) out.push(n);
  });
  return out;
}
function normalizePath(p: string) {
  const s = String(p || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/+/g, "/");
}
function basename(p: string) {
  const parts = String(p || "")
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}
function ext(p: string) {
  const b = basename(p).toLowerCase();
  const i = b.lastIndexOf(".");
  return i === -1 ? "" : b.slice(i + 1);
}
function isHtmlFileName(nameOrPath: string) {
  const e = ext(nameOrPath);
  return e === "html" || e === "htm";
}
function isCssFileName(nameOrPath: string) {
  return ext(nameOrPath) === "css";
}
function isJsFileName(nameOrPath: string) {
  const e = ext(nameOrPath);
  return e === "js" || e === "jsx" || e === "mjs" || e === "cjs";
}
function isImageFileName(nameOrPath: string) {
  const e = ext(nameOrPath);
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(e);
}
function isVideoFileName(nameOrPath: string) {
  const e = ext(nameOrPath);
  return ["mp4", "webm", "mov", "m4v", "ogv"].includes(e);
}
function isFontFileName(nameOrPath: string) {
  const e = ext(nameOrPath);
  return ["woff", "woff2", "ttf", "otf"].includes(e);
}

function isHtmlNode(file: Pick<FileNode, "name" | "path">): boolean {
  return isHtmlFileName(file.path) || isHtmlFileName(file.name);
}

function isCssNode(file: Pick<FileNode, "name" | "path">): boolean {
  return isCssFileName(file.path) || isCssFileName(file.name);
}

function isJsNode(file: Pick<FileNode, "name" | "path">): boolean {
  return isJsFileName(file.path) || isJsFileName(file.name);
}

function sourceLabel(source: SourceMode) {
  return source === "cavsafe" ? "CavSafe" : "CavCloud";
}

function sourceRawFileUrl(source: SourceMode, path: string) {
  const normalizedPath = normalizePath(path);
  if (source === "cavsafe") {
    return `/api/cavsafe/files/by-path?path=${encodeURIComponent(normalizedPath)}&raw=1`;
  }
  return `/api/cavcloud/files/by-path?path=${encodeURIComponent(normalizedPath)}&raw=1&access=1`;
}

function guessMime(nameOrPath: string) {
  const e = ext(nameOrPath);
  if (e === "html" || e === "htm") return "text/html";
  if (e === "css") return "text/css";
  if (e === "js" || e === "mjs" || e === "cjs") return "application/javascript";
  if (e === "json") return "application/json";
  if (e === "svg") return "image/svg+xml";
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "gif") return "image/gif";
  if (e === "webp") return "image/webp";
  if (e === "avif") return "image/avif";
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  if (e === "mov") return "video/quicktime";
  if (e === "m4v") return "video/x-m4v";
  if (e === "ogv") return "video/ogg";
  if (e === "woff") return "font/woff";
  if (e === "woff2") return "font/woff2";
  if (e === "ttf") return "font/ttf";
  if (e === "otf") return "font/otf";
  return "application/octet-stream";
}
function detectKind(nameOrPath: string): WorkspaceFile["kind"] {
  if (isHtmlFileName(nameOrPath)) return "html";
  if (isCssFileName(nameOrPath)) return "css";
  if (isJsFileName(nameOrPath)) return "js";
  if (isImageFileName(nameOrPath)) return "image";
  if (isVideoFileName(nameOrPath)) return "video";
  if (isFontFileName(nameOrPath)) return "font";
  return "other";
}

function firstInitialChar(input: string): string {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function normalizeInitialUsernameSource(rawUsername: string): string {
  const trimmed = String(rawUsername || "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const pathname = new URL(trimmed).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    return tail.replace(/^@+/, "");
  } catch {
    return trimmed;
  }
}

function deriveAccountInitials(fullName?: string | null, username?: string | null, fallback?: string | null): string {
  const name = String(fullName || "").trim();
  if (name) {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const userInitial = firstInitialChar(normalizeInitialUsernameSource(String(username || "")));
  if (userInitial) return userInitial;

  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function readInitials(): string {
  try {
    const v = (globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim();
    if (v) return v.slice(0, 3).toUpperCase();
  } catch {}
  return "";
}

function readPublicProfileEnabled(): boolean | null {
  try {
    const raw = (globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "public") return true;
    if (raw === "0" || raw === "false" || raw === "private") return false;
  } catch {}
  return null;
}

function listStorageKeysWithPrefix(prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < globalThis.__cbLocalStore.length; i += 1) {
    const key = globalThis.__cbLocalStore.key(i);
    if (!key) continue;
    if (key === prefix || key.startsWith(`${prefix}:`)) keys.push(key);
  }
  return keys;
}

function filesFromTreeCache(raw: string | null): FileNode[] {
  const parsed = safeJsonParse<{
    payload?: {
      files?: Array<{ id?: unknown; name?: unknown; path?: unknown; content?: unknown }>;
    };
  }>(raw);
  const rows = Array.isArray(parsed?.payload?.files) ? parsed.payload?.files : [];
  if (!rows?.length) return [];
  return rows
    .map((row, idx) => {
      const path = normalizePath(String(row?.path || ""));
      if (!path || path === "/") return null;
      const name = String(row?.name || "").trim() || basename(path) || `file-${idx + 1}`;
      return {
        id: String(row?.id || path),
        kind: "file" as const,
        name,
        path,
        content: typeof row?.content === "string" ? row.content : "",
      };
    })
    .filter(Boolean) as FileNode[];
}

function dedupeFilesByPath(files: FileNode[]): FileNode[] {
  const map = new Map<string, FileNode>();
  files.forEach((file) => {
    const path = normalizePath(file.path);
    if (!path || path === "/") return;
    const existing = map.get(path);
    const content = String(file.content || "");
    if (!existing) {
      map.set(path, { ...file, path, content });
      return;
    }
    const hasExistingContent = String(existing.content || "").length > 0;
    if (!hasExistingContent && content.length > 0) {
      map.set(path, { ...file, path, content });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function escapeInlineScript(raw: string) {
  return String(raw || "").replace(/<\/script>/gi, "<\\/script>");
}

function hashCavFiles(files: FileNode[], activeId: string) {
  let hash = 2166136261;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  push(activeId || "");
  files.forEach((f) => {
    push(f.path || "");
    push(f.name || "");
    push(String(f.content || ""));
  });
  return String(hash >>> 0);
}

function resolveAssetPath(basePath: string, ref: string) {
  const cleaned = String(ref || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("/")) return normalizePath(cleaned);
  const baseDir = normalizePath(basePath).replace(/\/[^/]*$/, "/");
  return normalizePath(`${baseDir}${cleaned}`);
}

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url) || /^\/\//.test(url);
}

function rewriteHtmlAssets(
  raw: string,
  entryPath: string,
  assetUrls: Record<string, string>,
  blockExternal: boolean,
  fallbackBuilder?: (path: string) => string
) {
  const attrRe = /\b(src|href|poster)\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  return raw.replace(attrRe, (full, attr, wrapped, d1, d2, d3) => {
    const value = d1 || d2 || d3 || "";
    const cleaned = value.trim();
    if (!cleaned || cleaned.startsWith("#") || /^data:|^blob:|^mailto:|^tel:|^javascript:/i.test(cleaned)) return full;
    if (/^\/api\//i.test(cleaned)) return full;
    if (isExternalUrl(cleaned)) {
      return blockExternal ? `${attr}="about:blank"` : full;
    }
    const resolved = resolveAssetPath(entryPath, cleaned);
    const attrLower = String(attr || "").toLowerCase();
    const allowHrefFallback = attrLower !== "href" || /\.css(?:[?#]|$)/i.test(cleaned);
    const hit = assetUrls[resolved] || (allowHrefFallback && fallbackBuilder ? fallbackBuilder(resolved) : "");
    return hit ? `${attr}="${hit}"` : full;
  });
}

function rewriteCssAssets(
  raw: string,
  basePath: string,
  assetUrls: Record<string, string>,
  blockExternal: boolean,
  fallbackBuilder?: (path: string) => string
) {
  const urlRe = /url\(([^)]+)\)/gi;
  return raw.replace(urlRe, (full, inner) => {
    const cleaned = String(inner || "").trim().replace(/^['"]|['"]$/g, "");
    if (!cleaned || cleaned.startsWith("#") || /^data:|^blob:/i.test(cleaned)) return full;
    if (/^\/api\//i.test(cleaned)) return full;
    if (isExternalUrl(cleaned)) {
      return blockExternal ? "url(about:blank)" : full;
    }
    const resolved = resolveAssetPath(basePath, cleaned);
    const hit = assetUrls[resolved] || (fallbackBuilder ? fallbackBuilder(resolved) : "");
    return hit ? `url(${hit})` : full;
  });
}

function stripScripts(raw: string) {
  return raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function buildSrcDoc(opts: {
  html: string;
  css: string;
  js: string;
  entryPath: string;
  assetUrls: Record<string, string>;
  disableJs: boolean;
  blockExternal: boolean;
  sourceFileUrlBuilder?: (path: string) => string;
}): string {
  const raw = String(opts.html || "");
  const hasHtmlTag = /<html[\s>]/i.test(raw);
  const js = String(opts.js || "");
  const entryPath = opts.entryPath || "/";
  const blockExternal = opts.blockExternal;
  const disableJs = opts.disableJs;
  const css = rewriteCssAssets(
    String(opts.css || ""),
    entryPath,
    opts.assetUrls,
    blockExternal,
    opts.sourceFileUrlBuilder
  );

  let bodyHtml = rewriteHtmlAssets(raw, entryPath, opts.assetUrls, blockExternal, opts.sourceFileUrlBuilder);
  if (disableJs) bodyHtml = stripScripts(bodyHtml);

  const csp = blockExternal
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' blob: data:; style-src 'unsafe-inline' blob: data:; script-src 'unsafe-inline' blob: data:;">`
    : "";

  const baseHead = `
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CavCode Preview</title>
${csp}
${css ? `<style>${css}</style>` : ""}
`;

  if (hasHtmlTag) {
    const withHead = bodyHtml.replace(/<\/head>/i, `${baseHead}</head>`);
    const scriptTag = js && !disableJs ? `<script>${escapeInlineScript(js)}</script>` : "";
    return withHead.replace(/<\/body>/i, `${scriptTag}</body>`);
  }
  // Wrap partial into a full document
  return `<!doctype html>
<html lang="en">
<head>
${baseHead}
</head>
<body>
${bodyHtml}
${js && !disableJs ? `<script>${escapeInlineScript(js)}</script>` : ""}
</body>
</html>`;
}

function nowLabel() {
  try {
    return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  } catch {
    return "—";
  }
}

export default function LivePage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceMode>("desktop");
  const [html, setHtml] = useState<string>("");
  const [css, setCss] = useState<string>("");
  const [js, setJs] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("—");
  const [status, setStatus] = useState<{ msg: string; tone: "good" | "watch" | "bad" } | null>(null);
  const [queryFile, setQueryFile] = useState<string>("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("cavcloud");
  const [cavsafeOwnerStatus, setCavsafeOwnerStatus] = useState<"unknown" | "allowed" | "denied">("unknown");
  const [mountMode, setMountMode] = useState<boolean>(false);
  const [mountProjectId, setMountProjectId] = useState<number | null>(null);
  const [mountShareId, setMountShareId] = useState<string>("");
  const [mountEntryPath, setMountEntryPath] = useState<string>("/index.html");
  const [mountBootstrapped, setMountBootstrapped] = useState<boolean>(false);
  const [mountError, setMountError] = useState<string>("");
  const [mountRefreshKey, setMountRefreshKey] = useState<number>(0);
  const [mountDisabledByQuery, setMountDisabledByQuery] = useState<boolean>(false);

  const [cavFiles, setCavFiles] = useState<FileNode[]>([]);
  const [cavAllFiles, setCavAllFiles] = useState<FileNode[]>([]);
  const [cavSelectedHtml, setCavSelectedHtml] = useState<string>("");
  const [cavSelectedCss, setCavSelectedCss] = useState<string>("");
  const [cavSelectedJs, setCavSelectedJs] = useState<string>("");
  const [attachedCssPaths, setAttachedCssPaths] = useState<string[]>([]);
  const [attachedJsPaths, setAttachedJsPaths] = useState<string[]>([]);
  const [entryPath, setEntryPath] = useState<string>("");
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceSource, setWorkspaceSource] = useState<"manual" | "cavcode" | "local">("manual");
  const [sourceAssetMode, setSourceAssetMode] = useState<SourceMode | null>(null);
  const [disableJs, setDisableJs] = useState<boolean>(false);
  const [blockExternal, setBlockExternal] = useState<boolean>(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileFullName, setProfileFullName] = useState<string>("");
  const [profileUsername, setProfileUsername] = useState<string>("");
  const [profileAvatar, setProfileAvatar] = useState<string>("");
  const [profileTone, setProfileTone] = useState<string>("lime");
  const [profilePublicEnabled, setProfilePublicEnabled] = useState<boolean | null>(null);
  const [initials, setInitials] = useState<string>("C");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  const accountOpenRef = useRef(false);
  const lastQueryLoadRef = useRef<{ path: string; content: string } | null>(null);
  const lastQueryNoticeRef = useRef<string>("");
  const assetUrlsRef = useRef<Record<string, string>>({});
  const lastCavSigRef = useRef<string>("");
  const autoMountAttemptedRef = useRef<boolean>(false);
  const remoteCavFilesRef = useRef<Record<SourceMode, FileNode[]>>({
    cavcloud: [],
    cavsafe: [],
  });
  const remoteCavFilesFetchedAtRef = useRef<Record<SourceMode, number>>({
    cavcloud: 0,
    cavsafe: 0,
  });

  const sourceFileUrlBuilder = useMemo(() => {
    if (!sourceAssetMode) return undefined;
    return (path: string) => sourceRawFileUrl(sourceAssetMode, path);
  }, [sourceAssetMode]);

  const srcDoc = useMemo(
    () =>
      buildSrcDoc({
        html,
        css,
        js,
        entryPath,
        assetUrls,
        disableJs,
        blockExternal,
        sourceFileUrlBuilder,
      }),
    [html, css, js, entryPath, assetUrls, disableJs, blockExternal, sourceFileUrlBuilder]
  );
  const mountedFrameSrc = useMemo(() => {
    const base = normalizePath(mountEntryPath || "/index.html");
    if (!mountRefreshKey) return base;
    const joiner = base.includes("?") ? "&" : "?";
    return `${base}${joiner}__cb_mount_refresh=${mountRefreshKey}`;
  }, [mountEntryPath, mountRefreshKey]);

  const [booting, setBooting] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const diag = useMemo(() => {
    const issues: string[] = [];
    const hasHtml = Boolean(html.trim());
    if (hasHtml) {
      if (!/<html[\s>]/i.test(html) && !/<!doctype/i.test(html)) {
        issues.push("No <html> or <!doctype> detected — rendering will be wrapped.");
      }
      if (!/<body[\s>]/i.test(html)) {
        issues.push("No <body> tag detected — rendering will be wrapped.");
      }
    }
    const statusLabel = !hasHtml ? "No HTML loaded" : issues.length ? "Needs attention" : "Posture clean";
    return { issues, statusLabel };
  }, [html]);
  const hasHtmlInput = Boolean(html.trim());
  const hasManualPreview = Boolean(html.trim() || css.trim() || js.trim());
  const isPreviewLive = mountMode ? mountBootstrapped : hasManualPreview;
  const accountInitials = useMemo(
    () => deriveAccountInitials(profileFullName, profileUsername, initials),
    [initials, profileFullName, profileUsername]
  );
  const normalizedProfileTone = useMemo(
    () => String(profileTone || "lime").trim().toLowerCase() || "lime",
    [profileTone]
  );

  const toast = useCallback((msg: string, tone: "good" | "watch" | "bad" = "good") => {
    setStatus({ msg, tone });
    window.setTimeout(() => setStatus(null), 2400);
  }, []);

  const replaceAssetUrls = useCallback((next: Record<string, string>) => {
    Object.values(assetUrlsRef.current).forEach((url) => {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    });
    assetUrlsRef.current = next;
    setAssetUrls(next);
  }, []);

  useEffect(() => {
    try {
      const cachedFullName = (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim();
      const cachedUsername = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().toLowerCase();
      const cachedInitials = readInitials();
      const publicEnabled = readPublicProfileEnabled();
      const tone = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim();
      const avatar = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim();

      window.setTimeout(() => {
        setProfileFullName(cachedFullName);
        setProfileUsername(cachedUsername);
        setInitials(deriveAccountInitials(cachedFullName, cachedUsername, cachedInitials));
        setProfileTone(tone || "lime");
        setProfileAvatar(avatar || "");
        if (publicEnabled !== null) setProfilePublicEnabled(publicEnabled);
      }, 0);
    } catch {}
  }, []);

  const refreshAccountProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data = (await res.json().catch(() => null)) as AuthMeResponse | null;
      if (!res.ok || !data?.ok) return;

      const nextFullName = String(data?.user?.displayName || "").trim();
      const nextUsername = String(data?.user?.username || "").trim().toLowerCase();
      const nextInitials = deriveAccountInitials(nextFullName, nextUsername, String(data?.user?.initials || ""));

      setProfileFullName(nextFullName);
      setProfileUsername(nextUsername);
      setInitials(nextInitials);

      if (typeof data?.user?.avatarTone === "string") {
        setProfileTone(data.user.avatarTone.trim().toLowerCase() || "lime");
      }
      if (typeof data?.user?.avatarImage === "string") {
        setProfileAvatar(data.user.avatarImage.trim());
      } else if (data?.user?.avatarImage === null) {
        setProfileAvatar("");
      }
      if (typeof data?.user?.publicProfileEnabled === "boolean") {
        setProfilePublicEnabled(data.user.publicProfileEnabled);
      }
    } catch {}
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      void refreshAccountProfile();
    }, 0);
    const onRefresh = () => {
      void refreshAccountProfile();
    };
    window.addEventListener("cb:auth:refresh", onRefresh as EventListener);
    return () => window.removeEventListener("cb:auth:refresh", onRefresh as EventListener);
  }, [refreshAccountProfile]);

  useEffect(() => {
    function onProfile(event: Event) {
      try {
        const d = (event as CustomEvent<Record<string, unknown>>).detail || {};
        const detailFullName = typeof d.fullName === "string" ? d.fullName.trim() : null;
        const detailUsername = typeof d.username === "string" ? d.username.trim().toLowerCase() : null;

        if (detailFullName !== null) setProfileFullName(detailFullName);
        if (detailUsername !== null) setProfileUsername(detailUsername);
        if (typeof d.initials === "string" || detailFullName !== null || detailUsername !== null) {
          const fallback = typeof d.initials === "string" ? d.initials : readInitials();
          setInitials(deriveAccountInitials(detailFullName, detailUsername, fallback));
        }
        if (typeof d.tone === "string") setProfileTone(d.tone.trim().toLowerCase() || "lime");
        if (typeof d.avatarImage === "string") setProfileAvatar(d.avatarImage.trim());
        if (d.avatarImage === null) setProfileAvatar("");
        if (typeof d.publicProfileEnabled === "boolean") setProfilePublicEnabled(d.publicProfileEnabled);
      } catch {}
    }

    window.addEventListener("cb:profile", onProfile);
    return () => window.removeEventListener("cb:profile", onProfile);
  }, []);

  useEffect(() => {
    accountOpenRef.current = accountOpen;
  }, [accountOpen]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (accountOpenRef.current && accountWrapRef.current && !accountWrapRef.current.contains(t)) {
        setAccountOpen(false);
      }
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountOpen(false);
    }

    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const publicProfileHref = useMemo(() => {
    return buildCanonicalPublicProfileHref(profileUsername);
  }, [profileUsername]);
  const profileMenuLabel = useMemo(() => {
    if (profilePublicEnabled === null) return "Profile";
    return profilePublicEnabled ? "Public Profile" : "Private Profile";
  }, [profilePublicEnabled]);

  const onOpenAccountSettings = useCallback(() => {
    setAccountOpen(false);
    if (publicProfileHref) {
      openCanonicalPublicProfileWindow({ href: publicProfileHref, fallbackHref: "/settings?tab=account" });
      return;
    }
    router.push("/settings?tab=account");
  }, [publicProfileHref, router]);

  const onLogout = useCallback(async () => {
    setAccountOpen(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
      });
    } catch {}

    if (typeof window !== "undefined") {
      window.location.replace("/auth?mode=login");
      return;
    }
    router.replace("/auth?mode=login");
  }, [router]);

  const fetchRemoteDriveFileNodes = useCallback(async (source: SourceMode): Promise<FileNode[]> => {
    const rootEndpoint = source === "cavsafe" ? "/api/cavsafe/root" : "/api/cavcloud/root";
    const childrenEndpoint = (folderId: string) =>
      source === "cavsafe"
        ? `/api/cavsafe/folders/${encodeURIComponent(folderId)}/children`
        : `/api/cavcloud/folders/${encodeURIComponent(folderId)}/children`;
    const treeEndpoint = (folderPath: string) =>
      source === "cavsafe"
        ? `/api/cavsafe/tree?lite=1&folder=${encodeURIComponent(normalizePath(folderPath))}`
        : `/api/cavcloud/tree?lite=1&folder=${encodeURIComponent(normalizePath(folderPath))}`;

    try {
      const toNode = (row: DriveFileRow, idx: number): FileNode | null => {
        const path = normalizePath(String(row?.path || ""));
        if (!path || path === "/") return null;
        const name = String(row?.name || "").trim() || basename(path) || `file-${idx + 1}`;
        return {
          id: String(row?.id || `${source}:${path}`),
          kind: "file",
          name,
          path,
          content: "",
        };
      };

      const rootRes = await fetch(rootEndpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!rootRes.ok) return [];
      const rootBody = (await rootRes.json().catch(() => null)) as DriveRootResponse | null;
      const rootFolderId = String(rootBody?.rootFolderId || rootBody?.root?.id || "").trim();

      const outById: FileNode[] = [];
      if (rootFolderId) {
        const queue: string[] = [rootFolderId];
        const visited = new Set<string>();
        let safety = 0;

        while (queue.length && safety < 6000) {
          safety += 1;
          const folderId = String(queue.shift() || "").trim();
          if (!folderId || visited.has(folderId)) continue;
          visited.add(folderId);

          const res = await fetch(childrenEndpoint(folderId), {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          if (!res.ok) continue;

          const body = (await res.json().catch(() => null)) as DriveChildrenResponse | null;
          const folders = Array.isArray(body?.folders) ? body.folders : [];
          const files = Array.isArray(body?.files) ? body.files : [];

          folders.forEach((row) => {
            const id = String(row?.id || "").trim();
            if (id && !visited.has(id)) queue.push(id);
          });

          files.forEach((row, idx) => {
            const node = toNode(row, idx);
            if (node) outById.push(node);
          });
        }

        if (outById.length) {
          const byId = dedupeFilesByPath(outById);
          const hasAttachables = byId.some(
            (f) =>
              isCssFileName(f.path) ||
              isCssFileName(f.name) ||
              isJsFileName(f.path) ||
              isJsFileName(f.name)
          );
          if (hasAttachables) return byId;
        }
      }

      // Fallback traversal by folder path (tree API) when folder-id crawl returns empty.
      const outByPath: FileNode[] = [];
      const pathQueue: string[] = ["/"];
      const visitedPaths = new Set<string>();
      let pathSafety = 0;

      while (pathQueue.length && pathSafety < 6000) {
        pathSafety += 1;
        const folderPath = normalizePath(String(pathQueue.shift() || "/"));
        if (!folderPath || visitedPaths.has(folderPath)) continue;
        visitedPaths.add(folderPath);

        const res = await fetch(treeEndpoint(folderPath), {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) continue;

        const body = (await res.json().catch(() => null)) as DriveChildrenResponse | null;
        const folders = Array.isArray(body?.folders) ? body.folders : [];
        const files = Array.isArray(body?.files) ? body.files : [];

        folders.forEach((row) => {
          const nextPath = normalizePath(String(row?.path || ""));
          if (nextPath && !visitedPaths.has(nextPath)) pathQueue.push(nextPath);
        });

        files.forEach((row, idx) => {
          const node = toNode(row, idx);
          if (node) outByPath.push(node);
        });
      }

      return dedupeFilesByPath([...outById, ...outByPath]);
    } catch {
      return [];
    }
  }, []);

  function pickEntryHtml(files: WorkspaceFile[], preferredPath?: string) {
    if (preferredPath) {
      const hit = files.find((f) => normalizePath(f.path) === normalizePath(preferredPath));
      if (hit && hit.kind === "html") return hit;
    }
    const indexHit =
      files.find((f) => f.kind === "html" && normalizePath(f.path) === "/index.html") ||
      files.find((f) => f.kind === "html" && /\/index\.html$/i.test(f.path)) ||
      files.find((f) => f.kind === "html");
    return indexHit || null;
  }

  const workspaceFilesFromCavCode = useCallback((files: FileNode[]): WorkspaceFile[] => {
    return files.map((f) => {
      const normalized = normalizePath(f.path);
      const mime = guessMime(f.path);
      const kind = detectKind(f.path);
      const raw = String(f.content || "");
      const isDataUrl = raw.startsWith("data:");
      const isBinary = kind === "image" || kind === "video" || kind === "font";
      return {
        path: normalized,
        name: f.name,
        kind,
        mime,
        content: raw,
        isBinary,
        isDataUrl,
      };
    });
  }, []);

  const workspaceFilesFromFileList = useCallback(async (files: FileList): Promise<WorkspaceFile[]> => {
    const list = Array.from(files);
    const results = await Promise.all(
      list.map(async (file) => {
        const rel = file.webkitRelativePath || file.name;
        const path = normalizePath(rel);
        const kind = detectKind(path);
        const mime = file.type || guessMime(path);
        const isBinary = kind === "image" || kind === "video" || kind === "font";
        const content = isBinary ? await file.arrayBuffer() : await file.text();
        return {
          path,
          name: file.name,
          kind,
          mime,
          content,
          isBinary,
        };
      })
    );
    return results;
  }, []);

  const buildWorkspaceFromFiles = useCallback(
    (
      files: WorkspaceFile[],
      preferredEntryPath: string | undefined,
      source: "cavcode" | "local",
      silent = false
    ) => {
      if (!files.length) return;
      const entry = pickEntryHtml(files, preferredEntryPath);
      if (!entry) {
        toast("No HTML entry found in this workspace.", "watch");
        return;
      }

      const urlMap: Record<string, string> = {};

      files.forEach((f) => {
        const normalized = normalizePath(f.path);
        if (f.kind === "css") return;
        if (typeof f.content === "string" && f.isDataUrl) {
          urlMap[normalized] = f.content;
          return;
        }
        const blob =
          typeof f.content === "string"
            ? new Blob([f.content], { type: f.mime })
            : new Blob([f.content], { type: f.mime });
        urlMap[normalized] = URL.createObjectURL(blob);
      });

      files.forEach((f) => {
        if (f.kind !== "css") return;
        const normalized = normalizePath(f.path);
        const rawCss = typeof f.content === "string" ? f.content : "";
        const rewritten = rewriteCssAssets(rawCss, normalized, urlMap, blockExternal);
        const blob = new Blob([rewritten], { type: f.mime });
        urlMap[normalized] = URL.createObjectURL(blob);
      });

      replaceAssetUrls(urlMap);
      setEntryPath(normalizePath(entry.path));
      setWorkspaceFiles(files);
      setWorkspaceSource(source);
      setSourceAssetMode(null);
      setHtml(typeof entry.content === "string" ? entry.content : "");
      setLastUpdated(nowLabel());
      if (!silent) {
        toast(`Loaded ${basename(entry.path)} with ${files.length} file${files.length === 1 ? "" : "s"}.`, "good");
      }
    },
    [blockExternal, replaceAssetUrls, toast]
  );

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const f = String(sp.get("file") || "").trim();
      if (f) {
        window.setTimeout(() => setQueryFile(normalizePath(f)), 0);
      }
      const sourceRaw = String(sp.get("source") || "").trim().toLowerCase();
      const safeFlag = String(sp.get("safe") || "").trim().toLowerCase();
      const cloudFlag = String(sp.get("cloud") || "").trim().toLowerCase();
      const sourceFromQuery: SourceMode =
        sourceRaw === "cavsafe" || sourceRaw === "safe" || safeFlag === "1" || safeFlag === "true"
          ? "cavsafe"
          : cloudFlag === "1" || cloudFlag === "true"
            ? "cavcloud"
            : "cavcloud";
      window.setTimeout(() => setSourceMode(sourceFromQuery), 0);

      const projectId = parseProjectId(sp.get("projectId") || sp.get("project"));
      const shareId = String(sp.get("shareId") || "").trim();
      const mountFlag = sp.get("mount");
      const mountDisabled = mountFlag != null && isFalsyFlag(mountFlag);
      window.setTimeout(() => setMountDisabledByQuery(mountDisabled), 0);
      const mountEntry = String(sp.get("entry") || sp.get("file") || "/index.html").trim();
      const enableMount = (projectId != null || !!shareId) && !mountDisabled;
      if (enableMount) {
        window.setTimeout(() => {
          setMountMode(true);
          setMountProjectId(projectId);
          setMountShareId(shareId);
          setMountEntryPath(normalizePath(mountEntry || "/index.html"));
        }, 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (sourceMode !== "cavsafe") return;
    let cancelled = false;
    window.setTimeout(() => {
      if (!cancelled) setCavsafeOwnerStatus("unknown");
    }, 0);
    const verifyOwnerAccess = async () => {
      try {
        const res = await fetch("/api/cavsafe/root", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        setCavsafeOwnerStatus(res.ok ? "allowed" : "denied");
      } catch {
        if (!cancelled) setCavsafeOwnerStatus("denied");
      }
    };
    void verifyOwnerAccess();
    return () => {
      cancelled = true;
    };
  }, [sourceMode]);

  useEffect(() => {
    if (mountMode) return;
    if (mountDisabledByQuery) return;
    if (autoMountAttemptedRef.current) return;

    let cancelled = false;
    autoMountAttemptedRef.current = true;

    const tryAutoMount = async () => {
      try {
        const workspaceRes = await fetch("/api/workspace", {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!workspaceRes.ok || cancelled) return;
        const workspace = (await workspaceRes.json().catch(() => null)) as { projectId?: unknown } | null;
        const projectId = parseProjectId(String(workspace?.projectId || ""));
        if (!projectId) return;

        const mountsRes = await fetch(`/api/cavcode/mounts?projectId=${encodeURIComponent(String(projectId))}`, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!mountsRes.ok || cancelled) return;
        const mountsBody = (await mountsRes.json().catch(() => null)) as { mounts?: unknown } | null;
        const mounts = Array.isArray(mountsBody?.mounts) ? mountsBody.mounts : [];
        if (!mounts.length || cancelled) return;

        setMountProjectId(projectId);
        setMountShareId("");
        setMountMode(true);
        setMountEntryPath((prev) => normalizePath(prev || "/index.html"));
        setMountError("");
      } catch {
        // Fail-open: viewer still works in plain mode if auto-mount discovery fails.
      }
    };

    void tryAutoMount();
    return () => {
      cancelled = true;
    };
  }, [mountMode, mountDisabledByQuery]);

  useEffect(() => {
    const hasScope = mountProjectId != null || String(mountShareId || "").trim().length > 0;
    if (!mountMode || !hasScope) return;

    let cancelled = false;
    const safeShareId = String(mountShareId || "").trim();
    const scopeId = mountProjectId != null ? String(mountProjectId) : safeShareId;

    const postMountContext = (clear = false) => {
      const payload = {
        type: MOUNT_SW_CONTEXT_TYPE,
        projectId: mountProjectId,
        shareId: safeShareId || null,
        viewerPrefix: "/cavcode-viewer",
        clear,
      };

      const controller = navigator.serviceWorker?.controller;
      if (controller) controller.postMessage(payload);
    };

    const boot = async () => {
      if (!("serviceWorker" in navigator)) {
        if (!cancelled) setMountError("This browser does not support Service Workers.");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register(MOUNT_SW_PATH, { scope: "/" });
        await navigator.serviceWorker.ready;
        if (cancelled) return;

        const payload = {
          type: MOUNT_SW_CONTEXT_TYPE,
          projectId: mountProjectId,
          shareId: safeShareId || null,
          viewerPrefix: "/cavcode-viewer",
          clear: false,
        };

        navigator.serviceWorker.controller?.postMessage(payload);
        registration.active?.postMessage(payload);
        registration.waiting?.postMessage(payload);
        registration.installing?.postMessage(payload);

        if (!navigator.serviceWorker.controller) {
          const guardKey = `${MOUNT_SW_RELOAD_GUARD_KEY}:${scopeId}`;
          const alreadyReloaded = globalThis.__cbSessionStore.getItem(guardKey) === "1";
          if (!alreadyReloaded) {
            globalThis.__cbSessionStore.setItem(guardKey, "1");
            window.location.reload();
            return;
          }
        } else {
          globalThis.__cbSessionStore.removeItem(`${MOUNT_SW_RELOAD_GUARD_KEY}:${scopeId}`);
        }

        setMountBootstrapped(true);
        setMountError("");
      } catch (err) {
        if (!cancelled) {
          const details =
            err instanceof Error ? `${String(err.name || "").trim()}: ${String(err.message || "").trim()}` : "";
          setMountError(details ? `Failed to initialize mount runtime. ${details}` : "Failed to initialize mount runtime.");
        }
      }
    };

    const onControllerChange = () => {
      if (cancelled) return;
      postMountContext(false);
      setMountBootstrapped(true);
      setMountError("");
    };

    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
    void boot();

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
      postMountContext(true);
    };
  }, [mountMode, mountProjectId, mountShareId]);

  // Load CavCloud/CavSafe code files from local caches and refresh on updates.
  useEffect(() => {
    let cancelled = false;

    const collectLocalCandidates = (): FileNode[] => {
      const candidates: FileNode[] = [];

      if (sourceMode === "cavcloud") {
        const fs = safeJsonParse<FolderNode>(globalThis.__cbLocalStore.getItem(LS_CAVCLOUD_FS));
        if (fs?.children) {
          candidates.push(
            ...listFiles(fs).map((f) => ({
              ...f,
              path: normalizePath(f.path),
            }))
          );
        }

        const treeKeys = listStorageKeysWithPrefix(LS_CAVCLOUD_TREE_CACHE_PREFIX);
        treeKeys.forEach((key) => {
          candidates.push(...filesFromTreeCache(globalThis.__cbLocalStore.getItem(key)));
        });
      } else {
        candidates.push(...filesFromTreeCache(globalThis.__cbLocalStore.getItem(LS_CAVSAFE_TREE_CACHE_KEY)));
      }
      return candidates;
    };

    const applyCandidates = (candidates: FileNode[]) => {
      if (cancelled) return;

      const allFiles = dedupeFilesByPath(candidates);
      const files = allFiles.filter(
        (f) =>
          isHtmlNode(f) ||
          isCssNode(f) ||
          isJsNode(f)
      );

      const sig = hashCavFiles(files, sourceMode);
      if (sig === lastCavSigRef.current) return;
      lastCavSigRef.current = sig;

      setCavAllFiles(allFiles);
      setCavFiles(files);

      if (!cavSelectedHtml) {
        const firstHtml = files.find((f) => isHtmlNode(f));
        if (firstHtml) {
          window.setTimeout(() => setCavSelectedHtml(normalizePath(firstHtml.path)), 0);
        }
      }
    };

    const maybeRefreshRemote = async (forceRemote = false): Promise<FileNode[]> => {
      if (sourceMode === "cavsafe" && cavsafeOwnerStatus === "denied") {
        remoteCavFilesRef.current.cavsafe = [];
        remoteCavFilesFetchedAtRef.current.cavsafe = Date.now();
        return [];
      }

      const now = Date.now();
      const last = Number(remoteCavFilesFetchedAtRef.current[sourceMode] || 0);
      if (!forceRemote && now - last < 20000) {
        return remoteCavFilesRef.current[sourceMode] || [];
      }

      const remote = await fetchRemoteDriveFileNodes(sourceMode);
      if (cancelled) return [];
      remoteCavFilesRef.current[sourceMode] = remote;
      remoteCavFilesFetchedAtRef.current[sourceMode] = Date.now();
      return remote;
    };

    const load = async (opts?: { forceRemote?: boolean }) => {
      const localCandidates = collectLocalCandidates();
      const cachedRemote = remoteCavFilesRef.current[sourceMode] || [];
      applyCandidates([...localCandidates, ...cachedRemote]);

      const remote = await maybeRefreshRemote(Boolean(opts?.forceRemote));
      if (cancelled) return;
      if (!remote.length && !opts?.forceRemote) return;

      const latestLocal = collectLocalCandidates();
      applyCandidates([...latestLocal, ...remote]);
    };

    const shouldForceRemote = Number(remoteCavFilesFetchedAtRef.current[sourceMode] || 0) <= 0;
    window.setTimeout(() => {
      window.setTimeout(() => setBooting(false), 0);
      void load({ forceRemote: shouldForceRemote });
    }, 0);

    const onStorage = (e: StorageEvent) => {
      if (!e) return;
      const key = String(e.key || "");
      if (!key) {
        void load();
        return;
      }
      if (sourceMode === "cavcloud") {
        if (key === LS_CAVCLOUD_FS || key.startsWith(LS_CAVCLOUD_TREE_CACHE_PREFIX)) void load();
        return;
      }
      if (key === LS_CAVSAFE_TREE_CACHE_KEY || key.startsWith(`${LS_CAVSAFE_TREE_CACHE_KEY}:`)) void load();
    };
    window.addEventListener("storage", onStorage);
    const onWorkspace = () => {
      void load({ forceRemote: true });
    };
    window.addEventListener("cb:workspace", onWorkspace as EventListener);

    // Same-tab updates don't fire storage events → polling fallback (light)
    const poll = window.setInterval(() => {
      void load();
    }, 2000);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cb:workspace", onWorkspace as EventListener);
      window.clearInterval(poll);
    };
  }, [sourceMode, cavSelectedHtml, cavsafeOwnerStatus, fetchRemoteDriveFileNodes]);

  const loadSourceTextFile = useCallback(
    async (path: string): Promise<string> => {
      const normalizedPath = normalizePath(path);
      if (sourceMode === "cavsafe" && cavsafeOwnerStatus === "denied") {
        throw new Error("CavSafe upload is owner-only in this viewer.");
      }
      const localHit = cavFiles.find((f) => normalizePath(f.path) === normalizedPath);
      if (localHit && String(localHit.content || "").length > 0) return String(localHit.content || "");

      const endpoint =
        sourceMode === "cavsafe"
          ? `/api/cavsafe/files/by-path?path=${encodeURIComponent(normalizedPath)}&raw=1`
          : `/api/cavcloud/files/by-path?path=${encodeURIComponent(normalizedPath)}&raw=1&access=1`;

      const res = await fetch(endpoint, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "text/plain,text/html,text/css,application/javascript,*/*" },
      });
      if (!res.ok) {
        let message = `Failed to load file from ${sourceLabel(sourceMode)}.`;
        try {
          const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
          if (body?.message) message = String(body.message);
        } catch {}
        if (res.status === 403 && sourceMode === "cavsafe") {
          message = "CavSafe upload is owner-only in this viewer.";
        }
        throw new Error(message);
      }
      return await res.text();
    },
    [sourceMode, cavsafeOwnerStatus, cavFiles]
  );

  const loadHtmlFromSourcePath = useCallback(
    async (path: string, silent = false) => {
      const normalizedPath = normalizePath(path);
      const selected = cavFiles.find((f) => normalizePath(f.path) === normalizedPath) || null;
      const htmlCandidate = selected ? isHtmlNode(selected) : isHtmlFileName(normalizedPath);
      if (!htmlCandidate) {
        if (!silent) toast("Pick an HTML file first.", "watch");
        return false;
      }
      try {
        const content = await loadSourceTextFile(normalizedPath);
        setCavSelectedHtml(normalizedPath);
        setHtml(content);
        setCss("");
        setJs("");
        setAttachedCssPaths([]);
        setAttachedJsPaths([]);
        setWorkspaceSource("manual");
        setSourceAssetMode(sourceMode);
        setEntryPath(normalizedPath);
        setWorkspaceFiles([]);
        replaceAssetUrls({});
        setLastUpdated(nowLabel());
        if (mountMode) setMountEntryPath(normalizedPath);
        if (!silent) {
          const label = sourceLabel(sourceMode);
          toast(`Loaded ${basename(normalizedPath)} from ${label}.`, "good");
        }
        return true;
      } catch (err) {
        if (!silent) {
          const message = err instanceof Error && err.message ? err.message : `Failed to load ${basename(normalizedPath)}.`;
          toast(message, "bad");
        }
        return false;
      }
    },
    [cavFiles, loadSourceTextFile, mountMode, replaceAssetUrls, sourceMode, toast]
  );

  const attachSourceCodePath = useCallback(
    async (path: string, kind: "css" | "js") => {
      const normalizedPath = normalizePath(path);
      const selected =
        cavFiles.find((f) => normalizePath(f.path) === normalizedPath) ||
        cavAllFiles.find((f) => normalizePath(f.path) === normalizedPath) ||
        null;
      const isCssCandidate = selected ? isCssNode(selected) : isCssFileName(normalizedPath);
      const isJsCandidate = selected ? isJsNode(selected) : isJsFileName(normalizedPath);
      if (kind === "css" && !isCssCandidate && !selected) {
        toast("Pick a CSS file first.", "watch");
        return;
      }
      if (kind === "js" && !isJsCandidate && !selected) {
        toast("Pick a JS file first.", "watch");
        return;
      }
      if (kind === "css" && attachedCssPaths.includes(normalizedPath)) {
        toast("That CSS file is already attached.", "watch");
        return;
      }
      if (kind === "js" && attachedJsPaths.includes(normalizedPath)) {
        toast("That JS file is already attached.", "watch");
        return;
      }

      try {
        const content = await loadSourceTextFile(normalizedPath);
        if (kind === "css") {
          const rewritten = rewriteCssAssets(
            content,
            normalizedPath,
            {},
            blockExternal,
            (path) => sourceRawFileUrl(sourceMode, path)
          );
          setCss((prev) => `${prev}${prev ? "\n\n" : ""}/* ${normalizedPath} */\n${rewritten}`);
          setAttachedCssPaths((prev) => [...prev, normalizedPath]);
          setCavSelectedCss("");
        } else {
          setJs((prev) => `${prev}${prev ? "\n\n" : ""}// ${normalizedPath}\n${content}`);
          setAttachedJsPaths((prev) => [...prev, normalizedPath]);
          setCavSelectedJs("");
        }
        setSourceAssetMode((prev) => prev || sourceMode);
        setLastUpdated(nowLabel());
        toast(`Attached ${basename(normalizedPath)} from ${sourceLabel(sourceMode)}.`, "good");
      } catch (err) {
        const message = err instanceof Error && err.message ? err.message : `Failed to attach ${basename(normalizedPath)}.`;
        toast(message, "bad");
      }
    },
    [attachedCssPaths, attachedJsPaths, blockExternal, cavAllFiles, cavFiles, loadSourceTextFile, sourceMode, toast]
  );

  useEffect(() => {
    if (!queryFile) return;
    const normalizedQuery = normalizePath(queryFile);
    const hit = cavAllFiles.find((f) => normalizePath(f.path) === normalizedQuery) || null;
    if (!hit) {
      const noticeKey = `missing:${normalizedQuery}:${sourceMode}`;
      if (lastQueryNoticeRef.current !== noticeKey) {
        lastQueryNoticeRef.current = noticeKey;
        window.setTimeout(() => toast(`That file is not available in ${sourceLabel(sourceMode)}.`, "watch"), 0);
      }
      return;
    }

    if (isHtmlFileName(hit.name) || isHtmlFileName(hit.path)) {
      const hitPath = normalizePath(hit.path);
      const content = String(hit.content || "");
      const last = lastQueryLoadRef.current;
      if (last && last.path === hitPath && last.content === content) return;
      lastQueryLoadRef.current = { path: hitPath, content };
      lastQueryNoticeRef.current = "";
      window.setTimeout(() => {
        void loadHtmlFromSourcePath(hitPath, true);
      }, 0);
      return;
    }

    const noticeKey = `nonhtml:${normalizePath(hit.path)}:${sourceMode}`;
    if (lastQueryNoticeRef.current !== noticeKey) {
      lastQueryNoticeRef.current = noticeKey;
      window.setTimeout(() => {
        toast("Live Viewer auto-opens HTML files only. Pick HTML or attach CSS/JS.", "watch");
      }, 0);
    }
  }, [queryFile, cavAllFiles, sourceMode, loadHtmlFromSourcePath, toast]);

  useEffect(() => {
    if (workspaceSource !== "cavcode") return;
    if (!cavAllFiles.length) return;
    const workspace = workspaceFilesFromCavCode(cavAllFiles);
    window.setTimeout(() => buildWorkspaceFromFiles(workspace, entryPath, "cavcode", true), 0);
  }, [workspaceSource, cavAllFiles, entryPath, workspaceFilesFromCavCode, buildWorkspaceFromFiles]);

  useEffect(() => {
    if (workspaceSource === "manual") return;
    if (!workspaceFiles.length) return;
    window.setTimeout(() => buildWorkspaceFromFiles(workspaceFiles, entryPath, workspaceSource, true), 0);
  }, [blockExternal, workspaceFiles, workspaceSource, entryPath, buildWorkspaceFromFiles]);

  const loadFromDesktopFiles = useCallback(
    async (files: FileList) => {
      try {
        const list = await workspaceFilesFromFileList(files);
        const hasHtml = list.some((f) => f.kind === "html");
        const hasAssets = list.some((f) => f.kind === "image" || f.kind === "video" || f.kind === "font");

        if (list.length > 1 || hasAssets || hasHtml) {
          buildWorkspaceFromFiles(list, "", "local");
          return;
        }

        const file = list[0];
        if (!file) return;
        const text = typeof file.content === "string" ? file.content : "";
        if (file.kind === "html") setHtml(text);
        else if (file.kind === "css") setCss(text);
        else if (file.kind === "js") setJs(text);
        else {
          toast("Only .html, .css, .js are supported in Live Viewer.", "watch");
          return;
        }
        setWorkspaceSource("manual");
        setSourceAssetMode(null);
        setEntryPath("/");
        setWorkspaceFiles([]);
        replaceAssetUrls({});
        setLastUpdated(nowLabel());
        toast(`Loaded ${file.name}`, "good");
      } catch {
        toast("Failed to read file.", "bad");
      }
    },
    [buildWorkspaceFromFiles, workspaceFilesFromFileList, toast, replaceAssetUrls]
  );

  // Drag & drop file handling
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || !files.length) return;

      try {
        await loadFromDesktopFiles(files);
      } catch {
        toast("Could not read dropped file.", "bad");
      }
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [loadFromDesktopFiles, toast]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) setDevice("desktop");
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    return () => {
      replaceAssetUrls({});
    };
  }, [replaceAssetUrls]);

  function toggleFullscreen() {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    setDevice("desktop");
    el.requestFullscreen?.().catch(() => {});
  }

  function openInNewTab() {
    if (mountMode) {
      window.open(mountedFrameSrc, "_blank", "noopener,noreferrer");
      toast("Opened mounted runtime in a new tab.", "good");
      return;
    }
    try {
      const blob = new Blob([srcDoc], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      toast("Opened preview in a new tab.", "good");
      // Let the tab load, then revoke later
      window.setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch {
      toast("Could not open in new tab.", "bad");
    }
  }

  function downloadHtmlFile() {
    if (!html.trim()) {
      toast("Paste or load HTML first.", "watch");
      return;
    }
    try {
      const name = cavSelectedHtml ? basename(cavSelectedHtml) : "preview.html";
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`Downloaded ${name}`, "good");
    } catch {
      toast("Download failed.", "bad");
    }
  }

  function clearViewerQueryState() {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      const resetKeys = ["projectId", "project", "shareId", "mount", "entry", "file", "source", "safe", "cloud"];
      resetKeys.forEach((key) => url.searchParams.delete(key));
      const nextSearch = url.searchParams.toString();
      const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    } catch {}
  }

  function clearMountRuntimeContext() {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const payload = {
      type: MOUNT_SW_CONTEXT_TYPE,
      projectId: null,
      shareId: null,
      viewerPrefix: "/cavcode-viewer",
      clear: true,
    };
    navigator.serviceWorker.controller?.postMessage(payload);
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage(payload);
        registration.waiting?.postMessage(payload);
        registration.installing?.postMessage(payload);
      })
      .catch(() => {});
  }

  function refreshPreview() {
    clearMountRuntimeContext();
    clearViewerQueryState();

    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    setIsFullscreen(false);
    setDevice("desktop");

    setHtml("");
    setCss("");
    setJs("");
    setLastUpdated("—");
    setQueryFile("");

    setSourceMode("cavcloud");
    setCavsafeOwnerStatus("unknown");
    setCavSelectedHtml("");
    setCavSelectedCss("");
    setCavSelectedJs("");
    setAttachedCssPaths([]);
    setAttachedJsPaths([]);

    setEntryPath("");
    setWorkspaceFiles([]);
    setWorkspaceSource("manual");
    setSourceAssetMode(null);
    replaceAssetUrls({});

    setDisableJs(false);
    setBlockExternal(false);

    setMountMode(false);
    setMountProjectId(null);
    setMountShareId("");
    setMountEntryPath("/index.html");
    setMountBootstrapped(false);
    setMountError("");
    setMountRefreshKey(0);
    setMountDisabledByQuery(true);

    lastQueryLoadRef.current = null;
    lastQueryNoticeRef.current = "";
    autoMountAttemptedRef.current = true;

    toast("Refreshed", "good");
  }

  const sourceDisplayLabel = sourceLabel(sourceMode);
  const cavsafeBlocked = sourceMode === "cavsafe" && cavsafeOwnerStatus === "denied";
  const cavsafeChecking = sourceMode === "cavsafe" && cavsafeOwnerStatus === "unknown";
  const cssSelectOptions = useMemo(() => {
    const strict = cavAllFiles.filter((f) => isCssNode(f));
    if (strict.length) return strict;
    return cavAllFiles.filter((f) => !isHtmlNode(f));
  }, [cavAllFiles]);
  const jsSelectOptions = useMemo(() => {
    const strict = cavAllFiles.filter((f) => isJsNode(f));
    if (strict.length) return strict;
    return cavAllFiles.filter((f) => !isHtmlNode(f));
  }, [cavAllFiles]);
  const renderDeviceTabs = (className = "") => (
    <div className={`ccv-seg ccv-deviceSeg ${className}`.trim()} role="tablist" aria-label="Device">
      <button
        className={`ccv-segBtn ccv-deviceSegBtn ${device === "desktop" ? "is-on" : ""}`}
        onClick={() => setDevice("desktop")}
        role="tab"
        aria-selected={device === "desktop"}
        aria-label="Desktop"
        title="Desktop"
      >
        <Image
          src="/icons/app/cavcode-viewer/desktop-svgrepo-com.svg"
          alt=""
          width={18}
          height={18}
          className="ccv-deviceSegIcon"
        />
      </button>
      <button
        className={`ccv-segBtn ccv-deviceSegBtn ${device === "tablet" ? "is-on" : ""}`}
        onClick={() => setDevice("tablet")}
        role="tab"
        aria-selected={device === "tablet"}
        aria-label="Tablet"
        title="Tablet"
      >
        <Image
          src="/icons/app/cavcode-viewer/tablet-svgrepo-com.svg"
          alt=""
          width={18}
          height={18}
          className="ccv-deviceSegIcon"
        />
      </button>
      <button
        className={`ccv-segBtn ccv-deviceSegBtn ${device === "phone" ? "is-on" : ""}`}
        onClick={() => setDevice("phone")}
        role="tab"
        aria-selected={device === "phone"}
        aria-label="Phone"
        title="Phone"
      >
        <Image
          src="/icons/app/cavcode-viewer/phone-svgrepo-com.svg"
          alt=""
          width={18}
          height={18}
          className="ccv-deviceSegIcon"
        />
      </button>
    </div>
  );

  if (booting) {
    return (
      <CavBotLoadingScreen title="CavCode Viewer" className="ent-loading" />
    );
  }

  return (
    <main className="ccv-root">
      {/* Header */}
      <header className="ccv-top" role="banner">
        <div className="ccv-topLeft">
          <div className="ccv-titlebar" aria-label="CavCode Viewer">
            <Link className="ccv-markBadgeLink" href="/" aria-label="Back to Command Center">
              <span className="ccv-markBadge">
                <Image
                  src="/logo/cavbot-logomark.svg"
                  alt=""
                  width={24}
                  height={24}
                  className="ccv-markBadgeImg"
                  priority
                  fetchPriority="high"
                  unoptimized
                />
              </span>
            </Link>
            <div className="ccv-headline">CavCode Viewer</div>
          </div>
        </div>

        <div className="ccv-topRight" aria-label="Viewer controls">
          <div className="ccv-deviceRailDesktop">{renderDeviceTabs()}</div>

          <button className="ccv-iconbtn" onClick={refreshPreview} title="Refresh" aria-label="Refresh">
            <Image
              src="/icons/refresh-circle-svgrepo-com.svg"
              alt=""
              width={18}
              height={18}
              className="ccv-iconbtnImg"
            />
          </button>
          <button className="ccv-iconbtn" onClick={openInNewTab} title="Open in new tab" aria-label="Open in new tab">
            <Image
              src="/icons/app/cavcode-viewer/new-tab-svgrepo-com.svg"
              alt=""
              width={18}
              height={18}
              className="ccv-iconbtnImg"
            />
          </button>
          <button className="ccv-iconbtn" onClick={toggleFullscreen} title="Full screen" aria-label="Full screen">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3H3v4M21 7V3h-4M3 17v4h4M21 17v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <div className="cb-account-wrap ccv-accountWrap" ref={accountWrapRef}>
            <button
              className="cb-account ccv-accountBtn"
              type="button"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
              title="Account"
              aria-label="Account"
            >
              <span
                className="cb-account-chip cb-avatar-plain"
                data-tone={normalizedProfileTone || "lime"}
                aria-hidden="true"
              >
                {profileAvatar ? (
                  <Image
                    src={profileAvatar}
                    alt=""
                    width={96}
                    height={96}
                    quality={60}
                    unoptimized
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                ) : (
                  <span className="cb-account-initials">{accountInitials}</span>
                )}
              </span>

            </button>

            {accountOpen && (
              <div className="cb-menu cb-menu-right" role="menu" aria-label="Account">
                <button className="cb-menu-item" type="button" role="menuitem" onClick={onOpenAccountSettings}>
                  {profileMenuLabel}
                </button>
                <button
                  className="cb-menu-item danger"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void onLogout();
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="ccv-mobileDeviceDock" aria-label="Mobile device controls">
        {renderDeviceTabs("ccv-deviceRailMobile")}
      </div>

      {/* Body */}
      <section className="ccv-body" aria-label="Viewer">
        {/* Left: Input */}
        <aside className="ccv-left" aria-label="Inputs">
          <div className="ccv-card">
            <div className="ccv-cardHead">
              <div className="ccv-cardTitle">Live HTML Preview</div>
              <div className="ccv-cardSub">Upload from CavCloud or CavSafe, or drag and drop a file.</div>
            </div>

            {/* Source picker */}
            <div className="ccv-block ccv-uploadBlock">
              <div className="ccv-blockTitle">Option 1 — Upload from CavCloud or CavSafe</div>
              <div className="ccv-uploadSurface">
                <div className="ccv-uploadToolbar">
                  <div className="ccv-seg ccv-uploadSeg" role="tablist" aria-label="Upload source">
                    <button
                      className={`ccv-segBtn ccv-uploadSourceBtn ${sourceMode === "cavcloud" ? "is-on" : ""}`}
                      onClick={() => setSourceMode("cavcloud")}
                      role="tab"
                      aria-selected={sourceMode === "cavcloud"}
                      aria-label="CavCloud"
                      title="CavCloud"
                    >
                      <Image
                        src="/logo/cavbot-logomark.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="ccv-uploadSourceIcon ccv-uploadSourceIconCloud"
                      />
                    </button>
                    <button
                      className={`ccv-segBtn ccv-uploadSourceBtn ${sourceMode === "cavsafe" ? "is-on" : ""}`}
                      onClick={() => setSourceMode("cavsafe")}
                      role="tab"
                      aria-selected={sourceMode === "cavsafe"}
                      aria-label="CavSafe"
                      title="CavSafe"
                    >
                      <Image
                        src="/icons/security-svgrepo-com.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="ccv-uploadSourceIcon ccv-uploadSourceIconSafe"
                      />
                    </button>
                  </div>
                </div>

                <div className="ccv-uploadSpacer" aria-hidden="true" />

                <div className="ccv-uploadField">
                  <select
                    className="ccv-select ccv-uploadSelect"
                    value={cavSelectedHtml}
                    onChange={(e) => setCavSelectedHtml(e.target.value)}
                    aria-label={`Select an HTML file from ${sourceDisplayLabel}`}
                  >
                    <option value="">Select an HTML file…</option>
                    {cavFiles.filter((f) => isHtmlNode(f)).map((f) => (
                      <option key={f.id} value={normalizePath(f.path)}>
                        {normalizePath(f.path)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ccv-uploadViewRow">
                  <button
                    className="ccv-btn ccv-btnStrong ccv-uploadAction"
                    onClick={() => {
                      if (cavsafeBlocked) return toast("CavSafe upload is owner-only in this viewer.", "watch");
                      if (!cavSelectedHtml) return toast(`Pick a ${sourceDisplayLabel} HTML file first.`, "watch");
                      void loadHtmlFromSourcePath(cavSelectedHtml);
                    }}
                    disabled={cavsafeChecking}
                  >
                    View
                  </button>
                </div>

                <div className="ccv-uploadSpacer" aria-hidden="true" />

                <div className="ccv-uploadMetric">
                  <div className="ccv-uploadMetricLabel">
                    {sourceDisplayLabel} files detected: {cavFiles.length}
                  </div>
                </div>

                {cavsafeChecking ? <div className="ccv-uploadAlert">Checking CavSafe owner access...</div> : null}
                {cavsafeBlocked ? <div className="ccv-uploadAlert">CavSafe upload is owner-only and requires CavSafe access.</div> : null}
              </div>
            </div>

            <div className="ccv-block ccv-uploadBlock">
              <div className="ccv-blockTitle">Option 1B — Attach CSS or JS (multi-file)</div>
              <div className="ccv-uploadSurface">
                <div className="ccv-uploadAttachRows">
                  <div className="ccv-uploadAttachRow">
                    <div className="ccv-uploadTag">CSS</div>
                    <select
                      className="ccv-select ccv-uploadSelect"
                      value={cavSelectedCss}
                      onChange={(e) => setCavSelectedCss(e.target.value)}
                      aria-label={`Select a CSS file from ${sourceDisplayLabel}`}
                    >
                      <option value="">Select a CSS file…</option>
                      {cssSelectOptions.map((f) => (
                        <option key={f.id} value={normalizePath(f.path)}>
                          {normalizePath(f.path)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ccv-btn ccv-uploadActionSecondary"
                      onClick={() => {
                        if (!cavSelectedCss) return toast("Pick a CSS file first.", "watch");
                        if (cavsafeBlocked) return toast("CavSafe upload is owner-only in this viewer.", "watch");
                        void attachSourceCodePath(cavSelectedCss, "css");
                      }}
                      disabled={cavsafeChecking}
                    >
                      Attach
                    </button>
                  </div>

                  <div className="ccv-uploadSpacer" aria-hidden="true" />

                  <div className="ccv-uploadAttachRow">
                    <div className="ccv-uploadTag">JS</div>
                    <select
                      className="ccv-select ccv-uploadSelect"
                      value={cavSelectedJs}
                      onChange={(e) => setCavSelectedJs(e.target.value)}
                      aria-label={`Select a JS file from ${sourceDisplayLabel}`}
                    >
                      <option value="">Select a JS file…</option>
                      {jsSelectOptions.map((f) => (
                        <option key={f.id} value={normalizePath(f.path)}>
                          {normalizePath(f.path)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="ccv-btn ccv-uploadActionSecondary"
                      onClick={() => {
                        if (!cavSelectedJs) return toast("Pick a JS file first.", "watch");
                        if (cavsafeBlocked) return toast("CavSafe upload is owner-only in this viewer.", "watch");
                        void attachSourceCodePath(cavSelectedJs, "js");
                      }}
                      disabled={cavsafeChecking}
                    >
                      Attach
                    </button>
                  </div>
                </div>

                <div className="ccv-uploadSpacer" aria-hidden="true" />

                <div className="ccv-uploadMeta">
                  <div className="ccv-uploadMetricLabel">Attached CSS: {attachedCssPaths.length}</div>
                  <span className="ccv-uploadMetaSep" aria-hidden="true">•</span>
                  <div className="ccv-uploadMetricLabel">Attached JS: {attachedJsPaths.length}</div>
                </div>

                {attachedCssPaths.length || attachedJsPaths.length ? (
                  <div className="ccv-uploadPillWrap">
                    {attachedCssPaths.map((path) => (
                      <span className="ccv-uploadPill" key={`css-${path}`}>
                        CSS · {path}
                      </span>
                    ))}
                    {attachedJsPaths.map((path) => (
                      <span className="ccv-uploadPill" key={`js-${path}`}>
                        JS · {path}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Desktop upload */}
            <div className="ccv-block ccv-uploadBlock">
              <div className="ccv-blockTitle">Option 2 — Upload from Desktop</div>

              <div className="ccv-uploadSurface">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".html,.htm,.css,.js,.mjs,.cjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.mp4,.webm,.mov,.m4v,.ogv,image/*,video/*,text/html,text/css,application/javascript"
                  multiple
                  className="ccv-file"
                  onChange={async (e) => {
                    const files = e.currentTarget.files;
                    if (!files || !files.length) return;
                    await loadFromDesktopFiles(files);
                    e.currentTarget.value = "";
                  }}
                />

                <div className="ccv-drop">
                  <div className="ccv-dropTitle">Drag &amp; drop anywhere</div>
                  <div className="ccv-dropSub">Drop a project folder or multiple files to render instantly.</div>
                </div>

                <div className="ccv-uploadSpacer" aria-hidden="true" />

                <div className="ccv-uploadViewRow">
                  <button className="ccv-btn" onClick={() => fileInputRef.current?.click()}>
                    Choose File
                  </button>
                </div>
              </div>
            </div>

            {/* Paste */}
            <div className="ccv-block">
              <div className="ccv-blockTitle">Or paste HTML</div>
              <textarea
                className="ccv-textarea"
                value={html}
                onChange={(e) => {
                  setHtml(e.target.value);
                  setLastUpdated(nowLabel());
                  setWorkspaceSource("manual");
                  setSourceAssetMode(null);
                  setEntryPath("/");
                  setWorkspaceFiles([]);
                  replaceAssetUrls({});
                }}
                placeholder={`Paste your HTML code and CavBot will preview it...`}
                spellCheck={false}
              />
              <div className="ccv-actions">
                <button
                  className="ccv-iconbtn"
                  onClick={() => {
                    navigator.clipboard?.writeText(html || "").catch(() => {});
                    toast("Copied HTML to clipboard.", "good");
                  }}
                  title="Copy HTML"
                  aria-label="Copy HTML"
                >
                  <Image src="/icons/copy-svgrepo-com.svg" alt="" width={18} height={18} className="ccv-iconbtnImg ccv-iconbtnImgWhite" aria-hidden="true" />
                </button>
                <button className="ccv-iconbtn" onClick={downloadHtmlFile} title="Download HTML" aria-label="Download HTML">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  className="ccv-btn ccv-btnGhost ccv-btnClear"
                  onClick={() => {
                    setHtml("");
                    setLastUpdated("—");
                    setWorkspaceSource("manual");
                    setSourceAssetMode(null);
                    setEntryPath("/");
                    setWorkspaceFiles([]);
                    replaceAssetUrls({});
                    toast("Cleared.", "watch");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="ccv-block ccv-elegantBlock">
              <div className={hasHtmlInput ? "ccv-diag" : "ccv-diag is-empty"}>
                <div className="ccv-diagHead">
                  <div className="ccv-diagLabel">Markup posture</div>
                  <div className={`ccv-diagStatus ${diag.issues.length ? "bad" : hasHtmlInput ? "good" : "muted"}`}>
                    {diag.statusLabel}
                  </div>
                </div>
                {diag.issues.length ? (
                  <ul className="ccv-diagList">
                    {diag.issues.map((i, idx) => (
                      <li key={`${i}-${idx}`}>{i}</li>
                    ))}
                  </ul>
                ) : (
                  <div className={hasHtmlInput ? "ccv-diagSub" : "ccv-diagSub is-empty"}>
                    {hasHtmlInput ? "No issues detected. Ready to render." : "Paste or load HTML to begin."}
                  </div>
                )}
              </div>
            </div>

            <div className="ccv-block ccv-elegantBlock">
              <div className="ccv-controlStack">
                <label className="ccv-toggle ccv-toggleRow">
                  <input
                    type="checkbox"
                    checked={disableJs}
                    onChange={(e) => setDisableJs(e.currentTarget.checked)}
                  />
                  <span className="ccv-toggleTextWrap">
                    <span className="ccv-toggleLabel">Disable JS</span>
                    <span className="ccv-toggleSub">Run preview without script execution.</span>
                  </span>
                  <span className="ccv-toggleTrack">
                    <span className="ccv-toggleThumb" />
                  </span>
                </label>

                <label className="ccv-toggle ccv-toggleRow">
                  <input
                    type="checkbox"
                    checked={blockExternal}
                    onChange={(e) => setBlockExternal(e.currentTarget.checked)}
                  />
                  <span className="ccv-toggleTextWrap">
                    <span className="ccv-toggleLabel">Block external requests</span>
                    <span className="ccv-toggleSub">Replace external assets with safe placeholders.</span>
                  </span>
                  <span className="ccv-toggleTrack">
                    <span className="ccv-toggleThumb" />
                  </span>
                </label>
              </div>
            </div>

            {mountMode ? (
              <div className="ccv-block">
                <div className="ccv-blockTitle">Mounted runtime</div>
                {mountProjectId ? <div className="ccv-hint">Project: <b>{mountProjectId}</b></div> : null}
                {mountShareId ? <div className="ccv-hint">Share: <b>{mountShareId}</b></div> : null}
                <div className="ccv-hint">Entry: <b>{normalizePath(mountEntryPath)}</b></div>
                <div className="ccv-hint">
                  {mountError ? mountError : mountBootstrapped ? "Service Worker ready." : "Initializing Service Worker mount pipeline…"}
                </div>
              </div>
            ) : null}

            <div className="ccv-meta">
              <div className="ccv-metaCard">
                <span>Last update</span>
                <b>{lastUpdated}</b>
              </div>
              <div className="ccv-metaCard">
                <span>Status</span>
                <b className={isPreviewLive ? "ok" : "muted"}>
                  {mountMode ? (mountBootstrapped ? "Mounted live" : "Mounting") : (hasManualPreview ? "Live" : "No preview")}
                </b>
              </div>
            </div>
          </div>
        </aside>

        {/* Right: Preview */}
        <section className="ccv-right" aria-label="Preview">
          <div ref={frameRef} className={`ccv-frame ${device === "phone" ? "is-phone" : device === "tablet" ? "is-tablet" : "is-desktop"} ${isFullscreen ? "is-full" : ""}`}>
            {mountMode ? (
              mountError ? (
                <div className="ccv-empty">
                  <div className="ccv-emptyTitle">Mounted runtime unavailable.</div>
                  <div className="ccv-emptySub">{mountError}</div>
                </div>
              ) : !mountBootstrapped ? (
                <div className="ccv-empty">
                  <div className="ccv-emptyTitle">Starting mounted runtime…</div>
                  <div className="ccv-emptySub">
                    Registering the Service Worker and wiring project mount context.
                  </div>
                </div>
              ) : (
                <iframe
                  ref={iframeRef}
                  title="CavCode Mounted Preview"
                  className="ccv-iframe"
                  src={mountedFrameSrc}
                  sandbox={
                    disableJs
                      ? "allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
                      : "allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                  }
                />
              )
            ) : !html.trim() && !css.trim() && !js.trim() ? (
              <div className="ccv-empty">
                <div className="ccv-emptyTitle">No preview yet.</div>
                <div className="ccv-emptySub">
                  Upload an HTML file, or paste code to render.
                </div>
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                title="CavCode Live Preview"
                className="ccv-iframe"
                srcDoc={srcDoc}
                sandbox={
                  disableJs
                    ? "allow-forms allow-modals allow-popups allow-downloads"
                    : "allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                }
              />
            )}
          </div>
        </section>
      </section>

      {/* Toast */}
      {status ? (
        <div className="ccv-toast" role="status" aria-live="polite" data-tone={status.tone}>
          {status.msg}
        </div>
      ) : null}
    </main>
  );
}
