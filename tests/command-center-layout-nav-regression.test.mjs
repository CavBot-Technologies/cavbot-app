import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function base64urlEncode(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildSystemSessionToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    sub: "system",
    systemRole: "system",
    iat: now,
    exp: now + 60 * 60,
  };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${payloadB64}.${sig}`;
}

function extractCookieValue(setCookieHeader, name) {
  const raw = String(setCookieHeader || "");
  if (!raw) return "";
  const parts = raw.split(/,(?=[^;]+=[^;]+)/g);
  const match = parts
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${String(name || "").toLowerCase()}=`));
  if (!match) return "";
  const idx = match.indexOf("=");
  if (idx === -1) return "";
  const semi = match.indexOf(";");
  return (semi === -1 ? match.slice(idx + 1) : match.slice(idx + 1, semi)).trim();
}

async function mintUserSessionCookie({
  baseUrl,
  email,
  accountId,
  adminToken,
  sessionCookieName,
}) {
  const body = accountId ? { email, accountId } : { email };
  const response = await fetch(`${baseUrl}/api/auth/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to mint user session cookie: ${response.status} ${text}`.trim());
  }

  const setCookie = response.headers.get("set-cookie");
  const cookieValue = extractCookieValue(setCookie, sessionCookieName);
  if (!cookieValue) {
    throw new Error("Session cookie was not returned from /api/auth/session");
  }
  return cookieValue;
}

test("Command Center layout stays stable after repeated client navigation", { timeout: 180_000 }, async (t) => {
  if (process.env.CB_E2E_LAYOUT !== "1") {
    t.skip("Set CB_E2E_LAYOUT=1 to run CDP layout navigation regression.");
    return;
  }

  const baseUrl = String(process.env.CB_E2E_BASE_URL || "http://localhost:4011").trim().replace(/\/+$/, "");
  const cdpHttpBase = String(process.env.CB_E2E_CDP_HTTP || "http://127.0.0.1:9222").trim().replace(/\/+$/, "");
  const sessionCookieName = String(process.env.CAVBOT_SESSION_COOKIE_NAME || "cavbot_session").trim();
  const sessionSecret = String(process.env.CAVBOT_SESSION_SECRET || "").trim();
  const adminToken = String(process.env.CAVBOT_ADMIN_TOKEN || "").trim();
  const e2eEmail = String(process.env.CB_E2E_EMAIL || process.env.CAVBOT_OWNER_EMAIL || "").trim().toLowerCase();
  const e2eAccountId = String(process.env.CB_E2E_ACCOUNT_ID || "").trim();
  assert.ok(
    (adminToken && e2eEmail) || sessionSecret,
    "Provide CAVBOT_ADMIN_TOKEN + CAVBOT_OWNER_EMAIL (preferred) or CAVBOT_SESSION_SECRET for CB_E2E_LAYOUT",
  );

  const browserVersion = await fetch(`${cdpHttpBase}/json/version`).then((r) => r.json());
  assert.ok(browserVersion.webSocketDebuggerUrl, "Missing browser webSocketDebuggerUrl");
  const targetInfo = await fetch(`${cdpHttpBase}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  assert.ok(targetInfo.webSocketDebuggerUrl, "Missing target webSocketDebuggerUrl");

  const ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (event) => reject(event.error || new Error("CDP websocket open failed")), { once: true });
  });

  const pending = new Map();
  let msgId = 0;
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data || "{}"));
    if (typeof payload.id !== "number" || !pending.has(payload.id)) return;
    const handlers = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) handlers.reject(new Error(payload.error.message || "CDP command failed"));
    else handlers.resolve(payload.result || {});
  });

  const send = (method, params = {}) => {
    msgId += 1;
    const id = msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
    });
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let loadResolve = null;
  ws.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data || "{}"));
    if (payload.method === "Page.loadEventFired") {
      loadResolve?.();
    }
  });
  const waitForLoad = () => new Promise((resolve) => {
    loadResolve = resolve;
  });

  const evalJSON = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return result?.result?.value;
  };

  const waitForPathPrefix = async (prefix, timeoutMs = 20_000) => {
    const started = Date.now();
    for (;;) {
      const path = await evalJSON("window.location.pathname + window.location.search");
      const current = String(path || "");
      const matches = prefix === "/"
        ? current === "/" || current.startsWith("/?")
        : current.startsWith(prefix);
      if (matches) return;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for ${prefix}; current=${path}`);
      }
      await sleep(120);
    }
  };

  const navigate = async (pathname) => {
    const load = waitForLoad();
    await send("Page.navigate", { url: `${baseUrl}${pathname}` });
    await load;
    await waitForPathPrefix(pathname);
  };

  const navigateViaIntentOrDirect = async (pathname) => {
    const clicked = await clickIntent(pathname);
    if (clicked?.ok) {
      try {
        await waitForPathPrefix(pathname, 4_000);
        return;
      } catch {
        // fall back to direct navigate when click intent does not actually transition
      }
    }
    await navigate(pathname);
  };

  const clickIntent = (href) => evalJSON(`(() => {
    const node = document.querySelector('a[data-cb-route-intent="${href}"]');
    if (!node) return { ok: false, href: "${href}" };
    node.click();
    return { ok: true, href: "${href}" };
  })()`);

  const captureHome = () => evalJSON(`(() => {
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const profileHead = document.querySelector('[data-cb-layout-anchor="profile-head"]');
    const websitesHead = document.querySelector('[data-cb-layout-anchor="websites-head"]');
    const account = document.querySelector('[data-cb-layout-anchor="profile-account-link"]');
    const manage = document.querySelector('[data-cb-layout-anchor="websites-manage-btn"]');
    return {
      href: window.location.pathname + window.location.search,
      profileHeadRect: rect(profileHead),
      websitesHeadRect: rect(websitesHead),
      profileAccountRect: rect(account),
      websitesManageRect: rect(manage),
      profileHeadDisplay: profileHead ? getComputedStyle(profileHead).display : "missing",
      websitesHeadDisplay: websitesHead ? getComputedStyle(websitesHead).display : "missing",
    };
  })()`);

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1512,
      height: 982,
      deviceScaleFactor: 2,
      mobile: false,
    });

    const token = adminToken && e2eEmail
      ? await mintUserSessionCookie({
          baseUrl,
          email: e2eEmail,
          accountId: e2eAccountId || undefined,
          adminToken,
          sessionCookieName,
        })
      : buildSystemSessionToken(sessionSecret);
    const setCookieRes = await send("Network.setCookie", {
      name: sessionCookieName,
      value: token,
      url: `${baseUrl}/`,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    assert.equal(Boolean(setCookieRes?.success), true, "Failed to set session cookie in CDP context");

    await navigate("/");
    await sleep(1800);

    const baseline = await captureHome();
    assert.equal(baseline.profileHeadDisplay, "block", `Baseline profile head display drifted: ${JSON.stringify(baseline)}`);
    assert.equal(baseline.websitesHeadDisplay, "block", `Baseline websites head display drifted: ${JSON.stringify(baseline)}`);
    assert.ok(baseline.profileHeadRect && baseline.websitesHeadRect, `Missing baseline anchors: ${JSON.stringify(baseline)}`);

    const loops = Math.max(1, Number(process.env.CB_E2E_LAYOUT_LOOPS || "20"));
    const sequence = ["/console", "/errors", "/settings", "/routes"];
    for (let i = 0; i < loops; i += 1) {
      for (const route of sequence) {
        await navigateViaIntentOrDirect(route);
        await sleep(500);
      }

      await navigateViaIntentOrDirect("/");
      await sleep(700);

      const current = await captureHome();
      assert.equal(current.profileHeadDisplay, "block", `profile head display drift on loop ${i + 1}: ${JSON.stringify(current)}`);
      assert.equal(current.websitesHeadDisplay, "block", `websites head display drift on loop ${i + 1}: ${JSON.stringify(current)}`);
      assert.ok(current.profileHeadRect && current.websitesHeadRect, `Missing anchors on loop ${i + 1}: ${JSON.stringify(current)}`);

      const profileYDelta = Math.abs(current.profileHeadRect.y - baseline.profileHeadRect.y);
      const websitesYDelta = Math.abs(current.websitesHeadRect.y - baseline.websitesHeadRect.y);
      assert.ok(profileYDelta <= 8, `Profile head Y drift too high on loop ${i + 1}: ${profileYDelta}px`);
      assert.ok(websitesYDelta <= 12, `Websites head Y drift too high on loop ${i + 1}: ${websitesYDelta}px`);
      assert.ok(
        current.websitesHeadRect.y > current.profileHeadRect.y + 180,
        `Websites head is no longer below profile head on loop ${i + 1}: ${JSON.stringify(current)}`
      );
    }
  } finally {
    try {
      ws.close();
    } catch {
      // ignore close errors in test cleanup
    }
  }
});
