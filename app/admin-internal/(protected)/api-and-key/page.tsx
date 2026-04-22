import { EmbedInstallKind } from "@prisma/client";

import {
  AdminPage,
  MetricCard,
  Panel,
  TrendChart,
} from "@/components/admin/AdminPrimitives";
import {
  ApiKeyPassportGrid,
  type ApiKeyDeniedOriginSnapshot,
  type ApiKeyLifecycleSnapshot,
  type ApiKeyPassportCardData,
} from "@/components/admin/ApiKeyPassportGrid";
import { AdminTimelineControl } from "@/components/admin/AdminTimelineControl";
import {
  buildAdminTrendPoints,
  formatDateTime,
  formatInt,
  formatPercent,
  formatUserHandle,
  getAccountOwners,
  parseAdminMonth,
  parseAdminRange,
  resolveAdminWindow,
} from "@/lib/admin/server";
import { requireAdminAccessFromRequestContext } from "@/lib/admin/staff";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDay(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatKeyType(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PUBLISHABLE") return "Publishable";
  if (normalized === "SECRET") return "Secret";
  if (normalized === "ADMIN") return "Admin";
  return normalized || "Key";
}

function formatKeyStatus(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "Active";
  if (normalized === "ROTATED") return "Rotated";
  if (normalized === "REVOKED") return "Revoked";
  return normalized || "Unknown";
}

function lifecycleTone(action: string) {
  const normalized = String(action || "").trim().toUpperCase();
  if (normalized === "KEY_REVOKED") return "bad" as const;
  if (normalized === "KEY_DENIED_ORIGIN" || normalized === "KEY_RATE_LIMITED" || normalized === "KEY_ROTATED") return "watch" as const;
  return "good" as const;
}

function statusTone(status: string) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "REVOKED") return "bad" as const;
  if (normalized === "ROTATED") return "watch" as const;
  return "good" as const;
}

export default async function ApiAndKeyPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminAccessFromRequestContext("/api-and-key", { scopes: ["platform.read"] });

  const range = parseAdminRange(Array.isArray(props.searchParams?.range) ? props.searchParams?.range[0] : props.searchParams?.range, "30d");
  const month = parseAdminMonth(Array.isArray(props.searchParams?.month) ? props.searchParams?.month[0] : props.searchParams?.month);
  const window = resolveAdminWindow(range, month);
  const rangeLabel = window.label;
  const start = window.start;
  const end = window.end;
  const startDay = isoDay(start);
  const endDay = isoDay(new Date(end.getTime() - 1));

  const [keys, verificationRows, deniedRows, installs, auditRows] = await Promise.all([
    prisma.apiKey.findMany({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 72,
      select: {
        id: true,
        type: true,
        status: true,
        name: true,
        prefix: true,
        last4: true,
        scopes: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true,
        rotatedAt: true,
        accountId: true,
        projectId: true,
        siteId: true,
        account: {
          select: {
            id: true,
            name: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        site: {
          select: {
            id: true,
            label: true,
            origin: true,
          },
        },
      },
    }),
    prisma.embedVerificationMetric.findMany({
      where: {
        dayKey: { gte: startDay, lte: endDay },
      },
      select: {
        keyId: true,
        dayKey: true,
        verified: true,
        denied: true,
      },
    }),
    prisma.embedDeniedOrigin.findMany({
      where: {
        dayKey: { gte: startDay, lte: endDay },
      },
      orderBy: [{ attempts: "desc" }, { lastDeniedAt: "desc" }],
      select: {
        keyId: true,
        dayKey: true,
        origin: true,
        attempts: true,
        lastDeniedAt: true,
      },
    }),
    prisma.embedInstall.findMany({
      where: {
        status: "ACTIVE",
      },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        kind: true,
        widgetType: true,
        origin: true,
        accountId: true,
        lastSeenAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        action: {
          in: [
            "KEY_CREATED",
            "KEY_ROTATED",
            "KEY_REVOKED",
            "KEY_USED",
            "KEY_DENIED_ORIGIN",
            "KEY_RATE_LIMITED",
            "WIDGET_VERIFIED",
            "WIDGET_DENIED",
            "INTEGRATION_CONNECTED",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 220,
      select: {
        id: true,
        action: true,
        actionLabel: true,
        targetId: true,
        targetLabel: true,
        metaJson: true,
        createdAt: true,
      },
    }),
  ]);

  const accountIds = Array.from(new Set(keys.map((key) => key.accountId).filter((value): value is string => Boolean(value))));
  const accountOwners = await getAccountOwners(accountIds);

  const verificationByKey = new Map<string, { verified: number; denied: number }>();
  for (const row of verificationRows) {
    const keyId = String(row.keyId || "").trim();
    if (!keyId) continue;
    const existing = verificationByKey.get(keyId) || { verified: 0, denied: 0 };
    existing.verified += row.verified || 0;
    existing.denied += row.denied || 0;
    verificationByKey.set(keyId, existing);
  }

  const deniedByKey = new Map<string, ApiKeyDeniedOriginSnapshot[]>();
  const deniedByOrigin = new Map<string, { attempts: number; keyIds: Set<string>; latestAt: Date | null }>();
  for (const row of deniedRows) {
    const keyId = String(row.keyId || "").trim();
    if (keyId) {
      const existing = deniedByKey.get(keyId) || [];
      existing.push({
        origin: row.origin,
        attemptsLabel: `${formatInt(row.attempts)} blocked attempts`,
        dayLabel: row.dayKey,
      });
      deniedByKey.set(keyId, existing);
    }

    const aggregate = deniedByOrigin.get(row.origin) || { attempts: 0, keyIds: new Set<string>(), latestAt: null };
    aggregate.attempts += row.attempts || 0;
    if (keyId) aggregate.keyIds.add(keyId);
    if (!aggregate.latestAt || row.lastDeniedAt > aggregate.latestAt) {
      aggregate.latestAt = row.lastDeniedAt;
    }
    deniedByOrigin.set(row.origin, aggregate);
  }

  const lifecycleByKey = new Map<string, ApiKeyLifecycleSnapshot[]>();
  for (const row of auditRows) {
    const targetKeyId = String(row.targetId || "").trim();
    if (!targetKeyId) continue;
    const existing = lifecycleByKey.get(targetKeyId) || [];
    existing.push({
      id: row.id,
      actionLabel: row.actionLabel,
      targetLabel: row.targetLabel || formatKeyStatus(row.action),
      createdLabel: formatDateTime(row.createdAt),
      tone: lifecycleTone(row.action),
    });
    lifecycleByKey.set(targetKeyId, existing);
  }

  const keyCards: ApiKeyPassportCardData[] = keys.map((key) => {
    const owner = key.accountId ? accountOwners.get(key.accountId) : undefined;
    const verification = verificationByKey.get(key.id) || { verified: 0, denied: 0 };
    const deniedOrigins = (deniedByKey.get(key.id) || []).slice(0, 8);
    const lifecycle = (lifecycleByKey.get(key.id) || []).slice(0, 8);
    const scopesLabel = key.scopes.length ? key.scopes.join(", ") : "No explicit scopes";
    const bindingLabel = [
      key.account?.name || null,
      key.project?.name || key.project?.slug || null,
      key.site?.origin || null,
    ].filter(Boolean).join(" · ") || "Account-wide";

    return {
      id: key.id,
      name: key.name || `${formatKeyType(key.type)} key`,
      typeLabel: formatKeyType(key.type),
      statusLabel: formatKeyStatus(key.status),
      statusTone: statusTone(key.status),
      maskedLabel: `•••• ${key.last4}`,
      prefixLabel: key.prefix,
      scopeCountLabel: `${formatInt(key.scopes.length)} scopes`,
      scopesLabel,
      accountLabel: key.accountId ? formatUserHandle(owner, key.account?.name || "No account") : "Global binding",
      projectLabel: key.project?.name || key.project?.slug || "No project binding",
      siteLabel: key.site?.origin || key.site?.label || "All sites",
      verifiedLabel: formatInt(verification.verified),
      deniedLabel: formatInt(verification.denied),
      deniedOriginsLabel: formatInt(deniedOrigins.length),
      createdLabel: formatDateTime(key.createdAt),
      lastUsedLabel: key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never used",
      rotatedLabel: key.rotatedAt ? formatDateTime(key.rotatedAt) : "Not rotated",
      bindingLabel,
      summaryNote:
        key.status === "REVOKED"
          ? "This key has been revoked and is preserved for full lifecycle auditing."
          : key.status === "ROTATED"
            ? "This key has been rotated out, but its verification and denied-origin history stays attached here."
            : "Live key passport showing bindings, usage, verification traffic, and blocked-origin pressure.",
      deniedOrigins,
      lifecycle,
    };
  });

  const verificationTrend = buildAdminTrendPoints(
    verificationRows.map((row) => ({
      date: new Date(`${row.dayKey}T00:00:00.000Z`),
      value: row.verified || 0,
      secondaryValue: row.denied || 0,
    })),
    range,
    month,
  );

  const rotations = auditRows.filter((row) => row.action === "KEY_ROTATED").length;
  const revocations = auditRows.filter((row) => row.action === "KEY_REVOKED").length;
  const activeKeys = keys.filter((key) => key.status === "ACTIVE").length;
  const keysUsed = keys.filter((key) => key.lastUsedAt && key.lastUsedAt >= start && key.lastUsedAt < end).length;
  const totalVerified = verificationRows.reduce((sum, row) => sum + (row.verified || 0), 0);
  const totalDenied = verificationRows.reduce((sum, row) => sum + (row.denied || 0), 0);
  const totalVerificationAttempts = totalVerified + totalDenied;
  const connectionSuccessRate = totalVerificationAttempts > 0 ? (totalVerified / totalVerificationAttempts) * 100 : 0;
  const connectionFailureRate = totalVerificationAttempts > 0 ? (totalDenied / totalVerificationAttempts) * 100 : 0;

  const surfaceBuckets = [
    { id: "badge", label: "Badge", rows: installs.filter((row) => row.kind === EmbedInstallKind.WIDGET && row.widgetType === "badge") },
    { id: "head", label: "Head widget", rows: installs.filter((row) => row.kind === EmbedInstallKind.WIDGET && row.widgetType === "head") },
    { id: "body", label: "Body widget", rows: installs.filter((row) => row.kind === EmbedInstallKind.WIDGET && row.widgetType === "body") },
    { id: "analytics", label: "Analytics", rows: installs.filter((row) => row.kind === EmbedInstallKind.ANALYTICS) },
    { id: "arcade", label: "Arcade", rows: installs.filter((row) => row.kind === EmbedInstallKind.ARCADE) },
    { id: "brain", label: "Brain", rows: installs.filter((row) => row.kind === EmbedInstallKind.BRAIN) },
  ].map((bucket) => {
    const workspaceCount = new Set(bucket.rows.map((row) => row.accountId)).size;
    const originCount = new Set(bucket.rows.map((row) => row.origin)).size;
    const lastSeenAt = bucket.rows.reduce<Date | null>((latest, row) => {
      if (!latest) return row.lastSeenAt;
      return row.lastSeenAt > latest ? row.lastSeenAt : latest;
    }, null);
    return {
      ...bucket,
      count: bucket.rows.length,
      workspaceCount,
      originCount,
      lastSeenLabel: lastSeenAt ? formatDateTime(lastSeenAt) : "—",
    };
  });

  const topDeniedOrigins = Array.from(deniedByOrigin.entries())
    .map(([origin, value]) => ({
      origin,
      attempts: value.attempts,
      keys: value.keyIds.size,
      latestLabel: value.latestAt ? formatDateTime(value.latestAt) : "—",
    }))
    .sort((left, right) => right.attempts - left.attempts)
    .slice(0, 8);

  const recentLifecycle = auditRows
    .filter((row) => row.action.startsWith("KEY_"))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      actionLabel: row.actionLabel,
      targetLabel: row.targetLabel || "Key lifecycle",
      createdLabel: formatDateTime(row.createdAt),
      tone: lifecycleTone(row.action),
    }));

  return (
    <AdminPage
      title="API & Key"
      subtitle="Real CavBot monitoring for API keys, verification traffic, blocked origins, widget installs, badge installs, arcade surfaces, and full key rotation history."
      actions={<AdminTimelineControl value={range} month={month} />}
    >
      <section className="hq-grid hq-gridMetrics">
        <MetricCard label="Active keys" value={formatInt(activeKeys)} meta={`${formatInt(keysUsed)} used in ${rangeLabel}`} />
        <MetricCard label="Rotations" value={formatInt(rotations)} meta="Key rotation events in the current window" />
        <MetricCard label="Revocations" value={formatInt(revocations)} meta="Keys revoked in the current window" />
        <MetricCard label="Verified calls" value={formatInt(totalVerified)} meta="Persisted verification requests accepted" />
        <MetricCard label="Denied calls" value={formatInt(totalDenied)} meta="Persisted verification requests blocked or rate-limited" />
        <MetricCard label="Active surfaces" value={formatInt(installs.length)} meta="Live widget, analytics, arcade, and brain installs" />
        <MetricCard
          label="Connection success"
          value={formatPercent(connectionSuccessRate)}
          meta={`${formatInt(totalVerified)} of ${formatInt(totalVerificationAttempts)} verification calls accepted`}
        />
        <MetricCard
          label="Connection failure"
          value={formatPercent(connectionFailureRate)}
          meta={`${formatInt(totalDenied)} of ${formatInt(totalVerificationAttempts)} verification calls denied or rate-limited`}
        />
      </section>

      <section className="hq-grid hq-gridTwo">
        <TrendChart
          title="Verification traffic"
          subtitle={`Accepted versus denied verification activity across ${rangeLabel}.`}
          labels={verificationTrend.map((row) => row.label)}
          primary={verificationTrend.map((row) => row.value)}
          secondary={verificationTrend.map((row) => row.secondaryValue || 0)}
          primaryLabel="Verified"
          secondaryLabel="Denied"
          secondaryTone="bad"
        />

        <Panel
          title="Surface footprint"
          subtitle="Current live widget, badge, analytics, arcade, and brain install mix captured from CavBot embed detection."
        >
          <div className="hq-opsSurfaceGrid hq-apiSurfaceGrid">
            {surfaceBuckets.map((bucket) => (
              <article key={bucket.id} className="hq-opsSurfaceCard">
                <div className="hq-opsSurfaceLabel">{bucket.label}</div>
                <div className="hq-opsSurfaceValue">{formatInt(bucket.count)}</div>
                <p className="hq-opsSurfaceMeta">Last seen {bucket.lastSeenLabel}</p>
              </article>
            ))}
          </div>
        </Panel>
      </section>

      <section className="hq-grid hq-gridTwo">
        <Panel
          title="Rotation watch"
          subtitle="Latest create, rotate, revoke, and use activity recorded by CavBot audit logging."
        >
          {recentLifecycle.length ? (
            <div className="hq-list">
              {recentLifecycle.map((row) => (
                <div key={row.id} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.actionLabel}</div>
                    <div className="hq-listMeta">{row.targetLabel}</div>
                  </div>
                  <div className="hq-inlineStart">
                    <span className="hq-opsLifecycleDot" data-tone={row.tone} aria-hidden="true" />
                    <span className="hq-listMeta">{row.createdLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty hq-emptyOpsPanel">
              <div className="hq-emptyOpsMark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="hq-emptyTitle">No key lifecycle rows yet.</p>
              <p className="hq-emptySub">Create, rotate, revoke, and use events will stream here as soon as CavBot records them in audit logging.</p>
            </div>
          )}
        </Panel>

        <Panel
          title="Origin pressure"
          subtitle="Origins generating the heaviest blocked or rate-limited traffic across the current key set."
        >
          {topDeniedOrigins.length ? (
            <div className="hq-list">
              {topDeniedOrigins.map((row) => (
                <div key={row.origin} className="hq-listRow">
                  <div>
                    <div className="hq-listLabel">{row.origin}</div>
                    <div className="hq-listMeta">{formatInt(row.keys)} keys affected · {row.latestLabel}</div>
                  </div>
                  <div className="hq-listMeta">{formatInt(row.attempts)} blocked</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="hq-empty hq-emptyOpsPanel">
              <div className="hq-emptyOpsMark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <p className="hq-emptyTitle">No origin pressure yet.</p>
              <p className="hq-emptySub">As CavBot blocks invalid origins or rate-limits bad traffic, the hottest origins will rank here automatically.</p>
            </div>
          )}
        </Panel>
      </section>

      <Panel
        title="Key passports"
        subtitle="Passport-style cards for every real API key. Click a key to inspect bindings, verification traffic, denied-origin detail, and lifecycle history."
      >
        <ApiKeyPassportGrid keys={keyCards} />
      </Panel>
    </AdminPage>
  );
}
