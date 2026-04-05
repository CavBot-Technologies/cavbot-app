// app/settings/sections/SecurityClient.tsx
"use client";

import * as React from "react";
import Image from "next/image";
import { BrowserKey, detectBrowser, guessBrowserFromLabel, browserDisplayName } from "@/lib/browser";
import { isBasicUsername, normalizeUsername, USERNAME_MAX, USERNAME_MIN } from "@/lib/username";
import { PasswordVisibilityIcon } from "@/components/icons/PasswordVisibilityIcon";
import "./security.css";

type Tone = "good" | "watch" | "bad";

type SessionRow = {
  id: string;
  label: string; // "Safari on Mac OS X"
  browser: BrowserKey;
  device: string | null;
  location: string | null;
  ip?: string | null;
  statusText: string; // "Active" / "1 month ago"
  createdAt: string; // ISO
  isCurrent?: boolean;
  userAgent?: string | null;
};

type SessionsPayload = {
  ok: true;
  sessions: SessionRow[];
};

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

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = data?.message || data?.error || "Request failed";
    throw Object.assign(new Error(String(msg)), { status: res.status, data });
  }
  return data as T;
}

function badgeToneClass(tone: "default" | "lime" | "red") {
  if (tone === "lime") return "is-lime";
  if (tone === "red") return "is-red";
  return "";
}

function decodeSessionLocation(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function IconBrowser({ b }: { b: BrowserKey }) {
  // Original CavBot-native icons (safe). Swap later with your own licensed browser marks if you want.
  if (b === "safari") {
    return (
      <span className="sx-secIcon" aria-hidden="true" title="Safari">
        <Image
          src="/icons/app/safari-option-svgrepo-com.svg"
          alt=""
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  if (b === "chrome") {
    return (
      <span className="sx-secIcon" aria-hidden="true" title="Chrome">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.16)" />
          <path d="M12 3a9 9 0 0 1 7.8 4.5H12Z" fill="rgba(255,90,90,0.50)" />
          <path d="M19.8 7.5A9 9 0 0 1 12 21l4.8-8.3Z" fill="rgba(185,200,90,0.50)" />
          <path d="M12 21A9 9 0 0 1 4.2 7.5L9.2 16Z" fill="rgba(78,168,255,0.50)" />
          <circle cx="12" cy="12" r="3.4" fill="rgba(234,240,255,0.78)" />
          <circle cx="12" cy="12" r="2.1" fill="rgba(78,168,255,0.18)" />
        </svg>
      </span>
    );
  }

  if (b === "brave") {
    return (
      <span className="sx-secIcon" aria-hidden="true" title="Brave">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <path
            d="M12 3l4 1.2 2 2.8-.7 9.2L12 21 6.7 16.2 6 7l2-2.8L12 3Z"
            fill="rgba(255,120,120,0.16)"
            stroke="rgba(255,255,255,0.16)"
          />
          <path d="M9 9h6l-1 6h-4L9 9Z" fill="rgba(234,240,255,0.74)" />
        </svg>
      </span>
    );
  }

  if (b === "firefox") {
    return (
      <span className="sx-secIcon" aria-hidden="true" title="Firefox">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(139,92,255,0.14)" stroke="rgba(255,255,255,0.16)" />
          <path
            d="M7.4 15.9c1.5 1.6 3.3 2.4 5.2 2.4 3.5 0 6.2-2.5 6.2-5.8 0-2.7-1.9-4.9-4.6-5.5 1.2 1.5.4 3-1.1 3.4-1.1.3-2.2-.2-2.8-1.2-1.3 1.1-2.1 2.7-2.1 4.2 0 .9.3 1.8 1.2 2.5Z"
            fill="rgba(234,240,255,0.74)"
          />
        </svg>
      </span>
    );
  }

  if (b === "edge") {
    return (
      <span className="sx-secIcon" aria-hidden="true" title="Edge">
        <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
          <circle cx="12" cy="12" r="9" fill="rgba(78,168,255,0.12)" stroke="rgba(255,255,255,0.16)" />
          <path
            d="M18 14.5c-.8 2.3-3 3.9-5.7 3.9-3.4 0-6.1-2.5-6.1-5.7 0-2.8 2-5.1 4.8-5.6-.9 1.1-.5 2.2.4 2.8.9.6 2.2.6 3.2.1 1.4-.7 3-.3 3.4 1.1Z"
            fill="rgba(185,200,90,0.50)"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="sx-secIcon" aria-hidden="true" title="Session">
      <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
        <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)" />
        <path d="M8 12h8" stroke="rgba(255,255,255,0.58)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function inferBrowser(row: SessionRow): BrowserKey {
  if (row.browser && row.browser !== "unknown") return row.browser;
  const fromUa = detectBrowser(row.userAgent || "");
  if (fromUa !== "unknown") return fromUa;
  return guessBrowserFromLabel(row.label);
}

function renderSessionLocation(row: SessionRow) {
  const location = decodeSessionLocation(row.location || "");
  if (location) return location;
  const ip = String(row.ip || "").trim();
  if (ip) return `Approximate network location (IP ${ip})`;
  return "Approximate network location";
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" focusable="false">
      <path d="M20.5 6H3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M18.8332 8.5L18.3732 15.3991C18.1962 18.054 18.1077 19.3815 17.2427 20.1907C16.3777 21 15.0473 21 12.3865 21H11.6132C8.95235 21 7.62195 21 6.75694 20.1907C5.89194 19.3815 5.80344 18.054 5.62644 15.3991L5.1665 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M6.5 6C6.55588 6 6.58382 6 6.60915 5.99936C7.43259 5.97849 8.15902 5.45491 8.43922 4.68032C8.44784 4.65649 8.45667 4.62999 8.47434 4.57697L8.57143 4.28571C8.65431 4.03708 8.69575 3.91276 8.75071 3.8072C8.97001 3.38607 9.37574 3.09364 9.84461 3.01877C9.96213 3 10.0932 3 10.3553 3H13.6447C13.9068 3 14.0379 3 14.1554 3.01877C14.6243 3.09364 15.03 3.38607 15.2493 3.8072C15.3043 3.91276 15.3457 4.03708 15.4286 4.28571L15.5257 4.57697C15.5433 4.62992 15.5522 4.65651 15.5608 4.68032C15.841 5.45491 16.5674 5.97849 17.3909 5.99936C17.4162 6 17.4441 6 17.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function VerifyIcon() {
  return <span className="sx-secVerifyIcon" aria-hidden="true" />;
}

const USERNAME_CARD_FREE_CHANGES = 3;
const USERNAME_CARD_COOLDOWN_DAYS = 30;
const USERNAME_CARD_COOLDOWN_MS = USERNAME_CARD_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export default function SecurityClient() {
  // Change password
  const [cur, setCur] = React.useState("");
  const [n1, setN1] = React.useState("");
  const [n2, setN2] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [badgeTone, setBadgeTone] = React.useState<"default" | "lime" | "red">("default");
  const [badgeAlert, setBadgeAlert] = React.useState(false);
  const badgeTimer = React.useRef<number | null>(null);

  // 2-step
  const [twoEmail, setTwoEmail] = React.useState(false);
  const [twoApp, setTwoApp] = React.useState(false);

  // Authenticator app enrollment (TOTP)
  const [appSetupOpen, setAppSetupOpen] = React.useState(false);
  const [appDisableOpen, setAppDisableOpen] = React.useState(false);
  const [totpQrSvg, setTotpQrSvg] = React.useState<string>("");
  const [totpSecretOnce, setTotpSecretOnce] = React.useState<string>("");
  const [totpSecretMasked, setTotpSecretMasked] = React.useState<string>("");
  const [totpCode, setTotpCode] = React.useState<string>("");
  const [disablePw, setDisablePw] = React.useState<string>("");

  const [currentUsername, setCurrentUsername] = React.useState("");
  const [usernameDraft, setUsernameDraft] = React.useState("");
  const [usernameChangesRemaining, setUsernameChangesRemaining] = React.useState<number | null>(null);
  const [nextUsernameAvailable, setNextUsernameAvailable] = React.useState<string | null>(null);
  const [usernameError, setUsernameError] = React.useState("");
  const [usernameSaving, setUsernameSaving] = React.useState(false);

  // Sessions
  const [sessions, setSessions] = React.useState<SessionRow[]>([]);
  const [sessionPendingDelete, setSessionPendingDelete] = React.useState<SessionRow | null>(null);

  React.useEffect(() => {
    const className = "cb-security-session-delete-open";
    if (typeof document === "undefined") return;
    if (sessionPendingDelete) {
      document.body.classList.add(className);
    } else {
      document.body.classList.remove(className);
    }
    return () => document.body.classList.remove(className);
  }, [sessionPendingDelete]);

  // UX
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [errVersion, setErrVersion] = React.useState(0);
  const [toast, setToast] = React.useState<{ tone: Tone; msg: string } | null>(null);

  const handleSetErr = React.useCallback((message: string) => {
    setErr(message);
    setErrVersion((prev) => (message ? prev + 1 : 0));
  }, []);

  // Delete account modal (TEAM MODAL CLONE)
  const [delOpen, setDelOpen] = React.useState(false);
  const [delPw, setDelPw] = React.useState("");
  const [delConfirm, setDelConfirm] = React.useState(false);

  const toastTimer = React.useRef<number | null>(null);
  function pushToast(msg: string, tone: Tone = "good") {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }

  const refresh = React.useCallback(async () => {
    handleSetErr("");
    try {
      const d = await apiJSON<SessionsPayload>("/api/settings/security/sessions");
      setSessions(d.sessions || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Failed to load security data.");
    }
  }, [handleSetErr]);

    const load2fa = React.useCallback(async () => {
    try {
      const d = await apiJSON<{ ok: true; twoFactor: { email2fa: boolean; app2fa: boolean } }>("/api/settings/security/2fa");
      setTwoEmail(Boolean(d?.twoFactor?.email2fa));
      setTwoApp(Boolean(d?.twoFactor?.app2fa));
    } catch {
      // ignore
    }
  }, []);

  const loadUsernameData = React.useCallback(async () => {
    try {
      const data = await apiJSON<{
        ok?: boolean;
        user?: {
          username?: string | null;
          usernameChangeCount?: number | null;
          lastUsernameChangeAt?: string | null;
        };
      }>("/api/auth/me");

      const user = data?.user;
      if (!user) {
        return;
      }

      const name = String(user.username || "").trim();
      setCurrentUsername(name);

      const count = Number(user.usernameChangeCount ?? 0);
      setUsernameChangesRemaining(Math.max(0, USERNAME_CARD_FREE_CHANGES - count));

      if (count >= USERNAME_CARD_FREE_CHANGES && user.lastUsernameChangeAt) {
        const last = new Date(user.lastUsernameChangeAt);
        if (Number.isFinite(last.getTime())) {
          setNextUsernameAvailable(new Date(last.getTime() + USERNAME_CARD_COOLDOWN_MS).toISOString());
        } else {
          setNextUsernameAvailable(null);
        }
      } else {
        setNextUsernameAvailable(null);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleUsernameSubmit = async () => {
    if (usernameSaving) return;

    const normalizedDraft = normalizeUsername(usernameDraft);
    if (!normalizedDraft) {
      setUsernameError("Enter a username.");
      return;
    }

    if (!isBasicUsername(usernameDraft)) {
      setUsernameError(
        `Use ${USERNAME_MIN}-${USERNAME_MAX} letters, numbers, or underscores, starting with a letter.`
      );
      return;
    }

    const currentNormalized = normalizeUsername(currentUsername);
    if (normalizedDraft === currentNormalized) {
      setUsernameError("That is already your username.");
      return;
    }

    setUsernameSaving(true);
    setUsernameError("");

    try {
      const payload = await apiJSON<{
        ok: true;
        username: string;
        changesRemaining: number;
        nextAvailableAt: string | null;
        lastChangeAt: string | null;
      }>("/api/settings/security/username", {
        method: "PATCH",
        body: JSON.stringify({ newUsername: usernameDraft }),
      });

      setCurrentUsername(payload.username);
      setUsernameDraft("");
      setUsernameChangesRemaining(payload.changesRemaining);
      setNextUsernameAvailable(payload.nextAvailableAt);
      window.dispatchEvent(
        new CustomEvent("cb:profile", {
          detail: { username: payload.username },
        })
      );
      pushToast("Username updated.", "good");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUsernameError(message || "Username update failed.");
      pushToast("Username update failed.", "bad");
    } finally {
      setUsernameSaving(false);
    }
  };

  React.useEffect(() => {
    refresh();
    load2fa();
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (badgeTimer.current) window.clearTimeout(badgeTimer.current);
    };
  }, [refresh, load2fa]);

  React.useEffect(() => {
    loadUsernameData();
  }, [loadUsernameData]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = (globalThis.__cbLocalStore.getItem("cb_profile_username_v1") || "").trim();
      if (stored) {
        setCurrentUsername(stored);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    const onProfile = (e: CustomEvent | Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        const next = normalizeUsername(String(detail?.username || ""));
        if (!next) return;
        setCurrentUsername(next);
      } catch {}
    };

    window.addEventListener("cb:profile", onProfile as EventListener);
    return () => window.removeEventListener("cb:profile", onProfile as EventListener);
  }, []);

  React.useEffect(() => {
    if (badgeAlert) return;
    setBadgeTone(show ? "lime" : "default");
  }, [show, badgeAlert]);

  React.useEffect(() => {
    if (!err) return;
    setBadgeAlert(true);
    setBadgeTone("red");
    if (badgeTimer.current) window.clearTimeout(badgeTimer.current);
    badgeTimer.current = window.setTimeout(() => {
      setBadgeAlert(false);
      setBadgeTone(show ? "lime" : "default");
    }, 1400);
  }, [errVersion, show, err]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const evt = new CustomEvent("cb:eye-tone", { detail: { tone: badgeTone } });
    window.dispatchEvent(evt);
  }, [badgeTone]);

  const hasPwDraft = Boolean(cur || n1 || n2);
  const pwValid = !hasPwDraft || (cur.length > 0 && n1.length >= 8 && n2.length >= 8 && n1 === n2);

  const hasAnyDraft = hasPwDraft || twoEmail || twoApp;

  const usernameStatusLine = React.useMemo(() => {
    if (nextUsernameAvailable) {
      const next = new Date(nextUsernameAvailable);
      if (Number.isFinite(next.getTime())) {
        const days = Math.max(1, Math.ceil((next.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        return `Next change available in ${days} day${days === 1 ? "" : "s"}.`;
      }
      return "Next change will be available soon.";
    }
    if (usernameChangesRemaining !== null) {
      return `Changes remaining before cooldown: ${usernameChangesRemaining}.`;
    }
    return "";
  }, [nextUsernameAvailable, usernameChangesRemaining]);

  const normalizedUsernameDraft = normalizeUsername(usernameDraft);
  const normalizedCurrentUsername = normalizeUsername(currentUsername);
  const canSubmitUsername =
    Boolean(normalizedUsernameDraft) &&
    normalizedUsernameDraft !== normalizedCurrentUsername &&
    isBasicUsername(usernameDraft) &&
    !usernameSaving;

  const doSave = async () => {
    if (saving) return;
    setErr("");

    if (hasPwDraft) {
      if (!cur) return handleSetErr("Enter your current password.");
      if (n1.length < 8) return handleSetErr("New password must be at least 8 characters.");
      if (n1 !== n2) return handleSetErr("New passwords do not match.");
    }

    setSaving(true);
    try {
      await apiJSON<{ ok: true }>("/api/settings/security/2fa", {
        method: "PATCH",
        body: JSON.stringify({ email2fa: twoEmail, app2fa: twoApp }),
      });

      if (hasPwDraft) {
        await apiJSON<{ ok: true }>("/api/settings/security/password", {
          method: "PATCH",
          body: JSON.stringify({ currentPassword: cur, nextPassword: n1 }),
        });

        setCur("");
        setN1("");
        setN2("");
        setShow(false);
      }

      pushToast("Security settings saved.", "good");
      await refresh();
      await load2fa();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Save failed.");
      pushToast("Save failed.", "bad");
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteSession = (session: SessionRow) => {
    if (!session || session.id === "current" || session.isCurrent) return;
    setSessionPendingDelete(session);
  };

  const closeSessionDeleteModal = () => {
    if (saving) return;
    setSessionPendingDelete(null);
  };

  const confirmSessionDelete = async () => {
    if (!sessionPendingDelete) return;
    handleSetErr("");
    setSaving(true);
    try {
      await apiJSON<{ ok: true }>(
        `/api/settings/security/sessions?id=${encodeURIComponent(sessionPendingDelete.id)}`,
        { method: "DELETE" }
      );
      pushToast("Session record removed.", "good");
      await refresh();
      setSessionPendingDelete(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Delete failed.");
      pushToast("Delete failed.", "bad");
    } finally {
      setSaving(false);
    }
  };

  // Delete account -> open CavBot modal (no browser dialogs)
  const doDeleteAccount = async () => {
    if (saving) return;
    handleSetErr("");
    setDelPw("");
    setDelConfirm(false);
    setDelOpen(true);
  };

  const closeDeleteModal = () => {
    if (saving) return;
    setDelOpen(false);
    setDelPw("");
    setDelConfirm(false);
  };

  const confirmDeleteAccount = async () => {
    if (saving) return;
    setErr("");

    if (!delPw) return handleSetErr("Enter your password to continue.");
    if (!delConfirm) return handleSetErr("Confirm deletion to proceed.");

    setSaving(true);
    try {
      await apiJSON<{ ok: true }>("/api/settings/security/delete-account", {
        method: "POST",
        body: JSON.stringify({ password: delPw }),
      });

      pushToast("Account deletion started.", "good");
      window.location.href = "/auth?mode=login";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Delete failed.");
      pushToast("Delete failed.", "bad");
      setSaving(false);
    }
  };

  // Authenticator setup confirm
  const confirmTotp = async () => {
    if (saving) return;
    const code = String(totpCode || "").trim();
    if (!/^\d{6}$/.test(code)) {
      handleSetErr("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setSaving(true);
    handleSetErr("");
    try {
      await apiJSON<{ ok: true }>("/api/settings/security/2fa/app/confirm", {
        method: "POST",
        body: JSON.stringify({ code }),
      });

      setTwoApp(true);
      setAppSetupOpen(false);
      pushToast("Authenticator enabled.", "good");
      await refresh();
      await load2fa();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Verification failed.");
      pushToast("Verification failed.", "bad");
    } finally {
      setSaving(false);
    }
  };

  const disableTotp = async () => {
    if (saving) return;
    const pw = String(disablePw || "");
    if (!pw) {
      handleSetErr("Enter your password to disable authenticator.");
      return;
    }

    setSaving(true);
    handleSetErr("");
    try {
      await apiJSON<{ ok: true }>("/api/settings/security/2fa/app/disable", {
        method: "POST",
        body: JSON.stringify({ password: pw }),
      });

      setTwoApp(false);
      setAppDisableOpen(false);
      pushToast("Authenticator disabled.", "watch");
      await refresh();
      await load2fa();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      handleSetErr(message || "Disable failed.");
      pushToast("Disable failed.", "bad");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="sx-panel" aria-label="Security settings">
        <header className="sx-panelHead sx-secHead">
          <div>
            <h2 className="sx-h2">Security</h2>
            <p className="sx-sub">Password, session history, and account security controls.</p>
          </div>

          <button
            className={`sx-btn sx-btnPrimary sx-btnToneLinked sx-secSave ${saving || !hasAnyDraft ? "is-disabled" : ""}`}
            type="button"
            onClick={doSave}
            disabled={saving || !hasAnyDraft}
            aria-disabled={saving || !hasAnyDraft ? "true" : "false"}
            title="Save security changes"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </header>

        <div className="sx-body">
          {err ? <div className="sx-secError">{err}</div> : null}

          <div className="sx-secStack">
            {/* Change username */}
            <div className="sx-card sx-secWide">
              <div className="sx-secCardTop">
                <div>
                  <div className="sx-kicker">Change Username</div>
                  <div className="sx-cardSub sx-secSub">
                    First 3 changes are free. After that, you can change once every 30 days. Previous usernames cannot be
                    reused.
                  </div>
                </div>
              </div>
              <br />
              <br />
              <div className="sx-secForm">
                <div className="sx-field">
                  <div className="sx-label">Current username</div>
                  <input
                    className="sx-input"
                    type="text"
                    value={currentUsername ? `@${currentUsername}` : ""}
                    readOnly
                    disabled
                    placeholder="Not set"
                  />
                </div>

                <div className="sx-field">
                  <div className="sx-label">New username</div>
                  <input
                    className="sx-input"
                    type="text"
                    value={usernameDraft}
                    onChange={(e) => {
                      setUsernameDraft(e.target.value);
                      if (usernameError) setUsernameError("");
                    }}
                    placeholder="Enter a new username"
                    autoComplete="username"
                    disabled={usernameSaving}
                  />
                </div>

                {usernameError ? <div className="sx-secHintBad">{usernameError}</div> : null}
                <div className="sx-hint">{usernameStatusLine}</div>

                <div className="sx-secDangerActions">
                  <button
                    className={`sx-btn sx-btnPrimary sx-btnToneLinked ${!canSubmitUsername ? "is-disabled" : ""}`}
                    type="button"
                    onClick={handleUsernameSubmit}
                    disabled={!canSubmitUsername}
                  >
                    {usernameSaving ? "Changing…" : "Change username"}
                  </button>
                </div>
              </div>
            </div>
            <br />

            {/* Change password */}
            <div className="sx-card sx-secWide">
              <div className="sx-secCardTop">
                <div className="sx-kicker">Change Password</div>
              </div>
              <br />
              <br />
              <div className="sx-secForm">
                <div className="sx-field">
                  <div className="sx-label">Current password</div>
                  <div className="sx-secPwWrap">
                    <input
                      className={`sx-input ${hasPwDraft && !cur ? "is-error" : ""}`}
                      type={show ? "text" : "password"}
                      value={cur}
                      onChange={(e) => setCur(e.target.value)}
                      autoComplete="current-password"
                      placeholder="Enter current password"
                      disabled={saving}
                    />
                    <button
                      className="sx-secShow"
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      aria-label={show ? "Hide password" : "Show password"}
                      aria-pressed={show}
                    >
                      <PasswordVisibilityIcon shown={show} />
                    </button>
                  </div>
                </div>

                <br />
                <br />

                <div className="sx-secPwGrid">
                  <div className="sx-field">
                    <div className="sx-label">New password</div>
                    <input
                      className={`sx-input ${hasPwDraft && n1 && n1.length < 8 ? "is-error" : ""}`}
                      type={show ? "text" : "password"}
                      value={n1}
                      onChange={(e) => setN1(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Enter new password"
                      disabled={saving}
                    />
                  </div>

                  <div className="sx-field">
                    <div className="sx-label">Confirm password</div>
                    <input
                      className={`sx-input ${hasPwDraft && n2 && n1 !== n2 ? "is-error" : ""}`}
                      type={show ? "text" : "password"}
                      value={n2}
                      onChange={(e) => setN2(e.target.value)}
                      autoComplete="new-password"
                      placeholder="Confirm new password"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="sx-hint">Password updates require your current password. Minimum 8 characters.</div>
                {!pwValid ? <div className="sx-secHintBad">Fix the password fields above, then Save.</div> : null}
              </div>
            </div>

            <br />

            {/* 2-step */}
            <div className="sx-card sx-secWide">
              <div className="sx-secCardTop">
                <div>
                  <div className="sx-kicker">Setup 2-Step Verification</div>
                  <div className="sx-cardSub sx-secSub">
                    Add an extra layer of protection for your workspace access. CavBot uses email and authenticator methods
                    only.
                  </div>
                  <br />
                  <br />
                </div>

                <div className={`sx-secAuthIcon ${badgeToneClass(badgeTone)}`} aria-hidden="true" title="Verification">
                  <VerifyIcon />
                  <div className={`sx-cavbot-eyes is-${badgeTone}`}>
                    <span />
                    <span />
                  </div>
                </div>
              </div>

              <div className="sx-secTwoList sx-secTwoWide">
                <label className="sx-secToggle">
                  <div className="sx-secToggleLeft">
                    <div className="sx-secToggleTitle">Authenticator app</div>
                    <div className="sx-secToggleSub">Generate verification codes with an authenticator.</div>
                  </div>

                  <input
                    type="checkbox"
                    checked={twoApp}
                    onChange={async (e) => {
                      const next = e.target.checked;

                      if (next) {
                        handleSetErr("");
                        setSaving(true);
                        try {
                          const d = await apiJSON<{
                            ok: true;
                            alreadyEnabled?: boolean;
                            secretOnce?: string;
                            secretMasked?: string;
                            qrSvg?: string | null;
                          }>("/api/settings/security/2fa/app/setup", { method: "POST", body: JSON.stringify({}) });

                          if (d.alreadyEnabled) {
                            setTwoApp(true);
                            pushToast("Authenticator already enabled.", "good");
                            setSaving(false);
                            return;
                          }

                          setTotpSecretOnce(String(d.secretOnce || ""));
                          setTotpSecretMasked(String(d.secretMasked || ""));
                          setTotpQrSvg(String(d.qrSvg || ""));
                          setTotpCode("");
                          setAppSetupOpen(true);
                        } catch (error) {
                          setTwoApp(false);
                          const message = error instanceof Error ? error.message : String(error);
                          handleSetErr(message || "Failed to start authenticator setup.");
                          pushToast("Setup failed.", "bad");
                        } finally {
                          setSaving(false);
                        }
                        return;
                      }

                      setDisablePw("");
                      setAppDisableOpen(true);
                    }}
                    disabled={saving}
                  />

                  <span className="sx-secSwitch" aria-hidden="true" />
                </label>

                <br />

                <label className="sx-secToggle">
                  <div className="sx-secToggleLeft">
                    <div className="sx-secToggleTitle">Email verification</div>
                    <div className="sx-secToggleSub">Send one-time verification codes by email.</div>
                  </div>

                  <input
                    type="checkbox"
                    checked={twoEmail}
                    onChange={(e) => setTwoEmail(e.target.checked)}
                    disabled={saving}
                  />

                  <span className="sx-secSwitch" aria-hidden="true" />
                </label>

                <div className="sx-hint">
                  Two-step enrollment is saved when you press <b>Save</b>.
                </div>
              </div>
            </div>

            <br />

            {/* Sessions */}
            <div className="sx-card sx-secWide">
              <div className="sx-secCardTop sx-secCardTopRow">
                <div>
                  <div className="sx-kicker">Session History</div>
                  <div className="sx-cardSub sx-secSub">Recent sign-ins and security events for your account.</div>
                </div>

                <button
                  className="sx-btn sx-btnGhost sx-secRefresh"
                  type="button"
                  onClick={refresh}
                  aria-label="Refresh session history"
                  title="Refresh session history"
                >
                  <span className="sx-secRefreshIcon" aria-hidden="true" />
                </button>
              </div>

              <br />

              {sessions?.length ? (
                <div className="sx-secSessions">
                  {sessions.map((s) => {
                    const browser = inferBrowser(s);
                    const canDelete = !s.isCurrent && s.id !== "current";
                    return (
                      <div className="sx-secSessionRow" key={s.id}>
                        <IconBrowser b={browser} />

                        <div className="sx-secSessMain">
                          <div className="sx-secSessTitle">
                            <span className="sx-secSessLabel">{s.label}</span>
                            {s.isCurrent ? (
                              <span className="sx-secLiveDot" aria-label="Active session" role="status" />
                            ) : null}
                          </div>

                          <div className="sx-secSessMeta">
                            <span className="sx-secLoc">{renderSessionLocation(s)}</span>
                            <span className="sx-secDot" aria-hidden="true" />
                            <span className="sx-secWhen">{s.statusText}</span>
                          </div>
                        </div>

                        <div className="sx-secSessRight">
                          <button
                            className={`sx-secTrash ${!canDelete ? "is-disabled" : ""}`}
                            type="button"
                            onClick={() => (canDelete ? requestDeleteSession(s) : null)}
                            disabled={!canDelete || saving}
                            aria-disabled={!canDelete ? "true" : "false"}
                            title={canDelete ? "Remove session record" : "Current session cannot be removed"}
                            aria-label={canDelete ? "Remove session record" : "Current session cannot be removed"}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="sx-secMini">No session history recorded yet.</div>
              )}
            </div>

            <br />

            {/* Delete account */}
            <div className="sx-card sx-secDanger sx-secWide">
              <div className="sx-kicker">Delete My Account</div>
              <div className="sx-cardSub sx-secSub">Permanently remove your CavBot account. This action cannot be undone.</div>
              <br />
              <br />
              <div className="sx-secDangerActions">
                <button className="sx-btn sx-secDelete" type="button" onClick={doDeleteAccount} disabled={saving}>
                  Delete account permanently
                </button>
              </div>
            </div>
          </div>

          {toast ? (
            <div className="sx-secToast" data-tone={toast.tone} role="status" aria-live="polite">
              {toast.msg}
            </div>
          ) : null}
        </div>
      </section>

      {/* Authenticator setup modal */}
      {appSetupOpen ? (
        <div className="sx-modalBackdrop" role="dialog" aria-modal="true" aria-label="Enable authenticator app">
          <div className="sx-modalCard">
            <div className="sx-modalTop">
              <div className="sx-modalTitle">Enable authenticator app</div>
              <button
                className="sx-modalClose"
                type="button"
                onClick={() => {
                  if (saving) return;
                  setAppSetupOpen(false);
                  setTwoApp(false);
                }}
                aria-label="Close"
              >
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="sx-modalBody">
              <p className="sx-modalText">
                Scan the QR code with your authenticator app, or enter the secret manually. Then type the 6-digit code to
                confirm.
              </p>
              <p className="sx-modalHint">Secret is shown once. Store it securely.</p>

              <div className="sx-totpGrid">
                <div className="sx-totpBox">
                  <div className="sx-totpLabel">QR code</div>
                  {totpQrSvg ? (
                    <div className="sx-totpQr" dangerouslySetInnerHTML={{ __html: totpQrSvg }} />
                  ) : (
                    <div className="sx-totpFallback">
                      QR unavailable. Install <b>qrcode</b> package or use the secret below.
                    </div>
                  )}
                </div>

                <div className="sx-totpBox">
                  <div className="sx-totpLabel">Secret (shown once)</div>
                  <div className="sx-totpSecret">{totpSecretOnce || totpSecretMasked}</div>

                  <div className="sx-totpLabel" style={{ marginTop: 12 }}>
                    6-digit code
                  </div>

                  <input
                    className="sx-input"
                    value={totpCode}
                    onChange={(e) => setTotpCode(String(e.target.value || "").replace(/[^0-9]/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    disabled={saving}
                  />
                </div>
              </div>
            </div>

            <div className="sx-modalActions">
              <button
                className="sx-btn sx-btnGhost"
                type="button"
                onClick={() => {
                  if (saving) return;
                  setAppSetupOpen(false);
                  setTwoApp(false);
                }}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                className={`sx-btn sx-btnPrimary sx-btnToneLinked ${saving ? "is-disabled" : ""}`}
                type="button"
                onClick={confirmTotp}
                disabled={saving}
              >
                {saving ? "Verifying…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Authenticator disable modal */}
      {appDisableOpen ? (
        <div className="sx-modalBackdrop" role="dialog" aria-modal="true" aria-label="Disable authenticator app">
          <div className="sx-modalCard">
            <div className="sx-modalTop">
              <div className="sx-modalTitle">Disable authenticator</div>
              <button
                className="sx-modalClose"
                type="button"
                onClick={() => (saving ? null : setAppDisableOpen(false))}
                aria-label="Close"
              >
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="sx-modalBody">
              <p className="sx-modalText">Enter your password to disable authenticator verification.</p>
              <p className="sx-modalHint">This will revoke active sessions.</p>

              <div className="sx-field">
                <div className="sx-label">Password</div>
                <input
                  className="sx-input"
                  type="password"
                  value={disablePw}
                  onChange={(e) => setDisablePw(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="sx-modalActions">
              <button className="sx-btn sx-btnGhost" type="button" onClick={() => setAppDisableOpen(false)} disabled={saving}>
                Cancel
              </button>

              <button
                className={`sx-btn sx-btnDanger ${saving ? "is-disabled" : ""}`}
                type="button"
                onClick={disableTotp}
                disabled={saving}
              >
                {saving ? "Disabling…" : "Disable"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirm session removal */}
      {sessionPendingDelete ? (
        <div className="sx-modalBackdrop sx-modalBackdropNoBlur" role="dialog" aria-modal="true" aria-label="Remove session record">
          <div className="sx-modalCard">
            <button
              className="sx-modalClose sx-modalCloseCorner"
              type="button"
              onClick={closeSessionDeleteModal}
              aria-label="Close"
            >
              <span className="cb-closeIcon" aria-hidden="true" />
            </button>
<br /> 
            <div className="sx-modalBody sx-sessionDeleteBody">
              <p className="sx-modalHeading">Remove session from history</p> 
              <p className="sx-modalText"><br /> 
                CavBot is ready to clear the saved record for <strong>{sessionPendingDelete.label}</strong>.
                This keeps your session log precise without ending the session itself.
              </p>
              <div className="sx-modalSpacing" aria-hidden="true" />
              <p className="sx-modalHint">
                Location: {renderSessionLocation(sessionPendingDelete)}
              </p>
              <p className="sx-modalHint">
                Browser: {browserDisplayName(sessionPendingDelete.browser)}
              </p>
              <p className="sx-modalHint">
                Status: {sessionPendingDelete.statusText}
              </p>
            </div>

            <div className="sx-modalActions">
              <button
                className="sx-btn sx-btnGhost"
                type="button"
                onClick={closeSessionDeleteModal}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                className={`sx-btn sx-btnDanger ${saving ? "is-disabled" : ""}`}
                type="button"
                onClick={confirmSessionDelete}
                disabled={saving}
              >
                {saving ? "Removing…" : "Remove session"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete Account Modal (TEAM MODAL CLONE) */}
      {delOpen ? (
        <div className="sx-modalBackdrop" role="dialog" aria-modal="true" aria-label="Delete account confirmation">
          <div className="sx-modalCard">
            <div className="sx-modalTop">
              <div className="sx-modalTitle">Delete account</div>
              <button className="sx-modalClose" type="button" onClick={closeDeleteModal} aria-label="Close">
                <span className="cb-closeIcon" aria-hidden="true" />
              </button>
            </div>

            <div className="sx-modalBody">
              <p className="sx-modalText">
                You are about to permanently delete your <strong>CavBot account</strong>.
              </p>
              <p className="sx-modalHint">This action cannot be undone. Confirm only if you intend to remove your account.</p>

              <br />

              <div className="sx-field">
                <div className="sx-label">Password</div>
                <input
                  className="sx-input"
                  type="password"
                  value={delPw}
                  onChange={(e) => setDelPw(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={saving}
                />
              </div>

              <br />

              <label className="sx-delCheck">
                <input
                  type="checkbox"
                  checked={delConfirm}
                  onChange={(e) => setDelConfirm(e.target.checked)}
                  disabled={saving}
                />
                <span>I understand this is permanent.</span>
              </label>
            </div>

            <div className="sx-modalActions">
              <button className="sx-btn sx-btnGhost" type="button" onClick={closeDeleteModal} disabled={saving}>
                Cancel
              </button>
              <button
                className={`sx-btn sx-btnDanger ${saving ? "is-disabled" : ""}`}
                type="button"
                onClick={confirmDeleteAccount}
                disabled={saving}
              >
                {saving ? "Deleting…" : "Proceed"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
