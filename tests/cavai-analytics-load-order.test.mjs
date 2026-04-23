import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const CAVAI_SOURCE = fs.readFileSync(path.resolve("public/cavai/cavai.js"), "utf8");
const ANALYTICS_SOURCE = fs.readFileSync(path.resolve("public/cavai/cavai-analytics-v5.js"), "utf8");

function createStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
  };
}

function createEventTargetStore() {
  const listeners = new Map();
  function add(type, handler) {
    if (typeof handler !== "function") return;
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  }
  function remove(type, handler) {
    const list = listeners.get(type) || [];
    listeners.set(
      type,
      list.filter((fn) => fn !== handler),
    );
  }
  function dispatch(type, event = {}) {
    const list = listeners.get(type) || [];
    for (const handler of list.slice()) {
      try {
        handler(event);
      } catch {}
    }
  }
  function count(type) {
    return (listeners.get(type) || []).length;
  }
  return { add, remove, dispatch, count };
}

function createHarness() {
  const windowEvents = createEventTargetStore();
  const documentEvents = createEventTargetStore();
  const browserSessionStore = createStorage();
  const consoleErrors = [];
  const fetchCalls = [];

  const documentElement = {
    lang: "en",
    getAttribute(name) {
      if (name === "lang") return this.lang || "";
      return null;
    },
    setAttribute(name, value) {
      if (name === "lang") this.lang = String(value);
    },
    querySelector() {
      return null;
    },
  };

  const body = {
    dataset: {},
    getAttribute() {
      return null;
    },
    setAttribute() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    appendChild() {},
    innerText: "",
  };

  const document = {
    readyState: "loading",
    title: "Test page",
    referrer: "",
    body,
    documentElement,
    currentScript: null,
    addEventListener(type, handler) {
      documentEvents.add(type, handler);
    },
    removeEventListener(type, handler) {
      documentEvents.remove(type, handler);
    },
    dispatchEvent(evt) {
      const type = evt && evt.type ? evt.type : String(evt || "");
      documentEvents.dispatch(type, evt || {});
      return true;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    },
    createElement(tag) {
      return {
        tagName: String(tag || "div").toUpperCase(),
        style: {},
        setAttribute() {},
        getAttribute() {
          return null;
        },
        appendChild() {},
      };
    },
    getElementsByTagName() {
      return [];
    },
  };

  const location = {
    href: "https://example.com/",
    origin: "https://example.com",
    host: "example.com",
    hostname: "example.com",
    pathname: "/",
    search: "",
    hash: "",
  };

  const history = {
    __cavbotPatched: false,
    pushState() {},
    replaceState() {},
  };

  class MutationObserver {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    disconnect() {}
  }

  const win = {
    window: null,
    self: null,
    globalThis: null,
    console: {
      log() {},
      warn() {},
      info() {},
      error(...args) {
        consoleErrors.push(args);
      },
      debug() {},
    },
    location,
    document,
    navigator: {
      doNotTrack: "0",
      language: "en-US",
      platform: "test",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      connection: { effectiveType: "4g", downlink: 10 },
      sendBeacon: undefined,
      onLine: true,
      userAgent: "node-test-agent",
      geolocation: {
        getCurrentPosition(success) {
          success({ coords: { latitude: 33.7, longitude: -84.3 } });
        },
      },
    },
    screen: { width: 1920, height: 1080 },
    history,
    __cbSessionStore: browserSessionStore,
    __cbLocalStore: undefined,
    CAVBOT_PROJECT_KEY: "cavbot_pk_test",
    CAVBOT_SITE_PUBLIC_ID: "site_test",
    CAVBOT_API_URL: "https://api.cavbot.io/v1/events",
    CAVBOT_ENV: "production",
    __CAVBOT_DISABLE_EVENTS__: false,
    __CAVBOT_LIVE_MODE__: false,
    fetch(url, init) {
      fetchCalls.push({ url: String(url), init: init || {} });
      return Promise.resolve({ ok: true, status: 202, json: async () => ({ ok: true }) });
    },
    addEventListener(type, handler) {
      windowEvents.add(type, handler);
    },
    removeEventListener(type, handler) {
      windowEvents.remove(type, handler);
    },
    dispatchEvent(evt) {
      const type = evt && evt.type ? evt.type : String(evt || "");
      windowEvents.dispatch(type, evt || {});
      return true;
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame(cb) {
      return setTimeout(() => cb(Date.now()), 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    requestIdleCallback(cb) {
      return setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0);
    },
    cancelIdleCallback(id) {
      clearTimeout(id);
    },
    URL,
    URLSearchParams,
    Blob,
    Math,
    Date,
    JSON,
    Promise,
    performance: {
      now: () => Date.now(),
      getEntriesByType: () => [],
    },
    PerformanceObserver: class {
      observe() {}
      disconnect() {}
    },
    CSS: {
      escape(value) {
        return String(value);
      },
    },
    getComputedStyle() {
      return {
        transform: "none",
        display: "block",
        visibility: "visible",
        backgroundColor: "rgb(255,255,255)",
        color: "rgb(0,0,0)",
        fontSize: "16px",
        fontWeight: "400",
      };
    },
    MutationObserver,
    crypto: globalThis.crypto,
  };

  win.window = win;
  win.self = win;
  win.globalThis = win;

  return {
    context: vm.createContext(win),
    window: win,
    fetchCalls,
    consoleErrors,
    windowEvents,
  };
}

function runScript(harness, source, filename) {
  vm.runInContext(source, harness.context, { filename });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLink(attrs = {}) {
  const map = { ...attrs };
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    },
    setAttribute(name, value) {
      map[name] = String(value);
    },
  };
}

function createMeta(attrs = {}) {
  const map = { ...attrs };
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
    },
  };
}

function attachHeadFixture(harness, fixture = {}) {
  const links = Array.isArray(fixture.links) ? fixture.links : [];
  const metas = Array.isArray(fixture.metas) ? fixture.metas : [];
  const document = harness.window.document;

  function findMeta(name) {
    const wanted = String(name || "").toLowerCase();
    return (
      metas.find((meta) => String(meta.getAttribute("name") || "").toLowerCase() === wanted) ||
      null
    );
  }

  function findCanonical() {
    return (
      links.find((link) => String(link.getAttribute("rel") || "").toLowerCase() === "canonical") ||
      null
    );
  }

  document.querySelector = function querySelector(selector) {
    const sel = String(selector || "");
    const metaMatch = sel.match(/^meta\[name="([^"]+)"\]$/);
    if (metaMatch) return findMeta(metaMatch[1]);
    if (sel === 'link[rel="canonical"]') return findCanonical();
    return null;
  };

  document.querySelectorAll = function querySelectorAll(selector) {
    const sel = String(selector || "");
    if (sel === "link[rel]") return links;
    if (sel === "h1") return [];
    if (sel === "a[href]") return [];
    if (sel === "img") return [];
    return [];
  };
}

test("CavAi only: no analytics dependency errors and motion API remains callable", async () => {
  const h = createHarness();
  runScript(h, CAVAI_SOURCE, "cavai.js");

  assert.equal(typeof h.window.cavai, "object");
  assert.equal(typeof h.window.cavai.enableHeadTracking, "function");
  await h.window.cavai.trackEvent("cavbot_test_event", { source: "cavai_only" });
  h.window.cavai.enableHeadTracking();

  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.consoleErrors.length, 0);
});

test("v5 only: cavbot_page_view can be queued and flushed without CavAi", async () => {
  const h = createHarness();
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  assert.equal(typeof h.window.cavbotAnalytics, "object");
  await h.window.cavbotAnalytics.track("cavbot_page_view", { source: "v5_only" });
  await h.window.cavbotAnalytics.flush("manual");

  assert.ok(h.fetchCalls.length >= 1);
  const first = h.fetchCalls[0];
  assert.equal(first.url, "https://api.cavbot.io/v1/events");
  const body = JSON.parse(first.init.body || "{}");
  assert.ok(Array.isArray(body.records));
  assert.equal(body.records[0].event_name, "cavbot_page_view");
  assert.equal(h.consoleErrors.length, 0);
});

test("v5 infers the local embed ingest from the script origin when no explicit API url is provided", async () => {
  const h = createHarness();
  delete h.window.CAVBOT_API_URL;
  h.window.document.currentScript = { src: "https://app.cavbot.io/cavai/cavai-analytics-v5.js" };

  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  await h.window.cavbotAnalytics.track("cavbot_page_view", { source: "script_origin_default" });
  await h.window.cavbotAnalytics.flush("manual");

  assert.ok(h.fetchCalls.length >= 1);
  assert.equal(h.fetchCalls[0].url, "https://app.cavbot.io/api/embed/analytics");
});

test("CavAi first then v5: bridge routes cavai.trackEvent to v5.track with no duplicate pointer listeners", async () => {
  const h = createHarness();
  runScript(h, CAVAI_SOURCE, "cavai.js");
  const pointerAfterFirstLoad = h.windowEvents.count("pointermove");

  runScript(h, CAVAI_SOURCE, "cavai.js");
  const pointerAfterSecondLoad = h.windowEvents.count("pointermove");
  assert.equal(pointerAfterSecondLoad, pointerAfterFirstLoad);

  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  let calls = 0;
  const originalTrack = h.window.cavbotAnalytics.track;
  h.window.cavbotAnalytics.track = function (...args) {
    calls += 1;
    return originalTrack.apply(this, args);
  };

  await h.window.cavai.trackEvent("cavbot_bridge_test", { order: "cavai_then_v5" });
  await wait(10);

  assert.equal(calls, 1);
  assert.equal(
    h.window.cavbotAnalytics.getBaseContext({}).session_key,
    h.window.cavai.getSessionId(),
  );
  assert.equal(h.consoleErrors.length, 0);
});

test("v5 first then CavAi: bridge works and session keys align", async () => {
  const h = createHarness();
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");
  runScript(h, CAVAI_SOURCE, "cavai.js");

  let calls = 0;
  const originalTrack = h.window.cavbotAnalytics.track;
  h.window.cavbotAnalytics.track = function (...args) {
    calls += 1;
    return originalTrack.apply(this, args);
  };

  await h.window.cavai.trackEvent("cavbot_bridge_test", { order: "v5_then_cavai" });
  await wait(10);

  assert.equal(calls, 1);
  assert.equal(
    h.window.cavbotAnalytics.getBaseContext({}).session_key,
    h.window.cavai.getSessionId(),
  );
  assert.equal(h.consoleErrors.length, 0);
});

test("navigation refresh does not register duplicate motion listeners", async () => {
  const h = createHarness();
  runScript(h, CAVAI_SOURCE, "cavai.js");
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  const beforePointer = h.windowEvents.count("pointermove");
  const beforeMouse = h.windowEvents.count("mousemove");

  for (let i = 0; i < 6; i++) {
    h.window.location.pathname = `/route-${i}`;
    h.window.dispatchEvent({ type: "popstate" });
    if (typeof h.window.__cavaiHeadTrackingRefresh === "function") {
      h.window.__cavaiHeadTrackingRefresh();
    }
    if (typeof h.window.__cavaiEyeTrackingRefresh === "function") {
      h.window.__cavaiEyeTrackingRefresh();
    }
    if (h.window.cavai && typeof h.window.cavai.enableHeadTracking === "function") {
      h.window.cavai.enableHeadTracking();
    }
  }

  assert.equal(h.windowEvents.count("pointermove"), beforePointer);
  assert.equal(h.windowEvents.count("mousemove"), beforeMouse);
  assert.equal(h.consoleErrors.length, 0);
});

test("favicon snapshot prefers 32x32 icon candidate", () => {
  const h = createHarness();
  attachHeadFixture(h, {
    links: [
      createLink({ rel: "icon", href: "/favicon-16x16.png", sizes: "16x16", type: "image/png" }),
      createLink({ rel: "icon", href: "/favicon-32x32.png", sizes: "32x32", type: "image/png" }),
    ],
  });
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  const report = h.window.cavbotAnalytics.report();
  assert.equal(report.seo.favicon.hasFavicon, true);
  assert.equal(report.seo.favicon.iconHref, "https://example.com/favicon-32x32.png");
  assert.equal(report.seo.favicon.iconSizes, "32x32");
});

test("favicon snapshot captures /favicon.ico when it is the only icon link", () => {
  const h = createHarness();
  attachHeadFixture(h, {
    links: [createLink({ rel: "shortcut icon", href: "/favicon.ico" })],
  });
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  const report = h.window.cavbotAnalytics.report();
  assert.equal(report.seo.favicon.hasFavicon, true);
  assert.equal(report.seo.favicon.iconHref, "https://example.com/favicon.ico");
});

test("favicon snapshot captures apple-touch and manifest links", () => {
  const h = createHarness();
  attachHeadFixture(h, {
    links: [
      createLink({ rel: "icon", href: "/favicon-32x32.png", sizes: "32x32" }),
      createLink({ rel: "icon", href: "/android-chrome-192x192.png", sizes: "192x192" }),
      createLink({ rel: "icon", href: "/android-chrome-512x512.png", sizes: "512x512" }),
      createLink({ rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" }),
      createLink({ rel: "manifest", href: "/site.webmanifest" }),
      createLink({ rel: "mask-icon", href: "/safari-pinned-tab.svg", color: "#006EE6" }),
    ],
    metas: [
      createMeta({ name: "theme-color", content: "#202124" }),
      createMeta({ name: "msapplication-TileColor", content: "#202124" }),
      createMeta({ name: "msapplication-TileImage", content: "/assets/icons/mstile-144x144.png" }),
    ],
  });
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  const report = h.window.cavbotAnalytics.report();
  assert.equal(report.seo.favicon.appleTouchHref, "https://example.com/apple-touch-icon.png");
  assert.equal(report.seo.favicon.appleTouchSizes, "180x180");
  assert.equal(report.seo.favicon.iconSizesFound, "32x32,192x192,512x512");
  assert.equal(report.seo.favicon.appleTouchSizesFound, "180x180");
  assert.equal(report.seo.favicon.manifestHref, "https://example.com/site.webmanifest");
  assert.equal(report.seo.favicon.maskIconHref, "https://example.com/safari-pinned-tab.svg");
  assert.equal(report.seo.favicon.maskIconColor, "#006EE6");
  assert.equal(report.seo.favicon.themeColor, "#202124");
  assert.equal(report.seo.favicon.msTileColor, "#202124");
  assert.equal(report.seo.favicon.msTileImage, "https://example.com/assets/icons/mstile-144x144.png");
});

test("favicon snapshot reports hasFavicon=false when no icon link exists", () => {
  const h = createHarness();
  attachHeadFixture(h, { links: [] });
  runScript(h, ANALYTICS_SOURCE, "cavai-analytics-v5.js");

  const report = h.window.cavbotAnalytics.report();
  assert.equal(report.seo.favicon.hasFavicon, false);
  assert.equal(report.seo.favicon.iconHref, null);
});
