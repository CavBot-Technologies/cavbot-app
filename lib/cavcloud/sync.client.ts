"use client";

type JsonLike = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type SyncTarget = "cavcloud" | "cavsafe";

export type CavcloudTextSyncInput = {
  folderPath: string;
  name: string;
  mimeType?: string;
  content: string;
  source?: "cavcode" | "cavpad" | string;
  signal?: AbortSignal;
};

function normalizePath(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "/";
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  const normalized = withSlash.replace(/\/+/g, "/");
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function joinPath(parentPath: string, name: string): string {
  const parent = normalizePath(parentPath);
  if (parent === "/") return normalizePath(`/${name}`);
  return normalizePath(`${parent}/${name}`);
}

function splitPath(path: string): string[] {
  return normalizePath(path)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function treeEndpointForTarget(target: SyncTarget): string {
  return target === "cavsafe" ? "/api/cavsafe/tree" : "/api/cavcloud/tree";
}

function folderCreateEndpointForTarget(target: SyncTarget): string {
  return target === "cavsafe" ? "/api/cavsafe/folders" : "/api/cavcloud/folders";
}

function syncUpsertEndpointForTarget(target: SyncTarget): string {
  return target === "cavsafe" ? "/api/cavsafe/sync/upsert" : "/api/cavcloud/sync/upsert";
}

function shouldIgnoreFolderCreateError(status: number, payload: JsonLike | null, target: SyncTarget): boolean {
  const code = String(payload?.error || "").trim().toUpperCase();
  if (target === "cavsafe" && code === "PATH_CONFLICT") return true;
  if (code === "FOLDER_EXISTS") return true;
  if (status === 409 && code === "PATH_CONFLICT") return true;
  return false;
}

async function folderPathExists(target: SyncTarget, path: string, signal?: AbortSignal): Promise<boolean> {
  const endpoint = treeEndpointForTarget(target);
  const res = await fetch(`${endpoint}?folder=${encodeURIComponent(path)}&lite=1`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const payload = await readJson<JsonLike & { folder?: unknown }>(res);
  return !!(res.ok && payload?.ok && payload.folder);
}

async function ensureFolderPath(target: SyncTarget, folderPath: string, signal?: AbortSignal): Promise<string> {
  const normalized = normalizePath(folderPath);
  const parts = splitPath(normalized);
  if (!parts.length) return "/";

  let parent = "/";
  for (const segment of parts) {
    const nextPath = joinPath(parent, segment);
    const res = await fetch(folderCreateEndpointForTarget(target), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: segment, parentPath: parent }),
      signal,
    });

    if (!res.ok) {
      const payload = await readJson<JsonLike>(res);
      const canIgnore = shouldIgnoreFolderCreateError(res.status, payload, target)
        && await folderPathExists(target, nextPath, signal).catch(() => false);
      if (!canIgnore) {
        const label = target === "cavsafe" ? "CavSafe" : "CavCloud";
        throw new Error(String(payload?.message || `Failed to create ${label} folder (${res.status}).`));
      }
    }

    parent = nextPath;
  }

  return parent;
}

export async function ensureCavcloudFolderPath(folderPath: string, signal?: AbortSignal): Promise<string> {
  return ensureFolderPath("cavcloud", folderPath, signal);
}

export async function ensureCavsafeFolderPath(folderPath: string, signal?: AbortSignal): Promise<string> {
  return ensureFolderPath("cavsafe", folderPath, signal);
}

async function upsertTextFile(target: SyncTarget, input: CavcloudTextSyncInput): Promise<void> {
  const folderPath = await ensureFolderPath(target, input.folderPath, input.signal);

  const res = await fetch(syncUpsertEndpointForTarget(target), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folderPath,
      name: String(input.name || "").trim(),
      mimeType: String(input.mimeType || "").trim() || "text/plain; charset=utf-8",
      content: String(input.content || ""),
      source: String(input.source || "sync"),
    }),
    signal: input.signal,
  });

  if (!res.ok) {
    const payload = await readJson<JsonLike>(res);
    const label = target === "cavsafe" ? "CavSafe" : "CavCloud";
    throw new Error(String(payload?.message || `Failed to sync ${label} file (${res.status}).`));
  }
}

export async function upsertCavcloudTextFile(input: CavcloudTextSyncInput): Promise<void> {
  return upsertTextFile("cavcloud", input);
}

export async function upsertCavsafeTextFile(input: CavcloudTextSyncInput): Promise<void> {
  return upsertTextFile("cavsafe", input);
}

export function inferSyncMimeType(fileName: string): string {
  const name = String(fileName || "").trim().toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (ext === "html" || ext === "htm") return "text/html; charset=utf-8";
  if (ext === "css" || ext === "scss") return "text/css; charset=utf-8";
  if (ext === "js" || ext === "mjs" || ext === "cjs" || ext === "jsx") return "application/javascript; charset=utf-8";
  if (ext === "ts" || ext === "tsx") return "application/typescript; charset=utf-8";
  if (ext === "json") return "application/json; charset=utf-8";
  if (ext === "xml") return "application/xml; charset=utf-8";
  if (ext === "yml" || ext === "yaml") return "text/yaml; charset=utf-8";
  if (ext === "md") return "text/markdown; charset=utf-8";
  if (ext === "txt") return "text/plain; charset=utf-8";
  return "text/plain; charset=utf-8";
}
