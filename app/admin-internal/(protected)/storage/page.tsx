import { Prisma } from "@prisma/client";

import {
  AdminPage,
  AvatarBadge,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatBytes,
  formatInt,
  formatPercent,
  formatUserHandle,
  getAccountOwners,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { getAccountStorageMap } from "@/lib/admin/storage";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasUsagePointTable(tableName: "CavCloudUsagePoint" | "CavSafeUsagePoint") {
  return prisma.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ${tableName}
    ) AS "exists"
  `);
}

async function readUsageTrendRows(tableName: "CavCloudUsagePoint" | "CavSafeUsagePoint", start: Date, end: Date) {
  try {
    const existsRows = await hasUsagePointTable(tableName);
    if (!existsRows[0]?.exists) return [];

    if (tableName === "CavCloudUsagePoint") {
      return prisma.$queryRaw<Array<{ createdAt: Date; usedBytes: bigint }>>(Prisma.sql`
        SELECT
          DATE_TRUNC('day', "bucketStart")::timestamp AS "createdAt",
          MAX("usedBytes")::bigint AS "usedBytes"
        FROM "CavCloudUsagePoint"
        WHERE "bucketStart" >= ${start}
          AND "bucketStart" < ${end}
        GROUP BY 1
        ORDER BY 1 ASC
      `);
    }

    return prisma.$queryRaw<Array<{ createdAt: Date; usedBytes: bigint }>>(Prisma.sql`
      SELECT
        DATE_TRUNC('day', "bucketStart")::timestamp AS "createdAt",
        MAX("usedBytes")::bigint AS "usedBytes"
      FROM "CavSafeUsagePoint"
      WHERE "bucketStart" >= ${start}
        AND "bucketStart" < ${end}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
  } catch {
    return [];
  }
}

function sharePercent(value: number | bigint, total: number | bigint) {
  const normalizedTotal = Number(total);
  if (!Number.isFinite(normalizedTotal) || normalizedTotal <= 0) return formatPercent(0);
  return formatPercent((Number(value) / normalizedTotal) * 100);
}

export default async function StoragePage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/storage", { scopes: ["accounts.read"] });

  const rawRange = Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range;
  const rawMonth = Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month;
  const range = parseAdminRange(rawRange);
  const month = parseAdminMonth(rawMonth);
  const window = resolveAdminWindow(range, month);
  const start = window.start;
  const end = window.end;
  const rangeLabel = window.label;

  const accounts = await prisma.account.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      updatedAt: true,
    },
  });
  const accountIds = accounts.map((account) => account.id);
  const [owners, storageMap, cloudTrendRows, safeTrendRows] = await Promise.all([
    getAccountOwners(accountIds),
    getAccountStorageMap(accountIds),
    readUsageTrendRows("CavCloudUsagePoint", start, end),
    readUsageTrendRows("CavSafeUsagePoint", start, end),
  ]);

  const rows = accounts.map((account) => {
    const storage = storageMap.get(account.id) || {
      accountId: account.id,
      cloudFiles: 0,
      safeFiles: 0,
      cloudBytes: BigInt(0),
      safeBytes: BigInt(0),
      totalFiles: 0,
      totalBytes: BigInt(0),
      cloudUploadedFiles: 0,
      safeUploadedFiles: 0,
      uploadedFiles: 0,
      cloudDeletedFiles: 0,
      safeDeletedFiles: 0,
      deletedFiles: 0,
    };
    return {
      ...account,
      owner: owners.get(account.id),
      storage,
    };
  });

  const totals = rows.reduce(
    (acc, row) => ({
      cloudFiles: acc.cloudFiles + row.storage.cloudFiles,
      safeFiles: acc.safeFiles + row.storage.safeFiles,
      cloudBytes: acc.cloudBytes + row.storage.cloudBytes,
      safeBytes: acc.safeBytes + row.storage.safeBytes,
      uploadedFiles: acc.uploadedFiles + row.storage.uploadedFiles,
      deletedFiles: acc.deletedFiles + row.storage.deletedFiles,
    }),
    {
      cloudFiles: 0,
      safeFiles: 0,
      cloudBytes: BigInt(0),
      safeBytes: BigInt(0),
      uploadedFiles: 0,
      deletedFiles: 0,
    },
  );

  const totalFiles = totals.cloudFiles + totals.safeFiles;
  const totalBytes = totals.cloudBytes + totals.safeBytes;
  const cloudFileShare = sharePercent(totals.cloudFiles, totalFiles);
  const safeFileShare = sharePercent(totals.safeFiles, totalFiles);
  const cloudByteShare = sharePercent(totals.cloudBytes, totalBytes);
  const safeByteShare = sharePercent(totals.safeBytes, totalBytes);
  const hasLiveCarry = totalFiles > 0 || totals.cloudBytes > BigInt(0) || totals.safeBytes > BigInt(0);
  const carryLeader = !hasLiveCarry
    ? "No live carry yet"
    : totals.cloudBytes === totals.safeBytes
      ? "Balanced"
      : totals.cloudBytes > totals.safeBytes
        ? "CavCloud"
        : "CavSafe";
  const storageTrend = buildAdminTrendPoints(
    cloudTrendRows.map((row) => ({ date: new Date(row.createdAt), value: Number(row.usedBytes || 0) })),
    range,
    month,
  );
  const safeTrend = buildAdminTrendPoints(
    safeTrendRows.map((row) => ({ date: new Date(row.createdAt), value: Number(row.usedBytes || 0) })),
    range,
    month,
  );
  const heaviestAccounts = rows
    .slice()
    .sort((left, right) => {
      const byteDelta = Number(right.storage.totalBytes - left.storage.totalBytes);
      if (byteDelta !== 0) return byteDelta;
      return right.storage.totalFiles - left.storage.totalFiles;
    })
    .slice(0, 8);

  return (
    <AdminPage
      title="Storage"
      subtitle="Real CavBot storage monitoring across CavCloud and CavSafe, including file footprint, live byte load, upload totals, and delete pressure."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Total files" value={formatInt(totalFiles)} meta={`${formatBytes(totalBytes)} live across CavCloud and CavSafe`} />
        <MetricCard label="CavCloud files" value={formatInt(totals.cloudFiles)} meta={`${formatBytes(totals.cloudBytes)} active in CavCloud`} />
        <MetricCard label="CavSafe files" value={formatInt(totals.safeFiles)} meta={`${formatBytes(totals.safeBytes)} active in CavSafe`} />
        <MetricCard label="Files uploaded" value={formatInt(totals.uploadedFiles)} meta="Total persisted file rows created across all workspaces" />
        <MetricCard label="CavCloud load" value={formatBytes(totals.cloudBytes)} meta={`${formatInt(totals.cloudFiles)} files currently carried`} />
        <MetricCard label="CavSafe load" value={formatBytes(totals.safeBytes)} meta={`${formatInt(totals.safeFiles)} files currently carried`} />
        <MetricCard label="Deleted files" value={formatInt(totals.deletedFiles)} meta="All-time trash entries recorded across storage" className="hq-cardDestructiveThin" />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Storage file split"
          subtitle={`Real file-carry comparison between CavCloud and CavSafe across the monitored set, plotted against observed byte load across ${rangeLabel}.`}
          labels={storageTrend.map((row) => row.label)}
          primary={storageTrend.map((row) => row.value)}
          secondary={safeTrend.map((row) => row.value)}
          primaryLabel="CavCloud"
          secondaryLabel="CavSafe"
          primaryTone="lime"
          secondaryTone="orange"
          formatValue={(value) => formatBytes(value)}
          emptyTitle="No stored files yet."
          emptySubtitle="As soon as CavBot starts persisting files into CavCloud or CavSafe, the carry split will render here."
        />

        <Panel
          title="Carry split signals"
          subtitle={`Current live file share, byte share, and dominant carry surface across ${rangeLabel}.`}
        >
          <div className="hq-list">
            <div className="hq-statRow">
              <div>
                <div className="hq-inlineStart">
                  <span className="hq-planShareSwatch" data-tone="trialing" />
                  <div className="hq-statLabel">CavCloud</div>
                </div>
                <div className="hq-statMeta">{cloudFileShare} of live files · {cloudByteShare} of live bytes</div>
              </div>
              <div className="hq-listMeta">{formatInt(totals.cloudFiles)} files · {formatBytes(totals.cloudBytes)}</div>
            </div>

            <div className="hq-statRow">
              <div>
                <div className="hq-inlineStart">
                  <span className="hq-planShareSwatch" data-tone="enterprise" />
                  <div className="hq-statLabel">CavSafe</div>
                </div>
                <div className="hq-statMeta">{safeFileShare} of live files · {safeByteShare} of live bytes</div>
              </div>
              <div className="hq-listMeta">{formatInt(totals.safeFiles)} files · {formatBytes(totals.safeBytes)}</div>
            </div>

            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">Live total</div>
                <div className="hq-statMeta">{formatInt(totals.uploadedFiles)} uploaded · {formatInt(totals.deletedFiles)} deleted all-time</div>
              </div>
              <div className="hq-listMeta">{formatInt(totalFiles)} files · {formatBytes(totalBytes)}</div>
            </div>

            <div className="hq-statRow">
              <div>
                <div className="hq-statLabel">Lead carry</div>
                <div className="hq-statMeta">Surface currently holding the larger live byte footprint</div>
              </div>
              <div className="hq-listMeta">{carryLeader}</div>
            </div>
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Storage surface load"
          subtitle="Current live storage footprint split by system, files, bytes, uploads, and deletes."
        >
          <div className="hq-opsSurfaceGrid hq-storageSurfaceGrid">
            <article className="hq-opsSurfaceCard hq-storageSurfaceCard" data-surface="cloud">
              <div className="hq-storageSurfaceHead">
                <div className="hq-opsSurfaceLabel">CavCloud</div>
                <div className="hq-opsSurfaceValue">{formatInt(totals.cloudFiles)}</div>
              </div>
              <div className="hq-storageSurfaceMetaGroup">
                <p className="hq-opsSurfaceMeta">{formatBytes(totals.cloudBytes)} active</p>
                <p className="hq-opsSurfaceMeta">{formatInt(rows.reduce((sum, row) => sum + row.storage.cloudDeletedFiles, 0))} deleted</p>
              </div>
            </article>
            <article className="hq-opsSurfaceCard hq-storageSurfaceCard" data-surface="safe">
              <div className="hq-storageSurfaceHead">
                <div className="hq-opsSurfaceLabel">CavSafe</div>
                <div className="hq-opsSurfaceValue">{formatInt(totals.safeFiles)}</div>
              </div>
              <div className="hq-storageSurfaceMetaGroup">
                <p className="hq-opsSurfaceMeta">{formatBytes(totals.safeBytes)} active</p>
                <p className="hq-opsSurfaceMeta">{formatInt(rows.reduce((sum, row) => sum + row.storage.safeDeletedFiles, 0))} deleted</p>
              </div>
            </article>
            <article className="hq-opsSurfaceCard hq-storageSurfaceCard" data-surface="uploads">
              <div className="hq-storageSurfaceHead">
                <div className="hq-opsSurfaceLabel">Uploads</div>
                <div className="hq-opsSurfaceValue">{formatInt(totals.uploadedFiles)}</div>
              </div>
              <div className="hq-storageSurfaceMetaGroup">
                <p className="hq-opsSurfaceMeta">All-time persisted file creation count</p>
              </div>
            </article>
            <article className="hq-opsSurfaceCard hq-storageSurfaceCard" data-surface="deletes">
              <div className="hq-storageSurfaceHead">
                <div className="hq-opsSurfaceLabel">Deletes</div>
                <div className="hq-opsSurfaceValue">{formatInt(totals.deletedFiles)}</div>
              </div>
              <div className="hq-storageSurfaceMetaGroup">
                <p className="hq-opsSurfaceMeta">All-time file trash entries across both systems</p>
              </div>
            </article>
          </div>
        </Panel>

        <Panel
          title="Heaviest accounts"
          subtitle="Accounts carrying the largest live storage footprint right now."
        >
          {heaviestAccounts.length ? (
            <div className="hq-list">
              {heaviestAccounts.map((account) => (
                <div key={account.id} className="hq-listRow">
                  <div className="hq-inlineStart">
                    <AvatarBadge
                      name={account.owner?.displayName || account.owner?.fullName || account.name}
                      email={account.owner?.email || account.name}
                      image={account.owner?.avatarImage}
                      tone={account.owner?.avatarTone}
                    />
                    <div>
                      <div className="hq-listLabel">{account.name}</div>
                      <div className="hq-listMeta">
                        {formatUserHandle(account.owner)} · {formatInt(account.storage.totalFiles)} files · {formatBytes(account.storage.totalBytes)}
                      </div>
                    </div>
                  </div>
                  <div className="hq-listMeta">{formatInt(account.storage.deletedFiles)} deleted</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty">
              <p className="hq-emptyTitle">No storage load yet.</p>
              <p className="hq-emptySub">Workspaces will appear here once CavCloud or CavSafe begins carrying real files.</p>
            </div>
          )}
        </Panel>
      </section>
    </AdminPage>
  );
}
