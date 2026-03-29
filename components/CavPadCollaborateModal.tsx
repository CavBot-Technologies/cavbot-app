"use client";

import * as React from "react";

type DirectPermission = "VIEW" | "EDIT";
type ExpiryDays = 0 | 1 | 7 | 30;

type CavPadAccessRow = {
  id: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl?: string | null;
  avatarTone?: string | null;
  email?: string | null;
  permission: DirectPermission;
  expiresAtISO: string | null;
};

type AccessDraft = {
  permission: DirectPermission;
  expiresInDays: ExpiryDays;
};

type AccessPayload = {
  ok?: boolean;
  accessList?: CavPadAccessRow[];
  message?: string;
};

type CavPadCollaborateModalProps = {
  open: boolean;
  resourceType?: "note" | "directory";
  resourceId: string | null;
  resourceTitle?: string;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
  ownerDisplayName?: string | null;
  ownerAvatarUrl?: string | null;
  ownerAvatarTone?: string | null;
  ownerEmail?: string | null;
  initialAccessList?: CavPadAccessRow[];
  theme: "lime" | "blue" | "violet" | "glass";
  defaultPermission: DirectPermission;
  defaultExpiryDays: 0 | 7 | 30;
  onClose: () => void;
  onAccessChanged?: (resourceId: string) => void;
};

const EXPIRY_OPTIONS: Array<{ value: ExpiryDays; label: string }> = [
  { value: 0, label: "Never" },
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
];

function normalizeId(raw: unknown): string {
  return String(raw || "").trim();
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

function normalizeIdentity(raw: string): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (!/^https?:\/\//i.test(input)) return input;
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return input;
    if (String(parts[0] || "").toLowerCase() === "u" && parts[1]) {
      return `@${String(parts[1] || "").replace(/^@+/, "")}`;
    }
    return `@${String(parts[parts.length - 1] || "").replace(/^@+/, "")}`;
  } catch {
    return input;
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

function identityLabel(row: CavPadAccessRow): string {
  return row.displayName || (row.username ? `@${row.username}` : "") || row.email || row.userId;
}

function avatarInitials(row: CavPadAccessRow): string {
  const display = String(row.displayName || "").trim();
  if (display) {
    const tokens = display.split(/\s+/g).filter(Boolean);
    if (tokens.length >= 2) {
      const duo = `${firstInitialChar(tokens[0] || "")}${firstInitialChar(tokens[1] || "")}`.trim();
      if (duo) return duo;
    }
    const single = firstInitialChar(tokens[0] || "");
    if (single) return single;
  }

  const usernameInitial = firstInitialChar(normalizeInitialUsernameSource(String(row.username || "")));
  if (usernameInitial) return usernameInitial;

  const email = String(row.email || "").trim();
  if (email) {
    const emailInitial = firstInitialChar(email.split("@")[0] || "");
    if (emailInitial) return emailInitial;
  }

  const userIdInitial = firstInitialChar(String(row.userId || ""));
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

function avatarStyle(row: CavPadAccessRow): React.CSSProperties {
  const hasAvatar = Boolean(normalizeId(row.avatarUrl || ""));
  const tone = normalizeAvatarTone(row.avatarTone);
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
  return {
    backgroundColor,
    color,
  };
}

function readCachedOwnerRow(): CavPadAccessRow | null {
  if (typeof window === "undefined") return null;
  try {
    const usernameRaw = String(globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim();
    const username = usernameRaw.replace(/^@+/, "") || null;
    const displayName = String(globalThis.__cbLocalStore.getItem("cb_profile_fullName_v1") || "").trim() || null;
    const email = String(globalThis.__cbLocalStore.getItem("cb_profile_email_v1") || "").trim() || null;
    const avatarUrl = String(globalThis.__cbLocalStore.getItem("cb_settings_avatar_image_v2") || "").trim() || null;
    const avatarTone = String(globalThis.__cbLocalStore.getItem("cb_settings_avatar_tone_v2") || "").trim() || "lime";

    if (!username && !displayName && !email && !avatarUrl) return null;

    const stableOwnerId = username || email || "owner";
    return {
      id: `owner:${stableOwnerId}`,
      userId: stableOwnerId,
      username,
      displayName,
      avatarUrl,
      avatarTone,
      email,
      permission: "EDIT",
      expiresAtISO: null,
    };
  } catch {
    return null;
  }
}

export function CavPadCollaborateModal(props: CavPadCollaborateModalProps) {
  const {
    open,
    resourceType = "note",
    resourceId,
    resourceTitle,
    ownerUserId,
    ownerUsername,
    ownerDisplayName,
    ownerAvatarUrl,
    ownerAvatarTone,
    ownerEmail,
    initialAccessList,
    theme,
    defaultPermission,
    defaultExpiryDays,
    onClose,
    onAccessChanged,
  } = props;

  const activeResourceId = normalizeId(resourceId);
  const resourceNoun = resourceType === "directory" ? "folder" : "note";
  const shareBasePath = resourceType === "directory"
    ? `/api/cavpad/directories/${encodeURIComponent(activeResourceId)}/share`
    : `/api/cavpad/notes/${encodeURIComponent(activeResourceId)}/share`;
  const [identity, setIdentity] = React.useState<string>("");
  const [permissionChoice, setPermissionChoice] = React.useState<DirectPermission>(defaultPermission);
  const [expiryChoice, setExpiryChoice] = React.useState<ExpiryDays>(defaultExpiryDays || 0);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [status, setStatus] = React.useState<string>("");
  const [error, setError] = React.useState<string>("");
  const [accessBusy, setAccessBusy] = React.useState<boolean>(false);
  const [accessActionBusyId, setAccessActionBusyId] = React.useState<string>("");
  const [accessList, setAccessList] = React.useState<CavPadAccessRow[]>(
    () => (Array.isArray(initialAccessList) ? initialAccessList : []),
  );
  const [drafts, setDrafts] = React.useState<Record<string, AccessDraft>>({});
  const [fallbackOwnerRow, setFallbackOwnerRow] = React.useState<CavPadAccessRow | null>(null);

  React.useEffect(() => {
    setFallbackOwnerRow(readCachedOwnerRow());
  }, []);

  const hydrateDrafts = React.useCallback((rows: CavPadAccessRow[]) => {
    const next: Record<string, AccessDraft> = {};
    rows.forEach((row) => {
      const key = normalizeId(row.id || row.userId);
      if (!key) return;
      next[key] = {
        permission: row.permission === "EDIT" ? "EDIT" : "VIEW",
        expiresInDays: expiryDaysFromIso(row.expiresAtISO || null),
      };
    });
    setDrafts(next);
  }, []);

  const loadAccess = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!activeResourceId) return;
    const silent = Boolean(options?.silent);
    if (!silent) setAccessBusy(true);
    setError("");
    try {
      const res = await fetch(shareBasePath, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as AccessPayload | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String(json?.message || `Failed to load ${resourceNoun} collaborators.`));
      }
      const rows = Array.isArray(json.accessList) ? json.accessList : [];
      setAccessList(rows);
      hydrateDrafts(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load ${resourceNoun} collaborators.`);
    } finally {
      setAccessBusy(false);
    }
  }, [activeResourceId, hydrateDrafts, resourceNoun, shareBasePath]);

  React.useEffect(() => {
    if (!open) return;
    if (!activeResourceId) {
      setError(resourceType === "directory" ? "Folder unavailable." : "Note unavailable.");
      return;
    }
    setIdentity("");
    setPermissionChoice(defaultPermission);
    setExpiryChoice(defaultExpiryDays || 0);
    setStatus("");
    setError("");
    const seededRows = Array.isArray(initialAccessList) ? initialAccessList : [];
    setAccessList(seededRows);
    hydrateDrafts(seededRows);
    setAccessBusy(false);
    void loadAccess({ silent: true });
  }, [activeResourceId, defaultExpiryDays, defaultPermission, hydrateDrafts, initialAccessList, loadAccess, open, resourceType]);

  React.useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const ownerRow = React.useMemo<CavPadAccessRow | null>(() => {
    const resolvedUserId = normalizeId(ownerUserId || "");
    const resolvedUsername = normalizeId(ownerUsername || "") || null;
    const resolvedDisplayName = normalizeId(ownerDisplayName || "") || null;
    const resolvedEmail = normalizeId(ownerEmail || "") || null;
    const resolvedAvatarUrl = normalizeId(ownerAvatarUrl || "") || null;
    if (!resolvedUserId && !resolvedUsername && !resolvedDisplayName && !resolvedEmail) return null;

    return {
      id: `owner:${resolvedUserId || resolvedUsername || resolvedEmail || "me"}`,
      userId: resolvedUserId || "owner",
      username: resolvedUsername,
      displayName: resolvedDisplayName,
      avatarUrl: resolvedAvatarUrl,
      avatarTone: normalizeId(ownerAvatarTone || "") || null,
      email: resolvedEmail,
      permission: "EDIT",
      expiresAtISO: null,
    };
  }, [ownerAvatarTone, ownerAvatarUrl, ownerDisplayName, ownerEmail, ownerUserId, ownerUsername]);

  React.useEffect(() => {
    if (!open) return;
    if (ownerRow) {
      setFallbackOwnerRow(null);
      return;
    }
    setFallbackOwnerRow(readCachedOwnerRow());
  }, [open, ownerRow]);

  const resolvedOwnerRow = ownerRow || fallbackOwnerRow;

  const directAccessList = React.useMemo(() => {
    if (!resolvedOwnerRow) return accessList;
    const ownerKey = normalizeId(resolvedOwnerRow.userId || resolvedOwnerRow.username || resolvedOwnerRow.email || resolvedOwnerRow.id);
    if (!ownerKey) return accessList;
    return accessList.filter((row) => {
      const rowKey = normalizeId(row.userId || row.username || row.email || row.id);
      return rowKey !== ownerKey;
    });
  }, [accessList, resolvedOwnerRow]);

  const facepileRows = React.useMemo(
    () => (resolvedOwnerRow ? [resolvedOwnerRow, ...directAccessList] : directAccessList),
    [directAccessList, resolvedOwnerRow]
  );

  const canSend = Boolean(activeResourceId && normalizeIdentity(identity));

  const shareWithIdentity = React.useCallback(async () => {
    if (!activeResourceId) return;
    const targetIdentity = normalizeIdentity(identity);
    if (!targetIdentity) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(shareBasePath, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identity: targetIdentity,
          permission: permissionChoice,
          expiresInDays: expiryChoice,
        }),
      });
      const json = (await res.json().catch(() => null)) as AccessPayload | { ok?: boolean; message?: string } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String((json as { message?: unknown } | null)?.message || `Failed to share ${resourceNoun}.`));
      }
      setIdentity("");
      setStatus("Collaborator added.");
      await loadAccess({ silent: true });
      onAccessChanged?.(activeResourceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to share ${resourceNoun}.`);
    } finally {
      setBusy(false);
    }
  }, [activeResourceId, expiryChoice, identity, loadAccess, onAccessChanged, permissionChoice, resourceNoun, shareBasePath]);

  const updateAccess = React.useCallback(async (row: CavPadAccessRow) => {
    if (!activeResourceId) return;
    const key = normalizeId(row.id || row.userId);
    if (!key) return;
    const draft = drafts[key];
    if (!draft) return;

    const unchanged = draft.permission === row.permission
      && draft.expiresInDays === expiryDaysFromIso(row.expiresAtISO || null);
    if (unchanged) return;

    setAccessActionBusyId(key);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `${shareBasePath}/${encodeURIComponent(key)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            permission: draft.permission,
            expiresInDays: draft.expiresInDays,
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as AccessPayload | { ok?: boolean; message?: string } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String((json as { message?: unknown } | null)?.message || "Failed to update collaborator."));
      }
      setStatus("Access updated.");
      await loadAccess({ silent: true });
      onAccessChanged?.(activeResourceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update collaborator.");
    } finally {
      setAccessActionBusyId("");
    }
  }, [activeResourceId, drafts, loadAccess, onAccessChanged, shareBasePath]);

  const revokeAccess = React.useCallback(async (row: CavPadAccessRow) => {
    if (!activeResourceId) return;
    const key = normalizeId(row.id || row.userId);
    if (!key) return;

    setAccessActionBusyId(key);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `${shareBasePath}/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        },
      );
      const json = (await res.json().catch(() => null)) as AccessPayload | { ok?: boolean; message?: string } | null;
      if (!res.ok || !json?.ok) {
        throw new Error(String((json as { message?: unknown } | null)?.message || "Failed to remove collaborator."));
      }
      setStatus("Collaborator removed.");
      await loadAccess({ silent: true });
      onAccessChanged?.(activeResourceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove collaborator.");
    } finally {
      setAccessActionBusyId("");
    }
  }, [activeResourceId, loadAccess, onAccessChanged, shareBasePath]);

  if (!open) return null;

  return (
    <div className="cb-link-modal" role="dialog" aria-modal="true" aria-label={`Collaborate on ${resourceNoun}`}>
      <div className="cb-link-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="cb-link-modal-panel cb-cavpad-collab-panel" data-cavpad-theme={theme}>
        <div className="cb-link-modal-head">{`Collaborate on ${resourceNoun}`}</div>
        <p className="cb-link-modal-sub">
          {resourceTitle
            ? `Share "${resourceTitle}" with workspace members.`
            : `Share this ${resourceNoun} with workspace members.`}
        </p>

        {error ? <div className="cb-cavpad-collab-alert is-error">{error}</div> : null}
        {status ? <div className="cb-cavpad-collab-alert is-good">{status}</div> : null}

        <div className="cb-cavpad-collab-row cb-cavpad-collab-row-single">
          <label className="cb-cavpad-collab-field">
            <span>Invite by username or email</span>
            <input
              className="cb-link-modal-input"
              value={identity}
              onChange={(event) => setIdentity(event.currentTarget.value)}
              placeholder="@username or email"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
        </div>

        <div className="cb-cavpad-collab-row">
          <label className="cb-cavpad-collab-field">
            <span>Permission</span>
            <select
              className="cb-link-modal-input"
              value={permissionChoice}
              onChange={(event) => {
                const next = normalizeId(event.currentTarget.value).toUpperCase();
                setPermissionChoice(next === "EDIT" ? "EDIT" : "VIEW");
              }}
              disabled={busy}
            >
              <option value="VIEW">View-only</option>
              <option value="EDIT">Collaborate</option>
            </select>
          </label>
          <label className="cb-cavpad-collab-field">
            <span>Expiry</span>
            <select
              className="cb-link-modal-input"
              value={String(expiryChoice)}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                const safe: ExpiryDays = next === 1 || next === 7 || next === 30 ? next : 0;
                setExpiryChoice(safe);
              }}
              disabled={busy}
            >
              {EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="cb-link-modal-actions">
          <button className="cb-linkpill" type="button" onClick={onClose}>
            Close
          </button>
          <button
            className="cb-linkpill cb-home-accent"
            type="button"
            onClick={() => void shareWithIdentity()}
            disabled={!canSend || busy}
          >
            {busy ? "Sharing..." : "Share"}
          </button>
        </div>

        <div className="cb-cavpad-collab-listWrap">
          <div className="cb-cavpad-collab-listTitle">People with access</div>
          {!accessBusy && facepileRows.length ? (
            <div className="cb-cavpad-collab-facepile" aria-label={`${facepileRows.length} collaborators`}>
              {facepileRows.slice(0, 6).map((row, index) => {
                const key = normalizeId(row.id || row.userId) || `facepile_${index}`;
                return (
                  <span
                    key={key}
                    className="cb-cavpad-collab-avatar cb-cavpad-collab-facepile-avatar"
                    style={{ ...avatarStyle(row), zIndex: 12 - index }}
                    title={identityLabel(row)}
                    aria-hidden="true"
                  >
                    <span className="cb-cavpad-collab-avatar-fallback">{avatarInitials(row)}</span>
                    {row.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.avatarUrl}
                        alt=""
                        className="cb-cavpad-collab-avatar-img"
                        loading="eager"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                  </span>
                );
              })}
              {facepileRows.length > 6 ? (
                <span className="cb-cavpad-collab-facepile-more">+{facepileRows.length - 6}</span>
              ) : null}
            </div>
          ) : null}
          {accessBusy ? <div className="cb-cavpad-collab-empty">Loading collaborators...</div> : null}
          {!accessBusy && !directAccessList.length ? <div className="cb-cavpad-collab-empty">No direct collaborators.</div> : null}
          {!accessBusy ? (
            <div className="cb-cavpad-collab-list">
              {resolvedOwnerRow ? (
                <div key={resolvedOwnerRow.id} className="cb-cavpad-collab-item">
                  <div className="cb-cavpad-collab-metaHead">
                    <span
                      className="cb-cavpad-collab-avatar"
                      style={avatarStyle(resolvedOwnerRow)}
                      aria-hidden="true"
                    >
                      <span className="cb-cavpad-collab-avatar-fallback">{avatarInitials(resolvedOwnerRow)}</span>
                      {resolvedOwnerRow.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolvedOwnerRow.avatarUrl}
                          alt=""
                          className="cb-cavpad-collab-avatar-img"
                          loading="eager"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </span>
                    <div className="cb-cavpad-collab-meta">
                      <div className="cb-cavpad-collab-name">{identityLabel(resolvedOwnerRow)}</div>
                      <div className="cb-cavpad-collab-sub">
                        {(resolvedOwnerRow.username ? `@${resolvedOwnerRow.username}` : "") || resolvedOwnerRow.email || resolvedOwnerRow.userId}
                        {" · "}
                        Owner
                        {" · "}
                        Full access
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {directAccessList.map((row) => {
                const key = normalizeId(row.id || row.userId);
                const draft = drafts[key] || {
                  permission: row.permission,
                  expiresInDays: expiryDaysFromIso(row.expiresAtISO || null),
                };
                const rowBusy = accessActionBusyId === key;
                const unchanged = draft.permission === row.permission
                  && draft.expiresInDays === expiryDaysFromIso(row.expiresAtISO || null);
                const who = identityLabel(row);
                const sub = (row.username ? `@${row.username}` : "") || row.email || row.userId;
                return (
                  <div key={key} className="cb-cavpad-collab-item">
                    <div className="cb-cavpad-collab-metaHead">
                      <span
                        className="cb-cavpad-collab-avatar"
                        style={avatarStyle(row)}
                        aria-hidden="true"
                      >
                        <span className="cb-cavpad-collab-avatar-fallback">{avatarInitials(row)}</span>
                        {row.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={row.avatarUrl}
                            alt=""
                            className="cb-cavpad-collab-avatar-img"
                            loading="eager"
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : null}
                      </span>
                      <div className="cb-cavpad-collab-meta">
                        <div className="cb-cavpad-collab-name">{who}</div>
                        <div className="cb-cavpad-collab-sub">
                          {sub}
                          {" · "}
                          {row.permission === "EDIT" ? "Collaborate" : "View-only"}
                          {" · "}
                          {expiresLabel(row.expiresAtISO || null)}
                        </div>
                      </div>
                    </div>

                    <div className="cb-cavpad-collab-row">
                      <label className="cb-cavpad-collab-field">
                        <span>Permission</span>
                        <select
                          className="cb-link-modal-input"
                          value={draft.permission}
                          onChange={(event) => {
                            const next = normalizeId(event.currentTarget.value).toUpperCase();
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: {
                                ...draft,
                                permission: next === "EDIT" ? "EDIT" : "VIEW",
                              },
                            }));
                          }}
                          disabled={rowBusy}
                        >
                          <option value="VIEW">View-only</option>
                          <option value="EDIT">Collaborate</option>
                        </select>
                      </label>
                      <label className="cb-cavpad-collab-field">
                        <span>Expiry</span>
                        <select
                          className="cb-link-modal-input"
                          value={String(draft.expiresInDays)}
                          onChange={(event) => {
                            const next = Number(event.currentTarget.value);
                            const safe: ExpiryDays = next === 1 || next === 7 || next === 30 ? next : 0;
                            setDrafts((prev) => ({
                              ...prev,
                              [key]: {
                                ...draft,
                                expiresInDays: safe,
                              },
                            }));
                          }}
                          disabled={rowBusy}
                        >
                          {EXPIRY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="cb-link-modal-actions">
                      <button
                        className="cb-linkpill"
                        type="button"
                        onClick={() => void updateAccess(row)}
                        disabled={rowBusy || unchanged}
                      >
                        {rowBusy ? "Saving..." : "Save"}
                      </button>
                      <button
                        className="cb-linkpill cb-cavpad-collab-danger"
                        type="button"
                        onClick={() => void revokeAccess(row)}
                        disabled={rowBusy}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
