"use client";

import Link from "next/link";
import { Suspense, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";
import { PasswordVisibilityIcon } from "@/components/icons/PasswordVisibilityIcon";

function isStrongPassword(pw: string) {
  const p = String(pw || "");
  if (p.length < 10) return false;
  const hasUpper = /[A-Z]/.test(p);
  const hasLower = /[a-z]/.test(p);
  const hasNum = /[0-9]/.test(p);
  return hasUpper && hasLower && hasNum;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPageInner />
    </Suspense>
  );
}

function ResetPasswordPageInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const token = useMemo(() => sp.get("token") || "", [sp]);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // ------------------------------------------------------------
  // Badge eye states (MATCH /auth + /users/recovery LOGIC)
  // ------------------------------------------------------------
  const [eyeError, setEyeError] = useState(false);
  const eyeErrTimer = useRef<number | null>(null);

  function flashErrorEyes() {
    setEyeError(true);
    if (eyeErrTimer.current) window.clearTimeout(eyeErrTimer.current);
    eyeErrTimer.current = window.setTimeout(() => setEyeError(false), 900);
  }

  // ------------------------------------------------------------
  // Show / Hide password (BOTH INPUTS)
  // When ON => CavBot "watch" pulse loops continuously
  // ------------------------------------------------------------
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const eyeWatch = useMemo(() => Boolean(showPw || showPw2), [showPw, showPw2]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");

    if (!token) {
      setStatus("This reset link is missing a token.");
      flashErrorEyes();
      return;
    }

    if (!isStrongPassword(pw)) {
      setStatus("Password must be 10+ chars, with uppercase, lowercase, and a number.");
      flashErrorEyes();
      return;
    }

    if (pw !== pw2) {
      setStatus("Passwords do not match.");
      flashErrorEyes();
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/recovery/password/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        const code = data?.error || "RESET_FAILED";

        if (code === "EXPIRED_TOKEN") setStatus("This reset link has expired. Please request a new one.");
        else if (code === "INVALID_TOKEN") setStatus("This reset link is invalid. Please request a new one.");
        else if (code === "WEAK_PASSWORD") setStatus("Password must be stronger (10+ chars, mixed case, number).");
        else setStatus("Reset failed. Please try again.");

        flashErrorEyes();
        setLoading(false);
        return;
      }

      setStatus("Password updated. Redirecting to login…");
      setTimeout(() => router.push("/auth?mode=login"), 900);
    } catch {
      setStatus("Reset failed. Please try again.");
      flashErrorEyes();
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell" data-cavbot-page="reset">
      <main className="auth-main">
        <section className="auth-stage" aria-label="Reset password">
          <div className="auth-grid">
            <section className="auth-card" aria-label="Reset panel">
              {/* TOP */}
              <div className="auth-card-top">
                <div className="auth-title-row">
                  <br />
                  <br />

                  {/* Badge (SAME LOGIC AS /auth) */}
                  <div
                    className={[
                      "auth-badge",
                      "cb-badge",
                      "cb-badge-inline",
                      eyeError ? "cavbot-auth-eye-error" : "",
                      eyeWatch ? "cavbot-auth-eye-watch" : "",
                    ].join(" ")}
                    data-auth-badge
                    aria-hidden="false"
                  >
                    <div className="cavbot-badge-frame">
                      <CdnBadgeEyes />
                    </div>
                  </div>

                  <br />

                  <div>
                    <div className="auth-kicker">Reset route</div>
                    <br />
                    <h2 className="auth-title">Set a new password</h2>
                  </div>
                </div>
              </div>

              <br />

              <p className="reset-blurb">
                Choose a strong password. This link expires quickly for your safety.
              </p>

              {status ? (
                <div className="reset-status is-on" role="status" aria-live="polite">
                  {status}
                </div>
              ) : null}

              <br />

              <form className="auth-panel" onSubmit={onSubmit} noValidate>
                {/* NEW PASSWORD */}
                <div className="auth-field-row">
                  <div className="auth-password-wrap">
                    <input
                      className="auth-input"
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="New password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                    />

                    <button
                      className="auth-show"
                      type="button"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      aria-pressed={showPw}
                      onClick={() => setShowPw((v) => !v)}
                    >
                      <PasswordVisibilityIcon shown={showPw} />
                    </button>
                  </div>
                </div>

                <br />

                {/* CONFIRM PASSWORD */}
                <div className="auth-field-row">
                  <div className="auth-password-wrap">
                    <input
                      className="auth-input"
                      type={showPw2 ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Confirm new password"
                      value={pw2}
                      onChange={(e) => setPw2(e.target.value)}
                    />

                    <button
                      className="auth-show"
                      type="button"
                      aria-label={showPw2 ? "Hide password" : "Show password"}
                      aria-pressed={showPw2}
                      onClick={() => setShowPw2((v) => !v)}
                    >
                      <PasswordVisibilityIcon shown={showPw2} />
                    </button>
                  </div>
                </div>

                <br />

                <button className="auth-primary" type="submit" disabled={loading}>
                  {loading ? "Updating…" : "Update password"}
                  <span className="auth-primary-glow" aria-hidden="true"></span>
                </button>

                <br />

                {/* LEFT aligned exactly like your inputs */}
                <div className="reset-back-row">
                  <Link className="auth-link" href="/auth?mode=login">
                    Back to login
                  </Link>
                </div>
              </form>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
