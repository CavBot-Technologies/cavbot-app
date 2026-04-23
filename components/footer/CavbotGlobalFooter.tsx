"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
} from "react";
import useSWR from "swr";
import { isAdminHost, toAdminInternalPath } from "@/lib/admin/config";
import { useSystemStatus } from "@/lib/hooks/useSystemStatus";
import styles from "./CavbotGlobalFooter.module.css";

type FooterMetricsSuccess = {
  ok: true;
  generatedAt: string;
  workspace: {
    projectId: number;
    siteId: string | null;
    siteOrigin: string | null;
  };
  apiActivity: {
    totalRequests: number;
    failedRequests: number;
    periodLabel: string;
    deniedOrigins: string[];
  };
  eventDestinationActivity: {
    activeDestinations: number;
    recentDestinations: number;
    recentEvents: number;
    recentActivity: number;
    periodLabel: string;
    lastActivityAt: string | null;
    activeKinds: string[];
  };
};

type FooterMetricsUnavailable = {
  ok: false;
  reason: string;
  message: string;
};

type FooterMetricsPayload = FooterMetricsSuccess | FooterMetricsUnavailable;

type FooterCardKey = "system" | "api" | "destination";

type FooterAdminSessionPayload = {
  ok: boolean;
  authenticated?: boolean;
  adminAuthenticated?: boolean;
  staff?: {
    department?: string | null;
    systemRole?: string | null;
  } | null;
};

const HUMAN_RESOURCES_LINKS = [
  {
    href: "/staff",
    label: "Team",
    sub: "Lifecycle, roles, and placement",
    iconSrc: "/icons/app/hq/staff-symbol-svgrepo-com.svg",
  },
  {
    href: "/staff-lifecycle",
    label: "Team Lifecycle",
    sub: "Onboarding, moves, leave, and offboarding",
    iconSrc: "/icons/app/hq/staff-lifecycle-analytics-svgrepo-com.svg",
  },
  {
    href: "/broadcasts",
    label: "Team Broadcasts",
    sub: "Internal notices and mail fanout",
    iconSrc: "/icons/app/hq/walkie-talkie-svgrepo-com.svg",
  },
  {
    href: "/message-oversight",
    label: "Message Oversight",
    sub: "Team inbox review, safety checks, and archives",
    iconSrc: "/icons/app/hq/secure-mail-svgrepo-com.svg",
  },
  {
    href: "/audit",
    label: "Audit",
    sub: "Sensitive action trail and evidence",
    iconSrc: "/icons/app/hq/audit-report-svgrepo-com.svg",
  },
] as const;

const DEVELOPER_LINKS = [
  {
    href: "/cavtools",
    label: "CavTools",
    sub: "Inspect signals, payloads, and operational tooling",
    iconSrc: "/icons/app/tools-svgrepo-com.svg",
  },
  {
    href: "/cavcode",
    label: "CavCode",
    sub: "Build, repair, and ship code with CavBot",
    iconSrc: "/icons/app/cavcode/code-svgrepo-com.svg",
  },
  {
    href: "/cavcode-viewer",
    label: "CavCode Viewer",
    sub: "Review generated output and implementation previews",
    iconSrc: "/icons/app/file-blank-svgrepo-com.svg",
  },
  {
    href: "/cavcloud",
    label: "CavCloud",
    sub: "Workspace files, assets, and deployment-ready storage",
    iconSrc: "/icons/app/workspace-svgrepo-com.svg",
  },
] as const;

const FOOTER_METRICS_KEY = "/api/system-footer/metrics";

async function fetchFooterMetrics(url: string): Promise<FooterMetricsPayload> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Footer metrics request failed (${response.status})`);
  }
  return (await response.json()) as FooterMetricsPayload;
}

async function fetchFooterAdminSession(url: string): Promise<FooterAdminSessionPayload> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Footer admin session request failed (${response.status})`);
  }
  return (await response.json()) as FooterAdminSessionPayload;
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return Math.max(0, Math.floor(value)).toLocaleString();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarizeAgeLabel(value: string | null | undefined) {
  if (!value) return "just now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "just now";
  const diffMs = Date.now() - parsed.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

export default function CavbotGlobalFooter() {
  const footerRef = useRef<HTMLElement>(null);
  const developerButtonRef = useRef<HTMLButtonElement>(null);
  const developerFirstLinkRef = useRef<HTMLAnchorElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const hadDeveloperDialogRef = useRef(false);
  const humanResourcesDetailsRef = useRef<HTMLDetailsElement>(null);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [hoverCard, setHoverCard] = useState<FooterCardKey | null>(null);
  const [pinnedCard, setPinnedCard] = useState<FooterCardKey | null>(null);
  const [canHover, setCanHover] = useState(false);
  const [adminHostRuntime] = useState(() =>
    typeof window !== "undefined" ? isAdminHost(window.location.host) : false,
  );
  const systemCardId = useId();
  const apiCardId = useId();
  const destinationCardId = useId();

  const { summary, checkedAt } = useSystemStatus({ pollMs: 15_000 });
  const { data: metricsPayload, error: metricsError } = useSWR<FooterMetricsPayload>(
    FOOTER_METRICS_KEY,
    fetchFooterMetrics,
    {
      refreshInterval: 30_000,
      dedupingInterval: 10_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    }
  );
  const { data: adminSessionPayload } = useSWR<FooterAdminSessionPayload>(
    adminHostRuntime ? "/api/admin/session" : null,
    fetchFooterAdminSession,
    {
      refreshInterval: 45_000,
      dedupingInterval: 15_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,
    },
  );

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setCanHover(Boolean(query.matches));
    sync();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!footerRef.current?.contains(target)) {
        setHoverCard(null);
        setPinnedCard(null);
        if (humanResourcesDetailsRef.current) {
          humanResourcesDetailsRef.current.open = false;
        }
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHoverCard(null);
      setPinnedCard(null);
      setDeveloperOpen(false);
      if (humanResourcesDetailsRef.current) {
        humanResourcesDetailsRef.current.open = false;
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (developerOpen) {
      hadDeveloperDialogRef.current = true;
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      lastFocusedElementRef.current = activeElement;
      window.setTimeout(() => {
        developerFirstLinkRef.current?.focus();
      }, 0);
      return;
    }
    if (!hadDeveloperDialogRef.current) return;
    hadDeveloperDialogRef.current = false;
    const nextTarget = lastFocusedElementRef.current ?? developerButtonRef.current;
    if (nextTarget && document.contains(nextTarget)) {
      nextTarget.focus();
    }
    lastFocusedElementRef.current = null;
  }, [developerOpen]);

  const activeCard = pinnedCard ?? hoverCard;
  const humanResourcesLinks = useMemo(
    () => HUMAN_RESOURCES_LINKS.map((item) => ({
      ...item,
      resolvedHref: adminHostRuntime ? item.href : toAdminInternalPath(item.href),
    })),
    [adminHostRuntime],
  );
  const settingsHref = useMemo(
    () => (adminHostRuntime ? "/settings" : toAdminInternalPath("/settings")),
    [adminHostRuntime],
  );
  const canOpenSettings = useMemo(() => {
    if (!adminHostRuntime) return false;
    if (!adminSessionPayload?.adminAuthenticated) return false;
    return String(adminSessionPayload.staff?.department || "").trim().toUpperCase() === "COMMAND";
  }, [adminHostRuntime, adminSessionPayload]);

  const systemTone: "live" | "at_risk" | "down" | "unknown" = useMemo(() => {
    if (summary.downCount > 0) return "down";
    if (summary.atRiskCount > 0) return "at_risk";
    if (summary.allLive) return "live";
    return "unknown";
  }, [summary.allLive, summary.atRiskCount, summary.downCount]);

  const systemSummary = useMemo(() => {
    if (summary.allLive) return "No recent errors or warnings.";
    if (summary.downCount > 0 && summary.atRiskCount > 0) {
      return `${summary.downCount} service${summary.downCount === 1 ? "" : "s"} down, ${summary.atRiskCount} at risk.`;
    }
    if (summary.downCount > 0) {
      return `${summary.downCount} service${summary.downCount === 1 ? "" : "s"} down.`;
    }
    if (summary.atRiskCount > 0) {
      return `${summary.atRiskCount} service${summary.atRiskCount === 1 ? "" : "s"} at risk.`;
    }
    return "Status checks are still warming.";
  }, [summary.allLive, summary.atRiskCount, summary.downCount]);

  const systemHealthLabel = useMemo(() => {
    if (systemTone === "live") return "Live";
    if (systemTone === "at_risk") return "At risk";
    if (systemTone === "down") return "Down";
    return "Unknown";
  }, [systemTone]);

  const systemIconToneClass = useMemo(() => {
    if (systemTone === "at_risk") return styles.systemMetricIconRisk;
    if (systemTone === "down") return styles.systemMetricIconDown;
    return styles.systemMetricIconLive;
  }, [systemTone]);

  const apiSnapshot = useMemo(() => {
    if (metricsPayload?.ok) {
      const totalRequests = metricsPayload.apiActivity.totalRequests;
      const failedRequests = metricsPayload.apiActivity.failedRequests;
      return {
        available: true,
        totalRequests,
        failedRequests,
        periodLabel: metricsPayload.apiActivity.periodLabel,
        summary:
          totalRequests > 0
            ? `${pluralize(totalRequests, "request")} recorded.`
            : "No recent API activity yet.",
        detail:
          totalRequests > 0
            ? failedRequests > 0
              ? `${pluralize(failedRequests, "request")} blocked or failed.`
              : "No blocked or failed requests."
            : null,
      };
    }
    if (metricsPayload && !metricsPayload.ok) {
      return {
        available: false,
        message: "No recent API activity yet.",
        detail:
          metricsPayload.reason === "UNAUTHENTICATED"
            ? "Sign in to load workspace metrics."
            : "Metrics are still syncing.",
      };
    }
    if (metricsError) {
      return {
        available: false,
        message: "No recent API activity yet.",
        detail: "Metrics are still syncing.",
      };
    }
    return {
      available: false,
      message: "Loading API activity…",
      detail: null,
    };
  }, [metricsError, metricsPayload]);

  const destinationSnapshot = useMemo(() => {
    if (metricsPayload?.ok) {
      const activeDestinations = metricsPayload.eventDestinationActivity.activeDestinations;
      const recentActivity = metricsPayload.eventDestinationActivity.recentActivity;
      return {
        available: true,
        activeDestinations,
        recentActivity,
        periodLabel: metricsPayload.eventDestinationActivity.periodLabel,
        lastActivityAt: metricsPayload.eventDestinationActivity.lastActivityAt,
        summary:
          recentActivity > 0
            ? `${pluralize(recentActivity, "recent event")} delivered or received.`
            : "No recent destination activity yet.",
        detail:
          activeDestinations > 0
            ? `${pluralize(activeDestinations, "active destination")} standing by.`
            : null,
      };
    }
    if (metricsPayload && !metricsPayload.ok) {
      return {
        available: false,
        message: "No recent destination activity yet.",
        detail:
          metricsPayload.reason === "UNAUTHENTICATED"
            ? "Sign in to load workspace metrics."
            : "Metrics are still syncing.",
      };
    }
    if (metricsError) {
      return {
        available: false,
        message: "No recent destination activity yet.",
        detail: "Metrics are still syncing.",
      };
    }
    return {
      available: false,
      message: "Loading destination activity…",
      detail: null,
    };
  }, [metricsError, metricsPayload]);

  function pinOrCloseCard(key: FooterCardKey) {
    setPinnedCard((current) => {
      const next = current === key ? null : key;
      setHoverCard(next);
      return next;
    });
  }

  function onCardFocus(key: FooterCardKey) {
    if (!pinnedCard || pinnedCard === key) {
      setHoverCard(key);
    }
  }

  function onCardBlur(key: FooterCardKey, event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (!pinnedCard) {
      setHoverCard((current) => (current === key ? null : current));
    }
  }

  function onCardEnter(key: FooterCardKey) {
    if (!canHover || pinnedCard) return;
    setHoverCard(key);
  }

  function onCardLeave(key: FooterCardKey) {
    if (!canHover || pinnedCard) return;
    setHoverCard((current) => (current === key ? null : current));
  }

  return (
    <>
      <footer className={styles.footer} aria-label="CavBot system footer" ref={footerRef}>
        <div className={styles.inner}>
          <div className={styles.left}>
            {adminHostRuntime ? (
              <details ref={humanResourcesDetailsRef} className={styles.developerDisclosure}>
                <summary className={styles.developerButton} aria-controls="cb-footer-human-resources-panel">
                  <Image
                    src="/icons/app/hq/human-resources-svgrepo-com.svg"
                    alt=""
                    aria-hidden="true"
                    width={14}
                    height={14}
                    className={styles.developerIcon}
                    unoptimized
                  />
                  <span>Human Resources</span>
                </summary>
                <section
                  id="cb-footer-human-resources-panel"
                  className={styles.developerPanel}
                  role="menu"
                  aria-label="Human resources links"
                >
                  <div className={styles.developerHeader}>
                    <div className={styles.developerTitle}>Human Resources</div>
                    <button
                      type="button"
                      className={styles.developerClose}
                      aria-label="Close human resources panel"
                      onClick={() => {
                        if (humanResourcesDetailsRef.current) {
                          humanResourcesDetailsRef.current.open = false;
                        }
                      }}
                    >
                      <span className="cb-closeIcon" aria-hidden="true" />
                    </button>
                  </div>
                  <div className={styles.developerLinks}>
                    {humanResourcesLinks.map((item) => (
                      <Link
                        key={item.href}
                        href={item.resolvedHref}
                        className={styles.developerLink}
                        onClick={() => {
                          if (humanResourcesDetailsRef.current) {
                            humanResourcesDetailsRef.current.open = false;
                          }
                        }}
                      >
                        <span className={styles.developerLinkIcon} aria-hidden="true">
                          <Image
                            src={item.iconSrc}
                            alt=""
                            width={15}
                            height={15}
                            className={styles.developerLinkIconImage}
                            unoptimized
                          />
                        </span>
                        <span className={styles.developerLinkBody}>
                          <span className={styles.developerLinkTitle}>{item.label}</span>
                          <span className={styles.developerLinkSub}>{item.sub}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              </details>
            ) : (
              <button
                ref={developerButtonRef}
                type="button"
                className={styles.developerButton}
                onClick={() => {
                  setHoverCard(null);
                  setPinnedCard(null);
                  setDeveloperOpen(true);
                }}
                aria-haspopup="dialog"
                aria-expanded={developerOpen ? "true" : "false"}
                aria-controls="cb-footer-developer-panel"
              >
                <Image
                  src="/icons/app/code-svgrepo-com.svg"
                  alt=""
                  aria-hidden="true"
                  width={14}
                  height={14}
                  className={styles.developerIcon}
                  unoptimized
                />
                <span>Developers</span>
              </button>
            )}
          </div>

          <div className={styles.center} aria-hidden="true" />

          <div className={styles.right} aria-label="System metrics">
            <div
              className={styles.metric}
              onMouseEnter={() => onCardEnter("system")}
              onMouseLeave={() => onCardLeave("system")}
              onFocusCapture={() => onCardFocus("system")}
              onBlurCapture={(event) => onCardBlur("system", event)}
            >
              <Link
                href="/status"
                className={styles.metricButton}
                aria-label="Open live system status page"
                target="_blank"
                rel="noopener noreferrer"
                prefetch={false}
              >
                <span className={styles.metricIcon}>
                  <span className={`${styles.systemMetricIcon} ${systemIconToneClass}`} aria-hidden="true" />
                </span>
              </Link>
              <div
                id={systemCardId}
                className={`${styles.card} ${activeCard === "system" ? styles.cardOpen : ""}`}
                role="tooltip"
                aria-label="System status details"
              >
                <div className={styles.cardTitle}>System status</div>
                <div className={`${styles.cardLine} ${styles.cardHealthLine}`}>
                  <span>Health: {systemHealthLabel}</span>
                  <span
                    className={`${styles.statusDot} ${styles.cardInlineStatusDot} ${
                      systemTone === "live"
                        ? styles.statusLive
                        : systemTone === "at_risk"
                        ? styles.statusRisk
                        : systemTone === "down"
                        ? styles.statusDown
                        : styles.statusUnknown
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <div className={styles.cardLine}>{systemSummary}</div>
                <div className={styles.cardMeta}>Last check: {summarizeAgeLabel(checkedAt)}</div>
              </div>
            </div>

            <div
              className={styles.metric}
              onMouseEnter={() => onCardEnter("api")}
              onMouseLeave={() => onCardLeave("api")}
              onFocusCapture={() => onCardFocus("api")}
              onBlurCapture={(event) => onCardBlur("api", event)}
            >
              <button
                type="button"
                className={styles.metricButton}
                onClick={() => pinOrCloseCard("api")}
                aria-label="API activity"
                aria-haspopup="dialog"
                aria-controls={apiCardId}
                aria-expanded={activeCard === "api" ? "true" : "false"}
              >
                <span className={styles.metricIcon}>
                  <Image
                    src="/icons/app/api-activity-svgrepo-com.svg"
                    alt=""
                    aria-hidden="true"
                    width={14}
                    height={14}
                    className={styles.metricIconImage}
                    unoptimized
                  />
                </span>
              </button>
              <div
                id={apiCardId}
                className={`${styles.card} ${activeCard === "api" ? styles.cardOpen : ""}`}
                role="tooltip"
                aria-label="API activity details"
              >
                <div className={styles.cardTitle}>API activity</div>
                {apiSnapshot.available ? (
                  <>
                    <div className={styles.cardLine}>{apiSnapshot.summary}</div>
                    {apiSnapshot.detail ? <div className={styles.cardLine}>{apiSnapshot.detail}</div> : null}
                    <div className={styles.cardMeta}>Window: {apiSnapshot.periodLabel}</div>
                  </>
                ) : (
                  <>
                    <div className={styles.cardLine}>{apiSnapshot.message}</div>
                    {apiSnapshot.detail ? <div className={styles.cardMeta}>{apiSnapshot.detail}</div> : null}
                  </>
                )}
              </div>
            </div>

            <div
              className={styles.metric}
              onMouseEnter={() => onCardEnter("destination")}
              onMouseLeave={() => onCardLeave("destination")}
              onFocusCapture={() => onCardFocus("destination")}
              onBlurCapture={(event) => onCardBlur("destination", event)}
            >
              <button
                type="button"
                className={styles.metricButton}
                onClick={() => pinOrCloseCard("destination")}
                aria-label="Event destination activity"
                aria-haspopup="dialog"
                aria-controls={destinationCardId}
                aria-expanded={activeCard === "destination" ? "true" : "false"}
              >
                <span className={styles.metricIcon}>
                  <Image
                    src="/icons/app/webhook-svgrepo-com.svg"
                    alt=""
                    aria-hidden="true"
                    width={14}
                    height={14}
                    className={styles.metricIconImage}
                    unoptimized
                  />
                </span>
              </button>
              <div
                id={destinationCardId}
                className={`${styles.card} ${activeCard === "destination" ? styles.cardOpen : ""}`}
                role="tooltip"
                aria-label="Event destination details"
              >
                <div className={styles.cardTitle}>Event destination activity</div>
                {destinationSnapshot.available ? (
                  <>
                    <div className={styles.cardLine}>{destinationSnapshot.summary}</div>
                    {destinationSnapshot.detail ? (
                      <div className={styles.cardLine}>{destinationSnapshot.detail}</div>
                    ) : null}
                    <div className={styles.cardMeta}>Window: {destinationSnapshot.periodLabel}</div>
                    {destinationSnapshot.lastActivityAt ? (
                      <div className={styles.cardMeta}>
                        Last activity: {formatDateTime(destinationSnapshot.lastActivityAt)}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className={styles.cardLine}>{destinationSnapshot.message}</div>
                    {destinationSnapshot.detail ? (
                      <div className={styles.cardMeta}>{destinationSnapshot.detail}</div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {canOpenSettings ? (
              <div className={styles.metric}>
                <Link
                  href={settingsHref}
                  className={styles.metricButton}
                  aria-label="HQ settings"
                  title="HQ settings"
                >
                  <span className={styles.metricIcon}>
                    <Image
                      src="/icons/app/settings-svgrepo-com.svg"
                      alt=""
                      aria-hidden="true"
                      width={14}
                      height={14}
                      className={`${styles.metricIconImage} ${styles.metricIconImageSettings}`}
                      unoptimized
                    />
                  </span>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </footer>

      {!adminHostRuntime && developerOpen ? (
        <div className={styles.developerOverlay} onClick={() => setDeveloperOpen(false)}>
          <section
            id="cb-footer-developer-panel"
            className={`${styles.developerPanel} ${developerOpen ? styles.developerPanelOpen : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Developer links"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.developerHeader}>
              <div className={styles.developerTitle}>Developers</div>
              <button
                type="button"
                className={styles.developerClose}
                aria-label="Close developers panel"
                onClick={() => setDeveloperOpen(false)}
              >
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className={styles.developerLinks}>
              {DEVELOPER_LINKS.map((item, index) => (
                <Link
                  key={item.href}
                  ref={index === 0 ? developerFirstLinkRef : undefined}
                  href={item.href}
                  className={styles.developerLink}
                  onClick={() => setDeveloperOpen(false)}
                >
                  <span className={styles.developerLinkIcon} aria-hidden="true">
                    <Image
                      src={item.iconSrc}
                      alt=""
                      width={15}
                      height={15}
                      className={styles.developerLinkIconImage}
                      unoptimized
                    />
                  </span>
                  <span className={styles.developerLinkBody}>
                    <span className={styles.developerLinkTitle}>{item.label}</span>
                    <span className={styles.developerLinkSub}>{item.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
