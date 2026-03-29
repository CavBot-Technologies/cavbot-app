"use client";

import * as React from "react";

import "./collaboration.css";
import { CavGuardModal } from "@/components/CavGuardModal";
import { readGuardDecisionFromPayload } from "@/src/lib/cavguard/cavGuard.client";
import type { CavGuardDecision } from "@/src/lib/cavguard/cavGuard.types";

type CollabPolicy = {
  allowAdminsManageCollaboration: boolean;
  allowMembersEditFiles: boolean;
  allowMembersCreateUpload: boolean;
  allowAdminsPublishArtifacts: boolean;
  allowAdminsViewAccessLogs: boolean;
  enableContributorLinks: boolean;
  allowTeamAiAccess: boolean;
};

type SettingsPayload = {
  ok?: boolean;
  collabPolicy?: Partial<CollabPolicy>;
  message?: string;
  error?: string;
  guardDecision?: CavGuardDecision | null;
};

const DEFAULT_POLICY: CollabPolicy = {
  allowAdminsManageCollaboration: false,
  allowMembersEditFiles: false,
  allowMembersCreateUpload: false,
  allowAdminsPublishArtifacts: false,
  allowAdminsViewAccessLogs: false,
  enableContributorLinks: false,
  allowTeamAiAccess: false,
};

function normalizePolicy(raw: unknown): CollabPolicy {
  const policy = raw && typeof raw === "object" ? (raw as Partial<CollabPolicy>) : {};
  return {
    allowAdminsManageCollaboration: Boolean(policy.allowAdminsManageCollaboration),
    allowMembersEditFiles: Boolean(policy.allowMembersEditFiles),
    allowMembersCreateUpload: Boolean(policy.allowMembersCreateUpload),
    allowAdminsPublishArtifacts: Boolean(policy.allowAdminsPublishArtifacts),
    allowAdminsViewAccessLogs: Boolean(policy.allowAdminsViewAccessLogs),
    enableContributorLinks: Boolean(policy.enableContributorLinks),
    allowTeamAiAccess: Boolean(policy.allowTeamAiAccess),
  };
}

function extractMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const p = payload as { message?: unknown; error?: unknown };
    return String(p.message || p.error || fallback);
  }
  return fallback;
}

async function fetchPolicy(): Promise<CollabPolicy> {
  const res = await fetch("/api/cavcloud/settings", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const json = (await res.json().catch(() => null)) as SettingsPayload | null;
  if (!res.ok || !json?.ok) {
    throw new Error(extractMessage(json, "Failed to load collaboration settings."));
  }
  return normalizePolicy(json.collabPolicy || DEFAULT_POLICY);
}

async function savePolicy(patch: Partial<CollabPolicy>) {
  const res = await fetch("/api/cavcloud/settings", {
    method: "PATCH",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      collabPolicy: patch,
    }),
  });
  const json = (await res.json().catch(() => null)) as SettingsPayload | null;
  const guardDecision = readGuardDecisionFromPayload(json);
  if (!res.ok || !json?.ok) {
    throw Object.assign(new Error(extractMessage(json, "Failed to save collaboration settings.")), { guardDecision });
  }
  return normalizePolicy(json.collabPolicy || DEFAULT_POLICY);
}

type AuditFilter = "all" | "grants" | "open_downloads" | "edits";

type AuditRow = {
  id: string;
  actionLabel: string;
  createdAtISO: string;
  targetLabel: string;
  deepLinkHref: string | null;
  operator: {
    displayName: string;
    username: string | null;
    initials: string;
  };
};

type AuditPayload = {
  ok?: boolean;
  rows?: AuditRow[];
  nextCursor?: string | null;
  filter?: AuditFilter;
  message?: string;
};

const AUDIT_FILTERS: Array<{ key: AuditFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "grants", label: "Access granted/revoked" },
  { key: "open_downloads", label: "Opens/downloads" },
  { key: "edits", label: "Edits/conflicts/denied" },
];

async function fetchAudit(args: {
  filter: AuditFilter;
  cursor?: string | null;
  limit?: number;
}): Promise<AuditPayload> {
  const params = new URLSearchParams();
  params.set("kind", args.filter);
  params.set("limit", String(Math.max(1, Math.min(120, Math.trunc(Number(args.limit || 24)) || 24))));
  if (args.cursor) params.set("cursor", args.cursor);

  const res = await fetch(`/api/cavcloud/collab/audit?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });
  const json = (await res.json().catch(() => null)) as AuditPayload | null;
  if (!res.ok || !json?.ok) {
    throw new Error(extractMessage(json, "Failed to load collaboration audit."));
  }
  return json;
}

type ToggleRowProps = {
  id: keyof CollabPolicy;
  title: string;
  subtitle: React.ReactNode;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: keyof CollabPolicy, next: boolean) => void;
};

function ToggleRow(props: ToggleRowProps) {
  return (
    <div className="sx-collabRow">
      <div className="sx-collabRowText">
        <div className="sx-collabRowTitle">{props.title}</div>
        <div className="sx-collabRowSub">{props.subtitle}</div>
      </div>
      <button
        className={`sx-collabToggle ${props.checked ? "is-on" : ""}`}
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled}
        onClick={() => props.onToggle(props.id, !props.checked)}
      >
        <span className="sx-collabToggleKnob" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function CollaborationClient() {
  const [policy, setPolicy] = React.useState<CollabPolicy>(DEFAULT_POLICY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [guardDecision, setGuardDecision] = React.useState<CavGuardDecision | null>(null);
  const [savedAt, setSavedAt] = React.useState<string>("");
  const [auditFilter, setAuditFilter] = React.useState<AuditFilter>("all");
  const [auditRows, setAuditRows] = React.useState<AuditRow[]>([]);
  const [auditError, setAuditError] = React.useState<string>("");
  const [auditCursor, setAuditCursor] = React.useState<string | null>(null);
  const [auditLoadingMore, setAuditLoadingMore] = React.useState<boolean>(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const nextPolicy = await fetchPolicy();
        if (!alive) return;
        setPolicy(nextPolicy);
        setError("");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Failed to load collaboration settings.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onToggle = React.useCallback(async (id: keyof CollabPolicy, next: boolean) => {
    if (saving) return;
    const previous = policy;
    const optimistic = { ...policy, [id]: next };
    setPolicy(optimistic);
    setSaving(true);
    setError("");
    try {
      const persisted = await savePolicy({ [id]: next });
      setPolicy(persisted);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      const decision = (err as { guardDecision?: CavGuardDecision | null })?.guardDecision;
      if (decision) {
        setGuardDecision(decision);
      }
      setPolicy(previous);
      setError(err instanceof Error ? err.message : "Failed to save collaboration settings.");
    } finally {
      setSaving(false);
    }
  }, [policy, saving]);

  React.useEffect(() => {
    let alive = true;
    setAuditError("");
    setAuditRows([]);
    setAuditCursor(null);

    void fetchAudit({ filter: auditFilter, limit: 24 })
      .then((payload) => {
        if (!alive) return;
        setAuditRows(Array.isArray(payload.rows) ? payload.rows : []);
        setAuditCursor(String(payload.nextCursor || "").trim() || null);
      })
      .catch((err) => {
        if (!alive) return;
        setAuditError(err instanceof Error ? err.message : "Failed to load collaboration audit.");
      });

    return () => {
      alive = false;
    };
  }, [auditFilter]);

  const loadMoreAudit = React.useCallback(async () => {
    if (!auditCursor || auditLoadingMore) return;
    setAuditLoadingMore(true);
    setAuditError("");
    try {
      const payload = await fetchAudit({
        filter: auditFilter,
        cursor: auditCursor,
        limit: 24,
      });
      setAuditRows((prev) => [...prev, ...(Array.isArray(payload.rows) ? payload.rows : [])]);
      setAuditCursor(String(payload.nextCursor || "").trim() || null);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Failed to load collaboration audit.");
    } finally {
      setAuditLoadingMore(false);
    }
  }, [auditCursor, auditFilter, auditLoadingMore]);

  const controlsDisabled = saving;

  return (
    <>
      <CavGuardModal
        open={Boolean(guardDecision)}
        decision={guardDecision}
        onClose={() => setGuardDecision(null)}
        onCtaClick={() => setGuardDecision(null)}
      />
      <section className="sx-panel" aria-label="Collaboration and permissions">
        <header className="sx-panelHead">
          <div>
            <h2 className="sx-h2">Collaboration &amp; Permissions</h2>
            <p className="sx-sub">Owner-controlled access policy for CavCloud and CavCode collaboration.</p>
          </div>
        </header>

        <div className="sx-body">
          {error ? <div className="sx-collabState is-error">{error}</div> : null}
          <div className="sx-collabGrid">
            <ToggleRow
              id="allowTeamAiAccess"
              title="Allow team AI access"
              subtitle="OFF means owner-only AI. ON allows admins and members within plan and action guardrails."
              checked={policy.allowTeamAiAccess}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="allowAdminsManageCollaboration"
              title="Allow admins to manage collaboration grants"
              subtitle="Admins can add or revoke file/folder/project collaborators."
              checked={policy.allowAdminsManageCollaboration}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="allowMembersEditFiles"
              title="Allow members to edit files"
              subtitle="Members still require explicit effective edit permission."
              checked={policy.allowMembersEditFiles}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="allowMembersCreateUpload"
              title="Allow members to create and upload files"
              subtitle="Controls member write-path creation behavior."
              checked={policy.allowMembersCreateUpload}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="allowAdminsPublishArtifacts"
              title="Allow admins to publish artifacts"
              subtitle="Publish and unpublish controls for CavCloud public artifacts."
              checked={policy.allowAdminsPublishArtifacts}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="allowAdminsViewAccessLogs"
              title="Allow admins to view Access Logs"
              subtitle="Visibility only. Does not grant edit rights."
              checked={policy.allowAdminsViewAccessLogs}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
            <ToggleRow
              id="enableContributorLinks"
              title="Arcade access"
              subtitle={(
                <>
                  Premium+ required to enable Arcade access controls.{" "}
                  <a href="/settings/upgrade?plan=premium_plus&billing=monthly">Unlock Arcade</a>
                </>
              )}
              checked={policy.enableContributorLinks}
              disabled={controlsDisabled}
              onToggle={onToggle}
            />
          </div>

          <section className="sx-collabAudit" aria-label="Collaboration audit">
            <div className="sx-collabAuditHead">
              <div className="sx-collabAuditHeading">
                <div className="sx-collabAuditTitle">Collaboration Audit</div>
                <div className="sx-collabAuditSub">Owner-only access and permission intelligence across CavCloud.</div>
              </div>
            </div>
            <div className="sx-collabAuditContent">
              <div className="sx-collabAuditControls">
                <label className="sx-collabAuditFilterField">
                  <span className="sx-collabAuditFilterLabel">Filter</span>
                  <select
                    className="sx-collabAuditFilterSelect"
                    value={auditFilter}
                    onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}
                    disabled={auditLoadingMore}
                    aria-label="Collaboration audit filters"
                  >
                    {AUDIT_FILTERS.map((filter) => (
                      <option key={filter.key} value={filter.key}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="sx-collabAuditResults">
                {auditError ? <div className="sx-collabState is-error">{auditError}</div> : null}
                {!auditRows.length && !auditError ? (
                  <div className="sx-collabState">No collaboration audit events found.</div>
                ) : null}

                <div className="sx-collabAuditTableScroll sx-tableScroll sx-tableScrollNoUi">
                  <div className="sx-collabAuditListWrap">
                    <div className="sx-collabAuditCols" aria-hidden="true">
                      <span>Operator</span>
                      <span>Event</span>
                      <span>Target</span>
                      <span>Time</span>
                    </div>
                    <div className="sx-collabAuditList">
                      {auditRows.map((row) => (
                        <div key={row.id} className="sx-collabAuditRow">
                          <div className="sx-collabAuditOperator">
                            <span className="sx-collabAuditInitials" aria-hidden="true">{row.operator.initials || "CB"}</span>
                            <div className="sx-collabAuditOperatorText">
                              <div className="sx-collabAuditOperatorName">{row.operator.displayName || "CavCloud user"}</div>
                              <div className="sx-collabAuditOperatorMeta">
                                {row.operator.username ? `@${row.operator.username}` : "Workspace user"}
                              </div>
                            </div>
                          </div>
                          <div className="sx-collabAuditEvent">
                            <span className="sx-collabAuditEventPill">{row.actionLabel}</span>
                          </div>
                          <div className="sx-collabAuditTarget">
                            {row.deepLinkHref ? (
                              <a href={row.deepLinkHref} className="sx-collabAuditLink">{row.targetLabel || "Open target"}</a>
                            ) : (
                              row.targetLabel || "Target unavailable"
                            )}
                          </div>
                          <div className="sx-collabAuditTime">
                            <time dateTime={row.createdAtISO}>{new Date(row.createdAtISO).toLocaleString()}</time>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="sx-scrollCue" aria-hidden="true">
                    <svg viewBox="0 0 24 10" focusable="false" aria-hidden="true">
                      <polyline points="6 1 1 5 6 9" />
                      <polyline points="18 1 23 5 18 9" />
                      <line x1="2" y1="5" x2="22" y2="5" />
                    </svg>
                  </div>
                </div>
                <div className={`sx-collabAuditPager ${auditCursor ? "" : "is-empty"}`}>
                  {auditCursor ? (
                    <button
                      type="button"
                      className="sx-collabAuditMoreBtn"
                      onClick={() => void loadMoreAudit()}
                      disabled={auditLoadingMore}
                    >
                      Load more
                    </button>
                  ) : (
                    <div className="sx-collabAuditPagerText">No more events</div>
                  )}
                </div>
              </div>
            </div>
          </section>
          {savedAt ? <div className="sx-collabState is-saved">Saved at {savedAt}</div> : null}
        </div>
      </section>
    </>
  );
}
