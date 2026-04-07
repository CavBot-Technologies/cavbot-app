/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
"use client";

/* eslint-disable */
import * as t from "react/jsx-runtime";
import Image from "next/image";
import Link from "next/link";
import * as nav from "next/navigation";
import * as c from "react";
import { CavCloudPreviewPanel } from "@/components/cavcloud/CavCloudPreviewPanel";
import CavSafeOwnerCommandDashboard from "@/components/cavsafe/CavSafeOwnerCommandDashboard";
import {
  CavSurfaceHeaderGreeting,
  CavSurfaceSidebarBrandMenu,
  CavSurfaceSidebarFooter
} from "@/components/cavcloud/CavSurfaceShellControls";
import { LockIcon } from "@/components/LockIcon";
import { copyTextToClipboard } from "@/lib/clipboard";
import { countDriveListingItems, debugDriveLog, getDriveDebugEnabled, useDriveChildren } from "@/lib/cavdrive/liveData.client";
import { formatSnippetForThumbnail, getExtensionLabel, isTextLikeFile } from "@/lib/filePreview";
import { selectDesktopItemMap, shouldClearDesktopSelectionFromTarget } from "@/lib/hooks/useDesktopSelection";
import { normalizeCavbotFounderProfile } from "@/lib/profileIdentity";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";
import "../cavcloud/cavcloud.css";
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
const CAVCLOUD_FOLDER_ENSURE_CONCURRENCY = 8;
const CAVCLOUD_MULTIPART_PART_CONCURRENCY = 4;
const CAVCLOUD_MULTIPART_THRESHOLD_BYTES = 25165824;
const CAVCLOUD_RECENTS_PAGE_SIZE = 10;
const CAVCLOUD_GALLERY_PAGE_SIZE = 6;
const CAVCLOUD_DELETE_VISUAL_MS = 190;
const CAVCLOUD_POST_MUTATION_RETRY_ATTEMPTS = 4;
const CAVCLOUD_POST_MUTATION_RETRY_DELAY_MS = 220;
const CAVSAFE_TREE_CACHE_KEY = "cb_cavsafe_tree_cache_v2";
const CAVSAFE_TREE_NAV_CACHE_KEY = `${CAVSAFE_TREE_CACHE_KEY}:nav`;
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
let m = "cb_cavsafe_activity",
  v = "cb_cavsafe_storage_history",
  p = "cb_cavsafe_storage_history_v1",
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
    label: "CavSafe",
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
    label: "Shared with you",
    icon: "shared"
  }, {
    key: "Trash",
    label: "Recently deleted",
    icon: "trash"
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
const CAVSAFE_THEME_OPTIONS = ["lime", "violet", "blue", "white", "clear"];
const CAVSAFE_THEME_PICKER_OPTIONS = [{
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
}];
const CAVSAFE_SETTINGS_DEFAULTS = {
  themeAccent: "lime",
  trashRetentionDays: 30,
  autoPurgeTrash: !0,
  preferDownloadUnknownBinary: !0,
  defaultIntegrityLockOnUpload: !1,
  defaultEvidenceVisibility: "LINK_ONLY",
  defaultEvidenceExpiryDays: 0,
  auditRetentionDays: 30,
  enableAuditExport: !0,
  timelockDefaultPreset: "none",
  notifySafeStorage80: !0,
  notifySafeStorage95: !0,
  notifySafeUploadFailures: !0,
  notifySafeMoveFailures: !0,
  notifySafeEvidencePublished: !1,
  notifySafeSnapshotCreated: !1,
  notifySafeTimeLockEvents: !1
};
function normalizeCavsafeEvidenceExpiryDays(e, a = 0) {
  let l = Number(null == e || "" === e ? a : e);
  if (!Number.isFinite(l)) return a;
  let t = Math.trunc(l);
  return 0 === t || 1 === t || 7 === t || 30 === t ? t : a;
}
function normalizeCavsafeClientSettings(e) {
  let a = e && "object" == typeof e ? e : {},
    l = {
      ...CAVSAFE_SETTINGS_DEFAULTS
    },
    t = String(a.themeAccent || "").trim();
  CAVSAFE_THEME_OPTIONS.includes(t) && (l.themeAccent = t);
  let s = Number(a.trashRetentionDays),
    i = Number.isFinite(s) ? Math.trunc(s) : l.trashRetentionDays;
  (7 === i || 14 === i || 30 === i) && (l.trashRetentionDays = i), "boolean" == typeof a.autoPurgeTrash && (l.autoPurgeTrash = a.autoPurgeTrash), "boolean" == typeof a.preferDownloadUnknownBinary && (l.preferDownloadUnknownBinary = a.preferDownloadUnknownBinary), "boolean" == typeof a.defaultIntegrityLockOnUpload && (l.defaultIntegrityLockOnUpload = a.defaultIntegrityLockOnUpload);
  let r = String(a.defaultEvidenceVisibility || "").trim();
  ("LINK_ONLY" === r || "PRIVATE" === r) && (l.defaultEvidenceVisibility = r), l.defaultEvidenceExpiryDays = normalizeCavsafeEvidenceExpiryDays(a.defaultEvidenceExpiryDays, l.defaultEvidenceExpiryDays);
  let c = Number(a.auditRetentionDays),
    o = Number.isFinite(c) ? Math.trunc(c) : l.auditRetentionDays;
  (7 === o || 14 === o || 30 === o || 90 === o) && (l.auditRetentionDays = o), "boolean" == typeof a.enableAuditExport && (l.enableAuditExport = a.enableAuditExport);
  let d = String(a.timelockDefaultPreset || "").trim();
  ("none" === d || "24h" === d || "7d" === d || "30d" === d) && (l.timelockDefaultPreset = d), "boolean" == typeof a.notifySafeStorage80 && (l.notifySafeStorage80 = a.notifySafeStorage80), "boolean" == typeof a.notifySafeStorage95 && (l.notifySafeStorage95 = a.notifySafeStorage95), "boolean" == typeof a.notifySafeUploadFailures && (l.notifySafeUploadFailures = a.notifySafeUploadFailures), "boolean" == typeof a.notifySafeMoveFailures && (l.notifySafeMoveFailures = a.notifySafeMoveFailures), "boolean" == typeof a.notifySafeEvidencePublished && (l.notifySafeEvidencePublished = a.notifySafeEvidencePublished), "boolean" == typeof a.notifySafeSnapshotCreated && (l.notifySafeSnapshotCreated = a.notifySafeSnapshotCreated), "boolean" == typeof a.notifySafeTimeLockEvents && (l.notifySafeTimeLockEvents = a.notifySafeTimeLockEvents);
  return l;
}
function normalizeCavsafePolicySummary(e) {
  let a = e && "object" == typeof e ? e : null,
    l = (e, l, t) => {
      let s = String(a?.[e]?.title || l || "").trim() || l,
        i = String(a?.[e]?.body || t || "").trim() || t;
      return {
        title: s,
        body: i
      };
    };
  return {
    ownerOnlyAccess: l("ownerOnlyAccess", "Owner-only access (enforced)", "Access is restricted to the CavBot Account Owner."),
    sharingDisabled: l("sharingDisabled", "Sharing disabled in CavSafe (enforced)", "Share links are disabled in CavSafe."),
    publishInsteadOfShare: l("publishInsteadOfShare", "Publish instead of share", "Use Publish to generate controlled evidence artifacts.")
  };
}
function resolveCavsafeInitialSection(pathname) {
  let p = String(pathname || "").trim().toLowerCase();
  if (p.startsWith("/cavsafe/settings")) return "Settings";
  if (p.startsWith("/cavsafe/dashboard")) return "Dashboard";
  return "Explore";
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
function F(e, a = "/cavsafe") {
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
  return "artifact" === e ? `/api/cavsafe/artifacts/${encodeURIComponent(a)}/preview?raw=1` : "trash" === e ? `/api/cavsafe/trash/${encodeURIComponent(a)}?raw=1` : "by_path" === e ? `/api/cavsafe/files/by-path?path=${encodeURIComponent(l)}&raw=1` : `/api/cavsafe/files/${encodeURIComponent(a)}?raw=1`;
}
function et(e) {
  let a = new URLSearchParams();
  return a.set("source", e.source), a.set("kind", String(e.previewKind || e.mediaKind || "unknown")), a.set("name", e.name), a.set("path", e.path), a.set("mime", e.mimeType), null != e.bytes && Number.isFinite(e.bytes) && a.set("bytes", String(Math.max(0, Math.trunc(e.bytes)))), e.createdAtISO && a.set("created", e.createdAtISO), e.modifiedAtISO && a.set("modified", e.modifiedAtISO), e.uploadedAtISO && a.set("uploaded", e.uploadedAtISO), e.uploadedBy && a.set("uploadedBy", e.uploadedBy), e.shareUrl && a.set("shareUrl", e.shareUrl), e.shareFileId && a.set("shareFileId", e.shareFileId), `/cavsafe/view/${encodeURIComponent(e.resourceId)}?${a.toString()}`;
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
function resolveCavsafeGreetingName(e) {
  let a = normalizeCavbotFounderProfile({
      fullName: e?.name,
      displayName: e?.name,
      username: e?.username
    }),
    l = String(a?.fullName || a?.displayName || "").trim();
  if (l) return l;
  let t = String(a?.username || "").trim().replace(/^@+/, "");
  return t ? `@${t}` : "";
}
function resolveCavsafeInitialChar(e) {
  let a = String(e || "").match(/[A-Za-z0-9]/);
  return a?.[0]?.toUpperCase() || "";
}
function resolveCavsafeInitialUsername(e) {
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
function resolveCavsafeInitials(e) {
  let a = String(e?.name || "").trim();
  if (a) {
    let e = a.split(/\s+/g).filter(Boolean);
    if (e.length >= 2) {
      let a = resolveCavsafeInitialChar(e[0] || ""),
        l = resolveCavsafeInitialChar(e[1] || ""),
        t = `${a}${l}`.trim();
      if (t) return t;
    }
    let l = resolveCavsafeInitialChar(e[0] || "");
    if (l) return l;
  }
  let l = resolveCavsafeInitialChar(resolveCavsafeInitialUsername(e?.username));
  if (l) return l;
  let t = resolveCavsafeInitialChar(e?.initials);
  return t || "";
}
function resolveCavsafePlanTier(e) {
  let a = String(e?.tierEffective || e?.tier || "").trim().toUpperCase();
  if ("PREMIUM_PLUS" === a || "PREMIUM+" === a || "ENTERPRISE" === a) return "PREMIUM_PLUS";
  if ("PREMIUM" === a || "PRO" === a || "PAID" === a) return "PREMIUM";
  return "FREE";
}
function resolveCavsafeDisplayPlanTier(e, a, l) {
  let t = String(a || "").trim().toLowerCase(),
    s = resolveCavsafeInitialUsername(l).trim().toLowerCase();
  return "cavbot admin" === t || "cavbot" === s ? "PREMIUM_PLUS" : resolveCavsafePlanTier({
    tier: e
  });
}
function readCachedCavsafeProfileState() {
  let e = {
    name: "",
    email: "",
    username: "",
    initials: "",
    publicProfileEnabled: "unknown"
  };
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return e;
  try {
    let a = normalizeCavbotFounderProfile({
        fullName: String(globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim(),
        displayName: String(globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim(),
        username: String(globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().replace(/^@+/, "").toLowerCase()
      }),
      l = String(globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
    return {
      name: String(a?.fullName || a?.displayName || "").trim(),
      email: String(globalThis.__cbLocalStore.getItem("cb_profile_email_v1") || "").trim(),
      username: String(a?.username || "").trim(),
      initials: String(globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim().slice(0, 3).toUpperCase(),
      publicProfileEnabled: "1" === l || "true" === l || "public" === l ? "public" : "0" === l || "false" === l || "private" === l ? "private" : "unknown"
    };
  } catch {
    return e;
  }
}
function readCachedCavsafePlanState() {
  let e = {
    planTier: "FREE",
    trialActive: !1,
    trialDaysLeft: 0
  };
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return e;
  try {
    let a = A(globalThis.__cbLocalStore.getItem("cb_shell_plan_snapshot_v1"));
    if (a && "object" == typeof a && !Array.isArray(a)) {
      let l = resolveCavsafePlanTier({
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
      let l = resolveCavsafePlanTier({
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
function persistCavsafeProfileState(eProfile, aInitials, lPublicProfileEnabled) {
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return;
  try {
    globalThis.__cbLocalStore.setItem("cb_profile_fullName_v1", String(eProfile?.name || "").trim());
    globalThis.__cbLocalStore.setItem("cb_profile_email_v1", String(eProfile?.email || "").trim());
    globalThis.__cbLocalStore.setItem("cb_profile_username_v1", String(eProfile?.username || "").trim());
    if (aInitials) globalThis.__cbLocalStore.setItem("cb_account_initials", aInitials);
    else globalThis.__cbLocalStore.removeItem("cb_account_initials");
    if ("public" === lPublicProfileEnabled || "private" === lPublicProfileEnabled) {
      globalThis.__cbLocalStore.setItem("cb_profile_public_enabled_v1", "public" === lPublicProfileEnabled ? "true" : "false");
    }
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("cb:profile", {
      detail: {
        fullName: String(eProfile?.name || "").trim(),
        email: String(eProfile?.email || "").trim(),
        username: String(eProfile?.username || "").trim(),
        initials: aInitials || ""
      }
    }));
  } catch {}
}
function persistCavsafePlanState(ePlanTier, aTrialState) {
  if ("undefined" == typeof window || "undefined" == typeof globalThis.__cbLocalStore) return;
  let l = {
      planTier: ePlanTier,
      memberRole: null,
      trialActive: !!aTrialState?.active,
      trialDaysLeft: aTrialState?.active ? Math.max(0, Math.trunc(Number(aTrialState?.daysLeft || 0)) || 0) : 0,
      ts: Date.now()
    },
    t = {
      planKey: "PREMIUM_PLUS" === ePlanTier ? "premium_plus" : "PREMIUM" === ePlanTier ? "premium" : "free",
      planLabel: "PREMIUM_PLUS" === ePlanTier ? "PREMIUM+" : "PREMIUM" === ePlanTier ? "PREMIUM" : "FREE",
      trialActive: !!aTrialState?.active
    };
  try {
    globalThis.__cbLocalStore.setItem("cb_shell_plan_snapshot_v1", JSON.stringify(l));
    globalThis.__cbLocalStore.setItem("cb_plan_context_v1", JSON.stringify(t));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("cb:plan", {
      detail: t
    }));
  } catch {}
}
function resolveCavsafeTrialState(e) {
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
function eu(e, a) {
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
  return await e.json().catch(() => null);
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
function pickUploadConcurrency(e) {
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
function safeUploadNodeName(e) {
  let a = String(e || "").trim();
  if (!a || "." === a || ".." === a) return null;
  if (/[/\\]/.test(a)) return null;
  let l = a.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!l) return null;
  return l.length > 220 ? l.slice(0, 220) : l;
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
  for (let aRoot of Array.isArray(e) ? e : []) {
    if (!aRoot) continue;
    let eName = safeUploadNodeName(String(aRoot.name || ""));
    if (!eName) continue;
    l.push({
      entry: aRoot,
      relativePath: eName
    });
  }
  for (; l.length;) {
    let eCurrent = l.shift();
    if (!eCurrent?.entry) continue;
    if (eCurrent.entry.isFile) {
      let lFile = null;
      try {
        lFile = await readFileSystemEntryFile(eCurrent.entry);
      } catch {
        continue;
      }
      lFile && a.push({
        file: lFile,
        relativePath: eCurrent.relativePath
      });
      continue;
    }
    if (!eCurrent.entry.isDirectory || "function" != typeof eCurrent.entry.createReader) continue;
    let t = null;
    try {
      t = eCurrent.entry.createReader();
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
      for (let tEntry of s) {
        if (!tEntry) continue;
        let sName = safeUploadNodeName(String(tEntry.name || ""));
        if (!sName) continue;
        let i = normalizeUploadRelativePath(`${eCurrent.relativePath}/${sName}`);
        i && l.push({
          entry: tEntry,
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
  for (let eItem of a) {
    let aEntry = "function" == typeof eItem?.webkitGetAsEntry ? eItem.webkitGetAsEntry() : "function" == typeof eItem?.getAsEntry ? eItem.getAsEntry() : null;
    aEntry && l.push(aEntry);
  }
  return l;
}
function getDataTransferFileSystemHandles(e) {
  let a = Array.from(e?.items || []),
    l = [];
  for (let eItem of a) {
    let aHandle = "function" == typeof eItem?.getAsFileSystemHandle ? eItem.getAsFileSystemHandle() : null;
    aHandle && l.push(aHandle);
  }
  return l;
}
async function collectUploadEntriesFromFileSystemHandles(e) {
  let a = [],
    l = [];
  for (let aPromise of Array.isArray(e) ? e : []) {
    let eHandle = null;
    try {
      eHandle = await aPromise;
    } catch {
      continue;
    }
    if (!eHandle || "string" != typeof eHandle.kind) continue;
    let t = safeUploadNodeName(String(eHandle.name || ""));
    if (!t) continue;
    l.push({
      handle: eHandle,
      relativePath: t
    });
  }
  for (; l.length;) {
    let eCurrent = l.shift();
    if (!eCurrent?.handle) continue;
    if ("file" === eCurrent.handle.kind) {
      let lFile = null;
      try {
        lFile = await eCurrent.handle.getFile();
      } catch {
        continue;
      }
      lFile && a.push({
        file: lFile,
        relativePath: eCurrent.relativePath
      });
      continue;
    }
    if ("directory" !== eCurrent.handle.kind || "function" != typeof eCurrent.handle.entries) continue;
    let t = eCurrent.handle.entries();
    if (!t || "function" != typeof t[Symbol.asyncIterator]) continue;
    try {
      for await (let [aName, aHandle] of t) {
        let tName = safeUploadNodeName(String(aName || ""));
        if (!tName || !aHandle) continue;
        let s = normalizeUploadRelativePath(`${eCurrent.relativePath}/${tName}`);
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
  for (let eFile of t) {
    let aRel = normalizeUploadRelativePath(String(eFile.webkitRelativePath || ""));
    if (r.length && (!aRel || !aRel.includes("/"))) continue;
    let lRel = aRel || normalizeUploadRelativePath(String(eFile.name || ""));
    if (!lRel) continue;
    let tFingerprint = uploadEntryFingerprint(lRel, eFile);
    c.has(tFingerprint) || (c.add(tFingerprint), r.push({
      file: eFile,
      relativePath: lRel
    }));
  }
  return r;
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
      height: 18
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
      height: 18
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
function eC() {
  return t.jsx(u, {
    children: t.jsx(ek, {})
  });
}
function ek() {
  var e;
  let a = (0, nav.usePathname)(),
    searchParams = (0, nav.useSearchParams)(),
    l = (0, nav.useRouter)(),
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
    [cachedProfileState] = (0, c.useState)(() => readCachedCavsafeProfileState()),
    [cachedPlanState] = (0, c.useState)(() => readCachedCavsafePlanState()),
    [S, J] = (0, c.useState)(() => resolveCavsafeInitialSection(a)),
    [z, q] = (0, c.useState)("/"),
    [en, ey] = (0, c.useState)(null),
    [eC, ek] = (0, c.useState)(!0),
    [ew, eS] = (0, c.useState)(!1),
    [eM, eI] = (0, c.useState)(""),
    [e$, eL] = (0, c.useState)(""),
    [eA, eT] = (0, c.useState)("lime"),
    [cavsafeSettings, setCavsafeSettings] = (0, c.useState)(() => ({
      ...CAVSAFE_SETTINGS_DEFAULTS
    })),
    [cavsafeSettingsLoaded, setCavsafeSettingsLoaded] = (0, c.useState)(!1),
    [cavsafeSettingsSaving, setCavsafeSettingsSaving] = (0, c.useState)(!1),
    [cavsafeAuditExporting, setCavsafeAuditExporting] = (0, c.useState)(!1),
    [cavsafeTier, setCavsafeTier] = (0, c.useState)("PREMIUM"),
    [cavsafeEnforcedPolicySummary, setCavsafeEnforcedPolicySummary] = (0, c.useState)(() => normalizeCavsafePolicySummary(null)),
    [eO, eF] = (0, c.useState)([]),
    [eP, eB] = (0, c.useState)(() => resolveCavsafeGreetingName(cachedProfileState)),
    [eR, eU] = (0, c.useState)(() => resolveCavsafeInitials({
      ...cachedProfileState,
      initials: cachedProfileState.initials
    })),
    [eE, eD] = (0, c.useState)(() => String(cachedProfileState.name || "").trim()),
    [e_, eW] = (0, c.useState)(() => String(cachedProfileState.email || "").trim()),
    [eH, eG] = (0, c.useState)(() => String(cachedProfileState.username || "").trim()),
    [profilePublicEnabled, setProfilePublicEnabled] = (0, c.useState)(() => cachedProfileState.publicProfileEnabled || "unknown"),
    [eK, eJ] = (0, c.useState)(() => resolveCavsafeDisplayPlanTier(cachedPlanState.planTier, cachedProfileState.name, cachedProfileState.username)),
    [eV, eZ] = (0, c.useState)(() => !!cachedPlanState.trialActive),
    [ez, eq] = (0, c.useState)(() => Math.max(0, Math.trunc(Number(cachedPlanState.trialDaysLeft || 0)) || 0)),
    [isCompactShell, setIsCompactShell] = (0, c.useState)(() => "undefined" != typeof window && !!window.matchMedia && window.matchMedia("(max-width: 980px)").matches),
    [mobileNavOpen, setMobileNavOpen] = (0, c.useState)(!1),
    [mobileSearchOpen, setMobileSearchOpen] = (0, c.useState)(!1),
    [eY, eQ] = (0, c.useState)([]),
    [eX, e0] = (0, c.useState)(!1),
    [e1, e2] = (0, c.useState)(""),
    [e4, e5] = (0, c.useState)(!1),
    [e3, e8] = (0, c.useState)(""),
    [e6, e7] = (0, c.useState)(""),
    [e9, ae] = (0, c.useState)(!1),
    [privateShareRole, setPrivateShareRole] = (0, c.useState)("viewer"),
    [privateSharePeople, setPrivateSharePeople] = (0, c.useState)([]),
    [privateSharePending, setPrivateSharePending] = (0, c.useState)([]),
    [privateShareLoading, setPrivateShareLoading] = (0, c.useState)(!1),
    [privateShareBusyUserId, setPrivateShareBusyUserId] = (0, c.useState)(""),
    [inviteAcceptBusy, setInviteAcceptBusy] = (0, c.useState)(!1),
    [aa, al] = (0, c.useState)(!1),
    [at, as] = (0, c.useState)(!1),
    [ai, ar] = (0, c.useState)(""),
    [ac, ao] = (0, c.useState)(""),
    [privateShareTarget, setPrivateShareTarget] = (0, c.useState)(null),
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
    [lm, lv] = (0, c.useState)(!1),
    [lp, lf] = (0, c.useState)(""),
    [lg, lx] = (0, c.useState)(null),
    [ly, lb] = (0, c.useState)(""),
    [lj, lN] = (0, c.useState)(null),
    [lC, lk] = (0, c.useState)(null),
    [lw, lS] = (0, c.useState)(null),
    [bulkDeleteTargets, setBulkDeleteTargets] = (0, c.useState)([]),
    [lM, lI] = (0, c.useState)([]),
    [l$, lL] = (0, c.useState)(!1),
    [lA, lT] = (0, c.useState)(""),
    [lO, lF] = (0, c.useState)(""),
    [lP, lB] = (0, c.useState)(""),
    [lR, lU] = (0, c.useState)(!1),
    [lE, lD] = (0, c.useState)("untitled.txt"),
    [createFolderTarget, setCreateFolderTarget] = (0, c.useState)("cavsafe"),
    [createFileTarget, setCreateFileTarget] = (0, c.useState)("cavsafe"),
    [l_, lW] = (0, c.useState)(null),
    [lH, lG] = (0, c.useState)(""),
    [lK, lJ] = (0, c.useState)("LINK_ONLY"),
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
    [deletingVisualKeys, setDeletingVisualKeys] = (0, c.useState)({}),
    [driveDebugLastFetchAt, setDriveDebugLastFetchAt] = (0, c.useState)(""),
    [driveDebugLastMutation, setDriveDebugLastMutation] = (0, c.useState)({
      type: "idle",
      status: "idle",
      atISO: ""
    }),
    [driveDebugOptimisticCount, setDriveDebugOptimisticCount] = (0, c.useState)(0),
    [driveDebugServerCount, setDriveDebugServerCount] = (0, c.useState)(0),
    folderPathFromQuery = (0, c.useMemo)(() => {
      try {
        let e = String(searchParams?.get("folderPath") || "").trim();
        return e ? T(e) : "";
      } catch {
        return "";
      }
    }, [searchParams]),
    inviteIdFromQuery = (0, c.useMemo)(() => {
      try {
        return String(searchParams?.get("inviteId") || "").trim();
      } catch {
        return "";
      }
    }, [searchParams]),
    driveDebugEnabled = (0, c.useMemo)(() => {
      try {
        return getDriveDebugEnabled(window.location.search);
      } catch {
        return !1;
      }
    }, [a]),
    cavsafeSettingsRef = (0, c.useRef)(cavsafeSettings),
    lV = (0, c.useRef)(null),
    lZ = (0, c.useRef)(null),
    lz = (0, c.useRef)(null),
    lq = (0, c.useRef)(null),
    lY = (0, c.useRef)(null),
    lQ = (0, c.useRef)(null),
    l1 = (0, c.useRef)(null),
    copyLinkModalInputRef = (0, c.useRef)(null),
    treeLoadRequestRef = (0, c.useRef)(0),
    galleryLoadRequestRef = (0, c.useRef)(0),
    treeHasLoadedRef = (0, c.useRef)(!1),
    folderLoadAbortRef = (0, c.useRef)(null),
    folderNavLockRef = (0, c.useRef)({
      path: "",
      ts: 0
    }),
    folderSelectTimerRef = (0, c.useRef)(null),
    snippetRequestedVersionRef = (0, c.useRef)(new Map()),
    routeDiagRef = (0, c.useRef)(""),
    lastFolderPathRef = (0, c.useRef)("/"),
    eyesDiagLoggedRef = (0, c.useRef)(!1),
    treePrefetchInFlightRef = (0, c.useRef)(new Set()),
    cancelPendingFolderSelect = (0, c.useCallback)(() => {
      null != folderSelectTimerRef.current && (window.clearTimeout(folderSelectTimerRef.current), folderSelectTimerRef.current = null);
    }, []),
    l2 = (0, c.useCallback)(e => {
      if (e !== S) {
        cancelPendingFolderSelect();
        null != folderLoadAbortRef.current && (folderLoadAbortRef.current.abort(), folderLoadAbortRef.current = null);
        aS(!1), setRecentsPage(1), w(), ab({}), ax(!1), lB("");
      }
      J(e);
    }, [S, cancelPendingFolderSelect, w]),
    l4 = (0, c.useCallback)(() => {
      null != lY.current && (window.clearTimeout(lY.current), lY.current = null), as(!1);
    }, []),
    resetTransientUi = (0, c.useCallback)((reason = "manual") => {
      // Root-cause fix (A2/A3): centralized transient cleanup prevents sticky non-interactive states.
      // Root-cause fix (C5): always clear transient menu/selection/drag state on navigation edges.
      cancelPendingFolderSelect(), l4(), aS(!1), ax(!1), ab({}), lB("");
      try {
        document.documentElement.style.removeProperty("overflow"), document.documentElement.style.removeProperty("pointer-events"), document.body.style.removeProperty("overflow"), document.body.style.removeProperty("pointer-events");
      } catch {}
      "production" !== process.env.NODE_ENV && console.debug("[CavSafe][diag] resetTransientUi", {
        reason,
        route: a,
        folderPath: T(z),
        previewOpen: b
      });
    }, [cancelPendingFolderSelect, l4, ax, ab, a, z, b]),
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
    applyCavsafeSettingsToUi = (0, c.useCallback)((settings, options = {}) => {
      let normalized = normalizeCavsafeClientSettings(settings);
      eT(normalized.themeAccent);
      let shouldApplyPublishDefaults = !!options.forcePublishDefaults || !l_;
      shouldApplyPublishDefaults && (lJ(normalized.defaultEvidenceVisibility), setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(normalized.defaultEvidenceExpiryDays, 0)));
    }, [l_]),
    updateCavsafeSettingsPatch = (0, c.useCallback)(async patch => {
      let previous = cavsafeSettingsRef.current || CAVSAFE_SETTINGS_DEFAULTS,
        optimistic = normalizeCavsafeClientSettings({
          ...previous,
          ...(patch && "object" == typeof patch ? patch : {})
        });
      setCavsafeSettings(optimistic), cavsafeSettingsRef.current = optimistic, applyCavsafeSettingsToUi(optimistic), setCavsafeSettingsSaving(!0);
      try {
        let e = await fetch("/api/cavsafe/settings", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(patch || {})
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) {
          let l = String(a?.error || "").trim().toUpperCase();
          throw Object.assign(Error(String(a?.message || "Failed to save settings.")), {
            code: l || "SETTINGS_SAVE_FAILED"
          });
        }
        let l = normalizeCavsafeClientSettings(a.settings),
          t = normalizeCavsafePolicySummary(a.enforcedPolicySummary);
        setCavsafeSettings(l), cavsafeSettingsRef.current = l, setCavsafeEnforcedPolicySummary(t), setCavsafeTier("PREMIUM_PLUS" === String(a.tier || "").trim().toUpperCase() ? "PREMIUM_PLUS" : "PREMIUM"), applyCavsafeSettingsToUi(l);
      } catch (e) {
        let aCode = String(e?.code || "").trim().toUpperCase();
        setCavsafeSettings(previous), cavsafeSettingsRef.current = previous, applyCavsafeSettingsToUi(previous), "PLAN_UPGRADE_REQUIRED" === aCode ? l3("watch", "Upgrade to Premium+ to update this setting.") : l3("bad", e instanceof Error ? e.message : "Failed to save settings.");
      } finally {
        setCavsafeSettingsSaving(!1);
      }
    }, [applyCavsafeSettingsToUi, l3]),
    loadCavsafeSettings = (0, c.useCallback)(async () => {
      try {
        let e = await fetch("/api/cavsafe/settings", {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to load settings."));
        let l = normalizeCavsafeClientSettings(a.settings),
          t = normalizeCavsafePolicySummary(a.enforcedPolicySummary);
        setCavsafeSettings(l), cavsafeSettingsRef.current = l, setCavsafeEnforcedPolicySummary(t), setCavsafeTier("PREMIUM_PLUS" === String(a.tier || "").trim().toUpperCase() ? "PREMIUM_PLUS" : "PREMIUM"), applyCavsafeSettingsToUi(l, {
          forcePublishDefaults: !0
        });
      } catch {
        let e = normalizeCavsafeClientSettings(CAVSAFE_SETTINGS_DEFAULTS);
        setCavsafeSettings(e), cavsafeSettingsRef.current = e, setCavsafeEnforcedPolicySummary(normalizeCavsafePolicySummary(null)), applyCavsafeSettingsToUi(e, {
          forcePublishDefaults: !0
        });
      } finally {
        setCavsafeSettingsLoaded(!0);
      }
    }, [applyCavsafeSettingsToUi]),
    exportCavsafeAuditLog = (0, c.useCallback)(async format => {
      let normalizedFormat = "csv" === String(format || "").trim().toLowerCase() ? "csv" : "json";
      setCavsafeAuditExporting(!0);
      try {
        let e = await fetch("/api/cavsafe/activity?limit=300", {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to export audit log."));
        let rows = Array.isArray(a.items) ? a.items : [],
          blob = null,
          downloadName = "";
        if ("csv" === normalizedFormat) {
          let escape = e => {
              let a = String(null == e ? "" : e).replace(/"/g, "\"\"");
              return `"${a}"`;
            },
            header = ["id", "action", "targetType", "targetId", "targetPath", "createdAtISO", "metaJson"],
            lines = rows.map(e => [escape(e?.id), escape(e?.action), escape(e?.targetType), escape(e?.targetId), escape(e?.targetPath), escape(e?.createdAtISO), escape(JSON.stringify(e?.metaJson || {}))].join(","));
          blob = new Blob([header.join(","), "\n", lines.join("\n")], {
            type: "text/csv;charset=utf-8"
          }), downloadName = "cavsafe-audit-log.csv";
        } else blob = new Blob([JSON.stringify(rows, null, 2)], {
          type: "application/json;charset=utf-8"
        }), downloadName = "cavsafe-audit-log.json";
        let url = URL.createObjectURL(blob),
          aLink = document.createElement("a");
        aLink.href = url, aLink.download = downloadName, document.body.appendChild(aLink), aLink.click(), aLink.remove(), window.setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 800), l3("good", "Audit log export started.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to export audit log.");
      } finally {
        setCavsafeAuditExporting(!1);
      }
    }, [l3]),
    setDriveMutationState = (0, c.useCallback)((type, status) => {
      setDriveDebugLastMutation({
        type: String(type || "unknown"),
        status: String(status || "idle"),
        atISO: new Date().toISOString()
      });
    }, []),
    logDriveDebug = (0, c.useCallback)((event, payload) => {
      debugDriveLog("safe", driveDebugEnabled, event, payload);
    }, [driveDebugEnabled]),
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
        let rowsRaw = A(globalThis.__cbSessionStore.getItem(CAVSAFE_TREE_NAV_CACHE_KEY)),
          rows = Array.isArray(rowsRaw) ? rowsRaw : [],
          next = [{
            path: a,
            ts: Date.now(),
            payload: snapshot
          }, ...rows.filter(e => T(String(e?.path || "/")) !== a)];
        globalThis.__cbSessionStore.setItem(CAVSAFE_TREE_NAV_CACHE_KEY, JSON.stringify(next.slice(0, 48)));
      } catch {}
    }, []),
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
        upsertTreeNavSnapshot(e.folder.path, l), globalThis.__cbLocalStore.setItem(CAVSAFE_TREE_CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          folderPath: e.folder.path,
          payload: l
        })), globalThis.__cbLocalStore.setItem(m, JSON.stringify((e.activity || []).slice(0, 80))), globalThis.__cbLocalStore.setItem(v, JSON.stringify((e.storageHistory || []).slice(-96))), globalThis.__cbLocalStore.setItem(p, JSON.stringify((e.storageHistory || []).slice(-96)));
      } catch {}
    }, [upsertTreeNavSnapshot]),
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
        g = formatSnippetForThumbnail(String(l?.previewSnippet || "")),
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
        previewSnippet: g,
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
        let l = [],
          t = [];
        for (let a of e) {
          let eId = String(a?.id || "").trim(),
            iKind = "folder" === String(a?.kind || "").trim() ? "folder" : "file",
            rPath = T(String(a?.path || "/"));
          if (!eId) continue;
          l.push({
            id: eId,
            kind: iKind,
            path: rPath
          }), t.push({
            kind: iKind,
            id: eId,
            name: String(a?.name || Z(rPath) || (iKind === "folder" ? "Folder" : "File")).trim() || (iKind === "folder" ? "Folder" : "File"),
            path: rPath
          });
        }
        if (!l.length) return a;
        let i = new Set(l.filter(e => "folder" === e.kind).map(e => e.id)),
          r = l.filter(e => "folder" === e.kind).map(e => e.path),
          c = new Set(l.filter(e => "file" === e.kind).map(e => e.id)),
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
        for (let eItem of t) {
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
        await fetch("/api/cavsafe/activity", {
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
        return (await fetch("/api/cavsafe/activity", {
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
          let a = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(l)}`, {
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
          if (lastStatus = a.status, lastMessage = String(t?.message || "").trim(), e < r - 1) {
            await new Promise(e => window.setTimeout(e, o));
            if (d.signal.aborted) return;
            continue;
          }
        }
        if (!payload?.folder || !payload?.usage) throw Error(lastMessage || `Failed to load folder (${lastStatus || 500})`);
        let cachedActivity = W(A(globalThis.__cbLocalStore.getItem(m))),
          cachedHistory = H(A(globalThis.__cbLocalStore.getItem(v)) || A(globalThis.__cbLocalStore.getItem(p))),
          payloadActivity = W(payload.activity),
          mergedActivity = payloadActivity.length ? payloadActivity : cachedActivity,
          payloadHistory = H(payload.storageHistory),
          mergedHistory = function (points, usedBytesInput, nowTsInput) {
            let sortedPoints = [...points].sort((e, a) => e.ts - a.ts),
              nextUsedBytes = Math.max(0, Math.trunc(usedBytesInput)),
              nowTs = Math.max(0, Math.trunc(nowTsInput)),
              latestPoint = sortedPoints.length ? sortedPoints[sortedPoints.length - 1] : null;
            if (latestPoint) {
              let msDelta = Math.max(0, nowTs - latestPoint.ts),
                bytesDelta = Math.abs(nextUsedBytes - latestPoint.usedBytes);
              if (msDelta < 36e5 && bytesDelta < 1048576) return sortedPoints;
            }
            return sortedPoints.push({
              ts: nowTs,
              usedBytes: nextUsedBytes,
              usedBytesExact: String(nextUsedBytes)
            }), sortedPoints.slice(-96);
          }(payloadHistory.length ? payloadHistory : cachedHistory, Number(payload.usage.usedBytes || 0), Date.now()),
          nextTree = {
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
        setDriveDebugServerCount(nextServerCount), setDriveDebugLastFetchAt(new Date().toISOString()), treeHasLoadedRef.current = !0, q(nextTree.folder.path), ey(nextTree), upsertTreeNavSnapshot(nextTree.folder.path, nextTree), logDriveDebug("tree.fetch.complete", {
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
                globalThis.__cbLocalStore.setItem(CAVSAFE_TREE_CACHE_KEY, JSON.stringify({
                  ts: Date.now(),
                  folderPath: nextTree.folder.path,
                  payload: a
                })), globalThis.__cbLocalStore.setItem(m, JSON.stringify(nextTree.activity.slice(0, 80))), globalThis.__cbLocalStore.setItem(v, JSON.stringify(nextTree.storageHistory.slice(-96))), globalThis.__cbLocalStore.setItem(p, JSON.stringify(nextTree.storageHistory.slice(-96)));
              } catch {}
            };
          "requestIdleCallback" in window ? window.requestIdleCallback(l, {
            timeout: 320
          }) : window.setTimeout(l, 0);
        } catch {}
      } catch (aErr) {
        if (d.signal.aborted) return;
        if (s !== treeLoadRequestRef.current) return;
        let e = aErr instanceof Error ? aErr.message : "Failed to load CavSafe.";
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
    }, [l3, logDriveDebug, upsertTreeNavSnapshot]),
    loadGalleryFiles = (0, c.useCallback)(async (e = {}) => {
      let a = e && "object" == typeof e ? e : {},
        l = galleryLoadRequestRef.current + 1;
      galleryLoadRequestRef.current = l, setGalleryAllLoading(!0);
      try {
        let e = await fetch("/api/cavsafe/gallery", {
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
        let e = await fetch("/api/cavsafe/shares", {
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
              type: null == l.artifact.type ? null : String(l.artifact.type)
            } : null
          });
          return a;
        }(a.items));
      } catch (a) {
        let e = a instanceof Error ? a.message : "Failed to load shared items.";
        e2(e), l3("bad", e);
      } finally {
        e0(!1);
      }
    }, [l3]),
    te = (0, c.useCallback)(async () => {
      ah(!0), av("");
      try {
        let ensureFolder = async (name, parentPath) => {
            let s = await fetch("/api/cavsafe/folders", {
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
                n = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(c)}&lite=1`, {
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
              let s = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(a)}&lite=1`, {
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
      void 0 === a.silent && (a.silent = !0), await l7(z, a), "Synced" === S && (await te());
    }, [S, z, te, l7]),
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
            source: "cavsafe",
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
    }, [tl]),
    closeInvitePrompt = (0, c.useCallback)(() => {
      let e = new URLSearchParams(String(searchParams?.toString() || ""));
      e.delete("inviteId");
      let a = e.toString();
      l.replace(a ? `/cavsafe?${a}` : "/cavsafe");
    }, [searchParams, l]),
    acceptInvitePrompt = (0, c.useCallback)(async () => {
      let e = String(inviteIdFromQuery || "").trim();
      if (!e) return;
      setInviteAcceptBusy(!0);
      try {
        let a = await fetch("/api/cavsafe/share/accept", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify({
              inviteId: e
            })
          }),
          t = await ev(a);
        if (!a.ok || !t?.ok) throw Error(String(t?.message || "Failed to accept invite."));
        await Promise.all([l9(), ta({
          silent: !0
        })]);
        l2("Shared"), l3("good", "Invite accepted."), closeInvitePrompt();
        try {
          window.dispatchEvent(new CustomEvent("cavcloud:share-access-changed"));
          window.dispatchEvent(new CustomEvent("cb:notifications:refresh", {
            detail: {
              source: "cavsafe_private_share"
            }
          }));
        } catch {}
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to accept invite.");
      } finally {
        setInviteAcceptBusy(!1);
      }
    }, [inviteIdFromQuery, l9, ta, l2, l3, closeInvitePrompt]);
  (0, c.useEffect)(() => {
    return () => {
      cancelPendingFolderSelect(), null != folderLoadAbortRef.current && folderLoadAbortRef.current.abort();
    };
  }, [cancelPendingFolderSelect]);
  (0, c.useEffect)(() => {
    try {
      l.prefetch("/cavcloud");
    } catch {}
  }, [l]);
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
      let lIdentity = normalizeCavbotFounderProfile({
          fullName: a?.fullName || a?.displayName || a?.name,
          displayName: a?.displayName || a?.name,
          username: a?.username
        }),
        l = {
          name: String(lIdentity?.fullName || lIdentity?.displayName || "").trim(),
          email: String(a?.email || "").trim(),
          username: String(lIdentity?.username || "").trim()
        },
        tInitials = String(a?.initials || "").trim(),
        sPublicProfileEnabled = "boolean" == typeof a?.publicProfileEnabled ? a.publicProfileEnabled ? "public" : "private" : profilePublicEnabled,
        iInitials = resolveCavsafeInitials({
          ...l,
          initials: tInitials
        });
      eD(l.name), eW(l.email), eG(l.username), eB(l.name || resolveCavsafeGreetingName(l)), eU(resolveCavsafeInitials({
        ...l,
        initials: tInitials
      })), setProfilePublicEnabled(sPublicProfileEnabled), persistCavsafeProfileState(l, iInitials, sPublicProfileEnabled);
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
          tTier = resolveCavsafeDisplayPlanTier(resolveCavsafePlanTier(lAccount), String(aPayload?.user?.fullName || aPayload?.user?.displayName || aPayload?.user?.name || "").trim(), String(aPayload?.user?.username || "").trim()),
          sTrial = resolveCavsafeTrialState(lAccount);
        eJ(tTier), eZ(sTrial.active), eq(sTrial.daysLeft), persistCavsafePlanState(tTier, sTrial);
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
    cavsafeSettingsRef.current = cavsafeSettings;
  }, [cavsafeSettings]);
  (0, c.useEffect)(() => {
    void loadCavsafeSettings();
  }, []);
  (0, c.useEffect)(() => {
    let e = resolveCavsafeInitialSection(a);
    if ("Settings" === e || "Dashboard" === e) {
      J(aPrev => aPrev === e ? aPrev : e);
      return;
    }
    J(aPrev => "Settings" === aPrev || "Dashboard" === aPrev ? "Explore" : aPrev);
  }, [a]);
  (0, c.useEffect)(() => {
    try {
      let e = A(globalThis.__cbLocalStore.getItem(CAVSAFE_TREE_CACHE_KEY)),
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
  }, [upsertTreeNavSnapshot]);
  (0, c.useEffect)(() => {
    let e = "/";
    try {
      // Root-cause fix (C1): URL is authoritative for folder navigation state.
      if (folderPathFromQuery) {
        e = folderPathFromQuery;
      } else {
        let a = A(globalThis.__cbLocalStore.getItem(CAVSAFE_TREE_CACHE_KEY)),
          l = String(a?.folderPath || "").trim();
        l && (e = T(l));
      }
    } catch {}
    void l7(e);
  }, [l7, folderPathFromQuery]);
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
    "Synced" === S && void te();
  }, [S, te]);
  (0, c.useEffect)(() => {
    "Shared" === S && void l9();
  }, [S, l9]);
  (0, c.useEffect)(() => {
    "Gallery" === S && void loadGalleryFiles({
      silent: !0
    });
  }, [S, loadGalleryFiles]);
  (0, c.useEffect)(() => {
    "Gallery" === S && setGalleryPage(1);
  }, [S, aj, eM]);
  (0, c.useEffect)(() => {
    inviteIdFromQuery && l2("Shared");
  }, [inviteIdFromQuery, l2]);
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
      void Promise.all(["Shared" === S ? l9() : Promise.resolve(), "Gallery" === S ? loadGalleryFiles({
        silent: !0
      }) : Promise.resolve(), ta({
        silent: !0
      })]);
    };
    return window.addEventListener("cavcloud:share-access-changed", e), () => {
      window.removeEventListener("cavcloud:share-access-changed", e);
    };
  }, [S, l9, loadGalleryFiles, ta]);
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
          treePrefetchInFlightRef.current.add(ePath), void fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(ePath)}&lite=1`, {
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
      namespace: "safe",
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
        a = eM.trim().toLowerCase(),
        l = /(?:^|\s)(@locked|is:locked|locked:true)(?=\s|$)/.test(a),
        t = a.replace(/(?:^|\s)(@locked|is:locked|locked:true)(?=\s|$)/g, " ").trim(),
        s = l ? e.filter(e => !!e.immutableAtISO) : e;
      return t ? s.filter(e => e.name.toLowerCase().includes(t) || e.path.toLowerCase().includes(t)) : s;
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
    tUsedRatio = (0, c.useMemo)(() => {
      if (!en?.usage) return 0;
      let {
        usedBytes: e,
        limitBytes: a
      } = en.usage;
      if (null == a || a <= 0) return 0;
      return Math.max(0, Math.min(1, e / a));
    }, [en?.usage]),
    tC = (0, c.useMemo)(() => Math.round(100 * tUsedRatio), [tUsedRatio]),
    tk = tC >= 80 && tC < 100,
    tw = tC >= 100,
    tS = P(en?.usage?.limitBytes ?? null),
    tM = P(en?.usage?.usedBytes ?? 0),
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
      let e = en?.usage?.usedBytes ?? 0,
        a = en?.usage?.limitBytes ?? null;
      return null == a ? null : Math.max(0, a - e);
    }, [en?.usage?.limitBytes, en?.usage?.usedBytes])),
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
    t_ = (0, c.useMemo)(() => function (e) {
      let a = String(e.name || "").trim();
      if (a) return a;
      let l = String(e.email || "").trim();
      return l ? l : String(e.username || "").trim() || "CavSafe user";
    }({
      name: eE,
      email: e_,
      username: eH
    }), [eE, e_, eH]),
    tW = (0, c.useCallback)(e => {
      let a = ePreviewKind(e.mimeType, e.name),
        l = ee(e.mimeType, e.name),
        t = el("file", e.id, e.path),
        s = {
          id: e.id,
          resourceId: e.id,
          source: "file",
          previewKind: a,
          mediaKind: a,
          name: e.name,
          path: e.path,
          mimeType: l,
          bytes: Number.isFinite(e.bytes) ? Math.max(0, Number(e.bytes)) : null,
          createdAtISO: e.createdAtISO,
          modifiedAtISO: e.updatedAtISO,
          uploadedAtISO: e.createdAtISO,
          uploadedBy: t_,
          rawSrc: t,
          downloadSrc: `${t}&download=1`,
          openHref: "",
          shareFileId: e.id
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
        r = {
          id: String(e.previewId || `path:${a}`),
          resourceId: "by-path",
          source: "by_path",
          previewKind: s,
          mediaKind: s,
          name: l,
          path: a,
          mimeType: t,
          bytes: null,
          createdAtISO: e.createdAtISO || null,
          modifiedAtISO: e.modifiedAtISO || null,
          uploadedAtISO: e.createdAtISO || null,
          uploadedBy: t_,
          rawSrc: i,
          downloadSrc: i,
          openHref: "",
          shareFileId: null
        };
      return r.openHref = et(r), r;
    }, [t_]),
    tG = (0, c.useCallback)(e => {
      if ("file" !== e.kind) return null;
      let a = ePreviewKind("", e.name || e.path);
      let l = ee("", e.name || e.path),
        t = el("trash", e.id, e.path),
        s = {
          id: e.id,
          resourceId: e.id,
          source: "trash",
          previewKind: a,
          mediaKind: a,
          name: e.name,
          path: e.path,
          mimeType: l,
          bytes: null,
          createdAtISO: null,
          modifiedAtISO: e.deletedAtISO,
          uploadedAtISO: null,
          uploadedBy: t_,
          rawSrc: t,
          downloadSrc: t,
          openHref: "",
          shareFileId: null
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
        r = {
          id: e.item.id,
          resourceId: a,
          source: "artifact",
          previewKind: s,
          mediaKind: s,
          name: e.shareName,
          path: l,
          mimeType: t,
          bytes: null,
          createdAtISO: e.item.createdAtISO,
          modifiedAtISO: e.item.createdAtISO,
          uploadedAtISO: e.item.createdAtISO,
          uploadedBy: t_,
          shareUrl: e.item.shareUrl,
          rawSrc: i,
          downloadSrc: `${i}&download=1`,
          openHref: "",
          shareFileId: null
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
        d = o && e.artifact?.id ? `/api/cavsafe/artifacts/${encodeURIComponent(e.artifact.id)}/preview?raw=1` : "";
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
    t4 = (0, c.useMemo)(() => "folders" === aO ? "No shared folders yet." : "files" === aO ? "No shared files yet." : "gallery" === aO ? "No shared photos or videos yet." : "visited_links" === aO ? "No visited shared links yet." : "shared" === aO ? "Nothing shared with you yet." : "No shared items yet.", [aO]),
    t5 = (0, c.useMemo)(() => "folders" === aA ? "No starred folders yet." : "files" === aA ? "No starred files yet." : "gallery" === aA ? "No starred gallery items yet." : "No starred items yet.", [aA]),
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
    sDeleteTargets = (0, c.useMemo)(() => {
      let e = Array.isArray(bulkDeleteTargets) ? bulkDeleteTargets : [];
      return e.length ? e : si;
    }, [bulkDeleteTargets, si]),
    sDeleteCount = sDeleteTargets.length,
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
        let i = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(e)}`, {
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
      ew || (lS(null), lT(""), setBulkDeleteTargets([]));
    }, [ew]),
    sM = (0, c.useCallback)(async () => {
      if (!lO || !si.length) return;
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of si) {
          if ("folder" === l.kind) {
            let t = await fetch(`/api/cavsafe/folders/${encodeURIComponent(l.id)}`, {
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
          let t = await fetch(`/api/cavsafe/files/${encodeURIComponent(l.id)}`, {
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
    sI = (0, c.useCallback)(async eItems => {
      let aTargets = Array.isArray(eItems) && eItems.length ? eItems : sDeleteTargets;
      if (!aTargets.length) {
        l3("watch", "Select at least one item to move to recently deleted.");
        lS(null), setBulkDeleteTargets([]);
        return;
      }
      let l = [...aTargets];
      lS(null), setBulkDeleteTargets([]), setDriveMutationState("delete.to_trash", "started"), logDriveDebug("delete.start", {
        itemCount: l.length
      }), markDeletingVisual(l), eS(!0);
      let e = 0,
        a = 0;
      try {
        await new Promise(e => window.setTimeout(e, CAVCLOUD_DELETE_VISUAL_MS));
        optimisticallyMoveItemsToTrash(l);
        await runWithConcurrency(l, 6, async l => {
          if ("folder" === l.kind) {
            let t = await fetch(`/api/cavsafe/folders/${encodeURIComponent(l.id)}`, {
                method: "DELETE"
              }),
              s = await ev(t);
            t.ok && s?.ok ? e += 1 : a += 1;
            return;
          }
          let t = await fetch(`/api/cavsafe/files/${encodeURIComponent(l.id)}`, {
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
    }, [sb, l3, sDeleteTargets, markDeletingVisual, clearDeletingVisual, optimisticallyMoveItemsToTrash, setDriveMutationState, logDriveDebug, refreshTreePostMutation]),
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
            s ? (ep(`/api/cavsafe/files/${encodeURIComponent(s)}?raw=1&download=1`), e += 1) : a += 1;
            continue;
          }
          if ("folder" === t.kind) {
            let s = await fetch(`/api/cavsafe/folders/${encodeURIComponent(t.id)}/zip`, {
                method: "POST"
              }),
              i = await ev(s),
              r = String(i?.file?.id || "").trim();
            if (!s.ok || !i?.ok || !r) {
              a += 1;
              continue;
            }
            ep(`/api/cavsafe/files/${encodeURIComponent(r)}?raw=1&download=1`), e += 1, l += 1;
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
        l && (ep(`/api/cavsafe/artifacts/${encodeURIComponent(l)}/preview?raw=1&download=1`), e += 1);
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
            s = await fetch(`/api/cavsafe/shares/${encodeURIComponent(t)}/revoke`, {
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
          let t = await fetch("/api/cavsafe/trash/restore", {
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
      eS(!0);
      let e = 0,
        a = 0;
      try {
        for (let l of sTrashSel) {
          let t = await fetch(`/api/cavsafe/trash/${encodeURIComponent(l.id)}?permanent=1`, {
              method: "DELETE"
            }),
            s = await ev(t);
          t.ok && s?.ok ? e += 1 : a += 1;
        }
        e > 0 && l3("good", `Removed ${e} item${1 === e ? "" : "s"} from CavSafe.`), a > 0 && l3("bad", `${a} item${1 === a ? "" : "s"} could not be removed.`), await refreshTreePostMutation("mutation"), sb();
      } finally {
        eS(!1);
      }
    }, [sb, l3, ta, sTrashSel]),
    loadPrivateShareDetails = (0, c.useCallback)(async (itemId, opts = {}) => {
      let id = String(itemId || "").trim();
      if (!id) {
        setPrivateSharePeople([]), setPrivateSharePending([]);
        return;
      }
      setPrivateShareLoading(!0);
      try {
        let e = await fetch(`/api/cavsafe/items/${encodeURIComponent(id)}`, {
            method: "GET",
            cache: "no-store"
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to load access details."));
        setPrivateSharePeople(Array.isArray(a.peopleWithAccess) ? a.peopleWithAccess : []), setPrivateSharePending(Array.isArray(a.pending) ? a.pending : []);
      } catch (e) {
        if (!opts?.silent) {
          let a = e instanceof Error ? e.message : "Failed to load private share details.";
          l3("bad", a);
        }
      } finally {
        setPrivateShareLoading(!1);
      }
    }, [l3]),
    sShareRevoke = (0, c.useCallback)(async e => {
      let a = String(privateShareTarget?.id || "").trim(),
        l = String(e || "").trim();
      if (!a || !l) return;
      setPrivateShareBusyUserId(`revoke:${l}`);
      try {
        let e = await fetch("/api/cavsafe/share/revoke", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify({
              itemId: a,
              targetUserId: l
            })
          }),
          t = await ev(e);
        if (!e.ok || !t?.ok) throw Error(String(t?.message || "Failed to revoke access."));
        await Promise.all([loadPrivateShareDetails(a, {
          silent: !0
        }), l9(), ta({
          silent: !0
        })]);
        try {
          window.dispatchEvent(new CustomEvent("cavcloud:share-access-changed"));
        } catch {}
        l3("good", "Access revoked.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to revoke access.");
      } finally {
        setPrivateShareBusyUserId("");
      }
    }, [privateShareTarget?.id, loadPrivateShareDetails, l9, l3, ta]),
    sShareRole = (0, c.useCallback)(async (e, a) => {
      let l = String(privateShareTarget?.id || "").trim(),
        t = String(e || "").trim(),
        s = String(a || "").trim().toLowerCase();
      if (!l || !t) return;
      if (!["owner", "editor", "viewer"].includes(s)) return;
      setPrivateShareBusyUserId(`role:${t}`);
      try {
        let e = await fetch("/api/cavsafe/share/role", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify({
              itemId: l,
              targetUserId: t,
              role: s
            })
          }),
          a = await ev(e);
        if (!e.ok || !a?.ok) throw Error(String(a?.message || "Failed to update role."));
        await loadPrivateShareDetails(l, {
          silent: !0
        }), l3("good", "Access updated.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to update role.");
      } finally {
        setPrivateShareBusyUserId("");
      }
    }, [privateShareTarget?.id, loadPrivateShareDetails, l3]),
    sF = (0, c.useCallback)(e => {
      let a = e || sm;
      if (!a) {
        l3("watch", "Select one file or folder to share.");
        return;
      }
      let id = String(a.id || "").trim();
      if (!id) {
        l3("watch", "Select one file or folder to share.");
        return;
      }
      let kind = "folder" === String(a.kind || "").toLowerCase() ? "folder" : "file",
        path = String(a.path || "").trim(),
        name = String(a.name || "").trim() || Z(path) || "CavSafe item";
      l4(), ar(""), e8(""), e7(""), setPrivateShareRole("viewer"), setPrivateSharePeople([]), setPrivateSharePending([]), setPrivateShareTarget({
        id,
        kind,
        name,
        path
      }), ao(id), e5(!0), void loadPrivateShareDetails(id, {
        silent: !0
      });
    }, [l4, l3, sm, loadPrivateShareDetails]),
    sP = (0, c.useCallback)(() => {
      l4(), ar(""), e5(!1), ao(""), e8(""), e7(""), setPrivateShareRole("viewer"), setPrivateSharePeople([]), setPrivateSharePending([]), setPrivateShareBusyUserId(""), setPrivateShareTarget(null);
    }, [l4]),
    sB = (0, c.useCallback)(async () => {
      let e = String(privateShareTarget?.id || "").trim();
      if (!e) return;
      let a = String(e3 || "").trim();
      if (!a) {
        l3("bad", "Add a username or email.");
        return;
      }
      let t = String(privateShareRole || "viewer").trim().toLowerCase();
      ["owner", "editor", "viewer"].includes(t) || (t = "viewer");
      let s = a.replace(/^@+/, "").trim(),
        i = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(a),
        r = i ? {
          email: a.toLowerCase()
        } : {
          username: s
        };
      if (!i && !s) {
        l3("bad", "Add a username or email.");
        return;
      }
      ae(!0);
      try {
        let a = await fetch("/api/cavsafe/share/invite", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify({
              itemId: e,
              invitee: r,
              role: t
            })
          }),
          s = await ev(a);
        if (!a.ok || !s?.ok) throw Error(String(s?.message || "Failed to send invite."));
        e8(""), e7(""), await Promise.all([loadPrivateShareDetails(e, {
          silent: !0
        }), l9(), ta({
          silent: !0
        })]);
        try {
          window.dispatchEvent(new CustomEvent("cavcloud:share-access-changed"));
          window.dispatchEvent(new CustomEvent("cb:notifications:refresh", {
            detail: {
              source: "cavsafe_private_share"
            }
          }));
        } catch {}
        l3("good", "Invite sent.");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to send invite.");
      } finally {
        ae(!1);
      }
    }, [privateShareTarget?.id, e3, privateShareRole, l3, loadPrivateShareDetails, l9, ta]),
    sR = (0, c.useCallback)(async e => {
      let a = e?.file || sv;
      if (!a) return "";
      let l = String(ai || "").trim();
      if (l && (!e?.file || sv?.id === a.id)) return l;
      al(!0);
      try {
        let e = await fetch("/api/cavsafe/shares/link", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              fileId: a.id,
              expiresInDays: 30
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
    }, [sv, l3, ai]),
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
        let e = A(globalThis.__cbSessionStore.getItem(CAVSAFE_TREE_NAV_CACHE_KEY));
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
    }, [cancelPendingFolderSelect, S, z, l2, l7, en?.trash, en?.usage, en?.activity, en?.storageHistory]),
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
        let e = await fetch("/api/cavsafe/folders", {
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
        let e = await fetch("/api/cavsafe/sync/upsert", {
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
        let l = await fetch(`/api/cavsafe/files/${encodeURIComponent(e.id)}`, {
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
      let l = await fetch(`/api/cavsafe/folders/${encodeURIComponent(e.id)}`, {
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
        let a = await fetch(`/api/cavsafe/files/${encodeURIComponent(e.id)}/duplicate`, {
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
        let a = await fetch(`/api/cavsafe/files/${encodeURIComponent(e.id)}/zip`, {
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
        let a = await fetch(`/api/cavsafe/folders/${encodeURIComponent(e.id)}/zip`, {
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
        let a = await fetch("/api/cavsafe/share", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              kind: e.kind,
              id: e.id,
              expiresInDays: 30
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
    }, [l9, l3, openCopyLinkModal, ta]),
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
        sF(e);
        return;
      }
      let a = tE.get(e.id);
      if (a) {
        sF(a);
        return;
      }
      sF(e);
    }, [sr, si, l3, tE, sF]),
    sY = (0, c.useCallback)(async () => {
      if (!l_) return;
      let e = String(lH || l_.name || "").trim().slice(0, 140);
      eS(!0);
      try {
        let a = await fetch("/api/artifacts/publish", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cavbot-csrf": "1"
            },
            body: JSON.stringify({
              fileId: l_.id,
              title: e,
              typeLabel: V(l_.name),
              visibility: lK,
              expiresInDays: publishExpiryDays
            })
          }),
          l = await ev(a);
        if (!a.ok || !l?.ok) throw Error(String(l?.message || "Failed to publish file."));
        let tDefaults = cavsafeSettingsRef.current || CAVSAFE_SETTINGS_DEFAULTS;
        emitPublicArtifactsSyncFromWorkspace(), l3("good", "Published to Public Artifacts."), lW(null), lG(""), lJ(tDefaults.defaultEvidenceVisibility), setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(tDefaults.defaultEvidenceExpiryDays, 0)), await refreshTreePostMutation("mutation");
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to publish file.");
      } finally {
        eS(!1);
      }
    }, [l_, lH, lK, publishExpiryDays, l3, ta]),
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
        let a = "folder" === lg.kind ? `/api/cavsafe/folders/${encodeURIComponent(lg.id)}` : `/api/cavsafe/files/${encodeURIComponent(lg.id)}`,
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
      lN(e);
    }, []),
    s0 = (0, c.useCallback)(async () => {
      if (!lj) return;
      let a = lj;
      lN(null), setDriveMutationState("delete.file", "started"), logDriveDebug("delete.start", {
        itemCount: 1,
        kind: "file",
        fileId: a.id
      }), markDeletingVisual([{
        id: a.id,
        kind: "file",
        name: a.name,
        path: a.path
      }]), eS(!0);
      try {
        await new Promise(e => window.setTimeout(e, CAVCLOUD_DELETE_VISUAL_MS));
        optimisticallyMoveItemsToTrash([{
          id: a.id,
          kind: "file",
          name: a.name,
          path: a.path
        }]);
        let l = await fetch(`/api/cavsafe/files/${encodeURIComponent(a.id)}`, {
            method: "DELETE"
          }),
          t = await ev(l);
        if (!l.ok || !t?.ok) throw Error(String(t?.message || "Failed to delete file."));
        l3("good", "File moved to recently deleted."), await refreshTreePostMutation("delete.file"), setDriveMutationState("delete.file", "success"), logDriveDebug("delete.finish", {
          itemCount: 1,
          kind: "file",
          status: "success",
          fileId: a.id
        });
      } catch (e) {
        l3("bad", e instanceof Error ? e.message : "Failed to delete file."), setDriveMutationState("delete.file", "failed"), logDriveDebug("delete.finish", {
          itemCount: 1,
          kind: "file",
          status: "failed",
          message: e instanceof Error ? e.message : "Failed to delete file.",
          fileId: a.id
        }), await refreshTreePostMutation("delete.file");
      } finally {
        clearDeletingVisual([{
          id: a.id,
          kind: "file",
          name: a.name,
          path: a.path
        }]), eS(!1);
      }
    }, [lj, l3, setDriveMutationState, logDriveDebug, markDeletingVisual, clearDeletingVisual, optimisticallyMoveItemsToTrash, refreshTreePostMutation]),
    s1 = (0, c.useCallback)(async e => {
      eS(!0);
      try {
        let a = await fetch("/api/cavsafe/trash/restore", {
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
      let a = lC;
      lk(null), eS(!0);
      try {
        let l = await fetch(`/api/cavsafe/trash/${encodeURIComponent(a.id)}?permanent=1`, {
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
    }, [l3, ta, lC]),
    s5 = (0, c.useCallback)(async (e, a = !1) => {
      if (a) {
        ep(`/api/cavsafe/files/${encodeURIComponent(e.id)}?raw=1&download=1`);
        return;
      }
      let l = tW(e);
      if (l) {
        tV(l);
        return;
      }
      l3("watch", "Preview unavailable.");
    }, [tW, tV, l3]),
    s3 = (0, c.useCallback)(e => tV(tW(e)), [tW, tV]),
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
    ie = (0, c.useCallback)(() => {
      N && tZ(N);
    }, [tZ, N]),
    ia = (0, c.useCallback)(async () => {
      if (N) try {
        let e = String(N.shareUrl || "").trim();
        if (!e) {
          let a = N.shareFileId ? tE.get(N.shareFileId) : null;
          if (!a && "by_path" === N.source) try {
            let e = await fetch(`/api/cavsafe/files/by-path?path=${encodeURIComponent(T(N.path))}`, {
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
        l3("watch", "Only CavSafe files can be shared from preview.");
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
      let l = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(a)}&lite=1`, {
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
      if (!String(eK || "").trim().toUpperCase().includes("PLUS")) {
        l3("watch", "CavSafe mount to CavCode Viewer is available on Premium+."), l.push("/plan");
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
              sourceType: "CAVSAFE",
              mode: "READ_ONLY",
              priority: 0
            })
          }),
          i = await ev(s);
        if (!s.ok || !i?.ok) throw Error(String(i?.message || "Failed to mount folder."));
        await refreshTreePostMutation("mount.create");
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
    }, [eK, l3, l, resolveWorkspaceProjectId, resolveMountFolderByPath, refreshTreePostMutation]),
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
      if (!String(eK || "").trim().toUpperCase().includes("PLUS")) {
        l3("watch", "CavSafe mount to CavCode Viewer is available on Premium+."), l.push("/plan");
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
      let l = T(e);
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
        let i = await fetch("/api/cavsafe/folders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: s,
            parentPath: e
          })
        });
        if (!i.ok) {
          let e = await ev(i),
            a = String(e?.error || "").trim();
          if ("PATH_CONFLICT" === a) {
            let t = await fetch(`/api/cavsafe/tree?folder=${encodeURIComponent(l)}&lite=1`, {
                method: "GET",
                cache: "no-store"
              }),
              s = await ev(t);
            if (t.ok && s?.ok && s.folder) return;
          }
          throw Error(String(e?.message || `Failed to ensure folder path ${l}`));
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
    is = (0, c.useCallback)(async (e, a) => {
      let l = ei(e),
        t = new URLSearchParams({
          name: e.name,
          folderPath: a
        }),
        s = await fetch(`/api/cavsafe/upload?${t.toString()}`, {
          method: "POST",
          headers: {
            "Content-Type": l,
            "x-cavcloud-filename": e.name
          },
          body: e
        }),
        i = await ev(s);
      if (!s.ok || !i?.ok) throw Error(String(i?.message || "Simple upload failed."));
      return i?.file || null;
    }, []),
    ii = (0, c.useCallback)(async (e, a) => {
      let l = ei(e),
        t = await fetch("/api/cavsafe/uploads/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            name: e.name,
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
          f = await fetch(`/api/cavsafe/uploads/${encodeURIComponent(i)}/part?partNumber=${l}`, {
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
        d = await fetch(`/api/cavsafe/uploads/${encodeURIComponent(i)}/complete`, {
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
    ir = (0, c.useCallback)(async (e, a) => {
      return e.size >= CAVCLOUD_MULTIPART_THRESHOLD_BYTES ? await ii(e, a) : await is(e, a);
    }, [ii, is]),
    ic = (0, c.useCallback)(async (e, a) => {
      if (!e.length) return;
      let l = Number(en?.usage?.perFileMaxBytes || 0);
      if (!(l > 0) || (e.some(e => e.size > l) && l3("watch", `Per-file max: ${P(l)}`), (e = e.filter(e => e.size <= l)).length)) {
        setDriveMutationState("upload.files", "started"), logDriveDebug("upload.start", {
          kind: "files",
          fileCount: e.length,
          folderPath: z
        });
        eS(!0);
        try {
          let t = pickUploadConcurrency(e),
            s = 0,
            i = 0,
            r = "",
            c = [],
            d = e.map((e, idx) => {
              let tempId = `tmp_upload_${Date.now()}_${idx}_${Math.random().toString(16).slice(2)}`,
                tempPath = O(z, e.name);
              return {
                file: e,
                tempId,
                tempPath
              };
            });
          for (let e of d) optimisticallyUpsertUploadedFile({
            id: e.tempId,
            name: e.file.name,
            path: e.tempPath,
            bytes: Number(e.file.size) || 0,
            mimeType: ei(e.file)
          }, z);
          await runWithConcurrency(d, t, async e => {
            try {
              let a = await ir(e.file, z);
              optimisticallyUpsertUploadedFile(a || {
                id: e.tempId,
                name: e.file.name,
                path: e.tempPath,
                bytes: Number(e.file.size) || 0,
                mimeType: ei(e.file)
              }, z), s += 1, c.push(String(a?.name || e.file.name || "").trim());
            } catch (a) {
              optimisticallyRemoveUploadPlaceholder(e.tempId, e.tempPath), i += 1, r || (r = a instanceof Error ? a.message : "Upload failed.");
            }
          });
          if (s > 0 && a) {
            let t = c.filter(Boolean).slice(0, 250);
            await l8({
              action: a,
              targetPath: z,
              metaJson: {
                fileCount: s,
                fileNames: t
              }
            });
          }
          s > 0 && (l3("good", `Uploaded ${s} file${1 === s ? "" : "s"}.`), await refreshTreePostMutation("upload.files"), setDriveMutationState("upload.files", "success"), logDriveDebug("upload.finish", {
            kind: "files",
            uploadedCount: s,
            failedCount: i,
            folderPath: z
          }));
          i > 0 && (l3("bad", 0 === s ? r || `Upload failed for ${i} file${1 === i ? "" : "s"}.` : `${i} file${1 === i ? "" : "s"} failed to upload.`), s <= 0 && (setDriveMutationState("upload.files", "failed"), logDriveDebug("upload.finish", {
            kind: "files",
            uploadedCount: s,
            failedCount: i,
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
    }, [z, l3, en?.usage?.perFileMaxBytes, ir, l8, optimisticallyUpsertUploadedFile, optimisticallyRemoveUploadPlaceholder, refreshTreePostMutation, setDriveMutationState, logDriveDebug]),
    io = (0, c.useCallback)(async (e, a = z) => {
      if (!Array.isArray(e) || !e.length) return;
      let lRootPath = T(String(a || z)),
        tEntries = e.map(e => {
          let aFile = e?.file instanceof File ? e.file : e instanceof File ? e : null;
          if (!(aFile instanceof File)) return null;
          let lRel = normalizeUploadRelativePath(String(e?.relativePath || aFile.webkitRelativePath || aFile.name || ""));
          if (!lRel) return null;
          let tParts = lRel.split("/").filter(Boolean),
            sName = tParts.pop() || aFile.name;
          if (!sName) return null;
          let iTargetPath = tParts.length ? O(lRootPath, tParts.join("/")) : lRootPath;
          return {
            file: aFile,
            name: sName,
            targetPath: iTargetPath
          };
        }).filter(e => !!e);
      if (!tEntries.length) return;
      let s = Number(en?.usage?.perFileMaxBytes || 0);
      if (s > 0 && (tEntries.some(e => e.file.size > s) && l3("watch", `Per-file max: ${P(s)}`), tEntries = tEntries.filter(e => e.file.size <= s), !tEntries.length)) return;
      setDriveMutationState("upload.folder", "started"), logDriveDebug("upload.start", {
        kind: "folder",
        fileCount: tEntries.length,
        folderPath: lRootPath
      }), eS(!0);
      try {
        let eUploadQueue = tEntries.map((eEntry, idx) => {
            let eTempPath = O(eEntry.targetPath, eEntry.name);
            return {
              idx,
              file: eEntry.file,
              name: eEntry.name,
              targetPath: eEntry.targetPath,
              tempId: `tmp_upload_${Date.now()}_${idx}_${Math.random().toString(16).slice(2)}`,
              tempPath: eTempPath
            };
          }),
          aPaths = Array.from(new Set(eUploadQueue.map(e => e.targetPath))).sort((e, a) => T(e).split("/").length - T(a).split("/").length),
          l = new Map();
        await runWithConcurrency(aPaths, CAVCLOUD_FOLDER_ENSURE_CONCURRENCY, async e => {
          await it(e, l);
        });
        for (let ePlaceholder of eUploadQueue) optimisticallyUpsertUploadedFile({
          id: ePlaceholder.tempId,
          name: ePlaceholder.name,
          path: ePlaceholder.tempPath,
          bytes: Number(ePlaceholder.file.size) || 0,
          mimeType: ei(ePlaceholder.file, ePlaceholder.name)
        }, ePlaceholder.targetPath);
        let t = pickUploadConcurrency(eUploadQueue.map(e => e.file)),
          s = 0,
          i = 0,
          r = "";
        await runWithConcurrency(eUploadQueue, t, async e => {
          let a = e.name === e.file.name ? e.file : new File([e.file], e.name, {
            type: ei(e.file, e.name),
            lastModified: e.file.lastModified
          });
          try {
            let lUploaded = await ir(a, e.targetPath);
            optimisticallyUpsertUploadedFile(lUploaded || {
              id: e.tempId,
              name: e.name,
              path: e.tempPath,
              bytes: Number(a.size) || 0,
              mimeType: ei(a, e.name)
            }, e.targetPath), s += 1;
          } catch (eErr) {
            optimisticallyRemoveUploadPlaceholder(e.tempId, e.tempPath), i += 1, r || (r = eErr instanceof Error ? eErr.message : "Folder upload failed.");
          }
        });
        s > 0 && (await l8({
          action: "upload.folder",
          targetPath: lRootPath,
          metaJson: {
            fileCount: s
          }
        }), l3("good", `Uploaded folder (${s} file${1 === s ? "" : "s"}).`), await refreshTreePostMutation("upload.folder"), setDriveMutationState("upload.folder", "success"), logDriveDebug("upload.finish", {
          kind: "folder",
          uploadedCount: s,
          failedCount: i,
          folderPath: lRootPath
        }));
        i > 0 && (l3("bad", 0 === s ? r || "Folder upload failed." : `${i} file${1 === i ? "" : "s"} failed while uploading folder.`), s <= 0 && (setDriveMutationState("upload.folder", "failed"), logDriveDebug("upload.finish", {
          kind: "folder",
          uploadedCount: s,
          failedCount: i,
          folderPath: lRootPath
        })));
      } catch (eErr) {
        l3("bad", eErr instanceof Error ? eErr.message : "Folder upload failed."), setDriveMutationState("upload.folder", "failed"), logDriveDebug("upload.finish", {
          kind: "folder",
          status: "failed",
          message: eErr instanceof Error ? eErr.message : "Folder upload failed.",
          folderPath: lRootPath
        });
      } finally {
        eS(!1);
      }
    }, [it, z, l3, en?.usage?.perFileMaxBytes, ir, l8, optimisticallyUpsertUploadedFile, optimisticallyRemoveUploadPlaceholder, refreshTreePostMutation, setDriveMutationState, logDriveDebug]),
    id = (0, c.useCallback)(async e => {
      let a = Array.from(e.currentTarget.files || []);
      e.currentTarget.value = "", await ic(a);
    }, [ic]),
    iu = (0, c.useCallback)(async e => {
      let a = e.currentTarget,
        l = Array.from(a.files || []),
        t = getInputFileSystemEntries(a);
      a.value = "";
      let s = [];
      try {
        s = await collectFolderUploadEntries({
          fileSystemEntries: t,
          files: l
        });
      } catch {}
      await io(s.length ? s : l, z);
    }, [io, z]),
    ih = (0, c.useCallback)(async e => {
      let a = Array.from(e.currentTarget.files || []);
      e.currentTarget.value = "", await ic(a, "upload.camera_roll");
    }, [ic]),
    iCreateFolderWithTarget = (0, c.useCallback)(async (e, a) => {
      let l = "cavcloud" === a ? "cavcloud" : "cavsafe";
      if ("cavsafe" === l) return await sG(e);
      let t = String(e || "").trim();
      if (!t) return l3("watch", "Folder name is required."), !1;
      eS(!0);
      try {
        let e = await fetch("/api/cavcloud/folders", {
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
        return l3("good", "Folder created in CavCloud."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create folder."), !1;
      } finally {
        eS(!1);
      }
    }, [sG, l3, ta]),
    iCreateFileWithTarget = (0, c.useCallback)(async (e, a) => {
      let iTarget = "cavcloud" === a ? "cavcloud" : "cavcode" === a ? "cavcode" : "cavsafe";
      if ("cavsafe" === iTarget) return await sK(e);
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
        let i = await fetch("/api/cavcloud/sync/upsert", {
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
        return l3("good", "File created in CavCloud."), await refreshTreePostMutation("mutation"), !0;
      } catch (e) {
        return l3("bad", e instanceof Error ? e.message : "Failed to create file."), !1;
      } finally {
        eS(!1);
      }
    }, [sK, l3, ta, l]),
    im = (0, c.useCallback)(async () => {
      (await iCreateFolderWithTarget(lp, createFolderTarget)) && (lv(!1), lf(""), setCreateFolderTarget("cavsafe"), lh(!1));
    }, [iCreateFolderWithTarget, lp, createFolderTarget]),
    iv = (0, c.useCallback)(async () => {
      (await iCreateFileWithTarget(lE, createFileTarget)) && (lU(!1), lD("untitled.txt"), setCreateFileTarget("cavsafe"), lh(!1));
    }, [lE, iCreateFileWithTarget, createFileTarget]),
    ip = (0, c.useCallback)(e => {
      if (!ew && !eC) {
        if ("create.folder" === e) {
          lh(!1), lf(""), setCreateFolderTarget("cavsafe"), lv(!0);
          return;
        }
        if ("create.file" === e) {
          lh(!1), lD("untitled.txt"), setCreateFileTarget("cavsafe"), lU(!0);
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
          lh(!1), l3("watch", "Google Drive import is currently available in CavCloud.");
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
      }), markDeletingVisual([a]), eS(!0);
      try {
        await new Promise(e => window.setTimeout(e, CAVCLOUD_DELETE_VISUAL_MS));
        optimisticallyMoveItemsToTrash([a]);
        let l = await fetch(`/api/cavsafe/folders/${encodeURIComponent(e.id)}`, {
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
    }, [l3, setDriveMutationState, logDriveDebug, markDeletingVisual, clearDeletingVisual, optimisticallyMoveItemsToTrash, refreshTreePostMutation]),
    iy = (0, c.useCallback)(e => {
      let a = cavsafeSettingsRef.current || CAVSAFE_SETTINGS_DEFAULTS;
      lW(e), lG(e.name), lJ(a.defaultEvidenceVisibility), setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(a.defaultEvidenceExpiryDays, 0));
    }, []),
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
          await sJ(l, a.id), l3("good", `${"folder" === l.kind ? "Folder" : "File"} moved.`), await refreshTreePostMutation("mutation");
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
      let s = [];
      try {
        s = await collectFolderUploadEntries({
          fileSystemEntries: sEntries,
          fileSystemHandles: sHandles,
          files: t
        });
      } catch {}
      let i = s.length ? s : t,
        rIsFolderDrop = i.some(e => String(e?.relativePath || e?.webkitRelativePath || "").replace(/\\/g, "/").includes("/"));
      if (rIsFolderDrop) {
        await io(i, a.path);
        return;
      }
      if (!t.length) {
        l3("watch", "Folder drop is unsupported in this browser. Use Upload Folder.");
        return;
      }
      if (t.length) {
        eS(!0);
        try {
          for (let e of t) await ir(e, a.path);
          l3("good", `Uploaded ${t.length} file${1 === t.length ? "" : "s"} to ${a.name}.`), await refreshTreePostMutation("mutation");
        } catch (e) {
          l3("bad", e instanceof Error ? e.message : "Folder upload failed.");
        } finally {
          eS(!1);
        }
      }
    }, [sJ, l3, ib, refreshTreePostMutation, ir, io]),
    ik = "Explore" === S || "Folders" === S || "Files" === S || "Gallery" === S,
    iw = "Search CavSafe",
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
    cavsafeIsPremiumPlus = (0, c.useMemo)(() => "PREMIUM_PLUS" === String(cavsafeTier || "").trim().toUpperCase() || String(eK || "").trim().toUpperCase().includes("PLUS"), [cavsafeTier, eK]),
    cavsafeSettingsBusy = ew || cavsafeSettingsSaving,
    iP = (0, c.useMemo)(() => "all" !== aR || "24h" !== a_ || !!aH.trim() || !!aK.trim(), [aH, aK, aR, a_]),
    mountFeatureLockedMessage = "Available on premium+  or upgrade to premium+",
    canUseMountFeature = (0, c.useMemo)(() => String(eK || "").trim().toUpperCase().includes("PLUS"), [eK]),
    isRecentsFiltersActive = (0, c.useMemo)(() => "all" !== recentsKind || "24h" !== recentsTimeline, [recentsKind, recentsTimeline]),
    isSyncedFiltersActive = (0, c.useMemo)(() => "all" !== syncedSource || "24h" !== syncedTimeline, [syncedSource, syncedTimeline]),
    iB = (0, c.useMemo)(() => {
      if ("Explore" === S) {
        let e = String(en?.folder?.name || "").trim();
        return e && "root" !== e.toLowerCase() ? e : "CavSafe";
      }
      if ("Trash" === S) return "Recently deleted";
      return S;
    }, [S, en?.folder?.name]),
    iR = (0, c.useMemo)(() => "grid_large" === aC ? "is-grid-large" : "list" === aC ? "is-list" : "list_large" === aC ? "is-list-large" : "is-grid", [aC]),
    iU = (0, c.useMemo)(() => "grid_large" === aM ? "is-grid-large" : "list" === aM ? "is-list" : "list_large" === aM ? "is-list-large" : "is-grid", [aM]),
    iE = (0, c.useMemo)(() => "grid_large" === a$ ? "is-grid-large" : "list" === a$ ? "is-list" : "list_large" === a$ ? "is-list-large" : "is-grid", [a$]),
    iD = (0, c.useMemo)(() => "grid_large" === aE ? "is-grid-large" : "list" === aE ? "is-list" : "list_large" === aE ? "is-list-large" : "is-grid", [aE]),
    i_ = (0, c.useMemo)(() => "Dashboard" === S ? `${tB.length} events • ${tR.length} starred` : "Explore" === S ? `${ts.length} folders • ${ti.length} files` : "Recents" === S ? `${tB.length} events` : "Synced" === S ? `${tSyncedCounts.total} events` : "Folders" === S ? `${ts.length} folders` : "Files" === S ? `${tx.length} files` : "Gallery" === S ? "images" === aj ? `${tn.photos} photo${1 === tn.photos ? "" : "s"}` : "videos" === aj ? `${tn.videos} video${1 === tn.videos ? "" : "s"}` : "mobile" === aj ? `${tn.total} mobile upload${1 === tn.total ? "" : "s"}` : `${tc.photos} photo${1 === tc.photos ? "" : "s"} • ${tc.videos} video${1 === tc.videos ? "" : "s"}` : "Starred" === S ? "folders" === aA ? `${tz.length} folder${1 === tz.length ? "" : "s"}` : "files" === aA ? `${tz.length} file${1 === tz.length ? "" : "s"}` : "gallery" === aA ? `${tz.length} gallery item${1 === tz.length ? "" : "s"}` : `${tz.length} item${1 === tz.length ? "" : "s"}` : "Shared" === S ? "gallery" === aO ? `${t2.photos} photo${1 === t2.photos ? "" : "s"} • ${t2.videos} video${1 === t2.videos ? "" : "s"}` : "folders" === aO ? `${t2.folders} folder${1 === t2.folders ? "" : "s"}` : "files" === aO ? `${t2.files} file${1 === t2.files ? "" : "s"}` : "visited_links" === aO ? `${t2.total} visited item${1 === t2.total ? "" : "s"}` : "recents" === aO ? `${t2.total} recent item${1 === t2.total ? "" : "s"}` : `${t2.total} shared item${1 === t2.total ? "" : "s"}` : "Trash" === S ? "restorations" === a1 ? `${tg.length} restoration${1 === tg.length ? "" : "s"}` : `${th.length} item${1 === th.length ? "" : "s"}` : "Workspace preferences", [S, tR.length, tx.length, ts.length, ti.length, tB.length, tSyncedCounts.total, tSyncedCounts.cavpad, tSyncedCounts.cavcode, tc.photos, tc.videos, aj, tn.photos, tn.total, tn.videos, aO, aA, t2.activeLinks, t2.files, t2.folders, t2.photos, t2.total, t2.videos, eX, tz.length, tg.length, th.length, a1]),
    dashboardOpenFilePreview = (0, c.useCallback)(async e => {
      let a = String(e?.fileId || "").trim(),
        l = T(String(e?.path || "/").trim() || "/");
      if (a) {
        let eFile = tE.get(a);
        if (eFile) {
          await s5(eFile, !1);
          return;
        }
      }
      if (l && "/" !== l) {
        s9({
          targetType: "file",
          targetPath: l,
          createdAtISO: String(e?.createdAt || new Date().toISOString())
        });
        return;
      }
      l3("watch", "Preview unavailable.");
    }, [tE, s5, s9, l3]),
    iW = t.jsx("div", {
      className: "cavcloud-folderGrid",
      children: ts.map(e => {
        let a = !!ay[K("folder", e.id)],
          l = !!deletingVisualKeys[K("folder", e.id)],
          i = {
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
            onDragStart: e => ij(e, i),
            onClick: e => {
              e.detail <= 1 && sN(i, e);
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
          l = a ? `/api/cavsafe/files/${encodeURIComponent(e.id)}?raw=1` : "",
          s = b && u === e.id,
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
          className: `cavcloud-fileCard ${o ? "is-selected" : ""} ${s ? "is-preview-selected" : ""} ${d ? "is-deleting" : ""}`,
          children: [(0, t.jsxs)("button", {
            type: "button",
            className: "cavcloud-fileTile",
            "data-desktop-select-item": "true",
            disabled: ew || eC,
            draggable: !ag,
            onDragStart: e => ij(e, c),
            onClick: i => {
              if (i.detail > 1) return;
              sN(c, i);
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
              children: e.name
            })]
          })]
        }, e.id);
      })
    }),
    iX = t.jsx("div", {
      className: "cavcloud-fileGrid",
      children: tx.map(e => {
        let a = Q(e),
          l = a ? `/api/cavsafe/files/${encodeURIComponent(e.id)}?raw=1` : "",
          s = b && u === e.id,
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
          className: `cavcloud-fileCard ${o ? "is-selected" : ""} ${s ? "is-preview-selected" : ""} ${d ? "is-deleting" : ""}`,
          children: [(0, t.jsxs)("button", {
            type: "button",
            className: "cavcloud-fileTile",
            "data-desktop-select-item": "true",
            disabled: ew || eC,
            draggable: !ag,
            onDragStart: e => ij(e, c),
            onClick: i => {
              if (i.detail > 1) return;
              sN(c, i);
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
              children: e.name
            })]
          })]
        }, e.id);
      })
    });
  (0, c.useEffect)(() => {
    if ("production" === process.env.NODE_ENV) return;
    if (eyesDiagLoggedRef.current) return;
    eyesDiagLoggedRef.current = !0, console.debug("[CavSafe][diag] CavBot eyes mounted");
  }, []);
  (0, c.useEffect)(() => {
    let e = `${a}?folderPath=${encodeURIComponent(folderPathFromQuery || "/")}`;
    routeDiagRef.current && routeDiagRef.current !== e && "production" !== process.env.NODE_ENV && console.debug("[CavSafe][diag] route transition", {
      from: routeDiagRef.current,
      to: e,
      spa: !0
    }), routeDiagRef.current = e, resetTransientUi("route-change");
  }, [a, folderPathFromQuery, resetTransientUi]);
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
      console.debug("[CavSafe][diag] preview state", {
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
        let e = await fetch("/api/cavsafe/files/snippets", {
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
    let e = {};
    for (let a of td) {
      let l = Q(a);
      l && (e[a.id] = `/api/cavsafe/files/${encodeURIComponent(a.id)}?raw=1`);
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
    if ("undefined" == typeof window || "function" != typeof window.matchMedia) return;
    let e = window.matchMedia("(max-width: 980px)"),
      a = () => {
        setIsCompactShell(e.matches);
      };
    return a(), e.addEventListener ? (e.addEventListener("change", a), () => {
      e.removeEventListener("change", a);
    }) : (e.addListener(a), () => {
      e.removeListener(a);
    });
  }, []);
  (0, c.useEffect)(() => {
    isCompactShell || (setMobileNavOpen(!1), setMobileSearchOpen(!1));
  }, [isCompactShell]);
  (0, c.useEffect)(() => {
    setMobileNavOpen(!1), setMobileSearchOpen(!1);
  }, [S]);
  (0, c.useEffect)(() => {
    let e = T(String(N?.path || ""));
    if (!e || "/" === e) return;
    let a = quickMountFileOptions.find(a => T(String(a?.path || "")) === e);
    a && ("file" !== mountQuickKind && setMountQuickKind("file"), mountQuickTargetId !== a.id && setMountQuickTargetId(a.id));
  }, [N?.path, quickMountFileOptions, mountQuickKind, mountQuickTargetId]);
  let profileHandle = resolveCavsafeInitialUsername(eH).trim().toLowerCase(),
    publicProfileHref = buildCanonicalPublicProfileHref(profileHandle),
    profileMenuLabel = "public" === profilePublicEnabled ? "Public Profile" : "private" === profilePublicEnabled ? "Private Profile" : "Profile",
    surfaceTitle = "CavSafe Secured Storage",
    displayPlanTier = resolveCavsafeDisplayPlanTier(eK, eE || eP, eH),
    surfaceVerified = "PREMIUM_PLUS" === displayPlanTier,
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
    openCavCloud = (0, c.useCallback)(() => {
      cancelPendingFolderSelect(), null != folderLoadAbortRef.current && (folderLoadAbortRef.current.abort(), folderLoadAbortRef.current = null), w();
      try {
        globalThis.__cbSessionStore.setItem("cb_surface_nav", "cavsafe_to_cavcloud"), globalThis.__cbSessionStore.setItem("cb_surface_nav_ts", String(Date.now()));
      } catch {}
      l.push("/cavcloud");
    }, [cancelPendingFolderSelect, l, w]),
    openSurfaceSettings = (0, c.useCallback)(() => {
      setSettingsPage(1), l2("Settings");
    }, [l2]);
  return (0, t.jsxs)("div", {
    className: "cavcloud-root",
    "data-theme": eA,
    children: [isCompactShell && mobileNavOpen ? t.jsx("button", {
      type: "button",
      className: "cavcloud-sideBackdrop",
      "aria-label": "Close menu",
      onClick: () => setMobileNavOpen(!1)
    }) : null, (0, t.jsxs)("aside", {
      id: "cavsafe-mobile-nav",
      className: `cavcloud-side ${isCompactShell && mobileNavOpen ? "is-mobile-open" : ""}`,
      children: [(0, t.jsxs)("div", {
        className: "cavcloud-brand",
        children: [t.jsx(CavSurfaceSidebarBrandMenu, {
          surfaceTitle: surfaceTitle
        })]
      }), t.jsx("nav", {
        className: "cavcloud-nav",
        "aria-label": "CavSafe navigation",
        children: M.map(e => {
          let isActive = S === e.key || "Explore" === e.key && ("Explore" === S || "Folders" === S || "Files" === S);
          return (0, t.jsxs)("button", {
            type: "button",
            className: `cavcloud-navItem ${isActive ? "is-active" : ""}`,
            onClick: () => {
              if ("Settings" === e.key) {
                l2("Settings"), setMobileNavOpen(!1);
                return;
              }
              l2(e.key), setMobileNavOpen(!1);
            },
            "aria-current": isActive ? "page" : void 0,
            children: [t.jsx(eg, {
              icon: e.icon
            }), e.label]
          }, e.key);
        })
      }), t.jsx(CavSurfaceSidebarFooter, {
        accountName: eE || eP,
        profileMenuLabel: profileMenuLabel,
        planTier: displayPlanTier,
        trialActive: eV,
        trialDaysLeft: ez,
        onOpenSettings: openSurfaceSettings,
        onOpenProfile: openSurfaceProfile,
        onOpenPlans: openPlans,
        onLogout: logoutToAuth,
        surface: "cavsafe",
        galleryActive: "Gallery" === S,
        onOpenGallery: () => l2("Gallery"),
        onOpenCompanion: openCavCloud,
        companionLabel: "Open CavCloud",
        companionIconSrc: "/logo/cavbot-logomark.svg",
        companionIconAlt: "CavCloud logomark",
        companionIconClassName: "cavcloud-surfaceLauncherActionIconMark",
        companionIconWidth: 18,
        companionIconHeight: 18,
        cavAiSurface: "cavsafe",
        cavAiContextLabel: "CavSafe context"
      })]
    }), (0, t.jsxs)("main", {
      className: "cavcloud-main",
      children: [(0, t.jsxs)("div", {
        className: "cavcloud-top",
        children: [t.jsxs("div", {
          className: "cavcloud-title cavcloud-titleGreetingSlot",
          children: [isCompactShell ? t.jsx("button", {
            type: "button",
            className: "cavcloud-btn cavcloud-btnGhost cavcloud-btnIconOnly cavcloud-mobileHeaderBtn cavcloud-mobileMenuBtn",
            onClick: () => {
              setMobileSearchOpen(!1), setMobileNavOpen(e => !e);
            },
            "aria-label": mobileNavOpen ? "Close menu" : "Open menu",
            "aria-expanded": mobileNavOpen,
            "aria-controls": "cavsafe-mobile-nav",
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
          }) : null, t.jsx(CavSurfaceHeaderGreeting, {
            accountName: eE || eP,
            showVerified: surfaceVerified
          })]
        }), (0, t.jsxs)("div", {
          className: "cavcloud-actions",
          children: [isCompactShell ? t.jsx("button", {
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
          }) : null, isCompactShell ? null : t.jsx("input", {
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
          }), (0, t.jsxs)("button", {
            className: `cavcloud-btn cavcloud-btnPrimary cavcloud-btnUpload ${isCompactShell ? "is-mobile" : ""}`,
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
            }), isCompactShell ? null : t.jsx("span", {
              className: "cavcloud-btnUploadLabel",
              children: "New"
            })]
          })]
        })]
      }), isCompactShell && mobileSearchOpen ? t.jsx("div", {
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
      }), driveDebugEnabled ? (0, t.jsxs)("section", {
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
                  "aria-label": "Choose CavSafe section",
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
              }) : "Explore" === S ? i_ : "Synced" === S ? (0, t.jsxs)("div", {
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
                  children: "Remove from CavSafe"
                }, "trash_remove")] : [t.jsx("button", {
                  className: "cavcloud-trashActionMenuItem",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    lB(""), void sw();
                  },
                  children: "Move"
                }), t.jsx("button", {
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
                    lB(""), void sShareSelected();
                  },
                  children: "Share"
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
                  className: "cavcloud-trashActionMenuItem is-danger",
                  type: "button",
                  disabled: ew || eC || 0 === sr,
                  onClick: () => {
                    if (!si.length) {
                      lB(""), l3("watch", "Select at least one item to move to recently deleted.");
                      return;
                    }
                    lB(""), setBulkDeleteTargets([...si]), lS("delete");
                  },
                  children: "Delete"
                })]
              }) : null]
            })]
          }) : null, e$ ? t.jsx("div", {
            className: "cavcloud-empty",
            children: e$
          }) : null, "Dashboard" === S ? t.jsx(CavSafeOwnerCommandDashboard, {
            isActive: "Dashboard" === S,
            isBusy: ew || eC,
            mutationSignal: String(driveDebugLastMutation.atISO || ""),
            localMoves: [],
            onOpenSection: e => l2(e),
            onOpenLockedFiles: () => {
              eI("@locked"), l2("Files");
            },
            onJumpToFolderPath: e => void s_(e),
            onOpenFilePreview: dashboardOpenFilePreview,
            onOpenArtifacts: () => l2("Shared"),
            onOpenMounts: () => {
              l2("Settings");
            },
            onOpenUploadPicker: () => lV.current?.click(),
            onRefreshAfterCommand: () => refreshTreePostMutation("dashboard.command")
          }) : null, "Dashboard" === S ? null : "__legacy_dashboard__" === S ? (0, t.jsxs)("div", {
            className: "cavcloud-homeDash",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-homeDashHead",
              children: [t.jsx("div", {
                className: "cavcloud-homeDashTitle",
                children: "Dashboard"
              }), t.jsx("div", {
                className: "cavcloud-homeDashSub",
                children: "Overview only. Open CavSafe to manage folders and files."
              })]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-homeGrid",
              children: [(0, t.jsxs)("section", {
                className: "cavcloud-homeCard cavcloud-homeCardStorage",
                "aria-label": "Storage summary",
                children: [t.jsx("div", {
                  className: "cavcloud-homeTitleRow",
                  children: (0, t.jsxs)("div", {
                    className: "cavcloud-homeTitleWithIcon",
                    children: [t.jsx("svg", {
                      className: "cavcloud-homeTitleIcon",
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: t.jsx("path", {
                        d: "M4.6 10.4h14.8M4.6 15.2h14.8M6.6 5.6h10.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2V7.6a2 2 0 0 1 2-2Z",
                        stroke: "currentColor",
                        strokeWidth: "1.6",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-homeTitle",
                      children: "Storage analytics"
                    })]
                  })
                }), t.jsx("div", {
                  className: "cavcloud-homeDashSub",
                  children: sa
                }), se ? (0, t.jsxs)("div", {
                  className: "cavcloud-storageChartWrap",
                  children: [(0, t.jsxs)("svg", {
                    className: "cavcloud-storageChart",
                    viewBox: `0 0 ${se.width} ${se.height}`,
                    role: "img",
                    "aria-label": "Storage usage trend chart",
                    children: [se.yTicks.map((e, a) => t.jsx("g", {
                      children: t.jsx("line", {
                        x1: "0",
                        y1: e.y,
                        x2: se.width,
                        y2: e.y,
                        className: "cavcloud-storageChartGrid"
                      })
                    }, a)), t.jsx("path", {
                      d: se.areaPath,
                      className: "cavcloud-storageChartArea"
                    }), t.jsx("path", {
                      d: se.linePath,
                      className: "cavcloud-storageChartLine"
                    }), se.coords.map((e, a) => t.jsx("circle", {
                      cx: e.x,
                      cy: e.y,
                      r: a === se.coords.length - 1 ? 3.2 : 2.3,
                      className: "cavcloud-storageChartPoint"
                    }, a))]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-storageChartMeta",
                    children: [t.jsx("span", {
                      children: se.latest ? B(new Date(se.latest.ts).toISOString()) : "Now"
                    }), (0, t.jsxs)("span", {
                      children: [Number.isFinite(e = se.deltaBytes) && 0 !== e ? `${e > 0 ? "+" : "-"}${P(Math.abs(e))}` : "0 B", " from previous point"]
                    })]
                  })]
                }) : t.jsx("div", {
                  className: "cavcloud-empty",
                  children: "No storage trend yet."
                }), t.jsx("div", {
                  className: "cavcloud-storageLegend",
                  children: t7.map(e => (0, t.jsxs)("div", {
                    className: "cavcloud-storageLegendItem",
                    children: [t.jsx("span", {
                      className: "cavcloud-storageLegendSwatch",
                      style: {
                        background: e.color
                      },
                      "aria-hidden": "true"
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-storageLegendText",
                      children: [t.jsx("span", {
                        children: e.label
                      }), (0, t.jsxs)("span", {
                        children: [P(e.bytes), " • ", e.count, " file", 1 === e.count ? "" : "s"]
                      })]
                    }), (0, t.jsxs)("span", {
                      className: "cavcloud-storageLegendPct",
                      children: [e.percentage.toFixed(e.percentage >= 10 ? 0 : 1), "%"]
                    })]
                  }, e.key))
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-itemMix",
                  children: [t.jsx("div", {
                    className: "cavcloud-itemMixTitle",
                    children: "Items mapped"
                  }), t.jsx("div", {
                    className: "cavcloud-itemMixBar",
                    "aria-label": "Mapped item composition",
                    children: t9.filter(e => e.count > 0).map(e => t.jsx("span", {
                      className: "cavcloud-itemMixSegment",
                      style: {
                        width: `${e.percentage}%`,
                        background: e.color
                      },
                      title: `${e.label}: ${e.count}`
                    }, e.key))
                  }), t.jsx("div", {
                    className: "cavcloud-itemMixLegend",
                    children: t9.map(e => (0, t.jsxs)("div", {
                      className: "cavcloud-itemMixLegendItem",
                      children: [t.jsx("span", {
                        className: "cavcloud-itemMixDot",
                        style: {
                          background: e.color
                        },
                        "aria-hidden": "true"
                      }), t.jsx("span", {
                        children: e.label
                      }), t.jsx("span", {
                        children: e.count
                      })]
                    }, e.key))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-homeList",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-homeRow",
                    children: [t.jsx("span", {
                      children: "Used"
                    }), t.jsx("span", {
                      children: tM
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-homeRow",
                    children: [t.jsx("span", {
                      children: "Free"
                    }), t.jsx("span", {
                      children: tA
                    })]
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-homeRow",
                    children: [t.jsx("span", {
                      children: "Total"
                    }), t.jsx("span", {
                      children: tS
                    })]
                  })]
                })]
              }), (0, t.jsxs)("section", {
                className: "cavcloud-homeCard",
                "aria-label": "Recent activity",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-homeTitleRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-homeTitleWithIcon",
                    children: [(0, t.jsxs)("svg", {
                      className: "cavcloud-homeTitleIcon",
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: [t.jsx("path", {
                        d: "M20 12a8 8 0 1 1-2.3-5.7",
                        stroke: "currentColor",
                        strokeWidth: "1.6",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      }), t.jsx("path", {
                        d: "M20 4v5h-5M12 8v4l2.5 1.5",
                        stroke: "currentColor",
                        strokeWidth: "1.6",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })]
                    }), t.jsx("span", {
                      className: "cavcloud-homeTitle",
                      children: "Recent activity"
                    })]
                  }), t.jsx("button", {
                    className: "cavcloud-homeSeeAll",
                    type: "button",
                    disabled: ew || eC,
                    onClick: () => l2("Recents"),
                    children: "View all"
                  })]
                }), t.jsx("div", {
                  className: "cavcloud-homeList",
                  children: tq.length ? tq.map(e => {
                    let a = E(e),
                      l = "folder" === String(e.targetType || "").toLowerCase() ? "folder" : "file",
                      s = T(e.targetPath || "/");
                    return (0, t.jsxs)("div", {
                      className: "cavcloud-homeRow",
                      children: [t.jsx("button", {
                        className: "cavcloud-homeSeeAll",
                        type: "button",
                        disabled: ew || eC,
                        title: a.meta,
                        onClick: () => void sW(s, l),
                        children: a.label
                      }), t.jsx("span", {
                        children: B(e.createdAtISO)
                      })]
                    }, e.id);
                  }) : t.jsx("div", {
                    className: "cavcloud-empty",
                    children: "No activity yet."
                  })
                })]
              }), (0, t.jsxs)("section", {
                className: "cavcloud-homeCard",
                "aria-label": "Starred shortcuts",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-homeTitleRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-homeTitleWithIcon",
                    children: [t.jsx("svg", {
                      className: "cavcloud-homeTitleIcon",
                      viewBox: "0 0 24 24",
                      fill: "none",
                      "aria-hidden": "true",
                      children: t.jsx("path", {
                        d: "m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.9-3.8 5.4-.8L12 4.2Z",
                        stroke: "currentColor",
                        strokeWidth: "1.6",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-homeTitle",
                      children: "Starred shortcuts"
                    })]
                  }), t.jsx("button", {
                    className: "cavcloud-homeSeeAll",
                    type: "button",
                    disabled: ew || eC,
                    onClick: () => l2("Starred"),
                    children: "View all"
                  })]
                }), tY.length ? t.jsx("div", {
                  className: "cavcloud-starGrid",
                  children: tY.map(e => {
                    let a = Z(e.path) || e.path;
                    return (0, t.jsxs)("button", {
                      className: "cavcloud-starItem",
                      type: "button",
                      disabled: ew || eC,
                      onClick: () => void sW(e.path, e.targetType),
                      title: F(e.path),
                      children: [t.jsx("span", {
                        className: "cavcloud-starIcon",
                        "aria-hidden": "true",
                        children: "folder" === e.targetType ? t.jsx(ex, {}) : (0, t.jsxs)("svg", {
                          viewBox: "0 0 24 24",
                          fill: "none",
                          children: [t.jsx("path", {
                            d: "M8.3 4.6h6.2l3.1 3.1v9.7a2 2 0 0 1-2 2H8.3a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2Z",
                            stroke: "currentColor",
                            strokeWidth: "1.6",
                            strokeLinecap: "round",
                            strokeLinejoin: "round"
                          }), t.jsx("path", {
                            d: "M14.5 4.6v3.1h3.1",
                            stroke: "currentColor",
                            strokeWidth: "1.6",
                            strokeLinecap: "round",
                            strokeLinejoin: "round"
                          })]
                        })
                      }), t.jsx("span", {
                        className: "cavcloud-starText",
                        children: a
                      })]
                    }, `${e.targetType}:${T(e.path)}`);
                  })
                }) : t.jsx("div", {
                  className: "cavcloud-empty",
                  children: "No starred shortcuts yet."
                })]
              })]
            }), t.jsx("div", {
              className: "cavcloud-homeQuick",
              children: (0, t.jsxs)("div", {
                className: "cavcloud-uploadGrid",
                children: [(0, t.jsxs)("button", {
                  className: "cavcloud-uploadCard",
                  type: "button",
                  disabled: ew || eC,
                  onClick: () => {
                    lf(""), lv(!0);
                  },
                  children: [t.jsx("span", {
                    className: "cavcloud-uploadIcon",
                    "aria-hidden": "true",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      children: t.jsx("path", {
                        d: "M3.5 8.2a2 2 0 0 1 2-2h4l1.6 1.8h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V8.2ZM12 10.3v5.4m-2.7-2.7h5.4",
                        stroke: "currentColor",
                        strokeWidth: "1.7",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    })
                  }), "Create folder"]
                }), (0, t.jsxs)("button", {
                  className: "cavcloud-uploadCard",
                  type: "button",
                  disabled: ew || eC,
                  onClick: () => lV.current?.click(),
                  children: [t.jsx("span", {
                    className: "cavcloud-uploadIcon",
                    "aria-hidden": "true",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      children: t.jsx("path", {
                        d: "M12 3.8v11.4m0 0 4-4m-4 4-4-4M4.6 16.3v1.5a2.3 2.3 0 0 0 2.3 2.3h10.2a2.3 2.3 0 0 0 2.3-2.3v-1.5",
                        stroke: "currentColor",
                        strokeWidth: "1.7",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    })
                  }), "Upload files"]
                }), (0, t.jsxs)("button", {
                  className: "cavcloud-uploadCard",
                  type: "button",
                  disabled: ew || eC,
                  onClick: () => l2("Explore"),
                  children: [t.jsx("span", {
                    className: "cavcloud-uploadIcon",
                    "aria-hidden": "true",
                    children: t.jsx("svg", {
                      viewBox: "0 0 24 24",
                      fill: "none",
                      children: t.jsx("path", {
                        d: "M4.4 12 12 4.4 19.6 12M7.6 10.8v8.8h8.8v-8.8",
                        stroke: "currentColor",
                        strokeWidth: "1.7",
                        strokeLinecap: "round",
                        strokeLinejoin: "round"
                      })
                    })
                  }), "Open CavSafe"]
                })]
              })
            })]
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
                l = a ? `/api/cavsafe/trash/${encodeURIComponent(e.id)}?raw=1` : "",
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
                      children: e.name
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
                d = o ? String(c?.rawSrc || `/api/cavsafe/files/by-path?path=${encodeURIComponent(s)}&raw=1`).trim() : "",
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
                          }), t.jsx("button", {
                            className: "cavcloud-trashActionMenuItem is-danger",
                            type: "button",
                            disabled: ew || eC || !e.isFileAvailable,
                            onClick: () => {
                              lB(""), sX(e.file);
                            },
                            children: "Move to CavSafe"
                          })]
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
                l = ap[e.id] || (a ? `/api/cavsafe/files/${encodeURIComponent(e.id)}?raw=1` : ""),
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
                  onClick: a => {
                    a.detail <= 1 && sN(c, a);
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
                      a.currentTarget.dataset.fallback = "1", a.currentTarget.src = `/api/cavsafe/files/by-path?path=${encodeURIComponent(e.path)}&raw=1`;
                    }
                  }) : null, l && "video" === a ? t.jsx("video", {
                    className: "cavcloud-galleryMedia",
                    src: l,
                    preload: "metadata",
                    muted: !0,
                    playsInline: !0,
                    onError: a => {
                      if ("1" === a.currentTarget.dataset.fallback) return;
                      a.currentTarget.dataset.fallback = "1", a.currentTarget.src = `/api/cavsafe/files/by-path?path=${encodeURIComponent(e.path)}&raw=1`, a.currentTarget.load();
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
                      children: e.name
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
                i = "file" === e.targetType && s ? e.targetId ? `/api/cavsafe/files/${encodeURIComponent(e.targetId)}?raw=1` : `/api/cavsafe/files/by-path?path=${encodeURIComponent(e.path)}&raw=1` : "",
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
          }) : "Shared" === S ? (0, t.jsxs)("div", {
            className: `cavcloud-galleryGrid cavcloud-sharedGrid ${iU}`,
            children: [e1 ? t.jsx("div", {
              className: "cavcloud-empty",
              children: e1
            }) : null, t0.length ? null : t.jsx("div", {
              className: "cavcloud-empty",
              children: "shared" === aO ? (0, t.jsxs)(t.Fragment, {
                children: ["Nothing shared with you yet.", t.jsx("div", {
                  className: "cavcloud-modalText",
                  children: "When someone invites you to a CavSafe item, it appears here."
                })]
              }) : t4
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
                }, `safe-settings-page-top-${e}`))
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
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Appearance"
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsSub",
                children: ["Choose your CavSafe accent theme.", cavsafeSettingsSaving ? " Saving…" : ""]
              }), t.jsx("div", {
                className: "cavcloud-themeRow cavcloud-themeRow-elevated",
                role: "radiogroup",
                "aria-label": "CavSafe accent themes",
                children: CAVSAFE_THEME_PICKER_OPTIONS.map(e => (0, t.jsxs)("button", {
                  className: `cavcloud-themeBtn cavcloud-themeBtn-elevated ${eA === e.key ? "is-on" : ""}`,
                  onClick: () => void updateCavsafeSettingsPatch({
                    themeAccent: e.key
                  }),
                  disabled: cavsafeSettingsBusy,
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
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Access & Sharing Policy"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Enforced policy for CavSafe."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: cavsafeEnforcedPolicySummary.ownerOnlyAccess.title
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: cavsafeEnforcedPolicySummary.ownerOnlyAccess.body
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
                      children: cavsafeEnforcedPolicySummary.sharingDisabled.title
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: cavsafeEnforcedPolicySummary.sharingDisabled.body
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
                      children: cavsafeEnforcedPolicySummary.publishInsteadOfShare.title
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: cavsafeEnforcedPolicySummary.publishInsteadOfShare.body
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-workspaceStaticValue cavsafe-policyStaticValue",
                    children: "Policy"
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Secured Storage Policy"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: "Quota, retention, and cleanup behavior for CavSafe."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-storageMetrics",
                "aria-label": "CavSafe storage summary",
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
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList cavsafe-settingsStoragePolicyList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Recently deleted retention"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Auto-deletion window for recently deleted in CavSafe."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-storageSegment",
                    children: [7, 14, 30].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavsafeSettings.trashRetentionDays === e ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch({
                        trashRetentionDays: e
                      }),
                      children: `${e}d`
                    }, `safe-trash-retention-${e}`))
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
                      children: "When enabled, CavSafe permanently purges recently deleted items after retention expires."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavsafeSettings.autoPurgeTrash ? "is-on" : ""}`,
                    type: "button",
                    disabled: cavsafeSettingsBusy,
                    "aria-pressed": cavsafeSettings.autoPurgeTrash,
                    onClick: () => void updateCavsafeSettingsPatch({
                      autoPurgeTrash: !cavsafeSettings.autoPurgeTrash
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavsafeSettings.autoPurgeTrash ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Prefer download for unknown binaries"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Unknown binaries open as download-first to reduce preview risk."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavsafeSettings.preferDownloadUnknownBinary ? "is-on" : ""}`,
                    type: "button",
                    disabled: cavsafeSettingsBusy,
                    "aria-pressed": cavsafeSettings.preferDownloadUnknownBinary,
                    onClick: () => void updateCavsafeSettingsPatch({
                      preferDownloadUnknownBinary: !cavsafeSettings.preferDownloadUnknownBinary
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavsafeSettings.preferDownloadUnknownBinary ? "On" : "Off"
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page1 ${1 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Integrity & Time Controls"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: cavsafeIsPremiumPlus ? "Premium+ posture defaults for new uploads." : "Premium+ unlock required for controls."
              }), cavsafeIsPremiumPlus ? (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default Integrity Lock for new uploads"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "If enabled, new uploads start locked immediately."
                    })]
                  }), (0, t.jsxs)("button", {
                    className: `cavcloud-workspaceSwitch ${cavsafeSettings.defaultIntegrityLockOnUpload ? "is-on" : ""}`,
                    type: "button",
                    disabled: cavsafeSettingsBusy,
                    "aria-pressed": cavsafeSettings.defaultIntegrityLockOnUpload,
                    onClick: () => void updateCavsafeSettingsPatch({
                      defaultIntegrityLockOnUpload: !cavsafeSettings.defaultIntegrityLockOnUpload
                    }),
                    children: [t.jsx("span", {
                      className: "cavcloud-workspaceSwitchTrack",
                      children: t.jsx("span", {
                        className: "cavcloud-workspaceSwitchKnob"
                      })
                    }), t.jsx("span", {
                      className: "cavcloud-workspaceSwitchLabel",
                      children: cavsafeSettings.defaultIntegrityLockOnUpload ? "On" : "Off"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Time lock default"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Suggestion preset for new evidence. Per-file controls still apply."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "none",
                      label: "None"
                    }, {
                      key: "24h",
                      label: "24h"
                    }, {
                      key: "7d",
                      label: "7d"
                    }, {
                      key: "30d",
                      label: "30d"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavsafeSettings.timelockDefaultPreset === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch({
                        timelockDefaultPreset: e.key
                      }),
                      children: e.label
                    }, `safe-timelock-default-${e.key}`))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-workspaceRow",
                  children: [t.jsx("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Enforcement rules"
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: ["Locked until date: file edits and destructive actions remain blocked.", t.jsx("br", {}), "Expired time lock: expiry policy is enforced by server controls."]
                    })]
                  })]
                })]
              }) : (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Premium+ controls locked"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Upgrade to Premium+ to define default integrity and time-lock posture."
                    })]
                  }), t.jsx("span", {
                    className: "cavsafe-ownerLockIcon",
                    title: "Premium+ required",
                    "aria-hidden": "true",
                    children: t.jsx(LockIcon, {})
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-workspaceRow",
                  children: [t.jsx("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Enforcement rules"
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: ["Locked until date: file edits and destructive actions remain blocked.", t.jsx("br", {}), "Expired time lock: expiry policy is enforced by server controls."]
                    })]
                  })]
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: `cavcloud-settingsCard cavcloud-settingsCard-workspace cavcloud-settingsPageCard is-page2 ${2 !== settingsPageSafe ? "is-hidden" : ""}`,
              children: [t.jsx("div", {
                className: "cavcloud-settingsTitle",
                children: "Audit & Evidence"
              }), t.jsx("div", {
                className: "cavcloud-settingsSub",
                children: cavsafeIsPremiumPlus ? "Premium+ audit retention and evidence defaults." : "Premium+ unlock required for audit export and evidence defaults."
              }), cavsafeIsPremiumPlus ? (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Audit retention window"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Retention period for CavSafe activity logs."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-storageSegment",
                    children: [7, 14, 30, 90].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavsafeSettings.auditRetentionDays === e ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch({
                        auditRetentionDays: e
                      }),
                      children: `${e}d`
                    }, `safe-audit-retention-${e}`))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow",
                  children: [t.jsx("div", {
                    className: "cavcloud-settingsItemTitle",
                    children: "Export audit log"
                  }), t.jsx("div", {
                    className: "cavcloud-settingsItemMeta",
                    children: "Download activity records in JSON or CSV."
                  }), (0, t.jsxs)("div", {
                    className: "cavcloud-settingsRow",
                    children: [t.jsx("button", {
                      className: "cavcloud-rowAction",
                      type: "button",
                      disabled: cavsafeSettingsBusy || cavsafeAuditExporting || !cavsafeSettings.enableAuditExport,
                      onClick: () => void exportCavsafeAuditLog("json"),
                      children: cavsafeAuditExporting ? "Exporting..." : "Export JSON"
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction",
                      type: "button",
                      disabled: cavsafeSettingsBusy || cavsafeAuditExporting || !cavsafeSettings.enableAuditExport,
                      onClick: () => void exportCavsafeAuditLog("csv"),
                      children: cavsafeAuditExporting ? "Exporting..." : "Export CSV"
                    })]
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default evidence visibility"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Publish defaults for CavSafe evidence artifacts."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "LINK_ONLY",
                      label: "Link only"
                    }, {
                      key: "PRIVATE",
                      label: "Private"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavsafeSettings.defaultEvidenceVisibility === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch({
                        defaultEvidenceVisibility: e.key
                      }),
                      children: e.label
                    }, `safe-evidence-visibility-${e.key}`))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Default evidence expiry"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Apply when publishing from CavSafe."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: 0,
                      label: "Never"
                    }, {
                      key: 1,
                      label: "1d"
                    }, {
                      key: 7,
                      label: "7d"
                    }, {
                      key: 30,
                      label: "30d"
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${cavsafeSettings.defaultEvidenceExpiryDays === e.key ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch({
                        defaultEvidenceExpiryDays: e.key
                      }),
                      children: e.label
                    }, `safe-evidence-expiry-${e.key}`))
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Snapshot policy"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Manual snapshots only. Scheduled snapshots are not enabled."
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-pill",
                    children: "Coming soon"
                  })]
                })]
              }) : (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Premium+ controls locked"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Audit retention, export, and evidence defaults unlock on Premium+."
                    })]
                  }), t.jsx("span", {
                    className: "cavsafe-ownerLockIcon",
                    title: "Premium+ required",
                    "aria-hidden": "true",
                    children: t.jsx(LockIcon, {})
                  })]
                }), (0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Snapshot policy"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Manual only (enforced). Scheduled snapshots: coming soon."
                    })]
                  }), t.jsx("span", {
                    className: "cavcloud-workspaceStaticValue is-on",
                    children: "Enforced"
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
                children: "CavSafe-specific signals delivered into CavBot notifications."
              }), (0, t.jsxs)("div", {
                className: "cavcloud-settingsList cavcloud-workspaceList",
                children: [(0, t.jsxs)("div", {
                  className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                  children: [(0, t.jsxs)("div", {
                    className: "cavcloud-workspaceCopy",
                    children: [t.jsx("div", {
                      className: "cavcloud-settingsItemTitle",
                      children: "Secured Storage low threshold"
                    }), t.jsx("div", {
                      className: "cavcloud-settingsItemMeta",
                      children: "Choose one or both thresholds."
                    })]
                  }), t.jsx("div", {
                    className: "cavcloud-workspaceSegment cavcloud-settingsSegment",
                    children: [{
                      key: "80",
                      label: "80%",
                      enabled: cavsafeSettings.notifySafeStorage80
                    }, {
                      key: "95",
                      label: "95%",
                      enabled: cavsafeSettings.notifySafeStorage95
                    }].map(e => t.jsx("button", {
                      className: `cavcloud-workspaceSegmentBtn ${e.enabled ? "is-on" : ""}`,
                      type: "button",
                      disabled: cavsafeSettingsBusy,
                      onClick: () => void updateCavsafeSettingsPatch("80" === e.key ? {
                        notifySafeStorage80: !cavsafeSettings.notifySafeStorage80
                      } : {
                        notifySafeStorage95: !cavsafeSettings.notifySafeStorage95
                      }),
                      children: e.label
                    }, `safe-storage-threshold-${e.key}`))
                  })]
                }), [{
                  key: "notifySafeUploadFailures",
                  title: "Upload failures",
                  body: "Single and folder upload failures.",
                  premiumPlusOnly: !1
                }, {
                  key: "notifySafeMoveFailures",
                  title: "Move failures",
                  body: "Move-in and move-out operation failures.",
                  premiumPlusOnly: !1
                }, {
                  key: "notifySafeEvidencePublished",
                  title: "Evidence published",
                  body: "Published artifacts from CavSafe.",
                  premiumPlusOnly: !1
                }, {
                  key: "notifySafeSnapshotCreated",
                  title: "Snapshot created",
                  body: "Snapshot creation events.",
                  premiumPlusOnly: !0
                }, {
                  key: "notifySafeTimeLockEvents",
                  title: "Time-lock events",
                  body: "Unlock window reached and file expired events.",
                  premiumPlusOnly: !0
                }].map(e => {
                  let a = !!cavsafeSettings[e.key],
                    l = !!e.premiumPlusOnly && !cavsafeIsPremiumPlus;
                  return (0, t.jsxs)("div", {
                    className: "cavcloud-settingsRow cavcloud-settingsRowSplit cavcloud-workspaceRow",
                    children: [(0, t.jsxs)("div", {
                      className: "cavcloud-workspaceCopy",
                      children: [t.jsx("div", {
                        className: "cavcloud-settingsItemTitle",
                        children: e.title
                      }), t.jsx("div", {
                        className: "cavcloud-settingsItemMeta",
                        children: e.body
                      })]
                    }), (0, t.jsxs)("div", {
                      className: "cavcloud-workspacePinnedControls",
                      children: [(0, t.jsxs)("button", {
                        className: `cavcloud-workspaceSwitch ${a ? "is-on" : ""}`,
                        type: "button",
                        disabled: cavsafeSettingsBusy || l,
                        "aria-pressed": a,
                        onClick: () => void updateCavsafeSettingsPatch({
                          [e.key]: !a
                        }),
                        children: [t.jsx("span", {
                          className: "cavcloud-workspaceSwitchTrack",
                          children: t.jsx("span", {
                            className: "cavcloud-workspaceSwitchKnob"
                          })
                        }), t.jsx("span", {
                          className: "cavcloud-workspaceSwitchLabel",
                          children: a ? "On" : "Off"
                        })]
                      }), l ? t.jsx("span", {
                        className: "cavsafe-ownerLockIcon",
                        title: "Premium+ required",
                        "aria-hidden": "true",
                        children: t.jsx(LockIcon, {})
                      }) : null]
                    })]
                  }, e.key);
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
                }, `safe-settings-page-bottom-${e}`))
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
              "aria-label": "Mount is available on Premium+",
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
                  children: "Directly mount secured documents from CavSafe."
                }), t.jsx("div", {
                  className: "cavcloud-mountGateSub",
                  children: "Available on Premium+."
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
            item: N,
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
          ew || (lv(!1), lf(""), setCreateFolderTarget("cavsafe"));
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
                lv(!1), lf(""), setCreateFolderTarget("cavsafe");
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
          ew || (lU(!1), lD("untitled.txt"), setCreateFileTarget("cavsafe"));
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
                lU(!1), lD("untitled.txt"), setCreateFileTarget("cavsafe");
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
        "aria-labelledby": "cavcloud-publish-file-title",
        onClick: () => {
          if (ew) return;
          let eDefaults = cavsafeSettingsRef.current || CAVSAFE_SETTINGS_DEFAULTS;
          lW(null), lG(""), lJ(eDefaults.defaultEvidenceVisibility), setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(eDefaults.defaultEvidenceExpiryDays, 0));
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-publish-file-title",
            children: "Publish file"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody",
            children: [(0, t.jsxs)("div", {
              className: "cavcloud-field",
              children: [t.jsx("strong", {
                children: l_.name
              }), (0, t.jsxs)("div", {
                className: "cavcloud-fileMeta",
                children: [l_.mimeType, " • ", P(l_.bytes)]
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
                  value: "LINK_ONLY",
                  children: "Link only"
                }), t.jsx("option", {
                  value: "PRIVATE",
                  children: "Private"
                })]
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Expiry", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: String(publishExpiryDays),
                onChange: e => setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(e.currentTarget.value, publishExpiryDays)),
                children: [t.jsx("option", {
                  value: "0",
                  children: "Never"
                }), t.jsx("option", {
                  value: "1",
                  children: "1 day"
                }), t.jsx("option", {
                  value: "7",
                  children: "7 days"
                }), t.jsx("option", {
                  value: "30",
                  children: "30 days"
                })]
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => {
                let eDefaults = cavsafeSettingsRef.current || CAVSAFE_SETTINGS_DEFAULTS;
                lW(null), lG(""), lJ(eDefaults.defaultEvidenceVisibility), setPublishExpiryDays(normalizeCavsafeEvidenceExpiryDays(eDefaults.defaultEvidenceExpiryDays, 0));
              },
              disabled: ew,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void sY(),
              disabled: ew,
              children: "Publish"
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
              onClick: () => void sQ(),
              disabled: ew || !ly.trim(),
              children: "Save"
            })]
          })]
        })
      }) : null, e4 ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-share-modal-title",
        onClick: sP,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-share-modal-title",
            children: "Private share"
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalBody cavcloud-shareModalBody",
            children: [t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Invite‑only. No public links. Stays inside CavSafe."
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Invite", t.jsx("input", {
                className: "cavcloud-input",
                value: e3,
                onChange: e => e8(e.currentTarget.value),
                placeholder: "Add by username or email",
                maxLength: 190,
                autoFocus: !0
              })]
            }), (0, t.jsxs)("label", {
              className: "cavcloud-field",
              children: ["Access", (0, t.jsxs)("select", {
                className: "cavcloud-paneTitleSelect",
                value: privateShareRole,
                onChange: e => setPrivateShareRole(e.currentTarget.value),
                children: [t.jsx("option", {
                  value: "owner",
                  children: "Owner — Full control"
                }), t.jsx("option", {
                  value: "editor",
                  children: "Editor — Can edit"
                }), t.jsx("option", {
                  value: "viewer",
                  children: "Viewer — Read only"
                })]
              })]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-field",
              children: [t.jsx("div", {
                className: "cavcloud-modalText",
                children: "People with access"
              }), privateShareLoading ? t.jsx("div", {
                className: "cavcloud-modalText",
                children: "Loading access..."
              }) : privateSharePeople.length ? privateSharePeople.map(e => {
                let a = e?.user?.username ? `@${e.user.username}` : String(e?.user?.email || e?.principalId || "User"),
                  l = String(e?.role || "viewer").toLowerCase(),
                  tBusy = !!privateShareBusyUserId;
                return (0, t.jsxs)("div", {
                  className: "cavcloud-modalText",
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    justifyContent: "space-between"
                  },
                  children: [t.jsx("span", {
                    children: a
                  }), (0, t.jsxs)("div", {
                    style: {
                      display: "flex",
                      gap: "8px",
                      alignItems: "center"
                    },
                    children: [(0, t.jsxs)("select", {
                      className: "cavcloud-paneTitleSelect",
                      value: l,
                      disabled: tBusy || !e?.principalId,
                      onChange: a => void sShareRole(e.principalId, a.currentTarget.value),
                      children: [t.jsx("option", {
                        value: "owner",
                        children: "Owner"
                      }), t.jsx("option", {
                        value: "editor",
                        children: "Editor"
                      }), t.jsx("option", {
                        value: "viewer",
                        children: "Viewer"
                      })]
                    }), t.jsx("button", {
                      className: "cavcloud-rowAction",
                      type: "button",
                      disabled: tBusy || !e?.principalId,
                      onClick: () => void sShareRevoke(e.principalId),
                      children: "Revoke"
                    })]
                  })]
                }, `${e?.aclId || e?.principalId || a}`);
              }) : t.jsx("div", {
                className: "cavcloud-modalText",
                children: "Only you have access."
              })]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-field",
              children: [t.jsx("div", {
                className: "cavcloud-modalText",
                children: "Pending"
              }), privateSharePending.length ? privateSharePending.map(e => {
                let a = String(e?.inviteeLabel || e?.inviteeEmail || "Recipient"),
                  l = String(e?.role || "viewer").toLowerCase(),
                  tBusy = !!privateShareBusyUserId;
                return (0, t.jsxs)("div", {
                  className: "cavcloud-modalText",
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    justifyContent: "space-between"
                  },
                  children: [(0, t.jsxs)("span", {
                    children: [a, " • ", l]
                  }), e?.inviteeUserId ? t.jsx("button", {
                    className: "cavcloud-rowAction",
                    type: "button",
                    disabled: tBusy,
                    onClick: () => void sShareRevoke(e.inviteeUserId),
                    children: "Revoke"
                  }) : null]
                }, `${e?.inviteId || a}`);
              }) : t.jsx("div", {
                className: "cavcloud-modalText",
                children: "No pending invites."
              })]
            })]
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: sP,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              disabled: e9 || !privateShareTarget?.id || !e3.trim(),
              onClick: () => void sB(),
              children: e9 ? "Sending..." : "Send invite"
            })]
          })]
        })
      }) : null, inviteIdFromQuery ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavcloud-invite-accept-title",
        onClick: closeInvitePrompt,
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavcloud-invite-accept-title",
            children: "CavSafe invite"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: t.jsx("div", {
              className: "cavcloud-modalText",
              children: "Accept once to add this item to your CavSafe."
            })
          }), (0, t.jsxs)("div", {
            className: "cavcloud-modalActions",
            children: [t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: closeInvitePrompt,
              disabled: inviteAcceptBusy,
              children: "Cancel"
            }), t.jsx("button", {
              className: "cavcloud-rowAction",
              type: "button",
              onClick: () => void acceptInvitePrompt(),
              disabled: inviteAcceptBusy,
              children: inviteAcceptBusy ? "Accepting..." : "Accept"
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
      }) : null, mountRunModalItem ? t.jsx("div", {
        className: "cavcloud-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "cavsafe-mount-run-title",
        onClick: () => {
          mountBusy || setMountRunModalItem(null);
        },
        children: (0, t.jsxs)("div", {
          className: "cavcloud-modalCard",
          onClick: e => e.stopPropagation(),
          children: [t.jsx("div", {
            className: "cavcloud-modalTitle",
            id: "cavsafe-mount-run-title",
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
            children: "Move file to recently deleted"
          }), t.jsx("div", {
            className: "cavcloud-modalBody",
            children: (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: ["Move ", t.jsx("strong", {
                children: lj.name
              }), " to recently deleted?"]
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
              className: "cavcloud-rowAction is-danger",
              type: "button",
              onClick: () => void s0(),
              disabled: ew,
              children: "Move to recently deleted"
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
              children: "These files are within 7 days of permanent deletion from CavSafe."
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
                      previewUrl: `/api/cavsafe/trash/${encodeURIComponent(e.id)}?raw=1`,
                      snippet: String(snippetByFileId[e.targetId || ""] || "")
                    }), (0, t.jsxs)("div", {
                      children: [t.jsx("div", {
                        className: "cavcloud-fileTitle",
                        children: e.name
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
              children: ["Move ", sDeleteCount, " selected item", 1 === sDeleteCount ? "" : "s", " to recently deleted?"]
            }), (0, t.jsxs)("div", {
              className: "cavcloud-modalText",
              children: [sDeleteTargets.slice(0, 3).map(e => e.name).join(", "), sDeleteTargets.length > 3 ? ` +${sDeleteTargets.length - 3} more` : ""]
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
              onClick: () => void sI(sDeleteTargets),
              disabled: ew || 0 === sDeleteCount,
              children: "Move to recently deleted"
            })]
          })]
        })
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
