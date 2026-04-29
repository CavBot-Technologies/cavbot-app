import "server-only";

import type pg from "pg";

import {
  requireAccountContext,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import { findLatestEntitledSubscription, resolveEffectivePlanId } from "@/lib/accountPlan.server";
import { getAuthPool, newDbId } from "@/lib/authDb";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { ensureCavCloudRootFolderRuntime, loadCavCloudTreeLiteRuntime } from "@/lib/cavcloud/runtimeStorage.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import type { PlanId } from "@/lib/plans";

type CavtoolsNamespace = "cavcloud" | "cavsafe" | "cavcode" | "telemetry" | "workspace";

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
  | { kind: "json"; title?: string; data: unknown }
  | { kind: "files"; title?: string; cwd: string; items: CavtoolsFsItem[] };

export type CavtoolsRuntimeExecOutput = {
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
    memberRole: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
    planId: PlanId | "free";
    includeCavsafe: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
};

export type CavtoolsRuntimeFileReadOutput = {
  ok: true;
  path: string;
  mimeType: string;
  readOnly: boolean;
  content: string;
  updatedAtISO?: string | null;
  sha256?: string | null;
  versionNumber?: number | null;
  etag?: string | null;
};

type CavtoolsRuntimeInput = {
  cwd?: string | null;
  command?: string | null;
  path?: string | null;
  projectId?: number | string | null;
  siteOrigin?: string | null;
};

type RuntimeContext = {
  session: CavbotAccountSession & { sub: string };
  accountId: string;
  account: RawAccountRow | null;
  userId: string;
  memberRole: "OWNER" | "ADMIN" | "MEMBER";
  planId: PlanId;
  includeCavsafe: boolean;
  project: {
    id: number;
    slug: string;
    name: string;
  } | null;
  siteOrigin: string | null;
};

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type Token = {
  value: string;
  start: number;
  end: number;
};

type ParsedCommand = {
  raw: string;
  name: string;
  args: string[];
  tokens: Token[];
};

type RawMembershipRow = {
  accountId: string;
  role: string | null;
  createdAt: Date | string;
};

type RawAccountRow = {
  id: string;
  slug: string | null;
  name: string | null;
  tier: string | null;
  trialSeatActive: boolean | null;
  trialEndsAt: Date | string | null;
};

type RawProjectRow = {
  id: number;
  slug: string | null;
  name: string | null;
};

type RawCloudFolderRow = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawCloudFileRow = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  r2Key: string;
  bytes: bigint | number | string | null;
  mimeType: string;
  sha256: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawSafeFolderRow = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt?: Date | string | null;
};

type RawSafeFileRow = {
  id: string;
  folderId: string;
  name: string;
  path: string;
  r2Key: string;
  bytes: bigint | number | string | null;
  mimeType: string;
  sha256: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RawMountRow = {
  id: string;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  mountPath: string;
  mode: "READ_ONLY" | "READ_WRITE";
  priority: number;
  folderId: string;
  folderPath: string;
  folderDeletedAt: Date | string | null;
};

type RuntimeMount = {
  id: string;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  mountPath: string;
  mode: "READ_ONLY" | "READ_WRITE";
  priority: number;
  folderId: string;
  folder: {
    id: string;
    path: string;
    deletedAt: Date | null;
  } | null;
};

type ResolvedMountPath = {
  mount: RuntimeMount;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  sourcePath: string;
  relPath: string;
};

const DEFAULT_CWD = "/cavcloud";
const ROOTS = ["/cavcloud", "/cavsafe", "/cavcode", "/telemetry", "/workspace"] as const;
const MAX_LIST_ROWS = 120;
const MAX_CAT_BYTES = 512 * 1024;

const STATIC_ROOT_ITEMS: Record<"/telemetry" | "/workspace", CavtoolsFsItem[]> = {
  "/telemetry": ["summary", "routes", "errors", "seo", "a11y", "geo", "scans", "export"].map((name) => ({
    type: "file",
    namespace: "telemetry",
    name,
    path: `/telemetry/${name}`,
    readOnly: true,
  })),
  "/workspace": ["status", "sites", "members", "guardrails", "notices"].map((name) => ({
    type: "file",
    namespace: "workspace",
    name,
    path: `/workspace/${name}`,
    readOnly: true,
  })),
};

class CavtoolsRuntimeError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400, message?: string) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

function runtimeErr(code: string, status = 400, message?: string) {
  return new CavtoolsRuntimeError(code, status, message);
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOrigin(input: string | null | undefined): string | null {
  const raw = s(input);
  if (!raw) return null;
  try {
    const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    const url = new URL(withProto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizePath(rawPath: string): string {
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

  const path = `/${stack.join("/")}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function normalizePathNoTrailingSlash(rawPath: string): string {
  const normalized = normalizePath(rawPath);
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function resolvePath(input: string | null | undefined, cwd: string): string {
  const arg = s(input);
  if (!arg) return normalizePath(cwd || DEFAULT_CWD);
  if (arg.startsWith("/")) return normalizePath(arg);
  return normalizePath(`${normalizePath(cwd || DEFAULT_CWD)}/${arg}`);
}

function pathRoot(path: string): typeof ROOTS[number] | null {
  const normalized = normalizePath(path);
  for (const root of ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return root;
  }
  return null;
}

function toNamespacePath(namespaceRoot: "/cavcloud" | "/cavsafe", sourcePath: string): string {
  const src = normalizePath(sourcePath || "/");
  if (src === "/") return namespaceRoot;
  return `${namespaceRoot}${src}`;
}

function toSourcePath(namespaceRoot: "/cavcloud" | "/cavsafe", virtualPath: string): string {
  const normalized = normalizePath(virtualPath);
  if (normalized === namespaceRoot) return "/";
  if (!normalized.startsWith(`${namespaceRoot}/`)) {
    throw runtimeErr("PATH_OUT_OF_SCOPE", 400, `Path "${virtualPath}" is outside ${namespaceRoot}.`);
  }
  return normalizePath(normalized.slice(namespaceRoot.length) || "/");
}

function nowISO() {
  return new Date().toISOString();
}

function hashCommandId(command: string, cwd: string) {
  return Buffer.from(`${Date.now()}:${cwd}:${command}:${Math.random().toString(16).slice(2)}`)
    .toString("base64url")
    .slice(0, 32);
}

function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    try {
      return BigInt(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function toSafeNumber(value: bigint) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function toDate(value: Date | string | null | undefined) {
  return value instanceof Date ? value : new Date(String(value || ""));
}

function maybeTextMimeType(mimeType: string | null | undefined) {
  const mime = s(mimeType).toLowerCase();
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  if (mime.includes("json")) return true;
  if (mime.includes("xml")) return true;
  if (mime.includes("javascript")) return true;
  if (mime.includes("typescript")) return true;
  if (mime.includes("yaml")) return true;
  if (mime.includes("toml")) return true;
  if (mime.includes("svg")) return true;
  return false;
}

function tokenize(rawInput: string): Token[] {
  const input = String(rawInput || "");
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    while (i < input.length && /\s/.test(input[i])) i += 1;
    if (i >= input.length) break;

    const start = i;
    let out = "";
    let quote: '"' | "'" | null = null;

    while (i < input.length) {
      const ch = input[i];
      if (quote) {
        if (ch === "\\" && i + 1 < input.length) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
          i += 1;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }

      if (ch === "\"" || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }

      if (/\s/.test(ch)) break;
      if (ch === "\\" && i + 1 < input.length) {
        out += input[i + 1];
        i += 2;
        continue;
      }

      out += ch;
      i += 1;
    }

    tokens.push({ value: out, start, end: i });
  }

  return tokens;
}

function parseCommand(rawInput: string): ParsedCommand {
  const raw = String(rawInput || "").trim();
  const tokens = tokenize(raw);
  return {
    raw,
    name: s(tokens[0]?.value || "").toLowerCase(),
    args: tokens.slice(1).map((token) => token.value),
    tokens,
  };
}

function normalizeExecMemberRole(value: unknown): "OWNER" | "ADMIN" | "MEMBER" {
  const normalized = s(value).toUpperCase();
  if (normalized === "OWNER") return "OWNER";
  if (normalized === "ADMIN") return "ADMIN";
  return "MEMBER";
}

function pickPrimaryMembership(rows: RawMembershipRow[]) {
  return [...rows].sort((a, b) => {
    const aRole = normalizeExecMemberRole(a.role);
    const bRole = normalizeExecMemberRole(b.role);
    const aRank = aRole === "OWNER" ? 3 : aRole === "ADMIN" ? 2 : 1;
    const bRank = bRole === "OWNER" ? 3 : bRole === "ADMIN" ? 2 : 1;
    if (bRank !== aRank) return bRank - aRank;
    return toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime();
  })[0] || null;
}

async function resolveMembershipForRuntime(accountId: string, userId: string) {
  const result = await getAuthPool().query<RawMembershipRow>(
    `SELECT "accountId", "role", "createdAt"
     FROM "Membership"
     WHERE "userId" = $1`,
    [userId],
  );

  const exact = result.rows.find((row) => row.accountId === accountId) || null;
  if (exact) {
    return {
      accountId: exact.accountId,
      memberRole: normalizeExecMemberRole(exact.role),
    };
  }

  const primary = pickPrimaryMembership(result.rows);
  if (!primary) throw runtimeErr("AUTH_REQUIRED", 401, "Authentication required.");

  return {
    accountId: primary.accountId,
    memberRole: normalizeExecMemberRole(primary.role),
  };
}

async function resolveAccountPlan(accountId: string) {
  const [accountResult, entitledSubscription] = await Promise.all([
    getAuthPool().query<RawAccountRow>(
      `SELECT "id", "slug", "name", "tier", "trialSeatActive", "trialEndsAt"
       FROM "Account"
       WHERE "id" = $1
       LIMIT 1`,
      [accountId],
    ),
    findLatestEntitledSubscription(accountId).catch(() => null),
  ]);

  const account = accountResult.rows[0] || null;
  return {
    account,
    planId: resolveEffectivePlanId({
      account,
      subscription: entitledSubscription,
    }),
  };
}

async function resolveProject(accountId: string, projectIdHint: number | null) {
  const result = projectIdHint
    ? await getAuthPool().query<RawProjectRow>(
        `SELECT "id", "slug", "name"
         FROM "Project"
         WHERE "id" = $1
           AND "accountId" = $2
           AND "isActive" = TRUE
         LIMIT 1`,
        [projectIdHint, accountId],
      )
    : await getAuthPool().query<RawProjectRow>(
        `SELECT "id", "slug", "name"
         FROM "Project"
         WHERE "accountId" = $1
           AND "isActive" = TRUE
         ORDER BY "createdAt" ASC
         LIMIT 1`,
        [accountId],
      );

  const project = result.rows[0] || null;
  return project
    ? {
        id: Number(project.id),
        slug: s(project.slug) || "project",
        name: s(project.name) || "Project",
      }
    : null;
}

async function resolveRuntimeContext(req: Request, input: CavtoolsRuntimeInput): Promise<RuntimeContext> {
  const session = await requireSession(req);
  requireUser(session);
  requireAccountContext(session);

  const sessionAccountId = s(session.accountId);
  const userId = s(session.sub);
  if (!sessionAccountId || !userId) throw runtimeErr("AUTH_REQUIRED", 401, "Authentication required.");

  const membership = await resolveMembershipForRuntime(sessionAccountId, userId);
  const accountId = membership.accountId;
  const projectIdHintNum = Number(input.projectId);
  const projectIdHint = Number.isFinite(projectIdHintNum) && Number.isInteger(projectIdHintNum) && projectIdHintNum > 0
    ? projectIdHintNum
    : null;

  const [{ account, planId }, project] = await Promise.all([
    resolveAccountPlan(accountId),
    resolveProject(accountId, projectIdHint),
  ]);

  return {
    session: {
      ...(session as CavbotAccountSession & { sub: string }),
      accountId,
      memberRole: membership.memberRole,
    },
    accountId,
    account,
    userId,
    memberRole: membership.memberRole,
    planId,
    includeCavsafe: planId === "premium" || planId === "premium_plus",
    project,
    siteOrigin: normalizeOrigin(input.siteOrigin),
  };
}

async function queryCloudFolderByPath(queryable: Queryable, accountId: string, path: string) {
  if (normalizePathNoTrailingSlash(path) === "/") {
    const root = await ensureCavCloudRootFolderRuntime(accountId);
    return {
      id: root.id,
      name: root.name,
      path: root.path,
      parentId: root.parentId,
      createdAt: root.createdAtISO,
      updatedAt: root.updatedAtISO,
    } satisfies RawCloudFolderRow;
  }

  const result = await queryable.query<RawCloudFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt"
     FROM "CavCloudFolder"
     WHERE "accountId" = $1
       AND "path" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [accountId, normalizePathNoTrailingSlash(path)],
  );
  return result.rows[0] || null;
}

async function queryCloudFileByPath(queryable: Queryable, accountId: string, path: string) {
  const result = await queryable.query<RawCloudFileRow>(
    `SELECT "id", "folderId", "name", "path", "r2Key", "bytes", "mimeType", "sha256", "createdAt", "updatedAt"
     FROM "CavCloudFile"
     WHERE "accountId" = $1
       AND "path" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [accountId, normalizePath(path)],
  );
  return result.rows[0] || null;
}

async function ensureSafeRootFolder(queryable: Queryable, accountId: string): Promise<RawSafeFolderRow> {
  const existingResult = await queryable.query<RawSafeFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt", "deletedAt"
     FROM "CavSafeFolder"
     WHERE "accountId" = $1
       AND "path" = '/'
     LIMIT 1`,
    [accountId],
  );
  const existing = existingResult.rows[0] || null;

  if (existing && !existing.deletedAt && existing.parentId === null && existing.name === "root") {
    return existing;
  }

  if (!existing) {
    await queryable.query(
      `INSERT INTO "CavSafeFolder" ("id", "accountId", "parentId", "name", "path", "createdAt", "updatedAt")
       VALUES ($1, $2, NULL, 'root', '/', NOW(), NOW())
       ON CONFLICT ("accountId", "path") DO NOTHING`,
      [newDbId(), accountId],
    );
  } else {
    await queryable.query(
      `UPDATE "CavSafeFolder"
       SET "parentId" = NULL,
           "name" = 'root',
           "path" = '/',
           "deletedAt" = NULL,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [existing.id],
    );
    await queryable.query(
      `DELETE FROM "CavSafeTrash"
       WHERE "accountId" = $1
         AND "folderId" = $2`,
      [accountId, existing.id],
    );
  }

  const retryResult = await queryable.query<RawSafeFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt", "deletedAt"
     FROM "CavSafeFolder"
     WHERE "accountId" = $1
       AND "path" = '/'
     LIMIT 1`,
    [accountId],
  );
  const retry = retryResult.rows[0] || null;
  if (!retry) throw runtimeErr("ROOT_FOLDER_INIT_FAILED", 500, "Failed to initialize CavSafe root folder.");
  return retry;
}

async function querySafeFolderByPath(queryable: Queryable, accountId: string, path: string) {
  const normalized = normalizePathNoTrailingSlash(path);
  if (normalized === "/") return ensureSafeRootFolder(queryable, accountId);

  const result = await queryable.query<RawSafeFolderRow>(
    `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt", "deletedAt"
     FROM "CavSafeFolder"
     WHERE "accountId" = $1
       AND "path" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [accountId, normalized],
  );
  return result.rows[0] || null;
}

async function querySafeFileByPath(queryable: Queryable, accountId: string, path: string) {
  const result = await queryable.query<RawSafeFileRow>(
    `SELECT "id", "folderId", "name", "path", "r2Key", "bytes", "mimeType", "sha256", "createdAt", "updatedAt"
     FROM "CavSafeFile"
     WHERE "accountId" = $1
       AND "path" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [accountId, normalizePath(path)],
  );
  return result.rows[0] || null;
}

async function loadSafeTreeLiteRuntime(accountId: string, folderPath: string) {
  const pool = getAuthPool();
  const folder = await querySafeFolderByPath(pool, accountId, folderPath);
  if (!folder) throw runtimeErr("FOLDER_NOT_FOUND", 404, "Folder not found.");

  const [foldersResult, filesResult] = await Promise.all([
    pool.query<RawSafeFolderRow>(
      `SELECT "id", "name", "path", "parentId", "createdAt", "updatedAt"
       FROM "CavSafeFolder"
       WHERE "accountId" = $1
         AND "parentId" = $2
         AND "deletedAt" IS NULL
       ORDER BY "name" ASC`,
      [accountId, folder.id],
    ),
    pool.query<RawSafeFileRow>(
      `SELECT "id", "folderId", "name", "path", "r2Key", "bytes", "mimeType", "sha256", "createdAt", "updatedAt"
       FROM "CavSafeFile"
       WHERE "accountId" = $1
         AND "folderId" = $2
         AND "deletedAt" IS NULL
       ORDER BY "name" ASC`,
      [accountId, folder.id],
    ),
  ]);

  return {
    folder: {
      id: folder.id,
      name: folder.name,
      path: folder.path,
      parentId: folder.parentId,
      createdAtISO: nowISO(),
      updatedAtISO: toDate(folder.updatedAt).toISOString(),
    },
    folders: foldersResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      path: row.path,
      parentId: row.parentId,
      createdAtISO: toDate(row.createdAt).toISOString(),
      updatedAtISO: toDate(row.updatedAt).toISOString(),
    })),
    files: filesResult.rows.map((row) => ({
      id: row.id,
      folderId: row.folderId,
      name: row.name,
      path: row.path,
      bytes: toSafeNumber(parseBigIntLike(row.bytes) ?? BigInt(0)),
      mimeType: row.mimeType,
      sha256: row.sha256,
      r2Key: row.r2Key,
      createdAtISO: toDate(row.createdAt).toISOString(),
      updatedAtISO: toDate(row.updatedAt).toISOString(),
    })),
  };
}

async function listCavCloudPath(ctx: RuntimeContext, virtualPath: string) {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const pool = getAuthPool();
  const [folder, file] = await Promise.all([
    queryCloudFolderByPath(pool, ctx.accountId, sourcePath),
    queryCloudFileByPath(pool, ctx.accountId, sourcePath),
  ]);

  if (file) {
    return {
      cwd: toNamespacePath("/cavcloud", sourcePath),
      items: [
        {
          type: "file" as const,
          namespace: "cavcloud" as const,
          name: file.name,
          path: toNamespacePath("/cavcloud", file.path),
          sizeBytes: toSafeNumber(parseBigIntLike(file.bytes) ?? BigInt(0)),
          mimeType: file.mimeType,
          updatedAtISO: toDate(file.updatedAt).toISOString(),
        },
      ],
    };
  }

  if (!folder) throw runtimeErr("PATH_NOT_FOUND", 404, `Path not found: ${virtualPath}`);

  const tree = await loadCavCloudTreeLiteRuntime({
    accountId: ctx.accountId,
    folderPath: sourcePath,
  });

  const items: CavtoolsFsItem[] = [
    ...tree.folders.map((entry) => ({
      type: "folder" as const,
      namespace: "cavcloud" as const,
      name: entry.name,
      path: toNamespacePath("/cavcloud", entry.path),
      updatedAtISO: entry.updatedAtISO,
      readOnly: false,
    })),
    ...tree.files.map((entry) => ({
      type: "file" as const,
      namespace: "cavcloud" as const,
      name: entry.name,
      path: toNamespacePath("/cavcloud", entry.path),
      sizeBytes: Number(entry.bytes),
      mimeType: entry.mimeType,
      updatedAtISO: entry.updatedAtISO,
      readOnly: false,
    })),
  ];

  return {
    cwd: toNamespacePath("/cavcloud", tree.folder.path),
    items: items.slice(0, MAX_LIST_ROWS),
  };
}

async function listCavSafePath(ctx: RuntimeContext, virtualPath: string) {
  if (!ctx.includeCavsafe) {
    throw runtimeErr("CAVSAFE_PLAN_REQUIRED", 403, "CavSafe access requires Premium or Premium Plus on this workspace.");
  }

  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const pool = getAuthPool();
  const [folder, file] = await Promise.all([
    querySafeFolderByPath(pool, ctx.accountId, sourcePath),
    querySafeFileByPath(pool, ctx.accountId, sourcePath),
  ]);

  if (file) {
    return {
      cwd: toNamespacePath("/cavsafe", sourcePath),
      items: [
        {
          type: "file" as const,
          namespace: "cavsafe" as const,
          name: file.name,
          path: toNamespacePath("/cavsafe", file.path),
          sizeBytes: toSafeNumber(parseBigIntLike(file.bytes) ?? BigInt(0)),
          mimeType: file.mimeType,
          updatedAtISO: toDate(file.updatedAt).toISOString(),
          readOnly: true,
        },
      ],
    };
  }

  if (!folder) throw runtimeErr("PATH_NOT_FOUND", 404, `Path not found: ${virtualPath}`);

  const tree = await loadSafeTreeLiteRuntime(ctx.accountId, sourcePath);
  const items: CavtoolsFsItem[] = [
    ...tree.folders.map((entry) => ({
      type: "folder" as const,
      namespace: "cavsafe" as const,
      name: entry.name,
      path: toNamespacePath("/cavsafe", entry.path),
      updatedAtISO: entry.updatedAtISO,
      readOnly: true,
    })),
    ...tree.files.map((entry) => ({
      type: "file" as const,
      namespace: "cavsafe" as const,
      name: entry.name,
      path: toNamespacePath("/cavsafe", entry.path),
      sizeBytes: entry.bytes,
      mimeType: entry.mimeType,
      updatedAtISO: entry.updatedAtISO,
      readOnly: true,
    })),
  ];

  return {
    cwd: toNamespacePath("/cavsafe", tree.folder.path),
    items: items.slice(0, MAX_LIST_ROWS),
  };
}

async function loadRuntimeMounts(accountId: string, projectId: number): Promise<RuntimeMount[]> {
  const result = await getAuthPool().query<RawMountRow>(
    `SELECT m."id",
            'CAVCLOUD'::text AS "sourceType",
            m."mountPath",
            m."mode"::text AS "mode",
            m."priority",
            m."folderId",
            f."path" AS "folderPath",
            f."deletedAt" AS "folderDeletedAt"
     FROM "CavCodeProjectMount" m
     JOIN "CavCloudFolder" f ON f."id" = m."folderId"
     WHERE m."accountId" = $1
       AND m."projectId" = $2
     UNION ALL
     SELECT m."id",
            'CAVSAFE'::text AS "sourceType",
            m."mountPath",
            m."mode"::text AS "mode",
            m."priority",
            m."folderId",
            f."path" AS "folderPath",
            f."deletedAt" AS "folderDeletedAt"
     FROM "CavSafeProjectMount" m
     JOIN "CavSafeFolder" f ON f."id" = m."folderId"
     WHERE m."accountId" = $1
       AND m."projectId" = $2`,
    [accountId, projectId],
  );

  return result.rows
    .map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      mountPath: row.mountPath,
      mode: row.mode,
      priority: Number(row.priority || 0),
      folderId: row.folderId,
      folder: {
        id: row.folderId,
        path: row.folderPath,
        deletedAt: row.folderDeletedAt ? toDate(row.folderDeletedAt) : null,
      },
    }))
    .filter((row) => Boolean(row.folder && !row.folder.deletedAt))
    .sort((left, right) => {
      const len = normalizeMountPath(right.mountPath).length - normalizeMountPath(left.mountPath).length;
      if (len !== 0) return len;
      const pr = Number(right.priority || 0) - Number(left.priority || 0);
      if (pr !== 0) return pr;
      return s(left.id).localeCompare(s(right.id));
    });
}

function normalizeMountPath(path: string) {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

function sourcePathFromMount(mount: RuntimeMount, relPath: string) {
  const base = normalizePath(mount.folder?.path || "/");
  const rel = normalizePath(relPath || "/");
  if (rel === "/") return base;
  if (base === "/") return normalizePath(rel);
  return normalizePath(`${base}${rel}`);
}

function virtualPathFromMount(mount: RuntimeMount, sourcePath: string) {
  const mountPath = normalizeMountPath(mount.mountPath);
  const base = normalizePath(mount.folder?.path || "/");
  const src = normalizePath(sourcePath || "/");

  let suffix = "";
  if (base === "/") suffix = src;
  else if (src === base) suffix = "/";
  else if (src.startsWith(`${base}/`)) suffix = src.slice(base.length);
  else suffix = "/";

  const joined = mountPath === "/"
    ? suffix
    : suffix === "/"
      ? mountPath
      : `${mountPath}${suffix}`;

  const normalized = normalizePath(joined || "/");
  return normalized === "/" ? "/cavcode" : `/cavcode${normalized}`;
}

function findMountForVirtualPath(mounts: RuntimeMount[], virtualSubPath: string): ResolvedMountPath | null {
  const target = normalizePath(virtualSubPath || "/");

  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mountPath);
    const match = mountPath === "/"
      ? target.startsWith("/")
      : target === mountPath || target.startsWith(`${mountPath}/`);
    if (!match) continue;

    const rel = mountPath === "/"
      ? target
      : target === mountPath
        ? "/"
        : target.slice(mountPath.length);

    return {
      mount,
      sourceType: mount.sourceType,
      relPath: normalizePath(rel || "/"),
      sourcePath: sourcePathFromMount(mount, rel || "/"),
    };
  }

  return null;
}

function listVirtualMountChildren(mounts: RuntimeMount[], parentSubPath: string): CavtoolsFsItem[] {
  const parent = normalizePath(parentSubPath || "/");
  const names = new Map<string, string>();

  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mountPath);
    if (parent !== "/" && !(mountPath === parent || mountPath.startsWith(`${parent}/`))) continue;

    let rest = "";
    if (parent === "/") rest = mountPath;
    else if (mountPath === parent) continue;
    else rest = mountPath.slice(parent.length);

    const seg = rest.split("/").filter(Boolean)[0];
    if (!seg) continue;
    names.set(seg, seg);
  }

  return Array.from(names.values())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      type: "folder" as const,
      namespace: "cavcode" as const,
      name,
      path: normalizePath(parent === "/" ? `/cavcode/${name}` : `/cavcode${parent}/${name}`),
    }));
}

async function listCavcodePath(ctx: RuntimeContext, virtualPath: string) {
  if (!ctx.project?.id) {
    throw runtimeErr("PROJECT_REQUIRED", 400, "No active project found for /cavcode.");
  }

  const mounts = await loadRuntimeMounts(ctx.accountId, ctx.project.id);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));
  const mountMatch = findMountForVirtualPath(mounts, sub);

  if (!mountMatch) {
    return {
      cwd: normalizePath(virtualPath),
      items: listVirtualMountChildren(mounts, sub),
    };
  }

  const mountPath = normalizeMountPath(mountMatch.mount.mountPath);
  if (sub !== mountPath && !sub.startsWith(`${mountPath}/`) && mountPath !== "/") {
    return {
      cwd: normalizePath(virtualPath),
      items: listVirtualMountChildren(mounts, sub),
    };
  }

  if (mountMatch.sourceType === "CAVCLOUD") {
    const tree = await loadCavCloudTreeLiteRuntime({
      accountId: ctx.accountId,
      folderPath: mountMatch.sourcePath,
    });
    const items: CavtoolsFsItem[] = [
      ...tree.folders.map((entry) => ({
        type: "folder" as const,
        namespace: "cavcode" as const,
        name: entry.name,
        path: virtualPathFromMount(mountMatch.mount, entry.path),
        updatedAtISO: entry.updatedAtISO,
        readOnly: mountMatch.mount.mode !== "READ_WRITE",
      })),
      ...tree.files.map((entry) => ({
        type: "file" as const,
        namespace: "cavcode" as const,
        name: entry.name,
        path: virtualPathFromMount(mountMatch.mount, entry.path),
        sizeBytes: Number(entry.bytes),
        mimeType: entry.mimeType,
        updatedAtISO: entry.updatedAtISO,
        readOnly: mountMatch.mount.mode !== "READ_WRITE",
      })),
    ];

    return {
      cwd: virtualPathFromMount(mountMatch.mount, tree.folder.path),
      items: items.slice(0, MAX_LIST_ROWS),
    };
  }

  const safeTree = await loadSafeTreeLiteRuntime(ctx.accountId, mountMatch.sourcePath);
  const safeItems: CavtoolsFsItem[] = [
    ...safeTree.folders.map((entry) => ({
      type: "folder" as const,
      namespace: "cavcode" as const,
      name: entry.name,
      path: virtualPathFromMount(mountMatch.mount, entry.path),
      updatedAtISO: entry.updatedAtISO,
      readOnly: true,
    })),
    ...safeTree.files.map((entry) => ({
      type: "file" as const,
      namespace: "cavcode" as const,
      name: entry.name,
      path: virtualPathFromMount(mountMatch.mount, entry.path),
      sizeBytes: entry.bytes,
      mimeType: entry.mimeType,
      updatedAtISO: entry.updatedAtISO,
      readOnly: true,
    })),
  ];

  return {
    cwd: virtualPathFromMount(mountMatch.mount, safeTree.folder.path),
    items: safeItems.slice(0, MAX_LIST_ROWS),
  };
}

async function readObjectText(stream: ReadableStream<Uint8Array>, maxBytes = MAX_CAT_BYTES) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    if (total + value.length > maxBytes) {
      const keep = Math.max(0, maxBytes - total);
      if (keep > 0) chunks.push(value.slice(0, keep));
      total = maxBytes;
      break;
    }

    chunks.push(value);
    total += value.length;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

async function readCavCloudFile(ctx: RuntimeContext, virtualPath: string): Promise<CavtoolsRuntimeFileReadOutput> {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const file = await queryCloudFileByPath(getAuthPool(), ctx.accountId, sourcePath);
  if (!file) throw runtimeErr("FILE_NOT_FOUND", 404, `File not found: ${virtualPath}`);
  if (!maybeTextMimeType(file.mimeType)) {
    throw runtimeErr("BINARY_FILE", 400, `${virtualPath} is binary (${file.mimeType}). Use open to stream/download this file.`);
  }

  const stream = await getCavcloudObjectStream({ objectKey: file.r2Key });
  if (!stream) throw runtimeErr("FILE_NOT_FOUND", 404, `File content missing for ${virtualPath}.`);

  const latestVersionResult = await getAuthPool().query<{ versionNumber: number | string | null }>(
    `SELECT "versionNumber"
     FROM "CavCloudFileVersion"
     WHERE "accountId" = $1
       AND "fileId" = $2
     ORDER BY "versionNumber" DESC
     LIMIT 1`,
    [ctx.accountId, file.id],
  );
  const latestVersionNumber = Number(latestVersionResult.rows[0]?.versionNumber);

  return {
    ok: true,
    path: toNamespacePath("/cavcloud", file.path),
    mimeType: file.mimeType,
    readOnly: false,
    content: await readObjectText(stream.body),
    updatedAtISO: toDate(file.updatedAt).toISOString(),
    sha256: file.sha256 || null,
    versionNumber: Number.isFinite(latestVersionNumber) ? Math.max(1, Math.trunc(latestVersionNumber)) : null,
    etag: file.sha256 || null,
  };
}

async function readCavSafeFile(ctx: RuntimeContext, virtualPath: string): Promise<CavtoolsRuntimeFileReadOutput> {
  if (!ctx.includeCavsafe) {
    throw runtimeErr("CAVSAFE_PLAN_REQUIRED", 403, "CavSafe access requires Premium or Premium Plus on this workspace.");
  }

  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const file = await querySafeFileByPath(getAuthPool(), ctx.accountId, sourcePath);
  if (!file) throw runtimeErr("FILE_NOT_FOUND", 404, `File not found: ${virtualPath}`);
  if (!maybeTextMimeType(file.mimeType)) {
    throw runtimeErr("BINARY_FILE", 400, `${virtualPath} is binary (${file.mimeType}). Use open to stream/download this file.`);
  }

  const stream = await getCavsafeObjectStream({ objectKey: file.r2Key });
  if (!stream) throw runtimeErr("FILE_NOT_FOUND", 404, `File content missing for ${virtualPath}.`);

  return {
    ok: true,
    path: toNamespacePath("/cavsafe", file.path),
    mimeType: file.mimeType,
    readOnly: true,
    content: await readObjectText(stream.body),
    updatedAtISO: toDate(file.updatedAt).toISOString(),
    sha256: file.sha256 || null,
    versionNumber: null,
    etag: file.sha256 || null,
  };
}

async function readCavcodeFile(ctx: RuntimeContext, virtualPath: string): Promise<CavtoolsRuntimeFileReadOutput> {
  if (!ctx.project?.id) throw runtimeErr("PROJECT_REQUIRED", 400, "No active project found for /cavcode.");

  const mounts = await loadRuntimeMounts(ctx.accountId, ctx.project.id);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));
  const match = findMountForVirtualPath(mounts, sub);
  if (!match) throw runtimeErr("FILE_NOT_FOUND", 404, `File not found: ${virtualPath}`);

  if (match.sourceType === "CAVCLOUD") {
    const read = await readCavCloudFile(ctx, toNamespacePath("/cavcloud", match.sourcePath));
    return {
      ...read,
      path: virtualPath,
      readOnly: match.mount.mode !== "READ_WRITE",
    };
  }

  const read = await readCavSafeFile(ctx, toNamespacePath("/cavsafe", match.sourcePath));
  return {
    ...read,
    path: virtualPath,
    readOnly: true,
  };
}

async function workspaceStatus(ctx: RuntimeContext) {
  const [projectCountResult, siteCountResult] = await Promise.all([
    getAuthPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
       FROM "Project"
       WHERE "accountId" = $1
         AND "isActive" = TRUE`,
      [ctx.accountId],
    ),
    getAuthPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
       FROM "Site" s
       JOIN "Project" p ON p."id" = s."projectId"
       WHERE p."accountId" = $1
         AND s."isActive" = TRUE`,
      [ctx.accountId],
    ),
  ]);

  return {
    accountId: ctx.accountId,
    accountSlug: ctx.account?.slug || null,
    accountName: ctx.account?.name || null,
    memberRole: ctx.memberRole,
    planId: ctx.planId,
    projectId: ctx.project?.id || null,
    projectName: ctx.project?.name || null,
    activeProjects: Number(projectCountResult.rows[0]?.count || 0),
    activeSites: Number(siteCountResult.rows[0]?.count || 0),
  };
}

async function workspaceSites(ctx: RuntimeContext) {
  if (!ctx.project?.id) return [];

  const result = await getAuthPool().query<{
    id: number;
    origin: string | null;
    label: string | null;
    createdAt: Date | string;
    verifiedAt: Date | string | null;
    status: string | null;
  }>(
    `SELECT "id", "origin", "label", "createdAt", "verifiedAt", "status"
     FROM "Site"
     WHERE "projectId" = $1
       AND "isActive" = TRUE
     ORDER BY "createdAt" DESC`,
    [ctx.project.id],
  );

  return result.rows.map((row) => ({
    id: row.id,
    origin: row.origin,
    label: row.label,
    status: row.status,
    isVerified: Boolean(row.verifiedAt),
    verifiedAtISO: row.verifiedAt ? toDate(row.verifiedAt).toISOString() : null,
    createdAtISO: toDate(row.createdAt).toISOString(),
  }));
}

async function workspaceMembers(ctx: RuntimeContext) {
  const result = await getAuthPool().query<{
    userId: string;
    username: string | null;
    displayName: string | null;
    email: string | null;
    role: string | null;
    joinedAt: Date | string;
  }>(
    `SELECT u."id" AS "userId",
            u."username",
            u."displayName",
            u."email",
            m."role",
            m."createdAt" AS "joinedAt"
     FROM "Membership" m
     JOIN "User" u ON u."id" = m."userId"
     WHERE m."accountId" = $1
     ORDER BY m."createdAt" ASC`,
    [ctx.accountId],
  );

  return result.rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    joinedAtISO: toDate(row.joinedAt).toISOString(),
  }));
}

async function workspaceGuardrails(ctx: RuntimeContext) {
  if (!ctx.project?.id) return {};
  const result = await getAuthPool().query<{ data: unknown }>(
    `SELECT row_to_json(t) AS "data"
     FROM (
       SELECT *
       FROM "ProjectGuardrails"
       WHERE "projectId" = $1
       LIMIT 1
     ) t`,
    [ctx.project.id],
  );
  return (result.rows[0]?.data as Record<string, unknown> | null) || {};
}

async function workspaceNotices(ctx: RuntimeContext) {
  if (!ctx.project?.id) return [];
  const result = await getAuthPool().query<{
    id: string;
    tone: string | null;
    title: string | null;
    body: string | null;
    createdAt: Date | string;
  }>(
    `SELECT "id", "tone", "title", "body", "createdAt"
     FROM "ProjectNotice"
     WHERE "projectId" = $1
     ORDER BY "createdAt" DESC
     LIMIT 30`,
    [ctx.project.id],
  );

  return result.rows.map((row) => ({
    id: row.id,
    tone: row.tone,
    title: row.title,
    body: row.body,
    createdAtISO: toDate(row.createdAt).toISOString(),
  }));
}

function telemetrySectionPayload(ctx: RuntimeContext, section: string) {
  if (section === "routes") return { routes: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  if (section === "errors") return { errors: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  if (section === "seo") return { issues: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  if (section === "a11y") return { issues: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  if (section === "geo") return { locations: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  if (section === "scans") return { jobs: [], projectId: ctx.project?.id || null, siteOrigin: ctx.siteOrigin, empty: true };
  return {
    projectId: ctx.project?.id || null,
    projectName: ctx.project?.name || null,
    siteOrigin: ctx.siteOrigin,
    routes: [],
    errors: [],
    seo: [],
    a11y: [],
    geo: [],
    scans: [],
    empty: true,
  };
}

async function listRuntimePath(ctx: RuntimeContext, path: string): Promise<{ cwd: string; items: CavtoolsFsItem[] }> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw runtimeErr("UNKNOWN_NAMESPACE", 400, `Unknown namespace: ${path}`);

  if (root === "/cavcloud") return listCavCloudPath(ctx, normalized);
  if (root === "/cavsafe") return listCavSafePath(ctx, normalized);
  if (root === "/cavcode") return listCavcodePath(ctx, normalized);
  if (root === "/telemetry") return { cwd: "/telemetry", items: STATIC_ROOT_ITEMS["/telemetry"] };
  return { cwd: "/workspace", items: STATIC_ROOT_ITEMS["/workspace"] };
}

async function readRuntimePath(ctx: RuntimeContext, path: string): Promise<CavtoolsRuntimeFileReadOutput> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw runtimeErr("UNKNOWN_NAMESPACE", 400, `Unknown namespace: ${path}`);

  if (root === "/cavcloud") return readCavCloudFile(ctx, normalized);
  if (root === "/cavsafe") return readCavSafeFile(ctx, normalized);
  if (root === "/cavcode") return readCavcodeFile(ctx, normalized);

  if (root === "/telemetry") {
    const section = s(normalized.slice("/telemetry".length).replace(/^\/+/, "") || "summary").toLowerCase();
    const payload = section === "export"
      ? {
          exportedAtISO: nowISO(),
          projectId: ctx.project?.id || null,
          siteOrigin: ctx.siteOrigin || null,
          data: telemetrySectionPayload(ctx, "summary"),
        }
      : telemetrySectionPayload(ctx, section);

    return {
      ok: true,
      path: normalized,
      mimeType: "application/json",
      readOnly: true,
      content: JSON.stringify(payload, null, 2),
      updatedAtISO: nowISO(),
    };
  }

  const section = s(normalized.slice("/workspace".length).replace(/^\/+/, "") || "status").toLowerCase();
  let payload: unknown;
  if (section === "status") payload = await workspaceStatus(ctx);
  else if (section === "sites") payload = await workspaceSites(ctx);
  else if (section === "members") payload = await workspaceMembers(ctx);
  else if (section === "guardrails") payload = await workspaceGuardrails(ctx);
  else if (section === "notices") payload = await workspaceNotices(ctx);
  else throw runtimeErr("READ_NOT_SUPPORTED", 400, `Cannot read ${normalized}.`);

  return {
    ok: true,
    path: normalized,
    mimeType: "application/json",
    readOnly: true,
    content: JSON.stringify(payload, null, 2),
    updatedAtISO: nowISO(),
  };
}

function actorFromContext(ctx: RuntimeContext) {
  return {
    memberRole: ctx.memberRole,
    planId: ctx.planId,
    includeCavsafe: ctx.includeCavsafe,
  };
}

function buildExecOutput(args: {
  ctx: RuntimeContext;
  command: string;
  cwd: string;
  blocks: CavtoolsExecBlock[];
  warnings?: string[];
  startedAt: number;
}): CavtoolsRuntimeExecOutput {
  return {
    ok: true,
    cwd: args.cwd,
    command: args.command,
    warnings: args.warnings || [],
    blocks: args.blocks,
    durationMs: Date.now() - args.startedAt,
    audit: {
      commandId: hashCommandId(args.command, args.cwd),
      atISO: nowISO(),
      denied: false,
    },
    actor: actorFromContext(args.ctx),
  };
}

export async function maybeHandleRuntimeExecCommand(
  req: Request,
  input: CavtoolsRuntimeInput,
): Promise<CavtoolsRuntimeExecOutput | null> {
  const command = s(input.command);
  if (!command) return null;

  const parsed = parseCommand(command);
  const cwd = normalizePath(s(input.cwd) || DEFAULT_CWD);
  const startedAt = Date.now();

  if (parsed.name === "pwd") {
    const ctx = await resolveRuntimeContext(req, input);
    return buildExecOutput({
      ctx,
      command,
      cwd,
      startedAt,
      blocks: [{ kind: "text", lines: [cwd] }],
    });
  }

  if (parsed.name === "ls" || parsed.name === "cd") {
    const ctx = await resolveRuntimeContext(req, input);
    const target = resolvePath(parsed.args[0] || cwd, cwd);
    const listing = await listRuntimePath(ctx, target);
    return buildExecOutput({
      ctx,
      command,
      cwd: listing.cwd,
      startedAt,
      blocks: [{
        kind: "files",
        title: `Listing ${listing.cwd}`,
        cwd: listing.cwd,
        items: listing.items,
      }],
    });
  }

  if (parsed.name === "cat") {
    const ctx = await resolveRuntimeContext(req, input);
    const target = resolvePath(parsed.args[0] || "", cwd);
    const file = await readRuntimePath(ctx, target);
    return buildExecOutput({
      ctx,
      command,
      cwd,
      startedAt,
      blocks: [{
        kind: "text",
        title: `${file.path} (${file.mimeType})`,
        lines: file.content.split("\n"),
      }],
    });
  }

  if (parsed.name === "cav" && s(parsed.args[0] || "").toLowerCase() === "status") {
    const ctx = await resolveRuntimeContext(req, input);
    return buildExecOutput({
      ctx,
      command,
      cwd,
      startedAt,
      blocks: [{
        kind: "json",
        title: "CavTools Status",
        data: {
          cwd,
          workspace: await workspaceStatus(ctx),
          cavcloudEvents: 0,
          cavsafeEvents: 0,
        },
      }],
    });
  }

  return null;
}

export async function maybeReadRuntimeCavtoolsFile(
  req: Request,
  input: CavtoolsRuntimeInput,
): Promise<CavtoolsRuntimeFileReadOutput | null> {
  const path = s(input.path);
  if (!path) return null;

  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) return null;

  const supported = root === "/cavcloud" || root === "/cavsafe" || root === "/cavcode" || root === "/telemetry" || root === "/workspace";
  if (!supported) return null;

  const ctx = await resolveRuntimeContext(req, input);
  return readRuntimePath(ctx, normalized);
}
