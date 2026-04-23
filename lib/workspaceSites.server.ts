import "server-only";

import type pg from "pg";
import {
  getAuthPool,
  newDbId,
  pgUniqueViolationMentions,
  withAuthTransaction,
} from "@/lib/authDb";
import { expandRelatedExactOrigins } from "@/originMatch";

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
  notes: string | null;
  createdAt: Date | string;
};

type RawWorkspaceSiteOriginRow = {
  id: string;
  origin: string;
};

type RawOwnedWorkspaceSiteRow = {
  projectId: number | string;
  siteId: string;
  origin: string;
};

type RawVerifiedSiteRow = {
  id: string;
  projectId: number | string;
  origin: string;
  label: string;
  verifiedAt: Date | string;
};

type RawAccountTierRow = {
  tier: string | null;
};

type RawOwnedProjectDeletionRow = {
  id: number | string;
  accountId: string;
  topSiteId: string | null;
  retentionDays: number | string | null;
};

type RawWorkspaceDeletionRow = {
  siteId: string;
  origin: string | null;
  requestedAt: Date | string | null;
  purgeScheduledAt: Date | string | null;
};

export type WorkspaceProjectSiteSummary = {
  id: number;
  topSiteId: string | null;
};

export type WorkspaceSiteRecord = {
  id: string;
  label: string;
  origin: string;
  notes?: string;
  createdAt: Date;
};

export type WorkspaceVerifiedSiteRecord = {
  id: string;
  projectId: number;
  origin: string;
  label: string;
  verifiedAt: Date;
};

export type WorkspaceRemovedSiteRecord = {
  siteId: string;
  origin: string;
  removedAt: Date;
  purgeAt: Date;
};

export type WorkspaceSiteRemovalMode = "SAFE" | "DESTRUCTIVE";

export type WorkspaceSiteRemovalResult = {
  siteId: string;
  origin: string;
  label: string;
  nextTopSiteId: string | null;
  retentionDays: number;
  purgeScheduledAt: Date | null;
};

export type WorkspaceSiteRestoreResult = {
  siteId: string;
  origin: string;
  restoredAt: Date;
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

const DEFAULT_SITE_RETENTION_DAYS = 30;

function retentionDateFromNow(retentionDays = DEFAULT_SITE_RETENTION_DAYS) {
  const when = new Date();
  when.setUTCDate(when.getUTCDate() + (Number.isFinite(retentionDays) ? retentionDays : DEFAULT_SITE_RETENTION_DAYS));
  return when;
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
    notes: row.notes == null ? undefined : String(row.notes),
    createdAt: toDate(row.createdAt),
  };
}

function normalizeVerifiedSiteRow(row: RawVerifiedSiteRow): WorkspaceVerifiedSiteRecord {
  return {
    id: String(row.id),
    projectId: toInt(row.projectId),
    origin: String(row.origin),
    label: String(row.label),
    verifiedAt: toDate(row.verifiedAt),
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
    `SELECT "id", "label", "origin", "notes", "createdAt"
     FROM "Site"
     WHERE "projectId" = $1
       AND "isActive" = true
     ORDER BY "createdAt" ${order === "asc" ? "ASC" : "DESC"}`,
    [projectId]
  );
  return result.rows.map(normalizeSiteRow);
}

export async function listRemovedWorkspaceSites(projectId: number) {
  const result = await getAuthPool().query<RawWorkspaceDeletionRow>(
    `SELECT
       "siteId",
       "origin",
       "requestedAt",
       "purgeScheduledAt"
     FROM "SiteDeletion"
     WHERE "projectId" = $1
       AND "status" = 'SCHEDULED'::"SiteDeletionStatus"
       AND "purgeScheduledAt" > NOW()
     ORDER BY "purgeScheduledAt" ASC`,
    [projectId]
  );

  return result.rows
    .map((row) => {
      const origin = String(row.origin || "").trim();
      const removedAt = row.requestedAt ? toDate(row.requestedAt) : null;
      const purgeAt = row.purgeScheduledAt ? toDate(row.purgeScheduledAt) : null;
      if (!origin || !removedAt || !purgeAt) return null;
      return {
        siteId: String(row.siteId),
        origin,
        removedAt,
        purgeAt,
      } satisfies WorkspaceRemovedSiteRecord;
    })
    .filter((row): row is WorkspaceRemovedSiteRecord => Boolean(row));
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
  const candidateOrigins = expandRelatedExactOrigins(origin);
  const row = await queryOne<RawWorkspaceSiteOriginRow>(
    getAuthPool(),
    `SELECT "id", "origin"
     FROM "Site"
     WHERE "projectId" = $1
       AND "origin" = ANY($2::text[])
       AND "isActive" = true
     LIMIT 1`,
    [projectId, candidateOrigins]
  );
  return row ? { id: String(row.id), origin: String(row.origin) } : null;
}

export async function findOwnedWorkspaceSiteByOrigin(accountId: string, origin: string) {
  const candidateOrigins = expandRelatedExactOrigins(origin);
  const row = await queryOne<RawOwnedWorkspaceSiteRow>(
    getAuthPool(),
    `SELECT
       project."id" AS "projectId",
       site."id" AS "siteId",
       site."origin" AS "origin"
     FROM "Site" site
     INNER JOIN "Project" project ON project."id" = site."projectId"
     WHERE project."accountId" = $1
       AND project."isActive" = true
       AND site."isActive" = true
       AND site."origin" = ANY($2::text[])
     ORDER BY
       CASE WHEN project."topSiteId" = site."id" THEN 0 ELSE 1 END ASC,
       site."createdAt" DESC
     LIMIT 1`,
    [accountId, candidateOrigins],
  );
  return row
    ? {
        projectId: toInt(row.projectId),
        siteId: String(row.siteId),
        origin: String(row.origin),
      }
    : null;
}

export async function markWorkspaceSiteVerified(siteId: string) {
  const row = await queryOne<RawVerifiedSiteRow>(
    getAuthPool(),
    `UPDATE "Site"
     SET "status" = 'VERIFIED'::"SiteStatus",
         "verifiedAt" = COALESCE("verifiedAt", NOW()),
         "updatedAt" = NOW()
     WHERE "id" = $1
       AND "isActive" = true
       AND (
         "status" <> 'VERIFIED'::"SiteStatus"
         OR "verifiedAt" IS NULL
       )
     RETURNING "id", "projectId", "origin", "label", "verifiedAt"`,
    [siteId]
  );
  return row ? normalizeVerifiedSiteRow(row) : null;
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
  originAliases: string[];
  label: string;
  notes: string | null;
  baseSlug: string;
  siteLimit: number | null;
}) {
  return withAuthTransaction<WorkspaceSiteWriteResult>(async (tx) => {
    const candidateOrigins = Array.from(
      new Set(
        (Array.isArray(args.originAliases) && args.originAliases.length ? args.originAliases : [args.origin])
          .map((origin) => String(origin || "").trim())
          .filter(Boolean)
      )
    );

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
         AND "origin" = ANY($2::text[])
       LIMIT 1`,
      [args.projectId, candidateOrigins]
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
           AND "origin" = ANY($2::text[])
         LIMIT 1`,
        [args.projectId, candidateOrigins]
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
               AND "origin" = ANY($2::text[])
             LIMIT 1`,
            [args.projectId, candidateOrigins]
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
  const uniqueOrigins = Array.from(
    new Set(
      origins
        .flatMap((origin) => {
          const trimmed = String(origin || "").trim();
          if (!trimmed) return [];
          try {
            return expandRelatedExactOrigins(trimmed);
          } catch {
            return [trimmed];
          }
        })
        .filter(Boolean)
    )
  );
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

export async function createProjectNoticeEntry(args: {
  projectId: number;
  tone: "GOOD" | "WATCH" | "BAD";
  title: string;
  body: string;
}) {
  await getAuthPool().query(
    `INSERT INTO "ProjectNotice" (
       "id",
       "projectId",
       "tone",
       "title",
       "body",
       "createdAt"
     )
     VALUES ($1, $2, $3::"NoticeTone", $4, $5, NOW())`,
    [newDbId(), args.projectId, args.tone, args.title, args.body]
  );
}

export async function createProjectNotice(projectId: number, origin: string) {
  await createProjectNoticeEntry({
    projectId,
    tone: "GOOD",
    title: "Website added",
    body: `${origin} is now under this workspace.`,
  });
}

export async function removeWorkspaceSite(args: {
  projectId: number;
  accountId: string;
  siteId: string;
  mode: WorkspaceSiteRemovalMode;
  operatorUserId: string | null;
}) {
  return withAuthTransaction<WorkspaceSiteRemovalResult>(async (tx) => {
    const project = await queryOne<RawOwnedProjectDeletionRow>(
      tx,
      `SELECT "id", "accountId", "topSiteId", "retentionDays"
       FROM "Project"
       WHERE "id" = $1
         AND "accountId" = $2
       LIMIT 1
       FOR UPDATE`,
      [args.projectId, args.accountId]
    );
    if (!project) {
      throw new Error("PROJECT_NOT_FOUND");
    }

    const site = await queryOne<RawWorkspaceSiteRow>(
      tx,
      `SELECT "id", "label", "origin", "createdAt"
       FROM "Site"
       WHERE "id" = $1
         AND "projectId" = $2
         AND "isActive" = true
       LIMIT 1
       FOR UPDATE`,
      [args.siteId, args.projectId]
    );
    if (!site) {
      throw new Error("SITE_NOT_FOUND");
    }

    await tx.query(
      `UPDATE "Site"
       SET "isActive" = false,
           "status" = 'SUSPENDED'::"SiteStatus",
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [args.siteId]
    );

    const projectTopSiteId = project.topSiteId == null ? null : String(project.topSiteId);
    let nextTopSiteId = projectTopSiteId;
    if (projectTopSiteId === args.siteId) {
      const nextTop = await queryOne<{ id: string }>(
        tx,
        `SELECT "id"
         FROM "Site"
         WHERE "projectId" = $1
           AND "isActive" = true
           AND "id" <> $2
         ORDER BY "createdAt" ASC
         LIMIT 1`,
        [args.projectId, args.siteId]
      );
      nextTopSiteId = nextTop?.id ? String(nextTop.id) : null;
      await tx.query(
        `UPDATE "Project"
         SET "topSiteId" = $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [args.projectId, nextTopSiteId]
      );
    }

    const retentionDays = Math.max(1, toInt(project.retentionDays) || DEFAULT_SITE_RETENTION_DAYS);
    const now = new Date();
    const purgeScheduledAt = args.mode === "SAFE" ? retentionDateFromNow(retentionDays) : now;
    const purgedAt = args.mode === "DESTRUCTIVE" ? now : null;
    const status = args.mode === "SAFE" ? "SCHEDULED" : "PURGED";
    const metaJson = JSON.stringify({
      retentionDays,
      requestedAt: now.toISOString(),
    });

    await tx.query(
      `INSERT INTO "SiteDeletion" (
         "id",
         "siteId",
         "projectId",
         "accountId",
         "operatorUserId",
         "mode",
         "status",
         "requestedAt",
         "purgeScheduledAt",
         "purgedAt",
         "origin",
         "metaJson",
         "retentionDays"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6::"SiteDeletionMode",
         $7::"SiteDeletionStatus",
         $8,
         $9,
         $10,
         $11,
         $12::jsonb,
         $13
       )
       ON CONFLICT ("siteId") DO UPDATE
       SET "projectId" = EXCLUDED."projectId",
           "accountId" = EXCLUDED."accountId",
           "operatorUserId" = EXCLUDED."operatorUserId",
           "mode" = EXCLUDED."mode",
           "status" = EXCLUDED."status",
           "requestedAt" = EXCLUDED."requestedAt",
           "purgeScheduledAt" = EXCLUDED."purgeScheduledAt",
           "purgedAt" = EXCLUDED."purgedAt",
           "origin" = EXCLUDED."origin",
           "metaJson" = EXCLUDED."metaJson",
           "retentionDays" = EXCLUDED."retentionDays"`,
      [
        newDbId(),
        args.siteId,
        args.projectId,
        String(project.accountId),
        args.operatorUserId,
        args.mode,
        status,
        now,
        purgeScheduledAt,
        purgedAt,
        String(site.origin),
        metaJson,
        retentionDays,
      ]
    );

    return {
      siteId: String(site.id),
      origin: String(site.origin),
      label: String(site.label),
      nextTopSiteId,
      retentionDays,
      purgeScheduledAt: args.mode === "SAFE" ? purgeScheduledAt : null,
    };
  });
}

export async function restoreWorkspaceSite(args: {
  projectId: number;
  accountId: string;
  siteId: string;
}) {
  return withAuthTransaction<WorkspaceSiteRestoreResult>(async (tx) => {
    const project = await queryOne<{ id: number | string; topSiteId: string | null }>(
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
      throw new Error("PROJECT_NOT_FOUND");
    }

    const site = await queryOne<RawWorkspaceSiteOriginRow>(
      tx,
      `SELECT "id", "origin"
       FROM "Site"
       WHERE "id" = $1
         AND "projectId" = $2
       LIMIT 1
       FOR UPDATE`,
      [args.siteId, args.projectId]
    );
    if (!site) {
      throw new Error("SITE_NOT_FOUND");
    }

    const deletion = await queryOne<{ id: string }>(
      tx,
      `SELECT "id"
       FROM "SiteDeletion"
       WHERE "siteId" = $1
         AND "projectId" = $2
         AND "status" = 'SCHEDULED'::"SiteDeletionStatus"
         AND "purgeScheduledAt" > NOW()
       ORDER BY "requestedAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [args.siteId, args.projectId]
    );
    if (!deletion?.id) {
      throw new Error("DELETION_NOT_FOUND");
    }

    const restoredAt = new Date();
    await tx.query(
      `UPDATE "Site"
       SET "isActive" = true,
           "status" = 'VERIFIED'::"SiteStatus",
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [args.siteId]
    );

    if (!project.topSiteId) {
      await tx.query(
        `UPDATE "Project"
         SET "topSiteId" = $2,
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [args.projectId, args.siteId]
      );
    }

    await tx.query(
      `UPDATE "SiteDeletion"
       SET "status" = 'RESTORED'::"SiteDeletionStatus",
           "purgeScheduledAt" = NULL,
           "purgedAt" = $2,
           "metaJson" = COALESCE("metaJson", '{}'::jsonb) || jsonb_build_object('restoredAt', $3::text)
       WHERE "id" = $1`,
      [String(deletion.id), restoredAt, restoredAt.toISOString()]
    );

    return {
      siteId: String(site.id),
      origin: String(site.origin),
      restoredAt,
    };
  });
}
