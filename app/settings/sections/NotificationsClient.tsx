// app/settings/sections/NotificationsClient.tsx
"use client";

import * as React from "react";
import { CavbotTone, playCavbotTone } from "@/lib/cavbotTone";
import "./notifications.css";

type Tone = "good" | "watch" | "bad";

const ALERT_TONES: { value: CavbotTone; label: string; description: string }[] = [
  {
    value: "cavbot-chime",
    label: "CavBot chime",
    description: "Fluid cinematic tone",
  },
  {
    value: "cavbot-ping",
    label: "CavBot ping",
    description: "Crisp high note",
  },
  {
    value: "cavbot-vibrate-calm",
    label: "CavBot calm vibration",
    description: "Feathered pulse",
  },
  {
    value: "cavbot-vibrate-urgent",
    label: "CavBot urgent vibration",
    description: "Tactile alert buzz",
  },
];

const ALERT_TONE_SET = new Set(ALERT_TONES.map((item) => item.value));

function validAlertTone(value: unknown): value is CavbotTone {
  return typeof value === "string" && ALERT_TONE_SET.has(value as CavbotTone);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
type NotifState = {
  promoEmail: boolean;
  productUpdates: boolean;
  billingEmails: boolean;
  securityEmails: boolean;

  inAppSignals: boolean;
  sound: boolean;
  quietHours: boolean;
  vibrate: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  quietHoursTimezone: string;
  alertTone: CavbotTone;

  digestEmail: boolean;
  digestInApp: boolean;

  evtSubDue: boolean;
  evtSubRenewed: boolean;
  evtSubExpired: boolean;
  evtUpgraded: boolean;
  evtDowngraded: boolean;

  evtSiteCritical: boolean;
  evtSeatInviteAccepted: boolean;
  evtSeatLimitHit: boolean;

  evtNewFeatures: boolean;
};

type SettingsPayload = {
  ok: true;
  settings: Record<string, unknown>;
  message?: string;
  error?: string;
};

type SettingsError = {
  ok?: false;
  message?: string;
  error?: string;
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

  const data = (await res.json().catch(() => ({}))) as SettingsPayload | SettingsError;
  if (!res.ok || data?.ok === false) {
    const msg = data?.message || data?.error || "Request failed";
    throw Object.assign(new Error(String(msg)), { status: res.status, data });
  }
  return data as T;
}

function clampBool(v: unknown, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function buildStateFromServer(raw: unknown): NotifState {
  const record = isRecord(raw) ? raw : {};
  const base: NotifState = {
    promoEmail: false,
    productUpdates: true,
    billingEmails: true,
    securityEmails: true,

    inAppSignals: true,
    sound: true,
    quietHours: false,
    vibrate: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    quietHoursTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    alertTone: "cavbot-chime",

    digestEmail: true,
    digestInApp: false,

    evtSubDue: true,
    evtSubRenewed: true,
    evtSubExpired: true,
    evtUpgraded: true,
    evtDowngraded: true,

    evtSiteCritical: true,
    evtSeatInviteAccepted: true,
    evtSeatLimitHit: true,

    evtNewFeatures: true,
  };

  return {
    promoEmail: clampBool(record?.promoEmail, base.promoEmail),
    productUpdates: clampBool(record?.productUpdates, base.productUpdates),
    billingEmails: clampBool(record?.billingEmails, base.billingEmails),
    securityEmails: clampBool(record?.securityEmails, base.securityEmails),

    inAppSignals: clampBool(record?.inAppSignals, base.inAppSignals),
    sound: clampBool(record?.sound, base.sound),
    quietHours: clampBool(record?.quietHours, base.quietHours),
    vibrate: clampBool(record?.vibrate, base.vibrate),
    quietHoursStart: typeof record?.quietHoursStart === "string" ? record.quietHoursStart : base.quietHoursStart,
    quietHoursEnd: typeof record?.quietHoursEnd === "string" ? record.quietHoursEnd : base.quietHoursEnd,
    quietHoursTimezone:
      typeof record?.quietHoursTimezone === "string" ? record.quietHoursTimezone : base.quietHoursTimezone,
    alertTone: validAlertTone(record?.alertTone) ? record.alertTone : base.alertTone,

    digestEmail: clampBool(record?.digestEmail, base.digestEmail),
    digestInApp: clampBool(record?.digestInApp, base.digestInApp),

    evtSubDue: clampBool(record?.evtSubDue, base.evtSubDue),
    evtSubRenewed: clampBool(record?.evtSubRenewed, base.evtSubRenewed),
    evtSubExpired: clampBool(record?.evtSubExpired, base.evtSubExpired),
    evtUpgraded: clampBool(record?.evtUpgraded, base.evtUpgraded),
    evtDowngraded: clampBool(record?.evtDowngraded, base.evtDowngraded),

    evtSiteCritical: clampBool(record?.evtSiteCritical, base.evtSiteCritical),
    evtSeatInviteAccepted: clampBool(record?.evtSeatInviteAccepted, base.evtSeatInviteAccepted),
    evtSeatLimitHit: clampBool(record?.evtSeatLimitHit, base.evtSeatLimitHit),

    evtNewFeatures: clampBool(record?.evtNewFeatures, base.evtNewFeatures),
  };
}

function ToggleRow(props: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tone?: Tone;
  disabled?: boolean;
  tooltip?: string;
  onBeforeChange?: (nextValue: boolean) => void;
}) {
  return (
    <div className="sx-notifRow" data-tone={props.tone || "good"}>
      <div className="sx-notifRowLeft">
        <div className="sx-notifLabel">{props.label}</div>
        <div className="sx-notifSub">{props.sub}</div>
      </div>

      <button
        className={`sx-modernToggle ${props.checked ? "is-on" : ""}`}
        type="button"
        role="switch"
        aria-checked={props.checked ? "true" : "false"}
        onClick={() => {
          if (props.disabled) return;
          const next = !props.checked;
          props.onBeforeChange?.(next);
          props.onChange(next);
        }}
        disabled={props.disabled}
        aria-disabled={props.disabled ? "true" : "false"}
        title={props.tooltip}
      >
        <span className="sx-modernToggleKnob" aria-hidden="true" />
        <span className="cb-sr-only">{props.checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

export default function NotificationsClient() {
  const defaultTimezone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [accountTimezone, setAccountTimezone] = React.useState(defaultTimezone);
  const [state, setState] = React.useState<NotifState>(() => ({
    ...buildStateFromServer(null),
    quietHoursTimezone: defaultTimezone,
  }));
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: Tone; msg: string } | null>(null);
  const toastTimer = React.useRef<number | null>(null);

  function pushToast(msg: string, tone: Tone = "good") {
    setToast({ msg, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const d = await apiJSON<SettingsPayload>("/api/notifications/settings");
        if (!alive) return;
        const tz = accountTimezone || defaultTimezone;
        const next = buildStateFromServer(d.settings);
        const nextWithTZ = { ...next, quietHoursTimezone: tz };
        setState(nextWithTZ);
        try {
          window.dispatchEvent(new CustomEvent("cb:notification-settings", { detail: nextWithTZ }));
        } catch {}
      } catch {
        if (!alive) return;
        const fallback = buildStateFromServer(null);
        const tz = accountTimezone || defaultTimezone;
        setState({ ...fallback, quietHoursTimezone: tz });
        pushToast("Couldn’t load notification settings. Using defaults.", "watch");
      }
    })();

    return () => {
      alive = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [accountTimezone, defaultTimezone]);

  type ProfileResponse = {
    profile?: { timeZone?: string };
    timeZone?: string;
  };

  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await fetch("/api/settings/account", {
          method: "GET",
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as ProfileResponse | null;
        if (!alive) return;
        const tz =
          String(json?.profile?.timeZone || json?.timeZone || defaultTimezone)
            .trim()
            || defaultTimezone;
        if (tz) {
          setAccountTimezone(tz);
        }
      } catch {
        // fail silently, keep fallback timezone
      }
    })();

    return () => {
      alive = false;
    };
  }, [defaultTimezone]);

  React.useEffect(() => {
    if (state.quietHoursTimezone === accountTimezone) return;
    setState({ ...state, quietHoursTimezone: accountTimezone });
  }, [accountTimezone, state]);

  const patch = React.useCallback(
    async (nextPatch: Partial<NotifState>, msg?: string) => {
      const prev = state;
      const tzForSave = accountTimezone || defaultTimezone;
      const next: NotifState = {
        ...state,
        ...nextPatch,
        quietHoursTimezone: tzForSave,
      };
      setState(next);

      setSaving(true);
      try {
        await apiJSON<{ ok: true; settings: Record<string, unknown> }>("/api/notifications/settings", {
          method: "POST",
          body: JSON.stringify({
            ...nextPatch,
            quietHoursTimezone: tzForSave,
          }),
        });

        if (msg) pushToast(msg, "good");
      } catch (error) {
        setState(prev);
        const message = error instanceof Error ? error.message : String(error);
        pushToast(message || "Update failed.", "bad");
      } finally {
        setSaving(false);
      }
    },
    [state, accountTimezone, defaultTimezone]
  );

  const patchRef = React.useRef<typeof patch | null>(null);
  React.useEffect(() => {
    patchRef.current = patch;
  }, [patch]);

  const prevQuietRef = React.useRef(state.quietHours);
  React.useEffect(() => {
    const prev = prevQuietRef.current;
    if (!prev && state.quietHours) {
      playCavbotTone("cavbot-vibrate-calm");
      patchRef.current?.({ alertTone: "cavbot-vibrate-calm" }, "Quiet hours tone engaged.");
    } else if (prev && !state.quietHours && state.alertTone === "cavbot-vibrate-calm") {
      patchRef.current?.({ alertTone: "cavbot-chime" }, "Quiet hours ended; chime restored.");
    }
    prevQuietRef.current = state.quietHours;
  }, [state]);

  function handleAlertToneChange(nextTone: CavbotTone) {
    playCavbotTone(nextTone);
    patch({ alertTone: nextTone }, "Alert tone updated.");
  }

  React.useEffect(() => {
    const detail = {
      enabled: state.quietHours,
      start: state.quietHoursStart,
      end: state.quietHoursEnd,
      timezone: state.quietHoursTimezone,
      alertTone: state.alertTone,
      sound: !state.alertTone.startsWith("cavbot-vibrate"),
    };
    try {
      window.dispatchEvent(new CustomEvent("cb:quiet-hours", { detail }));
    } catch {}
  }, [state]);

  const s = state;

  async function restoreDefaults() {
    const tzForSave = accountTimezone || defaultTimezone;
    const defaults = { ...buildStateFromServer(null), quietHoursTimezone: tzForSave };
    const prev = s;

    setState(defaults);
    setSaving(true);

    try {
      await apiJSON<{ ok: true; settings: Record<string, unknown> }>("/api/notifications/settings", {
        method: "POST",
        body: JSON.stringify(defaults),
      });
      try {
        window.dispatchEvent(new CustomEvent("cb:notification-settings", { detail: defaults }));
      } catch {}
      pushToast("Defaults restored.", "good");
    } catch (error) {
      setState(prev);
      const message = error instanceof Error ? error.message : String(error);
      pushToast(message || "Could not restore defaults.", "bad");
    } finally {
      setSaving(false);
    }
  }

  type BooleanKeyOf<T> = { [K in keyof T]: T[K] extends boolean ? K : never }[keyof T];
  type TonicEntry = [label: string, description: string, tone: Tone, field: BooleanKeyOf<NotifState>];

  const tonicGroups: { title: string; entries: TonicEntry[] }[] = [
    {
      title: "Billing lifecycle",
      entries: [
        ["Subscription due soon", "Heads-up before renewal.", "watch", "evtSubDue"],
        ["Subscription renewed", "Successful renewal confirmation.", "good", "evtSubRenewed"],
        ["Subscription expired", "Subscription ended or canceled.", "bad", "evtSubExpired"],
        ["Account upgraded", "Free → Premium, Premium → Premium+.", "good", "evtUpgraded"],
        ["Account downgraded", "Premium+ → Premium, Premium → Free.", "watch", "evtDowngraded"],
      ],
    },
    {
      title: "Workspace + product",
      entries: [
        ["Site is critical", "Health degraded or stability risk detected.", "bad", "evtSiteCritical"],
        ["Invite accepted", "A member joined your workspace.", "good", "evtSeatInviteAccepted"],
        ["Seat limit reached", "Plan limit hit. Upgrade to invite more.", "watch", "evtSeatLimitHit"],
        ["Platform updates", "New features and improvements.", "good", "evtNewFeatures"],
      ],
    },
  ];

  return (
    <section className="sx-panel" aria-label="Notifications settings">
      <header className="sx-panelHead">
        <div className="sx-notifHeaderText">
          <h2 className="sx-h2">Notifications</h2>
          <p className="sx-sub">Delivery preferences and alert routing for CavBot.</p>
        </div>
      </header>

      <div className="sx-body">
        <div className="sx-notifGridWrap">
          <article className="sx-card sx-cardShadow sx-cardSquare">
            <div className="sx-cardInner">
              <div>
                <div className="sx-kicker">Email alerts</div>
                <p className="sx-cardSub">Choose which updates land in your inbox.</p>
              </div>

              <div className="sx-cardGroup" aria-label="Email controls">
                <ToggleRow
                  label="Billing emails"
                  sub="Receipts, renewals, and invoice notices."
                  checked={s.billingEmails}
                  onChange={(v) => patch({ billingEmails: v }, "Email settings updated.")}
                  tone="good"
                  disabled={saving}
                />
                <ToggleRow
                  label="Security emails"
                  sub="Login alerts and recovery confirmations."
                  checked={s.securityEmails}
                  onChange={(v) => patch({ securityEmails: v }, "Email settings updated.")}
                  tone="watch"
                  disabled={saving}
                />
                <ToggleRow
                  label="Product updates"
                  sub="New modules and release improvements."
                  checked={s.productUpdates}
                  onChange={(v) => patch({ productUpdates: v }, "Email settings updated.")}
                  tone="good"
                  disabled={saving}
                />
                <ToggleRow
                  label="Email digest"
                  sub="Bundle non-critical updates into a daily summary."
                  checked={s.digestEmail}
                  onChange={(v) => patch({ digestEmail: v }, "Email settings updated.")}
                  tone="good"
                  disabled={saving}
                />
                <ToggleRow
                  label="Promotional email"
                  sub="Optional CavBot news you can skip."
                  checked={s.promoEmail}
                  onChange={(v) => patch({ promoEmail: v }, "Email settings updated.")}
                  tone="bad"
                  disabled={saving}
                />
              </div>
            </div>
          </article>

          <article className="sx-card sx-cardShadow sx-cardSquare">
            <div className="sx-cardInner">
              <div>
                <div className="sx-kicker">In-app signals</div>
                <p className="sx-cardSub">Control what appears in CavBot Console.</p>
              </div>

              <div className="sx-cardGroup">
                <ToggleRow
                  label="In-app notifications"
                  sub="Signals that surface inside the app shell."
                  checked={s.inAppSignals}
                  onChange={(v) => patch({ inAppSignals: v }, "In-app settings updated.")}
                  tone="good"
                  disabled={saving}
                />
                <ToggleRow
                  label="In-app digest"
                  sub="Group non-critical notices into summaries."
                  checked={s.digestInApp}
                  onChange={(v) => patch({ digestInApp: v }, "In-app settings updated.")}
                  tone="good"
                  disabled={saving}
                />
              </div>
            </div>
          </article>

          <article className="sx-card sx-cardShadow sx-cardSquare">
            <div className="sx-cardInner">
              <div>
                <div className="sx-kicker">Sound & quiet hours</div>
                <p className="sx-cardSub">Treat CavBot like a calm but alert companion.</p>
              </div>

              <div className="sx-field">
                <div className="sx-label">Alert tone</div>
                <select
                  className="sx-select"
                  value={s.alertTone}
                  onChange={(e) => handleAlertToneChange(e.target.value as CavbotTone)}
                  disabled={saving}
                >
                  {ALERT_TONES.map((tone) => (
                    <option key={tone.value} value={tone.value}>
                      {tone.label}
                    </option>
                  ))}
                </select>
                <p className="sx-cardSub" style={{ marginTop: 12 }}>
                  {ALERT_TONES.find((tone) => tone.value === s.alertTone)?.description ||
                    "Choose the CavBot tone that fits how you work."}
                </p>
              </div>

              <div className="sx-formRow" style={{ gap: 16 }}>
                <div className="sx-field">
                  <div className="sx-label">Quiet hours start</div>
                  <input
                    className="sx-input"
                    type="time"
                    value={s.quietHoursStart}
                    onChange={(e) => patch({ quietHoursStart: e.target.value }, "Quiet hours schedule saved.")}
                    disabled={saving}
                  />
                </div>
                <div className="sx-field">
                  <div className="sx-label">Quiet hours end</div>
                  <input
                    className="sx-input"
                    type="time"
                    value={s.quietHoursEnd}
                    onChange={(e) => patch({ quietHoursEnd: e.target.value }, "Quiet hours schedule saved.")}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
          </article>

          <article className="sx-card sx-cardShadow sx-cardSquare" aria-label="Event routing">
            <div className="sx-cardInner">
              <div className="sx-notifHead">
                <div>
                  <div className="sx-kicker">Event routing</div>
                  <div className="sx-cardSub">Choose which events fire notifications.</div>
                </div>
                <button className="sx-btn sx-btnGhost" type="button" onClick={restoreDefaults} disabled={saving}>
                  Restore
                </button>
              </div>

              <div className="sx-divider" aria-hidden="true" />
              <div className="sx-notifGrid">
                {tonicGroups.map((group) => (
                  <div className="sx-notifGroup" key={group.title}>
                    <div className="sx-notifGroupTitle">{group.title}</div>
                    <div className="sx-notifGroupBody">
                      {group.entries.map(([label, sub, tone, field]) => (
                        <ToggleRow
                          key={label}
                          label={label}
                          sub={sub}
                          tone={tone}
                          checked={s[field]}
                          onChange={(v) => patch({ [field]: v })}
                          disabled={saving}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </article>
        </div>

        {toast ? (
          <div className="sx-billToast" data-tone={toast.tone} role="status" aria-live="polite">
            {toast.msg}
          </div>
        ) : null}
      </div>
    </section>
  );
}
