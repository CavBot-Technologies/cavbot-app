"use client";

import * as React from "react";
import { ADMIN_DEPARTMENT_OPTIONS } from "@/lib/admin/access";

type Props = {
  staffId: string;
  department: string;
  onboardingStatus: string;
  lifecycleState: string;
  positionTitle: string;
  notes?: string | null;
  disabled?: boolean;
};

type UpdateResult = {
  ok: boolean;
  error?: string;
};

export function StaffProfileEditor(props: Props) {
  const [department, setDepartment] = React.useState(props.department);
  const [onboardingStatus, setOnboardingStatus] = React.useState(props.onboardingStatus);
  const [lifecycleState, setLifecycleState] = React.useState(props.lifecycleState);
  const [positionTitle, setPositionTitle] = React.useState(props.positionTitle);
  const [notes, setNotes] = React.useState(props.notes || "");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const submit = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/staff/${props.staffId}`, {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          department,
          onboardingStatus,
          lifecycleState,
          positionTitle,
          notes,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as UpdateResult;
      if (!res.ok || !data.ok) {
        setMessage(`Update failed: ${String(data.error || "unknown error")}`);
        return;
      }
      setMessage("Operator profile updated.");
      window.location.reload();
    } catch {
      setMessage("Operator profile update failed.");
    } finally {
      setBusy(false);
    }
  }, [department, lifecycleState, notes, onboardingStatus, positionTitle, props.staffId]);

  return (
    <form className="hq-formGrid" onSubmit={submit}>
      <div className="hq-inline">
        <label className="hq-formLabel" style={{ flex: 1 }}>
          Department
          <select className="hq-select" value={department} onChange={(event) => setDepartment(event.target.value)} disabled={props.disabled || busy}>
            {ADMIN_DEPARTMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="hq-inline">
        <label className="hq-formLabel" style={{ flex: 1 }}>
          Onboarding
          <select className="hq-select" value={onboardingStatus} onChange={(event) => setOnboardingStatus(event.target.value)} disabled={props.disabled || busy}>
            <option value="PENDING">Pending</option>
            <option value="READY">Ready</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </label>
        <label className="hq-formLabel" style={{ flex: 1 }}>
          Lifecycle
          <select className="hq-select" value={lifecycleState} onChange={(event) => setLifecycleState(event.target.value)} disabled={props.disabled || busy}>
            <option value="ACTIVE">Active</option>
            <option value="LEAVE">Leave</option>
            <option value="OFFBOARDING">Offboarding</option>
          </select>
        </label>
      </div>
      <label className="hq-formLabel">
        Position
        <input className="hq-input" value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} disabled={props.disabled || busy} />
      </label>
      <label className="hq-formLabel">
        Notes
        <textarea className="hq-textarea" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={props.disabled || busy} />
      </label>
      <div className="hq-inline">
        <button type="submit" className="hq-button" disabled={props.disabled || busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {message ? <span className="hq-helperText">{message}</span> : null}
      </div>
    </form>
  );
}
