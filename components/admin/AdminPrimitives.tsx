import Link from "next/link";
import type { ReactNode } from "react";

type MetricCardProps = {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  href?: string | null;
  className?: string;
};

type PlanShareTone = "trialing" | "free" | "premium" | "enterprise" | "blue" | "lime" | "orange" | "bad";
type ChartTone = "primary" | "secondary" | "lime" | "orange" | "bad";
type PaginationSearchParams = Record<string, string | string[] | undefined>;
type PaginationToken =
  | { type: "page"; page: number; href: string; current: boolean }
  | { type: "ellipsis"; key: string };

function buildPaginationHref(pathname: string, searchParams: PaginationSearchParams, nextPage: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry) params.append(key, entry);
      }
      continue;
    }
    if (value) params.set(key, value);
  }
  params.set("page", String(Math.max(1, nextPage)));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function buildPaginationTokens(
  page: number,
  pageCount: number,
  pathname: string,
  searchParams: PaginationSearchParams,
) {
  const tokens: PaginationToken[] = [];
  const maxVisiblePages = 6;

  const pushPage = (value: number) => {
    tokens.push({
      type: "page",
      page: value,
      href: buildPaginationHref(pathname, searchParams, value),
      current: value === page,
    });
  };

  if (pageCount <= maxVisiblePages) {
    for (let value = 1; value <= pageCount; value += 1) pushPage(value);
    return tokens;
  }

  let start = Math.max(1, Math.min(page - Math.floor(maxVisiblePages / 2), pageCount - maxVisiblePages + 1));
  const end = Math.min(pageCount, start + maxVisiblePages - 1);
  start = Math.max(1, end - maxVisiblePages + 1);

  if (start > 1) {
    pushPage(1);
    if (start > 2) tokens.push({ type: "ellipsis", key: `lead-${start}` });
  }

  for (let value = start; value <= end; value += 1) {
    if (value === 1 && start > 1) continue;
    if (value === pageCount && end < pageCount) continue;
    pushPage(value);
  }

  if (end < pageCount) {
    if (end < pageCount - 1) tokens.push({ type: "ellipsis", key: `trail-${end}` });
    pushPage(pageCount);
  }

  return tokens;
}

function PagerChevron(props: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {props.direction === "left" ? (
        <path d="M9.75 3.5L5.25 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6.25 3.5L10.75 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function AdminPage(props: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  chips?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="hq-page">
      <header className="hq-pageHead">
        <div className="hq-pageHeadMain">
          <h1 className="hq-pageTitle">{props.title}</h1>
          <p className="hq-pageSub">{props.subtitle}</p>
        </div>
        {props.actions ? <div className="hq-pageActions">{props.actions}</div> : null}
      </header>
      {props.children}
    </section>
  );
}

export function MetricCard(props: MetricCardProps) {
  const className = props.className ? `hq-card ${props.className}` : "hq-card";
  const content = (
    <>
      <div className="hq-metricTop">
        <div className="hq-metricLabel">{props.label}</div>
        <div className="hq-metricValue">{props.value}</div>
      </div>
      {props.meta ? <p className="hq-metricMeta">{props.meta}</p> : null}
    </>
  );

  if (props.href) {
    return (
      <Link href={props.href} className={className}>
        {content}
      </Link>
    );
  }

  return <article className={className}>{content}</article>;
}

export function Panel(props: {
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="hq-card">
      <header className="hq-cardHead">
        <div>
          <h2 className="hq-cardTitle">{props.title}</h2>
          {props.subtitle ? <p className="hq-cardSub">{props.subtitle}</p> : null}
        </div>
        {props.actions ? <div className="hq-inline">{props.actions}</div> : null}
      </header>
      <div className="hq-cardBody">{props.children}</div>
    </article>
  );
}

export function EmptyState(props: { title: string; subtitle: string }) {
  return (
    <div className="hq-empty">
      <p className="hq-emptyTitle">{props.title}</p>
      <p className="hq-emptySub">{props.subtitle}</p>
    </div>
  );
}

export function ErrorState(props: { title: string; subtitle: string }) {
  return (
    <div className="hq-error">
      <p className="hq-errorTitle">{props.title}</p>
      <p className="hq-errorSub">{props.subtitle}</p>
    </div>
  );
}

export function Badge(props: { children: ReactNode; tone?: "good" | "watch" | "bad"; className?: string }) {
  return (
    <span className={props.className ? `hq-badge ${props.className}` : "hq-badge"} data-tone={props.tone || "watch"}>
      {props.children}
    </span>
  );
}

function initialsFrom(value: string) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "CB";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "CB";
}

function normalizeAvatarTone(value: string | null | undefined) {
  const tone = String(value || "").trim().toLowerCase();
  if (tone === "transparent" || tone === "clear") return "transparent";
  if (tone === "lime" || tone === "violet" || tone === "blue" || tone === "orange" || tone === "white" || tone === "navy") {
    return tone;
  }
  return "lime";
}

export function AvatarBadge(props: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  tone?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const label = String(props.name || props.email || "CavBot").trim() || "CavBot";
  const initials = initialsFrom(label);
  const size = props.size || "md";
  const tone = normalizeAvatarTone(props.tone);

  return props.image ? (
    <span className="hq-avatar" data-size={size} data-tone={tone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={props.image} alt={label} />
    </span>
  ) : (
    <span className="hq-avatar" data-size={size} data-tone={tone} aria-label={label}>
      {initials}
    </span>
  );
}

export function KeyValueGrid(props: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <div className="hq-kvGrid">
      {props.items.map((item) => (
        <div key={item.label} className="hq-kvItem">
          <div className="hq-kvLabel">{item.label}</div>
          <div className="hq-kvValue">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function PaginationNav(props: {
  page: number;
  pageCount: number;
  pathname: string;
  searchParams?: PaginationSearchParams;
}) {
  if (props.pageCount <= 1) return null;

  const searchParams = props.searchParams || {};
  const prevHref = props.page > 1 ? buildPaginationHref(props.pathname, searchParams, props.page - 1) : null;
  const nextHref = props.page < props.pageCount ? buildPaginationHref(props.pathname, searchParams, props.page + 1) : null;
  const tokens = buildPaginationTokens(props.page, props.pageCount, props.pathname, searchParams);

  return (
    <nav className="hq-pager" aria-label="Pagination">
      <div className="hq-pagination">
        {prevHref ? (
          <Link href={prevHref} className="hq-paginationControl" aria-label={`Go to page ${props.page - 1}`}>
            <PagerChevron direction="left" />
          </Link>
        ) : (
          <span className="hq-paginationControl" data-disabled="true" aria-hidden="true">
            <PagerChevron direction="left" />
          </span>
        )}
        <div className="hq-paginationRail">
          {tokens.map((token) =>
            token.type === "ellipsis" ? (
              <span key={token.key} className="hq-paginationEllipsis" aria-hidden="true">
                ...
              </span>
            ) : (
              <Link
                key={token.page}
                href={token.href}
                className={token.current ? "hq-paginationNumber hq-paginationNumberActive" : "hq-paginationNumber"}
                aria-current={token.current ? "page" : undefined}
              >
                {token.page}
              </Link>
            ),
          )}
        </div>
        {nextHref ? (
          <Link href={nextHref} className="hq-paginationControl" aria-label={`Go to page ${props.page + 1}`}>
            <PagerChevron direction="right" />
          </Link>
        ) : (
          <span className="hq-paginationControl" data-disabled="true" aria-hidden="true">
            <PagerChevron direction="right" />
          </span>
        )}
      </div>
    </nav>
  );
}

type ChartPoint = {
  x: number;
  y: number;
  value: number;
};

function buildChartPoints(
  values: number[],
  maxValue: number,
  width: number,
  height: number,
  paddingX = 16,
  paddingTop = 16,
  paddingBottom = 30,
) {
  const baselineY = height - paddingBottom;
  const innerWidth = width - paddingX * 2;
  const innerHeight = baselineY - paddingTop;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : 0;

  return values.map((value, index) => ({
    value,
    x: paddingX + index * step,
    y: baselineY - (Math.max(0, value) / Math.max(1, maxValue)) * innerHeight,
  }));
}

function buildSmoothPath(points: ChartPoint[]) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midX = (previous.x + current.x) / 2;
    path += ` C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  }
  return path;
}

function buildAreaPath(points: ChartPoint[], baselineY: number) {
  if (!points.length) return "";
  const line = buildSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function sampledAxisLabels(labels: string[], width: number, paddingX = 16, sampleCount = 5) {
  if (!labels.length) return [];
  const count = Math.min(sampleCount, labels.length);
  const indexes = Array.from({ length: count }, (_, index) =>
    Math.round((index * (labels.length - 1)) / Math.max(1, count - 1)),
  ).filter((value, index, array) => array.indexOf(value) === index);

  return indexes.map((index) => ({
    key: `${index}:${labels[index]}`,
    label: labels[index],
    left: labels.length <= 1 ? paddingX : paddingX + (index * (width - paddingX * 2)) / Math.max(1, labels.length - 1),
  }));
}

function resolveChartTone(tone: ChartTone) {
  switch (tone) {
    case "lime":
      return {
        fillTop: "rgba(185, 200, 90, 0.22)",
        fillBottom: "rgba(185, 200, 90, 0.03)",
        stroke: "rgba(185, 200, 90, 0.96)",
      };
    case "orange":
      return {
        fillTop: "rgba(251, 146, 60, 0.18)",
        fillBottom: "rgba(251, 146, 60, 0.03)",
        stroke: "rgba(251, 146, 60, 0.94)",
      };
    case "bad":
      return {
        fillTop: "rgba(255, 77, 77, 0.18)",
        fillBottom: "rgba(255, 77, 77, 0.02)",
        stroke: "rgba(255, 77, 77, 0.92)",
      };
    case "secondary":
      return {
        fillTop: "rgba(255, 205, 96, 0.18)",
        fillBottom: "rgba(255, 205, 96, 0.02)",
        stroke: "rgba(255, 205, 96, 0.92)",
      };
    default:
      return {
        fillTop: "rgba(116, 178, 255, 0.38)",
        fillBottom: "rgba(116, 178, 255, 0.02)",
        stroke: "rgba(116, 178, 255, 0.96)",
      };
  }
}

export function TrendChart(props: {
  title: string;
  subtitle?: string | null;
  labels: string[];
  primary: number[];
  secondary?: number[];
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryTone?: "primary" | "lime" | "orange" | "bad";
  secondaryTone?: "secondary" | "lime" | "orange" | "bad";
  className?: string;
  paddingTop?: number;
  paddingBottom?: number;
  formatValue?: (value: number) => ReactNode;
  emptyTitle?: string;
  emptySubtitle?: string;
}) {
  const width = 980;
  const height = 220;
  const paddingX = 16;
  const paddingTop = props.paddingTop ?? 18;
  const paddingBottom = props.paddingBottom ?? 34;
  const baselineY = height - paddingBottom;
  const allValues = [...props.primary, ...(props.secondary || [])];
  const maxValue = Math.max(1, ...allValues);
  const primaryPoints = buildChartPoints(props.primary, maxValue, width, height, paddingX, paddingTop, paddingBottom);
  const secondaryPoints = buildChartPoints(props.secondary || [], maxValue, width, height, paddingX, paddingTop, paddingBottom);
  const axisLabels = sampledAxisLabels(props.labels, width, paddingX);
  const latestPrimary = props.primary[props.primary.length - 1] ?? 0;
  const latestSecondary = props.secondary?.[props.secondary.length - 1] ?? 0;
  const formatValue = props.formatValue || ((value: number) => value);
  const chartId = props.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "chart";
  const primaryTone = props.primaryTone || "primary";
  const secondaryTone = props.secondaryTone || "secondary";
  const primaryColors = resolveChartTone(primaryTone);
  const secondaryColors = resolveChartTone(secondaryTone);
  const hasChartData = primaryPoints.length > 0 || secondaryPoints.length > 0;

  return (
    <Panel title={props.title} subtitle={props.subtitle || null}>
      {hasChartData ? (
        <div className={props.className ? `hq-chart ${props.className}` : "hq-chart"}>
          <div className="hq-chartFrame">
            <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="188" role="img" aria-label={props.title}>
              <defs>
                <linearGradient id={`${chartId}-primary-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primaryColors.fillTop} />
                  <stop offset="100%" stopColor={primaryColors.fillBottom} />
                </linearGradient>
                <linearGradient id={`${chartId}-secondary-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={secondaryColors.fillTop} />
                  <stop offset="100%" stopColor={secondaryColors.fillBottom} />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75, 1].map((ratio) => {
                const y = paddingTop + (baselineY - paddingTop) * ratio;
                return (
                  <line
                    key={ratio}
                    x1={paddingX}
                    y1={y}
                    x2={width - paddingX}
                    y2={y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="4 8"
                  />
                );
              })}

              {primaryPoints.length ? (
                <path
                  d={buildAreaPath(primaryPoints, baselineY)}
                  fill={`url(#${chartId}-primary-fill)`}
                />
              ) : null}
              {secondaryPoints.length ? (
                <path
                  d={buildAreaPath(secondaryPoints, baselineY)}
                  fill={`url(#${chartId}-secondary-fill)`}
                />
              ) : null}

              {primaryPoints.length ? (
                <path
                  d={buildSmoothPath(primaryPoints)}
                  fill="none"
                  stroke={primaryColors.stroke}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {secondaryPoints.length ? (
                <path
                  d={buildSmoothPath(secondaryPoints)}
                  fill="none"
                  stroke={secondaryColors.stroke}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="10 8"
                />
              ) : null}

              {primaryPoints.map((point, index) => (
                <circle
                  key={`primary-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === primaryPoints.length - 1 ? 4.5 : 2.5}
                  fill={primaryColors.stroke}
                  stroke="rgba(3, 6, 18, 0.96)"
                  strokeWidth="2"
                />
              ))}
              {secondaryPoints.map((point, index) => (
                <circle
                  key={`secondary-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={index === secondaryPoints.length - 1 ? 4 : 2}
                  fill={secondaryColors.stroke}
                  stroke="rgba(3, 6, 18, 0.96)"
                  strokeWidth="2"
                />
              ))}
            </svg>
          </div>
          <div className="hq-chartLegend">
            {primaryPoints.length ? (
              <span className="hq-chartLegendItem">
                <span className="hq-chartLegendSwatch" data-tone={primaryTone} />
                <span>{props.primaryLabel || "Primary"}</span>
                <strong>{formatValue(latestPrimary)}</strong>
              </span>
            ) : null}
            {props.secondary?.length ? (
              <span className="hq-chartLegendItem">
                <span className="hq-chartLegendSwatch" data-tone={secondaryTone} />
                <span>{props.secondaryLabel || "Secondary"}</span>
                <strong>{formatValue(latestSecondary)}</strong>
              </span>
            ) : null}
          </div>
          <div
            className="hq-chartAxis"
            aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${Math.max(axisLabels.length, 1)}, minmax(0, 1fr))` }}
          >
            {axisLabels.map((entry) => (
              <span key={entry.key}>
                {entry.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title={props.emptyTitle || "No chart data yet."}
          subtitle={props.emptySubtitle || "As CavBot HQ receives persisted rollups, trend charts will render observed history."}
        />
      )}
    </Panel>
  );
}

export function PlanSharePanel(props: {
  title: string;
  subtitle?: string | null;
  items: Array<{
    label: string;
    value: number;
    tone: PlanShareTone;
    meta?: string | null;
  }>;
  emptyTitle?: string;
  emptySubtitle?: string;
}) {
  const items = props.items;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const maxValue = Math.max(1, ...items.map((item) => item.value));
  const lead = items.slice().sort((left, right) => right.value - left.value)[0] || null;
  const hasValues = items.some((item) => item.value > 0);

  return (
    <Panel title={props.title} subtitle={props.subtitle || null}>
      {hasValues ? (
        <div className="hq-planShare">
          <div className="hq-planShareLead">
            <div className="hq-planShareLeadLabel">Most represented</div>
            <div className="hq-planShareLeadValue">{lead?.label || "No dominant tier"}</div>
            <p className="hq-planShareLeadMeta">
              {lead ? `${Math.round((lead.value / Math.max(1, total)) * 100)}% of the current set` : "No current plan mix"}
            </p>
          </div>
          <div className="hq-planChart" role="img" aria-label={props.title} data-count={items.length}>
            <div className="hq-planChartStage" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="hq-planChartBars" data-count={items.length}>
            {items.map((item) => {
              const percent = Math.round((item.value / Math.max(1, total)) * 100);
              const height = item.value > 0 ? Math.max(14, Math.round((item.value / maxValue) * 100)) : 8;
              return (
                <article key={item.label} className="hq-planChartBarCard">
                  <div className="hq-planChartValue">{item.value}</div>
                  <div className="hq-planChartBarWrap">
                    <span className="hq-planChartBar" data-tone={item.tone} style={{ height: `${height}%` }} />
                  </div>
                  <div className="hq-planShareLabelWrap">
                    <span className="hq-planShareSwatch" data-tone={item.tone} />
                    <span className="hq-planShareLabel">{item.label}</span>
                  </div>
                  <div className="hq-planShareStats">
                    <span>{percent}%</span>
                  </div>
                  {item.meta ? <p className="hq-planShareMeta">{item.meta}</p> : null}
                </article>
              );
            })}
          </div>
          </div>
        </div>
      ) : (
        <EmptyState
          title={props.emptyTitle || "No plan distribution yet."}
          subtitle={props.emptySubtitle || "Once matching accounts or clients exist in this slice, the tier comparison will render here."}
        />
      )}
    </Panel>
  );
}
