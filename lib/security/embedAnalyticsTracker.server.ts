import "server-only";

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getLatestPackWithHistory } from "@/lib/cavai/packs.server";
import { newDbId, withAuthTransaction } from "@/lib/authDb";
import { requestInitialSiteScanBestEffort } from "@/lib/scanner";
import { payloadContainsWarmTelemetry, recordWebVitalsSamplesBestEffort } from "@/lib/webVitals.server";
import { markWorkspaceSiteVerified } from "@/lib/workspaceSites.server";

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REACTIVATION_WINDOW_MS = 30 * DEDUPE_WINDOW_MS;
const BEST_EFFORT_TIMEOUT_MS = 1_500;

type Queryable = {
  query: <T = unknown>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

type RawInstallRow = {
  id: string;
  lastSeenAt: Date | string | null;
  lastNotifiedAt: Date | string | null;
};

function hashValue(value?: string | null) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

function pickRequestIp(req: NextRequest) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

function pickUserAgent(req: NextRequest) {
  return req.headers.get("user-agent") || null;
}

function asDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function trimOrNull(value: string | null | undefined, maxLen: number) {
  const normalized = String(value || "").trim().slice(0, maxLen);
  return normalized || null;
}

async function queryOne<T>(queryable: Queryable, text: string, values: unknown[] = []) {
  const result = await queryable.query<T>(text, values);
  return result.rows[0] ?? null;
}

async function runBoundedBestEffort<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
  timeoutMs = BEST_EFFORT_TIMEOUT_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      work(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[embed/analytics] ${label} timed out`);
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`[embed/analytics] ${label} failed`, error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordAnalyticsEmbedActivity(args: {
  req: NextRequest;
  accountId: string;
  projectId: number;
  siteId: string;
  origin: string;
  siteOrigin: string;
  keyLast4?: string | null;
}) {
  const now = new Date();
  const nowMs = now.getTime();
  const ipHash = hashValue(pickRequestIp(args.req));
  const uaHash = hashValue(pickUserAgent(args.req));
  const sdkVersion = trimOrNull(args.req.headers.get("x-cavbot-sdk-version"), 64) || "analytics-v5";
  const appEnv = trimOrNull(args.req.headers.get("x-cavbot-env"), 64);
  const dedupeKey = `analytics:${args.siteId}:${args.origin}`;

  await withAuthTransaction(async (tx) => {
    const existingInstall = await queryOne<RawInstallRow>(
      tx,
      `SELECT "id", "lastSeenAt", "lastNotifiedAt"
       FROM "EmbedInstall"
       WHERE "siteId" = $1
         AND "origin" = $2
         AND "kind" = 'ANALYTICS'::"EmbedInstallKind"
         AND "widgetType" IS NULL
       ORDER BY "lastSeenAt" DESC NULLS LAST, "createdAt" DESC
       LIMIT 1
       FOR UPDATE`,
      [args.siteId, args.origin]
    );

    const lastSeenAt = asDate(existingInstall?.lastSeenAt);
    const lastNotifiedAt = asDate(existingInstall?.lastNotifiedAt);
    const firstDetected = !existingInstall;
    const reactivated =
      lastSeenAt instanceof Date &&
      nowMs - lastSeenAt.getTime() >= REACTIVATION_WINDOW_MS;
    let shouldNotify =
      (firstDetected || reactivated) &&
      !(lastNotifiedAt instanceof Date && nowMs - lastNotifiedAt.getTime() < DEDUPE_WINDOW_MS);

    if (shouldNotify) {
      const recentNotice = await queryOne<{ id: string }>(
        tx,
        `SELECT "id"
         FROM "WorkspaceNotice"
         WHERE "dedupeKey" = $1
           AND "createdAt" >= $2
         LIMIT 1`,
        [dedupeKey, new Date(nowMs - DEDUPE_WINDOW_MS)]
      );
      if (recentNotice?.id) {
        shouldNotify = false;
      }
    }

    let installId = existingInstall?.id ?? null;
    if (existingInstall?.id) {
      await tx.query(
        `UPDATE "EmbedInstall"
         SET "style" = $2,
             "position" = $3,
             "lastSeenAt" = $4,
             "lastSeenIpHash" = $5,
             "lastUserAgentHash" = $6,
             "seenCount" = "seenCount" + 1,
             "status" = 'ACTIVE'::"EmbedInstallStatus",
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        [existingInstall.id, sdkVersion, appEnv, now, ipHash, uaHash]
      );
    } else {
      installId = newDbId();
      await tx.query(
        `INSERT INTO "EmbedInstall" (
           "id",
           "accountId",
           "projectId",
           "siteId",
           "origin",
           "kind",
           "widgetType",
           "style",
           "position",
           "theme",
           "firstSeenAt",
           "lastSeenAt",
           "lastSeenIpHash",
           "lastUserAgentHash",
           "seenCount",
           "status",
           "createdAt",
           "updatedAt"
         )
         VALUES (
           $1,
           $2,
           $3,
           $4,
           $5,
           'ANALYTICS'::"EmbedInstallKind",
           NULL,
           $6,
           $7,
           NULL,
           $8,
           $8,
           $9,
           $10,
           1,
           'ACTIVE'::"EmbedInstallStatus",
           NOW(),
           NOW()
         )`,
        [
          installId,
          args.accountId,
          args.projectId,
          args.siteId,
          args.origin,
          sdkVersion,
          appEnv,
          now,
          ipHash,
          uaHash,
        ]
      );
    }

    if (!shouldNotify || !installId) return;

    const meta = {
      origin: args.origin,
      siteId: args.siteId,
      siteOrigin: args.siteOrigin,
      sdkVersion,
      appEnv,
      verificationMethod: "analytics_ingest",
      ...(args.keyLast4 ? { keyLast4: args.keyLast4 } : {}),
    };
    const metaJson = JSON.stringify(meta);

    await tx.query(
      `INSERT INTO "WorkspaceNotice" (
         "id",
         "accountId",
         "projectId",
         "siteId",
         "tone",
         "title",
         "body",
         "createdAt",
         "meta",
         "dedupeKey"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         'GOOD'::"NoticeTone",
         $5,
         $6,
         NOW(),
         $7::jsonb,
         $8
       )`,
      [
        newDbId(),
        args.accountId,
        args.projectId,
        args.siteId,
        "Analytics detected",
        `Analytics pipeline connected · ${args.origin}`,
        metaJson,
        dedupeKey,
      ]
    );

    await tx.query(
      `INSERT INTO "SiteEvent" (
         "id",
         "siteId",
         "type",
         "message",
         "tone",
         "meta",
         "createdAt"
       )
       VALUES (
         $1,
         $2,
         $3,
         $4,
         'GOOD'::"NoticeTone",
         $5::jsonb,
         NOW()
       )`,
      [
        newDbId(),
        args.siteId,
        "INTEGRATION_CONNECTED",
        "Analytics pipeline connected",
        metaJson,
      ]
    );

    await tx.query(
      `UPDATE "EmbedInstall"
       SET "lastNotifiedAt" = $2,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      [installId, now]
    );
  });
}

export async function recordAnalyticsEmbedActivityBestEffort(args: {
  req: NextRequest;
  accountId: string;
  projectId: number;
  siteId: string;
  origin: string;
  siteOrigin: string;
  payload?: Record<string, unknown> | null;
  keyLast4?: string | null;
}) {
  const [, , verified] = await Promise.all([
    runBoundedBestEffort("local activity tracking", () => recordAnalyticsEmbedActivity(args), undefined),
    runBoundedBestEffort(
      "vitals capture",
      () =>
        recordWebVitalsSamplesBestEffort({
          siteId: args.siteId,
          siteOrigin: args.siteOrigin,
          payload: args.payload,
        }),
      0,
    ),
    runBoundedBestEffort(
      "site verification promotion",
      () => markWorkspaceSiteVerified(args.siteId),
      null,
    ),
  ]);

  if (!payloadContainsWarmTelemetry(args.payload)) return;

  const hasPack = await runBoundedBestEffort(
    "pack lookup",
    async () => {
      const result = await getLatestPackWithHistory({
        accountId: args.accountId,
        origin: args.siteOrigin,
        limit: 1,
      });
      return Boolean(result.pack);
    },
    false,
  );

  if (hasPack) return;

  await runBoundedBestEffort(
    "telemetry warm scan queue",
    () =>
      requestInitialSiteScanBestEffort({
        projectId: args.projectId,
        siteId: verified?.id || args.siteId,
        accountId: args.accountId,
        operatorUserId: null,
        ip: pickRequestIp(args.req),
        userAgent: pickUserAgent(args.req),
        reason: "Telemetry warm scan",
      }),
    { queued: false, reason: "timed_out" as const },
  );
}
