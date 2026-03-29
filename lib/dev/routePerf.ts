"use client";

type RoutePerfLongTask = {
  startTime: number;
  duration: number;
};

type RoutePerfPending = {
  id: number;
  href: string;
  from: string;
  source: string;
  clickTs: number;
  navStartTs: number | null;
};

type RoutePerfState = {
  enabled: boolean;
  installed: boolean;
  historyPatched: boolean;
  sequence: number;
  pending: RoutePerfPending | null;
  renderCounts: Record<string, number>;
  longTasks: RoutePerfLongTask[];
  lastNavTarget: string;
  lastNavAt: number;
  originalPushState?: History["pushState"];
  originalReplaceState?: History["replaceState"];
};

declare global {
  interface Window {
    __CB_ROUTE_PERF__?: RoutePerfState;
  }
}

const QUERY_FLAGS = ["cbPerf", "perf", "debugPerf", "routePerf", "debug"];
const STORAGE_FLAGS = ["cb_perf_debug", "cb_route_lifecycle_debug"];
const LAYOUT_QUERY_FLAGS = ["cbLayoutDiag", "layoutDiag", "layoutDebug"];
const LAYOUT_STORAGE_FLAGS = ["cb_layout_diag", "cb_layout_debug"];
const TRUE_FLAGS = new Set(["1", "true", "on", "yes", "debug"]);

function readWindowSearchFallback() {
  if (typeof window === "undefined") return "";
  return window.location.search || "";
}

function isTruthyFlag(value: string | null | undefined) {
  return TRUE_FLAGS.has(String(value || "").trim().toLowerCase());
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function currentPathWithSearch() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

function normalizeInternalHref(rawHref: string) {
  if (!rawHref || typeof window === "undefined") return "";
  try {
    const resolved = new URL(rawHref, window.location.href);
    if (resolved.origin !== window.location.origin) return "";
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return "";
  }
}

function getState() {
  if (typeof window === "undefined") return null;
  if (!window.__CB_ROUTE_PERF__) {
    window.__CB_ROUTE_PERF__ = {
      enabled: false,
      installed: false,
      historyPatched: false,
      sequence: 0,
      pending: null,
      renderCounts: {},
      longTasks: [],
      lastNavTarget: "",
      lastNavAt: 0,
    };
  }
  return window.__CB_ROUTE_PERF__;
}

export function shouldEnableRoutePerf(searchParamString?: string) {
  if (process.env.NODE_ENV === "production") return false;

  const envFlag = String(process.env.NEXT_PUBLIC_CB_PERF_DEBUG || "").trim().toLowerCase();
  if (isTruthyFlag(envFlag)) return true;

  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(searchParamString || readWindowSearchFallback());
    for (const key of QUERY_FLAGS) {
      if (isTruthyFlag(params.get(key))) return true;
    }
  } catch {
    // ignore
  }

  try {
    for (const key of STORAGE_FLAGS) {
      if (isTruthyFlag(globalThis.__cbLocalStore.getItem(key))) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export function shouldEnableLayoutDiagnostics(searchParamString?: string) {
  if (process.env.NODE_ENV === "production") return false;

  const envFlag = String(process.env.NEXT_PUBLIC_CB_LAYOUT_DIAG || "").trim().toLowerCase();
  if (isTruthyFlag(envFlag)) return true;

  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(searchParamString || readWindowSearchFallback());
    for (const key of LAYOUT_QUERY_FLAGS) {
      if (isTruthyFlag(params.get(key))) return true;
    }
  } catch {
    // ignore
  }

  try {
    for (const key of LAYOUT_STORAGE_FLAGS) {
      if (isTruthyFlag(globalThis.__cbLocalStore.getItem(key))) return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export function traceRenderCount(label: string, enabled: boolean, meta?: Record<string, unknown>) {
  if (!enabled || typeof window === "undefined") return;
  const state = getState();
  if (!state) return;
  state.enabled = true;
  const count = (state.renderCounts[label] || 0) + 1;
  state.renderCounts[label] = count;
  console.debug("[cb-perf][render]", {
    label,
    count,
    ...meta,
  });
}

export function recordClickIntent(rawHref: string, source: string, meta?: Record<string, unknown>) {
  const state = getState();
  if (!state || !state.enabled) return;

  const href = normalizeInternalHref(rawHref);
  if (!href) return;

  state.sequence += 1;
  state.pending = {
    id: state.sequence,
    href,
    from: currentPathWithSearch(),
    source,
    clickTs: nowMs(),
    navStartTs: null,
  };

  console.debug("[cb-perf][click-intent]", {
    id: state.pending.id,
    href,
    source,
    from: state.pending.from,
    ...meta,
  });
}

export function recordNavigationStart(rawHref: string, source: string) {
  const state = getState();
  if (!state || !state.enabled) return;

  const href = normalizeInternalHref(rawHref);
  if (!href) return;

  const now = nowMs();
  const current = currentPathWithSearch();
  const duplicate = state.lastNavTarget === href && now - state.lastNavAt <= 400;
  const samePath = href === current;

  const previousNavAt = state.lastNavAt;
  state.lastNavTarget = href;
  state.lastNavAt = now;

  if (duplicate) {
    console.warn("[cb-perf][duplicate-nav]", {
      href,
      source,
      elapsedMs: Math.round(now - previousNavAt),
    });
  }

  if (samePath) {
    console.warn("[cb-perf][same-path-nav]", { href, source, current });
  }

  if (state.pending && (state.pending.href === href || href.startsWith(state.pending.href))) {
    state.pending.navStartTs = now;
  }

  console.debug("[cb-perf][nav-start]", {
    href,
    source,
    current,
    clickToStartMs:
      state.pending && state.pending.navStartTs
        ? Math.round(state.pending.navStartTs - state.pending.clickTs)
        : null,
  });
}

function patchHistoryOnce(state: RoutePerfState) {
  if (state.historyPatched || typeof window === "undefined") return;

  const historyAny = window.history as History & {
    pushState: History["pushState"];
    replaceState: History["replaceState"];
  };

  state.originalPushState = historyAny.pushState.bind(window.history);
  state.originalReplaceState = historyAny.replaceState.bind(window.history);

  historyAny.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
    if (typeof url === "string" || url instanceof URL) {
      recordNavigationStart(String(url), "history.pushState");
    }
    return state.originalPushState?.(data, unused, url);
  }) as History["pushState"];

  historyAny.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
    if (typeof url === "string" || url instanceof URL) {
      recordNavigationStart(String(url), "history.replaceState");
    }
    return state.originalReplaceState?.(data, unused, url);
  }) as History["replaceState"];

  state.historyPatched = true;
}

export function installRoutePerfObservers(enabled: boolean) {
  const state = getState();
  if (!state) return () => {};

  state.enabled = enabled;
  if (!enabled || state.installed || typeof document === "undefined") return () => {};

  patchHistoryOnce(state);

  const onClickCapture = (event: MouseEvent) => {
    const target = event.target as Element | null;
    if (!target) return;

    const overlayTarget = target.closest(".cb-overlay, .cb-notif-overlay, .cb-cavsafe-modal-backdrop");
    if (overlayTarget && overlayTarget instanceof HTMLElement) {
      const classes = Array.from(overlayTarget.classList.values()).join(" ");
      const style = window.getComputedStyle(overlayTarget);
      const intercepting =
        style.pointerEvents !== "none" &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0;

      if (intercepting && !overlayTarget.classList.contains("is-open") && !overlayTarget.classList.contains("cb-cavsafe-modal-backdrop")) {
        console.warn("[cb-perf][overlay-click-intercept]", { classes });
      }
    }

    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
      if (anchor.target === "_blank") return;
      const href = anchor.getAttribute("href") || "";
      if (!href) return;
      recordClickIntent(href, anchor.dataset.cbPerfSource || "anchor", {
        hasDownload: anchor.hasAttribute("download"),
      });
      return;
    }

    const buttonWithIntent = target.closest("button[data-cb-route-intent]") as HTMLButtonElement | null;
    if (buttonWithIntent) {
      const href = buttonWithIntent.dataset.cbRouteIntent || "";
      recordClickIntent(href, buttonWithIntent.dataset.cbPerfSource || "button-intent");
    }
  };

  document.addEventListener("click", onClickCapture, true);

  let longTaskObserver: PerformanceObserver | null = null;
  if (typeof window !== "undefined" && "PerformanceObserver" in window) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const task = {
            startTime: entry.startTime,
            duration: entry.duration,
          };

          state.longTasks.push(task);
          if (state.longTasks.length > 80) {
            state.longTasks = state.longTasks.slice(-80);
          }

          if (!state.pending) continue;
          if (task.startTime < state.pending.clickTs) continue;

          console.debug("[cb-perf][long-task]", {
            duringPendingNav: true,
            startTime: Math.round(task.startTime),
            durationMs: Math.round(task.duration),
            pendingHref: state.pending.href,
          });
        }
      });

      longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      longTaskObserver = null;
    }
  }

  state.installed = true;

  return () => {
    document.removeEventListener("click", onClickCapture, true);
    longTaskObserver?.disconnect();
    state.installed = false;
  };
}

function routeMatchesTarget(committed: string, target: string) {
  if (!committed || !target) return false;
  if (committed === target) return true;
  const [targetPath] = target.split("#");
  const [committedPath] = committed.split("#");
  return committedPath === targetPath;
}

export function recordRouteCommit(pathname: string, search: string) {
  const state = getState();
  if (!state || !state.enabled) return;

  const now = nowMs();
  const committed = `${pathname}${search || ""}`;
  const pending = state.pending;

  if (!pending) {
    console.debug("[cb-perf][commit]", {
      href: committed,
      pending: false,
    });
    return;
  }

  const matched = routeMatchesTarget(committed, pending.href);

  if (!matched) {
    if (pending.from === committed && now - pending.clickTs > 350) {
      console.warn("[cb-perf][same-page-rerender-before-nav]", {
        pendingHref: pending.href,
        committed,
        elapsedMs: Math.round(now - pending.clickTs),
      });
    }
    return;
  }

  const clickToStartMs = pending.navStartTs ? Math.round(pending.navStartTs - pending.clickTs) : null;
  const startToCommitMs = pending.navStartTs ? Math.round(now - pending.navStartTs) : null;
  const clickToCommitMs = Math.round(now - pending.clickTs);

  const longTaskCount = state.longTasks.filter(
    (task) => task.startTime >= pending.clickTs && task.startTime <= now,
  ).length;

  console.debug("[cb-perf][route-commit]", {
    id: pending.id,
    source: pending.source,
    from: pending.from,
    to: committed,
    clickToStartMs,
    startToCommitMs,
    clickToCommitMs,
    longTaskCount,
  });

  state.pending = null;
}
