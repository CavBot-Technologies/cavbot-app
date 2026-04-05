// app/page.tsx
"use client";


import AppShell from "@/components/AppShell";
import CavAiRouteRecommendations from "@/components/CavAiRouteRecommendations";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import CavBotLoadingScreen from "@/components/CavBotLoadingScreen";
import "@/components/CavBotLoadingScreen.css";
import { PLANS, resolvePlanIdFromTier, getPlanLimits, type PlanId } from "@/lib/plans";
import DashboardToolsModal from "@/components/DashboardToolsModal";
import ScannerControlCard from "@/components/ScannerControlCard";
import { LinkedInSquareIcon } from "@/components/icons/LinkedInSquareIcon";


/*  NEW (SWR sync across app) */
import { mutate } from "swr";
import { useWorkspaceSites } from "@/lib/hooks/useWorkspaceSites";


/**
 * ============================================================
 * CAVBOT COMMAND CENTER — POSTGRES SOURCE OF TRUTH (OFFICIAL)
 * ============================================================
 */


/* ==========================
  AUTH (WELCOME PAGE GATE)
========================== */


const AUTH_SESSION_ENDPOINT = "/api/auth/session"; // implement later
const AUTH_LOGIN_PATH = "/auth"; // your future auth page route
const CB_AUTH_REQUIRED_EVENT = "cb:auth:required";


type AuthSession = Record<string, unknown> | null;

type AuthState =
  | { status: "checking"; session: AuthSession }
  | { status: "authed"; session: AuthSession }
  | { status: "guest"; session: AuthSession };


type Project = {
  id: number;
  name: string | null;
  slug: string;
  region: string;
  retentionDays: number;
  topSiteId: string | null;
  createdAt: string | Date;
};


type Site = {
  id: string;
  label: string;
  origin: string; // normalized origin (https://domain.tld)
  createdAt: string | Date | number;
  top?: boolean;
  notes?: string;
};


type RemovedSite = {
  siteId: string;
  origin: string;
  removedAt: string;
  purgeAt: string;
};

type Guardrails = {
  blockUnknownOrigins: boolean;
  enforceAllowlist: boolean;
  alertOn404Spike: boolean;
  alertOnJsSpike: boolean;
  strictDeletion: boolean;
};


type Notice = {
  id: string;
  tone: "good" | "watch" | "bad";
  title: string;
  body: string;
  ts: number;
  source?: "local" | "server";
};

type RangeKey = "24h" | "7d" | "14d" | "30d";
type DeleteMode = "SAFE" | "DESTRUCTIVE";


const DELETE_MODAL_PLACEHOLDER: Site = {
  id: "__delete-modal-placeholder",
  label: "CavBot",
  origin: "",
  createdAt: "",
};


const GREETINGS = [
  "Hello",
  "Bonjour",
  "Alo",
  "Hola",
  "Ciao",
  "Olá",
  "Salam",
  "Привет",
  "नमस्ते",
  "こんにちは",
  "안녕하세요",
  "你好",
  "Hej",
  "Γεια σου",
];

const MIN_LOADING_LANGUAGES = 5;
const GREETING_INTERVAL_MS = 800;
const MIN_LOADING_DURATION_MS = MIN_LOADING_LANGUAGES * GREETING_INTERVAL_MS;
const HARD_RELOAD_PARAM = "__hard";
const HARD_RELOAD_TS_PARAM = "__ts";

const LS_CAVCLOUD_STORAGE_HISTORY = "cb_cavcloud_storage_history_v1";
const PLAN_CONTEXT_KEY = "cb_plan_context_v1";

type StoragePoint = {
  ts: number;
  usedBytes: number;
};

type CavCloudCounts = {
  folders: number;
  files: number;
  images: number;
  videos: number;
  other: number;
};

const EMPTY_CAVCLOUD_COUNTS: CavCloudCounts = {
  folders: 0,
  files: 0,
  images: 0,
  videos: 0,
  other: 0,
};

function safeJsonParse<T>(input: string | null): T | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(val >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function slugifyForTools(value: string) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 63) || "site"
  );
}

function storageLimitBytes(planId: PlanId, trialActive: boolean) {
  if (trialActive) return Number.POSITIVE_INFINITY;
  const plan = PLANS[planId];
  const lim = plan?.limits?.storageGb;
  if (!lim || lim === "unlimited") return Number.POSITIVE_INFINITY;
  return Number(lim) * 1024 * 1024 * 1024;
}


function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}


function clampStr(s: string, n = 64) {
  const x = (s || "").trim();
  return x.length > n ? x.slice(0, n) : x;
}


/** Normalize user input into a strict origin (https://example.com) */
function normalizeOrigin(input: string): string {
  const raw = (input || "").trim();
  if (!raw) throw new Error("Enter a domain or origin.");


  const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;


  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    throw new Error("That doesn’t look like a valid domain/origin.");
  }


  if (!u.hostname || u.hostname.includes("..")) {
    throw new Error("That domain/origin is invalid.");
  }


  return u.origin;
}


function originToLabel(origin: string) {
  try {
    const u = new URL(origin);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}


function safeNumDate(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" || v instanceof Date) {
    const d = new Date(v);
    const t = d.getTime();
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}



function fmtTime(ts: number) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function daysUntil(dateTime: string) {
  const when = Date.parse(dateTime);
  if (!Number.isFinite(when)) return null;
  const diff = Math.max(0, when - Date.now());
  const dayCount = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return Number.isFinite(dayCount) ? dayCount : null;
}


/* ==========================
  CLIENT-ONLY PREF KEYS
========================== */


function storageKeyActiveProjectId() {
  return `cb_active_project_id`;
}


function storageKeyActiveSiteId(projectId: number) {
  return `cb_active_site_id__${projectId}`;
}


function storageKeyTopSiteOrigin(projectId: number) {
  return `cb_top_site_origin__${projectId}`;
}


function storageKeyActiveSiteOrigin(projectId: number) {
  return `cb_active_site_origin__${projectId}`;
}


function storageKeyWorkspaceVersion(projectId: number) {
  return `cb_workspace_v__${projectId}`;
}


const CB_WORKSPACE_EVENT = "cb:workspace";
const CB_SELECTION_EVENT = "cb:selection";


function bumpWorkspaceVersion(projectId: number) {
  try {
    globalThis.__cbLocalStore.setItem(storageKeyWorkspaceVersion(projectId), String(Date.now()));
  } catch {}
}


function publishWorkspaceSignal(input: {
  projectId: number;
  reason: "boot" | "refresh" | "topSite" | "siteAdded" | "siteRemoved" | "guardrails";
  topSiteId: string;
  topOrigin: string;
  activeSiteId: string;
  activeOrigin: string;
}) {
  const { projectId, reason, topSiteId, topOrigin, activeSiteId, activeOrigin } = input;


  // ===== LOOP KILLER =====
  try {
    const prevPid = (globalThis.__cbLocalStore.getItem(storageKeyActiveProjectId()) || "").trim();
    const prevTopOrigin = (globalThis.__cbLocalStore.getItem(storageKeyTopSiteOrigin(projectId)) || "").trim();
    const prevActiveOrigin = (globalThis.__cbLocalStore.getItem(storageKeyActiveSiteOrigin(projectId)) || "").trim();
    const prevActiveSiteId = (globalThis.__cbLocalStore.getItem(storageKeyActiveSiteId(projectId)) || "").trim();


    const sameContext =
      prevPid === String(projectId) &&
      prevTopOrigin === (topOrigin || "").trim() &&
      prevActiveOrigin === (activeOrigin || "").trim() &&
      prevActiveSiteId === (activeSiteId || "").trim();


    if (sameContext && (reason === "boot" || reason === "refresh")) {
      return;
    }
  } catch {}
  // =======================


  try {
    globalThis.__cbLocalStore.setItem(storageKeyActiveProjectId(), String(projectId));
  } catch {}


  try {
    if (topOrigin) globalThis.__cbLocalStore.setItem(storageKeyTopSiteOrigin(projectId), topOrigin);
    if (activeOrigin) globalThis.__cbLocalStore.setItem(storageKeyActiveSiteOrigin(projectId), activeOrigin);
    if (activeSiteId) globalThis.__cbLocalStore.setItem(storageKeyActiveSiteId(projectId), activeSiteId);
  } catch {}


  bumpWorkspaceVersion(projectId);


  try {
    window.dispatchEvent(
      new CustomEvent(CB_WORKSPACE_EVENT, {
        detail: { projectId, reason, ts: Date.now(), topSiteId, topOrigin, activeSiteId, activeOrigin },
      })
    );
  } catch {}


  try {
    window.dispatchEvent(
      new CustomEvent(CB_SELECTION_EVENT, {
        detail: {
          projectId,
          siteOrigin: activeOrigin || topOrigin,
          siteId: activeSiteId || topSiteId,
          ts: Date.now(),
          reason,
        },
      })
    );
  } catch {}
}


/* ==========================
  DEFAULTS
========================== */


const DEFAULT_GUARDRAILS: Guardrails = {
  blockUnknownOrigins: true,
  enforceAllowlist: true,
  alertOn404Spike: true,
  alertOnJsSpike: true,
  strictDeletion: true,
};


const GUARDRAIL_KEYS = ["blockUnknownOrigins", "enforceAllowlist", "alertOn404Spike", "alertOnJsSpike", "strictDeletion"] as const;
type GuardrailKey = (typeof GUARDRAIL_KEYS)[number];
type GuardrailsPayload = Partial<Record<GuardrailKey, boolean>>;


function sanitizeGuardrails(input: GuardrailsPayload | null | undefined): Guardrails {
  const base = { ...DEFAULT_GUARDRAILS };
  const out: GuardrailsPayload = { ...base };


  for (const k of GUARDRAIL_KEYS) {
    if (typeof input?.[k] === "boolean") out[k] = input[k];
  }
  return out as Guardrails;
}


/* ==========================
  API HELPERS
========================== */


async function apiJSON<T>(url: string, init?: RequestInit): Promise<T> {
  if (!url || typeof url !== "string") {
    throw new Error(`apiJSON called with invalid url: ${String(url)}`);
  }
  const shouldRetryStatus = (status: number) =>
    status === 408 || status === 425 || status === 429 || status >= 500;
  let lastFetchError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        ...init,
        headers: {
          ...(init?.headers || {}),
          accept: "application/json",
          ...(init?.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
      lastFetchError = new Error(`FETCH_FAILED for ${url}: ${message}`);
      if (attempt === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
        continue;
      }
      throw lastFetchError;
    }

    const ct = res.headers.get("content-type") || "";
    const isJSON = ct.includes("application/json");
    const data: unknown = isJSON ? await res.json().catch(() => null) : null;

    if (!res.ok) {
      if (attempt === 0 && shouldRetryStatus(res.status)) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        try {
          window.dispatchEvent(
            new CustomEvent(CB_AUTH_REQUIRED_EVENT, {
              detail: { url, status: res.status, ts: Date.now() },
            })
          );
        } catch {}
      }

      const detail = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
      const msg =
        (detail && (String(detail.error || detail.message))) || `Request failed (${res.status})`;
      throw new Error(msg);
    }

    if (!isJSON) {
      throw new Error(`Expected JSON from ${url} but got: ${ct || "unknown"}`);
    }

    return data as T;
  }
  throw lastFetchError || new Error(`REQUEST_RETRY_EXHAUSTED for ${url}`);
}


async function persistActiveProjectCookie(projectId: number) {
  if (!Number.isFinite(projectId) || projectId <= 0) return;


  try {
    await fetch("/api/workspaces/select-project", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
  } catch {}
}


export default function CommandDeckPage() {
  return <CommandDeckPageInner />;
}

function CommandDeckPageInner() {
  const pathname = usePathname();
  const router = useRouter();


  // AUTH gate (this page is the logged-in welcome page)
  const [auth, setAuth] = useState<AuthState>({ status: "checking", session: null });
  const [minLoadingTimeElapsed, setMinLoadingTimeElapsed] = useState(false);
  const [hardReloadActive, setHardReloadActive] = useState(false);

  useEffect(() => {
    setMinLoadingTimeElapsed(false);
    const timer = window.setTimeout(() => setMinLoadingTimeElapsed(true), MIN_LOADING_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHardReload = new URLSearchParams(window.location.search).get(HARD_RELOAD_PARAM) === "1";
    setHardReloadActive(nextHardReload);
  }, [pathname]);

  useEffect(() => {
    if (!hardReloadActive) return;
    if (auth.status === "checking" || !minLoadingTimeElapsed) return;
    if (typeof window === "undefined") return;

    try {
      const url = new URL(window.location.href);
      let mutated = false;
      if (url.searchParams.has(HARD_RELOAD_PARAM)) {
        url.searchParams.delete(HARD_RELOAD_PARAM);
        mutated = true;
      }
      if (url.searchParams.has(HARD_RELOAD_TS_PARAM)) {
        url.searchParams.delete(HARD_RELOAD_TS_PARAM);
        mutated = true;
      }
      if (mutated) {
        window.history.replaceState({}, "", url.toString());
      }
    } catch {
      // ignore
    }

    setHardReloadActive(false);
  }, [hardReloadActive, auth.status, minLoadingTimeElapsed]);


  // Workspaces (DB: Projects)
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);


  // NEW: SWR key for sites cache (so every page updates instantly)
  const { key: sitesKey } = useWorkspaceSites(activeProjectId);


  // Websites (DB: Sites)
  const [sites, setSites] = useState<Site[]>([]);
  const [topSiteId, setTopSiteId] = useState<string>(""); // DB: Project.topSiteId
  const [activeSiteId, setActiveSiteId] = useState<string>(""); // UI preference
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolsSiteId, setToolsSiteId] = useState<string>(activeSiteId || "");
  const closeToolsModal = useCallback(() => setToolsOpen(false), []);


  // Guardrails (DB) — backend wired, UI hidden
  const [guardrails, setGuardrails] = useState<Guardrails>(DEFAULT_GUARDRAILS);
  const [workspacePlanLabel, setWorkspacePlanLabel] = useState<string>("FREE");
  const [planId, setPlanId] = useState<PlanId>("free");
  const [trialActive, setTrialActive] = useState<boolean>(false);
  const [usedBytes, setUsedBytes] = useState<number>(0);
  const [cavcloudCounts, setCavcloudCounts] = useState<CavCloudCounts>(EMPTY_CAVCLOUD_COUNTS);
  const [cavcloudLimitBytes, setCavcloudLimitBytes] = useState<number | null>(null);
  const [cavcloudLimitLoaded, setCavcloudLimitLoaded] = useState<boolean>(false);

  useEffect(() => {
    type PlanDetail = { planLabel?: string; planKey?: PlanId; trialActive?: boolean };

    function applyPlan(detail: PlanDetail | null) {
      if (!detail) return;
      if (typeof detail.planLabel === "string") setWorkspacePlanLabel(detail.planLabel);
      if (typeof detail.planKey === "string") setPlanId(detail.planKey as PlanId);
      if (typeof detail.trialActive !== "undefined") setTrialActive(Boolean(detail.trialActive));
    }

    try {
      const stored = safeJsonParse<PlanDetail | null>(globalThis.__cbLocalStore.getItem(PLAN_CONTEXT_KEY));
      applyPlan(stored);
    } catch {}

    type PlanEvent = CustomEvent<PlanDetail>;
    const handler = (ev: PlanEvent) => {
      applyPlan(ev.detail);
    };
    window.addEventListener("cb:plan", handler as EventListener);
    return () => window.removeEventListener("cb:plan", handler as EventListener);
  }, []);

  useEffect(() => {
    if (auth.status !== "authed") {
      setUsedBytes(0);
      setCavcloudCounts(EMPTY_CAVCLOUD_COUNTS);
      setCavcloudLimitBytes(null);
      setCavcloudLimitLoaded(false);
      return;
    }

    let alive = true;
    let requestSeq = 0;

    type SummaryResponse = {
      ok?: boolean;
      summary?: {
        usedBytes?: unknown;
        limitBytes?: unknown;
        folders?: unknown;
        files?: unknown;
        images?: unknown;
        videos?: unknown;
        other?: unknown;
      };
    };

    function toInt(value: unknown) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.trunc(n);
    }

    const applyStorageCacheFallback = () => {
      try {
        const history = safeJsonParse<StoragePoint[]>(globalThis.__cbLocalStore.getItem(LS_CAVCLOUD_STORAGE_HISTORY));
        if (!Array.isArray(history) || history.length === 0) return;
        const point = history.find((p) => typeof p?.usedBytes === "number") || history[0];
        if (!point || !Number.isFinite(point.usedBytes)) return;
        setUsedBytes(Math.max(0, Math.trunc(point.usedBytes)));
      } catch {}
    };

    const loadSummary = async (allowLocalCacheFallback: boolean) => {
      const seq = ++requestSeq;
      try {
        const res = await fetch("/api/cavcloud/summary", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => null)) as SummaryResponse | null;
        if (!alive || seq !== requestSeq) return;
        if (!res.ok || !payload?.ok || !payload.summary) throw new Error("SUMMARY_UNAVAILABLE");

        const nextLimitRaw = payload.summary.limitBytes;
        if (nextLimitRaw == null || nextLimitRaw === "") {
          setCavcloudLimitBytes(null);
          setCavcloudLimitLoaded(true);
        } else {
          const nextLimit = Number(nextLimitRaw);
          if (Number.isFinite(nextLimit) && nextLimit > 0) {
            setCavcloudLimitBytes(Math.trunc(nextLimit));
            setCavcloudLimitLoaded(true);
          }
        }

        setUsedBytes(toInt(payload.summary.usedBytes));
        setCavcloudCounts({
          folders: toInt(payload.summary.folders),
          files: toInt(payload.summary.files),
          images: toInt(payload.summary.images),
          videos: toInt(payload.summary.videos),
          other: toInt(payload.summary.other),
        });
      } catch {
        if (!alive || !allowLocalCacheFallback) return;
        applyStorageCacheFallback();
      }
    };

    void loadSummary(true);

    const refresh = () => {
      void loadSummary(false);
    };

    const timer = window.setInterval(refresh, 45_000);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === LS_CAVCLOUD_STORAGE_HISTORY) refresh();
    };
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [auth.status]);


  // Notices (local now)
  const [localNotices, setLocalNotices] = useState<Notice[]>([]);
  const [serverNotices, setServerNotices] = useState<Notice[]>([]);
  const [noticesError, setNoticesError] = useState<string | null>(null);


  // UI
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Site | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: "good" | "watch" | "bad" } | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [recentlyRemovedSites, setRecentlyRemovedSites] = useState<RemovedSite[]>([]);
  const [recentlyRemovedLoading, setRecentlyRemovedLoading] = useState(false);
  const [recentlyRemovedError, setRecentlyRemovedError] = useState<string | null>(null);
  const [restoringSiteId, setRestoringSiteId] = useState<string | null>(null);


  const toastTimer = useRef<number | null>(null);
  const mergedNotices = useMemo(
    () => [...serverNotices, ...localNotices],
    [serverNotices, localNotices]
  );
  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) || null, [projects, activeProjectId]);


  const activeSite = useMemo(() => sites.find((s) => s.id === activeSiteId) || null, [sites, activeSiteId]);


  function pushToast(msg: string, tone: "good" | "watch" | "bad" = "good") {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }


  // Welcome header (must never clear once known)
  const [welcomeName, setWelcomeName] = useState<string>("");
  const [cachedName, setCachedName] = useState<string>(""); // sticky fallback
  const [welcomeTone, setWelcomeTone] = useState<string>("lime");
  const welcomeAccentColor = useMemo(() => profileToneToAccentColor(welcomeTone), [welcomeTone]);


  function adoptName(next: string | null | undefined) {
    const n = String(next || "").trim();
    if (!n) return; // NEVER overwrite with blank


    setWelcomeName(n);
    setCachedName(n);


    try {
      globalThis.__cbLocalStore.setItem("cb_profile_fullName_v1", n);
    } catch {}
  }


  // Fast paint from globalThis.__cbLocalStore
  useEffect(() => {
    try {
      const n = (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim();
      const t = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim().toLowerCase();
      if (n) setCachedName(n);
      if (n) setWelcomeName((prev) => prev || n);
      if (t) setWelcomeTone(t);
    } catch {}
  }, []);


  // Live updates when Account page saves (cb:profile)
  useEffect(() => {
    function onProfile(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      try {
        const fullName = typeof event.detail?.fullName === "string" ? event.detail.fullName : null;
        const tone = typeof event.detail?.tone === "string"
          ? event.detail.tone
          : typeof event.detail?.avatarTone === "string"
            ? event.detail.avatarTone
            : null;
        adoptName(fullName);
        if (tone) setWelcomeTone(String(tone).trim().toLowerCase());
      } catch {}
    }
    window.addEventListener("cb:profile", onProfile);
    return () => window.removeEventListener("cb:profile", onProfile);
  }, []);


  // Fetch once when authed (but only adopt real names)
  useEffect(() => {
    if (auth.status !== "authed") return;


    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/settings/account", { method: "GET", cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as ProfileApiResponse;
        if (!alive) return;


        adoptName(j?.profile?.fullName ?? j?.data?.profile?.fullName);
      } catch {}
    })();


    return () => {
      alive = false;
    };
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== "authed") return;
    let alive = true;
    setNoticesError(null);

    (async () => {
      try {
        const response = await fetch("/api/settings/notices?limit=20", {
          cache: "no-store",
          credentials: "include",
        });
        const data = (await response.json().catch(() => null)) as
          | { ok?: boolean; notices?: Array<{ id: string; tone: Notice["tone"]; title: string; body: string; createdAt: string }>; error?: string }
          | null;

        if (!alive) return;
        if (!response.ok || !data?.ok || !Array.isArray(data.notices)) {
          setServerNotices([]);
          setNoticesError(null);
          return;
        }

        setServerNotices(
          data.notices.map((entry) => ({
            id: entry.id,
            tone: entry.tone,
            title: entry.title,
            body: entry.body,
            ts: new Date(entry.createdAt).getTime(),
            source: "server",
          }))
        );
      } catch {
        if (!alive) return;
        setNoticesError(null);
        setServerNotices([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [auth.status]);


  /* ==========================
    AUTH BOOTSTRAP
  ========================== */


  useEffect(() => {
    let alive = true;


    (async () => {
      try {
        const res = await fetch(AUTH_SESSION_ENDPOINT, { method: "GET", credentials: "include", cache: "no-store" });
        const data = await res.json().catch(() => null);


        if (!alive) return;


        // If auth endpoint is not wired yet, fail open (so dev is not blocked).
        if (res.status === 404) {
          setAuth({ status: "authed", session: null });
          return;
        }


        if (res.ok) {
          if ((data as { authed?: unknown } | null)?.authed === true) {
            setAuth({ status: "authed", session: data });
            return;
          }

          setAuth({ status: "guest", session: null });
          const next = encodeURIComponent(pathname || "/");
          router.replace(`${AUTH_LOGIN_PATH}?next=${next}`);
          return;
        }


        if (res.status === 401 || res.status === 403) {
          setAuth({ status: "guest", session: null });
          const next = encodeURIComponent(pathname || "/");
          router.replace(`${AUTH_LOGIN_PATH}?next=${next}`);
          return;
        }


        setAuth({ status: "guest", session: null });
        const next = encodeURIComponent(pathname || "/");
        router.replace(`${AUTH_LOGIN_PATH}?next=${next}`);
      } catch {
        if (!alive) return;
        setAuth({ status: "guest", session: null });
      }
    })();


    return () => {
      alive = false;
    };
  }, [router, pathname]);


  // Global redirect if any API call returns 401/403
  useEffect(() => {
    const onAuthRequired = () => {
      try {
        const next = encodeURIComponent(pathname || "/");
        router.replace(`${AUTH_LOGIN_PATH}?next=${next}`);
      } catch {}
    };
    window.addEventListener(CB_AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(CB_AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [router, pathname]);


  /* ==========================
    Modal body lock
  ========================== */
  useEffect(() => {
    const open = addOpen || deleteOpen || toolsOpen || manageOpen;
    const body = document.body;
    const html = document.documentElement;

    body.classList.toggle("cb-modal-open", open);
    body.classList.toggle("cb-home-delete-open", deleteOpen);

    if (open) {
      body.style.overflow = "hidden";
      html.style.overflow = "hidden";
    } else {
      body.style.removeProperty("overflow");
      html.style.removeProperty("overflow");
    }

    return () => {
      body.classList.remove("cb-modal-open", "cb-home-delete-open", "cb-modals-lock");
      body.style.removeProperty("overflow");
      html.style.removeProperty("overflow");
    };
  }, [addOpen, deleteOpen, toolsOpen, manageOpen]);


  useEffect(() => {
    const reset = () => {
      const html = document.documentElement;
      const body = document.body;


      html.style.removeProperty("overflow");
      html.style.removeProperty("position");
      html.style.removeProperty("transform");


      body.style.removeProperty("overflow");
      body.style.removeProperty("position");
      body.style.removeProperty("top");
      body.style.removeProperty("width");
      body.style.removeProperty("transform");


      body.classList.remove("cb-console-lock", "cb-modal-open", "cb-home-delete-open", "cb-modals-lock");
    };


    reset();


    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };


    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);


  /* ==========================
    DB LOADERS (SOURCE OF TRUTH)
  ========================== */


  async function loadProjects() {
    const data = await apiJSON<{ projects: Project[] }>("/api/workspaces", {
      method: "GET",
    });


    const list = Array.isArray(data.projects) ? data.projects : [];
    setProjects(list);


    let next: number | null = null;
    try {
      const stored = Number((globalThis.__cbLocalStore.getItem(storageKeyActiveProjectId()) || "").trim());
      if (Number.isFinite(stored) && list.some((p) => p.id === stored)) next = stored;
    } catch {}


    if (!next) next = list[0]?.id ?? null;


    setActiveProjectId(next);


    if (next) void persistActiveProjectCookie(next);


    return { list, next };
  }


  async function loadSitesForProject(
    projectId: number,
    reason: "boot" | "refresh" | "topSite" | "siteAdded" | "siteRemoved" = "refresh"
  ) {
    const data = await apiJSON<{
      topSiteId: string | null;
      sites: Array<{ id: string; label: string; origin: string; createdAt: string | number }>;
    }>(`/api/workspaces/${projectId}/sites`, { method: "GET" });


    const rawSites = Array.isArray(data.sites) ? data.sites : [];
    const topId = (data.topSiteId || "").trim();


    const normalized: Site[] = rawSites
      .map((s) => {
        let origin = (s.origin || "").trim();
        try {
          origin = normalizeOrigin(origin);
        } catch {}


        return {
          id: String(s.id || ""),
          label: clampStr(String(s.label || originToLabel(origin)), 15),
          origin,
          createdAt: safeNumDate(s.createdAt),
        };
      })
      .filter((s) => !!s.id && !!s.origin);


    const firstId = normalized[0]?.id || "";
    const nextTop = topId && normalized.some((x) => x.id === topId) ? topId : firstId;


    // Restore last active site per-project if possible, otherwise use nextTop
    let storedActive = "";
    try {
      storedActive = (globalThis.__cbLocalStore.getItem(storageKeyActiveSiteId(projectId)) || "").trim();
    } catch {}


    const prevActiveFromState = activeSiteId;


    const nextActive =
      storedActive && normalized.some((x) => x.id === storedActive)
        ? storedActive
        : prevActiveFromState && normalized.some((x) => x.id === prevActiveFromState)
        ? prevActiveFromState
        : nextTop;


    const topSiteObj = normalized.find((x) => x.id === nextTop) || null;
    const activeSiteObj = normalized.find((x) => x.id === nextActive) || topSiteObj || null;


    const topOrigin = (topSiteObj?.origin || "").trim();
    const activeOrigin = (activeSiteObj?.origin || topOrigin || "").trim();


    setSites(normalized.map((s) => ({ ...s, top: !!nextTop && s.id === nextTop })));
    setTopSiteId(nextTop || "");
    setActiveSiteId(nextActive || "");


    publishWorkspaceSignal({
      projectId,
      reason,
      topSiteId: nextTop || "",
      topOrigin,
      activeSiteId: nextActive || "",
      activeOrigin,
    });
  }


  async function loadGuardrails(projectId: number) {
    const data = await apiJSON<{ guardrails?: GuardrailsPayload }>(`/api/workspaces/${projectId}/guardrails`, { method: "GET" });
    setGuardrails(sanitizeGuardrails(data?.guardrails));
  }


  async function refreshWorkspace(
    projectId: number,
    reason: "boot" | "refresh" | "topSite" | "siteAdded" | "siteRemoved" = "refresh"
  ) {
    await Promise.allSettled([loadSitesForProject(projectId, reason), loadGuardrails(projectId)]);
  }

  const loadRecentlyRemoved = useCallback(async () => {
    if (!activeProjectId) {
      setRecentlyRemovedSites([]);
      setRecentlyRemovedError(null);
      return;
    }

    setRecentlyRemovedLoading(true);
    setRecentlyRemovedError(null);

    try {
      const data = await apiJSON<{
        sites?: Array<{ siteId?: string; origin?: string; removedAt?: string; purgeAt?: string }>;
      }>(`/api/workspaces/${activeProjectId}/sites/removed`, { method: "GET" });

      const raw = Array.isArray(data?.sites) ? data.sites : [];
      const normalized: RemovedSite[] = [];

      for (const entry of raw) {
        const siteId = String(entry.siteId || "").trim();
        const origin = String(entry.origin || "").trim();
        const removedAt = String(entry.removedAt || "");
        const purgeAt = String(entry.purgeAt || "");
        if (!siteId || !origin || !purgeAt) continue;
        const purgeTs = Date.parse(purgeAt);
        if (!Number.isFinite(purgeTs)) continue;
        normalized.push({ siteId, origin, removedAt, purgeAt });
      }

      normalized.sort(
        (a, b) => Date.parse(a.purgeAt || "") - Date.parse(b.purgeAt || "") // safe because we already validated
      );

      setRecentlyRemovedSites(normalized);
    } catch (error) {
      setRecentlyRemovedError(error instanceof Error ? error.message : "Failed to load removed sites.");
      setRecentlyRemovedSites([]);
    } finally {
      setRecentlyRemovedLoading(false);
    }
  }, [activeProjectId]);


  /* ==========================
    INITIAL BOOTSTRAP
  ========================== */
  useEffect(() => {
    if (auth.status !== "authed") return;


    (async () => {
      try {
        const { next } = await loadProjects();
        if (next) {
          await refreshWorkspace(next, "boot");
        } else {
          setSites([]);
          setTopSiteId("");
          setActiveSiteId("");
          setGuardrails(DEFAULT_GUARDRAILS);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        pushToast(msg || "Failed to load workspaces.", "bad");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);


  // When activeProjectId changes, reload its sites+guardrails (DB truth)
  useEffect(() => {
    if (auth.status !== "authed") return;
    if (!activeProjectId) return;


    try {
      globalThis.__cbLocalStore.setItem(storageKeyActiveProjectId(), String(activeProjectId));
    } catch {}


    (async () => {
      try {
        await persistActiveProjectCookie(activeProjectId);
        await refreshWorkspace(activeProjectId, "refresh");
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        pushToast(msg || "Failed to load workspace.", "bad");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, auth.status]);


  /* ==========================
    USER ACTIONS
  ========================== */


  function onSelectSite(nextSiteId: string) {
    if (!activeProjectId) return;


    const s = sites.find((x) => x.id === nextSiteId) || null;
    if (!s) return;


    setActiveSiteId(nextSiteId);


    try {
      globalThis.__cbLocalStore.setItem(storageKeyActiveProjectId(), String(activeProjectId));
    } catch {}


    try {
      if (nextSiteId) globalThis.__cbLocalStore.setItem(storageKeyActiveSiteId(activeProjectId), nextSiteId);
      if (s.origin) globalThis.__cbLocalStore.setItem(storageKeyActiveSiteOrigin(activeProjectId), s.origin);
    } catch {}


    bumpWorkspaceVersion(activeProjectId);


    try {
      window.dispatchEvent(
        new CustomEvent(CB_SELECTION_EVENT, {
          detail: { projectId: activeProjectId, siteOrigin: s.origin, siteId: nextSiteId, ts: Date.now(), reason: "selection" },
        })
      );
    } catch {}


    pushToast("Site context updated.", "good");
  }

  useEffect(() => {
    if (!toolsOpen) return;
    setToolsSiteId(activeSiteId || sites[0]?.id || "");
  }, [toolsOpen, activeSiteId, sites]);

  useEffect(() => {
    if (!manageOpen) return;
    void loadRecentlyRemoved();
  }, [manageOpen, loadRecentlyRemoved]);


  async function setTopSite(nextSiteId: string) {
    if (!activeProjectId) return;


    const nextTopSite = sites.find((s) => s.id === nextSiteId) || null;
    const nextTopOrigin = (nextTopSite?.origin || "").trim();


    setTopSiteId(nextSiteId);
    setActiveSiteId(nextSiteId);
    setSites((prev) => prev.map((s) => ({ ...s, top: s.id === nextSiteId })));


    publishWorkspaceSignal({
      projectId: activeProjectId,
      reason: "topSite",
      topSiteId: nextSiteId,
      topOrigin: nextTopOrigin,
      activeSiteId: nextSiteId,
      activeOrigin: nextTopOrigin,
    });


    try {
      await apiJSON<{ ok: true; topSiteId: string }>(`/api/workspaces/${activeProjectId}/top-site`, {
        method: "PATCH",
        body: JSON.stringify({ topSiteId: nextSiteId }),
      });


      pushToast("Primary site updated.", "good");


      if (sitesKey) void mutate(sitesKey);


      await loadSitesForProject(activeProjectId, "topSite");


      if (sitesKey) void mutate(sitesKey);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      pushToast(msg || "Failed to set primary site.", "bad");
      try {
        await loadSitesForProject(activeProjectId, "refresh");
        if (sitesKey) void mutate(sitesKey);
      } catch {}
    }
  }


  function openDelete(site: Site) {
    setDeleteTarget(site);
    setDeleteOpen(true);
  }

  function detachFromModal(site: Site) {
    setManageOpen(false);
    openDelete(site);
  }


  function addNotice(n: Omit<Notice, "id" | "ts" | "source">) {
    const next: Notice = { id: uid("notice"), ts: Date.now(), source: "local", ...n };
    setLocalNotices((prev) => [next, ...prev].slice(0, 20));
  }


  async function removeSiteConfirmed(siteId: string, mode: DeleteMode) {
    if (!activeProjectId) return;


    const target = sites.find((s) => s.id === siteId) || null;


    setSites((prev) => {
      const next = prev.filter((s) => s.id !== siteId);


      const nextTopSite = next[0] || null;
      const nextTop = nextTopSite?.id || "";
      const nextActive = nextTop;


      const nextTopOrigin = (nextTopSite?.origin || "").trim();
      const nextActiveOrigin = nextTopOrigin;


      setTopSiteId(nextTop);
      setActiveSiteId(nextActive);


      publishWorkspaceSignal({
        projectId: activeProjectId,
        reason: "siteRemoved",
        topSiteId: nextTop,
        topOrigin: nextTopOrigin,
        activeSiteId: nextActive,
        activeOrigin: nextActiveOrigin,
      });


      return next.map((s) => ({ ...s, top: !!nextTop && s.id === nextTop }));
    });


    if (guardrails.strictDeletion && target) {
      try {
        const prefixA = `cb_site_analytics__${target.origin}__`;
        const prefixB = `cb_site_analytics__`;


        for (let i = globalThis.__cbLocalStore.length - 1; i >= 0; i--) {
          const k = globalThis.__cbLocalStore.key(i);
          if (!k) continue;


          if (k.startsWith(prefixA)) globalThis.__cbLocalStore.removeItem(k);
          if (k.startsWith(prefixB) && k.includes(`__${target.origin}__`)) globalThis.__cbLocalStore.removeItem(k);
        }
      } catch {}
    }


    addNotice({
      tone: "watch",
      title: "Website removed",
      body:
        target
          ? mode === "SAFE"
            ? `${target.origin} was removed from Workspace (analytics retained for 30 days).`
            : `${target.origin} was removed and analytics were permanently deleted.`
          : "A website was removed.",
    });

    pushToast(
      mode === "SAFE"
        ? "Monitoring stopped. Analytics retained for 30 days before purge."
        : "Site removed and analytics permanently deleted.",
      mode === "SAFE" ? "watch" : "bad"
    );


    try {
      await apiJSON<{ ok: true; topSiteId: string | null }>(
        `/api/workspaces/${activeProjectId}/sites/${encodeURIComponent(siteId)}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            mode: mode === "SAFE" ? "detach" : "purge_now",
            origin: target?.origin,
          }),
        }
      );


      if (sitesKey) void mutate(sitesKey);


      await loadSitesForProject(activeProjectId, "siteRemoved");


      if (sitesKey) void mutate(sitesKey);
    } catch (error) {
      if (error instanceof Error) {
        pushToast(error.message || "Failed to delete website.", "bad");
      } else {
        pushToast("Failed to delete website.", "bad");
      }
      try {
        await loadSitesForProject(activeProjectId, "refresh");
        if (sitesKey) void mutate(sitesKey);
      } catch {}
    }
  }

  async function restoreSite(siteId: string) {
    if (!activeProjectId) return;
    setRestoringSiteId(siteId);

    try {
      await apiJSON<{ ok: true }>(
        `/api/workspaces/${activeProjectId}/sites/${encodeURIComponent(siteId)}/restore`,
        { method: "POST" }
      );

      pushToast("Site restored. Monitoring resumed.", "good");

      if (sitesKey) void mutate(sitesKey);
      try {
        await loadSitesForProject(activeProjectId, "siteAdded");
      } catch {}
      if (sitesKey) void mutate(sitesKey);

      setRecentlyRemovedSites((prev) => prev.filter((entry) => entry.siteId !== siteId));
      void loadRecentlyRemoved();
    } catch (error) {
      if (error instanceof Error) {
        pushToast(error.message || "Failed to restore site.", "bad");
      } else {
        pushToast("Failed to restore site.", "bad");
      }
    } finally {
      setRestoringSiteId(null);
    }
  }


  async function onAddSiteRequested(payload: { origin: string; label: string; notes?: string }) {
    if (!activeProjectId) {
      pushToast("No workspace available. Create a workspace first.", "bad");
      return;
    }


    try {
    const data = await apiJSON<{
      site: { id: string; origin: string; label: string; createdAt: string | number };
    }>(`/api/workspaces/${activeProjectId}/sites`, {
      method: "POST",
      body: JSON.stringify(payload),
    });


      const s = data?.site;
      if (!s?.id) throw new Error("SERVER_ERROR");


      addNotice({
        tone: "good",
        title: "Website added",
        body: `${s.origin} is now under this workspace.`,
      });


      pushToast("Website added.", "good");


      if (sitesKey) void mutate(sitesKey);


      await loadSitesForProject(activeProjectId, "siteAdded");


      if (sitesKey) void mutate(sitesKey);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "";
      if (String(errMessage || "").includes("SITE_EXISTS")) {
        pushToast("That website already exists in this workspace.", "watch");
        return;
      }
      pushToast(errMessage || "Failed to add website.", "bad");
    }
  }


  const workspacePill = activeProject?.name?.trim() || activeProject?.slug || "No Workspace";
  const topSite = useMemo(() => sites.find((s) => s.id === topSiteId) || null, [sites, topSiteId]);


  const selectedOrigin = useMemo(() => {
    const o = (activeSite?.origin || topSite?.origin || "").trim();
    return o;
  }, [activeSite, topSite]);



  // Include project in module links (server can read it; cookie is the fallback)
  const projectQS = activeProjectId ? `project=${encodeURIComponent(String(activeProjectId))}` : "";
  const siteQS = selectedOrigin ? `site=${encodeURIComponent(selectedOrigin)}` : "";
  const joinQS = (a: string, b: string) => (a && b ? `${a}&${b}` : a || b);


  const errorsHref = `/errors${projectQS || siteQS ? `?${joinQS(projectQS, siteQS)}` : ""}`;
  const routesHref = `/routes${projectQS || siteQS ? `?${joinQS(projectQS, siteQS)}` : ""}`;
  const seoHref = `/seo${projectQS || siteQS ? `?${joinQS(projectQS, siteQS)}` : ""}`;
  const range: RangeKey = "24h";
  const reportQuery = new URLSearchParams();
  reportQuery.set("module", "dashboard");
  if (activeProjectId) reportQuery.set("projectId", String(activeProjectId));
  reportQuery.set("range", range);
  if (activeSite?.id) reportQuery.set("siteId", activeSite.id);
  if (selectedOrigin) reportQuery.set("origin", selectedOrigin);
  const reportHref = `/console/report${reportQuery.toString() ? `?${reportQuery.toString()}` : ""}`;
  const reportTargetSlug = slugifyForTools(activeSite?.label || activeSite?.id || "site");
  const reportFileName = `workspace-dashboard-${reportTargetSlug}-${range}.html`;
  const cavtoolsHref = `/cavtools${projectQS || siteQS ? `?${joinQS(projectQS, siteQS)}` : ""}`;
  // Command Center first paint must be stable; disable the hard-reload loading effect.
  const showLoadingScreen = false;

  useEffect(() => {
    if (showLoadingScreen) return;
    if (typeof window === "undefined") return;

    const html = document.documentElement;
    const body = document.body;

    html.style.removeProperty("overflow");
    html.style.removeProperty("overscroll-behavior");
    html.style.removeProperty("touch-action");
    html.style.removeProperty("position");
    html.style.removeProperty("transform");

    body.style.removeProperty("overflow");
    body.style.removeProperty("overscroll-behavior");
    body.style.removeProperty("touch-action");
    body.style.removeProperty("position");
    body.style.removeProperty("top");
    body.style.removeProperty("left");
    body.style.removeProperty("right");
    body.style.removeProperty("bottom");
    body.style.removeProperty("width");
    body.style.removeProperty("height");
    body.style.removeProperty("min-height");
    body.style.removeProperty("transform");
    body.classList.remove("cb-modal-open", "cb-home-delete-open", "cb-modals-lock", "cb-console-lock");
  }, [showLoadingScreen]);

  // AUTH UI STATES (keep it clean, no flashing)
  if (showLoadingScreen) {
    return (
      <CavBotLoadingScreen
        title="Command Center"
        greetingPhrases={GREETINGS}
        greetingIntervalMs={GREETING_INTERVAL_MS}
      />
    );
  }


  if (auth.status === "guest") {
    return (
      <AppShell title="Workspace" subtitle="Command Center">
        <div className="cb-home">
          <div className="cb-workspace-console">
            <section className="cb-card cb-card-hero" aria-label="Auth required">
              <div className="cb-home-empty">
                <div className="cb-home-empty-title">Sign in required</div>
                <div className="cb-home-empty-sub">Redirecting to authentication…</div>
                <br />
                <Link className="cb-linkpill" href={`${AUTH_LOGIN_PATH}?next=${encodeURIComponent(pathname || "/")}`}>
                  Continue{" "}
                </Link>
              </div>
            </section>
          </div>
        </div>
      </AppShell>
    );
  }


  return (
    <>
      <AppShell
        title="Workspace"
        subtitle="Command Center"
        hideTopbar={addOpen || manageOpen}
      >
        <div className="cb-home">
          <div className="cb-workspace-console">
            {/* Welcome header (top of page) */}
            <header className="cb-welcome" aria-label="Welcome">
              <div className="cb-welcome-title">
                Hi,{" "}
                <span className="cb-welcome-nameWrap">
                  <Link
                    href="/settings?tab=account#sx-theme-switcher"
                    data-cb-route-intent="/settings?tab=account#sx-theme-switcher"
                    data-cb-perf-source="workspace-welcome-theme-link"
                    aria-label="Open theme color switcher"
                    style={{ textDecoration: "none" }}
                  >
                    <span className="cb-welcome-name" style={{ color: welcomeAccentColor }}>
                      {welcomeName || cachedName || "there"}
                    </span>
                  </Link>
                  {planId === "premium_plus" ? (
                    <span
                      className="cb-welcome-verifiedBadge"
                      role="img"
                      aria-label="Premium plus verified account"
                      title="Premium+ verified"
                    >
                      <svg
                        className="cb-welcome-verifiedIcon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M4 8.35 6.5 10.8 12.05 5.2" />
                      </svg>
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="cb-welcome-sub">Welcome back to your command center!</div>
            </header>


           {/* ===== GRID ===== */}
<div className="cb-grid cb-grid-2">
  {/* LEFT COLUMN (Profile, Alerts, Manage Websites) */}
  <div className="cb-stack">
    {/* Profile (TOP LEFT) */}
    <section className="cb-card" aria-label="Profile">
      <ProfileCard />
    </section>


    <ScannerControlCard
      projectId={activeProjectId}
      activeSiteId={activeSiteId}
      sites={sites}
      planId={planId}
      pushToast={pushToast}
    />


    {/* Manage Websites (MOVED BELOW ALERTS) */}
    <section className="cb-card" aria-label="Websites">
      <div className="cb-card-head" data-cb-layout-anchor="websites-head">
        <div className="cb-card-head-row">
          <div>
            <h2 className="cb-h2">Manage Websites</h2>
            <p className="cb-sub">Monitoring Targets: Add, remove, set top.</p>
          </div>


          <div className="cb-home-head-cta">
            <button
              className="cb-linkpill cb-linkpill-lime"
              type="button"
              data-cb-layout-anchor="websites-manage-btn"
              onClick={() => setManageOpen(true)}
            >
              Manage
            </button>
          </div>
        </div>
      </div>


      <div className="cb-divider cb-divider-full" />


      <br />


      <div className="cb-table-wrap">
        <br />
        {sites.length === 0 ? (
          <div className="cb-home-empty">
            <div className="cb-home-empty-title">No websites yet</div>
            <div className="cb-home-empty-sub">
              Add your first website to begin monitoring routes, errors, and recovery posture.
            </div>
            <br />
            <button className="cb-linkpill" type="button" onClick={() => setAddOpen(true)} aria-label="Add website" title="Add website">
              <Image
                src="/icons/cavpad/add-square-svgrepo-com.svg"
                alt=""
                aria-hidden="true"
                width={14}
                height={14}
                style={{ display: "block", filter: "brightness(0) saturate(100%) invert(100%)" }}
                unoptimized
              />
              <span className="cb-sr-only">Add website</span>
            </button>
          </div>
        ) : (
          <table className="cb-table" aria-label="Sites table">
            <thead>
              <tr>
                <th>Site</th>
                <th>Origin</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id} data-top={s.id === topSiteId ? "true" : "false"}>
                  <td>
                    <div className="cb-home-sitecell">
                      <span className={`cb-home-star ${s.id === topSiteId ? "is-on" : ""}`} aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                          />
                        </svg>
                      </span>
                      <div className="cb-home-sitemeta">
                        <div className="cb-route">{s.label}</div>
                        <div className="cb-home-sitesub">Added {fmtTime(safeNumDate(s.createdAt))}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="cb-home-mono" title={s.origin}>
                      {originToLabel(s.origin)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="cb-home-row-actions">
                      <button
                        className={`cb-iconbtn star ${s.id === topSiteId ? "is-on" : ""}`}
                        type="button"
                        onClick={() => setTopSite(s.id)}
                        aria-label={`Set top ${s.label}`}
                        title={s.id === topSiteId ? "Top site" : "Set top"}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                          />
                        </svg>
                      </button>


                      <button
                        className="cb-iconbtn danger"
                        type="button"
                        onClick={() => openDelete(s)}
                        aria-label={`Delete ${s.label}`}
                        title="Delete"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
                          <path d="M20.5 6H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  </div>


    {/* RIGHT COLUMN (Hero, CavTools) */}
    <div className="cb-stack">
      {/* Hero (TOP RIGHT) */}
      <section className="cb-card cb-card-hero" aria-label="Workspace snapshot">
      <div className="cb-card-head">
          <div className="cb-card-head-row">
            <div className="cb-hero-head">
              <div className="cb-hero-head-top">
              </div>
            </div>
            {/* RIGHT SIDE: CTAs */}
            <div className="cb-hero-cta">
            <button
              className="cb-tool-pill"
              type="button"
              data-tools-open
              aria-haspopup="dialog"
              aria-expanded={toolsOpen}
              aria-label="Dashboard tools"
              title="Dashboard tools"
              onClick={() => setToolsOpen(true)}
            >
                <Image
                  src="/icons/app/tool-svgrepo-com.svg"
                  alt=""
                  width={16}
                  height={16}
                  className="cb-tool-ico cb-tools-icon"
                  aria-hidden="true"
                  unoptimized
                />
              </button>
              <button className="cb-linkpill cb-hero-cta-add" type="button" onClick={() => setAddOpen(true)}>
                Add website
                <Image
                  src="/icons/app/plus-svgrepo-com.svg"
                  alt=""
                  aria-hidden="true"
                  width={12}
                  height={12}
                  className="cb-linkpill-plusIcon"
                  unoptimized
                />
              </button>
            </div>
          </div>
      </div>


      <br />
      <br />


      <div className="cb-divider cb-divider-full" />


      <br />


      {/* Snapshot tiles */}
      <div className="cb-insights" aria-label="Workspace metrics">
        <div className="cb-insight">
          <div className="cb-insight-k">Origins</div>
          <br />
          <div className="cb-insight-v">{sites.length}</div>
          <div className="cb-insight-s">Sites Monitored</div>
        </div>


        <div className="cb-insight">
          <div className="cb-insight-k">Primary Site</div>
          <br />
          <div className="cb-insight-v">{topSite ? originToLabel(topSite.origin) : "—"}</div>
          <div className="cb-insight-s">{topSite ? topSite.origin : "Add a site to begin"}</div>
        </div>


        <div className="cb-insight">
          <div className="cb-insight-k">Alerts</div>
          <br />
          <div className="cb-insight-v">{mergedNotices.length}</div>
          <div className="cb-insight-s">Recent Notices</div>
        </div>
      </div>


      <br />


      <div className="cb-divider cb-divider-full" />


      <br />


      <div className="cb-home-actions">
        <Link className="cb-linkpill-red" href={errorsHref}>
          Errors{" "}
        </Link>
        <Link className="cb-linkpill-ice" href={routesHref}>
          Routes{" "}
        </Link>
        <Link className="cb-linkpill-lime" href={seoHref}>
          SEO{" "}
        </Link>
      </div>
      </section>

      <CavAiRouteRecommendations
        panelId="command-center"
        snapshot={null}
        origin={topSite?.origin || ""}
        pagesScanned={sites.length || 1}
        title="CavBot Priorities"
        subtitle="For your selected site."
        pillars={["reliability", "seo", "performance", "accessibility", "ux", "engagement"]}
      />

      <section className="cb-card cb-card-notices" aria-label="Command Center alerts">
        <div className="cb-card-head">
          <div className="cb-card-head-row">
            <div>
              <h2 className="cb-h2">Command Center alerts</h2>
              <p className="cb-sub">Server-backed notices blend with local signals.</p>
            </div>
            <button className="cb-linkpill" type="button" onClick={() => addNotice({
              tone: "good",
              title: "Test notice",
              body: "This is a local preview of a notice.",
            })}>
              Test notice
            </button>
          </div>
        </div>
        <div className="cb-divider cb-divider-full" />
        <div className="cb-card-body">
          {mergedNotices.length ? (
            <ul className="cb-noticeList" aria-live="polite">
              {mergedNotices.map((notice) => (
                <li key={notice.id} className="cb-noticeCard" data-tone={notice.tone}>
                  <div className="cb-noticeCardRow">
                    <span className="cb-noticeCardTone">{notice.tone}</span>
                    <span className="cb-noticeCardSource">{notice.source === "server" ? "Server" : "Local"}</span>
                    <span className="cb-noticeCardTime">
                      {new Date(notice.ts).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="cb-noticeCardTitle">{notice.title}</div>
                  <div className="cb-noticeCardBody">{notice.body}</div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="cb-noticeEmpty">
              <div className="cb-noticeEmptyTitle">No alerts yet</div>
              <div className="cb-noticeEmptySub">
                Command Center notifications will appear here once activity is captured.
              </div>
            </div>
          )}
          {noticesError ? <div className="cb-noticeError">{noticesError}</div> : null}
        </div>
      </section>


    {/* CavTools (MOVED UP UNDER HERO) */}
    <section className="cb-card" aria-label="CavTools">
      <div className="cb-card-head">
        <div className="cb-card-head-row">
          <div>
            <h2 className="cb-h2">CavTools</h2>
            <p className="cb-sub">
              Inspect, verify,debug.
            </p>
          </div>
          <button
            className="cb-cavtools-head-link"
            type="button"
            data-cb-route-intent={cavtoolsHref}
            data-cb-perf-source="command-center-cavtools"
            aria-label="Open CavTools"
            title="Open CavTools"
            onClick={() => {
              // Root-cause fix (A1): avoid full document navigation from Command Center tools.
              router.push(cavtoolsHref);
            }}
          >
            <Image src="/icons/code-svgrepo-com.svg" alt="" width={18} height={18} aria-hidden="true" />
          </button>
        </div>
      </div>


      <div className="cb-divider cb-divider-full" />
      <br />
      <br />
      <div className="cb-dev-body">
        <div className="cb-dev-tiles" aria-label="Developer readiness">
          <div className="cb-dev-tile">
            <div className="cb-dev-k">Active Workspace</div>
            <div className="cb-dev-v">{workspacePill}</div>
            <div className="cb-dev-s">Project context</div>
          </div>


          <div className="cb-dev-tile">
            <div className="cb-dev-k">Active Origin</div>
            <div className="cb-dev-v mono">{selectedOrigin || "—"}</div>
            <div className="cb-dev-s">{selectedOrigin ? "Bound to modules" : "Add a website to bind context"}</div>
          </div>


          <div className="cb-dev-tile">
            <div className="cb-dev-k">Client Status</div>
            <div className="cb-dev-v">{selectedOrigin ? "Ready" : "Not connected"}</div>
            <div className="cb-dev-s">SDK + event pipeline</div>
          </div>


          <div className="cb-dev-tile">
            <div className="cb-dev-k">Next Upgrade</div>
            <div className="cb-dev-v">Verify events</div>
            <div className="cb-dev-s">Route map · errors · SEO</div>
          </div>
        </div>
      </div>
    </section>

    {/* CavCloud summary (new) */}
    <section className="cb-card cb-card-cavcloud" aria-label="CavCloud storage">
      <CavCloudPromo
        limitBytes={cavcloudLimitLoaded ? (cavcloudLimitBytes == null ? Number.POSITIVE_INFINITY : cavcloudLimitBytes) : storageLimitBytes(planId, trialActive)}
        usedBytes={usedBytes}
        planLabel={workspacePlanLabel}
        trialActive={trialActive}
        folders={cavcloudCounts.folders}
        files={cavcloudCounts.files}
        images={cavcloudCounts.images}
        videos={cavcloudCounts.videos}
        other={cavcloudCounts.other}
      />
    </section>
  </div>
</div>




            {/* Toast */}
            {toast ? (
              <div className="cb-home-toast" role="status" aria-live="polite" data-tone={toast.tone}>
                {toast.msg}
              </div>
            ) : null}


            <DashboardToolsModal
              open={toolsOpen}
              sites={sites}
              selectedSiteId={toolsSiteId}
              reportHref={reportHref}
              reportFileName={reportFileName}
              onClose={closeToolsModal}
              onApply={(siteId) => {
                onSelectSite(siteId);
                setToolsOpen(false);
              }}
              onChangeSite={(siteId) => setToolsSiteId(siteId)}
            />

            {/* Add site modal */}
            {addOpen ? (
              <AddSiteModal
                onClose={() => setAddOpen(false)}
                onAddRequested={async (payload) => {
                  await onAddSiteRequested(payload);
                  setAddOpen(false);
                }}
              />
            ) : null}


            {/* Delete confirmation modal */}
            <DeleteSiteModal
              site={deleteTarget || DELETE_MODAL_PLACEHOLDER}
              strictDeletion={guardrails.strictDeletion}
              wsName={workspacePill}
              open={deleteOpen}
              onClose={() => {
                setDeleteOpen(false);
                setDeleteTarget(null);
              }}
              onConfirm={(mode) => {
                if (!deleteTarget) return;
                void removeSiteConfirmed(deleteTarget.id, mode);
                setDeleteOpen(false);
                setDeleteTarget(null);
              }}
            />

            <ManageWebsitesModal
              open={manageOpen}
              onClose={() => setManageOpen(false)}
              activeSites={sites}
              topSiteId={topSiteId}
              recentlyRemoved={recentlyRemovedSites}
              recentlyLoading={recentlyRemovedLoading}
              recentlyError={recentlyRemovedError}
              restoringSiteId={restoringSiteId}
              onRestore={restoreSite}
              onDetach={detachFromModal}
            />

          </div>
        </div>
      </AppShell>
    </>
  );
}


/* ==========================
  Components
========================== */


type AccountContext = {
  tierEffective?: string | null;
  tier?: string | null;
};

function planTierLabelFromAccount(account?: AccountContext | null) {
  const raw = String(account?.tierEffective || account?.tier || "").toLowerCase();
  if (raw.includes("premium_plus") || raw.includes("premium+") || raw.includes("plus")) return "PREMIUM+";
  if (raw.includes("enterprise")) return "PREMIUM+";
  if (raw.includes("premium") || raw.includes("pro") || raw.includes("paid")) return "PREMIUM";
  return "FREE";
}

type ProfileInfo = {
  fullName?: string;
  email?: string;
  bio?: string;
  username?: string;
  companySubcategory?: string;
  githubUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
  customLinkUrl?: string;
};

type ProfileApiResponse = {
  ok?: boolean;
  profile?: ProfileInfo;
  data?: {
    profile?: ProfileInfo;
  };
  error?: string;
  message?: string;
};

type AuthAccount = {
  tierEffective?: string | null;
  tier?: string | null;
};

type AuthMeResponse = {
  ok?: boolean;
  account?: AuthAccount;
  trialActive?: boolean;
  daysLeft?: number;
  profile?: {
    username?: string;
  };
};

type MembersApiResponse = {
  ok?: boolean;
  members?: Array<Record<string, unknown>>;
  invites?: Array<Record<string, unknown>>;
  seatsUsed?: number;
  seatLimit?: number;
};

function firstInitialChar(input: string) {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function deriveProfileInitials(fullName: string, username: string, fallback: string) {
  const name = String(fullName || "").trim();
  if (name && name !== "—") {
    const parts = name.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const a = firstInitialChar(parts[0] || "");
      const b = firstInitialChar(parts[1] || "");
      const duo = `${a}${b}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const u = String(username || "").trim().replace(/^@+/, "");
  if (u && u !== "—") {
    const userInitial = firstInitialChar(u);
    if (userInitial) return userInitial;
  }

  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function profileToneToAccentColor(tone: string): string {
  const value = String(tone || "").trim().toLowerCase();
  if (value === "violet") return "#8b5cff";
  if (value === "blue") return "#4da3ff";
  if (value === "white") return "#f7fbff";
  if (value === "navy") return "#9fb6ff";
  if (value === "transparent") return "#f7fbff";
  return "#b9c85a";
}


function ProfileCard() {
  const [fullName, setFullName] = useState<string>("—");
  const [email, setEmail] = useState<string>("—");
  const [username, setUsername] = useState<string>("—");
  const [bio, setBio] = useState<string>("No bio yet.");
  const [plan, setPlan] = useState<string>("FREE");


  const [teamCount, setTeamCount] = useState<number>(0);
  const [seatsUsed, setSeatsUsed] = useState<number>(0);
  const [seatLimit, setSeatLimit] = useState<number | null>(null);


  const [initials, setInitials] = useState<string>("");
  const [tone, setTone] = useState<string>("lime");
  const [avatarImage, setAvatarImage] = useState<string>("");
  const [companySubcategory, setCompanySubcategory] = useState<string>("");
  const [githubUrl, setGithubUrl] = useState<string>("");
  const [instagramUrl, setInstagramUrl] = useState<string>("");
  const [linkedinUrl, setLinkedinUrl] = useState<string>("");
  const [customLinkUrl, setCustomLinkUrl] = useState<string>("");
  const instagramGradientId = useId();

  const lastProfileRevRef = useRef<string>("");

  const syncProfileFromLocalStorage = useCallback(() => {
    try {
      const init = (globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim().slice(0, 3).toUpperCase();
      setInitials(init);

      const t = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim();
      const img = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim();
      setTone(t || "lime");
      setAvatarImage(img || "");

      const n = (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim();
      const e = (globalThis.__cbLocalStore.getItem("cb_profile_email_v1") || "").trim();
      const u = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim();
      const b = (globalThis.__cbLocalStore.getItem("cb_profile_bio_v1") || "").trim();
      const sc = (globalThis.__cbLocalStore.getItem("cb_profile_company_subcategory_v1") || "").trim();
      const gh = (globalThis.__cbLocalStore.getItem("cb_profile_github_url_v1") || "").trim();
      const ig = (globalThis.__cbLocalStore.getItem("cb_profile_instagram_url_v1") || "").trim();
      const li = (globalThis.__cbLocalStore.getItem("cb_profile_linkedin_url_v1") || "").trim();
      const cu = (globalThis.__cbLocalStore.getItem("cb_profile_custom_link_url_v1") || "").trim();

      if (n) setFullName(n);
      if (e) setEmail(e);
      if (u) setUsername(u);
      if (b) setBio(b);
      setCompanySubcategory(sc);
      setGithubUrl(gh);
      setInstagramUrl(ig);
      setLinkedinUrl(li);
      setCustomLinkUrl(cu);
    } catch {}
  }, []);


  // Fast paint from globalThis.__cbLocalStore (instant)
  useEffect(() => {
    queueMicrotask(() => {
      syncProfileFromLocalStorage();
    });
    try {
      lastProfileRevRef.current = (globalThis.__cbLocalStore.getItem("cb_profile_rev_v1") || "").trim();
    } catch {}
  }, [syncProfileFromLocalStorage]);

  // When navigating back from Settings, Next may restore this page from cache without remounting.
  // This revision polling ensures the workspace card reflects the latest Account Settings changes.
  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        const rev = (globalThis.__cbLocalStore.getItem("cb_profile_rev_v1") || "").trim();
        if (!rev || rev === lastProfileRevRef.current) return;
        lastProfileRevRef.current = rev;
        syncProfileFromLocalStorage();
      } catch {}
    }, 650);

    return () => window.clearInterval(timer);
  }, [syncProfileFromLocalStorage]);


  type ProfileEventDetail = {
    initials?: string | null;
    tone?: string | null;
    avatarImage?: string | null;
    fullName?: string | null;
    email?: string | null;
    username?: string | null;
    bio?: string | null;
    companySubcategory?: string | null;
    githubUrl?: string | null;
    instagramUrl?: string | null;
    linkedinUrl?: string | null;
    customLinkUrl?: string | null;
  };

  // Live updates when Account page saves (cb:profile)
  useEffect(() => {
    function onProfile(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      try {
        const detail = event.detail;
        const d: ProfileEventDetail = detail && typeof detail === "object" ? (detail as ProfileEventDetail) : {};

        if (typeof d.initials === "string") {
          setInitials(d.initials.trim().slice(0, 3).toUpperCase());
        }
        if (typeof d.tone === "string") setTone(d.tone);
        if (typeof d.avatarImage === "string") setAvatarImage(d.avatarImage);
        if (d.avatarImage === null) setAvatarImage("");


        if (typeof d.fullName === "string") setFullName(d.fullName.trim() || "—");
        if (typeof d.email === "string") setEmail(d.email.trim() || "—");
        if (typeof d.username === "string") setUsername(d.username.trim() || "—");
        if (typeof d.bio === "string") setBio(d.bio.trim() || "No bio yet.");
        if (typeof d.companySubcategory === "string") {
          const sc = d.companySubcategory.trim();
          setCompanySubcategory(sc);
          try {
            globalThis.__cbLocalStore.setItem("cb_profile_company_subcategory_v1", sc);
          } catch {}
        }
        if (typeof d.githubUrl === "string") {
          const gh = d.githubUrl.trim();
          setGithubUrl(gh);
          try {
            globalThis.__cbLocalStore.setItem("cb_profile_github_url_v1", gh);
          } catch {}
        }
        if (typeof d.instagramUrl === "string") {
          const ig = d.instagramUrl.trim();
          setInstagramUrl(ig);
          try {
            globalThis.__cbLocalStore.setItem("cb_profile_instagram_url_v1", ig);
          } catch {}
        }
        if (typeof d.linkedinUrl === "string") {
          const li = d.linkedinUrl.trim();
          setLinkedinUrl(li);
          try {
            globalThis.__cbLocalStore.setItem("cb_profile_linkedin_url_v1", li);
          } catch {}
        }
        if (typeof d.customLinkUrl === "string") {
          const cu = d.customLinkUrl.trim();
          setCustomLinkUrl(cu);
          try {
            globalThis.__cbLocalStore.setItem("cb_profile_custom_link_url_v1", cu);
          } catch {}
        }
      } catch {}
    }


    window.addEventListener("cb:profile", onProfile);
    return () => window.removeEventListener("cb:profile", onProfile);
  }, []);


  // Real data: profile + plan tier + seats/team
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();


    (async () => {
      try {
        const [pRes, meRes, teamRes] = await Promise.all([
          fetch("/api/settings/account", { method: "GET", cache: "no-store", signal: ctrl.signal }),
          fetch("/api/auth/me", { method: "GET", cache: "no-store", signal: ctrl.signal }),
          fetch("/api/members", { method: "GET", cache: "no-store", signal: ctrl.signal }),
        ]);


        const pJson = (await pRes.json().catch(() => ({}))) as ProfileApiResponse;
        const meJson = (await meRes.json().catch(() => ({}))) as AuthMeResponse;
        const teamJson = (await teamRes.json().catch(() => ({}))) as MembersApiResponse;
        if (!alive) return;


        if (pRes.ok && pJson?.ok) {
          const name = String(pJson?.profile?.fullName || "").trim();
          const em = String(pJson?.profile?.email || "").trim();
          const bi = String(pJson?.profile?.bio || "").trim();
          const usr = String(pJson?.profile?.username || "").trim();
          const sc = String(pJson?.profile?.companySubcategory || "").trim();
          const gh = String(pJson?.profile?.githubUrl || "").trim();
          const ig = String(pJson?.profile?.instagramUrl || "").trim();
          const li = String(pJson?.profile?.linkedinUrl || "").trim();
          const cu = String(pJson?.profile?.customLinkUrl || "").trim();

          setFullName(name || "—");
          setEmail(em || "—");
          setUsername(usr || "—");
          setBio(bi || "No bio yet.");
          setCompanySubcategory(sc);
          setGithubUrl(gh);
          setInstagramUrl(ig);
          setLinkedinUrl(li);
          setCustomLinkUrl(cu);

          try {
            globalThis.__cbLocalStore.setItem("cb_profile_fullName_v1", name || "");
            globalThis.__cbLocalStore.setItem("cb_profile_email_v1", em || "");
            globalThis.__cbLocalStore.setItem("cb_profile_username_v1", usr || "");
            globalThis.__cbLocalStore.setItem("cb_profile_bio_v1", bi || "");
            globalThis.__cbLocalStore.setItem("cb_profile_company_subcategory_v1", sc || "");
            globalThis.__cbLocalStore.setItem("cb_profile_github_url_v1", gh || "");
            globalThis.__cbLocalStore.setItem("cb_profile_instagram_url_v1", ig || "");
            globalThis.__cbLocalStore.setItem("cb_profile_linkedin_url_v1", li || "");
            globalThis.__cbLocalStore.setItem("cb_profile_custom_link_url_v1", cu || "");
          } catch {}
        }


        if (meRes.ok && meJson?.ok) {
          const planKey = resolvePlanIdFromTier(meJson?.account);
          const planLabel = planTierLabelFromAccount(meJson?.account);
          const planLimits = getPlanLimits(planKey);
          const planSeatLimit = Number(planLimits?.seats ?? 0);
          const meUsername = String(meJson?.profile?.username || "").trim();

          const planDetail = {
            planKey,
            planLabel,
            trialActive: Boolean(meJson?.account?.trialActive ?? meJson?.trialActive),
          };

          try {
            window.dispatchEvent(new CustomEvent("cb:plan", { detail: planDetail }));
            globalThis.__cbLocalStore.setItem("cb_plan_context_v1", JSON.stringify(planDetail));
          } catch {}

          setPlan(planLabel);

          if (planSeatLimit > 0) {
            setSeatLimit(planSeatLimit);
          }

          if (meUsername) setUsername(meUsername);
        }


        if (teamRes.ok && teamJson?.ok) {
          const members = Array.isArray(teamJson?.members) ? teamJson.members : [];
          const invites = Array.isArray(teamJson?.invites) ? teamJson.invites : [];


          const used = Number(teamJson?.seatsUsed ?? members.length + invites.length) || 0;


          const limitRaw = Number(teamJson?.seatLimit ?? 0);
          const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : null;

          setTeamCount(members.length);
          setSeatsUsed(Math.max(0, used));
          if (limit !== null) {
            setSeatLimit(limit);
          }
        }
      } catch {
      }
    })();


    return () => {
      alive = false;
      try {
        ctrl.abort();
      } catch {}
    };
  }, []);


  const avatarTone = String(tone || "lime").trim().toLowerCase();
  const toneBg = avatarImage
    ? "rgba(0,0,0,0.24)"
    : avatarTone === "transparent" || avatarTone === "clear"
    ? "transparent"
    : avatarTone === "violet"
    ? "rgba(139,92,255,0.22)"
    : avatarTone === "blue"
    ? "rgba(78,168,255,0.22)"
    : avatarTone === "white"
    ? "rgba(255,255,255,0.92)"
    : avatarTone === "navy"
    ? "rgba(1,3,15,0.78)"
    : "rgba(185,200,90,0.92)";
  const profileInitials = useMemo(
    () => deriveProfileInitials(fullName, username, initials),
    [fullName, initials, username]
  );
  const initialsColor =
    avatarTone === "transparent" || avatarTone === "clear"
      ? "var(--lime)"
      : avatarTone === "violet" || avatarTone === "blue" || avatarTone === "navy"
      ? "rgba(247,251,255,0.96)"
      : "rgba(1,3,15,0.92)";


  const seatsLabel = seatLimit ? `${seatsUsed}/${seatLimit}` : `${seatsUsed} (Unlimited)`;
  const workspaceUsernameDisplay = username === "—" ? username : username.toLowerCase();
  const usernameLabel = workspaceUsernameDisplay === "—" ? "—" : `@${workspaceUsernameDisplay}`;
  const profileLinks = useMemo<
    Array<{ key: string; label: string; url: string; icon: JSX.Element }>
  >(() => {
    const items: Array<{ key: string; label: string; url: string; icon: JSX.Element }> = [];
    const decodeCustomLinks = (raw: string) => {
      const s = String(raw || "").trim();
      if (!s) return [] as string[];
      try {
        if (s.startsWith("[")) {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) {
            return Array.from(new Set(parsed.map((x) => String(x ?? "").trim()).filter(Boolean))).slice(0, 6);
          }
        }
      } catch {}
      return [s];
    };
    const u = String(username || "").trim().toLowerCase();
    if (u && u !== "—") {
      items.push({
        key: "cavbot",
        label: "CavBot",
        url: `app.cavbot.io/${u}`,
        icon: (
          <Image
            src="/logo/cavbot-logomark.svg"
            alt=""
            width={16}
            height={16}
            priority
            unoptimized
            aria-hidden="true"
          />
        ),
      });
    }
    const gh = String(githubUrl || "").trim();
    if (gh && gh !== "—") {
      items.push({
        key: "github",
        label: "GitHub",
        url: gh,
        icon: (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .5C5.73.5.75 5.63.75 12c0 5.1 3.29 9.42 7.86 10.95.57.11.78-.25.78-.56 0-.28-.01-1.02-.02-2-3.2.71-3.88-1.58-3.88-1.58-.52-1.36-1.28-1.72-1.28-1.72-1.05-.74.08-.73.08-.73 1.16.08 1.77 1.22 1.77 1.22 1.03 1.8 2.7 1.28 3.36.98.1-.77.4-1.28.72-1.58-2.55-.3-5.23-1.3-5.23-5.8 0-1.28.45-2.33 1.18-3.15-.12-.3-.51-1.53.11-3.18 0 0 .97-.32 3.18 1.2a10.7 10.7 0 0 1 2.9-.4c.98 0 1.97.14 2.9.4 2.21-1.52 3.18-1.2 3.18-1.2.62 1.65.23 2.88.11 3.18.74.82 1.18 1.87 1.18 3.15 0 4.51-2.69 5.5-5.25 5.79.41.36.78 1.08.78 2.18 0 1.58-.01 2.85-.01 3.23 0 .31.2.67.79.56A11.28 11.28 0 0 0 23.25 12C23.25 5.63 18.27.5 12 .5Z"
            />
          </svg>
        ),
      });
    }
    const ig = String(instagramUrl || "").trim();
    if (ig && ig !== "—") {
      items.push({
        key: "instagram",
        label: "Instagram",
        url: ig,
        icon: (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <defs>
              <linearGradient id={`${instagramGradientId}-instagramGradient`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#feda75" />
                <stop offset="25%" stopColor="#fa7e1e" />
                <stop offset="50%" stopColor="#d62976" />
                <stop offset="75%" stopColor="#962fbf" />
                <stop offset="100%" stopColor="#4f5bd5" />
              </linearGradient>
            </defs>
            <rect x="2" y="2" width="20" height="20" rx="5.5" fill={`url(#${instagramGradientId}-instagramGradient)`} />
            <rect
              x="6.5"
              y="6.5"
              width="11"
              height="11"
              rx="3.2"
              fill="none"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth="1.2"
            />
            <circle cx="12" cy="12" r="3.5" fill="rgba(255,255,255,0.85)" />
            <circle cx="17.7" cy="6.3" r="1.1" fill="rgba(255,255,255,0.9)" />
          </svg>
        ),
      });
    }
    const li = String(linkedinUrl || "").trim();
    if (li && li !== "—") {
      items.push({
        key: "linkedin",
        label: "LinkedIn",
        url: li,
        icon: (
          <LinkedInSquareIcon size={16} />
        ),
      });
    }
    const customLinks = decodeCustomLinks(String(customLinkUrl || ""));
    customLinks.forEach((cu, idx) => {
      const v = String(cu || "").trim();
      if (!v || v === "—") return;
      items.push({
        key: `website:${idx}`,
        label: idx === 0 ? "Website" : `Website ${idx + 1}`,
        url: v,
        icon: (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M3 12h18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path
              d="M12 3c3.4 3.7 3.4 13.3 0 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d="M12 3c-3.4 3.7-3.4 13.3 0 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        ),
      });
    });
    return items;
  }, [customLinkUrl, githubUrl, instagramGradientId, instagramUrl, linkedinUrl, username]);

  const formatHref = (link: string) => (link.startsWith("http") ? link : `https://${link}`);


  return (
    <>
      <div className="cb-card-head" data-cb-layout-anchor="profile-head">
        <div className="cb-card-head-row">
          <div>
            <h2 className="cb-h2">Profile</h2>
            
          </div>


          <Link className="cb-linkpill" href="/settings?tab=account" data-cb-layout-anchor="profile-account-link">
            Account
          </Link>
        </div>
      </div>


      <div className="cb-divider cb-divider-full" />


      <br />


	      <div style={{ display: "grid", placeItems: "center", padding: "8px 0 10px" }}>
	        <div
	          style={{
	            width: 120,
	            height: 120,
	            borderRadius: 16,
	            background: toneBg,
	            overflow: "hidden",
	            display: "grid",
	            placeItems: "center",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "none",
          }}
          aria-label="Profile photo"
        >
	          {avatarImage ? (
	            <Image
	              src={avatarImage}
	              alt=""
	              width={120}
	              height={120}
	              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
	              unoptimized
	            />
	          ) : (
            <span
              style={{
                fontWeight: 900,
                letterSpacing: "0.08em",
                color: initialsColor,
              }}
            >
              {profileInitials}
            </span>
          )}
        </div>
      </div>


      <div style={{ padding: "0 20px" }}>
        <div className="cb-profile-meta">
          <div className="cb-profile-name">{fullName}</div>
          {companySubcategory ? (
            <div className="cb-profile-subcategory" aria-label="Workspace descriptor">
              {companySubcategory}
            </div>
          ) : null}
          <div className="cb-profile-username">{usernameLabel}</div>
          <div className="cb-profile-bio">
            <div className="cb-profile-bio-label">Bio</div>
            <p className="cb-profile-bio-text">{bio}</p>
          </div>
          {profileLinks.length ? (
            <div className="cb-profile-link-row">
              {profileLinks.map((link) =>
                link.url ? (
                  <a
                    key={link.key}
                    href={formatHref(link.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="cb-profile-link-icon-btn"
                    aria-label={link.label}
                  >
                    {link.icon}
                  </a>
                ) : (
                  <span
                    key={link.key}
                    className="cb-profile-link-icon-btn is-disabled"
                    aria-label={link.label}
                  >
                    {link.icon}
                  </span>
                )
              )}
            </div>
          ) : null}
        </div>
      </div>


      <br />


      <div className="cb-divider cb-divider-full" />


      <br />


      <div style={{ padding: "0 20px 20px" }}>
        <div className="cb-home-kv">
          <div className="cb-home-kv-row">
            <span className="cb-home-k">Plan tier</span>
            <span className="cb-home-v">{plan}</span>
          </div>


          <div className="cb-home-kv-row">
            <span className="cb-home-k">Seats</span>
            <span className="cb-home-v">{seatsLabel}</span>
          </div>


          <div className="cb-home-kv-row">
            <span className="cb-home-k">Team</span>
            <span className="cb-home-v">{`${teamCount} member${teamCount === 1 ? "" : "s"}`}</span>
          </div>


          <div className="cb-home-kv-row">
            <span className="cb-home-k">Email</span>
            <span className="cb-home-v mono">{email}</span>
          </div>
        </div>
      </div>
    </>
  );
}

const CAVCLOUD_CATEGORY_COLORS = {
  folders: "#b9c85a",
  files: "#8b5cff",
  images: "#4fd1c5",
  videos: "#ffcc66",
  other: "rgba(255,255,255,0.28)",
} as const;

const CLOUD_ICON_SVG = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M17 6a5 5 0 0 0-9.9-.93A4.5 4.5 0 0 0 5.5 15h11a4 4 0 0 0 0-8Z" fill="currentColor" />
  </svg>
);

function CavCloudPromo({
  planLabel,
  trialActive,
  limitBytes,
  usedBytes,
  folders,
  files,
  images,
  videos,
  other,
}: {
  planLabel: string;
  trialActive: boolean;
  limitBytes: number;
  usedBytes: number;
  folders: number;
  files: number;
  images: number;
  videos: number;
  other: number;
}) {
  // (Currently unused) reserved for future tier-specific storage UI tweaks.
  void planLabel;
  void trialActive;

  const ringFull = limitBytes !== Infinity && usedBytes >= limitBytes;
  const ringWarn = limitBytes !== Infinity && usedBytes / Math.max(limitBytes, 1) >= 0.8 && !ringFull;
  const usagePct = limitBytes === Infinity ? 0 : Math.min(100, Math.round((usedBytes / limitBytes) * 100));
  // CavCloud should read "cloud storage", not lime-accent UI.
  const ringColor = ringFull ? "rgba(255,114,114,0.92)" : ringWarn ? "rgba(255,186,104,0.92)" : "rgba(78,168,255,0.92)";
  const limitLabel = limitBytes === Infinity ? "Unlimited" : formatBytes(limitBytes);
  const availableBytes = limitBytes === Infinity ? Number.POSITIVE_INFINITY : Math.max(0, limitBytes - usedBytes);
  const availableLabel = limitBytes === Infinity ? "Unlimited" : formatBytes(availableBytes);
  const progress = limitBytes === Infinity ? 0 : Math.min(1, usedBytes / Math.max(limitBytes, 1));
  // Keep tier label out of the ring UI (minimal storage dial).

  // SVG ring (no CSS gradients/shadows/glows).
  const RING_SIZE = 124;
  const RING_STROKE = 6;
  const RING_R = (RING_SIZE - RING_STROKE) / 2;
  const RING_C = 2 * Math.PI * RING_R;
  const ringDashOffset = Math.round(RING_C * (1 - progress) * 1000) / 1000;
  const ringDotAngle = (-90 + progress * 360) * (Math.PI / 180);
  const ringDotCx = RING_SIZE / 2 + RING_R * Math.cos(ringDotAngle);
  const ringDotCy = RING_SIZE / 2 + RING_R * Math.sin(ringDotAngle);

  function splitBytesLabel(label: string): { num: string; unit: string } {
    const raw = String(label || "").trim();
    const parts = raw.split(/\s+/g);
    if (parts.length <= 1) return { num: raw, unit: "" };
    return { num: parts.slice(0, -1).join(" "), unit: parts[parts.length - 1] };
  }

  const usedParts = splitBytesLabel(formatBytes(usedBytes));
  const remainingParts = splitBytesLabel(availableLabel);
  const capParts = splitBytesLabel(limitLabel);
  const categories = [
    { label: "Folders", value: Math.max(0, Math.trunc(folders)), color: CAVCLOUD_CATEGORY_COLORS.folders },
    { label: "Files", value: Math.max(0, Math.trunc(files)), color: CAVCLOUD_CATEGORY_COLORS.files },
    { label: "Images", value: Math.max(0, Math.trunc(images)), color: CAVCLOUD_CATEGORY_COLORS.images },
    { label: "Videos", value: Math.max(0, Math.trunc(videos)), color: CAVCLOUD_CATEGORY_COLORS.videos },
    { label: "Other", value: Math.max(0, Math.trunc(other)), color: CAVCLOUD_CATEGORY_COLORS.other },
  ];

  return (
    <a className="cb-cavcloud-link" href="/cavcloud" target="_blank" rel="noreferrer">
      <div className="cb-card-head">
        <div className="cb-card-head-row">
          <div>
            <h2 className="cb-h2">CavCloud</h2>
            <p className="cb-sub">Store and share directly on CavBot.</p>
          </div>
          <span className="cb-cavcloud-icon" aria-hidden="true">
            {CLOUD_ICON_SVG}
          </span>
        </div>
      </div>

      <div className="cb-divider cb-divider-full" />

      <div className="cb-cavcloud-body">
        <div className="cb-cavcloud-ring-wrap">
          <div className="cb-cavcloud-ring" aria-label={`${usagePct}% used`}>
            <svg
              className="cb-cavcloud-ring-svg"
              width={RING_SIZE}
              height={RING_SIZE}
              viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
              aria-hidden="true"
            >
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke="rgba(255,255,255,0.10)"
                strokeWidth={RING_STROKE}
              />
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                fill="none"
                stroke={ringColor}
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={`${RING_C} ${RING_C}`}
                strokeDashoffset={ringDashOffset}
                style={{ transformOrigin: "50% 50%", transform: "rotate(-90deg)" }}
              />
              {limitBytes === Infinity ? null : (
                <circle
                  cx={ringDotCx}
                  cy={ringDotCy}
                  r={3}
                  fill={ringColor}
                  stroke="rgba(255,255,255,0.26)"
                  strokeWidth={1}
                />
              )}
            </svg>

            <div className="cb-cavcloud-ring-center">
              <div className="cb-cavcloud-limit">{limitLabel}</div>
              <div className="cb-cavcloud-pct">{usagePct}% used</div>
            </div>
          </div>
        </div>

        <div className="cb-cavcloud-metrics" aria-label="Storage summary">
          <div className="cb-cavcloud-metric">
            <div className="cb-cavcloud-metric-k">Used</div>
            <div className="cb-cavcloud-metric-v" aria-label={formatBytes(usedBytes)}>
              <span className="cb-cavcloud-metric-num">{usedParts.num}</span>
              {usedParts.unit ? <span className="cb-cavcloud-metric-unit">{usedParts.unit}</span> : null}
            </div>
          </div>
          <div className="cb-cavcloud-metric">
            <div className="cb-cavcloud-metric-k">Free</div>
            <div className="cb-cavcloud-metric-v" aria-label={availableLabel}>
              <span className="cb-cavcloud-metric-num">{remainingParts.num}</span>
              {remainingParts.unit ? <span className="cb-cavcloud-metric-unit">{remainingParts.unit}</span> : null}
            </div>
          </div>
          <div className="cb-cavcloud-metric">
            <div className="cb-cavcloud-metric-k">Total</div>
            <div className="cb-cavcloud-metric-v" aria-label={limitLabel}>
              <span className="cb-cavcloud-metric-num">{capParts.num}</span>
              {capParts.unit ? <span className="cb-cavcloud-metric-unit">{capParts.unit}</span> : null}
            </div>
          </div>
        </div>

        <div className="cb-cavcloud-types" aria-label="Storage breakdown">
          {categories.map((cat) => {
            return (
              <div className="cb-cavcloud-type" key={cat.label}>
                <span className="cb-cavcloud-type-dot" style={{ background: cat.color }} aria-hidden="true" />
                <span className="cb-cavcloud-type-label">{cat.label}</span>
                <strong className="cb-cavcloud-type-value">{cat.value}</strong>
              </div>
            );
          })}
        </div>
      </div>
    </a>
  );
}


function AddSiteModal({
  onClose,
  onAddRequested,
}: {
  onClose: () => void;
  onAddRequested: (payload: { origin: string; label: string; notes?: string }) => Promise<void> | void;
}) {
  const [originInput, setOriginInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);


  const panelRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  useEffect(() => {
    try {
      const el = panelRef.current?.querySelector("#cb_add_origin") as HTMLInputElement | null;
      el?.focus();
    } catch {}
  }, []);


  async function submit() {
    setErr(null);


    let origin: string;
    try {
      origin = normalizeOrigin(originInput);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Invalid origin.");
      return;
    }


    const label = clampStr(labelInput, 18);


    if (!label || label.length < 1) {
      setErr("Display name is required (max 18 characters).");
      return;
    }


    try {
      setSaving(true);
      await onAddRequested({
        origin,
        label,
        notes: clampStr(notes, 160),
      });
    } catch (error) {
      if (error instanceof Error) {
        setErr(error.message);
      } else {
        setErr("Failed to add website.");
      }
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="cb-home-modal cb-home-modal-add" role="dialog" aria-modal="true" aria-label="Add website">
      <div className="cb-home-modal-overlay" onClick={onClose} aria-hidden="true" />

      <div className="cb-home-modal-panel cb-home-modal-panel-add" ref={panelRef}>
        <div className="cb-home-modal-head">
          <div className="cb-home-modal-title cb-home-modal-add-title">Add website</div>
          <div className="cb-home-modal-sub cb-home-modal-add-sub">
            Add a domain origin. CavBot uses it for routes, events, and monitoring.
          </div>
        </div>

        {err ? (
          <div className="cb-home-alert" role="alert">
            {err}
          </div>
        ) : null}

        <div className="cb-home-modal-body">
          <div className="cb-home-form">
            <div className="cb-home-field">
              <input
                id="cb_add_origin"
                className="cb-home-input"
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                placeholder="https://example.com (or: example.com)"
                inputMode="url"
                type="url"
                autoComplete="off"
                disabled={saving}
              />
            </div>
            <div className="cb-home-field">
              <input
                id="cb_add_label"
                className="cb-home-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="Display name"
                autoComplete="off"
                maxLength={18}
                disabled={saving}
              />
            </div>
            <div className="cb-home-field">
              <textarea
                id="cb_add_notes"
                className="cb-home-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything your team should know about this site…"
                disabled={saving}
              />
            </div>
          </div>
        </div>

        <div className="cb-home-modal-divider cb-home-modal-divider-add" aria-hidden="true" />

        <div className="cb-home-modal-actions">
          <button className="cb-linkpill cb-linkpill-ghost" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="cb-linkpill cb-linkpill-blue" type="button" onClick={submit} disabled={saving}>
            {saving ? (
              "Adding…"
            ) : (
              <>
                Add website
                <Image
                  src="/icons/app/plus-svgrepo-com.svg"
                  alt=""
                  aria-hidden="true"
                  width={12}
                  height={12}
                  className="cb-linkpill-plusIcon"
                  unoptimized
                />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


function DeleteSiteModal({
  site,
  strictDeletion,
  wsName,
  open,
  onClose,
  onConfirm,
}: {
  site: Site;
  strictDeletion: boolean;
  wsName: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (mode: DeleteMode) => void;
}) {
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);

  const displaySite = site || DELETE_MODAL_PLACEHOLDER;
  const required = displaySite.origin;
  const ok = typed.trim() === required && ack;

  useEffect(() => {
    if (!open) return;
    const reset = window.setTimeout(() => {
      setTyped("");
      setAck(false);
    }, 0);
    return () => window.clearTimeout(reset);
  }, [open, displaySite.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const w = window as Window & {
      __cavbotEyeTrackingRefresh?: () => void;
      __cavbotHeadTrackingRefresh?: () => void;
    };
    const refresh = () => {
      w.__cavbotEyeTrackingRefresh?.();
      w.__cavbotHeadTrackingRefresh?.();
    };

    refresh();
    const timer = window.setTimeout(refresh, 90);
    return () => window.clearTimeout(timer);
  }, [open]);


  return (
    <div
      className="cb-home-modal cb-home-modal-delete"
      role="dialog"
      aria-modal="true"
      aria-label="Delete website confirmation"
      aria-hidden={!open}
      style={{ display: open ? undefined : "none" }}
    >
      <div className="cb-home-modal-overlay" onClick={onClose} aria-hidden="true" />

      <div className="cb-home-modal-panel danger">
        <div className="cb-home-modal-head cb-home-modal-head--warning">
          <div>
            <div className="cb-home-modal-title">Permanent removal from this workspace</div>
            <div className="cb-home-modal-sub">
              This will remove the website from <b>{wsName}</b> and detach it from dashboard surfaces, modules, and scoped analytics views.
              {strictDeletion ? (
                <>
                  {" "}
                  Because <b>Strict deletion</b> is enabled, any app-stored analytics cache for this origin will also be purged.
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="cb-home-modal-body">
          <div className="cb-home-kv">
            <div className="cb-home-kv-row">
              <span className="cb-home-k">Site</span>
              <span className="cb-home-v">{displaySite.label}</span>
            </div>
            <div className="cb-home-kv-row">
              <span className="cb-home-k">Origin</span>
              <span className="cb-home-v mono">{displaySite.origin}</span>
            </div>
          </div>

          <div className="cb-divider cb-divider-full" />

          <div className="cb-home-form">
            <div className="cb-home-field">
              <label className="cb-home-label" htmlFor="cb_del_type">
                To confirm, type the `origin` exactly:
              </label>
              <div className="cb-home-typehint">{required}</div>
              <input
                id="cb_del_type"
                className="cb-home-input danger"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type the origin to confirm"
                autoComplete="off"
              />
            </div>

            <label className="cb-home-check">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand this will remove the website and detach ALL monitoring context.</span>
            </label>
          </div>
        </div>

        <div className="cb-divider cb-divider-full" />

        <div className="cb-home-modal-actions">
          <button className="cb-linkpill" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="cb-linkpill"
            type="button"
            disabled={!ok}
            onClick={(event) => {
              event.stopPropagation();
              if (!ok) return;
              onConfirm("SAFE");
            }}
          >
            Remove site only
          </button>
          <button
            className="cb-linkpill cb-home-dangerbtn"
            type="button"
            disabled={!ok}
            onClick={(event) => {
              event.stopPropagation();
              if (!ok) return;
              onConfirm("DESTRUCTIVE");
            }}
          >
            Remove site + analytics
          </button>
        </div>
      </div>
    </div>
  );
}


function ManageWebsitesModal({
  open,
  onClose,
  activeSites,
  topSiteId,
  recentlyRemoved,
  recentlyLoading,
  recentlyError,
  restoringSiteId,
  onRestore,
  onDetach,
}: {
  open: boolean;
  onClose: () => void;
  activeSites: Site[];
  topSiteId: string;
  recentlyRemoved: RemovedSite[];
  recentlyLoading: boolean;
  recentlyError: string | null;
  restoringSiteId: string | null;
  onRestore: (siteId: string) => void;
  onDetach: (site: Site) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="cb-manage-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cb-manage-modal-title"
    >
      <div className="cb-manage-modal-backdrop" onClick={onClose} aria-hidden="true" />

      <div className="cb-manage-modal-panel" ref={panelRef}>
        <header className="cb-manage-modal-header">
          <div>
            <h2 id="cb-manage-modal-title" className="cb-manage-modal-title">
              Manage websites
            </h2>
            <div className="cb-manage-modal-sub">Monitoring targets for this workspace.</div>
          </div>
          <button
            type="button"
            className="cb-manage-modal-close"
            onClick={onClose}
            aria-label="Close manage websites"
            ref={closeButtonRef}
          >
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </header>

        <div className="cb-manage-modal-body">
          <section className="cb-manage-modal-section" aria-label="Active websites">
            <div className="cb-manage-modal-section-head">
              <div className="cb-manage-modal-section-title">Active websites</div>
              <div className="cb-manage-modal-section-sub">Currently monitored sites in this workspace.</div>
            </div>
            {activeSites.length === 0 ? (
              <div className="cb-manage-empty">No active sites.</div>
            ) : (
              <ul className="cb-manage-site-list">
                {activeSites.map((site) => (
                  <li className="cb-manage-site-row" key={site.id}>
                    <div className="cb-manage-site-info">
                      <span
                        className={`cb-manage-site-top ${site.id === topSiteId ? "is-top" : ""}`}
                        aria-hidden="true"
                      >
                        ★
                      </span>
                      <div>
                        <div className="cb-manage-site-label">{site.label}</div>
                        <div className="cb-manage-site-origin" title={site.origin}>
                          {originToLabel(site.origin)}
                        </div>
                        <div className="cb-manage-site-meta">Added {fmtTime(safeNumDate(site.createdAt))}</div>
                      </div>
                    </div>
                    <div className="cb-manage-site-actions">
                      <button
                        type="button"
                        className="cb-linkpill cb-linkpill-ghost"
                        onClick={() => onDetach(site)}
                      >
                        Detach
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cb-manage-modal-section" aria-label="Recently removed">
            <div className="cb-manage-modal-section-head">
              <div className="cb-manage-modal-section-title">Recently removed</div>
              <div className="cb-manage-modal-section-sub">Restore sites within the 30-day retention window.</div>
            </div>
            {recentlyLoading ? (
              <div className="cb-manage-empty">Loading…</div>
            ) : recentlyError ? (
              <div className="cb-home-alert" role="alert">
                {recentlyError}
              </div>
            ) : recentlyRemoved.length === 0 ? (
              <div className="cb-manage-empty">No recently removed sites.</div>
            ) : (
              <ul className="cb-manage-site-list">
                {recentlyRemoved.map((entry) => {
                  const days = daysUntil(entry.purgeAt);
                  const daysLabel =
                    days === null ? "—" : days <= 0 ? "<1 day" : `${days} day${days === 1 ? "" : "s"}`;
                  return (
                    <li className="cb-manage-site-row" key={entry.siteId}>
                      <div className="cb-manage-site-info">
                        <div>
                          <div className="cb-manage-site-label">{entry.origin}</div>
                          <div className="cb-manage-site-meta">
                            Removed {fmtTime(safeNumDate(entry.removedAt))} · Permanently deleted in {daysLabel}
                          </div>
                        </div>
                      </div>
                      <div className="cb-manage-site-actions">
                        <button
                          type="button"
                          className="cb-linkpill cb-linkpill-lime"
                          disabled={restoringSiteId === entry.siteId}
                          onClick={() => onRestore(entry.siteId)}
                        >
                          {restoringSiteId === entry.siteId ? "Restoring…" : "Restore site"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="cb-manage-modal-footer">
          Removed sites are retained for 30 days before permanent deletion.
        </div>
      </div>
    </div>
  );
}
