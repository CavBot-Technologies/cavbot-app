"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { CopyIcon, CheckIcon } from "@/components/CopyIcons";
import { LockIcon } from "@/components/LockIcon";
import {
  buildAnalyticsSnippet,
  buildArcadeSnippet,
  buildBrainSnippet,
  buildWidgetSnippet,
  isSnippetReady,
  SnippetContext,
  WIDGET_SNIPPET_GROUPS,
} from "@/lib/settings/snippetGenerators";
import { gateCopy, widgetFeatureFromWidget } from "@/lib/billing/featureGates";
import { useAccountTier } from "@/lib/hooks/useAccountTier";
const TOAST_DURATION = 2600;

type ApiKeyStatus = "ACTIVE" | "ROTATED" | "REVOKED";
type ApiKeyType = "PUBLISHABLE" | "SECRET" | "ADMIN";

type ApiKeyDTO = {
  id: string;
  type: ApiKeyType;
  prefix: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
  status: ApiKeyStatus;
  name: string | null;
  scopes: string[];
  bindings: {
    accountId?: string | null;
    projectId?: number | null;
    siteId?: string | null;
  };
  value?: string;
};

type KeyUsagePayload = {
  verifiedToday: null | number;
  deniedToday: null | number;
  rateLimit: null | string;
  topDeniedOrigins: null | string[];
};

type ApiKeysPayload = {
  projectId: number | null;
  sites: { id: string; origin: string }[];
  publishableKeys: ApiKeyDTO[];
  secretKeys: ApiKeyDTO[];
  allowedOrigins: string[];
  site: { id: string; origin: string } | null;
  usage: KeyUsagePayload;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

async function apiJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload & T;
  if (!response.ok) {
    const message = payload?.message || payload?.error || "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return fallback;
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 28 28"
      width="24"
      height="24"
      aria-hidden="true"
      className="sx-api-eyeIcon"
    >
      <path
        d="M3 14c0 1 .3 1.9.85 2.75C5.6 19.7 8.52 22 12 22s6.4-2.3 8.15-5.25A7.13 7.13 0 0 0 21 14c0-1-.3-1.9-.85-2.75C18.4 8.3 15.48 6 12 6s-6.4 2.3-8.15 5.25A7.13 7.13 0 0 0 3 14Zm9 5.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm0-2a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        fill="currentColor"
      />
      <circle cx="12" cy="14" r="1.75" fill="#fff" opacity="0.9" />
    </svg>
  );
}

type SnippetCard = {
  id: string;
  title: string;
  description: string;
  snippet: string;
  ready: boolean;
  meta: string;
  lockMessage?: string;
  gateBadge?: string;
  gateTitle?: string;
  gateMessage?: string;
  copyLocked?: boolean;
};

type SnippetGroup = {
  title: string;
  description?: ReactNode;
  cards: SnippetCard[];
};

type SnippetSection = {
  id: string;
  title: string;
  description: ReactNode;
  cards?: SnippetCard[];
  groups?: SnippetGroup[];
};

export default function ApiKeysPanel() {
  const [payload, setPayload] = useState<ApiKeysPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [originInput, setOriginInput] = useState("");
  const [arcadeEnabled, setArcadeEnabled] = useState<boolean | null>(null);
  const [originSaving, setOriginSaving] = useState(false);
  const [originError, setOriginError] = useState<string | null>(null);
  const [pendingPublishable, setPendingPublishable] = useState<string | null>(null);
  const [pendingSecret, setPendingSecret] = useState<string | null>(null);
  const [showSecretPanel, setShowSecretPanel] = useState(false);
  const [showPublishablePanel, setShowPublishablePanel] = useState(false);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "good" | "watch" | "bad" } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [pendingRevokeKeyId, setPendingRevokeKeyId] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const selectedSiteIdRef = useRef("");
  const [overrideUsage, setOverrideUsage] = useState<KeyUsagePayload | null>(null);
  const usageOverrideSiteId = useRef<string | null>(null);
  const tier = useAccountTier();

  const showToast = useCallback((message: string, tone: "good" | "watch" | "bad" = "good") => {
    setToast({ msg: message, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_DURATION);
  }, []);

  const refreshUsageOverride = useCallback(async () => {
    const siteId = usageOverrideSiteId.current;
    if (!siteId) {
      setOverrideUsage(null);
      return;
    }

    try {
      const response = await apiJSON<{ usage: KeyUsagePayload }>(
        `/api/settings/api-keys/usage?siteId=${encodeURIComponent(siteId)}`
      );
      setOverrideUsage(response.usage);
    } catch (err: unknown) {
      usageOverrideSiteId.current = null;
      setOverrideUsage(null);
      showToast(getErrorMessage(err, "Unable to load key health"), "watch");
    }
  }, [showToast]);

  const overrideUsageForSite = useCallback(
    async (siteId: string | null) => {
      usageOverrideSiteId.current = siteId;
      await refreshUsageOverride();
    },
    [refreshUsageOverride]
  );

  const buildApiKeysUrl = useCallback((siteId?: string | null) => {
    const normalizedSiteId = String(siteId ?? "").trim();
    if (!normalizedSiteId) return "/api/settings/api-keys";
    return `/api/settings/api-keys?siteId=${encodeURIComponent(normalizedSiteId)}`;
  }, []);

  const updateSelectedSiteId = useCallback((siteId?: string | null) => {
    const normalizedSiteId = String(siteId ?? "").trim();
    selectedSiteIdRef.current = normalizedSiteId;
    setSelectedSiteId(normalizedSiteId);
  }, []);

  const activePublishable = useMemo(
    () => payload?.publishableKeys.find((key) => key.status === "ACTIVE") ?? payload?.publishableKeys[0] ?? null,
    [payload?.publishableKeys]
  );

  const activeSecret = useMemo(
    () => payload?.secretKeys.find((key) => key.status === "ACTIVE") ?? null,
    [payload?.secretKeys]
  );

  const loadData = useCallback(async (siteIdOverride?: string | null) => {
    setError(null);
    try {
      const requestedSiteId = String(siteIdOverride ?? selectedSiteIdRef.current).trim();
      const response = await apiJSON<ApiKeysPayload>(buildApiKeysUrl(requestedSiteId || undefined));
      setPayload(response);
      const resolvedSiteId =
        String(response.site?.id || "").trim() ||
        String(response.sites[0]?.id || "").trim();
      updateSelectedSiteId(resolvedSiteId);
      usageOverrideSiteId.current = null;
      setOverrideUsage(null);
      await refreshUsageOverride();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load API keys."));
    }
  }, [buildApiKeysUrl, refreshUsageOverride, updateSelectedSiteId]);

  useEffect(() => {
    loadData();
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, [loadData]);

  useEffect(() => {
    setAllowedOrigins(payload?.allowedOrigins ?? []);
  }, [payload?.allowedOrigins]);

  const selectedSite = useMemo(() => {
    if (!payload) return null;
    const normalizedSiteId = String(selectedSiteId || payload.site?.id || "").trim();
    if (!normalizedSiteId) {
      return payload.site ?? payload.sites[0] ?? null;
    }
    return (
      payload.sites.find((site) => site.id === normalizedSiteId) ??
      payload.site ??
      payload.sites[0] ??
      null
    );
  }, [payload, selectedSiteId]);

  useEffect(() => {
    const siteId = payload?.site?.id ?? null;
    if (!siteId) {
      setArcadeEnabled(null);
      return;
    }
    const controller = new AbortController();
    const loadArcadeStatus = async () => {
      try {
        const response = await fetch(
          `/api/settings/arcade/config?siteId=${encodeURIComponent(siteId)}`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          }
        );
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; config?: { enabled?: boolean } }
          | null;
        if (!controller.signal.aborted) {
          if (response.ok && data?.ok) {
            setArcadeEnabled(Boolean(data.config?.enabled));
          } else {
            setArcadeEnabled(false);
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setArcadeEnabled(false);
        }
      }
    };
    void loadArcadeStatus();
    return () => controller.abort();
  }, [payload?.site?.id]);
  const handleCopy = useCallback(
    async (value: string, id: string, message: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedId(id);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(() => setCopiedId(null), 1600);
        showToast(message, "good");
      } catch {
        setCopiedId(id);
        showToast("Copy failed. Try again.", "watch");
      }
    },
    [showToast]
  );

  const handleRotate = useCallback(
    async (keyId: string, type: ApiKeyType) => {
      setRotatingKeyId(keyId);
      try {
        const response = await apiJSON<{ key: ApiKeyDTO; plaintextKey: string }>("/api/settings/api-keys/rotate", {
          method: "POST",
          body: JSON.stringify({ keyId }),
        });
        await loadData();
        await overrideUsageForSite(response.key.bindings.siteId ?? null);
        if (type === "PUBLISHABLE") {
          setPendingPublishable(response.plaintextKey);
          setShowPublishablePanel(true);
        }
        if (type === "SECRET") {
          setPendingSecret(response.plaintextKey);
          setShowSecretPanel(true);
        }
        showToast(`${type === "SECRET" ? "Secret" : "Publishable"} key rotated`);
      } catch (err: unknown) {
        showToast(getErrorMessage(err, "Rotate failed"), "watch");
      } finally {
        setRotatingKeyId(null);
      }
    },
    [loadData, overrideUsageForSite, showToast]
  );

  const closeRevokeModal = useCallback(() => {
    if (Boolean(revokingKeyId)) return;
    setPendingRevokeKeyId(null);
    setRevokeModalOpen(false);
  }, [revokingKeyId]);

  const handleRevokeConfirm = useCallback(async () => {
    if (!pendingRevokeKeyId) return;
    setRevokingKeyId(pendingRevokeKeyId);
    try {
      await apiJSON<{ ok: true }>("/api/settings/api-keys/revoke", {
        method: "POST",
        body: JSON.stringify({ keyId: pendingRevokeKeyId }),
      });
      await loadData();
      showToast("Secret key revoked", "watch");
      closeRevokeModal();
    } catch (err: unknown) {
      showToast(getErrorMessage(err, "Revoke failed"), "watch");
    } finally {
      setRevokingKeyId(null);
    }
  }, [closeRevokeModal, loadData, pendingRevokeKeyId, showToast]);

  const handleCreate = useCallback(
    async (type: ApiKeyType) => {
      try {
        const response = await apiJSON<{ key: ApiKeyDTO; plaintextKey: string }>("/api/settings/api-keys", {
          method: "POST",
          body: JSON.stringify({ type, siteId: selectedSiteIdRef.current || payload?.site?.id || undefined }),
        });
        await loadData();
        await overrideUsageForSite(response.key.bindings.siteId ?? null);
        if (type === "PUBLISHABLE") {
          setPendingPublishable(response.plaintextKey);
          setShowPublishablePanel(true);
        }
        if (type === "SECRET") {
          setPendingSecret(response.plaintextKey);
          setShowSecretPanel(true);
        }
        showToast(`${type === "SECRET" ? "Secret" : "Publishable"} key created`);
      } catch (err: unknown) {
        showToast(getErrorMessage(err, "Create key failed"), "watch");
      }
    },
    [loadData, overrideUsageForSite, payload?.site?.id, showToast]
  );

  const saveOrigins = useCallback(
    async (nextOrigins: string[]) => {
      const siteId = selectedSite?.id ?? payload?.site?.id ?? null;
      if (!siteId) {
        setOriginError("Select a site first.");
        return;
      }
      setOriginSaving(true);
      setOriginError(null);
      try {
        const response = await apiJSON<{ allowedOrigins: string[] }>(
          `/api/settings/sites/${encodeURIComponent(siteId)}/origins`,
          {
            method: "PATCH",
            body: JSON.stringify({ allowedOrigins: nextOrigins }),
          }
        );
        setAllowedOrigins(response.allowedOrigins);
        setOriginInput("");
        showToast("Origin allowlist updated");
      } catch (err: unknown) {
        setOriginError(getErrorMessage(err, "Invalid origin list."));
      } finally {
        setOriginSaving(false);
      }
    },
    [payload?.site?.id, selectedSite?.id, showToast]
  );

  const handleAddOrigin = useCallback(() => {
    const trimmed = originInput.trim();
    if (!trimmed) return;
    if (allowedOrigins.includes(trimmed)) {
      setOriginError("Origin already added.");
      return;
    }
    saveOrigins([...allowedOrigins, trimmed]);
  }, [allowedOrigins, originInput, saveOrigins]);

  const handleRemoveOrigin = useCallback(
    (origin: string) => {
      const next = allowedOrigins.filter((o) => o !== origin);
      saveOrigins(next);
    },
    [allowedOrigins, saveOrigins]
  );

  const openRevokeModal = useCallback((keyId: string) => {
    setPendingRevokeKeyId(keyId);
    setRevokeModalOpen(true);
  }, []);

  const handleSiteContextChange = useCallback(
    async (nextSiteId: string) => {
      const normalizedSiteId = String(nextSiteId || "").trim();
      updateSelectedSiteId(normalizedSiteId);
      if (!normalizedSiteId) {
        await loadData(null);
        return;
      }

      try {
        if (payload?.projectId) {
          await apiJSON<{ ok: true; requestId?: string }>("/api/workspaces/selection", {
            method: "POST",
            body: JSON.stringify({
              projectId: payload.projectId,
              activeSiteId: normalizedSiteId,
            }),
          });
        }
        await loadData(normalizedSiteId);
        showToast("Site context updated");
      } catch (err: unknown) {
        await loadData(normalizedSiteId);
        showToast(getErrorMessage(err, "Failed to update site context"), "watch");
      }
    },
    [loadData, payload?.projectId, showToast, updateSelectedSiteId]
  );

  const renderSnippetCard = (snippet: SnippetCard) => {
    const disabled = !snippet.ready || Boolean(snippet.copyLocked);
    return (
      <article className={`sx-api-snipCard ${disabled ? "is-disabled" : ""}`} key={snippet.id}>
        <div className="sx-api-snipHead">
          <div>
            <div className="sx-footK">{snippet.title}</div>
            <p className="sx-status-sub">{snippet.description}</p>
            {snippet.gateTitle ? <p className="sx-api-gateTitle">{snippet.gateTitle}</p> : null}
            {snippet.gateBadge ? (
              <div className="sx-api-gateBadge">
                <LockIcon className="sx-api-gateBadgeIcon" width={12} height={12} />
                <span className="sx-api-gateBadgeText">{snippet.gateBadge}</span>
              </div>
            ) : null}
          </div>
          <button
            className="sx-api-copy"
            type="button"
            onClick={() => snippet.snippet && handleCopy(snippet.snippet, snippet.id, "Copied snippet")}
            disabled={!snippet.snippet || disabled}
            aria-live="polite"
          >
            {copiedId === snippet.id ? <CheckIcon /> : <CopyIcon />}
            <span className="cb-sr-only">{snippet.ready ? "Copy snippet" : "Snippet locked"}</span>
          </button>
        </div>
        {snippet.snippet ? (
          <pre className="sx-api-snipCode" aria-label={`${snippet.title} code`}>
            {snippet.snippet}
          </pre>
        ) : (
          <div className="sx-api-comingSoon">
            {snippet.lockMessage ?? "Select a site and key to preview this snippet."}
          </div>
        )}
        {snippet.gateMessage ? <p className="sx-api-gateMessage">{snippet.gateMessage}</p> : null}
        <div className="sx-api-snipMeta">{snippet.meta}</div>
      </article>
    );
  };

  const snippetSections = useMemo<SnippetSection[]>(() => {
    const context: SnippetContext = {
      publishableKey: activePublishable?.value ?? null,
      siteId: payload?.site?.id ?? null,
    };
    const ready = isSnippetReady(context);

    const analyticsCard: SnippetCard = {
      id: "analytics",
      title: "Publishable analytics embed",
      description: "Drop this in your storefront to start sending CavBot analytics.",
      snippet: buildAnalyticsSnippet(context),
      ready,
      meta: "",
    };
    const brainCard: SnippetCard = {
      id: "brain",
      title: "CavAi brain loader (deferred)",
      description: "Load CavAi brain intelligence safely with your project context.",
      snippet: buildBrainSnippet(context),
      ready,
      meta: "",
    };

    const arcadeCard: SnippetCard = {
      id: "arcade",
      title: "404 Arcade loader",
      description: "Serve an interactive CavBot recovery experience on your 404 route.",
      snippet: buildArcadeSnippet(context),
      ready,
      meta: "Enable 404 Arcade in Integrations to serve this experience.",
      gateMessage:
        arcadeEnabled === false ? "Enable 404 Arcade in Integrations to activate." : undefined,
      lockMessage: ready ? undefined : "Select a site and key to unlock this snippet.",
      copyLocked: arcadeEnabled === false,
    };

    const widgetGroups = WIDGET_SNIPPET_GROUPS.map((group) => ({
      title: group.title,
      cards: group.configs.map((config) => {
        const feature = widgetFeatureFromWidget(config.widget, config.style);
        const gate = gateCopy(tier, feature);
        const copyLocked = !gate.allowed;
        const gateBadge =
          copyLocked && gate.upsellTier
            ? gate.upsellTier === "premium_plus"
              ? "Premium+"
              : "Premium"
            : undefined;
        return {
          id: config.id,
          title: config.title,
          description: config.description,
          snippet: buildWidgetSnippet({
            widget: config.widget,
            style: config.style,
            position: config.position,
            ready,
            context,
          }),
          ready,
          meta: config.meta ?? "",
          lockMessage: config.lockMessage,
          copyLocked,
          gateBadge,
          gateTitle: copyLocked ? gate.reasonTitle : undefined,
          gateMessage: copyLocked ? gate.reasonBody : undefined,
        };
      }),
    }));

    return [
      {
        id: "intelligence",
        title: "CavBot Intelligence",
        description: "Analytics + brain scripts keep your site aware of visitors and CavAi signals.",
        cards: [analyticsCard, brainCard],
      },
      {
        id: "arcade",
        title: "CavBot Arcade",
        description: "Arcade loader delivers curated CavBot arcade media experiences for your visitors.",
        cards: [arcadeCard],
      },
      {
        id: "widget",
        title: "CavBot Widget",
        description: "Choose the widget form that matches your surface.",
        groups: widgetGroups as SnippetGroup[],
      },
    ];
  }, [activePublishable?.value, payload?.site?.id, tier, arcadeEnabled]);

  const defaultUsage = useMemo(
    () =>
      payload?.usage ?? {
        verifiedToday: null,
        deniedToday: null,
        rateLimit: null,
        topDeniedOrigins: null,
      },
    [payload?.usage]
  );
  const usage = overrideUsage ?? defaultUsage;

  return (
    <div className="sx-api-grid">
      {error ? (
        <div className="sx-api-card sx-api-error">{error}</div>
      ) : null}

      <section className="sx-api-card sx-api-cardContext" aria-label="Site context">
        <div className="sx-api-cardHead sx-api-cardHead--stack">
          <div>
            <div className="sx-footK">Site context</div>
            <p className="sx-status-sub">
              Keys, allowed origins, snippets, and install state below apply only to the selected site. Switching this
              context updates CavBot&apos;s active site target across the metrics pages.
            </p>
          </div>
        </div>
        {payload?.sites.length ? (
          <div className="sx-api-siteContext">
            <div className="sx-api-siteContextControls">
              <label className="sx-api-label" htmlFor="sx-api-site-select">
                Selected site
              </label>
              <select
                id="sx-api-site-select"
                className="sx-api-siteSelect"
                value={selectedSiteId || selectedSite?.id || ""}
                onChange={(event) => {
                  void handleSiteContextChange(event.target.value);
                }}
              >
                {payload.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.origin}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="sx-api-originEmpty">
            Add a website in Command Center first. CavBot generates keys and snippets per site origin, not across the
            whole workspace.
          </div>
        )}
      </section>

      <section className="sx-api-card" aria-label="Publishable key">
        <div className="sx-api-cardHead">
          <div>
            <div className="sx-footK">Publishable key</div>
            <p className="sx-status-sub">Use this in browsers, frontends, and widgets.</p>
          </div>
          {activePublishable ? (
            <button
              className="sx-api-link sx-api-link-pill"
              type="button"
              onClick={() => handleRotate(activePublishable.id, "PUBLISHABLE")}
              disabled={rotatingKeyId === activePublishable.id}
            >
              {rotatingKeyId === activePublishable.id ? "Rotating…" : "Rotate"}
            </button>
          ) : (
            <button
              className="sx-api-link sx-api-link-pill"
              type="button"
              onClick={() => handleCreate("PUBLISHABLE")}
            >
              Create key
            </button>
          )}
        </div>
        <div className="sx-api-keyRow">
          <span className="sx-api-key sx-api-key--soft">
            {activePublishable ? `${activePublishable.prefix}••••${activePublishable.last4}` : "No publishable key yet"}
          </span>
        </div>
        {activePublishable ? (
          <div className="sx-api-meta">
            <span>Scopes: {activePublishable.scopes.join(", ") || "—"}</span>
            <span>Created {formatDate(activePublishable.createdAt)}</span>
            <span>Last used {formatDate(activePublishable.lastUsedAt)}</span>
            <span className={`sx-status-inline is-${activePublishable.status.toLowerCase()}`}>{activePublishable.status}</span>
          </div>
        ) : (
          <p className="sx-status-sub">No publishable key detected yet. Create one to get started.</p>
        )}

        <div className="sx-api-originPanel">
          <div className="sx-api-label">Allowed origins for this site</div>
          <div className="sx-api-originList">
            {allowedOrigins.length ? (
              allowedOrigins.map((origin) => (
                <div className="sx-origin-row" key={origin}>
                  <div className="sx-origin-text">{origin}</div>
                  <button
                    type="button"
                    className="sx-origin-remove"
                    aria-label={`Remove ${origin}`}
                    onClick={() => handleRemoveOrigin(origin)}
                    disabled={originSaving}
                  >
                    <span className="cb-closeIcon" aria-hidden="true" />
                  </button>
                </div>
              ))
            ) : (
              <div className="sx-origin-empty">No origins added for this site yet.</div>
            )}
          </div>
        </div>

        <div className="sx-origin-editor">
          <input
            className="sx-origin-input"
            type="text"
            value={originInput}
            onChange={(event) => setOriginInput(event.target.value)}
            placeholder="https://example.com or https://*.example.com"
            disabled={originSaving}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddOrigin();
              }
            }}
          />
          <button
            className="sx-api-copySmall"
            type="button"
            onClick={handleAddOrigin}
            disabled={!originInput.trim() || originSaving}
          >
            {originSaving ? "Saving…" : "Add origin"}
          </button>
        </div>
        {originError ? <p className="sx-origin-error">{originError}</p> : null}

        {pendingPublishable && showPublishablePanel ? (
          <div className="sx-api-plaintext">
            <div>
              <div className="sx-footK">New publishable key</div>
              <p className="sx-status-sub">Store it now. It won’t be shown again.</p>
            </div>
            <div className="sx-api-keyRow">
              <span className="sx-api-key sx-api-key--soft">{pendingPublishable}</span>
              <button
                className="sx-api-iconBtn"
                type="button"
                onClick={() => handleCopy(pendingPublishable, "publishable-reveal", "Copied publishable key")}
                aria-label="Copy plaintext publishable key"
              >
                {copiedId === "publishable-reveal" ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <button className="sx-api-link sx-api-link-compact" type="button" onClick={() => setShowPublishablePanel(false)}>
              Dismiss
            </button>
          </div>
        ) : null}
      </section>

      <section className="sx-api-card" aria-label="Secret key">
        <div className="sx-api-cardHead">
          <div>
            <div className="sx-footK">Secret key</div>
            <p className="sx-status-sub">Server-to-server only. Never expose this in the browser.</p>
          </div>
          <div className="sx-api-actions">
          {activeSecret ? (
            <button
              className="sx-api-link sx-api-link-pill"
              type="button"
              onClick={() => handleRotate(activeSecret.id, "SECRET")}
              disabled={rotatingKeyId === activeSecret.id}
            >
              {rotatingKeyId === activeSecret.id ? "Rotating…" : "Rotate"}
            </button>
          ) : (
            <button
              className="sx-api-link sx-api-link-pill"
              type="button"
              onClick={() => handleCreate("SECRET")}
            >
              Create
            </button>
          )}
	          <button
	            className="sx-api-link sx-api-link-pill sx-api-link-icon sx-api-eyeBtn"
	            type="button"
	            onClick={() => setShowSecretPanel((prev) => !prev)}
	            aria-label={pendingSecret ? "Reveal secret key" : "Show secret panel"}
	          >
	            <EyeIcon />
	          </button>
          </div>
        </div>
        <div className="sx-api-keyRow">
          <span className="sx-api-key sx-api-key--soft">
            {activeSecret ? `${activeSecret.prefix}••••${activeSecret.last4}` : "Key not configured"}
          </span>
        </div>
        {activeSecret ? (
          <div className="sx-api-meta">
            <span>Scopes: {activeSecret.scopes.join(", ") || "—"}</span>
            <span>Created {formatDate(activeSecret.createdAt)}</span>
            <span>Last used {formatDate(activeSecret.lastUsedAt)}</span>
            <span className={`sx-status-inline is-${activeSecret.status.toLowerCase()}`}>{activeSecret.status}</span>
          </div>
        ) : (
          <p className="sx-status-sub">Generate a secret server key to unlock CavBot ingestion.</p>
        )}

        {showSecretPanel ? (
          <div className="sx-api-plaintext">
            {pendingSecret ? (
              <>
                <div>
                  <div className="sx-footK">New secret key</div>
                  <p className="sx-status-sub">Store it now. Rotating is the only way to view again.</p>
                </div>
                <div className="sx-api-keyRow">
                  <span className="sx-api-key sx-api-key--soft">{pendingSecret}</span>
                  <button
                    className="sx-api-iconBtn"
                    type="button"
                    onClick={() => handleCopy(pendingSecret, "secret-reveal", "Copied secret key")}
                    aria-label="Copy secret key"
                  >
                    {copiedId === "secret-reveal" ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <p className="sx-status-sub">This key can’t be revealed again. Rotate to generate a new one.</p>
              </div>
            )}
          </div>
        ) : null}

        {activeSecret ? (
          <div className="sx-api-actions">
            <button
              className="sx-status-cta sx-api-danger"
              type="button"
              onClick={() => openRevokeModal(activeSecret.id)}
              disabled={Boolean(revokingKeyId)}
            >
              {revokingKeyId ? "Revoking…" : "Revoke secret key"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="sx-api-card sx-api-snippets" aria-label="Snippets">
        <div className="sx-api-cardHead">
          <div>
            <div className="sx-footK">Snippets</div>
            <p className="sx-status-sub" style={{ maxWidth: "100%" }}>
              Copy-ready scripts that wire analytics and the CavAi brain to your site. The snippet output below is for{" "}
              {selectedSite?.origin ?? "the selected site"} only, so switch the site context above to generate a
              different install for another origin.
            </p>
          </div>
        </div>
        <div className="sx-api-snippetSections">
          {snippetSections.map((section) => (
            <div
              className={`sx-api-snippetSection${section.id === "widget" ? " sx-api-snippetSection--widget" : ""}`}
              key={section.id}
            >
              <div className="sx-api-snippetSectionHead">
                <div>
                  <div className="sx-footK">{section.title}</div>
                  <p className="sx-status-sub">{section.description}</p>
                </div>
              </div>
              {section.cards && (
                <div className="sx-api-snippetGrid">
                  {section.cards.map((snippet) => renderSnippetCard(snippet))}
                </div>
              )}
              {section.groups &&
                section.groups.map((group) => (
                  <div className="sx-api-snippetGroup" key={group.title}>
                    <div className="sx-snippet-groupHead">
                    <div>
                      {group.description ? <p className="sx-status-sub">{group.description}</p> : null}
                    </div>
                    </div>
                    <div className="sx-api-snippetGrid sx-api-snippetGrid--compact">
                      {group.cards.map((snippet) => renderSnippetCard(snippet))}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </section>

      <section className="sx-api-card" aria-label="Developer resources">
        <div className="sx-api-cardHead">
          <div>
            <div className="sx-footK">CavTools resources</div>
            <p className="sx-status-sub" style={{ maxWidth: "100%" }}>
              CavTools + dashboards that keep CavBot integrations bright.
            </p>
          </div>
        </div>
        <div className="sx-api-meta sx-api-meta-column">
          {[
            { label: "CavTools", href: "/cavtools" },
            { label: "CavCode (code editor)", href: "/cavcode" },
            { label: "CavCode Viewer (html code viewer)", href: "/cavcode-viewer" },
            { label: "CavCloud (internal storage)", href: "/cavcloud" },
          ].map((resource) => (
            <Link
              key={resource.label}
              href={resource.href}
              className="sx-api-link sx-api-link-pill sx-api-resource"
            >
              {resource.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="sx-api-card sx-api-cardSecurity" aria-label="Security metrics">
        <div className="sx-api-cardHead">
          <div>
            <div className="sx-footK">Security & usage</div>
            <p className="sx-status-sub">Telemetry surfaces where your keys are live.</p>
          </div>
            <Link className="sx-api-link sx-api-link-pill" href="/settings?tab=history">
              View audit log
            </Link>
        </div>
        <div className="sx-api-stats">
          <div className="sx-api-statRow">
            <span>Verified embed checks today</span>
            <span>{usage.verifiedToday ?? "—"}</span>
          </div>
          <div className="sx-api-statRow">
            <span>Denied embed checks today</span>
            <span>{usage.deniedToday ?? "—"}</span>
          </div>
          <div className="sx-api-statRow">
            <span>Rate limit</span>
            <span>{usage.rateLimit ?? "—"}</span>
          </div>
          <div className="sx-api-statRow">
            <span>Top denied origins</span>
            <span>
              {usage.topDeniedOrigins && usage.topDeniedOrigins.length
                ? usage.topDeniedOrigins.join(", ")
                : "—"}
            </span>
          </div>
        </div>
      </section>

      {toast ? (
        <div className="sx-apiToast" data-tone={toast.tone} role="status" aria-live="polite">
          {toast.msg}
        </div>
      ) : null}
      {revokeModalOpen && pendingRevokeKeyId ? (
        <div className="cb-home-modal" role="dialog" aria-modal="true" aria-label="Revoke key">
          <div className="cb-home-modal-overlay" onClick={closeRevokeModal} aria-hidden="true" />
          <div className="cb-home-modal-panel cb-home-modal-panel-tight danger">
            <div className="cb-home-modal-head cb-home-modal-head--warning">
              <div>
                <div className="cb-home-modal-title">Revoke secret key</div>
                <div className="cb-home-modal-sub">Revoke this key? This cannot be undone.</div>
              </div>
            </div>
            <div className="cb-home-modal-actions">
              <button type="button" className="cb-linkpill cb-linkpill-ghost" onClick={closeRevokeModal} disabled={Boolean(revokingKeyId)}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-linkpill cb-linkpill-blue"
                onClick={handleRevokeConfirm}
                disabled={Boolean(revokingKeyId)}
              >
                {revokingKeyId ? "Revoking…" : "Revoke key"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
