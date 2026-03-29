"use client";

import { useEffect, useMemo, useRef } from "react";
import { useBrowserRouteSnapshot } from "./useBrowserRouteSnapshot";
import {
  installRoutePerfObservers,
  recordRouteCommit,
  shouldEnableLayoutDiagnostics,
  shouldEnableRoutePerf,
  traceRenderCount,
} from "@/lib/dev/routePerf";

const TRANSIENT_BODY_CLASSES = [
  "cb-modal-open",
  "cb-modals-lock",
  "cb-console-lock",
  "modal-open",
  "is-locked",
  "cb-home-delete-open",
  "cb-no-motion",
  "cb-pay-processing",
  "cb-pay-success",
  "cb-loading-screen",
  "cb-security-session-delete-open",
  "modal-lock",
];

const TRANSIENT_HTML_CLASSES = [
  "cb-no-motion",
  "modal-lock",
];

const TRANSIENT_BODY_STYLES = [
  "overflow",
  "overscroll-behavior",
  "touch-action",
  "pointer-events",
  "position",
  "top",
  "left",
  "right",
  "bottom",
  "width",
  "height",
  "min-height",
  "transform",
  "padding-right",
];

const TRANSIENT_HTML_STYLES = [
  "overflow",
  "overscroll-behavior",
  "touch-action",
  "pointer-events",
  "position",
  "transform",
];

const TRACKER_NODE_SELECTOR = "[data-cavbot-head], .cavbot-dm-avatar, .cavbot-eye-pupil";
const RUNTIME_RECOVERY_COOLDOWN_MS = 10_000;
const RUNTIME_RECOVERY_GUARD_PREFIX = "cb_runtime_recover";
const LAYOUT_DIAG_CSS_VARS = [
  "--safe-top",
  "--safe-bottom",
  "--r-lg",
  "--r-md",
  "--r-sm",
  "--pad-lg",
  "--pad-md",
  "--pad-sm",
] as const;

 function captureCssFingerprint() {
   if (typeof document === "undefined") return [];
   const nodes = Array.from(
     document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
       'link[rel="stylesheet"], style[data-nextcss], style[id]'
     )
   );
   const entries: string[] = [];
   nodes.forEach((node, idx) => {
     const href = node.getAttribute("href");
     const dataHref = node.getAttribute("data-n-href") || node.getAttribute("data-nextcss");
     const id = node.getAttribute("id");
     const tag = node.tagName;
     const candidate = href || dataHref || id || `${tag}-${idx}`;
     if (candidate) entries.push(candidate);
   });
   entries.sort();
   return entries;
}

function computeCssDiff(prev: string[], next: string[]) {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  const added = next.filter((value) => !prevSet.has(value));
  const removed = prev.filter((value) => !nextSet.has(value));
  return { added, removed };
}

function clearTransientBodyState(pathname: string) {
  if (typeof document === "undefined") return;
  try {
    const body = document.body;
    const html = document.documentElement;

    TRANSIENT_HTML_CLASSES.forEach((cls) => html.classList.remove(cls));
    TRANSIENT_BODY_CLASSES.forEach((cls) => body.classList.remove(cls));
    TRANSIENT_BODY_STYLES.forEach((prop) => body.style.removeProperty(prop));
    TRANSIENT_HTML_STYLES.forEach((prop) => html.style.removeProperty(prop));

    body.dataset.route = pathname;
    html.dataset.route = pathname;

    // Force reflow to clear stale styles
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    html.offsetHeight;
  } catch {
    // ignore
  }
}

function removeLeakedNextNotFoundStyles(pathname: string) {
  void pathname;
  // NOTE:
  // Do not remove style nodes manually here.
  // Next.js head/style reconciliation can concurrently detach these nodes;
  // manual removal can race and surface Safari runtime errors like:
  // "null is not an object (evaluating 'e.parentNode.removeChild')".
  // Keep this as a no-op to avoid interfering with framework-managed head updates.
}

function readLayoutCssVars(html: HTMLElement) {
  const computed = window.getComputedStyle(html);
  const out: Record<string, string> = {};
  for (const key of LAYOUT_DIAG_CSS_VARS) {
    const value = computed.getPropertyValue(key).trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function rectSnapshot(el: Element | null) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}

function collectLayoutGlobals(pathname: string) {
  const html = document.documentElement;
  const body = document.body;
  const main = document.getElementById("main");
  const shell = document.querySelector(".cb-shell");
  return {
    route: pathname,
    ts: new Date().toISOString(),
    htmlClassName: html.className,
    bodyClassName: body.className,
    htmlInlineStyle: html.getAttribute("style") || "",
    bodyInlineStyle: body.getAttribute("style") || "",
    shellClassName: shell instanceof HTMLElement ? shell.className : "",
    shellInlineStyle: shell instanceof HTMLElement ? shell.getAttribute("style") || "" : "",
    rootClassName: main instanceof HTMLElement ? main.className : "",
    rootInlineStyle: main instanceof HTMLElement ? main.getAttribute("style") || "" : "",
    cssVars: readLayoutCssVars(html),
  };
}

function runHomeLayoutSanity(pathname: string) {
  if (pathname !== "/") return null;

  const profileHead = document.querySelector('[data-cb-layout-anchor="profile-head"]');
  const websitesHead = document.querySelector('[data-cb-layout-anchor="websites-head"]');
  const profileAccountLink = document.querySelector('[data-cb-layout-anchor="profile-account-link"]');
  const websitesManageBtn = document.querySelector('[data-cb-layout-anchor="websites-manage-btn"]');

  const profileRect = rectSnapshot(profileHead);
  const websitesRect = rectSnapshot(websitesHead);
  const accountRect = rectSnapshot(profileAccountLink);
  const manageRect = rectSnapshot(websitesManageBtn);

  const profileDisplay = profileHead instanceof Element ? getComputedStyle(profileHead).display : "missing";
  const websitesDisplay = websitesHead instanceof Element ? getComputedStyle(websitesHead).display : "missing";

  const warnings: string[] = [];
  if (!profileRect) warnings.push("missing-profile-head");
  if (!websitesRect) warnings.push("missing-websites-head");
  if (!accountRect) warnings.push("missing-profile-account-link");
  if (!manageRect) warnings.push("missing-websites-manage-btn");

  if (profileDisplay !== "block") warnings.push(`profile-head-display-${profileDisplay}`);
  if (websitesDisplay !== "block") warnings.push(`websites-head-display-${websitesDisplay}`);

  if (profileRect && websitesRect && websitesRect.y <= profileRect.y + 200) {
    warnings.push("websites-head-not-below-profile");
  }

  if (profileRect && accountRect) {
    const withinProfileY = accountRect.y >= profileRect.y - 2 && accountRect.y + accountRect.h <= profileRect.y + profileRect.h + 2;
    if (!withinProfileY) warnings.push("profile-account-link-outside-head");
  }

  if (websitesRect && manageRect) {
    const withinWebsitesY = manageRect.y >= websitesRect.y - 2 && manageRect.y + manageRect.h <= websitesRect.y + websitesRect.h + 2;
    if (!withinWebsitesY) warnings.push("websites-manage-btn-outside-head");
  }

  return {
    ok: warnings.length === 0,
    route: pathname,
    ts: new Date().toISOString(),
    profileDisplay,
    websitesDisplay,
    profileRect,
    websitesRect,
    accountRect,
    manageRect,
    warnings,
  };
}

function shouldRecoverRuntimeError(message: string): boolean {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("chunkloaderror") ||
    text.includes("loading chunk") ||
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("dynamically imported module") ||
    text.includes("loading css chunk") ||
    text.includes("cannot find module") ||
    text.includes("parentnode.removechild") ||
    text.includes("evaluating 'e.parentnode.removechild'") ||
    text.includes("reading 'removechild'") ||
    text.includes("read properties of null (reading 'removechild')")
  );
}

function runtimeErrorText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (value instanceof Error) return `${value.name} ${value.message}`.toLowerCase();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `${String(obj.name || "")} ${String(obj.message || "")}`.toLowerCase();
  }
  return String(value).toLowerCase();
}

function isBenignRuntimeCancellation(value: unknown): boolean {
  const text = runtimeErrorText(value);
  if (!text) return false;
  return (
    text.includes("canceled") ||
    text.includes("cancelled") ||
    text.includes("operation canceled") ||
    text.includes("operation cancelled") ||
    text.includes("aborterror") ||
    text.includes("aborted")
  );
}

function triggerRuntimeRecovery(pathname: string): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${RUNTIME_RECOVERY_GUARD_PREFIX}:${pathname || "/"}`;
    const now = Date.now();
    const prev = Number(globalThis.__cbSessionStore.getItem(key) || "0") || 0;
    if (now - prev < RUNTIME_RECOVERY_COOLDOWN_MS) return;
    globalThis.__cbSessionStore.setItem(key, String(now));
  } catch {
    // ignore guard failures; still attempt recovery
  }

  try {
    window.location.reload();
  } catch {
    // ignore
  }
}

function refreshTrackers() {
  if (typeof window === "undefined") return;
  const callHead = () => {
    if (typeof window.__cavaiHeadTrackingRefresh === "function") {
      window.__cavaiHeadTrackingRefresh();
    } else if (window.cavai && typeof window.cavai.enableHeadTracking === "function") {
      window.cavai.enableHeadTracking();
    }
  };
  const callEye = () => {
    if (typeof window.__cavaiEyeTrackingRefresh === "function") {
      window.__cavaiEyeTrackingRefresh();
    }
  };
  requestAnimationFrame(() => {
    callHead();
    callEye();
  });
}

function nodeContainsTrackerTarget(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (node.matches(TRACKER_NODE_SELECTOR)) return true;
  return Boolean(node.querySelector(TRACKER_NODE_SELECTOR));
}

export default function RouteLifecycle() {
  const { pathname, search, searchParamsValue } = useBrowserRouteSnapshot();
  const instrumentLogging = useMemo(
    () => shouldEnableRoutePerf(searchParamsValue),
    [searchParamsValue],
  );
  const layoutDiagnosticsEnabled = useMemo(
    () => shouldEnableLayoutDiagnostics(searchParamsValue),
    [searchParamsValue],
  );
  const cssRef = useRef<string[]>([]);
  const routeCountRef = useRef(0);
  const prevPathRef = useRef<string | null>(null);
  const prevBadgeCountRef = useRef<number>(0);
  const observerRefreshQueuedRef = useRef(false);
  const swMountEvictedRef = useRef(false);
  const renderCountRef = useRef(0);

  useEffect(() => {
    renderCountRef.current += 1;
    traceRenderCount("RouteLifecycleProvider", instrumentLogging, {
      route: pathname,
      renderCount: renderCountRef.current,
    });
  }, [instrumentLogging, pathname, search]);

  useEffect(() => {
    if (!instrumentLogging) return;
    const teardown = installRoutePerfObservers(true);
    return () => teardown();
  }, [instrumentLogging]);

  useEffect(() => {
    if (!instrumentLogging) return;
    recordRouteCommit(pathname, search);
  }, [instrumentLogging, pathname, search]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    routeCountRef.current += 1;
    clearTransientBodyState(pathname);
    removeLeakedNextNotFoundStyles(pathname);
    const badgeCount = document.querySelectorAll("[data-cavbot-head], .cavbot-dm-avatar").length;
    const pathnameChanged = prevPathRef.current !== pathname;
    const badgeCountChanged = prevBadgeCountRef.current !== badgeCount;
    // Root-cause fix: avoid re-basing CavAi transforms on every query-param update.
    // CavCloud/CavSafe folder/file clicks update search params frequently; forcing tracker
    // refresh each time can accumulate inline transforms and push pupils out of view.
    if (pathnameChanged || badgeCountChanged) {
      refreshTrackers();
    }
    prevPathRef.current = pathname;
    prevBadgeCountRef.current = badgeCount;
    const cssEntries = captureCssFingerprint();
    const diff = computeCssDiff(cssRef.current, cssEntries);
    cssRef.current = cssEntries;

    if (layoutDiagnosticsEnabled) {
      console.debug("[cb-layout][route-change]", collectLayoutGlobals(pathname));
      const sanity = runHomeLayoutSanity(pathname);
      if (sanity && !sanity.ok) {
        console.warn("[cb-layout][sanity-check]", sanity);
      } else if (sanity) {
        console.debug("[cb-layout][sanity-check]", sanity);
      }
    }

    if (!instrumentLogging) return;

    const headReady = Boolean(window.__cavbotHeadTrackingReady);
    const eyeReady = Boolean(window.__cavbotEyeTrackingReady);
    console.debug("RouteLifecycle", {
      route: pathname,
      badgeCount,
      routeCount: routeCountRef.current,
      headTracking: {
        ready: headReady,
        lastRefresh: window.__cavbotHeadTrackingLastRefresh,
        headCount: window.__cavbotHeadTrackingHeadCount,
      },
      eyeTracking: {
        ready: eyeReady,
        lastRefresh: window.__cavbotEyeTrackingLastRefresh,
      },
      cssFingerprint: {
        total: cssEntries.length,
        added: diff.added,
        removed: diff.removed,
      },
    });
  }, [pathname, instrumentLogging, layoutDiagnosticsEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onError = (event: ErrorEvent) => {
      if (isBenignRuntimeCancellation(event?.error) || isBenignRuntimeCancellation(event?.message)) {
        event.preventDefault();
        return;
      }
      const message = String(event?.message || event?.error?.message || "");
      if (shouldRecoverRuntimeError(message)) {
        event.preventDefault();
        triggerRuntimeRecovery(pathname);
        return;
      }
      if (!instrumentLogging) return;
      console.debug("RouteLifecycle error", {
        route: pathname,
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error ? event.error.stack : undefined,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isBenignRuntimeCancellation(event?.reason)) {
        event.preventDefault();
        return;
      }
      const reasonObj = event?.reason as { message?: unknown } | null | undefined;
      const reasonText =
        typeof event?.reason === "string"
          ? event.reason
          : String(reasonObj?.message || "");
      if (shouldRecoverRuntimeError(reasonText)) {
        event.preventDefault();
        triggerRuntimeRecovery(pathname);
        return;
      }
      if (!instrumentLogging) return;
      console.debug("RouteLifecycle rejection", {
        route: pathname,
        reason: event.reason,
        stack: event.reason && event.reason.stack,
      });
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, [instrumentLogging, pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const root = document.body;
    if (!root || typeof MutationObserver === "undefined") return;

    let rafId = 0;
    const queueRefresh = () => {
      if (observerRefreshQueuedRef.current) return;
      observerRefreshQueuedRef.current = true;
      rafId = window.requestAnimationFrame(() => {
        observerRefreshQueuedRef.current = false;
        refreshTrackers();
      });
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;
        for (const node of mutation.addedNodes) {
          if (!nodeContainsTrackerTarget(node)) continue;
          queueRefresh();
          return;
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      observerRefreshQueuedRef.current = false;
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (pathname.startsWith("/cavcode-viewer")) {
      swMountEvictedRef.current = false;
      return;
    }
    if (swMountEvictedRef.current) return;

    let canceled = false;
    swMountEvictedRef.current = true;
    void (async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (canceled) return;

        const mountRegistrations = registrations.filter((registration) => {
          const script = String(
            registration.active?.scriptURL ||
              registration.waiting?.scriptURL ||
              registration.installing?.scriptURL ||
              "",
          ).trim();
          return (
            script.includes("/cavcode/sw/mount-runtime.js") ||
            script.includes("/mount-runtime.js")
          );
        });

        if (!mountRegistrations.length) return;
        const clearPayload = {
          type: "CAVCODE_MOUNT_CONTEXT",
          projectId: null,
          shareId: null,
          viewerPrefix: "/cavcode-viewer",
          clear: true,
        };

        try {
          navigator.serviceWorker.controller?.postMessage(clearPayload);
        } catch {
          // ignore
        }

        for (const registration of mountRegistrations) {
          try {
            registration.active?.postMessage(clearPayload);
            registration.waiting?.postMessage(clearPayload);
            registration.installing?.postMessage(clearPayload);
          } catch {
            // ignore
          }
        }

        await Promise.allSettled(mountRegistrations.map((registration) => registration.unregister()));
      } catch {
        swMountEvictedRef.current = false;
      }
    })();

    return () => {
      canceled = true;
    };
  }, [pathname]);

  return null;
}
