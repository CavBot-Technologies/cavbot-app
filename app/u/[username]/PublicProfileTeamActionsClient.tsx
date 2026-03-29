"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { CavGuardModal } from "@/components/CavGuardModal";
import { readGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import type { CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";
import {
  PUBLIC_PROFILE_VIEW_EVENT,
  parsePublicProfileViewEvent,
  readPublicProfileViewFromWindow,
  setPublicProfileView,
} from "./publicProfileViewState";

type RequestAccessResponse = {
  ok?: boolean;
  deduped?: boolean;
  error?: string;
  message?: string;
  workspace?: {
    id?: unknown;
    name?: unknown;
  } | null;
};

type TeamStateResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  workspace?: {
    id?: unknown;
    name?: unknown;
    planId?: unknown;
  } | null;
  viewer?: {
    authenticated?: unknown;
    userId?: unknown;
    inWorkspace?: unknown;
    workspaceRole?: unknown;
    canManageWorkspace?: unknown;
    canInviteFromCurrentAccount?: unknown;
    pendingInvite?: {
      id?: unknown;
      role?: unknown;
      expiresAtISO?: unknown;
    } | null;
    pendingRequest?: {
      id?: unknown;
      createdAtISO?: unknown;
    } | null;
    membershipState?: unknown;
    canRequestAccess?: unknown;
    canAcceptInvite?: unknown;
  } | null;
};

type MemberRow = {
  membershipId: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  createdAtISO: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    email: string | null;
    avatarImage: string | null;
    avatarTone: string | null;
  };
};

type MembersResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  members?: Array<{
    membershipId?: unknown;
    role?: unknown;
    createdAtISO?: unknown;
    user?: {
      id?: unknown;
      username?: unknown;
      displayName?: unknown;
      email?: unknown;
      avatarImage?: unknown;
      avatarTone?: unknown;
    } | null;
  }>;
};

type CollabSource = "cavpad" | "cavcloud" | "cavsafe";
type CollabItemType = "note" | "directory" | "file" | "folder";

type CollabPickerItem = {
  id: string;
  source: CollabSource;
  itemType: CollabItemType;
  label: string;
  subLabel: string;
  updatedAtISO: string;
};

type CollabPickerResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  cavsafeAvailable?: unknown;
  items?: Array<{
    id?: unknown;
    source?: unknown;
    itemType?: unknown;
    label?: unknown;
    subLabel?: unknown;
    updatedAtISO?: unknown;
  }>;
};

const CSRF_HEADER = "x-cavbot-csrf";
const MEMBERS_SEARCH_EVENT = "cb:public-profile-members-search";
const TEAM_STATE_CACHE_TTL_MS = 30_000;
const MEMBERS_CACHE_TTL_MS = 30_000;

const teamStateCache = new Map<string, { ts: number; value: TeamStateResponse }>();
const membersCache = new Map<string, { ts: number; value: MemberRow[] }>();

function readFreshTeamStateCache(cacheKey: string): TeamStateResponse | null {
  const key = s(cacheKey).toLowerCase();
  if (!key) return null;
  const cached = teamStateCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > TEAM_STATE_CACHE_TTL_MS) {
    teamStateCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeTeamStateCache(cacheKey: string, value: TeamStateResponse) {
  const key = s(cacheKey).toLowerCase();
  if (!key) return;
  teamStateCache.set(key, { ts: Date.now(), value });
}

function readFreshMembersCache(cacheKey: string): MemberRow[] {
  const key = s(cacheKey).toLowerCase();
  if (!key) return [];
  const cached = membersCache.get(key);
  if (!cached) return [];
  if (Date.now() - cached.ts > MEMBERS_CACHE_TTL_MS) {
    membersCache.delete(key);
    return [];
  }
  return cached.value;
}

function writeMembersCache(cacheKey: string, value: MemberRow[]) {
  const key = s(cacheKey).toLowerCase();
  if (!key) return;
  membersCache.set(key, { ts: Date.now(), value });
}

function membersSearchStorageKey(usernameKey: string): string {
  return `cb_public_profile_members_search_v1:${s(usernameKey).toLowerCase()}`;
}

function readMembersSearchSnapshot(usernameKey: string): string {
  const key = membersSearchStorageKey(usernameKey);
  if (!key) return "";
  try {
    return String(globalThis.__cbSessionStore.getItem(key) || "");
  } catch {
    return "";
  }
}

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const row = payload as Record<string, unknown>;
  const code = s(row.error).toUpperCase();
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "UNAUTHENTICATED") {
    return "Sign in to continue.";
  }
  const message = s(row.message || row.error);
  return message || fallback;
}

function emitNotice(title: string, body: string, tone: "GOOD" | "WATCH" = "GOOD") {
  try {
    window.dispatchEvent(
      new CustomEvent("cb:notice", {
        detail: {
          tone,
          title,
          body,
          ts: Date.now(),
        },
      })
    );
  } catch {
    // Best effort only.
  }
}

function csrfJsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    [CSRF_HEADER]: "1",
    ...(extra || {}),
  };
}

function toMemberRole(raw: unknown): "OWNER" | "ADMIN" | "MEMBER" {
  const value = s(raw).toUpperCase();
  if (value === "OWNER" || value === "ADMIN") return value;
  return "MEMBER";
}

function toCollabSource(raw: unknown): CollabSource | null {
  const value = s(raw).toLowerCase();
  if (value === "cavpad" || value === "cavcloud" || value === "cavsafe") return value;
  return null;
}

function toCollabItemType(raw: unknown): CollabItemType | null {
  const value = s(raw).toLowerCase();
  if (value === "note" || value === "directory" || value === "file" || value === "folder") return value;
  return null;
}

function memberDisplayName(member: MemberRow): string {
  return s(member.user.displayName) || (member.user.username ? `@${member.user.username}` : (s(member.user.email) || "Member"));
}

function memberSubLabel(member: MemberRow): string {
  if (member.user.username) return `@${member.user.username}`;
  return s(member.user.email) || "Workspace member";
}

function memberInitials(member: MemberRow): string {
  const base = s(member.user.displayName || member.user.username || member.user.email);
  if (!base) return "CB";
  const parts = base.split(/\s+/).filter(Boolean);
  const first = s(parts[0]?.[0]).toUpperCase();
  const second = s(parts[1]?.[0]).toUpperCase();
  const letters = `${first}${second}`.trim();
  return letters || s(base[0]).toUpperCase() || "CB";
}

function formatDayLabel(iso: string): string {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function resolveCanonicalProfileUrl(input: { canonicalProfileUrl?: string; username: string }): string {
  const username = s(input.username);
  if (!username) return "";

  const explicit = s(input.canonicalProfileUrl);
  if (explicit && /^https?:\/\//i.test(explicit)) {
    return explicit;
  }

  if (typeof window !== "undefined") {
    const origin = s(window.location.origin).replace(/\/+$/, "");
    if (origin) return `${origin}/${encodeURIComponent(username)}`;
  }

  return `https://app.cavbot.io/${encodeURIComponent(username)}`;
}

export function PublicProfileTeamActionsClient({
  username,
  displayName,
  isOwner = false,
  editProfileHref = "/settings?tab=account",
  canonicalProfileUrl = "",
  mode = "inline",
  showActionBar = true,
  initialTeamState = null,
  initialMembers = [],
  onOwnerEditProfileToggle,
}: {
  username: string;
  displayName: string;
  isOwner?: boolean;
  editProfileHref?: string;
  canonicalProfileUrl?: string;
  mode?: "inline" | "page";
  showActionBar?: boolean;
  initialTeamState?: TeamStateResponse | null;
  initialMembers?: MemberRow[];
  onOwnerEditProfileToggle?: (() => void) | undefined;
}) {
  const normalizedUsername = s(username);
  const normalizedDisplayName = s(displayName) || `@${normalizedUsername}`;
  const cacheKey = normalizedUsername.toLowerCase();
  const membersPageMode = mode === "page";
  const [membersViewActive, setMembersViewActive] = React.useState(() =>
    membersPageMode ? true : readPublicProfileViewFromWindow() === "members"
  );

  const [teamState, setTeamState] = React.useState<TeamStateResponse | null>(() => {
    return readFreshTeamStateCache(cacheKey) || initialTeamState || null;
  });
  const [, setTeamStateLoading] = React.useState(false);
  const [teamStateError, setTeamStateError] = React.useState("");

  const [inviteSubmitBusy, setInviteSubmitBusy] = React.useState(false);
  const [requestSubmitBusy, setRequestSubmitBusy] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [shareBusy, setShareBusy] = React.useState(false);

  const [membersOpen, setMembersOpen] = React.useState(() => membersPageMode);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [membersError, setMembersError] = React.useState("");
  const [members, setMembers] = React.useState<MemberRow[]>(() => {
    const cached = readFreshMembersCache(cacheKey);
    if (cached.length) return cached;
    return Array.isArray(initialMembers) ? initialMembers : [];
  });
  const [membersSearchQuery, setMembersSearchQuery] = React.useState(() => readMembersSearchSnapshot(cacheKey));
  const [revokeBusyUserId, setRevokeBusyUserId] = React.useState("");
  const [revokeConfirmOpen, setRevokeConfirmOpen] = React.useState(false);
  const [revokeConfirmTarget, setRevokeConfirmTarget] = React.useState<MemberRow | null>(null);

  const [collabOpen, setCollabOpen] = React.useState(false);
  const [collabTarget, setCollabTarget] = React.useState<MemberRow | null>(null);
  const [collabSource, setCollabSource] = React.useState<CollabSource>("cavpad");
  const [collabPermission, setCollabPermission] = React.useState<"VIEW" | "EDIT">("VIEW");
  const [collabQuery, setCollabQuery] = React.useState("");
  const [collabItems, setCollabItems] = React.useState<CollabPickerItem[]>([]);
  const [collabSelectedItemId, setCollabSelectedItemId] = React.useState("");
  const [collabLoading, setCollabLoading] = React.useState(false);
  const [collabBusy, setCollabBusy] = React.useState(false);
  const [collabError, setCollabError] = React.useState("");
  const [collabSuccess, setCollabSuccess] = React.useState("");
  const [cavsafeAvailable, setCavsafeAvailable] = React.useState(false);

  const [cavGuardOpen, setCavGuardOpen] = React.useState(false);
  const [cavGuardDecision, setCavGuardDecision] = React.useState<CavGuardDecision | null>(null);
  const membersPrefetchTriggeredRef = React.useRef(false);

  const viewerUserId = s(teamState?.viewer?.userId) || "";
  const workspaceId = s(teamState?.workspace?.id) || "";
  const canManageWorkspace = teamState?.viewer?.canManageWorkspace === true;
  const canManageWorkspaceResolved = typeof teamState?.viewer?.canManageWorkspace === "boolean";
  const isAuthenticated = teamState?.viewer?.authenticated === true;
  const canonicalShareUrl = React.useMemo(
    () => resolveCanonicalProfileUrl({ canonicalProfileUrl, username: normalizedUsername }),
    [canonicalProfileUrl, normalizedUsername],
  );
  const workspaceName = s(teamState?.workspace?.name) || canonicalShareUrl || "Workspace";
  const membersAccessPending = !canManageWorkspaceResolved;
  const showMembersTotal = canManageWorkspace && (!membersLoading || members.length > 0);
  const membersSearchNeedle = s(membersSearchQuery).toLowerCase();
  const filteredMembers = React.useMemo(() => {
    if (!membersSearchNeedle) return members;
    return members.filter((member) => {
      const role = s(member.role);
      const display = memberDisplayName(member);
      const sub = memberSubLabel(member);
      const email = s(member.user.email);
      const username = s(member.user.username);
      const haystack = `${display} ${sub} ${email} ${username} ${role}`.toLowerCase();
      return haystack.includes(membersSearchNeedle);
    });
  }, [members, membersSearchNeedle]);

  React.useEffect(() => {
    if (!shareOpen && !collabOpen && !cavGuardOpen && !revokeConfirmOpen) return;
    document.body.classList.add("cb-modal-open");
    return () => {
      document.body.classList.remove("cb-modal-open");
    };
  }, [cavGuardOpen, collabOpen, revokeConfirmOpen, shareOpen]);

  React.useEffect(() => {
    membersPrefetchTriggeredRef.current = false;
  }, [cacheKey]);

  React.useEffect(() => {
    if (!initialTeamState) return;
    writeTeamStateCache(cacheKey, initialTeamState);
  }, [cacheKey, initialTeamState]);

  React.useEffect(() => {
    if (!Array.isArray(initialMembers) || initialMembers.length <= 0) return;
    writeMembersCache(cacheKey, initialMembers);
  }, [cacheKey, initialMembers]);

  const loadTeamState = React.useCallback(async (options?: { force?: boolean; silent?: boolean }) => {
    if (!normalizedUsername) {
      setTeamState(null);
      return;
    }

    if (!options?.force && teamState) {
      setTeamStateError("");
      if (options?.silent !== false) return;
    }

    if (!options?.force) {
      const cached = readFreshTeamStateCache(cacheKey);
      if (cached) {
        setTeamState(cached);
        setTeamStateError("");
        if (options?.silent !== false) return;
      }
    }

    if (!options?.silent) setTeamStateLoading(true);
    setTeamStateError("");
    try {
      const qs = new URLSearchParams();
      qs.set("username", normalizedUsername);
      const res = await fetch(`/api/public/profile/team-state?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as TeamStateResponse;
      if (!res.ok || payload.ok !== true) {
        throw new Error(extractErrorMessage(payload, "Failed to resolve workspace state."));
      }
      setTeamState(payload);
      writeTeamStateCache(cacheKey, payload);
      setTeamStateError("");
    } catch (error) {
      if (!teamState) setTeamState(null);
      setTeamStateError(s(error instanceof Error ? error.message : "Failed to load state."));
    } finally {
      setTeamStateLoading(false);
    }
  }, [cacheKey, normalizedUsername, teamState]);

  const loadMembers = React.useCallback(async (options?: { force?: boolean; allowWhenClosed?: boolean; silent?: boolean }) => {
    if (!normalizedUsername) return;
    if (!options?.allowWhenClosed && !membersOpen) return;

    if (!canManageWorkspace && canManageWorkspaceResolved) {
      if (membersOpen && canManageWorkspaceResolved) {
        setMembers([]);
        setMembersError("Members list is only visible to workspace owners/admins.");
      }
      return;
    }

    if (!options?.force) {
      if (members.length > 0) {
        setMembersError("");
        if (options?.silent !== false) return;
      }
      const cached = readFreshMembersCache(cacheKey);
      if (cached.length > 0) {
        setMembers(cached);
        setMembersError("");
        if (options?.silent !== false) return;
      }
    }

    setMembersLoading(true);
    setMembersError("");
    try {
      const qs = new URLSearchParams();
      qs.set("username", normalizedUsername);
      if (process.env.NODE_ENV !== "production") {
        qs.set("seedDemo", "1");
      }
      const res = await fetch(`/api/public/profile/members?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => ({}))) as MembersResponse;
      if (!res.ok || payload.ok !== true) {
        throw new Error(extractErrorMessage(payload, "Failed to load members."));
      }

      const rows = Array.isArray(payload.members) ? payload.members : [];
      const parsed: MemberRow[] = rows
        .map((row) => {
          const userId = s(row?.user?.id);
          const membershipId = s(row?.membershipId);
          if (!userId || !membershipId) return null;
          return {
            membershipId,
            role: toMemberRole(row?.role),
            createdAtISO: s(row?.createdAtISO),
            user: {
              id: userId,
              username: s(row?.user?.username) || null,
              displayName: s(row?.user?.displayName) || null,
              email: s(row?.user?.email) || null,
              avatarImage: s(row?.user?.avatarImage) || null,
              avatarTone: s(row?.user?.avatarTone) || null,
            },
          };
        })
        .filter((row): row is MemberRow => Boolean(row));

      setMembers(parsed);
      writeMembersCache(cacheKey, parsed);
      setMembersError("");
    } catch (error) {
      if (!options?.silent) {
        setMembersError(s(error instanceof Error ? error.message : "Failed to load members."));
      }
    } finally {
      setMembersLoading(false);
    }
  }, [cacheKey, canManageWorkspace, canManageWorkspaceResolved, members.length, membersOpen, normalizedUsername]);

  React.useEffect(() => {
    void loadTeamState();
  }, [loadTeamState]);

  React.useEffect(() => {
    const onTeamRefresh = () => {
      void loadTeamState({ force: true, silent: true });
      if (membersOpen) void loadMembers({ force: true, silent: true });
    };
    window.addEventListener("cb:team:refresh", onTeamRefresh as EventListener);
    return () => {
      window.removeEventListener("cb:team:refresh", onTeamRefresh as EventListener);
    };
  }, [loadMembers, loadTeamState, membersOpen]);

  React.useEffect(() => {
    if (!membersOpen) return;
    void loadMembers();
  }, [loadMembers, membersOpen]);

  React.useEffect(() => {
    setMembersSearchQuery(readMembersSearchSnapshot(cacheKey));
    const onMembersSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ usernameKey?: string; query?: string }>).detail || {};
      if (s(detail.usernameKey).toLowerCase() !== cacheKey) return;
      setMembersSearchQuery(String(detail.query || ""));
    };
    window.addEventListener(MEMBERS_SEARCH_EVENT, onMembersSearch as EventListener);
    return () => {
      window.removeEventListener(MEMBERS_SEARCH_EVENT, onMembersSearch as EventListener);
    };
  }, [cacheKey]);

  React.useEffect(() => {
    if (membersPageMode) {
      setMembersViewActive(true);
      return;
    }
    const syncFromLocation = () => {
      setMembersViewActive(readPublicProfileViewFromWindow() === "members");
    };
    const onViewChange = (event: Event) => {
      const detail = parsePublicProfileViewEvent(event);
      if (!detail) return;
      if (detail.usernameKey !== cacheKey) return;
      setMembersViewActive(detail.view === "members");
    };
    syncFromLocation();
    window.addEventListener(PUBLIC_PROFILE_VIEW_EVENT, onViewChange as EventListener);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener(PUBLIC_PROFILE_VIEW_EVENT, onViewChange as EventListener);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [cacheKey, membersPageMode]);

  React.useEffect(() => {
    if (membersPageMode || members.length > 0 || membersPrefetchTriggeredRef.current) return;
    membersPrefetchTriggeredRef.current = true;
    const timer = window.setTimeout(() => {
      void loadMembers({ allowWhenClosed: true, silent: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadMembers, members.length, membersPageMode]);

  React.useEffect(() => {
    if (!membersPageMode) return;
    setMembersOpen(true);
  }, [membersPageMode]);

  React.useEffect(() => {
    if (collabSource !== "cavsafe") return;
    setCollabPermission("VIEW");
  }, [collabSource]);

  const openAuthRequiredGuard = React.useCallback((payload?: unknown) => {
    const decision = readGuardDecisionFromPayload(payload) || buildCavGuardDecision("AUTH_REQUIRED", { role: "ANON" });
    setCavGuardDecision(decision);
    setCavGuardOpen(true);
  }, []);

  const closeCavGuardModal = React.useCallback(() => {
    setCavGuardOpen(false);
    setCavGuardDecision(null);
  }, []);

  const closeShareModal = React.useCallback(() => {
    if (shareBusy) return;
    setShareOpen(false);
  }, [shareBusy]);

  const closeCollabModal = React.useCallback(() => {
    if (collabBusy) return;
    setCollabOpen(false);
    setCollabTarget(null);
    setCollabSource("cavpad");
    setCollabPermission("VIEW");
    setCollabQuery("");
    setCollabItems([]);
    setCollabSelectedItemId("");
    setCollabLoading(false);
    setCollabError("");
    setCollabSuccess("");
  }, [collabBusy]);

  const closeRevokeConfirmModal = React.useCallback(() => {
    if (revokeBusyUserId) return;
    setRevokeConfirmOpen(false);
    setRevokeConfirmTarget(null);
  }, [revokeBusyUserId]);

  const onSendInvite = React.useCallback(async () => {
    if (inviteSubmitBusy) return;
    if (!isAuthenticated) {
      openAuthRequiredGuard();
      return;
    }

    setInviteSubmitBusy(true);
    try {
      const res = await fetch("/api/invites/send", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: csrfJsonHeaders(),
        body: JSON.stringify({
          targetUsername: normalizedUsername,
          role: "MEMBER",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || payload.ok !== true) {
        if (res.status === 401) {
          openAuthRequiredGuard(payload);
          return;
        }
        throw new Error(extractErrorMessage(payload, "Invite failed."));
      }

      const success = `Invite sent to ${normalizedDisplayName}.`;
      emitNotice("Invite sent", success, "GOOD");
      try {
        window.dispatchEvent(new CustomEvent("cb:team:refresh"));
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
      } catch {
        // ignore
      }
      void loadTeamState({ force: true, silent: true });
    } catch (error) {
      emitNotice(
        "Invite failed",
        extractErrorMessage({ message: error instanceof Error ? error.message : "" }, "Invite failed."),
        "WATCH",
      );
    } finally {
      setInviteSubmitBusy(false);
    }
  }, [inviteSubmitBusy, isAuthenticated, loadTeamState, normalizedDisplayName, normalizedUsername, openAuthRequiredGuard]);

  const onRequestAccess = React.useCallback(async () => {
    if (requestSubmitBusy) return;
    if (!isAuthenticated) {
      openAuthRequiredGuard();
      return;
    }

    setRequestSubmitBusy(true);
    try {
      const requestBody: Record<string, string> = {
        targetUsername: normalizedUsername,
        targetProfileUrl: canonicalShareUrl,
      };
      if (workspaceId) {
        requestBody.targetWorkspaceId = workspaceId;
      }

      const res = await fetch("/api/access-requests/send", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: csrfJsonHeaders(),
        body: JSON.stringify(requestBody),
      });
      const payload = (await res.json().catch(() => ({}))) as RequestAccessResponse;
      if (!res.ok || payload.ok !== true) {
        if (res.status === 401) {
          openAuthRequiredGuard(payload);
          return;
        }
        throw new Error(extractErrorMessage(payload, "Request failed."));
      }
      const success = payload.deduped
        ? `Request already pending for ${workspaceName}.`
        : `Request sent to ${workspaceName}.`;
      emitNotice("Access request", success, "GOOD");
      try {
        window.dispatchEvent(new CustomEvent("cb:team:refresh"));
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
      } catch {
        // ignore
      }
      void loadTeamState();
    } catch (error) {
      emitNotice("Request failed", s(error instanceof Error ? error.message : "Request failed."), "WATCH");
    } finally {
      setRequestSubmitBusy(false);
    }
  }, [canonicalShareUrl, isAuthenticated, loadTeamState, normalizedUsername, openAuthRequiredGuard, requestSubmitBusy, workspaceId, workspaceName]);

  const onCopyProfileLink = React.useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      if (!canonicalShareUrl) throw new Error("Profile link unavailable.");
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(canonicalShareUrl);
      emitNotice("Share profile", "Link copied", "GOOD");
    } catch {
      emitNotice("Share profile", "Unable to copy link.", "WATCH");
    } finally {
      setShareBusy(false);
    }
  }, [canonicalShareUrl, shareBusy]);

  const onNativeShareProfile = React.useCallback(async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      if (!canonicalShareUrl) throw new Error("Profile link unavailable.");
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: `${normalizedDisplayName} on CavBot`,
          url: canonicalShareUrl,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(canonicalShareUrl);
        emitNotice("Share profile", "Link copied", "GOOD");
      } else {
        throw new Error("Share unavailable.");
      }
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        return;
      }
      emitNotice("Share profile", "Unable to share this profile.", "WATCH");
    } finally {
      setShareBusy(false);
    }
  }, [canonicalShareUrl, normalizedDisplayName, shareBusy]);

  const onPrimaryButtonClick = React.useCallback(() => {
    if (isOwner) {
      if (onOwnerEditProfileToggle) {
        onOwnerEditProfileToggle();
        return;
      }
      try {
        window.location.assign(editProfileHref);
      } catch {
        // ignore
      }
      return;
    }
    void onSendInvite();
  }, [editProfileHref, isOwner, onOwnerEditProfileToggle, onSendInvite]);

  const onSecondaryButtonClick = React.useCallback(() => {
    if (isOwner) {
      setShareOpen(true);
      return;
    }
    void onRequestAccess();
  }, [isOwner, onRequestAccess]);

  const toggleMembers = React.useCallback(() => {
    if (membersPageMode) return;
    const nextView = membersViewActive ? "overview" : "members";
    if (nextView === "members") {
      void loadMembers({ allowWhenClosed: true, silent: true });
    }
    setMembersViewActive(nextView === "members");
    setPublicProfileView(cacheKey, nextView, "push");
  }, [cacheKey, loadMembers, membersPageMode, membersViewActive]);

  const onOpenMemberProfile = React.useCallback((member: MemberRow) => {
    const handle = s(member.user.username);
    if (!handle) return;
    try {
      window.open(`/${encodeURIComponent(handle)}`, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  }, []);

  const onPromptRevokeMember = React.useCallback((member: MemberRow) => {
    if (!canManageWorkspace) return;
    if (!member.user.id || !normalizedUsername) return;
    const isSelf = Boolean(viewerUserId && member.user.id === viewerUserId);
    if (isSelf || member.role === "OWNER") return;
    setMembersError("");
    setRevokeConfirmTarget(member);
    setRevokeConfirmOpen(true);
  }, [canManageWorkspace, normalizedUsername, viewerUserId]);

  const onConfirmRevokeMember = React.useCallback(async () => {
    const member = revokeConfirmTarget;
    if (!member) return;
    if (!canManageWorkspace) return;
    if (!member.user.id || !normalizedUsername) return;
    const isSelf = Boolean(viewerUserId && member.user.id === viewerUserId);
    if (isSelf || member.role === "OWNER") return;

    setMembersError("");
    setRevokeBusyUserId(member.user.id);
    const prevMembers = members;
    setMembers((current) => current.filter((row) => row.user.id !== member.user.id));

    try {
      const res = await fetch("/api/public/profile/revoke-member", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: csrfJsonHeaders(),
        body: JSON.stringify({
          username: normalizedUsername,
          targetUserId: member.user.id,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || payload.ok !== true) {
        throw new Error(extractErrorMessage(payload, "Failed to revoke member."));
      }

      setRevokeConfirmOpen(false);
      setRevokeConfirmTarget(null);
      emitNotice("Member revoked", `${memberDisplayName(member)} was removed from ${workspaceName}.`, "WATCH");
      try {
        window.dispatchEvent(new CustomEvent("cb:team:refresh"));
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
      } catch {
        // ignore
      }

      if (collabTarget?.user.id === member.user.id) {
        closeCollabModal();
      }
    } catch (error) {
      setMembers(prevMembers);
      setMembersError(s(error instanceof Error ? error.message : "Failed to revoke member."));
    } finally {
      setRevokeBusyUserId("");
    }
  }, [canManageWorkspace, closeCollabModal, collabTarget?.user.id, members, normalizedUsername, revokeConfirmTarget, viewerUserId, workspaceName]);

  const openCollabForMember = React.useCallback((member: MemberRow) => {
    setCollabTarget(member);
    setCollabOpen(true);
    setCollabError("");
    setCollabSuccess("");
    setCollabQuery("");
    setCollabItems([]);
    setCollabSelectedItemId("");
    setCollabPermission("VIEW");
    setCollabSource("cavpad");
  }, []);

  React.useEffect(() => {
    if (!collabOpen || !collabTarget || !canManageWorkspace) return;

    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setCollabLoading(true);
        setCollabError("");
        try {
          const qs = new URLSearchParams();
          qs.set("username", normalizedUsername);
          qs.set("source", collabSource);
          if (s(collabQuery)) qs.set("q", s(collabQuery));
          qs.set("limit", "40");
          const res = await fetch(`/api/public/profile/collab-picker?${qs.toString()}`, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            signal: ctrl.signal,
          });
          const payload = (await res.json().catch(() => ({}))) as CollabPickerResponse;
          if (!res.ok || payload.ok !== true) {
            throw new Error(extractErrorMessage(payload, "Failed to load collaboration items."));
          }

          const nextCavsafeAvailable = payload.cavsafeAvailable === true;
          setCavsafeAvailable(nextCavsafeAvailable);

          const nextItems = (Array.isArray(payload.items) ? payload.items : [])
            .map((row): CollabPickerItem | null => {
              const id = s(row.id);
              const source = toCollabSource(row.source);
              const itemType = toCollabItemType(row.itemType);
              if (!id || !source || !itemType) return null;
              return {
                id,
                source,
                itemType,
                label: s(row.label) || "Untitled",
                subLabel: s(row.subLabel) || "",
                updatedAtISO: s(row.updatedAtISO),
              };
            })
            .filter((row): row is CollabPickerItem => Boolean(row));

          setCollabItems(nextItems);
          setCollabSelectedItemId((current) => {
            if (current && nextItems.some((row) => row.id === current)) return current;
            return nextItems[0]?.id || "";
          });

          if (collabSource === "cavsafe" && !nextCavsafeAvailable) {
            setCollabSource("cavcloud");
          }
        } catch (error) {
          if ((error as { name?: string } | null)?.name === "AbortError") return;
          setCollabItems([]);
          setCollabSelectedItemId("");
          setCollabError(s(error instanceof Error ? error.message : "Failed to load collaboration items."));
        } finally {
          setCollabLoading(false);
        }
      })();
    }, 140);

    return () => {
      window.clearTimeout(timer);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [canManageWorkspace, collabOpen, collabQuery, collabSource, collabTarget, normalizedUsername]);

  const selectedCollabItem = React.useMemo(
    () => collabItems.find((row) => row.id === collabSelectedItemId) || null,
    [collabItems, collabSelectedItemId]
  );

  const onCreateCollab = React.useCallback(async () => {
    if (!collabTarget?.user.id) {
      setCollabError("Select a member.");
      return;
    }
    if (!selectedCollabItem) {
      setCollabError("Select an item to collaborate on.");
      return;
    }

    setCollabBusy(true);
    setCollabError("");
    setCollabSuccess("");
    try {
      const res = await fetch("/api/public/profile/collab", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: csrfJsonHeaders(),
        body: JSON.stringify({
          username: normalizedUsername,
          targetUserId: collabTarget.user.id,
          source: selectedCollabItem.source,
          itemType: selectedCollabItem.itemType,
          itemId: selectedCollabItem.id,
          permission: collabPermission,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || payload.ok !== true) {
        throw new Error(extractErrorMessage(payload, "Failed to create collaboration."));
      }

      const success = `Collaboration started with ${memberDisplayName(collabTarget)}.`;
      setCollabSuccess(success);
      emitNotice("Collab created", success, "GOOD");
      try {
        window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
        window.dispatchEvent(new CustomEvent("cb:team:refresh"));
      } catch {
        // ignore
      }
    } catch (error) {
      setCollabError(s(error instanceof Error ? error.message : "Failed to create collaboration."));
    } finally {
      setCollabBusy(false);
    }
  }, [collabPermission, collabTarget, normalizedUsername, selectedCollabItem]);

  const collabSourceOptions = React.useMemo(() => {
    const base: Array<{ value: CollabSource; label: string }> = [
      { value: "cavpad", label: "CavPad" },
      { value: "cavcloud", label: "CavCloud" },
    ];
    if (cavsafeAvailable) base.push({ value: "cavsafe", label: "CavSafe" });
    return base;
  }, [cavsafeAvailable]);
  const revokeConfirmBusy = Boolean(revokeConfirmTarget?.user.id && revokeBusyUserId === revokeConfirmTarget.user.id);

  if (!normalizedUsername) return null;
  const modalHost = typeof document !== "undefined" ? document.body : null;

  const modalLayer = (
    <>
      {shareOpen && isOwner ? (
        <div className="cb-modal pp-modalRoot" role="dialog" aria-modal="true" aria-label={`Share @${normalizedUsername}`}>
          <div className="cb-modal-backdrop pp-modalBackdrop" onClick={closeShareModal} />
          <div className="cb-modal-card pp-modalCard">
            <div className="cb-modal-top">
              <div className="cb-modal-title">Share profile</div>
              <button type="button" className="cb-modal-close" onClick={closeShareModal} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cb-modal-body">
              <div className="cb-modal-section">
                <div className="cb-modal-label">Profile link</div>
                <input className="pp-field" value={canonicalShareUrl} disabled />
              </div>
            </div>
            <div className="cb-modal-actions">
              <button type="button" className="cb-modal-action" onClick={closeShareModal} disabled={shareBusy}>
                Close
              </button>
              <button type="button" className="cb-modal-action" onClick={() => void onCopyProfileLink()} disabled={shareBusy}>
                Copy link
              </button>
              <button type="button" className="cb-modal-action cb-modal-actionPrimary" onClick={() => void onNativeShareProfile()} disabled={shareBusy}>
                Share...
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {collabOpen && collabTarget ? (
        <div className="cb-modal pp-modalRoot" role="dialog" aria-modal="true" aria-label={`Collaborate with ${memberDisplayName(collabTarget)}`}>
          <div className="cb-modal-backdrop pp-modalBackdrop" onClick={closeCollabModal} />
          <div className="cb-modal-card pp-modalCard">
            <div className="cb-modal-top">
              <div className="cb-modal-title">Create collaboration</div>
              <button type="button" className="cb-modal-close" onClick={closeCollabModal} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cb-modal-body">
              <div className="cb-modal-section">
                <div className="cb-modal-label">Member</div>
                <input className="pp-field" value={memberDisplayName(collabTarget)} disabled />
              </div>
              <div className="cb-modal-section">
                <div className="cb-modal-label">Source</div>
                <select
                  className="pp-field"
                  value={collabSource}
                  onChange={(event) => setCollabSource((toCollabSource(event.currentTarget.value) || "cavpad"))}
                  disabled={collabBusy}
                >
                  {collabSourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="cb-modal-section">
                <div className="cb-modal-label">Search</div>
                <input
                  className="pp-field"
                  value={collabQuery}
                  onChange={(event) => setCollabQuery(event.currentTarget.value)}
                  placeholder="Filter by title or path"
                  disabled={collabBusy}
                />
              </div>
              <div className="cb-modal-section">
                <div className="cb-modal-label">Permission</div>
                <select
                  className="pp-field"
                  value={collabPermission}
                  onChange={(event) => setCollabPermission(event.currentTarget.value === "EDIT" ? "EDIT" : "VIEW")}
                  disabled={collabBusy || collabSource === "cavsafe"}
                >
                  <option value="VIEW">View</option>
                  {collabSource !== "cavsafe" ? <option value="EDIT">Edit</option> : null}
                </select>
              </div>
              <div className="cb-modal-section">
                <div className="cb-modal-label">Items</div>
                {collabLoading ? (
                  <div className="pp-empty">Loading items…</div>
                ) : collabItems.length ? (
                  <div className="pp-collabItems" role="listbox" aria-label="Collaboration items">
                    {collabItems.map((item) => {
                      const selected = item.id === collabSelectedItemId;
                      return (
                        <button
                          type="button"
                          key={`${item.source}:${item.itemType}:${item.id}`}
                          className={`pp-collabItem${selected ? " is-selected" : ""}`}
                          onClick={() => setCollabSelectedItemId(item.id)}
                        >
                          <span className="pp-collabItemLabel">{item.label}</span>
                          <span className="pp-collabItemSub">{item.subLabel || `${item.source} ${item.itemType}`}</span>
                          <span className="pp-collabItemDate">{formatDayLabel(item.updatedAtISO)}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pp-empty">No items found for this source.</div>
                )}
              </div>

              {selectedCollabItem ? (
                <div className="pp-fieldHint">
                  Selected: <strong>{selectedCollabItem.label}</strong> ({selectedCollabItem.source}/{selectedCollabItem.itemType})
                </div>
              ) : null}
              {collabError ? <div className="pp-modalError">{collabError}</div> : null}
              {collabSuccess ? <div className="pp-modalSuccess">{collabSuccess}</div> : null}
            </div>
            <div className="cb-modal-actions">
              <button type="button" className="cb-modal-action" onClick={closeCollabModal} disabled={collabBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-modal-action cb-modal-actionPrimary"
                onClick={() => void onCreateCollab()}
                disabled={collabBusy || !selectedCollabItem}
              >
                {collabBusy ? "Creating…" : "Create collab"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revokeConfirmOpen && revokeConfirmTarget ? (
        <div
          className="cb-modal pp-modalRoot"
          role="dialog"
          aria-modal="true"
          aria-label={`Revoke ${memberDisplayName(revokeConfirmTarget)}`}
        >
          <div className="cb-modal-backdrop pp-modalBackdrop" onClick={closeRevokeConfirmModal} />
          <div className="cb-modal-card pp-modalCard pp-revokeModalCard">
            <div className="cb-modal-top">
              <div className="cb-modal-title">Revoke member access</div>
              <button type="button" className="cb-modal-close" onClick={closeRevokeConfirmModal} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>
            <div className="cb-modal-body pp-revokeModalBody">
              <div className="cb-modal-section">
                <div className="cb-modal-label">Member</div>
                <input className="pp-field" value={memberDisplayName(revokeConfirmTarget)} disabled />
              </div>
              <div className="cb-modal-section">
                <div className="cb-modal-label">Confirmation</div>
                <div className="pp-revokeConfirmText">
                  {`Are you sure you would like to revoke ${memberDisplayName(revokeConfirmTarget)}?`}
                </div>
                <div className="pp-fieldHint">
                  This action removes all access immediately, clears member-level collaboration access, and cannot be undone.
                </div>
              </div>
            </div>
            <div className="cb-modal-actions pp-revokeModalActions">
              <button type="button" className="cb-modal-action" onClick={closeRevokeConfirmModal} disabled={revokeConfirmBusy}>
                Cancel
              </button>
              <button
                type="button"
                className="cb-modal-action cb-modal-actionPrimary"
                onClick={() => void onConfirmRevokeMember()}
                disabled={revokeConfirmBusy}
              >
                {revokeConfirmBusy ? "Revoking…" : "Revoke access"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CavGuardModal
        open={cavGuardOpen}
        decision={cavGuardDecision}
        onClose={closeCavGuardModal}
        onCtaClick={closeCavGuardModal}
      />
    </>
  );

  return (
    <>
      {showActionBar ? (
        <div
          className={`pp-profileTeamActions${membersPageMode ? " pp-profileTeamActionsPage" : ""}`}
          aria-label="Workspace actions"
          data-has-emoji={membersPageMode ? "0" : "1"}
        >
          <button
            type="button"
            className="pp-profileTeamBtn pp-profileTeamBtnPrimary"
            onClick={onPrimaryButtonClick}
            disabled={!isOwner && inviteSubmitBusy}
          >
            {isOwner ? "Edit profile" : "Invite"}
          </button>

          <button
            type="button"
            className="pp-profileTeamBtn"
            onClick={onSecondaryButtonClick}
            disabled={!isOwner && requestSubmitBusy}
          >
            {isOwner ? "Share profile" : "Request access"}
          </button>
          {!membersPageMode ? (
            <button
              type="button"
              className="pp-profileTeamBtn pp-profileTeamEmojiBtn"
              onClick={toggleMembers}
              aria-pressed={membersViewActive ? "true" : "false"}
              title={membersViewActive ? "Close workspace members page" : "Open workspace members page"}
              aria-label={membersViewActive ? "Close workspace members page" : "Open workspace members page"}
            >
              <span className="pp-profileTeamEmojiIcon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {teamStateError ? <div className="pp-modalError">{teamStateError}</div> : null}

      {membersOpen ? (
        <section className={`pp-profileMembers${membersPageMode ? " pp-profileMembersPage" : ""}`} aria-label="Workspace members">
          <div className="pp-profileMembersHead">
            <div className="pp-profileMembersHeadTop">
              {showMembersTotal ? (
                <div className="pp-profileMembersMeta">
                  {filteredMembers.length}
                  {membersSearchNeedle ? ` of ${members.length}` : ""}
                  {" "}total
                </div>
              ) : null}
            </div>
          </div>

          {membersAccessPending ? null : !canManageWorkspace ? (
            <div className="pp-empty">Members list is only visible to workspace owners/admins.</div>
          ) : membersError ? (
            <div className="pp-modalError">{membersError}</div>
          ) : filteredMembers.length ? (
            <div className="pp-membersGrid" role="list" aria-label="Workspace members">
              {filteredMembers.map((member) => {
                const isSelf = Boolean(viewerUserId && member.user.id === viewerUserId);
                const canRevoke = canManageWorkspace && !isSelf && member.role !== "OWNER";
                const revokeBusy = revokeBusyUserId === member.user.id;
                return (
                  <article className="pp-memberCard" role="listitem" key={member.membershipId}>
                    <button
                      type="button"
                      className="pp-memberCardMain"
                      onClick={() => onOpenMemberProfile(member)}
                      disabled={!member.user.username}
                    >
                      <span className="pp-memberAvatar" data-tone={member.user.avatarTone || "lime"} aria-hidden="true">
                        {member.user.avatarImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="pp-memberAvatarImg" src={member.user.avatarImage} alt="" decoding="async" loading="eager" />
                        ) : (
                          <span className="pp-memberAvatarInitials">{memberInitials(member)}</span>
                        )}
                      </span>
                      <div className="pp-memberCardName">{memberDisplayName(member)}</div>
                      <div className="pp-memberCardSub">{memberSubLabel(member)}</div>
                      <div className="pp-memberCardRole" data-role={member.role}>
                        {member.role}
                      </div>
                    </button>

                    {canManageWorkspace ? (
                      <div className="pp-memberCardActions">
                        <button
                          type="button"
                          className="pp-profileTeamBtn"
                          onClick={() => openCollabForMember(member)}
                          disabled={isSelf}
                        >
                          Collab
                        </button>
                        <button
                          type="button"
                          className="pp-profileTeamBtn"
                          onClick={() => onPromptRevokeMember(member)}
                          disabled={!canRevoke || revokeBusy}
                        >
                          {revokeBusy ? "Revoking…" : "Revoke"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : membersLoading ? null : (
            <div className="pp-empty">{membersSearchNeedle ? "No members match your search." : "No members found."}</div>
          )}
        </section>
      ) : null}

      {modalHost ? createPortal(modalLayer, modalHost) : modalLayer}
    </>
  );
}
