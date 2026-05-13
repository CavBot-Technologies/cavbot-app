"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";

import { AvatarBadge, Badge } from "@/components/admin/AdminPrimitives";
import { formatAdminDepartmentLabel } from "@/lib/admin/access";
import { getDepartmentAvatarTone } from "@/lib/admin/staffDisplay";
import { ALIBABA_QWEN_PLUS_MODEL_ID } from "@/src/lib/ai/model-catalog";

type ThreadListItem = {
  id: string;
  boxLabel?: string | null;
  boxSlug?: string | null;
  isDirect: boolean;
  starred?: boolean;
  subject: string;
  counterpartLabel?: string | null;
  preview: string;
  unread: boolean;
  archived: boolean;
  lastMessageAt: string;
  lastAuthorUserId?: string | null;
  participantUserIds?: string[];
  draftBody?: string | null;
  draftUpdatedAt?: string | null;
};

type ThreadDetail = {
  id: string;
  subject: string;
  boxLabel?: string | null;
  boxSlug?: string | null;
  isDirect: boolean;
  archived: boolean;
  participants: Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    avatarImage?: string | null;
    avatarTone?: string | null;
  }>;
  messages: Array<{
    id: string;
    senderUserId: string;
    senderName: string;
    senderEmail: string;
    senderAvatarImage?: string | null;
    senderAvatarTone?: string | null;
    body: string;
    bodyHtml?: string | null;
    fontFamily?: string | null;
    createdAt: string;
    attachments: Array<{
      id: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
    }>;
  }>;
  draft: {
    body: string;
    updatedAt?: string | null;
  };
};

type RichComposerTarget = "reply" | "compose";
type RichDraftEnvelope = {
  html: string;
  fontFamily: string;
};
type CavCloudPickerFile = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  bytes: number;
};

const CAVCHAT_DRAFT_PREFIX = "__cavchat_rich_draft__:";
const CAVCHAT_FONT_OPTIONS = [
  { id: "executive-sans", label: "Executive Sans", family: '"Avenir Next", Avenir, "SF Pro Text", system-ui, sans-serif' },
  { id: "headquarter", label: "Headquarter", family: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif' },
  { id: "command-grotesk", label: "Command Grotesk", family: '"Space Grotesk", "Avenir Next", system-ui, sans-serif' },
  { id: "operations", label: "Operations", family: '"Manrope", "Inter", system-ui, sans-serif' },
  { id: "security", label: "Security", family: '"DM Sans", "Segoe UI", system-ui, sans-serif' },
  { id: "human", label: "Human", family: '"Nunito Sans", "Avenir Next", system-ui, sans-serif' },
  { id: "precision", label: "Precision", family: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "modern-serif", label: "Modern Serif", family: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' },
  { id: "charter", label: "Charter", family: 'Charter, Georgia, serif' },
  { id: "editorial", label: "Editorial", family: '"Times New Roman", Times, serif' },
  { id: "mono-signal", label: "Mono Signal", family: '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace' },
  { id: "mono-ops", label: "Mono Ops", family: '"SFMono-Regular", Menlo, Consolas, monospace' },
] as const;
const DEFAULT_CAVCHAT_FONT_FAMILY = CAVCHAT_FONT_OPTIONS[0].family;
const CAVCHAT_EMOJIS = ["✅", "📌", "🔒", "🚀", "👋", "🙏", "⚠️", "🧠", "📎", "🟦", "🙂", "👍"];
const CAVCHAT_AI_TONES = ["Professional", "Direct", "Warm", "Executive", "Supportive"] as const;
const CAVCHAT_FORMAT_COLORS = [
  { label: "White", value: "#F7FBFF" },
  { label: "Lime", value: "#E6F28D" },
  { label: "Violet", value: "#D6C7FF" },
  { label: "Blue", value: "#B5D8FF" },
] as const;

type StaffOption = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarImage?: string | null;
  avatarTone?: string | null;
  department: string;
  positionTitle: string;
};

type WorkspaceMode = "chat" | "oversight";
type MailboxView = "inbox" | "unread" | "drafts" | "important" | "starred" | "archive" | "trash";
type DepartmentView = "all" | "COMMAND" | "OPERATIONS" | "SECURITY" | "HUMAN_RESOURCES";
type DepartmentTone = "all" | "command" | "operations" | "security" | "human_resources";

const MAILBOX_META: Record<MailboxView, { title: string; subtitle: string }> = {
  inbox: {
    title: "Inbox",
    subtitle: "All active staff conversations and internal mail in one operational feed.",
  },
  unread: {
    title: "Unread",
    subtitle: "Threads that still need operator attention or acknowledgment.",
  },
  drafts: {
    title: "Drafts",
    subtitle: "Saved replies and unsent staff messages across CavChat.",
  },
  important: {
    title: "Important",
    subtitle: "Priority staff mail, including every Command and Human Resources message.",
  },
  starred: {
    title: "Starred",
    subtitle: "Priority direct staff conversations kept close in the main rail.",
  },
  archive: {
    title: "Archive",
    subtitle: "Org boxes and archived conversations kept for operational recall.",
  },
  trash: {
    title: "Trash",
    subtitle: "Removed staff mail kept out of the main inbox until restored or cleared.",
  },
};

const DEPARTMENT_META: Array<{ value: DepartmentView; label: string }> = [
  { value: "all", label: "All departments" },
  { value: "COMMAND", label: "Command" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "SECURITY", label: "Security" },
  { value: "HUMAN_RESOURCES", label: "Human Resources" },
];

const BOX_DEPARTMENT_MAP: Partial<Record<string, DepartmentView>> = {
  command: "COMMAND",
  operations: "OPERATIONS",
  security: "SECURITY",
  human_resources: "HUMAN_RESOURCES",
  founder: "COMMAND",
};
const SYSTEM_SENDER_DEPARTMENT_MAP: Partial<Record<string, DepartmentView>> = {
  "system:cavbot-admin": "COMMAND",
};
const DEPARTMENT_TONE_MAP: Record<DepartmentView, DepartmentTone> = {
  all: "all",
  COMMAND: "command",
  OPERATIONS: "operations",
  SECURITY: "security",
  HUMAN_RESOURCES: "human_resources",
};

function formatDateLabel(value?: string | null) {
  if (!value) return "Now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function plainTextToRichHtml(value: string) {
  const safe = escapeHtml(String(value || "").replace(/\r\n?/g, "\n").trim());
  if (!safe) return "";
  return safe
    .split(/\n{2,}/g)
    .map((chunk) => `<p>${chunk.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function normalizeRichBody(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return looksLikeHtml(raw) ? raw : plainTextToRichHtml(raw);
}

function editorHtmlIsEmpty(value: string) {
  const normalized = String(value || "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  return !normalized;
}

function richHtmlToPlainText(value: string) {
  if (typeof window !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${String(value || "")}</div>`, "text/html");
    return String(doc.body.textContent || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|blockquote|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeRichHtmlClient(value: string) {
  if (typeof window === "undefined") return normalizeRichBody(value);
  const parser = new DOMParser();
  const source = parser.parseFromString(`<div>${String(value || "")}</div>`, "text/html");
  const allowedTags = new Set(["a", "b", "blockquote", "br", "div", "em", "i", "li", "ol", "p", "span", "strong", "u", "ul"]);
  const allowedHref = /^(https?:|mailto:|\/)/i;
  const sanitizeInlineStyle = (input: string | null) => {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const colorMatch = raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    if (!colorMatch) return "";
    const colorValue = colorMatch[1].trim();
    const isSafeColor = /^#[0-9a-f]{3,8}$/i.test(colorValue)
      || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(colorValue);
    if (!isSafeColor) return "";
    return `color: ${colorValue};`;
  };

  const sanitizeNode = (node: Node, doc: Document): Node | DocumentFragment | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return doc.createTextNode(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const fragment = doc.createDocumentFragment();

    if (!allowedTags.has(tag)) {
      for (const child of Array.from(element.childNodes)) {
        const cleaned = sanitizeNode(child, doc);
        if (cleaned) fragment.appendChild(cleaned);
      }
      return fragment;
    }

    const next = doc.createElement(tag);
    if (tag === "a") {
      const href = String(element.getAttribute("href") || "").trim();
      if (allowedHref.test(href)) {
        next.setAttribute("href", href);
        next.setAttribute("target", "_blank");
        next.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (tag !== "a") {
      const safeStyle = sanitizeInlineStyle(element.getAttribute("style"));
      if (safeStyle) {
        next.setAttribute("style", safeStyle);
      }
    }

    for (const child of Array.from(element.childNodes)) {
      const cleaned = sanitizeNode(child, doc);
      if (cleaned) next.appendChild(cleaned);
    }
    return next;
  };

  const cleanedDoc = document.implementation.createHTMLDocument("");
  const wrapper = cleanedDoc.createElement("div");
  for (const child of Array.from(source.body.firstChild?.childNodes || source.body.childNodes)) {
    const cleaned = sanitizeNode(child, cleanedDoc);
    if (cleaned) wrapper.appendChild(cleaned);
  }
  return wrapper.innerHTML.trim();
}

function serializeRichDraftEnvelope(payload: RichDraftEnvelope) {
  return `${CAVCHAT_DRAFT_PREFIX}${JSON.stringify({
    html: sanitizeRichHtmlClient(payload.html),
    fontFamily: payload.fontFamily || DEFAULT_CAVCHAT_FONT_FAMILY,
  })}`;
}

function parseRichDraftEnvelope(value: string | null | undefined): RichDraftEnvelope {
  const raw = String(value || "");
  if (!raw) {
    return { html: "", fontFamily: DEFAULT_CAVCHAT_FONT_FAMILY };
  }
  if (raw.startsWith(CAVCHAT_DRAFT_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(CAVCHAT_DRAFT_PREFIX.length)) as Partial<RichDraftEnvelope>;
      return {
        html: normalizeRichBody(String(parsed.html || "")),
        fontFamily: String(parsed.fontFamily || DEFAULT_CAVCHAT_FONT_FAMILY),
      };
    } catch {
      return { html: "", fontFamily: DEFAULT_CAVCHAT_FONT_FAMILY };
    }
  }
  return {
    html: normalizeRichBody(raw),
    fontFamily: DEFAULT_CAVCHAT_FONT_FAMILY,
  };
}

function buildInsertedLinesHtml(label: string, entries: string[]) {
  const filtered = entries.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (!filtered.length) return "";
  return filtered
    .map((entry) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(entry)}</p>`)
    .join("");
}

function threadLabel(thread: ThreadListItem) {
  return thread.counterpartLabel || thread.boxLabel || thread.subject;
}

function formatStaffDepartmentOptionLabel(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (
    normalized === "COMMAND"
    || normalized === "OPERATIONS"
    || normalized === "SECURITY"
    || normalized === "HUMAN_RESOURCES"
  ) {
    return formatAdminDepartmentLabel(normalized);
  }
  return String(value || "").trim() || "Team";
}

function getThreadSnippet(subject: string, preview: string) {
  const normalizedSubject = String(subject || "").trim();
  const normalizedPreview = String(preview || "").trim();
  if (!normalizedPreview) return "";
  if (!normalizedSubject) return normalizedPreview;
  if (!normalizedPreview.toLowerCase().startsWith(normalizedSubject.toLowerCase())) {
    return normalizedPreview;
  }

  const stripped = normalizedPreview
    .slice(normalizedSubject.length)
    .replace(/^[\s:;,.!?-]+/, "")
    .trim();

  return stripped || normalizedPreview;
}

function getThreadDepartment(
  thread: ThreadListItem,
  departmentByUserId: Map<string, string>,
  activeMailboxUserId: string,
): DepartmentView {
  if (thread.boxSlug && BOX_DEPARTMENT_MAP[thread.boxSlug]) {
    return BOX_DEPARTMENT_MAP[thread.boxSlug]!;
  }
  if (thread.lastAuthorUserId && SYSTEM_SENDER_DEPARTMENT_MAP[thread.lastAuthorUserId]) {
    return SYSTEM_SENDER_DEPARTMENT_MAP[thread.lastAuthorUserId]!;
  }
  if (
    thread.lastAuthorUserId
    && thread.lastAuthorUserId !== activeMailboxUserId
    && departmentByUserId.get(thread.lastAuthorUserId)
  ) {
    return departmentByUserId.get(thread.lastAuthorUserId) as DepartmentView;
  }

  const participantDepartment = (thread.participantUserIds || [])
    .filter((userId) => userId !== activeMailboxUserId)
    .map((userId) => departmentByUserId.get(userId))
    .find((value): value is string => Boolean(value));

  if (participantDepartment && participantDepartment in DEPARTMENT_TONE_MAP) {
    return participantDepartment as DepartmentView;
  }

  return "COMMAND";
}

function isImportantDepartment(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "COMMAND" || normalized === "HUMAN_RESOURCES";
}

function resolveDepartmentAvatarTone(department: DepartmentView | string | null | undefined) {
  return getDepartmentAvatarTone(String(department || "").trim().toUpperCase());
}

function resolveThreadAvatar(args: {
  thread: ThreadListItem;
  mailboxUserId: string;
  staffByUserId: Map<string, StaffOption>;
  departmentByUserId: Map<string, string>;
}) {
  const threadDepartment = getThreadDepartment(args.thread, args.departmentByUserId, args.mailboxUserId);
  const candidateIds = [
    args.thread.lastAuthorUserId,
    ...(args.thread.participantUserIds || []).filter((userId) => userId !== args.mailboxUserId),
  ].filter((value): value is string => Boolean(value));

  for (const userId of candidateIds) {
    const staff = args.staffByUserId.get(userId);
    if (!staff) continue;
    return {
      name: staff.name,
      email: staff.email,
      image: staff.avatarImage || null,
      tone: resolveDepartmentAvatarTone(staff.department),
    };
  }

  return {
    name: threadLabel(args.thread),
    email: null,
    image: null,
    tone: resolveDepartmentAvatarTone(threadDepartment),
  };
}

function tokenizeRecipientInput(value: string) {
  return String(value || "")
    .split(/[\n,;]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeRecipientToken(value: string) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return String(angleMatch?.[1] || trimmed).trim().toLowerCase();
}

function getMailboxStorageKey(mailboxUserId: string) {
  return `cavchat-mailbox-state:${mailboxUserId}`;
}

type StoredMailboxState = {
  trashedThreadIds?: string[];
  purgedThreadIds?: string[];
  importantThreadIds?: string[];
};

function readStoredMailboxState(mailboxUserId: string): StoredMailboxState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(getMailboxStorageKey(mailboxUserId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredMailboxState;
    return {
      trashedThreadIds: Array.isArray(parsed.trashedThreadIds) ? parsed.trashedThreadIds : [],
      purgedThreadIds: Array.isArray(parsed.purgedThreadIds) ? parsed.purgedThreadIds : [],
      importantThreadIds: Array.isArray(parsed.importantThreadIds) ? parsed.importantThreadIds : [],
    };
  } catch {
    return {};
  }
}

function writeStoredMailboxState(mailboxUserId: string, state: StoredMailboxState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getMailboxStorageKey(mailboxUserId), JSON.stringify({
    trashedThreadIds: Array.from(new Set(state.trashedThreadIds || [])),
    purgedThreadIds: Array.from(new Set(state.purgedThreadIds || [])),
    importantThreadIds: Array.from(new Set(state.importantThreadIds || [])),
  }));
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M11.2 10.35 14 13.14 13.15 14l-2.8-2.79a5 5 0 1 1 .85-.86ZM6.5 2.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M7.35 3.15 2.5 8l4.85 4.85 1.06-1.06L5.37 8.75H14v-1.5H5.37l3.04-3.04z"
        fill="currentColor"
      />
    </svg>
  );
}

function ComposeIcon() {
  return <span className="hq-chatComposeLaunchIcon" aria-hidden="true" />;
}

function MailIcon() {
  return <span className="hq-chatInboxIcon" aria-hidden="true" />;
}

function DraftIcon() {
  return <span className="hq-chatDraftIcon" aria-hidden="true" />;
}

function BellIcon() {
  return <span className="hq-chatUnreadIcon" aria-hidden="true" />;
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m8 1.45 1.82 3.69 4.07.59-2.94 2.87.69 4.05L8 10.73l-3.64 1.92.69-4.05L2.11 5.73l4.07-.59L8 1.45Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckboxIcon(props: { checked: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.25" fill={props.checked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" />
      {props.checked ? (
        <path d="m5 8.25 1.85 1.85L11.1 5.85" fill="none" stroke="rgba(5,9,22,0.98)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

function ArchiveIcon() {
  return <span className="hq-chatArchiveIcon" aria-hidden="true" />;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">
      <path d="M20.5 6H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function DirectIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5a6.5 6.5 0 1 0 4.2 11.46L14.5 14l-.97-2.24A6.47 6.47 0 0 0 8 1.5Zm0 1.25A5.25 5.25 0 1 1 2.75 8 5.26 5.26 0 0 1 8 2.75Zm-2.4 3.1h4.8v1.3H5.6Zm0 2.85h3.4V10H5.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ImportantIcon() {
  return <span className="hq-chatImportantIcon" aria-hidden="true" />;
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="13" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

function DepartmentDot(props: { department: DepartmentView }) {
  const tone = DEPARTMENT_TONE_MAP[props.department];
  return <span className="hq-chatDepartmentDot" data-tone={tone} aria-hidden="true" />;
}

function ChatMenuIcon() {
  return <span className="hq-chatMobileMenuGlyph" aria-hidden="true" />;
}

function ComposerGlyph(props: { icon: "format" | "cavai" | "attach" | "link" | "emoji" | "cavcloud" | "photo" }) {
  return <span className="hq-chatComposerGlyph" data-icon={props.icon} aria-hidden="true" />;
}

function FormatGlyph(props: {
  icon: "bold" | "italic" | "underline" | "strikethrough" | "bullets" | "numbers" | "quote" | "clear";
}) {
  return <span className="hq-chatFormatGlyph" data-icon={props.icon} aria-hidden="true" />;
}

function MailboxButton(props: {
  active: boolean;
  count: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hq-chatMailboxButton"
      data-active={props.active}
      onClick={props.onClick}
    >
      <span className="hq-chatMailboxButtonIcon">{props.icon}</span>
      <span className="hq-chatMailboxButtonLabel">{props.label}</span>
      <span className="hq-chatMailboxButtonCount">{props.count}</span>
    </button>
  );
}

export function AdminCavChatWorkspace(props: {
  currentUserId: string;
  initialThreads: ThreadListItem[];
  initialThread: ThreadDetail | null;
  staffOptions: StaffOption[];
  initialMailboxUserId?: string;
  mode?: WorkspaceMode;
}) {
  const mode = props.mode || "chat";
  const isOversight = mode === "oversight";
  const initialDraft = parseRichDraftEnvelope(props.initialThread?.draft.body || "");
  const [threads, setThreads] = useState(props.initialThreads);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(props.initialThread?.id || null);
  const [activeThread, setActiveThread] = useState<ThreadDetail | null>(props.initialThread);
  const [composerBody, setComposerBody] = useState(initialDraft.html);
  const [composerFontFamily, setComposerFontFamily] = useState<string>(initialDraft.fontFamily);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [mailboxView, setMailboxView] = useState<MailboxView>("inbox");
  const [departmentView, setDepartmentView] = useState<DepartmentView>("all");
  const [composeLauncherOpen, setComposeLauncherOpen] = useState(false);
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeMessage, setComposeMessage] = useState("");
  const [composeFontFamily, setComposeFontFamily] = useState<string>(DEFAULT_CAVCHAT_FONT_FAMILY);
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [composeCcOpen, setComposeCcOpen] = useState(false);
  const [composeBccOpen, setComposeBccOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mailboxUserId, setMailboxUserId] = useState(props.initialMailboxUserId || props.currentUserId);
  const [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  const [selectAllVisibleActive, setSelectAllVisibleActive] = useState(false);
  const [trashedThreadIds, setTrashedThreadIds] = useState<string[]>([]);
  const [purgedThreadIds, setPurgedThreadIds] = useState<string[]>([]);
  const [importantThreadIds, setImportantThreadIds] = useState<string[]>([]);
  const [bulkMoveMenuOpen, setBulkMoveMenuOpen] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [swipeOffsets, setSwipeOffsets] = useState<Record<string, number>>({});
  const [formatMenuTarget, setFormatMenuTarget] = useState<RichComposerTarget | null>(null);
  const [colorMenuTarget, setColorMenuTarget] = useState<RichComposerTarget | null>(null);
  const [emojiMenuTarget, setEmojiMenuTarget] = useState<RichComposerTarget | null>(null);
  const [linkModalTarget, setLinkModalTarget] = useState<RichComposerTarget | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [aiModalTarget, setAiModalTarget] = useState<RichComposerTarget | null>(null);
  const [aiToneMenuTarget, setAiToneMenuTarget] = useState<RichComposerTarget | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiTone, setAiTone] = useState<(typeof CAVCHAT_AI_TONES)[number]>("Professional");
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [cavCloudModalTarget, setCavCloudModalTarget] = useState<RichComposerTarget | null>(null);
  const [cavCloudRootFolderId, setCavCloudRootFolderId] = useState("root");
  const [cavCloudQuery, setCavCloudQuery] = useState("");
  const [cavCloudFiles, setCavCloudFiles] = useState<CavCloudPickerFile[]>([]);
  const [cavCloudLoading, setCavCloudLoading] = useState(false);
  const [cavCloudError, setCavCloudError] = useState("");
  const [composerTextColor, setComposerTextColor] = useState<string>(CAVCHAT_FORMAT_COLORS[0].value);
  const [composeTextColor, setComposeTextColor] = useState<string>(CAVCHAT_FORMAT_COLORS[0].value);
  const replyEditorRef = useRef<HTMLDivElement | null>(null);
  const composeEditorRef = useRef<HTMLDivElement | null>(null);
  const bulkMoveMenuRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const gestureStateRef = useRef<{
    threadId: string;
    startX: number;
    startY: number;
    longPressed: boolean;
  } | null>(null);
  const swipeOffsetsRef = useRef<Record<string, number>>({});
  const suppressOpenUntilRef = useRef(0);
  const deferredSearch = useDeferredValue(search);

  const activeMailboxStaff = useMemo(
    () => props.staffOptions.find((staff) => staff.userId === mailboxUserId) || null,
    [mailboxUserId, props.staffOptions],
  );
  const staffByUserId = useMemo(
    () => new Map(props.staffOptions.map((staff) => [staff.userId, staff])),
    [props.staffOptions],
  );
  const composeRecipientSuggestions = useMemo(
    () => props.staffOptions
      .filter((staff) => staff.userId !== props.currentUserId)
      .map((staff) => `${staff.name} <${staff.email}>`),
    [props.currentUserId, props.staffOptions],
  );
  const departmentByUserId = useMemo(
    () => new Map(props.staffOptions.map((staff) => [staff.userId, staff.department])),
    [props.staffOptions],
  );
  const selectedThreadIdSet = useMemo(() => new Set(selectedThreadIds), [selectedThreadIds]);
  const trashedThreadIdSet = useMemo(() => new Set(trashedThreadIds), [trashedThreadIds]);
  const purgedThreadIdSet = useMemo(() => new Set(purgedThreadIds), [purgedThreadIds]);
  const importantThreadIdSet = useMemo(() => new Set(importantThreadIds), [importantThreadIds]);
  const mailboxThreads = useMemo(
    () => threads.filter((thread) => !purgedThreadIdSet.has(thread.id)),
    [purgedThreadIdSet, threads],
  );
  const threadIsAutoImportant = useCallback((thread: ThreadListItem, activeMailboxUserId = mailboxUserId) => {
    if (thread.boxSlug) {
      const mappedDepartment = BOX_DEPARTMENT_MAP[thread.boxSlug];
      if (mappedDepartment && isImportantDepartment(mappedDepartment)) return true;
    }

    if (thread.lastAuthorUserId) {
      const systemDepartment = SYSTEM_SENDER_DEPARTMENT_MAP[thread.lastAuthorUserId];
      if (systemDepartment && isImportantDepartment(systemDepartment)) return true;

      const authorDepartment = departmentByUserId.get(thread.lastAuthorUserId);
      if (isImportantDepartment(authorDepartment)) return true;
    }

    return (thread.participantUserIds || [])
      .filter((userId) => userId !== activeMailboxUserId)
      .some((userId) => isImportantDepartment(departmentByUserId.get(userId)));
  }, [departmentByUserId, mailboxUserId]);
  const threadIsImportant = useCallback((thread: ThreadListItem, activeMailboxUserId = mailboxUserId) => (
    importantThreadIdSet.has(thread.id) || threadIsAutoImportant(thread, activeMailboxUserId)
  ), [importantThreadIdSet, mailboxUserId, threadIsAutoImportant]);
  const archiveBucketCount = useMemo(
    () => mailboxThreads.filter((thread) => thread.archived && !trashedThreadIdSet.has(thread.id)).length,
    [mailboxThreads, trashedThreadIdSet],
  );
  const trashBucketCount = useMemo(
    () => mailboxThreads.filter((thread) => trashedThreadIdSet.has(thread.id)).length,
    [mailboxThreads, trashedThreadIdSet],
  );

  const mailboxCounts = useMemo(() => ({
    inbox: mailboxThreads.filter((thread) => !thread.archived && !trashedThreadIdSet.has(thread.id)).length,
    unread: mailboxThreads.filter((thread) => thread.unread && !thread.archived && !trashedThreadIdSet.has(thread.id)).length,
    drafts: mailboxThreads.filter((thread) => Boolean(thread.draftBody) && !thread.archived && !trashedThreadIdSet.has(thread.id)).length,
    important: mailboxThreads.filter((thread) => !trashedThreadIdSet.has(thread.id) && threadIsImportant(thread, mailboxUserId)).length,
    starred: mailboxThreads.filter((thread) => Boolean(thread.starred) && !thread.archived && !trashedThreadIdSet.has(thread.id)).length,
    archive: archiveBucketCount,
    trash: trashBucketCount,
  }), [archiveBucketCount, mailboxThreads, mailboxUserId, threadIsImportant, trashBucketCount, trashedThreadIdSet]);

  const threadMatchesMailboxView = useCallback((thread: ThreadListItem, view: MailboxView) => {
    const trashed = trashedThreadIdSet.has(thread.id);
    if (view === "trash") return trashed;
    if (trashed) return false;
    if (view === "inbox") return !thread.archived;
    if (view === "unread") return thread.unread && !thread.archived;
    if (view === "drafts") return Boolean(thread.draftBody) && !thread.archived;
    if (view === "important") return threadIsImportant(thread, mailboxUserId);
    if (view === "starred") return Boolean(thread.starred) && !thread.archived;
    if (view === "archive") return thread.archived;
    return true;
  }, [mailboxUserId, threadIsImportant, trashedThreadIdSet]);

  const threadMatchesDepartmentView = useCallback((thread: ThreadListItem, view: DepartmentView, activeMailboxUserId = mailboxUserId) => {
    if (view === "all") return true;

    if (thread.boxSlug && BOX_DEPARTMENT_MAP[thread.boxSlug] === view) return true;
    if (thread.lastAuthorUserId && SYSTEM_SENDER_DEPARTMENT_MAP[thread.lastAuthorUserId] === view) return true;
    if (thread.lastAuthorUserId && thread.lastAuthorUserId !== activeMailboxUserId && departmentByUserId.get(thread.lastAuthorUserId) === view) return true;

    const participantDepartments = (thread.participantUserIds || [])
      .filter((userId) => userId !== activeMailboxUserId)
      .map((userId) => departmentByUserId.get(userId))
      .filter(Boolean);

    return participantDepartments.includes(view);
  }, [departmentByUserId, mailboxUserId]);

  const mailboxScopedThreads = useMemo(
    () => mailboxThreads.filter((thread) => threadMatchesMailboxView(thread, mailboxView)),
    [mailboxThreads, mailboxView, threadMatchesMailboxView],
  );

  const departmentCounts = useMemo(() => {
    const counts: Record<DepartmentView, number> = {
      all: mailboxScopedThreads.length,
      COMMAND: 0,
      OPERATIONS: 0,
      SECURITY: 0,
      HUMAN_RESOURCES: 0,
    };

    for (const department of DEPARTMENT_META) {
      if (department.value === "all") continue;
      counts[department.value] = mailboxScopedThreads.filter((thread) => (
        threadMatchesDepartmentView(thread, department.value, mailboxUserId)
      )).length;
    }

    return counts;
  }, [mailboxScopedThreads, mailboxUserId, threadMatchesDepartmentView]);

  const filteredThreads = useMemo(() => {
    const token = deferredSearch.trim().toLowerCase();
    return mailboxScopedThreads.filter((thread) => {
      if (!threadMatchesDepartmentView(thread, departmentView, mailboxUserId)) return false;
      if (!token) return true;

      return [
        threadLabel(thread),
        thread.subject,
        thread.preview,
        thread.boxLabel,
        thread.counterpartLabel,
      ].some((value) => String(value || "").toLowerCase().includes(token));
    });
  }, [deferredSearch, departmentView, mailboxScopedThreads, mailboxUserId, threadMatchesDepartmentView]);

  const activeMailboxMeta = MAILBOX_META[mailboxView];

  function editorRefForTarget(target: RichComposerTarget) {
    return target === "reply" ? replyEditorRef : composeEditorRef;
  }

  function currentBodyForTarget(target: RichComposerTarget) {
    return target === "reply" ? composerBody : composeMessage;
  }

  function currentFontForTarget(target: RichComposerTarget) {
    return target === "reply" ? composerFontFamily : composeFontFamily;
  }

  function setBodyForTarget(target: RichComposerTarget, nextHtml: string) {
    if (target === "reply") {
      setComposerBody(nextHtml);
      return;
    }
    setComposeMessage(nextHtml);
  }

  function setFontForTarget(target: RichComposerTarget, nextFont: string) {
    if (target === "reply") {
      setComposerFontFamily(nextFont);
      if (replyEditorRef.current) replyEditorRef.current.style.fontFamily = nextFont;
      return;
    }
    setComposeFontFamily(nextFont);
    if (composeEditorRef.current) composeEditorRef.current.style.fontFamily = nextFont;
  }

  function currentColorForTarget(target: RichComposerTarget) {
    return target === "reply" ? composerTextColor : composeTextColor;
  }

  function setColorForTarget(target: RichComposerTarget, nextColor: string) {
    if (target === "reply") {
      setComposerTextColor(nextColor);
      return;
    }
    setComposeTextColor(nextColor);
  }

  const syncEditorFromState = useCallback((target: RichComposerTarget, nextHtml: string, nextFont: string) => {
    const editor = (target === "reply" ? replyEditorRef : composeEditorRef).current;
    if (!editor) return;
    const normalized = normalizeRichBody(nextHtml);
    if (editor.innerHTML !== normalized) {
      editor.innerHTML = normalized;
    }
    editor.style.fontFamily = nextFont || DEFAULT_CAVCHAT_FONT_FAMILY;
  }, []);

  function updateBodyFromEditor(target: RichComposerTarget) {
    const editor = editorRefForTarget(target).current;
    if (!editor) return;
    setBodyForTarget(target, editor.innerHTML);
  }

  function focusEditor(target: RichComposerTarget) {
    const editor = editorRefForTarget(target).current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    if (!editor.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function insertHtmlAtCursor(target: RichComposerTarget, html: string) {
    const editor = editorRefForTarget(target).current;
    if (!editor) return;
    focusEditor(target);
    const inserted = document.execCommand("insertHTML", false, html);
    if (!inserted) {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      range.insertNode(fragment);
      range.collapse(false);
    }
    updateBodyFromEditor(target);
  }

  function applyEditorCommand(target: RichComposerTarget, command: string, value?: string) {
    focusEditor(target);
    document.execCommand(command, false, value);
    updateBodyFromEditor(target);
  }

  function applyEditorColor(target: RichComposerTarget, color: string) {
    focusEditor(target);
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
    setColorForTarget(target, color);
    updateBodyFromEditor(target);
    setColorMenuTarget(null);
  }

  function closeToolSurfaces() {
    setFormatMenuTarget(null);
    setColorMenuTarget(null);
    setEmojiMenuTarget(null);
    setAiToneMenuTarget(null);
  }

  function resetComposerSurfaces() {
    closeToolSurfaces();
    setLinkModalTarget(null);
    setLinkUrl("");
    setLinkLabel("");
    setAiModalTarget(null);
    setAiToneMenuTarget(null);
    setAiInstruction("");
    setAiDraft("");
    setAiTone("Professional");
    setCavCloudModalTarget(null);
    setCavCloudQuery("");
    setCavCloudFiles([]);
    setCavCloudError("");
  }

  function openLinkModal(target: RichComposerTarget) {
    closeToolSurfaces();
    setLinkModalTarget(target);
    setLinkUrl("");
    setLinkLabel("");
  }

  function openAiModal(target: RichComposerTarget) {
    closeToolSurfaces();
    setAiModalTarget((current) => {
      if (current === target) {
        setAiToneMenuTarget(null);
        return null;
      }
      setAiToneMenuTarget(null);
      setAiDraft("");
      setAiInstruction("");
      setAiTone("Professional");
      return target;
    });
  }

  function openCavCloudModal(target: RichComposerTarget) {
    closeToolSurfaces();
    setCavCloudModalTarget(target);
    setCavCloudQuery("");
    setCavCloudFiles([]);
    setCavCloudError("");
  }

  function toggleFormatMenu(target: RichComposerTarget) {
    setEmojiMenuTarget(null);
    setColorMenuTarget(null);
    setFormatMenuTarget((current) => current === target ? null : target);
  }

  function toggleColorMenu(target: RichComposerTarget) {
    setEmojiMenuTarget(null);
    setColorMenuTarget((current) => current === target ? null : target);
  }

  function toggleEmojiMenu(target: RichComposerTarget) {
    setFormatMenuTarget(null);
    setColorMenuTarget(null);
    setEmojiMenuTarget((current) => current === target ? null : target);
  }

  function applyLinkModal() {
    if (!linkModalTarget) return;
    const href = String(linkUrl || "").trim();
    if (!href) return;
    const label = String(linkLabel || "").trim() || href;
    insertHtmlAtCursor(linkModalTarget, `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    setLinkModalTarget(null);
    setLinkUrl("");
    setLinkLabel("");
  }

  function insertEmoji(target: RichComposerTarget, emoji: string) {
    insertHtmlAtCursor(target, escapeHtml(emoji));
    setEmojiMenuTarget(null);
  }

  function addFilesToTarget(target: RichComposerTarget, files: File[], kind: "attachment" | "photo") {
    const valid = Array.from(files || []);
    if (!valid.length) return;
    if (target === "reply") {
      setAttachments((current) => [...current, ...valid]);
    } else {
      setComposeAttachments((current) => [...current, ...valid]);
    }
    const html = buildInsertedLinesHtml(kind === "photo" ? "Photo attached" : "Attachment", valid.map((file) => file.name));
    if (html) insertHtmlAtCursor(target, html);
  }

  const loadCavCloudFiles = useCallback(async (query = cavCloudQuery) => {
    if (!cavCloudModalTarget) return;
    setCavCloudLoading(true);
    setCavCloudError("");
    try {
      const rootRes = await fetch("/api/cavcloud/root", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const rootPayload = await rootRes.json().catch(() => ({})) as {
        ok?: boolean;
        rootFolderId?: string;
        defaultFolderId?: string;
        root?: { id?: string };
        defaultFolder?: { id?: string };
      };
      if (!rootRes.ok || rootPayload.ok !== true) {
        throw new Error("Unable to load CavCloud root.");
      }
      const folderId = String(
        rootPayload.rootFolderId
        || rootPayload.defaultFolderId
        || rootPayload.root?.id
        || rootPayload.defaultFolder?.id
        || "root"
      ).trim() || "root";
      setCavCloudRootFolderId(folderId);

      const searchRes = await fetch(`/api/cavcloud/search?folderId=${encodeURIComponent(folderId)}&q=${encodeURIComponent(String(query || "").trim())}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const searchPayload = await searchRes.json().catch(() => ({})) as {
        ok?: boolean;
        files?: CavCloudPickerFile[];
      };
      if (!searchRes.ok || searchPayload.ok !== true) {
        throw new Error("Unable to load CavCloud files.");
      }
      setCavCloudFiles(Array.isArray(searchPayload.files) ? searchPayload.files.slice(0, 24) : []);
    } catch (error) {
      setCavCloudError(error instanceof Error ? error.message : "Unable to load CavCloud files.");
    } finally {
      setCavCloudLoading(false);
    }
  }, [cavCloudModalTarget, cavCloudQuery]);

  function insertCavCloudFile(file: CavCloudPickerFile) {
    if (!cavCloudModalTarget) return;
    const href = `/cavcloud/view/${encodeURIComponent(file.id)}`;
    const label = `${file.name} (${file.path})`;
    insertHtmlAtCursor(
      cavCloudModalTarget,
      `<p><strong>CavCloud:</strong> <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`,
    );
    setCavCloudModalTarget(null);
  }

  async function runMessengerAssist() {
    if (!aiModalTarget) return;
    setAiBusy(true);
    setFeedback("");
    try {
      const targetBodyText = richHtmlToPlainText(currentBodyForTarget(aiModalTarget));
      const recipientLine = aiModalTarget === "compose"
        ? `To: ${composeTo || "Not set"}${composeCc ? ` | Cc: ${composeCc}` : ""}${composeBcc ? ` | Bcc: ${composeBcc}` : ""}`
        : `Thread participants: ${(activeThread?.participants || []).map((participant) => participant.name).join(", ") || "Current staff thread"}`;
      const subjectLine = aiModalTarget === "compose"
        ? `Subject: ${composeSubject || "Not set"}`
        : `Subject: ${activeThread?.subject || "Reply"}`;
      const prompt = [
        "Write a polished CavChat staff message body only. No commentary, no bullets unless naturally needed, no markdown fences.",
        `Tone: ${aiTone}.`,
        recipientLine,
        subjectLine,
        targetBodyText ? `Current draft:\n${targetBodyText}` : "Current draft is blank.",
        aiInstruction ? `What to write:\n${aiInstruction}` : "Help me write a clear internal staff message.",
      ].join("\n\n");

      const response = await fetch("/api/ai/center/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          action: "email_text_agent",
          surface: "general",
          prompt,
          model: ALIBABA_QWEN_PLUS_MODEL_ID,
          reasoningLevel: "low",
          contextLabel: "CavChat Messenger",
          context: {
            source: "admin.cavchat",
            channel: "staff_messaging",
            target: aiModalTarget,
            assistant: "Messenger",
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        data?: { answer?: string };
        message?: string;
        error?: string;
      };
      if (!response.ok || payload.ok !== true || !payload.data?.answer) {
        throw new Error(String(payload.message || payload.error || "Help me write failed."));
      }
      setAiDraft(String(payload.data.answer || "").trim());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Help me write failed.");
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiDraft(mode: "replace" | "append") {
    if (!aiModalTarget || !aiDraft.trim()) return;
    const nextHtml = plainTextToRichHtml(aiDraft);
    if (mode === "replace") {
      setBodyForTarget(aiModalTarget, nextHtml);
      syncEditorFromState(aiModalTarget, nextHtml, currentFontForTarget(aiModalTarget));
    } else {
      const merged = `${currentBodyForTarget(aiModalTarget)}${currentBodyForTarget(aiModalTarget) ? "<p><br></p>" : ""}${nextHtml}`;
      setBodyForTarget(aiModalTarget, merged);
      syncEditorFromState(aiModalTarget, merged, currentFontForTarget(aiModalTarget));
    }
    setAiModalTarget(null);
    setAiDraft("");
    setAiInstruction("");
  }

  function renderInlineAiComposer(target: RichComposerTarget) {
    if (aiModalTarget !== target) return null;

    return (
      <div className="hq-chatComposerAiShell">
        <button
          className="hq-chatComposerAiClose"
          type="button"
          aria-label="Close help me write"
          onClick={() => {
            setAiModalTarget(null);
            setAiToneMenuTarget(null);
            setAiDraft("");
          }}
        >
          <span className="cb-closeIcon" aria-hidden="true" />
        </button>

        <div className="hq-chatComposerAiPanel">
          {aiBusy || aiDraft ? (
            <div className="hq-chatComposerAiDraft">
              <span className="hq-chatComposerAiDraftLogo" aria-hidden="true">
                <ComposerGlyph icon="cavai" />
              </span>
              <div className="hq-chatComposerAiDraftBody">
                {aiBusy ? "CavAi Messenger is drafting this CavChat message…" : aiDraft}
              </div>
            </div>
          ) : null}

          <label className="hq-chatComposerAiPromptField">
            <textarea
              className="hq-textarea hq-chatComposerAiPrompt"
              rows={5}
              value={aiInstruction}
              onChange={(event) => setAiInstruction(event.currentTarget.value)}
              placeholder="Help me write"
            />
            <div className="hq-chatComposerAiPromptTools">
              <div className="hq-chatComposerAiToneWrap">
                <button
                  className="hq-chatComposerAiToneButton"
                  type="button"
                  aria-label={`Tone ${aiTone}. Open tone menu`}
                  aria-haspopup="menu"
                  aria-expanded={aiToneMenuTarget === target}
                  onClick={() => setAiToneMenuTarget((current) => current === target ? null : target)}
                >
                  <span className="hq-chatComposerAiToneGlyph" aria-hidden="true" />
                </button>

                {aiToneMenuTarget === target ? (
                  <div className="hq-chatComposerAiToneMenu" role="menu" aria-label="Choose CavAi tone">
                    {CAVCHAT_AI_TONES.map((tone) => (
                      <button
                        key={tone}
                        className="hq-chatComposerAiToneOption"
                        type="button"
                        role="menuitemradio"
                        aria-checked={aiTone === tone}
                        data-active={aiTone === tone}
                        onClick={() => {
                          setAiTone(tone);
                          setAiToneMenuTarget(null);
                        }}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                className="hq-chatComposerAiPromptSend"
                type="button"
                aria-label={aiDraft ? "Try again with CavAi" : "Help me write with CavAi"}
                title={aiDraft ? "Try again" : "Help me write"}
                onClick={() => { void runMessengerAssist(); }}
                disabled={aiBusy || !aiInstruction.trim()}
              >
                <span className="hq-chatComposerAiPromptSendGlyph" aria-hidden="true" />
              </button>
            </div>
          </label>

          {aiDraft ? (
            <div className="hq-chatComposerAiActions">
              <button
                className="hq-button hq-chatSendButton"
                type="button"
                onClick={() => applyAiDraft("replace")}
                disabled={!aiDraft.trim()}
              >
                Use it
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  useEffect(() => {
    if (isOversight) return;
    const stored = readStoredMailboxState(mailboxUserId);
    setTrashedThreadIds(stored.trashedThreadIds || []);
    setPurgedThreadIds(stored.purgedThreadIds || []);
    setImportantThreadIds(stored.importantThreadIds || []);
    setSelectedThreadIds([]);
    setSelectAllVisibleActive(false);
    setBulkMoveMenuOpen(false);
  }, [isOversight, mailboxUserId]);

  useEffect(() => {
    if (isOversight) return;
    writeStoredMailboxState(mailboxUserId, {
      trashedThreadIds,
      purgedThreadIds,
      importantThreadIds,
    });
  }, [importantThreadIds, isOversight, mailboxUserId, purgedThreadIds, trashedThreadIds]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const sync = (event?: MediaQueryList | MediaQueryListEvent) => {
      setIsSmallScreen(Boolean((event || mediaQuery).matches));
    };
    sync(mediaQuery);
    const listener = (event: MediaQueryListEvent) => sync(event);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    if (!bulkMoveMenuOpen) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!bulkMoveMenuRef.current?.contains(event.target as Node)) {
        setBulkMoveMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBulkMoveMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [bulkMoveMenuOpen]);

  useEffect(() => {
    setSelectedThreadIds((current) => current.filter((threadId) => mailboxThreads.some((thread) => thread.id === threadId)));
  }, [mailboxThreads]);

  useEffect(() => {
    if (!selectAllVisibleActive) return;
    const visibleThreadIds = filteredThreads.map((thread) => thread.id);
    const allVisibleSelected = visibleThreadIds.length > 0 && visibleThreadIds.every((threadId) => selectedThreadIdSet.has(threadId));
    if (!allVisibleSelected) {
      setSelectAllVisibleActive(false);
    }
  }, [filteredThreads, selectAllVisibleActive, selectedThreadIdSet]);

  useEffect(() => {
    syncEditorFromState("reply", composerBody, composerFontFamily);
  }, [composerBody, composerFontFamily, syncEditorFromState]);

  useEffect(() => {
    syncEditorFromState("compose", composeMessage, composeFontFamily);
  }, [composeFontFamily, composeMessage, composeLauncherOpen, syncEditorFromState]);

  useEffect(() => {
    if (!cavCloudModalTarget) return;
    void loadCavCloudFiles(cavCloudQuery);
  }, [cavCloudModalTarget, cavCloudQuery, loadCavCloudFiles]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileSidebarOpen]);

  const buildThreadsQuery = useCallback((nextSearch = search, nextMailboxUserId = mailboxUserId) => {
    const params = new URLSearchParams();
    const searchToken = String(nextSearch || "").trim();
    if (searchToken) params.set("search", searchToken);
    if (isOversight && nextMailboxUserId) params.set("mailboxUserId", nextMailboxUserId);
    if (isOversight) params.set("includeOrgBoxes", "1");
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [isOversight, mailboxUserId, search]);

  const buildThreadDetailQuery = useCallback((nextMailboxUserId = mailboxUserId) => {
    const params = new URLSearchParams();
    if (isOversight && nextMailboxUserId) params.set("mailboxUserId", nextMailboxUserId);
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [isOversight, mailboxUserId]);

  const loadThreads = useCallback(async (nextSearch = search, nextMailboxUserId = mailboxUserId) => {
    const response = await fetch(`/api/admin/chat/threads${buildThreadsQuery(nextSearch, nextMailboxUserId)}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(String(payload?.error || "Unable to load inbox."));
    }
    setThreads(payload.threads || []);
    return payload.threads as ThreadListItem[];
  }, [buildThreadsQuery, mailboxUserId, search]);

  const fetchThreadDetail = useCallback(async (threadId: string, nextMailboxUserId = mailboxUserId) => {
    const response = await fetch(`/api/admin/chat/threads/${threadId}${buildThreadDetailQuery(nextMailboxUserId)}`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(String(payload?.error || "Unable to open thread."));
    }
    return payload.thread as ThreadDetail;
  }, [buildThreadDetailQuery, mailboxUserId]);

  async function openThread(threadId: string, nextMailboxUserId = mailboxUserId) {
    if (Date.now() < suppressOpenUntilRef.current) return;
    setBusyKey(`open:${threadId}`);
    setFeedback("");
    setMobileSidebarOpen(false);
    setComposeLauncherOpen(false);
    setReplyComposerOpen(false);
    setSelectedThreadIds([]);
    setSelectAllVisibleActive(false);
    setBulkMoveMenuOpen(false);
    resetComposerSurfaces();
    try {
      const thread = await fetchThreadDetail(threadId, nextMailboxUserId);
      const draft = parseRichDraftEnvelope(thread?.draft?.body || "");
      setActiveThreadId(threadId);
      setActiveThread(thread);
      setComposerBody(draft.html);
      setComposerFontFamily(draft.fontFamily);
      setAttachments([]);

      if (!isOversight) {
        setThreads((current) => current.map((item) => (
          item.id === threadId
            ? { ...item, unread: false }
            : item
        )));
        await fetch(`/api/admin/chat/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "mark_read" }),
        }).catch(() => null);
        await loadThreads(search, nextMailboxUserId).catch(() => null);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to open thread.");
    } finally {
      setBusyKey("");
    }
  }

  const saveDraft = useCallback(async (nextBody: string) => {
    if (isOversight || !activeThreadId) return;
    const response = await fetch("/api/admin/chat/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        threadId: activeThreadId,
        body: serializeRichDraftEnvelope({
          html: nextBody,
          fontFamily: composerFontFamily,
        }),
      }),
    }).catch(() => null);
    if (!response?.ok) return;
    const savedAt = new Date().toISOString();
    setThreads((current) => current.map((thread) => (
      thread.id === activeThreadId
        ? { ...thread, draftBody: nextBody || null, draftUpdatedAt: savedAt }
        : thread
    )));
    setActiveThread((current) => (
      current && current.id === activeThreadId
        ? {
            ...current,
            draft: {
              body: serializeRichDraftEnvelope({
                html: nextBody,
                fontFamily: composerFontFamily,
              }),
              updatedAt: savedAt,
            },
          }
        : current
    ));
  }, [activeThreadId, composerFontFamily, isOversight]);

  useEffect(() => {
    if (isOversight || !activeThreadId) return;
    const timer = window.setTimeout(() => {
      void saveDraft(composerBody);
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, composerBody, composerFontFamily, isOversight, saveDraft]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadThreads(search, mailboxUserId).catch(() => null);
    }, 20_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadThreads, mailboxUserId, search]);

  useEffect(() => {
    if (isOversight) return;
    if (!activeThreadId) return;
    if (threads.some((thread) => thread.id === activeThreadId)) return;
    setActiveThreadId(null);
    setActiveThread(null);
    setComposerBody("");
    setReplyComposerOpen(false);
  }, [activeThreadId, isOversight, threads]);

  useEffect(() => {
    if (!isOversight) return;
    let cancelled = false;

    async function syncOversightMailbox() {
      setBusyKey("mailbox");
      setFeedback("");
      try {
        const nextThreads = await loadThreads(search, mailboxUserId);
        if (cancelled) return;

        const nextActiveThreadId = activeThreadId && nextThreads.some((thread) => thread.id === activeThreadId)
          ? activeThreadId
          : null;

        if (!nextActiveThreadId) {
          setActiveThreadId(null);
          setActiveThread(null);
          setComposerBody("");
          setComposerFontFamily(DEFAULT_CAVCHAT_FONT_FAMILY);
          return;
        }

        const detail = await fetchThreadDetail(nextActiveThreadId, mailboxUserId);
        const draft = parseRichDraftEnvelope(detail.draft?.body || "");
        if (cancelled) return;
        setActiveThreadId(nextActiveThreadId);
        setActiveThread(detail);
        setComposerBody(draft.html);
        setComposerFontFamily(draft.fontFamily);
      } catch (error) {
        if (!cancelled) {
          setFeedback(error instanceof Error ? error.message : "Unable to load oversight mailbox.");
        }
      } finally {
        if (!cancelled) setBusyKey("");
      }
    }

    void syncOversightMailbox();
    return () => {
      cancelled = true;
    };
  }, [activeThreadId, fetchThreadDetail, isOversight, loadThreads, mailboxUserId, search]);

  async function sendMessage() {
    if (isOversight || !activeThreadId) return;
    setBusyKey("send");
    setFeedback("");
    try {
      const sanitizedHtml = sanitizeRichHtmlClient(composerBody);
      const plainBody = richHtmlToPlainText(sanitizedHtml);
      let response: Response;
      if (attachments.length) {
        const formData = new FormData();
        formData.set("body", plainBody);
        formData.set("bodyHtml", sanitizedHtml);
        formData.set("fontFamily", composerFontFamily);
        for (const file of attachments) {
          formData.append("attachments", file);
        }
        response = await fetch(`/api/admin/chat/threads/${activeThreadId}/messages`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });
      } else {
        response = await fetch(`/api/admin/chat/threads/${activeThreadId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            body: plainBody,
            bodyHtml: sanitizedHtml,
            fontFamily: composerFontFamily,
          }),
        });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Unable to send message."));
      }
      setComposerBody("");
      setComposerFontFamily(DEFAULT_CAVCHAT_FONT_FAMILY);
      setAttachments([]);
      setActiveThread(payload.thread || null);
      setActiveThreadId(payload.thread?.id || activeThreadId);
      setReplyComposerOpen(false);
      resetComposerSurfaces();
      await loadThreads(search);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setBusyKey("");
    }
  }

  async function toggleArchive(nextArchived: boolean) {
    if (isOversight || !activeThreadId) return;
    setBusyKey("archive");
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/chat/threads/${activeThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: nextArchived ? "archive" : "unarchive",
          archived: nextArchived,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Unable to update thread."));
      }
      setActiveThread(payload.thread || null);
      await loadThreads(search);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to update thread.");
    } finally {
      setBusyKey("");
    }
  }

  function resetComposeBox() {
    resetComposerSurfaces();
    setComposeLauncherOpen(false);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeMessage("");
    setComposeFontFamily(DEFAULT_CAVCHAT_FONT_FAMILY);
    setComposeAttachments([]);
    setComposeCcOpen(false);
    setComposeBccOpen(false);
  }

  function openComposeBox() {
    setMobileSidebarOpen(false);
    setComposeLauncherOpen(true);
  }

  function resolveComposeRecipients(value: string) {
    const rawTokens = tokenizeRecipientInput(value);
    const resolved = [];
    const unresolved = [];

    for (const rawToken of rawTokens) {
      const token = normalizeRecipientToken(rawToken);
      if (!token) continue;

      const exactMatch = props.staffOptions.find((staff) => (
        String(staff.email || "").trim().toLowerCase() === token
        || String(staff.name || "").trim().toLowerCase() === token
        || `${String(staff.name || "").trim()} <${String(staff.email || "").trim()}>`.toLowerCase() === token
      ));
      if (exactMatch) {
        resolved.push(exactMatch);
        continue;
      }

      const fuzzyMatches = props.staffOptions.filter((staff) => (
        String(staff.email || "").trim().toLowerCase().includes(token)
        || String(staff.name || "").trim().toLowerCase().includes(token)
      ));
      if (fuzzyMatches.length === 1) {
        resolved.push(fuzzyMatches[0]!);
        continue;
      }

      unresolved.push(rawToken);
    }

    return {
      resolved: Array.from(new Map(resolved.map((staff) => [staff.userId, staff])).values()),
      unresolved,
    };
  }

  async function sendComposedThread() {
    if (isOversight) return;
    setBusyKey("compose-send");
    setFeedback("");
    try {
      const toResult = resolveComposeRecipients(composeTo);
      const ccResult = resolveComposeRecipients(composeCc);
      const bccResult = resolveComposeRecipients(composeBcc);
      const unresolved = [...toResult.unresolved, ...ccResult.unresolved, ...bccResult.unresolved];
      if (unresolved.length) {
        throw new Error(`Unrecognized recipients: ${unresolved.join(", ")}`);
      }

      const recipients = Array.from(new Map(
        [...toResult.resolved, ...ccResult.resolved, ...bccResult.resolved]
          .filter((staff) => staff.userId !== props.currentUserId)
          .map((staff) => [staff.userId, staff]),
      ).values());

      if (!recipients.length) {
        throw new Error("Add at least one staff recipient.");
      }

      const createResponse = await fetch("/api/admin/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          participantUserIds: recipients.map((staff) => staff.userId),
          subject: composeSubject.trim() || recipients.map((staff) => staff.name).join(", "),
        }),
      });
      const createPayload = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok || !createPayload?.ok || !createPayload?.thread?.id) {
        throw new Error(String(createPayload?.error || "Unable to start composed thread."));
      }

      let threadDetail = createPayload.thread as ThreadDetail;
      const sanitizedHtml = sanitizeRichHtmlClient(composeMessage);
      const plainBody = richHtmlToPlainText(sanitizedHtml);
      if (plainBody.trim() || composeAttachments.length) {
        let messageResponse: Response;
        if (composeAttachments.length) {
          const formData = new FormData();
          formData.set("body", plainBody);
          formData.set("bodyHtml", sanitizedHtml);
          formData.set("fontFamily", composeFontFamily);
          for (const file of composeAttachments) {
            formData.append("attachments", file);
          }
          messageResponse = await fetch(`/api/admin/chat/threads/${createPayload.thread.id}/messages`, {
            method: "POST",
            credentials: "include",
            body: formData,
          });
        } else {
          messageResponse = await fetch(`/api/admin/chat/threads/${createPayload.thread.id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              body: plainBody,
              bodyHtml: sanitizedHtml,
              fontFamily: composeFontFamily,
            }),
          });
        }

        const messagePayload = await messageResponse.json().catch(() => ({}));
        if (!messageResponse.ok || !messagePayload?.ok) {
          throw new Error(String(messagePayload?.error || "Unable to send composed message."));
        }
        threadDetail = messagePayload.thread as ThreadDetail;
      }

      resetComposeBox();
      setMailboxView("inbox");
      setActiveThreadId(threadDetail.id);
      setActiveThread(threadDetail);
      setComposerBody(parseRichDraftEnvelope(threadDetail.draft?.body || "").html);
      setComposerFontFamily(parseRichDraftEnvelope(threadDetail.draft?.body || "").fontFamily);
      resetComposerSurfaces();
      await loadThreads(search);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to send composed message.");
    } finally {
      setBusyKey("");
    }
  }

  function closeThreadView() {
    resetComposerSurfaces();
    setActiveThreadId(null);
    setActiveThread(null);
    setReplyComposerOpen(false);
    setAttachments([]);
    setComposerBody("");
    setComposerFontFamily(DEFAULT_CAVCHAT_FONT_FAMILY);
  }

  function selectMailboxView(nextView: MailboxView) {
    setMailboxView(nextView);
    setMobileSidebarOpen(false);
    setSelectedThreadIds([]);
    setSelectAllVisibleActive(false);
    setBulkMoveMenuOpen(false);
    if (!isOversight) {
      closeThreadView();
    }
  }

  function selectDepartmentView(nextView: DepartmentView) {
    setDepartmentView(nextView);
    setMobileSidebarOpen(false);
    setSelectedThreadIds([]);
    setSelectAllVisibleActive(false);
    setBulkMoveMenuOpen(false);
    if (!isOversight) {
      closeThreadView();
    }
  }

  function toggleThreadSelected(threadId: string) {
    setSelectAllVisibleActive(false);
    setSelectedThreadIds((current) => (
      current.includes(threadId)
        ? current.filter((value) => value !== threadId)
        : [...current, threadId]
    ));
  }

  function clearSelectedThreads() {
    setSelectedThreadIds([]);
    setSelectAllVisibleActive(false);
    setBulkMoveMenuOpen(false);
  }

  function toggleSelectAllVisibleThreads() {
    const visibleThreadIds = filteredThreads.map((thread) => thread.id);
    if (!visibleThreadIds.length) return;
    const allSelected = visibleThreadIds.every((threadId) => selectedThreadIdSet.has(threadId));
    if (selectAllVisibleActive && allSelected) {
      setSelectAllVisibleActive(false);
      setSelectedThreadIds((current) => current.filter((threadId) => !visibleThreadIds.includes(threadId)));
      return;
    }
    setSelectAllVisibleActive(true);
    setSelectedThreadIds((current) => Array.from(new Set([...current, ...visibleThreadIds])));
  }

  async function moveSelectedThreadsTo(target: MailboxView) {
    if (isOversight || !selectedThreadIds.length) return;
    const threadIds = [...selectedThreadIds];
    setBulkMoveMenuOpen(false);

    if (target === "important") {
      setImportantThreadIds((current) => Array.from(new Set([...current, ...threadIds])));
      setSelectedThreadIds([]);
      setSelectAllVisibleActive(false);
      return;
    }

    if (target === "trash") {
      for (const threadId of threadIds) {
        await moveThreadToTrash(threadId, { skipBusyState: true });
      }
      setSelectedThreadIds([]);
      setSelectAllVisibleActive(false);
      return;
    }

    if (target === "inbox") {
      for (const threadId of threadIds) {
        if (trashedThreadIdSet.has(threadId)) {
          await restoreThreadFromTrash(threadId, { skipBusyState: true });
        } else {
          await moveThreadToArchive(threadId, false, { skipBusyState: true });
        }
      }
      setSelectedThreadIds([]);
      setSelectAllVisibleActive(false);
      return;
    }

    if (target === "archive") {
      for (const threadId of threadIds) {
        if (trashedThreadIdSet.has(threadId)) {
          setTrashedThreadIds((current) => current.filter((value) => value !== threadId));
        }
        await moveThreadToArchive(threadId, true, { skipBusyState: true });
      }
      setSelectedThreadIds([]);
      setSelectAllVisibleActive(false);
      return;
    }
  }

  async function deleteSelectedThreads() {
    await moveSelectedThreadsTo("trash");
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function beginRowTouch(threadId: string, event: ReactTouchEvent<HTMLDivElement>) {
    if (isOversight || !isSmallScreen || selectedThreadIds.length) return;
    const touch = event.touches[0];
    if (!touch) return;

    clearLongPressTimer();
    gestureStateRef.current = {
      threadId,
      startX: touch.clientX,
      startY: touch.clientY,
      longPressed: false,
    };
    swipeOffsetsRef.current[threadId] = 0;

    longPressTimerRef.current = window.setTimeout(() => {
      const gesture = gestureStateRef.current;
      if (!gesture || gesture.threadId !== threadId) return;
      gesture.longPressed = true;
      suppressOpenUntilRef.current = Date.now() + 500;
      setSelectedThreadIds((current) => (
        current.includes(threadId)
          ? current
          : [...current, threadId]
      ));
    }, 700);
  }

  function moveRowTouch(threadId: string, event: ReactTouchEvent<HTMLDivElement>) {
    const gesture = gestureStateRef.current;
    if (isOversight || !isSmallScreen || !gesture || gesture.threadId !== threadId) return;
    const touch = event.touches[0];
    if (!touch) return;

    const offsetX = touch.clientX - gesture.startX;
    const offsetY = touch.clientY - gesture.startY;
    if (Math.abs(offsetX) > 8 || Math.abs(offsetY) > 8) {
      clearLongPressTimer();
    }

    if (selectedThreadIds.length || gesture.longPressed) return;
    if (Math.abs(offsetX) <= Math.abs(offsetY) || Math.abs(offsetX) < 12) return;

    const nextOffset = Math.max(-132, Math.min(132, offsetX));
    swipeOffsetsRef.current[threadId] = nextOffset;
    setSwipeOffsets((current) => ({ ...current, [threadId]: nextOffset }));
    event.preventDefault();
  }

  function endRowTouch(threadId: string) {
    const gesture = gestureStateRef.current;
    clearLongPressTimer();
    if (!gesture || gesture.threadId !== threadId) return;

    const finalOffset = swipeOffsetsRef.current[threadId] || 0;
    if (gesture.longPressed) {
      gestureStateRef.current = null;
      setSwipeOffsets((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      delete swipeOffsetsRef.current[threadId];
      return;
    }

    if (!selectedThreadIds.length && Math.abs(finalOffset) >= 88) {
      suppressOpenUntilRef.current = Date.now() + 500;
      setSwipeOffsets((current) => ({ ...current, [threadId]: finalOffset > 0 ? 148 : -148 }));
      swipeOffsetsRef.current[threadId] = finalOffset > 0 ? 148 : -148;
      window.setTimeout(() => {
        void moveThreadToTrash(threadId, { skipBusyState: true });
      }, 120);
    } else {
      setSwipeOffsets((current) => ({ ...current, [threadId]: 0 }));
      swipeOffsetsRef.current[threadId] = 0;
      window.setTimeout(() => {
        setSwipeOffsets((current) => {
          const next = { ...current };
          delete next[threadId];
          return next;
        });
        delete swipeOffsetsRef.current[threadId];
      }, 160);
    }

    gestureStateRef.current = null;
  }

  function cancelRowTouch(threadId: string) {
    clearLongPressTimer();
    gestureStateRef.current = null;
    swipeOffsetsRef.current[threadId] = 0;
    setSwipeOffsets((current) => ({ ...current, [threadId]: 0 }));
    window.setTimeout(() => {
      setSwipeOffsets((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      delete swipeOffsetsRef.current[threadId];
    }, 160);
  }

  async function toggleThreadStar(threadId: string, starred: boolean) {
    if (isOversight) return;
    setBusyKey(`star:${threadId}`);
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/chat/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: starred ? "star" : "unstar",
          starred,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Unable to update star."));
      }
      setThreads((current) => current.map((thread) => (
        thread.id === threadId
          ? { ...thread, starred }
          : thread
      )));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to update star.");
    } finally {
      setBusyKey("");
    }
  }

  function renderComposerToolbar(target: RichComposerTarget) {
    const fontValue = currentFontForTarget(target);
    const colorValue = currentColorForTarget(target);
    return (
      <>
        {formatMenuTarget === target ? (
          <div className="hq-chatComposerFloatingPanel">
            <div className="hq-chatComposerFloatingPanelHead">Format</div>
            <div className="hq-chatComposerFormatTopRow">
              <div className="hq-chatComposerFontSelectWrap">
                <select
                  className="hq-select hq-chatComposerFontSelect"
                  value={fontValue}
                  onChange={(event) => setFontForTarget(target, event.currentTarget.value)}
                >
                  {CAVCHAT_FONT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.family}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="hq-chatComposerColorPicker" role="group" aria-label="Text color">
                <button
                  className="hq-chatComposerColorTrigger"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={colorMenuTarget === target}
                  onClick={() => toggleColorMenu(target)}
                >
                  <span className="hq-chatComposerColorA">A</span>
                  <span className="hq-chatComposerColorLine" style={{ background: colorValue }} />
                </button>
                {colorMenuTarget === target ? (
                  <div className="hq-chatComposerColorPanel" role="dialog" aria-label="Text color">
                    {CAVCHAT_FORMAT_COLORS.map((color) => (
                      <button
                        key={color.value}
                        className="hq-chatComposerColorChip"
                        type="button"
                        data-active={colorValue === color.value}
                        aria-label={color.label}
                        title={color.label}
                        onClick={() => applyEditorColor(target, color.value)}
                      >
                        <span className="hq-chatComposerColorChipLine" style={{ background: color.value }} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="hq-chatComposerFormatActions">
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Bold" aria-label="Bold" onClick={() => applyEditorCommand(target, "bold")}>
                <FormatGlyph icon="bold" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Italic" aria-label="Italic" onClick={() => applyEditorCommand(target, "italic")}>
                <FormatGlyph icon="italic" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Underline" aria-label="Underline" onClick={() => applyEditorCommand(target, "underline")}>
                <FormatGlyph icon="underline" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Strikethrough" aria-label="Strikethrough" onClick={() => applyEditorCommand(target, "strikeThrough")}>
                <FormatGlyph icon="strikethrough" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Bulleted list" aria-label="Bulleted list" onClick={() => applyEditorCommand(target, "insertUnorderedList")}>
                <FormatGlyph icon="bullets" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Numbered list" aria-label="Numbered list" onClick={() => applyEditorCommand(target, "insertOrderedList")}>
                <FormatGlyph icon="numbers" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Quote" aria-label="Quote" onClick={() => applyEditorCommand(target, "formatBlock", "blockquote")}>
                <FormatGlyph icon="quote" />
              </button>
              <button className="hq-chatComposerToolButton hq-chatComposerFormatButton" type="button" title="Clear formatting" aria-label="Clear formatting" onClick={() => applyEditorCommand(target, "removeFormat")}>
                <FormatGlyph icon="clear" />
              </button>
            </div>
          </div>
        ) : null}

        {emojiMenuTarget === target ? (
          <div className="hq-chatComposerFloatingPanel hq-chatComposerEmojiPanel">
            <div className="hq-chatComposerFloatingPanelHead">Emoji</div>
            <div className="hq-chatComposerEmojiGrid">
              {CAVCHAT_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  className="hq-chatComposerEmojiButton"
                  type="button"
                  onClick={() => insertEmoji(target, emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="hq-chatComposerToolbar">
          <button
            className="hq-chatComposerToolButton"
            type="button"
            title="Format"
            aria-label="Format"
            onClick={() => toggleFormatMenu(target)}
          >
            <ComposerGlyph icon="format" />
          </button>
          <button
            className="hq-chatComposerToolButton hq-chatComposerAiButton"
            type="button"
            title="Help me write with CavAi Messenger"
            aria-label="Help me write with CavAi Messenger"
            onClick={() => openAiModal(target)}
          >
            <ComposerGlyph icon="cavai" />
          </button>
          <label className="hq-chatComposerToolButton hq-chatComposerToolInputButton" title="Attach files" aria-label="Attach files">
            <ComposerGlyph icon="attach" />
            <input
              className="hq-chatFileInput"
              type="file"
              multiple
              onChange={(event) => {
                addFilesToTarget(target, Array.from(event.currentTarget.files || []), "attachment");
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            className="hq-chatComposerToolButton"
            type="button"
            title="Insert link"
            aria-label="Insert link"
            onClick={() => openLinkModal(target)}
          >
            <ComposerGlyph icon="link" />
          </button>
          <button
            className="hq-chatComposerToolButton"
            type="button"
            title="Emoji"
            aria-label="Emoji"
            onClick={() => toggleEmojiMenu(target)}
          >
            <ComposerGlyph icon="emoji" />
          </button>
          <button
            className="hq-chatComposerToolButton"
            type="button"
            title="Insert from CavCloud"
            aria-label="Insert from CavCloud"
            onClick={() => openCavCloudModal(target)}
          >
            <ComposerGlyph icon="cavcloud" />
          </button>
          <label className="hq-chatComposerToolButton hq-chatComposerToolInputButton" title="Insert photo" aria-label="Insert photo">
            <ComposerGlyph icon="photo" />
            <input
              className="hq-chatFileInput"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                addFilesToTarget(target, Array.from(event.currentTarget.files || []), "photo");
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </>
    );
  }

  function renderLinkModal() {
    if (!linkModalTarget) return null;
    return (
      <div className="hq-chatAssistModal" role="dialog" aria-modal="true" aria-label="Insert link">
        <button className="hq-chatAssistModalBackdrop" type="button" aria-label="Close insert link modal" onClick={() => setLinkModalTarget(null)} />
        <div className="hq-chatAssistPanel">
          <div className="hq-chatAssistHead">
            <div>
              <div className="hq-chatAssistTitle">Insert link</div>
              <p className="hq-chatAssistSub">Add a secure destination into this CavChat draft.</p>
            </div>
            <button className="hq-chatAssistClose" type="button" onClick={() => setLinkModalTarget(null)} aria-label="Close insert link modal">
              <span className="cb-closeIcon" aria-hidden="true" />
            </button>
          </div>
          <div className="hq-chatAssistBody">
            <label className="hq-chatAssistField">
              <span>URL</span>
              <input className="hq-input" value={linkUrl} onChange={(event) => setLinkUrl(event.currentTarget.value)} placeholder="https://..." />
            </label>
            <label className="hq-chatAssistField">
              <span>Label</span>
              <input className="hq-input" value={linkLabel} onChange={(event) => setLinkLabel(event.currentTarget.value)} placeholder="Optional link text" />
            </label>
          </div>
          <div className="hq-chatAssistActions">
            <button className="hq-buttonGhost" type="button" onClick={() => setLinkModalTarget(null)}>Cancel</button>
            <button className="hq-button hq-chatSendButton" type="button" onClick={applyLinkModal} disabled={!linkUrl.trim()}>Insert link</button>
          </div>
        </div>
      </div>
    );
  }

  function renderCavCloudModal() {
    if (!cavCloudModalTarget) return null;
    return (
      <div className="hq-chatAssistModal" role="dialog" aria-modal="true" aria-label="Insert from CavCloud">
        <button className="hq-chatAssistModalBackdrop" type="button" aria-label="Close CavCloud modal" onClick={() => setCavCloudModalTarget(null)} />
        <div className="hq-chatAssistPanel hq-chatAssistPanelWide">
          <div className="hq-chatAssistHead">
            <div className="hq-chatAssistHeadBrand">
              <span className="hq-chatComposerGlyph" data-icon="cavcloud" aria-hidden="true" />
              <div>
                <div className="hq-chatAssistTitle">Insert from CavCloud</div>
                <p className="hq-chatAssistSub">Search your account files and drop secure CavCloud links into this message.</p>
              </div>
            </div>
            <button className="hq-chatAssistClose" type="button" onClick={() => setCavCloudModalTarget(null)} aria-label="Close CavCloud modal">
              <span className="cb-closeIcon" aria-hidden="true" />
            </button>
          </div>
          <div className="hq-chatAssistBody">
            <label className="hq-chatAssistField">
              <span>Search CavCloud</span>
              <input
                className="hq-input"
                value={cavCloudQuery}
                onChange={(event) => setCavCloudQuery(event.currentTarget.value)}
                placeholder="Search root files"
              />
            </label>
            <div className="hq-chatCloudMeta">Root folder: {cavCloudRootFolderId || "root"}</div>
            <div className="hq-chatCloudList">
              {cavCloudLoading ? <div className="hq-chatCloudEmpty">Loading CavCloud files…</div> : null}
              {!cavCloudLoading && cavCloudError ? <div className="hq-chatCloudEmpty">{cavCloudError}</div> : null}
              {!cavCloudLoading && !cavCloudError && !cavCloudFiles.length ? <div className="hq-chatCloudEmpty">No CavCloud files found in this root scope.</div> : null}
              {!cavCloudLoading && !cavCloudError ? cavCloudFiles.map((file) => (
                <button
                  key={file.id}
                  className="hq-chatCloudRow"
                  type="button"
                  onClick={() => insertCavCloudFile(file)}
                >
                  <span className="hq-chatComposerGlyph" data-icon="cavcloud" aria-hidden="true" />
                  <span className="hq-chatCloudCopy">
                    <strong>{file.name}</strong>
                    <span>{file.path}</span>
                  </span>
                </button>
              )) : null}
            </div>
          </div>
          <div className="hq-chatAssistActions">
            <button className="hq-buttonGhost" type="button" onClick={() => setCavCloudModalTarget(null)}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  async function moveThreadToArchive(threadId: string, archived: boolean, options?: { skipBusyState?: boolean }) {
    if (isOversight) return;
    if (!options?.skipBusyState) {
      setBusyKey(`archive-row:${threadId}`);
    }
    setFeedback("");
    try {
      const response = await fetch(`/api/admin/chat/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: archived ? "archive" : "unarchive",
          archived,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Unable to update thread."));
      }
      setThreads((current) => current.map((thread) => (
        thread.id === threadId
          ? { ...thread, archived }
          : thread
      )));
      if (activeThreadId === threadId) {
        setActiveThread((current) => (current ? { ...current, archived } : current));
      }
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to update thread.");
      return false;
    } finally {
      if (!options?.skipBusyState) {
        setBusyKey("");
      }
    }
  }

  async function moveThreadToTrash(threadId: string, options?: { skipBusyState?: boolean }) {
    if (isOversight) return;
    const ok = await moveThreadToArchive(threadId, true, options);
    if (!ok) return;
    setTrashedThreadIds((current) => Array.from(new Set([...current, threadId])));
    setSelectedThreadIds((current) => current.filter((value) => value !== threadId));
    setSwipeOffsets((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    delete swipeOffsetsRef.current[threadId];
    if (activeThreadId === threadId) {
      closeThreadView();
    }
  }

  async function restoreThreadFromTrash(threadId: string, options?: { skipBusyState?: boolean }) {
    if (isOversight) return;
    const ok = await moveThreadToArchive(threadId, false, options);
    if (!ok) return;
    setTrashedThreadIds((current) => current.filter((value) => value !== threadId));
  }

  function purgeThreadFromTrash(threadId: string) {
    setPurgedThreadIds((current) => Array.from(new Set([...current, threadId])));
    setTrashedThreadIds((current) => current.filter((value) => value !== threadId));
    setSelectedThreadIds((current) => current.filter((value) => value !== threadId));
    if (activeThreadId === threadId) {
      closeThreadView();
    }
  }

  function renderSelectionToolbar() {
    const visibleThreadIds = filteredThreads.map((thread) => thread.id);
    const allVisibleSelected = visibleThreadIds.length > 0 && visibleThreadIds.every((threadId) => selectedThreadIdSet.has(threadId));
    const showDeselectVisible = selectAllVisibleActive && allVisibleSelected;

    return (
      <div className="hq-chatSelectionBar">
        <div className="hq-chatSelectionTop">
          <button
            className="hq-chatSelectionIconButton"
            type="button"
            onClick={clearSelectedThreads}
            aria-label="Clear thread selection"
          >
            <BackIcon />
          </button>

          <div className="hq-chatSelectionCount">{selectedThreadIds.length}</div>

          <button
            className="hq-chatSelectionToggleAll hq-chatSelectionToggleAllDesktop"
            type="button"
            onClick={toggleSelectAllVisibleThreads}
            disabled={!visibleThreadIds.length}
          >
            {showDeselectVisible ? "Deselect" : "Select all"}
          </button>

          <div className="hq-chatSelectionActions">
            <button
              className="hq-chatSelectionIconButton"
              type="button"
              onClick={() => { void deleteSelectedThreads(); }}
              aria-label="Move selected threads to trash"
              title="Delete"
            >
              <TrashIcon />
            </button>

            <div className="hq-chatSelectionMoveWrap" ref={bulkMoveMenuRef}>
              <button
                className="hq-chatSelectionMoveDesktopButton"
                type="button"
                onClick={() => setBulkMoveMenuOpen((current) => !current)}
              >
                Move to
              </button>
              <button
                className="hq-chatSelectionIconButton hq-chatSelectionMoreButton"
                type="button"
                onClick={() => setBulkMoveMenuOpen((current) => !current)}
                aria-label="Move selected threads"
              >
                <MoreIcon />
              </button>

              {bulkMoveMenuOpen ? (
                <div className="hq-chatSelectionMoveMenu" role="menu" aria-label="Move selected threads">
                  <button className="hq-chatSelectionMoveOption" type="button" role="menuitem" onClick={() => { void moveSelectedThreadsTo("inbox"); }}>
                    Inbox
                  </button>
                  <button className="hq-chatSelectionMoveOption" type="button" role="menuitem" onClick={() => { void moveSelectedThreadsTo("important"); }}>
                    Important
                  </button>
                  <button className="hq-chatSelectionMoveOption" type="button" role="menuitem" onClick={() => { void moveSelectedThreadsTo("archive"); }}>
                    Archive
                  </button>
                  <button className="hq-chatSelectionMoveOption" type="button" role="menuitem" onClick={() => { void moveSelectedThreadsTo("trash"); }}>
                    Trash
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="hq-chatSelectionSecondary">
          <button
            className="hq-chatSelectionToggleAll"
            type="button"
            onClick={toggleSelectAllVisibleThreads}
            disabled={!visibleThreadIds.length}
          >
            <CheckboxIcon checked={showDeselectVisible} />
            <span>{showDeselectVisible ? "Deselect" : "Select all"}</span>
          </button>
        </div>
      </div>
    );
  }

  function renderMailIndex() {
    const selectionMode = selectedThreadIds.length > 0;

    return (
      <div className="hq-chatMailboxView" data-selection-mode={selectionMode ? "true" : "false"}>
        {selectionMode ? renderSelectionToolbar() : null}
        <div className="hq-chatMailboxSurface">
          <div className="hq-chatMailList">
            {filteredThreads.length ? filteredThreads.map((thread) => {
              const label = threadLabel(thread);
              const isUnread = thread.unread && !thread.archived;
              const isSelected = selectedThreadIds.includes(thread.id);
              const snippet = getThreadSnippet(thread.subject, thread.preview);
              const isTrashed = trashedThreadIdSet.has(thread.id);
              const isImportant = threadIsImportant(thread, mailboxUserId);
              const swipeOffset = swipeOffsets[thread.id] || 0;
              const swipeActive = Math.abs(swipeOffset) > 0;
              const threadAvatar = resolveThreadAvatar({
                thread,
                mailboxUserId,
                staffByUserId,
                departmentByUserId,
              });
              return (
                <div
                  key={thread.id}
                  className="hq-chatMailSwipeShell"
                  data-active={swipeActive ? "true" : "false"}
                  data-direction={swipeOffset < 0 ? "left" : "right"}
                >
                  <div className="hq-chatMailSwipeBackdrop" aria-hidden="true">
                    <span className="hq-chatMailSwipeDeleteIcon">
                      <TrashIcon />
                    </span>
                  </div>
                  <div
                    className="hq-chatMailSwipeContent"
                    style={swipeActive ? { transform: `translateX(${swipeOffset}px)` } : undefined}
                    onTouchStart={(event) => beginRowTouch(thread.id, event)}
                    onTouchMove={(event) => moveRowTouch(thread.id, event)}
                    onTouchEnd={() => endRowTouch(thread.id)}
                    onTouchCancel={() => cancelRowTouch(thread.id)}
                  >
                    <div
                      className="hq-chatMailRow"
                      data-unread={isUnread}
                      data-selected={isSelected}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (selectionMode) {
                          toggleThreadSelected(thread.id);
                          return;
                        }
                        void openThread(thread.id, mailboxUserId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (selectionMode) {
                            toggleThreadSelected(thread.id);
                            return;
                          }
                          void openThread(thread.id, mailboxUserId);
                        }
                      }}
                    >
                      <div className="hq-chatMailRowLead">
                        {!isOversight ? (
                          <>
                            <button
                              type="button"
                              className="hq-chatMailSelectButton"
                              aria-label={isSelected ? "Deselect thread" : "Select thread"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleThreadSelected(thread.id);
                              }}
                            >
                              <CheckboxIcon checked={isSelected} />
                            </button>
                            <button
                              type="button"
                              className="hq-chatMailStarButton"
                              data-starred={thread.starred ? "true" : "false"}
                              aria-label={thread.starred ? "Unstar thread" : "Star thread"}
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleThreadStar(thread.id, !thread.starred);
                              }}
                              disabled={busyKey === `star:${thread.id}`}
                            >
                              <StarIcon />
                            </button>
                          </>
                        ) : null}
                        <span className="hq-chatMailAvatar" aria-hidden="true">
                          <AvatarBadge
                            name={threadAvatar.name}
                            email={threadAvatar.email}
                            image={threadAvatar.image}
                            tone={threadAvatar.tone}
                            size="sm"
                          />
                        </span>
                        <div className="hq-chatMailSender">{label}</div>
                      </div>

                      <div className="hq-chatMailSubjectLine">
                        <span className="hq-chatMailSubject">{thread.subject || label}</span>
                        {snippet ? <span className="hq-chatMailSeparator" aria-hidden="true">•</span> : null}
                        <span className="hq-chatMailPreview">{snippet || "No messages yet."}</span>
                      </div>

                      <div className="hq-chatMailMeta">
                        {!isOversight ? (
                          <div className="hq-chatMailRowActions">
                            <button
                              type="button"
                              className="hq-chatMailActionButton"
                              aria-label={isTrashed ? "Restore from trash" : thread.archived ? "Move to inbox" : "Archive thread"}
                              title={isTrashed ? "Restore" : thread.archived ? "Move to inbox" : "Archive"}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isTrashed) {
                                  void restoreThreadFromTrash(thread.id);
                                  return;
                                }
                                void moveThreadToArchive(thread.id, !thread.archived);
                              }}
                              disabled={busyKey === `archive-row:${thread.id}`}
                            >
                              <ArchiveIcon />
                            </button>
                            <button
                              type="button"
                              className="hq-chatMailActionButton"
                              aria-label={isTrashed ? "Delete forever" : "Move to trash"}
                              title={isTrashed ? "Delete forever" : "Delete"}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isTrashed) {
                                  purgeThreadFromTrash(thread.id);
                                  return;
                                }
                                void moveThreadToTrash(thread.id);
                              }}
                              disabled={busyKey === `archive-row:${thread.id}`}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        ) : null}
                        {isOversight ? (
                          <div className="hq-chatMailMetaIcons" aria-label="Thread indicators">
                            {thread.draftBody ? (
                              <span className="hq-chatMailMetaIcon" title="Draft" aria-label="Draft">
                                <DraftIcon />
                              </span>
                            ) : null}
                            {isImportant ? (
                              <span className="hq-chatMailMetaIcon" title="Important" aria-label="Important">
                                <ImportantIcon />
                              </span>
                            ) : null}
                            {thread.boxLabel ? (
                              <span className="hq-chatMailMetaIcon" title={thread.boxLabel} aria-label={thread.boxLabel}>
                                <MailIcon />
                              </span>
                            ) : null}
                            {thread.isDirect ? (
                              <span className="hq-chatMailMetaIcon" title="Direct" aria-label="Direct">
                                <DirectIcon />
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            {thread.draftBody ? <span className="hq-chatMailMetaPill">Draft</span> : null}
                            {isImportant ? <span className="hq-chatMailMetaPill">Important</span> : null}
                            {thread.boxLabel ? <span className="hq-chatMailMetaPill">{thread.boxLabel}</span> : null}
                            {thread.isDirect ? <span className="hq-chatMailMetaPill">Direct</span> : null}
                          </>
                        )}
                        <span className="hq-chatMailTime">{formatDateLabel(thread.lastMessageAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }) : (
              <div className="hq-chatEmptyState hq-chatMailboxEmptyState">
                <div className="hq-chatEmptyTitle">{search.trim() ? "No conversations match this search." : "No threads in this mailbox."}</div>
                <div className="hq-chatEmptySub">
                  {search.trim()
                    ? "Try another department, name, subject, or preview term."
                    : isOversight
                      ? "Switch the reviewed mailbox or adjust the filters."
                      : "Use Compose to start a new direct thread or switch mailboxes."}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderThreadMessages() {
    if (!activeThread) return null;

    return (
      <div className="hq-chatMessages">
        {activeThread.messages.length ? activeThread.messages.map((message) => (
          <article key={message.id} className="hq-chatMessage" data-self={!isOversight && message.senderUserId === props.currentUserId}>
            <div className="hq-chatMessageHeader">
              <div className="hq-chatMessageSenderBlock">
                <AvatarBadge
                  name={message.senderName}
                  email={message.senderEmail}
                  image={message.senderAvatarImage || null}
                  tone={resolveDepartmentAvatarTone(
                    SYSTEM_SENDER_DEPARTMENT_MAP[message.senderUserId]
                    || departmentByUserId.get(message.senderUserId)
                    || "COMMAND",
                  )}
                  size="md"
                />
                <div className="hq-chatMessageSenderMeta">
                  <div className="hq-chatMessageMeta">
                    <strong>{message.senderName}</strong>
                    <span>{message.senderEmail}</span>
                  </div>
                  <div className="hq-chatMessageRecipients">
                    to {activeThread.participants.filter((participant) => participant.userId !== message.senderUserId).map((participant) => participant.name).join(", ") || "thread participants"}
                  </div>
                </div>
              </div>
            <div className="hq-chatMessageHeaderActions">
                <span className="hq-chatMessageTimestamp">{formatDateLabel(message.createdAt)}</span>
                {!isOversight ? (
                  <button
                    className="hq-buttonGhost hq-chatInlineReplyButton"
                    type="button"
                    onClick={() => setReplyComposerOpen(true)}
                  >
                    Reply
                  </button>
                ) : null}
              </div>
            </div>
            {message.bodyHtml ? (
              <div
                className="hq-chatMessageBody hq-chatMessageBodyRich"
                style={{ fontFamily: message.fontFamily || DEFAULT_CAVCHAT_FONT_FAMILY }}
                dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
              />
            ) : (
              <div className="hq-chatMessageBody">{message.body}</div>
            )}
            {message.attachments.length ? (
              <div className="hq-chatAttachments">
                {message.attachments.map((attachment) => (
                  <Link key={attachment.id} href={`/api/admin/chat/attachments/${attachment.id}`} className="hq-buttonGhost" target="_blank">
                    {attachment.fileName}
                  </Link>
                ))}
              </div>
            ) : null}
          </article>
        )) : (
          <div className="hq-chatEmptyState hq-chatMessageEmptyState">
            <div className="hq-chatEmptyTitle">No messages in this thread yet.</div>
            <div className="hq-chatEmptySub">
              This conversation is ready. Reply or send the first internal note from here.
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderThreadDetail() {
    if (!activeThread) {
      return (
        <div className="hq-chatThreadEmpty">
          <div className="hq-chatEmptyTitle">{isOversight ? "Select a thread to inspect." : "Select a thread to open CavChat."}</div>
          <div className="hq-chatEmptySub">
            {isOversight
              ? "Use Message Oversight to review staff conversations without changing mailbox state."
              : "Use Compose to start a secure staff conversation."}
          </div>
        </div>
      );
    }

    return (
      <div className="hq-chatDetail" data-mode={mode}>
        <div className="hq-chatDetailHead">
          <div className="hq-chatThreadTitleBlock">
            <div className="hq-chatThreadTitle">{activeThread.subject}</div>
            {!isOversight ? (
              <p className="hq-chatThreadSub">
                Opened in CavChat. Replies stay in-app, auditable, and visible to authorized staff participants.
              </p>
            ) : null}
          </div>
        </div>

        <div className="hq-chatMessagesSurface">
          {renderThreadMessages()}
        </div>

        {!isOversight ? (
          <>
            <div className="hq-chatReplyRail">
              <button
                className="hq-buttonGhost hq-chatReplyTrigger"
                type="button"
                onClick={() => setReplyComposerOpen((current) => !current)}
              >
                {replyComposerOpen ? "Hide reply" : "Reply"}
              </button>
              <button
                className="hq-buttonGhost hq-chatReplyTrigger"
                type="button"
                onClick={() => setReplyComposerOpen(true)}
              >
                Reply all
              </button>
              {activeThread.draft.updatedAt && !replyComposerOpen ? (
                <span className="hq-chatReplyDraftHint">Draft saved {formatDateLabel(activeThread.draft.updatedAt)}</span>
              ) : null}
            </div>

            {replyComposerOpen ? (
              <div className="hq-chatComposerCard">
                <div className="hq-chatComposerHead">
                  <div>
                    <div className="hq-chatComposerTitle">Reply in CavChat</div>
                    <p className="hq-chatComposerSub">Replies stay in-app, auditable, and visible to authorized staff participants.</p>
                  </div>
                  {activeThread.draft.updatedAt ? (
                    <span className="hq-chatComposerSavedAt">Draft saved {formatDateLabel(activeThread.draft.updatedAt)}</span>
                  ) : null}
                </div>

                {aiModalTarget === "reply" ? renderInlineAiComposer("reply") : (
                  <>
                    <div className="hq-chatComposerEditorWrap">
                      <div
                        ref={replyEditorRef}
                        className="hq-chatComposerEditor"
                        contentEditable
                        suppressContentEditableWarning
                        data-placeholder="Write a message..."
                        onInput={() => updateBodyFromEditor("reply")}
                      />
                    </div>

                    {attachments.length ? (
                      <div className="hq-inline">
                        {attachments.map((file) => (
                          <Badge key={`${file.name}-${file.size}`} tone="watch">{file.name}</Badge>
                        ))}
                      </div>
                    ) : null}

                    <div className="hq-chatComposerActions">
                      {renderComposerToolbar("reply")}
                      <button
                        className="hq-button hq-chatSendButton"
                        type="button"
                        onClick={() => { void sendMessage(); }}
                        disabled={busyKey === "send" || (editorHtmlIsEmpty(composerBody) && !attachments.length)}
                        aria-label={busyKey === "send" ? "Sending reply" : "Send reply"}
                        title={busyKey === "send" ? "Sending" : "Send"}
                      >
                        <span className="hq-chatSendIcon" aria-hidden="true" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  return (
    <article className="hq-card hq-chatAppCard">
      {feedback ? <div className="hq-opFeedback" data-tone={feedback.toLowerCase().includes("unable") ? "bad" : "good"}>{feedback}</div> : null}

      <button
        className={`hq-chatSidebarOverlay ${mobileSidebarOpen ? "is-open" : ""}`}
        type="button"
        aria-label={isOversight ? "Close reviewed mailbox drawer" : "Close CavChat mailbox drawer"}
        aria-hidden={!mobileSidebarOpen}
        tabIndex={mobileSidebarOpen ? 0 : -1}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <div className="hq-chatWorkbench" data-mode={mode}>
        <aside className={`hq-chatSidebarPane ${mobileSidebarOpen ? "is-open" : ""}`}>
          <div className="hq-chatSidebarMobileHead">
            <div className="hq-chatSidebarMobileTitle">{isOversight ? "Message Oversight" : "CavChat"}</div>
            <button
              className="hq-chatSidebarMobileClose"
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label={isOversight ? "Close reviewed mailbox drawer" : "Close CavChat drawer"}
            >
              <span className="cb-closeIcon" aria-hidden="true" />
            </button>
          </div>

          {isOversight ? (
            <div className="hq-chatSidebarSection">
              <div className="hq-chatSidebarLabel">Review mailbox</div>
              <select
                className="hq-select hq-chatOversightMailboxSelect"
                value={mailboxUserId}
                onChange={(event) => setMailboxUserId(event.currentTarget.value)}
              >
                {props.staffOptions.map((staff) => (
                  <option key={staff.userId} value={staff.userId}>{staff.name} · {formatStaffDepartmentOptionLabel(staff.department)}</option>
                ))}
              </select>
            </div>
          ) : (
            <button
              className="hq-chatComposeButton"
              type="button"
              onClick={openComposeBox}
            >
              <span className="hq-chatComposeButtonIcon">
                <ComposeIcon />
              </span>
              <span>Compose</span>
            </button>
          )}

          <div className="hq-chatSidebarSection">
            <div className="hq-chatSidebarLabel">Mailboxes</div>
            <div className="hq-chatMailboxRail">
              <MailboxButton active={mailboxView === "inbox"} count={mailboxCounts.inbox} icon={<MailIcon />} label="Inbox" onClick={() => selectMailboxView("inbox")} />
              <MailboxButton active={mailboxView === "unread"} count={mailboxCounts.unread} icon={<BellIcon />} label="Unread" onClick={() => selectMailboxView("unread")} />
              <MailboxButton active={mailboxView === "drafts"} count={mailboxCounts.drafts} icon={<DraftIcon />} label="Drafts" onClick={() => selectMailboxView("drafts")} />
              <MailboxButton active={mailboxView === "important"} count={mailboxCounts.important} icon={<ImportantIcon />} label="Important" onClick={() => selectMailboxView("important")} />
              <MailboxButton active={mailboxView === "starred"} count={mailboxCounts.starred} icon={<StarIcon />} label="Starred" onClick={() => selectMailboxView("starred")} />
              <MailboxButton active={mailboxView === "archive"} count={mailboxCounts.archive} icon={<ArchiveIcon />} label="Archive" onClick={() => selectMailboxView("archive")} />
              <MailboxButton active={mailboxView === "trash"} count={mailboxCounts.trash} icon={<TrashIcon />} label="Trash" onClick={() => selectMailboxView("trash")} />
            </div>
          </div>

          <div className="hq-chatSidebarSection">
            <div className="hq-chatSidebarLabel">Departments</div>
            <div className="hq-chatMailboxRail">
              {DEPARTMENT_META.map((department) => (
                <MailboxButton
                  key={department.value}
                  active={departmentView === department.value}
                  count={departmentCounts[department.value]}
                  icon={<DepartmentDot department={department.value} />}
                  label={department.label}
                  onClick={() => selectDepartmentView(department.value)}
                />
              ))}
            </div>
          </div>
        </aside>

        <section
          className="hq-chatMainPane"
          data-thread-open={activeThread ? "true" : "false"}
          data-selection-mode={selectedThreadIds.length ? "true" : "false"}
        >
          <div className="hq-chatMainToolbar">
            <button
              className="hq-chatMobileMenuButton"
              type="button"
              aria-label={isOversight ? "Open reviewed mailbox menu" : "Open CavChat mailboxes"}
              aria-expanded={mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <ChatMenuIcon />
            </button>
            <label className="hq-chatSearchWrap">
              <span className="hq-chatSearchIcon">
                <SearchIcon />
              </span>
              <input
                className="hq-search hq-chatSearchInput"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void loadThreads(search, mailboxUserId);
                  }
                }}
                placeholder={isOversight ? "Search reviewed mailbox" : "Search CavChat"}
              />
            </label>
            <button
              className="hq-buttonGhost hq-chatToolbarButton hq-syncButton"
              type="button"
              onClick={() => { void loadThreads(search, mailboxUserId); }}
              title={isOversight ? "Sync reviewed mailbox" : "Sync CavChat"}
              aria-label={isOversight ? "Sync reviewed mailbox" : "Sync CavChat"}
            >
              <span className="hq-syncIcon" aria-hidden="true" />
            </button>
          </div>

          {activeThread ? (
            <div className="hq-chatReaderPane">
              <div className="hq-chatReaderTopbar">
                <button
                  className="hq-chatReaderBack"
                  type="button"
                  onClick={() => closeThreadView()}
                  aria-label="Back to inbox"
                >
                  <BackIcon />
                </button>
                <div className="hq-chatReaderTopbarActions">
                  <span className="hq-chatReaderMailboxTag">
                    {isOversight ? (activeMailboxStaff?.name || "Review mailbox") : activeMailboxMeta.title}
                  </span>
                  {isOversight ? (
                    <span className="hq-chatReaderMailboxTag">Read-only</span>
                  ) : (
                    <button
                      className="hq-buttonGhost"
                      type="button"
                      onClick={() => { void toggleArchive(!activeThread.archived); }}
                      disabled={busyKey === "archive"}
                    >
                      {activeThread.archived ? "Unarchive" : "Archive"}
                    </button>
                  )}
                </div>
              </div>
              {renderThreadDetail()}
            </div>
          ) : (
            renderMailIndex()
          )}
        </section>
      </div>

      {!isOversight ? (
        <>
          <button
            className="hq-chatComposeFab"
            type="button"
            data-open={composeLauncherOpen ? "true" : "false"}
            onClick={openComposeBox}
            aria-label="Compose CavChat message"
          >
            <span className="hq-chatComposeButtonIcon">
              <ComposeIcon />
            </span>
            <span>Compose</span>
          </button>

          <datalist id="hq-cavchat-compose-staff">
            {composeRecipientSuggestions.map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>

          <div className="hq-chatComposeDock" data-open={composeLauncherOpen}>
            <div className="hq-chatComposeModal">
              <div className="hq-chatComposeModalBar">
                <div className="hq-chatComposeModalTitle">New CavChat</div>
                <button
                  className="hq-chatComposeModalClose"
                  type="button"
                  onClick={() => resetComposeBox()}
                  aria-label="Close CavChat composer"
                >
                  <span className="cb-closeIcon" aria-hidden="true" />
                </button>
              </div>

              <div className="hq-chatComposeFields">
                <div className="hq-chatComposeRow">
                  <span className="hq-chatComposeFieldLabel">To</span>
                  <input
                    className="hq-chatComposeField"
                    list="hq-cavchat-compose-staff"
                    value={composeTo}
                    onChange={(event) => setComposeTo(event.currentTarget.value)}
                    placeholder="Staff names or emails, separated by commas"
                  />
                  <div className="hq-chatComposeRowActions">
                    {!composeCcOpen ? (
                      <button
                        className="hq-chatComposeRowAction"
                        type="button"
                        onClick={() => setComposeCcOpen(true)}
                      >
                        Cc
                      </button>
                    ) : null}
                    {!composeBccOpen ? (
                      <button
                        className="hq-chatComposeRowAction"
                        type="button"
                        onClick={() => setComposeBccOpen(true)}
                      >
                        Bcc
                      </button>
                    ) : null}
                  </div>
                </div>

                {composeCcOpen ? (
                  <div className="hq-chatComposeRow">
                    <span className="hq-chatComposeFieldLabel">Cc</span>
                    <input
                      className="hq-chatComposeField"
                      list="hq-cavchat-compose-staff"
                      value={composeCc}
                      onChange={(event) => setComposeCc(event.currentTarget.value)}
                      placeholder="Optional copy recipients"
                    />
                  </div>
                ) : null}

                {composeBccOpen ? (
                  <div className="hq-chatComposeRow">
                    <span className="hq-chatComposeFieldLabel">Bcc</span>
                    <input
                      className="hq-chatComposeField"
                      list="hq-cavchat-compose-staff"
                      value={composeBcc}
                      onChange={(event) => setComposeBcc(event.currentTarget.value)}
                      placeholder="Optional hidden intake field"
                    />
                  </div>
                ) : null}

                <div className="hq-chatComposeRow">
                  <span className="hq-chatComposeFieldLabel">Subject</span>
                  <input
                    className="hq-chatComposeField"
                    value={composeSubject}
                    onChange={(event) => setComposeSubject(event.currentTarget.value)}
                    placeholder="Thread subject"
                  />
                </div>

                {aiModalTarget === "compose" ? renderInlineAiComposer("compose") : (
                  <div className="hq-chatComposeEditorWrap">
                    <div
                      ref={composeEditorRef}
                      className="hq-chatComposeMessageInput hq-chatComposerEditor"
                      contentEditable
                      suppressContentEditableWarning
                      data-placeholder="Write a message..."
                      onInput={() => updateBodyFromEditor("compose")}
                    />
                  </div>
                )}
              </div>

              {composeAttachments.length ? (
                <div className="hq-inline">
                  {composeAttachments.map((file) => (
                    <Badge key={`${file.name}-${file.size}`} tone="watch">{file.name}</Badge>
                  ))}
                </div>
              ) : null}

              {composeCcOpen || composeBccOpen ? (
                <div className="hq-chatComposeHelper">
                  CavChat threads show all participants to the thread. `Cc` and `Bcc` are intake fields for message setup, not hidden delivery rails.
                </div>
              ) : null}

              {aiModalTarget !== "compose" ? (
                <div className="hq-chatComposeModalFooter">
                  {renderComposerToolbar("compose")}
                  <button
                    className="hq-button hq-chatSendButton"
                    type="button"
                    onClick={() => { void sendComposedThread(); }}
                    disabled={busyKey === "compose-send" || !composeTo.trim()}
                    aria-label={busyKey === "compose-send" ? "Sending message" : "Send message"}
                    title={busyKey === "compose-send" ? "Sending" : "Send"}
                  >
                    <span className="hq-chatSendIcon" aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      {renderLinkModal()}
      {renderCavCloudModal()}
    </article>
  );
}
