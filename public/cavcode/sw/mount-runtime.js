const CONTEXT_MESSAGE_TYPE = "CAVCODE_MOUNT_CONTEXT";
const CONTEXT_TTL_MS = 30 * 60 * 1000;
const TOKEN_TTL_SKEW_MS = 5_000;
const GATEWAY_ORIGIN = "https://cavcloud.cavbot.io";
const GATEWAY_PREFIX_BY_SOURCE = {
  CAVCLOUD: "/cavcloud/",
  CAVSAFE: "/cavsafe/",
};
const RESOLVE_ENDPOINT = "/api/cavcode/mounts/resolve";
const TOKEN_ENDPOINT = "/api/cavcode/mounts/token";
const INTERNAL_APP_BYPASS_PREFIXES = [
  "/auth",
  "/accept-invite",
  "/a11y",
  "/api/",
  "/billing",
  "/cavbot",
  "/cavbot-arcade",
  "/cavcloud",
  "/cavcode",
  "/cavcode-viewer",
  "/cavsafe",
  "/console",
  "/cavtools",
  "/errors",
  "/insights",
  "/notifications",
  "/mount-runtime.js",
  "/p/",
  "/plan",
  "/routes",
  "/seo",
  "/settings",
  "/share/",
  "/status",
  "/u/",
  "/users",
];

const clientContexts = new Map();
const tokenCache = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const payload = event && event.data && typeof event.data === "object" ? event.data : null;
  if (!payload || payload.type !== CONTEXT_MESSAGE_TYPE) return;

  const source = event.source;
  const sourceId = source && typeof source.id === "string" ? source.id : "";
  const projectId = parseProjectId(payload.projectId);
  const shareId = parseShareId(payload.shareId);
  const viewerPrefix = normalizeViewerPrefix(payload.viewerPrefix);

  if (!sourceId) return;

  if (payload.clear === true) {
    clientContexts.delete(sourceId);
    return;
  }
  if (!projectId && !shareId) return;

  clientContexts.set(sourceId, {
    projectId,
    shareId,
    viewerPrefix,
    updatedAt: Date.now(),
  });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});

async function handleFetch(event) {
  const request = event.request;
  if (!request || (request.method !== "GET" && request.method !== "HEAD")) {
    return fetch(request);
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return fetch(request);
  if (isBypassPath(url.pathname)) return fetch(request);

  pruneState();

  const context = await resolveContextForEvent(event);
  if (!context) return fetch(request);

  const rawPathname = String(url.pathname || "");
  const requestPath = normalizeAbsolutePath(rawPathname);
  if (!requestPath) return fetch(request);

  const allowHtmlFallback = shouldAllowHtmlFallback(request);
  if (allowHtmlFallback && shouldProbeDirectoryRedirect(rawPathname, requestPath)) {
    const probePath = `${requestPath}/index.html`;
    const probeResolved = await resolveMountedPath(context, probePath, false);
    if (probeResolved) {
      const redirectUrl = new URL(url.toString());
      redirectUrl.pathname = `${rawPathname.replace(/\/+$/, "")}/`;
      return Response.redirect(redirectUrl.toString(), 302);
    }
  }

  const resolved = await resolveMountedPath(context, requestPath, allowHtmlFallback);
  if (!resolved) return fetch(request);

  const token = await getObjectToken(context, resolved);
  if (!token) return fetch(request);

  const gatewayPrefix = GATEWAY_PREFIX_BY_SOURCE[resolved.sourceType] || GATEWAY_PREFIX_BY_SOURCE.CAVCLOUD;
  const gatewayUrl = `${GATEWAY_ORIGIN}${gatewayPrefix}${encodeObjectKeyPath(resolved.r2Key)}`;
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);

  const range = request.headers.get("range");
  if (range) headers.set("Range", range);

  const accept = request.headers.get("accept");
  if (accept) headers.set("Accept", accept);

  const upstream = await fetch(gatewayUrl, {
    method: request.method,
    headers,
    redirect: "follow",
  });

  const resHeaders = new Headers(upstream.headers);
  if (!resHeaders.get("Content-Type") && resolved.mimeType) {
    resHeaders.set("Content-Type", resolved.mimeType);
  }
  resHeaders.set("X-Cavcode-Mount", "1");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

function parseProjectId(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseShareId(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value;
}

function normalizeViewerPrefix(raw) {
  const value = String(raw || "/cavcode-viewer").trim();
  if (!value.startsWith("/")) return "/cavcode-viewer";
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeAbsolutePath(pathname) {
  const raw = String(pathname || "").trim();
  if (!raw.startsWith("/")) return "";
  if (raw.includes("..")) return "";
  if (raw.includes("\\")) return "";
  const normalized = raw.replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) return "";
  if (normalized.length > 1 && normalized.endsWith("/")) return normalized.slice(0, -1);
  return normalized;
}

function encodeObjectKeyPath(objectKey) {
  const clean = String(objectKey || "").trim().replace(/^\/+/, "");
  if (!clean) return "";
  return clean
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isBypassPath(pathname) {
  const p = normalizeAbsolutePath(pathname);
  if (!p) return true;
  if (INTERNAL_APP_BYPASS_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`) || p.startsWith(prefix))) {
    return true;
  }
  if (p.startsWith("/_next/")) return true;
  if (p.startsWith("/cavcode/sw/")) return true;
  if (p.startsWith("/favicon")) return true;
  if (p === "/robots.txt" || p === "/sitemap.xml") return true;
  return false;
}

async function resolveContextForEvent(event) {
  const clientId = String(event.clientId || "").trim();
  if (clientId) {
    const direct = clientContexts.get(clientId);
    if (direct) {
      direct.updatedAt = Date.now();

      const resultingClientId = String(event.resultingClientId || "").trim();
      if (resultingClientId && resultingClientId !== clientId) {
        clientContexts.set(resultingClientId, {
          projectId: direct.projectId,
          shareId: direct.shareId,
          viewerPrefix: direct.viewerPrefix,
          updatedAt: Date.now(),
        });
      }

      return direct;
    }

    const client = await self.clients.get(clientId);
    if (client) {
      try {
        const url = new URL(client.url);
        if (url.pathname.startsWith("/cavcode-viewer")) {
          const projectId = parseProjectId(url.searchParams.get("projectId") || url.searchParams.get("project"));
          const shareId = parseShareId(url.searchParams.get("shareId"));
          if (projectId || shareId) {
            const inferred = {
              projectId,
              shareId,
              viewerPrefix: "/cavcode-viewer",
              updatedAt: Date.now(),
            };
            clientContexts.set(clientId, inferred);
            return inferred;
          }
        }
      } catch {
        // ignore and continue to referrer inference
      }
    }
  }

  const referrer = String(event.request.referrer || "").trim();
  if (!referrer) return null;
  try {
    const ref = new URL(referrer);
    if (ref.origin !== self.location.origin) return null;
    if (!ref.pathname.startsWith("/cavcode-viewer")) return null;

    const projectId = parseProjectId(ref.searchParams.get("projectId") || ref.searchParams.get("project"));
    const shareId = parseShareId(ref.searchParams.get("shareId"));
    if (!projectId && !shareId) return null;

    const inferred = {
      projectId,
      shareId,
      viewerPrefix: "/cavcode-viewer",
      updatedAt: Date.now(),
    };
    if (clientId) {
      clientContexts.set(clientId, inferred);
    }
    const resultingClientId = String(event.resultingClientId || "").trim();
    if (resultingClientId) {
      clientContexts.set(resultingClientId, inferred);
    }
    return inferred;
  } catch {
    return null;
  }
}

async function resolveMountedPath(context, requestPath, htmlFallback) {
  const resolverUrl = context.shareId
    ? new URL("/api/cavcode/mounts/share/resolve", self.location.origin)
    : new URL(RESOLVE_ENDPOINT, self.location.origin);
  if (context.shareId) {
    resolverUrl.searchParams.set("shareId", context.shareId);
  } else {
    resolverUrl.searchParams.set("projectId", String(context.projectId));
  }
  resolverUrl.searchParams.set("path", requestPath);
  if (htmlFallback) resolverUrl.searchParams.set("htmlFallback", "1");

  let response;
  try {
    response = await fetch(resolverUrl.toString(), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true) return null;

  const r2Key = String(body.r2Key || "").trim();
  const sourceType = normalizeSourceType(body.sourceType);
  const mimeType = String(body.mimeType || "").trim() || "application/octet-stream";
  if (!r2Key) return null;

  return { r2Key, mimeType, sourceType };
}

function shouldAllowHtmlFallback(request) {
  if (!request) return false;
  if (request.mode === "navigate") return true;
  if (request.destination === "document") return true;
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return accept.includes("text/html");
}

function shouldProbeDirectoryRedirect(rawPathname, requestPath) {
  const pathname = String(rawPathname || "");
  if (!pathname || pathname === "/") return false;
  if (pathname.endsWith("/")) return false;
  const normalized = String(requestPath || "").trim();
  if (!normalized || normalized === "/") return false;
  const leaf = normalized.split("/").filter(Boolean).pop() || "";
  return !/\.[A-Za-z0-9_-]{1,16}$/.test(leaf);
}

async function getObjectToken(context, resolved) {
  const r2Key = String(resolved?.r2Key || "").trim();
  const mimeType = String(resolved?.mimeType || "").trim() || "application/octet-stream";
  const sourceType = normalizeSourceType(resolved?.sourceType);
  if (!r2Key) return "";

  const scopeKey = context.shareId ? `share:${context.shareId}` : `project:${context.projectId}`;
  const cacheKey = `${scopeKey}:${sourceType}:${r2Key}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs - TOKEN_TTL_SKEW_MS > now) {
    return cached.token;
  }

  let response;
  try {
    const tokenUrl = context.shareId
      ? new URL("/api/cavcode/mounts/share/token", self.location.origin)
      : new URL(TOKEN_ENDPOINT, self.location.origin);
    const body = context.shareId
      ? {
          shareId: context.shareId,
          r2Key,
          mimeType,
          sourceType,
        }
      : {
          projectId: context.projectId,
          r2Key,
          mimeType,
          sourceType,
        };
    response = await fetch(tokenUrl.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return "";
  }

  if (!response.ok) return "";
  const body = await response.json().catch(() => null);
  if (!body || body.ok !== true) return "";

  const token = String(body.token || "").trim();
  const expiresAtMs = Date.parse(String(body.expiresAt || "")) || now + 60_000;
  if (!token) return "";

  tokenCache.set(cacheKey, { token, expiresAtMs });
  return token;
}

function normalizeSourceType(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase();
  if (value === "CAVSAFE") return "CAVSAFE";
  return "CAVCLOUD";
}

function pruneState() {
  const now = Date.now();

  for (const [clientId, value] of clientContexts.entries()) {
    if (!value || now - Number(value.updatedAt || 0) > CONTEXT_TTL_MS) {
      clientContexts.delete(clientId);
    }
  }

  for (const [key, value] of tokenCache.entries()) {
    if (!value || Number(value.expiresAtMs || 0) + TOKEN_TTL_SKEW_MS <= now) {
      tokenCache.delete(key);
    }
  }
}
