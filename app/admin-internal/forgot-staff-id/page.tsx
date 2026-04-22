"use client";

import { useState } from "react";

import { AdminAuthHero } from "@/components/admin/AdminAuthHero";

export const dynamic = "force-dynamic";

export default function ForgotStaffIdPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    await fetch("/api/admin/forgot-staff-id", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    setDone(true);
  };

  return (
    <div className="hq-authShell">
      <div className="hq-authCard">
        <AdminAuthHero
          title="Forgot Staff ID"
          subtitle="Enter the email attached to your CavBot staff account. If an active staff profile exists, CavBot will send a secure recovery notice and surface the staff ID only inside CavBot notifications."
        />

        <div className="hq-formGrid">
          <label className="hq-formLabel">
            Staff email
            <input className="hq-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@cavbot.io" />
          </label>

          <div className="hq-inline">
            <button type="button" className="hq-button" disabled={busy} onClick={submit}>
              {busy ? "Sending..." : "Send secure notice"}
            </button>
            <a className="hq-buttonGhost" href="/sign-in">
              Back to sign in
            </a>
          </div>

          {done ? (
            <div className="hq-empty">
              <p className="hq-emptyTitle">Check CavBot.</p>
              <p className="hq-emptySub">
                If the email belongs to a CavBot HQ staff profile, a secure recovery notice was sent. Sign in to CavBot and open notifications to view the staff ID securely.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
