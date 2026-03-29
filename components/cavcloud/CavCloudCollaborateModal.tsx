"use client";

import Image from "next/image";
import React from "react";

import "./cavcloud-collab-modal.css";

type CavCloudCollaborateModalProps = {
  open: boolean;
  resourceType: "FILE" | "FOLDER";
  resourceId: string | null;
  resourceName?: string;
  resourcePath?: string | null;
  onClose: () => void;
};

type LookupUser = {
  userId: string;
  username: string | null;
  displayName: string | null;
  email?: string | null;
  avatarUrl: string | null;
  avatarTone?: string | null;
  isWorkspaceMember: boolean;
};

type DirectPermission = "VIEW" | "EDIT";
type ExpiryDays = 0 | 1 | 7 | 30;

type AccessRow = {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  avatarTone?: string | null;
  permission: DirectPermission;
  expiresAtISO: string | null;
};

type AccessDraft = {
  permission: DirectPermission;
  expiresInDays: ExpiryDays;
};

type AccessResponse = {
  ok?: boolean;
  accessList?: AccessRow[];
};

type SendShareResponse = {
  ok?: boolean;
  accessList?: AccessRow[];
  sent?: Array<{
    userId?: string;
  }>;
};

type LookupResponse = {
  ok?: boolean;
  users?: LookupUser[];
};

type MeResponse = {
  ok?: boolean;
  user?: {
    username?: string | null;
    displayName?: string | null;
    email?: string | null;
    avatarImage?: string | null;
    avatarTone?: string | null;
  };
};

type LinkShareResponse = {
  ok?: boolean;
  shareUrl?: string;
  expiresAtISO?: string;
  message?: string;
};

const ACCESS_POLICY_OPTIONS: Array<{ value: "anyone" | "cavbotUsers" | "workspaceMembers"; label: string }> = [
  { value: "anyone", label: "Anyone" },
  { value: "cavbotUsers", label: "CavBot users" },
  { value: "workspaceMembers", label: "Workspace members" },
];

const EXPIRY_OPTIONS: Array<{ value: ExpiryDays; label: string }> = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 0, label: "Never" },
];

const LINK_EXPIRY_OPTIONS: Array<{ value: 1 | 7 | 30; label: string }> = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
];

function normalizeId(raw: unknown): string {
  return String(raw || "").trim();
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...init,
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } & T | null;
  if (!res.ok || body?.ok === false) {
    throw new Error(String(body?.message || body?.error || "Request failed."));
  }
  return body as T;
}

function parseUsernameLookup(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const parts = url.pathname.split("/").filter(Boolean);
      if (!parts.length) return "";
      if (String(parts[0] || "").toLowerCase() === "u" && parts[1]) {
        return `@${String(parts[1]).replace(/^@+/, "")}`;
      }
      return `@${String(parts[parts.length - 1] || "").replace(/^@+/, "")}`;
    } catch {
      return input;
    }
  }

  return input;
}

function expiryDaysFromIso(expiresAtISO: string | null): ExpiryDays {
  if (!expiresAtISO) return 0;
  const ts = Date.parse(expiresAtISO);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  return 30;
}

function expiresLabel(expiresAtISO: string | null): string {
  if (!expiresAtISO) return "Never";
  const ts = Date.parse(expiresAtISO);
  if (!Number.isFinite(ts)) return "Never";
  const remainingDays = Math.ceil((ts - Date.now()) / (24 * 60 * 60 * 1000));
  if (remainingDays <= 0) return "Expired";
  if (remainingDays === 1) return "Expires in 1 day";
  return `Expires in ${remainingDays} days`;
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

function avatarInitials(user: {
  username?: string | null;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
}): string {
  const display = String(user.displayName || "").trim();
  if (display) {
    const parts = display.split(/\s+/g).filter(Boolean);
    if (parts.length >= 2) {
      const duo = `${firstInitialChar(parts[0] || "")}${firstInitialChar(parts[1] || "")}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(parts[0] || "");
    if (single) return single;
  }

  const usernameInitial = firstInitialChar(normalizeInitialUsernameSource(String(user.username || "")));
  if (usernameInitial) return usernameInitial;

  const email = String(user.email || "").trim();
  if (email) {
    const emailInitial = firstInitialChar(email.split("@")[0] || "");
    if (emailInitial) return emailInitial;
  }

  const userIdInitial = firstInitialChar(String(user.userId || ""));
  if (userIdInitial) return userIdInitial;

  return "C";
}

function normalizeAvatarTone(tone: unknown): "lime" | "blue" | "violet" | "white" | "navy" | "transparent" {
  const normalized = String(tone || "").trim().toLowerCase();
  if (normalized === "blue") return "blue";
  if (normalized === "violet") return "violet";
  if (normalized === "white") return "white";
  if (normalized === "navy") return "navy";
  if (normalized === "transparent" || normalized === "clear") return "transparent";
  return "lime";
}

function avatarStyle(args: { avatarTone?: string | null; avatarUrl?: string | null }): React.CSSProperties {
  const hasAvatar = Boolean(normalizeId(args.avatarUrl || ""));
  const tone = normalizeAvatarTone(args.avatarTone);
  const backgroundColor = hasAvatar
    ? "rgba(0,0,0,0.24)"
    : tone === "transparent"
      ? "transparent"
      : tone === "violet"
        ? "rgba(139,92,255,0.22)"
        : tone === "blue"
          ? "rgba(78,168,255,0.22)"
          : tone === "white"
            ? "rgba(255,255,255,0.92)"
            : tone === "navy"
              ? "rgba(1,3,15,0.78)"
              : "rgba(185,200,90,0.92)";
  const color = tone === "transparent"
    ? "var(--lime)"
    : tone === "violet" || tone === "blue" || tone === "navy"
      ? "rgba(247,251,255,0.96)"
      : "rgba(1,3,15,0.92)";
  return { backgroundColor, color };
}

function CollaboratorAvatar(props: {
  user: {
    userId?: string | null;
    username?: string | null;
    displayName?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    avatarTone?: string | null;
  };
  className?: string;
}) {
  const { user, className } = props;
  const toneStyle = avatarStyle({ avatarTone: user.avatarTone || null, avatarUrl: user.avatarUrl || null });
  return (
    <span className={`cc-collabAvatar cc-collabAvatarFrame${className ? ` ${className}` : ""}`} style={toneStyle} aria-hidden="true">
      <span className="cc-collabAvatarInitials">{avatarInitials(user)}</span>
      {user.avatarUrl ? (
        <Image
          className="cc-collabAvatarImg"
          src={user.avatarUrl}
          alt=""
          width={24}
          height={24}
          unoptimized
        />
      ) : null}
    </span>
  );
}

function uniqueRecipients(items: LookupUser[]): LookupUser[] {
  const seen = new Set<string>();
  const out: LookupUser[] = [];
  for (const item of items) {
    const userId = normalizeId(item.userId);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push(item);
  }
  return out;
}

function userLabel(row: { displayName?: string | null; username?: string | null; email?: string | null; userId?: string | null }): string {
  const displayName = String(row.displayName || "").trim();
  if (displayName) return displayName;
  const username = String(row.username || "").trim();
  if (username) return `@${username}`;
  const email = String(row.email || "").trim();
  if (email) return email;
  return String(row.userId || "").trim() || "CavCloud user";
}

function userSubLabel(row: { username?: string | null; email?: string | null; userId?: string | null }): string {
  const username = String(row.username || "").trim();
  if (username) return `@${username}`;
  const email = String(row.email || "").trim();
  if (email) return email;
  return String(row.userId || "").trim() || "CavCloud user";
}

export function CavCloudCollaborateModal(props: CavCloudCollaborateModalProps) {
  const { open, resourceType, resourceId, resourceName, resourcePath, onClose } = props;

  const activeResourceId = normalizeId(resourceId);
  const targetType = resourceType === "FOLDER" ? "folder" : "file";
  const cavSafeBlocked = String(resourcePath || "").toLowerCase().includes("/cavsafe");

  const [statusMessage, setStatusMessage] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");

  const [lookupQuery, setLookupQuery] = React.useState<string>("");
  const [lookupBusy, setLookupBusy] = React.useState<boolean>(false);
  const [lookupResults, setLookupResults] = React.useState<LookupUser[]>([]);
  const [recipients, setRecipients] = React.useState<LookupUser[]>([]);

  const [permissionChoice, setPermissionChoice] = React.useState<DirectPermission>("VIEW");
  const [expiryChoice, setExpiryChoice] = React.useState<ExpiryDays>(7);
  const [sendBusy, setSendBusy] = React.useState<boolean>(false);

  const [accessBusy, setAccessBusy] = React.useState<boolean>(false);
  const [accessList, setAccessList] = React.useState<AccessRow[]>([]);
  const [accessDrafts, setAccessDrafts] = React.useState<Record<string, AccessDraft>>({});
  const [accessActionBusyId, setAccessActionBusyId] = React.useState<string>("");

  const [ownerLabel, setOwnerLabel] = React.useState<string>("Owner (you)");
  const [ownerProfile, setOwnerProfile] = React.useState<{
    username: string | null;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
    avatarTone: string | null;
  }>({
    username: null,
    displayName: null,
    email: null,
    avatarUrl: null,
    avatarTone: null,
  });

  const [linkPolicy, setLinkPolicy] = React.useState<"anyone" | "cavbotUsers" | "workspaceMembers">("anyone");
  const [linkExpiryDays, setLinkExpiryDays] = React.useState<1 | 7 | 30>(7);
  const [linkBusy, setLinkBusy] = React.useState<boolean>(false);
  const [copyBusy, setCopyBusy] = React.useState<boolean>(false);
  const [linkUrl, setLinkUrl] = React.useState<string>("");
  const [linkExpiresAtISO, setLinkExpiresAtISO] = React.useState<string>("");

  const modalTitle = resourceType === "FOLDER" ? "Share folder" : "Share file";

  const emitShareAccessChanged = React.useCallback(() => {
    if (typeof window === "undefined" || !activeResourceId) return;
    window.dispatchEvent(new CustomEvent("cavcloud:share-access-changed", {
      detail: {
        targetType,
        targetId: activeResourceId,
      },
    }));
  }, [activeResourceId, targetType]);

  const hydrateDrafts = React.useCallback((rows: AccessRow[]) => {
    const next: Record<string, AccessDraft> = {};
    for (const row of rows) {
      const id = normalizeId(row.id);
      if (!id) continue;
      next[id] = {
        permission: row.permission === "EDIT" ? "EDIT" : "VIEW",
        expiresInDays: expiryDaysFromIso(row.expiresAtISO || null),
      };
    }
    setAccessDrafts(next);
  }, []);

  const loadOwner = React.useCallback(async () => {
    try {
      const me = await readJson<MeResponse>("/api/auth/me");
      const username = normalizeId(me.user?.username);
      const displayName = normalizeId(me.user?.displayName);
      const email = normalizeId(me.user?.email);
      const avatarUrl = normalizeId(me.user?.avatarImage);
      const avatarTone = normalizeId(me.user?.avatarTone);
      setOwnerProfile({
        username: username || null,
        displayName: displayName || null,
        email: email || null,
        avatarUrl: avatarUrl || null,
        avatarTone: avatarTone || null,
      });
      if (username) {
        setOwnerLabel(`Owner (you) • @${username}`);
        return;
      }
      if (displayName) {
        setOwnerLabel(`Owner (you) • ${displayName}`);
        return;
      }
      if (email) {
        setOwnerLabel(`Owner (you) • ${email}`);
        return;
      }
      setOwnerLabel("Owner (you)");
    } catch {
      setOwnerProfile({
        username: null,
        displayName: null,
        email: null,
        avatarUrl: null,
        avatarTone: null,
      });
      setOwnerLabel("Owner (you)");
    }
  }, []);

  const loadAccessList = React.useCallback(async () => {
    if (!activeResourceId) return;
    setAccessBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        targetType,
        targetId: activeResourceId,
      });
      const body = await readJson<AccessResponse>(`/api/cavcloud/shares/user?${params.toString()}`);
      const rows = Array.isArray(body.accessList) ? body.accessList : [];
      setAccessList(rows);
      hydrateDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load access list.");
    } finally {
      setAccessBusy(false);
    }
  }, [activeResourceId, hydrateDrafts, targetType]);

  React.useEffect(() => {
    if (!open) return;
    if (!activeResourceId) {
      setError("Resource unavailable.");
      return;
    }

    setError("");
    setStatusMessage("");
    setLookupQuery("");
    setLookupResults([]);
    setRecipients([]);
    setLinkUrl("");
    setLinkExpiresAtISO("");

    void Promise.all([loadOwner(), loadAccessList()]);
  }, [activeResourceId, loadAccessList, loadOwner, open]);

  React.useEffect(() => {
    if (!open) return;
    const raw = lookupQuery.trim();
    if (!raw || cavSafeBlocked) {
      setLookupResults([]);
      return;
    }

    const lookup = parseUsernameLookup(raw);
    const t = window.setTimeout(() => {
      setLookupBusy(true);
      setError("");
      void readJson<LookupResponse>(`/api/users/lookup?q=${encodeURIComponent(lookup)}`)
        .then((body) => {
          const rows = Array.isArray(body.users) ? body.users : [];
          const recipientIds = new Set(recipients.map((recipient) => recipient.userId));
          setLookupResults(rows.filter((row) => !recipientIds.has(row.userId)));
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to lookup users.");
        })
        .finally(() => {
          setLookupBusy(false);
        });
    }, 180);

    return () => window.clearTimeout(t);
  }, [cavSafeBlocked, lookupQuery, open, recipients]);

  const addRecipient = React.useCallback((user: LookupUser) => {
    setRecipients((prev) => uniqueRecipients([...prev, user]));
    setLookupResults((prev) => prev.filter((entry) => entry.userId !== user.userId));
    setLookupQuery("");
  }, []);

  const removeRecipient = React.useCallback((userId: string) => {
    const id = normalizeId(userId);
    if (!id) return;
    setRecipients((prev) => prev.filter((entry) => entry.userId !== id));
  }, []);

  const sendToRecipients = React.useCallback(async () => {
    if (!activeResourceId || !recipients.length) {
      setError("Add at least one recipient.");
      return;
    }

    setSendBusy(true);
    setError("");
    setStatusMessage("");

    try {
      const body = await readJson<SendShareResponse>("/api/cavcloud/shares/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetType,
          targetId: activeResourceId,
          recipients: recipients.map((recipient) => ({
            userId: recipient.userId,
            permission: permissionChoice,
          })),
          expiresInDays: expiryChoice,
        }),
      });

      const rows = Array.isArray(body.accessList) ? body.accessList : [];
      setAccessList(rows);
      hydrateDrafts(rows);

      const sentTo = recipients
        .map((recipient) => userLabel(recipient))
        .join(", ");
      setStatusMessage(sentTo ? `Sent to ${sentTo}.` : "Share sent.");
      setRecipients([]);
      setLookupResults([]);
      setLookupQuery("");
      emitShareAccessChanged();

      window.dispatchEvent(new CustomEvent("cb:notifications:refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share.");
    } finally {
      setSendBusy(false);
    }
  }, [activeResourceId, emitShareAccessChanged, expiryChoice, hydrateDrafts, permissionChoice, recipients, targetType]);

  const updateAccess = React.useCallback(async (row: AccessRow) => {
    const id = normalizeId(row.id);
    if (!id) return;

    const draft = accessDrafts[id];
    if (!draft) return;

    const unchanged = draft.permission === row.permission
      && draft.expiresInDays === expiryDaysFromIso(row.expiresAtISO || null);
    if (unchanged) return;

    setAccessActionBusyId(id);
    setError("");
    setStatusMessage("");

    try {
      const body = await readJson<SendShareResponse>(`/api/cavcloud/shares/user/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permission: draft.permission,
          expiresInDays: draft.expiresInDays,
        }),
      });

      const rows = Array.isArray(body.accessList) ? body.accessList : [];
      setAccessList(rows);
      hydrateDrafts(rows);
      setStatusMessage("Access updated.");
      emitShareAccessChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update access.");
    } finally {
      setAccessActionBusyId("");
    }
  }, [accessDrafts, emitShareAccessChanged, hydrateDrafts]);

  const revokeAccess = React.useCallback(async (row: AccessRow) => {
    const id = normalizeId(row.id);
    if (!id) return;

    setAccessActionBusyId(id);
    setError("");
    setStatusMessage("");

    try {
      const body = await readJson<SendShareResponse>(`/api/cavcloud/shares/user/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const rows = Array.isArray(body.accessList) ? body.accessList : [];
      setAccessList(rows);
      hydrateDrafts(rows);
      setStatusMessage("Access revoked.");
      emitShareAccessChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke access.");
    } finally {
      setAccessActionBusyId("");
    }
  }, [emitShareAccessChanged, hydrateDrafts]);

  const createLinkShare = React.useCallback(async () => {
    if (!activeResourceId) return;

    setLinkBusy(true);
    setError("");
    setStatusMessage("");
    try {
      const body = await readJson<LinkShareResponse>("/api/cavcloud/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind: targetType,
          id: activeResourceId,
          expiresInDays: linkExpiryDays,
          accessPolicy: linkPolicy,
        }),
      });
      const nextUrl = normalizeId(body.shareUrl);
      if (!nextUrl) throw new Error("Share link unavailable.");
      setLinkUrl(nextUrl);
      setLinkExpiresAtISO(normalizeId(body.expiresAtISO));
      setStatusMessage("Share link generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link.");
    } finally {
      setLinkBusy(false);
    }
  }, [activeResourceId, linkExpiryDays, linkPolicy, targetType]);

  const copyResolverLink = React.useCallback(async () => {
    const value = linkUrl.trim();
    if (!value) return;
    setCopyBusy(true);
    setError("");
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("Clipboard unavailable.");
      }
      setStatusMessage("Resolver link copied.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy link.");
    } finally {
      setCopyBusy(false);
    }
  }, [linkUrl]);

  if (!open) return null;

  return (
    <div className="cc-collabOverlay" role="dialog" aria-modal="true" aria-labelledby="cc-collab-title" onClick={onClose}>
      <div className="cc-collabCard" onClick={(event) => event.stopPropagation()}>
        <div className="cc-collabHead">
          <div>
            <h3 className="cc-collabTitle" id="cc-collab-title">{modalTitle}</h3>
            <div className="cc-collabSubtitle">{resourceName ? resourceName : activeResourceId}</div>
          </div>
          <button className="cc-collabClose" type="button" onClick={onClose} aria-label="Close share modal">
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </div>

        {error ? <div className="cc-collabError">{error}</div> : null}
        {statusMessage ? <div className="cc-collabStatus">{statusMessage}</div> : null}

        {cavSafeBlocked ? (
          <div className="cc-collabSection">
            <div className="cc-collabSectionTitle">Sharing unavailable</div>
            <div className="cc-collabHint">CavSafe items can’t be shared. Publish an evidence artifact instead.</div>
          </div>
        ) : (
          <>
            <div className="cc-collabSection">
              <div className="cc-collabSectionTitle">Share with CavBot user</div>
              <div className="cc-collabHint">Search by @username, display name, or paste a profile URL.</div>

              <div className="cc-collabRow cc-collabRowSingle">
                <label className="cc-collabField">
                  <span>Recipient lookup</span>
                  <input
                    className="cc-collabInput"
                    value={lookupQuery}
                    onChange={(event) => setLookupQuery(event.currentTarget.value)}
                    placeholder="@username or https://..."
                    autoComplete="off"
                    spellCheck={false}
                    disabled={sendBusy}
                  />
                </label>
              </div>

              {recipients.length ? (
                <div className="cc-collabChips" aria-label="Selected recipients">
                  {recipients.map((recipient) => (
                    <div className="cc-collabChip" key={recipient.userId}>
                      <span className="cc-collabChipLabel">
                        {userLabel(recipient)}
                      </span>
                      <button
                        className="cc-collabChipRemove"
                        type="button"
                        onClick={() => removeRecipient(recipient.userId)}
                        aria-label={`Remove ${userLabel(recipient)}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {lookupQuery.trim() ? (
                <div className="cc-collabLookupList" role="listbox" aria-label="Recipient search results">
                  {lookupBusy ? (
                    <div className="cc-collabEmpty">Searching...</div>
                  ) : !lookupResults.length ? (
                    <div className="cc-collabEmpty">No matching CavBot users.</div>
                  ) : (
                    lookupResults.map((result) => (
                      <button
                        key={result.userId}
                        className="cc-collabLookupItem"
                        type="button"
                        onClick={() => addRecipient(result)}
                      >
                        <CollaboratorAvatar user={result} />
                        <span className="cc-collabLookupMeta">
                          <span className="cc-collabLookupTitle">{userLabel(result)}</span>
                          <span className="cc-collabLookupSub">{userSubLabel(result)}</span>
                        </span>
                        {result.isWorkspaceMember ? <span className="cc-collabLookupBadge">Workspace member</span> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              <div className="cc-collabRow">
                <label className="cc-collabField">
                  <span>Permission</span>
                  <select
                    className="cc-collabInput"
                    value={permissionChoice}
                    onChange={(event) => {
                      const next = normalizeId(event.currentTarget.value).toUpperCase();
                      setPermissionChoice(next === "EDIT" ? "EDIT" : "VIEW");
                    }}
                    disabled={sendBusy}
                  >
                    <option value="VIEW">Read-only</option>
                    <option value="EDIT">Collaborate</option>
                  </select>
                </label>
                <label className="cc-collabField">
                  <span>Expiry</span>
                  <select
                    className="cc-collabInput"
                    value={String(expiryChoice)}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      const safe: ExpiryDays = next === 1 || next === 7 || next === 30 ? next : 0;
                      setExpiryChoice(safe);
                    }}
                    disabled={sendBusy}
                  >
                    {EXPIRY_OPTIONS.map((choice) => (
                      <option key={choice.value} value={choice.value}>{choice.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="cc-collabActions">
                <button
                  className="cc-collabBtn"
                  type="button"
                  onClick={() => void sendToRecipients()}
                  disabled={sendBusy || !recipients.length || !activeResourceId}
                >
                  {sendBusy ? "Sending..." : "Send"}
                </button>
              </div>
            </div>

            <div className="cc-collabSection">
              <div className="cc-collabSectionTitle">Share link</div>
              <div className="cc-collabRow">
                <label className="cc-collabField">
                  <span>Visibility</span>
                  <select
                    className="cc-collabInput"
                    value={linkPolicy}
                    onChange={(event) => {
                      const next = normalizeId(event.currentTarget.value);
                      if (next === "cavbotUsers" || next === "workspaceMembers") {
                        setLinkPolicy(next);
                        return;
                      }
                      setLinkPolicy("anyone");
                    }}
                    disabled={linkBusy}
                  >
                    {ACCESS_POLICY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="cc-collabField">
                  <span>Expiry</span>
                  <select
                    className="cc-collabInput"
                    value={String(linkExpiryDays)}
                    onChange={(event) => {
                      const next = Number(event.currentTarget.value);
                      const safe: 1 | 7 | 30 = next === 1 || next === 30 ? next : 7;
                      setLinkExpiryDays(safe);
                    }}
                    disabled={linkBusy}
                  >
                    {LINK_EXPIRY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="cc-collabActions cc-collabActionsSplit">
                <a
                  className={`cc-collabTextAction${linkBusy || !activeResourceId ? " is-disabled" : ""}`}
                  role="button"
                  href={linkBusy || !activeResourceId ? undefined : "#"}
                  aria-disabled={linkBusy || !activeResourceId ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (linkBusy || !activeResourceId) {
                      return;
                    }
                    void createLinkShare();
                  }}
                >
                  {linkBusy ? "Generating..." : "Generate link"}
                </a>
                <a
                  className={`cc-collabTextAction${!linkUrl || copyBusy ? " is-disabled" : ""}`}
                  role="button"
                  href={!linkUrl || copyBusy ? undefined : "#"}
                  aria-disabled={!linkUrl || copyBusy ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!linkUrl || copyBusy) {
                      return;
                    }
                    void copyResolverLink();
                  }}
                >
                  {copyBusy ? "Copying..." : "Copy resolver link"}
                </a>
              </div>

              {linkUrl ? (
                <div className="cc-collabRow cc-collabRowSingle">
                  <label className="cc-collabField">
                    <span>Resolver URL</span>
                    <input className="cc-collabInput cc-collabInputMono" value={linkUrl} readOnly />
                    <span className="cc-collabFieldHint">{linkExpiresAtISO ? expiresLabel(linkExpiresAtISO) : "Active"}</span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className="cc-collabSection">
              <div className="cc-collabSectionTitle">People with access</div>
              <div className="cc-collabList">
                <div className="cc-collabItem">
                  <div className="cc-collabItemMetaHead">
                    <CollaboratorAvatar
                      className="cc-collabItemAvatar"
                      user={{
                        userId: "owner",
                        username: ownerProfile.username,
                        displayName: ownerProfile.displayName,
                        email: ownerProfile.email,
                        avatarUrl: ownerProfile.avatarUrl,
                        avatarTone: ownerProfile.avatarTone,
                      }}
                    />
                    <div className="cc-collabItemMeta">
                      <div className="cc-collabItemTitle">{ownerLabel}</div>
                      <div className="cc-collabItemSub">Owner • Full access</div>
                    </div>
                  </div>
                </div>

                {!accessList.length && !accessBusy ? (
                  <div className="cc-collabEmpty">No direct user shares yet.</div>
                ) : null}

                {accessList.map((row) => {
                  const draft = accessDrafts[row.id] || {
                    permission: row.permission,
                    expiresInDays: expiryDaysFromIso(row.expiresAtISO || null),
                  };
                  const rowBusy = accessActionBusyId === row.id;
                  const unchanged = draft.permission === row.permission
                    && draft.expiresInDays === expiryDaysFromIso(row.expiresAtISO || null);

                  return (
                    <div key={row.id} className="cc-collabItem cc-collabItemStacked">
                      <div className="cc-collabItemMetaHead">
                        <CollaboratorAvatar className="cc-collabItemAvatar" user={row} />
                        <div className="cc-collabItemMeta">
                          <div className="cc-collabItemTitle">
                            {userLabel(row)}
                          </div>
                          <div className="cc-collabItemSub">
                            {userSubLabel(row)}
                            {" • "}
                            {row.permission === "EDIT" ? "Collaborate" : "Read-only"}
                            {" • "}
                            {expiresLabel(row.expiresAtISO)}
                          </div>
                        </div>
                      </div>

                      <div className="cc-collabRow">
                        <label className="cc-collabField">
                          <span>Permission</span>
                          <select
                            className="cc-collabInput"
                            value={draft.permission}
                            onChange={(event) => {
                              const next = normalizeId(event.currentTarget.value).toUpperCase();
                              setAccessDrafts((prev) => ({
                                ...prev,
                                [row.id]: {
                                  ...draft,
                                  permission: next === "EDIT" ? "EDIT" : "VIEW",
                                },
                              }));
                            }}
                            disabled={rowBusy}
                          >
                            <option value="VIEW">Read-only</option>
                            <option value="EDIT">Collaborate</option>
                          </select>
                        </label>

                        <label className="cc-collabField">
                          <span>Expiry</span>
                          <select
                            className="cc-collabInput"
                            value={String(draft.expiresInDays)}
                            onChange={(event) => {
                              const next = Number(event.currentTarget.value);
                              const safe: ExpiryDays = next === 1 || next === 7 || next === 30 ? next : 0;
                              setAccessDrafts((prev) => ({
                                ...prev,
                                [row.id]: {
                                  ...draft,
                                  expiresInDays: safe,
                                },
                              }));
                            }}
                            disabled={rowBusy}
                          >
                            {EXPIRY_OPTIONS.map((choice) => (
                              <option key={choice.value} value={choice.value}>{choice.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="cc-collabActions cc-collabActionsSplit">
                        <button
                          className="cc-collabBtn"
                          type="button"
                          onClick={() => void updateAccess(row)}
                          disabled={rowBusy || unchanged}
                        >
                          {rowBusy ? "Working..." : "Save"}
                        </button>
                        <button
                          className="cc-collabBtn cc-collabBtnDanger"
                          type="button"
                          onClick={() => void revokeAccess(row)}
                          disabled={rowBusy}
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="cc-collabItem">
                  <div className="cc-collabItemMeta">
                    <div className="cc-collabItemTitle">Link share</div>
                    <div className="cc-collabItemSub">
                      {linkUrl
                        ? `${ACCESS_POLICY_OPTIONS.find((option) => option.value === linkPolicy)?.label || "Anyone"} • ${linkExpiresAtISO ? expiresLabel(linkExpiresAtISO) : "Active"}`
                        : "No active link generated in this session."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="cc-collabActions">
                <button
                  className="cc-collabBtn cc-collabBtnIcon"
                  type="button"
                  onClick={() => void loadAccessList()}
                  disabled={accessBusy || !activeResourceId}
                  aria-label={accessBusy ? "Refreshing access" : "Refresh access"}
                  title={accessBusy ? "Refreshing access" : "Refresh access"}
                >
                  <span
                    aria-hidden="true"
                    className={`cc-collabRefreshIcon${accessBusy ? " is-spinning" : ""}`}
                  />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
