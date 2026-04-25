import "server-only";

import { Prisma } from "@prisma/client";
import type pg from "pg";
import { randomBytes } from "crypto";

import { getAuthPool, isPgUniqueViolation, withAuthTransaction, withDedicatedAuthClient } from "@/lib/authDb";
import { isPermissionDeniedError, isSchemaMismatchError } from "@/lib/dbSchemaGuard";
import { createProjectKeyMaterial } from "@/lib/projectKeyMaterial.server";

const DEFAULT_PROJECT_NAME = "Primary Project";
const DEFAULT_PROJECT_SLUG = "primary";

const WORKSPACE_BOOTSTRAP_SCHEMA_HINTS: {
  tables: string[];
  columns: string[];
  fields: string[];
} = {
  tables: ["Project", "Site", "SiteAllowedOrigin", "ProjectNotice"],
  columns: [
    "accountId",
    "isActive",
    "topSiteId",
    "retentionDays",
    "region",
    "serverKeyHash",
    "serverKeyLast4",
  ],
  fields: ["project", "site", "siteAllowedOrigin", "projectNotice"],
};

const WORKSPACE_BOOTSTRAP_ACCESS_HINTS = ["Project", "Site", "SiteAllowedOrigin", "ProjectNotice"];

const PROJECT_COLUMN_SQL = `
  "id",
  "accountId",
  "name",
  "slug",
  "serverKeyHash",
  "serverKeyLast4",
  "isActive",
  "region",
  "retentionDays",
  "topSiteId",
  "createdAt",
  "updatedAt",
  "serverKeyEnc",
  "serverKeyEncIv"
`;

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<pg.QueryResult<T>>;
};

type RawProjectRow = {
  id: number | string;
  accountId: string;
  name: string | null;
  slug: string;
  serverKeyHash: string;
  serverKeyLast4: string;
  isActive: boolean;
  region: string;
  retentionDays: number | string;
  topSiteId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  serverKeyEnc: string | null;
  serverKeyEncIv: string | null;
};

type WorkspaceProjectRow = {
  id: number;
  accountId: string;
  name: string | null;
  slug: string;
  serverKeyHash: string;
  serverKeyLast4: string;
  isActive: boolean;
  region: string;
  retentionDays: number;
  topSiteId: string | null;
  createdAt: Date;
  updatedAt: Date;
  serverKeyEnc: string | null;
  serverKeyEncIv: string | null;
};

type RawProjectListRow = {
  id: number | string;
  name: string | null;
  slug: string;
  region: string;
  retentionDays: number | string;
  topSiteId: string | null;
  createdAt: Date | string;
};

export type WorkspaceProjectListItem = {
  id: number;
  name: string | null;
  slug: string;
  region: string;
  retentionDays: number;
  topSiteId: string | null;
  createdAt: Date;
};

export type WorkspaceBootstrapErrorCode =
  | "DB_SCHEMA_OUT_OF_DATE"
  | "DB_PERMISSION_DENIED"
  | "WORKSPACE_BOOTSTRAP_FAILED";

function toInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = []
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

function normalizeProjectRow(row: RawProjectRow): WorkspaceProjectRow {
  return {
    id: toInt(row.id),
    accountId: String(row.accountId),
    name: row.name == null ? null : String(row.name),
    slug: String(row.slug),
    serverKeyHash: String(row.serverKeyHash),
    serverKeyLast4: String(row.serverKeyLast4),
    isActive: Boolean(row.isActive),
    region: String(row.region),
    retentionDays: toInt(row.retentionDays),
    topSiteId: row.topSiteId == null ? null : String(row.topSiteId),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    serverKeyEnc: row.serverKeyEnc == null ? null : String(row.serverKeyEnc),
    serverKeyEncIv: row.serverKeyEncIv == null ? null : String(row.serverKeyEncIv),
  };
}

function normalizeProjectListRow(row: RawProjectListRow): WorkspaceProjectListItem {
  return {
    id: toInt(row.id),
    name: row.name == null ? null : String(row.name),
    slug: String(row.slug),
    region: String(row.region),
    retentionDays: toInt(row.retentionDays),
    topSiteId: row.topSiteId == null ? null : String(row.topSiteId),
    createdAt: toDate(row.createdAt),
  };
}

async function findProjectByIdFrom(
  queryable: Queryable,
  accountId: string,
  projectId: number,
  includeInactive = false
) {
  const row = await queryOne<RawProjectRow>(
    queryable,
    `SELECT
       ${PROJECT_COLUMN_SQL}
     FROM "Project"
     WHERE "id" = $1
       AND "accountId" = $2
       ${includeInactive ? "" : 'AND "isActive" = true'}
     LIMIT 1`,
    [projectId, accountId]
  );
  return row ? normalizeProjectRow(row) : null;
}

async function findFirstProjectFrom(queryable: Queryable, accountId: string, includeInactive = false) {
  const row = await queryOne<RawProjectRow>(
    queryable,
    `SELECT
       ${PROJECT_COLUMN_SQL}
     FROM "Project"
     WHERE "accountId" = $1
       ${includeInactive ? "" : 'AND "isActive" = true'}
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [accountId]
  );
  return row ? normalizeProjectRow(row) : null;
}

async function projectSlugExists(queryable: Queryable, accountId: string, slug: string) {
  const hit = await queryOne<{ id: number | string }>(
    queryable,
    `SELECT "id"
     FROM "Project"
     WHERE "accountId" = $1
       AND "slug" = $2
     LIMIT 1`,
    [accountId, slug]
  );
  return Boolean(hit?.id);
}

async function makeUniqueDefaultProjectSlug(queryable: Queryable, accountId: string) {
  for (let i = 1; i <= 25; i += 1) {
    const candidate = i === 1 ? DEFAULT_PROJECT_SLUG : `${DEFAULT_PROJECT_SLUG}-${i}`;
    if (!(await projectSlugExists(queryable, accountId, candidate))) return candidate;
  }
  return `${DEFAULT_PROJECT_SLUG}-${randomBytes(2).toString("hex")}`;
}

function projectHasUnsupportedSelect(select: Prisma.ProjectSelect) {
  const supported = new Set<keyof WorkspaceProjectRow>([
    "id",
    "accountId",
    "name",
    "slug",
    "serverKeyHash",
    "serverKeyLast4",
    "isActive",
    "region",
    "retentionDays",
    "topSiteId",
    "createdAt",
    "updatedAt",
    "serverKeyEnc",
    "serverKeyEncIv",
  ]);

  return Object.entries(select).some(([key, enabled]) => Boolean(enabled) && !supported.has(key as keyof WorkspaceProjectRow));
}

function projectPayloadForSelect<T extends Prisma.ProjectSelect>(
  row: WorkspaceProjectRow,
  select: T
): Prisma.ProjectGetPayload<{ select: T }> {
  if (projectHasUnsupportedSelect(select)) {
    throw new Error("Unsupported workspace project select.");
  }

  const out: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (!enabled) continue;
    out[key] = row[key as keyof WorkspaceProjectRow] ?? null;
  }
  return out as Prisma.ProjectGetPayload<{ select: T }>;
}

export function classifyWorkspaceBootstrapError(error: unknown): {
  error: WorkspaceBootstrapErrorCode;
  status: number;
  retryable: boolean;
} {
  if (isPermissionDeniedError(error, WORKSPACE_BOOTSTRAP_ACCESS_HINTS)) {
    return { error: "DB_PERMISSION_DENIED", status: 503, retryable: false };
  }

  if (isSchemaMismatchError(error, WORKSPACE_BOOTSTRAP_SCHEMA_HINTS)) {
    return { error: "DB_SCHEMA_OUT_OF_DATE", status: 409, retryable: false };
  }

  return { error: "WORKSPACE_BOOTSTRAP_FAILED", status: 503, retryable: true };
}

export async function listAccountWorkspaceProjects(accountId: string, includeInactive = false) {
  return withDedicatedAuthClient(async (authClient) => {
    const result = await authClient.query<RawProjectListRow>(
      `SELECT
         "id",
         "name",
         "slug",
         "region",
         "retentionDays",
         "topSiteId",
         "createdAt"
       FROM "Project"
       WHERE "accountId" = $1
         ${includeInactive ? "" : 'AND "isActive" = true'}
       ORDER BY "id" ASC`,
      [accountId]
    );

    return result.rows.map(normalizeProjectListRow);
  });
}

export async function readAccountWorkspaceBootstrap(args: {
  accountId: string;
  requestedProjectId?: number | null;
  fallbackProjectId?: number | null;
  includeInactive?: boolean;
  ensureActive?: boolean;
}) {
  const includeInactive = Boolean(args.includeInactive);
  const candidateIds = Array.from(
    new Set(
      [args.requestedProjectId, args.fallbackProjectId].filter(
        (value): value is number => Number.isInteger(value) && Number(value) > 0
      )
    )
  );

  return withDedicatedAuthClient(async (authClient) => {
    let activeProject = null as WorkspaceProjectRow | null;

    for (const projectId of candidateIds) {
      activeProject = await findProjectByIdFrom(
        authClient,
        args.accountId,
        projectId,
        includeInactive
      );
      if (activeProject) break;
    }

    if (!activeProject) {
      activeProject = await findFirstProjectFrom(authClient, args.accountId, includeInactive);
    }

    if (!activeProject && args.ensureActive !== false) {
      const ensured = await ensureActiveWorkspaceProject(args.accountId);
      activeProject = await findProjectByIdFrom(
        authClient,
        args.accountId,
        ensured.id,
        includeInactive
      );
    }

    const result = await authClient.query<RawProjectListRow>(
      `SELECT
         "id",
         "name",
         "slug",
         "region",
         "retentionDays",
         "topSiteId",
         "createdAt"
       FROM "Project"
       WHERE "accountId" = $1
         ${includeInactive ? "" : 'AND "isActive" = true'}
       ORDER BY "id" ASC`,
      [args.accountId]
    );

    return {
      activeProjectId: activeProject?.id ?? null,
      projects: result.rows.map(normalizeProjectListRow),
    };
  });
}

export async function ensureActiveWorkspaceProject(accountId: string) {
  const existing = await findFirstProjectFrom(getAuthPool(), accountId, false);
  if (existing) return projectPayloadForSelect(existing, {
    id: true,
    accountId: true,
    name: true,
    slug: true,
    serverKeyLast4: true,
    isActive: true,
  });

  const { serverKeyHash, serverKeyLast4, serverKeyEnc, serverKeyEncIv } =
    await createProjectKeyMaterial();

  return withAuthTransaction(async (tx) => {
    const retryExisting = await findFirstProjectFrom(tx, accountId, false);
    if (retryExisting) {
      return projectPayloadForSelect(retryExisting, {
        id: true,
        accountId: true,
        name: true,
        slug: true,
        serverKeyLast4: true,
        isActive: true,
      });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const slug = await makeUniqueDefaultProjectSlug(tx, accountId);
      try {
        const inserted = await queryOne<RawProjectRow>(
          tx,
          `INSERT INTO "Project" (
             "accountId",
             "name",
             "slug",
             "serverKeyHash",
             "serverKeyLast4",
             "serverKeyEnc",
             "serverKeyEncIv",
             "isActive",
             "createdAt",
             "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
           RETURNING ${PROJECT_COLUMN_SQL}`,
          [accountId, DEFAULT_PROJECT_NAME, slug, serverKeyHash, serverKeyLast4, serverKeyEnc, serverKeyEncIv]
        );

        if (!inserted) {
          throw new Error("Workspace bootstrap could not create a default project.");
        }

        const normalized = normalizeProjectRow(inserted);
        return projectPayloadForSelect(normalized, {
          id: true,
          accountId: true,
          name: true,
          slug: true,
          serverKeyLast4: true,
          isActive: true,
        });
      } catch (error) {
        if (isPgUniqueViolation(error)) {
          const ensured = await findFirstProjectFrom(tx, accountId, false);
          if (ensured) {
            return projectPayloadForSelect(ensured, {
              id: true,
              accountId: true,
              name: true,
              slug: true,
              serverKeyLast4: true,
              isActive: true,
            });
          }
          continue;
        }
        throw error;
      }
    }

    throw new Error("Workspace bootstrap could not create a default project.");
  });
}

export async function findAccountWorkspaceProject<T extends Prisma.ProjectSelect>(args: {
  accountId: string;
  projectId: number | null | undefined;
  select: T;
  includeInactive?: boolean;
}) {
  if (!args.projectId) return null;
  const row = await withDedicatedAuthClient((authClient) =>
    findProjectByIdFrom(
      authClient,
      args.accountId,
      args.projectId!,
      Boolean(args.includeInactive)
    )
  );
  return row ? projectPayloadForSelect(row, args.select) : null;
}

export async function resolveAccountWorkspaceProject<T extends Prisma.ProjectSelect>(args: {
  accountId: string;
  select: T;
  requestedProjectId?: number | null;
  fallbackProjectId?: number | null;
  includeInactive?: boolean;
  ensureActive?: boolean;
}) {
  const candidateIds = Array.from(
    new Set(
      [args.requestedProjectId, args.fallbackProjectId].filter(
        (value): value is number => Number.isInteger(value) && Number(value) > 0
      )
    )
  );

  for (const projectId of candidateIds) {
    const ownedProject = await findAccountWorkspaceProject({
      accountId: args.accountId,
      projectId,
      select: args.select,
      includeInactive: args.includeInactive,
    });
    if (ownedProject) return ownedProject;
  }

  const firstProject = await withDedicatedAuthClient((authClient) =>
    findFirstProjectFrom(
      authClient,
      args.accountId,
      Boolean(args.includeInactive)
    )
  );
  if (firstProject) return projectPayloadForSelect(firstProject, args.select);
  if (args.ensureActive === false) return null;

  const ensured = await ensureActiveWorkspaceProject(args.accountId);
  return findAccountWorkspaceProject({
    accountId: args.accountId,
    projectId: ensured.id,
    select: args.select,
    includeInactive: args.includeInactive,
  });
}
