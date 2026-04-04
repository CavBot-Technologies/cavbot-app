"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import CdnBadgeEyes from "@/components/CdnBadgeEyes";

export default function ConfirmEmailRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailRecoveryPageInner />
    </Suspense>
  );
}

function ConfirmEmailRecoveryPageInner() {
  const sp = useSearchParams();
  const router = useRouter();

  const token = useMemo(() => sp.get("token") || "", [sp]);

  // ------------------------------------------------------------
  // Badge eye states (error flash) MATCHES RECOVERY PAGE
  // ------------------------------------------------------------
  const [eyeError, setEyeError] = useState(false);
  const eyeErrTimer = useRef<number | null>(null);

  function flashErrorEyes() {
    setEyeError(true);
    if (eyeErrTimer.current) window.clearTimeout(eyeErrTimer.current);
    eyeErrTimer.current = window.setTimeout(() => setEyeError(false), 900);
  }

  useEffect(() => {
    return () => {
      if (eyeErrTimer.current) window.clearTimeout(eyeErrTimer.current);
    };
  }, []);

  // ------------------------------------------------------------
  // Status + result
  // ------------------------------------------------------------
  const [status, setStatus] = useState("");
  const [statusOn, setStatusOn] = useState(false);

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  function showStatus(msg: string, isError = false) {
    setStatus(msg);
    setStatusOn(true);
    if (isError) flashErrorEyes();
  }

  async function onConfirm() {
    if (loading) return;

    setStatus("");
    setStatusOn(false);
    setEmail("");

    if (!token) {
      showStatus("This recovery link is missing a token.", true);
      return;
    }

    setLoading(true);
    showStatus("CavBot scan initialized. Confirming your recovery link…");

    try {
      const res = await fetch("/api/auth/recovery/email/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        const code = data?.error || "RECOVERY_FAILED";

        if (code === "EXPIRED_TOKEN") {
          showStatus("This recovery link has expired. Please request a new one.", true);
        } else if (code === "INVALID_TOKEN") {
          showStatus("This recovery link is invalid. Please request a new one.", true);
        } else {
          showStatus("Recovery failed. Please try again.", true);
        }

        setLoading(false);
        return;
      }

      const found = String(data?.email || "");
      setEmail(found);

      showStatus("Login email confirmed.");
      setLoading(false);
    } catch {
      showStatus("Recovery failed. Please try again.", true);
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell" data-cavbot-page="recovery">
      <main className="auth-main">
        <section className="auth-stage" aria-label="Recover login email">
          <div className="auth-grid">
            <section className="auth-card" aria-label="Recovery panel">
              {/* TOP — exact structure as RecoveryPage */}
              <div className="auth-card-top">
                <div className="auth-title-row">
                  <br />
                  <br />

                  {/* Badge (same snippet + red-eye error flash) */}
                  <div
                    className={[
                      "auth-badge",
                      "cb-badge",
                      "cb-badge-inline",
                      eyeError ? "cavbot-auth-eye-error" : "",
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
                    <div className="auth-kicker" id="auth-kicker">
                      Account recovery
                    </div>
                    <br />
                    <h2 className="auth-title" id="auth-title">
                      Confirm your login email
                    </h2>
                  </div>
                </div>
              </div>

              <br />

              <p className="recovery-blurb" id="recovery-blurb">
                This link is valid for a limited time and can only be used once.
              </p>

              <div
                className={`recovery-status ${statusOn ? "is-on" : ""}`}
                id="recovery-status"
                role="status"
                aria-live="polite"
              >
                {status}
              </div>

              <br />

              {!email ? (
                <button
                  className="auth-primary"
                  type="button"
                  onClick={onConfirm}
                  disabled={loading}
                >
                  {loading ? "Confirming…" : "Confirm login email"}
                  <span className="auth-primary-glow" aria-hidden="true"></span>
                </button>
              ) : (
                <>
                  {/* Email reveal card — matches recovery status style */}
                  <div className="recovery-email-card" role="group" aria-label="Recovered email">
                    <div className="recovery-email-label">Your CavBot login email</div>
                    <div className="recovery-email-value">{email}</div>
                  </div>

                  <br />

                  <button
                    className="auth-primary"
                    type="button"
                    onClick={() => router.push("/auth?mode=login")}
                  >
                    Continue to login
                    <span className="auth-primary-glow" aria-hidden="true"></span>
                  </button>
                </>
              )}

              <br />

              {/* FOOTER MENU — match RecoveryPage */}
             

                  <br />

                  <div className="auth-footer-panel" role="group" aria-label="Account recovery links">
                    <div className="auth-footer-links">

                      <Link className="auth-link" href="/users/recovery">
                        Back to recovery
                      </Link>
                    </div>

              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
