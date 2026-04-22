"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Panel } from "@/components/admin/AdminPrimitives";

type ActionFeedback = {
  tone: "good" | "watch" | "bad";
  message: string;
};

type TeamActionCenterProps = {
  staffId: string;
  displayName: string;
  maskedTeamCode: string;
  department: string;
  departmentLabel: string;
  status: string;
  statusLabel: string;
  onboardingStatus: string;
  onboardingLabel: string;
  lifecycleState: string;
  lifecycleLabel: string;
  positionTitle: string;
  notes?: string | null;
  invitedEmail: string;
  suspendedUntilLabel: string;
  canSendAccessReminder: boolean;
  manageable: boolean;
  managementLockedLabel?: string | null;
};

type StaffMutationResponse = {
  ok: boolean;
  error?: string;
};

const ONBOARDING_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "READY", label: "Ready" },
  { value: "COMPLETED", label: "Completed" },
] as const;

const LIFECYCLE_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "LEAVE", label: "Leave" },
  { value: "OFFBOARDING", label: "Offboarding" },
] as const;

function durationLabel(days: 7 | 14 | 30) {
  if (days === 14) return "14 days";
  if (days === 30) return "30 days";
  return "7 days";
}

function resolveActionError(error?: string) {
  switch (String(error || "").trim().toUpperCase()) {
    case "STAFF_PROTECTED":
      return "This team record is protected and cannot be changed from HQ.";
    case "STAFF_REVOKED":
      return "This team record has already been revoked.";
    case "BAD_DURATION":
      return "Choose a valid suspension length.";
    case "OWNER_REQUIRED":
      return "Only the founder can change that team record.";
    case "STAFF_NOT_FOUND":
      return "This team record no longer exists.";
    case "STAFF_CONTACT_MISSING":
      return "No delivery address exists for this team record yet.";
    default:
      return "The team update did not complete.";
  }
}

function SummaryCard(props: { label: string; value: string; meta?: string }) {
  return (
    <div className="hq-opSummaryCard">
      <div className="hq-opSummaryLabel">{props.label}</div>
      <div className="hq-opSummaryValue">{props.value}</div>
      {props.meta ? <div className="hq-opSummaryMeta">{props.meta}</div> : null}
    </div>
  );
}

function FeedbackBanner(props: { feedback: ActionFeedback | null }) {
  if (!props.feedback) return null;
  return (
    <div className="hq-opFeedback" data-tone={props.feedback.tone}>
      {props.feedback.message}
    </div>
  );
}

export function TeamActionCenter(props: TeamActionCenterProps) {
  const router = useRouter();
  const [departmentValue, setDepartmentValue] = useState(props.department);
  const [onboardingValue, setOnboardingValue] = useState(props.onboardingStatus);
  const [lifecycleStateValue, setLifecycleStateValue] = useState(props.lifecycleState);
  const [positionTitle, setPositionTitle] = useState(props.positionTitle);
  const [notesValue, setNotesValue] = useState(props.notes || "");
  const [suspendDays, setSuspendDays] = useState<7 | 14 | 30>(7);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  useEffect(() => {
    setDepartmentValue(props.department);
    setOnboardingValue(props.onboardingStatus);
    setLifecycleStateValue(props.lifecycleState);
    setPositionTitle(props.positionTitle);
    setNotesValue(props.notes || "");
    setSuspendDays(7);
    setBusyKey("");
    setFeedback(null);
  }, [
    props.department,
    props.lifecycleState,
    props.notes,
    props.onboardingStatus,
    props.positionTitle,
    props.staffId,
  ]);

  async function submitProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("profile");
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/staff/${props.staffId}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          department: departmentValue,
          positionTitle,
          notes: notesValue,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as StaffMutationResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(resolveActionError(payload.error));
      }
      setFeedback({ tone: "good", message: "Team profile updated." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "bad",
        message: error instanceof Error ? error.message : "The team profile update failed.",
      });
    } finally {
      setBusyKey("");
    }
  }

  async function submitLifecycleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("lifecycle");
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/staff/${props.staffId}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          onboardingStatus: onboardingValue,
          lifecycleState: lifecycleStateValue,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as StaffMutationResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(resolveActionError(payload.error));
      }
      setFeedback({ tone: "good", message: "Team lifecycle updated." });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "bad",
        message: error instanceof Error ? error.message : "The team lifecycle update failed.",
      });
    } finally {
      setBusyKey("");
    }
  }

  async function performAction(
    key: string,
    request: {
      method: "POST" | "DELETE";
      body?: Record<string, unknown>;
      successMessage: string;
      redirectTo?: string;
    },
  ) {
    setBusyKey(key);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/staff/${props.staffId}`, {
        method: request.method,
        credentials: "include",
        cache: "no-store",
        headers: request.method === "DELETE" ? { accept: "application/json" } : {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: request.method === "DELETE" ? undefined : JSON.stringify(request.body || {}),
      });
      const payload = (await response.json().catch(() => ({}))) as StaffMutationResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(resolveActionError(payload.error));
      }
      setFeedback({ tone: "good", message: request.successMessage });
      if (request.redirectTo) {
        router.push(request.redirectTo);
        router.refresh();
        return;
      }
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "bad",
        message: error instanceof Error ? error.message : "The team action failed.",
      });
    } finally {
      setBusyKey("");
    }
  }

  const actionDisabled = !props.manageable;

  return (
    <Panel title="Action Center" subtitle="Run team placement, lifecycle, onboarding, and access controls directly from HQ.">
      <div id="action-center" className="hq-opSectionStack">
        <div className="hq-opSummaryGrid">
          <SummaryCard label="Team ID" value={props.maskedTeamCode} meta="Masked internal operator code" />
          <SummaryCard label="Department" value={props.departmentLabel} meta="Current operating lane" />
          <SummaryCard label="Access" value={props.statusLabel} meta={props.suspendedUntilLabel !== "—" ? `Until ${props.suspendedUntilLabel}` : "No active restriction"} />
          <SummaryCard label="Onboarding" value={props.onboardingLabel} meta={`Mailbox ${props.invitedEmail}`} />
        </div>

        <FeedbackBanner feedback={feedback} />

        {!props.manageable && props.managementLockedLabel ? (
          <div className="hq-opFeedback hq-opFeedbackBare" data-tone="watch">
            {props.managementLockedLabel}
          </div>
        ) : null}

        <div className="hq-opGrid">
          <section className="hq-opSection">
            <div className="hq-opSectionHeading">
              <div className="hq-opSectionTitle">Team placement</div>
              <p className="hq-opSectionSub">Keep department, title, and internal notes in one controlled surface.</p>
            </div>
            <div className="hq-opActionGrid">
              <form className="hq-opActionCard" onSubmit={submitProfileUpdate}>
                <div className="hq-opActionHead">
                  <div className="hq-opActionTitle">Team profile</div>
                  <div className="hq-opActionSub">Update placement, title, and internal context for this team record.</div>
                </div>
                <div className="hq-opActionBody hq-opForm">
                  <div className="hq-opInlineFields">
                    <label className="hq-formLabel">
                      Department
                      <select className="hq-select" value={departmentValue} onChange={(event) => setDepartmentValue(event.target.value)} disabled={actionDisabled || busyKey === "profile"}>
                        <option value="COMMAND">Command</option>
                        <option value="OPERATIONS">Operations</option>
                        <option value="SECURITY">Security</option>
                        <option value="HUMAN_RESOURCES">Human Resources</option>
                      </select>
                    </label>
                  </div>
                  <label className="hq-formLabel">
                    Title
                    <input className="hq-input" value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} disabled={actionDisabled || busyKey === "profile"} />
                  </label>
                  <label className="hq-formLabel">
                    Notes
                    <textarea
                      className="hq-textarea"
                      rows={4}
                      value={notesValue}
                      onChange={(event) => setNotesValue(event.target.value)}
                      disabled={actionDisabled || busyKey === "profile"}
                      placeholder="Internal team context for Command and Human Resources."
                    />
                  </label>
                </div>
                <div className="hq-opActionFooter">
                  <button type="submit" className="hq-opActionButton" disabled={actionDisabled || busyKey === "profile"}>
                    {busyKey === "profile" ? "Saving..." : "Save profile"}
                  </button>
                </div>
              </form>

              <form className="hq-opActionCard" onSubmit={submitLifecycleUpdate}>
                <div className="hq-opActionHead">
                  <div className="hq-opActionTitle">Team lifecycle</div>
                  <div className="hq-opActionSub">Control onboarding readiness and current employment state without leaving the manage surface.</div>
                </div>
                <div className="hq-opActionBody hq-opForm">
                  <label className="hq-formLabel">
                    Onboarding
                    <select className="hq-select" value={onboardingValue} onChange={(event) => setOnboardingValue(event.target.value)} disabled={actionDisabled || busyKey === "lifecycle"}>
                      {ONBOARDING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="hq-formLabel">
                    Employment state
                    <select className="hq-select" value={lifecycleStateValue} onChange={(event) => setLifecycleStateValue(event.target.value)} disabled={actionDisabled || busyKey === "lifecycle"}>
                      {LIFECYCLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="hq-opActionFooter">
                  <button type="submit" className="hq-opActionButton" disabled={actionDisabled || busyKey === "lifecycle"}>
                    {busyKey === "lifecycle" ? "Saving..." : "Save lifecycle"}
                  </button>
                </div>
              </form>
            </div>
          </section>

          <section className="hq-opSection">
            <div className="hq-opSectionHeading">
              <div className="hq-opSectionTitle">Access &amp; delivery</div>
              <p className="hq-opSectionSub">Handle mailbox reminders and access changes with the same compact control language as the rest of HQ.</p>
            </div>
            <div className="hq-opActionGrid">
              <div className="hq-opActionCard">
                <div className="hq-opActionHead">
                  <div className="hq-opActionTitle">Access reminder</div>
                  <div className="hq-opActionSub">Send the secure HQ sign-in reminder to the active team mailbox.</div>
                </div>
                <div className="hq-opActionBody hq-opForm">
                  <div className="hq-helperText">Mailbox: {props.invitedEmail}</div>
                </div>
                <div className="hq-opActionFooter">
                  <button
                    type="button"
                    className="hq-opActionButton"
                    disabled={actionDisabled || busyKey === "reminder" || !props.canSendAccessReminder}
                    onClick={() => void performAction("reminder", {
                      method: "POST",
                      body: { action: "send_access_reminder" },
                      successMessage: "HQ access reminder sent.",
                    })}
                  >
                    {busyKey === "reminder" ? "Sending..." : "Send reminder"}
                  </button>
                </div>
              </div>

              <div className="hq-opActionCard">
                <div className="hq-opActionHead">
                  <div className="hq-opActionTitle">Access control</div>
                  <div className="hq-opActionSub">Suspended team IDs stop working immediately. Restoring brings the team record back to active status.</div>
                </div>
                <div className="hq-opActionBody hq-opForm">
                  {props.status === "SUSPENDED" ? (
                    <div className="hq-helperText">Suspended until {props.suspendedUntilLabel || "the scheduled restore window"}.</div>
                  ) : (
                    <label className="hq-formLabel">
                      Suspension length
                      <select
                        className="hq-select"
                        value={String(suspendDays)}
                        onChange={(event) => setSuspendDays(Number(event.target.value) as 7 | 14 | 30)}
                        disabled={actionDisabled || busyKey === "suspend"}
                      >
                        <option value="7">7 days</option>
                        <option value="14">14 days</option>
                        <option value="30">30 days</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="hq-opActionFooter">
                  {props.status === "SUSPENDED" ? (
                    <button
                      type="button"
                      className="hq-opActionButton"
                      disabled={actionDisabled || busyKey === "restore"}
                      onClick={() => void performAction("restore", {
                        method: "POST",
                        body: { action: "restore" },
                        successMessage: "Team access restored.",
                      })}
                    >
                      {busyKey === "restore" ? "Restoring..." : "Restore"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="hq-opActionButton"
                      disabled={actionDisabled || busyKey === "suspend"}
                      onClick={() => void performAction("suspend", {
                        method: "POST",
                        body: { action: "suspend", durationDays: suspendDays },
                        successMessage: `Team access suspended for ${durationLabel(suspendDays)}.`,
                      })}
                    >
                      {busyKey === "suspend" ? "Suspending..." : "Suspend"}
                    </button>
                  )}
                </div>
              </div>

              <div className="hq-opActionCard">
                <div className="hq-opActionHead">
                  <div className="hq-opActionTitle">Permanent revoke</div>
                  <div className="hq-opActionSub">Revoke this team record completely. A future return would require a new operator code.</div>
                </div>
                <div className="hq-opActionBody hq-opForm">
                  <div className="hq-helperText">This removes the team record from HQ access entirely.</div>
                </div>
                <div className="hq-opActionFooter">
                  <button
                    type="button"
                    className="hq-opActionButton"
                    data-tone="danger"
                    disabled={actionDisabled || busyKey === "revoke"}
                    onClick={() => void performAction("revoke", {
                      method: "DELETE",
                      successMessage: "Team access revoked.",
                      redirectTo: "/staff",
                    })}
                  >
                    {busyKey === "revoke" ? "Revoking..." : "Revoke"}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </Panel>
  );
}
