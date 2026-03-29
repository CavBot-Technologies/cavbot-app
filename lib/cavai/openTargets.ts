"use client";

export type CavAiPriorityOpenTargetKind = "cavcloudFileId" | "cavcloudPath" | "file" | "url";

export type CavAiPriorityOpenTarget = {
  kind: CavAiPriorityOpenTargetKind;
  value: string;
  label: string;
  folderId?: string;
  workspaceId?: string;
  sha256?: string;
  updatedAt?: string;
};

export type CavAiTargetResolveContext = {
  generatedAt?: string | null;
  folderId?: string | null;
  workspaceId?: string | null;
  projectId?: string | number | null;
  siteId?: string | null;
  origin?: string | null;
};

export type CavAiResolvedCloudCandidate = {
  fileId: string;
  path: string;
  name: string;
  updatedAtISO: string;
  sha256?: string | null;
  workspaceId?: string | null;
  folderId?: string | null;
};

export type CavAiOpenTargetResolved =
  | {
      ok: true;
      resolution: "cavcloud";
      target: CavAiPriorityOpenTarget;
      fileId: string;
      filePath: string;
    }
  | {
      ok: true;
      resolution: "cavcode";
      target: CavAiPriorityOpenTarget;
      filePath: string;
    }
  | {
      ok: true;
      resolution: "url";
      target: CavAiPriorityOpenTarget;
      url: string;
    };

export type CavAiOpenTargetUnresolved =
  | {
      ok: false;
      reason: "no_targets";
      message: string;
    }
  | {
      ok: false;
      reason: "not_found";
      message: string;
    }
  | {
      ok: false;
      reason: "ambiguous";
      message: string;
      target: CavAiPriorityOpenTarget;
      candidates: CavAiResolvedCloudCandidate[];
    };

export type CavAiOpenTargetResolution = CavAiOpenTargetResolved | CavAiOpenTargetUnresolved;

type ResolveFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PRIORITY_KIND_ORDER: CavAiPriorityOpenTargetKind[] = [
  "cavcloudFileId",
  "cavcloudPath",
  "file",
  "url",
];

const CAVCODE_QUERY_KEYS = [
  "project",
  "projectId",
  "site",
  "siteId",
  "workspace",
  "workspaceId",
  "ws",
  "origin",
  "line",
  "col",
  "column",
  "l",
  "c",
] as const;

type CavCloudResolveResponse =
  | {
      ok: true;
      status: "resolved";
      file: CavAiResolvedCloudCandidate;
    }
  | {
      ok: true;
      status: "ambiguous";
      matches: CavAiResolvedCloudCandidate[];
    }
  | {
      ok: true;
      status: "not_found";
    }
  | {
      ok: false;
      error?: string;
      message?: string;
    };

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeKind(value: unknown): CavAiPriorityOpenTargetKind | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw === "cavcloudFileId") return "cavcloudFileId";
  if (raw === "cavcloudPath") return "cavcloudPath";
  if (raw === "file") return "file";
  if (raw === "url") return "url";
  return null;
}

function kindRank(kind: CavAiPriorityOpenTargetKind): number {
  const idx = PRIORITY_KIND_ORDER.indexOf(kind);
  return idx < 0 ? 99 : idx;
}

function normalizePathLike(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const withForwardSlashes = raw.replace(/\\/g, "/");
  const prefixed = withForwardSlashes.startsWith("/") ? withForwardSlashes : `/${withForwardSlashes}`;
  return prefixed.replace(/\/+/g, "/");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizePriorityOpenTarget(input: unknown): CavAiPriorityOpenTarget | null {
  const row = asRecord(input);
  if (!row) return null;

  const kind = normalizeKind(row.kind) || normalizeKind(row.type);
  if (!kind) return null;

  const valueRaw = readString(row.value) || readString(row.target);
  if (!valueRaw) return null;

  if (kind === "url" && !isHttpUrl(valueRaw)) return null;

  const value =
    kind === "file" || kind === "cavcloudPath"
      ? normalizePathLike(valueRaw)
      : valueRaw;
  if (!value) return null;

  return {
    kind,
    value,
    label: readString(row.label),
    folderId: readString(row.folderId) || undefined,
    workspaceId: readString(row.workspaceId) || undefined,
    sha256: readString(row.sha256) || undefined,
    updatedAt: readString(row.updatedAt) || undefined,
  };
}

export function normalizePriorityOpenTargets(input: unknown): CavAiPriorityOpenTarget[] {
  if (!Array.isArray(input)) return [];
  const out: CavAiPriorityOpenTarget[] = [];
  const seen = new Set<string>();

  for (const row of input) {
    const normalized = normalizePriorityOpenTarget(row);
    if (!normalized) continue;
    const key = [
      normalized.kind,
      normalized.value,
      normalized.folderId || "",
      normalized.workspaceId || "",
      normalized.sha256 || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  out.sort((a, b) => {
    const rankDiff = kindRank(a.kind) - kindRank(b.kind);
    if (rankDiff !== 0) return rankDiff;

    const aKey = `${a.label}|${a.value}`.toLowerCase();
    const bKey = `${b.label}|${b.value}`.toLowerCase();
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });

  return out;
}

export function hasFileCapableTarget(targets: CavAiPriorityOpenTarget[]): boolean {
  return targets.some((target) => target.kind === "cavcloudFileId" || target.kind === "cavcloudPath" || target.kind === "file");
}

export function buildCavCodeHref(filePath: string, currentSearch?: string): string {
  const normalizedPath = normalizePathLike(filePath);
  const current = new URLSearchParams(currentSearch || "");
  const next = new URLSearchParams();

  next.set("cloud", "1");
  next.set("file", normalizedPath);

  for (const key of CAVCODE_QUERY_KEYS) {
    const value = String(current.get(key) || "").trim();
    if (!value) continue;
    next.set(key, value);
  }
  return `/cavcode?${next.toString()}`;
}

async function resolveCavCloudTarget(args: {
  target: CavAiPriorityOpenTarget;
  context?: CavAiTargetResolveContext;
  fetcher: ResolveFetcher;
}): Promise<
  | {
      status: "resolved";
      file: CavAiResolvedCloudCandidate;
    }
  | {
      status: "ambiguous";
      matches: CavAiResolvedCloudCandidate[];
    }
  | {
      status: "not_found";
    }
> {
  const res = await args.fetcher("/api/cavai/open-targets/resolve", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({
      target: args.target,
      context: args.context || {},
    }),
  });

  if (!res.ok) return { status: "not_found" };
  const json = (await res.json().catch(() => null)) as CavCloudResolveResponse | null;
  if (!json || json.ok !== true) return { status: "not_found" };

  if (json.status === "resolved" && json.file?.path) {
    return { status: "resolved", file: json.file };
  }
  if (json.status === "ambiguous" && Array.isArray(json.matches) && json.matches.length) {
    return { status: "ambiguous", matches: json.matches };
  }
  return { status: "not_found" };
}

export async function resolveOpenTargetDeterministic(args: {
  targets: unknown;
  context?: CavAiTargetResolveContext;
  fetcher?: ResolveFetcher;
}): Promise<CavAiOpenTargetResolution> {
  const targets = normalizePriorityOpenTargets(args.targets);
  if (!targets.length) {
    return {
      ok: false,
      reason: "no_targets",
      message: "No file target available yet.",
    };
  }

  const fetcher = args.fetcher || fetch;
  const firstUrl = targets.find((target) => target.kind === "url") || null;

  for (const target of targets) {
    if (target.kind === "url") continue;

    if (target.kind === "file") {
      const filePath = normalizePathLike(target.value);
      if (!filePath || filePath === "/") continue;
      return {
        ok: true,
        resolution: "cavcode",
        target,
        filePath,
      };
    }

    const resolved = await resolveCavCloudTarget({
      target,
      context: args.context,
      fetcher,
    });

    if (resolved.status === "resolved") {
      const filePath = normalizePathLike(resolved.file.path);
      if (!filePath || filePath === "/") continue;
      return {
        ok: true,
        resolution: "cavcloud",
        target,
        fileId: resolved.file.fileId,
        filePath,
      };
    }

    if (resolved.status === "ambiguous") {
      return {
        ok: false,
        reason: "ambiguous",
        message: "Multiple matches found — choose file.",
        target,
        candidates: resolved.matches,
      };
    }
  }

  if (firstUrl) {
    return {
      ok: true,
      resolution: "url",
      target: firstUrl,
      url: firstUrl.value,
    };
  }

  return {
    ok: false,
    reason: "not_found",
    message: "No matching file found in CavCloud or CavCode.",
  };
}
