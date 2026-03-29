import type { FsState } from "./codebaseFs";
import {
  baseName,
  CODEBASE_FS_KEY,
  displayRelFromCodebase,
  isCodebasePath,
  listChildren,
  now,
  parentDir,
  toCodebaseAbs,
} from "./codebaseFs";

export type CavTone = "good" | "watch" | "bad";

export type CavMarker = {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warn";
  message: string;
};

export type CavDiagStatus = {
  lastSyncTs?: number;
  storageActive?: boolean;
};

export type CavResult = {
  tone: CavTone;
  lines: string[];
};

export type CavContext = {
  operator: string;
  projectId?: string | null;
  siteOrigin?: string | null;
  pageKind: "cavtools" | "cavcode";
  activeFilePath?: string;
  cwdLabel?: string;

  now: () => number;

  navigate: (path: string, qsPairs?: Array<[string, string]>) => void;
  getQSBasePairs: () => Array<[string, string]>;
  openLive?: (path: string, qsPairs?: Array<[string, string]>) => void;

  setTab: (key: string) => void;
  focusTerminal?: () => void;
  focusEditor?: () => void;

  openCodebaseFile: (absPath: string, opts?: { line?: number; col?: number; focus?: boolean }) => void;
  openWorkspaceFile?: (path: string, opts?: { line?: number; col?: number; focus?: boolean }) => void;

  getMarkers?: () => CavMarker[];
  getEventCounts?: () => { errors: number; warnings: number };

  studioRun?: () => void;
  studioClear?: () => void;
  studioReset?: () => void;

  eventsTail?: (n: number) => string[];
  eventsClear?: () => void;
  eventsFilter?: (tone: CavTone) => string[];

  clearOutput: () => void;

  codebaseGet: () => FsState;
  codebaseSet: (next: FsState) => void;
  codebaseUpdate: (mutator: (prev: FsState) => FsState) => void;

  workspaceGet?: () => WorkspaceNode;
  workspaceSet?: (next: WorkspaceNode) => void;
  workspaceUpdate?: (mutator: (prev: WorkspaceNode) => WorkspaceNode) => void;

  forceSync: () => void;
  getSyncStatus?: () => CavDiagStatus;

  liveUrl?: string;

  getExportPayload?: () => unknown;
};

export type WorkspaceNode = {
  kind: "file" | "folder";
  name: string;
  path: string;
  content?: string;
  children?: WorkspaceNode[];
};

const CAVTOOLS_TABS = ["inspector", "events", "studio", "checklist", "settings"] as const;
const CAVCODE_TABS = ["explorer", "search", "scm", "live", "run", "settings"] as const;

export function clamp(s: unknown, n = 220) {
  const x = String(s ?? "").trim();
  return x.length > n ? `${x.slice(0, n)}…` : x;
}

export function tokenize(input: string) {
  return String(input || "")
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function joinLines(lines: string[]) {
  return lines.join("\n");
}

export const KNOWN_COMMANDS = [
  "cav guide",
  "cav run guide",
  "cav commands",
  "cav help",
  "cav help all",
  "cav status",
  "cav ctx",
  "cav clear",
  "cav whoami",
  "cav sync",
  "cav diag",
  "cav diag errors",
  'cav diag find "codebase"',
  "cav events",
  "cav git status",
  "cav git diff",
  "cav git diff --staged --numstat",
  "cav git stage .",
  "cav git stage line src/app.ts 42",
  "cav git unstage hunk src/app.ts 42 64",
  'cav git commit "message"',
  "cav git commit --amend",
  "cav git remote list",
  "cav git fetch origin",
  "cav git pull origin main",
  "cav git push --set-upstream origin feature-branch",
  "cav git conflicts list",
  "cav git conflicts resolve src/app.ts ours",
  "cav git rebase --continue",
  "cav git cherry-pick <commit>",
  "cav git log 20",
  "cav git branch list",
  "cav debug start /cavcode/app/page.tsx",
  "cav debug start --target 1",
  "cav debug start --target api --profile dev --variant local",
  "cav debug config list",
  "cav debug config start backend --compound",
  "cav debug attach 9229",
  "cav debug status",
  "cav debug status --all",
  "cav debug select <sessionId>",
  "cav debug frame select 1",
  "cav debug threads select 1",
  "cav debug break set /cavcode/app/page.tsx:12",
  "cav debug break enable-set backend-hotpath",
  "cav debug watch add user.id",
  "cav debug evaluate user.id",
  "cav debug continue",
  "cav debug next",
  "cav debug out",
  "cav debug pause",
  "cav debug stop",
  "cav project service start",
  "cav project service status --all",
  "cav project service diagnostics",
  "cav task list",
  "cav task run build",
  "cav task history 20",
  "cav extension marketplace list",
  "cav extension install publisher.ext@1.0.0",
  "cav extension host start",
  "cav extension activate onStartupFinished",
  "cav collab session start /cavcode/src/app.tsx ot",
  "cav collab presence set <sessionId> --file /cavcode/src/app.tsx --cursor 12:4 --panel terminal,debug",
  'cav collab op apply <sessionId> insert 10 "hello"',
  "cav security status",
  "cav security profile set balanced --sandbox standard --network project-only",
  "cav security secrets set OPENAI_API_KEY sk_xxx --scopes runtime,task,debug",
  "cav security scan run",
  "cav security audit 80",
  "cav remote provider list",
  "cav remote provider upsert devbox ssh --label \"SSH Devbox\" --config '{\"host\":\"127.0.0.1\"}'",
  "cav remote session start devbox --path /workspace",
  "cav remote session status --all",
  "cav remote port forward <sessionId> 3000 127.0.0.1 3000 tcp",
  "cav remote debug adapters",
  "cav reliability status",
  "cav reliability snapshots",
  "cav reliability replay ai",
  "cav reliability budget set --availability 99.95 --error-budget 0.05 --burn-alert 60 --p95 900",
  "cav reliability crash list",
  "cav ui palette list",
  "cav ui palette run cav run dev",
  "cav ui shortcut list",
  "cav ui view list",
  "cav ui layout list",
  'cav search rg "TODO" --path /cavcode/src --max 200',
  'cav search replace-preview "oldFn" "newFn" --path /cavcode/src',
  "cav search semantic auth guard",
  "cav index refresh",
  "cav index symbols",
  "cav index refs App",
  "cav index calls render",
  "cav index graph",
  "cav index xref App",
  "cav index semantic auth guard",
  "cav template list",
  "cav template init website starter",
  'cav loop plan "Fix top diagnostics"',
  'cav loop replace /cavcode/src/main.js "foo" "bar"',
  "cav loop checkpoint create pre-refactor",
  "cav loop checkpoint list 20",
  "cav loop checkpoint restore <checkpointId>",
  'cav loop run "reduce workspace errors" --cycles 3 --rollback',
  "cav jump /codebase/app/page.tsx:2",
  "cav live",
  "cav go live",
  "cav ai explain-current-diagnostic",
  "cav ai suggest-fix",
  "cav ai improve-seo",
  "cav ai create-fix-plan",
  "cav ai summarize-artifact",

  "cav tab inspector",
  "cav tab events",
  "cav tab studio",
  "cav tab checklist",
  "cav tab settings",
  "cav tab explorer",
  "cav tab search",
  "cav tab scm",
  "cav tab live",
  "cav tab run",

  "cav open codebase",
  "cav open -- /codebase/styles/global.css",
  "cav run -- /codebase/app/page.tsx",

  "cav codebase pwd",
  "cav codebase ls",
  "cav codebase tree",
  "cav codebase cd /codebase",
  "cav codebase mkdir /codebase/snippets",
  "cav codebase touch /codebase/snippets/example.ts",
  'cav codebase write /codebase/snippets/example.ts "export {}"',
  "cav codebase cat /codebase/README.md",
  "cav codebase rm /codebase/snippets/example.ts",
  "cav codebase open /codebase/styles/global.css",

  "cav workspace ls",
  "cav workspace tree",
  "cav workspace open /app/page.tsx",
  'cav workspace write /app/page.tsx "export default function Page(){}"',

  "cav studio run",
  "cav studio clear",
  "cav studio reset",

  "cav events tail 10",
  "cav events clear",
  "cav events filter bad",

  "cav export all",
];

export function buildHelp(namespace?: string) {
  const ns = String(namespace || "").trim().toLowerCase();
  if (!ns) {
    return [
      "CavBot Terminal",
      "",
      "Usage:",
      "  cav <namespace> <action> [target] [flags]",
      "",
      "Start here:",
      "  cav guide",
      "",
      "Quick list:",
      "  cav commands",
    ];
  }

  if (ns === "all") return buildGuideText();

  if (ns === "studio") {
    return [
      "cav studio",
      "",
      "Commands:",
      "  cav studio run",
      "  cav studio clear",
      "  cav studio reset",
    ];
  }

  if (ns === "events") {
    return [
      "cav events",
      "",
      "Commands:",
      "  cav events tail [n]",
      "  cav events clear",
      "  cav events filter <good|watch|bad>",
    ];
  }

  if (ns === "tab") {
    return [
      "cav tab",
      "",
      "Commands:",
      "  cav tab inspector|events|studio|checklist|settings",
      "  cav tab explorer|search|live|run|settings",
    ];
  }

  if (ns === "ai") {
    return [
      "cav ai",
      "",
      "Commands:",
      "  cav ai explain-current-diagnostic",
      "  cav ai suggest-fix",
      "  cav ai improve-seo",
      "  cav ai create-fix-plan",
      "  cav ai summarize-artifact",
      "",
      "Notes:",
      "  AI actions route through server-authoritative /api/ai/* endpoints.",
      "  Provide project/workspace context for scoped execution.",
    ];
  }

  if (ns === "codebase") {
    return [
      "cav codebase",
      "",
      "Commands:",
      "  cav codebase pwd",
      "  cav codebase ls [path]",
      "  cav codebase tree [path]",
      "  cav codebase cd <path>",
      "  cav codebase mkdir <path>",
      "  cav codebase touch <path>",
      "  cav codebase cat <path>",
      '  cav codebase write <path> "<text>"',
      "  cav codebase rm <path>",
      "  cav codebase open <path>",
      "",
      "Fast open/run:",
      "  cav open -- <path>",
      "  cav run -- <path>",
    ];
  }

  if (ns === "workspace") {
    return [
      "cav workspace",
      "",
      "Commands:",
      "  cav workspace ls",
      "  cav workspace tree",
      "  cav workspace open <path>",
      '  cav workspace write <path> "<text>"',
    ];
  }

  if (ns === "diag") {
    return [
      "cav diag",
      "",
      "Commands:",
      "  cav diag",
      "  cav diag errors",
      '  cav diag find "<text>" [--path <dir>]',
    ];
  }

  if (ns === "remote") {
    return [
      "cav remote",
      "",
      "Commands:",
      "  cav remote provider list|upsert|remove",
      "  cav remote session start|status|logs|stop|restart|list",
      "  cav remote port list|forward|close",
      "  cav remote debug adapters",
    ];
  }

  if (ns === "reliability") {
    return [
      "cav reliability",
      "",
      "Commands:",
      "  cav reliability status",
      "  cav reliability snapshots [kind] [limit]",
      "  cav reliability restore runtime|task|debug|project-service|extension-host|remote|ai-checkpoint <target>",
      "  cav reliability replay [category] [sessionId] [afterSeq] [limit]",
      "  cav reliability budget status|set",
      "  cav reliability crash list|record|resolve",
    ];
  }

  if (ns === "ui") {
    return [
      "cav ui",
      "",
      "Commands:",
      "  cav ui palette list|run <cav ...>",
      "  cav ui shortcut list|set|reset",
      "  cav ui view list|show|hide|toggle <viewId>",
      "  cav ui layout list|save|load|apply-default",
    ];
  }

  if (ns === "loop") {
    return [
      "cav loop",
      "",
      "Commands:",
      "  cav loop plan <goal>",
      "  cav loop replace <file> <search> <replace>",
      "  cav loop checkpoint create|list|restore",
      "  cav loop run <goal> [--cycles <n>] [--test-task <label>] [--rollback]",
    ];
  }

  return [`No help available for namespace: "${namespace}"`];
}

export function buildCommandsText() {
  return [
    "CavBot Commands",
    "",
    "Core",
    "  cav guide",
    "  cav commands",
    "  cav help [namespace]",
    "  cav status",
    "  cav ctx",
    "  cav whoami",
    "  cav clear",
    "  cav sync",
    "",
    "Diagnostics",
    "  cav diag",
    "  cav diag errors",
    '  cav diag find "<text>" [--path <dir>]',
    "  cav events [afterSeq] [limit]",
    "  cav project service start|status|refresh|diagnostics|logs|stop|restart",
    "  cav task list|run|status|logs|stop|restart|history",
    "  cav extension marketplace|install|update|uninstall|enable|disable|list|host|activate|api",
    "  cav collab session|presence|op|share",
    "  cav security status|profile|secrets|scan|audit",
    "  cav remote provider|session|port|debug",
    "  cav reliability status|snapshots|restore|replay|budget|crash",
    "  cav ui palette|shortcut|view|layout",
    "  cav search semantic|rg|replace-preview ...",
    "  cav git status|diff|stage|unstage|commit|log|branch|checkout|remote|fetch|pull|push|sync|ahead-behind|rebase|cherry-pick|conflicts",
    "  cav debug start|config|attach|select|stop|status|logs|continue|pause|next|step|out|threads|frame|break|watch",
    "  cav index refresh|symbols|refs|calls|graph|xref|semantic",
    "  cav template list|init <website|software|game> [folder]",
    "  cav loop plan|replace|checkpoint|run ...",
    "  cav jump <file>:<line>[:<col>]",
    "",
    "Navigation",
    "  cav tab <name>",
    "  cav open codebase",
    "  cav live",
    "",
    "AI",
    "  cav ai explain-current-diagnostic",
    "  cav ai suggest-fix",
    "  cav ai improve-seo",
    "  cav ai create-fix-plan",
    "  cav ai summarize-artifact",
    "",
    "Codebase",
    "  cav codebase pwd",
    "  cav codebase ls [path]",
    "  cav codebase tree [path]",
    "  cav codebase cd <path>",
    "  cav codebase mkdir <path>",
    "  cav codebase touch <path>",
    "  cav codebase cat <path>",
    '  cav codebase write <path> "<text>"',
    "  cav codebase rm <path>",
    "  cav codebase open <path>",
    "",
    "Workspace",
    "  cav workspace ls",
    "  cav workspace tree",
    "  cav workspace open <path>",
    '  cav workspace write <path> "<text>"',
    "",
    "Studio",
    "  cav studio run",
    "  cav studio clear",
    "  cav studio reset",
    "",
    "Events",
    "  cav events tail [n]",
    "  cav events clear",
    "  cav events filter <good|watch|bad>",
    "",
    "Export",
    "  cav export all",
  ];
}

export function buildGuideText() {
  return [
    "CavBot Terminal — Guide",
    "",
    "Recommended workflows",
    "  1) cav diag",
    "  2) cav open codebase",
    "  3) cav codebase tree",
    "  4) cav jump /codebase/app/page.tsx:2",
    "  5) cav live",
    "",
    "Core",
    "  cav guide",
    "    Prints the full command guide.",
    "  cav commands",
    "    Compact list of commands.",
    "  cav help [namespace]",
    "    Focused help for a namespace (codebase, studio, events, diag).",
    "  cav status",
    "    Operator / project / origin status.",
    "  cav ctx",
    "    Active tab + file context.",
    "  cav whoami",
    "    Identity + surface summary.",
    "  cav clear",
    "    Clears terminal output.",
    "  cav sync",
    "    Force reload from local storage.",
    "",
    "Diagnostics",
    "  cav diag",
    "    Health snapshot of storage + markers.",
    "  cav diag errors",
    "    Lists Monaco errors (CavCode only).",
    '  cav diag find "<text>" [--path <dir>]',
    "    Searches Codebase file contents.",
    "  cav jump <file>:<line>[:<col>]",
    "    Quick open + jump.",
    "",
    "Navigation",
    "  cav tab <name>",
    "    Switches UI tab for current surface.",
    "  cav open codebase",
    "    Opens the Codebase editor.",
    "  cav live / cav go live",
    "    Open the Live viewer.",
    "",
    "AI command plane",
    "  cav ai explain-current-diagnostic",
    "  cav ai suggest-fix",
    "  cav ai improve-seo",
    "  cav ai create-fix-plan",
    "  cav ai summarize-artifact",
    "    Server-authoritative AI action hooks for CavCode/CavCloud/CavSafe/CavPad/Console.",
    "",
    "Codebase filesystem",
    "  cav codebase pwd",
    "  cav codebase ls [path]",
    "  cav codebase tree [path]",
    "  cav codebase cd <path>",
    "  cav codebase mkdir <path>",
    "  cav codebase touch <path>",
    "  cav codebase cat <path>",
    '  cav codebase write <path> "<text>"',
    "  cav codebase rm <path>",
    "  cav codebase open <path>",
    "",
    "Workspace (CavCode)",
    "  cav workspace ls",
    "  cav workspace tree",
    "  cav workspace open <path>",
    '  cav workspace write <path> "<text>"',
    "",
    "Studio",
    "  cav studio run",
    "  cav studio clear",
    "  cav studio reset",
    "",
    "Events",
    "  cav events tail [n]",
    "  cav events clear",
    "  cav events filter <good|watch|bad>",
    "",
    "Export",
    "  cav export all",
  ];
}

function pageTabs(page: CavContext["pageKind"]) {
  return page === "cavtools" ? CAVTOOLS_TABS : CAVCODE_TABS;
}

function parseDiagFind(tokens: string[]) {
  const joined = tokens.slice(2).join(" ").trim();
  if (!joined) return { query: "", path: "" };
  const pathIdx = tokens.findIndex((t) => t === "--path");
  const path = pathIdx !== -1 ? tokens[pathIdx + 1] || "" : "";

  const raw = pathIdx !== -1 ? tokens.slice(2, pathIdx).join(" ") : joined;
  const trimmed = raw.trim();
  if (!trimmed) return { query: "", path };

  const m =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1)
      : trimmed;
  return { query: m, path };
}

function parseJumpTarget(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const match = s.match(/:(\d+)(?::(\d+))?$/);
  if (!match) return { path: s };
  const line = Number(match[1] || 1);
  const col = Number(match[2] || 1);
  const path = s.slice(0, s.length - match[0].length);
  return { path, line, col };
}

function formatMarkers(markers: CavMarker[], cap = 24) {
  const out: string[] = [];
  const slice = markers.slice(0, cap);
  for (const m of slice) {
    out.push(`${m.severity.toUpperCase()} ${m.file}:${m.line}:${m.col} — ${m.message}`);
  }
  if (markers.length > cap) out.push(`…and ${markers.length - cap} more`);
  return out;
}

function buildDiag(ctx: CavContext): string[] {
  const fs = ctx.codebaseGet();
  const files = Object.keys(fs.nodes)
    .map((k) => fs.nodes[k])
    .filter(Boolean)
    .filter((n) => n.type === "file" && n.path.startsWith("/codebase/"));

  const markerList = ctx.getMarkers?.() || [];
  const errors = markerList.filter((m) => m.severity === "error").length;
  const warnings = markerList.filter((m) => m.severity === "warn").length;
  const eventCounts = ctx.getEventCounts?.();

  const sync = ctx.getSyncStatus?.();

  return [
    "CavBot Diagnostics",
    "",
    `Codebase files: ${files.length}`,
    `cwd: ${fs.cwd || "/codebase"}`,
    `active file: ${ctx.activeFilePath || "—"}`,
    `markers: ${errors} error(s), ${warnings} warn(s)`,
    `runtime: ${eventCounts ? `${eventCounts.errors} err, ${eventCounts.warnings} warn` : "—"}`,
    `sync: ${sync?.lastSyncTs ? new Date(sync.lastSyncTs).toLocaleTimeString() : "—"}`,
    `storage listener: ${sync?.storageActive ? "active" : "inactive"}`,
    `storage key: ${CODEBASE_FS_KEY}`,
  ];
}

function diagFind(ctx: CavContext, query: string, pathFilter?: string) {
  const q = String(query || "").trim();
  if (!q) {
    return { tone: "watch" as CavTone, lines: ['Missing search text. Try: cav diag find "codebase"'] };
  }

  const fs = ctx.codebaseGet();
  const matches: string[] = [];
  const cap = 40;
  const lower = q.toLowerCase();

  const dirFilter = pathFilter ? toCodebaseAbs(pathFilter, fs.cwd) : "";

  for (const k of Object.keys(fs.nodes)) {
    const n = fs.nodes[k];
    if (!n || n.type !== "file") continue;
    if (!n.path.startsWith("/codebase/")) continue;
    if (dirFilter && !n.path.startsWith(dirFilter)) continue;
    const content = String(n.content || "");
    if (!content) continue;
    if (!content.toLowerCase().includes(lower)) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.toLowerCase().includes(lower)) continue;
      matches.push(`${n.path}:${i + 1}  ${clamp(line, 160)}`);
      if (matches.length >= cap) break;
    }
    if (matches.length >= cap) break;
  }

  if (!matches.length) {
    return { tone: "watch" as CavTone, lines: ["No matches found."] };
  }
  return {
    tone: "good" as CavTone,
    lines: ["Matches:", "", ...matches],
  };
}

function workspaceOpsAvailable(ctx: CavContext) {
  return Boolean(ctx.workspaceGet && ctx.workspaceUpdate);
}

function workspaceFindByPath(root: WorkspaceNode, target: string): WorkspaceNode | null {
  let norm = String(target || "").trim().replace(/\\/g, "/");
  if (!norm) return null;
  if (!norm.startsWith("/")) norm = `/${norm}`;
  let hit: WorkspaceNode | null = null;
  const walk = (node: WorkspaceNode) => {
    if (!node || hit) return;
    if (String(node.path || "") === norm) {
      hit = node;
      return;
    }
    if (node.kind === "folder" && Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  };
  walk(root);
  return hit;
}

function workspaceTree(root: WorkspaceNode) {
  const out: string[] = [];
  const walk = (node: WorkspaceNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const label = node.kind === "folder" ? "📁" : "📄";
    out.push(`${pad}${label} ${node.name}`);
    if (node.kind === "folder" && Array.isArray(node.children)) {
      for (const c of node.children) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function workspaceLs(root: WorkspaceNode, path?: string) {
  const target = path ? workspaceFindByPath(root, path) : root;
  if (!target) return { ok: false, lines: ["Path not found."] };
  if (target.kind === "file") return { ok: true, lines: [target.path] };
  const names = (target.children || []).map((c) => (c.kind === "folder" ? `${c.name}/` : c.name));
  return { ok: true, lines: [names.join("  ") || "(empty)"] };
}

function workspaceWrite(root: WorkspaceNode, path: string, text: string) {
  const target = workspaceFindByPath(root, path);
  if (!target || target.kind !== "file") return { ok: false, message: "File not found." };
  target.content = String(text ?? "");
  return { ok: true };
}

export function runCavCommand(ctx: CavContext, inputRaw: string): CavResult {
  const input = clamp(inputRaw, 260);
  const tokens = tokenize(input);

  if (!tokens.length) {
    return { tone: "watch", lines: ["(no command)"] };
  }

  if (tokens[0].toLowerCase() !== "cav") {
    return {
      tone: "bad",
      lines: [
        `Command rejected: CavBot Terminal accepts "cav" commands only.`,
        "",
        `Try: cav guide`,
      ],
    };
  }

  let sub = (tokens[1] || "").toLowerCase();
  const arg2 = tokens[2] || "";

  if (sub === "t") sub = "tab";
  if (sub === "s") sub = "studio";
  if (sub === "e") sub = "events";
  if (sub === "fs") sub = "codebase";

  if (!sub) return { tone: "watch", lines: buildHelp() };

  if (sub === "help" || sub === "-h" || sub === "--help") {
    return { tone: "good", lines: buildHelp(arg2) };
  }

  if (sub === "guide") return { tone: "good", lines: buildGuideText() };
  if (sub === "commands") return { tone: "good", lines: buildCommandsText() };

  if (sub === "run" && (arg2 || "").toLowerCase() === "guide") {
    return { tone: "good", lines: buildGuideText() };
  }

  if (sub === "status") {
    return {
      tone: "good",
      lines: [
        "CavBot Status",
        "",
        `operator: ${ctx.operator || "Operator"}`,
        `project: ${ctx.projectId || "—"}`,
        `origin: ${ctx.siteOrigin || "—"}`,
        `surface: ${ctx.pageKind}`,
      ],
    };
  }

  if (sub === "ctx" || sub === "context") {
    return {
      tone: "good",
      lines: [
        "CavBot Context",
        "",
        `active file: ${ctx.activeFilePath || "—"}`,
        `cwd: ${ctx.codebaseGet().cwd}`,
      ],
    };
  }

  if (sub === "whoami") {
    return {
      tone: "good",
      lines: [
        `${ctx.operator || "Operator"}@cavbot`,
        `surface: ${ctx.pageKind}`,
        `project: ${ctx.projectId || "—"}`,
        `origin: ${ctx.siteOrigin || "—"}`,
      ],
    };
  }

  if (sub === "clear") {
    ctx.clearOutput();
    return { tone: "good", lines: ["Terminal cleared."] };
  }

  if (sub === "ai") {
    const action = (tokens[2] || "").toLowerCase();
    if (!action || action === "help") {
      return { tone: "good", lines: buildHelp("ai") };
    }

    if (action === "explain-current-diagnostic") {
      return {
        tone: "good",
        lines: [
          "AI command hook wired: explain-current-diagnostic.",
          "Use /api/ai/cavcode/assist with action=explain_error and scoped diagnostics input.",
        ],
      };
    }

    if (action === "suggest-fix" || action === "create-fix-plan") {
      return {
        tone: "good",
        lines: [
          "AI fix hooks wired.",
          "Use /api/ai/cavcode/assist (suggest_fix/refactor_safely) for LLM proposals.",
          "Use /api/cavai/fixes for deterministic evidence-linked fix plans.",
        ],
      };
    }

    if (action === "improve-seo") {
      return {
        tone: "good",
        lines: [
          "SEO assist hook wired.",
          "Use /api/ai/cavcode/assist with action=improve_seo.",
        ],
      };
    }

    if (action === "summarize-artifact") {
      return {
        tone: "good",
        lines: [
          "CavCloud assist hook wired.",
          "Use /api/ai/cavcloud/assist with action=explain_artifact.",
        ],
      };
    }

    return { tone: "watch", lines: buildHelp("ai") };
  }

  if (sub === "sync") {
    ctx.forceSync();
    return { tone: "good", lines: ["Synced from local storage."] };
  }

  if (sub === "diag") {
    const action = (tokens[2] || "").toLowerCase();
    if (!action) return { tone: "good", lines: buildDiag(ctx) };

    if (action === "errors") {
      const markers = ctx.getMarkers?.();
      if (!markers) {
        return { tone: "watch", lines: ["Diagnostics unavailable here. Run: cav diag errors (in /cavcode)."] };
      }
      if (!markers.length) return { tone: "good", lines: ["No active errors or warnings."] };
      return { tone: "bad", lines: formatMarkers(markers) };
    }

    if (action === "find") {
      const { query, path } = parseDiagFind(tokens);
      return diagFind(ctx, query, path);
    }

    return { tone: "watch", lines: buildHelp("diag") };
  }

  if (sub === "jump") {
    const target = tokens.slice(2).join(" ").trim();
    const parsed = parseJumpTarget(target);
    if (!parsed || !parsed.path) {
      return { tone: "watch", lines: ['Missing target. Try: cav jump /codebase/app/page.tsx:2'] };
    }
    const line = parsed.line || 1;
    const col = parsed.col || 1;

    if (isCodebasePath(parsed.path) || parsed.path.startsWith("/codebase")) {
      const abs = toCodebaseAbs(parsed.path, ctx.codebaseGet().cwd);
      ctx.openCodebaseFile(abs, { line, col, focus: true });
      return { tone: "good", lines: [`Opened: ${abs}:${line}:${col}`] };
    }

    if (!ctx.openWorkspaceFile) {
      return { tone: "watch", lines: ["Workspace not available in this surface."] };
    }
    ctx.openWorkspaceFile(parsed.path, { line, col, focus: true });
    return { tone: "good", lines: [`Opened: ${parsed.path}:${line}:${col}`] };
  }

  if (sub === "tab") {
    const target = (tokens[2] || "").toLowerCase();
    if (!target) {
      return { tone: "watch", lines: ["Missing tab name. Try: cav tab explorer"] };
    }
    const tabs = pageTabs(ctx.pageKind);
    const isValid =
      ctx.pageKind === "cavtools"
        ? CAVTOOLS_TABS.includes(target as (typeof CAVTOOLS_TABS)[number])
        : CAVCODE_TABS.includes(target as (typeof CAVCODE_TABS)[number]);
    if (!isValid) {
      return {
        tone: "watch",
        lines: [`Unknown tab "${target}". Valid: ${tabs.join(", ")}`],
      };
    }
    ctx.setTab(String(target));
    return { tone: "good", lines: [`Switched tab → ${target}`] };
  }

  if (sub === "open") {
    if (tokens[2] === "--") {
      const p = tokens.slice(3).join(" ").trim();
      if (!p) return { tone: "watch", lines: ["Missing path. Try: cav open -- /codebase/app/page.tsx"] };
      const fs = ctx.codebaseGet();
      const abs = toCodebaseAbs(p, fs.cwd);
      const node = fs.nodes[abs];
      if (!node || node.type !== "file") return { tone: "bad", lines: [`Codebase file not found: ${abs}`] };
      ctx.openCodebaseFile(abs, { focus: true });
      return { tone: "good", lines: [`Opened: ${abs}`] };
    }

    if ((tokens[2] || "").toLowerCase() === "codebase") {
      if (ctx.pageKind === "cavcode") {
        return { tone: "good", lines: ["Already in Codebase."] };
      }
      ctx.navigate("/cavcode", ctx.getQSBasePairs());
      return { tone: "good", lines: ["Opening Codebase…"] };
    }

    return { tone: "watch", lines: ['Missing target. Try: cav open codebase'] };
  }

  if (sub === "run") {
    if (tokens[2] === "--") {
      const p = tokens.slice(3).join(" ").trim();
      if (!p) return { tone: "watch", lines: ["Missing path. Try: cav run -- /codebase/app/page.tsx"] };
      const fs = ctx.codebaseGet();
      const abs = toCodebaseAbs(p, fs.cwd);
      const node = fs.nodes[abs];
      if (!node || node.type !== "file") return { tone: "bad", lines: [`Codebase file not found: ${abs}`] };
      ctx.openCodebaseFile(abs, { focus: true });
      return { tone: "good", lines: [`Opened: ${abs}`] };
    }
    return { tone: "watch", lines: ["Unknown run action. Try: cav run -- /codebase/app/page.tsx"] };
  }

  if (sub === "live" || (sub === "go" && (tokens[2] || "").toLowerCase() === "live")) {
    const url = ctx.liveUrl || "/live";
    if (ctx.openLive) ctx.openLive(url, ctx.getQSBasePairs());
    else ctx.navigate(url, ctx.getQSBasePairs());
    return { tone: "good", lines: ["Opening Live Viewer…"] };
  }

  if (sub === "studio") {
    const action = (tokens[2] || "").toLowerCase();
    if (action === "run") {
      if (!ctx.studioRun) {
        return { tone: "watch", lines: ["Studio runner unavailable in this surface."] };
      }
      ctx.studioRun();
      return { tone: "watch", lines: ["Studio run started."] };
    }
    if (action === "clear") {
      if (!ctx.studioClear) {
        return { tone: "watch", lines: ["Studio clear unavailable in this surface."] };
      }
      ctx.studioClear();
      return { tone: "good", lines: ["Studio cleared."] };
    }
    if (action === "reset") {
      if (!ctx.studioReset) {
        return { tone: "watch", lines: ["Studio reset unavailable in this surface."] };
      }
      ctx.studioReset();
      return { tone: "good", lines: ["Studio reset."] };
    }
    return { tone: "watch", lines: buildHelp("studio") };
  }

  if (sub === "events") {
    const action = (tokens[2] || "").toLowerCase();
    if (!ctx.eventsTail) {
      return { tone: "watch", lines: ["Events are unavailable in this surface."] };
    }
    if (!action || action === "tail") {
      const n = Number(tokens[3] || 10);
      const lines = ctx.eventsTail(Math.max(1, Math.min(30, n)));
      const tone: CavTone = lines.length && lines[0].toLowerCase().startsWith("no events") ? "watch" : "good";
      return { tone, lines };
    }
    if (action === "clear") {
      ctx.eventsClear?.();
      return { tone: "good", lines: ["Events cleared."] };
    }
    if (action === "filter") {
      const t = (tokens[3] || "").toLowerCase() as CavTone;
      if (t !== "good" && t !== "watch" && t !== "bad") {
        return { tone: "bad", lines: ['Invalid tone. Use: good | watch | bad'] };
      }
      const lines = ctx.eventsFilter?.(t) || [];
      const tone: CavTone = lines.length && lines[0].toLowerCase().includes("no events") ? "watch" : "good";
      return { tone, lines };
    }
    return { tone: "watch", lines: buildHelp("events") };
  }

  if (sub === "export") {
    const action = (tokens[2] || "").toLowerCase();
    if (!action || action === "all") {
      const payload =
        ctx.getExportPayload?.() || {
          operator: ctx.operator,
          projectId: ctx.projectId || null,
          siteOrigin: ctx.siteOrigin || null,
          activeFile: ctx.activeFilePath || null,
          cwd: ctx.codebaseGet().cwd,
          ts: now(),
        };
      return { tone: "good", lines: ["Export ready (copy/paste)", "", JSON.stringify(payload, null, 2)] };
    }
    return { tone: "watch", lines: ["Unknown export action. Try: cav export all"] };
  }

  if (sub === "codebase") {
    const fs = ctx.codebaseGet();
    const action = (tokens[2] || "").toLowerCase();
    const arg = tokens.slice(3).join(" ").trim();

    if (!action || action === "help") return { tone: "good", lines: buildHelp("codebase") };

    if (action === "pwd") return { tone: "good", lines: [fs.cwd] };

    if (action === "ls") {
      const target = toCodebaseAbs(arg || "", fs.cwd) || fs.cwd;
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`Path not found: ${target}`] };
      if (node.type !== "dir") return { tone: "bad", lines: [`Not a directory: ${target}`] };
      const kids = listChildren(fs, target);
      if (!kids.length) return { tone: "watch", lines: ["(empty)"] };
      const lines = kids.map((k) => `  ${k.type === "dir" ? "dir " : "file"}  ${k.name}`);
      return { tone: "good", lines: [`Listing: ${target}`, "", ...lines] };
    }

    if (action === "tree") {
      const target = toCodebaseAbs(arg || "", fs.cwd) || fs.cwd;
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`Path not found: ${target}`] };
      if (node.type !== "dir") return { tone: "bad", lines: [`Not a directory: ${target}`] };
      const lines: string[] = [];
      const walk = (dirAbs: string, depth: number) => {
        const kids = listChildren(fs, dirAbs);
        for (let i = 0; i < kids.length; i++) {
          const k = kids[i];
          const elbow = i === kids.length - 1 ? "└─" : "├─";
          const pad = "  ".repeat(depth);
          lines.push(`${pad}${elbow} ${k.type === "dir" ? "📁" : "📄"} ${k.name}`);
          if (k.type === "dir") walk(k.path, depth + 1);
        }
      };
      lines.push(`${target === "/" ? "/" : target.replace(/\/+$/, "")}/`);
      walk(target, 0);
      return { tone: "good", lines };
    }

    if (action === "cd") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      if (!target) return { tone: "watch", lines: ["Missing path. Try: cav codebase cd /codebase"] };
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`Directory not found: ${target}`] };
      if (node.type !== "dir") return { tone: "bad", lines: [`Not a directory: ${target}`] };
      ctx.codebaseUpdate((prev) => ({ ...prev, cwd: target }));
      return { tone: "good", lines: [`cwd → ${target}`] };
    }

    if (action === "mkdir") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      if (!target || target === "/") {
        return { tone: "watch", lines: ["Missing folder path. Try: cav codebase mkdir /codebase/snippets"] };
      }
      if (!target.startsWith("/codebase")) {
        return { tone: "bad", lines: [`Refusing to create outside /codebase: ${target}`] };
      }
      const parts = target.split("/").filter(Boolean);
      let cur = "/";
      const created: string[] = [];
      try {
        ctx.codebaseUpdate((prev) => {
          const copy = { ...prev.nodes };
          for (const p of parts) {
            const next = cur === "/" ? `/${p}` : `${cur}/${p}`;
            const existing = copy[next];
            if (existing && existing.type !== "dir") {
              throw new Error(`Cannot create folder. File exists at: ${next}`);
            }
            if (!existing) {
              const t = now();
              copy[next] = { type: "dir", name: p, path: next, createdAt: t, updatedAt: t };
              created.push(next);
            }
            cur = next;
          }
          return { ...prev, nodes: copy };
        });
      } catch (e: unknown) {
        const err = e as { message?: string } | null;
        return { tone: "bad", lines: [String(err?.message || "mkdir failed")] };
      }
      return created.length
        ? { tone: "good", lines: ["Created:", ...created.map((x) => `  ${x}`)] }
        : { tone: "watch", lines: [`Folder already exists: ${target}`] };
    }

    if (action === "touch") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      if (!target || target === "/") {
        return { tone: "watch", lines: ["Missing file path. Try: cav codebase touch /codebase/snippets/hello.ts"] };
      }
      if (!target.startsWith("/codebase")) {
        return { tone: "bad", lines: [`Refusing to create outside /codebase: ${target}`] };
      }
      const dir = parentDir(target);
      const dirNode = fs.nodes[dir];
      if (!dirNode || dirNode.type !== "dir") return { tone: "bad", lines: [`Parent folder not found: ${dir}`] };

      const existing = fs.nodes[target];
      const t = now();
      try {
        ctx.codebaseUpdate((prev) => {
          const copy = { ...prev.nodes };
          if (existing) {
            if (existing.type !== "file") throw new Error(`Cannot touch. Folder exists at: ${target}`);
            copy[target] = { ...existing, updatedAt: t };
            return { ...prev, nodes: copy };
          }
          const name = baseName(target);
          copy[target] = { type: "file", name, path: target, createdAt: t, updatedAt: t, content: "" };
          return { ...prev, nodes: copy };
        });
      } catch (e: unknown) {
        const err = e as { message?: string } | null;
        return { tone: "bad", lines: [String(err?.message || "touch failed")] };
      }
      return { tone: "good", lines: [existing ? `Updated timestamp: ${target}` : `Created file: ${target}`] };
    }

    if (action === "cat") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`File not found: ${target}`] };
      if (node.type !== "file") return { tone: "bad", lines: [`Not a file: ${target}`] };
      return { tone: "good", lines: [`File: ${target}`, "", String(node.content || "")] };
    }

    if (action === "write") {
      const target = toCodebaseAbs(tokens[3] || "", fs.cwd);
      const rest = tokens.slice(4).join(" ").trim();
      const textContent =
        (rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))
          ? rest.slice(1, -1)
          : rest;
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`File not found: ${target}`] };
      if (node.type !== "file") return { tone: "bad", lines: [`Not a file: ${target}`] };
      ctx.codebaseUpdate((prev) => {
        const t = now();
        const copy = { ...prev.nodes };
        copy[target] = { ...node, content: String(textContent ?? ""), updatedAt: t };
        return { ...prev, nodes: copy };
      });
      return { tone: "good", lines: [`Wrote: ${target}`] };
    }

    if (action === "rm") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      if (!target || target === "/") return { tone: "bad", lines: ["Refusing to delete root."] };
      if (!target.startsWith("/codebase")) return { tone: "bad", lines: [`Refusing to delete outside /codebase: ${target}`] };
      const node = fs.nodes[target];
      if (!node) return { tone: "bad", lines: [`Path not found: ${target}`] };
      if (node.type === "dir") {
        const kids = listChildren(fs, target);
        if (kids.length) return { tone: "bad", lines: [`Folder not empty: ${target}`] };
      }
      ctx.codebaseUpdate((prev) => {
        const copy = { ...prev.nodes };
        delete copy[target];
        return { ...prev, nodes: copy };
      });
      return { tone: "good", lines: [`Deleted: ${target}`] };
    }

    if (action === "open") {
      const target = toCodebaseAbs(arg || "", fs.cwd);
      const node = fs.nodes[target];
      if (!node || node.type !== "file") return { tone: "bad", lines: [`Codebase file not found: ${target}`] };
      ctx.openCodebaseFile(target, { focus: true });
      return { tone: "good", lines: [`Opened: ${displayRelFromCodebase(target)}`] };
    }

    return { tone: "watch", lines: buildHelp("codebase") };
  }

  if (sub === "workspace") {
    if (!workspaceOpsAvailable(ctx)) {
      return { tone: "watch", lines: ["Workspace not available in this surface."] };
    }
    const root = ctx.workspaceGet?.();
    if (!root) return { tone: "watch", lines: ["Workspace not available."] };
    const action = (tokens[2] || "").toLowerCase();
    const arg = tokens.slice(3).join(" ").trim();

    if (!action || action === "ls") {
      const res = workspaceLs(root, arg || "/");
      return { tone: res.ok ? "good" : "bad", lines: res.lines };
    }
    if (action === "tree") {
      return { tone: "good", lines: workspaceTree(root) };
    }
    if (action === "open") {
      if (!ctx.openWorkspaceFile) return { tone: "watch", lines: ["Workspace open is unavailable here."] };
      if (!arg) return { tone: "watch", lines: ["Missing path. Try: cav workspace open /app/page.tsx"] };
      ctx.openWorkspaceFile(arg, { focus: true });
      return { tone: "good", lines: [`Opened: ${arg}`] };
    }
    if (action === "write") {
      const path = tokens[3] || "";
      const rest = tokens.slice(4).join(" ").trim();
      const textContent =
        (rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))
          ? rest.slice(1, -1)
          : rest;
      if (!path) return { tone: "watch", lines: ["Missing path. Try: cav workspace write /app/page.tsx \"...\""] };
      const cloned = JSON.parse(JSON.stringify(root));
      const writeRes = workspaceWrite(cloned, path, textContent);
      if (!writeRes.ok) return { tone: "bad", lines: [writeRes.message || "Write failed."] };
      ctx.workspaceSet?.(cloned);
      return { tone: "good", lines: [`Wrote: ${path}`] };
    }
    return { tone: "watch", lines: buildHelp("workspace") };
  }

  return {
    tone: "bad",
    lines: [
      `Unknown command: "${input}"`,
      "",
      "Try:",
      "  cav guide",
      "  cav commands",
    ],
  };
}
