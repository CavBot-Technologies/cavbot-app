import "server-only";

import type pg from "pg";
import {
  getAuthPool,
  newDbId,
  pgUniqueViolationMentions,
  withAuthTransaction,
} from "@/lib/authDb";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<pg.QueryResult<T>>;
};

type RawProjectSiteSummaryRow = {
  id: number | string;
  topSiteId: string | null;
};

type RawWorkspaceSiteRow = {
  id: string;
  label: string;
  origin: string;
  createdAt: Date | string;
};

type RawWorkspaceSiteOriginRow = {
  id: string;
  origin: string;
};

type RawAccountTierRow = {
  tier: string | null;
};

export type WorkspaceProjectSiteSummary = {
  id: number;
  topSiteId: string | null;
};

export type WorkspaceSiteRecord = {
  id: string;
  label: string;
  origin: string;
  createdAt: Date;
};

export type WorkspaceSiteWriteResult =
  | {
      conflict: true;
      site: { id: string; origin: string; label: string; isActive: boolean };
    }
  | {
      limitBlocked: true;
      current: number;
      limit: number;
    }
  | {
      conflict: false;
      site: WorkspaceSiteRecord;
      topSiteId: string | null;
      autoPinned: boolean;
    };

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

function normalizeProjectSiteSummary(row: RawProjectSiteSummaryRow): WorkspaceProjectSiteSummary {
  return {
    id: toInt(row.id),
    topSiteId: row.topSiteId == null ? null : String(row.topSiteId),
  };
}

function normalizeSiteRow(row: RawWorkspaceSiteRow): WorkspaceSiteRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    origin: String(row.origin),
    createdAt: toDate(row.createdAt),
  };
}

async function findSlugHit(queryable: Queryable, projectId: number, slug: string) {
  const row = await queryOne<{ id: string }>(
    queryable,
    `SELECT "id"
     FROM "Site"
     WHERE "projectId" = $1
       AND "slug" = $2
     LIMIT 1`,
    [projectId, slug]
  );
  return Boolean(row?.id);
}

async function makeUniqueSiteSlug(queryable: Queryable, projectId: number, base: string) {
  if (!(await findSlugHit(queryable, projectId, base))) return base;

  for (let i = 2; i <= 25; i += 1) {
    const candidate = `${base}-${i}`.slice(0, 80);
    if (!(await findSlugHit(queryable, projectId, candidate))) return candidate;
  }

  return `${base}-${newDbId().replace(/-/g, "").slice(0, 6)}`.slice(0, 80);
}

export async function findOwnedWorkspaceProjectForSites(accountId: string, projectId: number) {
  const row = await queryOne<RawProjectSiteSummaryRow>(
    getAuthPool(),
    `SELECT "id", "topSiteId"
     FROM "Project"
     WHERE "id" = $1
       AND "accountId" = $2
     LIMIT 1`,
    [projectId, accountId]
  );
  return row ? normalizeProjectSiteSummary(row) : null;
}

export async function listActiveWorkspaceSites(projectId: number, order: "asc" | "desc" = "desc") {
  const result = await getAuthPool().query<RawWorkspaceSiteRow>(
    `SELECT "id", "label", "origin", "createdAt"
     FROM "Site"
     WHERE "projectId" = $1
       AND "isActive" = true
     ORDER BY "createdAt" ${order === "asc" ? "ASC" : "DESC"}`,
    [projectId]
  );
  return result.rows.map(normalizeSiteRow);
}

export async function findActiveWorkspaceSite(projectId: number, siteId: string) {
  const row = await queryOne<RawWorkspaceSiteOriginRow>(
    getAuthPool(),
    `SELECT "id", "origin"
     FROM "Site"
     WHERE "projectId" = $1
       AND "id" = $2
       AND "isActive" = true
     LIMIT 1`,
    [projectId, siteId]
  );
  return row ? { id: String(row.id), origin: String(row.origin) } : null;
}

export async function findActiveWorkspaceSiteByOrigin(projectId: number, origin: string) {
  const row = await queryOne<RawWorkspaceSiteOriginRow>(
    getAuthPool(),
    `SELECT "id", "origin"
     FROM "Site"
     WHERE "projectId" = $1
       AND "origin" = $2
       AND "isActive" = true
     LIMIT 1`,
    [projectId, origin]
  );
  return row ? { id: String(row.id), origin: String(row.origin) } : null;
}

export async function findAccountTier(accountId: string) {
  const row = await queryOne<RawAccountTierRow>(
    getAuthPool(),
    `SELECT "tier"
     FROM "Account"
     WHERE "id" = $1
     LIMIT 1`,
    [accountId]
  );
  return row?.tier ? String(row.tier) : null;
}

export async function createWorkspaceSite(args: {
  projectId: number;
  accountId: string;
  origin: string;
  label: string;
  notes: string | null;
  baseSlug: string;
  siteLimit: number | null;
}) {
  return withAuthTransaction<WorkspaceSiteWriteResult>(async (tx) => {
    const project = await queryOne<RawProjectSiteSummaryRow>(
      tx,
      `SELECT "id", "topSiteId"
       FROM "Project"
       WHERE "id" = $1
         AND "accountId" = $2
       LIMIT 1
       FOR UPDATE`,
      [args.projectId, args.accountId]
    );
    if (!project) {
      throw new Error("BAD_PROJECT");
    }

    const projectSummary = normalizeProjectSiteSummary(project);
    const existingByOrigin = await queryOne<{
      id: string;
      origin: string;
      label: string;
      isActive: boolean;
    }>(
      tx,
      `SELECT "id", "origin", "label", "isActive"
       FROM "Site"
       WHERE "projectId" = $1
         AND "origin" = $2
       LIMIT 1`,
      [args.projectId, args.origin]
    );

    if (existingByOrigin?.isActive) {
      return {
        conflict: true,
        site: {
          id: String(existingByOrigin.id),
          origin: String(existingByOrigin.origin),
          label: String(existingByOrigin.label),
          isActive: true,
        },
      };
    }

    if (typeof args.siteLimit === "number") {
      const activeCountRow = await queryOne<{ count: number | string }>(
        tx,
        `SELECT COUNT(*)::int AS "count"
         FROM "Site"
         WHERE "projectId" = $1
           AND "isActive" = true`,
        [args.projectId]
      );
      const activeCount = toInt(activeCountRow?.count);
      if (activeCount >= args.siteLimit) {
        return {
          limitBlocked: true,
          current: activeCount,
          limit: args.siteLimit,
        };
      }
    }

    const replacingPinnedInactiveSite =
      Boolean(existingByOrigin && !existingByOrigin.isActive) &&
      projectSummary.topSiteId === String(existingByOrigin?.id || "");

    if (existingByOrigin && !existingByOrigin.isActive) {
      if (projectSummary.topSiteId === String(existingByOrigin.id)) {
        await tx.query(
          `UPDATE "Project"
           SET "topSiteId" = NULL,
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          [args.projectId]
        );
      }

      await tx.query(`DELETE FROM "ApiKey" WHERE "siteId" = $1`, [existingByOrigin.id]);
      await tx.query(`DELETE FROM "ScanJob" WHERE "siteId" = $1`, [existingByOrigin.id]);
      await tx.query(`DELETE FROM "Site" WHERE "id" = $1`, [existingByOrigin.id]);
    }

    let slug = await makeUniqueSiteSlug(tx, args.projectId, args.baseSlug);
    const insertSql = `INSERT INTO "Site" (
         "id",
         "projectId",
         "slug",
         "label",
         "origin",
         "notes",
         "status",
         "isActive",
         "createdAt",
         "updatedAt"
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', true, NOW(), NOW())
       RETURNING "id", "label", "origin", "createdAt"`;

    let inserted: RawWorkspaceSiteRow | null = null;
    try {
      inserted = await queryOne<RawWorkspaceSiteRow>(tx, insertSql, [
        newDbId(),
        args.projectId,
        slug,
        args.label,
        args.origin,
        args.notes,
      ]);
    } catch (error) {
      const code = String((error as { code?: unknown }).code || "");
      if (code !== "23505") throw error;

      const existingOrigin = await queryOne<{
        id: string;
        origin: string;
        label: string;
        isActive: boolean;
      }>(
        tx,
        `SELECT "id", "origin", "label", "isActive"
         FROM "Site"
         WHERE "projectId" = $1
           AND "origin" = $2
         LIMIT 1`,
        [args.projectId, args.origin]
      );
      if (existingOrigin?.isActive) {
        return {
          conflict: true,
          site: {
            id: String(existingOrigin.id),
            origin: String(existingOrigin.origin),
            label: String(existingOrigin.label),
            isActive: true,
          },
        };
      }

      if (!pgUniqueViolationMentions(error, "slug")) {
        throw error;
      }

      slug = await makeUniqueSiteSlug(
        tx,
        args.projectId,
        `${args.baseSlug}-${newDbId().slice(0, 6)}`.slice(0, 80)
      );
      try {
        inserted = await queryOne<RawWorkspaceSiteRow>(tx, insertSql, [
          newDbId(),
          args.projectId,
          slug,
          args.label,
          args.origin,
          args.notes,
        ]);
      } catch (retryError) {
        const retryCode = String((retryError as { code?: unknown }).code || "");
        if (retryCode === "23505") {
          const retryExistingOrigin = await queryOne<{
            id: string;
            origin: string;
            label: string;
            isActive: boolean;
          }>(
            tx,
            `SELECT "id", "origin", "label", "isActive"
             FROM "Site"
             WHERE "projectId" = $1
               AND "origin" = $2
             LIMIT 1`,
            [args.projectId, args.origin]
          );
          if (retryExistingOrigin?.isActive) {
            return {
              conflict: true,
              site: {
                id: String(retryExistingOrigin.id),
                origin: String(retryExistingOrigin.origin),
                label: String(retryExistingOrigin.label),
                isActive: true,
              },
            };
          }
        }
        throw retryError;
      }
    }

    if (!inserted) {
      throw new Error("SITE_CREATE_FAILED");
    }

    const site = normalizeSiteRow(inserted);
    const shouldAutoPin = !projectSummary.topSiteId || replacingPinnedInactiveSite;
    const topSiteId = shouldAutoPin ? site.id : projectSummary.topSiteId;

    if (shouldAutoPin) {
      await tx.query(
        `UPDATE "Project"
         SET "topSiteId" = $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [args.projectId, site.id]
      );
    }

    return {
      conflict: false,
      site,
      topSiteId,
      autoPinned: shouldAutoPin,
    };
  });
}

export async function createDefaultAllowedOriginsForSite(siteId: string, origins: string[]) {
  const uniqueOrigins = Array.from(new Set(origins.map((origin) => String(origin || "").trim()).filter(Boolean)));
  if (!uniqueOrigins.length) return;

  const values: unknown[] = [];
  const tuples: string[] = [];

  for (const origin of uniqueOrigins) {
    const base = values.length;
    values.push(newDbId(), siteId, origin);
    tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'EXACT'::"SiteAllowedOriginMatchType", NOW())`);
  }

  await getAuthPool().query(
    `INSERT INTO "SiteAllowedOrigin" (
       "id",
       "siteId",
       "origin",
       "matchType",
       "createdAt"
     )
     VALUES ${tuples.join(", ")}
     ON CONFLICT ("siteId", "origin") DO NOTHING`,
    values
  );
}

export async function rollbackCreatedWorkspaceSite(args: {
  projectId: number;
  siteId: string;
  autoPinned: boolean;
}) {
  await withAuthTransaction(async (tx) => {
    if (args.autoPinned) {
      await tx.query(
        `UPDATE "Project"
         SET "topSiteId" = NULL,
             "updatedAt" = NOW()
         WHERE "id" = $1
           AND "topSiteId" = $2`,
        [args.projectId, args.siteId]
      );
    }

    await tx.query(`DELETE FROM "Site" WHERE "id" = $1`, [args.siteId]);
  }).catch(() => null);
}

export async function createProjectNotice(projectId: number, origin: string) {
  await getAuthPool().query(
    `INSERT INTO "ProjectNotice" (
       "id",
       "projectId",
       "tone",
       "title",
       "body",
       "createdAt"
     )
     VALUES ($1, $2, 'GOOD'::"NoticeTone", $3, $4, NOW())`,
    [newDbId(), projectId, "Website added", `${origin} is now under this workspace.`]
  );
}
