"use client";

import type { MutableRefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  PUBLIC_STATUS_PICKER_OPTIONS,
  containsEmoji,
  isArcadeStatusMode,
  isPublicStatusMode,
  normalizePublicStatusNote,
  publicStatusToneFromMode,
} from "@/lib/publicProfile/publicStatus";

type OwnerStatusState = {
  showStatusOnPublicProfile: boolean;
  userStatus: string | null;
  note: string | null;
  updatedAtISO: string | null;
};

function relativeAgeFromISO(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function PublicProfileStatusOwnerClient(props: {
  username: string;
  initial: OwnerStatusState;
  variant?: "card" | "header";
}) {
  const [state, setState] = useState<OwnerStatusState>(props.initial);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const wasOpenRef = useRef(false);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!state.updatedAtISO) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, [state.updatedAtISO]);
  void tick;

  const display = useMemo(() => {
    const show = Boolean(state.showStatusOnPublicProfile);
    const mode = String(state.userStatus ?? "").trim();
    const note = String(state.note ?? "").trim();
    const okMode = isPublicStatusMode(mode);
    const modeLabel = okMode ? mode : "Not set";

    if (!show) {
      return { show: false, mode: null as string | null, modeLabel: "Not set", note: "", primary: "Not set", secondary: "" };
    }

    if (!okMode) {
      return { show: true, mode: null as string | null, modeLabel: "Not set", note: "", primary: "Not set", secondary: "" };
    }

    const primary = note ? `${mode} · ${note}` : mode;
    const updated = state.updatedAtISO ? `Updated ${relativeAgeFromISO(state.updatedAtISO)}` : "";
    return { show: true, mode, modeLabel, note, primary, secondary: updated };
  }, [state.showStatusOnPublicProfile, state.userStatus, state.note, state.updatedAtISO]);

  const tone = useMemo(() => {
    if (!display.show) return "white";
    return publicStatusToneFromMode(display.mode);
  }, [display.show, display.mode]);

  const modeAttr = display.show && display.mode && isPublicStatusMode(display.mode) ? display.mode : "";

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("cb-modal-open");
    return () => document.body.classList.remove("cb-modal-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => {};
  }, [open]);

  useEffect(() => {
    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      if (triggerRef.current) triggerRef.current.focus();
    }
  }, [open]);

  const openModal = () => {
    setError(null);
    wasOpenRef.current = true;
    setOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setOpen(false);
  };

  const onSave = async (next: { showStatusOnPublicProfile: boolean; userStatus: string; note: string }) => {
    setError(null);

    const showStatusOnPublicProfile = Boolean(next.showStatusOnPublicProfile);
    const mode = String(next.userStatus || "").trim();
    const noteNorm = normalizePublicStatusNote(next.note);

    if (noteNorm && noteNorm.length > 64) {
      setError("Note must be 64 characters or less.");
      return;
    }
    if (noteNorm && containsEmoji(noteNorm)) {
      setError("Emojis are not allowed in status.");
      return;
    }
    // Allow "Not set" while visible; only validate when a mode is present.
    if (mode && !isPublicStatusMode(mode)) {
      setError("Select a valid status.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/public/profile/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          showStatusOnPublicProfile,
          userStatus: mode ? mode : null,
          note: noteNorm,
        }),
      });

      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(String(data?.message || "Save failed."));
        return;
      }

      const nowISO = new Date().toISOString();
      setState({
        showStatusOnPublicProfile,
        userStatus: isPublicStatusMode(mode) ? mode : null,
        note: noteNorm,
        updatedAtISO: nowISO,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`pp-status${props.variant === "header" ? " pp-statusHeader" : ""}`}
      aria-label="Account status"
      data-tone={tone}
      data-mode={modeAttr}
    >
      <div className="pp-statusRow">
        <div className="pp-statusLeft">
          <button
            ref={triggerRef}
            type="button"
            className="pp-statusIconBtn"
            onClick={openModal}
            aria-label="Set status"
            title="Set status"
          >
            <SmileyIcon live={Boolean(display.show && display.mode && display.mode !== "Offline")} arcade={isArcadeStatusMode(display.mode)} />
          </button>
          <div className="pp-statusTextWrap">
            <div className="pp-statusPrimary">{display.primary}</div>
            {props.variant !== "header" && display.secondary ? (
              <div className="pp-statusSecondary">{display.secondary}</div>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <StatusModal
          initial={{
            showStatusOnPublicProfile: Boolean(state.showStatusOnPublicProfile),
            userStatus: isPublicStatusMode(String(state.userStatus ?? "").trim()) ? String(state.userStatus ?? "").trim() : "",
            note: String(state.note ?? ""),
          }}
          saving={saving}
          error={error}
          statusSelectRef={firstFieldRef}
          onCancel={closeModal}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}

function SmileyIcon({ live, arcade }: { live: boolean; arcade: boolean }) {
  // Simple "digital" smiley; color is driven by CSS variables (SVG only).
  return (
    <svg
      className={`pp-statusSmiley cb-userStatusIcon${arcade ? " is-arcade" : ""}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="8" y="10" width="2.4" height="2.4" rx="0.8" fill="currentColor" />
      <rect x="13.6" y="10" width="2.4" height="2.4" rx="0.8" fill="currentColor" />
      {live ? (
        <path d="M8 15.2c1 1.1 2.4 1.7 4 1.7s3-.6 4-1.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

function StatusModal(props: {
  initial: { showStatusOnPublicProfile: boolean; userStatus: string; note: string };
  saving: boolean;
  error: string | null;
  statusSelectRef: MutableRefObject<HTMLSelectElement | null>;
  onCancel: () => void;
  onSave: (next: { showStatusOnPublicProfile: boolean; userStatus: string; note: string }) => void;
}) {
  const { initial, saving, error, statusSelectRef, onCancel, onSave } = props;
  const [showStatusOnPublicProfile, setShowStatusOnPublicProfile] = useState(Boolean(initial.showStatusOnPublicProfile));
  const [userStatus, setUserStatus] = useState(String(initial.userStatus || ""));
  const [note, setNote] = useState(String(initial.note || ""));

  return (
    <div className="cb-modal pp-modalRoot" role="dialog" aria-modal="true" aria-label="Set status">
      <div className="cb-modal-backdrop pp-modalBackdrop" onClick={onCancel} />
      <div className="cb-modal-card pp-modalCard" role="document">
        <div className="cb-modal-top">
          <div className="cb-modal-title">Set status</div>
          <button type="button" className="cb-modal-close" onClick={onCancel} aria-label="Close" disabled={saving}>
            <span className="cb-closeIcon" aria-hidden="true" />
          </button>
        </div>

        <div className="cb-modal-body">
          <div className="cb-modal-section">
            <div className="cb-modal-label">Status</div>
            <select
              ref={statusSelectRef}
              className="pp-field"
              value={userStatus}
              onChange={(e) => setUserStatus(e.target.value)}
              disabled={saving}
              aria-label="Status"
            >
              {PUBLIC_STATUS_PICKER_OPTIONS.map((opt) => (
                <option key={`${opt.label}:${opt.value}`} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="cb-modal-section">
            <div className="cb-modal-label">Note</div>
            <input
              className="pp-field"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note…"
              maxLength={64}
              disabled={saving}
              aria-label="Optional note"
            />
            <div className="pp-fieldHint">Max 64 characters.</div>
          </div>

          <div className="cb-modal-section">
            <label className="pp-toggleRow">
              <input
                type="checkbox"
                checked={showStatusOnPublicProfile}
                onChange={(e) => setShowStatusOnPublicProfile(Boolean(e.target.checked))}
                disabled={saving}
              />
              <span className="pp-toggleLabel">Show status on public profile</span>
            </label>
          </div>

          {error ? <div className="pp-modalError" role="status">{error}</div> : null}
        </div>

        <div className="cb-modal-actions">
          <button type="button" className="cb-modal-action" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="cb-modal-action cb-modal-actionPrimary"
            onClick={() => onSave({ showStatusOnPublicProfile, userStatus, note })}
            disabled={saving}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
