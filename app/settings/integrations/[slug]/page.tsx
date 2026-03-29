"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { notFound } from "next/navigation";

import AppShell from "@/components/AppShell";
import { CheckIcon, CopyIcon } from "@/components/CopyIcons";
import { LockIcon } from "@/components/LockIcon";
import { INTEGRATION_MAP } from "../integration-registry";
import ArcadePreview from "../ArcadePreview";
import {
  buildAnalyticsSnippet,
  buildArcadeSnippet,
  buildBrainSnippet,
  buildWidgetSnippet,
  isSnippetReady,
  SnippetContext,
  WidgetPosition,
  WidgetStyle,
  WidgetType,
} from "@/lib/settings/snippetGenerators";
import { canUseWidgetFeature, gateCopy, widgetFeatureFromWidget } from "@/lib/billing/featureGates";
import { useAccountTier } from "@/lib/hooks/useAccountTier";
import { ARCADE_GAME_SORT_ORDER } from "@/lib/billing/arcadeGates";
import type { ArcadeLockMap } from "@/lib/billing/arcadeGates";
import {
  ArcadeGameSummary,
  ArcadeConfigPayload,
  ArcadeConfigResponse,
  DEFAULT_ARCADE_OPTIONS,
  SiteArcadeOptions,
  buildArcadeThumbnailUrl,
} from "@/lib/arcade/settings";

import "../../settings.css";
import "../integrations.css";

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "widget", label: "Widget" },
  { id: "arcade", label: "Arcade" },
  { id: "analytics", label: "Analytics & Brain" },
] as const;

type FilterTab = (typeof FILTER_TABS)[number]["id"];

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

type InstallEntry = {
  kind: string;
  widgetType: string | null;
  style: string | null;
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
  connectedSummary: {
    badgeInline: boolean;
    badgeRing: boolean;
    headOrbit: boolean;
    bodyFull: boolean;
  };
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

type PageProps = {
  params: {
    slug: string;
  };
};

const STYLE_OPTIONS: Record<WidgetType, WidgetStyle[]> = {
  badge: ["inline", "ring"],
  head: ["orbit"],
  body: ["full"],
};

const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  badge: "Badge",
  head: "Head",
  body: "Body",
};

const WIDGET_STYLE_LABELS: Record<WidgetStyle, string> = {
  inline: "Inline",
  ring: "Ring",
  orbit: "Orbit",
  full: "Full",
};

const POSITION_OPTIONS: WidgetPosition[] = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
  "center",
  "center-left",
  "center-right",
  "inline",
];

const POSITION_LABELS: Record<WidgetPosition, string> = {
  "bottom-right": "Bottom right",
  "bottom-left": "Bottom left",
  "top-right": "Top right",
  "top-left": "Top left",
  center: "Center",
  "center-left": "Center left",
  "center-right": "Center right",
  inline: "Inline",
};

const SCRIPT_LOCK_MESSAGE = "Select a site and key to unlock scripts.";

const ARCADE_GAME_SORT_INDEX: Record<string, number> = ARCADE_GAME_SORT_ORDER.reduce(
  (map, slug, index) => {
    map[slug] = index;
    return map;
  },
  {} as Record<string, number>
);

function sortArcadeGames(games: ArcadeGameSummary[]): ArcadeGameSummary[] {
  return [...games]
    .map((game, index) => ({ game, index }))
    .sort((a, b) => {
      const rankA = ARCADE_GAME_SORT_INDEX[a.game.slug] ?? Infinity;
      const rankB = ARCADE_GAME_SORT_INDEX[b.game.slug] ?? Infinity;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map(({ game }) => game);
}

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
  gateBadge?: string;
  gateTitle?: string;
  gateMessage?: string;
  copyLocked?: boolean;
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
  gateBadge,
  gateTitle,
  gateMessage,
  copyLocked,
  onCopy,
  copiedId,
}: SnippetBlockProps) {
  const disabled = !ready || Boolean(copyLocked);
  return (
    <article className={`sx-api-snipCard ${disabled ? "is-disabled" : ""}`}>
      <div className="sx-api-snipHead">
        <div>
          <div className="sx-footK">{title}</div>
          <p className="sx-status-sub">{description}</p>
          {gateTitle ? <p className="sx-api-gateTitle">{gateTitle}</p> : null}
          {gateBadge ? (
            <div className="sx-api-gateBadge">
              <LockIcon className="sx-api-gateBadgeIcon" width={12} height={12} />
              <span className="sx-api-gateBadgeText">{gateBadge}</span>
            </div>
          ) : null}
        </div>
        <button
          className="sx-api-copy"
          type="button"
          onClick={() => snippet && onCopy(id, snippet)}
          disabled={!snippet || disabled}
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
      {gateMessage ? <p className="sx-api-gateMessage">{gateMessage}</p> : null}
    </article>
  );
}

type ArcadeConfigDraft = {
  enabled: boolean;
  gameSlug: string | null;
  gameVersion: string | null;
  options: SiteArcadeOptions;
};

const ARCADE_DIFFICULTIES: SiteArcadeOptions["difficulty"][] = ["easy", "standard", "hard"];
function createArcadeDraft(config: ArcadeConfigPayload | null): ArcadeConfigDraft {
  return {
    enabled: config?.enabled ?? false,
    gameSlug: config?.gameSlug ?? null,
    gameVersion: config?.gameVersion ?? null,
    options: {
      ...DEFAULT_ARCADE_OPTIONS,
      ...(config?.options ?? {}),
    },
  };
}

export default function IntegrationProfilePage({ params }: PageProps) {
  const integration = INTEGRATION_MAP.get(params.slug);
  if (!integration || params.slug !== "cavbot") {
    notFound();
  }

  const [tab, setTab] = useState<FilterTab>("all");
  const [payload, setPayload] = useState<ApiKeysPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [widgetType, setWidgetType] = useState<WidgetType>("badge");
  const [widgetStyle, setWidgetStyle] = useState<WidgetStyle>("inline");
  const [widgetPosition, setWidgetPosition] = useState<WidgetPosition>("bottom-right");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [installState, setInstallState] = useState<InstallStatePayload | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const tier = useAccountTier();
  const [arcadeDraft, setArcadeDraft] = useState<ArcadeConfigDraft>(createArcadeDraft(null));
  const [arcadeGames, setArcadeGames] = useState<ArcadeGameSummary[]>([]);
  const [arcadeLoading, setArcadeLoading] = useState(false);
  const [arcadeSaving, setArcadeSaving] = useState(false);
  const [arcadeError, setArcadeError] = useState<string | null>(null);
  const [arcadeAllowedGames, setArcadeAllowedGames] = useState<string[]>([]);
  const [arcadeLockMap, setArcadeLockMap] = useState<ArcadeLockMap>({});
  const arcadeAllowedSet = useMemo(() => new Set(arcadeAllowedGames), [arcadeAllowedGames]);
  const isArcadeGameAllowedInUI = useCallback(
    (slug: string) => arcadeAllowedSet.size === 0 || arcadeAllowedSet.has(slug),
    [arcadeAllowedSet]
  );

  const heroRef = useRef<HTMLDivElement>(null);
  const widgetCardRef = useRef<HTMLDivElement>(null);
  const arcadeCardRef = useRef<HTMLDivElement>(null);
  const analyticsCardRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const arcadeSaveTimerRef = useRef<number | null>(null);
  const arcadePendingDraftRef = useRef<ArcadeConfigDraft | null>(null);
  const arcadePickerGridRef = useRef<HTMLDivElement>(null);
  const arcadeGameRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const scrollTimeoutRef = useRef<number | null>(null);
  const autoScrollContextRef = useRef<{ siteId: string | null; key: string | null }>({
    siteId: null,
    key: null,
  });
  const arcadeUserInteractedRef = useRef(false);
  const previousArcadeSiteRef = useRef<string | null>(null);
  const [visibleArcadeKey, setVisibleArcadeKey] = useState<string | null>(null);

  const persistedArcadeGame = useMemo(() => {
    if (!arcadeDraft.gameSlug || !arcadeDraft.gameVersion) {
      return null;
    }
    return (
      arcadeGames.find(
        (game) => game.slug === arcadeDraft.gameSlug && game.version === arcadeDraft.gameVersion
      ) ?? null
    );
  }, [arcadeGames, arcadeDraft.gameSlug, arcadeDraft.gameVersion]);

  const persistedArcadeKey = persistedArcadeGame
    ? `${persistedArcadeGame.slug}-${persistedArcadeGame.version}`
    : null;

  const firstArcadeGame = arcadeGames[0] ?? null;
  const firstArcadeKey = firstArcadeGame
    ? `${firstArcadeGame.slug}-${firstArcadeGame.version}`
    : null;

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (arcadeSaveTimerRef.current) window.clearTimeout(arcadeSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const siteId = payload?.site?.id ?? null;
    if (previousArcadeSiteRef.current === siteId) {
      return;
    }
    previousArcadeSiteRef.current = siteId;
    setVisibleArcadeKey(null);
    arcadeUserInteractedRef.current = false;
    autoScrollContextRef.current = { siteId: null, key: null };
  }, [payload?.site?.id]);

  useEffect(() => {
    if (!firstArcadeKey) return;
    if (visibleArcadeKey) return;
    const targetKey = persistedArcadeKey ?? firstArcadeKey;
    setVisibleArcadeKey(targetKey);
  }, [firstArcadeKey, persistedArcadeKey, visibleArcadeKey]);

  useLayoutEffect(() => {
    if (!persistedArcadeKey || !arcadeGames.length || arcadeUserInteractedRef.current) {
      return;
    }
    const siteId = payload?.site?.id ?? null;
    if (
      autoScrollContextRef.current.siteId === siteId &&
      autoScrollContextRef.current.key === persistedArcadeKey
    ) {
      return;
    }
    const button = arcadeGameRefs.current[persistedArcadeKey];
    if (!button || !arcadePickerGridRef.current) {
      return;
    }
    button.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
    autoScrollContextRef.current = { siteId, key: persistedArcadeKey };
  }, [persistedArcadeKey, arcadeGames.length, payload?.site?.id]);

  const loadKeys = useCallback(async () => {
    setError(null);
    try {
      const response = await apiJSON<ApiKeysPayload>("/api/settings/api-keys");
      setPayload(response);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Unable to load CavBot install status."));
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const loadArcadeConfig = useCallback(async (siteId: string) => {
    setArcadeLoading(true);
    setArcadeError(null);
    try {
      const response = await apiJSON<ArcadeConfigResponse>(
        `/api/settings/arcade/config?siteId=${encodeURIComponent(siteId)}`
      );
      setArcadeGames(sortArcadeGames(response.games));
      setArcadeAllowedGames(response.allowedGames ?? []);
      setArcadeLockMap(response.lockMap ?? {});
      setArcadeDraft(createArcadeDraft(response.config));
    } catch (err: unknown) {
    setArcadeError(getErrorMessage(err, "Unable to load Arcade settings."));
      setArcadeDraft(createArcadeDraft(null));
      setArcadeAllowedGames([]);
      setArcadeLockMap({});
    } finally {
      setArcadeLoading(false);
    }
  }, []);

  useEffect(() => {
    const siteId = payload?.site?.id;
    if (!siteId) {
      setArcadeDraft(createArcadeDraft(null));
      setArcadeGames([]);
      setArcadeAllowedGames([]);
      setArcadeLockMap({});
      return;
    }

    void loadArcadeConfig(siteId);
  }, [payload?.site?.id, loadArcadeConfig]);

  const submitArcadeConfig = useCallback(
    async (draft: ArcadeConfigDraft | null) => {
      if (!draft || !payload?.site?.id) return;
      setArcadeSaving(true);
      setArcadeError(null);
      try {
        const response = await apiJSON<ArcadeConfigResponse>("/api/settings/arcade/config", {
          method: "PUT",
          body: JSON.stringify({
            siteId: payload.site.id,
            enabled: draft.enabled,
            gameSlug: draft.gameSlug,
            gameVersion: draft.gameVersion,
            options: draft.options,
          }),
        });
        setArcadeGames(sortArcadeGames(response.games));
        setArcadeAllowedGames(response.allowedGames ?? []);
        setArcadeLockMap(response.lockMap ?? {});
        setArcadeDraft(createArcadeDraft(response.config));
      } catch (err: unknown) {
        setArcadeError(getErrorMessage(err, "Unable to update Arcade settings."));
      } finally {
        setArcadeSaving(false);
      }
    },
    [payload?.site?.id]
  );

  const scheduleArcadeSave = useCallback(
    (nextDraft: ArcadeConfigDraft) => {
      arcadePendingDraftRef.current = nextDraft;
      if (arcadeSaveTimerRef.current) {
        window.clearTimeout(arcadeSaveTimerRef.current);
      }
      arcadeSaveTimerRef.current = window.setTimeout(() => {
        const draftToSave = arcadePendingDraftRef.current;
        arcadePendingDraftRef.current = null;
        arcadeSaveTimerRef.current = null;
        void submitArcadeConfig(draftToSave);
      }, 300);
    },
    [submitArcadeConfig]
  );

  const updateArcadeDraft = useCallback(
    (nextDraft: ArcadeConfigDraft) => {
      setArcadeDraft(nextDraft);
      scheduleArcadeSave(nextDraft);
    },
    [scheduleArcadeSave]
  );

  const selectArcadeGame = useCallback(
    (game: ArcadeGameSummary) => {
      if (!isArcadeGameAllowedInUI(game.slug)) {
        return false;
      }
      if (arcadeDraft.gameSlug === game.slug && arcadeDraft.gameVersion === game.version) {
        return false;
      }
      arcadeUserInteractedRef.current = true;
      updateArcadeDraft({
        ...arcadeDraft,
        enabled: true,
        gameSlug: game.slug,
        gameVersion: game.version,
      });
      setVisibleArcadeKey(`${game.slug}-${game.version}`);
      return true;
    },
    [arcadeDraft, updateArcadeDraft, isArcadeGameAllowedInUI]
  );

  const scrollArcadeGameIntoView = useCallback((game: ArcadeGameSummary) => {
    const key = `${game.slug}-${game.version}`;
    const button = arcadeGameRefs.current[key];
    if (button && arcadePickerGridRef.current) {
      button.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, []);

  const handleArcadeDotClick = useCallback(
    (game: ArcadeGameSummary) => {
      const didSelect = selectArcadeGame(game);
      if (!didSelect) return;
      scrollArcadeGameIntoView(game);
      setVisibleArcadeKey(`${game.slug}-${game.version}`);
    },
    [selectArcadeGame, scrollArcadeGameIntoView]
  );

  const handleArcadeScroll = useCallback(() => {
    if (!arcadePickerGridRef.current) return;
    if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = window.setTimeout(() => {
      const gridRect = arcadePickerGridRef.current!.getBoundingClientRect();
      const centerX = gridRect.left + gridRect.width / 2;
      let closestDist = Infinity;
      let closestKey: string | null = null;
      arcadeGames.forEach((game) => {
        const key = `${game.slug}-${game.version}`;
        const button = arcadeGameRefs.current[key];
        if (!button) return;
        const rect = button.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        const dist = Math.abs(mid - centerX);
        if (dist < closestDist) {
          closestDist = dist;
          closestKey = key;
        }
      });
      if (closestKey) {
        setVisibleArcadeKey(closestKey);
      }
    }, 120);
  }, [arcadeGames]);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) window.clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (arcadeDraft.gameSlug && arcadeDraft.gameVersion) {
      setVisibleArcadeKey(`${arcadeDraft.gameSlug}-${arcadeDraft.gameVersion}`);
    }
  }, [arcadeDraft.gameSlug, arcadeDraft.gameVersion]);

  useEffect(() => {
    if (!arcadeAllowedGames.length) return;
    if (!arcadeDraft.enabled || !arcadeDraft.gameSlug) return;
    if (arcadeAllowedSet.has(arcadeDraft.gameSlug)) return;
    const fallbackSlug = arcadeAllowedGames[0];
    const fallbackGame = arcadeGames.find((entry) => entry.slug === fallbackSlug);
    if (!fallbackGame) return;
    setArcadeDraft((prev) => ({
      ...prev,
      gameSlug: fallbackGame.slug,
      gameVersion: fallbackGame.version,
    }));
  }, [arcadeAllowedGames, arcadeAllowedSet, arcadeDraft.enabled, arcadeDraft.gameSlug, arcadeGames]);

  const updateArcadeOptions = useCallback(
    (patch: Partial<SiteArcadeOptions>) => {
      updateArcadeDraft({
        ...arcadeDraft,
        options: {
          ...arcadeDraft.options,
          ...patch,
        },
      });
    },
    [arcadeDraft, updateArcadeDraft]
  );

  const fetchInstallState = useCallback(async (siteId: string) => {
    if (!siteId) return;
    setInstallError(null);
    try {
      const response = await fetch(
        `/api/settings/integrations/cavbot/install-state?siteId=${encodeURIComponent(siteId)}`,
        {
          cache: "no-store",
          credentials: "include",
        }
      );
      const data = (await response.json().catch(() => null)) as
        | InstallStatePayload
        | { ok?: false; error?: string };
      if (!response.ok || !data?.ok) {
        throw new Error((data as { error?: string })?.error || "Unable to load install status.");
      }
      setInstallState(data);
    } catch (fetchError) {
      setInstallError(fetchError instanceof Error ? fetchError.message : "Install status unavailable.");
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

  const activePublishable = useMemo(() => {
    return (
      payload?.publishableKeys.find((key) => key.status === "ACTIVE") ??
      payload?.publishableKeys[0] ??
      null
    );
  }, [payload?.publishableKeys]);

  useEffect(() => {
    const options = STYLE_OPTIONS[widgetType];
    setWidgetStyle((prev) => (options.includes(prev) ? prev : options[0]));
  }, [widgetType]);

  useEffect(() => {
    if (widgetType === "body" && !canUseWidgetFeature(tier, "body_full")) {
      if (canUseWidgetFeature(tier, "head_orbit")) {
        setWidgetType("head");
      } else {
        setWidgetType("badge");
      }
      return;
    }
    if (widgetType === "head" && !canUseWidgetFeature(tier, "head_orbit")) {
      setWidgetType("badge");
    }
  }, [tier, widgetType]);

  const snippetContext = useMemo<SnippetContext>(() => {
    return {
      publishableKey: activePublishable?.value ?? null,
      siteId: payload?.site?.id ?? null,
    };
  }, [activePublishable?.value, payload?.site?.id]);

  const ready = isSnippetReady(snippetContext);
  const selectedFeature = widgetFeatureFromWidget(widgetType, widgetStyle);
  const selectedGate = gateCopy(tier, selectedFeature);
  const featureAllowed = selectedGate.allowed;
  const gateBadge =
    !featureAllowed && selectedGate.upsellTier
      ? selectedGate.upsellTier === "premium_plus"
        ? "Premium+"
        : "Premium"
      : undefined;
  const upgradeLabel =
    selectedGate.upsellTier === "premium_plus" ? "Upgrade to Premium+" : "Upgrade to Premium";
  const widgetSnippet = buildWidgetSnippet({
    widget: widgetType,
    style: widgetStyle,
    position: widgetPosition,
    ready,
    context: snippetContext,
  });
  const selectedInstall = useMemo(() => {
    if (!installState) return null;
    return installState.installs.find(
      (entry) =>
        entry.widgetType === widgetType &&
        entry.style === widgetStyle &&
        entry.status === "ACTIVE"
    ) ?? null;
  }, [installState, widgetType, widgetStyle]);
  const isConnected = featureAllowed && Boolean(selectedInstall);
  const buttonStateClass = featureAllowed
    ? isConnected
      ? "is-connected"
      : "is-disconnected"
    : "is-gated";
  const buttonLabel = featureAllowed
    ? isConnected
      ? "Connected"
      : "Connect"
    : upgradeLabel;
  const lastSeenLabel = selectedInstall?.lastSeenAt
    ? new Date(selectedInstall.lastSeenAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const analyticsSnippet = buildAnalyticsSnippet(snippetContext);
  const brainSnippet = buildBrainSnippet(snippetContext);

  const arcadeInstall = useMemo(() => {
    if (!installState) return null;
    return installState.installs.find((entry) => entry.kind === "ARCADE") ?? null;
  }, [installState]);
  const arcadeDetected = Boolean(arcadeInstall?.status === "ACTIVE");
  const arcadeLastSeenLabel = arcadeInstall?.lastSeenAt
    ? new Date(arcadeInstall.lastSeenAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const arcadeInstallOrigin = arcadeInstall?.origin ?? payload?.site?.origin ?? "";
  const arcadeOriginLabel = arcadeInstallOrigin
    ? arcadeInstallOrigin.replace(/^https?:\/\//, "")
    : "—";
  const selectedArcadeGame = arcadeGames.find(
    (game) =>
      game.slug === arcadeDraft.gameSlug && game.version === arcadeDraft.gameVersion
  );
  const selectedArcadeGameValueClassName = selectedArcadeGame
    ? "cb-arcadeDetectionValue cb-arcadeDetectionValue--game"
    : "cb-arcadeDetectionValue";
  const lastSeenValueClassName = `cb-arcadeDetectionValue${
    arcadeLastSeenLabel ? "" : " cb-arcadeDetectionValue--offline"
  }`;
  const selectedArcadeThumbnailUrl = useMemo(() => {
    if (!arcadeDraft.gameSlug || !arcadeDraft.gameVersion) {
      return null;
    }
    return buildArcadeThumbnailUrl(arcadeDraft.gameSlug, arcadeDraft.gameVersion);
  }, [arcadeDraft.gameSlug, arcadeDraft.gameVersion]);
  const arcadeSnippetContext = useMemo<SnippetContext>(
    () => ({
      publishableKey: activePublishable?.value ?? null,
      siteId: payload?.site?.id ?? null,
    }),
    [activePublishable?.value, payload?.site?.id]
  );
  const arcadeSnippet = buildArcadeSnippet(arcadeSnippetContext);

  const showWidgetCard = tab === "all" || tab === "widget";
  const showArcadeCard = tab === "all" || tab === "arcade";
  const showAnalyticsCard = tab === "all" || tab === "analytics";
  const showWidgetInstall = tab === "all" || tab === "widget";
  const showAnalyticsInstall = tab === "all" || tab === "analytics";

  const handleSnippetCopy = useCallback(async (id: string, snippet: string) => {
    if (!snippet) return;
    if (!navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedId(id);
      if (copyTimerRef.current) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopiedId(id);
    }
  }, []);

  const handleTabChange = useCallback(
    (nextTab: FilterTab) => {
      setTab(nextTab);
      const targetRef =
        nextTab === "widget"
          ? widgetCardRef
          : nextTab === "arcade"
          ? arcadeCardRef
          : nextTab === "analytics"
          ? analyticsCardRef
          : heroRef;
      if (!targetRef.current || typeof window === "undefined") return;
      targetRef.current.scrollIntoView({
        behavior: "smooth",
        block: window.innerWidth < 640 ? "center" : "start",
      });
    },
    [heroRef, analyticsCardRef, widgetCardRef, arcadeCardRef]
  );

  const statusHint = ready ? "Ready" : "Select a site and key to unlock";

  return (
    <AppShell title="Settings" subtitle="Account preferences and workspace configuration">
      <div className="sx-page cb-cavbotPage">
        <section className="sx-panel cb-heroPanel" ref={heroRef} aria-label="CavBot integration hero">
          <header className="sx-panelHead">
            <div className="cb-heroTitle">
              <div className="cb-heroIcon" aria-hidden="true">
                <Image
                  src="/logo/cavbot-logomark.svg"
                  alt="CavBot logomark"
                  width={40}
                  height={40}
                  priority
                  unoptimized
                />
              </div>
              <div>
                <h1 className="sx-h1">CavBot Integration</h1>
                <p className="sx-sub">
                  Drop CavBot into every surface with a calm, guided installer and tailored widgets.
                </p>
              </div>
            </div>
          </header>
          <div className="sx-body cb-heroStatus">
            <div className="cb-heroStatusRow">
              <p className="sx-footK">Site selected</p>
              <p className="cb-statusValue">{payload?.site?.origin ?? "Select a site to unlock scripts"}</p>
            </div>
            <div className="cb-heroStatusRow">
              <p className="sx-footK">Publishable key</p>
              <p className="cb-statusValue">
                {activePublishable
                  ? `${activePublishable.prefix}••••${activePublishable.last4}`
                  : "Create a publishable key to unlock scripts"}
              </p>
            </div>
            {error && <p className="sx-status-sub cb-heroError">{error}</p>}
          </div>
        </section>

        <div className="cb-filterRow" aria-label="CavBot feature filter">
          <label className="cb-filterLabel" htmlFor="cb-feature-filter">
            View
          </label>
          <select
            id="cb-feature-filter"
            className="cb-filterSelect"
            value={tab}
            onChange={(event) => handleTabChange(event.target.value as FilterTab)}
          >
            {FILTER_TABS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="cb-featureCards">
          {showWidgetCard && (
            <article ref={widgetCardRef} className="sx-panel cb-featureCard">
              <header className="sx-panelHead">
                <div>
                  <p className="sx-footK">Widget</p>
                  <h2 className="sx-h2">CavBot Widget</h2>
                  <p className="sx-sub">
                    Flexible CavBot badges, heads, and bodies tailored for your hero surface.
                  </p>
                </div>
                <span className="cb-statusDotWrapper">
                  <span
                    className={`cb-statusDot ${ready ? "is-ready" : "is-locked"}`}
                    aria-hidden="true"
                  />
                  <span className="cb-statusText cb-sr-only">
                    {ready ? "Ready" : "Select a site and key to unlock"}
                  </span>
                </span>
              </header>
              <div className="sx-body">
                <ul className="cb-widgetSubfeatures">
                  <li>
                    <span className="cb-widgetSubTitle">Badge</span>
                    <span className="cb-widgetSubDetail">Inline • Ring</span>
                  </li>
                  <li>
                    <span className="cb-widgetSubTitle">Head</span>
                    <span className="cb-widgetSubDetail">Orbit</span>
                  </li>
                  <li>
                    <span className="cb-widgetSubTitle">Full body</span>
                    <span className="cb-widgetSubDetail">Premium+ exclusive</span>
                  </li>
                </ul>
                  <div className="cb-widgetPicker">
                    <div className="cb-pickerPanel">
                      <div className="cb-pickerField">
                        <label className="cb-pickerLabel" htmlFor="widgetType">
                          Widget type
                        </label>
                        <select
                          id="widgetType"
                          className="cb-pickerSelect"
                          value={widgetType}
                          onChange={(event) => setWidgetType(event.target.value as WidgetType)}
                        >
                          {Object.entries(WIDGET_TYPE_LABELS).map(([value, label]) => {
                            const optionType = value as WidgetType;
                            const optionDisabled =
                              optionType === "head"
                                ? !canUseWidgetFeature(tier, "head_orbit")
                                : optionType === "body"
                                ? !canUseWidgetFeature(tier, "body_full")
                                : false;
                            return (
                              <option key={value} value={value} disabled={optionDisabled}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="cb-pickerField">
                        <label className="cb-pickerLabel" htmlFor="widgetStyle">
                          Style
                        </label>
                        <select
                          id="widgetStyle"
                          className="cb-pickerSelect"
                          value={widgetStyle}
                          onChange={(event) => setWidgetStyle(event.target.value as WidgetStyle)}
                        >
                          {STYLE_OPTIONS[widgetType].map((style) => (
                            <option key={style} value={style}>
                              {WIDGET_STYLE_LABELS[style]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="cb-pickerField">
                        <label className="cb-pickerLabel" htmlFor="widgetPosition">
                          Position
                        </label>
                        <select
                          id="widgetPosition"
                          className="cb-pickerSelect"
                          value={widgetPosition}
                          onChange={(event) => setWidgetPosition(event.target.value as WidgetPosition)}
                        >
                          {POSITION_OPTIONS.map((position) => (
                            <option key={position} value={position}>
                              {POSITION_LABELS[position]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
              </div>
            </article>
          )}

          {showArcadeCard && (
            <article
              ref={arcadeCardRef}
              className="sx-panel cb-featureCard cb-arcadeCard"
              aria-label="404 Arcade"
            >
              <header className="sx-panelHead">
                <div>
                  <p className="sx-footK">Arcade</p>
                  <h2 className="sx-h2">404 Arcade</h2>
                  <p className="sx-sub">Serve an interactive CavBot recovery experience on your 404 route.</p>
                </div>
                <span className="cb-statusDotWrapper">
                  <span
                    className={`cb-statusDot ${arcadeDetected ? "is-ready" : "is-locked"}`}
                    aria-hidden="true"
                  />
                  <span className="cb-statusText cb-sr-only">
                    {arcadeDetected ? "Live traffic detected" : "Waiting for 404 traffic"}
                  </span>
                </span>
              </header>
              <div className="sx-body cb-arcadeBody">
                {arcadeSaving ? (
                  <p className="sx-status-sub cb-arcadeSaving">Saving changes…</p>
                ) : null}
                {arcadeError ? (
                  <p className="sx-status-sub cb-arcadeError">{arcadeError}</p>
                ) : null}
                <div className="cb-arcadePicker">
                  {arcadeGames.length ? (
                    <>
                      <div className="cb-arcadePickerGrid" ref={arcadePickerGridRef} onScroll={handleArcadeScroll}>
                        {arcadeGames.map((game) => {
                          const entryKey = `${game.slug}-${game.version}`;
                          const isGameSelected = persistedArcadeKey === entryKey;
                          const lockInfo = arcadeLockMap[game.slug];
                          const isLockedGame = lockInfo?.locked ?? false;
                          const lockLabel = lockInfo?.unlockTier;
                          return (
                            <button
                              key={entryKey}
                              type="button"
                              ref={(el) => {
                                arcadeGameRefs.current[entryKey] = el;
                              }}
                              className={`cb-arcadeGame ${isGameSelected ? "is-selected" : ""} ${
                                isLockedGame ? "is-locked" : ""
                              }`}
                              onClick={() => selectArcadeGame(game)}
                              aria-label={`${game.displayName} version ${game.version}`}
                              aria-disabled={isLockedGame ? "true" : undefined}
                            >
                              <div className="cb-arcadeGameTablet">
                                <div className="cb-arcadeDevice">
                                  <div className="cb-arcadeDeviceTop">
                                    <span className="cb-arcadeDeviceCamera" aria-hidden="true" />
                                    <span className="cb-arcadeDeviceSensor" aria-hidden="true" />
                                  </div>
                                  <div className="cb-arcadeGameThumb">
                                    <Image
                                      src={game.thumbnailUrl}
                                      alt={game.displayName}
                                      width={160}
                                      height={90}
                                      priority={false}
                                      className="cb-arcadeGameImage"
                                    />
                                    <span className="cb-arcadeGameHighlight" aria-hidden="true" />
                                    {isLockedGame ? (
                                      <div className="cb-arcadeGameLock" aria-hidden="true">
                                        <LockIcon width={20} height={20} />
                                        {lockLabel ? (
                                          <span className="sx-status-sub cb-arcadeGameLockLabel">
                                            {lockLabel}
                                          </span>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="cb-arcadeDeviceBottom" aria-hidden="true">
                                    <span className="cb-arcadeDeviceHome" />
                                  </div>
                                </div>
                              </div>
                                <span className="cb-sr-only">
                                  {game.displayName} · {game.version}{" "}
                                  {isGameSelected ? "selected" : ""}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      <div className="cb-arcadeDots" role="tablist" aria-label="Arcade carousel navigation">
                        {arcadeGames.map((game) => {
                          const entryKey = `${game.slug}-${game.version}`;
                          const isGameSelected = persistedArcadeKey === entryKey;
                          const isActive = visibleArcadeKey === entryKey;
                          return (
                            <button
                              key={`dot-${entryKey}`}
                              type="button"
                              className={`cb-arcadeDot ${isActive ? "is-active" : ""} ${
                                isGameSelected ? "is-selected" : ""
                              }`}
                              onClick={() => handleArcadeDotClick(game)}
                              aria-label={`${game.displayName} version ${game.version}`}
                              aria-current={isActive ? "true" : "false"}
                            />
                          );
                        })}
                      </div>
                    </>
                  ) : !arcadeLoading ? (
                    <p className="sx-status-sub cb-arcadeLoading">
                      Arcade catalog is unavailable for this workspace.
                    </p>
                  ) : null}
                </div>
                <div className="cb-arcadeOptions">
                  <div className="cb-arcadeOptionField">
                    <label className="cb-arcadeOptionLabel" htmlFor="arcade-difficulty">
                      Difficulty
                    </label>
                    <select
                      id="arcade-difficulty"
                      className="cb-pickerSelect"
                      value={arcadeDraft.options.difficulty}
                      onChange={(event) =>
                        updateArcadeOptions({
                          difficulty: event.target.value as SiteArcadeOptions["difficulty"],
                        })
                      }
                    >
                      {ARCADE_DIFFICULTIES.map((option) => (
                        <option key={option} value={option}>
                          {option.charAt(0).toUpperCase() + option.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="cb-arcadeOptionField">
                    <label className="cb-arcadeOptionLabel" htmlFor="arcade-redirect">
                      Redirect URL
                    </label>
                    <input
                      id="arcade-redirect"
                      type="url"
                      className="cb-arcadeOptionInput"
                      placeholder="https://example.com/recover"
                      value={arcadeDraft.options.redirectUrl}
                      onChange={(event) => updateArcadeOptions({ redirectUrl: event.target.value })}
                    />
                  </div>
                  <div className="cb-arcadeOptionField">
                    <label className="cb-arcadeOptionLabel" htmlFor="arcade-email">
                      Support email
                    </label>
                    <input
                      id="arcade-email"
                      type="email"
                      className="cb-arcadeOptionInput"
                      placeholder="support@example.com"
                      value={arcadeDraft.options.supportEmail}
                      onChange={(event) => updateArcadeOptions({ supportEmail: event.target.value })}
                    />
                  </div>
                </div>
              </div>
            </article>
          )}

          {showAnalyticsCard && (
          <article ref={analyticsCardRef} className="sx-panel cb-featureCard">
            <header className="sx-panelHead">
              <div>
                <p className="sx-footK">Analytics &amp; Brain</p>
                <h2 className="sx-h2" style={{ fontFamily: "Inter, var(--sx-font-main)" }}>CavAi</h2>
                <p className="sx-sub">
                  Deterministic intelligence keeping CavBot modules aware.
                </p>
              </div>
              <span className="cb-statusDotWrapper">
                <span
                  className={`cb-statusDot ${ready ? "is-ready" : "is-locked"}`}
                  aria-hidden="true"
                />
                <span className="cb-statusText cb-sr-only">
                  {ready ? "Ready" : "Select a site and key to unlock"}
                </span>
              </span>
            </header>
              <div className="sx-body cb-analyticsBody">
                <div className="cb-analyticsBlob">
                  <p className="cb-analyticsTitle">Brain</p>
                  <p>
                    CavAi intelligence translates visitor behavior into deterministic signals that keep CavBot’s
                    modules synchronized across every surface you touch. Once the install is complete, the loader keeps
                    each experience intentionally aware.
                  </p>
                </div>
                <div className="cb-analyticsBlob">
                  <p className="cb-analyticsTitle">Analytics</p>
                  <p>
                    Analytics delivers privacy-safe telemetry so you can monitor CavBot performance with certainty.
                    Drop the snippet once and the insights stay live as you scale—no extra steps required.
                  </p>
                </div>
                <div className="cb-analyticsFooter">
                  <Link href="/settings?tab=api" className="sx-api-link cb-analyticsApiLink">
                    API &amp; Keys
                  </Link>
                </div>
              </div>
            </article>
          )}
        </div>

        <section className="sx-panel cb-installPanel" aria-label="Installation scripts">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Installation</h2>
              <p className="sx-sub">Copy the script tailored to the experience you want to launch.</p>
            </div>
          </header>
          <div className="sx-body">
            {showWidgetInstall && (
            <div className="cb-scriptSection">
              <div className="cb-scriptHeader">
                <div>
                  <div className="sx-footK">Widget script</div>
                  <p className="sx-status-sub">Paste this snippet wherever you want CavBot to appear.</p>
                </div>
                <span className="sx-status-chip">{statusHint}</span>
              </div>
              <div className="cb-connectRow">
                <div className="cb-connectText">
                  {isConnected && lastSeenLabel ? (
                    <p className="cb-connectHint">
                      Install detected · Last seen {lastSeenLabel}
                    </p>
                  ) : null}
                  {installError ? (
                    <p className="cb-connectHint cb-connectHint--muted">{installError}</p>
                  ) : null}
                  {!featureAllowed && selectedGate.reasonBody ? (
                    <p className="cb-connectHint cb-connectHint--muted cb-connectHint--gate">
                      {selectedGate.reasonBody}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`cb-connectBtn ${buttonStateClass}`}
                  disabled
                >
                  {!featureAllowed && (
                    <LockIcon className="cb-connectLockIcon" width={14} height={14} />
                  )}
                  <span>{buttonLabel}</span>
                </button>
              </div>
              <SnippetBlock
                id="widget-script"
                title="Widget snippet"
                description="Widget loader configured with the picker above."
                snippet={widgetSnippet}
                ready={ready}
                lockMessage={SCRIPT_LOCK_MESSAGE}
                gateBadge={gateBadge}
                gateTitle={!featureAllowed ? selectedGate.reasonTitle : undefined}
                gateMessage={!featureAllowed ? selectedGate.reasonBody : undefined}
                copyLocked={!featureAllowed}
                onCopy={handleSnippetCopy}
                copiedId={copiedId}
              />
              </div>
            )}
            {showAnalyticsInstall && (
              <>
                <div className="cb-scriptSection">
                  <div className="cb-scriptHeader">
                    <div>
                      <div className="sx-footK">Analytics &amp; Brain snippets</div>
                      <p className="sx-status-sub">
                        Reference snippets that wire CavBot analytics and CavAi brain into your site context.
                      </p>
                    </div>
                  </div>
                  <div className="sx-api-snippetGrid sx-api-snippetGrid--compact">
                    <SnippetBlock
                      id="analytics-script"
                      title="Publishable analytics embed"
                      description="Send telemetry to CavBot analytics."
                      snippet={analyticsSnippet}
                      ready={ready}
                      lockMessage="Select a site and key to unlock this snippet."
                      onCopy={handleSnippetCopy}
                      copiedId={copiedId}
                    />
                    <SnippetBlock
                      id="brain-script"
                      title="CavAi brain loader"
                      description="Boot CavBot intelligence after the page loads."
                      snippet={brainSnippet}
                      ready={ready}
                      lockMessage="Select a site and key to unlock this snippet."
                      onCopy={handleSnippetCopy}
                      copiedId={copiedId}
                    />
                  </div>
                </div>
                <div className="cb-scriptSection cb-arcadeScriptSection">
                  <div className="cb-scriptHeader">
                    <div>
                      <div className="sx-footK">Arcade loader</div>
                      <p className="sx-status-sub">
                        Copy and paste this loader on your 404 route to boot the selected experience.
                      </p>
                    </div>
                    <span className={`sx-status-chip ${arcadeDetected ? "is-ready" : "is-locked"}`}>
                      {arcadeDetected ? "Detected" : "Not detected"}
                    </span>
                  </div>
                  <SnippetBlock
                    id="arcade-script"
                    title="Arcade snippet"
                    description="Loader that powers CavBot’s 404 Arcade experience."
                    snippet={arcadeSnippet}
                    ready={ready}
                    lockMessage="Select an Arcade game to activate this snippet."
                    copyLocked={!arcadeDraft.enabled}
                    onCopy={handleSnippetCopy}
                    copiedId={copiedId}
                  />
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
                                : "Not selected"}
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
                            <span className="cb-arcadeDetectionValue">{arcadeOriginLabel}</span>
                          </p>
                        </div>
                      </div>
                      <ArcadePreview
                        thumbnailUrl={selectedArcadeThumbnailUrl}
                        alt={selectedArcadeGame?.displayName ?? "Selected game preview"}
                        placeholderText="Select a game to preview"
                      />
                    </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="sx-panel cb-advancedPanel" aria-label="CavCode advanced path">
          <header className="sx-panelHead">
            <div>
              <h2 className="sx-h2">Need deeper control?</h2>
              <p className="sx-sub">Inspect markup, troubleshoot, or customize behavior in CavCode.</p>
            </div>
            <Link href="/cavcode" className="sx-btn cb-advancedBtn">
              Open CavCode
            </Link>
          </header>
          <div className="sx-body">
            <p className="sx-status-sub">
              Advanced CavCode tooling sits beside this installer whenever you need it; it does not gate the main
              flow.
            </p>
          </div>
        </section>

        <div className="cb-returnRow">
          <Link
            href="/settings/integrations"
            className="cb-returnBtn"
            aria-label="Connections"
          >
            Connections
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
