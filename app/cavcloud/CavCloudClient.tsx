/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
"use client";

/* eslint-disable */
import * as t from "react/jsx-runtime";
import Image from "next/image";
import Link from "next/link";
import * as r from "next/navigation";
import * as c from "react";
import { CavCloudPreviewPanel } from "@/components/cavcloud/CavCloudPreviewPanel";
import { CavCloudCollaborateModal } from "@/components/cavcloud/CavCloudCollaborateModal";
import CavCloudOperationalDashboard from "@/components/cavcloud/CavCloudOperationalDashboard";
import CavCloudGoogleDriveImportModal from "@/components/cavcloud/CavCloudGoogleDriveImportModal";
import {
  CavSurfaceHeaderGreeting,
  CavSurfaceSidebarBrandMenu,
  CavSurfaceSidebarFooter
} from "@/components/cavcloud/CavSurfaceShellControls";
import { CavGuardModal } from "@/components/CavGuardModal";
import { LockIcon } from "@/components/LockIcon";
import { copyTextToClipboard } from "@/lib/clipboard";
import { countDriveListingItems, debugDriveLog, getDriveDebugEnabled, useDriveChildren } from "@/lib/cavdrive/liveData.client";
import { formatSnippetForThumbnail, getExtensionLabel, isTextLikeFile } from "@/lib/filePreview";
import { selectDesktopItemMap, shouldClearDesktopSelectionFromTarget } from "@/lib/hooks/useDesktopSelection";
import { getPlanLimits, resolvePlanIdFromTier } from "@/lib/plans";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import { emitGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import "./cavcloud.css";
const s = {
  default: Image
};
const i = {
  default: Link
};
const d = {
  x: CavCloudPreviewPanel
};
const o = () => c;
let n = o().createContext(null);
function u(e) {
  let {
      children: a
    } = e,
    [l, s] = o().useState(null),
    [i, r] = o().useState(!1),
    [c, d] = o().useState("panel"),
    [u, h] = o().useState(null),
    m = o().useCallback(e => {
      s(e.id), h(e), d("panel"), r(!0);
    }, []),
    v = o().useCallback(e => {
      s(e.id), h(e), d("page"), r(!1);
    }, []),
    p = o().useCallback(() => {
      r(!1), d("panel");
    }, []),
    f = o().useMemo(() => ({
      selectedFileId: l,
      previewOpen: i,
      previewMode: c,
      previewItem: u,
      openPreviewPanel: m,
      openPreviewPage: v,
      closePreview: p
    }), [p, v, m, u, c, i, l]);
  return t.jsx(n.Provider, {
    value: f,
    children: a
  });
}
var h = {
  copyTextToClipboard,
  T: copyTextToClipboard
};
const CAVCLOUD_UPLOAD_CONCURRENCY = 1;
const CAVCLOUD_UPLOAD_CONCURRENCY_WITH_LARGE_FILES = 1;
const CAVCLOUD_FOLDER_ENSURE_CONCURRENCY = 2;
const CAVCLOUD_MULTIPART_PART_CONCURRENCY = 4;
const CAVCLOUD_MULTIPART_THRESHOLD_BYTES = 25165824;
const CAVCLOUD_FOLDER_UPLOAD_MANIFEST_CHUNK_SIZE = 300;
const CAVCLOUD_FOLDER_UPLOAD_RETRY_ATTEMPTS = 2;
const CAVCLOUD_FOLDER_UPLOAD_RETRY_CONCURRENCY = 4;
const CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT = 300;
const CAVCLOUD_RECENTS_PAGE_SIZE = 10;
const CAVCLOUD_GALLERY_PAGE_SIZE = 6;
const CAVCLOUD_TREE_CACHE_KEY = "cb_cavcloud_tree_cache_v2";
const CAVCLOUD_DELETE_VISUAL_MS = 190;
const CAVCLOUD_POST_MUTATION_RETRY_ATTEMPTS = 4;
const CAVCLOUD_POST_MUTATION_RETRY_DELAY_MS = 220;
const CAVCODE_MOUNT_CONTEXT_TYPE = "CAVCODE_MOUNT_CONTEXT";
const CAVCODE_VIEWER_PREFIX = "/cavcode-viewer";
const CAVCLOUD_SW_EVICT_RELOAD_GUARD_KEY = "cb_cavcloud_sw_evict_reload_v1";
const CAVCLOUD_TDZ_RELOAD_GUARD_KEY = "cb_cavcloud_tdz_reload_v1";
const CAVCLOUD_FOLDER_UPLOAD_SESSION_CACHE_KEY = "cb_cavcloud_folder_upload_sessions_v1";
const PUBLIC_ARTIFACTS_SYNC_CHANNEL = "cb-public-profile-artifacts-v1";
const PUBLIC_ARTIFACTS_SYNC_KEY = "cb_public_profile_artifacts_rev_v1";
function emitPublicArtifactsSyncFromWorkspace() {
  let e = {
    username: "",
    ts: Date.now()
  };
  try {
    if ("undefined" != typeof BroadcastChannel) {
      let a = new BroadcastChannel(PUBLIC_ARTIFACTS_SYNC_CHANNEL);
      a.postMessage(e), a.close();
    }
  } catch {}
  try {
    globalThis.__cbLocalStore.setItem(PUBLIC_ARTIFACTS_SYNC_KEY, JSON.stringify(e));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("cb:public-profile-artifacts-refresh", {
      detail: e
    }));
  } catch {}
}
function createUploadDiagnosticsState() {
  return {
    sessionId: "",
    discoveredCount: 0,
    manifestSentCount: 0,
    serverCreatedCount: 0,
    uploadedCount: 0,
    failedCount: 0,
    missingCount: 0,
    failed: []
  };
}
function folderUploadFailureKey(e) {
  return `${String(e?.sessionId || "")}::${String(e?.fileId || "")}::${String(e?.relPath || "")}`;
}
function googleDriveImportFailureKey(e) {
  return `${String(e?.sessionId || "")}::${String(e?.fileId || "")}::${String(e?.relPath || "")}`;
}
function readPersistedFolderUploadSessionIds() {
  try {
    let e = JSON.parse(String(globalThis.__cbSessionStore.getItem(CAVCLOUD_FOLDER_UPLOAD_SESSION_CACHE_KEY) || "[]"));
    return Array.isArray(e) ? e.map(e => String(e || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function writePersistedFolderUploadSessionIds(e) {
  try {
    let a = Array.isArray(e) ? e.map(e => String(e || "").trim()).filter(Boolean) : [];
    globalThis.__cbSessionStore.setItem(CAVCLOUD_FOLDER_UPLOAD_SESSION_CACHE_KEY, JSON.stringify(Array.from(new Set(a)).slice(-32)));
  } catch {}
}
function addPersistedFolderUploadSessionId(e) {
  let a = String(e || "").trim();
  if (!a) return;
  let l = readPersistedFolderUploadSessionIds();
  l.includes(a) || (l.push(a), writePersistedFolderUploadSessionIds(l));
}
function removePersistedFolderUploadSessionId(e) {
  let a = String(e || "").trim();
  if (!a) return;
  writePersistedFolderUploadSessionIds(readPersistedFolderUploadSessionIds().filter(e => e !== a));
}
let m = "cb_cavcloud_activity",
  v = "cb_cavcloud_storage_history",
  p = "cb_cavcloud_storage_history_v1",
  f = [{
    key: "grid",
    label: "Grid",
    icon: "/icons/grid-1526-svgrepo-com.svg"
  }, {
    key: "grid_large",
    label: "Large grid",
    icon: "/icons/grid-system-1520-svgrepo-com.svg"
  }, {
    key: "list",
    label: "List",
    icon: "/icons/list-ul-svgrepo-com.svg"
  }, {
    key: "list_large",
    label: "Large list",
    icon: "/icons/list-svgrepo-com.svg"
  }],
  g = [{
    key: "all",
    label: "Starred"
  }, {
    key: "folders",
    label: "Folder"
  }, {
    key: "files",
    label: "File"
  }, {
    key: "gallery",
    label: "Gallery"
  }],
  x = [{
    key: "recents",
    label: "Recents"
  }, {
    key: "folders",
    label: "Folders"
  }, {
    key: "files",
    label: "Files"
  }, {
    key: "gallery",
    label: "Gallery"
  }, {
    key: "shared",
    label: "Shared"
  }, {
    key: "visited_links",
    label: "Visited links"
  }],
  COLLAB_FILTER_OPTIONS = [{
    key: "all",
    label: "Collaboration"
  }, {
    key: "readonly",
    label: "Read-only"
  }, {
    key: "edit",
    label: "Can edit"
  }, {
    key: "expiringSoon",
    label: "Expiring soon"
  }],
  RECENTS_FILTER_OPTIONS = [{
    key: "all",
    label: "All"
  }, {
    key: "folders",
    label: "Folders"
  }, {
    key: "files",
    label: "Files"
  }],
  RECENTS_TIMELINE_OPTIONS = [{
    key: "24h",
    label: "Last 24 hours"
  }, {
    key: "7d",
    label: "Last 7 days"
  }, {
    key: "30d",
    label: "Last 30 days"
  }, {
    key: "12m",
    label: "Last 12 months"
  }],
  SYNC_SOURCE_OPTIONS = [{
    key: "all",
    label: "Synced"
  }, {
    key: "cavcode",
    label: "CavCode"
  }, {
    key: "cavpad",
    label: "CavPad"
  }],
  SYNC_TIMELINE_OPTIONS = [...RECENTS_TIMELINE_OPTIONS],
  NAV_VIEW_OPTIONS = [{
    key: "cloud",
    label: "Cloud"
  }, {
    key: "folders",
    label: "Folders"
  }, {
    key: "files",
    label: "Files"
  }],
  y = [{
    key: "in_progress",
    label: "In progress"
  }, {
    key: "restored",
    label: "Restored"
  }, {
    key: "queued",
    label: "Queued"
  }, {
    key: "failed",
    label: "Failed"
  }, {
    key: "canceled",
    label: "Canceled"
  }],
  b = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "heic", "heif", "tif", "tiff"]),
  j = new Set(["mp4", "mov", "m4v", "webm", "ogv", "ogg", "avi", "mkv", "wmv", "flv", "3gp"]),
  N = new Set(["png", "jpg", "jpeg", "webp", "svg", "avif", "gif"]),
  C = new Set(["mp4", "webm", "mov", "m4v", "ogv"]),
  k = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/avif", "image/gif"]),
  w = new Set(["video/mp4", "video/webm", "video/quicktime", "video/ogg"]),
  S = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "txt", "yml", "yaml", "xml", "css", "scss", "html", "htm", "py", "go", "rs", "java", "c", "cpp", "hpp", "h", "sh"]),
  PREVIEW_TEXT_EXTENSIONS = new Set(["txt", "csv", "xml", "log", "yml", "yaml", "ini", "cfg", "conf", "properties", "webmanifest"]),
  PREVIEW_CODE_EXTENSIONS = new Set(["md", "json", "html", "css", "js", "ts", "tsx", "jsx", "mjs", "cjs", "toml", "env", "sh"]),
  PREVIEW_TEXT_MIME_TYPES = new Set(["text/plain", "text/csv", "text/xml", "application/xml"]),
  PREVIEW_CODE_MIME_TYPES = new Set(["text/markdown", "application/json", "text/html", "text/css", "application/javascript", "text/javascript", "application/typescript", "text/typescript"]),
  PREVIEW_TEXT_BASENAMES = new Set(["_headers", "_redirects", "robots.txt", "humans.txt", "security.txt", "site.webmanifest"]),
  PREVIEW_CODE_BASENAMES = new Set(["dockerfile", "makefile", "procfile", "readme", "license", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc"]),
  M = [{
    key: "Dashboard",
    label: "Dashboard",
    icon: "dashboard"
  }, {
    key: "Explore",
    label: "CavCloud",
    icon: "explore"
  }, {
    key: "Recents",
    label: "Recents",
    icon: "recents"
  }, {
    key: "Synced",
    label: "Synced",
    icon: "synced"
  }, {
    key: "Starred",
    label: "Starred",
    icon: "starred"
  }, {
    key: "Shared",
    label: "Shared",
    icon: "shared"
  }, {
    key: "Collab",
    label: "Collaboration",
    icon: "collab"
  }, {
    key: "Trash",
    label: "Recently deleted",
    icon: "trash"
  }, {
    key: "Settings",
    label: "Settings",
    icon: "settings"
  }],
  I = {
    code: "#8b5cff",
    image: "#a8ccff",
    video: "#ffcc66",
    other: "#9aa3b2"
  },
  $ = {
    code: {
      label: "Code",
      color: I.code
    },
    image: {
      label: "Images",
      color: I.image
    },
    video: {
      label: "Videos",
      color: I.video
    },
    other: {
      label: "Files",
      color: I.other
    }
  },
  L = {
    folder: {
      label: "Folders",
      color: "#b9c85a"
    },
    code: {
      label: "Code",
      color: I.code
    },
    image: {
      label: "Images",
      color: I.image
    },
    video: {
      label: "Videos",
      color: I.video
    },
    other: {
      label: "Files",
      color: I.other
    }
  };
const CAVCLOUD_THEME_OPTIONS = ["lime", "violet", "blue", "white", "clear"];
const CAVCLOUD_SETTINGS_DEFAULTS = {
  themeAccent: "lime",
  startLocation: "root",
  lastFolderId: null,
  lastFolderPath: null,
  pinnedFolderId: null,
  pinnedFolderPath: null,
  defaultView: "grid",
  defaultSort: "name",
  foldersFirst: !0,
  showExtensions: !0,
  showDotfiles: !1,
  confirmTrashDelete: !0,
  confirmPermanentDelete: !0,
  folderUploadMode: "preserveRoot",
  nameCollisionRule: "autoRename",
  uploadAutoRetry: !0,
  uploadConcurrency: "auto",
  generateTextSnippets: !0,
  computeSha256: !0,
  showUploadQueue: !0,
  shareDefaultExpiryDays: 7,
  shareAccessPolicy: "anyone",
  publishDefaultVisibility: "LINK_ONLY",
  publishRequireConfirm: !0,
  publishDefaultTitleMode: "filename",
  publishDefaultExpiryDays: 0,
  trashRetentionDays: 30,
  autoPurgeTrash: !0,
  preferDownloadUnknownBinary: !0,
  notifyStorage80: !0,
  notifyStorage95: !0,
  notifyUploadFailures: !0,
  notifyShareExpiringSoon: !0,
  notifyArtifactPublished: !0,
  notifyBulkDeletePurge: !0
};
function normalizePublishExpiryDays(e, a = 0) {
  let l = Number(null == e || "" === e ? a : e);
  if (!Number.isFinite(l)) return a;
  let t = Math.trunc(l);
  return 0 === t || 1 === t || 7 === t || 30 === t ? t : a;
}
function normalizeCavcloudClientSettings(e) {
  let a = e && "object" == typeof e ? e : {},
    l = {
      ...CAVCLOUD_SETTINGS_DEFAULTS
    },
    t = String(a.themeAccent || "").trim();
  CAVCLOUD_THEME_OPTIONS.includes(t) && (l.themeAccent = t);
  let s = String(a.startLocation || "").trim();
  ("root" === s || "lastFolder" === s || "pinnedFolder" === s) && (l.startLocation = s);
  let i = String(a.lastFolderId || "").trim(),
    r = String(a.lastFolderPath || "").trim(),
    c = String(a.pinnedFolderId || "").trim(),
    o = String(a.pinnedFolderPath || "").trim();
  l.lastFolderId = i || null, l.lastFolderPath = r || null, l.pinnedFolderId = c || null, l.pinnedFolderPath = o || null;
  let d = String(a.defaultView || "").trim();
  ("grid" === d || "list" === d) && (l.defaultView = d);
  let n = String(a.defaultSort || "").trim();
  ("name" === n || "modified" === n || "size" === n) && (l.defaultSort = n), "boolean" == typeof a.foldersFirst && (l.foldersFirst = a.foldersFirst), "boolean" == typeof a.showExtensions && (l.showExtensions = a.showExtensions), "boolean" == typeof a.showDotfiles && (l.showDotfiles = a.showDotfiles), "boolean" == typeof a.confirmTrashDelete && (l.confirmTrashDelete = a.confirmTrashDelete), "boolean" == typeof a.confirmPermanentDelete && (l.confirmPermanentDelete = a.confirmPermanentDelete);
  let u = String(a.folderUploadMode || "").trim();
  ("preserveRoot" === u || "flatten" === u) && (l.folderUploadMode = u);
  let h = String(a.nameCollisionRule || "").trim();
  ("autoRename" === h || "failAsk" === h) && (l.nameCollisionRule = h), "boolean" == typeof a.uploadAutoRetry && (l.uploadAutoRetry = a.uploadAutoRetry);
  let m = String(a.uploadConcurrency || "").trim();
  ("auto" === m || "low" === m || "high" === m) && (l.uploadConcurrency = m), "boolean" == typeof a.generateTextSnippets && (l.generateTextSnippets = a.generateTextSnippets), "boolean" == typeof a.computeSha256 && (l.computeSha256 = a.computeSha256), "boolean" == typeof a.showUploadQueue && (l.showUploadQueue = a.showUploadQueue);
  let v = Number(a.shareDefaultExpiryDays),
    p = Number.isFinite(v) ? Math.trunc(v) : l.shareDefaultExpiryDays;
  (1 === p || 7 === p || 30 === p) && (l.shareDefaultExpiryDays = p);
  let f = String(a.shareAccessPolicy || "").trim();
  ("anyone" === f || "cavbotUsers" === f || "workspaceMembers" === f) && (l.shareAccessPolicy = f);
  let g = String(a.publishDefaultVisibility || "").trim();
  ("LINK_ONLY" === g || "PUBLIC_PROFILE" === g || "PRIVATE" === g) && (l.publishDefaultVisibility = g), "boolean" == typeof a.publishRequireConfirm && (l.publishRequireConfirm = a.publishRequireConfirm);
  let x = String(a.publishDefaultTitleMode || "").trim();
  ("filename" === x || "custom" === x) && (l.publishDefaultTitleMode = x), l.publishDefaultExpiryDays = normalizePublishExpiryDays(a.publishDefaultExpiryDays, l.publishDefaultExpiryDays);
  let y = Number(a.trashRetentionDays),
    b = Number.isFinite(y) ? Math.trunc(y) : l.trashRetentionDays;
  (7 === b || 14 === b || 30 === b) && (l.trashRetentionDays = b), "boolean" == typeof a.autoPurgeTrash && (l.autoPurgeTrash = a.autoPurgeTrash), "boolean" == typeof a.preferDownloadUnknownBinary && (l.preferDownloadUnknownBinary = a.preferDownloadUnknownBinary), "boolean" == typeof a.notifyStorage80 && (l.notifyStorage80 = a.notifyStorage80), "boolean" == typeof a.notifyStorage95 && (l.notifyStorage95 = a.notifyStorage95), "boolean" == typeof a.notifyUploadFailures && (l.notifyUploadFailures = a.notifyUploadFailures), "boolean" == typeof a.notifyShareExpiringSoon && (l.notifyShareExpiringSoon = a.notifyShareExpiringSoon), "boolean" == typeof a.notifyArtifactPublished && (l.notifyArtifactPublished = a.notifyArtifactPublished), "boolean" == typeof a.notifyBulkDeletePurge && (l.notifyBulkDeletePurge = a.notifyBulkDeletePurge);
  return l;
}
function displayCavcloudFileName(e, a) {
  let l = String(e || "");
  if (a) return l;
  let t = l.lastIndexOf(".");
  return t <= 0 ? l : l.slice(0, t);
}
function A(e) {
  if (!e) return null;
  try {
    return JSON.parse(e);
  } catch {
    return null;
  }
}
function T(e) {
  let a = String(e || "").trim();
  if (!a) return "/";
  let l = (a.startsWith("/") ? a : `/${a}`).replace(/\/+/g, "/");
  return l.length > 1 && l.endsWith("/") ? l.slice(0, -1) : l;
}
function O(e, a) {
  let l = T(e);
  return "/" === l ? T(`/${a}`) : T(`${l}/${a}`);
}
function safeUploadNodeName(e) {
  let a = String(e || "").trim();
  if (!a || "." === a || ".." === a) return null;
  if (/[/\\]/.test(a)) return null;
  let l = a.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!l) return null;
  return l.length > 220 ? l.slice(0, 220) : l;
}
function normalizeUploadFolderPath(e) {
  let a = T(e),
    l = a.split("/").filter(Boolean),
    t = "/";
  for (let e of l) {
    let a = safeUploadNodeName(e);
    if (!a) return null;
    t = O(t, a);
  }
  return t;
}
function joinUploadFolderPath(e, a) {
  let l = normalizeUploadFolderPath(e);
  if (!l) return null;
  if (!Array.isArray(a) || !a.length) return l;
  let t = l;
  for (let e of a) {
    let a = safeUploadNodeName(e);
    if (!a) return null;
    t = O(t, a);
  }
  return t;
}
function uploadAutoRenamedName(e, a) {
  let l = String(e || "").trim() || "file",
    t = Math.max(2, Math.trunc(Number(a) || 2)),
    s = l.lastIndexOf(".");
  if (s <= 0 || s === l.length - 1) return `${l}-${t}`;
  let i = l.slice(0, s),
    r = l.slice(s);
  return `${i}-${t}${r}`;
}
function F(e, a = "/cavcloud") {
  let l = String(e || "").trim();
  if (!l) return a;
  let t = T(l);
  return "/" === t ? a : t;
}
function P(e) {
  if (null == e) return "∞";
  if (!Number.isFinite(e) || e <= 0) return "0 B";
  let a = ["B", "KB", "MB", "GB", "TB"],
    l = e,
    t = 0;
  for (; l >= 1024 && t < a.length - 1;) l /= 1024, t += 1;
  return `${l.toFixed(l >= 10 || 0 === t ? 0 : 1)} ${a[t]}`;
}
function B(e) {
  let a = Date.parse(e);
  if (!Number.isFinite(a)) return "—";
  try {
    return new Date(a).toLocaleString(void 0, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}
function resolveCavcloudUserLabel(e) {
  let a = String(e?.name || "").trim();
  if (a) return a;
  let l = String(e?.email || "").trim();
  if (l) return l;
  let t = String(e?.username || "").trim();
  return t || "CavCloud user";
}
function resolveCavcloudGreetingName(e) {
  let a = String(e?.name || "").trim();
  if (a) return a.split(/\s+/g).filter(Boolean)[0] || "there";
  return "there";
}
function resolveCavcloudInitialChar(e) {
  let a = String(e || "").match(/[A-Za-z0-9]/);
  return a?.[0]?.toUpperCase() || "";
}
function resolveCavcloudInitialUsername(e) {
  let a = String(e || "").trim().replace(/^@+/, "");
  if (!a) return "";
  if (!/^https?:\/\//i.test(a)) return a;
  try {
    let e = new URL(a).pathname.split("/").filter(Boolean),
      l = e[e.length - 1] || "";
    return l.replace(/^@+/, "");
  } catch {
    return a;
  }
}
function resolveCavcloudInitials(e) {
  let a = String(e?.name || "").trim();
  if (a) {
    let e = a.split(/\s+/g).filter(Boolean);
    if (e.length >= 2) {
      let a = resolveCavcloudInitialChar(e[0] || ""),
        l = resolveCavcloudInitialChar(e[1] || ""),
        t = `${a}${l}`.trim();
      if (t) return t;
    }
    let l = resolveCavcloudInitialChar(e[0] || "");
    if (l) return l;
  }
  let l = resolveCavcloudInitialChar(resolveCavcloudInitialUsername(e?.username));
  if (l) return l;
  let t = resolveCavcloudInitialChar(e?.initials);
  return t || "C";
}
function resolveCavcloudPlanTier(e) {
  let a = String(e?.tierEffective || e?.tier || "").trim().toUpperCase();
  if ("PREMIUM_PLUS" === a || "PREMIUM+" === a || "ENTERPRISE" === a) return "PREMIUM_PLUS";
  if ("PREMIUM" === a || "PRO" === a || "PAID" === a) return "PREMIUM";
  return "FREE";
}
function readCachedCavcloudPlanState() {
  let e = {
    planTier: "FREE",
    trialActive: !1,
    trialDaysLeft: 0
  };
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return e;
  try {
    let a = A(globalThis.__cbLocalStore.getItem("cb_shell_plan_snapshot_v1"));
    if (a && "object" == typeof a && !Array.isArray(a)) {
      let l = resolveCavcloudPlanTier({
          tierEffective: String(a?.planTier || "").trim()
        }),
        t = !!a?.trialActive,
        s = Number(a?.trialDaysLeft);
      return {
        planTier: l,
        trialActive: t,
        trialDaysLeft: t && Number.isFinite(s) && s > 0 ? Math.max(0, Math.trunc(s)) : 0
      };
    }
  } catch {}
  try {
    let a = A(globalThis.__cbLocalStore.getItem("cb_plan_context_v1"));
    if (a && "object" == typeof a && !Array.isArray(a)) {
      let l = resolveCavcloudPlanTier({
        tierEffective: String(a?.planKey || a?.planLabel || "").trim()
      });
      return {
        planTier: l,
        trialActive: !!a?.trialActive,
        trialDaysLeft: 0
      };
    }
  } catch {}
  return e;
}
function resolveCavcloudTrialState(e) {
  let a = !!e?.trialActive,
    l = Number(e?.trialDaysLeft),
    t = Number.isFinite(l) ? Math.max(0, Math.trunc(l)) : 0;
  if (!a) {
    let lEndsAt = eo(e?.trialEndsAt);
    a = !!e?.trialSeatActive && null != lEndsAt && lEndsAt > Date.now();
    a && null != lEndsAt && (t = Math.max(0, Math.ceil((lEndsAt - Date.now()) / 864e5)));
  }
  return {
    active: a,
    daysLeft: t
  };
}
function resolveCavcloudStorageLimitBytes(e, a = !1) {
  if (a) return null;
  let l = getPlanLimits(resolvePlanIdFromTier(e)).storageGb;
  if ("unlimited" === l) return null;
  let t = Number(l || 0) * 1024 * 1024 * 1024;
  return Number.isFinite(t) && t > 0 ? Math.trunc(t) : null;
}
function readInitialCavcloudTreeSnapshot(e) {
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return null;
  try {
    let a = A(globalThis.__cbLocalStore.getItem(e)),
      l = R(a?.payload),
      t = R(l?.folder);
    if (!l || !t) return null;
    let s = T(String(t.path || a?.folderPath || "/"));
    return {
      folder: {
        ...t,
        path: s
      },
      breadcrumbs: Array.isArray(l.breadcrumbs) ? l.breadcrumbs : [],
      folders: Array.isArray(l.folders) ? l.folders : [],
      files: Array.isArray(l.files) ? l.files : [],
      trash: Array.isArray(l.trash) ? l.trash : [],
      usage: R(l.usage),
      activity: W(l.activity),
      storageHistory: H(l.storageHistory)
    };
  } catch {
    return null;
  }
}
function R(e) {
  return !e || "object" != typeof e || Array.isArray(e) ? null : e;
}
function U(e, a) {
  if (!e) return null;
  let l = e[a];
  if ("number" == typeof l) return Number.isFinite(l) ? l : null;
  let t = Number(l);
  return Number.isFinite(t) ? t : null;
}
function E(e) {
  let a = String(e.action || "").toLowerCase(),
    l = String(e.targetPath || "").trim(),
    t = R(e.metaJson),
    s = U(t, "fileCount"),
    i = l ? F(l) : "—";
  if ("file.upload.simple" === a || "file.upload.multipart.complete" === a || "upload.files" === a) return {
    label: "Uploaded file",
    meta: i
  };
  if ("file.sync.upsert" === a) return {
    label: "Synced file",
    meta: i
  };
  if ("upload.folder" === a) {
    let e = s && s > 0 ? `${Math.trunc(s)} files` : "folder upload";
    return {
      label: "Uploaded folder",
      meta: l ? `${i} • ${e}` : e
    };
  }
  if ("upload.camera_roll" === a) {
    let e = s && s > 0 ? `${Math.trunc(s)} file${1 === Math.trunc(s) ? "" : "s"}` : "";
    return {
      label: "Uploaded from camera roll",
      meta: e ? `${i} • ${e}` : i
    };
  }
  if ("upload.preview" === a) return {
    label: "Upload & Preview",
    meta: i
  };
  if ("folder.create" === a) return {
    label: "Created folder",
    meta: i
  };
  if ("file.metadata.create" === a) return {
    label: "Created file",
    meta: i
  };
  if ("file.delete" === a || "folder.delete" === a) return {
    label: "Moved to recently deleted",
    meta: i
  };
  if ("trash.restore" === a) return {
    label: "Restored from recently deleted",
    meta: i
  };
  if ("trash.permanent_delete" === a) return {
    label: "Permanent delete",
    meta: i
  };
  if ("share.create" === a) return {
    label: "Shared",
    meta: i
  };
  if ("share.revoke" === a || "share.unshare" === a) return {
    label: "Unshared",
    meta: i
  };
  if ("artifact.publish" === a) return {
    label: "Published artifact",
    meta: i
  };
  if ("artifact.unpublish" === a) return {
    label: "Updated artifact visibility",
    meta: i
  };
  if ("collab.grant" === a || "access_granted" === a) return {
    label: "Collaboration granted",
    meta: i
  };
  if ("collab.revoke" === a || "access_revoked" === a) return {
    label: "Collaboration revoked",
    meta: i
  };
  if ("file.star" === a) return {
    label: "Starred",
    meta: i
  };
  if ("file.unstar" === a) return {
    label: "Unstarred",
    meta: i
  };
  if ("file.update" === a || "folder.update" === a) {
    let e = String(t?.fromPath || "").trim(),
      a = String(t?.toPath || "").trim();
    return e && a && e !== a ? {
      label: "Renamed / moved",
      meta: `${F(e)} → ${F(a)}`
    } : {
      label: "Updated",
      meta: i
    };
  }
  return {
    label: a ? a.replace(/[._]/g, " ") : "Activity",
    meta: i
  };
}
function D(e) {
  let a = R(e.metaJson),
    l = String(a?.status || a?.restoreStatus || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ("in_progress" === l) return "in_progress";
  if ("restored" === l) return "restored";
  if ("queued" === l) return "queued";
  if ("failed" === l) return "failed";
  if ("canceled" === l) return "canceled";
  let t = String(e.action || "").trim().toLowerCase();
  return t.includes("in_progress") || t.includes("inprogress") || t.includes("processing") ? "in_progress" : t.includes("queue") ? "queued" : t.includes("fail") || t.includes("error") ? "failed" : t.includes("cancel") ? "canceled" : "restored";
}
function _(e) {
  return "in_progress" === e ? "In progress" : "queued" === e ? "Queued" : "failed" === e ? "Failed" : "canceled" === e ? "Canceled" : "Restored";
}
function W(e) {
  return Array.isArray(e) ? e.map(e => e?.id && e?.action && e?.createdAtISO ? {
    id: String(e.id),
    action: String(e.action),
    targetType: String(e.targetType || "item"),
    targetId: null == e.targetId ? null : String(e.targetId),
    targetPath: null == e.targetPath ? null : String(e.targetPath),
    createdAtISO: String(e.createdAtISO),
    metaJson: R(e.metaJson)
  } : null).filter(e => !!e) : [];
}
function H(e) {
  return Array.isArray(e) ? e.map(e => {
    let a = Number(e?.ts),
      l = Number(e?.usedBytes);
    return Number.isFinite(a) && Number.isFinite(l) ? {
      ts: Math.trunc(a),
      usedBytes: Math.max(0, Math.trunc(l)),
      usedBytesExact: String(e?.usedBytesExact || Math.max(0, Math.trunc(l)))
    } : null;
  }).filter(e => !!e).sort((e, a) => e.ts - a.ts) : [];
}
function G(e) {
  let a = String(e || "").trim(),
    l = a.split(/\s+/g);
  return l.length <= 1 ? {
    num: a,
    unit: ""
  } : {
    num: l.slice(0, -1).join(" "),
    unit: l[l.length - 1]
  };
}
function K(e, a) {
  return `${e}:${a}`;
}
function J(e) {
  let a = String(e || "").trim().toLowerCase(),
    l = a.lastIndexOf(".");
  return l < 0 ? "" : a.slice(l + 1);
}
function V(e, a = "") {
  return getExtensionLabel(e, a);
}
function Z(e) {
  let a = String(e || "").trim();
  if (!a) return "";
  let l = a.split("#")[0]?.split("?")[0] || a,
    t = l.split("/").filter(Boolean);
  return t.length ? t[t.length - 1] : l;
}
function z(e, a) {
  let l = String(e || "").trim().toLowerCase();
  return !!l.startsWith("image/") || !l.startsWith("video/") && b.has(J(a));
}
function q(e, a) {
  let l = String(e || "").trim().toLowerCase();
  return !!l.startsWith("video/") || !l.startsWith("image/") && j.has(J(a));
}
function Y(e) {
  if ("file" !== e.kind) return null;
  let a = String(e.name || e.path || "").trim();
  return a ? z("", a) ? "image" : q("", a) ? "video" : null : null;
}
function Q(e) {
  let a = String(e?.name || e?.path || "").trim();
  return z(e.mimeType, a) ? "image" : q(e.mimeType, a) ? "video" : null;
}
function X(e, a) {
  if ("file" !== e.targetType) return null;
  let l = e.targetId ? a.get(e.targetId) : void 0,
    t = l?.name || Z(e.path) || e.path,
    s = String(l?.mimeType || "");
  return z(s, t) ? "image" : q(s, t) ? "video" : null;
}
function ee(e, a) {
  let l = String(e || "").trim().toLowerCase();
  return l && "application/octet-stream" !== l ? l : es(a) || "application/octet-stream";
}
function ea(e, a) {
  let l = ee(e, a),
    t = J(a);
  return k.has(l) || N.has(t) ? "image" : w.has(l) || C.has(t) ? "video" : null;
}
function ePreviewKind(e, a) {
  let l = ee(e, a),
    t = J(a),
    s = Z(a).toLowerCase();
  if (k.has(l) || N.has(t)) return "image";
  if (w.has(l) || C.has(t)) return "video";
  if (PREVIEW_CODE_MIME_TYPES.has(l) || PREVIEW_CODE_EXTENSIONS.has(t)) return "code";
  if (l.startsWith("text/") || PREVIEW_TEXT_MIME_TYPES.has(l) || PREVIEW_TEXT_EXTENSIONS.has(t)) return "text";
  // Root-cause fix: extensionless config files (_headers, Dockerfile, .env.*) were marked unknown and showed "Preview unavailable".
  if (s.startsWith(".env") || PREVIEW_CODE_BASENAMES.has(s)) return "code";
  if (PREVIEW_TEXT_BASENAMES.has(s)) return "text";
  if (isTextLikeFile(a, l)) return "text";
  return "unknown";
}
function el(e, a, l) {
  return "artifact" === e ? `/api/cavcloud/artifacts/${encodeURIComponent(a)}/preview?raw=1` : "trash" === e ? `/api/cavcloud/trash/${encodeURIComponent(a)}?raw=1` : "by_path" === e ? `/api/cavcloud/files/by-path?path=${encodeURIComponent(l)}&raw=1&access=1` : `/api/cavcloud/files/${encodeURIComponent(a)}?raw=1&access=1`;
}
function et(e) {
  let a = new URLSearchParams();
  let l = eBytes(e.bytes);
  return a.set("source", e.source), a.set("kind", String(e.previewKind || e.mediaKind || "unknown")), a.set("name", e.name), a.set("path", e.path), a.set("mime", e.mimeType), null != l && a.set("bytes", String(l)), e.createdAtISO && a.set("created", e.createdAtISO), e.modifiedAtISO && a.set("modified", e.modifiedAtISO), e.uploadedAtISO && a.set("uploaded", e.uploadedAtISO), e.uploadedBy && a.set("uploadedBy", e.uploadedBy), e.shareUrl && a.set("shareUrl", e.shareUrl), e.shareFileId && a.set("shareFileId", e.shareFileId), `/cavcloud/view/${encodeURIComponent(e.resourceId)}?${a.toString()}`;
}
function es(e) {
  let a = J(e);
  return a ? b.has(a) ? "jpg" === a ? "image/jpeg" : "svg" === a ? "image/svg+xml" : "heic" === a ? "image/heic" : "heif" === a ? "image/heif" : "tif" === a ? "image/tiff" : `image/${a}` : j.has(a) ? "ogv" === a ? "video/ogg" : "m4v" === a ? "video/mp4" : "3gp" === a ? "video/3gpp" : `video/${a}` : "pdf" === a ? "application/pdf" : "doc" === a ? "application/msword" : "docx" === a ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "xls" === a ? "application/vnd.ms-excel" : "xlsx" === a ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "ppt" === a ? "application/vnd.ms-powerpoint" : "pptx" === a ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "psd" === a ? "application/vnd.adobe.photoshop" : "ai" === a ? "application/postscript" : "csv" === a ? "text/csv" : "txt" === a ? "text/plain" : "json" === a ? "application/json" : null : null;
}
function ei(e, a) {
  let l = String(e.type || "").trim().toLowerCase();
  return l && "application/octet-stream" !== l ? l : es(a || e.name) || l || "application/octet-stream";
}
function er(e) {
  if (z(e.mimeType, e.name)) return "image";
  if (q(e.mimeType, e.name)) return "video";
  let a = J(e.name);
  return S.has(a) ? "code" : "other";
}
function ec(e) {
  let a = Date.parse(e);
  return Number.isFinite(a) ? Math.max(0, Math.ceil((a - Date.now()) / 864e5)) : 0;
}
function eo(e) {
  if (null == e) return null;
  if ("number" == typeof e) return Number.isFinite(e) ? e : null;
  let a = Date.parse(String(e));
  return Number.isFinite(a) ? a : null;
}
function eBytes(e) {
  if (null == e) return null;
  let a = Number(e);
  return Number.isFinite(a) && a >= 0 ? Math.max(0, Math.trunc(a)) : null;
}
function ed(e) {
  if (!Number.isFinite(e)) return "";
  let a = new Date(e);
  return new Date(a.getTime() - 6e4 * a.getTimezoneOffset()).toISOString().slice(0, 16);
}
function en(e) {
  return eo(e.updatedAtISO) ?? eo(e.createdAtISO) ?? 0;
}
function eFirstActivityFileName(e) {
  if (!e || "object" != typeof e || Array.isArray(e)) return "";
  let a = Array.isArray(e.fileNames) ? e.fileNames : [];
  for (let eName of a) {
    let aName = String(eName || "").trim().replace(/[\\/]/g, "").slice(0, 220);
    if (aName) return aName;
  }
  return "";
}
function eRecentTargetKind(e) {
  let a = String(e?.action || "").trim().toLowerCase(),
    l = String(e?.targetType || "").trim().toLowerCase();
  return "folder" === l || "upload.folder" === a || a.startsWith("folder.") ? "folder" : "file";
}
function eRecentTargetPath(e) {
  let a = T(String(e?.targetPath || "/"));
  if ("folder" === eRecentTargetKind(e)) return a;
  let l = eFirstActivityFileName(e?.metaJson);
  if (!l) return a;
  if ("/" === a) return O("/", l);
  let t = a.split("/").filter(Boolean).pop() || "";
  return J(t) ? a : O(a, l);
}
function fileStatusRank(e) {
  let a = String(e || "READY").trim().toUpperCase();
  return "READY" === a ? 0 : "UPLOADING" === a ? 1 : "FAILED" === a ? 2 : 3;
}
function eu(e, a) {
  let lStatus = fileStatusRank(e?.status) - fileStatusRank(a?.status);
  if (0 !== lStatus) return lStatus;
  let l = en(a) - en(e);
  if (0 !== l) return l;
  let t = e.name.localeCompare(a.name, void 0, {
    sensitivity: "base"
  });
  return 0 !== t ? t : e.path.localeCompare(a.path, void 0, {
    sensitivity: "base"
  });
}
function eh(e) {
  let a = T(e);
  if ("/" === a) return "/";
  let l = a.split("/").filter(Boolean);
  return (l.pop(), l.length) ? `/${l.join("/")}` : "/";
}
function em(e, a) {
  let l = T(e).toLowerCase(),
    t = T(a).toLowerCase();
  return !t || "/" === t || l === t || l.startsWith(`${t}/`);
}
async function ev(e) {
  let a = await e.json().catch(() => null);
  emitGuardDecisionFromPayload(a);
  return a;
}
function shouldRetryCavcloudTreeLoad(e, a) {
  let l = Math.max(0, Math.trunc(Number(e) || 0)),
    t = String(a?.error || "").trim().toUpperCase();
  if (401 === l || 403 === l || 404 === l) return !1;
  if (408 === l || 429 === l) return !0;
  if (l >= 500) return !0;
  return "RATE_LIMITED" === t || "TX_TIMEOUT" === t || "SERVICE_UNAVAILABLE" === t;
}
async function folderPathExistsLite(e) {
  let a = normalizeUploadFolderPath(e);
  if (!a) return !1;
  try {
    let e = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(a)}&lite=1`, {
        method: "GET",
        cache: "no-store"
      }),
      l = await ev(e);
    return !!(e.ok && l?.ok && l.folder);
  } catch {
    return !1;
  }
}
function ep(e) {
  let a = String(e || "").trim();
  if (!a) return;
  let l = document.createElement("a");
  l.href = a, l.style.position = "fixed", l.style.left = "-9999px", l.rel = "noreferrer", document.body.appendChild(l), l.click(), l.remove();
}
async function ef(e) {
  let a = await e.arrayBuffer(),
    l = new Uint8Array(await crypto.subtle.digest("SHA-256", a)),
    t = "";
  for (let e = 0; e < l.length; e++) t += l[e].toString(16).padStart(2, "0");
  return t;
}
function pickUploadConcurrency(e, a = "auto") {
  let l = String(a || "auto").trim().toLowerCase();
  if ("low" === l) return 1;
  if ("high" === l) return 4;
  return Array.isArray(e) && e.some(e => e.size >= CAVCLOUD_MULTIPART_THRESHOLD_BYTES) ? CAVCLOUD_UPLOAD_CONCURRENCY_WITH_LARGE_FILES : CAVCLOUD_UPLOAD_CONCURRENCY;
}
async function runWithConcurrency(e, a, l) {
  if (!Array.isArray(e) || !e.length) return;
  let t = Math.max(1, Math.min(Math.trunc(Number(a) || 1), e.length)),
    s = 0,
    i = async () => {
      for (;;) {
        let a = s;
        if (s += 1, a >= e.length) return;
        await l(e[a], a);
      }
    };
  await Promise.all(Array.from({
    length: t
  }, () => i()));
}
function normalizeUploadRelativePath(e) {
  let a = String(e || "").replace(/\\/g, "/").split("/").filter(Boolean),
    l = [];
  for (let e of a) {
    let a = safeUploadNodeName(e);
    if (!a) return null;
    l.push(a);
  }
  return l.length ? l.join("/") : null;
}
function uploadEntryFingerprint(e, a) {
  let l = Number(a?.size) || 0,
    t = Number(a?.lastModified) || 0;
  return `${String(e || "")}::${l}:${t}`;
}
function chunkArray(e, a) {
  if (!Array.isArray(e) || !e.length) return [];
  let l = Math.max(1, Math.trunc(Number(a) || 1)),
    t = [];
  for (let a = 0; a < e.length; a += l) t.push(e.slice(a, a + l));
  return t;
}
function uploadRootNameFromRelativePath(e) {
  let a = normalizeUploadRelativePath(e);
  if (!a) return null;
  let l = a.split("/").filter(Boolean);
  return l.length ? l[0] : null;
}
function uploadDepthFromRelativePath(e) {
  let a = normalizeUploadRelativePath(e);
  if (!a) return 0;
  return Math.max(0, a.split("/").filter(Boolean).length);
}
async function readFileSystemEntryFile(e) {
  return await new Promise((a, l) => {
    try {
      e.file(e => a(e), e => l(e || Error("Failed to read file entry.")));
    } catch (e) {
      l(e);
    }
  });
}
async function readFileSystemDirectoryEntries(e) {
  return await new Promise((a, l) => {
    try {
      e.readEntries(e => a(Array.isArray(e) ? e : []), e => l(e || Error("Failed to read folder entries.")));
    } catch (e) {
      l(e);
    }
  });
}
async function collectUploadEntriesFromFileSystemRoots(e) {
  let a = [],
    l = [];
  for (let a of Array.isArray(e) ? e : []) {
    if (!a) continue;
    let e = safeUploadNodeName(String(a.name || ""));
    if (!e) continue;
    l.push({
      entry: a,
      relativePath: e
    });
  }
  for (; l.length;) {
    let e = l.shift();
    if (!e?.entry) continue;
    if (e.entry.isFile) {
      let lFile = null;
      try {
        lFile = await readFileSystemEntryFile(e.entry);
      } catch {
        continue;
      }
      lFile && a.push({
        file: lFile,
        relativePath: e.relativePath
      });
      continue;
    }
    if (!e.entry.isDirectory || "function" != typeof e.entry.createReader) continue;
    let t = null;
    try {
      t = e.entry.createReader();
    } catch {
      continue;
    }
    if (!t) continue;
    for (;;) {
      let s = [];
      try {
        s = await readFileSystemDirectoryEntries(t);
      } catch {
        break;
      }
      if (!s.length) break;
      for (let t of s) {
        if (!t) continue;
        let s = safeUploadNodeName(String(t.name || ""));
        if (!s) continue;
        let i = normalizeUploadRelativePath(`${e.relativePath}/${s}`);
        i && l.push({
          entry: t,
          relativePath: i
        });
      }
    }
  }
  return a;
}
function getInputFileSystemEntries(e) {
  let a = e?.webkitEntries;
  return a && "number" == typeof a.length ? Array.from(a).filter(Boolean) : [];
}
function getDataTransferFileSystemEntries(e) {
  let a = Array.from(e?.items || []),
    l = [];
  for (let e of a) {
    let a = "function" == typeof e?.webkitGetAsEntry ? e.webkitGetAsEntry() : "function" == typeof e?.getAsEntry ? e.getAsEntry() : null;
    a && l.push(a);
  }
  return l;
}
function getDataTransferFileSystemHandles(e) {
  let a = Array.from(e?.items || []),
    l = [];
  for (let e of a) {
    let a = "function" == typeof e?.getAsFileSystemHandle ? e.getAsFileSystemHandle() : null;
    a && l.push(a);
  }
  return l;
}
async function collectUploadEntriesFromFileSystemHandles(e) {
  let a = [],
    l = [];
  for (let aPromise of Array.isArray(e) ? e : []) {
    let e = null;
    try {
      e = await aPromise;
    } catch {
      continue;
    }
    if (!e || "string" != typeof e.kind) continue;
    let t = safeUploadNodeName(String(e.name || ""));
    if (!t) continue;
    l.push({
      handle: e,
      relativePath: t
    });
  }
  for (; l.length;) {
    let e = l.shift();
    if (!e?.handle) continue;
    if ("file" === e.handle.kind) {
      let lFile = null;
      try {
        lFile = await e.handle.getFile();
      } catch {
        continue;
      }
      lFile && a.push({
        file: lFile,
        relativePath: e.relativePath
      });
      continue;
    }
    if ("directory" !== e.handle.kind || "function" != typeof e.handle.entries) continue;
    let t = e.handle.entries();
    if (!t || "function" != typeof t[Symbol.asyncIterator]) continue;
    try {
      for await (let [aName, aHandle] of t) {
        let t = safeUploadNodeName(String(aName || ""));
        if (!t || !aHandle) continue;
        let s = normalizeUploadRelativePath(`${e.relativePath}/${t}`);
        s && l.push({
          handle: aHandle,
          relativePath: s
        });
      }
    } catch {
      continue;
    }
  }
  return a;
}
async function collectFolderUploadEntries(e) {
  let a = Array.isArray(e?.fileSystemEntries) ? e.fileSystemEntries.filter(Boolean) : [],
    l = Array.isArray(e?.fileSystemHandles) ? e.fileSystemHandles.filter(Boolean) : [],
    t = Array.isArray(e?.files) ? e.files.filter(e => e instanceof File) : [],
    s = a.length ? await collectUploadEntriesFromFileSystemRoots(a) : [],
    i = l.length ? await collectUploadEntriesFromFileSystemHandles(l) : [],
    r = [...s, ...i],
    c = new Set(r.map(e => uploadEntryFingerprint(e.relativePath, e.file)));
  for (let e of t) {
    let a = normalizeUploadRelativePath(String(e.webkitRelativePath || ""));
    if (r.length && (!a || !a.includes("/"))) continue;
    let l = a || normalizeUploadRelativePath(String(e.name || ""));
    if (!l) continue;
    let t = uploadEntryFingerprint(l, e);
    c.has(t) || (c.add(t), r.push({
      file: e,
      relativePath: l
    }));
  }
  return r;
}
function collectFolderUploadRootGroups(e) {
  let a = new Map();
  for (let l of Array.isArray(e) ? e : []) {
    let t = l?.file instanceof File ? l.file : null,
      s = normalizeUploadRelativePath(String(l?.relativePath || t?.webkitRelativePath || t?.name || ""));
    if (!t || !s) continue;
    let i = s.split("/").filter(Boolean);
    if (i.length < 2) continue;
    let r = i[0],
      c = a.get(r);
    c || (c = [], a.set(r, c)), c.push({
      file: t,
      relativePath: s
    });
  }
  return Array.from(a.entries()).map(([e, a]) => ({
    rootName: e,
    entries: a
  }));
}
function summarizeFolderUploadEntries(e) {
  let a = 0,
    l = 0;
  for (let t of Array.isArray(e) ? e : []) {
    let eFile = t?.file instanceof File ? t.file : null;
    eFile && (a += Math.max(0, Number(eFile.size) || 0), l = Math.max(l, uploadDepthFromRelativePath(t.relativePath)));
  }
  return {
    files: Array.isArray(e) ? e.length : 0,
    totalBytes: a,
    maxDepth: l
  };
}
function collectFolderUploadRootNames(e) {
  let a = [];
  for (let l of Array.isArray(e) ? e : []) {
    let eRoot = uploadRootNameFromRelativePath(l?.relativePath || "");
    eRoot && !a.includes(eRoot) && a.push(eRoot);
  }
  return a;
}
function eg(e) {
  let a = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };
  return (0, t.jsxs)("span", {
    className: "cavcloud-navIcon",
    "aria-hidden": "true",
    children: ["dashboard" === e.icon ? t.jsx(s.default, {
      className: "cavcloud-navIconDashboard",
      src: "/icons/app/grid-svgrepo-com.svg",
      alt: "",
      width: 18,
      height: 18,
      unoptimized: !0
    }) : null, "explore" === e.icon ? t.jsx(s.default, {
      className: "cavcloud-navIconCavcloud",
      src: "/logo/cavbot-logomark.svg",
      alt: "",
      width: 18,
      height: 18,
      loading: "eager",
      fetchPriority: "high",
      unoptimized: !0
    }) : null, "recents" === e.icon ? (0, t.jsxs)("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: [t.jsx("path", {
        d: "M20 12a8 8 0 1 1-2.3-5.7",
        ...a
      }), t.jsx("path", {
        d: "M20 4v5h-5",
        ...a
      }), t.jsx("path", {
        d: "M12 8v4l2.5 1.5",
        ...a
      })]
    }) : null, "synced" === e.icon ? t.jsx(s.default, {
      className: "cavcloud-navIconSynced",
      src: "/icons/cloud-sync-svgrepo-com.svg",
      alt: "",
      width: 18,
      height: 18,
      loading: "eager",
      unoptimized: !0
    }) : null, "folders" === e.icon ? t.jsx("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: t.jsx("path", {
        d: "M3.5 8.2a2 2 0 0 1 2-2h4l1.6 1.8h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V8.2Z",
        ...a
      })
    }) : null, "files" === e.icon ? (0, t.jsxs)("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: [t.jsx("path", {
        d: "M8 3.8h6l4 4v12.4a1.8 1.8 0 0 1-1.8 1.8H8a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 8 3.8Z",
        ...a
      }), t.jsx("path", {
        d: "M14 3.8V8h4",
        ...a
      })]
    }) : null, "starred" === e.icon ? t.jsx("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: t.jsx("path", {
        d: "m12 3.9 2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.6-.8L12 3.9Z",
        ...a
      })
    }) : null, "shared" === e.icon ? (0, t.jsxs)("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: [t.jsx("circle", {
        cx: "6.4",
        cy: "11.8",
        r: "2.2",
        ...a
      }), t.jsx("circle", {
        cx: "17.6",
        cy: "6.8",
        r: "2.2",
        ...a
      }), t.jsx("circle", {
        cx: "17.6",
        cy: "16.8",
        r: "2.2",
        ...a
      }), t.jsx("path", {
        d: "m8.4 10.9 7.2-3.1",
        ...a
      }), t.jsx("path", {
        d: "m8.4 12.7 7.2 3.1",
        ...a
      })]
    }) : null, "collab" === e.icon ? t.jsx(s.default, {
      className: "cavcloud-navIconCollab",
      src: "/icons/team-svgrepo-com.svg",
      alt: "",
      width: 18,
      height: 18,
      unoptimized: !0
    }) : null, "trash" === e.icon ? (0, t.jsxs)("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: [t.jsx("path", {
        d: "M20.5 6H3.5",
        ...a
      }), t.jsx("path", {
        d: "M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5",
        ...a
      }), t.jsx("path", {
        d: "M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6",
        stroke: "currentColor",
        strokeWidth: "1.7",
        strokeLinecap: "round"
      })]
    }) : null, "settings" === e.icon ? (0, t.jsxs)("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      children: [t.jsx("path", {
        d: "M12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z",
        ...a
      }), t.jsx("path", {
        d: "m4.6 13.1 1.7.3c.2.5.4.9.7 1.3l-1 1.4 1.8 1.8 1.4-1c.4.3.8.5 1.3.7l.3 1.7h2.6l.3-1.7c.5-.2.9-.4 1.3-.7l1.4 1 1.8-1.8-1-1.4c.3-.4.5-.8.7-1.3l1.7-.3v-2.6l-1.7-.3a6 6 0 0 0-.7-1.3l1-1.4-1.8-1.8-1.4 1a6 6 0 0 0-1.3-.7l-.3-1.7h-2.6l-.3 1.7c-.5.2-.9.4-1.3.7l-1.4-1-1.8 1.8 1 1.4c-.3.4-.5.8-.7 1.3l-1.7.3v2.6Z",
        ...a
      })]
    }) : null]
  });
}
function ex(e = {}) {
  let a = e.className ? `cavcloud-folderGlyph ${e.className}` : "cavcloud-folderGlyph";
  return t.jsx("span", {
    className: a
  });
}
function ey(e = {}) {
  let a = e.className ? `cavcloud-fileGlyph ${e.className}` : "cavcloud-fileGlyph";
  return t.jsx("span", {
    className: a
  });
}
function eb(e) {
  return "video" === e.kind ? (0, t.jsxs)("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    children: [t.jsx("path", {
      d: "M4.4 7.6A2.2 2.2 0 0 1 6.6 5.4h7.8a2.2 2.2 0 0 1 2.2 2.2v8.8a2.2 2.2 0 0 1-2.2 2.2H6.6a2.2 2.2 0 0 1-2.2-2.2V7.6Z",
      stroke: "currentColor",
      strokeWidth: "1.6",
      strokeLinejoin: "round"
    }), t.jsx("path", {
      d: "m10 9.2 4.6 3-4.6 3v-6Z",
      fill: "currentColor"
    })]
  }) : "image" === e.kind ? (0, t.jsxs)("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    children: [t.jsx("rect", {
      x: "4.4",
      y: "5.4",
      width: "15.2",
      height: "13.2",
      rx: "2.2",
      stroke: "currentColor",
      strokeWidth: "1.6"
    }), t.jsx("circle", {
      cx: "9.1",
      cy: "10",
      r: "1.2",
      fill: "currentColor"
    }), t.jsx("path", {
      d: "m7.1 16 3.1-3.3 2.4 2.4 2.2-2.3 2.1 3.2H7.1Z",
      fill: "currentColor"
    })]
  }) : t.jsx(ey, {});
}
function eDocThumb(e = {}) {
  let a = String(e.name || "").trim(),
    l = String(e.mimeType || "").trim(),
    s = String(e.variant || "tile").trim().toLowerCase(),
    i = "trash" === s || "shared" === s ? s : "tile",
    r = isTextLikeFile(a, l) ? formatSnippetForThumbnail(String(e.snippet || ""), {
      maxChars: "tile" === i ? 520 : 260,
      maxLines: "tile" === i ? 14 : 8
    }) : null,
    c = String(e.label || V(a, l)).trim().toUpperCase().slice(0, 4) || "FILE";
  return (0, t.jsxs)("span", {
    className: `cavcloud-docThumb is-${i} ${r ? "has-snippet" : ""}`,
    children: [t.jsx(ey, {
      className: "is-docThumb"
    }), r ? t.jsx("span", {
      className: "cavcloud-docThumbSnippet",
      children: t.jsx("span", {
        className: "cavcloud-docThumbSnippetText",
        children: r
      })
    }) : null, t.jsx("span", {
      className: "cavcloud-docThumbLabel",
      children: c
    })]
  });
}
function ej(e) {
  let a = e.item;
  if ("folder" === a.kind) return t.jsx("span", {
    className: "cavcloud-trashAsset cavcloud-trashAssetFolder",
    "aria-hidden": "true",
    children: t.jsx(ex, {
      className: "is-trashAsset"
    })
  });
  let l = e.mediaKind ?? (z("", a.name || a.path) ? "image" : q("", a.name || a.path) ? "video" : null),
    s = l ? String(e.previewUrl || "").trim() : "";
  if (s && "image" === l) return t.jsx("span", {
    className: "cavcloud-trashAsset cavcloud-trashAssetMedia is-image",
    "aria-hidden": "true",
    children: t.jsx("img", {
      className: "cavcloud-trashAssetMediaEl",
      src: s,
      alt: "",
      loading: "lazy"
    })
  });
  if (s && "video" === l) return (0, t.jsxs)("span", {
    className: "cavcloud-trashAsset cavcloud-trashAssetMedia is-video",
    "aria-hidden": "true",
    children: [t.jsx("video", {
      className: "cavcloud-trashAssetMediaEl",
      src: s,
      preload: "metadata",
      muted: !0,
      playsInline: !0
    }), t.jsx("span", {
      className: "cavcloud-trashAssetVideoBadge",
      children: t.jsx("svg", {
        viewBox: "0 0 24 24",
        fill: "none",
        children: t.jsx("path", {
          d: "m9.2 7.9 7.3 4.1-7.3 4.1V7.9Z",
          fill: "currentColor"
        })
      })
    })]
  });
  let i = String(e.mimeType || a.mimeType || "").trim(),
    r = String(V(a.name || a.path || "", i)).trim().toUpperCase().slice(0, 4) || "FILE";
  return t.jsx("span", {
    className: `cavcloud-trashAsset cavcloud-trashAssetFile ${l ? `is-${l}` : ""}`,
    "aria-hidden": "true",
    children: (0, t.jsxs)(t.Fragment, {
      children: [t.jsx(ey, {
        className: "is-trashAsset"
      }), t.jsx("span", {
        className: "cavcloud-trashAssetLabel",
        children: r
      })]
    })
  });
}
function eN(e) {
  let a = "image" === e.mediaKind ? String(e.previewUrl || "").trim() : "";
  return a ? t.jsx("span", {
    className: "cavcloud-fileTileIconWrap is-image",
    "aria-hidden": "true",
    children: t.jsx("img", {
      className: "cavcloud-fileTileMedia",
      src: a,
      alt: "",
      loading: "lazy"
    })
  }) : (0, t.jsxs)("span", {
    className: `cavcloud-fileTileIconWrap ${e.mediaKind ? `is-${e.mediaKind}` : "is-file"}`,
    "aria-hidden": "true",
    children: ["video" === e.mediaKind ? t.jsx(s.default, {
      className: "cavcloud-fileTileCenterPlayIcon",
      src: "/icons/play-circle-svgrepo-com.svg",
      alt: "",
      width: 30,
      height: 30
    }) : e.mediaKind ? t.jsx(eb, {
      kind: e.mediaKind
    }) : t.jsx(eDocThumb, {
      variant: "tile",
      name: e.file.name,
      mimeType: e.file.mimeType,
      snippet: String(e.snippet || e.file.previewSnippet || "")
    })]
  });
}
function eC(e) {
  return t.jsx(u, {
    children: t.jsx(ek, {
      isOwner: !!(null == e ? void 0 : e.isOwner),
      cacheScopeKey: String(null == e ? void 0 : e.cacheScopeKey || "").trim()
    })
  });
}
function eCollabBadge(e = {}) {
  let a = Math.max(0, Math.trunc(Number(e.sharedUserCount || 0)) || 0),
    l = !!e.collaborationEnabled;
  if (!(a > 0 || l)) return null;
  let s = l ? "Shared and collaborative" : `Shared with ${a} CavBot user${1 === a ? "" : "s"}`;
  return t.jsx("span", {
    className: `cavcloud-cardShareCorner ${l ? "is-edit" : ""}`,
    role: "img",
    "aria-label": s,
    title: s,
    children: t.jsx("span", {
      className: "cavcloud-cardShareGlyph",
      "aria-hidden": "true"
    })
  });
}
function ek(e) {
  var a;
  let isOwner = !!(null == e ? void 0 : e.isOwner),
    cacheScopeKey = String(null == e ? void 0 : e.cacheScopeKey || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96) || "anon",
    treeCacheKey = `${CAVCLOUD_TREE_CACHE_KEY}:${cacheScopeKey}`,
    treeNavCacheKey = `${treeCacheKey}:nav`,
    activityCacheKey = `${m}:${cacheScopeKey}`,
    storageHistoryCacheKey = `${v}:${cacheScopeKey}`,
    storageHistoryCacheLegacyKey = `${p}:${cacheScopeKey}`,
    pathName = (0, r.usePathname)(),
    searchParams = (0, r.useSearchParams)(),
    l = (0, r.useRouter)(),
    {
      selectedFileId: u,
      previewOpen: b,
      previewMode: j,
      previewItem: N,
      openPreviewPanel: C,
      openPreviewPage: k,
      closePreview: w
    } = function () {
      let e = o().useContext(n);
      if (!e) throw Error("useCavCloudPreview must be used inside CavCloudPreviewProvider.");
      return e;
    }(),
    [initialTreeSnapshot] = (0, c.useState)(() => readInitialCavcloudTreeSnapshot(treeCacheKey)),
    [cachedPlanState] = (0, c.useState)(() => readCachedCavcloudPlanState()),
    [S, J] = (0, c.useState)(() => pathName.startsWith("/cavcloud/dashboard") ? "Dashboard" : "Explore"),
    [z, q] = (0, c.useState)(() => T(String(initialTreeSnapshot?.folder?.path || "/"))),
    [en, ey] = (0, c.useState)(() => initialTreeSnapshot),
    [eC, ek] = (0, c.useState)(() => !initialTreeSnapshot),
    [ew, eS] = (0, c.useState)(!1),
    [eM, eI] = (0, c.useState)(""),
    [e$, eL] = (0, c.useState)(""),
    [eA, eT] = (0, c.useState)("lime"),
    [cavcloudSettings, setCavcloudSettings] = (0, c.useState)(() => ({
      ...CAVCLOUD_SETTINGS_DEFAULTS
    })),
    [cavcloudSettingsLoaded, setCavcloudSettingsLoaded] = (0, c.useState)(!1),
    [cavcloudSettingsSaving, setCavcloudSettingsSaving] = (0, c.useState)(!1),
    [eO, eF] = (0, c.useState)([]),
    [folderUploadFailures, setFolderUploadFailures] = (0, c.useState)([]),
    [folderUploadDiagnostics, setFolderUploadDiagnostics] = (0, c.useState)(() => createUploadDiagnosticsState()),
    [uploadsPanelOpen, setUploadsPanelOpen] = (0, c.useState)(!1),
    [dashboardRefreshNonce, setDashboardRefreshNonce] = (0, c.useState)(0),
    [eP, eB] = (0, c.useState)("there"),
    [eR, eU] = (0, c.useState)("C"),
    [eE, eD] = (0, c.useState)(""),
    [e_, eW] = (0, c.useState)(""),
    [eH, eG] = (0, c.useState)(""),
    [profilePublicEnabled, setProfilePublicEnabled] = (0, c.useState)("unknown"),
    [eK, eJ] = (0, c.useState)(cachedPlanState.planTier),
    [memberRole, setMemberRole] = (0, c.useState)(isOwner ? "OWNER" : "ANON"),
    [eV, eZ] = (0, c.useState)(() => !!cachedPlanState.trialActive),
    [ez, eq] = (0, c.useState)(() => Math.max(0, Math.trunc(Number(cachedPlanState.trialDaysLeft || 0)) || 0)),
    [eY, eQ] = (0, c.useState)([]),
    [eX, e0] = (0, c.useState)(!1),
    [e1, e2] = (0, c.useState)(""),
    [aa, al] = (0, c.useState)(!1),
    [at, as] = (0, c.useState)(!1),
    [ai, ar] = (0, c.useState)(""),
    [ac, ao] = (0, c.useState)(""),
    [ad, an] = (0, c.useState)([]),
    [au, ah] = (0, c.useState)(!1),
    [am, av] = (0, c.useState)(""),
    [cloudSection, setCloudSection] = (0, c.useState)("cloud"),
    [galleryAllFiles, setGalleryAllFiles] = (0, c.useState)([]),
    [galleryAllLoading, setGalleryAllLoading] = (0, c.useState)(!1),
    [ap, af] = (0, c.useState)({}),
    [snippetByFileId, setSnippetByFileId] = (0, c.useState)({}),
    [ag, ax] = (0, c.useState)(!1),
    [ay, ab] = (0, c.useState)({}),
    [aj, aN] = (0, c.useState)("all"),
    [aC, ak] = (0, c.useState)("grid"),
    [aw, aS] = (0, c.useState)(!1),
    [aM, aI] = (0, c.useState)("list"),
    [a$, aL] = (0, c.useState)("list"),
    [aA, aT] = (0, c.useState)("all"),
    [aO, aF] = (0, c.useState)("shared"),
    [collabInboxFilter, setCollabInboxFilter] = (0, c.useState)("all"),
    [collabInboxLayout, setCollabInboxLayout] = (0, c.useState)("list"),
    [collabInboxItems, setCollabInboxItems] = (0, c.useState)([]),
    [collabInboxSummary, setCollabInboxSummary] = (0, c.useState)({
      total: 0,
      readonly: 0,
      canEdit: 0,
      expiringSoon: 0
    }),
    [collabInboxLoading, setCollabInboxLoading] = (0, c.useState)(!1),
    [collabInboxError, setCollabInboxError] = (0, c.useState)(""),
    [collabInboxActionKey, setCollabInboxActionKey] = (0, c.useState)(""),
    [aP, aB] = (0, c.useState)({}),
    [aR, aU] = (0, c.useState)("all"),
    [aE, aD] = (0, c.useState)("list"),
    [a_, aW] = (0, c.useState)("24h"),
    [aH, aG] = (0, c.useState)(""),
    [aK, aJ] = (0, c.useState)(""),
    [aV, aZ] = (0, c.useState)(""),
    [az, aq] = (0, c.useState)(""),
    [aY, aQ] = (0, c.useState)(!1),
    [aX, a0] = (0, c.useState)(!1),
    [a1, a2] = (0, c.useState)("trash"),
    [a4, a5] = (0, c.useState)("any"),
    [a3, a8] = (0, c.useState)("24h"),
    [a6, a7] = (0, c.useState)(""),
    [a9, le] = (0, c.useState)(""),
    [la, ll] = (0, c.useState)(""),
    [lt, ls] = (0, c.useState)(""),
    [li, lr] = (0, c.useState)(!1),
    [lu, lh] = (0, c.useState)(!1),
    [googleDriveImportModalOpen, setGoogleDriveImportModalOpen] = (0, c.useState)(!1),
    [googleDriveImportSessionState, setGoogleDriveImportSessionState] = (0, c.useState)({}),
    [lm, lv] = (0, c.useState)(!1),
    [lp, lf] = (0, c.useState)(""),
    [lg, lx] = (0, c.useState)(null),
    [ly, lb] = (0, c.useState)(""),
    [lj, lN] = (0, c.useState)(null),
    [lC, lk] = (0, c.useState)(null),
    [lw, lS] = (0, c.useState)(null),
    [lM, lI] = (0, c.useState)([]),
    [l$, lL] = (0, c.useState)(!1),
    [lA, lT] = (0, c.useState)(""),
    [lO, lF] = (0, c.useState)(""),
    [lP, lB] = (0, c.useState)(""),
    [lR, lU] = (0, c.useState)(!1),
    [lE, lD] = (0, c.useState)("untitled.txt"),
    [createFolderTarget, setCreateFolderTarget] = (0, c.useState)("cavcloud"),
    [createFileTarget, setCreateFileTarget] = (0, c.useState)("cavcloud"),
    [l_, lW] = (0, c.useState)(null),
    [lH, lG] = (0, c.useState)(""),
    [lK, lJ] = (0, c.useState)("PUBLIC_PROFILE"),
    [publishExpiryDays, setPublishExpiryDays] = (0, c.useState)(0),
    [recentsKind, setRecentsKind] = (0, c.useState)("all"),
    [recentsTimeline, setRecentsTimeline] = (0, c.useState)("24h"),
    [recentsPage, setRecentsPage] = (0, c.useState)(1),
    [galleryPage, setGalleryPage] = (0, c.useState)(1),
    [settingsPage, setSettingsPage] = (0, c.useState)(1),
    [mountQuickKind, setMountQuickKind] = (0, c.useState)("folder"),
    [mountQuickTargetId, setMountQuickTargetId] = (0, c.useState)(""),
    [mountBusy, setMountBusy] = (0, c.useState)(!1),
    [mountRunModalItem, setMountRunModalItem] = (0, c.useState)(null),
    [syncedSource, setSyncedSource] = (0, c.useState)("all"),
    [syncedTimeline, setSyncedTimeline] = (0, c.useState)("24h"),
    [copyLinkModalOpen, setCopyLinkModalOpen] = (0, c.useState)(!1),
    [copyLinkModalTitle, setCopyLinkModalTitle] = (0, c.useState)("Copy link"),
    [copyLinkModalValue, setCopyLinkModalValue] = (0, c.useState)(""),
    [copyLinkModalCopying, setCopyLinkModalCopying] = (0, c.useState)(!1),
    [cavGuardDecision, setCavGuardDecision] = (0, c.useState)(null),
    [collabLaunchModalOpen, setCollabLaunchModalOpen] = (0, c.useState)(!1),
    [collabLaunchQuery, setCollabLaunchQuery] = (0, c.useState)(""),
    [collabLaunchSelectionKey, setCollabLaunchSelectionKey] = (0, c.useState)(""),
    [collabLaunchFolderCounts, setCollabLaunchFolderCounts] = (0, c.useState)({}),
    [collabLaunchGlobalItems, setCollabLaunchGlobalItems] = (0, c.useState)([]),
    [collabLaunchGlobalIndexBusy, setCollabLaunchGlobalIndexBusy] = (0, c.useState)(!1),
    [collabLaunchGlobalIndexError, setCollabLaunchGlobalIndexError] = (0, c.useState)(""),
    [collabLaunchGlobalIndexed, setCollabLaunchGlobalIndexed] = (0, c.useState)(!1),
    [collabModalTarget, setCollabModalTarget] = (0, c.useState)(null),
    [deletingVisualKeys, setDeletingVisualKeys] = (0, c.useState)({}),
    [driveDebugLastFetchAt, setDriveDebugLastFetchAt] = (0, c.useState)(""),
    [driveDebugLastMutation, setDriveDebugLastMutation] = (0, c.useState)({
      type: "idle",
      status: "idle",
      atISO: ""
    }),
    [driveDebugOptimisticCount, setDriveDebugOptimisticCount] = (0, c.useState)(0),
    [driveDebugServerCount, setDriveDebugServerCount] = (0, c.useState)(0),
    [enteredFromCavSafe] = (0, c.useState)(() => {
      try {
        let e = "cavsafe_to_cavcloud" === globalThis.__cbSessionStore.getItem("cb_surface_nav");
        return e && (globalThis.__cbSessionStore.removeItem("cb_surface_nav"), globalThis.__cbSessionStore.removeItem("cb_surface_nav_ts")), e;
      } catch {
        return !1;
      }
    }),
    folderPathFromQuery = (0, c.useMemo)(() => {
      try {
        let e = String(searchParams?.get("folderPath") || "").trim();
        return e ? T(e) : "";
      } catch {
        return "";
      }
    }, [searchParams]),
    uploadDebugEnabled = (0, c.useMemo)(() => {
      if ("1" === String(process.env.NEXT_PUBLIC_CAVCLOUD_UPLOAD_DEBUG || "").trim()) return !0;
      try {
        return "1" === String(new URLSearchParams(window.location.search).get("uploadDebug") || "").trim();
      } catch {
        return !1;
      }
    }, [pathName]),
    driveDebugEnabled = (0, c.useMemo)(() => {
      if (uploadDebugEnabled) return !0;
      try {
        return getDriveDebugEnabled(window.location.search);
      } catch {
        return !1;
      }
    }, [pathName, uploadDebugEnabled]),
    googleDriveSessionRows = (0, c.useMemo)(() => Object.values(googleDriveImportSessionState || {}), [googleDriveImportSessionState]),
    googleDriveFailedCount = (0, c.useMemo)(() => googleDriveSessionRows.reduce((sum, session) => sum + Math.max(0, Math.trunc(Number(session?.failedCount || 0)) || 0), 0), [googleDriveSessionRows]),
    googleDrivePendingCount = (0, c.useMemo)(() => googleDriveSessionRows.reduce((sum, session) => {
      let status = String(session?.status || "RUNNING").trim().toUpperCase();
      if ("COMPLETED" === status || "CANCELED" === status) return sum;
      let discovered = Math.max(0, Math.trunc(Number(session?.discoveredCount || 0)) || 0),
        imported = Math.max(0, Math.trunc(Number(session?.importedCount || 0)) || 0),
        failed = Math.max(0, Math.trunc(Number(session?.failedCount || 0)) || 0),
        pending = Math.max(0, Math.trunc(Number(session?.pendingCount ?? discovered - imported - failed)) || 0);
      return sum + (pending > 0 ? pending : "CREATED" === status || "RUNNING" === status ? 1 : 0);
    }, 0), [googleDriveSessionRows]),
    googleDriveFailedRows = (0, c.useMemo)(() => {
      let rows = [];
      for (let session of googleDriveSessionRows) {
        let sessionId = String(session?.sessionId || "").trim(),
          failedItems = Array.isArray(session?.failedItems) ? session.failedItems : [];
        for (let failedItem of failedItems) {
          let itemId = String(failedItem?.id || "").trim(),
            providerPath = String(failedItem?.providerPath || "").trim();
          sessionId && itemId && providerPath && rows.push({
            sessionId,
            fileId: itemId,
            relPath: providerPath,
            errorCode: String(failedItem?.failureCode || "IMPORT_FAILED"),
            errorMessage: String(failedItem?.failureMessageSafe || "Import failed."),
            provider: "GOOGLE_DRIVE"
          });
        }
      }
      return rows;
    }, [googleDriveSessionRows]),
    googleDriveFailureIndex = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of googleDriveFailedRows) {
        let l = googleDriveImportFailureKey(a);
        e.has(l) || e.set(l, a);
      }
      return e;
    }, [googleDriveFailedRows]),
    combinedUploadFailures = (0, c.useMemo)(() => [...(Array.isArray(folderUploadFailures) ? folderUploadFailures : []), ...googleDriveFailedRows], [folderUploadFailures, googleDriveFailedRows]),
    uploadsFailedCount = (0, c.useMemo)(() => {
      let e = Math.max(0, Math.trunc(Number(folderUploadFailures.length || folderUploadDiagnostics?.failedCount || 0)) || 0);
      return e + Math.max(0, Math.trunc(Number(googleDriveFailedCount || 0)) || 0);
    }, [folderUploadFailures.length, folderUploadDiagnostics?.failedCount, googleDriveFailedCount]),
    uploadsPendingCount = (0, c.useMemo)(() => {
      let e = Math.max(0, Math.trunc(Number(folderUploadDiagnostics?.discoveredCount || 0)) || 0),
        a = Math.max(0, Math.trunc(Number(folderUploadDiagnostics?.uploadedCount || 0)) || 0),
        l = Math.max(0, Math.trunc(Number(folderUploadDiagnostics?.failedCount || 0)) || 0),
        t = Math.max(0, e - a - l),
        s = Math.max(0, Math.trunc(Number(googleDrivePendingCount || 0)) || 0),
        i = t + s;
      return i <= 0 && ew ? 1 : i;
    }, [folderUploadDiagnostics?.discoveredCount, folderUploadDiagnostics?.uploadedCount, folderUploadDiagnostics?.failedCount, googleDrivePendingCount, ew]),
    lV = (0, c.useRef)(null),
    lZ = (0, c.useRef)(null),
    lz = (0, c.useRef)(null),
    lq = (0, c.useRef)(null),
    lY = (0, c.useRef)(null),
    lQ = (0, c.useRef)(null),
    l1 = (0, c.useRef)(null),
    collabLaunchCountFetchInFlightRef = (0, c.useRef)(new Set()),
    collabLaunchGlobalIndexInFlightRef = (0, c.useRef)(!1),
    copyLinkModalInputRef = (0, c.useRef)(null),
    treeLoadRequestRef = (0, c.useRef)(0),
    galleryLoadRequestRef = (0, c.useRef)(0),
    treeHasLoadedRef = (0, c.useRef)(!!initialTreeSnapshot),
    folderLoadAbortRef = (0, c.useRef)(null),
    folderNavLockRef = (0, c.useRef)({
      path: "",
      ts: 0
    }),
    folderSelectTimerRef = (0, c.useRef)(null),
    snippetRequestedVersionRef = (0, c.useRef)(new Map()),
    routeDiagRef = (0, c.useRef)(""),
    lastFolderPathRef = (0, c.useRef)("/"),
    cavcloudSettingsRef = (0, c.useRef)(cavcloudSettings),
    eyesDiagLoggedRef = (0, c.useRef)(!1),
    treePrefetchInFlightRef = (0, c.useRef)(new Set()),
    googleDriveImportSessionStateRef = (0, c.useRef)(googleDriveImportSessionState),
    googleDriveImportRunInFlightRef = (0, c.useRef)(new Set()),
    googleDriveImportLastStatusRef = (0, c.useRef)({}),
    driveImportQueryHandledRef = (0, c.useRef)(""),
    openCavGuardByAction = (0, c.useCallback)((actionId, options = {}) => {
      let role = String(options?.role || memberRole || (isOwner ? "OWNER" : "ANON")).trim().toUpperCase();
      let plan = resolveCavcloudPlanTier({
        tierEffective: String(options?.plan || eK || "FREE").trim().toUpperCase()
      });
      setCavGuardDecision(buildCavGuardDecision(actionId, {
        role,
        plan,
        flags: options?.flags || null
      }));
    }, [memberRole, isOwner, eK]),
    cancelPendingFolderSelect = (0, c.useCallback)(() => {
      null != folderSelectTimerRef.current && (window.clearTimeout(folderSelectTimerRef.current), folderSelectTimerRef.current = null);
    }, []),
    l2 = (0, c.useCallback)(e => {
      if ("Settings" === e && !isOwner) {
        openCavGuardByAction("SETTINGS_OWNER_ONLY", {
          flags: {
            settingsSurface: "CavCloud"
          }
        });
        return;
      }
      if (e !== S) {
        cancelPendingFolderSelect();
        null != folderLoadAbortRef.current && (folderLoadAbortRef.current.abort(), folderLoadAbortRef.current = null);
        aS(!1), setRecentsPage(1), w(), ab({}), ax(!1), lB(""), setCollabInboxActionKey("");
      }
      J(e);
    }, [S, cancelPendingFolderSelect, isOwner, openCavGuardByAction, w]),
    openCavSafe = (0, c.useCallback)(() => {
      if (!isOwner) {
        openCavGuardByAction("CAVSAFE_OWNER_ONLY");
        return;
      }
      if ("FREE" === String(eK || "").trim().toUpperCase()) {
        openCavGuardByAction("CAVSAFE_PLAN_REQUIRED", {
          plan: "FREE"
        });
        return;
      }
      cancelPendingFolderSelect(), null != folderLoadAbortRef.current && (folderLoadAbortRef.current.abort(), folderLoadAbortRef.current = null), w(), l.push("/cavsafe");
    }, [cancelPendingFolderSelect, isOwner, eK, l, openCavGuardByAction, w]),
    closeCavGuardModal = (0, c.useCallback)(() => {
      setCavGuardDecision(null);
    }, []),
    l4 = (0, c.useCallback)(() => {
      null != lY.current && (window.clearTimeout(lY.current), lY.current = null), as(!1);
    }, []),
    resetTransientUi = (0, c.useCallback)((reason = "manual") => {
      // Root-cause fix (A2/A3): centralized transient cleanup prevents sticky non-interactive states.
      // Root-cause fix (C5): always clear transient menu/selection/drag state on navigation edges.
      cancelPendingFolderSelect(), l4(), aS(!1), ax(!1), ab({}), lB("");
      setCollabLaunchModalOpen(!1), setCollabLaunchQuery(""), setCollabLaunchSelectionKey("");
      setCollabModalTarget(null);
      try {
        document.documentElement.style.removeProperty("overflow"), document.documentElement.style.removeProperty("pointer-events"), document.body.style.removeProperty("overflow"), document.body.style.removeProperty("pointer-events");
      } catch {}
      "production" !== process.env.NODE_ENV && console.debug("[CavCloud][diag] resetTransientUi", {
        reason,
        route: pathName,
        folderPath: T(z),
        previewOpen: b
      });
    }, [cancelPendingFolderSelect, l4, ax, ab, pathName, z, b]),
    l5 = (0, c.useCallback)(() => {
      null != lY.current && (window.clearTimeout(lY.current), lY.current = null), as(!0), lY.current = window.setTimeout(() => {
        lY.current = null, as(!1);
      }, 1100);
    }, []),
    openCopyLinkModal = (0, c.useCallback)((e, a) => {
      let l = String(a || "").trim();
      l && (setCopyLinkModalTitle(String(e || "Copy link")), setCopyLinkModalValue(l), setCopyLinkModalCopying(!1), setCopyLinkModalOpen(!0));
    }, []),
    closeCopyLinkModal = (0, c.useCallback)(() => {
      setCopyLinkModalOpen(!1), setCopyLinkModalCopying(!1);
    }, []),
    retryCollabLaunchGlobalIndex = (0, c.useCallback)(() => {
      setCollabLaunchGlobalIndexError(""), setCollabLaunchGlobalIndexed(!1), setCollabLaunchGlobalItems([]);
    }, []),
    openCollabLaunchModal = (0, c.useCallback)(() => {
      setCollabLaunchQuery(""), setCollabLaunchSelectionKey(""), setCollabLaunchModalOpen(!0), lB("");
    }, []),
    closeCollabLaunchModal = (0, c.useCallback)(() => {
      setCollabLaunchModalOpen(!1);
    }, []),
    openCollaborateModal = (0, c.useCallback)((e, a) => {
      let l = "FOLDER" === String(e || "").trim().toUpperCase() ? "FOLDER" : "FILE",
        t = String(a?.id || "").trim(),
        s = String(a?.name || "").trim(),
        i = String(a?.path || "").trim();
      t && (setCollabModalTarget({
        resourceType: l,
        resourceId: t,
        resourceName: s || t,
        resourcePath: i || null
      }), lB(""));
    }, []),
    closeCollaborateModal = (0, c.useCallback)(() => {
      setCollabModalTarget(null);
    }, []),
    l3 = (0, c.useCallback)((e, a) => {
      let l = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      eF(t => [...t, {
        id: l,
        tone: e,
        text: a
      }]), window.setTimeout(() => {
        eF(e => e.filter(e => e.id !== l));
      }, 2800);
    }, []),
    setDriveMutationState = (0, c.useCallback)((type, status) => {
      setDriveDebugLastMutation({
        type: String(type || "unknown"),
        status: String(status || "idle"),
        atISO: new Date().toISOString()
      });
    }, []),
    logDriveDebug = (0, c.useCallback)((event, payload) => {
      debugDriveLog("cloud", driveDebugEnabled, event, payload);
    }, [driveDebugEnabled]),
    applyCavcloudSettingsToUi = (0, c.useCallback)((settings, options = {}) => {
      let normalized = normalizeCavcloudClientSettings(settings),
        viewMode = "list" === normalized.defaultView ? "list" : "grid";
      eT(normalized.themeAccent), ak(viewMode), !1 !== options.syncUploadQueue && setUploadsPanelOpen(e => normalized.showUploadQueue ? e || !0 : !1), lJ(normalized.publishDefaultVisibility), setPublishExpiryDays(normalizePublishExpiryDays(normalized.publishDefaultExpiryDays, 0));
      let shouldApplyTitle = !!options.forcePublishTitle || !lH;
      shouldApplyTitle && "filename" === normalized.publishDefaultTitleMode && l_ && lG(String(l_.name || "").trim().slice(0, 140));
    }, [lH, l_]),
    updateCavcloudSettingsPatch = (0, c.useCallback)(async (patch, options = {}) => {
      if (!isOwner) return;
      let previous = cavcloudSettingsRef.current || CAVCLOUD_SETTINGS_DEFAULTS,
        optimistic = normalizeCavcloudClientSettings({
          ...previous,
          ...(patch && "object" == typeof patch ? patch : {})
        });
      setCavcloudSettings(optimistic), cavcloudSettingsRef.current = optimistic, applyCavcloudSettingsToUi(optimistic, options), setCavcloudSettingsSaving(!0);
      try {
        let e = await fetch("/api/cavcloud/settings", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(patch || {})
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to save settings."));
        let l = normalizeCavcloudClientSettings(a.settings);
        setCavcloudSettings(l), cavcloudSettingsRef.current = l, applyCavcloudSettingsToUi(l, options);
      } catch (e) {
        setCavcloudSettings(previous), cavcloudSettingsRef.current = previous, applyCavcloudSettingsToUi(previous, options), l3("bad", e instanceof Error ? e.message : "Failed to save settings.");
      } finally {
        setCavcloudSettingsSaving(!1);
      }
    }, [applyCavcloudSettingsToUi, isOwner, l3]),
    loadCavcloudSettings = (0, c.useCallback)(async () => {
      if (!isOwner) {
        let e = normalizeCavcloudClientSettings(CAVCLOUD_SETTINGS_DEFAULTS);
        setCavcloudSettings(e), cavcloudSettingsRef.current = e, applyCavcloudSettingsToUi(e, {
          forcePublishTitle: !0
        }), setCavcloudSettingsLoaded(!0);
        return;
      }
      try {
        let e = await fetch("/api/cavcloud/settings", {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to load settings."));
        let l = normalizeCavcloudClientSettings(a.settings);
        setCavcloudSettings(l), cavcloudSettingsRef.current = l, applyCavcloudSettingsToUi(l, {
          forcePublishTitle: !0
        });
      } catch {
        let e = normalizeCavcloudClientSettings(CAVCLOUD_SETTINGS_DEFAULTS);
        setCavcloudSettings(e), cavcloudSettingsRef.current = e, applyCavcloudSettingsToUi(e, {
          forcePublishTitle: !0
        });
      } finally {
        setCavcloudSettingsLoaded(!0);
      }
    }, [applyCavcloudSettingsToUi, isOwner]),
    bumpDashboardRefresh = (0, c.useCallback)(() => {
      setDashboardRefreshNonce(e => (e + 1) % 1e7);
    }, []),
    upsertTreeNavSnapshot = (0, c.useCallback)((path, payload) => {
      let a = T(String(path || "/")),
        lPayload = R(payload),
        tFolder = R(lPayload?.folder);
      if (!a || !lPayload || !tFolder) return;
      let snapshot = {
        folder: {
          ...tFolder,
          path: a
        },
        breadcrumbs: Array.isArray(lPayload.breadcrumbs) ? lPayload.breadcrumbs : [],
        folders: Array.isArray(lPayload.folders) ? lPayload.folders : [],
        files: Array.isArray(lPayload.files) ? lPayload.files : [],
        trash: Array.isArray(lPayload.trash) ? lPayload.trash : [],
        usage: R(lPayload.usage),
        activity: W(lPayload.activity),
        storageHistory: H(lPayload.storageHistory)
      };
      try {
        let rowsRaw = A(globalThis.__cbSessionStore.getItem(treeNavCacheKey)),
          rows = Array.isArray(rowsRaw) ? rowsRaw : [],
          next = [{
            path: a,
            ts: Date.now(),
            payload: snapshot
          }, ...rows.filter(e => T(String(e?.path || "/")) !== a)];
        globalThis.__cbSessionStore.setItem(treeNavCacheKey, JSON.stringify(next.slice(0, 48)));
      } catch {}
    }, [treeNavCacheKey]),
    writeTreeCacheSnapshot = (0, c.useCallback)(e => {
      if (!e?.folder?.path) return;
      try {
        let a = e.folders.length + e.files.length + e.trash.length,
          l = a > 320 ? {
            ...e,
            folders: e.folders.slice(0, 120),
            files: e.files.slice(0, 120),
            trash: e.trash.slice(0, 80)
          } : e;
        upsertTreeNavSnapshot(e.folder.path, l), globalThis.__cbLocalStore.setItem(treeCacheKey, JSON.stringify({
          ts: Date.now(),
          folderPath: e.folder.path,
          payload: l
        })), globalThis.__cbLocalStore.setItem(activityCacheKey, JSON.stringify((e.activity || []).slice(0, 80))), globalThis.__cbLocalStore.setItem(storageHistoryCacheKey, JSON.stringify((e.storageHistory || []).slice(-96))), globalThis.__cbLocalStore.setItem(storageHistoryCacheLegacyKey, JSON.stringify((e.storageHistory || []).slice(-96)));
      } catch {}
    }, [treeCacheKey, activityCacheKey, storageHistoryCacheKey, storageHistoryCacheLegacyKey, upsertTreeNavSnapshot]),
    mutateTreeOptimistic = (0, c.useCallback)(e => {
      ey(a => {
        if (!a) return a;
        let l = e(a);
        return l ? (writeTreeCacheSnapshot(l), driveDebugEnabled && setDriveDebugOptimisticCount(countDriveListingItems(l)), l) : a;
      });
    }, [writeTreeCacheSnapshot, driveDebugEnabled]),
    markDeletingVisual = (0, c.useCallback)(e => {
      if (!Array.isArray(e) || !e.length) return;
      setDeletingVisualKeys(a => {
        let l = {
            ...a
          },
          t = Date.now();
        for (let a of e) {
          let e = String(a?.kind || "").trim() || "file",
            tKey = String(a?.id || "").trim();
          if (!tKey) continue;
          l[K(e, tKey)] = t;
        }
        return l;
      });
    }, []),
    clearDeletingVisual = (0, c.useCallback)(e => {
      if (!Array.isArray(e) || !e.length) return;
      setDeletingVisualKeys(a => {
        let l = {
            ...a
          },
          t = !1;
        for (let a of e) {
          let e = String(a?.kind || "").trim() || "file",
            s = String(a?.id || "").trim();
          if (!s) continue;
          let i = K(e, s);
          i in l && (delete l[i], t = !0);
        }
        return t ? l : a;
      });
    }, []),
    normalizeUploadedFileRecord = (0, c.useCallback)((e, a) => {
      let l = e && "object" == typeof e ? e : null,
        t = String(l?.name || "").trim(),
        s = T(l?.path || O(a || "/", t || "file")),
        i = String(l?.id || "").trim() || `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        r = Number(l?.bytes ?? l?.size ?? l?.contentLength ?? 0),
        c = Number.isFinite(r) ? Math.max(0, Math.trunc(r)) : 0,
        o = String(l?.bytesExact || c).trim() || String(c),
        d = String(l?.mimeType || l?.contentType || es(t) || "application/octet-stream").trim() || "application/octet-stream",
        n = String(l?.sha256 || "").trim(),
        h = String(l?.folderId || "").trim(),
        m = String(l?.r2Key || "").trim(),
        g = String(l?.status || "").trim().toUpperCase(),
        x = "UPLOADING" === g || "FAILED" === g || "READY" === g ? g : String(i || "").startsWith("tmp_upload_") ? "UPLOADING" : "READY",
        y = null == l?.errorCode ? null : String(l?.errorCode || "").trim() || null,
        b = null == l?.errorMessage ? null : String(l?.errorMessage || "").trim() || null,
        fSnippet = formatSnippetForThumbnail(String(l?.previewSnippet || "")),
        v = String(l?.createdAtISO || l?.createdAt || new Date().toISOString()).trim(),
        p = String(l?.updatedAtISO || l?.updatedAt || v || new Date().toISOString()).trim();
      return t || (t = Z(s) || "file"), {
        id: i,
        folderId: h,
        name: t,
        path: s,
        relPath: String(l?.relPath || "").trim() || s.replace(/^\/+/, ""),
        r2Key: m,
        bytes: c,
        bytesExact: o,
        mimeType: d,
        sha256: n,
        status: x,
        errorCode: y,
        errorMessage: b,
        previewSnippet: fSnippet,
        createdAtISO: v,
        updatedAtISO: p
      };
    }, []),
    optimisticallyUpsertUploadedFile = (0, c.useCallback)((e, a = "/") => {
      let l = normalizeUploadedFileRecord(e, a);
      mutateTreeOptimistic(e => {
        let a = T(e?.folder?.path || "/"),
          t = T(l.path),
          s = eh(t),
          i = [...(Array.isArray(e.files) ? e.files : [])],
          r = [...(Array.isArray(e.folders) ? e.folders : [])],
          c = String(l.id || "").startsWith("tmp_upload_"),
          o = i.findIndex(e => String(e.id || "") === l.id),
          d = i.findIndex(e => T(e.path) === t),
          n = o >= 0 ? o : d,
          h = n >= 0 ? i[n] : null,
          m = h ? Number(h.bytes || 0) : 0,
          v = !!h && String(h.id || "").startsWith("tmp_upload_");
        if (c && h && !v) return e;
        if (n >= 0) {
          let eFile = {
            ...h,
            ...l
          };
          v && !c && (eFile.id = String(l.id || eFile.id || h.id));
          i[n] = eFile;
        } else if (s === a) i.push(l);else if (em(s, a)) {
          let segment = s === a ? "" : s.slice("/" === a ? 1 : a.length + 1).split("/").filter(Boolean)[0];
          if (segment) {
            let lPath = T("/" === a ? `/${segment}` : `${a}/${segment}`);
            r.some(e => T(e.path) === lPath) || r.push({
              id: `tmp_folder_${lPath}`,
              name: segment,
              path: lPath,
              parentId: e?.folder?.id || null,
              createdAtISO: new Date().toISOString(),
              updatedAtISO: new Date().toISOString()
            });
          }
        }
        i.sort(eu), r.sort(eu);
        let p = null;
        if (e.usage) {
          let a = Math.max(0, Number(e.usage.usedBytes || 0) + Math.max(0, Number(l.bytes || 0) - Math.max(0, m))),
            t = null == e.usage.limitBytes ? null : Math.max(0, Number(e.usage.limitBytes || 0) - a);
          p = {
            ...e.usage,
            usedBytes: a,
            usedBytesExact: String(a),
            remainingBytes: null == t ? null : t,
            remainingBytesExact: null == t ? null : String(t)
          };
        }
        return {
          ...e,
          folders: r,
          files: i,
          usage: p || e.usage
        };
      });
    }, [mutateTreeOptimistic, normalizeUploadedFileRecord]),
    optimisticallyRemoveUploadPlaceholder = (0, c.useCallback)((e, a) => {
      let l = String(e || "").trim(),
        t = String(a || "").trim() ? T(String(a || "/")) : "";
      if (!l && !t) return;
      mutateTreeOptimistic(e => {
        let a = [...(Array.isArray(e.files) ? e.files : [])],
          s = 0,
          i = a.filter(eFile => {
            let aId = String(eFile.id || "").trim(),
              iPath = T(String(eFile.path || "/")),
              r = aId.startsWith("tmp_upload_"),
              c = !!l && aId === l,
              o = !!t && r && iPath === t;
            return c || o ? (s += Math.max(0, Number(eFile.bytes || 0)), !1) : !0;
          });
        if (i.length === a.length) return e;
        let r = null;
        if (e.usage) {
          let a = Math.max(0, Number(e.usage.usedBytes || 0) - s),
            l = null == e.usage.limitBytes ? null : Math.max(0, Number(e.usage.limitBytes || 0) - a);
          r = {
            ...e.usage,
            usedBytes: a,
            usedBytesExact: String(a),
            remainingBytes: null == l ? null : l,
            remainingBytesExact: null == l ? null : String(l)
          };
        }
        return {
          ...e,
          files: i.sort(eu),
          usage: r || e.usage
        };
      });
    }, [mutateTreeOptimistic]),
    optimisticallyMoveItemsToTrash = (0, c.useCallback)(e => {
      if (!Array.isArray(e) || !e.length) return;
      mutateTreeOptimistic(a => {
        let l = new Set(),
          t = [],
          s = [];
        for (let a of e) {
          let eId = String(a?.id || "").trim(),
            iKind = "folder" === String(a?.kind || "").trim() ? "folder" : "file",
            rPath = T(String(a?.path || "/"));
          if (!eId) continue;
          l.add(K(iKind, eId)), t.push({
            id: eId,
            kind: iKind,
            path: rPath
          }), s.push({
            kind: iKind,
            id: eId,
            name: String(a?.name || Z(rPath) || (iKind === "folder" ? "Folder" : "File")).trim() || (iKind === "folder" ? "Folder" : "File"),
            path: rPath
          });
        }
        if (!t.length) return a;
        let i = new Set(t.filter(e => "folder" === e.kind).map(e => e.id)),
          r = t.filter(e => "folder" === e.kind).map(e => e.path),
          c = new Set(t.filter(e => "file" === e.kind).map(e => e.id)),
          o = [...(Array.isArray(a.folders) ? a.folders : [])].filter(e => !i.has(String(e.id || ""))),
          d = [...(Array.isArray(a.files) ? a.files : [])].filter(e => {
            let aId = String(e.id || "");
            if (c.has(aId)) return !1;
            let lPath = T(e.path);
            for (let eRoot of r) if (lPath === eRoot || lPath.startsWith(`${eRoot}/`)) return !1;
            return !0;
          }),
          n = [...(Array.isArray(a.trash) ? a.trash : [])],
          h = new Date().toISOString(),
          m = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString();
        for (let eItem of s) {
          let exists = n.some(a => String(a.targetId || "") === eItem.id && String(a.kind || "") === eItem.kind);
          exists || n.unshift({
            id: `tmp_trash_${eItem.kind}_${eItem.id}`,
            kind: eItem.kind,
            targetId: eItem.id,
            name: eItem.name,
            path: eItem.path,
            deletedAtISO: h,
            purgeAfterISO: m
          });
        }
        let v = null;
        if (a.usage) {
          let removedVisibleBytes = 0;
          for (let eFile of a.files || []) {
            let aId = String(eFile.id || ""),
              lPath = T(eFile.path),
              tDrop = c.has(aId) || r.some(eRoot => lPath === eRoot || lPath.startsWith(`${eRoot}/`));
            tDrop && (removedVisibleBytes += Math.max(0, Number(eFile.bytes || 0)));
          }
          let usedNext = Math.max(0, Number(a.usage.usedBytes || 0) - removedVisibleBytes),
            remNext = null == a.usage.limitBytes ? null : Math.max(0, Number(a.usage.limitBytes || 0) - usedNext);
          v = {
            ...a.usage,
            usedBytes: usedNext,
            usedBytesExact: String(usedNext),
            remainingBytes: null == remNext ? null : remNext,
            remainingBytesExact: null == remNext ? null : String(remNext)
          };
        }
        return {
          ...a,
          folders: o.sort(eu),
          files: d.sort(eu),
          trash: n,
          usage: v || a.usage
        };
      });
    }, [mutateTreeOptimistic]),
    copyFromCopyLinkModal = (0, c.useCallback)(async () => {
      let e = String(copyLinkModalValue || "").trim();
      if (!e) {
        l3("watch", "Link unavailable.");
        return;
      }
      setCopyLinkModalCopying(!0);
      try {
        if (!(await (0, h.T)(e))) {
          l3("bad", "Clipboard unavailable.");
          return;
        }
        setCopyLinkModalOpen(!1), l3("good", "Link copied.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to copy link.");
      } finally {
        setCopyLinkModalCopying(!1);
      }
    }, [copyLinkModalValue, l3]),
    l8 = (0, c.useCallback)(async e => {
      try {
        await fetch("/api/cavcloud/activity", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: e.action,
            targetType: "upload",
            targetPath: e.targetPath,
            metaJson: e.metaJson
          })
        });
      } catch {}
    }, []),
    l6 = (0, c.useCallback)(async e => {
      try {
        return (await fetch("/api/cavcloud/activity", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: e.action,
            targetType: e.targetType,
            targetId: e.targetId || null,
            targetPath: e.targetPath || null,
            metaJson: e.metaJson
          })
        })).ok;
      } catch {
        return !1;
      }
    }, []),
    l7 = (0, c.useCallback)(async (e, a = {}) => {
      let l = T(e),
        t = a && "object" == typeof a ? a : {},
        s = treeLoadRequestRef.current + 1,
        i = !treeHasLoadedRef.current,
        r = Math.max(1, Math.min(8, Math.trunc(Number(t.retries ?? 4)) || 4)),
        o = Math.max(80, Math.trunc(Number(t.retryDelayMs ?? 180)) || 180),
        d = new AbortController();
      null != folderLoadAbortRef.current && folderLoadAbortRef.current.abort(), folderLoadAbortRef.current = d;
      logDriveDebug("tree.fetch.start", {
        folderPath: l,
        requestId: s,
        retries: r,
        retryDelayMs: o,
        silent: !!t.silent
      });
      treeLoadRequestRef.current = s, t.silent || eL(""), i && ek(!0);
      try {
        let payload = null,
          lastStatus = 0,
          lastMessage = "";
        for (let e = 0; e < r; e += 1) {
          let a = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(l)}`, {
              method: "GET",
              cache: "no-store",
              signal: d.signal
            }),
            t = await ev(a);
          if (d.signal.aborted) return;
          if (s !== treeLoadRequestRef.current) return;
          if (a.ok && t?.ok && t.folder && t.usage) {
            payload = t;
            break;
          }
          if (lastStatus = a.status, lastMessage = String(t?.message || "").trim(), e < r - 1 && shouldRetryCavcloudTreeLoad(a.status, t)) {
            await new Promise(e => window.setTimeout(e, o));
            if (d.signal.aborted) return;
            continue;
          }
        }
        if (!payload?.folder || !payload?.usage) throw Error(lastMessage || `Failed to load folder (${lastStatus || 500})`);
        let cachedActivity = W(A(globalThis.__cbLocalStore.getItem(activityCacheKey))),
          cachedHistory = H(A(globalThis.__cbLocalStore.getItem(storageHistoryCacheKey)) || A(globalThis.__cbLocalStore.getItem(storageHistoryCacheLegacyKey))),
          payloadActivity = W(payload.activity),
          payloadHistory = H(payload.storageHistory),
          mergedActivity = payloadActivity.length ? payloadActivity : cachedActivity,
          historyBase = payloadHistory.length ? payloadHistory : cachedHistory,
          usedBytes = Math.max(0, Math.trunc(Number(payload.usage.usedBytes || 0))),
          nowTs = Math.max(0, Math.trunc(Date.now())),
          mergedHistory = [...historyBase].sort((e, a) => e.ts - a.ts),
          lastPoint = mergedHistory.length ? mergedHistory[mergedHistory.length - 1] : null;
        if (!lastPoint || nowTs - lastPoint.ts >= 36e5 || Math.abs(usedBytes - lastPoint.usedBytes) >= 1048576) {
          mergedHistory.push({
            ts: nowTs,
            usedBytes,
            usedBytesExact: String(usedBytes)
          });
        }
        mergedHistory = mergedHistory.slice(-96);
        let nextTree = {
          folder: payload.folder,
          breadcrumbs: Array.isArray(payload.breadcrumbs) ? payload.breadcrumbs : [],
          folders: Array.isArray(payload.folders) ? payload.folders : [],
          files: Array.isArray(payload.files) ? payload.files : [],
          trash: Array.isArray(payload.trash) ? payload.trash : [],
          usage: payload.usage,
          activity: mergedActivity,
          storageHistory: mergedHistory
        };
        let nextServerCount = countDriveListingItems(nextTree);
        setDriveDebugServerCount(nextServerCount), setDriveDebugLastFetchAt(new Date().toISOString());
        treeHasLoadedRef.current = !0, eL(""), q(nextTree.folder.path), ey(nextTree), upsertTreeNavSnapshot(nextTree.folder.path, nextTree);
        logDriveDebug("tree.fetch.complete", {
          folderPath: nextTree.folder.path,
          requestId: s,
          serverCount: nextServerCount
        });
        try {
          let e = nextTree.folders.length + nextTree.files.length + nextTree.trash.length,
            a = e > 320 ? {
              ...nextTree,
              folders: nextTree.folders.slice(0, 120),
              files: nextTree.files.slice(0, 120),
              trash: nextTree.trash.slice(0, 80)
            } : nextTree,
            l = () => {
              try {
                globalThis.__cbLocalStore.setItem(treeCacheKey, JSON.stringify({
                  ts: Date.now(),
                  folderPath: nextTree.folder.path,
                  payload: a
                })), globalThis.__cbLocalStore.setItem(activityCacheKey, JSON.stringify(nextTree.activity.slice(0, 80))), globalThis.__cbLocalStore.setItem(storageHistoryCacheKey, JSON.stringify(nextTree.storageHistory.slice(-96))), globalThis.__cbLocalStore.setItem(storageHistoryCacheLegacyKey, JSON.stringify(nextTree.storageHistory.slice(-96)));
              } catch {}
            };
          "requestIdleCallback" in window ? window.requestIdleCallback(l, {
            timeout: 320
          }) : window.setTimeout(l, 0);
        } catch {}
      } catch (aErr) {
        if (d.signal.aborted) return;
        if (s !== treeLoadRequestRef.current) return;
        let e = aErr instanceof Error ? aErr.message : "Failed to load CavCloud.";
        if (/before initialization/i.test(e)) {
          try {
            console.error("[CavCloud] tree load TDZ", aErr);
          } catch {}
          try {
            globalThis.__cbLocalStore.removeItem(treeCacheKey), globalThis.__cbLocalStore.removeItem(activityCacheKey), globalThis.__cbLocalStore.removeItem(storageHistoryCacheKey), globalThis.__cbLocalStore.removeItem(storageHistoryCacheLegacyKey);
          } catch {}
          try {
            globalThis.__cbSessionStore.removeItem(CAVCLOUD_TDZ_RELOAD_GUARD_KEY);
          } catch {}
        }
        logDriveDebug("tree.fetch.error", {
          folderPath: l,
          requestId: s,
          message: e
        });
        if ("/" !== l && !t.rootFallbackTried) {
          await l7("/", {
            ...t,
            silent: !0,
            rootFallbackTried: !0
          });
          return;
        }
        t.silent ? i && eL(e) : (eL(e), l3("bad", e));
      } finally {
        folderLoadAbortRef.current === d && (folderLoadAbortRef.current = null);
        s === treeLoadRequestRef.current && ek(!1);
      }
    }, [l3, logDriveDebug, activityCacheKey, storageHistoryCacheKey, storageHistoryCacheLegacyKey, treeCacheKey, upsertTreeNavSnapshot]),
    loadGalleryFiles = (0, c.useCallback)(async (e = {}) => {
      let a = e && "object" == typeof e ? e : {},
        l = galleryLoadRequestRef.current + 1;
      galleryLoadRequestRef.current = l, setGalleryAllLoading(!0);
      try {
        let e = await fetch("/api/cavcloud/gallery", {
            method: "GET",
            cache: "no-store"
          }),
          t = await ev(e);
        if (l !== galleryLoadRequestRef.current) return;
        if (!e.ok || !t?.ok) throw Error(String(t?.message || `Failed to load gallery (${e.status}).`));
        setGalleryAllFiles(Array.isArray(t.files) ? t.files : []);
      } catch (eErr) {
        if (l !== galleryLoadRequestRef.current) return;
        if (!a.silent) {
          let e = eErr instanceof Error ? eErr.message : "Failed to load gallery.";
          l3("bad", e);
        }
      } finally {
        l === galleryLoadRequestRef.current && setGalleryAllLoading(!1);
      }
    }, [l3]),
    l9 = (0, c.useCallback)(async () => {
      e0(!0), e2("");
      try {
        let e = await fetch("/api/cavcloud/shares", {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to load shared items."));
        eQ(function (e) {
          if (!Array.isArray(e)) return [];
          let a = [];
          for (let l of e) l?.id && l?.shareUrl && l?.createdAtISO && l?.expiresAtISO && a.push({
            id: String(l.id),
            mode: String(l.mode || "READ_ONLY"),
            expiresAtISO: String(l.expiresAtISO),
            revokedAtISO: null == l.revokedAtISO ? null : String(l.revokedAtISO),
            createdAtISO: String(l.createdAtISO),
            shareUrl: String(l.shareUrl),
            artifact: l.artifact?.id ? {
              id: String(l.artifact.id),
              displayTitle: String(l.artifact.displayTitle || "Shared item"),
              sourcePath: null == l.artifact.sourcePath ? null : String(l.artifact.sourcePath),
              mimeType: null == l.artifact.mimeType ? null : String(l.artifact.mimeType),
              type: null == l.artifact.type ? null : String(l.artifact.type),
              sizeBytes: eBytes(l.artifact.sizeBytes)
            } : null
          });
          return a;
        }(a.items));
        bumpDashboardRefresh();
      } catch (a) {
        let e = a instanceof Error ? a.message : "Failed to load shared items.";
        e2(e), l3("bad", e);
      } finally {
        e0(!1);
      }
    }, [l3, bumpDashboardRefresh]),
    loadCollabInbox = (0, c.useCallback)(async (e = {}) => {
      let a = e && "object" == typeof e ? e : {};
      setCollabInboxLoading(!0), setCollabInboxError("");
      try {
        let e = new URLSearchParams(),
          lFilter = "readonly" === collabInboxFilter || "edit" === collabInboxFilter || "expiringSoon" === collabInboxFilter ? collabInboxFilter : "all";
        "all" !== lFilter && e.set("filter", lFilter);
        let tQuery = e.toString(),
          sRes = await fetch(tQuery ? `/api/cavcloud/collab?${tQuery}` : "/api/cavcloud/collab", {
            method: "GET",
            cache: "no-store"
          }),
          iPayload = await ev(sRes);
        if (!sRes.ok || !iPayload?.ok) throw Error(String(iPayload?.message || "Failed to load collaboration inbox."));
        let r = Array.isArray(iPayload?.items) ? iPayload.items.map(e => {
          let a = "folder" === String(e?.targetType || "").trim().toLowerCase() ? "folder" : "file",
            lPermission = "EDIT" === String(e?.permission || "").trim().toUpperCase() ? "EDIT" : "VIEW",
            tGrantId = String(e?.grantId || "").trim(),
            sTargetId = String(e?.targetId || "").trim();
          if (!tGrantId || !sTargetId) return null;
          let iName = String(e?.name || sTargetId).trim() || sTargetId,
            rPath = T(String(e?.path || "/")) || "/",
            cExpiresAtISO = String(e?.expiresAtISO || "").trim() || null,
            oSharedBy = e && "object" == typeof e && e.sharedBy && "object" == typeof e.sharedBy ? e.sharedBy : {},
            dSaveShortcutBody = e && "object" == typeof e && e.saveShortcutBody && "object" == typeof e.saveShortcutBody ? e.saveShortcutBody : {},
            nRemoveShortcutBody = e && "object" == typeof e && e.removeShortcutBody && "object" == typeof e.removeShortcutBody ? e.removeShortcutBody : {};
          return {
            grantId: tGrantId,
            targetType: a,
            targetId: sTargetId,
            name: iName,
            path: rPath,
            mimeType: String(e?.mimeType || "").trim() || null,
            bytes: Number.isFinite(Number(e?.bytes)) ? Math.max(0, Number(e.bytes)) : null,
            permission: lPermission,
            permissionLabel: "EDIT" === lPermission ? "Collaborate" : "Read-only",
            expiresAtISO: cExpiresAtISO,
            expiringSoon: !!e?.expiringSoon,
            sharedBy: {
              userId: String(oSharedBy?.userId || "").trim() || null,
              username: String(oSharedBy?.username || "").trim() || null,
              displayName: String(oSharedBy?.displayName || "").trim() || null
            },
            createdAtISO: String(e?.createdAtISO || "").trim() || "",
            updatedAtISO: String(e?.updatedAtISO || "").trim() || "",
            openHref: String(e?.openHref || "").trim(),
            openInCavCodeHref: String(e?.openInCavCodeHref || "").trim() || null,
            shortcutSaved: !!e?.shortcutSaved,
            removeShortcutBody: {
              targetType: "folder" === String(nRemoveShortcutBody?.targetType || "").trim().toLowerCase() ? "folder" : "file",
              targetId: String(nRemoveShortcutBody?.targetId || sTargetId).trim() || sTargetId
            },
            saveShortcutBody: {
              targetType: "folder" === String(dSaveShortcutBody?.targetType || "").trim().toLowerCase() ? "folder" : "file",
              targetId: String(dSaveShortcutBody?.targetId || sTargetId).trim() || sTargetId,
              grantId: String(dSaveShortcutBody?.grantId || tGrantId).trim() || tGrantId
            },
            declineHref: String(e?.declineHref || "").trim()
          };
        }).filter(Boolean) : [];
        setCollabInboxItems(r);
        let cSummary = R(iPayload?.summary);
        setCollabInboxSummary({
          total: Math.max(0, Math.trunc(Number(cSummary?.total ?? r.length) || 0)),
          readonly: Math.max(0, Math.trunc(Number(cSummary?.readonly ?? r.filter(e => "VIEW" === e.permission).length) || 0)),
          canEdit: Math.max(0, Math.trunc(Number(cSummary?.canEdit ?? r.filter(e => "EDIT" === e.permission).length) || 0)),
          expiringSoon: Math.max(0, Math.trunc(Number(cSummary?.expiringSoon ?? r.filter(e => e.expiringSoon).length) || 0))
        }), bumpDashboardRefresh();
      } catch (tErr) {
        let e = tErr instanceof Error ? tErr.message : "Failed to load collaboration inbox.";
        setCollabInboxError(e), a.silent || l3("bad", e);
      } finally {
        setCollabInboxLoading(!1);
      }
    }, [collabInboxFilter, l3, bumpDashboardRefresh]),
    te = (0, c.useCallback)(async () => {
      ah(!0), av("");
      try {
        let ensureFolder = async (name, parentPath) => {
            let s = await fetch("/api/cavcloud/folders", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  name,
                  parentPath
                })
              }),
              i = await ev(s),
              r = String(i?.error || "").trim().toUpperCase();
            if (s.ok) return;
            if (409 === s.status || "PATH_CONFLICT" === r) {
              let c = T("/" === parentPath ? `/${name}` : `${parentPath}/${name}`),
                n = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(c)}&lite=1`, {
                  method: "GET",
                  cache: "no-store"
                }),
                o = await ev(n);
              if (n.ok && o?.ok && o.folder) return;
            }
            throw Error(String(i?.message || `Failed to ensure synced folder ${name}.`));
          };
        await ensureFolder("Synced", "/"), await Promise.all([ensureFolder("CavPad", "/Synced"), ensureFolder("CavCode", "/Synced")]);
        let e = ["/Synced/CavPad", "/Synced/CavCode", "/CavPad", "/CavCode", "/CavCode Sync"],
          a = new Set(),
          l = [],
          t = () => {
            for (; e.length;) {
              let l = T(e.shift() || "/");
              if (!a.has(l)) return a.add(l), l;
            }
            return null;
          },
          s = async () => {
            for (;;) {
              let a = t();
              if (!a) return;
              let s = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(a)}&lite=1`, {
                  method: "GET",
                  cache: "no-store"
                }),
                i = await ev(s);
              if (!s.ok || !i?.ok || !i.folder) {
                let e = String(i?.error || "").toUpperCase();
                if (404 === s.status || "FOLDER_NOT_FOUND" === e) continue;
                throw Error(String(i?.message || `Failed to load synced files (${s.status}).`));
              }
              let r = Array.isArray(i.files) ? i.files : [],
                c = Array.isArray(i.folders) ? i.folders : [];
              for (let a of (l.push(...r), c)) {
                let l = String(a?.path || "").trim();
                l && e.push(l);
              }
            }
          };
        await Promise.all(Array.from({
          length: 4
        }, () => s()));
        l.sort((e, a) => {
          let l = (Date.parse(a.updatedAtISO) || 0) - (Date.parse(e.updatedAtISO) || 0);
          return 0 !== l ? l : e.path.localeCompare(a.path, void 0, {
            sensitivity: "base"
          });
        }), an(l);
      } catch (a) {
        let e = a instanceof Error ? a.message : "Failed to load synced files.";
        av(e), l3("bad", e);
      } finally {
        ah(!1);
      }
    }, [l3]),
    ta = (0, c.useCallback)(async (e = {}) => {
      let a = {
        ...e
      };
      void 0 === a.silent && (a.silent = !0), await l7(z, a), "Synced" === S && (await te()), bumpDashboardRefresh();
    }, [S, z, te, l7, bumpDashboardRefresh]),
    refreshTreePostMutation = (0, c.useCallback)(async mutationType => {
      let type = String(mutationType || "mutation");
      setDriveDebugOptimisticCount(countDriveListingItems(en)), setDriveMutationState(type, "invalidating"), logDriveDebug("invalidate.start", {
        mutationType: type,
        folderPath: z
      });
      await ta({
        silent: !0,
        retries: CAVCLOUD_POST_MUTATION_RETRY_ATTEMPTS,
        retryDelayMs: CAVCLOUD_POST_MUTATION_RETRY_DELAY_MS
      });
      "Gallery" === S && await loadGalleryFiles({
        silent: !0
      });
      setDriveMutationState(type, "success"), logDriveDebug("invalidate.complete", {
        mutationType: type,
        folderPath: z
      });
      try {
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh", {
          detail: {
            source: "cavcloud",
            mutationType: type
          }
        }));
      } catch {}
    }, [en, z, S, ta, loadGalleryFiles, setDriveMutationState, logDriveDebug]),
    tSectionSelect = (0, c.useCallback)(e => {
      let a = "gallery" === e ? "gallery" : "files" === e ? "files" : "cloud" === e ? "cloud" : "folders";
      "gallery" === a && aN("all");
      setCloudSection(a);
      "gallery" === a ? l2("Gallery") : "files" === a ? l2("Files") : "folders" === a ? l2("Folders") : l2("Explore");
    }, [l2]),
    tl = (0, c.useCallback)(e => {
      e && aB(a => a[e] ? a : {
        ...a,
        [e]: !0
      });
    }, []),
    tt = (0, c.useCallback)(e => {
      tl(String(e.id || ""));
      let a = String(e.shareUrl || "").trim();
      if (!a) return;
      // Root-cause fix (A1): preserve SPA shell by avoiding same-tab hard navigations.
      try {
        let e = window.open(a, "_blank", "noopener,noreferrer");
        if (e) return;
      } catch {}
      try {
        let e = document.createElement("a");
        e.href = a, e.target = "_blank", e.rel = "noopener noreferrer", e.style.position = "fixed", e.style.left = "-9999px", document.body.appendChild(e), e.click(), e.remove();
      } catch {}
    }, [tl]);
  (0, c.useEffect)(() => {
    return () => {
      cancelPendingFolderSelect(), null != folderLoadAbortRef.current && folderLoadAbortRef.current.abort();
    };
  }, [cancelPendingFolderSelect]);
  (0, c.useEffect)(() => {
    cavcloudSettingsRef.current = cavcloudSettings;
  }, [cavcloudSettings]);
  (0, c.useEffect)(() => {
    googleDriveImportSessionStateRef.current = googleDriveImportSessionState;
  }, [googleDriveImportSessionState]);
  (0, c.useEffect)(() => {
    let eCanceled = !1;
    (async () => {
      try {
        let e = await fetch("/api/cavcloud/dashboard?range=7d", {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (eCanceled || !e.ok || !a?.ok) return;
        let l = Array.isArray(a?.uploads?.activeFolderUploads) ? a.uploads.activeFolderUploads : [],
          t = l.filter(e => "GOOGLE_DRIVE" === String(e?.provider || "").trim().toUpperCase());
        if (!t.length) return;
        setGoogleDriveImportSessionState(ePrev => {
          let aNext = {
            ...(ePrev && "object" == typeof ePrev ? ePrev : {})
          };
          for (let lSession of t) {
            let tSessionId = String(lSession?.sessionId || "").trim();
            if (!tSessionId) continue;
            let sStatus = String(lSession?.status || "RUNNING").trim().toUpperCase(),
              iDiscovered = Math.max(0, Math.trunc(Number(lSession?.discovered || 0)) || 0),
              rImported = Math.max(0, Math.trunc(Number(lSession?.uploaded || 0)) || 0),
              cFailed = Math.max(0, Math.trunc(Number(lSession?.failed || 0)) || 0),
              oPending = Math.max(0, iDiscovered - rImported - cFailed);
            googleDriveImportLastStatusRef.current = {
              ...googleDriveImportLastStatusRef.current,
              [tSessionId]: sStatus
            };
            aNext[tSessionId] = {
              ...(aNext[tSessionId] || {}),
              sessionId: tSessionId,
              status: sStatus,
              discoveredCount: iDiscovered,
              importedCount: rImported,
              failedCount: cFailed,
              pendingCount: oPending,
              targetFolderId: String(lSession?.rootFolderId || "").trim() || null,
              currentItemLabel: null,
              failedItems: Array.isArray(aNext[tSessionId]?.failedItems) ? aNext[tSessionId].failedItems : [],
              updatedAtISO: new Date().toISOString(),
              completedAtISO: null
            };
          }
          return aNext;
        });
        for (let lSession of t) {
          let sSessionId = String(lSession?.sessionId || "").trim();
          sSessionId && (await fetchGoogleDriveImportSessionStatus(sSessionId));
        }
      } catch {}
    })();
    return () => {
      eCanceled = !0;
    };
  }, []);
  (0, c.useEffect)(() => {
    let eSessions = Object.values(googleDriveImportSessionState || {}),
      aShouldPoll = eSessions.some(e => {
        let aStatus = String(e?.status || "RUNNING").trim().toUpperCase(),
          lDiscovered = Math.max(0, Math.trunc(Number(e?.discoveredCount || 0)) || 0),
          tImported = Math.max(0, Math.trunc(Number(e?.importedCount || 0)) || 0),
          sFailed = Math.max(0, Math.trunc(Number(e?.failedCount || 0)) || 0),
          iPending = Math.max(0, Math.trunc(Number(e?.pendingCount ?? lDiscovered - tImported - sFailed)) || 0);
        return "COMPLETED" !== aStatus && "CANCELED" !== aStatus && ("RUNNING" === aStatus || "CREATED" === aStatus || iPending > 0);
      });
    if (!aShouldPoll) return;
    let lCanceled = !1;
    let t = async () => {
      lCanceled || await pollGoogleDriveImportSessions();
    };
    void t();
    let sTimer = window.setInterval(() => {
      void t();
    }, 2200);
    return () => {
      lCanceled = !0, window.clearInterval(sTimer);
    };
  }, [googleDriveImportSessionState]);
  (0, c.useEffect)(() => {
    try {
      l.prefetch("/cavsafe");
    } catch {}
  }, [l]);
  (0, c.useEffect)(() => {
    void loadCavcloudSettings();
  }, [loadCavcloudSettings]);
  (0, c.useEffect)(() => {
    let eCanceled = !1;
    try {
      let eRawPublic = String(globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
      ("1" === eRawPublic || "true" === eRawPublic || "public" === eRawPublic) && setProfilePublicEnabled("public"), ("0" === eRawPublic || "false" === eRawPublic || "private" === eRawPublic) && setProfilePublicEnabled("private");
    } catch {}
    let eApplyProfile = ePayload => {
      if (eCanceled) return;
      let a = R(ePayload?.user);
      if (!a) return;
      let l = {
          name: String(a?.displayName || a?.name || "").trim(),
          email: String(a?.email || "").trim(),
          username: String(a?.username || "").trim()
        },
        tInitials = String(a?.initials || "").trim();
      eD(l.name), eW(l.email), eG(l.username), eB(resolveCavcloudGreetingName(l)), eU(resolveCavcloudInitials({
        ...l,
        initials: tInitials
      })), "boolean" == typeof a?.publicProfileEnabled && setProfilePublicEnabled(a.publicProfileEnabled ? "public" : "private");
    };
    let eLoadProfile = async () => {
      try {
        let eRes = await fetch("/api/auth/me", {
            method: "GET",
            cache: "no-store"
          }),
          aPayload = await ev(eRes);
        if (!eRes.ok || !aPayload?.ok || !aPayload?.authenticated) return;
        eApplyProfile(aPayload);
        let lAccount = R(aPayload?.account),
          tTier = resolveCavcloudPlanTier(lAccount),
          sTrial = resolveCavcloudTrialState(lAccount);
        eJ(tTier), eZ(sTrial.active), eq(sTrial.daysLeft);
        let roleRaw = String(aPayload?.membership?.role || "").trim().toUpperCase();
        setMemberRole("OWNER" === roleRaw || "ADMIN" === roleRaw || "MEMBER" === roleRaw ? roleRaw : isOwner ? "OWNER" : "ANON");
      } catch {}
    };
    void eLoadProfile();
    let eOnFocus = () => {
        void eLoadProfile();
      },
      eOnVisible = () => {
        "visible" === document.visibilityState && void eLoadProfile();
      },
      eTimer = window.setInterval(() => {
        void eLoadProfile();
      }, 6e4);
    return window.addEventListener("focus", eOnFocus), document.addEventListener("visibilitychange", eOnVisible), () => {
      eCanceled = !0, window.clearInterval(eTimer), window.removeEventListener("focus", eOnFocus), document.removeEventListener("visibilitychange", eOnVisible);
    };
  }, []);
  (0, c.useEffect)(() => {
    if ("undefined" == typeof navigator || !("serviceWorker" in navigator)) return;
    let e = !1;
    let a = {
      type: CAVCODE_MOUNT_CONTEXT_TYPE,
      projectId: null,
      shareId: null,
      viewerPrefix: CAVCODE_VIEWER_PREFIX,
      clear: !0
    };
    let l = async () => {
      let l = [];
      try {
        l = await navigator.serviceWorker.getRegistrations();
      } catch {}
      if (e) return;
      let t = l.filter(e => {
          let a = String(e.active?.scriptURL || e.waiting?.scriptURL || e.installing?.scriptURL || "").trim();
          return !!a && (a.includes("/cavcode/sw/mount-runtime.js") || a.includes("/mount-runtime.js"));
        }),
        s = String(navigator.serviceWorker.controller?.scriptURL || "").trim(),
        i = !!s && (s.includes("/cavcode/sw/mount-runtime.js") || s.includes("/mount-runtime.js"));
      try {
        navigator.serviceWorker.controller?.postMessage(a);
      } catch {}
      for (let e of t) try {
        e.active?.postMessage(a), e.waiting?.postMessage(a), e.installing?.postMessage(a);
      } catch {}
      await Promise.allSettled(t.map(e => e.unregister()));
      if (i) try {
        globalThis.__cbSessionStore.removeItem(CAVCLOUD_SW_EVICT_RELOAD_GUARD_KEY), logDriveDebug("sw.evict.runtime-controller", {
          status: "evicted_without_reload"
        });
      } catch {}
    };
    void l();
    return () => {
      e = !0;
    };
  }, []);
  (0, c.useEffect)(() => {
    if (enteredFromCavSafe) return;
    try {
      let e = A(globalThis.__cbLocalStore.getItem(treeCacheKey)),
        a = R(e?.payload),
        l = R(a?.folder),
        t = R(a?.usage);
      if (!a || !l || !t) return;
      let s = T(String(l.path || e?.folderPath || "/"));
      treeHasLoadedRef.current = !0, q(s), ey({
        folder: {
          ...l,
          path: s
        },
        breadcrumbs: Array.isArray(a.breadcrumbs) ? a.breadcrumbs : [],
        folders: Array.isArray(a.folders) ? a.folders : [],
        files: Array.isArray(a.files) ? a.files : [],
        trash: Array.isArray(a.trash) ? a.trash : [],
        usage: t,
        activity: W(a.activity),
        storageHistory: H(a.storageHistory)
      }), upsertTreeNavSnapshot(s, {
        folder: {
          ...l,
          path: s
        },
        breadcrumbs: Array.isArray(a.breadcrumbs) ? a.breadcrumbs : [],
        folders: Array.isArray(a.folders) ? a.folders : [],
        files: Array.isArray(a.files) ? a.files : [],
        trash: Array.isArray(a.trash) ? a.trash : [],
        usage: t,
        activity: W(a.activity),
        storageHistory: H(a.storageHistory)
      });
    } catch {}
  }, [enteredFromCavSafe, treeCacheKey, upsertTreeNavSnapshot]);
  (0, c.useEffect)(() => {
    if (!cavcloudSettingsLoaded || "ANON" === memberRole) return;
    let e = "/";
    try {
      if (folderPathFromQuery) {
        e = folderPathFromQuery;
      } else {
        let a = cavcloudSettingsRef.current || CAVCLOUD_SETTINGS_DEFAULTS;
        if ("lastFolder" === a.startLocation && a.lastFolderPath) e = T(a.lastFolderPath);else if ("pinnedFolder" === a.startLocation && a.pinnedFolderPath) e = T(a.pinnedFolderPath);else if (!enteredFromCavSafe) {
          let a = A(globalThis.__cbLocalStore.getItem(treeCacheKey)),
            l = String(a?.folderPath || "").trim();
          l && (e = T(l));
        }
      }
    } catch {}
    void l7(e);
  }, [l7, enteredFromCavSafe, treeCacheKey, folderPathFromQuery, cavcloudSettingsLoaded, memberRole]);
  (0, c.useEffect)(() => {
    let e = lZ.current;
    e && (e.setAttribute("webkitdirectory", ""), e.setAttribute("directory", ""));
  }, []);
  (0, c.useEffect)(() => {
    if ("Explore" === S) {
      setCloudSection("cloud");
      return;
    }
    if ("Folders" === S) {
      setCloudSection("folders");
      return;
    }
    if ("Files" === S) {
      setCloudSection("files");
      return;
    }
    if ("Gallery" === S) {
      setCloudSection("gallery"), ("grid" === aC || "grid_large" === aC) || ak("grid");
      return;
    }
  }, [S]);
  (0, c.useEffect)(() => {
    if ("ANON" === memberRole) return;
    "Synced" === S && void te();
  }, [S, te, memberRole]);
  (0, c.useEffect)(() => {
    if ("ANON" === memberRole) return;
    "Shared" === S && void l9();
  }, [S, l9, memberRole]);
  (0, c.useEffect)(() => {
    if ("ANON" === memberRole) return;
    "Collab" === S && void loadCollabInbox();
  }, [S, loadCollabInbox, memberRole]);
  (0, c.useEffect)(() => {
    if ("ANON" === memberRole) return;
    "Gallery" === S && void loadGalleryFiles({
      silent: !0
    });
  }, [S, loadGalleryFiles, memberRole]);
  (0, c.useEffect)(() => {
    "Gallery" === S && setGalleryPage(1);
  }, [S, aj, eM]);
  (0, c.useEffect)(() => {
    let e = e => {
      let a = T(String(e?.detail?.path || ""));
      a && (em(a, "/Synced/CavPad") || em(a, "/Synced/CavCode") || em(a, "/CavPad") || em(a, "/CavCode") || em(a, "/CavCode Sync")) && void refreshTreePostMutation("sync.event");
    };
    return window.addEventListener("cavcloud:file-updated", e), () => {
      window.removeEventListener("cavcloud:file-updated", e);
    };
  }, [refreshTreePostMutation]);
  (0, c.useEffect)(() => {
    let e = () => {
      if ("ANON" === memberRole) return;
      void Promise.all(["Shared" === S ? l9() : Promise.resolve(), "Collab" === S ? loadCollabInbox({
        silent: !0
      }) : Promise.resolve(), "Gallery" === S ? loadGalleryFiles({
        silent: !0
      }) : Promise.resolve(), ta({
        silent: !0
      })]);
    };
    return window.addEventListener("cavcloud:share-access-changed", e), () => {
      window.removeEventListener("cavcloud:share-access-changed", e);
    };
  }, [S, l9, loadCollabInbox, loadGalleryFiles, ta, memberRole]);
  (0, c.useEffect)(() => {
    let e = Array.isArray(en?.folders) ? en.folders : [];
    if (!e.length) return;
    let a = T(String(en?.folder?.path || "/")),
      l = Array.from(new Set(e.map(e => T(String(e?.path || ""))).filter(Boolean))).filter(e => e && e !== a);
    if (!l.length) return;
    let t = !1,
      s = () => {
        if (t) return;
        for (; l.length && treePrefetchInFlightRef.current.size < 3;) {
          let ePath = l.shift();
          if (!ePath || treePrefetchInFlightRef.current.has(ePath)) continue;
          treePrefetchInFlightRef.current.add(ePath), void fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(ePath)}&lite=1`, {
            method: "GET",
            cache: "no-store"
          }).then(async eRes => {
            let a = await ev(eRes);
            if (t || !eRes.ok || !a?.ok || !a?.folder) return;
            upsertTreeNavSnapshot(ePath, {
              folder: a.folder,
              breadcrumbs: Array.isArray(a.breadcrumbs) ? a.breadcrumbs : [],
              folders: Array.isArray(a.folders) ? a.folders : [],
              files: Array.isArray(a.files) ? a.files : [],
              trash: Array.isArray(en?.trash) ? en.trash : [],
              usage: R(en?.usage),
              activity: W(en?.activity),
              storageHistory: H(en?.storageHistory)
            });
          }).catch(() => {}).finally(() => {
            treePrefetchInFlightRef.current.delete(ePath), s();
          });
        }
      };
    s();
    return () => {
      t = !0;
    };
  }, [en?.folder?.path, en?.folders, en?.trash, en?.usage, en?.activity, en?.storageHistory, upsertTreeNavSnapshot]);
  let driveChildren = useDriveChildren({
      namespace: "cloud",
      folderPath: z,
      tree: en,
      isLoading: eC,
      isFetching: ew
    }),
    ts = (0, c.useMemo)(() => {
      let e = [...(driveChildren.folders || [])].sort(eu),
        a = eM.trim().toLowerCase();
      return a ? e.filter(e => e.name.toLowerCase().includes(a) || e.path.toLowerCase().includes(a)) : e;
    }, [eM, driveChildren.folders]),
    ti = (0, c.useMemo)(() => {
      let e = driveChildren.files || [],
        a = eM.trim().toLowerCase();
      return a ? e.filter(e => e.name.toLowerCase().includes(a) || e.path.toLowerCase().includes(a)) : e;
    }, [eM, driveChildren.files]),
    quickMountFolderOptions = (0, c.useMemo)(() => {
      let e = new Map(),
        aPush = (aId, lPath, tName) => {
          let s = String(aId || "").trim(),
            i = T(String(lPath || "/")),
            r = String(tName || Z(i) || "Folder").trim() || "Folder";
          if (!s) return;
          e.set(s, {
            id: s,
            kind: "folder",
            name: r,
            path: i,
            folderPath: i,
            entryPath: "/index.html"
          });
        };
      aPush(String(en?.folder?.id || "").trim(), T(String(en?.folder?.path || "/")), String(en?.folder?.name || "Current folder"));
      for (let l of ts) aPush(String(l?.id || "").trim(), T(String(l?.path || "/")), String(l?.name || ""));
      return Array.from(e.values()).sort((e, a) => {
        let lPath = String(e.path || "/"),
          tPath = String(a.path || "/");
        return "/" === lPath && "/" !== tPath ? -1 : "/" !== lPath && "/" === tPath ? 1 : lPath.localeCompare(tPath, void 0, {
          sensitivity: "base"
        });
      });
    }, [en?.folder?.id, en?.folder?.path, en?.folder?.name, ts]),
    quickMountFileOptions = (0, c.useMemo)(() => {
      let e = T(String(en?.folder?.path || "/")),
        a = new Map();
      for (let l of ti) {
        let t = String(l?.id || "").trim(),
          s = T(String(l?.path || O(e, String(l?.name || "")))),
          i = String(l?.name || Z(s) || "file").trim() || "file";
        if (!t || !s || "/" === s) continue;
        a.set(t, {
          id: t,
          kind: "file",
          name: i,
          path: s,
          folderPath: eh(s),
          entryPath: `/${i}`
        });
      }
      return Array.from(a.values()).sort((e, a) => String(e.name || "").localeCompare(String(a.name || ""), void 0, {
        sensitivity: "base"
      }));
    }, [en?.folder?.path, ti]),
    settingsPinnedFolderOptions = (0, c.useMemo)(() => {
      let e = new Map(),
        a = (aId, lPath, tName) => {
          let s = String(aId || "").trim(),
            i = T(String(lPath || "/")),
            r = String(tName || Z(i) || "CavCloud").trim() || "CavCloud";
          if (!s || "/" === i) return;
          e.set(s, {
            id: s,
            path: i,
            name: r
          });
        };
      let lCurrentId = String(en?.folder?.id || "").trim(),
        tCurrentPath = T(String(en?.folder?.path || "/"));
      lCurrentId && "/" !== tCurrentPath && a(lCurrentId, tCurrentPath, String(en?.folder?.name || Z(tCurrentPath) || "Current folder"));
      for (let l of Array.isArray(en?.breadcrumbs) ? en.breadcrumbs : []) a(String(l?.id || ""), String(l?.path || "/"), String(l?.name || ""));
      for (let l of Array.isArray(en?.folders) ? en.folders : []) a(String(l?.id || ""), String(l?.path || "/"), String(l?.name || ""));
      return Array.from(e.values()).sort((e, a) => e.path.localeCompare(a.path, void 0, {
        sensitivity: "base"
      }));
    }, [en?.folder, en?.breadcrumbs, en?.folders]),
  allGalleryScopedFiles = (0, c.useMemo)(() => {
      let e = Array.isArray(galleryAllFiles) ? galleryAllFiles : [],
        a = eM.trim().toLowerCase();
      return a ? e.filter(e => String(e.name || "").toLowerCase().includes(a) || String(e.path || "").toLowerCase().includes(a)) : e;
    }, [galleryAllFiles, eM]),
    tr = (0, c.useMemo)(() => allGalleryScopedFiles.filter(e => null !== Q(e)), [allGalleryScopedFiles]),
    tc = (0, c.useMemo)(() => {
      let e = 0,
        a = 0;
      for (let l of tr) "video" === Q(l) ? a += 1 : e += 1;
      return {
        photos: e,
        videos: a,
        total: tr.length
      };
    }, [tr]),
    to = (0, c.useMemo)(() => {
      let e = allGalleryScopedFiles;
      if (!e.length) return new Set();
      let a = new Set();
      for (let l of (driveChildren.activity || []).filter(e => "upload.camera_roll" === String(e.action || "").toLowerCase())) {
        let t = T(String(l.targetPath || "/")),
          s = eo(l.createdAtISO) ?? 0,
          i = R(l.metaJson),
          r = new Set(function (e, a) {
            if (!e) return [];
            let l = e[a];
            return Array.isArray(l) ? l.map(e => String(e || "").trim()).filter(Boolean) : [];
          }(i, "fileNames").map(e => e.toLowerCase())),
          c = Math.max(1, Math.trunc(U(i, "fileCount") || 0)),
          o = e.filter(e => eh(T(e.path)) === t);
        if (!o.length) continue;
        if (r.size > 0) {
          for (let e of o) r.has(e.name.toLowerCase()) && a.add(e.id);
          continue;
        }
        let d = o.map(e => {
            let a = eo(e.createdAtISO) ?? eo(e.updatedAtISO) ?? 0;
            return {
              id: e.id,
              distance: Math.abs(a - s)
            };
          }).sort((e, a) => e.distance - a.distance),
          n = Math.max(1, Math.min(c || 1, d.length));
        for (let e = 0; e < n; e++) a.add(d[e].id);
      }
      return a;
    }, [driveChildren.activity, allGalleryScopedFiles]),
    td = (0, c.useMemo)(() => "images" === aj ? tr.filter(e => "image" === Q(e)) : "videos" === aj ? tr.filter(e => "video" === Q(e)) : "mobile" === aj ? tr.filter(e => to.has(e.id)) : tr, [tr, aj, to]),
    tn = (0, c.useMemo)(() => {
      let e = 0,
        a = 0;
      for (let l of td) "video" === Q(l) ? a += 1 : e += 1;
      return {
        photos: e,
        videos: a,
        total: td.length
      };
    }, [td]),
    galleryTotalPages = (0, c.useMemo)(() => Math.max(1, Math.ceil(td.length / CAVCLOUD_GALLERY_PAGE_SIZE)), [td.length]),
    galleryPageSafe = (0, c.useMemo)(() => Math.max(1, Math.min(galleryPage, galleryTotalPages)), [galleryPage, galleryTotalPages]),
    galleryPageItems = (0, c.useMemo)(() => {
      let e = (galleryPageSafe - 1) * CAVCLOUD_GALLERY_PAGE_SIZE;
      return td.slice(e, e + CAVCLOUD_GALLERY_PAGE_SIZE);
    }, [td, galleryPageSafe]),
    galleryPageTokens = (0, c.useMemo)(() => {
      if (galleryTotalPages <= 6) {
        let e = [];
        for (let a = 1; a <= galleryTotalPages; a++) e.push(a);
        return e;
      }
      let e = [],
        a = Math.floor((galleryPageSafe - 1) / 6) * 6 + 1,
        l = Math.min(galleryTotalPages, a + 5);
      a > 1 && e.push("ellipsis-left");
      for (let t = a; t <= l; t++) e.push(t);
      return l < galleryTotalPages && e.push("ellipsis-right"), e;
    }, [galleryPageSafe, galleryTotalPages]),
    tu = (0, c.useMemo)(() => {
      let e = driveChildren.trash || [];
      if (!e.length) return [];
      let a = Date.now(),
        l = new Date(a);
      l.setMonth(l.getMonth() - 12);
      let t = eo(aH),
        s = eo(aK),
        i = "24h" === a_ ? a - 864e5 : "7d" === a_ ? a - 6048e5 : "30d" === a_ ? a - 2592e6 : "12m" === a_ ? l.getTime() : t,
        r = "custom" === a_ ? s : a;
      return e.filter(e => {
        let a = eo(e.deletedAtISO);
        return null != a && (null == i || !(a < i)) && (null == r || !(a > r));
      });
    }, [aH, aK, a_, driveChildren.trash]),
    th = (0, c.useMemo)(() => "folders" === aR ? tu.filter(e => "folder" === e.kind) : "files" === aR ? tu.filter(e => "file" === e.kind) : "images" === aR ? tu.filter(e => "image" === Y(e)) : "videos" === aR ? tu.filter(e => "video" === Y(e)) : tu, [tu, aR]),
    tm = (0, c.useMemo)(() => (driveChildren.trash || []).filter(e => "file" === e.kind && 7 >= ec(e.purgeAfterISO)).sort((e, a) => (Date.parse(e.purgeAfterISO) || 0) - (Date.parse(a.purgeAfterISO) || 0)), [driveChildren.trash]),
    tv = (0, c.useMemo)(() => (driveChildren.activity || []).filter(e => String(e.action || "").toLowerCase().includes("trash.restore")).sort((e, a) => (Date.parse(a.createdAtISO) || 0) - (Date.parse(e.createdAtISO) || 0)), [driveChildren.activity]),
    tp = (0, c.useMemo)(() => {
      if (!tv.length) return [];
      let e = Date.now(),
        a = new Date(e);
      a.setMonth(a.getMonth() - 12);
      let l = eo(a6),
        t = eo(a9),
        s = "24h" === a3 ? e - 864e5 : "7d" === a3 ? e - 6048e5 : "30d" === a3 ? e - 2592e6 : "12m" === a3 ? a.getTime() : l,
        i = "custom" === a3 ? t : e;
      return tv.filter(e => {
        let a = eo(e.createdAtISO);
        return null != a && (null == s || !(a < s)) && (null == i || !(a > i));
      });
    }, [a6, a9, a3, tv]),
    tf = (0, c.useMemo)(() => "any" === a4 ? tp : tp.filter(e => D(e) === a4), [a4, tp]),
    tg = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return e ? tf.filter(a => {
        let l = String(a.targetPath || "").toLowerCase(),
          t = String(a.targetType || "").toLowerCase(),
          s = _(D(a)).toLowerCase();
        return l.includes(e) || t.includes(e) || s.includes(e);
      }) : tf;
    }, [eM, tf]),
    tx = (0, c.useMemo)(() => ti.filter(e => !(null !== Q(e))), [ti]),
    ty = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return e ? ad.filter(a => a.name.toLowerCase().includes(e) || a.path.toLowerCase().includes(e) || a.mimeType.toLowerCase().includes(e)) : ad;
    }, [eM, ad]),
    tSyncedSourceForPath = (0, c.useCallback)((e, a = "") => {
      let l = T(String(e || "")),
        t = String(a || "").toLowerCase();
      if (em(l, "/Synced/CavPad") || em(l, "/CavPad") || t.includes("cavpad")) return "cavpad";
      if (em(l, "/Synced/CavCode") || em(l, "/CavCode") || em(l, "/CavCode Sync") || t.includes("cavcode")) return "cavcode";
      return null;
    }, []),
    tb = (0, c.useMemo)(() => ty.filter(e => "cavpad" === tSyncedSourceForPath(e.path)), [ty, tSyncedSourceForPath]),
    tj = (0, c.useMemo)(() => ty.filter(e => "cavcode" === tSyncedSourceForPath(e.path)), [ty, tSyncedSourceForPath]),
    tSyncedAll = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of [...tb, ...tj]) {
        let l = T(a.path).toLowerCase();
        e.has(l) || e.set(l, a);
      }
      return Array.from(e.values()).sort(eu);
    }, [tb, tj]),
    tSyncedEvents = (0, c.useMemo)(() => {
      let e = [],
        a = new Map();
      for (let e of tSyncedAll) a.set(T(e.path).toLowerCase(), e);
      let l = new Set(),
        t = en?.activity || [];
      for (let s of t) {
        let t = T(String(s?.targetPath || ""));
        if (!t || "/" === t) continue;
        let syncSourceHint = String(s?.metaJson?.source || s?.metaJson?.syncSource || s?.metaJson?.provider || s?.metaJson?.app || "");
        if (!syncSourceHint && !(em(t, "/Synced/CavPad") || em(t, "/Synced/CavCode") || em(t, "/CavPad") || em(t, "/CavCode") || em(t, "/CavCode Sync"))) continue;
        let c = tSyncedSourceForPath(t, syncSourceHint);
        if (!c) continue;
        let i = t.toLowerCase(),
          r = a.get(i) || null,
          o = String(s?.action || "").toLowerCase(),
          dStatus = String(s?.metaJson?.status || s?.metaJson?.syncStatus || s?.metaJson?.state || "").toLowerCase(),
          d = Date.parse(String(s?.createdAtISO || "")) || Date.parse(String(r?.updatedAtISO || r?.createdAtISO || "")) || 0,
          n = d > 0 ? new Date(d).toISOString() : String(s?.createdAtISO || r?.updatedAtISO || r?.createdAtISO || "").trim() || null,
          h = r || {
            id: `path:${t}`,
            name: Z(t) || "Synced file",
            path: t,
            mimeType: "",
            bytes: 0,
            createdAtISO: n,
            updatedAtISO: n
          };
        let m = "synced",
          v = "Synced";
        dStatus.includes("fail") || dStatus.includes("error") || o.includes("fail") || o.includes("error") ? (m = "failed", v = "Failed") : dStatus.includes("queue") || dStatus.includes("pending") || dStatus.includes("progress") || dStatus.includes("loading") || o.includes("queue") || o.includes("pending") || o.includes("in_progress") || o.includes("processing") || o.includes("loading") ? (m = "loading", v = "Syncing") : o.includes("file.update") ? (m = "updated", v = "Updated") : o.includes("metadata.create") || o.includes("file.create") ? (m = "created", v = "Created") : o.includes("upload") ? (m = "imported", v = "Imported") : (Date.parse(String(h.updatedAtISO || "")) || 0) > (Date.parse(String(h.createdAtISO || "")) || 0) && (m = "updated", v = "Updated");
        let p = E(s);
        e.push({
          id: `sync_event:${s.id}`,
          file: h,
          source: c,
          status: m,
          statusLabel: v,
          actionLabel: p.label,
          metaLabel: p.meta,
          timeMs: d,
          timeISO: n,
          isFileAvailable: !!r
        }), l.add(i);
      }
      for (let t of tSyncedAll) {
        let s = T(t.path).toLowerCase();
        if (l.has(s)) continue;
        let i = tSyncedSourceForPath(t.path);
        if (!i) continue;
        let
          r = Date.parse(String(t.updatedAtISO || t.createdAtISO || "")) || 0,
          c = r > 0 ? new Date(r).toISOString() : String(t.updatedAtISO || t.createdAtISO || "").trim() || null,
          o = "synced",
          d = "Synced";
        (Date.parse(String(t.updatedAtISO || "")) || 0) > (Date.parse(String(t.createdAtISO || "")) || 0) && (o = "updated", d = "Updated"), e.push({
          id: `sync_snapshot:${t.id}`,
          file: t,
          source: i,
          status: o,
          statusLabel: d,
          actionLabel: `${"cavpad" === i ? "CavPad" : "CavCode"} sync`,
          metaLabel: F(t.path),
          timeMs: r,
          timeISO: c,
          isFileAvailable: !0
        });
      }
      return e.sort((e, a) => {
        let l = (a.timeMs || 0) - (e.timeMs || 0);
        return 0 !== l ? l : e.id.localeCompare(a.id, void 0, {
          sensitivity: "base"
        });
      });
    }, [en?.activity, tSyncedAll, tSyncedSourceForPath]),
    tSyncedScoped = (0, c.useMemo)(() => {
      let e = "cavpad" === syncedSource ? tSyncedEvents.filter(e => "cavpad" === e.source) : "cavcode" === syncedSource ? tSyncedEvents.filter(e => "cavcode" === e.source) : tSyncedEvents,
        a = Date.now(),
        l = new Date(a);
      l.setMonth(l.getMonth() - 12);
      let t = "24h" === syncedTimeline ? a - 864e5 : "7d" === syncedTimeline ? a - 6048e5 : "30d" === syncedTimeline ? a - 2592e6 : l.getTime();
      return e.filter(e => {
        let a = Number(e.timeMs) || Date.parse(String(e.timeISO || ""));
        return !Number.isFinite(a) || !(a < t);
      });
    }, [tSyncedEvents, syncedSource, syncedTimeline]),
    tSyncedCounts = (0, c.useMemo)(() => {
      let e = 0,
        a = 0;
      for (let l of tSyncedScoped) "cavpad" === l.source ? e += 1 : a += 1;
      return {
        total: tSyncedScoped.length,
        cavpad: e,
        cavcode: a,
        lastISO: tSyncedScoped[0]?.timeISO || tSyncedScoped[0]?.file?.updatedAtISO || null
      };
    }, [tSyncedScoped]),
    tSyncedSourceLabel = (0, c.useMemo)(() => SYNC_SOURCE_OPTIONS.find(e => e.key === syncedSource)?.label || "Synced", [syncedSource]),
    tSyncedTimelineLabel = (0, c.useMemo)(() => SYNC_TIMELINE_OPTIONS.find(e => e.key === syncedTimeline)?.label || "Last 24 hours", [syncedTimeline]),
    tSyncedChart = (0, c.useMemo)(() => {
      let e = Date.now(),
        a = [],
        l = 1;
      if ("24h" === syncedTimeline) {
        let t = new Date(e);
        t.setMinutes(0, 0, 0);
        let s = t.getTime() - 23 * 36e5;
        a = Array.from({
          length: 24
        }, (e, a) => {
          let l = s + a * 36e5;
          return {
            ts: l,
            label: new Date(l).toLocaleTimeString(void 0, {
              hour: "numeric"
            }),
            cavpad: 0,
            cavcode: 0
          };
        }), l = 4;
        for (let e of tSyncedScoped) {
          let i = Number(e.timeMs) || Date.parse(String(e.timeISO || ""));
          if (!Number.isFinite(i)) continue;
          let t = Math.floor((i - s) / 36e5);
          if (t < 0 || t >= 24) continue;
          "cavpad" === e.source ? a[t].cavpad += 1 : a[t].cavcode += 1;
        }
      } else if ("7d" === syncedTimeline || "30d" === syncedTimeline) {
        let t = "7d" === syncedTimeline ? 7 : 30,
          s = new Date(e);
        s.setHours(0, 0, 0, 0);
        let i = s.getTime() - (t - 1) * 864e5;
        a = Array.from({
          length: t
        }, (e, a) => {
          let l = i + a * 864e5;
          return {
            ts: l,
            label: new Date(l).toLocaleDateString(void 0, {
              month: "short",
              day: "numeric"
            }),
            cavpad: 0,
            cavcode: 0
          };
        }), l = 7 === t ? 1 : 5;
        for (let e of tSyncedScoped) {
          let cEvent = Number(e.timeMs) || Date.parse(String(e.timeISO || ""));
          if (!Number.isFinite(cEvent)) continue;
          let s = new Date(cEvent);
          s.setHours(0, 0, 0, 0);
          let r = Math.floor((s.getTime() - i) / 864e5);
          if (r < 0 || r >= t) continue;
          "cavpad" === e.source ? a[r].cavpad += 1 : a[r].cavcode += 1;
        }
      } else {
        let t = new Date(e),
          s = new Date(t.getFullYear(), t.getMonth(), 1),
          i = new Date(s.getFullYear(), s.getMonth() - 11, 1);
        a = Array.from({
          length: 12
        }, (e, a) => {
          let l = new Date(i.getFullYear(), i.getMonth() + a, 1).getTime();
          return {
            ts: l,
            label: new Date(l).toLocaleDateString(void 0, {
              month: "short"
            }),
            cavpad: 0,
            cavcode: 0
          };
        }), l = 2;
        for (let e of tSyncedScoped) {
          let cEvent = Number(e.timeMs) || Date.parse(String(e.timeISO || ""));
          if (!Number.isFinite(cEvent)) continue;
          let t = new Date(cEvent),
            s = 12 * (t.getFullYear() - i.getFullYear()) + (t.getMonth() - i.getMonth());
          if (s < 0 || s >= 12) continue;
          "cavpad" === e.source ? a[s].cavpad += 1 : a[s].cavcode += 1;
        }
      }
      let t = Math.max(1, ...a.map(e => Math.max(e.cavpad, e.cavcode))),
        s = 620,
        i = 228,
        r = 38,
        c = 18,
        o = 22,
        d = 36,
        n = s - r - c,
        h = i - o - d,
        m = o + h,
        v = Math.max(1, a.length),
        p = n / v,
        f = Math.max(9, Math.min(26, p - ("24h" === syncedTimeline ? 2 : "7d" === syncedTimeline ? 6 : "30d" === syncedTimeline ? 4 : 8))),
        g = Math.max(2, Math.min(4, .14 * f)),
        y = Math.max(3.2, Math.min(11, (f - g) / 2)),
        x = 2 * y + g,
        b = Math.max(2.2, Math.min(6, .24 * f)),
        j = e => o + (1 - e / t) * h,
        C = [1, .75, .5, .25, 0].map(e => {
          let a = Math.round(t * e);
          return {
            y: j(a),
            value: a
          };
        }),
        S = a.map((e, a) => {
          let l = r + a * p,
            t = l + (p - x) / 2,
            s = e.cavpad > 0 ? Math.max(1.4, m - j(e.cavpad)) : 0,
            i = e.cavcode > 0 ? Math.max(1.2, m - j(e.cavcode)) : 0,
            c = m - s,
            o = m - i;
          return {
            index: a,
            ts: e.ts,
            label: e.label,
            cavpad: e.cavpad,
            cavcode: e.cavcode,
            slotX: l,
            slotWidth: p,
            cavpadX: t,
            cavcodeX: t + y + g,
            cavpadY: c,
            cavcodeY: o,
            cavpadHeight: s,
            cavcodeHeight: i
          };
        }),
        A = S.flatMap(e => [{
          id: `pad_${e.index}`,
          source: "cavpad",
          x: e.cavpadX,
          y: e.cavpadY,
          width: y,
          height: e.cavpadHeight,
          radius: b,
          value: e.cavpad,
          label: e.label
        }, {
          id: `code_${e.index}`,
          source: "cavcode",
          x: e.cavcodeX,
          y: e.cavcodeY,
          width: y,
          height: e.cavcodeHeight,
          radius: b,
          value: e.cavcode,
          label: e.label
        }]),
        k = A.filter(e => e.height > 0).map(e => ({
          id: `marker_${e.id}`,
          source: e.source,
          cx: e.x + e.width / 2,
          cy: e.y + (.32 * e.radius - .35),
          r: "cavpad" === e.source ? 1.55 : 1.2
        }));
      return {
        width: s,
        height: i,
        left: r,
        right: c,
        top: o,
        bottom: m,
        points: a,
        ticks: C,
        labelStep: l,
        groups: S,
        bars: A,
        markers: k,
        maxValue: t,
        cavpadTotal: a.reduce((e, a) => e + a.cavpad, 0),
        cavcodeTotal: a.reduce((e, a) => e + a.cavcode, 0)
      };
    }, [tSyncedScoped, syncedTimeline]),
    tN = "Explore" === S || "Folders" === S || "Files" === S || "Gallery" === S || "Shared" === S || "Starred" === S || ("Trash" === S && "restorations" !== a1),
    tUsage = (0, c.useMemo)(() => {
      let e = R(en?.usage),
        a = resolveCavcloudStorageLimitBytes(eK, eV);
      if (!e) return {
        usedBytes: 0,
        limitBytes: a
      };
      let l = Number(e.usedBytes),
        t = null == e.limitBytes ? a : Math.max(0, Number(e.limitBytes || 0));
      return {
        ...e,
        usedBytes: Number.isFinite(l) && l > 0 ? Math.max(0, Math.trunc(l)) : 0,
        limitBytes: Number.isFinite(t) ? t : null
      };
    }, [en?.usage, eK, eV]),
    tUsedRatio = (0, c.useMemo)(() => {
      if (!tUsage) return 0;
      let {
        usedBytes: e,
        limitBytes: a
      } = tUsage;
      if (null == a || a <= 0) return 0;
      return Math.max(0, Math.min(1, e / a));
    }, [tUsage]),
    tC = (0, c.useMemo)(() => Math.round(100 * tUsedRatio), [tUsedRatio]),
    tk = tC >= 80 && tC < 100,
    tw = tC >= 100,
    tS = P(tUsage?.limitBytes ?? null),
    tM = P(tUsage?.usedBytes ?? 0),
    tI = (0, c.useMemo)(() => {
      let e = {
        code: 0,
        image: 0,
        video: 0,
        other: 0
      };
      for (let a of en?.files || []) {
        let l = er(a);
        e[l] += Math.max(0, Number(a.bytes) || 0);
      }
      return e;
    }, [en?.files]),
    tRingMixCounts = (0, c.useMemo)(() => {
      let e = {
        folder: Math.max(0, (en?.folders || []).length),
        image: 0,
        video: 0,
        code: 0,
        other: 0
      };
      for (let a of en?.files || []) {
        let l = er(a);
        e[l] += 1;
      }
      return e;
    }, [en?.files, en?.folders]),
    tRingMixTotal = (0, c.useMemo)(() => tRingMixCounts.folder + tRingMixCounts.image + tRingMixCounts.video + tRingMixCounts.code + tRingMixCounts.other, [tRingMixCounts]),
    tL = (0, c.useMemo)(() => {
      let e = Math.min(360, Math.max(0, 360 * tUsedRatio));
      if (e > 0 && e < 1.25) return "conic-gradient(rgba(255,255,255,0.12) 0deg 360deg)";
      if (e <= 0) return "conic-gradient(rgba(255,255,255,0.12) 0deg 360deg)";
      let a = tRingMixTotal > 0 ? tRingMixTotal : 1,
        l = 0,
        t = [];
      for (let s of ["folder", "other", "image", "video", "code"]) {
        let i = tRingMixCounts[s];
        if (i <= 0) continue;
        let r = i / a * e,
          c = Math.min(e, l + r);
        c > l && t.push(`${L[s].color} ${l}deg ${c}deg`), l = c;
      }
      return t.length ? l < e && t.push(`${L.other.color} ${l}deg ${e}deg`) : (t.push(`${L.folder.color} 0deg ${e}deg`), l = e), t.push(`rgba(255,255,255,0.12) ${e}deg 360deg`), `conic-gradient(${t.join(", ")})`;
    }, [tRingMixCounts, tRingMixTotal, tUsedRatio]),
    tA = P((0, c.useMemo)(() => {
      let e = tUsage?.usedBytes ?? 0,
        a = tUsage?.limitBytes ?? null;
      return null == a ? null : Math.max(0, a - e);
    }, [tUsage])),
    tT = G(tM),
    tO = G(tA),
    tF = G(tS),
    tP = (0, c.useMemo)(() => en?.activity || [], [en?.activity]),
    tRecentsScoped = (0, c.useMemo)(() => {
      if ("Recents" !== S) return tP;
      let e = Date.now(),
        a = new Date(e);
      a.setFullYear(a.getFullYear() - 1);
      let l = "24h" === recentsTimeline ? e - 864e5 : "7d" === recentsTimeline ? e - 6048e5 : "30d" === recentsTimeline ? e - 2592e6 : a.getTime();
      return tP.filter(a => {
        let t = Date.parse(String(a.createdAtISO || "")) || 0;
        if (t < l || t > e) return !1;
        let i = eRecentTargetKind(a);
        if ("folders" === recentsKind) return "folder" === i;
        if ("files" === recentsKind) return "file" === i;
        if ("gallery" === recentsKind) {
          if ("file" !== i) return !1;
          let e = eRecentTargetPath(a),
            l = e.split("/").filter(Boolean).pop() || "",
            t = ea("", l);
          return "image" === t || "video" === t;
        }
        return !0;
      });
    }, [S, tP, recentsKind, recentsTimeline]),
    tB = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return e ? tRecentsScoped.filter(a => {
        let l = E(a);
        return l.label.toLowerCase().includes(e) || l.meta.toLowerCase().includes(e) || String(a.action || "").toLowerCase().includes(e);
      }) : tRecentsScoped;
    }, [tRecentsScoped, eM]),
    tRecentTotalPages = (0, c.useMemo)(() => Math.max(1, Math.ceil(tB.length / CAVCLOUD_RECENTS_PAGE_SIZE)), [tB.length]),
    tRecentPageSafe = (0, c.useMemo)(() => Math.max(1, Math.min(recentsPage, tRecentTotalPages)), [recentsPage, tRecentTotalPages]),
    tRecentPageItems = (0, c.useMemo)(() => {
      let e = (tRecentPageSafe - 1) * CAVCLOUD_RECENTS_PAGE_SIZE;
      return tB.slice(e, e + CAVCLOUD_RECENTS_PAGE_SIZE);
    }, [tB, tRecentPageSafe]),
    tRecentPageTokens = (0, c.useMemo)(() => {
      if (tRecentTotalPages <= 6) {
        let e = [];
        for (let a = 1; a <= tRecentTotalPages; a++) e.push(a);
        return e;
      }
      let e = [],
        a = Math.floor((tRecentPageSafe - 1) / 6) * 6 + 1,
        l = Math.min(tRecentTotalPages, a + 5);
      a > 1 && e.push("ellipsis-left");
      for (let t = a; t <= l; t++) e.push(t);
      return l < tRecentTotalPages && e.push("ellipsis-right"), e;
    }, [tRecentPageSafe, tRecentTotalPages]),
    tR = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of [...tP].reverse()) {
        let l = String(a.action || "").toLowerCase(),
          t = T(String(a.targetPath || "/")),
          s = "file.star" === l || "folder.star" === l,
          i = "file.unstar" === l || "folder.unstar" === l;
        if (!s && !i) continue;
        let r = l.startsWith("folder") || "folder" === String(a.targetType || "").toLowerCase() ? "folder" : "file",
          c = a.targetPath ? t : `${r}:${a.targetId || a.id}`;
        s ? e.set(c, {
          path: t,
          targetType: r,
          targetId: null == a.targetId ? null : String(a.targetId),
          createdAtISO: a.createdAtISO
        }) : e.delete(c);
      }
      return Array.from(e.values()).sort((e, a) => Date.parse(a.createdAtISO) - Date.parse(e.createdAtISO));
    }, [tP]),
    tU = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return e ? tR.filter(a => a.path.toLowerCase().includes(e)) : tR;
    }, [tR, eM]),
    tE = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of en?.files || []) e.has(a.id) || e.set(a.id, a);
      for (let a of ad) e.has(a.id) || e.set(a.id, a);
      return e;
    }, [ad, en?.files]),
    tD = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of en?.files || []) e.set(T(a.path), a);
      for (let a of ad) {
        let l = T(a.path);
        e.has(l) || e.set(l, a);
      }
      return e;
    }, [ad, en?.files]),
    t_ = (0, c.useMemo)(() => resolveCavcloudUserLabel({
      name: eE,
      email: e_,
      username: eH
    }), [eE, e_, eH]),
    tW = (0, c.useCallback)(e => {
      let a = ePreviewKind(e.mimeType, e.name),
        l = ee(e.mimeType, e.name),
        t = el("file", e.id, e.path),
        sBytes = eBytes(e?.bytes),
        s = {
          id: e.id,
          resourceId: e.id,
          source: "file",
          previewKind: a,
          mediaKind: a,
          name: e.name,
          path: e.path,
          mimeType: l,
          bytes: sBytes,
          createdAtISO: e.createdAtISO,
          modifiedAtISO: e.updatedAtISO,
          uploadedAtISO: e.createdAtISO,
          uploadedBy: t_,
          rawSrc: t,
          downloadSrc: `${t}&download=1`,
          openHref: "",
          shareFileId: e.id,
          sharedUserCount: Number.isFinite(Number(e.sharedUserCount)) ? Math.max(0, Number(e.sharedUserCount)) : 0,
          collaborationEnabled: !!e.collaborationEnabled
        };
      return s.openHref = et(s), s;
    }, [t_]),
    tH = (0, c.useCallback)(e => {
      let a = T(e.path);
      // Root-cause fix: "/" is a folder root, never a previewable file path.
      if (!a || "/" === a) return null;
      let l = String(e.name || "").trim() || Z(a) || "File",
        t = ee(String(e.mimeType || ""), l),
        s = ePreviewKind(t, l);
      let i = el("by_path", "by-path", a),
        rBytes = eBytes(e?.bytes),
        r = {
          id: String(e.previewId || `path:${a}`),
          resourceId: "by-path",
          source: "by_path",
          previewKind: s,
          mediaKind: s,
          name: l,
          path: a,
          mimeType: t,
          bytes: rBytes,
          createdAtISO: e.createdAtISO || null,
          modifiedAtISO: e.modifiedAtISO || null,
          uploadedAtISO: e.createdAtISO || null,
          uploadedBy: t_,
          rawSrc: i,
          downloadSrc: i,
          openHref: "",
          shareFileId: null,
          sharedUserCount: null,
          collaborationEnabled: null
        };
      return r.openHref = et(r), r;
    }, [t_]),
    tG = (0, c.useCallback)(e => {
      if ("file" !== e.kind) return null;
      let a = ePreviewKind("", e.name || e.path);
      let l = ee("", e.name || e.path),
        t = el("trash", e.id, e.path),
        sBytes = eBytes(e?.bytes),
        s = {
          id: e.id,
          resourceId: e.id,
          source: "trash",
          previewKind: a,
          mediaKind: a,
          name: e.name,
          path: e.path,
          mimeType: l,
          bytes: sBytes,
          createdAtISO: null,
          modifiedAtISO: e.deletedAtISO,
          uploadedAtISO: null,
          uploadedBy: t_,
          rawSrc: t,
          downloadSrc: t,
          openHref: "",
          shareFileId: null,
          sharedUserCount: null,
          collaborationEnabled: null
        };
      return s.openHref = et(s), s;
    }, [t_]),
    tK = (0, c.useCallback)(e => {
      let a = String(e.item.artifact?.id || "").trim();
      if (!a) return null;
      let l = e.shareSourcePath || `/${e.shareName}`,
        t = ee(String(e.item.artifact?.mimeType || ""), e.shareName),
        s = ePreviewKind(t, e.shareName),
        i = el("artifact", a, l),
        nBytes = eBytes(e?.item?.artifact?.sizeBytes ?? e?.item?.artifact?.bytes ?? e?.item?.sizeBytes ?? e?.item?.bytes),
        r = {
          id: e.item.id,
          resourceId: a,
          source: "artifact",
          previewKind: s,
          mediaKind: s,
          name: e.shareName,
          path: l,
          mimeType: t,
          bytes: nBytes,
          createdAtISO: e.item.createdAtISO,
          modifiedAtISO: e.item.createdAtISO,
          uploadedAtISO: e.item.createdAtISO,
          uploadedBy: t_,
          shareUrl: e.item.shareUrl,
          rawSrc: i,
          downloadSrc: `${i}&download=1`,
          openHref: "",
          shareFileId: null,
          sharedUserCount: null,
          collaborationEnabled: null
        };
      return r.openHref = et(r), r;
    }, [t_]),
    tJ = (0, c.useCallback)(e => {
      if ("file" !== e.targetType) return null;
      if (e.targetId) {
        let a = tE.get(e.targetId);
        if (a) return tW(a);
      }
      return tH({
        path: e.path,
        name: Z(e.path),
        previewId: `${e.targetType}:${T(e.path)}`,
        createdAtISO: e.createdAtISO,
        modifiedAtISO: e.createdAtISO
      });
    }, [tH, tW, tE]),
    tV = (0, c.useCallback)(e => !!e && (C(e), !0), [C]),
    tZ = (0, c.useCallback)(e => {
      if (!e) return !1;
      // Root-cause fix: route directly to viewer to avoid preview-state race with URL sync effects.
      let a = String(e.openHref || "").trim() || et(e);
      if (!a) return !1;
      l.push(a);
      return !0;
    }, [l]),
    tz = (0, c.useMemo)(() => "folders" === aA ? tU.filter(e => "folder" === e.targetType) : "files" === aA ? tU.filter(e => "file" === e.targetType && null == X(e, tE)) : "gallery" === aA ? tU.filter(e => null != X(e, tE)) : tU, [tE, aA, tU]),
    tq = (0, c.useMemo)(() => tB.slice(0, 5), [tB]),
    tY = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return (e ? tR.filter(a => Z(a.path).toLowerCase().includes(e) || a.path.toLowerCase().includes(e)) : tR).slice(0, 6);
    }, [tR, eM]),
    tQ = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      return e ? eY.filter(a => {
        let l = String(a.artifact?.displayTitle || "").toLowerCase(),
          t = String(a.artifact?.sourcePath || "").toLowerCase();
        return l.includes(e) || t.includes(e) || a.shareUrl.toLowerCase().includes(e);
      }) : eY;
    }, [eM, eY]),
    tX = (0, c.useMemo)(() => tQ.map(e => {
      let a = e.shareUrl.replace(/^https?:\/\//i, ""),
        l = !!e.revokedAtISO,
        t = String(e.artifact?.sourcePath || ""),
        s = Z(t),
        i = e.artifact?.displayTitle || s || "Shared item",
        r = String(e.artifact?.mimeType || ""),
        c = String(e.artifact?.type || "").trim().toUpperCase(),
        o = "FOLDER" === c ? null : ea(r, s || i),
        d = o && e.artifact?.id ? `/api/cavcloud/artifacts/${encodeURIComponent(e.artifact.id)}/preview?raw=1` : "";
      return {
        item: e,
        shareLabel: a,
        revoked: l,
        shareSourcePath: t,
        shareName: i,
        shareType: c,
        shareMediaKind: o,
        sharePreviewUrl: d,
        visited: !!aP[e.id],
        createdAtMs: Date.parse(e.createdAtISO) || 0
      };
    }).sort((e, a) => a.createdAtMs - e.createdAtMs), [tQ, aP]),
    t0 = (0, c.useMemo)(() => "folders" === aO ? tX.filter(e => "FOLDER" === e.shareType) : "files" === aO ? tX.filter(e => "FOLDER" !== e.shareType) : "gallery" === aO ? tX.filter(e => null !== e.shareMediaKind) : "shared" === aO ? tX.filter(e => !e.revoked) : "visited_links" === aO ? tX.filter(e => e.visited) : tX, [tX, aO]),
    t1 = (0, c.useMemo)(() => "Folders" === S ? ts.map(e => ({
      id: e.id,
      kind: "folder",
      name: e.name,
      path: e.path
    })) : "Files" === S ? tx.map(e => ({
      id: e.id,
      kind: "file",
      name: e.name,
      path: e.path
    })) : "Gallery" === S ? galleryPageItems.map(e => ({
      id: e.id,
      kind: "file",
      name: e.name,
      path: e.path
    })) : "Shared" === S ? t0.map(e => ({
      id: e.item.id,
      kind: "file",
      name: e.shareName,
      path: e.shareSourcePath || e.shareLabel
    })) : "Starred" === S ? tz.map(e => ({
      id: e.targetId || `path:${T(e.path)}`,
      kind: e.targetType,
      name: Z(e.path) || e.path,
      path: e.path
    })) : "Trash" === S && "restorations" !== a1 ? th.map(e => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      path: e.path
    })) : "Explore" === S ? [...ts.map(e => ({
      id: e.id,
      kind: "folder",
      name: e.name,
      path: e.path
    })), ...ti.map(e => ({
      id: e.id,
      kind: "file",
      name: e.name,
      path: e.path
    }))] : [], [S, ti, tx, ts, galleryPageItems, t0, tz, a1, th]),
    collabLaunchScopedItems = (0, c.useMemo)(() => {
      let e = new Map(),
        aPush = (a, l) => {
          let t = String(l?.id || "").trim();
          if (!t) return;
          let s = T(String(l?.path || "")),
            i = String(l?.name || Z(s) || t).trim() || t,
            r = "folder" === a ? "folder" : "file",
            c = `${r}:${t}`;
          e.set(c, {
            key: c,
            id: t,
            kind: r,
            resourceType: "folder" === r ? "FOLDER" : "FILE",
            name: i,
            path: s
          });
        };
      for (let l of driveChildren.folders || []) aPush("folder", l);
      for (let l of driveChildren.files || []) aPush("file", l);
      return Array.from(e.values());
    }, [driveChildren.folders, driveChildren.files]),
    collabLaunchItems = (0, c.useMemo)(() => {
      let e = new Map();
      for (let a of [...collabLaunchGlobalItems, ...collabLaunchScopedItems]) {
        let l = String(a?.key || "").trim();
        l && e.set(l, a);
      }
      return Array.from(e.values()).sort((e, a) => {
        if (e.kind !== a.kind) return "folder" === e.kind ? -1 : 1;
        let l = e.name.localeCompare(a.name, void 0, {
          sensitivity: "base"
        });
        return l || e.path.localeCompare(a.path, void 0, {
          sensitivity: "base"
        });
      });
    }, [collabLaunchGlobalItems, collabLaunchScopedItems]),
    collabLaunchVisibleItems = (0, c.useMemo)(() => {
      let e = String(collabLaunchQuery || "").trim().toLowerCase();
      if (!e) return collabLaunchItems;
      return collabLaunchItems.filter(a => String(a.name || "").toLowerCase().includes(e) || String(a.path || "").toLowerCase().includes(e));
    }, [collabLaunchItems, collabLaunchQuery]),
    collabLaunchSelectedItem = (0, c.useMemo)(() => {
      let e = String(collabLaunchSelectionKey || "").trim();
      return e ? collabLaunchItems.find(a => a.key === e) || null : null;
    }, [collabLaunchItems, collabLaunchSelectionKey]),
    collabLaunchCountLabel = (0, c.useCallback)(e => {
      let a = String(e?.id || "").trim(),
        l = a ? collabLaunchFolderCounts[a] : null;
      if (!l) return "0 folders • 0 files";
      if ("error" === String(l?.status || "")) return "0 folders • 0 files";
      let t = Math.max(0, Math.trunc(Number(l?.folders || 0)) || 0),
        s = Math.max(0, Math.trunc(Number(l?.files || 0)) || 0);
      return `${t} folder${1 === t ? "" : "s"} • ${s} file${1 === s ? "" : "s"}`;
    }, [collabLaunchFolderCounts]),
    continueCollabLaunch = (0, c.useCallback)(() => {
      if (!collabLaunchSelectedItem) return;
      setCollabLaunchModalOpen(!1), setCollabLaunchQuery(""), setCollabLaunchSelectionKey(""), openCollaborateModal(collabLaunchSelectedItem.resourceType, collabLaunchSelectedItem);
    }, [collabLaunchSelectedItem, openCollaborateModal]),
    t2 = (0, c.useMemo)(() => {
      let e = 0,
        a = 0,
        l = 0,
        t = 0,
        s = 0;
      for (let i of t0) {
        if (i.revoked || (s += 1), "FOLDER" === i.shareType) {
          l += 1;
          continue;
        }
        t += 1, "image" === i.shareMediaKind && (e += 1), "video" === i.shareMediaKind && (a += 1);
      }
      return {
        total: t0.length,
        photos: e,
        videos: a,
        folders: l,
        files: t,
        activeLinks: s
      };
    }, [t0]),
    t4 = (0, c.useMemo)(() => "folders" === aO ? "No shared folders yet." : "files" === aO ? "No shared files yet." : "gallery" === aO ? "No shared photos or videos yet." : "visited_links" === aO ? "No visited shared links yet." : "shared" === aO ? "No active shared links yet." : "No shared items yet.", [aO]),
    t5 = (0, c.useMemo)(() => "folders" === aA ? "No starred folders yet." : "files" === aA ? "No starred files yet." : "gallery" === aA ? "No starred gallery items yet." : "No starred items yet.", [aA]),
    collabVisibleItems = (0, c.useMemo)(() => {
      let e = eM.trim().toLowerCase();
      if (!e) return collabInboxItems;
      return collabInboxItems.filter(a => {
        let l = String(a?.name || "").toLowerCase(),
          t = String(a?.path || "").toLowerCase(),
          s = String(a?.sharedBy?.username || "").toLowerCase(),
          i = String(a?.sharedBy?.displayName || "").toLowerCase();
        return l.includes(e) || t.includes(e) || s.includes(e) || i.includes(e);
      });
    }, [collabInboxItems, eM]),
    collabLayoutClass = (0, c.useMemo)(() => "grid_large" === collabInboxLayout ? "is-grid-large" : "list" === collabInboxLayout ? "is-list" : "list_large" === collabInboxLayout ? "is-list-large" : "is-grid", [collabInboxLayout]),
    collabEmptyMessage = (0, c.useMemo)(() => "readonly" === collabInboxFilter ? "No read-only items shared with you." : "edit" === collabInboxFilter ? "No editable collaborations yet." : "expiringSoon" === collabInboxFilter ? "No items expiring soon." : "No collaboration items shared with you.", [collabInboxFilter]),
    t3 = (0, c.useMemo)(() => (en?.storageHistory || []).slice(-16), [en?.storageHistory]),
    t8 = (0, c.useMemo)(() => {
      if (!t3.length) return [];
      let e = t3.map(e => Math.max(0, e.usedBytes)),
        a = Math.min(...e),
        l = Math.max(...e),
        t = l === a,
        s = Math.max(1, l - a);
      return t3.map(e => {
        let l = t ? .62 : (Math.max(0, e.usedBytes) - a) / s;
        return {
          ...e,
          heightPx: Math.max(6, 8 + Math.round(24 * l))
        };
      });
    }, [t3]),
    t6 = (0, c.useMemo)(() => {
      let e = {
        code: 0,
        image: 0,
        video: 0,
        other: 0
      };
      for (let a of en?.files || []) {
        let l = er(a);
        e[l] += 1;
      }
      return e;
    }, [en?.files]),
    t7 = (0, c.useMemo)(() => {
      let e = ["image", "video", "code", "other"],
        a = e.reduce((e, a) => e + tI[a], 0);
      return e.map(e => {
        let l = tI[e],
          t = t6[e],
          s = $[e];
        return {
          key: e,
          label: s.label,
          color: s.color,
          bytes: l,
          count: t,
          percentage: a > 0 ? l / a * 100 : 0
        };
      });
    }, [tI, t6]),
    t9 = (0, c.useMemo)(() => {
      let e = {
          folder: (en?.folders || []).length,
          image: t6.image,
          video: t6.video,
          code: t6.code,
          other: t6.other
        },
        a = ["folder", "image", "video", "code", "other"],
        l = a.reduce((a, l) => a + e[l], 0),
        t = 0;
      return a.map(a => {
        let s = e[a],
          i = L[a],
          r = l > 0 ? s / l * 100 : 0,
          c = {
            key: a,
            label: i.label,
            color: i.color,
            count: s,
            percentage: r,
            startPct: t
          };
        return t += r, c;
      });
    }, [t6, en?.folders]),
    se = (0, c.useMemo)(() => {
      if (!t3.length) return null;
      let e = t3.map(e => Math.max(0, e.usedBytes)),
        a = Math.min(...e),
        l = Math.max(1, Math.max(...e) - a),
        t = t3.map((e, t) => ({
          x: 14 + (t3.length <= 1 ? 0 : t / (t3.length - 1) * 532),
          y: 16 + (1 - (Math.max(0, e.usedBytes) - a) / l) * 156,
          point: e
        })),
        s = t.map((e, a) => `${0 === a ? "M" : "L"} ${e.x.toFixed(2)} ${e.y.toFixed(2)}`).join(" "),
        i = `${s} L ${t[t.length - 1]?.x.toFixed(2)} 172.00 L ${t[0]?.x.toFixed(2)} 172.00 Z`,
        r = t3[t3.length - 1],
        c = t3.length > 1 ? t3[t3.length - 2] : null,
        o = c ? r.usedBytes - c.usedBytes : 0;
      return {
        width: 560,
        height: 188,
        coords: t,
        linePath: s,
        areaPath: i,
        yTicks: [0, .25, .5, .75, 1].map(e => ({
          y: 16 + (1 - e) * 156,
          label: P(Math.max(0, a + l * e))
        })),
        latest: r,
        deltaBytes: o
      };
    }, [t3]),
    sa = (0, c.useMemo)(() => {
      let e = (en?.files || []).length,
        a = (en?.folders || []).length;
      return `${e} file${1 === e ? "" : "s"} • ${a} folder${1 === a ? "" : "s"} mapped`;
    }, [en?.files, en?.folders]),
    sl = t3.length ? t3[t3.length - 1] : null,
    st = (0, c.useMemo)(() => {
      let e = en?.breadcrumbs || [];
      return e.filter(e => {
        let a = String(e?.name || "").trim().toLowerCase(),
          l = T(String(e?.path || "/"));
        return "/" !== l && "root" !== a && "cavcloud" !== a;
      });
    }, [en?.breadcrumbs]),
    ss = (0, c.useMemo)(() => {
      let e = en?.breadcrumbs || [];
      if (e.length < 2) return null;
      let a = e[e.length - 2];
      return a?.path ? T(a.path) : null;
    }, [en?.breadcrumbs]),
    si = (0, c.useMemo)(() => Object.values(ay), [ay]),
    sr = si.length,
    sc = (0, c.useMemo)(() => t1.map(e => K(e.kind, e.id)), [t1]),
    so = (0, c.useMemo)(() => {
      let e = 0;
      for (let a of sc) ay[a] && (e += 1);
      return e;
    }, [ay, sc]),
    sd = t1.length > 0 && so === t1.length,
    sn = (0, c.useMemo)(() => {
      let e = new Set();
      for (let a of tR) e.add(`${a.targetType}:${T(a.path)}`);
      return e;
    }, [tR]),
    su = (0, c.useMemo)(() => !!si.length && si.every(e => sn.has(`${e.kind}:${T(e.path)}`)), [si, sn]),
    sh = (0, c.useMemo)(() => si.reduce((e, a) => e + ("file" === a.kind ? 1 : 0), 0), [si]),
    sm = (0, c.useMemo)(() => {
      if (1 !== sh) return null;
      let e = si.find(e => "file" === e.kind);
      return e && tE.get(e.id) || null;
    }, [tE, si, sh]),
    sv = (0, c.useMemo)(() => {
      let e = String(ac || "").trim();
      return e ? tE.get(e) || null : sm;
    }, [tE, sm, ac]),
    sp = (0, c.useMemo)(() => "Shared" !== S ? [] : t0.filter(e => !!ay[K("file", e.item.id)]), [S, ay, t0]),
    sf = (0, c.useMemo)(() => sp.filter(e => !e.revoked), [sp]),
    sg = (0, c.useMemo)(() => sp.filter(e => "FOLDER" !== e.shareType && !!e.item.artifact?.id), [sp]),
    sStarSel = (0, c.useMemo)(() => "Starred" !== S ? [] : tz.filter(e => !!ay[K(e.targetType, e.targetId || `path:${T(e.path)}`)]), [S, tz, ay]),
    sTrashSel = (0, c.useMemo)(() => "Trash" !== S || "restorations" === a1 ? [] : th.filter(e => !!ay[K(e.kind, e.id)]), [S, a1, th, ay]),
    sx = (0, c.useMemo)(() => si.filter(e => "folder" === e.kind).map(e => T(e.path)), [si]),
    mountQuickOptions = (0, c.useMemo)(() => "file" === mountQuickKind ? quickMountFileOptions : quickMountFolderOptions, [mountQuickKind, quickMountFileOptions, quickMountFolderOptions]),
    mountQuickTarget = (0, c.useMemo)(() => {
      let e = mountQuickOptions.find(e => e.id === mountQuickTargetId);
      return e || (mountQuickOptions.length ? mountQuickOptions[0] : null);
    }, [mountQuickOptions, mountQuickTargetId]),
    sy = (0, c.useMemo)(() => sx.length ? lM.filter(e => {
      let a = T(e.path);
      for (let e of sx) if (a === e || a.startsWith(`${e}/`)) return !1;
      return !0;
    }) : lM, [lM, sx]),
    sb = (0, c.useCallback)(() => {
      ab({}), ax(!1);
    }, []),
    sN = (0, c.useCallback)((e, a) => {
      let l = K(e.kind, e.id),
        t = !!(a?.metaKey || a?.ctrlKey);
      ax(!0), ab(a => selectDesktopItemMap(a, l, e, t));
    }, []),
    sDesktopSelectionClearEffect = (0, c.useEffect)(() => {
      if (!si.length) return;
      let e = e => {
        shouldClearDesktopSelectionFromTarget(e.target, {
          preserveSelectors: ['[data-desktop-select-preserve="true"]', ".cavcloud-trashMenuWrap", ".cavcloud-trashActionMenu", ".cavcloud-galleryMoreBtn"]
        }) && sb();
      };
      return window.addEventListener("mousedown", e, !0), () => {
        window.removeEventListener("mousedown", e, !0);
      };
    }, [si.length, sb]),
    sC = (0, c.useCallback)(() => {
      ag && t1.length && ab(e => {
        let a = {
          ...e
        };
        if (sd) for (let e of t1) delete a[K(e.kind, e.id)];else for (let e of t1) a[K(e.kind, e.id)] = e;
        return a;
      });
    }, [sd, ag, t1]),
    sk = (0, c.useCallback)(async () => {
      let e = lq.current;
      if (e && Date.now() - e.ts < 45e3 && e.options.length) return e.options;
      let a = new Map(),
        l = ["/"],
        t = new Set(),
        s = 0;
      for (; l.length > 0 && s < 180;) {
        let e = T(l.shift() || "/");
        if (t.has(e)) continue;
        t.add(e), s += 1;
        let i = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(e)}`, {
            method: "GET",
            cache: "no-store"
          }),
          r = await ev(i);
        if (!i.ok || !r?.ok || !r.folder) continue;
        let c = r.folder;
        for (let e of (a.set(c.id, {
          id: c.id,
          name: c.name,
          path: T(c.path)
        }), Array.isArray(r.folders) ? r.folders : [])) {
          let s = T(e.path);
          a.set(e.id, {
            id: e.id,
            name: e.name,
            path: s
          }), t.has(s) || l.push(s);
        }
      }
      let i = Array.from(a.values()).sort((e, a) => e.path === a.path ? e.name.localeCompare(a.name) : "/" === e.path ? -1 : "/" === a.path ? 1 : e.path.localeCompare(a.path));
      return lq.current = {
        ts: Date.now(),
        options: i
      }, i;
    }, []),
    sw = (0, c.useCallback)(async () => {
      if (sr) {
        lS("move"), lT(""), lL(!0);
        try {
          let e = await sk();
          lI(e);
          let a = e.find(e => {
            let a = T(e.path);
            for (let e of sx) if (a === e || a.startsWith(`${e}/`)) return !1;
            return !0;
          });
          lF(a?.id || ""), e.length || lT("No destination folders are available yet.");
        } catch {
          lI([]), lF(""), lT("Failed to load folders.");
        } finally {
          lL(!1);
        }
      }
    }, [sk, sr, sx]),
    sMoveToCavSafe = (0, c.useCallback)(async e => {
      let a = Array.isArray(e) ? e.filter(e => e && e.id && ("file" === e.kind || "folder" === e.kind)) : si;
      if (!a.length) return;
      if ("FREE" === String(eK || "").trim().toUpperCase()) {
        openCavGuardByAction("MOVE_TO_CAVSAFE_PLAN_REQUIRED", {
          plan: "FREE"
        });
        return;
      }
      if (!isOwner) {
        openCavGuardByAction("CAVSAFE_OWNER_ONLY");
        return;
      }
      eS(!0);
      let l = 0,
        t = 0;
      try {
        for (let e of a) {
          let a = await fetch("/api/cavsafe/move-from-cavcloud", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                kind: e.kind,
                id: e.id
              })
            }),
            s = await ev(a);
          a.ok && s?.ok ? l += 1 : t += 1;
        }
        l > 0 && l3("good", `Moved ${l} item${1 === l ? "" : "s"} to CavSafe.`), t > 0 && l3("bad", `${t} item${1 === t ? "" : "s"} could not be moved to CavSafe.`), l > 0 && (await refreshTreePostMutation("mutation"), sb(), lS(null), lF(""));
      } finally {
        eS(!1);
      }
    }, [eK, isOwner, openCavGuardByAction, sb, l3, ta, si]),
    sSyncMove = (0, c.useCallback)(async e => {
      if (!e?.id) return;
      let a = {
          id: e.id,
          kind: "file",
          name: e.name,
          path: e.path
        },
        l = K("file", e.id);
      ab({
        [l]: a
      }), ax(!0), lS("move"), lT(""), lL(!0);
      try {
        let e = await sk();
        lI(e);
        let t = eh(T(a.path)),
          s = e.find(e => T(e.path) !== t);
        lF(s?.id || ""), e.length || lT("No destination folders are available yet.");
      } catch {
        lI([]), lF(""), lT("Failed to load folders.");
      } finally {
        lL(!1);
      }
    }, [sk]),
    sS = (0, c.useCallback)(() => {
      ew || (lS(null), lT(""));
    }, [ew]),
    sM = (0, c.useCallback)(async () => {
      if (!lO || !si.length) return;
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of si) {
          if ("folder" === l.kind) {
            let t = await fetch(`/api/cavcloud/folders/${encodeURIComponent(l.id)}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  parentId: lO
                })
              }),
              s = await ev(t);
            t.ok && s?.ok ? e += 1 : a += 1;
            continue;
          }
          let t = await fetch(`/api/cavcloud/files/${encodeURIComponent(l.id)}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                folderId: lO
              })
            }),
            s = await ev(t);
          t.ok && s?.ok ? e += 1 : a += 1;
        }
        e > 0 && l3("good", `Moved ${e} item${1 === e ? "" : "s"}.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be moved.`), await refreshTreePostMutation("mutation"), sb(), lS(null), lF("");
      } finally {
        eS(!1);
      }
    }, [sb, lO, l3, ta, si]),
    sI = (0, c.useCallback)(async () => {
      if (!si.length) return;
      if (cavcloudSettings.confirmTrashDelete) {
        let eCount = si.length;
        if (!window.confirm(`Move ${eCount} item${1 === eCount ? "" : "s"} to Recently deleted?`)) return;
      }
      let l = [...si];
      lS(null), setDriveMutationState("delete.to_trash", "started"), logDriveDebug("delete.start", {
        itemCount: l.length
      }), markDeletingVisual(l), eS(!0);
      let e = 0,
        a = 0;
      try {
        await new Promise(e => window.setTimeout(e, CAVCLOUD_DELETE_VISUAL_MS));
        optimisticallyMoveItemsToTrash(l);
        await runWithConcurrency(l, 6, async l => {
          if ("folder" === l.kind) {
            let t = await fetch(`/api/cavcloud/folders/${encodeURIComponent(l.id)}`, {
                method: "DELETE"
              }),
              s = await ev(t);
            t.ok && s?.ok ? e += 1 : a += 1;
            return;
          }
          let t = await fetch(`/api/cavcloud/files/${encodeURIComponent(l.id)}`, {
              method: "DELETE"
            }),
            s = await ev(t);
          t.ok && s?.ok ? e += 1 : a += 1;
        }), e > 0 && l3("good", `Moved ${e} item${1 === e ? "" : "s"} to recently deleted.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be deleted.`), await refreshTreePostMutation("delete.to_trash"), setDriveMutationState("delete.to_trash", a > 0 ? "partial" : "success"), logDriveDebug("delete.finish", {
          deletedCount: e,
          failedCount: a
        }), sb();
      } catch (eErr) {
        l3("bad", eErr instanceof Error ? eErr.message : "Failed to delete selected items."), setDriveMutationState("delete.to_trash", "failed"), logDriveDebug("delete.finish", {
          status: "failed",
          message: eErr instanceof Error ? eErr.message : "Failed to delete selected items."
        }), await refreshTreePostMutation("delete.to_trash");
      } finally {
        clearDeletingVisual(l), eS(!1);
      }
    }, [sb, l3, refreshTreePostMutation, si, markDeletingVisual, clearDeletingVisual, optimisticallyMoveItemsToTrash, setDriveMutationState, logDriveDebug, cavcloudSettings.confirmTrashDelete]),
    s$ = (0, c.useCallback)(async () => {
      if (!si.length) return;
      let e = su ? "unstar" : "star";
      eS(!0);
      let a = 0,
        l = 0;
      try {
        for (let t of si) (await l6({
          action: `${t.kind}.${e}`,
          targetType: t.kind,
          targetId: t.id,
          targetPath: T(t.path)
        })) ? a += 1 : l += 1;
        a > 0 && l3("good", `${"star" === e ? "Starred" : "Unstarred"} ${a} item${1 === a ? "" : "s"}.`), l > 0 && l3("bad", `${l} item${1 === l ? "" : "s"} could not be updated.`), await refreshTreePostMutation("mutation"), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l3, ta, su, si, l6]),
    sL = (0, c.useCallback)(async () => {
      if (!si.length) return;
      let e = 0,
        a = 0,
        l = 0;
      eS(!0);
      try {
        for (let t of si) {
          if ("file" === t.kind) {
            let s = String(tE.get(t.id)?.id || t.id || "").trim();
            s ? (ep(`/api/cavcloud/files/${encodeURIComponent(s)}?raw=1&download=1`), e += 1) : a += 1;
            continue;
          }
          if ("folder" === t.kind) {
            let s = await fetch(`/api/cavcloud/folders/${encodeURIComponent(t.id)}/zip`, {
                method: "POST"
              }),
              i = await ev(s),
              r = String(i?.file?.id || "").trim();
            if (!s.ok || !i?.ok || !r) {
              a += 1;
              continue;
            }
            ep(`/api/cavcloud/files/${encodeURIComponent(r)}?raw=1&download=1`), e += 1, l += 1;
            continue;
          }
          a += 1;
        }
        e > 0 ? l3("good", `Started ${e} download${1 === e ? "" : "s"}.`) : l3("bad", "No downloadable files or folders in this selection."), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be prepared for download.`), l > 0 && await refreshTreePostMutation("mutation");
      } catch (eErr) {
        l3("bad", eErr instanceof Error ? eErr.message : "Failed to start downloads.");
      } finally {
        eS(!1);
      }
    }, [tE, l3, si, refreshTreePostMutation]),
    sA = (0, c.useCallback)(async () => {
      if (!sp.length) return;
      let e = sp.map(e => String(e.item.shareUrl || "").trim()).filter(Boolean).join("\n");
      if (!e) {
        l3("watch", "No share links available to copy.");
        return;
      }
      try {
        if (!(await (0, h.T)(e))) {
          openCopyLinkModal(1 === sp.length ? "Copy share link" : "Copy share links", e);
          return;
        }
        l3("good", 1 === sp.length ? "Share link copied." : `Copied ${sp.length} share links.`);
      } catch {
        openCopyLinkModal(1 === sp.length ? "Copy share link" : "Copy share links", e);
      }
    }, [l3, openCopyLinkModal, sp]),
    sT = (0, c.useCallback)(() => {
      if (!sg.length) return;
      let e = 0;
      for (let a of sg) {
        let l = String(a.item.artifact?.id || "").trim();
        l && (ep(`/api/cavcloud/artifacts/${encodeURIComponent(l)}/preview?raw=1&download=1`), e += 1);
      }
      if (e > 0) {
        l3("good", `Started ${e} shared download${1 === e ? "" : "s"}.`);
        return;
      }
      l3("bad", "No downloadable shared files in this selection.");
    }, [l3, sg]),
    sO = (0, c.useCallback)(async e => {
      if (!sf.length) return;
      eS(!0);
      let a = 0,
        l = 0;
      try {
        for (let e of sf) {
          let t = e.item.id,
            s = await fetch(`/api/cavcloud/shares/${encodeURIComponent(t)}/revoke`, {
              method: "POST"
            }),
            i = await ev(s);
          s.ok && i?.ok ? a += 1 : l += 1;
        }
        a > 0 && l3("good", "delete" === e ? `Deleted ${a} shared item${1 === a ? "" : "s"}.` : `Unshared ${a} item${1 === a ? "" : "s"}.`), l > 0 && l3("bad", `${l} shared item${1 === l ? "" : "s"} could not be updated.`), await Promise.all([l9(), ta()]), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l9, l3, ta, sf]),
    collabOpenItem = (0, c.useCallback)(e => {
      let a = String(e?.openHref || "").trim();
      if (!a) {
        l3("watch", "Open path unavailable for this shared item.");
        return;
      }
      l.push(a);
    }, [l, l3]),
    collabSaveShortcut = (0, c.useCallback)(async e => {
      if (!e || e.shortcutSaved) return;
      let a = `save:${String(e.grantId || "").trim()}`;
      setCollabInboxActionKey(a);
      try {
        let l = e?.saveShortcutBody && "object" == typeof e.saveShortcutBody ? e.saveShortcutBody : null;
        if (!l || !String(l.targetId || "").trim()) throw Error("Shortcut payload is missing.");
        let t = await fetch("/api/cavcloud/collab/shortcuts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(l)
          }),
          s = await ev(t);
        if (!t.ok || !s?.ok) throw Error(String(s?.message || "Failed to save shortcut."));
        l3("good", "Saved to CavCloud."), await Promise.all([loadCollabInbox({
          silent: !0
        }), ta({
          silent: !0
        })]);
      } catch (aErr) {
        l3("bad", aErr instanceof Error ? aErr.message : "Failed to save shortcut.");
      } finally {
        setCollabInboxActionKey(e => e === a ? "" : e);
      }
    }, [loadCollabInbox, l3, ta]),
    collabRemoveFromList = (0, c.useCallback)(async e => {
      if (!e) return;
      let a = `remove:${String(e.grantId || "").trim()}`;
      setCollabInboxActionKey(a);
      try {
        if (e.shortcutSaved) {
          let a = e?.removeShortcutBody && "object" == typeof e.removeShortcutBody ? e.removeShortcutBody : null;
          if (a && String(a.targetId || "").trim()) try {
            let e = await fetch("/api/cavcloud/collab/shortcuts", {
                method: "DELETE",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(a)
              }),
              l = await ev(e);
            e.ok && l?.ok || l3("watch", String(l?.message || "Could not remove saved shortcut. Continuing..."));
          } catch {
            l3("watch", "Could not remove saved shortcut. Continuing...");
          }
        }
        let l = String(e?.declineHref || "").trim();
        if (!l) throw Error("Decline endpoint unavailable for this collaboration.");
        let t = await fetch(l, {
            method: "POST"
          }),
          s = await ev(t);
        if (!t.ok || !s?.ok) throw Error(String(s?.message || "Failed to remove collaboration access."));
        l3("good", "Removed from Collaboration."), await Promise.all([loadCollabInbox({
          silent: !0
        }), ta({
          silent: !0
        })]);
      } catch (aErr) {
        l3("bad", aErr instanceof Error ? aErr.message : "Failed to remove from Collaboration.");
      } finally {
        setCollabInboxActionKey(e => e === a ? "" : e);
      }
    }, [loadCollabInbox, l3, ta]),
    sStarOpen = (0, c.useCallback)(async () => {
      let e = sStarSel[0];
      if (!e) return;
      if (tV(tJ(e))) return;
      let a = T(e.path),
        l = "folder" === e.targetType ? a : eh(a);
      l2("Explore"), await l7(l);
    }, [sStarSel, tJ, tV, l2, l7]),
    sStarRemove = (0, c.useCallback)(async () => {
      if (!sStarSel.length) return;
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of sStarSel) (await l6({
          action: `${l.targetType}.unstar`,
          targetType: l.targetType,
          targetId: l.targetId,
          targetPath: T(l.path)
        })) ? e += 1 : a += 1;
        e > 0 && l3("good", `Removed ${e} item${1 === e ? "" : "s"} from Starred.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be updated.`), await refreshTreePostMutation("mutation"), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l3, ta, sStarSel, l6]),
    sTrashOpen = (0, c.useCallback)(async () => {
      let e = sTrashSel[0];
      if (!e) return;
      l2("Explore"), await l7(eh(T(e.path)));
    }, [sTrashSel, l2, l7]),
    sTrashRestore = (0, c.useCallback)(async () => {
      if (!sTrashSel.length) return;
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of sTrashSel) {
          let t = await fetch("/api/cavcloud/trash/restore", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                trashId: l.id
              })
            }),
            s = await ev(t);
          t.ok && s?.ok ? e += 1 : a += 1;
        }
        e > 0 && l3("good", `Restored ${e} item${1 === e ? "" : "s"}.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be restored.`), await refreshTreePostMutation("mutation"), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l3, ta, sTrashSel]),
    sTrashRemove = (0, c.useCallback)(async () => {
      if (!sTrashSel.length) return;
      if (cavcloudSettings.confirmPermanentDelete && !window.confirm(`Permanently delete ${sTrashSel.length} item${1 === sTrashSel.length ? "" : "s"}? This cannot be undone.`)) return;
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of sTrashSel) {
          let t = await fetch(`/api/cavcloud/trash/${encodeURIComponent(l.id)}?permanent=1`, {
              method: "DELETE"
            }),
            s = await ev(t);
          t.ok && s?.ok ? e += 1 : a += 1;
        }
        e > 0 && l3("good", `Removed ${e} item${1 === e ? "" : "s"} from CavCloud.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be removed.`), await refreshTreePostMutation("mutation"), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l3, sTrashSel, cavcloudSettings.confirmPermanentDelete, refreshTreePostMutation]),
    sF = (0, c.useCallback)(e => {
      let a = e || sm;
      if (!a) {
        l3("watch", "Select one file to share.");
        return;
      }
      openCollaborateModal("FILE", a);
    }, [l3, sm, openCollaborateModal]),
    sR = (0, c.useCallback)(async e => {
      let a = e?.file || sv;
      if (!a) return "";
      let l = String(ai || "").trim();
      if (l && (!e?.file || sv?.id === a.id)) return l;
      al(!0);
      try {
        let e = await fetch("/api/cavcloud/shares/link", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              fileId: a.id,
              expiresInDays: cavcloudSettings.shareDefaultExpiryDays,
              accessPolicy: cavcloudSettings.shareAccessPolicy
            })
          }),
          t = await ev(e),
          s = String(t?.shareUrl || "").trim();
        if (!e.ok || !t?.ok || !s) throw Error(String(t?.message || "Failed to create share link."));
        return ar(s), s;
      } catch (a) {
        return e?.silent || l3("bad", a instanceof Error ? a.message : "Failed to create share link."), "";
      } finally {
        al(!1);
      }
    }, [sv, l3, ai, cavcloudSettings.shareDefaultExpiryDays, cavcloudSettings.shareAccessPolicy]),
    sU = (0, c.useCallback)(async () => {
      if (!sv) {
        l3("watch", "Select one file to copy a link.");
        return;
      }
      l4();
      let e = String(ai || "").trim() || (await sR({
        silent: !1
      }));
      if (e) try {
        if (!(await (0, h.T)(e))) {
          openCopyLinkModal("Copy link", e);
          return;
        }
        l5(), l3("good", "Link copied.");
      } catch (a) {
        openCopyLinkModal("Copy link", e);
        l3("bad", a instanceof Error ? a.message : "Failed to copy share link.");
      }
    }, [sv, l4, sR, l5, l3, ai, openCopyLinkModal]),
    sE = (0, c.useCallback)(e => {
      lx(e), lb(e.name);
    }, []),
    sD = (0, c.useCallback)(async () => {
      if (1 !== si.length) return;
      let e = si[0];
      e && sE(e);
    }, [sE, si]),
    openFolderSmooth = (0, c.useCallback)(async e => {
      let a = T(e),
        l = T(z),
        t = Date.now(),
        s = folderNavLockRef.current;
      if (a === l) return;
      if (a === s.path && t - s.ts < 220) return;
      folderNavLockRef.current = {
        path: a,
        ts: t
      }, cancelPendingFolderSelect(), "Explore" !== S && l2("Explore");
      let i = null;
      try {
        let e = A(globalThis.__cbSessionStore.getItem(treeNavCacheKey));
        if (Array.isArray(e)) {
          let l = e.find(e => T(String(e?.path || "/")) === a),
            t = R(l?.payload),
            s = R(t?.folder);
          t && s && (i = {
            folder: {
              ...s,
              path: a
            },
            breadcrumbs: Array.isArray(t.breadcrumbs) ? t.breadcrumbs : [],
            folders: Array.isArray(t.folders) ? t.folders : [],
            files: Array.isArray(t.files) ? t.files : [],
            trash: Array.isArray(t.trash) ? t.trash : Array.isArray(en?.trash) ? en.trash : [],
            usage: R(t.usage) || R(en?.usage),
            activity: Array.isArray(t.activity) && t.activity.length ? W(t.activity) : W(en?.activity),
            storageHistory: Array.isArray(t.storageHistory) && t.storageHistory.length ? H(t.storageHistory) : H(en?.storageHistory)
          });
        }
      } catch {}
      i && (treeHasLoadedRef.current = !0, eL(""), q(a), ey(i));
      await l7(a, i ? {
        silent: !0,
        retries: 2,
        retryDelayMs: 120
      } : void 0);
    }, [cancelPendingFolderSelect, S, z, l2, l7, treeNavCacheKey, en?.trash, en?.usage, en?.activity, en?.storageHistory]),
    s_ = (0, c.useCallback)(async e => {
      await openFolderSmooth(e);
    }, [openFolderSmooth]),
    sW = (0, c.useCallback)(async (e, a = "folder") => {
      let l = T(e),
        t = "folder" === a ? l : eh(l);
      await openFolderSmooth(t);
    }, [openFolderSmooth]),
    sG = (0, c.useCallback)(async e => {
      let a = String(e || "").trim();
      if (!a) return l3("watch", "Folder name is required."), !1;
      eS(!0);
      try {
        let e = await fetch("/api/cavcloud/folders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: a,
              parentPath: z
            })
          }),
          l = await ev(e);
        if (!e.ok || !l?.ok) throw Error(String(l?.message || "Failed to create folder."));
        return l3("good", "Folder created."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create folder."), !1;
      } finally {
        eS(!1);
      }
    }, [z, l3, ta]),
    sK = (0, c.useCallback)(async e => {
      let a = String(e || "").trim();
      if (!a) return l3("watch", "Document name is required."), !1;
      let l = es(a) || "text/plain; charset=utf-8";
      eS(!0);
      try {
        let e = await fetch("/api/cavcloud/sync/upsert", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              folderPath: z,
              name: a,
              mimeType: l,
              content: "",
              source: "cavcloud.create_file"
            })
          }),
          t = await ev(e);
        if (!e.ok || !t?.ok) throw Error(String(t?.message || "Failed to create file."));
        return l3("good", "File created."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create file."), !1;
      } finally {
        eS(!1);
      }
    }, [z, l3, ta]),
    sJ = (0, c.useCallback)(async (e, a) => {
      if (!a) return !1;
      if ("file" === e.kind) {
        let l = await fetch(`/api/cavcloud/files/${encodeURIComponent(e.id)}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              folderId: a
            })
          }),
          t = await ev(l);
        if (!l.ok || !t?.ok) throw Error(String(t?.message || "Failed to move file."));
        return !0;
      }
      let l = await fetch(`/api/cavcloud/folders/${encodeURIComponent(e.id)}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            parentId: a
          })
        }),
        t = await ev(l);
      if (!l.ok || !t?.ok) throw Error(String(t?.message || "Failed to move folder."));
      return !0;
    }, []),
    sV = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch(`/api/cavcloud/files/${encodeURIComponent(e.id)}/duplicate`, {
            method: "POST"
          }),
          l = await ev(a);
        if (!a.ok || !l?.ok) throw Error(String(l?.message || "Failed to duplicate file."));
        l3("good", "File duplicated."), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to duplicate file.");
      } finally {
        eS(!1);
      }
    }, [l3, ta]),
    sZ = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch(`/api/cavcloud/files/${encodeURIComponent(e.id)}/zip`, {
            method: "POST"
          }),
          l = await ev(a);
        if (!a.ok || !l?.ok) throw Error(String(l?.message || "Failed to create zip."));
        l3("good", "Zip created."), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to zip file.");
      } finally {
        eS(!1);
      }
    }, [l3, ta]),
    sz = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch(`/api/cavcloud/folders/${encodeURIComponent(e.id)}/zip`, {
            method: "POST"
          }),
          l = await ev(a);
        if (!a.ok || !l?.ok) throw Error(String(l?.message || "Failed to create folder zip."));
        l3("good", "Folder zip created."), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to zip folder.");
      } finally {
        eS(!1);
      }
    }, [l3, ta]),
    sq = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch("/api/cavcloud/share", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              kind: e.kind,
              id: e.id,
              expiresInDays: cavcloudSettings.shareDefaultExpiryDays,
              accessPolicy: cavcloudSettings.shareAccessPolicy
            })
          }),
          l = await ev(a),
          t = String(l?.shareUrl || "").trim();
        if (!a.ok || !l?.ok || !t) throw Error(String(l?.message || "Failed to create share link."));
        let s = await (0, h.T)(t);
        s ? l3("good", "Share link copied.") : openCopyLinkModal("Copy share link", t), await l9(), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to create share link.");
      } finally {
        eS(!1);
      }
    }, [l9, l3, openCopyLinkModal, cavcloudSettings.shareDefaultExpiryDays, cavcloudSettings.shareAccessPolicy, refreshTreePostMutation]),
    sShareSelected = (0, c.useCallback)(async () => {
      if (1 !== sr) {
        l3("watch", "Select one file or folder to share.");
        return;
      }
      let e = si[0];
      if (!e) {
        l3("watch", "Select one file or folder to share.");
        return;
      }
      if ("folder" === e.kind) {
        openCollaborateModal("FOLDER", e);
        return;
      }
      let a = tE.get(e.id);
      if (a) {
        sF(a);
        return;
      }
      openCollaborateModal("FILE", e);
    }, [sr, si, l3, tE, sF, openCollaborateModal]),
    sY = (0, c.useCallback)(async () => {
      if (!l_) return;
      let e = String(lH || l_.name || "").trim().slice(0, 140),
        a = "folder" === String(l_?.kind || "").toLowerCase(),
        l = a ? {
          folderId: l_.id,
          title: e,
          visibility: lK,
          expiresInDays: normalizePublishExpiryDays(publishExpiryDays, cavcloudSettings.publishDefaultExpiryDays)
        } : {
          fileId: l_.id,
          title: e,
          typeLabel: V(l_.name),
          visibility: lK,
          expiresInDays: normalizePublishExpiryDays(publishExpiryDays, cavcloudSettings.publishDefaultExpiryDays)
        };
      eS(!0);
      try {
        let e = await fetch("/api/artifacts/publish", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify(l)
          }),
          t = await ev(e);
        if (!e.ok || !t?.ok) throw Error(String(t?.message || "Failed to publish item."));
        emitPublicArtifactsSyncFromWorkspace(), l3("good", "Published to Public Artifacts."), lW(null), lG(""), lJ(cavcloudSettings.publishDefaultVisibility), setPublishExpiryDays(normalizePublishExpiryDays(cavcloudSettings.publishDefaultExpiryDays, 0)), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to publish item.");
      } finally {
        eS(!1);
      }
    }, [l_, lH, lK, l3, publishExpiryDays, cavcloudSettings.publishDefaultVisibility, cavcloudSettings.publishDefaultExpiryDays, refreshTreePostMutation]),
    sQ = (0, c.useCallback)(async () => {
      if (!lg) return;
      let e = String(ly || "").trim();
      if (!e) {
        l3("watch", "Name is required.");
        return;
      }
      if (e === lg.name) {
        lx(null), lb("");
        return;
      }
      eS(!0);
      try {
        let a = "folder" === lg.kind ? `/api/cavcloud/folders/${encodeURIComponent(lg.id)}` : `/api/cavcloud/files/${encodeURIComponent(lg.id)}`,
          l = await fetch(a, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: e
            })
          }),
          t = await ev(l);
        if (!l.ok || !t?.ok) throw Error(String(t?.message || `Failed to rename ${lg.kind}.`));
        l3("good", `${"folder" === lg.kind ? "Folder" : "File"} renamed.`), await refreshTreePostMutation("mutation"), ag && sb(), lx(null), lb("");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to rename item.");
      } finally {
        eS(!1);
      }
    }, [sb, l3, ta, lg, ly, ag]),
    sX = (0, c.useCallback)(e => {
      if ("FREE" === String(eK || "").trim().toUpperCase()) {
        openCavGuardByAction("MOVE_TO_CAVSAFE_PLAN_REQUIRED", {
          plan: "FREE"
        });
        return;
      }
      lN(e);
    }, [eK, openCavGuardByAction]),
    s0 = (0, c.useCallback)(async () => {
      if (!lj) return;
      let a = lj;
      lN(null), await sMoveToCavSafe([{
        id: a.id,
        kind: "file",
        name: a.name,
        path: a.path
      }]);
    }, [lj, sMoveToCavSafe]),
    s1 = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch("/api/cavcloud/trash/restore", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              trashId: e.id
            })
          }),
          l = await ev(a);
        if (!a.ok || !l?.ok) throw Error(String(l?.message || "Failed to restore item."));
        l3("good", "Restored from recently deleted."), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to restore item.");
      } finally {
        eS(!1);
      }
    }, [l3, ta]),
    s2 = (0, c.useCallback)(e => {
      lk(e);
    }, []),
    s4 = (0, c.useCallback)(async () => {
      if (!lC) return;
      if (cavcloudSettings.confirmPermanentDelete && !window.confirm("Permanently delete this item? This cannot be undone.")) return;
      let a = lC;
      lk(null), eS(!0);
      try {
        let l = await fetch(`/api/cavcloud/trash/${encodeURIComponent(a.id)}?permanent=1`, {
            method: "DELETE"
          }),
          t = await ev(l);
        if (!l.ok || !t?.ok) throw Error(String(t?.message || "Failed to permanently delete item."));
        l3("watch", "Permanently deleted."), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to permanently delete item.");
      } finally {
        eS(!1);
      }
    }, [l3, lC, cavcloudSettings.confirmPermanentDelete, refreshTreePostMutation]),
    s5 = (0, c.useCallback)(async (e, a = !1) => {
      let lStatus = String(e?.status || "READY").trim().toUpperCase();
      if ("READY" !== lStatus) {
        l3("watch", "FAILED" === lStatus ? "Upload failed. Use Uploads to retry." : "File is still uploading.");
        return;
      }
      if (a) {
        ep(`/api/cavcloud/files/${encodeURIComponent(e.id)}?raw=1&download=1`);
        return;
      }
      let lPreview = tW(e);
      if (lPreview) {
        tV(lPreview);
        return;
      }
      if (cavcloudSettings.preferDownloadUnknownBinary) {
        ep(`/api/cavcloud/files/${encodeURIComponent(e.id)}?raw=1&download=1`);
        l3("watch", "Preview unavailable. Downloading file.");
        return;
      }
      l3("watch", "Preview unavailable for this file type.");
    }, [tW, tV, l3, cavcloudSettings.preferDownloadUnknownBinary]),
    s3 = (0, c.useCallback)(e => {
      if ("READY" !== String(e?.status || "READY").trim().toUpperCase()) return !1;
      return tV(tW(e));
    }, [tW, tV]),
    s8 = (0, c.useCallback)(e => tV(tG(e)), [tG, tV]),
    s6 = (0, c.useCallback)(e => (tl(String(e.item.id || "")), tV(tK(e))), [tK, tl, tV]),
    s7 = (0, c.useCallback)(e => tV(tJ(e)), [tJ, tV]),
    s9 = (0, c.useCallback)(e => {
      if ("file" != ("folder" === String(e.targetType || "").toLowerCase() ? "folder" : "file")) return !1;
      let a = T(String(e.targetPath || "/")),
        l = tD.get(a);
      return l ? tV(tW(l)) : tV(tH({
        path: a,
        name: Z(a),
        modifiedAtISO: e.createdAtISO,
        createdAtISO: e.createdAtISO
      }));
    }, [tH, tW, tD, tV]),
    openDashboardFileById = (0, c.useCallback)(async (fileId, fallbackPath = "") => {
      let id = String(fileId || "").trim(),
        safePath = T(String(fallbackPath || "/"));
      if (!id) {
        if (safePath && "/" !== safePath) {
          await sW(safePath, "file");
          tV(tH({
            path: safePath,
            name: Z(safePath),
            modifiedAtISO: new Date().toISOString(),
            createdAtISO: new Date().toISOString()
          }));
        }
        return;
      }
      try {
        let e = await fetch(`/api/cavcloud/files/${encodeURIComponent(id)}`, {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok || !a?.file) throw Error(String(a?.message || "File unavailable."));
        let l = a.file,
          tPath = T(String(l.path || safePath || "/"));
        tPath && "/" !== tPath && await sW(tPath, "file");
        let iPreview = tW(l);
        iPreview ? tV(iPreview) : tV(tH({
          path: tPath,
          name: String(l.name || Z(tPath)),
          modifiedAtISO: l.updatedAtISO || new Date().toISOString(),
          createdAtISO: l.createdAtISO || l.updatedAtISO || new Date().toISOString()
        }));
      } catch (eErr) {
        if (safePath && "/" !== safePath) {
          await sW(safePath, "file");
          tV(tH({
            path: safePath,
            name: Z(safePath),
            modifiedAtISO: new Date().toISOString(),
            createdAtISO: new Date().toISOString()
          }));
          return;
        }
        l3("watch", eErr instanceof Error ? eErr.message : "File unavailable.");
      }
    }, [sW, tV, tW, tH, l3]),
    openArtifactsSurface = (0, c.useCallback)(() => {
      let e = String(eH || "").trim();
      if (!e) {
        l3("watch", "Set a username to open Public Artifacts.");
        return;
      }
      l.push(`/${encodeURIComponent(e)}`);
    }, [eH, l, l3]),
    ie = (0, c.useCallback)(() => {
      N && tZ(N);
    }, [tZ, N]),
    ia = (0, c.useCallback)(async () => {
      if (N) try {
        let e = String(N.shareUrl || "").trim();
        if (!e) {
          let a = N.shareFileId ? tE.get(N.shareFileId) : null;
          if (!a && "by_path" === N.source) try {
            let e = await fetch(`/api/cavcloud/files/by-path?path=${encodeURIComponent(T(N.path))}`, {
                method: "GET",
                cache: "no-store"
              }),
              l = await ev(e),
              t = String(l?.file?.id || "").trim();
            t && (a = tE.get(t) || {
              id: t
            });
          } catch {}
          if (a || "file" !== N.source || (a = tE.get(N.resourceId) || null), a || "by_path" !== N.source || (a = tD.get(T(N.path)) || null), a) {
            e = await sR({
              silent: !1,
              file: a
            });
          }
        }
        if (!e) return void l3("watch", "Link unavailable for this item.");
        if (!(await (0, h.T)(e))) {
          openCopyLinkModal("Copy link", e);
          return;
        }
        l3("good", "Link copied.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to copy link.");
      }
    }, [N, tE, tD, sR, l3, openCopyLinkModal]),
    il = (0, c.useCallback)(() => {
      if (!N) return;
      let e = N.shareFileId ? tE.get(N.shareFileId) : null;
      if (e || "file" !== N.source || (e = tE.get(N.resourceId) || null), e || "by_path" !== N.source || (e = tD.get(T(N.path)) || null), !e) {
        l3("watch", "Only CavCloud files can be shared from preview.");
        return;
      }
      sF(e);
    }, [tE, tD, sF, N, l3]),
    resolveWorkspaceProjectId = (0, c.useCallback)(async () => {
      let e = await fetch("/api/workspace", {
          method: "GET",
          cache: "no-store"
        }),
        a = await ev(e),
        l = Number(a?.projectId || 0);
      if (!e.ok || !a?.ok || !Number.isInteger(l) || l <= 0) throw Error("No active CavCode workspace project was found.");
      return l;
    }, []),
    resolveMountFolderByPath = (0, c.useCallback)(async e => {
      let a = T(String(e || "/")),
        lCurrentId = String(en?.folder?.id || "").trim(),
        tCurrentPath = T(String(en?.folder?.path || "/"));
      if (lCurrentId && a === tCurrentPath) return {
        id: lCurrentId,
        path: a
      };
      for (let e of [...(Array.isArray(en?.breadcrumbs) ? en.breadcrumbs : []), ...(Array.isArray(en?.folders) ? en.folders : [])]) {
        let lId = String(e?.id || "").trim(),
          tPath = T(String(e?.path || "/"));
        if (!lId) continue;
        if (tPath === a) return {
          id: lId,
          path: tPath
        };
      }
      let l = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(a)}&lite=1`, {
          method: "GET",
          cache: "no-store"
        }),
        t = await ev(l),
        s = String(t?.folder?.id || "").trim();
      if (!l.ok || !t?.ok || !s) throw Error("Could not resolve the selected folder.");
      return {
        id: s,
        path: a
      };
    }, [en?.folder?.id, en?.folder?.path, en?.breadcrumbs, en?.folders]),
    mountFolderToCavCodeViewer = (0, c.useCallback)(async e => {
      if ("FREE" === String(eK || "").trim().toUpperCase()) {
        l3("watch", "Direct mount to CavCode Viewer is available on Premium plans."), l.push("/plan");
        return !1;
      }
      let a = T(String(e?.folderPath || "/")),
        lEntry = String(e?.entryPath || "/index.html").trim() || "/index.html",
        tEntry = lEntry.startsWith("/") ? T(lEntry) : T(`/${lEntry}`);
      if (!a || "/" !== a && !a.startsWith("/")) {
        l3("watch", "Select a valid folder to mount.");
        return !1;
      }
      setMountBusy(!0);
      try {
        let eProjectId = await resolveWorkspaceProjectId(),
          tFolder = await resolveMountFolderByPath(a),
          s = await fetch("/api/cavcode/mounts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              projectId: eProjectId,
              folderId: tFolder.id,
              mountPath: "/",
              sourceType: "CAVCLOUD",
              mode: "READ_ONLY",
              priority: 0
            })
          }),
          i = await ev(s);
        if (!s.ok || !i?.ok) throw Error(String(i?.message || "Failed to mount folder."));
        let r = `/cavcode-viewer?project=${encodeURIComponent(String(eProjectId))}&projectId=${encodeURIComponent(String(eProjectId))}&mount=1&entry=${encodeURIComponent(tEntry || "/index.html")}`;
        let n = null;
        try {
          n = window.open(r, "_blank", "noopener,noreferrer");
        } catch {}
        n || l.push(r);
        l3("good", "Mounted and opened in CavCode Viewer.");
        return !0;
      } catch (eErr) {
        return l3("bad", eErr instanceof Error ? eErr.message : "Failed to mount in CavCode Viewer."), !1;
      } finally {
        setMountBusy(!1);
      }
    }, [eK, l3, l, resolveWorkspaceProjectId, resolveMountFolderByPath]),
    runQuickMountToCavCodeViewer = (0, c.useCallback)(async () => {
      let e = mountQuickTarget;
      if (!e) {
        l3("watch", "Select a folder or file to mount.");
        return;
      }
      let a = "file" === e.kind ? eh(T(String(e.path || "/"))) : T(String(e.path || "/")),
        lEntry = "file" === e.kind ? `/${String(e.name || Z(String(e.path || "")) || "index.html")}` : "/index.html";
      await mountFolderToCavCodeViewer({
        folderPath: a,
        entryPath: lEntry
      });
    }, [mountQuickTarget, l3, mountFolderToCavCodeViewer]),
    mountPreviewToCavCodeViewer = (0, c.useCallback)(async () => {
      if (!N) {
        l3("watch", "Select a file to mount.");
        return;
      }
      let e = T(String(N.path || `/${N.name || ""}`));
      if (!e || "/" === e) {
        l3("watch", "Preview path is unavailable.");
        return;
      }
      await mountFolderToCavCodeViewer({
        folderPath: eh(e),
        entryPath: `/${String(N.name || Z(e) || "index.html")}`
      });
    }, [N, l3, mountFolderToCavCodeViewer]),
    openMountRunModal = (0, c.useCallback)(e => {
      if ("FREE" === String(eK || "").trim().toUpperCase()) {
        l3("watch", "Direct mount to CavCode Viewer is available on Premium plans."), l.push("/plan");
        return;
      }
      let a = e;
      if (!a) {
        if (1 !== si.length) {
          l3("watch", "Select one file or folder to mount.");
          return;
        }
        a = si[0];
      }
      let lKind = "folder" === String(a?.kind || "").trim().toLowerCase() ? "folder" : "file",
        tId = String(a?.id || "").trim(),
        sName = String(a?.name || "").trim(),
        iPath = T(String(a?.path || ""));
      if ("folder" === lKind) {
        if (!iPath || "/" !== iPath && !iPath.startsWith("/")) {
          l3("watch", "Folder path is unavailable for mount.");
          return;
        }
        sName || (sName = Z(iPath) || "Folder"), setMountRunModalItem({
          kind: "folder",
          name: sName,
          folderPath: iPath,
          entryPath: "/index.html"
        });
        return;
      }
      let r = tE.get(tId);
      if (!sName) {
        sName = String(r?.name || "").trim() || Z(iPath) || "index.html";
      }
      if (!iPath || "/" === iPath) {
        iPath = T(String(r?.path || `/${sName || "index.html"}`));
      }
      if (!iPath || "/" === iPath) {
        l3("watch", "File path is unavailable for mount.");
        return;
      }
      setMountRunModalItem({
        kind: "file",
        name: sName,
        folderPath: eh(iPath),
        entryPath: `/${String(sName || Z(iPath) || "index.html")}`
      });
    }, [eK, si, l3, l, tE]),
    runMountRunModal = (0, c.useCallback)(async () => {
      if (!mountRunModalItem) return;
      let e = await mountFolderToCavCodeViewer({
        folderPath: String(mountRunModalItem.folderPath || "/"),
        entryPath: String(mountRunModalItem.entryPath || "/index.html")
      });
      e && setMountRunModalItem(null);
    }, [mountRunModalItem, mountFolderToCavCodeViewer]),
    it = (0, c.useCallback)(async (e, a) => {
      let l = normalizeUploadFolderPath(e);
      if (!l) throw Error(`Invalid folder path: ${String(e || "")}`);
      if ("/" === l) return;
      let t = a || new Map(),
        s = t.get(l);
      if (s) return await s;
      let i = (async () => {
        let e = eh(l),
          a = l.split("/").filter(Boolean),
          s = a[a.length - 1];
        if (!s) return;
        "/" !== e && e !== l && await it(e, t);
        for (let n = 0; n < 4; n += 1) {
          let i = await fetch("/api/cavcloud/folders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: s,
              parentPath: e
            })
          });
          if (i.ok) return;
          let r = await ev(i),
            a = String(r?.error || "").trim();
          if ("PATH_CONFLICT" === a) {
            let t = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent(l)}&lite=1`, {
                method: "GET",
                cache: "no-store"
              }),
              s = await ev(t);
            if (t.ok && s?.ok && s.folder) return;
          }
          if (("TX_CONFLICT" === a || "TX_TIMEOUT" === a) && n < 3) {
            await new Promise(e => window.setTimeout(e, 140 * (n + 1)));
            continue;
          }
          let o = String(r?.message || "").trim();
          throw Error(o || `Failed to ensure folder path ${l}${a ? ` (${a})` : ""}.`);
        }
      })();
      t.set(l, i);
      try {
        await i;
      } catch (e) {
        t.delete(l);
        throw e;
      }
    }, []),
    is = (0, c.useCallback)(async (e, a, lName) => {
      let tName = String(lName || e.name || "").trim() || e.name,
        l = ei(e, tName),
        t = new FormData();
      t.set("file", e, e.name), t.set("name", tName), t.set("folderPath", a), l && t.set("mimeType", l);
      let s = await fetch("/api/cavcloud/files/upload", {
          method: "POST",
          body: t
        }),
        i = await ev(s);
      if (!s.ok || !i?.ok) throw Error(String(i?.message || "Simple upload failed."));
      return i?.file || null;
    }, []),
    ii = (0, c.useCallback)(async (e, a, lName) => {
      let tName = String(lName || e.name || "").trim() || e.name,
        l = ei(e, tName),
        t = await fetch("/api/cavcloud/uploads/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: tName,
            folderPath: a,
            mimeType: l,
            expectedBytes: e.size
          })
        }),
        s = await ev(t);
      if (!t.ok || !s?.ok || !s.upload?.id) throw Error(String(s?.message || "Failed to create multipart upload."));
      let i = s.upload.id,
        r = Math.max(5242880, Number(s.upload.partSizeBytes || 8388608)),
        c = Math.ceil(e.size / r),
        p = Array.from({
          length: c
        }, (e, a) => a);
      await runWithConcurrency(p, CAVCLOUD_MULTIPART_PART_CONCURRENCY, async a => {
        let l = a + 1,
          t = a * r,
          s = Math.min(e.size, t + r),
          c = e.slice(t, s),
          f = await fetch(`/api/cavcloud/uploads/${encodeURIComponent(i)}/part?partNumber=${l}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream"
            },
            body: c
          }),
          d = await ev(f);
        if (!f.ok || !d?.ok) throw Error(String(d?.message || `Multipart part ${l} failed.`));
      });
      let h = await ef(e),
        d = await fetch(`/api/cavcloud/uploads/${encodeURIComponent(i)}/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sha256: h
          })
          }),
        n = await ev(d);
      if (!d.ok || !n?.ok) throw Error(String(n?.message || "Failed to complete multipart upload."));
      return n?.file || null;
    }, []),
    ir = (0, c.useCallback)(async (e, a, lName) => {
      return e.size >= CAVCLOUD_MULTIPART_THRESHOLD_BYTES ? await ii(e, a, lName) : await is(e, a, lName);
    }, [ii, is]),
    ic = (0, c.useCallback)(async (e, a) => {
      if (!e.length) return;
      let maxBytes = Number(en?.usage?.perFileMaxBytes || 0);
      if (!(maxBytes > 0) || (e.some(e => e.size > maxBytes) && l3("watch", `Per-file max: ${P(maxBytes)}`), (e = e.filter(e => e.size <= maxBytes)).length)) {
        setDriveMutationState("upload.files", "started"), logDriveDebug("upload.start", {
          kind: "files",
          fileCount: e.length,
          folderPath: z
        });
        eS(!0);
        try {
          let uploadConcurrency = pickUploadConcurrency(e, cavcloudSettings.uploadConcurrency),
            uploadedCount = 0,
            failedCount = 0,
            firstError = "",
            uploadedNames = [],
            uploadEntries = e.map((e, idx) => {
              let tempId = `tmp_upload_${Date.now()}_${idx}_${Math.random().toString(16).slice(2)}`,
                tempPath = O(z, e.name);
              return {
                file: e,
                tempId,
                tempPath
              };
            });
          for (let entry of uploadEntries) optimisticallyUpsertUploadedFile({
            id: entry.tempId,
            name: entry.file.name,
            path: entry.tempPath,
            bytes: Number(entry.file.size) || 0,
            mimeType: ei(entry.file)
          }, z);
          await runWithConcurrency(uploadEntries, uploadConcurrency, async entry => {
            let baseName = String(entry.file?.name || "file"),
              uploadName = baseName,
              retryAttempts = cavcloudSettings.uploadAutoRetry ? 3 : 1,
              maxAttempts = "autoRename" === cavcloudSettings.nameCollisionRule ? Math.max(retryAttempts, 5) : retryAttempts,
              aMessage = "Upload failed.";
            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
              try {
                let a = await ir(entry.file, z, uploadName);
                optimisticallyUpsertUploadedFile(a || {
                  id: entry.tempId,
                  name: uploadName,
                  path: entry.tempPath,
                  bytes: Number(entry.file.size) || 0,
                  mimeType: ei(entry.file)
                }, z), uploadedCount += 1, uploadedNames.push(String(a?.name || uploadName || "").trim());
                return;
              } catch (aErr) {
                aMessage = aErr instanceof Error ? aErr.message : "Upload failed.";
                let lower = String(aMessage || "").toLowerCase(),
                  isConflict = lower.includes("conflict") || lower.includes("already exists");
                if (isConflict) {
                  if ("failAsk" === cavcloudSettings.nameCollisionRule) {
                    aMessage = `Name collision for ${baseName}. Rename and retry.`;
                    break;
                  }
                  uploadName = uploadAutoRenamedName(baseName, attempt + 1);
                }
                if (attempt >= maxAttempts) break;
                if (!cavcloudSettings.uploadAutoRetry && !isConflict) break;
                await new Promise(e => window.setTimeout(e, 140 * attempt));
              }
            }
            optimisticallyUpsertUploadedFile({
              id: entry.tempId,
              name: entry.file.name,
              path: entry.tempPath,
              bytes: Number(entry.file.size) || 0,
              mimeType: ei(entry.file),
              status: "FAILED",
              errorCode: "UPLOAD_FAILED",
              errorMessage: aMessage
            }, z), failedCount += 1, firstError || (firstError = aMessage);
          });
          if (uploadedCount > 0 && a) {
            let t = uploadedNames.filter(Boolean).slice(0, 250);
            await l8({
              action: a,
              targetPath: z,
              metaJson: {
                fileCount: uploadedCount,
                fileNames: t
              }
            });
          }
          uploadedCount > 0 && (l3("good", `Uploaded ${uploadedCount} file${1 === uploadedCount ? "" : "s"}.`), await refreshTreePostMutation("upload.files"), setDriveMutationState("upload.files", "success"), logDriveDebug("upload.finish", {
            kind: "files",
            uploadedCount,
            failedCount,
            folderPath: z
          }));
          failedCount > 0 && (l3("bad", 0 === uploadedCount ? firstError || `Upload failed for ${failedCount} file${1 === failedCount ? "" : "s"}.` : `${failedCount} file${1 === failedCount ? "" : "s"} failed to upload.`), uploadedCount <= 0 && (setDriveMutationState("upload.files", "failed"), logDriveDebug("upload.finish", {
            kind: "files",
            uploadedCount,
            failedCount,
            folderPath: z
          })));
        } catch (e) {
          l3("bad", e instanceof Error ? e.message : "Upload failed."), setDriveMutationState("upload.files", "failed"), logDriveDebug("upload.finish", {
            kind: "files",
            status: "failed",
            message: e instanceof Error ? e.message : "Upload failed.",
            folderPath: z
          });
        } finally {
          eS(!1);
        }
      }
    }, [z, l3, refreshTreePostMutation, en?.usage?.perFileMaxBytes, ir, l8, optimisticallyUpsertUploadedFile, optimisticallyRemoveUploadPlaceholder, setDriveMutationState, logDriveDebug, cavcloudSettings.uploadConcurrency, cavcloudSettings.uploadAutoRetry, cavcloudSettings.nameCollisionRule]),
    updateUploadDiagnostics = (0, c.useCallback)(e => {
      setFolderUploadDiagnostics(a => {
        let l = e && "object" == typeof e ? e : {},
          t = Array.isArray(l.failed) ? l.failed.slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT) : a.failed;
        return {
          ...a,
          ...l,
          failed: t
        };
      });
    }, []),
    uploadFolderSessionFileWithRetry = (0, c.useCallback)(async e => {
      let a = String(e?.sessionId || "").trim(),
        l = String(e?.fileId || "").trim(),
        t = e?.file instanceof File ? e.file : null,
        s = Math.max(0, Math.trunc(Number(e?.maxRetries ?? CAVCLOUD_FOLDER_UPLOAD_RETRY_ATTEMPTS)) || 0),
        i = String(e?.mimeType || "").trim() || (t ? ei(t, t.name) : "") || "application/octet-stream";
      if (!a || !l || !t) return {
        ok: !1,
        errorCode: "UPLOAD_INPUT_INVALID",
        errorMessage: "Upload input is invalid."
      };
      for (let eAttempt = 0; eAttempt <= s; eAttempt += 1) try {
        let r = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(a)}/upload/${encodeURIComponent(l)}`, {
            method: "POST",
            headers: {
              "Content-Type": i,
              "X-Cavcloud-Upload-Name": encodeURIComponent(String(t.name || "file"))
            },
            body: t
          }),
          c = await ev(r);
        if (r.ok && c?.ok) return {
          ok: !0,
          payload: c
        };
        let o = Number(r.status) || 0,
          d = String(c?.error || o || "UPLOAD_FAILED"),
          n = String(c?.message || `Upload failed (${o || "network"}).`) || "Upload failed.",
          pRetry = o >= 500 || 429 === o || 408 === o || 0 === o;
        if (pRetry && eAttempt < s) {
          await new Promise(e => window.setTimeout(e, 240 * (eAttempt + 1)));
          continue;
        }
        return {
          ok: !1,
          errorCode: d,
          errorMessage: n
        };
      } catch (aErr) {
        let lMsg = aErr instanceof Error ? String(aErr.message || "").trim() : "",
          lAbort = "AbortError" === String(aErr?.name || "").trim() || /aborted/i.test(lMsg);
        if (lAbort) return {
          ok: !1,
          errorCode: "ABORTED",
          errorMessage: lMsg || "Upload request was aborted."
        };
        if (eAttempt < s) {
          await new Promise(e => window.setTimeout(e, 240 * (eAttempt + 1)));
          continue;
        }
        return {
          ok: !1,
          errorCode: "NETWORK_ERROR",
          errorMessage: aErr instanceof Error ? aErr.message : "Network upload failed."
        };
      }
      return {
        ok: !1,
        errorCode: "UPLOAD_FAILED",
        errorMessage: "Upload failed."
      };
    }, []),
    setGoogleDriveImportSessionPatch = (0, c.useCallback)((sessionId, patch = {}) => {
      let id = String(sessionId || "").trim();
      if (!id) return;
      setGoogleDriveImportSessionState(prev => {
        let base = prev && "object" == typeof prev ? prev : {},
          current = base[id] || {
            sessionId: id,
            status: "RUNNING",
            discoveredCount: 0,
            importedCount: 0,
            failedCount: 0,
            pendingCount: 1,
            currentItemLabel: null,
            failedItems: [],
            targetFolderId: String(en?.folder?.id || "").trim() || null,
            updatedAtISO: new Date().toISOString(),
            completedAtISO: null
          },
          nextPatch = patch && "object" == typeof patch ? patch : {},
          next = {
            ...current,
            ...nextPatch,
            sessionId: id,
            failedItems: Array.isArray(nextPatch.failedItems) ? nextPatch.failedItems : current.failedItems
          };
        return {
          ...base,
          [id]: next
        };
      });
    }, [en?.folder?.id]),
    applyGoogleDriveImportSessionStatus = (0, c.useCallback)(async payload => {
      let sessionId = String(payload?.sessionId || "").trim();
      if (!sessionId) return;
      let previousSession = googleDriveImportSessionStateRef.current?.[sessionId] || null;
      let status = String(payload?.status || "RUNNING").trim().toUpperCase(),
        discoveredCount = Math.max(0, Math.trunc(Number(payload?.discoveredCount || 0)) || 0),
        importedCount = Math.max(0, Math.trunc(Number(payload?.importedCount || 0)) || 0),
        failedCount = Math.max(0, Math.trunc(Number(payload?.failedCount || 0)) || 0),
        pendingCount = Math.max(0, Math.trunc(Number(payload?.pendingCount ?? discoveredCount - importedCount - failedCount)) || 0),
        failedItems = Array.isArray(payload?.failedItems) ? payload.failedItems.map(e => ({
          id: String(e?.id || "").trim(),
          providerPath: String(e?.providerPath || "").trim(),
          providerItemId: String(e?.providerItemId || "").trim(),
          retryCount: Math.max(0, Math.trunc(Number(e?.retryCount || 0)) || 0),
          failureCode: String(e?.failureCode || "").trim() || null,
          failureMessageSafe: String(e?.failureMessageSafe || "").trim() || null,
          updatedAtISO: String(e?.updatedAtISO || "").trim() || null
        })).filter(e => e.id && e.providerPath) : [];
      setGoogleDriveImportSessionPatch(sessionId, {
        status,
        discoveredCount,
        importedCount,
        failedCount,
        pendingCount,
        targetFolderId: String(payload?.targetFolderId || "").trim() || null,
        currentItemLabel: String(payload?.currentItemLabel || "").trim() || null,
        failedItems,
        updatedAtISO: String(payload?.updatedAtISO || "").trim() || new Date().toISOString(),
        completedAtISO: String(payload?.completedAtISO || "").trim() || null
      });
      let shouldRefreshDashboard = !previousSession || String(previousSession?.status || "").trim().toUpperCase() !== status || Math.max(0, Math.trunc(Number(previousSession?.discoveredCount || 0)) || 0) !== discoveredCount || Math.max(0, Math.trunc(Number(previousSession?.importedCount || 0)) || 0) !== importedCount || Math.max(0, Math.trunc(Number(previousSession?.failedCount || 0)) || 0) !== failedCount || Math.max(0, Math.trunc(Number(previousSession?.pendingCount || 0)) || 0) !== pendingCount;
      shouldRefreshDashboard && bumpDashboardRefresh();
      if ("FAILED" === status) {
        setUploadsPanelOpen(!0);
      }
      let previousStatus = String(googleDriveImportLastStatusRef.current[sessionId] || "").trim().toUpperCase();
      googleDriveImportLastStatusRef.current = {
        ...googleDriveImportLastStatusRef.current,
        [sessionId]: status
      };
      if (status === previousStatus) return;
      if ("COMPLETED" === status) {
        l3("good", `Google Drive import completed (${importedCount}/${discoveredCount}).`);
        await refreshTreePostMutation("google_drive.import.complete");
      } else if ("FAILED" === status) {
        l3("watch", "Google Drive import finished with failures. Retry failed files from the queue.");
        await refreshTreePostMutation("google_drive.import.failed");
      }
    }, [l3, bumpDashboardRefresh, refreshTreePostMutation, setGoogleDriveImportSessionPatch]),
    fetchGoogleDriveImportSessionStatus = (0, c.useCallback)(async sessionId => {
      let id = String(sessionId || "").trim();
      if (!id) return null;
      try {
        let e = await fetch(`/api/integrations/google-drive/import/session/${encodeURIComponent(id)}/status?failedPage=1&failedPageSize=100`, {
            method: "GET",
            cache: "no-store",
            credentials: "include"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) return null;
        return await applyGoogleDriveImportSessionStatus(a), a;
      } catch {
        return null;
      }
    }, [applyGoogleDriveImportSessionStatus]),
    runGoogleDriveImportSessionBatchClient = (0, c.useCallback)(async sessionId => {
      let id = String(sessionId || "").trim();
      if (!id) return null;
      if (googleDriveImportRunInFlightRef.current.has(id)) return null;
      googleDriveImportRunInFlightRef.current.add(id);
      try {
        let e = await fetch(`/api/integrations/google-drive/import/session/${encodeURIComponent(id)}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({
              maxItems: 2
            })
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) return null;
        setGoogleDriveImportSessionPatch(id, {
          status: String(a?.status || "RUNNING").trim().toUpperCase(),
          discoveredCount: Math.max(0, Math.trunc(Number(a?.discoveredCount || 0)) || 0),
          importedCount: Math.max(0, Math.trunc(Number(a?.importedCount || 0)) || 0),
          failedCount: Math.max(0, Math.trunc(Number(a?.failedCount || 0)) || 0),
          pendingCount: Math.max(0, Math.trunc(Number(a?.pendingCount || 0)) || 0),
          updatedAtISO: String(a?.updatedAtISO || "").trim() || new Date().toISOString(),
          completedAtISO: String(a?.completedAtISO || "").trim() || null
        });
        return a;
      } catch {
        return null;
      } finally {
        googleDriveImportRunInFlightRef.current.delete(id);
      }
    }, [setGoogleDriveImportSessionPatch]),
    pollGoogleDriveImportSessions = (0, c.useCallback)(async (options = {}) => {
      let scopeSessionId = String(options?.sessionId || "").trim() || null,
        forceRun = !!options?.forceRun,
        sessions = Object.values(googleDriveImportSessionStateRef.current || {});
      if (scopeSessionId) {
        sessions = sessions.filter(e => String(e?.sessionId || "").trim() === scopeSessionId);
        sessions.length || (sessions = [{
          sessionId: scopeSessionId,
          status: "RUNNING",
          discoveredCount: 0,
          importedCount: 0,
          failedCount: 0,
          pendingCount: 1
        }]);
      }
      for (let session of sessions) {
        let sessionId = String(session?.sessionId || "").trim();
        if (!sessionId) continue;
        let status = String(session?.status || "RUNNING").trim().toUpperCase(),
          discovered = Math.max(0, Math.trunc(Number(session?.discoveredCount || 0)) || 0),
          imported = Math.max(0, Math.trunc(Number(session?.importedCount || 0)) || 0),
          failed = Math.max(0, Math.trunc(Number(session?.failedCount || 0)) || 0),
          pending = Math.max(0, Math.trunc(Number(session?.pendingCount ?? discovered - imported - failed)) || 0),
          shouldRun = forceRun || ("COMPLETED" !== status && "CANCELED" !== status && ("RUNNING" === status || "CREATED" === status || pending > 0));
        shouldRun && await runGoogleDriveImportSessionBatchClient(sessionId);
        await fetchGoogleDriveImportSessionStatus(sessionId);
      }
    }, [runGoogleDriveImportSessionBatchClient, fetchGoogleDriveImportSessionStatus]),
    handleGoogleDriveImportSessionCreated = (0, c.useCallback)(sessionId => {
      let id = String(sessionId || "").trim();
      if (!id) return;
      googleDriveImportLastStatusRef.current = {
        ...googleDriveImportLastStatusRef.current,
        [id]: "RUNNING"
      };
      setGoogleDriveImportSessionPatch(id, {
        status: "RUNNING",
        discoveredCount: 0,
        importedCount: 0,
        failedCount: 0,
        pendingCount: 1,
        currentItemLabel: null,
        failedItems: [],
        targetFolderId: String(en?.folder?.id || "").trim() || null,
        updatedAtISO: new Date().toISOString(),
        completedAtISO: null
      }), setUploadsPanelOpen(!0), bumpDashboardRefresh(), void pollGoogleDriveImportSessions({
        forceRun: !0,
        sessionId: id
      });
    }, [en?.folder?.id, bumpDashboardRefresh, pollGoogleDriveImportSessions, setGoogleDriveImportSessionPatch]),
    retrySingleGoogleDriveImportFailure = (0, c.useCallback)(async failure => {
      let sessionId = String(failure?.sessionId || "").trim(),
        itemId = String(failure?.fileId || "").trim();
      if (!sessionId || !itemId) return;
      eS(!0);
      try {
        let e = await fetch(`/api/integrations/google-drive/import/session/${encodeURIComponent(sessionId)}/retry`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({
              itemId
            })
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to retry Google Drive import."));
        let retriedCount = Math.max(0, Math.trunc(Number(a?.retriedCount || 0)) || 0);
        if (!retriedCount) {
          l3("watch", "This Google Drive item is no longer retryable.");
          return;
        }
        googleDriveImportLastStatusRef.current = {
          ...googleDriveImportLastStatusRef.current,
          [sessionId]: "RUNNING"
        };
        setGoogleDriveImportSessionPatch(sessionId, {
          status: "RUNNING",
          completedAtISO: null
        }), setUploadsPanelOpen(!0), await pollGoogleDriveImportSessions({
          forceRun: !0,
          sessionId
        });
      } catch (eErr) {
        l3("bad", eErr instanceof Error ? eErr.message : "Failed to retry Google Drive import.");
      } finally {
        eS(!1);
      }
    }, [l3, pollGoogleDriveImportSessions, setGoogleDriveImportSessionPatch]),
    retryFailedGoogleDriveImports = (0, c.useCallback)(async () => {
      let sessions = googleDriveSessionRows.filter(e => Math.max(0, Math.trunc(Number(e?.failedCount || 0)) || 0) > 0);
      if (!sessions.length) return;
      eS(!0);
      try {
        let retriedTotal = 0;
        for (let session of sessions) {
          let sessionId = String(session?.sessionId || "").trim();
          if (!sessionId) continue;
          let e = await fetch(`/api/integrations/google-drive/import/session/${encodeURIComponent(sessionId)}/retry`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              credentials: "include",
              body: JSON.stringify({})
            }),
            a = await ev(e);
          if (!e.ok || !a?.ok) continue;
          let retriedCount = Math.max(0, Math.trunc(Number(a?.retriedCount || 0)) || 0);
          if (!retriedCount) continue;
          retriedTotal += retriedCount, googleDriveImportLastStatusRef.current = {
            ...googleDriveImportLastStatusRef.current,
            [sessionId]: "RUNNING"
          }, setGoogleDriveImportSessionPatch(sessionId, {
            status: "RUNNING",
            completedAtISO: null
          });
        }
        if (!retriedTotal) {
          l3("watch", "No failed Google Drive imports were available to retry.");
          return;
        }
        setUploadsPanelOpen(!0), l3("good", `Retrying ${retriedTotal} Google Drive import item${1 === retriedTotal ? "" : "s"}.`), await pollGoogleDriveImportSessions({
          forceRun: !0
        });
      } finally {
        eS(!1);
      }
    }, [googleDriveSessionRows, l3, pollGoogleDriveImportSessions, setGoogleDriveImportSessionPatch]),
    retryFailedFolderUploads = (0, c.useCallback)(async () => {
      if (!Array.isArray(folderUploadFailures) || !folderUploadFailures.length) return;
      let e = folderUploadFailures.filter(e => e?.file instanceof File && e?.sessionId && e?.fileId),
        a = folderUploadFailures.filter(e => !(e?.file instanceof File && e?.sessionId && e?.fileId));
      if (!e.length) {
        l3("watch", "Failed uploads can only be retried before leaving the page.");
        return;
      }
      eS(!0);
      try {
        let l = [],
          t = new Set(),
          s = 0;
        await runWithConcurrency(e, CAVCLOUD_FOLDER_UPLOAD_RETRY_CONCURRENCY, async e => {
          let a = await uploadFolderSessionFileWithRetry(e);
          t.add(String(e.sessionId || ""));
          if (a.ok) {
            s += 1;
            return;
          }
          l.push({
            ...e,
            errorCode: String(a.errorCode || "UPLOAD_FAILED"),
            errorMessage: String(a.errorMessage || "Upload failed.")
          });
        });
        let i = [],
          r = 0;
        for (let eSession of Array.from(t).filter(Boolean)) try {
          let a = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(eSession)}/finalize`, {
              method: "POST"
            }),
            lFinalize = await ev(a);
          r += Math.max(0, Number(lFinalize?.missingCount || 0) || 0);
          if (lFinalize?.ok) {
            removePersistedFolderUploadSessionId(eSession);
            continue;
          }
          let tFailed = Array.isArray(lFinalize?.failed) ? lFinalize.failed : [];
          for (let aFail of tFailed) {
            let tRel = normalizeUploadRelativePath(String(aFail?.relPath || "")),
              sFileId = String(aFail?.fileId || "").trim();
            if (!tRel) continue;
            let n = e.find(e => e.sessionId === eSession && e.fileId === sFileId) || null;
            i.push({
              ...n,
              sessionId: eSession,
              fileId: sFileId,
              relPath: tRel,
              errorCode: String(aFail?.errorCode || "UPLOAD_FAILED"),
              errorMessage: String(aFail?.errorMessage || "Upload failed.")
            });
          }
        } catch {}
        let c = new Map();
        for (let eFail of [...a, ...l, ...i]) {
          let aKey = `${String(eFail?.sessionId || "")}::${String(eFail?.fileId || "")}::${String(eFail?.relPath || "")}`;
          c.has(aKey) || c.set(aKey, eFail);
        }
        let o = Array.from(c.values()).slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT);
        setFolderUploadFailures(o), setFolderUploadDiagnostics(eDiag => ({
          ...eDiag,
          uploadedCount: eDiag.uploadedCount + s,
          failedCount: o.length,
          missingCount: r,
          failed: o.map(e => ({
            sessionId: e.sessionId,
            fileId: e.fileId,
            relPath: e.relPath,
            errorCode: e.errorCode || null,
            errorMessage: e.errorMessage || null
          }))
        })), s > 0 && await refreshTreePostMutation("upload.folder.retry"), o.length || r ? (setUploadsPanelOpen(!0), l3("watch", `${o.length + Math.max(0, r)} file${1 === o.length + Math.max(0, r) ? "" : "s"} still need attention. View uploads.`)) : s > 0 && l3("good", `Recovered ${s} failed upload${1 === s ? "" : "s"}.`);
      } catch (eErr) {
        setUploadsPanelOpen(!0), l3("watch", "Retry failed. View uploads.");
      } finally {
        eS(!1);
      }
    }, [folderUploadFailures, l3, refreshTreePostMutation, uploadFolderSessionFileWithRetry]),
    retrySingleFolderUploadFailure = (0, c.useCallback)(async key => {
      let target = (Array.isArray(folderUploadFailures) ? folderUploadFailures : []).find(e => folderUploadFailureKey(e) === String(key || ""));
      if (!target) return;
      if (!(target?.file instanceof File) || !target?.sessionId || !target?.fileId) {
        l3("watch", "This failed upload can only be retried before leaving the page.");
        return;
      }
      eS(!0);
      try {
        let retry = await uploadFolderSessionFileWithRetry(target);
        if (!retry.ok) {
          let failedNext = folderUploadFailures.map(e => folderUploadFailureKey(e) === String(key || "") ? {
            ...e,
            errorCode: String(retry.errorCode || "UPLOAD_FAILED"),
            errorMessage: String(retry.errorMessage || "Upload failed.")
          } : e).slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT);
          setFolderUploadFailures(failedNext), setFolderUploadDiagnostics(eDiag => ({
            ...eDiag,
            failedCount: failedNext.length,
            failed: failedNext.map(e => ({
              sessionId: e.sessionId,
              fileId: e.fileId,
              relPath: e.relPath,
              errorCode: e.errorCode || null,
              errorMessage: e.errorMessage || null
            }))
          })), setUploadsPanelOpen(!0), l3("watch", "Retry failed. View uploads.");
          return;
        }
        let sSessionId = String(target.sessionId || ""),
          others = folderUploadFailures.filter(e => folderUploadFailureKey(e) !== String(key || "")),
          missingCount = 0,
          finalFailures = others;
        try {
          let eFinalizeRes = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(sSessionId)}/finalize`, {
              method: "POST"
            }),
            eFinalize = await ev(eFinalizeRes);
          missingCount = Math.max(0, Number(eFinalize?.missingCount || 0) || 0);
          if (eFinalize?.ok) removePersistedFolderUploadSessionId(sSessionId);else {
            let sessionFailed = Array.isArray(eFinalize?.failed) ? eFinalize.failed : [],
              merged = new Map();
            for (let eFail of others.filter(e => String(e?.sessionId || "") !== sSessionId)) {
              let aKey = folderUploadFailureKey(eFail);
              merged.has(aKey) || merged.set(aKey, eFail);
            }
            for (let eFail of sessionFailed) {
              let aRel = normalizeUploadRelativePath(String(eFail?.relPath || "")),
                lFileId = String(eFail?.fileId || "").trim();
              if (!aRel) continue;
              let i = others.find(e => String(e?.sessionId || "") === sSessionId && String(e?.fileId || "") === lFileId) || null,
                n = {
                  ...i,
                  sessionId: sSessionId,
                  fileId: lFileId,
                  relPath: aRel,
                  errorCode: String(eFail?.errorCode || "UPLOAD_FAILED"),
                  errorMessage: String(eFail?.errorMessage || "Upload failed.")
                };
              merged.has(folderUploadFailureKey(n)) || merged.set(folderUploadFailureKey(n), n);
            }
            finalFailures = Array.from(merged.values()).slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT);
          }
        } catch {}
        setFolderUploadFailures(finalFailures), setFolderUploadDiagnostics(eDiag => ({
          ...eDiag,
          uploadedCount: eDiag.uploadedCount + 1,
          failedCount: finalFailures.length,
          missingCount: missingCount,
          failed: finalFailures.map(e => ({
            sessionId: e.sessionId,
            fileId: e.fileId,
            relPath: e.relPath,
            errorCode: e.errorCode || null,
            errorMessage: e.errorMessage || null
          }))
        })), await refreshTreePostMutation("upload.folder.retry.single"), finalFailures.length || missingCount ? (setUploadsPanelOpen(!0), l3("watch", `${finalFailures.length + Math.max(0, missingCount)} file${1 === finalFailures.length + Math.max(0, missingCount) ? "" : "s"} still need attention. View uploads.`)) : l3("good", "Recovered failed upload.");
      } catch {
        setUploadsPanelOpen(!0), l3("watch", "Retry failed. View uploads.");
      } finally {
        eS(!1);
      }
    }, [folderUploadFailures, l3, refreshTreePostMutation, uploadFolderSessionFileWithRetry]),
    cancelFailedFolderUpload = (0, c.useCallback)(key => {
      let tKey = String(key || "");
      if (!tKey) return;
      setFolderUploadFailures(prev => {
        let next = (Array.isArray(prev) ? prev : []).filter(e => folderUploadFailureKey(e) !== tKey);
        if (next.length === (Array.isArray(prev) ? prev.length : 0)) return prev;
        setFolderUploadDiagnostics(eDiag => ({
          ...eDiag,
          failedCount: next.length,
          failed: next.map(e => ({
            sessionId: e.sessionId,
            fileId: e.fileId,
            relPath: e.relPath,
            errorCode: e.errorCode || null,
            errorMessage: e.errorMessage || null
          }))
        }));
        return next;
      });
    }, []),
    retryAllFailedUploads = (0, c.useCallback)(async () => {
      await retryFailedFolderUploads();
      await retryFailedGoogleDriveImports();
    }, [retryFailedFolderUploads, retryFailedGoogleDriveImports]),
    retrySingleUploadFailure = (0, c.useCallback)(async key => {
      let failureKey = String(key || ""),
        driveFailure = googleDriveFailureIndex.get(failureKey);
      if (driveFailure) {
        await retrySingleGoogleDriveImportFailure(driveFailure);
        return;
      }
      await retrySingleFolderUploadFailure(failureKey);
    }, [googleDriveFailureIndex, retrySingleGoogleDriveImportFailure, retrySingleFolderUploadFailure]),
    cancelUploadFailure = (0, c.useCallback)(key => {
      let failureKey = String(key || "");
      if (!failureKey) return;
      if (googleDriveFailureIndex.has(failureKey)) {
        return;
      }
      cancelFailedFolderUpload(failureKey);
    }, [googleDriveFailureIndex, cancelFailedFolderUpload]),
    uploadStatusRecoveryEffect = (0, c.useEffect)(() => {
      let eCanceled = !1;
      (async () => {
        let eIds = readPersistedFolderUploadSessionIds();
        if (!eIds.length) return;
        let aFailures = [],
          lMissing = 0;
        for (let sSessionId of eIds) {
          if (!sSessionId) continue;
          try {
            let eRes = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(sSessionId)}/status?failedPage=1&failedPageSize=100`, {
                method: "GET",
                cache: "no-store"
              }),
              aStatus = await ev(eRes);
            if (!eRes.ok || !aStatus?.ok) continue;
            if ("COMPLETE" === String(aStatus?.status || "").toUpperCase()) {
              removePersistedFolderUploadSessionId(sSessionId);
              continue;
            }
            lMissing += Math.max(0, Number(aStatus?.missingCount || 0) || 0);
            let tFailed = Array.isArray(aStatus?.failed) ? aStatus.failed : [];
            for (let eFail of tFailed) {
              let aRel = normalizeUploadRelativePath(String(eFail?.relPath || "")),
                lFileId = String(eFail?.fileId || "").trim();
              aRel && aFailures.push({
                sessionId: sSessionId,
                fileId: lFileId,
                relPath: aRel,
                file: null,
                mimeType: "",
                targetPath: "/",
                targetFolderId: null,
                errorCode: String(eFail?.errorCode || "UPLOAD_FAILED"),
                errorMessage: String(eFail?.errorMessage || "Upload failed.")
              }), updateUploadDiagnostics({
                sessionId: sSessionId,
                discoveredCount: Math.max(0, Number(aStatus?.discoveredFilesCount || 0) || 0),
                manifestSentCount: Math.max(0, Number(aStatus?.discoveredFilesCount || 0) || 0),
                serverCreatedCount: Math.max(0, Number(aStatus?.createdFilesCount || 0) || 0),
                uploadedCount: Math.max(0, Number(aStatus?.finalizedFilesCount || 0) || 0),
                failedCount: Math.max(0, Number(aStatus?.failedFilesCount || 0) || 0),
                missingCount: Math.max(0, Number(aStatus?.missingCount || 0) || 0)
              });
            }
          } catch {}
        }
        if (eCanceled) return;
        if (!aFailures.length && !lMissing) return;
        let tMap = new Map();
        for (let eFail of aFailures) {
          let aKey = `${String(eFail?.sessionId || "")}::${String(eFail?.fileId || "")}::${String(eFail?.relPath || "")}`;
          tMap.has(aKey) || tMap.set(aKey, eFail);
        }
        let sFinal = Array.from(tMap.values()).slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT);
        setFolderUploadFailures(sFinal), updateUploadDiagnostics({
          failedCount: sFinal.length,
          missingCount: lMissing,
          failed: sFinal.map(e => ({
            sessionId: e.sessionId,
            fileId: e.fileId,
            relPath: e.relPath,
            errorCode: e.errorCode || null,
            errorMessage: e.errorMessage || null
          }))
        });
      })();
      return () => {
        eCanceled = !0;
      };
    }, [updateUploadDiagnostics]),
    uploadFolderEntries = (0, c.useCallback)(async (items, basePath = z, options = {}) => {
      if (!Array.isArray(items) || !items.length) return;
      let rootPath = normalizeUploadFolderPath(String(options?.targetFolderPath || basePath || z)) || z,
        targetFolderId = String(options?.targetFolderId || en?.folder?.id || "").trim() || null,
        sourceEntries = items.map(item => {
          let file = item?.file instanceof File ? item.file : item,
            relativePath = normalizeUploadRelativePath(String(item?.relativePath || file?.webkitRelativePath || file?.name || ""));
          return file instanceof File && relativePath ? {
            file,
            relativePath
          } : null;
        }).filter(entry => !!entry),
        folderEntries = sourceEntries.filter(e => String(e.relativePath || "").includes("/"));
      if ("flatten" === cavcloudSettings.folderUploadMode) {
        await ic(sourceEntries.map(e => e.file), options?.activityAction || "upload.folder");
        return;
      }
      if (!folderEntries.length) {
        await ic(sourceEntries.map(e => e.file), options?.activityAction);
        return;
      }
      let maxBytes = Number(en?.usage?.perFileMaxBytes || 0);
      if (maxBytes > 0) {
        folderEntries.some(e => e.file.size > maxBytes) && l3("watch", `Per-file max: ${P(maxBytes)}`), folderEntries = folderEntries.filter(e => e.file.size <= maxBytes);
        if (!folderEntries.length) return;
      }
      let groups = collectFolderUploadRootGroups(folderEntries);
      if (!groups.length) {
        await ic(folderEntries.map(e => e.file), options?.activityAction);
        return;
      }
      let summary = summarizeFolderUploadEntries(folderEntries),
        rootNames = collectFolderUploadRootNames(folderEntries),
        discoveredCount = folderEntries.length;
      l3("watch", `Folder preflight • Files: ${summary.files} • Size: ${P(summary.totalBytes)} • Depth: ${summary.maxDepth}`), setDriveMutationState("upload.folder", "started"), logDriveDebug("upload.start", {
        kind: "folder",
        discoveredCount,
        rootPath
      }), setFolderUploadFailures([]), setFolderUploadDiagnostics({
        ...createUploadDiagnosticsState(),
        discoveredCount
      }), eS(!0);
      let optimisticByRelPath = new Map(folderEntries.map((entry, idx) => {
          let tempId = `tmp_upload_${Date.now()}_${idx}_${Math.random().toString(16).slice(2)}`,
            tempPath = O(rootPath, entry.relativePath);
          return [String(entry.relativePath || "").trim(), {
            tempId,
            tempPath,
            file: entry.file
          }];
        }));
      for (let [eRelPath, ePlaceholder] of optimisticByRelPath.entries()) optimisticallyUpsertUploadedFile({
        id: ePlaceholder.tempId,
        name: ePlaceholder.file.name,
        path: ePlaceholder.tempPath || O(rootPath, eRelPath),
        bytes: Number(ePlaceholder.file.size) || 0,
        mimeType: ei(ePlaceholder.file, ePlaceholder.file.name)
      }, rootPath);
      let manifestSentCount = 0,
        serverCreatedCount = 0,
        uploadedCount = 0,
        missingCount = 0,
        failures = [];
      try {
        for (let group of groups) {
          let sessionRes = await fetch("/api/cavcloud/folder-upload/session", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                parentFolderId: targetFolderId,
                parentFolderPath: rootPath,
                rootName: group.rootName,
                nameCollisionRule: cavcloudSettings.nameCollisionRule
              })
            }),
            sessionPayload = await ev(sessionRes);
          if (!sessionRes.ok || !sessionPayload?.ok || !sessionPayload?.sessionId) throw Error(String(sessionPayload?.message || "Failed to create folder upload session."));
          let sessionId = String(sessionPayload.sessionId || "").trim();
          if (!sessionId) throw Error("Folder upload session id is missing.");
          addPersistedFolderUploadSessionId(sessionId);
          console.info("[cavcloud-folder-upload]", sessionId, "client.session.created", {
            discoveredCount: group.entries.length,
            rootName: group.rootName,
            targetPath: rootPath
          }), updateUploadDiagnostics({
            sessionId
          });
          let entryByRelPath = new Map(group.entries.map(e => [e.relativePath, e])),
            createdByRelPath = new Map();
          for (let manifestChunk of chunkArray(group.entries, CAVCLOUD_FOLDER_UPLOAD_MANIFEST_CHUNK_SIZE)) {
            manifestSentCount += manifestChunk.length, updateUploadDiagnostics({
              manifestSentCount
            });
            let manifestRes = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(sessionId)}/manifest`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  entries: manifestChunk.map(e => ({
                    relPath: e.relativePath,
                    bytes: Number(e.file.size) || 0,
                    mimeTypeGuess: ei(e.file, e.file.name),
                    lastModified: Number(e.file.lastModified) || 0
                  }))
                })
              }),
              manifestPayload = await ev(manifestRes);
            if (!manifestRes.ok || !manifestPayload?.ok) throw Error(String(manifestPayload?.message || "Failed to ingest upload manifest."));
            let createdFiles = Array.isArray(manifestPayload?.createdFiles) ? manifestPayload.createdFiles : [];
            serverCreatedCount += createdFiles.length, updateUploadDiagnostics({
              serverCreatedCount
            });
            for (let created of createdFiles) {
              let relPath = normalizeUploadRelativePath(String(created?.relPath || "")),
                fileId = String(created?.fileId || "").trim();
              relPath && fileId && createdByRelPath.set(relPath, {
                fileId,
                r2Key: String(created?.r2Key || "")
              });
            }
          }
          if (createdByRelPath.size !== group.entries.length) throw Error(`Folder ingestion mismatch: discovered ${group.entries.length}, server created ${createdByRelPath.size}. No files were marked complete.`);
          let uploadEntries = group.entries.map(e => {
            let a = createdByRelPath.get(e.relativePath);
            return a ? {
              sessionId,
              fileId: a.fileId,
              relPath: e.relativePath,
              file: e.file,
              mimeType: ei(e.file, e.file.name),
              targetPath: rootPath,
              targetFolderId
            } : null;
          }).filter(e => !!e);
          if (uploadEntries.length !== group.entries.length) throw Error(`Folder ingestion mismatch: discovered ${group.entries.length}, upload targets ${uploadEntries.length}.`);
          let uploadConcurrency = pickUploadConcurrency(uploadEntries.map(e => e.file), cavcloudSettings.uploadConcurrency);
          await runWithConcurrency(uploadEntries, uploadConcurrency, async e => {
            let a = await uploadFolderSessionFileWithRetry({
              ...e,
              maxRetries: cavcloudSettings.uploadAutoRetry ? CAVCLOUD_FOLDER_UPLOAD_RETRY_ATTEMPTS : 0
            });
            if (a.ok) {
              let lPath = O(rootPath, e.relPath),
                tPlaceholder = optimisticByRelPath.get(String(e.relPath || "").trim());
              tPlaceholder && optimisticallyUpsertUploadedFile({
                id: e.fileId,
                name: e.file.name,
                path: lPath,
                bytes: Number(e.file.size) || 0,
                mimeType: e.mimeType || ei(e.file, e.file.name)
              }, rootPath);
              uploadedCount += 1, updateUploadDiagnostics({
                uploadedCount
              });
              return;
            }
            let lPath = O(rootPath, e.relPath),
              tPlaceholder = optimisticByRelPath.get(String(e.relPath || "").trim()),
              sErrorCode = String(a.errorCode || "UPLOAD_FAILED"),
              iErrorMessage = String(a.errorMessage || "Upload failed.");
            optimisticallyUpsertUploadedFile({
              id: e.fileId || tPlaceholder?.tempId || `tmp_failed_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              name: e.file?.name || Z(lPath) || "file",
              path: lPath,
              bytes: Number(e?.file?.size || 0) || 0,
              mimeType: e.mimeType || ei(e.file, e.file?.name),
              status: "FAILED",
              errorCode: sErrorCode,
              errorMessage: iErrorMessage
            }, rootPath);
            failures.push({
              ...e,
              errorCode: sErrorCode,
              errorMessage: iErrorMessage
            }), updateUploadDiagnostics({
              failedCount: failures.length,
              failed: failures.map(e => ({
                sessionId: e.sessionId,
                fileId: e.fileId,
                relPath: e.relPath,
                errorCode: e.errorCode || null,
                errorMessage: e.errorMessage || null
              }))
            });
          });
          let finalizeRes = await fetch(`/api/cavcloud/folder-upload/session/${encodeURIComponent(sessionId)}/finalize`, {
              method: "POST"
            }),
            finalizePayload = await ev(finalizeRes);
          if (finalizePayload?.ok) {
            removePersistedFolderUploadSessionId(sessionId);
            continue;
          }
          missingCount += Math.max(0, Number(finalizePayload?.missingCount || 0) || 0);
          let failedRows = Array.isArray(finalizePayload?.failed) ? finalizePayload.failed : [];
          for (let row of failedRows) {
            let relPath = normalizeUploadRelativePath(String(row?.relPath || "")),
              fileId = String(row?.fileId || "").trim();
            if (!relPath) continue;
            let existing = failures.some(e => e.sessionId === sessionId && e.relPath === relPath);
            if (existing) continue;
            let source = entryByRelPath.get(relPath);
            optimisticallyUpsertUploadedFile({
              id: fileId || source?.file?.name || `tmp_failed_${Date.now()}_${Math.random().toString(16).slice(2)}`,
              name: source?.file?.name || Z(O(rootPath, relPath)) || "file",
              path: O(rootPath, relPath),
              bytes: Number(source?.file?.size || 0) || 0,
              mimeType: source?.file ? ei(source.file, source.file.name) : "",
              status: "FAILED",
              errorCode: String(row?.errorCode || "UPLOAD_FAILED"),
              errorMessage: String(row?.errorMessage || "Upload failed.")
            }, rootPath);
            failures.push({
              sessionId,
              fileId,
              relPath,
              file: source?.file || null,
              mimeType: source?.file ? ei(source.file, source.file.name) : "",
              targetPath: rootPath,
              targetFolderId,
              errorCode: String(row?.errorCode || "UPLOAD_FAILED"),
              errorMessage: String(row?.errorMessage || "Upload failed.")
            });
          }
          updateUploadDiagnostics({
            failedCount: failures.length,
            missingCount,
            failed: failures.map(e => ({
              sessionId: e.sessionId,
              fileId: e.fileId,
              relPath: e.relPath,
              errorCode: e.errorCode || null,
              errorMessage: e.errorMessage || null
            }))
          });
        }
        let failureMap = new Map();
        for (let e of failures) {
          let a = `${String(e?.sessionId || "")}::${String(e?.fileId || "")}::${String(e?.relPath || "")}`;
          failureMap.has(a) || failureMap.set(a, e);
        }
        let finalFailures = Array.from(failureMap.values()).slice(0, CAVCLOUD_FOLDER_UPLOAD_FAILED_LIST_LIMIT),
          strictCreatedMatch = serverCreatedCount === discoveredCount,
          strictUploadedMatch = uploadedCount === discoveredCount,
          strictComplete = strictCreatedMatch && strictUploadedMatch && 0 === finalFailures.length && 0 === missingCount;
        setFolderUploadFailures(finalFailures), updateUploadDiagnostics({
          serverCreatedCount,
          uploadedCount,
          failedCount: finalFailures.length,
          missingCount,
          failed: finalFailures.map(e => ({
            sessionId: e.sessionId,
            fileId: e.fileId,
            relPath: e.relPath,
            errorCode: e.errorCode || null,
            errorMessage: e.errorMessage || null
          }))
        }), await refreshTreePostMutation("upload.folder");
        if (!strictCreatedMatch) throw Error(`Folder ingestion mismatch: discovered ${discoveredCount}, server created ${serverCreatedCount}. No files were marked complete.`);
        if (!strictUploadedMatch) throw Error(`Folder ingestion mismatch: discovered ${discoveredCount}, uploaded ${uploadedCount}.`);
        if (!strictComplete) throw Error(`Folder upload incomplete. Uploaded ${uploadedCount}/${discoveredCount}; failed ${finalFailures.length}; missing ${missingCount}.`);
        !1 !== options?.writeActivity && await l8({
          action: String(options?.activityAction || "upload.folder").trim() || "upload.folder",
          targetPath: T(String(options?.activityTargetPath || rootPath || z)),
          metaJson: {
            fileCount: uploadedCount,
            discoveredCount,
            rootFolders: rootNames
          }
        }), l3("good", String(options?.successText || "").trim() || `Uploaded folder (${uploadedCount} file${1 === uploadedCount ? "" : "s"}).`), setDriveMutationState("upload.folder", "success"), logDriveDebug("upload.finish", {
          kind: "folder",
          uploadedCount,
          failedCount: finalFailures.length,
          missingCount,
          rootPath
        });
      } catch (eErr) {
        setUploadsPanelOpen(!0), l3("bad", eErr instanceof Error ? eErr.message : "Folder upload failed."), setDriveMutationState("upload.folder", "failed"), logDriveDebug("upload.finish", {
          kind: "folder",
          status: "failed",
          message: eErr instanceof Error ? eErr.message : "Folder upload failed.",
          rootPath
        });
      } finally {
        eS(!1);
      }
    }, [z, en?.folder?.id, en?.usage?.perFileMaxBytes, ic, l3, refreshTreePostMutation, l8, updateUploadDiagnostics, uploadFolderSessionFileWithRetry, optimisticallyUpsertUploadedFile, optimisticallyRemoveUploadPlaceholder, setDriveMutationState, logDriveDebug, cavcloudSettings.uploadConcurrency, cavcloudSettings.folderUploadMode, cavcloudSettings.nameCollisionRule, cavcloudSettings.uploadAutoRetry]),
    io = (0, c.useCallback)(async (e, a, l) => {
      await uploadFolderEntries(e, a, l);
    }, [uploadFolderEntries]),
    id = (0, c.useCallback)(async e => {
      let a = Array.from(e.currentTarget.files || []);
      e.currentTarget.value = "", await ic(a);
    }, [ic]),
    iu = (0, c.useCallback)(async e => {
      let a = e.currentTarget,
        l = Array.from(a.files || []),
        t = getInputFileSystemEntries(a);
      a.value = "";
      let s = await collectFolderUploadEntries({
        fileSystemEntries: t,
        files: l
      });
      await io(s.length ? s : l, z, {
        targetFolderId: String(en?.folder?.id || "").trim() || null,
        activityAction: "upload.folder",
        activityTargetPath: z
      });
    }, [en?.folder?.id, io, z]),
    ih = (0, c.useCallback)(async e => {
      let a = Array.from(e.currentTarget.files || []);
      e.currentTarget.value = "", await ic(a, "upload.camera_roll");
    }, [ic]),
    iCreateFolderWithTarget = (0, c.useCallback)(async (e, a) => {
      let l = "cavsafe" === a ? "cavsafe" : "cavcloud";
      if ("cavcloud" === l) return await sG(e);
      let t = String(e || "").trim();
      if (!t) return l3("watch", "Folder name is required."), !1;
      eS(!0);
      try {
        let e = await fetch("/api/cavsafe/folders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: t,
              parentPath: "/"
            })
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to create folder."));
        return l3("good", "Folder created in CavSafe."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create folder."), !1;
      } finally {
        eS(!1);
      }
    }, [sG, l3, ta]),
    iCreateFileWithTarget = (0, c.useCallback)(async (e, a) => {
      let iTarget = "cavsafe" === a ? "cavsafe" : "cavcode" === a ? "cavcode" : "cavcloud";
      if ("cavcloud" === iTarget) return await sK(e);
      let t = String(e || "").trim();
      if (!t) return l3("watch", "Document name is required."), !1;
      let s = es(t) || "text/plain; charset=utf-8";
      eS(!0);
      try {
        if ("cavcode" === iTarget) {
          let e = "/Synced/CavCode",
            a = await fetch("/api/cavcloud/sync/upsert", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                folderPath: e,
                name: t,
                mimeType: s,
                content: "",
                source: "cavcode.create_file"
              })
            }),
            i = await ev(a);
          if (!a.ok || !i?.ok) throw Error(String(i?.message || "Failed to send file to CavCode."));
          let r = T(String(i?.file?.path || `${e}/${t}`));
          return l3("good", "File sent to CavCode."), await refreshTreePostMutation("mutation"), l.push(`/cavcode?cloud=1&file=${encodeURIComponent(r)}`), !0;
        }
        let i = await fetch("/api/cavsafe/sync/upsert", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              folderPath: "/",
              name: t,
              mimeType: s,
              content: "",
              source: "cavcloud.create_file"
            })
          }),
          r = await ev(i);
        if (!i.ok || !r?.ok) throw Error(String(r?.message || "Failed to create file."));
        return l3("good", "File created in CavSafe."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create file."), !1;
      } finally {
        eS(!1);
      }
    }, [sK, l3, ta, l]),
    im = (0, c.useCallback)(async () => {
      (await iCreateFolderWithTarget(lp, createFolderTarget)) && (lv(!1), lf(""), setCreateFolderTarget("cavcloud"), lh(!1));
    }, [iCreateFolderWithTarget, lp, createFolderTarget]),
    iv = (0, c.useCallback)(async () => {
      (await iCreateFileWithTarget(lE, createFileTarget)) && (lU(!1), lD("untitled.txt"), setCreateFileTarget("cavcloud"), lh(!1));
    }, [lE, iCreateFileWithTarget, createFileTarget]),
    ip = (0, c.useCallback)(e => {
      if (!ew && !eC) {
        if ("create.folder" === e) {
          lh(!1), lf(""), setCreateFolderTarget("cavcloud"), lv(!0);
          return;
        }
        if ("create.file" === e) {
          lh(!1), lD("untitled.txt"), setCreateFileTarget("cavcloud"), lU(!0);
          return;
        }
        if ("add.upload_files" === e) {
          lh(!1), lV.current?.click();
          return;
        }
        if ("add.upload_folder" === e) {
          lh(!1), lZ.current?.click();
          return;
        }
        if ("add.import_google_drive" === e) {
          lh(!1), setGoogleDriveImportModalOpen(!0);
          return;
        }
        l3("watch", "Action unavailable.");
      }
    }, [ew, eC, l3]),
    ig = (0, c.useCallback)(async e => {
      let a = K(e.kind, e.id);
      ax(!0), ab({
        [a]: e
      }), await sw();
    }, [sw]),
    ix = (0, c.useCallback)(async e => {
      if (cavcloudSettings.confirmTrashDelete && !window.confirm(`Move folder "${e?.name || "folder"}" to Recently deleted?`)) return;
      let a = {
        id: e.id,
        kind: "folder",
        name: e.name,
        path: e.path
      };
      setDriveMutationState("delete.folder", "started"), logDriveDebug("delete.start", {
        itemCount: 1,
        kind: "folder",
        folderPath: e.path
      }), markDeletingVisual([a]);
      eS(!0);
      try {
        await new Promise(e => window.setTimeout(e, CAVCLOUD_DELETE_VISUAL_MS));
        optimisticallyMoveItemsToTrash([a]);
        let l = await fetch(`/api/cavcloud/folders/${encodeURIComponent(e.id)}`, {
            method: "DELETE"
          }),
          t = await ev(l);
        if (!l.ok || !t?.ok) throw Error(String(t?.message || "Failed to delete folder."));
        l3("good", "Folder moved to recently deleted."), await refreshTreePostMutation("delete.folder"), setDriveMutationState("delete.folder", "success"), logDriveDebug("delete.finish", {
          itemCount: 1,
          kind: "folder",
          status: "success",
          folderPath: e.path
        });
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to delete folder."), setDriveMutationState("delete.folder", "failed"), logDriveDebug("delete.finish", {
          itemCount: 1,
          kind: "folder",
          status: "failed",
          message: e instanceof Error ? e.message : "Failed to delete folder.",
          folderPath: a.path
        }), await refreshTreePostMutation("delete.folder");
      } finally {
        clearDeletingVisual([a]), eS(!1);
      }
    }, [l3, refreshTreePostMutation, markDeletingVisual, clearDeletingVisual, optimisticallyMoveItemsToTrash, setDriveMutationState, logDriveDebug, cavcloudSettings.confirmTrashDelete]),
    iy = (0, c.useCallback)(e => {
      let a = cavcloudSettingsRef.current || CAVCLOUD_SETTINGS_DEFAULTS,
        l = "custom" === a.publishDefaultTitleMode ? "" : String(e?.name || "").trim();
      lW(e), lG(l), lJ(a.publishDefaultVisibility), setPublishExpiryDays(normalizePublishExpiryDays(a.publishDefaultExpiryDays, 0));
    }, []),
    iPublish = (0, c.useCallback)(e => {
      let a = e;
      if (!a) {
        if (1 !== si.length) {
          l3("watch", "Select one file or folder to publish.");
          return;
        }
        a = si[0];
      }
      let l = String(a?.kind || "").trim().toLowerCase(),
        t = String(a?.id || "").trim(),
        s = String(a?.name || "").trim();
      if (!t || !s || ("file" !== l && "folder" !== l)) {
        l3("watch", "Select one file or folder to publish.");
        return;
      }
      if ("folder" === l) {
        iy({
          id: t,
          kind: "folder",
          name: s,
          path: String(a?.path || "/")
        });
        return;
      }
      let i = tE.get(t),
        r = Number(a?.bytes ?? i?.bytes ?? 0) || 0;
      iy({
        id: t,
        kind: "file",
        name: s,
        path: String(a?.path || i?.path || `/${s}`),
        mimeType: String(a?.mimeType || i?.mimeType || V(s) || "application/octet-stream"),
        bytes: r
      });
    }, [si, l3, tE, iy]),
    ib = (0, c.useCallback)(e => {
      let a = e.dataTransfer.getData("application/x-cavcloud-item");
      if (!a) return null;
      try {
        let e = JSON.parse(a),
          l = String(e.id || "").trim(),
          t = "folder" === e.kind ? "folder" : "file" === e.kind ? "file" : null,
          s = String(e.name || "").trim(),
          i = String(e.path || "").trim();
        if (!l || !t || !s) return null;
        return {
          id: l,
          kind: t,
          name: s,
          path: i || "/"
        };
      } catch {
        return null;
      }
    }, []),
    ij = (0, c.useCallback)((e, a) => {
      e.dataTransfer.effectAllowed = "move", e.dataTransfer.setData("application/x-cavcloud-item", JSON.stringify(a)), e.dataTransfer.setData("text/plain", a.path);
    }, []),
    iN = (0, c.useCallback)(async (e, a) => {
      e.preventDefault(), e.stopPropagation();
      let l = ib(e);
      if (l) {
        if (l.id === a.id && "folder" === l.kind) return;
        eS(!0);
        try {
          await sJ(l, a.id), l3("good", `${"folder" === l.kind ? "Folder" : "File"} moved.`), await refreshTreePostMutation("move");
        } catch (e) {
          l3("bad", e instanceof Error ? e.message : "Failed to move item.");
        } finally {
          eS(!1);
        }
        return;
      }
      let t = Array.from(e.dataTransfer.files || []),
        sEntries = getDataTransferFileSystemEntries(e.dataTransfer),
        sHandles = getDataTransferFileSystemHandles(e.dataTransfer);
      if (!t.length && !sEntries.length && !sHandles.length) {
        l3("watch", "This browser cannot drop folders here. Use Upload Folder.");
        return;
      }
      if (t.length || sEntries.length || sHandles.length) {
        let s = [];
        try {
          s = await collectFolderUploadEntries({
            fileSystemEntries: sEntries,
            fileSystemHandles: sHandles,
            files: t
          });
        } catch {}
        let i = s.length ? s : t,
          n = i.some(e => String(e?.relativePath || e?.webkitRelativePath || "").replace(/\\/g, "/").includes("/"));
        if (n) {
          await io(i, a.path, {
            targetFolderId: a.id,
            targetFolderPath: a.path,
            activityAction: "upload.folder",
            activityTargetPath: a.path
          });
          return;
        }
        if (!t.length) {
          l3("watch", "Folder drop is unsupported in this browser. Use Upload Folder.");
          return;
        }
        eS(!0);
        try {
          let uploadEntries = t.map((eFile, eIdx) => {
            let tempId = `tmp_upload_${Date.now()}_${eIdx}_${Math.random().toString(16).slice(2)}`,
              tempPath = O(a.path, eFile.name);
            return {
              file: eFile,
              tempId,
              tempPath
            };
          }),
            uploadedCount = 0,
            failedCount = 0,
            firstError = "";
          for (let entry of uploadEntries) optimisticallyUpsertUploadedFile({
            id: entry.tempId,
            name: entry.file.name,
            path: entry.tempPath,
            bytes: Number(entry.file.size) || 0,
            mimeType: ei(entry.file)
          }, a.path);
          for (let entry of uploadEntries) try {
            let lUploaded = await ir(entry.file, a.path);
            optimisticallyUpsertUploadedFile(lUploaded || {
              id: entry.tempId,
              name: entry.file.name,
              path: entry.tempPath,
              bytes: Number(entry.file.size) || 0,
              mimeType: ei(entry.file)
            }, a.path), uploadedCount += 1;
          } catch (aErr) {
            optimisticallyRemoveUploadPlaceholder(entry.tempId, entry.tempPath);
            failedCount += 1, firstError || (firstError = aErr instanceof Error ? aErr.message : "Folder upload failed.");
          }
          uploadedCount > 0 && (l3("good", `Uploaded ${uploadedCount} file${1 === uploadedCount ? "" : "s"} to ${a.name}.`), await refreshTreePostMutation("upload.files"));
          failedCount > 0 && l3("bad", 0 === uploadedCount ? firstError || "Folder upload failed." : `${failedCount} file${1 === failedCount ? "" : "s"} failed while uploading folder.`);
        } catch (e) {
          l3("bad", e instanceof Error ? e.message : "Folder upload failed.");
        } finally {
          eS(!1);
        }
      }
    }, [sJ, l3, ib, refreshTreePostMutation, ir, io, optimisticallyUpsertUploadedFile, optimisticallyRemoveUploadPlaceholder]),
    ik = "Explore" === S || "Folders" === S || "Files" === S || "Gallery" === S,
    iw = "Search CavCloud",
    iS = (0, c.useCallback)(() => {
      let e = Date.now();
      aZ(aH || ed(e - 2592e6)), aq(aK || ed(e)), aQ(!0);
    }, [aH, aK]),
    iM = (0, c.useCallback)(e => {
      if ("custom" === e) {
        aW("custom"), iS();
        return;
      }
      aW(e);
    }, [iS]),
    iI = (0, c.useCallback)(() => {
      aU("all"), aW("24h"), aG(""), aJ(""), aZ(""), aq(""), aQ(!1);
    }, []),
    i$ = (0, c.useCallback)(() => {
      aQ(!1), "custom" !== a_ || aH.trim() || aK.trim() || aW("24h");
    }, [aH, aK, a_]),
    iL = (0, c.useCallback)(() => {
      let e = String(aV || "").trim(),
        a = String(az || "").trim(),
        l = eo(e),
        t = eo(a);
      if (e && null == l) {
        l3("watch", "Custom timeline start date is invalid.");
        return;
      }
      if (a && null == t) {
        l3("watch", "Custom timeline end date is invalid.");
        return;
      }
      if (null != l && null != t && l > t) {
        l3("watch", "Start date must be before end date.");
        return;
      }
      aG(e), aJ(a), aW("custom"), aQ(!1);
    }, [l3, aV, az]),
    iA = (0, c.useCallback)(() => {
      let e = Date.now();
      ll(a6 || ed(e - 2592e6)), ls(a9 || ed(e)), lr(!0);
    }, [a6, a9]),
    iT = (0, c.useCallback)(e => {
      if ("custom" === e) {
        a8("custom"), iA();
        return;
      }
      a8(e);
    }, [iA]),
    iO = (0, c.useCallback)(() => {
      lr(!1), "custom" !== a3 || a6.trim() || a9.trim() || a8("24h");
    }, [a6, a9, a3]),
    iF = (0, c.useCallback)(() => {
      let e = String(la || "").trim(),
        a = String(lt || "").trim(),
        l = eo(e),
        t = eo(a);
      if (e && null == l) {
        l3("watch", "Custom restoration start date is invalid.");
        return;
      }
      if (a && null == t) {
        l3("watch", "Custom restoration end date is invalid.");
        return;
      }
      if (null != l && null != t && l > t) {
        l3("watch", "Restoration start date must be before end date.");
        return;
      }
      a7(e), le(a), a8("custom"), lr(!1);
    }, [l3, la, lt]),
    clearRecentsFilters = (0, c.useCallback)(() => {
      setRecentsKind("all"), setRecentsTimeline("24h"), setRecentsPage(1), aS(!1);
    }, []),
    clearSyncedFilters = (0, c.useCallback)(() => {
      setSyncedSource("all"), setSyncedTimeline("24h"), aS(!1);
    }, []),
    mountFeatureLockedMessage = "Available on premium plans or upgrade to premium plan.",
    iP = (0, c.useMemo)(() => "all" !== aR || "24h" !== a_ || !!aH.trim() || !!aK.trim(), [aH, aK, aR, a_]),
    canMoveToCavSafe = (0, c.useMemo)(() => isOwner && "FREE" !== String(eK || "").trim().toUpperCase(), [isOwner, eK]),
    canUseMountFeature = (0, c.useMemo)(() => "FREE" !== String(eK || "").trim().toUpperCase(), [eK]),
    isRecentsFiltersActive = (0, c.useMemo)(() => "all" !== recentsKind || "24h" !== recentsTimeline, [recentsKind, recentsTimeline]),
    isSyncedFiltersActive = (0, c.useMemo)(() => "all" !== syncedSource || "24h" !== syncedTimeline, [syncedSource, syncedTimeline]),
    iB = (0, c.useMemo)(() => {
      if ("Explore" === S) {
        let e = String(en?.folder?.name || "").trim();
        return e && "root" !== e.toLowerCase() ? e : "CavCloud";
      }
      if ("Dashboard" === S) return "Dashboard";
      if ("Collab" === S) return "Collaboration";
      if ("Trash" === S) return "Recently deleted";
      return S;
    }, [S, en?.folder?.name]),
    iR = (0, c.useMemo)(() => "grid_large" === aC ? "is-grid-large" : "list" === aC ? "is-list" : "list_large" === aC ? "is-list-large" : "is-grid", [aC]),
    iU = (0, c.useMemo)(() => "grid_large" === aM ? "is-grid-large" : "list" === aM ? "is-list" : "list_large" === aM ? "is-list-large" : "is-grid", [aM]),
    iE = (0, c.useMemo)(() => "grid_large" === a$ ? "is-grid-large" : "list" === a$ ? "is-list" : "list_large" === a$ ? "is-list-large" : "is-grid", [a$]),
    iD = (0, c.useMemo)(() => "grid_large" === aE ? "is-grid-large" : "list" === aE ? "is-list" : "list_large" === aE ? "is-list-large" : "is-grid", [aE]),
    i_ = (0, c.useMemo)(() => {
      if ("Dashboard" === S) return `${tB.length} events • ${tR.length} starred`;
      if ("Explore" === S) return `${ts.length} folders • ${ti.length} files`;
      if ("Recents" === S) return `${tB.length} events`;
      if ("Synced" === S) return `${tSyncedCounts.total} events`;
      if ("Folders" === S) return `${ts.length} folders`;
      if ("Files" === S) return `${tx.length} files`;
      if ("Gallery" === S) return "images" === aj ? `${tn.photos} photo${1 === tn.photos ? "" : "s"}` : "videos" === aj ? `${tn.videos} video${1 === tn.videos ? "" : "s"}` : "mobile" === aj ? `${tn.total} mobile upload${1 === tn.total ? "" : "s"}` : `${tc.photos} photo${1 === tc.photos ? "" : "s"} • ${tc.videos} video${1 === tc.videos ? "" : "s"}`;
      if ("Starred" === S) return "folders" === aA ? `${tz.length} folder${1 === tz.length ? "" : "s"}` : "files" === aA ? `${tz.length} file${1 === tz.length ? "" : "s"}` : "gallery" === aA ? `${tz.length} gallery item${1 === tz.length ? "" : "s"}` : `${tz.length} item${1 === tz.length ? "" : "s"}`;
      if ("Shared" === S) return "gallery" === aO ? `${t2.photos} photo${1 === t2.photos ? "" : "s"} • ${t2.videos} video${1 === t2.videos ? "" : "s"}` : "folders" === aO ? `${t2.folders} folder${1 === t2.folders ? "" : "s"}` : "files" === aO ? `${t2.files} file${1 === t2.files ? "" : "s"}` : "visited_links" === aO ? `${t2.total} visited link${1 === t2.total ? "" : "s"}` : "recents" === aO ? `${t2.total} recent share${1 === t2.total ? "" : "s"}` : `${t2.activeLinks} active link${1 === t2.activeLinks ? "" : "s"}`;
      if ("Collab" === S) return "readonly" === collabInboxFilter ? `${collabInboxSummary.readonly} read-only item${1 === collabInboxSummary.readonly ? "" : "s"}` : "edit" === collabInboxFilter ? `${collabInboxSummary.canEdit} editable item${1 === collabInboxSummary.canEdit ? "" : "s"}` : "expiringSoon" === collabInboxFilter ? `${collabInboxSummary.expiringSoon} expiring soon` : `${collabInboxSummary.total} shared item${1 === collabInboxSummary.total ? "" : "s"}`;
      if ("Trash" === S) return "restorations" === a1 ? `${tg.length} restoration${1 === tg.length ? "" : "s"}` : `${th.length} item${1 === th.length ? "" : "s"}`;
      return "Workspace preferences";
    }, [S, tR.length, tx.length, ts.length, ti.length, tB.length, tSyncedCounts.total, tc.photos, tc.videos, aj, tn.photos, tn.total, tn.videos, aO, aA, t2.activeLinks, t2.files, t2.folders, t2.photos, t2.total, t2.videos, eX, tz.length, collabInboxLoading, collabInboxFilter, collabInboxSummary.readonly, collabInboxSummary.canEdit, collabInboxSummary.expiringSoon, collabInboxSummary.total, tg.length, th.length, a1]),
    iW = t.jsx("div", {
      className: "cavcloud-folderGrid",
      children: ts.map(e => {
        let a = !!ay[K("folder", e.id)],
          l = !!deletingVisualKeys[K("folder", e.id)],
          r = {
            id: e.id,
            kind: "folder",
            name: e.name,
            path: e.path
          },
          cShared = Math.max(0, Math.trunc(Number(e?.sharedUserCount || 0)) || 0),
          oCollab = !!e?.collaborationEnabled;
        return (0, t.jsxs)("div", {
          className: `cavcloud-folderCard ${a ? "is-selected" : ""} ${l ? "is-deleting" : ""}`,
          onDragOver: e => {
            e.preventDefault();
            let a = Array.from(e.dataTransfer.types || []);
            e.dataTransfer.dropEffect = a.includes("Files") ? "copy" : "move";
          },
          onDrop: a => void iN(a, e),
          children: [(0, t.jsxs)("button", {
            type: "button",
            className: "cavcloud-folderButton",
            "data-desktop-select-item": "true",
            disabled: ew || eC,
            draggable: !ag,
            onDragStart: e => ij(e, r),
            onClick: e => {
              e.detail <= 1 && sN(r, e);
            },
            onDoubleClick: () => void (cancelPendingFolderSelect(), s_(e.path)),
            title: F(e.path),
            "aria-label": `Select folder ${e.name}. Double-click to open.`,
            children: [t.jsx(eCollabBadge, {
              sharedUserCount: cShared,
              collaborationEnabled: oCollab
            }), t.jsx("span", {
              className: "cavcloud-folderIcon",
              "aria-hidden": "true",
              children: t.jsx(ex, {})
            }), t.jsx("span", {
              className: "cavcloud-folderName",
              children: e.name
            })]
          })]
        }, e.id);
      })
    }),
    iH = t.jsx("div", {
      className: "cavcloud-fileGrid",
      children: ti.map(e => {
        let a = Q(e),
          l = a ? `/api/cavcloud/files/${encodeURIComponent(e.id)}?raw=1` : "",
          fStatus = String(e?.status || "READY").trim().toUpperCase(),
          s = b && u === e.id,
          i = `file_explore_card:${e.id}`,
          c = {
            id: e.id,
            kind: "file",
            name: e.name,
            path: e.path
          },
          o = !!ay[K("file", e.id)],
          d = !!deletingVisualKeys[K("file", e.id)],
          n = sn.has(`file:${T(e.path)}`),
          hShared = Math.max(0, Math.trunc(Number(e?.sharedUserCount || 0)) || 0),
          mCollab = !!e?.collaborationEnabled;
        return (0, t.jsxs)("div", {
          className: `cavcloud-fileCard ${o ? "is-selected" : ""} ${s ? "is-preview-selected" : ""} ${d ? "is-deleting" : ""} ${"READY" === fStatus ? "" : `is-${fStatus.toLowerCase()}`}`,
          children: [(0, t.jsxs)("button", {
            type: "button",
            className: "cavcloud-fileTile",
            "data-desktop-select-item": "true",
            disabled: ew || eC,
            draggable: !ag,
            onDragStart: e => ij(e, c),
            onClick: a => {
              if (a.detail > 1) return;
              sN(c, a);
            },
            onDoubleClick: () => void s5(e, !1),
            title: e.path,
            "aria-label": `Select file ${e.name}. Double-click to open.`,
            children: [t.jsx(eCollabBadge, {
              sharedUserCount: hShared,
              collaborationEnabled: mCollab
            }), n ? t.jsx("span", {
              className: "cavcloud-cardStarCorner",
              role: "img",
              "aria-label": "Starred",
              children: t.jsx("svg", {
                viewBox: "0 0 24 24",
                fill: "none",
                "aria-hidden": "true",
                children: t.jsx("path", {
                  d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                  fill: "currentColor"
                })
              })
            }) : null, t.jsx(eN, {
              file: e,
              mediaKind: a,
              previewUrl: l
            }), t.jsx("span", {
              className: "cavcloud-fileTileName",
              children: displayCavcloudFileName(e.name, cavcloudSettings.showExtensions)
            }), "READY" === fStatus ? null : t.jsx("span", {
              className: `cavcloud-fileTileStatus is-${fStatus.toLowerCase()}`,
              children: "FAILED" === fStatus ? "Failed" : "Uploading..."
            })]
          }), t.jsx("div", {
            className: "cavcloud-fileCardMenu",
            children: (0, t.jsxs)("div", {
              className: "cavcloud-trashMenuWrap",
              ref: i === lP ? l1 : void 0,
              children: [t.jsx("button", {
                className: "cavcloud-rowAction is-icon cavcloud-galleryMoreBtn",
                type: "button",
                disabled: ew || eC,
                onClick: a => {
                  a.stopPropagation(), lB(e => i === e ? "" : i);
                },
                "aria-label": `Actions for file ${e.name}`,
                title: "Actions",
                children: (0, t.jsxs)("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: [t.jsx("circle", {
                    cx: "5.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "18.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  })]
                })
              }), i === lP ? t.jsx("div", {
                className: "cavcloud-trashActionMenu",
                role: "menu",
                "aria-label": `Actions for file ${e.name}`,
                children: t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC,
                  onClick: a => {
                    a.stopPropagation(), openCollaborateModal("FILE", e);
                  },
                  children: "Share"
                })
              }) : null]
            })
          })]
        }, e.id);
      })
    }),
    iX = t.jsx("div", {
      className: "cavcloud-fileGrid",
      children: tx.map(e => {
        let a = Q(e),
          l = a ? `/api/cavcloud/files/${encodeURIComponent(e.id)}?raw=1` : "",
          fStatus = String(e?.status || "READY").trim().toUpperCase(),
          s = b && u === e.id,
          i = `file_card:${e.id}`,
          c = {
            id: e.id,
            kind: "file",
            name: e.name,
            path: e.path
          },
          o = !!ay[K("file", e.id)],
          d = !!deletingVisualKeys[K("file", e.id)],
          n = sn.has(`file:${T(e.path)}`),
          hShared = Math.max(0, Math.trunc(Number(e?.sharedUserCount || 0)) || 0),
          mCollab = !!e?.collaborationEnabled;
        return (0, t.jsxs)("div", {
          className: `cavcloud-fileCard ${o ? "is-selected" : ""} ${s ? "is-preview-selected" : ""} ${d ? "is-deleting" : ""} ${"READY" === fStatus ? "" : `is-${fStatus.toLowerCase()}`}`,
          children: [(0, t.jsxs)("button", {
            type: "button",
            className: "cavcloud-fileTile",
            "data-desktop-select-item": "true",
            disabled: ew || eC,
            draggable: !ag,
            onDragStart: e => ij(e, c),
            onClick: a => {
              if (a.detail > 1) return;
              sN(c, a);
            },
            onDoubleClick: () => void s5(e, !1),
            title: e.path,
            "aria-label": `Select file ${e.name}. Double-click to open.`,
            children: [t.jsx(eCollabBadge, {
              sharedUserCount: hShared,
              collaborationEnabled: mCollab
            }), n ? t.jsx("span", {
              className: "cavcloud-cardStarCorner",
              role: "img",
              "aria-label": "Starred",
              children: t.jsx("svg", {
                viewBox: "0 0 24 24",
                fill: "none",
                "aria-hidden": "true",
                children: t.jsx("path", {
                  d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                  fill: "currentColor"
                })
              })
            }) : null, t.jsx(eN, {
              file: e,
              mediaKind: a,
              previewUrl: l
            }), t.jsx("span", {
              className: "cavcloud-fileTileName",
              children: displayCavcloudFileName(e.name, cavcloudSettings.showExtensions)
            }), "READY" === fStatus ? null : t.jsx("span", {
              className: `cavcloud-fileTileStatus is-${fStatus.toLowerCase()}`,
              children: "FAILED" === fStatus ? "Failed" : "Uploading..."
            })]
          }), t.jsx("div", {
            className: "cavcloud-fileCardMenu",
            children: (0, t.jsxs)("div", {
              className: "cavcloud-trashMenuWrap",
              ref: i === lP ? l1 : void 0,
              children: [t.jsx("button", {
                className: "cavcloud-rowAction is-icon cavcloud-galleryMoreBtn",
                type: "button",
                disabled: ew || eC,
                onClick: a => {
                  a.stopPropagation(), lB(e => i === e ? "" : i);
                },
                "aria-label": `Actions for file ${e.name}`,
                title: "Actions",
                children: (0, t.jsxs)("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: [t.jsx("circle", {
                    cx: "5.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "18.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  })]
                })
              }), i === lP ? t.jsx("div", {
                className: "cavcloud-trashActionMenu",
                role: "menu",
                "aria-label": `Actions for file ${e.name}`,
                children: t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC,
                  onClick: a => {
                    a.stopPropagation(), openCollaborateModal("FILE", e);
                  },
                  children: "Share"
                })
              }) : null]
            })
          })]
        }, e.id);
      })
    });
  (0, c.useEffect)(() => {
    if ("production" === process.env.NODE_ENV) return;
    if (eyesDiagLoggedRef.current) return;
    eyesDiagLoggedRef.current = !0, console.debug("[CavCloud][diag] CavBot eyes mounted");
  }, []);
  (0, c.useEffect)(() => {
    let e = `${pathName}?folderPath=${encodeURIComponent(folderPathFromQuery || "/")}`;
    routeDiagRef.current && routeDiagRef.current !== e && "production" !== process.env.NODE_ENV && console.debug("[CavCloud][diag] route transition", {
      from: routeDiagRef.current,
      to: e,
      spa: !0
    }), routeDiagRef.current = e, resetTransientUi("route-change");
  }, [pathName, folderPathFromQuery, resetTransientUi]);
  (0, c.useEffect)(() => {
    let e = T(z);
    if (e === lastFolderPathRef.current) return;
    lastFolderPathRef.current = e, b && w(), resetTransientUi("folder-change");
  }, [z, b, w, resetTransientUi]);
  (0, c.useEffect)(() => {
    if ("production" !== process.env.NODE_ENV) {
      let e = "",
        a = "";
      try {
        e = String(document.documentElement.style.overflow || ""), a = String(document.body.style.overflow || "");
      } catch {}
      console.debug("[CavCloud][diag] preview state", {
        open: b,
        fileId: String(N?.resourceId || N?.id || ""),
        htmlOverflow: e,
        bodyOverflow: a
      });
    }
    b || resetTransientUi("preview-close");
  }, [b, N, resetTransientUi]);
  (0, c.useEffect)(() => {
    if ("undefined" == typeof window) return;
    try {
      // Root-cause fix (C1): keep URL and drive state coherent for folder/file navigation.
      let e = new URL(window.location.href),
        a = T(z) || "/";
      if (e.searchParams.set("folderPath", a), b && N) {
        let a = String(N.resourceId || N.shareFileId || N.id || "").trim(),
          lRaw = String(N.path || "").trim(),
          l = lRaw ? T(lRaw) : "";
        a ? e.searchParams.set("fileId", a) : e.searchParams.delete("fileId"), l && "/" !== l ? e.searchParams.set("filePath", l) : e.searchParams.delete("filePath");
      } else e.searchParams.delete("fileId"), e.searchParams.delete("filePath");
      let t = `${e.pathname}${e.search}`,
        s = `${window.location.pathname}${window.location.search}`;
      t !== s && l.replace(t, {
        scroll: !1
      });
    } catch {}
  }, [l, z, b, N]);
  (0, c.useEffect)(() => {
    if ("undefined" == typeof window) return;
    let eStatus = String(searchParams?.get("driveImport") || "").trim().toLowerCase();
    if (!eStatus) return;
    let aReason = String(searchParams?.get("reason") || "").trim().toLowerCase(),
      lKey = `${eStatus}:${aReason}`;
    if (driveImportQueryHandledRef.current === lKey) return;
    driveImportQueryHandledRef.current = lKey;
    if ("connected" === eStatus) {
      l3("good", "Google Drive connected.");
    } else if ("connect_failed" === eStatus) {
      let eMsg = "Google Drive connection failed. Please reconnect and try again.";
      "missing_refresh_token" === aReason ? eMsg = "Google Drive did not return a refresh token. Reconnect and approve consent again." : "access_denied" !== aReason && "consent_required" !== aReason || (eMsg = "Google Drive connection was not completed. Reconnect and approve access.");
      l3("bad", eMsg), setGoogleDriveImportModalOpen(!0);
    }
    try {
      let e = new URL(window.location.href);
      e.searchParams.delete("driveImport"), e.searchParams.delete("reason"), l.replace(`${e.pathname}${e.search}`, {
        scroll: !1
      });
    } catch {}
  }, [searchParams, l, l3]);
  (0, c.useEffect)(() => {
    if ("undefined" == typeof window) return;
    try {
      let e = new URLSearchParams(window.location.search),
        a = String(e.get("fileId") || "").trim(),
        lRaw = String(e.get("filePath") || "").trim(),
        l = lRaw ? T(lRaw) : "";
      if (!a && !l) return;
      let t = null;
      if (a) {
        let e = tE.get(a);
        e && (t = tW(e));
      }
      if (!t && l && "/" !== l) {
        let e = tD.get(l);
        t = e ? tW(e) : tH({
          path: l,
          name: Z(l),
          modifiedAtISO: new Date().toISOString(),
          createdAtISO: new Date().toISOString()
        });
      }
      if (!t) return;
      // Root-cause fix: avoid close->reopen race by hydrating preview only from URL changes.
      tV(t);
    } catch {}
  }, [searchParams, tE, tD, tW, tH, tV]);
  (0, c.useEffect)(() => {
    let e = {},
      a = [...(Array.isArray(en?.files) ? en.files : []), ...(Array.isArray(ad) ? ad : []), ...(Array.isArray(galleryAllFiles) ? galleryAllFiles : [])];
    for (let l of a) {
      let aId = String(l?.id || "").trim(),
        tSnippet = formatSnippetForThumbnail(String(l?.previewSnippet || ""));
      aId && tSnippet && (e[aId] = tSnippet);
    }
    Object.keys(e).length && setSnippetByFileId(a => {
      let l = {
          ...a
        },
        t = !1;
      for (let aId of Object.keys(e)) l[aId] !== e[aId] && (l[aId] = e[aId], t = !0);
      return t ? l : a;
    });
  }, [en?.files, ad, galleryAllFiles]);
  (0, c.useEffect)(() => {
    let eCandidates = new Map(),
      aPush = e => {
        let aId = String(e?.id || "").trim();
        aId && eCandidates.set(aId, e);
      },
      lRowFromId = eId => {
        let a = String(eId || "").trim();
        if (!a) return null;
        let l = tE.get(a);
        if (l) return l;
        let t = th.find(l => "file" === l.kind && String(l.targetId || "") === a);
        return t ? {
          id: a,
          name: t.name,
          path: t.path,
          mimeType: "",
          previewSnippet: String(snippetByFileId[a] || ""),
          updatedAtISO: t.deletedAtISO || t.purgeAfterISO || ""
        } : null;
      };
    if ("Explore" === S) for (let e of ti.slice(0, 100)) aPush(e);
    if ("Files" === S) for (let e of tx.slice(0, 100)) aPush(e);
    if ("Starred" === S) for (let e of tz.slice(0, 100)) "file" === e.targetType && e.targetId && aPush(lRowFromId(e.targetId) || {
      id: e.targetId,
      name: Z(e.path) || e.path,
      path: e.path,
      mimeType: "",
      previewSnippet: "",
      updatedAtISO: e.createdAtISO || ""
    });
    if ("Trash" === S && "restorations" !== a1) for (let e of th.slice(0, 100)) "file" === e.kind && e.targetId && aPush(lRowFromId(e.targetId) || {
      id: e.targetId,
      name: e.name,
      path: e.path,
      mimeType: "",
      previewSnippet: String(snippetByFileId[e.targetId] || ""),
      updatedAtISO: e.deletedAtISO || ""
    });
    let sIds = [];
    for (let [eId, a] of eCandidates) {
      let lName = String(a?.name || a?.path || "").trim(),
        tMime = String(a?.mimeType || "").trim(),
        sSnippet = formatSnippetForThumbnail(String(a?.previewSnippet || snippetByFileId[eId] || ""));
      if (!lName || !isTextLikeFile(lName, tMime) || sSnippet) continue;
      let iVersion = String(a?.updatedAtISO || a?.deletedAtISO || ""),
        rPrevVersion = snippetRequestedVersionRef.current.get(eId);
      if (rPrevVersion === iVersion) continue;
      snippetRequestedVersionRef.current.set(eId, iVersion), sIds.push(eId);
    }
    if (!sIds.length) return;
    let iCanceled = !1;
    void async function () {
      try {
        let e = await fetch("/api/cavcloud/files/snippets", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              fileIds: sIds
            })
          }),
          a = await ev(e);
        if (iCanceled || !e.ok || !a?.ok || !a?.snippets || "object" != typeof a.snippets) return;
        let l = a.snippets;
        setSnippetByFileId(e => {
          let a = {
              ...e
            },
            t = !1;
          for (let [eId, sSnippet] of Object.entries(l)) {
            let lFormatted = formatSnippetForThumbnail(String(sSnippet || ""));
            lFormatted && a[eId] !== lFormatted && (a[eId] = lFormatted, t = !0);
          }
          return t ? a : e;
        });
        let tIds = Object.keys(l);
        tIds.length && (ey(eState => {
          if (!eState || !Array.isArray(eState.files) || !eState.files.length) return eState;
          let aTouched = !1,
            sFiles = eState.files.map(eFile => {
              let aId = String(eFile?.id || "").trim();
              if (!aId || !(aId in l)) return eFile;
              let sSnippet = formatSnippetForThumbnail(String(l[aId] || ""));
              if (String(eFile.previewSnippet || "") === String(sSnippet || "")) return eFile;
              return aTouched = !0, {
                ...eFile,
                previewSnippet: sSnippet
              };
            });
          return aTouched ? {
            ...eState,
            files: sFiles
          } : eState;
        }), an(eRows => Array.isArray(eRows) ? eRows.map(eFile => {
          let aId = String(eFile?.id || "").trim();
          if (!aId || !(aId in l)) return eFile;
          let tSnippet = formatSnippetForThumbnail(String(l[aId] || ""));
          return String(eFile.previewSnippet || "") === String(tSnippet || "") ? eFile : {
            ...eFile,
            previewSnippet: tSnippet
          };
        }) : eRows), setGalleryAllFiles(eRows => Array.isArray(eRows) ? eRows.map(eFile => {
          let aId = String(eFile?.id || "").trim();
          if (!aId || !(aId in l)) return eFile;
          let tSnippet = formatSnippetForThumbnail(String(l[aId] || ""));
          return String(eFile.previewSnippet || "") === String(tSnippet || "") ? eFile : {
            ...eFile,
            previewSnippet: tSnippet
          };
        }) : eRows));
      } catch {}
    }();
    return () => {
      iCanceled = !0;
    };
  }, [S, ti, tx, tz, th, a1, tE, snippetByFileId]);
  (0, c.useEffect)(() => {
    if (eC || "ANON" === memberRole || collabLaunchGlobalIndexed || collabLaunchGlobalIndexBusy || collabLaunchGlobalIndexError || collabLaunchGlobalIndexInFlightRef.current) return;
    let eCanceled = !1;
    collabLaunchGlobalIndexInFlightRef.current = !0, setCollabLaunchGlobalIndexBusy(!0), setCollabLaunchGlobalIndexError("");
    void async function () {
      try {
        let eRootId = "";
        if (Array.isArray(en?.breadcrumbs) && en.breadcrumbs.length) {
          let aRoot = en.breadcrumbs[0];
          eRootId = String(aRoot?.id || "").trim();
        }
        eRootId || (eRootId = String(en?.folder?.id || "").trim());
        if (!eRootId || "root" === eRootId.toLowerCase()) {
          let aRootRes = await fetch("/api/cavcloud/root", {
              method: "GET",
              cache: "no-store"
            }),
            lRootPayload = await ev(aRootRes);
          if (401 === aRootRes.status || 403 === aRootRes.status) return;
          if (aRootRes.ok && lRootPayload?.ok) {
            eRootId = String(lRootPayload.rootFolderId || lRootPayload.defaultFolderId || lRootPayload.root?.id || lRootPayload.defaultFolder?.id || "").trim();
          }
        }
        if (!eRootId || "root" === eRootId.toLowerCase()) {
          let aRootRes = await fetch(`/api/cavcloud/tree?folder=${encodeURIComponent("/")}&lite=1`, {
              method: "GET",
              cache: "no-store"
            }),
            lRootPayload = await ev(aRootRes);
          if (401 === aRootRes.status || 403 === aRootRes.status) return;
          if (!aRootRes.ok || !lRootPayload?.ok || !lRootPayload?.folder?.id) throw Error(String(lRootPayload?.message || "Failed to load root folder."));
          eRootId = String(lRootPayload.folder.id || "").trim();
        }
        if (!eRootId || "root" === eRootId.toLowerCase()) throw Error("Failed to resolve root folder.");
        let aFolderQueue = [eRootId],
          lVisitedFolderIds = new Set(),
          tItems = new Map(),
          sPush = (eKind, aRow) => {
            let lId = String(aRow?.id || "").trim();
            if (!lId) return;
            let tKind = "folder" === eKind ? "folder" : "file",
              sKey = `${tKind}:${lId}`,
              iPath = T(String(aRow?.path || "")),
              rName = String(aRow?.name || Z(iPath) || lId).trim() || lId;
            tItems.set(sKey, {
              key: sKey,
              id: lId,
              kind: tKind,
              resourceType: "folder" === tKind ? "FOLDER" : "FILE",
              name: rName,
              path: iPath
            });
          };
        for (; aFolderQueue.length;) {
          let eFolderId = String(aFolderQueue.shift() || "").trim();
          if (!eFolderId || lVisitedFolderIds.has(eFolderId)) continue;
          lVisitedFolderIds.add(eFolderId);
          let aRes = await fetch(`/api/cavcloud/folders/${encodeURIComponent(eFolderId)}/children`, {
              method: "GET",
              cache: "no-store"
            }),
            lPayload = await ev(aRes);
          if (401 === aRes.status || 403 === aRes.status) return;
          if (!aRes.ok || !lPayload?.ok || !lPayload?.folder) {
            let eCode = String(lPayload?.error || "").trim().toUpperCase();
            if (404 === aRes.status || "FOLDER_NOT_FOUND" === eCode) continue;
            throw Error(String(lPayload?.message || "Failed to load files and folders for sharing."));
          }
          let iFolders = Array.isArray(lPayload.folders) ? lPayload.folders : [],
            rFiles = Array.isArray(lPayload.files) ? lPayload.files : [];
          for (let eFolder of iFolders) {
            sPush("folder", eFolder);
            let aId = String(eFolder?.id || "").trim();
            aId && !lVisitedFolderIds.has(aId) && aFolderQueue.push(aId);
          }
          for (let eFile of rFiles) sPush("file", eFile);
        }
        eCanceled || (setCollabLaunchGlobalItems(Array.from(tItems.values())), setCollabLaunchGlobalIndexed(!0));
      } catch (eErr) {
        if (!eCanceled) {
          let e = eErr instanceof Error ? eErr.message : "Failed to load files and folders for sharing.";
          setCollabLaunchGlobalIndexError(e), l3("bad", e);
        }
      } finally {
        collabLaunchGlobalIndexInFlightRef.current = !1, setCollabLaunchGlobalIndexBusy(!1);
      }
    }();
    return () => {
      eCanceled = !0;
    };
  }, [eC, memberRole, collabLaunchGlobalIndexed, collabLaunchGlobalIndexBusy, collabLaunchGlobalIndexError, en?.breadcrumbs, en?.folder?.id, l3]);
  (0, c.useEffect)(() => {
    let eCanceled = !1,
      aFolderIds = Array.from(new Set(collabLaunchItems.filter(e => "folder" === e.kind).map(e => String(e?.id || "").trim()).filter(Boolean))).slice(0, 64),
      lToFetch = [];
    for (let eId of aFolderIds) {
      if (collabLaunchFolderCounts[eId] || collabLaunchCountFetchInFlightRef.current.has(eId)) continue;
      collabLaunchCountFetchInFlightRef.current.add(eId), lToFetch.push(eId);
    }
    if (!lToFetch.length) return () => {
      eCanceled = !0;
    };
    void async function () {
      try {
        let eParams = new URLSearchParams();
        eParams.set("ids", lToFetch.join(","));
        let aRes = await fetch(`/api/cavcloud/folders/counts?${eParams.toString()}`, {
            cache: "no-store"
          }),
          tPayload = await ev(aRes);
        if (eCanceled) return;
        if (!aRes.ok || !tPayload?.ok) throw Error(String(tPayload?.message || "Failed to load folder counts."));
        let sCounts = tPayload && "object" == typeof tPayload && tPayload.counts && "object" == typeof tPayload.counts ? tPayload.counts : {};
        setCollabLaunchFolderCounts(eState => {
          let aNext = {
              ...eState
            },
            lTouched = !1;
          for (let eId of lToFetch) {
            let aRaw = sCounts?.[eId],
              tFolders = Math.max(0, Math.trunc(Number(aRaw?.folders || 0)) || 0),
              sFiles = Math.max(0, Math.trunc(Number(aRaw?.files || 0)) || 0),
              iPrev = aNext?.[eId];
            if (iPrev && "ready" === iPrev.status && iPrev.folders === tFolders && iPrev.files === sFiles) continue;
            aNext[eId] = {
              status: "ready",
              folders: tFolders,
              files: sFiles
            }, lTouched = !0;
          }
          return lTouched ? aNext : eState;
        });
      } catch {
        if (eCanceled) return;
        setCollabLaunchFolderCounts(eState => {
          let aNext = {
              ...eState
            },
            lTouched = !1;
          for (let eId of lToFetch) aNext?.[eId] || (aNext[eId] = {
            status: "error",
            folders: 0,
            files: 0
          }, lTouched = !0);
          return lTouched ? aNext : eState;
        });
      } finally {
        for (let eId of lToFetch) collabLaunchCountFetchInFlightRef.current.delete(eId);
      }
    }();
    return () => {
      eCanceled = !0;
    };
  }, [collabLaunchItems, collabLaunchFolderCounts]);
  (0, c.useEffect)(() => {
    combinedUploadFailures.length && setUploadsPanelOpen(!0);
  }, [combinedUploadFailures.length]);
  (0, c.useEffect)(() => {
    let e = {};
    for (let a of td) {
      let l = Q(a);
      l && (e[a.id] = `/api/cavcloud/files/${encodeURIComponent(a.id)}?raw=1`);
    }
    af(a => {
      let l = Object.keys(a),
        t = Object.keys(e);
      if (l.length === t.length && t.every(l => a[l] === e[l])) return a;
      return e;
    });
  }, [td]);
  (0, c.useEffect)(() => {
    "Settings" !== S && 1 !== settingsPage && setSettingsPage(1);
  }, [S, settingsPage]);
  (0, c.useEffect)(() => {
    if ("Settings" !== S || "undefined" == typeof document || "undefined" == typeof window) return;
    let e = window.requestAnimationFrame(() => {
      let e = document.querySelector(".cavcloud-settings");
      e?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
    return () => window.cancelAnimationFrame(e);
  }, [S, settingsPage]);
  (0, c.useEffect)(() => {
    if (!mountQuickOptions.length) {
      mountQuickTargetId && setMountQuickTargetId("");
      return;
    }
    mountQuickOptions.some(e => e.id === mountQuickTargetId) || setMountQuickTargetId(String(mountQuickOptions[0]?.id || ""));
  }, [mountQuickOptions, mountQuickTargetId]);
  (0, c.useEffect)(() => {
    let e = T(String(N?.path || ""));
    if (!e || "/" === e) return;
    let a = quickMountFileOptions.find(a => T(String(a?.path || "")) === e);
    a && ("file" !== mountQuickKind && setMountQuickKind("file"), mountQuickTargetId !== a.id && setMountQuickTargetId(a.id));
  }, [N?.path, quickMountFileOptions, mountQuickKind, mountQuickTargetId]);
  let profileHandle = resolveCavcloudInitialUsername(eH).trim().toLowerCase(),
    publicProfileHref = buildCanonicalPublicProfileHref(profileHandle),
    profileMenuLabel = "public" === profilePublicEnabled ? "Public Profile" : "private" === profilePublicEnabled ? "Private Profile" : "Profile",
    surfaceTitle = "CavCloud Storage",
    surfaceVerified = "PREMIUM_PLUS" === resolveCavcloudPlanTier({
      tier: eK
    }),
    settingsTotalPages = 2,
    settingsPageSafe = Math.max(1, Math.min(settingsPage, settingsTotalPages)),
    openSurfaceProfile = (0, c.useCallback)(() => {
      openCanonicalPublicProfileWindow({
        href: publicProfileHref,
        fallbackHref: "/settings?tab=account"
      });
    }, [publicProfileHref]),
    logoutToAuth = (0, c.useCallback)(async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          cache: "no-store",
          credentials: "include"
        });
      } catch {}
      if ("undefined" != typeof window) {
        window.location.replace("/auth?mode=login");
        return;
      }
      l.replace("/auth?mode=login");
      try {
        l.refresh();
      } catch {}
    }, [l]),
    openPlans = (0, c.useCallback)(() => {
      l.push("/plan");
    }, [l]),
    openArcade = (0, c.useCallback)(() => {
      l.push("/cavbot-arcade");
    }, [l]),
    openSurfaceSettings = (0, c.useCallback)(() => {
      setSettingsPage(1), l2("Settings");
    }, [l2]),
    [mobileNavOpen, setMobileNavOpen] = (0, c.useState)(!1),
    [mobileSearchOpen, setMobileSearchOpen] = (0, c.useState)(!1);
  (0, c.useEffect)(() => {
    setMobileNavOpen(!1), setMobileSearchOpen(!1);
  }, [S]);
  return (0, t.jsxs)("div", {
    className: "cavcloud-root",
    "data-theme": eA,
    children: [mobileNavOpen ? t.jsx("button", {
      type: "button",
      className: "cavcloud-sideBackdrop",
      "aria-label": "Close menu",
      onClick: () => setMobileNavOpen(!1)
    }) : null, (0, t.jsxs)("aside", {
      id: "cavcloud-mobile-nav",
      className: `cavcloud-side ${mobileNavOpen ? "is-mobile-open" : ""}`,
      children: [(0, t.jsxs)("div", {
        className: "cavcloud-brand",
        children: [t.jsx(CavSurfaceSidebarBrandMenu, {
          surfaceTitle: surfaceTitle
        })]
      }), t.jsx("nav", {
        className: "cavcloud-nav",
        "aria-label": "CavCloud navigation",
        children: M.map(e => {
          let a = S === e.key || "Explore" === e.key && ("Explore" === S || "Folders" === S || "Files" === S);
          return (0, t.jsxs)("button", {
            type: "button",
            className: `cavcloud-navItem ${a ? "is-active" : ""}`,
            onClick: () => {
              l2(e.key), setMobileNavOpen(!1);
            },
            "aria-current": a ? "page" : void 0,
            children: [t.jsx(eg, {
              icon: e.icon
            }), e.label]
          }, e.key);
        })
      }), t.jsx(CavSurfaceSidebarFooter, {
        accountName: eP,
        profileMenuLabel: profileMenuLabel,
        planTier: eK,
        trialActive: eV,
        trialDaysLeft: ez,
        onOpenSettings: openSurfaceSettings,
        onOpenProfile: openSurfaceProfile,
        onOpenPlans: openPlans,
        onLogout: logoutToAuth,
        surface: "cavcloud",
        onOpenArcade: openArcade,
        cavAiSurface: "cavcloud",
        cavAiContextLabel: "CavCloud context"
      })]
    }), (0, t.jsxs)("main", {
      className: "cavcloud-main",
      children: [(0, t.jsxs)("div", {
        className: "cavcloud-top",
        children: [t.jsxs("div", {
          className: "cavcloud-title cavcloud-titleGreetingSlot",
          children: [t.jsx("button", {
            type: "button",
            className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly cavcloud-mobileHeaderBtn cavcloud-mobileMenuBtn",
            onClick: () => {
              setMobileSearchOpen(!1), setMobileNavOpen(e => !e);
            },
            "aria-label": mobileNavOpen ? "Close menu" : "Open menu",
            "aria-expanded": mobileNavOpen,
            "aria-controls": "cavcloud-mobile-nav",
            children: (0, t.jsxs)("svg", {
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
              children: [t.jsx("path", {
                d: "M4 7h16",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round"
              }), t.jsx("path", {
                d: "M4 12h16",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round"
              }), t.jsx("path", {
                d: "M4 17h16",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round"
              })]
            })
          }), t.jsx(CavSurfaceHeaderGreeting, {
            accountName: eP,
            showVerified: surfaceVerified
          })]
        }), (0, t.jsxs)("div", {
          className: "cavcloud-actions",
          children: [t.jsx("button", {
            type: "button",
            className: `cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly cavcloud-mobileHeaderBtn cavcloud-mobileSearchBtn ${mobileSearchOpen ? "is-active" : ""}`,
            onClick: () => {
              setMobileNavOpen(!1), setMobileSearchOpen(e => !e);
            },
            "aria-label": mobileSearchOpen ? "Close search" : "Open search",
            "aria-expanded": mobileSearchOpen,
            children: (0, t.jsxs)("svg", {
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
              children: [t.jsx("circle", {
                cx: "11",
                cy: "11",
                r: "6.5",
                stroke: "currentColor",
                strokeWidth: "1.9"
              }), t.jsx("path", {
                d: "M16 16l4 4",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round"
              })]
            })
          }), t.jsx("input", {
            className: "cavcloud-search",
            value: eM,
            onChange: e => eI(e.currentTarget.value),
            placeholder: iw
          }), t.jsx("button", {
            className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly",
            disabled: ew || eC,
            onClick: () => void ta(),
            "aria-label": "Refresh",
            title: "Refresh",
            children: (0, t.jsxs)("svg", {
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
              children: [t.jsx("path", {
                d: "M21 12a9 9 0 1 1-2.64-6.36",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round",
                strokeLinejoin: "round"
              }), t.jsx("path", {
                d: "M21 3v6h-6",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round",
                strokeLinejoin: "round"
              })]
            })
          }), t.jsx("button", {
            className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly cavcloud-collabLaunchBtn cavcloud-collabLaunchBtnIconOnly",
            type: "button",
            disabled: ew || eC,
            onClick: openCollabLaunchModal,
            title: "Collaboration",
            "aria-label": "Collaboration",
            children: t.jsx(s.default, {
              className: "cavcloud-collabLaunchBtnIcon",
              src: "/icons/team-svgrepo-com.svg",
              alt: "",
              width: 15,
              height: 15,
              unoptimized: !0
            })
          }), (0, t.jsxs)("button", {
            className: "cavcloud-btn cavcloud-btnPrimary cavcloud-btnUpload",
            disabled: ew || eC,
            onClick: () => lh(!0),
            children: [t.jsx("svg", {
              viewBox: "0 0 24 24",
              fill: "none",
              "aria-hidden": "true",
              children: t.jsx("path", {
                d: "M12 5v14M5 12h14",
                stroke: "currentColor",
                strokeWidth: "1.9",
                strokeLinecap: "round"
              })
            }), t.jsx("span", {
              className: "cavcloud-btnUploadLabel",
              children: "New"
            })]
          })]
        })]
      }), mobileSearchOpen ? t.jsx("div", {
        className: "cavcloud-mobileSearchPanel",
        children: t.jsx("input", {
          className: "cavcloud-search cavcloud-searchMobile",
          value: eM,
          onChange: e => eI(e.currentTarget.value),
          placeholder: iw,
          autoFocus: !0
        })
      }) : null, t.jsx("input", {
        ref: lV,
        className: "cavcloud-file",
        type: "file",
        multiple: !0,
        onChange: id
      }), t.jsx("input", {
        ref: lZ,
        className: "cavcloud-file",
        type: "file",
        multiple: !0,
        onChange: iu
      }), t.jsx("input", {
        ref: lz,
        className: "cavcloud-file",
        type: "file",
        accept: "image/*,video/*",
        capture: "environment",
        multiple: !0,
        onChange: ih
      }), (uploadsPendingCount > 0 || uploadsFailedCount > 0) && "Dashboard" !== S ? (0, t.jsxs)("div", {
        className: `cavcloud-uploadsDock ${uploadsPanelOpen ? "is-open" : ""}`,
        children: [(0, t.jsxs)("button", {
          className: `cavcloud-uploadsChip ${uploadsFailedCount > 0 ? "has-failed" : ""}`,
          type: "button",
          onClick: () => setUploadsPanelOpen(e => !e),
          children: ["Uploads", uploadsPendingCount > 0 ? ` (${uploadsPendingCount} active)` : uploadsFailedCount > 0 ? ` (${uploadsFailedCount} failed)` : ""]
        }), uploadsPanelOpen ? (0, t.jsxs)("section", {
          className: `cavcloud-uploadFailurePanel ${uploadsFailedCount > 0 ? "has-failed" : ""}`,
          children: [(0, t.jsxs)("div", {
            className: "cavcloud-uploadFailureHead",
            children: [t.jsx("strong", {
              children: "Uploads / Imports"
            }), combinedUploadFailures.length ? t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              disabled: ew || eC,
              onClick: () => void retryAllFailedUploads(),
              children: "Retry failed"
            }) : null]
          }), uploadsPendingCount > 0 ? t.jsx("div", {
            className: "cavcloud-uploadFailureMore",
            children: `Processing ${uploadsPendingCount} item${1 === uploadsPendingCount ? "" : "s"}...`
          }) : null, combinedUploadFailures.length ? t.jsx("div", {
            className: "cavcloud-uploadFailureList",
            children: combinedUploadFailures.slice(0, 8).map((e, a) => (0, t.jsxs)("div", {
              className: "cavcloud-uploadFailureItem",
              children: [t.jsx("code", {
                children: String(e?.relPath || `file-${a + 1}`)
              }), e?.errorMessage ? t.jsx("span", {
                children: String(e.errorMessage)
              }) : null]
            }, `${String(e?.sessionId || "session")}_${String(e?.fileId || a)}_${a}`))
          }) : t.jsx("div", {
            className: "cavcloud-uploadFailureMore",
            children: "No failed uploads."
          }), combinedUploadFailures.length > 8 ? t.jsx("div", {
            className: "cavcloud-uploadFailureMore",
            children: `+${combinedUploadFailures.length - 8} more`
          }) : null]
        }) : null]
      }) : null, driveDebugEnabled ? (0, t.jsxs)("section", {
        className: "cavcloud-uploadDebugPanel",
        children: [t.jsx("div", {
          className: "cavcloud-uploadDebugTitle",
          children: "Drive Debug"
        }), (0, t.jsxs)("div", {
          className: "cavcloud-uploadDebugGrid",
          children: [t.jsx("span", {
            children: `currentFolderId: ${String(driveChildren.currentFolderId || "-")}`
          }), t.jsx("span", {
            children: `listingQueryKey: ${driveChildren.listingQueryKey}`
          }), t.jsx("span", {
            children: `lastFetchAt: ${String(driveDebugLastFetchAt || "-")}`
          }), t.jsx("span", {
            children: `isFetching: ${driveChildren.isFetching ? "true" : "false"}`
          }), t.jsx("span", {
            children: `lastMutation: ${String(driveDebugLastMutation?.type || "idle")} (${String(driveDebugLastMutation?.status || "idle")})`
          }), t.jsx("span", {
            children: `optimisticCount/serverCount: ${Math.max(0, Number(driveDebugOptimisticCount || 0) || 0)} / ${Math.max(0, Number(driveDebugServerCount || 0) || 0)}`
          })]
        })]
      }) : null, uploadDebugEnabled ? (0, t.jsxs)("section", {
        className: "cavcloud-uploadDebugPanel",
        children: [t.jsx("div", {
          className: "cavcloud-uploadDebugTitle",
          children: "Upload Diagnostics"
        }), (0, t.jsxs)("div", {
          className: "cavcloud-uploadDebugGrid",
          children: [t.jsx("span", {
            children: `Session: ${String(folderUploadDiagnostics?.sessionId || "-")}`
          }), t.jsx("span", {
            children: `Discovered: ${Math.max(0, Number(folderUploadDiagnostics?.discoveredCount || 0) || 0)}`
          }), t.jsx("span", {
            children: `Manifest sent: ${Math.max(0, Number(folderUploadDiagnostics?.manifestSentCount || 0) || 0)}`
          }), t.jsx("span", {
            children: `Server created: ${Math.max(0, Number(folderUploadDiagnostics?.serverCreatedCount || 0) || 0)}`
          }), t.jsx("span", {
            children: `Uploaded: ${Math.max(0, Number(folderUploadDiagnostics?.uploadedCount || 0) || 0)}`
          }), t.jsx("span", {
            children: `Failed: ${Math.max(0, Number(folderUploadDiagnostics?.failedCount || 0) || 0)}`
          }), t.jsx("span", {
            children: `Missing: ${Math.max(0, Number(folderUploadDiagnostics?.missingCount || 0) || 0)}`
          })]
        }), Array.isArray(folderUploadDiagnostics?.failed) && folderUploadDiagnostics.failed.length ? t.jsx("div", {
          className: "cavcloud-uploadDebugFailedList",
          children: folderUploadDiagnostics.failed.slice(0, 10).map((e, a) => (0, t.jsxs)("div", {
            className: "cavcloud-uploadDebugFailedItem",
            children: [t.jsx("code", {
              children: String(e?.relPath || `failed-${a + 1}`)
            }), t.jsx("span", {
              children: String(e?.errorCode || "")
            })]
          }, `${String(e?.sessionId || "session")}_${String(e?.fileId || a)}_${a}`))
        }) : null]
      }) : null, (0, t.jsxs)("div", {
        className: `cavcloud-grid ${b && N ? "has-preview" : ""}`,
        children: [(0, t.jsxs)("section", {
          className: "cavcloud-pane",
          children: [(0, t.jsxs)("div", {
            className: "cavcloud-paneHead",
            children: [t.jsx("div", {
              className: "cavcloud-paneTitle",
              children: ik ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls",
                ref: lQ,
                children: [ss ? t.jsx("button", {
                  className: "cavcloud-folderBackBtn",
                  type: "button",
                  disabled: ew || eC || !ss,
                  onClick: () => {
                    ss && void s_(ss), aS(!1);
                  },
                  "aria-label": "Back to previous folder",
                  title: "Back",
                  children: t.jsx(s.default, {
                    className: "cavcloud-folderBackBtnIcon",
                    src: "/icons/back-svgrepo-com.svg",
                    alt: "",
                    width: 16,
                    height: 16
                  })
                }) : null, "Gallery" === S ? null : t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: cloudSection,
                  onChange: e => {
                    tSectionSelect(e.currentTarget.value), aS(!1), ax(!1), ab({});
                  },
                  "aria-label": "Choose CavCloud section",
                  children: NAV_VIEW_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), "gallery" === cloudSection ? (0, t.jsxs)("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: aj,
                  onChange: e => {
                    aN(e.currentTarget.value), ax(!1), ab({});
                  },
                  "aria-label": "Filter gallery",
                  children: [t.jsx("option", {
                    value: "all",
                    children: "Gallery"
                  }), t.jsx("option", {
                    value: "images",
                    children: "Images"
                  }), t.jsx("option", {
                    value: "videos",
                    children: "Videos"
                  })]
                }) : null, "Gallery" === S ? t.jsx("button", {
                  className: `cavcloud-galleryLayoutBtn ${aw ? "is-open" : ""}`,
                  type: "button",
                  onClick: () => aS(e => !e),
                  "aria-haspopup": "dialog",
                  "aria-expanded": aw,
                  "aria-label": "Choose layout",
                  title: "Layout",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/layout-2-svgrepo-com.svg",
                    alt: "",
                    width: 15,
                    height: 15
                  })
                }) : null, "Gallery" === S && aw ? (0, t.jsxs)("div", {
                  className: "cavcloud-galleryLayoutMenu",
                  role: "dialog",
                  "aria-modal": "false",
                  "aria-label": "Layout",
                  children: [t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuTitle",
                    children: "Layout"
                  }), t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuList",
                    children: f.map(e => (0, t.jsxs)("button", {
                      type: "button",
                      className: `cavcloud-galleryLayoutOption ${aC === e.key ? "is-active" : ""}`,
                      onClick: () => {
                        ak(e.key), aS(!1);
                      },
                      "aria-pressed": aC === e.key,
                      children: [t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionIconWrap",
                        "aria-hidden": "true",
                        children: t.jsx(s.default, {
                          className: "cavcloud-galleryLayoutOptionIcon",
                          src: e.icon,
                          alt: "",
                          width: 15,
                          height: 15
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionLabel",
                        children: e.label
                      })]
                    }, e.key))
                  })]
                }) : null]
              }) : "Shared" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls cavcloud-sharedHeadControls",
                ref: lQ,
                children: [t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: aO,
                  onChange: e => {
                    aF(e.currentTarget.value), aS(!1);
                  },
                  "aria-label": "Filter shared items",
                  children: x.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("button", {
                  className: `cavcloud-galleryLayoutBtn ${aw ? "is-open" : ""}`,
                  type: "button",
                  onClick: () => aS(e => !e),
                  "aria-haspopup": "dialog",
                  "aria-expanded": aw,
                  "aria-label": "Choose shared layout",
                  title: "Layout",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/layout-2-svgrepo-com.svg",
                    alt: "",
                    width: 15,
                    height: 15
                  })
                }), aw ? (0, t.jsxs)("div", {
                  className: "cavcloud-galleryLayoutMenu",
                  role: "dialog",
                  "aria-modal": "false",
                  "aria-label": "Layout",
                  children: [t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuTitle",
                    children: "Layout"
                  }), t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuList",
                    children: f.map(e => (0, t.jsxs)("button", {
                      type: "button",
                      className: `cavcloud-galleryLayoutOption ${aM === e.key ? "is-active" : ""}`,
                      onClick: () => {
                        aI(e.key), aS(!1);
                      },
                      "aria-pressed": aM === e.key,
                      children: [t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionIconWrap",
                        "aria-hidden": "true",
                        children: t.jsx(s.default, {
                          className: "cavcloud-galleryLayoutOptionIcon",
                          src: e.icon,
                          alt: "",
                          width: 15,
                          height: 15
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionLabel",
                        children: e.label
                      })]
                    }, e.key))
                  })]
                }) : null]
              }) : "Collab" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls cavcloud-collabHeadControls",
                ref: lQ,
                children: [t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: collabInboxFilter,
                  onChange: e => {
                    setCollabInboxFilter(e.currentTarget.value), aS(!1);
                  },
                  "aria-label": "Filter collaboration inbox",
                  children: COLLAB_FILTER_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("button", {
                  className: `cavcloud-galleryLayoutBtn ${aw ? "is-open" : ""}`,
                  type: "button",
                  onClick: () => aS(e => !e),
                  "aria-haspopup": "dialog",
                  "aria-expanded": aw,
                  "aria-label": "Choose collaboration layout",
                  title: "Layout",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/layout-2-svgrepo-com.svg",
                    alt: "",
                    width: 15,
                    height: 15
                  })
                }), aw ? (0, t.jsxs)("div", {
                  className: "cavcloud-galleryLayoutMenu",
                  role: "dialog",
                  "aria-modal": "false",
                  "aria-label": "Layout",
                  children: [t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuTitle",
                    children: "Layout"
                  }), t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuList",
                    children: f.map(e => (0, t.jsxs)("button", {
                      type: "button",
                      className: `cavcloud-galleryLayoutOption ${collabInboxLayout === e.key ? "is-active" : ""}`,
                      onClick: () => {
                        setCollabInboxLayout(e.key), aS(!1);
                      },
                      "aria-pressed": collabInboxLayout === e.key,
                      children: [t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionIconWrap",
                        "aria-hidden": "true",
                        children: t.jsx(s.default, {
                          className: "cavcloud-galleryLayoutOptionIcon",
                          src: e.icon,
                          alt: "",
                          width: 15,
                          height: 15
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionLabel",
                        children: e.label
                      })]
                    }, e.key))
                  })]
                }) : null]
              }) : "Starred" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls cavcloud-starredHeadControls",
                ref: lQ,
                children: [t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: aA,
                  onChange: e => {
                    aT(e.currentTarget.value), aS(!1);
                  },
                  "aria-label": "Filter starred items",
                  children: g.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("button", {
                  className: `cavcloud-galleryLayoutBtn ${aw ? "is-open" : ""}`,
                  type: "button",
                  onClick: () => aS(e => !e),
                  "aria-haspopup": "dialog",
                  "aria-expanded": aw,
                  "aria-label": "Choose starred layout",
                  title: "Layout",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/layout-2-svgrepo-com.svg",
                    alt: "",
                    width: 15,
                    height: 15
                  })
                }), aw ? (0, t.jsxs)("div", {
                  className: "cavcloud-galleryLayoutMenu",
                  role: "dialog",
                  "aria-modal": "false",
                  "aria-label": "Layout",
                  children: [t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuTitle",
                    children: "Layout"
                  }), t.jsx("div", {
                    className: "cavcloud-galleryLayoutMenuList",
                    children: f.map(e => (0, t.jsxs)("button", {
                      type: "button",
                      className: `cavcloud-galleryLayoutOption ${a$ === e.key ? "is-active" : ""}`,
                      onClick: () => {
                        aL(e.key), aS(!1);
                      },
                      "aria-pressed": a$ === e.key,
                      children: [t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionIconWrap",
                        "aria-hidden": "true",
                        children: t.jsx(s.default, {
                          className: "cavcloud-galleryLayoutOptionIcon",
                          src: e.icon,
                          alt: "",
                          width: 15,
                          height: 15
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-galleryLayoutOptionLabel",
                        children: e.label
                      })]
                    }, e.key))
                  })]
                }) : null]
              }) : "Recents" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls cavcloud-recentsHeadControls",
                children: [t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: recentsKind,
                  onChange: e => {
                    setRecentsKind(e.currentTarget.value), setRecentsPage(1), aS(!1);
                  },
                  "aria-label": "Filter recents by type",
                  children: RECENTS_FILTER_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: recentsTimeline,
                  onChange: e => {
                    setRecentsTimeline(e.currentTarget.value), setRecentsPage(1), aS(!1);
                  },
                  "aria-label": "Filter recents by timeline",
                  children: RECENTS_TIMELINE_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("button", {
                  className: `cavcloud-trashClearFiltersBtn ${isRecentsFiltersActive ? "is-on" : ""}`,
                  type: "button",
                  onClick: clearRecentsFilters,
                  disabled: ew || eC || !isRecentsFiltersActive,
                  "aria-label": "Clear all recents filters",
                  title: "Clear all filters",
                  children: t.jsx(s.default, {
                    className: "cavcloud-trashClearFiltersIcon",
                    src: "/icons/clear-all-svgrepo-com.svg",
                    alt: "",
                    width: 13,
                    height: 13
                  })
                })]
              }) : "Synced" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-galleryHeadControls cavcloud-syncedHeadControls",
                children: [t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: syncedSource,
                  onChange: e => {
                    setSyncedSource(e.currentTarget.value), aS(!1);
                  },
                  "aria-label": "Filter synced logs by source",
                  children: SYNC_SOURCE_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("select", {
                  className: "cavcloud-paneTitleSelect",
                  value: syncedTimeline,
                  onChange: e => {
                    setSyncedTimeline(e.currentTarget.value), aS(!1);
                  },
                  "aria-label": "Filter synced logs by timeline",
                  children: SYNC_TIMELINE_OPTIONS.map(e => t.jsx("option", {
                    value: e.key,
                    children: e.label
                  }, e.key))
                }), t.jsx("button", {
                  className: `cavcloud-trashClearFiltersBtn ${isSyncedFiltersActive ? "is-on" : ""}`,
                  type: "button",
                  onClick: clearSyncedFilters,
                  disabled: ew || eC || !isSyncedFiltersActive,
                  "aria-label": "Clear all synced filters",
                  title: "Clear all filters",
                  children: t.jsx(s.default, {
                    className: "cavcloud-trashClearFiltersIcon",
                    src: "/icons/clear-all-svgrepo-com.svg",
                    alt: "",
                    width: 13,
                    height: 13
                  })
                })]
              }) : "Trash" === S ? "restorations" === a1 ? t.jsx("span", {
                className: "cavcloud-trashSectionTitle",
                children: "Restorations"
              }) : (0, t.jsxs)("div", {
                className: "cavcloud-trashHeadControls",
                children: [(0, t.jsxs)("select", {
                  className: "cavcloud-paneTitleSelect is-trashKind",
                  value: aR,
                  onChange: e => aU(e.currentTarget.value),
                  "aria-label": "Filter recently deleted by type",
                  children: [t.jsx("option", {
                    value: "all",
                    children: "Recently deleted"
                  }), t.jsx("option", {
                    value: "folders",
                    children: "Folder"
                  }), t.jsx("option", {
                    value: "files",
                    children: "Files"
                  }), t.jsx("option", {
                    value: "images",
                    children: "Images"
                  }), t.jsx("option", {
                    value: "videos",
                    children: "Videos"
                  })]
                }), (0, t.jsxs)("select", {
                  className: "cavcloud-paneTitleSelect is-trashTimeline",
                  value: a_,
                  onChange: e => iM(e.currentTarget.value),
                  "aria-label": "Filter recently deleted by timeline",
                  children: [t.jsx("option", {
                    value: "24h",
                    children: "Last 24 hours"
                  }), t.jsx("option", {
                    value: "7d",
                    children: "Last 7 days"
                  }), t.jsx("option", {
                    value: "30d",
                    children: "Last 30 days"
                  }), t.jsx("option", {
                    value: "12m",
                    children: "Last 12 months"
                  }), t.jsx("option", {
                    value: "custom",
                    children: "Custom"
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryHeadControls cavcloud-trashLayoutControls",
                  ref: lQ,
                  children: [t.jsx("button", {
                    className: `cavcloud-trashClearFiltersBtn ${iP ? "is-on" : ""}`,
                    type: "button",
                    onClick: iI,
                    disabled: ew || eC || !iP,
                    "aria-label": "Clear all recently deleted filters",
                    title: "Clear all filters",
                    children: t.jsx(s.default, {
                      className: "cavcloud-trashClearFiltersIcon",
                      src: "/icons/clear-all-svgrepo-com.svg",
                      alt: "",
                      width: 13,
                      height: 13
                    })
                  }), t.jsx("button", {
                    className: `cavcloud-galleryLayoutBtn ${aw ? "is-open" : ""}`,
                    type: "button",
                    onClick: () => aS(e => !e),
                    "aria-haspopup": "dialog",
                    "aria-expanded": aw,
                    "aria-label": "Choose recently deleted layout",
                    title: "Layout",
                    children: t.jsx(s.default, {
                      className: "cavcloud-galleryLayoutBtnIcon",
                      src: "/icons/layout-2-svgrepo-com.svg",
                      alt: "",
                      width: 15,
                      height: 15
                    })
                  }), aw ? (0, t.jsxs)("div", {
                    className: "cavcloud-galleryLayoutMenu",
                    role: "dialog",
                    "aria-modal": "false",
                    "aria-label": "Layout",
                    children: [t.jsx("div", {
                      className: "cavcloud-galleryLayoutMenuTitle",
                      children: "Layout"
                    }), t.jsx("div", {
                      className: "cavcloud-galleryLayoutMenuList",
                      children: f.map(e => (0, t.jsxs)("button", {
                        type: "button",
                        className: `cavcloud-galleryLayoutOption ${aE === e.key ? "is-active" : ""}`,
                        onClick: () => {
                          aD(e.key), aS(!1);
                        },
                        "aria-pressed": aE === e.key,
                        children: [t.jsx("span", {
                          className: "cavcloud-galleryLayoutOptionIconWrap",
                          "aria-hidden": "true",
                          children: t.jsx(s.default, {
                            className: "cavcloud-galleryLayoutOptionIcon",
                            src: e.icon,
                            alt: "",
                            width: 15,
                            height: 15
                          })
                        }), t.jsx("span", {
                          className: "cavcloud-galleryLayoutOptionLabel",
                          children: e.label
                        })]
                      }, e.key))
                    })]
                  }) : null]
                })]
              }) : "Dashboard" === S ? null : iB
            }), t.jsx("div", {
              className: `cavcloud-paneSub ${"Trash" === S ? "cavcloud-paneSubTrash" : ""}`,
              children: "Trash" === S ? "restorations" === a1 ? (0, t.jsxs)(t.Fragment, {
                children: [t.jsx("button", {
                  className: `cavcloud-trashRestoreLogBtn ${"restorations" === a1 ? "is-on" : ""}`,
                  type: "button",
                  onClick: () => {
                    a2("trash"), aS(!1);
                  },
                  disabled: ew || eC,
                  "aria-label": "Back to recently deleted section",
                  title: "Back to recently deleted section",
                  children: t.jsx(s.default, {
                    className: "cavcloud-trashRestoreLogIcon",
                    src: "/icons/trash-bin-2-svgrepo-com.svg",
                    alt: "",
                    width: 13,
                    height: 13
                  })
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-trashRestorationFilters",
                  children: [(0, t.jsxs)("select", {
                    className: `cavcloud-paneTitleSelect is-trashKind cavcloud-restorationStatusNativeSelect ${"any" === a4 ? "is-any" : "in_progress" === a4 ? "is-in-progress" : "restored" === a4 ? "is-restored" : "queued" === a4 ? "is-queued" : "failed" === a4 ? "is-failed" : "is-canceled"}`,
                    value: a4,
                    onChange: e => a5(e.currentTarget.value),
                    "aria-label": "Filter restorations by status",
                    children: [t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-any",
                      value: "any",
                      children: "Any status"
                    }), t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-in-progress",
                      value: "in_progress",
                      children: "In progress"
                    }), t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-restored",
                      value: "restored",
                      children: "Restored"
                    }), t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-queued",
                      value: "queued",
                      children: "Queued"
                    }), t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-failed",
                      value: "failed",
                      children: "Failed"
                    }), t.jsx("option", {
                      className: "cavcloud-restorationStatusNativeOption is-canceled",
                      value: "canceled",
                      children: "Canceled"
                    })]
                  }), (0, t.jsxs)("select", {
                    className: "cavcloud-paneTitleSelect is-trashTimeline",
                    value: a3,
                    onChange: e => iT(e.currentTarget.value),
                    "aria-label": "Filter restorations by timeline",
                    children: [t.jsx("option", {
                      value: "24h",
                      children: "Last 24 hours"
                    }), t.jsx("option", {
                      value: "7d",
                      children: "Last 7 days"
                    }), t.jsx("option", {
                      value: "30d",
                      children: "Last 30 days"
                    }), t.jsx("option", {
                      value: "12m",
                      children: "Last 12 months"
                    }), t.jsx("option", {
                      value: "custom",
                      children: "Custom"
                    })]
                  })]
                }), t.jsx("span", {
                  children: i_
                })]
              }) : (0, t.jsxs)(t.Fragment, {
                children: [t.jsx("button", {
                  className: `cavcloud-trashNoticeBtn ${tm.length ? "is-on" : ""}`,
                  type: "button",
                  onClick: () => a0(!0),
                  disabled: ew || eC || !tm.length,
                  "aria-label": "Open 7-day deletion notice files",
                  title: tm.length ? `${tm.length} file${1 === tm.length ? "" : "s"} on 7-day notice` : "No files on 7-day notice",
                  children: (0, t.jsxs)("svg", {
                    viewBox: "0 0 24 24",
                    fill: "none",
                    "aria-hidden": "true",
                    children: [t.jsx("path", {
                      d: "m12 3 9 16H3l9-16Z",
                      stroke: "currentColor",
                      strokeWidth: "1.8",
                      strokeLinejoin: "round"
                    }), t.jsx("path", {
                      d: "M12 9.4v4.7m0 3.1h.01",
                      stroke: "currentColor",
                      strokeWidth: "1.8",
                      strokeLinecap: "round"
                    })]
                  })
                }), t.jsx("button", {
                  className: `cavcloud-trashRestoreLogBtn ${tv.length ? "is-on" : ""}`,
                  type: "button",
                  onClick: () => {
                    a2("restorations"), aS(!1);
                  },
                  disabled: ew || eC,
                  "aria-label": "Open restorations section",
                  title: `${tv.length} restoration${1 === tv.length ? "" : "s"}`,
                  children: t.jsx(s.default, {
                    className: "cavcloud-trashRestoreLogIcon",
                    src: "/icons/restore-16-filled-svgrepo-com.svg",
                    alt: "",
                    width: 13,
                    height: 13
                  })
                }), t.jsx("span", {
                  children: i_
                })]
              }) : "Explore" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-paneSubExplore",
                children: [t.jsx("span", {
                  className: "cavcloud-paneSubFolderName",
                  children: iB
                }), t.jsx("span", {
                  className: "cavcloud-paneSubMeta",
                  children: i_
                })]
              }) : "Synced" === S ? (0, t.jsxs)("div", {
                className: "cavcloud-paneSubSynced",
                children: [t.jsx("button", {
                  className: "cavcloud-galleryLayoutBtn",
                  type: "button",
                  onClick: () => void sW("/Synced", "folder"),
                  disabled: ew || eC,
                  "aria-label": "Open Synced folder",
                  title: "Open Synced folder",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/link-external-01-svgrepo-com.svg",
                    alt: "",
                    width: 17,
                    height: 17
                  })
                }), t.jsx("button", {
                  className: "cavcloud-galleryLayoutBtn",
                  type: "button",
                  onClick: () => void te(),
                  disabled: ew || eC,
                  "aria-label": "Refresh synced log",
                  title: "Refresh log",
                  children: t.jsx(s.default, {
                    className: "cavcloud-galleryLayoutBtnIcon",
                    src: "/icons/refresh-circle-svgrepo-com.svg",
                    alt: "",
                    width: 17,
                    height: 17
                  })
                }), t.jsx("span", {
                  children: i_
                })]
              }) : i_
            })]
          }), tN && ag && sr > 0 ? "Shared" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-bulkBar cavcloud-bulkBarShared",
            children: [t.jsx("button", {
              className: `cavcloud-rowAction is-icon cavcloud-bulkSelectVisibleBtn ${sd ? "is-on" : ""}`,
              type: "button",
              disabled: ew || eC || !t1.length,
              onClick: sC,
              "aria-label": sd ? "Clear visible selection" : "Select visible items",
              title: sd ? "Clear visible" : "Select visible",
              children: t.jsx(s.default, {
                className: "cavcloud-bulkSelectVisibleIcon",
                src: sd ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg",
                alt: "",
                width: 16,
                height: 16
              })
            }), (0, t.jsxs)("span", {
              className: "cavcloud-bulkCount",
              children: [sr, " selected"]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-trashMenuWrap",
              ref: "bulk_shared" === lP ? l1 : void 0,
              children: [t.jsx("button", {
                className: "cavcloud-rowAction is-icon cavcloud-galleryMoreBtn",
                type: "button",
                disabled: ew || eC || 0 === sr,
                onClick: () => lB(e => "bulk_shared" === e ? "" : "bulk_shared"),
                "aria-label": "Selected shared item actions",
                title: "Selected shared item actions",
                children: (0, t.jsxs)("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: [t.jsx("circle", {
                    cx: "5.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "18.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  })]
                })
              }), "bulk_shared" === lP ? (0, t.jsxs)("div", {
                className: "cavcloud-trashActionMenu",
                role: "menu",
                "aria-label": "Actions for selected shared items",
                children: [t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sp.length,
                  onClick: () => {
                    lB(""), void sA();
                  },
                  children: "Copy links"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sg.length,
                  onClick: () => {
                    lB(""), sT();
                  },
                  children: "Download"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem is-danger",
                  type: "button",
                  disabled: ew || eC || 0 === sf.length,
                  onClick: () => {
                    lB(""), void sO("delete");
                  },
                  children: "Delete"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sf.length,
                  onClick: () => {
                    lB(""), void sO("unshare");
                  },
                  children: "Unshare"
                })]
              }) : null]
            })]
          }) : (0, t.jsxs)("div", {
            className: "cavcloud-bulkBar",
            children: [t.jsx("button", {
              className: `cavcloud-rowAction is-icon cavcloud-bulkSelectVisibleBtn ${sd ? "is-on" : ""}`,
              type: "button",
              disabled: ew || eC || !t1.length,
              onClick: sC,
              "aria-label": sd ? "Clear visible selection" : "Select visible items",
              title: sd ? "Clear visible" : "Select visible",
              children: t.jsx(s.default, {
                className: "cavcloud-bulkSelectVisibleIcon",
                src: sd ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg",
                alt: "",
                width: 16,
                height: 16
              })
            }), (0, t.jsxs)("span", {
              className: "cavcloud-bulkCount",
              children: [sr, " selected"]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-trashMenuWrap",
              ref: "bulk_general" === lP ? l1 : void 0,
              children: [t.jsx("button", {
                className: "cavcloud-rowAction is-icon cavcloud-galleryMoreBtn",
                type: "button",
                disabled: ew || eC || 0 === sr,
                onClick: () => lB(e => "bulk_general" === e ? "" : "bulk_general"),
                "aria-label": "Selected item actions",
                title: "Selected item actions",
                children: (0, t.jsxs)("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: [t.jsx("circle", {
                    cx: "5.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  }), t.jsx("circle", {
                    cx: "18.5",
                    cy: "12",
                    r: "1.8",
                    fill: "currentColor"
                  })]
                })
              }), "bulk_general" === lP ? (0, t.jsxs)("div", {
                className: "cavcloud-trashActionMenu",
                role: "menu",
                "aria-label": "Actions for selected items",
                children: "Starred" === S ? [t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sStarSel.length,
                  onClick: () => {
                    lB(""), void sStarOpen();
                  },
                  children: "Open location"
                }, "starred_open"), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem is-danger",
                  type: "button",
                  disabled: ew || 0 === sStarSel.length,
                  onClick: () => {
                    lB(""), void sStarRemove();
                  },
                  children: "Remove from Starred"
                }, "starred_remove")] : "Trash" === S ? [t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sTrashSel.length,
                  onClick: () => {
                    lB(""), void sTrashOpen();
                  },
                  children: "Open path"
                }, "trash_open"), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || 0 === sTrashSel.length,
                  onClick: () => {
                    lB(""), void sTrashRestore();
                  },
                  children: "Restore"
                }, "trash_restore"), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem is-danger",
                  type: "button",
                  disabled: ew || 0 === sTrashSel.length,
                  onClick: () => {
                    lB(""), void sTrashRemove();
                  },
                  children: "Remove from CavCloud"
                }, "trash_remove")] : [t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    lB(""), void sw();
                  },
                  children: "Move"
                }), isOwner ? t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sr || !canMoveToCavSafe,
                  onClick: () => {
                    lB(""), void sMoveToCavSafe();
                  },
                  children: "Move to CavSafe"
                }) : null, t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 1 !== sr,
                  onClick: () => {
                    lB(""), void sD();
                  },
                  children: "Rename"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 1 !== sr,
                  onClick: () => {
                    lB(""), iPublish();
                  },
                  children: "Publish to Artifacts"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    lB(""), void s$();
                  },
                  children: su ? "Unstar" : "Star"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    lB(""), void sL();
                  },
                  children: "Download"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || mountBusy || 1 !== sr || !canUseMountFeature,
                  onClick: () => {
                    lB(""), void openMountRunModal();
                  },
                  children: "Mount + Run"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem is-cavbot-blue",
                  type: "button",
                  disabled: ew || eC || 1 !== sr,
                  onClick: () => {
                    lB(""), void sShareSelected();
                  },
                  children: "Share"
                }), t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem is-danger",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    lB(""), lS("delete");
                  },
                  children: "Delete"
                })]
              }) : null]
            })]
          }) : null, e$ ? t.jsx("div", {
            className: "cavcloud-empty",
            children: e$
          }) : null, "Dashboard" === S ? t.jsx(CavCloudOperationalDashboard, {
            refreshNonce: dashboardRefreshNonce,
            isActive: "Dashboard" === S,
            isBusy: ew || eC,
            uploadsPendingCount: uploadsPendingCount,
            uploadsFailedCount: uploadsFailedCount,
            folderUploadDiagnostics: folderUploadDiagnostics,
            folderUploadFailures: combinedUploadFailures,
            uploadingFiles: (Array.isArray(en?.files) ? en.files : []).filter(e => "UPLOADING" === String(e?.status || "").trim().toUpperCase()),
            onOpenSection: e => l2(e),
            onJumpToFolderPath: e => void s_(e),
            onOpenFileById: (e, a) => void openDashboardFileById(e, a),
            onOpenArtifacts: openArtifactsSurface,
            onRetryAllFailed: () => void retryAllFailedUploads(),
            onRetryFailedItem: e => void retrySingleUploadFailure(e),
            onCancelFailedItem: e => cancelUploadFailure(e)
          }) : "Trash" === S ? "restorations" === a1 ? (0, t.jsxs)("div", {
            className: "cavcloud-list cavcloud-trashList",
            children: [tg.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No restorations yet."
            }), tg.map(e => {
              let a = T(e.targetPath || "/"),
                l = "folder" === String(e.targetType || "").toLowerCase() ? "folder" : "file",
                s = "folder" === l ? a : eh(a),
                i = D(e),
                r = _(i),
                c = a.split("/").filter(Boolean).pop() || a;
              return (0, t.jsxs)("div", {
                className: "cavcloud-row cavcloud-trashRestorationRow",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-rowName",
                  children: [t.jsx(ej, {
                    item: {
                      kind: l,
                      name: c,
                      path: a
                    }
                  }), (0, t.jsxs)("div", {
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: "folder" === l ? "Folder restored" : "File restored"
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      children: [t.jsx("span", {
                        children: F(a)
                      }), t.jsx("span", {
                        "aria-hidden": "true",
                        children: "•"
                      }), (0, t.jsxs)("span", {
                        className: "cavcloud-restorationStatus",
                        "data-status": i,
                        children: [t.jsx("span", {
                          className: "cavcloud-restorationStatusDot",
                          "aria-hidden": "true"
                        }), r]
                      })]
                    })]
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-rowMeta",
                  children: B(e.createdAtISO)
                }), t.jsx("div", {
                  className: "cavcloud-rowMeta",
                  children: t.jsx("button", {
                    className: "cavcloud-rowAction",
                    disabled: ew || eC,
                    onClick: () => void sW(s, "folder"),
                    children: "Open path"
                  })
                })]
              }, e.id);
            })]
          }) : t.jsx("div", {
            className: `cavcloud-galleryGrid cavcloud-trashGrid cavcloud-trashList ${iD}`,
            children: th.length ? th.map(e => {
              let a = Y(e),
                l = a ? `/api/cavcloud/trash/${encodeURIComponent(e.id)}?raw=1` : "",
                s = b && u === e.id,
                i = !!tG(e),
                r = "folder" === e.kind ? "Folder" : "image" === a ? "Image" : "video" === a ? "Video" : "File",
                d = "file" === e.kind && e.targetId ? tE.get(e.targetId) : null,
                n = d ? String(d.previewSnippet || "") : String(snippetByFileId[e.targetId || ""] || ""),
                h = String(d?.mimeType || ""),
                c = {
                  id: e.id,
                  kind: e.kind,
                  name: e.name,
                  path: e.path
                },
                o = !!ay[K(e.kind, e.id)];
              return (0, t.jsxs)("article", {
                className: `cavcloud-galleryCard cavcloud-trashCard ${o ? "is-selected" : ""} ${s ? "is-preview-selected" : ""}`,
                children: [(0, t.jsxs)("button", {
                  className: `cavcloud-galleryFrame cavcloud-galleryOpen ${ag ? "is-selecting" : ""}`,
                  "data-desktop-select-item": "true",
                  type: "button",
                  disabled: ew || eC,
                  onClick: a => {
                    a.detail <= 1 && sN(c, a);
                  },
                  onDoubleClick: () => {
                    s8(e) || sW(eh(e.path), "folder");
                  },
                  "aria-label": `Select ${e.name}. Double-click to ${i ? "preview" : "open location"}.`,
                  title: `Select ${e.name}. Double-click to ${i ? "preview" : "open location"}.`,
                  children: [l && "image" === a ? t.jsx("img", {
                    className: "cavcloud-galleryMedia",
                    src: l,
                    alt: e.name,
                    loading: "lazy"
                  }) : null, l && "video" === a ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: l,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0
                  }) : null, l ? null : (0, t.jsxs)("div", {
                    className: `cavcloud-galleryPlaceholder cavcloud-sharedPlaceholder ${"folder" === e.kind ? "is-folder" : "is-file"}`,
                    children: [t.jsx("span", {
                      className: `cavcloud-sharedPlaceholderIcon ${"folder" === e.kind ? "is-folder" : "is-file"}`,
                      "aria-hidden": "true",
                      children: "folder" === e.kind ? t.jsx(ex, {}) : "image" === a || "video" === a ? t.jsx(eb, {
                        kind: a
                      }) : t.jsx(eDocThumb, {
                        variant: "shared",
                        name: e.name,
                        mimeType: h,
                        snippet: n
                      })
                    }), t.jsx("span", {
                      children: r
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryUnderImage cavcloud-trashUnderImage",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-galleryMeta",
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: "file" === e.kind ? displayCavcloudFileName(e.name, cavcloudSettings.showExtensions) : e.name
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      children: [F(e.path), " • ", r.toLowerCase(), " • ", ec(e.purgeAfterISO), " days left"]
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      children: ["Deleted ", B(e.deletedAtISO)]
                    })]
                  })]
                })]
              }, e.id);
            }) : t.jsx("div", {
              className: "cavcloud-empty",
              children: "folders" === aR ? "No folders in recently deleted." : "files" === aR ? "No files in recently deleted." : "images" === aR ? "No images in recently deleted." : "videos" === aR ? "No videos in recently deleted." : "Recently deleted is empty."
            })
          }) : "Recents" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-list",
            children: [tB.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No activity yet."
            }), tRecentPageItems.map(e => {
              let a = E(e),
                l = eRecentTargetKind(e),
                s = eRecentTargetPath(e),
                i = s.split("/").filter(Boolean).pop() || eFirstActivityFileName(e.metaJson) || a.label,
                r = "file" === l ? e.targetId ? tE.get(e.targetId) || tD.get(s) : tD.get(s) : null,
                c = "file" === l ? r ? tW(r) : tH({
                  path: s,
                  name: i,
                  createdAtISO: e.createdAtISO,
                  modifiedAtISO: e.createdAtISO
                }) : null,
                o = "file" === l ? c?.mediaKind || ea("", i) : null,
                d = o ? String(c?.rawSrc || `/api/cavcloud/files/by-path?path=${encodeURIComponent(s)}&raw=1`).trim() : "",
                n = b && c && u === c.id;
              return (0, t.jsxs)("div", {
                className: `cavcloud-row ${n ? "is-preview-selected" : ""}`,
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-rowName",
                  children: [t.jsx(ej, {
                    item: {
                      kind: l,
                      name: i,
                      path: s,
                      mimeType: r?.mimeType || "",
                      previewSnippet: r?.previewSnippet || ""
                    },
                    mediaKind: o,
                    previewUrl: d,
                    mimeType: r?.mimeType || "",
                    snippet: r?.id ? String(r.previewSnippet || snippetByFileId[r.id] || "") : String(r?.previewSnippet || "")
                  }), (0, t.jsxs)("div", {
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: a.label
                    }), t.jsx("div", {
                      className: "cavcloud-fileMeta",
                      children: a.meta
                    })]
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-rowMeta",
                  children: B(e.createdAtISO)
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-rowMeta",
                  children: [c ? t.jsx("button", {
                    className: "cavcloud-recentsPreviewBtn",
                    type: "button",
                    disabled: ew || eC,
                    onClick: () => void s9(e),
                    "aria-label": "Preview",
                    title: "Preview",
                    children: t.jsx("img", {
                      src: "/icons/preview-link-svgrepo-com.svg",
                      alt: "",
                      "aria-hidden": "true",
                      width: 16,
                      height: 16
                    })
                  }) : null, t.jsx("button", {
                    className: "cavcloud-recentsOpenLocationBtn",
                    type: "button",
                    disabled: ew || eC,
                    onClick: () => void sW(s, l),
                    "aria-label": "Open location",
                    title: "Open location",
                    children: t.jsx("img", {
                      src: "/icons/view-alt-1-svgrepo-com.svg",
                      alt: "",
                      "aria-hidden": "true",
                      width: 16,
                      height: 16
                    })
                  })]
                })]
              }, e.id);
            }), tB.length > CAVCLOUD_RECENTS_PAGE_SIZE ? (0, t.jsxs)("nav", {
              className: "cavcloud-recentsPager cavcloud-galleryPager",
              role: "navigation",
              "aria-label": "Recents pagination",
              children: [t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || tRecentPageSafe <= 1,
                onClick: () => setRecentsPage(Math.max(1, tRecentPageSafe - 1)),
                "aria-label": "Go to previous page",
                title: "Previous page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M14.5 6.5 9 12l5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              }), t.jsx("div", {
                className: "cavcloud-galleryPagerNumbers",
                role: "group",
                "aria-label": `Page ${tRecentPageSafe} of ${tRecentTotalPages}`,
                children: tRecentPageTokens.map(e => "number" === typeof e ? t.jsx("button", {
                  className: `cavcloud-recentsPagerBtn cavcloud-galleryPagerBtnNum ${e === tRecentPageSafe ? "is-active" : ""}`,
                  type: "button",
                  disabled: ew,
                  onClick: () => setRecentsPage(e),
                  "aria-label": e === tRecentPageSafe ? `Page ${e}, current page` : `Go to page ${e}`,
                  "aria-current": e === tRecentPageSafe ? "page" : void 0,
                  children: e
                }, `recents-page-${e}`) : t.jsx("span", {
                  className: "cavcloud-galleryPagerEllipsis",
                  "aria-hidden": "true",
                  children: "..."
                }, `recents-page-${e}`))
              }), t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || tRecentPageSafe >= tRecentTotalPages,
                onClick: () => setRecentsPage(Math.min(tRecentTotalPages, tRecentPageSafe + 1)),
                "aria-label": "Go to next page",
                title: "Next page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M9.5 6.5 15 12l-5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              })]
            }) : null]
          }) : "Synced" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-list cavcloud-syncedLog",
            children: [am ? t.jsx("div", {
              className: "cavcloud-empty",
              children: am
            }) : null, (0, t.jsxs)(t.Fragment, {
              children: [(0, t.jsxs)("section", {
                className: "cavcloud-syncedHero",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-syncedKpis",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-syncedKpi",
                    children: [t.jsx("span", {
                      className: "cavcloud-syncedKpiLabel",
                      children: "Visible Logs"
                    }), t.jsx("strong", {
                      className: "cavcloud-syncedKpiValue",
                      children: tSyncedCounts.total
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-syncedKpi",
                    children: [t.jsx("span", {
                      className: "cavcloud-syncedKpiLabel",
                      children: "CavPad Records"
                    }), t.jsx("strong", {
                      className: "cavcloud-syncedKpiValue",
                      children: tSyncedCounts.cavpad
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-syncedKpi",
                    children: [t.jsx("span", {
                      className: "cavcloud-syncedKpiLabel",
                      children: "CavCode Records"
                    }), t.jsx("strong", {
                      className: "cavcloud-syncedKpiValue",
                      children: tSyncedCounts.cavcode
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-syncedKpi",
                    children: [t.jsx("span", {
                      className: "cavcloud-syncedKpiLabel",
                      children: "Last Log Update"
                    }), t.jsx("strong", {
                      className: "cavcloud-syncedKpiValue",
                      children: tSyncedCounts.lastISO ? B(tSyncedCounts.lastISO) : "—"
                    })]
                  })]
                })]
              }), tSyncedScoped.length ? t.jsx("section", {
                className: "cavcloud-syncedTimeline",
                children: tSyncedScoped.map(e => {
                  let a = `sync_log:${e.file.id}`,
                    l = b && u === e.file.id;
                  return (0, t.jsxs)("article", {
                    className: `cavcloud-syncedEvent ${l ? "is-preview-selected" : ""}`,
                    children: [t.jsx("button", {
                      type: "button",
                      className: "cavcloud-syncedEventMain",
                      disabled: ew || eC,
                      onClick: () => void (e.isFileAvailable ? s5(e.file, !1) : sW(e.file.path, "file")),
                      title: e.file.path,
                      "aria-label": e.isFileAvailable ? `Open preview for ${e.file.name}` : `Open location for ${e.file.name}`,
                      children: [t.jsx("span", {
                        className: `cavcloud-syncedSourceBadge ${"cavpad" === e.source ? "is-cavpad" : "is-cavcode"}`,
                        role: "img",
                        "aria-label": "cavpad" === e.source ? "CavPad sync source" : "CavCode sync source",
                        title: "cavpad" === e.source ? "CavPad sync source" : "CavCode sync source"
                      }), (0, t.jsxs)("span", {
                        className: "cavcloud-syncedEventBody",
                        children: [t.jsx("span", {
                          className: "cavcloud-syncedEventTitle",
                          children: e.file.name
                        }), t.jsx("span", {
                          className: "cavcloud-syncedEventMeta",
                          children: `${e.actionLabel} • ${e.metaLabel}`
                        })]
                      })]
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-syncedEventSide",
                      children: [t.jsx("span", {
                        className: `cavcloud-syncedStateIcon is-${e.status}`,
                        role: "img",
                        "aria-label": e.statusLabel,
                        title: e.statusLabel,
                        children: "loading" === e.status ? t.jsx("span", {
                          className: "cavcloud-syncedStateSpinner",
                          "aria-hidden": "true"
                        }) : "failed" === e.status ? t.jsx("svg", {
                          viewBox: "0 0 24 24",
                          fill: "none",
                          "aria-hidden": "true",
                          children: t.jsx("path", {
                            d: "M7 7l10 10M17 7 7 17",
                            stroke: "currentColor",
                            strokeWidth: "2.1",
                            strokeLinecap: "round"
                          })
                        }) : t.jsx("svg", {
                          viewBox: "0 0 24 24",
                          fill: "none",
                          "aria-hidden": "true",
                          children: t.jsx("path", {
                            d: "m6.8 12.6 3.4 3.5 7-7.2",
                            stroke: "currentColor",
                            strokeWidth: "2.1",
                            strokeLinecap: "round",
                            strokeLinejoin: "round"
                          })
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-syncedEventTime",
                        children: B(e.timeISO || e.file.updatedAtISO)
                      }), (0, t.jsxs)("div", {
                        className: "cavcloud-trashMenuWrap",
                        ref: a === lP ? l1 : void 0,
                        children: [t.jsx("button", {
                          className: "cavcloud-rowAction is-icon cavcloud-galleryMoreBtn cavcloud-syncedEventMenuBtn",
                          type: "button",
                          disabled: ew || eC,
                          onClick: () => lB(e => a === e ? "" : a),
                          "aria-label": `Actions for ${e.file.name}`,
                          title: "Actions",
                          children: (0, t.jsxs)("svg", {
                            viewBox: "0 0 24 24",
                            fill: "none",
                            "aria-hidden": "true",
                            children: [t.jsx("circle", {
                              cx: "5.5",
                              cy: "12",
                              r: "1.8",
                              fill: "currentColor"
                            }), t.jsx("circle", {
                              cx: "12",
                              cy: "12",
                              r: "1.8",
                              fill: "currentColor"
                            }), t.jsx("circle", {
                              cx: "18.5",
                              cy: "12",
                              r: "1.8",
                              fill: "currentColor"
                            })]
                          })
                        }), a === lP ? (0, t.jsxs)("div", {
                          className: "cavcloud-trashActionMenu",
                          role: "menu",
                          "aria-label": `Actions for ${e.file.name}`,
                          children: [t.jsx("button", {
                            className: "cavcloud-trashActionMenuItem",
                            type: "button",
                            disabled: ew || eC || !e.isFileAvailable,
                            onClick: () => {
                              lB(""), void s5(e.file, !1);
                            },
                            children: "Modify"
                          }), t.jsx("button", {
                            className: "cavcloud-trashActionMenuItem",
                            type: "button",
                            disabled: ew || eC || !e.isFileAvailable,
                            onClick: () => {
                              lB(""), void sSyncMove(e.file);
                            },
                            children: "Move"
                          }), isOwner ? t.jsx("button", {
                            className: "cavcloud-trashActionMenuItem",
                            type: "button",
                            disabled: ew || eC || !e.isFileAvailable || !canMoveToCavSafe,
                            onClick: () => {
                              lB(""), sX(e.file);
                            },
                            children: "Move to CavSafe"
                          }) : null]
                        }) : null]
                      })]
                    })]
                  }, e.id);
                })
              }) : t.jsx("div", {
                className: "cavcloud-empty cavcloud-syncedEmpty",
                children: "No sync history yet. Files synced from CavPad or CavCode will appear here."
              }), (0, t.jsxs)("section", {
                className: "cavcloud-syncedGraphCard",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-syncedGraphHead",
                  children: [(0, t.jsxs)("div", {
                    children: [t.jsx("h3", {
                      className: "cavcloud-syncedGraphTitle",
                      children: "Sync comparison"
                    }), t.jsx("p", {
                      className: "cavcloud-syncedGraphSub",
                      children: `${tSyncedTimelineLabel} of synchronized updates${"all" === syncedSource ? "" : ` (${tSyncedSourceLabel})`}`
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-syncedGraphLegend",
                    children: [(0, t.jsxs)("span", {
                      className: "cavcloud-syncedLegendItem is-cavpad",
                      children: [t.jsx("span", {
                        className: "cavcloud-syncedLegendDot"
                      }), "CavPad ", t.jsx("strong", {
                        children: tSyncedChart.cavpadTotal
                      })]
                    }), (0, t.jsxs)("span", {
                      className: "cavcloud-syncedLegendItem is-cavcode",
                      children: [t.jsx("span", {
                        className: "cavcloud-syncedLegendDot"
                      }), "CavCode ", t.jsx("strong", {
                        children: tSyncedChart.cavcodeTotal
                      })]
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-syncedGraphWrap",
                  children: [t.jsx("svg", {
                    className: "cavcloud-syncedGraph",
                    viewBox: `0 0 ${tSyncedChart.width} ${tSyncedChart.height}`,
                    role: "img",
                    "aria-label": "CavPad and CavCode sync grouped bar chart",
                    children: [(0, t.jsxs)("g", {
                      className: "cavcloud-syncedGraphLanes",
                      children: tSyncedChart.groups.map((e, a) => t.jsx("rect", {
                        className: 0 === a % 2 ? "is-even" : "is-odd",
                        x: e.slotX + 1,
                        y: tSyncedChart.top,
                        width: Math.max(0, e.slotWidth - 2),
                        height: tSyncedChart.bottom - tSyncedChart.top,
                        rx: "3.2",
                        ry: "3.2"
                      }, `lane_${e.ts}_${a}`))
                    }), (0, t.jsxs)("g", {
                      className: "cavcloud-syncedGraphGrid",
                      children: [tSyncedChart.ticks.map((e, a) => t.jsx("line", {
                        x1: tSyncedChart.left,
                        x2: tSyncedChart.width - tSyncedChart.right,
                        y1: e.y,
                        y2: e.y
                      }, `line_${a}`)), tSyncedChart.ticks.map((e, a) => t.jsx("text", {
                        x: tSyncedChart.left - 6,
                        y: e.y + 4,
                        textAnchor: "end",
                        children: e.value
                      }, `tick_${a}`)), t.jsx("line", {
                        className: "cavcloud-syncedGraphBaseline",
                        x1: tSyncedChart.left,
                        x2: tSyncedChart.width - tSyncedChart.right,
                        y1: tSyncedChart.bottom,
                        y2: tSyncedChart.bottom
                      })]
                    }), t.jsx("g", {
                      className: "cavcloud-syncedBars",
                      children: tSyncedChart.bars.map(e => t.jsx("rect", {
                        className: `cavcloud-syncedBar is-${e.source}`,
                        x: e.x,
                        y: e.y,
                        width: e.width,
                        height: e.height,
                        rx: e.radius,
                        ry: e.radius,
                        children: t.jsx("title", {
                          children: `${"cavpad" === e.source ? "CavPad" : "CavCode"} • ${e.value} • ${e.label}`
                        })
                      }, e.id))
                    }), t.jsx("g", {
                      className: "cavcloud-syncedBarMarkers",
                      children: tSyncedChart.markers.map(e => t.jsx("circle", {
                        className: `cavcloud-syncedBarMarker is-${e.source}`,
                        cx: e.cx,
                        cy: e.cy,
                        r: e.r
                      }, e.id))
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-syncedXAxis",
                    style: {
                      gridTemplateColumns: `repeat(${Math.max(1, tSyncedChart.points.length)}, minmax(0, 1fr))`
                    },
                    children: tSyncedChart.points.map((e, a) => t.jsx("span", {
                      children: 0 === a % tSyncedChart.labelStep || a === tSyncedChart.points.length - 1 ? e.label : ""
                    }, `${e.ts}_${a}`))
                  })]
                })]
              })]
            })]
          }) : "Folders" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-list",
            children: [ts.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No folders yet."
            }), ts.length ? iW : null]
          }) : "Gallery" === S ? (0, t.jsxs)("div", {
            className: `cavcloud-galleryGrid ${iR}`,
            children: [td.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "images" === aj ? "No images yet." : "videos" === aj ? "No videos yet." : "mobile" === aj ? "No mobile uploads yet." : "No photos or videos yet."
            }), galleryPageItems.map(e => {
              let a = Q(e),
                l = ap[e.id] || (a ? `/api/cavcloud/files/${encodeURIComponent(e.id)}?raw=1` : ""),
                s = !!ay[K("file", e.id)],
                i = b && u === e.id,
                r = sn.has(`file:${T(e.path)}`),
                o = !!deletingVisualKeys[K("file", e.id)],
                hShared = Math.max(0, Math.trunc(Number(e?.sharedUserCount || 0)) || 0),
                mCollab = !!e?.collaborationEnabled,
                c = {
                  id: e.id,
                  kind: "file",
                  name: e.name,
                  path: e.path
                };
              return (0, t.jsxs)("article", {
                className: `cavcloud-galleryCard ${s ? "is-selected" : ""} ${i ? "is-preview-selected" : ""} ${o ? "is-deleting" : ""}`,
                children: [(0, t.jsxs)("button", {
                  className: `cavcloud-galleryFrame cavcloud-galleryOpen ${ag ? "is-selecting" : ""}`,
                  "data-desktop-select-item": "true",
                  type: "button",
                  disabled: ew,
                  onClick: e => {
                    e.detail <= 1 && sN(c, e);
                  },
                  onDoubleClick: () => {
                    s3(e) || s5(e, !1);
                  },
                  "aria-label": `Select ${e.name}. Double-click to open.`,
                  title: `Select ${e.name}. Double-click to open.`,
                  children: [t.jsx(eCollabBadge, {
                    sharedUserCount: hShared,
                    collaborationEnabled: mCollab
                  }), r ? t.jsx("span", {
                    className: "cavcloud-cardStarCorner",
                    role: "img",
                    "aria-label": "Starred",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: t.jsx("path", {
                        d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                        fill: "currentColor"
                      })
                    })
                  }) : null, l && "image" === a ? t.jsx("img", {
                    className: "cavcloud-galleryMedia",
                    src: l,
                    alt: e.name,
                    loading: "lazy",
                    onError: a => {
                      if ("1" === a.currentTarget.dataset.fallback) return;
                      a.currentTarget.dataset.fallback = "1", a.currentTarget.src = `/api/cavcloud/files/by-path?path=${encodeURIComponent(e.path)}&raw=1`;
                    }
                  }) : null, l && "video" === a ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: l,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0,
                    onError: a => {
                      if ("1" === a.currentTarget.dataset.fallback) return;
                      a.currentTarget.dataset.fallback = "1", a.currentTarget.src = `/api/cavcloud/files/by-path?path=${encodeURIComponent(e.path)}&raw=1`, a.currentTarget.load();
                    }
                  }) : null, l ? null : t.jsx("div", {
                    className: "cavcloud-galleryPlaceholder",
                    children: "video" === a ? "Video preview loading…" : "Image preview loading…"
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryUnderImage",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-galleryMeta",
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: displayCavcloudFileName(e.name, cavcloudSettings.showExtensions)
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      children: ["video" === a ? "Video" : "Photo", " • ", P(e.bytes)]
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-galleryActionsRight",
                    children: r ? t.jsx("span", {
                      className: "cavcloud-galleryStarBadge",
                      role: "img",
                      "aria-label": "Starred",
                      children: t.jsx("svg", {
                        viewBox: "0 0 24 24",
                        fill: "none",
                        "aria-hidden": "true",
                        children: t.jsx("path", {
                          d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                          fill: "currentColor"
                        })
                      })
                    }) : null
                  })]
                })]
              }, e.id);
            }), td.length > CAVCLOUD_GALLERY_PAGE_SIZE ? (0, t.jsxs)("nav", {
              className: "cavcloud-recentsPager cavcloud-galleryPager",
              role: "navigation",
              "aria-label": "Gallery pagination",
              children: [t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || galleryPageSafe <= 1,
                onClick: () => setGalleryPage(Math.max(1, galleryPageSafe - 1)),
                "aria-label": "Go to previous page",
                title: "Previous page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M14.5 6.5 9 12l5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              }), t.jsx("div", {
                className: "cavcloud-galleryPagerNumbers",
                role: "group",
                "aria-label": `Page ${galleryPageSafe} of ${galleryTotalPages}`,
                children: galleryPageTokens.map(e => "number" === typeof e ? t.jsx("button", {
                  className: `cavcloud-recentsPagerBtn cavcloud-galleryPagerBtnNum ${e === galleryPageSafe ? "is-active" : ""}`,
                  type: "button",
                  disabled: ew,
                  onClick: () => setGalleryPage(e),
                  "aria-label": e === galleryPageSafe ? `Page ${e}, current page` : `Go to page ${e}`,
                  "aria-current": e === galleryPageSafe ? "page" : void 0,
                  children: e
                }, `gallery-page-${e}`) : t.jsx("span", {
                  className: "cavcloud-galleryPagerEllipsis",
                  "aria-hidden": "true",
                  children: "..."
                }, `gallery-page-${e}`))
              }), t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || galleryPageSafe >= galleryTotalPages,
                onClick: () => setGalleryPage(Math.min(galleryTotalPages, galleryPageSafe + 1)),
                "aria-label": "Go to next page",
                title: "Next page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M9.5 6.5 15 12l-5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              })]
            }) : null]
          }) : "Files" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-list",
            children: [tx.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No files yet."
            }), tx.length ? iX : null]
          }) : "Starred" === S ? (0, t.jsxs)("div", {
            className: `cavcloud-galleryGrid cavcloud-starredGrid ${iE}`,
            children: [tz.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: t5
            }), tz.map(e => {
              let a = "file" === e.targetType && e.targetId ? tE.get(e.targetId) : void 0,
                l = a?.name || Z(e.path) || e.path,
                s = X(e, tE),
                i = "file" === e.targetType && s ? e.targetId ? `/api/cavcloud/files/${encodeURIComponent(e.targetId)}?raw=1` : `/api/cavcloud/files/by-path?path=${encodeURIComponent(e.path)}&raw=1` : "",
                r = "folder" === e.targetType ? "Folder" : "image" === s ? "Image" : "video" === s ? "Video" : "File",
                c = F(e.path),
                o = `${r} • Starred ${B(e.createdAtISO)}`,
                d = `${e.targetType}:${T(e.path)}`,
                n = tJ(e),
                h = b && u === (n?.id || d),
                m = e.targetId || `path:${T(e.path)}`,
                yShared = Math.max(0, Math.trunc(Number(a?.sharedUserCount || 0)) || 0),
                gCollab = !!a?.collaborationEnabled,
                v = {
                  id: m,
                  kind: e.targetType,
                  name: l,
                  path: e.path
                },
                p = !!ay[K(e.targetType, m)];
              return (0, t.jsxs)("article", {
                className: `cavcloud-galleryCard cavcloud-starredCard ${p ? "is-selected" : ""} ${h ? "is-preview-selected" : ""}`,
                children: [(0, t.jsxs)("button", {
                  className: `cavcloud-galleryFrame cavcloud-galleryOpen ${ag ? "is-selecting" : ""}`,
                  "data-desktop-select-item": "true",
                  type: "button",
                  disabled: ew || eC,
                  onClick: a => {
                    a.detail <= 1 && sN(v, a);
                  },
                  onDoubleClick: () => {
                    s7(e) || sW(e.path, e.targetType);
                  },
                  "aria-label": `Select ${l}. Double-click to ${n ? "preview" : "open location"}.`,
                  title: `Select ${l}. Double-click to ${n ? "preview" : "open location"}.`,
                  children: [t.jsx(eCollabBadge, {
                    sharedUserCount: yShared,
                    collaborationEnabled: gCollab
                  }), "file" === e.targetType ? t.jsx("span", {
                    className: "cavcloud-cardStarCorner",
                    role: "img",
                    "aria-label": "Starred",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: t.jsx("path", {
                        d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                        fill: "currentColor"
                      })
                    })
                  }) : null, i && "image" === s ? t.jsx("img", {
                    className: "cavcloud-galleryMedia",
                    src: i,
                    alt: l,
                    loading: "lazy"
                  }) : null, i && "video" === s ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: i,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0
                  }) : null, i ? null : (0, t.jsxs)("div", {
                    className: `cavcloud-galleryPlaceholder cavcloud-sharedPlaceholder ${"folder" === e.targetType ? "is-folder" : "is-file"}`,
                    children: [t.jsx("span", {
                      className: `cavcloud-sharedPlaceholderIcon ${"folder" === e.targetType ? "is-folder" : "is-file"}`,
                      "aria-hidden": "true",
                      children: "folder" === e.targetType ? t.jsx(ex, {}) : "image" === s || "video" === s ? t.jsx(eb, {
                        kind: s
                      }) : t.jsx(eDocThumb, {
                        variant: "shared",
                        name: l,
                        mimeType: String(a?.mimeType || ""),
                        snippet: String(a?.previewSnippet || snippetByFileId[e.targetId || ""] || "")
                      })
                    }), t.jsx("span", {
                      children: r
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryUnderImage",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-galleryMeta",
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: l
                    }), t.jsx("div", {
                      className: "cavcloud-fileMeta",
                      title: c,
                      children: o
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-galleryActionsRight",
                    children: [t.jsx("span", {
                      className: "cavcloud-galleryStarBadge",
                      role: "img",
                      "aria-label": "Starred",
                      children: t.jsx("svg", {
                        viewBox: "0 0 24 24",
                        fill: "none",
                        "aria-hidden": "true",
                        children: t.jsx("path", {
                          d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                          fill: "currentColor"
                        })
                      })
                    })]
                  })]
                })]
              }, d);
            })]
          }) : "Collab" === S ? (0, t.jsxs)("div", {
            className: `cavcloud-galleryGrid cavcloud-collabGrid ${collabLayoutClass}`,
            children: [collabInboxSummary.expiringSoon > 0 ? (0, t.jsxs)("div", {
              className: "cavcloud-collabExpiringStrip",
              children: [(0, t.jsxs)("span", {
                children: [collabInboxSummary.expiringSoon, " item", 1 === collabInboxSummary.expiringSoon ? "" : "s", " expiring soon"]
              }), t.jsx("button", {
                className: "cavcloud-rowAction",
                type: "button",
                disabled: ew || eC,
                onClick: () => {
                  setCollabInboxFilter("expiringSoon"), aS(!1);
                },
                children: "Review"
              })]
            }) : null, collabInboxError ? t.jsx("div", {
              className: "cavcloud-empty",
              children: collabInboxError
            }) : null, collabVisibleItems.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: collabEmptyMessage
            }), collabVisibleItems.map(e => {
              let a = "file" === e.targetType ? ea(String(e.mimeType || ""), e.name) : null,
                l = "folder" === e.targetType ? "Folder" : "video" === a ? "Video" : "image" === a ? "Image" : "File",
                s = "file" === e.targetType && a ? `/api/cavcloud/files/${encodeURIComponent(e.targetId)}?raw=1` : "",
                i = String(e?.sharedBy?.username || "").trim(),
                r = i ? `@${i}` : String(e?.sharedBy?.displayName || "").trim() || "A CavBot user",
                c = `save:${e.grantId}` === collabInboxActionKey,
                o = `remove:${e.grantId}` === collabInboxActionKey,
                d = ew || eC || c || o || e.shortcutSaved,
                n = ew || eC || c || o,
                hShared = 1,
                mCollab = "EDIT" === String(e?.permission || "").trim().toUpperCase();
              return (0, t.jsxs)("article", {
                className: "cavcloud-galleryCard cavcloud-collabCard",
                children: [t.jsx("button", {
                  className: "cavcloud-galleryFrame cavcloud-galleryOpen",
                  type: "button",
                  disabled: ew || eC,
                  onClick: () => collabOpenItem(e),
                  onDoubleClick: () => collabOpenItem(e),
                  "aria-label": `Open ${e.name}`,
                  title: `Open ${e.name}`,
                  children: [t.jsx(eCollabBadge, {
                    sharedUserCount: hShared,
                    collaborationEnabled: mCollab
                  }), s && "image" === a ? t.jsx("img", {
                    className: "cavcloud-galleryMedia",
                    src: s,
                    alt: e.name,
                    loading: "lazy"
                  }) : null, s && "video" === a ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: s,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0
                  }) : null, s ? null : (0, t.jsxs)("div", {
                    className: `cavcloud-galleryPlaceholder cavcloud-sharedPlaceholder ${"folder" === e.targetType ? "is-folder" : "is-file"}`,
                    children: [t.jsx("span", {
                      className: `cavcloud-sharedPlaceholderIcon ${"folder" === e.targetType ? "is-folder" : "is-file"}`,
                      "aria-hidden": "true",
                      children: "folder" === e.targetType ? t.jsx(ex, {}) : "image" === a || "video" === a ? t.jsx(eb, {
                        kind: a
                      }) : t.jsx(eDocThumb, {
                        variant: "shared",
                        name: e.name,
                        mimeType: String(e.mimeType || ""),
                        snippet: String(snippetByFileId[e.targetId || ""] || "")
                      })
                    }), t.jsx("span", {
                      children: l
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryUnderImage cavcloud-collabUnderImage",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-galleryMeta",
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: e.name
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      title: e.path,
                      children: [F(e.path), " • Shared by ", r]
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-collabMetaRow",
                      children: [t.jsx("span", {
                        className: `cavcloud-pill ${"EDIT" === e.permission ? "is-good" : ""}`,
                        children: e.permissionLabel
                      }), t.jsx("span", {
                        className: "cavcloud-fileMeta",
                        children: e.expiresAtISO ? `Expires ${B(e.expiresAtISO)}` : "No expiry"
                      })]
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-collabActions",
                    children: [t.jsx("button", {
                      className: "cavcloud-rowAction",
                      type: "button",
                      disabled: ew || eC || c || o,
                      onClick: () => collabOpenItem(e),
                      children: "Open"
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction",
                      type: "button",
                      disabled: d,
                      onClick: () => void collabSaveShortcut(e),
                      children: c ? "Saving..." : e.shortcutSaved ? "Saved to CavCloud" : "Save to CavCloud"
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction is-danger",
                      type: "button",
                      disabled: n,
                      onClick: () => void collabRemoveFromList(e),
                      children: o ? "Removing..." : "Remove from Collab"
                    })]
                  })]
                })]
              }, e.grantId);
            })]
          }) : "Shared" === S ? (0, t.jsxs)("div", {
            className: `cavcloud-galleryGrid cavcloud-sharedGrid ${iU}`,
            children: [e1 ? t.jsx("div", {
              className: "cavcloud-empty",
              children: e1
            }) : null, t0.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: t4
            }), t0.map(e => {
              let a = "FOLDER" === e.shareType ? "Folder" : "video" === e.shareMediaKind ? "Video" : "image" === e.shareMediaKind ? "Image" : "File",
                l = e.shareSourcePath ? F(e.shareSourcePath) : e.shareLabel,
                s = e.item.mode.toLowerCase().replace(/_/g, " "),
                i = {
                  id: e.item.id,
                  kind: "file",
                  name: e.shareName,
                  path: e.shareSourcePath || e.shareLabel
                },
                r = !!ay[K("file", e.item.id)],
                c = b && u === e.item.id,
                hShared = !!e?.revoked ? 0 : Math.max(1, Math.trunc(Number(e?.item?.sharedUserCount || 0)) || 0),
                mCollab = !!e?.item?.collaborationEnabled || "CAN_EDIT" === String(e?.item?.mode || "").trim().toUpperCase();
              return (0, t.jsxs)("article", {
                className: `cavcloud-galleryCard cavcloud-sharedCard ${r ? "is-selected" : ""} ${c ? "is-preview-selected" : ""}`,
                children: [(0, t.jsxs)("button", {
                  className: `cavcloud-galleryFrame cavcloud-galleryOpen ${ag ? "is-selecting" : ""}`,
                  "data-desktop-select-item": "true",
                  type: "button",
                  onClick: e => {
                    e.detail <= 1 && sN(i, e);
                  },
                  onDoubleClick: () => {
                    s6(e) || tt(e.item);
                  },
                  "aria-label": `Select ${e.shareName}. Double-click to open.`,
                  title: `Select ${e.shareName}. Double-click to open.`,
                  children: [t.jsx(eCollabBadge, {
                    sharedUserCount: hShared,
                    collaborationEnabled: mCollab
                  }), sn.has(`file:${T(e.shareSourcePath || e.shareLabel || "")}`) ? t.jsx("span", {
                    className: `cavcloud-cardStarCorner ${e.visited ? "is-with-visited" : ""}`,
                    role: "img",
                    "aria-label": "Starred",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: t.jsx("path", {
                        d: "m12 4.4 2.3 4.6 5.1.7-3.7 3.6.9 5-4.6-2.4-4.6 2.4.9-5-3.7-3.6 5.1-.7L12 4.4Z",
                        fill: "currentColor"
                      })
                    })
                  }) : null, e.visited ? t.jsx("span", {
                    className: "cavcloud-sharedVisitedBadge",
                    children: "Visited"
                  }) : null, e.sharePreviewUrl && "image" === e.shareMediaKind ? t.jsx("img", {
                    className: "cavcloud-galleryMedia",
                    src: e.sharePreviewUrl,
                    alt: e.shareName,
                    loading: "lazy"
                  }) : null, e.sharePreviewUrl && "video" === e.shareMediaKind ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: e.sharePreviewUrl,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0
                  }) : null, e.sharePreviewUrl ? null : (0, t.jsxs)("div", {
                    className: `cavcloud-galleryPlaceholder cavcloud-sharedPlaceholder ${"FOLDER" === e.shareType ? "is-folder" : "is-file"}`,
                    children: [t.jsx("span", {
                      className: `cavcloud-sharedPlaceholderIcon ${"FOLDER" === e.shareType ? "is-folder" : "is-file"}`,
                      "aria-hidden": "true",
                      children: "FOLDER" === e.shareType ? t.jsx(ex, {}) : "image" === e.shareMediaKind || "video" === e.shareMediaKind ? t.jsx(eb, {
                        kind: e.shareMediaKind
                      }) : t.jsx(eDocThumb, {
                        variant: "shared",
                        name: e.shareName,
                        mimeType: String(e.item.artifact?.mimeType || ""),
                        snippet: ""
                      })
                    }), t.jsx("span", {
                      children: a
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-galleryUnderImage cavcloud-sharedUnderImage",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-galleryMeta",
                    children: [t.jsx("div", {
                      className: "cavcloud-fileTitle",
                      children: e.shareName
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-fileMeta",
                      title: e.item.shareUrl,
                      children: [l, " • ", s]
                    }), t.jsx("div", {
                      className: "cavcloud-fileMeta",
                      children: e.revoked ? "Revoked" : `Expires ${B(e.item.expiresAtISO)}`
                    })]
                  })]
                })]
              }, e.item.id);
            })]
          }) : "Settings" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-settings",
            "data-settings-page": String(settingsPageSafe),
            children: [(0, t.jsxs)("nav", {
              className: "cavcloud-recentsPager cavcloud-galleryPager",
              role: "navigation",
              "aria-label": "Settings pagination",
              children: [t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || settingsPageSafe <= 1,
                onClick: () => setSettingsPage(Math.max(1, settingsPageSafe - 1)),
                "aria-label": "Go to previous settings page",
                title: "Previous page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M14.5 6.5 9 12l5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              }), t.jsx("div", {
                className: "cavcloud-galleryPagerNumbers",
                role: "group",
                "aria-label": `Page ${settingsPageSafe} of ${settingsTotalPages}`,
                children: [1, 2].map(e => t.jsx("button", {
                  className: `cavcloud-recentsPagerBtn cavcloud-galleryPagerBtnNum ${e === settingsPageSafe ? "is-active" : ""}`,
                  type: "button",
                  disabled: ew,
                  onClick: () => setSettingsPage(e),
                  "aria-label": e === settingsPageSafe ? `Page ${e}, current page` : `Go to page ${e}`,
                  "aria-current": e === settingsPageSafe ? "page" : void 0,
                  children: e
                }, `settings-page-top-${e}`))
              }), t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || settingsPageSafe >= settingsTotalPages,
                onClick: () => setSettingsPage(Math.min(settingsTotalPages, settingsPageSafe + 1)),
                "aria-label": "Go to next settings page",
                title: "Next page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M9.5 6.5 15 12l-5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Appearance"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Choose your CavCloud accent theme."
              }), t.jsx("div", {
                className: "cavcloud-themeRow cavcloud-themeRow-elevated",
                role: "radiogroup",
                "aria-label": "CavCloud accent themes",
                children: [{
                  key: "lime",
                  label: "Lime",
                  hint: "Classic"
                }, {
                  key: "violet",
                  label: "Violet",
                  hint: "Focused"
                }, {
                  key: "blue",
                  label: "Blue",
                  hint: "Calm"
                }, {
                  key: "white",
                  label: "White",
                  hint: "Neutral"
                }, {
                  key: "clear",
                  label: "Clear",
                  hint: "Subtle"
                }].map(e => (0, t.jsxs)("button", {
                  className: `cavcloud-themeBtn cavcloud-themeBtn-elevated ${eA === e.key ? "is-on" : ""}`,
                  onClick: () => void updateCavcloudSettingsPatch({
                    themeAccent: e.key
                  }),
                  disabled: ew || cavcloudSettingsSaving,
                  type: "button",
                  role: "radio",
                  "aria-checked": eA === e.key,
                  "aria-label": `${e.label} theme`,
                  children: [t.jsx("span", {
                    className: `cavcloud-themeDot cavcloud-themeDot-elevated is-${e.key}`,
                    "aria-hidden": "true"
                  }), (0, t.jsxs)("span", {
                    className: "cavcloud-themeMeta",
                    children: [t.jsx("span", {
                      className: "cavcloud-themeName",
                      children: e.label
                    }), t.jsx("span", {
                      className: "cavcloud-themeHint",
                      children: e.hint
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-themeCheck",
                    "aria-hidden": "true",
                    children: eA === e.key ? "✓" : ""
                  })]
                }, e.key))
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [(0, t.jsxs)("div", {
                className: "cavcloud-workspaceHeader",
                children: [t.jsx("div", {
                  className: "cavcloud-settingsTitle",
                  children: "Default Workspace Behavior"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsSub cavcloud-workspaceSub",
                  children: ["Current folder:", t.jsx("span", {
                    className: "cavcloud-workspacePath",
                    children: F(z)
                  }), cavcloudSettingsSaving ? t.jsx("span", {
                    className: "cavcloud-workspaceSaving",
                    children: "Saving…"
                  }) : null]
                })]
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Start location"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose where CavCloud opens by default."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment is-startLocation",
                    children: [{
                      key: "root",
                      label: "Open root"
                    }, {
                      key: "lastFolder",
                      label: "Open last folder"
                    }, {
                      key: "pinnedFolder",
                      label: "Open pinned folder"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn is-startLocationBtn ${cavcloudSettings.startLocation === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        startLocation: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), "pinnedFolder" === cavcloudSettings.startLocation ? (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Pinned folder"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Pick a folder to open every time."
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-workspacePinnedControls",
                    children: [(0, t.jsxs)("select", {
                      className: "cavcloud-paneTitleSelect cavcloud-workspaceSelect",
                      value: cavcloudSettings.pinnedFolderId || "",
                      disabled: ew || cavcloudSettingsSaving || !settingsPinnedFolderOptions.length,
                      onChange: e => void updateCavcloudSettingsPatch({
                        pinnedFolderId: String(e.currentTarget.value || "").trim() || null
                      }),
                      children: [t.jsx("option", {
                        value: "",
                        children: settingsPinnedFolderOptions.length ? "Select folder" : "No folders available"
                      }), settingsPinnedFolderOptions.map(e => t.jsx("option", {
                        value: e.id,
                        children: F(e.path)
                      }, e.id))]
                    }), t.jsx("button", {
                      className: "cavcloud-workspaceInlineBtn",
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving || !en?.folder?.id || "/" === T(String(en?.folder?.path || "/")),
                      onClick: () => void updateCavcloudSettingsPatch({
                        pinnedFolderId: String(en?.folder?.id || "").trim() || null
                      }),
                      children: "Use current folder"
                    })]
                  })]
                }) : null, (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default view"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose the default file layout."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment",
                    children: [{
                      key: "grid",
                      label: "Grid"
                    }, {
                      key: "list",
                      label: "List"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.defaultView === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        defaultView: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default sort"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Set the initial ordering for file lists."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment",
                    children: [{
                      key: "name",
                      label: "Name"
                    }, {
                      key: "modified",
                      label: "Modified"
                    }, {
                      key: "size",
                      label: "Size"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.defaultSort === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        defaultSort: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Folders first"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Always show folders above files."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.foldersFirst ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.foldersFirst,
                    onClick: () => void updateCavcloudSettingsPatch({
                      foldersFirst: !cavcloudSettings.foldersFirst
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.foldersFirst ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Show file extensions"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Display file suffixes in all lists."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.showExtensions ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.showExtensions,
                    onClick: () => void updateCavcloudSettingsPatch({
                      showExtensions: !cavcloudSettings.showExtensions
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.showExtensions ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Show dotfiles"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Include hidden files that start with a dot."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.showDotfiles ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.showDotfiles,
                    onClick: () => void updateCavcloudSettingsPatch({
                      showDotfiles: !cavcloudSettings.showDotfiles
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.showDotfiles ? "On" : "Off"
                    })]
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Delete to Recently deleted confirmation"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Ask before moving items to Recently deleted."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.confirmTrashDelete ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.confirmTrashDelete,
                    onClick: () => void updateCavcloudSettingsPatch({
                      confirmTrashDelete: !cavcloudSettings.confirmTrashDelete
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.confirmTrashDelete ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Permanent delete confirmation"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Always require confirmation before permanent deletion."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.confirmPermanentDelete ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.confirmPermanentDelete,
                    onClick: () => void updateCavcloudSettingsPatch({
                      confirmPermanentDelete: !cavcloudSettings.confirmPermanentDelete
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.confirmPermanentDelete ? "On" : "Off"
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Upload & Folder Ingest"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Reliability and ingest defaults for file and folder uploads."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Folder upload mode"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose whether folder uploads keep the top folder name or flatten into the current destination."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "preserveRoot",
                      label: "Preserve top folder name"
                    }, {
                      key: "flatten",
                      label: "Flatten into current folder"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.folderUploadMode === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        folderUploadMode: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Name collision rule"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Control how duplicate names are handled during uploads."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "autoRename",
                      label: "Auto rename with suffix"
                    }, {
                      key: "failAsk",
                      label: "Strict mode (fail and ask)"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.nameCollisionRule === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        nameCollisionRule: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Auto retry failed files"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Retry failed uploads automatically to improve ingest reliability."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.uploadAutoRetry ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.uploadAutoRetry,
                    onClick: () => void updateCavcloudSettingsPatch({
                      uploadAutoRetry: !cavcloudSettings.uploadAutoRetry
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.uploadAutoRetry ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Concurrency"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Set upload queue throughput profile."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "auto",
                      label: "Auto"
                    }, {
                      key: "low",
                      label: "Low"
                    }, {
                      key: "high",
                      label: "High"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.uploadConcurrency === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        uploadConcurrency: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Generate text snippets"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Enable snippet generation and backfill for text previews."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.generateTextSnippets ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.generateTextSnippets,
                    onClick: () => void updateCavcloudSettingsPatch({
                      generateTextSnippets: !cavcloudSettings.generateTextSnippets
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.generateTextSnippets ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "SHA-256 integrity"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Integrity checks are enforced for all uploads."
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-workspaceStaticValue is-on",
                    children: "Enforced"
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Show Upload Queue panel"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Show the queue panel by default during upload sessions."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.showUploadQueue ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.showUploadQueue,
                    onClick: () => void updateCavcloudSettingsPatch({
                      showUploadQueue: !cavcloudSettings.showUploadQueue
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.showUploadQueue ? "On" : "Off"
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page2 ${2 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Sharing Defaults"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Default permission is Read-only. Links always use resolver URLs."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default permission"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Share links are always generated as read-only."
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-workspaceStaticValue is-on",
                    children: "Read-only (locked)"
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default expiry"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Default timeline applied when creating new share links."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [1, 7, 30].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.shareDefaultExpiryDays === e ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        shareDefaultExpiryDays: e
                      }),
                      children: `${e} day${1 === e ? "" : "s"}`
                    }, e))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Link access"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose who can resolve new links by default."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "anyone",
                      label: "Anyone with link"
                    }, {
                      key: "cavbotUsers",
                      label: "CavBot users only"
                    }, {
                      key: "workspaceMembers",
                      label: "Workspace members only"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.shareAccessPolicy === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        shareAccessPolicy: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page2 ${2 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Publishing Defaults"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Defaults for publish visibility, confirmation, title behavior, and expiry."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default visibility"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Default visibility for newly published artifacts."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "LINK_ONLY",
                      label: "Link only"
                    }, {
                      key: "PUBLIC_PROFILE",
                      label: "Public profile"
                    }, {
                      key: "PRIVATE",
                      label: "Private"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.publishDefaultVisibility === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        publishDefaultVisibility: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Require confirm step"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Require confirmation before final publish action."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.publishRequireConfirm ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.publishRequireConfirm,
                    onClick: () => void updateCavcloudSettingsPatch({
                      publishRequireConfirm: !cavcloudSettings.publishRequireConfirm
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.publishRequireConfirm ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default artifact title"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose whether publish starts from filename or custom title mode."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "filename",
                      label: "Use filename"
                    }, {
                      key: "custom",
                      label: "Custom title first"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.publishDefaultTitleMode === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        publishDefaultTitleMode: e.key
                      }),
                      children: e.label
                    }, e.key))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Publish expiry default"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Default expiration for publish actions; can still be edited per publish."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: 0,
                      label: "Never"
                    }, {
                      key: 1,
                      label: "1 day"
                    }, {
                      key: 7,
                      label: "7 days"
                    }, {
                      key: 30,
                      label: "30 days"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.publishDefaultExpiryDays === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        publishDefaultExpiryDays: e.key
                      }),
                      children: e.label
                    }, String(e.key)))
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page2 ${2 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Storage, Retention, Cleanup"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Server-enforced recently deleted retention and cleanup policies."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Recently deleted retention"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Automatically delete recently deleted items after this retention window."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-storageSegment",
                    children: [7, 14, 30].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavcloudSettings.trashRetentionDays === e ? "is-on" : ""}`,
                      type: "button",
                      disabled: ew || cavcloudSettingsSaving,
                      onClick: () => void updateCavcloudSettingsPatch({
                        trashRetentionDays: e
                      }),
                      children: `${e} days`
                    }, e))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Auto purge"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Purge expired recently deleted items automatically using the retention window."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.autoPurgeTrash ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.autoPurgeTrash,
                    onClick: () => void updateCavcloudSettingsPatch({
                      autoPurgeTrash: !cavcloudSettings.autoPurgeTrash
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.autoPurgeTrash ? "On" : "Off"
                    })]
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Large file handling"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Stream downloads remains default. Enable this to prefer downloads for unknown binaries."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.preferDownloadUnknownBinary ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.preferDownloadUnknownBinary,
                    onClick: () => void updateCavcloudSettingsPatch({
                      preferDownloadUnknownBinary: !cavcloudSettings.preferDownloadUnknownBinary
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.preferDownloadUnknownBinary ? "On" : "Off"
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page2 ${2 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Notifications"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "CavCloud operational alerts only."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Storage 80%"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send an alert when storage usage crosses 80%."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyStorage80 ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyStorage80,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyStorage80: !cavcloudSettings.notifyStorage80
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyStorage80 ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Storage 95%"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send a critical alert when storage usage crosses 95%."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyStorage95 ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyStorage95,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyStorage95: !cavcloudSettings.notifyStorage95
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyStorage95 ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Upload failures"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send alerts when file uploads fail after retry handling."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyUploadFailures ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyUploadFailures,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyUploadFailures: !cavcloudSettings.notifyUploadFailures
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyUploadFailures ? "On" : "Off"
                    })]
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-workspaceDivider"
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Share links expiring soon"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send reminders before share links expire."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyShareExpiringSoon ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyShareExpiringSoon,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyShareExpiringSoon: !cavcloudSettings.notifyShareExpiringSoon
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyShareExpiringSoon ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Artifact published/unpublished"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send updates when artifact visibility changes."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyArtifactPublished ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyArtifactPublished,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyArtifactPublished: !cavcloudSettings.notifyArtifactPublished
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyArtifactPublished ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Bulk delete/purge confirmation"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Send extra confirmation alerts for bulk destructive actions."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavcloudSettings.notifyBulkDeletePurge ? "is-on" : ""}`,
                    type: "button",
                    disabled: ew || cavcloudSettingsSaving,
                    "aria-pressed": cavcloudSettings.notifyBulkDeletePurge,
                    onClick: () => void updateCavcloudSettingsPatch({
                      notifyBulkDeletePurge: !cavcloudSettings.notifyBulkDeletePurge
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavcloudSettings.notifyBulkDeletePurge ? "On" : "Off"
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("nav", {
              className: "cavcloud-recentsPager cavcloud-galleryPager",
              role: "navigation",
              "aria-label": "Settings pagination",
              children: [t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || settingsPageSafe <= 1,
                onClick: () => setSettingsPage(Math.max(1, settingsPageSafe - 1)),
                "aria-label": "Go to previous settings page",
                title: "Previous page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M14.5 6.5 9 12l5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              }), t.jsx("div", {
                className: "cavcloud-galleryPagerNumbers",
                role: "group",
                "aria-label": `Page ${settingsPageSafe} of ${settingsTotalPages}`,
                children: [1, 2].map(e => t.jsx("button", {
                  className: `cavcloud-recentsPagerBtn cavcloud-galleryPagerBtnNum ${e === settingsPageSafe ? "is-active" : ""}`,
                  type: "button",
                  disabled: ew,
                  onClick: () => setSettingsPage(e),
                  "aria-label": e === settingsPageSafe ? `Page ${e}, current page` : `Go to page ${e}`,
                  "aria-current": e === settingsPageSafe ? "page" : void 0,
                  children: e
                }, `settings-page-bottom-${e}`))
              }), t.jsx("button", {
                className: "cavcloud-recentsPagerBtn",
                type: "button",
                disabled: ew || settingsPageSafe >= settingsTotalPages,
                onClick: () => setSettingsPage(Math.min(settingsTotalPages, settingsPageSafe + 1)),
                "aria-label": "Go to next settings page",
                title: "Next page",
                children: t.jsx("svg", {
                  viewBox: "0 0 24 24",
                  fill: "none",
                  "aria-hidden": "true",
                  children: t.jsx("path", {
                    d: "M9.5 6.5 15 12l-5.5 5.5",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              })]
            })]
          }) : (0, t.jsxs)("div", {
            className: "cavcloud-list",
            children: [ts.length ? iW : null, ti.length ? iH : null, ts.length || ti.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "This folder is empty."
            })]
          })]
        }), (0, t.jsxs)("aside", {
          className: "cavcloud-rail",
          children: [(0, t.jsxs)("div", {
            className: "cavcloud-railCard",
            children: [(0, t.jsxs)("div", {
              className: `cavcloud-ring ${tk ? "is-warn" : ""} ${tw ? "is-full" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-ringArc",
                style: {
                  background: tL
                },
                "aria-hidden": "true"
              }), (0, t.jsxs)("div", {
                className: "cavcloud-ringInner",
                children: [t.jsx("div", {
                  className: "cavcloud-ringValue",
                  children: tS
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-ringSub",
                  children: [tC, "% used"]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-storageMetrics",
              "aria-label": "Storage summary",
              children: [(0, t.jsxs)("div", {
                className: "cavcloud-storageMetric",
                children: [t.jsx("span", {
                  className: "cavcloud-storageMetricK",
                  children: "Used"
                }), (0, t.jsxs)("span", {
                  className: "cavcloud-storageMetricV",
                  children: [t.jsx("strong", {
                    children: tT.num
                  }), tT.unit ? t.jsx("em", {
                    children: tT.unit
                  }) : null]
                })]
              }), (0, t.jsxs)("div", {
                className: "cavcloud-storageMetric",
                children: [t.jsx("span", {
                  className: "cavcloud-storageMetricK",
                  children: "Free"
                }), (0, t.jsxs)("span", {
                  className: "cavcloud-storageMetricV",
                  children: [t.jsx("strong", {
                    children: tO.num
                  }), tO.unit ? t.jsx("em", {
                    children: tO.unit
                  }) : null]
                })]
              }), (0, t.jsxs)("div", {
                className: "cavcloud-storageMetric",
                children: [t.jsx("span", {
                  className: "cavcloud-storageMetricK",
                  children: "Total"
                }), (0, t.jsxs)("span", {
                  className: "cavcloud-storageMetricV",
                  children: [t.jsx("strong", {
                    children: tF.num
                  }), tF.unit ? t.jsx("em", {
                    children: tF.unit
                  }) : null]
                })]
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-railCard",
            children: [t.jsx("div", {
              className: "cavcloud-railTitle",
              children: "Quick Actions"
            }), t.jsx("button", {
              className: "cavcloud-btn cavcloud-btnGhost",
              disabled: ew || eC || !sr,
              onClick: () => void sI(),
              children: "Restore"
            }), t.jsx("button", {
              className: "cavcloud-btn cavcloud-btnGhost",
              disabled: ew || eC,
              onClick: () => lV.current?.click(),
              children: "Upload files"
            }), t.jsx("button", {
              className: "cavcloud-btn cavcloud-btnGhost",
              disabled: ew || eC,
              onClick: () => lZ.current?.click(),
              children: "Upload folder"
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-railCard",
            children: [t.jsx("div", {
              className: "cavcloud-railTitle",
              children: "Storage Trend"
            }), t8.length ? (0, t.jsxs)(t.Fragment, {
              children: [t.jsx("div", {
                className: "cavcloud-trend cavcloud-trendRail",
                "aria-label": "Storage trend bars",
                children: t8.map(e => t.jsx("div", {
                  className: "cavcloud-trendBar",
                  style: {
                    "--cc-trend": `${e.heightPx}px`
                  },
                  title: `${B(new Date(e.ts).toISOString())} • ${P(e.usedBytes)}`
                }, e.ts))
              }), (0, t.jsxs)("div", {
                className: "cavcloud-homeRow",
                children: [t.jsx("span", {
                  children: "Latest"
                }), t.jsx("span", {
                  children: sl ? P(sl.usedBytes) : "0 B"
                })]
              })]
            }) : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No storage data yet."
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-railCard cavcloud-mountQuickCard",
            children: [t.jsx("div", {
              className: "cavcloud-railTitle",
              children: "Start Mount"
            }), t.jsx("div", {
              className: "cavcloud-settingsSub cavcloud-mountQuickIntro",
              children: "Mount a folder or file and run it in CavCode Viewer."
            }), canUseMountFeature ? (0, t.jsxs)(t.Fragment, {
              children: [t.jsxs("div", {
                className: "cavcloud-mountQuickControls",
                children: [t.jsx("div", {
                  className: "cavcloud-mountQuickSelectWrap",
                  children: t.jsx("select", {
                    className: "cavcloud-paneTitleSelect cavcloud-mountQuickSelect",
                    value: mountQuickKind,
                    onChange: e => setMountQuickKind("file" === String(e.currentTarget.value) ? "file" : "folder"),
                    disabled: ew || eC || mountBusy,
                    "aria-label": "Choose mount source type",
                    children: [t.jsx("option", {
                      value: "folder",
                      children: "Folder"
                    }), t.jsx("option", {
                      value: "file",
                      children: "File"
                    })]
                  })
                }), t.jsx("div", {
                  className: "cavcloud-mountQuickSelectWrap",
                  children: t.jsx("select", {
                    className: "cavcloud-paneTitleSelect cavcloud-mountQuickSelect",
                    value: mountQuickTarget?.id || mountQuickTargetId,
                    onChange: e => setMountQuickTargetId(String(e.currentTarget.value || "")),
                    disabled: ew || eC || mountBusy || !mountQuickOptions.length,
                    "aria-label": "Choose a folder or file to mount",
                    children: mountQuickOptions.length ? mountQuickOptions.map(e => t.jsx("option", {
                      value: e.id,
                      children: `${e.name}: ${F(e.path)}`
                    }, e.id)) : t.jsx("option", {
                      value: "",
                      children: "No mount targets in this folder"
                    })
                  })
                }), t.jsxs("div", {
                  className: "cavcloud-mountQuickEntry",
                  children: [t.jsx("span", {
                    className: "cavcloud-mountQuickEntryLabel",
                    children: "Entry"
                  }), t.jsx("span", {
                    className: "cavcloud-mountQuickEntryValue",
                    children: mountQuickTarget ? "file" === mountQuickTarget.kind ? mountQuickTarget.entryPath : "/index.html" : "—"
                  })]
                })]
              }), t.jsx("button", {
                className: "cavcloud-btn cavcloud-btnGhost cavcloud-mountQuickAction",
                disabled: ew || eC || mountBusy || !mountQuickTarget,
                onClick: () => void runQuickMountToCavCodeViewer(),
                children: mountBusy ? (0, t.jsxs)("span", {
                  className: "cavcloud-btnLabelSpin",
                  children: [t.jsx("span", {
                    className: "cavcloud-btnSpinner",
                    "aria-hidden": "true"
                  }), "Mounting..."]
                }) : "Mount + Run"
              })]
            }) : t.jsxs("div", {
              className: "cavcloud-mountGate",
              role: "note",
              "aria-label": "Mount is available on Premium plans",
              children: [t.jsxs("div", {
                className: "cavcloud-mountGatePreview",
                "aria-hidden": "true",
                children: [t.jsx("span", {
                  className: "cavcloud-mountGatePreviewLine"
                }), t.jsx("span", {
                  className: "cavcloud-mountGatePreviewLine is-short"
                }), t.jsx("span", {
                  className: "cavcloud-mountGatePreviewLine"
                })]
              }), (0, t.jsxs)("div", {
                className: "cavcloud-mountGateOverlay",
                children: [t.jsx(LockIcon, {
                  width: 16,
                  height: 16,
                  className: "cavcloud-mountGateLock",
                  "aria-hidden": "true"
                }), t.jsx("div", {
                  className: "cavcloud-mountGateTitle",
                  children: "Directly mount folders or files."
                }), t.jsx("div", {
                  className: "cavcloud-mountGateSub",
                  children: "Available on Premium plans."
                }), t.jsx("button", {
                  className: "cavcloud-btn cavcloud-btnGhost cavcloud-mountGateBtn",
                  type: "button",
                  disabled: ew || eC,
                  onClick: () => l.push("/plan"),
                  children: "Upgrade"
                })]
              })]
            })]
          })]
        }), b && N ? t.jsx("aside", {
          className: "cavcloud-previewDock",
          "aria-label": "Preview panel",
          children: t.jsx(d.x, {
            item: {
              ...N,
              uploadedBy: t_
            },
            mode: j,
            onClose: w,
            onOpen: ie,
            onCopyLink: () => void ia(),
            onShare: il,
            canCopyLink: !0,
            canShare: "file" === N.source || "by_path" === N.source,
            onOpenInCavCode: () => {
              let e = encodeURIComponent(T(String(N.path || `/${N.name}`)));
              l.push(`/cavcode?cloud=1&file=${e}`);
            },
            onMountInCavCodeViewer: canUseMountFeature ? () => void mountPreviewToCavCodeViewer() : void 0,
            mountInCavCodeViewerLocked: !canUseMountFeature,
            onMountInCavCodeViewerLocked: canUseMountFeature ? void 0 : () => l3("watch", mountFeatureLockedMessage),
            mountInCavCodeViewerLockedMessage: mountFeatureLockedMessage
          })
        }) : null]
      }), lu ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-upload-create-title",
        onClick: () => {
          ew || lh(!1);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-createMenuCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-createMenuHead",
            children: t.jsx("button", {
              className: "cavcloud-createMenuClose",
              type: "button",
              onClick: () => lh(!1),
              "aria-label": "Close upload menu",
              disabled: ew,
              children: t.jsx("span", {
                className: "cb-closeIcon",
                "aria-hidden": "true"
              })
            })
          }), (0, t.jsxs)("div", {
            className: "cavcloud-createMenuSection",
            children: [t.jsx("div", {
              className: "cavcloud-createMenuTitle",
              id: "cavcloud-upload-create-title",
              children: "Create"
            }), (0, t.jsxs)("button", {
              className: "cavcloud-createMenuItem",
              type: "button",
              disabled: ew || eC,
              onClick: () => ip("create.folder"),
              children: [t.jsx("span", {
                className: "cavcloud-createMenuItemLabel",
                children: "Folder"
              }), t.jsx("span", {
                className: "cavcloud-createMenuArrow",
                "aria-hidden": "true",
                children: "›"
              })]
            }), (0, t.jsxs)("button", {
              className: "cavcloud-createMenuItem",
              type: "button",
              disabled: ew || eC,
              onClick: () => ip("create.file"),
              children: [t.jsx("span", {
                className: "cavcloud-createMenuItemLabel",
                children: "Document"
              }), t.jsx("span", {
                className: "cavcloud-createMenuArrow",
                "aria-hidden": "true",
                children: "›"
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-createMenuSection",
            children: [t.jsx("div", {
              className: "cavcloud-createMenuTitle",
              children: "Upload"
            }), t.jsx("button", {
              className: "cavcloud-createMenuItem",
              type: "button",
              disabled: ew || eC,
              onClick: () => ip("add.upload_files"),
              children: t.jsx("span", {
                className: "cavcloud-createMenuItemLabel",
                children: "Upload files"
              })
            }), t.jsx("button", {
              className: "cavcloud-createMenuItem",
              type: "button",
              disabled: ew || eC,
              onClick: () => ip("add.upload_folder"),
              children: t.jsx("span", {
                className: "cavcloud-createMenuItemLabel",
                children: "Upload folder"
              })
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-createMenuSection",
            children: [t.jsx("div", {
              className: "cavcloud-createMenuTitle",
              children: "Import"
            }), t.jsx("button", {
              className: "cavcloud-createMenuItem",
              type: "button",
              disabled: ew || eC,
              onClick: () => ip("add.import_google_drive"),
              children: t.jsxs("span", {
                className: "cavcloud-createMenuItemLabel cavcloud-createMenuItemLead",
                children: [(0, t.jsxs)("svg", {
                  className: "cavcloud-createMenuGoogleIcon",
                  viewBox: "0 0 24 24",
                  "aria-hidden": "true",
                  children: [t.jsx("path", {
                    fill: "currentColor",
                    d: "M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.85z"
                  }), t.jsx("path", {
                    fill: "currentColor",
                    d: "M12 24c3.24 0 5.95-1.08 7.94-2.92l-3.87-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.72-4.95H1.28v3.09A12 12 0 0 0 12 24z"
                  }), t.jsx("path", {
                    fill: "currentColor",
                    d: "M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.63H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.37l4-3.09z"
                  }), t.jsx("path", {
                    fill: "currentColor",
                    d: "M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l4 3.09C6.22 6.88 8.87 4.77 12 4.77z"
                  })]
                }), "Import from Google Drive"]
              })
            })]
          })]
        })
      }) : null, lm ? t.jsx("div", {
        className: "cavcloud-modal cavcloud-sideModal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-create-folder-title",
        onClick: () => {
          ew || (lv(!1), lf(""), setCreateFolderTarget("cavcloud"));
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-sideModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-create-folder-title",
            children: "Create folder"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Folder name", t.jsx("input", {
                className: "cavcloud-input",
                value: lp,
                onChange: e => lf(e.currentTarget.value),
                placeholder: "New folder",
                maxLength: 120,
                autoFocus: !0
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Destination", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: createFolderTarget,
                onChange: e => setCreateFolderTarget(e.currentTarget.value),
                children: [t.jsx("option", {
                  value: "cavcloud",
                  children: "CavCloud"
                }), t.jsx("option", {
                  value: "cavsafe",
                  children: "CavSafe"
                })]
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                lv(!1), lf(""), setCreateFolderTarget("cavcloud");
              },
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void im(),
              disabled: ew || !lp.trim(),
              children: "Create"
            })]
          })]
        })
      }) : null, lR ? t.jsx("div", {
        className: "cavcloud-modal cavcloud-sideModal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-create-file-title",
        onClick: () => {
          ew || (lU(!1), lD("untitled.txt"), setCreateFileTarget("cavcloud"));
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-sideModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-create-file-title",
            children: "Create document"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Document name", t.jsx("input", {
                className: "cavcloud-input",
                value: lE,
                onChange: e => lD(e.currentTarget.value),
                placeholder: "untitled.txt",
                maxLength: 180,
                autoFocus: !0
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Destination", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: createFileTarget,
                onChange: e => setCreateFileTarget(e.currentTarget.value),
                children: [t.jsx("option", {
                  value: "cavcloud",
                  children: "CavCloud"
                }), t.jsx("option", {
                  value: "cavsafe",
                  children: "CavSafe"
                }), t.jsx("option", {
                  value: "cavcode",
                  children: "CavCode"
                })]
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                lU(!1), lD("untitled.txt"), setCreateFileTarget("cavcloud");
              },
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void iv(),
              disabled: ew || !lE.trim(),
              children: "cavcode" === createFileTarget ? "Send to CavCode" : "Create"
            })]
          })]
        })
      }) : null, l_ ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-publish-artifact-title",
        onClick: () => {
          ew || (lW(null), lG(""), lJ(cavcloudSettings.publishDefaultVisibility), setPublishExpiryDays(normalizePublishExpiryDays(cavcloudSettings.publishDefaultExpiryDays, 0)));
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-publish-artifact-title",
            children: "folder" === String(l_?.kind || "").toLowerCase() ? "Publish folder" : "Publish file"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-publishArtifactLead",
              children: [t.jsx("strong", {
                children: "Public Artifacts"
              }), t.jsx("div", {
                className: "cavcloud-modalText",
                children: "Artifacts stay private until you publish. Set visibility to Public profile to show this on your public page."
              })]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-field",
              children: [t.jsx("strong", {
                children: l_.name
              }), (0, t.jsxs)("div", {
                className: "cavcloud-fileMeta",
                children: "folder" === String(l_?.kind || "").toLowerCase() ? ["Folder", " • ", l_.path || "/"] : [String(l_.mimeType || V(l_.name) || "File"), " • ", Number(l_.bytes) > 0 ? P(Number(l_.bytes)) : "Size pending"]
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Title", t.jsx("input", {
                className: "cavcloud-input",
                value: lH,
                onChange: e => lG(e.currentTarget.value),
                placeholder: l_.name,
                maxLength: 140
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Visibility", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: lK,
                onChange: e => lJ(e.currentTarget.value),
                children: [t.jsx("option", {
                  value: "PUBLIC_PROFILE",
                  children: "Public profile"
                }), t.jsx("option", {
                  value: "LINK_ONLY",
                  children: "Link only"
                }), t.jsx("option", {
                  value: "PRIVATE",
                  children: "Private"
                })]
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Expires", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: String(normalizePublishExpiryDays(publishExpiryDays, cavcloudSettings.publishDefaultExpiryDays)),
                onChange: e => setPublishExpiryDays(normalizePublishExpiryDays(e.currentTarget.value, cavcloudSettings.publishDefaultExpiryDays)),
                children: [t.jsx("option", {
                  value: "1",
                  children: "1 day"
                }), t.jsx("option", {
                  value: "7",
                  children: "7 days"
                }), t.jsx("option", {
                  value: "30",
                  children: "30 days"
                }), t.jsx("option", {
                  value: "0",
                  children: "Never"
                })]
              })]
            }), t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Only explicitly published items appear in Public Artifacts."
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                lW(null), lG(""), lJ(cavcloudSettings.publishDefaultVisibility), setPublishExpiryDays(normalizePublishExpiryDays(cavcloudSettings.publishDefaultExpiryDays, 0));
              },
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void sY(),
              disabled: ew,
              children: "Publish to Artifacts"
            })]
          })]
        })
      }) : null, lg ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-rename-item-title",
        onClick: () => {
          ew || (lx(null), lb(""));
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [(0, t.jsxs)("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-rename-item-title",
            children: ["Rename ", "folder" === lg.kind ? "folder" : "file"]
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["New name", t.jsx("input", {
                className: "cavcloud-input",
                value: ly,
                onChange: e => lb(e.currentTarget.value),
                placeholder: lg.name,
                maxLength: 180,
                autoFocus: !0
              })]
            })
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                lx(null), lb("");
              },
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                let e = lg;
                lx(null), lb(""), iPublish(e);
              },
              disabled: ew,
              children: "Publish"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void sQ(),
              disabled: ew || !ly.trim(),
              children: "Save"
            })]
          })]
        })
      }) : null, copyLinkModalOpen ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-copy-link-title",
        onClick: closeCopyLinkModal,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-copyLinkModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-copy-link-title",
            children: copyLinkModalTitle
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Link ready to copy."
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Share URL", t.jsx("textarea", {
                ref: copyLinkModalInputRef,
                className: "cavcloud-input cavcloud-copyLinkModalTextarea",
                value: copyLinkModalValue,
                readOnly: !0,
                spellCheck: !1,
                autoFocus: !0,
                rows: copyLinkModalValue.includes("\n") ? 6 : 3,
                onFocus: e => e.currentTarget.select()
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: closeCopyLinkModal,
              disabled: copyLinkModalCopying,
              children: "Close"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void copyFromCopyLinkModal(),
              disabled: copyLinkModalCopying || !copyLinkModalValue.trim(),
              children: copyLinkModalCopying ? "Copying..." : copyLinkModalValue.includes("\n") ? "Copy links" : "Copy link"
            })]
          })]
        })
      }) : null, t.jsx(CavGuardModal, {
        open: !!cavGuardDecision,
        decision: cavGuardDecision,
        onClose: closeCavGuardModal,
        onCtaClick: closeCavGuardModal
      }), mountRunModalItem ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-mount-run-title",
        onClick: () => {
          mountBusy || setMountRunModalItem(null);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-mount-run-title",
            children: "Mount in CavCode Viewer"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["This will open ", t.jsx("strong", {
                children: mountRunModalItem.name
              }), " in CavCode Viewer and run it in mounted mode."]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Type: ", "folder" === mountRunModalItem.kind ? "Folder" : "File", " • Entry: ", mountRunModalItem.entryPath]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => setMountRunModalItem(null),
              disabled: mountBusy,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void runMountRunModal(),
              disabled: mountBusy,
              children: mountBusy ? "Running..." : "Run"
            })]
          })]
        })
      }) : null, lj ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-file-delete-title",
        onClick: () => {
          ew || lN(null);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-file-delete-title",
            children: "Move file to CavSafe"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Move ", t.jsx("strong", {
                children: lj.name
              }), " to CavSafe?"]
            })
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => lN(null),
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void s0(),
              disabled: ew || !canMoveToCavSafe,
              children: "Move to CavSafe"
            })]
          })]
        })
      }) : null, lC ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-trash-permanent-title",
        onClick: () => {
          ew || lk(null);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-trash-permanent-title",
            children: "Permanent delete"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Permanently delete ", t.jsx("strong", {
                children: lC.name
              }), "? This cannot be undone."]
            })
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => lk(null),
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction is-danger",
              type: "button",
              onClick: () => void s4(),
              disabled: ew,
              children: "Delete forever"
            })]
          })]
        })
      }) : null, aX ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-trash-notice-title",
        onClick: () => {
          ew || a0(!1);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-trashNoticeModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-trash-notice-title",
            children: "7-day deletion notice"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "These files are within 7 days of permanent deletion from CavCloud."
            }), tm.length ? t.jsx("div", {
              className: "cavcloud-trashNoticeList",
              children: tm.map(e => {
                let a = Y(e),
                  l = "folder" === e.kind ? "folder" : a || "file";
                return (0, t.jsxs)("div", {
                  className: "cavcloud-row cavcloud-trashNoticeRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-rowName",
                    children: [t.jsx(ej, {
                      item: e,
                      mediaKind: a,
                      previewUrl: `/api/cavcloud/trash/${encodeURIComponent(e.id)}?raw=1`,
                      snippet: String(snippetByFileId[e.targetId || ""] || "")
                    }), (0, t.jsxs)("div", {
                      children: [t.jsx("div", {
                        className: "cavcloud-fileTitle",
                        children: "file" === e.kind ? displayCavcloudFileName(e.name, cavcloudSettings.showExtensions) : e.name
                      }), (0, t.jsxs)("div", {
                        className: "cavcloud-fileMeta",
                        children: [F(e.path), " • ", l, " • ", ec(e.purgeAfterISO), " days left"]
                      })]
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-rowMeta",
                    children: B(e.deletedAtISO)
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-rowMeta",
                    children: [tG(e) ? t.jsx("button", {
                      className: "cavcloud-rowAction",
                      disabled: ew || eC,
                      onClick: () => void s8(e),
                      children: "Preview"
                    }) : null, t.jsx("button", {
                      className: "cavcloud-rowAction",
                      disabled: ew || eC,
                      onClick: () => void sW(eh(e.path), "folder"),
                      children: "Open path"
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction",
                      disabled: ew,
                      onClick: () => void s1(e),
                      children: "Restore"
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction is-danger",
                      disabled: ew,
                      onClick: () => void s2(e),
                      children: "Delete"
                    })]
                  })]
                }, e.id);
              })
            }) : t.jsx("div", {
              className: "cavcloud-empty",
              children: "No files currently on 7-day notice."
            })]
          }), t.jsx("div", {
            className: "cavcloud-modalActions",
            children: t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => a0(!1),
              disabled: ew,
              children: "Close"
            })
          })]
        })
      }) : null, aY ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-trash-custom-title",
        onClick: i$,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-trashCustomModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-trash-custom-title",
            children: "Custom timeline"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Set a custom deleted-file timeline window."
            }), (0, t.jsxs)("div", {
              className: "cavcloud-trashCustomRangeGrid",
              children: [(0, t.jsxs)("label", {
                className: "cavcloud-field",
                children: ["Start", t.jsx("input", {
                  className: "cavcloud-input",
                  type: "datetime-local",
                  value: aV,
                  onChange: e => aZ(e.currentTarget.value)
                })]
              }), (0, t.jsxs)("label", {
                className: "cavcloud-field",
                children: ["End", t.jsx("input", {
                  className: "cavcloud-input",
                  type: "datetime-local",
                  value: az,
                  onChange: e => aq(e.currentTarget.value)
                })]
              })]
            }), t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Leave either field empty for an open-ended range."
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                aZ(""), aq("");
              },
              disabled: ew,
              children: "Clear"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: i$,
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: iL,
              disabled: ew,
              children: "Apply"
            })]
          })]
        })
      }) : null, li ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-restoration-custom-title",
        onClick: iO,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-trashCustomModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-restoration-custom-title",
            children: "Custom timeline"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Set a custom restorations timeline window."
            }), t.jsx("div", {
              className: "cavcloud-restorationStatusLegend",
              role: "list",
              "aria-label": "Restoration status legend",
              children: y.map(e => (0, t.jsxs)("div", {
                className: "cavcloud-restorationStatusLegendItem",
                "data-status": e.key,
                role: "listitem",
                children: [t.jsx("span", {
                  className: "cavcloud-restorationStatusDot",
                  "aria-hidden": "true"
                }), t.jsx("span", {
                  children: e.label
                })]
              }, e.key))
            }), (0, t.jsxs)("div", {
              className: "cavcloud-trashCustomRangeGrid",
              children: [(0, t.jsxs)("label", {
                className: "cavcloud-field",
                children: ["Start", t.jsx("input", {
                  className: "cavcloud-input",
                  type: "datetime-local",
                  value: la,
                  onChange: e => ll(e.currentTarget.value)
                })]
              }), (0, t.jsxs)("label", {
                className: "cavcloud-field",
                children: ["End", t.jsx("input", {
                  className: "cavcloud-input",
                  type: "datetime-local",
                  value: lt,
                  onChange: e => ls(e.currentTarget.value)
                })]
              })]
            }), t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Leave either field empty for an open-ended range."
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                ll(""), ls("");
              },
              disabled: ew,
              children: "Clear"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: iO,
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: iF,
              disabled: ew,
              children: "Apply"
            })]
          })]
        })
      }) : null, "move" === lw ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-bulk-move-title",
        onClick: sS,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-bulk-move-title",
            children: "Move selected items"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Move ", sr, " selected item", 1 === sr ? "" : "s", " to another folder."]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Destination folder", (0, t.jsxs)("select", {
                className: "cavcloud-input",
                value: lO,
                onChange: e => lF(e.currentTarget.value),
                disabled: ew || l$ || !sy.length,
                children: [t.jsx("option", {
                  value: "",
                  children: l$ ? "Loading folders…" : "Select destination folder"
                }), sy.map(e => t.jsx("option", {
                  value: e.id,
                  children: F(e.path)
                }, e.id))]
              })]
            }), lA ? t.jsx("div", {
              className: "cavcloud-modalText",
              children: lA
            }) : null]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: sS,
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void sM(),
              disabled: ew || l$ || !lO,
              children: "Move"
            })]
          })]
        })
      }) : null, "delete" === lw ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-bulk-delete-title",
        onClick: sS,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-bulk-delete-title",
            children: "Move selected items to recently deleted"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Move ", sr, " selected item", 1 === sr ? "" : "s", " to recently deleted?"]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: [si.slice(0, 3).map(e => e.name).join(", "), si.length > 3 ? ` +${si.length - 3} more` : ""]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: sS,
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction is-danger",
              type: "button",
              onClick: () => void sI(),
              disabled: ew,
              children: "Move to recently deleted"
            })]
          })]
        })
      }) : null, collabLaunchModalOpen ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-collab-launch-title",
        onClick: closeCollabLaunchModal,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard cavcloud-collabLaunchModalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-collab-launch-title",
            children: "Share from CavCloud"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Choose a file or folder, then continue to set access and collaboration."
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Find item", t.jsx("input", {
                className: "cavcloud-input",
                value: collabLaunchQuery,
                onChange: e => setCollabLaunchQuery(e.currentTarget.value),
                placeholder: "Search by name or path"
              })]
            }), collabLaunchGlobalIndexError ? (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: [collabLaunchGlobalIndexError, " ", t.jsx("button", {
                className: "cavcloud-rowAction",
                type: "button",
                onClick: retryCollabLaunchGlobalIndex,
                disabled: collabLaunchGlobalIndexBusy,
                children: "Retry"
              })]
            }) : null, collabLaunchGlobalIndexBusy ? t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Indexing all CavCloud folders and files..."
            }) : null, t.jsx("div", {
              className: "cavcloud-collabLaunchList",
              role: "listbox",
              "aria-label": "Files and folders you can share",
              children: collabLaunchVisibleItems.length ? collabLaunchVisibleItems.map(e => {
                let a = collabLaunchSelectionKey === e.key;
                return t.jsx("button", {
                  type: "button",
                  className: `cavcloud-collabLaunchItem ${a ? "is-selected" : ""}`,
                  role: "option",
                  "aria-selected": a,
                  onClick: () => setCollabLaunchSelectionKey(e.key),
                  children: (0, t.jsxs)("span", {
                    className: "cavcloud-collabLaunchItemBody",
                    children: [(0, t.jsxs)("span", {
                      className: "cavcloud-collabLaunchItemHead",
                      children: [t.jsx("span", {
                        className: "cavcloud-collabLaunchItemName",
                        children: e.name
                      }), t.jsx("span", {
                        className: "cavcloud-collabLaunchItemKind",
                        children: "folder" === e.kind ? "Folder" : "File"
                      })]
                    }), t.jsx("span", {
                      className: "cavcloud-collabLaunchItemPath",
                      children: "folder" === e.kind ? collabLaunchCountLabel(e) : F(e.path || `/${e.name}`)
                    })]
                  })
                }, e.key);
              }) : t.jsx("div", {
                className: "cavcloud-modalText",
                children: collabLaunchGlobalIndexBusy ? "Indexing all CavCloud files and folders..." : collabLaunchGlobalIndexError ? "Indexing stopped after a server error. Retry to continue." : "No files or folders available to share right now."
              })
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: closeCollabLaunchModal,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: continueCollabLaunch,
              disabled: !collabLaunchSelectedItem,
              children: "Continue"
            })]
          })]
        })
      }) : null, collabModalTarget ? t.jsx(CavCloudCollaborateModal, {
        open: !0,
        resourceType: collabModalTarget.resourceType,
        resourceId: collabModalTarget.resourceId,
        resourceName: collabModalTarget.resourceName,
        resourcePath: collabModalTarget.resourcePath,
        onClose: closeCollaborateModal
      }) : null, googleDriveImportModalOpen ? t.jsx(CavCloudGoogleDriveImportModal, {
        disabled: ew || eC,
        targetFolderId: String(en?.folder?.id || "").trim() || null,
        targetFolderPath: T(z || "/"),
        onClose: () => setGoogleDriveImportModalOpen(!1),
        onSessionCreated: e => handleGoogleDriveImportSessionCreated(e),
        onNotify: (e, a) => l3(e, a)
      }) : null, t.jsx("div", {
        className: "cavcloud-toasts",
        role: "status",
        "aria-live": "polite",
        children: eO.map(e => t.jsx("div", {
          className: `cavcloud-toast is-${e.tone}`,
          children: e.text
        }, e.id))
      })]
    })]
  });
}
function IconPremiumPlusStar() {
  return t.jsx("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    className: "cb-upgrade-badgeStar",
    "aria-hidden": "true",
    children: t.jsx("path", {
      fill: "currentColor",
      d: "M12 2.4l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.2 6.2 20.23l1.11-6.45L2.62 9.21l6.48-.94L12 2.4z"
    })
  });
}
export default eC;
