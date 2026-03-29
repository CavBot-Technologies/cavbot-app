export type FsNodeType = "dir" | "file";

export type FsNode = {
  type: FsNodeType;
  name: string;
  path: string; // absolute (/codebase/...)
  createdAt: number;
  updatedAt: number;
  content?: string; // file only
};

export type FsState = {
  cwd: string; // absolute like "/codebase"
  nodes: Record<string, FsNode>; // key = absolute path
};

export const CODEBASE_FS_KEY = "cb_codebase_fs_v1";

export function now() {
  return Date.now();
}

export function safeJsonParse(s: string) {
  try {
    const v = JSON.parse(s);
    return { ok: true as const, value: v };
  } catch (e: unknown) {
    const err = e as { message?: string } | null;
    return { ok: false as const, error: String(err?.message || "Invalid JSON") };
  }
}

export function normAbsPath(input: string, cwd: string) {
  const raw = String(input || "").trim().replace(/\\/g, "/");
  if (!raw) return "";

  const isAbs = raw.startsWith("/");
  const joined = isAbs ? raw : `${cwd.replace(/\/+$/, "")}/${raw}`;
  const parts = joined.split("/").filter(Boolean);

  const stack: string[] = [];
  for (const p of parts) {
    if (p === ".") continue;
    if (p === "..") {
      stack.pop();
      continue;
    }
    stack.push(p);
  }
  return "/" + stack.join("/");
}

export function parentDir(pathAbs: string) {
  const s = String(pathAbs || "").trim();
  if (!s || s === "/") return "/";
  const parts = s.split("/").filter(Boolean);
  parts.pop();
  return "/" + parts.join("/");
}

export function baseName(pathAbs: string) {
  const parts = String(pathAbs || "")
    .trim()
    .split("/")
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

export function isRoot(pathAbs: string) {
  return String(pathAbs || "").trim() === "/";
}

export function initFsState(): FsState {
  const t = now();

  const root: FsNode = {
    type: "dir",
    name: "/",
    path: "/",
    createdAt: t,
    updatedAt: t,
  };

  const seed: FsNode[] = [
    { type: "dir", name: "cavcode", path: "/codebase", createdAt: t, updatedAt: t },
    { type: "dir", name: "app", path: "/codebase/app", createdAt: t, updatedAt: t },
    { type: "dir", name: "styles", path: "/codebase/styles", createdAt: t, updatedAt: t },
    { type: "dir", name: "components", path: "/codebase/components", createdAt: t, updatedAt: t },
    {
      type: "file",
      name: "README.md",
      path: "/codebase/README.md",
      createdAt: t,
      updatedAt: t,
      content: [
        "# CavCode Codebase",
        "",
        "This is a local-first Codebase surface shared across CavBot CavTools.",
        "Commands in CavCode can create / edit / delete files here.",
        "",
        "Try:",
        "  cav codebase tree",
        '  cav codebase mkdir styles',
        '  cav codebase open /codebase/styles/global.css',
        '  cav run -- /codebase/styles/global.css',
      ].join("\n"),
    },
    {
      type: "file",
      name: "global.css",
      path: "/codebase/styles/global.css",
      createdAt: t,
      updatedAt: t,
      content: [
        "/* CavBot — Codebase: global.css */",
        ":root {",
        "  /* Keep this minimal. The real app ships tokens elsewhere. */",
        "}",
        "",
        "html, body { height: 100%; }",
      ].join("\n"),
    },
    {
      type: "file",
      name: "page.tsx",
      path: "/codebase/app/page.tsx",
      createdAt: t,
      updatedAt: t,
      content: [
        `// Codebase surface example`,
        `export default function Page() {`,
        `  return <div>Codebase ready.</div>;`,
        `}`,
      ].join("\n"),
    },
  ];

  const nodes: Record<string, FsNode> = {};
  nodes["/"] = root;
  for (const n of seed) nodes[n.path] = n;

  return { cwd: "/codebase", nodes };
}

export function listChildren(fs: FsState, dirAbs: string) {
  const out: FsNode[] = [];
  const prefix = dirAbs === "/" ? "/" : `${dirAbs.replace(/\/+$/, "")}/`;

  for (const k of Object.keys(fs.nodes)) {
    const n = fs.nodes[k];
    if (!n) continue;
    if (n.path === dirAbs) continue;
    if (!n.path.startsWith(prefix)) continue;

    const rel = n.path.slice(prefix.length);
    if (!rel) continue;
    if (rel.includes("/")) continue; // only direct children
    out.push(n);
  }

  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}

export function loadFs(): FsState {
  try {
    const raw = globalThis.__cbLocalStore.getItem(CODEBASE_FS_KEY);
    if (!raw) return initFsState();
    const parsed = safeJsonParse(raw);
    if (!parsed.ok) return initFsState();

    const v = parsed.value as Record<string, unknown>;
    if (!v || typeof v !== "object") return initFsState();
    if (!v.nodes || typeof v.nodes !== "object") return initFsState();

    const nodes: Record<string, FsNode> = {};
    const nodesRaw = v.nodes as Record<string, unknown>;
    for (const k of Object.keys(nodesRaw)) {
      const n = nodesRaw[k] as Record<string, unknown> | null;
      if (!n || typeof n !== "object") continue;
      const path = String((n.path as string) || k || "").trim();
      if (!path.startsWith("/")) continue;
      const type = n.type === "dir" ? "dir" : "file";
      const name = String((n.name as string) || baseName(path) || "").trim() || baseName(path) || path;
      const createdAt = Number((n.createdAt as number) || now());
      const updatedAt = Number((n.updatedAt as number) || createdAt);
      const content = type === "file" ? String((n.content as string | undefined) ?? "") : undefined;
      nodes[path] = { type, name, path, createdAt, updatedAt, content };
    }

    if (!nodes["/"]) {
      const t = now();
      nodes["/"] = { type: "dir", name: "/", path: "/", createdAt: t, updatedAt: t };
    }
    if (!nodes["/codebase"]) {
      const t = now();
      nodes["/codebase"] = { type: "dir", name: "cavcode", path: "/codebase", createdAt: t, updatedAt: t };
    }

    const cwd = String((v.cwd as string) || "/codebase").trim() || "/codebase";
    const cwdOk = nodes[cwd] && nodes[cwd].type === "dir";
    return { cwd: cwdOk ? cwd : "/codebase", nodes };
  } catch {
    return initFsState();
  }
}

export function saveFs(fs: FsState) {
  try {
    globalThis.__cbLocalStore.setItem(CODEBASE_FS_KEY, JSON.stringify(fs));
  } catch {}
}

export function isCodebasePath(p: string) {
  const s = String(p || "").trim().replace(/\\/g, "/");
  return s.startsWith("/codebase") || s.startsWith("codebase/") || s.startsWith("codebase:") || s.startsWith("/codebase/");
}

export function toCodebaseAbs(p: string, cwd: string) {
  const s = String(p || "").trim();
  if (!s) return "";
  if (s.startsWith("codebase:")) {
    const rest = s.slice("codebase:".length).trim();
    return normAbsPath(rest || "", cwd);
  }
  if (s.startsWith("codebase/")) return normAbsPath("/" + s, cwd);
  if (s.startsWith("/codebase")) return normAbsPath(s, cwd);
  return normAbsPath(s, cwd);
}

export function displayRelFromCodebase(abs: string) {
  const s = String(abs || "").trim();
  if (!s.startsWith("/codebase")) return s || "";
  const rel = s.slice("/codebase".length).replace(/^\/+/, "");
  return rel ? `cavcode/${rel}` : "cavcode";
}

export function fileExt(path: string) {
  const s = String(path || "").trim();
  const b = baseName(s);
  const i = b.lastIndexOf(".");
  if (i === -1) return "";
  return b.slice(i + 1).toLowerCase();
}
