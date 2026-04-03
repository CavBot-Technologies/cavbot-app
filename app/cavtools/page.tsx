// app/cavtools/page.tsx
"use client";

import "./cavtools.css";

import type React from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";

import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { CavGuardCard } from "@/components/CavGuardCard";
import CavMobileMenu from "@/components/CavMobileMenu";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";

type TabKey = "inspector" | "events" | "studio" | "settings";
type Tone = "good" | "watch" | "bad";
type CavtoolsNamespace = "cavcloud" | "cavsafe" | "cavcode" | "telemetry" | "workspace";

type DevEvent = {
  id: string;
  type: string;
  ts: number;
  origin: string;
  summary: string;
  tone: Tone;
  data?: Record<string, unknown>;
};

type CavtoolsFsItem = {
  type: "file" | "folder";
  namespace: CavtoolsNamespace;
  name: string;
  path: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAtISO?: string | null;
  readOnly?: boolean;
};

type CavtoolsExecBlock =
  | { kind: "text"; title?: string; lines: string[] }
  | {
      kind: "table";
      title?: string;
      columns: string[];
      rows: Array<Record<string, string | number | boolean | null>>;
    }
  | { kind: "json"; title?: string; data: unknown }
  | { kind: "files"; title?: string; cwd: string; items: CavtoolsFsItem[] }
  | {
      kind: "diagnostics";
      title?: string;
      diagnostics: Array<{
        file: string;
        line: number;
        col: number;
        severity: "error" | "warn" | "info";
        source: string;
        code?: string;
        message: string;
        fixReady?: boolean;
      }>;
      summary: {
        total: number;
        errors: number;
        warnings: number;
        infos: number;
        filesScanned: number;
        generatedAtISO: string;
        truncated: boolean;
      };
    }
  | { kind: "open"; title?: string; url: string; label?: string }
  | { kind: "warning"; message: string };

type CavtoolsExecResult = {
  ok: boolean;
  cwd: string;
  command: string;
  warnings: string[];
  blocks: CavtoolsExecBlock[];
  durationMs: number;
  audit: {
    commandId: string;
    atISO: string;
    denied: boolean;
  };
  actor?: {
    memberRole?: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
    planId?: string;
    includeCavsafe?: boolean;
  };
  error?: {
    code: string;
    message: string;
    guardDecision?: Record<string, unknown>;
  };
};

type CavtoolsFileReadResult = {
  ok: true;
  path: string;
  mimeType: string;
  readOnly: boolean;
  content: string;
  updatedAtISO?: string | null;
};

type CavtoolsFileWriteResult = {
  ok: true;
  path: string;
  mimeType: string;
  updatedAtISO?: string | null;
};

type RunResult = {
  id: string;
  ts: number;
  out: string;
  tone: Tone;
};

const ROOTS: Array<{ namespace: CavtoolsNamespace; label: string; path: string }> = [
  { namespace: "cavcloud", label: "CavCloud", path: "/cavcloud" },
  { namespace: "cavsafe", label: "CavSafe", path: "/cavsafe" },
  { namespace: "cavcode", label: "CavCode", path: "/cavcode" },
  { namespace: "telemetry", label: "Telemetry", path: "/telemetry" },
  { namespace: "workspace", label: "Workspace", path: "/workspace" },
];

const DEFAULT_CWD = "/cavcloud";
const ROOT_TOKEN_RE = /^(cavcloud|cavsafe|cavcode|telemetry|workspace)(\/|$)/i;

const KNOWN_COMMANDS = [
  "pwd",
  "cd cavcloud",
  "cd cavsafe",
  "cd cavcode",
  "ls",
  "ls cavcloud",
  "tree cavcloud 2",
  "cat cavcloud/README.md",
  "mkdir cavcloud/new-folder",
  "touch cavcloud/new-file.txt",
  'write cavcloud/new-file.txt "hello"',
  "mv cavcloud/a.txt cavcloud/archive/a.txt",
  "cp cavcloud/a.txt cavcloud/copy/a.txt",
  "rm cavcloud/old.txt",
  "open cavcloud",
  "search observability",
  "cav status",
  "cav whoami",
  "cav ctx",
  "cav sync",
  "cav telemetry summary",
  "cav telemetry routes",
  "cav telemetry errors",
  "cav telemetry seo",
  "cav telemetry a11y",
  "cav telemetry geo",
  "cav telemetry scans",
  "cav telemetry export",
  "cav diag",
  "cav diag errors",
  "cav diag routes",
  "cav diag seo",
  "cav diag a11y",
  'cav diag find "checkout"',
  "cav cloud share cavcloud/brand/logo.svg 7",
  "cav cloud publish cavcloud/brand/logo.svg",
  "cav cloud unpublish cavcloud/brand/logo.svg",
  "cav safe invite cavsafe/contracts acme@example.com viewer",
  "cav safe revoke cavsafe/contracts user_abc123",
  "cav safe audit 50",
  "cav workspace status",
  "cav workspace sites",
  "cav workspace members",
  "cav workspace guardrails",
  "cav workspace notices",
  "help",
  "cav help",
  "clear",
  "cav clear",
  "cav events tail 10",
  "cav events filter bad",
  "cav events clear",
];

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(input: unknown, max = 220) {
  const text = String(input ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalizePath(rawPath: string) {
  const raw = String(rawPath || "").trim();
  if (!raw) return "/";

  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = withLeading.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    const seg = part.trim();
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }

  const normalized = `/${stack.join("/")}`;
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized || "/";
}

function toUiPath(path: string) {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  return normalized.slice(1);
}

function isNamespacePathToken(token: string) {
  const normalized = String(token || "").trim().replace(/^\/+/, "");
  return ROOT_TOKEN_RE.test(normalized);
}

function toInternalPathToken(token: string) {
  const raw = String(token || "").trim();
  if (!raw) return raw;
  if (raw.startsWith("/")) return normalizePath(raw);
  const withoutLeading = raw.replace(/^\/+/, "");
  if (ROOT_TOKEN_RE.test(withoutLeading)) return normalizePath(`/${withoutLeading}`);
  return raw;
}

function splitCommandTokens(input: string) {
  const text = String(input || "");
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function normalizeCommandForServer(input: string) {
  const text = String(input || "").trim();
  if (!text) return text;

  const tokens = splitCommandTokens(text);
  if (!tokens.length) return text;

  const head = String(tokens[0] || "").toLowerCase();
  const arg = (index: number) => {
    if (!tokens[index]) return;
    tokens[index] = toInternalPathToken(tokens[index]);
  };

  if (head === "write") {
    arg(1);
    return tokens.join(" ");
  }

  if (head === "mv" || head === "cp") {
    arg(1);
    arg(2);
    return tokens.join(" ");
  }

  if (head === "cd" || head === "ls" || head === "tree" || head === "cat" || head === "mkdir" || head === "touch" || head === "rm" || head === "open" || head === "edit") {
    arg(1);
    return tokens.join(" ");
  }

  if (head === "cav") {
    const second = String(tokens[1] || "").toLowerCase();
    const third = String(tokens[2] || "").toLowerCase();

    if (second === "cloud" && (third === "share" || third === "publish" || third === "unpublish")) {
      arg(3);
      return tokens.join(" ");
    }
    if (second === "safe" && (third === "invite" || third === "revoke" || third === "collab" || third === "audit")) {
      arg(3);
      return tokens.join(" ");
    }
    if (second === "cavcode" && (third === "ls" || third === "tree" || third === "cd" || third === "cat" || third === "open" || third === "mkdir" || third === "touch" || third === "write" || third === "rm")) {
      arg(3);
      return tokens.join(" ");
    }
  }

  return tokens.join(" ");
}

function joinLines(lines: string[]) {
  return lines.join("\n");
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

function fmtBytes(bytes?: number | null) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function tryJson(x: unknown) {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return { value: String(x) };
  }
}

function getLiveOriginFallback(siteOrigin: string) {
  const s = String(siteOrigin || "").trim();
  if (s) return s;
  try {
    return window.location.origin;
  } catch {
    return "—";
  }
}

function redactUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url || "");
  }
}

function namespaceFromPath(path: string): CavtoolsNamespace | null {
  const normalized = normalizePath(path);
  if (normalized === "/cavcloud" || normalized.startsWith("/cavcloud/")) return "cavcloud";
  if (normalized === "/cavsafe" || normalized.startsWith("/cavsafe/")) return "cavsafe";
  if (normalized === "/cavcode" || normalized.startsWith("/cavcode/")) return "cavcode";
  if (normalized === "/telemetry" || normalized.startsWith("/telemetry/")) return "telemetry";
  if (normalized === "/workspace" || normalized.startsWith("/workspace/")) return "workspace";
  return null;
}

function rootPathForNamespace(ns: CavtoolsNamespace) {
  if (ns === "cavcloud") return "/cavcloud";
  if (ns === "cavsafe") return "/cavsafe";
  if (ns === "cavcode") return "/cavcode";
  if (ns === "telemetry") return "/telemetry";
  return "/workspace";
}

function toneFromStatus(ok: boolean, hasWarnings: boolean): Tone {
  if (!ok) return "bad";
  if (hasWarnings) return "watch";
  return "good";
}

function languageForPath(path: string) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".ts")) return "TS";
  if (p.endsWith(".tsx")) return "TSX";
  if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "JS";
  if (p.endsWith(".jsx")) return "JSX";
  if (p.endsWith(".css")) return "CSS";
  if (p.endsWith(".json")) return "JSON";
  if (p.endsWith(".md")) return "MD";
  if (p.endsWith(".html")) return "HTML";
  if (p.endsWith(".csv")) return "CSV";
  if (p.endsWith(".txt")) return "TXT";
  return "TEXT";
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

function readPublicProfileEnabled(): boolean | null {
  try {
    const raw = (globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "public") return true;
    if (raw === "0" || raw === "false" || raw === "private") return false;
  } catch {}
  return null;
}

function toLegacyAdjustedCommand(input: string) {
  let text = String(input || "").trim();
  if (!text) return text;

  text = text
    .replace(/\/codebase\b/g, "/cavcode")
    .replace(/\bcav\s+codebase\b/g, "cav cavcode")
    .replace(/\bcodebase\b/g, "cavcode");

  if (/^cav\s+cavcode\s+/i.test(text)) {
    const parts = text.split(/\s+/);
    const action = String(parts[2] || "").toLowerCase();
    const argA = parts[3] || "";
    const argB = parts.slice(4).join(" ");

    if (action === "pwd") return "pwd";
    if (action === "ls") return argA ? `ls ${argA}` : "ls cavcode";
    if (action === "tree") return argA ? `tree ${argA} ${argB}`.trim() : "tree cavcode 2";
    if (action === "cd") return argA ? `cd ${argA}` : "cd cavcode";
    if (action === "cat") return argA ? `cat ${argA}` : "cat cavcode";
    if (action === "open") return argA ? `open ${argA}` : "open cavcode";
    if (action === "mkdir") return argA ? `mkdir ${argA}` : text;
    if (action === "touch") return argA ? `touch ${argA}` : text;
    if (action === "write") {
      const rest = text.replace(/^cav\s+cavcode\s+write\s+/i, "");
      return `write ${rest}`;
    }
    if (action === "rm") return argA ? `rm ${argA}` : text;
  }

  if (/^cav\s+open\s+--\s+/i.test(text)) {
    return text.replace(/^cav\s+open\s+--\s+/i, "open ");
  }

  if (/^cav\s+run\s+--\s+/i.test(text)) {
    return text.replace(/^cav\s+run\s+--\s+/i, "open ");
  }

  return text;
}

function isMutationCommand(raw: string) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return false;
  if (/^(write|edit|touch|mkdir|rm|mv|cp)\b/.test(text)) return true;
  if (/^cav\s+cloud\s+(publish|unpublish)\b/.test(text)) return true;
  if (/^cav\s+safe\s+(invite|revoke)\b/.test(text)) return true;
  return false;
}

function eventTypeLabel(type: string) {
  const key = String(type || "").trim().toLowerCase();
  if (!key) return "Event";

  const map: Record<string, string> = {
    cavtools_mount: "CavTools Ready",
    command_ok: "Success",
    command_fail: "Failed",
    file_open: "File Opened",
    file_open_fail: "Open Failed",
    file_save: "Saved",
    file_save_fail: "Save Failed",
    directory_refresh_fail: "Sync Failed",
    js_error: "Runtime Error",
    unhandled_rejection: "Unhandled Error",
    console_warn: "Console Warning",
    console_error: "Console Error",
    fetch_http_error: "HTTP Error",
    fetch_failed: "Network Error",
  };

  const mapped = map[key];
  if (mapped) return mapped;
  if (key.startsWith("client_")) return "Client Activity";
  if (key.startsWith("command_")) return "Command";

  const pretty = key
    .replace(/[_-]+/g, " ")
    .replace(/\bjs\b/g, "JS")
    .replace(/\bapi\b/g, "API")
    .replace(/\bseo\b/g, "SEO")
    .replace(/\ba11y\b/g, "A11y")
    .replace(/\b\w/g, (m) => m.toUpperCase());
  return pretty || "Event";
}

function IconCavTools() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8.4 7.2 4.8 10.8l3.6 3.6M15.6 7.2l3.6 3.6-3.6 3.6M10.2 19.2l3.6-14.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTermExpand() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTermShrink() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function CavtoolsPage() {
  return (
    <Suspense fallback={null}>
      <CavToolsPageInner />
    </Suspense>
  );
}

function CavToolsPageInner() {
  const sp = useSearchParams();

  const projectId = (sp.get("project") || "").trim();
  const siteOrigin = (sp.get("site") || "").trim();

  const [booting] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const [welcomeName, setWelcomeName] = useState("");

  const [tab, setTab] = useState<TabKey>("inspector");
  const [groupOpen, setGroupOpen] = useState<Record<CavtoolsNamespace, boolean>>({
    cavcloud: true,
    cavsafe: false,
    cavcode: true,
    telemetry: false,
    workspace: false,
  });

  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [dirCache, setDirCache] = useState<Record<string, CavtoolsFsItem[]>>({
    "/cavcloud": [],
    "/cavsafe": [],
    "/cavcode": [],
    "/telemetry": [],
    "/workspace": [],
  });
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({
    "/cavcloud": true,
    "/cavsafe": false,
    "/cavcode": true,
    "/telemetry": false,
    "/workspace": false,
  });

  const [activeNamespace, setActiveNamespace] = useState<CavtoolsNamespace | null>(null);
  const [activePath, setActivePath] = useState("");
  const [fileBuffer, setFileBuffer] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [fileReadOnly, setFileReadOnly] = useState(true);
  const [fileMime, setFileMime] = useState("text/plain");
  const [fileLoading, setFileLoading] = useState(false);

  const [events, setEvents] = useState<DevEvent[]>([]);
  const [runLog, setRunLog] = useState<RunResult[]>([]);

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmd, setCmd] = useState("");
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  const [syncStatus, setSyncStatus] = useState<{ lastSyncTs?: number; serverReachable: boolean }>({
    lastSyncTs: undefined,
    serverReachable: true,
  });
  const [memberRole, setMemberRole] = useState<"OWNER" | "ADMIN" | "MEMBER" | "ANON">("ANON");
  const [cavsafeEntitled, setCavsafeEntitled] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileTone, setProfileTone] = useState("lime");
  const [profileAvatar, setProfileAvatar] = useState("");
  const [profileInitials, setProfileInitials] = useState("C");
  const [profileUsername, setProfileUsername] = useState("");
  const [profilePublicEnabled, setProfilePublicEnabled] = useState<boolean | null>(null);

  const historyRef = useRef<string[]>([]);
  const histIndexRef = useRef(-1);
  const cmdRef = useRef<HTMLInputElement | null>(null);
  const studioEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const lastClientEventLenRef = useRef(0);
  const prefetchingDirsRef = useRef<Set<string>>(new Set());
  const accountWrapRef = useRef<HTMLDivElement | null>(null);

  const operator = welcomeName || "Operator";

  const statusLabel = useMemo(() => {
    if (!syncStatus.serverReachable) return "Server unreachable";
    if (!siteOrigin) return "Boundless mode";
    return "Monitoring";
  }, [siteOrigin, syncStatus.serverReachable]);

  const statusTone = useMemo<Tone>(() => {
    if (!syncStatus.serverReachable) return "bad";
    if (!siteOrigin) return "watch";
    return "good";
  }, [siteOrigin, syncStatus.serverReachable]);

  const PROMPT_PREFIX = useMemo(() => {
    const rawUser = String(profileUsername || "").trim().toLowerCase();
    const user = rawUser.replace(/\s+/g, "");
    return `${user || "operator"}@cavbot:~$`;
  }, [profileUsername]);

  const activeLang = useMemo(() => languageForPath(activePath), [activePath]);

  const dynamicPathHints = useMemo(() => {
    const set = new Set<string>();
    Object.keys(dirCache).forEach((key) => {
      set.add(toUiPath(key));
      const items = dirCache[key] || [];
      for (const item of items) set.add(toUiPath(item.path));
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [dirCache]);

  const cwdDisplay = useMemo(() => toUiPath(cwd), [cwd]);

  const tabSubtitle = useMemo(() => {
    if (tab === "inspector") return "For Developers";
    if (tab === "events") return "Operational event stream";
    if (tab === "studio") return "Real file editor";
    return "Workspace posture and policy";
  }, [tab]);

  const canUseCavsafe = useMemo(() => memberRole === "OWNER" && cavsafeEntitled, [memberRole, cavsafeEntitled]);

  function pushRun(out: string, tone: Tone) {
    setRunLog((prev) => [{ id: uid("run"), ts: Date.now(), out, tone }, ...prev].slice(0, 180));
  }

  const pushEvent = useCallback((next: Omit<DevEvent, "id">) => {
    setEvents((prev) => [{ id: uid("evt"), ...next }, ...prev].slice(0, 320));
  }, []);

  const pushSystemEvent = useCallback(
    (type: string, summary: string, tone: Tone, data?: Record<string, unknown>) => {
      pushEvent({
        type,
        ts: Date.now(),
        origin: getLiveOriginFallback(siteOrigin),
        summary,
        tone,
        data: data ? tryJson(data) : undefined,
      });
    },
    [pushEvent, siteOrigin]
  );

  const formatExecBlock = useCallback((block: CavtoolsExecBlock): { tone: Tone; text: string } => {
    if (block.kind === "warning") {
      return {
        tone: "watch",
        text: `Warning\n${block.message}`,
      };
    }

    if (block.kind === "text") {
      return {
        tone: "good",
        text: `${block.title ? `${block.title}\n` : ""}${joinLines(block.lines || [])}`.trim(),
      };
    }

    if (block.kind === "json") {
      return {
        tone: "good",
        text: `${block.title ? `${block.title}\n` : ""}${JSON.stringify(block.data ?? {}, null, 2)}`,
      };
    }

    if (block.kind === "table") {
      const cols = Array.isArray(block.columns) ? block.columns : [];
      const rows = Array.isArray(block.rows) ? block.rows : [];

      const lines: string[] = [];
      if (cols.length) lines.push(cols.join("\t"));
      for (const row of rows) {
        lines.push(cols.map((col) => String(row[col] ?? "")).join("\t"));
      }

      return {
        tone: "good",
        text: `${block.title ? `${block.title}\n` : ""}${joinLines(lines)}`,
      };
    }

    if (block.kind === "files") {
      const lines = block.items.map((item) => {
        const kind = item.type === "folder" ? "dir " : "file";
        const size = item.type === "file" ? ` ${fmtBytes(item.sizeBytes)}` : "";
        const ro = item.readOnly ? " [ro]" : "";
        return `${kind}  ${item.path}${size}${ro}`;
      });

      return {
        tone: "good",
        text: `${block.title || "Listing"} (${block.cwd})\n${joinLines(lines)}`.trim(),
      };
    }

    if (block.kind === "diagnostics") {
      const summary = block.summary || {
        total: block.diagnostics.length,
        errors: 0,
        warnings: 0,
        infos: 0,
        filesScanned: 0,
        generatedAtISO: "",
        truncated: false,
      };
      const lines: string[] = [
        `${block.title || "Workspace Diagnostics"}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info`,
      ];
      if (summary.filesScanned) lines.push(`Scanned ${summary.filesScanned} file(s).`);
      if (summary.generatedAtISO) lines.push(`Generated ${summary.generatedAtISO}`);
      const sample = (block.diagnostics || []).slice(0, 20).map(
        (diag) =>
          `${diag.severity.toUpperCase()} ${diag.file}:${diag.line}:${diag.col}${diag.code ? ` ${diag.code}` : ""} ${diag.message}`
      );
      lines.push(...sample);
      if ((block.diagnostics || []).length > 20) {
        lines.push(`... ${block.diagnostics.length - 20} more diagnostics`);
      }
      if (summary.truncated) {
        lines.push("Diagnostics truncated due to workspace size limits.");
      }
      return {
        tone: summary.errors > 0 ? "bad" : summary.warnings > 0 ? "watch" : "good",
        text: joinLines(lines).trim(),
      };
    }

    return {
      tone: "good",
      text: `${block.title || "Open"}\n${block.label || block.url}\n${block.url}`,
    };
  }, []);

  const applyExecResult = useCallback(
    (result: CavtoolsExecResult, opts?: { renderOutput?: boolean; updateCwd?: boolean }) => {
      const renderOutput = opts?.renderOutput !== false;
      const updateCwd = opts?.updateCwd !== false;

      if (updateCwd && result.cwd) setCwd(normalizePath(result.cwd));
      setSyncStatus({ lastSyncTs: Date.now(), serverReachable: true });

      const roleRaw = String(result.actor?.memberRole || "").trim().toUpperCase();
      if (roleRaw === "OWNER" || roleRaw === "ADMIN" || roleRaw === "MEMBER" || roleRaw === "ANON") {
        setMemberRole(roleRaw as "OWNER" | "ADMIN" | "MEMBER" | "ANON");
      }
      if (typeof result.actor?.includeCavsafe === "boolean") {
        setCavsafeEntitled(Boolean(result.actor.includeCavsafe));
      }

      for (const block of result.blocks || []) {
        if (block.kind === "files" && block.cwd) {
          const dir = normalizePath(block.cwd);
          setDirCache((prev) => ({ ...prev, [dir]: block.items || [] }));
        }

        if (renderOutput) {
          const formatted = formatExecBlock(block);
          pushRun(formatted.text, formatted.tone);
        }
      }

      for (const warning of result.warnings || []) {
        if (renderOutput) pushRun(`Warning\n${warning}`, "watch");
      }

      const tone = toneFromStatus(Boolean(result.ok), Boolean((result.warnings || []).length));
      pushSystemEvent(result.ok ? "command_ok" : "command_fail", `${clamp(result.command, 160)} (${result.durationMs}ms)`, tone, {
        command: result.command,
        cwd: result.cwd,
        durationMs: result.durationMs,
        ok: result.ok,
        warnings: result.warnings,
        error: result.error || null,
        audit: result.audit,
      });

      const cmd = String(result.command || "").trim().toLowerCase();
      const isOpenCommand = cmd === "open" || cmd.startsWith("open ");
      if (!renderOutput || !result.ok || !isOpenCommand) return;

      const openBlock = (result.blocks || []).find(
        (block): block is Extract<CavtoolsExecBlock, { kind: "open" }> => block.kind === "open"
      );
      const rawUrl = String(openBlock?.url || "").trim();
      if (!rawUrl) return;

      try {
        const target = new URL(rawUrl, window.location.origin);
        const nextHref =
          target.origin === window.location.origin
            ? `${target.pathname}${target.search}${target.hash}`
            : target.toString();
        window.location.assign(nextHref);
      } catch {
        window.location.assign(rawUrl);
      }
    },
    [formatExecBlock, pushSystemEvent]
  );

  const callExec = useCallback(
    async (command: string, cwdOverride?: string | null): Promise<CavtoolsExecResult> => {
      const res = await fetch("/api/cavtools/exec", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          cwd: cwdOverride || cwd,
          command,
          projectId: projectId || null,
          siteOrigin: siteOrigin || null,
        }),
      });

      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json || typeof json !== "object") {
        throw new Error(`CavTools exec failed (${res.status}).`);
      }

      if (Array.isArray(json.blocks)) {
        return json as unknown as CavtoolsExecResult;
      }

      const message = String(
        ((json.error as { message?: unknown } | undefined)?.message as string | undefined) ||
          (res.ok ? "Command failed." : `Command failed (${res.status}).`)
      );

      return {
        ok: false,
        cwd: normalizePath(cwdOverride || cwd),
        command,
        warnings: [],
        blocks: [
          {
            kind: "text",
            title: "Command Failed",
            lines: [message],
          },
        ],
        durationMs: 0,
        audit: {
          commandId: uid("fallback"),
          atISO: new Date().toISOString(),
          denied: res.status === 401 || res.status === 403,
        },
        error: {
          code: String((json.error as { code?: unknown } | undefined)?.code || "EXEC_FAILED"),
          message,
        },
      };
    },
    [cwd, projectId, siteOrigin]
  );

  const refreshDirectory = useCallback(
    async (path: string, opts?: { silent?: boolean }) => {
      const p = normalizePath(path);
      try {
        const result = await callExec(`ls ${p}`, p);
        applyExecResult(result, { renderOutput: false, updateCwd: false });
      } catch (error) {
        if (opts?.silent) return;
        setSyncStatus({ lastSyncTs: Date.now(), serverReachable: false });
        pushSystemEvent("directory_refresh_fail", `Failed to sync ${p}.`, "bad", {
          path: p,
          error: String((error as Error)?.message || error),
        });
      }
    },
    [applyExecResult, callExec, pushSystemEvent]
  );

  const refreshRoots = useCallback(async () => {
    await Promise.all(
      ROOTS
        .filter((root) => (root.namespace === "cavsafe" ? canUseCavsafe : true))
        .map((root) => refreshDirectory(root.path))
    );
  }, [canUseCavsafe, refreshDirectory]);

  const openFileInStudio = useCallback(
    async (path: string, namespaceHint?: CavtoolsNamespace) => {
      const normalized = normalizePath(path);
      const ns = namespaceHint || namespaceFromPath(normalized);
      if (!ns) return;

      setTab("studio");
      setActiveNamespace(ns);
      setActivePath(normalized);
      setFileLoading(true);

      try {
        const url = new URL("/api/cavtools/file", window.location.origin);
        url.searchParams.set("path", normalized);
        if (projectId) url.searchParams.set("projectId", projectId);
        if (siteOrigin) url.searchParams.set("siteOrigin", siteOrigin);

        const res = await fetch(url.toString(), {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const json = (await res.json().catch(() => null)) as CavtoolsFileReadResult | { ok?: false; error?: { message?: string } } | null;
        if (!res.ok || !json || (json as { ok?: boolean }).ok === false) {
          const message = (json as { error?: { message?: string } } | null)?.error?.message || `Failed to open ${normalized}.`;
          pushRun(message, "bad");
          pushSystemEvent("file_open_fail", clamp(message, 180), "bad", { path: normalized });
          setFileBuffer("");
          setFileReadOnly(true);
          setFileMime("text/plain");
          setFileDirty(false);
          return;
        }

        const file = json as CavtoolsFileReadResult;
        setFileBuffer(String(file.content || ""));
        setFileReadOnly(Boolean(file.readOnly));
        setFileMime(file.mimeType || "text/plain");
        setFileDirty(false);

        pushSystemEvent("file_open", `Opened ${normalized}.`, "good", {
          path: normalized,
          namespace: ns,
          mimeType: file.mimeType,
          readOnly: file.readOnly,
        });
      } catch (error) {
        const message = String((error as Error)?.message || "Failed to open file.");
        pushRun(message, "bad");
        pushSystemEvent("file_open_fail", clamp(message, 180), "bad", { path: normalized });
      } finally {
        setFileLoading(false);
      }
    },
    [projectId, pushSystemEvent, siteOrigin]
  );

  const saveActiveFile = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!activePath || !activeNamespace) return;
      if (fileReadOnly) {
        if (!opts?.silent) pushRun("Save blocked: file is read-only.", "watch");
        return;
      }

      try {
        const res = await fetch("/api/cavtools/file", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            path: activePath,
            content: fileBuffer,
            mimeType: fileMime || null,
            projectId: projectId || null,
            siteOrigin: siteOrigin || null,
          }),
        });

        const json = (await res.json().catch(() => null)) as CavtoolsFileWriteResult | { ok?: false; error?: { message?: string } } | null;
        if (!res.ok || !json || (json as { ok?: boolean }).ok === false) {
          const message = (json as { error?: { message?: string } } | null)?.error?.message || "Failed to save file.";
          if (!opts?.silent) pushRun(message, "bad");
          pushSystemEvent("file_save_fail", clamp(message, 180), "bad", {
            path: activePath,
          });
          return;
        }

        setFileDirty(false);
        const saved = json as CavtoolsFileWriteResult;
        if (!opts?.silent) pushRun(`Saved ${saved.path}`, "good");

        const parent = normalizePath(activePath.slice(0, Math.max(1, activePath.lastIndexOf("/"))));
        void refreshDirectory(parent || rootPathForNamespace(activeNamespace));
        void refreshDirectory(rootPathForNamespace(activeNamespace));

        pushSystemEvent("file_save", `Saved ${saved.path}.`, "good", {
          path: saved.path,
          mimeType: saved.mimeType,
          updatedAtISO: saved.updatedAtISO || null,
        });
      } catch (error) {
        const message = String((error as Error)?.message || "Failed to save file.");
        if (!opts?.silent) pushRun(message, "bad");
        pushSystemEvent("file_save_fail", clamp(message, 180), "bad", { path: activePath });
      }
    },
    [activeNamespace, activePath, fileBuffer, fileMime, fileReadOnly, projectId, pushSystemEvent, refreshDirectory, siteOrigin]
  );

  const eventsTail = useCallback(
    (n = 10) => {
      const take = Math.max(1, Math.min(40, Number(n || 10)));
      const slice = events.slice(0, take);
      if (!slice.length) return ["No events yet."];
      return [
        `Events (latest ${slice.length})`,
        "",
        ...slice.map((event) => `${fmtTime(event.ts)}  ${eventTypeLabel(event.type)} — ${event.summary}`),
      ];
    },
    [events]
  );

  const eventsFilter = useCallback(
    (tone: Tone) => {
      const filtered = events.filter((event) => event.tone === tone);
      return [
        `Events filter: ${tone.toUpperCase()}`,
        "",
        ...(filtered.length
          ? filtered.map((event) => `${fmtTime(event.ts)}  ${eventTypeLabel(event.type)} — ${event.summary}`)
          : ["(no events match)"]),
      ];
    },
    [events]
  );

  const clearRunLog = useCallback(() => {
    setRunLog([]);
    pushRun("Terminal cleared.", "good");
  }, []);

  const runClientLocalCommand = useCallback(
    (raw: string): boolean => {
      const text = String(raw || "").trim().toLowerCase();
      if (!text) return true;

      if (text === "clear" || text === "cav clear") {
        clearRunLog();
        return true;
      }

      if (text === "cav events clear") {
        setEvents([]);
        pushRun("Events cleared.", "good");
        return true;
      }

      const tailMatch = text.match(/^cav\s+events\s+tail\s*(\d+)?$/i);
      if (tailMatch) {
        const n = Number(tailMatch[1] || 10);
        pushRun(joinLines(eventsTail(n)), "good");
        return true;
      }

      const filterMatch = text.match(/^cav\s+events\s+filter\s+(good|watch|bad)$/i);
      if (filterMatch) {
        pushRun(joinLines(eventsFilter(filterMatch[1].toLowerCase() as Tone)), "good");
        return true;
      }

      return false;
    },
    [clearRunLog, eventsFilter, eventsTail]
  );

  const runCommandFromInput = useCallback(
    async (rawInput: string) => {
      const typed = String(rawInput || "").trim();
      if (!typed) return;

      const translated = toLegacyAdjustedCommand(typed);
      const serverCommand = normalizeCommandForServer(translated);
      pushRun(`${PROMPT_PREFIX} ${typed}`, "watch");

      if (translated !== typed) {
        pushRun(`↳ ${translated}`, "watch");
      }

      if (runClientLocalCommand(translated)) {
        historyRef.current = [typed, ...historyRef.current].slice(0, 120);
        histIndexRef.current = -1;
        return;
      }

      try {
        const result = await callExec(serverCommand);
        applyExecResult(result, { renderOutput: true, updateCwd: true });

        if (!result.ok && result.error?.guardDecision) {
          pushRun(JSON.stringify(result.error.guardDecision, null, 2), "watch");
        }

        if (isMutationCommand(serverCommand)) {
          void refreshRoots();
        }
      } catch (error) {
        const msg = String((error as Error)?.message || "Command failed.");
        pushRun(msg, "bad");
        setSyncStatus({ lastSyncTs: Date.now(), serverReachable: false });

        pushSystemEvent("command_fail", clamp(msg, 160), "bad", {
          command: translated,
        });
      }

      historyRef.current = [typed, ...historyRef.current].slice(0, 120);
      histIndexRef.current = -1;
    },
    [PROMPT_PREFIX, applyExecResult, callExec, pushSystemEvent, refreshRoots, runClientLocalCommand]
  );

  const runCommand = useCallback(() => {
    const raw = cmd;
    setCmd("");
    setCmdOpen(false);
    void runCommandFromInput(raw);
  }, [cmd, runCommandFromInput]);

  const toggleDirectory = useCallback(
    (path: string) => {
      const p = normalizePath(path);
      setExpandedDirs((prev) => {
        const next = !Boolean(prev[p]);
        if (next && !dirCache[p]) {
          void refreshDirectory(p);
        }
        return { ...prev, [p]: next };
      });
    },
    [dirCache, refreshDirectory]
  );

  const prefetchDirectory = useCallback(
    (path: string) => {
      const p = normalizePath(path);
      if (dirCache[p]) return;
      if (prefetchingDirsRef.current.has(p)) return;
      prefetchingDirsRef.current.add(p);
      void refreshDirectory(p, { silent: true }).finally(() => {
        prefetchingDirsRef.current.delete(p);
      });
    },
    [dirCache, refreshDirectory]
  );

  const onSelectExplorerItem = useCallback(
    async (item: CavtoolsFsItem) => {
      if (item.type === "folder") {
        toggleDirectory(item.path);
        return;
      }

      await openFileInStudio(item.path, item.namespace);
    },
    [openFileInStudio, toggleDirectory]
  );

  function renderDirectory(path: string, depth: number): React.ReactNode {
    const items = dirCache[normalizePath(path)] || [];
    if (!items.length) return null;

    return (
      <div className={`cb-cavtools-treelevel ${depth > 0 ? "is-nested" : ""}`}>
        {items.map((item) => {
          const isFolder = item.type === "folder";
          const isExpanded = Boolean(expandedDirs[normalizePath(item.path)]);
          const isActive = activePath === normalizePath(item.path);

          return (
            <div key={`${item.path}_${item.type}`} className={`cb-cavtools-treenode ${isFolder && isExpanded ? "is-open" : ""}`}>
              <button
                type="button"
                className={`cb-cavtools-file ${isActive ? "is-on" : ""}`}
                style={{ paddingLeft: `${10 + depth * 14}px` }}
                onMouseEnter={() => {
                  if (isFolder) prefetchDirectory(item.path);
                }}
                onClick={() => {
                  void onSelectExplorerItem(item);
                }}
                role="treeitem"
                aria-selected={isActive}
                title={item.path}
              >
                <span className="cb-cavtools-ic" aria-hidden="true">
                  {isFolder ? (isExpanded ? "▾" : "▸") : "•"}
                </span>
                <span className="cb-cavtools-fn">{item.name}</span>
              </button>

              {isFolder && isExpanded ? <div className="cb-cavtools-treechildren">{renderDirectory(item.path, depth + 1)}</div> : null}
            </div>
          );
        })}
      </div>
    );
  }

  const inspectorBody = useMemo(() => {
    return [
      "# CavTools Command Plane",
      "",
      "Server-authorized, multi-tenant operator surface for CavBot.",
      "",
      "## Context",
      `- operator: ${operator}`,
      `- project: ${projectId || "—"}`,
      `- site origin: ${siteOrigin || "—"}`,
      `- cwd: ${cwdDisplay}`,
      `- status: ${statusLabel}`,
      `- sync: ${syncStatus.lastSyncTs ? fmtTime(syncStatus.lastSyncTs) : "—"}`,
      "",
      "## Namespaces",
      "- cavcloud: workspace cloud resources",
      "- cavsafe: premium secure resources with ACL",
      "- cavcode: project-mounted code surface",
      "- telemetry: operational read-only intelligence",
      "- workspace: account and policy posture",
      "",
      "## Core Commands",
      "- pwd, cd, ls, tree",
      "- cat, open, search",
      "- mkdir, touch, write, mv, cp, rm",
      "- cav status, cav whoami, cav ctx, cav sync",
      "- cav telemetry summary|routes|errors|seo|a11y|geo|scans|export",
      "- cav workspace status|sites|members|guardrails|notices",
      "- cav cloud share|publish|unpublish",
      "- cav safe invite|revoke|audit",
      "",
      "## Guidance",
      "- Command execution and file mutations are server-authorized.",
      "- Studio edits canonical files through /api/cavtools/file.",
      "- Events rail captures runtime/client and command-plane activity.",
    ].join("\n");
  }, [cwdDisplay, operator, projectId, siteOrigin, statusLabel, syncStatus.lastSyncTs]);

  const eventsBody = useMemo(() => {
    return [
      "# Event Stream",
      "",
      "The stream aggregates:",
      "- browser runtime errors and unhandled rejections",
      "- fetch failures and HTTP errors",
      "- console warn/error signals",
      "- command execution outcomes",
      "- cavbot client log fan-in when available",
      "",
      "Commands:",
      "- cav events tail 10",
      "- cav events filter bad",
      "- cav events clear",
    ].join("\n");
  }, []);

  const settingsBody = useMemo(() => {
    const totalCached = Object.keys(dirCache).reduce((sum, key) => sum + (dirCache[key]?.length || 0), 0);
    return [
      "# Command Plane Settings",
      "",
      "Server integrations:",
      "- POST /api/cavtools/exec",
      "- GET/PUT /api/cavtools/file",
      "",
      "Live posture:",
      `- project: ${projectId || "—"}`,
      `- origin: ${siteOrigin || "—"}`,
      `- cwd: ${cwdDisplay}`,
      `- cache entries: ${totalCached}`,
      `- active file: ${activePath ? toUiPath(activePath) : "—"}`,
      `- mime: ${fileMime || "—"}`,
      `- readonly: ${fileReadOnly ? "yes" : "no"}`,
      "",
      "Notes:",
      "- Local state is UI cache only; canonical state is server-backed.",
      "- Sensitive operations are audited by command-plane backend.",
      "- CavSafe actions enforce entitlement and ACL checks.",
    ].join("\n");
  }, [activePath, cwdDisplay, dirCache, fileMime, fileReadOnly, projectId, siteOrigin]);

  useEffect(() => {
    function computeDesktop() {
      try {
        const mq = window.matchMedia("(min-width: 980px)");
        const fine = window.matchMedia("(pointer: fine)");
        setIsDesktop(Boolean(mq.matches && fine.matches));
      } catch {
        setIsDesktop(true);
      }
    }

    computeDesktop();
    window.addEventListener("resize", computeDesktop);
    return () => window.removeEventListener("resize", computeDesktop);
  }, []);

  useEffect(() => {
    try {
      const name = (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim();
      if (name) setWelcomeName(name);
      const username = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().toLowerCase();
      const initials = (globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim();
      const tone = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim();
      const avatar = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim();
      const publicEnabled = readPublicProfileEnabled();
      const resolved = deriveAccountInitials(name, username, initials);
      setProfileUsername(username);
      setProfileInitials(resolved);
      setProfileTone(tone || "lime");
      setProfileAvatar(avatar || "");
      if (publicEnabled !== null) setProfilePublicEnabled(publicEnabled);
    } catch {
      // noop
    }

    function onProfile(event: Event) {
      try {
        const detail = (event as CustomEvent<{
          fullName?: string;
          username?: string;
          initials?: string;
          avatarImage?: string | null;
          avatarTone?: string;
          publicProfileEnabled?: boolean;
        }>).detail;
        const fullName = String(detail?.fullName || "").trim();
        const username = String(detail?.username || "").trim().toLowerCase();
        const fallbackInitials = String(detail?.initials || "").trim();
        const cachedName = (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim();
        const cachedUsername = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().toLowerCase();
        const nextName = fullName || cachedName;
        const nextUsername = username || cachedUsername;
        if (nextName) setWelcomeName(nextName);
        setProfileUsername(nextUsername);
        setProfileInitials(deriveAccountInitials(nextName, nextUsername, fallbackInitials));
        if (typeof detail?.avatarTone === "string" && detail.avatarTone.trim()) {
          setProfileTone(detail.avatarTone.trim());
        }
        if (typeof detail?.avatarImage === "string") {
          setProfileAvatar(detail.avatarImage.trim());
        } else if (detail?.avatarImage === null) {
          setProfileAvatar("");
        }
        if (typeof detail?.publicProfileEnabled === "boolean") setProfilePublicEnabled(detail.publicProfileEnabled);
        try {
          if (nextName) globalThis.__cbLocalStore.setItem("cb_profile_fullName_v1", nextName);
          if (nextUsername) globalThis.__cbLocalStore.setItem("cb_profile_username_v1", nextUsername);
          if (fallbackInitials) globalThis.__cbLocalStore.setItem("cb_account_initials", fallbackInitials);
        } catch {
          // noop
        }
      } catch {
        // noop
      }
    }

    window.addEventListener("cb:profile", onProfile as EventListener);
    return () => window.removeEventListener("cb:profile", onProfile as EventListener);
  }, []);

  useEffect(() => {
    let active = true;
    async function pullProfile() {
      try {
        const res = await fetch("/api/auth/me", { method: "GET", cache: "no-store" });
        const data = await res.json().catch(() => null) as
          | null
          | {
              ok?: boolean;
              user?: {
                displayName?: string | null;
                username?: string | null;
                initials?: string | null;
                avatarTone?: string | null;
                avatarImage?: string | null;
                publicProfileEnabled?: boolean | null;
              };
            };
        if (!active || !res.ok || !data?.ok) return;
        const fullName = String(data.user?.displayName || "").trim();
        const username = String(data.user?.username || "").trim().toLowerCase();
        const initials = String(data.user?.initials || "").trim();
        const avatarTone = String(data.user?.avatarTone || "").trim();
        const avatarImage = String(data.user?.avatarImage || "").trim();
        if (fullName) setWelcomeName(fullName);
        setProfileUsername(username);
        setProfileInitials(deriveAccountInitials(fullName, username, initials));
        if (avatarTone) setProfileTone(avatarTone);
        setProfileAvatar(avatarImage || "");
        if (typeof data.user?.publicProfileEnabled === "boolean") {
          setProfilePublicEnabled(data.user.publicProfileEnabled);
        }
      } catch {
        // noop
      }
    }
    void pullProfile();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onDocPointer(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!accountWrapRef.current) return;
      if (target instanceof Node && accountWrapRef.current.contains(target)) return;
      setAccountOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    window.addEventListener("mousedown", onDocPointer);
    window.addEventListener("touchstart", onDocPointer, { passive: true });
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onDocPointer);
      window.removeEventListener("touchstart", onDocPointer);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  const accountInitials = useMemo(
    () => deriveAccountInitials(welcomeName, profileUsername, profileInitials),
    [profileInitials, profileUsername, welcomeName]
  );
  const publicProfileHref = useMemo(() => {
    return buildCanonicalPublicProfileHref(profileUsername);
  }, [profileUsername]);
  const profileMenuLabel = useMemo(() => {
    if (profilePublicEnabled === null) return "Profile";
    return profilePublicEnabled ? "Public Profile" : "Private Profile";
  }, [profilePublicEnabled]);

  function onOpenAccount() {
    setAccountOpen(false);
    try {
      openCanonicalPublicProfileWindow({ href: publicProfileHref, fallbackHref: "/settings?tab=account" });
    } catch {}
  }

  async function onLogout() {
    setAccountOpen(false);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
      });
    } catch {}
    try {
      window.location.replace("/auth?mode=login");
    } catch {}
  }

  useEffect(() => {
    pushSystemEvent("cavtools_mount", "CavTools command plane mounted.", "good", {
      projectId: projectId || null,
      siteOrigin: siteOrigin || null,
      ua: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    void refreshRoots();
    void runCommandFromInput("cav status");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canUseCavsafe) {
      setGroupOpen((prev) => (prev.cavsafe ? { ...prev, cavsafe: false } : prev));
      if (cwd.startsWith("/cavsafe")) setCwd("/cavcloud");
      if (activePath.startsWith("/cavsafe")) {
        setActiveNamespace(null);
        setActivePath("");
        setFileBuffer("");
        setFileDirty(false);
      }
    }
  }, [activePath, canUseCavsafe, cwd]);

  useEffect(() => {
    if (!canUseCavsafe) return;
    void refreshDirectory("/cavsafe");
  }, [canUseCavsafe, refreshDirectory]);

  useEffect(() => {
    function onError(event: ErrorEvent) {
      pushSystemEvent("js_error", clamp(event.message || "Runtime error", 180), "bad", {
        source: redactUrl(String(event.filename || "")),
        line: Number(event.lineno || 0),
        col: Number(event.colno || 0),
      });
    }

    function onUnhandled(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message = typeof reason === "string" ? reason : reason?.message || String(reason || "Unhandled rejection");
      pushSystemEvent("unhandled_rejection", clamp(message, 180), "bad", {
        reason: tryJson(reason),
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, [pushSystemEvent]);

  useEffect(() => {
    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      pushSystemEvent(
        "console_error",
        clamp(
          args
            .map((arg) => {
              if (typeof arg === "string") return arg;
              try {
                return JSON.stringify(arg);
              } catch {
                return String(arg);
              }
            })
            .join(" "),
          180
        ),
        "bad"
      );
      origError(...args);
    };

    console.warn = (...args: unknown[]) => {
      pushSystemEvent(
        "console_warn",
        clamp(
          args
            .map((arg) => {
              if (typeof arg === "string") return arg;
              try {
                return JSON.stringify(arg);
              } catch {
                return String(arg);
              }
            })
            .join(" "),
          180
        ),
        "watch"
      );
      origWarn(...args);
    };

    return () => {
      console.error = origError;
      console.warn = origWarn;
    };
  }, [pushSystemEvent]);

  useEffect(() => {
    const origFetch = window.fetch;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const started = Date.now();
      let url = "";
      try {
        const first = args[0];
        if (typeof first === "string") url = first;
        else if (first instanceof URL) url = first.href;
        else if (first && "url" in first) url = String((first as Request).url || "");
      } catch {
        // noop
      }

      try {
        const res = await origFetch(...args);
        const ms = Date.now() - started;
        const isInternal = url.includes("/api/cavtools/");

        if (!isInternal && res.status >= 400) {
          pushSystemEvent(
            "fetch_http_error",
            `${res.status} ${res.statusText || "HTTP error"} — ${clamp(redactUrl(url), 120)}`,
            res.status >= 500 ? "bad" : "watch",
            {
              status: res.status,
              statusText: res.statusText || "",
              url: redactUrl(url),
              ms,
            }
          );
        }

        return res;
      } catch (error) {
        const ms = Date.now() - started;
        if (!url.includes("/api/cavtools/")) {
          pushSystemEvent("fetch_failed", `Fetch failed — ${clamp(redactUrl(url), 120)}`, "bad", {
            url: redactUrl(url),
            ms,
            error: tryJson(error),
          });
        }
        throw error;
      }
    };

    return () => {
      window.fetch = origFetch;
    };
  }, [pushSystemEvent]);

  useEffect(() => {
    function pullClientLog() {
      try {
        const raw = globalThis.__cbLocalStore.getItem("cavbotEventLogV1");
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;

        const currentLen = parsed.length;
        const lastSeen = lastClientEventLenRef.current || 0;
        if (currentLen <= lastSeen) return;
        lastClientEventLenRef.current = currentLen;

        const slice = parsed.slice(Math.max(0, currentLen - Math.min(50, currentLen - lastSeen)));
        for (const row of slice) {
          const summary = String((row as { summary?: unknown; msg?: unknown }).summary || (row as { msg?: unknown }).msg || "client_event");
          const ts = Number((row as { ts?: unknown; time?: unknown }).ts || (row as { time?: unknown }).time || Date.now());
          pushEvent({
            type: `client_${String((row as { type?: unknown }).type || "event")}`,
            ts,
            origin: getLiveOriginFallback(siteOrigin),
            summary: clamp(summary, 140),
            tone: "good",
            data: tryJson(row),
          });
        }
      } catch {
        // noop
      }
    }

    pullClientLog();
    const intervalId = window.setInterval(pullClientLog, 6000);
    return () => window.clearInterval(intervalId);
  }, [pushEvent, siteOrigin]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdOpen(true);
        window.setTimeout(() => cmdRef.current?.focus(), 0);
        return;
      }

      if (event.key === "Escape") {
        setCmdOpen(false);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (tab === "studio" && activePath && !fileReadOnly) {
          event.preventDefault();
          void saveActiveFile();
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath, fileReadOnly, saveActiveFile, tab]);

  useEffect(() => {
    if (!tab || tab !== "studio") return;
    if (!activePath || !fileDirty || fileReadOnly) return;

    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveActiveFile({ silent: true });
    }, 900);

    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    };
  }, [activePath, fileDirty, fileReadOnly, saveActiveFile, tab]);

  function handleCmdKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setCmdOpen(false);
      setCmd("");
      histIndexRef.current = -1;
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const hist = historyRef.current;
      if (!hist.length) return;
      const next = Math.min(hist.length - 1, histIndexRef.current + 1);
      histIndexRef.current = next;
      setCmd(hist[next] || "");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const hist = historyRef.current;
      if (!hist.length) return;
      const next = Math.max(-1, histIndexRef.current - 1);
      histIndexRef.current = next;
      setCmd(next === -1 ? "" : hist[next] || "");
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const current = String(cmd || "").trim();
      if (!current) {
        setCmd("ls ");
        return;
      }

      const hitCommand = KNOWN_COMMANDS.find((candidate) => candidate.toLowerCase().startsWith(current.toLowerCase()));
      if (hitCommand) {
        setCmd(hitCommand);
        return;
      }

      const tokens = current.split(/\s+/);
      const last = tokens[tokens.length - 1] || "";
      const pathProbe = last.replace(/^\/+/, "");
      if (isNamespacePathToken(pathProbe)) {
        const hitPath = dynamicPathHints.find((path) => path.toLowerCase().startsWith(pathProbe.toLowerCase()));
        if (hitPath) {
          tokens[tokens.length - 1] = hitPath;
          setCmd(tokens.join(" "));
          return;
        }
      }

      const fuzzy = KNOWN_COMMANDS.find((candidate) => candidate.toLowerCase().includes(current.toLowerCase()));
      if (fuzzy) setCmd(fuzzy);
    }
  }

  const editorContent = tab === "inspector" ? inspectorBody : tab === "events" ? eventsBody : settingsBody;

  if (booting) {
    return (
      <div className="cb-cavtools-loading" role="status" aria-live="polite">
        <div className="cb-cavtools-loading-card">
          <div className="cb-cavtools-loading-badge" aria-hidden="true">
            <IconCavTools />
          </div>
          <div className="cb-cavtools-loading-title">CavTools</div>
          <div className="cb-cavtools-loading-sub">For Developers</div>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-cavtools-root">
      {!isDesktop ? (
        <div className="cb-cavtools-mobile" role="main">
          <div role="status" aria-live="polite">
            <CavGuardCard
              variant="surface"
              headline="Desktop operator surface required."
              request="CavTools is CavGuarded to desktop-class screens because secure command execution and multi-namespace controls require a full operator viewport."
              reason="Open on desktop or widen your viewport to re-enter the guarded surface."
              actions={[
                { label: "COMMAND CENTER", href: "/" },
                {
                  label: "REFRESH",
                  onClick: () => {
                    try {
                      window.location.reload();
                    } catch {
                      // noop
                    }
                  },
                },
              ]}
            />
          </div>
        </div>
      ) : (
        <div className="cb-cavtools-desktop">
          <header className="cb-cavtools-top" role="banner">
            <div className="cb-cavtools-top-left">
              <CavMobileMenu />
              <Link className="cb-cavtools-badge" aria-label="Home" href="/">
                <CdnBadgeEyes className="cb-cavtools-badgeNoRing" />
              </Link>

              <div className="cb-cavtools-top-meta">
                <div className="cb-cavtools-top-title">
                  <span className="cb-cavtools-title-row">
                    <span className="cb-cavtools-title-ic" aria-hidden="true">
                      <IconCavTools />
                    </span>
                    <span>CavTools</span>
                    <div className="cb-cavtools-top-sub">{tabSubtitle}</div>
                  </span>
                </div>
              </div>
            </div>

            <div className="cb-cavtools-top-right" aria-label="Primary actions">
              <div className="cb-account-wrap cb-cavtools-account-wrap" ref={accountWrapRef}>
                <button
                  className="cb-account cb-cavtools-account"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((v) => !v)}
                  title="Account"
                >
                  <span className="cb-account-chip cb-avatar-plain" data-tone={profileTone || "lime"} aria-hidden="true">
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

                {accountOpen ? (
                  <div className="cb-menu cb-menu-right" role="menu" aria-label="Account">
                    <button className="cb-menu-item" type="button" role="menuitem" onClick={onOpenAccount}>
                      {profileMenuLabel}
                    </button>
                    <button className="cb-menu-item danger" type="button" role="menuitem" onClick={() => void onLogout()}>
                      Log out
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="cb-cavtools-shell">
            <aside className="cb-cavtools-side" aria-label="Explorer">
              <div className="cb-cavtools-sidehead">
                <div className="cb-cavtools-sidek">EXPLORER</div>
              </div>

              <div className="cb-cavtools-tree" role="tree">
                {ROOTS.map((root) => {
                  const isOpen = Boolean(groupOpen[root.namespace]);
                  const rootItems = dirCache[root.path] || [];
                  const isCavsafeLocked = root.namespace === "cavsafe" && !canUseCavsafe;
                  return (
                    <div className="cb-cavtools-group" key={root.path}>
                      <button
                        type="button"
                        className={`cb-cavtools-grouphead cb-cavtools-groupbtn${isCavsafeLocked ? " is-disabled" : ""}`}
                        onClick={() => {
                          if (isCavsafeLocked) return;
                          const nextOpen = !Boolean(groupOpen[root.namespace]);
                          setGroupOpen((prev) => ({
                            ...prev,
                            [root.namespace]: nextOpen,
                          }));
                          if (nextOpen && !rootItems.length) {
                            void refreshDirectory(root.path);
                          }
                        }}
                        onMouseEnter={() => {
                          if (!isCavsafeLocked && !rootItems.length) prefetchDirectory(root.path);
                        }}
                        aria-expanded={isOpen}
                        disabled={isCavsafeLocked}
                        title={isCavsafeLocked ? "CavSafe is owner-only in CavTools." : undefined}
                      >
                        <span className={`cb-cavtools-groupchev ${isOpen ? "is-open" : ""}`} aria-hidden="true">
                          ▸
                        </span>
                        <span>{root.label}</span>
                      </button>

                      {isOpen ? (
                        <div className="cb-cavtools-groupitems">
                          {!isCavsafeLocked && rootItems.length ? renderDirectory(root.path, 0) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="cb-cavtools-sidefoot">
                <div className="cb-cavtools-mini">
                  <div className="cb-cavtools-minik">Bound origin</div>
                  <div className="cb-cavtools-miniv mono">{siteOrigin || "—"}</div>
                </div>

                <div className="cb-cavtools-mini">
                  <div className="cb-cavtools-minik">CWD</div>
                  <div className="cb-cavtools-miniv mono">{cwdDisplay}</div>
                </div>

                <div className="cb-cavtools-mini">
                  <div className="cb-cavtools-minik">Status</div>
                  <div className="cb-cavtools-miniv">
                    <span className={`cb-cavtools-dot ${statusTone}`} />
                    {statusLabel}
                  </div>
                </div>
              </div>
            </aside>

            <main className="cb-cavtools-main" aria-label="Dev workspace">
              <div className="cb-cavtools-tabs" role="tablist" aria-label="CavTools tabs">
                <button
                  type="button"
                  className={`cb-cavtools-tab ${tab === "inspector" ? "is-on" : ""}`}
                  onClick={() => setTab("inspector")}
                  role="tab"
                  aria-selected={tab === "inspector"}
                  aria-label="Inspector"
                  title="Inspector"
                >
                  <Image
                    src="/icons/app/cavtools/inspector-panel-svgrepo-com.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="cb-cavtools-tab-icon-image cb-cavtools-btn-icon-light"
                    draggable={false}
                  />
                </button>
                <button
                  type="button"
                  className={`cb-cavtools-tab ${tab === "events" ? "is-on" : ""}`}
                  onClick={() => setTab("events")}
                  role="tab"
                  aria-selected={tab === "events"}
                  aria-label="Events"
                  title="Events"
                >
                  <Image
                    src="/icons/app/cavtools/events-svgrepo-com.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="cb-cavtools-tab-icon-image cb-cavtools-btn-icon-light"
                    draggable={false}
                  />
                </button>
                <button
                  type="button"
                  className={`cb-cavtools-tab ${tab === "studio" ? "is-on" : ""}`}
                  onClick={() => setTab("studio")}
                  role="tab"
                  aria-selected={tab === "studio"}
                  aria-label="Studio"
                  title="Studio"
                >
                  <Image
                    src="/icons/app/cavtools/studio-svgrepo-com.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="cb-cavtools-tab-icon-image cb-cavtools-btn-icon-light"
                    draggable={false}
                  />
                </button>
                <button
                  type="button"
                  className={`cb-cavtools-tab ${tab === "settings" ? "is-on" : ""}`}
                  onClick={() => setTab("settings")}
                  role="tab"
                  aria-selected={tab === "settings"}
                  aria-label="Settings"
                  title="Settings"
                >
                  <Image
                    src="/icons/app/cavtools/settings-svgrepo-com.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="cb-cavtools-tab-icon-image cb-cavtools-btn-icon-light"
                    draggable={false}
                  />
                </button>

                <span className="cb-cavtools-hotkey-chip" aria-label="Hotkey">
                  <span className="cb-cavtools-hotkey-half" aria-label="Command + K">
                    <span className="kbd" aria-label="Command key">
                      <Image
                        src="/icons/app/cavtools/command-svgrepo-com.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="cb-cavtools-kbd-icon cb-cavtools-kbd-icon-command"
                        draggable={false}
                      />
                    </span>
                    <span className="kbd" aria-label="K key">
                      <Image
                        src="/icons/app/cavtools/letter-k-svgrepo-com.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="cb-cavtools-kbd-icon cb-cavtools-kbd-icon-k"
                        draggable={false}
                      />
                    </span>
                  </span>
                  <span className="cb-cavtools-hotkey-divider" aria-hidden="true" />
                  <span className="cb-cavtools-hotkey-half" aria-label="Control + K">
                    <span className="kbd" aria-label="Control key">
                      <Image
                        src="/icons/app/cavtools/ctrl-a-svgrepo-com.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="cb-cavtools-kbd-icon cb-cavtools-kbd-icon-ctrl"
                        draggable={false}
                      />
                    </span>
                    <span className="kbd" aria-label="K key">
                      <Image
                        src="/icons/app/cavtools/letter-k-svgrepo-com.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="cb-cavtools-kbd-icon cb-cavtools-kbd-icon-k"
                        draggable={false}
                      />
                    </span>
                  </span>
                </span>

              </div>

              <div className="cb-cavtools-grid">
                <section className="cb-cavtools-editor" aria-label="Editor">
                  <div className="cb-cavtools-editorhead">
                    <div className="cb-cavtools-editorname">{tab === "studio" ? "Studio" : tab === "events" ? "Events" : tab === "settings" ? "Settings" : "Inspector"}</div>
                    <div className="cb-cavtools-editorhint">
                      <span className="cb-cavtools-editorhintcmd">
                        Active cwd: <b className="mono">{cwdDisplay}</b>
                      </span>
                    </div>
                  </div>

                  {tab === "studio" ? (
                    <div className="cb-cavtools-studio">
                      <div className="cb-cavtools-studio-toolbar" role="toolbar" aria-label="Studio actions">
                        <div className="cb-cavtools-studio-left">
                          <span className="cb-cavtools-studio-chip" title={activePath ? activeLang : "TEXT"} aria-label={activePath ? activeLang : "TEXT"}>
                            {activePath ? activeLang : "TEXT"}
                          </span>
                        </div>

                        <div className="cb-cavtools-studio-right">
                          <button
                            className="cb-cavtools-btn cb-cavtools-action-btn"
                            type="button"
                            onClick={() => {
                              if (!activePath) return;
                              void openFileInStudio(activePath, activeNamespace || undefined);
                            }}
                            aria-label="Reload file"
                            title="Reload"
                            disabled={!activePath}
                          >
                            <Image
                              src="/icons/refresh-circle-svgrepo-com.svg"
                              alt=""
                              width={18}
                              height={18}
                              className="cb-cavtools-btn-icon-light cb-cavtools-action-icon-image"
                              draggable={false}
                            />
                          </button>

                          <button
                            className="cb-cavtools-btn cb-cavtools-action-btn"
                            type="button"
                            onClick={() => {
                              if (!activePath) return;
                              void runCommandFromInput(`open ${toUiPath(activePath)}`);
                            }}
                            aria-label="Open resource"
                            title="Open resource"
                            disabled={!activePath}
                          >
                            <Image
                              src="/icons/open-svgrepo-com.svg"
                              alt=""
                              width={18}
                              height={18}
                              className="cb-cavtools-btn-icon-light cb-cavtools-action-icon-image cb-cavtools-action-icon-open"
                              draggable={false}
                            />
                          </button>

                          <button
                            className="cb-cavtools-btn cb-cavtools-action-btn"
                            type="button"
                            onClick={() => {
                              setCmd(`cat ${activePath ? toUiPath(activePath) : cwdDisplay}`);
                              setCmdOpen(true);
                              window.setTimeout(() => cmdRef.current?.focus(), 0);
                            }}
                            aria-label="Send to terminal"
                            title="Send to terminal"
                          >
                            <Image
                              src="/icons/app/cavtools/command-svgrepo-com.svg"
                              alt=""
                              width={18}
                              height={18}
                              className="cb-cavtools-btn-icon-light cb-cavtools-action-icon-image cb-cavtools-action-icon-command"
                              draggable={false}
                            />
                          </button>

                          <button
                            className="cb-cavtools-btn cb-cavtools-btn-strong cb-cavtools-action-btn"
                            type="button"
                            onClick={() => {
                              void saveActiveFile();
                            }}
                            aria-label="Save file"
                            title="Save (Cmd/Ctrl + S)"
                            disabled={!activePath || fileReadOnly || !fileDirty}
                          >
                            <Image
                              src="/icons/save-svgrepo-com.svg"
                              alt=""
                              width={18}
                              height={18}
                              className="cb-cavtools-btn-icon-light cb-cavtools-action-icon-image"
                              draggable={false}
                            />
                          </button>
                        </div>
                      </div>

                      <div className="cb-cavtools-studio-body">
                        {!activePath ? (
                          <div className="cb-cavtools-streamempty">
                            <div className="cb-cavtools-emptycopy">
                              <span>Select a file from explorer or run</span>
                              <span className="mono">cat &lt;path&gt;</span>
                              <span>in terminal.</span>
                            </div>
                          </div>
                        ) : fileLoading ? (
                          <div className="cb-cavtools-streamempty">
                            <div className="cb-cavtools-emptycopy">
                              <span>Opening file…</span>
                            </div>
                          </div>
                        ) : (
                          <textarea
                            className="cb-cavtools-studio-editor mono"
                            ref={studioEditorRef}
                            value={fileBuffer}
                            spellCheck={false}
                            onChange={(event) => {
                              if (fileReadOnly) return;
                              setFileBuffer(event.target.value);
                              setFileDirty(true);
                            }}
                            readOnly={fileReadOnly}
                            aria-label="CavTools studio editor"
                          />
                        )}
                      </div>
                    </div>
                  ) : (
                    <pre className="cb-cavtools-editorpre">{editorContent}</pre>
                  )}
                </section>

                <aside className="cb-cavtools-rail" aria-label="Side rail" data-terminal-expanded={terminalExpanded ? "true" : "false"}>
                  <section className="cb-cavtools-railcard" aria-label="Event stream">
                    <div className="cb-cavtools-railhead">
                      <div className="cb-cavtools-railtitle">Event Stream</div>
                      <div className="cb-cavtools-railactions">
                        <button
                          className="cb-cavtools-btn"
                          type="button"
                          onClick={() => pushRun(joinLines(eventsTail(12)), "good")}
                          title="Tail"
                        >
                          Tail
                        </button>
                        <button
                          className="cb-cavtools-btn"
                          type="button"
                          onClick={() => {
                            setEvents([]);
                            pushRun("Events cleared.", "good");
                          }}
                          title="Clear"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="cb-cavtools-stream" role="log" aria-live="polite">
                      {events.length ? (
                        events.slice(0, 44).map((event) => (
                          <div key={event.id} className={`cb-cavtools-streamitem ${event.tone}`}>
                            <div className="cb-cavtools-streamtop">
                              <span className="cb-cavtools-streamtime mono">{fmtTime(event.ts)}</span>
                              <span className={`cb-cavtools-streamkind ${event.tone}`}>{eventTypeLabel(event.type)}</span>
                            </div>
                            <div className="cb-cavtools-streamsum">{event.summary}</div>
                          </div>
                        ))
                      ) : (
                        <div className="cb-cavtools-streamempty">No events yet.</div>
                      )}
                    </div>
                  </section>

                  <section className={`cb-cavtools-railcard ${terminalExpanded ? "is-expanded" : ""}`} aria-label="Terminal output">
                    <div className="cb-cavtools-railhead">
                      <div className="cb-cavtools-railtitle">Terminal Output</div>
                      <div className="cb-cavtools-railactions">
                        <button
                          className="cb-cavtools-btn"
                          type="button"
                          onClick={() => setTerminalExpanded((prev) => !prev)}
                          title={terminalExpanded ? "Shrink" : "Expand"}
                        >
                          {terminalExpanded ? <IconTermShrink /> : <IconTermExpand />}
                        </button>
                        <button className="cb-cavtools-btn" type="button" onClick={clearRunLog} title="Clear output">
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="cb-cavtools-terminal" role="log" aria-live="polite">
                      {runLog.length ? (
                        runLog.slice(0, terminalExpanded ? 160 : 28).map((row) => (
                          <div key={row.id} className={`cb-cavtools-termline ${row.tone}`}>
                            <div className="cb-cavtools-termmeta mono">{fmtTime(row.ts)}</div>
                            <pre className="cb-cavtools-termpre mono">{row.out}</pre>
                          </div>
                        ))
                      ) : (
                        <div className="cb-cavtools-termempty">No output yet. Press ⌘K / Ctrl K.</div>
                      )}
                    </div>
                  </section>
                </aside>
              </div>

              <div className={`cb-cavtools-cmd ${cmdOpen ? "is-open" : ""}`} role="region" aria-label="Command bar">
                <div className="cb-cavtools-cmdleft">
                  <span className="cb-cavtools-cmdk">CavBot Terminal</span>
                </div>

                <div className="cb-cavtools-cmdmid">
                  <div className="cb-cavtools-promptwrap" aria-label="Terminal prompt">
                    <span className="cb-cavtools-prompt mono" aria-hidden="true">
                      {PROMPT_PREFIX}
                    </span>

                    <input
                      ref={cmdRef}
                      className="cb-cavtools-cmdinput mono"
                      value={cmd}
                      onChange={(event) => setCmd(event.target.value)}
                      onKeyDown={handleCmdKeyDown}
                      placeholder='Try: ls cavcloud or cav telemetry summary'
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Command input"
                    />
                  </div>
                </div>

                <div className="cb-cavtools-cmdright">
                  <button className="cb-cavtools-btn cb-cavtools-btn-strong" type="button" onClick={runCommand}>
                    Run
                  </button>
                </div>
              </div>
            </main>
          </div>
        </div>
      )}
    </div>
  );
}
