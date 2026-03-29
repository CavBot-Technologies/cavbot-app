"use client";

import Image from "next/image";
import Link from "next/link";
import ArcadePreview from "../../ArcadePreview";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AppShell from "@/components/AppShell";
import { CheckIcon, CopyIcon } from "@/components/CopyIcons";
import {
  buildAnalyticsSnippet,
  buildArcadeSnippet,
  buildBrainSnippet,
  buildWidgetSnippet,
  isSnippetReady,
  SnippetContext,
} from "@/lib/settings/snippetGenerators";
import { buildArcadeThumbnailUrl, type ArcadeConfigPayload } from "@/lib/arcade/settings";

import "../../../settings.css";
import "../../integrations.css";

const SCRIPT_LOCK_MESSAGE = "Select a site and key to unlock scripts.";
const API_KEYS_URL = "/api/settings/api-keys";
const INSTALL_STATE_URL = "/api/settings/integrations/cavbot/install-state";

type ApiKeyStatus = "ACTIVE" | "ROTATED" | "REVOKED";
type ApiKeyType = "PUBLISHABLE" | "SECRET" | "ADMIN";

type ApiKeyDTO = {
  id: string;
  type: ApiKeyType;
  prefix: string;
  last4: string;
  status: ApiKeyStatus;
  value?: string;
};

type ApiKeysPayload = {
  publishableKeys: ApiKeyDTO[];
  site: { id: string; origin: string } | null;
};

type ApiGameSummary = {
  slug: string;
  version: string;
  displayName: string;
  thumbnailUrl: string;
};

type InstallEntry = {
  kind: string;
  widgetType: string | null;
  style: string | null;
  position: string | null;
  origin: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
  seenCount: number;
};

type InstallStatePayload = {
  ok: true;
  site: { id: string; origin: string };
  installs: InstallEntry[];
};

type ApiError = {
  error?: string;
  message?: string;
};

function apiJSON<T>(url: string, init?: RequestInit): Promise<T> {
  return fetch(url, {
    ...(init || {}),
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    cache: "no-store",
  }).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as ApiError & T;
    if (!response.ok) {
      const message = payload?.message || payload?.error || "Request failed";
      throw new Error(message);
    }
    return payload as T;
  });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

type SnippetBlockProps = {
  id: string;
  title: string;
  description: string;
  snippet: string;
  ready: boolean;
  lockMessage?: string;
  onCopy: (id: string, snippet: string) => void;
  copiedId: string | null;
};

function SnippetBlock({
  id,
  title,
  description,
  snippet,
  ready,
  lockMessage,
  onCopy,
  copiedId,
}: SnippetBlockProps) {
  const disabled = !ready || !snippet;
  return (
    <article className={`sx-api-snipCard ${disabled ? "is-disabled" : ""}`}>
      <div className="sx-api-snipHead">
        <div>
          <div className="sx-footK">{title}</div>
          <p className="sx-status-sub">{description}</p>
        </div>
        <button
          className="sx-api-copy"
          type="button"
          onClick={() => snippet && onCopy(id, snippet)}
          disabled={disabled}
          aria-live="polite"
        >
          {copiedId === id ? <CheckIcon /> : <CopyIcon />}
          <span className="cb-sr-only">{ready ? "Copy snippet" : "Snippet locked"}</span>
        </button>
      </div>
      {snippet ? (
        <pre className="sx-api-snipCode" aria-label={`${title} code`}>
          {snippet}
        </pre>
      ) : (
        <div className="sx-api-comingSoon">{lockMessage ?? SCRIPT_LOCK_MESSAGE}</div>
      )}
    </article>
  );
}

export default function WordPressPlatformPage() {
  const [payload, setPayload] = useState<ApiKeysPayload | null>(null);
  const [, setLoadingKeys] = useState(true);
  const [, setKeysError] = useState<string | null>(null);
  const [installState, setInstallState] = useState<InstallStatePayload | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [arcadeGames, setArcadeGames] = useState<ApiGameSummary[]>([]);
  const [, setArcadeLoading] = useState(false);
  const [arcadeLoadError, setArcadeLoadError] = useState<string | null>(null);
  const [arcadeConfig, setArcadeConfig] = useState<ArcadeConfigPayload | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const loadKeys = useCallback(async () => {
    setLoadingKeys(true);
    setKeysError(null);
    try {
      const response = await apiJSON<ApiKeysPayload>(API_KEYS_URL);
      setPayload(response);
    } catch (error) {
      setKeysError(getErrorMessage(error, "Unable to load site information."));
      setPayload(null);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const fetchInstallState = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setInstallError(null);
    try {
      const response = await fetch(`${INSTALL_STATE_URL}?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as
        | InstallStatePayload
        | ({ ok?: false; error?: string } & ApiError);
      if (!response.ok || !data?.ok) {
        throw new Error((data as { error?: string })?.error || "Unable to load install status.");
      }
      setInstallState(data as InstallStatePayload);
    } catch (error) {
      setInstallError(getErrorMessage(error, "Install status unavailable."));
      setInstallState(null);
    }
  }, []);

  const loadArcadeGames = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setArcadeLoading(true);
    setArcadeLoadError(null);
    try {
      const response = await fetch(`/api/settings/arcade/config?siteId=${encodeURIComponent(siteId)}`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            games?: ApiGameSummary[];
            config?: ArcadeConfigPayload | null;
            error?: string;
          }
        | null;
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to load Arcade catalog.");
      }
      setArcadeGames(data.games ?? []);
      setArcadeConfig(data.config ?? null);
    } catch (error) {
      setArcadeLoadError(getErrorMessage(error, "Unable to load Arcade catalog."));
      setArcadeGames([]);
      setArcadeConfig(null);
    } finally {
      setArcadeLoading(false);
    }
  }, []);

  useEffect(() => {
    const siteId = payload?.site?.id;
    if (!siteId) {
      setInstallState(null);
      setInstallError(null);
      return;
    }

    let intervalId: number | null = null;

    const refresh = () => {
      void fetchInstallState(siteId);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        if (!intervalId) {
          intervalId = window.setInterval(refresh, 30000);
        }
      } else if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    refresh();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [payload?.site?.id, fetchInstallState]);

  useEffect(() => {
    const siteId = payload?.site?.id;
    if (!siteId) {
      setArcadeGames([]);
      setArcadeLoadError(null);
      return;
    }
    void loadArcadeGames(siteId);
  }, [payload?.site?.id, loadArcadeGames]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const activePublishable = useMemo(() => {
    return (
      payload?.publishableKeys.find((key) => key.status === "ACTIVE") ?? payload?.publishableKeys[0] ?? null
    );
  }, [payload?.publishableKeys]);

  const snippetContext = useMemo<SnippetContext>(() => {
    return {
      publishableKey: activePublishable?.value ?? null,
      siteId: payload?.site?.id ?? null,
    };
  }, [activePublishable?.value, payload?.site?.id]);

  const ready = isSnippetReady(snippetContext);

  const arcadeSnippet = buildArcadeSnippet(snippetContext, "404");
  const widgetSnippet = buildWidgetSnippet({
    widget: "badge",
    style: "inline",
    position: "bottom-right",
    ready,
    context: snippetContext,
  });
  const analyticsSnippet = buildAnalyticsSnippet(snippetContext);
  const brainSnippet = buildBrainSnippet(snippetContext);

  const handleSnippetCopy = useCallback(
    (id: string, snippet: string) => {
      if (!snippet) return;
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(snippet);
      }
      setCopiedId(id);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedId(null);
        copyTimerRef.current = null;
      }, 1500);
    },
    []
  );

  const arcadeInstall = installState?.installs.find((entry) => entry.kind === "ARCADE") ?? null;
  const arcadeDetected = arcadeInstall?.status === "ACTIVE";
  const arcadeLastSeenLabel = arcadeInstall?.lastSeenAt
    ? new Date(arcadeInstall.lastSeenAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const configuredGameSlug = arcadeConfig?.enabled ? arcadeConfig.gameSlug ?? null : null;
  const configuredGameVersion = arcadeConfig?.enabled ? arcadeConfig.gameVersion ?? null : null;
  const detectedGameSlug = arcadeInstall?.style ?? null;
  const previewGameSlug = configuredGameSlug ?? detectedGameSlug;
  const previewGameVersion = configuredGameVersion ?? null;
  const selectedArcadeGame = useMemo(() => {
    if (!previewGameSlug) return null;
    return arcadeGames.find((game) => {
      if (!game) return false;
      if (game.slug !== previewGameSlug) return false;
      if (previewGameVersion && game.version !== previewGameVersion) return false;
      return true;
    });
  }, [arcadeGames, previewGameSlug, previewGameVersion]);
  const arcadeGameLabel =
    selectedArcadeGame?.displayName ??
    (previewGameSlug ? previewGameSlug.replace(/-/g, " ") : "Arcade");
  const detectionOrigin = arcadeInstall?.origin ?? payload?.site?.origin ?? "";
  const detectionOriginLabel = detectionOrigin
    ? detectionOrigin.replace(/^https?:\/\//, "")
    : "—";
  const selectedArcadeGameValueClassName = selectedArcadeGame
    ? "cb-arcadeDetectionValue cb-arcadeDetectionValue--game"
    : "cb-arcadeDetectionValue";
  const lastSeenValueClassName = `cb-arcadeDetectionValue${
    arcadeLastSeenLabel ? "" : " cb-arcadeDetectionValue--offline"
  }`;
  const selectedArcadeThumbnailUrl =
    selectedArcadeGame?.thumbnailUrl ??
    (previewGameSlug ? buildArcadeThumbnailUrl(previewGameSlug, previewGameVersion ?? "v1") : null);

  const contractSnippet = `<meta name="cavbot-page" content="404" />\n<body data-cavbot-page-type="404">`;

  return (
    <AppShell title="Settings" subtitle="Account preferences and workspace configuration">
      <div className="sx-page">
        <header className="sx-top">
          <div className="sx-topLeft">
            <div className="cb-heroTitle">
              <div className="cb-heroIcon" aria-hidden="true">
                <Image
                  src="/integrations/WordPress-logotype-wmark-white.png"
                  alt="WordPress logomark"
                  width={54}
                  height={54}
                  priority={true}
                  unoptimized
                />
              </div>
              <div>
              <h1 className="sx-h1">WordPress Integration</h1>
              <p className="sx-sub">
                Install CavBot on WordPress to serve a secured, interactive CavBot recovery experience on your 404 route.
              </p>
                <p className="cb-heroConnectionHint">
                  Need to manage your site selection or publishable key?{" "}
                  <Link href="/settings?tab=api" className="cb-heroConnectionLink">
                    Go to API &amp; Keys
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </header>
<br /><br /><br /><br />
        <section className="sx-panel cb-installPanel cb-spacedPanel" aria-label="Install steps">
          <header className="sx-panelHead">
            <div>
              <p className="sx-footK">Section A — Overview</p>
              <p className="sx-sub">
                This script instructs WordPress to load CavBot Arcade, widgets, analytics, and CavAi while keeping your 404 route secure and interactive. WordPress has two common setups—use the plugin path for managed hosting or the theme header method for self-hosted sites—and stretching the page wide helps you scan the two installation paths below without losing rhythm.
                <br />
                Keep this guide visible and follow it end to end so each step sits in a single, wide subtitle block that mirrors your viewport.
              </p>
            </div>
          </header>
          <div className="sx-body">
            <div className="cb-pathIntro">
              <p className="sx-footK">Path A — WordPress (Plugin method) — Recommended (most reliable)</p><br /><br />
              <p className="sx-status-sub">
                Ideal for WordPress.com or managed hosting plans—this path avoids touching theme files by using a header/footer plugin.
              </p>
            </div>
            <div className="cb-stepGrid">
              <article className="cb-stepEntry">
                <strong>Open WordPress Admin</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Log in to your WordPress Admin dashboard (wp-admin) for the site you want to protect.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Install a “Header/Footer scripts” plugin</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Navigate to Plugins → Add New and search for “Insert Headers and Footers” or “WPCode.” Install and activate the plugin you choose.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Paste CavBot loader snippet</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Open the plugin’s settings (Settings → Insert Headers and Footers or WPCode → Header/Footer) and paste the CavBot Arcade Loader snippet (generated below) into the “Scripts in Header” field, then save.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Verify (trigger a 404)</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Open your WordPress site in a new tab and visit a non-existent URL such as https://yourdomain.com/this-route-does-not-exist so the 404 page loads and CavBot Arcade mounts.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Confirm “Install detected” in CavBot</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Return to CavBot → Settings → Integrations → WordPress. The detection panel below should flip from “Not detected” to “Detected” and show the last seen timestamp, origin, and selected game.
                </p>
              </article>
            </div>
            <div className="cb-pathIntro">
              <p className="sx-footK">Path B — WordPress (Theme method) — If you prefer no plugins</p><br /><br />
              <p className="sx-status-sub">
                Use this path for self-hosted WordPress sites when you can inject code via wp-admin’s theme header editor.
              </p>
            </div>
            <div className="cb-stepGrid">
              <article className="cb-stepEntry">
                <strong>Open Theme Editor</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  In wp-admin go to Appearance → Theme File Editor to work directly with your active theme’s files.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Locate header.php (or equivalent)</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Open Theme Files → header.php. If your theme uses a site editor/block theme, use Appearance → Editor and insert via a header template part if available. If that’s not possible, use the plugin method above.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Paste CavBot loader snippet</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Paste the CavBot Arcade Loader snippet (generated below) just before the closing <code>&lt;/head&gt;</code> tag and update the file.
                </p>
              </article>
              <article className="cb-stepEntry">
                <strong>Verify (trigger a 404)</strong>
                <br />
                <br />
                <p className="sx-status-sub">
                  Open your live WordPress site and visit a URL that does not exist so the 404 page loads with the CavBot Arcade experience.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="Loader snippets">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Path A snippets — plugin loader</h2>
              <p className="sx-sub">
                The loader, widget, analytics, and CavAi snippets now sit below the install steps so you can grab the cards after finishing the configuration work.
              </p>
            </div>
          </header>
          <div className="sx-body">
            <div className="cb-installSnippets">
              <SnippetBlock
                id="arcade-404"
                title="404 Arcade loader"
                description="Serve an interactive recovery experience only on 404 routes."
                snippet={arcadeSnippet}
                ready={ready}
                lockMessage={SCRIPT_LOCK_MESSAGE}
                onCopy={handleSnippetCopy}
                copiedId={copiedId}
              />
              <SnippetBlock
                id="widget-loader"
                title="Widget loader"
                description="Show the CavBot badge with a default inline placement."
                snippet={widgetSnippet}
                ready={ready}
                lockMessage={SCRIPT_LOCK_MESSAGE}
                onCopy={handleSnippetCopy}
                copiedId={copiedId}
              />
            </div>
            <div className="sx-api-snippetGrid sx-api-snippetGrid--compact">
              <SnippetBlock
                id="analytics-script"
                title="Publishable analytics embed"
                description="Send telemetry to CavBot analytics."
                snippet={analyticsSnippet}
                ready={ready}
                lockMessage={SCRIPT_LOCK_MESSAGE}
                onCopy={handleSnippetCopy}
                copiedId={copiedId}
              />
              <SnippetBlock
                id="brain-script"
                title="CavAi brain loader"
                description="Boot CavBot intelligence after the page loads."
                snippet={brainSnippet}
                ready={ready}
                lockMessage={SCRIPT_LOCK_MESSAGE}
                onCopy={handleSnippetCopy}
                copiedId={copiedId}
              />
            </div>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="Dedicated 404 instructions">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Section B — Install on a dedicated 404 page (most reliable)</h2>
              <p className="sx-sub">
                If your WordPress theme gives you direct access to the 404 template, paste the Arcade loader there for determinism.
              </p>
            </div>
          </header>
          <div className="sx-body cb-dedicated404">
            <div className="cb-dedicatedRow">
              <p className="sx-status-sub cb-dedicatedSentence">
                This is the most deterministic setup because CavBot only runs when WordPress returns a real 404 response.
                Even if the loader already detects 404 pages, adding the meta tag below keeps the recovery intent explicit.
              </p>
              <div className="cb-contractRow">
                <pre className="sx-api-snipCode cb-contractCode" aria-hidden="true">
                  {contractSnippet}
                </pre>
                <button
                  type="button"
                  className="sx-api-copy cb-contractCopy"
                  onClick={() => handleSnippetCopy("contract-snippet", contractSnippet)}
                  aria-label="Copy 404 best practice contract"
                >
                  {copiedId === "contract-snippet" ? <CheckIcon /> : <CopyIcon />}
                  <span className="cb-sr-only">Copy contract snippet</span>
                </button>
              </div>
            </div>
            <p className="sx-status-sub cb-dedicatedFollow">
              Add either the <code>&lt;meta name=&quot;cavbot-page&quot; content=&quot;404&quot; /&gt;</code> tag or the{" "}
              <code>data-cavbot-page-type=&quot;404&quot;</code> attribute on <code>&lt;body&gt;</code> so WordPress knows this page serves 404 traffic.
            </p>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="Quick verification">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Section C — Test it in 20 seconds</h2>
              <p className="sx-sub">Follow this quick verification to confirm the Arcade loader is live.</p>
            </div>
          </header>
          <div className="sx-body cb-testSection">
            <ol className="cb-testList">
              <li>Save the plugin or theme changes so the CavBot snippet is live on the front-facing WordPress site.</li>
              <li>Open your published WordPress site in a new tab and navigate to a URL that does not exist.</li>
              <li>Expect the CavBot Arcade loader to take over the 404 and then check the detection panel below.</li>
            </ol>
            <br />
            <br />
            <p className="sx-status-sub cb-testParagraph">
              Once CavBot hits that fake path, Arcade detections will show up in the panel below within a few seconds.
            </p>
            <p className="sx-status-sub cb-testParagraph">
              While you&apos;re testing the Arcade experience, verify the widget badge loads, analytics pings your workspace, and CavAi starts behind the scenes.
            </p>
            <p className="sx-status-sub cb-testParagraph">
              WordPress cache plugins or host/CDN layers may delay the new snippet; clear any caches and hard refresh the 404 page if detection does not flip immediately.
            </p>
            <p className="sx-status-sub cb-testParagraph">
              Add every domain variant (www and non-www) to CavBot&apos;s Origin Allowlist so verification can move to Detected.
            </p>
            <p className="sx-status-sub cb-testParagraph">
              If you maintain staging or multiple active themes, make sure the snippet lives only on the published theme to keep detection accurate.
            </p>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="Verify installation">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Verify &amp; install detected</h2>
              <p className="sx-sub">Server-side Arcade hits confirm the loader is connected from an allowlisted origin.</p>
            </div>
            <span className={`sx-status-chip ${arcadeDetected ? "is-active" : ""}`}>
              {arcadeDetected ? "Detected" : "Not detected"}
            </span>
          </header>
          <div className="sx-body">
            {installError ? <p className="sx-status-sub cb-errorText">{installError}</p> : null}
            {arcadeLoadError ? <p className="sx-status-sub cb-errorText">{arcadeLoadError}</p> : null}
            <div className="cb-arcadeDetection">
              <div className="cb-arcadeDetectionContent">
                <p className={`cb-arcadeDetectionStatus ${arcadeDetected ? "is-online" : ""}`}>
                  {arcadeDetected
                    ? "Live 404 traffic is routing through the Arcade loader."
                    : "Waiting for 404 traffic to arrive on the configured Arcade route."}
                </p>
                <div className="cb-arcadeDetectionRows">
                  <p className="cb-arcadeDetectionRow">
                    <span className="cb-arcadeDetectionLabel cb-arcadeDetectionLabel--game">Game</span>
                    <span className={selectedArcadeGameValueClassName}>
                      {selectedArcadeGame
                        ? selectedArcadeGame.displayName ?? "Selected Arcade game"
                        : arcadeInstall
                        ? arcadeGameLabel
                        : "Offline"}
                    </span>
                  </p>
                  <p className="cb-arcadeDetectionRow">
                    <span className="cb-arcadeDetectionLabel cb-arcadeDetectionLabel--eye">Last seen</span>
                    <span className={lastSeenValueClassName} aria-live="polite">
                      {arcadeLastSeenLabel ?? "Offline"}
                    </span>
                  </p>
                  <p className="cb-arcadeDetectionRow">
                    <span className="cb-arcadeDetectionLabel cb-arcadeDetectionLabel--origin">Origin</span>
                    <span className="cb-arcadeDetectionValue">{detectionOriginLabel}</span>
                  </p>
                </div>
              </div>
              <ArcadePreview
                thumbnailUrl={selectedArcadeThumbnailUrl}
                alt={selectedArcadeGame?.displayName ?? "Arcade preview"}
                placeholderText="Arcade preview unavailable"
              />
            </div>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="Troubleshooting">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Troubleshooting</h2>
              <p className="sx-sub">Common fixes if the snippets do not behave as expected.</p>
            </div>
          </header>
          <div className="sx-body cb-troubleshoot">
            <details>
              <summary className="cb-troubleshootSummary">If you see Forbidden</summary>
              <ul>
                <li>Check that the selected origin is allowlisted on the API key.</li>
                <li>Confirm the publishable key status is ACTIVE.</li>
                <li>Ensure the <code>data-site</code> value matches the selected site.</li>
              </ul>
            </details>
            <details>
              <summary className="cb-troubleshootSummary">If nothing shows on 404</summary>
              <ul>
                <li>Make sure your host returns a real 404 response, not a 200 shell.</li>
                <li>Ensure the loader snippet lives in the header via plugin or theme file, just before <code>&lt;/head&gt;</code>.</li>
                <li>Flush WordPress cache plugins/CDNs and hard refresh the 404 page after updates.</li>
              </ul>
            </details>
          </div>
        </section>

        <section className="sx-panel cb-spacedPanel" aria-label="CavCode">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Edit without leaving CavBot</h2><br />
              <p className="sx-sub">
                Want deeper control?{" "}
                <Link href="/cavcode" className="cb-heroConnectionLink">
                  Open CavCode
                </Link>{" "}
                to validate your snippet or edit your theme files safely before publishing.
              </p>
            </div>
            <div className="cb-cavcodeActions">
              <Link href="/cavcode" className="sx-btn sx-btnPrimary cb-cavcodeBtn">
                Open CavCode
              </Link>
            </div>
          </header>
        </section>

        <div className="cb-returnRow">
          <Link href="/settings/integrations" className="cb-returnBtn" aria-label="Connections">
            Connections
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
