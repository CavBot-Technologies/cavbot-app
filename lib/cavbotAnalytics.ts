// lib/cavbotAnalytics.ts
"use client";

type Payload = Record<string, unknown>;

type CavbotClient = {
  track?: (name: string, payload?: Payload, options?: Payload) => void;
  trackPageView?: (pageType?: string, component?: string, payload?: Payload) => void;
  trackConsole?: (event: string, payload?: Payload) => void;
  trackError?: (kind: string, details?: Payload, options?: Payload) => void;
  flush?: () => void;
  __queue?: Array<() => void>;
};

type CavbotAnalyticsHost = CavbotClient & {
  __queue?: Array<() => void>;
};

const SDK_ENV_DEFAULT = "prod";
const SDK_VERSION_DEFAULT = "local";

function getClient(): CavbotClient | undefined {
  if (typeof window === "undefined") return undefined;
  return window.cavbotAnalytics;
}

function ensureQueueHost(): CavbotAnalyticsHost & { __queue: Array<() => void> } {
  const host = window.cavbotAnalytics ?? {};
  if (!host.__queue) host.__queue = [];
  window.cavbotAnalytics = host;
  return host as CavbotAnalyticsHost & { __queue: Array<() => void> };
}

function drainQueueIfReady() {
  const c = getClient();
  if (!c?.__queue || c.__queue.length === 0) return;

  const hasAnyHandler =
    typeof c.track === "function" ||
    typeof c.trackPageView === "function" ||
    typeof c.trackConsole === "function" ||
    typeof c.trackError === "function" ||
    typeof c.flush === "function";

  if (!hasAnyHandler) return;

  const q = c.__queue.splice(0, c.__queue.length);
  for (const fn of q) {
    try {
      fn();
    } catch {
      // never let analytics break UI
    }
  }
}

function safePageUrlNoQueryNoHash(): string {
  try {
    const u = new URL(window.location.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

function getBaseContext(): Payload {
  if (typeof window === "undefined") return {};

  const origin = window.location.origin;
  const href = window.location.href;
  const path = window.location.pathname;
  const host = window.location.host;

  const pageUrl = safePageUrlNoQueryNoHash();

  const cav = window.__CAVBOT__ ?? {};

  return {
    origin,
    href,
    pageUrl,
    routePath: path,
    url: href,
    path,
    host,
    siteOrigin: cav.siteOrigin || origin,
    siteHost: host,
    sitePublicId: cav.sitePublicId || null,
    sdkVersion: cav.sdkVersion || SDK_VERSION_DEFAULT,
    env: cav.env || SDK_ENV_DEFAULT,
    referrer: typeof document !== "undefined" ? document.referrer || null : null,
  };
}

function mergePayload(payload?: Payload): Payload {
  return { ...getBaseContext(), ...(payload || {}) };
}

function enqueue(fn: () => void) {
  if (typeof window === "undefined") return;
  const host = ensureQueueHost();
  host.__queue.push(fn);
}

function callOrQueue(fnName: keyof CavbotClient, invoke: (c: CavbotClient) => void) {
  const client = getClient();

  if (client && typeof client[fnName] === "function") {
    invoke(client);
    drainQueueIfReady();
    return;
  }

  enqueue(() => {
    const c2 = getClient();
    if (c2 && typeof c2[fnName] === "function") invoke(c2);
  });

  drainQueueIfReady();
}

export function track(name: string, payload?: Payload, options?: Payload) {
  if (typeof window === "undefined") return;

  callOrQueue("track", (c) => {
    c.track?.(name, mergePayload(payload), options);
  });
}

export function trackPageView(pageType?: string, component?: string, extraPayload?: Payload) {
  if (typeof window === "undefined") return;

  const merged = mergePayload(extraPayload);

  callOrQueue("trackPageView", (c) => {
    c.trackPageView?.(pageType, component, merged);
  });

  const client = getClient();
  if (!client?.trackPageView && typeof client?.track === "function") {
    client.track(
      "cavbot_page_view",
      mergePayload({
        manual: true,
        pageType: pageType || null,
        component: component || null,
        ...(extraPayload || {}),
      }),
      { component: component || "page-shell", pageType: pageType || "marketing-page" }
    );
  }
}

export function trackConsole(event: string, payload?: Payload) {
  if (typeof window === "undefined") return;

  callOrQueue("trackConsole", (c) => {
    c.trackConsole?.(event, mergePayload(payload));
  });

  const client = getClient();
  if (!client?.trackConsole && typeof client?.track === "function") {
    client.track("cavbot_console_event", mergePayload({ event, ...(payload || {}) }), {
      component: "console",
    });
  }
}

function getComponentFromOptions(options?: Payload): string {
  if (!options || typeof options !== "object") return "client";
  const candidate = (options as { component?: unknown }).component;
  return typeof candidate === "string" && candidate ? candidate : "client";
}

export function trackError(kind: string, details?: Payload, options?: Payload) {
  if (typeof window === "undefined") return;

  callOrQueue("trackError", (c) => {
    c.trackError?.(kind, mergePayload(details), options);
  });

  const client = getClient();
  if (!client?.trackError && typeof client?.track === "function") {
    client.track(
      "cavbot_error",
      mergePayload({ kind, ...(details || {}) }),
      { ...(options || {}), component: getComponentFromOptions(options) }
    );
  }
}

export function flush() {
  if (typeof window === "undefined") return;

  callOrQueue("flush", (c) => {
    c.flush?.();
  });
}

const cavbotAnalytics = { track, trackPageView, trackConsole, trackError, flush };
export default cavbotAnalytics;
