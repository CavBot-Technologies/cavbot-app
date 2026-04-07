// components/AppShell.tsx
"use client";


import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { CavPadDock } from "./CavPad";
import type { CavPadSite } from "./CavPad";
import { CavGuardModal } from "./CavGuardModal";
import { CavBotVerifyModal } from "./CavBotVerifyModal";
import CavAiCenterLauncher, { type AiCenterSurface } from "@/components/cavai/CavAiCenterLauncher";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { LockIcon } from "@/components/LockIcon";
import { playCavbotTone, normalizeTone, preloadCavbotTone } from "@/lib/cavbotTone";
import {
  recordClickIntent,
  recordNavigationStart,
  shouldEnableRoutePerf,
  traceRenderCount,
} from "@/lib/dev/routePerf";
import {
  NotificationFilter,
  NotificationRaw,
  NotificationRow,
  NOTIFICATION_FILTERS,
  filterNotifications,
  isBackendOnlyNotificationRaw,
  mapRawNotification,
} from "@/lib/notifications";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import { CAV_GUARD_DECISION_EVENT, emitGuardDecisionFromPayload, readGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import { normalizeGuardReturnPath } from "@/src/lib/cavguard/cavGuard.return";
import type { CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";
import { buildCavAiRouteContextPayload, resolveCavAiRouteAwareness } from "@/lib/cavai/pageAwareness";
import { buildCanonicalPublicProfileHref, openCanonicalPublicProfileWindow } from "@/lib/publicProfile/url";
import {
  isCavbotFounderIdentity,
  normalizeCavbotFounderProfile,
} from "@/lib/profileIdentity";

type WindowWithGlobals = Window & {
  __CB_NOTIF_SETTINGS__?: Record<string, unknown> | null;
  __CAVBOT_CONSOLE_RANGE__?: string;
  __CAVBOT_CONSOLE_API_RANGE__?: string;
};

function SearchParamsBridge({ onChange }: { onChange: (serialized: string) => void }) {
  const sp = useSearchParams();
  const serialized = sp?.toString() ?? "";

  useEffect(() => {
    onChange(serialized);
  }, [serialized, onChange]);

  return null;
}


/**
 * CavBot AppShell — Launch-ready wiring
 * - Tier/trial from /api/auth/me
 * - Range persisted (no URL writes)
 * - Global lock resets on nav (Cmd+R snake killer)
 * - Notifications: unread bubble + incoming toast + dropdown feed + mark-read + fade-out
 * - Mark all as read wired to /api/notifications/read-all
 */


type NavItem = {
  href: string;
  label: string;
  hint: string;
  required?: "FREE" | "PREMIUM" | "PREMIUM_PLUS";
};


type RangeKey = "24h" | "7d" | "30d";
type PlanTier = "FREE" | "PREMIUM" | "PREMIUM_PLUS";
type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | null;
type PlanSnapshot = {
  planTier: PlanTier;
  memberRole: MemberRole;
  trialActive: boolean;
  trialDaysLeft: number;
  ts: number;
};

const SHELL_PLAN_SNAPSHOT_KEY = "cb_shell_plan_snapshot_v1";
const PLAN_CONTEXT_KEY = "cb_plan_context_v1";
let shellPlanSnapshotCache: PlanSnapshot | null = null;

function coercePlanTier(input: unknown): PlanTier {
  const value = String(input || "").trim().toUpperCase();
  if (value === "PREMIUM_PLUS" || value === "PREMIUM+" || value === "PLUS") return "PREMIUM_PLUS";
  if (value === "PREMIUM" || value === "PRO" || value === "PAID") return "PREMIUM";
  return "FREE";
}

function coerceMemberRole(input: unknown): MemberRole {
  const value = String(input || "").trim().toUpperCase();
  if (value === "OWNER" || value === "ADMIN" || value === "MEMBER") return value;
  return null;
}

function normalizeSnapshot(input: unknown): PlanSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const planTier = coercePlanTier(row.planTier);
  const memberRole = coerceMemberRole(row.memberRole);
  const trialActive = Boolean(row.trialActive);
  const daysRaw = Number(row.trialDaysLeft);
  const trialDaysLeft = trialActive && Number.isFinite(daysRaw) && daysRaw > 0
    ? clampInt(daysRaw, 0, 365)
    : 0;
  const tsRaw = Number(row.ts);
  const ts = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : Date.now();
  return { planTier, memberRole, trialActive, trialDaysLeft, ts };
}

function readLegacyPlanContextSnapshot(): PlanSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = globalThis.__cbLocalStore.getItem(PLAN_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      planKey?: string;
      planLabel?: string;
      trialActive?: boolean;
    } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const planTier = coercePlanTier(parsed.planKey || parsed.planLabel);
    return {
      planTier,
      memberRole: null,
      trialActive: Boolean(parsed.trialActive),
      trialDaysLeft: 0,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

function readShellPlanSnapshot(): PlanSnapshot | null {
  if (shellPlanSnapshotCache) return shellPlanSnapshotCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = globalThis.__cbLocalStore.getItem(SHELL_PLAN_SNAPSHOT_KEY);
    const parsed = raw ? normalizeSnapshot(JSON.parse(raw)) : null;
    if (parsed) {
      shellPlanSnapshotCache = parsed;
      return parsed;
    }
  } catch {}

  const legacy = readLegacyPlanContextSnapshot();
  if (legacy) {
    shellPlanSnapshotCache = legacy;
    return legacy;
  }
  return null;
}

function persistShellPlanSnapshot(snapshot: PlanSnapshot) {
  shellPlanSnapshotCache = snapshot;
  if (typeof window === "undefined") return;
  try {
    globalThis.__cbLocalStore.setItem(SHELL_PLAN_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {}
}

function toPlanContextDetail(planTier: PlanTier, trialActive: boolean) {
  return {
    planKey: planTier === "PREMIUM_PLUS" ? "premium_plus" : planTier === "PREMIUM" ? "premium" : "free",
    planLabel: planTier === "PREMIUM_PLUS" ? "PREMIUM+" : planTier === "PREMIUM" ? "PREMIUM" : "FREE",
    trialActive,
  };
}


function planRank(t: PlanTier) {
  if (t === "PREMIUM_PLUS") return 2;
  if (t === "PREMIUM") return 1;
  return 0;
}


function canAccess(current: PlanTier, required: "FREE" | "PREMIUM" | "PREMIUM_PLUS") {
  return planRank(current) >= planRank(required as PlanTier);
}


function toApiRange(r: RangeKey): "7d" | "30d" {
  return r === "30d" ? "30d" : "7d";
}



function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}


function parseDateMs(v: unknown): number | null {
  try {
    const d = new Date(String(v));
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function firstInitialChar(input: string): string {
  const hit = String(input || "").match(/[A-Za-z0-9]/);
  return hit?.[0]?.toUpperCase() || "";
}

function normalizeInitialUsernameSource(rawUsername: string): string {
  const trimmed = String(rawUsername || "").trim().replace(/^@+/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const pathname = new URL(trimmed).pathname;
    const parts = pathname.split("/").filter(Boolean);
    const tail = parts[parts.length - 1] || "";
    return tail.replace(/^@+/, "");
  } catch {
    return trimmed;
  }
}

function deriveAccountInitials(fullName?: string | null, username?: string | null, fallback?: string | null): string {
  const name = String(fullName || "").trim();
  if (name) {
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

  const userInitial = firstInitialChar(normalizeInitialUsernameSource(String(username || "")));
  if (userInitial) return userInitial;

  const fallbackInitial = firstInitialChar(String(fallback || ""));
  if (fallbackInitial) return fallbackInitial;
  return "C";
}

function readInitials(): string {
  try {
    const v = (globalThis.__cbLocalStore.getItem("cb_account_initials") || "").trim();
    if (v) return v.slice(0, 3).toUpperCase();
  } catch {}
  return "";
}

function persistAccountInitials(value: string) {
  try {
    if (value) {
      globalThis.__cbLocalStore.setItem("cb_account_initials", value);
    } else {
      globalThis.__cbLocalStore.removeItem("cb_account_initials");
    }
  } catch {}
}

function readPublicProfileEnabled(): boolean | null {
  try {
    const raw = (globalThis.__cbLocalStore.getItem("cb_profile_public_enabled_v1") || "").trim().toLowerCase();
    if (raw === "1" || raw === "true" || raw === "public") return true;
    if (raw === "0" || raw === "false" || raw === "private") return false;
  } catch {}
  return null;
}

export function DefaultAccountAvatarIcon() {
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" fill="none" aria-hidden="true">
      <circle cx="16" cy="11" r="6.3" fill="currentColor" opacity="0.95" />
      <path
        d="M7.5 26c0-5.5 4.3-9 8.5-9s8.5 3.5 8.5 9"
        fill="currentColor"
        opacity="0.8"
      />
    </svg>
  );
}


function readStoredRange(): RangeKey | null {
  try {
    const v = (globalThis.__cbLocalStore.getItem("cb_console_range") || "").trim();
    if (v === "24h" || v === "7d" || v === "30d") return v;
  } catch {}
  return null;
}


function deleteUrlParam(key: string) {
  try {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(key)) return;
    u.searchParams.delete(key);
    window.history.replaceState({}, "", u.toString());
  } catch {}
}


/* ===== KILL GLOBAL LOCKS (the Cmd+R snake) ===== */
function resetGlobalUiLocks() {
  try {
    const html = document.documentElement;
    const body = document.body;


    html.classList.add("cb-no-motion");
    body.classList.add("cb-no-motion");


    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    html.offsetHeight;


    html.style.removeProperty("overflow");
    html.style.removeProperty("overscroll-behavior");
    html.style.removeProperty("touch-action");
    html.style.removeProperty("pointer-events");
    html.style.removeProperty("position");
    html.style.removeProperty("transform");


    body.style.removeProperty("overflow");
    body.style.removeProperty("overscroll-behavior");
    body.style.removeProperty("touch-action");
    body.style.removeProperty("pointer-events");
    body.style.removeProperty("position");
    body.style.removeProperty("top");
    body.style.removeProperty("left");
    body.style.removeProperty("right");
    body.style.removeProperty("bottom");
    body.style.removeProperty("width");
    body.style.removeProperty("height");
    body.style.removeProperty("min-height");
    body.style.removeProperty("transform");
    body.style.removeProperty("padding-right");


    body.classList.remove("cb-console-lock", "cb-modal-open", "cb-modals-lock", "cb-home-delete-open", "modal-open", "is-locked");


    requestAnimationFrame(() => {
      html.classList.remove("cb-no-motion");
      body.classList.remove("cb-no-motion");
    });
  } catch {}
}


/**
 * Launch-safe tier resolver
 * Uses tierEffective first (PREMIUM_PLUS for ENTERPRISE + trials)
 * Falls back to tier if needed.
 */
type AccountTier = {
  tierEffective?: string | null;
  tier?: string | null;
};

function resolvePlanTierFromAccount(account: AccountTier): PlanTier {
  const rawEffective = String(account?.tierEffective || "").trim().toLowerCase();
  const rawTier = String(account?.tier || "").trim().toLowerCase();
  const s = rawEffective || rawTier;


  const isPlus =
    s.includes("premium_plus") ||
    s.includes("premium plus") ||
    s.includes("premium+") ||
    s.includes("plus");


  const isPremium =
    s.includes("premium") ||
    s.includes("pro") ||
    s.includes("paid") ||
    s.includes("enterprise"); // (if tierEffective not present)


  if (isPlus) return "PREMIUM_PLUS";
  if (isPremium) return "PREMIUM";
  return "FREE";
}


async function apiJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "include",
    cache: "no-store",
  });


  const data = (await res.json().catch(() => ({}))) as
    | (Record<string, unknown> & { ok?: boolean; message?: string; error?: string })
    | null;
  const guardDecision = readGuardDecisionFromPayload(data);
  if (!res.ok || data?.ok === false) {
    if (guardDecision) {
      emitGuardDecisionFromPayload(data);
    }
    const msg = data?.message || data?.error || "Request failed";
    throw Object.assign(new Error(String(msg)), { status: res.status, data, guardDecision });
  }
  return data as T;
}

type NotificationActionMeta = {
  key: string;
  label: string;
  href: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown> | null;
};

type NotificationJoinRole = "member" | "admin";

type NotificationShareMeta = {
  permissionLabel: string | null;
  expiresAtIso: string | null;
};

type VerifyActionType = "signup" | "login" | "reset" | "invite";

function normalizeNotificationActions(meta: Record<string, unknown> | null | undefined): NotificationActionMeta[] {
  if (!meta || typeof meta !== "object") return [];
  const actionsRaw = meta.actions;
  if (!actionsRaw || typeof actionsRaw !== "object" || Array.isArray(actionsRaw)) return [];

  const actions = actionsRaw as Record<string, unknown>;
  const out: NotificationActionMeta[] = [];

  for (const [rawKey, row] of Object.entries(actions)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const parsed = row as Record<string, unknown>;
    const href = String(parsed.href || "").trim();
    if (!href) continue;

    const label = String(parsed.label || "").trim();
    const methodRaw = String(parsed.method || "GET").trim().toUpperCase();
    const method = methodRaw === "POST" || methodRaw === "PATCH" || methodRaw === "DELETE"
      ? methodRaw
      : "GET";
    const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body)
      ? (parsed.body as Record<string, unknown>)
      : null;

    out.push({
      key,
      label: label || (
        key === "saveToCavCloud"
          ? "Save to CavCloud"
          : key === "openInCavCode"
            ? "Open in CavCode"
            : key === "decline"
              ? "Decline"
              : key === "accept"
                ? "Accept"
                : key === "approve"
                  ? "Approve"
                  : key === "deny"
                    ? "Deny"
                    : key === "requestAccess"
                      ? "Request access"
                      : "Open"
      ),
      href,
      method,
      body,
    });
  }

  return out;
}

function normalizeNotificationJoinRole(value: unknown): NotificationJoinRole {
  return String(value || "").trim().toLowerCase() === "admin" ? "admin" : "member";
}

function isWorkspaceJoinApprovalAction(action: NotificationActionMeta): boolean {
  if (!action || action.method === "GET") return false;
  const key = String(action.key || "").trim().toLowerCase();
  if (key !== "accept" && key !== "approve") return false;

  const href = String(action.href || "").trim().toLowerCase();
  if (!href) return false;
  if (href === "/api/invites/respond" || href === "/api/access-requests/respond") return true;
  if (href.includes("/api/workspaces/invites/") && href.endsWith("/accept")) return true;
  if (href.includes("/api/workspaces/access-requests/") && href.endsWith("/approve")) return true;
  return false;
}

function readNotificationShareMeta(meta: Record<string, unknown> | null | undefined): NotificationShareMeta {
  if (!meta || typeof meta !== "object") {
    return { permissionLabel: null, expiresAtIso: null };
  }
  const permissionLabelRaw = String(meta.permissionLabel || "").trim();
  const permissionRaw = String(meta.permission || "").trim().toUpperCase();
  const permissionLabel = permissionLabelRaw
    || (permissionRaw === "EDIT" ? "Collaborate" : permissionRaw === "VIEW" ? "Read-only" : "");

  const expiresAtIso = String(meta.expiresAtISO || "").trim();
  return {
    permissionLabel: permissionLabel || null,
    expiresAtIso: expiresAtIso || null,
  };
}

function formatNotificationExpiry(expiresAtIso: string | null | undefined): string {
  const value = String(expiresAtIso || "").trim();
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  const remainingMs = ts - Date.now();
  if (remainingMs <= 0) return "Expired";
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Expires in 1 day";
  return `Expires in ${days} days`;
}

export default function AppShell({
  title, // kept for compatibility (not shown in header)
  subtitle,
  hideTopbar,
  children,
}: {
  title?: string;
  subtitle?: string;
  hideTopbar?: boolean;
  children?: React.ReactNode;
}) {
  const [clientMounted, setClientMounted] = useState(false);
  useEffect(() => {
    setClientMounted(true);
  }, []);

  const pathname = usePathname();
  const isCavbotPage = pathname === "/cavbot";
  const router = useRouter();
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());
  const [searchParamsSerialized, setSearchParamsSerialized] = useState("");
  const perfLogging = useMemo(
    () => shouldEnableRoutePerf(searchParamsSerialized),
    [searchParamsSerialized],
  );
  const shellRenderCountRef = useRef(0);
  const sidebarRenderCountRef = useRef(0);

  shellRenderCountRef.current += 1;
  sidebarRenderCountRef.current += 1;

  const [badgeTone, setBadgeTone] = useState<"default" | "lime" | "red">("default");

  useEffect(() => {
    const handler = (event: Event) => {
      const tone = (event as CustomEvent).detail?.tone as "default" | "lime" | "red" | undefined;
      if (!tone) return setBadgeTone("default");
      setBadgeTone(tone);
    };
    window.addEventListener("cb:eye-tone", handler);
    return () => window.removeEventListener("cb:eye-tone", handler);
  }, []);

  // ===== Sidebar (mobile drawer) =====
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    traceRenderCount("AppShell", perfLogging, {
      pathname,
      renderCount: shellRenderCountRef.current,
    });
    traceRenderCount("AppShell.sidebar-nav", perfLogging, {
      pathname,
      renderCount: sidebarRenderCountRef.current,
      navOpen,
    });
  }, [navOpen, pathname, perfLogging]);


  // ===== Range (persisted only; NO URL WRITES) =====
  const [range, setRange] = useState<RangeKey>("24h");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [quickToolsOpen, setQuickToolsOpen] = useState(false);

  useEffect(() => {
    const stored = readStoredRange();
    if (stored) setRange(stored);
  }, []);


  // ===== Account dropdown =====
  const [accountOpen, setAccountOpen] = useState(false);
  const [initials, setInitials] = useState<string>("");
  const [profileFullName, setProfileFullName] = useState<string>("");
  const [profileUsername, setProfileUsername] = useState<string>("");
  const [profileAvatar, setProfileAvatar] = useState<string>("");
  const [profileTone, setProfileTone] = useState<string>("lime");
  const [profilePublicEnabled, setProfilePublicEnabled] = useState<boolean | null>(null);


  // ===== Notifications =====
  type NotifItem = NotificationRow;

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifView] = useState<"panel" | "modal" | "full">("panel");
  const [notifCount, setNotifCount] = useState(0);


  const [notifItems, setNotifItems] = useState<NotifItem[]>([]);


  const [notifFilter, setNotifFilter] = useState<NotificationFilter>("all");


  const [hiddenNotifIds, setHiddenNotifIds] = useState<string[]>([]);
  const hiddenNotifIdsRef = useRef<Set<string>>(new Set());
  const [notifActionBusyKey, setNotifActionBusyKey] = useState<string>("");
  const [notifActionErrorById, setNotifActionErrorById] = useState<Record<string, string>>({});
  const [notifActionRoleById, setNotifActionRoleById] = useState<Record<string, NotificationJoinRole>>({});


  const [notifToast, setNotifToast] = useState<{
    tone: "good" | "watch" | "bad";
    title: string;
    body?: string;
  } | null>(null);


  const notifToastTimer = useRef<number | null>(null);
  const lastUnreadRef = useRef<number | null>(null);
  const notifAudioUnlockedRef = useRef(false);

  const notifUnreadOnly = notifFilter === "unread";

  const filteredNotifItems = useMemo(
    () => filterNotifications(notifItems, notifFilter),
    [notifFilter, notifItems]
  );


  // ===== Plan widget (SIDEBAR footer) =====
  const [bootSnapshot] = useState<PlanSnapshot | null>(() => readShellPlanSnapshot());
  const [planTier, setPlanTier] = useState<PlanTier>(bootSnapshot?.planTier || "FREE");
  const [memberRole, setMemberRole] = useState<MemberRole>(bootSnapshot?.memberRole || null);
  const [planResolved, setPlanResolved] = useState<boolean>(Boolean(bootSnapshot));
  const [authPlanVerified, setAuthPlanVerified] = useState(false);
  const [, setPlanResolveError] = useState<string>("");


  // ===== Trial state (only affects the widget display) =====
  const [trialActive, setTrialActive] = useState<boolean>(Boolean(bootSnapshot?.trialActive));
  const [trialDaysLeft, setTrialDaysLeft] = useState<number>(bootSnapshot?.trialDaysLeft || 0);

  useEffect(() => {
    if (bootSnapshot) return;
    const cached = readShellPlanSnapshot();
    if (!cached) return;
    setPlanTier(cached.planTier);
    setMemberRole(cached.memberRole);
    setTrialActive(cached.trialActive);
    setTrialDaysLeft(cached.trialDaysLeft);
    setPlanResolved(true);
    setPlanResolveError("");
  }, [bootSnapshot]);

  useEffect(() => {
    if (!planResolved) return;
    persistShellPlanSnapshot({
      planTier,
      memberRole,
      trialActive,
      trialDaysLeft: trialActive ? clampInt(trialDaysLeft, 0, 365) : 0,
      ts: Date.now(),
    });
  }, [planTier, memberRole, trialActive, trialDaysLeft, planResolved]);


  const rangeWrapRef = useRef<HTMLDivElement | null>(null);
  const quickToolsWrapRef = useRef<HTMLDivElement | null>(null);
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const navScrollRef = useRef<HTMLElement | null>(null);
  const rangeOpenRef = useRef(false);
  const quickToolsOpenRef = useRef(false);
  const accountOpenRef = useRef(false);
  const notifOpenRef = useRef(false);
  const [navScrollIndicator, setNavScrollIndicator] = useState<"down" | "up">("down");
  const [cavPadOpen, setCavPadOpen] = useState(false);
  const [cavGuardModalOpen, setCavGuardModalOpen] = useState(false);
  const [cavGuardDecision, setCavGuardDecision] = useState<CavGuardDecision | null>(null);
  const cavGuardRetryRef = useRef<(() => void | Promise<void>) | null>(null);
  const cavGuardRetryUsedRef = useRef(false);
  const cavGuardDismissHrefRef = useRef<string | null>(null);
  const verifyResolverRef = useRef<((value: { ok: boolean }) => void) | null>(null);
  const [verifyRequest, setVerifyRequest] = useState<{
    actionType: VerifyActionType;
    route: string;
    reason: string;
  } | null>(null);
  const [arcadeCollaboratorAccessEnabled, setArcadeCollaboratorAccessEnabled] = useState(false);
  const commandCenterWarmRef = useRef(false);

  const prefetchRoute = useCallback(
    (href: string) => {
      const target = String(href || "").trim();
      if (!target) return;
      if (prefetchedRoutesRef.current.has(target)) return;
      prefetchedRoutesRef.current.add(target);
      try {
        router.prefetch(target);
      } catch {
        prefetchedRoutesRef.current.delete(target);
      }
    },
    [router]
  );

  const warmCommandCenter = useCallback(() => {
    if (commandCenterWarmRef.current) return;
    commandCenterWarmRef.current = true;

    prefetchRoute("/");
    prefetchRoute("/console");

    void fetch("/", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "x-cavbot-status-probe": "1" },
    }).catch(() => {});

    void Promise.allSettled([
      fetch("/api/auth/session", { method: "GET", credentials: "include", cache: "no-store" }),
      fetch("/api/workspaces", { method: "GET", credentials: "include", cache: "no-store" }),
      fetch("/api/settings/account", { method: "GET", credentials: "include", cache: "no-store" }),
    ]);
  }, [prefetchRoute]);

  const resetCavGuardModal = useCallback(() => {
    setCavGuardModalOpen(false);
    setCavGuardDecision(null);
    cavGuardRetryRef.current = null;
    cavGuardRetryUsedRef.current = false;
    cavGuardDismissHrefRef.current = null;
  }, []);

  const closeCavGuardModal = useCallback(() => {
    const dismissHref = normalizeGuardReturnPath(cavGuardDismissHrefRef.current);
    const currentHref = `${pathname}${searchParamsSerialized ? `?${searchParamsSerialized}` : ""}`;
    resetCavGuardModal();
    if (!dismissHref || dismissHref === currentHref) return;
    recordNavigationStart(dismissHref, "router.replace");
    router.replace(dismissHref);
  }, [pathname, resetCavGuardModal, router, searchParamsSerialized]);

  const requestCaverify = useCallback(
    (reason: string) =>
      new Promise<{ ok: boolean }>((resolve) => {
        verifyResolverRef.current = resolve;
        setVerifyRequest({
          actionType: "login",
          route: pathname || "/",
          reason: String(reason || "").trim() || "Verification required for this action.",
        });
      }),
    [pathname],
  );

  const closeVerifyModal = useCallback(() => {
    if (verifyResolverRef.current) {
      verifyResolverRef.current({ ok: false });
      verifyResolverRef.current = null;
    }
    setVerifyRequest(null);
  }, []);

  const completeVerifyModal = useCallback(() => {
    if (verifyResolverRef.current) {
      verifyResolverRef.current({ ok: true });
      verifyResolverRef.current = null;
    }
    setVerifyRequest(null);
  }, []);

  useEffect(() => {
    return () => {
      if (verifyResolverRef.current) {
        verifyResolverRef.current({ ok: false });
        verifyResolverRef.current = null;
      }
    };
  }, []);

  const openCavGuardDecision = useCallback(
    async (
      decision: CavGuardDecision,
      retryAction?: (() => void | Promise<void>) | null,
      dismissHref?: string | null,
    ) => {
      cavGuardRetryRef.current = retryAction || null;
      cavGuardRetryUsedRef.current = false;

      if (decision.stepUp?.kind === "CAVERIFY") {
        const result = await requestCaverify(decision.stepUp.reason);
        if (result.ok && cavGuardRetryRef.current && !cavGuardRetryUsedRef.current) {
          cavGuardRetryUsedRef.current = true;
          const retry = cavGuardRetryRef.current;
          cavGuardRetryRef.current = null;
          await Promise.resolve(retry());
          return;
        }
      }

      cavGuardDismissHrefRef.current = normalizeGuardReturnPath(dismissHref);
      setCavGuardDecision(decision);
      setCavGuardModalOpen(true);
    },
    [requestCaverify],
  );

  const openCavGuardByAction = useCallback(
    (
      actionId: string,
      options?: {
        flags?: Record<string, unknown> | null;
        role?: "OWNER" | "ADMIN" | "MEMBER" | "ANON" | null;
        plan?: PlanTier | null;
        retryAction?: (() => void | Promise<void>) | null;
        dismissHref?: string | null;
      },
    ) => {
      const decision = buildCavGuardDecision(actionId, {
        role: options?.role || memberRole || "ANON",
        plan: options?.plan || planTier,
        flags: options?.flags || null,
      });
      void openCavGuardDecision(
        decision,
        options?.retryAction || null,
        normalizeGuardReturnPath(options?.dismissHref),
      );
    },
    [memberRole, openCavGuardDecision, planTier],
  );

  useEffect(() => {
    function onGuardEvent(event: Event) {
      const detail = (event as CustomEvent<{ decision?: CavGuardDecision | null }>).detail || {};
      if (!detail.decision) return;
      void openCavGuardDecision(detail.decision);
    }

    window.addEventListener(CAV_GUARD_DECISION_EVENT, onGuardEvent as EventListener);
    return () => {
      window.removeEventListener(CAV_GUARD_DECISION_EVENT, onGuardEvent as EventListener);
    };
  }, [openCavGuardDecision]);

  const showCavPad = useMemo(() => {
    return !(
      pathname.startsWith("/cavtools") ||
      pathname.startsWith("/cavcode") ||
      pathname.startsWith("/cavcode-viewer") ||
      pathname.startsWith("/cavcloud")
    );
  }, [pathname]);

  const spLite = useMemo(() => new URLSearchParams(searchParamsSerialized), [searchParamsSerialized]);
  const projectParam = (spLite.get("project") || "").trim();
  const workspaceParam = (spLite.get("workspaceId") || spLite.get("workspace") || "").trim();
  const siteParam = (spLite.get("site") || "").trim();
  const aiProjectId = Number.isFinite(Number(projectParam)) && Number(projectParam) > 0 ? Number(projectParam) : null;
  const cavProjectId = Number.isFinite(Number(projectParam)) && Number(projectParam) > 0 ? Number(projectParam) : 1;
  const aiRouteAwareness = useMemo(
    () =>
      resolveCavAiRouteAwareness({
        pathname,
        search: searchParamsSerialized,
        workspaceId: workspaceParam || null,
        projectId: aiProjectId,
        siteId: siteParam || null,
      }),
    [aiProjectId, pathname, searchParamsSerialized, siteParam, workspaceParam]
  );
  const aiSurface = useMemo<AiCenterSurface>(() => aiRouteAwareness.surface, [aiRouteAwareness.surface]);
  const aiContextLabel = useMemo(() => aiRouteAwareness.contextLabel, [aiRouteAwareness.contextLabel]);
  const aiRouteContext = useMemo(() => buildCavAiRouteContextPayload(aiRouteAwareness), [aiRouteAwareness]);
  const aiExpandHref = useMemo(() => {
    const qp = new URLSearchParams();
    qp.set("surface", aiSurface);
    if (aiContextLabel) qp.set("context", aiContextLabel);
    if (workspaceParam) qp.set("workspaceId", workspaceParam);
    if (aiProjectId) qp.set("projectId", String(aiProjectId));
    return `/cavai?${qp.toString()}`;
  }, [aiContextLabel, aiProjectId, aiSurface, workspaceParam]);
  const aiLauncherInSidebar = aiSurface === "cavcloud" || aiSurface === "cavsafe";
  const cavSites: CavPadSite[] = [];
  const accountInitials = useMemo(
    () => deriveAccountInitials(profileFullName, profileUsername, initials),
    [initials, profileFullName, profileUsername]
  );
  const publicProfileHref = useMemo(() => {
    return buildCanonicalPublicProfileHref(profileUsername);
  }, [profileUsername]);
  const profileMenuLabel = profilePublicEnabled === null
    ? "Profile"
    : profilePublicEnabled
      ? "Public Profile"
      : "Private Profile";
  const profileDisplayName = useMemo(() => {
    const normalized = normalizeCavbotFounderProfile({
      fullName: profileFullName,
      displayName: profileFullName,
      username: profileUsername,
    });
    const full = String(normalized.fullName || normalized.displayName || "").trim();
    if (full) return full;
    const handle = String(normalized.username || profileUsername || "").trim().replace(/^@+/, "");
    return handle ? `@${handle}` : "CavBot Account";
  }, [profileFullName, profileUsername]);
  const founderProfileShowsPremiumPlus = useMemo(() => {
    return isCavbotFounderIdentity({
      fullName: profileDisplayName,
      displayName: profileDisplayName,
      username: profileUsername,
    });
  }, [profileDisplayName, profileUsername]);
  const profileShowsPremiumPlus = planTier === "PREMIUM_PLUS" || founderProfileShowsPremiumPlus;
  const profilePlanLabel = useMemo(() => {
    if (trialActive && trialDaysLeft > 0 && !profileShowsPremiumPlus) return "FREE TRIAL";
    if (profileShowsPremiumPlus) return "PREMIUM+";
    if (planTier === "PREMIUM") return "PREMIUM PLAN";
    return "FREE TIER";
  }, [planTier, profileShowsPremiumPlus, trialActive, trialDaysLeft]);
  const planMenuLabel = profileShowsPremiumPlus ? "See Plans" : "Upgrade Plan";


  // On mount: kill any leftover params you DO NOT want
  useEffect(() => {
    deleteUrlParam("ws");
    deleteUrlParam("range");
    deleteUrlParam("apiRange");
  }, []);

  useEffect(() => {
    const hasGuardReturnParam = spLite.has("guardReturn");
    const guardReturnPath = normalizeGuardReturnPath(spLite.get("guardReturn"));

    const raw = String(spLite.get("settings") || "").trim().toLowerCase();
    if (raw === "owneronly" || raw === "owner_only") {
      openCavGuardByAction("SETTINGS_OWNER_ONLY", {
        flags: { settingsSurface: "CavBot" },
        dismissHref: guardReturnPath,
      });
      deleteUrlParam("settings");
    }

    const cavsafe = String(spLite.get("cavsafe") || "").trim().toLowerCase();
    if (cavsafe === "owneronly" || cavsafe === "owner_only") {
      openCavGuardByAction("CAVSAFE_OWNER_ONLY", { dismissHref: guardReturnPath });
      deleteUrlParam("cavsafe");
    } else if (cavsafe === "upgrade") {
      openCavGuardByAction("CAVSAFE_PLAN_REQUIRED", { plan: "FREE", dismissHref: guardReturnPath });
      deleteUrlParam("cavsafe");
    }

    const guardAction = String(spLite.get("guardAction") || "").trim();
    if (guardAction) {
      const surface = String(spLite.get("guardSurface") || "").trim();
      openCavGuardByAction(guardAction, {
        flags: surface ? { settingsSurface: surface } : null,
        dismissHref: guardReturnPath,
      });
      deleteUrlParam("guardAction");
      deleteUrlParam("guardSurface");
    }

    const arcade = String(spLite.get("arcade") || "").trim().toLowerCase();
    if (arcade === "blocked") {
      openCavGuardByAction("ARCADE_ACCESS_BLOCKED", { dismissHref: guardReturnPath });
      deleteUrlParam("arcade");
    }

    if (hasGuardReturnParam) {
      deleteUrlParam("guardReturn");
    }
  }, [openCavGuardByAction, spLite]);

  useEffect(() => {
    setCavPadOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onOpenCavPadFromPriority() {
      if (!(showCavPad && authPlanVerified && memberRole)) return;
      setCavPadOpen(true);
    }

    window.addEventListener(
      "cb:cavpad:create-note-from-priority",
      onOpenCavPadFromPriority as EventListener
    );
    return () => {
      window.removeEventListener(
        "cb:cavpad:create-note-from-priority",
        onOpenCavPadFromPriority as EventListener
      );
    };
  }, [authPlanVerified, memberRole, showCavPad]);

  useEffect(() => {
    const warmRoutes = [
      "/",
      "/console",
      "/errors",
      "/seo",
      "/routes",
      "/a11y",
      "/insights",
      "/404-control-room",
      "/plan",
      "/settings",
      "/settings?tab=account",
      "/settings?tab=team",
      "/settings?tab=collaboration",
      "/settings?tab=security",
      "/settings?tab=notifications",
      "/settings?tab=billing",
      "/settings?tab=api",
      "/settings?tab=history",
      "/settings/integrations",
      "/notifications",
      "/cavbot-arcade",
      "/auth?mode=login",
    ];
    const queue = [...warmRoutes];
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleId: number | null = null;
    let timerId: number | null = null;
    let cancelled = false;

    const drainQueue = () => {
      if (cancelled) return;
      const nextBatch = queue.splice(0, 4);
      nextBatch.forEach((href) => prefetchRoute(href));
      if (!queue.length || cancelled) return;
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleId = idleWindow.requestIdleCallback(() => {
          drainQueue();
        }, { timeout: 1800 });
      } else {
        timerId = window.setTimeout(() => {
          drainQueue();
        }, 220);
      }
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleId = idleWindow.requestIdleCallback(() => {
        drainQueue();
      }, { timeout: 1200 });
    } else {
      timerId = window.setTimeout(() => {
        drainQueue();
      }, 220);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [prefetchRoute]);

  useEffect(() => {
    if (!pathname.startsWith("/settings")) return;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const idleId = idleWindow.requestIdleCallback(() => {
        warmCommandCenter();
      }, { timeout: 2400 });
      return () => {
        if (typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(idleId);
        }
      };
    }

    const timer = window.setTimeout(() => {
      warmCommandCenter();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [pathname, warmCommandCenter]);

  // ==========================
// Notification settings bridge (from Settings page)
// ==========================
  useEffect(() => {
    function onSettings(event: CustomEvent<Record<string, unknown> | null>) {
      try {
        const detail = event?.detail || null;
        (window as WindowWithGlobals).__CB_NOTIF_SETTINGS__ = detail;
        const soundEnabled = detail?.sound !== false;
        const fallbackTone = soundEnabled ? "cavbot-chime" : "cavbot-vibrate-calm";
        const tone = normalizeTone(detail?.alertTone ?? fallbackTone) || "cavbot-chime";
        preloadCavbotTone(tone);
      } catch {}
    }

    window.addEventListener("cb:notification-settings", onSettings as EventListener);
    return () => window.removeEventListener("cb:notification-settings", onSettings as EventListener);
  }, []);

  useEffect(() => {
    function primeToneFromSettings() {
      try {
        const prefs = (window as WindowWithGlobals).__CB_NOTIF_SETTINGS__ || null;
        const soundEnabled = prefs?.sound !== false;
        const fallbackTone = soundEnabled ? "cavbot-chime" : "cavbot-vibrate-calm";
        const tone = normalizeTone(prefs?.alertTone ?? fallbackTone) || "cavbot-chime";
        preloadCavbotTone(tone);
      } catch {}
    }

    function unlockAudio() {
      if (notifAudioUnlockedRef.current) return;
      notifAudioUnlockedRef.current = true;
      primeToneFromSettings();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    }

    primeToneFromSettings();
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio, { passive: true });
    window.addEventListener("touchstart", unlockAudio, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);


  useEffect(() => {
    function onProfile(event: Event) {
      try {
        const d = (event as CustomEvent<Record<string, unknown>>).detail || {};
        const detailFullName = typeof d.fullName === "string" ? d.fullName.trim() : null;
        const detailUsername = typeof d.username === "string" ? d.username.trim().toLowerCase() : null;

        if (detailFullName !== null) setProfileFullName(detailFullName);
        if (detailUsername !== null) setProfileUsername(detailUsername);

        if (typeof d.initials === "string" || detailFullName !== null || detailUsername !== null) {
          const fallback = typeof d.initials === "string" ? d.initials : readInitials();
          const resolved = deriveAccountInitials(detailFullName, detailUsername, fallback);
          setInitials(resolved);
          persistAccountInitials(resolved);
        }


        if (typeof d.tone === "string") setProfileTone(d.tone);
        if (typeof d.avatarImage === "string") setProfileAvatar(d.avatarImage);
        if (d.avatarImage === null) setProfileAvatar("");
        if (typeof d.publicProfileEnabled === "boolean") setProfilePublicEnabled(d.publicProfileEnabled);
      } catch {}
    }


    window.addEventListener("cb:profile", onProfile);
    return () => window.removeEventListener("cb:profile", onProfile);
  }, []);


  // ===== ALWAYS RESET GLOBAL LOCKS ON NAV (fixes "needs Cmd+R") =====
  useEffect(() => {
    resetGlobalUiLocks();
  }, [pathname]);


  // ===== Also reset on BFCache restore + focus/visibility =====
  useEffect(() => {
    const onPageShow = () => resetGlobalUiLocks();
    const onFocus = () => resetGlobalUiLocks();


    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);


    const onVis = () => {
      if (!document.hidden) resetGlobalUiLocks();
    };
    document.addEventListener("visibilitychange", onVis);


    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Root-cause fix (A1): never hard-refresh the shell on route entry.


  useEffect(() => {
    setNavOpen(false);
    setRangeOpen(false);
    setQuickToolsOpen(false);
    setAccountOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!clientMounted) return;
    const navEl = navScrollRef.current;
    if (!navEl) return;

    const EDGE_EPSILON_PX = 2;
    let raf = 0;
    let latchedIndicator: "down" | "up" = "down";
    const sideEl = navEl.closest(".cb-sidebar") as HTMLElement | null;

    const updateIndicator = () => {
      const navScrollable = navEl.scrollHeight - navEl.clientHeight > EDGE_EPSILON_PX;
      const sideScrollable = Boolean(sideEl && sideEl.scrollHeight - sideEl.clientHeight > EDGE_EPSILON_PX);
      if (!navScrollable && !sideScrollable) {
        latchedIndicator = "down";
        setNavScrollIndicator("down");
        return;
      }

      const links = navEl.querySelectorAll("a.cb-nav-link");
      const firstNavLink = links[0] as HTMLElement | undefined;
      const lastNavLink = links[links.length - 1] as HTMLElement | undefined;
      if (!firstNavLink || !lastNavLink) {
        latchedIndicator = "down";
        setNavScrollIndicator("down");
        return;
      }

      const navTop = Math.max(0, Number(navEl.scrollTop) || 0);
      const navMax = Math.max(0, navEl.scrollHeight - navEl.clientHeight);
      const sideTop = Math.max(0, Number(sideEl?.scrollTop || 0));
      const sideMax = Math.max(0, (sideEl?.scrollHeight || 0) - (sideEl?.clientHeight || 0));

      const navRect = navEl.getBoundingClientRect();
      const firstRect = firstNavLink.getBoundingClientRect();
      const lastRect = lastNavLink.getBoundingClientRect();
      const atTopByScroll = navTop <= EDGE_EPSILON_PX && sideTop <= EDGE_EPSILON_PX;
      const atTopByGeometry = firstRect.top >= navRect.top - EDGE_EPSILON_PX;
      const atTop = atTopByScroll || atTopByGeometry;
      const atEndByScroll =
        (navMax > EDGE_EPSILON_PX && navTop >= navMax - EDGE_EPSILON_PX) ||
        (sideMax > EDGE_EPSILON_PX && sideTop >= sideMax - EDGE_EPSILON_PX);
      const atEndByGeometry = lastRect.top <= navRect.bottom - EDGE_EPSILON_PX;
      const atEnd = atEndByScroll || atEndByGeometry;

      if (atEnd) {
        if (latchedIndicator !== "up") {
          latchedIndicator = "up";
          setNavScrollIndicator("up");
        }
        return;
      }

      if (atTop) {
        if (latchedIndicator !== "down") {
          latchedIndicator = "down";
          setNavScrollIndicator("down");
        }
      }
    };

    const scheduleIndicatorUpdate = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateIndicator();
      });
    };

    navEl.addEventListener("scroll", scheduleIndicatorUpdate, { passive: true });
    if (sideEl) sideEl.addEventListener("scroll", scheduleIndicatorUpdate, { passive: true });
    navEl.addEventListener("wheel", scheduleIndicatorUpdate, { passive: true });
    if (sideEl) sideEl.addEventListener("wheel", scheduleIndicatorUpdate, { passive: true });
    navEl.addEventListener("touchmove", scheduleIndicatorUpdate, { passive: true });
    if (sideEl) sideEl.addEventListener("touchmove", scheduleIndicatorUpdate, { passive: true });
    window.addEventListener("resize", scheduleIndicatorUpdate);

    let resizeObserver: ResizeObserver | null = null;
    let sideResizeObserver: ResizeObserver | null = null;
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => scheduleIndicatorUpdate());
      resizeObserver.observe(navEl);
      if (sideEl) {
        sideResizeObserver = new ResizeObserver(() => scheduleIndicatorUpdate());
        sideResizeObserver.observe(sideEl);
      }
    }
    const pollTimer = window.setInterval(scheduleIndicatorUpdate, 180);

    scheduleIndicatorUpdate();
    return () => {
      navEl.removeEventListener("scroll", scheduleIndicatorUpdate);
      if (sideEl) sideEl.removeEventListener("scroll", scheduleIndicatorUpdate);
      navEl.removeEventListener("wheel", scheduleIndicatorUpdate);
      if (sideEl) sideEl.removeEventListener("wheel", scheduleIndicatorUpdate);
      navEl.removeEventListener("touchmove", scheduleIndicatorUpdate);
      if (sideEl) sideEl.removeEventListener("touchmove", scheduleIndicatorUpdate);
      window.removeEventListener("resize", scheduleIndicatorUpdate);
      window.clearInterval(pollTimer);
      if (raf) window.cancelAnimationFrame(raf);
      if (resizeObserver) resizeObserver.disconnect();
      if (sideResizeObserver) sideResizeObserver.disconnect();
    };
  }, [clientMounted, navOpen, pathname]);


  const nav: NavItem[] = useMemo(
    () => [
      { href: "/", label: "Command Center", hint: "Notifications + Manage URLs", required: "FREE" },
      { href: "/console", label: "Dashboard", hint: "Overall health + events", required: "FREE" },


      // PREMIUM unlocks
      { href: "/errors", label: "Error Intelligence", hint: "JS + API stability", required: "PREMIUM" },
      { href: "/seo", label: "Seo Performance", hint: "Indexing posture + structure", required: "PREMIUM" },


      { href: "/routes", label: "Routing", hint: "Discovery + crawl paths", required: "FREE" },


      // PREMIUM PLUS unlocks
      { href: "/a11y", label: "A11y Snapshot", hint: "Audits + Contrast", required: "PREMIUM_PLUS" },
      { href: "/insights", label: "CavBot Insights", hint: "Trends + diagnostics", required: "PREMIUM_PLUS" },


      { href: "/404-control-room", label: "Control Room", hint: "Gameplay + leaderboard", required: "FREE" },
    ],
    []
  );


  useEffect(() => {
    try {
      const cachedIdentity = normalizeCavbotFounderProfile({
        fullName: (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim(),
        displayName: (globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim(),
        username: (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim().toLowerCase(),
      });
      const cachedFullName = String(cachedIdentity.fullName || cachedIdentity.displayName || "").trim();
      const cachedUsername = String(cachedIdentity.username || "").trim().toLowerCase();
      const cachedInitials = readInitials();
      const t = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "lime").trim();
      const img = (globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim();
      const publicEnabled = readPublicProfileEnabled();

      setProfileFullName(cachedFullName);
      setProfileUsername(cachedUsername);
      const resolved = deriveAccountInitials(cachedFullName, cachedUsername, cachedInitials);
      setInitials(resolved);
      persistAccountInitials(resolved);

      setProfileTone(t || "lime");
      setProfileAvatar(img || "");
      if (publicEnabled !== null) setProfilePublicEnabled(publicEnabled);
    } catch {}
  }, []);


  /**
   * AUTH + PLAN WIRING (FULL)
   * - Uses tierEffective (returned by /api/auth/me)
   * - Trial state uses explicit flags OR computed from endsAt
   */
  const refreshAuthAndPlan = useCallback(async (signal?: AbortSignal) => {
    try {
      setPlanResolveError("");
      const res = await fetch("/api/auth/me", {
        method: "GET",
        cache: "no-store",
        signal,
      });

      const data = await res.json().catch(() => ({}));
      if (signal?.aborted) return;
      setAuthPlanVerified(true);

      // Initials: full name (first two names) -> username first letter.
      const normalizedProfile = normalizeCavbotFounderProfile({
        fullName: data?.user?.fullName ?? data?.user?.displayName ?? data?.profile?.fullName ?? data?.profile?.displayName,
        displayName: data?.user?.displayName ?? data?.profile?.displayName,
        username: data?.user?.username ?? data?.profile?.username,
      });
      const nextFullName = String(normalizedProfile.fullName || normalizedProfile.displayName || "").trim();
      const nextUsername = String(normalizedProfile.username || "").trim().toLowerCase();
      const nextInitials = deriveAccountInitials(nextFullName, nextUsername, String(data?.user?.initials || ""));
      if (res.ok && data?.ok) {
        setProfileFullName(nextFullName);
        setProfileUsername(nextUsername);
        setInitials(nextInitials);
        persistAccountInitials(nextInitials);
        try {
          globalThis.__cbLocalStore.setItem("cb_profile_fullName_v1", nextFullName);
          globalThis.__cbLocalStore.setItem("cb_profile_username_v1", nextUsername);
          if (typeof data?.user?.publicProfileEnabled === "boolean") {
            globalThis.__cbLocalStore.setItem(
              "cb_profile_public_enabled_v1",
              data.user.publicProfileEnabled ? "true" : "false",
            );
          }
          window.dispatchEvent(
            new CustomEvent("cb:profile", {
              detail: {
                fullName: nextFullName,
                username: nextUsername,
                initials: nextInitials,
              },
            }),
          );
        } catch {}
        if (typeof data?.user?.publicProfileEnabled === "boolean") {
          setProfilePublicEnabled(data.user.publicProfileEnabled);
        }
      }

      // Tier: prefer tierEffective
      const nextTier = resolvePlanTierFromAccount(data?.account);
      setPlanTier(nextTier);
      const rawMemberRole = String(data?.membership?.role || "").trim().toUpperCase();
      const nextMemberRole: MemberRole =
        rawMemberRole === "OWNER" || rawMemberRole === "ADMIN" || rawMemberRole === "MEMBER"
          ? rawMemberRole
          : null;
      setMemberRole(nextMemberRole);
      setArcadeCollaboratorAccessEnabled(
        Boolean(
          data?.policy?.allowArcadeCollaboratorAccess
          || data?.policy?.enableContributorLinks
          || data?.arcadeAccess?.collaboratorAccessEnabled
        ),
      );

      // ===== TRIAL DETECTION (supports multiple API shapes) =====
      const directDays =
        Number(data?.account?.trialDaysLeft) || Number(data?.account?.trial?.daysLeft) || 0;

      const endsAtMs =
        parseDateMs(data?.account?.trialEndsAt) ?? parseDateMs(data?.account?.trial?.endsAt);

      let computedDaysLeft = 0;

      if (Number.isFinite(directDays) && directDays > 0) {
        computedDaysLeft = clampInt(directDays, 0, 365);
      } else if (endsAtMs) {
        const now = Date.now();
        const diff = endsAtMs - now;
        computedDaysLeft = diff > 0 ? Math.ceil(diff / 86400000) : 0;
        computedDaysLeft = clampInt(computedDaysLeft, 0, 365);
      }

      const explicitTrial =
        Boolean(data?.account?.trialActive) ||
        Boolean(data?.account?.trial?.active) ||
        Boolean(data?.account?.trialSeatActive); // DB field

      const nextTrialActive = (explicitTrial || computedDaysLeft > 0) && computedDaysLeft > 0;
      const nextTrialDaysLeft = nextTrialActive ? computedDaysLeft : 0;

      setTrialActive(nextTrialActive);
      setTrialDaysLeft(nextTrialDaysLeft);
      setPlanResolved(true);
      setPlanResolveError("");

      persistShellPlanSnapshot({
        planTier: nextTier,
        memberRole: nextMemberRole,
        trialActive: nextTrialActive,
        trialDaysLeft: nextTrialDaysLeft,
        ts: Date.now(),
      });
      try {
        const planDetail = toPlanContextDetail(nextTier, nextTrialActive);
        globalThis.__cbLocalStore.setItem(PLAN_CONTEXT_KEY, JSON.stringify(planDetail));
        window.dispatchEvent(new CustomEvent("cb:plan", { detail: planDetail }));
      } catch {}
    } catch {
      if (signal?.aborted) return;
      setAuthPlanVerified(false);
      const cached = readShellPlanSnapshot();
      if (cached) {
        setPlanTier(cached.planTier);
        setMemberRole(cached.memberRole);
        setTrialActive(cached.trialActive);
        setTrialDaysLeft(cached.trialDaysLeft);
        setPlanResolved(true);
        setPlanResolveError("");
        return;
      }
      setPlanResolveError("Unable to verify current plan.");
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void refreshAuthAndPlan(ctrl.signal);
    return () => {
      try {
        ctrl.abort();
      } catch {}
    };
  }, [refreshAuthAndPlan]);

  useEffect(() => {
    const onRefresh = () => {
      void refreshAuthAndPlan();
    };
    window.addEventListener("cb:auth:refresh", onRefresh as EventListener);
    return () => {
      window.removeEventListener("cb:auth:refresh", onRefresh as EventListener);
    };
  }, [refreshAuthAndPlan]);


  // Persist + publish range changes (NO URL WRITE)
  useEffect(() => {
    try {
      globalThis.__cbLocalStore.setItem("cb_console_range", range);
    } catch {}


    try {
      const globalWindow = window as WindowWithGlobals;
      globalWindow.__CAVBOT_CONSOLE_RANGE__ = range;
      globalWindow.__CAVBOT_CONSOLE_API_RANGE__ = toApiRange(range);
    } catch {}


    try {
      window.cavbotAnalytics?.trackConsole?.("cavbot_console_range_change", {
        range,
        apiRange: toApiRange(range),
      });
    } catch {}
  }, [range]);

  useEffect(() => {
    rangeOpenRef.current = rangeOpen;
  }, [rangeOpen]);

  useEffect(() => {
    quickToolsOpenRef.current = quickToolsOpen;
  }, [quickToolsOpen]);

  useEffect(() => {
    accountOpenRef.current = accountOpen;
  }, [accountOpen]);

  useEffect(() => {
    notifOpenRef.current = notifOpen;
  }, [notifOpen]);


  // Click outside to close menus
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;


      if (rangeOpenRef.current && rangeWrapRef.current && !rangeWrapRef.current.contains(t)) setRangeOpen(false);
      if (quickToolsOpenRef.current && quickToolsWrapRef.current && !quickToolsWrapRef.current.contains(t))
        setQuickToolsOpen(false);
      if (accountOpenRef.current && accountWrapRef.current && !accountWrapRef.current.contains(t))
        setAccountOpen(false);
      if (notifOpenRef.current && notifWrapRef.current && !notifWrapRef.current.contains(t)) setNotifOpen(false);
    }


    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNavOpen(false);
        setRangeOpen(false);
        setQuickToolsOpen(false);
        setAccountOpen(false);
        setNotifOpen(false);
        setCavGuardModalOpen(false);
        setCavGuardDecision(null);
        cavGuardRetryRef.current = null;
        cavGuardRetryUsedRef.current = false;
        cavGuardDismissHrefRef.current = null;
      }
    }


    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, []);


  const upgradeHref = "/plan";


  const isActive = (href: string) => {
    return pathname === href;
  };

  function onNavItemClick(item: NavItem) {
    setNavOpen(false);
    prefetchRoute(item.href);
    return;
  }

  function onSettingsClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    setNavOpen(false);
    setQuickToolsOpen(false);
    prefetchRoute("/settings");
    prefetchRoute("/settings?tab=account");
    prefetchRoute("/settings/integrations");
    if (!memberRole || memberRole === "OWNER") return;
    // if (memberRole && memberRole !== "OWNER")
    event.preventDefault();
    openCavGuardByAction("SETTINGS_OWNER_ONLY", { flags: { settingsSurface: "CavBot" } });
  }

  const authenticatedWorkspaceUser = authPlanVerified && Boolean(memberRole);
  const notificationsOwnerAllowed = authPlanVerified && memberRole === "OWNER";
  const shouldRenderCavPadTrigger = showCavPad;
  const shouldMountCavPad = showCavPad && (authenticatedWorkspaceUser || cavPadOpen);

  function onNotificationsToggle() {
    if (notificationsOwnerAllowed) {
      setNotifOpen((v) => !v);
      return;
    }
    openCavGuardByAction("NOTIFICATIONS_OWNER_ONLY");
  }

  function onNotificationsViewAll(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (notificationsOwnerAllowed) return;
    event.preventDefault();
    setNotifOpen(false);
    openCavGuardByAction("NOTIFICATIONS_OWNER_ONLY");
  }

  function onArcadeClick(event: ReactMouseEvent<HTMLAnchorElement>) {
    setNavOpen(false);
    setQuickToolsOpen(false);
    if (!memberRole || memberRole === "OWNER") return;
    if (arcadeCollaboratorAccessEnabled) return;
    event.preventDefault();
    openCavGuardByAction("ARCADE_ACCESS_BLOCKED");
  }


  async function onLogout() {
    try {
      setAccountOpen(false);
      setNotifOpen(false);
      setRangeOpen(false);
    } catch {}

    recordClickIntent("/auth?mode=login", "account-logout");
    recordNavigationStart("/auth?mode=login", "router.replace");

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "include",
      });
    } catch {}

    if (typeof window !== "undefined") {
      window.location.replace("/auth?mode=login");
      return;
    }

    router.replace("/auth?mode=login");
  }


  function onOpenProfile() {
    try {
      setAccountOpen(false);
      setNotifOpen(false);
      setRangeOpen(false);
    } catch {}
    if (publicProfileHref) {
      recordClickIntent(publicProfileHref, "account-profile");
      recordNavigationStart(publicProfileHref, "window.open");
      openCanonicalPublicProfileWindow({ href: publicProfileHref, fallbackHref: "/settings?tab=account" });
      return;
    }
    recordClickIntent("/settings?tab=account", "account-profile-settings");
    recordNavigationStart("/settings?tab=account", "router.push");
    router.push("/settings?tab=account");
  }

  function onOpenPlans() {
    try {
      setAccountOpen(false);
      setNotifOpen(false);
      setRangeOpen(false);
    } catch {}
    recordClickIntent(upgradeHref, "account-plan");
    recordNavigationStart(upgradeHref, "router.push");
    router.push(upgradeHref);
  }

  useEffect(() => {
    if (!publicProfileHref) return;
    prefetchRoute(publicProfileHref);
  }, [prefetchRoute, publicProfileHref]);
  useEffect(() => {
    prefetchRoute(upgradeHref);
  }, [prefetchRoute, upgradeHref]);

  // ==========================
  // NOTIFICATIONS: list + mark read + fade + toast + polling
  // ==========================


  const loadNotifList = useCallback(async (opts?: { unreadOnly?: boolean }) => {
    if (!notificationsOwnerAllowed) {
      setNotifItems([]);
      setNotifCount(0);
      return;
    }
    const q = opts?.unreadOnly ? "unread=1&limit=30" : "limit=30";
    type NotificationResponse = {
      ok: true;
      notifications: NotificationRaw[];
      nextCursor?: string | null;
    };

    const data = await apiJSON<NotificationResponse>(`/api/notifications?${q}`);

    const items = (data.notifications || [])
      .filter((row) => !isBackendOnlyNotificationRaw(row))
      .map(mapRawNotification);

    const hidden = hiddenNotifIdsRef.current;
    const visible = items.filter((x) => !hidden.has(x.id));

    setNotifItems(visible);

    // keep bubble accurate while open (real-time feel)
    const unreadCount = visible.reduce((acc, x) => acc + (x.unread ? 1 : 0), 0);
    setNotifCount(unreadCount);
  }, [notificationsOwnerAllowed]);


  async function markRead(ids: string[]) {
    if (!notificationsOwnerAllowed) return;
    if (!ids.length) return;
    await apiJSON<{ ok: true }>("/api/notifications", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  }


  function fadeOutAndRemove(id: string) {
    hiddenNotifIdsRef.current.add(id);
    setHiddenNotifIds(Array.from(hiddenNotifIdsRef.current));
    setNotifActionRoleById((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });


    window.setTimeout(() => {
      setNotifItems((prev) => prev.filter((x) => x.id !== id));
    }, 240);
  }


  async function onClickNotif(n: NotifItem) {
    try {
      if (n.unread) {
        setNotifItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
        setNotifCount((c) => Math.max(0, c - 1));


        markRead([n.id]).catch(() => {
          setNotifItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, unread: true } : x)));
          setNotifCount((c) => c + 1);
        });
      }


      fadeOutAndRemove(n.id);
    } catch {
      // ignore
    } finally {
      setNotifOpen(false);
    }
  }

  async function runNotifAction(
    n: NotifItem,
    action: NotificationActionMeta,
    role?: NotificationJoinRole | null,
  ) {
    if (!notificationsOwnerAllowed) {
      openCavGuardByAction("NOTIFICATIONS_OWNER_ONLY");
      return;
    }
    const busyKey = `${n.id}:${action.key}`;
    if (notifActionBusyKey === busyKey) return;

    setNotifActionBusyKey(busyKey);
    setNotifActionErrorById((prev) => ({ ...prev, [n.id]: "" }));

    try {
      const targetHref = String(action.href || n.href || "/").trim() || "/";

      if (action.method === "GET") {
        await onClickNotif(n);
        recordClickIntent(targetHref, "notification-get-action");
        recordNavigationStart(targetHref, "router.push");
        router.push(targetHref);
        return;
      }

      const payload =
        action.body && typeof action.body === "object"
          ? { ...action.body }
          : ({} as Record<string, unknown>);
      if (role && isWorkspaceJoinApprovalAction(action)) {
        payload.role = role;
      }
      const hasPayload = Object.keys(payload).length > 0;

      const res = await fetch(action.href, {
        method: action.method,
        headers: {
          ...(hasPayload ? { "Content-Type": "application/json" } : {}),
          "x-cavbot-csrf": "1",
        },
        body: hasPayload ? JSON.stringify(payload) : undefined,
        credentials: "include",
        cache: "no-store",
      });

      const body = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            error?: string;
            guardDecision?: CavGuardDecision;
            refreshSession?: boolean;
            refreshWorkspace?: boolean;
            redirectTo?: string;
          }
        | null;

      emitGuardDecisionFromPayload(body);

      if (!res.ok || body?.ok === false) {
        const msg = body?.message || body?.error || "Action failed";
        throw new Error(String(msg));
      }

      await onClickNotif(n);
      window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
      window.dispatchEvent(new CustomEvent("cb:team:refresh"));

      if (body?.refreshSession) {
        window.dispatchEvent(new CustomEvent("cb:auth:refresh"));
      }
      if (body?.refreshWorkspace) {
        window.dispatchEvent(new CustomEvent("cb:workspace:refresh"));
      }

      if (body?.redirectTo) {
        recordClickIntent(String(body.redirectTo), "notification-redirect");
        recordNavigationStart(String(body.redirectTo), "router.push");
        router.push(String(body.redirectTo));
      } else if (action.key === "open" || action.key === "openInCavCode") {
        recordClickIntent(targetHref, `notification-${action.key}`);
        recordNavigationStart(targetHref, "router.push");
        router.push(targetHref);
      } else if (action.key === "saveToCavCloud") {
        recordClickIntent("/cavcloud", "notification-saveToCavCloud");
        recordNavigationStart("/cavcloud", "router.push");
        router.push("/cavcloud");
      }
    } catch (error) {
      setNotifActionErrorById((prev) => ({
        ...prev,
        [n.id]: error instanceof Error ? error.message : "Action failed.",
      }));
    } finally {
      setNotifActionBusyKey((current) => (current === busyKey ? "" : current));
    }
  }



  // load list when opening or when unread filter changes while open
  useEffect(() => {
    if (!notifOpen) return;
    if (!notificationsOwnerAllowed) return;
    loadNotifList({ unreadOnly: notifUnreadOnly }).catch(() => {});
  }, [notifOpen, notifUnreadOnly, notificationsOwnerAllowed, loadNotifList]);

  // Prime notifications in the background so the panel opens with content immediately.
  useEffect(() => {
    if (!notificationsOwnerAllowed) return;
    loadNotifList({ unreadOnly: false }).catch(() => {});
  }, [notificationsOwnerAllowed, loadNotifList]);


  // Poll unread count + incoming toast (only if count increases and dropdown is closed)
  useEffect(() => {
    if (!notificationsOwnerAllowed) {
      lastUnreadRef.current = 0;
      setNotifCount(0);
      return;
    }

    let alive = true;
    const ctrl = new AbortController();


    async function tick() {
      try {
        const res = await fetch("/api/notifications/unread-count", {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });


        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        emitGuardDecisionFromPayload(data);
        if (!res.ok || data?.ok === false) {
          setNotifCount(0);
          return;
        }


        const c = Number(data?.count || 0);
        const next = Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0;


        const prev = lastUnreadRef.current;
        lastUnreadRef.current = next;


        setNotifCount(next);


        if (prev === null) return;

        if (next > prev) {
          // Sound gate (only when new notif arrives AND user allows it)
          try {
            const prefs = (window as WindowWithGlobals).__CB_NOTIF_SETTINGS__ || null;
            const soundEnabled = prefs?.sound !== false;
            const inAppSignalsEnabled = prefs?.inAppSignals !== false;
            const quietHoursEnabled = prefs?.quietHours === true;
            const fallbackTone = soundEnabled ? "cavbot-chime" : "cavbot-vibrate-calm";
            const tone = normalizeTone(prefs?.alertTone ?? fallbackTone) || "cavbot-chime";
            if (soundEnabled && inAppSignalsEnabled && !quietHoursEnabled && notifAudioUnlockedRef.current) {
              playCavbotTone(tone);
            }
          } catch {}
          if (!notifOpen) {
            // Incoming toast
            try {
              type NotificationToastResponse = { ok: true; notifications: NotificationRaw[] };

              const list = await apiJSON<NotificationToastResponse>(
                `/api/notifications?unread=1&limit=1`
              );


              const visible = (list?.notifications || []).find((row) => !isBackendOnlyNotificationRaw(row));
              const n = visible ? mapRawNotification(visible) : null;
              if (n?.id) {
                setNotifToast({
                  tone: n.tone,
                  title: n.title || "Notification",
                  body: n.body || "",
                });


                if (notifToastTimer.current) window.clearTimeout(notifToastTimer.current);
                notifToastTimer.current = window.setTimeout(() => setNotifToast(null), 2400);
              }
            } catch {
              // ignore toast failure
            }
          }
        }
      } catch {
        if (!alive) return;
        setNotifCount(0);
      }
    }


    tick();
    const t = window.setInterval(() => tick(), 5000);


    return () => {
      alive = false;
      try {
        ctrl.abort();
      } catch {}
      window.clearInterval(t);
      if (notifToastTimer.current) window.clearTimeout(notifToastTimer.current);
    };
  }, [notifOpen, notificationsOwnerAllowed]);

  useEffect(() => {
    if (!notificationsOwnerAllowed) {
      setNotifItems([]);
      setNotifCount(0);
      return;
    }

    let mounted = true;
    async function refreshNow() {
      try {
        const res = await fetch("/api/notifications/unread-count", {
          method: "GET",
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        emitGuardDecisionFromPayload(data);
        if (!res.ok || data?.ok === false) {
          setNotifCount(0);
          return;
        }
        const count = Number(data?.count || 0);
        const safeCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
        lastUnreadRef.current = safeCount;
        setNotifCount(safeCount);
      } catch {}

      if (!mounted || !notifOpen) return;
      try {
        const q = notifUnreadOnly ? "unread=1&limit=30" : "limit=30";
        type NotificationResponse = {
          ok: true;
          notifications: NotificationRaw[];
          nextCursor?: string | null;
        };
        const data = await apiJSON<NotificationResponse>(`/api/notifications?${q}`);
        if (!mounted) return;
        const items = (data.notifications || [])
          .filter((row) => !isBackendOnlyNotificationRaw(row))
          .map(mapRawNotification);
        const hidden = hiddenNotifIdsRef.current;
        const visible = items.filter((x) => !hidden.has(x.id));
        setNotifItems(visible);
      } catch {}
    }

    function onRefreshEvent() {
      void refreshNow();
    }

    window.addEventListener("cb:notifications:refresh", onRefreshEvent as EventListener);
    return () => {
      mounted = false;
      window.removeEventListener("cb:notifications:refresh", onRefreshEvent as EventListener);
    };
  }, [notifOpen, notifUnreadOnly, notificationsOwnerAllowed]);

  // Hydration safety valve: keep shell purely client-rendered after mount.
  if (!clientMounted) {
    return null;
  }

  return (
    <div
      className={`cb-shell${isCavbotPage ? " cb-route-cavbot" : ""}`}
      data-cavbot-page-type="console"
      data-shell-subtitle={subtitle || undefined}
    >
      <Suspense fallback={null}>
        <SearchParamsBridge onChange={setSearchParamsSerialized} />
      </Suspense>
      {/* incoming toast */}
      {notifToast ? (
        <div className="cb-notif-toast" data-tone={notifToast.tone} role="status" aria-live="polite">
          <div className="cb-notif-toast-title">{notifToast.title}</div>
          {notifToast.body ? <div className="cb-notif-toast-sub">{notifToast.body}</div> : null}
        </div>
      ) : null}
      <CavGuardModal
        open={cavGuardModalOpen}
        decision={cavGuardDecision}
        onClose={closeCavGuardModal}
        onCtaClick={resetCavGuardModal}
      />
      {verifyRequest ? (
        <CavBotVerifyModal
          open={Boolean(verifyRequest)}
          actionType={verifyRequest.actionType}
          route={verifyRequest.route}
          identifierHint={verifyRequest.reason}
          onClose={closeVerifyModal}
          onVerified={completeVerifyModal}
        />
      ) : null}

      {shouldMountCavPad ? (
        <CavPadDock
          open={cavPadOpen}
          onClose={() => setCavPadOpen(false)}
          wsName={title || "Workspace"}
          projectId={cavProjectId}
          sites={cavSites}
          activeSiteId={siteParam}
          planTier={planTier}
          memberRole={memberRole || "ANON"}
        />
      ) : null}


      {/* ===== MOBILE OVERLAY + DRAWER ===== */}
      <div
        className={`cb-overlay ${navOpen ? "is-open" : ""}`}
        aria-hidden={!navOpen}
        onClick={() => setNavOpen(false)}
      />


      <aside className={`cb-sidebar ${navOpen ? "is-open" : ""}`} aria-label="Primary navigation">
        <div className="cb-side-top">
          <a className="cb-wordmark" aria-label="CavBot" href="https://www.cavbot.io">
            <Image
              className="cb-wordmark-img"
              src="/logo/official-logotype-light.svg"
              alt="CavBot Logo"
              width={220}
              height={40}
              priority
              unoptimized
            />
          </a>
        </div>


        <nav className="cb-nav" aria-label="Primary" ref={navScrollRef}>
          {nav.map((item) => {
            const active = isActive(item.href);
            const requiredPlan = item.required || "FREE";
            const unlocked = canAccess(planTier, requiredPlan);
            const shouldWarmHome = item.href === "/";


            return (
              <Link
                key={item.href}
                className="cb-nav-link"
                href={item.href}
                data-cb-route-intent={item.href}
                data-cb-perf-source="sidebar-nav"
                aria-current={active ? "page" : undefined}
                onMouseEnter={() => {
                  prefetchRoute(item.href);
                  if (shouldWarmHome) warmCommandCenter();
                }}
                onFocus={() => {
                  prefetchRoute(item.href);
                  if (shouldWarmHome) warmCommandCenter();
                }}
                onPointerDown={() => {
                  prefetchRoute(item.href);
                  if (shouldWarmHome) warmCommandCenter();
                }}
                onTouchStart={() => {
                  prefetchRoute(item.href);
                  if (shouldWarmHome) warmCommandCenter();
                }}
                onClick={() => onNavItemClick(item)}
              >
                <span className="cb-nav-meta">
                  <span className="cb-nav-label">{item.label}</span>
                  <span className="cb-nav-hint">{item.hint}</span>
                </span>


                <span className={`cb-nav-caret ${unlocked ? "" : "is-locked"}`} aria-hidden="true">
                  {unlocked ? (
                    "›"
                  ) : (
                    <span className="cb-nav-lockIcon" title="Upgrade required">
                      <LockIcon />
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>


        <div className="cb-nav-scroll-divider" aria-hidden="true">
          <span
            className={`cb-nav-scroll-label ${navScrollIndicator === "up" ? "is-up" : "is-down"}`}
            data-scroll-indicator={navScrollIndicator}
          >
            <Image
              src="/icons/app/scroll-down-1382-svgrepo-com.svg"
              alt=""
              width={16}
              height={16}
              className="cb-nav-scroll-icon cb-nav-scroll-icon-down"
              unoptimized
            />
            <Image
              src="/icons/app/scroll-up-1381-svgrepo-com.svg"
              alt=""
              width={16}
              height={16}
              className="cb-nav-scroll-icon cb-nav-scroll-icon-up"
              priority
              unoptimized
            />
          </span>
          <span className="cb-nav-scroll-line" />
        </div>


        {/* ===== SIDEBAR FOOTER (Icons + Plan) ===== */}
        <div className="cb-side-bottom" aria-label="Sidebar footer">
          <div className="cb-side-icons" aria-label="Quick tools">
            <div className={`cb-side-tools-wrap ${quickToolsOpen ? "is-open" : ""}`} ref={quickToolsWrapRef}>
              <button
                className="cb-side-tools-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={quickToolsOpen}
                aria-label="Open quick tools"
                onClick={() => setQuickToolsOpen((value) => !value)}
              >
                <IconQuickToolsGrid />
              </button>

              {quickToolsOpen ? (
                <div className="cb-side-tools-menu" role="menu" aria-label="Quick tools">
                  <Link
                    className="cb-icon-btn cb-side-tools-item cb-icon-btn-arcade"
                    href={"/cavbot-arcade"}
                    data-cb-route-intent="/cavbot-arcade"
                    data-cb-perf-source="sidebar-quicktool"
                    aria-label="CavBot Arcade"
                    role="menuitem"
                    onMouseEnter={() => prefetchRoute("/cavbot-arcade")}
                    onFocus={() => prefetchRoute("/cavbot-arcade")}
                    onPointerDown={() => prefetchRoute("/cavbot-arcade")}
                    onClick={onArcadeClick}
                  >
                    <IconArcadeCabinet />
                  </Link>

                  {aiLauncherInSidebar ? (
                    <CavAiCenterLauncher
                      surface={aiSurface}
                      contextLabel={aiContextLabel}
                      workspaceId={workspaceParam || null}
                      projectId={aiProjectId}
                      expandHref={aiExpandHref}
                      context={aiRouteContext}
                      preload
                      triggerClassName="cb-icon-btn cb-side-tools-item"
                      triggerAriaLabel={
                        aiSurface === "cavsafe" ? "Open CavAi Center for CavSafe" : "Open CavAi Center for CavCloud"
                      }
                      iconOnly
                    />
                  ) : null}

                  <a
                    className="cb-icon-btn cb-side-tools-item"
                    href="https://cavbot.io/help-center"
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Help Center"
                    role="menuitem"
                    onClick={() => {
                      setNavOpen(false);
                      setQuickToolsOpen(false);
                    }}
                  >
                    <IconHelp />
                  </a>

                  <Link
                    className="cb-icon-btn cb-side-tools-item"
                    href={"/settings"}
                    data-cb-route-intent="/settings"
                    data-cb-perf-source="sidebar-quicktool"
                    aria-label="Settings"
                    role="menuitem"
                    onMouseEnter={() => prefetchRoute("/settings")}
                    onFocus={() => prefetchRoute("/settings")}
                    onPointerDown={() => prefetchRoute("/settings")}
                    onClick={onSettingsClick}
                  >
                    <IconGear />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>


          <div className="cb-side-plan" aria-label="Account">
            <div className="cb-account-wrap cb-side-account-wrap" ref={accountWrapRef}>
              <button
                className="cb-side-account"
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-label="Open account menu"
                onClick={() => setAccountOpen((v) => !v)}
              >
                <span
                  className="cb-account-chip cb-side-account-chip"
                  data-tone={profileTone || "lime"}
                  aria-hidden="true"
                  style={{
                    background: profileAvatar
                      ? "transparent"
                      : profileTone === "transparent"
                      ? "transparent"
                      : profileTone === "violet"
                      ? "rgba(139,92,255,0.22)"
                      : profileTone === "blue"
                      ? "rgba(78,168,255,0.22)"
                      : profileTone === "white"
                      ? "rgba(255,255,255,0.92)"
                      : profileTone === "navy"
                      ? "rgba(1,3,15,0.78)"
                      : "rgba(185,200,90,0.92)",
                    overflow: "hidden",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  {profileAvatar ? (
                    <Image
                      src={profileAvatar}
                      alt=""
                      width={96}
                      height={96}
                      quality={60}
                      unoptimized
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  ) : (
                    <span className="cb-account-initials">{accountInitials}</span>
                  )}
                </span>

                <span className="cb-side-account-meta">
                  <span className="cb-side-account-name">{profileDisplayName}</span>
                  <span className="cb-side-account-plan">{profilePlanLabel}</span>
                </span>

                <span className="cb-side-account-spark" aria-hidden="true">
                  {profileShowsPremiumPlus ? (
                    <IconPremiumPlusStar />
                  ) : (
                    <Image
                      src="/icons/app/spark-svgrepo-com.svg"
                      alt=""
                      width={18}
                      height={18}
                      className="cb-upgrade-badgeIcon"
                      priority
                    />
                  )}
                </span>
              </button>

              {accountOpen && (
                <div className="cb-menu cb-menu-right cb-account-menu" role="menu" aria-label="Account">
                  <button className="cb-menu-item" type="button" role="menuitem" onClick={onOpenProfile}>
                    {profileMenuLabel}
                  </button>

                  <button className="cb-menu-item" type="button" role="menuitem" onClick={onOpenPlans}>
                    {planMenuLabel}
                  </button>

                  <button className="cb-menu-item danger" type="button" role="menuitem" onClick={onLogout}>
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>


      {/* ===== MAIN ===== */}
      <div className="cb-main">
        {!hideTopbar && (
          <header className="cb-topbar">
          <div className="cb-topbar-left">
            <button
              className="cb-menu-btn"
              type="button"
              aria-label="Open menu"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <IconDotsGrid />
            </button>


            <div className="cb-badge-left" aria-label="CavBot">
              <div
                className={`cb-badge cb-badge-inline ${
                  badgeTone === "lime"
                    ? "cavbot-auth-eye-watch"
                    : badgeTone === "red"
                      ? "cavbot-auth-eye-error"
                      : ""
                }`}
                aria-hidden="true"
              >
                <CdnBadgeEyes />
              </div>
            </div>


            <span className="cb-sr-only">CavBot Console</span>
          </div>


          <div className="cb-topbar-right" aria-label="Console controls">
            <div className="cb-controls-row">
              {!aiLauncherInSidebar ? (
                <CavAiCenterLauncher
                  surface={aiSurface}
                  contextLabel={aiContextLabel}
                  workspaceId={workspaceParam || null}
                  projectId={aiProjectId}
                  expandHref={aiExpandHref}
                  context={aiRouteContext}
                  preload
                  triggerClassName="cb-icon-btn-top"
                  iconClassName="cb-topbar-cavai-icon"
                  iconSizePx={22}
                  triggerAriaLabel="Open CavAi Center"
                  iconOnly
                />
              ) : null}

              {shouldRenderCavPadTrigger ? (
                <button
                  className="cb-icon-btn-top"
                  type="button"
                  aria-label="Open CavPad"
                  onClick={() => setCavPadOpen(true)}
                  title="CavPad"
                >
                  <IconCavPad />
                </button>
              ) : null}


              {/* NOTIFICATIONS */}
<div className="cb-notif-wrap" ref={notifWrapRef}>
	  <button
	    className="cb-icon-btn-top cb-notif-btn"
	    type="button"
	    aria-label="Notifications"
	    aria-pressed={notifOpen}
	    onClick={onNotificationsToggle}
	    title="Notifications"
	  >
    <IconBell />


    {notifCount > 0 ? (
      <span className="cb-notif-bubble" aria-label={`${notifCount} unread notifications`}>
        {notifCount > 99 ? "99+" : String(notifCount)}
      </span>
    ) : null}
  </button>


  {notifOpen ? (
    <>
      {notifView !== "panel" ? (
        <button
          className="cb-notif-overlay"
          type="button"
          aria-label="Close notifications"
          onClick={() => setNotifOpen(false)}
        />
      ) : null}
    <div className={`cb-notif-menu ${notifView === "modal" ? "is-modal" : ""} ${notifView === "full" ? "is-full" : ""}`} role="menu" aria-label="Notifications dropdown">
      <div className="cb-notif-head">
        <div className="cb-notif-head-row">
          <div className="cb-notif-title">Notifications</div>

          <div className="cb-notif-head-actions">
            <label className="cb-notif-filter-pill" htmlFor="cb-notif-filter-select">
              <span className="cb-sr-only">Filter notifications</span>
              <span className="cb-notif-filterIcon" aria-hidden="true" />
              <select
                id="cb-notif-filter-select"
                className="cb-notif-filter-select"
                value={notifFilter}
                onChange={(event) => setNotifFilter(event.currentTarget.value as NotificationFilter)}
              >
                {NOTIFICATION_FILTERS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="cb-notif-close"
              type="button"
              onClick={() => setNotifOpen(false)}
              aria-label="Close notifications"
            >
              <span className="cb-closeIcon" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>


      <div className="cb-notif-body">
        {filteredNotifItems.length === 0 ? (
          <div className="cb-notif-empty">
            <div className="cb-notif-empty-title">All clear</div>
            <div className="cb-notif-empty-sub">No new alerts in this workspace.</div>
          </div>
        ) : (
          <div className="cb-notif-list">
            {filteredNotifItems.map((n) => {
              const meta = n.meta && typeof n.meta === "object" && !Array.isArray(n.meta)
                ? n.meta
                : null;
              const actions = normalizeNotificationActions(meta);
              const openAction = actions.find((action) => action.key === "open") || null;
              const shareMeta = readNotificationShareMeta(meta);
              const expiryLabel = formatNotificationExpiry(shareMeta.expiresAtIso);
              const actionError = String(notifActionErrorById[n.id] || "").trim();
              const hasJoinApprovalAction = actions.some((action) => isWorkspaceJoinApprovalAction(action));
              const selectedJoinRole = normalizeNotificationJoinRole(notifActionRoleById[n.id]);

              return (
                <div
                  className={[
                    "cb-notif-item",
                    n.unread ? "is-unread" : "",
                    hiddenNotifIdsRef.current.has(n.id) ? "is-dismissing" : "",
                  ].join(" ")}
                  key={n.id}
                >
                  <button
                    type="button"
                    className="cb-notif-link cb-notif-link-btn cb-notif-itemPrimary"
                    onClick={() => {
                      if (openAction) {
                        void runNotifAction(n, openAction);
                        return;
                      }
                      if (n.href) {
                        onClickNotif(n).finally(() => {
                          recordClickIntent(n.href || "/", "notification-row-fallback");
                          recordNavigationStart(n.href || "/", "router.push");
                          router.push(n.href || "/");
                        });
                        return;
                      }
                      void onClickNotif(n);
                    }}
                  >
                    <div className={`cb-notif-dot ${n.tone ? `tone-${n.tone}` : ""}`} />
                    <div className="cb-notif-meta">
                      <div className="cb-notif-item-title">{n.title}</div>
                      {n.body ? <div className="cb-notif-item-body">{n.body}</div> : null}
                      {shareMeta.permissionLabel || expiryLabel ? (
                        <div className="cb-notif-tags">
                          {shareMeta.permissionLabel ? (
                            <span className="cb-notif-tag">{shareMeta.permissionLabel}</span>
                          ) : null}
                          {expiryLabel ? (
                            <span className="cb-notif-tag">{expiryLabel}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {n.createdAt ? <div className="cb-notif-item-time">{n.createdAt}</div> : null}
                    </div>
                    <div className="cb-notif-chev" aria-hidden="true">
                      ›
                    </div>
                  </button>

                  {actions.length ? (
                    <div className="cb-notif-actions" role="group" aria-label="Notification actions">
                      {hasJoinApprovalAction ? (
                        <>
                          <span className="cb-notif-tag">Accept as</span>
                          <label className="cb-sr-only" htmlFor={`cb-notif-role-${n.id}`}>
                            Select role for accepted request
                          </label>
                          <select
                            id={`cb-notif-role-${n.id}`}
                            className="cb-notif-filter-select"
                            value={selectedJoinRole}
                            onChange={(event) => {
                              const nextRole = normalizeNotificationJoinRole(event.currentTarget.value);
                              setNotifActionRoleById((prev) => ({ ...prev, [n.id]: nextRole }));
                            }}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        </>
                      ) : null}
                      {actions.map((action) => {
                        const busy = notifActionBusyKey === `${n.id}:${action.key}`;
                        const roleForAction = isWorkspaceJoinApprovalAction(action)
                          ? selectedJoinRole
                          : null;
                        return (
                          <button
                            key={`${n.id}:${action.key}`}
                            type="button"
                            className={`cb-notif-action ${action.key === "decline" || action.key === "deny" ? "is-decline" : ""}`}
                            disabled={busy}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void runNotifAction(n, action, roleForAction);
                            }}
                          >
                            {busy ? "Working..." : action.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {actionError ? <div className="cb-notif-action-error">{actionError}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>


      <div className="cb-notif-foot">
        <Link
          className="cb-notif-viewall"
          href="/notifications"
          data-cb-route-intent="/notifications"
          data-cb-perf-source="notifications-view-all"
          aria-label="View all notifications"
          onClick={onNotificationsViewAll}
        >
          <span className="cb-notif-viewallIcon" aria-hidden="true" />
          <span className="cb-sr-only">View all notifications</span>
        </Link>
      </div>


      {hiddenNotifIds.length ? (
        <span className="cb-sr-only">{hiddenNotifIds.length}</span>
      ) : null}
    </div>
    </>
  ) : null}
</div>

            </div>
          </div>
          </header>
        )}

        <main id="main" className="cb-content">
          {children || null}
        </main>
      </div>
    </div>
  );
}


/* ==========================
  ICONS (inline SVG, crisp)
========================== */


function IconDotsGrid() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <g fill="currentColor" opacity="0.95">
        <circle cx="5" cy="5" r="1.4" />
        <circle cx="11" cy="5" r="1.4" />
        <circle cx="17" cy="5" r="1.4" />
        <circle cx="5" cy="11" r="1.4" />
        <circle cx="11" cy="11" r="1.4" />
        <circle cx="17" cy="11" r="1.4" />
        <circle cx="5" cy="17" r="1.4" />
        <circle cx="11" cy="17" r="1.4" />
        <circle cx="17" cy="17" r="1.4" />
      </g>
    </svg>
  );
}


function IconCavPad() {
  return (
    <Image
      src="/icons/cavpad/notepad-svgrepo-com.svg"
      alt=""
      width={22}
      height={22}
      className="cb-cavpad-icon"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}


function IconBell() {
  return (
    <Image
      src="/icons/app/bell-svgrepo-com.svg"
      alt=""
      width={22}
      height={22}
      className="cb-bell-icon"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}

function IconQuickToolsGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="cb-side-tools-grid" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="2" className="is-lime" />
      <rect x="11" y="1" width="6" height="6" rx="2" className="is-coral" />
      <rect x="1" y="11" width="6" height="6" rx="2" className="is-blue" />
      <rect x="11" y="11" width="6" height="6" rx="2" className="is-violet" />
    </svg>
  );
}

function IconPremiumPlusStar() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      className="cb-upgrade-badgeStar"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M12 2.4l2.9 5.87 6.48.94-4.69 4.57 1.11 6.45L12 17.2 6.2 20.23l1.11-6.45L2.62 9.21l6.48-.94L12 2.4z"
      />
    </svg>
  );
}

function IconHelp() {
  return (
    <Image
      src="/icons/app/help-outline-svgrepo-com.svg"
      alt=""
      width={22}
      height={22}
      className="cb-help-icon"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}


function IconGear() {
  return (
    <Image
      src="/icons/app/settings-svgrepo-com.svg"
      alt=""
      width={22}
      height={22}
      className="cb-settings-icon"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}


function IconArcadeCabinet() {
  return (
    <Image
      src="/icons/app/game-control-2-svgrepo-com.svg"
      alt=""
      width={28}
      height={28}
      className="cb-arcade-icon"
      aria-hidden="true"
      priority
      unoptimized
    />
  );
}
