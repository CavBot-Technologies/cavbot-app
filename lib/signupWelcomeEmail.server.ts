import pg from "pg";
import { randomUUID } from "crypto";
import { Resend } from "resend";
import { getAuthPool, newDbId } from "@/lib/authDb";

type Queryable = {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<T>>;
};

export const DEFAULT_SIGNUP_WELCOME_TEMPLATE_ALIAS = "cavbot-sign-up";
export const DEFAULT_SIGNUP_WELCOME_TEMPLATE_ID = "59f44d4a-f71a-400e-89a2-fd0372b9d725";
export const DEFAULT_SIGNUP_WELCOME_MAIL_FROM =
  "Cavendish Pierre-Louis <cavendishpierrelouis@cavbot.io>";
export const DEFAULT_SIGNUP_WELCOME_REPLY_TO =
  "CavBot Support <support@cavbot.io>";
export const DEFAULT_SIGNUP_WELCOME_SUBJECT = "Welcome to CavBot!";
const PROCESSING_STALE_WINDOW_MS = 10 * 60 * 1000;

export type SignupWelcomeSendSource =
  | "register"
  | "google_oauth"
  | "github_oauth"
  | "backfill"
  | "adhoc_test";

export type SignupWelcomeRecipient = {
  userId: string;
  email: string;
  source: SignupWelcomeSendSource;
};

export type SignupWelcomeMailConfig = {
  apiKey: string;
  templateAlias: string;
  templateIdFallback: string;
  from: string;
  replyTo: string;
  subject: string;
  staleWindowMs: number;
};

type BeginAttemptArgs = {
  userId: string;
  email: string;
  templateRef: string;
  staleWindowMs: number;
};

type BeginAttemptResult =
  | {
      shouldSend: true;
      processingToken: string;
    }
  | {
      shouldSend: false;
      reason: "already_sent" | "in_progress";
    };

export type SignupWelcomeSendResult =
  | {
      ok: true;
      status: "sent";
      resendMessageId: string | null;
      templateRef: string;
      templateId: string;
    }
  | {
      ok: true;
      status: "skipped";
      reason: "already_sent" | "in_progress";
    }
  | {
      ok: false;
      status: "failed";
      reason: string;
    };

export type SignupWelcomeBackfillArgs = {
  limit?: number;
  dryRun?: boolean;
  onlyFailed?: boolean;
  email?: string | null;
  userId?: string | null;
};

export type SignupWelcomeBackfillResult = {
  dryRun: boolean;
  examined: number;
  sent: number;
  skipped: number;
  failed: number;
  results: Array<{
    userId: string;
    email: string;
    status: "sent" | "skipped" | "failed" | "dry_run";
    reason?: string;
    resendMessageId?: string | null;
  }>;
};

type TransportArgs = {
  config: SignupWelcomeMailConfig;
  recipient: SignupWelcomeRecipient;
  idempotencyKey: string;
};

type TransportResult =
  | {
      ok: true;
      resendMessageId: string | null;
      templateRef: string;
      templateId: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface SignupWelcomeStore {
  beginAttempt(args: BeginAttemptArgs): Promise<BeginAttemptResult>;
  markSent(args: {
    userId: string;
    processingToken: string;
    resendMessageId: string | null;
    templateRef: string;
  }): Promise<void>;
  markFailed(args: {
    userId: string;
    processingToken: string;
    failureReason: string;
  }): Promise<void>;
  listBackfillCandidates(args: {
    limit: number;
    email?: string | null;
    userId?: string | null;
    onlyFailed?: boolean;
    staleWindowMs: number;
  }): Promise<Array<Pick<SignupWelcomeRecipient, "userId" | "email">>>;
}

function envValue(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
): string {
  return String(source[name] || "").trim();
}

export function resolveSignupWelcomeMailConfig(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SignupWelcomeMailConfig {
  const templateAlias = envValue(source, "RESEND_SIGNUP_TEMPLATE_ALIAS");
  const templateId = envValue(source, "RESEND_SIGNUP_TEMPLATE_ID");

  return {
    apiKey: envValue(source, "RESEND_SIGNUP_API_KEY"),
    templateAlias: templateAlias || DEFAULT_SIGNUP_WELCOME_TEMPLATE_ALIAS,
    templateIdFallback: templateId || DEFAULT_SIGNUP_WELCOME_TEMPLATE_ID,
    from: envValue(source, "CAVBOT_SIGNUP_MAIL_FROM") || DEFAULT_SIGNUP_WELCOME_MAIL_FROM,
    replyTo: envValue(source, "CAVBOT_SIGNUP_REPLY_TO") || DEFAULT_SIGNUP_WELCOME_REPLY_TO,
    subject: envValue(source, "CAVBOT_SIGNUP_WELCOME_SUBJECT") || DEFAULT_SIGNUP_WELCOME_SUBJECT,
    staleWindowMs: PROCESSING_STALE_WINDOW_MS,
  };
}

export function buildSignupWelcomeIdempotencyKey(userId: string) {
  return `signup-welcome:${userId}`;
}

function toFailureReason(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "signup_welcome_send_failed");
}

function logSignupWelcome(level: "warn" | "error" | "info", message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : "";
  if (level === "warn") {
    console.warn(`[signup][welcome] ${message}${payload}`);
    return;
  }
  if (level === "info") {
    console.info(`[signup][welcome] ${message}${payload}`);
    return;
  }
  console.error(`[signup][welcome] ${message}${payload}`);
}

async function deliverSignupWelcomeViaResend(args: TransportArgs): Promise<TransportResult> {
  const resend = new Resend(args.config.apiKey);
  const attempts: Array<{ templateId: string; templateRef: string; label: string }> = [];
  const alias = args.config.templateAlias.trim();
  const fallbackId = args.config.templateIdFallback.trim();

  if (alias) {
    try {
      const template = await resend.templates.get(alias);
      if (template.data?.id) {
        attempts.push({
          templateId: template.data.id,
          templateRef: alias,
          label: "alias_lookup",
        });
      }
    } catch {}

    attempts.push({
      templateId: alias,
      templateRef: alias,
      label: "alias_direct",
    });
  }

  if (fallbackId) {
    attempts.push({
      templateId: fallbackId,
      templateRef: fallbackId,
      label: "id_fallback",
    });
  }

  const seen = new Set<string>();
  const candidates = attempts.filter((entry) => {
    const key = `${entry.templateId}:${entry.templateRef}`;
    if (!entry.templateId || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const errors: string[] = [];

  for (const candidate of candidates) {
    const response = await resend.emails.send(
      {
        to: args.recipient.email,
        from: args.config.from,
        replyTo: args.config.replyTo,
        subject: args.config.subject,
        template: {
          id: candidate.templateId,
        },
        tags: [
          { name: "flow", value: "signup_welcome" },
          { name: "source", value: args.recipient.source },
        ],
      },
      {
        idempotencyKey: args.idempotencyKey,
      },
    );

    if (!response.error) {
      return {
        ok: true,
        resendMessageId: response.data?.id ?? null,
        templateRef: candidate.templateRef,
        templateId: candidate.templateId,
      };
    }

    errors.push(`${candidate.label}:${response.error.name}:${response.error.message}`);
  }

  return {
    ok: false,
    error: errors.join(" | ") || "signup_welcome_send_failed",
  };
}

export function createPgSignupWelcomeStore(queryable: Queryable = getAuthPool()): SignupWelcomeStore {
  return {
    async beginAttempt(args) {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - Math.max(args.staleWindowMs, 60_000));
      const processingToken = randomUUID();

      const inserted = await queryable.query<{ id: string }>(
        `INSERT INTO "SignupWelcomeEmail" (
            "id",
            "userId",
            "email",
            "templateRef",
            "status",
            "attemptCount",
            "lastAttemptedAt",
            "processingStartedAt",
            "processingToken",
            "createdAt",
            "updatedAt"
          ) VALUES ($1, $2, $3, $4, 'PROCESSING', 1, $5, $5, $6, NOW(), NOW())
          ON CONFLICT ("userId") DO NOTHING
          RETURNING "id"`,
        [newDbId(), args.userId, args.email, args.templateRef, now, processingToken],
      );

      if (inserted.rows[0]?.id) {
        return {
          shouldSend: true,
          processingToken,
        };
      }

      const claimed = await queryable.query<{ id: string }>(
        `UPDATE "SignupWelcomeEmail"
          SET "email" = $2,
              "templateRef" = $3,
              "status" = 'PROCESSING',
              "attemptCount" = "attemptCount" + 1,
              "lastAttemptedAt" = $4,
              "processingStartedAt" = $4,
              "processingToken" = $5,
              "failureReason" = NULL,
              "updatedAt" = NOW()
          WHERE "userId" = $1
            AND "sentAt" IS NULL
            AND (
              "status" <> 'PROCESSING'
              OR "processingStartedAt" IS NULL
              OR "processingStartedAt" < $6
            )
          RETURNING "id"`,
        [args.userId, args.email, args.templateRef, now, processingToken, staleBefore],
      );

      if (claimed.rows[0]?.id) {
        return {
          shouldSend: true,
          processingToken,
        };
      }

      const existing = await queryable.query<{
        sentAt: string | Date | null;
      }>(
        `SELECT "sentAt"
          FROM "SignupWelcomeEmail"
          WHERE "userId" = $1
          LIMIT 1`,
        [args.userId],
      );

      if (existing.rows[0]?.sentAt) {
        return {
          shouldSend: false,
          reason: "already_sent",
        };
      }

      return {
        shouldSend: false,
        reason: "in_progress",
      };
    },

    async markSent(args) {
      await queryable.query(
        `UPDATE "SignupWelcomeEmail"
          SET "status" = 'SENT',
              "sentAt" = COALESCE("sentAt", NOW()),
              "templateRef" = COALESCE($4, "templateRef"),
              "resendMessageId" = COALESCE($3, "resendMessageId"),
              "failureReason" = NULL,
              "processingToken" = NULL,
              "processingStartedAt" = NULL,
              "updatedAt" = NOW()
          WHERE "userId" = $1
            AND "processingToken" = $2`,
        [args.userId, args.processingToken, args.resendMessageId, args.templateRef],
      );
    },

    async markFailed(args) {
      await queryable.query(
        `UPDATE "SignupWelcomeEmail"
          SET "status" = 'FAILED',
              "failureReason" = $3,
              "processingToken" = NULL,
              "processingStartedAt" = NULL,
              "updatedAt" = NOW()
          WHERE "userId" = $1
            AND "processingToken" = $2`,
        [args.userId, args.processingToken, args.failureReason],
      );
    },

    async listBackfillCandidates(args) {
      const safeLimit = Number.isFinite(args.limit) ? Math.max(0, Math.min(args.limit, 500)) : 100;
      if (!safeLimit) return [];

      const staleBefore = new Date(Date.now() - Math.max(args.staleWindowMs, 60_000));

      const result = await queryable.query<{
        userId: string;
        email: string;
      }>(
        `SELECT
            u."id" AS "userId",
            u."email" AS "email"
          FROM "User" u
          LEFT JOIN "SignupWelcomeEmail" swe
            ON swe."userId" = u."id"
          WHERE ($1::text IS NULL OR lower(u."email") = lower($1))
            AND ($2::text IS NULL OR u."id" = $2)
            AND (swe."userId" IS NULL OR swe."sentAt" IS NULL)
            AND ($3::boolean = false OR swe."status" = 'FAILED')
            AND (
              swe."status" IS DISTINCT FROM 'PROCESSING'
              OR swe."processingStartedAt" IS NULL
              OR swe."processingStartedAt" < $4
            )
          ORDER BY COALESCE(swe."lastAttemptedAt", u."createdAt") ASC, u."createdAt" ASC
          LIMIT $5`,
        [args.email || null, args.userId || null, Boolean(args.onlyFailed), staleBefore, safeLimit],
      );

      return result.rows.map((row) => ({
        userId: row.userId,
        email: row.email,
      }));
    },
  };
}

export async function sendSignupWelcomeEmailWithStore(
  store: SignupWelcomeStore,
  recipient: SignupWelcomeRecipient,
  options: {
    config?: SignupWelcomeMailConfig;
    transport?: (args: TransportArgs) => Promise<TransportResult>;
  } = {},
): Promise<SignupWelcomeSendResult> {
  const config = options.config || resolveSignupWelcomeMailConfig();
  const transport = options.transport || deliverSignupWelcomeViaResend;

  const begin = await store.beginAttempt({
    userId: recipient.userId,
    email: recipient.email,
    templateRef: config.templateAlias || config.templateIdFallback || DEFAULT_SIGNUP_WELCOME_TEMPLATE_ALIAS,
    staleWindowMs: config.staleWindowMs,
  });

  if (!begin.shouldSend) {
    return {
      ok: true,
      status: "skipped",
      reason: begin.reason,
    };
  }

  if (!config.apiKey) {
    const reason = "missing_signup_resend_api_key";
    await store.markFailed({
      userId: recipient.userId,
      processingToken: begin.processingToken,
      failureReason: reason,
    });
    logSignupWelcome("warn", "Signup welcome email skipped because RESEND_SIGNUP_API_KEY is missing.", {
      userId: recipient.userId,
      source: recipient.source,
    });
    return {
      ok: false,
      status: "failed",
      reason,
    };
  }

  try {
    const delivered = await transport({
      config,
      recipient,
      idempotencyKey: buildSignupWelcomeIdempotencyKey(recipient.userId),
    });

    if (!delivered.ok) {
      await store.markFailed({
        userId: recipient.userId,
        processingToken: begin.processingToken,
        failureReason: delivered.error,
      });
      logSignupWelcome("error", "Signup welcome email delivery failed.", {
        userId: recipient.userId,
        source: recipient.source,
        reason: delivered.error,
      });
      return {
        ok: false,
        status: "failed",
        reason: delivered.error,
      };
    }

    await store.markSent({
      userId: recipient.userId,
      processingToken: begin.processingToken,
      resendMessageId: delivered.resendMessageId,
      templateRef: delivered.templateRef,
    });

    return {
      ok: true,
      status: "sent",
      resendMessageId: delivered.resendMessageId,
      templateRef: delivered.templateRef,
      templateId: delivered.templateId,
    };
  } catch (error) {
    const reason = toFailureReason(error);
    await store.markFailed({
      userId: recipient.userId,
      processingToken: begin.processingToken,
      failureReason: reason,
    });
    logSignupWelcome("error", "Signup welcome email delivery threw.", {
      userId: recipient.userId,
      source: recipient.source,
      reason,
    });
    return {
      ok: false,
      status: "failed",
      reason,
    };
  }
}

export async function sendSignupWelcomeEmail(
  recipient: SignupWelcomeRecipient,
  options: {
    config?: SignupWelcomeMailConfig;
    transport?: (args: TransportArgs) => Promise<TransportResult>;
  } = {},
) {
  return sendSignupWelcomeEmailWithStore(
    createPgSignupWelcomeStore(),
    recipient,
    options,
  );
}

export async function sendAdHocSignupWelcomeEmail(
  to: string,
  options: {
    config?: SignupWelcomeMailConfig;
    transport?: (args: TransportArgs) => Promise<TransportResult>;
  } = {},
) {
  const config = options.config || resolveSignupWelcomeMailConfig();
  const transport = options.transport || deliverSignupWelcomeViaResend;

  if (!config.apiKey) {
    return {
      ok: false as const,
      error: "missing_signup_resend_api_key",
    };
  }

  return transport({
    config,
    recipient: {
      userId: `adhoc:${to.toLowerCase()}`,
      email: to,
      source: "adhoc_test",
    },
    idempotencyKey: `signup-welcome-adhoc:${to.toLowerCase()}`,
  });
}

export async function backfillSignupWelcomeEmailsWithStore(
  store: SignupWelcomeStore,
  args: SignupWelcomeBackfillArgs = {},
  options: {
    config?: SignupWelcomeMailConfig;
    transport?: (args: TransportArgs) => Promise<TransportResult>;
  } = {},
): Promise<SignupWelcomeBackfillResult> {
  const config = options.config || resolveSignupWelcomeMailConfig();
  const candidates = await store.listBackfillCandidates({
    limit: args.limit ?? 100,
    email: args.email || null,
    userId: args.userId || null,
    onlyFailed: Boolean(args.onlyFailed),
    staleWindowMs: config.staleWindowMs,
  });

  const results: SignupWelcomeBackfillResult["results"] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  if (args.dryRun) {
    for (const candidate of candidates) {
      results.push({
        userId: candidate.userId,
        email: candidate.email,
        status: "dry_run",
      });
    }
    return {
      dryRun: true,
      examined: candidates.length,
      sent,
      skipped,
      failed,
      results,
    };
  }

  for (const candidate of candidates) {
    const result = await sendSignupWelcomeEmailWithStore(
      store,
      {
        ...candidate,
        source: "backfill",
      },
      options,
    );

    if (result.ok && result.status === "sent") {
      sent += 1;
      results.push({
        userId: candidate.userId,
        email: candidate.email,
        status: "sent",
        resendMessageId: result.resendMessageId,
      });
      continue;
    }

    if (result.ok && result.status === "skipped") {
      skipped += 1;
      results.push({
        userId: candidate.userId,
        email: candidate.email,
        status: "skipped",
        reason: result.reason,
      });
      continue;
    }

    failed += 1;
    results.push({
      userId: candidate.userId,
      email: candidate.email,
      status: "failed",
      reason: result.reason,
    });
  }

  return {
    dryRun: false,
    examined: candidates.length,
    sent,
    skipped,
    failed,
    results,
  };
}

export async function backfillSignupWelcomeEmails(
  args: SignupWelcomeBackfillArgs = {},
  options: {
    config?: SignupWelcomeMailConfig;
    transport?: (args: TransportArgs) => Promise<TransportResult>;
  } = {},
) {
  return backfillSignupWelcomeEmailsWithStore(
    createPgSignupWelcomeStore(),
    args,
    options,
  );
}
