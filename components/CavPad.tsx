// components/CavPad.tsx
"use client";

import * as React from "react";
import Image from "next/image";
import "./cavpad.css";
import { inferSyncMimeType, upsertCavcloudTextFile, upsertCavsafeTextFile } from "@/lib/cavcloud/sync.client";
import { CavPadCollaborateModal } from "@/components/CavPadCollaborateModal";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { selectDesktopItemArray, shouldClearDesktopSelectionFromTarget, toggleDesktopItemArray } from "@/lib/hooks/useDesktopSelection";
import {
  ALIBABA_QWEN_CHARACTER_MODEL_ID,
  ALIBABA_QWEN_FLASH_MODEL_ID,
  ALIBABA_QWEN_PLUS_MODEL_ID,
  ALIBABA_QWEN_MAX_MODEL_ID,
  DEEPSEEK_CHAT_MODEL_ID,
  DEEPSEEK_REASONER_MODEL_ID,
  resolveAiModelLabel,
} from "@/src/lib/ai/model-catalog";
import { toReasoningDisplayHelper, toReasoningDisplayLabel } from "@/src/lib/ai/reasoning-display";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";

type NotesScope = "workspace" | "site";
type CavPadView = "cavpad" | "notes" | "directories" | "trash" | "settings" | "details";
type CavPadDirectorySection = "cloud" | "folders" | "files";
export type CavPadPlanTier = "FREE" | "PREMIUM" | "PREMIUM_PLUS";

export type CavPadSite = {
  id: string;
  label: string;
  origin: string;
};

export type CavPadNoteFolder = {
  id: string;
  projectId: number;
  name: string;
  parentId?: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  pendingCreate?: boolean;
};

export type CavPadNoteDoc = {
  id: string;
  projectId: number;
  scope: NotesScope;
  siteId?: string;
  folderId?: string;
  cavcloudFileId?: string;
  cavcloudPath?: string;
  sha256?: string;
  permission?: "NONE" | "VIEW" | "EDIT" | "OWNER";
  status?: "normal" | "shared" | "collab";
  shared?: boolean;
  collab?: boolean;
  collaboratorCount?: number;
  editorsCount?: number;
  ownerUserId?: string;
  ownerUsername?: string;
  ownerDisplayName?: string;
  ownerAvatarUrl?: string;
  ownerAvatarTone?: string;
  ownerEmail?: string;
  lastChangeAt?: number;
  lastChangeUserId?: string;
  lastChangeUsername?: string;
  lastChangeDisplayName?: string;
  lastChangeEmail?: string;
  accessList?: {
    id: string;
    userId: string;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    avatarTone?: string | null;
    email?: string | null;
    permission: "VIEW" | "EDIT";
    expiresAt?: string | null;
  }[];
  title: string;
  html: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  pendingCreate?: boolean;
  pendingRemoteSync?: boolean;
};

type CavPadTrashDoc = CavPadNoteDoc & {
  deletedAt: number;
};

type CavPadSettings = {
  syncToCavcloud: boolean;
  syncToCavsafe: boolean;
  allowSharing: boolean;
  defaultSharePermission: "VIEW" | "EDIT";
  defaultShareExpiryDays: 0 | 7 | 30;
  noteExpiryDays: 0 | 7 | 30;
  theme: "lime" | "blue" | "violet" | "glass";
  font: string;
  fontColor: string;
  gridLines: boolean;
};

type CavPadPriorityNoteRequest = {
  requestId: string;
  title: string;
  evidenceLinks: string[];
  checklist: string[];
  verification: string[];
  confidenceSummary: string;
  riskSummary: string;
};

type CavPadAiDraftMode = "help_write" | "generate_note";

type CavPadAiCenterDraft = {
  summary: string;
  answer: string;
  recommendations: string[];
  notes: string[];
  followUpChecks: string[];
  evidenceRefs: string[];
};

type CavPadAiReasoningLevel = "low" | "medium" | "high" | "extra_high";
type EditorHistoryDirection = "undo" | "redo";
type CavPadModelOption = {
  id: string;
  label: string;
};

type CavPadSearchResult = {
  key: string;
  kind: "note" | "directory" | "trash" | "view" | "setting";
  label: string;
  sublabel: string;
  rank: number;
  updatedAt?: number;
  noteId?: string;
  directoryId?: string;
  trashId?: string;
  view?: CavPadView;
};

type CavPadActionConfirmConfig = {
  title: string;
  message: string;
  confirmLabel: string;
  confirmTone?: "accent" | "danger";
};

const CAVPAD_VIEW_SEARCH_INDEX: { label: string; view: CavPadView; keywords: string[] }[] = [
  { label: "CavPad", view: "directories", keywords: ["folders", "sample folders", "organize", "directory", "root"] },
  { label: "Write a note", view: "cavpad", keywords: ["editor", "write", "document", "note", "pad"] },
  { label: "Notes", view: "notes", keywords: ["files", "library", "all notes"] },
  { label: "Settings", view: "settings", keywords: ["preferences", "config", "theme", "sharing"] },
  { label: "Recently deleted", view: "trash", keywords: ["deleted", "restore", "purge", "trash"] },
];

const CAVPAD_SETTING_SEARCH_INDEX: { label: string; keywords: string[] }[] = [
  { label: "Sync to CavCloud Files", keywords: ["sync", "cavcloud", "files", "storage"] },
  { label: "Sync to CavSafe Files", keywords: ["sync", "cavsafe", "files", "storage"] },
  { label: "Allow sharing", keywords: ["share", "sharing", "permission", "collaboration"] },
  { label: "Default permission", keywords: ["view-only", "edit", "permission"] },
  { label: "Default share expiry", keywords: ["expiry", "expiration", "7d", "30d"] },
  { label: "Theme", keywords: ["theme", "lime", "blue", "violet", "white"] },
  { label: "Editor grid lines", keywords: ["grid", "editor", "lines"] },
];
const CAVPAD_DIRECTORY_SECTION_OPTIONS: { value: CavPadDirectorySection; label: string }[] = [
  { value: "cloud", label: "CavPad" },
  { value: "folders", label: "Folders" },
  { value: "files", label: "Files" },
];
const CAVPAD_REASONING_LEVEL_OPTIONS: Array<{ value: CavPadAiReasoningLevel; label: string }> = [
  { value: "low", label: toReasoningDisplayLabel("low") },
  { value: "medium", label: toReasoningDisplayLabel("medium") },
  { value: "high", label: toReasoningDisplayLabel("high") },
  { value: "extra_high", label: toReasoningDisplayLabel("extra_high") },
];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TRASH_REMOTE_RETRY_WINDOW_MS = 10 * 60 * 1000;
const TRASH_REMOTE_RETRY_COOLDOWN_MS = 3000;
const CAVPAD_DIRECTORY_ROOT = "__root__";

function timeNow() {
  return Date.now();
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${timeNow().toString(16)}`;
}

function clampStr(s: string, n = 64) {
  const x = (s || "").trim();
  return x.length > n ? x.slice(0, n) : x;
}

function normalizeDirectoryParentId(parentId: string | null | undefined) {
  return String(parentId || "").trim() || CAVPAD_DIRECTORY_ROOT;
}


function safeNumDate(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const normalized =
    v instanceof Date ? v : typeof v === "string" || typeof v === "number" ? v : String(v ?? "");
  const d = new Date(normalized);
  const t = d.getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function toStringValue(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return fallback;
}

function toNumberValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeCavPadModelOptions(value: unknown): CavPadModelOption[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: CavPadModelOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as { id?: unknown; label?: unknown };
    const id = String(item.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: String(item.label || "").trim() || resolveAiModelLabel(id) || id,
    });
  }
  return out;
}

const WORKSPACE_TITLE_ALIASES = new Set(["workspace notes", "notes sample", "notes"]);

function normalizeWorkspaceTitle(title: string) {
  const trimmed = String(title || "").trim();
  if (!trimmed) return "Notes";
  if (WORKSPACE_TITLE_ALIASES.has(trimmed.toLowerCase())) return "Notes";
  return trimmed;
}

function fmtTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtEditedTime(ts: number) {
  try {
    const d = new Date(ts);
    const datePart = d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
    const timePart = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${datePart} at ${timePart}`;
  } catch {
    return "—";
  }
}

function fmtDateOnly(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtTimeOnly(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDeletedDateTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function normalizeIdentityPiece(value: unknown): string {
  return String(value || "").trim();
}

function resolveIdentityLabel(args: {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  userId?: string | null;
  usernameStyle?: "plain" | "at";
}): string {
  const displayName = normalizeIdentityPiece(args.displayName);
  if (displayName) return displayName;

  const usernameRaw = normalizeIdentityPiece(args.username).replace(/^@+/, "");
  if (usernameRaw) return args.usernameStyle === "at" ? `@${usernameRaw}` : usernameRaw;

  const email = normalizeIdentityPiece(args.email);
  if (email) return email;

  const userId = normalizeIdentityPiece(args.userId);
  if (userId) return userId;

  return "Unknown account";
}

type CavPadCachedProfile = {
  username: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  avatarTone: string | null;
};

const EMPTY_CACHED_PROFILE: CavPadCachedProfile = {
  username: null,
  displayName: null,
  email: null,
  avatarUrl: null,
  avatarTone: "lime",
};

function readCachedProfile(): CavPadCachedProfile {
  if (typeof window === "undefined") {
    return EMPTY_CACHED_PROFILE;
  }
  try {
    const usernameRaw = String(globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim();
    return {
      username: usernameRaw ? usernameRaw.replace(/^@+/, "") : null,
      displayName: String(globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim() || null,
      email: String(globalThis.__cbLocalStore.getItem("cb_profile_email_v1") || "").trim() || null,
      avatarUrl: String(globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim() || null,
      avatarTone: String(globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "").trim() || "lime",
    };
  } catch {
    return EMPTY_CACHED_PROFILE;
  }
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toSafeStringArray(value: unknown, limit = 20, maxLen = 220): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => (item.length > maxLen ? item.slice(0, maxLen) : item))
    .slice(0, limit);
}

function normalizePriorityNoteRequest(value: unknown): CavPadPriorityNoteRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const titleRaw = String(row.title || "").trim();
  const requestIdRaw = String(row.requestId || "").trim();
  const title = titleRaw || "CavBot priority note";
  const requestId = requestIdRaw || `priority_${timeNow().toString(36)}`;
  return {
    requestId,
    title: title.length > 120 ? title.slice(0, 120) : title,
    evidenceLinks: toSafeStringArray(row.evidenceLinks, 30, 200),
    checklist: toSafeStringArray(row.checklist, 16, 260),
    verification: toSafeStringArray(row.verification, 16, 260),
    confidenceSummary: String(row.confidenceSummary || "").trim().slice(0, 260),
    riskSummary: String(row.riskSummary || "").trim().slice(0, 260),
  };
}

function listToHtml(items: string[]) {
  if (!items.length) return `<p>None.</p>`;
  const rows = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `<ul>${rows}</ul>`;
}

function buildPriorityNoteHtml(note: CavPadPriorityNoteRequest) {
  const sections: string[] = [];
  sections.push(`<h2>${escapeHtml(note.title)}</h2>`);
  sections.push("<p><strong>Evidence links</strong></p>");
  sections.push(listToHtml(note.evidenceLinks));
  sections.push("<p><strong>Checklist</strong></p>");
  sections.push(listToHtml(note.checklist));
  sections.push("<p><strong>Verification steps</strong></p>");
  sections.push(listToHtml(note.verification));

  if (note.confidenceSummary) {
    sections.push(`<p><strong>Confidence</strong>: ${escapeHtml(note.confidenceSummary)}</p>`);
  }
  if (note.riskSummary) {
    sections.push(`<p><strong>Risk</strong>: ${escapeHtml(note.riskSummary)}</p>`);
  }

  return sections.join("");
}

function plainTextToEditorHtml(text: string) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const rows = normalized.split("\n");
  const blocks: string[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (!listBuffer.length) return;
    blocks.push(`<ul>${listBuffer.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
    listBuffer = [];
  };

  for (const raw of rows) {
    const line = String(raw || "").trim();
    if (!line) {
      flushList();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      listBuffer.push(bullet[1]);
      continue;
    }
    flushList();
    blocks.push(`<p>${escapeHtml(line)}</p>`);
  }

  flushList();
  return blocks.join("");
}

function normalizeCavPadAiCenterDraft(value: unknown): CavPadAiCenterDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const summary = String(row.summary || "").trim();
  const answer = String(row.answer || "").trim();
  const recommendations = toSafeStringArray(row.recommendations, 40, 800);
  const notes = toSafeStringArray(row.notes, 40, 800);
  const followUpChecks = toSafeStringArray(row.followUpChecks, 40, 800);
  const evidenceRefs = toSafeStringArray(row.evidenceRefs, 40, 220);
  if (!summary && !answer && !recommendations.length && !notes.length && !followUpChecks.length) return null;
  return {
    summary: summary || "CavAi draft",
    answer,
    recommendations,
    notes,
    followUpChecks,
    evidenceRefs,
  };
}

function buildCavPadAiDraftHtml(data: CavPadAiCenterDraft) {
  const answerHtml = plainTextToEditorHtml(data.answer);
  if (answerHtml) return answerHtml;
  const sections: string[] = [];
  sections.push(`<p>${escapeHtml(data.summary)}</p>`);
  if (data.notes.length) {
    sections.push("<p><strong>Notes</strong></p>");
    sections.push(listToHtml(data.notes));
  }
  if (data.recommendations.length) {
    sections.push("<p><strong>Recommendations</strong></p>");
    sections.push(listToHtml(data.recommendations));
  }
  if (data.followUpChecks.length) {
    sections.push("<p><strong>Follow-up checks</strong></p>");
    sections.push(listToHtml(data.followUpChecks));
  }
  return sections.join("");
}

function deriveCavPadAiDraftTitle(data: CavPadAiCenterDraft) {
  const answerCandidate = String(data.answer || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^[-*•]/.test(line) && !/^\d+[.)]/.test(line));
  const cleanedAnswer = String(answerCandidate || "")
    .replace(/^#+\s*/, "")
    .replace(/[:\-–—]+$/g, "")
    .trim();
  const cleanedSummary = String(data.summary || "")
    .replace(/^#+\s*/, "")
    .replace(/[:\-–—]+$/g, "")
    .trim();
  return clampStr(cleanedAnswer || cleanedSummary || "CavAi note", 80) || "CavAi note";
}

function formatFileSize(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let num = Math.max(0, Number(bytes) || 0);
  let idx = 0;
  while (num >= 1024 && idx < units.length - 1) {
    num /= 1024;
    idx += 1;
  }
  return `${num.toFixed(idx ? 1 : 0)} ${units[idx]}`;
}

function isImageUrl(url: string) {
  const cleaned = (url || "").split("?")[0].split("#")[0].trim().toLowerCase();
  return /\.(png|jpe?g|gif|webp|avif|svg)$/.test(cleaned);
}

function isVideoUrl(url: string) {
  const lower = String(url || "").toLowerCase();
  return /(youtube\.com\/watch|youtu\.be\/|vimeo\.com\/)/.test(lower);
}

type CavPadAttachmentKind = "image" | "video" | "document" | "file";

type CavPadAttachment = {
  id: string;
  projectId: number;
  noteId: string;
  kind: CavPadAttachmentKind;
  fileName: string;
  size: number;
  mimeType: string;
  createdAt: number;
  updatedAt: number;
};

const ATTACHMENT_DB_NAME = "cb_cavpad_attachments";
const ATTACHMENT_DB_VERSION = 1;
const ATTACHMENT_STORE = "attachments";

const AUTO_LINK_LABEL = String.raw`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`;
const AUTO_LINK_TLD = String.raw`(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})`;
const AUTO_LINK_PORT = String.raw`(?::\d{2,5})?`;
const AUTO_LINK_SCHEME = String.raw`https?:\/\/[^\s<]+`;
const AUTO_LINK_WWW = String.raw`www\.[^\s<]+`;
const AUTO_LINK_DOMAIN = String.raw`${AUTO_LINK_LABEL}(?:\.${AUTO_LINK_LABEL})*\.${AUTO_LINK_TLD}${AUTO_LINK_PORT}(?:\/[^\s<]*)?`;
const AUTO_LINK_URL = `(?:${AUTO_LINK_SCHEME}|${AUTO_LINK_WWW}|${AUTO_LINK_DOMAIN})`;
const AUTO_LINK_DETECT = new RegExp(`\b${AUTO_LINK_URL}\b`, "i");
const AUTO_LINK_EXTRACT = new RegExp(`\b${AUTO_LINK_URL}\b`, "gi");
const AUTO_LINK_MATCH_WORD = new RegExp(`${AUTO_LINK_URL}$`, "i");

function createAutoLinkAnchor(doc: Document, href: string, label: string) {
  const anchor = doc.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  return anchor;
}

function autoLinkTextNode(node: Text) {
  const text = node.nodeValue;
  if (!text) return;
  const regex = new RegExp(AUTO_LINK_EXTRACT.source, "gi");
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  const doc = node.ownerDocument || document;
  const fragment = doc.createDocumentFragment();
  let replaced = false;

  while ((match = regex.exec(text))) {
    const start = match.index;
    if (start > lastIndex) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex, start)));
    }
    const urlLabel = match[0];
    const normalizedHref = urlLabel.startsWith("http") ? urlLabel : `https://${urlLabel}`;
    fragment.appendChild(createAutoLinkAnchor(doc, normalizedHref, urlLabel));
    lastIndex = regex.lastIndex;
    replaced = true;
  }

  if (!replaced) return;
  if (lastIndex < text.length) {
    fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
}

function autoLinkEditorContent(root?: HTMLElement | null) {
  if (!root) return;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_SKIP;
        if (!AUTO_LINK_DETECT.test(node.nodeValue)) return NodeFilter.FILTER_SKIP;
        if (node.parentElement?.closest("a")) return NodeFilter.FILTER_SKIP;
        if (node.parentElement?.closest("pre") || node.parentElement?.closest(".cb-code-shell")) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  nodes.forEach((textNode) => autoLinkTextNode(textNode));
}

function storageKeyAttachments(projectId: number) {
  return `cb_note_attachments__${projectId}`;
}

function loadAttachmentsLocal(projectId: number): CavPadAttachment[] {
  if (!projectId) return [];
  try {
    const raw = globalThis.__cbLocalStore.getItem(storageKeyAttachments(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item): CavPadAttachment => {
        const record = (item ?? {}) as Record<string, unknown>;
        const kind = String(record.kind) as CavPadAttachmentKind;
        return {
          id: toStringValue(record.id),
          projectId: toNumberValue(record.projectId, projectId),
          noteId: toStringValue(record.noteId),
          kind: kind === "image" || kind === "video" || kind === "document" || kind === "file" ? kind : "file",
          fileName: toStringValue(record.fileName),
          size: toNumberValue(record.size, 0),
          mimeType: toStringValue(record.mimeType, "application/octet-stream"),
          createdAt: safeNumDate(record.createdAt),
          updatedAt: safeNumDate(record.updatedAt),
        };
      })
      .filter((att) => Boolean(att.id) && Boolean(att.noteId) && att.projectId === projectId);
  } catch {
    return [];
  }
}

function saveAttachmentsLocal(projectId: number, attachments: CavPadAttachment[]) {
  if (!projectId) return;
  try {
    globalThis.__cbLocalStore.setItem(storageKeyAttachments(projectId), JSON.stringify(attachments.slice(0, 400)));
  } catch {}
}

function openAttachmentDB(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = window.indexedDB.open(ATTACHMENT_DB_NAME, ATTACHMENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function saveAttachmentBlob(projectId: number, attachmentId: string, blob: Blob) {
  try {
    const db = await openAttachmentDB();
    if (!db) return;
    const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
    tx.objectStore(ATTACHMENT_STORE).put(blob, `${projectId}_${attachmentId}`);
    await new Promise((resolve) => {
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    });
  } catch {}
}

async function loadAttachmentBlob(projectId: number, attachmentId: string) {
  try {
    const db = await openAttachmentDB();
    if (!db) return null;
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction(ATTACHMENT_STORE, "readonly");
      const req = tx.objectStore(ATTACHMENT_STORE).get(`${projectId}_${attachmentId}`);
      req.onsuccess = () => {
        const value = req.result;
        resolve(value instanceof Blob ? value : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function isEditorEmpty(html: string) {
  const stripped = String(html || "")
    .replace(/<br\s*\/?>(\s*)/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
  return !stripped;
}

function pickRandom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

const CAVPAD_HELP_WRITE_EDIT_ACTIONS = [
  "Make this note more detailed",
  "Summarize this note",
  "Rewrite this note for clarity",
  "Tighten this note",
  "Expand this note with missing context",
  "Turn this note into a cleaner draft",
] as const;

const CAVPAD_HELP_WRITE_EDIT_TARGETS = [
  "action items",
  "owner assignments",
  "next steps",
  "risks and blockers",
  "timeline checkpoints",
  "priority order",
  "decision points",
  "verification steps",
] as const;

const CAVPAD_HELP_WRITE_EDIT_FORMATS = [
  "as a checklist",
  "as a concise brief",
  "as a status update",
  "as bullet points",
  "as an executive summary",
  "as a structured plan",
] as const;

const CAVPAD_HELP_WRITE_CREATE_OPENERS = [
  "Create a workspace note",
  "Draft a project note",
  "Generate a daily note",
  "Write a weekly update",
  "Build a planning note",
  "Create a follow-up note",
] as const;

const CAVPAD_HELP_WRITE_CREATE_TOPICS = [
  "priorities and next steps",
  "current progress and blockers",
  "risks and mitigation tasks",
  "what changed today and what is next",
  "open issues and resolution paths",
  "handoff details and responsibilities",
] as const;

const CAVPAD_HELP_WRITE_CREATE_STYLES = [
  "keep it concise",
  "keep it actionable",
  "keep it structured with clear sections",
  "keep it focused on delivery",
  "keep it direct and professional",
  "keep it ready to share with the team",
] as const;

function buildCavAiHelpPromptHint(hasEditorContent: boolean) {
  if (hasEditorContent) {
    const action = pickRandom(CAVPAD_HELP_WRITE_EDIT_ACTIONS);
    const target = pickRandom(CAVPAD_HELP_WRITE_EDIT_TARGETS);
    const format = pickRandom(CAVPAD_HELP_WRITE_EDIT_FORMATS);
    const variant = Math.floor(Math.random() * 3);
    if (variant === 0) return `${action} with clear ${target}.`;
    if (variant === 1) return `${action} ${format} and highlight ${target}.`;
    return `${action}, preserve intent, and improve ${target}.`;
  }

  const opener = pickRandom(CAVPAD_HELP_WRITE_CREATE_OPENERS);
  const topic = pickRandom(CAVPAD_HELP_WRITE_CREATE_TOPICS);
  const style = pickRandom(CAVPAD_HELP_WRITE_CREATE_STYLES);
  const variant = Math.floor(Math.random() * 3);
  if (variant === 0) return `${opener} about ${topic}.`;
  if (variant === 1) return `${opener} on ${topic}, ${style}.`;
  return `${opener} with ${topic}, ${style}.`;
}

const DEFAULT_CAVPAD_SETTINGS: CavPadSettings = {
  syncToCavcloud: false,
  syncToCavsafe: false,
  allowSharing: true,
  defaultSharePermission: "VIEW",
  defaultShareExpiryDays: 0,
  noteExpiryDays: 0,
  theme: "lime",
  font: "Inter",
  fontColor: "#F7FBFF",
  gridLines: false,
};

function loadNotesLocal(projectId: number): CavPadNoteDoc[] {
  void projectId;
  return [];
}

function saveNotesLocal(projectId: number, notes: CavPadNoteDoc[]) {
  void projectId;
  void notes;
}

function loadFoldersLocal(projectId: number): CavPadNoteFolder[] {
  void projectId;
  return [];
}

function saveFoldersLocal(projectId: number, folders: CavPadNoteFolder[]) {
  void projectId;
  void folders;
}

function loadTrashLocal(projectId: number): CavPadTrashDoc[] {
  void projectId;
  return [];
}

function saveTrashLocal(projectId: number, trash: CavPadTrashDoc[]) {
  void projectId;
  void trash;
}

function loadSettingsLocal(projectId: number): CavPadSettings {
  void projectId;
  return { ...DEFAULT_CAVPAD_SETTINGS };
}

function saveSettingsLocal(projectId: number, settings: CavPadSettings) {
  void projectId;
  void settings;
}

const MONO_FONT = "Fira Code";

const CAVPAD_FONTS = [
  "Inter",
  "Sora",
  "Space Grotesk",
  "Plus Jakarta Sans",
  "Manrope",
  "Space Mono",
  "Outfit",
  "DM Sans",
  "Lexend",
  "Rubik",
  "Work Sans",
  "Urbanist",
  "Epilogue",
  "Fira Code",
  "JetBrains Mono",
  "Barlow",
  "Mulish",
  "Karla",
  "Cabin",
  "Nunito Sans",
  "Source Sans 3",
  "Public Sans",
  "IBM Plex Sans",
  "IBM Plex Mono",
  "Titillium Web",
  "Montserrat",
  "Poppins",
  "Figtree",
  "Red Hat Display",
  "Satisfy",
  "Shadows Into Light",
  "Dancing Script",
  "Patrick Hand",
  "Sacramento",
  "Courgette",
];

const FORMAT_PRESETS: { value: string; label: string; block: string }[] = [
  { value: "title", label: "Title", block: "h1" },
  { value: "heading", label: "Heading", block: "h2" },
  { value: "subheading", label: "Subheading", block: "h3" },
  { value: "body", label: "Body", block: "p" },
  { value: "monostyled", label: "Monostyled", block: "pre" },
];

const CAVPAD_COLORS = [
  { label: "White", value: "#F7FBFF" },
  { label: "Lime", value: "#E6F28D" },
  { label: "Violet", value: "#D6C7FF" },
  { label: "Blue", value: "#B5D8FF" },
];
const CAVPAD_EDITOR_HISTORY_LIMIT = 160;

const CAVPAD_THEME_OPTIONS: { value: CavPadSettings["theme"]; label: string }[] = [
  { value: "lime", label: "Lime" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "glass", label: "White" },
];

function quickStringSignature(input: string) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function normalizeSyncFileTitle(raw: string) {
  const cleaned = String(raw || "")
    .trim()
    .replace(/\.txt$/i, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled";
}

function htmlToPlainText(html: string) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildNotePreviewFromHtml(html: string, maxLen = 96) {
  const compact = htmlToPlainText(html)
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "Empty note";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, Math.max(1, maxLen - 3)).trimEnd()}...`;
}

function textToEditorHtml(text: string) {
  const raw = String(text || "");
  if (!raw.trim()) return "<p></p>";
  const lines = raw.split(/\r?\n/);
  return lines.map((line) => `<p>${escapeHtml(line || "") || "<br>"}</p>`).join("");
}

type CavPadApiNote = {
  id?: string;
  title?: string;
  scope?: unknown;
  siteId?: string | null;
  directoryId?: string | null;
  pinnedAtISO?: string | null;
  cavcloudFileId?: string;
  cavcloudPath?: string;
  sha256?: string;
  permission?: "NONE" | "VIEW" | "EDIT" | "OWNER";
  status?: "normal" | "shared" | "collab";
  shared?: boolean;
  collab?: boolean;
  collaboratorCount?: number;
  editorsCount?: number;
  ownerUserId?: string;
  ownerUsername?: string | null;
  ownerDisplayName?: string | null;
  ownerAvatarUrl?: string | null;
  ownerAvatarTone?: string | null;
  ownerEmail?: string | null;
  lastChangeAtISO?: string | null;
  lastChangeUserId?: string | null;
  lastChangeUsername?: string | null;
  lastChangeDisplayName?: string | null;
  lastChangeEmail?: string | null;
  accessList?: {
    id?: string;
    userId?: string;
    username?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    avatarTone?: string | null;
    email?: string | null;
    permission?: "VIEW" | "EDIT";
    expiresAtISO?: string | null;
  }[];
  textContent?: string;
  createdAtISO?: string;
  updatedAtISO?: string;
  trashedAtISO?: string | null;
};

type CavPadApiDirectory = {
  id?: string;
  name?: string;
  parentId?: string | null;
  pinnedAtISO?: string | null;
  createdAtISO?: string;
  updatedAtISO?: string;
};

type CavPadBootstrapResponse = {
  ok?: boolean;
  notes?: CavPadApiNote[];
  trash?: CavPadApiNote[];
  directories?: CavPadApiDirectory[];
  settings?: Partial<CavPadSettings> & {
    allowSharing?: boolean;
    defaultSharePermission?: "VIEW" | "EDIT";
    defaultShareExpiryDays?: 0 | 7 | 30;
    noteExpiryDays?: 0 | 7 | 30;
  };
};

type CavPadVersionRow = {
  id: string;
  versionNumber: number;
  sha256: string;
  createdAtISO: string;
  createdByUserId?: string | null;
  createdByUsername?: string | null;
  createdByDisplayName?: string | null;
  createdByEmail?: string | null;
};

type CavPadDirectoryAccessRow = {
  id: string;
  userId: string;
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  permission: "VIEW" | "EDIT";
  expiresAtISO?: string | null;
};

function mapApiNoteToDoc(projectId: number, note: CavPadApiNote): CavPadNoteDoc {
  type CavPadAccessRow = NonNullable<CavPadNoteDoc["accessList"]>[number];
  const titleRaw = clampStr(String(note.title || "Untitled"), 80);
  return {
    id: String(note.id || uid("note")),
    projectId,
    scope: "workspace",
    siteId: String(note.siteId || "").trim() || undefined,
    folderId: String(note.directoryId || "").trim() || undefined,
    pinnedAt: note.pinnedAtISO ? safeNumDate(note.pinnedAtISO) : undefined,
    cavcloudFileId: String(note.cavcloudFileId || "").trim() || undefined,
    cavcloudPath: String(note.cavcloudPath || "").trim() || undefined,
    sha256: String(note.sha256 || "").trim() || undefined,
    permission: note.permission || "OWNER",
    status: note.status || (note.shared ? "shared" : "normal"),
    shared: Boolean(note.shared),
    collab: Boolean(note.collab),
    collaboratorCount: Number(note.collaboratorCount || 0) || undefined,
    editorsCount: Number(note.editorsCount || 0) || undefined,
    ownerUserId: String(note.ownerUserId || "").trim() || undefined,
    ownerUsername: String(note.ownerUsername || "").trim() || undefined,
    ownerDisplayName: String(note.ownerDisplayName || "").trim() || undefined,
    ownerAvatarUrl: String(note.ownerAvatarUrl || "").trim() || undefined,
    ownerAvatarTone: String(note.ownerAvatarTone || "").trim() || undefined,
    ownerEmail: String(note.ownerEmail || "").trim() || undefined,
    lastChangeAt: note.lastChangeAtISO ? safeNumDate(note.lastChangeAtISO) : undefined,
    lastChangeUserId: String(note.lastChangeUserId || "").trim() || undefined,
    lastChangeUsername: String(note.lastChangeUsername || "").trim() || undefined,
    lastChangeDisplayName: String(note.lastChangeDisplayName || "").trim() || undefined,
    lastChangeEmail: String(note.lastChangeEmail || "").trim() || undefined,
    accessList: Array.isArray(note.accessList)
      ? note.accessList
          .map((row): CavPadAccessRow => ({
            id: String(row.id || ""),
            userId: String(row.userId || ""),
            username: row.username || null,
            displayName: row.displayName || null,
            avatarUrl: row.avatarUrl || null,
            avatarTone: row.avatarTone || null,
            email: row.email || null,
            permission: row.permission === "EDIT" ? "EDIT" : "VIEW",
            expiresAt: row.expiresAtISO || null,
          }))
          .filter((row) => row.id && row.userId)
      : undefined,
    title: normalizeWorkspaceTitle(titleRaw),
    html: textToEditorHtml(String(note.textContent || "")),
    createdAt: safeNumDate(note.createdAtISO),
    updatedAt: safeNumDate(note.updatedAtISO),
  };
}

function mapApiTrashToDoc(projectId: number, note: CavPadApiNote): CavPadTrashDoc {
  const base = mapApiNoteToDoc(projectId, note);
  return {
    ...base,
    deletedAt: safeNumDate(note.trashedAtISO || note.updatedAtISO),
  };
}

function mapApiDirectoryToFolder(projectId: number, row: CavPadApiDirectory): CavPadNoteFolder {
  return {
    id: String(row.id || uid("fld")),
    projectId,
    name: clampStr(String(row.name || "Directory"), 28),
    parentId: String(row.parentId || "").trim() || undefined,
    pinnedAt: row.pinnedAtISO ? safeNumDate(row.pinnedAtISO) : undefined,
    createdAt: safeNumDate(row.createdAtISO),
    updatedAt: safeNumDate(row.updatedAtISO),
  };
}

function comparePinnedRows(
  a: { pinnedAt?: number; updatedAt?: number },
  b: { pinnedAt?: number; updatedAt?: number }
) {
  const aPinned = typeof a.pinnedAt === "number" && a.pinnedAt > 0;
  const bPinned = typeof b.pinnedAt === "number" && b.pinnedAt > 0;

  if (aPinned !== bPinned) return aPinned ? -1 : 1;

  if (aPinned && bPinned) {
    const aPinnedAt = Number(a.pinnedAt || 0);
    const bPinnedAt = Number(b.pinnedAt || 0);
    if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;
  }

  const aUpdatedAt = Number(a.updatedAt || 0);
  const bUpdatedAt = Number(b.updatedAt || 0);
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt;
  return 0;
}

type CavPadSyncEntry = {
  key: string;
  folderPath: string;
  name: string;
  content: string;
  signature: string;
};

function siteFolderNameForSync(raw: string, fallback = "Site"): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function buildCavPadSyncEntries(
  projectId: number,
  notes: CavPadNoteDoc[],
  activeSiteLabel: string,
): CavPadSyncEntry[] {
  const entries: CavPadSyncEntry[] = [];
  const normalizedSiteLabel = String(activeSiteLabel || "").trim();
  const folderPath = normalizedSiteLabel
    ? `/Synced/CavPad/${siteFolderNameForSync(normalizedSiteLabel, "Site")}`
    : "/Synced/CavPad";

  const noteRows = notes
    .filter((note) => note.projectId === projectId)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const titleCounts = new Map<string, number>();
  noteRows.forEach((note) => {
    const base = normalizeSyncFileTitle(note.title || "");
    const key = base.toLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });
  const titleSeen = new Map<string, number>();
  const usedNames = new Set<string>();
  for (const note of noteRows) {
    const titleBase = normalizeSyncFileTitle(note.title || "");
    const titleKey = titleBase.toLowerCase();
    const sameTitleCount = titleCounts.get(titleKey) || 0;
    const seenCount = (titleSeen.get(titleKey) || 0) + 1;
    titleSeen.set(titleKey, seenCount);

    let fileBase = sameTitleCount > 1 ? `${titleBase} (${seenCount})` : titleBase;
    let dupeNumber = sameTitleCount > 1 ? seenCount + 1 : 2;
    while (usedNames.has(fileBase.toLowerCase())) {
      fileBase = `${titleBase} (${dupeNumber})`;
      dupeNumber += 1;
    }
    usedNames.add(fileBase.toLowerCase());
    const fileName = `${fileBase}.txt`;
    const plainText = htmlToPlainText(note.html);
    const content = [
      `Title: ${note.title || "Untitled"}`,
      "Scope: workspace",
      `Updated: ${new Date(note.updatedAt).toISOString()}`,
      "",
      plainText || "(empty note)",
    ].join("\n");
    entries.push({
      key: `note:${note.id}`,
      folderPath,
      name: fileName,
      content,
      signature: quickStringSignature(`${folderPath}:${note.updatedAt}:${note.title}:${note.html}`),
    });
  }

  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

export function CavPadDock({
  open,
  onClose,
  wsName,
  projectId,
  sites,
  activeSiteId,
  planTier,
  memberRole,
}: {
  open: boolean;
  onClose: () => void;
  wsName: string;
  projectId: number | null;
  sites: CavPadSite[];
  activeSiteId: string;
  planTier?: CavPadPlanTier;
  memberRole?: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
}) {
  const pid = projectId || 0;
  const cavsafeEnabled = planTier === "PREMIUM" || planTier === "PREMIUM_PLUS";
  const [notes, setNotes] = React.useState<CavPadNoteDoc[]>([]);
  const [trash, setTrash] = React.useState<CavPadTrashDoc[]>([]);
  const [trashDaysLeft, setTrashDaysLeft] = React.useState<Record<string, number>>({});
  const [activeNoteId, setActiveNoteId] = React.useState<string>("");
  const [settings, setSettings] = React.useState<CavPadSettings>({
    syncToCavcloud: false,
    syncToCavsafe: false,
    allowSharing: true,
    defaultSharePermission: "VIEW",
    defaultShareExpiryDays: 0,
    noteExpiryDays: 0,
    theme: "lime",
    font: "Inter",
    fontColor: "#F7FBFF",
    gridLines: false,
  });
  const [toast, setToast] = React.useState<{ msg: string; tone: "good" | "watch" | "bad" } | null>(null);
  const [notesBootstrapReady, setNotesBootstrapReady] = React.useState(false);
  const [syncSettingsReady, setSyncSettingsReady] = React.useState(false);
  const cavcloudSyncTimerRef = React.useRef<number | null>(null);
  const cavcloudSyncRevisionRef = React.useRef(0);
  const cavcloudSyncedSignatureRef = React.useRef<Map<string, string>>(new Map());
  const cavsafeSyncTimerRef = React.useRef<number | null>(null);
  const cavsafeSyncRevisionRef = React.useRef(0);
  const cavsafeSyncedSignatureRef = React.useRef<Map<string, string>>(new Map());
  const cavpadSettingsSyncTimerRef = React.useRef<number | null>(null);
  const handledPriorityRequestIdsRef = React.useRef<Set<string>>(new Set());
  const activeSiteLabel = React.useMemo(() => {
    const activeId = String(activeSiteId || "").trim();
    if (!activeId) return "";
    const site = sites.find((row) => String(row.id || "") === activeId);
    return String(site?.label || "").trim();
  }, [activeSiteId, sites]);
  const serverSettingsPayload = React.useMemo(
    () => ({
      syncToCavcloud: settings.syncToCavcloud,
      syncToCavsafe: cavsafeEnabled ? settings.syncToCavsafe : false,
      allowSharing: settings.allowSharing,
      defaultSharePermission: settings.defaultSharePermission,
      defaultShareExpiryDays: settings.defaultShareExpiryDays,
      noteExpiryDays: settings.noteExpiryDays,
    }),
    [
      cavsafeEnabled,
      settings.allowSharing,
      settings.defaultShareExpiryDays,
      settings.defaultSharePermission,
      settings.noteExpiryDays,
      settings.syncToCavcloud,
      settings.syncToCavsafe,
    ]
  );

  React.useEffect(() => {
    if (!pid) {
      setNotesBootstrapReady(true);
      return;
    }
    setNotes(loadNotesLocal(pid));
    setTrash(loadTrashLocal(pid));
    setNotesBootstrapReady(false);
    setSyncSettingsReady(false);
    const loaded = loadSettingsLocal(pid);
    setSettings({
      ...loaded,
      // Do not trust local sync toggles until server bootstrap confirms them.
      syncToCavcloud: false,
      syncToCavsafe: false,
    });
  }, [pid, cavsafeEnabled]);

  React.useEffect(() => {
    if (!pid) return;
    let mounted = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        // Warm lightweight metadata early so the left note panel is ready immediately on open.
        const res = await fetch("/api/cavpad/bootstrap?includeContent=0", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const payload = (await res.json().catch(() => null)) as CavPadBootstrapResponse | null;
        if (!mounted || !res.ok || !payload?.ok) return;

        const nextNotes = Array.isArray(payload.notes)
          ? payload.notes.map((row) => mapApiNoteToDoc(pid, row))
          : [];
        const nextTrash = Array.isArray(payload.trash)
          ? payload.trash.map((row) => mapApiTrashToDoc(pid, row))
          : [];

        setNotes((prev) => {
          const prevById = new Map(prev.map((row) => [row.id, row]));
          const remoteIds = new Set(nextNotes.map((row) => row.id));

          const mergedRemote = nextNotes.map((remote) => {
            const local = prevById.get(remote.id);
            if (!local) return remote;
            const localText = htmlToPlainText(local.html || "");
            const remoteText = htmlToPlainText(remote.html || "");
            const keepLocalBody =
              local.updatedAt >= remote.updatedAt &&
              (Boolean(local.pendingCreate) || Boolean(local.pendingRemoteSync) || (Boolean(localText) && !remoteText));
            const merged = keepLocalBody
              ? {
                  ...remote,
                  title: local.title || remote.title || "Untitled",
                  html: local.html || remote.html,
                  updatedAt: Math.max(remote.updatedAt, local.updatedAt),
                  folderId: remote.folderId ?? local.folderId,
                  siteId: remote.siteId ?? local.siteId,
                  pendingCreate: local.pendingCreate,
                  pendingRemoteSync: local.pendingRemoteSync,
                }
              : remote;
            return merged;
          });

          const unsyncedLocal = prev.filter((row) => row.pendingCreate && !remoteIds.has(row.id));
          const next = [...mergedRemote, ...unsyncedLocal].sort((a, b) => b.updatedAt - a.updatedAt);
          saveNotesLocal(pid, next);
          return next;
        });

        setTrash((prev) => {
          const remoteIds = new Set(nextTrash.map((row) => row.id));
          const now = timeNow();
          const retentionCutoff = now - TRASH_RETENTION_MS;
          const retryCutoff = now - TRASH_REMOTE_RETRY_WINDOW_MS;
          const carryLocal = prev
            .filter(
              (row) =>
                !remoteIds.has(row.id) &&
                row.deletedAt >= retentionCutoff &&
                (row.pendingCreate || row.pendingRemoteSync || row.deletedAt >= retryCutoff)
            )
            .map((row) =>
              row.pendingCreate || row.pendingRemoteSync || row.deletedAt < retryCutoff
                ? row
                : { ...row, pendingRemoteSync: true }
            );
          const merged = [...nextTrash, ...carryLocal].sort((a, b) => b.deletedAt - a.deletedAt);
          saveTrashLocal(pid, merged);
          return merged;
        });

        setSettings((prev) => ({
          ...prev,
          syncToCavcloud:
            payload.settings?.syncToCavcloud == null
              ? prev.syncToCavcloud
              : Boolean(payload.settings.syncToCavcloud),
          syncToCavsafe:
            cavsafeEnabled
              ? (payload.settings?.syncToCavsafe == null
                ? prev.syncToCavsafe
                : Boolean(payload.settings.syncToCavsafe))
              : false,
          allowSharing: payload.settings?.allowSharing !== false,
          defaultSharePermission: payload.settings?.defaultSharePermission === "EDIT" ? "EDIT" : "VIEW",
          defaultShareExpiryDays:
            payload.settings?.defaultShareExpiryDays === 7 || payload.settings?.defaultShareExpiryDays === 30
              ? payload.settings.defaultShareExpiryDays
              : 0,
          noteExpiryDays:
            payload.settings?.noteExpiryDays === 7 || payload.settings?.noteExpiryDays === 30
              ? payload.settings.noteExpiryDays
              : 0,
        }));
        setSyncSettingsReady(true);
      } catch {
        // fail-open: keep local cache visible when bootstrap call fails
      } finally {
        if (mounted) setNotesBootstrapReady(true);
      }
    })();

    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [pid, cavsafeEnabled]);

  React.useEffect(() => {
    function onCreatePriorityNote(event: Event) {
      const payload = normalizePriorityNoteRequest((event as CustomEvent<unknown>).detail);
      if (!payload) return;
      if (!pid) {
        setToast({ msg: "Select a workspace first.", tone: "watch" });
        window.setTimeout(() => setToast(null), 2200);
        return;
      }

      const handledIds = handledPriorityRequestIdsRef.current;
      if (handledIds.has(payload.requestId)) return;
      handledIds.add(payload.requestId);
      if (handledIds.size > 180) handledIds.clear();

      void (async () => {
        const title = clampStr(payload.title || "CavBot priority note", 80) || "Untitled";
        const html = buildPriorityNoteHtml(payload);
        try {
          const textContent = htmlToPlainText(html);
          const res = await fetch("/api/cavpad/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              textContent,
              scope: "workspace",
              siteId: activeSiteId || null,
            }),
          });
          const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
          if (!json?.ok || !json.note) throw new Error("create failed");
          const created = mapApiNoteToDoc(pid, json.note);

          setNotes((prev) => {
            const next = [created, ...prev.filter((row) => row.id !== created.id)];
            saveNotesLocal(pid, next);
            return next;
          });
          setActiveNoteId(created.id);
        } catch {
          const now = timeNow();
          const doc: CavPadNoteDoc = {
            id: uid("note"),
            projectId: pid,
            scope: "workspace",
            siteId: activeSiteId || undefined,
            folderId: undefined,
            title,
            html,
            createdAt: now,
            updatedAt: now,
            pendingCreate: true,
          };
          setNotes((prev) => {
            const next = [doc, ...prev];
            saveNotesLocal(pid, next);
            return next;
          });
          setActiveNoteId(doc.id);
        }
        setToast({ msg: "Priority note created.", tone: "good" });
        window.setTimeout(() => setToast(null), 2200);
      })();
    }

    window.addEventListener(
      "cb:cavpad:create-note-from-priority",
      onCreatePriorityNote as EventListener
    );
    return () => {
      window.removeEventListener(
        "cb:cavpad:create-note-from-priority",
        onCreatePriorityNote as EventListener
      );
    };
  }, [activeSiteId, pid, setActiveNoteId, setNotes]);

  React.useEffect(() => {
    if (!pid || !syncSettingsReady) return;
    saveSettingsLocal(pid, settings);
  }, [pid, settings, syncSettingsReady]);

  React.useEffect(() => {
    if (!pid || !syncSettingsReady) return;
    if (cavpadSettingsSyncTimerRef.current) {
      window.clearTimeout(cavpadSettingsSyncTimerRef.current);
      cavpadSettingsSyncTimerRef.current = null;
    }
    cavpadSettingsSyncTimerRef.current = window.setTimeout(() => {
      void fetch("/api/cavpad/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(serverSettingsPayload),
      }).catch(() => {});
    }, 220);
    return () => {
      if (cavpadSettingsSyncTimerRef.current) {
        window.clearTimeout(cavpadSettingsSyncTimerRef.current);
        cavpadSettingsSyncTimerRef.current = null;
      }
    };
  }, [pid, serverSettingsPayload, syncSettingsReady]);

  React.useEffect(() => {
    if (cavsafeEnabled) return;
    if (!settings.syncToCavsafe) return;
    setSettings((prev) => (prev.syncToCavsafe ? { ...prev, syncToCavsafe: false } : prev));
  }, [cavsafeEnabled, settings.syncToCavsafe, setSettings]);

  React.useEffect(() => {
    if (!pid) return;
    saveTrashLocal(pid, trash);
    const cutoff = timeNow() - TRASH_RETENTION_MS;
    const next = trash.filter((t) => t.deletedAt >= cutoff);
    if (next.length !== trash.length) {
      setTrash(next);
      saveTrashLocal(pid, next);
    }
  }, [pid, trash]);

  React.useEffect(() => {
    const msPerDay = 24 * 60 * 60 * 1000;
    const compute = () => {
      const now = timeNow();
      const next: Record<string, number> = {};
      trash.forEach((doc) => {
        const diff = Math.max(0, now - doc.deletedAt);
        const remaining = Math.max(0, 30 - Math.floor(diff / msPerDay));
        next[doc.id] = remaining;
      });
      setTrashDaysLeft(next);
    };

    compute();
    const timer = window.setInterval(compute, 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [trash]);

  React.useEffect(() => {
    if (!pid || !syncSettingsReady) return;

    if (!settings.syncToCavcloud) {
      if (cavcloudSyncTimerRef.current) {
        window.clearTimeout(cavcloudSyncTimerRef.current);
        cavcloudSyncTimerRef.current = null;
      }
      cavcloudSyncedSignatureRef.current.clear();
      return;
    }

    const entries = buildCavPadSyncEntries(pid, notes, activeSiteLabel);
    const nextSignatures = new Map(entries.map((entry) => [entry.key, entry.signature]));
    const changed = entries.filter((entry) => cavcloudSyncedSignatureRef.current.get(entry.key) !== entry.signature);

    if (!changed.length) {
      cavcloudSyncedSignatureRef.current = nextSignatures;
      return;
    }

    cavcloudSyncRevisionRef.current += 1;
    const revision = cavcloudSyncRevisionRef.current;

    if (cavcloudSyncTimerRef.current) {
      window.clearTimeout(cavcloudSyncTimerRef.current);
      cavcloudSyncTimerRef.current = null;
    }

    cavcloudSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        let failed = 0;
        const merged = new Map(cavcloudSyncedSignatureRef.current);

        for (const entry of changed) {
          try {
            await upsertCavcloudTextFile({
              folderPath: entry.folderPath,
              name: entry.name,
              mimeType: inferSyncMimeType(entry.name),
              content: entry.content,
              source: "cavpad",
            });
            merged.set(entry.key, entry.signature);
          } catch {
            failed += 1;
          }
        }

        if (revision !== cavcloudSyncRevisionRef.current) return;

        cavcloudSyncedSignatureRef.current = failed === 0 ? nextSignatures : merged;
        if (failed > 0) {
          setToast({
            msg: `CavCloud sync incomplete (${failed} note${failed === 1 ? "" : "s"} failed).`,
            tone: "bad",
          });
          window.setTimeout(() => setToast(null), 2200);
        } else {
          window.dispatchEvent(new Event("cb:workspace"));
        }
      })();
    }, 1100);

    return () => {
      if (cavcloudSyncTimerRef.current) {
        window.clearTimeout(cavcloudSyncTimerRef.current);
        cavcloudSyncTimerRef.current = null;
      }
    };
  }, [pid, notes, settings.syncToCavcloud, activeSiteLabel, syncSettingsReady]);

  React.useEffect(() => {
    if (!pid || !syncSettingsReady) return;
    if (!cavsafeEnabled) {
      if (cavsafeSyncTimerRef.current) {
        window.clearTimeout(cavsafeSyncTimerRef.current);
        cavsafeSyncTimerRef.current = null;
      }
      cavsafeSyncedSignatureRef.current.clear();
      return;
    }

    if (!settings.syncToCavsafe) {
      if (cavsafeSyncTimerRef.current) {
        window.clearTimeout(cavsafeSyncTimerRef.current);
        cavsafeSyncTimerRef.current = null;
      }
      cavsafeSyncedSignatureRef.current.clear();
      return;
    }

    const entries = buildCavPadSyncEntries(pid, notes, activeSiteLabel);
    const nextSignatures = new Map(entries.map((entry) => [entry.key, entry.signature]));
    const changed = entries.filter((entry) => cavsafeSyncedSignatureRef.current.get(entry.key) !== entry.signature);

    if (!changed.length) {
      cavsafeSyncedSignatureRef.current = nextSignatures;
      return;
    }

    cavsafeSyncRevisionRef.current += 1;
    const revision = cavsafeSyncRevisionRef.current;

    if (cavsafeSyncTimerRef.current) {
      window.clearTimeout(cavsafeSyncTimerRef.current);
      cavsafeSyncTimerRef.current = null;
    }

    cavsafeSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        let failed = 0;
        const merged = new Map(cavsafeSyncedSignatureRef.current);

        for (const entry of changed) {
          try {
            await upsertCavsafeTextFile({
              folderPath: entry.folderPath,
              name: entry.name,
              mimeType: inferSyncMimeType(entry.name),
              content: entry.content,
              source: "cavpad",
            });
            merged.set(entry.key, entry.signature);
          } catch {
            failed += 1;
          }
        }

        if (revision !== cavsafeSyncRevisionRef.current) return;

        cavsafeSyncedSignatureRef.current = failed === 0 ? nextSignatures : merged;
        if (failed > 0) {
          setToast({
            msg: `CavSafe sync incomplete (${failed} note${failed === 1 ? "" : "s"} failed).`,
            tone: "bad",
          });
          window.setTimeout(() => setToast(null), 2200);
        } else {
          window.dispatchEvent(new Event("cb:workspace"));
        }
      })();
    }, 1100);

    return () => {
      if (cavsafeSyncTimerRef.current) {
        window.clearTimeout(cavsafeSyncTimerRef.current);
        cavsafeSyncTimerRef.current = null;
      }
    };
  }, [pid, notes, settings.syncToCavsafe, cavsafeEnabled, activeSiteLabel, syncSettingsReady]);

  function onToast(msg: string, tone: "good" | "watch" | "bad" = "good") {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 2200);
  }

  if (!open) return null;

  return (
    <>
      <CavPadModal
        wsName={wsName}
        projectId={pid}
        sites={sites}
        activeSiteId={activeSiteId}
        planTier={planTier}
        memberRole={memberRole}
        cavsafeEnabled={cavsafeEnabled}
        notes={notes}
        setNotes={setNotes}
        activeNoteId={activeNoteId}
        setActiveNoteId={setActiveNoteId}
        trash={trash}
        trashDaysLeft={trashDaysLeft}
        setTrash={setTrash}
        notesReady={notesBootstrapReady}
        settings={settings}
        setSettings={setSettings}
        onToast={onToast}
        onClose={onClose}
      />
      {toast ? (
        <div className="cb-cavpad-toast" data-tone={toast.tone} role="status" aria-live="polite">
          {toast.msg}
        </div>
      ) : null}
    </>
  );
}

export function CavPadModal({
  wsName,
  projectId,
  sites,
  activeSiteId,
  planTier,
  memberRole,
  cavsafeEnabled,
  notes,
  setNotes,
  activeNoteId,
  setActiveNoteId,
  trash,
  trashDaysLeft,
  setTrash,
  notesReady,
  settings,
  setSettings,
  onToast,
  onClose,
}: {
  wsName: string;
  projectId: number | null;
  sites: CavPadSite[];
  activeSiteId: string;
  planTier?: CavPadPlanTier;
  memberRole?: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
  cavsafeEnabled: boolean;
  notes: CavPadNoteDoc[];
  setNotes: React.Dispatch<React.SetStateAction<CavPadNoteDoc[]>>;
  activeNoteId: string;
  setActiveNoteId: (id: string) => void;
  trash: CavPadTrashDoc[];
  trashDaysLeft: Record<string, number>;
  setTrash: React.Dispatch<React.SetStateAction<CavPadTrashDoc[]>>;
  notesReady: boolean;
  settings: CavPadSettings;
  setSettings: React.Dispatch<React.SetStateAction<CavPadSettings>>;
  onToast: (msg: string, tone?: "good" | "watch" | "bad") => void;
  onClose: () => void;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const closeHandlerRef = React.useRef<() => void>(() => onClose);
  const siteLabel = React.useMemo(() => {
    if (!activeSiteId) return "";
    const match = sites.find((s) => s.id === activeSiteId);
    return match?.label?.trim() || "";
  }, [activeSiteId, sites]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  React.useEffect(() => {
    try {
      const first =
        panelRef.current?.querySelector<HTMLInputElement>(".cb-notes-titleinput") ||
        panelRef.current?.querySelector<HTMLElement>("[data-notes-editor='true']");
      first?.focus();
    } catch {}
  }, []);

  return (
    <CavPadModalShell
      onOverlayClose={onClose}
      onCloseAction={() => closeHandlerRef.current()}
      panelRef={panelRef}
      wsName={wsName}
      siteLabel={siteLabel}
    >
      <CavPadPanel
        projectId={projectId}
        sites={sites}
        activeSiteId={activeSiteId}
        planTier={planTier}
        memberRole={memberRole}
        cavsafeEnabled={cavsafeEnabled}
        notes={notes}
        setNotes={setNotes}
        activeNoteId={activeNoteId}
        setActiveNoteId={setActiveNoteId}
        trash={trash}
        setTrash={setTrash}
        trashDaysLeft={trashDaysLeft}
        notesReady={notesReady}
        settings={settings}
        setSettings={setSettings}
        onToast={onToast}
        onClose={onClose}
        closeHandlerRef={closeHandlerRef}
        embedded
      />
    </CavPadModalShell>
  );
}

function CavPadModalShell({
  children,
  onOverlayClose,
  onCloseAction,
  panelRef,
  wsName,
  siteLabel,
}: {
  children: React.ReactNode;
  onOverlayClose: () => void;
  onCloseAction: () => void;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  wsName: string;
  siteLabel: string;
}) {
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;
    if (!html || !body) return;

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscrollBehavior = html.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscrollBehavior = body.style.overscrollBehavior;

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscrollBehavior;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscrollBehavior;
    };
  }, []);

  return (
    <div className="cb-home-modal cb-cavpad-modal" role="dialog" aria-modal="true" aria-label="Notes">
      <div className="cb-home-modal-overlay" onClick={onOverlayClose} aria-hidden="true" />

      <div
        className="cb-home-modal-panel wide cb-cavpad-modal-panel"
        ref={panelRef}
        data-ws-name={wsName || undefined}
        data-site-label={siteLabel || undefined}
      >
        <div className="cb-cavpad-shell-body">{children}</div>

        <div className="cb-home-modal-actions">
          <div className="cb-cavpad-modal-footer-badge" aria-hidden="true">
            <div className="cb-badge-left">
              <div className="cb-badge cb-badge-inline">
                <CdnBadgeEyes trackingMode="eyeOnly" />
              </div>
            </div>
          </div>
          <button className="cb-linkpill" type="button" onClick={onCloseAction}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CavPadKebabIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

function CavPadTrashNoticeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 3 9 16H3l9-16Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 9.4v4.7m0 3.1h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CavPadPanel({
  projectId,
  sites,
  activeSiteId,
  planTier,
  memberRole,
  cavsafeEnabled,
  notes,
  setNotes,
  activeNoteId,
  setActiveNoteId,
  trash,
  trashDaysLeft,
  setTrash,
  notesReady,
  settings,
  setSettings,
  onToast,
  onClose,
  closeHandlerRef,
  embedded = false,
}: {
  projectId: number | null;
  sites: CavPadSite[];
  activeSiteId: string;
  planTier?: CavPadPlanTier;
  memberRole?: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
  cavsafeEnabled: boolean;
  notes: CavPadNoteDoc[];
  setNotes: React.Dispatch<React.SetStateAction<CavPadNoteDoc[]>>;
  activeNoteId: string;
  setActiveNoteId: (id: string) => void;
  trash: CavPadTrashDoc[];
  trashDaysLeft: Record<string, number>;
  setTrash: React.Dispatch<React.SetStateAction<CavPadTrashDoc[]>>;
  notesReady: boolean;
  settings: CavPadSettings;
  setSettings: React.Dispatch<React.SetStateAction<CavPadSettings>>;
  onToast: (msg: string, tone?: "good" | "watch" | "bad") => void;
  onClose: () => void;
  closeHandlerRef: React.MutableRefObject<() => void>;
  embedded?: boolean;
}) {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const saveTimer = React.useRef<number | null>(null);

  const pid = projectId || 0;
  const originSiteId = String(activeSiteId || "").trim();
  const [folders, setFolders] = React.useState<CavPadNoteFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = React.useState<string>("all");
  const [view, setView] = React.useState<CavPadView>("cavpad");
  React.useEffect(() => {
    closeHandlerRef.current = () => {
      if (view !== "cavpad") {
        setView("cavpad");
        return;
      }
      onClose();
    };
  }, [view, onClose, closeHandlerRef]);
  const [viewMenuOpen, setViewMenuOpen] = React.useState(false);
  const [isNarrow, setIsNarrow] = React.useState(false);
  const [isPhone, setIsPhone] = React.useState(false);
  const isPhoneWriteView = isPhone && view === "cavpad";
  const [mobileView, setMobileView] = React.useState<"list" | "editor">("list");
  const [editorEmpty, setEditorEmpty] = React.useState(true);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [formatMode, setFormatMode] = React.useState("body");
  const [linkModalOpen, setLinkModalOpen] = React.useState(false);
  const [linkModalValue, setLinkModalValue] = React.useState("");
  const linkInputRef = React.useRef<HTMLInputElement | null>(null);
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  const moveNoteDropdownWrapRef = React.useRef<HTMLDivElement | null>(null);
  const moveNoteSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const mergeDirectoryDropdownWrapRef = React.useRef<HTMLDivElement | null>(null);
  const mergeDirectorySearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [editorActive, setEditorActive] = React.useState(true);
  const linkRangeRef = React.useRef<Range | null>(null);
  const [folderModalOpen, setFolderModalOpen] = React.useState(false);
  const [folderModalMode, setFolderModalMode] = React.useState<"create" | "rename">("create");
  const [folderModalValue, setFolderModalValue] = React.useState("");
  const [folderModalTargetId, setFolderModalTargetId] = React.useState<string | null>(null);
  const [moveNoteModalOpen, setMoveNoteModalOpen] = React.useState(false);
  const [moveNoteModalNoteId, setMoveNoteModalNoteId] = React.useState<string | null>(null);
  const [moveNoteModalDirectoryId, setMoveNoteModalDirectoryId] = React.useState<string>("");
  const [moveNoteModalDropdownOpen, setMoveNoteModalDropdownOpen] = React.useState(false);
  const [moveNoteModalSearchQuery, setMoveNoteModalSearchQuery] = React.useState("");
  const [mergeDirectoryModalOpen, setMergeDirectoryModalOpen] = React.useState(false);
  const [mergeDirectoryModalDirectoryId, setMergeDirectoryModalDirectoryId] = React.useState<string | null>(null);
  const [mergeDirectoryModalTargetId, setMergeDirectoryModalTargetId] = React.useState<string>("");
  const [mergeDirectoryModalDropdownOpen, setMergeDirectoryModalDropdownOpen] = React.useState(false);
  const [mergeDirectoryModalSearchQuery, setMergeDirectoryModalSearchQuery] = React.useState("");
  const [createChooserOpen, setCreateChooserOpen] = React.useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = React.useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [directoryViewFolderId, setDirectoryViewFolderId] = React.useState<string>(CAVPAD_DIRECTORY_ROOT);
  const [directorySection, setDirectorySection] = React.useState<CavPadDirectorySection>("cloud");
  const [selectedDirectoryIds, setSelectedDirectoryIds] = React.useState<string[]>([]);
  const [selectedDirectoryNoteIds, setSelectedDirectoryNoteIds] = React.useState<string[]>([]);
  const [selectedLibraryNoteIds, setSelectedLibraryNoteIds] = React.useState<string[]>([]);
  const [selectedTrashIds, setSelectedTrashIds] = React.useState<string[]>([]);
  const [libraryActionsMenuOpen, setLibraryActionsMenuOpen] = React.useState(false);
  const [directoryActionsMenuOpen, setDirectoryActionsMenuOpen] = React.useState(false);
  const [trashActionsMenuOpen, setTrashActionsMenuOpen] = React.useState(false);
  const [trashNoticeOpen, setTrashNoticeOpen] = React.useState(false);
  const [actionConfirm, setActionConfirm] = React.useState<CavPadActionConfirmConfig | null>(null);
  const [editorFullscreen, setEditorFullscreen] = React.useState(false);
  const [badgeTone, setBadgeTone] = React.useState<"default" | "lime" | "red">("default");
  const [cavAiDraftBusy, setCavAiDraftBusy] = React.useState(false);
  const [cavAiDraftMenuOpen, setCavAiDraftMenuOpen] = React.useState(false);
  const [cavAiHelpPromptOpen, setCavAiHelpPromptOpen] = React.useState(false);
  const [cavAiHelpPromptText, setCavAiHelpPromptText] = React.useState("");
  const [cavAiHelpPromptHint, setCavAiHelpPromptHint] = React.useState("");
  const [cavAiHelpPromptHintCycle, setCavAiHelpPromptHintCycle] = React.useState(0);
  const [cavAiDraftWorkingMode, setCavAiDraftWorkingMode] = React.useState<CavPadAiDraftMode | null>(null);
  const [cavAiControlMenu, setCavAiControlMenu] = React.useState<"model" | "reasoning" | null>(null);
  const [cavAiModelId, setCavAiModelId] = React.useState(DEEPSEEK_CHAT_MODEL_ID);
  const [cavAiLiveModelOptions, setCavAiLiveModelOptions] = React.useState<CavPadModelOption[]>([]);
  const [cavAiReasoningLevel, setCavAiReasoningLevel] = React.useState<CavPadAiReasoningLevel>("medium");
  const [cavAiSessionId, setCavAiSessionId] = React.useState("");
  const [collabModalTarget, setCollabModalTarget] = React.useState<{ kind: "note" | "directory"; id: string } | null>(null);
  const [detailsNoteId, setDetailsNoteId] = React.useState<string | null>(null);
  const [detailsFolderId, setDetailsFolderId] = React.useState<string | null>(null);
  const [detailsVersions, setDetailsVersions] = React.useState<CavPadVersionRow[]>([]);
  const [detailsVersionsBusy, setDetailsVersionsBusy] = React.useState(false);
  const [detailsVersionQuery, setDetailsVersionQuery] = React.useState("");
  const [detailsFolderAccess, setDetailsFolderAccess] = React.useState<CavPadDirectoryAccessRow[]>([]);
  const [detailsFolderAccessBusy, setDetailsFolderAccessBusy] = React.useState(false);
  const [cachedProfile, setCachedProfile] = React.useState<CavPadCachedProfile>(EMPTY_CACHED_PROFILE);
  const warnedTrashNoticeSignatureRef = React.useRef("");
  const lastNonMonoFont = React.useRef(settings.font || "Inter");
  const [attachments, setAttachments] = React.useState<CavPadAttachment[]>([]);
  React.useEffect(() => {
    setCavAiSessionId("");
  }, [pid]);

  const handleFontChange = React.useCallback(
    (value: string) => {
      setSettings((prev) => {
        const nextFont = value;
        if (formatMode !== "monostyled" && nextFont !== MONO_FONT) {
          lastNonMonoFont.current = nextFont;
        }
        return { ...prev, font: nextFont };
      });
    },
    [formatMode, setSettings]
  );
  const attachmentUrlCache = React.useRef<Record<string, string>>({});
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const videoInputRef = React.useRef<HTMLInputElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const uploadButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const uploadMenuRef = React.useRef<HTMLDivElement | null>(null);
  const cavAiControlsRef = React.useRef<HTMLDivElement | null>(null);
  const cavAiDraftMenuRef = React.useRef<HTMLDivElement | null>(null);
  const cavAiHelpPromptInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const cavAiHelpPromptHintRecentRef = React.useRef<string[]>([]);
  const editorHistoryNoteIdRef = React.useRef<string>("");
  const editorHistoryLastHtmlRef = React.useRef<string>("");
  const editorHistoryUndoRef = React.useRef<string[]>([]);
  const editorHistoryRedoRef = React.useRef<string[]>([]);
  const activeNoteIdRef = React.useRef(activeNoteId);
  const autoCreateNoteIdRef = React.useRef<string>("");
  const notesRef = React.useRef(notes);
  const pendingCreateSyncInFlightRef = React.useRef<Set<string>>(new Set());
  const deletedPendingCreateIdsRef = React.useRef<Set<string>>(new Set());
  const pendingTrashSyncInFlightRef = React.useRef<Set<string>>(new Set());
  const pendingTrashSyncRetryAfterRef = React.useRef<Map<string, number>>(new Map());
  const remoteSaveInFlightRef = React.useRef(false);
  const queuedRemoteSaveNoteIdRef = React.useRef<string | null>(null);
  const actionConfirmRef = React.useRef<(() => void) | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = React.useState(false);

  const closeActionConfirm = React.useCallback(() => {
    actionConfirmRef.current = null;
    setActionConfirm(null);
  }, []);

  const openActionConfirm = React.useCallback((config: CavPadActionConfirmConfig, onConfirm: () => void) => {
    actionConfirmRef.current = onConfirm;
    setActionConfirm(config);
  }, []);

  const runActionConfirm = React.useCallback(() => {
    const onConfirm = actionConfirmRef.current;
    actionConfirmRef.current = null;
    setActionConfirm(null);
    if (onConfirm) onConfirm();
  }, []);

  React.useEffect(() => {
    activeNoteIdRef.current = activeNoteId;
  }, [activeNoteId]);

  React.useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const syncPendingTrashMove = React.useCallback((noteId: string) => {
    if (!pid) return;
    if (pendingTrashSyncInFlightRef.current.has(noteId)) return;
    const retryAfter = pendingTrashSyncRetryAfterRef.current.get(noteId) || 0;
    if (retryAfter > timeNow()) return;

    const item = trash.find((row) => row.id === noteId);
    if (!item || item.pendingCreate || !item.pendingRemoteSync) return;

    pendingTrashSyncInFlightRef.current.add(noteId);
    void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      keepalive: true,
    })
      .then(async (res) => {
        if (res.status === 404) {
          pendingTrashSyncRetryAfterRef.current.delete(noteId);
          setTrash((prev) => {
            const next = prev.map((row) =>
              row.id === noteId ? { ...row, pendingCreate: false, pendingRemoteSync: false } : row
            );
            saveTrashLocal(pid, next);
            return next;
          });
          return;
        }
        const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!res.ok || !json?.ok) throw new Error("trash sync failed");
        pendingTrashSyncRetryAfterRef.current.delete(noteId);
        setTrash((prev) => {
          const next = prev.map((row) =>
            row.id === noteId ? { ...row, pendingRemoteSync: false } : row
          );
          saveTrashLocal(pid, next);
          return next;
        });
      })
      .catch(() => {
        pendingTrashSyncRetryAfterRef.current.set(noteId, timeNow() + TRASH_REMOTE_RETRY_COOLDOWN_MS);
      })
      .finally(() => {
        pendingTrashSyncInFlightRef.current.delete(noteId);
      });
  }, [pid, setTrash, trash]);

  React.useEffect(() => {
    deletedPendingCreateIdsRef.current.clear();
    pendingTrashSyncInFlightRef.current.clear();
    pendingTrashSyncRetryAfterRef.current.clear();
  }, [pid]);

  React.useEffect(() => {
    if (!pid) return;
    const pendingIds = trash
      .filter((row) => !row.pendingCreate && row.pendingRemoteSync)
      .map((row) => row.id);
    if (!pendingIds.length) return;
    pendingIds.forEach((id) => syncPendingTrashMove(id));
  }, [pid, trash, syncPendingTrashMove]);

  // bootstrap folders local
  React.useEffect(() => {
    if (!pid) {
      setFolders([]);
      setActiveFolderId("all");
      setDirectoryViewFolderId(CAVPAD_DIRECTORY_ROOT);
      setSelectedDirectoryNoteIds([]);
      return;
    }
    const loaded = loadFoldersLocal(pid);
    setFolders(loaded);
    setActiveFolderId("all");
    setDirectoryViewFolderId(CAVPAD_DIRECTORY_ROOT);
    let mounted = true;
    const ctrl = new AbortController();
    void fetch("/api/cavpad/directories", {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; directories?: CavPadApiDirectory[] } | null;
        if (!mounted || !json?.ok || !Array.isArray(json.directories)) return;
        const next = json.directories.map((row) => mapApiDirectoryToFolder(pid, row));
        setFolders((prev) => {
          const pendingLocal = prev.filter((row) => row.pendingCreate);
          if (!pendingLocal.length) {
            saveFoldersLocal(pid, next);
            return next;
          }
          const merged = [...next];
          for (const local of pendingLocal) {
            if (!merged.some((row) => row.id === local.id)) {
              merged.push(local);
            }
          }
          saveFoldersLocal(pid, merged);
          return merged;
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
      ctrl.abort();
    };
  }, [pid]);

  React.useEffect(() => {
    setViewMenuOpen(false);
    setGlobalSearchOpen(false);
  }, [view]);

  React.useEffect(() => {
    if (view !== "notes") {
      setLibraryActionsMenuOpen(false);
      setSelectedLibraryNoteIds([]);
    }
    if (view !== "directories") {
      setDirectoryActionsMenuOpen(false);
      setSelectedDirectoryIds([]);
      setSelectedDirectoryNoteIds([]);
    }
    if (view !== "trash") {
      setTrashActionsMenuOpen(false);
      setSelectedTrashIds([]);
      setTrashNoticeOpen(false);
    }
    if (view !== "cavpad") {
      setEditorFullscreen(false);
    }
  }, [view]);

  React.useEffect(() => {
    if (!trashNoticeOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setTrashNoticeOpen(false);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [trashNoticeOpen]);

  React.useEffect(() => {
    if (!actionConfirm) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeActionConfirm();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actionConfirm, closeActionConfirm]);

  React.useEffect(() => {
    setSelectedLibraryNoteIds((prev) => prev.filter((id) => notes.some((note) => note.id === id)));
  }, [notes]);

  React.useEffect(() => {
    setSelectedDirectoryIds((prev) => prev.filter((id) => folders.some((folder) => folder.id === id)));
  }, [folders]);

  React.useEffect(() => {
    setSelectedDirectoryNoteIds((prev) => prev.filter((id) => notes.some((note) => note.id === id)));
  }, [notes]);

  React.useEffect(() => {
    if (directoryViewFolderId === CAVPAD_DIRECTORY_ROOT) return;
    const exists = folders.some((folder) => folder.id === directoryViewFolderId);
    if (!exists) {
      setDirectoryViewFolderId(CAVPAD_DIRECTORY_ROOT);
    }
  }, [directoryViewFolderId, folders]);

  React.useEffect(() => {
    setSelectedTrashIds((prev) => prev.filter((id) => trash.some((item) => item.id === id)));
  }, [trash]);

  React.useEffect(() => {
    if (!selectedLibraryNoteIds.length) setLibraryActionsMenuOpen(false);
  }, [selectedLibraryNoteIds.length]);

  React.useEffect(() => {
    if (!selectedDirectoryIds.length && !selectedDirectoryNoteIds.length) setDirectoryActionsMenuOpen(false);
  }, [selectedDirectoryIds.length, selectedDirectoryNoteIds.length]);

  React.useEffect(() => {
    if (view !== "directories") return;
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryIds([]);
    setSelectedDirectoryNoteIds([]);
  }, [directorySection, view]);

  React.useEffect(() => {
    if (!selectedTrashIds.length) setTrashActionsMenuOpen(false);
  }, [selectedTrashIds.length]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshCachedProfile = () => setCachedProfile(readCachedProfile());
    refreshCachedProfile();
    function onStorage(event: StorageEvent) {
      if (!event.key) return;
      if (
        event.key === "cb_profile_username_v1" ||
        event.key === "cb_profile_fullName_v1" ||
        event.key === "cb_profile_email_v1" ||
        event.key === "cb_settings_avatar_image_v2" ||
        event.key === "cb_settings_avatar_tone_v2"
      ) {
        refreshCachedProfile();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  React.useEffect(() => {
    const noteId = detailsNoteId || "";
    if (view !== "details" || !noteId) {
      setDetailsVersions([]);
      setDetailsVersionsBusy(false);
      setDetailsVersionQuery("");
      return;
    }
    setDetailsVersionQuery("");
    setDetailsVersionsBusy(true);
    const ctrl = new AbortController();
    void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}/versions?limit=60`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; versions?: CavPadVersionRow[] } | null;
        if (!json?.ok || !Array.isArray(json.versions)) return;
        setDetailsVersions(json.versions);
      })
      .catch(() => {})
      .finally(() => setDetailsVersionsBusy(false));
    return () => ctrl.abort();
  }, [detailsNoteId, view]);

  React.useEffect(() => {
    const folderId = detailsFolderId || "";
    if (view !== "details" || !folderId) {
      setDetailsFolderAccess([]);
      setDetailsFolderAccessBusy(false);
      return;
    }
    setDetailsFolderAccessBusy(true);
    const ctrl = new AbortController();
    void fetch(`/api/cavpad/directories/${encodeURIComponent(folderId)}/share`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          accessList?: Array<{
            id?: string;
            userId?: string;
            username?: string | null;
            displayName?: string | null;
            email?: string | null;
            permission?: "VIEW" | "EDIT";
            expiresAtISO?: string | null;
          }>;
        } | null;
        if (!json?.ok || !Array.isArray(json.accessList)) return;
        const rows = json.accessList
          .map((row): CavPadDirectoryAccessRow => ({
            id: String(row.id || ""),
            userId: String(row.userId || ""),
            username: row.username || null,
            displayName: row.displayName || null,
            email: row.email || null,
            permission: row.permission === "EDIT" ? "EDIT" : "VIEW",
            expiresAtISO: row.expiresAtISO || null,
          }))
          .filter((row) => row.id && row.userId);
        setDetailsFolderAccess(rows);
      })
      .catch(() => {})
      .finally(() => setDetailsFolderAccessBusy(false));
    return () => ctrl.abort();
  }, [detailsFolderId, view]);

  React.useEffect(() => {
    function onCreatePriorityNote() {
      setView("cavpad");
    }
    window.addEventListener("cb:cavpad:create-note-from-priority", onCreatePriorityNote as EventListener);
    return () => {
      window.removeEventListener("cb:cavpad:create-note-from-priority", onCreatePriorityNote as EventListener);
    };
  }, []);

  React.useEffect(() => {
    function onTone(event: Event) {
      const tone = (event as CustomEvent<{ tone?: "default" | "lime" | "red" }>).detail?.tone;
      if (!tone) {
        setBadgeTone("default");
        return;
      }
      setBadgeTone(tone);
    }
    window.addEventListener("cb:eye-tone", onTone as EventListener);
    return () => window.removeEventListener("cb:eye-tone", onTone as EventListener);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 980px)");
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  React.useEffect(() => {
    if (linkModalOpen) {
      linkInputRef.current?.focus();
    }
  }, [linkModalOpen]);

  React.useEffect(() => {
    if (folderModalOpen) {
      folderInputRef.current?.focus();
    }
  }, [folderModalOpen, folderModalMode]);

  React.useEffect(() => {
    if (!moveNoteModalOpen || !moveNoteModalDropdownOpen) return;
    moveNoteSearchInputRef.current?.focus();
  }, [moveNoteModalDropdownOpen, moveNoteModalOpen]);

  React.useEffect(() => {
    if (!moveNoteModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (moveNoteModalDropdownOpen) {
        setMoveNoteModalDropdownOpen(false);
        return;
      }
      setMoveNoteModalOpen(false);
      setMoveNoteModalNoteId(null);
      setMoveNoteModalDirectoryId("");
      setMoveNoteModalDropdownOpen(false);
      setMoveNoteModalSearchQuery("");
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [moveNoteModalDropdownOpen, moveNoteModalOpen]);

  React.useEffect(() => {
    if (!moveNoteModalOpen || !moveNoteModalDropdownOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (moveNoteDropdownWrapRef.current?.contains(event.target as Node)) return;
      setMoveNoteModalDropdownOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [moveNoteModalDropdownOpen, moveNoteModalOpen]);

  React.useEffect(() => {
    if (!moveNoteModalOpen) return;
    if (!moveNoteModalDirectoryId || moveNoteModalDirectoryId === "all") return;
    const exists = folders.some((folder) => folder.id === moveNoteModalDirectoryId);
    if (!exists) setMoveNoteModalDirectoryId("");
  }, [folders, moveNoteModalDirectoryId, moveNoteModalOpen]);

  React.useEffect(() => {
    if (!mergeDirectoryModalOpen || !mergeDirectoryModalDropdownOpen) return;
    mergeDirectorySearchInputRef.current?.focus();
  }, [mergeDirectoryModalDropdownOpen, mergeDirectoryModalOpen]);

  React.useEffect(() => {
    if (!mergeDirectoryModalOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (mergeDirectoryModalDropdownOpen) {
        setMergeDirectoryModalDropdownOpen(false);
        return;
      }
      setMergeDirectoryModalOpen(false);
      setMergeDirectoryModalDirectoryId(null);
      setMergeDirectoryModalTargetId("");
      setMergeDirectoryModalDropdownOpen(false);
      setMergeDirectoryModalSearchQuery("");
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mergeDirectoryModalDropdownOpen, mergeDirectoryModalOpen]);

  React.useEffect(() => {
    if (!mergeDirectoryModalOpen || !mergeDirectoryModalDropdownOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (mergeDirectoryDropdownWrapRef.current?.contains(event.target as Node)) return;
      setMergeDirectoryModalDropdownOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [mergeDirectoryModalDropdownOpen, mergeDirectoryModalOpen]);

  React.useEffect(() => {
    if (!mergeDirectoryModalOpen) return;
    if (!mergeDirectoryModalTargetId || mergeDirectoryModalTargetId === "root") return;
    const exists = folders.some((folder) => folder.id === mergeDirectoryModalTargetId);
    if (!exists) setMergeDirectoryModalTargetId("");
  }, [folders, mergeDirectoryModalOpen, mergeDirectoryModalTargetId]);

  React.useEffect(() => {
    if (!pid) {
      setAttachments([]);
      return;
    }
    setAttachments(loadAttachmentsLocal(pid));
  }, [pid]);

  React.useEffect(() => {
    return () => {
      Object.values(attachmentUrlCache.current).forEach((url) => URL.revokeObjectURL(url));
      attachmentUrlCache.current = {};
    };
  }, [pid]);

  React.useEffect(() => {
    if (!uploadMenuOpen) return;
    function closeOnClick(event: MouseEvent) {
      if (
        uploadMenuRef.current?.contains(event.target as Node) ||
        uploadButtonRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setUploadMenuOpen(false);
    }

    function closeOnKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUploadMenuOpen(false);
        uploadButtonRef.current?.focus();
      }
    }

    window.addEventListener("mousedown", closeOnClick);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [uploadMenuOpen]);

  React.useEffect(() => {
    if (!cavAiDraftMenuOpen && !cavAiControlMenu && !cavAiHelpPromptOpen) return;
    function closeOnClick(event: MouseEvent) {
      if (cavAiDraftBusy) return;
      if (cavAiControlsRef.current?.contains(event.target as Node)) return;
      setCavAiDraftMenuOpen(false);
      setCavAiControlMenu(null);
      setCavAiHelpPromptOpen(false);
    }
    function closeOnKey(event: KeyboardEvent) {
      if (cavAiDraftBusy) return;
      if (event.key !== "Escape") return;
      setCavAiDraftMenuOpen(false);
      setCavAiControlMenu(null);
      setCavAiHelpPromptOpen(false);
    }
    window.addEventListener("mousedown", closeOnClick);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [cavAiControlMenu, cavAiDraftBusy, cavAiDraftMenuOpen, cavAiHelpPromptOpen]);

  React.useEffect(() => {
    if (!cavAiHelpPromptOpen) return;
    const timer = window.setTimeout(() => cavAiHelpPromptInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [cavAiHelpPromptOpen]);

  const rotateCavAiHelpPromptHint = React.useCallback(() => {
    const currentEditorHtml = String(editorRef.current?.innerHTML || "");
    const hasEditorContent = currentEditorHtml ? !isEditorEmpty(currentEditorHtml) : !editorEmpty;
    let nextHint = "";
    const recent = cavAiHelpPromptHintRecentRef.current;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const candidate = buildCavAiHelpPromptHint(hasEditorContent);
      if (!recent.includes(candidate)) {
        nextHint = candidate;
        break;
      }
      nextHint = candidate;
    }
    if (!nextHint) {
      nextHint = hasEditorContent
        ? "Make this note more detailed with clear action items."
        : "Create a workspace note with priorities and next steps.";
    }
    recent.push(nextHint);
    if (recent.length > 28) recent.splice(0, recent.length - 28);
    setCavAiHelpPromptHint(nextHint);
    setCavAiHelpPromptHintCycle((value) => value + 1);
  }, [editorEmpty]);

  React.useEffect(() => {
    if (!cavAiHelpPromptOpen) {
      cavAiHelpPromptHintRecentRef.current = [];
      return;
    }
    rotateCavAiHelpPromptHint();
    const interval = window.setInterval(() => rotateCavAiHelpPromptHint(), 6800);
    return () => window.clearInterval(interval);
  }, [cavAiHelpPromptOpen, rotateCavAiHelpPromptHint]);

  React.useEffect(() => {
    if (!viewMenuOpen && !libraryActionsMenuOpen && !directoryActionsMenuOpen && !trashActionsMenuOpen && !globalSearchOpen) return;

    function closeMenus() {
      setViewMenuOpen(false);
      setLibraryActionsMenuOpen(false);
      setDirectoryActionsMenuOpen(false);
      setTrashActionsMenuOpen(false);
      setGlobalSearchOpen(false);
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest(".cb-notes-viewmenu")) return;
      if (target.closest("[data-cavpad-search-wrap='true']")) return;
      if (target.closest("[data-cavpad-note-menu-wrap='true']")) return;
      if (target.closest("[data-cavpad-directory-menu-wrap='true']")) return;
      if (target.closest("[data-cavpad-trash-menu-wrap='true']")) return;
      closeMenus();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenus();
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [directoryActionsMenuOpen, globalSearchOpen, libraryActionsMenuOpen, trashActionsMenuOpen, viewMenuOpen]);

  React.useEffect(() => {
    const hasSelection =
      (view === "notes" && selectedLibraryNoteIds.length > 0) ||
      (view === "directories" && (selectedDirectoryIds.length > 0 || selectedDirectoryNoteIds.length > 0)) ||
      (view === "trash" && selectedTrashIds.length > 0);
    if (!hasSelection) return;

    function clearVisibleSelection() {
      if (view === "notes") {
        setSelectedLibraryNoteIds((prev) => (prev.length ? [] : prev));
        return;
      }
      if (view === "directories") {
        setSelectedDirectoryIds((prev) => (prev.length ? [] : prev));
        setSelectedDirectoryNoteIds((prev) => (prev.length ? [] : prev));
        return;
      }
      if (view === "trash") {
        setSelectedTrashIds((prev) => (prev.length ? [] : prev));
      }
    }

    function onPointerDown(event: MouseEvent) {
      if (
        !shouldClearDesktopSelectionFromTarget(event.target, {
          preserveSelectors: [
            "[data-desktop-select-preserve='true']",
            "[data-cavpad-note-menu-wrap='true']",
            "[data-cavpad-directory-menu-wrap='true']",
            "[data-cavpad-trash-menu-wrap='true']",
          ],
        })
      ) {
        return;
      }
      clearVisibleSelection();
    }

    window.addEventListener("mousedown", onPointerDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [
    selectedDirectoryIds.length,
    selectedDirectoryNoteIds.length,
    selectedLibraryNoteIds.length,
    selectedTrashIds.length,
    view,
  ]);

  const attachmentsById = React.useMemo(() => {
    const map = new Map<string, CavPadAttachment>();
    if (!pid) return map;
    attachments.forEach((att) => {
      if (att.projectId === pid) map.set(att.id, att);
    });
    return map;
  }, [attachments, pid]);

  const ensureAttachmentUrl = React.useCallback(async (meta: CavPadAttachment) => {
    if (!pid) return "";
    const cached = attachmentUrlCache.current[meta.id];
    if (cached) return cached;
    const blob = await loadAttachmentBlob(pid, meta.id);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    attachmentUrlCache.current[meta.id] = url;
    return url;
  }, [pid]);

  const hydrateAttachments = React.useCallback(
    (root?: HTMLElement | null) => {
      const container = root ?? editorRef.current;
      if (!container) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(".cb-attachment[data-attachment-id]"));
      nodes.forEach((node) => {
        if (node.dataset.hydrated === "1") return;
        const id = node.dataset.attachmentId;
        if (!id) return;
        const meta = attachmentsById.get(id);
        if (!meta) return;
        node.dataset.hydrated = "1";
        const mediaSlot = node.querySelector<HTMLElement>("[data-attachment-media]");
        if (!mediaSlot) return;
        ensureAttachmentUrl(meta).then((url) => {
          if (!url) return;
          if (meta.kind === "image") {
            const img = mediaSlot.querySelector<HTMLImageElement>("img[data-attachment-media]");
            if (img) img.src = url;
          } else if (meta.kind === "video") {
            const video = mediaSlot.querySelector<HTMLVideoElement>("video[data-attachment-media]");
            if (video) video.src = url;
          }
          const link = node.querySelector<HTMLAnchorElement>(`[data-attachment-download="${meta.id}"]`);
          if (link) {
            link.href = url;
            link.download = meta.fileName;
          }
        });
      });
    },
    [attachmentsById, ensureAttachmentUrl]
  );

  function toggleLibrarySelection(noteId: string) {
    setLibraryActionsMenuOpen(false);
    setSelectedLibraryNoteIds((prev) => selectDesktopItemArray(prev, noteId));
  }

  function toggleDirectorySelection(folderId: string) {
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryNoteIds([]);
    setSelectedDirectoryIds((prev) => selectDesktopItemArray(prev, folderId));
  }

  function toggleDirectoryNoteSelection(noteId: string) {
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryIds([]);
    setSelectedDirectoryNoteIds((prev) => selectDesktopItemArray(prev, noteId));
  }

  function toggleTrashSelection(noteId: string) {
    setTrashActionsMenuOpen(false);
    setSelectedTrashIds((prev) => toggleDesktopItemArray(prev, noteId));
  }

  function toggleSelectAllDirectories() {
    if (!directoryScopedFolders.length) return;
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryNoteIds([]);
    const visibleIds = directoryScopedFolders.map((folder) => folder.id);
    setSelectedDirectoryIds((prev) => {
      const allVisibleSelected =
        prev.length === visibleIds.length && visibleIds.every((id) => prev.includes(id));
      return allVisibleSelected ? [] : visibleIds;
    });
  }

  function toggleSelectAllDirectoryNotes() {
    if (!directoryScopedNotes.length) return;
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryIds([]);
    const visibleIds = directoryScopedNotes.map((note) => note.id);
    setSelectedDirectoryNoteIds((prev) => {
      const allVisibleSelected =
        prev.length === visibleIds.length && visibleIds.every((id) => prev.includes(id));
      return allVisibleSelected ? [] : visibleIds;
    });
  }

  function toggleSelectAllTrash() {
    if (!trash.length) return;
    setTrashActionsMenuOpen(false);
    const visibleIds = trash.map((item) => item.id);
    setSelectedTrashIds((prev) => {
      const allVisibleSelected =
        visibleIds.length > 0 &&
        prev.length === visibleIds.length &&
        visibleIds.every((id) => prev.includes(id));
      if (allVisibleSelected) return [];
      return visibleIds;
    });
  }

  function toggleSelectAllLibrary() {
    const available = notes.filter((row) => row.projectId === pid);
    if (!available.length) return;
    setLibraryActionsMenuOpen(false);
    setSelectedLibraryNoteIds((prev) => (prev.length === available.length ? [] : available.map((row) => row.id)));
  }

  function openSelectedDirectory() {
    if (selectedDirectoryIds.length !== 1) return;
    openDirectory(selectedDirectoryIds[0]);
  }

  function openSelectedDirectoryNote() {
    if (selectedDirectoryNoteIds.length !== 1) return;
    openDirectoryNote(selectedDirectoryNoteIds[0]);
  }

  function openSelectedLibraryNote() {
    if (selectedLibraryNoteIds.length !== 1) return;
    const targetId = selectedLibraryNoteIds[0];
    setActiveNoteId(targetId);
    setView("cavpad");
  }

  function refreshNoteMetadata(noteId: string) {
    if (!pid) return;
    void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}?includeContent=1`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
        if (!res.ok || !payload?.ok || !payload.note) return;
        const remote = mapApiNoteToDoc(pid, payload.note);
        setNotes((prev) => {
          const next = prev.map((row) => (row.id === remote.id ? mergeRemoteMetaKeepLocal(row, remote) : row));
          saveNotesLocal(pid, next);
          return next;
        });
      })
      .catch(() => {});
  }

  function openCollaborateForNote(noteId: string) {
    const target = notes.find((row) => row.id === noteId);
    if (!target) {
      onToast("Note not found.", "watch");
      return;
    }
    setLibraryActionsMenuOpen(false);
    setDirectoryActionsMenuOpen(false);
    setCollabModalTarget({ kind: "note", id: noteId });
  }

  function openCollaborateForDirectory(directoryId: string) {
    const target = folders.find((row) => row.id === directoryId);
    if (!target) {
      onToast("Directory not found.", "watch");
      return;
    }
    setDirectoryActionsMenuOpen(false);
    setCollabModalTarget({ kind: "directory", id: directoryId });
  }

  function openShareForSelectedLibraryNote() {
    if (selectedLibraryNoteIds.length !== 1) return;
    openCollaborateForNote(selectedLibraryNoteIds[0]);
  }

  function openShareForSelectedDirectoryNote() {
    if (selectedDirectoryNoteIds.length !== 1) return;
    openCollaborateForNote(selectedDirectoryNoteIds[0]);
  }

  function openShareForSelectedDirectory() {
    if (selectedDirectoryIds.length !== 1) return;
    openCollaborateForDirectory(selectedDirectoryIds[0]);
  }

  function openDetailsForSelectedLibraryNote() {
    if (selectedLibraryNoteIds.length !== 1) return;
    setDetailsNoteId(selectedLibraryNoteIds[0]);
    setDetailsFolderId(null);
    setView("details");
  }

  function openDetailsForSelectedDirectoryNote() {
    if (selectedDirectoryNoteIds.length !== 1) return;
    setDetailsNoteId(selectedDirectoryNoteIds[0]);
    setDetailsFolderId(null);
    setView("details");
  }

  function openDetailsForSelectedDirectory() {
    if (selectedDirectoryIds.length !== 1) return;
    setDetailsFolderId(selectedDirectoryIds[0]);
    setDetailsNoteId(null);
    setView("details");
  }

  function closeMoveNoteModal() {
    setMoveNoteModalOpen(false);
    setMoveNoteModalNoteId(null);
    setMoveNoteModalDirectoryId("");
    setMoveNoteModalDropdownOpen(false);
    setMoveNoteModalSearchQuery("");
  }

  function openMoveNoteModal(noteId: string) {
    const target = notes.find((row) => row.id === noteId);
    if (!target) {
      onToast("Note not found.", "watch");
      return;
    }
    setLibraryActionsMenuOpen(false);
    setDirectoryActionsMenuOpen(false);
    setMoveNoteModalNoteId(noteId);
    setMoveNoteModalDirectoryId("");
    setMoveNoteModalDropdownOpen(false);
    setMoveNoteModalSearchQuery("");
    setMoveNoteModalOpen(true);
  }

  function confirmMoveNoteModal() {
    const noteId = String(moveNoteModalNoteId || "").trim();
    if (!noteId) {
      closeMoveNoteModal();
      return;
    }
    if (!moveNoteModalDirectoryId) {
      onToast("Select a directory first.", "watch");
      return;
    }
    setNoteFolder(noteId, moveNoteModalDirectoryId);
    closeMoveNoteModal();
  }

  function moveSelectedLibraryNoteToDirectory() {
    if (selectedLibraryNoteIds.length !== 1) return;
    openMoveNoteModal(selectedLibraryNoteIds[0]);
  }

  function moveSelectedDirectoryNoteToDirectory() {
    if (selectedDirectoryNoteIds.length !== 1) return;
    openMoveNoteModal(selectedDirectoryNoteIds[0]);
  }

  function closeMergeDirectoryModal() {
    setMergeDirectoryModalOpen(false);
    setMergeDirectoryModalDirectoryId(null);
    setMergeDirectoryModalTargetId("");
    setMergeDirectoryModalDropdownOpen(false);
    setMergeDirectoryModalSearchQuery("");
  }

  function openMergeDirectoryModal() {
    if (selectedDirectoryIds.length !== 1) return;
    const directoryId = selectedDirectoryIds[0];
    const target = folders.find((row) => row.id === directoryId);
    if (!target) {
      onToast("Directory not found.", "watch");
      return;
    }
    setDirectoryActionsMenuOpen(false);
    setMergeDirectoryModalDirectoryId(directoryId);
    setMergeDirectoryModalTargetId(target.parentId ? target.parentId : "root");
    setMergeDirectoryModalDropdownOpen(false);
    setMergeDirectoryModalSearchQuery("");
    setMergeDirectoryModalOpen(true);
  }

  function applyPinnedForNotesLocal(noteIds: string[], shouldPin: boolean, pinStamp = timeNow()) {
    if (!pid || !noteIds.length) return;
    const selected = new Set(noteIds);
    setNotes((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.projectId !== pid || !selected.has(row.id)) return row;
        const isPinned = typeof row.pinnedAt === "number" && row.pinnedAt > 0;
        if (shouldPin) {
          if (isPinned) return row;
          changed = true;
          return { ...row, pinnedAt: pinStamp };
        }
        if (!isPinned) return row;
        changed = true;
        return { ...row, pinnedAt: undefined };
      });
      if (changed) saveNotesLocal(pid, next);
      return changed ? next : prev;
    });
  }

  function restorePinnedForNotesLocal(snapshot: Map<string, number | undefined>) {
    if (!pid || !snapshot.size) return;
    setNotes((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.projectId !== pid) return row;
        if (!snapshot.has(row.id)) return row;
        const previousPinnedAt = snapshot.get(row.id);
        const currentPinnedAt = row.pinnedAt;
        if ((previousPinnedAt || 0) === (currentPinnedAt || 0)) return row;
        changed = true;
        if (typeof previousPinnedAt === "number" && previousPinnedAt > 0) {
          return { ...row, pinnedAt: previousPinnedAt };
        }
        return { ...row, pinnedAt: undefined };
      });
      if (changed) saveNotesLocal(pid, next);
      return changed ? next : prev;
    });
  }

  function applyPinnedForDirectoriesLocal(directoryIds: string[], shouldPin: boolean, pinStamp = timeNow()) {
    if (!pid || !directoryIds.length) return;
    const selected = new Set(directoryIds);
    setFolders((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.projectId !== pid || !selected.has(row.id)) return row;
        const isPinned = typeof row.pinnedAt === "number" && row.pinnedAt > 0;
        if (shouldPin) {
          if (isPinned) return row;
          changed = true;
          return { ...row, pinnedAt: pinStamp };
        }
        if (!isPinned) return row;
        changed = true;
        return { ...row, pinnedAt: undefined };
      });
      if (changed) saveFoldersLocal(pid, next);
      return changed ? next : prev;
    });
  }

  function restorePinnedForDirectoriesLocal(snapshot: Map<string, number | undefined>) {
    if (!pid || !snapshot.size) return;
    setFolders((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if (row.projectId !== pid) return row;
        if (!snapshot.has(row.id)) return row;
        const previousPinnedAt = snapshot.get(row.id);
        const currentPinnedAt = row.pinnedAt;
        if ((previousPinnedAt || 0) === (currentPinnedAt || 0)) return row;
        changed = true;
        if (typeof previousPinnedAt === "number" && previousPinnedAt > 0) {
          return { ...row, pinnedAt: previousPinnedAt };
        }
        return { ...row, pinnedAt: undefined };
      });
      if (changed) saveFoldersLocal(pid, next);
      return changed ? next : prev;
    });
  }

  const refreshCavPadFromServer = React.useCallback(async () => {
    if (!pid) return false;
    try {
      const res = await fetch("/api/cavpad/bootstrap?includeContent=1", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as CavPadBootstrapResponse | null;
      if (!res.ok || !payload?.ok) return false;

      const nextNotes = Array.isArray(payload.notes)
        ? payload.notes.map((row) => mapApiNoteToDoc(pid, row))
        : [];
      const nextTrash = Array.isArray(payload.trash)
        ? payload.trash.map((row) => mapApiTrashToDoc(pid, row))
        : [];
      const nextFolders = Array.isArray(payload.directories)
        ? payload.directories.map((row) => mapApiDirectoryToFolder(pid, row))
        : [];

      setNotes(nextNotes);
      saveNotesLocal(pid, nextNotes);
      setTrash(nextTrash);
      saveTrashLocal(pid, nextTrash);
      setFolders(nextFolders);
      saveFoldersLocal(pid, nextFolders);
      return true;
    } catch {
      return false;
    }
  }, [pid, setFolders, setNotes, setTrash]);

  function setPinnedForNotes(noteIds: string[], shouldPin: boolean) {
    if (!pid || !noteIds.length) return;
    const selected = new Set(noteIds);
    const snapshotBeforePin = notes;
    const pinStamp = timeNow();
    const pinAtISO = shouldPin ? new Date(pinStamp).toISOString() : null;

    // Render immediately, then sync in background.
    applyPinnedForNotesLocal(noteIds, shouldPin, pinStamp);
    onToast(shouldPin ? "Pinned in Notes." : "Unpinned in Notes.", "good");

    window.setTimeout(() => {
      const changedPersistedIds: string[] = [];
      const rollbackSnapshot = new Map<string, number | undefined>();
      snapshotBeforePin.forEach((row) => {
        if (row.projectId !== pid || !selected.has(row.id) || row.pendingCreate) return;
        const isPinned = typeof row.pinnedAt === "number" && row.pinnedAt > 0;
        const shouldChange = shouldPin ? !isPinned : isPinned;
        if (!shouldChange) return;
        changedPersistedIds.push(row.id);
        rollbackSnapshot.set(row.id, row.pinnedAt);
      });

      if (!changedPersistedIds.length) return;

      void Promise.allSettled(
        changedPersistedIds.map(async (id) => {
          const res = await fetch(`/api/cavpad/notes/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pinnedAtISO: pinAtISO }),
          });
          const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
          if (!res.ok || !json?.ok) throw new Error("pin sync failed");
          return id;
        })
      ).then((results) => {
        const failedIds = results
          .map((row, index) => (row.status === "rejected" ? changedPersistedIds[index] : ""))
          .filter(Boolean);
        if (failedIds.length) {
          const failedSnapshot = new Map<string, number | undefined>();
          failedIds.forEach((id) => {
            failedSnapshot.set(id, rollbackSnapshot.get(id));
          });
          restorePinnedForNotesLocal(failedSnapshot);
          onToast(
            `${shouldPin ? "Pin" : "Unpin"} sync failed for ${failedIds.length} note${failedIds.length === 1 ? "" : "s"}.`,
            "watch"
          );
        }
      });
    }, 0);
  }

  function setPinnedForDirectories(directoryIds: string[], shouldPin: boolean) {
    if (!pid || !directoryIds.length) return;
    const selected = new Set(directoryIds);
    const snapshotBeforePin = folders;
    const pinStamp = timeNow();
    const pinAtISO = shouldPin ? new Date(pinStamp).toISOString() : null;

    // Render immediately, then sync in background.
    applyPinnedForDirectoriesLocal(directoryIds, shouldPin, pinStamp);
    onToast(shouldPin ? "Pinned in Directories." : "Unpinned in Directories.", "good");

    window.setTimeout(() => {
      const changedPersistedIds: string[] = [];
      const rollbackSnapshot = new Map<string, number | undefined>();
      snapshotBeforePin.forEach((row) => {
        if (row.projectId !== pid || !selected.has(row.id) || row.pendingCreate) return;
        const isPinned = typeof row.pinnedAt === "number" && row.pinnedAt > 0;
        const shouldChange = shouldPin ? !isPinned : isPinned;
        if (!shouldChange) return;
        changedPersistedIds.push(row.id);
        rollbackSnapshot.set(row.id, row.pinnedAt);
      });

      if (!changedPersistedIds.length) return;

      void Promise.allSettled(
        changedPersistedIds.map(async (id) => {
          const res = await fetch(`/api/cavpad/directories/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pinnedAtISO: pinAtISO }),
          });
          const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
          if (!res.ok || !json?.ok) throw new Error("pin sync failed");
          return id;
        })
      ).then((results) => {
        const failedIds = results
          .map((row, index) => (row.status === "rejected" ? changedPersistedIds[index] : ""))
          .filter(Boolean);
        if (failedIds.length) {
          const failedSnapshot = new Map<string, number | undefined>();
          failedIds.forEach((id) => {
            failedSnapshot.set(id, rollbackSnapshot.get(id));
          });
          restorePinnedForDirectoriesLocal(failedSnapshot);
          onToast(
            `${shouldPin ? "Pin" : "Unpin"} sync failed for ${failedIds.length} ${failedIds.length === 1 ? "directory" : "directories"}.`,
            "watch"
          );
        }
      });
    }, 0);
  }

  function toggleSelectedLibraryPin() {
    setLibraryActionsMenuOpen(false);
    if (!selectedLibraryNoteIds.length) return;
    setPinnedForNotes(selectedLibraryNoteIds, !allSelectedLibraryPinned);
  }

  function toggleSelectedDirectoryPin() {
    setDirectoryActionsMenuOpen(false);
    if (!selectedDirectoryIds.length) return;
    setPinnedForDirectories(selectedDirectoryIds, !allSelectedDirectoriesPinned);
  }

  function toggleSelectedDirectoryNotePin() {
    setDirectoryActionsMenuOpen(false);
    if (!selectedDirectoryNoteIds.length) return;
    setPinnedForNotes(selectedDirectoryNoteIds, !allSelectedDirectoryNotesPinned);
  }

  function deleteSelectedLibraryNotes() {
    if (!selectedLibraryNoteIds.length) return;
    if (selectedLibraryNoteIds.length === 1) {
      const targetId = selectedLibraryNoteIds[0];
      setSelectedLibraryNoteIds([]);
      deleteNote(targetId);
      return;
    }
    const ids = [...selectedLibraryNoteIds];
    openActionConfirm(
      {
        title: `Move ${ids.length} notes to Recently deleted?`,
        message: "Selected notes stay in Recently deleted for 30 days before permanent deletion.",
        confirmLabel: "Move to Recently deleted",
        confirmTone: "danger",
      },
      () => {
        setSelectedLibraryNoteIds([]);
        ids.forEach((id) => deleteNote(id));
      }
    );
  }

  function deleteSelectedDirectoryNotes() {
    if (!selectedDirectoryNoteIds.length) return;
    if (selectedDirectoryNoteIds.length === 1) {
      const targetId = selectedDirectoryNoteIds[0];
      setSelectedDirectoryNoteIds([]);
      deleteNote(targetId);
      return;
    }
    const ids = [...selectedDirectoryNoteIds];
    openActionConfirm(
      {
        title: `Move ${ids.length} files to Recently deleted?`,
        message: "Selected files stay in Recently deleted for 30 days before permanent deletion.",
        confirmLabel: "Move to Recently deleted",
        confirmTone: "danger",
      },
      () => {
        setSelectedDirectoryNoteIds([]);
        ids.forEach((id) => deleteNote(id));
      }
    );
  }

  function exportNoteById(noteId: string, target: "cavcloud" | "cavsafe") {
    if (target === "cavcloud" && !settings.syncToCavcloud) {
      onToast("Enable Sync to CavCloud in CavPad settings first.", "watch");
      return;
    }
    if (target === "cavsafe" && !cavsafeEnabled) {
      onToast("CavSafe is locked on Free tier.", "watch");
      return;
    }
    if (target === "cavsafe" && !settings.syncToCavsafe) {
      onToast("Enable Sync to CavSafe in CavPad settings first.", "watch");
      return;
    }
    void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!json?.ok) throw new Error("export failed");
        onToast(target === "cavsafe" ? "Exported to CavSafe." : "Exported to CavCloud.", "good");
      })
      .catch(() => {
        onToast("Export failed.", "bad");
      });
  }

  function exportSelectedLibraryNote(target: "cavcloud" | "cavsafe") {
    if (selectedLibraryNoteIds.length !== 1) return;
    exportNoteById(selectedLibraryNoteIds[0], target);
  }

  function exportSelectedDirectoryNote(target: "cavcloud" | "cavsafe") {
    if (selectedDirectoryNoteIds.length !== 1) return;
    exportNoteById(selectedDirectoryNoteIds[0], target);
  }

  function restoreDetailsVersion(versionId: string) {
    const noteId = detailsNoteId || "";
    if (!noteId || !versionId) return;
    setDetailsVersionsBusy(true);
    void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}/versions/${encodeURIComponent(versionId)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
        if (!json?.ok || !json.note) throw new Error("restore failed");
        const remote = mapApiNoteToDoc(pid, json.note);
        setNotes((prev) => {
          const next = prev.map((row) => (row.id === remote.id ? { ...row, ...remote } : row));
          saveNotesLocal(pid, next);
          return next;
        });
        const versionsRes = await fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}/versions?limit=60`, {
          method: "GET",
          cache: "no-store",
        });
        const versionsJson = (await versionsRes.json().catch(() => null)) as
          | { ok?: boolean; versions?: CavPadVersionRow[] }
          | null;
        if (versionsJson?.ok && Array.isArray(versionsJson.versions)) {
          setDetailsVersions(versionsJson.versions);
          setDetailsVersionQuery("");
        }
        onToast("Version restored.", "good");
      })
      .catch(() => {
        onToast("Version restore failed.", "bad");
      })
      .finally(() => {
        setDetailsVersionsBusy(false);
      });
  }

  function renameSelectedDirectory() {
    if (selectedDirectoryIds.length !== 1) return;
    renameFolder(selectedDirectoryIds[0]);
  }

  function confirmMergeDirectoryModal() {
    if (!pid) return;
    const directoryId = String(mergeDirectoryModalDirectoryId || "").trim();
    if (!directoryId) {
      closeMergeDirectoryModal();
      return;
    }
    if (!mergeDirectoryModalTargetId) {
      onToast("Select a destination folder first.", "watch");
      return;
    }

    const nextParentId = mergeDirectoryModalTargetId === "root" ? null : mergeDirectoryModalTargetId;

    void fetch(`/api/cavpad/directories/${encodeURIComponent(directoryId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: nextParentId }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; directories?: CavPadApiDirectory[]; message?: string }
          | null;
        if (!res.ok || !json?.ok || !Array.isArray(json.directories)) {
          const msg = String(json?.message || "").trim();
          throw new Error(msg || "merge directory failed");
        }
        const remote = json.directories.map((row) => mapApiDirectoryToFolder(pid, row));
        setFolders(remote);
        saveFoldersLocal(pid, remote);
        closeMergeDirectoryModal();
        onToast("Folder merged.", "good");
      })
      .catch(() => {
        onToast("Merge failed. Choose another destination folder.", "watch");
      });
  }

  function deleteSelectedDirectories() {
    if (!pid || !selectedDirectoryIds.length) return;
    const selectedSet = new Set(selectedDirectoryIds);
    const targets = folders.filter((folder) => selectedSet.has(folder.id));
    if (!targets.length) return;

    if (targets.length === 1) {
      setSelectedDirectoryIds([]);
      deleteFolder(targets[0].id);
      return;
    }
    openActionConfirm(
      {
        title: `Delete ${targets.length} directories?`,
        message: 'Notes inside are not deleted. They are moved to "All directories".',
        confirmLabel: "Delete directories",
        confirmTone: "danger",
      },
      () => {
        setSelectedDirectoryIds([]);
        setSelectedDirectoryNoteIds([]);
        setDirectoryActionsMenuOpen(false);
        if (activeFolderId !== "all" && selectedSet.has(activeFolderId)) {
          setActiveFolderId("all");
        }

        void Promise.allSettled(
          targets.map(async (targetRow) => {
            const res = await fetch(`/api/cavpad/directories/${encodeURIComponent(targetRow.id)}`, {
              method: "DELETE",
              keepalive: true,
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
            if (!res.ok || !json?.ok) {
              throw new Error("DIRECTORY_DELETE_FAILED");
            }
          })
        ).then(async (results) => {
          const failed = results.filter((row) => row.status === "rejected");
          await refreshCavPadFromServer();
          if (failed.length > 0) {
            onToast(`Deleted ${targets.length - failed.length} of ${targets.length} directories.`, "watch");
            return;
          }
          onToast(targets.length === 1 ? "Directory deleted." : `${targets.length} directories deleted.`, "watch");
        });
      }
    );
  }

  function restoreSelectedTrash() {
    if (!pid || !selectedTrashIds.length) return;
    const selectedSet = new Set(selectedTrashIds);
    const targets = trash.filter((item) => selectedSet.has(item.id));
    if (!targets.length) return;

    if (targets.length === 1) {
      setSelectedTrashIds([]);
      restoreNote(targets[0].id);
      return;
    }

    const nextTrash = trash.filter((item) => !selectedSet.has(item.id));
    setTrash(nextTrash);
    saveTrashLocal(pid, nextTrash);

    const now = timeNow();
    const restoredDocs: CavPadNoteDoc[] = targets.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      scope: "workspace",
      siteId: item.siteId,
      folderId: item.folderId,
      pinnedAt: item.pinnedAt,
      title: item.title,
      html: item.html,
      createdAt: item.createdAt,
      updatedAt: now,
    }));

    const nextNotes = [...restoredDocs, ...notes];
    setNotes(nextNotes);
    saveNotesLocal(pid, nextNotes);
    if (restoredDocs[0]?.id) setActiveNoteId(restoredDocs[0].id);

    const remoteTargets = targets.filter((item) => !item.pendingCreate);
    if (remoteTargets.length) {
      void Promise.allSettled(
        remoteTargets.map((item) =>
          fetch(`/api/cavpad/notes/${encodeURIComponent(item.id)}/restore`, {
            method: "POST",
            keepalive: true,
          }).then(async (res) => {
            const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
            if (!res.ok || !json?.ok || !json.note) throw new Error("restore failed");
            return mapApiNoteToDoc(pid, json.note);
          })
        )
      ).then((results) => {
        const syncedNotes = results
          .filter((row): row is PromiseFulfilledResult<CavPadNoteDoc> => row.status === "fulfilled")
          .map((row) => row.value);
        if (syncedNotes.length) {
          setNotes((prev) => {
            let next = [...prev];
            syncedNotes.forEach((doc) => {
              const local = next.find((row) => row.id === doc.id);
              const merged = local?.pinnedAt ? { ...doc, pinnedAt: local.pinnedAt } : doc;
              next = [merged, ...next.filter((row) => row.id !== doc.id)];
            });
            saveNotesLocal(pid, next);
            return next;
          });
        }
        const failed = results.filter((row) => row.status === "rejected").length;
        if (failed > 0) {
          onToast(`Restored locally, but ${failed} trash update failed.`, "watch");
        }
      });
    }

    setSelectedTrashIds([]);
    setTrashActionsMenuOpen(false);
    onToast(targets.length === 1 ? "Note restored." : `${targets.length} notes restored.`, "good");
  }

  function purgeSelectedTrash() {
    if (!pid || !selectedTrashIds.length) return;
    const selectedSet = new Set(selectedTrashIds);
    const targets = trash.filter((item) => selectedSet.has(item.id));
    if (!targets.length) return;
    openActionConfirm(
      {
        title: targets.length === 1 ? "Delete this note permanently?" : `Delete ${targets.length} notes permanently?`,
        message: "This action cannot be undone.",
        confirmLabel: "Delete permanently",
        confirmTone: "danger",
      },
      () => {
        if (targets.length === 1) {
          setSelectedTrashIds([]);
          purgeNote(targets[0].id);
          return;
        }

        const nextTrash = trash.filter((item) => !selectedSet.has(item.id));
        setTrash(nextTrash);
        saveTrashLocal(pid, nextTrash);

        const remoteTargets = targets.filter((item) => !item.pendingCreate);
        if (remoteTargets.length) {
          void Promise.allSettled(
            remoteTargets.map((item) =>
              fetch(`/api/cavpad/notes/${encodeURIComponent(item.id)}/purge`, {
                method: "DELETE",
                keepalive: true,
              }).then(async (res) => {
                const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
                if (!res.ok || !json?.ok) throw new Error("purge failed");
              })
            )
          ).then((results) => {
            const failed = results.filter((row) => row.status === "rejected").length;
            if (failed > 0) {
              onToast(`Deleted locally, but ${failed} trash delete failed.`, "watch");
            }
          });
        }

        setSelectedTrashIds([]);
        setTrashActionsMenuOpen(false);
        onToast(targets.length === 1 ? "Note deleted permanently." : `${targets.length} notes deleted permanently.`, "bad");
      }
    );
  }

  function openFolderModal(mode: "create" | "rename", folder?: CavPadNoteFolder) {
    if (!pid) {
      onToast("Select a workspace first.", "watch");
      return;
    }
    setFolderModalMode(mode);
    setFolderModalTargetId(folder?.id ?? null);
    setFolderModalValue(mode === "rename" ? folder?.name || "" : "");
    setFolderModalOpen(true);
  }

  function createFolder() {
    setDirectoryActionsMenuOpen(false);
    openFolderModal("create");
  }

  function openCreateChooser() {
    setCreateChooserOpen(true);
  }

  function closeCreateChooser() {
    setCreateChooserOpen(false);
  }

  function createFromChooser(kind: "note" | "directory") {
    setCreateChooserOpen(false);
    if (kind === "directory") {
      setView("directories");
      createFolder();
      return;
    }
    setView("cavpad");
    createNote();
  }

  function renameFolder(folderId: string) {
    const target = folders.find((x) => x.id === folderId);
    if (!target) return;
    setDirectoryActionsMenuOpen(false);
    openFolderModal("rename", target);
  }

  function closeFolderModal() {
    setFolderModalOpen(false);
    setFolderModalValue("");
    setFolderModalTargetId(null);
  }

  function confirmFolderModal() {
    const name = clampStr((folderModalValue || "").trim(), 28);
    if (!name) return;
    const normalized = name.toLowerCase();
    const createParentId =
      folderModalMode === "create" &&
      view === "directories" &&
      directoryViewFolderId !== CAVPAD_DIRECTORY_ROOT
        ? directoryViewFolderId
        : undefined;
    const renameTarget =
      folderModalMode === "rename"
        ? folders.find((folder) => folder.id === folderModalTargetId) || null
        : null;
    if (folderModalMode === "rename" && !renameTarget) {
      onToast("Directory not found.", "watch");
      closeFolderModal();
      return;
    }
    const duplicateParentId = normalizeDirectoryParentId(
      folderModalMode === "rename" ? renameTarget?.parentId : createParentId
    );
    const duplicate = folders.some(
      (f) =>
        (folderModalMode === "rename" ? f.id !== folderModalTargetId : true) &&
        normalizeDirectoryParentId(f.parentId) === duplicateParentId &&
        f.name.toLowerCase() === normalized
    );
    if (duplicate) {
      onToast("That directory name already exists.", "watch");
      return;
    }

    if (folderModalMode === "create") {
      void fetch("/api/cavpad/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: createParentId || null }),
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as
            | { ok?: boolean; directory?: CavPadApiDirectory }
            | null;
          if (!res.ok || !json?.ok || !json.directory) {
            onToast("Directory create failed.", "watch");
            return;
          }
          const remote = mapApiDirectoryToFolder(pid, json.directory);
          setFolders((prev) => {
            const merged = [remote, ...prev.filter((row) => row.id !== remote.id)];
            saveFoldersLocal(pid, merged);
            return merged;
          });
          if (view === "directories") {
            setSelectedDirectoryIds([remote.id]);
            setSelectedDirectoryNoteIds([]);
          } else {
            setActiveFolderId(remote.id);
          }
          onToast("Directory created.", "good");
        })
        .catch(() => {
          onToast("Directory create failed.", "watch");
        });
    } else if (folderModalTargetId) {
      void fetch(`/api/cavpad/directories/${encodeURIComponent(folderModalTargetId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as
            | { ok?: boolean; directories?: CavPadApiDirectory[] }
            | null;
          if (!res.ok || !json?.ok || !Array.isArray(json.directories)) {
            onToast("Directory rename failed.", "watch");
            return;
          }
          const remote = json.directories.map((row) => mapApiDirectoryToFolder(pid, row));
          setFolders(remote);
          saveFoldersLocal(pid, remote);
          onToast("Directory renamed.", "good");
        })
        .catch(() => {
          onToast("Directory rename failed.", "watch");
        });
    }
    closeFolderModal();
  }

  function deleteFolder(folderId: string) {
    if (!pid) return;
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryNoteIds([]);
    const f = folders.find((x) => x.id === folderId);
    if (!f) return;
    openActionConfirm(
      {
        title: `Delete directory "${f.name}"?`,
        message: 'Notes inside are not deleted. They are moved to "All directories".',
        confirmLabel: "Delete directory",
        confirmTone: "danger",
      },
      () => {
        void fetch(`/api/cavpad/directories/${encodeURIComponent(folderId)}`, {
          method: "DELETE",
          keepalive: true,
        })
          .then(async (res) => {
            const json = (await res.json().catch(() => null)) as
              | { ok?: boolean; directories?: CavPadApiDirectory[] }
              | null;
            if (!res.ok || !json?.ok) {
              onToast("Directory delete failed.", "watch");
              return;
            }

            if (Array.isArray(json.directories)) {
              const remote = json.directories.map((row) => mapApiDirectoryToFolder(pid, row));
              setFolders(remote);
              saveFoldersLocal(pid, remote);
            }
            void refreshCavPadFromServer();
            if (activeFolderId === folderId) setActiveFolderId("all");
            onToast("Directory deleted.", "watch");
          })
          .catch(() => {
            onToast("Directory delete failed.", "watch");
          });
      }
    );
  }

  function openDirectory(folderId: string) {
    const target = folders.find((row) => row.id === folderId);
    if (!target) {
      onToast("Directory not found.", "watch");
      return;
    }
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryIds([]);
    setSelectedDirectoryNoteIds([]);
    setDirectoryViewFolderId(target.id);
    setActiveFolderId(folderId);
    setView("directories");
  }

  function openDirectoryRoot() {
    setDirectoryActionsMenuOpen(false);
    setSelectedDirectoryIds([]);
    setSelectedDirectoryNoteIds([]);
    setDirectoryViewFolderId(CAVPAD_DIRECTORY_ROOT);
    setActiveFolderId("all");
    setView("directories");
  }

  function openDirectoryNote(noteId: string) {
    const target = notes.find((note) => note.id === noteId);
    if (!target) {
      onToast("Note not found.", "watch");
      return;
    }
    setSelectedDirectoryNoteIds([]);
    setSelectedDirectoryIds([]);
    setActiveFolderId(target.folderId || "all");
    setActiveNoteId(noteId);
    setView("cavpad");
  }

  function setNoteFolder(noteId: string, nextFolderId: string) {
    if (!pid) return;
    const target = notes.find((row) => row.id === noteId);
    if (!target) return;

    const normalizedFolderId = String(nextFolderId || "").trim() || "all";
    const folderId = normalizedFolderId === "all" ? undefined : normalizedFolderId;
    if (folderId && !folders.some((folder) => folder.id === folderId)) {
      onToast("Directory not found.", "watch");
      return;
    }
    if ((target.folderId || "all") === (folderId || "all")) return;
    const now = timeNow();

    const next = notes.map((n) =>
      n.id === noteId
        ? {
            ...n,
            folderId,
            updatedAt: now,
            pendingRemoteSync: n.pendingCreate ? n.pendingRemoteSync : true,
          }
        : n
    );
    setNotes(next);

    if (folderId) setActiveFolderId(folderId);
    else setActiveFolderId("all");

    saveNotesLocal(pid, next);
    const updatedNote = next.find((row) => row.id === noteId);
    if (!updatedNote?.pendingCreate) {
      void fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directoryId: folderId || null,
        }),
      }).catch(() => {});
    }
    onToast("Directory updated.", "good");
  }

  const libraryNotes = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = notes.filter((n) => n.projectId === pid);
    const filtered = q
      ? base.filter((n) => (n.title || "").toLowerCase().includes(q) || (n.html || "").toLowerCase().includes(q))
      : base;
    return filtered.sort(comparePinnedRows);
  }, [notes, pid, searchQuery]);

  const visibleNotes = libraryNotes;

  const folderNoteCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    notes.forEach((note) => {
      if (note.projectId !== pid || !note.folderId) return;
      counts.set(note.folderId, (counts.get(note.folderId) || 0) + 1);
    });
    return counts;
  }, [notes, pid]);

  const projectFolders = React.useMemo(
    () => folders.filter((folder) => folder.projectId === pid),
    [folders, pid]
  );

  const projectFoldersById = React.useMemo(
    () => new Map(projectFolders.map((folder) => [folder.id, folder])),
    [projectFolders]
  );

  const folderChildCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    projectFolders.forEach((folder) => {
      const parentKey = String(folder.parentId || "").trim();
      if (!parentKey) return;
      counts.set(parentKey, (counts.get(parentKey) || 0) + 1);
    });
    return counts;
  }, [projectFolders]);

  const normalizedDirectoryViewFolderId = React.useMemo(() => {
    if (directoryViewFolderId === CAVPAD_DIRECTORY_ROOT) return CAVPAD_DIRECTORY_ROOT;
    if (!projectFoldersById.has(directoryViewFolderId)) return CAVPAD_DIRECTORY_ROOT;
    return directoryViewFolderId;
  }, [directoryViewFolderId, projectFoldersById]);

  const directoryBreadcrumbs = React.useMemo(() => {
    if (normalizedDirectoryViewFolderId === CAVPAD_DIRECTORY_ROOT) return [] as { id: string; label: string }[];

    const chain: { id: string; label: string }[] = [];
    let cursor = normalizedDirectoryViewFolderId;
    let guard = 0;
    while (cursor && cursor !== CAVPAD_DIRECTORY_ROOT && guard < 220) {
      const row = projectFoldersById.get(cursor);
      if (!row) break;
      chain.push({ id: row.id, label: row.name || "Directory" });
      cursor = normalizeDirectoryParentId(row.parentId);
      guard += 1;
    }

    return chain.reverse();
  }, [normalizedDirectoryViewFolderId, projectFoldersById]);

  const directoryVisibleFolders = React.useMemo(() => {
    const rows = projectFolders.filter(
      (folder) => normalizeDirectoryParentId(folder.parentId) === normalizedDirectoryViewFolderId
    );
    return rows
      .slice()
      .sort((a, b) => {
        const pinCompare = comparePinnedRows(a, b);
        if (pinCompare !== 0) return pinCompare;
        return a.name.localeCompare(b.name);
      });
  }, [normalizedDirectoryViewFolderId, projectFolders]);

  const directoryVisibleNotes = React.useMemo(() => {
    const rows = notes.filter(
      (note) =>
        note.projectId === pid &&
        normalizeDirectoryParentId(note.folderId) === normalizedDirectoryViewFolderId
    );
    return rows
      .slice()
      .sort((a, b) => {
        const pinCompare = comparePinnedRows(a, b);
        if (pinCompare !== 0) return pinCompare;
        return String(a.title || "Untitled").localeCompare(String(b.title || "Untitled"));
      });
  }, [normalizedDirectoryViewFolderId, notes, pid]);
  const directoryScopedFolders = React.useMemo(
    () => (directorySection === "files" ? [] : directoryVisibleFolders),
    [directorySection, directoryVisibleFolders]
  );
  const directoryScopedNotes = React.useMemo(
    () => (directorySection === "folders" ? [] : directoryVisibleNotes),
    [directorySection, directoryVisibleNotes]
  );
  const directoryCurrentLabel = React.useMemo(() => {
    if (normalizedDirectoryViewFolderId === CAVPAD_DIRECTORY_ROOT) return "CavPad";
    return projectFoldersById.get(normalizedDirectoryViewFolderId)?.name || "CavPad";
  }, [normalizedDirectoryViewFolderId, projectFoldersById]);
  const directoryCountsLabel = React.useMemo(() => {
    const folderCount = directoryVisibleFolders.length;
    const fileCount = directoryVisibleNotes.length;
    return `${folderCount} folder${folderCount === 1 ? "" : "s"} • ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  }, [directoryVisibleFolders.length, directoryVisibleNotes.length]);

  const directoryPathById = React.useMemo(() => {
    const byId = new Map(projectFolders.map((folder) => [folder.id, folder]));
    const cache = new Map<string, string>();

    const buildPath = (folderId: string, trail = new Set<string>()): string => {
      const cached = cache.get(folderId);
      if (cached) return cached;
      const folder = byId.get(folderId);
      if (!folder) return "";
      if (trail.has(folderId)) return folder.name;
      trail.add(folderId);
      const parentId = String(folder.parentId || "").trim();
      const parentPath = parentId ? buildPath(parentId, trail) : "";
      trail.delete(folderId);
      const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
      cache.set(folderId, path);
      return path;
    };

    projectFolders.forEach((folder) => {
      buildPath(folder.id);
    });
    return cache;
  }, [projectFolders]);

  const globalSearchResults = React.useMemo(() => {
    const query = globalSearchQuery.trim().toLowerCase();
    if (!query) return [] as CavPadSearchResult[];

    const matches = (text: string) => String(text || "").toLowerCase().includes(query);
    const results: CavPadSearchResult[] = [];

    const projectNotes = notes.filter((note) => note.projectId === pid);
    projectNotes.forEach((note) => {
      const title = String(note.title || "Untitled");
      const body = htmlToPlainText(note.html || "");
      const folderLabel = note.folderId ? directoryPathById.get(note.folderId) || "All notes" : "All notes";
      if (!matches(title) && !matches(body) && !matches(folderLabel)) return;
      results.push({
        key: `note:${note.id}`,
        kind: "note",
        label: title,
        sublabel: `File · ${folderLabel}`,
        rank: matches(title) ? 0 : 1,
        updatedAt: note.updatedAt,
        noteId: note.id,
      });
    });

    projectFolders.forEach((folder) => {
      if (!matches(folder.name)) return;
      const count = folderNoteCounts.get(folder.id) || 0;
      results.push({
        key: `directory:${folder.id}`,
        kind: "directory",
        label: folder.name,
        sublabel: `Directory · ${count} note${count === 1 ? "" : "s"}`,
        rank: 2,
        updatedAt: folder.updatedAt,
        directoryId: folder.id,
      });
    });

    const projectTrash = trash.filter((row) => row.projectId === pid);
    projectTrash.forEach((row) => {
      const title = String(row.title || "Untitled");
      if (!matches(title) && !matches(htmlToPlainText(row.html || ""))) return;
      results.push({
        key: `trash:${row.id}`,
        kind: "trash",
        label: title,
        sublabel: "Recently deleted file",
        rank: 3,
        updatedAt: row.updatedAt,
        trashId: row.id,
      });
    });

    CAVPAD_VIEW_SEARCH_INDEX.forEach((row) => {
      const haystack = [row.label, ...row.keywords].join(" ").toLowerCase();
      if (!haystack.includes(query)) return;
      results.push({
        key: `view:${row.view}`,
        kind: "view",
        label: row.label,
        sublabel: "View",
        rank: 4,
        view: row.view,
      });
    });

    CAVPAD_SETTING_SEARCH_INDEX.forEach((row, idx) => {
      const haystack = [row.label, ...row.keywords].join(" ").toLowerCase();
      if (!haystack.includes(query)) return;
      results.push({
        key: `setting:${idx}`,
        kind: "setting",
        label: row.label,
        sublabel: "Setting",
        rank: 5,
      });
    });

    return results
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        const aTime = a.updatedAt || 0;
        const bTime = b.updatedAt || 0;
        if (aTime !== bTime) return bTime - aTime;
        return a.label.localeCompare(b.label);
      })
      .slice(0, 24);
  }, [directoryPathById, folderNoteCounts, globalSearchQuery, notes, pid, projectFolders, trash]);

  const openCavPadSettings = React.useCallback(() => {
    if (memberRole === "OWNER") {
      setView("settings");
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent("cb:cavguard:decision", {
        detail: {
          decision: buildCavGuardDecision("SETTINGS_OWNER_ONLY", {
            role: memberRole || "ANON",
            flags: { settingsSurface: "CavPad" },
          }),
        },
      }));
    } catch {}
  }, [memberRole]);

  function openSearchResult(result: CavPadSearchResult) {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
    setViewMenuOpen(false);
    setLibraryActionsMenuOpen(false);
    setDirectoryActionsMenuOpen(false);
    setTrashActionsMenuOpen(false);

    if (result.kind === "note" && result.noteId) {
      const match = notes.find((row) => row.id === result.noteId);
      setActiveFolderId(match?.folderId || "all");
      setActiveNoteId(result.noteId);
      setView("cavpad");
      return;
    }

    if (result.kind === "directory" && result.directoryId) {
      setSelectedDirectoryIds([]);
      setSelectedDirectoryNoteIds([]);
      setDirectoryViewFolderId(result.directoryId);
      setView("directories");
      return;
    }

    if (result.kind === "trash" && result.trashId) {
      setSelectedTrashIds([result.trashId]);
      setView("trash");
      return;
    }

    if (result.kind === "view" && result.view) {
      if (result.view === "settings") {
        openCavPadSettings();
      } else {
        setView(result.view);
      }
      return;
    }

    openCavPadSettings();
  }

  const activeDoc = React.useMemo(
    () => visibleNotes.find((n) => n.id === activeNoteId) || visibleNotes[0] || null,
    [visibleNotes, activeNoteId]
  );
  const [draftTitle, setDraftTitle] = React.useState("");
  const [isPhoneTitleEditing, setIsPhoneTitleEditing] = React.useState(false);
  const phoneTitleInputRef = React.useRef<HTMLInputElement | null>(null);
  const skipPhoneTitleCommitRef = React.useRef(false);
  const activeDocId = activeDoc?.id ?? "";
  const activeDocTitle = activeDoc?.title ?? "";
  const activeDocHtml = activeDoc?.html ?? "";
  const phoneHeaderTitle = React.useMemo(
    () => clampStr(String(draftTitle || activeDocTitle || "").trim(), 80) || "Untitled",
    [activeDocTitle, draftTitle]
  );
  const cavAiSite = React.useMemo(() => {
    const siteId = String(activeDoc?.siteId || originSiteId || "").trim();
    if (!siteId) return null;
    return sites.find((row) => String(row.id || "").trim() === siteId) || null;
  }, [activeDoc?.siteId, originSiteId, sites]);
  const cavAiContextLabel = React.useMemo(() => {
    const title = clampStr(draftTitle || activeDocTitle || "", 80).trim() || "Untitled";
    const siteLabel = String(cavAiSite?.label || "").trim();
    return siteLabel ? `CavPad note · ${title} · ${siteLabel}` : `CavPad note · ${title}`;
  }, [activeDocTitle, cavAiSite?.label, draftTitle]);
  const cavAiOrigin = String(cavAiSite?.origin || "").trim() || null;
  const cavAiPlanTier: CavPadPlanTier = planTier === "PREMIUM" || planTier === "PREMIUM_PLUS" ? planTier : "FREE";
  React.useEffect(() => {
    setCavAiLiveModelOptions([]);
    const ctrl = new AbortController();
    void fetch("/api/ai/test?catalog=context&surface=cavpad&action=write_note", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          modelCatalog?: {
            text?: unknown[];
          };
        };
        if (!res.ok || body.ok !== true) return;
        const options = normalizeCavPadModelOptions(body.modelCatalog?.text);
        setCavAiLiveModelOptions(options);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [cavAiPlanTier]);
  const cavAiModelOptions = React.useMemo(() => {
    if (cavAiLiveModelOptions.length) return cavAiLiveModelOptions;
    const modelIds =
      cavAiPlanTier === "PREMIUM_PLUS"
        ? [
            DEEPSEEK_CHAT_MODEL_ID,
            ALIBABA_QWEN_FLASH_MODEL_ID,
            DEEPSEEK_REASONER_MODEL_ID,
            ALIBABA_QWEN_PLUS_MODEL_ID,
            ALIBABA_QWEN_MAX_MODEL_ID,
            ALIBABA_QWEN_CHARACTER_MODEL_ID,
          ]
        : cavAiPlanTier === "PREMIUM"
          ? [
              DEEPSEEK_CHAT_MODEL_ID,
              ALIBABA_QWEN_FLASH_MODEL_ID,
              DEEPSEEK_REASONER_MODEL_ID,
              ALIBABA_QWEN_PLUS_MODEL_ID,
              ALIBABA_QWEN_CHARACTER_MODEL_ID,
            ]
          : [DEEPSEEK_CHAT_MODEL_ID, ALIBABA_QWEN_FLASH_MODEL_ID, ALIBABA_QWEN_CHARACTER_MODEL_ID];
    return modelIds.map((id) => ({
      id,
      label: resolveAiModelLabel(id) || id,
    }));
  }, [cavAiLiveModelOptions, cavAiPlanTier]);
  const cavAiReasoningOptions = React.useMemo(
    () =>
      cavAiPlanTier === "PREMIUM_PLUS"
        ? CAVPAD_REASONING_LEVEL_OPTIONS
        : cavAiPlanTier === "PREMIUM"
          ? CAVPAD_REASONING_LEVEL_OPTIONS.filter((option) => option.value !== "extra_high")
          : CAVPAD_REASONING_LEVEL_OPTIONS.filter(
            (option) => option.value === "low" || option.value === "medium"
          ),
    [cavAiPlanTier]
  );
  const cavAiModelLabel = React.useMemo(
    () => cavAiModelOptions.find((row) => row.id === cavAiModelId)?.label || resolveAiModelLabel(cavAiModelId) || "Model",
    [cavAiModelId, cavAiModelOptions]
  );
  const cavAiReasoningLabel = React.useMemo(
    () => cavAiReasoningOptions.find((row) => row.value === cavAiReasoningLevel)?.label || toReasoningDisplayLabel(cavAiReasoningLevel),
    [cavAiReasoningLevel, cavAiReasoningOptions]
  );
  const projectNotes = React.useMemo(() => notes.filter((row) => row.projectId === pid), [notes, pid]);
  const cavAiWorkspaceBrief = React.useMemo(() => {
    const activeFolderName =
      activeFolderId === "all" ? "All notes" : folders.find((folder) => folder.id === activeFolderId)?.name || "Selected folder";
    const pendingSyncCount = projectNotes.filter((row) => row.pendingRemoteSync || row.pendingCreate).length;
    const siteLabel = String(cavAiSite?.label || "").trim() || "No active site selected";
    const siteOrigin = String(cavAiSite?.origin || "").trim();
    return [
      `Project ID: ${pid || "unknown"}`,
      `Member role: ${memberRole || "ANON"}`,
      `Active site: ${siteLabel}${siteOrigin ? ` (${siteOrigin})` : ""}`,
      `Total sites in workspace: ${sites.length}`,
      `Current folder scope: ${activeFolderName}`,
      `Note count: ${projectNotes.length}`,
      `Pending sync notes: ${pendingSyncCount}`,
      `CavSafe enabled: ${cavsafeEnabled ? "yes" : "no"}`,
      `Plan tier: ${cavAiPlanTier}`,
      `Selected model: ${cavAiModelLabel}`,
    ].join("\n");
  }, [
    activeFolderId,
    cavAiModelLabel,
    cavAiPlanTier,
    cavAiSite?.label,
    cavAiSite?.origin,
    cavsafeEnabled,
    folders,
    memberRole,
    pid,
    projectNotes,
    sites.length,
  ]);

  React.useEffect(() => {
    setDraftTitle(activeDocTitle);
  }, [activeDocId, activeDocTitle]);

  React.useEffect(() => {
    if (!isPhoneWriteView) {
      setIsPhoneTitleEditing(false);
      return;
    }
    if (!isPhoneTitleEditing) return;
    window.setTimeout(() => {
      phoneTitleInputRef.current?.focus();
      phoneTitleInputRef.current?.select();
    }, 0);
  }, [isPhoneTitleEditing, isPhoneWriteView, activeDocId]);

  React.useEffect(() => {
    setIsPhoneTitleEditing(false);
  }, [activeDocId, view]);

  React.useEffect(() => {
    if (cavAiModelOptions.some((row) => row.id === cavAiModelId)) return;
    setCavAiModelId(cavAiModelOptions[0]?.id || DEEPSEEK_CHAT_MODEL_ID);
  }, [cavAiModelId, cavAiModelOptions]);

  React.useEffect(() => {
    if (cavAiReasoningOptions.some((row) => row.value === cavAiReasoningLevel)) return;
    setCavAiReasoningLevel("medium");
  }, [cavAiReasoningLevel, cavAiReasoningOptions]);

  React.useEffect(() => {
    if (!activeDocId) return;
    setCavAiDraftMenuOpen(false);
    setCavAiControlMenu(null);
    setCavAiHelpPromptOpen(false);
  }, [activeDocId]);

  React.useEffect(() => {
    if (!activeDocId) return;
    if (activeDocId !== activeNoteId) setActiveNoteId(activeDocId);
  }, [activeDocId, activeNoteId, setActiveNoteId]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as Window & {
      cavai?: {
        enableEyeTracking?: () => void;
        enableHeadTracking?: () => void;
      };
      __cavaiEyeTrackingRefresh?: () => void;
      __cavaiHeadTrackingRefresh?: () => void;
      __cavbotEyeTrackingRefresh?: () => void;
      __cavbotHeadTrackingRefresh?: () => void;
    };
    const refresh = () => {
      w.cavai?.enableEyeTracking?.();
      w.cavai?.enableHeadTracking?.();
      w.__cavaiEyeTrackingRefresh?.();
      w.__cavaiHeadTrackingRefresh?.();
      w.__cavbotEyeTrackingRefresh?.();
      w.__cavbotHeadTrackingRefresh?.();
    };
    refresh();
    const rafId = window.requestAnimationFrame(refresh);
    const timer = window.setTimeout(refresh, 96);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [view, mobileView, editorFullscreen, activeDocId, directoryViewFolderId, badgeTone]);

  React.useEffect(() => {
    if (!activeDocId) return;
    autoCreateNoteIdRef.current = "";
  }, [activeDocId]);

  React.useEffect(() => {
    if (!isNarrow) return;
    if (activeDocId) setMobileView("editor");
  }, [isNarrow, activeDocId]);

  React.useEffect(() => {
    if (!isPhone) return;
    if (view !== "cavpad") return;
    setMobileView("editor");
  }, [isPhone, view]);

  function resetEditorHistoryForNote(noteId: string, html: string) {
    editorHistoryNoteIdRef.current = String(noteId || "");
    editorHistoryLastHtmlRef.current = String(html || "");
    editorHistoryUndoRef.current = [];
    editorHistoryRedoRef.current = [];
  }

  function resolveEditorHistoryNoteId(noteIdRaw?: string) {
    return String(
      noteIdRaw ||
        activeDocId ||
        activeNoteIdRef.current ||
        autoCreateNoteIdRef.current ||
        editorHistoryNoteIdRef.current ||
        ""
    ).trim();
  }

  function syncEditorHistorySnapshot(nextHtmlRaw: string, noteIdRaw?: string) {
    const noteId = resolveEditorHistoryNoteId(noteIdRaw);
    if (!noteId) return;
    const nextHtml = String(nextHtmlRaw || "");

    if (editorHistoryNoteIdRef.current !== noteId) {
      resetEditorHistoryForNote(noteId, nextHtml);
      return;
    }

    const previousHtml = String(editorHistoryLastHtmlRef.current || "");
    if (previousHtml === nextHtml) return;

    editorHistoryUndoRef.current.push(previousHtml);
    if (editorHistoryUndoRef.current.length > CAVPAD_EDITOR_HISTORY_LIMIT) {
      editorHistoryUndoRef.current.splice(0, editorHistoryUndoRef.current.length - CAVPAD_EDITOR_HISTORY_LIMIT);
    }
    editorHistoryRedoRef.current = [];
    editorHistoryLastHtmlRef.current = nextHtml;
  }

  function focusEditorForCommand() {
    try {
      editorRef.current?.focus({ preventScroll: true });
    } catch {
      editorRef.current?.focus();
    }
  }

  function applyEditorHistoryFallback(direction: EditorHistoryDirection): boolean {
    const editor = editorRef.current;
    const noteId = resolveEditorHistoryNoteId();
    if (!editor || !noteId) return false;

    if (editorHistoryNoteIdRef.current !== noteId) {
      resetEditorHistoryForNote(noteId, editor.innerHTML || "");
    }

    const currentHtml = String(editor.innerHTML || "");
    const source =
      direction === "undo" ? editorHistoryUndoRef.current : editorHistoryRedoRef.current;
    if (!source.length) return false;

    const nextHtml = String(source.pop() || "");
    if (direction === "undo") {
      editorHistoryRedoRef.current.push(currentHtml);
    } else {
      editorHistoryUndoRef.current.push(currentHtml);
    }
    editor.innerHTML = nextHtml;
    editorHistoryLastHtmlRef.current = nextHtml;
    setEditorEmpty(isEditorEmpty(nextHtml));
    queueSave(nextHtml);
    window.setTimeout(() => focusEditorForCommand(), 0);
    return true;
  }

  function runEditorHistoryCommand(direction: EditorHistoryDirection) {
    const editor = editorRef.current;
    if (!editor) return;
    if (!editorActive) setEditorActive(true);
    focusEditorForCommand();

    const beforeHtml = String(editor.innerHTML || "");
    let nativeOk = false;
    try {
      nativeOk = document.execCommand(direction, false);
    } catch {
      nativeOk = false;
    }
    const afterHtml = String(editor.innerHTML || "");

    if (nativeOk || afterHtml !== beforeHtml) {
      const noteId = resolveEditorHistoryNoteId();
      if (noteId) {
        if (editorHistoryNoteIdRef.current !== noteId) {
          resetEditorHistoryForNote(noteId, afterHtml);
        } else {
          editorHistoryLastHtmlRef.current = afterHtml;
        }
      }
      setEditorEmpty(isEditorEmpty(afterHtml));
      queueSave(afterHtml);
      return;
    }

    applyEditorHistoryFallback(direction);
  }

  const lastActiveDocId = React.useRef<string>("");
  React.useEffect(() => {
    if (!editorRef.current) return;
    const editorEl = editorRef.current;
    if (!activeDocId) {
      editorEl.innerHTML = "";
      setEditorEmpty(true);
      resetEditorHistoryForNote("", "");
      lastActiveDocId.current = "";
      return;
    }

    if (lastActiveDocId.current === activeDocId) {
      if (document.activeElement === editorEl) {
        const currentHtml = editorEl.innerHTML || "";
        setEditorEmpty(isEditorEmpty(currentHtml));
        if (editorHistoryNoteIdRef.current !== activeDocId) {
          resetEditorHistoryForNote(activeDocId, currentHtml);
        } else {
          editorHistoryLastHtmlRef.current = currentHtml;
        }
        return;
      }
      if (editorEl.innerHTML === activeDocHtml) {
        setEditorEmpty(isEditorEmpty(activeDocHtml));
        if (editorHistoryNoteIdRef.current !== activeDocId) {
          resetEditorHistoryForNote(activeDocId, activeDocHtml);
        } else {
          editorHistoryLastHtmlRef.current = activeDocHtml;
        }
        return;
      }
    }

    editorEl.innerHTML = activeDocHtml;
    setEditorEmpty(isEditorEmpty(activeDocHtml));
    resetEditorHistoryForNote(activeDocId, activeDocHtml);
    lastActiveDocId.current = activeDocId;
    window.setTimeout(() => hydrateAttachments(editorRef.current), 30);
  }, [view, activeDocId, activeDocHtml, hydrateAttachments]);

  function mergeRemoteMetaKeepLocal(local: CavPadNoteDoc, remote: CavPadNoteDoc): CavPadNoteDoc {
    return {
      ...local,
      cavcloudFileId: remote.cavcloudFileId,
      cavcloudPath: remote.cavcloudPath,
      sha256: remote.sha256,
      permission: remote.permission,
      status: remote.status,
      shared: remote.shared,
      collab: remote.collab,
      collaboratorCount: remote.collaboratorCount,
      editorsCount: remote.editorsCount,
      ownerUserId: remote.ownerUserId,
      ownerUsername: remote.ownerUsername,
      ownerDisplayName: remote.ownerDisplayName,
      ownerAvatarUrl: remote.ownerAvatarUrl,
      ownerAvatarTone: remote.ownerAvatarTone,
      ownerEmail: remote.ownerEmail,
      lastChangeAt: remote.lastChangeAt,
      lastChangeUserId: remote.lastChangeUserId,
      lastChangeUsername: remote.lastChangeUsername,
      lastChangeDisplayName: remote.lastChangeDisplayName,
      lastChangeEmail: remote.lastChangeEmail,
      accessList: remote.accessList,
      pendingCreate: false,
      pendingRemoteSync: false,
    };
  }

  const flushRemoteSave = React.useCallback((noteId: string) => {
    const target = notesRef.current.find((row) => row.id === noteId);
    if (!target || target.pendingCreate || !pid) return;

    if (remoteSaveInFlightRef.current) {
      queuedRemoteSaveNoteIdRef.current = noteId;
      return;
    }
    remoteSaveInFlightRef.current = true;

    const finalize = () => {
      remoteSaveInFlightRef.current = false;
      const queuedId = queuedRemoteSaveNoteIdRef.current;
      if (!queuedId) return;
      queuedRemoteSaveNoteIdRef.current = null;
      window.setTimeout(() => flushRemoteSave(queuedId), 120);
    };

    const textContent = htmlToPlainText(target.html);
    void fetch(`/api/cavpad/notes/${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: target.title,
        textContent,
        baseSha256: target.sha256 || null,
        directoryId: target.folderId || null,
        scope: "workspace",
        siteId: target.siteId || null,
      }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote; error?: string } | null;
        if (!json?.ok || !json.note) {
          if (res.status === 404) return;
          if (json?.error === "FILE_EDIT_CONFLICT" || res.status === 409) {
            const latestRes = await fetch(`/api/cavpad/notes/${encodeURIComponent(noteId)}?includeContent=1`, {
              cache: "no-store",
            });
            const latestJson = (await latestRes.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
            if (latestJson?.ok && latestJson.note) {
              const remote = mapApiNoteToDoc(pid, latestJson.note);
              setNotes((prev) => {
                const next = prev.map((row) => {
                  if (row.id !== remote.id) return row;
                  return mergeRemoteMetaKeepLocal(row, remote);
                });
                saveNotesLocal(pid, next);
                return next;
              });
              queuedRemoteSaveNoteIdRef.current = noteId;
            }
          } else if (res.status >= 500) {
            queuedRemoteSaveNoteIdRef.current = noteId;
          }
          return;
        }

        const remote = mapApiNoteToDoc(pid, json.note);
        setNotes((prev) => {
          const next = prev.map((row) => (row.id === remote.id ? mergeRemoteMetaKeepLocal(row, remote) : row));
          saveNotesLocal(pid, next);
          return next;
        });
      })
      .catch(() => {})
      .finally(finalize);
  }, [pid, setNotes]);

  function queueSave(nextHtml?: string, nextTitle?: string, noteIdOverride?: string) {
    if (!pid) return;
    const noteId = noteIdOverride || activeDocId || activeNoteIdRef.current;
    if (!noteId) return;

    const now = timeNow();
    setNotes((prev) => {
      const target = prev.find((n) => n.id === noteId);
      if (!target) return prev;
      const maxOtherUpdatedAt = prev.reduce((max, n) => {
        if (n.projectId !== pid || n.id === noteId) return max;
        return Math.max(max, n.updatedAt || 0);
      }, 0);
      const nextUpdatedAt = Math.max(now, maxOtherUpdatedAt + 1);
      const html = typeof nextHtml === "string" ? nextHtml : target.html;
      const title = typeof nextTitle === "string"
        ? String(nextTitle).slice(0, 80)
        : String(target.title || "").slice(0, 80);
      const updated: CavPadNoteDoc = {
        ...target,
        html,
        title,
        updatedAt: nextUpdatedAt,
        pendingRemoteSync: target.pendingCreate ? target.pendingRemoteSync : true,
      };
      const next = [updated, ...prev.filter((n) => n.id !== noteId)];
      saveNotesLocal(pid, next);
      return next;
    });

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => flushRemoteSave(noteId), 220);
  }

  function createNote(initialTitle?: string, initialHtml?: string) {
    if (!pid) {
      onToast("Select a workspace first.", "watch");
      return null;
    }
    const requestedTitle = clampStr(String(initialTitle || "").trim(), 80);
    const noteTitle = requestedTitle || "Untitled";
    const seededHtml = typeof initialHtml === "string" ? initialHtml : "<p></p>";

    const now = timeNow();
    const optimisticDoc: CavPadNoteDoc = {
      id: uid("note"),
      projectId: pid,
      scope: "workspace",
      siteId: originSiteId || undefined,
      folderId: activeFolderId === "all" ? undefined : activeFolderId,
      title: noteTitle,
      html: seededHtml,
      createdAt: now,
      updatedAt: now,
      pendingCreate: true,
    };

    // Render instantly, then reconcile with server id/content in the background.
    setNotes((prev) => {
      const next = [optimisticDoc, ...prev.filter((row) => row.id !== optimisticDoc.id)];
      saveNotesLocal(pid, next);
      return next;
    });
    setActiveNoteId(optimisticDoc.id);
    window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
    onToast("New note created.", "good");

    syncPendingCreateNote(optimisticDoc.id);
    return optimisticDoc.id;
  }

  const syncPendingCreateNote = React.useCallback((localNoteId: string) => {
    if (!pid) return;
    if (pendingCreateSyncInFlightRef.current.has(localNoteId)) return;
    if (deletedPendingCreateIdsRef.current.has(localNoteId)) return;

    const localSnapshot = notesRef.current.find((row) => row.id === localNoteId);
    if (!localSnapshot || !localSnapshot.pendingCreate) return;

    pendingCreateSyncInFlightRef.current.add(localNoteId);
    void (async () => {
      try {
        const localTitle = clampStr(localSnapshot.title || "Untitled", 80) || "Untitled";
        const localHtml = localSnapshot.html || "<p></p>";
        const res = await fetch("/api/cavpad/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            noteId: localNoteId,
            title: localTitle,
            textContent: htmlToPlainText(localHtml),
            scope: "workspace",
            siteId: localSnapshot.siteId || originSiteId || null,
            directoryId: localSnapshot.folderId || null,
            pinnedAtISO: localSnapshot.pinnedAt ? new Date(localSnapshot.pinnedAt).toISOString() : null,
          }),
        });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
        if (!json?.ok || !json.note) throw new Error("create failed");

        const remote = mapApiNoteToDoc(pid, json.note);
        let localMissing = false;
        const deletedDuringCreate = deletedPendingCreateIdsRef.current.has(localNoteId);
        let needsRemotePatch = false;
        let remoteIdForPatch = remote.id;
        setNotes((prev) => {
          const local = prev.find((row) => row.id === localNoteId);
          if (!local) {
            localMissing = true;
            return prev;
          }
          const merged: CavPadNoteDoc = {
            ...mergeRemoteMetaKeepLocal(local, remote),
            title: clampStr(local.title || remote.title || "Untitled", 80) || "Untitled",
            html: local.html || remote.html,
            createdAt: local.createdAt || remote.createdAt,
            updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
            folderId: local.folderId ?? remote.folderId,
            siteId: local.siteId ?? remote.siteId,
            pendingRemoteSync: Boolean(local.pendingRemoteSync),
          };
          remoteIdForPatch = merged.id;
          const localText = htmlToPlainText(merged.html || "");
          const remoteText = htmlToPlainText(remote.html || "");
          if (
            merged.pendingRemoteSync ||
            merged.title !== (remote.title || "Untitled") ||
            localText !== remoteText ||
            (merged.folderId || "") !== (remote.folderId || "")
          ) {
            needsRemotePatch = true;
          }
          const next = [merged, ...prev.filter((row) => row.id !== localNoteId && row.id !== remote.id)];
          saveNotesLocal(pid, next);
          return next;
        });

        if (localMissing || deletedDuringCreate) {
          setNotes((prev) => {
            const next = prev.filter((row) => row.id !== localNoteId && row.id !== remote.id);
            saveNotesLocal(pid, next);
            return next;
          });
          setTrash((prev) => {
            const deletedAt = timeNow();
            let matched = false;
            const next = prev.map((row) => {
              if (row.id !== localNoteId && row.id !== remote.id) return row;
              matched = true;
              return {
                ...row,
                ...remote,
                id: remote.id,
                deletedAt: row.deletedAt || deletedAt,
                pendingCreate: false,
                pendingRemoteSync: true,
              };
            });
            if (!matched) {
              next.unshift({
                ...remote,
                deletedAt,
                pendingCreate: false,
                pendingRemoteSync: true,
              });
            }
            saveTrashLocal(pid, next);
            return next;
          });
          deletedPendingCreateIdsRef.current.delete(localNoteId);
          window.setTimeout(() => syncPendingTrashMove(remote.id), 0);
          return;
        }
        deletedPendingCreateIdsRef.current.delete(localNoteId);
        if (activeNoteIdRef.current === localNoteId) {
          setActiveNoteId(remote.id);
        }
        if (autoCreateNoteIdRef.current === localNoteId) {
          autoCreateNoteIdRef.current = remote.id;
        }
        if (needsRemotePatch) {
          window.setTimeout(() => flushRemoteSave(remoteIdForPatch), 0);
        }
      } catch {
        // Keep local note pending; we'll retry on the next reconciliation pass.
      } finally {
        pendingCreateSyncInFlightRef.current.delete(localNoteId);
      }
    })();
  }, [flushRemoteSave, originSiteId, pid, setActiveNoteId, setNotes, setTrash, syncPendingTrashMove]);

  React.useEffect(() => {
    if (!pid) return;
    const pending = notes.filter((row) => row.projectId === pid && row.pendingCreate).map((row) => row.id);
    if (!pending.length) return;
    pending.forEach((noteId) => syncPendingCreateNote(noteId));
  }, [notes, pid, syncPendingCreateNote]);

  React.useEffect(() => {
    if (!pid) return;
    const pendingPatchIds = notes
      .filter((row) => row.projectId === pid && !row.pendingCreate && row.pendingRemoteSync)
      .map((row) => row.id);
    if (!pendingPatchIds.length) return;
    pendingPatchIds.forEach((noteId) => flushRemoteSave(noteId));
  }, [notes, pid, flushRemoteSave]);

  function deleteNote(id: string) {
    if (!pid) return;
    if (queuedRemoteSaveNoteIdRef.current === id) {
      queuedRemoteSaveNoteIdRef.current = null;
    }

    const target = notes.find((n) => n.id === id);
    if (!target) return;

    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    saveNotesLocal(pid, remaining);

    const trashed: CavPadTrashDoc = {
      ...target,
      deletedAt: timeNow(),
      pendingRemoteSync: true,
    };
    const nextTrash = [trashed, ...trash];
    setTrash(nextTrash);
    saveTrashLocal(pid, nextTrash);
    if (target.pendingCreate) {
      deletedPendingCreateIdsRef.current.add(id);
    }

    const nextVisible = remaining
      .filter((n) => n.projectId === pid)
      .filter((n) => (activeFolderId === "all" ? true : (n.folderId || "") === activeFolderId))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    setActiveNoteId(nextVisible?.id || "");
    if (!target.pendingCreate) {
      syncPendingTrashMove(id);
    }
    onToast("Moved to recently deleted. 30 days retention.", "watch");
  }

  function restoreNote(id: string) {
    if (!pid) return;
    setTrashActionsMenuOpen(false);
    deletedPendingCreateIdsRef.current.delete(id);
    const item = trash.find((t) => t.id === id);
    if (!item) return;
    const nextTrash = trash.filter((t) => t.id !== id);
    setTrash(nextTrash);
    saveTrashLocal(pid, nextTrash);

    const restored: CavPadNoteDoc = {
      id: item.id,
      projectId: item.projectId,
      scope: "workspace",
      siteId: item.siteId,
      folderId: item.folderId,
      pinnedAt: item.pinnedAt,
      title: item.title,
      html: item.html,
      createdAt: item.createdAt,
      updatedAt: timeNow(),
    };
    const nextNotes = [restored, ...notes];
    setNotes(nextNotes);
    saveNotesLocal(pid, nextNotes);
    setActiveNoteId(restored.id);
    if (!item.pendingCreate) {
      void fetch(`/api/cavpad/notes/${encodeURIComponent(id)}/restore`, {
        method: "POST",
        keepalive: true,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as { ok?: boolean; note?: CavPadApiNote } | null;
          if (!res.ok || !json?.ok || !json.note) throw new Error("restore sync failed");
          const remote = mapApiNoteToDoc(pid, json.note);
          setNotes((prev) => {
            const local = prev.find((row) => row.id === remote.id);
            const merged = local?.pinnedAt ? { ...remote, pinnedAt: local.pinnedAt } : remote;
            const next = [merged, ...prev.filter((row) => row.id !== remote.id)];
            saveNotesLocal(pid, next);
            return next;
          });
        })
        .catch(() => {
          onToast("Restored locally, but recently deleted update failed.", "watch");
        });
    }
    onToast("Note restored.", "good");
  }

  function purgeNote(id: string) {
    if (!pid) return;
    setTrashActionsMenuOpen(false);
    deletedPendingCreateIdsRef.current.delete(id);
    const nextTrash = trash.filter((t) => t.id !== id);
    setTrash(nextTrash);
    saveTrashLocal(pid, nextTrash);
    const target = trash.find((t) => t.id === id);
    if (!target?.pendingCreate) {
      void fetch(`/api/cavpad/notes/${encodeURIComponent(id)}/purge`, {
        method: "DELETE",
        keepalive: true,
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
          if (!res.ok || !json?.ok) throw new Error("purge sync failed");
        })
        .catch(() => {
          onToast("Deleted locally, but recently deleted delete failed.", "watch");
        });
    }
    onToast("Note deleted permanently.", "bad");
  }

  function applyCavAiDraftToActiveNote(nextHtmlRaw: string) {
    const normalizedHtml = String(nextHtmlRaw || "").trim() || "<p><br></p>";
    const editor = editorRef.current;
    if (!editor) {
      queueSave(normalizedHtml, undefined, activeDocId);
      return;
    }

    editor.focus();
    let replacedWithCommand = false;
    try {
      document.execCommand("selectAll", false);
      replacedWithCommand = document.execCommand("insertHTML", false, normalizedHtml);
    } catch {
      replacedWithCommand = false;
    }

    if (!replacedWithCommand) {
      editor.innerHTML = normalizedHtml;
    }

    const committedHtml = editor.innerHTML || normalizedHtml;
    setEditorEmpty(isEditorEmpty(committedHtml));
    syncEditorHistorySnapshot(committedHtml, activeDocId || activeNoteIdRef.current);
    queueSave(committedHtml, undefined, activeDocId);
    window.setTimeout(() => editor.focus(), 0);
  }

  async function runCavAiDraft(mode: CavPadAiDraftMode, helpPromptInput?: string) {
    if (cavAiDraftBusy) return;
    if (!pid) {
      onToast("Select a workspace first.", "watch");
      return;
    }

    const helpPrompt = String(helpPromptInput || "").trim();
    if (mode === "help_write" && !helpPrompt) {
      onToast("Add a brief prompt for CavAi first.", "watch");
      return;
    }

    const hasActiveNote = Boolean(activeDocId);
    const currentHtml = hasActiveNote ? editorRef.current?.innerHTML || activeDocHtml || "" : "";
    const currentText = hasActiveNote ? htmlToPlainText(currentHtml).trim() : "";
    const noteTitle = clampStr(draftTitle || activeDocTitle || "Untitled", 80) || "Untitled";
    const action = hasActiveNote ? "rewrite_clearly" : "write_note";
    const reasoningLevel = cavAiReasoningLevel;
    const goal = hasActiveNote
      ? mode === "help_write"
        ? `Apply this instruction while preserving intent and facts: ${helpPrompt}`
        : "Rewrite and improve this note for clarity, structure, and actionability."
      : mode === "generate_note"
        ? "Generate a complete workspace note from available context."
        : `Draft a workspace note from this brief: ${helpPrompt}`;
    const prompt = hasActiveNote
      ? [
          mode === "help_write"
            ? "Apply the user's instruction directly to this note. Keep it factual and useful."
            : "Rewrite this note directly so it is cleaner, clearer, and easier to execute.",
          "Preserve intent and concrete facts. Do not invent unavailable metrics or events.",
          mode === "help_write" ? `User instruction:\n${helpPrompt}` : "",
          `Workspace context:\n${cavAiWorkspaceBrief}`,
          `Current note title: ${noteTitle}`,
          currentText ? `Current note content:\n${currentText}` : "Current note content: (empty)",
          "Return the final note text only.",
        ]
          .filter(Boolean)
          .join("\n\n")
      : mode === "generate_note"
        ? [
            "Generate a complete note from workspace context.",
            "Include a concise summary, actionable next steps, risks, and follow-up checks.",
            "Use clear sections and short bullet points where useful.",
            `Workspace context:\n${cavAiWorkspaceBrief}`,
            "Return the final note text only.",
          ].join("\n\n")
        : [
            "Write a high-quality note from the user's brief and workspace context.",
            `User brief:\n${helpPrompt}`,
            "If details are missing, infer sensible structure and add clear action steps.",
            `Workspace context:\n${cavAiWorkspaceBrief}`,
            "Return the final note text only.",
          ].join("\n\n");

    setCavAiDraftBusy(true);
    setCavAiDraftWorkingMode(mode);
    setCavAiDraftMenuOpen(mode === "generate_note");
    setCavAiHelpPromptOpen(false);
    setCavAiControlMenu(null);
    try {
      const res = await fetch("/api/ai/center/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          action,
          surface: "cavpad",
          goal,
          prompt,
          model: cavAiModelId,
          reasoningLevel,
          sessionId: String(cavAiSessionId || "").trim() || undefined,
          workspaceId: activeDocId || originSiteId || undefined,
          projectId: Number.isFinite(Number(pid)) && Number(pid) > 0 ? Math.trunc(Number(pid)) : undefined,
          origin: cavAiOrigin || undefined,
          contextLabel: cavAiContextLabel,
          context: {
            mode,
            hasActiveNote,
            noteTitle: hasActiveNote ? noteTitle : null,
            modelId: cavAiModelId,
            modelLabel: cavAiModelLabel,
            reasoningLevel: reasoningLevel || "medium",
            currentNoteLength: currentText.length,
            noteCount: projectNotes.length,
            workspaceBrief: cavAiWorkspaceBrief,
          },
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        sessionId?: string;
        data?: unknown;
      };
      if (!res.ok || !body.ok || !body.data) {
        throw new Error(String(body.message || "CavAi draft request failed."));
      }

      const nextSessionId = String(body.sessionId || "").trim();
      if (nextSessionId) {
        setCavAiSessionId(nextSessionId);
      }

      const draftData = normalizeCavPadAiCenterDraft(body.data);
      if (!draftData) {
        throw new Error("CavAi returned no usable draft.");
      }

      const draftHtml = buildCavPadAiDraftHtml(draftData) || "<p><br></p>";
      if (hasActiveNote) {
        applyCavAiDraftToActiveNote(draftHtml);
        onToast("CavAi updated your note. Use Undo to revert.", "good");
        return;
      }

      const generatedTitle = deriveCavPadAiDraftTitle(draftData);
      const createdId = createNote(generatedTitle, draftHtml);
      if (!createdId) {
        throw new Error("Could not create a CavAi note.");
      }
      setDraftTitle(generatedTitle);
      onToast(mode === "generate_note" ? "CavAi generated a new note." : "CavAi started your note.", "good");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "CavAi could not write this note.", "watch");
    } finally {
      setCavAiDraftBusy(false);
      setCavAiDraftWorkingMode(null);
      setCavAiDraftMenuOpen(false);
      setCavAiHelpPromptText("");
    }
  }

  function openCavAiHelpPrompt() {
    if (cavAiDraftBusy) return;
    setCavAiControlMenu(null);
    setCavAiDraftMenuOpen(false);
    setCavAiHelpPromptText("");
    setCavAiHelpPromptOpen(true);
  }

  function submitCavAiHelpPrompt() {
    if (cavAiDraftBusy) return;
    const trimmed = String(cavAiHelpPromptText || "").trim();
    if (!trimmed) {
      onToast("Add a brief prompt for CavAi.", "watch");
      cavAiHelpPromptInputRef.current?.focus();
      return;
    }
    void runCavAiDraft("help_write", trimmed);
  }

  function handleCavAiDraftTrigger() {
    if (cavAiDraftBusy) return;
    setCavAiControlMenu(null);
    setCavAiHelpPromptOpen(false);
    setCavAiDraftMenuOpen((prev) => !prev);
  }

  function exec(cmd: string, value?: string) {
    const normalizedCmd = String(cmd || "").toLowerCase();
    if (normalizedCmd === "undo" || normalizedCmd === "redo") {
      runEditorHistoryCommand(normalizedCmd);
      return;
    }

    const editor = editorRef.current;
    if (!editor) return;
    if (!editorActive) setEditorActive(true);

    focusEditorForCommand();
    const beforeHtml = String(editor.innerHTML || "");
    try {
      document.execCommand(cmd, false, value);
    } catch {}
    const html = String(editor.innerHTML || "");
    if (html === beforeHtml) return;
    syncEditorHistorySnapshot(html);
    setEditorEmpty(isEditorEmpty(html));
    queueSave(html);
  }

  function buildAttachmentHtml(meta: CavPadAttachment, previewUrl?: string) {
    const safeName = escapeHtml(meta.fileName || "attachment");
    const sizeLabel = formatFileSize(meta.size);
    const safeUrl = escapeHtml(previewUrl || "");
    let mediaMarkup = "";
    if (meta.kind === "image") {
      mediaMarkup = `<img ${safeUrl ? `src="${safeUrl}"` : ""} alt="${safeName}" data-attachment-media loading="lazy" />`;
    } else if (meta.kind === "video") {
      mediaMarkup = `<video ${safeUrl ? `src="${safeUrl}"` : ""} controls playsinline preload="metadata" data-attachment-media></video>`;
    } else {
      const icon = meta.kind === "document" ? "📄" : "📁";
      mediaMarkup = `<div data-attachment-media class="cb-attachment-placeholder">${icon}</div>`;
    }

    const infoMarkup =
      meta.kind === "image"
        ? ""
        : `<div class="cb-attachment-meta">
             <div>
               <span class="cb-attachment-name">${safeName}</span>
               <span class="cb-attachment-size">${sizeLabel}</span>
             </div>
             <a
               class="cb-attachment-link"
               data-attachment-download="${meta.id}"
               target="_blank"
               rel="noreferrer"
               href="${safeUrl}"
               download="${safeName}"
             >
               Open
             </a>
           </div>`;

    return `<div
      class="cb-attachment cb-attachment-${meta.kind}"
      data-attachment-id="${meta.id}"
      data-attachment-kind="${meta.kind}"
    >
      <div class="cb-attachment-media">
        ${mediaMarkup}
      </div>
      ${infoMarkup}
    </div><p><br></p>`;
  }

  async function processAttachmentFiles(kind: CavPadAttachmentKind, files: FileList | null) {
    const selection = files ? Array.from(files) : [];
    if (!selection.length) return;
    if (!pid) {
      onToast("Select a workspace first.", "watch");
      return;
    }
    if (!activeDocId) {
      onToast("Open a note before adding attachments.", "watch");
      return;
    }
    const newMetas: CavPadAttachment[] = [];
    for (const file of selection) {
      const now = timeNow();
      const meta: CavPadAttachment = {
        id: uid("att"),
        projectId: pid,
        noteId: activeDocId,
        kind,
        fileName: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        createdAt: now,
        updatedAt: now,
      };
      await saveAttachmentBlob(pid, meta.id, file);
      const previewUrl = URL.createObjectURL(file);
      attachmentUrlCache.current[meta.id] = previewUrl;
      newMetas.push(meta);
      exec("insertHTML", buildAttachmentHtml(meta, previewUrl));
    }
    if (!newMetas.length) return;
    setAttachments((prev) => {
      const next = [...newMetas, ...prev.filter((att) => newMetas.every((meta) => meta.id !== att.id))];
      saveAttachmentsLocal(pid, next);
      return next;
    });
    onToast(`Added ${newMetas.length} attachment${newMetas.length === 1 ? "" : "s"}.`, "good");
  }

  function handleAttachmentInputChange(kind: CavPadAttachmentKind, e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.currentTarget.files;
    void processAttachmentFiles(kind, files);
    e.currentTarget.value = "";
  }

  const attachmentPickers: Record<CavPadAttachmentKind, React.RefObject<HTMLInputElement | null>> = {
    image: imageInputRef,
    video: videoInputRef,
    document: fileInputRef,
    file: fileInputRef,
  };

  function triggerAttachmentPicker(kind: CavPadAttachmentKind) {
    attachmentPickers[kind]?.current?.click();
  }

  function handleUploadOption(kind: CavPadAttachmentKind) {
    setUploadMenuOpen(false);
    triggerAttachmentPicker(kind);
  }

  function handleEditorFocus() {
    setEditorActive(true);
  }

  function handleEditorBlur() {
    setEditorActive(false);
    const noteId = activeDocId || activeNoteIdRef.current || autoCreateNoteIdRef.current;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (noteId) flushRemoteSave(noteId);
    window.setTimeout(() => {
      document.getSelection()?.removeAllRanges();
    }, 0);
  }

  function handleEditorMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (editorActive) return;
    const node = event.target as Node | null;
    const clickable = node instanceof Element ? node : node?.parentElement ?? null;
    if (clickable?.closest("a")) {
      return;
    }
    event.preventDefault();
    setEditorActive(true);
    window.setTimeout(() => editorRef.current?.focus(), 0);
  }

  type LinkTriggerKey = " " | "Enter";

  function linkWordBeforeCursor(triggerKey: LinkTriggerKey) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;
    if (!editorRef.current?.contains(range.startContainer)) return false;

    let node: Node = range.startContainer;
    let offset = range.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[offset - 1];
      if (!child || child.nodeType !== Node.TEXT_NODE) return false;
      node = child;
      offset = (node.nodeValue ?? "").length;
    }

    const textNode = node as Text;
    const text = textNode.nodeValue ?? "";
    const before = text.slice(0, offset);
    const trimmedBefore = before.replace(/[\s]+$/u, "");
    if (!trimmedBefore.length) return false;
    const match = trimmedBefore.match(AUTO_LINK_MATCH_WORD);
    if (!match) return false;

    const matchText = match[0];
    const start = Math.max(0, trimmedBefore.length - matchText.length);
    const wordRange = document.createRange();
    wordRange.setStart(textNode, start);
    wordRange.setEnd(textNode, start + matchText.length);
    const href = matchText.toLowerCase().startsWith("http") ? matchText : `https://${matchText}`;

    const savedRange = range.cloneRange();
    savedRange.collapse(false);

    selection.removeAllRanges();
    selection.addRange(wordRange);
    document.execCommand("createLink", false, href);

    const doc = editorRef.current?.ownerDocument || document;
    const repositioned = repositionSelectionAfterLink(selection, doc, triggerKey);
    if (!repositioned) {
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }

    return true;
  }

  function repositionSelectionAfterLink(selection: Selection, doc: Document, triggerKey: LinkTriggerKey) {
    if (!selection.anchorNode) return false;
    const anchorElement =
      selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? (selection.anchorNode as Element).closest("a")
        : selection.anchorNode.parentElement?.closest("a") ?? null;
    if (!anchorElement) return false;

    const nextSibling = anchorElement.nextSibling;
    const whitespaceNode =
      nextSibling && nextSibling.nodeType === Node.TEXT_NODE && /^\s/.test(nextSibling.nodeValue || "")
        ? (nextSibling as Text)
        : null;
    const range = doc.createRange();

    if (whitespaceNode) {
      range.setStart(whitespaceNode, whitespaceNode.nodeValue?.length || 0);
      range.collapse(true);
    } else if (triggerKey === "Enter" && nextSibling instanceof Element) {
      range.selectNodeContents(nextSibling);
      range.collapse(true);
    } else {
      range.setStartAfter(anchorElement);
      range.collapse(true);
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function handleEditorKeyUp(event: React.KeyboardEvent<HTMLDivElement>) {
    const normalizedKey = event.key === "Spacebar" ? " " : event.key;
    if (normalizedKey === " " || normalizedKey === "Enter") {
      linkWordBeforeCursor(normalizedKey);
    }
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editorActive) return;
    const hasPrimaryModifier = event.metaKey || event.ctrlKey;
    if (!hasPrimaryModifier || event.altKey) return;

    const key = String(event.key || "").toLowerCase();
    if (key === "z") {
      event.preventDefault();
      runEditorHistoryCommand(event.shiftKey ? "redo" : "undo");
      return;
    }
    if (key === "y") {
      event.preventDefault();
      runEditorHistoryCommand("redo");
    }
  }

  function createEmbedMarkup(url: string, type: "image" | "video") {
    const safeUrl = escapeHtml(url);
    if (type === "image") {
      return `<div class="cb-embed-card cb-embed-card-image">
        <img src="${safeUrl}" alt="Pasted image" />
      </div><p><br></p>`;
    }
    return `<div class="cb-embed-card cb-embed-card-video">
      <div class="cb-embed-card-icon" aria-hidden="true">▶</div>
      <div class="cb-embed-card-body">
        <div class="cb-embed-card-title">Video link</div>
        <a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a>
      </div>
    </div><p><br></p>`;
  }

  function onEditorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const text = event.clipboardData?.getData("text/plain")?.trim();
    if (!text) return;
    const candidate = text.split(/\s+/)[0];
    if (!candidate || candidate.length !== text.length) return;
    if (!/^https?:\/\//.test(candidate)) return;
    if (isImageUrl(candidate)) {
      event.preventDefault();
      exec("insertHTML", createEmbedMarkup(candidate, "image"));
      return;
    }
    if (isVideoUrl(candidate)) {
      event.preventDefault();
      exec("insertHTML", createEmbedMarkup(candidate, "video"));
    }
    window.setTimeout(() => autoLinkEditorContent(editorRef.current), 0);
  }

  React.useEffect(() => {
    if (!editorRef.current) return;
    const timer = window.setTimeout(() => hydrateAttachments(editorRef.current), 60);
    return () => window.clearTimeout(timer);
  }, [activeDocHtml, hydrateAttachments]);

  function captureLinkSelection() {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      linkRangeRef.current = null;
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) {
      linkRangeRef.current = null;
      return;
    }
    linkRangeRef.current = range.cloneRange();
  }

  function restoreLinkSelection() {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (linkRangeRef.current) {
      sel.addRange(linkRangeRef.current);
    } else if (editorRef.current) {
      const doc = editorRef.current.ownerDocument || document;
      const fallbackRange = doc.createRange();
      fallbackRange.selectNodeContents(editorRef.current);
      fallbackRange.collapse(false);
      sel.addRange(fallbackRange);
    }
    editorRef.current?.focus();
  }

  function makeLink() {
    captureLinkSelection();
    setLinkModalValue("");
    setLinkModalOpen(true);
  }

  function handleLinkButtonMouseDown() {
    captureLinkSelection();
  }

  function applyFormat(value: string) {
    if (value === "format") return;
    const preset = FORMAT_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    exec("formatBlock", preset.block);
    const wasMonostyled = formatMode === "monostyled";
    setFormatMode(value);
    if (value === "monostyled") {
      setSettings((prev) => {
        lastNonMonoFont.current =
          prev.font === MONO_FONT ? lastNonMonoFont.current : prev.font || lastNonMonoFont.current;
        return { ...prev, font: MONO_FONT };
      });
    } else if (wasMonostyled) {
      setSettings((prev) => ({ ...prev, font: lastNonMonoFont.current || prev.font }));
    }
  }

  function insertTable(rows = 2, cols = 2) {
    const safeRows = Math.max(2, Math.min(6, rows));
    const safeCols = Math.max(2, Math.min(6, cols));
    let html = `<table class="cb-notes-table"><tbody>`;
    for (let r = 0; r < safeRows; r += 1) {
      html += "<tr>";
      for (let c = 0; c < safeCols; c += 1) {
        html += "<td><br /></td>";
      }
      html += "</tr>";
    }
    html += "</tbody></table><p><br /></p>";
    exec("insertHTML", html);
  }

  function onEditorInput() {
    const html = editorRef.current?.innerHTML || "";
    const empty = isEditorEmpty(html);
    setEditorEmpty(empty);

    if (!activeDocId) {
      if (empty || !pid) return;
      const pendingNoteId = autoCreateNoteIdRef.current;
      if (pendingNoteId) {
        syncEditorHistorySnapshot(html, pendingNoteId);
        queueSave(html, undefined, pendingNoteId);
        return;
      }
      const seededTitle = clampStr(draftTitle, 80) || "Untitled";
      const createdId = createNote(seededTitle, html);
      if (createdId) {
        autoCreateNoteIdRef.current = createdId;
        resetEditorHistoryForNote(createdId, html);
      }
      return;
    }

    syncEditorHistorySnapshot(html, activeDocId);
    queueSave(html);
  }

  function handleTitleChange(nextRaw: string) {
    const nextTitle = String(nextRaw || "").slice(0, 80);
    setDraftTitle(nextTitle);
    if (activeDocId) queueSave(undefined, nextTitle);
  }

  function handleTitleFocus(value: string) {
    const current = String(value || "").trim().toLowerCase();
    if (current === "untitled") {
      setDraftTitle("");
    }
  }

  function seedNoteFromDraftTitle() {
    if (activeDocId) return;
    const seededTitle = clampStr(draftTitle, 80).trim();
    if (!seededTitle) return;
    createNote(seededTitle);
  }

  function handlePhoneTitleBlur() {
    if (skipPhoneTitleCommitRef.current) {
      skipPhoneTitleCommitRef.current = false;
      setIsPhoneTitleEditing(false);
      return;
    }
    seedNoteFromDraftTitle();
    setIsPhoneTitleEditing(false);
  }

  function handleToolbarMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target as Element | null;
    if (!target) return;
    if (!target.closest("button.cb-notes-tool")) return;
    event.preventDefault();
    if (!editorActive) setEditorActive(true);
    focusEditorForCommand();
  }

  function closeLinkModal() {
    setLinkModalOpen(false);
    setLinkModalValue("");
    editorRef.current?.focus();
  }

  function confirmLinkModal() {
    const rawUrl = linkModalValue.trim();
    if (!rawUrl) return;
    const normalizedHref = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const safeLabel = rawUrl.replace(/^https?:\/\//, "");

    if (linkRangeRef.current && !linkRangeRef.current.collapsed) {
      restoreLinkSelection();
      exec("createLink", normalizedHref);
    } else {
      const html = `<p><a href="${escapeHtml(normalizedHref)}" target="_blank" rel="noreferrer">${escapeHtml(
        safeLabel
      )}</a></p><p><br></p>`;
      exec("insertHTML", html);
      setEditorEmpty(false);
    }

    linkRangeRef.current = null;
    closeLinkModal();
  }

  const Wrapper = embedded ? "div" : "section";
  const theme = settings.theme || "lime";
  const font = settings.font || "Inter";
  const fontColor = settings.fontColor || "#F7FBFF";
  const gridLines = Boolean(settings.gridLines);
  const cavAiPromptActionLabel = editorEmpty ? "Create" : "Update";

  const viewLabel =
    view === "cavpad"
      ? "Write a note"
      : view === "notes"
        ? "Notes"
      : view === "directories"
        ? "CavPad"
        : view === "trash"
          ? "Recently deleted"
          : view === "details"
          ? "Details"
            : "Settings";
  function renderColorPicker(variant: "top" | "toolbar") {
    return (
      <div
        className={`cb-notes-colorpicker cb-notes-colorpicker-${variant} ${colorOpen ? "is-open" : ""}`}
        role="group"
        aria-label="Text color"
      >
        <button
          type="button"
          className="cb-notes-colortrigger"
          aria-haspopup="dialog"
          aria-expanded={colorOpen}
          onClick={() => setColorOpen((v) => !v)}
        >
          <span className="cb-notes-colorA">A</span>
          <span className="cb-notes-colorline" style={{ background: settings.fontColor }} />
        </button>
        {colorOpen ? (
          <div className="cb-notes-colorpanel" role="dialog" aria-label="Text color">
            {CAVPAD_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`cb-notes-colorchip ${settings.fontColor === c.value ? "is-on" : ""}`}
                onClick={() => {
                  setSettings({ ...settings, fontColor: c.value });
                  setColorOpen(false);
                }}
                aria-label={c.label}
                title={c.label}
              >
                <span className="cb-notes-colorchip-line" style={{ background: c.value }} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const trashNoticeRows = React.useMemo(
    () =>
      trash
        .filter((row) => row.projectId === pid)
        .map((row) => ({
          note: row,
          daysLeft: Math.max(0, Number(trashDaysLeft[row.id] ?? 30)),
        }))
        .filter((row) => row.daysLeft <= 7)
        .sort((a, b) => {
          if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
          return b.note.deletedAt - a.note.deletedAt;
        }),
    [pid, trash, trashDaysLeft]
  );
  const trashNoticeCount = trashNoticeRows.length;
  const allDirectoriesSelected =
    directoryScopedFolders.length > 0 &&
    selectedDirectoryIds.length === directoryScopedFolders.length &&
    directoryScopedFolders.every((folder) => selectedDirectoryIds.includes(folder.id));
  const allDirectoryNotesSelected =
    directoryScopedNotes.length > 0 &&
    selectedDirectoryNoteIds.length === directoryScopedNotes.length &&
    directoryScopedNotes.every((note) => selectedDirectoryNoteIds.includes(note.id));
  const allLibrarySelected = libraryNotes.length > 0 && selectedLibraryNoteIds.length === libraryNotes.length;
  const hasLibrarySelection = selectedLibraryNoteIds.length > 0;
  const canRunSingleLibraryAction = selectedLibraryNoteIds.length === 1;
  const allSelectedLibraryPinned =
    hasLibrarySelection &&
    selectedLibraryNoteIds.every((id) => Boolean(notes.find((row) => row.id === id)?.pinnedAt));
  const libraryPinActionLabel = allSelectedLibraryPinned ? "Unpin" : "Pin";
  const allTrashSelected = trash.length > 0 && selectedTrashIds.length === trash.length;
  const hasDirectorySelection = selectedDirectoryIds.length > 0;
  const hasDirectoryNoteSelection = selectedDirectoryNoteIds.length > 0;
  const directorySelectionCount = selectedDirectoryIds.length + selectedDirectoryNoteIds.length;
  const allSelectedDirectoriesPinned =
    hasDirectorySelection &&
    selectedDirectoryIds.every((id) => Boolean(folders.find((row) => row.id === id)?.pinnedAt));
  const allSelectedDirectoryNotesPinned =
    hasDirectoryNoteSelection &&
    selectedDirectoryNoteIds.every((id) => Boolean(notes.find((row) => row.id === id)?.pinnedAt));
  const directoryPinActionLabel = allSelectedDirectoriesPinned ? "Unpin" : "Pin";
  const directoryNotePinActionLabel = allSelectedDirectoryNotesPinned ? "Unpin" : "Pin";
  const hasTrashSelection = selectedTrashIds.length > 0;
  const canRunSingleDirectoryAction = selectedDirectoryIds.length === 1;
  const canRunSingleDirectoryNoteAction = selectedDirectoryNoteIds.length === 1;
  const selectedLibraryNote = selectedLibraryNoteIds.length === 1
    ? notes.find((row) => row.id === selectedLibraryNoteIds[0]) || null
    : null;
  const detailsFolder = detailsFolderId
    ? folders.find((row) => row.id === detailsFolderId) || null
    : null;
  const detailsNote = detailsNoteId
    ? notes.find((row) => row.id === detailsNoteId) || null
    : detailsFolder
      ? null
      : selectedLibraryNote;
  const collabModalNote = collabModalTarget?.kind === "note"
    ? notes.find((row) => row.id === collabModalTarget.id) || null
    : null;
  const collabModalDirectory = collabModalTarget?.kind === "directory"
    ? folders.find((row) => row.id === collabModalTarget.id) || null
    : null;
  const moveNoteModalNote = moveNoteModalNoteId
    ? notes.find((row) => row.id === moveNoteModalNoteId) || null
    : null;
  const mergeDirectoryModalDirectory = mergeDirectoryModalDirectoryId
    ? folders.find((row) => row.id === mergeDirectoryModalDirectoryId) || null
    : null;
  const moveNoteModalDirectoryOptions = React.useMemo(() => {
    return projectFolders
      .map((folder) => {
        const count = folderNoteCounts.get(folder.id) || 0;
        return {
          id: folder.id,
          label: directoryPathById.get(folder.id) || folder.name,
          meta: `${count} note${count === 1 ? "" : "s"}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [directoryPathById, folderNoteCounts, projectFolders]);
  const moveNoteModalFilteredDirectoryOptions = React.useMemo(() => {
    const query = moveNoteModalSearchQuery.trim().toLowerCase();
    const noDirectoryOption = {
      id: "all",
      label: "No directory",
      meta: "Move to All notes",
    };
    if (!query) return [noDirectoryOption, ...moveNoteModalDirectoryOptions];
    const matchesNoDirectory =
      "no directory".includes(query) ||
      "all notes".includes(query) ||
      "root".includes(query);
    const rows = moveNoteModalDirectoryOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        option.meta.toLowerCase().includes(query)
    );
    if (matchesNoDirectory) return [noDirectoryOption, ...rows];
    return rows;
  }, [moveNoteModalDirectoryOptions, moveNoteModalSearchQuery]);
  const moveNoteModalSelectedDirectoryLabel = React.useMemo(() => {
    if (!moveNoteModalDirectoryId) return "Select directory";
    if (moveNoteModalDirectoryId === "all") return "No directory";
    return (
      moveNoteModalDirectoryOptions.find((option) => option.id === moveNoteModalDirectoryId)?.label ||
      "Select directory"
    );
  }, [moveNoteModalDirectoryId, moveNoteModalDirectoryOptions]);
  const canConfirmMoveNoteModal = Boolean(moveNoteModalDirectoryId);
  const mergeDirectoryModalOptions = React.useMemo(() => {
    const sourceId = String(mergeDirectoryModalDirectoryId || "").trim();
    const rootOption = {
      id: "root",
      label: "CavPad",
      meta: "Top-level folder",
    };
    if (!sourceId) return [rootOption];

    const childrenByParent = new Map<string, string[]>();
    projectFolders.forEach((folder) => {
      const parentKey = normalizeDirectoryParentId(folder.parentId);
      const rows = childrenByParent.get(parentKey) || [];
      rows.push(folder.id);
      childrenByParent.set(parentKey, rows);
    });

    const descendantIds = new Set<string>();
    const stack = [...(childrenByParent.get(sourceId) || [])];
    while (stack.length) {
      const id = stack.pop() as string;
      if (!id || descendantIds.has(id)) continue;
      descendantIds.add(id);
      const children = childrenByParent.get(id);
      if (children?.length) stack.push(...children);
    }

    const rows = projectFolders
      .filter((folder) => folder.id !== sourceId && !descendantIds.has(folder.id))
      .map((folder) => {
        const noteCount = folderNoteCounts.get(folder.id) || 0;
        const childCount = folderChildCounts.get(folder.id) || 0;
        return {
          id: folder.id,
          label: directoryPathById.get(folder.id) || folder.name,
          meta: `${childCount} folder${childCount === 1 ? "" : "s"} · ${noteCount} note${noteCount === 1 ? "" : "s"}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    return [rootOption, ...rows];
  }, [directoryPathById, folderChildCounts, folderNoteCounts, mergeDirectoryModalDirectoryId, projectFolders]);
  const mergeDirectoryModalFilteredOptions = React.useMemo(() => {
    const query = mergeDirectoryModalSearchQuery.trim().toLowerCase();
    if (!query) return mergeDirectoryModalOptions;
    return mergeDirectoryModalOptions.filter((option) => {
      if (option.id === "root") {
        return (
          "root".includes(query) ||
          "cavpad".includes(query) ||
          "top-level".includes(query) ||
          option.label.toLowerCase().includes(query)
        );
      }
      return option.label.toLowerCase().includes(query) || option.meta.toLowerCase().includes(query);
    });
  }, [mergeDirectoryModalOptions, mergeDirectoryModalSearchQuery]);
  const mergeDirectoryModalSelectedLabel = React.useMemo(() => {
    if (!mergeDirectoryModalTargetId) return "Select destination folder";
    return (
      mergeDirectoryModalOptions.find((option) => option.id === mergeDirectoryModalTargetId)?.label ||
      "Select destination folder"
    );
  }, [mergeDirectoryModalOptions, mergeDirectoryModalTargetId]);
  const mergeDirectoryModalCurrentParentId = mergeDirectoryModalDirectory?.parentId
    ? mergeDirectoryModalDirectory.parentId
    : "root";
  const canConfirmMergeDirectoryModal = Boolean(
    mergeDirectoryModalDirectoryId &&
    mergeDirectoryModalTargetId &&
    mergeDirectoryModalDirectory &&
    mergeDirectoryModalDirectory.id !== mergeDirectoryModalTargetId &&
    mergeDirectoryModalTargetId !== mergeDirectoryModalCurrentParentId
  );
  const detailsOwnerLabel = React.useMemo(() => {
    return resolveIdentityLabel({
      displayName: cachedProfile.displayName,
      username: cachedProfile.username,
      email: cachedProfile.email,
      userId: "owner",
      usernameStyle: "at",
    });
  }, [cachedProfile.displayName, cachedProfile.email, cachedProfile.username]);
  const detailsOriginSite = React.useMemo(() => {
    const detailsSiteId = String(detailsNote?.siteId || "").trim();
    if (!detailsSiteId) return "No site added.";
    const matched = sites.find((row) => String(row.id || "").trim() === detailsSiteId);
    const label = String(matched?.label || "").trim();
    return label || "No site added.";
  }, [detailsNote?.siteId, sites]);
  const detailsBaseLocation = React.useMemo(() => {
    if (!detailsNote) return "/cavpad";
    const folderId = String(detailsNote.folderId || "").trim();
    if (!folderId) return "/cavpad";
    const folder = folders.find((row) => row.id === folderId);
    const folderName = clampStr(String(folder?.name || ""), 80).trim().replace(/\//g, "-");
    return folderName ? `/${folderName}` : "/cavpad";
  }, [detailsNote, folders]);
  const detailsLocationDestinations = React.useMemo(() => {
    const rows = ["/cavpad"];
    if (settings.syncToCavcloud) rows.push("/cavcloud");
    if (cavsafeEnabled && settings.syncToCavsafe) rows.push("/cavsafe");
    return rows;
  }, [cavsafeEnabled, settings.syncToCavcloud, settings.syncToCavsafe]);
  const detailsLocation = React.useMemo(() => {
    if (detailsBaseLocation === "/cavpad") return detailsLocationDestinations.join(", ");
    if (detailsLocationDestinations.length === 1) return detailsBaseLocation;
    return `${detailsBaseLocation} · ${detailsLocationDestinations.join(", ")}`;
  }, [detailsBaseLocation, detailsLocationDestinations]);
  const detailsFolderLocation = React.useMemo(() => {
    if (!detailsFolder) return "/cavpad";
    const rawPath = String(directoryPathById.get(detailsFolder.id) || detailsFolder.name || "cavpad").trim();
    const normalizedPath = rawPath.replace(/\s*\/\s*/g, "/");
    return `/${normalizedPath || "cavpad"}`;
  }, [detailsFolder, directoryPathById]);
  const detailsCavcloudSync = React.useMemo(() => {
    if (!settings.syncToCavcloud) return "Not syncing to CavCloud. Saved in CavPad only.";
    const path = String(detailsNote?.cavcloudPath || "").trim();
    return `Sync on${path ? ` · ${path}` : " · /Synced/CavPad"}`;
  }, [detailsNote?.cavcloudPath, settings.syncToCavcloud]);
  const detailsFolderCavcloudSync = React.useMemo(() => {
    if (!settings.syncToCavcloud) return "Not syncing to CavCloud. Saved in CavPad only.";
    return "Sync on · /Synced/CavPad";
  }, [settings.syncToCavcloud]);
  const detailsCavsafeSync = React.useMemo(() => {
    if (!cavsafeEnabled) return "Available on Premium plans.";
    if (!settings.syncToCavsafe) return "Not syncing to CavSafe.";
    return "Sync on.";
  }, [cavsafeEnabled, settings.syncToCavsafe]);
  const detailsFolderStatusLabel = React.useMemo(() => {
    if (!detailsFolderAccess.length) return "Personal";
    if (detailsFolderAccess.some((row) => row.permission === "EDIT")) return "Collab";
    return "Shared";
  }, [detailsFolderAccess]);
  const detailsFolderOpenLabel = React.useMemo(() => {
    const folderName = String(detailsFolder?.name || "").trim() || "Untitled folder";
    return `Open ${folderName}`;
  }, [detailsFolder?.name]);
  const detailsFolderHierarchy = React.useMemo(() => {
    if (!detailsFolder) {
      return {
        descendantIds: [] as string[],
        descendantSet: new Set<string>(),
        totalChildFolders: 0,
      };
    }
    const childrenByParent = new Map<string, string[]>();
    projectFolders.forEach((row) => {
      const parentId = String(row.parentId || "").trim();
      if (!parentId) return;
      const existing = childrenByParent.get(parentId) || [];
      existing.push(row.id);
      childrenByParent.set(parentId, existing);
    });
    const descendantIds: string[] = [];
    const queue = [detailsFolder.id];
    const seen = new Set<string>();
    while (queue.length) {
      const current = String(queue.shift() || "").trim();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      descendantIds.push(current);
      const children = childrenByParent.get(current) || [];
      children.forEach((childId) => queue.push(childId));
    }
    return {
      descendantIds,
      descendantSet: seen,
      totalChildFolders: Math.max(0, descendantIds.length - 1),
    };
  }, [detailsFolder, projectFolders]);
  const detailsFolderDirectFileCount = React.useMemo(() => {
    if (!detailsFolder) return 0;
    return notes.filter((row) => row.projectId === pid && String(row.folderId || "").trim() === detailsFolder.id).length;
  }, [detailsFolder, notes, pid]);
  const detailsFolderTotalFileCount = React.useMemo(() => {
    if (!detailsFolder) return 0;
    return notes.filter((row) => row.projectId === pid && detailsFolderHierarchy.descendantSet.has(String(row.folderId || "").trim())).length;
  }, [detailsFolder, detailsFolderHierarchy.descendantSet, notes, pid]);
  const detailsFolderRecentChange = React.useMemo(() => {
    if (!detailsFolder) return "No revision record yet.";
    const relevantNotes = notes.filter(
      (row) => row.projectId === pid && detailsFolderHierarchy.descendantSet.has(String(row.folderId || "").trim())
    );
    const latestNote = relevantNotes.reduce<CavPadNoteDoc | null>((latest, row) => {
      if (!latest) return row;
      return row.updatedAt > latest.updatedAt ? row : latest;
    }, null);
    const latestFolderTs = detailsFolder.updatedAt;
    const latestNoteTs = latestNote?.updatedAt || 0;

    if (latestNote && latestNoteTs >= latestFolderTs) {
      const operator = resolveIdentityLabel({
        displayName: latestNote.lastChangeDisplayName || latestNote.ownerDisplayName,
        username: latestNote.lastChangeUsername || latestNote.ownerUsername,
        email: latestNote.lastChangeEmail || latestNote.ownerEmail,
        userId: latestNote.lastChangeUserId || latestNote.ownerUserId,
        usernameStyle: "at",
      });
      return `${operator} changed or moved a file at ${fmtTime(latestNoteTs)}`;
    }

    return `${detailsOwnerLabel} changed folder metadata at ${fmtTime(latestFolderTs)}`;
  }, [detailsFolder, detailsFolderHierarchy.descendantSet, detailsOwnerLabel, notes, pid]);
  const detailsStatusLabel = React.useMemo(() => {
    if (detailsNote?.status === "shared") return "Shared";
    if (detailsNote?.status === "collab") return "Collab";
    return "Personal";
  }, [detailsNote?.status]);
  const filteredDetailsVersions = React.useMemo(() => {
    if (!detailsVersions.length) return [];
    const query = String(detailsVersionQuery || "").trim().toLowerCase();
    if (!query) return detailsVersions;

    return detailsVersions.filter((row) => {
      const operator = resolveIdentityLabel({
        displayName: row.createdByDisplayName,
        username: row.createdByUsername,
        email: row.createdByEmail,
        userId: row.createdByUserId,
        usernameStyle: "at",
      }).toLowerCase();
      const versionLabel = `v${Number(row.versionNumber || 0)}`.toLowerCase();
      const when = fmtEditedTime(safeNumDate(row.createdAtISO)).toLowerCase();
      return operator.includes(query) || versionLabel.includes(query) || when.includes(query);
    });
  }, [detailsVersionQuery, detailsVersions]);
  const currentDetailsVersionId = React.useMemo(() => {
    if (!detailsVersions.length) return "";
    let current = detailsVersions[0];
    for (const row of detailsVersions) {
      if (Number(row.versionNumber || 0) > Number(current.versionNumber || 0)) {
        current = row;
      }
    }
    return String(current.id || "");
  }, [detailsVersions]);

  React.useEffect(() => {
    if (trashNoticeCount <= 0) {
      warnedTrashNoticeSignatureRef.current = "";
      return;
    }
    if (view !== "trash") return;
    const signature = trashNoticeRows.map((row) => `${row.note.id}:${row.daysLeft}`).join("|");
    if (!signature || warnedTrashNoticeSignatureRef.current === signature) return;
    warnedTrashNoticeSignatureRef.current = signature;
    onToast(
      `${trashNoticeCount} note${trashNoticeCount === 1 ? "" : "s"} on 7-day deletion notice.`,
      "watch"
    );
  }, [onToast, trashNoticeCount, trashNoticeRows, view]);

  return (
    <>
      <Wrapper
        className={embedded ? "cb-notes-embed cb-cavpad-root" : "cb-card cb-notes-card cb-cavpad-root"}
        data-cavpad-theme={theme}
        data-cavpad-grid={gridLines ? "on" : "off"}
        style={
          {
            "--cavpad-editor-font": `'${font}', var(--font-sans)`,
            "--cavpad-ink": fontColor,
          } as React.CSSProperties
        }
        aria-label="CavPad"
      >
        <div className="cb-card-head">
          <div className="cb-card-head-row cb-notes-headrow">
            {!isPhone ? (
              <div className="cb-notes-headleft cb-notes-headleft-badge" aria-label="CavPad">
                <div className="cb-badge-left" aria-hidden="true">
                  <div
                    className={`cb-badge cb-badge-inline ${
                      badgeTone === "lime"
                        ? "cavbot-auth-eye-watch"
                        : badgeTone === "red"
                          ? "cavbot-auth-eye-error"
                          : ""
                    }`}
                  >
                    <CdnBadgeEyes trackingMode="eyeOnly" />
                  </div>
                </div>
              </div>
            ) : null}

            <div className={`cb-notes-actions-right ${isPhoneWriteView ? "is-phone-write" : ""}`}>
              {isPhoneWriteView ? (
                <button
                  type="button"
                  className="cb-notes-header-backbtn"
                  onClick={() => {
                    setViewMenuOpen(false);
                    openDirectoryRoot();
                  }}
                  aria-label="Back to CavPad"
                  title="Back to CavPad"
                >
                  <Image
                    src="/icons/back-svgrepo-com.svg"
                    alt=""
                    width={14}
                    height={14}
                    className="cb-notes-header-backbtn-icon"
                    aria-hidden="true"
                    unoptimized
                  />
                </button>
              ) : (
                <div className="cb-notes-viewmenu">
                  <button
                    type="button"
                    className="cb-notes-viewbtn"
                    aria-haspopup="menu"
                    aria-expanded={viewMenuOpen}
                    onClick={() => setViewMenuOpen((s) => !s)}
                  >
                    <span className="cb-notes-viewbtn-label">{viewLabel}</span>
                    <span
                      className={`cb-notes-viewbtn-caret ${viewMenuOpen ? "is-open" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {viewMenuOpen ? (
                    <div className="cb-notes-viewmenu-pop" role="menu" aria-label="Views">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMenuOpen(false);
                          openDirectoryRoot();
                        }}
                      >
                        CavPad
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMenuOpen(false);
                          setView("cavpad");
                          if (isNarrow) setMobileView("editor");
                        }}
                      >
                        Write a note
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMenuOpen(false);
                          setView("notes");
                        }}
                      >
                        Notes
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setViewMenuOpen(false);
                          openCavPadSettings();
                        }}
                      >
                        Settings
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="cb-notes-viewmenu-trash"
                        onClick={() => {
                          setViewMenuOpen(false);
                          setView("trash");
                        }}
                      >
                        Recently deleted
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {isPhoneWriteView ? (
                <div className="cb-notes-header-titlebar">
                  {isPhoneTitleEditing ? (
                    <input
                      ref={phoneTitleInputRef}
                      className="cb-notes-titleinput cb-notes-titleinput-header"
                      value={draftTitle}
                      onChange={(e) => handleTitleChange(e.target.value)}
                      onFocus={(e) => handleTitleFocus(e.currentTarget.value)}
                      onBlur={handlePhoneTitleBlur}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          skipPhoneTitleCommitRef.current = true;
                          setDraftTitle(activeDocTitle);
                          setIsPhoneTitleEditing(false);
                          e.currentTarget.blur();
                          return;
                        }
                        if (e.key !== "Enter" || e.repeat || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        e.currentTarget.blur();
                      }}
                      placeholder="Untitled"
                      aria-label="Note title"
                      autoComplete="off"
                    />
                  ) : (
                    <button
                      type="button"
                      className="cb-notes-header-titlebtn"
                      onClick={() => setIsPhoneTitleEditing(true)}
                      aria-label="Edit note title"
                      title={phoneHeaderTitle}
                    >
                      <span className="cb-notes-header-titletext">{phoneHeaderTitle}</span>
                    </button>
                  )}
                </div>
              ) : (
                null
              )}

              {!isPhoneWriteView ? (
                <div className="cb-notes-header-search" data-cavpad-search-wrap="true">
                  <input
                    className="cb-notes-header-search-input"
                    value={globalSearchQuery}
                    onChange={(e) => {
                      setGlobalSearchQuery(e.target.value);
                      setGlobalSearchOpen(true);
                    }}
                    onFocus={() => setGlobalSearchOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (globalSearchResults[0]) openSearchResult(globalSearchResults[0]);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setGlobalSearchOpen(false);
                      }
                    }}
                    placeholder="Search CavPad"
                    aria-label="Search CavPad"
                  />
                  {globalSearchOpen && globalSearchQuery.trim() ? (
                    <div className="cb-notes-header-search-pop" role="listbox" aria-label="CavPad search results">
                      {globalSearchResults.length ? (
                        globalSearchResults.map((row) => (
                          <button
                            key={row.key}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="cb-notes-header-search-item"
                            onClick={() => openSearchResult(row)}
                          >
                            <span className="cb-notes-header-search-item-label">{row.label}</span>
                            <span className="cb-notes-header-search-item-sub">{row.sublabel}</span>
                          </button>
                        ))
                      ) : (
                        <div className="cb-notes-header-search-empty">No matches in CavPad.</div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button className="cb-notes-newbtn" type="button" onClick={openCreateChooser} aria-label="Create" title="Create">
                <Image
                  src="/icons/cavpad/edit-ui-svgrepo-com.svg"
                  alt=""
                  width={16}
                  height={16}
                  className="cb-notes-newbtn-icon"
                  aria-hidden="true"
                  unoptimized
                />
              </button>
            </div>
          </div>
        </div>

        <div className="cb-divider cb-divider-full" />

        {view === "settings" ? (
          <div className="cb-notes-settings">
            <div className="cb-notes-settings-card">
              <div className="cb-notes-settings-head">
                <div className="cb-notes-settings-title">CavPad Settings</div>
                <div className="cb-notes-settings-sub">
                  {cavsafeEnabled
                    ? "Choose where notes sync. CavCloud and CavSafe sync are opt-in."
                    : "Choose where notes sync. CavSafe is locked on Free tier."}
                </div>
              </div>

              <div className="cb-notes-setting-group">
                <div className="cb-notes-setting-label">Theme</div>
                <div className="cb-notes-theme-row cb-notes-theme-row-themes">
                  {CAVPAD_THEME_OPTIONS.map((themeOption) => (
                    <button
                      key={themeOption.value}
                      type="button"
                      className={`cb-notes-themebtn cb-notes-themebtn-compact ${settings.theme === themeOption.value ? "is-on" : ""}`}
                      data-theme={themeOption.value}
                      onClick={() => setSettings({ ...settings, theme: themeOption.value })}
                    >
                      <span className="cb-notes-theme-swatch" aria-hidden="true" />
                      <span className="cb-notes-theme-label">{themeOption.label}</span>
                      <span className="cb-notes-theme-check" aria-hidden="true">✓</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="cb-notes-setting-group">
                <div className="cb-notes-setting-label">Sync Targets</div>
                <div className="cb-notes-toggle-grid">
                  <label className="cb-notes-toggle">
                    <span className="cb-notes-toggle-copy">
                      <span className="cb-notes-toggle-title">Sync to CavCloud Files</span>
                      <span className="cb-notes-toggle-sub">Send notes as .txt files into CavCloud/Synced/CavPad.</span>
                    </span>
                    <span className="cb-notes-toggle-ctrl">
                      <input
                        type="checkbox"
                        checked={settings.syncToCavcloud}
                        onChange={(e) => {
                          setSettings({ ...settings, syncToCavcloud: e.currentTarget.checked });
                          onToast(e.currentTarget.checked ? "Sync to CavCloud enabled." : "Sync to CavCloud disabled.", "good");
                        }}
                      />
                      <span className="cb-notes-toggle-track" aria-hidden="true">
                        <span className="cb-notes-toggle-thumb" />
                      </span>
                      <span className="cb-notes-toggle-state" aria-hidden="true">
                        {settings.syncToCavcloud ? "On" : "Off"}
                      </span>
                    </span>
                  </label>

                  <label className="cb-notes-toggle">
                    <span className="cb-notes-toggle-copy">
                      <span className="cb-notes-toggle-title">Sync to CavSafe Files</span>
                      <span className="cb-notes-toggle-sub">
                        {cavsafeEnabled
                          ? "Send notes as .txt files into CavSafe/Synced/CavPad."
                          : "Locked on Free tier."}
                      </span>
                    </span>
                    <span className="cb-notes-toggle-ctrl">
                      <input
                        type="checkbox"
                        checked={cavsafeEnabled ? settings.syncToCavsafe : false}
                        disabled={!cavsafeEnabled}
                        onChange={(e) => {
                          if (!cavsafeEnabled) {
                            onToast("CavSafe is unavailable on Free tier.", "watch");
                            return;
                          }
                          setSettings({ ...settings, syncToCavsafe: e.currentTarget.checked });
                          onToast(e.currentTarget.checked ? "Sync to CavSafe enabled." : "Sync to CavSafe disabled.", "good");
                        }}
                      />
                      <span className="cb-notes-toggle-track" aria-hidden="true">
                        <span className="cb-notes-toggle-thumb" />
                      </span>
                      <span className="cb-notes-toggle-state" aria-hidden="true">
                        {cavsafeEnabled && settings.syncToCavsafe ? "On" : "Off"}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="cb-notes-setting-group">
                <div className="cb-notes-setting-label">Sharing defaults</div>
                <label className="cb-notes-toggle">
                  <span className="cb-notes-toggle-copy">
                    <span className="cb-notes-toggle-title">Allow sharing</span>
                    <span className="cb-notes-toggle-sub">Enable or disable sharing flows for CavPad notes.</span>
                  </span>
                  <span className="cb-notes-toggle-ctrl">
                    <input
                      type="checkbox"
                      checked={settings.allowSharing}
                      onChange={(e) => setSettings({ ...settings, allowSharing: e.currentTarget.checked })}
                    />
                    <span className="cb-notes-toggle-track" aria-hidden="true">
                      <span className="cb-notes-toggle-thumb" />
                    </span>
                    <span className="cb-notes-toggle-state" aria-hidden="true">
                      {settings.allowSharing ? "On" : "Off"}
                    </span>
                  </span>
                </label>
                <div className="cb-notes-setting-stack cb-notes-setting-stack-compact">
                  <div className="cb-notes-setting-block cb-notes-setting-block-row">
                    <div className="cb-notes-setting-row-copy">
                      <div className="cb-notes-setting-row-title">Default permission</div>
                    </div>
                    <div className="cb-notes-segment-row cb-notes-segment-row-compact" role="group" aria-label="Default permission">
                      <button
                        type="button"
                        className={`cb-notes-segment-btn cb-notes-segment-btn-compact ${settings.defaultSharePermission === "VIEW" ? "is-on" : ""}`}
                        onClick={() => setSettings({ ...settings, defaultSharePermission: "VIEW" })}
                        aria-pressed={settings.defaultSharePermission === "VIEW"}
                      >
                        <span className="cb-notes-segment-label cb-notes-segment-label-viewonly">View-only</span>
                      </button>
                      <button
                        type="button"
                        className={`cb-notes-segment-btn cb-notes-segment-btn-compact ${settings.defaultSharePermission === "EDIT" ? "is-on" : ""}`}
                        onClick={() => setSettings({ ...settings, defaultSharePermission: "EDIT" })}
                        aria-pressed={settings.defaultSharePermission === "EDIT"}
                      >
                        <span className="cb-notes-segment-label">Edit</span>
                      </button>
                    </div>
                  </div>

                  <div className="cb-notes-setting-block cb-notes-setting-block-row">
                    <div className="cb-notes-setting-row-copy">
                      <div className="cb-notes-setting-row-title">Default share expiry</div>
                    </div>
                    <div className="cb-notes-segment-row cb-notes-segment-row-expiry cb-notes-segment-row-compact" role="group" aria-label="Default share expiry">
                      {[
                        { key: 0 as const, label: "None" },
                        { key: 7 as const, label: "7d" },
                        { key: 30 as const, label: "30d" },
                      ].map((row) => (
                        <button
                          key={row.key}
                          type="button"
                          className={`cb-notes-segment-btn cb-notes-segment-btn-compact ${settings.defaultShareExpiryDays === row.key ? "is-on" : ""}`}
                          onClick={() => setSettings({ ...settings, defaultShareExpiryDays: row.key })}
                          aria-pressed={settings.defaultShareExpiryDays === row.key}
                        >
                          <span className="cb-notes-segment-label">{row.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cb-notes-setting-group">
                <div className="cb-notes-setting-label">Editor</div>
                <label className="cb-notes-toggle">
                  <span className="cb-notes-toggle-copy">
                    <span className="cb-notes-toggle-title">Editor grid lines</span>
                    <span className="cb-notes-toggle-sub">Add subtle line guides behind your notes while writing.</span>
                  </span>
                  <span className="cb-notes-toggle-ctrl">
                    <input
                      type="checkbox"
                      checked={settings.gridLines}
                      onChange={(e) => setSettings({ ...settings, gridLines: e.currentTarget.checked })}
                    />
                    <span className="cb-notes-toggle-track" aria-hidden="true">
                      <span className="cb-notes-toggle-thumb" />
                    </span>
                    <span className="cb-notes-toggle-state" aria-hidden="true">
                      {settings.gridLines ? "On" : "Off"}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        ) : view === "details" ? (
          <div className="cb-notes-settings">
            <div className="cb-notes-settings-card">
              <div className="cb-notes-settings-head">
                <div className="cb-notes-settings-title">{detailsFolder ? "Folder Info" : "Note Details"}</div>
                <div className="cb-notes-settings-sub">
                  {detailsNote || detailsFolder
                    ? "Metadata, sharing status, and collaboration footprint."
                    : "Select a note or folder from CavPad."}
                </div>
              </div>
              {detailsNote ? (
                <div className="cb-notes-setting-group">
                  <div className="cb-notes-setting-label">Name</div>
                  <div className="cb-notes-toggle-sub">{detailsNote.title || "Untitled"}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Owner</div>
                  <div className="cb-notes-toggle-sub">
                    {resolveIdentityLabel({
                      displayName: detailsNote.ownerDisplayName,
                      username: detailsNote.ownerUsername,
                      email: detailsNote.ownerEmail,
                      userId: detailsNote.ownerUserId,
                      usernameStyle: "at",
                    })}
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Created</div>
                  <div className="cb-notes-toggle-sub">{fmtTime(detailsNote.createdAt)}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Last updated</div>
                  <div className="cb-notes-toggle-sub">{fmtTime(detailsNote.updatedAt)}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Origin site</div>
                  <div className="cb-notes-toggle-sub">{detailsOriginSite}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Location</div>
                  <div className="cb-notes-toggle-sub">{detailsLocation}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">CavCloud sync</div>
                  <div className="cb-notes-toggle-sub">{detailsCavcloudSync}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">CavSafe sync</div>
                  <div className="cb-notes-toggle-sub">{detailsCavsafeSync}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Status</div>
                  <div className="cb-notes-toggle-sub">
                    {detailsStatusLabel}
                    {detailsNote.collab ? ` · ${detailsNote.collaboratorCount || 1} collaborators` : ""}
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Sharing</div>
                  {(detailsNote.accessList || []).length ? (
                    <div className="cb-notes-toggle-sub">
                      {(detailsNote.accessList || []).map((row) => {
                        const who = resolveIdentityLabel({
                          displayName: row.displayName,
                          username: row.username,
                          email: row.email,
                          userId: row.userId,
                          usernameStyle: "at",
                        });
                        const expiry = row.expiresAt ? ` · expires ${new Date(row.expiresAt).toLocaleDateString()}` : "";
                        return `${who} (${row.permission.toLowerCase()})${expiry}`;
                      }).join("\n")}
                    </div>
                  ) : (
                    <div className="cb-notes-toggle-sub">Not shared.</div>
                  )}
                  <div style={{ height: 16 }} />
                  <div className="cb-notes-setting-label">Recent change</div>
                  <div className="cb-notes-toggle-sub">
                    {detailsNote.lastChangeAt
                      ? `${resolveIdentityLabel({
                        displayName: detailsNote.lastChangeDisplayName || detailsNote.ownerDisplayName,
                        username: detailsNote.lastChangeUsername || detailsNote.ownerUsername,
                        email: detailsNote.lastChangeEmail || detailsNote.ownerEmail,
                        userId: detailsNote.lastChangeUserId || detailsNote.ownerUserId,
                        usernameStyle: "at",
                      })} made a change at ${fmtTime(detailsNote.lastChangeAt)}`
                      : "No revision record yet."}
                  </div>
                  <div style={{ height: 16 }} />
                  <div className="cb-notes-setting-label">Version history</div>
                  {detailsVersionsBusy ? (
                    <div className="cb-notes-toggle-sub">Loading versions...</div>
                  ) : detailsVersions.length ? (
                    <div>
                      <div className="cb-cavpad-version-controls">
                        <input
                          className="cb-cavpad-version-search"
                          value={detailsVersionQuery}
                          onChange={(e) => setDetailsVersionQuery(e.currentTarget.value)}
                          placeholder="Search versions or editors"
                          aria-label="Search version history"
                        />
                        <span className="cb-cavpad-version-count">
                          {filteredDetailsVersions.length} of {detailsVersions.length}
                        </span>
                      </div>
                      {filteredDetailsVersions.length ? (
                        <div className="cb-cavpad-version-list" role="list" aria-label="Version history list">
                          {filteredDetailsVersions.map((row) => {
                            const operator = resolveIdentityLabel({
                              displayName: row.createdByDisplayName,
                              username: row.createdByUsername,
                              email: row.createdByEmail,
                              userId: row.createdByUserId,
                              usernameStyle: "at",
                            });
                            const isCurrentVersion = row.id === currentDetailsVersionId;
                            return (
                              <div key={row.id} className="cb-cavpad-version-row" role="listitem">
                                <div className="cb-cavpad-version-row-main">
                                  <span className={`cb-cavpad-version-id${isCurrentVersion ? " is-current" : ""}`}>
                                    v{row.versionNumber}
                                  </span>
                                  <span className="cb-cavpad-version-operator">{operator}</span>
                                </div>
                                <div className="cb-cavpad-version-row-meta">
                                  {fmtEditedTime(safeNumDate(row.createdAtISO))}
                                </div>
                                <button
                                  type="button"
                                  className="cb-cavpad-version-restore"
                                  aria-label="Restore version"
                                  title="Restore version"
                                  onClick={() => restoreDetailsVersion(row.id)}
                                >
                                  <span className="cb-cavpad-version-restore-icon" aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="cb-notes-toggle-sub">No versions match this search.</div>
                      )}
                    </div>
                  ) : (
                    <div className="cb-notes-toggle-sub">No saved versions yet.</div>
                  )}
                  <div style={{ height: 16 }} />
                  <div className="cb-link-modal-actions">
                    <button
                      className="cb-linkpill cb-home-accent"
                      type="button"
                      aria-label="Open in CavPad"
                      title="Open in CavPad"
                      onClick={() => {
                        setActiveNoteId(detailsNote.id);
                        setView("cavpad");
                      }}
                    >
                      <span className="cb-cavpad-open-edit-icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : detailsFolder ? (
                <div className="cb-notes-setting-group">
                  <div className="cb-notes-setting-label">Name</div>
                  <div className="cb-notes-toggle-sub">{detailsFolder.name || "Untitled folder"}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Owner</div>
                  <div className="cb-notes-toggle-sub">{detailsOwnerLabel}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Created</div>
                  <div className="cb-notes-toggle-sub">{fmtTime(detailsFolder.createdAt)}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Last updated</div>
                  <div className="cb-notes-toggle-sub">{fmtTime(detailsFolder.updatedAt)}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Location</div>
                  <div className="cb-notes-toggle-sub">{detailsFolderLocation}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">CavCloud sync</div>
                  <div className="cb-notes-toggle-sub">{detailsFolderCavcloudSync}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">CavSafe sync</div>
                  <div className="cb-notes-toggle-sub">{detailsCavsafeSync}</div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Status</div>
                  <div className="cb-notes-toggle-sub">
                    {detailsFolderStatusLabel}
                    {detailsFolderAccess.length ? ` · ${detailsFolderAccess.length} collaborators` : ""}
                  </div>
                  <div style={{ height: 10 }} />
                  <div className="cb-notes-setting-label">Sharing</div>
                  {detailsFolderAccessBusy ? (
                    <div className="cb-notes-toggle-sub">Loading sharing...</div>
                  ) : detailsFolderAccess.length ? (
                    <div className="cb-notes-toggle-sub">
                      {detailsFolderAccess
                        .map((row) => {
                          const who = resolveIdentityLabel({
                            displayName: row.displayName,
                            username: row.username,
                            email: row.email,
                            userId: row.userId,
                            usernameStyle: "at",
                          });
                          const expiry = row.expiresAtISO
                            ? ` · expires ${new Date(row.expiresAtISO).toLocaleDateString()}`
                            : "";
                          return `${who} (${row.permission.toLowerCase()})${expiry}`;
                        })
                        .join("\n")}
                    </div>
                  ) : (
                    <div className="cb-notes-toggle-sub">Not shared.</div>
                  )}
                  <div style={{ height: 16 }} />
                  <div className="cb-notes-setting-label">Recent change</div>
                  <div className="cb-notes-toggle-sub">{detailsFolderRecentChange}</div>
                  <div style={{ height: 16 }} />
                  <div className="cb-notes-setting-label">Folder footprint</div>
                  <div className="cb-cavpad-footprintGrid" role="list" aria-label="Folder footprint">
                    <div className="cb-cavpad-footprintCard" role="listitem">
                      <div className="cb-cavpad-footprintCardLabel">Direct contents</div>
                      <div className="cb-cavpad-footprintMetricRow">
                        <div className="cb-cavpad-footprintMetric">
                          <span className="cb-cavpad-footprintMetricValue">{folderChildCounts.get(detailsFolder.id) || 0}</span>
                          <span className="cb-cavpad-footprintMetricLabel">folders</span>
                        </div>
                        <div className="cb-cavpad-footprintMetric">
                          <span className="cb-cavpad-footprintMetricValue">{detailsFolderDirectFileCount}</span>
                          <span className="cb-cavpad-footprintMetricLabel">files</span>
                        </div>
                      </div>
                    </div>
                    <div className="cb-cavpad-footprintCard" role="listitem">
                      <div className="cb-cavpad-footprintCardLabel">Total hierarchy</div>
                      <div className="cb-cavpad-footprintMetricRow">
                        <div className="cb-cavpad-footprintMetric">
                          <span className="cb-cavpad-footprintMetricValue">{detailsFolderHierarchy.totalChildFolders}</span>
                          <span className="cb-cavpad-footprintMetricLabel">nested folders</span>
                        </div>
                        <div className="cb-cavpad-footprintMetric">
                          <span className="cb-cavpad-footprintMetricValue">{detailsFolderTotalFileCount}</span>
                          <span className="cb-cavpad-footprintMetricLabel">files</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ height: 16 }} />
                  <div className="cb-link-modal-actions">
                    <button
                      className="cb-linkpill cb-home-accent"
                      type="button"
                      aria-label={detailsFolderOpenLabel}
                      title={detailsFolderOpenLabel}
                      onClick={() => {
                        openDirectory(detailsFolder.id);
                        setView("directories");
                      }}
                    >
                      {detailsFolderOpenLabel}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : view === "notes" ? (
          <div className="cb-notes-directories">
            <div className="cb-notes-directories-card">
              {hasLibrarySelection ? (
                <div className="cb-cavpad-selectbar cb-cavpad-directories-selectbar" role="toolbar" aria-label="Notes selection controls">
                  <button
                    className={`cavcloud-rowAction is-icon cavcloud-bulkSelectVisibleBtn cb-cavpad-selectall-btn ${allLibrarySelected ? "is-on" : ""}`}
                    type="button"
                    onClick={toggleSelectAllLibrary}
                    aria-label={allLibrarySelected ? "Clear notes selection" : "Select all notes"}
                    title={allLibrarySelected ? "Clear selection" : "Select all"}
                    disabled={libraryNotes.length === 0}
                    data-desktop-select-preserve="true"
                  >
                    <Image
                      src={allLibrarySelected ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg"}
                      alt=""
                      width={16}
                      height={16}
                      className="cavcloud-bulkSelectVisibleIcon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <span className="cb-cavpad-selectcount" aria-live="polite">
                    {selectedLibraryNoteIds.length} selected
                  </span>
                  <div
                    className="cavcloud-trashMenuWrap cb-cavpad-section-menu"
                    data-cavpad-note-menu-wrap="true"
                    data-desktop-select-preserve="true"
                  >
                    <button
                      className={`cavcloud-rowAction is-icon cavcloud-galleryMoreBtn ${libraryActionsMenuOpen ? "is-on" : ""}`}
                      type="button"
                      onClick={() => setLibraryActionsMenuOpen((prev) => !prev)}
                      aria-label="Selected note actions"
                      title="Selected note actions"
                    >
                      <CavPadKebabIcon />
                    </button>
                    {libraryActionsMenuOpen ? (
                      <div className="cavcloud-trashActionMenu" role="menu" aria-label="Actions for selected notes">
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction}
                          onClick={openSelectedLibraryNote}
                        >
                          Open
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          onClick={toggleSelectedLibraryPin}
                        >
                          {libraryPinActionLabel}
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction}
                          onClick={moveSelectedLibraryNoteToDirectory}
                        >
                          Move
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction}
                          onClick={openShareForSelectedLibraryNote}
                        >
                          Collaborate
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction}
                          onClick={() => exportSelectedLibraryNote("cavcloud")}
                        >
                          Export to CavCloud
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction || !cavsafeEnabled}
                          onClick={() => exportSelectedLibraryNote("cavsafe")}
                          title={cavsafeEnabled ? "Export to CavSafe" : "CavSafe is locked on Free tier"}
                        >
                          Export to CavSafe
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem"
                          type="button"
                          disabled={!canRunSingleLibraryAction}
                          onClick={openDetailsForSelectedLibraryNote}
                        >
                          File Info
                        </button>
                        <button
                          className="cavcloud-trashActionMenuItem is-danger"
                          type="button"
                          disabled={!hasLibrarySelection}
                          onClick={deleteSelectedLibraryNotes}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {libraryNotes.length === 0 ? (
                <div className="cb-cavpad-directories-emptywrap">
                  <div className="cb-cavpad-directories-emptytitle">No notes yet</div>
                  <div className="cb-cavpad-directories-emptysub">Create notes and manage them like files here.</div>
                </div>
              ) : (
                <div className="cb-cavpad-desktop-grid cb-cavpad-directories-grid" role="list" aria-label="Notes library">
                  {libraryNotes.map((note) => {
                    const isSelected = selectedLibraryNoteIds.includes(note.id);
                    const hasSharedBadge = note.shared || note.status === "shared" || note.status === "collab";
                    const hasCollabBadge = note.collab || note.status === "collab" || (note.editorsCount || 0) > 1;
                    const noteDateLabel = fmtDateOnly(note.updatedAt);
                    const noteTimeLabel = fmtTimeOnly(note.updatedAt);
                    const noteDirectoryLabel = note.folderId
                      ? directoryPathById.get(note.folderId) || "Directory"
                      : "";
                    return (
                      <div
                        key={note.id}
                        className={`cb-cavpad-desktop-card cb-cavpad-directory-card ${isSelected ? "is-selected" : ""}`}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="cb-cavpad-desktop-tile cb-cavpad-directory-tile cb-cavpad-note-library-tile"
                          data-desktop-select-item="true"
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            toggleLibrarySelection(note.id);
                          }}
                          onDoubleClick={() => {
                            setActiveNoteId(note.id);
                            setView("cavpad");
                          }}
                          aria-pressed={isSelected}
                          aria-label={`Select note ${note.title || "Untitled"}. Double-click to open.`}
                          title={note.title || "Untitled"}
                        >
                          <span
                            className="cb-cavpad-desktop-iconbox cb-cavpad-desktop-iconbox-note cb-cavpad-desktop-iconbox-note-library"
                            aria-hidden="true"
                          >
                            <Image
                              src="/icons/cavpad/sticky-notes-1-svgrepo-com.svg"
                              alt=""
                              width={108}
                              height={108}
                              className="cb-cavpad-desktop-icon cb-cavpad-desktop-note-icon"
                              unoptimized
                            />
                          </span>
                          <span className="cb-cavpad-desktop-name">{note.title || "Untitled"}</span>
                          <span className="cb-cavpad-desktop-meta cb-cavpad-desktop-meta-note">
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {noteDateLabel}
                            </span>
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {noteTimeLabel}
                            </span>
                            {noteDirectoryLabel ? (
                              <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-folder">
                                {noteDirectoryLabel}
                              </span>
                            ) : null}
                            {hasSharedBadge || hasCollabBadge ? (
                              <span className="cb-cavpad-desktop-meta-badges">
                                {hasSharedBadge ? <span className="cb-cavpad-desktop-meta-tag">Shared</span> : null}
                                {hasCollabBadge ? <span className="cb-cavpad-desktop-meta-tag">Collab</span> : null}
                              </span>
                            ) : null}
                          </span>
                          {note.pinnedAt || hasSharedBadge ? (
                            <span className="cb-cavpad-card-corner-icons" aria-hidden="true">
                              {hasSharedBadge ? <span className="cb-cavpad-card-sharemark" /> : null}
                              {note.pinnedAt ? <span className="cb-cavpad-card-pinmark" /> : null}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : view === "directories" ? (
          <div className="cb-notes-directories">
            <div className="cb-notes-directories-card">
              <div className="cb-cavpad-directory-toolbar" aria-label="Directory section controls">
                <div className="cb-cavpad-directory-toolbar-left">
                  {normalizedDirectoryViewFolderId !== CAVPAD_DIRECTORY_ROOT ? (
                    <button
                      type="button"
                      className="cb-cavpad-directory-backbtn"
                      onClick={openDirectoryRoot}
                      aria-label="Back to CavPad"
                      title="Back to CavPad"
                    >
                      <Image
                        src="/icons/back-svgrepo-com.svg"
                        alt=""
                        width={14}
                        height={14}
                        className="cb-cavpad-directory-backbtn-icon"
                        aria-hidden="true"
                        unoptimized
                      />
                    </button>
                  ) : null}
                  <div className="cb-notes-iconselect cb-notes-iconselect-filter cb-cavpad-directory-section-filter">
                    <Image
                      src="/icons/app/filter-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-iconselect-glyph"
                      aria-hidden="true"
                      unoptimized
                    />
                    <select
                      className="cb-notes-select-overlay cb-cavpad-directory-section-select"
                      value={directorySection}
                      onChange={(event) => setDirectorySection(event.currentTarget.value as CavPadDirectorySection)}
                      aria-label="Choose directory section"
                      title="Choose directory section"
                    >
                      {CAVPAD_DIRECTORY_SECTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <span className="cb-cavpad-directory-toolbar-meta" aria-live="polite">
                  <span
                    className="cb-cavpad-directory-toolbar-counts"
                    aria-label={`${directoryCurrentLabel} ${directoryCountsLabel}`}
                    title={directoryCurrentLabel}
                  >
                    {directoryCountsLabel}
                  </span>
                </span>
              </div>
              {directoryBreadcrumbs.length > 1 ? (
                <div className="cb-cavpad-directory-pathbar" aria-label="Directory path">
                  <div className="cb-cavpad-directory-breadcrumbs" role="navigation" aria-label="Directory breadcrumbs">
                    {directoryBreadcrumbs.map((crumb, index) => (
                      <React.Fragment key={`${crumb.id}:${index}`}>
                        {index > 0 ? <span className="cb-cavpad-directory-crumb-sep" aria-hidden="true">/</span> : null}
                        <button
                          type="button"
                          className={`cb-cavpad-directory-crumb ${crumb.id === normalizedDirectoryViewFolderId ? "is-active" : ""}`}
                          onClick={() => openDirectory(crumb.id)}
                          disabled={crumb.id === normalizedDirectoryViewFolderId}
                          aria-current={crumb.id === normalizedDirectoryViewFolderId ? "page" : undefined}
                          title={crumb.label}
                        >
                          {crumb.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ) : null}

              {hasDirectorySelection || hasDirectoryNoteSelection ? (
                <div className="cb-cavpad-selectbar cb-cavpad-directories-selectbar" role="toolbar" aria-label="Directory selection controls">
                  <button
                    className={`cavcloud-rowAction is-icon cavcloud-bulkSelectVisibleBtn cb-cavpad-selectall-btn ${
                      hasDirectoryNoteSelection ? (allDirectoryNotesSelected ? "is-on" : "") : (allDirectoriesSelected ? "is-on" : "")
                    }`}
                    type="button"
                    onClick={hasDirectoryNoteSelection ? toggleSelectAllDirectoryNotes : toggleSelectAllDirectories}
                    aria-label={
                      hasDirectoryNoteSelection
                        ? (allDirectoryNotesSelected ? "Clear file selection" : "Select all files in this folder")
                        : (allDirectoriesSelected ? "Clear directory selection" : "Select all directories in this folder")
                    }
                    title={
                      hasDirectoryNoteSelection
                        ? (allDirectoryNotesSelected ? "Clear file selection" : "Select all files")
                        : (allDirectoriesSelected ? "Clear directory selection" : "Select all directories")
                    }
                    disabled={hasDirectoryNoteSelection ? directoryScopedNotes.length === 0 : directoryScopedFolders.length === 0}
                    data-desktop-select-preserve="true"
                  >
                    <Image
                      src={
                        hasDirectoryNoteSelection
                          ? (allDirectoryNotesSelected ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg")
                          : (allDirectoriesSelected ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg")
                      }
                      alt=""
                      width={16}
                      height={16}
                      className="cavcloud-bulkSelectVisibleIcon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>

                  <span className="cb-cavpad-selectcount" aria-live="polite">
                    {directorySelectionCount} selected
                  </span>

                  <div
                    className="cavcloud-trashMenuWrap cb-cavpad-section-menu"
                    data-cavpad-directory-menu-wrap="true"
                    data-desktop-select-preserve="true"
                  >
                    <button
                      className={`cavcloud-rowAction is-icon cavcloud-galleryMoreBtn ${directoryActionsMenuOpen ? "is-on" : ""}`}
                      type="button"
                      onClick={() => setDirectoryActionsMenuOpen((prev) => !prev)}
                      aria-label="Selected directory actions"
                      title="Selected directory actions"
                    >
                      <CavPadKebabIcon />
                    </button>
                    {directoryActionsMenuOpen ? (
                      <div className="cavcloud-trashActionMenu" role="menu" aria-label="Actions for selected directories">
                        {hasDirectoryNoteSelection ? (
                          <>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction}
                              onClick={openSelectedDirectoryNote}
                            >
                              Open
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!hasDirectoryNoteSelection}
                              onClick={toggleSelectedDirectoryNotePin}
                            >
                              {directoryNotePinActionLabel}
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction}
                              onClick={moveSelectedDirectoryNoteToDirectory}
                            >
                              Move
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction}
                              onClick={openShareForSelectedDirectoryNote}
                            >
                              Collaborate
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction}
                              onClick={() => exportSelectedDirectoryNote("cavcloud")}
                            >
                              Export to CavCloud
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction || !cavsafeEnabled}
                              onClick={() => exportSelectedDirectoryNote("cavsafe")}
                              title={cavsafeEnabled ? "Export to CavSafe" : "CavSafe is locked on Free tier"}
                            >
                              Export to CavSafe
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryNoteAction}
                              onClick={openDetailsForSelectedDirectoryNote}
                            >
                              File Info
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem is-danger"
                              type="button"
                              disabled={!hasDirectoryNoteSelection}
                              onClick={deleteSelectedDirectoryNotes}
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryAction}
                              onClick={openSelectedDirectory}
                            >
                              Open
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!hasDirectorySelection}
                              onClick={toggleSelectedDirectoryPin}
                            >
                              {directoryPinActionLabel}
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryAction}
                              onClick={renameSelectedDirectory}
                            >
                              Rename
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryAction}
                              onClick={openMergeDirectoryModal}
                            >
                              Merge
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryAction}
                              onClick={openShareForSelectedDirectory}
                            >
                              Collaborate
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem"
                              type="button"
                              disabled={!canRunSingleDirectoryAction}
                              onClick={openDetailsForSelectedDirectory}
                            >
                              Folder Info
                            </button>
                            <button
                              className="cavcloud-trashActionMenuItem is-danger"
                              type="button"
                              disabled={!hasDirectorySelection}
                              onClick={deleteSelectedDirectories}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {directoryScopedFolders.length === 0 && directoryScopedNotes.length === 0 ? (
                <div className="cb-cavpad-directories-emptywrap">
                  <div className="cb-cavpad-directories-emptytitle">
                    {directorySection === "folders"
                      ? "No folders here yet"
                      : directorySection === "files"
                        ? "No files here yet"
                        : normalizedDirectoryViewFolderId === CAVPAD_DIRECTORY_ROOT
                          ? "No folders or files here yet"
                          : "This directory is empty"}
                  </div>
                  <div className="cb-cavpad-directories-emptysub">
                    {directorySection === "folders"
                      ? "Create a directory or open another folder from the breadcrumb path."
                      : directorySection === "files"
                        ? "Create a note in this directory or switch to Cloud to browse all items."
                        : normalizedDirectoryViewFolderId === CAVPAD_DIRECTORY_ROOT
                      ? "Create directories and notes, then double-click folders to open deeper levels."
                      : "Open another folder from the breadcrumb path or create new items here."}
                  </div>
                </div>
              ) : (
                <div className="cb-cavpad-desktop-grid cb-cavpad-directories-grid" role="list" aria-label="Directory contents">
                  {directoryScopedFolders.map((folder) => {
                    const noteCount = folderNoteCounts.get(folder.id) || 0;
                    const childCount = folderChildCounts.get(folder.id) || 0;
                    const isSelected = selectedDirectoryIds.includes(folder.id);
                    const folderDateLabel = fmtDateOnly(folder.updatedAt);
                    const folderTimeLabel = fmtTimeOnly(folder.updatedAt);
                    return (
                      <div
                        key={folder.id}
                        className={`cb-cavpad-desktop-card cb-cavpad-directory-card ${isSelected ? "is-selected" : ""}`}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="cb-cavpad-desktop-tile cb-cavpad-directory-tile"
                          data-desktop-select-item="true"
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            toggleDirectorySelection(folder.id);
                          }}
                          onDoubleClick={() => openDirectory(folder.id)}
                          aria-pressed={isSelected}
                          aria-label={`Select directory ${folder.name}. Double-click to open.`}
                          title={`${folder.name}${isSelected ? " (selected)" : ""}`}
                        >
                          <span className="cb-cavpad-desktop-iconbox cb-cavpad-desktop-iconbox-folder" aria-hidden="true">
                            <Image
                              src="/icons/folder-svgrepo-com.svg"
                              alt=""
                              width={88}
                              height={68}
                              className="cb-cavpad-desktop-icon"
                              unoptimized
                            />
                          </span>
                          <span className="cb-cavpad-desktop-name">{folder.name}</span>
                          <span className="cb-cavpad-desktop-meta cb-cavpad-desktop-meta-directory">
                            <span className="cb-cavpad-desktop-meta-line">
                              {childCount} folder{childCount === 1 ? "" : "s"} · {noteCount} note{noteCount === 1 ? "" : "s"}
                            </span>
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {folderDateLabel}
                            </span>
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {folderTimeLabel}
                            </span>
                          </span>
                          {folder.pinnedAt ? (
                            <span className="cb-cavpad-card-corner-icons" aria-hidden="true">
                              <span className="cb-cavpad-card-pinmark" />
                            </span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}

                  {directoryScopedNotes.map((note) => {
                    const isSelected = selectedDirectoryNoteIds.includes(note.id);
                    const hasSharedBadge = note.shared || note.status === "shared" || note.status === "collab";
                    const hasCollabBadge = note.collab || note.status === "collab" || (note.editorsCount || 0) > 1;
                    const noteDateLabel = fmtDateOnly(note.updatedAt);
                    const noteTimeLabel = fmtTimeOnly(note.updatedAt);
                    return (
                      <div
                        key={note.id}
                        className={`cb-cavpad-desktop-card cb-cavpad-directory-card ${isSelected ? "is-selected" : ""}`}
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="cb-cavpad-desktop-tile cb-cavpad-directory-tile cb-cavpad-note-library-tile"
                          data-desktop-select-item="true"
                          onClick={(event) => {
                            if (event.detail > 1) return;
                            toggleDirectoryNoteSelection(note.id);
                          }}
                          onDoubleClick={() => openDirectoryNote(note.id)}
                          aria-pressed={isSelected}
                          aria-label={`Select file ${note.title || "Untitled"}. Double-click to open.`}
                          title={note.title || "Untitled"}
                        >
                          <span
                            className="cb-cavpad-desktop-iconbox cb-cavpad-desktop-iconbox-note cb-cavpad-desktop-iconbox-note-library"
                            aria-hidden="true"
                          >
                            <Image
                              src="/icons/cavpad/sticky-notes-1-svgrepo-com.svg"
                              alt=""
                              width={108}
                              height={108}
                              className="cb-cavpad-desktop-icon cb-cavpad-desktop-note-icon"
                              unoptimized
                            />
                          </span>
                          <span className="cb-cavpad-desktop-name">{note.title || "Untitled"}</span>
                          <span className="cb-cavpad-desktop-meta cb-cavpad-desktop-meta-note">
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {noteDateLabel}
                            </span>
                            <span className="cb-cavpad-desktop-meta-line cb-cavpad-desktop-meta-created">
                              {noteTimeLabel}
                            </span>
                            {hasSharedBadge || hasCollabBadge ? (
                              <span className="cb-cavpad-desktop-meta-badges">
                                {hasSharedBadge ? <span className="cb-cavpad-desktop-meta-tag">Shared</span> : null}
                                {hasCollabBadge ? <span className="cb-cavpad-desktop-meta-tag">Collab</span> : null}
                              </span>
                            ) : null}
                          </span>
                          {note.pinnedAt || hasSharedBadge ? (
                            <span className="cb-cavpad-card-corner-icons" aria-hidden="true">
                              {hasSharedBadge ? <span className="cb-cavpad-card-sharemark" /> : null}
                              {note.pinnedAt ? <span className="cb-cavpad-card-pinmark" /> : null}
                            </span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : view === "trash" ? (
          <div className={`cb-notes-trashview ${trash.length === 0 ? "cb-notes-trashview-empty" : ""}`}>
            {trash.length === 0 ? (
              <div className="cb-notes-list-empty">
                <div className="cb-home-empty-title">Recently deleted is empty</div>
                <div className="cb-home-empty-sub">Deleted notes stay here for 30 days.</div>
              </div>
            ) : (
              <div className="cb-cavpad-trash-area">
                {hasTrashSelection || trashNoticeCount > 0 ? (
                  <div className="cb-cavpad-selectbar" role="toolbar" aria-label="Recently deleted controls">
                    {hasTrashSelection ? (
                      <>
                        <button
                          className={`cavcloud-rowAction is-icon cavcloud-bulkSelectVisibleBtn cb-cavpad-selectall-btn ${allTrashSelected ? "is-on" : ""}`}
                          type="button"
                          onClick={toggleSelectAllTrash}
                          aria-label={allTrashSelected ? "Clear recently deleted selection" : "Select all recently deleted items"}
                          title={allTrashSelected ? "Clear selection" : "Select all"}
                          disabled={trash.length === 0}
                          data-desktop-select-preserve="true"
                        >
                          <Image
                            src={allTrashSelected ? "/icons/check-box-svgrepo-com.svg" : "/icons/check-box-unchecked-svgrepo-com.svg"}
                            alt=""
                            width={16}
                            height={16}
                            className="cavcloud-bulkSelectVisibleIcon"
                            aria-hidden="true"
                            unoptimized
                          />
                        </button>

                        <span className="cb-cavpad-selectcount" aria-live="polite">
                          {selectedTrashIds.length} selected
                        </span>
                      </>
                    ) : null}

                    <div
                      className="cavcloud-trashMenuWrap cb-cavpad-section-menu"
                      data-cavpad-trash-menu-wrap="true"
                      data-desktop-select-preserve="true"
                    >
                      <button
                        className={`cavcloud-trashNoticeBtn ${trashNoticeCount ? "is-on" : ""}`}
                        type="button"
                        onClick={() => {
                          setTrashActionsMenuOpen(false);
                          setTrashNoticeOpen(true);
                        }}
                        disabled={!trashNoticeCount}
                        aria-label="Open 7-day deletion notice notes"
                        title={
                          trashNoticeCount
                            ? `${trashNoticeCount} note${trashNoticeCount === 1 ? "" : "s"} on 7-day notice`
                            : "No notes on 7-day notice"
                        }
                      >
                        <CavPadTrashNoticeIcon />
                      </button>
                      {hasTrashSelection ? (
                        <>
                          <button
                            className={`cavcloud-rowAction is-icon cavcloud-galleryMoreBtn ${trashActionsMenuOpen ? "is-on" : ""}`}
                            type="button"
                            onClick={() => setTrashActionsMenuOpen((prev) => !prev)}
                            aria-label="Selected recently deleted actions"
                            title="Selected recently deleted actions"
                          >
                            <CavPadKebabIcon />
                          </button>
                          {trashActionsMenuOpen ? (
                            <div className="cavcloud-trashActionMenu" role="menu" aria-label="Actions for selected recently deleted notes">
                              <button
                                className="cavcloud-trashActionMenuItem is-cavbot-blue"
                                type="button"
                                disabled={!hasTrashSelection}
                                onClick={restoreSelectedTrash}
                              >
                                Restore
                              </button>
                              <button
                                className="cavcloud-trashActionMenuItem is-danger"
                                type="button"
                                disabled={!hasTrashSelection}
                                onClick={purgeSelectedTrash}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="cb-cavpad-desktop-grid cb-cavpad-trash-grid" role="list" aria-label="Recently deleted list">
                  {trash.map((t) => {
                    const daysLeft = trashDaysLeft[t.id] ?? 30;
                    const deletedDateLabel = fmtDeletedDateTime(t.deletedAt);
                    const isSelected = selectedTrashIds.includes(t.id);
                    return (
                      <div
                        key={t.id}
                        className={`cb-cavpad-desktop-card cb-cavpad-trash-card ${isSelected ? "is-selected" : ""}`}
                        role="listitem"
                      >
                        <span className="cb-cavpad-trash-days-badge" aria-label={`${daysLeft} days left in recently deleted`}>
                          {daysLeft}
                        </span>
                        <button
                          type="button"
                          className="cb-cavpad-desktop-tile cb-cavpad-trash-tile"
                          data-desktop-select-item="true"
                          onClick={() => toggleTrashSelection(t.id)}
                          aria-pressed={isSelected}
                          aria-label={`Select note ${t.title || "Untitled"} from recently deleted`}
                          title={`${t.title || "Untitled"}${isSelected ? " (selected)" : ""}`}
                        >
                          <span
                            className="cb-cavpad-desktop-iconbox cb-cavpad-desktop-iconbox-note cb-cavpad-desktop-iconbox-note-library"
                            aria-hidden="true"
                          >
                            <Image
                              src="/icons/cavpad/sticky-notes-1-svgrepo-com.svg"
                              alt=""
                              width={108}
                              height={108}
                              className="cb-cavpad-desktop-icon cb-cavpad-desktop-note-icon"
                              unoptimized
                            />
                          </span>
                          <span className="cb-cavpad-desktop-name">{t.title || "Untitled"}</span>
                          <span className="cb-cavpad-desktop-meta cb-cavpad-desktop-meta-note">
                            <span className="cb-cavpad-desktop-meta-line">Deleted {deletedDateLabel}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : view === "cavpad" ? (
          <div className="cb-notes-body">
            <div
              className="cb-notes-grid"
              data-mobile={isNarrow ? mobileView : "all"}
              data-fullscreen={editorFullscreen ? "1" : "0"}
            >
              {!editorFullscreen ? (
                <aside className="cb-notes-list" aria-label="Note list">
                <div className="cb-notes-search">
                  <input
                    className="cb-notes-searchInput"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search notes"
                    aria-label="Search notes"
                  />
                </div>
                {visibleNotes.length === 0 ? (
                  notesReady ? (
                    <div className="cb-notes-list-empty">
                      <div className="cb-home-empty-title">No notes yet</div>
                      <div className="cb-home-empty-sub">Create a note for decisions, or launch plans.</div>
                      <button className="cb-notes-empty-link" type="button" onClick={() => createNote()}>
                        new note
                      </button>
                    </div>
                  ) : null
                ) : (
                  <ul className="cb-notes-items">
                    {visibleNotes.map((n) => {
                      const preview = buildNotePreviewFromHtml(n.html, 110);
                      const lastEdited = fmtEditedTime(n.updatedAt);
                      const editedBy = resolveIdentityLabel({
                        displayName: n.lastChangeDisplayName || n.ownerDisplayName,
                        username: n.lastChangeUsername || n.ownerUsername,
                        email: n.lastChangeEmail || n.ownerEmail,
                        userId: n.lastChangeUserId || n.ownerUserId,
                      });
                      const hasSharedBadge = n.shared || n.status === "shared" || n.status === "collab";
                      const hasPinnedBadge = Boolean(n.pinnedAt);
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            className={`cb-notes-item ${n.id === activeDoc?.id ? "is-on" : ""}`}
                            onClick={() => setActiveNoteId(n.id)}
                            aria-current={n.id === activeDoc?.id ? "true" : "false"}
                          >
                            <div className="cb-notes-item-titleRow">
                              <div className="cb-notes-title">{n.title || "Untitled"}</div>
                              <span className="cb-notes-item-icons" aria-hidden="true">
                                <span className={`cb-notes-item-sharemark ${hasSharedBadge ? "is-visible" : ""}`} />
                                <span className={`cb-notes-item-pinmark ${hasPinnedBadge ? "is-visible" : ""}`} />
                              </span>
                            </div>

                            <div className="cb-notes-item-sub">{preview}</div>
                            <div className="cb-notes-item-meta">Last edited {lastEdited} by {editedBy}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                </aside>
              ) : null}

              <main className="cb-notes-editorwrap" aria-label="Editor">
                <div className="cb-notes-editorhead">
                  {!isPhoneWriteView ? (
                    <div className="cb-notes-titlebar">
                      <input
                        className="cb-notes-titleinput"
                        value={draftTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        onFocus={(e) => handleTitleFocus(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" || e.repeat || e.nativeEvent.isComposing) return;
                          if (activeDocId) return;
                          const seededTitle = clampStr(draftTitle, 80).trim();
                          if (!seededTitle) return;
                          e.preventDefault();
                          createNote(seededTitle);
                        }}
                        placeholder="Untitled"
                        aria-label="Note title"
                        autoComplete="off"
                      />
                    </div>
                  ) : null}

                  {!isPhone ? (
                    <select
                      className="cb-notes-fontselect"
                      value={settings.font || "Inter"}
                      onChange={(e) => handleFontChange(e.currentTarget.value)}
                      aria-label="Font"
                    >
                      {CAVPAD_FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {!isPhone ? (
                    <select
                      className="cb-notes-formatselect"
                      value={formatMode}
                      onChange={(e) => applyFormat(e.currentTarget.value)}
                      aria-label="Format"
                    >
                      <option value="format" disabled>
                        Format
                      </option>
                      {FORMAT_PRESETS.map((preset) => (
                        <option key={preset.value} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  ) : null}

                  {!isPhone ? renderColorPicker("top") : null}

                  {activeDoc?.id && !activeDoc.pendingCreate ? (
                    <button
                      type="button"
                      className="cb-notes-tool"
                      onClick={() => openCollaborateForNote(activeDoc.id)}
                      aria-label="Collaborate"
                      title="Collaborate"
                    >
                      <Image
                        src="/icons/share-2-svgrepo-com.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="cb-notes-tool-icon"
                        aria-hidden="true"
                        unoptimized
                      />
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => setEditorFullscreen((prev) => !prev)}
                    aria-label={editorFullscreen ? "Exit full screen editor" : "Enter full screen editor"}
                    title={editorFullscreen ? "Exit full screen" : "Full screen"}
                  >
                    <Image
                      src="/icons/full-screen-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>

                  {((!isPhone) || isPhoneWriteView) && activeDoc?.id ? (
                    <button
                      type="button"
                      className="cb-notes-trash cb-notes-trash-standalone"
                      onClick={() => deleteNote(activeDoc.id)}
                      aria-label="Delete note"
                      title="Delete note"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                        <path d="M20.5 6H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                <div
                  className="cb-notes-toolbar"
                  role="toolbar"
                  aria-label="Formatting"
                  onMouseDown={handleToolbarMouseDown}
                >
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("undo")}
                    aria-label="Undo"
                    title="Undo"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        d="M10 7H5V2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M5 7c1.8-2.2 4.5-3.5 7.5-3.5 5.2 0 9.5 4.3 9.5 9.5s-4.3 9.5-9.5 9.5c-2.5 0-4.8-1-6.6-2.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("redo")}
                    aria-label="Redo"
                    title="Redo"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path
                        d="M14 7h5V2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M19 7c-1.8-2.2-4.5-3.5-7.5-3.5C6.3 3.5 2 7.8 2 13s4.3 9.5 9.5 9.5c2.5 0 4.8-1 6.6-2.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  {isPhone ? (
                    <div className="cb-notes-iconselect cb-notes-iconselect-toolbar cb-notes-iconselect-font">
                      <Image
                        src="/icons/cavpad/font-case-svgrepo-com.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="cb-notes-iconselect-glyph"
                        aria-hidden="true"
                        unoptimized
                      />
                      <select
                        className="cb-notes-select-overlay"
                        value={settings.font || "Inter"}
                        onChange={(e) => handleFontChange(e.currentTarget.value)}
                        aria-label="Font"
                        title="Font"
                      >
                        {CAVPAD_FONTS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {isPhone ? (
                    <div className="cb-notes-iconselect cb-notes-iconselect-toolbar cb-notes-iconselect-format">
                      <Image
                        src="/icons/cavpad/format-text-direction-svgrepo-com.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="cb-notes-iconselect-glyph"
                        aria-hidden="true"
                        unoptimized
                      />
                      <select
                        className="cb-notes-select-overlay"
                        value={formatMode}
                        onChange={(e) => applyFormat(e.currentTarget.value)}
                        aria-label="Format"
                        title="Format"
                      >
                        <option value="format" disabled>
                          Format
                        </option>
                        {FORMAT_PRESETS.map((preset) => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {isPhone ? renderColorPicker("toolbar") : null}

                  <span className="cb-notes-toolsep" aria-hidden="true" />

                  <button type="button" className="cb-notes-tool" onClick={() => exec("bold")} aria-label="Bold" title="Bold">
                    <Image
                      src="/icons/cavpad/bold-svgrepo-com.svg"
                      alt=""
                      width={14}
                      height={14}
                      className="cb-notes-tool-icon cb-notes-tool-icon--textstyle"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("italic")}
                    aria-label="Italic"
                    title="Italic"
                  >
                    <Image
                      src="/icons/cavpad/italic-svgrepo-com.svg"
                      alt=""
                      width={14}
                      height={14}
                      className="cb-notes-tool-icon cb-notes-tool-icon--textstyle"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("underline")}
                    aria-label="Underline"
                    title="Underline"
                  >
                    <Image
                      src="/icons/cavpad/underline-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("strikeThrough")}
                    aria-label="Strikethrough"
                    title="Strikethrough"
                  >
                    <Image
                      src="/icons/cavpad/strikethrough-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>

                  <span className="cb-notes-toolsep" aria-hidden="true" />

                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("insertUnorderedList")}
                    aria-label="Bullets"
                    title="Bullets"
                  >
                    <Image
                      src="/icons/cavpad/text-bullet-list-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("insertOrderedList")}
                    aria-label="Numbered list"
                    title="Numbered list"
                  >
                    <Image
                      src="/icons/cavpad/ordered-list-svgrepo-com.svg"
                      alt=""
                      width={24}
                      height={24}
                      className="cb-notes-tool-icon cb-notes-tool-icon--numbered"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("indent")}
                    aria-label="Indent"
                    title="Indent"
                  >
                    <Image
                      src="/icons/cavpad/indent-increase-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("outdent")}
                    aria-label="Outdent"
                    title="Outdent"
                  >
                    <Image
                      src="/icons/cavpad/indent-decrease-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("formatBlock", "blockquote")}
                    aria-label="Quote"
                    title="Quote"
                  >
                    <Image
                      src="/icons/cavpad/quote-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("formatBlock", "pre")}
                    aria-label="Code block"
                    title="Code block"
                  >
                    <Image
                      src="/icons/cavpad/code-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => insertTable()}
                    aria-label="Insert table"
                    title="Insert table"
                  >
                    <Image
                      src="/icons/cavpad/insert-table-svgrepo-com.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="cb-notes-tool-icon"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>

                  <span className="cb-notes-toolsep" aria-hidden="true" />

                  <div className="cb-notes-upload-wrapper">
                    <button
                      ref={uploadButtonRef}
                      type="button"
                      className="cb-notes-tool"
                      onClick={() => setUploadMenuOpen((prev) => !prev)}
                      aria-label="Upload files"
                      aria-haspopup="menu"
                      aria-expanded={uploadMenuOpen}
                      title="Upload attachments"
                    >
                      <Image
                        src="/icons/cavpad/upload-svgrepo-com.svg"
                        alt=""
                        width={16}
                        height={16}
                        className="cb-notes-tool-icon"
                        aria-hidden="true"
                        unoptimized
                      />
                    </button>
                    {uploadMenuOpen ? (
                      <div
                        className="cb-notes-upload-dropdown"
                        role="menu"
                        aria-label="Upload attachment"
                        ref={uploadMenuRef}
                      >
                        {([
                          { kind: "image", label: "Image" },
                          { kind: "video", label: "Video" },
                          { kind: "file", label: "File" },
                        ] as { kind: CavPadAttachmentKind; label: string }[]).map((item) => (
                          <button
                            key={item.kind}
                            type="button"
                            className="cb-notes-upload-dropdown-option"
                            role="menuitem"
                            onClick={() => handleUploadOption(item.kind)}
                            aria-label={`Upload ${item.label}`}
                          >
                            <span>{item.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={makeLink}
                    onMouseDown={handleLinkButtonMouseDown}
                    aria-label="Link"
                    title="Link"
                  >
                    <Image
                      src="/icons/cavpad/link-1-svgrepo-com.svg"
                      alt=""
                      width={18}
                      height={18}
                      className="cb-notes-tool-icon cb-notes-tool-icon--linkclear"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                  <button
                    type="button"
                    className="cb-notes-tool"
                    onClick={() => exec("removeFormat")}
                    aria-label="Clear formatting"
                    title="Clear formatting"
                  >
                    <Image
                      src="/icons/cavpad/clear-character-svgrepo-com.svg"
                      alt=""
                      width={18}
                      height={18}
                      className="cb-notes-tool-icon cb-notes-tool-icon--linkclear"
                      aria-hidden="true"
                      unoptimized
                    />
                  </button>
                </div>

                <div className="cb-notes-editorbox">
                  <div
                    className={`cb-notes-editor ${editorEmpty ? "is-empty" : ""} ${
                      formatMode === "monostyled" ? "monostyled" : ""
                    }`}
                    ref={editorRef}
                    data-notes-editor="true"
                    data-placeholder=""
                    data-editor-active={editorActive ? "1" : "0"}
                    contentEditable={editorActive}
                    suppressContentEditableWarning
                    onInput={onEditorInput}
                    onPaste={onEditorPaste}
                    onFocus={handleEditorFocus}
                    onBlur={handleEditorBlur}
                    onMouseDown={handleEditorMouseDown}
                    onKeyDown={handleEditorKeyDown}
                    spellCheck
                    role="textbox"
                    aria-label="Note editor"
                    onKeyUp={handleEditorKeyUp}
                  />

                  <div className="cb-notes-editor-controls" ref={cavAiControlsRef}>
                    <div className={`cb-notes-editor-control ${cavAiControlMenu === "model" ? "is-open" : ""}`}>
                      <button
                        type="button"
                        className="cb-notes-editor-control-btn cb-notes-editor-control-btn--plain"
                        onClick={() => {
                          setCavAiDraftMenuOpen(false);
                          setCavAiControlMenu((prev) => (prev === "model" ? null : "model"));
                        }}
                        aria-label={`Model selector. Current model: ${cavAiModelLabel}`}
                        aria-haspopup="menu"
                        aria-expanded={cavAiControlMenu === "model"}
                        title={`Model: ${cavAiModelLabel}`}
                      >
                        <Image
                          src="/icons/app/cavcode/3d-modelling-round-820-svgrepo-com.svg"
                          alt=""
                          width={16}
                          height={16}
                          className="cb-notes-tool-icon cb-notes-tool-icon--editor-control"
                          aria-hidden="true"
                          unoptimized
                        />
                      </button>
                      {cavAiControlMenu === "model" ? (
                        <div className="cb-notes-editor-control-menu" role="menu" aria-label="Model selector">
                          {cavAiModelOptions.map((option) => {
                            const isOn = option.id === cavAiModelId;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                className={`cb-notes-editor-control-item ${isOn ? "is-on" : ""}`}
                                role="menuitemradio"
                                aria-checked={isOn}
                                onClick={() => {
                                  setCavAiModelId(option.id);
                                  setCavAiControlMenu(null);
                                }}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className={`cb-notes-editor-control ${cavAiControlMenu === "reasoning" ? "is-open" : ""}`}>
                      <button
                        type="button"
                        className="cb-notes-editor-control-btn cb-notes-editor-control-btn--plain"
                        onClick={() => {
                          setCavAiDraftMenuOpen(false);
                          setCavAiControlMenu((prev) => (prev === "reasoning" ? null : "reasoning"));
                        }}
                        aria-label={`Reasoning selector. Current: ${cavAiReasoningLabel}`}
                        aria-haspopup="menu"
                        aria-expanded={cavAiControlMenu === "reasoning"}
                        title={`Reasoning: ${cavAiReasoningLabel}`}
                      >
                        <Image
                          src="/icons/app/cavcode/brain-svgrepo-com.svg"
                          alt=""
                          width={16}
                          height={16}
                          className="cb-notes-tool-icon cb-notes-tool-icon--editor-control"
                          aria-hidden="true"
                          unoptimized
                        />
                      </button>
                      {cavAiControlMenu === "reasoning" ? (
                        <div className="cb-notes-editor-control-menu" role="menu" aria-label="Reasoning selector">
                          {cavAiReasoningOptions.map((option) => {
                            const isOn = option.value === cavAiReasoningLevel;
                            const helper = toReasoningDisplayHelper(option.value);
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`cb-notes-editor-control-item ${isOn ? "is-on" : ""}`}
                                role="menuitemradio"
                                aria-checked={isOn}
                                onClick={() => {
                                  setCavAiReasoningLevel(option.value);
                                  setCavAiControlMenu(null);
                                }}
                                title={helper ? `${option.label}: ${helper}` : option.label}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div
                      className={`cb-notes-editor-control cb-notes-editor-control-ai ${cavAiDraftMenuOpen ? "is-open" : ""}`}
                      ref={cavAiDraftMenuRef}
                    >
                      <button
                        type="button"
                        className="cb-notes-editor-control-btn cb-notes-editor-control-btn--plain cb-notes-editor-control-btn--ai"
                        onClick={handleCavAiDraftTrigger}
                        aria-label="Open CavAi note actions"
                        title={
                          cavAiDraftBusy
                            ? "CavAi is writing..."
                            : "CavAi note actions"
                        }
                        aria-haspopup="menu"
                        aria-expanded={cavAiDraftMenuOpen || cavAiHelpPromptOpen}
                        disabled={cavAiDraftBusy}
                      >
                        <span className="cb-notes-tool-icon--editor-ai-glyph" aria-hidden="true" />
                      </button>
                      {cavAiDraftMenuOpen ? (
                        <div className="cb-notes-editor-control-menu cb-notes-editor-control-menu--draft" role="menu" aria-label="CavAi note actions">
                          <button
                            type="button"
                            className={`cb-notes-editor-control-item cb-notes-editor-control-item--draft ${
                              cavAiDraftBusy && cavAiDraftWorkingMode === "help_write" ? "is-working" : ""
                            }`}
                            role="menuitem"
                            onClick={openCavAiHelpPrompt}
                            disabled={cavAiDraftBusy}
                            aria-busy={cavAiDraftBusy && cavAiDraftWorkingMode === "help_write"}
                          >
                            <span className="cb-notes-editor-control-item-row">
                              <span className="cb-notes-editor-control-item-title">Help me write</span>
                              <span
                                className={`cb-notes-editor-control-item-icon cb-notes-editor-control-item-icon--wand ${
                                  cavAiDraftBusy && cavAiDraftWorkingMode === "help_write" ? "is-working" : ""
                                }`}
                                aria-hidden="true"
                              />
                            </span>
                          </button>
                          <button
                            type="button"
                            className={`cb-notes-editor-control-item cb-notes-editor-control-item--draft ${
                              cavAiDraftBusy && cavAiDraftWorkingMode === "generate_note" ? "is-working" : ""
                            }`}
                            role="menuitem"
                            onClick={() => void runCavAiDraft("generate_note")}
                            disabled={cavAiDraftBusy}
                            aria-busy={cavAiDraftBusy && cavAiDraftWorkingMode === "generate_note"}
                          >
                            <span className="cb-notes-editor-control-item-row">
                              <span className="cb-notes-editor-control-item-title">Generate with CavAi</span>
                              <span
                                className={`cb-notes-editor-control-item-icon cb-notes-editor-control-item-icon--sparkles ${
                                  cavAiDraftBusy && cavAiDraftWorkingMode === "generate_note" ? "is-working" : ""
                                }`}
                                aria-hidden="true"
                              />
                            </span>
                          </button>
                        </div>
                      ) : null}
                      {cavAiHelpPromptOpen ? (
                        <div
                          className="cb-notes-editor-control-menu cb-notes-editor-control-menu--prompt"
                          role="dialog"
                          aria-label="Help me write prompt"
                        >
                          <div className="cb-notes-editor-prompt-input-wrap">
                            <textarea
                              id="cb-cavpad-help-write-input"
                              ref={cavAiHelpPromptInputRef}
                              className="cb-notes-editor-prompt-input"
                              value={cavAiHelpPromptText}
                              onChange={(event) => setCavAiHelpPromptText(String(event.currentTarget.value || "").slice(0, 1200))}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
                                event.preventDefault();
                                submitCavAiHelpPrompt();
                              }}
                              placeholder=""
                              spellCheck
                              disabled={cavAiDraftBusy}
                            />
                            {!cavAiHelpPromptText.trim() ? (
                              <span
                                key={cavAiHelpPromptHintCycle}
                                className="cb-notes-editor-prompt-hint"
                                aria-hidden="true"
                              >
                                {cavAiHelpPromptHint}
                              </span>
                            ) : null}
                          </div>
                          <div className="cb-notes-editor-prompt-actions">
                            <button
                              type="button"
                              className="cb-notes-editor-prompt-btn cb-notes-editor-prompt-btn--ghost"
                              onClick={() => {
                                setCavAiHelpPromptOpen(false);
                                setCavAiDraftMenuOpen(true);
                              }}
                              disabled={cavAiDraftBusy}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="cb-notes-editor-prompt-btn is-primary"
                              onClick={submitCavAiHelpPrompt}
                              disabled={cavAiDraftBusy || !cavAiHelpPromptText.trim()}
                            >
                              {cavAiPromptActionLabel}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </div>
        ) : null}
      </Wrapper>

      <div className="cb-notes-fileinputs" aria-hidden="true">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleAttachmentInputChange("image", e)}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          multiple
          onChange={(e) => handleAttachmentInputChange("video", e)}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          multiple
          onChange={(e) => handleAttachmentInputChange("file", e)}
        />
      </div>

      {actionConfirm ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-labelledby="cb-cavpad-action-confirm-title">
          <div className="cb-link-modal-backdrop" onClick={closeActionConfirm} aria-hidden="true" />
          <div className="cb-link-modal-panel cb-cavpad-confirm-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head" id="cb-cavpad-action-confirm-title">
              {actionConfirm.title}
            </div>
            <p className="cb-link-modal-sub">{actionConfirm.message}</p>
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeActionConfirm}>
                Cancel
              </button>
              <button
                className={`cb-linkpill ${
                  actionConfirm.confirmTone === "danger" ? "cb-cavpad-confirm-danger" : "cb-home-accent"
                }`}
                type="button"
                onClick={runActionConfirm}
              >
                {actionConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkModalOpen ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Paste link URL">
          <div className="cb-link-modal-backdrop" onClick={closeLinkModal} aria-hidden="true" />
          <div className="cb-link-modal-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Paste link URL</div>
            <p className="cb-link-modal-sub">Enter the address you want to attach to the selection.</p>
            <input
              ref={linkInputRef}
              className="cb-link-modal-input"
              value={linkModalValue}
              onChange={(e) => setLinkModalValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmLinkModal();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeLinkModal();
                }
              }}
              placeholder="https://"
              aria-label="Link URL"
            />
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeLinkModal}>
                Cancel
              </button>
              <button className="cb-linkpill cb-home-accent" type="button" onClick={confirmLinkModal}>
                Insert link
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trashNoticeOpen ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-labelledby="cb-cavpad-trash-notice-title">
          <div className="cb-link-modal-backdrop" onClick={() => setTrashNoticeOpen(false)} aria-hidden="true" />
          <div className="cb-link-modal-panel cb-cavpad-trash-notice-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head" id="cb-cavpad-trash-notice-title">
              7-day deletion notice
            </div>
            <p className="cb-link-modal-sub">These notes are within 7 days of permanent deletion from CavPad.</p>
            {trashNoticeCount ? (
              <div className="cb-cavpad-trash-notice-list" role="list" aria-label="Notes on 7-day notice">
                {trashNoticeRows.map(({ note, daysLeft }) => (
                  <div key={note.id} className="cb-cavpad-trash-notice-row" role="listitem">
                    <div className="cb-cavpad-trash-notice-copy">
                      <div className="cb-cavpad-trash-notice-name">{note.title || "Untitled"}</div>
                      <div className="cb-cavpad-trash-notice-meta">
                        Deleted {fmtTime(note.deletedAt)} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                      </div>
                    </div>
                    <div className="cb-link-modal-actions cb-cavpad-trash-notice-actions">
                      <button
                        className="cb-linkpill"
                        type="button"
                        onClick={() => {
                          setTrashNoticeOpen(false);
                          setView("trash");
                          setSelectedTrashIds([note.id]);
                        }}
                      >
                        Select
                      </button>
                      <button
                        className="cb-linkpill cb-home-accent"
                        type="button"
                        onClick={() => {
                          setTrashNoticeOpen(false);
                          setSelectedTrashIds([]);
                          restoreNote(note.id);
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cb-notes-toggle-sub">No notes currently on 7-day notice.</div>
            )}
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={() => setTrashNoticeOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createChooserOpen ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Create item">
          <div className="cb-link-modal-backdrop" onClick={closeCreateChooser} aria-hidden="true" />
          <div className="cb-link-modal-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Create</div>
            <p className="cb-link-modal-sub">Choose what you want to create in CavPad.</p>
            <div className="cb-link-modal-actions cb-link-modal-actions-stack">
              <button className="cb-linkpill cb-home-accent" type="button" onClick={() => createFromChooser("note")}>
                Create note
              </button>
              <button className="cb-linkpill cb-home-accent" type="button" onClick={() => createFromChooser("directory")}>
                Create directory
              </button>
              <button className="cb-linkpill" type="button" onClick={closeCreateChooser}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {moveNoteModalOpen && moveNoteModalNote ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Move note to directory">
          <div className="cb-link-modal-backdrop" onClick={closeMoveNoteModal} aria-hidden="true" />
          <div className="cb-link-modal-panel cb-cavpad-move-note-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Move note to directory</div>
            <p className="cb-link-modal-sub">
              Choose where <strong>{moveNoteModalNote.title || "Untitled"}</strong> should live.
            </p>
            <div className="cb-cavpad-move-note-picker" ref={moveNoteDropdownWrapRef}>
              <button
                className={`cb-cavpad-move-note-dropdown-trigger ${moveNoteModalDropdownOpen ? "is-open" : ""}`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={moveNoteModalDropdownOpen}
                aria-label="Select destination directory"
                onClick={() => setMoveNoteModalDropdownOpen((prev) => !prev)}
              >
                <span>{moveNoteModalSelectedDirectoryLabel}</span>
              </button>
              {moveNoteModalDropdownOpen ? (
                <div className="cb-cavpad-move-note-dropdown" role="listbox" aria-label="Directory destinations">
                  <div className="cb-cavpad-move-note-search">
                    <input
                      ref={moveNoteSearchInputRef}
                      className="cb-cavpad-move-note-search-input"
                      value={moveNoteModalSearchQuery}
                      onChange={(event) => setMoveNoteModalSearchQuery(event.currentTarget.value)}
                      placeholder="Search folders"
                      aria-label="Search folders"
                      autoComplete="off"
                    />
                  </div>
                  <div className="cb-cavpad-move-note-results">
                    {moveNoteModalFilteredDirectoryOptions.length ? (
                      moveNoteModalFilteredDirectoryOptions.map((option) => {
                        const isSelected = moveNoteModalDirectoryId === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`cb-cavpad-move-note-option ${isSelected ? "is-selected" : ""}`}
                            onClick={() => {
                              setMoveNoteModalDirectoryId(option.id);
                              setMoveNoteModalDropdownOpen(false);
                            }}
                          >
                            <span className="cb-cavpad-move-note-option-main">
                              <span className="cb-cavpad-move-note-option-label">{option.label}</span>
                              <span className="cb-cavpad-move-note-option-meta">{option.meta}</span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="cb-cavpad-move-note-empty">No folders match your search.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeMoveNoteModal}>
                Cancel
              </button>
              <button
                className="cb-linkpill cb-home-accent"
                type="button"
                onClick={confirmMoveNoteModal}
                disabled={!canConfirmMoveNoteModal}
              >
                Move note
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeDirectoryModalOpen && mergeDirectoryModalDirectory ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Merge folder">
          <div className="cb-link-modal-backdrop" onClick={closeMergeDirectoryModal} aria-hidden="true" />
          <div className="cb-link-modal-panel cb-cavpad-move-note-panel cb-cavpad-merge-directory-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Merge folder</div>
            <p className="cb-link-modal-sub">
              Move <strong>{mergeDirectoryModalDirectory.name || "Untitled folder"}</strong> inside another folder.
            </p>
            <div className="cb-cavpad-move-note-picker" ref={mergeDirectoryDropdownWrapRef}>
              <button
                className={`cb-cavpad-move-note-dropdown-trigger ${mergeDirectoryModalDropdownOpen ? "is-open" : ""}`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={mergeDirectoryModalDropdownOpen}
                aria-label="Select destination folder"
                onClick={() => setMergeDirectoryModalDropdownOpen((prev) => !prev)}
              >
                <span>{mergeDirectoryModalSelectedLabel}</span>
              </button>
              {mergeDirectoryModalDropdownOpen ? (
                <div className="cb-cavpad-move-note-dropdown" role="listbox" aria-label="Folder destinations">
                  <div className="cb-cavpad-move-note-search">
                    <input
                      ref={mergeDirectorySearchInputRef}
                      className="cb-cavpad-move-note-search-input"
                      value={mergeDirectoryModalSearchQuery}
                      onChange={(event) => setMergeDirectoryModalSearchQuery(event.currentTarget.value)}
                      placeholder="Search folders"
                      aria-label="Search folders"
                      autoComplete="off"
                    />
                  </div>
                  <div className="cb-cavpad-move-note-results">
                    {mergeDirectoryModalFilteredOptions.length ? (
                      mergeDirectoryModalFilteredOptions.map((option) => {
                        const isSelected = mergeDirectoryModalTargetId === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`cb-cavpad-move-note-option ${isSelected ? "is-selected" : ""}`}
                            onClick={() => {
                              setMergeDirectoryModalTargetId(option.id);
                              setMergeDirectoryModalDropdownOpen(false);
                            }}
                          >
                            <span className="cb-cavpad-move-note-option-main">
                              <span className="cb-cavpad-move-note-option-label">{option.label}</span>
                              <span className="cb-cavpad-move-note-option-meta">{option.meta}</span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="cb-cavpad-move-note-empty">No folders match your search.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeMergeDirectoryModal}>
                Cancel
              </button>
              <button
                className="cb-linkpill cb-home-accent"
                type="button"
                onClick={confirmMergeDirectoryModal}
                disabled={!canConfirmMergeDirectoryModal}
              >
                Merge folder
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {folderModalOpen && folderModalMode === "create" ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Create directory">
          <div className="cb-link-modal-backdrop" onClick={closeFolderModal} aria-hidden="true" />
          <div className="cb-link-modal-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Directory name</div>
            <p className="cb-link-modal-sub">Create a directory to organize your notes.</p>
            <input
              ref={folderInputRef}
              className="cb-link-modal-input"
              value={folderModalValue}
              onChange={(e) => setFolderModalValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmFolderModal();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeFolderModal();
                }
              }}
              placeholder="New directory name"
              aria-label="New directory name"
            />
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeFolderModal}>
                Cancel
              </button>
              <button className="cb-linkpill cb-home-accent" type="button" onClick={confirmFolderModal}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {folderModalOpen && folderModalMode === "rename" ? (
        <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label="Rename directory">
          <div className="cb-link-modal-backdrop" onClick={closeFolderModal} aria-hidden="true" />
          <div className="cb-link-modal-panel" data-cavpad-theme={theme}>
            <div className="cb-link-modal-head">Rename directory</div>
            <p className="cb-link-modal-sub">Rename this directory while keeping every note in place.</p>
            <input
              ref={folderInputRef}
              className="cb-link-modal-input"
              value={folderModalValue}
              onChange={(e) => setFolderModalValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmFolderModal();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeFolderModal();
                }
              }}
              placeholder="Updated directory name"
              aria-label="Updated directory name"
            />
            <div className="cb-link-modal-actions">
              <button className="cb-linkpill" type="button" onClick={closeFolderModal}>
                Cancel
              </button>
              <button className="cb-linkpill cb-home-accent" type="button" onClick={confirmFolderModal}>
                Rename
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {collabModalTarget ? (
        <CavPadCollaborateModal
          open
          resourceType={collabModalTarget.kind}
          resourceId={collabModalTarget.id}
          resourceTitle={
            collabModalTarget.kind === "directory"
              ? (collabModalDirectory?.name || "Folder")
              : (collabModalNote?.title || "Note")
          }
          ownerUserId={collabModalTarget.kind === "note" ? (collabModalNote?.ownerUserId || null) : null}
          ownerUsername={collabModalTarget.kind === "note" ? (collabModalNote?.ownerUsername || null) : null}
          ownerDisplayName={collabModalTarget.kind === "note" ? (collabModalNote?.ownerDisplayName || null) : null}
          ownerAvatarUrl={collabModalTarget.kind === "note" ? (collabModalNote?.ownerAvatarUrl || null) : null}
          ownerAvatarTone={collabModalTarget.kind === "note" ? (collabModalNote?.ownerAvatarTone || null) : null}
          ownerEmail={collabModalTarget.kind === "note" ? (collabModalNote?.ownerEmail || null) : null}
          initialAccessList={
            collabModalTarget.kind === "note"
              ? (collabModalNote?.accessList || []).map((row) => ({
                id: String(row.id || row.userId || ""),
                userId: String(row.userId || ""),
                username: row.username || null,
                displayName: row.displayName || null,
                avatarUrl: row.avatarUrl || null,
                avatarTone: row.avatarTone || null,
                email: row.email || null,
                permission: row.permission === "EDIT" ? "EDIT" : "VIEW",
                expiresAtISO: row.expiresAt || null,
              }))
              : []
          }
          theme={theme}
          defaultPermission={settings.defaultSharePermission}
          defaultExpiryDays={settings.defaultShareExpiryDays}
          onAccessChanged={(resourceId) => {
            if (collabModalTarget.kind === "directory") {
              void refreshCavPadFromServer();
              return;
            }
            refreshNoteMetadata(resourceId);
          }}
          onClose={() => setCollabModalTarget(null)}
        />
      ) : null}
    </>
  );
}
