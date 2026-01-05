// src/lib/cavbotAnalytics.ts
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

const SDK_ENV_DEFAULT = "prod";
const SDK_VERSION_DEFAULT = "local";

function getClient(): CavbotClient | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).cavbotAnalytics as CavbotClient | undefined;
}

function getBaseContext(): Payload {
  if (typeof window === "undefined") return {};

  const origin = window.location.origin;
  const url = window.location.href;
  const path = window.location.pathname;
  const host = window.location.host;

  const cav = ((window as any).__CAVBOT__ || {}) as {
    sitePublicId?: string;
    siteOrigin?: string;
    env?: string;
    sdkVersion?: string;
  };

  return {
    origin,
    url,
    path,
    host,

    // Company-grade envelope fields (Worker understands these concepts)
    siteOrigin: cav.siteOrigin || origin,
    siteHost: host,
    sitePublicId: cav.sitePublicId || null,
    sdkVersion: cav.sdkVersion || SDK_VERSION_DEFAULT,
    env: cav.env || SDK_ENV_DEFAULT,
  };
}

function mergePayload(payload?: Payload): Payload {
  return { ...getBaseContext(), ...(payload || {}) };
}

function enqueue(fn: () => void) {
  if (typeof window === "undefined") return;

  const client = getClient() as any;
  if (!client) return;

  client.__queue = client.__queue || [];
  client.__queue.push(fn);
}

function callOrQueue(fnName: keyof CavbotClient, invoke: (c: CavbotClient) => void) {
  const client = getClient();

  if (client && typeof client[fnName] === "function") {
    invoke(client);
    return;
  }

  // SDK not loaded yet → queue (optional behavior)
  if (typeof window !== "undefined") {
    enqueue(() => {
      const c2 = getClient();
      if (c2 && typeof c2[fnName] === "function") invoke(c2);
    });
  }
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

  // Back-compat fallback if SDK only supports track()
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
      { ...(options || {}), component: (options as any)?.component || "client" }
    );
  }
}

export function flush() {
  if (typeof window === "undefined") return;

  callOrQueue("flush", (c) => {
    c.flush?.();
  });
}

export default { track, trackPageView, trackConsole, trackError, flush };