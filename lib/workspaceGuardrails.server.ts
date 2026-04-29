import "server-only";

import type pg from "pg";

import { getAuthPool, withAuthTransaction } from "@/lib/authDb";

type GuardrailKey =
  | "blockUnknownOrigins"
  | "enforceAllowlist"
  | "alertOn404Spike"
  | "alertOnJsSpike"
  | "strictDeletion";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

type RawGuardrailsRow = {
  blockUnknownOrigins: boolean;
  enforceAllowlist: boolean;
  alertOn404Spike: boolean;
  alertOnJsSpike: boolean;
  strictDeletion: boolean;
};

export type WorkspaceProjectGuardrails = Record<GuardrailKey, boolean>;

const DEFAULT_GUARDRAILS: WorkspaceProjectGuardrails = {
  blockUnknownOrigins: true,
  enforceAllowlist: true,
  alertOn404Spike: true,
  alertOnJsSpike: true,
  strictDeletion: true,
};

async function queryOne<T extends pg.QueryResultRow>(
  queryable: Queryable,
  text: string,
  values: unknown[] = [],
) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

function normalizeGuardrails(row: RawGuardrailsRow | null | undefined): WorkspaceProjectGuardrails {
  return {
    blockUnknownOrigins: row?.blockUnknownOrigins ?? DEFAULT_GUARDRAILS.blockUnknownOrigins,
    enforceAllowlist: row?.enforceAllowlist ?? DEFAULT_GUARDRAILS.enforceAllowlist,
    alertOn404Spike: row?.alertOn404Spike ?? DEFAULT_GUARDRAILS.alertOn404Spike,
    alertOnJsSpike: row?.alertOnJsSpike ?? DEFAULT_GUARDRAILS.alertOnJsSpike,
    strictDeletion: row?.strictDeletion ?? DEFAULT_GUARDRAILS.strictDeletion,
  };
}

async function loadGuardrails(queryable: Queryable, projectId: number) {
  const row = await queryOne<RawGuardrailsRow>(
    queryable,
    `SELECT
       "blockUnknownOrigins",
       "enforceAllowlist",
       "alertOn404Spike",
       "alertOnJsSpike",
       "strictDeletion"
     FROM "ProjectGuardrails"
     WHERE "projectId" = $1
     LIMIT 1`,
    [projectId],
  );
  return normalizeGuardrails(row);
}

export async function getWorkspaceProjectGuardrails(projectId: number) {
  const pool = getAuthPool();
  return loadGuardrails(pool, projectId);
}

export async function ensureWorkspaceProjectGuardrails(
  projectId: number,
  patch?: Partial<WorkspaceProjectGuardrails>,
) {
  return withAuthTransaction(async (tx) => {
    const current = await queryOne<RawGuardrailsRow>(
      tx,
      `SELECT
         "blockUnknownOrigins",
         "enforceAllowlist",
         "alertOn404Spike",
         "alertOnJsSpike",
         "strictDeletion"
       FROM "ProjectGuardrails"
       WHERE "projectId" = $1
       LIMIT 1`,
      [projectId],
    );

    const next = {
      ...DEFAULT_GUARDRAILS,
      ...normalizeGuardrails(current),
      ...(patch || {}),
    };

    const values = [
      projectId,
      next.blockUnknownOrigins,
      next.enforceAllowlist,
      next.alertOn404Spike,
      next.alertOnJsSpike,
      next.strictDeletion,
    ];

    await tx.query(
      `INSERT INTO "ProjectGuardrails" (
         "projectId",
         "blockUnknownOrigins",
         "enforceAllowlist",
         "alertOn404Spike",
         "alertOnJsSpike",
         "strictDeletion"
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("projectId") DO UPDATE
       SET "blockUnknownOrigins" = EXCLUDED."blockUnknownOrigins",
           "enforceAllowlist" = EXCLUDED."enforceAllowlist",
           "alertOn404Spike" = EXCLUDED."alertOn404Spike",
           "alertOnJsSpike" = EXCLUDED."alertOnJsSpike",
           "strictDeletion" = EXCLUDED."strictDeletion",
           "updatedAt" = NOW()`,
      values,
    );

    return loadGuardrails(tx, projectId);
  });
}

export function defaultWorkspaceProjectGuardrails() {
  return { ...DEFAULT_GUARDRAILS };
}
