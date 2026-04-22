"use client";

import * as React from "react";
import { ADMIN_DEPARTMENT_OPTIONS } from "@/lib/admin/access";

type InviteResult = {
  ok: boolean;
  error?: string;
  status?: string;
  delivery?: string;
  staffCode?: string | null;
};

export function StaffInvitePanel() {
  const [identifier, setIdentifier] = React.useState("");
  const [department, setDepartment] = React.useState("OPERATIONS");
  const [positionTitle, setPositionTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState("");

  const submit = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/admin/staff/invites", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          identifier,
          department,
          positionTitle,
          message,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as InviteResult;
      if (!res.ok || !data.ok) {
        setStatus(`Onboarding failed: ${String(data.error || "unknown error")}`);
        return;
      }
      setStatus(
        data.delivery === "notification"
          ? "Offer sent to the user's notifications. They have 14 days to accept."
          : data.staffCode
          ? `Access granted. Operator ID ${data.staffCode}.`
          : `Onboarding queued. Operator ID will be issued on first admin sign-in.`,
      );
      setIdentifier("");
      setPositionTitle("");
      setMessage("");
      window.setTimeout(() => {
        window.location.reload();
      }, 900);
    } catch {
      setStatus("Onboarding failed.");
    } finally {
      setBusy(false);
    }
  }, [department, identifier, message, positionTitle]);

  return (
    <form className="hq-formGrid hq-teamOnboardForm" onSubmit={submit}>
      <label className="hq-formLabel hq-teamOnboardField">
        Search CavBot
        <input className="hq-input" type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="name@company.com or @username" required />
      </label>
      <div className="hq-inline hq-teamOnboardRow">
        <label className="hq-formLabel hq-teamOnboardField" style={{ flex: 1 }}>
          Department
          <select className="hq-select" value={department} onChange={(event) => setDepartment(event.target.value)}>
            {ADMIN_DEPARTMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="hq-formLabel hq-teamOnboardField" style={{ flex: 1 }}>
          Position
          <input className="hq-input" value={positionTitle} onChange={(event) => setPositionTitle(event.target.value)} placeholder="Operations Manager" />
        </label>
      </div>
      <label className="hq-formLabel hq-teamOnboardField">
        Message
        <textarea className="hq-textarea" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Optional onboarding note." />
      </label>
      <div className="hq-inline hq-teamOnboardActions">
        <button type="submit" className="hq-button" disabled={busy}>
          {busy ? "Sending…" : "Onboard operator"}
        </button>
        {status ? <span className="hq-helperText">{status}</span> : null}
      </div>
    </form>
  );
}
