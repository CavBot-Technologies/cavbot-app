import "server-only";

import { getAuthPool } from "@/lib/authDb";

type RawEmbedInstallRow = {
  kind: string;
  widgetType: string | null;
  style: string | null;
  origin: string;
  firstSeenAt: Date | string;
  lastSeenAt: Date | string;
  status: string;
  seenCount: number | string;
};

export type SiteInstallStateRecord = {
  kind: string;
  widgetType: string | null;
  style: string | null;
  origin: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: string;
  seenCount: number;
};

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function toInt(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function normalizeInstallRow(row: RawEmbedInstallRow): SiteInstallStateRecord {
  return {
    kind: String(row.kind || "").trim(),
    widgetType: row.widgetType ? String(row.widgetType).trim() : null,
    style: row.style ? String(row.style).trim() : null,
    origin: String(row.origin || "").trim(),
    firstSeenAt: toDate(row.firstSeenAt),
    lastSeenAt: toDate(row.lastSeenAt),
    status: String(row.status || "").trim(),
    seenCount: toInt(row.seenCount),
  };
}

export async function listSiteInstallState(args: {
  accountId: string;
  siteId: string;
}) {
  const result = await getAuthPool().query<RawEmbedInstallRow>(
    `SELECT
       "kind",
       "widgetType",
       "style",
       "origin",
       "firstSeenAt",
       "lastSeenAt",
       "status",
       "seenCount"
     FROM "EmbedInstall"
     WHERE "siteId" = $1
       AND "accountId" = $2
       AND "kind" IN ('WIDGET'::"EmbedInstallKind", 'ARCADE'::"EmbedInstallKind")
     ORDER BY "lastSeenAt" DESC`,
    [args.siteId, args.accountId],
  );

  return result.rows.map(normalizeInstallRow);
}
